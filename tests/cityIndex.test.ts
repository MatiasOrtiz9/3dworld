import { describe, it, expect } from 'vitest';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';

const plan = generateCityPlan(42);
const index = new CityIndex(plan);

/**
 * Exige que la semilla de prueba contenga el tipo de manzana que el test
 * necesita, en vez de saltearse el test en silencio.
 *
 * Es una distincion que importa: un `if (!x) return` convierte un test en un
 * no-op cuando el generador cambia, y entonces la suite sigue en verde
 * mientras la cobertura real se evapora. Preferimos que falle ruidosamente.
 */
function require_<T>(value: T | undefined, kind: string): T {
  if (value === undefined) {
    throw new Error(
      `La semilla de prueba no contiene ninguna manzana de tipo "${kind}". ` +
        'Elegí otra semilla o revisá la distribución del generador.',
    );
  }
  return value;
}

describe('CityIndex.blockAt', () => {
  it('encuentra cada manzana en su propio centro', () => {
    for (const b of plan.blocks) {
      const hit = index.blockAt(b.cx, b.cz);
      expect(hit, `manzana ${b.gx},${b.gz}`).not.toBeNull();
      expect(hit!.gx).toBe(b.gx);
      expect(hit!.gz).toBe(b.gz);
    }
  });

  it('devuelve null en el medio de la calle', () => {
    // El eje de la calle entre dos manzanas: no pertenece a ninguna.
    const pitch = plan.blockSize + plan.streetWidth;
    const mid = pitch / 2;
    expect(index.blockAt(mid, 0)).toBeNull();
    expect(index.blockAt(0, mid)).toBeNull();
  });

  it('devuelve null fuera del terreno', () => {
    expect(index.blockAt(99999, 99999)).toBeNull();
    expect(index.blockAt(-99999, 0)).toBeNull();
  });

  it('el borde de la manzana pertenece a la manzana y un metro más allá no', () => {
    const b = plan.blocks.find((x) => x.ring === 2)!;
    const edge = b.width / 2;
    expect(index.blockAt(b.cx + edge - 0.1, b.cz)).not.toBeNull();
    expect(index.blockAt(b.cx + edge + 1, b.cz)).toBeNull();
  });
});

describe('CityIndex.isSolid', () => {
  it('fuera del terreno no camina nadie, pero el jugador puede volar', () => {
    const z = plan.extent + 30;
    expect(index.blockAt(0, z)).toBeNull();
    expect(index.isPedestrianBlocked(0, z)).toBe(true);
    expect(index.isSolid(0, z)).toBe(false);
  });

  it('parques y huertas solares se pueden atravesar caminando', () => {
    for (const b of plan.blocks) {
      if (b.kind === 'park' || b.kind === 'energy' || b.kind === 'water') {
        expect(index.isSolid(b.cx, b.cz), `${b.kind} en ${b.gx},${b.gz}`).toBe(false);
      }
    }
  });

  it('la calle nunca bloquea', () => {
    const pitch = plan.blockSize + plan.streetWidth;
    for (let i = -3; i <= 3; i++) {
      expect(index.isSolid(i * pitch + pitch / 2, 0)).toBe(false);
    }
  });

  it('el patio interior de una manzana de vivienda es transitable', () => {
    const res = require_(plan.blocks.find((b) => b.kind === 'residential'), 'residential');
    // El centro de la manzana perimetral es el patio.
    expect(index.isSolid(res.cx, res.cz)).toBe(false);
    // El perímetro construido, no.
    expect(index.isSolid(res.cx + res.width / 2 - 2, res.cz)).toBe(true);
  });

  it('el fuste de una torre bloquea y su entorno inmediato no', () => {
    const tower = require_(plan.blocks.find((b) => b.kind === 'tower'), 'tower');
    expect(index.isSolid(tower.cx, tower.cz)).toBe(true);
    expect(index.isSolid(tower.cx + 20, tower.cz + 20)).toBe(false);
  });
});

describe('CityIndex.groundHeight', () => {
  it('el canal está hundido y el resto a cota cero', () => {
    const water = require_(plan.blocks.find((b) => b.kind === 'water'), 'water');
    expect(index.groundHeight(water.cx, water.cz)).toBeLessThan(0);
    const park = require_(plan.blocks.find((b) => b.kind === 'park'), 'park');
    expect(index.groundHeight(park.cx, park.cz)).toBe(0);
  });
});

describe('CityIndex.describe', () => {
  it('produce números finitos y no negativos para todas las manzanas', () => {
    for (const b of plan.blocks) {
      const info = index.describe(b);
      for (const [k, v] of Object.entries({
        floors: info.floors,
        solarM2: info.solarM2,
        kwhDay: info.kwhDay,
        people: info.people,
      })) {
        expect(Number.isFinite(v), `${b.kind}.${k}`).toBe(true);
        expect(v, `${b.kind}.${k}`).toBeGreaterThanOrEqual(0);
      }
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.detail.length).toBeGreaterThan(0);
    }
  });

  it('los tipos abiertos no tienen plantas ni habitantes', () => {
    for (const b of plan.blocks) {
      if (b.kind === 'park' || b.kind === 'water') {
        const info = index.describe(b);
        expect(info.floors).toBe(0);
        expect(info.people).toBe(0);
      }
    }
  });

  it('la huerta solar genera más por m² de manzana que una vivienda', () => {
    const energy = require_(plan.blocks.find((b) => b.kind === 'energy'), 'energy');
    const res = require_(plan.blocks.find((b) => b.kind === 'residential'), 'residential');
    expect(index.describe(energy).solarM2).toBeGreaterThan(index.describe(res).solarM2);
  });

  it('la generación es coherente con la superficie de paneles', () => {
    // 1 m² ≈ 0,2 kW pico · 4,5 horas solares pico por día en Buenos Aires.
    for (const b of plan.blocks) {
      const i = index.describe(b);
      expect(i.kwhDay).toBe(Math.round(i.solarM2 * 0.2 * 4.5));
    }
  });
});

describe('CityIndex.totals', () => {
  it('los totales son la suma de las partes', () => {
    const t = index.totals();
    let kwh = 0;
    let people = 0;
    let solar = 0;
    for (const b of plan.blocks) {
      const i = index.describe(b);
      kwh += i.kwhDay;
      people += i.people;
      solar += i.solarM2;
    }
    expect(t.kwhDay).toBe(kwh);
    expect(t.people).toBe(people);
    expect(t.solarM2).toBe(solar);
    expect(t.blocks).toBe(plan.blocks.length);
  });

  it('una ciudad de 81 manzanas da cifras de orden urbano plausible', () => {
    const t = index.totals();
    // Si estos rangos se rompen, algo cambió en las estimaciones y el panel de
    // energía estaría mostrando números sin sentido.
    expect(t.people).toBeGreaterThan(1000);
    expect(t.people).toBeLessThan(60000);
    expect(t.solarM2).toBeGreaterThan(5000);
  });
});

describe('CityIndex — consistencia con otras semillas', () => {
  it('funciona con cualquier tamaño de grilla', () => {
    for (const gridSize of [5, 7, 9, 11]) {
      const p = generateCityPlan(123, { gridSize });
      const idx = new CityIndex(p);
      for (const b of p.blocks) {
        expect(idx.blockAt(b.cx, b.cz), `grid ${gridSize}`).not.toBeNull();
      }
    }
  });
});
