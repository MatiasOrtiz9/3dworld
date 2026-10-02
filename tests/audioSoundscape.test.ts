import { describe, it, expect, vi, afterEach } from 'vitest';
import { Soundscape } from '../src/audio/Soundscape';
import type { AudioApi } from '../src/game/contracts';

/**
 * Sin AudioContext (Node, navegadores sin audio, contexto que no se puede
 * crear) todo tiene que ser un no-op seguro: el juego no puede caerse por
 * el sonido. Y `voice()` igual tiene que devolver la duración y avisar el
 * final, porque de eso dependen los diálogos.
 */
function exercise(s: Soundscape): void {
  const p = { x: 1, y: 1.7, z: 2 };
  s.setZone('patio');
  s.setZone('gym');
  s.setPhase('recreo');
  s.setPhase('acto');
  s.setSurface('metal');
  s.setListener(p, { x: 0, z: 1 });
  s.setListener(p);
  s.step(false);
  s.step(true, 'wood');
  s.door(true);
  s.door(false, p, 'metal');
  s.bell();
  s.bell(p, 3);
  s.click();
  s.click(880);
  for (const k of ['open', 'close', 'objective', 'reward', 'error', 'unlock', 'select'] as const)
    s.ui(k);
  s.sfx('applause');
  s.sfx('whistle', p);
  s.tramChime(0.5);
  s.music('intro');
  s.music('act');
  s.music('credits');
  s.music('none');
  s.setMasterVolume(0.3);
  s.setChannelVolume('music', 0.2);
  s.setLowPower(true);
  s.setVoiceMode('babble');
  s.stopVoice();
  expect(s.levels()).toBeNull();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Soundscape sin audio', () => {
  it('cumple el contrato AudioApi', () => {
    const api: AudioApi = new Soundscape({ persist: false });
    expect(api.available).toBe(false);
    api.dispose();
  });

  it('todos los métodos son no-ops seguros', async () => {
    const s = new Soundscape({ persist: false });
    expect(s.available).toBe(false);
    await expect(s.resume()).resolves.toBeUndefined();
    expect(() => exercise(s)).not.toThrow();
    expect(s.zone).toBe('gym');
    expect(s.phase).toBe('acto');
    expect(s.isMuted).toBe(false);
    expect(s.toggleMute()).toBe(true);
    expect(s.isMuted).toBe(true);
    expect(s.toggleMute()).toBe(false);
    s.dispose();
    s.dispose();
    expect(() => exercise(s)).not.toThrow();
  });

  it('ignora zonas y fases desconocidas', () => {
    const s = new Soundscape({ persist: false });
    s.setZone('classroom');
    s.setZone('nada' as never);
    s.setPhase('nunca' as never);
    expect(s.zone).toBe('classroom');
    expect(s.phase).toBe('entrada');
  });

  it('voice devuelve la duración y avisa el final igual', () => {
    vi.useFakeTimers();
    const s = new Soundscape({ persist: false });
    const done = vi.fn();
    const d = s.voice('Bienvenidos a la escuela CIMDIP y Miguel Cané.', { pitch: 1.2 }, done);
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(10);
    expect(s.speaking).toBe(true);
    vi.advanceTimersByTime(d * 1000 + 200);
    expect(done).toHaveBeenCalledTimes(1);
    expect(s.speaking).toBe(false);
  });

  it('stopVoice corta sin avisar el final y una línea nueva reemplaza a la anterior', () => {
    vi.useFakeTimers();
    const s = new Soundscape({ persist: false });
    const first = vi.fn();
    const second = vi.fn();
    s.voice('Primera línea, bastante larga para que dure.', { pitch: 1 }, first);
    const d = s.voice('Segunda.', { pitch: 0.8, rate: 1.2 }, second);
    vi.advanceTimersByTime(d * 1000 + 100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    const third = vi.fn();
    s.voice('Tercera.', { pitch: 1 }, third);
    s.stopVoice();
    vi.advanceTimersByTime(10000);
    expect(third).not.toHaveBeenCalled();
  });

  it('una línea vacía dura cero', () => {
    vi.useFakeTimers();
    const s = new Soundscape({ persist: false });
    const done = vi.fn();
    expect(s.voice('  ', { pitch: 1 }, done)).toBe(0);
    vi.runAllTimers();
    expect(done).toHaveBeenCalled();
  });
});

describe('Soundscape con un AudioContext que no se puede crear', () => {
  it('queda no disponible y no rompe nada', async () => {
    const listeners: string[] = [];
    vi.stubGlobal('window', {
      addEventListener: (ev: string) => listeners.push(ev),
      removeEventListener: (ev: string) => listeners.splice(listeners.indexOf(ev), 1),
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('sin audio');
        }
      },
    );
    const s = new Soundscape({ persist: false });
    expect(s.available).toBe(true); // hay constructor: todavía no se sabe
    expect(listeners.length).toBe(3); // se reanuda con el primer gesto
    await s.resume();
    expect(s.available).toBe(false);
    expect(listeners.length).toBe(0);
    expect(() => exercise(s)).not.toThrow();
    s.dispose();
  });

  it('recuerda volumen y silencio entre visitas', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const a = new Soundscape();
    a.setMasterVolume(0.4);
    a.toggleMute();
    const b = new Soundscape();
    expect(b.isMuted).toBe(true);
    expect(b.volume).toBeCloseTo(0.4, 6);
    store.set('ciudad2050.audio.v1', '{roto');
    expect(() => new Soundscape()).not.toThrow();
  });
});
