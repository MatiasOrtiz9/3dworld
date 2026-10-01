import type { Block } from './CityLayout';

/**
 * Primitivas del plano de la escuela: el marco de coordenadas, las líneas
 * del plano, los tipos de muros, ambientes, escaleras y equipamiento, y los
 * atajos para escribirlos. Las usan `SchoolLayout` (planta baja, colisión) y
 * los módulos de las plantas altas; están acá y no en `SchoolLayout` para que
 * esos módulos no se importen en círculo.
 *
 * Coordenadas LOCALES en metros: u → este (a lo largo de Laprida), v → sur.
 * Laprida queda en v = 0. Ver `SchoolLayout` para el detalle.
 */

export type P = readonly [number, number];

export interface Rect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface SchoolFrame {
  /** Manzana principal del predio (la que lleva `landmark: 'school'`). */
  block: Block;
  /** Mundo del origen local (u = 0, v = 0). */
  ox: number;
  oz: number;
  /** Predio completo en mundo: dos manzanas unidas, sin la calle intermedia. */
  site: { x0: number; x1: number; z0: number; z1: number };
  /** La escuela no gira: conserva la orientación real del plano (Laprida al sur). */
  rot: 0;
  cos: 1;
  sin: 0;
}

/** Medidas generales, en metros. */
export const SCHOOL = {
  /** Frente sobre Laprida, del ochavo al muro este del gimnasio. */
  width: 67.4,
  /** Fondo máximo (jardín de infantes). */
  depth: 39,
  /** Franja entre la fachada y la línea municipal: canteros, reja, escalones. */
  front: 2,
  /** Separación entre el muro este y el borde de la manzana. */
  eastGap: 1,
  /** Cota del piso terminado interior. */
  floorY: 0.12,
  /** Altura de planta baja (piso a losa). */
  storey: 3.3,
  /** Coronamiento de los volúmenes de dos plantas. */
  upperTop: 6.6,
  /** Muros del gimnasio. */
  gymWall: 7.2,
  gymRise: 3,
  wallT: 0.2,
  extT: 0.3,
} as const;

/** Niveles del edificio: planta baja, primer piso y segundo piso. */
export type Level = 0 | 1 | 2;

/**
 * Cota del piso terminado de cada nivel. Entre niveles hay una planta
 * completa (3,3 m de piso a piso), como en la fachada sobre Laprida.
 */
export const LEVEL_Y: readonly [number, number, number] = [
  SCHOOL.floorY,
  SCHOOL.floorY + SCHOOL.storey,
  SCHOOL.floorY + 2 * SCHOOL.storey,
];

/** Nivel en el que está quien tiene los pies a la altura `feetY`. */
export function levelOf(feetY: number): Level {
  if (feetY >= LEVEL_Y[2] - 0.6) return 2;
  if (feetY >= LEVEL_Y[1] - 0.6) return 1;
  return 0;
}

/** Líneas del plano (u constantes). */
export const U = {
  w: 0,
  c2: 6.7,
  c3: 13.0,
  c4: 19.3,
  c5: 25.65,
  dirDiv: 8.0,
  wingE: 13.1,
  patioW: 16.45,
  epW: 14.05,
  epE: 20.15,
  stairE: 26.95,
  bufW: 28.4,
  closetW: 29.3,
  tecE: 31.4,
  /** Pasillo de bloque de Administración al Aula Maker: su lado este (E.P). */
  epCorrE: 16.05,
  east1: 32.9,
  /** Oficina de recepción, a la izquierda de la entrada. */
  recE: 35.3,
  kioskE: 35.6,
  salonW: 41.95,
  gymW: 50.3,
  artE: 53.9,
  teaE: 57.65,
  vdW: 62.7,
  e: 67.4,
} as const;

/** Líneas del plano (v constantes). */
export const V = {
  facade: 0,
  hallDoors: -1.55,
  /** Oficina de recepción: su lado norte. */
  recN: -3.6,
  classTop: -7.1,
  corrS: -9.35,
  passS: -9.1,
  passN: -11.15,
  dirTop: -11.5,
  hallTop: -13.3,
  profB: -13.8,
  kiosk: -14.95,
  grayB: -17.65,
  /** Baño junto a Administración: su lado norte. */
  wcB: -19.6,
  admB: -19.2,
  gymTop: -20.8,
  artB: -22.65,
  corrN: -23.5,
  vdB: -23.55,
  nBlockS: -25.1,
  nBlockN: -29.85,
  top: -39,
} as const;

/**
 * Línea municipal sobre Miguel Cané: la calle corre en diagonal (≈32° del
 * norte) y el ala oeste del edificio se apoya sobre ella.
 */
export function miguelCaneU(v: number): number {
  return 0.97 - 0.6386 * (v + 9.7);
}

/**
 * Distancia perpendicular al OESTE de la línea municipal de Miguel Cané
 * (negativa dentro del predio). La calzada corre a media calle de ella.
 */
export function miguelCaneOffset(u: number, v: number): number {
  return (miguelCaneU(v) - u) * MC_COS;
}

/** Componente en v de la dirección de Miguel Cané: convierte Δu en distancia real. */
export const MC_COS = 1 / Math.hypot(0.6386, 1);

/** Medianera del fondo: la otra diagonal del predio. */
export function rearV(u: number): number {
  return -38.48 + 0.2496 * (u - 19.35);
}

/** Vértice norte del predio (encuentro de Miguel Cané con la medianera). */
export const APEX: P = [19.35, -38.48];

// ======================================================================= muros

export type OpeningType =
  | 'door' // puerta simple
  | 'double' // puerta doble
  | 'pass' // paso sin hoja, dintel alto
  | 'exit' // salida de emergencia a la calle
  | 'entrance' // acceso principal vidriado
  | 'window' // ventana común
  | 'high' // ventana alta (gimnasio)
  | 'band' // ventana apaisada sobre la altura de la cabeza (hacia el gimnasio)
  | 'counter'; // ventanilla de atención

export interface Opening {
  /** Metros desde `a` a lo largo del muro. */
  t0: number;
  t1: number;
  type: OpeningType;
  /**
   * Antepecho y dintel sobre la base del muro, si no son los del tipo. Dos
   * vanos pueden ocupar el mismo tramo del muro a distinta altura (ventanas
   * de dos pisos sobre un muro alto).
   */
  hb?: number;
  ht?: number;
  /** Material de hojas y marcos (clave del constructor), si no es el del tipo. */
  color?: string;
}

export type WallKind = 'ext' | 'int' | 'medianera';

export interface Wall {
  a: P;
  b: P;
  kind: WallKind;
  /** Alto del muro desde su base. */
  h: number;
  openings: Opening[];
  /** Nivel en el que apoya: la base está en `level * SCHOOL.storey`. */
  level: Level;
  /**
   * Terminación de la cara que da a un ambiente, si no es la de su estilo
   * (clave de material del constructor por id de ambiente). Ej.: el testero
   * de bloque del polideportivo.
   */
  finish?: Readonly<Record<string, string>>;
}

/** Aberturas transitables: el resto del muro es sólido. */
export const WALKABLE: ReadonlySet<OpeningType> = new Set(['door', 'double', 'pass', 'exit', 'entrance']);

/**
 * Vano: desde, hasta (en el eje dominante del muro), tipo y, opcionales,
 * antepecho, dintel y material de hojas y marcos.
 */
export type Op = readonly [number, number, OpeningType, number?, number?, string?];

export function seg(a: P, b: P, kind: WallKind, ops: readonly Op[] = [], h: number = SCHOOL.storey, level: Level = 0): Wall {
  const du = b[0] - a[0];
  const dv = b[1] - a[1];
  const len = Math.hypot(du, dv);
  // Las aberturas se escriben en coordenadas absolutas del eje dominante del
  // muro (u si corre de este a oeste, v si corre de norte a sur): así se
  // copian directo del plano sin calcular distancias a mano.
  const alongU = Math.abs(du) >= Math.abs(dv);
  const from = alongU ? a[0] : a[1];
  const span = alongU ? du : dv;
  const openings = ops
    .map(([c0, c1, type, hb, ht, color]): Opening => {
      const t0 = ((c0 - from) / span) * len;
      const t1 = ((c1 - from) / span) * len;
      const o: Opening = { t0: Math.max(0, Math.min(t0, t1)), t1: Math.min(len, Math.max(t0, t1)), type };
      if (hb !== undefined) o.hb = hb;
      if (ht !== undefined) o.ht = ht;
      if (color !== undefined) o.color = color;
      return o;
    })
    .sort((x, y) => x.t0 - y.t0);
  return { a, b, kind, h, openings, level };
}

const H = SCHOOL.storey;
export const hw = (v: number, u0: number, u1: number, kind: WallKind = 'int', ops: readonly Op[] = [], h: number = H) =>
  seg([u0, v], [u1, v], kind, ops, h);
export const vw = (u: number, v0: number, v1: number, kind: WallKind = 'int', ops: readonly Op[] = [], h: number = H) =>
  seg([u, v0], [u, v1], kind, ops, h);
/** Dos ventanas por aula, a un cuarto de cada lado. */
export function roomWindows(a: number, b: number, w = 1.6): Op[] {
  const out: Op[] = [];
  for (const f of [0.27, 0.73]) {
    const c = a + (b - a) * f;
    out.push([c - w / 2, c + w / 2, 'window']);
  }
  return out;
}

export const mc = (v: number): P => [miguelCaneU(v), v];
export const rear = (u: number): P => [u, rearV(u)];
// ======================================================= ambientes y volúmenes

/**
 * Pisos: granito (`tile`), parquet (`wood`), cemento del gimnasio, vinílico
 * verde del Aula Maker, solado de patio, damero del comedor, cerámico claro de
 * los sectores nuevos y goma oscura de la galería.
 */
export type Floor =
  | 'tile'
  | 'wood'
  | 'gym'
  | 'green'
  | 'patio'
  | 'dark'
  | 'checker'
  | 'ceramic'
  | 'rubber'
  | 'terracotta'
  | 'hallStone';

export interface Room {
  id: string;
  /** Rótulo tal como aparece en el plano; vacío si el plano no lo nombra. */
  name: string;
  poly: readonly P[];
  floor: Floor;
  /** Cubierto o a cielo abierto. */
  roofed: boolean;
  /** Nivel del ambiente; sin indicar, planta baja. */
  level?: Level;
  /** Nombre con el que lo presenta el recorrido virtual de 2020, si difiere del plano. */
  caption?: string;
}

export const rect = (u0: number, v0: number, u1: number, v1: number): P[] => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1],
];

/** Volumen con plantas altas sobre la planta baja. */
export interface Volume {
  poly: readonly P[];
  /** Plantas por encima de la baja: 1 (dos plantas) o 2 (tres plantas). */
  floors: 1 | 2;
}

// ================================================================ escaleras

export interface Stair {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Hacia dónde sube. */
  dir: 'u+' | 'u-' | 'v+' | 'v-';
  /** Alturas de arranque y de llegada, sobre el piso de planta baja. */
  y0: number;
  y1: number;
}

/** Descanso: plataforma horizontal entre tramos, a `y` sobre el piso de planta baja. */
export interface Landing extends Rect {
  y: number;
}

// ================================================================== equipamiento

export type ItemKind =
  | 'desk'
  | 'chair'
  | 'table'
  | 'hexTable'
  | 'roundTable'
  | 'teacherDesk'
  | 'board'
  | 'shelf'
  | 'counter'
  | 'fridge'
  | 'planter'
  | 'bench'
  | 'tree'
  | 'column'
  | 'mirror'
  | 'barre'
  | 'stall'
  | 'stage'
  | 'curtain'
  | 'goal'
  | 'bleachers'
  | 'seats'
  | 'booth'
  | 'playhouse'
  | 'banner'
  | 'lockers'
  // Recorrido 2020: equipamiento de pared y de cada sector.
  | 'extinguisher' // matafuego rojo colgado
  | 'fan' // ventilador de pared
  | 'ac' // split de aire acondicionado
  | 'projector' // proyector colgado del cielorraso
  | 'speaker' // parlante negro
  | 'tv' // televisor de pared
  | 'blackboard' // pizarrón negro / verde
  | 'roundColumn' // columna redonda (con color)
  | 'paddedColumn' // columna forrada con protección acolchada (con color)
  | 'workbench' // mesa larga de madera con estructura de color
  | 'benchSeat' // banco largo sin respaldo
  | 'stool' // banqueta alta
  | 'pegboard' // tablero perforado con herramientas
  | 'cabinet' // mueble alto de madera clara con estantes
  | 'laserCutter' // cortadora láser azul y blanca
  | 'printer3d' // impresora 3D
  | 'buffetLine' // mostrador de acero de la cantina con mampara
  | 'displayCase' // vitrina curva de vidrio
  | 'fridgeGlass' // heladera de bebidas con puerta de vidrio
  | 'pendantRail' // riel negro con lámparas colgantes industriales
  | 'longTable' // mesa larga del comedor (tapa blanca, estructura de color)
  | 'greenWall' // jardín vertical
  | 'bamboo' // cañas decorativas en maceta
  | 'piano' // piano vertical
  | 'drawers' // cómoda blanca
  | 'coatBench' // banco rojo con tablero de percheros
  | 'gate' // reja de barrotes (con color)
  | 'plaques' // placas de bronce
  | 'trophyShelf' // estante alto con trofeos
  | 'waterCooler' // dispenser de agua
  | 'plasticChair' // silla plástica blanca
  | 'filing' // fichero metálico rojo
  | 'sinkCounter' // mesada con bachas y espejos
  | 'copier' // fotocopiadora
  | 'desk2' // escritorio de oficina con monitor
  | 'wallMat' // colchoneta de pared
  | 'padPilaster' // pilastra del gimnasio con protección de dos colores
  | 'flagpole' // mástil con bandera
  | 'stack' // pila de sillas apilables
  | 'drumKit' // batería
  | 'risers' // gradas escalonadas
  | 'slide' // tobogán / juego de plástico
  | 'swing' // hamacas
  | 'wallPanel' // panel de pared liso (con color): revestimientos, cartel sin texto
  | 'floorPatch' // pintura o vinílico sobre el piso (con color)
  | 'hoop' // aro de básquet de pared
  | 'ceilingFan' // ventilador de techo
  | 'palm'; // palmera (alto en `h`, apoyada a `y`)

/** Hacia dónde mira el frente del objeto (o la cara útil de algo contra un muro). */
export type Facing = 'n' | 's' | 'e' | 'w';

export interface Item {
  kind: ItemKind;
  u: number;
  v: number;
  /** Medidas en planta: `w` a lo largo de u, `d` a lo largo de v. */
  w: number;
  d: number;
  face: Facing;
  /** Bloquea el paso. */
  solid: boolean;
  /** Nivel en el que está; sin indicar, planta baja. */
  level?: Level;
  /** Color (clave de material del constructor) cuando el objeto lo admite. */
  color?: string;
  /** Altura de apoyo sobre el piso, para lo que va colgado de la pared. */
  y?: number;
  /** Alto, para lo que tiene tamaño variable (paneles, gradas, columnas). */
  h?: number;
}

export const item = (kind: ItemKind, u: number, v: number, w: number, d: number, face: Facing = 's', solid = true): Item => ({
  kind,
  u,
  v,
  w,
  d,
  face,
  solid,
});

export function inRect(r: Rect, u: number, v: number, margin = 0): boolean {
  return u > r.u0 - margin && u < r.u1 + margin && v > r.v0 - margin && v < r.v1 + margin;
}

export function inPoly(poly: readonly P[], u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, vi] = poly[i];
    const [uj, vj] = poly[j];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}


/** Pasa muros escritos con los atajos a un nivel alto. */
export function onLevel(level: Level, walls: readonly Wall[]): Wall[] {
  return walls.map((w) => ({ ...w, level }));
}

/** Pasa equipamiento a un nivel alto. */
export function itemsOn(level: Level, items: readonly Item[]): Item[] {
  return items.map((it) => ({ ...it, level }));
}

/** Pasa ambientes a un nivel alto. */
export function roomsOn(level: Level, rooms: readonly Room[]): Room[] {
  return rooms.map((r) => ({ ...r, level }));
}
