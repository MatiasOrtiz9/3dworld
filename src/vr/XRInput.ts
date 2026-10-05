import type { Scene } from '@babylonjs/core/scene';
import { Observable, type Observer } from '@babylonjs/core/Misc/observable';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Ray } from '@babylonjs/core/Culling/ray';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';

export type XRHand = 'left' | 'right';
/** `primary` = A/X, `secondary` = B/Y, `stick` = clic del stick. */
export type XRButton = 'trigger' | 'grip' | 'primary' | 'secondary' | 'stick';
export type HapticPattern = 'tick' | 'hover' | 'press' | 'confirm' | 'error' | 'grab' | 'release';
export interface XRButtonEvent {
  hand: XRHand;
  button: XRButton;
}
export interface XRReleaseEvent extends XRButtonEvent {
  heldMs: number;
}
/** Una mano ganó o perdió su fuente (mando conectado, mano detectada, sesión cerrada). */
export interface XRSourceChange {
  hand: XRHand;
  source: WebXRInputSource | null;
}

export const XR_HANDS: readonly XRHand[] = ['left', 'right'];
export const XR_BUTTONS: readonly XRButton[] = ['trigger', 'grip', 'primary', 'secondary', 'stick'];

/** Índices del mapeo `xr-standard` del gamepad (el 2, touchpad, no existe en el Quest). */
const PAD_INDEX: Record<XRButton, number> = { trigger: 0, grip: 1, stick: 3, primary: 4, secondary: 5 };

/**
 * Umbrales del gatillo y del grip. El `pressed` del navegador cambia cerca de
 * 0,1 en el Quest: apoyar el dedo sin intención ya "clicaba", y un gatillo a
 * medio camino temblaba entre apretado y suelto. Con histéresis hay que
 * apretar de verdad (0,6) y aflojar de verdad (0,3).
 */
export const PRESS_AT = 0.6;
export const RELEASE_AT = 0.3;

/** Estado analógico con histéresis: sigue apretado hasta bajar de `RELEASE_AT`. */
export function analogHeld(wasDown: boolean, value: number): boolean {
  return wasDown ? value > RELEASE_AT : value >= PRESS_AT;
}

/**
 * El par de ejes más activo de un gamepad. El perfil del Quest Browser pone el
 * stick en los ejes 2-3 y deja 0-1 (touchpad) en cero, pero otros navegadores
 * y el emulador lo ponen en 0-1: quedarse con el más desviado sirve para todos.
 */
export function strongestAxes(axes: ArrayLike<number>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let strongest = -1;
  for (let i = 0; i + 1 < axes.length; i += 2) {
    const m = Math.hypot(axes[i], axes[i + 1]);
    if (m > strongest) {
      strongest = m;
      x = axes[i];
      y = axes[i + 1];
    }
  }
  return { x, y };
}

/**
 * Vibraciones: fuerza (0-1) y duración (ms) de cada pulso. Cortas y suaves:
 * en el mando del Quest un pulso de más de ~40 ms ya se siente como un golpe,
 * y el tic de pasar por encima de un botón tiene que ser casi subliminal.
 */
export const HAPTICS: Record<HapticPattern, ReadonlyArray<{ value: number; ms: number; delay: number }>> = {
  tick: [{ value: 0.12, ms: 8, delay: 0 }],
  hover: [{ value: 0.16, ms: 12, delay: 0 }],
  press: [{ value: 0.3, ms: 18, delay: 0 }],
  confirm: [{ value: 0.45, ms: 35, delay: 0 }],
  // Dos golpes separados: "no" se reconoce sin mirar.
  error: [
    { value: 0.5, ms: 40, delay: 0 },
    { value: 0.5, ms: 40, delay: 120 },
  ],
  grab: [{ value: 0.35, ms: 25, delay: 0 }],
  release: [{ value: 0.2, ms: 15, delay: 0 }],
};

/** Constante de tiempo del suavizado de la velocidad de la mano (s). */
const VELOCITY_TAU = 0.08;
/**
 * Una mano no se mueve a más de esto: un salto mayor es el mundo que se movió
 * (giro por pasos, teletransporte, `placeAt`) y no debe convertirse en un
 * lanzamiento a 40 m/s.
 */
const MAX_HAND_SPEED = 14;

type Haptic = { pulse?: (value: number, duration: number) => Promise<boolean> };
type Vibration = { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> };
/** Lo que se usa del gamepad para vibrar: `hapticActuators` ya no figura en lib.dom y `vibrationActuator` puede faltar. */
type PadWithHaptics = { hapticActuators?: ReadonlyArray<Haptic>; vibrationActuator?: Vibration | null };

interface HandState {
  source: WebXRInputSource | null;
  down: Record<XRButton, boolean>;
  since: Record<XRButton, number>;
  /** Cuánto está apretado cada botón (0–1); los digitales valen 0 o 1. */
  value: Record<XRButton, number>;
  /** Gatillo y grip llegados por eventos de sesión (manos sin gamepad). */
  eventTrigger: boolean;
  eventGrip: boolean;
  velocity: Vector3;
  last: Vector3;
  hasLast: boolean;
  timers: number[];
}

function emptyButtons<T>(value: T): Record<XRButton, T> {
  return { trigger: value, grip: value, primary: value, secondary: value, stick: value };
}

/** `none` (un puntero sin lado) cuenta como derecha: es la mano por defecto del láser. */
export function handOf(source: { inputSource: { handedness: string } }): XRHand {
  return source.inputSource.handedness === 'left' ? 'left' : 'right';
}

/**
 * Botones de los dos mandos, leídos del gamepad crudo.
 *
 * Reemplaza al puntero de Babylon (POINTER_SELECTION) y a los componentes de
 * su perfil de mando. Probado con el visor puesto: el puntero no siempre
 * entregaba el clic, los perfiles del Quest Browser a veces no exponen el
 * stick, y sobre todo no permite "elegir al SOLTAR", que es lo que evita los
 * clics accidentales en los paneles. Acá cada botón tiene un flanco de bajada
 * (`onPress`) y uno de subida (`onRelease`, con cuánto se mantuvo), con el
 * mismo nombre en las dos manos: el juego decide qué hace cada uno.
 *
 * Las manos sin mando (seguimiento de manos) no tienen gamepad: el pellizco
 * llega como `selectstart/selectend` (gatillo) y el puño como
 * `squeezestart/squeezeend` (grip), por eventos de la sesión.
 *
 * Al salir del visor o al perderse un mando se suelta todo lo apretado
 * (emite `onRelease`): si no, un gatillo apretado al quitarse el casco
 * quedaba "colgado" y el próximo clic no llegaba.
 */
export class XRInput {
  readonly onPress = new Observable<XRButtonEvent>();
  readonly onRelease = new Observable<XRReleaseEvent>();
  /** Extra al contrato: el láser y los rótulos se cuelgan del nodo de la fuente nueva. */
  readonly onSourceChanged = new Observable<XRSourceChange>();
  private readonly hands: Record<XRHand, HandState> = { left: newHand(), right: newHand() };
  private readonly frameObserver: Observer<Scene>;
  private readonly addedObserver: Observer<WebXRInputSource>;
  private readonly removedObserver: Observer<WebXRInputSource>;
  private readonly stateObserver: Observer<WebXRState>;
  private readonly sessionObserver: Observer<XRSession>;
  private session: XRSession | null = null;
  private lastTime = 0;
  private readonly tmp = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly experience: WebXRDefaultExperience,
  ) {
    const input = experience.input;
    this.addedObserver = input.onControllerAddedObservable.add(this.bind);
    this.removedObserver = input.onControllerRemovedObservable.add(this.unbind);
    for (const source of input.controllers) this.bind(source);
    this.frameObserver = scene.onBeforeRenderObservable.add(this.poll);
    this.stateObserver = experience.baseExperience.onStateChangedObservable.add((state) => {
      if (state !== WebXRState.IN_XR) this.releaseAll();
    });
    const sm = experience.baseExperience.sessionManager;
    this.sessionObserver = sm.onXRSessionInit.add((session) => this.listen(session));
    if (sm.session) this.listen(sm.session);
  }

  isDown(hand: XRHand, button: XRButton): boolean {
    return this.hands[hand].down[button];
  }

  /**
   * Cuánto está apretado el botón (0–1), antes de la histéresis. Lo usan los
   * paneles para fijar el botón apuntado en cuanto el dedo EMPIEZA a apretar:
   * al tirar del gatillo el mando cabecea unos grados y el láser baja.
   */
  analog(hand: XRHand, button: XRButton): number {
    return this.hands[hand].value[button];
  }

  has(hand: XRHand): boolean {
    return this.hands[hand].source !== null;
  }

  source(hand: XRHand): WebXRInputSource | null {
    return this.hands[hand].source;
  }

  /** Rayo del puntero (target ray) de la mano, en el mundo. `false` si no hay mano. */
  rayOf(hand: XRHand, ref: Ray): boolean {
    const source = this.hands[hand].source;
    if (!source) return false;
    source.getWorldPointerRayToRef(ref);
    return true;
  }

  /** Posición en el mundo de la empuñadura (o del puntero, si el mando no informa empuñadura). */
  gripPosition(hand: XRHand): Vector3 | null {
    const source = this.hands[hand].source;
    if (!source) return null;
    return (source.grip ?? source.pointer).absolutePosition;
  }

  /** Velocidad de la mano en el mundo (m/s), suavizada ~80 ms: la del lanzamiento. */
  handVelocity(hand: XRHand): Vector3 {
    return this.hands[hand].velocity;
  }

  /** Ejes crudos del stick (el par más activo del gamepad); cero sin mando. */
  stick(hand: XRHand): { x: number; y: number } {
    const pad = this.hands[hand].source?.inputSource.gamepad;
    return pad ? strongestAxes(pad.axes) : { x: 0, y: 0 };
  }

  /** Vibra la mano con un patrón. Sin actuador (manos, emulador) no hace nada. */
  haptic(hand: XRHand, pattern: HapticPattern): void {
    const state = this.hands[hand];
    const pad = state.source?.inputSource.gamepad as unknown as PadWithHaptics | undefined;
    if (!pad) return;
    // Un patrón nuevo corta los pulsos pendientes del anterior (el error en dos tiempos).
    for (const t of state.timers) clearTimeout(t);
    state.timers.length = 0;
    for (const step of HAPTICS[pattern]) {
      if (step.delay === 0) pulse(pad, step.value, step.ms);
      else state.timers.push(setTimeout(() => pulse(pad, step.value, step.ms), step.delay));
    }
  }

  dispose(): void {
    this.releaseAll();
    this.scene.onBeforeRenderObservable.remove(this.frameObserver);
    this.experience.input.onControllerAddedObservable.remove(this.addedObserver);
    this.experience.input.onControllerRemovedObservable.remove(this.removedObserver);
    this.experience.baseExperience.onStateChangedObservable.remove(this.stateObserver);
    this.experience.baseExperience.sessionManager.onXRSessionInit.remove(this.sessionObserver);
    this.unlisten();
    for (const hand of XR_HANDS) {
      for (const t of this.hands[hand].timers) clearTimeout(t);
      this.hands[hand].source = null;
    }
    this.onPress.clear();
    this.onRelease.clear();
    this.onSourceChanged.clear();
  }

  // ------------------------------------------------------------------ interno

  private bind = (source: WebXRInputSource): void => {
    const hand = handOf(source);
    const state = this.hands[hand];
    if (state.source && state.source !== source) this.releaseHand(hand);
    state.source = source;
    state.hasLast = false;
    state.velocity.setAll(0);
    this.onSourceChanged.notifyObservers({ hand, source });
  };

  private unbind = (source: WebXRInputSource): void => {
    for (const hand of XR_HANDS) {
      const state = this.hands[hand];
      if (state.source !== source) continue;
      this.releaseHand(hand);
      state.source = null;
      state.hasLast = false;
      state.velocity.setAll(0);
      this.onSourceChanged.notifyObservers({ hand, source: null });
    }
  };

  private poll = (): void => {
    if (this.experience.baseExperience.state !== WebXRState.IN_XR) {
      this.lastTime = 0;
      return;
    }
    const now = performance.now();
    const dt = this.lastTime > 0 ? Math.min((now - this.lastTime) / 1000, 0.1) : 0;
    this.lastTime = now;
    for (const hand of XR_HANDS) {
      const state = this.hands[hand];
      const source = state.source;
      if (!source) continue;
      // Pose del cuadro actual: Babylon la escribe en `position`, pero la
      // matriz de mundo es la del cuadro anterior hasta que alguien la pida.
      source.pointer.computeWorldMatrix(true);
      source.grip?.computeWorldMatrix(true);
      this.trackVelocity(state, (source.grip ?? source.pointer).absolutePosition, dt);

      const pad = source.inputSource.gamepad;
      for (const button of XR_BUTTONS) {
        let down: boolean;
        if (pad) {
          const b = pad.buttons[PAD_INDEX[button]];
          if (!b) down = false;
          else if (button === 'trigger' || button === 'grip') {
            // Algunos navegadores informan `pressed` sin valor analógico.
            const value = b.value > 0 ? b.value : b.pressed ? 1 : 0;
            state.value[button] = value;
            down = analogHeld(state.down[button], value);
          } else {
            down = b.pressed;
            state.value[button] = down ? 1 : 0;
          }
        } else {
          down = button === 'trigger' ? state.eventTrigger : button === 'grip' ? state.eventGrip : false;
          state.value[button] = down ? 1 : 0;
        }
        this.set(hand, button, down, now);
      }
    }
  };

  private trackVelocity(state: HandState, p: Vector3, dt: number): void {
    if (!state.hasLast || dt <= 0) {
      state.last.copyFrom(p);
      state.hasLast = true;
      return;
    }
    p.subtractToRef(state.last, this.tmp).scaleInPlace(1 / dt);
    state.last.copyFrom(p);
    if (this.tmp.length() > MAX_HAND_SPEED) return;
    const k = 1 - Math.exp(-dt / VELOCITY_TAU);
    state.velocity.addInPlace(this.tmp.subtractInPlace(state.velocity).scaleInPlace(k));
  }

  private set(hand: XRHand, button: XRButton, down: boolean, now: number): void {
    const state = this.hands[hand];
    if (state.down[button] === down) return;
    state.down[button] = down;
    if (down) {
      state.since[button] = now;
      this.onPress.notifyObservers({ hand, button });
    } else {
      this.onRelease.notifyObservers({ hand, button, heldMs: now - state.since[button] });
    }
  }

  private releaseHand(hand: XRHand): void {
    const state = this.hands[hand];
    state.eventTrigger = false;
    state.eventGrip = false;
    const now = performance.now();
    for (const button of XR_BUTTONS) {
      state.value[button] = 0;
      this.set(hand, button, false, now);
    }
  }

  private releaseAll(): void {
    for (const hand of XR_HANDS) this.releaseHand(hand);
  }

  // --- manos sin mando: el pellizco y el puño llegan como eventos de sesión ---

  private listen(session: XRSession): void {
    this.unlisten();
    this.session = session;
    session.addEventListener('selectstart', this.onSessionEvent);
    session.addEventListener('selectend', this.onSessionEvent);
    session.addEventListener('squeezestart', this.onSessionEvent);
    session.addEventListener('squeezeend', this.onSessionEvent);
    session.addEventListener('end', this.onSessionEnd);
  }

  private unlisten(): void {
    const session = this.session;
    if (!session) return;
    session.removeEventListener('selectstart', this.onSessionEvent);
    session.removeEventListener('selectend', this.onSessionEvent);
    session.removeEventListener('squeezestart', this.onSessionEvent);
    session.removeEventListener('squeezeend', this.onSessionEvent);
    session.removeEventListener('end', this.onSessionEnd);
    this.session = null;
  }

  private onSessionEnd = (): void => {
    this.unlisten();
    this.releaseAll();
  };

  private onSessionEvent = (event: XRInputSourceEvent): void => {
    const raw = event.inputSource;
    // Los mandos con gamepad se leen en `poll`: el evento llegaría duplicado.
    if (!raw || raw.gamepad) return;
    const hand: XRHand = raw.handedness === 'left' ? 'left' : 'right';
    const state = this.hands[hand];
    if (event.type === 'selectstart') state.eventTrigger = true;
    else if (event.type === 'selectend') state.eventTrigger = false;
    else if (event.type === 'squeezestart') state.eventGrip = true;
    else if (event.type === 'squeezeend') state.eventGrip = false;
  };
}

function newHand(): HandState {
  return {
    source: null,
    down: emptyButtons(false),
    since: emptyButtons(0),
    value: emptyButtons(0),
    eventTrigger: false,
    eventGrip: false,
    velocity: new Vector3(),
    last: new Vector3(),
    hasLast: false,
    timers: [],
  };
}

/** Un pulso por el actuador que haya; nunca lanza (el visor puede no tener ninguno). */
function pulse(pad: PadWithHaptics, value: number, ms: number): void {
  try {
    const actuator = pad.hapticActuators?.[0];
    if (actuator?.pulse) {
      actuator.pulse(value, ms).catch(() => undefined);
      return;
    }
    const vibration = pad.vibrationActuator;
    if (vibration?.playEffect) {
      vibration
        .playEffect('dual-rumble', { duration: ms, startDelay: 0, strongMagnitude: value, weakMagnitude: value })
        .catch(() => undefined);
    }
  } catch {
    // Sin vibración no se pierde nada: hay sonido y luz.
  }
}
