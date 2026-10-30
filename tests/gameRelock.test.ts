import { describe, expect, it } from 'vitest';
import { fromPlan, roomAt } from '../src/world/SchoolLayout';
import { START, safeToRelock } from '../src/game/story/world';

/**
 * Salir del modo libre vuelve a poner las cerraduras de la historia, pero
 * sólo donde no dejan encerrado al jugador (`GameDirector.sense`).
 */
describe('volver a cerrar al salir del modo libre', () => {
  const at = (u: number, v: number, level: 0 | 1 | 2 = 0) => ({ u, v, level, room: roomAt(u, v, level)?.id ?? '' });

  it('en el hall con la entrada cerrada espera: si no, el portal y todas las salidas lo encierran', () => {
    const hall = at(...fromPlan(35.24, -6));
    expect(hall.room).toBe('hall');
    expect(safeToRelock(hall, false)).toBe(false);
    // Con la entrada ya abierta en la historia, adentro no hay nada que lo encierre.
    expect(safeToRelock(hall, true)).toBe(true);
  });

  it('en la vereda de Laprida (donde empieza la historia) cierra enseguida', () => {
    expect(safeToRelock(at(START.feet.u, START.feet.v), false)).toBe(true);
  });

  it('en un piso alto espera a la planta baja', () => {
    const p = at(...fromPlan(35.24, -6), 1);
    expect(safeToRelock(p, true)).toBe(false);
  });
});
