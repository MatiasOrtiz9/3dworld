import { Color3 } from '@babylonjs/core/Maths/math.color';

/**
 * Lenguaje visual solarpunk.
 *
 * La regla es: hormigón claro y cálido + madera + vidrio verdoso + vegetación
 * abundante + acentos de sol. Nada de neón, nada de gris metálico frío.
 * El futuro de esta ciudad es luminoso y habitable, no distópico.
 */

/** Convierte "#rrggbb" a Color3 lineal (Babylon espera valores 0..1). */
const hex = (h: string) => Color3.FromHexString(h);

export const PALETTE = {
  // --- estructura ---
  concreteWarm: hex('#e6dcc9'), // hormigón blanco cálido, fachadas principales
  concreteLight: hex('#eee7d8'), // remates, parapetos
  concreteShade: hex('#cfc4b0'), // caras en sombra, zócalos
  plaster: hex('#e0d1b6'),

  // --- madera (CLT / madera laminada, protagonista del solarpunk) ---
  timberLight: hex('#d8a86a'),
  timberMid: hex('#b97f45'),
  timberDark: hex('#8a5a30'),

  // --- vidrio ---
  //
  // Oscuro a propósito, y es una de las correcciones que más realismo aportó.
  // Una ventana vista desde afuera de día se ve OSCURA: el interior está mucho
  // menos iluminado que la fachada al sol, así que el vidrio refleja cielo en
  // los altos y muestra negro en el resto. Con los verdes claros que había
  // antes, las ventanas tenían el mismo valor que el muro y desaparecían: los
  // edificios parecían bloques lisos sin aberturas.
  glassGreen: hex('#28423c'),
  glassBlue: hex('#243a49'),
  glassLit: hex('#f6d99a'), // ventana encendida, para el atardecer

  // --- vegetación (varias tonalidades: un verde único se ve falso) ---
  leafDeep: hex('#2c5540'),
  leafMid: hex('#46815a'),
  leafBright: hex('#6d9c63'),
  leafPale: hex('#8fab6d'),
  moss: hex('#57724b'),

  // --- energía ---
  solarPanel: hex('#2f4270'), // azul profundo: legible, nunca negro
  solarFrame: hex('#c9cdd2'),
  turbineBody: hex('#f2f0ea'),

  // --- agua ---
  water: hex('#3f8f9c'),
  waterDeep: hex('#1d4f5c'),

  // --- suelo urbano ---
  pavement: hex('#c3b9a5'),
  pavementDark: hex('#8e8879'),  // calzada: bien mas oscura que la vereda
  tramLane: hex('#7d7768'),
  soil: hex('#5b4836'),
  // Corteza: gris pardo. Los troncos usaban la madera laminada de los
  // edificios y se leían como postes de obra color naranja.
  bark: hex('#5c4d40'),
  barkLight: hex('#7a6b5b'),

  // --- identidad de la escuela CIMDIP & Miguel Cané ---
  schoolGreen: hex('#1f5147'), // verde institucional (paneles, marcos, reja)
  schoolGold: hex('#e0b049'), // dorado de las letras y el logo
  schoolCream: hex('#f3e9d4'), // muro claro de las aulas
  brick: hex('#a9573c'), // zócalo de ladrillo
  court: hex('#3d7f8f'), // solado deportivo

  // --- acentos ---
  sun: hex('#f2c14e'),
  terracotta: hex('#c96f48'),
  signal: hex('#e8845c'),
} as const;

/** Tonos de hoja, para variar la vegetación sin que se note el patrón. */
export const LEAF_TONES = [
  PALETTE.leafDeep,
  PALETTE.leafMid,
  PALETTE.leafBright,
  PALETTE.leafPale,
  PALETTE.moss,
] as const;

/** Tonos de fachada. */
export const FACADE_TONES = [
  PALETTE.concreteWarm,
  PALETTE.concreteLight,
  PALETTE.plaster,
  PALETTE.timberLight,
  PALETTE.timberMid,
  PALETTE.terracotta,
  PALETTE.concreteShade,
] as const;
