import { describe, expect, it } from 'vitest';
import { LEVEL_Y, schoolFloorLocal, STAIRS } from '../src/world/SchoolLayout';
import { runFlight, walk } from './schoolWalkKit';

/** Caminando, corriendo, a 30, 60 y 72 cuadros por segundo (escritorio y visor). */
const PACES: ReadonlyArray<readonly [number, number]> = [
  [4.2, 30],
  [4.2, 60],
  [4.2, 72],
  [8.5, 30],
  [8.5, 60],
  [8.5, 72],
];

describe('escaleras de la escuela', () => {
  STAIRS.forEach((s, i) => {
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const width = alongU ? s.v1 - s.v0 : s.u1 - s.u0;
    // El eje y, en los tramos anchos, cerca de cada costado.
    const offsets = width >= 1.0 ? [0, width / 2 - 0.3, -(width / 2 - 0.3)] : [0];
    const name = `#${i} ${s.dir} ${s.y0}→${s.y1} (${s.u0.toFixed(2)},${s.v0.toFixed(2)})`;

    it(`${name}: se sube y se baja de punta a punta`, () => {
      for (const down of [false, true]) {
        for (const off of offsets) {
          for (const [speed, fps] of PACES) {
            const r = runFlight(s, down, off, speed, fps);
            expect(r.ok, `${down ? 'baja' : 'sube'} corrido ${off.toFixed(2)} a ${speed} m/s, ${fps} fps: ${r.why}`).toBe(true);
          }
        }
      }
    });

    it(`${name}: subiendo, los pies no saltan ni se hunden`, () => {
      for (const down of [false, true]) {
        const r = runFlight(s, down, 0, 4.2, 60, 0.6, 0.6, true);
        expect(r.ok, r.why).toBe(true);
      }
    });

    it(`${name}: no se cae por el costado`, () => {
      for (const t of [0.3, 0.5, 0.8]) {
        const k = s.dir === 'u+' || s.dir === 'v+' ? t : 1 - t;
        const a = alongU ? s.u0 + (s.u1 - s.u0) * k : (s.u0 + s.u1) / 2;
        const b = alongU ? (s.v0 + s.v1) / 2 : s.v0 + (s.v1 - s.v0) * k;
        const feet = schoolFloorLocal(a, b, LEVEL_Y[0] + s.y0 + (s.y1 - s.y0) * t + 0.3);
        for (const side of [1, -1]) {
          for (const [speed, fps] of [PACES[1], PACES[3]]) {
            // De costado y en diagonal (la sonda de cada eje se acorta en diagonal).
            const fwd = s.dir === 'u+' || s.dir === 'v+' ? 1 : -1;
            for (const [du, dv] of alongU ? [[0, side], [fwd, side], [-fwd, side]] : [[side, 0], [side, fwd], [side, -fwd]]) {
              // En diagonal también avanza a lo largo: si sale por una punta del
              // tramo, llegó a un piso de verdad y se corta ahí.
              const lo = alongU ? s.u0 : s.v0;
              const hi = alongU ? s.u1 : s.v1;
              const e = walk({ u: a, v: b, feet }, du, dv, speed, fps, 1.5, (q) => {
                const x = alongU ? q.u : q.v;
                return x < lo || x > hi;
              });
              const x = alongU ? e.u : e.v;
              if (x < lo || x > hi) continue;
              expect(e.feet, `a ${Math.round(t * 100)}% del tramo hacia (${du},${dv}): terminó en (${e.u.toFixed(2)},${e.v.toFixed(2)})`).toBeGreaterThan(feet - 0.7);
            }
          }
        }
      }
    });
  });
});
