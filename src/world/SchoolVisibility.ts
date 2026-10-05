import {
  LEVEL_Y,
  ROOFS,
  ROOMS,
  SCHOOL,
  STAIRS,
  UPPER,
  VOIDS,
  WALLS,
  inPoly,
  levelOf,
  roomLevel,
  type Level,
  type OpeningType,
  type P,
  type Wall,
} from './SchoolLayout';

/**
 * Qué ambientes de la escuela se pueden ver desde cada ambiente techado
 * (conjunto potencialmente visible), sin motor. Lo usa `ZoneCulling` para
 * no mandar a la GPU el equipamiento de las aulas que quedan detrás de muros,
 * y se prueba en `tests/schoolVisibility.test.ts`.
 *
 * Por qué hace falta: la granja de instancias dibuja cada combinación
 * primitiva + material como UNA malla con todas sus copias, así que su
 * volumen envolvente es la escuela entera y la cámara nunca la descarta. En
 * el visor, un baño cerrado costaba 261 mil triángulos, casi lo mismo que la
 * vista desde la calle: se pagaban los pupitres de las ~80 aulas.
 *
 * Cómo: una grilla de 25 cm por nivel con los muros (sin sus vanos: puertas
 * y ventanas dejan pasar la vista) y el ambiente de cada celda. Desde puntos
 * repartidos en el ambiente (y junto a cada vano, que es donde se ve más
 * de costado) se lanzan rayos en planta; todo ambiente que un rayo atraviesa
 * es visible. Afuera (patios, calle, aire sobre las cubiertas bajas) el rayo
 * pasa a todos los niveles a la vez: desde un aula de planta baja se ven por
 * la ventana las ventanas del primer piso de enfrente. Por el hueco de una
 * escalera o un vacío de losa, el nivel de arriba o de abajo se ve sólo unos
 * metros.
 *
 * Todas las aproximaciones van del lado seguro (ver de más): un vano sin
 * alto conocido se abre en todos los niveles que cruza su muro, los
 * cerramientos que no son muros del plano no tapan y las juntas entre muros
 * pueden dejar pasar algún rayo. Ver de más cuesta triángulos; ver de menos
 * sería una pared o un aula que desaparece.
 */

/** Lado de celda de la grilla, en metros. */
export const VIS_CELL = 0.25;
/** Celda de aire libre (patio, calle o sobre una cubierta baja) en un nivel. */
export const AIR = -1;
/** Fuera de la grilla: lejos del predio, siempre afuera. */
export const OUTSIDE = -2;

/**
 * Antepecho y dintel de cada tipo de vano, sobre el piso de su muro. Son los
 * de `SchoolBuilder` (HOLE), copiados acá para que este módulo no dependa del
 * motor; si cambian allá, lo único que pasa es que la vista se abre de más o
 * de menos unos centímetros (se compara con una franja amplia, ver `bandOf`).
 */
const HOLE: Readonly<Record<OpeningType, readonly [number, number]>> = {
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

/**
 * Franja de los ojos en cada nivel (sobre su piso): un muro tapa la vista de
 * ese nivel si cubre la franja entera. Una mampara de 1,5 m o un pretil no
 * tapan; un tabique hasta el cielorraso, sí.
 */
const EYE_LO = 0.6;
const EYE_HI = 2.0;
/** Un vano abre la vista de un nivel si toca su planta (piso a piso, con margen). */
const OPEN_LO = 0.2;
const OPEN_HI = SCHOOL.storey;
/** Los tramos llenos de un muro se acortan en cada vano: el vano queda más ancho (lado seguro). */
const JAMB = 0.15;
/** Cuánto se ve el otro nivel por el hueco de una escalera o un vacío de losa. */
const VOID_REACH = 7;
/** Largo máximo de un rayo (cruza el predio entero en diagonal). */
const MAX_RAY = 140;
/** Rayos por punto de observación (cada 1,5°). */
const RAYS = 240;
/**
 * Vanos que puede cruzar un rayo. Con dos, desde un pasillo se ve por la
 * puerta de un aula y, por su ventana, el patio; lo que está detrás de un
 * tercer vano (un aula de enfrente vista por la puerta, el pasillo y su
 * ventana) es una ranura de pocos píxeles y se deja de lado: si no, casi
 * toda la escuela se veía desde cualquier lado.
 */
const MAX_APERTURES = 2;
/** Separación entre puntos de observación dentro de un ambiente, y su tope. */
const SAMPLE_STEP = 0.9;
const MAX_SAMPLES = 120;
/** Distancia de los puntos al borde del ambiente (afuera del espesor del muro). */
const SAMPLE_INSET = 0.3;

/** Lo que se ve desde un ambiente. */
export interface RoomView {
  /** Índice en `ROOMS` de cada ambiente techado visible (incluye el propio). */
  readonly rooms: ReadonlySet<number>;
  /** Se ve afuera (patio, calle o cielo): entonces también el barrio. */
  readonly outside: boolean;
}

interface Grid {
  u0: number;
  v0: number;
  nu: number;
  nv: number;
  /** Por nivel: ambiente techado (índice en ROOMS), `AIR` o muro según `block`. */
  label: [Int16Array, Int16Array, Int16Array];
  /** Por nivel: 1 si un muro tapa la vista en esa celda. */
  block: [Uint8Array, Uint8Array, Uint8Array];
  /** Por nivel: 1 en el eje de un muro donde hay un vano (puerta o ventana). */
  aperture: [Uint8Array, Uint8Array, Uint8Array];
  /** Niveles unidos por una escalera o un vacío de losa (máscara de bits). */
  join: Uint8Array;
}

/** Celda tapada por un muro (en `sampleAt`). */
export const WALL = -3;

/**
 * Todo lo calculado, en arreglos planos: el cálculo corre en un worker
 * (`schoolVisibility.worker.ts`) y esto es lo que cruza al hilo principal.
 */
export interface VisibilityData {
  u0: number;
  v0: number;
  nu: number;
  nv: number;
  labels: [Int16Array, Int16Array, Int16Array];
  blocks: [Uint8Array, Uint8Array, Uint8Array];
  /** Por ambiente calculado: [índice, afuera (0/1), cantidad, ...visibles]. */
  views: Int16Array;
}

/** Lo que hay alrededor de un punto (ver `roomsNear`). */
export interface Surroundings {
  /** Ambientes techados en los que puede estar la cabeza. */
  rooms: number[];
  /** Algún punto alcanzable está afuera (patio, calle). */
  outdoor: boolean;
}

/** Ambientes techados: los únicos cuyo contenido se puede esconder. */
export function isRoofedRoom(k: number): boolean {
  return ROOMS[k]?.roofed === true;
}

export class SchoolVisibility {
  private grid: Grid | null = null;
  private readonly views = new Map<number, RoomView>();
  /** Ambientes pendientes de calcular, en orden. */
  private queue: number[] = ROOMS.map((_, k) => k).filter(isRoofedRoom);
  // Marcas de un cálculo (sin crear conjuntos por rayo).
  private seen = new Uint8Array(ROOMS.length);
  private seenOut = false;

  /** ¿Ya se calcularon todos los ambientes? */
  get done(): boolean {
    return this.queue.length === 0;
  }

  /** Vista ya calculada de un ambiente (null si todavía no). */
  viewOf(room: number): RoomView | null {
    return this.views.get(room) ?? null;
  }

  /** Calcula (si hace falta) y devuelve la vista de un ambiente techado. */
  compute(room: number): RoomView {
    const cached = this.views.get(room);
    if (cached) return cached;
    const view = this.cast(room);
    this.views.set(room, view);
    this.queue = this.queue.filter((k) => k !== room);
    return view;
  }

  /**
   * Avanza el cálculo pendiente hasta gastar `budgetMs` (al menos un
   * ambiente). Se llama con poco tiempo por cuadro: armar todo de una vez
   * alargaría la carga, sobre todo en el visor.
   */
  step(budgetMs: number, now: () => number = () => performance.now()): boolean {
    const t0 = now();
    if (!this.grid) {
      this.grid = buildGrid();
      if (now() - t0 > budgetMs) return this.done;
    }
    while (this.queue.length) {
      this.compute(this.queue[0]);
      if (now() - t0 > budgetMs) break;
    }
    return this.done;
  }

  /** Calcula todo de una (pruebas, herramientas y el worker). */
  computeAll(): void {
    while (this.queue.length) this.compute(this.queue[0]);
  }

  /** Lo calculado hasta ahora, para mandarlo de un hilo a otro. */
  exportData(): VisibilityData {
    const g = this.ensureGrid();
    const flat: number[] = [];
    for (const [k, view] of this.views) flat.push(k, view.outside ? 1 : 0, view.rooms.size, ...view.rooms);
    return { u0: g.u0, v0: g.v0, nu: g.nu, nv: g.nv, labels: g.label, blocks: g.block, views: Int16Array.from(flat) };
  }

  /** Reconstruye lo que calculó otro hilo (sólo para consultar: no lanza rayos). */
  static fromData(d: VisibilityData): SchoolVisibility {
    const vis = new SchoolVisibility();
    const n = d.nu * d.nv;
    const empty = new Uint8Array(n);
    vis.grid = {
      u0: d.u0,
      v0: d.v0,
      nu: d.nu,
      nv: d.nv,
      label: d.labels,
      block: d.blocks,
      aperture: [empty, empty, empty],
      join: empty,
    };
    const f = d.views;
    for (let i = 0; i < f.length; ) {
      const k = f[i];
      const outside = f[i + 1] === 1;
      const m = f[i + 2];
      const rooms = new Set<number>();
      for (let j = 0; j < m; j++) rooms.add(f[i + 3 + j]);
      vis.views.set(k, { rooms, outside });
      i += 3 + m;
    }
    vis.queue = vis.queue.filter((k) => !vis.views.has(k));
    return vis;
  }

  /** Como `nodeAt`, pero `WALL` si un muro tapa esa celda en ese nivel. */
  sampleAt(level: Level, u: number, v: number): number {
    const g = this.ensureGrid();
    const i = Math.floor((u - g.u0) / VIS_CELL);
    const j = Math.floor((v - g.v0) / VIS_CELL);
    if (i < 0 || j < 0 || i >= g.nu || j >= g.nv) return OUTSIDE;
    const c = j * g.nu + i;
    return g.block[level][c] ? WALL : g.label[level][c];
  }

  /**
   * Ambientes en los que puede estar alguien con la cabeza en (u, v) de ese
   * nivel: el del punto y los que quedan a menos de `r` sin un muro en el
   * medio (parado en una puerta, los dos lados). Así, al cruzar una puerta,
   * lo que se ve de los dos lados ya está dibujado antes de pasar.
   */
  roomsNear(level: Level, u: number, v: number, r: number, out: Surroundings = { rooms: [], outdoor: false }): Surroundings {
    const add = (n: number) => {
      if (n >= 0) {
        if (!out.rooms.includes(n)) out.rooms.push(n);
      } else if (n === AIR || n === OUTSIDE) out.outdoor = true;
    };
    const here = this.sampleAt(level, u, v);
    add(here);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const du = Math.cos(a);
      const dv = Math.sin(a);
      // Se avanza de a media celda hasta `r` y se corta en el primer muro.
      for (let d = VIS_CELL / 2; d <= r + 1e-6; d += VIS_CELL / 2) {
        const n = this.sampleAt(level, u + du * d, v + dv * d);
        if (n === WALL) break;
        add(n);
      }
    }
    return out;
  }

  /**
   * Ambiente techado que contiene el punto en ese nivel, contando los de
   * doble altura (el gimnasio en el primer piso); `AIR` afuera y `OUTSIDE`
   * lejos del predio.
   */
  nodeAt(level: Level, u: number, v: number): number {
    const g = this.ensureGrid();
    const i = Math.floor((u - g.u0) / VIS_CELL);
    const j = Math.floor((v - g.v0) / VIS_CELL);
    if (i < 0 || j < 0 || i >= g.nu || j >= g.nv) return OUTSIDE;
    return g.label[level][j * g.nu + i];
  }

  private ensureGrid(): Grid {
    return (this.grid ??= buildGrid());
  }

  private cast(room: number): RoomView {
    const g = this.ensureGrid();
    const r = ROOMS[room];
    const level = roomLevel(r);
    this.seen.fill(0);
    this.seenOut = false;
    this.seen[room] = 1;
    for (const [su, sv] of samplePoints(room)) {
      for (let k = 0; k < RAYS; k++) {
        const a = (k / RAYS) * Math.PI * 2;
        this.ray(g, level, su, sv, Math.cos(a), Math.sin(a));
      }
    }
    const rooms = new Set<number>();
    for (let k = 0; k < this.seen.length; k++) if (this.seen[k]) rooms.add(k);
    return { rooms, outside: this.seenOut };
  }

  /**
   * Un rayo en planta desde (u, v) en `level`. Lleva una máscara de niveles
   * por los que sigue viendo (afuera se suman todos los que también son aire
   * en esa columna) y, para los que entraron por un hueco, cuánto le queda.
   */
  private ray(g: Grid, level: Level, u: number, v: number, du: number, dv: number): void {
    let i = Math.floor((u - g.u0) / VIS_CELL);
    let j = Math.floor((v - g.v0) / VIS_CELL);
    const si = du > 0 ? 1 : -1;
    const sj = dv > 0 ? 1 : -1;
    const tdi = Math.abs(du) > 1e-9 ? VIS_CELL / Math.abs(du) : Infinity;
    const tdj = Math.abs(dv) > 1e-9 ? VIS_CELL / Math.abs(dv) : Infinity;
    let ti = Math.abs(du) > 1e-9 ? ((du > 0 ? (i + 1) * VIS_CELL + g.u0 - u : u - (i * VIS_CELL + g.u0)) / Math.abs(du)) : Infinity;
    let tj = Math.abs(dv) > 1e-9 ? ((dv > 0 ? (j + 1) * VIS_CELL + g.v0 - v : v - (j * VIS_CELL + g.v0)) / Math.abs(dv)) : Infinity;
    let mask = 1 << level;
    // Alcance que le queda a cada nivel (Infinity: sin límite).
    let r0 = level === 0 ? Infinity : 0;
    let r1 = level === 1 ? Infinity : 0;
    let r2 = level === 2 ? Infinity : 0;
    let t = 0;
    const seen = this.seen;
    let apertures = 0;
    let inAperture = false;
    while (t < MAX_RAY) {
      if (i < 0 || j < 0 || i >= g.nu || j >= g.nv) {
        this.seenOut = true;
        return;
      }
      const c = j * g.nu + i;
      let air = false;
      for (let L = 0; L < 3; L++) {
        const bit = 1 << L;
        if (!(mask & bit)) continue;
        if (g.block[L][c]) {
          mask &= ~bit;
          continue;
        }
        const lab = g.label[L][c];
        if (lab >= 0) seen[lab] = 1;
        else air = true;
      }
      if (!mask) return;
      let ap = false;
      for (let L = 0; L < 3 && !ap; L++) ap = (mask & (1 << L)) !== 0 && g.aperture[L][c] === 1;
      if (ap && !inAperture && ++apertures > MAX_APERTURES) return;
      inAperture = ap;
      if (air) {
        this.seenOut = true;
        // La columna de aire: los otros niveles que también son aire acá.
        const reach = Math.max(r0, r1, r2);
        for (let L = 0; L < 3; L++) {
          const bit = 1 << L;
          if (mask & bit || g.block[L][c] || g.label[L][c] !== AIR) continue;
          mask |= bit;
          if (L === 0) r0 = reach;
          else if (L === 1) r1 = reach;
          else r2 = reach;
        }
      }
      const jm = g.join[c];
      if (jm) {
        // Hueco de escalera o de losa: los niveles unidos se ven unos metros.
        for (let L = 0; L < 3; L++) {
          const bit = 1 << L;
          if (!(jm & bit) || g.block[L][c]) continue;
          if (!(mask & bit)) {
            mask |= bit;
            const lab = g.label[L][c];
            if (lab >= 0) seen[lab] = 1;
          }
          if (L === 0) r0 = Math.max(r0, VOID_REACH);
          else if (L === 1) r1 = Math.max(r1, VOID_REACH);
          else r2 = Math.max(r2, VOID_REACH);
        }
      }
      // Avanza una celda.
      let dt: number;
      if (ti < tj) {
        dt = ti - t;
        t = ti;
        ti += tdi;
        i += si;
      } else {
        dt = tj - t;
        t = tj;
        tj += tdj;
        j += sj;
      }
      if (r0 !== Infinity && (r0 -= dt) <= 0) mask &= ~1;
      if (r1 !== Infinity && (r1 -= dt) <= 0) mask &= ~2;
      if (r2 !== Infinity && (r2 -= dt) <= 0) mask &= ~4;
      if (!mask) return;
    }
  }
}

// ------------------------------------------------------------------ grilla

function polyBox(poly: readonly P[]): { u0: number; v0: number; u1: number; v1: number } {
  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  for (const [u, v] of poly) {
    u0 = Math.min(u0, u);
    v0 = Math.min(v0, v);
    u1 = Math.max(u1, u);
    v1 = Math.max(v1, v);
  }
  return { u0, v0, u1, v1 };
}

function buildGrid(): Grid {
  // Límites: todo lo que tiene muros o ambientes, con margen.
  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  const grow = (u: number, v: number) => {
    u0 = Math.min(u0, u);
    v0 = Math.min(v0, v);
    u1 = Math.max(u1, u);
    v1 = Math.max(v1, v);
  };
  for (const w of WALLS) {
    grow(...w.a);
    grow(...w.b);
  }
  for (const r of ROOMS) for (const p of r.poly) grow(...p);
  u0 = Math.floor(u0 - 2);
  v0 = Math.floor(v0 - 2);
  const nu = Math.ceil((u1 + 2 - u0) / VIS_CELL);
  const nv = Math.ceil((v1 + 2 - v0) / VIS_CELL);
  const n = nu * nv;
  const label: Grid['label'] = [new Int16Array(n).fill(AIR), new Int16Array(n).fill(AIR), new Int16Array(n).fill(AIR)];
  const block: Grid['block'] = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  const aperture: Grid['aperture'] = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  const join = new Uint8Array(n);
  const g: Grid = { u0, v0, nu, nv, label, block, aperture, join };

  // Ambientes techados de cada nivel (el primero que contiene el centro).
  ROOMS.forEach((r, k) => {
    if (!r.roofed) return;
    const L = roomLevel(r);
    forCells(g, polyBox(r.poly), (c, u, v) => {
      if (label[L][c] === AIR && inPoly(r.poly, u, v)) label[L][c] = k;
    });
  });

  // Doble altura: en un piso alto sin ambiente, el aire es el del ambiente
  // de abajo (el gimnasio bajo su bóveda) salvo que ahí haya una cubierta
  // baja (por encima es aire libre) o un volumen de plantas altas (con losa:
  // se deja como aire, que deja ver de más).
  for (const L of [1, 2] as const) {
    const floorY = LEVEL_Y[L];
    for (let j = 0; j < nv; j++) {
      const v = v0 + (j + 0.5) * VIS_CELL;
      for (let i = 0; i < nu; i++) {
        const c = j * nu + i;
        if (label[L][c] !== AIR) continue;
        let below = AIR;
        for (let B = L - 1; B >= 0 && below === AIR; B--) below = label[B][c];
        if (below === AIR) continue;
        const u = u0 + (i + 0.5) * VIS_CELL;
        if (ROOFS.some((rf) => rf.y < floorY + 0.5 && inPoly(rf.poly, u, v))) continue;
        if (UPPER.some((vol) => vol.floors >= L && inPoly(vol.poly, u, v))) continue;
        label[L][c] = below;
      }
    }
  }

  // Muros: los tramos llenos tapan; los vanos (con su alto) dejan ver.
  for (const w of WALLS) {
    for (const L of [0, 1, 2] as const) {
      if (!blocksLevel(w, L)) continue;
      const solid = solidSpans(w, L);
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      let t = 0;
      for (const [t0, t1] of solid) {
        if (t0 > t) rasterize(g, aperture[L], w, t, t0);
        t = t1;
      }
      if (t < len) rasterize(g, aperture[L], w, t, len);
      for (const [t0, t1] of solid) rasterize(g, block[L], w, t0, t1);
    }
  }

  // Huecos entre niveles: escaleras y vacíos de losa.
  for (const s of STAIRS) {
    const lo = levelOf(SCHOOL.floorY + s.y0);
    const hi = Math.max(lo, levelOf(SCHOOL.floorY + s.y1 + 0.3));
    let bits = 0;
    for (let L = lo; L <= hi; L++) bits |= 1 << L;
    if (lo === hi) continue;
    forCells(g, { u0: s.u0 - 0.3, v0: s.v0 - 0.3, u1: s.u1 + 0.3, v1: s.v1 + 0.3 }, (c) => {
      join[c] |= bits;
    });
  }
  for (const vd of VOIDS) {
    const bits = (1 << vd.level) | (1 << Math.max(0, vd.level - 1));
    forCells(g, vd, (c) => {
      join[c] |= bits;
    });
  }
  return g;
}

/** Recorre las celdas cuyo centro cae en el rectángulo. */
function forCells(g: Grid, r: { u0: number; v0: number; u1: number; v1: number }, fn: (c: number, u: number, v: number) => void): void {
  const i0 = Math.max(0, Math.floor((r.u0 - g.u0) / VIS_CELL));
  const i1 = Math.min(g.nu - 1, Math.ceil((r.u1 - g.u0) / VIS_CELL));
  const j0 = Math.max(0, Math.floor((r.v0 - g.v0) / VIS_CELL));
  const j1 = Math.min(g.nv - 1, Math.ceil((r.v1 - g.v0) / VIS_CELL));
  for (let j = j0; j <= j1; j++) {
    const v = g.v0 + (j + 0.5) * VIS_CELL;
    if (v < r.v0 || v > r.v1) continue;
    for (let i = i0; i <= i1; i++) {
      const u = g.u0 + (i + 0.5) * VIS_CELL;
      if (u < r.u0 || u > r.u1) continue;
      fn(j * g.nu + i, u, v);
    }
  }
}

/** Base del muro (piso de su nivel) y su coronamiento. */
function wallSpan(w: Wall): [number, number] {
  const base = LEVEL_Y[w.level];
  return [base, base + w.h];
}

/** ¿El muro (sin contar vanos) tapa la franja de los ojos de ese nivel? */
export function blocksLevel(w: Wall, level: Level): boolean {
  const [b, t] = wallSpan(w);
  return b <= LEVEL_Y[level] + EYE_LO && t >= LEVEL_Y[level] + EYE_HI;
}

/** Tramos llenos del muro (en metros desde `a`) para la vista de un nivel. */
export function solidSpans(w: Wall, level: Level): Array<[number, number]> {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const [base] = wallSpan(w);
  const lo = LEVEL_Y[level] + OPEN_LO;
  const hi = LEVEL_Y[level] + OPEN_HI;
  const open: Array<[number, number]> = [];
  for (const o of w.openings) {
    const [hb, ht] = HOLE[o.type];
    const y0 = base + (o.hb ?? hb);
    const y1 = base + (o.ht ?? ht);
    if (y1 < lo || y0 > hi) continue;
    open.push([o.t0 - JAMB, o.t1 + JAMB]);
  }
  open.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  let t = 0;
  for (const [a, b] of open) {
    if (a > t) out.push([t, Math.min(a, len)]);
    t = Math.max(t, b);
  }
  if (t < len) out.push([t, len]);
  return out;
}

/**
 * Marca las celdas que cruza el eje del muro entre t0 y t1 (recorrido de
 * celdas contiguas por lado, sin saltos en diagonal: un rayo no puede pasar
 * entre dos celdas marcadas).
 */
function rasterize(g: Grid, block: Uint8Array, w: Wall, t0: number, t1: number): void {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  if (len < 1e-6 || t1 <= t0) return;
  const du = (w.b[0] - w.a[0]) / len;
  const dv = (w.b[1] - w.a[1]) / len;
  const ua = w.a[0] + du * t0;
  const va = w.a[1] + dv * t0;
  let i = Math.floor((ua - g.u0) / VIS_CELL);
  let j = Math.floor((va - g.v0) / VIS_CELL);
  const si = du > 0 ? 1 : -1;
  const sj = dv > 0 ? 1 : -1;
  const tdi = Math.abs(du) > 1e-9 ? VIS_CELL / Math.abs(du) : Infinity;
  const tdj = Math.abs(dv) > 1e-9 ? VIS_CELL / Math.abs(dv) : Infinity;
  let ti = Math.abs(du) > 1e-9 ? (du > 0 ? (i + 1) * VIS_CELL + g.u0 - ua : ua - (i * VIS_CELL + g.u0)) / Math.abs(du) : Infinity;
  let tj = Math.abs(dv) > 1e-9 ? (dv > 0 ? (j + 1) * VIS_CELL + g.v0 - va : va - (j * VIS_CELL + g.v0)) / Math.abs(dv) : Infinity;
  const span = t1 - t0;
  for (;;) {
    if (i >= 0 && j >= 0 && i < g.nu && j < g.nv) block[j * g.nu + i] = 1;
    const next = Math.min(ti, tj);
    if (next > span) break;
    if (ti < tj) {
      ti += tdi;
      i += si;
    } else {
      tj += tdj;
      j += sj;
    }
  }
}

/** Distancia de un punto al borde de un polígono. */
function edgeDistance(poly: readonly P[], u: number, v: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [au, av] = poly[j];
    const [bu, bv] = poly[i];
    const eu = bu - au;
    const ev = bv - av;
    const l2 = eu * eu + ev * ev || 1;
    const t = Math.max(0, Math.min(1, ((u - au) * eu + (v - av) * ev) / l2));
    best = Math.min(best, Math.hypot(u - (au + eu * t), v - (av + ev * t)));
  }
  return best;
}

/**
 * Puntos de observación de un ambiente: una grilla adentro (a más de 30 cm
 * del borde) y, en cada vano de sus muros, tres puntos 35 cm hacia adentro
 * (centro y los dos extremos): parado junto a la puerta es desde donde más se
 * ve de costado.
 */
function samplePoints(room: number): Array<readonly [number, number]> {
  const r = ROOMS[room];
  const box = polyBox(r.poly);
  const area = (box.u1 - box.u0) * (box.v1 - box.v0);
  const step = Math.max(SAMPLE_STEP, Math.sqrt(area / MAX_SAMPLES));
  const out: Array<readonly [number, number]> = [];
  for (let v = box.v0 + step / 2; v < box.v1; v += step) {
    for (let u = box.u0 + step / 2; u < box.u1; u += step) {
      if (inPoly(r.poly, u, v) && edgeDistance(r.poly, u, v) >= SAMPLE_INSET) out.push([u, v]);
    }
  }
  for (const w of WALLS) {
    if (!w.openings.length) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (len < 1e-6) continue;
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    for (const o of w.openings) {
      for (const t of [(o.t0 + o.t1) / 2, Math.min(o.t1, o.t0 + 0.12), Math.max(o.t0, o.t1 - 0.12)]) {
        const pu = w.a[0] + du * t;
        const pv = w.a[1] + dv * t;
        for (const side of [1, -1]) {
          const u = pu - dv * 0.35 * side;
          const v = pv + du * 0.35 * side;
          if (inPoly(r.poly, u, v)) out.push([u, v]);
        }
      }
    }
  }
  // Un ambiente muy angosto (un pasillo de 1 m) puede no tener puntos de grilla.
  if (!out.length) {
    const cu = (box.u0 + box.u1) / 2;
    const cv = (box.v0 + box.v1) / 2;
    out.push([cu, cv]);
  }
  return out;
}
