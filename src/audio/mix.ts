/**
 * Mezcla del paisaje sonoro: qué suena en cada zona y en cada momento del día.
 *
 * Todo lo que decide el "qué" vive acá como tablas y funciones puras; el
 * `Soundscape` sólo las aplica a nodos de Web Audio. Así el balance se ajusta
 * leyendo una tabla y se prueba sin navegador.
 *
 * Idea central: el ambiente no se cambia de golpe al cruzar una puerta. Cada
 * zona tiene un peso que se acerca de a poco a 1 (la zona donde está el
 * jugador) o a 0 (las demás), y cada capa suena con la mezcla ponderada de
 * todas. Las capas son ruido no correlacionado, así que se mezclan por
 * POTENCIA (raíz de la suma de cuadrados): a mitad de un cruce el volumen
 * percibido no se hunde, que es lo que delata un fundido mal hecho.
 */

import type { AmbienceZone, SchoolPhase, Surface, WorldPoint } from '../game/contracts';

export const ZONES = [
  'street',
  'patio',
  'corridor',
  'classroom',
  'gym',
  'cantina',
  'stair',
  'kindergarten',
  'quiet',
] as const satisfies readonly AmbienceZone[];

/** Capas continuas del ambiente. */
export const BED_LAYERS = [
  'traffic',
  'wind',
  'room',
  'lights',
  'fridge',
  'kids',
  'class',
  'crowd',
  'little',
] as const;
export type BedLayer = (typeof BED_LAYERS)[number];

/** Capas de voces (bla-bla pregrabado en memoria), que se apagan detrás de paredes. */
export const VOICE_LAYERS = ['kids', 'class', 'crowd', 'little'] as const;
export type VoiceLayer = (typeof VOICE_LAYERS)[number];

/** Sonidos sueltos del ambiente (y los que el juego puede disparar a mano). */
export const AMBIENT_EVENTS = [
  'bird',
  'car',
  'bike',
  'dog',
  'laugh',
  'ball',
  'whistle',
  'shout',
  'steps',
  'voices',
  'chair',
  'teacher',
  'cough',
  'knock',
  'squeak',
  'clatter',
  'toy',
  'door',
  'applause',
] as const;
export type AmbientEvent = (typeof AMBIENT_EVENTS)[number];

/**
 * Qué mueve cada sonido a lo largo del día: el bullicio de los chicos, la
 * clase, la gente adulta, el jardín, la calle, el gimnasio, el ir y venir, los
 * aplausos del acto o nada (siempre igual).
 */
export type Driver =
  'kids' | 'class' | 'crowd' | 'little' | 'traffic' | 'gym' | 'busy' | 'applause' | 'always';

export const PHASE_FACTORS: Record<SchoolPhase, Record<Driver, number>> = {
  // Llegan chicos y familias: vereda cargada, saludos, el patio llenándose.
  entrada: {
    kids: 0.55,
    class: 0.05,
    crowd: 0.8,
    little: 0.6,
    traffic: 1.25,
    gym: 0.25,
    busy: 1,
    applause: 0,
    always: 1,
  },
  // Clase: murmullo dentro de las aulas, patio casi vacío, alguna clase de educación física.
  clase: {
    kids: 0.08,
    class: 1,
    crowd: 0.1,
    little: 0.55,
    traffic: 1,
    gym: 0.85,
    busy: 0.35,
    applause: 0,
    always: 1,
  },
  // Recreo: el patio explota.
  recreo: {
    kids: 1,
    class: 0.12,
    crowd: 0.25,
    little: 1,
    traffic: 1,
    gym: 1,
    busy: 0.9,
    applause: 0,
    always: 1,
  },
  // Acto: multitud sentada que murmura y aplaude.
  acto: {
    kids: 0.25,
    class: 0,
    crowd: 1,
    little: 0.35,
    traffic: 0.9,
    gym: 0.15,
    busy: 0.5,
    applause: 1,
    always: 1,
  },
  // Salida: como la entrada, con más calle.
  salida: {
    kids: 0.7,
    class: 0.05,
    crowd: 0.7,
    little: 0.55,
    traffic: 1.35,
    gym: 0.2,
    busy: 1,
    applause: 0,
    always: 1,
  },
};

const LAYER_DRIVER: Record<BedLayer, Driver> = {
  traffic: 'traffic',
  wind: 'always',
  room: 'always',
  lights: 'always',
  fridge: 'always',
  kids: 'kids',
  class: 'class',
  crowd: 'crowd',
  little: 'little',
};

/** Nivel (ganancia lineal) y, opcionalmente, qué lo mueve si no es lo de siempre. */
type Entry = number | readonly [number, Driver];

export interface ZoneRecipe {
  beds: Partial<Record<BedLayer, Entry>>;
  /** Eventos por minuto (en el momento del día de mayor actividad). */
  events: Partial<Record<AmbientEvent, readonly [number, Driver]>>;
  /** Envío a la reverberación (tamaño aparente del lugar). */
  reverb: number;
  /** Envío al eco corto (escaleras, gimnasio). */
  echo: number;
  /** Corte de agudos de cada capa de voces: las de otro ambiente llegan apagadas por las paredes. */
  cut: Record<VoiceLayer, number>;
  /** Superficie de los pasos si nadie la indica. */
  surface: Surface;
  /** Reloj de pared (oficinas, biblioteca). */
  clock?: number;
}

export const ZONE_RECIPES: Record<AmbienceZone, ZoneRecipe> = {
  street: {
    beds: { traffic: 0.3, wind: 0.13, kids: 0.05, crowd: 0.07 },
    events: {
      bird: [7, 'always'],
      car: [4, 'traffic'],
      bike: [1.2, 'traffic'],
      dog: [0.8, 'always'],
      shout: [0.6, 'kids'],
      door: [0.3, 'always'],
    },
    reverb: 0.05,
    echo: 0,
    cut: { kids: 1800, class: 900, crowd: 2600, little: 1200 },
    surface: 'concrete',
  },
  patio: {
    beds: { traffic: 0.12, wind: 0.08, kids: 0.32, crowd: 0.14, little: 0.03, class: 0.02 },
    events: {
      bird: [4, 'always'],
      laugh: [6, 'kids'],
      ball: [5, 'kids'],
      whistle: [0.5, 'kids'],
      shout: [4, 'kids'],
      steps: [2, 'busy'],
      dog: [0.25, 'always'],
      car: [0.8, 'traffic'],
      applause: [1.5, 'applause'],
    },
    reverb: 0.12,
    echo: 0.04,
    cut: { kids: 9000, class: 1200, crowd: 8000, little: 1500 },
    surface: 'concrete',
  },
  corridor: {
    beds: {
      traffic: 0.035,
      room: 0.05,
      lights: 0.022,
      kids: 0.1,
      class: 0.05,
      crowd: 0.05,
      little: 0.02,
    },
    events: {
      steps: [5, 'busy'],
      voices: [3, 'kids'],
      laugh: [1.2, 'kids'],
      shout: [0.8, 'kids'],
      door: [1, 'always'],
      cough: [0.3, 'always'],
    },
    reverb: 0.32,
    echo: 0.07,
    cut: { kids: 2200, class: 1600, crowd: 2400, little: 1400 },
    surface: 'tile',
  },
  classroom: {
    beds: {
      traffic: 0.025,
      room: 0.05,
      lights: 0.03,
      kids: 0.05,
      class: 0.16,
      crowd: 0.03,
      little: 0.02,
    },
    events: {
      chair: [3, 'class'],
      teacher: [4, 'class'],
      cough: [0.8, 'class'],
      knock: [1.5, 'class'],
      laugh: [0.6, 'class'],
      door: [0.2, 'always'],
    },
    reverb: 0.1,
    echo: 0,
    cut: { kids: 1300, class: 7000, crowd: 1500, little: 1200 },
    surface: 'tile',
  },
  gym: {
    beds: { traffic: 0.02, room: 0.06, kids: [0.16, 'gym'], class: 0.03, crowd: 0.18 },
    events: {
      ball: [6, 'gym'],
      squeak: [9, 'gym'],
      whistle: [1.2, 'gym'],
      shout: [2.5, 'gym'],
      laugh: [1.5, 'gym'],
      steps: [2, 'gym'],
      applause: [1.8, 'applause'],
    },
    reverb: 0.55,
    echo: 0.1,
    cut: { kids: 6500, class: 2000, crowd: 6000, little: 1200 },
    surface: 'concrete',
  },
  cantina: {
    beds: {
      traffic: 0.02,
      room: 0.05,
      fridge: 0.07,
      lights: 0.02,
      kids: 0.12,
      class: 0.04,
      crowd: 0.07,
    },
    events: {
      clatter: [10, 'busy'],
      chair: [3, 'busy'],
      laugh: [2, 'kids'],
      voices: [2, 'busy'],
      steps: [2, 'busy'],
    },
    reverb: 0.2,
    echo: 0.03,
    cut: { kids: 4000, class: 2500, crowd: 5000, little: 1200 },
    surface: 'tile',
  },
  stair: {
    beds: { traffic: 0.03, room: 0.05, lights: 0.015, kids: 0.08, class: 0.03, crowd: 0.04 },
    events: {
      steps: [6, 'busy'],
      voices: [1.5, 'kids'],
      laugh: [0.8, 'kids'],
      door: [0.6, 'always'],
    },
    reverb: 0.48,
    echo: 0.22,
    cut: { kids: 2000, class: 1400, crowd: 2200, little: 1300 },
    surface: 'tile',
  },
  kindergarten: {
    beds: { traffic: 0.02, room: 0.04, lights: 0.02, little: 0.24, kids: 0.04 },
    events: {
      toy: [4, 'little'],
      laugh: [3, 'little'],
      teacher: [1.5, 'little'],
      chair: [1, 'little'],
      steps: [1.5, 'little'],
      door: [0.3, 'always'],
    },
    reverb: 0.14,
    echo: 0,
    cut: { kids: 1600, class: 1200, crowd: 1500, little: 8000 },
    surface: 'tile',
  },
  quiet: {
    beds: { traffic: 0.02, room: 0.065, lights: 0.025, kids: 0.025, class: 0.02, crowd: 0.015 },
    events: {
      cough: [0.3, 'always'],
      steps: [0.6, 'busy'],
      door: [0.3, 'always'],
      knock: [0.4, 'always'],
    },
    reverb: 0.06,
    echo: 0,
    cut: { kids: 1100, class: 1000, crowd: 1200, little: 1000 },
    surface: 'tile',
    clock: 1,
  },
};

// ====================================================================== pesos

export type ZoneWeights = Record<AmbienceZone, number>;

export function initialWeights(zone: AmbienceZone): ZoneWeights {
  const w = {} as ZoneWeights;
  for (const z of ZONES) w[z] = z === zone ? 1 : 0;
  return w;
}

/**
 * Acerca los pesos a la zona `target` con una constante de tiempo `tau` (s).
 * Es lineal en los pesos, así que si sumaban 1 siguen sumando 1.
 */
export function approachWeights(
  w: ZoneWeights,
  target: AmbienceZone,
  dt: number,
  tau = 1,
): ZoneWeights {
  const k = tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau);
  for (const z of ZONES) w[z] += ((z === target ? 1 : 0) - w[z]) * k;
  return w;
}

export function dominantZone(w: ZoneWeights): AmbienceZone {
  let best: AmbienceZone = 'street';
  for (const z of ZONES) if (w[z] > w[best]) best = z;
  return best;
}

const level = (e: Entry | undefined): number =>
  e === undefined ? 0 : typeof e === 'number' ? e : e[0];
const driverOf = (e: Entry | undefined, layer: BedLayer): Driver =>
  e !== undefined && typeof e !== 'number' ? e[1] : LAYER_DRIVER[layer];

/** Ganancia de cada capa continua: mezcla por potencia de todas las zonas. */
export function mixBeds(w: ZoneWeights, phase: SchoolPhase): Record<BedLayer, number> {
  const out = {} as Record<BedLayer, number>;
  const f = PHASE_FACTORS[phase];
  for (const layer of BED_LAYERS) {
    let p = 0;
    for (const z of ZONES) {
      if (w[z] <= 0) continue;
      const e = ZONE_RECIPES[z].beds[layer];
      const g = level(e) * f[driverOf(e, layer)];
      p += w[z] * g * g;
    }
    out[layer] = Math.sqrt(p);
  }
  return out;
}

/** Corte de agudos de cada capa de voces: interpolado en escala logarítmica (como oye el oído). */
export function mixCutoffs(w: ZoneWeights): Record<VoiceLayer, number> {
  const out = {} as Record<VoiceLayer, number>;
  for (const layer of VOICE_LAYERS) {
    let acc = 0;
    let sum = 0;
    for (const z of ZONES) {
      acc += w[z] * Math.log(ZONE_RECIPES[z].cut[layer]);
      sum += w[z];
    }
    out[layer] = Math.exp(sum > 0 ? acc / sum : Math.log(2000));
  }
  return out;
}

/** Valor escalar ponderado de la receta (reverberación, eco, reloj). */
export function mixScalar(w: ZoneWeights, key: 'reverb' | 'echo' | 'clock'): number {
  let v = 0;
  for (const z of ZONES) v += w[z] * (ZONE_RECIPES[z][key] ?? 0);
  return v;
}

/** Eventos por minuto de cada tipo, para estos pesos y este momento del día. */
export function eventRates(
  w: ZoneWeights,
  phase: SchoolPhase,
  density = 1,
): Record<AmbientEvent, number> {
  const out = {} as Record<AmbientEvent, number>;
  const f = PHASE_FACTORS[phase];
  for (const k of AMBIENT_EVENTS) out[k] = 0;
  for (const z of ZONES) {
    if (w[z] <= 0) continue;
    const ev = ZONE_RECIPES[z].events;
    for (const k of AMBIENT_EVENTS) {
      const e = ev[k];
      if (e) out[k] += w[z] * e[0] * f[e[1]] * density;
    }
  }
  return out;
}

/** Probabilidad de que un proceso de Poisson de `ratePerMin` dispare en `dt` segundos. */
export function fireProbability(ratePerMin: number, dt: number): number {
  if (ratePerMin <= 0 || dt <= 0) return 0;
  return 1 - Math.exp((-ratePerMin * dt) / 60);
}

export function defaultSurface(zone: AmbienceZone): Surface {
  return ZONE_RECIPES[zone].surface;
}

/**
 * Superficie de los pasos según el piso del plano de la escuela (`Room.floor`):
 * granito, cerámico, damero y terracota suenan a baldosa; parquet y la pista
 * de danza, a madera; la goma de la galería y el vinílico del Aula Maker, a
 * goma; el gimnasio y el patio, a cemento.
 */
export function surfaceForFloor(floor: string | null | undefined): Surface {
  switch (floor) {
    case 'wood':
    case 'dance':
      return 'wood';
    case 'rubber':
    case 'green':
      return 'rubber';
    case 'gym':
    case 'patio':
      return 'concrete';
    case 'grass':
      return 'grass';
    case 'carpet':
      return 'carpet';
    case 'metal':
      return 'metal';
    case 'tile':
    case 'ceramic':
    case 'checker':
    case 'terracotta':
    case 'hallStone':
    case 'dark':
      return 'tile';
    default:
      return 'concrete';
  }
}

// ============================================================ audio posicional

export interface Spatial {
  /** Ganancia por distancia (y pisos de por medio). */
  gain: number;
  /** −1 izquierda … +1 derecha. */
  pan: number;
  /** Corte de agudos: el aire y las losas se comen los agudos. */
  cutoff: number;
}

export interface SpatialOptions {
  /** Distancia hasta la que suena a volumen pleno (m). */
  ref?: number;
  /** Más allá no suena (m). */
  max?: number;
  /** Altura entre pisos: cada losa de por medio atenúa y apaga. */
  storey?: number;
}

/**
 * Audio posicional simple: atenuación por distancia inversa, paneo estéreo
 * según hacia dónde mira el oyente y un filtro que apaga lo lejano, lo que
 * queda detrás y lo que está en otro piso. Un `PannerNode` con HRTF por
 * sonido costaría mucho más en un visor y, para una campana o una puerta,
 * no se distingue.
 *
 * `forward` es la dirección de la mirada en el plano XZ (Babylon es zurdo:
 * con la vista hacia +z, la derecha es +x). Sin dirección, no hay paneo.
 */
export function spatialize(
  listener: WorldPoint,
  forward: { x: number; z: number } | null,
  src: WorldPoint,
  opts: SpatialOptions = {},
): Spatial {
  const ref = opts.ref ?? 3;
  const max = opts.max ?? 90;
  const storey = opts.storey ?? 3.3;
  const dx = src.x - listener.x;
  const dz = src.z - listener.z;
  const dy = src.y - listener.y;
  const flat = Math.hypot(dx, dz);
  const d = Math.hypot(flat, dy);
  let gain = d <= ref ? 1 : ref / d;
  // Desvanecido suave hasta el máximo, sin escalón.
  if (d > max * 0.7) gain *= Math.max(0, 1 - (d - max * 0.7) / (max * 0.3));
  const floors = Math.round(Math.abs(dy) / storey);
  gain *= Math.pow(0.4, floors);
  let cutoff = Math.max(900, 18000 * Math.exp(-d / 70));
  if (floors > 0) cutoff = Math.min(cutoff, 900 / floors + 300);
  let pan = 0;
  if (forward && flat > 0.01) {
    const fl = Math.hypot(forward.x, forward.z) || 1;
    const fx = forward.x / fl;
    const fz = forward.z / fl;
    const ux = dx / flat;
    const uz = dz / flat;
    // Derecha = (fz, −fx) en un sistema zurdo con y hacia arriba.
    pan = (ux * fz - uz * fx) * 0.85;
    // Cerca, el sonido "envuelve": el paneo se abre a medida que se aleja.
    pan *= Math.min(1, flat / 2);
    if (ux * fx + uz * fz < 0) cutoff *= 0.7; // la cabeza tapa un poco lo de atrás
  }
  return { gain: Math.max(0, Math.min(1, gain)), pan: Math.max(-1, Math.min(1, pan)), cutoff };
}

// ======================================================================= pasos

export interface Burst {
  type: BiquadFilterType;
  freq: number;
  q: number;
  /** Caída (s). */
  decay: number;
  gain: number;
  /** Retraso desde el talón (s). */
  delay: number;
}

export interface StepParams {
  /** Golpe del talón: ruido filtrado. */
  hit: Burst;
  /** Apoyo de la punta, un instante después (sólo caminando). */
  toe: Burst | null;
  /** Cuerpo grave: la madera hueca, la goma, la chapa. */
  thump: { freq: number; decay: number; gain: number } | null;
  /** Chapa que vibra: parciales inarmónicos. */
  ring: { freqs: number[]; decay: number; gain: number } | null;
  /** Crujido granular (pasto, hojas). */
  grit: { grains: number; spread: number; freq: number; gain: number } | null;
  /** Chirrido de zapatilla (goma, corriendo). */
  squeak: boolean;
}

interface StepRecipe {
  hit: Omit<Burst, 'delay'>;
  toe?: Omit<Burst, 'type'> & { type?: BiquadFilterType };
  thump?: { freq: number; decay: number; gain: number };
  ring?: { freqs: number[]; decay: number; gain: number };
  grit?: { grains: number; spread: number; freq: number; gain: number };
  squeak?: number;
}

/**
 * Recetas de pasos. Lo que distingue una superficie de otra no es tanto el
 * timbre como la envolvente: la baldosa es un clic seco y corto, la madera
 * tiene cuerpo grave (el piso hueco), la chapa sigue sonando, el pasto cruje
 * en granitos y la alfombra casi no tiene agudos.
 */
export const STEP_RECIPES: Record<Surface, StepRecipe> = {
  tile: {
    hit: { type: 'bandpass', freq: 2600, q: 1.2, decay: 0.035, gain: 0.55 },
    toe: { type: 'bandpass', freq: 3400, q: 1.5, decay: 0.02, gain: 0.25, delay: 0.075 },
    thump: { freq: 140, decay: 0.03, gain: 0.12 },
  },
  wood: {
    hit: { type: 'bandpass', freq: 1000, q: 0.9, decay: 0.06, gain: 0.5 },
    toe: { type: 'bandpass', freq: 1400, q: 1, decay: 0.03, gain: 0.2, delay: 0.08 },
    thump: { freq: 105, decay: 0.09, gain: 0.35 },
  },
  rubber: {
    hit: { type: 'lowpass', freq: 900, q: 0.7, decay: 0.05, gain: 0.45 },
    toe: { type: 'lowpass', freq: 1200, q: 0.7, decay: 0.03, gain: 0.15, delay: 0.085 },
    thump: { freq: 80, decay: 0.06, gain: 0.25 },
    squeak: 0.12,
  },
  metal: {
    hit: { type: 'bandpass', freq: 1800, q: 0.8, decay: 0.04, gain: 0.5 },
    thump: { freq: 90, decay: 0.08, gain: 0.25 },
    ring: { freqs: [420, 1010, 1730, 2650], decay: 0.22, gain: 0.14 },
  },
  concrete: {
    hit: { type: 'bandpass', freq: 1500, q: 0.7, decay: 0.04, gain: 0.5 },
    toe: { type: 'highpass', freq: 3500, q: 0.7, decay: 0.05, gain: 0.18, delay: 0.08 },
    thump: { freq: 90, decay: 0.04, gain: 0.12 },
  },
  grass: {
    hit: { type: 'highpass', freq: 1800, q: 0.6, decay: 0.09, gain: 0.25 },
    thump: { freq: 70, decay: 0.05, gain: 0.08 },
    grit: { grains: 6, spread: 0.09, freq: 3200, gain: 0.14 },
  },
  carpet: {
    hit: { type: 'lowpass', freq: 550, q: 0.6, decay: 0.07, gain: 0.45 },
    toe: { type: 'lowpass', freq: 700, q: 0.6, decay: 0.04, gain: 0.12, delay: 0.08 },
    thump: { freq: 75, decay: 0.05, gain: 0.15 },
  },
};

/**
 * Parámetros concretos de UN paso: la receta de la superficie con variación
 * (ningún paso real es igual al anterior; si lo son, el oído lo nota en tres
 * pasos). Corriendo, el golpe es más fuerte, un poco más grave y el apoyo de
 * la punta se funde con el talón.
 */
export function stepParams(surface: Surface, running: boolean, rnd: () => number): StepParams {
  const r = STEP_RECIPES[surface] ?? STEP_RECIPES.concrete;
  const vary = (x: number, amount: number): number => x * (1 + (rnd() * 2 - 1) * amount);
  const loud = running ? 1.5 : 1;
  const hit: Burst = {
    type: r.hit.type,
    freq: vary(r.hit.freq * (running ? 0.88 : 1), 0.08),
    q: r.hit.q,
    decay: vary(r.hit.decay * (running ? 1.15 : 1), 0.1),
    gain: vary(r.hit.gain * loud, 0.15),
    delay: 0,
  };
  const toe: Burst | null =
    r.toe && !running
      ? {
          type: r.toe.type ?? 'bandpass',
          freq: vary(r.toe.freq, 0.08),
          q: r.toe.q,
          decay: vary(r.toe.decay, 0.1),
          gain: vary(r.toe.gain, 0.2),
          delay: vary(r.toe.delay, 0.12),
        }
      : null;
  return {
    hit,
    toe,
    thump: r.thump
      ? {
          freq: vary(r.thump.freq, 0.06),
          decay: vary(r.thump.decay, 0.1),
          gain: vary(r.thump.gain * loud, 0.15),
        }
      : null,
    ring: r.ring
      ? {
          freqs: r.ring.freqs.map((f) => vary(f, 0.03)),
          decay: vary(r.ring.decay, 0.12),
          gain: vary(r.ring.gain * loud, 0.15),
        }
      : null,
    grit: r.grit
      ? {
          ...r.grit,
          grains: r.grit.grains + Math.floor(rnd() * 3),
          gain: vary(r.grit.gain * loud, 0.2),
        }
      : null,
    squeak: running && (r.squeak ?? 0) > 0 && rnd() < (r.squeak ?? 0),
  };
}
