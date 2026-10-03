import { describe, it, expect } from 'vitest';
import { CROSS_AT, generateCityPlan, type CityPlan } from '../src/world/CityLayout';
import { buildRoadNet, ROADWAY_FRACTION, ZEBRA_HALF } from '../src/world/life/roadNet';
import { TrafficSim, type Vehicle, type TrafficEvent } from '../src/world/life/traffic';

/**
 * El tránsito del barrio: los autos andan por su carril, sobre el asfalto que
 * se ve, nunca por la vereda ni a través de la escuela, no se superponen,
 * respetan los semáforos y no se traban.
 */

/** ¿El punto está sobre alguna calzada (o en un cruce)? `tol` en metros. */
function onRoadway(plan: CityPlan, x: number, z: number, tol: number): boolean {
  for (const st of plan.streets) {
    const half = (st.width * ROADWAY_FRACTION) / 2 + tol;
    const along = st.axis === 'x' ? x : z;
    const across = st.axis === 'x' ? z : x;
    if (Math.abs(across - st.at) > half) continue;
    const [a, b] = st.span ?? [-plan.extent, plan.extent];
    // Los carriles salen RUNOUT metros afuera por los bordes del barrio.
    if (along < a - 30 || along > b + 30) continue;
    if ((st.gaps ?? []).some(([g0, g1]) => along > g0 + tol && along < g1 - tol)) continue;
    return true;
  }
  return false;
}

function inSchool(plan: CityPlan, x: number, z: number): boolean {
  const s = plan.schoolSite!;
  return x > s.x0 + 0.5 && x < s.x1 - 0.5 && z > s.z0 + 0.5 && z < s.z1 - 0.5;
}

/** Esquinas del rectángulo de un vehículo. */
function corners(v: Vehicle): Array<[number, number]> {
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  const rx = fz;
  const rz = -fx;
  const l = v.spec.len / 2;
  const w = v.spec.width / 2;
  return [
    [v.x + fx * l + rx * w, v.z + fz * l + rz * w],
    [v.x + fx * l - rx * w, v.z + fz * l - rz * w],
    [v.x - fx * l + rx * w, v.z - fz * l + rz * w],
    [v.x - fx * l - rx * w, v.z - fz * l - rz * w],
  ];
}

/** Superposición de dos rectángulos orientados (ejes separadores). */
function overlap(a: Vehicle, b: Vehicle, shrink: number): boolean {
  const axes = [a.yaw, b.yaw].flatMap((y) => [
    [Math.sin(y), Math.cos(y)],
    [Math.cos(y), -Math.sin(y)],
  ]);
  const ca = corners(a);
  const cb = corners(b);
  for (const [ax, az] of axes) {
    const pa = ca.map(([x, z]) => x * ax + z * az);
    const pb = cb.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) - shrink < Math.min(...pb) || Math.max(...pb) - shrink < Math.min(...pa))
      return false;
  }
  return true;
}

const viewer = { x: -40, z: 32, fx: -1, fz: 0 };

/** ¿La caja del vehículo pisa el rectángulo alineado [x0,x1]×[z0,z1]? (ejes separadores) */
function boxOverlapsRect(v: Vehicle, x0: number, x1: number, z0: number, z1: number): boolean {
  const c = corners(v);
  const xs = c.map((p) => p[0]);
  const zs = c.map((p) => p[1]);
  if (Math.max(...xs) < x0 || Math.min(...xs) > x1) return false;
  if (Math.max(...zs) < z0 || Math.min(...zs) > z1) return false;
  const rect: Array<[number, number]> = [
    [x0, z0],
    [x1, z0],
    [x0, z1],
    [x1, z1],
  ];
  for (const y of [v.yaw, v.yaw + Math.PI / 2]) {
    const ax = Math.sin(y);
    const az = Math.cos(y);
    const pa = c.map(([x, z]) => x * ax + z * az);
    const pb = rect.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

type Rect = [number, number, number, number];

/** Cebras de una esquina: rectángulo [x0, x1, z0, z1], eje de la calle que cruzan y lado. */
function zebraRects(n: {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}): Array<{ r: Rect; axis: 'x' | 'z'; s: number }> {
  const out: Array<{ r: Rect; axis: 'x' | 'z'; s: number }> = [];
  for (const s of [-1, 1]) {
    const cx = n.x + s * CROSS_AT;
    out.push({ r: [cx - ZEBRA_HALF, cx + ZEBRA_HALF, n.z - n.halfX, n.z + n.halfX], axis: 'x', s });
    const cz = n.z + s * CROSS_AT;
    out.push({ r: [n.x - n.halfZ, n.x + n.halfZ, cz - ZEBRA_HALF, cz + ZEBRA_HALF], axis: 'z', s });
  }
  return out;
}

describe('red de calles', () => {
  it('los carriles van por la calzada, a la derecha, y nadie cruza el predio escolar', () => {
    for (const seed of [1, 42, 2050]) {
      const plan = generateCityPlan(seed);
      const net = buildRoadNet(plan);
      expect(net.paths.length).toBeGreaterThan(20);
      for (const p of net.paths) {
        for (let i = 0; i < p.xs.length; i++) {
          // Medio ancho de un auto (0,9 m) más un margen: el auto entero
          // cabe en la calzada.
          expect(
            onRoadway(plan, p.xs[i], p.zs[i], p.kind === 'turn' ? -0.45 : -0.6),
            `${p.kind} ${p.id} (${p.xs[i]}, ${p.zs[i]})`,
          ).toBe(true);
          expect(inSchool(plan, p.xs[i], p.zs[i])).toBe(false);
        }
        if (p.kind === 'lane') {
          // Mano derecha: el carril queda a la derecha del eje de su calle.
          const st = plan.streets[p.street];
          const across = st.axis === 'x' ? p.zs[0] - st.at : p.xs[0] - st.at;
          const right = st.axis === 'x' ? -p.hx : p.hz;
          expect(Math.sign(across)).toBe(Math.sign(right));
        }
      }
    }
  });

  it('los cruces de cuatro brazos tienen semáforo y las T, calle con prioridad', () => {
    const net = buildRoadNet(generateCityPlan(42));
    const signals = net.nodes.filter((n) => n.signal);
    expect(signals.length).toBeGreaterThanOrEqual(4);
    for (const n of net.nodes.filter((n) => n.arms.length === 3)) {
      const stops = net.paths.filter((p) => p.kind === 'lane' && p.endNode === n.id && p.mustStop);
      expect(stops.length).toBe(1);
    }
  });

  it('quien espera la esquina lo hace detrás de la senda (no sobre la cebra)', () => {
    const net = buildRoadNet(generateCityPlan(42));
    let free = 0;
    for (const p of net.paths) {
      if (p.kind !== 'lane' || p.endNode < 0) continue;
      const n = net.nodes[p.endNode];
      const end = p.axis === 'x' ? p.xs[p.xs.length - 1] - n.x : p.zs[p.zs.length - 1] - n.z;
      // Trompa en la línea de detención: distancia al centro de la esquina.
      const line = Math.abs(end) + p.stopBack;
      expect(line, `carril ${p.id}`).toBeGreaterThanOrEqual(CROSS_AT + ZEBRA_HALF);
      if (!n.signal) free++;
    }
    expect(free).toBeGreaterThan(20);
  });
});

describe('tránsito', () => {
  const run = (seed: number, lite: boolean, seconds: number) => {
    const plan = generateCityPlan(seed);
    const sim = new TrafficSim(plan, seed, { lite });
    const events: TrafficEvent[] = [];
    sim.setOnEvent((e) => events.push(e));
    const travelled = new Map<number, number>();
    const last = new Map<number, [number, number]>();
    let overlaps = 0;
    let offRoad = 0;
    const offRoadSamples: string[] = [];
    let maxStill = 0;
    const still = new Map<number, number>();
    const dt = 1 / 30;
    for (let f = 0; f < seconds * 30; f++) {
      sim.step(dt, viewer);
      const act = sim.vehicles.filter((v) => v.active);
      for (const v of act) {
        const prev = last.get(v.id);
        if (prev)
          travelled.set(
            v.id,
            (travelled.get(v.id) ?? 0) + Math.hypot(v.x - prev[0], v.z - prev[1]),
          );
        last.set(v.id, [v.x, v.z]);
        const s = v.v < 0.05 ? (still.get(v.id) ?? 0) + dt : 0;
        still.set(v.id, s);
        // El colectivo en la parada no cuenta como trabado.
        if (v.dwell <= 0) maxStill = Math.max(maxStill, s);
      }
      if (f % 3 === 0) {
        for (let i = 0; i < act.length; i++) {
          for (let j = i + 1; j < act.length; j++) {
            if (Math.abs(act[i].x - act[j].x) > 14 || Math.abs(act[i].z - act[j].z) > 14) continue;
            if (overlap(act[i], act[j], 0.08)) overlaps++;
          }
          // El voladizo trasero del colectivo pasa por encima del cordón al
          // doblar (como uno real); las ruedas, nunca.
          const tol = act[i].kind === 'bus' ? 0.5 : 0.3;
          for (const [x, z] of corners(act[i])) {
            if (!onRoadway(plan, x, z, tol) || inSchool(plan, x, z)) {
              offRoad++;
              if (offRoadSamples.length < 5)
                offRoadSamples.push(
                  `${act[i].kind} path ${act[i].path} (${x.toFixed(2)}, ${z.toFixed(2)})`,
                );
            }
          }
        }
      }
    }
    return { sim, events, travelled, overlaps, offRoad, offRoadSamples, maxStill };
  };

  it('nadie se superpone, nadie sube a la vereda y el tránsito fluye', () => {
    for (const [seed, lite] of [
      [42, false],
      [7, true],
    ] as const) {
      const r = run(seed, lite, 180);
      expect(r.overlaps, 'superposiciones').toBe(0);
      expect(r.offRoad, r.offRoadSamples.join(' | ')).toBe(0);
      // Nadie queda parado más de un minuto (un rojo dura ~19 s).
      expect(r.maxStill).toBeLessThan(60);
      const dists = [...r.travelled.values()];
      const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
      // A 30 km/h con esquinas y semáforos: más de 2,5 m/s de promedio.
      expect(mean / 180).toBeGreaterThan(2.5);
      expect(r.sim.activeCount).toBeGreaterThanOrEqual(r.sim.vehicles.length * 0.8);
    }
  });

  it('el colectivo para en su parada', () => {
    const r = run(42, true, 240);
    expect(r.events.filter((e) => e === 'busStop').length).toBeGreaterThan(0);
    expect(r.sim.stops.length).toBe(2);
  });

  it('con rojo no se entra al cruce', () => {
    const plan = generateCityPlan(42);
    const sim = new TrafficSim(plan, 42, { lite: false });
    let violations = 0;
    const dt = 1 / 30;
    const prevPath = new Map<number, number>();
    for (let f = 0; f < 120 * 30; f++) {
      sim.step(dt, viewer);
      for (const v of sim.vehicles) {
        if (!v.active) continue;
        const before = prevPath.get(v.id);
        prevPath.set(v.id, v.path);
        if (before === undefined || before === v.path) continue;
        const from = sim.net.paths[before];
        const to = sim.net.paths[v.path];
        // Entró a un giro desde un carril con semáforo: tenía que estar en
        // verde o en amarillo (pasa quien no llega a frenar).
        if (
          from.kind === 'lane' &&
          to.kind === 'turn' &&
          from.endNode >= 0 &&
          sim.net.nodes[from.endNode].signal
        ) {
          if (sim.light(from.endNode, from.axis) === 'red') {
            // Reservó en verde/amarillo y entra apenas cambió: tolerado sólo en el todo rojo.
            const t = sim.greenLeft(from.endNode, from.axis);
            if (t === 0 && v.v < 3) violations++;
          }
        }
      }
    }
    expect(violations).toBe(0);
  });
});

describe('peatones y tránsito', () => {
  it('con semáforo, la gente cruza sólo con el rojo de esa calle; sin semáforo, siempre', () => {
    const plan = generateCityPlan(42);
    const sim = new TrafficSim(plan, 42, { lite: true });
    const sig = sim.net.nodes.find((n) => n.signal)!;
    const free = sim.net.nodes.find((n) => !n.signal)!;
    let go = 0;
    let freeGo = 0;
    for (let f = 0; f < 64 * 10; f++) {
      sim.step(0.1, viewer);
      for (const axis of ['x', 'z'] as const) {
        // Se consulta desde la cebra, no desde el centro de la esquina.
        if (!sim.pedestrianGo(sig.x + 6.2, sig.z, axis)) continue;
        go++;
        expect(sim.light(sig.id, axis), `t=${f / 10}`).toBe('red');
        const other = axis === 'x' ? 'z' : 'x';
        expect(sim.greenLeft(sig.id, other)).toBeGreaterThan(3.9);
      }
      if (sim.pedestrianGo(free.x, free.z + 6.2, 'z')) freeGo++;
    }
    // Sin semáforo se cruza casi siempre: sólo se espera al que pisa la cebra.
    expect(freeGo / (64 * 10)).toBeGreaterThan(0.7);
    // Ventana de 8 s por eje cada 32 s: un cuarto del tiempo, por eje (0,5
    // sumando los dos), menos los ratos en que un auto que dobla con verde
    // pisa la senda o ya no llega a frenar (acá nadie le cede: no hay gente).
    expect(go / (64 * 10)).toBeGreaterThan(0.3);
    expect(go / (64 * 10)).toBeLessThan(0.6);
  });

  it('en las sendas sin semáforo los autos ceden el paso y no pisan la cebra ocupada', () => {
    const plan = generateCityPlan(42);
    const sim = new TrafficSim(plan, 42, { lite: false });
    // Cebras ocupadas: todas las de las esquinas sin semáforo, de a ratos.
    const free = sim.net.nodes.filter((n) => !n.signal);
    expect(free.length).toBeGreaterThan(0);
    let busy = false;
    const near = (x: number, z: number) =>
      free.some((n) => Math.abs(n.x - x) < 7 && Math.abs(n.z - z) < 7);
    let calls = 0;
    sim.setZebraBusy((x, z) => {
      calls++;
      return busy && near(x, z);
    });
    let onZebra = 0;
    const dt = 1 / 30;
    for (let f = 0; f < 150 * 30; f++) {
      // 10 s ocupadas cada 25 s.
      const t = f * dt;
      const was = busy;
      busy = t % 25 > 12 && t % 25 < 22;
      sim.step(dt, viewer);
      // Mientras están ocupadas (dando 2 s para frenar a quien ya venía),
      // ninguna trompa entra a la franja de una cebra de esas esquinas.
      if (!busy || !was || t % 25 < 14) continue;
      for (const v of sim.vehicles) {
        if (!v.active || v.kind === 'bike') continue;
        const fx = v.x + Math.sin(v.yaw) * (v.spec.len / 2);
        const fz = v.z + Math.cos(v.yaw) * (v.spec.len / 2);
        for (const n of free) {
          const ax = Math.abs(fx - n.x);
          const az = Math.abs(fz - n.z);
          const inX = ax > 4.9 && ax < 7.5 && az < 3.2;
          const inZ = az > 4.9 && az < 7.5 && ax < 3.2;
          if ((inX || inZ) && v.v > 0.5) onZebra++;
        }
      }
    }
    expect(calls).toBeGreaterThan(0);
    // Quien ya estaba encima cuando se ocupó la termina de cruzar: casi nadie.
    expect(onZebra).toBeLessThan(30);
  });
});

describe('esquinas sin semáforo: autos y gente no se atraviesan', () => {
  it('nadie queda parado sobre una cebra y la gente no baja con un auto encima', () => {
    const plan = generateCityPlan(42);
    const sim = new TrafficSim(plan, 42, { lite: false });
    const free = sim.net.nodes.filter((n) => !n.signal);
    const rects = free.flatMap((n) => zebraRects(n).map((z) => ({ ...z, n })));
    // Gente cruzando de a ratos en todas las sendas sin semáforo.
    let busy = false;
    sim.setZebraBusy(() => busy);
    let stopped = 0;
    let goOnCar = 0;
    let goes = 0;
    const samples: string[] = [];
    const dt = 1 / 30;
    for (let f = 0; f < 150 * 30; f++) {
      busy = (f * dt) % 20 > 12;
      sim.step(dt, viewer);
      if (f % 3) continue;
      for (const z of rects) {
        const go = sim.pedestrianGo(
          z.axis === 'x' ? z.n.x + z.s * CROSS_AT : z.n.x,
          z.axis === 'x' ? z.n.z : z.n.z + z.s * CROSS_AT,
          z.axis,
        );
        if (go) goes++;
        for (const v of sim.vehicles) {
          if (!v.active || !boxOverlapsRect(v, ...z.r)) continue;
          if (v.v < 0.3 && !v.committed && sim.net.paths[v.path].kind === 'lane') {
            stopped++;
            if (samples.length < 4) samples.push(`${v.kind} (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`);
          }
          if (go) {
            goOnCar++;
            if (samples.length < 6)
              samples.push(
                `GO ${v.kind} ${sim.net.paths[v.path].kind} v${v.v.toFixed(1)} c${v.committed} (${v.x.toFixed(1)}, ${v.z.toFixed(1)}) yaw${v.yaw.toFixed(2)} z${z.axis}${z.s} n(${z.n.x},${z.n.z})`,
              );
          }
        }
      }
    }
    // Ningún auto esperando un hueco con la caja sobre la senda.
    expect(stopped, samples.join(' | ')).toBe(0);
    // Con un vehículo encima de la cebra, la gente espera en el cordón.
    expect(goOnCar, samples.join(' | ')).toBe(0);
    expect(goes).toBeGreaterThan(0);
  });
});

describe('el jugador en la calle', () => {
  it('los autos frenan antes del jugador parado en la calzada y no lo atraviesan', () => {
    const plan = generateCityPlan(42);
    const sim = new TrafficSim(plan, 42, { lite: true });
    const li = plan.streets.findIndex((s) => s.name === 'Laprida');
    const laprida = plan.streets[li];
    // Mano sur de Laprida (rumbo −x), entre la escuela y Gral. Acha: ahí el
    // jugador quedaba adentro de un auto parado en la cola del semáforo.
    const lane = sim.net.paths.find(
      (p) => p.kind === 'lane' && p.street === li && p.zs[0] > laprida.at,
    )!;
    expect(lane.hx).toBe(-1);
    const me = { x: -61.6, y: 1.78, z: lane.zs[0], fx: 1, fz: 0 };
    const dt = 1 / 30;
    const inside = (v: Vehicle, m: number) => {
      const dx = me.x - v.x;
      const dz = me.z - v.z;
      const along = Math.abs(dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw));
      const lat = Math.abs(dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw));
      return along < v.spec.len / 2 + m && lat < v.spec.width / 2 + m;
    };
    // Primero sin jugador; se planta en la calle cuando no hay nadie encima.
    for (let f = 0; f < 20 * 30 || sim.vehicles.some((v) => v.active && inside(v, 0.6)); f++) {
      sim.step(dt, { ...me, y: undefined });
    }
    let hits = 0;
    let blocked = 0;
    for (let k = 0; k < 120 * 30; k++) {
      sim.step(dt, me);
      for (const v of sim.vehicles) {
        if (!v.active) continue;
        if (inside(v, 0.25)) hits++;
        const dx = v.x - me.x;
        if (Math.abs(v.z - me.z) < 1 && dx > 0 && dx < 12 && v.v < 0.05) blocked++;
      }
    }
    expect(hits).toBe(0);
    // Alguien llegó y se quedó esperando delante del jugador.
    expect(blocked).toBeGreaterThan(0);
    // En la vereda (o volando), el jugador no frena a nadie.
    const side = { x: me.x, y: 1.95, z: laprida.at + 4.5, fx: 1, fz: 0 };
    const sky = { x: me.x, y: 45, z: me.z, fx: 1, fz: 0 };
    for (const w of [side, sky]) {
      const a = new TrafficSim(plan, 42, { lite: true });
      const b = new TrafficSim(plan, 42, { lite: true });
      for (let k = 0; k < 30 * 30; k++) {
        a.step(dt, w);
        b.step(dt, { ...w, y: undefined });
      }
      expect(a.vehicles.map((v) => v.s)).toEqual(b.vehicles.map((v) => v.s));
    }
  });
});
