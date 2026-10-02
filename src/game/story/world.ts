import { GYM_MID, LEVEL_Y, MEETING_POINT, STAIRS, U, V, makerWallAt, miguelCaneU, rearV, type Level } from '../../world/SchoolLayout';
import { openingNear, openingsOnLine, stairAt, stairFoot } from './anchors';
import type { Anchor, InteractableDef, LockDef, PlaceDef, Spot, ZoneId } from './types';

/**
 * El mundo de la historia: lugares de la libreta, objetos con los que se
 * interactúa, puertas que se abren con la historia, escaleras para guiar al
 * jugador entre pisos, la ruta del simulacro y el acto final.
 *
 * Todo se escribe sobre los ambientes del plano (`SchoolLayout` y sus
 * plantas altas). Lo que se cuenta en las fichas es lo que se VE en la
 * escuela: carteles, murales, equipamiento. Nada de fechas, nombres reales ni
 * datos institucionales inventados.
 */

// ======================================================================= lugares

export const PLACES: readonly PlaceDef[] = [
  { id: 'laprida', title: 'Vereda de Laprida', rooms: ['__laprida'], blurb: 'El frente de la escuela, con el portal y su marquesina.' },
  { id: 'hall', title: 'Hall de acceso · Recepción', rooms: ['hall', 'recepcionOf'], blurb: 'El mural de San Martín, el plano de evacuación y la escalera al nivel secundario.' },
  { id: 'primaria', title: 'Pasillo de primaria', rooms: ['pasilloSur'], blurb: 'Pizarrones, carteleras de corcho y las puertas de las aulas sobre Laprida.' },
  { id: 'aulas', title: 'Aulas de primaria', rooms: ['aula1', 'aula2', 'aula3', 'aula4', 'aula5'], blurb: 'Pizarra blanca, pizarrón, proyector y ventanas a Laprida.' },
  { id: 'dirPrim', title: 'Dirección primaria', rooms: ['dirPrim'], blurb: 'Biblioteca con biblioratos y escritorio color cerezo.' },
  { id: 'preceptoriaPrim', title: 'Preceptoría primaria', rooms: ['sala'], blurb: 'Junto a la Dirección, sobre el pasillo de primaria.' },
  { id: 'prof', title: 'Sala de profesores', rooms: ['prof'], blurb: 'Mesas rojas, pizarrón verde y la mesada roja.' },
  { id: 'adm', title: 'Administración', rooms: ['adm', 'hallAdm'], blurb: 'La ventanilla de atención y su hall.' },
  { id: 'patioOeste', title: 'Espacio recreativo', rooms: ['patioOeste'], blurb: 'La palmera en su cantero, el mástil y la galería de columnas negras.' },
  { id: 'cantina', title: 'Cantina | Comedor', rooms: ['buffet'], blurb: 'La línea de servicio PRO FOOD y las mesas largas del comedor.' },
  { id: 'maker', title: 'Aula Maker', rooms: ['tecnologia', 'pasilloMaker'], blurb: 'Kits Educabot, cortadora láser, impresora 3D y el mural IMAGINA · DISEÑA · CREA · APRENDE · COMPARTE.' },
  { id: 'patioEste', title: 'Patio de juegos', rooms: ['patioEste'], blurb: 'Piso verde, torre de juegos, aviarios, hamacas y la escalera blanca.' },
  { id: 'salon', title: 'Salón de los espejos', rooms: ['salon'], blurb: 'Parquet, columnas rojas, espejos y el piano.' },
  { id: 'gimnasio', title: 'Polideportivo', rooms: ['gimnasio'], blurb: 'Arcos de handball, gradas y la bandera con el escudo.' },
  { id: 'arteTeatro', title: 'Arte y Teatro', rooms: ['arte', 'teatro'], blurb: 'Las aulas de Arte y de Teatro, junto al pasillo del gimnasio.' },
  { id: 'trofeos', title: 'Pasillo de los trofeos', rooms: ['pasilloTrofeos'], blurb: 'La vitrina de trofeos sobre el dispenser y la Secretaría al fondo.' },
  { id: 'secretaria', title: 'Secretaría', rooms: ['secretaria'], blurb: 'Secretaría del nivel primario, mirando a Laprida.' },
  { id: 'sextos', title: '6° BD y 6° AC', rooms: ['aula6BD', 'aula6AC'], blurb: 'Las aulas de sexto, sobre el hall.' },
  { id: 'lockers', title: 'Pasillo de los lockers', rooms: ['pasilloL1'], blurb: 'Lockers de colores bajo las ventanas altas.' },
  { id: 'pasarela', title: 'Pasarela vidriada', rooms: ['pasarela'], blurb: 'Une el pasillo de los trofeos con el edificio de bloque.' },
  { id: 'bloque', title: 'Edificio de bloque', rooms: ['pasilloBloque', 'aulaBloqueA', 'aulaBloqueC', 'aulaBloqueD'], blurb: 'Bloque a la vista, columnas rojas y la escalera de chapa.' },
  { id: 'sectorNuevo', title: 'Sector nuevo', rooms: ['pasilloNorteL1', 'rellanoNorte'], blurb: 'Cerámico claro, mesada de venecitas y aulas con frente vidriado.' },
  { id: 'bilingue', title: 'Bilingual classroom', rooms: ['bilingue'], blurb: 'El aula bilingüe del sector nuevo.' },
  { id: 'biblioteca', title: 'Biblioteca', rooms: ['biblioteca'], blurb: 'El fichero rojo y las estanterías.' },
  { id: 'galeria', title: 'Galería roja', rooms: ['galeria'], blurb: 'Revestida en chapa roja, sobre el Espacio recreativo.' },
  { id: 'secundaria', title: 'Ala del nivel secundario', rooms: ['dirSec', 'precepSec', 'aulaSec', 'pasilloOesteL1'], blurb: 'Dirección y Preceptoría de secundaria.' },
  { id: 'danzas', title: 'Aula de danzas', rooms: ['aulaDanzas', 'hallDanzas'], blurb: 'En el segundo piso, bajo la bóveda del polideportivo.' },
  { id: 'jardin', title: 'Jardín de infantes CIMPID', rooms: ['jardinRecepcion', 'jardinGaleria', 'jardinEscalera', 'jardinHall1', 'jardinGaleria1', 'jardinHall2'], blurb: 'Educación Inicial: tres pisos de salas de colores.' },
  { id: 'salaAmarilla', title: 'Sala Amarilla', rooms: ['salaAmarilla'], blurb: 'La casita de madera y las mesas redondas azules.' },
  { id: 'salaCeleste', title: 'Sala Celeste', rooms: ['salaCeleste'], blurb: 'Mesas de colores y sillitas de madera.' },
  { id: 'salaRosa', title: 'Sala Rosa', rooms: ['salaRosa'], blurb: 'La sala del castillo.' },
  { id: 'salaRoja', title: 'Sala Roja', rooms: ['salaRoja'], blurb: 'La sala de la carpa de circo.' },
  { id: 'sum', title: 'SUM del jardín', rooms: ['sum'], blurb: 'Escenario con telón rojo.' },
  { id: 'musica', title: 'Espacio de música', rooms: ['espacioMusica'], blurb: 'Batería, gradas y la mesa larga.' },
  { id: 'encuentro', title: 'Punto de encuentro', rooms: ['__encuentro'], blurb: 'Esquina de Laprida y Miguel Cané, como marca el plano de evacuación.' },
];

/** Lugar de la libreta que corresponde a un ambiente (o a la vereda). */
export function placeForRoom(roomId: string): PlaceDef | undefined {
  return PLACES.find((p) => p.rooms.includes(roomId));
}

/**
 * Pseudo-ambientes de afuera: la vereda de Laprida y la esquina del punto de
 * encuentro. No están en el plano: se reconocen por posición.
 */
export function outsideRoom(u: number, v: number): string {
  if (Math.hypot(u - MEETING_POINT[0], v - MEETING_POINT[1]) < 4.5) return '__encuentro';
  if (v > 0.4 && v < 9 && u > -8 && u < U.e + 4) return '__laprida';
  return '';
}

// ================================================================== interactivos

const FY = LEVEL_Y[0];
/** Punto del Aula Maker frente al mural, a 0,3 m de la pared. */
const MAKER_MURAL = makerWallAt(6.4, 0.3);

export const INTERACTABLES: readonly InteractableDef[] = [
  // --- Recepción -----------------------------------------------------------
  {
    id: 'mural',
    kind: 'info',
    label: 'Mural de San Martín',
    verb: 'Mirar',
    anchor: { room: 'hall', at: [U.east1 + 0.15, -5.6] },
    y: 2.2,
    size: [0.3, 1.6, 2.6],
    range: 3.2,
    card: {
      kicker: 'Recepción',
      title: 'Mural de San Martín',
      text: 'El mural del cruce de los Andes ocupa el muro oeste de Recepción. Debajo, sobre el zócalo, está pintado el lema: «Serás lo que debas ser o no serás nada».',
    },
  },
  {
    id: 'plano',
    kind: 'info',
    label: 'Plano de evacuación',
    verb: 'Leer',
    anchor: { room: 'hall', at: [U.east1 + 0.15, -4.0] },
    y: 1.65,
    size: [0.3, 0.9, 1.3],
    range: 2.6,
    card: {
      kicker: 'Recepción',
      title: 'Plano de evacuación',
      text: 'La planta baja completa, con las salidas de emergencia en verde y el «Usted está aquí» en el hall. El punto de encuentro es la esquina de Laprida y Miguel Cané.',
    },
  },
  {
    id: 'placas',
    kind: 'info',
    label: 'Placas de bronce',
    verb: 'Mirar',
    anchor: { item: 'plaques', room: 'hall' },
    y: 1.5,
    size: [0.2, 0.8, 0.8],
    card: {
      kicker: 'Recepción',
      title: 'Placas de bronce',
      text: 'Junto a la oficina de recepción, las placas de bronce sobre madera oscura acompañan la entrada de todos los días.',
    },
  },
  {
    id: 'banner',
    kind: 'info',
    label: 'Banner de la escuela',
    verb: 'Leer',
    anchor: { item: 'banner', room: 'hall' },
    y: 1.3,
    size: [1.0, 2.0, 0.4],
    card: {
      kicker: 'Recepción',
      title: 'Banner de la escuela',
      text: '«Escuela CIMDIP & Miguel Cané · Maternal · Jardín · Primaria · Secundaria · Desde 1981». Está al pie de la escalera que sube al nivel secundario.',
    },
  },
  // --- Aula Maker ------------------------------------------------------------
  {
    id: 'educabot',
    kind: 'info',
    label: 'Muebles Educabot',
    verb: 'Mirar',
    anchor: { item: 'cabinet', room: 'tecnologia' },
    y: 1.0,
    size: [0.9, 1.9, 0.6],
    card: {
      kicker: 'Aula Maker',
      title: 'Kits Educabot',
      text: 'En los muebles de la entrada se guardan los kits de robótica Educabot: robots que se programan con secuencias de órdenes.',
    },
  },
  {
    id: 'cortadora',
    kind: 'info',
    label: 'Cortadora láser',
    verb: 'Mirar',
    anchor: { item: 'laserCutter', room: 'tecnologia' },
    y: 1.0,
    size: [0.7, 0.5, 1.1],
    card: {
      kicker: 'Aula Maker',
      title: 'Cortadora láser',
      text: 'Corta y graba a partir de un diseño hecho en la computadora. Se usa siempre con la tapa cerrada y con un docente al lado.',
    },
  },
  {
    id: 'impresora',
    kind: 'printer',
    label: 'Impresora 3D',
    verb: 'Imprimir',
    anchor: { item: 'printer3d', room: 'tecnologia' },
    y: 1.1,
    size: [0.6, 0.6, 0.6],
    ready: (q) => q.done('c1.maker'),
    notReady: 'La impresora está en pausa. El Profe Tomás la prepara cuando termines con el robot.',
    effects: [{ do: 'item', id: 'llavero' }],
  },
  {
    id: 'muralMaker',
    kind: 'info',
    label: 'Mural del Aula Maker',
    verb: 'Leer',
    anchor: { room: 'tecnologia', at: [MAKER_MURAL[0], MAKER_MURAL[1]] },
    y: 1.3,
    size: [1.5, 2.3, 0.3],
    range: 3.4,
    card: {
      kicker: 'Aula Maker',
      title: 'IMAGINA · DISEÑA · CREA · APRENDE · COMPARTE',
      text: 'El vinilo de la medianera resume cómo se trabaja en el Aula Maker. «COMPARTE» está en el testero, junto a la cortadora y la impresora.',
    },
  },
  {
    id: 'pista',
    kind: 'activity',
    activity: 'robot',
    label: 'Pista del robot',
    verb: 'Programar',
    anchor: { item: 'hexTable', room: 'tecnologia', nth: 5 },
    y: 0.95,
    size: [1.0, 0.4, 1.0],
    ready: (q) => q.flag('robotExplicado'),
    notReady: 'Primero hablá con el Profe Tomás: él explica cómo se programa.',
  },
  // --- Cantina ---------------------------------------------------------------
  {
    id: 'proFood',
    kind: 'info',
    label: 'Línea PRO FOOD',
    verb: 'Mirar',
    anchor: { item: 'buffetLine', room: 'buffet' },
    y: 1.2,
    size: [2.6, 1.2, 0.9],
    card: {
      kicker: 'Cantina | Comedor',
      title: 'PRO FOOD',
      text: 'La línea de servicio de acero, con el cartel ovalado de PRO FOOD y el riel de lámparas colgantes. Del otro lado, las mesas largas del comedor.',
    },
  },
  {
    id: 'tele',
    kind: 'screen',
    label: 'Televisor del comedor',
    verb: 'Encender',
    anchor: { item: 'tv', room: 'buffet' },
    y: 2.2,
    size: [0.3, 0.8, 1.2],
    range: 3.4,
  },
  // --- Espacio recreativo ------------------------------------------------------
  {
    id: 'palmera',
    kind: 'info',
    label: 'La palmera',
    verb: 'Mirar',
    anchor: { item: 'palm', room: 'patioOeste' },
    y: 1.5,
    size: [2.4, 3.0, 2.4],
    range: 3.2,
    card: {
      kicker: 'Espacio recreativo',
      title: 'La palmera',
      text: 'La palmera crece en su cantero, rodeado de asientos de madera. Alrededor: el mástil, los canteros con pastos y la galería de columnas negras.',
    },
  },
  {
    id: 'mastil',
    kind: 'info',
    label: 'Mástil',
    verb: 'Mirar',
    anchor: { item: 'flagpole', room: 'patioOeste' },
    y: 1.6,
    size: [0.5, 3.0, 0.5],
    card: {
      kicker: 'Espacio recreativo',
      title: 'El mástil',
      text: 'El mástil del Espacio recreativo, junto al cantero de ladrillo y el aro de básquet.',
    },
  },
  {
    id: 'campana',
    kind: 'bell',
    label: 'Campana de bronce',
    verb: 'Tocar',
    anchor: { room: 'patioOeste', at: [26.62, -14.0] },
    y: 2.25,
    size: [0.5, 0.6, 0.5],
    range: 2.8,
  },
  {
    id: 'puntoLimpio',
    kind: 'bins',
    activity: 'reciclaje',
    label: 'Punto limpio',
    verb: 'Separar residuos',
    anchor: { room: 'patioOeste', at: [22.6, -19.6] },
    y: 0.6,
    size: [2.2, 1.0, 0.7],
    ready: (q) => q.done('p.directora'),
    notReady: 'Tres cestos: reciclables, orgánicos y basura. Después del recreo hay que separar lo que quedó.',
  },
  // --- Aula de primaria --------------------------------------------------------
  {
    id: 'pizarra',
    kind: 'screen',
    label: 'Pizarra y proyector',
    verb: 'Encender el proyector',
    anchor: { item: 'board', room: 'aula4' },
    y: 1.5,
    size: [0.2, 1.3, 2.4],
    range: 3.6,
  },
  // --- Primer piso -----------------------------------------------------------
  {
    id: 'vitrina',
    kind: 'activity',
    activity: 'trivia',
    label: 'Vitrina de los trofeos',
    verb: 'Probar la trivia',
    anchor: { item: 'trophyShelf', room: 'pasilloTrofeos' },
    y: 2.0,
    size: [0.4, 0.6, 1.4],
    range: 3.0,
    ready: (q) => q.done('c1.martin'),
    notReady: 'La vitrina de los trofeos, sobre el dispenser de agua.',
  },
  {
    id: 'lockerLola',
    kind: 'locker',
    label: 'Locker de Lola',
    verb: 'Abrir',
    anchor: { item: 'lockers', room: 'pasilloL1', nth: 2 },
    y: 1.1,
    size: [2.2, 1.8, 0.6],
    when: (q) => q.available('s.camara'),
    effects: [
      { do: 'item', id: 'camara' },
      { do: 'bark', who: 'lola', text: '¡Mi cámara! Estaba abajo de la campera. ¡Gracias! Ahora sí: fotos para todo el recorrido.' },
    ],
  },
  {
    id: 'fichero',
    kind: 'info',
    label: 'Fichero de la biblioteca',
    verb: 'Mirar',
    anchor: { item: 'filing', room: 'biblioteca' },
    y: 1.0,
    size: [1.0, 1.8, 0.6],
    card: {
      kicker: 'Biblioteca',
      title: 'El fichero rojo',
      text: 'El fichero metálico rojo de la biblioteca del sector nuevo, entre las estanterías y las mesas de lectura.',
    },
  },
  // --- Edificio de bloque y polideportivo -----------------------------------
  {
    id: 'espejos',
    kind: 'info',
    label: 'Espejos y barra',
    verb: 'Mirar',
    anchor: { item: 'mirror', room: 'salon' },
    y: 1.4,
    size: [0.3, 1.8, 2.7],
    range: 3.0,
    card: {
      kicker: 'Salón de los espejos',
      title: 'Espejos con marco rojo',
      text: 'Los espejos y la barra negra van sobre el muro de bloque del polideportivo. En el testero norte: el piano y los afiches de las muestras de danzas.',
    },
  },
  {
    id: 'piano',
    kind: 'piano',
    label: 'Piano',
    verb: 'Tocar',
    anchor: { item: 'piano', room: 'salon' },
    y: 1.0,
    size: [1.5, 1.2, 0.6],
  },
  {
    id: 'escudo',
    kind: 'info',
    label: 'Bandera del escudo',
    verb: 'Mirar',
    anchor: { room: 'gimnasio', at: [U.e - 0.6, GYM_MID] },
    y: 5.0,
    size: [0.3, 2.8, 2.3],
    range: 9,
    card: {
      kicker: 'Polideportivo',
      title: 'La bandera con el escudo',
      text: 'Cuelga en el testero este, sobre el arco. El polideportivo lleva las franjas roja, blanca y azul marino de la escuela.',
    },
  },
  {
    id: 'pelota',
    kind: 'ball',
    label: 'Pelota de handball',
    verb: 'Lanzar',
    anchor: { room: 'gimnasio', at: [57.2, -7.4] },
    y: 0.12,
    size: [0.5, 0.5, 0.5],
    range: 2.2,
  },
  // --- Jardín ----------------------------------------------------------------
  {
    id: 'estrellaAmarilla',
    kind: 'star',
    label: 'Estrella de la Sala Amarilla',
    verb: 'Juntar',
    anchor: { item: 'playhouse', room: 'salaAmarilla' },
    y: 1.85,
    size: [0.5, 0.5, 0.5],
    range: 2.8,
    when: (q) => q.done('c4.caro') && !q.flag('got:estrellaAmarilla'),
    effects: [{ do: 'flag', id: 'got:estrellaAmarilla' }],
  },
  {
    id: 'estrellaRosa',
    kind: 'star',
    label: 'Estrella de la Sala Rosa',
    verb: 'Juntar',
    anchor: { item: 'playhouse', room: 'salaRosa' },
    y: 1.85,
    size: [0.5, 0.5, 0.5],
    range: 2.8,
    when: (q) => q.done('c4.caro') && !q.flag('got:estrellaRosa'),
    effects: [{ do: 'flag', id: 'got:estrellaRosa' }],
  },
  {
    id: 'estrellaRoja',
    kind: 'star',
    label: 'Estrella de la Sala Roja',
    verb: 'Juntar',
    anchor: { item: 'playhouse', room: 'salaRoja' },
    y: 1.85,
    size: [0.5, 0.5, 0.5],
    range: 2.8,
    when: (q) => q.done('c4.caro') && !q.flag('got:estrellaRoja'),
    effects: [{ do: 'flag', id: 'got:estrellaRoja' }],
  },
  {
    id: 'escenario',
    kind: 'info',
    label: 'Escenario del SUM',
    verb: 'Mirar',
    anchor: { item: 'stage', room: 'sum' },
    y: 0.9,
    size: [5.6, 1.0, 2.2],
    range: 4.2,
    card: {
      kicker: 'SUM del jardín',
      title: 'El escenario',
      text: 'Escenario de madera con telón rojo, sillas apiladas de colores y placares: acá ensayan las salas para los actos.',
    },
  },
  {
    id: 'bateria',
    kind: 'drums',
    label: 'Batería',
    verb: 'Tocar',
    anchor: { item: 'drumKit', room: 'espacioMusica' },
    y: 0.8,
    size: [1.4, 1.1, 1.2],
  },
  // --- Más fichas de lugares ------------------------------------------------
  {
    id: 'secretariaPc',
    kind: 'info',
    label: 'Secretaría',
    verb: 'Mirar',
    anchor: { item: 'desk2', room: 'secretaria' },
    y: 1.0,
    size: [1.4, 1.0, 0.7],
    card: {
      kicker: 'Primer piso',
      title: 'Secretaría del nivel primario',
      text: 'Al fondo del pasillo de los trofeos, con su ventanilla al pasillo. Por la ventana enrejada del portal se ve Laprida.',
    },
  },
  {
    id: 'profPizarron',
    kind: 'info',
    label: 'Sala de profesores',
    verb: 'Mirar',
    anchor: { item: 'blackboard', room: 'prof' },
    y: 1.5,
    size: [1.8, 1.2, 0.2],
    range: 3.2,
    card: {
      kicker: 'Planta baja',
      title: 'Sala de profesores',
      text: 'Mesas de tapa roja agrupadas, sillas blancas, la mesada roja con banquetas y el pizarrón verde.',
    },
  },
  {
    id: 'torreJuegos',
    kind: 'info',
    label: 'Torre de juegos',
    verb: 'Mirar',
    anchor: { item: 'playTower', room: 'patioEste' },
    y: 1.4,
    size: [2.6, 2.4, 2.2],
    range: 3.4,
    card: {
      kicker: 'Patio de juegos',
      title: 'La torre de los toboganes',
      text: 'Torre de madera con dos toboganes sobre la arena. Alrededor: hamacas, el domo trepador y el tobogán de colores.',
    },
  },
  {
    id: 'aviario',
    kind: 'info',
    label: 'Aviarios',
    verb: 'Mirar',
    anchor: { item: 'aviary', room: 'patioEste' },
    y: 1.2,
    size: [3.6, 2.0, 1.2],
    range: 3.2,
    card: {
      kicker: 'Patio de juegos',
      title: 'Aviarios y la choza',
      text: 'Los aviarios con techo de chapa y la choza de paja, contra la medianera pintada de azul con los azulejos de los chicos.',
    },
  },
  {
    id: 'gradas',
    kind: 'info',
    label: 'Gradas',
    verb: 'Mirar',
    anchor: { item: 'bleachers', room: 'gimnasio' },
    y: 0.8,
    size: [2.7, 1.4, 2.4],
    range: 3.2,
    card: {
      kicker: 'Polideportivo',
      title: 'Las gradas',
      text: 'Gradas de chapa negra contra el lateral de Laprida, frente a la cancha que corre de oeste a este con un arco en cada testero.',
    },
  },
  {
    id: 'teatro',
    kind: 'info',
    label: 'Teatro',
    verb: 'Mirar',
    anchor: { item: 'stage', room: 'teatro' },
    y: 0.8,
    size: [3.5, 1.0, 2.6],
    range: 3.6,
    card: {
      kicker: 'Planta baja',
      title: 'Teatro',
      text: 'Un escenario con telón y una fila de asientos, junto al aula de Arte y el pasillo del gimnasio.',
    },
  },
  {
    id: 'bilingue',
    kind: 'info',
    label: 'Bilingual classroom',
    verb: 'Mirar',
    anchor: { item: 'board', room: 'bilingue' },
    y: 1.5,
    size: [0.2, 1.3, 2.4],
    range: 3.6,
    card: {
      kicker: 'Sector nuevo',
      title: 'Bilingual classroom',
      text: 'El aula bilingüe del sector nuevo: mesas en grupos y frente vidriado al pasillo de cerámico claro.',
    },
  },
  // --- Afuera ----------------------------------------------------------------
  {
    id: 'cartelEncuentro',
    kind: 'info',
    label: 'Cartel de punto de encuentro',
    verb: 'Leer',
    anchor: { room: '', at: [MEETING_POINT[0], MEETING_POINT[1]] },
    y: 2.0,
    size: [0.6, 0.7, 0.3],
    range: 3.0,
    card: {
      kicker: 'Laprida y Miguel Cané',
      title: 'Punto de encuentro',
      text: 'El cartel verde de la esquina marca dónde se reúne toda la escuela si hay que evacuar: el mismo lugar que indica el plano del hall.',
    },
  },
];

export function interactable(id: string): InteractableDef | undefined {
  return INTERACTABLES.find((i) => i.id === id);
}

// ================================================================ cerraduras

/**
 * Rectángulo macizo sobre un vano entre `a` y `b`: el ancho del vano y
 * `pad` a cada lado del muro (en un muro en diagonal, la caja que lo envuelve).
 */
function slab(a: readonly [number, number], b: readonly [number, number], level: Level, pad = 0.25): LockDef['rect'] {
  const alongU = Math.abs(a[1] - b[1]) < 0.01;
  const alongV = Math.abs(a[0] - b[0]) < 0.01;
  const padU = alongU ? 0.05 : pad;
  const padV = alongV ? 0.05 : pad;
  return {
    u0: Math.min(a[0], b[0]) - padU,
    u1: Math.max(a[0], b[0]) + padU,
    v0: Math.min(a[1], b[1]) - padV,
    v1: Math.max(a[1], b[1]) + padV,
    level,
  };
}

/** Cierra el pie de un tramo de escalera (lo que contiene el punto dado). */
function stairLock(id: string, zone: ZoneId, u: number, v: number, reason: string): LockDef | null {
  const s = stairAt(STAIRS, u, v);
  if (!s) return null;
  const level: Level = s.y0 > 6 ? 2 : s.y0 > 3 ? 1 : 0;
  const f = stairFoot(s);
  // Cinta a 15 cm del primer escalón, del lado de donde se llega; el macizo
  // cubre también los primeros escalones para que nadie se suba de costado.
  const a: [number, number] = [f.a[0] + f.out[0] * 0.15, f.a[1] + f.out[1] * 0.15];
  const b: [number, number] = [f.b[0] + f.out[0] * 0.15, f.b[1] + f.out[1] * 0.15];
  const inner: [number, number] = [-f.out[0] * 0.5, -f.out[1] * 0.5];
  const rect = {
    u0: Math.min(a[0], b[0], a[0] + inner[0], b[0] + inner[0]) - 0.08,
    u1: Math.max(a[0], b[0], a[0] + inner[0], b[0] + inner[0]) + 0.08,
    v0: Math.min(a[1], b[1], a[1] + inner[1], b[1] + inner[1]) - 0.08,
    v1: Math.max(a[1], b[1], a[1] + inner[1], b[1] + inner[1]) + 0.08,
    level,
  };
  return { id, zone, rect, visual: 'barrier', a, b, h: 1.0, reason };
}

/** Cierra un vano de puerta con hojas del juego. */
function doorLock(id: string, zone: ZoneId, level: Level, u: number, v: number, reason: string): LockDef | null {
  const o = openingNear(level, u, v);
  if (!o) return null;
  const visual = o.type === 'door' ? 'door' : 'double';
  const h = o.type === 'entrance' ? 2.7 : o.type === 'double' ? 2.2 : 2.1;
  return { id, zone, rect: slab(o.a, o.b, level), visual, a: o.a, b: o.b, h, reason };
}

const FIRST = 'El primer piso abre más adelante: el preceptor de secundaria tiene la llave.';
const SECOND = 'El aula de danzas está cerrada hasta que Martín, el preceptor, te habilite el paso.';
const JARDIN = 'El jardín abre después del simulacro. ¡Paciencia!';

const ENTRADA = 'Rubén, el portero, abre la escuela: hablá con él en el portal.';

export const LOCKS: readonly LockDef[] = [
  // Antes de hablar con Rubén la escuela está cerrada: las puertas del portal
  // y también las salidas de emergencia, que de afuera no se abren.
  doorLock('lock-entrada', 'entrada', 0, 37.45, V.hallDoors, ENTRADA),
  doorLock('lock-salidaGimnasio', 'entrada', 0, 51.8, V.facade, ENTRADA),
  doorLock('lock-puertaGimnasio', 'entrada', 0, 66.75, V.facade, ENTRADA),
  doorLock('lock-salidaNorte', 'entrada', 0, miguelCaneU(-24.3), -24.3, ENTRADA),
  doorLock('lock-salidaOchavo', 'entrada', 0, 0.37, -8.2, ENTRADA),
  // Acceso al Nivel Secundario: primer tramo de la escalera del hall y la escalera blanca del patio este.
  stairLock('lock-hall', 'primerPiso', 33.65, -11.0, FIRST),
  stairLock('lock-blanca', 'primerPiso', 33.55, -17.0, FIRST),
  // "Acceso a primer piso" del ala oeste.
  stairLock('lock-oeste', 'primerPiso', 10.8, -12.85, FIRST),
  // Escalera principal del bloque norte: su puerta desde el pasillo norte.
  doorLock('lock-norte', 'primerPiso', 0, 20.85, V.nBlockS, FIRST),
  // Escalera exterior del patio este, contra el bloque norte.
  stairLock('lock-exterior', 'primerPiso', 33.7, -28.2, FIRST),
  // "Acceso a segundo piso": escalera de chapa del edificio de bloque.
  stairLock('lock-chapa', 'segundoPiso', 46.0, -15.3, SECOND),
  // Jardín: la puerta de la medianera vieja y las dos puertas sobre la calle.
  doorLock('lock-jardin', 'jardin', 0, 61.4, rearV(61.4), JARDIN),
  // Las puertas de la fachada del jardín sobre la calle del norte: todas las que tenga.
  ...openingsOnLine(0, (a, b) => Math.abs(a[1] - V.top) < 0.05 && Math.abs(b[1] - V.top) < 0.05 && a[0] > U.teaE - 0.1).map(
    (o, k): LockDef => ({
      id: `lock-jardinCalle${k + 1}`,
      zone: 'jardin',
      rect: slab(o.a, o.b, 0),
      visual: o.type === 'door' ? 'door' : 'double',
      a: o.a,
      b: o.b,
      h: o.type === 'door' ? 2.1 : 2.2,
      reason: JARDIN,
    }),
  ),
].filter((l): l is LockDef => l !== null);

// ============================================================ escaleras guía

/**
 * Escaleras para llevar el marcador del objetivo cuando está en otro piso:
 * el pie (abajo) y la llegada (arriba). `path` es el recorrido que verifica
 * el test, del pie a la llegada, con los pies siguiendo el piso.
 */
export interface StairGuide {
  id: string;
  zone: ZoneId | null;
  low: Spot;
  high: Spot;
  jardin?: boolean;
  path: ReadonlyArray<readonly [number, number]>;
}

export const STAIR_GUIDES: readonly StairGuide[] = [
  {
    id: 'hall',
    zone: 'primerPiso',
    low: { u: 33.65, v: -8.3, level: 0 },
    high: { u: 34.95, v: -11.4, level: 1 },
    path: [
      [33.65, -8.3],
      [33.65, -13.6],
      [34.95, -13.6],
      [34.95, -11.4],
    ],
  },
  {
    id: 'oeste',
    zone: 'primerPiso',
    low: { u: 12.75, v: -12.85, level: 0 },
    high: { u: 11.9, v: -10.25, level: 1 },
    path: [
      [12.75, -12.85],
      [8.7, -12.85],
      [8.7, -10.25],
      [11.9, -10.25],
    ],
  },
  {
    id: 'chapa',
    zone: 'segundoPiso',
    low: { u: 43.95, v: -15.3, level: 1 },
    high: { u: 43.95, v: -16.9, level: 2 },
    path: [
      [43.95, -15.3],
      [48.25, -15.3],
      [48.25, -16.9],
      [43.95, -16.9],
    ],
  },
  {
    id: 'jardin01',
    zone: 'jardin',
    jardin: true,
    low: { u: 58.4, v: -36.0, level: 0 },
    high: { u: 59.8, v: -36.0, level: 1 },
    path: [
      [58.4, -36.0],
      [58.4, -31.6],
      [59.8, -31.6],
      [59.8, -36.0],
    ],
  },
  {
    id: 'jardin12',
    zone: 'jardin',
    jardin: true,
    low: { u: 58.4, v: -36.0, level: 1 },
    high: { u: 59.8, v: -36.0, level: 2 },
    path: [
      [58.4, -36.0],
      [58.4, -31.6],
      [59.8, -31.6],
      [59.8, -36.0],
    ],
  },
];

/** ¿El ambiente es del jardín? (se sube por su propia escalera). */
export function isJardinRoom(roomId: string): boolean {
  return roomId.startsWith('jardin') || ['salaAmarilla', 'salaCeleste', 'salaRosa', 'salaRoja', 'sum', 'espacioMusica'].includes(roomId);
}

// ======================================================================= simulacro

/**
 * Ruta del simulacro: del aula de primaria al punto de encuentro, por el
 * pasillo de primaria, el hall, el portal y la vereda de Laprida. Las
 * flechas verdes se pintan a lo largo de esta poligonal; cada vértice es un
 * control que hay que pasar.
 */
export const EVAC_ROUTE: ReadonlyArray<readonly [number, number]> = [
  [24.2, -6.2],
  [24.2, -8.25],
  [31.6, -8.25],
  [36.6, -7.0],
  [37.45, -3.4],
  [37.45, 0.2],
  [37.45, 3.0],
  [20.0, 3.0],
  [2.0, 3.0],
  [-2.4, 2.4],
  [MEETING_POINT[0], MEETING_POINT[1]],
];

// ========================================================================== acto

/** Dónde se para cada uno en el acto final (polideportivo, mirando a la bandera). */
export const ACT = {
  player: { u: 60.2, v: GYM_MID, level: 0 as Level },
  stage: { u: 64.4, v: GYM_MID, level: 0 as Level },
  crew: [
    [63.4, GYM_MID - 3.0],
    [63.4, GYM_MID + 3.0],
    [62.2, GYM_MID - 4.6],
    [62.2, GYM_MID + 4.6],
    [61.0, GYM_MID - 5.8],
    [61.0, GYM_MID + 5.8],
    [59.6, GYM_MID - 2.2],
    [59.6, GYM_MID + 2.2],
    [58.4, GYM_MID - 4.2],
    [58.4, GYM_MID + 4.2],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

/** Inicio de la historia: vereda de Laprida, frente al portal. */
export const START = {
  feet: { u: 35.6, v: 8.4 },
  look: { u: 37.45, v: -1.0, y: FY + 2.6 },
};

/** Las anclas del acto, como `Anchor` para los datos de personajes. */
export const actSpot = (k: number): Anchor => ({ room: 'gimnasio', at: [ACT.crew[k][0], ACT.crew[k][1]] });
