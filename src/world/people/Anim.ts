import type { NpcAnim } from '../../game/contracts';
import { REF, type AgeGroup, type BodyDims, type IdleStyle } from './Looks';

/**
 * Animación procedural de las personas.
 *
 * Nada de clips grabados: cada animación es una función del tiempo que
 * devuelve ángulos de articulación (los "canales" de la pose). Así cada
 * persona tiene su propio ritmo (semilla), la caminata se ajusta a la
 * velocidad real y cambiar de estado es mezclar dos poses durante un instante.
 *
 * La marcha (`gait`) no es una onda: se escribe dónde va cada PIE y se
 * despeja el ángulo de cadera (cinemática inversa plana con la rodilla y el
 * tobillo). Mientras un pie está apoyado retrocede respecto de la cadera en
 * línea recta y exactamente a la velocidad del cuerpo, así que en el mundo
 * queda quieto; el ciclo avanza con la distancia recorrida (`stepGait`) y el
 * largo del paso y la cadencia crecen con la velocidad, como en la gente
 * (chicos: pasos cortos y rápidos). Con las ondas de antes el pie apoyado
 * patinaba al 60-90 % de la velocidad del cuerpo.
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
/** Tobillos: flexión del pie respecto de la pierna (positiva: punta arriba). */
export const ANK_L = 26;
export const ANK_R = 27;
/** Corrimiento lateral de la pelvis hacia +X (sobre la pierna que carga), × legS. */
export const SWAY = 28;
export const POSE_N = 29;

/** Canales que un gesto puede pisar (torso, cabeza y brazos). */
const UPPER: readonly number[] = [LEAN, TWIST, HYAW, HPITCH, HROLL, 8, 9, 10, 11, 12, 13, 14, 15];

export interface AnimCtx {
  /** Tiempo del clip (s). */
  t: number;
  /** Semilla de la persona (0..1): fases y frecuencias propias. */
  seed: number;
  style: IdleStyle;
  /** Locomoción: amplitud (0..1,15), fase del ciclo (rad) y mezcla con la carrera. */
  amp: number;
  phase: number;
  run: number;
  /** Cuánto del paso es avance (0 = pasitos en el lugar para girar). */
  fwd: number;
  /** Aceleración (m/s²) e inclinación hacia adentro de la curva (rad). */
  accel: number;
  bank: number;
  /** Estilo de marcha: largo de paso, levantar los pies, braceo e inclinación extra. */
  strideK: number;
  liftK: number;
  armK: number;
  leanK: number;
  /** Media cadera (eje de la pierna) y talón/punta del zapato, × legS. */
  hipXn: number;
  heelN: number;
  toeN: number;
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
const clampN = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const TAU = Math.PI * 2;
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Pierna en unidades de `legS` (ver `Looks.REF`): cadera → rodilla, rodilla →
// tobillo, tobillo → suela; cadera → suela con la pierna estirada y el pie plano.
const TH = REF.thigh;
const SH = REF.ankle;
const SOLE = REF.sole;
const LEG = REF.thigh + REF.shin;
/** Alto de pierna "de trabajo" para compensar corrimientos laterales con la abducción. */
const LEG_V = 0.9;

function rest(o: Float32Array): void {
  o.fill(0);
  o[ARM_L + 1] = 0.09;
  o[ARM_R + 1] = 0.09;
  o[ARM_L + 3] = 0.14;
  o[ARM_R + 3] = 0.14;
}

/**
 * Pone una pierna con el tobillo a `x` (× legS) delante de la cadera, la
 * rodilla doblada `knee` y el pie inclinado `toeDown` respecto del piso
 * (0 = plano, positivo = talón levantado). Despeja la flexión de cadera de
 * forma exacta: muslo y pierna forman un solo segmento de largo R(rodilla)
 * girado δ. Descuenta lo que la torsión de la pelvis adelanta o atrasa la
 * articulación de esa cadera, para que el pie apoyado no se corra con ella.
 */
function placeLeg(o: Float32Array, c: AnimCtx, right: boolean, x: number, knee: number, toeDown: number): void {
  const tw = o[PTWIST];
  const side = right ? 1 : -1;
  // Girar la pelvis θ lleva la cadera derecha (+X) hacia atrás: z = −side·hipX·sen θ.
  const hz = -side * c.hipXn * Math.sin(tw);
  const xl = (x - hz) / Math.cos(tw);
  const ck = Math.cos(knee);
  const R = Math.sqrt(TH * TH + SH * SH + 2 * TH * SH * ck);
  const th = Math.atan2(SH * Math.sin(knee), TH + SH * ck) + Math.asin(clampN(xl / R, -0.97, 0.97));
  const L = right ? LEG_R : LEG_L;
  o[L] = th;
  o[L + 3] = knee;
  // La pierna barre en el plano de la pelvis girada: el pie se correría de
  // costado (xl·sen θ) y apuntaría girado. La abducción y el giro de la
  // pierna sobre su eje lo devuelven (`legsApart` suma lo suyo encima).
  o[L + 1] = (-side * xl * Math.sin(tw)) / LEG_V;
  o[L + 2] = 0;
  // El pie, respecto de la pierna (que está girada θ − rodilla hacia adelante).
  o[right ? ANK_R : ANK_L] = -toeDown - (th - knee);
}

/** Rodilla que deja el tobillo a `x` adelante y `depth` debajo de la cadera (× legS). */
function kneeFor(x: number, depth: number): number {
  const c = (x * x + depth * depth - TH * TH - SH * SH) / (2 * TH * SH);
  return Math.acos(clampN(c, -1, 1));
}

/** Profundidad del punto de apoyo (talón o punta `pz`) bajo la cadera. */
function contactDepth(x: number, knee: number, phi: number, pz: number): number {
  const R2 = TH * TH + SH * SH + 2 * TH * SH * Math.cos(knee);
  return Math.sqrt(Math.max(0, R2 - x * x)) + SOLE * Math.cos(phi) + pz * Math.sin(phi);
}

/**
 * Abducción de las dos piernas que deja los pies donde estaban aunque la
 * pelvis se corra de costado (`SWAY`) o se incline (`roll`, la parte del
 * rolido que no es inclinarse en una curva).
 */
function legsApart(o: Float32Array, base: number, roll: number): void {
  const s = o[SWAY] / LEG_V;
  o[LEG_L + 1] += base + s - roll;
  o[LEG_R + 1] += base - s + roll;
}

/** Pies planos con las piernas como estén (sentados, de rodillas…). */
function flatFeet(o: Float32Array): void {
  o[ANK_L] = -(o[LEG_L] - o[LEG_L + 3]);
  o[ANK_R] = -(o[LEG_R] - o[LEG_R + 3]);
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
    // Sueltos: siguen al tronco con atraso (el balanceo del peso los mece).
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
  // Respiración (~0,27 Hz; los chicos, más rápido): pecho y hombros.
  const br = Math.sin(t * (c.kid ? 2.3 : 1.7) + s);
  o[LEAN] = 0.015 + 0.012 * br + c.leanK * 0.5;
  // Cambio de peso de una pierna a la otra cada pocos segundos, con un ritmo
  // propio (con el mismo período, una fila entera se balanceaba a la par) y
  // pausas irregulares (dos senos de frecuencias no múltiplos).
  const f = c.kid ? 1.1 : 0.42 + 0.3 * ((c.seed * 7.31) % 1);
  const ws = smoothSign(Math.sin(t * f + s * 3) + 0.4 * Math.sin(t * f * 2.71 + s));
  // ws > 0: el peso en la derecha. La pelvis se corre sobre ella y baja del
  // lado de la pierna floja (contrapposto); la floja dobla la rodilla y
  // levanta apenas el talón. Los pies NO se mueven: antes la pierna floja
  // arrastraba el pie 4 cm cada vez que cambiaba el peso.
  o[SWAY] = 0.03 * ws;
  o[PROLL] = -0.04 * ws;
  o[PTWIST] = 0.025 * ws;
  o[ROLL] = 0.025 * ws;
  const rl = pos(ws);
  const rr = pos(-ws);
  // Un pie apenas adelante del otro, propio de cada uno.
  const st = (c.seed > 0.5 ? 1 : -1) * (0.015 + 0.03 * ((c.seed * 3.7) % 1));
  placeLeg(o, c, false, 0.012 + st, 0.04 + 0.32 * rl, 0.12 * rl);
  placeLeg(o, c, true, 0.012 - st, 0.04 + 0.32 * rr, 0.12 * rr);
  legsApart(o, 0.035, o[PROLL]);
  // La mirada se queda un rato en un lado y cambia (no barre como un faro).
  o[HYAW] = 0.16 * Math.tanh(2.2 * Math.sin(t * 0.37 + s)) + 0.04 * Math.sin(t * 0.91 + s * 2) - o[PTWIST];
  o[HPITCH] = 0.03 + 0.04 * Math.sin(t * 0.53 + s * 4);
  o[HROLL] = -0.6 * o[ROLL];
  arms(o, c, style);
  o[ARM_L + 1] += 0.012 * br;
  o[ARM_R + 1] += 0.012 * br;
  // Los brazos sueltos cuelgan: el tronco inclinado los deja a plomo.
  if (style === 0) {
    o[ARM_L + 1] += o[ROLL];
    o[ARM_R + 1] -= o[ROLL];
  }
}

/**
 * Sentado con el pie plano: ángulo de la pierna respecto de la vertical que
 * deja la suela `drop` metros debajo de la rodilla (tobillo + talón).
 */
export function sitKnee(drop: number, legS: number): number {
  return Math.acos(clampN((drop / legS - SOLE) / SH, 0, 1));
}

/** Fracción del ciclo con cada pie apoyado: caminando hay doble apoyo; corriendo, vuelo. */
const betaOf = (run: number) => 0.62 - 0.26 * run;

/**
 * Largo de una zancada (dos pasos, × legS) con la amplitud y la carrera del
 * momento. Lo usan la pose (cuánto retrocede el pie apoyado) y `stepGait`
 * (cuánto avanza el ciclo por metro): por eso el pie no patina.
 */
export function strideOf(a: { amp: number; run: number; strideK: number }): number {
  const amp = clampN(a.amp, 0.15, 1.15);
  return LEG * a.strideK * ((1 - a.run) * 1.66 * amp + a.run * 2.6);
}

const P = {
  beta: 0,
  A: 0,
  x0: 0,
  k0: 0,
  /** Altura máxima del pie en el aire (× legS). */
  lift: 0,
  phiStrike: 0,
  phiOff: 0,
  /** Altura de la cadera (profundidad del apoyo bajo ella, × legS): al pisar, en el medio del apoyo, y su mezcla. */
  hw0: 0,
  hwm: 0,
  hr0: 0,
  hrm: 0,
  r: 0,
};

/** Pie apoyado en el punto `s` (0..1) de su apoyo: tobillo, inclinación y el punto que toca. */
function stanceFoot(s: number): void {
  const x = P.x0 + P.A * (1 - 2 * s);
  const phi = s < 0.14 ? P.phiStrike * (1 - smooth01(s / 0.14)) : P.phiOff * Math.pow(smooth01((s - 0.5) / 0.5), 1.6);
  F.phi = phi;
  F.pz = phi > 0 ? F.toe : F.heel;
  // El punto que toca (la punta si el talón está arriba, el talón si la punta
  // está arriba) sigue la recta del apoyo: se corrige dónde va el tobillo.
  F.x = x + F.pz * (1 - Math.cos(phi)) + SOLE * Math.sin(phi);
}
const F: { x: number; phi: number; pz: number; toe: number; heel: number } = { x: 0, phi: 0, pz: 0, toe: REF.toe, heel: REF.heel };

/**
 * Altura de la cadera a lo largo del paso (`h`, 0..0,5): la más baja al
 * pisar, con las piernas abiertas, y la más alta en el medio del apoyo (el
 * péndulo invertido de la marcha). Corriendo, se hunde a mitad del apoyo.
 */
function hipDepth(h: number): number {
  const sw = Math.sin(TAU * h);
  const walk = P.hw0 + (P.hwm - P.hw0) * sw * sw;
  if (P.r <= 0.001) return walk;
  const run = h < P.beta ? P.hr0 + (P.hrm - P.hr0) * Math.sin((Math.PI * h) / P.beta) : P.hr0;
  return walk + (run - walk) * P.r;
}

/** Rodilla que deja el punto más bajo del pie `clear` sobre el piso, con la cadera a la altura del paso. */
function legKnee(u: number, clear: number): number {
  const ad = hipDepth(u % 0.5) - clear - (SOLE * Math.cos(F.phi) + F.pz * Math.sin(F.phi));
  return clampN(kneeFor(F.x, ad), 0.02, 2.4);
}

/**
 * Una pierna en el punto `u` (0..1) de su ciclo: 0 es el talón que pisa,
 * `beta` el despegue. Apoyada, el tobillo retrocede en línea recta de x0+A a
 * x0−A (el pie plano; al final el talón se levanta girando sobre la punta,
 * que es la que queda quieta) y la rodilla es la que deja el pie en el piso
 * con la cadera a la altura del paso: en el doble apoyo, los dos pies tocan.
 * En el aire vuelve con una curva de Hermite que arranca y llega a la misma
 * velocidad que el apoyo (sin tirones al despegar ni al pisar), doblando la
 * rodilla para no arrastrar la punta.
 */
function legCycle(o: Float32Array, c: AnimCtx, right: boolean, u: number): void {
  let knee: number;
  if (u < P.beta) {
    stanceFoot(u / P.beta);
    knee = legKnee(u, 0);
  } else {
    const s = (u - P.beta) / (1 - P.beta);
    const m = (-2 * P.A * (1 - P.beta)) / P.beta;
    const s2 = s * s;
    const s3 = s2 * s;
    const x = (2 * s3 - 3 * s2 + 1) * (P.x0 - P.A) + (s3 - 2 * s2 + s) * m + (-2 * s3 + 3 * s2) * (P.x0 + P.A) + (s3 - s2) * m;
    const phi = P.phiOff + (P.phiStrike - P.phiOff) * smooth01(s / 0.8);
    F.phi = phi;
    F.pz = phi > 0 ? F.toe : F.heel;
    F.x = x + F.pz * (1 - Math.cos(phi)) + SOLE * Math.sin(phi);
    // El pie sube enseguida al despegar y baja recién al final, a pisar con
    // el talón: la altura se diseña y la rodilla sale de ella.
    knee = legKnee(u, P.lift * Math.sin(Math.PI * Math.pow(s, 0.8)));
  }
  placeLeg(o, c, right, F.x, knee, F.phi);
}

/** Caminata y carrera (mezcladas por `run`), con la amplitud del momento. */
function gait(o: Float32Array, c: AnimCtx): void {
  rest(o);
  const r = c.run;
  const w = 1 - r;
  const a = clampN(c.amp, 0, 1.15);
  const lk = c.liftK;
  const ph = c.phase;
  const sp = Math.sin(ph);
  const cp = Math.cos(ph);
  P.beta = betaOf(r);
  P.r = r;
  P.A = ((P.beta * strideOf(c)) / 2) * c.fwd * Math.min(1, a / 0.15);
  P.x0 = 0.02 * w - 0.04 * r;
  P.k0 = 0.05 * w + 0.32 * r;
  P.lift = 0.075 * Math.min(1, a) * lk * w + 0.3 * r;
  P.phiStrike = -0.18 * a * w - 0.04 * r;
  P.phiOff = 0.55 * a * w + 0.8 * r;
  F.toe = c.toeN;
  F.heel = c.heelN;
  // Alturas de cadera: al pisar, con la rodilla casi estirada; en el medio
  // del apoyo, con la rodilla apenas flexionada (más al ir más rápido).
  stanceFoot(0);
  const hs = contactDepth(F.x, P.k0, F.phi, F.pz);
  P.hw0 = hs;
  P.hr0 = hs;
  stanceFoot(0.25 / P.beta);
  P.hwm = Math.max(hs, contactDepth(F.x, 0.06 + 0.1 * a, F.phi, F.pz));
  stanceFoot(0.5);
  P.hrm = contactDepth(F.x, 0.7, F.phi, F.pz);

  // Pelvis: la cadera de la pierna que va adelante también se adelanta
  // (torsión), baja la del lado que va en el aire y se corre sobre el pie
  // apoyado. Izquierda apoyada en la primera mitad del ciclo.
  const f = c.fwd;
  o[PTWIST] = (0.07 * a * w + 0.1 * r) * f * cp;
  const roll = (0.045 * a * w + 0.03 * r) * sp;
  o[PROLL] = roll + c.bank;
  o[SWAY] = -(0.022 * a * w + 0.01 * r) * sp;
  legCycle(o, c, false, ph / TAU);
  legCycle(o, c, true, (ph / TAU + 0.5) % 1);
  legsApart(o, 0.015 * w + 0.03 * r, roll);
  // Corriendo, entre un apoyo y el otro los dos pies están en el aire.
  if (r > 0.001 && P.beta < 0.5) {
    const h = (ph / TAU) % 0.5;
    if (h > P.beta) o[BOUNCE] = 0.04 * r * Math.sin((Math.PI * (h - P.beta)) / (0.5 - P.beta));
  }
  // Brazos en contrafase con la pierna del mismo lado (apenas atrasados, son
  // péndulos); el codo se dobla al ir adelante. Corriendo, codos a 80°.
  const swing = (c.kid ? 0.36 : 0.3) * c.armK * a * Math.sqrt(f);
  const ca = Math.cos(ph - 0.3);
  const armL = w * (-swing * ca + 0.02) + r * (0.12 - 0.7 * ca);
  const armR = w * (swing * ca + 0.02) + r * (0.12 + 0.7 * ca);
  o[ARM_L] = armL;
  o[ARM_R] = armR;
  o[ARM_L + 3] = w * (0.2 + 0.2 * a + 0.4 * pos(armL)) + r * (1.35 + 0.15 * ca);
  o[ARM_R + 3] = w * (0.2 + 0.2 * a + 0.4 * pos(armR)) + r * (1.35 - 0.15 * ca);
  o[ARM_L + 1] = 0.1 * w + 0.15 * r;
  o[ARM_R + 1] = 0.1 * w + 0.15 * r;
  o[ARM_L + 2] = 0.25 * r;
  o[ARM_R + 2] = 0.25 * r;
  // Hombros en contrafase con la pelvis; la cabeza sigue mirando adelante.
  o[TWIST] = -(o[PTWIST] + (0.1 * a * w + 0.12 * r) * f * cp);
  o[ROLL] = -0.5 * roll;
  // Inclinado hacia adelante al acelerar y hacia atrás al frenar.
  o[LEAN] = (0.03 + 0.04 * a) * w + 0.17 * r + c.leanK + clampN(c.accel * 0.035, -0.07, 0.09);
  o[HPITCH] = 0.02 * w - 0.06 * r;
  o[HYAW] = 0.06 * w * Math.sin(c.t * 0.4 + c.seed * 30) - (o[PTWIST] + o[TWIST]);
  o[HROLL] = -0.4 * c.bank;
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
    // Pie colgando: la punta cae un poco respecto de la pierna.
    o[ANK_L] = -0.3;
    o[ANK_R] = -0.3;
  } else flatFeet(o);
  o[SWAY] = 0;
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
  o[ROLL] = 0;
  o[HROLL] *= 0.5;
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
  flatFeet(o);
  o[SWAY] = 0;
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
  // Codo al costado, a la altura del hombro, y el antebrazo para arriba; la
  // mano va y viene girando el brazo sobre su eje (pose hallada con el
  // esqueleto: con el brazo estirado arriba parecía pedir la palabra). Los
  // chicos, con más ganas.
  const f = c.kid ? 15 : 12.5;
  const k = c.kid ? 0.48 : 0.36;
  o[ARM_R] = 1.15;
  o[ARM_R + 1] = 1.1;
  o[ARM_R + 2] = -0.3 + k * Math.sin(t * f);
  o[ARM_R + 3] = 1.6 + 0.08 * Math.sin(t * f + 1.2);
  o[TWIST] += 0.05;
  o[HPITCH] = -0.04;
  o[HROLL] = 0.06 + 0.02 * Math.sin(t * f * 0.5);
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
  // Piernas algo abiertas y flojas, un pie adelante: la base para el vaivén.
  o[SWAY] = 0;
  o[PROLL] = 0;
  o[PTWIST] = 0;
  placeLeg(o, c, false, 0.08, 0.14, 0);
  placeLeg(o, c, true, -0.06, 0.14, 0);
  o[LEG_L + 1] = 0.09;
  o[LEG_R + 1] = 0.09;
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
  walk: gait,
  run: gait,
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
  /** Cuánto del paso es avance (0 = pasitos en el lugar para girar). */
  fwd: number;
  /** Aceleración suavizada (m/s²), velocidad anterior e inclinación en la curva. */
  accel: number;
  lastSpeed: number;
  bank: number;
  gesture: AnimId | null;
  gT: number;
  gW: number;
  /** Duración del gesto en curso si no es la de siempre (0 = `GESTURE_TIME`). */
  gDur: number;
  /** Mirada aditiva (rad), su velocidad (resorte), la parte del tronco y su peso. */
  lookYaw: number;
  lookPitch: number;
  lookYawV: number;
  lookPitchV: number;
  lookTorso: number;
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
  /** Media cadera, talón y punta en unidades de pierna (ver `setAnimBody`). */
  hipXn: number;
  heelN: number;
  toeN: number;
  /** Estilo de marcha (edad y persona). */
  strideK: number;
  liftK: number;
  armK: number;
  leanK: number;
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
    fwd: 1,
    accel: 0,
    lastSpeed: 0,
    bank: 0,
    gesture: null,
    gT: 0,
    gW: 0,
    gDur: 0,
    lookYaw: 0,
    lookPitch: 0,
    lookYawV: 0,
    lookPitchV: 0,
    lookTorso: 0,
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
    hipXn: REF.hipX,
    heelN: REF.heel,
    toeN: REF.toe,
    strideK: 1,
    liftK: 1,
    armK: 1,
    leanK: 0,
  };
}

/**
 * Medidas del cuerpo y estilo de marcha de una persona. Por edad: los chicos
 * de jardín levantan más las rodillas y bracean más (pasos cortos y
 * rápidos salen solos: la pierna es corta); los mayores, paso más corto,
 * poco braceo y algo encorvados. Cada uno, además, con lo suyo (semilla).
 */
export function setAnimBody(an: AnimState, d: BodyDims, age: AgeGroup): void {
  an.waist = d.waist;
  an.shY = d.shoulderY;
  an.l1 = d.upperArm;
  an.l2 = d.forearm;
  an.thigh = d.thigh;
  an.thighR = d.seatOffset;
  an.hipXn = d.hipX / d.legS;
  an.heelN = (REF.heel * d.limbW) / d.legS;
  an.toeN = (REF.toe * d.limbW) / d.legS;
  const s = an.seed;
  const j = (k: number) => ((s * k) % 1) * 2 - 1;
  an.strideK = (age === 'senior' ? 0.86 : age === 'kid' ? 0.95 : 1) * (1 + 0.05 * j(13.7));
  an.liftK = (age === 'kid' ? 1.2 : age === 'child' ? 1.1 : age === 'senior' ? 0.75 : 1) * (1 + 0.08 * j(5.3));
  an.armK = (age === 'kid' ? 1.25 : age === 'senior' ? 0.6 : age === 'teen' ? 0.85 : 1) * (1 + 0.2 * j(9.1));
  an.leanK = (age === 'senior' ? 0.08 : 0) + 0.015 * j(3.9);
}

/**
 * Avanza el ciclo de paso con lo que de verdad se movió la persona
 * (`speed`, m/s) y, si gira en el lugar, con los pasitos del giro (`turn`).
 * El largo del paso crece con la velocidad (amplitud ∝ velocidad^0,6) y el
 * ciclo avanza `speed / zancada`: la cadencia sale sola, más rápida en los
 * chicos. Al frenar termina el paso en curso hasta juntar los pies, en vez
 * de quedar congelado a mitad de zancada.
 */
export function stepGait(an: AnimState, speed: number, turn: number, walkSpeed: number, legS: number, dt: number): void {
  const legs = Math.max(speed, turn);
  if (dt > 0) {
    const acc = (speed - an.lastSpeed) / dt;
    an.accel += (clampN(acc, -6, 6) - an.accel) * Math.min(1, dt * 5);
  }
  an.lastSpeed = speed;
  an.fwd += ((legs > 1e-3 ? Math.min(1, speed / legs) : 1) - an.fwd) * Math.min(1, dt * 8);
  if (legs > 0.04) {
    const ampT = Math.min(1.15, Math.pow(legs / Math.max(0.3, walkSpeed), 0.6));
    an.amp += (ampT - an.amp) * Math.min(1, dt * 6);
    an.phase = (an.phase + (legs * dt * TAU) / (strideOf(an) * legS)) % TAU;
    return;
  }
  if (an.amp <= 0.02) {
    an.amp = 0;
    return;
  }
  // Frenando: el ciclo sigue hasta el apoyo medio más cercano (un pie bajo la
  // cadera y el otro pasando a su lado) mientras el paso se achica.
  const target = Math.PI * betaOf(an.run);
  let rem = (target - an.phase) % Math.PI;
  if (rem < 0) rem += Math.PI;
  if (rem > 0.05 && rem < Math.PI - 0.05) {
    an.phase = (an.phase + Math.min(rem, TAU * 1.1 * dt)) % TAU;
    an.amp = Math.max(0, an.amp - dt * 1.6);
  } else an.amp = Math.max(0, an.amp - dt * 5);
}

/**
 * Gira el cuerpo hacia `wantYaw` con inercia: la velocidad de giro acelera,
 * se topa en `maxRate` y frena al llegar (proporcional al ángulo que falta).
 * Con un tope de velocidad pelado el giro arrancaba y paraba en seco. Inclina
 * el cuerpo hacia adentro de la curva según velocidad × giro. Devuelve el
 * ángulo que faltaba.
 */
export function turnToward(a: { yaw: number; wantYaw: number; yawV: number; speed: number; anim: AnimState }, maxRate: number, dt: number): number {
  const dy = wrapA(a.wantYaw - a.yaw);
  const want = clampN(dy * 7, -maxRate, maxRate);
  const acc = 24 * dt;
  a.yawV += clampN(want - a.yawV, -acc, acc);
  let step = a.yawV * dt;
  if (step * dy > 0 && Math.abs(step) > Math.abs(dy)) {
    step = dy;
    a.yawV = dy / Math.max(dt, 1e-3);
  }
  a.yaw = wrapA(a.yaw + step);
  // Girar θ positivo lleva el frente hacia +X (la derecha del cuerpo): se
  // inclina hacia +X, rolido positivo. Tan(inclinación) = v·ω/g, a la mitad.
  const an = a.anim;
  const bank = clampN((a.speed * a.yawV) / 9.8 * 0.5, -0.1, 0.1);
  an.bank += (bank - an.bank) * Math.min(1, dt * 6);
  return dy;
}

/**
 * Mirada hacia (`yaw`, `pitch`) respecto del cuerpo: resorte críticamente
 * amortiguado (arranca y frena suave, sin pasarse), resuelto de forma exacta
 * para que no explote con los pasos de 0,2-0,5 s de la gente lejana. El
 * tronco acompaña con atraso una parte del giro.
 */
export function aimLook(an: AnimState, yaw: number, pitch: number, dt: number): void {
  const w = 8;
  const e = Math.exp(-w * dt);
  let x = an.lookYaw - yaw;
  let k = (an.lookYawV + w * x) * dt;
  an.lookYaw = yaw + (x + k) * e;
  an.lookYawV = (an.lookYawV - w * k) * e;
  x = an.lookPitch - pitch;
  k = (an.lookPitchV + w * x) * dt;
  an.lookPitch = pitch + (x + k) * e;
  an.lookPitchV = (an.lookPitchV - w * k) * e;
  an.lookTorso += (an.lookYaw - an.lookTorso) * Math.min(1, dt * 2.2);
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
  if (a.w < 1) a.w = Math.min(1, a.w + dt / (SEATED.has(a.base) !== SEATED.has(a.prev) ? 0.8 : 0.4));
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

/** Canales del torso, cabeza y brazos que se funden con la espera al caminar despacio. */
const WALK_UPPER: readonly number[] = [LEAN, TWIST, ROLL, HYAW, HPITCH, HROLL, 8, 9, 10, 11, 12, 13, 14, 15];

/** Contexto compartido: se rellena en cada evaluación (cientos por cuadro, sin crear objetos). */
const sharedCtx: AnimCtx = {
  t: 0,
  seed: 0,
  style: 0,
  amp: 0,
  phase: 0,
  run: 0,
  fwd: 1,
  accel: 0,
  bank: 0,
  strideK: 1,
  liftK: 1,
  armK: 1,
  leanK: 0,
  hipXn: REF.hipX,
  heelN: REF.heel,
  toeN: REF.toe,
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
  c.fwd = a.fwd;
  c.accel = a.accel;
  c.bank = a.bank;
  c.strideK = a.strideK;
  c.liftK = a.liftK;
  c.armK = a.armK;
  c.leanK = a.leanK;
  c.hipXn = a.hipXn;
  c.heelN = a.heelN;
  c.toeN = a.toeN;
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
  const c = ctxOf(a, t);
  if (id === 'walk' || id === 'run') {
    gait(out, c);
    if (a.amp < 0.6) {
      // Despacio, el torso y los brazos son los de la espera (las manos atrás
      // o los brazos cruzados siguen así al dar unos pasos); las piernas no:
      // mezclarlas haría patinar el pie apoyado.
      idle(tmpG, c);
      const k = ease(a.amp / 0.6);
      for (const i of WALK_UPPER) out[i] = tmpG[i] + (out[i] - tmpG[i]) * k;
    }
    return;
  }
  CLIPS[id](out, c);
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
    // Mirada: el tronco acompaña con atraso hasta ~20°, el cuello hace el
    // resto hasta ~60° y lo que sobra vuelve al tronco.
    const lw = ease(a.lookW);
    const yaw = a.lookYaw * lw;
    const torso = clampN(a.lookTorso * lw * 0.3, -0.35, 0.35);
    const neck = clampN(yaw - torso, -1.05, 1.05);
    out[HYAW] = out[HYAW] * (1 - lw) + neck;
    out[TWIST] += torso + (yaw - torso - neck) * 0.8;
    out[HPITCH] = out[HPITCH] * (1 - lw) + a.lookPitch * lw;
  }
}
