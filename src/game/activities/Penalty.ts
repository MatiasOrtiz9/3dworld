import { ActivityBase, type ActivityView, type RandomFn } from './types';

/**
 * Polideportivo: tres lanzamientos de siete metros (handball) con Lola en el
 * arco. Se elige a dónde tirar; la arquera se tira a un lado. La pelota
 * vuela de verdad en la cancha (el director la anima con `shot()`).
 *
 * Participar ya cuenta: el sello se gana con los tres lanzamientos, sin
 * importar cuántos entren. Así el azar de la arquera nunca bloquea la
 * historia.
 */

export const ZONES: ReadonlyArray<{ label: string; side: -1 | 0 | 1; high: boolean }> = [
  { label: 'Arriba izquierda', side: -1, high: true },
  { label: 'Abajo izquierda', side: -1, high: false },
  { label: 'Al medio', side: 0, high: false },
  { label: 'Arriba derecha', side: 1, high: true },
  { label: 'Abajo derecha', side: 1, high: false },
];

const SHOTS = 3;
/** Vuelo de la pelota y pausa para ver el resultado, en segundos. */
export const FLIGHT = 0.75;
const RESULT = 1.4;

export interface ShotState {
  zone: number;
  /** Hacia dónde se tiró la arquera: −1 izquierda, 0 se quedó, 1 derecha. */
  keeper: -1 | 0 | 1;
  saved: boolean;
  /** 0 → 1 durante el vuelo; > 1 en la pausa del resultado. */
  t: number;
}

export class Penalty extends ActivityBase {
  readonly id = 'penales' as const;
  readonly maxScore = SHOTS;
  results: boolean[] = [];
  private current: ShotState | null = null;
  private feedback: ActivityView['feedback'];

  constructor(private readonly random: RandomFn = Math.random) {
    super();
  }

  /** Lanzamiento en curso (para animar pelota y arquera), o null. */
  shot(): ShotState | null {
    return this.current;
  }

  view(): ActivityView {
    if (this.finished) {
      const g = this.score;
      return this.finalView(
        'Polideportivo · Handball',
        g === SHOTS ? '¡Tres de tres!' : g >= 2 ? '¡Ganaste la serie!' : 'Serie terminada',
        g === SHOTS ? 'Lola no pudo con ninguno. Las gradas se vinieron abajo.' : g >= 2 ? 'Dos adentro: la Profe Juli aplaude desde el costado.' : '«Lo importante es animarse», dice la Profe Juli. ¡Y Lola atajó como nunca!',
        g >= 2 ? 'good' : 'info',
      );
    }
    const busy = this.current !== null;
    const marks = this.results.map((r) => (r ? '●' : '○')).join(' ');
    return {
      kicker: 'Polideportivo · Handball',
      title: `Lanzamiento ${Math.min(this.results.length + 1, SHOTS)} de ${SHOTS}`,
      text: busy ? '…' : 'Elegí a dónde lanzar. Lola mira tus ojos: ¡no le avises!',
      progress: marks || '—',
      busy,
      compact: true,
      feedback: this.feedback,
      choices: [
        ...ZONES.map((z) => ({ label: z.label, icon: 'target' as const, disabled: busy })),
        { label: 'Salir', icon: 'close' as const, tone: 'ghost' as const, exit: true },
      ],
    };
  }

  input(choice: number): void {
    if (this.closeIfFinished(choice)) return;
    if (this.current || choice < 0 || choice >= ZONES.length) return;
    const z = ZONES[choice];
    const r = this.random();
    const keeper: -1 | 0 | 1 = r < 0.36 ? -1 : r < 0.72 ? 1 : 0;
    // La arquera ataja si adivina el lado; al medio sólo si se queda parada.
    // Arriba y a un costado es más difícil: si adivina, ataja la mitad de las veces.
    let saved = keeper === z.side;
    if (saved && z.high && z.side !== 0) saved = this.random() < 0.5;
    this.current = { zone: choice, keeper, saved, t: 0 };
    this.feedback = undefined;
    this.emit({ type: 'shot', zone: choice, saved });
    this.touch();
  }

  override update(dt: number): void {
    const c = this.current;
    if (!c) return;
    const before = c.t;
    c.t += dt / FLIGHT;
    if (before < 1 && c.t >= 1) {
      this.results.push(!c.saved);
      if (!c.saved) this.score++;
      this.emit({ type: c.saved ? 'bad' : 'good' });
      this.feedback = c.saved ? { text: '¡Atajó Lola!', tone: 'bad' } : { text: '¡Gooool!', tone: 'good' };
      this.touch();
      return;
    }
    if (c.t >= 1 + RESULT / FLIGHT) {
      this.current = null;
      if (this.results.length >= SHOTS) this.finish(true);
      else this.touch();
    }
  }

  solve(): number[] {
    if (this.finished) return [0];
    if (this.current) return [];
    return [2];
  }
}
