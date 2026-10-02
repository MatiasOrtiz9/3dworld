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
  };
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
