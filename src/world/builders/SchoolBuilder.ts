import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import type { CityPlan } from '../CityLayout';
import type { NatureBuilder } from './NatureBuilder';
import type { StreetLevel } from './StreetLevel';
import { offsetPolygon, polygonArea, subtractRects } from './PrismBatch';
import {
  CREST,
  GYM_MID,
  GYM_PILASTERS,
  ITEMS,
  LANDINGS,
  LEVEL_Y,
  PORTAL,
  PORTAL_COLUMNS,
  PORTAL_PILLARS,
  PORTAL_RAILS,
  PORTAL_WINDOWS,
  ROOFS,
  ROOMS,
  SALON_COLUMNS,
  SC,
  SCHOOL,
  STAIRS,
  STREET_LIGHTS,
  FENCES,
  U,
  U1,
  UPPER,
  V,
  V1,
  WALLS,
  inLot,
  inPoly,
  planU,
  planV,
  riserCount,
  roomAt,
  roomLevel,
  toWorld,
  voidsAt,
  volumeTop,
  type Level,
  type Grille,
  type Opening,
  type OpeningType,
  type P,
  type Room,
  type SchoolFrame,
  type Stair,
  type Volume,
  type Wall,
} from '../SchoolLayout';
import { isInteractiveDoor } from '../SchoolDoors';
import type { Fixture } from '../SchoolLights';
import { FY, H, SchoolKit, type LampFixture } from './school/SchoolKit';
import { STYLES } from './school/SchoolMaterials';
import { SchoolItems } from './school/SchoolItems';
import { OUTDOOR_KINDS, SchoolOutdoor } from './school/SchoolOutdoor';

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

/** Vanos con marco de puerta (jambas y cabezal de 8 cm sobre el dintel). */
const FRAMED: ReadonlySet<OpeningType> = new Set(['door', 'double', 'exit', 'entrance']);

/** Guarda roja de pasillos y patios: de 1,16 a 1,24 m sobre el piso. */
const STRIPE: readonly [number, number] = [1.16, 1.24];

/**
 * Lado de una reja pedida a mano en un muro interior: hacia el ambiente sin
 * techo (patio) o, entre dos locales, hacia el pasillo; 0 si no hay cómo saberlo.
 */
function grilleSide(rp: Room | null, rn: Room | null): number {
  const open = (r: Room | null) => !!r && !r.roofed;
  const hall = (r: Room | null) => !!r && r.name === 'Pasillo';
  if (open(rp) !== open(rn)) return open(rp) ? 1 : -1;
  if (hall(rp) !== hall(rn)) return hall(rp) ? 1 : -1;
  return 0;
}

/** Antepecho y dintel de un vano, con la altura propia si la tiene. */
function holeOf(o: Opening, wallH: number): [number, number] {
  const [hb, ht] = HOLE[o.type];
  return [o.hb ?? hb, Math.min(o.ht ?? ht, wallH - 0.15)];
}

/** Ambientes de un piso alto sobre un patio de planta baja: llevan losa vista por debajo. */
const SOFFIT_ROOMS: ReadonlySet<string> = new Set(['aulaNE']);

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
 *
 * Este archivo es la ENVOLVENTE (pisos, muros y aberturas, plantas altas,
 * cubiertas, gimnasio, escaleras, portal, fachadas, cercos y postes) y el
 * orden de armado (`build`). El resto vive en `school/`: `SchoolKit` (granja,
 * materiales, generador, marco y primitivas, compartido por todos),
 * `SchoolMaterials` (paleta y estilos de cada ambiente), `SchoolItems`
 * (equipamiento, luminarias y cielorrasos) y `SchoolOutdoor` (terreno,
 * frente, vegetación, patios y gimnasio). El orden de `build` es el orden de
 * la granja y del generador de la escuela: no se reordena.
 */
export class SchoolBuilder {
  private readonly k: SchoolKit;
  private readonly items: SchoolItems;
  private readonly outdoor: SchoolOutdoor;
  /**
   * Luminarias de las aulas con interruptor, por aula: la parte que se
   * enciende la dibuja el juego (`game/world/Lights`); acá queda el marco.
   */
  readonly switchable: Map<string, Fixture[]>;
  /** Todas las luminarias que dibuja la escuela (para `LightPools`). */
  readonly fixtures: readonly LampFixture[];

  constructor(
    farm: InstanceFarm,
    mats: Materials,
    rng: Rng,
    nature: NatureBuilder,
    street: StreetLevel,
    /** Detalle fino de mobiliario y herrería (ver `SchoolKit.detailed`). */
    detailed = true,
  ) {
    this.k = new SchoolKit(farm, mats, rng, nature, street, detailed);
    this.items = new SchoolItems(this.k);
    this.outdoor = new SchoolOutdoor(this.k, this.items);
    this.switchable = this.k.switchable;
    this.fixtures = this.k.fixtures;
  }

  build(frame: SchoolFrame, plan: CityPlan, scene: Scene): Mesh[] {
    this.k.begin(frame);
    this.outdoor.grounds(plan);
    this.floors();
    for (const w of WALLS) this.wall(w);
    this.items.ceilings();
    this.upperFloors();
    this.roofs();
    this.rooftops();
    this.gym();
    for (const s of STAIRS) this.stair(s);
    this.cores();
    this.salonBeams();
    this.items.makerWall();
    // Cada ítem del plano, en su orden: los de exterior, patio y gimnasio
    // los dibuja `SchoolOutdoor`; el resto, `SchoolItems`.
    for (const it of ITEMS) (OUTDOOR_KINDS.has(it.kind) ? this.outdoor : this.items).item(it);
    this.items.lights();
    this.portal();
    this.jardinFacade();
    this.outdoor.frontage();
    this.crest();
    this.fences();
    this.utilityLines();
    // Escuela 2050: lo que se sume en la vereda va al final (no reordena la granja).
    this.outdoor.streetscape();
    return this.k.prisms.build(scene, 'school');
  }

  // ==================================================================== pisos

  private floors(): void {
    const mat: Record<Room['floor'], Material> = {
      tile: this.k.m.tile,
      wood: this.k.m.wood,
      gym: this.k.m.gymFloor,
      green: this.k.m.green,
      patio: this.k.m.patio,
      dark: this.k.m.tileDark,
      checker: this.k.m.checker,
      ceramic: this.k.m.ceramic,
      ceramicTan: this.k.m.ceramicTan,
      ceramicBeige: this.k.m.ceramicBeige,
      rubber: this.k.m.rubber,
      terracotta: this.k.m.terracotta,
      hallStone: this.k.m.hallStone,
      dance: this.k.m.dance,
      patioTile: this.k.m.patioTile,
    };
    for (const r of ROOMS) {
      const level = roomLevel(r);
      const top = LEVEL_Y[level];
      // Planta baja: contrapiso desde el terreno. Pisos altos: losa de 14 cm
      // (la cara inferior la tapa el cielorraso del ambiente de abajo), sin
      // los huecos de escalera de ese nivel.
      if (level === 0) {
        this.k.prisms.plan(mat[r.floorLook ?? r.floor], r.poly, 0, top, { bottom: false });
        continue;
      }
      // Con cara inferior: bajo la galería en voladizo y bajo la pasarela se ve
      // la losa desde el patio (oscura, como en el video).
      for (const piece of subtractRects(r.poly, voidsAt(level))) {
        this.k.prisms.plan(mat[r.floorLook ?? r.floor], piece, top - 0.14, top);
        // Bajo un aula sobre el patio se ve un cielorraso de losa, no la cara
        // inferior del piso (el cerámico del aula parecía un techo de baldosas).
        if (SOFFIT_ROOMS.has(r.id)) this.k.prisms.plan(this.k.m.slab, piece, top - 0.15, top - 0.15, { top: false, sides: false });
      }
    }
  }

  // =================================================================== muros

  private side(w: Wall, room: Room | null): Side {
    if (w.kind === 'medianera' || !room) {
      const ext = (w.ext && this.k.m[w.ext]) || this.k.m.facade;
      return { bands: [[0, w.h, ext]], stripe: false, exterior: true, room };
    }
    const st = STYLES[room.id] ?? {};
    const key = w.finish?.[room.id] ?? st.wall ?? 'white';
    if (key === 'blockTwoTone') {
      // Testero del polideportivo: bloque claro abajo, más oscuro desde ~4 m.
      return {
        bands: [
          [0, 4.1, this.k.m.block],
          [4.1, w.h, this.k.m.blockDark],
        ],
        stripe: false,
        exterior: false,
        room,
      };
    }
    const mat = this.k.m[key];
    const stripe = st.stripe ?? (mat === this.k.m.white && !st.wainscot);
    // Muro alto del gimnasio visto desde un ambiente bajo: por encima del
    // techo vecino ya es fachada.
    const top = w.h > 3.8 && room.id !== 'gimnasio' ? H : w.h;
    const bands: Array<[number, number, Material]> = [];
    if (st.wainscot) {
      const [wm, wh] = st.wainscot;
      bands.push([0, wh, this.k.m[wm]], [wh, top, mat]);
    } else {
      bands.push([0, top, mat]);
    }
    if (top < w.h) bands.push([top, w.h, (w.upper && this.k.m[w.upper]) || this.k.m.facade]);
    return { bands, stripe, exterior: false, room };
  }

  private wall(w: Wall): void {
    const [au, av] = w.a;
    const len = Math.hypot(w.b[0] - au, w.b[1] - av);
    const du = (w.b[0] - au) / len;
    const dv = (w.b[1] - av) / len;
    const nu = -dv;
    const nv = du;
    const t = w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT;
    // Base del muro: los de los pisos altos apoyan sobre la losa de su nivel.
    const yb = w.level * H;
    const at = (d: number): P => [au + du * d, av + dv * d];
    const roomsAt = (d: number): [Room | null, Room | null] => {
      const [pu, pv] = at(d);
      return [roomAt(pu + nu * 0.45, pv + nv * 0.45, w.level), roomAt(pu - nu * 0.45, pv - nv * 0.45, w.level)];
    };
    // Terminación: el pozo de una escalera (hueco sin ambiente propio en ese
    // nivel) sigue con la del ambiente del que sube. Sin esto, en el pozo del
    // jardín el muro pasaba del amarillo al gris de fachada en el primer piso.
    const finishRoom = (u: number, v: number): Room | null => {
      for (let lv = w.level; ; lv--) {
        const r = roomAt(u, v, lv as Level);
        if (r || lv === 0) return r;
        if (!voidsAt(lv as Level).some((h) => u > h.u0 && u < h.u1 && v > h.v0 && v < h.v1)) return null;
      }
    };
    const finishRoomsAt = (d: number): [Room | null, Room | null] => {
      const [pu, pv] = at(d);
      return [finishRoom(pu + nu * 0.45, pv + nv * 0.45), finishRoom(pu - nu * 0.45, pv - nv * 0.45)];
    };

    // Un muro largo pasa por varios ambientes: se corta donde llega otro muro
    // o termina un ambiente, y cada tramo toma la terminación de los ambientes
    // que tiene a cada lado. Antes se miraba sólo el centro del muro: el fondo
    // de la recepción del jardín se pintaba entero del amarillo de la Sala
    // Amarilla, también del lado de la galería verde (y se veía en el vano).
    const along = (p: P): number | null => {
      const ru = p[0] - au;
      const rv = p[1] - av;
      const d = ru * du + rv * dv;
      return Math.abs(-ru * dv + rv * du) <= t / 2 + 0.16 && d > 0.05 && d < len - 0.05 ? d : null;
    };
    const roomCuts: number[] = [];
    for (const o of WALLS) {
      if (o === w || o.level !== w.level) continue;
      for (const p of [o.a, o.b]) {
        const d = along(p);
        if (d !== null) roomCuts.push(d);
      }
    }
    for (const r of ROOMS) {
      if (roomLevel(r) !== w.level) continue;
      for (const p of r.poly) {
        const d = along(p);
        if (d !== null) roomCuts.push(d);
      }
    }
    // Tramos de terminación: entre cortes, fusionando los que ven lo mismo.
    const marks = [0, ...roomCuts.sort((x, y) => x - y), len];
    const finishes: Array<{ t0: number; t1: number; layers: Layer[]; key: string }> = [];
    for (let k = 0; k < marks.length - 1; k++) {
      const t0 = marks[k];
      const t1 = marks[k + 1];
      if (t1 - t0 < 0.02) continue;
      const [rp, rn] = finishRoomsAt((t0 + t1) / 2);
      const key = `${rp?.id ?? '-'}|${rn?.id ?? '-'}`;
      const last = finishes[finishes.length - 1];
      if (last && last.key === key) {
        last.t1 = t1;
        continue;
      }
      const pos = this.side(w, rp);
      const neg = this.side(w, rn);
      const same =
        pos.bands.length === neg.bands.length &&
        pos.bands.every((b, j) => b[2] === neg.bands[j][2] && b[0] === neg.bands[j][0] && b[1] === neg.bands[j][1]) &&
        pos.stripe === neg.stripe;
      const layers: Layer[] = same
        ? [{ off: 0, t, side: pos }]
        : [
            { off: t / 4, t: t / 2, side: pos },
            { off: -t / 4, t: t / 2, side: neg },
          ];
      finishes.push({ t0: last ? last.t1 : t0, t1, layers, key });
    }
    if (finishes.length) {
      finishes[0].t0 = 0;
      finishes[finishes.length - 1].t1 = len;
    }

    // Tramos: el muro se corta en cada borde de vano y de terminación; en
    // cada tramo quedan los vanos que lo cubren (varios, a distinta altura).
    const cuts = [0, len];
    for (const o of w.openings) cuts.push(o.t0, o.t1);
    for (const f of finishes) cuts.push(f.t0, f.t1);
    cuts.sort((x, y) => x - y);
    const spans: Array<{ t0: number; t1: number; holes: Array<[number, number]>; layers: Layer[] }> = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k];
      const t1 = cuts[k + 1];
      if (t1 - t0 < 0.005) continue;
      const mid = (t0 + t1) / 2;
      const holes = w.openings
        .filter((o) => o.t0 <= mid && o.t1 >= mid)
        .map((o): [number, number] => {
          const [hb, ht] = holeOf(o, w.h);
          // Las puertas llevan un cabezal de marco de 8 cm sobre el vano: el
          // dintel del muro arranca encima. Si arrancaba en el mismo plano
          // que la cara inferior del cabezal, las dos caras titilaban.
          return [hb, FRAMED.has(o.type) ? Math.min(ht + 0.08, w.h) : ht];
        })
        .sort((x, y) => x[0] - y[0]);
      const fin = finishes.find((f) => mid >= f.t0 && mid <= f.t1) ?? finishes[0];
      spans.push({ t0, t1, holes, layers: fin.layers });
    }

    const stripeCut = spans.map((s) => s.holes.some(([hb, ht]) => hb < STRIPE[1] && ht > STRIPE[0]));
    // Puntas del muro donde no sigue otro muro alineado: ahí la guarda se
    // retira 3 mm (su canto quedaba en el plano del canto del muro). Donde sí
    // sigue, no: dejaría una ranura blanca de 6 mm en la junta.
    const continues = (p: P): boolean =>
      WALLS.some((o) => {
        if (o === w || o.level !== w.level) return false;
        const end = Math.hypot(o.a[0] - p[0], o.a[1] - p[1]) < 0.01 || Math.hypot(o.b[0] - p[0], o.b[1] - p[1]) < 0.01;
        if (!end) return false;
        const ol = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
        return Math.abs(((o.b[0] - o.a[0]) / ol) * dv - ((o.b[1] - o.a[1]) / ol) * du) < 0.01;
      });
    const pullA = continues(w.a) ? 0 : 0.003;
    const pullB = continues(w.b) ? 0 : 0.003;
    spans.forEach((s, k) => {
      const a = at(s.t0);
      const b = at(s.t1);
      for (const L of s.layers) {
        for (const [y0, y1, mat] of L.side.bands) {
          // Lleno entre vanos, dentro de la franja [y0, y1].
          let y = y0;
          for (const [hb, ht] of s.holes) {
            if (hb > y + 0.005) this.k.piece(mat, a, b, L.t, yb + y, yb + Math.min(y1, hb), L.off);
            y = Math.max(y, ht);
            if (y >= y1) break;
          }
          if (y < y1 - 0.005) this.k.piece(mat, a, b, L.t, yb + y, yb + y1, L.off);
        }
        // Guarda roja fina a 1,20 m (centro), como en todos los pasillos del
        // recorrido: corre por los antepechos y se corta en las puertas. Donde
        // termina contra un vano se retira 3 mm: su canto quedaba en el mismo
        // plano que el canto del muro y titilaba. Entre dos ventanas de una
        // tira (la galería roja) no se dibuja: quedaban cuadraditos rojos
        // sueltos sobre los parantes de 8 cm.
        const pier = s.t1 - s.t0 < 0.3 && k > 0 && k < spans.length - 1 && stripeCut[k - 1] && stripeCut[k + 1];
        if (L.side.stripe && !stripeCut[k] && !pier) {
          const t0 = s.t0 + (k > 0 && stripeCut[k - 1] ? 0.003 : k === 0 ? pullA : 0);
          const t1 = s.t1 - (k < spans.length - 1 && stripeCut[k + 1] ? 0.003 : k === spans.length - 1 ? pullB : 0);
          // Bajo un antepecho que arranca justo a 1,24 m, la guarda baja 4 mm:
          // su cara de arriba coincidía con la del alféizar.
          const flush = s.holes.some(([hb]) => hb >= STRIPE[1] - 1e-6 && hb < STRIPE[1] + 0.005);
          this.k.piece(this.k.m.stripe, at(t0), at(t1), L.t + 0.02, yb + STRIPE[0], yb + STRIPE[1] - (flush ? 0.004 : 0), L.off);
        }
      }
    });

    for (const o of w.openings) {
      const [rp, rn] = roomsAt((o.t0 + o.t1) / 2);
      const pe = !rp || w.kind === 'medianera';
      const ne = !rn || w.kind === 'medianera';
      const extSign = pe && !ne ? 1 : ne && !pe ? -1 : 0;
      this.opening(w, o, at(o.t0), at(o.t1), o.t1 - o.t0, t, [nu, nv], extSign, rp, rn);
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
    const m = this.k.m;

    if (type === 'window' || type === 'high' || type === 'band') {
      const fm = (o.color && m[o.color]) || m.frame;
      // La ventanita de celosía del pasillo del jardín (video 2026, 1:20) tiene vidrio oscuro.
      const gm = o.color === 'black' && o.grille === 'louvre' ? m.glassDark : m.glass;
      this.k.piece(gm, along(0.03), along(len - 0.03), 0.02, hb + 0.03, ht - 0.03);
      this.k.piece(fm, a, b, 0.1, hb, hb + 0.06);
      this.k.piece(fm, a, b, 0.1, ht - 0.06, ht);
      this.k.piece(fm, a, along(0.06), 0.1, hb, ht);
      this.k.piece(fm, along(len - 0.06), b, 0.1, hb, ht);
      const redHatch = fm === m.red && o.grille === 'none';
      // La ventanilla roja del hall del jardín es un vano abierto, sin parante.
      if ((this.k.detailed || len > 2.4) && !redHatch) this.k.piece(fm, along(len / 2 - 0.025), along(len / 2 + 0.025), 0.08, hb, ht);
      if (redHatch) {
        // Ventanilla de vanos rojos (hall del jardín): el revoque del vano,
        // de cara a cara del muro, pintado de rojo.
        this.k.piece(m.red, a, b, t + 0.01, hb - 0.01, hb + 0.005);
        this.k.piece(m.red, a, b, t + 0.01, ht - 0.005, ht + 0.01);
        this.k.piece(m.red, along(-0.01), along(0.005), t + 0.01, hb, ht);
        this.k.piece(m.red, along(len - 0.005), along(len + 0.01), t + 0.01, hb, ht);
      }
      const grille = o.grille ?? (w.level > 0 ? 'whiteBars' : 'bars');
      if (o.color === 'alu' && grille === 'louvre') {
        // Salón de los espejos (video 2026, 0:07–0:25): por dentro el marco
        // es rojo y se ve detrás del vidrio y de las lamas.
        const ins = -(extSign || 1) * (t / 2 - 0.03);
        this.k.piece(m.red, a, along(0.1), 0.05, hb, ht, ins);
        this.k.piece(m.red, along(len - 0.1), b, 0.05, hb, ht, ins);
        this.k.piece(m.red, a, b, 0.05, hb, hb + 0.1, ins);
        this.k.piece(m.red, a, b, 0.05, ht - 0.1, ht, ins);
      }
      // Protección pedida a mano en un muro interior: del lado del patio (sin
      // techo) o, entre dos locales, del lado del pasillo.
      const gs = extSign !== 0 || o.grille === undefined ? extSign : grilleSide(roomPos, roomNeg);
      if (gs !== 0 && type === 'window' && grille !== 'none') this.windowGuard(w, o, grille, a, b, len, t, n, gs, hb, ht);
      // Cortinas en aulas, oficinas y en el jardín: celestes, violetas, blancas
      // o con cenefa roja según el ambiente (recorrido y fachada).
      // El ambiente de cada ventana (no el del centro del muro): un muro largo
      // de fachada pasa por varias aulas con cortinas distintas.
      const wm = along(len / 2);
      const inner = extSign !== 0 ? roomAt(wm[0] - n[0] * extSign * 0.45, wm[1] - n[1] * extSign * 0.45, w.level) : null;
      if (type === 'window' && inner && (inner.id.startsWith('aula') || inner.id === 'jardin' || STYLES[inner.id]?.curtain)) {
        const off = -extSign * (t / 2 + 0.05);
        const cm = m[STYLES[inner.id]?.curtain ?? 'curtainBlue'];
        const vk = STYLES[inner.id]?.valance;
        // Escuela 2050: estor enrollable en un cajón fino, bajado un tercio (y
        // a la mitad donde en el video las cortinas están corridas: Laprida y
        // la Dirección de secundaria). Reemplaza los paños sueltos a los
        // costados con barral y cenefa, que desde la calle se leían como
        // trapos colgados. El cajón lleva el color de la cenefa si el
        // ambiente la tiene (6° BD, 6° AC, Dirección).
        const onLaprida = (Math.abs(w.a[1]) < 0.01 && Math.abs(w.b[1]) < 0.01 && w.level <= 1) || STYLES[inner.id]?.drawn === true;
        const drop = (ht - hb) * (onLaprida ? 0.5 : 1 / 3);
        this.k.piece(vk ? m[vk] : m.frame, along(-0.06), along(len + 0.06), 0.09, ht + 0.01, ht + 0.11, off);
        this.k.piece(cm, along(0.01), along(len - 0.01), 0.015, ht - drop, ht + 0.01, off);
        // Contrapeso del estor: una regla fina de aluminio en el borde.
        if (this.k.detailed) this.k.piece(m.metal, along(0.01), along(len - 0.01), 0.025, ht - drop - 0.03, ht - drop, off);
      }
      return;
    }

    if (type === 'counter') {
      // Mostrador apoyado SOBRE el antepecho (no en su mismo plano).
      this.k.piece(m.timber, a, b, t + 0.36, hb, hb + 0.05);
      return;
    }
    if (type === 'pass') return;

    if (type === 'exit') {
      this.exitDoor(a, b, len, t, extSign, yb, ht);
      return;
    }

    // Puertas: marco rojo (o el de su color) y hojas abiertas contra el muro.
    const own = o.color ? m[o.color] : undefined;
    const frameMat = own === m.frame || own === m.timberDark || own === m.metalDark ? own : m.red;
    this.k.piece(frameMat, a, along(0.07), t + 0.05, yb, ht);
    this.k.piece(frameMat, along(len - 0.07), b, t + 0.05, yb, ht);
    this.k.piece(frameMat, a, b, t + 0.05, ht, ht + 0.08);

    // Las de aulas y oficinas las dibuja y mueve el juego (`game/world/Doors`).
    if (isInteractiveDoor(w.level, a, b)) return;

    // Las hojas abren hacia el ambiente (no hacia el pasillo, la galería o un
    // hall de distribución). Con sólo 'Pasillo', las salas del jardín abrían
    // sobre su galería de 1,5 m. (Las de emergencia van aparte: `exitDoor`.)
    const isHall = (r: Room | null) => !r || !r.roofed || r.name === 'Pasillo' || r.name === 'Galería' || r.name === 'Hall';
    const s = !isHall(roomPos) ? 1 : !isHall(roomNeg) ? -1 : 1;
    const leafMat = own ?? (type === 'entrance' ? m.glass : m.leaf);
    const hinges = type === 'door' ? [0.08] : [0.08, len - 0.08];
    const leafW = type === 'door' ? len - 0.16 : (len - 0.16) / 2;
    for (const h of hinges) {
      const p = along(h);
      const q0: P = [p[0] + n[0] * s * (t / 2 + 0.02), p[1] + n[1] * s * (t / 2 + 0.02)];
      const q1: P = [q0[0] + n[0] * s * leafW, q0[1] + n[1] * s * leafW];
      if (own === m.glass && type !== 'entrance') {
        // Hoja vidriada (puertas del jardín): bastidor rojo como el marco,
        // con zócalo, cabezal y montantes. Antes era una lámina de vidrio sin
        // marco de 1,3 m flotando abierta en la recepción. También en VR.
        const qa: P = [q0[0] + (q1[0] - q0[0]) * 0.06, q0[1] + (q1[1] - q0[1]) * 0.06];
        const qb: P = [q1[0] - (q1[0] - q0[0]) * 0.06, q1[1] - (q1[1] - q0[1]) * 0.06];
        this.k.piece(m.red, q0, q1, 0.05, yb + 0.03, yb + 0.15);
        // El vidrio entra 2 cm en el bastidor: ningún canto suyo queda en el
        // plano de una cara del marco.
        const ga: P = [q0[0] + (q1[0] - q0[0]) * 0.04, q0[1] + (q1[1] - q0[1]) * 0.04];
        const gb: P = [q1[0] - (q1[0] - q0[0]) * 0.04, q1[1] - (q1[1] - q0[1]) * 0.04];
        this.k.piece(m.glass, ga, gb, 0.02, yb + 0.13, ht - 0.1);
        this.k.piece(m.red, q0, q1, 0.05, ht - 0.12, ht - 0.04);
        this.k.piece(m.red, q0, qa, 0.05, yb + 0.15, ht - 0.12);
        this.k.piece(m.red, qb, q1, 0.05, yb + 0.15, ht - 0.12);
      } else if (type === 'entrance' || !own || !this.k.detailed || o.grille === 'none') {
        // Sin vidrio (`'none'`): hoja maciza (las rojas del vestuario, la de chapa negra).
        this.k.piece(leafMat, q0, q1, 0.045, yb + 0.03, ht - 0.04);
        // Picaporte cerca del borde libre (de los dos lados de la hoja).
        if (this.k.detailed && type !== 'entrance') {
          const k: P = [q1[0] - (q1[0] - q0[0]) * 0.08, q1[1] - (q1[1] - q0[1]) * 0.08];
          const k2: P = [q1[0] - (q1[0] - q0[0]) * 0.13, q1[1] - (q1[1] - q0[1]) * 0.13];
          this.k.piece(m.metal, k2, k, 0.12, yb + 0.98, yb + 1.02);
        }
      } else {
        // Hoja con vidrio: tablero abajo (hasta 0,9 m), vidrio arriba en su marco.
        // Con `whiteBars`: zócalo bajo y tres paños altos separados por
        // travesaños (la puerta doble de PVC del salón, video 2026).
        const panes = o.grille === 'whiteBars';
        const kick = panes ? 0.55 : 0.9;
        this.k.piece(leafMat, q0, q1, 0.045, yb + 0.03, yb + kick);
        this.k.piece(m.glass, q0, q1, 0.02, yb + kick, ht - 0.12);
        this.k.piece(leafMat, q0, q1, 0.05, ht - 0.12, ht - 0.04);
        const qa: P = [q0[0] + (q1[0] - q0[0]) * 0.06, q0[1] + (q1[1] - q0[1]) * 0.06];
        const qb: P = [q1[0] - (q1[0] - q0[0]) * 0.06, q1[1] - (q1[1] - q0[1]) * 0.06];
        this.k.piece(leafMat, q0, qa, 0.05, yb + kick, ht - 0.12);
        this.k.piece(leafMat, qb, q1, 0.05, yb + kick, ht - 0.12);
        if (panes) {
          const pane = (ht - 0.12 - yb - kick) / 3;
          for (const k of [1, 2]) this.k.piece(leafMat, q0, q1, 0.05, yb + kick + k * pane - 0.025, yb + kick + k * pane + 0.025);
        }
      }
      if (type === 'entrance') {
        for (const y of [yb + 0.03, ht - 0.12]) this.k.piece(m.red, q0, q1, 0.06, y, y + 0.1);
      }
    }
  }

  /**
   * Escuela 2050: protección de una ventana, en lugar de las rejas, mallas y
   * barrotes (el "#" flotante de Miguel Cané, la galería "tipo cárcel").
   * - A la calle: tres parasoles verticales de madera (`sunFins`).
   * - Al patio: postigo corredizo de chapa perforada clara que cubre media
   *   ventana, en un riel grafito (dos cajas y el alféizar).
   * - Celosía (`louvre`): con color (salón, ventanita del pasillo), cuatro
   *   lamas finas grafito en el plano del vidrio; sin color (la galería
   *   roja), lamas de madera en la mitad de arriba, como parasol.
   * `side`: signo de la normal del lado protegido.
   */
  private windowGuard(w: Wall, o: Opening, grille: Grille, a: P, b: P, len: number, t: number, n: P, side: number, hb: number, ht: number): void {
    const m = this.k.m;
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const along = (d: number): P => [a[0] + du * d, a[1] + dv * d];
    const face = t / 2;
    if (grille === 'louvre') {
      if (o.color) {
        for (let k = 1; k <= 4; k++) {
          const y = hb + ((ht - hb) * k) / 5;
          this.k.piece(m.graphite, along(0.06), along(len - 0.06), 0.035, y - 0.018, y + 0.018);
        }
        return;
      }
      const y0 = (hb + ht) / 2;
      for (let k = 0; k < 3; k++) {
        const y = y0 + ((ht - y0) * (k + 0.5)) / 3;
        this.k.piece(m.timber, along(-0.04), along(len + 0.04), 0.03, y - 0.05, y + 0.05, side * (face + 0.06));
      }
      return;
    }
    const mid = along(len / 2);
    // Calle o patio: 3 m afuera, ¿sigue el predio? (La franja de frente de
    // Laprida es del predio, pero mide 2,3 m.)
    const street = !inLot(mid[0] + n[0] * side * 3, mid[1] + n[1] * side * 3);
    if (street) {
      // Las tres del primer piso del portal llevan los parasoles grafito del portal.
      const portal = w.level === 1 && Math.abs(a[1]) < 0.01 && Math.abs(b[1]) < 0.01 && Math.min(a[0], b[0]) > PORTAL.u0 - 0.05 && Math.max(a[0], b[0]) < PORTAL.u1 + 0.05;
      if (!portal) this.sunFins(a, b, side, face, hb, ht, true);
      return;
    }
    // Postigo corredizo: a un lado u otro según la ventana (sin azar: el
    // generador de la escuela no se toca), siempre en el mismo riel.
    const off = side * (face + 0.05);
    const left = (Math.round(mid[0] * 3) + Math.round(mid[1] * 3)) % 2 === 0;
    const [d0, d1] = left ? [-0.04, len * 0.47] : [len * 0.53, len + 0.04];
    this.k.piece(m.graphite, along(-0.08), along(len + 0.08), 0.07, ht, ht + 0.05, off);
    this.k.piece(m.frame, along(d0), along(d1), 0.02, hb - 0.01, ht, off);
    this.k.piece(m.graphite, along(-0.05), along(len + 0.05), 0.12, hb - 0.05, hb - 0.01, side * (face + 0.04));
  }

  /**
   * Parasoles de una ventana a la calle: tres lamas verticales de madera de
   * 5 × 25 cm a 0,3 m del vidrio, colgadas de un cabezal grafito y apoyadas
   * en un alféizar grafito con una tira LED cálida de 2 cm debajo (de noche
   * dibuja la fila de ventanas). `face`: distancia del eje del segmento a la
   * cara exterior; `side`: signo de la normal exterior; `turn`: giro de las
   * lamas (0 = perpendiculares al muro). `sill`: con alféizar propio.
   */
  private sunFins(a: P, b: P, side: number, face: number, y0: number, y1: number, sill: boolean, turn = 0): void {
    const m = this.k.m;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const nu = -dv;
    const nv = du;
    const along = (d: number): P => [a[0] + du * d, a[1] + dv * d];
    const out = side * (face + 0.155);
    const top = y1 + 0.12;
    this.k.piece(m.graphite, along(-0.06), along(len + 0.06), 0.31, top, top + 0.045, out);
    if (sill) {
      this.k.piece(m.graphite, along(-0.06), along(len + 0.06), 0.31, y0 - 0.06, y0 - 0.02, out);
      this.k.piece(m.ledWarm, along(0), along(len), 0.02, y0 - 0.08, y0 - 0.06, side * (face + 0.28));
    }
    const yaw = this.k.yaw(du, dv) + turn;
    for (const f of [0.18, 0.5, 0.82]) {
      const c = along(len * f);
      const p = toWorld(this.k.f, c[0] + nu * out, c[1] + nv * out);
      this.k.farm.add('box', m.timber, new Vector3(p.x, (y0 - 0.02 + top) / 2, p.z), new Vector3(0.05, top - y0 + 0.02, 0.25), yaw);
    }
  }

  /**
   * Salida de emergencia, Escuela 2050: puerta corrediza automática de vidrio
   * con las hojas metidas en el muro (el vano sigue transitable, como en la
   * planta), marco grafito fino con un filete verde de salida en la cara que
   * da afuera, riel en el umbral y el cartel de salida adentro. Antes las
   * hojas quedaban abiertas a 90° sobre la vereda.
   */
  private exitDoor(a: P, b: P, len: number, t: number, extSign: number, yb: number, ht: number): void {
    const m = this.k.m;
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const along = (d: number): P => [a[0] + du * d, a[1] + dv * d];
    const out = extSign !== 0 ? extSign : 1;
    this.k.piece(m.graphite, a, along(0.06), t + 0.04, yb, ht);
    this.k.piece(m.graphite, along(len - 0.06), b, t + 0.04, yb, ht);
    this.k.piece(m.graphite, a, b, t + 0.04, ht, ht + 0.12);
    // Filete de salida: jambas y cabezal, en la cara de afuera del marco.
    const lf = out * (t / 2 + 0.025);
    this.k.piece(m.exitSign, along(0.015), along(0.045), 0.012, yb + 0.02, ht, lf);
    this.k.piece(m.exitSign, along(len - 0.045), along(len - 0.015), 0.012, yb + 0.02, ht, lf);
    this.k.piece(m.exitSign, along(0.015), along(len - 0.015), 0.012, ht + 0.035, ht + 0.065, lf);
    // Riel del umbral.
    this.k.piece(m.graphite, along(0.06), along(len - 0.06), 0.08, yb, yb + 0.015);
    // Cartel de salida adentro, sobre el cabezal.
    this.k.piece(m.exitSign, along(len / 2 - 0.2), along(len / 2 + 0.2), 0.05, ht + 0.16, ht + 0.36, -out * (t / 2 + 0.04));
  }

  // ======================================================== losas y volúmenes

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
      const ringPath = offsetPolygon(poly, 0.245);
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
        const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const inside: P = [mid[0] + iu * 0.5, mid[1] + iv * 0.5];
        for (let level = 1; level <= vol.floors; level++) {
          const y0 = level * H;
          // Cornisa entre plantas: sólo en los tramos de la cara que dan a la
          // intemperie. Antes se decidía la arista entera con UN punto en su
          // mitad: la del hall cruzaba el hueco de la torre como una viga, y la
          // de la galería atravesaba el pasillo de los trofeos como un cordón.
          if (vol.cornice === false) continue;
          const ra = ringPath[i];
          const rb = ringPath[(i + 1) % poly.length];
          const rl = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]);
          const e = 0.095 / Math.max(rl, 0.01);
          for (const [t0, t1] of this.exposedRuns(vol, a, [du, dv], len, [iu, iv], level)) {
            // En la punta de la arista, la esquina del anillo (cierra con la
            // cornisa de la arista vecina); en el medio, corte recto.
            const p0: P = t0 < 0.051 ? [ra[0] - (rb[0] - ra[0]) * e, ra[1] - (rb[1] - ra[1]) * e] : [a[0] + du * t0 - iu * 0.245, a[1] + dv * t0 - iv * 0.245];
            const p1: P = t1 > len - 0.051 ? [rb[0] + (rb[0] - ra[0]) * e, rb[1] + (rb[1] - ra[1]) * e] : [a[0] + du * t1 - iu * 0.245, a[1] + dv * t1 - iv * 0.245];
            this.k.piece(this.k.m.facade, p0, p1, 0.19, y0, y0 + 0.22);
          }
        }
        for (let level = 1; level <= vol.floors; level++) {
          const y0 = level * H;
          // Cerramiento genérico donde ese nivel no tiene ambientes: arista por
          // arista, porque donde los hay sus muros reales hacen de fachada.
          if (vol.shell === false || roomAt(inside[0], inside[1], level as Level)) continue;
          const e = 0.15 / len;
          const a2: P = [a[0] - (b[0] - a[0]) * e, a[1] - (b[1] - a[1]) * e];
          const b2: P = [b[0] + (b[0] - a[0]) * e, b[1] + (b[1] - a[1]) * e];
          this.k.piece(this.k.m.facade, a2, b2, SCHOOL.extT, y0, y0 + H);
          this.upperWindows(vol, a, b, level as Level);
        }
      }
      if (vol.roof === false) continue;
      // Con cara inferior: si algún rincón quedara sin cielorraso, se ve la
      // chapa y no el cielo (dos triángulos por volumen).
      // Escuela 2050: azotea verde (la pérgola solar va aparte, `rooftops`).
      this.k.prisms.plan((vol.roofMat && this.k.m[vol.roofMat]) || this.k.m.greenRoof, body, top, top + 0.04, { sides: false });
      // Pretil: no contra un volumen vecino que suba hasta acá o más.
      const bodyIn = polygonArea(body) > 0 ? 1 : -1;
      for (let i = 0; i < body.length; i++) {
        const a = body[i];
        const b = body[(i + 1) % body.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        const nu = (-(b[1] - a[1]) / len) * bodyIn;
        const nv = ((b[0] - a[0]) / len) * bodyIn;
        const probe: P = [(a[0] + b[0]) / 2 - nu * 0.6, (a[1] + b[1]) / 2 - nv * 0.6];
        if (UPPER.some((o) => o !== vol && volumeTop(o) >= top && inPoly(o.poly, probe[0], probe[1]))) continue;
        this.k.piece(this.k.m.slab, a, b, 0.2, top, top + 0.55, bodyIn * 0.1);
        // Albardilla con LED (Escuela 2050), salvo donde un muro más alto
        // corre pegado al pretil (Laprida al este del escalón): ahí la lleva
        // ese muro (`crest`) y la de acá quedaría adentro, con el LED asomando.
        const dir: P = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const line = (t: number): P => [a[0] + dir[0] * t + nu * 0.1, a[1] + dir[1] * t + nv * 0.1];
        const free = (t: number) => !this.tallWallAt(line(t), top + 0.6);
        for (const [t0, t1] of this.k.runs(len, free, 0.3)) {
          const e0 = t0 < 0.01 ? -0.13 : 0;
          const e1 = t1 > len - 0.01 ? 0.13 : 0;
          this.coping([a[0] + dir[0] * (t0 + e0), a[1] + dir[1] * (t0 + e0)], [a[0] + dir[0] * (t1 + e1), a[1] + dir[1] * (t1 + e1)], 0.2, top + 0.55, bodyIn * 0.1, -bodyIn);
        }
      }
    }
  }

  /** ¿Un muro de piso alto que sube por encima de `y` pasa a menos de 30 cm de `p`? */
  private tallWallAt(p: P, y: number): boolean {
    return WALLS.some((w) => w.level > 0 && w.level * H + w.h > y && this.k.nearSegment(w.a, w.b, p, 0.3));
  }

  /**
   * Albardilla grafito sobre un remate a→b (pretil, o muro que sube por
   * encima de la cubierta) de espesor `t`: vuela 3 cm a cada lado, con la
   * cara de abajo en `y`, y lleva una tira LED cálida de 2 cm bajo el vuelo
   * de afuera (`ledSide`: signo de la normal izquierda de a→b hacia afuera;
   * 0 sin LED), que de noche dibuja el perfil del edificio. Reemplaza el
   * remate de sierra y los cantos de hormigón de los pretiles.
   */
  private coping(a: P, b: P, t: number, y: number, off: number, ledSide: number): void {
    this.k.piece(this.k.m.graphite, a, b, t + 0.06, y, y + 0.05, off);
    if (ledSide !== 0) this.k.piece(this.k.m.ledWarm, a, b, 0.02, y - 0.02, y, off + ledSide * (t / 2 + 0.015));
  }

  /**
   * Tramos [t0, t1] de la arista a→a+d·len cuyo exterior (45 cm afuera) está
   * a la intemperie en ese nivel. Se muestrea cada 10 cm y cada borde de
   * tramo se ajusta por bisección; los tramos de menos de 30 cm se descartan.
   */
  private exposedRuns(vol: Volume, a: P, d: P, len: number, inward: P, level: number): Array<[number, number]> {
    return this.k.runs(len, (t) => !this.covered(vol, [a[0] + d[0] * t - inward[0] * 0.45, a[1] + d[1] * t - inward[1] * 0.45], level), 0.3);
  }

  /**
   * ¿Del otro lado de esa cara hay otro volumen alto, el gimnasio, un ambiente
   * de ese nivel o un hueco de escalera? En los tres últimos casos la cornisa
   * quedaría adentro (un cordón en el piso o una viga sobre el hueco).
   */
  private covered(vol: Volume, p: P, level: number): boolean {
    if (UPPER.some((o) => o !== vol && o.floors >= level && inPoly(o.poly, p[0], p[1]))) return true;
    if (roomAt(p[0], p[1])?.id === 'gimnasio') return true;
    const lv = Math.min(2, level) as Level;
    if (roomAt(p[0], p[1], lv)) return true;
    return voidsAt(lv).some((h) => p[0] > h.u0 && p[0] < h.u1 && p[1] > h.v0 && p[1] < h.v1);
  }

  private parapet(poly: readonly P[], y: number, h: number): void {
    const inward = polygonArea(poly) > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      this.k.piece(this.k.m.slab, a, b, 0.2, y, y + h, inward * 0.1);
      // Albardilla con LED, como en los pretiles de las plantas altas (sin
      // LED contra un muro: ahí no se ve y asomaría del otro lado).
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const out: P = [mid[0] + ((b[1] - a[1]) / len) * inward * 0.45, mid[1] - ((b[0] - a[0]) / len) * inward * 0.45];
      const blind = UPPER.some((o) => inPoly(o.poly, out[0], out[1])) || roomAt(out[0], out[1])?.id === 'gimnasio';
      const e = 0.13 / len;
      const a2: P = [a[0] - (b[0] - a[0]) * e, a[1] - (b[1] - a[1]) * e];
      const b2: P = [b[0] + (b[0] - a[0]) * e, b[1] + (b[1] - a[1]) * e];
      this.coping(a2, b2, 0.2, y + h, inward * 0.1, blind ? 0 : -inward);
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
      if (Math.abs(c[1]) < 0.05 && c[0] > U.east1 - 0.5 && c[0] < U.salonW + 0.5) continue;
      const street = !inLot(probe[0], probe[1]);
      this.upperWindow(c, [du, dv], -inward, street, level * H);
    }
  }

  /** Ventana de planta alta sobre la cara del volumen. `side` es el signo de la normal exterior. */
  private upperWindow(c: P, d: P, side: number, street: boolean, base: number): void {
    const m = this.k.m;
    const hw = 0.78;
    const a: P = [c[0] - d[0] * hw, c[1] - d[1] * hw];
    const b: P = [c[0] + d[0] * hw, c[1] + d[1] * hw];
    const y0 = base + 1.05;
    const y1 = base + 2.35;
    this.k.piece(m.glassDark, a, b, 0.03, y0, y1, side * 0.165);
    if (this.k.rng.chance(0.55)) this.k.piece(m.lit, a, b, 0.01, y0 + 0.05, y1 - 0.05, side * 0.185);
    const fa: P = [a[0] - d[0] * 0.06, a[1] - d[1] * 0.06];
    const fb: P = [b[0] + d[0] * 0.06, b[1] + d[1] * 0.06];
    this.k.piece(m.frame, fa, fb, 0.08, y0 - 0.06, y0, side * 0.18);
    this.k.piece(m.frame, fa, fb, 0.08, y1, y1 + 0.06, side * 0.18);
    this.k.piece(m.frame, fa, a, 0.08, y0, y1, side * 0.18);
    this.k.piece(m.frame, b, fb, 0.08, y0, y1, side * 0.18);
    if (!street) {
      this.k.piece(m.slab, fa, fb, 0.2, y0 - 0.12, y0 - 0.06, side * 0.22);
      return;
    }
    // Escuela 2050: a la calle, sin rejas ni equipos de aire colgados; tres
    // parasoles de madera con alféizar LED. El número que antes decidía el
    // equipo de aire se sigue sacando (el azar de la escuela no se corre) y
    // ahora entorna las lamas de esa ventana.
    const turn = this.k.rng.chance(0.5) ? 0.5 : 0;
    this.sunFins(a, b, side, 0.22, y0, y1, true, turn);
  }

  /**
   * Azoteas que producen (Escuela 2050), en lugar del "galpón gris" de la
   * vista aérea: sobre el bloque del frente (aulas de Laprida y hall), una
   * pérgola solar de patas y vigas grafito con tres filas de paneles
   * inclinados hacia el norte (−v), como `roofSolar` del barrio y con su
   * mismo material; al lado, una bomba de calor; en el techo verde de las
   * alas, dos sendas claras de mantenimiento; y en el jardín, filas de
   * paneles bajos sobre la chapa. Sin azar (el de la escuela no se corre).
   */
  private rooftops(): void {
    const m = this.k.m;
    const roof = 2 * H + 0.04;
    // Pérgola: de u 1,0 a 46,3 y de v −0,9 a −9,0 (detrás del pretil de Laprida).
    const pu0 = 1.0;
    const pu1 = U.salonW - 0.6;
    const pv0 = -9.0;
    const pv1 = -0.9;
    const legTop = roof + 2.6;
    const bays = 9;
    const bay = (pu1 - pu0) / bays;
    for (let k = 0; k <= bays; k++) {
      const u = pu0 + bay * k;
      for (const v of [pv0 + 0.35, pv1 - 0.35]) this.k.box(m.graphite, u, v, 0.12, legTop - roof, 0.12, roof);
      this.k.box(m.graphite, u, (pv0 + pv1) / 2, 0.1, 0.16, pv1 - pv0, legTop);
    }
    const rows = 3;
    const pitch = (pv1 - pv0) / rows;
    for (let r = 0; r < rows; r++) {
      const v = pv0 + pitch * (r + 0.5);
      for (let k = 0; k < bays; k++) {
        const p = toWorld(this.k.f, pu0 + bay * (k + 0.5), v);
        this.k.farm.add('box', m.solar, new Vector3(p.x, legTop + 0.42, p.z), new Vector3(bay - 0.08, 0.08, pitch * 0.84), 0, -0.42);
      }
    }
    // Bomba de calor junto a la pérgola, sobre el ala este del patio: gabinete
    // grafito con la rejilla clara al frente y el ventilador arriba.
    this.k.box(m.graphite, 33.6, -11.6, 1.6, 1.15, 0.9, roof);
    this.k.box(m.frame, 33.6, -11.6 + 0.455, 1.3, 0.8, 0.02, roof + 0.18);
    this.k.box(m.frame, 33.6, -11.6, 0.9, 0.02, 0.7, roof + 1.15);
    // Sendas claras sobre el techo verde: ala de Miguel Cané y bloque norte.
    this.k.box(m.patio, 12.2, -19.5, 0.9, 0.03, 18.0, roof);
    this.k.box(m.patio, 26.8, -38.0, 20.0, 0.03, 0.9, roof);
    // Jardín (techo a 3 plantas): cuatro filas de paneles bajos sobre rieles.
    const jRoof = 3 * H + 0.04;
    for (let r = 0; r < 4; r++) {
      const v = -43.9 + r * 2.45;
      this.k.box(m.graphite, 72.4, v, 9.6, 0.3, 0.1, jRoof);
      for (const u of [70.0, 74.8]) {
        const p = toWorld(this.k.f, u, v);
        this.k.farm.add('box', m.solar, new Vector3(p.x, jRoof + 0.55, p.z), new Vector3(4.6, 0.06, 1.9), 0, -0.42);
      }
    }
  }

  /** Cubiertas de una planta: losa, membrana y pretil. */
  private roofs(): void {
    for (const r of ROOFS) {
      // 8 cm: queda dentro del muro, sin asomar del otro lado (el
      // polideportivo veía la cornisa de Arte y Teatro como un saliente).
      const body = offsetPolygon(r.poly, 0.08);
      this.k.prisms.plan(this.k.m.facade, body, r.y, r.y + 0.22, { bottom: false, top: false });
      // Escuela 2050: los paños bajos son techo verde (sedum y césped).
      this.k.prisms.plan(this.k.m.greenRoof, body, r.y + 0.22, r.y + 0.24, { bottom: false, sides: false });
      this.parapet(body, r.y + 0.22, 0.35);
      // Cornisa con el MISMO perfil que la de las plantas altas (0,19 × 0,22 a
      // 0,245 del muro) donde el borde da al aire: antes este canto iba a 8 cm
      // y, donde seguía la cornisa de un volumen alto, hacía un escalón.
      const ring = offsetPolygon(r.poly, 0.245);
      const inward = polygonArea(r.poly) > 0 ? 1 : -1;
      const n = r.poly.length;
      for (let i = 0; i < n; i++) {
        const a = r.poly[i];
        const b = r.poly[(i + 1) % n];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        const du = (b[0] - a[0]) / len;
        const dv = (b[1] - a[1]) / len;
        const ou = dv * inward;
        const ov = -du * inward;
        const exposed = (t: number): boolean => {
          const p: P = [a[0] + du * t + ou * 0.45, a[1] + dv * t + ov * 0.45];
          if (!inLot(p[0], p[1])) return false;
          if (UPPER.some((o) => inPoly(o.poly, p[0], p[1]))) return false;
          if (ROOFS.some((o) => o !== r && inPoly(o.poly, p[0], p[1]))) return false;
          return roomAt(p[0], p[1])?.id !== 'gimnasio';
        };
        const ra = ring[i];
        const rb = ring[(i + 1) % n];
        const rl = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]);
        const e = 0.095 / Math.max(rl, 0.01);
        for (const [t0, t1] of this.k.runs(len, exposed, 0.3)) {
          const p0: P = t0 < 0.051 ? [ra[0] - (rb[0] - ra[0]) * e, ra[1] - (rb[1] - ra[1]) * e] : [a[0] + du * t0 + ou * 0.245, a[1] + dv * t0 + ov * 0.245];
          const p1: P = t1 > len - 0.051 ? [rb[0] + (rb[0] - ra[0]) * e, rb[1] + (rb[1] - ra[1]) * e] : [a[0] + du * t1 + ou * 0.245, a[1] + dv * t1 + ov * 0.245];
          this.k.piece(this.k.m.facade, p0, p1, 0.19, r.y, r.y + 0.22);
        }
      }
    }
  }

  // ================================================================ gimnasio

  /**
   * Gimnasio / SUM: muros de 7,2 m y bóveda de chapa (la cubierta curva que se
   * ve en la toma aérea), con cabriadas, tímpanos, luminarias, bandas rojas y
   * azules como en el video y la cancha pintada (en SchoolIdentity).
   */
  private gym(): void {
    const m = this.k.m;
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
    // La bóveda sigue al oeste sobre el aula de danzas del segundo piso hasta
    // el muro de los espejos (8:44–9:16, 9:38): el cielorraso inclinado del
    // aula es esta misma curva.
    const u0 = U1.vaultW;
    const uMid = (u0 + U.e) / 2;
    const uLen = U.e - u0 + 0.7;
    for (let i = 0; i < segs; i++) {
      const p0 = -over + ((2 * over) / segs) * i;
      const p1 = p0 + (2 * over) / segs;
      const pm = (p0 + p1) / 2;
      const w = 2 * r * Math.sin((p1 - p0) / 2) + 0.04;
      // Sobre el hall del segundo piso la chapa no vuela al oeste: ahí la
      // parte oeste del bloque es más alta y el alero se metía en el hall
      // (se veía su testa desde adentro).
      const va = Math.min(arcV(p0), arcV(p1));
      const vb = Math.max(arcV(p0), arcV(p1));
      const overHall = vb > V1.blockA && va < V1.blockHall;
      const segMid = overHall ? (u0 + 0.01 + U.e + 0.35) / 2 : uMid;
      const segLen = overHall ? U.e + 0.35 - (u0 + 0.01) : uLen;
      const pos = toWorld(this.k.f, segMid, arcV(pm));
      this.k.farm.add('box', m.gymRoof, new Vector3(pos.x, arcY(pm), pos.z), new Vector3(segLen, 0.1, w), 0, pm);
      // Cara interior oscura de la chapa, sólo sobre el polideportivo.
      const inner = toWorld(this.k.f, (U.gymW + U.e) / 2, arcV(pm, r - 0.08));
      this.k.farm.add('box', m.metalDark, new Vector3(inner.x, arcY(pm, r - 0.08), inner.z), new Vector3(U.e - U.gymW, 0.04, w), 0, pm);
      // Franjas de policarbonato traslúcido de alero a alero (9:22–9:28).
      // 2 cm más angostas que la chapa: en los aleros sus testas quedaban en
      // el plano de las de la chapa y titilaban.
      for (const us of [54.58, 60.28, 65.98].map(planU)) {
        const sp = toWorld(this.k.f, us, arcV(pm, r + 0.03));
        this.k.farm.add('box', m.light, new Vector3(sp.x, arcY(pm, r + 0.03), sp.z), new Vector3(1.0, 0.1, w - 0.02), 0, pm);
        const ip = toWorld(this.k.f, us, arcV(pm, r - 0.1));
        this.k.farm.add('box', m.light, new Vector3(ip.x, arcY(pm, r - 0.1), ip.z), new Vector3(1.0, 0.04, w - 0.02), 0, pm);
      }
    }
    // Cielorraso blanco de placas que sigue la curva sobre el aula de danzas.
    const dMid = (u0 + U.gymW) / 2;
    for (let i = 0; i < segs; i++) {
      const p0 = -half + ((2 * half) / segs) * i;
      const p1 = p0 + (2 * half) / segs;
      const pm = (p0 + p1) / 2;
      const rr = r - 0.14;
      const w = 2 * rr * Math.sin((p1 - p0) / 2) + 0.03;
      const pos = toWorld(this.k.f, dMid, arcV(pm, rr));
      this.k.farm.add('box', m.ceiling, new Vector3(pos.x, arcY(pm, rr), pos.z), new Vector3(U.gymW - u0, 0.04, w), 0, pm);
    }
    // Cabriadas curvas bajo la chapa, sobre cada pilastra.
    for (const u of GYM_PILASTERS) {
      for (let i = 0; i < 10; i++) {
        const p0 = -half + ((2 * half) / 10) * i;
        const p1 = p0 + (2 * half) / 10;
        const pm = (p0 + p1) / 2;
        const rr = r - 0.35;
        const w = 2 * rr * Math.sin((p1 - p0) / 2) + 0.04;
        const pos = toWorld(this.k.f, u, arcV(pm, rr));
        this.k.farm.add('box', m.metalDark, new Vector3(pos.x, arcY(pm, rr), pos.z), new Vector3(0.14, 0.3, w), 0, pm);
      }
      // Tensor horizontal.
      this.k.box(m.metalDark, u, vc, 0.08, 0.08, chord - 0.4, wallTop - 0.2);
      // Luminarias colgadas.
      for (const v of [vc - 5.5, vc, vc + 5.5]) {
        this.k.box(m.light, u, v, 0.5, 0.12, 0.5, wallTop - 0.6);
        this.k.note(u, v, 0.5, 0.5, wallTop - 0.6, 'gym', 'gimnasio', LEVEL_Y[0]);
      }
    }
    /** Altura de la bóveda (cara interior) en v. */
    const archY = (v: number) => yc + Math.sqrt(Math.max(0, r * r - (v - vc) * (v - vc)));
    // Tímpanos: el este, ciego; el del oeste del polideportivo, ahora interior,
    // de chapa azul con las tres ventanas del aula de danzas; y el del muro de
    // los espejos, con cuatro ventanas altas al cielo y el paso al hall.
    this.gable(m.facade, U.e - 0.15, U.e + 0.15, wallTop, archY, []);
    // Cara interior gris del testero este (9:28).
    this.gable(m.gymWall, U.e - 0.17, U.e - 0.15, wallTop, archY, []);
    const danceWin: Array<[number, number, number, number]> = [
      [-11.0, -9.5, 7.52, 8.57],
      [-7.9, -6.4, 7.52, 8.57],
      [-4.8, -3.3, 7.52, 8.57],
    ].map(([v0, v1, y0, y1]): [number, number, number, number] => [planV(v0), planV(v1), y0, y1]);
    this.gable(m.blueSheet, U.gymW, U.gymW + 0.12, wallTop, archY, danceWin);
    this.gable(m.white, U.gymW - 0.12, U.gymW, wallTop, archY, danceWin);
    for (const [v0, v1, y0, y1] of danceWin) {
      // Corredizas blancas con malla romboidal del lado del polideportivo.
      this.k.box(m.glass, U.gymW, (v0 + v1) / 2, 0.02, y1 - y0, v1 - v0, y0);
      this.k.box(m.frame, U.gymW, (v0 + v1) / 2, 0.14, 0.05, v1 - v0, y0);
      this.k.box(m.frame, U.gymW, (v0 + v1) / 2, 0.14, 0.05, v1 - v0, y1 - 0.05);
      for (let v = v0 + 0.1; v < v1; v += 0.12) this.k.box(m.mesh, U.gymW + 0.16, v, 0.012, y1 - y0, 0.012, y0);
    }
    // La primera, junto a Laprida, baja a 9,10: con 9,25 tocaba la bóveda
    // (que son cuerdas planas, por debajo del arco) y el cielorraso cortaba
    // la esquina del vidrio.
    const mirrorWin: Array<[number, number, number, number]> = [
      ...([
        [-5.45, -4.55, 8.85, 9.1],
        [-7.65, -6.75, 8.85, 9.35],
        [-9.85, -8.95, 8.85, 9.45],
        [-12.05, -11.15, 8.85, 9.45],
      ] as const).map(([v0, v1, y0, y1]): [number, number, number, number] => [planV(v0), planV(v1), y0, y1]),
      // Paso del hall del segundo piso, bajo la bóveda.
      [V1.blockA, V1.blockHall, 2 * H, 8.75],
    ];
    this.gable(m.facade, u0 - 0.15, u0 + 0.15, 2 * H, archY, mirrorWin);
    // Sobre el hall del segundo piso, la parte oeste (dos plantas, techo
    // plano a 3 pisos) es más alta que la bóveda: entre la curva del tímpano
    // y ese techo quedaba un triángulo abierto por el que se veía el cielo y
    // la testa de la chapa desde adentro del hall. Se cierra con el mismo
    // tímpano (blanco hacia el hall, revoque hacia afuera).
    const fill: Array<[number, number]> = [];
    for (let k = 0; k <= 8; k++) {
      const v = V1.blockA + ((V1.blockHall - V1.blockA) * k) / 8;
      fill.push([v, archY(v) - 0.05]);
    }
    fill.push([V1.blockHall, 3 * H + 0.05], [V1.blockA, 3 * H + 0.05]);
    this.k.prisms.alongU(m.white, fill, u0 - 0.15, u0);
    this.k.prisms.alongU(m.facade, fill, u0, u0 + 0.15);
    for (const [v0, v1, y0, y1] of mirrorWin.slice(0, 4)) this.k.box(m.glassDark, u0, (v0 + v1) / 2, 0.06, y1 - y0, v1 - v0, y0);
    // Testero este: dos franjas rojo-blanco-azul a los lados de la bandera,
    // con el azul hacia el centro y más alto (9:28).
    const face = U.e - SCHOOL.extT / 2 - 0.02;
    for (const side of [-1, 1]) {
      const bc = GYM_MID + side * 4.25;
      const bars: Array<[Material, number]> = [
        [m.red, 6.9],
        [m.slab, 7.6],
        [m.navy, 8.4],
      ];
      bars.forEach(([mat, top], k) => {
        // k = 0 afuera (rojo) … k = 2 adentro (azul).
        const bv = bc - side * (k - 1) * 0.3;
        this.k.box(mat, face, bv, 0.04, top - 0.1, 0.3, FY + 0.1);
      });
    }
    // Columnas reticuladas blancas sobre cada pilastra, hasta la bóveda.
    for (const u of GYM_PILASTERS) {
      for (const v of [V.gymTop + 0.3, -0.45]) {
        for (const sgn of [-1, 1]) this.k.box(m.frame, u + sgn * 0.15, v, 0.06, wallTop - 2.75, 0.06, 2.75);
        for (let y = 3.2; y < wallTop; y += 0.9) this.k.box(m.frame, u, v, 0.3, 0.04, 0.04, y);
      }
    }
    // Zócalo gris oscuro y portón de chapa de la salida a Laprida.
    this.k.box(m.metalDark, planU(51.8), 0.05, 2.2, 0.16, 0.1, 2.5);
  }

  /**
   * Tímpano bajo la bóveda en u0..u1, desde `yb` hasta la curva, con huecos
   * rectangulares [v0, v1, y0, y1]: se arma en franjas verticales entre los
   * bordes de los huecos.
   */
  private gable(
    mat: Material,
    u0: number,
    u1: number,
    yb: number,
    archY: (v: number) => number,
    holes: ReadonlyArray<readonly [number, number, number, number]>,
  ): void {
    const cuts = new Set<number>([V.gymTop, 0]);
    for (const [v0, v1] of holes) {
      cuts.add(Math.max(V.gymTop, Math.min(0, v0)));
      cuts.add(Math.max(V.gymTop, Math.min(0, v1)));
    }
    const vs = [...cuts].sort((a, b) => a - b);
    for (let k = 0; k < vs.length - 1; k++) {
      const va = vs[k];
      const vb = vs[k + 1];
      if (vb - va < 0.01) continue;
      const vm = (va + vb) / 2;
      // Tramos sólidos en altura: de yb a la curva, menos los huecos de esta franja.
      const spans = holes
        .filter(([h0, h1]) => Math.min(h0, h1) <= vm && Math.max(h0, h1) >= vm)
        .map(([, , y0, y1]) => [y0, y1] as const)
        .sort((x, y) => x[0] - y[0]);
      let y = yb;
      const steps = Math.max(1, Math.ceil((vb - va) / 1.2));
      const arch: P[] = [];
      for (let i = steps; i >= 0; i--) {
        const v = va + ((vb - va) * i) / steps;
        arch.push([v, archY(v)]);
      }
      for (const [y0, y1] of spans) {
        if (y0 > y + 0.01) {
          this.k.prisms.alongU(
            mat,
            [
              [va, y],
              [vb, y],
              [vb, y0],
              [va, y0],
            ],
            u0,
            u1,
          );
        }
        y = Math.max(y, y1);
      }
      // Las franjas de los extremos apoyan en los aleros (la curva vale yb
      // ahí): se cierran con los puntos de la curva que quedan por encima.
      const crown = arch.filter(([, ay]) => ay > y + 0.01);
      if (crown.length) this.k.prisms.alongU(mat, [[va, y], [vb, y], ...crown], u0, u1);
    }
  }

  // ================================================================ escaleras

  private stair(s: Stair): void {
    const m = this.k.m;
    const n = riserCount(s);
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const from = s.dir === 'u+' ? s.u0 : s.dir === 'u-' ? s.u1 : s.dir === 'v+' ? s.v0 : s.v1;
    const to = s.dir === 'u+' ? s.u1 : s.dir === 'u-' ? s.u0 : s.dir === 'v+' ? s.v1 : s.v0;
    const run = (to - from) / n;
    // Los tramos que arrancan en planta baja son macizos; los de los pisos
    // altos, una losa escalonada con luz por debajo (también la escalera
    // exterior de chapa del comedor).
    const solid = s.y0 < 0.5 && !s.hollow;
    // La de chapa del edificio de bloque es negra, con baranda negra (8:12).
    const chequer = s.u0 >= U1.blockStair0 - 0.01 && s.y0 >= 3;
    // Huellas de chapa semilla de melón (relieve también en VR, 8:37–8:41).
    const tread = chequer ? m.metalTread : m.stair;
    // La del jardín tiene pasamanos negro (11:49–13:06).
    // Video 2026: la blanca del comedor tiene baranda de caño rojo.
    const rail = chequer || s.u0 >= U.teaE - 0.01 ? m.metalDark : s.hollow && !s.guard ? m.frame : m.red;
    for (let i = 0; i < n; i++) {
      const c = from + run * (i + 0.5);
      const top = FY + s.y0 + ((i + 1) * (s.y1 - s.y0)) / n;
      const bottom = solid ? 0 : top - 0.24;
      if (alongU) this.k.box(tread, c, (s.v0 + s.v1) / 2, Math.abs(run) + 0.01, top - bottom, s.v1 - s.v0, bottom);
      else this.k.box(tread, (s.u0 + s.u1) / 2, c, s.u1 - s.u0, top - bottom, Math.abs(run) + 0.01, bottom);
      // La de chapa no lleva nariz clara: la huella es la chapa entera.
      if (chequer) continue;
      // Nariz de escalón clara (las del acceso llevan una franja amarilla).
      if (!this.k.detailed && i > 0 && i < n - 1) continue;
      // Narices amarillas en el primer escalón y en la llegada (0:19, 1:35).
      // La del hall (chapa perforada, video 2026) tiene los escalones grises
      // lisos: las amarillas son de la otra escalera.
      const yellow = !chequer && s.guard !== 'perforated' && (i === n - 1 || (i === 0 && s.y0 < 0.5));
      const nose = yellow ? m.yellow : m.slab;
      if (alongU) this.k.box(nose, c - run * 0.45, (s.v0 + s.v1) / 2, 0.05, 0.02, s.v1 - s.v0, top);
      else this.k.box(nose, (s.u0 + s.u1) / 2, c - run * 0.45, s.u1 - s.u0, 0.02, 0.05, top);
    }
    const rise = s.y1 - s.y0;
    const length = Math.abs(to - from);
    const ang = Math.atan2(rise, length);
    const hyp = Math.hypot(rise, length);
    const yMid = FY + (s.y0 + s.y1) / 2;
    // Giro que inclina una caja a lo largo del tramo (+u es −x en el mundo:
    // subir hacia +u levanta el extremo −X).
    const east = toWorld(this.k.f, 1, 0).x < toWorld(this.k.f, 0, 0).x;
    const tilt = alongU ? (east ? -1 : 1) * (s.dir === 'u+' ? ang : -ang) : s.dir === 'v+' ? -ang : ang;
    const sloped = (mat: Material, across: number, y: number, thick: number, width: number, long = hyp) => {
      const p = alongU ? toWorld(this.k.f, (s.u0 + s.u1) / 2, across) : toWorld(this.k.f, across, (s.v0 + s.v1) / 2);
      if (alongU) this.k.farm.add('box', mat, new Vector3(p.x, y, p.z), new Vector3(long, thick, width), 0, 0, tilt);
      else this.k.farm.add('box', mat, new Vector3(p.x, y, p.z), new Vector3(width, thick, long), 0, tilt, 0);
    };
    const mid = alongU ? (s.v0 + s.v1) / 2 : (s.u0 + s.u1) / 2;
    const width = alongU ? s.v1 - s.v0 : s.u1 - s.u0;
    if (!solid) {
      // Debajo: losa inclinada lisa (hormigón) o dos zancas (chapa), en vez
      // del serrucho de escalones sueltos que se veía desde abajo. Su cara
      // superior pasa por el pie de cada contrahuella y baja 26 cm.
      if (s.hollow || chequer) {
        // Las zancas de la de chapa siguen de hierro pintado.
        // La blanca del comedor (video 2026) tiene zancas de mampostería
        // blanca, más altas: el costado se lee macizo y blanco.
        const deep = s.guard === 'rails' ? 0.42 : 0.26;
        for (const sgn of [-1, 1]) sloped(chequer ? m.metalDark : s.guard === 'rails' ? m.facade : tread, mid + sgn * (width / 2 - 0.03), yMid - deep / 2, deep * Math.cos(ang), 0.06);
      } else {
        sloped(tread, mid, yMid - 0.13, 0.26 * Math.cos(ang), width);
      }
    }
    // Pasamanos a 0,9 m sobre la línea de los escalones. Del lado de un muro
    // va sobre ménsulas; del lado abierto, sobre parantes con travesaño medio
    // (antes era un caño suelto flotando en el aire).
    const runAt = (t: number) => from + (to - from) * t;
    const treadTop = (t: number) => FY + s.y0 + (Math.min(n - 1, Math.floor(t * n)) + 1) * (rise / n);
    // Pasamanos y travesaño terminan al ras del primer y del último parante
    // (antes asomaban ~25 cm al aire en cada descanso).
    const railLong = hyp * 0.88 + 0.04;
    for (const side of [0, 1]) {
      const edge = alongU ? (side ? s.v1 : s.v0) : side ? s.u1 : s.u0;
      const inward = side ? -1 : 1;
      const face = this.stairSideWall(s, edge, inward);
      const walled = face !== null;
      // Del lado del muro, a 4 cm de su cara (más el radio del caño): antes
      // se medía desde el borde del tramo y quedaba a 10–15 cm del muro, o
      // metido dentro.
      const across = face !== null ? face + inward * 0.065 : edge + inward * 0.04;
      if (!walled && s.guard) {
        this.stairGuard2026(s, rail, sloped, across, yMid, rise, length, railLong, runAt, treadTop);
        continue;
      }
      if (!walled && s.meshGuard) {
        this.stairMesh(s, rail, sloped, across, yMid, rise, length, railLong, runAt, treadTop);
        continue;
      }
      sloped(rail, across, yMid + 0.9, 0.05, 0.05, railLong);
      const posts = Math.max(2, Math.round(length / 1.1) + 1);
      for (let k = 0; k < posts; k++) {
        const t = 0.06 + (0.88 * k) / (posts - 1);
        const at = runAt(t);
        const railY = yMid + 0.9 + (t - 0.5) * rise;
        if (face !== null) {
          // Ménsula desde la cara del muro hasta debajo del caño (también en
          // VR: sin ella el pasamanos flotaba).
          const c = face + inward * 0.0325;
          const [bu, bv] = alongU ? [at, c] : [c, at];
          this.k.box(rail, bu, bv, alongU ? 0.03 : 0.065, 0.03, alongU ? 0.065 : 0.03, railY - 0.05);
        } else {
          const [pu, pv] = alongU ? [at, across] : [across, at];
          const y0 = treadTop(t);
          this.k.box(rail, pu, pv, 0.04, railY - y0, 0.04, y0);
        }
      }
      if (!walled && this.k.detailed) sloped(rail, across, yMid + 0.45, 0.03, 0.03, railLong);
    }
  }

  /**
   * Barandas del video de 2026 en el lado abierto de un tramo, ~1 m sobre la
   * línea de los escalones. `perforated` (la del hall): marco de caño rojo
   * con tres paños de chapa perforada clara separados por parantes.
   * `rails` (la blanca del comedor): caño rojo con pasamanos, dos travesaños
   * paralelos a la pendiente y parantes en las puntas y el medio. La colisión
   * es la misma barrera del costado de siempre.
   */
  private stairGuard2026(
    s: Stair,
    red: Material,
    sloped: (mat: Material, across: number, y: number, thick: number, width: number, long?: number) => void,
    across: number,
    yMid: number,
    rise: number,
    length: number,
    railLong: number,
    runAt: (t: number) => number,
    treadTop: (t: number) => number,
  ): void {
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const ang = Math.atan2(rise, length);
    const H_TOP = s.guard === 'perforated' ? 1.0 : 0.95;
    sloped(red, across, yMid + H_TOP, 0.045, 0.045, railLong);
    if (s.guard === 'perforated') {
      // Zócalo del marco y el paño claro entre él y el pasamanos (chapa
      // perforada blanca rosada: con el blanco de los marcos, sin material nuevo).
      sloped(red, across, yMid + 0.14, 0.035, 0.035, railLong);
      sloped(this.k.m.frame, across, yMid + (H_TOP + 0.14) / 2, (H_TOP - 0.18) * Math.cos(ang), 0.012, railLong);
    } else {
      for (const y of [0.35, 0.65]) sloped(red, across, yMid + y, 0.032, 0.032, railLong);
    }
    // Parantes: puntas y divisiones de los paños (o el del medio).
    const ts = s.guard === 'perforated' ? [0, 1 / 3, 2 / 3, 1] : [0, 0.5, 1];
    for (const f of ts) {
      const t = 0.06 + 0.88 * f;
      const at = runAt(t);
      const railY = yMid + H_TOP + (t - 0.5) * rise;
      const y0 = f === 0 || f === 1 ? treadTop(t) : yMid + 0.12 + (t - 0.5) * rise;
      const [pu, pv] = alongU ? [at, across] : [across, at];
      this.k.box(red, pu, pv, 0.045, railY - y0, 0.045, y0);
    }
  }

  /**
   * Paño de metal desplegado con marco, del color del pasamanos, en el lado
   * abierto de un tramo: rojo en la escalera del hall (0:19), blanco en la
   * exterior del comedor (9:44–9:47). ~1 m sobre la línea de los escalones.
   * La trama es una grilla fina de tiras (más abierta en el visor); la
   * colisión es la misma barrera del costado de siempre.
   */
  private stairMesh(
    s: Stair,
    red: Material,
    sloped: (mat: Material, across: number, y: number, thick: number, width: number, long?: number) => void,
    across: number,
    yMid: number,
    rise: number,
    length: number,
    railLong: number,
    runAt: (t: number) => number,
    treadTop: (t: number) => number,
  ): void {
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const H_TOP = 1.0;
    // Marco: pasamanos, zócalo y los dos parantes de punta.
    sloped(red, across, yMid + H_TOP, 0.05, 0.05, railLong);
    sloped(red, across, yMid + 0.12, 0.04, 0.04, railLong);
    const step = this.k.detailed ? 0.1 : 0.2;
    for (let y = 0.12 + step; y < H_TOP - 0.03; y += step) sloped(red, across, yMid + y, 0.008, 0.012, railLong);
    const cols = Math.max(2, Math.round((length * 0.88) / step));
    for (let k = 0; k <= cols; k++) {
      const t = 0.06 + (0.88 * k) / cols;
      const end = k === 0 || k === cols;
      const at = runAt(t);
      const railY = yMid + H_TOP + (t - 0.5) * rise;
      const y0 = end ? treadTop(t) : yMid + 0.12 + (t - 0.5) * rise;
      const [pu, pv] = alongU ? [at, across] : [across, at];
      const thick = end ? 0.05 : 0.008;
      this.k.box(red, pu, pv, alongU ? thick : 0.012, railY - y0, alongU ? 0.012 : thick, y0);
    }
  }

  /**
   * Cara del muro (o del tabique entre tramos) pegado a este costado del
   * tramo, del lado de la escalera; `null` si el costado está abierto. Un
   * muro bajo cuenta sólo si llega a la altura del pasamanos: la oficina bajo
   * la escalera de chapa (1,35 m) y el tabique de la escalera principal
   * dejaban caños flotando hasta 3 m por encima.
   */
  private stairSideWall(s: Stair, edge: number, inward: number): number | null {
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const level = Math.min(2, Math.floor((s.y0 + 0.01) / H));
    const lo = alongU ? s.u0 : s.v0;
    const hi = alongU ? s.u1 : s.v1;
    const railTop = FY + s.y1 + 0.85;
    for (const w of WALLS) {
      if (w.level !== level) continue;
      const parallel = alongU ? Math.abs(w.a[1] - w.b[1]) < 0.01 : Math.abs(w.a[0] - w.b[0]) < 0.01;
      if (!parallel) continue;
      const line = alongU ? w.a[1] : w.a[0];
      const t = w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT;
      if (Math.abs(line - edge) > t / 2 + 0.12) continue;
      const a = alongU ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
      const b = alongU ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
      if (Math.min(b, hi) - Math.max(a, lo) <= (hi - lo) * 0.5) continue;
      // Muro de piso entero (sigue arriba) o que pasa la altura del pasamanos.
      if (w.h < H - 0.01 && w.level * H + w.h < railTop) continue;
      return line + inward * (t / 2);
    }
    return null;
  }

  /** Vigas negras del aula de danzas, de columna roja a columna roja. */
  private salonBeams(): void {
    for (const v of SALON_COLUMNS) {
      this.k.box(this.k.m.metalDark, (U.salonW + U.gymW) / 2, v, U.gymW - U.salonW - 0.2, 0.26, 0.2, FY + 3.1 - 0.26);
    }
  }

  /** Descansos de las escaleras. */
  private cores(): void {
    // Descansos: macizos los bajos, losa los de los pisos altos.
    for (const l of LANDINGS) {
      const top = FY + l.y;
      // El descanso de la escalera de chapa del edificio de bloque es de chapa
      // como sus tramos (8 cm, no una losa gris de 24), con un parante en la
      // única esquina que no apoya en un muro ni en un tramo.
      const steel = l.u0 >= U1.blockStair0 - 0.01 && l.y >= 3;
      const bottom = steel ? top - 0.08 : l.y < 3 && !l.hollow ? 0 : top - 0.24;
      // El descanso de chapa, de la misma chapa semilla de melón que los tramos.
      this.k.box(steel ? this.k.m.metalTread : this.k.m.stair, (l.u0 + l.u1) / 2, (l.v0 + l.v1) / 2, l.u1 - l.u0, top - bottom, l.v1 - l.v0, bottom);
      if (steel) this.k.box(this.k.m.metalDark, l.u1 - 0.05, l.v1 - 0.05, 0.08, bottom - LEVEL_Y[1], 0.08, LEVEL_Y[1]);
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
    const m = this.k.m;
    // Centrado en el frente del hall del CAD (antes, en el del plano de S&O).
    const { u0, u1 } = PORTAL;
    const uc = (u0 + u1) / 2;
    const w = u1 - u0;
    // El portal sobresale ~0,85 m de la fachada y sube a ~8,2 m (0:09–0:16).
    // Arriba es un marco gris grafito que deja ver las tres ventanas enrejadas
    // del primer piso (la Secretaría y 6° BD), con su retiro hasta el muro.
    const front = PORTAL.front;
    const depth = 0.2;
    const vf = front - depth / 2;
    const y0 = 4.0;
    const top = 8.2;
    // Las tres ventanas del primer piso que enmarca: las del muro del primer
    // piso (SchoolUpper), así el recorte del paño siempre coincide con ellas.
    const wins = PORTAL_WINDOWS;
    const wy0 = H + 1.45;
    const wy1 = H + 2.85;
    // Paño frontal, cortado alrededor de las ventanas.
    this.k.box(m.portal, uc, vf, w, top - wy1, depth, wy1);
    this.k.box(m.portal, uc, vf, w, wy0 - y0, depth, y0);
    let prev = u0;
    for (const [a, b] of wins) {
      this.k.box(m.portal, (prev + a) / 2, vf, a - prev, wy1 - wy0, depth, wy0);
      prev = b;
    }
    this.k.box(m.portal, (prev + u1) / 2, vf, u1 - prev, wy1 - wy0, depth, wy0);
    // Laterales y retiros de las ventanas hasta la fachada.
    // Los laterales son del gris claro de las aulas (0:12, Street View).
    // Terminan en la cara trasera del paño grafito: hasta el frente, sus
    // caras compartían el plano del paño y titilaban en la primera vista.
    for (const u of [u0 + 0.1, u1 - 0.1]) this.k.box(m.facade, u, (front - depth) / 2, 0.2, top - y0, front - depth, y0);
    for (const [a, b] of wins) {
      this.k.box(m.portal, (a + b) / 2, front / 2, b - a, 0.08, front - depth, wy0 - 0.08);
      this.k.box(m.portal, (a + b) / 2, front / 2, b - a, 0.08, front - depth, wy1);
      for (const u of [a + 0.04, b - 0.04]) this.k.box(m.portal, u, front / 2, 0.08, wy1 - wy0, front - depth, wy0);
      // Escuela 2050: en lugar de la reja negra, tres parasoles verticales
      // grafito en el plano del frente, entre los dos marcos salientes.
      for (const f of [0.2, 0.5, 0.8]) this.k.box(m.graphite, a + (b - a) * f, front + 0.1, 0.05, wy1 - wy0, 0.22, wy0);
      this.k.box(m.portal, (a + b) / 2, front + 0.03, b - a + 0.3, 0.15, 0.06, wy1);
      this.k.box(m.portal, (a + b) / 2, front + 0.03, b - a + 0.3, 0.15, 0.06, wy0 - 0.15);
    }
    // Losa inferior del volumen saliente.
    this.k.box(m.portal, uc, front / 2, w, 0.12, front, y0 - 0.12);
    // Franjas rojo-blanco-azul como líneas finas arriba del todo (el blanco,
    // luz), así queda lugar para el escudo grande con su disco LED detrás
    // (el escudo lo dibuja `SchoolIdentity`: centro en 7,0 m, 1,3 m).
    for (const [y, mat] of [
      [7.8, m.red],
      [7.9, m.light],
      [8.0, m.navy],
    ] as const) {
      this.k.box(mat, uc, front + 0.02, w, 0.06, 0.04, y);
    }
    const disc = toWorld(this.k.f, (PORTAL.g0 + PORTAL.g1) / 2, front + 0.008);
    this.k.farm.add('cylinderHi', m.ledWarm, new Vector3(disc.x, 7.0, disc.z), new Vector3(1.5, 0.012, 1.5), 0, Math.PI / 2);
    // Marquesina roja con filetes (2,45–3,85 m); el texto va en el atlas. Con
    // LED cálido en los cantos de abajo y de arriba del frente.
    this.k.box(m.red, uc, front - 0.15, 8.25, 1.4, 0.3, 2.45);
    for (const y of [2.43, 3.85]) this.k.box(m.ledWarm, uc, front - 0.005, 8.25, 0.025, 0.025, y);
    // Banda roja del primer piso del edificio de bloque, al este del portal (0:15).
    this.k.box(m.red, (U.salonW + U.gymW) / 2, 0.17, U.gymW - U.salonW, 0.6, 0.04, 3.05);
    // Planta baja: dos pilares revestidos en granito y tres columnas azul
    // marino, con la reja de malla cuadrada de toda la altura (2020) y su
    // portón abierto frente a las puertas.
    // Pilares, columnas y reja salen de SchoolLayout (la colisión usa las
    // mismas medidas).
    const { g0, g1 } = PORTAL;
    const span = (r: { u0: number; v0: number; u1: number; v1: number }) => [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2, r.u1 - r.u0, r.v1 - r.v0] as const;
    for (const r of PORTAL_PILLARS) {
      const [cu, cv, wu, dv] = span(r);
      this.k.box(m.stone, cu, cv, wu, 2.45, dv, 0);
    }
    // Columnas azul marino: a los costados del portón y en su medio, frente
    // al centro de la entrada (0:16), y la tercera junto al pilar del este.
    for (const r of PORTAL_COLUMNS) {
      const [cu, cv, wu, dv] = span(r);
      this.k.box(m.navy, cu, cv, wu, 2.45, dv, 0.12);
    }
    // Escuela 2050: la reja de malla del portal pasa a dos paños grandes de
    // vidrio (uno a cada lado del portón), con la misma colisión.
    for (const [a, b] of PORTAL_RAILS) this.glassRail(a, b, 0.12, 2.44, 4);
    // Escalinata de tres huellas hasta el nivel del vestíbulo, entre los pilares.
    const s0 = g0 + 0.8;
    const s1 = g1 - 0.8;
    for (const [v0, v1, h] of [
      [1.4, 2.0, 0.08],
      [0.8, 1.4, 0.1],
      [0, 0.8, FY],
    ] as const) {
      this.k.box(m.slab, (s0 + s1) / 2, (v0 + v1) / 2, s1 - s0, h, v1 - v0, 0);
    }
    // Mástil inclinado con la bandera, a la izquierda del portal.
    const p = toWorld(this.k.f, u0 - 0.2, 1.1);
    this.k.farm.add('box', m.metal, new Vector3(p.x, 5.35, p.z + 0.35), new Vector3(0.06, 0.06, 1.9), 0, -0.6);
  }

  /**
   * Fachada del jardín sobre la calle de atrás (10:38–10:41): banda vertical
   * azul marino con "CIMDIP" hasta el pretil gris, marquesina roja de
   * "Educación Inicial" sobre las puertas y un pilar rojo entre ventanas.
   */
  private jardinFacade(): void {
    const m = this.k.m;
    const v = V.top - 0.21;
    // Banda azul marino con CIMDIP en el extremo oeste (a la derecha de quien
    // mira desde la calle), marquesina roja saliente con su cielorraso gris,
    // pilar rojo entre las ventanas del primer piso, antepecho rojo del
    // segundo, pretil gris y columna de borde gris al este.
    // Posiciones del plano (`planU`); los paños que van de muro a muro
    // (marquesina, antepecho, pretil) se agrandan con la fachada, las
    // piezas de medida (banda, pilar, columna de borde) no.
    this.k.box(m.navy, planU(58.525), v, 1.75, 8.9, 0.1, 0);
    this.k.box(m.red, planU(63.3), V.top - 0.55, 8.2 * SC, 0.9, 0.8, 2.75);
    this.k.box(m.slab, planU(63.3), V.top - 0.55, 8.2 * SC, 0.04, 0.8, 2.71);
    this.k.box(m.red, planU(62.3), v + 0.15, 0.4, 1.3, 0.08, H + 0.95);
    this.k.box(m.jardinRed, planU(63.2), V.top - 0.2, 7.6 * SC, 1.9, 0.1, 5.6);
    this.k.box(m.facade, planU(62.525), V.top - 0.18, 9.75 * SC, 1.0, 0.06, 8.9);
    this.k.box(m.facade, U.e - 0.2, v, 0.4, 9.9, 0.12, 0);
  }

  /**
   * Coronamiento de Laprida (Escuela 2050). En el video, las puntas de las
   * chapas asomaban sobre los muros como un remate de sierra (0:04,
   * 2:01–2:07), que en la escuela se leía como almenas o vidrio roto. Ahora
   * los pretiles llevan albardilla grafito con LED (`upperFloors`); acá va la
   * del tramo de Laprida que sube por encima del pretil (al este del escalón
   * de u ≈ 11,1, que sigue como en el video), con su vuelta en el escalón.
   * Va justo después de la franja de frente de `SchoolOutdoor` (el orden de
   * la granja es el de siempre).
   */
  private crest(): void {
    const m = this.k.m;
    const t = SCHOOL.extT;
    const pretil = 2 * H + 0.04 + 0.55;
    for (const [a, b, h] of [
      [U.w, CREST.step, CREST.west],
      [CREST.step, U.east1, CREST.east],
    ] as const) {
      const y = H + h;
      if (y <= pretil + 0.06) continue;
      // a→b corre hacia +u: la normal izquierda es +v, la calle.
      this.coping([a - 0.03, 0], [b, 0], t, y, 0, 1);
      // Vuelta en el escalón: tapa grafito del canto que queda sobre el pretil.
      if (a > U.w + 0.01) this.k.box(m.graphite, a - 0.015, 0, 0.03, y + 0.05 - pretil - 0.05, t + 0.06, pretil + 0.05);
    }
  }

  /**
   * Cerco de la línea municipal, Escuela 2050: el muro bajo rojo del video
   * (0:04–0:08) sigue igual; encima, en lugar de ~300 barrotes negros, paños
   * de vidrio de ~2 m entre parantes grafito finos, con pasamanos de madera y
   * una tira LED cálida debajo. La colisión es la misma (`FENCES`).
   */
  private fences(): void {
    const m = this.k.m;
    for (const [a, b] of FENCES) {
      this.k.piece(m.red, a, b, 0.3, 0, 0.45);
      this.glassRail(a, b, 0.45, 1.98);
    }
  }

  /**
   * Baranda o cerco de vidrio de a→b, de `y0` a `y1`: paños de ~2 m entre
   * parantes grafito, pasamanos de madera arriba y una tira LED cálida bajo
   * el pasamanos (de los dos lados). `step`: largo máximo de cada paño.
   */
  private glassRail(a: P, b: P, y0: number, y1: number, step = 2): void {
    const m = this.k.m;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return;
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const at = (d: number): P => [a[0] + du * d, a[1] + dv * d];
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const d0 = (k * len) / n;
      const d1 = ((k + 1) * len) / n;
      this.k.piece(m.glass, at(d0 + 0.03), at(d1 - 0.03), 0.02, y0 + 0.03, y1 - 0.05);
    }
    for (let k = 0; k <= n; k++) {
      const d = Math.min(len - 0.025, Math.max(0.025, (k * len) / n));
      this.k.piece(m.graphite, at(d - 0.025), at(d + 0.025), 0.05, y0, y1 - 0.06);
    }
    this.k.piece(m.timber, a, b, 0.09, y1 - 0.06, y1);
    this.k.piece(m.ledWarm, a, b, 0.03, y1 - 0.075, y1 - 0.06);
  }

  /**
   * Columnas de luz de la vereda de Laprida (Escuela 2050), donde estaban los
   * postes de hormigón con cruceta y los tres cables que cortaban el cielo en
   * todas las vistas: columna grafito de 6 m con brazo hacia la calzada y
   * cabezal LED. El tendido va enterrado: sin cables. Están en el borde del
   * cordón y son macizas (`STREET_LIGHTS`, ver `CityIndex`).
   */
  private utilityLines(): void {
    const m = this.k.m;
    const arm = 1.35;
    for (const [u, v] of STREET_LIGHTS) {
      this.k.cyl(m.graphite, u, v, 0.22, 0.45, 0, true);
      this.k.cyl(m.graphite, u, v, 0.12, 6.0, 0, true);
      // Brazo hacia la calzada (+v) y cabezal plano con la luz abajo.
      this.k.box(m.graphite, u, v + arm / 2, 0.05, 0.05, arm, 5.92);
      this.k.box(m.graphite, u, v + arm - 0.1, 0.24, 0.07, 0.62, 5.88);
      this.k.box(m.ledWarm, u, v + arm - 0.1, 0.18, 0.015, 0.54, 5.865);
    }
  }
}
