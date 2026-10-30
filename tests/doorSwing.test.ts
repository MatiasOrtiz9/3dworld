import { describe, expect, it } from 'vitest';
import { swingVis } from '../src/world/SchoolDoors';

/**
 * La hoja de las puertas del juego: el avance lógico es lineal (0,6 s) y lo
 * que se ve lo sigue con un resorte que arranca suave y rebota apenas en el
 * tope y en el marco, sin atravesarlos.
 */
describe('puertas — cómo se mueve la hoja', () => {
  for (const dir of [1, -1] as const) {
    it(dir > 0 ? 'al abrirse' : 'al cerrarse', () => {
      const dt = 1 / 72;
      const st = { open: dir > 0 ? 0 : 1, vis: dir > 0 ? 0 : 1, visV: 0 };
      const trace: number[] = [];
      for (let t = 0; t < 2; t += dt) {
        st.open = dir > 0 ? Math.min(1, st.open + dt / 0.6) : Math.max(0, st.open - dt / 0.6);
        swingVis(st, dt);
        trace.push(st.vis);
      }
      // Nunca pasa el tope ni el marco.
      expect(Math.max(...trace)).toBeLessThanOrEqual(1);
      expect(Math.min(...trace)).toBeGreaterThanOrEqual(0);
      // Arranca suave: el primer cuadro mueve mucho menos que la rampa lineal.
      expect(Math.abs(trace[0] - (dir > 0 ? 0 : 1))).toBeLessThan(0.3 * (dt / 0.6));
      // Llega, rebota un poco (vuelve 0,5-10 % del recorrido) y se queda quieta.
      const end = dir > 0 ? 1 : 0;
      const hit = trace.findIndex((v) => v === end);
      expect(hit).toBeGreaterThan(0);
      const back = Math.max(...trace.slice(hit).map((v) => Math.abs(v - end)));
      expect(back).toBeGreaterThan(0.005);
      expect(back).toBeLessThan(0.1);
      expect(trace[trace.length - 1]).toBe(end);
    });
  }
});
