import {
  U,
  V,
  hw,
  item,
  itemsOn,
  onLevel,
  rear,
  rearV,
  rect,
  roomsOn,
  seg,
  vw,
  type Item,
  type Landing,
  type Level,
  type Op,
  type Rect,
  type Room,
  type Stair,
  type Wall,
} from './SchoolBase';

/**
 * Jardín de infantes CIMPID ("Educación Inicial"), recorrido 10:38–13:56.
 *
 * El plano lo dibuja como una caja al norte del gimnasio ("Nuevo edificio
 * modelo jardín de infantes CIMPID"), entre la medianera del fondo y la calle
 * de atrás; el plano manda, así que el jardín ocupa esa caja (≈9,75 m de
 * ancho) y su fachada roja mira a esa calle. El video muestra tres plantas y
 * sus ambientes; acá entran los esenciales en el mismo orden que el recorrido:
 *
 * - Planta baja: recepción con el muro rojo, el logo y el banco azul (10:45–
 *   10:58), la escalera en U contra el oeste (11:49), la galería y la Sala
 *   Amarilla (11:17–11:37). La puerta de la medianera vieja lleva al pasillo
 *   del gimnasio.
 * - Primer piso: hall, Sala Celeste sobre la fachada (12:07), galería con su
 *   baranda y las salas Rosa (castillo, 12:26) y Roja (carpa de circo, 12:55).
 * - Segundo piso: el Salón de usos múltiples con escenario y telón rojo
 *   (13:12–13:34) y el Espacio de música sobre la fachada (13:35).
 *
 * Quedan fuera por falta de lugar en la caja del plano, no por inventar: la
 * Sala Verde, la Sala Lila, la de la casita celeste y el patio con los Rotoys.
 */

/** Líneas del jardín (u). */
export const UJ = {
  w: U.teaE,
  /** Escalera en U contra el muro oeste. */
  stair: 60.55,
  /** Galería: su lado este. */
  gallery: 62.2,
  e: U.e,
} as const;

/** Líneas del jardín (v). */
export const VJ = {
  /** Fachada sobre la calle del norte. */
  front: V.top,
  /** Recepción y hall de cada piso: su lado sur. */
  hall: -35.4,
  /** Primer piso: entre las salas Rosa y Roja. */
  rosa: -31.2,
  /** Descanso de la escalera: su lado norte. */
  landing: -32.6,
} as const;

/** Polígono entre dos u, de la línea `v0` hasta la medianera del fondo. */
const toRear = (u0: number, u1: number, v0: number) => [
  [u0, v0] as const,
  [u1, v0] as const,
  rear(u1),
  rear(u0),
];

// ==================================================================== ambientes

const R0: Room[] = [
  {
    id: 'jardinRecepcion',
    name: 'Jardín de infantes CIMPID',
    caption: 'Recepción · Educación Inicial',
    poly: rect(UJ.w, VJ.front, UJ.e, VJ.hall),
    floor: 'ceramic',
    roofed: true,
  },
  { id: 'jardinEscalera', name: 'Escalera', caption: 'Acceso a primer piso', poly: toRear(UJ.w, UJ.stair, VJ.hall), floor: 'tile', roofed: true },
  { id: 'jardinGaleria', name: 'Galería', caption: 'Jardín de infantes', poly: toRear(UJ.stair, UJ.gallery, VJ.hall), floor: 'terracotta', roofed: true },
  { id: 'salaAmarilla', name: 'Sala Amarilla', poly: toRear(UJ.gallery, UJ.e, VJ.hall), floor: 'ceramic', roofed: true },
];

const R1: Room[] = [
  { id: 'jardinHall1', name: 'Hall', caption: 'Jardín · primer piso', poly: rect(UJ.w, VJ.front, UJ.gallery, VJ.hall), floor: 'ceramic', roofed: true },
  { id: 'salaCeleste', name: 'Sala Celeste', poly: rect(UJ.gallery, VJ.front, UJ.e, VJ.hall), floor: 'ceramic', roofed: true },
  { id: 'jardinGaleria1', name: 'Galería', caption: 'Jardín · primer piso', poly: toRear(UJ.stair, UJ.gallery, VJ.hall), floor: 'ceramic', roofed: true },
  { id: 'salaRosa', name: 'Sala Rosa', poly: rect(UJ.gallery, VJ.hall, UJ.e, VJ.rosa), floor: 'ceramic', roofed: true },
  { id: 'salaRoja', name: 'Sala Roja', poly: toRear(UJ.gallery, UJ.e, VJ.rosa), floor: 'ceramic', roofed: true },
];

const R2: Room[] = [
  { id: 'jardinHall2', name: 'Hall', caption: 'Jardín · segundo piso', poly: rect(UJ.w, VJ.front, UJ.gallery, VJ.hall), floor: 'ceramic', roofed: true },
  { id: 'espacioMusica', name: 'Espacio de música', poly: rect(UJ.gallery, VJ.front, UJ.e, VJ.hall), floor: 'ceramic', roofed: true },
  { id: 'sum', name: 'Salón de usos múltiples', caption: 'SUM del jardín', poly: toRear(UJ.stair, UJ.e, VJ.hall), floor: 'wood', roofed: true },
];

export const JARDIN_ROOMS: readonly Room[] = [...R0, ...roomsOn(1, R1), ...roomsOn(2, R2)];

// ======================================================================== muros

/** Fachada roja sobre la calle, piso por piso (10:38–10:41). */
const FRONT: readonly (readonly Op[])[] = [
  // Dos puertas vidriadas con dibujos pintados.
  [
    [59.9, 62.7, 'double', undefined, undefined, 'glass'],
    [63.8, 66.6, 'double', undefined, undefined, 'glass'],
  ],
  // Primer piso: dos paños al oeste del pilar rojo y cuatro al este.
  [
    [59.7, 62.1, 'window', 1.1, 2.2, undefined, 'whiteBars'],
    [62.5, 67.0, 'window', 1.1, 2.2, undefined, 'whiteBars'],
  ],
  // Segundo piso: la tira de seis hojas.
  [
    [59.7, 62.0, 'window', 1.0, 2.3, undefined, 'whiteBars'],
    // A los dos lados del tabique de la sala (antes una ventana se metía en él).
    [62.4, 64.65, 'window', 1.0, 2.3, undefined, 'whiteBars'],
    [64.75, 67.1, 'window', 1.0, 2.3, undefined, 'whiteBars'],
  ],
];

/** Cerramiento de cada piso: fachada roja, laterales ciegos (medianeras). */
function shell(level: Level): Wall[] {
  return onLevel(level, [
    { ...hw(VJ.front, UJ.w, UJ.e, 'ext', FRONT[level]), ext: 'jardinRed' },
    vw(UJ.w, VJ.front, rearV(UJ.w), 'ext'),
    vw(UJ.e, VJ.front, rearV(UJ.e), 'ext'),
  ]);
}

const W0: Wall[] = [
  ...shell(0),
  // Fondo de la recepción: la escalera y la galería abiertas, y el muro rojo
  // con el logo y el banco azul (10:50).
  hw(VJ.hall, UJ.w, UJ.e, 'int', [
    [57.75, 60.45, 'pass'],
    [60.65, 62.1, 'pass'],
  ]),
  vw(UJ.stair, VJ.hall, rearV(UJ.stair)),
  // Sala Amarilla: puerta y ventanas a la galería (11:39–11:49).
  vw(UJ.gallery, VJ.hall, rearV(UJ.gallery), 'int', [
    [-33.4, -34.3, 'door', undefined, undefined, 'frame'],
    [-28.6, -32.6, 'window', 0.9, 2.2],
  ]),
];

const W1: Wall[] = [
  ...shell(1),
  // Sobre el techo del pasillo del gimnasio: ventana de la Sala Roja.
  seg(rear(UJ.w), rear(UJ.e), 'ext', [[63.0, 64.6, 'window']]),
  vw(UJ.gallery, VJ.front, VJ.hall, 'int', [[-36.3, -37.2, 'door', undefined, undefined, 'frame']]),
  hw(VJ.hall, UJ.gallery, UJ.e),
  vw(UJ.stair, VJ.hall, rearV(UJ.stair)),
  // Galería del primer piso: mira adentro de las salas (12:42–12:55).
  vw(UJ.gallery, VJ.hall, rearV(UJ.gallery), 'int', [
    [-33.6, -34.5, 'door', undefined, undefined, 'frame'],
    [-31.8, -33.1, 'window', 0.9, 2.1],
    [-29.6, -30.5, 'door', undefined, undefined, 'frame'],
  ]),
  hw(VJ.rosa, UJ.gallery, UJ.e),
];

const W2: Wall[] = [
  ...shell(2),
  // Ventanas enrejadas del SUM sobre el fondo (13:14).
  seg(rear(UJ.w), rear(UJ.e), 'ext', [
    [61.2, 62.4, 'window'],
    [64.0, 65.4, 'window'],
  ]),
  vw(UJ.gallery, VJ.front, VJ.hall, 'int', [[-36.4, -37.3, 'door', undefined, undefined, 'frame']]),
  hw(VJ.hall, UJ.stair, UJ.e, 'int', [[60.7, 61.9, 'double', undefined, undefined, 'frame']]),
  vw(UJ.stair, VJ.hall, rearV(UJ.stair)),
];

export const JARDIN_WALLS: readonly Wall[] = [...W0, ...onLevel(1, W1), ...onLevel(2, W2)];

// =================================================================== escaleras

/** Escalera en U contra el muro oeste: la misma en cada piso (11:49–13:11). */
function flights(y: number): Stair[] {
  return [
    { u0: 57.8, v0: VJ.hall, u1: 59.05, v1: VJ.landing, dir: 'v+', y0: y, y1: y + 1.65 },
    { u0: 59.2, v0: VJ.hall, u1: 60.45, v1: VJ.landing, dir: 'v-', y0: y + 1.65, y1: y + 3.3 },
  ];
}

export const JARDIN_STAIRS: readonly Stair[] = [...flights(0), ...flights(3.3)];

export const JARDIN_LANDINGS: readonly Landing[] = [
  { u0: 57.8, v0: VJ.landing, u1: 60.45, v1: VJ.landing + 2.2, y: 1.65 },
  { u0: 57.8, v0: VJ.landing, u1: 60.45, v1: VJ.landing + 2.2, y: 4.95, hollow: true },
];

const WELL: Rect = { u0: UJ.w, v0: VJ.hall, u1: UJ.stair, v1: rearV(UJ.stair) };

export const JARDIN_VOIDS: ReadonlyArray<Rect & { level: Level }> = [
  { ...WELL, level: 1 },
  { ...WELL, level: 2 },
];

// ================================================================= equipamiento

const I0: Item[] = [
  // Recepción: muro rojo con el logo y banco azul sobre tacos rojos.
  { ...item('wallPanel', 64.77, VJ.hall - 0.13, 4.94, 0.03, 'n', false), y: 0, h: 2.7, color: 'red' },
  { ...item('bench', 64.8, VJ.hall - 0.45, 2.0, 0.45, 'n', false), color: 'navy' },
  item('extinguisher', UJ.w + 0.24, -37.6, 0.17, 0.17, 'e', false),
  // Sala Amarilla: casita de madera, cinco mesas redondas azules, placares blancos.
  item('playhouse', 66.2, -34.3, 1.6, 1.4),
  ...[
    // Fuera del paso de la puerta de la galería.
    [64.0, -33.5],
    [65.6, -31.6],
    [63.4, -30.6],
    [65.8, -29.0],
    [63.8, -28.6],
  ].map(([u, v]) => ({ ...item('roundTable', u, v, 1.0, 1.0), color: 'blue' })),
  { ...item('shelf', UJ.e - 0.38, -31.0, 0.45, 2.4, 'w'), color: 'board' },
];

const I1: Item[] = [
  // Sala Celeste: mesas de colores juntas y sillitas de madera.
  { ...item('table', 64.2, -37.2, 1.2, 0.7), color: 'yellow' },
  { ...item('table', 65.4, -37.2, 1.2, 0.7), color: 'blue' },
  // Mirando a las mesas (al norte); antes les daban la espalda.
  ...[63.9, 64.7, 65.5].map((u) => ({ ...item('chair', u, -36.6, 0.36, 0.36, 'n', false), color: 'timber' })),
  // Sala Rosa: el castillo y la pizarra. Las casitas de las salas del
  // primer piso son rosas con techo blanco (ref/roja_sheet.png), no rojas.
  { ...item('playhouse', 66.2, -33.2, 1.6, 1.4), color: 'pinkWall' },
  item('board', UJ.e - 0.17, -34.4, 0.04, 1.6, 'w', false),
  // Sala Roja: carpa de circo (casita) y mesas redondas rojas.
  { ...item('playhouse', 66.1, -29.4, 1.6, 1.4), color: 'pinkWall' },
  ...[
    [63.7, -30.2],
    [63.9, -28.5],
  ].map(([u, v]) => ({ ...item('roundTable', u, v, 1.0, 1.0), color: 'red' })),
];

const I2: Item[] = [
  // SUM: escenario al fondo con telón rojo, sillas apiladas y placares.
  item('stage', 64.0, -29.3, 5.6, 2.2, 'n'),
  item('curtain', 64.0, -30.45, 5.6, 0.1, 'n', false),
  ...[64.4, 64.9, 65.4, 65.9].map((u, k) => ({ ...item('stack', u, -34.95, 0.45, 0.45), color: (['metalDark', 'chairGreen', 'orange', 'metalDark'] as const)[k], h: 1.4 })),
  { ...item('shelf', 60.88, -30.6, 0.45, 2.0, 'e'), color: 'board' },
  // Baranda sobre el canto del pozo de la escalera, del muro a la llegada
  // del último tramo (3,3 m de caída sin nada).
  { ...item('gate', 58.5, VJ.hall - 0.025, 1.4, 0.05, 's', true), color: 'metalDark', h: 1.05 },
  // Tanques de agua sobre la azotea del frente (toma aérea).
  ...[58.6, 60.2].map((u) => ({ ...item('waterTank', u, -37.6, 1.2, 1.2, 's', false), y: 3.3 })),
  // Espacio de música: batería, gradas contra el muro este y mesa larga.
  // Mesa contra el muro del hall y batería hacia la fachada: queda un paso
  // de 1 m de la puerta a las gradas (antes la mesa tapaba la puerta).
  item('drumKit', 64.9, -37.95, 1.4, 1.2),
  item('risers', 66.54, -37.2, 1.4, 2.6, 'w'),
  { ...item('table', 64.6, -35.95, 1.8, 0.7) },
];

export const JARDIN_ITEMS: readonly Item[] = [...I0, ...itemsOn(1, I1), ...itemsOn(2, I2)];
