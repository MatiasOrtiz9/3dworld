import { describe, it, expect } from 'vitest';
import { PeopleSim, composition, type Agent, type SimView } from '../src/world/people/Sim';
import { evalPose, newAnimState, setBase, POSE_N, SIT } from '../src/world/people/Anim';
import { Rig, F_FARM_R, F_SHIN_L, F_SHIN_R } from '../src/world/people/Rig';
import { bodyDims, makeAppearance } from '../src/world/people/Looks';
import { treadFloor } from '../src/world/people/Places';
import { Rng } from '../src/utils/rng';
import { FURNITURE, LEVEL_Y, STAIRS, roomAt, stairY } from '../src/world/SchoolLayout';

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
        }
      }
    }
  });
});
