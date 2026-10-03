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

/**
 * Líneas del plano (u constantes): ejes de muro, como `rect()`.
 *
 * Salen del plano de evacuación en CAD (planta baja y primer piso), pasado a
 * metros con el frente de 67,4 m del ochavo al muro este del gimnasio (26,02
 * px/m; sobre los muros que el modelo ya tenía bien, error de ~0,26 m). Lo que
 * el CAD no dibuja porque es más nuevo (edificio de bloque, Arte, Teatro,
 * jardín, Tecnología, galería roja) sale de la foto del plano de S&O y del
 * recorrido de 2020, apoyado en estas líneas.
 */
export const U = {
  w: 0,
  /** Testero oeste del pasillo sur, con la salida al ochavo. */
  jog: 0.9,
  /** Dirección primaria / Preceptoría (arriba, Gerencia / caja de la escalera). */
  dirDiv: 5.5,
  c2: 6.51,
  /** Sala de profesores y Administración / columna de baños. */
  wcW: 10.56,
  /** Lado oeste del bloque norte (pasillo hacia el Aula Maker). */
  epW: 12.28,
  /** Ala oeste / pasillo oeste (sigue en el primer piso). */
  wingE: 12.47,
  c3: 13.0,
  /** Pasillo hacia el Aula Maker / E.P. */
  epCorrE: 14.3,
  /** Pasillo oeste / patio central (sigue en el primer piso). */
  patioW: 14.83,
  /** E.P / núcleo de sanitarios. */
  epE: 19.5,
  c4: 19.52,
  /** Núcleo de sanitarios: entrada en recodo desde el pasillo norte. */
  notchW: 21.68,
  bathDiv: 23.21,
  notchE: 24.5,
  c5: 26.01,
  /** Núcleo de sanitarios / aula del bloque norte. */
  stairE: 26.76,
  /** Patio / buffet (en el primer piso, el muro oeste de las aulas del comedor). */
  bufW: 27.36,
  /** Fin del pasillo norte: el local con las puertas vidriadas al patio este. */
  endW: 28.92,
  /** Tecnología / patio este. */
  tecE: 30.01,
  /** Aula 5, buffet y bloque norte / hall y patio este (todos los pisos). */
  east1: 32.48,
  /** Torre de la escalera del hall (= pasillo este del primer piso). */
  kioskE: 35.31,
  /** Vestíbulo / oficina de recepción, a la DERECHA de la entrada. */
  recW: 36.75,
  /** Hall / edificio de bloque (todos los pisos). */
  salonW: 40.54,
  gymW: 50.3,
  artE: 53.9,
  teaE: 57.65,
  vdW: 62.7,
  e: 67.4,
} as const;

/** Líneas del plano (v constantes): ejes de muro, del CAD como las de `U`. */
export const V = {
  facade: 0,
  /** Frente del hall con la entrada: delante queda el atrio bajo el primer piso. */
  hallDoors: -2.31,
  /** Entre las dos celdas de la oficina de recepción. */
  recN: -4.02,
  /** Oficina de recepción: su lado norte. */
  recB: -5.53,
  /** Lado norte de las aulas sobre Laprida (todos los pisos). */
  classTop: -6.19,
  /** Donde la diagonal de Miguel Cané llega al testero del pasillo sur. */
  jogN: -8.28,
  /** Pasillo sur / patio y ala oeste (todos los pisos). */
  corrS: -8.53,
  passS: -9.1,
  /** Dirección primaria y Preceptoría / caja de la escalera del ala oeste. */
  dirTop: -10.42,
  passN: -11.15,
  /** Testero norte del hall = lado sur de la torre de su escalera. */
  hallTop: -12.58,
  /** Caja de la escalera del ala oeste / Sala de profesores. */
  profB: -12.95,
  /** Lado norte de la torre de la escalera del hall. */
  kiosk: -15.06,
  /** Columna de baños junto a Administración: su lado sur. */
  wcS: -15.75,
  /** Sala de profesores / Administración. */
  admB: -17.41,
  /** Tabiques de los cubículos de esa columna. */
  wcP1: -17.41,
  wcP2: -19.62,
  gymTop: -20.8,
  /** Administración: su lado norte, al pasillo norte. */
  admN: -20.9,
  /** Pasillo norte: lado sur (= norte del patio y del buffet). */
  corrN: -20.96,
  /** Columna de baños: su lado norte (asoma 0,6 m en el pasillo norte). */
  wcN: -21.5,
  artB: -22.65,
  /** Bloque norte: lado sur (= pasillo y fila norte del primer piso). */
  nBlockS: -23.25,
  vdB: -23.55,
  /** Fondo del recodo de la entrada a los baños (= pasillo norte del primer piso). */
  notchN: -25.23,
  /** Pozo de luz del núcleo, cerrado. */
  wellS: -27.35,
  wellN: -28.51,
  /** Bloque norte: lado norte (sólo planta baja; arriba la fila llega a −31,9). */
  nBlockN: -30.4,
  top: -39,
} as const;

/**
 * Línea municipal sobre Miguel Cané: la calle corre en diagonal (26,9° del
 * norte, la recta del CAD) y el ala oeste del edificio se apoya sobre ella.
 */
export function miguelCaneU(v: number): number {
  return -3.305 - 0.508 * v;
}

/**
 * Distancia perpendicular al OESTE de la línea municipal de Miguel Cané
 * (negativa dentro del predio). La calzada corre a media calle de ella.
 */
export function miguelCaneOffset(u: number, v: number): number {
  return (miguelCaneU(v) - u) * MC_COS;
}

/** Pendiente de Miguel Cané: metros de u por metro de v hacia el norte. */
export const MC_SLOPE = 0.508;
/** Componente en v de la dirección de Miguel Cané: convierte Δu en distancia real. */
export const MC_COS = 1 / Math.hypot(MC_SLOPE, 1);

/** Medianera del fondo: la otra diagonal del predio. */
export function rearV(u: number): number {
  return -38.48 + 0.2496 * (u - 19.35);
}

/**
 * Vértice norte del predio: encuentro de Miguel Cané con la medianera (que no
 * se movió: la del CAD difiere en ≤ 0,6 m al oeste de u 40 y el jardín, más
 * nuevo que el CAD, coincide con la de S&O).
 */
export const APEX: P = (() => {
  // u = −3,305 − 0,508·v  ∩  v = −38,48 + 0,2496·(u − 19,35)
  const v = (-38.48 + 0.2496 * (-3.305 - 19.35)) / (1 + 0.2496 * MC_SLOPE);
  return [miguelCaneU(v), v] as const;
})();

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
  /**
   * Protección exterior de una ventana a la calle o al patio: rejas negras
   * (planta baja, por defecto), rejas blancas (pisos altos, por defecto),
   * malla romboidal, parasoles horizontales o nada.
   */
  grille?: Grille;
}

export type Grille = 'bars' | 'whiteBars' | 'mesh' | 'louvre' | 'none';

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
  /** Terminación de la cara exterior (por defecto, el revoque gris de fachada). */
  ext?: string;
  /**
   * Terminación de la parte alta de un muro de dos plantas (por encima de la
   * losa) del lado que no es el ambiente alto: el bloque del primer piso
   * detrás del testero del polideportivo.
   */
  upper?: string;
}

/** Aberturas transitables: el resto del muro es sólido. */
export const WALKABLE: ReadonlySet<OpeningType> = new Set(['door', 'double', 'pass', 'exit', 'entrance']);

/**
 * Vano: desde, hasta (en el eje dominante del muro), tipo y, opcionales,
 * antepecho, dintel y material de hojas y marcos.
 */
export type Op = readonly [number, number, OpeningType, number?, number?, string?, Grille?];

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
    .map(([c0, c1, type, hb, ht, color, grille]): Opening => {
      const t0 = ((c0 - from) / span) * len;
      const t1 = ((c1 - from) / span) * len;
      const o: Opening = { t0: Math.max(0, Math.min(t0, t1)), t1: Math.min(len, Math.max(t0, t1)), type };
      if (hb !== undefined) o.hb = hb;
      if (ht !== undefined) o.ht = ht;
      if (color !== undefined) o.color = color;
      if (grille !== undefined) o.grille = grille;
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
  | 'ceramicTan'
  | 'ceramicBeige'
  | 'rubber'
  | 'terracotta'
  | 'hallStone'
  | 'dance';

export interface Room {
  id: string;
  /** Rótulo tal como aparece en el plano; vacío si el plano no lo nombra. */
  name: string;
  poly: readonly P[];
  floor: Floor;
  /**
   * Piso que se dibuja, si difiere de `floor` sólo en el color. El sonido de
   * los pasos sale de `floor`: así un cerámico de otro tono suena igual.
   */
  floorLook?: Floor;
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
  /** Azotea plana con pretil (no la tiene lo que queda bajo la bóveda del gimnasio). */
  roof?: boolean;
  /** Cerramiento genérico donde un nivel no tiene ambientes (no en la torre de la escalera). */
  shell?: boolean;
  /** Cornisa entre plantas (no en la fachada lisa del jardín). */
  cornice?: boolean;
  /** Material de la azotea, si no es la chapa gris común. */
  roofMat?: string;
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
  /** Escalera de chapa con luz por debajo aunque arranque del suelo (la exterior del comedor). */
  hollow?: boolean;
  /** Del lado abierto, paño de metal desplegado con marco (la del hall, 0:19; la blanca del comedor, 9:44) en vez de parantes. */
  meshGuard?: boolean;
}

/** Descanso: plataforma horizontal entre tramos, a `y` sobre el piso de planta baja. */
export interface Landing extends Rect {
  y: number;
  /** Losa con luz por debajo (un descanso sobre un ambiente), no macizo hasta el piso. */
  hollow?: boolean;
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
  | 'palm' // palmera (alto en `h`, apoyada a `y`)
  | 'playTower' // torre de juegos de madera con dos toboganes
  | 'aviary' // jaula/aviario con techo de chapa (con color del marco)
  | 'hut' // choza con techo de paja
  | 'climber' // domo trepador
  | 'bikeRack' // bicicletero
  | 'waterTank' // tanque de agua sobre una azotea
  | 'louvredDoor' // puerta de chapa con celosía (bajo la escalera exterior)
  | 'condenser' // unidad exterior de aire acondicionado colgada de la fachada
  | 'bareTree' // árbol sin hojas (el video es de invierno)
  | 'hedge'; // mata de cañas/arbustos de un cerco vivo

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
  /** Reja (`gate`): paño de metal desplegado con marco en vez de barrotes. */
  mesh?: boolean;
}

/**
 * Medidas de mobiliario que comparten el constructor (lo que se dibuja), la
 * gente (a qué altura se sienta) y el QA de `tests/schoolProps` (que las
 * compara con las de un aula real). Alturas sobre el piso terminado.
 */
export const FURNITURE = {
  /** Tapa del pupitre (talle 6 de la norma escolar: 0,71–0,76 m). */
  deskTop: 0.74,
  /** Tapa de mesas de aula, de profesores y de biblioteca. */
  tableTop: 0.76,
  /** Asiento de la silla escolar: 28 cm debajo del pupitre. */
  seat: 0.46,
  /** Mesas redondas bajas de primer grado y del jardín (talle 3). */
  smallTable: 0.6,
  /** Escala de las sillitas de esas mesas (asiento a ~0,35 m). */
  smallScale: 0.75,
  /** Tapa de las mesas de trabajo del Aula Maker. */
  benchTop: 0.78,
  /** Pizarra blanca: borde inferior y superior del paño. */
  boardBottom: 0.9,
  boardTop: 2.1,
  /** Fondo negro de los escenarios, sobre la tarima de 0,62 m. */
  backdrop: 2.3,
  /**
   * Sillas alrededor de mesas redondas y hexagonales: del borde de la tapa al
   * centro de la silla, metida bajo la mesa. Con 0,30 el frente del asiento
   * quedaba a 16–20 cm del borde y los chicos escribían con los brazos
   * estirados. Lo usan el constructor y la gente (tienen que coincidir).
   */
  roundChair: 0.17,
  /**
   * Aulas de primaria (`PRIMARY_ROOMS`): pupitres y mesas de talle 4–5
   * (0,64–0,71 m) y sillas de 0,40 m, no las de adulto. Con 0,74 y 0,46 los
   * chicos de 2º a 6º grado escribían con los hombros levantados.
   */
  primaryDeskTop: 0.66,
  primarySeat: 0.4,
} as const;

/**
 * Alto libre hasta el cielorraso de cada ambiente, cuando no es el de la
 * planta (3,1 m). Lo usan el constructor (cielorrasos y luminarias) y el QA
 * del equipamiento (nada puede atravesar el cielorraso).
 */
export const CEILING_H: Readonly<Record<string, number>> = {
  pasilloL1: 2.75,
  pasilloNorteL1: 2.75,
  pasilloOesteL1: 2.75,
  // La caja de escalera del primer piso, a la altura de los pasillos que la
  // rodean: con 3,1 m quedaba un escalón de cielorraso sin muro debajo y por
  // la ranura se veía el cielo.
  escaleraOeste: 2.75,
  // Ambientes nuevos del primer piso (plano CAD + plano a mano): a la altura
  // de las aulas vecinas.
  gerencia: 2.75,
  aula6C: 2.75,
  prBil: 2.75,
  aulaVertice: 2.75,
  aula4A: 2.75,
  aulaN2: 2.75,
  aulaNE: 2.75,
  aulaTaller: 2.7,
  pasilloTrofeos: 2.85,
  secretaria: 2.85,
  aulaS1: 2.85,
  aulaS2: 2.85,
  aulaS3: 2.85,
  aulaS4: 2.85,
  aulaS5: 2.85,
  banosS: 2.6,
  banosN: 2.6,
  aula6BD: 2.85,
  aula6AC: 2.85,
  aulaC1: 2.75,
  aulaC2: 2.75,
  biblioteca: 2.75,
  bilingue: 2.75,
  galeria: 2.5,
  pasarela: 2.45,
  dirSec: 2.75,
  precepSec: 2.75,
  aulaSec: 2.75,
  pasilloBloque: 2.7,
  aulaBloqueD: 2.7,
  aulaBloqueC: 2.7,
  aulaBloqueA: 2.7,
  jardinRecepcion: 2.8,
  jardinGaleria: 2.8,
  salaAmarilla: 2.8,
  jardinHall1: 2.8,
  salaCeleste: 2.8,
  jardinGaleria1: 2.8,
  salaRosa: 2.8,
  salaRoja: 2.8,
  jardinHall2: 2.8,
  espacioMusica: 2.8,
  sum: 3.0,
};

/**
 * Salas del jardín de infantes: mesas y sillas de talle chico (las sillas
 * del plano miden 36 cm). Lo usan el constructor y el QA del equipamiento.
 */
export const KINDER_ROOMS: ReadonlySet<string> = new Set(['salaAmarilla', 'salaCeleste', 'salaRosa', 'salaRoja']);

/**
 * Aulas de primaria de 2º a 6º grado: pupitres, mesas y sillas de talle
 * `FURNITURE.primaryDeskTop` / `primarySeat` (salvo la silla del docente).
 * Primer grado (aula 1) usa las mesas redondas bajas. Lo usan el constructor,
 * la gente (a qué altura se sienta y escribe) y el QA del equipamiento.
 */
export const PRIMARY_ROOMS: ReadonlySet<string> = new Set(['aula2', 'aula3', 'aula4', 'aula5', 'aula6AC', 'aula6BD']);

/** Ambientes bajo una bóveda (polideportivo y aula de danzas): sin cielorraso plano. */
export const VAULTED: ReadonlySet<string> = new Set(['gimnasio', 'aulaDanzas', 'hallDanzas']);

/** Alto libre de un ambiente sobre su piso (la bóveda cuenta como muy alta). */
export function ceilingHeight(r: { id: string }): number {
  if (VAULTED.has(r.id)) return 6;
  return CEILING_H[r.id] ?? 3.1;
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
