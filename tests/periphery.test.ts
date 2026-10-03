import { describe, expect, it } from 'vitest';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';

describe('periferia en obra', () => {
  const plan = generateCityPlan(42);
  const idx = new CityIndex(plan);
  const pe = plan.periphery;
  it('el cerco y lo de afuera son macizos en los cuatro lados', () => {
    expect(idx.isSolid(0, pe.z0 - 2)).toBe(true);
    expect(idx.isSolid(0, pe.z1 + 2)).toBe(true);
    expect(idx.isSolid(pe.x0 - 2, 0)).toBe(true);
    expect(idx.isSolid(pe.x1 + 2, 0)).toBe(true);
    expect(idx.isPedestrianBlocked(0, pe.z0)).toBe(true);
  });
  it('las calles perimetrales siguen transitables', () => {
    expect(idx.isSolid(0, -85.5)).toBe(false);
    expect(idx.isSolid(0, 85.5)).toBe(false);
    expect(idx.isSolid(-142.5, 0)).toBe(false);
    expect(idx.isSolid(85.5, 0)).toBe(false);
  });
  it('es determinista', () => {
    expect(generateCityPlan(42).periphery).toEqual(pe);
  });
});
