import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import { FAR_FLOOR_FACTOR, QUALITY, QualityManager, TIER_ORDER } from '../src/core/QualityManager';
import { fogAmount, fogDensityFor, fogReach } from '../src/world/TimeOfDay';

/** Medio lado del barrio compacto (CityLayout): la niebla cierra en `fogReach` de esto. */
const EXTENT = 142.5;

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

  it('en el visor (fijado en 72 Hz) recupera sosteniendo 72', () => {
    // El visor nunca da más de 72: con la regla vieja (objetivo + 10 = 82)
    // un escalón perdido al entrar no se recuperaba en toda la sesión.
    const { quality } = setup();
    for (let i = 0; i < 10; i++) quality.observeFrame(250, true);
    expect(quality.adaptiveLevel).toBe(1);
    for (let i = 0; i < 72 * 12; i++) quality.observeFrame(1000 / 72, true);
    expect(quality.adaptiveLevel).toBe(0);
  });

  it('no mide los cuadros de arranque, reconstrucción o entrada al visor', () => {
    const { quality } = setup();
    quality.settle();
    // 6 s a 5 fps (compilando shaders): no baja nada.
    for (let i = 0; i < 29; i++) quality.observeFrame(200, false);
    expect(quality.adaptiveLevel).toBe(0);
    // Con Infinity no mide hasta el próximo settle.
    quality.settle(Infinity);
    for (let i = 0; i < 100; i++) quality.observeFrame(200, false);
    expect(quality.adaptiveLevel).toBe(0);
    quality.settle(0);
    // Pasado el arranque, la lentitud sostenida sí cuenta.
    for (let i = 0; i < 13; i++) quality.observeFrame(200, false);
    expect(quality.adaptiveLevel).toBe(1);
  });

  it('sin tope, un tirón aislado no baja y una recuperación fallida duplica la espera', () => {
    const { quality } = setup();
    // Un shader de 700 ms dentro de una ventana a 60.
    quality.observeFrame(700, false);
    for (let i = 0; i < 120; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(0);

    for (let i = 0; i < 70; i++) quality.observeFrame(40, false);
    expect(quality.adaptiveLevel).toBe(1);
    // Sostener 60 unos 8 s (la primera ventana todavía arrastra cuadros lentos): recupera.
    for (let i = 0; i < 60 * 14; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(0);
    // Recuperar hizo caer los cuadros enseguida: la próxima espera el doble (16 s).
    while (quality.adaptiveLevel === 0) quality.observeFrame(40, false);
    expect(quality.adaptiveLevel).toBe(1);
    for (let i = 0; i < 60 * 14; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(1);
    for (let i = 0; i < 60 * 8; i++) quality.observeFrame(1000 / 60, false);
    expect(quality.adaptiveLevel).toBe(0);
  });

  it('el plano lejano adaptativo nunca corta antes de que cierre la niebla', () => {
    // Con la niebla cerrando en extent + 360 m, 'low' y 'mobile' al nivel 3
    // (× 0,58 = 348 m) cortaban el suelo con la niebla al 76 % y desde el
    // aire asomaba el cielo marrón de debajo del horizonte.
    const reach = fogReach(EXTENT);
    for (const tier of ['low', 'mobile', 'vr', 'balanced', 'high'] as const) {
      const camera = fakeCamera();
      const engine = { setHardwareScalingLevel: vi.fn() } as unknown as Engine;
      const scene = { cameras: [camera], textures: [] } as unknown as Scene;
      const quality = new QualityManager(engine, scene, tier);
      quality.setFogReach(reach);
      for (let i = 0; i < 40; i++) quality.observeFrame(250, false);
      expect(quality.adaptiveLevel).toBe(3);
      expect(camera.maxZ).toBeGreaterThan(reach);
      // En el corte la niebla ya tapa el 97 % del suelo.
      expect(fogAmount(camera.maxZ, fogDensityFor(reach))).toBeGreaterThan(0.97);
      // Por encima del piso la palanca sigue funcionando.
      expect(camera.maxZ).toBeCloseTo(Math.max(QUALITY[tier].maxZ * 0.58, reach * FAR_FLOOR_FACTOR));
    }
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
    for (const tier of [...TIER_ORDER, 'vr', 'mobile'] as const) {
      const p = QUALITY[tier];
      // `shadows` se conserva por compatibilidad y tiene que coincidir con el modo.
      expect(p.shadows).toBe(p.shadowMode !== 'off');
      if (p.shadowMode !== 'off') expect(p.shadowResolution).toBeGreaterThanOrEqual(512);
      // Sin carga, el plano lejano del perfil ya queda más allá del piso
      // (la niebla cerrada, ver QualityManager.setFogReach): extent + 360 m.
      expect(p.maxZ).toBeGreaterThan(fogReach(EXTENT) * FAR_FLOOR_FACTOR);
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
