import { ActivityBase, type ActivityView, type IconId } from './types';

/**
 * Espacio recreativo: separar lo que quedó después del recreo en el punto
 * limpio. Tres cestos: reciclables secos, orgánicos (compost) y basura (lo
 * que no se recicla). Se eligieron objetos sin ambigüedad.
 */

export const BINS: ReadonlyArray<{ label: string; icon: IconId; color: string }> = [
  { label: 'Reciclables', icon: 'recycle', color: '#2f9e5b' },
  { label: 'Orgánicos', icon: 'leaf', color: '#8a5a2b' },
  { label: 'Basura', icon: 'trash', color: '#2b2f36' },
];

export const WASTE: ReadonlyArray<{ item: string; bin: 0 | 1 | 2; why: string }> = [
  { item: 'Botella de agua de plástico', bin: 0, why: 'Vacía y aplastada, el plástico se recicla.' },
  { item: 'Cáscara de mandarina', bin: 1, why: 'Restos de fruta: van al compost.' },
  { item: 'Hoja de carpeta usada', bin: 0, why: 'Papel limpio y seco: reciclable.' },
  { item: 'Yerba del mate', bin: 1, why: 'La yerba usada es orgánica: abono para los canteros.' },
  { item: 'Lata de gaseosa', bin: 0, why: 'El aluminio se recicla una y otra vez.' },
  { item: 'Chicle masticado', bin: 2, why: 'No se recicla ni se composta: a la basura (¡nunca al piso!).' },
  { item: 'Caja de cartón', bin: 0, why: 'Plegada para que ocupe menos lugar.' },
  { item: 'Pañuelito descartable usado', bin: 2, why: 'Usado, no se puede reciclar.' },
];

export class Recycling extends ActivityBase {
  readonly id = 'reciclaje' as const;
  readonly maxScore = WASTE.length;
  index = 0;
  private missed = false;
  private last: ActivityView['feedback'];
  private wrong: number | null = null;

  view(): ActivityView {
    if (this.finished) {
      return this.finalView(
        'Espacio recreativo · Punto limpio',
        '¡Patio limpio!',
        this.score === this.maxScore ? 'Todo en su cesto, sin un error. Los canteros te agradecen el compost.' : 'Todo quedó separado. La próxima, sin dudar.',
      );
    }
    const W = WASTE[this.index];
    return {
      kicker: 'Espacio recreativo · Punto limpio',
      title: W.item,
      text: '¿En qué cesto va?',
      progress: `${this.index + 1}/${WASTE.length}`,
      feedback: this.last,
      choices: [
        ...BINS.map((b, k) => ({ label: b.label, icon: b.icon, tone: k === this.wrong ? ('bad' as const) : undefined, disabled: k === this.wrong })),
        { label: 'Salir', icon: 'close' as const, tone: 'ghost' as const, exit: true },
      ],
    };
  }

  input(choice: number): void {
    if (this.closeIfFinished(choice)) return;
    if (choice < 0 || choice >= BINS.length) return;
    const W = WASTE[this.index];
    if (choice !== W.bin) {
      this.missed = true;
      this.wrong = choice;
      this.last = { text: `Ese no. Pensalo: ¿se puede reciclar, compostar o ninguna de las dos?`, tone: 'bad' };
      this.emit({ type: 'bad' });
      this.touch();
      return;
    }
    if (!this.missed) this.score++;
    this.emit({ type: 'good' });
    this.last = { text: `¡Bien! ${W.why}`, tone: 'good' };
    this.missed = false;
    this.wrong = null;
    this.index++;
    if (this.index >= WASTE.length) this.finish(true);
    else this.touch();
  }

  solve(): number[] {
    if (this.finished) return [0];
    return [WASTE[this.index].bin];
  }
}
