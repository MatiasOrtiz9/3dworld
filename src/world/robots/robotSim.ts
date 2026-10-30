import { fromPlan, type Level, type P } from '../SchoolLayout';

/**
 * Robots de la Escuela 2050: lógica pura, sin motor (la dibuja `Robots`).
 *
 * Dos tipos:
 *  - `cleaner`: fregadora autónoma de pasillo (0,62 × 0,5 m, ~0,5 m de alto),
 *    va y vuelve por el centro del pasillo en dos carriles, como se limpia
 *    un piso de verdad.
 *  - `guide`: robot de atención de ~1,25 m, base rodante, torso y cabeza con
 *    pantalla de cara; recorre su ambiente con pausas y mira al jugador.
 *
 * Se mueven como máquinas, no como personas: aceleran y frenan suave, giran
 * en el lugar en las esquinas (nunca derrapan), y frenan del todo ante
 * alguien delante (el jugador o un peatón que camina). Coordenadas locales
 * de la escuela (u, v en metros reales), rumbo `h` con el frente en
 * (cos h, sin h).
 */

export type RobotKind = 'cleaner' | 'guide';

export interface RobotDef {
  id: string;
  kind: RobotKind;
  level: Level;
  /** Recorrido en metros reales (u, v). */
  route: readonly P[];
  /** Cerrado (vuelve al primero) o de ida y vuelta. */
  loop: boolean;
  /** Velocidad de crucero (m/s). */
  speed: number;
  /** Pausa en cada punto del recorrido (s): mínimo y máximo. */
  pause: readonly [number, number];
  /** Color de acento (multiplica las caras pintables). */
  color: readonly [number, number, number];
}

/** Radio de cada tipo, para el paso libre y para la colisión del jugador. */
export const ROBOT_RADIUS: Record<RobotKind, number> = { cleaner: 0.34, guide: 0.32 };

const ACCEL = 0.6;
/** Giro en el lugar (rad/s) y su aceleración angular. */
const TURN_RATE = 1.6;
const TURN_ACCEL = 4.0;
/** Distancia de frenado ante alguien delante, desde el borde del robot. */
const STOP_AHEAD = 0.9;
/** Nadie a menos de esto, en ninguna dirección: frena igual. */
const STOP_CLOSE = 0.55;
/** Tiempo con el paso libre antes de volver a arrancar. */
const CLEAR_DELAY = 0.8;

const pl = (u: number, v: number): P => fromPlan(u, v);

/**
 * Los robots de la escuela. Rutas en coordenadas del plano (`fromPlan`),
 * comprobadas contra muros y muebles en `tests/robots.test.ts`.
 */
export const ROBOTS: readonly RobotDef[] = [
  // Pasillo sur de planta baja (el de las aulas de primaria), en dos carriles.
  {
    id: 'limpia-pb',
    kind: 'cleaner',
    level: 0,
    route: [pl(3.2, -7.0), pl(31.0, -7.0), pl(31.0, -7.75), pl(3.2, -7.75)],
    loop: true,
    speed: 0.45,
    pause: [0.4, 1.2],
    color: [0.16, 0.42, 0.78],
  },
  // Pasillo de lockers del primer piso.
  {
    id: 'limpia-p1',
    kind: 'cleaner',
    level: 1,
    route: [pl(7.6, -7.15), pl(30.6, -7.15)],
    loop: false,
    speed: 0.42,
    pause: [1.0, 2.5],
    color: [0.12, 0.62, 0.5],
  },
  // Hall de acceso: recibe a los que entran y recorre el hall.
  {
    id: 'guia-hall',
    kind: 'guide',
    level: 0,
    route: [pl(36.0, -6.8), pl(38.4, -6.8), pl(38.4, -11.4), pl(36.0, -11.4)],
    loop: true,
    speed: 0.55,
    pause: [2.5, 6.0],
    color: [0.78, 0.16, 0.2],
  },
  // Biblioteca del primer piso: va y viene por el pasillo de las estanterías.
  {
    id: 'guia-biblio',
    kind: 'guide',
    level: 1,
    route: [pl(23.42, -26.3), pl(23.42, -30.7)],
    loop: false,
    speed: 0.35,
    pause: [3.0, 7.0],
    color: [0.2, 0.55, 0.32],
  },
  // Hall del jardín: los chicos de inicial lo cruzan a la entrada y la salida.
  {
    id: 'guia-jardin',
    kind: 'guide',
    level: 0,
    route: [pl(61.25, -28.6), pl(61.25, -23.6)],
    loop: false,
    speed: 0.4,
    pause: [3.0, 8.0],
    color: [0.95, 0.72, 0.12],
  },
];

/** Alguien que el robot tiene que respetar (jugador o peatón), en locales. */
export interface Obstacle {
  u: number;
  v: number;
  level: Level;
}

type State = 'move' | 'turn' | 'pause' | 'blocked';

export class RobotAgent {
  u: number;
  v: number;
  h: number;
  speed = 0;
  /** Velocidad de giro actual (rad/s, con signo). */
  turn = 0;
  state: State = 'turn';
  /** Rumbo de la cabeza respecto del cuerpo (sólo `guide`). */
  head = 0;
  /** 0..1: párpados (1 = ojos abiertos). */
  eyes = 1;
  /** Frenó por alguien delante (la luz pasa a ámbar). */
  wary = false;
  /** Aceleración de este cuadro (m/s²): el cuerpo cabecea un poco. */
  accel = 0;
  /** Recorrido acumulado (m): el cepillo y las luces lo usan para animarse. */
  odo = 0;
  time = 0;
  private target = 1;
  private dir = 1;
  private timer = 0;
  private clear = 0;
  private blinkIn: number;
  private rnd: number;

  constructor(
    readonly def: RobotDef,
    seed = 1,
  ) {
    const [u, v] = def.route[0];
    this.u = u;
    this.v = v;
    const [u1, v1] = def.route[1 % def.route.length];
    this.h = Math.atan2(v1 - v, u1 - u);
    this.rnd = (seed * 9301 + 49297) % 233280;
    this.blinkIn = 1 + this.random() * 3;
  }

  get level(): Level {
    return this.def.level;
  }

  get radius(): number {
    return ROBOT_RADIUS[this.def.kind];
  }

  /** Determinista: misma semilla, mismo recorrido. */
  private random(): number {
    this.rnd = (this.rnd * 9301 + 49297) % 233280;
    return this.rnd / 233280;
  }

  /**
   * Un paso de simulación. `others` es quien camina cerca (sin el propio
   * robot); `look` es hacia dónde mirar con la cabeza (el jugador) o null.
   */
  step(dt: number, others: readonly Obstacle[], look: Obstacle | null): void {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const blocked = this.blockedBy(others);
    if (blocked) this.clear = 0;
    else this.clear += dt;
    const halt = blocked || (this.state === 'blocked' && this.clear < CLEAR_DELAY);
    this.wary = halt;

    const route = this.def.route;
    const [tu, tv] = route[this.target];
    const du = tu - this.u;
    const dv = tv - this.v;
    const dist = Math.hypot(du, dv);
    const want = Math.atan2(dv, du);
    const err = wrap(want - this.h);
    const prev = this.speed;

    if (this.state === 'pause') {
      this.brake(dt);
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'turn';
    } else if (halt) {
      this.brake(dt);
      if (this.state !== 'turn') this.state = 'blocked';
    } else if (this.state === 'blocked') {
      this.state = Math.abs(err) > 0.05 ? 'turn' : 'move';
    }

    if (this.state === 'turn') {
      this.brake(dt);
      // Giro en el lugar con aceleración y frenado angular: llega sin pasarse.
      const stopAngle = (this.turn * this.turn) / (2 * TURN_ACCEL);
      const sign = Math.sign(err) || 1;
      const goal = Math.abs(err) <= stopAngle + 1e-3 ? 0 : sign * TURN_RATE;
      this.turn = approach(this.turn, goal, TURN_ACCEL * dt);
      let dh = this.turn * dt;
      if (Math.abs(dh) > Math.abs(err)) dh = err;
      this.h = wrap(this.h + dh);
      if (Math.abs(wrap(want - this.h)) < 0.02 && Math.abs(this.turn) < 0.3 && this.speed < 0.02) {
        this.h = want;
        this.turn = 0;
        if (!halt) this.state = 'move';
      }
    } else {
      this.turn = approach(this.turn, 0, TURN_ACCEL * dt);
    }

    if (this.state === 'move') {
      // Corrige el rumbo sobre la marcha (sin derrapar) y frena para llegar
      // justo al punto.
      this.h = wrap(this.h + clamp(err, -0.6 * dt, 0.6 * dt));
      const brakeDist = (this.speed * this.speed) / (2 * ACCEL);
      const goal = dist <= brakeDist + 0.01 ? 0 : this.def.speed;
      this.speed = approach(this.speed, goal, ACCEL * dt);
      if (dist < 0.03 || (this.speed < 0.02 && dist < 0.12)) {
        this.u = tu;
        this.v = tv;
        this.speed = 0;
        this.advance();
      }
    }

    const step = Math.min(this.speed * dt, Math.max(0, dist));
    if (this.state === 'move' || this.speed > 0) {
      this.u += Math.cos(this.h) * step;
      this.v += Math.sin(this.h) * step;
      this.odo += step;
    }
    this.accel = (this.speed - prev) / dt;

    this.updateHead(dt, look);
    this.updateEyes(dt);
  }

  private brake(dt: number): void {
    this.speed = approach(this.speed, 0, ACCEL * 1.6 * dt);
  }

  private advance(): void {
    const n = this.def.route.length;
    const [p0, p1] = this.def.pause;
    this.timer = p0 + (p1 - p0) * this.random();
    this.state = 'pause';
    if (this.def.loop) {
      this.target = (this.target + 1) % n;
      return;
    }
    if (this.target + this.dir >= n || this.target + this.dir < 0) this.dir = -this.dir;
    this.target += this.dir;
  }

  /** ¿Alguien en su camino (adelante, o pegado)? */
  private blockedBy(others: readonly Obstacle[]): boolean {
    const r = this.radius;
    const fu = Math.cos(this.h);
    const fv = Math.sin(this.h);
    for (const o of others) {
      if (o.level !== this.level) continue;
      const du = o.u - this.u;
      const dv = o.v - this.v;
      const d = Math.hypot(du, dv);
      if (d < r + STOP_CLOSE) return true;
      if (d > r + STOP_AHEAD + 0.3) continue;
      // Delante y dentro del ancho del robot (más un margen).
      const along = du * fu + dv * fv;
      const side = Math.abs(-du * fv + dv * fu);
      if (along > 0 && along < r + STOP_AHEAD && side < r + 0.35) return true;
    }
    return false;
  }

  private updateHead(dt: number, look: Obstacle | null): void {
    if (this.def.kind !== 'guide') return;
    let goal = 0;
    if (look && look.level === this.level) {
      const du = look.u - this.u;
      const dv = look.v - this.v;
      const d = Math.hypot(du, dv);
      if (d < 4.5 && d > 0.2) goal = clamp(wrap(Math.atan2(dv, du) - this.h), -1.25, 1.25);
    }
    if (goal === 0 && this.state === 'pause') {
      // Parado sin nadie: mira a los costados, despacio.
      goal = Math.sin(this.time * 0.45 + this.rnd) * 0.7;
    }
    // Seguimiento críticamente amortiguado (sin rebote): ~0,4 s.
    const k = 1 - Math.exp(-dt * 7);
    this.head += (goal - this.head) * k;
  }

  private updateEyes(dt: number): void {
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkIn = 2.5 + this.random() * 3.5;
      this.eyes = 0;
    }
    this.eyes = Math.min(1, this.eyes + dt / 0.14);
  }
}

export function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function approach(x: number, goal: number, step: number): number {
  return x < goal ? Math.min(goal, x + step) : Math.max(goal, x - step);
}

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
