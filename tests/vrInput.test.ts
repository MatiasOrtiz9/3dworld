import { describe, expect, it } from 'vitest';
import { Observable } from '@babylonjs/core/Misc/observable';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { Scene } from '@babylonjs/core/scene';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import {
  analogHeld,
  HAPTICS,
  PRESS_AT,
  RELEASE_AT,
  strongestAxes,
  XRInput,
  type XRButtonEvent,
  type XRReleaseEvent,
} from '../src/vr/XRInput';

/**
 * Botones del visor leídos del gamepad crudo (XRInput), con una escena y una
 * experiencia XR de mentira: sólo lo que XRInput toca. Lo que se prueba es
 * lo que evita clics fantasma y estados colgados en el Quest.
 */

function button(value = 0, pressed = false) {
  return { value, pressed, touched: pressed };
}

function fakeSource(handedness: 'left' | 'right' | 'none') {
  const pad = { axes: [0, 0, 0, 0], buttons: [button(), button(), button(), button(), button(), button()] };
  const node = () => ({ absolutePosition: new Vector3(), computeWorldMatrix: () => undefined });
  return {
    uniqueId: `src-${handedness}`,
    inputSource: { handedness, gamepad: pad },
    pointer: node(),
    grip: node(),
    getWorldPointerRayToRef: () => undefined,
    pad,
  };
}

function fakeWorld() {
  const scene = { onBeforeRenderObservable: new Observable<unknown>() };
  const added = new Observable<unknown>();
  const removed = new Observable<unknown>();
  const stateObs = new Observable<WebXRState>();
  const experience = {
    input: { onControllerAddedObservable: added, onControllerRemovedObservable: removed, controllers: [] as unknown[] },
    baseExperience: {
      state: WebXRState.IN_XR,
      onStateChangedObservable: stateObs,
      sessionManager: { onXRSessionInit: new Observable<unknown>(), session: null },
    },
  };
  const input = new XRInput(scene as unknown as Scene, experience as unknown as WebXRDefaultExperience);
  const presses: XRButtonEvent[] = [];
  const releases: XRReleaseEvent[] = [];
  input.onPress.add((e) => presses.push(e));
  input.onRelease.add((e) => releases.push(e));
  const frame = () => scene.onBeforeRenderObservable.notifyObservers(scene);
  return { scene, experience, input, added, removed, stateObs, presses, releases, frame };
}

describe('XRInput: funciones puras', () => {
  it('el gatillo tiene histéresis: aprieta de verdad y suelta de verdad', () => {
    expect(analogHeld(false, 0.2)).toBe(false);
    expect(analogHeld(false, PRESS_AT - 0.01)).toBe(false);
    expect(analogHeld(false, PRESS_AT)).toBe(true);
    // Apretado, aflojar un poco no lo suelta (el dedo tiembla).
    expect(analogHeld(true, 0.45)).toBe(true);
    expect(analogHeld(true, RELEASE_AT)).toBe(false);
  });

  it('el stick es el par de ejes más desviado (touchpad vacío en 0-1, stick en 2-3)', () => {
    expect(strongestAxes([0, 0, 0.4, -0.9])).toEqual({ x: 0.4, y: -0.9 });
    expect(strongestAxes([0.7, 0.1, 0, 0])).toEqual({ x: 0.7, y: 0.1 });
    expect(strongestAxes([])).toEqual({ x: 0, y: 0 });
  });

  it('los pulsos son cortos y suaves; el error son dos golpes', () => {
    for (const steps of Object.values(HAPTICS)) {
      for (const s of steps) {
        expect(s.value).toBeGreaterThan(0);
        expect(s.value).toBeLessThanOrEqual(0.5);
        expect(s.ms).toBeLessThanOrEqual(40);
      }
    }
    expect(HAPTICS.error).toHaveLength(2);
    expect(HAPTICS.error[1].delay).toBeGreaterThanOrEqual(80 + HAPTICS.error[0].ms);
  });
});

describe('XRInput con mandos de mentira', () => {
  it('un flanco por pulsación, en la mano correcta, con cuánto se mantuvo', () => {
    const w = fakeWorld();
    const right = fakeSource('right');
    w.added.notifyObservers(right);
    expect(w.input.has('right')).toBe(true);
    expect(w.input.has('left')).toBe(false);

    right.pad.buttons[0] = button(0.8, true);
    w.frame();
    w.frame();
    expect(w.presses).toEqual([{ hand: 'right', button: 'trigger' }]);
    expect(w.input.isDown('right', 'trigger')).toBe(true);

    // Aflojar a medias no suelta; soltar del todo, sí.
    right.pad.buttons[0] = button(0.4, true);
    w.frame();
    expect(w.releases).toHaveLength(0);
    right.pad.buttons[0] = button(0.1, false);
    w.frame();
    expect(w.releases).toHaveLength(1);
    expect(w.releases[0]).toMatchObject({ hand: 'right', button: 'trigger' });
    expect(w.releases[0].heldMs).toBeGreaterThanOrEqual(0);
  });

  it('mapeo xr-standard: grip 1, clic del stick 3, A/X 4, B/Y 5', () => {
    const w = fakeWorld();
    const left = fakeSource('left');
    w.added.notifyObservers(left);
    left.pad.buttons[1] = button(1, true);
    left.pad.buttons[3] = button(1, true);
    left.pad.buttons[4] = button(1, true);
    left.pad.buttons[5] = button(1, true);
    w.frame();
    expect(w.presses.map((p) => `${p.hand}:${p.button}`).sort()).toEqual(
      ['left:grip', 'left:primary', 'left:secondary', 'left:stick'].sort(),
    );
  });

  it('un puntero sin lado cuenta como mano derecha', () => {
    const w = fakeWorld();
    w.added.notifyObservers(fakeSource('none'));
    expect(w.input.has('right')).toBe(true);
  });

  it('al salir del visor se suelta lo apretado (nada queda colgado)', () => {
    const w = fakeWorld();
    const right = fakeSource('right');
    w.added.notifyObservers(right);
    right.pad.buttons[4] = button(1, true);
    w.frame();
    expect(w.input.isDown('right', 'primary')).toBe(true);
    w.experience.baseExperience.state = WebXRState.NOT_IN_XR;
    w.stateObs.notifyObservers(WebXRState.NOT_IN_XR);
    expect(w.input.isDown('right', 'primary')).toBe(false);
    expect(w.releases).toEqual([expect.objectContaining({ hand: 'right', button: 'primary' })]);
    // Fuera del visor no se sondea: el botón todavía apretado no vuelve a "clicar".
    w.frame();
    expect(w.presses).toHaveLength(1);
  });

  it('al quitarse un mando se suelta lo suyo y la mano queda vacía', () => {
    const w = fakeWorld();
    const left = fakeSource('left');
    w.added.notifyObservers(left);
    left.pad.buttons[0] = button(1, true);
    w.frame();
    w.removed.notifyObservers(left);
    expect(w.input.has('left')).toBe(false);
    expect(w.releases).toEqual([expect.objectContaining({ hand: 'left', button: 'trigger' })]);
    expect(w.input.stick('left')).toEqual({ x: 0, y: 0 });
  });

  it('el stick devuelve los ejes crudos del mando', () => {
    const w = fakeWorld();
    const right = fakeSource('right');
    w.added.notifyObservers(right);
    right.pad.axes = [0, 0, -0.2, -0.95];
    expect(w.input.stick('right')).toEqual({ x: -0.2, y: -0.95 });
  });

  it('vibrar sin actuador no lanza', () => {
    const w = fakeWorld();
    w.added.notifyObservers(fakeSource('right'));
    expect(() => w.input.haptic('right', 'error')).not.toThrow();
    expect(() => w.input.haptic('left', 'press')).not.toThrow();
  });

  it('vibra por hapticActuators cuando el mando lo tiene', () => {
    const w = fakeWorld();
    const right = fakeSource('right');
    const calls: Array<[number, number]> = [];
    (right.pad as unknown as { hapticActuators: unknown[] }).hapticActuators = [
      { pulse: (v: number, ms: number) => (calls.push([v, ms]), Promise.resolve(true)) },
    ];
    w.added.notifyObservers(right);
    w.input.haptic('right', 'confirm');
    expect(calls).toEqual([[HAPTICS.confirm[0].value, HAPTICS.confirm[0].ms]]);
  });
});
