import { describe, expect, it } from 'vitest';
import { evalPose, newAnimState, setAnimBody, setBase, stepGait, tickAnim, turnToward, POSE_N, type AnimState } from '../src/world/people/Anim';
import { Rig, F_FOOT_L, F_FOOT_R, F_HEAD, F_PELVIS } from '../src/world/people/Rig';
import { bodyDims, makeAppearance, type BodyDims } from '../src/world/people/Looks';
import { Rng } from '../src/utils/rng';
import type { NpcRole } from '../src/game/contracts';

/**
 * La marcha de la gente, medida con el esqueleto real: el pie apoyado no
 * patina, la cadencia depende de la edad y de la velocidad, el pie que va en
 * el aire no arrastra la punta y, parado, los pies no se corren al cambiar
 * el peso de pierna.
 */

const DT = 1 / 72;
const P = { x: 0, y: 0, z: 0 };

interface Person {
  d: BodyDims;
  an: AnimState;
  walk: number;
  runSpeed: number;
}

function person(role: NpcRole, seed = 9, look: { height?: number } = {}): Person {
  const app = makeAppearance(new Rng(seed), { role, ...look });
  const d = bodyDims(app);
  const an = newAnimState(0.37, 0, role === 'kid' || role === 'student');
  setAnimBody(an, d, app.age);
  return { d, an, walk: app.walkSpeed, runSpeed: app.runSpeed };
}

/** Los cuatro puntos de apoyo (talón y punta de cada pie). */
function contacts(rig: Rig, d: BodyDims): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const f of [F_FOOT_L, F_FOOT_R]) {
    for (const toe of [false, true]) {
      rig.sole(f, d, toe, P);
      out.push([P.x, P.y, P.z]);
    }
  }
  return out;
}

/**
 * Camina en línea recta a `v` m/s (corriendo con `run`) durante unos segundos
 * y mide la velocidad horizontal del punto que sostiene a la persona (el más
 * bajo, si está en el piso: corriendo hay vuelo), sólo cuando es el mismo
 * punto en dos cuadros seguidos. También la altura mínima del pie que va en
 * el aire a mitad de su vuelo y la cadencia (pasos por minuto).
 */
function walkSlip(p: Person, v: number, run = 0, seconds = 4) {
  const { d, an } = p;
  setBase(an, 'walk');
  an.w = 1;
  an.run = run;
  an.amp = Math.min(1.15, Math.pow(v / p.walk, 0.6));
  const rig = new Rig();
  const pose = new Float32Array(POSE_N);
  let z = 0;
  let prev: [number, number, number] | null = null;
  let prevI = -1;
  const speeds: number[] = [];
  let turns = 0;
  let swingLow = Infinity;
  const beta = 0.62 - 0.26 * run;
  for (let i = 0; i < seconds / DT; i++) {
    z += v * DT;
    const ph0 = an.phase;
    stepGait(an, v, 0, p.walk, d.legS, DT);
    if (i > 72) turns += (an.phase - ph0 + Math.PI * 2) % (Math.PI * 2);
    evalPose(an, pose);
    rig.pose(pose, d, 0, z, 0, 0, 0);
    const c = contacts(rig, d);
    let k = 0;
    for (let j = 1; j < 4; j++) if (c[j][1] < c[k][1]) k = j;
    for (const leg of [0, 1]) {
      const u = (an.phase / (Math.PI * 2) + leg * 0.5) % 1;
      const s = (u - beta) / (1 - beta);
      if (s > 0.25 && s < 0.75) swingLow = Math.min(swingLow, c[leg * 2][1], c[leg * 2 + 1][1]);
    }
    const onFloor = c[k][1] < 0.002;
    if (prev && prevI === k && onFloor && i > 72) speeds.push(Math.hypot(c[k][0] - prev[0], c[k][2] - prev[2]) / DT);
    prev = c[k];
    prevI = onFloor ? k : -1;
  }
  speeds.sort((a, b) => a - b);
  const mean = speeds.reduce((s, x) => s + x, 0) / speeds.length;
  const t = seconds - 73 * DT;
  return { mean: mean / v, p90: speeds[Math.floor(speeds.length * 0.9)] / v, cadence: (turns / (Math.PI * 2) / t) * 2 * 60, stride: (v * t) / (turns / (Math.PI * 2)), swingLow };
}

describe('gente — marcha', () => {
  it('el pie apoyado no patina (caminando a distintas velocidades y corriendo)', () => {
    for (const role of ['teacher', 'kid', 'student', 'studentSecondary', 'visitor'] as const) {
      for (const k of [0.4, 0.7, 1, 1.2]) {
        const p = person(role);
        const r = walkSlip(p, p.walk * k);
        expect(r.mean, `${role} a ${k}× patina`).toBeLessThan(0.06);
        expect(r.p90, `${role} a ${k}× patina`).toBeLessThan(0.12);
      }
      const p = person(role);
      const r = walkSlip(p, p.runSpeed, 1);
      expect(r.mean, `${role} corriendo patina`).toBeLessThan(0.1);
    }
  });

  it('cadencia y largo de paso según edad y velocidad; el pie en el aire no arrastra la punta', () => {
    const adult = person('teacher');
    const kid = person('kid');
    const a = walkSlip(adult, adult.walk);
    const k = walkSlip(kid, kid.walk);
    // Adulto: ~100-125 pasos por minuto y ~1,3-1,5 m por zancada; un chico de
    // jardín, pasos cortos y rápidos (~140-170).
    expect(a.cadence).toBeGreaterThan(95);
    expect(a.cadence).toBeLessThan(125);
    expect(a.stride).toBeGreaterThan(1.2);
    expect(a.stride).toBeLessThan(1.6);
    expect(k.cadence).toBeGreaterThan(135);
    expect(k.cadence).toBeLessThan(175);
    // Más despacio: pasos más cortos Y menos cadencia (no sólo lo segundo).
    const slow = walkSlip(person('teacher'), adult.walk * 0.5);
    expect(slow.cadence).toBeLessThan(a.cadence * 0.85);
    expect(slow.stride).toBeLessThan(a.stride * 0.8);
    // A mitad del vuelo, la punta pasa al menos a 1,5 cm del piso.
    expect(a.swingLow).toBeGreaterThan(0.015);
    expect(k.swingLow).toBeGreaterThan(0.01);
  });

  it('parado: cambia el peso de pierna sin correr los pies y la cadera se mece', () => {
    for (const role of ['teacher', 'kid', 'studentSecondary'] as const) {
      const { d, an } = person(role, 4);
      const rig = new Rig();
      const pose = new Float32Array(POSE_N);
      let first: Array<[number, number, number]> | null = null;
      let drift = 0;
      let hipMin = Infinity;
      let hipMax = -Infinity;
      for (let t = 0; t < 30; t += 0.05) {
        tickAnim(an, 0.05);
        evalPose(an, pose);
        rig.pose(pose, d, 0, 0, 0, 0, 0);
        const c = contacts(rig, d);
        first ??= c;
        // Los puntos que están en el piso no se mueven de donde estaban.
        for (let j = 0; j < 4; j++) if (c[j][1] < 0.004) drift = Math.max(drift, Math.hypot(c[j][0] - first[j][0], c[j][2] - first[j][2]));
        hipMin = Math.min(hipMin, rig.f[F_PELVIS * 12 + 9]);
        hipMax = Math.max(hipMax, rig.f[F_PELVIS * 12 + 9]);
      }
      expect(drift, `${role}: los pies se arrastran`).toBeLessThan(0.012);
      expect(hipMax - hipMin, `${role}: la cadera no se mece`).toBeGreaterThan(0.015);
    }
  });

  it('al frenar termina el paso: los pies quedan juntos y la amplitud se apaga', () => {
    const p = person('teacher');
    const { d, an } = p;
    setBase(an, 'walk');
    an.w = 1;
    const rig = new Rig();
    const pose = new Float32Array(POSE_N);
    for (const start of [0.1, 0.9, 1.7, 2.3, 3.1, 4.4, 5.6]) {
      an.phase = start;
      an.amp = 1;
      // Frena de golpe y deja correr un segundo.
      for (let i = 0; i < 72; i++) stepGait(an, 0, 0, p.walk, d.legS, DT);
      expect(an.amp).toBeLessThan(0.05);
      evalPose(an, pose);
      rig.pose(pose, d, 0, 0, 0, 0, 0);
      const c = contacts(rig, d);
      // Talones a menos de 12 cm uno del otro (a lo largo): no quedó a media zancada.
      expect(Math.abs(c[0][2] - c[2][2]), `desde la fase ${start}`).toBeLessThan(0.12);
    }
  });

  it('en una curva el cuerpo se inclina hacia adentro y el giro arranca y frena suave', () => {
    const p = person('teacher');
    const a = { yaw: 0, wantYaw: 1.2, yawV: 0, speed: 1.3, anim: p.an };
    setBase(p.an, 'walk');
    p.an.w = 1;
    p.an.amp = 1;
    let maxStep = 0;
    let prevV = 0;
    for (let i = 0; i < 36; i++) {
      turnToward(a, 4.5, DT);
      maxStep = Math.max(maxStep, Math.abs(a.yawV - prevV));
      prevV = a.yawV;
    }
    // Sin saltos de velocidad angular (antes pasaba de 0 a 4,5 rad/s en un cuadro).
    expect(maxStep).toBeLessThan(0.5);
    expect(a.yaw).toBeGreaterThan(0.6);
    // Girando hacia +X (yaw creciente) a 1,3 m/s: la cabeza se corre hacia +X.
    const rig = new Rig();
    const pose = new Float32Array(POSE_N);
    p.an.bank = 0.08;
    evalPose(p.an, pose);
    rig.pose(pose, p.d, 0, 0, 0, 0, 0);
    expect(rig.f[F_HEAD * 12 + 9] - rig.f[F_PELVIS * 12 + 9]).toBeGreaterThan(0.02);
  });
});
