import { ActivityBase, type ActivityView, type GridView, type SequenceToken } from './types';

/**
 * Aula Maker: programar un robot Educabot para que cruce la pista con la
 * bandera del 40.
 *
 * Es un problema de secuencias de verdad, no un cuestionario: el jugador arma
 * el programa con tres órdenes (avanzar, girar a la izquierda, girar a la
 * derecha), lo ejecuta y ve al robot moverse paso a paso, en la pantalla y
 * sobre la mesa del aula. Si choca o no llega, el programa queda para
 * corregirlo: equivocarse es parte de la actividad, como dice el mural.
 */

export type Cmd = 'F' | 'L' | 'R';

export interface RobotLevel {
  cols: number;
  rows: number;
  start: readonly [number, number];
  /** 0 = norte (y − 1), 1 = este, 2 = sur, 3 = oeste. */
  dir: number;
  goal: readonly [number, number];
  blocks: ReadonlyArray<readonly [number, number]>;
  maxLen: number;
  /** Una solución (los tests la usan para resolver la actividad). */
  solution: readonly Cmd[];
  hint: string;
}

export const ROBOT_LEVELS: readonly RobotLevel[] = [
  {
    cols: 5,
    rows: 5,
    start: [0, 4],
    dir: 0,
    goal: [3, 1],
    blocks: [
      [1, 2],
      [2, 3],
      [3, 3],
    ],
    maxLen: 10,
    solution: ['F', 'F', 'F', 'R', 'F', 'F', 'F'],
    hint: 'El robot mira hacia arriba. Llevalo hasta la bandera esquivando los vasos.',
  },
  {
    cols: 5,
    rows: 5,
    start: [0, 0],
    dir: 1,
    goal: [3, 4],
    blocks: [
      [2, 0],
      [2, 1],
      [2, 2],
      [1, 4],
      [4, 3],
    ],
    maxLen: 12,
    solution: ['R', 'F', 'F', 'F', 'L', 'F', 'F', 'F', 'R', 'F'],
    hint: 'Ahora arranca mirando a la derecha y la pista tiene más obstáculos. Pensá cada giro.',
  },
];

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Segundos por orden durante la ejecución. */
const STEP_TIME = 0.5;

/** Índices de los botones mientras se edita. */
export const ROBOT_CHOICES = { F: 0, L: 1, R: 2, undo: 3, run: 4, exit: 5 } as const;

interface Pose {
  x: number;
  y: number;
  dir: number;
}

/** Simula un programa: las poses tras cada orden y si chocó. Puro, para la vista y los tests. */
export function simulate(level: RobotLevel, program: readonly Cmd[]): { poses: Pose[]; crashed: boolean; atGoal: boolean } {
  const poses: Pose[] = [{ x: level.start[0], y: level.start[1], dir: level.dir }];
  let p = poses[0];
  let crashed = false;
  for (const c of program) {
    if (c === 'L') p = { ...p, dir: (p.dir + 3) % 4 };
    else if (c === 'R') p = { ...p, dir: (p.dir + 1) % 4 };
    else {
      const [dx, dy] = DIRS[p.dir];
      const nx = p.x + dx;
      const ny = p.y + dy;
      const out = nx < 0 || ny < 0 || nx >= level.cols || ny >= level.rows;
      const hit = level.blocks.some(([bx, by]) => bx === nx && by === ny);
      if (out || hit) {
        crashed = true;
        poses.push({ ...p });
        break;
      }
      p = { x: nx, y: ny, dir: p.dir };
    }
    poses.push(p);
  }
  const last = poses[poses.length - 1];
  return { poses, crashed, atGoal: !crashed && last.x === level.goal[0] && last.y === level.goal[1] };
}

const LABEL: Record<Cmd, string> = { F: 'Avanzar', L: 'Izquierda', R: 'Derecha' };

export class RobotRoute extends ActivityBase {
  readonly id = 'robot' as const;
  readonly maxScore = ROBOT_LEVELS.length;
  levelIndex = 0;
  program: Cmd[] = [];
  /** Ejecución en curso: índice de la orden y tiempo dentro de ella. */
  private run: { poses: Pose[]; crashed: boolean; atGoal: boolean; i: number; t: number } | null = null;
  private feedback: ActivityView['feedback'];
  private attempts = 0;
  /** Donde quedó el robot al terminar la última pista (la bandera). */
  private rest: Pose | null = null;

  get level(): RobotLevel {
    return ROBOT_LEVELS[this.levelIndex];
  }

  get running(): boolean {
    return this.run !== null;
  }

  /** Pose actual, interpolada durante la ejecución (para el robot 3D y la grilla). */
  pose(): Pose {
    const L = this.level;
    if (!this.run) return this.rest ?? { x: L.start[0], y: L.start[1], dir: L.dir };
    const { poses, i, t } = this.run;
    const a = poses[Math.min(i, poses.length - 1)];
    const b = poses[Math.min(i + 1, poses.length - 1)];
    const k = Math.min(1, t / STEP_TIME);
    // El giro por el camino corto (de oeste a norte es +1, no −3).
    let dd = b.dir - a.dir;
    if (dd > 2) dd -= 4;
    if (dd < -2) dd += 4;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: a.dir + dd * k };
  }

  grid(): GridView {
    const L = this.level;
    const trail: Array<[number, number]> = [];
    if (this.run) for (let k = 0; k <= Math.min(this.run.i, this.run.poses.length - 1); k++) trail.push([this.run.poses[k].x, this.run.poses[k].y]);
    return {
      cols: L.cols,
      rows: L.rows,
      blocks: L.blocks,
      goal: L.goal,
      start: L.start,
      robot: this.pose(),
      trail,
      crashed: Boolean(this.run?.crashed && this.run.i >= this.run.poses.length - 2),
    };
  }

  view(): ActivityView {
    const L = this.level;
    if (this.finished) {
      return {
        ...this.finalView(
          'Aula Maker · Educabot',
          '¡La bandera del 40 llegó!',
          this.attempts <= ROBOT_LEVELS.length
            ? 'Dos pistas resueltas al primer intento. ¡Programación de manual!'
            : 'Probaste, corregiste y lo lograste: así se trabaja en el Aula Maker.',
        ),
        grid: this.grid(),
      };
    }
    const tokens: SequenceToken[] = this.program.map((c, k) => ({
      label: LABEL[c],
      icon: c === 'F' ? 'up' : c === 'L' ? 'left' : 'right',
      state: this.run ? (k < this.run.i ? 'done' : k === this.run.i ? 'active' : 'idle') : 'idle',
    }));
    const full = this.program.length >= L.maxLen;
    const busy = this.running;
    return {
      kicker: 'Aula Maker · Educabot',
      title: `Pista ${this.levelIndex + 1} de ${ROBOT_LEVELS.length}`,
      text: L.hint,
      progress: `${this.program.length}/${L.maxLen} órdenes`,
      grid: this.grid(),
      sequence: tokens,
      busy,
      feedback: this.feedback,
      choices: [
        { label: 'Avanzar', icon: 'up', disabled: busy || full },
        { label: 'Girar izq.', icon: 'left', disabled: busy || full },
        { label: 'Girar der.', icon: 'right', disabled: busy || full },
        { label: 'Borrar', icon: 'undo', disabled: busy || this.program.length === 0, tone: 'ghost' },
        { label: 'Ejecutar', icon: 'play', disabled: busy || this.program.length === 0, tone: 'accent' },
        { label: 'Salir', icon: 'close', tone: 'ghost', exit: true },
      ],
    };
  }

  input(choice: number): void {
    if (this.closeIfFinished(choice)) return;
    if (this.running) return;
    const L = this.level;
    switch (choice) {
      case ROBOT_CHOICES.F:
      case ROBOT_CHOICES.L:
      case ROBOT_CHOICES.R:
        if (this.program.length >= L.maxLen) return;
        this.program.push((['F', 'L', 'R'] as const)[choice]);
        this.feedback = undefined;
        this.emit({ type: 'select' });
        break;
      case ROBOT_CHOICES.undo:
        this.program.pop();
        this.feedback = undefined;
        this.emit({ type: 'select' });
        break;
      case ROBOT_CHOICES.run: {
        if (this.program.length === 0) return;
        this.attempts++;
        const sim = simulate(L, this.program);
        this.run = { ...sim, i: 0, t: 0 };
        this.feedback = { text: 'Ejecutando…', tone: 'info' };
        break;
      }
      default:
        return;
    }
    this.touch();
  }

  override update(dt: number): void {
    const run = this.run;
    if (!run) return;
    run.t += dt;
    if (run.t < STEP_TIME) {
      this.touch();
      return;
    }
    run.t = 0;
    run.i++;
    this.emit({ type: 'step', index: run.i });
    if (run.i < run.poses.length - 1) {
      this.touch();
      return;
    }
    // Terminó el programa.
    this.run = null;
    if (run.atGoal) {
      this.score++;
      this.emit({ type: 'good' });
      if (this.levelIndex >= ROBOT_LEVELS.length - 1) {
        this.rest = run.poses[run.poses.length - 1];
        this.finish(true);
        return;
      }
      this.levelIndex++;
      this.program = [];
      this.feedback = { text: '¡Llegó a la bandera! Siguiente pista.', tone: 'good' };
    } else {
      this.emit({ type: 'bad' });
      this.feedback = run.crashed
        ? { text: '¡Choque! Revisá la orden donde se frenó: el programa sigue ahí para corregirlo.', tone: 'bad' }
        : { text: 'No llegó a la bandera. Le faltan o le sobran órdenes: corregí y probá de nuevo.', tone: 'bad' };
    }
    this.touch();
  }

  solve(): number[] {
    if (this.finished) return [0];
    const out: number[] = [];
    for (let k = 0; k < this.program.length; k++) out.push(ROBOT_CHOICES.undo);
    for (const c of this.level.solution) out.push(ROBOT_CHOICES[c]);
    out.push(ROBOT_CHOICES.run);
    return out;
  }
}
