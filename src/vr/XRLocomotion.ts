import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import { WebXRControllerComponent } from '@babylonjs/core/XR/motionController/webXRControllerComponent';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DEFAULT_COMFORT, SEATED_LIFT, runSpeed, walkSpeed, type ComfortSettings } from './XRComfort';

/** Lo que la caminata necesita saber de la ciudad (y lo que un test puede simular). */
export interface WalkIndex {
  isSolid(x: number, z: number, feetY?: number): boolean;
  groundHeight(x: number, z: number, feetY?: number): number;
}

/**
 * Velocidades por defecto (ajuste "Normal"). Las que valen salen del ajuste de
 * confort (`walkSpeed`/`runSpeed` de XRComfort); éstas quedan para quien las
 * importaba antes de que la velocidad fuera un ajuste.
 */
export const WALK_SPEED = walkSpeed(DEFAULT_COMFORT);
export const RUN_SPEED = runSpeed(DEFAULT_COMFORT);
/** Radio del cuerpo para chocar: menor que en escritorio, la cabeza real se asoma. */
const BODY_RADIUS = 0.28;
const DEADZONE = 0.15;
/**
 * Curva del stick de caminar: la velocidad crece con la inclinación a la 1,5.
 * A media inclinación se va a un 35 % (no a la mitad): acercarse a un docente
 * o a un cartel sin pasarse es fácil, y a fondo se camina igual de rápido.
 */
const WALK_CURVE = 1.5;
/**
 * Respuesta del stick (1/s, aproximación exponencial): arranca al 90 % en
 * ~0,16 s y frena al 90 % en ~0,1 s. Frenar más rápido que arrancar es lo que
 * evita el derrape: al soltar, el mundo se detiene casi enseguida, que es lo
 * que espera el oído interno.
 */
const ACCELERATION = 14;
const BRAKING = 24;
/** Un desplazamiento mayor en un solo cuadro no es caminar: es un salto. */
const JUMP_DISTANCE = 1;
/** Altura de ojos si el visor todavía no la informa. */
const DEFAULT_HEAD = 1.6;
/** Distancia entre pisadas (sonido): corriendo el tranco es más largo. */
const STRIDE_WALK = 0.78;
const STRIDE_RUN = 1.05;

// --- stick derecho: zonas compartidas por el giro por pasos y el continuo ---
/** Debajo de esta inclinación el stick está "en el centro": se rearma el giro. */
const TURN_CENTER = 0.3;
/** Inclinación lateral que dispara un paso de giro. */
const TURN_FIRE = 0.7;
/** "A fondo": mantenido así, el paso se repite. */
const TURN_FULL = 0.9;
/** Cada cuánto se repite el paso con el stick a fondo (s). */
const TURN_REPEAT = 0.5;
/** Con más inclinación vertical que ésta no se gira: adelante/atrás es del teletransporte. */
const TURN_Y_LIMIT = 0.55;
/**
 * Con más que esto se activó el teletransporte de Babylon (su umbral es 0,7)
 * o el paso atrás (`BACK_FIRE`): el giro queda bloqueado hasta que el stick vuelva al
 * centro. Sin esto, al soltar el arco el stick pasaba por una diagonal y el
 * jugador aterrizaba girado.
 */
const TURN_LATCH_Y = 0.7;
/**
 * Paso atrás con el stick derecho hacia atrás: uno por inclinación (se rearma
 * debajo de `BACK_REARM`). Era el de Babylon, pero ése no miraba si la
 * locomoción estaba apagada (bajar el resaltado de un menú con el stick
 * derecho alejaba 0,8 m al jugador) ni las paredes (atravesaba tabiques).
 */
const BACK_FIRE = 0.7;
const BACK_REARM = 0.4;
const BACK_DISTANCE = 0.8;
/** El paso atrás se prueba contra las paredes en tramos de este largo (como un cuadro de caminata). */
const BACK_CHUNK = 0.05;
/** Zona muerta y curva del giro continuo: girar despacio para mirar algo es posible. */
const SMOOTH_DEADZONE = 0.2;
const SMOOTH_CURVE = 1.5;
/** Suavizado de la velocidad de giro continuo (1/s): sin tirón al empezar ni al parar. */
const SMOOTH_RESPONSE = 18;

// --- correr ---
/** Con el stick en el centro más de esto, correr se apaga solo (s). */
const SPRINT_IDLE_OFF = 0.5;
/** Si se activó con el stick quieto, hay un poco más de margen para empezar a empujar. */
const SPRINT_GRACE = 0.6;
/** Velocidad (1/s) con la que se sube o baja la altura extra de "sentado" al cambiar el ajuste. */
const LIFT_RATE = 4;

/**
 * Zona muerta del stick y reescalado: fuera de la zona muerta la respuesta
 * arranca en 0, así no hay un escalón de velocidad al salir de ella. Con
 * `exponent` > 1 la magnitud se curva (control fino con poca inclinación);
 * con 1 (por defecto) es lineal, como siempre.
 */
export function shapeStick(x: number, y: number, deadzone = DEADZONE, exponent = 1): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return { x: 0, y: 0 };
  const lin = (Math.min(1, mag) - deadzone) / (1 - deadzone);
  const t = exponent === 1 ? lin : Math.pow(lin, exponent);
  return { x: (x / mag) * t, y: (y / mag) * t };
}

/**
 * Desplaza (x, z) con colisión por ejes separados: si un eje choca, el otro
 * sigue y el jugador se desliza a lo largo de la pared. El mismo criterio que
 * `PlayerController` en escritorio, para que las paredes sean las mismas.
 */
export function slideMove(
  index: WalkIndex,
  x: number,
  z: number,
  dx: number,
  dz: number,
  feet: number,
  radius = BODY_RADIUS,
): { x: number; z: number; hitX: boolean; hitZ: boolean } {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (radius * 0.5)));
  const sx = dx / steps;
  const sz = dz / steps;
  let hitX = false;
  let hitZ = false;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && !hitX) {
      if (index.isSolid(x + sx + Math.sign(sx) * radius, z, feet)) hitX = true;
      else x += sx;
    }
    if (sz !== 0 && !hitZ) {
      if (index.isSolid(x, z + sz + Math.sign(sz) * radius, feet)) hitZ = true;
      else z += sz;
    }
  }
  return { x, z, hitX, hitZ };
}

/**
 * Acerca la altura de los pies al piso. Un escalón se sube en ~0,1 s en vez de
 * dar un salto de 17 cm por cuadro; una diferencia grande (caer por el hueco de
 * la escalera, el canal) no se suaviza.
 */
export function followFloor(feet: number, floor: number, dt: number): number {
  if (Math.abs(floor - feet) > 1.2) return floor;
  const next = feet + (floor - feet) * Math.min(1, dt * 14);
  return Math.abs(floor - next) < 0.002 ? floor : next;
}

/**
 * Stick ya moldeado (x a la derecha, y hacia ATRÁS, como lo da el gamepad) a
 * velocidad en el mundo, según el rumbo horizontal (fx, fz) normalizado.
 * Babylon es de mano izquierda: con el rumbo (fx, fz), la derecha es (fz, −fx).
 */
export function headingMove(sx: number, sy: number, fx: number, fz: number, speed: number): { x: number; z: number } {
  const forward = -sy;
  return { x: (fx * forward + fz * sx) * speed, z: (fz * forward - fx * sx) * speed };
}

/**
 * Acerca la velocidad (v) a la pedida (t) en el lugar. Arranca con
 * `ACCELERATION`; si lo pedido es más lento que lo actual o va hacia otro lado
 * (soltar, aflojar, dar media vuelta), frena con `BRAKING`: invertir el stick
 * no "patina" sobre la velocidad vieja. Muy cerca del reposo se clava en 0.
 */
export function approachVelocity(v: { x: number; z: number }, tx: number, tz: number, dt: number): void {
  const pushing = tx !== 0 || tz !== 0;
  const cur2 = v.x * v.x + v.z * v.z;
  const speeding = pushing && tx * tx + tz * tz >= cur2 && tx * v.x + tz * v.z >= 0;
  const blend = 1 - Math.exp(-(speeding ? ACCELERATION : BRAKING) * dt);
  v.x += (tx - v.x) * blend;
  v.z += (tz - v.z) * blend;
  if (!pushing && Math.hypot(v.x, v.z) < 0.02) {
    v.x = 0;
    v.z = 0;
  }
}

/** Estado de "correr": prendido y cuánto hace que el stick está en el centro. */
export interface SprintState {
  on: boolean;
  idle: number;
}

/**
 * Correr con el clic del stick izquierdo: cada clic ALTERNA. Mantener el
 * stick apretado mientras se camina cansa el pulgar y un clic suelto se
 * pierde; alternar es lo de casi todos los juegos de Quest. Se apaga solo
 * cuando el stick queda en el centro ~0,5 s (parar es dejar de correr), con
 * algo más de margen si se prendió con el stick quieto. Muta `s`; devuelve si
 * se corre.
 */
export function sprintStep(s: SprintState, clicked: boolean, moving: boolean, dt: number): boolean {
  if (clicked) {
    s.on = !s.on;
    s.idle = moving ? 0 : -SPRINT_GRACE;
    return s.on;
  }
  if (!s.on) return false;
  if (moving) s.idle = Math.min(s.idle, 0);
  else {
    s.idle += dt;
    if (s.idle >= SPRINT_IDLE_OFF) {
      s.on = false;
      s.idle = 0;
    }
  }
  return s.on;
}

/** Estado del stick de giro: armado (volvió al centro), bloqueado por el teletransporte, tiempo a fondo. */
export interface TurnState {
  armed: boolean;
  latched: boolean;
  held: number;
}

export function newTurnState(): TurnState {
  return { armed: true, latched: false, held: 0 };
}

/**
 * Zonas del stick derecho, comunes a los dos giros. En el centro se rearma y
 * se desbloquea; hacia adelante o atrás a fondo (teletransporte, paso atrás)
 * se bloquea hasta volver al centro; con inclinación vertical marcada no se
 * gira. Devuelve si en este cuadro se puede girar.
 */
function turnGate(s: TurnState, x: number, y: number): boolean {
  if (Math.hypot(x, y) < TURN_CENTER) {
    s.armed = true;
    s.latched = false;
    s.held = 0;
    return false;
  }
  if (Math.abs(y) > TURN_LATCH_Y) s.latched = true;
  if (s.latched || Math.abs(y) > TURN_Y_LIMIT) {
    s.held = 0;
    return false;
  }
  return true;
}

/**
 * Giro por pasos: un paso al cruzar `TURN_FIRE` hacia un costado, y no otro
 * hasta volver al centro. Mantenido A FONDO, se repite cada medio segundo
 * (dar media vuelta sin bombear el stick); el paso es instantáneo, así que la
 * repetición no agrega movimiento visto. Muta `s`; devuelve −1, 0 o 1.
 */
export function snapTurnStep(s: TurnState, x: number, y: number, dt: number): -1 | 0 | 1 {
  if (!turnGate(s, x, y) || Math.abs(x) < TURN_FIRE) {
    s.held = 0;
    return 0;
  }
  const dir = x > 0 ? 1 : -1;
  if (s.armed) {
    s.armed = false;
    s.held = 0;
    return dir;
  }
  if (Math.abs(x) < TURN_FULL) {
    s.held = 0;
    return 0;
  }
  s.held += dt;
  if (s.held < TURN_REPEAT) return 0;
  s.held -= TURN_REPEAT;
  return dir;
}

/**
 * Giro continuo: grados por segundo con signo (positivo = a la derecha), con
 * zona muerta y curva. Sólo con el stick de costado (las mismas zonas que el
 * giro por pasos). Muta `s` (bloqueo del teletransporte).
 */
export function smoothTurnRate(s: TurnState, x: number, y: number, maxDegPerSec: number): number {
  if (!turnGate(s, x, y)) return 0;
  const ax = Math.abs(x);
  if (ax <= SMOOTH_DEADZONE) return 0;
  const t = Math.pow((Math.min(1, ax) - SMOOTH_DEADZONE) / (1 - SMOOTH_DEADZONE), SMOOTH_CURVE);
  return Math.sign(x) * t * maxDegPerSec;
}

/**
 * Gira `q` (la cámara XR) `angle` radianes alrededor del eje Y del MUNDO, en
 * el lugar: r·q, como el teletransporte de Babylon. Con q·r el giro era sobre
 * el eje Y de la CABEZA: girando mientras se miraba al piso, la diferencia de
 * pose que Babylon pasa al espacio de referencia llevaba cabeceo y el piso
 * quedaba inclinado (~28° con la cabeza 40° abajo y un paso de 45°), algo que
 * marea mucho y no se corregía solo. Muta y devuelve `q`.
 */
export function yawWorld(q: Quaternion, angle: number): Quaternion {
  Quaternion.FromEulerAngles(0, angle, 0).multiplyToRef(q, q);
  return q;
}

/** El par de ejes más activo de un gamepad (el stick, sea cual sea su índice). */
function strongestAxes(pad: Gamepad): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let strongest = 0;
  for (let i = 0; i + 1 < pad.axes.length; i += 2) {
    const m = Math.hypot(pad.axes[i], pad.axes[i + 1]);
    if (m > strongest) {
      strongest = m;
      x = pad.axes[i];
      y = pad.axes[i + 1];
    }
  }
  return { x, y };
}

/**
 * Caminata en VR: stick izquierdo, giro con el derecho, colisión y pisos.
 *
 * Reemplaza a la característica MOVEMENT de Babylon, por tres razones medidas
 * en un Quest emulado:
 *
 *  - **No convive con el teletransporte.** Babylon rechaza habilitar las dos;
 *    `setupXR` lanzaba y la sesión quedaba sin nada configurado.
 *  - **Sigue la mirada completa, no el rumbo.** Mirando al piso, el stick
 *    empujaba la cámara hacia abajo y frenaba el avance.
 *  - **Tiene inercia de cámara.** Al soltar el stick el jugador seguía
 *    deslizándose, que es de lo que más marea en VR.
 *
 * Acá el avance es horizontal, en la dirección hacia la que mira la cabeza (o
 * hacia la que apunta el mando izquierdo, según el ajuste de confort), con
 * arranque y frenado cortos y una curva que da control fino a poca
 * inclinación. La colisión y el piso se consultan en el mismo índice que usa
 * el escritorio. Velocidades, giro (por pasos o continuo) y "sentado" se leen
 * del ajuste de confort en cada cuadro: cambiarlo en el menú vale al instante.
 *
 * Corre en `onBeforeRender`, después de que la cámara XR leyó la pose del
 * cuadro: la posición y la altura real de la cabeza son las del MISMO cuadro.
 * Lo que se escribe en `camera.position` Babylon lo aplica al espacio de
 * referencia en el cuadro siguiente. Corregir antes de leer la pose duplicaba
 * el movimiento real de la cabeza (al agacharse, el mundo daba un respingo).
 */
export class XRLocomotion {
  /** 0 = quieto · 1 = caminando o más rápido. Lo usa la viñeta de confort. */
  motion = 0;
  /** 0 = sin giro continuo · 1 = girando a la velocidad elegida. También para la viñeta. */
  turning = 0;
  private enabled = true;
  private stick: WebXRControllerComponent | null = null;
  /** Control izquierdo: sus ejes crudos sirven si el perfil no trae stick. */
  private left: WebXRInputSource | null = null;
  /** Control derecho: el giro se lee de su gamepad crudo. */
  private right: WebXRInputSource | null = null;
  private rightOwner = '';
  private readonly turn = newTurnState();
  /** Giro continuo vigente (°/s), suavizado. */
  private turnRate = 0;
  /** El stick derecho volvió de "atrás": el próximo empujón da un paso atrás. */
  private backArmed = true;
  private stickOwner = '';
  private readonly sprint: SprintState = { on: false, idle: 0 };
  /** El clic del stick estaba apretado en el cuadro anterior (para el flanco). */
  private clickWas = false;
  private readonly vel = { x: 0, z: 0 };
  /** Altura de los pies que se viene siguiendo: decide en qué piso se está. */
  private feet = 0;
  private head = DEFAULT_HEAD;
  /** Altura extra de "sentado" aplicada (se acerca a la pedida, sin saltos). */
  private lift = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private jumpPending = false;
  private stride = 0;
  private readonly euler = new Vector3();
  private readonly aim = new Vector3();
  private readonly localForward: Vector3;
  private readonly frameObserver: Observer<Scene>;
  private readonly addedObserver: Observer<WebXRInputSource>;
  private readonly removedObserver: Observer<WebXRInputSource>;

  constructor(
    private readonly scene: Scene,
    private readonly xr: WebXRDefaultExperience,
    private readonly index: () => WalkIndex | null,
    private readonly onStep?: (running: boolean) => void,
    private readonly comfort: () => ComfortSettings = () => DEFAULT_COMFORT,
  ) {
    this.localForward = Vector3.Forward(scene.useRightHandedSystem);
    this.addedObserver = xr.input.onControllerAddedObservable.add(this.bind);
    this.removedObserver = xr.input.onControllerRemovedObservable.add((source) => {
      if (source.uniqueId === this.rightOwner) {
        this.right = null;
        this.rightOwner = '';
        this.resetTurn();
      }
      if (source.uniqueId !== this.stickOwner) return;
      this.stick = null;
      this.left = null;
      this.stickOwner = '';
      this.clickWas = false;
      this.sprint.on = false;
    });
    for (const source of xr.input.controllers) this.bind(source);
    this.frameObserver = scene.onBeforeRenderObservable.add(this.update);
  }

  /** Corriendo (clic del stick izquierdo; se apaga solo al soltar el stick). */
  get running(): boolean {
    return this.sprint.on;
  }

  /** Pausa el stick (caminar y girar). El piso se sigue igual. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.vel.x = 0;
      this.vel.z = 0;
      this.sprint.on = false;
      this.resetTurn();
    }
  }

  /** El teletransporte avisa: el próximo cuadro se toma la altura del destino. */
  markTeleported(): void {
    this.jumpPending = true;
  }

  /**
   * Para al usuario sobre el piso en (eye.x, eye.z), mirando hacia `look`.
   * Sólo dentro de un cuadro XR: la altura real de la cabeza se lee del visor.
   */
  placeAt(eye: Vector3, look: Vector3, feetY?: number): void {
    const cam = this.xr.baseExperience.camera;
    const idx = this.index();
    this.lift = this.comfort().seated ? SEATED_LIFT : 0;
    this.head = this.readHead();
    this.feet = idx ? idx.groundHeight(eye.x, eye.z, feetY) : 0;
    cam.position.set(eye.x, this.feet + this.head, eye.z);
    cam.setTarget(look);
    this.lastX = eye.x;
    this.lastZ = eye.z;
    this.vel.x = 0;
    this.vel.z = 0;
    this.sprint.on = false;
    this.jumpPending = false;
  }

  /** Altura de los pies y de la cabeza del último cuadro, si se puede caminar y si se corre (para herramientas). */
  get debug(): { feet: number; head: number; canWalk: boolean; running: boolean } {
    return { feet: this.feet, head: this.head, canWalk: this.enabled, running: this.sprint.on };
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.frameObserver);
    this.xr.input.onControllerAddedObservable.remove(this.addedObserver);
    this.xr.input.onControllerRemovedObservable.remove(this.removedObserver);
    this.stick = null;
    this.left = null;
    this.right = null;
  }

  // ------------------------------------------------------------------ interno

  private bind = (source: WebXRInputSource): void => {
    const hand = source.inputSource.handedness;
    // Un control sin mano declarada ('none') cuenta como derecho, como en
    // XRInput, salvo que ya haya un derecho de verdad.
    if (hand === 'right' || (hand === 'none' && !this.right)) {
      this.right = source;
      this.rightOwner = source.uniqueId;
      this.resetTurn();
      return;
    }
    if (hand !== 'left') return;
    this.left = source;
    this.stickOwner = source.uniqueId;
    this.clickWas = false;
    const attach = (): void => {
      const stick = source.motionController?.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE);
      // Sin componente de stick (mano sin control, o un perfil del navegador
      // que no lo expone) se leen los ejes crudos del gamepad (`readStick`).
      if (stick) this.stick = stick;
    };
    if (source.motionController) attach();
    else source.onMotionControllerInitObservable.addOnce(attach);
  };

  private resetTurn(): void {
    this.turn.armed = true;
    this.turn.latched = false;
    this.turn.held = 0;
    this.turnRate = 0;
    this.turning = 0;
  }

  /**
   * Stick izquierdo: el componente de Babylon o, si el perfil del navegador no
   * lo expone (pasó en el Quest Browser: sin esto no se caminaba), el par de
   * ejes más activo del gamepad XR, con el botón del stick (el 3 del mapeo
   * xr-standard) para correr.
   */
  private readStick(): { x: number; y: number; pressed: boolean } | null {
    const pad = this.left?.inputSource.gamepad;
    if (!this.stick && !pad) return null;
    let x = this.stick?.axes.x ?? 0;
    let y = this.stick?.axes.y ?? 0;
    let pressed = this.stick?.pressed ?? false;
    if (pad) {
      if (Math.hypot(x, y) < 0.16) ({ x, y } = strongestAxes(pad));
      pressed ||= Boolean(pad.buttons[3]?.pressed);
    }
    return { x, y, pressed };
  }

  /**
   * Giro con el stick derecho, leído del gamepad crudo como la caminata: si el
   * perfil del navegador no expone el stick, el giro de Babylon no funcionaba
   * (su ángulo queda en 0 en XRSetup). Con el stick hacia adelante o atrás no
   * gira: ahí se apunta el teletransporte. Por pasos (instantáneo, lo que
   * menos marea) o continuo, según el ajuste.
   */
  private applyTurn(cam: WebXRDefaultExperience['baseExperience']['camera'], settings: ComfortSettings, dt: number): void {
    const pad = this.right?.inputSource.gamepad;
    const { x, y } = pad ? strongestAxes(pad) : { x: 0, y: 0 };
    const handed = this.scene.useRightHandedSystem ? -1 : 1;
    let angle = 0;
    if (settings.turnMode === 'smooth') {
      const want = smoothTurnRate(this.turn, x, y, settings.smoothTurnSpeed);
      this.turnRate += (want - this.turnRate) * (1 - Math.exp(-SMOOTH_RESPONSE * dt));
      if (want === 0 && Math.abs(this.turnRate) < 1) this.turnRate = 0;
      this.turning = Math.min(1, Math.abs(this.turnRate) / 90);
      angle = ((this.turnRate * Math.PI) / 180) * dt;
    } else {
      this.turnRate = 0;
      this.turning = 0;
      const dir = snapTurnStep(this.turn, x, y, dt);
      if (dir !== 0) angle = ((settings.snapAngle * Math.PI) / 180) * dir;
    }
    if (angle !== 0) yawWorld(cam.rotationQuaternion, angle * handed);
  }

  /**
   * Paso atrás (stick derecho hacia atrás): 0,8 m opuestos al rumbo de la
   * cabeza, de una vez, pero probando las paredes en tramos cortos con la
   * misma colisión de la caminata: contra un tabique se queda pegado a él.
   * Con la locomoción apagada (menú, escena guionada, fundido) no hace nada y
   * no queda armado: si el stick seguía atrás al reanudar, no salta solo.
   */
  private backStep(idx: WalkIndex, cam: WebXRDefaultExperience['baseExperience']['camera'], p: Vector3): void {
    const pad = this.right?.inputSource.gamepad;
    const y = pad ? strongestAxes(pad).y : 0;
    if (y < BACK_REARM) {
      this.backArmed = true;
      return;
    }
    if (!this.enabled) {
      this.backArmed = false;
      return;
    }
    if (!this.backArmed || y < BACK_FIRE) return;
    this.backArmed = false;
    cam.rotationQuaternion.toEulerAnglesToRef(this.euler);
    const bx = -Math.sin(this.euler.y) * BACK_DISTANCE;
    const bz = -Math.cos(this.euler.y) * BACK_DISTANCE;
    const n = Math.ceil(BACK_DISTANCE / BACK_CHUNK);
    let x = p.x;
    let z = p.z;
    for (let i = 0; i < n; i++) {
      const moved = slideMove(idx, x, z, bx / n, bz / n, this.feet);
      x = moved.x;
      z = moved.z;
      if (moved.hitX && moved.hitZ) break;
    }
    if (x === p.x && z === p.z) return;
    p.x = x;
    p.z = z;
    this.vel.x = 0;
    this.vel.z = 0;
    // Una pisada: el salto corto se oye, como al caminar.
    this.onStep?.(false);
  }

  /**
   * Rumbo horizontal (normalizado) hacia el que empuja el stick: el de la
   * cabeza o, con "Donde apunto", el del puntero del mando izquierdo. Si el
   * mando apunta casi vertical (o no hay mando), manda la cabeza.
   */
  private heading(cam: WebXRDefaultExperience['baseExperience']['camera'], settings: ComfortSettings): { x: number; z: number } {
    const pointer = settings.direction === 'hand' ? this.left?.pointer : null;
    if (pointer) {
      pointer.getDirectionToRef(this.localForward, this.aim);
      const h = Math.hypot(this.aim.x, this.aim.z);
      if (h > 0.25) return { x: this.aim.x / h, z: this.aim.z / h };
    }
    cam.rotationQuaternion.toEulerAnglesToRef(this.euler);
    return { x: Math.sin(this.euler.y), z: Math.cos(this.euler.y) };
  }

  private readHead(): number {
    const h = this.xr.baseExperience.camera.realWorldHeight;
    return (h > 0.3 ? h : DEFAULT_HEAD) + this.lift;
  }

  private update = (): void => {
    const idx = this.index();
    if (!idx || this.xr.baseExperience.state !== WebXRState.IN_XR) {
      this.lastX = Number.NaN;
      this.vel.x = 0;
      this.vel.z = 0;
      this.motion = 0;
      this.turning = 0;
      this.sprint.on = false;
      return;
    }
    const settings = this.comfort();
    const cam = this.xr.baseExperience.camera;
    const p = cam.position;
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    // "Sentado" sube los ojos; al cambiar el ajuste se acerca en ~0,5 s.
    const liftTarget = settings.seated ? SEATED_LIFT : 0;
    if (this.lift !== liftTarget) {
      this.lift += (liftTarget - this.lift) * Math.min(1, dt * LIFT_RATE);
      if (Math.abs(liftTarget - this.lift) < 0.003) this.lift = liftTarget;
    }
    this.head = this.readHead();

    // Primer cuadro o teletransporte: los pies quedan donde dejó el salto.
    const jumped =
      this.jumpPending ||
      Number.isNaN(this.lastX) ||
      Math.hypot(p.x - this.lastX, p.z - this.lastZ) > JUMP_DISTANCE;
    if (jumped) {
      this.jumpPending = false;
      this.feet = idx.groundHeight(p.x, p.z, p.y - this.head);
      this.vel.x = 0;
      this.vel.z = 0;
    } else if (idx.isSolid(p.x, p.z, this.feet) && !idx.isSolid(this.lastX, this.lastZ, this.feet)) {
      // La cabeza entró en un muro caminando de verdad por la habitación:
      // vuelve a donde estaba, como el "empujón" de cualquier juego de VR.
      p.x = this.lastX;
      p.z = this.lastZ;
    }

    // --- giro y stick: avance horizontal según el rumbo elegido ---
    let tx = 0;
    let tz = 0;
    if (this.enabled) this.applyTurn(cam, settings, dt);
    else this.turning = 0;
    this.backStep(idx, cam, p);
    const st = this.enabled ? this.readStick() : null;
    const clicked = Boolean(st?.pressed) && !this.clickWas;
    this.clickWas = Boolean(st?.pressed);
    const s = st ? shapeStick(st.x, st.y, DEADZONE, WALK_CURVE) : { x: 0, y: 0 };
    const moving = s.x !== 0 || s.y !== 0;
    const running = this.enabled && sprintStep(this.sprint, clicked, moving, dt);
    if (moving) {
      const speed = running ? runSpeed(settings) : walkSpeed(settings);
      const f = this.heading(cam, settings);
      const v = headingMove(s.x, s.y, f.x, f.z, speed);
      tx = v.x;
      tz = v.z;
    }
    approachVelocity(this.vel, tx, tz, dt);
    if (this.vel.x !== 0 || this.vel.z !== 0) {
      const moved = slideMove(idx, p.x, p.z, this.vel.x * dt, this.vel.z * dt, this.feet);
      if (moved.hitX) this.vel.x = 0;
      if (moved.hitZ) this.vel.z = 0;
      this.stride += Math.hypot(moved.x - p.x, moved.z - p.z);
      if (this.stride >= (running ? STRIDE_RUN : STRIDE_WALK)) {
        this.stride = 0;
        this.onStep?.(running);
      }
      p.x = moved.x;
      p.z = moved.z;
    }
    // La viñeta se mide contra la velocidad "Normal" fija: caminar rápido o
    // correr la cierra del todo; caminar lento, un poco menos.
    this.motion = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / WALK_SPEED);

    // --- piso: escalón, descanso, primer o segundo piso ---
    const floor = idx.groundHeight(p.x, p.z, this.feet);
    this.feet = jumped ? floor : followFloor(this.feet, floor, dt);
    const y = this.feet + this.head;
    if (Math.abs(p.y - y) > 0.001) p.y = y;
    this.lastX = p.x;
    this.lastZ = p.z;
  };
}
