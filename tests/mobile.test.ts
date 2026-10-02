import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import {
  classifyDevice,
  detectTouchMode,
  estimateRefresh,
  evenCap,
  fovForAspect,
  mobileRenderScale,
} from '../src/ui/device';
import { clampPitch, followBase, isTap, lookCurve, PITCH_LIMIT, stickOutput, swipeGain } from '../src/ui/joystick';
import { VirtualInput } from '../src/player/VirtualInput';
import { QUALITY, QualityManager, TOUCH_TIER_ORDER } from '../src/core/QualityManager';

describe('detección del celular', () => {
  it('?touch=1|0 fuerza el modo (para probar en la PC)', () => {
    expect(detectTouchMode('?touch=1')).toBe(true);
    expect(detectTouchMode('?touch=0')).toBe(false);
  });

  it('gama del equipo por memoria, núcleos y GPU', () => {
    expect(classifyDevice({ memory: 2, cores: 8, gpu: 'Adreno (TM) 740' })).toBe('weak');
    expect(classifyDevice({ memory: 8, cores: 4, gpu: 'Adreno (TM) 740' })).toBe('weak');
    expect(classifyDevice({ memory: 4, cores: 8, gpu: 'Mali-G52 MC2' })).toBe('weak');
    expect(classifyDevice({ memory: 6, cores: 8, gpu: 'Adreno (TM) 610' })).toBe('weak');
    expect(classifyDevice({ memory: 6, cores: 8, gpu: 'Adreno (TM) 642L' })).toBe('mid');
    expect(classifyDevice({ cores: 6, gpu: 'Apple GPU' })).toBe('mid');
    expect(classifyDevice({ memory: 8, cores: 8, gpu: 'Adreno (TM) 750' })).toBe('strong');
    expect(classifyDevice({ memory: 8, cores: 8, gpu: 'Mali-G715 Immortalis MC11' })).toBe('strong');
    // Sin datos: gama media (la calidad adaptativa corrige).
    expect(classifyDevice({})).toBe('mid');
  });

  it('la resolución respeta el techo de píxeles de cada gama y la densidad física', () => {
    // Teléfono típico apaisado: 844 × 390 CSS, densidad 3.
    const mid = mobileRenderScale('mid', 844, 390, 3);
    expect(844 * 390 * mid * mid).toBeLessThanOrEqual(0.62e6 * 1.01);
    expect(mid).toBeGreaterThan(1);
    const weak = mobileRenderScale('weak', 844, 390, 3);
    expect(weak).toBeLessThan(mid);
    expect(844 * 390 * weak * weak).toBeLessThanOrEqual(0.33e6 * 1.01);
    expect(mobileRenderScale('strong', 844, 390, 3)).toBeGreaterThan(mid);
    // Nunca más píxeles que los físicos.
    expect(mobileRenderScale('strong', 640, 360, 1)).toBeLessThanOrEqual(1);
    // Tableta grande: el techo manda, sin bajar de 0,6.
    expect(mobileRenderScale('weak', 1366, 1024, 2)).toBeGreaterThanOrEqual(0.6);
  });

  it('campo visual: fija el horizontal en pantallas anchas, sin pasar el del escritorio', () => {
    expect(fovForAspect(16 / 9)).toBeCloseTo(0.98);
    expect(fovForAspect(4 / 3)).toBeCloseTo(0.98);
    const wide = fovForAspect(19.5 / 9);
    expect(wide).toBeLessThan(0.98);
    // Horizontal resultante ≈ 90°.
    const h = 2 * Math.atan(Math.tan(wide / 2) * (19.5 / 9));
    expect((h * 180) / Math.PI).toBeCloseTo(90, 0);
    expect(fovForAspect(4)).toBeGreaterThanOrEqual(0.78);
  });
});

describe('tope de cuadros parejo', () => {
  it('estima la frecuencia aunque haya cuadros largos', () => {
    const noisy = (ms: number) => Array.from({ length: 120 }, (_, i) => (i % 4 === 0 ? ms * 2 : ms + ((i % 3) - 1) * 0.4));
    expect(estimateRefresh(noisy(1000 / 60))).toBe(60);
    expect(estimateRefresh(noisy(1000 / 90))).toBe(90);
    expect(estimateRefresh(noisy(1000 / 120))).toBe(120);
    expect(estimateRefresh([])).toBe(60);
  });

  it('el tope divide exacto la frecuencia de la pantalla', () => {
    expect(evenCap(60, 60)).toBe(60);
    expect(evenCap(120, 60)).toBe(60);
    expect(evenCap(90, 60)).toBe(45);
    expect(evenCap(144, 60)).toBe(72);
    expect(evenCap(120, 30)).toBe(30);
    expect(evenCap(90, 30)).toBe(30);
    expect(evenCap(60, 10)).toBe(10);
  });
});

describe('joystick', () => {
  it('zona muerta sin salto, recorrido pleno y arriba = adelante', () => {
    expect(stickOutput(0, -5, 56).mag).toBe(0);
    const just = stickOutput(0, -(56 * 0.14 + 1), 56);
    expect(just.mag).toBeGreaterThan(0);
    expect(just.mag).toBeLessThan(0.05);
    const full = stickOutput(0, -200, 56);
    expect(full.y).toBeCloseTo(1);
    expect(full.x).toBe(0);
    const back = stickOutput(0, 56, 56);
    expect(back.y).toBeCloseTo(-1);
    const right = stickOutput(56, 0, 56);
    expect(right.x).toBeCloseTo(1);
  });

  it('cerca de un eje la dirección se pega al eje (caminar derecho por un pasillo)', () => {
    const almost = stickOutput(3, -56, 56);
    expect(almost.x).toBe(0);
    expect(almost.y).toBeCloseTo(1);
    const diag = stickOutput(40, -40, 56);
    expect(diag.x).toBeGreaterThan(0.6);
    expect(diag.y).toBeGreaterThan(0.6);
  });

  it('la base persigue al dedo que se pasa del borde', () => {
    expect(followBase(100, 100, 120, 100, 50)).toEqual({ x: 100, y: 100 });
    const b = followBase(100, 100, 200, 100, 50);
    expect(b.x).toBeCloseTo(150);
    expect(Math.hypot(200 - b.x, 100 - b.y)).toBeCloseTo(50);
  });

  it('curvas de cámara: finas al centro, aceleración acotada', () => {
    expect(lookCurve(0)).toBe(0);
    expect(Math.abs(lookCurve(0.2))).toBeLessThan(0.1);
    expect(lookCurve(1)).toBeCloseTo(1);
    expect(lookCurve(-1)).toBeCloseTo(-1);
    expect(swipeGain(0)).toBe(1);
    expect(swipeGain(10)).toBeCloseTo(1.6);
    expect(swipeGain(1)).toBeGreaterThan(swipeGain(0.5));
    expect(clampPitch(3)).toBe(PITCH_LIMIT);
    expect(clampPitch(-3)).toBe(-PITCH_LIMIT);
  });

  it('un toque es corto y casi quieto', () => {
    expect(isTap(120, 4)).toBe(true);
    expect(isTap(500, 4)).toBe(false);
    expect(isTap(120, 30)).toBe(false);
  });
});

describe('mandos virtuales', () => {
  it('un toque de salto vale un salto, con margen para tocarlo apenas antes de caer', () => {
    const v = new VirtualInput();
    expect(v.takeJump(1000)).toBe(false);
    v.pressJump(1000);
    expect(v.takeJump(1000 + VirtualInput.JUMP_BUFFER_MS - 10)).toBe(true);
    expect(v.takeJump(1000 + VirtualInput.JUMP_BUFFER_MS - 5)).toBe(false);
    v.pressJump(2000);
    expect(v.takeJump(2000 + VirtualInput.JUMP_BUFFER_MS + 50)).toBe(false);
  });

  it('reset suelta todo', () => {
    const v = new VirtualInput();
    v.x = 0.5;
    v.y = -1;
    v.run = true;
    v.rise = 1;
    v.pressJump(10);
    v.reset();
    expect([v.x, v.y, v.run, v.rise]).toEqual([0, 0, false, 0]);
    expect(v.takeJump(10)).toBe(false);
  });
});

describe('calidad en el celular', () => {
  function setup() {
    const camera = { maxZ: 0, isRigCamera: false, getClassName: () => 'UniversalCamera' };
    const texture = { anisotropicFilteringLevel: 8 };
    const engine = { setHardwareScalingLevel: vi.fn() } as unknown as Engine;
    const scene = { cameras: [camera], textures: [texture] } as unknown as Scene;
    const quality = new QualityManager(engine, scene, 'mobile');
    return { engine, quality, texture };
  }

  it("el perfil 'Móvil' no paga post-proceso ni sombras dinámicas", () => {
    const p = QUALITY.mobile;
    expect(p.post).toBe('off');
    expect(p.shadowMode).toBe('static');
    expect(p.shadowResolution).toBeLessThanOrEqual(1024);
    expect(p.highDetailStreet).toBe(false);
    expect(p.crowdSize).toBeLessThanOrEqual(QUALITY.vr.crowdSize);
    expect(TOUCH_TIER_ORDER).toContain('mobile');
    expect(TOUCH_TIER_ORDER).not.toContain('high');
  });

  it('la escala del equipo se suma a la del perfil y el anisótropo baja a la mitad', () => {
    const { engine, quality, texture } = setup();
    quality.setDeviceScaling(0.8);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(0.8);
    expect(texture.anisotropicFilteringLevel).toBe(4);
    quality.startAdaptive(1);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(0.8 * 1.12);
  });

  it('a 30 cuadros por elección (ahorro, menú) no baja la calidad', () => {
    const { quality } = setup();
    quality.setFrameCap(30);
    for (let i = 0; i < 300; i++) quality.observeFrame(1000 / 30, false);
    expect(quality.adaptiveLevel).toBe(0);
  });

  it('un tirón aislado no baja un escalón; la lentitud sostenida sí', () => {
    const { quality } = setup();
    quality.setFrameCap(60);
    // Un shader que tarda 700 ms en una ventana de 2,5 s a 60.
    quality.observeFrame(700, false);
    for (let i = 0; i < 120; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(0);
    // 25 cuadros por segundo de verdad.
    for (let i = 0; i < 70; i++) quality.observeFrame(40, false);
    expect(quality.adaptiveLevel).toBe(1);
  });

  it('con tope se recupera sosteniéndolo, y una recuperación fallida duplica la espera', () => {
    const { quality } = setup();
    quality.setFrameCap(60);
    for (let i = 0; i < 70; i++) quality.observeFrame(40, false);
    expect(quality.adaptiveLevel).toBe(1);
    // Sostener el tope ~15 s (la primera ventana todavía arrastra cuadros lentos): recupera.
    for (let i = 0; i < 60 * 18; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(0);
    // Vuelve a caer enseguida: baja otra vez...
    for (let i = 0; i < 70; i++) quality.observeFrame(40, false);
    expect(quality.adaptiveLevel).toBe(1);
    // ... y ahora 18 s no alcanzan (espera 30).
    for (let i = 0; i < 60 * 18; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(1);
    for (let i = 0; i < 60 * 20; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(0);
  });

  it('sin tope (escritorio) se comporta como siempre: no recupera sin margen', () => {
    const { quality } = setup();
    for (let i = 0; i < 70; i++) quality.observeFrame(40, false);
    expect(quality.adaptiveLevel).toBe(1);
    for (let i = 0; i < 60 * 30; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(1);
  });
});
