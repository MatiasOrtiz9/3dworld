import {
  FURNITURE,
  ITEMS,
  LANDINGS,
  LEVEL_Y,
  ROOMS,
  STAIRS,
  WALLS,
  hasFloor,
  inPoly,
  roomAt,
  roomLevel,
  type Facing,
  type Item,
  type Level,
  type Room,
} from '../SchoolLayout';
import { JARDIN_ROOMS } from '../SchoolJardin';
import type { NavGrid, NavPoint } from './NavGrid';

/**
 * Lugares de la gente, derivados del equipamiento de la escuela: asientos
 * (sillas, bancos, gradas, bordes de cantero), pizarrones, puestos del
 * personal y zonas. Datos puros: se calculan una vez a partir de `ITEMS` y de
 * la grilla de navegación, así que siguen al plano si el plano cambia.
 *
 * Alturas de asiento tomadas del constructor (`SchoolBuilder`): silla 0,48 m
 * (0,37 las de jardín, a escala 0,75), banco 0,48, banco del comedor 0,50,
 * banqueta 0,76, grada 0,42 por escalón, borde de cantero 0,60-0,65.
 */

/**
 * Altura REAL de la huella bajo (u, v) en una escalera (o del descanso), la
 * más cercana a `nearY`; NaN si ahí no hay escalera ni descanso.
 *
 * La simulación camina por `stairY`, una rampa que pasa por el medio de cada
 * huella: sirve para la colisión, pero un pie apoyado sobre la rampa queda
 * medio escalón hundido en la huella de adelante o flotando sobre la de
 * atrás. Para apoyar los pies se usa esta altura escalonada, la misma que
 * dibuja `SchoolBuilder.stair` (n contrahuellas de ~0,175 m; la huella i
 * está a (i + 1) / n de la altura del tramo).
 */
export function treadFloor(u: number, v: number, nearY: number): number {
  let best = NaN;
  let bestD = 0.5;
  for (const s of STAIRS) {
    if (u < s.u0 || u > s.u1 || v < s.v0 || v > s.v1) continue;
    const t =
      s.dir === 'u+' ? (u - s.u0) / (s.u1 - s.u0) : s.dir === 'u-' ? (s.u1 - u) / (s.u1 - s.u0) : s.dir === 'v+' ? (v - s.v0) / (s.v1 - s.v0) : (s.v1 - v) / (s.v1 - s.v0);
    const n = Math.max(4, Math.round((s.y1 - s.y0) / 0.175));
    const i = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
    const y = LEVEL_Y[0] + s.y0 + ((i + 1) * (s.y1 - s.y0)) / n;
    const d = Math.abs(y - nearY);
    if (d < bestD) {
      best = y;
      bestD = d;
    }
  }
  for (const l of LANDINGS) {
    if (u < l.u0 || u > l.u1 || v < l.v0 || v > l.v1) continue;
    const y = LEVEL_Y[0] + l.y;
    const d = Math.abs(y - nearY);
    if (d < bestD) {
      best = y;
      bestD = d;
    }
  }
  return best;
}

/** Hacia dónde mira algo con frente `face`, como rumbo en el mundo (0 = +z). */
export function faceYaw(face: Facing): number {
  return face === 's' ? 0 : face === 'n' ? Math.PI : face === 'e' ? -Math.PI / 2 : Math.PI / 2;
}

/** Dirección local (u, v) del frente. */
export function faceVec(face: Facing): [number, number] {
  return face === 'n' ? [0, -1] : face === 's' ? [0, 1] : face === 'e' ? [1, 0] : [-1, 0];
}

/** Rumbo en el mundo de una dirección local (u, v): el este (+u) es −x. */
export function yawOfLocal(du: number, dv: number): number {
  return Math.atan2(-du, dv);
}

export type SeatKind = 'chair' | 'bench' | 'bleacher' | 'ledge' | 'stool';

export interface Seat {
  id: number;
  /** Centro del asiento (local) y nivel. */
  u: number;
  v: number;
  level: Level;
  /** Altura de la tapa del asiento y de donde apoyan los pies (mundo). */
  y: number;
  footY: number;
  /** Rumbo (mundo) al que mira quien se sienta. */
  yaw: number;
  /** Frente local del asiento. */
  fu: number;
  fv: number;
  room: string;
  kind: SeatKind;
  /** Hay mesa o pupitre adelante: se sienta con los brazos encima. */
  desk: boolean;
  /**
   * La mesa de adelante medida: distancia horizontal del centro del asiento
   * al borde de la tapa (según el frente) y altura de la tapa (mundo). NaN si
   * no hay una tapa al alcance de las manos: ahí se apoyan en las piernas.
   */
  deskD: number;
  deskY: number;
  /** Silla de jardín (más baja). */
  small: boolean;
  /** Dónde se para antes de sentarse (local) y a qué altura (mundo). */
  au: number;
  av: number;
  ay: number;
  /**
   * Último tramo hasta `au, av`: desde una celda de la grilla, puntos
   * (u, v, y) — la `y` es NaN sobre el piso; las gradas se suben de a
   * escalón. Se calcula la primera vez; null = todavía no; [] = inaccesible.
   */
  lastMile: number[] | null;
  /** Ya se eligió dónde pararse (ver `Places.lastMile`). */
  ready: boolean;
}

export interface Board {
  room: string;
  level: Level;
  /** Dónde se para el docente (local); se resuelve con `Places.boardSpot`. */
  u: number;
  v: number;
  /** Rumbo para escribir (de cara al pizarrón) y para hablarle a la clase. */
  writeYaw: number;
  talkYaw: number;
  /** Frente del pizarrón (local) y si ya se buscó la celda libre delante. */
  fu: number;
  fv: number;
  ready: boolean;
  ok: boolean;
}

export type ClassKind = 'primary' | 'secondary' | 'kinder';

export interface Classroom {
  room: string;
  level: Level;
  kind: ClassKind;
  seats: Seat[];
  board: Board | null;
}

/** Aulas por nivel educativo (ids de `ROOMS`). */
const CLASS_KIND: Record<string, ClassKind> = {
  aula1: 'primary',
  aula2: 'primary',
  aula3: 'primary',
  aula4: 'primary',
  aula5: 'primary',
  aula6BD: 'primary',
  aula6AC: 'primary',
  aulaS1: 'secondary',
  aulaS2: 'secondary',
  aulaS3: 'secondary',
  aulaS4: 'secondary',
  aulaS5: 'secondary',
  aulaSec: 'secondary',
  aulaBloqueA: 'secondary',
  aulaBloqueC: 'secondary',
  aulaBloqueD: 'secondary',
  aulaC1: 'secondary',
  bilingue: 'secondary',
  tecnologia: 'secondary',
  salaAmarilla: 'kinder',
  salaRoja: 'kinder',
  salaCeleste: 'kinder',
  salaRosa: 'kinder',
};

/** Mobiliario que hace de mesa delante de una silla. */
const TABLES = new Set<Item['kind']>(['desk', 'table', 'teacherDesk', 'desk2', 'workbench', 'counter', 'longTable', 'hexTable', 'roundTable']);
/** Ambientes del jardín (sus sillas son para los más chicos). */
const JARDIN_IDS: ReadonlySet<string> = new Set(JARDIN_ROOMS.map((r) => r.id));

/** Altura de la tapa de cada mesa sobre el piso, como la dibuja `SchoolBuilder`. */
const TABLE_TOP: Partial<Record<Item['kind'], number>> = {
  desk: FURNITURE.deskTop,
  table: FURNITURE.tableTop,
  teacherDesk: 0.78,
  desk2: 0.78,
  workbench: 0.78,
  counter: 0.97,
  longTable: 0.78,
  hexTable: FURNITURE.tableTop,
  roundTable: FURNITURE.smallTable,
};

const itemLevel = (it: Item): Level => it.level ?? 0;

function rectOf(it: Item, pad = 0): { u0: number; v0: number; u1: number; v1: number } {
  return { u0: it.u - it.w / 2 - pad, v0: it.v - it.d / 2 - pad, u1: it.u + it.w / 2 + pad, v1: it.v + it.d / 2 + pad };
}

/** Grilla fina (10 cm) de un ambiente, con márgenes chicos: para el último tramo hasta un asiento. */
class RoomGrid {
  readonly u0: number;
  readonly v0: number;
  readonly nu: number;
  readonly nv: number;
  readonly free: Uint8Array;
  static readonly CELL = 0.1;

  constructor(readonly room: Room) {
    const level = roomLevel(room);
    let u0 = Infinity;
    let v0 = Infinity;
    let u1 = -Infinity;
    let v1 = -Infinity;
    for (const [u, v] of room.poly) {
      u0 = Math.min(u0, u);
      v0 = Math.min(v0, v);
      u1 = Math.max(u1, u);
      v1 = Math.max(v1, v);
    }
    const c = RoomGrid.CELL;
    this.u0 = u0;
    this.v0 = v0;
    this.nu = Math.max(1, Math.ceil((u1 - u0) / c));
    this.nv = Math.max(1, Math.ceil((v1 - v0) / c));
    this.free = new Uint8Array(this.nu * this.nv);
    // Obstáculos: muebles macizos con 12 cm de holgura, sillas ajenas casi
    // sin holgura (se pasa entre ellas, no a través), escaleras y huecos.
    const solid: Array<{ u0: number; v0: number; u1: number; v1: number }> = [];
    for (const it of ITEMS) {
      if (itemLevel(it) !== level) continue;
      if (it.u + it.w / 2 < u0 - 1 || it.u - it.w / 2 > u1 + 1 || it.v + it.d / 2 < v0 - 1 || it.v - it.d / 2 > v1 + 1) continue;
      if (it.solid) solid.push(rectOf(it, it.kind === 'tree' ? 0.25 : 0.12));
      else if (it.kind === 'chair' || it.kind === 'plasticChair' || it.kind === 'stool') solid.push(rectOf(it, -0.04));
    }
    for (const s of STAIRS) {
      const startLevel = Math.round(s.y0 / 3.3);
      if (startLevel === level) solid.push({ u0: s.u0 - 0.1, v0: s.v0 - 0.1, u1: s.u1 + 0.1, v1: s.v1 + 0.1 });
    }
    for (const l of LANDINGS) {
      if (level === 0 && l.y < 3 && !l.hollow) solid.push({ u0: l.u0 - 0.1, v0: l.v0 - 0.1, u1: l.u1 + 0.1, v1: l.v1 + 0.1 });
    }
    const poly = room.poly;
    const inset = 0.22;
    for (let j = 0; j < this.nv; j++) {
      const v = v0 + (j + 0.5) * c;
      for (let i = 0; i < this.nu; i++) {
        const u = u0 + (i + 0.5) * c;
        if (!inPoly(poly, u, v)) continue;
        if (edgeDistance(poly, u, v) < inset) continue;
        if (level > 0 && !hasFloor(level, u, v)) continue;
        this.free[j * this.nu + i] = 1;
      }
    }
    // Los obstáculos se rasterizan (un rectángulo marca sus celdas) en vez de
    // probar cada celda contra cada mueble: un aula tiene decenas de ellos.
    for (const r of solid) {
      const i0 = Math.max(0, Math.ceil((r.u0 - u0) / c - 0.5));
      const i1 = Math.min(this.nu - 1, Math.floor((r.u1 - u0) / c - 0.5));
      const j0 = Math.max(0, Math.ceil((r.v0 - v0) / c - 0.5));
      const j1 = Math.min(this.nv - 1, Math.floor((r.v1 - v0) / c - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.free[j * this.nu + i] = 0;
    }
  }

  cell(u: number, v: number): number {
    const i = Math.floor((u - this.u0) / RoomGrid.CELL);
    const j = Math.floor((v - this.v0) / RoomGrid.CELL);
    if (i < 0 || j < 0 || i >= this.nu || j >= this.nv) return -1;
    return j * this.nu + i;
  }

  center(k: number): [number, number] {
    const i = k % this.nu;
    const j = (k - i) / this.nu;
    return [this.u0 + (i + 0.5) * RoomGrid.CELL, this.v0 + (j + 0.5) * RoomGrid.CELL];
  }

  /** Línea de vista sobre la grilla fina (muestreo cada 5 cm). */
  sees(u0: number, v0: number, u1: number, v1: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.05));
    for (let k = 0; k <= n; k++) {
      const c = this.cell(u0 + ((u1 - u0) * k) / n, v0 + ((v1 - v0) * k) / n);
      if (c < 0 || !this.free[c]) return false;
    }
    return true;
  }
}

/** Distancia del punto al borde del polígono. */
function edgeDistance(poly: readonly (readonly [number, number])[], u: number, v: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [au, av] = poly[j];
    const [bu, bv] = poly[i];
    const du = bu - au;
    const dv = bv - av;
    const l2 = du * du + dv * dv;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((u - au) * du + (v - av) * dv) / l2)) : 0;
    best = Math.min(best, Math.hypot(u - au - du * t, v - av - dv * t));
  }
  return best;
}

/** Puestos fijos y recorridos (coordenadas locales). */
export interface Spot extends NavPoint {
  yaw: number;
}

export class Places {
  readonly seats: Seat[] = [];
  readonly boards: Board[] = [];
  readonly classrooms = new Map<string, Classroom>();
  private readonly roomGrids = new Map<string, RoomGrid>();
  private readonly roomById = new Map<string, Room>();

  /**
   * Puestos del personal y fila de la cantina: se DERIVAN del equipamiento
   * (la cabina de recepción, la línea de la cantina, el acceso vidriado), no
   * se escriben a mano: el plano todavía se está ajustando y un puesto fijo
   * quedaba adentro de una mesa cuando se movía un mueble.
   */
  /** Dentro de la cabina de recepción, de cara al hall (el portero no sale de ahí). */
  readonly porter: Spot = { u: 41.25, v: -3.4, level: 0, yaw: Math.PI / 2 };
  /** Detrás de la línea de la cantina, de cara a los que compran. */
  readonly cantina: Spot[] = [];
  /** Fila de la cantina: la cabeza mira al mostrador y el resto hacia la cabeza. */
  readonly queue: Spot[] = [];
  /** Recibimiento en el acceso vidriado del hall: de cara a la calle. */
  readonly portal: Spot[] = [];
  /** Frente al portón, del lado de la vereda: donde esperan las familias. */
  readonly sidewalkFront = { u0: 30.5, v0: 2.6, u1: 45.5, v1: 5.6 };
  /** Puntas de la vereda de Laprida (dentro de la grilla). */
  readonly sidewalkEnds: NavPoint[] = [
    { u: -6.5, v: 4.2, level: 0 },
    { u: 69.2, v: 4.2, level: 0 },
  ];
  /** Quien da el discurso en el acto: frente a todos, de cara al este. */
  readonly speaker: Spot = { u: 53.2, v: -10.3, level: 0, yaw: -Math.PI / 2 };
  /** Filas del acto (de oeste a este), cada una de norte a sur; todos miran al oeste. */
  readonly actoRows: Spot[][] = [];
  /** Recorrido del lampazo: el pasillo sur. */
  readonly mopRoute: NavPoint[] = [
    { u: 11.0, v: -8.25, level: 0 },
    { u: 30.5, v: -8.25, level: 0 },
  ];

  constructor(private readonly nav: NavGrid) {
    for (const r of ROOMS) this.roomById.set(r.id, r);
    this.buildSeats();
    this.buildBoards();
    for (const [room, kind] of Object.entries(CLASS_KIND)) {
      const r = this.roomById.get(room);
      if (!r) continue;
      const seats = this.seats.filter((s) => s.room === room && (s.kind === 'chair' || s.kind === 'bench' || s.kind === 'stool'));
      const board = this.boards.find((b) => b.room === room) ?? null;
      this.classrooms.set(room, { room, level: roomLevel(r), kind, seats, board });
    }
    this.buildPosts();
    this.buildActoRows();
  }

  /** Portero, cantina, fila y recibimiento, a partir del equipamiento y los muros. */
  private buildPosts(): void {
    const booth = ITEMS.find((it) => it.kind === 'booth' && itemLevel(it) === 0);
    if (booth) {
      // Adentro de la cabina, hacia el extremo del acceso, mirando al hall.
      const [fu, fv] = faceVec(booth.face);
      const alongV = booth.face === 'e' || booth.face === 'w';
      const len = alongV ? booth.d : booth.w;
      const pu = alongV ? 0 : 1;
      const pv = alongV ? 1 : 0;
      // El extremo más cercano a Laprida (v mayor) es el del acceso.
      const sgn = alongV ? 1 : 0;
      Object.assign(this.porter, {
        u: booth.u - fu * 0.15 + pu * sgn * len * 0.22,
        v: booth.v - fv * 0.15 + pv * sgn * len * 0.22,
        level: 0,
        yaw: faceYaw(booth.face),
      });
    }
    const line = ITEMS.find((it) => it.kind === 'buffetLine');
    if (line) {
      const level = itemLevel(line);
      const [fu, fv] = faceVec(line.face);
      const alongV = line.face === 'e' || line.face === 'w';
      const depth = alongV ? line.w : line.d;
      const len = alongV ? line.d : line.w;
      // Eje largo de la línea.
      const au = alongV ? 0 : 1;
      const av = alongV ? 1 : 0;
      for (const t of [-0.25, 0.25]) {
        const u = line.u - fu * (depth / 2 + 0.45) + au * t * len;
        const v = line.v - fv * (depth / 2 + 0.45) + av * t * len;
        this.cantina.push({ u, v, level, yaw: faceYaw(line.face) });
      }
      // Fila: la cabeza frente a un extremo, el resto a lo largo de la
      // línea y después siguiendo de largo; se descarta lo que no se pisa.
      const headYaw = faceYaw(line.face) + Math.PI;
      const ends = [1, -1];
      let best: Spot[] = [];
      for (const e of ends) {
        const slots: Spot[] = [];
        for (let k = 0; k < 8 && slots.length < 6; k++) {
          const off = len / 2 - 0.35 - k * 0.62;
          const u = line.u + fu * (depth / 2 + 0.5) + au * e * off;
          const v = line.v + fv * (depth / 2 + 0.5) + av * e * off;
          const p = this.nav.nearestWalkable(level, u, v, 0.35);
          if (!p) continue;
          const yaw = slots.length === 0 ? headYaw : yawOfLocal(au * e, av * e);
          slots.push({ u: p.u, v: p.v, level, yaw });
        }
        if (slots.length > best.length) best = slots;
      }
      this.queue.push(...best);
    }
    // Recibimiento: a ambos lados del acceso vidriado, del lado del hall.
    for (const w of WALLS) {
      if (w.level !== 0) continue;
      for (const o of w.openings) {
        if (o.type !== 'entrance') continue;
        const du = w.b[0] - w.a[0];
        const dv = w.b[1] - w.a[1];
        const len = Math.hypot(du, dv);
        const tu = du / len;
        const tv = dv / len;
        const tc = (o.t0 + o.t1) / 2;
        const cu = w.a[0] + tu * tc;
        const cv = w.a[1] + tv * tc;
        for (const side of [-1, 1]) {
          const nu = -tv * side;
          const nv = tu * side;
          // El lado de adentro: techado a 1,2 m y también a 2,5 m (del otro
          // lado del acceso está el zaguán, que termina en la fachada).
          const inside = roomAt(cu + nu * 1.2, cv + nv * 1.2, 0);
          const deep = roomAt(cu + nu * 2.5, cv + nv * 2.5, 0);
          if (!inside || !inside.roofed || !deep || !deep.roofed) continue;
          for (const s of [-0.32, 0.32]) {
            const half = (o.t1 - o.t0) / 2;
            const p = this.nav.nearestWalkable(0, cu + tu * s * half * 2 + nu * 1.1, cv + tv * s * half * 2 + nv * 1.1, 0.6);
            if (p) this.portal.push({ u: p.u, v: p.v, level: 0, yaw: yawOfLocal(-nu, -nv) + s * 0.4 });
          }
        }
      }
    }
    if (this.portal.length === 0) this.portal.push({ u: 37.4, v: -2.8, level: 0, yaw: 0 });
  }

  room(id: string): Room | undefined {
    return this.roomById.get(id);
  }

  // ------------------------------------------------------------------ asientos

  private addSeat(
    u: number,
    v: number,
    level: Level,
    face: Facing,
    height: number,
    kind: SeatKind,
    opts: { small?: boolean; footDrop?: number; desk?: boolean; stand?: [number, number, number]; dir?: [number, number] } = {},
  ): Seat {
    const [fu, fv] = opts.dir ?? faceVec(face);
    const room = roomAt(u, v, level);
    const FY = LEVEL_Y[level];
    const desk = opts.desk ?? this.hasTableAhead(u, v, fu, fv, level);
    const top = desk ? this.tableAhead(u, v, fu, fv, level) : null;
    const s: Seat = {
      id: this.seats.length,
      u,
      v,
      level,
      y: FY + height,
      footY: FY + height - (opts.footDrop ?? height),
      yaw: opts.dir ? yawOfLocal(fu, fv) : faceYaw(face),
      fu,
      fv,
      room: room?.id ?? '',
      kind,
      desk,
      deskD: top ? top.d : NaN,
      deskY: top ? FY + top.y : NaN,
      small: opts.small ?? false,
      au: u,
      av: v,
      ay: FY,
      lastMile: null,
      ready: false,
    };
    if (opts.stand) {
      [s.au, s.av, s.ay] = opts.stand;
      s.ready = true;
    }
    this.seats.push(s);
    return s;
  }

  /**
   * Dónde pararse para sentarse: adelante si está libre (bancos, gradas), al
   * costado si hay mesa (pupitres en fila), o atrás. Se decide la primera vez
   * que alguien usa el asiento: así no se arman al arrancar las grillas de
   * los pisos altos ni las finas de cada aula.
   */
  private chooseApproach(s: Seat): void {
    s.ready = true;
    const { u, v, fu, fv, level } = s;
    const pu = -fv;
    const pv = fu;
    const cands: Array<[number, number]> = s.desk
      ? [
          [pu * 0.5, pv * 0.5],
          [-pu * 0.5, -pv * 0.5],
          [-fu * 0.45, -fv * 0.45],
          [fu * 0.45 + pu * 0.5, fv * 0.45 + pv * 0.5],
        ]
      : [
          [fu * 0.42, fv * 0.42],
          [pu * 0.5, pv * 0.5],
          [-pu * 0.5, -pv * 0.5],
          [-fu * 0.45, -fv * 0.45],
        ];
    for (const [du, dv] of cands) {
      const qu = u + du;
      const qv = v + dv;
      // Primero la grilla gruesa (barata); la fina del ambiente sólo si hace falta.
      let ok = this.nav.isMain(level, qu, qv);
      if (!ok && s.room) {
        const grid = this.roomGrid(s.room);
        const c = grid ? grid.cell(qu, qv) : -1;
        ok = grid !== null && c >= 0 && grid.free[c] === 1;
      }
      if (ok) {
        s.au = qu;
        s.av = qv;
        return;
      }
    }
    s.au = u + cands[0][0];
    s.av = v + cands[0][1];
    s.lastMile = [];
  }

  private hasTableAhead(u: number, v: number, fu: number, fv: number, level: Level): boolean {
    const qu = u + fu * 0.45;
    const qv = v + fv * 0.45;
    for (const it of ITEMS) {
      if (itemLevel(it) !== level || !TABLES.has(it.kind)) continue;
      const r = rectOf(it, 0.12);
      if (qu > r.u0 && qu < r.u1 && qv > r.v0 && qv < r.v1) return true;
    }
    return false;
  }

  /**
   * Tapa de mesa al frente del asiento: distancia del centro del asiento a su
   * borde (por el frente, hasta 0,9 m) y altura sobre el piso del nivel.
   * Alturas como las dibuja `SchoolBuilder`.
   */
  private tableAhead(u: number, v: number, fu: number, fv: number, level: Level): { d: number; y: number } | null {
    let best: { d: number; y: number } | null = null;
    for (const it of ITEMS) {
      if (itemLevel(it) !== level || !TABLES.has(it.kind)) continue;
      const y = TABLE_TOP[it.kind] ?? FURNITURE.tableTop;
      for (let d = 0.1; d <= 0.9; d += 0.02) {
        const qu = u + fu * d;
        const qv = v + fv * d;
        const inside =
          it.kind === 'hexTable' || it.kind === 'roundTable'
            ? Math.hypot(qu - it.u, qv - it.v) <= it.w / 2
            : qu >= it.u - it.w / 2 && qu <= it.u + it.w / 2 && qv >= it.v - it.d / 2 && qv <= it.v + it.d / 2;
        if (!inside) continue;
        if (!best || d < best.d) best = { d, y };
        break;
      }
    }
    return best;
  }

  private buildSeats(): void {
    // Tapa del asiento de las sillas como las dibuja `SchoolBuilder.chair`
    // (estaba en 0,48: la gente quedaba 2 cm en el aire sobre la silla).
    const chairY = FURNITURE.seat;
    for (const it of ITEMS) {
      const level = itemLevel(it);
      switch (it.kind) {
        case 'chair':
        case 'plasticChair':
          // Sillas de jardín: por la lista de ambientes del jardín (con
          // `startsWith('sala')` entraban la preceptoría y los baños).
          this.addSeat(it.u, it.v, level, it.face, chairY, 'chair', { small: JARDIN_IDS.has(roomAt(it.u, it.v, level)?.id ?? '') });
          break;
        case 'stool':
          this.addSeat(it.u, it.v, level, it.face, 0.76, 'stool');
          break;
        case 'hexTable':
        case 'roundTable': {
          // Las sillas de estas mesas las dibuja el constructor, no están en el plano.
          const small = it.kind === 'roundTable';
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
            const cu = it.u + Math.cos(a) * (it.w / 2 + 0.3);
            const cv = it.v + Math.sin(a) * (it.w / 2 + 0.3);
            const face: Facing = Math.abs(Math.cos(a)) > 0.5 ? (Math.cos(a) > 0 ? 'w' : 'e') : Math.sin(a) > 0 ? 'n' : 's';
            // Las sillas van en diagonal (a 45°) pero miran a un punto
            // cardinal: de frente se miraba al costado de la mesa, con las
            // manos en el aire. Se sienta girado hacia el centro de la mesa.
            this.addSeat(cu, cv, level, face, small ? chairY * FURNITURE.smallScale : chairY, 'chair', { small, desk: true, dir: [-Math.cos(a), -Math.sin(a)] });
          }
          break;
        }
        case 'bench':
        case 'benchSeat':
        case 'coatBench': {
          const len = Math.max(it.w, it.d);
          const alongU = it.w >= it.d;
          const n = Math.max(1, Math.floor(len / 0.55));
          for (let k = 0; k < n; k++) {
            const t = ((k + 0.5) / n - 0.5) * (len - 0.2);
            this.addSeat(it.u + (alongU ? t : 0), it.v + (alongU ? 0 : t), level, it.face, it.kind === 'coatBench' ? 0.47 : 0.48, 'bench');
          }
          break;
        }
        case 'longTable': {
          // Bancos verdes a los dos lados de la mesa del comedor.
          const alongU = it.w >= it.d;
          const len = (alongU ? it.w : it.d) - 0.3;
          const n = Math.max(1, Math.floor(len / 0.6));
          for (const side of [-1, 1]) {
            for (let k = 0; k < n; k++) {
              const t = ((k + 0.5) / n - 0.5) * len;
              const off = (alongU ? it.d : it.w) / 2 + 0.3;
              const su = it.u + (alongU ? t : side * off);
              const sv = it.v + (alongU ? side * off : t);
              const face: Facing = alongU ? (side < 0 ? 's' : 'n') : side < 0 ? 'e' : 'w';
              this.addSeat(su, sv, level, face, 0.5, 'bench', { desk: true });
            }
          }
          break;
        }
        case 'seats': {
          const alongV = it.face === 'e' || it.face === 'w';
          const n = Math.max(2, Math.round(Math.max(it.w, it.d) / 0.55));
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n - 0.5;
            this.addSeat(it.u + (alongV ? 0 : t * it.w), it.v + (alongV ? t * it.d : 0), level, it.face, chairY, 'chair', { desk: false });
          }
          break;
        }
        case 'bleachers':
          this.bleacherSeats(it, level);
          break;
        case 'wallPanel': {
          // Tablas de madera sobre los canteros del patio: asiento a 0,45-0,65 m.
          if (it.color !== 'timberDark' || (it.h ?? 1) > 0.08 || it.y === undefined || it.y < 0.35 || it.y > 0.7) break;
          const planter = ITEMS.find((p) => p.kind === 'planter' && itemLevel(p) === level && Math.abs(p.u - it.u) < p.w / 2 + it.w / 2 + 0.05 && Math.abs(p.v - it.v) < p.d / 2 + it.d / 2 + 0.05);
          if (!planter) break;
          const alongU = it.w >= it.d;
          // Mira hacia afuera del cantero.
          const face: Facing = alongU ? (it.v > planter.v ? 's' : 'n') : it.u > planter.u ? 'e' : 'w';
          const [fu, fv] = faceVec(face);
          const len = Math.max(it.w, it.d);
          const n = Math.max(1, Math.floor(len / 0.6));
          for (let k = 0; k < n; k++) {
            const t = ((k + 0.5) / n - 0.5) * (len - 0.2);
            // Sobre la mitad de afuera de la tabla: más adentro, la espalda
            // quedaba metida en las plantas del cantero.
            const su = it.u + (alongU ? t : 0) + fu * 0.1;
            const sv = it.v + (alongU ? 0 : t) + fv * 0.1;
            this.addSeat(su, sv, level, face, it.y + (it.h ?? 0.05), 'ledge', { desk: false });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /** Gradas del polideportivo: tres escalones de 0,42 m, se suben de a uno. */
  private bleacherSeats(it: Item, level: Level): void {
    const FY = LEVEL_Y[level];
    const [fu, fv] = faceVec(it.face);
    const alongV = it.face === 'e' || it.face === 'w';
    const depth = alongV ? it.w : it.d;
    const span = alongV ? it.d : it.w;
    const n = Math.max(1, Math.floor(span / 0.55));
    const tier = (k: number): [number, number] => {
      const off = (k - 1) * (depth / 3);
      return [it.u - fu * off, it.v - fv * off];
    };
    for (let k = 0; k < 3; k++) {
      const top = 0.42 * (k + 1);
      for (let s = 0; s < n; s++) {
        const t = ((s + 0.5) / n - 0.5) * (span - 0.3);
        const lu = alongV ? 0 : t;
        const lv = alongV ? t : 0;
        // Punto sobre el escalón `kk`, corrido `back` metros hacia la pared.
        const at = (kk: number, back: number): [number, number] => {
          const [tu, tv] = tier(kk);
          return [tu + lu - fu * back, tv + lv - fv * back];
        };
        const [su, sv] = at(k, 0.1);
        // Parado en el escalón de abajo (o en el piso, delante de la grada).
        const floor = at(0, -0.75);
        const stand: [number, number, number] = k === 0 ? [floor[0], floor[1], FY] : [...at(k - 1, 0.18), FY + 0.42 * k];
        const seat = this.addSeat(su, sv, level, it.face, top, 'bleacher', { desk: false, footDrop: 0.42, stand });
        if (k > 0) {
          // Último tramo: del piso frente a la grada, subiendo escalón por escalón.
          const mile: number[] = [floor[0], floor[1], NaN];
          for (let step = 0; step < k - 1; step++) mile.push(...at(step, 0), FY + 0.42 * (step + 1));
          mile.push(stand[0], stand[1], stand[2]);
          seat.lastMile = mile;
        }
      }
    }
  }

  /** Grilla fina de un ambiente (se arma la primera vez). */
  private roomGrid(id: string): RoomGrid | null {
    const cached = this.roomGrids.get(id);
    if (cached) return cached;
    const r = this.roomById.get(id);
    if (!r) return null;
    const g = new RoomGrid(r);
    this.roomGrids.set(id, g);
    return g;
  }

  /**
   * Último tramo hasta el punto donde uno se para para sentarse: desde la
   * celda de la grilla de navegación más cercana (dentro del mismo
   * ambiente), entre pupitres y sillas, por la grilla fina. Devuelve los
   * puntos (u, v, y) o [] si el asiento no tiene acceso.
   */
  lastMile(seat: Seat): number[] {
    if (!seat.ready) this.chooseApproach(seat);
    if (seat.lastMile) return seat.lastMile;
    // Si el punto de parada ya cae en la grilla gruesa, no hace falta nada.
    if (this.nav.isMain(seat.level, seat.au, seat.av)) {
      seat.lastMile = [seat.au, seat.av, NaN];
      return seat.lastMile;
    }
    const grid = seat.room ? this.roomGrid(seat.room) : null;
    const start = grid ? grid.cell(seat.au, seat.av) : -1;
    if (!grid || start < 0 || !grid.free[start]) {
      seat.lastMile = [];
      return seat.lastMile;
    }
    // BFS desde el asiento hasta la primera celda que la grilla gruesa da por transitable.
    const prev = new Int32Array(grid.nu * grid.nv).fill(-2);
    const queue = new Int32Array(grid.nu * grid.nv);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    prev[start] = -1;
    let found = -1;
    while (head < tail) {
      const c = queue[head++];
      const [cu, cv] = grid.center(c);
      if (this.nav.isMain(seat.level, cu, cv)) {
        found = c;
        break;
      }
      const ci = c % grid.nu;
      const cj = (c - ci) / grid.nu;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= grid.nu || nj >= grid.nv) continue;
        const n = nj * grid.nu + ni;
        if (prev[n] !== -2 || !grid.free[n]) continue;
        prev[n] = c;
        queue[tail++] = n;
      }
    }
    if (found < 0) {
      seat.lastMile = [];
      return seat.lastMile;
    }
    // Cadena de celdas (desde la grilla gruesa hacia el asiento) y suavizado.
    const chain: Array<[number, number]> = [];
    for (let c = found; c >= 0; c = prev[c]) chain.push(grid.center(c));
    chain[chain.length - 1] = [seat.au, seat.av];
    const out: number[] = [chain[0][0], chain[0][1], NaN];
    let a = 0;
    while (a < chain.length - 1) {
      let far = a + 1;
      for (let k = chain.length - 1; k > a + 1; k--) {
        if (grid.sees(chain[a][0], chain[a][1], chain[k][0], chain[k][1])) {
          far = k;
          break;
        }
      }
      out.push(chain[far][0], chain[far][1], NaN);
      a = far;
    }
    seat.lastMile = out;
    return out;
  }

  // ---------------------------------------------------------------- pizarrones

  private buildBoards(): void {
    for (const it of ITEMS) {
      if (it.kind !== 'board' && it.kind !== 'blackboard') continue;
      const level = itemLevel(it);
      const room = roomAt(it.u, it.v, level);
      if (!room || !CLASS_KIND[room.id]) continue;
      if (this.boards.some((b) => b.room === room.id)) continue;
      const [fu, fv] = faceVec(it.face);
      this.boards.push({
        room: room.id,
        level,
        u: it.u + fu * 0.6,
        v: it.v + fv * 0.6,
        writeYaw: faceYaw(it.face) + Math.PI,
        talkYaw: faceYaw(it.face),
        fu,
        fv,
        ready: false,
        ok: false,
      });
    }
  }

  /**
   * Medio metro delante del pizarrón, en la celda libre más cercana dentro
   * del aula. Se resuelve al primer uso (no arma grillas al arrancar).
   */
  boardSpot(b: Board): boolean {
    if (b.ready) return b.ok;
    b.ready = true;
    const p = this.nav.nearestWalkable(b.level, b.u, b.v, 0.7);
    b.ok = p !== null && roomAt(p.u, p.v, b.level)?.id === b.room;
    if (p) {
      b.u = p.u;
      b.v = p.v;
    }
    return b.ok;
  }

  // ---------------------------------------------------------------------- acto

  private buildActoRows(): void {
    for (let r = 0; r < 10; r++) {
      const u = 55.2 + r * 0.8;
      const row: Spot[] = [];
      for (let v = -17.6; v <= -4.2; v += 0.62) {
        const jitterU = ((r * 7 + Math.round(v * 3)) % 3) * 0.05;
        if (!this.nav.isMain(0, u + jitterU, v)) continue;
        row.push({ u: u + jitterU, v, level: 0, yaw: Math.PI / 2 });
      }
      this.actoRows.push(row);
    }
  }

  // --------------------------------------------------------------------- zonas

  /** Punto transitable al azar dentro de un ambiente, con holgura. */
  randomIn(roomId: string, rnd: () => number, clearance = 0.3): NavPoint | null {
    const r = this.roomById.get(roomId);
    if (!r) return null;
    const level = roomLevel(r);
    let u0 = Infinity;
    let v0 = Infinity;
    let u1 = -Infinity;
    let v1 = -Infinity;
    for (const [u, v] of r.poly) {
      u0 = Math.min(u0, u);
      v0 = Math.min(v0, v);
      u1 = Math.max(u1, u);
      v1 = Math.max(v1, v);
    }
    for (let k = 0; k < 30; k++) {
      const u = u0 + rnd() * (u1 - u0);
      const v = v0 + rnd() * (v1 - v0);
      if (!inPoly(r.poly, u, v)) continue;
      if (!this.nav.clear(level, u, v, clearance) || !this.nav.isMain(level, u, v)) continue;
      return { u, v, level };
    }
    return null;
  }

  /** Punto transitable al azar en un rectángulo local de planta baja (o del nivel dado). */
  randomInRect(rect: { u0: number; v0: number; u1: number; v1: number }, rnd: () => number, level: Level = 0, clearance = 0.3): NavPoint | null {
    const p = this.nav.randomPoint(level, rect, rnd, clearance);
    return p ? { ...p, level } : null;
  }
}
