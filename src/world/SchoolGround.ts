import {
  APEX,
  SCHOOL,
  U,
  V,
  hw,
  item,
  mc,
  miguelCaneU,
  rear,
  rearV,
  MC_SLOPE,
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
  type Stair,
  type Landing,
  type Volume,
  type Wall,
} from './SchoolBase';
import { JARDIN_ITEMS, JARDIN_LANDINGS, JARDIN_ROOMS, JARDIN_STAIRS, JARDIN_VOIDS, JARDIN_WALLS } from './SchoolJardin';
import { U1, UPPER_ITEMS, UPPER_LANDINGS, UPPER_ROOMS, UPPER_STAIRS, UPPER_VOIDS, UPPER_VOLUMES, UPPER_WALLS, V1 } from './SchoolUpper';

/*
 * Datos de la planta baja (y los agregados de los tres niveles) en METROS DEL
 * PLANO CAD, tal como se leyeron. Nadie fuera de `SchoolLayout` los importa:
 * la fachada los pasa a metros reales con `SC` (ver `SchoolScale`). Por eso
 * todo lo exportado lleva `PLAN_`: así no se confunde con lo real.
 */

const H = SCHOOL.storey;

/** Muro con terminación propia sobre la cara de ciertos ambientes. */
const wallFinish = (w: Wall, finish: Record<string, string>): Wall => ({ ...w, finish });

/**
 * Planta baja de la escuela CIMDIP & Miguel Cané.
 *
 * Sale del plano de evacuación en CAD de la planta baja (el PDF "Planos de
 * Evacuación"), pasado a metros con el frente de 67,4 m sobre Laprida: muros,
 * puertas, escaleras, sanitarios y la diagonal de Miguel Cané. Así un aula
 * sobre Laprida mide 6,5 × 6,2 m, el pasillo sur 2,3 m y el patio central
 * 12,5 × 12,4 m. Lo que el CAD no dibuja porque es más nuevo (edificio de
 * bloque, Arte, Teatro, el jardín, Tecnología, la galería roja, la escalera
 * blanca) sale de la foto del plano de S&O Consultores y del recorrido de
 * 2020, apoyado en las mismas líneas. Alturas y escalones, del recorrido.
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


/** Lado este de las aulas del primer piso sobre el patio este (aulaNE del CAD). */
const NE_E = 38.5;
/** Escalera del hall: borde este del primer tramo (lo que no tiene muro en el testero norte). */
const HALL_STAIR_E = 33.85;
/** Descanso del ala oeste: su borde este (donde arranca el segundo tramo). */
const WEST_LANDING_E = 7.15;
/** Bajo un descanso hueco de 2,45 m el muro llega hasta su losa (24 cm). */
const LANDING_UNDER = SCHOOL.floorY + 2.45 - 0.24;

const WALLS_PB: Wall[] = [
  // --- Fachada sobre Laprida -------------------------------------------------
  // Diez ventanas en los extremos de cada aula, medidas sobre la toma de la
  // fachada (0:00–0:08): no están a un cuarto del aula sino cerca de los
  // tabiques. La novena se corre 20 cm: el tabique del CAD (u 26,01) la cortaba.
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
        [26.2, 27.88],
        [29.99, 31.68],
      ] as const
    ).map(([a, b]): Op => [a, b, 'window', 1.27, 2.29]),
  ),
  // Atrio del acceso (CAD: el hall está retirado 2,3 m de la línea de
  // fachada): el muro llega sólo hasta detrás de cada pilar de granito.
  hw(V.facade, U.east1, U.east1 + 0.45, 'ext'),
  hw(V.facade, U.salonW - 0.45, U.salonW, 'ext'),
  // Edificio de bloque sobre Laprida: ladrillo pintado de blanco y ventanas
  // de marco negro con malla romboidal (0:12–0:16).
  {
    ...hw(V.facade, U.salonW, U.gymW, 'ext', roomWindows(U.salonW, U.gymW).map(([a, b, t]): Op => [a, b, t, undefined, undefined, 'metalDark', 'mesh'])),
    ext: 'brickWhite',
  },
  // Lateral sur del polideportivo (Laprida): salida de emergencia y la tira de
  // claraboyas entre las pilastras; adentro van las gradas.
  // La salida de emergencia queda en el primer paño, entre la esquina y la
  // primera pilastra (u 53,15): el CAD la da de 50,75 a 54,15, pero así
  // cortaba la pilastra; se sigue el video y el plano de S&O (2,1 m).
  hw(V.facade, U.gymW, U.e, 'ext', [[50.75, 52.85, 'exit'], ...GYM_CLERESTORY, [66.3, 67.2, 'door', undefined, undefined, 'red']], SCHOOL.gymWall),

  // --- Miguel Cané: ochavo, ala oeste, nicho y Tecnología -------------------
  vw(U.w, V.classTop, V.facade, 'ext', [[-4.3, -2.7, 'window']]),
  // Ochavo (CAD): el aula 1 llega casi a la diagonal y el pasillo sur remata
  // en un testero recto con la salida de emergencia; entre los dos queda un
  // rincón de vereda.
  hw(V.classTop, U.w, U.jog, 'ext'),
  vw(U.jog, V.classTop, V.jogN, 'ext', [[-6.35, -8.1, 'exit']]),
  // Sobre la diagonal, un tramo por ambiente: la ventana con persiana de
  // Dirección, la caja de la escalera (ciega), las dos ventanas altas de la
  // Sala de profesores, la de Administración y el fondo ciego del pasillo norte.
  seg(mc(V.jogN), mc(V.dirTop), 'ext', [[-8.95, -10.05, 'window']]),
  seg(mc(V.dirTop), mc(V.profB), 'ext'),
  seg(mc(V.profB), mc(V.admB), 'ext', [
    [-13.5, -14.7, 'window', 1.9, 2.5],
    [-15.3, -16.8, 'window', 1.9, 2.5],
  ]),
  seg(mc(V.admB), mc(V.admN), 'ext', [[-18.2, -19.8, 'window']]),
  seg(mc(V.admN), mc(V.nBlockS), 'ext'),
  // Nicho: la salida del pasillo norte a Miguel Cané (CAD, cartel de SALIDA).
  seg(mc(V.nBlockS), mc(V.nBlockN), 'ext', [[-26.55, -28.33, 'exit']]),
  // Aula Maker: dos ventanas altas en tira sobre el pizarrón interactivo.
  seg(mc(V.nBlockN), APEX, 'ext', [
    [-33.95, -34.9, 'window', 2.3, 2.85],
    [-35.0, -35.95, 'window', 2.3, 2.85],
  ]),

  // --- Medianera del fondo ----------------------------------------------------
  seg(APEX, rear(U.tecE), 'ext'),
  // Bajo las aulas del primer piso sobre el patio este la medianera llega sólo
  // a la losa: arriba sigue el muro del aula. Más alta, sus caras se
  // encimaban con las de ese muro.
  seg(rear(U.tecE), rear(NE_E), 'medianera'),
  seg(rear(NE_E), rear(41.5), 'medianera', [], 3.6),
  // Al fondo del patio la medianera está pintada de azul francia, con los
  // azulejos pintados por los chicos (9:52–9:58).
  { ...seg(rear(41.5), rear(U.gymW), 'medianera', [], 3.6), ext: 'blue' },
  seg(rear(U.gymW), rear(U.teaE), 'ext'),
  // Dentro del predio del jardín la medianera vieja es su muro sur, con puerta.
  // Vano de 1,29 m: puerta de dos hojas (una sola hoja de ese ancho no existe).
  seg(rear(U.teaE), rear(U.e), 'int', [[60.75, 62.0, 'double', undefined, undefined, 'frame']]),

  // --- Tecnología (Aula Maker) y bloque norte (CAD) -------------------------
  // Testero este del Aula Maker: el portón del CAD, salida al patio este.
  vw(U.tecE, rearV(U.tecE), V.nBlockN, 'int', [[-31.3, -33.6, 'exit']]),
  // Al Aula Maker se entra por una puerta vidriada en su punta sudoeste, al
  // final del pasillo que sale del pasillo norte (2:28–2:32); al norte abren
  // también E.P, el depósito del núcleo y el aula del bloque norte (CAD).
  // (La puerta del Aula Maker, 10 cm al este del CAD: abierta, la punta de
  // la hoja se metía 3 cm en el muro de la diagonal.)
  hw(V.nBlockN, miguelCaneU(V.nBlockN), U.east1, 'int', [
    [12.8, 13.8, 'door', undefined, undefined, 'frame'],
    [17.35, 19.15, 'double'],
    [21.8, 22.95, 'door', undefined, undefined, 'frame'],
    [27.05, 28.65, 'double'],
  ]),
  vw(U.epW, V.nBlockN, V.nBlockS),
  // E.P se ve desde el pasillo del Aula Maker por dos ventanas.
  vw(U.epCorrE, V.nBlockN, V.nBlockS, 'int', [
    [-25.6, -26.4, 'window', 1.0, 2.0],
    [-27.0, -29.0, 'window', 1.0, 2.2],
  ]),
  vw(U.epE, V.nBlockN, V.nBlockS),
  // Núcleo de sanitarios (CAD): dos baños en L alrededor de un recodo del
  // pasillo, donde están sus puertas (3:22–3:28, la entrada a los baños de
  // alumnos), el pozo de luz cerrado y un depósito. No hay escalera: ni el
  // CAD ni el recorrido la muestran.
  vw(U.notchW, V.notchN, V.nBlockS, 'int', [[-23.58, -24.76, 'door', undefined, undefined, 'frame']]),
  vw(U.notchE, V.notchN, V.nBlockS, 'int', [[-23.59, -24.75, 'door', undefined, undefined, 'frame']]),
  hw(V.notchN, U.notchW, U.notchE),
  vw(U.bathDiv, V.wellS, V.notchN),
  hw(V.wellS, U.epE, U.stairE),
  hw(V.wellN, U.epE, U.stairE),
  vw(U.stairE, V.nBlockN, V.nBlockS, 'int', [[-28.82, -29.97, 'door', undefined, undefined, 'frame']]),
  // Frente del bloque norte al pasillo: el nicho de la salida, la boca del
  // pasillo del Aula Maker, la puerta doble de E.P y la del aula (CAD).
  hw(V.nBlockS, miguelCaneU(V.nBlockS), U.notchW, 'int', [
    [9.12, 10.3, 'door', undefined, undefined, 'frame'],
    [12.4, 14.2, 'pass'],
    [17.35, 19.15, 'double'],
  ]),
  hw(V.nBlockS, U.notchE, U.east1, 'int', [[27.05, 28.65, 'double']]),

  // --- Pasillo norte: lado sur y su fin ---------------------------------------
  // Frente de Administración (2:14–2:30): ventanilla de atención y puerta roja.
  hw(V.admN, miguelCaneU(V.admN), U.wcW, 'int', [
    [7.85, 8.75, 'counter'],
    [8.95, 10.26, 'double', undefined, undefined, 'red'],
  ]),
  hw(V.wcN, U.wcW, U.wingE),
  // Lado norte del Espacio recreativo: ventanas sobre el cantero largo y la
  // puerta doble roja vidriada (la del CAD).
  hw(V.corrN, U.patioW, U.bufW, 'int', [
    [15.3, 17.2, 'window', 1.25, 2.2],
    [17.7, 19.6, 'window', 1.25, 2.2],
    [20.1, 22.0, 'window', 1.25, 2.2],
    [22.45, 24.05, 'double', undefined, undefined, 'red'],
    [24.55, 26.45, 'window', 1.25, 2.2],
  ]),
  hw(V.corrN, U.bufW, U.east1),
  // Al final del pasillo norte, puertas dobles vidriadas a un local chico y de
  // ahí al patio este (3:22–3:28); el recorrido sigue a la cantina (3:29).
  vw(U.endW, V.corrN, V.nBlockS, 'int', [[-21.46, -22.73, 'double', undefined, undefined, 'frame']]),
  // Lado del patio este del local y del aula del bloque norte.
  // Video 2026 (0:26–0:31): al norte de la puerta, el ventanal del comedor
  // en aluminio blanco sobre su antepecho de bloque.
  vw(U.east1, V.nBlockN, V.corrN, 'int', [
    [-21.4, -22.8, 'double', undefined, undefined, 'frame'],
    [-23.6, -25.6, 'window', 1.0, 2.6, 'frame', 'none'],
  ]),

  // --- Ala oeste: Dir. Prim, Preceptoría, escalera, PROF., ADM y baños (CAD) --
  // Frente norte del pasillo sur: la puerta de Dirección y la ventana interior
  // de la Preceptoría (1:22–1:26).
  hw(V.corrS, miguelCaneU(V.corrS), U.wingE, 'int', [
    [3.8, 4.8, 'door'],
    [9.4, 10.9, 'window', 1.2, 2.4],
  ]),
  vw(U.dirDiv, V.dirTop, V.corrS),
  vw(U.wingE, V.dirTop, V.corrS),
  // Escalera del ala oeste: bajo el descanso el muro llega sólo hasta su losa
  // (2,08 m); entero, el descanso lo atravesaba. Al este, la puerta de la
  // Preceptoría al pie de la escalera.
  hw(V.dirTop, miguelCaneU(V.dirTop), U.dirDiv),
  hw(V.dirTop, U.dirDiv, WEST_LANDING_E, 'int', [], 2.08),
  hw(V.dirTop, WEST_LANDING_E, U.wingE, 'int', [[10.91, 12.22, 'double', undefined, undefined, 'red']]),
  // Testero oeste de la caja de la escalera, en el plano del muro de la
  // Gerencia del primer piso (el muro que se ve al subir, 7:46–7:58). Sin él
  // el descanso de 2,2 m terminaba en el aire sobre un rincón sin salida
  // contra la diagonal: el que se caía quedaba encerrado.
  vw(U.dirDiv, V.dirTop, V.profB),
  // La caja de la escalera se abre al pasillo oeste; al norte, PROF.
  hw(V.profB, miguelCaneU(V.profB), U.wingE, 'int', [[10.87, 12.18, 'double', undefined, undefined, 'frame']]),
  // Sala de profesores: ventana interior al pasillo oeste (D2).
  vw(U.wingE, V.profB, V.wcS, 'int', [[-13.4, -15.2, 'window', 1.0, 2.1]]),
  hw(V.admB, miguelCaneU(V.admB), U.wcW),
  // Columna de baños entre PROF./ADM y el pasillo oeste: tres cubículos que
  // abren al pasillo (CAD). Asoma 0,6 m en el pasillo norte. Puertas de
  // 85 cm, no las 73–77 del CAD (dentro de su error): cada jamba frena 30 cm
  // del cuerpo y con las del plano había que acertarle al centro.
  hw(V.wcS, U.wcW, U.wingE),
  vw(U.wcW, V.wcS, V.wcN),
  vw(U.wingE, V.wcS, V.wcN, 'int', [
    [-16.1, -16.95, 'door', undefined, undefined, 'frame'],
    [-18.6, -19.45, 'door', undefined, undefined, 'frame'],
    [-19.8, -20.65, 'door', undefined, undefined, 'frame'],
  ]),
  hw(V.wcP1, U.wcW, U.wingE),
  hw(V.wcP2, U.wcW, U.wingE),

  // --- Patio central y buffet (CAD) -------------------------------------------
  // Pasillo oeste → patio: la puerta doble roja vidriada y ventanas corredizas.
  vw(U.patioW, V.corrN, V.corrS, 'int', [
    [-9.0, -10.5, 'window', 1.24, 2.3],
    [-10.93, -12.43, 'double', undefined, undefined, 'red'],
    [-13.6, -15.6, 'window', 1.24, 2.4],
    [-16.4, -18.4, 'window', 1.24, 2.4],
    [-19.0, -20.6, 'window', 1.24, 2.4],
  ]),
  // Pasillo sur → patio: corredizas entre pilares y el paso abierto.
  hw(V.corrS, U.patioW, U.bufW, 'int', [
    [15.25, 17.15, 'window', 1.24, 2.4],
    [17.45, 19.35, 'window', 1.24, 2.4],
    [19.65, 21.55, 'window', 1.24, 2.4],
    [22.23, 23.81, 'pass'],
    [24.2, 26.1, 'window', 1.24, 2.4],
  ]),
  // Comedor hacia el patio: paños vidriados con marco de madera oscura y la
  // puerta del CAD.
  vw(U.bufW, V.corrN, V.corrS, 'int', [
    [-8.85, -10.95, 'window', 0.9, 2.4, 'timberDark'],
    [-11.35, -13.45, 'window', 0.9, 2.4, 'timberDark'],
    [-13.85, -15.95, 'window', 0.9, 2.4, 'timberDark'],
    [-16.35, -18.45, 'window', 0.9, 2.4, 'timberDark'],
    [-18.8, -20.3, 'double', undefined, undefined, 'timberDark'],
  ]),
  // Frente de la cantina al pasillo: puerta doble y paño vidriado sobre zócalo rojo.
  hw(V.corrS, U.bufW, U.east1, 'int', [
    [27.86, 29.47, 'double'],
    [29.8, 32.2, 'window', 1.2, 2.6],
  ]),
  // Frente del comedor al patio este (10:00–10:05): puerta de chapa bajo la
  // escalera exterior y la puerta vidriada de la cantina. Video 2026 (0:31):
  // del lado del patio, revoque liso claro sobre la escalera (no bloque).
  wallFinish(
    vw(U.east1, V.corrN, V.corrS, 'int', [
      [-15.25, -16.15, 'door', undefined, undefined, 'frame'],
      [-19.75, -20.7, 'door', undefined, undefined, 'frame'],
    ]),
    { patioEste: 'facade' },
  ),

  // --- Aulas sobre Laprida (CAD: cinco iguales de 6,5 × 6,2 m) ----------------
  hw(V.classTop, U.jog, U.east1, 'int', [
    [4.55, 6.15, 'double', undefined, undefined, 'frame'],
    [11.2, 12.75, 'double', undefined, undefined, 'frame'],
    [17.65, 19.25, 'double', undefined, undefined, 'frame'],
    [24.2, 25.8, 'double', undefined, undefined, 'frame'],
    [26.4, 27.95, 'double', undefined, undefined, 'frame'],
  ]),
  vw(U.c2, V.classTop, V.facade),
  vw(U.c3, V.classTop, V.facade),
  vw(U.c4, V.classTop, V.facade),
  vw(U.c5, V.classTop, V.facade),
  vw(U.east1, V.classTop, V.facade),

  // --- Hall de acceso, recepción y torre de la escalera (CAD) -----------------
  // Frente del hall con la entrada vidriada; delante queda el atrio, bajo el
  // primer piso.
  hw(V.hallDoors, U.east1, U.recW, 'int', [[34.2, 36.27, 'entrance']]),
  // Oficina de recepción, a la DERECHA al entrar (CAD; el recorrido muestra la
  // cabina vidriada del lado este): la portería al sur, con su puerta al
  // atrio, la puerta de madera y la ventanilla al vestíbulo; una oficina al norte.
  hw(V.hallDoors, U.recW, U.salonW, 'int', [[37.27, 38.46, 'door', undefined, undefined, 'frame']]),
  // Video 2026 (0:03–0:05): el frente al vestíbulo es un mostrador corrido
  // de frente rojo con tapa blanca y, encima, un vidriado de aluminio blanco
  // hasta 2,6 m. La puerta de la portería queda (es la única entrada a la
  // celda sur además de la del atrio, que la historia tiene con llave), de
  // aluminio blanco.
  vw(U.recW, V.recB, V.hallDoors, 'int', [
    [-2.45, -3.25, 'door', undefined, undefined, 'frame'],
    [-3.33, -3.9, 'counter', 1.05, 2.05],
    [-4.15, -5.38, 'window', 1.05, 2.6, 'frame', 'none'],
  ]),
  hw(V.recN, U.recW, U.salonW),
  hw(V.recB, U.recW, U.salonW, 'int', [[38.95, 40.15, 'door', undefined, undefined, 'frame']]),
  // Testero norte del hall (0:24–0:34, 4:16). Al oeste no hay muro: la
  // escalera "Acceso al Nivel Secundario" sube por ahí a la torre. Bajo la
  // losa del descanso queda un cuartito con su puerta (CAD, 70 cm; acá 85,
  // como los cubículos: con la del plano había que pasar justo por el
  // centro); después, la puerta de aluminio al jardincito y el ventanal
  // sobre el zócalo de mármol.
  hw(V.hallTop, HALL_STAIR_E, U.kioskE, 'int', [[34.2, 35.05, 'door', undefined, undefined, 'frame']], LANDING_UNDER),
  {
    ...hw(V.hallTop, U.kioskE, U.salonW, 'int', [
      // Video 2026 (0:06–0:10): puerta vidriada simple de aluminio blanco,
      // corrida al este; entre ella y la torre queda el rincón del cantero
      // en L con las macetas.
      [37.05, 38.0, 'door', undefined, undefined, 'frame'],
      // Del lado del patio, vidriado de aluminio blanco casi hasta el piso (1:40).
      [38.3, 40.3, 'window', 0.05, 2.75, 'frame'],
    ]),
    // Del lado del patio: verde oliva en 2020 (10:08); revoque liso gris
    // claro en el video de 2026 (0:08–0:12).
    finish: { patioEste: 'facade' },
  },
  // Torre de la escalera, de dos plantas: al norte llega la escalera exterior
  // blanca del patio este, al este sale la pasarela vidriada (a la altura del
  // descanso).
  vw(U.kioskE, V.kiosk, V.hallTop, 'ext', [[-13.6, -14.85, 'pass', 2.45, 4.6]], 2 * H),
  hw(V.kiosk, U.east1, U.kioskE, 'ext', [[32.64, 33.72, 'pass', 2.45, 4.6]], 2 * H),
  // Lado del hall y del patio este del edificio de bloque: la puerta del aula
  // del pasaje, "Acceso al Polideportivo" y la del salón (CAD), y del lado del
  // jardincito las ventanas enrejadas y la puerta doble (10:08–10:20).
  wallFinish(vw(U.salonW, V.gymTop, V.facade, 'int', [
    [-19.3, -19.75, 'window', 1.2, 2.3],
    [-17.8, -19.1, 'double', undefined, undefined, 'frame'],
    [-15.7, -17.2, 'window', 1.2, 2.3],
    [-13.45, -14.35, 'window', 1.2, 2.3],
    [-11.28, -12.42, 'double'],
    // "Acceso al Polideportivo": puerta doble de aluminio blanco.
    // Corrida al sur (hacia Laprida) respecto del CAD, lo justo para que la
    // columna acolchada del hall no tape una de sus hojas (el jugador sólo
    // pasaba por una mitad).
    [-9.2, -10.7, 'double', undefined, undefined, 'frame'],
    [-6.8, -8.34, 'double', undefined, undefined, 'red'],
    // Video 2026 (0:07–0:25): del lado del patio, pintura lisa gris claro.
  ]), { patioEste: 'facade' }),

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
  // Frente de Arte al patio (video 2026, 1:04–1:09): bloque claro a la
  // vista, de sur a norte la puerta del pasillo del jardín, una ventana
  // corrediza de aluminio gris con vidrio oscuro y una puerta blanca de seis
  // vidrios; la pilastra blanca cierra el tramo al norte.
  wallFinish(
    vw(U.gymW, rearV(U.gymW), V.artB, 'int', [
      [-23.1, -24.85, 'window', 1.0, 2.0, 'alu', 'none'],
      [-25.6, -26.45, 'door', undefined, undefined, 'frame'],
    ]),
    { patioEste: 'blockLight' },
  ),
  // Video 2026 (1:08): la puerta del patio al pasillo es de una sola hoja blanca.
  wallFinish(vw(U.gymW, V.artB, V.gymTop, 'int', [[-22.25, -21.2, 'door', undefined, undefined, 'frame']]), { patioEste: 'blockLight' }),
  vw(U.artE, rearV(U.artE), V.artB),
  vw(U.teaE, rearV(U.teaE), V.artB),
  // Video 2026 (1:13–1:20): Arte y Teatro se ven desde el pasillo por paños
  // vidriados de aluminio con antepecho de 0,9 m.
  hw(V.artB, U.gymW, U.teaE, 'int', [
    [50.5, 51.3, 'window', 0.9, 2.1, 'alu', 'none'],
    [51.5, 53.2, 'double', undefined, undefined, 'frame'],
    [54.1, 56.0, 'double', undefined, undefined, 'frame'],
    [56.25, 57.45, 'window', 0.9, 2.1, 'alu', 'none'],
  ]),
  // Puertas de hoja roja maciza con marco rojo (video 2026, 1:22–1:28).
  vw(U.vdW, rearV(U.vdW), V.gymTop, 'int', [
    [-26.45, -25.45, 'door', undefined, undefined, 'red', 'none'],
    [-22.15, -21.15, 'door', undefined, undefined, 'red', 'none'],
  ]),
  // Fin del pasillo de Arte y Teatro (video 2026, 1:20–1:22): marco y hoja
  // de chapa negra, abierta hacia el hall del jardín.
  vw(U.teaE, V.artB, V.gymTop, 'int', [[-22.3, -21.25, 'door', undefined, undefined, 'black', 'none']]),
  hw(V.vdB, U.vdW, U.e),
  vw(66.0, -21.85, V.gymTop),
  hw(-21.85, 66.0, U.e),
  vw(U.e, rearV(U.e), V.gymTop, 'ext', [[-24.6, -23.9, 'window']]),
];

export const PLAN_WALLS: readonly Wall[] = [...WALLS_PB, ...UPPER_WALLS, ...JARDIN_WALLS];

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
    // Remata al oeste en el testero de la salida, no en la diagonal (CAD).
    poly: [[U.jog, V.classTop], [U.east1, V.classTop], [U.east1, V.corrS], mc(V.corrS), [U.jog, V.jogN]],
    floor: 'tile',
    roofed: true,
  },
  { id: 'dirPrim', name: 'Dir. Prim', caption: 'Dirección primaria', poly: [mc(V.dirTop), [U.dirDiv, V.dirTop], [U.dirDiv, V.corrS], mc(V.corrS)], floor: 'terracotta', roofed: true },
  { id: 'sala', name: 'Preceptoría', caption: 'Preceptoría primaria', poly: rect(U.dirDiv, V.dirTop, U.wingE, V.corrS), floor: 'terracotta', roofed: true },
  {
    // La caja de la escalera "Acceso a primer piso", abierta al pasillo oeste.
    // Termina en su testero oeste (u 5,5): la cuña contra Miguel Cané queda
    // cerrada, bajo la Gerencia del primer piso.
    id: 'hallOeste',
    name: 'Pasillo',
    poly: rect(U.dirDiv, V.profB, U.wingE, V.dirTop),
    floor: 'tile',
    roofed: true,
  },
  {
    id: 'prof',
    name: 'Prof.',
    caption: 'Sala de profesores',
    poly: [mc(V.admB), [U.wcW, V.admB], [U.wcW, V.wcS], [U.wingE, V.wcS], [U.wingE, V.profB], mc(V.profB)],
    floor: 'tile',
    roofed: true,
  },
  { id: 'adm', name: 'ADM', caption: 'Administración', poly: [mc(V.admN), [U.wcW, V.admN], [U.wcW, V.admB], mc(V.admB)], floor: 'tile', roofed: true },
  { id: 'wcAdm', name: 'Sanitarios', poly: rect(U.wcW, V.wcN, U.wingE, V.wcS), floor: 'ceramic', roofed: true },
  { id: 'pasilloOeste', name: 'Pasillo', poly: rect(U.wingE, V.corrN, U.patioW, V.corrS), floor: 'tile', roofed: true },
  { id: 'patioOeste', name: 'Patio aire libre', caption: 'Espacio recreativo', poly: rect(U.patioW, V.corrN, U.bufW, V.corrS), floor: 'patio', roofed: false },
  { id: 'buffet', name: 'Buffet', caption: 'Cantina y comedor', poly: rect(U.bufW, V.corrN, U.east1, V.corrS), floor: 'checker', roofed: true },
  {
    id: 'pasilloNorte',
    name: 'Pasillo',
    // De la diagonal al local del fondo, con el recodo de la entrada a los
    // baños y la columna de baños del ala oeste que asoma (CAD).
    // (Empieza en la columna de baños: arrancando en la diagonal, el recorte
    // en orejas dejaba un triángulo de área nula sobre el lado norte.)
    poly: [
      [U.wcW, V.admN],
      [U.wcW, V.wcN],
      [U.wingE, V.wcN],
      [U.wingE, V.corrN],
      [U.endW, V.corrN],
      [U.endW, V.nBlockS],
      [U.notchE, V.nBlockS],
      [U.notchE, V.notchN],
      [U.notchW, V.notchN],
      [U.notchW, V.nBlockS],
      mc(V.nBlockS),
      mc(V.admN),
    ],
    floor: 'tile',
    roofed: true,
  },
  // Local al final del pasillo norte, entre sus puertas vidriadas y el patio este.
  { id: 'localFinNorte', name: '', poly: rect(U.endW, V.nBlockS, U.east1, V.corrN), floor: 'tile', roofed: true },
  { id: 'pasilloMaker', name: 'Pasillo', caption: 'Hacia el Aula Maker', poly: rect(U.epW, V.nBlockN, U.epCorrE, V.nBlockS), floor: 'ceramic', roofed: true },
  { id: 'ep', name: 'E.P', poly: rect(U.epCorrE, V.nBlockN, U.epE, V.nBlockS), floor: 'tile', roofed: true },
  // Baños de alumnos: dos en L alrededor del recodo del pasillo (3:22–3:28).
  {
    id: 'salaNorte',
    name: 'Sanitarios',
    caption: 'Toilette alumnos',
    poly: [
      [U.epE, V.nBlockS],
      [U.notchW, V.nBlockS],
      [U.notchW, V.notchN],
      [U.notchE, V.notchN],
      [U.notchE, V.nBlockS],
      [U.stairE, V.nBlockS],
      [U.stairE, V.wellS],
      [U.epE, V.wellS],
    ],
    floor: 'ceramic',
    roofed: true,
  },
  { id: 'depositoNucleo', name: '', poly: rect(U.epE, V.nBlockN, U.stairE, V.wellN), floor: 'tile', roofed: true },
  { id: 'aulaNorte', name: '', poly: rect(U.stairE, V.nBlockN, U.east1, V.nBlockS), floor: 'tile', roofed: true },
  { id: 'nicho', name: '', poly: [mc(V.nBlockN), [U.epW, V.nBlockN], [U.epW, V.nBlockS], mc(V.nBlockS)], floor: 'tile', roofed: true },
  { id: 'tecnologia', name: 'Tecnología', caption: 'Aula Maker', poly: [APEX, rear(U.tecE), [U.tecE, V.nBlockN], mc(V.nBlockN)], floor: 'green', roofed: true },
  // La caja al norte del hall es la torre de la escalera (0:24, 4:21–4:30).
  { id: 'torreHall', name: 'Escalera', caption: 'Acceso al Nivel Secundario', poly: rect(U.east1, V.kiosk, U.kioskE, V.hallTop), floor: 'tile', roofed: true },
  { id: 'recepcionOf', name: '', caption: 'Oficina de recepción', poly: rect(U.recW, V.recB, U.salonW, V.hallDoors), floor: 'tile', roofed: true },
  {
    id: 'hall',
    name: 'Hall de acceso',
    caption: 'Recepción',
    // El hall incluye el atrio bajo el primer piso y rodea la oficina de
    // recepción, a la derecha de la entrada (CAD).
    poly: [
      [U.east1, V.hallTop],
      [U.salonW, V.hallTop],
      [U.salonW, V.recB],
      [U.recW, V.recB],
      [U.recW, V.hallDoors],
      [U.salonW, V.hallDoors],
      [U.salonW, V.facade],
      [U.east1, V.facade],
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
  // Vestuario (video 2026, 1:28): piso cerámico terracota (suena como el granito).
  { id: 'vDamas', name: 'V. Damas', poly: [rear(U.vdW), rear(U.e), [U.e, V.vdB], [U.vdW, V.vdB]], floor: 'tile', floorLook: 'terracotta', roofed: true },
  { id: 'sanitario', name: '', poly: rect(U.vdW, V.vdB, U.e, V.gymTop), floor: 'tile', roofed: true },
  {
    id: 'hallJardin',
    name: 'Pasillo',
    poly: [rear(U.teaE), rear(U.vdW), [U.vdW, V.gymTop], [U.gymW, V.gymTop], [U.gymW, V.artB], [U.teaE, V.artB]],
    floor: 'tile',
    // Cerámico claro (video 2026, 1:09–1:20); los pasos suenan igual.
    floorLook: 'ceramic',
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

export const PLAN_ROOMS: readonly Room[] = [...ROOMS_PB, ...UPPER_ROOMS, ...JARDIN_ROOMS];


/**
 * Volúmenes con plantas altas: los de `SchoolUpper` (plano CAD del primer
 * piso y plano a mano de la planta alta) y el jardín de infantes, de tres
 * plantas (10:38–13:56).
 */
export const PLAN_UPPER: readonly Volume[] = [
  ...UPPER_VOLUMES,
  // Sin cerramiento genérico: el jardín tiene sus muros en cada piso (con
  // él, el muro oeste se duplicaba en el mismo plano y aparecían ventanas y
  // equipos de aire en un lateral que es ciego).
  { poly: [[U.teaE, V.top], [U.e, V.top], rear(U.e), rear(U.teaE)], floors: 2, cornice: false, shell: false, roofMat: 'jardinRoof' },
];

/** Donde la diagonal de Miguel Cané cruza el lado oeste del bloque norte. */
const NICHO_TIP: P = [U.epW, -(U.epW - miguelCaneU(0)) / MC_SLOPE];

/** Cubiertas de una sola planta. */
export const PLAN_ROOFS: ReadonlyArray<{ poly: readonly P[]; y: number }> = [
  // Rincón del nicho sobre Miguel Cané: el CAD del primer piso lo deja sin
  // construir (la fila norte de arriba arranca en u 12,28).
  { poly: [mc(V.notchN), [U.epW, V.notchN], NICHO_TIP], y: H },
  { poly: [rear(U.gymW), rear(U.teaE), [U.teaE, V.artB], [U.gymW, V.artB]], y: H },
  {
    poly: [rear(U.teaE), rear(U.e), [U.e, V.gymTop], [U.gymW, V.gymTop], [U.gymW, V.artB], [U.teaE, V.artB]],
    y: H,
  },
  // Franja del pasillo norte bajo el patio de aire del primer piso (entre el
  // ala oeste y la galería): de una planta.
  { poly: rect(U.patioW, V.nBlockS, U1.gallery, V.corrN), y: H },
  // Pasarela vidriada.
  { poly: rect(U.kioskE, V1.walkN - 0.15, U.salonW, V1.walkS + 0.15), y: H + 2.65 },
];

/**
 * Escaleras. Se suben: cada tramo es una rampa para los pies (ver
 * `schoolFloorLocal`) y los escalones se dibujan encima. Acá van las que
 * arrancan en planta baja; las que salen de un descanso o de un piso alto
 * están en `SchoolUpper` (y las del jardín en `SchoolJardin`).
 */
export const PLAN_STAIRS: readonly Stair[] = [
  // "Acceso al Nivel Secundario" (CAD): primer tramo al norte, contra el muro
  // oeste del hall, hasta el descanso de la torre (2,45 m, del recorrido).
  // Video 2026: paños de chapa perforada clara en marco de caño rojo.
  { u0: 32.63, v0: V.hallTop, u1: HALL_STAIR_E, v1: -8.94, dir: 'v-', y0: 0, y1: 2.45, guard: 'perforated' },
  // Escalera exterior blanca contra el comedor: del patio este al descanso de
  // la torre. En 2026 su baranda es de caño rojo, sin malla (0:31–0:33).
  { u0: 32.58, v0: -19.56, u1: 33.68, v1: V.kiosk, dir: 'v+', y0: 0, y1: 2.45, hollow: true, guard: 'rails' },
  // "Acceso a primer piso" (ala oeste, CAD): primer tramo al oeste hasta el
  // descanso (2,2 m, del recorrido). Llega a u 10,15 y no a 9,95 como el CAD:
  // con 12 contrahuellas la huella daba 23 cm.
  { u0: WEST_LANDING_E, v0: -12.8, u1: 10.15, v1: -10.6, dir: 'u-', y0: 0, y1: 2.2 },
  // Escalera exterior del patio este, contra el bloque norte (CAD): un tramo
  // corto al oeste, el descanso de la esquina y el tramo largo que sube al
  // NORTE hasta el balcón del aula del primer piso sobre el patio.
  { u0: 33.9, v0: -26.8, u1: 35.0, v1: -25.65, dir: 'u-', y0: 0, y1: 0.7 },
  { u0: 32.6, v0: -30.6, u1: 33.9, v1: -26.8, dir: 'v-', y0: 0.7, y1: 3.3 },
  ...UPPER_STAIRS,
  ...JARDIN_STAIRS,
];

/** Descansos de las escaleras. */
export const PLAN_LANDINGS: readonly Landing[] = [
  // Descanso de la torre del hall: macizo donde desembocan el primer tramo y
  // la escalera blanca; al este, losa con un cuartito debajo (la puerta del
  // testero norte del hall, CAD). Hueco entero, el cuartito se abría al
  // patio por el paso de la escalera blanca, que en planta baja no tiene muro.
  { u0: U.east1, v0: V.kiosk, u1: HALL_STAIR_E, v1: V.hallTop, y: 2.45 },
  { u0: HALL_STAIR_E, v0: V.kiosk, u1: U.kioskE, v1: V.hallTop, y: 2.45, hollow: true },
  // Descanso del ala oeste, sobre el extremo oeste de la Preceptoría y de la
  // caja de la escalera.
  { u0: 5.6, v0: -12.85, u1: WEST_LANDING_E, v1: V.corrS - SCHOOL.wallT / 2, y: 2.2, hollow: true },
  // Descanso de la esquina de la escalera exterior del patio este.
  { u0: 32.6, v0: -26.8, u1: 33.9, v1: -25.65, y: 0.7 },
  ...UPPER_LANDINGS,
  ...JARDIN_LANDINGS,
];

/**
 * Huecos de losa: donde una escalera atraviesa el piso de `level` (y el
 * cielorraso del nivel de abajo). Ahí no se dibujan ni la losa ni el
 * cielorraso, y en ese nivel no se pisa: se baja por la escalera.
 */
export const PLAN_VOIDS: ReadonlyArray<Rect & { level: Level }> = [...UPPER_VOIDS, ...JARDIN_VOIDS];



/** Columnas rojas del aula de danzas (a lo largo de v, sobre los dos laterales). */
export const PLAN_SALON_COLUMNS = [-14.75, -17.5, -20.0] as const;

/** Eje este-oeste de la cancha del polideportivo. */
export const PLAN_GYM_MID = V.gymTop / 2;
/** Pilastras de los laterales del polideportivo (coinciden con las cabriadas). */
export const PLAN_GYM_PILASTERS = [1, 2, 3, 4, 5].map((k) => 50.3 + GYM_BAY * k);

type ClassKind = 'desks' | 'redTables' | 'blueTables';

/** Centro de las aulas sobre Laprida en v, entre las caras de la fachada y del pasillo. */
const CLASS_MID = (V.classTop + V.facade) / 2;

/**
 * Aula de primaria (recorrido 0:48-1:10): pizarra blanca al oeste, pizarrón
 * negro al este, escritorio docente, viga transversal con el proyector,
 * ventilador entre las dos ventanas y parlante sobre la pizarra. El mobiliario
 * cambia: bancos dobles verde salvia, mesas rojas agrupadas con sillas azul
 * marino, o mesas azules con sillas rojas. Con el fondo del CAD (6,2 m, no
 * 7,1) entran dos filas de bancos dobles, no tres.
 */
function classroom(u0: number, u1: number, kind: ClassKind = 'desks'): Item[] {
  const out: Item[] = [];
  const v0 = V.classTop;
  const uc = (u0 + u1) / 2;
  // Cara de cada testero: el de Miguel Cané (u = 0) es muro exterior, más grueso.
  const w0 = u0 + (u0 === U.w ? SCHOOL.extT : SCHOOL.wallT) / 2;
  const w1 = u1 - SCHOOL.wallT / 2;
  // En el Aula 1 el testero oeste tiene la ventana a Miguel Cané en el medio:
  // la pizarra va entre la ventana y el rincón del pasillo, no sobre el vidrio
  // (más corta: con el aula del CAD ese paño mide 1,8 m).
  const first = u0 === U.w;
  out.push(item('board', w0 + 0.02, first ? -5.18 : CLASS_MID, 0.04, first ? 1.6 : 2.4, 'e', false));
  out.push({ ...item('blackboard', w1 - 0.025, CLASS_MID, 0.05, 1.6, 'w', false), y: 0.95, h: 1.2 });
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
    // La última columna deja 50 cm de paso detrás de las sillas (antes, en el
    // Aula 4, las sillas de la cuarta columna se metían en el testero).
    const cols = [u0 + 2.3, u0 + 3.4, u0 + 4.5, u0 + 5.6].filter((u) => u + 0.66 < w1 - 0.5);
    for (const u of cols) {
      for (const v of [v0 + 2.15, v0 + 4.0]) {
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
      out.push({ ...item('table', u0 + 3.2 + du, -3.6 + dv, 1.2, 0.75), color: 'red' });
    }
    for (const du of [0, 1.2]) {
      out.push({ ...item('chair', u0 + 3.2 + du, -4.35, 0.42, 0.42, 's', false), color: 'navy' });
      out.push({ ...item('chair', u0 + 3.2 + du, -2.1, 0.42, 0.42, 'n', false), color: 'navy' });
    }
  } else {
    // Mesas azules en grupos, sillas rojas. Las del fondo, lejos del barrido
    // de la puerta del aula.
    for (const [du, v] of [
      [2.6, -1.85],
      [4.6, -1.85],
      [2.6, -4.35],
      [4.6, -4.35],
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
  out.push(item('board', u0 + 0.12, CLASS_MID, 0.06, 2.6, 'e', false));
  // Mesada norte cortada antes de la puerta del aula.
  out.push(item('counter', (u0 + 0.3 + (u0 + 3.9)) / 2, V.classTop + 0.45, 3.6, 0.7, 's'));
  out.push(item('counter', u1 - 0.45, CLASS_MID, 0.7, 3.6, 'w'));
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
export function planMakerWallAt(s: number, off: number): P {
  const du = U.tecE - APEX[0];
  const dv = rearV(U.tecE) - APEX[1];
  const len = Math.hypot(du, dv);
  const tu = du / len;
  const tv = dv / len;
  // Normal hacia adentro (hacia el sur): (−tv, tu).
  return [APEX[0] + tu * s - tv * off, APEX[1] + tv * s + tu * off];
}

/** Largo de la pared del mural del Aula Maker. */
export const PLAN_MAKER_WALL = Math.hypot(U.tecE - APEX[0], rearV(U.tecE) - APEX[1]);

/** Columnas redondas del Aula Maker, delante del mural: (distancia, color). */
export const PLAN_MAKER_COLUMNS: ReadonlyArray<readonly [number, string]> = [
  [1.4, 'blue'],
  [3.9, 'lime'],
  [6.4, 'navy'],
  [8.9, 'red'],
  [10.9, 'blue'],
  // La sexta, naranja, en la esquina noreste (2:40–3:15).
  [PLAN_MAKER_WALL - 0.3, 'orange'],
];

const makerColumns = (): Item[] =>
  PLAN_MAKER_COLUMNS.map(([s, color]) => {
    const [u, v] = planMakerWallAt(s, 0.62);
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
    const [u, v] = planMakerWallAt(s, 0.62);
    return { ...item('stool', u, v, 0.34, 0.34, 's', false), color };
  });

/** Columnas negras de la galería roja, sobre su borde en el patio. */
const GALLERY_POSTS = [-10.2, -13.4, -16.6, -19.8] as const;

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
  ...[21.0, 14.0, 8.0].map((u) => ({ ...item('blackboard', u, V.classTop - 0.12, 1.0, 0.04, 'n', false), y: 1.2, h: 1.2 })),
  ...[5.35, 11.975, 18.45, 25.0, 27.175].map((u) => ({ ...item('wallPanel', u, V.classTop - 0.115, 0.3, 0.03, 'n', false), y: 2.3, h: 0.35, color: 'red' })),
  ...[16.0, 7.0].map((u) => ({ ...item('speaker', u, V.classTop - 0.23, 0.26, 0.22, 'n', false), y: 2.5 })),
  ...[29.635, 24.05, 12.0].map((u) => item('extinguisher', u, V.corrS + 0.195, 0.17, 0.17, 's', false)),
  { ...item('wallPanel', 31.0, V.corrS + 0.11, 2.2, 0.02, 's', false), h: 1.2, color: 'darkRed' },

  // Aula junto al gimnasio: bancos dobles con sus dos sillas (sin ellas el
  // aula parecía un depósito de pupitres), mirando a la pizarra del oeste.
  ...[42.9, 44.4, 45.9, 47.4].flatMap((u) =>
    [-7.4, -5.6, -3.8, -2.0].flatMap((v) => [
      item('desk', u, v, 0.55, 1.2, 'w'),
      item('chair', u + 0.45, v - 0.3, 0.42, 0.42, 'w', false),
      item('chair', u + 0.45, v + 0.3, 0.42, 0.42, 'w', false),
    ]),
  ),
  item('board', U.salonW + 0.14, -4.6, 0.06, 2.6, 'e', false),

  // Aula Maker (2:32-3:20): seis mesas hexagonales con sillas azules en la zona
  // verde, columnas de colores delante del mural, una mesa larga con bancos,
  // el banco de trabajo con la cortadora láser contra el testero, los
  // muebles Educabot junto a la puerta de la punta sudoeste (D12) y el
  // escritorio con PC.
  ...[
    [19.2, -36.0],
    [22.4, -35.3],
    [24.8, -34.75],
    [17.0, -33.8],
    [19.6, -33.25],
    [23.6, -32.9],
  ].map(([u, v]) => item('hexTable', u, v, 1.4, 1.4)),
  ...makerColumns(),
  ...makerStools(),
  { ...item('workbench', 27.35, -33.75, 2.4, 0.9), color: 'blue' },
  { ...item('benchSeat', 27.35, -33.0, 2.4, 0.3, 's', false), color: 'blue' },
  { ...item('benchSeat', 27.35, -34.5, 2.4, 0.3, 'n', false), color: 'blue' },
  item('printer3d', 28.2, -33.75, 0.5, 0.5, 'w', false),
  // Al sur del portón al patio este.
  { ...item('workbench', 29.46, -34.3, 0.7, 1.0, 'w'), color: 'blue' },
  item('laserCutter', 29.46, -34.3, 0.6, 1.0, 'w', false),
  // Muebles Educabot escalonados contra la diagonal, al lado de la puerta.
  item('cabinet', 13.69, -32.3, 0.45, 0.8, 'e'),
  item('cabinet', 14.1, -33.1, 0.45, 0.8, 'e'),
  { ...item('drawers', 25.4, V.nBlockN - 0.4, 1.0, 0.6, 'n'), color: 'blue', h: 1.05 },
  { ...item('desk2', 20.55, V.nBlockN - 0.42, 1.2, 0.6, 'n'), color: 'oak' },
  // La silla mira al escritorio (estaba de espaldas a él).
  { ...item('chair', 20.25, V.nBlockN - 1.05, 0.5, 0.5, 's', false), color: 'sage' },
  { ...item('projector', 17.4, -34.9, 0.36, 0.3, 'w', false), y: 2.9 },
  // Piso: verde salvia con pasillo azul acero a lo largo del muro sur y del
  // testero este, y líneas blancas.
  // Las líneas blancas van 2 mm por encima del vinílico (sin z-fighting).
  { ...item('floorPatch', 21.65, -31.45, 16.5, 1.9, 's', false), color: 'steel' },
  { ...item('floorPatch', 28.98, -34.025, 1.85, 3.25, 's', false), color: 'steel' },
  { ...item('floorPatch', 20.8, -32.38, 14.4, 0.05, 's', false), color: 'board', y: 0.002 },
  { ...item('floorPatch', 28.08, -34.025, 0.05, 3.25, 's', false), color: 'board', y: 0.002 },

  // Pasillo del Aula Maker: columna redonda forrada en azul marino.
  { ...item('paddedColumn', 12.6, -28.0, 0.3, 0.3), color: 'navy' },

  // Aula del bloque norte (CAD, sin recorrido): sólo la pizarra y el
  // escritorio, contra el muro del patio este.
  item('board', U.east1 - 0.12, -26.8, 0.04, 2.4, 'w', false),
  item('teacherDesk', U.east1 - 1.3, -26.8, 0.7, 1.3, 'w'),
  item('chair', U.east1 - 0.75, -26.8, 0.45, 0.45, 'w', false),

  // E.P
  item('table', 16.9, -26.8, 2.0, 1.1),
  item('shelf', U.epE - 0.335, -27.2, 0.45, 1.8, 'w'),

  // Baños de alumnos: en cada uno, mesada con bachas junto a la puerta y dos
  // cubículos contra el pozo de luz.
  ...[20.2, 21.45, 24.25, 25.5].map((u) => item('stall', u, V.wellS + 0.82, 1.2, 1.4, 's')),
  { ...item('sinkCounter', U.epE + 0.375, -24.3, 0.55, 1.8, 'e'), color: 'board' },
  { ...item('sinkCounter', U.stairE - 0.375, -24.3, 0.55, 1.8, 'w'), color: 'board' },

  // Administración: escritorio detrás de la ventanilla y biblioteca.
  item('teacherDesk', 8.3, -20.2, 1.3, 0.7, 's'),
  item('shelf', 8.45, V.admB - 0.32, 1.4, 0.4, 'n'),

  // Sala de profesores (1:54-2:00): mesas con tapa roja en grupos, sillas
  // blancas, mesada roja, banquetas rojas, biblioteca roja, pizarrón verde,
  // armario beige y ventilador.
  ...[
    [6.2, -14.55],
    [7.4, -14.55],
    [8.6, -14.55],
    [9.8, -14.55],
    [8.0, -16.25],
    [9.2, -16.25],
  ].flatMap(([u, v]) => [
    { ...item('table', u, v, 1.2, 0.7), color: 'red' },
    { ...item('plasticChair', u, v - 0.55, 0.42, 0.42, 's', false) },
    { ...item('plasticChair', u, v + 0.55, 0.42, 0.42, 'n', false) },
  ]),
  { ...item('counter', 6.65, V.admB + 0.41, 1.8, 0.6, 's'), color: 'red' },
  // Banquetas de la mesada: miran a la mesada y en su mitad libre.
  ...[6.3, 6.95].map((u) => ({ ...item('stool', u, V.admB + 0.91, 0.34, 0.34, 'n', false), color: 'red' })),
  { ...item('shelf', U.wcW - 0.285, -16.55, 0.35, 0.9, 'w'), color: 'red' },
  { ...item('blackboard', 6.0, V.profB - 0.125, 1.8, 0.05, 'n', false), y: 0.95, h: 1.2 },
  { ...item('drawers', 8.5, V.profB - 0.335, 0.9, 0.45, 'n'), h: 1.9 },
  { ...item('fan', 9.8, V.profB - 0.15, 0.3, 0.3, 'n', false), y: 2.5 },

  // Dirección primaria (1:24-1:30): biblioteca con biblioratos, escritorio
  // color cerezo con su silla negra y ventilador de techo, en la oficina chica
  // del CAD.
  item('shelf', 3.4, V.dirTop + 0.3, 1.4, 0.4, 's'),
  // El escritorio va contra el muro del fondo, junto a la biblioteca: frente a
  // la puerta del pasillo se comía la mitad del paso y se frenaba en el marco.
  // De 0,9 m: con 1,2 todavía se frenaba a medio metro de la puerta.
  { ...item('desk2', 4.65, V.dirTop + 0.4, 0.9, 0.6, 'n'), color: 'cherry' },
  { ...item('chair', 4.75, V.dirTop + 0.95, 0.45, 0.45, 'n', false), color: 'metalDark' },
  item('ceilingFan', 3.4, -9.45, 1.2, 1.2, 's', false),
  // Viga bajo el muro oeste de la PR (u 8,9), que en el primer piso cruza el
  // hueco de la escalera oeste: sin ella el muro quedaba colgado, con su cara
  // de abajo a la vista y la planta baja asomando por debajo. 30 cm de alto:
  // sobre el tramo 2 quedan ~2,08 m libres.
  { ...item('wallPanel', 8.9, (V.dirTop + V.profB) / 2, SCHOOL.wallT, V.dirTop - V.profB - SCHOOL.wallT - 0.01, 'e', false), y: SCHOOL.storey - 0.3, h: 0.3, color: 'white' },
  // Preceptoría primaria: el escritorio frente a la ventana al pasillo.
  item('teacherDesk', 10.15, -9.7, 1.3, 0.7, 'n'),

  // Pasillo oeste: reja roja abierta contra el muro de la Preceptoría y matafuego.
  { ...item('gate', U.wingE + 0.125, -9.45, 0.05, 1.6, 'e', false), color: 'red', h: 2.2 },
  item('extinguisher', U.wingE + 0.185, -15.48, 0.17, 0.17, 'e', false),

  // Cantina | Comedor (3:28–4:14). Al norte, la cantina: línea de acero con
  // los carteles PRO FOOD bajo el riel negro de campanas, heladeras de
  // bebidas, estante de golosinas y la vitrina curva. Al sur el comedor:
  // mesas largas de tapa blanca y estructura verde, el jardín vertical, la
  // tele y las cañas de bambú.
  item('buffetLine', 30.1, -18.6, 2.5, 0.75, 's'),
  { ...item('pendantRail', 30.0, -18.6, 3.8, 0.12, 's', false), y: 2.45 },
  item('displayCase', 31.75, -18.6, 0.8, 0.75, 's'),
  // Heladeras corridas al oeste: pegadas a la puerta del patio este la
  // tapaban (el jugador quedaba trabado a 20 cm de entrar al buffet).
  item('fridgeGlass', 29.7, V.corrN + 0.49, 0.75, 0.7, 's'),
  item('fridgeGlass', 30.47, V.corrN + 0.49, 0.75, 0.7, 's'),
  { ...item('shelf', 28.85, V.corrN + 0.36, 0.9, 0.45, 's'), color: 'board' },
  // Paneles símil hormigón detrás de la línea de servicio.
  { ...item('wallPanel', 30.0, V.corrN + 0.115, 4.2, 0.03, 's', false), y: 0, h: 2.7, color: 'render' },
  ...[-10.4, -12.2, -14.0, -15.8].map((v) => item('longTable', 28.75, v, 2.0, 0.8)),
  ...[-11.4, -13.6].map((v) => item('longTable', 31.15, v, 1.4, 0.6)),
  { ...item('greenWall', U.east1 - 0.15, -11.8, 3.4, 0.1, 'w', false), y: 1.0, h: 1.7 },
  { ...item('tv', U.east1 - 0.13, -9.45, 1.1, 0.06, 'w', false), y: 1.9 },
  // Al costado de la puerta al patio este, no delante.
  item('bamboo', U.east1 - 0.35, -16.8, 0.45, 0.45),
  item('bamboo', U.east1 - 0.35, -14.35, 0.45, 0.45),

  // Espacio recreativo (2:00-2:13): cantero azul largo con pastos y asientos de
  // madera contra el lado norte, cantero angosto junto al pasillo oeste,
  // cantero de ladrillo, mástil, árboles, la palmera en su cantero con
  // asientos, banquitos cilíndricos rojos, aro de básquet y la galería del
  // comedor con columnas negras. Patio cuadrado del CAD (12,5 × 12,4 m).
  // Termina antes de la hoja abierta de la puerta doble al pasillo norte.
  item('planter', 18.45, V.corrN + 0.57, 6.1, 0.9),
  ...[16.4, 18.45, 20.5].map((u) => ({ ...item('wallPanel', u, V.corrN + 0.9, 2.0, 0.3, 's', false), y: 0.6, h: 0.05, color: 'timberDark' })),
  item('planter', U.patioW + 0.52, -15.3, 0.8, 4.6),
  { ...item('planter', 16.6, -18.9, 1.5, 0.6), color: 'brick' },
  { ...item('flagpole', 16.6, -17.1, 0.1, 0.1), h: 8 },
  item('bareTree', 18.2, -18.9, 0.6, 0.6),
  { ...item('floorPatch', 24.4, -17.6, 2.5, 2.5, 's', false), color: 'darkGreen' },
  item('bareTree', 24.6, -17.8, 0.6, 0.6),
  // Macizo: la gente lo atravesaba (se sienta desde adelante, ver Places).
  { ...item('bench', 21.6, -19.6, 1.2, 0.4, 's'), color: 'timberDark' },
  item('planter', 23.4, -12.6, 2.4, 2.4),
  // 8,1 m: con 6 m las frondas entraban por el muro y el cielorraso de la
  // galería roja; así pasan por encima de su pretil. A 2 m de su borde.
  { ...item('palm', 23.4, -12.6, 0.4, 0.4), h: 8.1, y: 0.6 },
  ...[
    [23.4, -11.3, 2.4, 0.4],
    // Termina donde empieza el asiento del lado sur (sin encimarse en la esquina).
    [22.1, -12.65, 0.4, 2.3],
  ].map(([u, v, w, d]) => ({ ...item('wallPanel', u, v, w, d, 's', false), y: 0.45, h: 0.05, color: 'timberDark' })),
  item('planter', 19.6, -11.6, 3.5, 0.6),
  ...[
    [20.9, -13.5],
    [21.5, -14.4],
    [24.9, -14.6],
  ].map(([u, v]) => ({ ...item('roundColumn', u, v, 0.35, 0.35), color: 'red', h: 0.4 })),
  ...GALLERY_POSTS.map((v) => ({ ...item('wallPanel', U1.gallery + 0.2, v, 0.12, 0.12), h: 3.25, color: 'metalDark' })),
  item('planter', U.bufW - 0.42, -12.0, 0.6, 2.4),
  item('planter', U.bufW - 0.42, -17.2, 0.6, 2.4),
  // En el paño lleno entre dos ventanas del pasillo oeste.
  item('hoop', U.patioW + 0.13, -18.7, 0.6, 0.45, 'e', false),

  // Frente del local del fondo del pasillo norte al patio este: toldo azul
  // marino sobre sus puertas vidriadas.
  { ...item('wallPanel', U.east1 + 1.31, -22.1, 2.4, 2.4, 's', false), y: 2.85, h: 0.05, color: 'navy' },
  { ...item('wallPanel', U.east1 + 2.53, -22.1, 0.04, 2.4, 'e', false), y: 2.4, h: 0.5, color: 'navy' },
  // Bajo los muros negros de la pasarela, donde arranca su escalera (más baja
  // que el piso alto): cierran el costado del tramo, que desde el patio se
  // veía colgando con su losa y su baranda por debajo de la pasarela.
  ...[-13.525, -14.925].map((v) => ({ ...item('wallPanel', U.kioskE + 0.75, v, 1.2, 0.15, 's', false), y: 2.13, h: 1.05, color: 'black' })),
  // Columnas del aula del primer piso sobre el patio (sus esquinas libres y
  // el medio del lado este).
  ...(
    [
      [NE_E - 0.15, -25.0],
      [NE_E - 0.15, -29.3],
      [34.05, -27.23],
    ] as const
  ).map(([u, v]) => ({ ...item('wallPanel', u, v, 0.25, 0.25), h: 3.25, color: 'facade' })),

  // Patio este = patio aire libre (el patio nuevo). El tramo entre el hall, el comedor y el
  // salón de los espejos sigue el video de 2026 (HANDOFF 89 y 92): un pasillo
  // largo con el medio libre. Al oeste, el cantero rojo corrido desde el
  // rincón de la puerta del hall (en L, con dos macetas blancas) hasta el pie
  // de la escalera blanca, con la fila de juegos de mesa y bancos de chapa
  // delante; detrás del cantero, el piso verde con los contenedores, y al
  // final el cantero bajo con baranda de caño y la palmera. Al este, contra
  // el salón, cazuelas de ripio con palmeras y arbolitos y mesitas lisas de
  // pie rojo. Más al norte, frente a Arte, el patio de las gradas: mesas
  // dobles con damero, gradas azules con los tres mástiles, banco blanco de
  // listones y guirnaldas de papel picado. El patio de juegos de 2020 ya no
  // existe: al norte el piso queda libre. Deja libres la puerta bajo la escalera
  // (v −15,25…−16,15) y su paso, el pie de la escalera, la puerta de la
  // cantina y la del hall.
  // Cantero rojo contra la torre y su brazo en L que cierra el rincón.
  { ...item('planter', 35.7, -16.05, 0.6, 7.6, 'e'), color: 'red', h: 1.0 },
  { ...item('planter', 36.36, -14.55, 0.85, 0.6, 's'), color: 'red', h: 1.0 },
  ...[
    [36.25, -13.15],
    [36.55, -13.85],
  ].map(([u, v]) => item('pot', u, v, 0.45, 0.45)),
  // Juegos de chapa plegada: mesa de 1,5 × 0,7 entre dos bancos, de sur a norte.
  ...(
    [
      [-15.5, 'blue', 'blue', 'red'],
      [-17.1, 'red', 'red', 'red'],
      [-18.7, 'blue', 'blue', 'blue'],
      [-20.3, 'red', 'blue', 'blue'],
    ] as const
  ).flatMap(([v, table, south, north]) => [
    // Se tocan (van juntos al escalar): la separación queda en metros reales.
    { ...item('boxBench', 36.74, v + 0.6, 1.5, 0.35, 'n'), color: south, h: 0.42 },
    { ...item('boxBench', 36.74, v, 1.5, 0.7, 'e'), color: table, h: 0.72 },
    { ...item('boxBench', 36.74, v - 0.6, 1.5, 0.35, 's'), color: north, h: 0.42 },
  ]),
  // Detrás del cantero: piso verde y los dos contenedores de 1100 l.
  { ...item('floorPatch', 34.57, -17.3, 1.74, 4.3, 's', false), color: 'patioGreen' },
  ...[-16.75, -18.1].flatMap((v) => [
    { ...item('wallPanel', 34.99, v, 1.0, 1.2), h: 1.15, color: 'darkGreen' },
    { ...item('wallPanel', 34.99, v, 1.04, 1.24, 's', false), y: 1.15, h: 0.06, color: 'orange' },
  ]),
  // Fin del cantero: cajón bajo con baranda de caño rojo y la palmera.
  { ...item('planter', 35.18, -19.9, 1.8, 0.9, 's'), color: 'red', h: 0.6 },
  { ...item('palm', 34.85, -19.9, 0.4, 0.4), h: 4.6, y: 0.6 },
  ...[0.95, 1.25, 1.5].flatMap((y) => [
    { ...item('wallPanel', 35.18, -20.27, 1.76, 0.04, 's', false), y, h: 0.04, color: 'red' },
    { ...item('wallPanel', 34.45, -19.88, 0.04, 0.84, 'w', false), y, h: 0.04, color: 'red' },
  ]),
  ...(
    [
      [34.45, -20.27],
      [35.92, -20.27],
      [34.45, -19.53],
    ] as const
  ).map(([u, v]) => ({ ...item('wallPanel', u, v, 0.04, 0.04, 's', false), y: 0.6, h: 0.94, color: 'red' })),
  // Contra el salón: cazuelas de ripio, palmeras de tronco peludo y arbolitos.
  ...(
    [
      [-13.9, 'palm'],
      [-16.25, 'slim'],
      [-19.95, 'palm'],
      [-22.2, 'slim'],
    ] as const
  ).flatMap(([v, kind]) => [
    { ...item('floorPatch', 39.71, v, 0.6, 0.86, 's', false), color: 'render' },
    // Las palmeras van como `slimTree` ancho (tronco grueso y penacho corto).
    kind === 'palm' ? { ...item('slimTree', 39.71, v, 0.45, 0.45), h: 4.2 } : { ...item('slimTree', 39.71, v, 0.3, 0.3), h: 3.4 },
  ]),
  // Mesitas lisas de pie rojo con sillas plásticas negras.
  ...[-15.08, -21.05].map((v) => ({ ...item('cafeTable', 39.79, v, 0.65, 0.65), chairs: 2 })),
  // Contra el ventanal del hall: una mesa alta con damero y una maceta.
  { ...item('cafeTable', 39.4, V.hallTop - 0.5, 0.9, 0.5), h: 1.05, chess: true },
  item('pot', 40.15, V.hallTop - 0.4, 0.5, 0.5),
  // Patio de las gradas, frente a Arte: gradas azules con los tres mástiles
  // blancos detrás (bandera argentina y una azul), mesas dobles con damero.
  item('amphi', 42.12, -23.08, 2.6, 2.6),
  ...(
    [
      [41.1, 'skyWall', 7],
      [41.6, 'blue', 6.6],
      [42.1, undefined, 6.2],
    ] as const
  ).map(([u, color, h]) => ({ ...item('flagpole', u, -24.35, 0.1, 0.1), h, color: color ?? 'frame' })),
  ...(
    [
      [44.75, -22.3],
      [47.75, -22.3],
      [47.75, -24.7],
    ] as const
  ).flatMap(([u, v]) => [
    { ...item('cafeTable', u, v, 0.7, 0.7), chess: true, chairs: 2 },
    // Pegada a la primera (van juntas al escalar: 0,7 m reales).
    { ...item('cafeTable', u + 0.71, v, 0.7, 0.7), chess: true, chairs: 2 },
  ]),
  // Banco blanco de listones bajo la ventana de Arte y la pilastra blanca.
  { ...item('bench', 49.93, -24.0, 0.45, 1.9, 'w'), color: 'frame' },
  { ...item('wallPanel', 50.17, -27.15, 0.1, 0.8, 'w', false), h: 3.25, color: 'frame' },
  ...[-21.6, -22.9, -24.2].map((v) => ({ ...item('bunting', 45.42, v, 9.6, 0.05, 's', false), y: 3.6 })),
  // El patio de juegos de antes (bicicletero, torre de madera con toboganes,
  // aviarios, choza, hamacas, tobogán, domo trepador, arenero y cerco de
  // cañas) se removió: el patio nuevo del video de 2026 termina en las
  // mesas y las gradas, y al norte queda el piso libre.

  // Equipos de aire de la fachada sobre Laprida (0:04, Street View) y del
  // lado del patio oeste (2:02–2:07), sobre el techo del pasillo norte.
  ...(
    [
      [2.35, 5.8],
      [8.3, 5.8],
      [11.45, 5.8],
      [22.4, 6.8],
      [24.15, 6.8],
      [31.4, 6.8],
      [32.0, 3.75],
      [42.6, 3.7],
      [43.6, 3.7],
    ] as const
  ).map(([u, y]) => ({ ...item('condenser', u, 0.32, 0.8, 0.3, 's', false), y })),
  ...[20.9, 23.6].map((u) => ({ ...item('condenser', u, V.nBlockS + 0.3, 0.8, 0.3, 's', false), y: 3.6 })),

  // Recepción (0:18-0:34): banner al pie de la escalera, asientos de espera
  // negros frente al ventanal, columna con protección verde, placas de
  // bronce junto a la entrada, parlante y split sobre el mural, y las bandas
  // oscuras del piso. La cabina vidriada de la portería es la oficina de
  // recepción (sus muros), a la derecha al entrar.
  item('banner', 34.9, -8.95, 0.9, 0.4, 's'),
  // Video 2026 (0:04): las sillas de espera negras están frente al
  // mostrador de recepción, mirándolo, en dos filas.
  // Contra el muro oeste, del otro lado del paso de la entrada (el
  // simulacro sale por la mitad este del portón, frente al mostrador).
  ...[32.82, 33.5].map((u) => item('seats', u, -4.6, 0.5, 1.65, 'e')),
  { ...item('paddedColumn', 39.4, -10.6, 0.4, 0.4), color: 'darkGreen' },
  // Testero norte, a la derecha de la puerta del cuartito: cuadro grande con
  // marco de madera oscura y la cámara de seguridad sobre la puerta (0:01).
  { ...item('wallPanel', 35.95, V.hallTop + 0.115, 0.9, 0.03, 'n', false), y: 1.6, h: 0.7, color: 'timberDark' },
  { ...item('wallPanel', 35.95, V.hallTop + 0.13, 0.78, 0.01, 'n', false), y: 1.66, h: 0.58, color: 'red' },
  { ...item('wallPanel', 34.62, V.hallTop + 0.16, 0.12, 0.12, 'n', false), y: 2.62, h: 0.1, color: 'frame' },
  item('plaques', 33.3, V.hallDoors - 0.12, 0.6, 0.04, 'n', false),
  // Frente rojo brillante del mostrador corrido de la recepción y su tapa
  // blanca de 30 cm (video 2026, 0:03), bajo la ventanilla y el vidriado.
  { ...item('wallPanel', U.recW - 0.115, -4.36, 0.03, 2.35, 'w', false), y: 0, h: 1.03, color: 'red' },
  { ...item('wallPanel', U.recW - 0.24, -4.36, 0.28, 2.4, 'w', false), y: 1.03, h: 0.04, color: 'frame' },
  // Portería: escritorio con monitor y su silla al fondo de la celda, contra
  // el tabique de la oficina norte (lejos de la ventanilla, donde atiende el
  // portero, y del barrido de las dos puertas). Estaba vacía.
  { ...item('desk2', 39.65, V.recN + 0.42, 1.4, 0.6, 'n'), color: 'oak' },
  { ...item('chair', 39.65, V.recN + 1.07, 0.5, 0.5, 'n', false), color: 'metalDark' },
  { ...item('speaker', U.east1 + 0.22, -3.2, 0.22, 0.26, 'e', false), y: 2.68 },
  { ...item('ac', U.east1 + 0.23, -5.35, 0.22, 0.86, 'e', false), y: 2.75 },
  { ...item('floorPatch', 35.235, -5.45, 1.2, 6.2, 's', false), color: 'charcoal' },
  { ...item('floorPatch', 37.2, -9.8, 6.4, 0.5, 's', false), color: 'charcoal' },

  // Salón de los espejos = aula de danzas (recorrido 10:08–10:36): parquet,
  // columnas redondas rojas sobre los dos laterales con vigas negras, espejos
  // con marco rojo y barra negra sobre el muro de bloque del polideportivo,
  // piano, cómoda y afiches en el testero norte, banco rojo con percheros.
  ...PLAN_SALON_COLUMNS.flatMap((v) => [
    { ...item('roundColumn', U.salonW + 0.37, v, 0.36, 0.36), color: 'red' },
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
  // A 1,75 m del muro: más cerca tapaba la puerta doble del patio este.
  { ...item('barre', U.salonW + 1.75, -17.6, 0.06, 2.4, 'e'), color: 'metalDark' },
  item('piano', 44.0, -20.38, 1.5, 0.55, 's'),
  item('drawers', 46.5, -20.45, 1.8, 0.42, 's'),
  { ...item('drawers', 48.4, -20.5, 0.9, 0.34, 's'), h: 0.65 },
  item('coatBench', U.salonW + 0.43, -16.1, 0.42, 1.8, 'e'),
  // Ventiladores en los paños llenos, no sobre ventanas ni bandas.
  item('fan', U.salonW + 0.2, -15.3, 0.3, 0.3, 'e', false),
  item('fan', U.salonW + 0.2, -20.45, 0.3, 0.3, 'e', false),
  item('fan', 50.15, -14.2, 0.3, 0.3, 'w', false),
  item('speaker', U.salonW + 0.25, -12.9, 0.26, 0.22, 'e', false),
  item('speaker', 50.085, -19.62, 0.26, 0.22, 'w', false),

  // Polideportivo: la cancha corre de oeste a este, con los arcos en los
  // testeros; las gradas de chapa negra van contra el lateral de Laprida y
  // las pilastras llevan protección verde abajo y roja arriba.
  // El arco oeste está corrido hacia la esquina norte, contra el bloque: en
  // el centro del testero está la puerta doble del pasaje (cuadro 9:20).
  item('goal', 51.25, -13.0, 0.8, 3.1, 'e'),
  item('goal', 66.45, PLAN_GYM_MID, 0.8, 3.1, 'w'),
  // Gradas delante de las pilastras (no metidas en ellas).
  // La última deja libre la puerta roja de la esquina.
  ...[56.3, 59.2, 62.1].map((u) => item('bleachers', u, -1.68, 2.7, 2.4, 'n')),
  // La última, más corta: entera tapaba por dentro la puerta a la calle.
  item('bleachers', 64.7, -1.68, 2.1, 2.4, 'n'),
  ...PLAN_GYM_PILASTERS.flatMap((u) => [item('padPilaster', u, -20.55, 0.42, 0.3, 's'), item('padPilaster', u, -0.32, 0.42, 0.3, 'n')]),
  { ...item('wallMat', 67.2, -1.5, 0.1, 1.7, 'w', false), color: 'red', h: 1.9 },
  { ...item('wallMat', 66.3, -20.65, 1.6, 0.1, 's', false), color: 'red', h: 1.9 },
  // Video 2026 (1:31): del lado de la cancha, la puerta del pasillo del
  // jardín está enmarcada en azul marino hasta 2,1 m, con dintel blanco.
  ...[62.78, 64.1].map((u) => ({ ...item('wallPanel', u, -20.71, 0.42, 0.02, 's', false), h: 2.1, color: 'navy' })),
  { ...item('wallPanel', 63.44, -20.71, 1.74, 0.02, 's', false), y: 2.1, h: 0.18, color: 'frame' },
  // Video 2026 (1:36): acolchado rojo corrido en el lateral norte, entre
  // las pilastras; bajo las ventanas oscuras del paño 4 sólo la fila baja.
  ...(
    [
      [50.55, 52.9, 2.0],
      [53.4, 55.75, 2.0],
      [56.25, 58.6, 2.0],
      [59.1, 61.45, 1.0],
    ] as const
  ).map(([a, b, h]) => ({ ...item('wallMat', (a + b) / 2, -20.65, b - a, 0.1, 's', false), color: 'red', h })),
  // Aro de básquet (1:37): poste rojo acolchado contra el testero este, al
  // norte del arco, tablero blanco con borde rojo y aro naranja a 3,05 m.
  { ...item('wallPanel', 66.99, -15.5, 0.3, 0.3, 'w', false), h: 3.6, color: 'red' },
  { ...item('wallPanel', 66.845, -15.5, 0.03, 1.15, 'w', false), y: 2.7, h: 1.0, color: 'red' },
  { ...item('wallPanel', 66.82, -15.5, 0.04, 1.05, 'w', false), y: 2.75, h: 0.9, color: 'frame' },
  { ...item('wallPanel', 66.72, -15.5, 0.16, 0.04, 'w', false), y: 3.02, h: 0.03, color: 'orange' },
  ...[-15.3, -15.7].map((v) => ({ ...item('wallPanel', 66.47, v, 0.44, 0.02, 'w', false), y: 3.03, h: 0.02, color: 'orange' })),
  ...[66.27, 66.67].map((u) => ({ ...item('wallPanel', u, -15.5, 0.02, 0.44, 'w', false), y: 3.03, h: 0.02, color: 'orange' })),

  // Arte y Teatro. Video 2026 (1:13–1:18): Arte tiene filas de mesas largas
  // de tapa roja con un banco a cada lado, de oeste a este (como el comedor).
  ...[-24.45, -27.3, -28.95].flatMap((v) => [
    { ...item('boxBench', 52.1, v + 0.6, 2.2, 0.35, 'n'), color: 'red', h: 0.42 },
    { ...item('boxBench', 52.1, v, 2.2, 0.7, 'e'), color: 'red', h: 0.72 },
    { ...item('boxBench', 52.1, v - 0.6, 2.2, 0.35, 's'), color: 'red', h: 0.42 },
  ]),
  item('stage', 55.8, -27.0, 3.5, 2.6, 's'),
  item('curtain', 55.8, -25.6, 3.5, 0.1, 's', false),
  item('seats', 56.2, -24.3, 2.0, 0.5, 'n'),

  // Hall del jardín, muro este (video 2026, 1:24–1:27): bicicletero de pared
  // de dos caños blancos con soportes encintados de azul, matafuego con su
  // chapa roja y una hoja impresa a la altura de la vista.
  ...[0.45, 0.85].map((y) => ({ ...item('wallPanel', 62.565, -24.0, 0.04, 2.4, 'w', false), y, h: 0.04, color: 'frame' })),
  ...[-22.95, -24.0, -25.05].map((v) => ({ ...item('wallPanel', 62.605, v, 0.02, 0.06, 'w', false), y: 0.4, h: 0.52, color: 'blue' })),
  item('extinguisher', U.vdW - 0.185, -26.95, 0.17, 0.17, 'w', false),
  { ...item('wallPanel', U.vdW - 0.09, -26.95, 0.02, 0.3, 'w', false), y: 1.65, h: 0.3, color: 'red' },
  { ...item('wallPanel', U.vdW - 0.09, -24.0, 0.02, 0.21, 'w', false), y: 1.6, h: 0.3, color: 'frame' },

  // V. Damas: cubículos.
  item('stall', 66.4, -25.84, 1.4, 1.2, 'w'),
  item('stall', 66.4, -24.5, 1.4, 1.2, 'w'),
  // Vestuario (video 2026, 1:28–1:31): banco de listones de madera contra el
  // muro sur, paneles grises detrás (despegados del muro) y el perchero.
  { ...item('bench', 64.3, -23.95, 1.8, 0.4, 'n'), color: 'timber' },
  ...[63.72, 64.3, 64.88].map((u) => ({ ...item('wallPanel', u, -23.67, 0.55, 0.02, 'n', false), y: 0.5, h: 1.5, color: 'metal' })),
  { ...item('wallPanel', 64.3, -23.7, 1.8, 0.06, 'n', false), y: 1.75, h: 0.08, color: 'timber' },
];

export const PLAN_ITEMS: readonly Item[] = [...ITEMS_PB, ...UPPER_ITEMS, ...JARDIN_ITEMS];
// ============================================================== señalización

/**
 * Portal del acceso sobre Laprida: el volumen gris grafito (7,75 m, del
 * recorrido) centrado en el frente del hall del CAD, y la reja con su portón
 * frente a la entrada. Lo usan el constructor y los carteles.
 */
export const PLAN_PORTAL = {
  u0: (U.east1 + U.salonW) / 2 - 3.875,
  u1: (U.east1 + U.salonW) / 2 + 3.875,
  /** Pilares de granito a los costados del atrio. */
  g0: U.east1 + 0.05,
  g1: U.salonW - 0.05,
  /** Portón de la reja, frente a la entrada vidriada. */
  gate0: 33.9,
  gate1: 36.57,
  /** Cuánto sobresale de la fachada (~0,85 m, 0:09–0:16): ahí van la reja y las columnas. */
  front: 0.85,
} as const;
/** Punto de encuentro del plano: esquina de Miguel Cané y Laprida. */
export const PLAN_MEETING_POINT: P = [-3.1, 1.3];

/**
 * Posiciones locales de las estaciones de aprendizaje y hacia dónde mira el
 * guía, como giro en mundo (0 = sur/+z, π = norte, π/2 = oeste/+x).
 */
export const PLAN_STATION_SPOTS = {
  tech: { u: 22.6, v: -31.4, yaw: 0 },
  robotics: { u: 27.6, v: -31.3, yaw: 0 },
  science: { u: 16.0, v: -3.4, yaw: Math.PI },
  sport: { u: 57.8, v: -12.5, yaw: Math.PI / 2 },
  environment: { u: 21.6, v: -16.4, yaw: 0 },
} as const;

/** Zonas donde circulan los alumnos (las usa la multitud). */
export const PLAN_STUDENT_ZONES = {
  initial: { u0: 33.8, v0: -29.6, u1: 49.6, v1: -21.4 },
  primary: { u0: 15.5, v0: -20.4, u1: 26.8, v1: -9.1 },
  secondary: { u0: 51.2, v0: -19.9, u1: 64.8, v1: -1.2 },
} as const satisfies Record<string, Rect>;
/** Canteros de la franja de frente, a ambos lados del acceso. */
export const PLAN_FRONT_PLANTERS: readonly Rect[] = [
  // Del lado de la vereda, fuera del cerco (0:04–0:08, Street View).
  { u0: 0.4, v0: 0.95, u1: 14.8, v1: 1.85 },
  { u0: 16.8, v0: 0.95, u1: 32.4, v1: 1.85 },
  { u0: 42.4, v0: 0.95, u1: 49.8, v1: 1.85 },
];

/** Línea del cerco sobre Laprida: pegado a la fachada, sobre el muro bajo rojo. */
const FENCE_V = 0.6;

/** Reja sobre la línea municipal: tramos con su abertura para pasar. */
export const PLAN_FENCES: readonly (readonly [P, P])[] = [
  [
    [miguelCaneU(FENCE_V), FENCE_V],
    [15.4, FENCE_V],
  ],
  // Abierta en todo el atrio del acceso, entre los pilares del portal.
  [
    [16.2, FENCE_V],
    [U.east1, FENCE_V],
  ],
  [
    [U.salonW + 0.05, FENCE_V],
    [50.2, FENCE_V],
  ],
  // Sobre Miguel Cané, por la línea municipal hasta frente al aula 1; el resto,
  // hasta la esquina del edificio, es el portón abierto del rincón de la salida
  // de emergencia del ochavo (la esquina del aula 1 casi toca la diagonal).
  [
    [miguelCaneU(FENCE_V), FENCE_V],
    [miguelCaneU(-4.0), -4.0],
  ],
];
