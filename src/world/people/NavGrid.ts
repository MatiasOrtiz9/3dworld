import {
  LEVEL_Y,
  ROOMS,
  SCHOOL,
  STAIRS,
  WALKABLE,
  WALLS,
  inLot,
  levelOf,
  schoolFloorLocal,
  schoolSolidLocal,
  type Level,
  type Stair,
} from '../SchoolLayout';

/**
 * Navegación de la gente por la escuela.
 *
 * Una grilla gruesa por nivel (celdas de 25 cm) derivada de la MISMA
 * colisión que usa el jugador (`schoolSolidLocal` en modo peatón): si un muro
 * se mueve en `SchoolLayout`, la gente lo esquiva sin tocar nada acá. Sobre la
 * grilla: A* de 8 vecinos con octil y suavizado por línea de vista.
 *
 * Por qué 25 cm y no los 45 de una grilla "gruesa" típica: la colisión ya trae
 * 20 cm de margen a cada lado de los muros, así que por una puerta de 90 cm
 * queda un pasillo libre de 30 cm. Con celdas de 45 cm la mitad de las
 * puertas quedaba sin ninguna celda transitable y la escuela se partía en
 * islas. Las puertas angostas (75-80 cm) igual quedan cerradas por el margen:
 * por eso cada vano transitable abre su "canal" a mano, sobre la línea media
 * del vano, que sí está libre, y por ese canal se cruza por el medio.
 *
 * La línea de vista del suavizado es estricta: recorre las celdas y, en las
 * que tocan el margen de un muro, prueba la colisión real. Con sólo mirar
 * celdas, un camino suavizado rozaba los marcos de las puertas a 2 cm.
 *
 * Los cierres dinámicos (`setDynamicSolid`, puertas con llave de la historia)
 * no se pueden leer desde afuera de `SchoolLayout`; se DESCUBREN: cada camino
 * se valida celda por celda con la colisión viva y lo que aparece bloqueado
 * se marca un rato en una capa aparte. La gente que ya camina hacia una
 * puerta que se cierra la tantea unos pasos antes y recalcula.
 */

/** Lado de celda (m). */
export const NAV_CELL = 0.25;
/** Límites locales de la grilla: el predio, la vereda de Laprida y la calle del fondo. */
export const NAV_BOUNDS = { u0: -8, v0: -41.5, u1: 70.5, v1: 7.5 } as const;
const C = NAV_CELL;
const U0 = NAV_BOUNDS.u0;
const V0 = NAV_BOUNDS.v0;
const NU = Math.ceil((NAV_BOUNDS.u1 - U0) / C);
const NV = Math.ceil((NAV_BOUNDS.v1 - V0) / C);
const SQRT2 = Math.SQRT2;
/** Cuánto vive una marca de cierre dinámico antes de volver a tantearse (s). */
const DYN_TTL = 6;
/** Desvío máximo de la línea media al cruzar un vano angosto (m). */
const DOOR_LANE = 0.14;
/** Celdas mínimas de un área "de verdad" (≈ 9 m²): ver `isMain`. */
const MIN_AREA = 150;
/**
 * Peso de la heurística (A* ponderado): con 1 el A* es óptimo pero en un
 * camino de punta a punta del predio expandía ~22.000 celdas (25-40 ms). Con
 * 1,6 expande unas pocas miles y el camino sale apenas más largo; el
 * suavizado posterior se come la diferencia.
 */
const HW = 1.6;

/** Vanos que la gente NO usa aunque la colisión los deje pasar. */
function closedForCrowd(type: string, u: number, v: number): boolean {
  // Salidas de emergencia: siempre cerradas para el día a día.
  if (type === 'exit') return true;
  // Puerta roja del polideportivo a Laprida: de servicio. Sin esto, todo el
  // que va al gimnasio desde la vereda entraba por ahí y no por el portón.
  if (Math.abs(v) < 0.4 && u > 65.5) return true;
  return false;
}

// ================================================================ escaleras

export interface StairLink {
  id: string;
  from: Level;
  to: Level;
  /** Recorrido (u, v) desde el pie (nivel `from`) hasta la llegada (nivel `to`). */
  pts: ReadonlyArray<readonly [number, number]>;
}

type Dir = Stair['dir'];
const DIRS: Record<Dir, readonly [number, number]> = { 'u+': [1, 0], 'u-': [-1, 0], 'v+': [0, 1], 'v-': [0, -1] };

/** Punto medio del borde de arranque (pie) o de llegada (cabeza) de un tramo. */
function edgeMid(s: Stair, top: boolean): [number, number] {
  const [du, dv] = DIRS[s.dir];
  const um = (s.u0 + s.u1) / 2;
  const vm = (s.v0 + s.v1) / 2;
  const sgn = top ? 1 : -1;
  if (du !== 0) return [sgn * du > 0 ? s.u1 : s.u0, vm];
  return [um, sgn * dv > 0 ? s.v1 : s.v0];
}

/**
 * Camina un recorrido con los pies siguiendo el piso, con la regla del
 * jugador (sin margen de peatón): devuelve la altura final o NaN si choca.
 */
export function climb(pts: ReadonlyArray<readonly [number, number]>, feet0: number): number {
  let feet = feet0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, v0] = pts[i];
    const [u1, v1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.05));
    for (let k = 1; k <= n; k++) {
      const u = u0 + ((u1 - u0) * k) / n;
      const v = v0 + ((v1 - v0) * k) / n;
      if (schoolSolidLocal(u, v, feet)) return NaN;
      feet = schoolFloorLocal(u, v, feet);
    }
  }
  return feet;
}

/**
 * Escaleras que usa la gente, DERIVADAS de `STAIRS`: se encadenan tramos
 * (la llegada de uno a menos de 3 m del arranque del siguiente, a la misma
 * altura, a través de su descanso) desde un piso hasta otro, y cada cadena se
 * recorre por el medio de los tramos con la misma regla de pies que el
 * jugador. Sólo quedan las que llegan limpias al piso de arriba. Así, si la
 * escalera se corre en `SchoolLayout`, la gente la sigue usando.
 *
 * La multitud no pisa escaleras por la grilla —para ella son macizas—; las
 * cruza por estos enlaces.
 */
export function deriveStairLinks(): StairLink[] {
  const floorOf = (y: number): Level | -1 => {
    for (let l = 0; l < 3; l++) if (Math.abs(y - l * SCHOOL.storey) < 0.06) return l as Level;
    return -1;
  };
  const out: StairLink[] = [];
  const seen = new Set<string>();
  const finish = (chain: Stair[]) => {
    const first = chain[0];
    const last = chain[chain.length - 1];
    const fromL = floorOf(first.y0) as Level;
    const toL = floorOf(last.y1) as Level;
    const pts: Array<[number, number]> = [];
    const [d0u, d0v] = DIRS[first.dir];
    const b0 = edgeMid(first, false);
    pts.push([b0[0] - d0u * 0.45, b0[1] - d0v * 0.45], b0);
    for (let i = 0; i < chain.length; i++) {
      const s = chain[i];
      const [du, dv] = DIRS[s.dir];
      const top = edgeMid(s, true);
      pts.push(top);
      const next = chain[i + 1];
      if (next) {
        // Cruce del descanso: medio metro adentro desde la llegada de un
        // tramo y medio metro antes del arranque del siguiente.
        const [nu, nv] = DIRS[next.dir];
        const nb = edgeMid(next, false);
        pts.push([top[0] + du * 0.5, top[1] + dv * 0.5], [nb[0] - nu * 0.5, nb[1] - nv * 0.5], nb);
      } else {
        pts.push([top[0] + du * 0.55, top[1] + dv * 0.55]);
      }
    }
    // La escalera del jardín repite la planta piso por piso: la clave lleva los niveles.
    const key = `${fromL}>${toL}:` + pts.map(([u, v]) => `${u.toFixed(1)},${v.toFixed(1)}`).join(';');
    if (seen.has(key)) return;
    const feet = climb(pts, LEVEL_Y[fromL]);
    if (Number.isFinite(feet) && levelOf(feet) === toL && Math.abs(feet - LEVEL_Y[toL]) < 0.06) {
      seen.add(key);
      out.push({ id: `s${out.length}`, from: fromL, to: toL, pts });
    }
  };
  const extend = (chain: Stair[]) => {
    const last = chain[chain.length - 1];
    if (floorOf(last.y1) >= 0) {
      finish(chain);
      return;
    }
    if (chain.length >= 4) return;
    const top = edgeMid(last, true);
    for (const s of STAIRS) {
      if (chain.includes(s) || Math.abs(s.y0 - last.y1) > 0.06) continue;
      const b = edgeMid(s, false);
      if (Math.hypot(b[0] - top[0], b[1] - top[1]) > 3) continue;
      extend([...chain, s]);
    }
  };
  for (const s of STAIRS) if (floorOf(s.y0) >= 0) extend([s]);
  return out;
}

let links: StairLink[] | null = null;
/** Enlaces de escalera (se derivan una vez, la primera vez que se piden). */
export function stairLinks(): readonly StairLink[] {
  return links ?? (links = deriveStairLinks());
}

// ==================================================================== caminos

/** Tramo de un camino: caminata sobre un nivel o cruce de una escalera. */
export interface PathLeg {
  level: Level;
  /** Puntos (u, v) en orden de marcha. */
  pts: number[];
  /** Si es una escalera, el enlace y el nivel de llegada. */
  stair?: StairLink;
  toLevel?: Level;
}

export interface NavPath {
  legs: PathLeg[];
  /** Largo total aproximado (m). */
  length: number;
}

export interface NavPoint {
  u: number;
  v: number;
  level: Level;
}

/** Pedido de camino (ver `NavGrid.request`). */
export interface PathJob {
  from: NavPoint;
  to: NavPoint;
  done: (p: NavPath | null) => void;
  /** Se pone en true para descartarlo (el que lo pidió cambió de idea). */
  cancelled: boolean;
}

/** Tramo a resolver: caminata sobre un nivel o escalera ya armada. */
interface Seg {
  level: Level;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  stair?: PathLeg;
}

interface JobState {
  job: PathJob;
  segs: Seg[] | null;
  i: number;
  legs: PathLeg[];
  searching: boolean;
  attempts: number;
  s: number;
  g: number;
}

interface Search {
  nl: NavLevel;
  start: number;
  goal: number;
  st: number;
  gi: number;
  gj: number;
  expanded: number;
  /** 0 buscando, 1 encontrado, −1 sin camino. */
  state: number;
}

/** Montículo binario de índices con prioridad flotante (para A*). */
class Heap {
  private idx = new Int32Array(1024);
  private key = new Float32Array(1024);
  size = 0;

  clear(): void {
    this.size = 0;
  }

  push(i: number, k: number): void {
    if (this.size >= this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2);
      const nk = new Float32Array(this.key.length * 2);
      ni.set(this.idx);
      nk.set(this.key);
      this.idx = ni;
      this.key = nk;
    }
    let n = this.size++;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.key[p] <= k) break;
      this.idx[n] = this.idx[p];
      this.key[n] = this.key[p];
      n = p;
    }
    this.idx[n] = i;
    this.key[n] = k;
  }

  pop(): number {
    const top = this.idx[0];
    const last = --this.size;
    if (last > 0) {
      const li = this.idx[last];
      const lk = this.key[last];
      let n = 0;
      for (;;) {
        let c = 2 * n + 1;
        if (c >= last) break;
        if (c + 1 < last && this.key[c + 1] < this.key[c]) c++;
        if (this.key[c] >= lk) break;
        this.idx[n] = this.idx[c];
        this.key[n] = this.key[c];
        n = c;
      }
      this.idx[n] = li;
      this.key[n] = lk;
    }
    return top;
  }
}

/** Una planta de la grilla. */
export class NavLevel {
  /** 1 = transitable (estático). */
  readonly walk = new Uint8Array(NU * NV);
  /** 1 = la celda entera queda fuera del margen de los muros (no hace falta probar la colisión). */
  readonly interior = new Uint8Array(NU * NV);
  /** Altura del piso por celda (sólo varía en planta baja: vereda vs. interior). */
  readonly floor: Float32Array | null;
  /** Componente conexa de cada celda (−1 si no es transitable). */
  readonly comp = new Int32Array(NU * NV);
  /** Celdas abiertas a mano en los vanos: punto de prueba (u, v) y tangente del muro. */
  readonly probe = new Map<number, readonly [number, number, number, number]>();
  /** Capa de cierres dinámicos descubiertos: instante de la marca (0 = libre). */
  readonly dyn = new Float32Array(NU * NV);
  /** Tamaño de cada componente conexa. */
  readonly sizes: number[] = [];

  constructor(
    readonly level: Level,
    surface?: (u: number, v: number) => number,
  ) {
    const feet = LEVEL_Y[level];
    // En los pisos altos sólo hay piso dentro de los ambientes de ese nivel:
    // fuera de sus rectángulos ni se pregunta (es la mayor parte de la grilla).
    const boxes: Array<[number, number, number, number]> = [];
    if (level > 0) {
      for (const r of ROOMS) {
        if ((r.level ?? 0) !== level) continue;
        let a = Infinity;
        let b = Infinity;
        let c = -Infinity;
        let d = -Infinity;
        for (const [u, v] of r.poly) {
          a = Math.min(a, u);
          b = Math.min(b, v);
          c = Math.max(c, u);
          d = Math.max(d, v);
        }
        boxes.push([a - 0.3, b - 0.3, c + 0.3, d + 0.3]);
      }
    }
    const maybe = (u: number, v: number) => {
      if (level === 0) return true;
      for (const [a, b, c, d] of boxes) if (u >= a && u <= c && v >= b && v <= d) return true;
      return false;
    };
    for (let j = 0; j < NV; j++) {
      const v = V0 + (j + 0.5) * C;
      for (let i = 0; i < NU; i++) {
        const u = U0 + (i + 0.5) * C;
        this.walk[j * NU + i] = maybe(u, v) && !schoolSolidLocal(u, v, feet, true) ? 1 : 0;
      }
    }
    // Celda "interior": ella y sus ocho vecinas libres. Lejos de todo margen,
    // la línea de vista no necesita probar la colisión real ahí.
    for (let j = 1; j < NV - 1; j++) {
      for (let i = 1; i < NU - 1; i++) {
        const k = j * NU + i;
        if (!this.walk[k]) continue;
        this.interior[k] =
          this.walk[k - 1] & this.walk[k + 1] & this.walk[k - NU] & this.walk[k + NU] &
          this.walk[k - NU - 1] & this.walk[k - NU + 1] & this.walk[k + NU - 1] & this.walk[k + NU + 1];
      }
    }
    this.openDoors(feet);
    if (level === 0) {
      const f = new Float32Array(NU * NV);
      for (let j = 0; j < NV; j++) {
        const v = V0 + (j + 0.5) * C;
        for (let i = 0; i < NU; i++) {
          const u = U0 + (i + 0.5) * C;
          f[j * NU + i] = inLot(u, v) && v <= 0 ? SCHOOL.floorY : surface ? surface(u, v) : 0;
        }
      }
      this.floor = f;
    } else {
      this.floor = null;
    }
    this.label();
  }

  /** Abre el canal de cada vano transitable y cierra los que la gente no usa. */
  private openDoors(feet: number): void {
    for (const w of WALLS) {
      if (w.level !== this.level) continue;
      const du = w.b[0] - w.a[0];
      const dv = w.b[1] - w.a[1];
      const len = Math.hypot(du, dv);
      if (len < 1e-6) continue;
      const tu = du / len;
      const tv = dv / len;
      const nu = -tv;
      const nv = tu;
      for (const o of w.openings) {
        if (!WALKABLE.has(o.type)) continue;
        // Vanos en altura (los pasos de la torre a 2,45 m): no son del piso.
        if ((o.hb ?? 0) > 0.5) continue;
        const tc = (o.t0 + o.t1) / 2;
        const half = (o.t1 - o.t0) / 2;
        const cu = w.a[0] + tu * tc;
        const cv = w.a[1] + tv * tc;
        if (closedForCrowd(o.type, cu, cv)) {
          this.forEachNear(cu, cv, half + 0.6, (k, u, v) => {
            const a = (u - cu) * tu + (v - cv) * tv;
            const p = (u - cu) * nu + (v - cv) * nv;
            if (Math.abs(a) <= half + 0.1 && Math.abs(p) <= 0.45) {
              this.walk[k] = 0;
              this.interior[k] = 0;
            }
          });
          continue;
        }
        // Canal: celdas cuyo centro cae a menos de (medio vano − 22 cm) de la
        // línea media y a menos de 50 cm del muro. Su punto de prueba es la
        // proyección sobre la línea media, que tiene que estar libre.
        const lat = Math.max(0.05, half - 0.22);
        this.forEachNear(cu, cv, half + 0.6, (k, u, v) => {
          if (this.walk[k]) return;
          const a = (u - cu) * tu + (v - cv) * tv;
          const p = (u - cu) * nu + (v - cv) * nv;
          if (Math.abs(a) > lat || Math.abs(p) > 0.5) return;
          const pu = cu + nu * p;
          const pv = cv + nv * p;
          if (schoolSolidLocal(pu, pv, feet, true)) return;
          this.walk[k] = 1;
          this.probe.set(k, [pu, pv, tu, tv]);
        });
      }
    }
  }

  private forEachNear(cu: number, cv: number, r: number, fn: (k: number, u: number, v: number) => void): void {
    const i0 = Math.max(0, Math.floor((cu - r - U0) / C));
    const i1 = Math.min(NU - 1, Math.floor((cu + r - U0) / C));
    const j0 = Math.max(0, Math.floor((cv - r - V0) / C));
    const j1 = Math.min(NV - 1, Math.floor((cv + r - V0) / C));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) fn(j * NU + i, U0 + (i + 0.5) * C, V0 + (j + 0.5) * C);
    }
  }

  /** Componentes conexas (8 vecinos, sin cortar esquinas). */
  private label(): void {
    this.comp.fill(-1);
    const stack = new Int32Array(NU * NV);
    let id = 0;
    for (let s = 0; s < NU * NV; s++) {
      if (!this.walk[s] || this.comp[s] >= 0) continue;
      let top = 0;
      stack[top++] = s;
      this.comp[s] = id;
      let count = 0;
      while (top > 0) {
        const c = stack[--top];
        count++;
        const ci = c % NU;
        const cj = (c - ci) / NU;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ni = ci + di;
            const nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= NU || nj >= NV) continue;
            const n = nj * NU + ni;
            if (!this.walk[n] || this.comp[n] >= 0) continue;
            if (di && dj && (!this.walk[cj * NU + ni] || !this.walk[nj * NU + ci])) continue;
            this.comp[n] = id;
            stack[top++] = n;
          }
        }
      }
      this.sizes.push(count);
      id++;
    }
  }
}

/** Celda de un punto local, o −1 fuera de la grilla. */
export function cellOf(u: number, v: number): number {
  const i = Math.floor((u - U0) / C);
  const j = Math.floor((v - V0) / C);
  if (i < 0 || j < 0 || i >= NU || j >= NV) return -1;
  return j * NU + i;
}

export function cellCenter(k: number): [number, number] {
  const i = k % NU;
  const j = (k - i) / NU;
  return [U0 + (i + 0.5) * C, V0 + (j + 0.5) * C];
}

/**
 * La grilla completa: tres plantas (las altas se arman la primera vez que
 * alguien las necesita, para no pagar su costo al arrancar en VR).
 */
export class NavGrid {
  private readonly levels: Array<NavLevel | null> = [null, null, null];
  private readonly heap = new Heap();
  private readonly g = new Float32Array(NU * NV);
  private readonly parent = new Int32Array(NU * NV);
  private readonly seen = new Uint32Array(NU * NV);
  private readonly closed = new Uint32Array(NU * NV);
  private stamp = 1;
  private search: Search | null = null;
  private readonly jobs: JobState[] = [];
  /** Reloj (s) de la capa dinámica; lo avanza la simulación. */
  now = 0;
  /** Expansiones de A* acumuladas (para medir el costo). */
  expansions = 0;

  constructor(private readonly surface?: (u: number, v: number) => number) {}

  level(l: Level): NavLevel {
    return this.levels[l] ?? (this.levels[l] = new NavLevel(l, l === 0 ? this.surface : undefined));
  }

  /** ¿Se puede estar parado ahí? (estático + cierres descubiertos vigentes). */
  isWalkable(l: Level, u: number, v: number): boolean {
    const k = cellOf(u, v);
    return k >= 0 && this.open(this.level(l), k);
  }

  private open(nl: NavLevel, k: number): boolean {
    if (!nl.walk[k]) return false;
    const t = nl.dyn[k];
    return t === 0 || this.now - t > DYN_TTL;
  }

  /** Altura del piso de ese nivel en (u, v). */
  floorAt(l: Level, u: number, v: number): number {
    if (l > 0) return LEVEL_Y[l];
    const nl = this.level(0);
    const k = cellOf(u, v);
    if (k < 0 || !nl.floor) return 0;
    return nl.floor[k];
  }

  /** Componente conexa del punto (−1 si no es transitable). */
  componentAt(l: Level, u: number, v: number): number {
    const k = cellOf(u, v);
    return k < 0 ? -1 : this.level(l).comp[k];
  }

  /**
   * ¿Es parte de un área de verdad? Entre mesas y paredes quedan bolsillos de
   * pocas celdas sueltas, transitables pero sin salida: un lugar de llegada
   * ahí deja a la gente sin camino.
   */
  isMain(l: Level, u: number, v: number): boolean {
    const nl = this.level(l);
    const k = cellOf(u, v);
    return k >= 0 && this.open(nl, k) && nl.comp[k] >= 0 && nl.sizes[nl.comp[k]] >= MIN_AREA;
  }

  /** Celda transitable más cercana (búsqueda en anillos), o −1. Con `main`, sólo en áreas de verdad. */
  nearestCell(l: Level, u: number, v: number, maxR = 2, main = false): number {
    const nl = this.level(l);
    const ok = (k: number) => this.open(nl, k) && (!main || (nl.comp[k] >= 0 && nl.sizes[nl.comp[k]] >= MIN_AREA));
    const k0 = cellOf(u, v);
    if (k0 >= 0 && ok(k0)) return k0;
    const ci = Math.floor((u - U0) / C);
    const cj = Math.floor((v - V0) / C);
    const rMax = Math.ceil(maxR / C);
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= rMax; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= NU || j >= NV) continue;
          const k = j * NU + i;
          if (!ok(k)) continue;
          const [cu, cv] = this.pointOf(nl, k);
          const d = (cu - u) ** 2 + (cv - v) ** 2;
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
      }
      // Un anillo más allá del primer hallazgo puede tener algo más cerca (en
      // diagonal): se corta recién después de revisarlo.
      if (best >= 0 && r * C > Math.sqrt(bestD) + C) break;
    }
    return best;
  }

  nearestWalkable(l: Level, u: number, v: number, maxR = 2, main = true): { u: number; v: number } | null {
    const k = this.nearestCell(l, u, v, maxR, main);
    if (k < 0) return null;
    const [cu, cv] = this.pointOf(this.level(l), k);
    return { u: cu, v: cv };
  }

  /** Punto representativo de una celda: su centro, o la línea media del vano. */
  private pointOf(nl: NavLevel, k: number): readonly [number, number] {
    const p = nl.probe.get(k);
    return p ? [p[0], p[1]] : cellCenter(k);
  }

  /**
   * Recorre las celdas que toca el segmento (Amanatides-Woo) con el tramo
   * [tIn, tOut] del segmento dentro de cada una. Al cruzar justo por una
   * esquina se visitan las dos celdas laterales: si no, la línea "pasaría"
   * en diagonal entre dos muros que se tocan en un vértice.
   */
  private traverse(u0: number, v0: number, u1: number, v1: number, visit: (i: number, j: number, tIn: number, tOut: number) => boolean): boolean {
    const du = u1 - u0;
    const dv = v1 - v0;
    let i = Math.floor((u0 - U0) / C);
    let j = Math.floor((v0 - V0) / C);
    const iEnd = Math.floor((u1 - U0) / C);
    const jEnd = Math.floor((v1 - V0) / C);
    const si = du > 0 ? 1 : du < 0 ? -1 : 0;
    const sj = dv > 0 ? 1 : dv < 0 ? -1 : 0;
    const fu = (u0 - U0) / C;
    const fv = (v0 - V0) / C;
    const tdu = si !== 0 ? Math.abs(C / du) : Infinity;
    const tdv = sj !== 0 ? Math.abs(C / dv) : Infinity;
    let tmu = si > 0 ? (i + 1 - fu) * tdu : si < 0 ? (fu - i) * tdu : Infinity;
    let tmv = sj > 0 ? (j + 1 - fv) * tdv : sj < 0 ? (fv - j) * tdv : Infinity;
    let t = 0;
    let guard = NU + NV + 8;
    for (;;) {
      const last = (i === iEnd && j === jEnd) || guard-- <= 0 || t >= 1;
      const tOut = last ? 1 : Math.min(tmu, tmv, 1);
      if (!visit(i, j, t, tOut)) return false;
      if (last) return true;
      if (Math.abs(tmu - tmv) < 1e-9) {
        if (!visit(i + si, j, tmu, tmu) || !visit(i, j + sj, tmu, tmu)) return false;
        i += si;
        j += sj;
        t = tmu;
        tmu += tdu;
        tmv += tdv;
      } else if (tmu < tmv) {
        i += si;
        t = tmu;
        tmu += tdu;
      } else {
        j += sj;
        t = tmv;
        tmv += tdv;
      }
    }
  }

  /** Línea de vista "de celdas": todas las celdas que toca están abiertas. */
  lineOfSight(l: Level, u0: number, v0: number, u1: number, v1: number): boolean {
    const nl = this.level(l);
    return this.traverse(u0, v0, u1, v1, (i, j) => i >= 0 && j >= 0 && i < NU && j < NV && this.open(nl, j * NU + i));
  }

  /**
   * Línea de vista estricta: además de celdas abiertas, en las celdas de
   * borde (las que tocan el margen de un muro) se prueba la colisión real en
   * la entrada, el medio y la salida del tramo; en el canal de un vano hay que
   * ir por la línea media.
   */
  segmentClear(l: Level, u0: number, v0: number, u1: number, v1: number): boolean {
    const nl = this.level(l);
    const feet = LEVEL_Y[l];
    const du = u1 - u0;
    const dv = v1 - v0;
    const ok = (k: number, u: number, v: number): boolean => {
      const p = nl.probe.get(k);
      if (p) return Math.abs((u - p[0]) * p[2] + (v - p[1]) * p[3]) <= DOOR_LANE;
      return !schoolSolidLocal(u, v, feet, true);
    };
    return this.traverse(u0, v0, u1, v1, (i, j, tIn, tOut) => {
      if (i < 0 || j < 0 || i >= NU || j >= NV) return false;
      const k = j * NU + i;
      if (!this.open(nl, k)) return false;
      if (nl.interior[k]) return true;
      const tm = (tIn + tOut) / 2;
      return ok(k, u0 + du * tIn, v0 + dv * tIn) && ok(k, u0 + du * tm, v0 + dv * tm) && ok(k, u0 + du * tOut, v0 + dv * tOut);
    });
  }

  /**
   * Tantea el camino con la colisión viva: si una celda que la grilla da por
   * libre ahora está cerrada (una puerta con llave), marca la zona cerrada y
   * devuelve false para que se recalcule.
   */
  private validate(nl: NavLevel, cells: number[]): boolean {
    const feet = LEVEL_Y[nl.level];
    for (let n = 0; n < cells.length; n++) {
      const k = cells[n];
      // Las interiores lejos de vanos casi nunca cambian: se tantea una de cada dos.
      if (nl.interior[k] && n % 2 === 1) continue;
      const [pu, pv] = this.pointOf(nl, k);
      if (!schoolSolidLocal(pu, pv, feet, true)) continue;
      this.markClosed(nl, pu, pv);
      return false;
    }
    return true;
  }

  /** Marca como cerradas las celdas cercanas cuya prueba ahora choca. */
  private markClosed(nl: NavLevel, u: number, v: number): void {
    const feet = LEVEL_Y[nl.level];
    const r = 1.4;
    const i0 = Math.max(0, Math.floor((u - r - U0) / C));
    const i1 = Math.min(NU - 1, Math.floor((u + r - U0) / C));
    const j0 = Math.max(0, Math.floor((v - r - V0) / C));
    const j1 = Math.min(NV - 1, Math.floor((v + r - V0) / C));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * NU + i;
        if (!nl.walk[k]) continue;
        const [pu, pv] = this.pointOf(nl, k);
        if (schoolSolidLocal(pu, pv, feet, true)) nl.dyn[k] = Math.max(1e-3, this.now);
      }
    }
  }

  /** ¿La celda bajo (u, v) está cerrada AHORA? (el tanteo de quien camina). */
  probeClosed(l: Level, u: number, v: number): boolean {
    const nl = this.level(l);
    const k = cellOf(u, v);
    if (k < 0 || !nl.walk[k]) return false;
    const [pu, pv] = this.pointOf(nl, k);
    if (!schoolSolidLocal(pu, pv, LEVEL_Y[l], true)) return false;
    this.markClosed(nl, pu, pv);
    return true;
  }

  // ------------------------------------------------------------ A* reanudable

  /**
   * Arranca una búsqueda A* entre dos celdas. La búsqueda avanza de a
   * pedazos (`searchStep`) con un presupuesto de expansiones por cuadro: un
   * camino de punta a punta del predio no traba un cuadro del visor.
   */
  private searchStart(nl: NavLevel, start: number, goal: number): void {
    if (++this.stamp >= 0xfffffff0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    const st = this.stamp;
    this.heap.clear();
    const gi = goal % NU;
    this.search = { nl, start, goal, st, gi, gj: (goal - gi) / NU, expanded: 0, state: 0 };
    this.g[start] = 0;
    this.seen[start] = st;
    this.parent[start] = -1;
    if (start === goal) {
      this.closed[start] = st;
      this.search.state = 1;
      return;
    }
    this.heap.push(start, this.heur(start) * HW);
  }

  private heur(k: number): number {
    const s = this.search!;
    const i = k % NU;
    const dx = Math.abs(i - s.gi);
    const dy = Math.abs((k - i) / NU - s.gj);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  }

  /** Avanza la búsqueda hasta `budget` expansiones. Devuelve las usadas. */
  private searchStep(budget: number): number {
    const s = this.search!;
    if (s.state !== 0) return 0;
    const { nl, st, goal } = s;
    const heap = this.heap;
    let used = 0;
    while (heap.size > 0 && used < budget) {
      const c = heap.pop();
      if (this.closed[c] === st) continue;
      this.closed[c] = st;
      if (c === goal) {
        s.state = 1;
        break;
      }
      used++;
      if (++s.expanded > 120000) break;
      const ci = c % NU;
      const cj = (c - ci) / NU;
      const gc = this.g[c];
      for (let dj = -1; dj <= 1; dj++) {
        const nj = cj + dj;
        if (nj < 0 || nj >= NV) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          if (ni < 0 || ni >= NU) continue;
          const n = nj * NU + ni;
          if (this.closed[n] === st || !this.open(nl, n)) continue;
          if (di && dj && (!this.open(nl, cj * NU + ni) || !this.open(nl, nj * NU + ci))) continue;
          // Las celdas de borde cuestan un poco más: el camino prefiere ir
          // por el medio de los pasillos y no pegado a la pared.
          const ng = gc + (di && dj ? SQRT2 : 1) * (nl.interior[n] ? 1 : 1.35);
          if (this.seen[n] === st && ng >= this.g[n]) continue;
          this.seen[n] = st;
          this.g[n] = ng;
          this.parent[n] = c;
          heap.push(n, ng + this.heur(n) * HW);
        }
      }
    }
    if (s.state === 0 && (heap.size === 0 || s.expanded > 120000)) s.state = -1;
    this.expansions += used;
    return used;
  }

  private searchCells(): number[] {
    const s = this.search!;
    const cells: number[] = [];
    for (let c = s.goal; c >= 0; c = this.parent[c]) cells.push(c);
    cells.reverse();
    return cells;
  }

  /**
   * Suavizado: desde cada ancla, el punto más lejano con línea de vista
   * estricta (búsqueda con saltos crecientes: los caminos largos tienen
   * cientos de celdas). Si ni la celda siguiente se ve, se avanza igual.
   */
  private smooth(nl: NavLevel, cells: number[], u0: number, v0: number, u1: number, v1: number): number[] {
    const l = nl.level;
    const pts: number[] = [u0, v0];
    const first = this.pointOf(nl, cells[0]);
    if (Math.hypot(first[0] - u0, first[1] - v0) > 0.05) pts.push(first[0], first[1]);
    let anchor = 0;
    let au = first[0];
    let av = first[1];
    while (anchor < cells.length - 1) {
      let far = anchor + 1;
      let step = 1;
      let probe = anchor + 1;
      let blocked = cells.length;
      while (probe < cells.length) {
        const [qu, qv] = this.pointOf(nl, cells[probe]);
        if (this.segmentClear(l, au, av, qu, qv)) {
          far = probe;
          probe += step;
          step = Math.min(step * 2, 24);
        } else {
          blocked = probe;
          break;
        }
      }
      // Afinar entre el último visible y el primer bloqueado.
      for (let k = Math.min(blocked, cells.length) - 1; k > far; k--) {
        const [qu, qv] = this.pointOf(nl, cells[k]);
        if (this.segmentClear(l, au, av, qu, qv)) {
          far = k;
          break;
        }
      }
      const [fu, fv] = this.pointOf(nl, cells[far]);
      pts.push(fu, fv);
      au = fu;
      av = fv;
      anchor = far;
    }
    // El destino exacto, sólo si se llega en línea recta sin rozar nada.
    if (Math.hypot(u1 - au, v1 - av) > 0.05 && this.segmentClear(l, au, av, u1, v1)) pts.push(u1, v1);
    return dedupe(pts);
  }

  // ------------------------------------------------------------- pedidos

  /**
   * Pide un camino. Se resuelve en algún cuadro siguiente (`work`) y avisa
   * por `done` (null si no hay forma de llegar). Los urgentes (personajes
   * con nombre, gente a la vista) pasan adelante.
   */
  request(from: NavPoint, to: NavPoint, done: (p: NavPath | null) => void, urgent = false): PathJob {
    const job: PathJob = { from, to, done, cancelled: false };
    const js: JobState = { job, segs: null, i: 0, legs: [], searching: false, attempts: 0, s: -1, g: -1 };
    if (urgent && this.jobs.length > 0) {
      // Detrás del que está en curso (su búsqueda está a medias).
      this.jobs.splice(this.jobs[0].searching ? 1 : 0, 0, js);
    } else {
      this.jobs.push(js);
    }
    return job;
  }

  /** Pedidos pendientes. */
  get pendingJobs(): number {
    return this.jobs.length;
  }

  /** Avanza los pedidos hasta gastar `budget` (expansiones de A* y su equivalente en suavizado). */
  work(budget: number): void {
    let used = 0;
    while (this.jobs.length > 0 && used < budget) {
      const js = this.jobs[0];
      const r = this.advance(js, budget - used);
      used += r.used;
      if (r.finished) this.jobs.shift();
      else if (!r.progress) break;
    }
  }

  /** Un paso de un pedido: planifica, busca, valida y suaviza. */
  private advance(js: JobState, budget: number): { used: number; finished: boolean; progress: boolean } {
    const job = js.job;
    let used = 0;
    const finish = (p: NavPath | null) => {
      js.searching = false;
      if (!job.cancelled) job.done(p);
      return { used, finished: true, progress: true };
    };
    if (job.cancelled) return finish(null);
    if (!js.segs) {
      js.segs = this.plan(job.from, job.to);
      used += 50;
      if (!js.segs) return finish(null);
    }
    while (used < budget) {
      const seg = js.segs[js.i];
      if (!seg) {
        let length = 0;
        for (const leg of js.legs) length += polyLength(leg.pts);
        return finish({ legs: js.legs, length });
      }
      if (seg.stair) {
        js.legs.push(seg.stair);
        js.i++;
        continue;
      }
      const nl = this.level(seg.level);
      if (!js.searching) {
        js.s = this.nearestCell(seg.level, seg.u0, seg.v0, 2.5, true);
        js.g = this.nearestCell(seg.level, seg.u1, seg.v1, 2.5, true);
        if (js.s < 0 || js.g < 0 || nl.comp[js.s] !== nl.comp[js.g]) return finish(null);
        this.searchStart(nl, js.s, js.g);
        js.searching = true;
        used += 20;
      }
      used += this.searchStep(budget - used);
      const st = this.search!.state;
      if (st === 0) return { used, finished: false, progress: true };
      js.searching = false;
      if (st < 0) return finish(null);
      const cells = this.searchCells();
      used += cells.length;
      if (!this.validate(nl, cells)) {
        // Una puerta se cerró: se marcó y se vuelve a buscar (pocas veces).
        if (++js.attempts >= 4) return finish(null);
        continue;
      }
      const pts = this.smooth(nl, cells, seg.u0, seg.v0, seg.u1, seg.v1);
      used += cells.length * 2;
      js.legs.push({ level: seg.level, pts });
      js.i++;
    }
    return { used, finished: false, progress: used > 0 };
  }

  /** Tramos de un camino: caminatas por nivel y escaleras entre medio. */
  private plan(a: NavPoint, b: NavPoint): Seg[] | null {
    const ca = this.compNear(a);
    const cb = this.compNear(b);
    if (ca < 0 || cb < 0) return null;
    if (a.level === b.level && ca === cb) return [{ level: a.level, u0: a.u, v0: a.v, u1: b.u, v1: b.v }];
    const route = this.linkRoute(a, ca, b, cb);
    if (!route) return null;
    const segs: Seg[] = [];
    let cur: NavPoint = a;
    for (const step of route) {
      const seq = step.reverse ? [...step.link.pts].reverse() : step.link.pts;
      const fromL = step.reverse ? step.link.to : step.link.from;
      const toL = step.reverse ? step.link.from : step.link.to;
      segs.push({ level: cur.level, u0: cur.u, v0: cur.v, u1: seq[0][0], v1: seq[0][1] });
      const sp: number[] = [];
      for (const [u, v] of seq) sp.push(u, v);
      segs.push({ level: fromL, u0: 0, v0: 0, u1: 0, v1: 0, stair: { level: fromL, pts: sp, stair: step.link, toLevel: toL } });
      const end = seq[seq.length - 1];
      cur = { u: end[0], v: end[1], level: toL };
    }
    segs.push({ level: cur.level, u0: cur.u, v0: cur.v, u1: b.u, v1: b.v });
    return segs;
  }

  /**
   * Camino inmediato (sin presupuesto): para pruebas y herramientas. Si había
   * un pedido a medio buscar, ese vuelve a empezar su tramo.
   */
  findPath(a: NavPoint, b: NavPoint): NavPath | null {
    let out: NavPath | null = null;
    const js: JobState = {
      job: { from: a, to: b, done: (p) => (out = p), cancelled: false },
      segs: null,
      i: 0,
      legs: [],
      searching: false,
      attempts: 0,
      s: -1,
      g: -1,
    };
    for (let guard = 0; guard < 100; guard++) if (this.advance(js, Infinity).finished) break;
    if (this.jobs.length > 0) this.jobs[0].searching = false;
    return out;
  }

  /** Camino suavizado sobre un nivel (inmediato). */
  levelPath(l: Level, u0: number, v0: number, u1: number, v1: number): number[] | null {
    const p = this.findPath({ u: u0, v: v0, level: l }, { u: u1, v: v1, level: l });
    return p && p.legs.length === 1 ? p.legs[0].pts : null;
  }

  private compNear(p: NavPoint, maxR = 2.5): number {
    const k = this.nearestCell(p.level, p.u, p.v, maxR, true);
    return k < 0 ? -1 : this.level(p.level).comp[k];
  }

  private usable: StairLink[] | null = null;

  /**
   * Escaleras que la gente puede usar: las dos puntas a menos de 80 cm de un
   * área transitable de su piso. La escalera exterior del patio este llega a
   * un descanso afuera del edificio que la grilla del primer piso no tiene:
   * enganchar su llegada a la celda más cercana la hacía "atravesar" el muro.
   */
  usableLinks(): readonly StairLink[] {
    if (this.usable) return this.usable;
    this.usable = stairLinks().filter((k) => {
      const a = k.pts[0];
      const b = k.pts[k.pts.length - 1];
      return this.compNear({ u: a[0], v: a[1], level: k.from }, 0.8) >= 0 && this.compNear({ u: b[0], v: b[1], level: k.to }, 0.8) >= 0;
    });
    return this.usable;
  }

  /** Secuencia de escaleras (Dijkstra sobre componentes) para ir de a a b. */
  private linkRoute(a: NavPoint, ca: number, b: NavPoint, cb: number): Array<{ link: StairLink; reverse: boolean }> | null {
    interface Node {
      level: Level;
      comp: number;
      u: number;
      v: number;
      cost: number;
      via: Array<{ link: StairLink; reverse: boolean }>;
    }
    const key = (l: Level, c: number) => l * 100000 + c;
    const best = new Map<number, number>();
    const open: Node[] = [{ level: a.level, comp: ca, u: a.u, v: a.v, cost: 0, via: [] }];
    best.set(key(a.level, ca), 0);
    let found: { cost: number; via: Node['via'] } | null = null;
    while (open.length > 0) {
      open.sort((x, y) => x.cost - y.cost);
      const n = open.shift()!;
      if (found && n.cost >= found.cost) break;
      if (n.level === b.level && n.comp === cb) {
        const total = n.cost + Math.hypot(b.u - n.u, b.v - n.v);
        if (!found || total < found.cost) found = { cost: total, via: n.via };
        continue;
      }
      if (n.via.length >= 3) continue;
      for (const link of this.usableLinks()) {
        for (const reverse of [false, true]) {
          const fromL = reverse ? link.to : link.from;
          const toL = reverse ? link.from : link.to;
          if (fromL !== n.level) continue;
          const p0 = reverse ? link.pts[link.pts.length - 1] : link.pts[0];
          const p1 = reverse ? link.pts[0] : link.pts[link.pts.length - 1];
          if (this.compNear({ u: p0[0], v: p0[1], level: fromL }, 0.8) !== n.comp) continue;
          const c1 = this.compNear({ u: p1[0], v: p1[1], level: toL }, 0.8);
          if (c1 < 0) continue;
          const cost = n.cost + Math.hypot(p0[0] - n.u, p0[1] - n.v) + polyLengthPairs(link.pts) * 1.5;
          const kk = key(toL, c1);
          if ((best.get(kk) ?? Infinity) <= cost) continue;
          best.set(kk, cost);
          open.push({ level: toL, comp: c1, u: p1[0], v: p1[1], cost, via: [...n.via, { link, reverse }] });
        }
      }
    }
    return found ? found.via : null;
  }

  /** Punto transitable al azar dentro de un rectángulo (o null tras unos intentos). */
  randomPoint(
    l: Level,
    r: { u0: number; v0: number; u1: number; v1: number },
    rnd: () => number,
    clearance = 0,
    comp = -1,
  ): { u: number; v: number } | null {
    for (let k = 0; k < 24; k++) {
      const u = r.u0 + rnd() * (r.u1 - r.u0);
      const v = r.v0 + rnd() * (r.v1 - r.v0);
      if (!this.isMain(l, u, v)) continue;
      if (comp >= 0 && this.componentAt(l, u, v) !== comp) continue;
      if (clearance > 0 && !this.clear(l, u, v, clearance)) continue;
      return { u, v };
    }
    return null;
  }

  /** ¿Hay un círculo libre de radio r alrededor del punto? (8 muestras). */
  clear(l: Level, u: number, v: number, r: number): boolean {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (!this.isWalkable(l, u + Math.cos(ang) * r, v + Math.sin(ang) * r)) return false;
    }
    return this.isWalkable(l, u, v);
  }
}

function dedupe(pts: number[]): number[] {
  const out: number[] = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    if (Math.hypot(pts[i] - out[out.length - 2], pts[i + 1] - out[out.length - 1]) > 0.02) out.push(pts[i], pts[i + 1]);
  }
  return out;
}

export function polyLength(pts: readonly number[]): number {
  let L = 0;
  for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return L;
}

function polyLengthPairs(pts: ReadonlyArray<readonly [number, number]>): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

export const NAV_SIZE = { nu: NU, nv: NV } as const;
