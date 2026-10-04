import { describe, expect, it } from 'vitest';
import { ITEMS, LEVEL_Y, UPPER, inPoly, roomAt, volumeTop } from '../src/world/SchoolLayout';

/**
 * Las copas de los árboles y las palmeras de los patios no pueden atravesar
 * techos: una fronda que asoma por el cielorraso de una galería se ve desde
 * adentro como un plano verde flotando. Se muestrea el anillo exterior de la
 * copa a la altura de la copa y ningún punto puede caer en un ambiente techado.
 */
/** Distancia con signo al borde de un polígono: positiva afuera, negativa adentro. */
function outside(poly: readonly (readonly [number, number])[], u: number, v: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [au, av] = poly[i];
    const [bu, bv] = poly[(i + 1) % poly.length];
    const du = bu - au;
    const dv = bv - av;
    const l2 = du * du + dv * dv;
    const t = Math.max(0, Math.min(1, ((u - au) * du + (v - av) * dv) / l2));
    best = Math.min(best, Math.hypot(u - au - du * t, v - av - dv * t));
  }
  return inPoly(poly, u, v) ? -best : best;
}

describe('vegetación de los patios', () => {
  const trees = ITEMS.filter((it) => (it.kind === 'palm' || it.kind === 'tree' || it.kind === 'slimTree') && (it.level ?? 0) === 0);

  it('hay palmeras y árboles en los patios', () => {
    expect(trees.length).toBeGreaterThan(1);
  });

  for (const t of trees) {
    // Alcance horizontal de la copa (ver SchoolBuilder.palm y NatureBuilder.broadleaf).
    // `slimTree`: copa chica de 1 m o penacho corto de hojas paradas (~0,6 m).
    const reach = t.kind === 'palm' ? 3.3 * 0.95 * Math.min(1, (t.h ?? 6) / 6) : t.kind === 'slimTree' ? 0.6 : 2.6;
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

  /**
   * Las frondas de una palmera alta pasan a la altura de las plantas altas:
   * ninguna puede entrar en un volumen alto (por su muro o su cielorraso) ni
   * atravesar su pretil. Se arma cada hoja como la dibuja `SchoolBuilder.palm`
   * (caja de 2,8–3,3 m × h/6, centrada a 0,45 de su largo, caída 0,6–0,9 rad)
   * en los dos extremos de cada rango y se muestrea a lo largo.
   */
  for (const t of trees.filter((it) => it.kind === 'palm')) {
    it(`palmera en (${t.u}, ${t.v}): las frondas no entran en las plantas altas`, () => {
      const h = t.h ?? 6;
      const scale = Math.min(1, h / 6);
      const crown = LEVEL_Y[0] + (t.y ?? 0) + h - 0.25;
      const bad: string[] = [];
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        for (const len of [2.8 * scale, 3.3 * scale]) {
          for (const droop of [0.6, 0.9]) {
            for (let s = -len / 2; s <= len / 2 + 1e-9; s += 0.1) {
              // Hoja: centro a 0,45·largo del tronco; el eje baja hacia afuera.
              // Se miran el eje y los dos bordes (35 cm de ancho).
              const r = 0.45 * len + s * Math.cos(droop);
              const y = crown - s * Math.sin(droop);
              for (const side of [-0.175, 0, 0.175]) {
                const u = t.u + Math.sin(a) * r + Math.cos(a) * side;
                const v = t.v + Math.cos(a) * r - Math.sin(a) * side;
                for (const vol of UPPER) {
                  const top = volumeTop(vol);
                  const d = outside(vol.poly, u, v);
                  // Muro exterior y pretil: de 5 cm adentro a 15 cm afuera de
                  // la arista, hasta 55 cm sobre la azotea; adentro, hasta la
                  // cubierta. Sólo en las plantas altas.
                  const limit = d > 0.15 ? -Infinity : d > -0.05 ? top + 0.55 : top + 0.04;
                  if (y > LEVEL_Y[1] - 0.2 && y < limit + 0.03) {
                    bad.push(`(${u.toFixed(2)}, ${y.toFixed(2)}, ${v.toFixed(2)})`);
                    break;
                  }
                }
              }
              if (bad.length > 5) break;
            }
          }
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
    });
  }
});
