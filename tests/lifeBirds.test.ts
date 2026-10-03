import { describe, it, expect } from 'vitest';
import { generateCityPlan } from '../src/world/CityLayout';
import { BirdSim, pigeonSpots } from '../src/world/life/birdSim';

/**
 * Pájaros del barrio: las bandadas cruzan por encima de los techos y lejos de
 * la torre; las palomas de la vereda levantan vuelo cuando el jugador se
 * acerca y vuelven a bajar cuando se va.
 */
describe('pájaros', () => {
  const plan = generateCityPlan(42);
  const tower = plan.blocks.find((b) => b.kind === 'tower')!;

  it('las bandadas vuelan sobre los techos y no atraviesan la torre', () => {
    const sim = new BirdSim(plan, 42, pigeonSpots(plan, false), () => 0, false);
    const far = { x: 500, y: 1.7, z: 500 };
    const low = new Set(sim.lowBirds);
    let seen = 0;
    for (let f = 0; f < 120 * 20; f++) {
      sim.step(1 / 20, far);
      for (const [i, p] of sim.poses.entries()) {
        if (low.has(i)) continue; // la pasada baja de cotorras, aparte
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
        if (!p.visible || (p.plumage === 'pigeon' && !p.wings)) continue;
        if (p.plumage === 'pigeon' && p.y < 20) continue; // palomas de la vereda en vuelo bajo
        seen++;
        // Más alto que cualquier vivienda (23 m) y, cerca de la torre, por encima de ella.
        expect(p.y).toBeGreaterThan(25);
        const half = (tower.footprint ?? 24) * 0.83 + 4;
        if (Math.abs(p.x - tower.cx) < half && Math.abs(p.z - tower.cz) < half)
          expect(p.y).toBeGreaterThan(tower.height);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('las cotorras pasan bajo por la calle del jugador, entre las copas, y nunca sobre las manzanas', () => {
    const sim = new BirdSim(plan, 42, pigeonSpots(plan, true), () => 0, true);
    const low = sim.lowBirds;
    expect(low.length).toBeGreaterThan(2);
    const laprida = plan.streets.find((s) => s.name === 'Laprida')!;
    const viewer = { x: -20, y: 1.7, z: laprida.at + 4 };
    let calls = 0;
    sim.setOnParrots(() => calls++);
    let overhead = 0;
    for (let f = 0; f < 150 * 20; f++) {
      sim.step(1 / 20, viewer);
      for (const i of low) {
        const p = sim.poses[i];
        if (!p.visible) continue;
        // Bajo los techos (menos de 25 m) sólo sobre la calzada de Laprida.
        if (p.y < 25) expect(Math.abs(p.z - laprida.at)).toBeLessThan(3.5);
        expect(p.y).toBeGreaterThan(9);
        if (Math.abs(p.x - viewer.x) < 6 && p.y < 16) overhead++;
      }
    }
    // Varias pasadas en dos minutos y medio, cada una con su aviso.
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(overhead).toBeGreaterThan(0);
  });

  it('las palomas vuelan si uno se acerca y vuelven a la vereda', () => {
    const spots = pigeonSpots(plan, true);
    const sim = new BirdSim(plan, 7, spots, () => 0.2, true);
    const sp = spots[0];
    const away = { x: sp.x + 40, y: 1.7, z: sp.z };
    for (let f = 0; f < 60; f++) sim.step(1 / 30, away);
    expect(sim.pigeonsFlying).toBe(0);
    // Todas en el piso, sobre la vereda.
    for (const p of sim.poses.filter((q) => q.plumage === 'pigeon' && !q.wings))
      expect(p.y).toBeCloseTo(0.2, 5);

    let flushes = 0;
    sim.setOnFlush(() => flushes++);
    const near = { x: sp.x + 1, y: 1.7, z: sp.z };
    for (let f = 0; f < 30; f++) sim.step(1 / 30, near);
    expect(sim.pigeonsFlying).toBeGreaterThan(0);
    expect(flushes).toBe(1);
    // Vuelan alto sobre la calle mientras el jugador sigue ahí.
    for (let f = 0; f < 5 * 30; f++) sim.step(1 / 30, near);
    const up = sim.poses.filter((q) => q.plumage === 'pigeon' && q.wings);
    expect(Math.max(...up.map((q) => q.y))).toBeGreaterThan(5);

    // El jugador se va: a los pocos segundos están todas de nuevo en el piso.
    for (let f = 0; f < 40 * 30; f++) sim.step(1 / 30, away);
    expect(sim.pigeonsFlying).toBe(0);
  });
});
