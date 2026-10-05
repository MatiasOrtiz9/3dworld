import { describe, expect, it } from 'vitest';
import {
  COMFORT_OPTIONS,
  DEFAULT_COMFORT,
  RUN_FACTOR,
  comfortValueLabel,
  cycleComfort,
  runSpeed,
  sanitizeComfort,
  vignetteOpacity,
  walkSpeed,
  type ComfortSettings,
} from '../src/vr/XRComfort';

/** Ajustes de confort del visor: el menú los recorre y se guardan aparte de la partida. */
describe('ajustes de confort VR', () => {
  it('cada opción recorre todos sus valores y vuelve al primero', () => {
    for (const opt of COMFORT_OPTIONS) {
      let s: ComfortSettings = { ...DEFAULT_COMFORT };
      const seen = [s[opt.key]];
      for (let i = 0; i < opt.values.length; i++) {
        s = cycleComfort(s, opt.key);
        seen.push(s[opt.key]);
      }
      expect(seen[seen.length - 1]).toBe(DEFAULT_COMFORT[opt.key]);
      expect(new Set(seen).size).toBe(opt.values.length);
    }
  });

  it('cambiar una opción no toca las otras ni el original', () => {
    const base = { ...DEFAULT_COMFORT };
    const next = cycleComfort(base, 'turnMode');
    expect(next.turnMode).toBe('smooth');
    expect(base.turnMode).toBe('snap');
    expect({ ...next, turnMode: 'snap' }).toEqual(base);
  });

  it('una clave desconocida devuelve una copia igual', () => {
    const base = { ...DEFAULT_COMFORT };
    const same = cycleComfort(base, 'nope' as keyof ComfortSettings);
    expect(same).toEqual(base);
    expect(same).not.toBe(base);
  });

  it('sanitize descarta valores inválidos y completa lo que falta', () => {
    expect(sanitizeComfort(null)).toEqual(DEFAULT_COMFORT);
    expect(sanitizeComfort('basura')).toEqual(DEFAULT_COMFORT);
    const s = sanitizeComfort({ turnMode: 'smooth', snapAngle: 90, moveSpeed: 'warp', seated: 'sí', vignette: 'off', extra: 1 });
    expect(s.turnMode).toBe('smooth');
    expect(s.snapAngle).toBe(DEFAULT_COMFORT.snapAngle);
    expect(s.moveSpeed).toBe(DEFAULT_COMFORT.moveSpeed);
    expect(s.seated).toBe(DEFAULT_COMFORT.seated);
    expect(s.vignette).toBe('off');
    expect('extra' in s).toBe(false);
  });

  it('las velocidades crecen con el ajuste y correr es más rápido', () => {
    const at = (moveSpeed: ComfortSettings['moveSpeed']) => walkSpeed({ ...DEFAULT_COMFORT, moveSpeed });
    expect(at('slow')).toBeLessThan(at('normal'));
    expect(at('normal')).toBeLessThan(at('fast'));
    // En VR bastante menos que en escritorio (4,2 m/s): el mareo crece con la velocidad.
    expect(at('fast')).toBeLessThan(4.2);
    expect(runSpeed(DEFAULT_COMFORT)).toBeCloseTo(walkSpeed(DEFAULT_COMFORT) * RUN_FACTOR, 6);
  });

  it('viñeta: apagada es 0, fuerte más que suave', () => {
    expect(vignetteOpacity({ ...DEFAULT_COMFORT, vignette: 'off' })).toBe(0);
    expect(vignetteOpacity({ ...DEFAULT_COMFORT, vignette: 'strong' })).toBeGreaterThan(
      vignetteOpacity({ ...DEFAULT_COMFORT, vignette: 'soft' }),
    );
  });

  it('el rótulo del valor vigente sale de las opciones', () => {
    const turn = COMFORT_OPTIONS.find((o) => o.key === 'turnMode')!;
    expect(comfortValueLabel(DEFAULT_COMFORT, turn)).toBe('Por pasos');
  });
});
