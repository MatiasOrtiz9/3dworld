import type { Block, CityPlan } from './CityLayout';
import {
  APEX,
  LEVEL_Y,
  SCHOOL,
  U,
  V,
  WALKABLE,
  hw,
  inPoly,
  inRect,
  item,
  levelOf,
  mc,
  miguelCaneU,
  rear,
  rearV,
  rect,
  roomWindows,
  seg,
  vw,
  type Item,
  type Level,
  type Op,
  type P,
  type Rect,
  type Room,
  type SchoolFrame,
  type Stair,
  type Landing,
  type Volume,
  type Wall,
} from './SchoolBase';

export * from './SchoolBase';

const H = SCHOOL.storey;

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

/** Claraboyas altas del polideportivo, entre pilastras (laterales norte y sur). */
const GYM_CLERESTORY: Op[] = [
  [51.4, 54.2, 'high'],
  [55.0, 57.8, 'high'],
  [58.6, 61.4, 'high'],
  [62.2, 65.0, 'high'],
];


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
  // Lateral sur del polideportivo (Laprida): salida de emergencia y la tira de
  // claraboyas entre las pilastras; adentro van las gradas.
  hw(V.facade, U.gymW, U.e, 'ext', [[51.05, 54.8, 'exit'], ...GYM_CLERESTORY], SCHOOL.gymWall),

  // --- Miguel Cané: ochavo, ala oeste y Tecnología --------------------------
  vw(U.w, V.classTop, V.facade, 'ext', [[-4.3, -2.7, 'window']]),
  // Salida de emergencia del pasillo sur, al ochavo de Miguel Cané.
  seg([U.w, V.classTop], mc(V.corrS), 'ext', [[-7.25, -9.2, 'exit']]),
  // Sobre Miguel Cané: la ventana con persiana de Dirección, las dos ventanas
  // altas de la Sala de profesores y la de Administración.
  seg(mc(V.corrS), mc(V.corrN), 'ext', [
    [-11.2, -9.8, 'window'],
    [-15.2, -14.0, 'window', 1.9, 2.5],
    [-17.3, -15.6, 'window', 1.9, 2.5],
    [-22.2, -20.6, 'window'],
  ]),
  // Salida del pasillo norte a Miguel Cané (puerta doble del plano).
  seg(mc(V.corrN), mc(V.nBlockS), 'ext', [[-23.62, -24.98, 'exit']]),
  // Aula Maker: dos ventanas altas en tira sobre el pizarrón interactivo.
  seg(mc(V.nBlockS), APEX, 'ext', [
    [-33.4, -31.8, 'window', 2.1, 2.7],
    [-36.6, -35.0, 'window', 2.1, 2.7],
  ]),

  // --- Medianera del fondo ----------------------------------------------------
  seg(APEX, rear(U.tecE), 'ext'),
  seg(rear(U.tecE), rear(U.gymW), 'medianera', [], 3.6),
  seg(rear(U.gymW), rear(U.teaE), 'ext'),
  // Dentro del predio del jardín la medianera vieja es su muro sur, con puerta.
  seg(rear(U.teaE), rear(U.e), 'int', [[59.9, 61.6, 'door']]),

  // --- Tecnología (Aula Maker) y bloque norte ---------------------------------
  // Testero este del Aula Maker: salida de emergencia en la esquina sur.
  vw(U.tecE, rearV(U.tecE), V.nBlockN, 'int', [[-29.95, -30.85, 'exit']]),
  // Al Aula Maker se entra por UNA puerta vidriada al final del pasillo de
  // bloque que sale de Administración (2:28-2:32).
  hw(V.nBlockN, miguelCaneU(V.nBlockN), U.east1, 'int', [[14.45, 15.4, 'door', undefined, undefined, 'frame']]),
  vw(U.epW, V.nBlockN, V.nBlockS),
  // E.P se ve desde ese pasillo por dos ventanas.
  vw(U.epCorrE, V.nBlockN, V.nBlockS, 'int', [
    [-25.6, -26.4, 'window', 1.0, 2.0],
    [-27.0, -29.0, 'window', 1.0, 2.2],
  ]),
  vw(U.epE, V.nBlockN, V.nBlockS),
  vw(U.stairE, V.nBlockN, V.nBlockS),
  vw(U.east1, V.nBlockN, V.corrN),
  hw(V.nBlockS, miguelCaneU(V.nBlockS), U.east1, 'int', [
    [14.15, 15.95, 'pass'],
    [17.6, 19.8, 'double'],
    [27.0, 29.1, 'double'],
  ]),

  // --- Pasillo norte: cierre sur ----------------------------------------------
  hw(V.corrN, miguelCaneU(V.corrN), 11.5, 'int', [[10.0, 11.35, 'door']]),
  // Lado norte del Espacio recreativo: cuatro ventanas sobre el cantero largo,
  // la puerta doble roja vidriada y una puerta roja simple junto a la esquina.
  hw(V.corrN, U.patioW, U.east1, 'int', [
    [17.3, 18.8, 'window', 1.3, 2.15],
    [19.1, 20.6, 'window', 1.3, 2.15],
    [20.9, 22.4, 'window', 1.3, 2.15],
    [22.7, 24.2, 'window', 1.3, 2.15],
    [24.8, 26.6, 'double', undefined, undefined, 'red'],
    [27.3, 28.1, 'door', undefined, undefined, 'red'],
  ]),
  vw(U.closetW, V.nBlockS, V.corrN),

  // --- Ala oeste: ADM, PROF., DIR. PRIM ---------------------------------------
  hw(V.admB, miguelCaneU(V.admB), 11.5),
  // Donde el plano marca un núcleo gris hay, en el recorrido (2:14-2:30), un
  // baño que abre al pasillo y el frente de Administración: ventanilla de
  // atención con mostrador, puerta roja y puerta blanca, sobre un hall chico.
  hw(V.grayB, 11.5, U.wingE),
  vw(11.5, V.grayB, V.admB),
  hw(V.wcB, 11.5, U.wingE),
  vw(U.wingE, V.grayB, V.wcB, 'int', [[-18.0, -18.95, 'door', undefined, undefined, 'frame']]),
  vw(11.5, V.admB, V.corrN, 'int', [
    [-20.2, -21.2, 'counter'],
    [-21.5, -22.4, 'door', undefined, undefined, 'red'],
    [-22.6, -23.35, 'door', undefined, undefined, 'frame'],
  ]),
  vw(U.wingE, V.grayB, V.profB),
  hw(V.profB, miguelCaneU(V.profB), U.wingE, 'int', [[11.8, 13.0, 'door']]),
  hw(V.dirTop, miguelCaneU(V.dirTop), U.wingE, 'int', [
    [5.0, 6.0, 'door'],
    [10.6, 11.6, 'door'],
  ]),
  vw(U.dirDiv, V.dirTop, V.corrS),
  vw(U.wingE, V.dirTop, V.corrS),
  // Frente norte del pasillo sur: la puerta de Dirección junto a la salida y
  // la ventana interior de la sala (1:22-1:26).
  hw(V.corrS, miguelCaneU(V.corrS), U.wingE, 'int', [
    [0.95, 1.9, 'door'],
    [9.5, 11.0, 'window', 1.2, 2.4],
  ]),

  // --- Patio oeste y buffet ---------------------------------------------------
  // Pasillo oeste → patio: puerta doble roja vidriada y ventanas corredizas.
  vw(U.patioW, V.corrN, V.corrS, 'int', [
    [-11.6, -13.4, 'double', undefined, undefined, 'red'],
    [-14.0, -15.8, 'window', 1.24, 2.4],
    [-16.2, -18.0, 'window', 1.24, 2.4],
    [-18.4, -20.2, 'window', 1.24, 2.4],
  ]),
  // Pasillo sur → patio: corredizas entre pilares y el paso abierto.
  hw(V.corrS, U.patioW, U.bufW, 'int', [
    [16.75, 18.65, 'window', 1.24, 2.4],
    [18.95, 20.85, 'window', 1.24, 2.4],
    [21.15, 23.05, 'window', 1.24, 2.4],
    [23.4, 25.5, 'pass'],
    [25.8, 27.7, 'window', 1.24, 2.4],
  ]),
  // Comedor hacia el patio: paños vidriados con marco de madera oscura.
  vw(U.bufW, V.corrN, V.corrS, 'int', [
    [-9.9, -12.4, 'window', 0.9, 2.4, 'timberDark'],
    [-12.8, -15.3, 'window', 0.9, 2.4, 'timberDark'],
    [-15.7, -18.2, 'window', 0.9, 2.4, 'timberDark'],
    [-18.6, -21.1, 'window', 0.9, 2.4, 'timberDark'],
    [-21.5, -22.6, 'door', undefined, undefined, 'timberDark'],
  ]),
  // Frente de la cantina al pasillo: puerta y paño vidriado sobre zócalo rojo.
  hw(V.corrS, U.bufW, U.east1, 'int', [
    [28.6, 30.2, 'door'],
    [30.45, 32.65, 'window', 1.2, 2.6],
  ]),
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

  // --- Hall de acceso (Recepción) y kiosco ----------------------------------
  // Testero norte del hall (0:24-0:34, 4:16): dos puertas de aluminio blanco y
  // un ventanal al patio cubierto, con antepecho sobre el zócalo de mármol.
  hw(V.hallTop, U.east1, U.salonW, 'int', [
    [34.5, 35.4, 'door', undefined, undefined, 'frame'],
    [36.2, 37.1, 'door', undefined, undefined, 'frame'],
    [37.8, 41.0, 'window', 1.4, 3.1],
  ]),
  // Oficina de recepción, a la izquierda al entrar: ventana corrediza sobre
  // un antepecho rojo, con las placas de bronce al lado.
  vw(U.recE, V.hallDoors, V.recN, 'int', [[-1.75, -3.0, 'window', 1.0, 2.1]]),
  hw(V.recN, U.east1, U.recE, 'int', [[33.2, 34.05, 'door', undefined, undefined, 'frame']]),
  vw(U.kioskE, V.kiosk, V.hallTop),
  hw(V.kiosk, U.east1, U.kioskE, 'int', [[33.7, 34.8, 'door']]),
  hw(V.hallDoors, U.east1, U.salonW, 'int', [[35.55, 39.35, 'entrance']]),
  vw(U.salonW, V.gymTop, V.facade, 'int', [
    [-19.6, -18.0, 'window'],
    [-16.2, -14.6, 'window'],
    [-12.8, -11.45, 'door'],
    // "Acceso al Polideportivo": puerta doble de aluminio blanco.
    [-10.85, -9.35, 'double', undefined, undefined, 'frame'],
    [-8.4, -7.0, 'door', undefined, undefined, 'red'],
  ]),

  // --- Salón de los espejos, pasaje y gimnasio -------------------------------
  // Testero norte del aula de danzas: piano, cómoda y afiches; sin ventanas.
  hw(V.gymTop, U.salonW, U.gymW, 'int'),
  // Lateral norte del polideportivo: puerta al pasillo del jardín, ventanas
  // oscuras hacia Arte y Teatro y claraboyas altas sobre sus techos.
  hw(
    V.gymTop,
    U.gymW,
    U.e,
    'int',
    [
      [51.4, 53.2, 'band'],
      [54.4, 56.2, 'band'],
      [58.05, 60.5, 'double'],
      [62.4, 64.2, 'band'],
      [65.0, 66.8, 'band'],
      ...GYM_CLERESTORY,
    ],
    SCHOOL.gymWall,
  ),
  hw(V.passN, U.salonW, U.gymW),
  hw(V.passS, U.salonW, U.gymW),
  // Testero oeste, de bloque: puerta al pasaje y las ventanas del aula de
  // danzas que dan al polideportivo.
  {
    ...vw(
      U.gymW,
      V.gymTop,
      V.facade,
      'int',
      [
        [-19.4, -17.6, 'band'],
        [-15.6, -13.8, 'band'],
        [-11.0, -9.25, 'double'],
      ],
      SCHOOL.gymWall,
    ),
    finish: { gimnasio: 'block', salon: 'block' },
  },
  // Testero este: muro ciego gris, con la bandera del escudo y las franjas.
  { ...vw(U.e, V.gymTop, V.facade, 'ext', [], SCHOOL.gymWall), finish: { gimnasio: 'gymWall' } },

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

/**
 * Ambientes del plano. El orden importa sólo para `roomAt`: los recintos
 * chicos van antes que los que los rodean.
 */
export const ROOMS: readonly Room[] = [
  { id: 'aula1', name: 'Aula', caption: 'Aula nivel primario', poly: rect(U.w, V.classTop, U.c2, V.facade), floor: 'tile', roofed: true },
  { id: 'aula2', name: 'Aula', caption: 'Aula nivel primario', poly: rect(U.c2, V.classTop, U.c3, V.facade), floor: 'tile', roofed: true },
  { id: 'aula3', name: 'Aula', caption: 'Aula nivel primario', poly: rect(U.c3, V.classTop, U.c4, V.facade), floor: 'tile', roofed: true },
  { id: 'aula4', name: 'Aula', caption: 'Aula nivel primario', poly: rect(U.c4, V.classTop, U.c5, V.facade), floor: 'tile', roofed: true },
  { id: 'aula5', name: 'Aula', caption: 'Aula nivel primario', poly: rect(U.c5, V.classTop, U.east1, V.facade), floor: 'tile', roofed: true },
  {
    id: 'pasilloSur',
    name: 'Pasillo',
    poly: [[U.w, V.classTop], [U.east1, V.classTop], [U.east1, V.corrS], mc(V.corrS)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'dirPrim', name: 'Dir. Prim', caption: 'Dirección primaria', poly: [mc(V.dirTop), [U.dirDiv, V.dirTop], [U.dirDiv, V.corrS], mc(V.corrS)], floor: 'terracotta', roofed: true },
  { id: 'sala', name: '', poly: rect(U.dirDiv, V.dirTop, U.wingE, V.corrS), floor: 'tile', roofed: true },
  {
    id: 'hallOeste',
    name: 'Pasillo',
    poly: [mc(V.profB), [U.wingE, V.profB], [U.wingE, V.dirTop], mc(V.dirTop)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'prof', name: 'Prof.', caption: 'Sala de profesores', poly: [mc(V.admB), [11.5, V.admB], [11.5, V.grayB], [U.wingE, V.grayB], [U.wingE, V.profB], mc(V.profB)], floor: 'tile', roofed: true },
  { id: 'adm', name: 'ADM', caption: 'Administración', poly: [mc(V.corrN), [11.5, V.corrN], [11.5, V.admB], mc(V.admB)], floor: 'tile', roofed: true },
  { id: 'wcAdm', name: 'Sanitarios', poly: rect(11.5, V.wcB, U.wingE, V.grayB), floor: 'ceramic', roofed: true },
  { id: 'hallAdm', name: 'Pasillo', caption: 'Administración', poly: rect(11.5, V.corrN, U.wingE, V.wcB), floor: 'ceramic', roofed: true },
  { id: 'pasilloOeste', name: 'Pasillo', poly: rect(U.wingE, V.corrN, U.patioW, V.corrS), floor: 'tile', roofed: true },
  { id: 'patioOeste', name: 'Patio aire libre', caption: 'Espacio recreativo', poly: rect(U.patioW, V.corrN, U.bufW, V.corrS), floor: 'patio', roofed: false },
  { id: 'buffet', name: 'Buffet', caption: 'Cantina y comedor', poly: rect(U.bufW, V.corrN, U.east1, V.corrS), floor: 'checker', roofed: true },
  {
    id: 'pasilloNorte',
    name: 'Pasillo',
    poly: [mc(V.nBlockS), [U.closetW, V.nBlockS], [U.closetW, V.corrN], mc(V.corrN)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'deposito', name: '', poly: rect(U.closetW, V.nBlockS, U.east1, V.corrN), floor: 'tile', roofed: true },
  { id: 'pasilloMaker', name: 'Pasillo', caption: 'Hacia el Aula Maker', poly: rect(U.epW, V.nBlockN, U.epCorrE, V.nBlockS), floor: 'ceramic', roofed: true },
  { id: 'ep', name: 'E.P', poly: rect(U.epCorrE, V.nBlockN, U.epE, V.nBlockS), floor: 'tile', roofed: true },
  { id: 'escalera', name: 'Escalera', poly: rect(U.epE, V.nBlockN, U.stairE, V.nBlockS), floor: 'tile', roofed: true },
  { id: 'salaNorte', name: '', poly: rect(U.stairE, V.nBlockN, U.east1, V.nBlockS), floor: 'tile', roofed: true },
  { id: 'nicho', name: '', poly: [mc(V.nBlockN), [U.epW, V.nBlockN], [U.epW, V.nBlockS], mc(V.nBlockS)], floor: 'tile', roofed: true },
  { id: 'tecnologia', name: 'Tecnología', caption: 'Aula Maker', poly: [APEX, rear(U.tecE), [U.tecE, V.nBlockN], mc(V.nBlockN)], floor: 'green', roofed: true },
  { id: 'kiosco', name: '', poly: rect(U.east1, V.kiosk, U.kioskE, V.hallTop), floor: 'tile', roofed: true },
  { id: 'recepcionOf', name: '', caption: 'Oficina de recepción', poly: rect(U.east1, V.recN, U.recE, V.hallDoors), floor: 'tile', roofed: true },
  {
    id: 'hall',
    name: 'Hall de acceso',
    caption: 'Recepción',
    // El hall rodea la oficina de recepción (a la izquierda de la entrada).
    poly: [
      [U.east1, V.hallTop],
      [U.salonW, V.hallTop],
      [U.salonW, V.facade],
      [U.east1, V.facade],
      [U.east1, V.hallDoors],
      [U.recE, V.hallDoors],
      [U.recE, V.recN],
      [U.east1, V.recN],
    ],
    floor: 'hallStone',
    roofed: true,
  },
  { id: 'salon', name: 'Salón de los espejos', caption: 'Aula de danzas', poly: rect(U.salonW, V.gymTop, U.gymW, V.passN), floor: 'wood', roofed: true },
  { id: 'pasaje', name: 'Pasillo', poly: rect(U.salonW, V.passN, U.gymW, V.passS), floor: 'tile', roofed: true },
  { id: 'aula6', name: '', poly: rect(U.salonW, V.passS, U.gymW, V.facade), floor: 'tile', roofed: true },
  { id: 'gimnasio', name: 'Gimnasio SUM', caption: 'Polideportivo', poly: rect(U.gymW, V.gymTop, U.e, V.facade), floor: 'gym', roofed: true },
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

/** Cota de la azotea de un volumen. */
export function volumeTop(vol: Volume): number {
  return (vol.floors + 1) * SCHOOL.storey;
}

/**
 * Volúmenes de dos plantas. La planta alta NO figura en el plano de
 * evacuación, así que no se inventa: se levanta como volumen cerrado con sus
 * ventanas, tal como se ve desde la calle y desde los patios en las fotos y en
 * el recorrido virtual. Las escaleras del plano quedan donde están.
 */
const UPPER_POLYS: readonly (readonly P[])[] = [
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

export const UPPER: readonly Volume[] = UPPER_POLYS.map((poly) => ({ poly, floors: 1 }));

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
  // "Acceso al Nivel Secundario": arranca en el piso del hall, contra el muro
  // oeste, y sube hacia el norte 14 contrahuellas hasta el descanso (0:20,
  // 4:16-4:24). El resto sube a la planta alta.
  { u0: 33.05, v0: -12.1, u1: 34.3, v1: -8.6, dir: 'v-', y0: 0, y1: 2.3 },
  // Escalera exterior del patio este, contra el bloque norte.
  { u0: 33.05, v0: -29.7, u1: 34.35, v1: -26.7, dir: 'v-', y0: 0.3, y1: 3.3 },
];

/** Descansos de las escaleras. */
export const LANDINGS: readonly Landing[] = [
  // Descanso bajo de la escalera exterior.
  { u0: 33.05, v0: -26.7, u1: 35.1, v1: -25.3, y: 0.3 },
  // Descanso entre los dos tramos de la escalera principal.
  { u0: 26.1, v0: -29.65, u1: 26.9, v1: -25.3, y: 1.65 },
  // Descanso de la escalera del hall, contra el testero norte.
  { u0: 33.05, v0: -13.2, u1: 34.3, v1: -12.1, y: 2.3 },
];

/**
 * Huecos de losa: donde una escalera atraviesa el piso de `level` (y el
 * cielorraso del nivel de abajo). Ahí no se dibujan ni la losa ni el
 * cielorraso, y en ese nivel no se pisa: se baja por la escalera.
 */
export const VOIDS: ReadonlyArray<Rect & { level: Level }> = [
  // Escalera principal del bloque norte: los dos tramos y el descanso.
  { u0: 20.35, v0: -29.65, u1: 26.9, v1: -25.3, level: 1 },
];

/** Huecos de losa de un nivel. */
export function voidsAt(level: Level): Rect[] {
  return VOIDS.filter((h) => h.level === level);
}

function inVoid(level: Level, u: number, v: number): boolean {
  for (const h of VOIDS) if (h.level === level && inRect(h, u, v)) return true;
  return false;
}


/** Columnas rojas del aula de danzas (a lo largo de v, sobre los dos laterales). */
export const SALON_COLUMNS = [-12.75, -16.0, -19.25] as const;

/** Eje este-oeste de la cancha del polideportivo. */
export const GYM_MID = V.gymTop / 2;
/** Pilastras de los laterales del polideportivo (coinciden con las cabriadas). */
export const GYM_PILASTERS = [52.4, 55.8, 59.2, 62.6, 66.0] as const;

type ClassKind = 'desks' | 'redTables' | 'blueTables';

/**
 * Aula de primaria (recorrido 0:48-1:10): pizarra blanca al oeste, pizarrón
 * negro al este, escritorio docente, viga transversal con el proyector,
 * ventilador entre las dos ventanas y parlante sobre la pizarra. El mobiliario
 * cambia: bancos dobles verde salvia, mesas rojas agrupadas con sillas azul
 * marino, o mesas azules con sillas rojas.
 */
function classroom(u0: number, u1: number, kind: ClassKind = 'desks'): Item[] {
  const out: Item[] = [];
  const v0 = V.classTop;
  const uc = (u0 + u1) / 2;
  out.push(item('board', u0 + 0.12, -3.4, 0.06, 2.4, 'e', false));
  out.push({ ...item('blackboard', u1 - 0.12, -3.4, 0.04, 1.6, 'w', false), y: 0.95, h: 1.2 });
  out.push(item('teacherDesk', u0 + 1.3, -2.1, 0.7, 1.3, 'e'));
  out.push(item('chair', u0 + 0.75, -2.1, 0.45, 0.45, 'e', false));
  // Viga descolgada a 2,2 m del pasillo, con el proyector colgado.
  out.push({ ...item('wallPanel', uc, v0 + 2.2, u1 - u0 - 0.2, 0.25, 's', false), y: 2.75, h: 0.35, color: 'white' });
  out.push({ ...item('projector', u0 + 3.0, v0 + 2.2, 0.36, 0.3, 'w', false), y: 2.75 });
  out.push({ ...item('fan', uc, -0.22, 0.3, 0.3, 'n', false), y: 2.6 });
  out.push({ ...item('speaker', u0 + 0.16, -1.6, 0.22, 0.26, 'e', false), y: 2.55 });
  if (kind === 'desks') {
    const cols = [u0 + 2.3, u0 + 3.4, u0 + 4.5, u0 + 5.6].filter((u) => u < u1 - 0.7);
    for (const u of cols) {
      for (const v of [v0 + 1.8, v0 + 3.6, v0 + 5.4]) {
        out.push({ ...item('desk', u, v, 0.5, 1.2, 'w'), color: 'sage' });
        out.push({ ...item('chair', u + 0.45, v - 0.3, 0.42, 0.42, 'w', false), color: 'sage' });
        out.push({ ...item('chair', u + 0.45, v + 0.3, 0.42, 0.42, 'w', false), color: 'sage' });
      }
    }
  } else if (kind === 'redTables') {
    // Mesas rojas juntas en un solo grupo, sillas azul marino alrededor.
    for (const [du, dv] of [
      [0, 0],
      [1.2, 0],
      [0, 0.75],
      [1.2, 0.75],
    ]) {
      out.push({ ...item('table', u0 + 3.2 + du, -3.8 + dv, 1.2, 0.75), color: 'red' });
    }
    for (const du of [0, 1.2]) {
      out.push({ ...item('chair', u0 + 3.2 + du, -4.55, 0.42, 0.42, 's', false), color: 'navy' });
      out.push({ ...item('chair', u0 + 3.2 + du, -2.3, 0.42, 0.42, 'n', false), color: 'navy' });
    }
  } else {
    // Mesas azules en grupos, sillas rojas.
    for (const [du, v] of [
      [2.6, -2.0],
      [4.6, -2.0],
      [2.6, -4.6],
      [4.6, -4.6],
    ]) {
      if (u0 + du < u1 - 0.9) out.push({ ...item('roundTable', u0 + du, v, 1.1, 1.1), color: 'blue' });
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
  out.push({ ...item('fan', (u0 + u1) / 2, -0.22, 0.3, 0.3, 'n', false), y: 2.6 });
  return out;
}

/**
 * Medianera del fondo del Aula Maker (pared del mural): punto a `s` metros
 * desde el vértice norte, corrido `off` metros hacia adentro del aula.
 */
export function makerWallAt(s: number, off: number): P {
  const du = U.tecE - APEX[0];
  const dv = rearV(U.tecE) - APEX[1];
  const len = Math.hypot(du, dv);
  const tu = du / len;
  const tv = dv / len;
  // Normal hacia adentro (hacia el sur): (−tv, tu).
  return [APEX[0] + tu * s - tv * off, APEX[1] + tv * s + tu * off];
}

/** Largo de la pared del mural del Aula Maker. */
export const MAKER_WALL = Math.hypot(U.tecE - APEX[0], rearV(U.tecE) - APEX[1]);

/** Columnas redondas del Aula Maker, delante del mural: (distancia, color). */
export const MAKER_COLUMNS: ReadonlyArray<readonly [number, string]> = [
  [1.4, 'blue'],
  [3.9, 'lime'],
  [6.4, 'navy'],
  [8.9, 'red'],
  [11.85, 'blue'],
];

const makerColumns = (): Item[] =>
  MAKER_COLUMNS.map(([s, color]) => {
    const [u, v] = makerWallAt(s, 0.62);
    return { ...item('roundColumn', u, v, 0.35, 0.35), color };
  });

/** Banquetas Tolix delante del estante del mural (rojas, blancas y negras). */
const makerStools = (): Item[] =>
  ([
    [2.6, 'red'],
    [3.2, 'board'],
    [5.0, 'metalDark'],
    [5.6, 'red'],
    [7.6, 'board'],
    [8.2, 'metalDark'],
    [10.1, 'metalDark'],
  ] as const).map(([s, color]) => {
    const [u, v] = makerWallAt(s, 0.62);
    return { ...item('stool', u, v, 0.34, 0.34, 's', false), color };
  });

export const ITEMS: readonly Item[] = [
  // Aulas sobre Laprida (la tercera es el laboratorio de la estación de ciencia).
  ...classroom(U.w, U.c2, 'blueTables'),
  ...classroom(U.c2, U.c3, 'redTables'),
  ...lab(U.c3, U.c4),
  ...classroom(U.c4, U.c5),
  ...classroom(U.c5, U.east1),

  // Pasillo sur: pizarrones negros y carteles rojos sobre las puertas de las
  // aulas, parlantes, matafuegos en los pilares y el zócalo rojo del frente de
  // la cantina.
  ...[21.0, 14.0, 8.0].map((u) => ({ ...item('blackboard', u, -7.22, 1.0, 0.04, 'n', false), y: 1.2, h: 1.2 })),
  ...[5.4, 11.75, 18.1, 24.2, 26.8].map((u) => ({ ...item('wallPanel', u, -7.215, 0.3, 0.03, 'n', false), y: 2.3, h: 0.35, color: 'red' })),
  ...[16.0, 7.0].map((u) => ({ ...item('speaker', u, -7.33, 0.26, 0.22, 'n', false), y: 2.5 })),
  ...[30.35, 23.25, 12.0].map((u) => item('extinguisher', u, -9.155, 0.17, 0.17, 's', false)),
  { ...item('wallPanel', 31.55, -9.24, 2.2, 0.02, 's', false), h: 1.2, color: 'darkRed' },

  // Aula junto al gimnasio.
  ...[43.9, 45.4, 46.9, 48.4].flatMap((u) =>
    [-7.4, -5.6, -3.8, -2.0].map((v) => item('desk', u, v, 0.55, 1.2, 'w')),
  ),
  item('board', U.salonW + 0.14, -4.6, 0.06, 2.6, 'e', false),

  // Aula Maker (2:32-3:20): seis mesas hexagonales con sillas azules en la zona
  // verde, columnas de colores delante del mural, una mesa larga con bancos,
  // el banco de trabajo con la cortadora láser y la impresora 3D contra el
  // testero, los muebles Educabot junto a la entrada y el escritorio con PC.
  ...[
    [20.4, -35.9],
    [23.6, -35.1],
    [26.6, -34.4],
    [18.0, -33.3],
    [20.6, -32.7],
    [24.9, -32.3],
  ].map(([u, v]) => item('hexTable', u, v, 1.4, 1.4)),
  ...makerColumns(),
  ...makerStools(),
  { ...item('workbench', 29.0, -33.9, 2.4, 0.9), color: 'blue' },
  { ...item('benchSeat', 29.0, -33.15, 2.4, 0.3, 's', false), color: 'blue' },
  { ...item('benchSeat', 29.0, -34.65, 2.4, 0.3, 'n', false), color: 'blue' },
  { ...item('workbench', 30.85, -33.5, 0.7, 2.0, 'w'), color: 'blue' },
  item('laserCutter', 30.85, -32.95, 0.6, 1.0, 'w', false),
  item('printer3d', 30.85, -34.15, 0.5, 0.5, 'w', false),
  { ...item('drawers', 30.7, -31.75, 0.6, 1.0, 'w'), color: 'blue', h: 1.05 },
  item('cabinet', 16.3, -30.25, 0.8, 0.45, 'n'),
  item('cabinet', 17.15, -30.25, 0.8, 0.45, 'n'),
  { ...item('desk2', 18.9, -30.2, 1.2, 0.6, 'n'), color: 'oak' },
  { ...item('chair', 18.6, -30.9, 0.5, 0.5, 'n', false), color: 'sage' },
  { ...item('projector', 18.6, -34.4, 0.36, 0.3, 'w', false), y: 2.9 },
  // Piso: verde salvia con pasillo azul acero a lo largo del muro sur y del
  // testero este, y líneas blancas.
  { ...item('floorPatch', 22.78, -30.9, 16.9, 1.9, 's', false), color: 'steel' },
  { ...item('floorPatch', 30.33, -33.67, 1.85, 3.6, 's', false), color: 'steel' },
  { ...item('floorPatch', 22.5, -31.87, 13.8, 0.05, 's', false), color: 'board' },
  { ...item('floorPatch', 29.38, -33.67, 0.05, 3.6, 's', false), color: 'board' },

  // Pasillo de bloque hacia el Aula Maker: columna redonda forrada en azul marino.
  { ...item('paddedColumn', 14.4, -24.75, 0.35, 0.35), color: 'navy' },

  // E.P
  item('table', 17.6, -27.5, 2.0, 1.1),
  item('shelf', 19.9, -27.2, 0.45, 1.8, 'w'),

  // Sala junto a la escalera.
  item('table', 30.4, -27.5, 2.0, 1.2),
  item('shelf', 32.6, -27.4, 0.45, 2.0, 'w'),

  // Administración: escritorio y biblioteca; en su hall, columna con
  // protección azul francia.
  item('teacherDesk', 10.4, -22.3, 1.3, 0.7, 's'),
  item('shelf', 10.0, -19.45, 1.4, 0.4, 's'),
  { ...item('paddedColumn', 12.75, -22.9, 0.4, 0.4), color: 'blue' },

  // Sala de profesores (1:54-2:00): mesas con tapa roja en grupos, sillas
  // blancas, mesada roja, banquetas rojas, bibliotecas rojas, pizarrón verde,
  // armario beige y ventilador.
  ...[
    [7.6, -15.4],
    [8.8, -15.4],
    [10.6, -15.4],
    [11.8, -15.4],
    [9.0, -17.3],
    [10.2, -17.3],
  ].flatMap(([u, v]) => [
    { ...item('table', u, v, 1.2, 0.7), color: 'red' },
    { ...item('plasticChair', u, v - 0.55, 0.42, 0.42, 's', false) },
    { ...item('plasticChair', u, v + 0.55, 0.42, 0.42, 'n', false) },
  ]),
  { ...item('counter', 9.0, -18.9, 2.6, 0.6, 's'), color: 'red' },
  ...[7.9, 10.1].map((u) => ({ ...item('stool', u, -18.3, 0.34, 0.34, 's', false), color: 'red' })),
  { ...item('shelf', 12.88, -15.7, 0.35, 0.9, 'w'), color: 'red' },
  { ...item('blackboard', 7.4, -13.92, 1.8, 0.04, 's', false), y: 0.95, h: 1.2 },
  { ...item('drawers', 12.6, -17.35, 0.9, 0.45, 'n'), h: 1.9 },
  { ...item('fan', 12.95, -16.6, 0.3, 0.3, 'w', false), y: 2.5 },

  // Dirección primaria (1:24-1:30): biblioteca con biblioratos, escritorio y
  // cajonera color cerezo, sillas negras y ventilador de techo.
  item('shelf', 5.6, -11.25, 1.6, 0.4, 's'),
  { ...item('desk2', 4.0, -10.4, 1.4, 0.7, 's'), color: 'cherry' },
  { ...item('drawers', 2.9, -10.9, 0.45, 0.6, 'e'), color: 'cherry', h: 0.75 },
  { ...item('chair', 4.0, -10.95, 0.45, 0.45, 's', false), color: 'metalDark' },
  ...[3.6, 4.5].map((u) => ({ ...item('chair', u, -9.8, 0.45, 0.45, 'n', false), color: 'metalDark' })),
  item('ceilingFan', 5.2, -10.45, 1.2, 1.2, 's', false),
  item('teacherDesk', 9.4, -9.95, 1.3, 0.7, 'n'),

  // Pasillo oeste: reja roja abierta contra el muro oeste y matafuego.
  { ...item('gate', 13.25, -10.3, 0.05, 1.6, 'e', false), color: 'red', h: 2.2 },
  item('extinguisher', 13.3, -14.6, 0.17, 0.17, 'e', false),

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

  // Espacio recreativo (2:00-2:13): cantero azul largo con pastos y asientos de
  // madera contra el lado norte, cantero angosto junto al pasillo oeste,
  // cantero de ladrillo, mástil, árboles, la palmera en su cantero con
  // asientos, banquitos cilíndricos rojos, aro de básquet y la galería del
  // comedor con columnas negras.
  item('planter', 20.85, -22.95, 7.3, 0.9),
  ...[18.5, 20.85, 23.2].map((u) => ({ ...item('wallPanel', u, -22.62, 2.0, 0.3, 's', false), y: 0.6, h: 0.05, color: 'timberDark' })),
  item('planter', 17.0, -17.0, 0.8, 5.0),
  { ...item('planter', 17.35, -20.6, 1.5, 0.6), color: 'brick' },
  { ...item('flagpole', 17.9, -21.7, 0.1, 0.1), h: 8 },
  item('tree', 19.4, -21.9, 0.6, 0.6),
  { ...item('floorPatch', 27.2, -21.9, 2.5, 2.5, 's', false), color: 'darkGreen' },
  item('tree', 27.6, -22.4, 0.6, 0.6),
  { ...item('bench', 26.6, -20.4, 1.2, 0.4, 's', false), color: 'timberDark' },
  item('planter', 24.75, -12.75, 2.4, 2.4),
  { ...item('palm', 24.75, -12.75, 0.4, 0.4), h: 6, y: 0.6 },
  ...[
    [24.75, -11.45, 2.4, 0.4],
    [23.45, -12.75, 0.4, 2.4],
  ].map(([u, v, w, d]) => ({ ...item('wallPanel', u, v, w, d, 's', false), y: 0.45, h: 0.05, color: 'timberDark' })),
  item('planter', 21.6, -12.1, 3.5, 0.6),
  ...[
    [22.2, -13.6],
    [22.8, -14.5],
    [26.7, -14.6],
  ].map(([u, v]) => ({ ...item('roundColumn', u, v, 0.35, 0.35), color: 'red', h: 0.4 })),
  ...[-11.0, -14.0, -17.0, -20.0, -22.9].map((v) => ({ ...item('wallPanel', 26.8, v, 0.12, 0.12), h: 3.25, color: 'metalDark' })),
  item('planter', 27.7, -14.0, 0.6, 2.4),
  item('planter', 27.7, -19.8, 0.6, 2.4),
  item('hoop', 16.63, -20.6, 0.6, 0.45, 'e', false),

  // Patio este: árboles contra la medianera, canteros, juegos y bancos.
  item('tree', 36.2, -33.1, 0.6, 0.6),
  item('tree', 42.4, -31.6, 0.6, 0.6),
  item('tree', 47.8, -30.0, 0.6, 0.6),
  item('playhouse', 45.4, -26.6, 2.4, 2.0),
  item('planter', 38.6, -21.4, 4.0, 0.9),
  item('bench', 38.6, -19.6, 1.8, 0.5, 'n', false),
  item('bench', 46.2, -21.5, 1.8, 0.5, 'n', false),

  // Recepción (0:18-0:34): banner al pie de la escalera, asientos de espera
  // negros frente al ventanal, columna con protección verde, cabina de
  // recepción roja y vidriada a la derecha de la entrada, placas de bronce,
  // parlante y split sobre el mural, y las bandas oscuras del piso.
  item('banner', 34.9, -8.95, 0.9, 0.4, 's'),
  item('seats', 38.42, -12.55, 1.65, 0.5, 's'),
  item('seats', 40.3, -12.55, 1.1, 0.5, 's'),
  { ...item('paddedColumn', 39.3, -8.0, 0.4, 0.4), color: 'darkGreen' },
  item('booth', 40.65, -2.85, 2.5, 2.3, 'w'),
  item('plaques', 35.42, -3.3, 0.04, 0.6, 'e', false),
  { ...item('speaker', 33.12, -4.4, 0.22, 0.26, 'e', false), y: 2.75 },
  { ...item('ac', 33.13, -6.2, 0.22, 0.86, 'e', false), y: 2.75 },
  { ...item('floorPatch', 37.4, -5.1, 1.2, 7.0, 's', false), color: 'charcoal' },
  { ...item('floorPatch', 38.1, -8.85, 7.6, 0.5, 's', false), color: 'charcoal' },

  // Salón de los espejos = aula de danzas (recorrido 10:08–10:36): parquet,
  // columnas redondas rojas sobre los dos laterales con vigas negras, espejos
  // con marco rojo y barra negra sobre el muro de bloque del polideportivo,
  // piano, cómoda y afiches en el testero norte, banco rojo con percheros.
  ...SALON_COLUMNS.flatMap((v) => [
    { ...item('roundColumn', 42.32, v, 0.36, 0.36), color: 'red' },
    { ...item('roundColumn', 49.93, v, 0.36, 0.36), color: 'red' },
  ]),
  { ...item('mirror', 50.17, -14.3, 0.04, 2.7, 'w', false), color: 'red' },
  { ...item('mirror', 50.17, -17.6, 0.04, 2.7, 'w', false), color: 'red' },
  { ...item('barre', 49.88, -15.95, 0.06, 6.4, 'w'), color: 'metalDark' },
  // Barra de pie, suelta, frente a la ventana del oeste.
  { ...item('barre', 43.1, -17.6, 0.06, 2.4, 'e'), color: 'metalDark' },
  item('piano', 44.0, -20.38, 1.5, 0.55, 's'),
  item('drawers', 46.5, -20.45, 1.8, 0.42, 's'),
  { ...item('drawers', 48.4, -20.5, 0.9, 0.34, 's'), h: 0.65 },
  item('coatBench', 42.38, -14.3, 0.42, 1.8, 'e'),
  item('fan', 42.15, -16.0, 0.3, 0.3, 'e', false),
  item('fan', 42.15, -19.3, 0.3, 0.3, 'e', false),
  item('fan', 50.15, -12.2, 0.3, 0.3, 'w', false),
  item('speaker', 42.2, -12.0, 0.26, 0.22, 'e', false),
  item('speaker', 50.12, -19.9, 0.26, 0.22, 'w', false),

  // Polideportivo: la cancha corre de oeste a este, con los arcos en los
  // testeros; las gradas de chapa negra van contra el lateral de Laprida y
  // las pilastras llevan protección verde abajo y roja arriba.
  // El arco oeste está corrido hacia la esquina norte, contra el bloque: en
  // el centro del testero está la puerta doble del pasaje (cuadro 9:20).
  item('goal', 51.25, -17.4, 0.8, 3.1, 'e'),
  item('goal', 66.45, GYM_MID, 0.8, 3.1, 'w'),
  ...[56.4, 59.4, 62.4, 65.4].map((u) => item('bleachers', u, -1.5, 2.7, 2.4, 'n')),
  ...GYM_PILASTERS.flatMap((u) => [item('padPilaster', u, -20.55, 0.42, 0.3, 's'), item('padPilaster', u, -0.32, 0.42, 0.3, 'n')]),
  { ...item('wallMat', 67.2, -1.5, 0.1, 1.7, 'w', false), color: 'red', h: 1.9 },
  { ...item('wallMat', 66.3, -20.6, 1.6, 0.1, 's', false), color: 'red', h: 1.9 },

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

/** ¿El punto está dentro del predio escolar (edificio, patios o franja de frente)? */
export function inLot(u: number, v: number): boolean {
  if (v > SCHOOL.front || v < V.top - 0.2 || u > U.e + 0.2) return false;
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
    // Huecos de escalera, sin margen: el último escalón desemboca justo en
    // su borde y un margen dejaría al que sube trabado arriba del tramo.
    for (const h of voidsAt(level)) mark(h.u0, h.v0, h.u1, h.v1, (u, v) => inRect(h, u, v));
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
