import { describe, expect, it } from 'vitest';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';
import { LANDINGS, LEVEL_Y, SCHOOL, fromPlan, toWorld } from '../src/world/SchoolLayout';

/**
 * Destino de teletransporte VR, con el mismo predicado que main.ts (el punto
 * y una cruz de 0,3 m) y lo que hace XRLocomotion al llegar (groundHeight con
 * los pies a la cota apuntada). Antes el arco caía siempre en un plano a nivel
 * de calle: desde el primer piso el salto te dejaba en la planta baja, y
 * muchos lugares libres arriba se rechazaban por lo que había abajo.
 */
describe('teletransporte VR en la escuela', () => {
  const index = new CityIndex(generateCityPlan(42, { gridSize: 5 }));
  const f = index.school!;
  const can = (x: number, z: number, feet: number) =>
    [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([dx, dz]) => index.canLandAt(x + dx, z + dz, feet));
  /** Punto leído en el plano (`fromPlan`), al nivel dado. */
  const land = (u: number, v: number, level: 0 | 1 | 2) => {
    const feet = LEVEL_Y[level];
    const { x, z } = toWorld(f, ...fromPlan(u, v));
    return { ok: can(x, z, feet), feet: index.groundHeight(x, z, feet) };
  };

  it('en el pasillo del primer piso se aterriza en el primer piso', () => {
    const r = land(19, -7.1, 1);
    expect(r.ok).toBe(true);
    expect(r.feet).toBeCloseTo(3.42, 2);
  });

  it('arriba no se rechaza por lo que hay en la planta baja', () => {
    // Hall de danzas (L2), sobre el salón de los espejos: libre arriba.
    const r = land(43, -15.5, 2);
    expect(r.ok).toBe(true);
    expect(r.feet).toBeCloseTo(6.72, 2);
  });

  it('el aula NE del primer piso se puede recorrer a saltos (abajo hay muros)', () => {
    // Sin los juegos viejos el piso de abajo quedó casi libre: lo que importa
    // es que donde abajo hay un muro o un mueble, arriba igual se aterriza.
    let now = 0;
    let overBlocked = 0;
    for (let u = 33; u <= 38; u += 0.5) {
      for (let v = -34.5; v <= -25.5; v += 0.5) {
        const { x, z } = toWorld(f, ...fromPlan(u, v));
        const up = can(x, z, LEVEL_Y[1]);
        if (up) now++;
        const freeBelow = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([dx, dz]) => !index.isPedestrianBlocked(x + dx, z + dz));
        if (up && !freeBelow) overBlocked++;
      }
    }
    expect(overBlocked).toBeGreaterThan(0);
    expect(now).toBeGreaterThan(80);
  });

  it('en planta baja sigue igual', () => {
    const r = land(35, -6.6, 0);
    expect(r.ok).toBe(true);
    expect(r.feet).toBeCloseTo(SCHOOL.floorY, 2);
  });

  it('no se aterriza en el aire: hueco de escalera desde el piso de arriba', () => {
    // Sobre el tramo de la escalera oeste, a la cota del primer piso.
    expect(land(8.0, -9.5, 1).ok).toBe(false);
  });

  it('se puede saltar dentro de un descanso, a su altura', () => {
    let some = 0;
    for (const l of LANDINGS) {
      const u = (l.u0 + l.u1) / 2;
      const v = (l.v0 + l.v1) / 2;
      const feet = SCHOOL.floorY + l.y;
      const { x, z } = toWorld(f, u, v);
      if (index.canLandAt(x, z, feet)) some++;
    }
    expect(some).toBeGreaterThan(0);
  });
});
