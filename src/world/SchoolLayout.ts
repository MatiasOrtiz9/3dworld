import type { Block, CityPlan } from './CityLayout';
import {
  APEX as PLAN_APEX,
  FURNITURE,
  KINDER_ROOMS,
  LEVEL_Y,
  MC_COS,
  PRIMARY_ROOMS,
  SC,
  SCHOOL as PLAN_SCHOOL,
  U as PLAN_U,
  V as PLAN_V,
  WALKABLE,
  amphiStrips,
  inPoly,
  inRect,
  levelOf,
  miguelCaneU as planMiguelCaneU,
  rearV as planRearV,
  type Facing,
  type Item,
  type Landing,
  type Level,
  type P,
  type Rect,
  type Room,
  type SchoolFrame,
  type Stair,
  type Volume,
  type Wall,
} from './SchoolBase';
import {
  PLAN_FENCES,
  PLAN_FRONT_PLANTERS,
  PLAN_GYM_MID,
  PLAN_GYM_PILASTERS,
  PLAN_ITEMS,
  PLAN_LANDINGS,
  PLAN_MEETING_POINT,
  PLAN_PORTAL,
  PLAN_ROOFS,
  PLAN_ROOMS,
  PLAN_SALON_COLUMNS,
  PLAN_STAIRS,
  PLAN_STATION_SPOTS,
  PLAN_STUDENT_ZONES,
  PLAN_UPPER,
  PLAN_VOIDS,
  PLAN_WALLS,
  planMakerWallAt,
} from './SchoolGround';
export { AMPHI_INNER, AMPHI_PLATFORM, AMPHI_WEST, amphiRear, amphiStrips } from './SchoolBase';
import { S, scaleItems, scaleLanding, scaleLines, scalePoly, scaleRect, scaleStair, scaleVolume, scaleWall } from './SchoolScale';
import { CREST as PLAN_CREST, PORTAL_WINDOWS as PLAN_PORTAL_WINDOWS, U1 as PLAN_U1, V1 as PLAN_V1 } from './SchoolUpper';

/**
 * Fachada de los datos de la escuela, en METROS REALES.
 *
 * Los módulos de datos (`SchoolGround` la planta baja, `SchoolUpper` los pisos
 * altos, `SchoolJardin` el jardín) están escritos en metros del plano CAD de
 * evacuación, que se registró con 67,4 m de frente; el edificio real mide
 * ~78 m sobre Laprida (OpenStreetMap). Acá se pasan a reales con `SC` (ver
 * `SchoolScale`) y se exportan con los MISMOS nombres de siempre: constructor,
 * colisión, gente, juego y sonido leen todo de acá y nunca del plano. Un
 * número leído del plano en un consumidor va con `planU`/`planV`/`fromPlan`.
 *
 * Coordenadas LOCALES en metros:
 *   u → hacia el este        — a lo largo de la calle Laprida
 *   v → hacia el sur  (+z)   — Laprida queda en v = 0 y el fondo en v ≈ −45
 * En este mundo el norte es −z y el sol sale por −x (ver Environment): el
 * este es −x. Por eso u crece hacia −x. El origen es la esquina sudoeste del
 * bloque de aulas (Laprida y el ochavo de Miguel Cané).
 *
 * Además del marco y la colisión, acá viven las funciones de ejecución
 * (`roomAt`, escaleras, grilla): trabajan sobre los datos reales.
 */

export * from './SchoolBase';

// ------------------------------------------------- líneas y medidas, reales
// (estos nombres tapan los del plano que reexporta `export *`)

/** Medidas generales reales: frente, fondo y franja escalados; alturas y espesores, tal cual. */
export const SCHOOL = {
  ...PLAN_SCHOOL,
  width: PLAN_SCHOOL.width * SC,
  depth: PLAN_SCHOOL.depth * SC,
  front: PLAN_SCHOOL.front * SC,
} as const;
export const U = scaleLines(PLAN_U);
export const V = scaleLines(PLAN_V);
export const U1 = scaleLines(PLAN_U1);
export const V1 = scaleLines(PLAN_V1);
export const APEX: P = S(PLAN_APEX);
/** Línea municipal sobre Miguel Cané (real: misma pendiente, escalada desde la esquina). */
export function miguelCaneU(v: number): number {
  return SC * planMiguelCaneU(v / SC);
}
/** Distancia perpendicular al OESTE de la línea municipal de Miguel Cané (negativa dentro). */
export function miguelCaneOffset(u: number, v: number): number {
  return (miguelCaneU(v) - u) * MC_COS;
}
/** Medianera del fondo (real). */
export function rearV(u: number): number {
  return SC * planRearV(u / SC);
}
export const mc = (v: number): P => [miguelCaneU(v), v];
export const rear = (u: number): P => [u, rearV(u)];
/** Coronamiento de la fachada: alturas tal cual, el paso de los escalones escalado. */
export const CREST = { ...PLAN_CREST, step: PLAN_CREST.step * SC } as const;
export const PORTAL_WINDOWS: ReadonlyArray<readonly [number, number]> = PLAN_PORTAL_WINDOWS.map(([a, b]) => [a * SC, b * SC] as const);

/**
 * Medianera del mural del Aula Maker: punto a `s` metros DEL PLANO desde el
 * vértice norte (así las distancias de las columnas y los carteles siguen
 * siendo las del plano), corrido `off` metros REALES hacia adentro del aula.
 */
export function makerWallAt(s: number, off: number): P {
  const [u0, v0] = planMakerWallAt(s, 0);
  const [u1, v1] = planMakerWallAt(s, 1);
  // La normal no cambia con una escala uniforme.
  return [u0 * SC + (u1 - u0) * off, v0 * SC + (v1 - v0) * off];
}

// ------------------------------------------------------------ datos, reales

export const WALLS: readonly Wall[] = PLAN_WALLS.map(scaleWall);
export const ROOMS: readonly Room[] = PLAN_ROOMS.map((r) => ({ ...r, poly: scalePoly(r.poly) }));
export const UPPER: readonly Volume[] = PLAN_UPPER.map(scaleVolume);
export const ROOFS: ReadonlyArray<{ poly: readonly P[]; y: number }> = PLAN_ROOFS.map((r) => ({ ...r, poly: scalePoly(r.poly) }));
export const STAIRS: readonly Stair[] = PLAN_STAIRS.map(scaleStair);
export const LANDINGS: readonly Landing[] = PLAN_LANDINGS.map(scaleLanding);
export const VOIDS: ReadonlyArray<Rect & { level: Level }> = PLAN_VOIDS.map(scaleRect);
export const ITEMS: readonly Item[] = scaleItems(PLAN_ITEMS, PLAN_WALLS, WALLS);

/** Columnas rojas del aula de danzas (a lo largo de v, sobre los dos laterales). */
export const SALON_COLUMNS: readonly number[] = PLAN_SALON_COLUMNS.map((v) => v * SC);
/** Eje este-oeste de la cancha del polideportivo. */
export const GYM_MID = PLAN_GYM_MID * SC;
/** Pilastras de los laterales del polideportivo (coinciden con las cabriadas). */
export const GYM_PILASTERS: readonly number[] = PLAN_GYM_PILASTERS.map((u) => u * SC);

/** Portal del acceso: el volumen es arquitectura y se agranda con el hall. */
export const PORTAL = {
  u0: PLAN_PORTAL.u0 * SC,
  u1: PLAN_PORTAL.u1 * SC,
  g0: PLAN_PORTAL.g0 * SC,
  g1: PLAN_PORTAL.g1 * SC,
  gate0: PLAN_PORTAL.gate0 * SC,
  gate1: PLAN_PORTAL.gate1 * SC,
  front: PLAN_PORTAL.front * SC,
} as const;
export const MEETING_POINT: P = S(PLAN_MEETING_POINT);
export const STATION_SPOTS = Object.fromEntries(
  Object.entries(PLAN_STATION_SPOTS).map(([k, s]) => [k, { ...s, u: s.u * SC, v: s.v * SC }]),
) as { readonly [K in keyof typeof PLAN_STATION_SPOTS]: { readonly u: number; readonly v: number; readonly yaw: number } };
export const STUDENT_ZONES = Object.fromEntries(Object.entries(PLAN_STUDENT_ZONES).map(([k, r]) => [k, scaleRect({ ...r })])) as {
  readonly [K in keyof typeof PLAN_STUDENT_ZONES]: Rect;
};
/** Canteros de la franja de frente, a ambos lados del acceso. */
export const FRONT_PLANTERS: readonly Rect[] = PLAN_FRONT_PLANTERS.map((r) => scaleRect({ ...r }));
/** Reja sobre la línea municipal (exacta sobre la diagonal real). */
export const FENCES: readonly (readonly [P, P])[] = PLAN_FENCES.map(([a, b]) => [S(a), S(b)] as const);

/** Cota de la azotea de un volumen. */
export function volumeTop(vol: Volume): number {
  return (vol.floors + 1) * SCHOOL.storey;
}
/** Huecos de losa de un nivel. */
export function voidsAt(level: Level): Rect[] {
  return VOIDS.filter((h) => h.level === level);
}

function inVoid(level: Level, u: number, v: number): boolean {
  for (const h of VOIDS) if (h.level === level && inRect(h, u, v)) return true;
  return false;
}

/**
 * Planta baja del portal, tal como la dibuja el constructor: los dos pilares
 * de granito (de la fachada al frente), las tres columnas azul marino (a los
 * costados del portón, en su medio frente al centro de la entrada y junto al
 * pilar del este) y la reja de toda la altura a los costados del portón.
 * Son macizos para el jugador y la gente: sin esto se cruzaba la reja
 * dibujada y la columna del medio, justo sobre el eje de la entrada.
 */
export const PORTAL_PILLARS: readonly Rect[] = [PORTAL.g0 + 0.4, PORTAL.g1 - 0.4].map((u) => ({
  u0: u - 0.4,
  v0: 0,
  u1: u + 0.4,
  v1: PORTAL.front,
}));
export const PORTAL_COLUMNS: readonly Rect[] = [PORTAL.gate0 - 0.15, (PORTAL.gate0 + PORTAL.gate1) / 2, PORTAL.g1 - 1.2].map((u) => ({
  u0: u - 0.15,
  v0: PORTAL.front - 0.35,
  u1: u + 0.15,
  v1: PORTAL.front - 0.05,
}));
/** Línea de la reja del portal (sobre el frente de las columnas). */
export const PORTAL_RAIL_V = PORTAL.front - 0.05;
export const PORTAL_RAILS: readonly (readonly [P, P])[] = [
  [
    [PORTAL.g0 + 0.85, PORTAL_RAIL_V],
    [PORTAL.gate0, PORTAL_RAIL_V],
  ],
  [
    [PORTAL.gate1, PORTAL_RAIL_V],
    [PORTAL.g1 - 0.8, PORTAL_RAIL_V],
  ],
];

/** Bandera en el mástil inclinado del portal (como en la fachada real). */
export const FLAG = { u: PORTAL.u0 + 0.8, v: 1.9 * SC, y: 5.25 } as const;


// =================================================================== marco

export function schoolFrame(block: Block, plan: CityPlan): SchoolFrame {
  const site = plan.schoolSite ?? {
    x0: block.cx - block.width / 2,
    x1: block.cx + block.width / 2,
    z0: block.cz - block.depth / 2,
    z1: block.cz + block.depth / 2,
  };
  return {
    block,
    // El muro este del gimnasio (u máximo, −x) queda a un metro del borde de
    // la manzana y la fachada sobre Laprida retirada lo que mide la franja de
    // canteros.
    ox: site.x0 + SCHOOL.eastGap + SCHOOL.width,
    oz: site.z1 - SCHOOL.front,
    site,
    rot: 0,
    cos: 1,
    sin: 0,
  };
}

/** Local (u, v) → mundo (x, z). El este (+u) es −x. */
export function toWorld(f: SchoolFrame, u: number, v: number): { x: number; z: number } {
  return { x: f.ox - u, z: f.oz + v };
}

/** Mundo (x, z) → local (u, v). */
export function toLocal(f: SchoolFrame, x: number, z: number): { u: number; v: number } {
  return { u: f.ox - x, v: z - f.oz };
}

/** ¿El punto está dentro del predio escolar (edificio, patios o franja de frente)? */
export function inLot(u: number, v: number): boolean {
  // El vértice de Miguel Cané (−39,17) queda un poco más al norte que el
  // fondo del jardín: sin contarlo, la cara exterior de sus muros caía fuera.
  if (v > SCHOOL.front || v < Math.min(V.top, APEX[1]) - 0.35 || u > U.e + 0.2) return false;
  if (u < miguelCaneU(v)) return false;
  if (u >= U.teaE - 0.1) return true;
  return v >= rearV(u) - 0.2;
}

/** Nombre para mostrar: el del plano y, si el recorrido lo llama distinto, también ese. */
export function roomLabel(r: Room): string {
  if (!r.caption) return r.name;
  if (!r.name) return r.caption;
  return `${r.name} · ${r.caption}`;
}

/** Nivel de un ambiente (sin indicar, planta baja). */
export function roomLevel(r: Room): Level {
  return r.level ?? 0;
}

/** Ambiente del plano que contiene el punto en ese nivel, si hay alguno. */
export function roomAt(u: number, v: number, level: Level = 0): Room | null {
  for (const r of ROOMS) if (roomLevel(r) === level && inPoly(r.poly, u, v)) return r;
  return null;
}

/**
 * Talle del mobiliario de un ítem (pupitre, mesa o silla): 'small' en las
 * salas del jardín, 'primary' en las aulas de 2º a 6º grado (salvo la silla
 * del docente, junto a su escritorio) y 'adult' en el resto. Constructor,
 * gente y QA lo leen de acá: si sólo cambia uno, la gente flota sobre la
 * silla o escribe en el aire.
 */
export function furnitureSize(it: Item): 'small' | 'primary' | 'adult' {
  const level = it.level ?? 0;
  const id = roomAt(it.u, it.v, level)?.id ?? '';
  if (KINDER_ROOMS.has(id)) return 'small';
  if (!PRIMARY_ROOMS.has(id)) return 'adult';
  if (it.kind === 'chair' && ITEMS.some((t) => t.kind === 'teacherDesk' && (t.level ?? 0) === level && Math.hypot(t.u - it.u, t.v - it.v) < 1.0)) return 'adult';
  return 'primary';
}

/** Altura de la tapa de un pupitre o una mesa común según su talle. */
export function deskTopOf(it: Item): number {
  const size = furnitureSize(it);
  if (it.kind === 'desk') return size === 'primary' ? FURNITURE.primaryDeskTop : FURNITURE.deskTop;
  return size === 'small' ? FURNITURE.smallTable : size === 'primary' ? FURNITURE.primaryDeskTop : FURNITURE.tableTop;
}

/** Escala de una silla según su talle (asiento a `FURNITURE.seat` × escala). */
export function chairScaleOf(it: Item): number {
  const size = furnitureSize(it);
  return size === 'small' ? FURNITURE.smallScale : size === 'primary' ? FURNITURE.primarySeat / FURNITURE.seat : 1;
}

/**
 * Ángulos (en planta) de las sillas que rodean una mesa redonda, hexagonal o
 * de patio: cuatro en diagonal, o las que diga `chairs` en una mesa de patio
 * (las del tramo largo de 2026 tienen dos, contra el muro). Lo usan el
 * constructor (dónde se dibujan) y la gente (dónde se sienta).
 */
export function roundChairAngles(it: Item): number[] {
  const n = it.kind === 'cafeTable' ? Math.max(0, Math.min(4, it.chairs ?? 4)) : 4;
  return Array.from({ length: n }, (_, k) => (k / n) * Math.PI * 2 + Math.PI / 4);
}

/** ¿Hay piso transitable de ese nivel en el punto? La planta baja cubre todo el predio. */
export function hasFloor(level: Level, u: number, v: number): boolean {
  if (level === 0) return true;
  if (inVoid(level, u, v)) return false;
  for (const r of ROOMS) if (roomLevel(r) === level && inPoly(r.poly, u, v)) return true;
  return false;
}

// ================================================================ escaleras

/** Cuánto se puede subir de un paso (un escalón y algo más). */
const STEP_UP = 0.45;
/** Cuánto se puede bajar de un paso sin "caerse" de la escalera. */
const STEP_DOWN = 1.2;
/** Luz libre bajo un tramo alto para poder pasar por debajo. */
const HEADROOM = 2.1;

/**
 * Escalones de un tramo: los que dejan la contrahuella entre 14 y 19 cm con
 * el paso más cómodo (regla de Blondel: 2 contrahuellas + 1 huella ≈ 63 cm).
 * Con un número fijo (alto / 0,175) los tramos cortos daban huellas de 38 cm
 * y los empinados de 22. La usan el constructor (lo que se dibuja) y la
 * rampa de los pies (`stairY`).
 */
export function riserCount(s: Stair): number {
  const rise = s.y1 - s.y0;
  const run = s.dir === 'u+' || s.dir === 'u-' ? s.u1 - s.u0 : s.v1 - s.v0;
  let best = Math.max(4, Math.round(rise / 0.175));
  let err = Infinity;
  for (let n = Math.max(4, Math.ceil(rise / 0.19)); n <= Math.max(4, Math.floor(rise / 0.14)); n++) {
    const e = Math.abs((2 * rise + run) / n - 0.63);
    if (e < err) {
      err = e;
      best = n;
    }
  }
  return best;
}

/**
 * Altura de los pies sobre un tramo, en (u, v). Es una rampa que pasa por la
 * mitad de cada huella: así los pies no se hunden en los escalones ni flotan
 * sobre ellos más de medio escalón.
 */
export function stairY(s: Stair, u: number, v: number): number {
  const t =
    s.dir === 'u+'
      ? (u - s.u0) / (s.u1 - s.u0)
      : s.dir === 'u-'
        ? (s.u1 - u) / (s.u1 - s.u0)
        : s.dir === 'v+'
          ? (v - s.v0) / (s.v1 - s.v0)
          : (s.v1 - v) / (s.v1 - s.v0);
  const n = riserCount(s);
  const k = Math.max(0, Math.min(1, t + 0.5 / n));
  return SCHOOL.floorY + s.y0 + k * (s.y1 - s.y0);
}

/**
 * Tramos que arrancan en planta baja: debajo son macizos (los escalones se
 * levantan desde el suelo). Los de los pisos altos son losas con luz abajo.
 */
function stairIsSolidBelow(s: Stair): boolean {
  return s.y0 < 0.5 && !s.hollow;
}

interface StairHit {
  y: number;
  /**
   * Altura con la que se decide si el escalón se alcanza. Igual a `y` salvo
   * cerca del pie de un tramo: ver `FOOT_REACH`.
   */
  reach: number;
  /** Macizo desde el suelo hasta `y`. */
  solidBelow: boolean;
}

/**
 * Franja del pie de un tramo (a lo largo del eje) donde la sonda del jugador,
 * que mira un radio de cuerpo (0,45 m) más un sub-paso por delante, cae
 * mientras sus pies siguen en el piso. Ahí la rampa ya está a ~0,58 m en los
 * tramos empinados: más que un paso, y el jugador se quedaba a 1 cm del
 * primer escalón para siempre. En la franja se mide la altura un radio más
 * atrás (hacia el pie), que es la que pisará al avanzar.
 */
const FOOT_REACH = 0.7;
const BODY_RADIUS = 0.45;

function footReach(s: Stair, u: number, v: number, y: number): number {
  const d =
    s.dir === 'u+' ? u - s.u0 : s.dir === 'u-' ? s.u1 - u : s.dir === 'v+' ? v - s.v0 : s.v1 - v;
  if (d > FOOT_REACH) return y;
  const back = Math.min(d, BODY_RADIUS);
  const bu = s.dir === 'u+' ? u - back : s.dir === 'u-' ? u + back : u;
  const bv = s.dir === 'v+' ? v - back : s.dir === 'v-' ? v + back : v;
  return stairY(s, bu, bv);
}

/** Tramos y descansos que contienen el punto, con la altura de su piso ahí. */
function stairHitsAt(u: number, v: number): StairHit[] {
  const out: StairHit[] = [];
  for (const s of STAIRS) {
    if (u >= s.u0 && u <= s.u1 && v >= s.v0 && v <= s.v1) {
      const y = stairY(s, u, v);
      out.push({ y, reach: footReach(s, u, v, y), solidBelow: stairIsSolidBelow(s) });
    }
  }
  for (const l of LANDINGS) {
    if (u >= l.u0 && u <= l.u1 && v >= l.v0 && v <= l.v1) {
      out.push({ y: SCHOOL.floorY + l.y, reach: SCHOOL.floorY + l.y, solidBelow: l.y < 3 && !l.hollow });
    }
  }
  return out;
}

/**
 * Altura del piso bajo los pies de quien está en (u, v) con los pies a
 * `feetY`: escalones y descansos alcanzables primero, después el piso del
 * nivel en el que está (o el más alto por debajo, si en ese punto no hay piso
 * de su nivel).
 */
export function schoolFloorLocal(u: number, v: number, feetY: number = SCHOOL.floorY): number {
  let best = -Infinity;
  for (const h of stairHitsAt(u, v)) {
    if (h.y <= feetY + STEP_UP && h.y >= feetY - STEP_DOWN) best = Math.max(best, h.y);
  }
  if (best > -Infinity) return best;
  for (let k = levelOf(feetY + STEP_UP); k >= 1; k--) {
    if (hasFloor(k as Level, u, v)) return LEVEL_Y[k];
  }
  return SCHOOL.floorY;
}

// ================================================================ colisión

/** Resolución de la grilla de ocupación, en metros. */
const CELL = 0.1;
// Derivada del predio real: de la diagonal de Miguel Cané en la franja de
// frente y del vértice norte, con margen (en el plano era −9 / −42).
const GU0 = Math.floor(miguelCaneU(SCHOOL.front) - 4);
const GV0 = Math.floor(Math.min(V.top, APEX[1]) - 3);
const GW = Math.ceil((U.e + 3 - GU0) / CELL);
const GH = Math.ceil((SCHOOL.front + 1 - GV0) / CELL);
/** Margen por defecto: medio cuerpo de peatón, para que nadie roce los muros. */
const DEFAULT_MARGIN = 0.2;
/** Una grilla por nivel, armada la primera vez que se consulta. */
const grids: Array<Uint8Array | null> = [null, null, null];

/** Tramos sólidos de un muro (sin las aberturas por las que se camina). */
export function solidPieces(w: Wall): Array<[number, number]> {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const out: Array<[number, number]> = [];
  let t = 0;
  for (const o of w.openings) {
    if (!WALKABLE.has(o.type)) continue;
    if (o.t0 > t) out.push([t, o.t0]);
    t = Math.max(t, o.t1);
  }
  if (t < len) out.push([t, len]);
  return out;
}

function wallThickness(w: Wall): number {
  return w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT;
}

/** Vano transitable con antepecho alto, en coordenadas del eje de su muro. */
interface HighSill {
  level: Level;
  a: P;
  du: number;
  dv: number;
  t0: number;
  t1: number;
  /** Medio espesor del muro más el margen del cuerpo (como en la grilla). */
  half: number;
  /** Cota del antepecho sobre el piso del nivel: más abajo, el vano es muro. */
  sill: number;
}

/**
 * Pasos que arrancan a la altura de un descanso: los de la torre del hall a
 * la pasarela y a la escalera blanca (antepecho 2,45 m). La grilla de un
 * nivel es una sola para cualquier altura de pies y los deja abiertos (desde
 * el descanso se pasa), así que para quien está abajo se vuelven muro acá.
 * Sin esto, desde el jardincito se entraba al cuartito bajo el descanso
 * atravesando la parte llena del muro de la torre (el jugador y la gente,
 * que arma su grilla con esta misma función).
 */
const HIGH_SILLS: readonly HighSill[] = WALLS.flatMap((w) => {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const du = (w.b[0] - w.a[0]) / len;
  const dv = (w.b[1] - w.a[1]) / len;
  return w.openings
    .filter((o) => WALKABLE.has(o.type) && (o.hb ?? 0) > STEP_UP)
    .map((o): HighSill => ({
      level: w.level,
      a: w.a,
      du,
      dv,
      t0: o.t0,
      t1: o.t1,
      half: wallThickness(w) / 2 + DEFAULT_MARGIN,
      sill: LEVEL_Y[w.level] + (o.hb ?? 0),
    }));
});

/** ¿El punto cae en un paso de antepecho alto que quien tiene los pies a `feetY` no alcanza? */
function belowHighSill(level: Level, u: number, v: number, feetY: number): boolean {
  for (const s of HIGH_SILLS) {
    if (s.level !== level || feetY + STEP_UP >= s.sill) continue;
    const ru = u - s.a[0];
    const rv = v - s.a[1];
    const t = ru * s.du + rv * s.dv;
    if (t >= s.t0 && t <= s.t1 && Math.abs(rv * s.du - ru * s.dv) <= s.half) return true;
  }
  return false;
}

/**
 * Distancia desde un punto (la cara trasera de algo que mira hacia `face`)
 * hasta la cara del muro que tiene detrás, en su nivel. `Infinity` si no hay
 * muro a menos de 1 m. Negativa si el punto ya está metido en el muro. La
 * usan el constructor (un espejo lejos del muro es de pie y lleva patas) y
 * el QA del equipamiento (lo colgado no puede flotar delante de la pared).
 */
export function wallGapBehind(level: Level, u: number, v: number, face: Facing): number {
  const fu = face === 'e' ? 1 : face === 'w' ? -1 : 0;
  const fv = face === 's' ? 1 : face === 'n' ? -1 : 0;
  let best = Infinity;
  for (const w of WALLS) {
    if (w.level !== level) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    const ru = u - w.a[0];
    const rv = v - w.a[1];
    const t = ru * du + rv * dv;
    if (t < 0 || t > len) continue;
    const n = -ru * dv + rv * du;
    // El muro tiene que quedar detrás: el frente mira hacia el lado del punto.
    const facing = fu * -dv + fv * du;
    if (Math.abs(facing) < 0.5 || facing * n <= 0) continue;
    const gap = Math.abs(n) - wallThickness(w) / 2;
    if (gap > -0.1 && gap < 1 && gap < best) best = gap;
  }
  return best;
}

/**
 * Obstáculos rectangulares alineados de un nivel: núcleo gris y canteros de
 * frente en planta baja, y el equipamiento que bloquea en cada nivel. Las
 * escaleras no están acá: se resuelven por altura (ver `schoolSolidLocal`).
 */
function obstacleRects(level: Level): Array<Rect & { m?: number }> {
  const out: Array<Rect & { m?: number }> = [];
  if (level === 0) {
    // Canteros elevados de la franja de frente (entre la fachada y la reja),
    // pilares y columnas del portal.
    for (const r of FRONT_PLANTERS) out.push(r);
    for (const r of PORTAL_PILLARS) out.push(r);
    for (const r of PORTAL_COLUMNS) out.push(r);
  }
  for (const it of ITEMS) {
    if (!it.solid || (it.level ?? 0) !== level) continue;
    if (it.kind === 'amphi') {
      // Gradas en medio anillo: franjas que siguen el arco (una sola caja
      // dejaba una pared invisible en la diagonal); el piso del medio, libre.
      out.push(...amphiStrips(it));
      continue;
    }
    const halfW = it.kind === 'tree' ? 0.35 : it.w / 2;
    const halfD = it.kind === 'tree' ? 0.35 : it.d / 2;
    out.push({ u0: it.u - halfW, v0: it.v - halfD, u1: it.u + halfW, v1: it.v + halfD, m: itemMargin(it.kind) });
  }
  return out;
}

/**
 * Margen de colisión de un mueble. Una baranda o una barra de 5 cm con el
 * margen de medio cuerpo se volvía una franja de 45 cm: la del hueco de la
 * escalera del bloque dejaba sin lugar el hall de danzas detrás de su puerta.
 * Las columnas, que el jugador roza al pasar, con poco margen no tapan media
 * puerta (la del pasaje al hall).
 */
function itemMargin(kind: Item['kind']): number | undefined {
  if (kind === 'gate' || kind === 'barre') return 0.05;
  if (kind === 'paddedColumn' || kind === 'roundColumn') return 0.1;
  return undefined;
}


function buildGrid(level: Level): Uint8Array {
  // En los pisos altos todo es vacío salvo donde hay piso: se arranca lleno y
  // se abren los ambientes de ese nivel.
  const g = new Uint8Array(GW * GH).fill(level === 0 ? 0 : 1);
  const m = DEFAULT_MARGIN;
  const each = (u0: number, v0: number, u1: number, v1: number, fn: (i: number, u: number, v: number) => void) => {
    const i0 = Math.max(0, Math.floor((u0 - GU0) / CELL));
    const i1 = Math.min(GW - 1, Math.ceil((u1 - GU0) / CELL));
    const j0 = Math.max(0, Math.floor((v0 - GV0) / CELL));
    const j1 = Math.min(GH - 1, Math.ceil((v1 - GV0) / CELL));
    for (let j = j0; j <= j1; j++) {
      const v = GV0 + (j + 0.5) * CELL;
      for (let i = i0; i <= i1; i++) fn(j * GW + i, GU0 + (i + 0.5) * CELL, v);
    }
  };
  const mark = (u0: number, v0: number, u1: number, v1: number, test: (u: number, v: number) => boolean) =>
    each(u0, v0, u1, v1, (k, u, v) => {
      if (test(u, v)) g[k] = 1;
    });
  if (level > 0) {
    for (const r of ROOMS) {
      if (roomLevel(r) !== level) continue;
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
      // Una celda se abre si el ambiente toca cualquier parte de ella (centro
      // o a medio lado): con la escuela escalada los bordes ya no caen en
      // los de la grilla, y la celda a medias entre el último escalón y el
      // piso de arriba quedaba maciza (el que bajaba se trababa a 3 cm).
      const e = CELL / 2 - 0.001;
      each(u0 - CELL, v0 - CELL, u1 + CELL, v1 + CELL, (k, u, v) => {
        if (inPoly(r.poly, u, v) || inPoly(r.poly, u - e, v) || inPoly(r.poly, u + e, v) || inPoly(r.poly, u, v - e) || inPoly(r.poly, u, v + e)) g[k] = 0;
      });
    }
    // Huecos de escalera, sin margen: el último escalón desemboca justo en
    // su borde y un margen dejaría al que sube trabado arriba del tramo. Sólo
    // las celdas que caen enteras en el hueco: la de borde la resuelve el piso
    // exacto (`hasFloor` y los escalones), igual que con el plano alineado.
    for (const h of voidsAt(level)) mark(h.u0, h.v0, h.u1, h.v1, (u, v) => inRect(h, u, v, -(CELL / 2 - 0.001)));
  }
  const segment = (a: P, b: P, half: number) => {
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const len2 = du * du + dv * dv;
    mark(
      Math.min(a[0], b[0]) - half,
      Math.min(a[1], b[1]) - half,
      Math.max(a[0], b[0]) + half,
      Math.max(a[1], b[1]) + half,
      (u, v) => {
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((u - a[0]) * du + (v - a[1]) * dv) / len2)) : 0;
        return Math.hypot(u - (a[0] + du * t), v - (a[1] + dv * t)) <= half;
      },
    );
  };
  // Los tramos de muro llevan punta redonda sólo donde el muro termina de
  // verdad (esquinas, cabezas sueltas). Contra un vano transitable el borde es
  // recto: con la punta redonda (medio muro + margen, ~0,3 m) cada jamba se
  // comía un tercio de la puerta y en una de 0,9 m el centro del cuerpo tenía
  // 0,28 m libres — el jugador apenas corrido del eje se trababa en el marco.
  for (const w of WALLS) {
    if (w.level !== level) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    const half = wallThickness(w) / 2 + m;
    for (const [t0, t1] of solidPieces(w)) {
      const pa: P = [w.a[0] + du * t0, w.a[1] + dv * t0];
      const pb: P = [w.a[0] + du * t1, w.a[1] + dv * t1];
      mark(Math.min(pa[0], pb[0]) - half, Math.min(pa[1], pb[1]) - half, Math.max(pa[0], pb[0]) + half, Math.max(pa[1], pb[1]) + half, (u, v) => {
        const ru = u - w.a[0];
        const rv = v - w.a[1];
        const t = ru * du + rv * dv;
        return t >= t0 && t <= t1 && Math.abs(rv * du - ru * dv) <= half;
      });
      if (t0 <= 0) segment(pa, pa, half);
      if (t1 >= len) segment(pb, pb, half);
    }
  }
  if (level === 0) for (const [a, b] of [...FENCES, ...PORTAL_RAILS]) segment(a, b, 0.05 + m);
  for (const r of obstacleRects(level)) {
    const rm = r.m ?? m;
    // Por el centro de la celda: marcar todo el recorrido de `each` (que
    // redondea hacia afuera) agrandaba cada mueble hasta 10 cm más.
    const u0 = r.u0 - rm;
    const v0 = r.v0 - rm;
    const u1 = r.u1 + rm;
    const v1 = r.v1 + rm;
    mark(u0, v0, u1, v1, (u, v) => u >= u0 - CELL / 2 && u <= u1 + CELL / 2 && v >= v0 - CELL / 2 && v <= v1 + CELL / 2);
  }
  return g;
}

function gridSolid(level: Level, u: number, v: number): boolean {
  const i = Math.floor((u - GU0) / CELL);
  const j = Math.floor((v - GV0) / CELL);
  // Fuera de la grilla: calle y veredas en planta baja, aire en los pisos altos.
  if (i < 0 || j < 0 || i >= GW || j >= GH) return level > 0;
  const g = grids[level] ?? (grids[level] = buildGrid(level));
  return g[j * GW + i] === 1;
}

// ======================================================= bloqueos dinámicos

/**
 * Rectángulos macizos que el juego pone y saca en tiempo de ejecución: las
 * puertas cerradas con llave de las zonas que se desbloquean con la historia.
 * La grilla de ocupación es estática; esto se consulta aparte y es barato
 * (pocos rectángulos).
 */
const dynamicSolids = new Map<string, Rect & { level: Level; playerOnly: boolean }>();

/**
 * Cierra (o con `null`, abre) un paso: un rectángulo macizo en un nivel.
 * `playerOnly`: sólo para el jugador — las puertas de las aulas, que la gente
 * abre al llegar (la multitud las atraviesa y el juego anima la hoja).
 */
export function setDynamicSolid(id: string, rect: (Rect & { level: Level }) | null, opts?: { playerOnly?: boolean }): void {
  if (rect) dynamicSolids.set(id, { ...rect, playerOnly: opts?.playerOnly ?? false });
  else dynamicSolids.delete(id);
}

function dynamicSolidAt(level: Level, u: number, v: number, pedestrian: boolean): boolean {
  for (const r of dynamicSolids.values()) {
    if (r.playerOnly && pedestrian) continue;
    if (r.level === level && inRect(r, u, v)) return true;
  }
  return false;
}

/**
 * ¿Ese punto local está ocupado para quien tiene los pies a `feetY`?
 *
 * Muros, reja y equipamiento del nivel en el que está bloquean; las puertas y
 * pasos no. Las escaleras se resuelven por altura: un escalón al alcance del
 * pie se pisa, uno a la altura del cuerpo es un obstáculo (el costado de un
 * tramo, o el hueco de la escalera visto desde arriba). Detrás de la
 * medianera empiezan los fondos de los vecinos. La multitud (`pedestrian`)
 * no usa escaleras: para ella son macizas.
 */
export function schoolSolidLocal(u: number, v: number, feetY: number = SCHOOL.floorY, pedestrian = false): boolean {
  // Fondos vecinos, detrás de la medianera (fuera del predio del jardín).
  if (u < U.teaE && v < rearV(u) - 0.15 && u > miguelCaneU(v) - 0.2 && v > V.top - 1.2) return true;
  const level = levelOf(feetY);
  if (dynamicSolids.size > 0 && dynamicSolidAt(level, u, v, pedestrian)) return true;
  const hits = stairHitsAt(u, v);
  if (hits.length > 0) {
    let clear = true;
    for (const h of hits) {
      // La multitud no usa escaleras: para ella son macizas, salvo los tramos
      // que pasan muy por encima (el arranque de la pasarela sobre el patio).
      if (pedestrian) {
        if (h.solidBelow || h.y < feetY + HEADROOM) return true;
        continue;
      }
      if (h.reach <= feetY + STEP_UP && h.y >= feetY - STEP_DOWN) return false;
      if (h.y < feetY - STEP_DOWN) {
        // Un tramo más abajo: es el hueco de la escalera, salvo que haya losa encima.
        if (!(level > 0 && hasFloor(level, u, v))) clear = false;
        continue;
      }
      // Algo a la altura del cuerpo, o un tramo macizo por encima de los pies.
      if (h.y < feetY + HEADROOM || h.solidBelow) clear = false;
    }
    if (!clear) return true;
  }
  if (belowHighSill(level, u, v, feetY)) return true;
  return gridSolid(level, u, v);
}
