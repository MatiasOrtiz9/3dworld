import { describe, it, expect } from 'vitest';
import { polygonArea, subtractRects, triangulate } from '../src/world/builders/PrismBatch';

type V2 = readonly [number, number];

const area = (p: readonly V2[]) => Math.abs(polygonArea(p));

/** Losas con huecos de escalera: el área que queda es la del polígono menos la del hueco. */
describe('subtractRects', () => {
  it('sin huecos devuelve el polígono entero', () => {
    const sq: V2[] = [
      [0, 0],
      [4, 0],
      [4, -3],
      [0, -3],
    ];
    const out = subtractRects(sq, [{ u0: 10, v0: -1, u1: 11, v1: 0 }]);
    expect(out).toHaveLength(1);
    expect(area(out[0])).toBeCloseTo(12);
  });

  it('un hueco interior resta su área exacta', () => {
    const sq: V2[] = [
      [0, 0],
      [10, 0],
      [10, -8],
      [0, -8],
    ];
    const out = subtractRects(sq, [{ u0: 2, v0: -5, u1: 4, v1: -2 }]);
    const sum = out.reduce((s, p) => s + area(p), 0);
    expect(sum).toBeCloseTo(80 - 6);
    for (const p of out) expect(triangulate(p).length).toBe(p.length - 2);
  });

  it('respeta las diagonales (ala sobre Miguel Cané) y huecos que tocan el borde', () => {
    // Trapecio con un lado inclinado, hueco pegado al borde recto.
    const tr: V2[] = [
      [0, 0],
      [10, 0],
      [10, -6],
      [3, -6],
    ];
    const out = subtractRects(tr, [{ u0: 8, v0: -6, u1: 10, v1: -3 }]);
    const sum = out.reduce((s, p) => s + area(p), 0);
    expect(sum).toBeCloseTo(area(tr) - 6);
  });

  it('dos huecos en la misma franja', () => {
    const sq: V2[] = [
      [0, 0],
      [12, 0],
      [12, -4],
      [0, -4],
    ];
    const out = subtractRects(sq, [
      { u0: 1, v0: -3, u1: 3, v1: -1 },
      { u0: 6, v0: -3.5, u1: 9, v1: -0.5 },
    ]);
    const sum = out.reduce((s, p) => s + area(p), 0);
    expect(sum).toBeCloseTo(48 - 4 - 9);
  });
});
