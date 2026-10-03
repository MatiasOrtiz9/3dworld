/**
 * El plano del barrio de la escuela.
 *
 * La experiencia gira entera alrededor de la Escuela CIMDIP & Miguel Cané:
 * el mapa es la escuela en el centro y, del otro lado de cada calle que la
 * rodea, UNA hilera de manzanas con los edificios de la ciudad 2050 (vivienda
 * con terrazas verdes y patio, equipamiento cívico, mercado de madera) y una
 * torre con jardines en altura en la esquina sureste. Más allá de esa hilera
 * hay pasto, árboles y la niebla del horizonte.
 *
 * Datos puros: no importa nada del motor.
 *
 * Grilla de 5 × 5 manzanas cuadradas (así el índice espacial resuelve "en qué
 * manzana estoy" con una división); sólo se pueblan las celdas alrededor del
 * predio escolar:
 *
 *        gx:   0          1         2         3
 *   gz 1    vivienda  mercado    cívico   vivienda    ← Lafinur (z = −pitch/2)
 *   gz 2    vivienda  [ESCUELA: anexo + principal]  cívico
 *   gz 3    TORRE     vivienda  vivienda   mercado    ← Laprida (z = +pitch/2)
 *          ↑ Gral. Acha (x = −1,5 pitch)        ↑ calle oeste (x = +pitch/2)
 *
 * En este mundo el norte es −z y el este es −x (ver HANDOFF 19 y 25): el
 * gimnasio (este) cae en el anexo, del lado de Gral. Acha, y la esquina de
 * Miguel Cané y Laprida en la manzana principal. La torre queda en diagonal
 * al gimnasio, cruzando Laprida y Gral. Acha: fuera de las vistas de la
 * fachada (que miran al norte) para no aparecer detrás del portal; se la ve
 * al llegar girando hacia el este, desde los patios y desde arriba.
 */
import { Rng } from '../utils/rng';

export type BlockKind =
  | 'civic' // el predio escolar (sus dos manzanas) y equipamiento bajo y ancho
  | 'residential' // vivienda en manzana perimetral con terrazas verdes y patio
  | 'tower' // torre alta con jardines en altura
  | 'market' // mercado cubierto, estructura de madera
  // Tipos que el barrio ya no genera; quedan para que el código que todavía
  // los nombra compile (las casas bajas de `NeighborhoodBuilder`, la ciudad).
  | 'houses'
  | 'park'
  | 'water'
  | 'energy';

/** Lados de una manzana, por el eje del mundo hacia el que miran. */
export type BlockSide = 'xp' | 'xn' | 'zp' | 'zn';

export interface Block {
  gx: number;
  gz: number;
  cx: number;
  cz: number;
  width: number;
  depth: number;
  kind: BlockKind;
  ring: number;
  height: number;
  landmark?: 'school' | 'schoolAnnex';
  /** Casas (`houses`, sin uso hoy): lados con frente edificado. */
  frontage?: BlockSide[];
  /**
   * Medidas estructurales decididas en el plano (no en el constructor): así
   * son iguales en escritorio y en VR —el constructor gasta azar distinto
   * según el detalle— y la colisión de `CityIndex` coincide exacto.
   * Torre: lado del fuste (el basamento mide 1,65 veces esto).
   */
  footprint?: number;
  /** Vivienda: profundidad de las cuatro barras alrededor del patio. */
  barDepth?: number;
  /** Mercado: puestos bajo la cubierta, en mundo (centro y medidas). */
  stalls?: Array<{ x: number; z: number; w: number; h: number; d: number }>;
}

export interface Street {
  axis: 'x' | 'z';
  at: number;
  width: number;
  tram: boolean;
  gaps?: Array<[number, number]>;
  /** Tramo existente a lo largo de la calle; sin indicarlo, todo el mapa. */
  span?: [number, number];
  /** Nombre real, si es una de las calles de la escuela. */
  name?: string;
}

export interface CityPlan {
  seed: number;
  blocks: Block[];
  streets: Street[];
  gridSize: number;
  extent: number;
  blockSize: number;
  streetWidth: number;
  /** Sin canal: se conserva el campo con ancho 0 para el código heredado. */
  canal: { slope: number; offset: number; halfWidth: number };
  schoolSite?: { x0: number; x1: number; z0: number; z1: number };
  /** La ciudad que sigue más allá del barrio (ver `Backdrop`). */
  backdrop: Backdrop;
  /** Refugios de colectivo y kiosco (ver `StreetProp`). */
  props: StreetProp[];
  /** Todos los bancos de vereda y de parada que dibuja `InfraBuilder` (ver `Bench`). */
  benches: Bench[];
  /**
   * Centros de las mesitas de café que los locales sacan a la vereda (las
   * sillas, a ±0,6 m a lo largo de la cuadra). Las llena `StreetLevel` al
   * levantar los locales —el visor saca una por café y el escritorio dos—,
   * así que el plano recién las tiene después de construir la ciudad: la
   * gente de la vereda (que se arma después) las esquiva en vez de
   * atravesarlas por el carril de la fachada.
   */
  cafeTables: { x: number; z: number }[];
  /** El borde del mapa: obradores cercados del otro lado de las calles perimetrales. */
  periphery: Periphery;
}

/**
 * Periferia en obra. Más allá de las calles perimetrales no hay ciudad (HANDOFF
 * 86): en vez de pasto pelado, un cerco de obra continuo con obradores detrás.
 * Es dato del plano para que la colisión (`CityIndex`) y el dibujo
 * (`PeripheryBuilder`) usen exactamente la misma línea.
 */
export interface Periphery {
  /** Rectángulo del cerco: afuera de él todo es macizo. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Portones (centro sobre el cerco, a lo largo del lado). */
  gates: Array<{ side: BlockSide; at: number }>;
  /** Edificios en obra (esqueleto de hormigón), detrás del cerco. */
  sites: Array<{ x: number; z: number; w: number; d: number; floors: number }>;
  crane: { x: number; z: number; h: number; rot: number };
  excavator: { x: number; z: number; rot: number };
}

/**
 * Un volumen de la ciudad de fondo: una caja con fajas de ventanas en la
 * cara que mira al barrio.
 */
export interface BackdropMass {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  floors: number;
  /** Índice de tono de fachada (lo resuelve el constructor). */
  tone: number;
  /** Normal en planta de la cara con frente (ventanas, local en planta baja). */
  nx: number;
  nz: number;
  /** Lote de esquina: también lleva ventanas en el costado (`sx`, `sz`). */
  sx: number;
  sz: number;
  /** 1: la manzana de enfrente, cruzando la calle perimetral; 2: el horizonte. */
  layer: 1 | 2;
}

/**
 * La ciudad que sigue.
 *
 * Antes, más allá de la hilera de manzanas sólo había pasto y niebla: desde
 * la vereda, cada calle terminaba en el vacío y el barrio se leía como una
 * maqueta sobre una mesa. Ahora una calle perimetral cierra la hilera y, del
 * otro lado, siguen manzanas de entre medianeras (capa 1, a 30–80 m) y más
 * atrás torres y tiras que se funden con la niebla (capa 2, 150–330 m).
 * Son cajas baratas (ver `DistantCity`); la colisión las conoce.
 */
export interface Backdrop {
  masses: BackdropMass[];
  /** Manzanas de la capa 1 (macizas enteras, con su vereda alrededor). */
  blocks: Array<{ cx: number; cz: number; half: number }>;
  /** Calles visibles entre las manzanas de la capa 1 (sin tránsito). */
  streets: Array<{ axis: 'x' | 'z'; at: number; from: number; to: number }>;
}

/**
 * Equipamiento grande de vereda que se choca: refugios de colectivo y el
 * kiosco de diarios. Es dato del plano para que la colisión y el dibujo
 * coincidan (como las medidas de los edificios, HANDOFF 42).
 */
export interface StreetProp {
  kind: 'busStop' | 'kiosk';
  x: number;
  z: number;
  /** Hacia dónde mira (la calle): normal en planta. */
  nx: number;
  nz: number;
}

/** Altura de la vereda sobre el cero (la calzada está a 0,08): cordón de 12 cm. */
export const SIDEWALK_H = 0.2;

// Medidas de la sección de calle. Viven acá (y no en `InfraBuilder`) porque
// las usan también la gente (`people/Sidewalks`) y el tránsito: si cada uno
// tuviera su copia, un retoque en el dibujo dejaba a los peatones cruzando
// fuera de la cebra o a los autos frenando sobre ella.
/** Calzada: 42 % del ancho de la calle. */
export const LANE_FRAC = 0.42;
/** Ancho de la franja exterior de la vereda, donde están las rampas. */
export const RAMP_LEN = 1.3;
/** Distancia del eje de la calle transversal al centro de la senda peatonal. */
export const CROSS_AT = 6.2;
/** Ancho del cordón (canto de piedra entre la calzada y la vereda). */
export const KERB_W = 0.32;

/**
 * Banco de vereda (o de parada de colectivo). `rotY` es el giro del banco:
 * quien se sienta mira hacia (sin rotY, cos rotY), con la espalda al respaldo.
 * Está en el plano para que la gente se siente justo donde se dibuja.
 */
export interface Bench {
  x: number;
  z: number;
  rotY: number;
  /**
   * 'sidewalk': banco de vereda sobre la línea del arbolado; 'plaza': en la
   * explanada de un edificio cívico; 'stop': un asiento del banco largo de
   * una parada de colectivo (ese lo dibuja el refugio, no `InfraBuilder`).
   */
  kind: 'sidewalk' | 'plaza' | 'stop';
}

export interface LayoutOptions {
  /** Ignorado: el barrio tiene siempre el mismo tamaño (queda por compatibilidad). */
  gridSize?: number;
  blockSize?: number;
  streetWidth?: number;
}

/** Profundidad de la hilera de casas desde la línea municipal. */
export const HOUSE_DEPTH = 14;

/** Tamaño de la grilla del índice (la escuela en su centro). */
const GRID = 5;

export function generateCityPlan(seed: number, options: LayoutOptions = {}): CityPlan {
  const rng = new Rng(seed);
  const blockSize = options.blockSize ?? 42;
  const streetWidth = options.streetWidth ?? 15;
  const pitch = blockSize + streetWidth;
  const half = (GRID - 1) / 2;
  const extent = (GRID * pitch) / 2;

  const schoolSite = {
    x0: -pitch - blockSize / 2,
    x1: blockSize / 2,
    z0: -blockSize / 2,
    z1: blockSize / 2,
  };

  const blocks: Block[] = [];
  const add = (gx: number, gz: number, kind: BlockKind, extra: Partial<Block> = {}) => {
    blocks.push({
      gx,
      gz,
      cx: (gx - half) * pitch,
      cz: (gz - half) * pitch,
      width: blockSize,
      depth: blockSize,
      kind,
      ring: Math.max(Math.abs(gx - half), Math.abs(gz - half)),
      height: 9.5,
      ...extra,
    });
  };

  // El predio escolar: la manzana principal (Miguel Cané) y el anexo (gimnasio).
  add(2, 2, 'civic', { landmark: 'school' });
  add(1, 2, 'civic', { landmark: 'schoolAnnex' });

  // La hilera de manzanas: el reparto está curado, no sorteado. Bajo y de
  // escala humana enfrente del portal y del gimnasio (vivienda de 4-6 pisos,
  // cívico, mercado) y la torre en la esquina sureste. Detrás de la escuela
  // (al norte) no va nada alto: aparecería detrás del portal en la llegada.
  // Las alturas sí salen de la semilla.
  const RING: ReadonlyArray<readonly [number, number, BlockKind]> = [
    [0, 1, 'residential'],
    [1, 1, 'market'],
    [2, 1, 'civic'],
    [3, 1, 'residential'],
    [0, 2, 'residential'],
    [3, 2, 'civic'],
    [0, 3, 'tower'],
    [1, 3, 'residential'],
    [2, 3, 'residential'],
    [3, 3, 'market'],
  ];
  for (const [gx, gz, kind] of RING) {
    const extra: Partial<Block> = { height: ringHeight(rng, kind) };
    if (kind === 'tower') extra.footprint = rng.range(17, 24);
    if (kind === 'residential') extra.barDepth = rng.range(11, 14);
    if (kind === 'market') extra.stalls = marketStalls(rng, (gx - half) * pitch, (gz - half) * pitch, blockSize * 0.8);
    add(gx, gz, kind, extra);
  }

  // Calles: las cuatro que rodean la escuela, más la que separa las manzanas
  // vecinas del norte y del sur (frente al eje del predio). Cada una existe
  // sólo a lo largo del barrio.
  const xs: [number, number] = [-2.5 * pitch, 1.5 * pitch];
  const zs: [number, number] = [-1.5 * pitch, 1.5 * pitch];
  const streets: Street[] = [
    { axis: 'x', at: -pitch / 2, width: streetWidth, tram: false, span: xs, name: 'Lafinur' },
    { axis: 'x', at: pitch / 2, width: streetWidth, tram: false, span: xs, name: 'Laprida' },
    { axis: 'z', at: -1.5 * pitch, width: streetWidth, tram: false, span: zs, name: 'Gral. Acha' },
    // Entre las dos manzanas de la escuela la calle no existe: el predio es uno.
    { axis: 'z', at: -pitch / 2, width: streetWidth, tram: false, span: zs, gaps: [[schoolSite.z0, schoolSite.z1]] },
    { axis: 'z', at: pitch / 2, width: streetWidth, tram: false, span: zs },
    // Calles perimetrales: cierran la hilera por afuera. Sin ellas, la cara
    // exterior de cada manzana (con sus locales) daba a un pasto vacío.
    { axis: 'x', at: zs[0], width: streetWidth, tram: false, span: xs },
    { axis: 'x', at: zs[1], width: streetWidth, tram: false, span: xs },
    { axis: 'z', at: xs[0], width: streetWidth, tram: false, span: zs },
    { axis: 'z', at: xs[1], width: streetWidth, tram: false, span: zs },
  ];

  // En la vereda de enfrente de la escuela (Laprida), del lado de las
  // manzanas: la parada frente a la vivienda, el kiosco junto a la llegada;
  // y otra parada sobre Lafinur, frente al edificio cívico.
  const props: StreetProp[] = [
    { kind: 'busStop', x: 8, z: pitch - blockSize / 2 - 2.3, nx: 0, nz: -1 },
    { kind: 'kiosk', x: -pitch + 6, z: pitch - blockSize / 2 - 2.2, nx: 0, nz: -1 },
    { kind: 'busStop', x: 10, z: -pitch + blockSize / 2 + 2.3, nx: 0, nz: 1 },
  ];

  return {
    seed,
    blocks,
    streets,
    gridSize: GRID,
    extent,
    blockSize,
    streetWidth,
    canal: { slope: 0, offset: -1e6, halfWidth: 0 },
    schoolSite,
    // Azar propio: la ciudad de fondo no corre las alturas del barrio.
    // Sin ciudad de fondo (lo pidió el usuario): sólo la escuela y su anillo.
    backdrop: { masses: [], blocks: [], streets: [] },
    props,
    // Azar propio también: los bancos no mueven nada de lo que ya se sorteaba.
    benches: generateBenches(new Rng((seed ^ 0x0be4c5) >>> 0), blocks, props, blockSize, streetWidth),
    cafeTables: [],
    periphery: generatePeriphery(new Rng((seed ^ 0x0b7a5e11) >>> 0), xs, zs, streetWidth),
  };
}

/**
 * El cerco va 1 m afuera de la vereda exterior de las calles perimetrales (la
 * calle y su vereda siguen enteras). Azar propio: no corre nada del barrio.
 */
function generatePeriphery(rng: Rng, xs: [number, number], zs: [number, number], streetWidth: number): Periphery {
  const m = streetWidth / 2 + 1;
  const x0 = xs[0] - m;
  const x1 = xs[1] + m;
  const z0 = zs[0] - m;
  const z1 = zs[1] + m;
  const gates: Periphery['gates'] = [
    { side: 'zn', at: rng.range(-60, -20) },
    { side: 'zp', at: rng.range(-110, -80) },
    { side: 'xn', at: rng.range(-30, 30) },
    { side: 'xp', at: rng.range(-30, 30) },
  ];
  const sites: Periphery['sites'] = [
    { x: rng.range(-50, -30), z: z0 - 16, w: 26, d: 14, floors: rng.int(4, 6) },
    { x: rng.range(-110, -90), z: z1 + 17, w: 22, d: 16, floors: rng.int(3, 5) },
  ];
  return {
    x0,
    x1,
    z0,
    z1,
    gates,
    sites,
    crane: { x: sites[0].x + 22, z: z0 - 14, h: rng.range(30, 38), rot: rng.range(0, Math.PI * 2) },
    excavator: { x: sites[1].x + 22, z: z1 + 9, rot: rng.range(-0.6, 0.6) },
  };
}

/**
 * Bancos de vereda, de explanada y de parada (ver `Bench`).
 *
 * Antes los sorteaba `InfraBuilder` con el azar compartido de la ciudad, a
 * 3,4 m de cada árbol: la gente no sabía dónde estaban y alguno quedaba
 * pegado a una farola. Ahora van en lugares que nunca pisa otra cosa con
 * cualquier densidad de arbolado (los árboles caen a ±10,5 m del medio de la
 * cuadra con 2 por lado, o a ±5,25 y ±15,75 con 4; las farolas a ±9):
 *  - en las veredas con árboles (−z y −x de cada manzana), al medio de la cuadra;
 *  - en las otras dos, a 11 m del medio, junto al cantero de −15;
 *  - en la explanada de los edificios cívicos, dos frente al vidrio.
 */
function generateBenches(rng: Rng, blocks: Block[], props: StreetProp[], blockSize: number, streetWidth: number): Bench[] {
  const out: Bench[] = [];
  const half = blockSize / 2;
  // Misma línea que el arbolado de `InfraBuilder.streetscape`: 1 m detrás del cordón.
  const line = half + streetWidth / 2 - ((streetWidth * LANE_FRAC) / 2 + KERB_W + 1.0);
  const nearProp = (x: number, z: number) => props.some((p) => Math.abs(p.x - x) < 5 && Math.abs(p.z - z) < 5);
  for (const b of blocks) {
    if (b.landmark || b.kind === 'water' || b.kind === 'houses') continue;
    const sides = [
      { nx: 0, nz: -1, along: 0, p: 0.65 },
      { nx: -1, nz: 0, along: 0, p: 0.65 },
      { nx: 0, nz: 1, along: -11, p: 0.5 },
      { nx: 1, nz: 0, along: -11, p: 0.5 },
    ];
    for (const s of sides) {
      // Se tira siempre (aunque haya una parada): el resto no se corre.
      const put = rng.chance(s.p);
      const x = b.cx + (s.nx !== 0 ? s.nx * line : s.along);
      const z = b.cz + (s.nz !== 0 ? s.nz * line : s.along);
      if (!put || nearProp(x, z)) continue;
      // De espaldas a la fachada, mirando a la calle.
      out.push({ x, z, rotY: Math.atan2(s.nx, s.nz), kind: 'sidewalk' });
    }
    if (b.kind === 'civic') {
      // Explanada entre el vidrio (82 % del lado) y la vereda.
      const plaza = (b.width * 0.41 + half) / 2;
      for (const s of [-1, 1]) {
        out.push({ x: b.cx + s * rng.range(8, 12), z: b.cz + s * plaza, rotY: s > 0 ? Math.PI : 0, kind: 'plaza' });
      }
    }
  }
  // El banco largo del refugio (3,6 m, ver `StreetLevel.tramStop`): dos asientos.
  for (const p of props) {
    if (p.kind !== 'busStop') continue;
    const bx = p.x - p.nx * 0.35;
    const bz = p.z - p.nz * 0.35;
    for (const s of [-0.9, 0.9]) {
      out.push({ x: bx + p.nz * s, z: bz + p.nx * s, rotY: Math.atan2(p.nx, p.nz), kind: 'stop' });
    }
  }
  return out;
}

/** Puestos del mercado sobre su plataforma, con pasillos de 1,6 m entre ellos. */
function marketStalls(rng: Rng, cx: number, cz: number, w: number): NonNullable<Block['stalls']> {
  const stalls: NonNullable<Block['stalls']> = [];
  const n = rng.int(6, 10);
  for (let guard = 0; stalls.length < n && guard < 200; guard++) {
    const s = {
      x: cx + rng.range(-w / 2 + 2.5, w / 2 - 2.5),
      z: cz + rng.range(-w / 2 + 3, w / 2 - 3),
      w: rng.range(2, 3.4),
      h: rng.range(2.1, 2.6),
      d: rng.range(1.6, 2.4),
    };
    if (stalls.some((o) => Math.abs(o.x - s.x) < (o.w + s.w) / 2 + 1.6 && Math.abs(o.z - s.z) < (o.d + s.d) / 2 + 1.6)) continue;
    stalls.push(s);
  }
  return stalls;
}

/**
 * Altura de cada tipología. Los rangos son los de la ciudad anterior, con la
 * vivienda acotada a 4-7 pisos: enfrente de una escuela de dos plantas, las
 * barras de 30 m del anillo 2 la aplastaban.
 */
function ringHeight(rng: Rng, kind: BlockKind): number {
  switch (kind) {
    case 'tower':
      return rng.range(62, 76);
    case 'residential':
      return rng.range(14, 23);
    case 'civic':
      return rng.range(9, 14);
    case 'market':
      return rng.range(11, 14);
    default:
      return 9.5;
  }
}
