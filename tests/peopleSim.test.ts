import { describe, it, expect } from 'vitest';
import { PeopleSim, composition, type Agent, type SimView } from '../src/world/people/Sim';
import { evalPose, newAnimState, setBase, POSE_N, SIT } from '../src/world/people/Anim';
import { Rig, F_FARM_L, F_FARM_R, F_SHIN_L, F_SHIN_R } from '../src/world/people/Rig';
import { bodyDims, makeAppearance } from '../src/world/people/Looks';
import { treadFloor } from '../src/world/people/Places';
import { Rng } from '../src/utils/rng';
import { FURNITURE, ITEMS, KINDER_ROOMS, LEVEL_Y, STAIRS, roomAt, setDynamicSolid, stairY } from '../src/world/SchoolLayout';
import { CROSS_AT, CROSS_HALF, Sidewalks, sidewalkOptions, type Walker } from '../src/world/people/Sidewalks';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';
import { TrafficSim } from '../src/world/life/traffic';

/**
 * La gente, sin motor: reparto por momento del día, determinismo, lugares
 * válidos, la API de personajes con nombre y la física de los pies.
 *
 * Se simula a 10 Hz con la cámara lejos (todos fuera de cuadro): así se
 * prueba también que la gente llega sola a donde tiene que ir.
 */

const FAR: SimView = { cu: 37, cv: 30, cy: 1.7, fu: 0, fv: -1, player: null };
const STUDENT = new Set(['kid', 'student', 'studentSecondary']);
const CLASSROOMS = /^(aula|sala(Amarilla|Roja|Celeste)|tecnologia|bilingue)/;

function run(sim: PeopleSim, seconds: number, view: SimView = FAR): void {
  for (let t = 0; t < seconds; t += 0.1) sim.update(0.1, view);
}

const students = (sim: PeopleSim) => sim.agents.filter((a) => STUDENT.has(a.role) && !a.named && a.alive);
const frac = (list: Agent[], pred: (a: Agent) => boolean) => (list.length === 0 ? 0 : list.filter(pred).length / list.length);

describe('gente — población', () => {
  it('reparto por rol según el tamaño de la multitud (VR 90, Alta 180)', () => {
    for (const n of [60, 90, 180]) {
      const c = composition(n);
      const total = c.staff + c.teacher + c.visitor + c.pedestrians + c.kid + c.student + c.studentSecondary;
      expect(total).toBe(n);
      expect(c.kid).toBeGreaterThan(0);
      expect(c.student).toBeGreaterThan(c.studentSecondary);
    }
    const sim = new PeopleSim(42, { crowdSize: 90, detailed: false });
    expect(sim.agents.length).toBe(90);
    const staff = sim.agents.filter((a) => a.staff).map((a) => a.staff).sort();
    expect(staff).toEqual(['cantina', 'cantina', 'maintenance', 'porter']);
    // Proporciones humanas: jardín ~1,0-1,15 m, primaria 1,25-1,5, secundaria 1,55-1,8, adultos 1,55-1,9.
    for (const a of sim.agents) {
      const h = a.look.height;
      const range: Record<string, [number, number]> = {
        kid: [1.0, 1.15],
        student: [1.25, 1.5],
        studentSecondary: [1.55, 1.8],
        teacher: [1.5, 1.9],
        staff: [1.5, 1.9],
        visitor: [1.5, 1.9],
      };
      const [lo, hi] = range[a.role];
      expect(h, a.id).toBeGreaterThanOrEqual(lo);
      expect(h, a.id).toBeLessThanOrEqual(hi);
      // Cabeza proporcionalmente más grande en los chicos.
      if (a.role === 'kid') expect(a.look.headK).toBeGreaterThan(1.3);
      expect(a.body.legS * 0.92 + a.body.torsoS * 0.53 + a.body.headS * 0.27).toBeCloseTo(h, 5);
    }
  });

  it('uniformes: chomba roja y azul marino; buzo con ribete en secundaria; guardapolvo en jardín', () => {
    const sim = new PeopleSim(7, { crowdSize: 180, detailed: true });
    const red = [200 / 255, 68 / 255, 69 / 255];
    for (const a of sim.agents) {
      if (a.role === 'student') expect(a.look.top.map((x) => +x.toFixed(3))).toEqual(red.map((x) => +x.toFixed(3)));
      if (a.role === 'kid') expect(a.look.torsoPart).toBe('smock');
    }
    const sec = sim.agents.filter((a) => a.role === 'studentSecondary');
    expect(sec.filter((a) => a.look.trim !== null).length).toBeGreaterThan(sec.length * 0.5);
    expect(sim.agents.some((a) => a.role === 'teacher' && a.look.torsoPart === 'coat')).toBe(true);
    expect(sim.agents.some((a) => a.staff === 'maintenance' && a.look.prop === 'mop')).toBe(true);
    expect(sim.agents.some((a) => a.staff === 'cantina' && a.look.apron !== null && a.look.hairStyle === 'cap')).toBe(true);
    const styles = new Set(sim.agents.map((a) => a.look.hairStyle));
    for (const s of ['short', 'long', 'bun', 'ponytail', 'curly']) expect(styles.has(s as never), s).toBe(true);
  });

  it('determinista: la misma semilla da la misma gente y los mismos movimientos', () => {
    const a = new PeopleSim(2050, { crowdSize: 60, detailed: false });
    const b = new PeopleSim(2050, { crowdSize: 60, detailed: false });
    const c = new PeopleSim(2051, { crowdSize: 60, detailed: false });
    const snap = (s: PeopleSim) => s.agents.map((x) => `${x.role}:${x.look.height.toFixed(4)}:${x.look.skin.join()}:${x.u.toFixed(3)},${x.v.toFixed(3)}`).join('|');
    expect(snap(a)).toBe(snap(b));
    expect(snap(a)).not.toBe(snap(c));
    a.setPhase('recreo');
    b.setPhase('recreo');
    run(a, 20);
    run(b, 20);
    expect(snap(a)).toBe(snap(b));
  });
});

describe('gente — lugares', () => {
  const sim = new PeopleSim(42, { crowdSize: 180, detailed: true });
  const { places, nav } = sim;

  it('cada asiento asignado tiene un acceso desde la grilla', () => {
    let used = 0;
    for (const a of sim.agents) {
      const t = a.task;
      if (t.k !== 'seat') continue;
      const mile = places.lastMile(t.seat);
      expect(mile.length, `${a.id} en ${t.seat.room}`).toBeGreaterThanOrEqual(3);
      expect(nav.isMain(t.seat.level, mile[0], mile[1]), `acceso de ${t.seat.room}`).toBe(true);
      used++;
    }
    expect(used).toBeGreaterThan(20);
  });

  it('puestos (cabina, cantina, fila, portón, acto) sobre lugares válidos', () => {
    expect(roomAt(places.porter.u, places.porter.v, 0)?.id).toBe('hall');
    expect(places.cantina.length).toBe(2);
    expect(places.queue.length).toBeGreaterThanOrEqual(4);
    for (const q of places.queue) expect(nav.isMain(0, q.u, q.v), 'fila').toBe(true);
    expect(places.portal.length).toBeGreaterThan(0);
    for (const p of places.portal) expect(nav.isMain(0, p.u, p.v), 'portón').toBe(true);
    const rows = places.actoRows.flat();
    expect(rows.length).toBeGreaterThan(150);
    for (const p of rows) expect(roomAt(p.u, p.v, 0)?.id).toBe('gimnasio');
    for (const s of places.seats) {
      expect(s.y).toBeGreaterThan(LEVEL_Y[s.level] + 0.3);
      expect(s.footY).toBeLessThan(s.y);
    }
  });
});

describe('gente — momentos del día', () => {
  it('entrada (inicial): llegando por la vereda, en el hall y ya sentados', () => {
    const sim = new PeopleSim(42, { crowdSize: 180, detailed: true });
    const st = students(sim);
    const out = frac(st, (a) => a.v > 0.5);
    const hall = frac(st, (a) => sim.roomOf(a) === 'hall');
    const seated = frac(st, (a) => a.task.k === 'seat');
    expect(out).toBeGreaterThan(0.1);
    expect(hall).toBeGreaterThan(0.05);
    expect(seated).toBeGreaterThan(0.1);
    // Paseantes por la vereda.
    expect(sim.agents.filter((a) => a.task.k === 'stroll').length).toBeGreaterThan(3);
  });

  it('clase: casi todos los alumnos sentados en su aula, un docente por pizarrón', () => {
    const sim = new PeopleSim(42, { crowdSize: 90, detailed: false });
    sim.setPhase('clase');
    run(sim, 150);
    const st = students(sim);
    const seated = frac(st, (a) => a.task.k === 'seat' && a.seat !== null && a.stage === 'act');
    expect(seated).toBeGreaterThan(0.8);
    expect(frac(st, (a) => CLASSROOMS.test(sim.roomOf(a)))).toBeGreaterThan(0.8);
    // Algunos en el primer piso: llegaron por la escalera.
    expect(st.filter((a) => a.level === 1).length).toBeGreaterThan(0);
    const teaching = sim.agents.filter((a) => a.task.k === 'teach' && a.stage === 'act');
    expect(teaching.length).toBeGreaterThanOrEqual(2);
    // Personal en sus puestos.
    const porter = sim.agents.find((a) => a.staff === 'porter')!;
    expect(sim.roomOf(porter)).toBe('hall');
  });

  it('recreo: patios llenos, fila en la cantina, nadie en las aulas', () => {
    const sim = new PeopleSim(7, { crowdSize: 90, detailed: false });
    sim.setPhase('clase');
    run(sim, 60);
    sim.setPhase('recreo');
    run(sim, 120);
    const prim = sim.agents.filter((a) => a.role === 'student' && a.alive);
    const kids = sim.agents.filter((a) => a.role === 'kid' && a.alive);
    expect(frac(prim, (a) => ['patioOeste', 'buffet', 'pasilloSur', 'pasilloOeste'].includes(sim.roomOf(a)))).toBeGreaterThan(0.6);
    expect(frac(kids, (a) => sim.roomOf(a) === 'patioEste')).toBeGreaterThan(0.6);
    expect(frac(students(sim), (a) => CLASSROOMS.test(sim.roomOf(a)))).toBeLessThan(0.15);
    expect(sim.agents.filter((a) => a.task.k === 'queue').length).toBeGreaterThan(0);
    expect(sim.agents.some((a) => a.task.k === 'play' && a.run)).toBe(true);
    expect(sim.agents.some((a) => a.task.k === 'group' && a.anim.base === 'talk')).toBe(true);
  });

  it('acto: todos al polideportivo, de cara al oeste; familias en las gradas', () => {
    const sim = new PeopleSim(42, { crowdSize: 90, detailed: false });
    sim.setPhase('acto');
    run(sim, 150);
    const st = students(sim);
    expect(frac(st, (a) => sim.roomOf(a) === 'gimnasio')).toBeGreaterThan(0.85);
    const rowsDone = st.filter((a) => a.task.k === 'stand' && a.stage === 'act');
    // Mirando al oeste (+x): rumbo π/2.
    expect(frac(rowsDone, (a) => Math.abs(Math.atan2(Math.sin(a.yaw - Math.PI / 2), Math.cos(a.yaw - Math.PI / 2))) < 0.5)).toBeGreaterThan(0.8);
    const bleachers = sim.agents.filter((a) => a.task.k === 'seat' && a.seat?.kind === 'bleacher' && a.stage === 'act');
    expect(bleachers.length).toBeGreaterThan(0);
    for (const a of bleachers) expect(a.seatY).toBeGreaterThan(LEVEL_Y[0] + 0.4);
    // Jardín sentado en el piso adelante.
    expect(sim.agents.filter((a) => a.task.k === 'floor').length).toBeGreaterThan(5);
  });

  it('salida: se van por el portón y la escuela se vacía; en la entrada vuelven', () => {
    const sim = new PeopleSim(42, { crowdSize: 90, detailed: false });
    sim.setPhase('clase');
    run(sim, 30);
    const before = sim.population;
    sim.setPhase('salida');
    run(sim, 150);
    expect(sim.population).toBeLessThan(before * 0.5);
    expect(frac(students(sim).concat(sim.agents.filter((a) => STUDENT.has(a.role) && a.gone)), (a) => a.gone)).toBeGreaterThan(0.7);
    sim.setPhase('entrada');
    run(sim, 90);
    expect(sim.population).toBeGreaterThan(before * 0.95);
  });
});

describe('gente — personajes con nombre y reacciones', () => {
  it('goTo camina por la escuela (también entre pisos) y avisa al llegar', async () => {
    const sim = new PeopleSim(3, { crowdSize: 40, detailed: false });
    const a = sim.spawnNamed('directora', { role: 'teacher', seed: 1, labCoat: true }, { u: 37.4, v: -6, level: 0 }, 0);
    expect(sim.character('directora')).toBe(a);
    let done: boolean | null = null;
    void sim.goTo(a, { u: 22, v: -18, level: 0 }).then((ok) => (done = ok));
    for (let t = 0; t < 60 && done === null; t += 0.1) {
      sim.update(0.1, FAR);
      await Promise.resolve();
    }
    expect(done).toBe(true);
    expect(Math.hypot(a.u - 22, a.v + 18)).toBeLessThan(0.6);
    // Al primer piso (pasillo de los trofeos) por la escalera del hall.
    done = null;
    void sim.goTo(a, { u: 34.2, v: -7, level: 1 }).then((ok) => (done = ok));
    for (let t = 0; t < 90 && done === null; t += 0.1) {
      sim.update(0.1, FAR);
      await Promise.resolve();
    }
    expect(done).toBe(true);
    expect(a.level).toBe(1);
    expect(Math.abs(a.y - LEVEL_Y[1])).toBeLessThan(0.05);
    // Sin camino: se resuelve false.
    let bad: boolean | null = null;
    void sim.goTo(a, { u: 120, v: -200, level: 0 }).then((ok) => (bad = ok));
    for (let t = 0; t < 5 && bad === null; t += 0.1) {
      sim.update(0.1, FAR);
      await Promise.resolve();
    }
    expect(bad).toBe(false);
    // Teleport, mirar y gestos.
    sim.teleportNamed(a, { u: 37.4, v: -4, level: 0 }, Math.PI);
    expect(a.u).toBeCloseTo(37.4, 5);
    expect(a.level).toBe(0);
    sim.play(a, 'wave');
    expect(a.anim.gesture).toBe('wave');
    sim.play(a, 'talk', true);
    run(sim, 1);
    expect(a.anim.base).toBe('talk');
  });

  it('un personaje con nombre en un pizarrón: el docente de la multitud le deja la clase', () => {
    // Laura da clase en el aula 4: el docente que tenía ese pizarrón se
    // dibujaba metido dentro de ella.
    const sim = new PeopleSim(42, { crowdSize: 90, detailed: false });
    sim.setPhase('clase', true);
    const t = sim.agents.find((a) => a.task.k === 'teach')!;
    expect(t).toBeTruthy();
    const b = (t.task as { board: { u: number; v: number; level: 0 | 1 | 2 } }).board;
    const n = sim.spawnNamed('laura', { role: 'teacher', seed: 404, hairStyle: 'long' }, { u: b.u, v: b.v, level: b.level }, 0);
    run(sim, 20);
    for (const o of sim.agents) {
      if (o === n || !o.alive || o.level !== n.level || o.seat) continue;
      expect(Math.hypot(o.u - n.u, o.v - n.v)).toBeGreaterThan(0.35);
    }
    expect(t.task.k === 'teach' && Math.hypot(t.task.board.u - n.u, t.task.board.v - n.v) < 1.4).toBe(false);
    // Y al repartir de nuevo la clase, ese pizarrón sigue siendo de ella.
    sim.setPhase('recreo', true);
    sim.setPhase('clase', true);
    expect(sim.agents.some((o) => !o.named && o.task.k === 'teach' && Math.hypot(o.task.board.u - n.u, o.task.board.v - n.v) < 1.4)).toBe(false);
  });

  it('esquive: dos personas de frente por un pasillo no se atraviesan', () => {
    const sim = new PeopleSim(5, { crowdSize: 1, detailed: false });
    for (const x of sim.agents) x.dormant = true;
    const a = sim.spawnNamed('a', { role: 'student', seed: 2 }, { u: 12, v: -8.25, level: 0 }, -Math.PI / 2);
    const b = sim.spawnNamed('b', { role: 'student', seed: 3 }, { u: 24, v: -8.25, level: 0 }, Math.PI / 2);
    void sim.goTo(a, { u: 24, v: -8.25, level: 0 });
    void sim.goTo(b, { u: 12, v: -8.25, level: 0 });
    let minD = Infinity;
    for (let t = 0; t < 20; t += 0.05) {
      sim.update(0.05, FAR);
      minD = Math.min(minD, Math.hypot(a.u - b.u, a.v - b.v));
    }
    expect(minD).toBeGreaterThan(0.3);
    expect(Math.hypot(a.u - 24, a.v + 8.25)).toBeLessThan(1);
  });

  it('reacción al jugador: lo miran y le abren paso', () => {
    const sim = new PeopleSim(11, { crowdSize: 90, detailed: false });
    sim.setPhase('recreo', true);
    const g = sim.agents.find((a) => a.task.k === 'group' && a.stage === 'act' && a.level === 0)!;
    expect(g).toBeTruthy();
    const anchorU = g.au;
    const anchorV = g.av;
    const yaw = g.yaw;
    // El jugador se para a 50 cm, delante.
    const view: SimView = { ...FAR, player: { u: g.u - Math.sin(yaw) * 0.5, v: g.v + Math.cos(yaw) * 0.5, y: LEVEL_Y[0] } };
    for (let t = 0; t < 3; t += 0.1) sim.update(0.1, view);
    expect(g.anim.lookW).toBeGreaterThan(0.5);
    expect(Math.hypot(g.u - anchorU, g.v - anchorV)).toBeGreaterThan(0.15);
  });
});

describe('gente — esqueleto', () => {
  it('los pies se apoyan en el piso durante todo el ciclo de paso', () => {
    const rig = new Rig();
    const app = makeAppearance(new Rng(9), { role: 'teacher' });
    const d = bodyDims(app);
    const an = newAnimState(0.3, 0, false);
    setBase(an, 'walk');
    an.w = 1;
    an.amp = 1;
    const pose = new Float32Array(POSE_N);
    for (let ph = 0; ph < Math.PI * 2; ph += 0.3) {
      an.phase = ph;
      evalPose(an, pose);
      rig.pose(pose, d, 10, 5, 0.4, 0.12, 0.12);
      const f = rig.f;
      const sole = (sh: number) => -d.shin * f[sh * 12 + 4] + 0.035 * d.legS * f[sh * 12 + 7] + f[sh * 12 + 10];
      expect(Math.min(sole(F_SHIN_L), sole(F_SHIN_R))).toBeCloseTo(0.12, 3);
    }
    // Sentado: la cadera queda sobre el asiento.
    setBase(an, 'sit');
    an.w = 1;
    evalPose(an, pose);
    expect(pose[SIT]).toBe(1);
    rig.pose(pose, d, 10, 5, 0.4, 0.12, 0.6);
    expect(rig.f[10]).toBeCloseTo(0.6 + d.seatOffset, 3);
  });

  it('en la escalera cada pie pisa su huella: ninguno se hunde', () => {
    const s = STAIRS[0];
    // La huella real coincide con la rampa de la simulación en el medio de cada escalón.
    const n = Math.max(4, Math.round((s.y1 - s.y0) / 0.175));
    const vm = (s.v0 + s.v1) / 2;
    for (let i = 0; i < n; i++) {
      const u = s.u0 + ((i + 0.5) / n) * (s.u1 - s.u0);
      expect(treadFloor(u, vm, stairY(s, u, vm))).toBeCloseTo(stairY(s, u, vm), 5);
    }
    // Subiendo con el paso de llano: la suela más alta respecto de su huella toca, y ninguna queda debajo.
    const rig = new Rig();
    const d = bodyDims(makeAppearance(new Rng(4), { role: 'teacher' }));
    const an = newAnimState(0.6, 0, false);
    setBase(an, 'walk');
    an.w = 1;
    an.amp = 0.8;
    const pose = new Float32Array(POSE_N);
    // Mundo = local con x = −u (alcanza para la prueba: el rumbo apunta a +u).
    const floor = (x: number, z: number) => {
      const y = treadFloor(-x, z, LEVEL_Y[0] + 0.8);
      return Number.isNaN(y) ? LEVEL_Y[0] : y;
    };
    const f = rig.f;
    const sole = (sh: number) => -d.shin * f[sh * 12 + 4] + 0.035 * d.legS * f[sh * 12 + 7] + f[sh * 12 + 10];
    const solePos = (sh: number) => [-d.shin * f[sh * 12 + 3] + 0.035 * d.legS * f[sh * 12 + 6] + f[sh * 12 + 9], -d.shin * f[sh * 12 + 5] + 0.035 * d.legS * f[sh * 12 + 8] + f[sh * 12 + 11]];
    for (let k = 0; k < 20; k++) {
      an.phase = k * 0.31;
      evalPose(an, pose);
      const u = s.u0 + 0.6 + k * 0.05;
      rig.pose(pose, d, -u, vm, -Math.PI / 2, stairY(s, u, vm), 0, floor);
      const gaps = [F_SHIN_L, F_SHIN_R].map((sh) => sole(sh) - floor(solePos(sh)[0], solePos(sh)[1]));
      expect(Math.min(...gaps)).toBeGreaterThan(-1e-4);
      expect(Math.min(...gaps)).toBeLessThan(1e-3);
    }
  });

  it('sentado al pupitre: chicos y grandes apoyan las manos en la tapa', () => {
    // Antes los ángulos eran fijos: un chico levantaba las manos a la cara y
    // un adulto las metía en la mesa. Silla y pupitre como los dibuja la escuela.
    const seatY = LEVEL_Y[0] + FURNITURE.seat;
    const deskY = LEVEL_Y[0] + FURNITURE.deskTop;
    const deskD = 0.2;
    for (const look of [
      { role: 'student' as const, height: 1.3 },
      { role: 'student' as const, height: 1.48 },
      { role: 'studentSecondary' as const, height: 1.75 },
      { role: 'teacher' as const, height: 1.88 },
    ]) {
      const d = bodyDims(makeAppearance(new Rng(7), look));
      const an = newAnimState(0.7, 0, look.height < 1.5);
      Object.assign(an, { waist: d.waist, shY: d.shoulderY, l1: d.upperArm, l2: d.forearm, deskH: deskY - (seatY + d.seatOffset), deskZ: deskD + 0.06, hipFlex: 1.4, knee: 1.3 });
      const rig = new Rig();
      const pose = new Float32Array(POSE_N);
      for (const anim of ['sitDesk', 'sit'] as const) {
        setBase(an, anim);
        an.w = 1;
        for (let t = 0; t < 12; t += 0.7) {
          an.t = t;
          evalPose(an, pose);
          // Mirando a +z; la cadera 6 cm detrás del centro del asiento (z = 0).
          rig.pose(pose, d, 0, -0.06, 0, LEVEL_Y[0], seatY);
          const w = { x: 0, y: 0, z: 0 };
          rig.point(F_FARM_R, 0, -d.forearm, 0, w);
          // La muñeca, sobre la tapa (ni adentro ni flotando) y por encima de la mesa.
          expect(w.y).toBeGreaterThan(deskY + 0.01);
          expect(w.y).toBeLessThan(deskY + 0.12);
          expect(w.z).toBeGreaterThan(deskD - 0.02);
          // Y la punta de los dedos tampoco se mete en la tapa (antes, 2-4 cm adentro).
          const tip = { x: 0, y: 0, z: 0 };
          rig.point(F_FARM_R, 0, -1.66 * d.forearm, 0, tip);
          expect(tip.y).toBeGreaterThan(deskY - 0.005);
        }
      }
      // Con la mesa lejos, nada de brazos rígidos en el aire antes del borde:
      // o llega a la tapa o apoya las manos en las piernas.
      an.deskZ = 0.5 + 0.06;
      for (const anim of ['sitDesk', 'sit', 'sitTalk'] as const) {
        setBase(an, anim);
        an.w = 1;
        for (let t = 0; t < 12; t += 0.7) {
          an.t = t;
          evalPose(an, pose);
          rig.pose(pose, d, 0, -0.06, 0, LEVEL_Y[0], seatY);
          for (const F of [F_FARM_L, F_FARM_R]) {
            // La mano que gesticula al charlar puede ir en el aire.
            if (anim === 'sitTalk' && F === F_FARM_R) continue;
            // La palma (≈ 1,24 antebrazos desde el codo).
            const w = { x: 0, y: 0, z: 0 };
            rig.point(F, 0, -1.24 * d.forearm, 0, w);
            expect(w.z < 0.5 - 0.02 && w.y > deskY - 0.02, `${look.height} ${anim}: brazo en el aire antes de la mesa`).toBe(false);
          }
        }
      }
    }
  });

  it('aplauso: las manos se abren y se juntan sin cruzarse', () => {
    for (const look of [
      { role: 'kid' as const },
      { role: 'student' as const, height: 1.35 },
      { role: 'studentSecondary' as const, height: 1.72 },
      { role: 'teacher' as const, height: 1.85 },
    ]) {
      const d = bodyDims(makeAppearance(new Rng(5), look));
      const an = newAnimState(0.4, 0, look.role === 'kid');
      an.gesture = 'clap';
      const rig = new Rig();
      const pose = new Float32Array(POSE_N);
      let mn = Infinity;
      let mx = -Infinity;
      for (let t = 0.4; t < 2.0; t += 0.01) {
        an.gT = t;
        an.gW = 1;
        evalPose(an, pose);
        rig.pose(pose, d, 0, 0, 0, LEVEL_Y[0], LEVEL_Y[0]);
        const l = { x: 0, y: 0, z: 0 };
        const r = { x: 0, y: 0, z: 0 };
        rig.point(F_FARM_L, 0, -1.24 * d.forearm, 0, l);
        rig.point(F_FARM_R, 0, -1.24 * d.forearm, 0, r);
        // Mirando a +z, la derecha queda en +x: separación entre las palmas.
        const sep = r.x - l.x;
        mn = Math.min(mn, sep);
        mx = Math.max(mx, sep);
      }
      expect(mn, `${look.role}: las manos se cruzan`).toBeGreaterThan(-0.045);
      expect(mx, `${look.role}: las manos no se abren`).toBeGreaterThan(0.15);
    }
  });

  it('sentados: los pies apoyan en el piso (o en el travesaño de la banqueta)', () => {
    const sim = new PeopleSim(42, { crowdSize: 180, detailed: true });
    sim.setPhase('clase', true);
    const rig = new Rig();
    const pose = new Float32Array(POSE_N);
    let checked = 0;
    for (const a of sim.agents) {
      const s = a.seat;
      if (!s || a.stage !== 'act' || a.anim.dangle || s.kind === 'bleacher') continue;
      evalPose(a.anim, pose);
      rig.pose(pose, a.body, 0, 0, a.yaw, a.y, a.seatY);
      const f = rig.f;
      const sole = (sh: number) => -a.body.shin * f[sh * 12 + 4] + 0.035 * a.body.legS * f[sh * 12 + 7] + f[sh * 12 + 10];
      const gap = Math.min(sole(F_SHIN_L), sole(F_SHIN_R)) - s.footY;
      expect(gap, `${a.id} (${a.look.age}) en ${s.kind} de ${s.room}: pies en el aire`).toBeLessThan(0.03);
      expect(gap, `${a.id} en ${s.kind}: pies hundidos`).toBeGreaterThan(-0.03);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});

describe('gente — revisión de la escuela habitada', () => {
  it('el portero a la vista no sale de su cabina al cambiar el momento del día', () => {
    // Su puesto está dentro de la cabina (maciza para la grilla): el camino
    // arrancaba del otro lado del muro y terminaba en el aula 6.
    const sim = new PeopleSim(42, { crowdSize: 90, detailed: false });
    const porter = sim.agents.find((a) => a.staff === 'porter')!;
    run(sim, 2);
    for (const phase of ['clase', 'recreo', 'salida'] as const) {
      porter.visible = true;
      sim.setPhase(phase);
      for (let t = 0; t < 12; t += 0.1) {
        porter.visible = true;
        sim.update(0.1, FAR);
      }
      expect(sim.roomOf(porter), phase).toBe('hall');
      expect(Math.hypot(porter.u - sim.places.porter.u, porter.v - sim.places.porter.v)).toBeLessThan(0.3);
    }
  });

  it('las salas del jardín tienen su maestra durante la clase', () => {
    const sim = new PeopleSim(42, { crowdSize: 180, detailed: true });
    sim.setPhase('clase');
    run(sim, 90);
    let rooms = 0;
    for (const room of ['salaAmarilla', 'salaRoja', 'salaCeleste']) {
      const kids = sim.agents.filter((a) => a.alive && a.role === 'kid' && sim.roomOf(a) === room).length;
      if (kids < 3) continue;
      rooms++;
      const adults = sim.agents.filter((a) => a.alive && a.role === 'teacher' && sim.roomOf(a) === room);
      expect(adults.length, `${room}: ${kids} chicos sin maestra`).toBeGreaterThan(0);
      // Parada entre las mesitas, sin pisar ninguna silla.
      for (const t of adults) for (const s of sim.places.seats) if (s.room === room) expect(Math.hypot(s.u - t.u, s.v - t.v)).toBeGreaterThan(0.5);
    }
    expect(rooms).toBeGreaterThan(0);
  });

  it('grupos de charla: cada lugar de la ronda se pisa y tiene aire (nadie en el marco de una puerta)', () => {
    for (const seed of [42, 7]) {
      const sim = new PeopleSim(seed, { crowdSize: 180, detailed: true });
      for (const phase of ['entrada', 'recreo'] as const) {
        sim.setPhase(phase, true);
        let n = 0;
        for (const a of sim.agents) {
          if (!a.alive || a.task.k !== 'group' || a.stage !== 'act') continue;
          const ok = sim.nav.isWalkable(a.level, a.u, a.v) && sim.nav.clear(a.level, a.u, a.v, 0.25);
          expect(ok, `${phase} ${a.id} en ${sim.roomOf(a)} @${a.u.toFixed(2)},${a.v.toFixed(2)}`).toBe(true);
          n++;
        }
        expect(n).toBeGreaterThan(10);
      }
    }
  });

  it('fila de la cantina: los lugares quedan separados', () => {
    const q = new PeopleSim(42, { crowdSize: 40, detailed: false }).places.queue;
    expect(q.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) expect(Math.hypot(q[i].u - q[j].u, q[i].v - q[j].v)).toBeGreaterThan(0.49);
  });

  it('asientos: sin banquetas contra un mostrador cerrado; sillitas del jardín a su altura', () => {
    const { seats } = new PeopleSim(42, { crowdSize: 40, detailed: false }).places;
    const counters = ITEMS.filter((it) => it.kind === 'counter');
    for (const s of seats) {
      if (s.kind === 'stool') {
        expect(s.y - s.footY).toBeCloseTo(0.48, 3);
        for (const c of counters) {
          if ((c.level ?? 0) !== s.level) continue;
          const qu = s.u + s.fu * 0.3;
          const qv = s.v + s.fv * 0.3;
          expect(Math.abs(qu - c.u) < c.w / 2 && Math.abs(qv - c.v) < c.d / 2, `banqueta en ${s.room} contra un mostrador`).toBe(false);
        }
      }
      if (s.kind === 'chair' && KINDER_ROOMS.has(s.room)) {
        expect(s.small).toBe(true);
        expect(s.y - LEVEL_Y[s.level]).toBeCloseTo(FURNITURE.seat * FURNITURE.smallScale, 3);
      }
    }
  });

  it('nadie se mete en los cestos del patio', () => {
    const sim = new PeopleSim(42, { crowdSize: 90, detailed: false });
    const bins = { u0: 21.65, u1: 23.55, v0: -19.85, v1: -19.35, level: 0 as const };
    setDynamicSolid('test-bins', bins);
    try {
      sim.setPhase('clase');
      run(sim, 20);
      sim.setPhase('recreo');
      let inside = 0;
      for (let t = 0; t < 60; t += 0.1) {
        sim.update(0.1, FAR);
        for (const a of sim.agents) {
          if (a.alive && a.level === 0 && a.u > bins.u0 && a.u < bins.u1 && a.v > bins.v0 && a.v < bins.v1) inside++;
        }
      }
      expect(inside).toBe(0);
    } finally {
      setDynamicSolid('test-bins', null);
    }
  });

  it('escaleras: los que suben en fila no se funden en el descanso', () => {
    const sim = new PeopleSim(42, { crowdSize: 180, detailed: true });
    sim.setPhase('clase');
    let pairs = 0;
    let samples = 0;
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      sim.update(0.1, FAR);
      if (k % 5 !== 0) continue;
      samples++;
      const on = sim.agents.filter((a) => a.alive && a.onStair);
      for (const a of on) {
        let n = 1;
        for (const b of on) {
          if (b === a || Math.abs(b.y - a.y) > 0.5) continue;
          const d = Math.hypot(b.u - a.u, b.v - a.v);
          if (d < 0.2) n++;
          if (b.idx > a.idx && d < 0.15) pairs++;
        }
        worst = Math.max(worst, n);
      }
    }
    expect(worst, 'amontonamiento en la escalera').toBeLessThanOrEqual(3);
    expect(pairs / samples).toBeLessThan(0.6);
  });

  it('nadie de la multitud se mete dentro de un personaje con nombre', () => {
    const sim = new PeopleSim(42, { crowdSize: 180, detailed: true });
    const ines = sim.spawnNamed('ines', { role: 'teacher', seed: 77, hairStyle: 'long' }, { u: 36.7, v: -7.3, level: 0 }, 0);
    let worst = Infinity;
    for (let t = 0; t < 25; t += 0.1) {
      // Todos a la vista (cerca de la cámara): caminan a su paso, sin apuro.
      for (const o of sim.agents) o.visible = true;
      sim.update(0.1, FAR);
      if (t < 4) continue;
      for (const o of sim.agents) {
        if (o === ines || !o.alive || o.level !== 0 || o.seat) continue;
        worst = Math.min(worst, Math.hypot(o.u - ines.u, o.v - ines.v) - o.radius - ines.radius);
      }
    }
    expect(worst).toBeGreaterThan(-0.02);
  });
});

// ======================================================= la gente del barrio

describe('gente del barrio — veredas', () => {
  const plan = generateCityPlan(42);
  const index = new CityIndex(plan);
  const frame = index.school!;
  const laneHalf = (plan.streetWidth * 0.42) / 2;
  const site = plan.schoolSite!;

  /** Calle por la que pasa el punto (en la calzada), si hay alguna. */
  const roadAt = (x: number, z: number): { axis: 'x' | 'z'; at: number } | null => {
    for (const s of plan.streets) {
      const off = s.axis === 'x' ? z - s.at : x - s.at;
      const along = s.axis === 'x' ? x : z;
      const [a, b] = s.span ?? [-1e9, 1e9];
      if (Math.abs(off) < laneHalf && along > a - laneHalf && along < b + laneHalf && !(s.gaps ?? []).some(([g0, g1]) => along > g0 && along < g1)) {
        return { axis: s.axis, at: s.at };
      }
    }
    return null;
  };
  /** ¿Hay una senda peatonal en ese punto de la calzada? */
  const onCrosswalk = (x: number, z: number, road: { axis: 'x' | 'z'; at: number }): boolean => {
    const along = road.axis === 'x' ? x : z;
    return plan.streets.some((p) => p.axis !== road.axis && [-1, 1].some((s) => Math.abs(along - (p.at + s * CROSS_AT)) < CROSS_HALF + 0.05));
  };

  function simulate(seconds: number, check: (w: Walker) => void): Sidewalks {
    const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(180, true));
    sw.camX = 1e4;
    sw.camZ = 1e4;
    for (let t = 0; t < seconds; t += 0.1) {
      sw.update(0.1);
      for (const w of sw.walkers) check(w);
    }
    return sw;
  }

  it('la red: vueltas alrededor de cada manzana del barrio y sendas sólo en las esquinas', () => {
    const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(90, false));
    expect(sw.loops.length).toBe(plan.blocks.filter((b) => !b.landmark).length + 1);
    let n = 0;
    for (const l of sw.loops) {
      for (let k = 0; k < 4; k++) {
        for (const c of l.crossings[k]) {
          n++;
          // Cada senda une dos lados abiertos que miran a la misma calle.
          expect(l.open[k]).toBe(true);
          expect(sw.loops[c.to].open[c.side]).toBe(true);
          expect((k + 2) % 4).toBe(c.side);
          // Y está donde InfraBuilder pinta la cebra: a 6,2 m del eje de la esquina.
          const at = (k % 2 === 0 ? l.cx : l.cz) + c.along;
          const node = k % 2 === 0 ? c.nodeX : c.nodeZ;
          expect(Math.abs(Math.abs(at - node) - CROSS_AT)).toBeLessThan(1e-6);
        }
      }
    }
    expect(n).toBeGreaterThan(40);
    // En el visor caminan ~50 (lo que cuesta es dibujarlos, y eso tiene su
    // tope en `Population`); en escritorio, más.
    expect(sidewalkOptions(90, false).walkers).toBeGreaterThanOrEqual(45);
    expect(sidewalkOptions(90, false).walkers).toBeLessThanOrEqual(55);
    expect(sidewalkOptions(180, true).walkers).toBeGreaterThan(sidewalkOptions(90, false).walkers);
  });

  it('la burbuja: quien camina lejos y fuera de cuadro reaparece cerca de la cámara, en una vereda y fuera del cono', () => {
    // Cámara en Laprida, en la punta este del barrio (lejos de la escuela,
    // donde se junta la gente al empezar), mirando al oeste (+x).
    const cam = { x: -100, z: 28.5, fx: 1, fz: 0 };
    const near = (sw: Sidewalks) => sw.walkers.filter((w) => !w.a.hidden && Math.hypot(w.x - cam.x, w.z - cam.z) < 60).length;
    const run = (bubble: boolean) => {
      const opts = sidewalkOptions(90, false);
      const sw = new Sidewalks(plan, frame, 42, bubble ? opts : { ...opts, bubble: 0 });
      sw.camX = cam.x;
      sw.camZ = cam.z;
      sw.camFX = cam.fx;
      sw.camFZ = cam.fz;
      const before = near(sw);
      const last = new Map<Walker, [number, number]>();
      let moved = 0;
      let front = 0;
      const bad: string[] = [];
      for (let t = 0; t < 60; t += 1 / 30) {
        sw.update(1 / 30);
        for (const w of sw.walkers) {
          const p = last.get(w);
          last.set(w, [w.x, w.z]);
          if (!p || Math.hypot(w.x - p[0], w.z - p[1]) < 4) continue;
          // Un salto: es la burbuja. Sobre la vereda y donde no se lo ve
          // aparecer: adelante pero más allá de la distancia de dibujo del
          // visor (80 m), o a 22–68 m fuera del cono de la mirada.
          moved++;
          const dx = w.x - cam.x;
          const dz = w.z - cam.z;
          const d = Math.hypot(dx, dz);
          const inCone = (dx * cam.fx + dz * cam.fz) / d > 0.2;
          if (inCone ? d < 80.4 || d > 90 : d < 20 || d > 70) bad.push(`${w.a.id} a ${d.toFixed(1)} m${inCone ? ' en el cono' : ''}`);
          if (inCone) front++;
          if (index.isPedestrianBlocked(w.x, w.z) || roadAt(w.x, w.z)) bad.push(`${w.a.id} fuera de la vereda en (${w.x.toFixed(1)}, ${w.z.toFixed(1)})`);
          if (w.lead && Math.hypot(w.x - w.lead.x, w.z - w.lead.z) > 1.2) bad.push(`${w.a.id} lejos de su pareja`);
        }
      }
      return { before, after: near(sw), moved, front, bad };
    };
    const off = run(false);
    const on = run(true);
    expect(off.moved).toBe(0);
    expect(on.bad.slice(0, 6)).toEqual([]);
    expect(on.moved).toBeGreaterThan(10);
    // Una parte entra por el fondo de la calle que se mira.
    expect(on.front).toBeGreaterThan(3);
    expect(on.front).toBeLessThan(on.moved);
    // Sin burbuja, en la otra punta del barrio hay poca gente; con, el doble o más.
    expect(on.after).toBeGreaterThanOrEqual(Math.max(off.after * 2, off.after + 12));
    // Desde arriba (volando) no se mueve a nadie: se vería.
    const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(90, false));
    sw.camX = cam.x;
    sw.camZ = cam.z;
    sw.camY = 45;
    const pos0 = sw.walkers.map((w) => [w.x, w.z]);
    for (let t = 0; t < 1.5; t += 1 / 30) sw.update(1 / 30);
    expect(sw.walkers.every((w, i) => Math.hypot(w.x - pos0[i][0], w.z - pos0[i][1]) < 4)).toBe(true);
  });

  it('caminan por las veredas: nunca dentro de una manzana ni de la escuela, y cruzan sólo por las sendas', () => {
    let crossings = 0;
    let roadSamples = 0;
    const onRoad = new Set<Walker>();
    const bad: string[] = [];
    const fail = (w: Walker, what: string) => {
      if (bad.length < 6) bad.push(`${w.a.id} ${what} en (${w.x.toFixed(1)}, ${w.z.toFixed(1)}) modo ${w.mode}`);
    };
    const sw = simulate(360, (w) => {
      if (w.a.hidden) return;
      const { x, z } = w;
      // Nada de edificios, ni la escuela ni la vereda de Laprida de la escuela.
      if (index.isPedestrianBlocked(x, z)) fail(w, 'bloqueado');
      // (Salvo sentado en un banco de la explanada de un edificio cívico.)
      const plaza = w.mode === 'sit' && plan.benches.some((b) => b.kind === 'plaza' && Math.hypot(b.x - x, b.z - z) < 1);
      for (const b of plan.blocks) {
        if (!plaza && !b.landmark && Math.abs(x - b.cx) < b.width / 2 - 0.05 && Math.abs(z - b.cz) < b.depth / 2 - 0.05) fail(w, `dentro de la manzana ${b.kind}`);
      }
      if (x > site.x0 && x < site.x1 && z > site.z0 && z < site.z1) fail(w, 'dentro del predio');
      if (x > site.x0 - 1 && x < site.x1 + 1 && z > site.z1 && z < site.z1 + 7.5 - laneHalf) fail(w, 'en la vereda de la escuela sobre Laprida');
      const road = roadAt(x, z);
      if (road) {
        roadSamples++;
        if (w.mode !== 'cross') fail(w, 'en la calzada sin cruzar');
        else if (!onCrosswalk(x, z, road)) fail(w, 'cruza fuera de la senda');
        if (!onRoad.has(w)) {
          onRoad.add(w);
          crossings++;
        }
      } else onRoad.delete(w);
      // Los pies, sobre el piso: vereda elevada, rampa o calzada.
      if (w.y < -0.01 || w.y > 0.21) fail(w, `con los pies a ${w.y.toFixed(2)}`);
    });
    expect(bad).toEqual([]);
    expect(crossings).toBeGreaterThan(20);
    expect(roadSamples).toBeGreaterThan(100);
    // Las parejas van juntas.
    for (const w of sw.walkers) if (w.lead && !w.a.hidden) expect(Math.hypot(w.x - w.lead.x, w.z - w.lead.z)).toBeLessThan(1.2);
  }, 60000);

  it('en las esquinas con semáforo cruzan con el rojo de los autos', () => {
    const traffic = new TrafficSim(plan, 42, { lite: true });
    const viewer = { x: 1e4, y: 1.7, z: 1e4, fx: 0, fz: 1 };
    const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(180, true));
    sw.camX = 1e4;
    sw.camZ = 1e4;
    const went = new Map<Walker, boolean>();
    let checked = 0;
    for (let t = 0; t < 300; t += 0.05) {
      traffic.step(0.05, viewer);
      sw.update(0.05);
      for (const w of sw.walkers) {
        if (w.lead) continue;
        const was = went.get(w) ?? false;
        const now = w.mode === 'cross' && w.go;
        went.set(w, now);
        if (!now || was || !w.cross!.signal) continue;
        const c = w.cross!;
        const node = traffic.net.nodes.find((n) => Math.abs(n.x - c.nodeX) < 0.5 && Math.abs(n.z - c.nodeZ) < 0.5);
        expect(node).toBeTruthy();
        expect(traffic.light(node!.id, c.axis)).toBe('red');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('parados: gente en las paradas de colectivo, en el kiosco y charlando; chicos con sus padres sólo en entrada y salida', () => {
    const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(90, false));
    const sitting = sw.walkers.filter((w) => w.mode === 'sit' && w.a.id.startsWith('street-bus'));
    expect(sitting.length).toBeGreaterThanOrEqual(plan.props.filter((p) => p.kind === 'busStop').length);
    for (const w of sitting) {
      // Sobre el banco del refugio.
      expect(plan.props.some((p) => p.kind === 'busStop' && Math.hypot(p.x - w.x, p.z - w.z) < 1.9)).toBe(true);
      expect(w.a.seatY).toBeCloseTo(0.71, 2);
    }
    expect(sw.walkers.filter((w) => w.group).length).toBeGreaterThanOrEqual(6);
    const kids = sw.walkers.filter((w) => w.schoolKid);
    expect(kids.length).toBeGreaterThan(0);
    for (const k of kids) expect(k.a.look.age === 'kid' || k.a.look.age === 'child').toBe(true);
    // Ropa de calle: ningún adulto de guardapolvo.
    for (const w of sw.walkers) if (!w.schoolKid) expect(w.a.look.torsoPart === 'smock').toBe(false);
    // Clase: los chicos ya entraron (se van fuera de cuadro).
    sw.camX = 1e4;
    sw.camZ = 1e4;
    sw.setPhase('clase');
    for (let t = 0; t < 5; t += 0.1) sw.update(0.1);
    for (const k of kids) expect(k.a.hidden).toBe(true);
    sw.setPhase('salida');
    for (let t = 0; t < 5; t += 0.1) sw.update(0.1);
    for (const k of kids) expect(k.a.hidden).toBe(false);
  });

  it('sendas sin semáforo: zebraBusy avisa mientras alguien cruza (y un poco antes de bajar)', () => {
    const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(180, true));
    sw.camX = 1e4;
    sw.camZ = 1e4;
    let onRoad = 0;
    let early = 0;
    for (let t = 0; t < 240; t += 0.1) {
      sw.update(0.1);
      for (const w of sw.walkers) {
        if (w.lead || w.a.hidden || w.mode !== 'cross' || !w.cross || w.cross.signal) continue;
        const c = w.cross;
        const l = sw.loops[w.loop];
        // Centro de la cebra: sobre el eje de la calle, a 6,2 m de la esquina.
        const zx = c.axis === 'x' ? l.cx + c.along : c.nodeX;
        const zz = c.axis === 'x' ? c.nodeZ : l.cz + c.along;
        if (roadAt(w.x, w.z)) {
          onRoad++;
          expect(sw.zebraBusy(zx, zz, c.axis)).toBe(true);
          // Desde 15 m antes (un auto que se acerca), la misma cebra.
          expect(sw.zebraBusy(zx + (c.axis === 'x' ? 15 : 0), zz + (c.axis === 'z' ? 15 : 0), c.axis) || sw.zebraBusy(zx - (c.axis === 'x' ? 15 : 0), zz - (c.axis === 'z' ? 15 : 0), c.axis)).toBe(true);
        } else if (w.go && w.cs < c.edgeFrom - w.cLat - laneHalf && sw.zebraBusy(zx, zz, c.axis)) early++;
      }
      // Una cebra sin nadie cruzando (ni por cruzar) está libre.
      for (let i = 0; i < sw.zebras.length; i++) {
        const q = sw.zebras[i];
        if (sw.walkers.some((w) => w.mode === 'cross' && w.cross?.zebra === i)) continue;
        expect(sw.zebraBusy(q.x, q.z, q.axis)).toBe(false);
      }
    }
    expect(onRoad).toBeGreaterThan(30);
    expect(early).toBeGreaterThan(0);
    // Cada cebra está una sola vez (los dos sentidos comparten la suya), y
    // donde la pinta InfraBuilder: a 6,2 m del eje de una esquina.
    for (const q of sw.zebras) {
      const along = q.axis === 'x' ? q.x : q.z;
      expect(plan.streets.some((p) => p.axis !== q.axis && Math.abs(Math.abs(along - p.at) - CROSS_AT) < 1e-6)).toBe(true);
      expect(sw.zebras.filter((o) => o.axis === q.axis && Math.hypot(o.x - q.x, o.z - q.z) < 1).length).toBe(1);
    }
  });

  it('al jugador lo esquivan (o lo esperan): nadie que camina le pasa a menos de 0,6 m', () => {
    for (const detailed of [true, false]) {
      const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(detailed ? 180 : 90, detailed));
      sw.camX = 1e4;
      sw.camZ = 1e4;
      // Parado 5 m delante de algunos que caminan, en su mismo carril.
      const spots = sw.walkers.filter((w) => w.mode === 'walk' && !w.lead).slice(0, 14).map((w) => [w.x + (w.side % 2 === 0 ? w.dir * 5 : 0), w.z + (w.side % 2 === 0 ? 0 : w.dir * 5)]);
      let worst = Infinity;
      let near = 0;
      for (const [px, pz] of spots) {
        sw.playerX = px;
        sw.playerZ = pz;
        for (let t = 0; t < 25; t += 0.1) {
          sw.update(0.1);
          if (t < 1) continue;
          for (const w of sw.walkers) {
            if (w.a.hidden || w.mode === 'sit' || w.mode === 'stand') continue;
            const d = Math.hypot(w.x - px, w.z - pz);
            if (d < 2) near++;
            worst = Math.min(worst, d);
          }
        }
      }
      expect(near, 'nadie pasó cerca: la prueba no prueba nada').toBeGreaterThan(20);
      expect(worst).toBeGreaterThan(0.6);
    }
  });

  it('las parejas se ponen en fila para cruzarse con alguien: de frente, nunca a menos de 0,4 m', () => {
    const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(180, true));
    sw.camX = 1e4;
    sw.camZ = 1e4;
    let worst = Infinity;
    let filed = 0;
    for (let t = 0; t < 200; t += 0.1) {
      sw.update(0.1);
      if (t < 3) continue;
      const ws = sw.walkers;
      for (let i = 0; i < ws.length; i++) {
        const a = ws[i];
        if (a.a.hidden || a.mode !== 'walk') continue;
        if (a.mate && a.singleT > 0) filed++;
        for (let j = i + 1; j < ws.length; j++) {
          const b = ws[j];
          if (b.a.hidden || b.mode !== 'walk' || a.dir === b.dir || a.loop !== b.loop || a.side !== b.side) continue;
          worst = Math.min(worst, Math.hypot(a.x - b.x, a.z - b.z));
        }
      }
    }
    expect(filed).toBeGreaterThan(100);
    expect(worst).toBeGreaterThan(0.4);
  });

  it('bancos del plano: algunos con gente sentada encima, a la altura de la tapa', () => {
    for (const detailed of [true, false]) {
      const sw = new Sidewalks(plan, frame, 42, sidewalkOptions(detailed ? 180 : 90, detailed));
      const seated = sw.walkers.filter((w) => w.a.id.startsWith('street-bench'));
      expect(seated.length).toBeGreaterThanOrEqual(sidewalkOptions(90, detailed).benches);
      for (const w of seated) {
        expect(w.mode).toBe('sit');
        // Sobre un banco de vereda o de explanada (no los de las paradas).
        const b = plan.benches.find((b) => b.kind !== 'stop' && Math.hypot(b.x - w.x, b.z - w.z) < 0.6);
        expect(b, w.a.id).toBeTruthy();
        expect(w.a.seatY).toBeCloseTo(0.69, 2);
        // De frente a donde mira el banco (±0,3 rad: de a dos, se miran un poco).
        expect(Math.abs(Math.atan2(Math.sin(w.a.yaw - b!.rotY), Math.cos(w.a.yaw - b!.rotY)))).toBeLessThan(0.3);
      }
      // Nadie se sienta dos veces en el mismo lugar.
      for (const a of seated) for (const b of seated) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.5);
    }
  });

  it('determinista: misma semilla, mismas veredas', () => {
    const pos = () => {
      const sw = new Sidewalks(plan, frame, 7, sidewalkOptions(90, false));
      sw.camX = 1e4;
      for (let t = 0; t < 60; t += 0.1) sw.update(0.1);
      return sw.walkers.map((w) => `${w.x.toFixed(3)},${w.z.toFixed(3)}`).join(';');
    };
    expect(pos()).toBe(pos());
  });
});
