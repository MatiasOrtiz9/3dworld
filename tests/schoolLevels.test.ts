import { describe, it, expect } from 'vitest';
import {
  LANDINGS,
  LEVEL_Y,
  ROOMS,
  SCHOOL,
  STAIRS,
  levelOf,
  roomLevel,
  schoolFloorLocal,
  schoolSolidLocal,
  stairY,
  type Stair,
} from '../src/world/SchoolLayout';

/**
 * Pisos y escaleras de la escuela.
 *
 * La colisión y la altura del piso dependen de a qué altura están los pies:
 * así se sube por una escalera (rampa bajo los escalones), se llega al primer
 * piso y desde ahí lo que bloquea son los muros de ese nivel.
 */

const FY = SCHOOL.floorY;

/** Camina en línea recta dejando que los pies sigan el piso, como el jugador. */
function climb(path: Array<[number, number]>, feet0: number): number {
  let feet = feet0;
  for (let i = 0; i < path.length - 1; i++) {
    const [u0, v0] = path[i];
    const [u1, v1] = path[i + 1];
    const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.05);
    for (let k = 1; k <= n; k++) {
      const u = u0 + ((u1 - u0) * k) / n;
      const v = v0 + ((v1 - v0) * k) / n;
      expect(schoolSolidLocal(u, v, feet), `bloqueado en ${u.toFixed(2)}, ${v.toFixed(2)} (pies ${feet.toFixed(2)})`).toBe(false);
      feet = schoolFloorLocal(u, v, feet);
    }
  }
  return feet;
}

function center(s: Stair): [number, number] {
  return [(s.u0 + s.u1) / 2, (s.v0 + s.v1) / 2];
}

describe('niveles de la escuela', () => {
  it('cada nivel está una planta más arriba', () => {
    expect(LEVEL_Y[0]).toBe(FY);
    expect(LEVEL_Y[1] - LEVEL_Y[0]).toBeCloseTo(SCHOOL.storey);
    expect(LEVEL_Y[2] - LEVEL_Y[1]).toBeCloseTo(SCHOOL.storey);
    expect(levelOf(LEVEL_Y[0])).toBe(0);
    expect(levelOf(LEVEL_Y[1])).toBe(1);
    expect(levelOf(LEVEL_Y[2])).toBe(2);
    // A mitad de una escalera todavía se está en el nivel de abajo.
    expect(levelOf((LEVEL_Y[0] + LEVEL_Y[1]) / 2)).toBe(0);
  });

  it('los ambientes de un mismo nivel no se superponen', () => {
    for (const lv of [0, 1, 2] as const) {
      const rooms = ROOMS.filter((r) => roomLevel(r) === lv);
      for (let u = -2; u < 68; u += 0.7) {
        for (let v = -39; v < 0; v += 0.7) {
          let hits = 0;
          for (const r of rooms) {
            let inside = false;
            const p = r.poly;
            for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
              if (p[i][1] > v !== p[j][1] > v && u < ((p[j][0] - p[i][0]) * (v - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) {
                inside = !inside;
              }
            }
            if (inside) hits++;
          }
          expect(hits, `nivel ${lv} en ${u.toFixed(1)}, ${v.toFixed(1)}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('escaleras', () => {
  it('cada tramo sube de su altura de arranque a la de llegada', () => {
    for (const s of STAIRS) {
      const [uc, vc] = center(s);
      const low: [number, number] =
        s.dir === 'u+' ? [s.u0 + 0.01, vc] : s.dir === 'u-' ? [s.u1 - 0.01, vc] : s.dir === 'v+' ? [uc, s.v0 + 0.01] : [uc, s.v1 - 0.01];
      const high: [number, number] =
        s.dir === 'u+' ? [s.u1 - 0.01, vc] : s.dir === 'u-' ? [s.u0 + 0.01, vc] : s.dir === 'v+' ? [uc, s.v1 - 0.01] : [uc, s.v0 + 0.01];
      const a = stairY(s, low[0], low[1]);
      const b = stairY(s, high[0], high[1]);
      expect(a).toBeLessThan(b);
      expect(a).toBeGreaterThanOrEqual(FY + s.y0);
      expect(b).toBeLessThanOrEqual(FY + s.y1 + 1e-9);
      // A lo sumo medio escalón por debajo de cada extremo.
      expect(b).toBeGreaterThan(FY + s.y1 - 0.2);
    }
  });

  it('la escalera principal del bloque norte se sube entera hasta el primer piso', () => {
    // Primer tramo hacia el este, descanso, segundo tramo hacia el oeste.
    const top = climb(
      [
        [20.4, -26.3],
        [26.5, -26.3],
        [26.5, -28.6],
        [20.4, -28.6],
      ],
      FY,
    );
    expect(top).toBeCloseTo(LEVEL_Y[1], 1);
    expect(levelOf(top)).toBe(1);
    // Y se baja por el mismo camino hasta planta baja.
    const bottom = climb(
      [
        [20.4, -28.6],
        [26.5, -28.6],
        [26.5, -26.3],
        [20.4, -26.3],
      ],
      top,
    );
    // Termina sobre el primer escalón: medio escalón por encima del piso.
    expect(bottom).toBeLessThan(FY + 0.2);
  });

  it('el costado de un tramo es macizo para quien está abajo', () => {
    // A mitad del primer tramo los escalones están a la altura de la cadera.
    expect(schoolSolidLocal(24.0, -26.3, FY)).toBe(true);
    // Pero el arranque se pisa.
    expect(schoolSolidLocal(20.5, -26.3, FY)).toBe(false);
  });

  it('la multitud no usa las escaleras', () => {
    for (const s of STAIRS) {
      const [uc, vc] = center(s);
      expect(schoolSolidLocal(uc, vc, FY, true)).toBe(true);
    }
    for (const l of LANDINGS) {
      expect(schoolSolidLocal((l.u0 + l.u1) / 2, (l.v0 + l.v1) / 2, FY, true)).toBe(true);
    }
  });
});
