import type { NpcAnim } from '../../game/contracts';
import type { IdleStyle } from './Looks';

/**
 * Animación procedural de las personas.
 *
 * Nada de clips grabados: cada animación es una función del tiempo que
 * devuelve ángulos de articulación (los "canales" de la pose). Así cada
 * persona tiene su propio ritmo (semilla), la caminata se ajusta a la
 * velocidad real (el ciclo avanza con la distancia recorrida: los pies no
 * patinan) y cambiar de estado es mezclar dos poses durante un instante.
 *
 * Capas, de abajo hacia arriba:
 *  1. base: la animación del estado (parado, sentado, caminando…) con fundido
 *     cruzado de ~0,35 s respecto de la anterior;
 *  2. gesto: saludo, señalar, aplaudir o asentir, sólo en el torso, brazos y
 *     cabeza, con su propia envolvente (se puede saludar caminando);
 *  3. mirada: la cabeza (y un poco el torso) se orienta hacia el jugador o
 *     hacia quien habla, con un resorte que evita los giros secos.
 *
 * Convención de ángulos (ver `Rig`): flexión positiva lleva el miembro hacia
 * adelante; abducción positiva lo abre hacia afuera; rotación interna
 * positiva gira el antebrazo hacia el cuerpo; inclinación del torso positiva
 * es hacia adelante; cabeza: guiñada positiva hacia la izquierda del mundo
 * (mismo sentido que el rumbo), cabeceo positivo hacia abajo.
 */

export type AnimId = NpcAnim | 'mop' | 'serve' | 'sitDesk' | 'sitTalk' | 'sitFloor' | 'nod' | 'phone';

// Canales de la pose.
export const LEAN = 0;
export const TWIST = 1;
export const ROLL = 2;
export const PTWIST = 3;
export const PROLL = 4;
export const HYAW = 5;
export const HPITCH = 6;
export const HROLL = 7;
/** Brazos: base del brazo izquierdo / derecho; +0 flexión, +1 abducción, +2 rotación interna, +3 codo. */
export const ARM_L = 8;
export const ARM_R = 12;
/** Piernas: +0 flexión de cadera, +1 abducción, +2 rotación externa, +3 rodilla. */
export const LEG_L = 16;
export const LEG_R = 20;
/** Sentado (0 parado … 1 sobre el asiento). */
export const SIT = 24;
/** Rebote vertical extra (vuelo de la carrera), m relativos a la altura. */
export const BOUNCE = 25;
export const POSE_N = 26;

/** Canales que un gesto puede pisar (torso, cabeza y brazos). */
const UPPER: readonly number[] = [LEAN, TWIST, HYAW, HPITCH, HROLL, 8, 9, 10, 11, 12, 13, 14, 15];

export interface AnimCtx {
  /** Tiempo del clip (s). */
  t: number;
  /** Semilla de la persona (0..1): fases y frecuencias propias. */
  seed: number;
  style: IdleStyle;
  /** Locomoción: amplitud (0..1), fase del ciclo (rad) y mezcla con la carrera. */
  amp: number;
  phase: number;
  run: number;
  /** Sentado: flexión de cadera y de rodilla para apoyar los pies, y si los pies cuelgan. */
  hipFlex: number;
  knee: number;
  dangle: boolean;
  /** Chico: más inquieto. */
  kid: boolean;
  /**
   * Mesa delante del asiento, relativa a la articulación de la cadera:
   * altura de la tapa (NaN = no hay mesa a mano) y distancia a su borde.
   */
  deskH: number;
  deskZ: number;
  /** Medidas de la persona para apoyar los brazos: cintura y hombro sobre la cadera, brazo y antebrazo. */
  waist: number;
  shY: number;
  l1: number;
  l2: number;
  /** Largo del muslo y su radio (sentado, las manos se apoyan encima). */
  thigh: number;
  thighR: number;
}

const pos = (x: number) => (x > 0 ? x : 0);
const smoothSign = (x: number) => Math.tanh(x * 3);

function rest(o: Float32Array): void {
  o.fill(0);
  o[ARM_L + 1] = 0.09;
  o[ARM_R + 1] = 0.09;
  o[ARM_L + 3] = 0.14;
  o[ARM_R + 3] = 0.14;
}

/** Brazos según la postura de espera. */
function arms(o: Float32Array, c: AnimCtx, style: IdleStyle): void {
  const s = c.seed * 50;
  if (style === 1) {
    // Manos atrás: brazo hacia atrás, rotación interna y codo doblado.
    for (const a of [ARM_L, ARM_R]) {
      o[a] = -0.42;
      o[a + 1] = 0.12;
      o[a + 2] = 1.4;
      o[a + 3] = 1.05;
    }
  } else if (style === 2) {
    // Brazos cruzados: antebrazos uno sobre otro delante del pecho.
    o[ARM_L] = 0.42;
    o[ARM_L + 1] = 0.08;
    o[ARM_L + 2] = 1.05;
    o[ARM_L + 3] = 1.85;
    o[ARM_R] = 0.34;
    o[ARM_R + 1] = 0.08;
    o[ARM_R + 2] = 1.12;
    o[ARM_R + 3] = 1.8;
  } else {
    o[ARM_L] = 0.03 * Math.sin(c.t * 0.8 + s);
    o[ARM_R] = 0.03 * Math.sin(c.t * 0.8 + s + 1.3);
    o[ARM_L + 3] = 0.16 + 0.04 * Math.sin(c.t * 0.6 + s);
    o[ARM_R + 3] = 0.16 + 0.04 * Math.sin(c.t * 0.6 + s + 2);
  }
}

function idle(o: Float32Array, c: AnimCtx, style: IdleStyle = c.style): void {
  rest(o);
  const s = c.seed * 100;
  const t = c.t;
  // Respiración (~0,27 Hz): pecho y hombros.
  const br = Math.sin(t * 1.7 + s);
  o[LEAN] = 0.015 + 0.012 * br;
  // Cambio de peso de una pierna a la otra cada pocos segundos.
  const ws = smoothSign(Math.sin(t * (c.kid ? 1.1 : 0.62) + s * 3));
  o[PROLL] = 0.04 * ws;
  o[PTWIST] = 0.03 * ws;
  const rl = pos(ws);
  const rr = pos(-ws);
  o[LEG_L + 3] = 0.04 + 0.22 * rl;
  o[LEG_L] = 0.02 + 0.07 * rl;
  o[LEG_L + 1] = 0.035;
  o[LEG_R + 3] = 0.04 + 0.22 * rr;
  o[LEG_R] = 0.02 + 0.07 * rr;
  o[LEG_R + 1] = 0.035;
  // La mirada se queda un rato en un lado y cambia (no barre como un faro).
  o[HYAW] = 0.16 * Math.tanh(2.2 * Math.sin(t * 0.37 + s)) + 0.04 * Math.sin(t * 0.91 + s * 2);
  o[HPITCH] = 0.03 + 0.04 * Math.sin(t * 0.53 + s * 4);
  arms(o, c, style);
  o[ARM_L + 1] += 0.012 * br;
  o[ARM_R + 1] += 0.012 * br;
}

function walk(o: Float32Array, c: AnimCtx): void {
  rest(o);
  const a = c.amp;
  const ph = c.phase;
  const sp = Math.sin(ph);
  const cp = Math.cos(ph);
  o[LEG_L] = 0.4 * a * sp + 0.03;
  o[LEG_R] = -0.4 * a * sp + 0.03;
  // Rodilla: flexión máxima a mitad del vuelo, con el muslo ya pasando bajo
  // la cadera (≈ 60°), y una pequeña al recibir el peso. Con el pico antes
  // (muslo todavía atrás) el pie de atrás subía como pateando.
  const knee = (p: number) => 0.05 + a * (1.0 * Math.pow(pos(Math.cos(p + 0.12)), 2.2) + 0.16 * Math.pow(pos(Math.cos(p - 2.02)), 6));
  o[LEG_L + 3] = knee(ph);
  o[LEG_R + 3] = knee(ph + Math.PI);
  o[LEG_L + 1] = 0.02;
  o[LEG_R + 1] = 0.02;
  // Brazos en contrafase con la pierna del mismo lado; el codo se dobla al ir adelante.
  const swing = (c.kid ? 0.36 : 0.3) * a;
  o[ARM_L] = -swing * sp + 0.02;
  o[ARM_R] = swing * sp + 0.02;
  o[ARM_L + 3] = 0.2 + 0.2 * a + 0.4 * pos(o[ARM_L]);
  o[ARM_R + 3] = 0.2 + 0.2 * a + 0.4 * pos(o[ARM_R]);
  o[ARM_L + 1] = 0.1;
  o[ARM_R + 1] = 0.1;
  o[PTWIST] = 0.08 * a * sp;
  o[TWIST] = -0.13 * a * sp;
  o[PROLL] = -0.035 * a * cp;
  o[LEAN] = 0.03 + 0.04 * a;
  o[HPITCH] = 0.02;
  // La cabeza mira adelante aunque cadera y hombros se tuerzan con el paso.
  o[HYAW] = 0.06 * Math.sin(c.t * 0.4 + c.seed * 30) - 0.6 * (o[PTWIST] + o[TWIST]);
}

function run(o: Float32Array, c: AnimCtx): void {
  rest(o);
  const ph = c.phase;
  const sp = Math.sin(ph);
  // Muslo adelante más que atrás. Con ±0,72 las dos piernas quedaban rectas
  // y abiertas 80° y, con el pie de apoyo en el piso, la cadera bajaba: los
  // chicos corrían "en estocada".
  o[LEG_L] = 0.18 + 0.52 * sp;
  o[LEG_R] = 0.18 - 0.52 * sp;
  const knee = (p: number) => 0.3 + 1.5 * Math.pow(pos(Math.cos(p + 0.5)), 1.2) + 0.3 * Math.pow(pos(Math.cos(p - 2.0)), 4);
  o[LEG_L + 3] = knee(ph);
  o[LEG_R + 3] = knee(ph + Math.PI);
  o[ARM_L] = -0.7 * sp + 0.12;
  o[ARM_R] = 0.7 * sp + 0.12;
  o[ARM_L + 3] = 1.35 + 0.15 * sp;
  o[ARM_R + 3] = 1.35 - 0.15 * sp;
  o[ARM_L + 1] = 0.15;
  o[ARM_R + 1] = 0.15;
  o[ARM_L + 2] = 0.25;
  o[ARM_R + 2] = 0.25;
  o[LEAN] = 0.18;
  o[PTWIST] = 0.12 * sp;
  o[TWIST] = -0.2 * sp;
  o[PROLL] = -0.04 * Math.cos(ph);
  o[HPITCH] = -0.08;
  // Vuelo: entre un apoyo y el otro los dos pies están en el aire.
  o[BOUNCE] = 0.045 * Math.cos(ph) * Math.cos(ph);
}

/** Ruido suave de frecuencias propias para los gestos. */
function wob(t: number, s: number, f: number): number {
  return 0.6 * Math.sin(t * f + s * 7.1) + 0.4 * Math.sin(t * f * 2.13 + s * 3.7);
}

function talk(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  const t = c.t;
  const s = c.seed;
  // Mano dominante gesticulando; la otra acompaña a veces.
  o[ARM_R] = 0.32 + 0.18 * wob(t, s, 1.6);
  o[ARM_R + 1] = 0.16 + 0.08 * wob(t, s + 0.3, 1.2);
  o[ARM_R + 2] = 0.35;
  o[ARM_R + 3] = 1.2 + 0.32 * wob(t, s + 0.6, 2.1);
  const both = s > 0.45;
  if (both) {
    o[ARM_L] = 0.2 + 0.12 * wob(t, s + 0.9, 1.3);
    o[ARM_L + 2] = 0.3;
    o[ARM_L + 3] = 0.85 + 0.35 * wob(t, s + 1.2, 1.8);
  }
  // Énfasis: cada tanto, las dos manos se abren.
  const env = Math.pow(pos(Math.sin(t * 1.1 + s * 9)), 6);
  o[ARM_R + 1] += 0.32 * env;
  o[ARM_L + 1] += 0.28 * env;
  o[ARM_R + 3] -= 0.25 * env;
  o[HPITCH] = 0.02 + 0.05 * Math.sin(t * 3.1 + s * 4);
  o[HROLL] = 0.04 * Math.sin(t * 0.7 + s);
  o[TWIST] = 0.05 * Math.sin(t * 0.6 + s * 2);
}

function listen(o: Float32Array, c: AnimCtx): void {
  idle(o, c);
  const t = c.t;
  const s = c.seed * 20;
  // Asiente de a ratos y ladea la cabeza.
  o[HPITCH] += 0.13 * Math.pow(pos(Math.sin(t * 2.2 + s)), 8);
  o[HROLL] = 0.06 * Math.sin(t * 0.3 + s);
}

/** Piernas de sentado: muslos horizontales y rodilla según la altura del asiento. */
function sitLegs(o: Float32Array, c: AnimCtx): void {
  o[LEG_L] = c.hipFlex;
  o[LEG_R] = c.hipFlex;
  o[LEG_L + 1] = 0.1;
  o[LEG_R + 1] = 0.12;
  o[LEG_L + 2] = 0.04;
  o[LEG_R + 2] = 0.06;
  o[LEG_L + 3] = c.knee;
  o[LEG_R + 3] = c.knee + 0.06;
  if (c.dangle) {
    // Los chicos que no llegan al piso balancean las piernas.
    const env = pos(Math.sin(c.t * 0.35 + c.seed * 9));
    o[LEG_L + 3] += 0.28 * env * Math.sin(c.t * 2.6 + c.seed * 4);
    o[LEG_R + 3] += 0.28 * env * Math.sin(c.t * 2.6 + c.seed * 4 + 2.6);
  }
  o[SIT] = 1;
}

/**
 * Brazo apoyado en la mesa: el codo sobre la tapa (o colgando sobre ella, si
 * el hombro queda muy alto) y el antebrazo hacia adelante hasta tocarla.
 * Es una cinemática inversa plana (de perfil) con las medidas de cada uno:
 * con ángulos fijos, un chico de 1,30 m levantaba las manos a la cara y un
 * adulto las metía en la tapa. `lift` levanta el antebrazo desde el codo
 * (gesticular sin atravesar la mesa), `rot` junta las manos adelante y `abd`
 * abre los codos. Devuelve false si no hay mesa o si la mano no llega a su
 * borde (`deskZ`): ahí se usa la pose sin mesa.
 *
 * A un chico la mesa le queda a la altura del pecho y el brazo va casi
 * horizontal: ahí la rotación interna gira el antebrazo sobre su propio eje
 * (los dos brazos salían paralelos, "de zombi"); las manos se juntan
 * cerrando el brazo hacia adentro (abducción negativa).
 */
function deskArm(o: Float32Array, c: AnimCtx, a: number, lean: number, rot: number, abd: number, lift: number): boolean {
  if (Number.isNaN(c.deskH)) return false;
  const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));
  const sy = c.waist + c.shY * Math.cos(lean);
  // Codo: el radio del antebrazo y la manga por encima de la tapa.
  const ey = c.deskH + 0.055;
  const flat = Math.acos(clamp1((sy - ey) / c.l1));
  const k = Math.max(0, Math.min(1, (flat - 0.85) / 0.5));
  const ab = abd * (1 - k) - 0.55 * rot * k;
  const r = rot * (1 - 0.7 * k);
  // Con el brazo abierto (o cerrado) baja menos por cada grado de flexión.
  const t1 = Math.acos(clamp1((sy - ey) / (c.l1 * Math.cos(ab))));
  const eyAct = sy - c.l1 * Math.cos(ab) * Math.cos(t1);
  // Se apunta la PUNTA DE LOS DEDOS (≈ 1,66 antebrazos desde el codo) a 1,5 cm
  // sobre la tapa: apuntando la muñeca, la mano entera quedaba metida en la
  // mesa. La rotación interna r gira el plano del codo hacia el cuerpo y la
  // abducción inclina ese giro hacia abajo; con el orden del `Rig` (rotación,
  // abducción, flexión) la componente vertical del antebrazo con el codo
  // doblado e es −(A·cos e + B·sen e), y se despeja e de forma exacta (la
  // compensación aproximada dejaba los dedos de los grandes 2-4 cm adentro).
  const drop = eyAct - (c.deskH + 0.015);
  const ct = Math.cos(t1);
  const st = Math.sin(t1);
  const A = ct * Math.cos(ab);
  const B = Math.sin(r) * Math.sin(ab) * ct - Math.cos(r) * st;
  const e = Math.atan2(B, A) + Math.acos(clamp1(drop / (1.66 * c.l2 * Math.hypot(A, B))));
  // ¿Llega la palma (≈ 1,24 antebrazos) al borde de la mesa? Si no (mesa
  // lejos, o el brazo casi horizontal de un chico), no se finge: quedaban
  // brazos rígidos "de zombi" en el aire, 30 cm antes de la tapa. Quien llama
  // usa entonces la pose sin mesa.
  const fwd = Math.cos(e) * Math.cos(ab) * st + Math.sin(e) * (Math.sin(r) * Math.sin(ab) * st + Math.cos(r) * ct);
  const reach = c.shY * Math.sin(lean) + c.l1 * Math.cos(ab) * Math.sin(t1) + 1.24 * c.l2 * fwd;
  if (reach < c.deskZ + 0.03) return false;
  // El tronco inclinado λ lleva "abajo" del pecho hacia atrás: el brazo
  // necesita λ más de flexión para quedar a t1 de la vertical.
  o[a] = t1 + lean;
  o[a + 1] = ab;
  o[a + 2] = r;
  o[a + 3] = Math.max(0.05, e + lift);
  return true;
}

/**
 * Mano apoyada en el muslo: el brazo baja junto al tronco (`t1` desde la
 * vertical) y el antebrazo cae hasta la palma sobre el muslo, a `along` de
 * su largo (0,85 cerca de la rodilla, 1 sobre ella). Con ángulos fijos,
 * a un adulto el antebrazo le quedaba horizontal a la altura de la mesa,
 * "flotando" delante de ella; a un chico, metido en las piernas.
 */
function lapArm(o: Float32Array, c: AnimCtx, a: number, lean: number, t1: number, along: number, ab: number, r: number): void {
  const sy = c.waist + c.shY * Math.cos(lean);
  const ey = sy - c.l1 * Math.cos(ab) * Math.cos(t1);
  // Tapa del muslo bajo la palma, más el grosor de la mano.
  const drop = ey - (c.thighR - along * c.thigh * Math.cos(c.hipFlex) + 0.02);
  const ct = Math.cos(t1);
  const st = Math.sin(t1);
  const A = ct * Math.cos(ab);
  const B = Math.sin(r) * Math.sin(ab) * ct - Math.cos(r) * st;
  const e = Math.atan2(B, A) + Math.acos(Math.max(-1, Math.min(1, drop / (1.24 * c.l2 * Math.hypot(A, B)))));
  o[a] = t1 + lean;
  o[a + 1] = ab;
  o[a + 2] = r;
  o[a + 3] = Math.max(0.05, e);
}

function sit(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  sitLegs(o, c);
  o[PROLL] = 0;
  o[PTWIST] = 0;
  o[LEAN] = -0.04 + 0.01 * Math.sin(c.t * 1.7 + c.seed * 50);
  // Con mesa, los antebrazos descansan encima, cruzados adelante y apenas
  // inclinado (con las manos en el regazo bajo una tapa de 0,74 m, quedaban
  // metidas debajo de la mesa); sin mesa o si no llega, en los muslos.
  if (c.seed > 0.4 || !Number.isNaN(c.deskH)) {
    const lean = 0.08 + 0.01 * Math.sin(c.t * 1.7 + c.seed * 50);
    if (deskArm(o, c, ARM_L, lean, 0.78, 0.2, 0) && deskArm(o, c, ARM_R, lean, 0.72, 0.2, 0.04)) {
      o[LEAN] = lean;
      return;
    }
  }
  lapArm(o, c, ARM_L, o[LEAN], 0.32, 0.85, 0.12, 0.3);
  lapArm(o, c, ARM_R, o[LEAN], 0.3, 0.85, 0.12, 0.3);
}

function sitDesk(o: Float32Array, c: AnimCtx): void {
  sit(o, c);
  const t = c.t;
  const s = c.seed * 40;
  // Inclinado sobre el pupitre, escribiendo; de a ratos levanta la vista.
  // Con un umbral seco la cabeza y el tronco saltaban de una pose a la otra
  // en un cuadro: se pasa en ~1 s.
  const raw = Math.max(0, Math.min(1, (pos(Math.sin(t * 0.25 + s)) - 0.68) / 0.14));
  const up = raw * raw * (3 - 2 * raw);
  const lean = 0.24 - 0.12 * up;
  o[LEAN] = lean;
  o[HPITCH] = 0.42 - 0.38 * up;
  // Mano derecha escribiendo (el lápiz va y viene), la izquierda sujeta la hoja.
  if (deskArm(o, c, ARM_R, lean, 0.42 + 0.06 * Math.sin(t * 6.3 + s), 0.2 + 0.03 * Math.sin(t * 8 + s), 0.03 + 0.03 * Math.sin(t * 8 + s))) {
    if (!deskArm(o, c, ARM_L, lean, 0.66, 0.16, 0)) lapArm(o, c, ARM_L, lean, 0.4, 1.0, 0.1, 0.65);
    return;
  }
  // Sin mesa (o fuera de alcance): el cuaderno sobre las rodillas, la
  // derecha escribiendo y la izquierda sosteniéndolo.
  lapArm(o, c, ARM_R, lean, 0.42 + 0.03 * Math.sin(t * 6.3 + s), 1.0, 0.16 + 0.03 * Math.sin(t * 8 + s), 0.45);
  lapArm(o, c, ARM_L, lean, 0.4, 1.0, 0.1, 0.65);
}

function sitTalk(o: Float32Array, c: AnimCtx): void {
  sit(o, c);
  const t = c.t;
  const s = c.seed;
  o[HYAW] = (s > 0.5 ? 0.7 : -0.7) + 0.1 * Math.sin(t * 0.5);
  o[TWIST] = s > 0.5 ? 0.15 : -0.15;
  // Con mesa, el codo apoyado y la mano que acompaña lo que dice por encima
  // de la tapa; sin mesa, gesticula libre.
  const lean = 0.06;
  if (deskArm(o, c, ARM_L, lean, 0.7, 0.18, 0) && deskArm(o, c, ARM_R, lean, 0.35, 0.25 + 0.08 * wob(t, s, 1.5), 0.45 + 0.3 * wob(t, s + 0.4, 2.0))) {
    o[LEAN] = lean;
    return;
  }
  o[ARM_R] = 0.6 + 0.15 * wob(t, s, 1.5);
  o[ARM_R + 3] = 1.1 + 0.3 * wob(t, s + 0.4, 2.0);
}

function sitFloor(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  // Sentado en el piso con las rodillas arriba y los brazos alrededor (el
  // jardín en el acto). Con las piernas cruzadas, de lejos se leía "de
  // rodillas".
  o[LEG_L] = 2.0;
  o[LEG_R] = 1.96;
  o[LEG_L + 1] = 0.22;
  o[LEG_R + 1] = 0.26;
  o[LEG_L + 2] = 0.15;
  o[LEG_R + 2] = 0.18;
  o[LEG_L + 3] = 2.45;
  o[LEG_R + 3] = 2.4;
  o[PROLL] = 0;
  o[PTWIST] = 0;
  o[LEAN] = 0.2 + 0.02 * Math.sin(c.t * 1.7 + c.seed * 9);
  for (const a of [ARM_L, ARM_R]) {
    o[a] = 0.95;
    o[a + 1] = 0.12;
    o[a + 2] = 0.85;
    o[a + 3] = 1.25;
  }
  o[SIT] = 1;
}

function wave(o: Float32Array, c: AnimCtx): void {
  idle(o, c);
  const t = c.t;
  o[ARM_R] = 0.3;
  o[ARM_R + 1] = 2.5 + 0.18 * Math.sin(t * 15.5);
  o[ARM_R + 2] = 0.05;
  o[ARM_R + 3] = 0.45 + 0.18 * Math.sin(t * 15.5 + 1.2);
  o[HPITCH] = -0.04;
  o[HROLL] = 0.06;
}

function point(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  o[ARM_R] = 1.45;
  o[ARM_R + 1] = 0.14;
  o[ARM_R + 2] = 0.1;
  o[ARM_R + 3] = 0.05;
  o[LEAN] = 0.04;
}

function clap(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  // Las manos se abren y se juntan cerrando el brazo (abducción), sin girar
  // el antebrazo: con la rotación interna se cruzaban una dentro de la otra
  // en cada golpe y en los grandes nunca llegaban a separarse. Medido con el
  // esqueleto: se abren 17-24 cm y al juntarse se tocan (≤ 4 cm de cruce).
  const k = Math.sin(c.t * (14 + 4 * c.seed) + c.seed * 6);
  for (const a of [ARM_L, ARM_R]) {
    o[a] = 0.9;
    o[a + 1] = -0.03 + 0.17 * k;
    o[a + 2] = 0.3;
    o[a + 3] = 1.0;
  }
  o[HPITCH] = -0.03;
}

function write(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  const t = c.t;
  const s = c.seed * 30;
  // De cara al pizarrón: la mano derecha arriba, escribiendo en renglones.
  o[ARM_R] = 1.78 + 0.12 * Math.sin(t * 0.9 + s) + 0.03 * Math.sin(t * 7.3);
  o[ARM_R + 1] = 0.32 + 0.16 * Math.sin(t * 0.55 + s) + 0.04 * Math.sin(t * 9.1);
  o[ARM_R + 2] = 0.1;
  o[ARM_R + 3] = 0.62 + 0.12 * Math.sin(t * 3.7 + s);
  // La izquierda sostiene un libro.
  o[ARM_L] = 0.3;
  o[ARM_L + 2] = 0.65;
  o[ARM_L + 3] = 1.05;
  o[HPITCH] = -0.14;
  o[HYAW] = 0.08 * Math.sin(t * 0.55 + s);
}

function lookAround(o: Float32Array, c: AnimCtx): void {
  idle(o, c);
  const t = c.t;
  const s = c.seed * 60;
  // Mira a un lado, se queda, mira al otro: la mirada hace pausas.
  const raw = Math.sin(t * 0.55 + s);
  const yaw = 0.95 * Math.tanh(raw * 2.2);
  o[HYAW] = yaw;
  o[TWIST] = 0.22 * yaw;
  o[HPITCH] = -0.04 + 0.07 * Math.sin(t * 0.4 + s);
}

function mop(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  const sw = Math.sin(c.t * 3.4 + c.seed * 9);
  o[LEAN] = 0.2;
  o[TWIST] = 0.3 * sw;
  o[PTWIST] = -0.07 * sw;
  o[ARM_R] = 0.55 + 0.08 * sw;
  o[ARM_R + 1] = 0.1;
  o[ARM_R + 2] = 0.55;
  o[ARM_R + 3] = 0.7;
  o[ARM_L] = 0.95 - 0.06 * sw;
  o[ARM_L + 1] = 0.05;
  o[ARM_L + 2] = 0.75;
  o[ARM_L + 3] = 0.55;
  o[LEG_L + 1] = 0.09;
  o[LEG_R + 1] = 0.09;
  o[LEG_L + 3] = 0.14;
  o[LEG_R + 3] = 0.14;
  o[HPITCH] = 0.25;
}

function serve(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  const t = c.t;
  const s = c.seed;
  // Detrás del mostrador: manos a la altura de la línea, alcanza cosas.
  const reach = pos(Math.sin(t * 0.8 + s * 11));
  o[ARM_R] = 0.65 + 0.45 * reach;
  o[ARM_R + 2] = 0.4;
  o[ARM_R + 3] = 1.0 - 0.5 * reach;
  o[ARM_L] = 0.55;
  o[ARM_L + 2] = 0.5;
  o[ARM_L + 3] = 1.1 + 0.2 * wob(t, s, 1.4);
  o[LEAN] = 0.08 + 0.1 * reach;
  o[HPITCH] = 0.12;
}

function nod(o: Float32Array, c: AnimCtx): void {
  listen(o, c);
}

/**
 * Mirar el teléfono: la mano derecha a la altura del pecho, el antebrazo
 * apenas sobre la horizontal y la cabeza gacha. No hay pieza de teléfono (una
 * malla más sería otro draw call): la postura sola se lee igual, sobre todo
 * desde unos metros, que es como se ve en la vereda.
 */
function phone(o: Float32Array, c: AnimCtx): void {
  idle(o, c, 0);
  const t = c.t;
  const s = c.seed * 40;
  o[ARM_R] = 0.38 + 0.03 * Math.sin(t * 0.7 + s);
  o[ARM_R + 1] = 0.06;
  o[ARM_R + 2] = 0.32;
  o[ARM_R + 3] = 1.55 + 0.04 * Math.sin(t * 1.3 + s);
  o[HPITCH] = 0.52;
  o[HYAW] = 0.06 * Math.sin(t * 0.5 + s);
}

const CLIPS: Record<AnimId, (o: Float32Array, c: AnimCtx) => void> = {
  idle,
  walk,
  run,
  talk,
  listen,
  sit,
  wave,
  point,
  lookAround,
  clap,
  write,
  mop,
  serve,
  sitDesk,
  sitTalk,
  sitFloor,
  nod,
  phone,
};

/** Animaciones que son de estar sentado. */
export const SEATED: ReadonlySet<AnimId> = new Set<AnimId>(['sit', 'sitDesk', 'sitTalk', 'sitFloor']);
/** Gestos que se superponen al torso (saludar caminando, aplaudir sentado…). */
export const GESTURES: ReadonlySet<AnimId> = new Set<AnimId>(['wave', 'point', 'clap', 'nod', 'phone']);
/** Duración de un gesto de una vez (s). */
export const GESTURE_TIME: Partial<Record<AnimId, number>> = { wave: 1.9, point: 1.6, clap: 2.6, nod: 0.8 };

/** Estado de animación de una persona. */
export interface AnimState {
  base: AnimId;
  prev: AnimId;
  /** Peso de la base respecto de la anterior (0 → 1 durante el fundido). */
  w: number;
  t: number;
  prevT: number;
  /** Ciclo de locomoción (rad) y su amplitud/mezcla de carrera actuales. */
  phase: number;
  amp: number;
  run: number;
  gesture: AnimId | null;
  gT: number;
  gW: number;
  /** Duración del gesto en curso si no es la de siempre (0 = `GESTURE_TIME`). */
  gDur: number;
  /** Mirada aditiva (rad) y su peso. */
  lookYaw: number;
  lookPitch: number;
  lookW: number;
  seed: number;
  style: IdleStyle;
  kid: boolean;
  hipFlex: number;
  knee: number;
  dangle: boolean;
  deskH: number;
  deskZ: number;
  waist: number;
  shY: number;
  l1: number;
  l2: number;
  thigh: number;
  thighR: number;
}

export function newAnimState(seed: number, style: IdleStyle, kid: boolean): AnimState {
  return {
    base: 'idle',
    prev: 'idle',
    w: 1,
    t: seed * 40,
    prevT: 0,
    phase: seed * Math.PI * 2,
    amp: 0,
    run: 0,
    gesture: null,
    gT: 0,
    gW: 0,
    gDur: 0,
    lookYaw: 0,
    lookPitch: 0,
    lookW: 0,
    seed,
    style,
    kid,
    hipFlex: 1.4,
    knee: 1.4,
    dangle: false,
    deskH: NaN,
    deskZ: 0,
    // Adulto de referencia (`Looks.REF`); `Agent` pone las de cada uno.
    waist: 0.1,
    shY: 0.358,
    l1: 0.29,
    l2: 0.245,
    thigh: 0.44,
    thighR: 0.08,
  };
}

/** Cambia la animación de base con fundido cruzado. */
export function setBase(a: AnimState, id: AnimId): void {
  if (a.base === id) return;
  a.prev = a.base;
  a.prevT = a.t;
  a.base = id;
  a.w = 0;
  // Las de estar quietas arrancan en un punto distinto de su ciclo para que
  // un grupo que se sienta a la vez no respire al unísono.
  a.t = a.seed * 37;
}

/** Lanza un gesto de una vez sobre lo que se esté haciendo. */
export function startGesture(a: AnimState, id: AnimId, dur = 0): void {
  a.gesture = id;
  a.gT = 0;
  a.gDur = dur;
}

/** Avanza relojes, fundidos y envolventes. */
export function tickAnim(a: AnimState, dt: number): void {
  a.t += dt;
  a.prevT += dt;
  if (a.w < 1) a.w = Math.min(1, a.w + dt / (SEATED.has(a.base) !== SEATED.has(a.prev) ? 0.8 : 0.35));
  if (a.gesture) {
    a.gT += dt;
    const dur = a.gDur > 0 ? a.gDur : (GESTURE_TIME[a.gesture] ?? 1.5);
    // Envolvente: entra en 0,25 s, se sostiene y sale en 0,35 s.
    a.gW = Math.min(1, a.gT / 0.25) * Math.min(1, Math.max(0, (dur - a.gT) / 0.35));
    if (a.gT >= dur) {
      a.gesture = null;
      a.gW = 0;
      a.gDur = 0;
    }
  }
}

const tmpA = new Float32Array(POSE_N);
const tmpB = new Float32Array(POSE_N);
const tmpG = new Float32Array(POSE_N);
const ease = (x: number) => x * x * (3 - 2 * x);

/** Contexto compartido: se rellena en cada evaluación (cientos por cuadro, sin crear objetos). */
const sharedCtx: AnimCtx = {
  t: 0,
  seed: 0,
  style: 0,
  amp: 0,
  phase: 0,
  run: 0,
  hipFlex: 1.4,
  knee: 1.4,
  dangle: false,
  kid: false,
  deskH: NaN,
  deskZ: 0,
  waist: 0.1,
  shY: 0.358,
  l1: 0.29,
  l2: 0.245,
  thigh: 0.44,
  thighR: 0.08,
};

function ctxOf(a: AnimState, t: number): AnimCtx {
  const c = sharedCtx;
  c.t = t;
  c.seed = a.seed;
  c.style = a.style;
  c.amp = a.amp;
  c.phase = a.phase;
  c.run = a.run;
  c.hipFlex = a.hipFlex;
  c.knee = a.knee;
  c.dangle = a.dangle;
  c.kid = a.kid;
  c.deskH = a.deskH;
  c.deskZ = a.deskZ;
  c.waist = a.waist;
  c.shY = a.shY;
  c.l1 = a.l1;
  c.l2 = a.l2;
  c.thigh = a.thigh;
  c.thighR = a.thighR;
  return c;
}

function evalClip(id: AnimId, a: AnimState, t: number, out: Float32Array): void {
  if (id === 'walk' || id === 'run') {
    // Locomoción: mezcla caminata/carrera según la velocidad.
    const c = ctxOf(a, t);
    if (a.run <= 0.001) walk(out, c);
    else if (a.run >= 0.999) run(out, c);
    else {
      walk(out, c);
      run(tmpG, c);
      for (let i = 0; i < POSE_N; i++) out[i] += (tmpG[i] - out[i]) * a.run;
    }
    if (a.amp < 0.999) {
      // Arrancando o frenando: se funde con la pose quieta.
      idle(tmpG, c);
      const k = ease(Math.min(1, a.amp / 0.6));
      for (let i = 0; i < POSE_N; i++) out[i] = tmpG[i] + (out[i] - tmpG[i]) * k;
    }
    return;
  }
  CLIPS[id](out, ctxOf(a, t));
}

/** Pose final de la persona: base con fundido, gesto y mirada. */
export function evalPose(a: AnimState, out: Float32Array): void {
  evalClip(a.base, a, a.t, out);
  if (a.w < 1) {
    evalClip(a.prev, a, a.prevT, tmpA);
    const k = ease(a.w);
    for (let i = 0; i < POSE_N; i++) out[i] = tmpA[i] + (out[i] - tmpA[i]) * k;
  }
  if (a.gesture && a.gW > 0) {
    // El gesto se evalúa sobre la pose actual para no perder lo de abajo
    // (piernas sentadas, paso): sólo pisa torso, cabeza y brazos.
    const k = ease(a.gW);
    if (a.gesture === 'nod') {
      // Asentir: un cabeceo hacia abajo y de vuelta, sumado a lo que haya.
      out[HPITCH] += 0.24 * Math.sin(Math.min(1, a.gT / 0.6) * Math.PI);
    } else {
      CLIPS[a.gesture](tmpB, ctxOf(a, a.gT));
      for (const i of UPPER) {
        if (i === LEAN && SEATED.has(a.base)) continue;
        out[i] += (tmpB[i] - out[i]) * k;
      }
    }
  }
  if (a.lookW > 0) {
    // Mirada: hasta ~1 rad de cuello y el resto (poco) de torso.
    const yaw = a.lookYaw * a.lookW;
    const neck = Math.max(-1.05, Math.min(1.05, yaw));
    out[HYAW] = out[HYAW] * (1 - a.lookW) + neck;
    out[TWIST] += (yaw - neck) * 0.8;
    out[HPITCH] = out[HPITCH] * (1 - a.lookW) + a.lookPitch * a.lookW;
  }
}
