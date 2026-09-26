import { describe, it, expect } from 'vitest';
import { generateCityPlan, classifyBlock, type BlockKind } from '../src/world/CityLayout';
import { Rng } from '../src/utils/rng';

/**
 * Invariantes del plano de la ciudad.
 *
 * Estos controles antes vivían en `tools/test-seeds.mjs`, que abría un Chrome
 * headless por semilla y tardaba minutos. Acá corren en milisegundos, así que
 * se pueden probar 300 semillas en vez de 10 — y son justamente los casos raros
 * los que rompen un generador procedural.
 */

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 13);

describe('generateCityPlan — invariantes sobre 300 semillas', () => {
  it('siempre produce 81 manzanas', () => {
    for (const seed of SEEDS) {
      expect(generateCityPlan(seed).blocks).toHaveLength(81);
    }
  });

  it('la manzana central SIEMPRE es la plaza', () => {
    // Es el hito de orientación y el punto de aparición del jugador. Hubo un
    // bug real en el que el canal se comía la manzana central con ciertas
    // semillas y la ciudad nacía sin plaza.
    for (const seed of SEEDS) {
      const plan = generateCityPlan(seed);
      const centre = plan.blocks.find((b) => b.ring === 0);
      expect(centre, `semilla ${seed}`).toBeDefined();
      expect(centre!.kind, `semilla ${seed}`).toBe('plaza');
      expect(centre!.cx).toBe(0);
      expect(centre!.cz).toBe(0);
    }
  });

  it('hay exactamente una plaza por ciudad', () => {
    for (const seed of SEEDS) {
      const plazas = generateCityPlan(seed).blocks.filter((b) => b.kind === 'plaza');
      expect(plazas, `semilla ${seed}`).toHaveLength(1);
    }
  });

  it('todas las alturas y posiciones son finitas y no negativas', () => {
    for (const seed of SEEDS) {
      for (const b of generateCityPlan(seed).blocks) {
        expect(Number.isFinite(b.height), `semilla ${seed}`).toBe(true);
        expect(b.height, `semilla ${seed}`).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(b.cx)).toBe(true);
        expect(Number.isFinite(b.cz)).toBe(true);
        expect(b.width).toBeGreaterThan(0);
        expect(b.depth).toBeGreaterThan(0);
      }
    }
  });

  it('los tipos sin construcción tienen altura cero', () => {
    const openKinds: BlockKind[] = ['plaza', 'park', 'water'];
    for (const seed of SEEDS) {
      for (const b of generateCityPlan(seed).blocks) {
        if (openKinds.includes(b.kind)) {
          expect(b.height, `semilla ${seed} · ${b.kind}`).toBe(0);
        }
      }
    }
  });

  it('el perfil urbano baja hacia el borde: nada alto en el anillo exterior', () => {
    for (const seed of SEEDS) {
      for (const b of generateCityPlan(seed).blocks) {
        if (b.ring === 4) {
          expect(b.kind, `semilla ${seed}`).not.toBe('tower');
        }
      }
    }
  });

  it('el canal es una recta con parámetros finitos', () => {
    for (const seed of SEEDS) {
      const { canal } = generateCityPlan(seed);
      expect(Number.isFinite(canal.slope)).toBe(true);
      expect(Number.isFinite(canal.offset)).toBe(true);
      expect(canal.halfWidth).toBeGreaterThan(0);
    }
  });

  it('las manzanas no se superponen entre sí', () => {
    const plan = generateCityPlan(42);
    const pitch = plan.blockSize + plan.streetWidth;
    for (const b of plan.blocks) {
      // El ancho edificable tiene que caber en el paso de la grilla, si no dos
      // manzanas vecinas se pisarían.
      expect(b.width).toBeLessThanOrEqual(pitch);
      expect(b.depth).toBeLessThanOrEqual(pitch);
    }
  });

  it('cada posición de la grilla aparece una sola vez', () => {
    const plan = generateCityPlan(7);
    const seen = new Set(plan.blocks.map((b) => `${b.gx},${b.gz}`));
    expect(seen.size).toBe(plan.blocks.length);
  });
});

/**
 * Defensa de la plaza, probada directamente.
 *
 * Sin estos tests la cobertura es ilusoria: una prueba de mutación mostró que
 * se puede invertir el orden de comprobaciones en `classifyBlock` —
 * reintroduciendo el bug original por el que el canal borraba la plaza— y la
 * suite entera sigue pasando, porque el desplazamiento mínimo del canal tapa el
 * problema. Acá se ataca la salvaguarda misma.
 */
describe('classifyBlock — la plaza es intocable', () => {
  it('ring 0 es plaza aunque el canal pase justo por encima', () => {
    const rng = new Rng(1);
    // canalDistance = 0 significa que el eje del canal atraviesa la manzana.
    expect(classifyBlock(rng, 0, 0, 14)).toBe('plaza');
  });

  it('ring 0 es plaza para cualquier distancia al canal', () => {
    for (let d = 0; d < 60; d += 1.5) {
      const rng = new Rng(d * 1000);
      expect(classifyBlock(rng, 0, d, 14), `distancia ${d}`).toBe('plaza');
    }
  });

  it('en cambio, fuera del centro el canal SÍ manda', () => {
    const rng = new Rng(1);
    expect(classifyBlock(rng, 2, 0, 14)).toBe('water');
    expect(classifyBlock(rng, 4, 3, 14)).toBe('water');
  });

  it('la ribera del canal es parque', () => {
    const rng = new Rng(1);
    // Entre halfWidth y halfWidth * 1.9.
    expect(classifyBlock(rng, 3, 20, 14)).toBe('park');
  });
});

describe('generateCityPlan — determinismo', () => {
  it('la misma semilla produce un plano idéntico', () => {
    const a = generateCityPlan(2050);
    const b = generateCityPlan(2050);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('semillas distintas producen planos distintos', () => {
    const a = generateCityPlan(1);
    const b = generateCityPlan(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('generateCityPlan — opciones', () => {
  it('respeta un tamaño de grilla distinto', () => {
    expect(generateCityPlan(42, { gridSize: 7 }).blocks).toHaveLength(49);
  });

  it('respeta el tamaño de manzana y el ancho de calle', () => {
    const plan = generateCityPlan(42, { blockSize: 30, streetWidth: 10 });
    expect(plan.blockSize).toBe(30);
    expect(plan.streetWidth).toBe(10);
    expect(plan.blocks.every((b) => b.width === 30)).toBe(true);
  });
});

/**
 * Este control no es un invariante duro sino una medida de DISEÑO urbano, y
 * está acá porque la auditoría detectó que el canal había quedado relegado al
 * borde de la ciudad como efecto secundario de proteger la plaza.
 *
 * Se documenta el valor actual para que la mejora de la Fase 3 sea verificable:
 * cuando se corrija, este test tiene que subir y hay que actualizar el umbral.
 */
describe('generateCityPlan — presencia del canal (medida de diseño)', () => {
  it('registra cuántas manzanas de agua produce en promedio', () => {
    const counts = SEEDS.slice(0, 100).map(
      (seed) => generateCityPlan(seed).blocks.filter((b) => b.kind === 'water').length,
    );
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;

    // Umbral actual, deliberadamente bajo: refleja el estado AUDITADO, no el
    // deseado. Una diagonal a través de una grilla de 9x9 debería tocar entre 9
    // y 12 manzanas; hoy toca ~5 porque el canal corre cerca del borde.
    expect(avg).toBeGreaterThan(3);
    // Toda ciudad tiene algo de canal: si esto falla, hay semillas sin agua.
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });
});
