import {
  APEX,
  SCHOOL,
  U,
  V,
  hw,
  item,
  itemsOn,
  mc,
  miguelCaneU,
  onLevel,
  rear,
  rearV,
  rect,
  roomsOn,
  seg,
  vw,
  type Facing,
  type Item,
  type Landing,
  type Level,
  type Op,
  type P,
  type Rect,
  type Room,
  type Stair,
  type Volume,
  type Wall,
} from './SchoolBase';

/**
 * Plantas altas del edificio principal (sin el jardín).
 *
 * Mandan los planos: el de evacuación del PRIMER PISO (CAD, con muros,
 * puertas y escaleras, registrado sobre las mismas líneas de la planta baja)
 * da los contornos, los muros y las escaleras, y la "Planta Alta" anotada a
 * mano da qué es cada ambiente y qué curso lo usa. El CAD es más viejo que el
 * recorrido de 2020: lo que no dibuja (el edificio de bloque sobre el Salón
 * de los espejos, la galería roja, la pasarela, la escalera blanca, la de
 * chapa y el aula de danzas del 2º piso) sigue saliendo del video, igual que
 * las alturas, las ventanas de las fachadas y las terminaciones. Las
 * referencias de tiempo (m:ss) son del recorrido.
 *
 * Recorrido de la planta alta, en resumen:
 * - "Acceso al Nivel Secundario" (0:19, 4:16–4:28): escalera en U desde el
 *   hall. El primer tramo sube al norte hasta el descanso en la torre al norte
 *   del hall; de ahí un tramo corto vuelve al sur y desemboca en el pasillo
 *   este, y la pasarela vidriada sale hacia el edificio de bloque.
 * - Pasillo este (de los trofeos, 4:30–5:11): baja hacia Laprida entre los
 *   baños (Damas y Caballeros) y las aulas de sexto, y termina en la
 *   Preceptoría ("PR" del plano; el video la rotula Secretaría de primaria),
 *   que mira a la calle por la ventana oeste del portal.
 * - Pasillo de lockers (5:12–5:19), sobre el pasillo sur: aulas sobre Laprida
 *   de un lado y, del otro, el patio central, abierto al cielo (la "X" del
 *   plano). Sobre el ochavo, la Gerencia.
 * - Galería revestida en chapa roja (5:20–5:31, 6:57–7:03) en voladizo sobre
 *   el patio, delante del Aula y del Salón Emociones (sobre el comedor).
 * - Ala oeste, sobre el pasillo oeste (2:02–2:06): la cabecera de la escalera
 *   "Acceso a primer piso" (7:44–7:58) con la PR de secundaria, el aula de
 *   4° E · 6° B (7:12) y la Dirección de secundaria (7:27).
 * - Sector nuevo (5:32–6:56), a lo largo del lado norte del patio: el aula
 *   bilingüe, 6° C, la biblioteca con el fichero rojo, la mesada de venecitas
 *   del pasillo y, detrás, los baños, Prof. bilingüe y el aula del vértice
 *   (sobre Tecnología); al este, 4° A y el aula del fondo.
 * - Aula nueva sobre el patio este, a la que se sube por la escalera
 *   exterior de chapa contra el bloque norte.
 * - Edificio de bloque (8:08–8:42), sobre el Salón de los espejos: pasillo
 *   con columnas rojas y lockers, aulas de bloque a la vista, y la escalera
 *   de chapa "Acceso a segundo piso" hasta el Salón de los espejos del 2º
 *   piso (el aula de danzas, 8:44–9:16), bajo la bóveda del polideportivo.
 */

/** v donde la línea municipal de Miguel Cané pasa por `u` (la inversa de `miguelCaneU`, que es una recta). */
function mcV(u: number): number {
  const a = miguelCaneU(0);
  return (u - a) / (miguelCaneU(1) - a);
}

/** Líneas de las plantas altas (u). Las que siguen un muro de planta baja lo nombran, no copian el número. */
export const U1 = {
  /** Divisiones de las aulas sobre Laprida: las del CAD (5,5 / 11,1 / 18,2 / 29,3) y la de S4/S5, que la mano y el video dan en ~24,3. */
  aulas: [U.dirDiv, 11.1, 18.2, 24.3, 29.3] as const,
  /** Caja de la escalera del ala oeste: su lado este (llega el segundo tramo y se abre al pasillo). */
  stairE: 10.24,
  /**
   * PR de secundaria: su lado oeste, sobre el primer tramo de planta baja
   * (que llega a u 10,15). El plano la dibuja en 8,6; en 8,9 el canto de la
   * losa queda a 2,09 m de los escalones (en 8,6 eran 1,95 m: se pegaba la cabeza).
   */
  prW: 8.9,
  /** Galería roja: voladizo de 1,8 m sobre el patio (columnas negras abajo). */
  gallery: 25.56,
  /** Pasillo este (de los trofeos) y torre de la escalera del hall: su lado este. */
  trophyE: U.kioskE,
  towerE: U.kioskE,
  /** Pasillo del edificio de bloque: su lado este. */
  blockCorr: 42.79,
  /** Borde oeste de la bóveda: muro del aula de danzas con los espejos. */
  vaultW: 44.0,
  /** Escalera de chapa del edificio de bloque. */
  blockStair0: 44.4,
  blockStair1: 47.6,
  blockStair2: 48.9,
  /**
   * Sector nuevo, fila del pasillo: tabiques aula bilingüe / 6° C y 6° C /
   * biblioteca. Los da la Planta Alta impresa (tres aulas parejas, a un
   * tercio y dos tercios de la fila); el CAD dibuja sólo dos locales y con
   * su tabique en 19,5 a 6° C (29 alumnos) le quedaban 15 m².
   */
  bil: 17.4,
  c6: 22.45,
  /** Baños / Prof. bilingüe. */
  prBil: 22.66,
  /** Aula 2° A / Aula taller (emociones · psicología). */
  aulaTaller: 45.8,
  /** Aula nueva sobre el patio este: su lado oeste (el balcón de la escalera exterior) y su lado este. */
  neW: 33.9,
  neE: 38.5,
} as const;

/** Líneas de las plantas altas (v). */
export const V1 = {
  /** Preceptoría (PR) sobre el portal: su lado norte. El CAD la da de 1 m y la mano de ~2,7: con 2 m entra el escritorio y la puerta de Damas sigue en el pasillo. */
  secretaria: -2.0,
  /** Baños sobre Laprida: Damas (sur) / Caballeros (norte). */
  banosDiv: -3.24,
  /** Entre 6° BD y 6° AC. */
  sixth: -6.61,
  /** Lado norte de 6° AC y del pasillo este (= testero norte del hall). */
  trophyN: V.hallTop,
  /** Pasarela vidriada. */
  walkS: -13.6,
  walkN: -14.85,
  /**
   * Hueco del primer tramo de la escalera del hall en el piso alto: su lado
   * sur. El CAD lo corta en −10,78, pero ahí al que sube le quedaban 1,86 m
   * sobre los escalones; el hueco del P1 arranca más al sur (−10,0).
   */
  hallVoid: -10.4,
  /** PR de secundaria: lado sur, sobre el muro norte de Dirección y Preceptoría de primaria. */
  prS: V.dirTop,
  /** Caja de la escalera del ala oeste: lado norte (sobre el de la sala de profesores). */
  stairN: V.profB,
  /** Aula 4° E · 6° B / Dirección de secundaria. */
  aulaSec: -17.95,
  /** Aula / Salón Emociones (con el tabique plegable). */
  emoc: -16.92,
  /** Pasillo del sector nuevo: su lado norte (= fondo del recodo de los baños de abajo). */
  northCorr: V.notchN,
  /**
   * Conducto entre la fila del pasillo y la del fondo. La fila norte del P1
   * está 1,5 m más al norte que el bloque norte de la planta baja: se respeta
   * la del P1 (con la de abajo quedaban aulas de 2 m) y el pozo de luz de
   * planta baja queda cerrado.
   */
  ductS: -29.1,
  ductN: -29.95,
  /** Fondo de la fila norte (baños, Prof. bilingüe) / aula del vértice. */
  northRow: -31.9,
  /**
   * Aula nueva sobre el patio este: su lado sur y el del recorte del balcón.
   * El recorte arranca al pie del tramo largo de la escalera exterior (el CAD
   * lo da en −27,08: su muro quedaba sobre el tramo).
   */
  neS: -24.85,
  neL: -26.8,
  /** Bloque: entre las aulas D (sur) y C. */
  blockCD: -7.8,
  /** Bloque: aula C / hall de la escalera. */
  blockHall: -13.6,
  /** Bloque: hall de la escalera / aula A. */
  blockA: -17.6,
  /** Testero sur del aula de danzas (más al sur la bóveda baja demasiado). */
  danceS: -3.1,
} as const;

/** Donde la diagonal de Miguel Cané cruza el eje de la fachada oeste: la punta de la Gerencia. */
const MC0 = mcV(U.w);
/** Punta norte del testero oeste del aula bilingüe (el retiro sobre el techo del nicho). */
const BIL_SW = mcV(U.epW);

/**
 * Ventanas del primer piso sobre el portal (una de la PR y dos de 6° BD). El
 * portal (`SchoolBuilder.portal`) las enmarca: tiene que usar estas mismas.
 */
export const PORTAL_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [33.69, 35.09],
  [35.89, 37.29],
  [38.19, 39.59],
];

// =================================================================== volúmenes

/**
 * Volúmenes con planta alta: un anillo alrededor del patio central, que
 * queda abierto al cielo. Los vértices intermedios sobre una misma recta
 * marcan dónde termina el vecino: el pretil de la azotea se decide tramo por
 * tramo y no cruza la azotea del otro volumen.
 */
export const UPPER_VOLUMES: readonly Volume[] = [
  // Aulas sobre Laprida, pasillo de lockers y ala oeste, con la Gerencia
  // sobre la diagonal hasta la esquina del ochavo.
  {
    poly: [
      [U.w, V.facade],
      [U.east1, V.facade],
      [U.east1, V.corrS],
      [U.patioW, V.corrS],
      [U.patioW, V.nBlockS],
      [U.wingE, V.nBlockS],
      [U.wingE, V1.northCorr],
      [U.epW, V1.northCorr],
      mc(V1.northCorr),
      [U.w, MC0],
    ],
    floors: 1,
  },
  // Sobre el hall: PR, 6° BD, 6° AC y el pasillo este.
  { poly: rect(U.east1, V1.trophyN, U.salonW, V.facade), floors: 1 },
  // Torre de la escalera del hall: muros propios de dos plantas, sin cerramiento.
  // Sin cornisa: sus aristas cruzan los dos vanos de dos plantas (pasarela
  // y escalera blanca) y se metían en el aula de al lado.
  { poly: rect(U.east1, V.kiosk, U1.towerE, V1.trophyN), floors: 1, shell: false, cornice: false },
  // Columna sobre el comedor (con la galería en voladizo sobre el patio) y
  // todo el triángulo norte hasta la medianera, también sobre Tecnología.
  {
    poly: [
      [U1.gallery, V.corrS],
      [U.east1, V.corrS],
      [U.east1, V1.trophyN],
      [U.east1, V.kiosk],
      [U.east1, V1.neS],
      [U.east1, V1.neL],
      rear(U.east1),
      APEX,
      [U.epW, BIL_SW],
      [U.epW, V1.northCorr],
      [U.wingE, V1.northCorr],
      [U.wingE, V.nBlockS],
      [U.patioW, V.nBlockS],
      [U1.gallery, V.nBlockS],
    ],
    floors: 1,
  },
  // Aula nueva sobre el patio este: abajo sigue el patio, con pilares.
  { poly: [[U.east1, V1.neS], [U1.neE, V1.neS], rear(U1.neE), rear(U1.neW), [U1.neW, V1.neL], [U.east1, V1.neL]], floors: 1 },
  // Edificio de bloque: la franja oeste tiene azotea; el resto queda bajo la
  // bóveda del polideportivo, que se prolonga hasta el muro de los espejos.
  { poly: rect(U.salonW, V1.blockHall, U1.vaultW, V.facade), floors: 1 },
  { poly: rect(U.salonW, V.gymTop, U1.vaultW, V1.blockA), floors: 1 },
  // Remate de la escalera de chapa: tres plantas, con el tanque de agua arriba.
  { poly: rect(U.salonW, V1.blockA, U1.vaultW, V1.blockHall), floors: 2 },
  { poly: rect(U1.vaultW, V.gymTop, U.gymW, V.facade), floors: 1, roof: false },
];

// ==================================================================== ambientes

const L1: Room[] = [
  // --- Sobre Laprida ------------------------------------------------------
  {
    id: 'pasilloL1',
    name: 'Pasillo',
    caption: 'Toilette alumnos · lockers',
    poly: rect(U.dirDiv, V.corrS, U.east1, V.classTop),
    floor: 'ceramic',
    roofed: true,
  },
  // Cursos de la Planta Alta anotada a mano; 4° AC, del cartel del video.
  { id: 'aulaS1', name: 'Aula', caption: '4° AC', poly: rect(U.w, V.classTop, U1.aulas[0], V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaS2', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U1.aulas[0], V.classTop, U1.aulas[1], V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaS3', name: 'Aula', caption: '1° A · 5° B', poly: rect(U1.aulas[1], V.classTop, U1.aulas[2], V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaS4', name: 'Aula', caption: '2° C · 4° B', poly: rect(U1.aulas[2], V.classTop, U1.aulas[3], V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaS5', name: 'Aula', caption: '3° A · 3° B', poly: rect(U1.aulas[3], V.classTop, U1.aulas[4], V.facade), floor: 'ceramic', roofed: true },
  // Damas (sur) y Caballeros (norte), con sus puertas al pasillo este.
  { id: 'banosS', name: 'Sanitarios', caption: 'Damas · Caballeros', poly: rect(U1.aulas[4], V.classTop, U.east1, V.facade), floor: 'ceramic', roofed: true },
  {
    id: 'gerencia',
    name: 'Gerencia',
    poly: [[U.w, V.classTop], [U.dirDiv, V.classTop], [U.dirDiv, mcV(U.dirDiv)], [U.w, MC0]],
    floor: 'tile',
    roofed: true,
  },

  // --- Sobre el hall --------------------------------------------------------
  { id: 'secretaria', name: 'Preceptoría', caption: 'Secretaría nivel primario', poly: rect(U.east1, V1.secretaria, U1.trophyE, V.facade), floor: 'tile', roofed: true },
  { id: 'pasilloTrofeos', name: 'Pasillo', caption: 'Pasillo de los trofeos', poly: rect(U.east1, V1.trophyN, U1.trophyE, V1.secretaria), floor: 'tile', roofed: true },
  { id: 'aula6BD', name: 'Aula', caption: '6° BD', poly: rect(U1.trophyE, V1.sixth, U.salonW, V.facade), floor: 'tile', roofed: true },
  { id: 'aula6AC', name: 'Aula', caption: '6° AC', poly: rect(U1.trophyE, V1.trophyN, U.salonW, V1.sixth), floor: 'tile', roofed: true },
  { id: 'pasarela', name: 'Pasarela', caption: 'Pasarela al nivel secundario', poly: rect(U1.towerE, V1.walkN, U.salonW, V1.walkS), floor: 'rubber', roofed: true },

  // --- Edificio de bloque ---------------------------------------------------
  {
    id: 'pasilloBloque',
    name: 'Pasillo',
    caption: 'Edificio de bloque',
    poly: [[U.salonW, V.facade], [U1.blockCorr, V.facade], [U1.blockCorr, V1.blockHall], [U.gymW, V1.blockHall], [U.gymW, V1.blockA], [U.salonW, V1.blockA]],
    floor: 'ceramic',
    roofed: true,
  },
  { id: 'aulaBloqueD', name: 'Aula', caption: '3° C', poly: rect(U1.blockCorr, V1.blockCD, U.gymW, V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaBloqueC', name: 'Aula', caption: '5° C', poly: rect(U1.blockCorr, V1.blockHall, U.gymW, V1.blockCD), floor: 'ceramic', roofed: true },
  { id: 'aulaBloqueA', name: 'Aula', caption: '2° A', poly: rect(U.salonW, V.gymTop, U1.aulaTaller, V1.blockA), floor: 'ceramic', roofed: true },
  { id: 'aulaTaller', name: 'Aula', caption: 'Aula taller emociones · psicología', poly: rect(U1.aulaTaller, V.gymTop, U.gymW, V1.blockA), floor: 'ceramic', roofed: true },

  // --- Ala oeste (sobre el pasillo oeste y el ala de Administración) ---------
  {
    id: 'escaleraOeste',
    name: 'Escalera',
    caption: 'Acceso a primer piso',
    poly: [[U.dirDiv, V.corrS], [U1.stairE, V.corrS], [U1.stairE, V1.prS], [U1.prW, V1.prS], [U1.prW, V1.stairN], [U.dirDiv, V1.stairN]],
    floor: 'tile',
    roofed: true,
  },
  // La "PR" de la mano, en la cabecera de la escalera.
  { id: 'precepSec', name: 'Preceptoría', caption: 'Preceptoría secundaria', poly: rect(U1.prW, V1.stairN, U1.stairE, V1.prS), floor: 'ceramic', roofed: true },
  {
    id: 'pasilloOesteL1',
    name: 'Pasillo',
    poly: [[U1.stairE, V.corrS], [U.patioW, V.corrS], [U.patioW, V.nBlockS], [U.wingE, V.nBlockS], [U.wingE, V1.stairN], [U1.stairE, V1.stairN]],
    floor: 'ceramicTan',
    roofed: true,
  },
  {
    id: 'aulaSec',
    name: 'Aula',
    caption: '4° E · 6° B',
    poly: [[U.dirDiv, V1.stairN], [U.wingE, V1.stairN], [U.wingE, V1.aulaSec], mc(V1.aulaSec), [U.dirDiv, mcV(U.dirDiv)]],
    floor: 'ceramic',
    roofed: true,
  },
  {
    id: 'dirSec',
    name: 'Dirección',
    caption: 'Dirección nivel secundario',
    poly: [mc(V1.aulaSec), [U.wingE, V1.aulaSec], [U.wingE, V1.northCorr], mc(V1.northCorr)],
    floor: 'tile',
    roofed: true,
  },

  // --- Sector nuevo: lado norte del patio y el triángulo del fondo ----------
  { id: 'pasilloNorteL1', name: 'Pasillo', caption: 'Sector nuevo', poly: rect(U.wingE, V1.northCorr, U.bufW, V.nBlockS), floor: 'ceramic', roofed: true },
  // En L: en la fila del pasillo tiene el ancho de la mano y, al fondo, sigue
  // hasta el muro de los baños como en el CAD (el conducto arranca recién ahí).
  {
    id: 'bilingue',
    name: 'Aula',
    caption: 'Bilingual classroom · 6° A / 2° B',
    poly: [[U.epW, V1.northCorr], [U1.bil, V1.northCorr], [U1.bil, V1.ductS], [U.epE, V1.ductS], [U.epE, V1.northRow], mc(V1.northRow), [U.epW, BIL_SW]],
    floor: 'ceramic',
    roofed: true,
  },
  { id: 'aula6C', name: 'Aula', caption: '6° C', poly: rect(U1.bil, V1.ductS, U1.c6, V1.northCorr), floor: 'ceramic', roofed: true },
  // El "Aula" sin curso de la mano: el video vio la biblioteca en este sector.
  { id: 'biblioteca', name: 'Biblioteca', poly: rect(U1.c6, V1.ductS, U.bufW, V1.northCorr), floor: 'ceramic', roofed: true },
  { id: 'banosN', name: 'Sanitarios', caption: 'Toilette alumnos', poly: rect(U.epE, V1.northRow, U1.prBil, V1.ductN), floor: 'ceramic', roofed: true },
  { id: 'prBil', name: 'Prof. bilingüe', poly: rect(U1.prBil, V1.northRow, U.bufW, V1.ductN), floor: 'ceramic', roofed: true },
  // Sobre Tecnología, en la punta del predio.
  { id: 'aulaVertice', name: 'Aula', poly: [mc(V1.northRow), [U.bufW, V1.northRow], rear(U.bufW), APEX], floor: 'ceramic', roofed: true },
  { id: 'aula4A', name: 'Aula', caption: '4° A', poly: rect(U.bufW, V1.northRow, U.east1, V.nBlockS), floor: 'ceramic', roofed: true },
  { id: 'aulaN2', name: 'Aula', poly: [[U.bufW, V1.northRow], [U.east1, V1.northRow], rear(U.east1), rear(U.bufW)], floor: 'ceramic', roofed: true },
  {
    id: 'aulaNE',
    name: 'Aula',
    poly: [[U.east1, V1.neS], [U1.neE, V1.neS], rear(U1.neE), rear(U1.neW), [U1.neW, V1.neL], [U.east1, V1.neL]],
    floor: 'ceramic',
    roofed: true,
  },

  // --- Columna sobre el comedor ---------------------------------------------
  { id: 'galeria', name: 'Galería', caption: 'Galería sobre el comedor', poly: rect(U1.gallery, V.nBlockS, U.bufW, V.corrS), floor: 'rubber', roofed: true },
  { id: 'aulaC1', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U.bufW, V1.emoc, U.east1, V.corrS), floor: 'ceramic', roofed: true },
  { id: 'aulaC2', name: 'Salón Emociones', caption: '5° A · 3° B', poly: rect(U.bufW, V.nBlockS, U.east1, V1.emoc), floor: 'ceramic', roofed: true },
];

const L2: Room[] = [
  // La mano lo llama "Salón de los Espejos 2do Piso"; el video, aula de danzas.
  { id: 'aulaDanzas', name: 'Salón de los espejos (2° piso)', caption: 'Aula de danzas', poly: rect(U1.vaultW, V1.blockHall, U.gymW, V1.danceS), floor: 'dance', roofed: true },
  { id: 'hallDanzas', name: 'Hall', caption: 'Acceso a segundo piso', poly: rect(U.salonW, V1.blockA, U.gymW, V1.blockHall), floor: 'ceramic', roofed: true },
];

export const UPPER_ROOMS: readonly Room[] = [...roomsOn(1, L1), ...roomsOn(2, L2)];

// ======================================================================== muros

/** Ventanas de la fachada alta sobre Laprida, medidas en la toma de 0:00–0:08. */
const LAPRIDA_WEST: Op[] = [
  [0.29, 2.01, 'window', 1.25, 2.28],
  [3.27, 5.0, 'window', 1.25, 2.28],
  [6.06, 7.77, 'window', 1.25, 2.28],
  [8.99, 10.71, 'window', 1.25, 2.28],
];
/** Tramo este: ventanas más altas y pretil 0,75 m más alto (el escalón del remate en u ≈ 11,1). */
const LAPRIDA_EAST: Op[] = [
  [12.21, 13.81, 'window', 2.05, 2.91],
  [15.61, 17.24, 'window', 2.05, 2.91],
  [19.11, 20.78, 'window', 2.05, 2.91],
  // Corrida 16 cm al oeste: terminaba en 24,27, dentro del tabique S4/S5.
  [22.42, 24.11, 'window', 2.05, 2.91],
  [26.05, 27.7, 'window', 2.05, 2.91],
  [29.56, 31.23, 'window', 2.05, 2.91],
];

/** Alto de los muros del primer piso de la fachada (el tramo este remata más alto). */
export const CREST = { west: 3.5, east: 4.3, step: 11.1 } as const;

/** Muro de ladrillo pintado a la cal por fuera. */
const brick = (w: Wall): Wall => ({ ...w, ext: 'brickWhite' });

/** Ventana interior de un aula al pasillo. */
const inner = (a: number, b: number): Op => [a, b, 'window', 1.0, 2.1];
/** Puerta simple de aluminio con marco (las de las aulas del primer piso). */
const door = (a: number, b: number): Op => [a, b, 'door', undefined, undefined, 'frame'];
/**
 * Ventanas en tira de la galería roja, entre montantes cada ~1,4 m, de punta
 * a punta del voladizo sin meterse en los muros del patio que llegan a sus
 * extremos.
 */
function galleryRibbon(): Op[] {
  const out: Op[] = [];
  const a = V.corrS - 0.2;
  const b = V.nBlockS + 0.2;
  const n = Math.round((a - b) / 1.4);
  const pitch = (a - b) / n;
  for (let k = 0; k < n; k++) {
    const v = a - k * pitch;
    out.push([v, v - pitch + 0.08, 'window', 1.15, 2.1, undefined, 'louvre']);
  }
  return out;
}

const W1: Wall[] = [
  // --- Aulas sobre Laprida -------------------------------------------------
  { ...hw(V.facade, U.w, CREST.step, 'ext', LAPRIDA_WEST, CREST.west) },
  { ...hw(V.facade, CREST.step, U.east1, 'ext', LAPRIDA_EAST, CREST.east) },
  // Testero oeste hasta la punta de la Gerencia: la ventana de 4° AC a Miguel Cané.
  vw(U.w, MC0, V.facade, 'ext', [[-4.3, -2.7, 'window']]),
  // Frente de las aulas: puerta y paño vidriado alto en cada una. 4° AC se
  // entra sólo por la Gerencia (el CAD no le dibuja puerta al pasillo).
  hw(V.classTop, U.w, U.east1, 'int', [
    door(3.9, 4.8),
    inner(6.0, 8.9),
    door(9.6, 10.5),
    door(12.95, 13.85),
    inner(14.4, 17.6),
    inner(18.7, 21.5),
    door(22.0, 22.9),
    door(24.6, 25.5),
    inner(26.0, 28.8),
  ]),
  ...U1.aulas.map((u) => vw(u, V.classTop, V.facade)),
  hw(V1.banosDiv, U1.aulas[4], U.east1),
  // Lado del patio del pasillo de lockers: ventanas altas sobre los lockers.
  brick(hw(V.corrS, U.patioW, U1.gallery, 'ext', [
    [15.3, 17.3, 'window', 1.85, 2.6],
    [17.9, 19.9, 'window', 1.85, 2.6],
    [20.5, 22.5, 'window', 1.85, 2.6],
    [23.1, 25.1, 'window', 1.85, 2.6],
  ])),
  hw(V.corrS, U.bufW, U.east1, 'int'),

  // --- Miguel Cané: Gerencia, aula 4° E · 6° B y Dirección -----------------
  seg([U.w, MC0], mc(V1.northCorr), 'ext', [
    [-9.0, -10.4, 'window'],
    [-12.8, -14.2, 'window'],
    [-19.2, -20.6, 'window'],
    [-22.2, -23.6, 'window'],
  ]),
  // Gerencia: puerta doble al pasillo de lockers; detrás, la caja de la escalera y el aula.
  vw(U.dirDiv, V.classTop, mcV(U.dirDiv), 'int', [[-6.5, -8.3, 'double', undefined, undefined, 'frame']]),

  // --- Escalera del ala oeste, PR y pasillo oeste ---------------------------
  hw(V1.stairN, U.dirDiv, U.wingE, 'int', [[10.6, 12.1, 'double', undefined, undefined, 'frame']]),
  vw(U1.prW, V1.prS, V1.stairN),
  hw(V1.prS, U1.prW, U1.stairE),
  // Puerta de 0,9 m centrada entre la biblioteca (sur) y el escritorio
  // (norte): más al sur, el cuarto de 1,34 m quedaba sin lugar para entrar.
  vw(U1.stairE, V1.prS, V1.stairN, 'int', [door(-11.05, -11.95)]),
  hw(V1.aulaSec, miguelCaneU(V1.aulaSec), U.wingE),
  // Hacia el pasillo oeste: paño vidriado del aula y puerta doble de la Dirección.
  vw(U.wingE, V1.stairN, V1.northCorr, 'int', [
    inner(-13.6, -16.6),
    [-19.3, -21.2, 'double', undefined, undefined, 'frame'],
  ]),
  // Fondo de la Dirección: sobre el techo del nicho de planta baja.
  hw(V1.northCorr, miguelCaneU(V1.northCorr), U.wingE, 'ext'),
  // Fachada del pasillo oeste al patio central: ventanas enrejadas.
  brick(vw(U.patioW, V.corrS, V.nBlockS, 'ext', [
    [-10.0, -11.4, 'window'],
    [-13.4, -14.8, 'window'],
    [-16.8, -18.2, 'window'],
    [-20.2, -21.6, 'window'],
  ])),

  // --- Sobre el hall --------------------------------------------------------
  // Fachada del portal: tres ventanas enrejadas con cortinas violetas; el
  // frente del portal sobresale y las enmarca (ver SchoolBuilder.portal).
  hw(V.facade, U.east1, U.salonW, 'ext', PORTAL_WINDOWS.map(([a, b]): Op => [a, b, 'window', 1.45, 2.85, undefined, 'whiteBars'])),
  // Fondo del pasillo este: puerta de aluminio y ventanilla a la PR.
  hw(V1.secretaria, U.east1, U1.trophyE, 'int', [door(32.72, 33.6), [34.2, 35.0, 'window', 0.96, 2.08]]),
  // Lado oeste del pasillo este: Damas, Caballeros y la boca del pasillo de lockers.
  vw(U.east1, V.facade, V.corrS, 'int', [
    door(-2.2, -3.1),
    door(-3.45, -4.35),
    // Sin meterse en los muros del pasillo que llegan a sus costados.
    [-6.3, -8.42, 'pass'],
  ]),
  // Puerta del aula al pasillo este (la del CAD, junto a la boca del pasillo de lockers).
  vw(U.east1, V.corrS, V1.trophyN, 'int', [door(-8.8, -9.7)]),
  // Lado este: ventana a 6° BD, sus puertas, las pizarras verdes y el ventanal de 6° AC.
  vw(U1.trophyE, V.facade, V1.trophyN, 'int', [
    inner(-2.6, -4.4),
    door(-5.3, -6.2),
    door(-7.1, -8.0),
    inner(-10.05, -12.2),
  ]),
  hw(V1.sixth, U1.trophyE, U.salonW),
  // Muro norte de 6° AC hacia la pasarela: ciego, con las condensadoras.
  hw(V1.trophyN, U1.trophyE, U.salonW, 'ext'),
  // Pasarela vidriada: paños de aluminio blanco a los dos lados, sin rejas.
  {
    ...hw(V1.walkS, U1.towerE, U.salonW, 'ext', [[U1.towerE + 0.29, U.salonW - 0.29, 'window', 0.9, 2.35, undefined, 'none']], 2.65),
    ext: 'black',
  },
  {
    ...hw(V1.walkN, U1.towerE, U.salonW, 'ext', [[U1.towerE + 0.29, U.salonW - 0.29, 'window', 0.9, 2.35, undefined, 'none']], 2.65),
    ext: 'black',
  },

  // --- Edificio de bloque ---------------------------------------------------
  { ...hw(V.facade, U.salonW, U1.vaultW, 'ext', [[41.0, 42.3, 'window', 1.0, 2.2, undefined, 'mesh']]), ext: 'brickWhite' },
  {
    ...hw(V.facade, U1.vaultW, U.gymW, 'ext', [
      [45.0, 46.6, 'window', 1.0, 2.2, undefined, 'mesh'],
      [47.6, 49.2, 'window', 1.0, 2.2, undefined, 'mesh'],
    ], 3.9),
    ext: 'brickWhite',
  },
  // Testero oeste: al hall/6° (interior), la pasarela y el patio este.
  vw(U.salonW, V.facade, V1.trophyN),
  { ...vw(U.salonW, V1.trophyN, V1.walkS, 'ext'), ext: 'brickWhite' },
  // Puerta simple de 0,95 m: el tramo entre los dos muros de la pasarela no da
  // para dos hojas (la doble de 1,15 m se metía en los muros de los costados).
  vw(U.salonW, V1.walkS, V1.walkN, 'int', [[-13.75, -14.7, 'door', undefined, undefined, 'frame']]),
  {
    ...vw(U.salonW, V1.walkN, V.gymTop, 'ext', [
      [-15.5, -16.8, 'window', 1.0, 2.2, undefined, 'mesh'],
      [-18.2, -20.2, 'window', 1.0, 2.2, undefined, 'mesh'],
    ]),
    ext: 'brickWhite',
  },
  {
    ...hw(V.gymTop, U.salonW, U1.vaultW, 'ext', [[42.4, 43.8, 'window', 1.0, 2.2, undefined, 'mesh']]),
    ext: 'brickWhite',
  },
  {
    // Una ventana por aula: 2° A y el aula taller (la malla es cara en el visor).
    ...hw(V.gymTop, U1.vaultW, U.gymW, 'ext', [[47.4, 48.8, 'window', 1.0, 2.2, undefined, 'mesh']], 3.9),
    ext: 'brickWhite',
  },
  // Pasillo del bloque: frente vidriado del aula C (puerta toda de vidrio y
  // dos corredizas) y puerta del aula D.
  vw(U1.blockCorr, V.facade, V1.blockHall, 'int', [
    inner(-1.6, -4.4),
    [-5.8, -6.7, 'door', undefined, undefined, 'frame'],
    inner(-8.6, -9.9),
    inner(-10.4, -11.8),
    [-12.55, -13.45, 'door', undefined, undefined, 'glass'],
  ]),
  hw(V1.blockCD, U1.blockCorr, U.gymW),
  hw(V1.blockHall, U1.blockCorr, U.gymW),
  // Oficina vidriada bajo el tramo B de la escalera de chapa (8:16–8:20): un
  // tabique bajo con ventana entre los tramos y su frente al hall, también
  // con ventana.
  hw(-16.15, U1.blockStair0, U1.blockStair1, 'int', [[44.5, 47.5, 'window', 0.9, 1.2]], 1.35),
  vw(U1.blockStair0, -16.15, V1.blockA, 'int', [[-16.3, -17.45, 'window', 1.0, 2.2]], 2.9),
  // Al fondo del hall de la escalera, 2° A y el aula taller (la mano la parte en dos).
  hw(V1.blockA, U.salonW, U.gymW, 'int', [door(40.85, 41.75), door(49.05, 49.95)]),
  vw(U1.aulaTaller, V1.blockA, V.gymTop),

  // --- Sector nuevo ---------------------------------------------------------
  // Frente al patio central: ladrillo pintado con ventanitas enrejadas
  // (antepecho ≈4,6 m sobre la vereda del patio, 2:01–2:07).
  brick(hw(V.nBlockS, U.patioW, U1.gallery, 'ext', [
    [15.6, 16.8, 'window', 1.3, 1.9],
    [18.3, 19.5, 'window', 1.3, 1.9],
    [21.0, 22.2, 'window', 1.3, 1.9],
    [23.7, 24.9, 'window', 1.3, 1.9],
  ])),
  // Frente vidriado del aula bilingüe y de 6° C; la biblioteca, abierta al
  // pasillo (6:16–6:23). La puerta de la bilingüe queda contra su tabique con
  // 6° C (la del CAD, en 17,0–18,4, cae ahora sobre él), y la mesada de
  // venecitas sigue entre las dos puertas.
  hw(V1.northCorr, U.wingE, U.bufW, 'int', [
    inner(13.0, 15.7),
    door(16.2, 17.1),
    door(19.75, 20.65),
    inner(21.0, 22.15),
    [24.2, 26.4, 'pass'],
  ]),
  // Cabecera del pasillo: puerta doble de 4° A.
  vw(U.bufW, V.nBlockS, V1.northCorr, 'int', [[-23.55, -24.95, 'double', undefined, undefined, 'frame']]),
  vw(U.bufW, V1.northCorr, rearV(U.bufW)),
  // Aula bilingüe: testero oeste sobre el techo del nicho (el CAD lo marca sin construir).
  vw(U.epW, V1.northCorr, BIL_SW, 'ext', [
    [-26.1, -27.7, 'window'],
    [-28.5, -30.1, 'window'],
  ]),
  // Punta sobre Miguel Cané: aula bilingüe y aula del vértice.
  seg([U.epW, BIL_SW], APEX, 'ext', [
    [-33.0, -34.4, 'window'],
    [-35.8, -37.2, 'window'],
  ]),
  // Medianera del fondo, del vértice al aula nueva (los vecinos del otro lado).
  seg(APEX, rear(U1.neE), 'ext'),
  // Tabiques de la fila del pasillo (los de la mano) y, al fondo, el de la
  // bilingüe con los baños y el conducto.
  vw(U1.bil, V1.northCorr, V1.ductS),
  vw(U1.c6, V1.northCorr, V1.ductS),
  vw(U.epE, V1.ductS, V1.northRow),
  // Conducto macizo entre la fila del pasillo y la del fondo; su muro sur
  // sigue hasta la bilingüe como fondo de 6° C.
  hw(V1.ductS, U1.bil, U.bufW),
  hw(V1.ductN, U.epE, U.bufW),
  vw(U1.prBil, V1.ductN, V1.northRow),
  // Fondo de la fila: el aula bilingüe, los baños y Prof. bilingüe abren al
  // aula del vértice, y 4° A al aula del fondo (así los dibuja el CAD).
  hw(V1.northRow, miguelCaneU(V1.northRow), U.east1, 'int', [door(17.6, 18.5), door(19.8, 20.7), door(23.2, 24.1), door(28.9, 29.8)]),

  // --- Sobre el comedor: galería roja y aulas ----------------------------
  // Chapa roja acanalada con una tira de ventanas con parasoles.
  { ...vw(U1.gallery, V.corrS, V.nBlockS, 'ext', galleryRibbon()), ext: 'redSheet' },
  // Frente de las aulas a la galería: marcos gris oscuro.
  vw(U.bufW, V.corrS, V.nBlockS, 'int', [
    door(-9.0, -9.9),
    [-10.6, -15.8, 'window', 1.0, 2.1, 'metalDark'],
    [-17.6, -21.0, 'window', 1.0, 2.1, 'metalDark'],
    door(-21.9, -22.8),
  ]),
  // Aula / Salón Emociones: tabique plegable de 3,7 m (el vano del CAD).
  hw(V1.emoc, U.bufW, U.east1, 'int', [[27.86, 31.57, 'pass']]),
  hw(V.nBlockS, U.bufW, U.east1),
  // Contra la torre de la escalera del hall.
  vw(U.east1, V1.trophyN, V.kiosk),
  // Lado del patio este: ventanas enrejadas sobre la escalera blanca.
  vw(U.east1, V.kiosk, V.nBlockS, 'ext', [
    [-15.4, -16.5, 'window'],
    [-17.5, -19.4, 'window'],
    [-20.6, -22.4, 'window'],
  ]),
  // 4° A hacia el patio este, contra el aula nueva y sobre la escalera exterior;
  // el aula del fondo, al balcón.
  vw(U.east1, V.nBlockS, V1.neS, 'ext', [[-23.6, -24.5, 'window']]),
  vw(U.east1, V1.neS, V1.neL),
  vw(U.east1, V1.neL, V1.northRow, 'ext', [[-28.4, -30.0, 'window']]),
  vw(U.east1, V1.northRow, rearV(U.east1), 'ext', [[-32.6, -33.8, 'window']]),

  // --- Aula nueva sobre el patio este ---------------------------------------
  hw(V1.neS, U.east1, U1.neE, 'ext', [
    [33.4, 35.0, 'window'],
    [36.2, 37.8, 'window'],
  ]),
  vw(U1.neE, V1.neS, rearV(U1.neE), 'ext', [[-27.6, -29.2, 'window']]),
  hw(V1.neL, U.east1, U1.neW, 'ext'),
  // Se entra desde el balcón donde llega la escalera exterior.
  vw(U1.neW, V1.neL, rearV(U1.neW), 'ext', [door(-33.25, -34.25)]),
];

/** Segundo piso: aula de danzas y su hall, bajo la bóveda del polideportivo. */
const W2: Wall[] = [
  // Testero norte del aula: puerta doble y dos ventanas a la escalera.
  hw(V1.blockHall, U1.vaultW, U.gymW, 'int', [
    [44.9, 46.3, 'double', undefined, undefined, 'frame'],
    [47.0, 48.6, 'window', 1.0, 2.0],
  ]),
  // Testero sur: puerta corrediza vidriada al bajo de la bóveda, cerrada.
  // Como 'door' era un vano transitable que no llevaba a ningún ambiente (el
  // constructor dibuja abiertas las puertas sin juego): una puerta falsa.
  hw(V1.danceS, U1.vaultW, U.gymW, 'int', [[46.0, 47.0, 'window', 0.05, 1.95, 'frame']], 2.1),
  // Remate de la escalera (tres plantas).
  hw(V1.blockHall, U.salonW, U1.vaultW, 'ext', [[42.4, 43.6, 'window']]),
  vw(U.salonW, V1.blockHall, V1.blockA, 'ext', [[-14.6, -16.0, 'window']]),
  hw(V1.blockA, U.salonW, U1.vaultW, 'ext'),
  hw(V1.blockA, U1.vaultW, U.gymW, 'ext', [], 2.2),
];

export const UPPER_WALLS: readonly Wall[] = [...onLevel(1, W1), ...onLevel(2, W2)];

// =================================================================== escaleras

/**
 * Tramos y descansos de las plantas altas. Los que arrancan en planta baja
 * (primer tramo del hall, descanso de la torre, escalera blanca, primer tramo
 * y descanso del ala oeste, escalera exterior del patio este) están en
 * `SchoolLayout`; acá, los que salen de un descanso o de un piso alto.
 */
/** Segundo tramo del hall: su lado oeste (entre él y el hueco del primero queda la baranda). */
const HALL_F4_U0 = 34.05;
/** Lado este del hueco del primer tramo del hall. */
const HALL_VOID_E = 33.95;
/**
 * Arranque del segundo tramo del hall, dentro del descanso: con el largo del
 * plano (1,12 m) la huella daba 22 cm.
 */
const HALL_F4_V0 = -13.93;
/** Llegada del tramo de la pasarela. */
// En la grilla de 0,1 m: con 36,66 el hueco de la losa (marcado por el centro
// de la celda) seguía hasta 36,70 y dejaba una franja maciza de 4 cm justo en
// la llegada, que trababa a quien bajaba de la pasarela.
const WALK_F_U1 = 36.7;
/** Llegada del segundo tramo del ala oeste al piso alto. */
const WEST_F8_U1 = 9.0;

export const UPPER_STAIRS: readonly Stair[] = [
  // "Acceso al Nivel Secundario", segundo tramo: vuelve al sur desde el
  // descanso de la torre y desemboca en el pasillo este.
  // Los tramos que llegan entre muros van de cara a cara (no de eje a eje):
  // los escalones se metían 5 cm en el muro y arriba la franja libre era la
  // mitad del tramo dibujado.
  { u0: HALL_F4_U0, v0: HALL_F4_V0, u1: U1.towerE - SCHOOL.extT / 2, v1: V1.trophyN, dir: 'v+', y0: 2.45, y1: 3.3 },
  // Arranque de la pasarela: cinco escalones desde el descanso.
  { u0: U1.towerE, v0: V1.walkN + SCHOOL.extT / 2, u1: WALK_F_U1, v1: V1.walkS - SCHOOL.extT / 2, dir: 'u+', y0: 2.45, y1: 3.3 },
  // "Acceso a primer piso", segundo tramo: del descanso sube al este, sobre
  // la Preceptoría de primaria (el cielorraso en pendiente), entre las caras
  // de sus muros sur y norte.
  { u0: 7.15, v0: V.dirTop + SCHOOL.wallT / 2, u1: WEST_F8_U1, v1: V.corrS - SCHOOL.wallT / 2, dir: 'u+', y0: 2.2, y1: 3.3 },
  // "Acceso a segundo piso": escalera de chapa en U del edificio de bloque.
  { u0: U1.blockStair0, v0: -16.0, u1: U1.blockStair1, v1: -14.6, dir: 'u+', y0: 3.3, y1: 4.95 },
  { u0: U1.blockStair0, v0: V1.blockA + SCHOOL.wallT / 2, u1: U1.blockStair1, v1: -16.2, dir: 'u-', y0: 4.95, y1: 6.6 },
];

export const UPPER_LANDINGS: readonly Landing[] = [
  // Descanso de la escalera de chapa.
  { u0: U1.blockStair1, v0: V1.blockA, u1: U1.blockStair2, v1: -14.6, y: 4.95, hollow: true },
  // Balcón donde llega la escalera exterior del patio este, entre el bloque
  // norte y el aula nueva, hasta la cara de la medianera (que va en diagonal).
  { u0: U.east1, v0: rearV(U1.neW) + SCHOOL.extT / 2, u1: U1.neW, v1: -30.6, y: 3.3, hollow: true },
];

/** Huecos de losa de las escaleras de las plantas altas. */
export const UPPER_VOIDS: ReadonlyArray<Rect & { level: Level }> = [
  // Torre del hall entera: el descanso está a 2,45 m y con losa encima el
  // cielorraso quedaba a 0,77 m de la cabeza sobre el descanso y el segundo tramo.
  { u0: U.east1, v0: V.kiosk, u1: U1.towerE, v1: V1.trophyN, level: 1 },
  // Parte alta del primer tramo.
  { u0: U.east1, v0: V1.trophyN, u1: HALL_VOID_E, v1: V1.hallVoid, level: 1 },
  // Arranque de la pasarela.
  { u0: U1.towerE, v0: V1.walkN, u1: WALK_F_U1, v1: V1.walkS, level: 1 },
  // Escalera del ala oeste: al norte, el descanso y la parte alta del primer
  // tramo (hasta la PR); al sur, el descanso y el segundo tramo, hasta su llegada.
  { u0: U.dirDiv, v0: V1.stairN, u1: U1.prW, v1: V1.prS, level: 1 },
  { u0: U.dirDiv, v0: V1.prS, u1: WEST_F8_U1, v1: V.corrS, level: 1 },
  // Escalera de chapa.
  { u0: U1.blockStair0, v0: V1.blockA, u1: U1.blockStair2, v1: -14.6, level: 2 },
];

// ================================================================= equipamiento

/** Pupitres en filas mirando al pizarrón (`face`), con sus sillas. */
function desks(r: Rect, face: Facing, top: string, chair: string, cols: number, rows: number, kind: 'desk' | 'table' = 'desk'): Item[] {
  const out: Item[] = [];
  const alongU = face === 'n' || face === 's';
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = (i + 0.5) / cols;
      const b = (j + 0.5) / rows;
      const u = r.u0 + (r.u1 - r.u0) * (alongU ? a : b);
      const v = r.v0 + (r.v1 - r.v0) * (alongU ? b : a);
      const [w, d] = alongU ? [1.2, 0.5] : [0.5, 1.2];
      out.push({ ...item(kind, u, v, w, d, face), color: top });
      // Sillas del lado opuesto al pizarrón.
      const back = face === 'n' ? 0.45 : face === 's' ? -0.45 : 0;
      const side = face === 'e' ? -0.45 : face === 'w' ? 0.45 : 0;
      for (const k of [-0.3, 0.3]) {
        out.push({ ...item('chair', u + side + (alongU ? k : 0), v + back + (alongU ? 0 : k), 0.42, 0.42, face, false), color: chair });
      }
    }
  }
  return out;
}

/**
 * Equipamiento de pared de un aula: pizarra, proyector y parlante. `board`
 * es el centro de la pizarra, a 12 cm del eje de un muro interior (17 cm si
 * es exterior). El parlante, de 22 cm de fondo, se corre lo que hace falta
 * para apoyarse en el muro (antes quedaba 9 cm metido) y cuelga a 2,3 m: los
 * cielorrasos de estas plantas están a 2,7–2,85 m.
 */
function classKit(board: P, face: Facing, uc: number, vc: number, len = 2.4, spk = 1.6): Item[] {
  const alongV = face === 'e' || face === 'w';
  const fu = face === 'e' ? 1 : face === 'w' ? -1 : 0;
  const fv = face === 's' ? 1 : face === 'n' ? -1 : 0;
  return [
    item('board', board[0], board[1], alongV ? 0.04 : len, alongV ? len : 0.04, face, false),
    { ...item('projector', uc, vc, 0.36, 0.3, face, false), y: 2.6 },
    {
      ...item('speaker', board[0] + fu * 0.095 + (alongV ? 0 : spk), board[1] + fv * 0.095 + (alongV ? spk : 0), 0.26, 0.22, face, false),
      y: 2.3,
    },
  ];
}

/**
 * Aulas que el plano agrega y que el video no recorrió: sólo pizarra y
 * escritorio docente. El equipamiento son instancias que se dibujan en
 * todas las vistas: amueblarlas enteras pasaba el presupuesto del visor.
 */
function bareRoom(board: P, face: Facing, len: number, desk: P): Item[] {
  const alongV = face === 'e' || face === 'w';
  return [
    item('board', board[0], board[1], alongV ? 0.04 : len, alongV ? len : 0.04, face, false),
    alongV ? item('teacherDesk', desk[0], desk[1], 0.7, 1.3, face) : item('teacherDesk', desk[0], desk[1], 1.3, 0.7, face),
  ];
}

const I1: Item[] = [
  // Pasillo de lockers: lockers azul marino, negros y verde salvia bajo las
  // ventanas altas del patio y contra el aula del comedor (el paso a la
  // galería queda libre). Contra el muro exterior, de 30 cm, van más afuera.
  ...(
    [
      [16.3, 2.2],
      [18.9, 2.2],
      [21.5, 2.2],
      [24.1, 2.2],
      [28.6, 2.1],
      [30.75, 2.1],
    ] as const
  ).map(([u, w], k) => ({
    ...item('lockers', u, V.corrS + (u < U1.gallery ? 0.405 : 0.355), w, 0.5, 's'),
    color: (['navy', 'black', 'sage'] as const)[k % 3],
  })),
  item('extinguisher', 12.0, V.classTop - 0.19, 0.17, 0.17, 'n', false),
  item('extinguisher', 30.3, V.classTop - 0.19, 0.17, 0.17, 'n', false),
  // Baranda de malla roja sobre el hueco de la escalera del ala oeste, de la
  // Gerencia a la llegada del segundo tramo.
  { ...item('gate', (U.dirDiv + SCHOOL.wallT / 2 + WEST_F8_U1) / 2, V.corrS + 0.025, WEST_F8_U1 - U.dirDiv - SCHOOL.wallT / 2, 0.05, 's', true), color: 'red', h: 1.05 },

  // 4° AC: mesas grises con sillas rojas. Aula nivel secundario: bancos verdes.
  // Las aulas del primer piso tienen 6,2 m de fondo (el CAD): una fila menos.
  ...desks({ u0: 0.82, v0: -5.9, u1: 3.7, v1: -0.9 }, 'w', 'chalk', 'red', 2, 3, 'table'),
  // Como en el Aula 1: la pizarra entre la ventana a Miguel Cané y el rincón.
  // El parlante, del otro lado de la ventana (sobre el vidrio no se cuelga).
  ...classKit([U.w + 0.17, -5.2], 'e', 2.6, -3.2, 1.6, 3.3),
  ...desks({ u0: 6.6, v0: -5.3, u1: 10.6, v1: -1.2 }, 'w', 'chairGreen', 'sage', 2, 3),
  ...classKit([U1.aulas[0] + 0.12, -3.1], 'e', 8.5, -3.1),
  // Mesas amarillas con sillas grises.
  ...desks({ u0: 12.6, v0: -5.3, u1: 17.6, v1: -1.0 }, 'w', 'yellow', 'metal', 2, 3),
  ...classKit([U1.aulas[1] + 0.12, -3.1], 'e', 14.6, -3.1),
  // Mesas naranjas con sillas rojas (zócalo de madera).
  ...desks({ u0: 19.6, v0: -5.3, u1: 23.6, v1: -1.0 }, 'w', 'orange', 'red', 2, 3, 'table'),
  ...classKit([U1.aulas[2] + 0.12, -3.1], 'e', 21.4, -3.1),
  // Mesas rojas con sillas azul marino.
  // Dos filas: con tres, el respaldo de cada silla se metía en la mesa de atrás.
  ...desks({ u0: 25.6, v0: -5.6, u1: 28.4, v1: -1.0 }, 'w', 'red', 'navy', 2, 2, 'table'),
  ...classKit([U1.aulas[3] + 0.12, -3.1], 'e', 27.0, -3.1),
  // Damas y Caballeros: cubículo contra el muro del pasillo y mesada contra el tabique de las aulas.
  item('stall', 31.68, -0.8, 1.4, 1.2, 'w'),
  item('stall', 31.68, -5.25, 1.4, 1.2, 'w'),
  { ...item('sinkCounter', U1.aulas[4] + 0.375, -1.6, 0.55, 1.4, 'e'), color: 'board' },
  { ...item('sinkCounter', U1.aulas[4] + 0.375, -4.75, 0.55, 1.4, 'e'), color: 'board' },
  // Gerencia: escritorio de madera, biblioteca y split.
  { ...item('desk2', 3.3, -9.4, 1.4, 0.7, 's'), color: 'cherry' },
  { ...item('chair', 3.3, -10.0, 0.45, 0.45, 'n', false), color: 'metalDark' },
  { ...item('shelf', U.dirDiv - 0.3, -11.6, 0.4, 1.4, 'w'), color: 'board' },

  // Pasillo este: dispenser con el estante de trofeos encima (entre la puerta
  // de Caballeros y la boca del pasillo de lockers), dos sillas plásticas
  // frente a la PR, pizarras verdes y matafuego.
  item('waterCooler', U.east1 + 0.27, -5.1, 0.32, 0.32, 'e', false),
  { ...item('trophyShelf', U.east1 + 0.26, -5.3, 0.3, 0.85, 'e', false), y: 1.85 },
  item('extinguisher', U.east1 + 0.185, -6.0, 0.17, 0.17, 'e', false),
  item('plasticChair', 34.2, -2.45, 0.42, 0.42, 'n', false),
  item('plasticChair', 34.8, -2.45, 0.42, 0.42, 'n', false),
  ...[-8.4, -9.05, -9.7].map((v) => ({ ...item('wallPanel', U1.trophyE - 0.12, v, 0.03, 0.5, 'w', false), y: 1.4, h: 0.4, color: 'chairGreen' })),
  // Barandas sobre el hueco del primer tramo (sobre el canto de la losa).
  { ...item('gate', (U.east1 + SCHOOL.wallT / 2 + HALL_VOID_E + 0.05) / 2, V1.hallVoid + 0.025, HALL_VOID_E + 0.05 - U.east1 - SCHOOL.wallT / 2, 0.05, 's', true), color: 'red', h: 1.05 },
  { ...item('gate', HALL_VOID_E + 0.025, (V1.hallVoid + V1.trophyN) / 2, 0.05, V1.hallVoid - V1.trophyN, 'e', true), color: 'red', h: 1.05 },
  // PR: escritorio blanco con PC, biblioteca de cubos y split.
  { ...item('desk2', 34.45, -0.55, 1.2, 0.6, 's'), color: 'board' },
  // Biblioteca baja y corta, contra la fachada: más larga quedaba sobre el
  // eje de la puerta y no se podía entrar a un cuarto de 2 m.
  { ...item('shelf', U.east1 + SCHOOL.wallT / 2 + 0.175, -0.5, 0.35, 0.6, 'e'), color: 'board' },
  { ...item('ac', U.east1 + 0.21, -0.6, 0.22, 0.86, 'e', false), y: 2.35 },
  // 6° BD: mesas rojas en U con sillas azul marino. La U abre hacia la
  // pizarra (sobre el tabique de 6° AC): con el fondo bajo la pizarra no
  // quedaba lugar para el docente delante de ella.
  ...[36.4, 37.7, 39.0].map((u) => ({ ...item('table', u, -1.5, 1.2, 0.6), color: 'red' })),
  ...[-2.45, -3.65].flatMap((v) => [
    { ...item('table', 35.77, v, 0.6, 1.2), color: 'red' },
    { ...item('table', 40.1, v, 0.6, 1.2), color: 'red' },
  ]),
  ...[36.4, 37.7, 39.0].map((u) => ({ ...item('chair', u, -0.95, 0.42, 0.42, 'n', false), color: 'navy' })),
  ...[-2.45, -3.65].flatMap((v) => [
    { ...item('chair', 36.3, v, 0.42, 0.42, 'w', false), color: 'navy' },
    { ...item('chair', 39.55, v, 0.42, 0.42, 'e', false), color: 'navy' },
  ]),
  ...classKit([37.9, V1.sixth + 0.12], 's', 37.9, -3.0),
  // 6° AC.
  ...desks({ u0: 36.4, v0: -12.0, u1: 40.0, v1: -7.8 }, 'e', 'chairGreen', 'sage', 3, 3),
  ...classKit([U.salonW - 0.12, -9.9], 'w', 38.4, -9.9),
  // Equipos de aire colgados del muro norte de 6° AC, sobre el patio (4:28).
  ...[36.6, 38.9].map((u) => ({ ...item('condenser', u, V1.trophyN - 0.35, 0.8, 0.3, 'n', false), y: 0.6 })),

  // Galería roja: matafuego entre los paños.
  item('extinguisher', U.bufW - 0.19, -16.0, 0.17, 0.17, 'w', false),
  // Aula sobre el comedor: mesas amarillas mirando a la pizarra del muro del pasillo este.
  ...desks({ u0: 27.9, v0: -15.9, u1: 31.2, v1: -9.6 }, 'e', 'yellow', 'metal', 3, 2),
  ...classKit([U.east1 - 0.12, -12.4], 'w', 30.0, -12.4),
  // Salón Emociones: mesas naranjas.
  ...desks({ u0: 28.0, v0: -22.4, u1: 32.0, v1: -18.0 }, 'n', 'orange', 'red', 2, 3, 'table'),
  ...classKit([29.9, V.nBlockS + 0.12], 's', 29.9, -20.2),

  // Sector nuevo: mesada de venecitas con bachas y espejos en el pasillo,
  // entre las puertas del aula bilingüe y de 6° C.
  { ...item('sinkCounter', 18.975, V1.northCorr + 0.375, 1.2, 0.55, 's'), color: 'yellow' },
  item('extinguisher', 17.6, V.nBlockS - 0.235, 0.17, 0.17, 'n', false),
  // Aula bilingüe: mesas amarillas en grupos, cortinas blancas. Mira al norte,
  // a lo largo de la L: la pizarra en el muro del fondo y la luz de las
  // ventanas de Miguel Cané por la izquierda. El rincón del fondo queda libre
  // delante de la puerta al aula del vértice.
  ...desks({ u0: 12.9, v0: -30.6, u1: 16.4, v1: -26.2 }, 'n', 'yellow', 'metal', 2, 3, 'table'),
  ...classKit([15.1, V1.northRow + 0.12], 's', 15.1, -28.6),
  // 6° C: dos filas de bancos, sin tapar el barrido de su puerta (las
  // columnas se abren a los costados de la hoja).
  ...desks({ u0: 17.15, v0: -28.0, u1: 22.75, v1: -26.0 }, 'n', 'chairGreen', 'sage', 2, 2),
  ...classKit([19.9, V1.ductS + 0.12], 's', 19.9, -27.0, 2.0, -1.3),
  // Biblioteca: fichero rojo, estanterías contra el conducto y mesas con sillas azules.
  { ...item('filing', 23.9, V1.ductS + 0.375, 0.9, 0.55, 's'), h: 1.75 },
  { ...item('shelf', 24.95, V1.ductS + 0.3, 0.7, 0.4, 's'), color: 'board' },
  { ...item('shelf', 26.15, V1.ductS + 0.3, 1.1, 0.4, 's') },
  // Lejos del paso al pasillo norte (a 0,8 m tapaban casi todo el vano).
  ...[-26.95, -27.95].flatMap((v) => [
    { ...item('table', 24.9, v, 1.2, 0.8) },
    { ...item('chair', 24.1, v, 0.42, 0.42, 'e', false), color: 'blue' },
    { ...item('chair', 25.7, v, 0.42, 0.42, 'w', false), color: 'blue' },
  ]),
  // Baños: un cubículo y una mesada.
  item('stall', U1.prBil - 0.8, -30.65, 1.4, 1.2, 'w'),
  // Mesada contra el fondo: contra el muro oeste quedaba detrás de la puerta.
  { ...item('sinkCounter', U.epE + 0.58, -29.95 - SCHOOL.wallT / 2 - 0.275, 0.9, 0.55, 'n'), color: 'board' },
  // Prof. bilingüe.
  { ...item('desk2', 25.6, -30.45, 1.4, 0.6, 's'), color: 'board' },
  // 4° A: tres filas de bancos mirando al tabique del Salón Emociones.
  ...desks({ u0: 28.0, v0: -30.2, u1: 32.0, v1: -25.0 }, 's', 'yellow', 'metal', 2, 3),
  ...classKit([30.2, V.nBlockS - 0.12], 'n', 30.2, -27.6),
  ...bareRoom([U.bufW - 0.12, -34.2], 'w', 2.4, [25.4, -34.2]),
  ...bareRoom([U.bufW + 0.12, -33.6], 'e', 2.4, [28.3, -33.6]),
  ...bareRoom([U1.neW + 0.17, -29.5], 'e', 2.4, [35.6, -29.5]),

  // Ala oeste: escalera, PR, aula y Dirección de secundaria.
  // PR: escritorio blanco con monitor contra el fondo y biblioteca.
  { ...item('desk2', 9.57, V1.stairN + 0.4, 1.1, 0.6, 's'), color: 'board' },
  // Biblioteca contra el muro sur, en el rincón: contra el oeste, frente a
  // la puerta, el cuarto (1,34 m de ancho) quedaba sin lugar para entrar.
  { ...item('shelf', U1.prW + SCHOOL.wallT / 2 + 0.4, V1.prS - SCHOOL.wallT / 2 - 0.15, 0.8, 0.3, 'n'), color: 'board' },
  // Aula 4° E · 6° B: pizarra contra la Gerencia, dos bancos por fila.
  ...desks({ u0: 7.0, v0: -17.4, u1: 11.6, v1: -14.1 }, 'w', 'chairGreen', 'sage', 2, 3),
  ...classKit([U.dirDiv + 0.12, -15.2], 'e', 9.3, -15.6),
  // Dirección de secundaria: escritorio de madera y bibliotecas con biblioratos.
  { ...item('desk2', 9.6, -20.0, 1.5, 0.75, 's'), color: 'cherry' },
  { ...item('chair', 9.6, -20.6, 0.45, 0.45, 'n', false), color: 'metalDark' },
  // Contra el muro exterior del fondo (30 cm), sobre el techo del nicho.
  item('shelf', 10.9, V1.northCorr + 0.355, 1.4, 0.4, 's'),
  item('shelf', 9.0, V1.aulaSec - 0.3, 1.6, 0.4, 'n'),
  // Esquina del aula en el pasillo: columna forrada azul francia.
  { ...item('paddedColumn', 12.79, -13.27, 0.4, 0.4), color: 'blue', h: 2.75 },
  item('extinguisher', U.wingE + 0.185, -22.6, 0.17, 0.17, 'e', false),

  // Edificio de bloque: columnas rojas sobre la grilla del salón, lockers
  // gris oscuro en el pasillo, bancos de madera y ventilador.
  // Hasta el cielorraso de placas (2,7 m), no a través de él.
  ...[-8.3, -12.75].map((v) => ({ ...item('roundColumn', U.salonW + 0.37, v, 0.32, 0.32), color: 'red', h: 2.7 })),
  { ...item('roundColumn', U.gymW - 0.37, -12.75, 0.32, 0.32), color: 'red', h: 2.7 },
  ...[-9.6, -11.3].map((v) => ({ ...item('lockers', U.salonW + 0.33, v, 0.45, 1.6, 'e'), color: 'metalDark' })),
  ...desks({ u0: 44.0, v0: -7.2, u1: 49.6, v1: -0.8 }, 'n', 'timber', 'timber', 3, 3, 'table'),
  ...classKit([46.8, V1.blockCD + 0.12], 's', 46.8, -4.0),
  // Pizarra en el muro lleno del sur (el del pasillo tiene dos ventanas).
  ...desks({ u0: 44.0, v0: -13.4, u1: 49.6, v1: -9.0 }, 's', 'timber', 'chairGreen', 3, 3, 'table'),
  ...classKit([46.8, V1.blockCD - 0.12], 'n', 46.8, -10.7),
  ...desks({ u0: 42.0, v0: -20.4, u1: 45.5, v1: -18.0 }, 'n', 'timber', 'chairGreen', 2, 2, 'table'),
  ...bareRoom([U1.aulaTaller + 0.12, -19.2], 'e', 2.4, [46.85, -19.2]),
  item('extinguisher', U.salonW + 0.24, -17.15, 0.17, 0.17, 'e', false),
];

const I2: Item[] = [
  // Aula de danzas: espejos de pared y barra doble al oeste, barras sueltas
  // contra las ventanas al polideportivo, espejos de pie al sur, banco rojo
  // con percheros y mueble con el equipo de música.
  // 1,8 m de alto: con los 1,9 de siempre el borde pisaba 2 cm el antepecho
  // de las ventanas altas de encima (8,85) y dejaba una raya que titilaba.
  { ...item('mirror', U1.vaultW + 0.15, -8.4, 0.04, 9.4, 'e', false), h: 1.8 },
  { ...item('barre', U1.vaultW + 0.4, -8.4, 0.06, 9.0, 'e'), color: 'timber' },
  { ...item('barre', U.gymW - 0.6, -5.2, 0.06, 2.4, 'w'), color: 'metalDark' },
  { ...item('barre', U.gymW - 0.6, -9.6, 0.06, 2.4, 'w'), color: 'metalDark' },
  // A los dos lados de la puerta del aula (el del medio la tapaba).
  ...[45.2, 47.75, 48.85].map((u) => ({ ...item('mirror', u, V1.danceS - 0.35, 1.0, 0.05, 'n', false) })),
  // Perchero sobre el paño lleno junto a la ventana a la escalera (antes
  // colgaba a 26 cm del muro, delante del vidrio).
  item('coatBench', 49.4, -13.29, 1.5, 0.42, 's'),
  { ...item('drawers', 49.7, -12.15, 0.9, 0.5, 'w'), color: 'board', h: 1.0 },
  { ...item('speaker', 49.7, -12.15, 0.3, 0.3, 'w', false), y: 1.0 },
  { ...item('ac', 45.6, V1.blockHall + 0.215, 0.86, 0.22, 's', false), y: 2.45 },
  // Hall: matafuego sobre el cartel y baranda negra de la escalera de chapa.
  item('extinguisher', U.salonW + 0.24, -16.8, 0.17, 0.17, 'e', false),
  { ...item('gate', 46.0, -14.55, 3.2, 0.05, 's', true), color: 'metalDark', h: 1.05 },
  // El resto del canto del hueco: sobre el descanso (este y norte) y sobre
  // el pie del tramo A (oeste, junto a la llegada del tramo B), con caídas
  // de 1,65 y 3,3 m sin nada.
  { ...item('gate', 48.925, -16.025, 0.05, 2.85, 'e', true), color: 'metalDark', h: 1.05 },
  { ...item('gate', 48.25, -14.55, 1.3, 0.05, 's', true), color: 'metalDark', h: 1.05 },
  { ...item('gate', 44.375, -15.4, 0.05, 1.6, 'e', true), color: 'metalDark', h: 1.05 },
  // Tanque de agua sobre la azotea del remate.
  { ...item('waterTank', 43.0, -15.6, 1.3, 1.3, 's', false), y: 3.3 },
];

export const UPPER_ITEMS: readonly Item[] = [...itemsOn(1, I1), ...itemsOn(2, I2)];
