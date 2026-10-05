import { describe, expect, it } from 'vitest';
import { aimZone, distToZone, firstZone, navigateGrid, nearestZone, zoneAt, zoneAtWithHysteresis, type NavZone } from '../src/game/xr/panelNav';

/**
 * Navegación del panel del visor con el stick y el láser: por geometría real
 * de los botones (una columna, dos columnas, grillas irregulares con huecos
 * por botones deshabilitados) y con histéresis en el borde del resaltado.
 */

/** Grilla de `cols` columnas de botones de 200 × 80 separados 20 px; `skip` = deshabilitados (sin zona). */
function grid(count: number, cols: number, skip: number[] = []): NavZone[] {
  const out: NavZone[] = [];
  for (let i = 0; i < count; i++) {
    if (skip.includes(i)) continue;
    const x0 = 40 + (i % cols) * 220;
    const y0 = 100 + Math.floor(i / cols) * 100;
    out.push({ x0, y0, x1: x0 + 200, y1: y0 + 80, index: i });
  }
  return out;
}

describe('navegación del panel del visor', () => {
  it('una columna: abajo y arriba recorren en orden y no dan la vuelta', () => {
    const z = grid(4, 1);
    expect(navigateGrid(z, 0, 0, 1)).toBe(1);
    expect(navigateGrid(z, 1, 0, 1)).toBe(2);
    expect(navigateGrid(z, 3, 0, 1)).toBe(3);
    expect(navigateGrid(z, 2, 0, -1)).toBe(1);
    expect(navigateGrid(z, 0, 0, -1)).toBe(0);
    // A los costados no hay nada: se queda.
    expect(navigateGrid(z, 2, 1, 0)).toBe(2);
    expect(navigateGrid(z, 2, -1, 0)).toBe(2);
  });

  it('dos columnas: se mueve por fila y por columna', () => {
    const z = grid(6, 2);
    expect(navigateGrid(z, 0, 1, 0)).toBe(1);
    expect(navigateGrid(z, 1, -1, 0)).toBe(0);
    expect(navigateGrid(z, 1, 0, 1)).toBe(3);
    expect(navigateGrid(z, 3, 0, 1)).toBe(5);
    expect(navigateGrid(z, 4, 0, -1)).toBe(2);
    expect(navigateGrid(z, 5, 1, 0)).toBe(5);
  });

  it('grilla de tres con la última fila corta y un deshabilitado', () => {
    // 0 1 2 / 3 [4] 5 / 6
    const z = grid(7, 3, [4]);
    expect(navigateGrid(z, 1, 0, 1)).toBe(3); // el 4 no tiene zona: el más alineado de la fila siguiente
    expect(navigateGrid(z, 3, 1, 0)).toBe(5); // salta el hueco
    expect(navigateGrid(z, 5, 0, 1)).toBe(6); // última fila más corta
    expect(navigateGrid(z, 6, 0, -1)).toBe(3);
  });

  it('manda el eje de mayor magnitud', () => {
    const z = grid(4, 2);
    expect(navigateGrid(z, 0, 0.9, 0.3)).toBe(1);
    expect(navigateGrid(z, 0, 0.2, 0.8)).toBe(2);
  });

  it('sin resaltado empieza por el primero en orden de lectura', () => {
    const z = grid(5, 2, [0]);
    expect(navigateGrid(z, -1, 0, 1)).toBe(1);
    expect(firstZone(z)).toBe(1);
    expect(firstZone([])).toBe(-1);
    expect(navigateGrid([], -1, 1, 0)).toBe(-1);
    // Un índice que ya no existe (el panel se redibujó) cuenta como sin resaltado.
    expect(navigateGrid(z, 0, 0, 1)).toBe(1);
  });

  it('zoneAt: dentro del botón, en la separación y fuera', () => {
    const z = grid(4, 2);
    expect(zoneAt(z, 100, 140)).toBe(0);
    expect(zoneAt(z, 320, 240)).toBe(3);
    expect(zoneAt(z, 250, 140)).toBe(-1); // separación entre columnas
    expect(zoneAt(z, 10, 10)).toBe(-1);
  });

  it('histéresis: el resaltado se mantiene en el borde y en la separación', () => {
    const z = grid(4, 2);
    // Recién salido del botón 0 hacia la derecha, en la separación: sigue el 0.
    expect(zoneAtWithHysteresis(z, 250, 140, 0, 14)).toBe(0);
    // Sin resaltado previo, la separación no es ningún botón.
    expect(zoneAtWithHysteresis(z, 250, 140, -1, 14)).toBe(-1);
    // Ya adentro del botón 1 manda la zona exacta, aunque esté en la franja del 0.
    expect(zoneAtWithHysteresis(z, 262, 140, 0, 30)).toBe(1);
    expect(zoneAtWithHysteresis(z, 300, 140, 0, 14)).toBe(1);
    // Lejos de todo: nada.
    expect(zoneAtWithHysteresis(z, 600, 600, 0, 14)).toBe(-1);
  });

  it('imán: el hueco y el borde de un botón eligen el más cercano', () => {
    const z = grid(4, 2);
    // Separación horizontal entre el 0 (x1 = 240) y el 1 (x0 = 260), más cerca del 0.
    expect(nearestZone(z, 245, 140, 46)).toBe(0);
    expect(nearestZone(z, 256, 140, 46)).toBe(1);
    // Debajo de la última fila, a 30 px del borde: el de esa columna.
    expect(nearestZone(z, 120, 310, 46)).toBe(2);
    // Demasiado lejos: nada.
    expect(nearestZone(z, 120, 400, 46)).toBe(-1);
    expect(distToZone(z[0], 100, 120)).toBe(0);
    expect(distToZone(z[0], 243, 184)).toBeCloseTo(5, 5);
  });

  it('aimZone: exacto, después el resaltado agrandado, después el imán', () => {
    const z = grid(4, 2);
    // Tocado de lleno manda aunque otro esté resaltado.
    expect(aimZone(z, 300, 140, 0, 24, 46)).toBe(1);
    // En el hueco, más cerca del 1, pero el 0 resaltado lo retiene por la histéresis.
    expect(aimZone(z, 255, 140, 0, 24, 46)).toBe(0);
    // Sin resaltado, el imán toma el más cercano.
    expect(aimZone(z, 255, 140, -1, 24, 46)).toBe(1);
    expect(aimZone(z, 700, 700, -1, 24, 46)).toBe(-1);
  });
});
