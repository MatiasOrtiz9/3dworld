import { Rng } from '../../utils/rng';
import type { ActivityId } from '../story/types';

/**
 * Actividades del Recorrido 40: lógica pura (sin motor ni DOM).
 *
 * Cada actividad expone una VISTA abstracta (título, texto, botones, grilla,
 * secuencia) que dibujan por igual el HUD de escritorio y el panel 3D del
 * visor, y recibe la elección del jugador como un índice. Así la misma
 * actividad se juega con teclado (1-9), con el mouse o con el láser, y se
 * puede resolver entera en un test.
 */

export type IconId =
  | 'up'
  | 'left'
  | 'right'
  | 'undo'
  | 'play'
  | 'close'
  | 'next'
  | 'step'
  | 'spin'
  | 'clap'
  | 'arms'
  | 'recycle'
  | 'leaf'
  | 'trash'
  | 'target';

export interface ChoiceView {
  label: string;
  icon?: IconId;
  disabled?: boolean;
  tone?: 'accent' | 'ghost' | 'good' | 'bad';
  /** Elegirla abandona la actividad (se puede retomar después). */
  exit?: boolean;
}

export interface GridView {
  cols: number;
  rows: number;
  blocks: ReadonlyArray<readonly [number, number]>;
  goal: readonly [number, number];
  start: readonly [number, number];
  /** Pose del robot (x, y continuos durante la animación; dir 0 = norte, 1 = este…). */
  robot: { x: number; y: number; dir: number };
  trail: ReadonlyArray<readonly [number, number]>;
  crashed: boolean;
}

export interface SequenceToken {
  label: string;
  icon?: IconId;
  state: 'idle' | 'active' | 'done' | 'wrong' | 'hidden';
}

export interface ActivityView {
  kicker: string;
  title: string;
  text: string;
  choices: ChoiceView[];
  feedback?: { text: string; tone: 'good' | 'bad' | 'info' };
  progress?: string;
  grid?: GridView;
  /** Programa del robot o pasos de baile, como fichas. */
  sequence?: SequenceToken[];
  /** Animando: los botones están deshabilitados. */
  busy?: boolean;
  /** Lo importante pasa en el 3D (la profe que baila, la pelota): el panel va abajo y chico. */
  compact?: boolean;
}

/** Lo que pasó desde la última vez que se miró: sonidos, animaciones 3D. */
export type ActivityEvent =
  | { type: 'good' }
  | { type: 'bad' }
  | { type: 'select' }
  | { type: 'step'; index: number }
  | { type: 'demo'; move: number }
  | { type: 'shot'; zone: number; saved: boolean }
  | { type: 'finish'; success: boolean };

export interface Activity {
  readonly id: ActivityId;
  /** Cambia con cada cambio de la vista: el HUD sólo redibuja cuando cambia. */
  readonly version: number;
  view(): ActivityView;
  input(choice: number): void;
  update(dt: number): void;
  /** Hay resultado (aunque el jugador todavía no tocó "Continuar"). */
  readonly finished: boolean;
  /** El jugador cerró la pantalla final. */
  readonly closed: boolean;
  readonly success: boolean;
  readonly score: number;
  readonly maxScore: number;
  drainEvents(): ActivityEvent[];
  /** Para los tests: entradas que avanzan la actividad hacia el éxito desde el estado actual. */
  solve(): number[];
}

/** Generador pseudoaleatorio inyectable: en el juego `Math.random`, en los tests una semilla. */
export type RandomFn = () => number;

/** Base común: versión, eventos y cierre. */
export abstract class ActivityBase implements Activity {
  abstract readonly id: ActivityId;
  version = 0;
  finished = false;
  closed = false;
  success = false;
  score = 0;
  abstract readonly maxScore: number;
  protected events: ActivityEvent[] = [];

  abstract view(): ActivityView;
  abstract input(choice: number): void;
  abstract solve(): number[];
  update(_dt: number): void {}

  drainEvents(): ActivityEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  protected touch(): void {
    this.version++;
  }

  protected emit(e: ActivityEvent): void {
    this.events.push(e);
  }

  protected finish(success: boolean): void {
    this.finished = true;
    this.success = success;
    this.emit({ type: 'finish', success });
    this.touch();
  }

  /** Vista final común: resultado y un único botón para cerrar. */
  protected finalView(kicker: string, title: string, text: string, tone: 'good' | 'info' = 'good'): ActivityView {
    return {
      kicker,
      title,
      text,
      choices: [{ label: 'Continuar', icon: 'next', tone: 'accent' }],
      feedback: { text: `${this.score} / ${this.maxScore}`, tone },
    };
  }

  /** En la pantalla final, la única opción cierra. */
  protected closeIfFinished(choice: number): boolean {
    if (!this.finished) return false;
    if (choice === 0) {
      this.closed = true;
      this.touch();
    }
    return true;
  }
}

/** El generador de `utils/rng` (mulberry32) como función suelta: misma semilla, misma partida. */
export function seeded(seed: number): RandomFn {
  const rng = new Rng(seed);
  return () => rng.next();
}
