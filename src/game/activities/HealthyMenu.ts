import { FRASES } from '../story/phrases';
import { ActivityBase, type ActivityView } from './types';

/**
 * Cantina: armar con Graciela la bandeja del día para los visitantes.
 *
 * No hay respuesta "incorrecta" que bloquee: cada elección tiene su
 * comentario y su puntaje, y al final se puede armar otra bandeja. Lo que
 * se premia es lo de sentido común (verduras, agua, fruta), sin discursos
 * médicos.
 */

interface Option {
  label: string;
  points: 0 | 1 | 2;
  comment: string;
}

interface Round {
  title: string;
  options: Option[];
}

export const MENU_ROUNDS: readonly Round[] = [
  {
    title: 'Plato principal',
    options: [
      { label: 'Milanesa al horno', points: 2, comment: 'Al horno queda riquísima y más liviana.' },
      { label: 'Fideos con salsa', points: 2, comment: '¡Un clásico! Con salsa de tomate casera.' },
      { label: 'Papas fritas solas', points: 0, comment: 'Ricas, pero solas no alcanzan para una comida completa.' },
    ],
  },
  {
    title: 'Acompañamiento',
    options: [
      { label: 'Ensalada de colores', points: 2, comment: 'Lechuga, tomate y zanahoria: el plato se llena de color.' },
      { label: 'Puré de calabaza', points: 2, comment: 'Suave y naranja. A los del jardín les encanta.' },
      { label: 'Más papas fritas', points: 0, comment: '¿Papas con papas? Sumemos algo verde.' },
    ],
  },
  {
    title: 'Bebida',
    options: [
      { label: 'Agua fresca', points: 2, comment: 'La mejor compañera de cualquier almuerzo.' },
      { label: 'Jugo exprimido', points: 1, comment: 'Natural y rico, de vez en cuando.' },
      { label: 'Gaseosa', points: 0, comment: 'Mejor dejarla para un cumpleaños.' },
    ],
  },
  {
    title: 'Postre',
    options: [
      { label: 'Fruta de estación', points: 2, comment: 'Mandarina, manzana o banana: ¡dulce y fresca!' },
      { label: 'Yogur', points: 1, comment: 'Buena opción para cerrar.' },
      { label: 'Alfajor', points: 0, comment: 'Delicioso, pero mejor como gustito del recreo.' },
    ],
  },
];

export class HealthyMenu extends ActivityBase {
  readonly id = 'menu' as const;
  readonly maxScore = MENU_ROUNDS.length * 2;
  round = 0;
  picks: number[] = [];
  /** Mostrando el comentario de la última elección. */
  private commenting = false;

  /**
   * `phrases` (ver `story/phrases.ts`): con frases, los comentarios los dice
   * Graciela. Sin ellas el comentario queda como explicación del juego, sin
   * nadie que lo diga: es lo que enseña la actividad.
   */
  constructor(private readonly phrases = FRASES) {
    super();
  }

  view(): ActivityView {
    const tray = this.picks.map((p, k) => MENU_ROUNDS[k].options[p].label).join(' · ');
    if (this.finished) {
      const s = this.score;
      const text = !this.phrases
        ? s >= this.maxScore - 1
          ? `Bandeja equilibrada: ${tray}.`
          : s >= this.maxScore / 2
            ? `Buena bandeja: ${tray}. Le faltó un poco de color.`
            : `Tu bandeja: ${tray}. Se puede equilibrar mejor.`
        : s >= this.maxScore - 1
          ? `Bandeja equilibrada: ${tray}. «¡Así da gusto servir!», dice Graciela.`
          : s >= this.maxScore / 2
            ? `Buena bandeja: ${tray}. «Le sumaría un poco más de color», dice Graciela.`
            : `Tu bandeja: ${tray}. «Rica, pero podemos equilibrarla mejor», dice Graciela.`;
      return {
        kicker: 'Cantina | Comedor · PRO FOOD',
        title: 'La bandeja del Recorrido 40',
        text,
        feedback: { text: `${s} / ${this.maxScore} puntos de equilibrio`, tone: s >= this.maxScore / 2 ? 'good' : 'info' },
        choices: [
          { label: 'Así está perfecta', icon: 'next', tone: 'accent' },
          { label: 'Armar otra bandeja', icon: 'undo', tone: 'ghost' },
        ],
      };
    }
    const R = MENU_ROUNDS[this.round];
    if (this.commenting) {
      const o = R.options[this.picks[this.round]];
      return {
        kicker: 'Cantina | Comedor · PRO FOOD',
        title: R.title,
        text: tray,
        progress: `${this.round + 1}/${MENU_ROUNDS.length}`,
        feedback: { text: this.phrases ? `Graciela: «${o.comment}»` : o.comment, tone: o.points === 2 ? 'good' : o.points === 1 ? 'info' : 'bad' },
        choices: [{ label: this.round === MENU_ROUNDS.length - 1 ? 'Ver la bandeja' : 'Siguiente', icon: 'next', tone: 'accent' }],
      };
    }
    return {
      kicker: 'Cantina | Comedor · PRO FOOD',
      title: R.title,
      text: tray ? `En la bandeja: ${tray}. ¿Qué sumamos?` : 'Elegí de la línea de servicio. ¿Qué va primero?',
      progress: `${this.round + 1}/${MENU_ROUNDS.length}`,
      choices: [...R.options.map((o) => ({ label: o.label })), { label: 'Salir', icon: 'close' as const, tone: 'ghost' as const, exit: true }],
    };
  }

  input(choice: number): void {
    if (this.finished) {
      if (choice === 0) {
        this.closed = true;
        this.touch();
      } else if (choice === 1) {
        // Otra bandeja: el resultado anterior ya contó para el sello.
        this.finished = false;
        this.round = 0;
        this.picks = [];
        this.score = 0;
        this.touch();
      }
      return;
    }
    const R = MENU_ROUNDS[this.round];
    if (this.commenting) {
      if (choice !== 0) return;
      this.commenting = false;
      this.round++;
      if (this.round >= MENU_ROUNDS.length) this.finish(true);
      else this.touch();
      return;
    }
    if (choice < 0 || choice >= R.options.length) return;
    this.picks[this.round] = choice;
    this.score += R.options[choice].points;
    this.commenting = true;
    this.emit({ type: R.options[choice].points === 2 ? 'good' : R.options[choice].points === 1 ? 'select' : 'bad' });
    this.touch();
  }

  solve(): number[] {
    if (this.finished) return [0];
    if (this.commenting) return [0];
    const R = MENU_ROUNDS[this.round];
    return [R.options.findIndex((o) => o.points === 2)];
  }
}
