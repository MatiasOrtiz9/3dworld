import {
  U,
  V,
  hw,
  item,
  itemsOn,
  mc,
  miguelCaneU,
  onLevel,
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
 * No hay plano de la planta alta: esto sale del recorrido virtual de 2020 y
 * de la estructura de la planta baja. Lo que se ve en el video manda (qué
 * ambientes hay, cómo se llega, qué ven sus ventanas); donde el video no
 * alcanza se eligió lo más simple que sea coherente con eso, sin inventar
 * ambientes. Las referencias de tiempo (m:ss) son del recorrido.
 *
 * Recorrido de la planta alta, en resumen:
 * - "Acceso al Nivel Secundario" (0:19, 4:16–4:28): escalera en U desde el
 *   hall. El primer tramo sube al norte contra el muro oeste hasta un descanso
 *   en la caja que el plano dibuja al norte del hall; de ahí un tramo corto
 *   vuelve al sur y desemboca en el pasillo de los trofeos, y la pasarela
 *   vidriada sale hacia el este, al edificio de bloque.
 * - Pasillo de los trofeos (4:30–5:11): baja hacia Laprida y termina en la
 *   Secretaría de primaria, que mira a la calle por la ventana oeste del
 *   portal. Al este, 6° BD (sobre la fachada) y 6° AC.
 * - Pasillo de lockers (5:12–5:19), justo arriba del pasillo sur: lockers
 *   contra el lado del patio, ventanas altas, aulas sobre Laprida.
 * - Galería revestida en chapa roja sobre el comedor (5:20–5:31, 6:57–7:03),
 *   en voladizo sobre las columnas negras del patio oeste.
 * - Sector nuevo (5:32–6:56): cielorraso de placas, cerámico beige, aulas
 *   con frente vidriado, el aula bilingüe, la biblioteca con el fichero rojo,
 *   la mesada de venecitas del pasillo y los baños.
 * - Ala oeste, retirada de la fachada del patio (2:02–2:06): pasillo con
 *   ventanas enrejadas, Aula nivel secundario (7:12), Dirección (7:27) y
 *   Preceptoría (7:38) de secundaria, y la cabecera de la escalera "Acceso a
 *   primer piso" (7:44–7:58), que baja en U hasta el patio oeste.
 * - Edificio de bloque (8:08–8:42), sobre el Salón de los espejos: pasillo
 *   con columnas rojas y lockers, aulas de bloque a la vista, y la escalera
 *   de chapa "Acceso a segundo piso" hasta el Aula de danzas (8:44–9:16),
 *   que queda bajo la bóveda del polideportivo y mira adentro por tres
 *   ventanas con malla.
 */

/** Líneas de las plantas altas (u). */
export const U1 = {
  /** Divisiones de las aulas sobre Laprida (por el ritmo de las ventanas de la fachada). */
  aulas: [5.5, 11.1, 18.2, 25.3, 29.3] as const,
  /** El ala oeste alta está retirada de la fachada del patio (el pasillo oeste es de una planta). */
  wing: 13.1,
  /** Pasillo del ala oeste alta: su lado oeste. */
  wingCorr: 11.3,
  /** Hueco de la escalera del ala oeste. */
  stairW: 8.0,
  /** Galería roja: voladizo de 1,8 m sobre el patio oeste. */
  gallery: 26.6,
  /** Pasillo de los trofeos: su lado este. */
  trophyE: 35.75,
  /** Torre de la escalera del hall (la caja al norte del hall). */
  towerE: 35.6,
  /** Pasillo del edificio de bloque: su lado este. */
  blockCorr: 44.2,
  /** Borde oeste de la bóveda: muro del aula de danzas con los espejos. */
  vaultW: 44.0,
  /** Escalera de chapa del edificio de bloque. */
  blockStair0: 44.4,
  blockStair1: 47.6,
  blockStair2: 48.9,
  /** Aula bilingüe: su lado este (llega la escalera principal del bloque norte). */
  bilingual: 18.9,
  /** Baños del sector nuevo: su lado oeste. */
  bathN: 26.9,
} as const;

/** Líneas de las plantas altas (v). */
export const V1 = {
  /** Secretaría de primaria: su lado norte. */
  secretaria: -3.5,
  /** Entre 6° BD y 6° AC. */
  sixth: -6.0,
  /** Lado norte de 6° AC y del pasillo de los trofeos (llega el segundo tramo). */
  trophyN: -12.1,
  /** Pasarela vidriada. */
  walkS: -13.6,
  walkN: -14.85,
  /** Hueco del primer tramo de la escalera del hall en el piso alto. */
  hallVoid: -10.8,
  /** Bloque: entre las aulas D (sur) y C. */
  blockCD: -7.8,
  /** Bloque: aula C / hall de la escalera. */
  blockHall: -13.6,
  /** Bloque: hall de la escalera / aula A. */
  blockA: -17.6,
  /** Testero sur del aula de danzas (más al sur la bóveda baja demasiado). */
  danceS: -3.1,
  /** Pasillo del sector nuevo: su lado norte. */
  northCorr: -25.3,
  /** Baños del sector nuevo: su lado sur. */
  bathN: -26.5,
  /** Ala oeste alta: Preceptoría / Aula nivel secundario. */
  precep: -17.6,
  /** Cabecera de la escalera del ala oeste: su lado norte (el muro del hallOeste). */
  stairN: -13.8,
} as const;

// =================================================================== volúmenes

/**
 * Volúmenes con planta alta. El polideportivo y el hall siguen siendo de una
 * sola cubierta salvo donde el video muestra pisos encima.
 */
export const UPPER_VOLUMES: readonly Volume[] = [
  // Aulas sobre Laprida y el pasillo de lockers.
  { poly: [[U.w, V.facade], [U.east1, V.facade], [U.east1, V.corrS], mc(V.corrS), [U.w, V.classTop]], floors: 1 },
  // Sobre el hall: Secretaría, 6° BD, 6° AC y el pasillo de los trofeos.
  { poly: rect(U.east1, V1.trophyN, U.salonW, V.facade), floors: 1 },
  // Torre de la escalera del hall: muros propios de dos plantas, sin cerramiento.
  // Sin cornisa: sus aristas cruzan los dos vanos de dos plantas (pasarela
  // y escalera blanca) y se metían 34 cm en el aula C1.
  { poly: rect(U.east1, V.kiosk, U1.towerE, V1.trophyN), floors: 1, shell: false, cornice: false },
  // Edificio de bloque: la franja oeste tiene azotea; el resto queda bajo la
  // bóveda del polideportivo, que se prolonga hasta el muro de los espejos.
  { poly: rect(U.salonW, V1.blockHall, U1.vaultW, V.facade), floors: 1 },
  { poly: rect(U.salonW, V.gymTop, U1.vaultW, V1.blockA), floors: 1 },
  // Remate de la escalera de chapa: tres plantas, con el tanque de agua arriba.
  { poly: rect(U.salonW, V1.blockA, U1.vaultW, V1.blockHall), floors: 2 },
  { poly: rect(U1.vaultW, V.gymTop, U.gymW, V.facade), floors: 1, roof: false },
  // Ala oeste, retirada de la fachada del patio.
  { poly: [mc(V.corrS), [U1.wing, V.corrS], [U1.wing, V.corrN], mc(V.corrN)], floors: 1 },
  // Bloque norte: sector nuevo.
  { poly: [mc(V.corrN), [U.east1, V.corrN], [U.east1, V.nBlockN], mc(V.nBlockN)], floors: 1 },
  // Comedor con la galería roja en voladizo.
  { poly: rect(U1.gallery, V.corrN, U.east1, V.corrS), floors: 1 },
];

// ==================================================================== ambientes

const L1: Room[] = [
  {
    id: 'pasilloL1',
    name: 'Pasillo',
    caption: 'Toilette alumnos · lockers',
    poly: [[U.w, V.classTop], [U.east1, V.classTop], [U.east1, V.corrS], mc(V.corrS)],
    floor: 'ceramic',
    roofed: true,
  },
  { id: 'aulaS1', name: 'Aula', caption: '4° AC', poly: rect(U.w, V.classTop, U1.aulas[0], V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaS2', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U1.aulas[0], V.classTop, U1.aulas[1], V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaS3', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U1.aulas[1], V.classTop, U1.aulas[2], V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaS4', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U1.aulas[2], V.classTop, U1.aulas[3], V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaS5', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U1.aulas[3], V.classTop, U1.aulas[4], V.facade), floor: 'ceramic', roofed: true },
  { id: 'banosS', name: 'Sanitarios', caption: 'Toilette alumnos', poly: rect(U1.aulas[4], V.classTop, U.east1, V.facade), floor: 'ceramic', roofed: true },

  // Sobre el hall.
  { id: 'secretaria', name: 'Secretaría', caption: 'Secretaría nivel primario', poly: rect(U.east1, V1.secretaria, 36.25, V.facade), floor: 'tile', roofed: true },
  { id: 'pasilloTrofeos', name: 'Pasillo', caption: 'Pasillo de los trofeos', poly: rect(U.east1, V1.trophyN, U1.trophyE, V1.secretaria), floor: 'tile', roofed: true },
  {
    id: 'aula6BD',
    name: 'Aula',
    caption: '6° BD',
    poly: [[36.25, V.facade], [U.salonW, V.facade], [U.salonW, V1.sixth], [U1.trophyE, V1.sixth], [U1.trophyE, V1.secretaria], [36.25, V1.secretaria]],
    floor: 'tile',
    roofed: true,
  },
  { id: 'aula6AC', name: 'Aula', caption: '6° AC', poly: rect(U1.trophyE, V1.trophyN, U.salonW, V1.sixth), floor: 'tile', roofed: true },
  { id: 'pasarela', name: 'Pasarela', caption: 'Pasarela al nivel secundario', poly: rect(U1.towerE, V1.walkN, U.salonW, V1.walkS), floor: 'rubber', roofed: true },

  // Edificio de bloque.
  {
    id: 'pasilloBloque',
    name: 'Pasillo',
    caption: 'Edificio de bloque',
    poly: [[U.salonW, V.facade], [U1.blockCorr, V.facade], [U1.blockCorr, V1.blockHall], [U.gymW, V1.blockHall], [U.gymW, V1.blockA], [U.salonW, V1.blockA]],
    floor: 'ceramic',
    roofed: true,
  },
  { id: 'aulaBloqueD', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U1.blockCorr, V1.blockCD, U.gymW, V.facade), floor: 'ceramic', roofed: true },
  { id: 'aulaBloqueC', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U1.blockCorr, V1.blockHall, U.gymW, V1.blockCD), floor: 'ceramic', roofed: true },
  { id: 'aulaBloqueA', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U.salonW, V.gymTop, U.gymW, V1.blockA), floor: 'ceramic', roofed: true },

  // Ala oeste.
  {
    id: 'dirSec',
    name: 'Dirección',
    caption: 'Dirección nivel secundario',
    poly: [mc(V.corrS), [U1.stairW, V.corrS], [U1.stairW, V1.stairN], mc(V1.stairN)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'escaleraOeste', name: 'Escalera', caption: 'Acceso a primer piso', poly: rect(U1.stairW, V1.stairN, U1.wingCorr, V.corrS), floor: 'tile', roofed: true },
  { id: 'pasilloOesteL1', name: 'Pasillo', poly: rect(U1.wingCorr, V.corrN, U1.wing, V.corrS), floor: 'ceramicTan', roofed: true },
  {
    id: 'precepSec',
    name: 'Preceptoría',
    caption: 'Preceptoría secundaria',
    poly: [mc(V1.stairN), [U1.wingCorr, V1.stairN], [U1.wingCorr, V1.precep], mc(V1.precep)],
    floor: 'ceramic',
    roofed: true,
  },
  {
    id: 'aulaSec',
    name: 'Aula',
    caption: 'Aula nivel secundario',
    poly: [mc(V1.precep), [U1.wingCorr, V1.precep], [U1.wingCorr, V.corrN], mc(V.corrN)],
    floor: 'ceramic',
    roofed: true,
  },

  // Bloque norte: sector nuevo.
  {
    id: 'pasilloNorteL1',
    name: 'Pasillo',
    caption: 'Sector nuevo',
    poly: [mc(V.corrN), [U.east1, V.corrN], [U.east1, V1.bathN], [U1.bathN, V1.bathN], [U1.bathN, V1.northCorr], mc(V1.northCorr)],
    floor: 'ceramic',
    roofed: true,
  },
  // Rellano donde llega la escalera principal, junto al aula bilingüe.
  { id: 'rellanoNorte', name: 'Pasillo', caption: 'Sector nuevo', poly: rect(22.0, V.nBlockN, 23.3, V1.northCorr), floor: 'ceramic', roofed: true },
  {
    id: 'bilingue',
    name: 'Aula',
    caption: 'Bilingual classroom',
    poly: [mc(V1.northCorr), [U1.bilingual, V1.northCorr], [U1.bilingual, V.nBlockN], mc(V.nBlockN)],
    floor: 'ceramic',
    roofed: true,
  },
  { id: 'escaleraNorteL1', name: 'Escalera', poly: rect(23.3, V.nBlockN, U1.bathN, V1.northCorr), floor: 'tile', roofed: true },
  // Biblioteca con el fichero rojo, abierta al pasillo (6:16–6:23).
  { id: 'biblioteca', name: 'Biblioteca', poly: rect(U1.bilingual, V.nBlockN, 22.0, V1.northCorr), floor: 'ceramic', roofed: true },
  { id: 'banosN', name: 'Sanitarios', caption: 'Toilette alumnos', poly: rect(U1.bathN, V.nBlockN, U.east1, V1.bathN), floor: 'ceramic', roofed: true },

  // Sobre el comedor.
  { id: 'galeria', name: 'Galería', caption: 'Galería sobre el comedor', poly: rect(U1.gallery, V.corrN, U.bufW, V.corrS), floor: 'rubber', roofed: true },
  { id: 'aulaC1', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U.bufW, -16.4, U.east1, V.corrS), floor: 'ceramic', roofed: true },
  { id: 'aulaC2', name: 'Aula', caption: 'Aula nivel secundario', poly: rect(U.bufW, V.corrN, U.east1, -16.4), floor: 'ceramic', roofed: true },
];

const L2: Room[] = [
  { id: 'aulaDanzas', name: 'Aula de danzas', caption: 'Segundo piso', poly: rect(U1.vaultW, V1.blockHall, U.gymW, V1.danceS), floor: 'dance', roofed: true },
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
  [22.58, 24.27, 'window', 2.05, 2.91],
  [26.05, 27.7, 'window', 2.05, 2.91],
  [29.56, 31.23, 'window', 2.05, 2.91],
];

/** Alto de los muros del primer piso de la fachada (el tramo este remata más alto). */
export const CREST = { west: 3.5, east: 4.3, step: 11.1 } as const;

/** Muro de ladrillo pintado a la cal por fuera. */
const brick = (w: Wall): Wall => ({ ...w, ext: 'brickWhite' });

/** Ventana interior de un aula al pasillo. */
const inner = (a: number, b: number): Op => [a, b, 'window', 1.0, 2.1];
/** Ventanas en tira de la galería roja, entre montantes cada 1,4 m. */
function galleryRibbon(): Op[] {
  const out: Op[] = [];
  for (let v = -9.55; v > -23.3; v -= 1.4) out.push([v, Math.max(v - 1.32, -23.3), 'window', 1.15, 2.1, undefined, 'louvre']);
  return out;
}

const W1: Wall[] = [
  // --- Aulas sobre Laprida -------------------------------------------------
  { ...hw(V.facade, U.w, CREST.step, 'ext', LAPRIDA_WEST, CREST.west) },
  { ...hw(V.facade, CREST.step, U.east1, 'ext', LAPRIDA_EAST, CREST.east) },
  vw(U.w, V.classTop, V.facade, 'ext', [[-4.3, -2.7, 'window']]),
  // Punta oeste del pasillo de lockers sobre el ochavo: ventana enrejada.
  seg([U.w, V.classTop], mc(V.corrS), 'ext', [[-7.6, -8.9, 'window']]),
  // Frente de las aulas al pasillo: puerta y paño vidriado alto en cada una.
  hw(V.classTop, U.w, U.east1, 'int', [
    inner(1.0, 3.0),
    [4.2, 5.1, 'door', undefined, undefined, 'frame'],
    inner(6.5, 8.8),
    [9.8, 10.7, 'door', undefined, undefined, 'frame'],
    inner(12.5, 15.5),
    [16.9, 17.8, 'door', undefined, undefined, 'frame'],
    inner(19.5, 22.5),
    [23.9, 24.8, 'door', undefined, undefined, 'frame'],
    inner(25.8, 27.0),
    [27.6, 28.5, 'door', undefined, undefined, 'frame'],
  ]),
  ...U1.aulas.map((u) => vw(u, V.classTop, V.facade)),
  // Lado del patio del pasillo de lockers: ventanas altas sobre los lockers.
  brick(hw(V.corrS, U1.wing, U1.gallery, 'ext', [
    [13.6, 15.6, 'window', 1.85, 2.6],
    [17.0, 19.4, 'window', 1.85, 2.6],
    [20.2, 22.6, 'window', 1.85, 2.6],
    [23.4, 25.8, 'window', 1.85, 2.6],
  ])),
  // Frente de la Dirección de secundaria al pasillo.
  hw(V.corrS, miguelCaneU(V.corrS), U1.stairW, 'int', [[6.6, 7.5, 'door', undefined, undefined, 'frame']]),
  hw(V.corrS, U.bufW, U.east1, 'int'),

  // --- Sobre el hall ------------------------------------------------------
  // Fachada del portal: tres ventanas enrejadas con cortinas violetas; el
  // frente del portal sobresale y las enmarca (ver SchoolBuilder.portal).
  hw(V.facade, U.east1, U.salonW, 'ext', [
    [34.6, 36.0, 'window', 1.45, 2.85, undefined, 'whiteBars'],
    [36.8, 38.2, 'window', 1.45, 2.85, undefined, 'whiteBars'],
    [39.1, 40.5, 'window', 1.45, 2.85, undefined, 'whiteBars'],
  ]),
  // Fondo del pasillo de los trofeos: puerta de aluminio y ventanilla a la Secretaría.
  hw(V1.secretaria, U.east1, 36.25, 'int', [
    [33.1, 33.86, 'door', undefined, undefined, 'frame'],
    [34.4, 35.43, 'window', 0.96, 2.08],
  ]),
  vw(36.25, V.facade, V1.secretaria),
  // Lado oeste del pasillo de los trofeos: baño y boca del pasillo de lockers.
  vw(U.east1, V.facade, V.corrS, 'int', [
    [-5.2, -6.1, 'door', undefined, undefined, 'frame'],
    // Sin meterse en los muros del pasillo que llegan a sus costados.
    [-7.25, -9.2, 'pass'],
  ]),
  vw(U.east1, V.corrS, V1.trophyN),
  // Lado este: ventana a 6° BD, sus puertas y el ventanal de 6° AC.
  vw(U1.trophyE, V1.secretaria, V1.trophyN, 'int', [
    inner(-3.7, -4.7),
    [-4.9, -5.8, 'door', undefined, undefined, 'frame'],
    [-6.2, -7.1, 'door', undefined, undefined, 'frame'],
    inner(-9.6, -11.2),
  ]),
  hw(V1.sixth, U1.trophyE, U.salonW),
  // 6° AC da al norte a un patio de aire: ladrillo pintado con los equipos de aire.
  // Muro norte de 6° AC hacia la pasarela: ciego, con las condensadoras.
  hw(V1.trophyN, U1.trophyE, U.salonW, 'ext'),
  // Lado este de la torre de la escalera del hall, entre la pasarela y 6° AC:
  // sin este muro, desde el segundo tramo se veían el patio de aire y el cielo.
  vw(U1.towerE, V1.walkS, V1.trophyN, 'ext'),
  // Pasarela vidriada: paños de aluminio blanco a los dos lados, sin rejas.
  {
    ...hw(V1.walkS, U1.towerE, U.salonW, 'ext', [[35.9, 41.65, 'window', 0.9, 2.35, undefined, 'none']], 2.65),
    ext: 'black',
  },
  {
    ...hw(V1.walkN, U1.towerE, U.salonW, 'ext', [[35.9, 41.65, 'window', 0.9, 2.35, undefined, 'none']], 2.65),
    ext: 'black',
  },

  // --- Edificio de bloque ---------------------------------------------------
  { ...hw(V.facade, U.salonW, U1.vaultW, 'ext', [[42.5, 43.7, 'window', 1.0, 2.2, undefined, 'mesh']]), ext: 'brickWhite' },
  {
    ...hw(V.facade, U1.vaultW, U.gymW, 'ext', [
      [45.0, 46.6, 'window', 1.0, 2.2, undefined, 'mesh'],
      [47.6, 49.2, 'window', 1.0, 2.2, undefined, 'mesh'],
    ], 3.9),
    ext: 'brickWhite',
  },
  // Testero oeste: al hall/6° (interior), patio de aire, la pasarela y el patio este.
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
    ...hw(V.gymTop, U.salonW, U1.vaultW, 'ext', [[42.6, 43.6, 'window', 1.0, 2.2, undefined, 'mesh']]),
    ext: 'brickWhite',
  },
  {
    ...hw(V.gymTop, U1.vaultW, U.gymW, 'ext', [
      [45.2, 46.6, 'window', 1.0, 2.2, undefined, 'mesh'],
      [47.8, 49.2, 'window', 1.0, 2.2, undefined, 'mesh'],
    ], 3.9),
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
  hw(V1.blockA, U.salonW, U.gymW, 'int', [
    [42.6, 43.5, 'door', undefined, undefined, 'frame'],
    inner(49.0, 50.0),
  ]),

  // --- Ala oeste ---------------------------------------------------------
  seg(mc(V.corrS), mc(V.corrN), 'ext', [
    [-10.3, -12.3, 'window'],
    [-14.7, -16.5, 'window'],
    [-18.6, -20.2, 'window'],
    [-21.2, -22.8, 'window'],
  ]),
  // Hacia el techo del pasillo oeste y el patio: ventanas enrejadas del pasillo.
  brick(vw(U1.wing, V.corrS, V.corrN, 'ext', [
    [-10.2, -11.6, 'window'],
    [-14.8, -16.4, 'window'],
    [-18.0, -19.6, 'window'],
    [-21.2, -22.8, 'window'],
  ])),
  vw(U1.stairW, V.corrS, V1.stairN),
  hw(V1.stairN, miguelCaneU(V1.stairN), U1.wingCorr),
  // Preceptoría (con su ventana al pasillo) y Aula nivel secundario.
  vw(U1.wingCorr, V1.stairN, V.corrN, 'int', [
    [-14.4, -15.3, 'door', undefined, undefined, 'frame'],
    [-15.7, -17.1, 'window', 1.0, 2.1],
    [-18.3, -19.2, 'door', undefined, undefined, 'frame'],
  ]),
  hw(V1.precep, miguelCaneU(V1.precep), U1.wingCorr),
  hw(V.corrN, miguelCaneU(V.corrN), U1.wingCorr),

  // --- Bloque norte: sector nuevo ----------------------------------------
  // Fachada alta al patio oeste: ladrillo pintado con ventanitas enrejadas
  // (antepecho ≈4,6 m) y los equipos de aire (2:01–2:07).
  brick(hw(V.corrN, U1.wing, U1.gallery, 'ext', [
    [14.0, 15.2, 'window', 1.3, 1.9],
    [18.9, 20.1, 'window', 1.3, 1.9],
    [21.9, 23.1, 'window', 1.3, 1.9],
    [25.2, 26.4, 'window', 1.3, 1.9],
  ])),
  seg(mc(V.corrN), mc(V.nBlockN), 'ext', [
    [-23.9, -24.9, 'window'],
    [-26.4, -28.4, 'window'],
  ]),
  hw(V.nBlockN, miguelCaneU(V.nBlockN), U.east1, 'ext', [
    [14.5, 16.0, 'window'],
    [16.9, 18.4, 'window'],
    [22.6, 24.2, 'window', 1.6, 2.4],
    [27.8, 28.8, 'window', 1.6, 2.3],
    [30.4, 31.4, 'window', 1.6, 2.3],
  ]),
  // Lado del patio este: la puerta que da a la escalera exterior.
  vw(U.east1, V.corrN, V.nBlockN, 'ext', [
    [-25.4, -26.4, 'door', undefined, undefined, 'frame'],
    [-27.6, -29.0, 'window', 1.6, 2.3],
  ]),
  // Frente vidriado del aula bilingüe al pasillo.
  hw(V1.northCorr, miguelCaneU(V1.northCorr), U1.bilingual, 'int', [
    inner(12.6, 16.4),
    [17.3, 18.2, 'door', undefined, undefined, 'frame'],
  ]),
  vw(U1.bilingual, V1.northCorr, V.nBlockN, 'int', [inner(-26.3, -28.3)]),
  vw(22.0, V1.northCorr, V.nBlockN),
  hw(V1.northCorr, U1.bilingual, 22.0, 'int', [[19.3, 21.7, 'pass']]),
  vw(U1.bathN, V1.bathN, V.nBlockN),
  hw(V1.bathN, U1.bathN, U.east1, 'int', [[29.6, 30.5, 'door', undefined, undefined, 'frame']]),

  // --- Sobre el comedor: galería roja y aulas ----------------------------
  // Chapa roja acanalada con una tira de ventanas con parasoles.
  { ...vw(U1.gallery, V.corrS, V.corrN, 'ext', galleryRibbon()), ext: 'redSheet' },
  // Frente de las aulas a la galería: marcos gris oscuro.
  vw(U.bufW, V.corrS, V.corrN, 'int', [
    [-10.0, -10.9, 'door', undefined, undefined, 'frame'],
    [-11.5, -15.5, 'window', 1.0, 2.1, 'metalDark'],
    [-17.0, -21.5, 'window', 1.0, 2.1, 'metalDark'],
    [-22.3, -23.2, 'door', undefined, undefined, 'frame'],
  ]),
  hw(-16.4, U.bufW, U.east1),
  // Contra la torre de la escalera del hall.
  vw(U.east1, V1.trophyN, V.kiosk),
  hw(V.corrN, U.bufW, U.east1),
  // Lado del patio este: ventanas enrejadas.
  vw(U.east1, V.kiosk, V.corrN, 'ext', [
    [-15.4, -16.2, 'window'],
    [-18.6, -20.4, 'window'],
    [-21.4, -23.0, 'window'],
  ]),
];

/** Segundo piso: aula de danzas y su hall, bajo la bóveda del polideportivo. */
const W2: Wall[] = [
  // Testero norte del aula: puerta doble y dos ventanas a la escalera.
  hw(V1.blockHall, U1.vaultW, U.gymW, 'int', [
    [44.9, 46.3, 'double', undefined, undefined, 'frame'],
    [47.0, 48.6, 'window', 1.0, 2.0],
  ]),
  // Testero sur: puerta corrediza al bajo de la bóveda.
  hw(V1.danceS, U1.vaultW, U.gymW, 'int', [[46.0, 47.0, 'door', undefined, undefined, 'frame']], 2.1),
  // Remate de la escalera (tres plantas).
  hw(V1.blockHall, U.salonW, U1.vaultW, 'ext', [[42.4, 43.6, 'window']]),
  vw(U.salonW, V1.blockHall, V1.blockA, 'ext', [[-14.6, -16.0, 'window']]),
  hw(V1.blockA, U.salonW, U1.vaultW, 'ext'),
  hw(V1.blockA, U1.vaultW, U.gymW, 'ext', [], 2.2),
];

export const UPPER_WALLS: readonly Wall[] = [...onLevel(1, W1), ...onLevel(2, W2)];

// =================================================================== escaleras

export const UPPER_STAIRS: readonly Stair[] = [
  // "Acceso al Nivel Secundario": primer tramo, 14 contrahuellas al norte contra el muro oeste del hall.
  { u0: 33.05, v0: -13.2, u1: 34.25, v1: -9.0, dir: 'v-', y0: 0, y1: 2.45 },
  // Segundo tramo: vuelve al sur desde el descanso y desemboca en el pasillo de los trofeos.
  // Arranca 25 cm dentro del descanso: con 1,1 m de largo la huella daba 22 cm.
  { u0: 34.35, v0: -13.45, u1: U1.towerE, v1: V1.trophyN, dir: 'v+', y0: 2.45, y1: 3.3 },
  // Arranque de la pasarela: cinco escalones desde el descanso.
  { u0: U1.towerE, v0: V1.walkN, u1: 36.95, v1: V1.walkS, dir: 'u+', y0: 2.45, y1: 3.3 },
  // Escalera exterior blanca contra el comedor: del patio este al descanso de la torre.
  { u0: 33.0, v0: -19.5, u1: 34.1, v1: -15.0, dir: 'v+', y0: 0, y1: 2.45, hollow: true },
  // "Acceso a primer piso" (ala oeste): sube al oeste, descansa y vuelve al
  // este sobre la Preceptoría de primaria (el cielorraso en pendiente).
  { u0: 9.0, v0: -13.75, u1: 12.25, v1: -11.95, dir: 'u-', y0: 0, y1: 2.2 },
  { u0: 9.0, v0: -10.9, u1: U1.wingCorr, v1: -9.6, dir: 'u+', y0: 2.2, y1: 3.3 },
  // "Acceso a segundo piso": escalera de chapa en U del edificio de bloque.
  { u0: U1.blockStair0, v0: -16.0, u1: U1.blockStair1, v1: -14.6, dir: 'u+', y0: 3.3, y1: 4.95 },
  { u0: U1.blockStair0, v0: V1.blockA, u1: U1.blockStair1, v1: -16.2, dir: 'u-', y0: 4.95, y1: 6.6 },
];

export const UPPER_LANDINGS: readonly Landing[] = [
  // Descanso de la escalera del hall, en la torre.
  // Cubre también el espesor del muro norte: ahí desemboca la escalera exterior.
  { u0: 33.0, v0: -15.0, u1: U1.towerE, v1: -13.2, y: 2.45 },
  // Descanso del ala oeste, sobre el extremo oeste de la Preceptoría.
  { u0: U1.stairW, v0: -13.75, u1: 9.0, v1: -9.6, y: 2.2, hollow: true },
  // Descanso de la escalera de chapa.
  { u0: U1.blockStair1, v0: V1.blockA, u1: U1.blockStair2, v1: -14.6, y: 4.95, hollow: true },
];

/** Huecos de losa de las escaleras de las plantas altas. */
export const UPPER_VOIDS: ReadonlyArray<Rect & { level: Level }> = [
  // Torre del hall y parte alta de su primer tramo.
  { u0: U.east1, v0: V.kiosk, u1: U1.towerE, v1: V1.trophyN, level: 1 },
  { u0: U.east1, v0: V1.trophyN, u1: 34.3, v1: V1.hallVoid, level: 1 },
  // Arranque de la pasarela.
  { u0: U1.towerE, v0: V1.walkN, u1: 36.95, v1: V1.walkS, level: 1 },
  // Escalera del ala oeste.
  { u0: U1.stairW, v0: -13.75, u1: U1.wingCorr, v1: -9.6, level: 1 },
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

const I1: Item[] = [
  // Pasillo de lockers: lockers azul marino, negros y verde salvia bajo las ventanas altas.
  // Contra el muro (exterior hasta la galería, de 30 cm): antes se metían 12 cm.
  ...(
    [
      [14.6, 2.2],
      [17.0, 2.2],
      [19.4, 2.2],
      [21.8, 2.2],
      [24.2, 2.2],
      [29.55, 2.1],
      [31.65, 2.1],
    ] as const
  ).map(([u, w], k) => ({
    ...item('lockers', u, V.corrS + (u < U.bufW ? 0.405 : 0.355), w, 0.5, 's'),
    color: (['navy', 'black', 'sage'] as const)[k % 3],
  })),
  item('extinguisher', 12.0, V.classTop - 0.19, 0.17, 0.17, 'n', false),
  item('extinguisher', 30.3, V.classTop - 0.19, 0.17, 0.17, 'n', false),
  // Baranda de malla roja sobre el hueco de la escalera del ala oeste.
  { ...item('gate', 9.65, V.corrS + 0.05, 3.3, 0.05, 's', true), color: 'red', h: 1.05 },

  // 4° AC: mesas grises con sillas rojas. Aula nivel secundario: bancos verdes.
  ...desks({ u0: 1.0, v0: -6.3, u1: 4.6, v1: -1.4 }, 'w', 'chalk', 'red', 2, 3, 'table'),
  // Como en el Aula 1: la pizarra entre la ventana a Miguel Cané y el rincón.
  ...classKit([U.w + 0.17, -5.72], 'e', 3.0, -3.5, 2.4, 3.82),
  ...desks({ u0: 6.6, v0: -6.3, u1: 10.6, v1: -1.4 }, 'w', 'chairGreen', 'sage', 3, 3),
  ...classKit([U1.aulas[0] + 0.12, -3.5], 'e', 8.5, -3.5),
  // Mesas amarillas con sillas grises.
  ...desks({ u0: 12.6, v0: -6.3, u1: 17.6, v1: -1.4 }, 'w', 'yellow', 'metal', 3, 3),
  ...classKit([U1.aulas[1] + 0.12, -3.5], 'e', 14.6, -3.5),
  // Mesas naranjas con sillas rojas (zócalo de madera).
  ...desks({ u0: 19.6, v0: -6.3, u1: 24.7, v1: -1.4 }, 'w', 'orange', 'red', 3, 3, 'table'),
  ...classKit([U1.aulas[2] + 0.12, -3.5], 'e', 21.7, -3.5),
  // Mesas rojas con sillas azul marino.
  // Dos filas: con tres, el respaldo de cada silla se metía en la mesa de atrás.
  ...desks({ u0: 26.6, v0: -6.3, u1: 29.0, v1: -1.4 }, 'w', 'red', 'navy', 2, 2, 'table'),
  ...classKit([U1.aulas[3] + 0.12, -3.5], 'e', 27.3, -3.5),
  // Baños: cubículos de mampostería con puertas de madera oscura.
  item('stall', 31.9, -1.4, 1.4, 1.2, 'w'),
  item('stall', 31.9, -2.8, 1.4, 1.2, 'w'),
  // Contra el muro oeste (antes quedaba a 32 cm y el espejo, en el aire).
  { ...item('sinkCounter', 29.675, -4.9, 0.55, 1.6, 'e'), color: 'board' },

  // Pasillo de los trofeos: dispenser con el estante de trofeos encima, dos
  // sillas plásticas frente a la Secretaría, pizarras verdes y matafuego.
  // Fuera del paso de la puerta de la Secretaría.
  item('waterCooler', 33.17, -4.37, 0.32, 0.32, 'e', false),
  { ...item('trophyShelf', 33.16, -4.63, 0.3, 0.85, 'e', false), y: 1.85 },
  item('plasticChair', 34.55, -3.85, 0.42, 0.42, 'n', false),
  item('plasticChair', 35.2, -3.85, 0.42, 0.42, 'n', false),
  ...[-7.6, -8.3, -9.0].map((v) => ({ ...item('wallPanel', U1.trophyE - 0.12, v, 0.03, 0.5, 'w', false), y: 1.4, h: 0.4, color: 'chairGreen' })),
  // Entre las pizarras verdes y la ventana del aula (no sobre el vidrio).
  item('extinguisher', 35.56, -9.43, 0.17, 0.17, 'w', false),
  // Barandas sobre el hueco del primer tramo.
  { ...item('gate', 34.3, -11.45, 0.05, 1.3, 'e', true), color: 'red', h: 1.05 },
  { ...item('gate', 33.65, V1.hallVoid + 0.05, 1.3, 0.05, 's', true), color: 'red', h: 1.05 },
  // Secretaría: escritorio blanco con PC, biblioteca de cubos y split.
  { ...item('desk2', 34.3, -0.75, 1.4, 0.6, 's'), color: 'board' },
  { ...item('shelf', 33.25, -2.0, 0.4, 1.0, 'e'), color: 'board' },
  { ...item('ac', 33.115, -2.0, 0.22, 0.86, 'e', false), y: 2.35 },
  // 6° BD: mesas rojas en U con sillas azul marino. La U abre hacia la
  // pizarra (el fondo junto a la fachada): con el fondo bajo la pizarra no
  // quedaba lugar para el docente delante de ella.
  ...[37.3, 38.6, 39.9].map((u) => ({ ...item('table', u, -1.5, 1.2, 0.6), color: 'red' })),
  ...[-2.45, -3.65].flatMap((v) => [
    { ...item('table', 36.67, v, 0.6, 1.2), color: 'red' },
    { ...item('table', 41.0, v, 0.6, 1.2), color: 'red' },
  ]),
  ...[37.3, 38.6, 39.9].map((u) => ({ ...item('chair', u, -0.95, 0.42, 0.42, 'n', false), color: 'navy' })),
  ...[-2.45, -3.65].flatMap((v) => [
    { ...item('chair', 37.2, v, 0.42, 0.42, 'w', false), color: 'navy' },
    { ...item('chair', 40.45, v, 0.42, 0.42, 'e', false), color: 'navy' },
  ]),
  ...classKit([38.85, V1.sixth + 0.12], 's', 38.85, -3.0),
  // 6° AC.
  ...desks({ u0: 36.6, v0: -11.4, u1: 41.2, v1: -7.2 }, 'e', 'chairGreen', 'sage', 3, 3),
  ...classKit([U.salonW - 0.12, -9.0], 'w', 39.0, -9.0),

  // Equipos de aire sobre el techo del patio de aire, contra 6° AC (4:28).
  ...[37.4, 39.9].map((u) => ({ ...item('condenser', u, V1.trophyN - 0.35, 0.8, 0.3, 'n', false), y: 0.15 })),
  // Galería roja: matafuego y cartel entre los paños.
  item('extinguisher', U.bufW - 0.19, -16.0, 0.17, 0.17, 'w', false),
  // Aula sobre el comedor: mesas amarillas.
  ...desks({ u0: 29.0, v0: -15.6, u1: 32.3, v1: -10.2 }, 'n', 'yellow', 'metal', 2, 3),
  ...classKit([30.65, -16.28], 's', 30.65, -13.0),
  // Aula sobre el comedor (norte): mesas naranjas.
  ...desks({ u0: 29.0, v0: -22.9, u1: 32.3, v1: -17.2 }, 's', 'orange', 'red', 2, 3, 'table'),
  ...classKit([30.65, -16.52], 'n', 30.65, -20.0),
  // Sector nuevo: mesada de venecitas con bachas y espejos en el pasillo,
  // perchero azul y la escalera principal con su baranda.
  // Entre la puerta del baño y la de la escalera exterior, sin taparlas.
  // Más corta: deja 1 m libre delante de la puerta de la escalera exterior.
  { ...item('sinkCounter', 31.15, V1.bathN + 0.38, 1.2, 0.55, 's'), color: 'yellow' },
  // Barandas sobre el canto de la losa (antes flotaban 5–10 cm sobre el hueco).
  { ...item('gate', 25.05, V1.northCorr, 3.6, 0.05, 's', true), color: 'red', h: 1.05 },
  { ...item('gate', 23.3, -26.4, 0.05, 2.2, 'e', true), color: 'red', h: 1.05 },
  // Y sobre el canto este del hueco, hasta el muro de los baños: ahí el piso
  // terminaba en el aire sobre el descanso (1,65 m más abajo).
  { ...item('gate', 26.9, -25.85, 0.05, 1.1, 'e', true), color: 'red', h: 1.05 },
  // Biblioteca: fichero rojo, vitrina blanca, estanterías y mesas con sillas azules.
  // Contra el muro exterior del fondo (30 cm de espesor).
  { ...item('filing', 20.6, V.nBlockN + 0.43, 0.9, 0.55, 's'), h: 1.75 },
  { ...item('shelf', 21.45, V.nBlockN + 0.355, 0.7, 0.4, 's'), color: 'board' },
  { ...item('shelf', 19.57, V.nBlockN + 0.355, 1.1, 0.4, 's') },
  ...[-26.6, -28.4].flatMap((v) => [
    { ...item('table', 20.45, v, 1.2, 0.8) },
    { ...item('chair', 19.65, v, 0.42, 0.42, 'e', false), color: 'blue' },
    { ...item('chair', 21.25, v, 0.42, 0.42, 'w', false), color: 'blue' },
  ]),
  item('extinguisher', 20.2, V.corrN - 0.24, 0.17, 0.17, 'n', false),
  // Aula bilingüe: mesas amarillas en grupos, cortinas blancas.
  // Grupos de mesas que se tocan (antes se encimaban 17 cm).
  ...desks({ u0: 13.6, v0: -29.5, u1: 17.8, v1: -25.7 }, 'e', 'yellow', 'metal', 3, 2, 'table'),
  // Pizarra chica en el paño lleno junto a la ventana a la biblioteca (la de
  // 2,4 m la tapaba).
  ...classKit([U1.bilingual - 0.12, -29.005], 'w', 16.0, -27.6, 1.35),
  // Baños.
  item('stall', 31.9, -27.95, 1.4, 1.2, 'w'),
  item('stall', 31.9, -29.12, 1.4, 1.1, 'w'),

  // Ala oeste alta: Dirección de secundaria (escritorio de madera, bibliotecas
  // con biblioratos), Preceptoría (escritorios blancos con monitores) y aula.
  { ...item('desk2', 4.6, -11.0, 1.5, 0.75, 's'), color: 'cherry' },
  // Las bibliotecas miran al despacho (antes, el frente contra el muro).
  item('shelf', 6.6, -13.5, 1.6, 0.4, 's'),
  // Fuera del muro en diagonal de Miguel Cané.
  item('shelf', 4.45, -13.5, 1.4, 0.4, 's'),
  { ...item('chair', 4.6, -11.6, 0.45, 0.45, 'n', false), color: 'metalDark' },
  { ...item('desk2', 8.6, -14.6, 1.4, 0.7, 's'), color: 'board' },
  { ...item('desk2', 7.0, -16.8, 1.4, 0.7, 'n'), color: 'board' },
  { ...item('shelf', 10.8, -16.5, 0.4, 1.4, 'w'), color: 'board' },
  // El aula es un trapecio contra la diagonal de Miguel Cané: dos bancos por
  // fila adelante (la puerta barre el rincón este) y uno atrás. En la grilla
  // de 3 × 3 la mitad quedaba dentro del muro o fuera del edificio.
  ...(
    [
      [8.1, -18.95],
      [9.3, -18.95],
      [9.0, -20.35],
      [10.2, -20.35],
      [10.0, -21.75],
    ] as const
  ).flatMap(([u, v]): Item[] => [
    { ...item('desk', u, v, 1.2, 0.5, 's'), color: 'chairGreen' },
    ...[-0.3, 0.3].map((k): Item => ({ ...item('chair', u + k, v - 0.45, 0.42, 0.42, 's', false), color: 'sage' })),
  ]),
  ...classKit([8.6, V1.precep - 0.12], 'n', 8.6, -20.6),
  // Cabecera de la escalera: columna forrada azul francia y baranda roja.
  { ...item('paddedColumn', 12.6, -13.3, 0.4, 0.4), color: 'blue', h: 2.75 },
  // Del lado del hueco, no frente a la llegada del tramo alto.
  { ...item('gate', U1.wingCorr + 0.05, -12.35, 0.05, 2.9, 'e', true), color: 'red', h: 1.05 },
  item('extinguisher', 12.86, -20.4, 0.17, 0.17, 'w', false),

  // Edificio de bloque: columnas rojas sobre la grilla del salón, lockers
  // gris oscuro en el pasillo, bancos de madera y ventilador.
  // Hasta el cielorraso de placas (2,7 m), no a través de él.
  ...[-8.3, -12.75].map((v) => ({ ...item('roundColumn', 42.32, v, 0.32, 0.32), color: 'red', h: 2.7 })),
  { ...item('roundColumn', 49.93, -12.75, 0.32, 0.32), color: 'red', h: 2.7 },
  ...[-9.6, -11.3].map((v) => ({ ...item('lockers', 42.28, v, 0.45, 1.6, 'e'), color: 'metalDark' })),
  ...desks({ u0: 45.0, v0: -7.2, u1: 49.6, v1: -0.8 }, 'n', 'timber', 'timber', 3, 3, 'table'),
  ...classKit([47.2, V1.blockCD + 0.12], 's', 47.2, -4.0),
  // Pizarra en el muro lleno del sur (el del pasillo tiene dos ventanas).
  ...desks({ u0: 45.0, v0: -13.4, u1: 49.6, v1: -9.0 }, 's', 'timber', 'chairGreen', 3, 3, 'table'),
  ...classKit([47.3, V1.blockCD - 0.12], 'n', 47.3, -10.7),
  ...desks({ u0: 43.6, v0: -20.3, u1: 49.6, v1: -18.2 }, 'n', 'timber', 'chairGreen', 4, 2, 'table'),
  item('extinguisher', U.salonW + 0.24, -17.15, 0.17, 0.17, 'e', false),
];

const I2: Item[] = [
  // Aula de danzas: espejos de pared y barra doble al oeste, barras sueltas
  // contra las ventanas al polideportivo, espejos de pie al sur, banco rojo
  // con percheros y mueble con el equipo de música.
  { ...item('mirror', U1.vaultW + 0.15, -8.4, 0.04, 9.4, 'e', false) },
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
