import type { CharacterLook, NpcRole } from '../../game/contracts';
import { Rng } from '../../utils/rng';

/**
 * Aspecto de cada persona: cuerpo, proporciones por edad y ropa.
 *
 * Datos puros, sin motor: lo usa la simulación (velocidades, alturas de
 * asiento) y el render (colores y piezas). Todo sale de un `Rng`, así que la
 * misma semilla viste a la misma gente.
 *
 * Las proporciones NO son una escala uniforme de un adulto: un chico de
 * jardín tiene la cabeza grande y las piernas cortas respecto de su altura.
 * Con una sola escala los chicos parecían adultos en miniatura, que es lo
 * primero que delata a una multitud generada.
 */

export type RGB = readonly [number, number, number];

export type HairStyle = 'short' | 'long' | 'bun' | 'ponytail' | 'curly' | 'bald' | 'cap';
/** Pieza del tronco: remera/camisa/buzo, guardapolvo a cuadritos o guardapolvo blanco. */
export type TorsoPart = 'torso' | 'smock' | 'coat';
export type AgeGroup = 'kid' | 'child' | 'teen' | 'adult' | 'senior';
/** Postura de espera: brazos sueltos, manos atrás o brazos cruzados. */
export type IdleStyle = 0 | 1 | 2;

export interface Appearance {
  role: NpcRole;
  age: AgeGroup;
  feminine: boolean;
  /** Altura total en metros. */
  height: number;
  /** Largo de piernas, cabeza y brazos respecto de un adulto de la misma altura. */
  legK: number;
  headK: number;
  armK: number;
  /** Contextura (ancho general) y ancho relativo de hombros y caderas. */
  build: number;
  shoulderK: number;
  hipK: number;
  skin: RGB;
  hair: RGB;
  hairStyle: HairStyle;
  /** Prenda de arriba (y mangas), prenda de abajo y calzado. */
  top: RGB;
  bottom: RGB;
  shoe: RGB;
  torsoPart: TorsoPart;
  shortSleeves: boolean;
  skirt: boolean;
  /** Piernas a la vista debajo de la pollera o el short. */
  bareLegs: boolean;
  /** Ribete rojo del buzo de secundaria (cuello, cintura y escudo). */
  trim: RGB | null;
  apron: RGB | null;
  backpack: RGB | null;
  glasses: RGB | null;
  prop: 'mop' | null;
  idleStyle: IdleStyle;
  /** Velocidades propias (m/s): caminar y correr. */
  walkSpeed: number;
  runSpeed: number;
}

// ------------------------------------------------------------------ colores

/** Hex `#rrggbb` → [r, g, b] en 0..1 (sin motor: esto también corre en los tests). */
export function hexRgb(h: string): RGB {
  const s = h.startsWith('#') ? h.slice(1) : h;
  const n = parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s, 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const hx = (list: string[]): RGB[] => list.map(hexRgb);

/** Uniforme CIMDIP: chomba roja y azul marino. */
export const UNIFORM_RED = hexRgb('#c84445');
export const UNIFORM_NAVY = hexRgb('#202d4b');

/** Tonos de piel: más claros y medios, como en un aula del conurbano, y algunos oscuros. */
const SKINS = hx(['#f3d5bd', '#eccaa9', '#e3b48e', '#d9a47c', '#c98e66', '#b07650', '#8f5a3a', '#6e432b']);
const SKIN_W = [1.0, 1.2, 1.3, 1.2, 0.9, 0.6, 0.35, 0.2];
const HAIR_DARK = hx(['#1b1411', '#271b14', '#38261b', '#4d3322']);
const HAIR_LIGHT = hx(['#6e4a2c', '#8f6238', '#b88b56', '#d2ad74']);
const HAIR_RED = hexRgb('#8a3a1f');
const HAIR_GREY = hx(['#8e8b86', '#b5b1aa', '#d8d4cc']);
/** Ropa de calle: colores de tela reales (nada fluo), con algún acento. */
const CASUAL_TOPS = hx([
  '#f2efe8', '#e4d8c2', '#cfc6b8', '#9ab2c8', '#5f7f9e', '#34506e', '#2f3a48', '#6f8a5c',
  '#4e6b55', '#a3483c', '#c26a45', '#d9a441', '#8a6aa8', '#c98a9a', '#5b5f66', '#2a2c30',
  '#b5c7a3', '#e8b4a0',
]);
const CASUAL_BOTTOMS = hx(['#2f3e5c', '#3b4f73', '#4a5f82', '#2a2c30', '#4a4038', '#7a6a52', '#5a5f66', '#c9b99a', '#26334a']);
const SKIRTS = hx(['#2f3e5c', '#7a3b52', '#3f6e5a', '#4b3f6b', '#2a2c30', '#8a6a4a']);
const SHOES_ADULT = hx(['#2a2a2a', '#3a2c22', '#5a4636', '#f0efea', '#2f3a48', '#8a7c6c']);
const SHOES_STUDENT = hx(['#1e2128', '#20242b', '#263650', '#f0efea', '#2a2a2a']);
const BAGS = hx(['#2f5d8a', '#c8643b', '#3f6e4a', '#d9a441', '#6b3b6b', '#2d2f33', '#b8433a', '#3b8ea5', '#e07a9a', '#7a8a3a']);
/** Guardapolvos de jardín: colores claros, el cuadrillé lo pone la geometría. */
const SMOCKS = hx(['#a8cdea', '#f2b8c6', '#b8e0b0', '#f3e3a0', '#cdbfe6', '#9fd6d2']);
const GLASSES = hx(['#1e1e22', '#3a2a22', '#5a4a3a', '#2a3550']);
const WORK = hexRgb('#55687c');
const WORK_DARK = hexRgb('#3b4756');
const WHITE = hexRgb('#f4f4f1');
const COAT_WHITE = hexRgb('#f1f2f0');

/**
 * Mezcla una semilla chica (1, 2, 3…) antes de usarla: el director del juego
 * numera a sus personajes en orden y, sin mezclar, semillas vecinas daban
 * personas parecidas.
 */
function mixSeed(n: number): number {
  let h = (n ^ 0x51a7e) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function pickWeighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---------------------------------------------------------------- generación

/** Rango de alturas por rol (m). */
function heightFor(rng: Rng, role: NpcRole, feminine: boolean): { h: number; age: AgeGroup } {
  switch (role) {
    case 'kid':
      return { h: rng.range(1.0, 1.15), age: 'kid' };
    case 'student':
      return { h: rng.range(1.25, 1.5), age: 'child' };
    case 'studentSecondary':
      return { h: feminine ? rng.range(1.55, 1.7) : rng.range(1.6, 1.8), age: 'teen' };
    default: {
      const senior = role === 'visitor' && rng.chance(0.18);
      const h = feminine ? rng.range(1.55, 1.75) : rng.range(1.65, 1.9);
      return { h: senior ? h - 0.03 : h, age: senior ? 'senior' : 'adult' };
    }
  }
}

/** Proporciones por edad: piernas, cabeza y brazos relativos a un adulto. */
function proportions(age: AgeGroup, h: number): { legK: number; headK: number; armK: number } {
  switch (age) {
    // Cabezas un 7 % más grandes que las reales: estilizado, se leen mejor de
    // lejos y en el visor (con la proporción exacta parecían alfileres).
    case 'kid':
      return { legK: 0.86, headK: 1.5, armK: 0.92 };
    case 'child': {
      // Entre 1,25 y 1,5 m las proporciones se acercan a las de un adulto.
      const t = Math.max(0, Math.min(1, (h - 1.25) / 0.25));
      return { legK: 0.92 + 0.04 * t, headK: 1.32 - 0.1 * t, armK: 0.95 + 0.02 * t };
    }
    case 'teen':
      return { legK: 0.99, headK: 1.11, armK: 0.99 };
    default:
      return { legK: 1, headK: 1.07, armK: 1 };
  }
}

function hairStyleFor(rng: Rng, age: AgeGroup, feminine: boolean): HairStyle {
  if (feminine) {
    return pickWeighted(rng, ['long', 'ponytail', 'bun', 'curly', 'short'] as const, [3.2, age === 'kid' || age === 'child' ? 4 : 2.6, 1.5, 1.4, 0.6]);
  }
  const adult = age === 'adult' || age === 'senior';
  return pickWeighted(rng, ['short', 'curly', 'bald', 'long'] as const, [7, 1.6, adult ? (age === 'senior' ? 2.5 : 0.8) : 0, 0.5]);
}

function hairColorFor(rng: Rng, age: AgeGroup): RGB {
  if (age === 'senior') return rng.pick(HAIR_GREY);
  if (age === 'adult' && rng.chance(0.08)) return rng.pick(HAIR_GREY.slice(0, 2));
  const r = rng.next();
  if (r < 0.72) return rng.pick(HAIR_DARK);
  if (r < 0.97) return rng.pick(HAIR_LIGHT);
  return HAIR_RED;
}

/**
 * Aspecto completo. Lo que trae `look` manda; lo que falta lo decide `rng`.
 * Si `look.seed` viene, el aspecto sale de esa semilla y no consume `rng`:
 * así el director del juego puede fijar un personaje sin depender del orden
 * en que se crea la multitud.
 */
export function makeAppearance(rngIn: Rng, look: CharacterLook): Appearance {
  const rng = look.seed !== undefined ? new Rng(mixSeed(look.seed)) : rngIn;
  const role = look.role;
  // Los personajes con nombre no dicen si son varones o mujeres, pero sí el
  // peinado: sin esto Martín y Tomás salían con pollera y caderas anchas, e
  // Inés o Ana con hombros de varón. Se consume el azar igual, para que el
  // resto del aspecto (piel, ropa) no cambie.
  const coin = rng.chance(0.5);
  const hs = look.hairStyle;
  const feminine =
    look.skirt === true
      ? true
      : hs === 'short' || hs === 'bald'
        ? false
        : hs === 'bun' || hs === 'long' || hs === 'ponytail'
          ? true
          : hs === 'curly' && look.height !== undefined
            ? look.height < 1.7
            : coin;
  const hh = heightFor(rng, role, feminine);
  const height = look.height ?? hh.h;
  const age = hh.age;
  const prop = proportions(age, height);
  const kidish = age === 'kid' || age === 'child';
  const skin = look.skin ? hexRgb(look.skin) : pickWeighted(rng, SKINS, SKIN_W);
  let hairStyle: HairStyle = look.hairStyle ?? hairStyleFor(rng, age, feminine);
  const hair = look.hair ? hexRgb(look.hair) : hairColorFor(rng, age);
  // Variación de contextura: chicos algo más redondos, adultos de todo tipo.
  const build = age === 'kid' ? rng.range(1.04, 1.14) : age === 'child' ? rng.range(0.95, 1.08) : age === 'teen' ? rng.range(0.9, 1.06) : rng.range(0.88, 1.2);
  const shoulderK = feminine ? rng.range(0.88, 0.95) : rng.range(1.0, 1.08);
  const hipK = feminine ? rng.range(1.04, 1.12) : rng.range(0.94, 1.0);

  let top: RGB;
  let bottom: RGB;
  let torsoPart: TorsoPart = 'torso';
  let shortSleeves = false;
  let skirt = look.skirt ?? false;
  let bareLegs = false;
  let trim: RGB | null = null;
  const apron: RGB | null = null;
  let backpack: RGB | null = null;
  const propItem: Appearance['prop'] = null;
  let shoe: RGB;
  let idleStyle: IdleStyle = 0;

  switch (role) {
    case 'kid': {
      // Guardapolvo a cuadritos de color claro, manga larga; abajo, joggings
      // o calzas oscuras. Mochilitas en algunos.
      torsoPart = 'smock';
      top = rng.pick(SMOCKS);
      bottom = rng.pick(hx(['#26334a', '#3a3f4a', '#4a3b52', '#2e4a5a']));
      skirt = false;
      shoe = rng.pick(SHOES_STUDENT.concat(hx(['#d94b5a', '#3b7bd9'])));
      backpack = look.backpack === false ? null : rng.chance(0.55) || look.backpack ? rng.pick(BAGS) : null;
      break;
    }
    case 'student': {
      // Primaria: chomba roja de manga corta y azul marino abajo.
      top = UNIFORM_RED;
      bottom = UNIFORM_NAVY;
      shortSleeves = true;
      if (look.skirt === undefined) skirt = feminine && rng.chance(0.5);
      bareLegs = skirt;
      shoe = rng.pick(SHOES_STUDENT);
      backpack = look.backpack === false ? null : rng.chance(0.85) || look.backpack ? rng.pick(BAGS) : null;
      idleStyle = rng.chance(0.15) ? 2 : 0;
      break;
    }
    case 'studentSecondary': {
      // Secundaria: buzo azul marino con ribete rojo (o la chomba sola).
      const polo = rng.chance(0.25);
      top = polo ? UNIFORM_RED : UNIFORM_NAVY;
      trim = polo ? null : UNIFORM_RED;
      shortSleeves = polo;
      bottom = UNIFORM_NAVY;
      if (look.skirt === undefined) skirt = feminine && rng.chance(0.45);
      bareLegs = skirt;
      shoe = rng.pick(SHOES_STUDENT);
      backpack = look.backpack === false ? null : rng.chance(0.8) || look.backpack ? rng.pick(BAGS) : null;
      idleStyle = rng.chance(0.3) ? 2 : 0;
      break;
    }
    case 'teacher': {
      const coat = look.labCoat ?? rng.chance(0.4);
      top = coat ? COAT_WHITE : rng.pick(CASUAL_TOPS);
      torsoPart = coat ? 'coat' : 'torso';
      shortSleeves = !coat && rng.chance(0.3);
      if (look.skirt === undefined) skirt = feminine && rng.chance(0.3);
      bottom = skirt ? rng.pick(SKIRTS) : rng.pick(CASUAL_BOTTOMS);
      bareLegs = skirt && rng.chance(0.5);
      shoe = rng.pick(SHOES_ADULT);
      idleStyle = rng.chance(0.45) ? 1 : rng.chance(0.3) ? 2 : 0;
      break;
    }
    case 'staff': {
      // Portería y maestranza: ambo de trabajo gris azulado; cantina: blanco
      // con delantal y gorro. El rol se refina con `staffKind`.
      top = WORK;
      bottom = WORK_DARK;
      shoe = hexRgb('#2a2a2a');
      idleStyle = 1;
      break;
    }
    default: {
      top = rng.pick(CASUAL_TOPS);
      shortSleeves = rng.chance(0.35);
      if (look.skirt === undefined) skirt = feminine && rng.chance(0.28);
      bottom = skirt ? rng.pick(SKIRTS) : rng.pick(CASUAL_BOTTOMS);
      bareLegs = skirt && rng.chance(0.6);
      shoe = rng.pick(SHOES_ADULT);
      idleStyle = rng.chance(0.25) ? 2 : rng.chance(0.2) ? 1 : 0;
      backpack = look.backpack ? rng.pick(BAGS) : null;
      break;
    }
  }

  if (look.top) top = hexRgb(look.top);
  if (look.bottom) bottom = hexRgb(look.bottom);
  if (look.labCoat) {
    torsoPart = 'coat';
    if (!look.top) top = COAT_WHITE;
  }
  if (look.backpack === true && !backpack) backpack = rng.pick(BAGS);
  if (look.backpack === false) backpack = null;
  // Peinados de nene: nada de calvos ni rodetes en la primaria.
  if (kidish && hairStyle === 'bald') hairStyle = 'short';

  const glassesChance = kidish ? 0.08 : age === 'teen' ? 0.15 : age === 'senior' ? 0.7 : 0.35;
  const glasses = look.glasses === true || (look.glasses === undefined && rng.chance(glassesChance)) ? rng.pick(GLASSES) : null;

  const base = age === 'kid' ? 0.95 : age === 'child' ? 1.15 : age === 'teen' ? 1.25 : age === 'senior' ? 1.0 : 1.3;
  const walkSpeed = base * rng.range(0.9, 1.1);
  const runSpeed = (age === 'kid' ? 2.4 : age === 'child' ? 2.9 : age === 'teen' ? 3.3 : 3.0) * rng.range(0.9, 1.08);

  return {
    role,
    age,
    feminine,
    height,
    legK: prop.legK * (kidish ? 1 : rng.range(0.97, 1.03)),
    headK: prop.headK,
    armK: prop.armK,
    build,
    shoulderK,
    hipK,
    skin,
    hair,
    hairStyle,
    top,
    bottom,
    shoe,
    torsoPart,
    shortSleeves,
    skirt,
    bareLegs,
    trim,
    apron,
    backpack,
    glasses,
    prop: propItem,
    idleStyle,
    walkSpeed,
    runSpeed,
  };
}

/** Variantes del personal: portero, cantina (blanco, delantal y gorro) y maestranza (lampazo). */
export type StaffKind = 'porter' | 'cantina' | 'maintenance';

export function dressStaff(a: Appearance, kind: StaffKind, rng: Rng): Appearance {
  if (kind === 'cantina') {
    return {
      ...a,
      top: WHITE,
      shortSleeves: true,
      bottom: hexRgb('#2a2c30'),
      apron: rng.pick(hx(['#2f5d4a', '#7a2f35', '#2f3e5c'])),
      hairStyle: 'cap',
      hair: WHITE,
      skirt: false,
      bareLegs: false,
      torsoPart: 'torso',
    };
  }
  if (kind === 'maintenance') {
    return { ...a, prop: 'mop', skirt: false, bareLegs: false, torsoPart: 'torso', shortSleeves: false };
  }
  return { ...a, skirt: false, bareLegs: false, torsoPart: 'torso', shortSleeves: false };
}

/**
 * Medidas del cuerpo en metros a partir del aspecto. Figura de referencia:
 * adulto de 1,72 m mirando a +Z (ver `HumanGeometry`). Lo que sigue repite
 * esas cotas para que la simulación (pies en el piso, altura de asiento) y el
 * render usen exactamente las mismas.
 */
export const REF = {
  height: 1.72,
  /** Suela → articulación de la cadera, de pie y derecho. */
  leg: 0.92,
  thigh: 0.44,
  shin: 0.48,
  hipX: 0.088,
  /** Cadera → cintura (pivote del tronco). */
  waist: 0.1,
  /** Cintura → base del cuello (pivote de la cabeza). */
  torso: 0.43,
  shoulderX: 0.178,
  shoulderY: 0.358,
  upperArm: 0.29,
  forearm: 0.25,
  /** Base del cuello → coronilla. */
  head: 0.27,
} as const;

export interface BodyDims {
  /** Escala general (altura / 1,72). */
  s: number;
  /** Escala de largo de piernas, del tronco (cintura+torso) y de la cabeza. */
  legS: number;
  torsoS: number;
  headS: number;
  armS: number;
  /** Escalas de ancho: hombros, caderas y grosor de brazos y piernas. */
  shoulderW: number;
  hipW: number;
  limbW: number;
  thigh: number;
  shin: number;
  hipX: number;
  waist: number;
  torso: number;
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  forearm: number;
  /** Radio del muslo: la cadera de alguien sentado queda esto por encima del asiento. */
  seatOffset: number;
}

export function bodyDims(a: Appearance): BodyDims {
  const s = a.height / REF.height;
  const legS = s * a.legK;
  const headS = s * a.headK;
  // El tronco ocupa lo que dejan piernas y cabeza: así la altura total es exacta.
  const torsoS = (a.height - REF.leg * legS - REF.head * headS) / (REF.waist + REF.torso);
  const armS = s * a.armK;
  const w = s * a.build;
  const limbW = w * (a.age === 'kid' ? 1.08 : 1);
  return {
    s,
    legS,
    torsoS,
    headS,
    armS,
    shoulderW: w * a.shoulderK,
    hipW: w * a.hipK,
    limbW,
    thigh: REF.thigh * legS,
    shin: REF.shin * legS,
    hipX: REF.hipX * w * a.hipK,
    waist: REF.waist * torsoS,
    torso: REF.torso * torsoS,
    shoulderX: REF.shoulderX * w * a.shoulderK,
    shoulderY: REF.shoulderY * torsoS,
    upperArm: REF.upperArm * armS,
    forearm: REF.forearm * armS,
    // Cadera sobre la tapa del asiento: el muslo (≈0,086 de radio bajo el eje)
    // apenas se aplasta contra el asiento, sin hundirse en él.
    seatOffset: 0.08 * limbW,
  };
}
