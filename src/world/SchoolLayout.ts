import type { Block, CityPlan } from './CityLayout';

/**
 * Planta baja de la escuela CIMDIP & Miguel Cané.
 *
 * Réplica del "Plano de evacuación — planta baja" de la sede (S&O Consultores).
 * Las coordenadas se midieron sobre la foto del plano, píxel a píxel, con la
 * leve inclinación de la toma corregida, y se pasaron a metros a razón de
 * 0,07 m por píxel: así un aula sobre Laprida mide ~6,5 × 7 m, el pasillo ~2,3 m
 * y el gimnasio ~17 × 21 m, que es el orden real de esos espacios.
 *
 * Datos puros, como `CityLayout`: no importa nada del motor. Lo consultan el
 * constructor 3D, el índice de colisión, la multitud y las estaciones. Nada de
 * esto se deriva en otro lado: si un muro se mueve, se mueve acá.
 *
 * Coordenadas LOCALES en metros:
 *   u → hacia el este        — a lo largo de la calle Laprida
 *   v → hacia el sur  (+z)   — Laprida queda en v = 0 y el fondo en v ≈ −39
 * En este mundo el norte es −z y el sol sale por −x (ver Environment): el
 * este es −x. Por eso u crece hacia −x. Con u = +x la escuela quedaba
 * espejada: mirando desde Laprida, el gimnasio aparecía a la izquierda.
 * El origen es la esquina sudoeste del bloque de aulas (Laprida y el ochavo de
 * Miguel Cané). El norte del plano es el norte de la ciudad (−z), igual que en
 * el croquis de localización.
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
  east1: 32.9,
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
  classTop: -7.1,
  corrS: -9.35,
  passS: -9.1,
  passN: -11.15,
  dirTop: -11.5,
  hallTop: -13.3,
  profB: -13.8,
  kiosk: -14.95,
  grayB: -17.65,
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
  | 'counter'; // ventanilla de atención

export interface Opening {
  /** Metros desde `a` a lo largo del muro. */
  t0: number;
  t1: number;
  type: OpeningType;
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
}

/** Aberturas transitables: el resto del muro es sólido. */
export const WALKABLE: ReadonlySet<OpeningType> = new Set(['door', 'double', 'pass', 'exit', 'entrance']);

type Op = readonly [number, number, OpeningType];

function seg(a: P, b: P, kind: WallKind, ops: readonly Op[] = [], h: number = SCHOOL.storey, level: Level = 0): Wall {
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
    .map(([c0, c1, type]) => {
      const t0 = ((c0 - from) / span) * len;
      const t1 = ((c1 - from) / span) * len;
      return { t0: Math.max(0, Math.min(t0, t1)), t1: Math.min(len, Math.max(t0, t1)), type };
    })
    .sort((x, y) => x.t0 - y.t0);
  return { a, b, kind, h, openings, level };
}

const H = SCHOOL.storey;
const hw = (v: number, u0: number, u1: number, kind: WallKind = 'int', ops: readonly Op[] = [], h: number = H) =>
  seg([u0, v], [u1, v], kind, ops, h);
const vw = (u: number, v0: number, v1: number, kind: WallKind = 'int', ops: readonly Op[] = [], h: number = H) =>
  seg([u, v0], [u, v1], kind, ops, h);
/** Muros de los pisos altos: mismos atajos, con el nivel explícito. */
/** Dos ventanas por aula, a un cuarto de cada lado. */
function roomWindows(a: number, b: number, w = 1.6): Op[] {
  const out: Op[] = [];
  for (const f of [0.27, 0.73]) {
    const c = a + (b - a) * f;
    out.push([c - w / 2, c + w / 2, 'window']);
  }
  return out;
}

const mc = (v: number): P => [miguelCaneU(v), v];
const rear = (u: number): P => [u, rearV(u)];

export const WALLS: readonly Wall[] = [
  // --- Fachada sobre Laprida -------------------------------------------------
  hw(V.facade, U.w, U.east1, 'ext', [
    ...roomWindows(U.w, U.c2),
    ...roomWindows(U.c2, U.c3),
    ...roomWindows(U.c3, U.c4),
    ...roomWindows(U.c4, U.c5),
    ...roomWindows(U.c5, U.east1),
  ]),
  hw(V.facade, U.east1, 33.35, 'ext'),
  hw(V.facade, 40.9, U.salonW, 'ext'),
  hw(V.facade, U.salonW, U.gymW, 'ext', roomWindows(U.salonW, U.gymW)),
  hw(
    V.facade,
    U.gymW,
    U.e,
    'ext',
    [
      [51.05, 54.8, 'exit'],
      [56.4, 59.6, 'high'],
      [60.6, 63.8, 'high'],
    ],
    SCHOOL.gymWall,
  ),

  // --- Miguel Cané: ochavo, ala oeste y Tecnología --------------------------
  vw(U.w, V.classTop, V.facade, 'ext', [[-4.3, -2.7, 'window']]),
  // Salida de emergencia del pasillo sur, al ochavo de Miguel Cané.
  seg([U.w, V.classTop], mc(V.corrS), 'ext', [[-7.25, -9.2, 'exit']]),
  seg(mc(V.corrS), mc(V.corrN), 'ext', [
    [-11.2, -9.8, 'window'],
    [-17.3, -15.6, 'window'],
    [-22.2, -20.6, 'window'],
  ]),
  // Salida del pasillo norte a Miguel Cané (puerta doble del plano).
  seg(mc(V.corrN), mc(V.nBlockS), 'ext', [[-23.62, -24.98, 'exit']]),
  seg(mc(V.nBlockS), APEX, 'ext', [
    [-33.4, -31.8, 'window'],
    [-36.6, -35.0, 'window'],
  ]),

  // --- Medianera del fondo ----------------------------------------------------
  seg(APEX, rear(U.tecE), 'ext'),
  seg(rear(U.tecE), rear(U.gymW), 'medianera', [], 3.6),
  seg(rear(U.gymW), rear(U.teaE), 'ext'),
  // Dentro del predio del jardín la medianera vieja es su muro sur, con puerta.
  seg(rear(U.teaE), rear(U.e), 'int', [[59.9, 61.6, 'door']]),

  // --- Tecnología y bloque norte ---------------------------------------------
  vw(U.tecE, rearV(U.tecE), V.nBlockN, 'int', [[-33.5, -31.9, 'window']]),
  hw(V.nBlockN, miguelCaneU(V.nBlockN), U.east1, 'int', [
    [17.6, 19.8, 'double'],
    [22.0, 23.0, 'pass'],
    [27.0, 29.1, 'double'],
  ]),
  vw(U.epW, V.nBlockN, V.nBlockS),
  vw(U.epE, V.nBlockN, V.nBlockS),
  vw(U.stairE, V.nBlockN, V.nBlockS),
  vw(U.east1, V.nBlockN, V.corrN),
  hw(V.nBlockS, miguelCaneU(V.nBlockS), U.east1, 'int', [
    [17.6, 19.8, 'double'],
    [27.0, 29.1, 'double'],
  ]),

  // --- Pasillo norte: cierre sur ----------------------------------------------
  hw(V.corrN, miguelCaneU(V.corrN), 11.5, 'int', [[10.0, 11.35, 'door']]),
  hw(V.corrN, U.patioW, U.east1, 'int', [[24.8, 26.9, 'pass']]),
  vw(U.closetW, V.nBlockS, V.corrN),

  // --- Ala oeste: ADM, PROF., DIR. PRIM ---------------------------------------
  hw(V.admB, miguelCaneU(V.admB), 11.5),
  vw(U.wingE, V.grayB, V.profB),
  hw(V.profB, miguelCaneU(V.profB), U.wingE, 'int', [[11.8, 13.0, 'door']]),
  hw(V.dirTop, miguelCaneU(V.dirTop), U.wingE, 'int', [
    [5.0, 6.0, 'door'],
    [10.6, 11.6, 'door'],
  ]),
  vw(U.dirDiv, V.dirTop, V.corrS),
  vw(U.wingE, V.dirTop, V.corrS),
  hw(V.corrS, miguelCaneU(V.corrS), U.wingE),

  // --- Patio oeste y buffet ---------------------------------------------------
  vw(U.patioW, V.corrN, V.corrS),
  hw(V.corrS, U.patioW, U.bufW, 'int', [[23.4, 25.5, 'pass']]),
  vw(U.bufW, V.corrN, V.corrS, 'int', [[-17.2, -15.6, 'window']]),
  hw(V.corrS, U.bufW, U.east1, 'int', [[28.6, 30.2, 'door']]),
  vw(U.east1, V.corrN, V.corrS, 'int', [
    [-21.6, -19.4, 'counter'],
    [-18.2, -16.6, 'counter'],
  ]),

  // --- Aulas sobre Laprida ------------------------------------------------------
  hw(V.classTop, U.w, U.east1, 'int', [
    [4.6, 6.2, 'double'],
    [10.95, 12.55, 'double'],
    [17.3, 18.9, 'double'],
    [23.4, 25.0, 'double'],
    [26.0, 27.6, 'double'],
  ]),
  vw(U.c2, V.classTop, V.facade),
  vw(U.c3, V.classTop, V.facade),
  vw(U.c4, V.classTop, V.facade),
  vw(U.c5, V.classTop, V.facade),
  vw(U.east1, V.classTop, V.facade),

  // --- Hall de acceso y kiosco --------------------------------------------------
  hw(V.hallTop, U.east1, U.salonW, 'int', [
    [33.5, 35.0, 'counter'],
    [36.0, 38.4, 'pass'],
  ]),
  vw(U.kioskE, V.kiosk, V.hallTop),
  hw(V.kiosk, U.east1, U.kioskE, 'int', [[33.7, 34.8, 'door']]),
  hw(V.hallDoors, U.east1, U.salonW, 'int', [[35.55, 39.35, 'entrance']]),
  vw(U.salonW, V.gymTop, V.facade, 'int', [
    [-19.6, -18.0, 'window'],
    [-16.2, -14.6, 'window'],
    [-12.8, -11.45, 'door'],
    [-11.15, -9.1, 'pass'],
    [-8.4, -7.0, 'door'],
  ]),

  // --- Salón de los espejos, pasaje y gimnasio -------------------------------
  hw(V.gymTop, U.salonW, U.gymW, 'int', [
    [43.3, 45.0, 'window'],
    [47.0, 48.7, 'window'],
  ]),
  hw(V.gymTop, U.gymW, U.e, 'int', [[58.05, 60.5, 'double']], SCHOOL.gymWall),
  hw(V.passN, U.salonW, U.gymW),
  hw(V.passS, U.salonW, U.gymW),
  vw(U.gymW, V.gymTop, V.facade, 'int', [[-11.0, -9.25, 'double']], SCHOOL.gymWall),
  vw(
    U.e,
    V.gymTop,
    V.facade,
    'ext',
    [
      [-18.4, -15.2, 'high'],
      [-12.0, -8.8, 'high'],
      [-5.6, -2.4, 'high'],
    ],
    SCHOOL.gymWall,
  ),

  // --- Arte, Teatro, pasillo del gimnasio y V. Damas --------------------------
  vw(U.gymW, rearV(U.gymW), V.artB, 'int', [[-27.4, -25.8, 'window']]),
  vw(U.gymW, V.artB, V.gymTop, 'int', [[-22.5, -20.95, 'door']]),
  vw(U.artE, rearV(U.artE), V.artB),
  vw(U.teaE, rearV(U.teaE), V.artB),
  hw(V.artB, U.gymW, U.teaE, 'int', [
    [51.5, 53.2, 'door'],
    [54.1, 56.0, 'door'],
  ]),
  vw(U.vdW, rearV(U.vdW), V.gymTop, 'int', [
    [-26.45, -25.45, 'door'],
    [-22.15, -21.15, 'door'],
  ]),
  hw(V.vdB, U.vdW, U.e),
  vw(66.0, -21.85, V.gymTop),
  hw(-21.85, 66.0, U.e),
  vw(U.e, V.top, rearV(U.e), 'ext', [
    [-36.4, -34.8, 'window'],
    [-32.6, -31.0, 'window'],
  ]),
  vw(U.e, rearV(U.e), V.gymTop, 'ext', [[-24.6, -23.9, 'window']]),

  // --- Jardín de infantes CIMPID ----------------------------------------------
  vw(U.teaE, V.top, rearV(U.teaE), 'ext', [[-36.2, -34.6, 'window']]),
  hw(V.top, U.teaE, U.e, 'ext', roomWindows(U.teaE, U.e)),
];

// ======================================================= ambientes y volúmenes

export type Floor = 'tile' | 'wood' | 'gym' | 'green' | 'patio' | 'dark';

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
}

const rect = (u0: number, v0: number, u1: number, v1: number): P[] => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1],
];

/**
 * Ambientes del plano. El orden importa sólo para `roomAt`: los recintos
 * chicos van antes que los que los rodean.
 */
export const ROOMS: readonly Room[] = [
  { id: 'aula1', name: 'Aula', poly: rect(U.w, V.classTop, U.c2, V.facade), floor: 'tile', roofed: true },
  { id: 'aula2', name: 'Aula', poly: rect(U.c2, V.classTop, U.c3, V.facade), floor: 'tile', roofed: true },
  { id: 'aula3', name: 'Aula', poly: rect(U.c3, V.classTop, U.c4, V.facade), floor: 'tile', roofed: true },
  { id: 'aula4', name: 'Aula', poly: rect(U.c4, V.classTop, U.c5, V.facade), floor: 'tile', roofed: true },
  { id: 'aula5', name: 'Aula', poly: rect(U.c5, V.classTop, U.east1, V.facade), floor: 'tile', roofed: true },
  {
    id: 'pasilloSur',
    name: 'Pasillo',
    poly: [[U.w, V.classTop], [U.east1, V.classTop], [U.east1, V.corrS], mc(V.corrS)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'dirPrim', name: 'Dir. Prim', poly: [mc(V.dirTop), [U.dirDiv, V.dirTop], [U.dirDiv, V.corrS], mc(V.corrS)], floor: 'tile', roofed: true },
  { id: 'sala', name: '', poly: rect(U.dirDiv, V.dirTop, U.wingE, V.corrS), floor: 'tile', roofed: true },
  {
    id: 'hallOeste',
    name: 'Pasillo',
    poly: [mc(V.profB), [U.wingE, V.profB], [U.wingE, V.dirTop], mc(V.dirTop)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'prof', name: 'Prof.', poly: [mc(V.admB), [11.5, V.admB], [11.5, V.grayB], [U.wingE, V.grayB], [U.wingE, V.profB], mc(V.profB)], floor: 'tile', roofed: true },
  { id: 'adm', name: 'ADM', poly: [mc(V.corrN), [11.5, V.corrN], [11.5, V.admB], mc(V.admB)], floor: 'tile', roofed: true },
  { id: 'pasilloOeste', name: 'Pasillo', poly: rect(U.wingE, V.corrN, U.patioW, V.corrS), floor: 'tile', roofed: true },
  { id: 'patioOeste', name: 'Patio aire libre', poly: rect(U.patioW, V.corrN, U.bufW, V.corrS), floor: 'patio', roofed: false },
  { id: 'buffet', name: 'Buffet', poly: rect(U.bufW, V.corrN, U.east1, V.corrS), floor: 'dark', roofed: true },
  {
    id: 'pasilloNorte',
    name: 'Pasillo',
    poly: [mc(V.nBlockS), [U.closetW, V.nBlockS], [U.closetW, V.corrN], mc(V.corrN)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'deposito', name: '', poly: rect(U.closetW, V.nBlockS, U.east1, V.corrN), floor: 'tile', roofed: true },
  { id: 'ep', name: 'E.P', poly: rect(U.epW, V.nBlockN, U.epE, V.nBlockS), floor: 'tile', roofed: true },
  { id: 'escalera', name: 'Escalera', poly: rect(U.epE, V.nBlockN, U.stairE, V.nBlockS), floor: 'tile', roofed: true },
  { id: 'salaNorte', name: '', poly: rect(U.stairE, V.nBlockN, U.east1, V.nBlockS), floor: 'tile', roofed: true },
  { id: 'nicho', name: '', poly: [mc(V.nBlockN), [U.epW, V.nBlockN], [U.epW, V.nBlockS], mc(V.nBlockS)], floor: 'tile', roofed: true },
  { id: 'tecnologia', name: 'Tecnología', poly: [APEX, rear(U.tecE), [U.tecE, V.nBlockN], mc(V.nBlockN)], floor: 'green', roofed: true },
  { id: 'kiosco', name: '', poly: rect(U.east1, V.kiosk, U.kioskE, V.hallTop), floor: 'tile', roofed: true },
  {
    id: 'hall',
    name: 'Hall de acceso',
    poly: rect(U.east1, V.hallTop, U.salonW, V.facade),
    floor: 'tile',
    roofed: true,
  },
  { id: 'salon', name: 'Salón de los espejos', poly: rect(U.salonW, V.gymTop, U.gymW, V.passN), floor: 'wood', roofed: true },
  { id: 'pasaje', name: 'Pasillo', poly: rect(U.salonW, V.passN, U.gymW, V.passS), floor: 'tile', roofed: true },
  { id: 'aula6', name: '', poly: rect(U.salonW, V.passS, U.gymW, V.facade), floor: 'tile', roofed: true },
  { id: 'gimnasio', name: 'Gimnasio SUM', poly: rect(U.gymW, V.gymTop, U.e, V.facade), floor: 'gym', roofed: true },
  { id: 'arte', name: 'Arte', poly: [rear(U.gymW), rear(U.artE), [U.artE, V.artB], [U.gymW, V.artB]], floor: 'tile', roofed: true },
  { id: 'teatro', name: 'Teatro', poly: [rear(U.artE), rear(U.teaE), [U.teaE, V.artB], [U.artE, V.artB]], floor: 'tile', roofed: true },
  { id: 'vDamas', name: 'V. Damas', poly: [rear(U.vdW), rear(U.e), [U.e, V.vdB], [U.vdW, V.vdB]], floor: 'tile', roofed: true },
  { id: 'sanitario', name: '', poly: rect(U.vdW, V.vdB, U.e, V.gymTop), floor: 'tile', roofed: true },
  {
    id: 'hallJardin',
    name: 'Pasillo',
    poly: [rear(U.teaE), rear(U.vdW), [U.vdW, V.gymTop], [U.gymW, V.gymTop], [U.gymW, V.artB], [U.teaE, V.artB]],
    floor: 'tile',
    roofed: true,
  },
  {
    id: 'jardin',
    name: 'Jardín de infantes CIMPID',
    poly: [[U.teaE, V.top], [U.e, V.top], rear(U.e), rear(U.teaE)],
    floor: 'tile',
    roofed: true,
  },
  {
    id: 'patioEste',
    name: 'Patio aire libre',
    poly: [
      rear(U.tecE),
      rear(U.gymW),
      [U.gymW, V.gymTop],
      [U.salonW, V.gymTop],
      [U.salonW, V.hallTop],
      [U.kioskE, V.hallTop],
      [U.kioskE, V.kiosk],
      [U.east1, V.kiosk],
      [U.east1, V.nBlockN],
      [U.tecE, V.nBlockN],
    ],
    floor: 'patio',
    roofed: false,
  },
];

/**
 * Volúmenes de dos plantas. La planta alta NO figura en el plano de
 * evacuación, así que no se inventa: se levanta como volumen cerrado con sus
 * ventanas, tal como se ve desde la calle y desde los patios en las fotos y en
 * el recorrido virtual. Las escaleras del plano quedan donde están.
 */
export const UPPER: readonly (readonly P[])[] = [
  // Aulas sobre Laprida, hall (portal) y aula junto al gimnasio.
  [
    [U.w, V.facade],
    [U.gymW, V.facade],
    [U.gymW, V.passN],
    [U.salonW, V.passN],
    [U.salonW, V.hallTop],
    [U.east1, V.hallTop],
    [U.east1, V.corrS],
    mc(V.corrS),
    [U.w, V.classTop],
  ],
  // Ala oeste y pasillo.
  [mc(V.corrS), [U.patioW, V.corrS], [U.patioW, V.corrN], mc(V.corrN)],
  // Bloque norte (E.P, escalera principal) y pasillo norte.
  [mc(V.corrN), [U.east1, V.corrN], [U.east1, V.nBlockN], mc(V.nBlockN)],
  // Buffet.
  rect(U.bufW, V.corrN, U.east1, V.corrS),
  // Jardín de infantes (tiene escalera propia en el recorrido).
  [[U.teaE, V.top], [U.e, V.top], rear(U.e), rear(U.teaE)],
];

/** Cubiertas de una sola planta. */
export const ROOFS: ReadonlyArray<{ poly: readonly P[]; y: number }> = [
  { poly: [APEX, rear(U.tecE), [U.tecE, V.nBlockN], mc(V.nBlockN)], y: H },
  { poly: [rear(U.gymW), rear(U.teaE), [U.teaE, V.artB], [U.gymW, V.artB]], y: H },
  {
    poly: [rear(U.teaE), rear(U.e), [U.e, V.gymTop], [U.gymW, V.gymTop], [U.gymW, V.artB], [U.teaE, V.artB]],
    y: H,
  },
  { poly: rect(U.salonW, V.gymTop, U.gymW, V.passN), y: H },
  { poly: rect(U.east1, V.kiosk, U.kioskE, V.hallTop), y: H },
];

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

/**
 * Escaleras. Se suben: cada tramo es una rampa para los pies (ver
 * `schoolFloorLocal`) y los escalones se dibujan encima.
 */
export const STAIRS: readonly Stair[] = [
  // Escalera principal del bloque norte (dos tramos, núcleo gris del plano).
  { u0: 20.35, v0: -27.35, u1: 26.1, v1: -25.3, dir: 'u+', y0: 0, y1: 1.65 },
  { u0: 20.35, v0: -29.65, u1: 26.1, v1: -27.6, dir: 'u-', y0: 1.65, y1: 3.3 },
  // Escalera del hall oeste, frente a Dir. Prim.
  { u0: 8.3, v0: -13.45, u1: 10.6, v1: -11.9, dir: 'u-', y0: 0, y1: 1.6 },
  // Escalera del hall de acceso: arranca en el pasillo sur y sube junto al buffet.
  { u0: 30.9, v0: -9.25, u1: 32.8, v1: -8.45, dir: 'u+', y0: 0, y1: 1.2 },
  { u0: 33.05, v0: -12.85, u1: 34.3, v1: -10.35, dir: 'v-', y0: 1.2, y1: 3.3 },
  // Escalera exterior del patio este, contra el bloque norte.
  { u0: 33.05, v0: -29.7, u1: 34.35, v1: -26.7, dir: 'v-', y0: 0.3, y1: 3.3 },
];

/** Descansos de las escaleras. */
export const LANDINGS: readonly Landing[] = [
  // Descanso bajo de la escalera exterior.
  { u0: 33.05, v0: -26.7, u1: 35.1, v1: -25.3, y: 0.3 },
  // Descanso entre los dos tramos de la escalera principal.
  { u0: 26.1, v0: -29.65, u1: 26.9, v1: -25.3, y: 1.65 },
];
/** Núcleo gris del plano entre ADM y el pasillo (escalera cerrada). */
export const GRAY_CORE: Rect = { u0: 11.5, v0: V.corrN, u1: U.wingE, v1: V.grayB };

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
  | 'lockers';

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
}

const item = (kind: ItemKind, u: number, v: number, w: number, d: number, face: Facing = 's', solid = true): Item => ({
  kind,
  u,
  v,
  w,
  d,
  face,
  solid,
});

/** Aula común: pizarrón al oeste, pupitres dobles mirándolo, escritorio docente. */
function classroom(u0: number, u1: number): Item[] {
  const out: Item[] = [];
  const v0 = V.classTop;
  out.push(item('board', u0 + 0.12, -3.4, 0.06, 2.6, 'e', false));
  out.push(item('teacherDesk', u0 + 1.3, -2.1, 0.7, 1.3, 'e'));
  out.push(item('chair', u0 + 0.75, -2.1, 0.45, 0.45, 'e', false));
  const cols = [u0 + 2.7, u0 + 4.1, u0 + 5.5].filter((u) => u < u1 - 0.8);
  for (const u of cols) {
    for (const v of [v0 + 1.8, v0 + 3.6, v0 + 5.4]) {
      out.push(item('desk', u, v, 0.55, 1.2, 'w'));
      out.push(item('chair', u + 0.5, v - 0.3, 0.42, 0.42, 'w', false));
      out.push(item('chair', u + 0.5, v + 0.3, 0.42, 0.42, 'w', false));
    }
  }
  out.push(item('shelf', u1 - 0.3, -0.6, 0.45, 1.2, 'w'));
  return out;
}

/** Laboratorio de ciencias: mesadas contra los muros y el centro libre. */
function lab(u0: number, u1: number): Item[] {
  const out: Item[] = [];
  out.push(item('board', u0 + 0.12, -3.4, 0.06, 2.6, 'e', false));
  // Mesada norte cortada antes de la puerta del aula.
  out.push(item('counter', (u0 + 0.3 + (u0 + 3.9)) / 2, V.classTop + 0.45, 3.6, 0.7, 's'));
  out.push(item('counter', u1 - 0.45, -3.2, 0.7, 3.6, 'w'));
  for (const u of [u0 + 3.0, u0 + 4.6]) {
    out.push(item('chair', u, V.classTop + 1.1, 0.42, 0.42, 'n', false));
  }
  out.push(item('shelf', (u0 + u1) / 2, -0.35, 2.4, 0.45, 'n'));
  return out;
}

export const ITEMS: readonly Item[] = [
  // Aulas sobre Laprida (la tercera es el laboratorio de la estación de ciencia).
  ...classroom(U.w, U.c2),
  ...classroom(U.c2, U.c3),
  ...lab(U.c3, U.c4),
  ...classroom(U.c4, U.c5),
  ...classroom(U.c5, U.east1),

  // Aula junto al gimnasio.
  ...[43.9, 45.4, 46.9, 48.4].flatMap((u) =>
    [-7.4, -5.6, -3.8, -2.0].map((v) => item('desk', u, v, 0.55, 1.2, 'w')),
  ),
  item('board', U.salonW + 0.14, -4.6, 0.06, 2.6, 'e', false),

  // Tecnología / Aula maker: mesas hexagonales, sillas azules, mural y estantes.
  item('hexTable', 16.9, -32.4, 1.8, 1.8),
  item('hexTable', 20.4, -33.9, 1.8, 1.8),
  item('hexTable', 25.2, -33.4, 1.8, 1.8),
  item('hexTable', 30.0, -31.6, 1.8, 1.8),
  item('shelf', 30.95, -33.8, 0.45, 2.2, 'w'),
  item('lockers', 16.6, -30.3, 1.8, 0.45, 'n'),
  item('column', 23.6, -30.4, 0.34, 0.34, 's'),

  // E.P
  item('table', 15.9, -27.5, 2.0, 1.1),
  item('shelf', 14.4, -27.2, 0.45, 1.8, 'e'),

  // Sala junto a la escalera.
  item('table', 30.4, -27.5, 2.0, 1.2),
  item('shelf', 32.6, -27.4, 0.45, 2.0, 'w'),

  // ADM, PROF. y DIR. PRIM: escritorios y bibliotecas del recorrido.
  item('teacherDesk', 10.2, -21.2, 1.3, 0.7, 's'),
  item('shelf', 11.25, -20.3, 0.4, 1.4, 'w'),
  item('table', 9.2, -16.2, 1.1, 2.8),
  item('shelf', 10.5, -14.2, 1.6, 0.4, 'n'),
  item('teacherDesk', 3.6, -10.0, 1.3, 0.7, 'n'),
  item('shelf', 7.7, -10.4, 0.4, 1.4, 'w'),
  item('teacherDesk', 9.4, -9.95, 1.3, 0.7, 'n'),

  // Buffet: barra contra las ventanillas, heladera, mesas y bancos.
  item('counter', 32.3, -18.9, 0.8, 5.6, 'w'),
  item('fridge', 32.35, -22.7, 0.7, 0.8, 'w'),
  item('table', 29.9, -20.5, 1.3, 0.8),
  item('table', 29.9, -16.4, 1.3, 0.8),
  item('table', 29.9, -12.4, 1.3, 0.8),
  item('bench', 29.9, -21.25, 1.3, 0.35, 's', false),
  item('bench', 29.9, -19.75, 1.3, 0.35, 'n', false),
  item('bench', 29.9, -17.15, 1.3, 0.35, 's', false),
  item('bench', 29.9, -15.65, 1.3, 0.35, 'n', false),

  // Patio oeste ("espacio recreativo"): canteros azules con pastos y bancos.
  item('planter', 17.4, -18.5, 1.2, 6.5),
  item('planter', 21.6, -22.8, 5.2, 0.9),
  item('planter', 27.5, -14.8, 1.0, 4.2),
  item('bench', 19.2, -12.2, 1.8, 0.5, 'n', false),
  item('tree', 26.3, -20.9, 0.6, 0.6),

  // Patio este: árboles contra la medianera, canteros, juegos y bancos.
  item('tree', 36.2, -33.1, 0.6, 0.6),
  item('tree', 42.4, -31.6, 0.6, 0.6),
  item('tree', 47.8, -30.0, 0.6, 0.6),
  item('playhouse', 45.4, -26.6, 2.4, 2.0),
  item('planter', 38.6, -21.4, 4.0, 0.9),
  item('bench', 38.6, -19.6, 1.8, 0.5, 'n', false),
  item('bench', 46.2, -21.5, 1.8, 0.5, 'n', false),

  // Hall de acceso: banner institucional, asientos de espera, columna acolchada.
  item('banner', 34.1, -3.2, 0.9, 0.4, 'e'),
  item('seats', 41.4, -4.4, 0.5, 2.6, 'w'),
  item('column', 38.9, -8.2, 0.42, 0.42),
  item('booth', 34.25, -14.1, 2.6, 1.6, 's', false),

  // Salón de los espejos (aula de danzas): espejos, barra y columnas rojas.
  item('mirror', 46.1, -20.62, 7.8, 0.04, 's', false),
  item('mirror', U.gymW - 0.18, -16.0, 0.04, 8.8, 'w', false),
  item('barre', 46.1, -20.4, 7.8, 0.12, 's'),
  item('barre', U.gymW - 0.4, -16.0, 0.12, 8.8, 'w'),
  item('column', 44.7, -15.9, 0.4, 0.4),
  item('column', 47.6, -15.9, 0.4, 0.4),

  // Gimnasio / SUM: arcos, gradas y un banco de suplentes.
  item('goal', 57.8, -19.4, 3.1, 0.8, 's'),
  item('goal', 57.8, -1.4, 3.1, 0.8, 'n'),
  item('bleachers', 66.0, -10.4, 2.4, 11.0, 'w'),

  // Arte y Teatro.
  item('table', 52.1, -25.5, 1.1, 2.2),
  item('stage', 55.8, -27.0, 3.5, 2.6, 's'),
  item('curtain', 55.8, -25.6, 3.5, 0.1, 's', false),
  item('seats', 56.2, -24.3, 2.0, 0.5, 'n'),

  // V. Damas: cubículos.
  item('stall', 66.4, -26.0, 1.4, 1.2, 'w'),
  item('stall', 66.4, -24.5, 1.4, 1.2, 'w'),

  // Jardín: mesas redondas, estantes y juego interior.
  item('roundTable', 60.2, -35.3, 1.2, 1.2),
  item('roundTable', 64.6, -35.3, 1.2, 1.2),
  item('roundTable', 62.4, -32.0, 1.2, 1.2),
  item('shelf', 67.0, -37.0, 0.45, 2.0, 'w'),
  item('playhouse', 59.4, -31.4, 1.6, 1.4),
];

// ============================================================== señalización

/** Bandera en el mástil inclinado del portal (como en la fachada real). */
export const FLAG = { u: 34.35, v: 1.9, y: 5.25 } as const;

/** Punto de encuentro del plano: esquina de Miguel Cané y Laprida. */
export const MEETING_POINT: P = [-3.1, 1.3];

/**
 * Posiciones locales de las estaciones de aprendizaje y hacia dónde mira el
 * guía, como giro en mundo (0 = sur/+z, π = norte, π/2 = oeste/+x).
 */
export const STATION_SPOTS = {
  tech: { u: 22.6, v: -31.4, yaw: 0 },
  robotics: { u: 27.6, v: -31.3, yaw: 0 },
  science: { u: 16.0, v: -3.4, yaw: Math.PI },
  sport: { u: 57.8, v: -12.5, yaw: Math.PI / 2 },
  environment: { u: 21.6, v: -16.4, yaw: 0 },
} as const;

/** Zonas donde circulan los alumnos (las usa la multitud). */
export const STUDENT_ZONES = {
  initial: { u0: 33.8, v0: -29.6, u1: 49.6, v1: -21.4 },
  primary: { u0: 17.0, v0: -22.4, u1: 27.9, v1: -9.9 },
  secondary: { u0: 51.2, v0: -19.9, u1: 64.8, v1: -1.2 },
} as const satisfies Record<string, Rect>;

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

/** ¿El punto está dentro del predio escolar (edificio, patios o franja de frente)? */
export function inLot(u: number, v: number): boolean {
  if (v > SCHOOL.front || v < V.top - 0.2 || u > U.e + 0.2) return false;
  if (u < miguelCaneU(v)) return false;
  if (u >= U.teaE - 0.1) return true;
  return v >= rearV(u) - 0.2;
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

/** ¿Hay piso transitable de ese nivel en el punto? La planta baja cubre todo el predio. */
export function hasFloor(level: Level, u: number, v: number): boolean {
  if (level === 0) return true;
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

function riserCount(s: Stair): number {
  return Math.max(4, Math.round((s.y1 - s.y0) / 0.175));
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
  return s.y0 < 0.5;
}

interface StairHit {
  y: number;
  /** Macizo desde el suelo hasta `y`. */
  solidBelow: boolean;
}

/** Tramos y descansos que contienen el punto, con la altura de su piso ahí. */
function stairHitsAt(u: number, v: number): StairHit[] {
  const out: StairHit[] = [];
  for (const s of STAIRS) {
    if (u >= s.u0 && u <= s.u1 && v >= s.v0 && v <= s.v1) {
      out.push({ y: stairY(s, u, v), solidBelow: stairIsSolidBelow(s) });
    }
  }
  for (const l of LANDINGS) {
    if (u >= l.u0 && u <= l.u1 && v >= l.v0 && v <= l.v1) {
      out.push({ y: SCHOOL.floorY + l.y, solidBelow: l.y < 3 });
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
const GU0 = -9;
const GV0 = -42;
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

/**
 * Obstáculos rectangulares alineados de un nivel: núcleo gris y canteros de
 * frente en planta baja, y el equipamiento que bloquea en cada nivel. Las
 * escaleras no están acá: se resuelven por altura (ver `schoolSolidLocal`).
 */
function obstacleRects(level: Level): Rect[] {
  const out: Rect[] = [];
  if (level === 0) {
    out.push(GRAY_CORE);
    // Canteros elevados de la franja de frente (entre la fachada y la reja).
    for (const r of FRONT_PLANTERS) out.push(r);
  }
  for (const it of ITEMS) {
    if (!it.solid || (it.level ?? 0) !== level) continue;
    const halfW = it.kind === 'tree' ? 0.35 : it.w / 2;
    const halfD = it.kind === 'tree' ? 0.35 : it.d / 2;
    out.push({ u0: it.u - halfW, v0: it.v - halfD, u1: it.u + halfW, v1: it.v + halfD });
  }
  return out;
}

/** Canteros de la franja de frente, a ambos lados del acceso. */
export const FRONT_PLANTERS: readonly Rect[] = [
  { u0: 0.4, v0: 0.35, u1: 14.8, v1: 1.35 },
  { u0: 16.8, v0: 0.35, u1: 32.4, v1: 1.35 },
  { u0: 42.4, v0: 0.35, u1: 49.8, v1: 1.35 },
];

/** Reja sobre la línea municipal: tramos con su abertura para pasar. */
export const FENCES: readonly (readonly [P, P])[] = [
  [
    [miguelCaneU(SCHOOL.front - 0.15), SCHOOL.front - 0.15],
    [15.4, SCHOOL.front - 0.15],
  ],
  [
    [16.2, SCHOOL.front - 0.15],
    [33.1, SCHOOL.front - 0.15],
  ],
  [
    [42.0, SCHOOL.front - 0.15],
    [50.2, SCHOOL.front - 0.15],
  ],
  // Sobre Miguel Cané, hasta el muro del ala oeste, con portón de salida.
  [
    [miguelCaneU(SCHOOL.front - 0.15), SCHOOL.front - 0.15],
    [miguelCaneU(-4.6), -4.6],
  ],
  [
    [miguelCaneU(-6.8), -6.8],
    [miguelCaneU(V.corrS), V.corrS],
  ],
];

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
      each(u0, v0, u1, v1, (k, u, v) => {
        if (inPoly(r.poly, u, v)) g[k] = 0;
      });
    }
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
  for (const w of WALLS) {
    if (w.level !== level) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    const half = wallThickness(w) / 2 + m;
    for (const [t0, t1] of solidPieces(w)) {
      segment([w.a[0] + du * t0, w.a[1] + dv * t0], [w.a[0] + du * t1, w.a[1] + dv * t1], half);
    }
  }
  if (level === 0) for (const [a, b] of FENCES) segment(a, b, 0.05 + m);
  for (const r of obstacleRects(level)) {
    mark(r.u0 - m, r.v0 - m, r.u1 + m, r.v1 + m, () => true);
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
  const hits = stairHitsAt(u, v);
  if (hits.length > 0) {
    if (pedestrian) return true;
    let clear = true;
    for (const h of hits) {
      if (h.y <= feetY + STEP_UP && h.y >= feetY - STEP_DOWN) return false;
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
  return gridSolid(level, u, v);
}
