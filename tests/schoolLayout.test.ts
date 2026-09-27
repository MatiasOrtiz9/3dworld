import { describe, it, expect } from 'vitest';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';
import { SCHOOL, STATION_SPOTS, toLocal, toWorld } from '../src/world/SchoolLayout';

const SEEDS = [1, 7, 42, 99, 123, 2050, 31337, 424242, 7777, 55555, 8, 13, 21, 34, 89];

describe('campus CIMDIP & Miguel Cané', () => {
  for (const seed of SEEDS) {
    const plan = generateCityPlan(seed);
    const index = new CityIndex(plan);

    it(`semilla ${seed}: existe, no es agua y mira hacia la plaza`, () => {
      const f = index.school;
      expect(f).not.toBeNull();
      expect(f!.block.kind).not.toBe('water');
      // La entrada (−v) apunta hacia el centro de la plaza.
      const entrance = toWorld(f!, 0, -SCHOOL.half);
      const back = toWorld(f!, 0, SCHOOL.half);
      const dE = Math.hypot(entrance.x - plan.plazaCenter.x, entrance.z - plan.plazaCenter.z);
      const dB = Math.hypot(back.x - plan.plazaCenter.x, back.z - plan.plazaCenter.z);
      expect(dE).toBeLessThan(dB);
    });

    it(`semilla ${seed}: local ↔ mundo es reversible`, () => {
      const f = index.school!;
      for (const [u, v] of [
        [3, -7],
        [-12.5, 18],
        [0, 0],
      ]) {
        const w = toWorld(f, u, v);
        const l = toLocal(f, w.x, w.z);
        expect(l.u).toBeCloseTo(u, 6);
        expect(l.v).toBeCloseTo(v, 6);
      }
    });

    it(`semilla ${seed}: el hall se atraviesa y las aulas son sólidas`, () => {
      const f = index.school!;
      // Del portón al patio por el eje, sin chocar.
      for (let v = SCHOOL.fenceV - 1; v < 8; v += 0.5) {
        const p = toWorld(f, 0, v);
        expect(index.isSolid(p.x, p.z), `v=${v}`).toBe(false);
      }
      // Dentro del bloque del frente y de las alas: sólido.
      for (const [u, v] of [
        [-10, -9],
        [10, -9],
        [-15, 4],
        [15, 4],
      ]) {
        const p = toWorld(f, u, v);
        expect(index.isSolid(p.x, p.z), `u=${u} v=${v}`).toBe(true);
      }
    });

    it(`semilla ${seed}: cada estación tiene lugar libre alrededor para acercarse`, () => {
      const f = index.school!;
      for (const [id, spot] of Object.entries(STATION_SPOTS)) {
        let free = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const p = toWorld(f, spot.u + Math.cos(a) * 1.8, spot.v + Math.sin(a) * 1.8);
          if (!index.isSolid(p.x, p.z)) free++;
        }
        expect(free, id).toBeGreaterThanOrEqual(4);
      }
    });
  }
});
