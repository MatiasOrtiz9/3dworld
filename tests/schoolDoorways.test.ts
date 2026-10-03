import { describe, expect, it } from 'vitest';
import { crosses, doorways } from './schoolWalkKit';

/**
 * Toda puerta o paso a nivel de piso se cruza caminando derecho, de los dos
 * lados, por el eje y corrido 15 cm. Antes, las puntas redondas de los muros
 * en las jambas dejaban 0,2–0,4 m libres en una puerta de 0,9 y muebles
 * pegados detrás de varias puertas trababan al jugador en el marco.
 */
describe('vanos transitables de la escuela', () => {
  // Hall de danzas: entre la puerta y la baranda del hueco de la escalera hay
  // 0,9 m; el cuerpo entra y gira, pero no se puede adentrar más.
  const NARROW: Record<string, number> = { '45.60,-13.60': 0.3 };

  for (const d of doorways()) {
    it(d.label, () => {
      const need = NARROW[`${d.u.toFixed(2)},${d.v.toFixed(2)}`] ?? 0.5;
      for (const side of [1, -1] as const) {
        const runs = [0, 0.15, -0.15].map((off) => ({ off, r: crosses(d, side, off, 1.0, need) }));
        // Sin ningún arranque libre de ese lado, el vano no lleva a ningún lado.
        expect(runs.some((x) => !x.r.solidStart), `lado ${side}: ${runs.map((x) => x.r.why).join(' | ')}`).toBe(true);
        for (const { off, r } of runs) {
          if (r.solidStart) continue;
          expect(r.ok, `lado ${side} corrido ${off}: ${r.why}`).toBe(true);
        }
      }
    });
  }
});
