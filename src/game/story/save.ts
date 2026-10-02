import type { StampId, ZoneId } from './types';

/**
 * Partida guardada del Recorrido 40, en el `localStorage` del dispositivo.
 *
 * Se guarda en cada cambio (es chica) y se valida al leer: un dato corrupto
 * o de otra versión no puede dejar el juego trabado; en el peor caso se
 * empieza de cero.
 */

export const SAVE_KEY = 'cimdip-recorrido40-v1';

export interface SaveData {
  v: 1;
  done: string[];
  flags: string[];
  stamps: StampId[];
  zones: ZoneId[];
  places: string[];
  items: string[];
  /** Entrevistas: personaje → cita elegida. */
  interviews: Record<string, string>;
  rules: string[];
  choices: Record<string, string>;
  /** Lugares que Lola ya comentó. */
  barks: string[];
  started: number;
  seconds: number;
  finished?: number;
}

export function emptySave(now = Date.now()): SaveData {
  return {
    v: 1,
    done: [],
    flags: [],
    stamps: [],
    zones: [],
    places: [],
    items: [],
    interviews: {},
    rules: [],
    choices: {},
    barks: [],
    started: now,
    seconds: 0,
  };
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
const record = (x: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    for (const [k, v] of Object.entries(x)) if (typeof v === 'string') out[k] = v;
  }
  return out;
};
const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** Interpreta un texto guardado; null si no es una partida válida de esta versión. */
export function parseSave(text: string | null | undefined): SaveData | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const save: SaveData = {
    v: 1,
    done: strings(o.done),
    flags: strings(o.flags),
    stamps: strings(o.stamps) as StampId[],
    zones: strings(o.zones) as ZoneId[],
    places: strings(o.places),
    items: strings(o.items),
    interviews: record(o.interviews),
    rules: strings(o.rules),
    choices: record(o.choices),
    barks: strings(o.barks),
    started: num(o.started, Date.now()),
    seconds: Math.max(0, num(o.seconds, 0)),
  };
  if (typeof o.finished === 'number') save.finished = o.finished;
  return save;
}

/** Acceso al almacenamiento tolerante a navegadores que lo bloquean. */
export interface SaveStore {
  load(): SaveData | null;
  write(data: SaveData): void;
  clear(): void;
}

export function localSaveStore(key = SAVE_KEY): SaveStore {
  return {
    load() {
      try {
        return parseSave(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    write(data) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // Guardar es una mejora: sin almacenamiento el juego sigue igual.
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ídem.
      }
    },
  };
}

/** Almacenamiento en memoria (tests, o navegadores sin `localStorage`). */
export function memorySaveStore(): SaveStore & { text: string | null } {
  const s = {
    text: null as string | null,
    load: () => parseSave(s.text),
    write: (d: SaveData) => {
      s.text = JSON.stringify(d);
    },
    clear: () => {
      s.text = null;
    },
  };
  return s;
}
