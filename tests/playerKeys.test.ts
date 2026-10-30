import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { CityIndex } from '../src/world/CityIndex';
import { PlayerController } from '../src/player/PlayerController';

/**
 * Teclado del escritorio: lo apretado se suelta al perder el foco y la F no
 * se repite sola. Sin DOM: `window` es un EventTarget y la escena, un doble.
 */
const g = globalThis as unknown as { window?: EventTarget };
let prevWindow: EventTarget | undefined;

function key(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

function setup() {
  let tick: (() => void) | null = null;
  const scene = {
    onBeforeRenderObservable: { add: (f: () => void) => (tick = f), removeCallback: () => undefined },
    getEngine: () => ({ getDeltaTime: () => 16 }),
  } as unknown as Scene;
  const camera = {
    position: new Vector3(0, 1.62, 0),
    getDirectionToRef: (d: Vector3, out: Vector3) => out.copyFrom(d),
  } as unknown as UniversalCamera;
  const index = { isSolid: () => false, groundHeight: () => 0 } as unknown as CityIndex;
  const player = new PlayerController(scene, camera, index);
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) tick?.();
  };
  return { player, camera, frames };
}

describe('teclado del jugador', () => {
  beforeEach(() => {
    prevWindow = g.window;
    g.window = new EventTarget();
  });
  afterEach(() => {
    g.window = prevWindow;
  });

  it('perder el foco con W apretada no deja al jugador caminando solo', () => {
    const { player, camera, frames } = setup();
    window.dispatchEvent(key('keydown', 'KeyW'));
    frames(10);
    expect(camera.position.z).toBeGreaterThan(0.05);
    // Alt+Tab: el keyup de W no llega nunca.
    window.dispatchEvent(new Event('blur'));
    frames(30);
    const z = camera.position.z;
    frames(30);
    // Frena (sin el arreglo seguía a 4,2 m/s: ~2 m en estos 30 cuadros).
    expect(Math.abs(camera.position.z - z)).toBeLessThan(0.01);
    player.dispose();
  });

  it('mantener F (repetición del teclado) cambia de modo una sola vez', () => {
    const { player } = setup();
    window.dispatchEvent(key('keydown', 'KeyF'));
    for (let i = 0; i < 5; i++) window.dispatchEvent(key('keydown', 'KeyF', true));
    expect(player.mode).toBe('fly');
    player.dispose();
  });
});
