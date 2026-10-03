import type { Block, CityPlan } from './CityLayout';
import {
  APEX,
  FURNITURE,
  KINDER_ROOMS,
  LEVEL_Y,
  PRIMARY_ROOMS,
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
  type Facing,
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

import { JARDIN_ITEMS, JARDIN_LANDINGS, JARDIN_ROOMS, JARDIN_STAIRS, JARDIN_VOIDS, JARDIN_WALLS } from './SchoolJardin';
import {
  CREST,
  U1,
  UPPER_ITEMS,
  UPPER_LANDINGS,
  UPPER_ROOMS,
  UPPER_STAIRS,
  UPPER_VOIDS,
  UPPER_VOLUMES,
  UPPER_WALLS,
  V1,
} from './SchoolUpper';

export * from './SchoolBase';
export { CREST, U1, V1 };

const H = SCHOOL.storey;

/** Muro con terminación propia sobre la cara de ciertos ambientes. */
const wallFinish = (w: Wall, finish: Record<string, string>): Wall => ({ ...w, finish });

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
const GYM_BAY = (67.4 - 50.3) / 6;
const GYM_CLERESTORY: Op[] = Array.from({ length: 6 }, (_, k): Op => {
  // Una por paño, centrada entre pilastras, de tres cuartos del paño (9:22–9:28).
  const c = 50.3 + GYM_BAY * (k + 0.5);
  return [c - GYM_BAY * 0.375, c + GYM_BAY * 0.375, 'high', 4.5, 5.9];
});


const WALLS_PB: Wall[] = [
  // --- Fachada sobre Laprida -------------------------------------------------
  // Diez ventanas en los extremos de cada aula, medidas sobre la toma de la
  // fachada (0:00–0:08): no están a un cuarto del aula sino cerca de los tabiques.
  hw(
    V.facade,
    U.w,
    U.east1,
    'ext',
    (
      [
        [0.27, 1.88],
        [4.8, 6.4],
        [7.17, 8.89],
        [11.11, 12.81],
        [13.51, 15.16],
        [17.35, 19.02],
        [19.73, 21.38],
        [23.63, 25.3],
        [26.0, 27.68],
        [29.99, 31.68],
      ] as const
    ).map(([a, b]): Op => [a, b, 'window', 1.27, 2.29]),
  ),
  hw(V.facade, U.east1, 33.35, 'ext'),
  hw(V.facade, 40.9, U.salonW, 'ext'),
  // Edificio de bloque sobre Laprida: ladrillo pintado de blanco y ventanas
  // de marco negro con malla romboidal (0:12–0:16).
  {
    ...hw(V.facade, U.salonW, U.gymW, 'ext', roomWindows(U.salonW, U.gymW).map(([a, b, t]): Op => [a, b, t, undefined, undefined, 'metalDark', 'mesh'])),
    ext: 'brickWhite',
  },
  // Lateral sur del polideportivo (Laprida): salida de emergencia y la tira de
  // claraboyas entre las pilastras; adentro van las gradas.
  // La salida de emergencia del plano queda en el primer paño, entre la
  // esquina y la primera pilastra.
  hw(V.facade, U.gymW, U.e, 'ext', [[50.75, 52.85, 'exit'], ...GYM_CLERESTORY, [66.3, 67.2, 'door', undefined, undefined, 'red']], SCHOOL.gymWall),

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
  seg(rear(U.tecE), rear(41.5), 'medianera', [], 3.6),
  // Detrás de las hamacas la medianera está pintada de azul francia, con los
  // azulejos pintados por los chicos (9:52–9:58).
  { ...seg(rear(41.5), rear(U.gymW), 'medianera', [], 3.6), ext: 'blue' },
  seg(rear(U.gymW), rear(U.teaE), 'ext'),
  // Dentro del predio del jardín la medianera vieja es su muro sur, con puerta.
  // Vano de 1,29 m: puerta de dos hojas (una sola hoja de ese ancho no existe).
  seg(rear(U.teaE), rear(U.e), 'int', [[60.75, 62.0, 'double', undefined, undefined, 'frame']]),

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
  // Al final del pasillo norte, puertas dobles vidriadas al patio este (3:28).
  vw(U.east1, V.nBlockN, V.corrN, 'int', [[-23.65, -25.0, 'double', undefined, undefined, 'frame']]),
  hw(V.nBlockS, miguelCaneU(V.nBlockS), U.east1, 'int', [
    [14.15, 15.95, 'pass'],
    [17.6, 19.8, 'double'],
    // Puerta de la escalera principal, al pie del primer tramo.
    [20.4, 21.3, 'door', undefined, undefined, 'frame'],
    // Corrida 10 cm al este: arrancaba dentro del muro de la escalera.
    [27.1, 29.2, 'double'],
  ]),

  // --- Pasillo norte: cierre sur ----------------------------------------------
  hw(V.corrN, miguelCaneU(V.corrN), 11.5, 'int', [[10.0, 11.35, 'double']]),
  // Lado norte del Espacio recreativo: cuatro ventanas sobre el cantero largo,
  // la puerta doble roja vidriada y una puerta roja simple junto a la esquina.
  hw(V.corrN, U.patioW, U.east1, 'int', [
    [17.0, 19.0, 'window', 1.25, 2.2],
    [19.6, 21.5, 'window', 1.25, 2.2],
    [22.2, 24.1, 'window', 1.25, 2.2],
    [24.4, 26.2, 'double', undefined, undefined, 'red'],
    [26.4, 27.4, 'window', 1.25, 2.2],
    [27.5, 28.3, 'door', undefined, undefined, 'red'],
  ]),

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
  // La puerta de la sala de profesores arranca en 12,28: el pie de la
  // escalera del ala oeste (hasta 12,25, sobre este mismo muro) y la punta de
  // su pasamanos quedaban delante de la hoja. El tramo no se puede acortar
  // (riserCount) ni la puerta correrse al este (el muro del ala, en 13,1).
  hw(V.profB, miguelCaneU(V.profB), U.wingE, 'int', [[12.28, 13.0, 'door']]),
  // Bajo el descanso de la escalera del ala oeste el muro llega sólo hasta la
  // losa del descanso (2,08 m): entero, el descanso lo atravesaba y quien
  // subía pasaba a través de la pared.
  hw(V.dirTop, miguelCaneU(V.dirTop), U1.stairW, 'int', [[5.0, 6.0, 'door']]),
  hw(V.dirTop, U1.stairW, 9.0, 'int', [], 2.08),
  hw(V.dirTop, 9.0, U.wingE, 'int', [[12.25, 13.0, 'door', undefined, undefined, 'red']]),
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
    [-9.9, -11.3, 'window', 1.24, 2.3],
    [-11.6, -13.4, 'double', undefined, undefined, 'red'],
    [-14.8, -16.8, 'window', 1.24, 2.4],
    [-18.5, -20.6, 'window', 1.24, 2.4],
    [-21.4, -22.8, 'window', 1.24, 2.4],
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
    [28.6, 30.2, 'double'],
    [30.45, 32.65, 'window', 1.2, 2.6],
  ]),
  // Frente del comedor al patio este (10:00–10:05): puerta de chapa bajo la
  // escalera exterior, puerta vidriada y una tira de ventanas sobre un zócalo
  // de bloque.
  vw(U.east1, V.corrN, V.corrS, 'int', [
    [-15.2, -16.1, 'door', undefined, undefined, 'frame'],
    [-19.6, -20.6, 'door', undefined, undefined, 'frame'],
    [-20.75, -23.3, 'window', 1.08, 2.9],
  ]),

  // --- Aulas sobre Laprida ------------------------------------------------------
  hw(V.classTop, U.w, U.east1, 'int', [
    [4.6, 6.2, 'double', undefined, undefined, 'frame'],
    [10.95, 12.55, 'double', undefined, undefined, 'frame'],
    [17.3, 18.9, 'double', undefined, undefined, 'frame'],
    [23.4, 25.0, 'double', undefined, undefined, 'frame'],
    [26.0, 27.6, 'double', undefined, undefined, 'frame'],
  ]),
  vw(U.c2, V.classTop, V.facade),
  vw(U.c3, V.classTop, V.facade),
  vw(U.c4, V.classTop, V.facade),
  vw(U.c5, V.classTop, V.facade),
  vw(U.east1, V.classTop, V.facade),

  // --- Hall de acceso (Recepción) y torre de la escalera --------------------
  // Testero norte del hall (0:24-0:34, 4:16): la puerta de aluminio blanco y
  // el ventanal al patio, con antepecho sobre el zócalo de mármol. Al oeste
  // no hay muro: la escalera "Acceso al Nivel Secundario" sube por ahí a la
  // caja que el plano dibuja al norte del hall (la torre de la escalera).
  {
    ...hw(V.hallTop, U1.towerE, U.salonW, 'int', [
      [36.2, 37.1, 'door', undefined, undefined, 'frame'],
      [37.8, 41.0, 'window', 1.4, 3.1],
    ]),
    // Del lado del jardincito el muro es verde oliva (10:08).
    finish: { patioEste: 'olive' },
  },
  // Oficina de recepción, a la izquierda al entrar: ventana corrediza sobre
  // un antepecho rojo, con las placas de bronce al lado.
  vw(U.recE, V.hallDoors, V.recN, 'int', [[-1.75, -3.0, 'window', 1.0, 2.1]]),
  hw(V.recN, U.east1, U.recE, 'int', [[33.2, 34.05, 'door', undefined, undefined, 'frame']]),
  // Torre de la escalera, de dos plantas: al norte llega la escalera exterior
  // blanca del patio este, al este sale la pasarela vidriada (a la altura del
  // descanso).
  vw(U.kioskE, V.kiosk, V.hallTop, 'ext', [[-13.6, -14.8, 'pass', 2.45, 4.6]], 2 * H),
  hw(V.kiosk, U.east1, U.kioskE, 'ext', [[33.0, 34.1, 'pass', 2.45, 4.6]], 2 * H),
  hw(V.hallDoors, U.east1, U.salonW, 'int', [[35.55, 39.35, 'entrance']]),
  // Lado del patio este del aula de danzas (10:08–10:20): ventanas enrejadas
  // y la puerta doble que da al jardincito con la palmera.
  wallFinish(vw(U.salonW, V.gymTop, V.facade, 'int', [
    [-19.3, -19.75, 'window', 1.2, 2.3],
    [-17.8, -19.1, 'double', undefined, undefined, 'frame'],
    [-15.7, -17.2, 'window', 1.2, 2.3],
    [-13.45, -14.35, 'window', 1.2, 2.3],
    [-12.8, -11.45, 'double'],
    // "Acceso al Polideportivo": puerta doble de aluminio blanco.
    [-10.85, -9.35, 'double', undefined, undefined, 'frame'],
    [-8.4, -7.0, 'double', undefined, undefined, 'red'],
  ]), { patioEste: 'olive' }),

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
      // Sólo los paños 4 y 5 tienen aberturas bajas: tres ventanas oscuras y la
      // puerta con el cartel de SALIDA (9:17, 9:24–9:26).
      [59.0, 59.7, 'window', 1.05, 2.2],
      [60.4, 61.3, 'window', 1.05, 2.2],
      // Termina antes del muro de V. Damas (antes se metía 10 cm en él).
      [61.75, 62.55, 'window', 1.05, 2.2],
      [63.05, 63.85, 'door'],
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
        // Ventanas altas con vidrio armado del aula de danzas al polideportivo.
        [-12.25, -13.5, 'band', 2.05, 2.95],
        [-15.45, -16.7, 'band', 2.05, 2.95],
        [-18.15, -19.4, 'band', 2.05, 2.95],
        [-11.0, -9.25, 'double'],
        // Primer piso del edificio de bloque: ventanas con malla al polideportivo (9:21).
        [-0.45, -2.1, 'window', 4.2, 5.3],
        [-3.1, -4.65, 'window', 4.2, 5.3],
        [-6.15, -7.8, 'window', 4.2, 5.3],
        [-9.3, -10.9, 'window', 4.2, 5.3],
        [-15.2, -16.8, 'window', 4.2, 5.3],
        [-18.0, -19.6, 'window', 4.2, 5.3],
      ],
      SCHOOL.gymWall,
    ),
    // Bloque claro abajo y más oscuro a la altura del primer piso (9:22).
    finish: { gimnasio: 'blockTwoTone', salon: 'block' },
    upper: 'block',
  },
  // Testero este: muro ciego gris, con la bandera del escudo y las franjas.
  { ...vw(U.e, V.gymTop, V.facade, 'ext', [], SCHOOL.gymWall), finish: { gimnasio: 'gymWall' } },

  // --- Arte, Teatro, pasillo del gimnasio y V. Damas --------------------------
  vw(U.gymW, rearV(U.gymW), V.artB, 'int', [[-27.4, -25.8, 'window']]),
  vw(U.gymW, V.artB, V.gymTop, 'int', [[-22.5, -20.95, 'double']]),
  vw(U.artE, rearV(U.artE), V.artB),
  vw(U.teaE, rearV(U.teaE), V.artB),
  hw(V.artB, U.gymW, U.teaE, 'int', [
    [51.5, 53.2, 'double'],
    [54.1, 56.0, 'double'],
  ]),
  vw(U.vdW, rearV(U.vdW), V.gymTop, 'int', [
    [-26.45, -25.45, 'door'],
    [-22.15, -21.15, 'door'],
  ]),
  hw(V.vdB, U.vdW, U.e),
  vw(66.0, -21.85, V.gymTop),
  hw(-21.85, 66.0, U.e),
  vw(U.e, rearV(U.e), V.gymTop, 'ext', [[-24.6, -23.9, 'window']]),
];

export const WALLS: readonly Wall[] = [...WALLS_PB, ...UPPER_WALLS, ...JARDIN_WALLS];

/**
 * Ambientes del plano. El orden importa sólo para `roomAt`: los recintos
 * chicos van antes que los que los rodean.
 */
const ROOMS_PB: Room[] = [
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
  { id: 'sala', name: 'Preceptoría', caption: 'Preceptoría primaria', poly: rect(U.dirDiv, V.dirTop, U.wingE, V.corrS), floor: 'terracotta', roofed: true },
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
    // Llega hasta las puertas vidriadas al patio este (3:28).
    poly: [mc(V.nBlockS), [U.east1, V.nBlockS], [U.east1, V.corrN], mc(V.corrN)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'pasilloMaker', name: 'Pasillo', caption: 'Hacia el Aula Maker', poly: rect(U.epW, V.nBlockN, U.epCorrE, V.nBlockS), floor: 'ceramic', roofed: true },
  { id: 'ep', name: 'E.P', poly: rect(U.epCorrE, V.nBlockN, U.epE, V.nBlockS), floor: 'tile', roofed: true },
  { id: 'escalera', name: 'Escalera', poly: rect(U.epE, V.nBlockN, U.stairE, V.nBlockS), floor: 'tile', roofed: true },
  // Entrada a los baños de alumnos desde el pasillo norte (3:22–3:28).
  { id: 'salaNorte', name: 'Sanitarios', caption: 'Toilette alumnos', poly: rect(U.stairE, V.nBlockN, U.east1, V.nBlockS), floor: 'ceramic', roofed: true },
  { id: 'nicho', name: '', poly: [mc(V.nBlockN), [U.epW, V.nBlockN], [U.epW, V.nBlockS], mc(V.nBlockS)], floor: 'tile', roofed: true },
  { id: 'tecnologia', name: 'Tecnología', caption: 'Aula Maker', poly: [APEX, rear(U.tecE), [U.tecE, V.nBlockN], mc(V.nBlockN)], floor: 'green', roofed: true },
  // La caja al norte del hall es la torre de la escalera (0:24, 4:21–4:30).
  { id: 'torreHall', name: 'Escalera', caption: 'Acceso al Nivel Secundario', poly: rect(U.east1, V.kiosk, U.kioskE, V.hallTop), floor: 'tile', roofed: true },
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

export const ROOMS: readonly Room[] = [...ROOMS_PB, ...UPPER_ROOMS, ...JARDIN_ROOMS];

/** Cota de la azotea de un volumen. */
export function volumeTop(vol: Volume): number {
  return (vol.floors + 1) * SCHOOL.storey;
}

/**
 * Volúmenes con plantas altas. La planta alta NO figura en el plano de
 * evacuación: sale del recorrido virtual (ver `SchoolUpper`). El jardín de
 * infantes tiene tres plantas (10:38–13:56).
 */
export const UPPER: readonly Volume[] = [
  ...UPPER_VOLUMES,
  // Sin cerramiento genérico: el jardín tiene sus muros en cada piso (con
  // él, el muro oeste se duplicaba en el mismo plano y aparecían ventanas y
  // equipos de aire en un lateral que es ciego).
  { poly: [[U.teaE, V.top], [U.e, V.top], rear(U.e), rear(U.teaE)], floors: 2, cornice: false, shell: false, roofMat: 'jardinRoof' },
];

/** Cubiertas de una sola planta. */
export const ROOFS: ReadonlyArray<{ poly: readonly P[]; y: number }> = [
  { poly: [APEX, rear(U.tecE), [U.tecE, V.nBlockN], mc(V.nBlockN)], y: H },
  { poly: [rear(U.gymW), rear(U.teaE), [U.teaE, V.artB], [U.gymW, V.artB]], y: H },
  {
    poly: [rear(U.teaE), rear(U.e), [U.e, V.gymTop], [U.gymW, V.gymTop], [U.gymW, V.artB], [U.teaE, V.artB]],
    y: H,
  },
  // El pasillo oeste es de una sola planta (2:02–2:06): el ala alta está retirada.
  { poly: rect(U1.wing, V.corrN, U.patioW, V.corrS), y: H },
  // Patio de aire entre 6° AC y la pasarela: techo del hall con los equipos.
  { poly: rect(U1.towerE, V.hallTop, U.salonW, V1.trophyN), y: H },
  // Pasarela vidriada.
  { poly: rect(U1.towerE, V1.walkN - 0.15, U.salonW, V1.walkS + 0.15), y: H + 2.65 },
];

/**
 * Escaleras. Se suben: cada tramo es una rampa para los pies (ver
 * `schoolFloorLocal`) y los escalones se dibujan encima.
 */
export const STAIRS: readonly Stair[] = [
  // Escalera principal del bloque norte (dos tramos, núcleo gris del plano).
  { u0: 23.3, v0: -27.35, u1: 25.9, v1: -25.3, dir: 'u+', y0: 0, y1: 1.65 },
  { u0: 23.3, v0: -29.65, u1: 25.9, v1: -27.6, dir: 'u-', y0: 1.65, y1: 3.3 },
  // Escalera exterior del patio este, contra el bloque norte: sube al sur
  // hasta la puerta del sector nuevo en el primer piso.
  // Arranca 2 m más al norte: en 3 m los 19 escalones tenían huella de 16 cm.
  { u0: 33.05, v0: -31.75, u1: 34.35, v1: -26.7, dir: 'v+', y0: 0, y1: 3.3 },
  // Las del hall, el ala oeste, el comedor y el edificio de bloque.
  ...UPPER_STAIRS,
  ...JARDIN_STAIRS,
];

/** Descansos de las escaleras. */
export const LANDINGS: readonly Landing[] = [
  // Descanso alto de la escalera exterior, frente a la puerta del primer piso.
  // Cubre también el espesor del muro, hasta el piso del pasillo: con 15 cm
  // sin piso delante de la puerta no se podía entrar al sector nuevo.
  { u0: U.east1, v0: -26.7, u1: 34.35, v1: -25.3, y: 3.3, hollow: true },
  // Descanso entre los dos tramos de la escalera principal.
  { u0: 25.9, v0: -29.65, u1: 26.9, v1: -25.3, y: 1.65 },
  ...UPPER_LANDINGS,
  ...JARDIN_LANDINGS,
];

/**
 * Huecos de losa: donde una escalera atraviesa el piso de `level` (y el
 * cielorraso del nivel de abajo). Ahí no se dibujan ni la losa ni el
 * cielorraso, y en ese nivel no se pisa: se baja por la escalera.
 */
export const VOIDS: ReadonlyArray<Rect & { level: Level }> = [
  // Escalera principal del bloque norte: los dos tramos y el descanso.
  { u0: 23.3, v0: -29.65, u1: 26.9, v1: -25.3, level: 1 },
  ...UPPER_VOIDS,
  ...JARDIN_VOIDS,
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
export const SALON_COLUMNS = [-14.75, -17.5, -20.0] as const;

/** Eje este-oeste de la cancha del polideportivo. */
export const GYM_MID = V.gymTop / 2;
/** Pilastras de los laterales del polideportivo (coinciden con las cabriadas). */
export const GYM_PILASTERS = [1, 2, 3, 4, 5].map((k) => 50.3 + GYM_BAY * k);

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
  // Cara de cada testero: el de Miguel Cané (u = 0) es muro exterior, más grueso.
  const w0 = u0 + (u0 === U.w ? SCHOOL.extT : SCHOOL.wallT) / 2;
  const w1 = u1 - SCHOOL.wallT / 2;
  // En el Aula 1 el testero oeste tiene la ventana a Miguel Cané en el medio:
  // la pizarra va entre la ventana y el rincón del pasillo, no sobre el vidrio.
  const boardV = u0 === U.w ? -5.72 : -3.4;
  out.push(item('board', w0 + 0.02, boardV, 0.04, 2.4, 'e', false));
  out.push({ ...item('blackboard', w1 - 0.025, -3.4, 0.05, 1.6, 'w', false), y: 0.95, h: 1.2 });
  out.push(item('teacherDesk', u0 + 1.3, -2.1, 0.7, 1.3, 'e'));
  out.push(item('chair', u0 + 0.75, -2.1, 0.45, 0.45, 'e', false));
  // Viga descolgada a 2,2 m del pasillo, de testero a testero (1 cm empotrada
  // en cada uno), con el proyector colgado.
  out.push({ ...item('wallPanel', (w0 + w1) / 2, v0 + 2.2, w1 - w0 + 0.02, 0.25, 's', false), y: 2.75, h: 0.35, color: 'white' });
  out.push({ ...item('projector', u0 + 3.0, v0 + 2.2, 0.36, 0.3, 'w', false), y: 2.75 });
  out.push({ ...item('fan', uc, -0.22, 0.3, 0.3, 'n', false), y: 2.6 });
  // Parlante colgado sobre la pizarra (su caja mide 22 cm de fondo).
  out.push({ ...item('speaker', w0 + 0.115, -1.6, 0.22, 0.26, 'e', false), y: 2.55 });
  if (kind === 'desks') {
    // La última fila deja 50 cm de paso detrás de las sillas (antes, en el
    // Aula 4, las sillas de la cuarta columna se metían en el testero).
    const cols = [u0 + 2.3, u0 + 3.4, u0 + 4.5, u0 + 5.6].filter((u) => u + 0.66 < w1 - 0.5);
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
  // Biblioteca contra la fachada (cuyo muro exterior llega a v = −0,15).
  out.push(item('shelf', w1 - 0.235, -0.76, 0.45, 1.2, 'w'));
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
  out.push(item('shelf', (u0 + u1) / 2, -0.38, 2.4, 0.45, 'n'));
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
  [10.9, 'blue'],
  // La sexta, naranja, en la esquina noreste (2:40–3:15).
  [12.2, 'orange'],
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

const ITEMS_PB: Item[] = [
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

  // Aula junto al gimnasio: bancos dobles con sus dos sillas (sin ellas el
  // aula parecía un depósito de pupitres).
  ...[43.9, 45.4, 46.9, 48.4].flatMap((u) =>
    [-7.4, -5.6, -3.8, -2.0].flatMap((v) => [
      item('desk', u, v, 0.55, 1.2, 'w'),
      item('chair', u + 0.45, v - 0.3, 0.42, 0.42, 'w', false),
      item('chair', u + 0.45, v + 0.3, 0.42, 0.42, 'w', false),
    ]),
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
  { ...item('desk2', 18.9, -30.27, 1.2, 0.6, 'n'), color: 'oak' },
  { ...item('chair', 18.6, -30.9, 0.5, 0.5, 'n', false), color: 'sage' },
  { ...item('projector', 18.6, -34.4, 0.36, 0.3, 'w', false), y: 2.9 },
  // Piso: verde salvia con pasillo azul acero a lo largo del muro sur y del
  // testero este, y líneas blancas.
  // Las líneas blancas van 2 mm por encima del vinílico (sin z-fighting).
  { ...item('floorPatch', 22.78, -30.9, 16.9, 1.9, 's', false), color: 'steel' },
  { ...item('floorPatch', 30.33, -33.66, 1.85, 3.62, 's', false), color: 'steel' },
  { ...item('floorPatch', 22.5, -31.87, 13.8, 0.05, 's', false), color: 'board', y: 0.002 },
  { ...item('floorPatch', 29.38, -33.6825, 0.05, 3.575, 's', false), color: 'board', y: 0.002 },

  // Pasillo de bloque hacia el Aula Maker: columna redonda forrada en azul marino.
  { ...item('paddedColumn', 14.35, -28.0, 0.3, 0.3), color: 'navy' },

  // E.P
  item('table', 17.6, -27.5, 2.0, 1.1),
  item('shelf', 19.82, -27.2, 0.45, 1.8, 'w'),

  // Baños de alumnos: cubículos y mesada con bachas.
  item('stall', 32.09, -26.9, 1.4, 1.2, 'w'),
  item('stall', 32.09, -28.3, 1.4, 1.2, 'w'),
  { ...item('sinkCounter', U.stairE + 0.4, -27.6, 0.55, 2.0, 'e'), color: 'board' },

  // Administración: escritorio y biblioteca; en su hall, columna con
  // protección azul francia.
  item('teacherDesk', 10.15, -21.2, 1.3, 0.7, 's'),
  item('shelf', 9.6, -19.51, 1.4, 0.4, 'n'),
  { ...item('paddedColumn', 13.85, -24.8, 0.4, 0.4), color: 'blue' },
  // Mampara de casilleros de madera clara contra el pasillo norte.
  { ...item('cabinet', 12.7, -24.82, 1.8, 0.35, 's'), h: 1.8 },

  // Sala de profesores (1:54-2:00): mesas con tapa roja en grupos, sillas
  // blancas, mesada roja, banquetas rojas, bibliotecas rojas, pizarrón verde,
  // armario beige y ventilador.
  ...[
    [7.6, -15.4],
    [8.8, -15.4],
    // Corridas al oeste: la puerta de la sala barre hasta 1 m adentro.
    [10.3, -15.4],
    [11.5, -15.4],
    [9.0, -17.3],
    [10.2, -17.3],
  ].flatMap(([u, v]) => [
    { ...item('table', u, v, 1.2, 0.7), color: 'red' },
    { ...item('plasticChair', u, v - 0.55, 0.42, 0.42, 's', false) },
    { ...item('plasticChair', u, v + 0.55, 0.42, 0.42, 'n', false) },
  ]),
  { ...item('counter', 9.0, -18.79, 2.6, 0.6, 's'), color: 'red' },
  // Banquetas de la mesada: miran a la mesada y en su mitad libre. Mirando a
  // las mesas, la de u 10,1 quedaba 7 cm detrás de la silla de la mesa y
  // quien se sentaba metía las rodillas en la espalda del de adelante.
  ...[7.9, 8.5].map((u) => ({ ...item('stool', u, -18.3, 0.34, 0.34, 'n', false), color: 'red' })),
  { ...item('shelf', 12.82, -15.7, 0.35, 0.9, 'w'), color: 'red' },
  { ...item('blackboard', 7.4, -13.925, 1.8, 0.05, 'n', false), y: 0.95, h: 1.2 },
  { ...item('drawers', 12.54, -17.32, 0.9, 0.45, 's'), h: 1.9 },
  { ...item('fan', 12.95, -16.6, 0.3, 0.3, 'w', false), y: 2.5 },

  // Dirección primaria (1:24-1:30): biblioteca con biblioratos, escritorio y
  // cajonera color cerezo, sillas negras y ventilador de techo.
  // Biblioteca contra el muro del pasillo, entre las dos puertas.
  item('shelf', 7.05, -11.19, 1.6, 0.4, 's'),
  { ...item('desk2', 4.0, -10.4, 1.4, 0.7, 's'), color: 'cherry' },
  { ...item('drawers', 2.9, -10.9, 0.45, 0.6, 'e'), color: 'cherry', h: 0.75 },
  { ...item('chair', 4.0, -10.95, 0.45, 0.45, 's', false), color: 'metalDark' },
  ...[3.6, 4.5].map((u) => ({ ...item('chair', u, -9.8, 0.45, 0.45, 'n', false), color: 'metalDark' })),
  item('ceilingFan', 5.2, -10.45, 1.2, 1.2, 's', false),
  item('teacherDesk', 9.4, -9.95, 1.3, 0.7, 'n'),

  // Pasillo oeste: reja roja abierta contra el muro oeste y matafuego.
  { ...item('gate', 13.25, -10.3, 0.05, 1.6, 'e', false), color: 'red', h: 2.2 },
  item('extinguisher', 13.3, -14.6, 0.17, 0.17, 'e', false),

  // Cantina | Comedor (3:28–4:14). Al sur, contra el pasillo, la cantina:
  // línea de acero con los carteles PRO FOOD bajo el riel negro de campanas,
  // heladeras de bebidas, estantes de golosinas y la vitrina curva. Al norte
  // el comedor: mesas largas de tapa blanca y estructura verde con bancos
  // verdes, el jardín vertical, la tele y las cañas de bambú.
  item('buffetLine', 30.75, -19.4, 2.5, 0.75, 's'),
  { ...item('pendantRail', 30.65, -19.4, 3.8, 0.12, 's', false), y: 2.45 },
  item('displayCase', 32.4, -19.4, 0.8, 0.75, 's'),
  item('fridgeGlass', 31.0, -23.0, 0.75, 0.7, 's'),
  item('fridgeGlass', 31.8, -23.0, 0.75, 0.7, 's'),
  { ...item('shelf', 29.9, -23.18, 1.3, 0.45, 's'), color: 'board' },
  { ...item('counter', 32.45, -21.6, 0.6, 1.4, 'w'), color: 'render' },
  // Paneles símil hormigón detrás de la línea de servicio.
  { ...item('wallPanel', 30.65, -23.38, 4.2, 0.03, 's', false), y: 0, h: 2.7, color: 'render' },
  ...[-11.2, -13.0, -14.8, -16.6].map((v) => item('longTable', 29.75, v, 2.0, 0.8)),
  ...[-12.2, -14.2].map((v) => item('longTable', 31.95, v, 1.4, 0.6)),
  { ...item('greenWall', 32.75, -12.3, 3.4, 0.1, 'w', false), y: 1.0, h: 1.7 },
  { ...item('tv', 32.75, -10.05, 1.1, 0.06, 'w', false), y: 1.9 },
  // Al costado de la puerta al patio, no delante.
  item('bamboo', 32.45, -16.6, 0.45, 0.45),
  item('bamboo', 32.4, -11.0, 0.45, 0.45),

  // Espacio recreativo (2:00-2:13): cantero azul largo con pastos y asientos de
  // madera contra el lado norte, cantero angosto junto al pasillo oeste,
  // cantero de ladrillo, mástil, árboles, la palmera en su cantero con
  // asientos, banquitos cilíndricos rojos, aro de básquet y la galería del
  // comedor con columnas negras.
  // Termina antes de la hoja abierta de la puerta doble al pasillo norte.
  item('planter', 20.775, -22.95, 7.15, 0.9),
  ...[18.5, 20.85, 23.2].map((u) => ({ ...item('wallPanel', u, -22.62, 2.0, 0.3, 's', false), y: 0.6, h: 0.05, color: 'timberDark' })),
  item('planter', 17.0, -17.0, 0.8, 5.0),
  { ...item('planter', 17.35, -20.6, 1.5, 0.6), color: 'brick' },
  { ...item('flagpole', 17.9, -18.5, 0.1, 0.1), h: 8 },
  item('bareTree', 19.4, -21.9, 0.6, 0.6),
  { ...item('floorPatch', 25.0, -21.2, 2.5, 2.5, 's', false), color: 'darkGreen' },
  item('bareTree', 25.2, -21.4, 0.6, 0.6),
  // Macizo: la gente lo atravesaba (se sienta desde adelante, ver Places).
  { ...item('bench', 26.6, -20.4, 1.2, 0.4, 's'), color: 'timberDark' },
  item('planter', 24.75, -12.75, 2.4, 2.4),
  // 8,1 m: con 6 m las frondas entraban por el muro y el cielorraso de la
  // galería roja (a 1,7 m del tronco); así pasan por encima de su pretil.
  { ...item('palm', 24.75, -12.75, 0.4, 0.4), h: 8.1, y: 0.6 },
  ...[
    [24.75, -11.45, 2.4, 0.4],
    // Termina donde empieza el asiento del lado sur (sin encimarse en la esquina).
    [23.45, -12.8, 0.4, 2.3],
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
  // En el paño lleno entre dos ventanas del pasillo.
  item('hoop', 16.58, -21.0, 0.6, 0.45, 'e', false),

  // Frente del comedor al patio este: zócalo de bloque bajo la tira de
  // ventanas y toldo azul marino sobre la puerta vidriada.
  { ...item('wallPanel', 33.03, -22.0, 0.04, 2.6, 'e', false), y: 0, h: 1.08, color: 'block' },
  { ...item('wallPanel', 34.2, -24.0, 2.4, 3.0, 's', false), y: 2.85, h: 0.05, color: 'navy' },
  { ...item('wallPanel', 35.42, -24.0, 0.04, 3.0, 'e', false), y: 2.4, h: 0.5, color: 'navy' },
  // Bajo los muros negros de la pasarela, donde arranca su escalera (más baja
  // que el piso alto): cierran el costado del tramo, que desde el patio se
  // veía colgando con su losa y su baranda por debajo de la pasarela.
  ...[-13.525, -14.925].map((v) => ({ ...item('wallPanel', 36.35, v, 1.2, 0.15, 's', false), y: 2.13, h: 1.05, color: 'black' })),
  // Arena bajo los juegos.
  // Desde el pie de la escalera exterior (no por debajo de ella).
  { ...item('floorPatch', 42.125, -28.0, 15.35, 4.8, 's', false), color: 'sand' },

  // Patio este = "Espacio recreativo" de piso verde (9:40–10:06): franja
  // pintada de verde junto al comedor, jardincito con la palmera bajo la
  // pasarela, bicicletero, torre de juegos de madera con dos toboganes,
  // aviarios y la choza de paja contra la medianera (pintada de azul con
  // los azulejos de los chicos), hamacas, tobogán, domo trepador y el
  // cerco de cañas delante del muro norte del edificio de bloque.
  { ...item('floorPatch', 35.2, -20.2, 4.6, 10.5, 's', false), color: 'patioGreen' },
  { ...item('floorPatch', 39.7, -15.4, 4.4, 4.0, 's', false), color: 'gravel' },
  { ...item('palm', 39.8, -17.6, 0.4, 0.4), h: 3.6, y: 0 },
  item('tree', 37.9, -19.4, 0.6, 0.6),
  item('bikeRack', 34.8, -25.0, 1.8, 0.5, 'e'),
  item('playTower', 35.75, -28.7, 2.6, 2.2, 's'),
  // Más corto por el oeste: el pie de la escalera exterior quedaba a 15 cm
  // de su malla en la mitad del ancho.
  { ...item('aviary', 36.1, -32.5, 2.4, 1.2, 's'), color: 'red' },
  { ...item('aviary', 38.6, -31.8, 1.9, 1.2, 's'), color: 'chairGreen' },
  item('hut', 41.0, -31.3, 2.4, 1.8, 's'),
  item('swing', 45.0, -28.6, 2.6, 1.4, 's'),
  { ...item('slide', 47.4, -30.1, 2.0, 1.2, 's'), color: 'lime' },
  item('climber', 43.5, -25.4, 1.8, 1.8),
  // Cerco de cañas delante del muro norte del edificio de bloque.
  // Macizo, y el follaje del tamaño del ítem (SchoolBuilder): los chicos
  // caminaban a través del cerco.
  ...[37.9, 39.1, 40.3, 46.3, 47.5, 48.7].map((u) => item('hedge', u, -23.8, 1.2, 0.6, 's')),

  // Equipos de aire de la fachada sobre Laprida (0:04, Street View) y del
  // lado del patio oeste (2:02–2:07).
  ...(
    [
      [2.35, 5.8],
      [8.3, 5.8],
      [11.45, 5.8],
      [22.4, 6.8],
      [24.15, 6.8],
      [31.4, 6.8],
      [32.3, 3.75],
      [42.6, 3.7],
      [43.6, 3.7],
    ] as const
  ).map(([u, y]) => ({ ...item('condenser', u, 0.32, 0.8, 0.3, 's', false), y })),
  ...[20.9, 27.6].map((u) => ({ ...item('condenser', u, V.corrN + 0.3, 0.8, 0.3, 's', false), y: 3.6 })),

  // Recepción (0:18-0:34): banner al pie de la escalera, asientos de espera
  // negros frente al ventanal, columna con protección verde, cabina de
  // recepción roja y vidriada a la derecha de la entrada, placas de bronce,
  // parlante y split sobre el mural, y las bandas oscuras del piso.
  item('banner', 34.9, -8.95, 0.9, 0.4, 's'),
  item('seats', 38.42, -12.55, 1.65, 0.5, 's'),
  item('seats', 40.3, -12.55, 1.1, 0.5, 's'),
  { ...item('paddedColumn', 39.4, -10.6, 0.4, 0.4), color: 'darkGreen' },
  // Cabina larga y angosta contra el lado este, desde el acceso (0:28).
  // Termina antes de la puerta del aula del pasaje (antes la tapaba entera).
  item('booth', 41.0, -4.255, 1.7, 5.2, 'w'),
  item('plaques', 35.42, -3.3, 0.04, 0.6, 'e', false),
  { ...item('speaker', 33.12, -4.4, 0.22, 0.26, 'e', false), y: 2.68 },
  { ...item('ac', 33.13, -6.2, 0.22, 0.86, 'e', false), y: 2.75 },
  { ...item('floorPatch', 37.4, -5.1, 1.2, 7.0, 's', false), color: 'charcoal' },
  { ...item('floorPatch', 38.1, -9.8, 7.6, 0.5, 's', false), color: 'charcoal' },

  // Salón de los espejos = aula de danzas (recorrido 10:08–10:36): parquet,
  // columnas redondas rojas sobre los dos laterales con vigas negras, espejos
  // con marco rojo y barra negra sobre el muro de bloque del polideportivo,
  // piano, cómoda y afiches en el testero norte, banco rojo con percheros.
  ...SALON_COLUMNS.flatMap((v) => [
    { ...item('roundColumn', 42.32, v, 0.36, 0.36), color: 'red' },
    { ...item('roundColumn', 49.93, v, 0.36, 0.36), color: 'red' },
  ]),
  // Debajo de las bandas vidriadas hacia el polideportivo (de 2,05 m): con
  // 1,9 m de alto el marco tapaba 16 cm de cada banda.
  ...[-12.9, -16.1, -18.75].map((v) => ({ ...item('mirror', 50.17, v, 0.04, 1.9, 'w', false), color: 'red', h: 1.66 })),
  // Barra sobre el muro de espejos, cortada en cada columna roja.
  ...[
    [-18.6, 1.0],
    [-16.125, 2.35],
    [-13.6, 1.7],
  ].map(([v, d]) => ({ ...item('barre', 49.88, v, 0.06, d, 'w'), color: 'metalDark' })),
  // Barra de pie, suelta, frente a la ventana del oeste.
  { ...item('barre', 43.1, -17.6, 0.06, 2.4, 'e'), color: 'metalDark' },
  item('piano', 44.0, -20.38, 1.5, 0.55, 's'),
  item('drawers', 46.5, -20.45, 1.8, 0.42, 's'),
  { ...item('drawers', 48.4, -20.5, 0.9, 0.34, 's'), h: 0.65 },
  item('coatBench', 42.38, -16.1, 0.42, 1.8, 'e'),
  // Ventiladores en los paños llenos, no sobre ventanas ni bandas.
  item('fan', 42.15, -15.3, 0.3, 0.3, 'e', false),
  item('fan', 42.15, -20.45, 0.3, 0.3, 'e', false),
  item('fan', 50.15, -14.2, 0.3, 0.3, 'w', false),
  item('speaker', 42.2, -12.0, 0.26, 0.22, 'e', false),
  item('speaker', 50.085, -19.62, 0.26, 0.22, 'w', false),

  // Polideportivo: la cancha corre de oeste a este, con los arcos en los
  // testeros; las gradas de chapa negra van contra el lateral de Laprida y
  // las pilastras llevan protección verde abajo y roja arriba.
  // El arco oeste está corrido hacia la esquina norte, contra el bloque: en
  // el centro del testero está la puerta doble del pasaje (cuadro 9:20).
  item('goal', 51.25, -13.0, 0.8, 3.1, 'e'),
  item('goal', 66.45, GYM_MID, 0.8, 3.1, 'w'),
  // Gradas delante de las pilastras (no metidas en ellas).
  // La última deja libre la puerta roja de la esquina.
  ...[56.3, 59.2, 62.1, 65.0].map((u) => item('bleachers', u, -1.68, 2.7, 2.4, 'n')),
  ...GYM_PILASTERS.flatMap((u) => [item('padPilaster', u, -20.55, 0.42, 0.3, 's'), item('padPilaster', u, -0.32, 0.42, 0.3, 'n')]),
  { ...item('wallMat', 67.2, -1.5, 0.1, 1.7, 'w', false), color: 'red', h: 1.9 },
  { ...item('wallMat', 66.3, -20.65, 1.6, 0.1, 's', false), color: 'red', h: 1.9 },

  // Arte y Teatro.
  item('table', 52.1, -25.5, 1.1, 2.2),
  item('stage', 55.8, -27.0, 3.5, 2.6, 's'),
  item('curtain', 55.8, -25.6, 3.5, 0.1, 's', false),
  item('seats', 56.2, -24.3, 2.0, 0.5, 'n'),

  // V. Damas: cubículos.
  item('stall', 66.4, -25.84, 1.4, 1.2, 'w'),
  item('stall', 66.4, -24.5, 1.4, 1.2, 'w'),
];

export const ITEMS: readonly Item[] = [...ITEMS_PB, ...UPPER_ITEMS, ...JARDIN_ITEMS];

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
      out.push({ y: SCHOOL.floorY + l.y, solidBelow: l.y < 3 && !l.hollow });
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
  // Del lado de la vereda, fuera del cerco (0:04–0:08, Street View).
  { u0: 0.4, v0: 0.95, u1: 14.8, v1: 1.85 },
  { u0: 16.8, v0: 0.95, u1: 32.4, v1: 1.85 },
  { u0: 42.4, v0: 0.95, u1: 49.8, v1: 1.85 },
];

/** Línea del cerco sobre Laprida: pegado a la fachada, sobre el muro bajo rojo. */
const FENCE_V = 0.6;

/** Reja sobre la línea municipal: tramos con su abertura para pasar. */
export const FENCES: readonly (readonly [P, P])[] = [
  [
    [miguelCaneU(FENCE_V), FENCE_V],
    [15.4, FENCE_V],
  ],
  [
    [16.2, FENCE_V],
    [32.9, FENCE_V],
  ],
  [
    [42.0, FENCE_V],
    [50.2, FENCE_V],
  ],
  // Sobre Miguel Cané, hasta el muro del ala oeste, con portón de salida.
  [
    [miguelCaneU(FENCE_V), FENCE_V],
    [miguelCaneU(-4.6), -4.6],
  ],
  // Y vuelve a la esquina del edificio: la salida de emergencia del ochavo
  // da a la vereda (antes el cerco pasaba por delante, entre sus hojas).
  [
    [miguelCaneU(-6.8), -6.8],
    [U.w - SCHOOL.extT / 2, V.classTop],
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
