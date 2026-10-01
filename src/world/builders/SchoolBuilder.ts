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
import { PrismBatch, offsetPolygon, polygonArea, subtractRects } from './PrismBatch';
import {
  APEX,
  FENCES,
  LANDINGS,
  LEVEL_Y,
  MEETING_POINT,
  FRONT_PLANTERS,
  ITEMS,
  MC_COS,
  ROOFS,
  ROOMS,
  SCHOOL,
  STAIRS,
  SALON_COLUMNS,
  makerWallAt,
  GYM_MID,
  GYM_PILASTERS,
  U,
  UPPER,
  V,
  WALLS,
  inLot,
  inPoly,
  miguelCaneU,
  rearV,
  roomAt,
  roomLevel,
  toWorld,
  voidsAt,
  volumeTop,
  type Item,
  type Level,
  type Opening,
  type OpeningType,
  type P,
  type Room,
  type SchoolFrame,
  type Stair,
  type Volume,
  type Wall,
} from '../SchoolLayout';

const hex = (h: string) => Color3.FromHexString(h);

/** Dirección local (Δu, Δv) hacia la que mira un frente. */
function faceDir(face: Item['face']): [number, number] {
  return face === 'n' ? [0, -1] : face === 's' ? [0, 1] : face === 'e' ? [1, 0] : [-1, 0];
}

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
  band: [1.95, 2.75],
  counter: [0.95, 2.05],
};

/** Guarda roja de pasillos y patios: de 1,16 a 1,24 m sobre el piso. */
const STRIPE: readonly [number, number] = [1.16, 1.24];

/** Antepecho y dintel de un vano, con la altura propia si la tiene. */
function holeOf(o: Opening, wallH: number): [number, number] {
  const [hb, ht] = HOLE[o.type];
  return [o.hb ?? hb, Math.min(o.ht ?? ht, wallH - 0.15)];
}

/**
 * Terminaciones de cada ambiente, tal como se ven en el recorrido de 2020.
 * Las claves de material son las de `SchoolBuilder.m`.
 */
interface RoomStyle {
  /** Material de las paredes (por defecto, blanco). */
  wall?: string;
  /** Zócalo: material y alto desde el piso. */
  wainscot?: readonly [string, number];
  /** Guarda roja a la altura de la mano (por defecto en paredes blancas sin zócalo). */
  stripe?: boolean;
  /** Material del cielorraso; `null` deja la losa a la vista. */
  ceiling?: string | null;
  /** Luminarias: tubos (por defecto), paneles LED, campanas colgantes o ninguna. */
  lights?: 'tube' | 'panel' | 'dome' | 'none';
  /** Cortinas de las ventanas a la calle (por defecto, azules). */
  curtain?: string;
}

const STYLES: Readonly<Record<string, RoomStyle>> = {
  // Aulas de primaria: zócalo de madera hasta la altura del pupitre.
  // Aulas: zócalo de madera de 1,05 m (al ras del antepecho). Las del frente
  // (las que se ven sin chicos) tienen la pared en un celeste agua muy claro.
  aula1: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula2: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula3: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula4: { wall: 'aqua', wainscot: ['woodIn', 1.05], stripe: false, curtain: 'sky' },
  aula5: { wall: 'aqua', wainscot: ['woodIn', 1.05], stripe: false, curtain: 'sky' },
  aula6: { wainscot: ['woodIn', 1.05], stripe: false },
  dirPrim: { wainscot: ['woodIn', 1.0], stripe: false },
  prof: { stripe: false },
  recepcionOf: { stripe: false },
  // Administración y su hall: revoque gris texturado hasta 2,4 m, bloque de
  // hormigón a la vista arriba, cielorraso de placas.
  adm: { wall: 'block', wainscot: ['render', 2.4], stripe: false, ceiling: 'panels', lights: 'panel' },
  hallAdm: { wall: 'block', wainscot: ['render', 2.4], stripe: false, ceiling: 'panels', lights: 'panel' },
  wcAdm: { wall: 'ceramic', stripe: false, ceiling: 'panels' },
  pasilloMaker: { wall: 'block', stripe: false, ceiling: 'panels', lights: 'panel' },
  // Aula Maker: paredes blancas con vinilos, cielorraso de placas y paneles LED.
  tecnologia: { stripe: false, ceiling: 'panels', lights: 'panel' },
  // Hall de recepción: zócalo de cerámico símil mármol de 1,40 m y campanas
  // blancas colgadas.
  hall: { wainscot: ['marble', 1.4], stripe: false, lights: 'dome' },
  // Cantina y comedor: retícula de listones de madera; las luces son las
  // campanas negras del riel (equipamiento).
  buffet: { stripe: false, ceiling: 'lattice', lights: 'none' },
  // Aula de danzas: tablas de madera con vigas negras.
  salon: { stripe: false, ceiling: 'woodIn' },
  // Polideportivo: laterales blancos; los testeros llevan su terminación
  // propia (bloque al oeste, gris al este) en los datos del muro.
  gimnasio: { stripe: false },
  jardin: { wall: 'yellow', stripe: false },
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
  /** Piso del nivel del objeto que se está armando (ver `item`). */
  private fy: number = FY;

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
      stripe: i('#b81e24', null, 0.2),
      ceiling: i('#f4f4f0', null, 0.3),
      // Granito gris de hall, pasillos y aulas; parquet del aula de danzas;
      // damero del comedor y cerámico claro de los sectores nuevos.
      // Granito reconstituido gris de 30 × 30 (pasillos, aulas, ala oeste).
      tile: i('#a6a59f', 'granite'),
      // Piso del hall: claro y pulido, con bandas oscuras.
      hallStone: i('#c4bdb5', 'pavement'),
      terracotta: i('#9a5a2e', 'ceramic'),
      aqua: i('#dce6e4'),
      marble: i('#cbc1b6', 'marble', 0.2),
      render: i('#8a857e', 'concrete', 0.16),
      wood: i('#c08a55', 'parquet'),
      checker: i('#ffffff', 'checker', 0.16),
      ceramic: i('#e6dfd3', 'ceramic'),
      rubber: i('#3b3e43', null, 0.12),
      lattice: i('#b8875a', 'lattice', 0.2),
      panels: i('#f3f3ef', 'panels', 0.3),
      // Madera de interior (zócalos de las aulas y tablas del cielorraso del
      // aula de danzas), con la luz rebotada de los interiores.
      woodIn: i('#c9a073', 'timber', 0.22),
      // Bloque de hormigón a la vista (polideportivo, aula de danzas, Adm.).
      block: i('#a5a49f', 'block', 0.16),
      // Cortinas: celestes en las aulas del frente, violetas en las demás.
      sky: s('#2fa8d8', 0.9),
      violet: s('#5a4590', 0.9),
      // Tapas de pupitre y sillas verde salvia de las aulas de primaria.
      sage: s('#b9bd9a', 0.7),
      orange: s('#e8822a', 0.6),
      lime: s('#a6c23a', 0.6),
      chalk: s('#26322d', 0.85),
      gymFloor: i('#bdb9ae', 'pavement'),
      // Vinílico del Aula Maker: verde salvia y azul acero.
      green: i('#4f8a5f'),
      steel: i('#4d6b85'),
      gymWall: i('#8e9296'),
      yellow: i('#e9c23c'),

      // Carpintería, herrería y mobiliario.
      glass: mats.glass(hex('#a9c3cf'), 0.26),
      glassDark: mats.glass(PALETTE.glassBlue, 0.9),
      frame: s('#e6e8e8', 0.45, 0.15),
      red: s('#b81e24', 0.6),
      // Azul francia: sillas, canteros, protecciones y gráficas del recorrido.
      blue: s('#1d4fb0', 0.6),
      navy: s('#243b67', 0.65),
      metalDark: s('#2c2f35', 0.5, 0.25, 'metal'),
      metal: mats.metal(PALETTE.solarFrame, 0.4),
      timber: s('#c99a62', 0.8, 0, 'timber'),
      timberDark: s('#7b5236', 0.8, 0, 'timber'),
      chairGreen: s('#2f7a5c', 0.6),
      board: i('#f6f7f6', null, 0.35),
      // Espejo: claro y brillante (no hay reflejo real; se lee por el brillo).
      mirrorGlass: s('#d6e0e4', 0.05, 0.9),
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
      // Colores del recorrido que comparten material con uno cercano.
      charcoal: m.metalDark,
      darkGreen: m.chairGreen,
      darkRed: m.red,
      brick: m.red,
      oak: m.timber,
      pine: m.timber,
      cherry: m.timberDark,
      alu: m.metal,
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
    this.salonBeams();
    this.makerWall();
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
      checker: this.m.checker,
      ceramic: this.m.ceramic,
      rubber: this.m.rubber,
      terracotta: this.m.terracotta,
      hallStone: this.m.hallStone,
    };
    for (const r of ROOMS) {
      const level = roomLevel(r);
      const top = LEVEL_Y[level];
      // Planta baja: contrapiso desde el terreno. Pisos altos: losa de 14 cm
      // (la cara inferior la tapa el cielorraso del ambiente de abajo), sin
      // los huecos de escalera de ese nivel.
      if (level === 0) {
        this.prisms.plan(mat[r.floor], r.poly, 0, top, { bottom: false });
        continue;
      }
      for (const piece of subtractRects(r.poly, voidsAt(level))) {
        this.prisms.plan(mat[r.floor], piece, top - 0.14, top, { bottom: false });
      }
    }
  }

  // =================================================================== muros

  private side(w: Wall, room: Room | null): Side {
    if (w.kind === 'medianera' || !room) {
      return { bands: [[0, w.h, this.m.facade]], stripe: false, exterior: true, room };
    }
    const st = STYLES[room.id] ?? {};
    const mat = this.m[w.finish?.[room.id] ?? st.wall ?? 'white'];
    const stripe = st.stripe ?? (mat === this.m.white && !st.wainscot);
    // Muro alto del gimnasio visto desde un ambiente bajo: por encima del
    // techo vecino ya es fachada.
    const top = w.h > 3.8 && room.id !== 'gimnasio' ? H : w.h;
    const bands: Array<[number, number, Material]> = [];
    if (st.wainscot) {
      const [wm, wh] = st.wainscot;
      bands.push([0, wh, this.m[wm]], [wh, top, mat]);
    } else {
      bands.push([0, top, mat]);
    }
    if (top < w.h) bands.push([top, w.h, this.m.facade]);
    return { bands, stripe, exterior: false, room };
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
    // Base del muro: los de los pisos altos apoyan sobre la losa de su nivel.
    const yb = w.level * H;
    const pos = this.side(w, roomAt(mu + nu * 0.45, mv + nv * 0.45, w.level));
    const neg = this.side(w, roomAt(mu - nu * 0.45, mv - nv * 0.45, w.level));
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

    // Tramos: el muro se corta en cada borde de vano; en cada tramo quedan
    // los vanos que lo cubren (pueden ser varios, a distinta altura).
    const cuts = [0, len];
    for (const o of w.openings) cuts.push(o.t0, o.t1);
    cuts.sort((x, y) => x - y);
    const spans: Array<{ t0: number; t1: number; holes: Array<[number, number]> }> = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k];
      const t1 = cuts[k + 1];
      if (t1 - t0 < 0.005) continue;
      const mid = (t0 + t1) / 2;
      const holes = w.openings
        .filter((o) => o.t0 <= mid && o.t1 >= mid)
        .map((o) => holeOf(o, w.h))
        .sort((x, y) => x[0] - y[0]);
      spans.push({ t0, t1, holes });
    }

    for (const L of layers) {
      for (const [y0, y1, mat] of L.side.bands) {
        for (const s of spans) {
          const a = at(s.t0);
          const b = at(s.t1);
          // Lleno entre vanos, dentro de la franja [y0, y1].
          let y = y0;
          for (const [hb, ht] of s.holes) {
            if (hb > y + 0.005) this.piece(mat, a, b, L.t, yb + y, yb + Math.min(y1, hb), L.off);
            y = Math.max(y, ht);
            if (y >= y1) break;
          }
          if (y < y1 - 0.005) this.piece(mat, a, b, L.t, yb + y, yb + y1, L.off);
        }
      }
      // Guarda roja fina a 1,20 m (centro), como en todos los pasillos del
      // recorrido: corre por los antepechos y se corta en las puertas.
      if (L.side.stripe) {
        for (const s of spans) {
          if (s.holes.some(([hb, ht]) => hb < STRIPE[1] && ht > STRIPE[0])) continue;
          this.piece(this.m.stripe, at(s.t0), at(s.t1), L.t + 0.02, yb + STRIPE[0], yb + STRIPE[1], L.off);
        }
      }
    }

    const extSign = pos.exterior && !neg.exterior ? 1 : neg.exterior && !pos.exterior ? -1 : 0;
    for (const o of w.openings) {
      this.opening(w, o, at(o.t0), at(o.t1), o.t1 - o.t0, t, [nu, nv], extSign, pos.room, neg.room);
    }
  }

  /** Carpintería y herrería de un vano. */
  private opening(
    w: Wall,
    o: Opening,
    a: P,
    b: P,
    len: number,
    t: number,
    n: P,
    extSign: number,
    roomPos: Room | null,
    roomNeg: Room | null,
  ): void {
    const type = o.type;
    const yb = w.level * H;
    const [hb0, ht0] = holeOf(o, w.h);
    const hb = yb + hb0;
    const ht = yb + ht0;
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const along = (d: number): P => [a[0] + du * d, a[1] + dv * d];
    const m = this.m;

    if (type === 'window' || type === 'high' || type === 'band') {
      const fm = (o.color && m[o.color]) || m.frame;
      this.piece(m.glass, along(0.03), along(len - 0.03), 0.02, hb + 0.03, ht - 0.03);
      this.piece(fm, a, b, 0.1, hb, hb + 0.06);
      this.piece(fm, a, b, 0.1, ht - 0.06, ht);
      this.piece(fm, a, along(0.06), 0.1, hb, ht);
      this.piece(fm, along(len - 0.06), b, 0.1, hb, ht);
      this.piece(fm, along(len / 2 - 0.025), along(len / 2 + 0.025), 0.08, hb, ht);
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
      // Cortinas en aulas y en el jardín: celestes, violetas o azules según
      // el aula (recorrido 0:48-1:10 y fachada).
      const inner = extSign !== 0 ? (extSign > 0 ? roomNeg : roomPos) : null;
      if (type === 'window' && inner && (inner.id.startsWith('aula') || inner.id === 'jardin')) {
        const off = -extSign * (t / 2 + 0.06);
        const cm = m[STYLES[inner.id]?.curtain ?? 'curtainBlue'];
        // Barral negro, cenefa y paños a los costados.
        this.piece(m.metalDark, along(-0.3), along(len + 0.3), 0.03, ht + 0.28, ht + 0.31, off);
        this.piece(cm, along(-0.2), along(len + 0.2), 0.05, ht + 0.02, ht + 0.28, off);
        this.piece(cm, along(-0.3), along(0.18), 0.06, hb - 0.05, ht + 0.02, off);
        this.piece(cm, along(len - 0.18), along(len + 0.3), 0.06, hb - 0.05, ht + 0.02, off);
      }
      return;
    }

    if (type === 'counter') {
      this.piece(m.timber, a, b, t + 0.36, hb - 0.05, hb);
      return;
    }
    if (type === 'pass') return;

    // Puertas: marco rojo (o el de su color) y hojas abiertas contra el muro.
    const own = o.color ? m[o.color] : undefined;
    const frameMat = type === 'exit' ? m.metalDark : own === m.frame || own === m.timberDark ? own : m.red;
    this.piece(frameMat, a, along(0.07), t + 0.05, yb, ht);
    this.piece(frameMat, along(len - 0.07), b, t + 0.05, yb, ht);
    this.piece(frameMat, a, b, t + 0.05, ht, ht + 0.08);

    // Las hojas abren hacia el ambiente (no hacia el pasillo); las de
    // emergencia, hacia la calle.
    const isHall = (r: Room | null) => !r || r.name === 'Pasillo' || !r.roofed;
    let s = !isHall(roomPos) ? 1 : !isHall(roomNeg) ? -1 : 1;
    if (type === 'exit' && extSign !== 0) s = extSign;
    const leafMat = own ?? (type === 'exit' ? m.frame : type === 'entrance' ? m.glass : m.leaf);
    const hinges = type === 'door' ? [0.08] : [0.08, len - 0.08];
    const leafW = type === 'door' ? len - 0.16 : (len - 0.16) / 2;
    for (const h of hinges) {
      const p = along(h);
      const q0: P = [p[0] + n[0] * s * (t / 2 + 0.02), p[1] + n[1] * s * (t / 2 + 0.02)];
      const q1: P = [q0[0] + n[0] * s * leafW, q0[1] + n[1] * s * leafW];
      if (type === 'entrance' || type === 'exit' || !own) {
        this.piece(leafMat, q0, q1, 0.045, yb + 0.03, ht - 0.04);
      } else {
        // Hoja con vidrio: tablero abajo (hasta 0,9 m), vidrio arriba en su marco.
        this.piece(leafMat, q0, q1, 0.045, yb + 0.03, yb + 0.9);
        this.piece(m.glass, q0, q1, 0.02, yb + 0.9, ht - 0.12);
        this.piece(leafMat, q0, q1, 0.05, ht - 0.12, ht - 0.04);
        const qa: P = [q0[0] + (q1[0] - q0[0]) * 0.06, q0[1] + (q1[1] - q0[1]) * 0.06];
        const qb: P = [q1[0] - (q1[0] - q0[0]) * 0.06, q1[1] - (q1[1] - q0[1]) * 0.06];
        this.piece(leafMat, q0, qa, 0.05, yb + 0.9, ht - 0.12);
        this.piece(leafMat, qb, q1, 0.05, yb + 0.9, ht - 0.12);
      }
      if (type === 'entrance') {
        for (const y of [yb + 0.03, ht - 0.12]) this.piece(m.red, q0, q1, 0.06, y, y + 0.1);
      }
      if (type === 'exit') {
        // Barra antipánico roja a 0,98 m.
        const mid: P = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2];
        const e: P = [q1[0] - (q1[0] - q0[0]) * 0.1, q1[1] - (q1[1] - q0[1]) * 0.1];
        this.piece(m.red, mid, e, 0.12, yb + 0.95, yb + 1.01);
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
      const kind = STYLES[r.id]?.ceiling;
      if (kind === null) continue;
      const level = roomLevel(r);
      const y = LEVEL_Y[level] + 3.1;
      // Por donde sube una escalera al nivel de arriba, el cielorraso se abre.
      const above = level < 2 ? voidsAt((level + 1) as 1 | 2) : [];
      const pieces = subtractRects(r.poly, above);
      // Canto visible sólo alrededor de un hueco; contra los muros no se ve.
      const sides = pieces.length > 1;
      for (const piece of pieces) {
        this.prisms.plan(this.m[kind ?? 'ceiling'], piece, y, y + 0.06, { top: false, sides });
      }
    }
  }

  /**
   * Plantas altas: cornisa en cada losa, azotea con pretil y, donde ese nivel
   * todavía no tiene ambientes, un cerramiento con ventanas. Se decide arista
   * por arista: donde adentro hay un ambiente de ese nivel, sus muros reales
   * (con sus vanos) hacen de fachada.
   */
  private upperFloors(): void {
    for (const vol of UPPER) {
      const poly = vol.poly;
      const top = volumeTop(vol);
      const body = offsetPolygon(poly, 0.15);
      const inward = polygonArea(poly) > 0 ? 1 : -1;
      for (let level = 1; level <= vol.floors; level++) {
        const y0 = level * H;
        // Cornisa entre plantas. Arranca en la losa (no debajo): si bajara
        // del cielorraso, su cara inferior taparía el techo de abajo. Es un
        // anillo, no una tapa: adentro está el piso de arriba.
        this.ring(this.m.facade, poly, 0.15, 0.34, y0, y0 + 0.22);
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.05) continue;
          const du = (b[0] - a[0]) / len;
          const dv = (b[1] - a[1]) / len;
          // Normal hacia adentro del volumen.
          const iu = -dv * inward;
          const iv = du * inward;
          const mid: P = [(a[0] + b[0]) / 2 + iu * 0.5, (a[1] + b[1]) / 2 + iv * 0.5];
          if (roomAt(mid[0], mid[1], level as Level)) continue;
          const e = 0.15 / len;
          const a2: P = [a[0] - (b[0] - a[0]) * e, a[1] - (b[1] - a[1]) * e];
          const b2: P = [b[0] + (b[0] - a[0]) * e, b[1] + (b[1] - a[1]) * e];
          this.piece(this.m.facade, a2, b2, SCHOOL.extT, y0, y0 + H);
          this.upperWindows(vol, a, b, level as Level);
        }
      }
      this.prisms.plan(this.m.roof, body, top, top + 0.04, { bottom: false, sides: false });
      this.parapet(body, top, 0.55);
    }
  }

  /** Anillo alrededor de un polígono, entre los desplazamientos `d0` y `d1` hacia afuera. */
  private ring(mat: Material, poly: readonly P[], d0: number, d1: number, y0: number, y1: number): void {
    const t = d1 - d0;
    const path = offsetPolygon(poly, (d0 + d1) / 2);
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      // Se estira medio espesor en cada punta para cerrar las esquinas.
      const e = t / 2 / len;
      const a2: P = [a[0] - (b[0] - a[0]) * e, a[1] - (b[1] - a[1]) * e];
      const b2: P = [b[0] + (b[0] - a[0]) * e, b[1] + (b[1] - a[1]) * e];
      this.piece(mat, a2, b2, t, y0, y1);
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

  /** Ventanas genéricas sobre una arista de un volumen sin ambientes en ese nivel. */
  private upperWindows(vol: Volume, a: P, b: P, level: Level): void {
    const inward = polygonArea(vol.poly) > 0 ? 1 : -1;
    const spacing = 3.25;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.floor((len - 0.8) / spacing);
    if (count < 1) return;
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const ou = inward * dv; // normal exterior
    const ov = -inward * du;
    const start = (len - (count - 1) * spacing) / 2;
    for (let k = 0; k < count; k++) {
      const d = start + k * spacing;
      const c: P = [a[0] + du * d, a[1] + dv * d];
      const probe: P = [c[0] + ou * 0.9, c[1] + ov * 0.9];
      // No se abren ventanas contra otro volumen igual de alto ni contra el gimnasio.
      if (UPPER.some((p) => p !== vol && p.floors >= level && inPoly(p.poly, probe[0], probe[1]))) continue;
      if (roomAt(probe[0], probe[1])?.id === 'gimnasio') continue;
      // El portal del acceso lleva su propia composición.
      if (Math.abs(c[1]) < 0.05 && c[0] > 32.4 && c[0] < 42.4) continue;
      const street = !inLot(probe[0], probe[1]);
      this.upperWindow(c, [du, dv], -inward, street, level * H);
    }
  }

  /** Ventana de planta alta sobre la cara del volumen. `side` es el signo de la normal exterior. */
  private upperWindow(c: P, d: P, side: number, street: boolean, base: number): void {
    const m = this.m;
    const hw = 0.78;
    const a: P = [c[0] - d[0] * hw, c[1] - d[1] * hw];
    const b: P = [c[0] + d[0] * hw, c[1] + d[1] * hw];
    const y0 = base + 1.05;
    const y1 = base + 2.35;
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
      this.piece(m.appliance, e, f, 0.4, base + 1.85, base + 2.45, side * 0.35);
      this.piece(m.bars, e, f, 0.02, base + 1.9, base + 2.3, side * 0.56);
    }
  }

  /** Cubiertas de una planta: losa, membrana y pretil. */
  private roofs(): void {
    for (const r of ROOFS) {
      // 8 cm: queda dentro del muro, sin asomar del otro lado (el
      // polideportivo veía la cornisa de Arte y Teatro como un saliente).
      const body = offsetPolygon(r.poly, 0.08);
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
      // Chapa con franjas de policarbonato traslúcido cada tres paños.
      const skylight = i % 3 === 1;
      this.farm.add('box', skylight ? m.light : m.gymRoof, new Vector3(pos.x, arcY(pm), pos.z), new Vector3(uLen, 0.1, w), 0, pm);
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
    // Testero este: dos franjas rojo-blanco-azul a los lados de la bandera,
    // con el azul hacia el centro y más alto (como en el recorrido).
    const face = U.e - SCHOOL.extT / 2 - 0.02;
    for (const side of [-1, 1]) {
      const vc = GYM_MID + side * 4.0;
      const bars: Array<[Material, number]> = [
        [m.red, 5.8],
        [m.slab, 6.3],
        [m.navy, 7.0],
      ];
      bars.forEach(([mat, top], k) => {
        // k = 0 afuera (rojo) … k = 2 adentro (azul).
        const bv = vc - side * (k - 1) * 0.29;
        this.box(mat, face, bv, 0.04, top - 0.1, 0.28, FY + 0.1);
      });
    }
    // Columnas reticuladas blancas sobre cada pilastra, hasta la bóveda.
    for (const u of GYM_PILASTERS) {
      for (const v of [V.gymTop + 0.3, -0.45]) {
        for (const sgn of [-1, 1]) this.box(m.frame, u + sgn * 0.15, v, 0.06, wallTop - 2.75, 0.06, 2.75);
        for (let y = 3.2; y < wallTop; y += 0.9) this.box(m.frame, u, v, 0.3, 0.04, 0.04, y);
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
    // Los tramos que arrancan en planta baja son macizos; los de los pisos
    // altos, una losa escalonada con luz por debajo.
    const solid = s.y0 < 0.5;
    for (let i = 0; i < n; i++) {
      const c = from + run * (i + 0.5);
      const top = FY + s.y0 + ((i + 1) * (s.y1 - s.y0)) / n;
      const bottom = solid ? 0 : top - 0.24;
      if (alongU) this.box(m.stair, c, (s.v0 + s.v1) / 2, Math.abs(run) + 0.01, top - bottom, s.v1 - s.v0, bottom);
      else this.box(m.stair, (s.u0 + s.u1) / 2, c, s.u1 - s.u0, top - bottom, Math.abs(run) + 0.01, bottom);
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

  /**
   * Pared del mural del Aula Maker (la medianera, en diagonal): estante largo
   * sobre ménsulas azules, televisor, mueble bajo con robots y tablero
   * perforado, estantería con cajas negras y el camión a control remoto; y
   * en el testero de Miguel Cané, el pizarrón interactivo entre dos
   * estanterías con cajas celestes (recorrido 2:32-3:20).
   */
  private makerWall(): void {
    const m = this.m;
    const at = (s: number, off = 0): P => makerWallAt(s, off);
    const face = 0.15;
    // Estante a 1,05 m, de punta a punta salvo el tramo del mueble bajo.
    this.piece(m.board, at(0.8), at(9.3), 0.25, FY + 1.03, FY + 1.06, face + 0.125);
    for (let s = 1.2; s < 9.3; s += 1.6) this.piece(m.blue, at(s - 0.02), at(s + 0.02), 0.2, FY + 0.9, FY + 1.03, face + 0.1);
    // Objetos sobre el estante: mapas de madera, robots y cajas.
    for (const [s, mat, h] of [
      [1.9, m.timber, 0.35],
      [2.4, m.metalDark, 0.25],
      [4.5, m.timberDark, 0.3],
      [5.2, m.blue, 0.2],
      [6.9, m.board, 0.25],
      [8.0, m.timber, 0.4],
    ] as const) {
      this.piece(mat, at(s - 0.15), at(s + 0.15), 0.2, FY + 1.06, FY + 1.06 + h, face + 0.125);
    }
    // Televisor de 55" entre las columnas azul marino y roja.
    this.piece(m.metalDark, at(7.1), at(8.3), 0.06, FY + 1.4, FY + 2.1, face + 0.04);
    // Mueble bajo con robots y tablero perforado con herramientas.
    this.piece(m.timber, at(9.5), at(10.7), 0.45, FY, FY + 0.6, face + 0.225);
    this.piece(m.timber, at(9.5), at(10.7), 0.03, FY + 0.6, FY + 2.1, face + 0.03);
    for (const [s, mat] of [
      [9.7, m.red],
      [10.0, m.lime],
      [10.3, m.orange],
      [10.55, m.blue],
    ] as const) {
      this.piece(mat, at(s - 0.06), at(s + 0.06), 0.12, FY + 0.6, FY + 0.78, face + 0.25);
      this.piece(mat, at(s - 0.02), at(s + 0.02), 0.06, FY + 1.6, FY + 1.85, face + 0.07);
    }
    // Estantería alta con ocho cajas negras y el camión amarillo arriba.
    this.piece(m.timber, at(10.8), at(11.6), 0.4, FY, FY + 1.9, face + 0.2);
    for (const y of [0.15, 0.6, 1.05, 1.5]) {
      this.piece(m.metalDark, at(10.85), at(11.55), 0.36, FY + y, FY + y + 0.32, face + 0.22);
    }
    this.piece(m.yellow, at(11.0), at(11.45), 0.3, FY + 1.9, FY + 2.15, face + 0.2);
    // Testero de Miguel Cané: pizarrón interactivo y dos estanterías.
    const mcIn = (v: number, off: number): P => {
      const u = miguelCaneU(v);
      // Normal hacia adentro (este) de la línea de Miguel Cané.
      return [u + off * MC_COS, v + off * 0.6386 * MC_COS];
    };
    this.piece(m.metalDark, mcIn(-33.45, 0.17), mcIn(-34.95, 0.17), 0.05, FY + 0.88, FY + 2.12);
    this.piece(m.board, mcIn(-33.5, 0.2), mcIn(-34.9, 0.2), 0.02, FY + 0.92, FY + 2.08);
    for (const [v0, v1] of [
      [-31.9, -32.6],
      [-35.7, -36.4],
    ] as const) {
      this.piece(m.timber, mcIn(v0, 0.35), mcIn(v1, 0.35), 0.4, FY, FY + 1.8);
      this.piece(m.blue, mcIn(v0, 0.35), mcIn(v1, 0.35), 0.36, FY + 1.8, FY + 2.0);
    }
  }

  /** Vigas negras del aula de danzas, de columna roja a columna roja. */
  private salonBeams(): void {
    for (const v of SALON_COLUMNS) {
      this.box(this.m.metalDark, (U.salonW + U.gymW) / 2, v, U.gymW - U.salonW - 0.2, 0.26, 0.2, FY + 3.1 - 0.26);
    }
  }

  /** Núcleo gris del plano, descanso de la escalera exterior y descanso principal. */
  private cores(): void {
    // Descansos: macizos los bajos, losa los de los pisos altos.
    for (const l of LANDINGS) {
      const top = FY + l.y;
      const bottom = l.y < 3 ? 0 : top - 0.24;
      this.box(this.m.stair, (l.u0 + l.u1) / 2, (l.v0 + l.v1) / 2, l.u1 - l.u0, top - bottom, l.v1 - l.v0, bottom);
    }
    // Tabique entre tramos.
    this.box(this.m.white, 23.2, -27.47, 5.8, 3.2, 0.12, 0);
  }

  // ============================================================ equipamiento

  private item(it: Item): void {
    const m = this.m;
    const { u, v, w, d } = it;
    const level = it.level ?? 0;
    const room = roomAt(u, v, level);
    // Piso del nivel del objeto: todo lo que sigue se apoya en `FY`.
    const FY = LEVEL_Y[level];
    this.fy = FY;
    const alongV = it.face === 'e' || it.face === 'w';
    switch (it.kind) {
      case 'desk': {
        // Tapa (madera o laminado de color) sobre cuatro patas finas y un travesaño.
        this.box(this.mat(it.color, m.timber), u, v, w, 0.04, d, FY + 0.7);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(m.metalDark, u + su * (w / 2 - 0.05), v + sv * (d / 2 - 0.05), 0.035, 0.7, 0.035, FY);
        }
        if (alongV) this.box(m.metalDark, u + w / 2 - 0.05, v, 0.03, 0.03, d - 0.1, FY + 0.25);
        else this.box(m.metalDark, u, v + d / 2 - 0.05, w - 0.1, 0.03, 0.03, FY + 0.25);
        break;
      }
      case 'chair': {
        const mat = room?.id === 'tecnologia' ? m.chairBlue : room?.id === 'teatro' ? m.black : m.chairGreen;
        this.chair(this.mat(it.color, mat), u, v, it.face);
        break;
      }
      case 'table': {
        this.box(this.mat(it.color, m.timber), u, v, w, 0.05, d, FY + 0.72);
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
        const top = this.mat(it.color, it.kind === 'hexTable' ? m.timber : m.blue);
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
        const mat = this.mat(it.color, room?.id === 'jardin' ? m.appliance : m.timberDark);
        this.box(mat, u, v, w, 1.85, d, FY);
        for (const y of [0.5, 0.95, 1.4]) {
          const books = this.rng.pick([m.red, m.navy, m.chairGreen, m.timber]);
          if (alongV) this.box(books, u, v, w + 0.02, 0.28, d - 0.2, FY + y);
          else this.box(books, u, v, w - 0.2, 0.28, d + 0.02, FY + y);
        }
        break;
      }
      case 'counter': {
        const body = this.mat(it.color, room?.id === 'buffet' ? m.black : m.appliance);
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
        this.box(this.mat(it.color, m.blue), u, v, w, 0.6, d, FY);
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
        const mat = this.mat(it.color, room?.id === 'buffet' ? m.timberDark : m.red);
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
      case 'mirror': {
        this.box(it.color ? m.mirrorGlass : m.mirror, u, v, w, 1.9, d, FY + 0.25);
        if (it.color) {
          // Marco de color (rojo en el aula de danzas).
          const fm = this.m[it.color];
          const len = alongV ? d : w;
          for (const sgn of [-1, 1]) {
            if (alongV) this.box(fm, u, v + (sgn * len) / 2, w + 0.03, 1.98, 0.06, FY + 0.21);
            else this.box(fm, u + (sgn * len) / 2, v, 0.06, 1.98, d + 0.03, FY + 0.21);
          }
          for (const y of [FY + 0.21, FY + 2.15]) {
            this.box(fm, u, v, alongV ? w + 0.03 : len + 0.06, 0.06, alongV ? len + 0.06 : d + 0.03, y);
          }
        }
        break;
      }
      case 'barre': {
        // Barra de ballet: pasamano a 1 m sobre parantes cada ~2 m.
        const rail = this.mat(it.color, m.timber);
        const len = alongV ? d : w;
        this.box(rail, u, v, alongV ? 0.05 : len, 0.05, alongV ? len : 0.05, FY + 1.0);
        const n = Math.max(1, Math.round(len / 2));
        for (let k = 0; k <= n; k++) {
          const t = k / n - 0.5;
          this.box(m.metalDark, u + (alongV ? 0 : t * len), v + (alongV ? t * len : 0), 0.04, 1.02, 0.04, FY);
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
        // Arco de handball rojo: postes y travesaño en el frente, red blanca
        // (malla de hilos) atrás, a los costados y arriba.
        const [fu, fv] = faceDir(it.face);
        const width = alongV ? d : w;
        const depth = alongV ? w : d;
        const pu = u + fu * depth * 0.45;
        const pv = v + fv * depth * 0.45;
        const bu = u - fu * depth * 0.45;
        const bv = v - fv * depth * 0.45;
        const across = (c: number) => (alongV ? [0, c] : [c, 0]);
        for (const sgn of [-1, 1]) {
          const [du, dv] = across((sgn * width) / 2);
          this.box(m.red, pu + du, pv + dv, 0.08, 2.0, 0.08, FY);
        }
        this.box(m.red, pu, pv, alongV ? 0.08 : width + 0.08, 0.08, alongV ? width + 0.08 : 0.08, FY + 2.0);
        // Malla: hilos verticales y horizontales.
        for (let k = 0; k <= 8; k++) {
          const [du, dv] = across((k / 8 - 0.5) * width);
          this.box(m.board, bu + du, bv + dv, 0.015, 2.0, 0.015, FY);
        }
        for (let k = 1; k <= 4; k++) {
          this.box(m.board, bu, bv, alongV ? 0.015 : width, 0.015, alongV ? width : 0.015, FY + k * 0.5 - 0.05);
        }
        for (const sgn of [-1, 1]) {
          const [du, dv] = across((sgn * width) / 2);
          for (let k = 1; k <= 3; k++) {
            this.box(m.board, u + du, v + dv, alongV ? depth * 0.9 : 0.015, 0.015, alongV ? 0.015 : depth * 0.9, FY + k * 0.62);
          }
        }
        break;
      }
      case 'bleachers': {
        // Tribuna de caño negro: tres gradas que suben hacia el muro, con
        // estructura a la vista (no son macizas) y asientos de chapa.
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        const span = alongV ? d : w;
        for (let k = 0; k < 3; k++) {
          const off = (k - 1) * (depth / 3);
          const cu = u - fu * off;
          const cv = v - fv * off;
          const top = FY + 0.42 * (k + 1);
          this.box(m.metalDark, cu, cv, alongV ? depth / 3 : span, 0.04, alongV ? span : depth / 3, top - 0.04);
          // Patas y riostras.
          for (const sgn of [-1, 1]) {
            const pu = cu + (alongV ? 0 : (sgn * span) / 2);
            const pv = cv + (alongV ? (sgn * span) / 2 : 0);
            this.box(m.metalDark, pu, pv, 0.05, top - FY, 0.05, FY);
          }
        }
        // Baranda del fondo.
        const ru = u - fu * (depth / 2);
        const rv = v - fv * (depth / 2);
        this.box(m.metalDark, ru, rv, alongV ? 0.05 : span, 0.05, alongV ? span : 0.05, FY + 2.2);
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
        // Cabina de recepción (0:18-0:28): frente rojo hasta 1,02 m, mostrador
        // blanco, vidrio en marcos de aluminio blanco hasta 2,4 m y techo.
        // Dos caras a la vista: la que mira a `face` y la del norte (−v).
        const [fu, fv] = faceDir(it.face);
        const faces: Array<[number, number, number, boolean]> = [
          [u + fu * (w / 2), v + fv * (d / 2), alongV ? d : w, alongV],
          [u, v - d / 2, w, false],
        ];
        for (const [cu, cv, len, onV] of faces) {
          const bw = onV ? 0.06 : len;
          const bd = onV ? len : 0.06;
          this.box(m.red, cu, cv, bw, 1.02, bd, FY);
          this.box(m.board, cu, cv, onV ? 0.3 : len + 0.04, 0.04, onV ? len + 0.04 : 0.3, FY + 1.02);
          this.box(m.glass, cu, cv, onV ? 0.02 : len, 1.3, onV ? len : 0.02, FY + 1.06);
          const n = Math.max(1, Math.round(len / 1.0));
          for (let k = 0; k <= n; k++) {
            const t = k / n - 0.5;
            this.box(m.frame, cu + (onV ? 0 : t * len), cv + (onV ? t * len : 0), 0.05, 1.34, 0.05, FY + 1.06);
          }
          this.box(m.frame, cu, cv, onV ? 0.08 : len, 0.06, onV ? len : 0.08, FY + 2.36);
        }
        this.box(m.board, u, v, w, 0.06, d, FY + 2.42);
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
        if (alongV) this.box(m.metalDark, u, v, 0.25, 0.08, w, FY);
        else this.box(m.metalDark, u, v, w, 0.08, 0.25, FY);
        this.box(m.metalDark, u, v, 0.03, 2.2, 0.03, FY);
        break;
      }
      case 'lockers': {
        this.box(m.navy, u, v, w, 1.8, d, FY);
        for (let k = 1; k < 4; k++) this.box(m.bars, u - w / 2 + (k * w) / 4, v, 0.02, 1.7, d + 0.02, FY + 0.05);
        break;
      }
      // ------------------------------------------------ recorrido 2020
      case 'extinguisher': {
        const y = FY + (it.y ?? 0.95);
        this.cyl(m.red, u, v, 0.17, 0.52, y);
        this.box(m.metalDark, u, v, 0.08, 0.12, 0.08, y + 0.52);
        break;
      }
      case 'fan': {
        // Ventilador de pared: soporte, motor y rejilla circular.
        const y = FY + (it.y ?? 2.35);
        const [nu, nv] = faceDir(it.face);
        this.box(m.frame, u - nu * 0.05, v - nv * 0.05, 0.08, 0.2, 0.08, y - 0.1);
        this.box(m.frame, u + nu * 0.12, v + nv * 0.12, alongV ? 0.08 : 0.46, 0.46, alongV ? 0.46 : 0.08, y - 0.02);
        break;
      }
      case 'ac': {
        const y = FY + (it.y ?? 2.45);
        this.box(m.frame, u, v, alongV ? 0.22 : 0.86, 0.29, alongV ? 0.86 : 0.22, y);
        break;
      }
      case 'projector': {
        const top = FY + (it.y ?? 3.0);
        this.box(m.frame, u, v, 0.05, 0.4, 0.05, top - 0.4);
        this.box(m.frame, u, v, 0.36, 0.12, 0.3, top - 0.52);
        break;
      }
      case 'speaker':
        this.box(m.metalDark, u, v, alongV ? 0.22 : 0.26, 0.38, alongV ? 0.26 : 0.22, FY + (it.y ?? 2.5));
        break;
      case 'tv':
        this.box(m.metalDark, u, v, alongV ? 0.06 : w, it.h ?? 0.62, alongV ? w : 0.06, FY + (it.y ?? 1.5));
        break;
      case 'blackboard': {
        const [bw, bd] = alongV ? [0.04, d] : [w, 0.04];
        this.box(m.frame, u, v, alongV ? 0.05 : w + 0.08, (it.h ?? 1.2) + 0.08, alongV ? d + 0.08 : 0.05, FY + (it.y ?? 0.9) - 0.04);
        this.box(this.mat(it.color, m.chalk), u, v, bw + 0.01, it.h ?? 1.2, bd + 0.01, FY + (it.y ?? 0.9));
        break;
      }
      case 'roundColumn':
        this.cyl(this.mat(it.color, m.red), u, v, w, it.h ?? 3.1, FY);
        break;
      case 'paddedColumn': {
        // Columna con protección acolchada hasta 2 m (como la verde del hall).
        const top = it.h ?? 3.1;
        this.box(m.white, u, v, w * 0.8, top, d * 0.8, FY);
        this.box(this.mat(it.color, m.chairGreen), u, v, w, 2.0, d, FY + 0.05);
        break;
      }
      case 'workbench': {
        const legs = this.mat(it.color, m.blue);
        this.box(m.timber, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(legs, u + su * (w / 2 - 0.06), v + sv * (d / 2 - 0.06), 0.05, 0.74, 0.05, FY);
        }
        if (w >= d) this.box(legs, u, v, w - 0.12, 0.04, 0.04, FY + 0.3);
        else this.box(legs, u, v, 0.04, 0.04, d - 0.12, FY + 0.3);
        break;
      }
      case 'benchSeat': {
        const legs = this.mat(it.color, m.blue);
        this.box(m.timber, u, v, w, 0.04, d, FY + 0.44);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(legs, u + s * (w / 2 - 0.1), v, 0.05, 0.44, d - 0.05, FY);
          else this.box(legs, u, v + s * (d / 2 - 0.1), w - 0.05, 0.44, 0.05, FY);
        }
        break;
      }
      case 'stool': {
        const mat = this.mat(it.color, m.metalDark);
        this.box(mat, u, v, 0.34, 0.04, 0.34, FY + 0.72);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(mat, u + su * 0.13, v + sv * 0.13, 0.03, 0.72, 0.03, FY);
        }
        break;
      }
      case 'pegboard': {
        this.box(m.timber, u, v, alongV ? 0.03 : w, it.h ?? 1.0, alongV ? w : 0.03, FY + (it.y ?? 1.0));
        const [nu, nv] = faceDir(it.face);
        for (let k = 0; k < 4; k++) {
          const t = (k + 0.5) / 4 - 0.5;
          const tool = [m.red, m.orange, m.lime, m.blue][k];
          this.box(tool, u + (alongV ? nu * 0.04 : t * w * 0.8), v + (alongV ? t * w * 0.8 : nv * 0.04), 0.06, 0.18, 0.06, FY + (it.y ?? 1.0) + 0.55);
        }
        break;
      }
      case 'cabinet': {
        // Mueble alto de melamina clara con estantes y cajas.
        const hgt = it.h ?? 1.9;
        this.box(m.timber, u, v, w, hgt, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 5; k++) {
          const y = FY + (k * hgt) / 5;
          const box = k % 2 === 0 ? m.blue : m.metalDark;
          this.box(box, u + nu * 0.02, v + nv * 0.02, alongV ? d * 0.9 : w * 0.85, 0.22, alongV ? w * 0.85 : d * 0.9, y - 0.25);
        }
        break;
      }
      case 'laserCutter':
        this.box(m.blue, u, v, w, 0.26, d, FY + 0.76);
        this.box(m.board, u, v, w * 0.96, 0.08, d * 0.96, FY + 1.02);
        this.box(m.metalDark, u, v, w * 0.5, 0.01, d * 0.5, FY + 1.1);
        break;
      case 'printer3d':
        this.box(m.metalDark, u, v, w, w, d, FY + 0.76);
        this.box(m.blue, u, v, w * 1.02, 0.06, d * 1.02, FY + 0.76);
        break;
      case 'buffetLine': {
        // Mostrador de acero inoxidable con mampara de vidrio.
        this.box(m.metal, u, v, w, 0.9, d, FY);
        this.box(m.metal, u, v, w + 0.04, 0.04, d + 0.04, FY + 0.9);
        if (alongV) this.box(m.glass, u, v, 0.02, 0.45, d - 0.1, FY + 1.25);
        else this.box(m.glass, u, v, w - 0.1, 0.45, 0.02, FY + 1.25);
        for (const s of [-1, 1]) {
          if (alongV) this.box(m.metal, u, v + s * (d / 2 - 0.05), 0.03, 0.4, 0.03, FY + 0.94);
          else this.box(m.metal, u + s * (w / 2 - 0.05), v, 0.03, 0.4, 0.03, FY + 0.94);
        }
        break;
      }
      case 'displayCase':
        this.box(m.metal, u, v, w, 0.85, d, FY);
        this.box(m.glass, u, v, w * 0.96, 0.42, d * 0.9, FY + 0.85);
        this.box(m.metal, u, v, w, 0.03, d, FY + 1.27);
        break;
      case 'fridgeGlass': {
        this.box(m.metalDark, u, v, w, 2.0, d, FY);
        const [nu, nv] = faceDir(it.face);
        this.box(m.glass, u + nu * (d / 2 + 0.01), v + nv * (d / 2 + 0.01), alongV ? 0.02 : w - 0.1, 1.7, alongV ? w - 0.1 : 0.02, FY + 0.15);
        // Botellas de colores detrás del vidrio.
        for (let k = 0; k < 4; k++) {
          const y = FY + 0.3 + k * 0.4;
          this.box([m.orange, m.lime, m.red, m.blue][k], u, v, alongV ? d * 0.6 : w * 0.8, 0.22, alongV ? w * 0.8 : d * 0.6, y);
        }
        break;
      }
      case 'pendantRail': {
        // Viga negra colgada con campanas industriales negras.
        const ceil = FY + 3.1;
        const y = ceil - 0.75;
        this.box(m.metalDark, u, v, w, 0.14, d, y);
        const n = Math.max(2, Math.round(Math.max(w, d) / 1.1));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const lu = u + (w >= d ? t * w : 0);
          const lv = v + (w >= d ? 0 : t * d);
          this.box(m.metalDark, lu, lv, 0.03, 0.3, 0.03, y - 0.3);
          this.cyl(m.metalDark, lu, lv, 0.3, 0.16, y - 0.46);
          this.cyl(m.light, lu, lv, 0.16, 0.02, y - 0.48);
        }
        for (const s of [-1, 1]) {
          this.box(m.metalDark, u + (w >= d ? s * w * 0.4 : 0), v + (w >= d ? 0 : s * d * 0.4), 0.02, ceil - y - 0.14, 0.02, y + 0.14);
        }
        break;
      }
      case 'longTable': {
        const frame = this.mat(it.color, m.chairGreen);
        this.box(m.board, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(frame, u + su * (w / 2 - 0.08), v + sv * (d / 2 - 0.08), 0.05, 0.74, 0.05, FY);
        }
        // Bancos verdes a los dos lados.
        for (const s of [-1, 1]) {
          if (w >= d) this.box(frame, u, v + s * (d / 2 + 0.3), w - 0.2, 0.05, 0.3, FY + 0.45);
          else this.box(frame, u + s * (w / 2 + 0.3), v, 0.3, 0.05, d - 0.2, FY + 0.45);
        }
        break;
      }
      case 'greenWall':
        this.box(m.grass, u, v, alongV ? 0.08 : w, it.h ?? 1.8, alongV ? w : 0.08, FY + (it.y ?? 1.0));
        break;
      case 'bamboo': {
        this.box(m.metalDark, u, v, 0.35, 0.45, 0.35, FY);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          this.cyl(m.timber, u + Math.cos(a) * 0.08, v + Math.sin(a) * 0.08, 0.04, 1.9 + (k % 3) * 0.25, FY + 0.4);
        }
        break;
      }
      case 'piano':
        this.box(m.timberDark, u, v, w, 1.25, d, FY);
        this.box(m.board, u, v, alongV ? d * 0.4 : w * 0.9, 0.04, alongV ? w * 0.9 : d * 0.4, FY + 0.75);
        break;
      case 'drawers': {
        this.box(this.mat(it.color, m.board), u, v, w, it.h ?? 0.85, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 4; k++) {
          this.box(m.frame, u + nu * (d / 2 + 0.005), v + nv * (d / 2 + 0.005), alongV ? 0.01 : w * 0.95, 0.01, alongV ? w * 0.95 : 0.01, FY + (k * (it.h ?? 0.85)) / 4);
        }
        break;
      }
      case 'coatBench': {
        // Banco rojo con tablero rojo de percheros arriba.
        this.box(m.red, u, v, w, 0.05, d, FY + 0.42);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(m.metalDark, u + s * (w / 2 - 0.1), v, 0.05, 0.42, d - 0.06, FY);
          else this.box(m.metalDark, u, v + s * (d / 2 - 0.1), w - 0.06, 0.42, 0.05, FY);
        }
        const [nu, nv] = faceDir(it.face);
        this.box(m.red, u - nu * (d / 2 - 0.02), v - nv * (d / 2 - 0.02), alongV ? 0.03 : w, 0.28, alongV ? w : 0.03, FY + 1.5);
        break;
      }
      case 'gate': {
        // Reja de barrotes verticales.
        const mat = this.mat(it.color, m.red);
        const hgt = it.h ?? 2.1;
        const n = Math.max(3, Math.round(Math.max(w, d) / 0.12));
        for (let k = 0; k <= n; k++) {
          const t = k / n - 0.5;
          this.box(mat, u + (alongV ? 0 : t * w), v + (alongV ? t * d : 0), 0.025, hgt, 0.025, FY);
        }
        for (const y of [0.1, hgt - 0.05]) this.box(mat, u, v, alongV ? 0.04 : w, 0.05, alongV ? d : 0.04, FY + y);
        break;
      }
      case 'plaques': {
        // Placas de bronce sobre madera oscura y un diploma de marco dorado,
        // apiladas (recorrido 0:20).
        const stack: Array<[Material, number, number, number]> = [
          [m.timberDark, 0.6, 1.05, 0.5],
          [m.yellow, 0.5, 1.1, 0.4],
          [m.timberDark, 0.55, 1.65, 0.45],
          [m.yellow, 0.45, 1.7, 0.35],
          [m.yellow, 0.55, 2.2, 0.75],
          [m.board, 0.45, 2.27, 0.61],
        ];
        const [nu, nv] = faceDir(it.face);
        stack.forEach(([mat, sw, y, sh], k) => {
          const off = 0.015 + (k % 2) * 0.012;
          this.box(mat, u + nu * off, v + nv * off, alongV ? 0.02 : sw, sh, alongV ? sw : 0.02, FY + y);
        });
        break;
      }
      case 'trophyShelf': {
        const y = FY + (it.y ?? 2.15);
        this.box(m.timberDark, u, v, w, 0.04, d, y);
        this.box(m.timberDark, u, v, w, 0.04, d, y + 0.42);
        const n = Math.max(3, Math.round(Math.max(w, d) / 0.22));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const tu = u + (alongV ? 0 : t * w);
          const tv = v + (alongV ? t * d : 0);
          this.cyl(m.yellow, tu, tv, 0.08, 0.22 + (k % 3) * 0.06, y + 0.04);
          this.box(m.timberDark, tu, tv, 0.1, 0.05, 0.1, y + 0.04);
        }
        break;
      }
      case 'waterCooler':
        this.box(m.board, u, v, 0.32, 1.0, 0.32, FY);
        this.cyl(m.glass, u, v, 0.26, 0.42, FY + 1.0);
        break;
      case 'plasticChair':
        this.chair(m.board, u, v, it.face);
        break;
      case 'filing': {
        this.box(m.red, u, v, w, it.h ?? 1.35, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 6; k++) {
          this.box(m.metalDark, u + nu * (d / 2 + 0.005), v + nv * (d / 2 + 0.005), alongV ? 0.01 : w * 0.95, 0.012, alongV ? w * 0.95 : 0.01, FY + (k * (it.h ?? 1.35)) / 6);
        }
        break;
      }
      case 'sinkCounter': {
        // Mesada con venecitas, bachas blancas y espejos encima.
        this.box(m.yellow, u, v, w, 0.85, d, FY);
        this.box(m.board, u, v, w + 0.02, 0.05, d + 0.02, FY + 0.85);
        const n = Math.max(1, Math.round(Math.max(w, d) / 0.8));
        const [nu, nv] = faceDir(it.face);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const su = u + (alongV ? 0 : t * w);
          const sv = v + (alongV ? t * d : 0);
          this.cyl(m.board, su, sv, 0.36, 0.06, FY + 0.88);
          this.box(m.glass, su - nu * (d / 2 - 0.02), sv - nv * (d / 2 - 0.02), alongV ? 0.02 : 0.5, 0.7, alongV ? 0.5 : 0.02, FY + 1.15);
        }
        break;
      }
      case 'copier':
        this.box(m.board, u, v, w, 0.95, d, FY);
        this.box(m.metalDark, u, v, w * 0.9, 0.06, d * 0.8, FY + 0.95);
        break;
      case 'desk2': {
        // Escritorio de oficina (blanco o del color indicado) con monitor.
        const top = this.mat(it.color, m.board);
        this.box(top, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          if (alongV) this.box(top, u, v + su * (d / 2 - 0.02), w, 0.74, 0.04, FY);
          else this.box(top, u + su * (w / 2 - 0.02), v, 0.04, 0.74, d, FY);
        }
        this.box(m.metalDark, u, v, alongV ? 0.05 : 0.55, 0.36, alongV ? 0.55 : 0.05, FY + 0.82);
        break;
      }
      case 'wallMat':
        this.box(this.mat(it.color, m.red), u, v, alongV ? 0.1 : w, it.h ?? 2.0, alongV ? w : 0.1, FY + (it.y ?? 0));
        break;
      case 'padPilaster':
        // Pilastra del polideportivo: protección verde abajo y roja arriba.
        this.box(m.chairGreen, u, v, w, 1.2, d, FY + 0.1);
        this.box(m.red, u, v, w, 1.35, d, FY + 1.3);
        break;
      case 'flagpole':
        this.cyl(m.metal, u, v, 0.07, it.h ?? 6.5, FY);
        break;
      case 'stack': {
        const mat = this.mat(it.color, m.red);
        const n = Math.round((it.h ?? 1.6) / 0.09);
        this.box(mat, u, v, w, 0.45, d, FY);
        for (let k = 0; k < n; k++) this.box(mat, u, v, w, 0.03, d, FY + 0.45 + k * 0.09);
        break;
      }
      case 'drumKit':
        this.cyl(m.red, u, v, 0.55, 0.45, FY + 0.05);
        for (const [du, dv] of [
          [-0.45, 0.25],
          [0.45, 0.25],
          [0, 0.45],
        ]) {
          this.cyl(m.red, u + du, v + dv, 0.32, 0.25, FY + 0.6);
          this.box(m.metal, u + du, v + dv, 0.02, 0.6, 0.02, FY);
        }
        this.cyl(m.yellow, u - 0.6, v - 0.2, 0.4, 0.01, FY + 1.1);
        break;
      case 'risers': {
        // Gradas de 3 escalones (rojo y azul alternados).
        for (let k = 0; k < 3; k++) {
          const [nu, nv] = faceDir(it.face);
          const off = (1 - k) * (alongV ? w : d) / 3;
          const mat = k % 2 === 0 ? m.red : m.blue;
          this.box(mat, u - nu * off, v - nv * off, alongV ? w / 3 : w, 0.3 * (k + 1), alongV ? d : d / 3, FY);
        }
        break;
      }
      case 'slide': {
        // Juego de plástico: torre, techo y tobogán.
        const tower = this.mat(it.color, m.yellow);
        this.box(tower, u, v, w * 0.5, 1.2, d * 0.5, FY);
        this.box(m.red, u, v, w * 0.55, 0.08, d * 0.55, FY + 1.6);
        const p = toWorld(this.f, u + w * 0.45, v);
        this.farm.add('box', m.red, new Vector3(p.x, FY + 0.6, p.z), new Vector3(1.4, 0.06, 0.5), this.yaw(1, 0), 0, -0.6);
        const q = toWorld(this.f, u, v + d * 0.45);
        this.farm.add('box', m.lime, new Vector3(q.x, FY + 0.6, q.z), new Vector3(0.5, 0.06, 1.4), 0, 0.6, 0);
        break;
      }
      case 'swing': {
        const frame = this.mat(it.color, m.lime);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(frame, u + s * w / 2, v, 0.08, 2.2, 0.08, FY);
          else this.box(frame, u, v + s * d / 2, 0.08, 2.2, 0.08, FY);
        }
        this.box(frame, u, v, w >= d ? w : 0.08, 0.08, w >= d ? 0.08 : d, FY + 2.2);
        for (const s of [-0.25, 0.25]) {
          const su = u + (w >= d ? s * w : 0);
          const sv = v + (w >= d ? 0 : s * d);
          this.box(m.metalDark, su, sv, 0.02, 1.7, 0.02, FY + 0.5);
          this.box(m.red, su, sv, 0.45, 0.04, 0.25, FY + 0.48);
        }
        break;
      }
      case 'wallPanel':
        this.box(this.mat(it.color, m.white), u, v, w, it.h ?? 1.0, d, FY + (it.y ?? 0));
        break;
      case 'floorPatch':
        this.box(this.mat(it.color, m.metalDark), u, v, w, 0.008, d, FY + 0.002);
        break;
      case 'hoop': {
        // Aro de básquet chico: tablero rojo, aro naranja y red blanca.
        const [nu, nv] = faceDir(it.face);
        this.box(m.red, u, v, alongV ? 0.04 : w, 0.45, alongV ? w : 0.04, FY + 1.85);
        this.cyl(m.orange, u + nu * 0.25, v + nv * 0.25, 0.4, 0.02, FY + 1.95);
        this.cyl(m.board, u + nu * 0.25, v + nv * 0.25, 0.3, 0.3, FY + 1.65);
        break;
      }
      case 'ceilingFan': {
        // Cuatro aspas beige y una campana de bronce colgadas del techo.
        const y = FY + 2.75;
        this.box(m.metalDark, u, v, 0.03, 0.3, 0.03, y + 0.05);
        this.cyl(m.yellow, u, v, 0.2, 0.12, y - 0.05);
        this.box(m.timber, u, v, w, 0.015, 0.14, y);
        this.box(m.timber, u, v, 0.14, 0.015, d, y);
        break;
      }
      case 'palm':
        this.palm(u, v, it.h ?? 6, FY + (it.y ?? 0));
        break;
    }
  }

  /** Material por clave, con uno por defecto. */
  private mat(key: string | undefined, fallback: Material): Material {
    return (key && this.m[key]) || fallback;
  }

  /** Silla escolar: asiento, respaldo y dos patines. `face` es hacia dónde mira. */
  private chair(mat: Material, u: number, v: number, face: Item['face'], scale = 1): void {
    const s = scale;
    const FY = this.fy;
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
      const kind = STYLES[r.id]?.lights ?? 'tube';
      if (kind === 'none') continue;
      const ceil = LEVEL_Y[roomLevel(r)] + 3.1;
      const y = ceil - 0.05;
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
          if (kind === 'panel') {
            // Panel LED de 60 × 60 embutido en el cielorraso de placas.
            this.box(this.m.light, u, v, 0.6, 0.03, 0.6, y + 0.02);
          } else if (kind === 'dome') {
            // Campana blanca colgada de un cable, como las del hall.
            this.box(this.m.metalDark, u, v, 0.012, 0.6, 0.012, ceil - 0.6);
            this.cyl(this.m.board, u, v, 0.34, 0.16, ceil - 0.76);
            this.cyl(this.m.light, u, v, 0.26, 0.02, ceil - 0.775);
          } else {
            this.box(this.m.light, u, v, long ? 1.2 : 0.16, 0.05, long ? 0.16 : 1.2, y);
          }
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

  private palm(u: number, v: number, h: number, base = 0): void {
    const trunk = this.mats.surface(PALETTE.barkLight, 0.95, 0, 'timber');
    this.cyl(trunk, u, v, 0.34, h * 0.55, base);
    this.cyl(trunk, u, v, 0.26, h * 0.45, base + h * 0.55);
    const frond = this.mats.foliage(PALETTE.leafMid);
    const p = toWorld(this.f, u, v);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + this.rng.range(-0.15, 0.15);
      const len = this.rng.range(2.1, 2.7);
      const droop = this.rng.range(0.35, 0.6);
      const cx = p.x + Math.sin(a) * len * 0.45;
      const cz = p.z + Math.cos(a) * len * 0.45;
      // Hoja: caja chata girada hacia afuera y caída en la punta.
      this.farm.add('box', frond, new Vector3(cx, base + h - 0.25, cz), new Vector3(0.45, 0.05, len), a, droop);
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
