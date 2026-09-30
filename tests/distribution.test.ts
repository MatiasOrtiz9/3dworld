import { describe, it, expect } from 'vitest';
import { generateCityPlan, type BlockKind } from '../src/world/CityLayout';

/**
 * Métricas de DISEÑO urbano, no invariantes de corrección.
 *
 * Una ciudad puede ser técnicamente válida —manzanas completas, escuela al
 * norte del centro, alturas finitas— y aun así aburrida: si el 60 % son tres tipos y los
 * constructores más elaborados casi no aparecen, todas las semillas se parecen
 * entre sí. La auditoría detectó exactamente eso.
 *
 * Estos umbrales fijan las decisiones de composición para que una optimización
 * futura no las erosione sin que nadie se entere.
 */

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 13);

function distribution(): { share: Record<string, number>; perCity: Record<string, number> } {
  const totals: Record<string, number> = {};
  for (const seed of SEEDS) {
    for (const b of generateCityPlan(seed).blocks) {
      totals[b.kind] = (totals[b.kind] ?? 0) + 1;
    }
  }
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  const share: Record<string, number> = {};
  const perCity: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals)) {
    share[k] = (v / grand) * 100;
    perCity[k] = v / SEEDS.length;
  }
  return { share, perCity };
}

describe('Composición urbana', () => {
  const { share, perCity } = distribution();

  it('informe de distribución', () => {
    const rows = Object.entries(share).sort((a, b) => b[1] - a[1]);
    const lines = rows.map(
      ([k, pct]) =>
        `  ${k.padEnd(13)} ${perCity[k].toFixed(1).padStart(5)} por ciudad  ${pct.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(pct / 2))}`,
    );
    console.log('\n' + lines.join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('aparecen los siete tipos de manzana', () => {
    const kinds: BlockKind[] = [
      'park',
      'water',
      'residential',
      'civic',
      'tower',
      'market',
      'energy',
    ];
    for (const k of kinds) {
      expect(share[k], `falta el tipo "${k}"`).toBeGreaterThan(0);
    }
  });

  it('el canal cruza la ciudad, no la bordea', () => {
    // La auditoría midió 4,6 manzanas de agua por ciudad. El umbral quedó en 7
    // después de medir la geometría real, no antes:
    //
    //  - Una manzana es agua cuando su CENTRO cae dentro del semiancho del
    //    canal, y los centros de una grilla de paso 57 m se agrupan a
    //    distancias de 1, 2, 4, 11, 13, 14, 16, 16, 19… y luego saltan a 28.
    //  - El eje del canal no puede acercarse a menos de ~50 m del centro sin
    //    que la lámina de agua se dibuje encima de la manzana central.
    //
    // Con esas dos restricciones el máximo por ciudad es ~9 y el promedio
    // alcanzable rondaba 7,2. Desde que la escuela ocupa el centro (dos
    // manzanas, ~120 m de frente) el canal además la esquiva por detrás y el
    // promedio medido es 6,9: el umbral baja a 6,5 por eso, no porque el canal
    // se haya ido al borde.
    expect(perCity.water).toBeGreaterThan(6.5);
  });

  it('el mercado aparece lo suficiente como para justificar su constructor', () => {
    // Es el tipo con más geometría específica del proyecto (pórticos de madera,
    // arcos, cubierta mixta, puestos) y aparecía 2,7 veces por ciudad.
    expect(share.market).toBeGreaterThan(6);
  });

  it('hay equipamiento público en cantidad creíble', () => {
    expect(share.civic).toBeGreaterThan(9);
  });

  it('ningún tipo domina más de la mitad de la ciudad', () => {
    for (const [k, pct] of Object.entries(share)) {
      expect(pct, `el tipo "${k}" ocupa demasiado`).toBeLessThan(50);
    }
  });

  it('ya no hay plaza: la manzana central es un edificio', () => {
    expect(perCity.plaza).toBeUndefined();
  });
});
