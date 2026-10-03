import type { SignStyle } from './SignAtlas';

type Rgb = readonly [number, number, number];

/** Lo que se exhibe en la vereda delante del local. */
export type ShopOutside = 'crates' | 'tables' | 'flowers' | 'rack' | 'none';

/**
 * Un rubro de comercio de barrio: cómo se ve por dentro (pared, piso,
 * estantes y mercadería), su cartel, su toldo y lo que saca a la vereda.
 * Los colores de interior son los de un local ENCENDIDO visto desde la
 * vereda (se dibujan sin luz, ver `TintFarm` 'glow'): cálidos y algo
 * apagados, para que la vitrina se lea iluminada sin brillar como un cartel.
 */
export interface ShopType {
  sign: SignStyle;
  wall: Rgb;
  floor: Rgb;
  shelf: Rgb;
  products: readonly Rgb[];
  /** Toldo: colores (si son dos, a rayas) y probabilidad. */
  awning: readonly Rgb[];
  awningChance: number;
  counter: boolean;
  outside: ShopOutside;
  /** Cartel bandera perpendicular a la fachada. */
  blade: boolean;
}

const WARM_LIGHT: Rgb = [0.93, 0.86, 0.72];

/** Rubros de un barrio porteño. Nombres genéricos: no hay marcas. */
export const SHOP_TYPES: readonly ShopType[] = [
  {
    sign: { text: 'PANADERÍA', bg: '#f3e2b8', fg: '#7a3b12', font: 'serif' },
    wall: [0.78, 0.66, 0.48],
    floor: [0.55, 0.42, 0.3],
    shelf: [0.5, 0.33, 0.18],
    products: [
      [0.83, 0.6, 0.32],
      [0.72, 0.48, 0.22],
      [0.9, 0.78, 0.55],
    ],
    awning: [[0.55, 0.2, 0.14]],
    awningChance: 0.6,
    counter: true,
    outside: 'none',
    blade: true,
  },
  {
    sign: { text: 'VERDULERÍA', bg: '#2f6b35', fg: '#fff6d8', font: 'sans' },
    wall: [0.7, 0.72, 0.62],
    floor: [0.45, 0.45, 0.42],
    shelf: [0.42, 0.3, 0.18],
    products: [
      [0.82, 0.25, 0.15],
      [0.95, 0.6, 0.12],
      [0.35, 0.62, 0.22],
      [0.9, 0.82, 0.25],
    ],
    awning: [
      [0.2, 0.45, 0.25],
      [0.92, 0.9, 0.84],
    ],
    awningChance: 0.85,
    counter: false,
    outside: 'crates',
    blade: false,
  },
  {
    sign: { text: 'FARMACIA', bg: '#ffffff', fg: '#0f7a43', font: 'sans', rule: '#0f7a43' },
    wall: [0.9, 0.92, 0.9],
    floor: [0.78, 0.78, 0.76],
    shelf: [0.85, 0.86, 0.85],
    products: [
      [0.3, 0.55, 0.85],
      [0.95, 0.95, 0.95],
      [0.85, 0.3, 0.35],
      [0.4, 0.75, 0.55],
    ],
    awning: [],
    awningChance: 0,
    counter: true,
    outside: 'none',
    blade: true,
  },
  {
    sign: { text: 'KIOSCO', bg: '#d9262c', fg: '#ffffff', font: 'sans' },
    wall: [0.85, 0.8, 0.7],
    floor: [0.5, 0.48, 0.45],
    shelf: [0.6, 0.6, 0.62],
    products: [
      [0.9, 0.2, 0.2],
      [0.2, 0.45, 0.9],
      [0.95, 0.8, 0.15],
      [0.95, 0.5, 0.15],
      [0.6, 0.25, 0.6],
    ],
    awning: [],
    awningChance: 0,
    counter: true,
    outside: 'rack',
    blade: true,
  },
  {
    sign: { text: 'CAFÉ', bg: '#2b1d14', fg: '#f0c98a', font: 'serif', rule: '#f0c98a' },
    wall: [0.62, 0.46, 0.32],
    floor: [0.4, 0.28, 0.2],
    shelf: [0.35, 0.22, 0.13],
    products: [
      [0.75, 0.55, 0.3],
      [0.5, 0.32, 0.2],
      [0.9, 0.85, 0.75],
    ],
    awning: [[0.18, 0.15, 0.13]],
    awningChance: 0.75,
    counter: true,
    outside: 'tables',
    blade: true,
  },
  {
    sign: { text: 'LIBRERÍA', bg: '#1d3557', fg: '#f1e3c8', font: 'serif' },
    wall: [0.8, 0.74, 0.62],
    floor: [0.5, 0.38, 0.28],
    shelf: [0.45, 0.3, 0.18],
    products: [
      [0.75, 0.2, 0.2],
      [0.2, 0.35, 0.65],
      [0.85, 0.75, 0.3],
      [0.3, 0.55, 0.35],
      [0.9, 0.9, 0.85],
    ],
    awning: [[0.12, 0.22, 0.38]],
    awningChance: 0.4,
    counter: true,
    outside: 'none',
    blade: false,
  },
  {
    sign: { text: 'FERRETERÍA', bg: '#f2b705', fg: '#1a1a1a', font: 'sans' },
    wall: [0.72, 0.7, 0.66],
    floor: [0.42, 0.42, 0.42],
    shelf: [0.35, 0.36, 0.4],
    products: [
      [0.8, 0.15, 0.12],
      [0.2, 0.3, 0.6],
      [0.95, 0.75, 0.1],
      [0.55, 0.55, 0.58],
    ],
    awning: [],
    awningChance: 0,
    counter: true,
    outside: 'none',
    blade: true,
  },
  {
    sign: { text: 'ALMACÉN', bg: '#7b2d26', fg: '#f6e7c8', font: 'serif', rule: '#f6e7c8' },
    wall: [0.8, 0.72, 0.56],
    floor: [0.5, 0.4, 0.3],
    shelf: [0.5, 0.34, 0.2],
    products: [
      [0.9, 0.85, 0.7],
      [0.8, 0.3, 0.2],
      [0.3, 0.5, 0.3],
      [0.95, 0.75, 0.3],
      [0.3, 0.35, 0.6],
    ],
    awning: [
      [0.6, 0.15, 0.12],
      [0.95, 0.92, 0.85],
    ],
    awningChance: 0.6,
    counter: true,
    outside: 'none',
    blade: false,
  },
  {
    sign: { text: 'HELADERÍA', bg: '#f6c9d6', fg: '#8a1f4a', font: 'script' },
    wall: [0.95, 0.85, 0.85],
    floor: [0.85, 0.8, 0.78],
    shelf: [0.9, 0.9, 0.92],
    products: [
      [0.98, 0.75, 0.8],
      [0.6, 0.85, 0.6],
      [0.98, 0.92, 0.6],
      [0.55, 0.35, 0.25],
    ],
    awning: [
      [0.85, 0.35, 0.55],
      [0.98, 0.95, 0.95],
    ],
    awningChance: 0.6,
    counter: true,
    outside: 'tables',
    blade: true,
  },
  {
    sign: { text: 'PELUQUERÍA', bg: '#111111', fg: '#e8e8e8', font: 'sans', rule: '#c9a24a' },
    wall: [0.85, 0.85, 0.82],
    floor: [0.2, 0.2, 0.22],
    shelf: [0.9, 0.9, 0.9],
    products: [
      [0.85, 0.85, 0.9],
      [0.3, 0.3, 0.32],
    ],
    awning: [],
    awningChance: 0,
    counter: false,
    outside: 'none',
    blade: true,
  },
  {
    sign: { text: 'LAVANDERÍA', bg: '#3aa6d8', fg: '#ffffff', font: 'sans' },
    wall: [0.85, 0.9, 0.95],
    floor: [0.75, 0.78, 0.8],
    shelf: [0.92, 0.94, 0.96],
    products: [
      [0.92, 0.94, 0.96],
      [0.35, 0.65, 0.85],
    ],
    awning: [],
    awningChance: 0,
    counter: true,
    outside: 'none',
    blade: false,
  },
  {
    sign: { text: 'BICICLETERÍA', bg: '#e8f0e3', fg: '#245c3a', font: 'sans', rule: '#245c3a' },
    wall: [0.75, 0.75, 0.72],
    floor: [0.4, 0.4, 0.4],
    shelf: [0.3, 0.3, 0.32],
    products: [
      [0.85, 0.2, 0.15],
      [0.15, 0.4, 0.75],
      [0.15, 0.15, 0.15],
      [0.95, 0.85, 0.2],
    ],
    awning: [[0.2, 0.4, 0.3]],
    awningChance: 0.4,
    counter: false,
    outside: 'rack',
    blade: true,
  },
  {
    sign: { text: 'PIZZERÍA', bg: '#0f5132', fg: '#ffffff', font: 'serif', rule: '#c0392b' },
    wall: [0.85, 0.7, 0.5],
    floor: [0.6, 0.25, 0.2],
    shelf: [0.45, 0.28, 0.16],
    products: [
      [0.95, 0.75, 0.35],
      [0.75, 0.2, 0.15],
      [0.9, 0.88, 0.8],
    ],
    awning: [
      [0.7, 0.15, 0.12],
      [0.95, 0.93, 0.88],
    ],
    awningChance: 0.7,
    counter: true,
    outside: 'tables',
    blade: true,
  },
  {
    sign: { text: 'DIETÉTICA', bg: '#c8d96f', fg: '#2c3b12', font: 'sans' },
    wall: [0.85, 0.8, 0.66],
    floor: [0.55, 0.45, 0.32],
    shelf: [0.55, 0.38, 0.22],
    products: [
      [0.85, 0.65, 0.35],
      [0.55, 0.65, 0.3],
      [0.7, 0.45, 0.25],
      [0.95, 0.9, 0.75],
    ],
    awning: [[0.45, 0.55, 0.22]],
    awningChance: 0.5,
    counter: true,
    outside: 'none',
    blade: false,
  },
  {
    sign: { text: 'FLORERÍA', bg: '#f4e1ea', fg: '#7a2350', font: 'script' },
    wall: [0.85, 0.85, 0.8],
    floor: [0.5, 0.48, 0.42],
    shelf: [0.4, 0.5, 0.35],
    products: [
      [0.85, 0.2, 0.35],
      [0.95, 0.8, 0.2],
      [0.6, 0.3, 0.75],
      [0.3, 0.6, 0.3],
    ],
    awning: [[0.3, 0.45, 0.3]],
    awningChance: 0.5,
    counter: false,
    outside: 'flowers',
    blade: false,
  },
  {
    sign: { text: 'ÓPTICA', bg: '#f5f5f5', fg: '#203a63', font: 'sans', rule: '#203a63' },
    wall: [0.92, 0.92, 0.9],
    floor: [0.6, 0.6, 0.6],
    shelf: [0.95, 0.95, 0.95],
    products: [
      [0.2, 0.2, 0.25],
      [0.7, 0.55, 0.3],
    ],
    awning: [],
    awningChance: 0,
    counter: true,
    outside: 'none',
    blade: true,
  },
  {
    sign: { text: 'CARNICERÍA', bg: '#ffffff', fg: '#9b1c1c', font: 'serif', rule: '#9b1c1c' },
    wall: [0.92, 0.92, 0.9],
    floor: [0.78, 0.78, 0.78],
    shelf: [0.85, 0.88, 0.9],
    products: [
      [0.75, 0.25, 0.25],
      [0.9, 0.7, 0.65],
    ],
    awning: [
      [0.6, 0.12, 0.12],
      [0.95, 0.95, 0.95],
    ],
    awningChance: 0.5,
    counter: true,
    outside: 'none',
    blade: false,
  },
  {
    sign: { text: 'MERCERÍA', bg: '#5b3f8c', fg: '#f7eefc', font: 'script' },
    wall: [0.85, 0.78, 0.82],
    floor: [0.5, 0.42, 0.4],
    shelf: [0.5, 0.38, 0.3],
    products: [
      [0.9, 0.3, 0.5],
      [0.3, 0.5, 0.85],
      [0.95, 0.85, 0.4],
      [0.5, 0.75, 0.6],
    ],
    awning: [[0.4, 0.28, 0.6]],
    awningChance: 0.45,
    counter: true,
    outside: 'none',
    blade: false,
  },
];

/** Hall de entrada de un edificio de vivienda: mármol claro y una luz cálida. */
export const LOBBY = {
  wall: [0.78, 0.74, 0.66] as Rgb,
  floor: [0.62, 0.58, 0.52] as Rgb,
  light: WARM_LIGHT,
  door: [0.22, 0.15, 0.1] as Rgb,
  brass: [0.78, 0.62, 0.3] as Rgb,
};

/** Cielorraso encendido de un local. */
export const SHOP_CEILING: Rgb = [0.95, 0.92, 0.84];
export const SHOP_LIGHT: Rgb = WARM_LIGHT;

/** Ropa tendida: colores de sábanas, remeras y toallas. */
export const LAUNDRY: readonly Rgb[] = [
  [0.95, 0.95, 0.93],
  [0.85, 0.3, 0.3],
  [0.3, 0.45, 0.8],
  [0.95, 0.8, 0.3],
  [0.4, 0.7, 0.5],
  [0.9, 0.6, 0.7],
  [0.6, 0.6, 0.65],
];
