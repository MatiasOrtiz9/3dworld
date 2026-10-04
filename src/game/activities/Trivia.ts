import { ActivityBase, type ActivityView } from './types';

/**
 * Trivia de la vitrina de los trofeos: la que Lola arma para los visitantes.
 *
 * Todas las preguntas se responden MIRANDO la escuela: carteles, murales y
 * lugares que el jugador ya recorrió en el capítulo 1. No hay fechas ni
 * datos institucionales: sólo lo que está a la vista.
 */

export interface TriviaQuestion {
  q: string;
  options: string[];
  answer: number;
  /** Dónde se ve: se muestra al acertar (y como pista al errar). */
  where: string;
}

export const TRIVIA: readonly TriviaQuestion[] = [
  {
    q: '¿Qué lema está pintado debajo del mural de San Martín, en Recepción?',
    options: ['«Juntos somos más»', '«Serás lo que debas ser o no serás nada»', '«Aprender haciendo»'],
    answer: 1,
    where: 'Está sobre el zócalo de mármol, debajo del cruce de los Andes.',
  },
  {
    q: 'En el mural del Aula Maker hay cinco palabras. ¿Cuál NO está?',
    options: ['IMAGINA', 'COMPARTE', 'COMPITE'],
    answer: 2,
    where: 'Imagina, diseña, crea, aprende y comparte: ninguna habla de competir.',
  },
  {
    q: '¿Dónde está el punto de encuentro del plano de evacuación?',
    options: ['En el patio aire libre', 'En el Polideportivo', 'En la esquina de Laprida y Miguel Cané'],
    answer: 2,
    where: 'El plano del hall y el cartel verde de la esquina lo marcan.',
  },
  {
    q: '¿Qué dice el cartel ovalado de la línea de la cantina?',
    options: ['PRO FOOD', 'BUFFET 40', 'COMEDOR'],
    answer: 0,
    where: 'Cuelga sobre la línea de servicio de acero, en la cantina.',
  },
  {
    q: '¿Qué árbol crece en el cantero del Espacio recreativo, rodeado de asientos de madera?',
    options: ['Un pino', 'Una palmera', 'Un ombú'],
    answer: 1,
    where: 'La palmera del patio oeste, frente a la galería de columnas negras.',
  },
];

export class Trivia extends ActivityBase {
  readonly id = 'trivia' as const;
  readonly maxScore: number;
  index = 0;
  /** Esta pregunta ya tuvo un error (no suma punto aunque después acierte). */
  private missed = false;
  /** Acertó y está leyendo la explicación. */
  private explaining = false;
  private wrong: number | null = null;

  constructor(private readonly questions: readonly TriviaQuestion[] = TRIVIA) {
    super();
    this.maxScore = questions.length;
  }

  view(): ActivityView {
    if (this.finished) {
      const perfect = this.score === this.maxScore;
      return this.finalView(
        'Pasillo de los trofeos',
        perfect ? '¡Trivia perfecta!' : 'Trivia completa',
        perfect ? 'Ni un error: los visitantes van a tener que mirar con atención para empatarte.' : 'Lola va a usar tus respuestas para mejorar las preguntas. ¡Bien jugado!',
      );
    }
    const Q = this.questions[this.index];
    if (this.explaining) {
      return {
        kicker: 'Trivia del Recorrido 40',
        title: `Pregunta ${this.index + 1} de ${this.questions.length}`,
        text: Q.q,
        progress: `${this.score} aciertos`,
        feedback: { text: `¡Correcto! ${Q.where}`, tone: 'good' },
        choices: [{ label: this.index === this.questions.length - 1 ? 'Ver resultado' : 'Siguiente', icon: 'next', tone: 'accent' }],
      };
    }
    return {
      kicker: 'Trivia del Recorrido 40',
      title: `Pregunta ${this.index + 1} de ${this.questions.length}`,
      text: Q.q,
      progress: `${this.score} aciertos`,
      feedback: this.wrong !== null ? { text: `No es esa. Pista: ${Q.where}`, tone: 'bad' } : undefined,
      choices: [
        ...Q.options.map((o, k) => ({ label: o, tone: k === this.wrong ? ('bad' as const) : undefined, disabled: k === this.wrong })),
        { label: 'Salir', icon: 'close' as const, tone: 'ghost' as const, exit: true },
      ],
    };
  }

  input(choice: number): void {
    if (this.closeIfFinished(choice)) return;
    const Q = this.questions[this.index];
    if (this.explaining) {
      if (choice !== 0) return;
      this.explaining = false;
      this.wrong = null;
      this.missed = false;
      this.index++;
      if (this.index >= this.questions.length) {
        this.finish(true);
        return;
      }
      this.touch();
      return;
    }
    if (choice < 0 || choice >= Q.options.length) return;
    if (choice === Q.answer) {
      if (!this.missed) this.score++;
      this.explaining = true;
      this.emit({ type: 'good' });
    } else {
      this.missed = true;
      this.wrong = choice;
      this.emit({ type: 'bad' });
    }
    this.touch();
  }

  solve(): number[] {
    if (this.finished) return [0];
    if (this.explaining) return [0];
    return [this.questions[this.index].answer];
  }
}
