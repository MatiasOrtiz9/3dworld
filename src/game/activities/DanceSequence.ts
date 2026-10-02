import { ActivityBase, type ActivityView, type IconId, type RandomFn } from './types';

/**
 * Aula de danzas: la Profe Ana muestra una secuencia de pasos y el jugador
 * la repite en el mismo orden. Tres rondas que crecen de a un paso, con el
 * ritmo marcado por un pulso: es memoria y atención, como un ensayo real.
 * Si se equivoca, la profe la vuelve a mostrar (no se pierde nada).
 */

export const MOVES: ReadonlyArray<{ label: string; icon: IconId }> = [
  { label: 'Paso al frente', icon: 'step' },
  { label: 'Giro', icon: 'spin' },
  { label: 'Palmas', icon: 'clap' },
  { label: 'Brazos arriba', icon: 'arms' },
];

/** Segundos que dura cada paso de la demostración (el pulso). */
export const BEAT = 0.75;
const FIRST_LEN = 3;
const ROUNDS = 3;

type Phase = 'demo' | 'input' | 'pause';

export class DanceSequence extends ActivityBase {
  readonly id = 'danza' as const;
  readonly maxScore = ROUNDS;
  seq: number[] = [];
  round = 0;
  phase: Phase = 'demo';
  /** Paso de la demostración que se está mostrando (−1 antes de empezar). */
  demoIndex = -1;
  entered = 0;
  private t = 0;
  private errors = 0;
  private roundErrors = 0;
  private feedback: ActivityView['feedback'];

  constructor(private readonly random: RandomFn = Math.random) {
    super();
    for (let k = 0; k < FIRST_LEN; k++) this.seq.push(this.pick());
  }

  private pick(): number {
    // Sin repetir el paso anterior: dos iguales seguidos se confunden con uno.
    const prev = this.seq[this.seq.length - 1];
    let m = Math.floor(this.random() * MOVES.length);
    if (m === prev) m = (m + 1 + Math.floor(this.random() * (MOVES.length - 1))) % MOVES.length;
    return m;
  }

  get length(): number {
    return FIRST_LEN + this.round;
  }

  /** Paso que la profe está mostrando ahora (para animarla), o null. */
  demoMove(): number | null {
    return this.phase === 'demo' && this.demoIndex >= 0 && this.demoIndex < this.length ? this.seq[this.demoIndex] : null;
  }

  view(): ActivityView {
    if (this.finished) {
      return this.finalView(
        'Aula de danzas · Segundo piso',
        '¡Coreografía lista!',
        this.errors === 0 ? 'Tres rondas sin un error. La Profe Ana te quiere en la primera fila del acto.' : 'Con práctica salió entera. «Bailar es repetir hasta que el cuerpo se acuerda solo», dice la Profe Ana.',
      );
    }
    const n = this.length;
    const tokens = Array.from({ length: n }, (_, k) => {
      const m = MOVES[this.seq[k]];
      if (this.phase === 'demo') {
        return { label: m.label, icon: m.icon, state: k === this.demoIndex ? ('active' as const) : k < this.demoIndex ? ('done' as const) : ('idle' as const) };
      }
      if (k < this.entered) return { label: m.label, icon: m.icon, state: 'done' as const };
      return { label: '?', state: 'hidden' as const };
    });
    const demo = this.phase !== 'input';
    return {
      kicker: 'Aula de danzas · Segundo piso',
      title: `Ronda ${this.round + 1} de ${ROUNDS}`,
      text: demo ? 'Mirá a la Profe Ana: memorizá los pasos en orden.' : 'Tu turno: repetí la secuencia.',
      progress: `${this.length} pasos`,
      sequence: tokens,
      busy: demo,
      compact: true,
      feedback: this.feedback,
      choices: [
        ...MOVES.map((m) => ({ label: m.label, icon: m.icon, disabled: demo })),
        { label: 'Salir', icon: 'close' as const, tone: 'ghost' as const, exit: true },
      ],
    };
  }

  input(choice: number): void {
    if (this.closeIfFinished(choice)) return;
    if (this.phase !== 'input' || choice < 0 || choice >= MOVES.length) return;
    if (choice === this.seq[this.entered]) {
      this.entered++;
      this.emit({ type: 'step', index: choice });
      if (this.entered >= this.length) {
        if (this.roundErrors === 0) this.score++;
        this.roundErrors = 0;
        this.emit({ type: 'good' });
        this.round++;
        if (this.round >= ROUNDS) {
          this.finish(true);
          return;
        }
        this.seq.push(this.pick());
        this.feedback = { text: '¡Perfecto! Se suma un paso más.', tone: 'good' };
        this.restartDemo(1.0);
      }
    } else {
      this.errors++;
      this.roundErrors++;
      this.emit({ type: 'bad' });
      this.feedback = { text: '¡Casi! La Profe Ana te la muestra otra vez.', tone: 'bad' };
      this.restartDemo(0.9);
    }
    this.touch();
  }

  private restartDemo(pause: number): void {
    this.phase = 'pause';
    this.t = -pause;
    this.demoIndex = -1;
    this.entered = 0;
  }

  override update(dt: number): void {
    if (this.finished || this.phase === 'input') return;
    this.t += dt;
    if (this.phase === 'pause') {
      if (this.t < 0) return;
      this.phase = 'demo';
      this.t = 0;
      this.touch();
    }
    // Demostración: un paso por pulso, con un pulso de silencio al principio.
    const k = Math.floor(this.t / BEAT) - 1;
    if (k !== this.demoIndex) {
      this.demoIndex = k;
      if (k >= this.length) {
        this.phase = 'input';
        this.demoIndex = -1;
        this.feedback = undefined;
      } else if (k >= 0) {
        this.emit({ type: 'demo', move: this.seq[k] });
      }
      this.touch();
    }
  }

  solve(): number[] {
    if (this.finished) return [0];
    if (this.phase !== 'input') return [];
    return this.seq.slice(this.entered, this.length);
  }
}
