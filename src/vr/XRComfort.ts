/**
 * Ajustes de confort del visor: cómo se gira, a qué velocidad se camina,
 * hacia dónde empuja el stick, cuánto oscurece la viñeta y si se juega
 * sentado. Puro (sin Babylon): lo leen la caminata, la viñeta y el menú
 * del juego en el visor, y lo prueban los tests.
 *
 * Se guarda en `localStorage` aparte de la partida: es de la persona que
 * usa el visor, no del recorrido.
 */

export type TurnMode = 'snap' | 'smooth';
export type MoveSpeed = 'slow' | 'normal' | 'fast';
export type MoveDirection = 'head' | 'hand';
export type VignetteLevel = 'off' | 'soft' | 'strong';

export interface ComfortSettings {
  /** Giro con el stick derecho: por pasos (lo que menos marea) o continuo. */
  turnMode: TurnMode;
  /** Ángulo de cada paso del giro por pasos, en grados. */
  snapAngle: 30 | 45;
  /** Velocidad del giro continuo, en grados por segundo. */
  smoothTurnSpeed: 90 | 135 | 180;
  /** Velocidad de la caminata con el stick izquierdo. */
  moveSpeed: MoveSpeed;
  /** El stick empuja hacia donde mira la cabeza o hacia donde apunta el mando izquierdo. */
  direction: MoveDirection;
  /** Oscurecimiento de la periferia mientras el movimiento es artificial. */
  vignette: VignetteLevel;
  /** Sentado: los ojos se suben a la altura de una persona de pie. */
  seated: boolean;
}

export const DEFAULT_COMFORT: Readonly<ComfortSettings> = {
  turnMode: 'snap',
  snapAngle: 30,
  smoothTurnSpeed: 135,
  moveSpeed: 'normal',
  direction: 'head',
  vignette: 'soft',
  seated: false,
};

/**
 * Velocidades de caminata (m/s). Bastante menos que en escritorio (4,2 m/s):
 * el mareo crece con la velocidad del movimiento artificial. 2,2 m/s es un
 * paso decidido que todavía se tolera bien; correr multiplica por 1,65.
 */
const WALK: Record<MoveSpeed, number> = { slow: 1.5, normal: 2.2, fast: 2.9 };
export const RUN_FACTOR = 1.65;

export function walkSpeed(s: ComfortSettings): number {
  return WALK[s.moveSpeed] ?? WALK.normal;
}

export function runSpeed(s: ComfortSettings): number {
  return walkSpeed(s) * RUN_FACTOR;
}

/** Opacidad máxima de la viñeta (0 = apagada). */
export function vignetteOpacity(s: ComfortSettings): number {
  return s.vignette === 'off' ? 0 : s.vignette === 'strong' ? 0.9 : 0.62;
}

/** Cuánto se suben los ojos sentado (m): de una cabeza sentada (~1,2 m) a una de pie. */
export const SEATED_LIFT = 0.42;

/** Una opción del menú de confort: su rótulo y los valores que recorre al elegirla. */
export interface ComfortOption<K extends keyof ComfortSettings = keyof ComfortSettings> {
  key: K;
  label: string;
  values: ReadonlyArray<{ value: ComfortSettings[K]; label: string }>;
}

/** Lo que muestra el menú de confort del visor, en orden. */
export const COMFORT_OPTIONS: ReadonlyArray<ComfortOption> = [
  { key: 'turnMode', label: 'Giro', values: [{ value: 'snap', label: 'Por pasos' }, { value: 'smooth', label: 'Continuo' }] },
  { key: 'snapAngle', label: 'Ángulo del paso', values: [{ value: 30, label: '30°' }, { value: 45, label: '45°' }] },
  {
    key: 'smoothTurnSpeed',
    label: 'Velocidad del giro continuo',
    values: [{ value: 90, label: 'Lenta' }, { value: 135, label: 'Media' }, { value: 180, label: 'Rápida' }],
  },
  {
    key: 'moveSpeed',
    label: 'Velocidad al caminar',
    values: [{ value: 'slow', label: 'Lenta' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Rápida' }],
  },
  { key: 'direction', label: 'Caminar hacia', values: [{ value: 'head', label: 'Donde miro' }, { value: 'hand', label: 'Donde apunto' }] },
  {
    key: 'vignette',
    label: 'Viñeta al moverse',
    values: [{ value: 'off', label: 'No' }, { value: 'soft', label: 'Suave' }, { value: 'strong', label: 'Fuerte' }],
  },
  { key: 'seated', label: 'Jugar sentado', values: [{ value: false, label: 'No' }, { value: true, label: 'Sí' }] },
];

/** Rótulo del valor vigente de una opción. */
export function comfortValueLabel(s: ComfortSettings, opt: ComfortOption): string {
  const v = s[opt.key];
  return opt.values.find((x) => x.value === v)?.label ?? String(v);
}

/** El ajuste con la opción pasada al valor siguiente (vuelve al primero después del último). */
export function cycleComfort(s: ComfortSettings, key: keyof ComfortSettings): ComfortSettings {
  const opt = COMFORT_OPTIONS.find((o) => o.key === key);
  if (!opt) return { ...s };
  const i = opt.values.findIndex((x) => x.value === s[key]);
  const next = opt.values[(i + 1) % opt.values.length].value;
  return { ...s, [key]: next } as ComfortSettings;
}

/** Completa un ajuste leído (de otra versión o adulterado) con los valores por defecto. */
export function sanitizeComfort(raw: unknown): ComfortSettings {
  const out: ComfortSettings = { ...DEFAULT_COMFORT };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const opt of COMFORT_OPTIONS) {
    const v = r[opt.key];
    if (opt.values.some((x) => x.value === v)) (out as unknown as Record<string, unknown>)[opt.key] = v;
  }
  return out;
}

const STORAGE_KEY = 'cimdip-vr-comfort-v1';

export function loadComfort(): ComfortSettings {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return sanitizeComfort(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_COMFORT };
  }
}

export function saveComfort(s: ComfortSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Preferencia de una sesión, nada más.
  }
}
