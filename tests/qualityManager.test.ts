import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import { QualityManager } from '../src/core/QualityManager';

describe('QualityManager adaptativo', () => {
  function setup() {
    const camera = { maxZ: 0 };
    const texture = { anisotropicFilteringLevel: 8 };
    const engine = { setHardwareScalingLevel: vi.fn() } as unknown as Engine;
    const scene = { cameras: [camera], textures: [texture] } as unknown as Scene;
    const quality = new QualityManager(engine, scene, 'high');
    return { camera, engine, quality, texture };
  }

  it('reduce el coste por etapas y se detiene en el límite adaptativo', () => {
    const { camera, engine, quality, texture } = setup();
    let changed: number | null = null;
    for (let i = 0; i < 10; i++) changed = quality.observeFrame(250, false);

    expect(changed).toBe(1);
    expect(quality.adaptiveLevel).toBe(1);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1.12);
    expect(camera.maxZ).toBe(1720);
    expect(texture.anisotropicFilteringLevel).toBe(6);

    for (let i = 0; i < 10; i++) changed = quality.observeFrame(250, false);
    expect(changed).toBe(2);
    for (let i = 0; i < 10; i++) changed = quality.observeFrame(250, false);
    expect(changed).toBe(3);
    for (let i = 0; i < 10; i++) changed = quality.observeFrame(250, false);
    expect(changed).toBeNull();
    expect(quality.adaptiveLevel).toBe(3);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1.5);
    expect(camera.maxZ).toBe(1160);
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
    expect(camera.maxZ).toBe(1200);
    expect(texture.anisotropicFilteringLevel).toBe(8);
  });
});
