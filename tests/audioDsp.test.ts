import { describe, it, expect } from 'vitest';
import {
  BELL_PARTIALS,
  crossfadeLoop,
  makeNoise,
  peakOf,
  renderApplause,
  renderBell,
  renderImpulse,
  rmsOf,
} from '../src/audio/dsp';
import { seeded } from '../src/audio/speech';

const finite = (d: Float32Array): boolean => d.every((x) => Number.isFinite(x));
const energy = (d: Float32Array, a: number, b: number): number => {
  let e = 0;
  for (let i = a; i < b; i++) e += d[i] * d[i];
  return e;
};

describe('ruidos', () => {
  it('blanco, rosa y marrón: finitos, acotados y deterministas', () => {
    for (const c of ['white', 'pink', 'brown'] as const) {
      const a = makeNoise(20000, seeded(1), c);
      expect(finite(a)).toBe(true);
      expect(peakOf(a)).toBeLessThan(1.5);
      expect(rmsOf(a)).toBeGreaterThan(0.01);
      expect(makeNoise(20000, seeded(1), c)).toEqual(a);
    }
  });

  it('el rosa tiene menos agudos que el blanco (diferencias entre muestras)', () => {
    const diff = (d: Float32Array): number => {
      let e = 0;
      for (let i = 1; i < d.length; i++) e += (d[i] - d[i - 1]) ** 2;
      return e / rmsOf(d) ** 2;
    };
    expect(diff(makeNoise(20000, seeded(2), 'pink'))).toBeLessThan(
      diff(makeNoise(20000, seeded(2), 'white')),
    );
  });
});

describe('bucle sin costura', () => {
  it('el salto entre el final y el principio es el de una muestra a la siguiente', () => {
    const n = 1000;
    const fade = 200;
    const sr = 8000;
    const data = new Float32Array(n + fade);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * 333 * i) / sr);
    const naive = Math.abs(data[n - 1] - data[0]);
    const out = crossfadeLoop(data, n, fade);
    expect(out.length).toBe(n);
    const seam = Math.abs(out[n - 1] - out[0]);
    const step = (2 * Math.PI * 333) / sr; // máxima diferencia entre muestras vecinas
    expect(seam).toBeLessThanOrEqual(step * 1.2);
    expect(seam).toBeLessThan(naive);
  });

  it('sin material extra devuelve el recorte tal cual', () => {
    const d = new Float32Array([1, 2, 3, 4]);
    expect(Array.from(crossfadeLoop(d, 4, 10))).toEqual([1, 2, 3, 4]);
  });
});

describe('reverberación', () => {
  it('dos canales distintos que decaen', () => {
    const [L, R] = renderImpulse(8000, 1.5, seeded(3));
    expect(L.length).toBe(12000);
    expect(finite(L) && finite(R)).toBe(true);
    expect(L).not.toEqual(R);
    expect(energy(L, 0, 1200)).toBeGreaterThan(energy(L, 10800, 12000) * 100);
  });
});

describe('campana de bronce', () => {
  it('normalizada, finita, determinista y con cola larga', () => {
    const sr = 8000;
    const a = renderBell(sr, 4, 440, seeded(4));
    expect(finite(a)).toBe(true);
    expect(peakOf(a)).toBeCloseTo(0.9, 5);
    expect(renderBell(sr, 4, 440, seeded(4))).toEqual(a);
    // Sigue sonando a los 2 s, pero bastante más bajo que el golpe.
    const head = energy(a, 0, sr / 2);
    const tail = energy(a, 2 * sr, 2.5 * sr);
    expect(tail).toBeGreaterThan(0);
    expect(head).toBeGreaterThan(tail * 4);
  });

  it('los parciales graves duran más que los agudos', () => {
    for (let i = 1; i < BELL_PARTIALS.length; i++) {
      if (BELL_PARTIALS[i][0] > 2)
        expect(BELL_PARTIALS[i][2]).toBeLessThanOrEqual(BELL_PARTIALS[1][2]);
    }
  });

  it('no calcula parciales por encima de Nyquist', () => {
    // Fundamental alta con frecuencia de muestreo baja: no debe explotar ni salir de rango.
    const d = renderBell(4000, 1, 900, seeded(5));
    expect(finite(d)).toBe(true);
    expect(peakOf(d)).toBeLessThanOrEqual(0.9 + 1e-6);
  });
});

describe('aplauso', () => {
  it('parejo durante todo el largo y sin saturar', () => {
    const sr = 8000;
    const [L, R] = renderApplause(sr, 3, seeded(6), 20);
    expect(finite(L) && finite(R)).toBe(true);
    expect(Math.max(peakOf(L), peakOf(R))).toBeLessThanOrEqual(0.9 + 1e-6);
    for (let s = 0; s < 3; s++)
      expect(energy(L, s * sr, (s + 1) * sr) + energy(R, s * sr, (s + 1) * sr)).toBeGreaterThan(1);
  });
});
