import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import type { CityPlan } from '../CityLayout';
import type { NatureBuilder } from './NatureBuilder';
import type { StreetLevel } from './StreetLevel';
import { PALETTE } from '../Palette';
import { PrismBatch, offsetPolygon, polygonArea } from './PrismBatch';
import {
  APEX,
  FENCES,
  LANDINGS,
  MEETING_POINT,
  FRONT_PLANTERS,
  GRAY_CORE,
  ITEMS,
  MC_COS,
  ROOFS,
  ROOMS,
  SCHOOL,
  STAIRS,
  U,
  UPPER,
  V,
  WALLS,
  inLot,
  inPoly,
  miguelCaneU,
  rearV,
  roomAt,
  toWorld,
  type Item,
  type OpeningType,
  type P,
  type Room,
  type SchoolFrame,
  type Stair,
  type Wall,
} from '../SchoolLayout';

const hex = (h: string) => Color3.FromHexString(h);
const H = SCHOOL.storey;
const FY = SCHOOL.floorY;

/** Alto de cada tipo de vano: [antepecho, dintel]. */
const HOLE: Record<OpeningType, [number, number]> = {
  door: [0, 2.15],
  double: [0, 2.25],
  pass: [0, 2.6],
  exit: [0, 2.3],
  entrance: [0, 2.75],
  window: [0.95, 2.35],
  high: [4.3, 6.2],
  counter: [0.95, 2.05],
};

interface Side {
  bands: Array<[number, number, Material]>;
  stripe: boolean;
  exterior: boolean;
  room: Room | null;
}

interface Layer {
  off: number;
  t: number;
  side: Side;
}

/**
 * Escuela CIMDIP & Miguel Cané, levantada desde el plano de evacuación.
 *
 * Todo sale de `SchoolLayout`: muros con sus vanos reales (se cortan en
 * antepechos, dinteles y tramos llenos, así las ventanas se ven desde adentro
 * y las puertas se atraviesan), pisos y losas con el polígono exacto de cada
 * ambiente, la planta alta como volumen cerrado sobre las alas que la tienen,
 * el gimnasio con su bóveda y el equipamiento que se ve en el recorrido
 * virtual de 2020. Los colores también vienen de ahí: muros blancos con
 * guarda roja, gimnasio gris, aula de danzas con piso de madera y columnas
 * rojas, Tecnología con piso verde y sillas azules, jardín amarillo.
 */
export class SchoolBuilder {
  private f!: SchoolFrame;
  private prisms!: PrismBatch;
  private readonly m: Record<string, Material>;

  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly rng: Rng,
    private readonly nature: NatureBuilder,
    private readonly street: StreetLevel,
  ) {
    const i = (h: string, kind: Parameters<Materials['interior']>[1] = null, lift?: number) =>
      mats.interior(hex(h), kind, lift);
    const s = (h: string, rough = 0.8, metal = 0, kind: Parameters<Materials['surface']>[3] = null) =>
      mats.surface(hex(h), rough, metal, kind);
    this.m = {
      // Exterior: gris claro de la fachada real, zócalos y remates.
      facade: s('#c6c9c9', 0.9, 0, 'concreteXL'),
      slab: s('#d9dbd9', 0.8, 0, 'concrete'),
      roof: s('#74777a', 0.85, 0, 'concrete'),
      gymRoof: s('#86675a', 0.6, 0.2, 'metal'),
      patio: s('#aeaba4', 0.92, 0, 'pavement'),
      // Interior (con luz rebotada simulada).
      white: i('#efefeb'),
      stripe: i('#b9262c', null, 0.2),
      ceiling: i('#f4f4f0', null, 0.3),
      tile: i('#d4cec2', 'pavement'),
      wood: i('#b07a47', 'timber'),
      gymFloor: i('#bdb9ae', 'pavement'),
      green: i('#5f9270', 'pavement'),
      gymWall: i('#8e9296'),
      yellow: i('#e9c23c'),

      // Carpintería, herrería y mobiliario.
      glass: mats.glass(hex('#a9c3cf'), 0.26),
      glassDark: mats.glass(PALETTE.glassBlue, 0.9),
      frame: s('#e6e8e8', 0.45, 0.15),
      red: s('#b8353c', 0.6),
      blue: s('#2d4f9e', 0.6),
      navy: s('#243b67', 0.65),
      metalDark: s('#2c2f35', 0.5, 0.25, 'metal'),
      metal: mats.metal(PALETTE.solarFrame, 0.4),
      timber: s('#c99a62', 0.8, 0, 'timber'),
      timberDark: s('#7b5236', 0.8, 0, 'timber'),
      chairGreen: s('#2f7a5c', 0.6),
      board: i('#f6f7f6', null, 0.35),
      soil: mats.surface(PALETTE.soil, 0.95, 0, null),
      grass: mats.grass(PALETTE.leafMid),
      stair: i('#9a9a96', 'concrete', 0.18),
      light: mats.glow(hex('#f5f8ff'), 0.95),
      exitSign: mats.glow(hex('#37c46b'), 0.9),
      lit: mats.glow(PALETTE.glassLit, 0.7),
      lane: mats.surface(PALETTE.pavementDark, 0.88, 0, 'pavementXL'),
      kerb: mats.surface(PALETTE.concreteShade, 0.9, 0, 'pavement'),
    };
    // Alias: mismos materiales con otro nombre de uso. Cada material nuevo es
    // una malla fuente más (un draw call); acá se comparten a propósito.
    const m = this.m;
    Object.assign(m, {
      bars: m.metalDark,
      black: m.metalDark,
      portal: m.metalDark,
      stone: m.timberDark,
      appliance: m.frame,
      mirror: m.frame,
      leaf: m.board,
      chairBlue: m.blue,
      curtainBlue: m.blue,
      curtainRed: m.red,
      paving: m.patio,
      tileDark: m.tile,
    });
  }

  build(frame: SchoolFrame, plan: CityPlan, scene: Scene): Mesh[] {
    this.f = frame;
    this.prisms = new PrismBatch((u, v) => toWorld(frame, u, v), 0.3);
    this.grounds(plan);
    this.floors();
    for (const w of WALLS) this.wall(w);
    this.ceilings();
    this.upperFloors();
    this.roofs();
    this.gym();
    for (const s of STAIRS) this.stair(s);
    this.cores();
    for (const it of ITEMS) this.item(it);
    this.lights();
    this.portal();
    this.frontage();
    this.fences();
    this.utilityLines();
    return this.prisms.build(scene, 'school');
  }

  // ================================================================ utilidades

  /** Caja alineada, apoyada en `y`, en coordenadas locales. */
  private box(mat: Material, u: number, v: number, w: number, h: number, d: number, y = 0): void {
    const p = toWorld(this.f, u, v);
    this.farm.addBoxOnGround(mat, p.x, p.z, w, h, d, y, 0);
  }

  private cyl(mat: Material, u: number, v: number, dia: number, h: number, y = 0): void {
    const p = toWorld(this.f, u, v);
    this.farm.add('cylinder', mat, new Vector3(p.x, y + h / 2, p.z), new Vector3(dia, h, dia));
  }

  /**
   * Caja a lo largo del segmento a→b (cualquier ángulo), de espesor `t`,
   * entre `y0` e `y1`, corrida `off` metros hacia la normal izquierda.
   */
  private piece(mat: Material, a: P, b: P, t: number, y0: number, y1: number, off = 0): void {
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const len = Math.hypot(du, dv);
    if (len < 0.01 || y1 - y0 < 0.004) return;
    const nu = -dv / len;
    const nv = du / len;
    const p = toWorld(this.f, (a[0] + b[0]) / 2 + nu * off, (a[1] + b[1]) / 2 + nv * off);
    // rotY lleva +X a (cos, −sin): el eje largo va sobre la dirección del
    // segmento EN EL MUNDO, donde +u es −x.
    this.farm.add('box', mat, new Vector3(p.x, (y0 + y1) / 2, p.z), new Vector3(len, y1 - y0, t), this.yaw(du, dv));
  }

  /** Giro en Y que alinea +X con la dirección local (du, dv). */
  private yaw(du: number, dv: number): number {
    const a = toWorld(this.f, 0, 0);
    const b = toWorld(this.f, du, dv);
    return Math.atan2(-(b.z - a.z), b.x - a.x);
  }

  // ================================================================== terreno

  private grounds(plan: CityPlan): void {
    const f = this.f;
    const top = f.site.z0 - f.oz;
    const west = f.site.x0 - f.ox;
    const front = SCHOOL.front;
    // Franja de frente y ochavo de Miguel Cané: solado exterior.
    this.prisms.plan(
      this.m.paving,
      [
        [miguelCaneU(front), front],
        [miguelCaneU(0), 0],
        [U.e + SCHOOL.eastGap, 0],
        [U.e + SCHOOL.eastGap, front],
      ],
      0,
      0.06,
      { bottom: false },
    );
    this.prisms.plan(
      this.m.paving,
      [
        [miguelCaneU(0), 0],
        [U.w, 0],
        [U.w, V.classTop],
        [miguelCaneU(V.corrS), V.corrS],
      ],
      0,
      0.06,
      { bottom: false },
    );
    // Fondos de los vecinos detrás de la medianera: pasto y algún árbol.
    this.prisms.plan(this.m.grass, [APEX, [miguelCaneU(top), top], [U.teaE, top], [U.teaE, rearV(U.teaE)]], 0, 0.05, {
      bottom: false,
    });
    for (const [u, v] of [
      [27, -38.6],
      [38, -36.8],
      [49, -34.4],
    ] as const) {
      const p = toWorld(f, u, v);
      this.nature.broadleaf(p.x, p.z, 0.9 + this.rng.range(0, 0.3), 0.05);
    }

    // Calle Miguel Cané: calzada en diagonal y cordones, de Laprida a la calle
    // del norte. La vereda es el solado base de la ciudad.
    const w = plan.streetWidth;
    const lane = w * 0.42;
    const offU = w / 2 / MC_COS;
    const vS = front + w / 2 - lane / 2;
    const vN = top - w / 2 + lane / 2;
    const a: P = [miguelCaneU(vS) - offU, vS];
    const b: P = [miguelCaneU(vN) - offU, vN];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mid = toWorld(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const rot = this.yaw(b[0] - a[0], b[1] - a[1]);
    // Un pelo más baja que las calles de la grilla: en el cruce no pelean.
    this.farm.add('box', this.m.lane, new Vector3(mid.x, 0.038, mid.z), new Vector3(len, 0.075, lane), rot);
    for (const s of [-1, 1]) {
      this.piece(this.m.kerb, a, b, 0.32, 0, 0.165, s * (lane / 2 + 0.16));
    }
    // Plazoleta al oeste de Miguel Cané, en lo que sobra de la manzana doble.
    const parkEdge = (v: number) => miguelCaneU(v) - w / MC_COS;
    const park: P[] = [
      [west, front],
      [parkEdge(front), front],
      [parkEdge(top), top],
      [west, top],
    ];
    this.prisms.plan(this.m.grass, park, 0, 0.06, { bottom: false });
    for (let v = -4; v > top + 3; v -= 7.5) {
      const u = (west + parkEdge(v)) / 2 + this.rng.range(-1.5, 1.5);
      if (u > parkEdge(v) - 2.5 || u < west + 2.5) continue;
      const p = toWorld(f, u, v);
      this.nature.broadleaf(p.x, p.z, this.rng.range(0.8, 1.15), 0.06);
    }
    // Arbolado de la vereda oeste de Miguel Cané.
    for (let v = -2; v > top + 2; v -= 11) {
      const u = miguelCaneU(v) - (w - 2.1) / MC_COS;
      const p = toWorld(f, u, v);
      this.street.treePit(p.x, p.z);
      this.nature.broadleaf(p.x, p.z, this.rng.range(0.7, 1.0), 0.1);
    }
  }

  private floors(): void {
    const mat: Record<Room['floor'], Material> = {
      tile: this.m.tile,
      wood: this.m.wood,
      gym: this.m.gymFloor,
      green: this.m.green,
      patio: this.m.patio,
      dark: this.m.tileDark,
    };
    for (const r of ROOMS) this.prisms.plan(mat[r.floor], r.poly, 0, FY, { bottom: false });
  }

  // =================================================================== muros

  private side(w: Wall, room: Room | null): Side {
    if (w.kind === 'medianera' || !room) {
      return { bands: [[0, w.h, this.m.facade]], stripe: false, exterior: true, room };
    }
    const mat = room.id === 'gimnasio' ? this.m.gymWall : room.id === 'jardin' ? this.m.yellow : this.m.white;
    const stripe = mat === this.m.white;
    // Muro alto del gimnasio visto desde un ambiente bajo: por encima del
    // techo vecino ya es fachada.
    if (w.h > 3.8 && room.id !== 'gimnasio') {
      return { bands: [[0, H, mat], [H, w.h, this.m.facade]], stripe, exterior: false, room };
    }
    return { bands: [[0, w.h, mat]], stripe, exterior: false, room };
  }

  private wall(w: Wall): void {
    const [au, av] = w.a;
    const len = Math.hypot(w.b[0] - au, w.b[1] - av);
    const du = (w.b[0] - au) / len;
    const dv = (w.b[1] - av) / len;
    const nu = -dv;
    const nv = du;
    const mu = au + (du * len) / 2;
    const mv = av + (dv * len) / 2;
    const t = w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT;
    const pos = this.side(w, roomAt(mu + nu * 0.45, mv + nv * 0.45));
    const neg = this.side(w, roomAt(mu - nu * 0.45, mv - nv * 0.45));
    const same =
      pos.bands.length === neg.bands.length &&
      pos.bands.every((b, k) => b[2] === neg.bands[k][2] && b[0] === neg.bands[k][0] && b[1] === neg.bands[k][1]);
    const layers: Layer[] = same
      ? [{ off: 0, t, side: pos }]
      : [
          { off: t / 4, t: t / 2, side: pos },
          { off: -t / 4, t: t / 2, side: neg },
        ];
    const at = (d: number): P => [au + du * d, av + dv * d];

    // Tramos: llenos y vanos, en orden.
    const spans: Array<{ t0: number; t1: number; hole: [number, number] | null }> = [];
    let cur = 0;
    for (const o of w.openings) {
      if (o.t0 > cur + 0.005) spans.push({ t0: cur, t1: o.t0, hole: null });
      const [hb, ht] = HOLE[o.type];
      spans.push({ t0: o.t0, t1: o.t1, hole: [hb, Math.min(ht, w.h - 0.15)] });
      cur = o.t1;
    }
    if (cur < len - 0.005) spans.push({ t0: cur, t1: len, hole: null });

    for (const L of layers) {
      for (const [y0, y1, mat] of L.side.bands) {
        for (const s of spans) {
          const a = at(s.t0);
          const b = at(s.t1);
          if (!s.hole) {
            this.piece(mat, a, b, L.t, y0, y1, L.off);
            continue;
          }
          const [hb, ht] = s.hole;
          if (hb > y0 + 0.005) this.piece(mat, a, b, L.t, y0, Math.min(y1, hb), L.off);
          if (ht < y1 - 0.005) this.piece(mat, a, b, L.t, Math.max(y0, ht), y1, L.off);
        }
      }
      // Guarda roja a la altura de la mano, como en todos los pasillos del
      // recorrido. Se interrumpe en puertas y ventanas.
      if (L.side.stripe) {
        for (const s of spans) {
          if (s.hole && s.hole[0] < 1.08 && s.hole[1] > 0.98) continue;
          this.piece(this.m.stripe, at(s.t0), at(s.t1), L.t + 0.02, 0.98, 1.1, L.off);
        }
      }
    }

    const extSign = pos.exterior && !neg.exterior ? 1 : neg.exterior && !pos.exterior ? -1 : 0;
    for (const o of w.openings) {
      this.opening(w, o.type, at(o.t0), at(o.t1), o.t1 - o.t0, t, [nu, nv], extSign, pos.room, neg.room);
    }
  }

  /** Carpintería y herrería de un vano. */
  private opening(
    w: Wall,
    type: OpeningType,
    a: P,
    b: P,
    len: number,
    t: number,
    n: P,
    extSign: number,
    roomPos: Room | null,
    roomNeg: Room | null,
  ): void {
    const [hb, htRaw] = HOLE[type];
    const ht = Math.min(htRaw, w.h - 0.15);
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const along = (d: number): P => [a[0] + du * d, a[1] + dv * d];
    const m = this.m;

    if (type === 'window' || type === 'high') {
      this.piece(m.glass, along(0.03), along(len - 0.03), 0.02, hb + 0.03, ht - 0.03);
      this.piece(m.frame, a, b, 0.1, hb, hb + 0.06);
      this.piece(m.frame, a, b, 0.1, ht - 0.06, ht);
      this.piece(m.frame, a, along(0.06), 0.1, hb, ht);
      this.piece(m.frame, along(len - 0.06), b, 0.1, hb, ht);
      this.piece(m.frame, along(len / 2 - 0.025), along(len / 2 + 0.025), 0.08, hb, ht);
      if (extSign !== 0 && type === 'window') {
        // Rejas negras de planta baja, como en todas las ventanas de la calle.
        const off = extSign * (t / 2 + 0.06);
        this.piece(m.slab, along(-0.05), along(len + 0.05), 0.16, hb - 0.06, hb, extSign * (t / 2 + 0.02));
        for (let k = 1; k < 7; k++) {
          const d = (k * len) / 7;
          this.piece(m.bars, along(d - 0.012), along(d + 0.012), 0.025, hb + 0.02, ht - 0.02, off);
        }
        for (const y of [hb + 0.45, ht - 0.45]) this.piece(m.bars, a, b, 0.025, y, y + 0.03, off);
      }
      // Cortinas en aulas y en el jardín (azules en las aulas del recorrido).
      const inner = extSign !== 0 ? (extSign > 0 ? roomNeg : roomPos) : null;
      if (type === 'window' && inner && (inner.id.startsWith('aula') || inner.id === 'jardin')) {
        const off = -extSign * (t / 2 + 0.06);
        this.piece(m.curtainBlue, along(-0.2), along(len + 0.2), 0.05, ht + 0.02, ht + 0.3, off);
        this.piece(m.curtainBlue, along(-0.3), along(0.12), 0.06, hb - 0.05, ht + 0.02, off);
        this.piece(m.curtainBlue, along(len - 0.12), along(len + 0.3), 0.06, hb - 0.05, ht + 0.02, off);
      }
      return;
    }

    if (type === 'counter') {
      this.piece(m.timber, a, b, t + 0.36, hb - 0.05, hb);
      return;
    }
    if (type === 'pass') return;

    // Puertas: marco rojo y hojas abiertas contra el muro.
    const frameMat = type === 'exit' ? m.metalDark : m.red;
    this.piece(frameMat, a, along(0.07), t + 0.05, 0, ht);
    this.piece(frameMat, along(len - 0.07), b, t + 0.05, 0, ht);
    this.piece(frameMat, a, b, t + 0.05, ht, ht + 0.08);

    // Las hojas abren hacia el ambiente (no hacia el pasillo); las de
    // emergencia, hacia la calle.
    const isHall = (r: Room | null) => !r || r.name === 'Pasillo' || !r.roofed;
    let s = !isHall(roomPos) ? 1 : !isHall(roomNeg) ? -1 : 1;
    if (type === 'exit' && extSign !== 0) s = extSign;
    const leafMat = type === 'exit' ? m.metalDark : type === 'entrance' ? m.glass : m.leaf;
    const hinges = type === 'door' ? [0.08] : [0.08, len - 0.08];
    const leafW = type === 'door' ? len - 0.16 : (len - 0.16) / 2;
    for (const h of hinges) {
      const p = along(h);
      const q0: P = [p[0] + n[0] * s * (t / 2 + 0.02), p[1] + n[1] * s * (t / 2 + 0.02)];
      const q1: P = [q0[0] + n[0] * s * leafW, q0[1] + n[1] * s * leafW];
      this.piece(leafMat, q0, q1, 0.045, 0.03, ht - 0.04);
      if (type === 'entrance') {
        for (const y of [0.03, ht - 0.12]) this.piece(m.red, q0, q1, 0.06, y, y + 0.1);
      }
    }
    if (type === 'exit') {
      const inside = extSign !== 0 ? -extSign : 1;
      this.piece(
        m.exitSign,
        along(len / 2 - 0.2),
        along(len / 2 + 0.2),
        0.05,
        ht + 0.14,
        ht + 0.34,
        inside * (t / 2 + 0.04),
      );
    }
  }

  // ======================================================== losas y volúmenes

  private ceilings(): void {
    for (const r of ROOMS) {
      if (!r.roofed || r.id === 'gimnasio') continue;
      this.prisms.plan(this.m.ceiling, r.poly, 3.22, 3.28, { top: false, sides: false });
    }
  }

  /** Planta alta: volumen cerrado con cornisa, pretil, azotea y ventanas. */
  private upperFloors(): void {
    const top = SCHOOL.upperTop;
    for (const poly of UPPER) {
      const body = offsetPolygon(poly, 0.15);
      this.prisms.plan(this.m.facade, body, H, top, { top: false, bottom: false });
      // Cornisa entre plantas. Arranca en la losa (no debajo): si bajara del
      // cielorraso, su cara inferior taparía el techo blanco de las aulas.
      this.prisms.plan(this.m.facade, offsetPolygon(poly, 0.34), H, H + 0.22);
      this.prisms.plan(this.m.roof, body, top, top + 0.04, { bottom: false, sides: false });
      this.parapet(body, top, 0.55);
      this.upperWindows(poly);
    }
  }

  private parapet(poly: readonly P[], y: number, h: number): void {
    const inward = polygonArea(poly) > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      this.piece(this.m.slab, a, b, 0.2, y, y + h, inward * 0.1);
    }
  }

  private upperWindows(poly: readonly P[]): void {
    const inward = polygonArea(poly) > 0 ? 1 : -1;
    const spacing = 3.25;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.floor((len - 0.8) / spacing);
      if (count < 1) continue;
      const du = (b[0] - a[0]) / len;
      const dv = (b[1] - a[1]) / len;
      const ou = inward * dv; // normal exterior (opuesta a la izquierda si es interior)
      const ov = -inward * du;
      const start = (len - (count - 1) * spacing) / 2;
      for (let k = 0; k < count; k++) {
        const d = start + k * spacing;
        const c: P = [a[0] + du * d, a[1] + dv * d];
        const probe: P = [c[0] + ou * 0.9, c[1] + ov * 0.9];
        // No se abren ventanas contra otro volumen alto ni contra el gimnasio.
        if (UPPER.some((p) => p !== poly && inPoly(p, probe[0], probe[1]))) continue;
        if (roomAt(probe[0], probe[1])?.id === 'gimnasio') continue;
        // El portal del acceso lleva su propia composición.
        if (Math.abs(c[1]) < 0.05 && c[0] > 32.4 && c[0] < 42.4) continue;
        const street = !inLot(probe[0], probe[1]);
        this.upperWindow(c, [du, dv], -inward, street);
      }
    }
  }

  /** Ventana de planta alta sobre la cara del volumen. `side` es el signo de la normal exterior. */
  private upperWindow(c: P, d: P, side: number, street: boolean): void {
    const m = this.m;
    const hw = 0.78;
    const a: P = [c[0] - d[0] * hw, c[1] - d[1] * hw];
    const b: P = [c[0] + d[0] * hw, c[1] + d[1] * hw];
    const y0 = 4.35;
    const y1 = 5.65;
    this.piece(m.glassDark, a, b, 0.03, y0, y1, side * 0.165);
    if (this.rng.chance(0.55)) this.piece(m.lit, a, b, 0.01, y0 + 0.05, y1 - 0.05, side * 0.185);
    const fa: P = [a[0] - d[0] * 0.06, a[1] - d[1] * 0.06];
    const fb: P = [b[0] + d[0] * 0.06, b[1] + d[1] * 0.06];
    this.piece(m.frame, fa, fb, 0.08, y0 - 0.06, y0, side * 0.18);
    this.piece(m.frame, fa, fb, 0.08, y1, y1 + 0.06, side * 0.18);
    this.piece(m.frame, fa, a, 0.08, y0, y1, side * 0.18);
    this.piece(m.frame, b, fb, 0.08, y0, y1, side * 0.18);
    this.piece(m.slab, fa, fb, 0.2, y0 - 0.12, y0 - 0.06, side * 0.22);
    if (!street) return;
    for (let k = 1; k < 7; k++) {
      const t = -hw + (k * 2 * hw) / 7;
      const p: P = [c[0] + d[0] * t, c[1] + d[1] * t];
      const q: P = [p[0] + d[0] * 0.025, p[1] + d[1] * 0.025];
      this.piece(m.bars, p, q, 0.025, y0, y1, side * 0.26);
    }
    // Equipos de aire acondicionado junto a varias ventanas de la calle.
    if (this.rng.chance(0.5)) {
      const e: P = [c[0] + d[0] * 1.35, c[1] + d[1] * 1.35];
      const f: P = [c[0] + d[0] * 2.25, c[1] + d[1] * 2.25];
      this.piece(m.appliance, e, f, 0.4, 5.15, 5.75, side * 0.35);
      this.piece(m.bars, e, f, 0.02, 5.2, 5.6, side * 0.56);
    }
  }

  /** Cubiertas de una planta: losa, membrana y pretil. */
  private roofs(): void {
    for (const r of ROOFS) {
      const body = offsetPolygon(r.poly, 0.15);
      this.prisms.plan(this.m.facade, body, r.y, r.y + 0.22, { bottom: false, top: false });
      this.prisms.plan(this.m.roof, body, r.y + 0.22, r.y + 0.24, { bottom: false, sides: false });
      this.parapet(body, r.y + 0.22, 0.35);
    }
  }

  // ================================================================ gimnasio

  /**
   * Gimnasio / SUM: muros de 7,2 m y bóveda de chapa (la cubierta curva que se
   * ve en la toma aérea), con cabriadas, tímpanos, luminarias, bandas rojas y
   * azules como en el video y la cancha pintada (en SchoolIdentity).
   */
  private gym(): void {
    const m = this.m;
    const wallTop = SCHOOL.gymWall;
    const rise = SCHOOL.gymRise;
    const chord = -V.gymTop;
    const r = (chord * chord) / 4 / (2 * rise) + rise / 2;
    const vc = V.gymTop / 2;
    const yc = wallTop + rise - r;
    const arcV = (phi: number, rr = r) => vc + rr * Math.sin(phi);
    const arcY = (phi: number, rr = r) => yc + rr * Math.cos(phi);
    const half = Math.asin(chord / 2 / r);
    const over = Math.asin(Math.min(0.99, (chord / 2 + 0.45) / r));
    const segs = 14;
    const uMid = (U.gymW + U.e) / 2;
    const uLen = U.e - U.gymW + 0.7;
    for (let i = 0; i < segs; i++) {
      const p0 = -over + ((2 * over) / segs) * i;
      const p1 = p0 + (2 * over) / segs;
      const pm = (p0 + p1) / 2;
      const w = 2 * r * Math.sin((p1 - p0) / 2) + 0.04;
      const pos = toWorld(this.f, uMid, arcV(pm));
      this.farm.add('box', m.gymRoof, new Vector3(pos.x, arcY(pm), pos.z), new Vector3(uLen, 0.1, w), 0, pm);
    }
    // Cabriadas curvas bajo la chapa.
    for (let u = U.gymW + 2.1; u < U.e - 1; u += 3.4) {
      for (let i = 0; i < 10; i++) {
        const p0 = -half + ((2 * half) / 10) * i;
        const p1 = p0 + (2 * half) / 10;
        const pm = (p0 + p1) / 2;
        const rr = r - 0.35;
        const w = 2 * rr * Math.sin((p1 - p0) / 2) + 0.04;
        const pos = toWorld(this.f, u, arcV(pm, rr));
        this.farm.add('box', m.metalDark, new Vector3(pos.x, arcY(pm, rr), pos.z), new Vector3(0.14, 0.3, w), 0, pm);
      }
      // Tensor horizontal.
      this.box(m.metalDark, u, vc, 0.08, 0.08, chord - 0.4, wallTop - 0.2);
      // Luminarias colgadas.
      for (const v of [vc - 5.5, vc, vc + 5.5]) this.box(m.light, u, v, 0.5, 0.12, 0.5, wallTop - 0.6);
    }
    // Tímpanos curvos en los extremos este y oeste.
    // El arco cierra solo contra la cuerda que apoya sobre los muros.
    const gable: P[] = [];
    for (let i = 0; i <= 16; i++) {
      const phi = -half + ((2 * half) / 16) * i;
      gable.push([arcV(phi), arcY(phi)]);
    }
    this.prisms.alongU(m.facade, gable, U.gymW - 0.15, U.gymW + 0.15);
    this.prisms.alongU(m.facade, gable, U.e - 0.15, U.e + 0.15);
    // Bandas verticales rojas y azules, como en los muros del video.
    for (const u of [53.2, 56.8, 60.9, 64.5]) {
      for (const v of [V.gymTop + 0.12, -0.165]) {
        this.box(m.red, u - 0.12, v, 0.18, 5.4, 0.03, 0.6);
        this.box(m.navy, u + 0.1, v, 0.14, 5.4, 0.03, 0.6);
      }
    }
    // Zócalo gris oscuro y portón de chapa de la salida a Laprida.
    this.box(m.metalDark, 52.9, 0.05, 3.9, 0.16, 0.1, 3.5);
  }

  // ================================================================ escaleras

  private stair(s: Stair): void {
    const m = this.m;
    const n = Math.max(4, Math.round((s.y1 - s.y0) / 0.175));
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const from = s.dir === 'u+' ? s.u0 : s.dir === 'u-' ? s.u1 : s.dir === 'v+' ? s.v0 : s.v1;
    const to = s.dir === 'u+' ? s.u1 : s.dir === 'u-' ? s.u0 : s.dir === 'v+' ? s.v1 : s.v0;
    const run = (to - from) / n;
    for (let i = 0; i < n; i++) {
      const c = from + run * (i + 0.5);
      const top = FY + s.y0 + ((i + 1) * (s.y1 - s.y0)) / n;
      if (alongU) this.box(m.stair, c, (s.v0 + s.v1) / 2, Math.abs(run) + 0.01, top, s.v1 - s.v0, 0);
      else this.box(m.stair, (s.u0 + s.u1) / 2, c, s.u1 - s.u0, top, Math.abs(run) + 0.01, 0);
      // Nariz de escalón clara (las del acceso llevan una franja amarilla).
      if (alongU) this.box(m.slab, c - run * 0.45, (s.v0 + s.v1) / 2, 0.05, 0.02, s.v1 - s.v0, top);
      else this.box(m.slab, (s.u0 + s.u1) / 2, c - run * 0.45, s.u1 - s.u0, 0.02, 0.05, top);
    }
    // Baranda roja inclinada sobre los dos lados largos.
    const rise = s.y1 - s.y0;
    const length = Math.abs(to - from);
    const ang = Math.atan2(rise, length);
    const hyp = Math.hypot(rise, length);
    const yMid = FY + (s.y0 + s.y1) / 2 + 0.9;
    for (const side of [0, 1]) {
      if (alongU) {
        const v = side ? s.v1 - 0.04 : s.v0 + 0.04;
        const p = toWorld(this.f, (s.u0 + s.u1) / 2, v);
        // +u es −x en el mundo: subir hacia +u levanta el extremo −X.
        const east = toWorld(this.f, 1, 0).x < toWorld(this.f, 0, 0).x;
        const up = s.dir === 'u+' ? ang : -ang;
        const tilt = east ? -up : up;
        this.farm.add('box', m.red, new Vector3(p.x, yMid, p.z), new Vector3(hyp, 0.05, 0.05), 0, 0, tilt);
      } else {
        const u = side ? s.u1 - 0.04 : s.u0 + 0.04;
        const p = toWorld(this.f, u, (s.v0 + s.v1) / 2);
        const tilt = s.dir === 'v+' ? -ang : ang;
        this.farm.add('box', m.red, new Vector3(p.x, yMid, p.z), new Vector3(0.05, 0.05, hyp), 0, tilt, 0);
      }
    }
  }

  /** Núcleo gris del plano, descanso de la escalera exterior y descanso principal. */
  private cores(): void {
    const g = GRAY_CORE;
    this.box(this.m.metalDark, (g.u0 + g.u1) / 2, (g.v0 + g.v1) / 2, g.u1 - g.u0, H, g.v1 - g.v0, 0);
    const l = LANDINGS[0];
    this.box(this.m.stair, (l.u0 + l.u1) / 2, (l.v0 + l.v1) / 2, l.u1 - l.u0, FY + 0.3, l.v1 - l.v0, 0);
    // Descanso entre los dos tramos de la escalera principal.
    this.box(this.m.stair, 26.5, -27.47, 0.8, FY + 1.65, 4.35, 0);
    // Tabique entre tramos.
    this.box(this.m.white, 23.2, -27.47, 5.8, 3.2, 0.12, 0);
  }

  // ============================================================ equipamiento

  private item(it: Item): void {
    const m = this.m;
    const { u, v, w, d } = it;
    const room = roomAt(u, v);
    const alongV = it.face === 'e' || it.face === 'w';
    switch (it.kind) {
      case 'desk': {
        // Tapa de madera sobre cuatro patas finas y un travesaño.
        this.box(m.timber, u, v, w, 0.04, d, FY + 0.7);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(m.metalDark, u + su * (w / 2 - 0.05), v + sv * (d / 2 - 0.05), 0.035, 0.7, 0.035, FY);
        }
        if (alongV) this.box(m.metalDark, u + w / 2 - 0.05, v, 0.03, 0.03, d - 0.1, FY + 0.25);
        else this.box(m.metalDark, u, v + d / 2 - 0.05, w - 0.1, 0.03, 0.03, FY + 0.25);
        break;
      }
      case 'chair': {
        const mat = room?.id === 'tecnologia' ? m.chairBlue : room?.id === 'teatro' ? m.black : m.chairGreen;
        this.chair(mat, u, v, it.face);
        break;
      }
      case 'table': {
        this.box(m.timber, u, v, w, 0.05, d, FY + 0.72);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(m.metalDark, u + su * (w / 2 - 0.08), v + sv * (d / 2 - 0.08), 0.05, 0.72, 0.05, FY);
        }
        break;
      }
      case 'teacherDesk': {
        this.box(m.timberDark, u, v, w, 0.05, d, FY + 0.73);
        if (alongV) {
          for (const s of [-1, 1]) this.box(m.timberDark, u, v + s * (d / 2 - 0.03), w, 0.73, 0.05, FY);
        } else {
          for (const s of [-1, 1]) this.box(m.timberDark, u + s * (w / 2 - 0.03), v, 0.05, 0.73, d, FY);
        }
        break;
      }
      case 'hexTable':
      case 'roundTable': {
        const top = it.kind === 'hexTable' ? m.timber : m.blue;
        const hgt = it.kind === 'hexTable' ? 0.74 : 0.55;
        this.cyl(top, u, v, w, 0.05, FY + hgt);
        this.box(m.metalDark, u, v, 0.1, hgt, 0.1, FY);
        const chairMat = it.kind === 'hexTable' ? m.chairBlue : m.red;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          const cu = u + Math.cos(a) * (w / 2 + 0.3);
          const cv = v + Math.sin(a) * (w / 2 + 0.3);
          const face: Item['face'] = Math.abs(Math.cos(a)) > 0.5 ? (Math.cos(a) > 0 ? 'w' : 'e') : Math.sin(a) > 0 ? 'n' : 's';
          this.chair(chairMat, cu, cv, face, it.kind === 'roundTable' ? 0.75 : 1);
        }
        break;
      }
      case 'board': {
        const [bw, bd] = alongV ? [0.03, d] : [w, 0.03];
        this.box(m.metalDark, u, v, alongV ? 0.04 : w + 0.08, 1.3, alongV ? d + 0.08 : 0.04, FY + 0.85);
        this.box(m.board, u + (alongV ? 0.02 : 0), v + (alongV ? 0 : 0.02), bw, 1.2, bd, FY + 0.9);
        break;
      }
      case 'shelf': {
        const mat = room?.id === 'jardin' ? m.appliance : m.timberDark;
        this.box(mat, u, v, w, 1.85, d, FY);
        for (const y of [0.5, 0.95, 1.4]) {
          const books = this.rng.pick([m.red, m.navy, m.chairGreen, m.timber]);
          if (alongV) this.box(books, u, v, w + 0.02, 0.28, d - 0.2, FY + y);
          else this.box(books, u, v, w - 0.2, 0.28, d + 0.02, FY + y);
        }
        break;
      }
      case 'counter': {
        const body = room?.id === 'buffet' ? m.black : m.appliance;
        this.box(body, u, v, w, 0.92, d, FY);
        this.box(room?.id === 'buffet' ? m.timberDark : m.frame, u, v, w + 0.04, 0.05, d + 0.04, FY + 0.92);
        break;
      }
      case 'fridge': {
        this.box(m.appliance, u, v, w, 1.9, d, FY);
        this.box(m.glass, u - 0.36, v, 0.02, 1.6, d - 0.1, FY + 0.15);
        break;
      }
      case 'planter': {
        this.box(m.blue, u, v, w, 0.6, d, FY);
        this.box(m.soil, u, v, w - 0.12, 0.04, d - 0.12, FY + 0.58);
        const n = Math.max(1, Math.round(Math.max(w, d) / 1.1));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const p = toWorld(this.f, u + (w >= d ? t * (w - 0.5) : 0), v + (w >= d ? 0 : t * (d - 0.5)));
          this.nature.shrub(p.x, p.z, this.rng.range(0.55, 0.8), FY + 0.6);
        }
        break;
      }
      case 'bench': {
        const mat = room?.id === 'buffet' ? m.timberDark : m.red;
        this.box(mat, u, v, w, 0.06, d, FY + 0.42);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(m.metalDark, u + s * (w / 2 - 0.12), v, 0.06, 0.42, d - 0.06, FY);
          else this.box(m.metalDark, u, v + s * (d / 2 - 0.12), w - 0.06, 0.42, 0.06, FY);
        }
        break;
      }
      case 'tree': {
        this.box(m.soil, u, v, 1.1, 0.04, 1.1, FY);
        this.box(m.slab, u, v, 1.3, 0.12, 1.3, FY - 0.08);
        const p = toWorld(this.f, u, v);
        this.nature.broadleaf(p.x, p.z, this.rng.range(0.75, 0.95), FY);
        break;
      }
      case 'column': {
        // Columnas de sección cuadrada: comparten malla con el resto de las
        // cajas de su color (un cilindro por color sería un draw call más).
        const mat = room?.id === 'salon' ? m.red : room?.id === 'tecnologia' ? m.blue : m.chairGreen;
        this.box(mat, u, v, w, 3.22 - FY, d, FY);
        break;
      }
      case 'mirror':
        this.box(m.mirror, u, v, w, 1.9, d, FY + 0.25);
        break;
      case 'barre': {
        this.box(m.timber, u, v, w, 0.05, d * 0.5, FY + 1.0);
        const n = Math.max(2, Math.round(Math.max(w, d) / 2));
        for (let k = 0; k <= n; k++) {
          const t = k / n - 0.5;
          this.box(m.metalDark, u + (alongV ? 0 : t * w), v + (alongV ? t * d : 0), 0.04, 1.02, 0.04, FY);
        }
        break;
      }
      case 'stall': {
        // Cubículo: dos tabiques, frente con puerta entornada e inodoro.
        for (const s of [-1, 1]) this.box(m.frame, u, v + s * (d / 2), w, 1.9, 0.04, FY + 0.12);
        this.box(m.leaf, u - w / 2, v - 0.18, 0.04, 1.8, d - 0.45, FY + 0.12);
        this.box(m.appliance, u + w / 2 - 0.35, v, 0.55, 0.42, 0.38, FY);
        break;
      }
      case 'stage': {
        this.box(m.black, u, v, w, 0.62, d, FY);
        this.box(m.black, u, v - d / 2 - 0.05, w, 0.6, 0.02, FY);
        // Fondo negro contra el muro del fondo.
        this.box(m.black, u, v - d / 2 + 0.06, w - 0.1, 2.6, 0.04, FY + 0.62);
        break;
      }
      case 'curtain': {
        // Telón rojo recogido a los costados y bambalina superior.
        for (const s of [-1, 1]) this.box(m.curtainRed, u + s * (w / 2 - 0.35), v, 0.7, 2.45, 0.16, FY + 0.62);
        this.box(m.curtainRed, u, v, w, 0.45, 0.18, H - 0.55);
        break;
      }
      case 'goal': {
        // Arco de handball: postes y travesaño a franjas, red al fondo.
        const back = it.face === 's' ? -d / 2 : d / 2;
        for (const s of [-1, 1]) this.box(m.red, u + s * (w / 2), v + back * 0.9, 0.08, 2.0, 0.08, FY);
        this.box(m.red, u, v + back * 0.9, w + 0.08, 0.08, 0.08, FY + 2.0);
        this.box(m.bars, u, v - back * 0.9, w, 2.0, 0.02, FY);
        for (const s of [-1, 1]) this.box(m.bars, u + s * (w / 2), v, 0.02, 2.0, d * 0.9, FY);
        this.box(m.bars, u, v, w, 0.02, d * 0.9, FY + 2.0);
        break;
      }
      case 'bleachers': {
        // Tres gradas de chapa con baranda roja, contra el muro este.
        for (let k = 0; k < 3; k++) {
          const du = (k - 1) * (w / 3);
          this.box(m.metalDark, u + du, v, w / 3, 0.45 * (k + 1), d, FY);
          this.box(m.timber, u + du, v, w / 3, 0.04, d, FY + 0.45 * (k + 1));
        }
        this.box(m.red, u + w / 2 - 0.1, v, 0.05, 0.05, d, FY + 2.35);
        for (const s of [-1, 1]) this.box(m.red, u + w / 2 - 0.1, v + s * (d / 2), 0.05, 1.0, 0.05, FY + 1.35);
        break;
      }
      case 'seats': {
        const n = Math.max(2, Math.round(Math.max(w, d) / 0.55));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          this.chair(m.black, u + (alongV ? 0 : t * w), v + (alongV ? t * d : 0), it.face);
        }
        break;
      }
      case 'booth': {
        // Recepción roja con reja, como la del hall en el recorrido.
        this.box(m.red, u, v + d / 2 - 0.35, w, 1.0, 0.5, FY);
        this.box(m.timber, u, v + d / 2 - 0.35, w + 0.05, 0.04, 0.55, FY + 1.0);
        break;
      }
      case 'playhouse': {
        const jardin = room?.id === 'jardin';
        const body = jardin ? m.yellow : m.timber;
        this.box(body, u, v, w, 1.3, d, FY);
        this.box(m.bars, u, v - d / 2, w * 0.35, 0.9, 0.02, FY + 0.1);
        const p = toWorld(this.f, u, v);
        for (const s of [-1, 1]) {
          this.farm.add(
            'box',
            jardin ? m.red : m.timberDark,
            new Vector3(p.x, FY + 1.62, p.z + s * (d / 4 + 0.02)),
            new Vector3(w + 0.2, 0.06, d / 2 + 0.25),
            0,
            s * 0.62,
          );
        }
        break;
      }
      case 'banner': {
        // Banner de pie: base y parante; la lona la pinta SchoolIdentity.
        this.box(m.metalDark, u, v, 0.25, 0.08, w, FY);
        this.box(m.metalDark, u, v, 0.03, 2.2, 0.03, FY);
        break;
      }
      case 'lockers': {
        this.box(m.navy, u, v, w, 1.8, d, FY);
        for (let k = 1; k < 4; k++) this.box(m.bars, u - w / 2 + (k * w) / 4, v, 0.02, 1.7, d + 0.02, FY + 0.05);
        break;
      }
    }
  }

  /** Silla escolar: asiento, respaldo y dos patines. `face` es hacia dónde mira. */
  private chair(mat: Material, u: number, v: number, face: Item['face'], scale = 1): void {
    const s = scale;
    const back: P = face === 'w' ? [0.2, 0] : face === 'e' ? [-0.2, 0] : face === 'n' ? [0, 0.2] : [0, -0.2];
    this.box(mat, u, v, 0.42 * s, 0.04, 0.42 * s, FY + 0.44 * s);
    const bw = back[0] !== 0 ? 0.03 : 0.42 * s;
    const bd = back[0] !== 0 ? 0.42 * s : 0.03;
    this.box(mat, u + back[0] * s, v + back[1] * s, bw, 0.36 * s, bd, FY + 0.5 * s);
    for (const k of [-1, 1]) {
      if (back[0] !== 0) this.box(this.m.metalDark, u, v + k * 0.17 * s, 0.38 * s, 0.44 * s, 0.03, FY);
      else this.box(this.m.metalDark, u + k * 0.17 * s, v, 0.03, 0.44 * s, 0.38 * s, FY);
    }
  }

  /** Tubos fluorescentes en todos los ambientes cubiertos. */
  private lights(): void {
    for (const r of ROOMS) {
      if (!r.roofed || r.id === 'gimnasio' || r.id === 'escalera' || r.id === 'nicho') continue;
      const y = 3.17;
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      for (const [u, v] of r.poly) {
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
      }
      const step = 2.9;
      const nu = Math.max(1, Math.round((u1 - u0) / step));
      const nv = Math.max(1, Math.round((v1 - v0) / step));
      const long = u1 - u0 >= v1 - v0;
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const u = u0 + ((i + 0.5) * (u1 - u0)) / nu;
          const v = v0 + ((j + 0.5) * (v1 - v0)) / nv;
          if (!inPoly(r.poly, u, v)) continue;
          this.box(this.m.light, u, v, long ? 1.2 : 0.16, 0.05, long ? 0.16 : 1.2, y);
        }
      }
    }
  }

  // ================================================================ fachada

  /**
   * Portal del acceso sobre Laprida: volumen gris grafito con tres ventanas,
   * franjas rojo-blanco-azul, marquesina roja con el nombre, pilares de piedra
   * y columnas azules junto a las puertas rojas (la tipografía y el escudo los
   * dibuja SchoolIdentity).
   */
  private portal(): void {
    const m = this.m;
    const u0 = 32.95;
    const u1 = 41.9;
    const uc = (u0 + u1) / 2;
    const w = u1 - u0;
    this.box(m.portal, uc, 0.3, w, 7.75 - 4.25, 0.36, 4.25);
    for (const [y, mat] of [
      [7.2, m.red],
      [7.36, m.slab],
      [7.5, m.navy],
    ] as const) {
      this.box(mat, uc, 0.5, w, 0.14, 0.04, y);
    }
    // Tres ventanas enrejadas del primer piso.
    for (const u of [uc - 2.75, uc, uc + 2.75]) {
      this.box(m.frame, u, 0.49, 1.7, 1.45, 0.04, 4.9);
      this.box(m.glassDark, u, 0.52, 1.55, 1.3, 0.02, 4.97);
      for (let k = -2; k <= 2; k++) this.box(m.bars, u + k * 0.28, 0.56, 0.025, 1.3, 0.025, 4.97);
    }
    // Marquesina roja con filetes; el texto va en el atlas.
    this.box(m.red, uc, 0.42, w - 0.4, 1.5, 0.3, 2.75);
    this.box(m.slab, uc, 0.58, w - 0.4, 0.07, 0.02, 4.1);
    this.box(m.navy, uc, 0.58, w - 0.4, 0.07, 0.02, 2.8);
    // Pilares revestidos en piedra y columnas azules del acceso.
    for (const [pu, pw] of [
      [33.15, 0.5],
      [41.4, 1.0],
    ] as const) {
      this.box(m.stone, pu, 0.18, pw, 2.75, 0.4, 0);
    }
    for (const u of [33.62, 40.62]) this.box(m.navy, u, 0.3, 0.28, 2.75, 0.28, 0.12);
    // Escalinata de tres huellas hasta el nivel del vestíbulo.
    for (const [v0, v1, h] of [
      [1.4, 2.0, 0.08],
      [0.8, 1.4, 0.1],
      [0, 0.8, FY],
    ] as const) {
      this.box(m.slab, (33.4 + 40.85) / 2, (v0 + v1) / 2, 40.85 - 33.4, h, v1 - v0, 0);
    }
    // Mástil inclinado con la bandera, a la izquierda del portal.
    const p = toWorld(this.f, 33.35, 0.7);
    this.farm.add('box', m.metal, new Vector3(p.x, 5.35, p.z + 0.35), new Vector3(0.06, 0.06, 1.9), 0, -0.6);
  }

  /**
   * Franja de frente: canteros rojos con cubos azules, palmeras de la vereda
   * y zócalo de las aulas, como en las tomas de Street View.
   */
  private frontage(): void {
    const m = this.m;
    for (const r of FRONT_PLANTERS) {
      const uc = (r.u0 + r.u1) / 2;
      const vc = (r.v0 + r.v1) / 2;
      this.box(m.red, uc, vc, r.u1 - r.u0, 0.55, r.v1 - r.v0, 0.06);
      this.box(m.soil, uc, vc, r.u1 - r.u0 - 0.2, 0.03, r.v1 - r.v0 - 0.2, 0.6);
      for (let u = r.u0 + 1.2; u < r.u1 - 0.6; u += 1.6) {
        const pt = toWorld(this.f, u, vc);
        this.nature.shrub(pt.x, pt.z, this.rng.range(0.45, 0.75), 0.62);
      }
      for (let u = r.u0 + 2.4; u < r.u1 - 1; u += 4.6) this.box(m.blue, u, vc + 0.15, 0.95, 0.75, 0.95, 0.06);
    }
    // Palmeras: esquina de Miguel Cané y vereda de Laprida.
    for (const [u, v, h] of [
      [-2.6, 0.6, 7.5],
      [15.8, 3.3, 8.6],
      [27.2, 3.3, 7.8],
      [45.9, 3.3, 7.2],
    ] as const) {
      this.palm(u, v, h);
    }
    // Cartel de salida de emergencia sobre el ochavo.
    this.box(m.exitSign, 0.2, -8.2, 0.05, 0.22, 0.45, 2.45);
    // Poste de los carteles de calle (Laprida y Miguel Cané) y del punto de
    // encuentro; las chapas las pinta SchoolIdentity.
    this.cyl(m.metalDark, -6.3, 3.3, 0.07, 3.35, 0);
    this.cyl(m.metalDark, MEETING_POINT[0], MEETING_POINT[1] - 0.02, 0.06, 2.35, 0);

    // Remate en zigzag de la fachada sobre Laprida: el perfil "de sierra" de
    // chapa que se ve en todas las tomas de la calle. Cada diente es una caja
    // girada 45°: media queda dentro del pretil y asoma el triángulo.
    const top = SCHOOL.upperTop + 0.55;
    for (const [u0, u1] of [
      [U.w + 0.3, U.east1 - 0.2],
      [U.salonW + 0.3, U.gymW - 0.3],
    ] as const) {
      for (let u = u0; u <= u1; u += 0.9) {
        const p = toWorld(this.f, u, 0.05);
        this.farm.add('box', m.slab, new Vector3(p.x, top, p.z), new Vector3(0.6, 0.6, 0.12), 0, 0, Math.PI / 4);
      }
    }
  }

  private palm(u: number, v: number, h: number): void {
    const trunk = this.mats.surface(PALETTE.barkLight, 0.95, 0, 'timber');
    this.cyl(trunk, u, v, 0.34, h * 0.55, 0);
    this.cyl(trunk, u, v, 0.26, h * 0.45, h * 0.55);
    const frond = this.mats.foliage(PALETTE.leafMid);
    const p = toWorld(this.f, u, v);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + this.rng.range(-0.15, 0.15);
      const len = this.rng.range(2.1, 2.7);
      const droop = this.rng.range(0.35, 0.6);
      const cx = p.x + Math.sin(a) * len * 0.45;
      const cz = p.z + Math.cos(a) * len * 0.45;
      // Hoja: caja chata girada hacia afuera y caída en la punta.
      this.farm.add('box', frond, new Vector3(cx, h - 0.25, cz), new Vector3(0.45, 0.05, len), a, droop);
    }
  }

  private fences(): void {
    const m = this.m;
    for (const [a, b] of FENCES) {
      this.piece(m.stone, a, b, 0.3, 0, 0.45);
      this.piece(m.bars, a, b, 0.06, 1.95, 2.02);
      this.piece(m.bars, a, b, 0.05, 0.95, 1.0);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const du = (b[0] - a[0]) / len;
      const dv = (b[1] - a[1]) / len;
      const n = Math.floor(len / 0.16);
      for (let k = 0; k <= n; k++) {
        const d = (k * len) / n;
        const p: P = [a[0] + du * d, a[1] + dv * d];
        const q: P = [p[0] + du * 0.025, p[1] + dv * 0.025];
        this.piece(m.bars, p, q, 0.025, 0.45, 2.02);
      }
    }
  }

  /** Postes y cableado aéreo sobre la vereda de Laprida, como en las fotos. */
  private utilityLines(): void {
    const m = this.m;
    const poleV = SCHOOL.front + 3.2;
    const poles = [-4, 20, 44, 66];
    for (const u of poles) {
      this.cyl(m.metalDark, u, poleV, 0.2, 9.6, 0);
      this.box(m.metalDark, u, poleV, 1.4, 0.1, 0.1, 8.5);
    }
    for (let i = 0; i < poles.length - 1; i++) {
      const u0 = poles[i];
      const u1 = poles[i + 1];
      for (const [y, off] of [
        [8.9, 0],
        [8.45, 0.4],
        [8.45, -0.4],
      ] as const) {
        const segs = 8;
        for (let k = 0; k < segs; k++) {
          const t = (k + 0.5) / segs;
          const sag = 0.35 * (1 - Math.pow(2 * t - 1, 2));
          this.box(m.bars, u0 + (u1 - u0) * t + off, poleV, (u1 - u0) / segs + 0.03, 0.025, 0.025, y - sag);
        }
      }
    }
  }
}
