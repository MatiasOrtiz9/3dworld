import { describe, expect, it } from 'vitest';
import { ITEMS, roomAt } from '../src/world/SchoolLayout';

/**
 * Las copas de los árboles y las palmeras de los patios no pueden atravesar
 * techos: una fronda que asoma por el cielorraso de una galería se ve desde
 * adentro como un plano verde flotando. Se muestrea el anillo exterior de la
 * copa a la altura de la copa y ningún punto puede caer en un ambiente techado.
 */
describe('vegetación de los patios', () => {
  const trees = ITEMS.filter((it) => (it.kind === 'palm' || it.kind === 'tree') && (it.level ?? 0) === 0);

  it('hay palmeras y árboles en los patios', () => {
    expect(trees.length).toBeGreaterThan(1);
  });

  for (const t of trees) {
    // Alcance horizontal de la copa (ver SchoolBuilder.palm y NatureBuilder.broadleaf).
    const reach = t.kind === 'palm' ? 3.3 * 0.95 * Math.min(1, (t.h ?? 6) / 6) : 2.6;
    it(`${t.kind} en (${t.u}, ${t.v}) no asoma dentro de un ambiente techado`, () => {
      const bad: string[] = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        for (const r of [reach * 0.6, reach]) {
          const u = t.u + Math.sin(a) * r;
          const v = t.v + Math.cos(a) * r;
          const room = roomAt(u, v, 0);
          if (room?.roofed) bad.push(`${room.id}@(${u.toFixed(1)},${v.toFixed(1)})`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
