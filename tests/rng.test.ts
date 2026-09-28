import { describe, it, expect } from 'vitest';
import { Rng, seedFromString } from '../src/utils/rng';

describe('Rng', () => {
  it('es determinista: la misma semilla da la misma secuencia', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('semillas distintas dan secuencias distintas', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() se mantiene dentro de [0, 1)', () => {
    const rng = new Rng(999);
    for (let i = 0; i < 5000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('range() respeta los límites', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const v = rng.range(-5, 12.5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(12.5);
    }
  });

  it('int() es inclusivo en ambos extremos', () => {
    const rng = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) seen.add(rng.int(0, 3));
    // Con 3000 tiradas sobre 4 valores, que falte alguno indicaría que el
    // extremo superior está excluido — el error clásico al escribir int().
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('int(n, n) siempre devuelve n', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 100; i++) expect(rng.int(5, 5)).toBe(5);
  });

  it('chance() se aproxima a la probabilidad pedida', () => {
    const rng = new Rng(2024);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (rng.chance(0.3)) hits++;
    expect(hits / n).toBeGreaterThan(0.28);
    expect(hits / n).toBeLessThan(0.32);
  });

  it('chance(0) nunca ocurre y chance(1) siempre', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 500; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('pick() sólo devuelve elementos del arreglo y los alcanza a todos', () => {
    const rng = new Rng(5);
    const items = ['a', 'b', 'c', 'd'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.pick(items);
      expect(items).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(items.length);
  });

  it('shuffle() conserva todos los elementos', () => {
    const rng = new Rng(88);
    const original = Array.from({ length: 40 }, (_, i) => i);
    const shuffled = rng.shuffle([...original]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
  });

  it('shuffle() efectivamente reordena', () => {
    const rng = new Rng(88);
    const original = Array.from({ length: 40 }, (_, i) => i);
    expect(rng.shuffle([...original])).not.toEqual(original);
  });
});

describe('seedFromString', () => {
  it('es estable: el mismo texto da la misma semilla', () => {
    expect(seedFromString('ciudad-2050')).toBe(seedFromString('ciudad-2050'));
  });

  it('textos distintos dan semillas distintas', () => {
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });

  it('devuelve un entero sin signo de 32 bits', () => {
    for (const s of ['', 'x', 'una semilla bastante larga con acentos áéí', '42']) {
      const v = seedFromString(s);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
