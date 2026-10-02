import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import { QUALITY, QualityManager, TIER_ORDER } from '../src/core/QualityManager';

/** Cámara mínima: lo que QualityManager consulta de una cámara real. */
function fakeCamera(className = 'UniversalCamera', isRigCamera = false) {
  return { maxZ: 0, isRigCamera, getClassName: () => className };
}

describe('QualityManager adaptativo', () => {
  function setup() {
    const camera = fakeCamera();
    const texture = { anisotropicFilteringLevel: 8 };
    const engine = { setHardwareScalingLevel: vi.fn() } as unknown as Engine;
    const scene = { cameras: [camera], textures: [texture] } as unknown as Scene;
    const quality = new QualityManager(engine, scene, 'high');
    return { camera, engine, quality, texture, scene };
  }

  it('reduce el coste por etapas y se detiene en el límite adaptativo', () => {
    const { camera, engine, quality, texture } = setup();
    let changed: number | null = null;
    for (let i = 0; i < 10; i++) changed = quality.observeFrame(250, false);

    expect(changed).toBe(1);
    expect(quality.adaptiveLevel).toBe(1);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1.12);
    expect(camera.maxZ).toBeCloseTo(QUALITY.high.maxZ * 0.86);
    expect(texture.anisotropicFilteringLevel).toBe(6);

    for (let i = 0; i < 10; i++) changed = quality.observeFrame(250, false);
    expect(changed).toBe(2);
    for (let i = 0; i < 10; i++) changed = quality.observeFrame(250, false);
    expect(changed).toBe(3);
    for (let i = 0; i < 10; i++) changed = quality.observeFrame(250, false);
    expect(changed).toBeNull();
    expect(quality.adaptiveLevel).toBe(3);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1.5);
    expect(camera.maxZ).toBeCloseTo(QUALITY.high.maxZ * 0.58);
  });

  it('recupera calidad sólo después de varios segundos estables y al cambiar perfil reinicia el ajuste', () => {
    const { camera, engine, quality, texture } = setup();
    for (let i = 0; i < 30; i++) quality.observeFrame(250, false);
    expect(quality.adaptiveLevel).toBe(3);

    for (let window = 0; window < 3; window++) {
      for (let frame = 0; frame < 200; frame++) quality.observeFrame(12.5, false);
    }
    expect(quality.adaptiveLevel).toBe(3);

    for (let frame = 0; frame < 200; frame++) quality.observeFrame(12.5, false);
    expect(quality.adaptiveLevel).toBe(2);

    quality.set('balanced');
    expect(quality.adaptiveLevel).toBe(0);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1);
    expect(camera.maxZ).toBe(QUALITY.balanced.maxZ);
    expect(texture.anisotropicFilteringLevel).toBe(8);
  });

  it('no pisa el plano lejano de la cámara del visor ni de sus cámaras de ojo', () => {
    // El visor fija su propio plano lejano para que el horizonte no se
    // recorte (vr/XRSetup). La calidad adaptativa sólo maneja las cámaras de
    // escritorio; en VR la palanca es la foveación.
    const desktop = fakeCamera();
    const xr = { ...fakeCamera('WebXRCamera'), maxZ: 1026 };
    const eye = { ...fakeCamera('TargetCamera', true), maxZ: 1026 };
    const engine = { setHardwareScalingLevel: vi.fn() } as unknown as Engine;
    const scene = { cameras: [desktop, xr, eye], textures: [] } as unknown as Scene;
    const quality = new QualityManager(engine, scene, 'vr');

    quality.applyRuntime();
    expect(desktop.maxZ).toBe(QUALITY.vr.maxZ);
    expect(xr.maxZ).toBe(1026);
    expect(eye.maxZ).toBe(1026);

    for (let i = 0; i < 10; i++) quality.observeFrame(250, true);
    expect(quality.adaptiveLevel).toBe(1);
    expect(desktop.maxZ).toBeCloseTo(QUALITY.vr.maxZ * 0.86);
    expect(xr.maxZ).toBe(1026);
  });
});

describe('perfiles de calidad', () => {
  it('todos los perfiles conservan el contrato y los tamaños son coherentes', () => {
    for (const tier of [...TIER_ORDER, 'vr'] as const) {
      const p = QUALITY[tier];
      // `shadows` se conserva por compatibilidad y tiene que coincidir con el modo.
      expect(p.shadows).toBe(p.shadowMode !== 'off');
      if (p.shadowMode !== 'off') expect(p.shadowResolution).toBeGreaterThanOrEqual(512);
      // El plano lejano tiene que alcanzar a cubrir la niebla del barrio
      // (extent + 220 m) aun en el nivel adaptativo más bajo (× 0,58).
      expect(p.maxZ * 0.58).toBeGreaterThan(330);
    }
  });

  it('el visor no paga sombras dinámicas ni post-proceso', () => {
    // Cada malla se dibuja dos veces por cuadro en el visor: una sombra que
    // se redibuja por cuadro o un post-proceso por ojo no entran en 13,9 ms.
    expect(QUALITY.vr.shadowMode).toBe('static');
    expect(QUALITY.vr.shadowFilter).toBe('low');
    expect(QUALITY.vr.post).toBe('off');
    // Sólo el perfil alto (escritorio con placa dedicada) usa cascadas.
    expect(QUALITY.high.shadowMode).toBe('cascaded');
    expect(QUALITY.low.post).not.toBe('high');
  });
});
