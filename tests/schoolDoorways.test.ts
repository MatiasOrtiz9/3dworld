import { describe, expect, it } from 'vitest';
import { crosses, doorways } from './schoolWalkKit';

/**
 * Toda puerta o paso a nivel de piso se cruza caminando derecho, de los dos
 * lados, por el eje y corrido de él (15 cm en una puerta de 0,9; 20 cm desde
 * 1 m), con la MISMA física del jugador (walkPhysics). Antes, las puntas
 * redondas de los muros en las jambas dejaban 0,2–0,4 m libres en una puerta
 * de 0,9 y muebles pegados detrás de varias puertas trababan al jugador en el
 * marco. También se mide el derrape: en los muros oblicuos la sonda de un eje
 * tocaba la jamba y el jugador salía corrido 0,2–0,4 m de costado.
 */
describe('vanos transitables de la escuela', () => {
  // Hall de danzas: entre la puerta y la baranda del hueco de la escalera hay
  // 0,9 m; el cuerpo entra y gira, pero no se puede adentrar más.
  const NARROW: Record<string, number> = { '45.60,-13.60': 0.3 };
  const MAX_DRIFT = 0.15;

  for (const d of doorways()) {
    it(d.label, () => {
      const need = NARROW[`${d.u.toFixed(2)},${d.v.toFixed(2)}`] ?? 0.5;
      const off = d.width >= 0.99 ? 0.2 : 0.15;
      for (const side of [1, -1] as const) {
        const runs = [0, off, -off].map((o) => ({ o, r: crosses(d, side, o, 1.0, need) }));
        // Sin ningún arranque libre de ese lado, el vano no lleva a ningún lado.
        expect(runs.some((x) => !x.r.solidStart), `lado ${side}: ${runs.map((x) => x.r.why).join(' | ')}`).toBe(true);
        for (const { o, r } of runs) {
          if (r.solidStart) continue;
          expect(r.ok, `lado ${side} corrido ${o}: ${r.why}`).toBe(true);
          expect(Math.abs(r.drift), `lado ${side} corrido ${o}: ${r.why}`).toBeLessThan(MAX_DRIFT);
        }
        // Corriendo, y con el cuadro lento de un celular, tampoco se traba (con
        // sub-pasos de 0,23 m frena un poco antes de un mueble: 70 % de lo pedido).
        const fast = crosses(d, side, 0, 1.0, need * 0.7, 8.5, 30);
        if (!fast.solidStart) expect(fast.ok, `lado ${side} corriendo a 30 fps: ${fast.why}`).toBe(true);
      }
    });
  }
});
