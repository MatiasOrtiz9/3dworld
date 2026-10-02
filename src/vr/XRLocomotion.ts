import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import { WebXRControllerComponent } from '@babylonjs/core/XR/motionController/webXRControllerComponent';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Lo que la caminata necesita saber de la ciudad (y lo que un test puede simular). */
export interface WalkIndex {
  isSolid(x: number, z: number, feetY?: number): boolean;
  groundHeight(x: number, z: number, feetY?: number): number;
}

/**
 * Velocidades de caminata en VR: bastante MENOS que en escritorio (4,2 m/s).
 * El mareo en VR crece con la velocidad del movimiento artificial; 2 m/s es un
 * paso decidido y todavía se tolera bien. Apretar el stick corre.
 */
export const WALK_SPEED = 2.0;
export const RUN_SPEED = 3.6;
/** Radio del cuerpo para chocar: menor que en escritorio, la cabeza real se asoma. */
const BODY_RADIUS = 0.28;
const DEADZONE = 0.15;
/** Respuesta del stick (1/s): arranca y frena en ~0,1 s, sin derrapar. */
const ACCELERATION = 10;
const BRAKING = 18;
/** Un desplazamiento mayor en un solo cuadro no es caminar: es un salto. */
const JUMP_DISTANCE = 1;
/** Altura de ojos si el visor todavía no la informa. */
const DEFAULT_HEAD = 1.6;

/**
 * Zona muerta del stick y reescalado: fuera de la zona muerta la respuesta
 * arranca en 0, así no hay un escalón de velocidad al salir de ella.
 */
export function shapeStick(x: number, y: number, deadzone = DEADZONE): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return { x: 0, y: 0 };
  const t = (Math.min(1, mag) - deadzone) / (1 - deadzone);
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
 * Caminata en VR: stick izquierdo, colisión y pisos.
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
 * Acá el avance es horizontal, en la dirección hacia la que mira la cabeza, con
 * arranque y frenado cortos. La colisión y el piso se consultan en el mismo
 * índice que usa el escritorio.
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
  private enabled = true;
  private stick: WebXRControllerComponent | null = null;
  private stickOwner = '';
  private vx = 0;
  private vz = 0;
  /** Altura de los pies que se viene siguiendo: decide en qué piso se está. */
  private feet = 0;
  private head = DEFAULT_HEAD;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private jumpPending = false;
  private stride = 0;
  private readonly euler = new Vector3();
  private readonly frameObserver: Observer<Scene>;
  private readonly addedObserver: Observer<WebXRInputSource>;
  private readonly removedObserver: Observer<WebXRInputSource>;

  constructor(
    private readonly scene: Scene,
    private readonly xr: WebXRDefaultExperience,
    private readonly index: () => WalkIndex | null,
    private readonly onStep?: (running: boolean) => void,
  ) {
    this.addedObserver = xr.input.onControllerAddedObservable.add(this.bind);
    this.removedObserver = xr.input.onControllerRemovedObservable.add((source) => {
      if (source.uniqueId !== this.stickOwner) return;
      this.stick = null;
      this.stickOwner = '';
    });
    for (const source of xr.input.controllers) this.bind(source);
    this.frameObserver = scene.onBeforeRenderObservable.add(this.update);
  }

  /** Pausa el stick (paneles abiertos). El piso se sigue igual. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.vx = 0;
      this.vz = 0;
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
    this.head = this.readHead();
    this.feet = idx ? idx.groundHeight(eye.x, eye.z, feetY) : 0;
    cam.position.set(eye.x, this.feet + this.head, eye.z);
    cam.setTarget(look);
    this.lastX = eye.x;
    this.lastZ = eye.z;
    this.vx = 0;
    this.vz = 0;
    this.jumpPending = false;
  }

  /** Altura de los pies y de la cabeza del último cuadro (para herramientas). */
  get debug(): { feet: number; head: number } {
    return { feet: this.feet, head: this.head };
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.frameObserver);
    this.xr.input.onControllerAddedObservable.remove(this.addedObserver);
    this.xr.input.onControllerRemovedObservable.remove(this.removedObserver);
    this.stick = null;
  }

  // ------------------------------------------------------------------ interno

  private bind = (source: WebXRInputSource): void => {
    if (source.inputSource.handedness !== 'left') return;
    const attach = (): void => {
      const stick = source.motionController?.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE);
      if (!stick) return; // mano sin control: no hay stick
      this.stick = stick;
      this.stickOwner = source.uniqueId;
    };
    if (source.motionController) attach();
    else source.onMotionControllerInitObservable.addOnce(attach);
  };

  private readHead(): number {
    const h = this.xr.baseExperience.camera.realWorldHeight;
    return h > 0.3 ? h : DEFAULT_HEAD;
  }

  private update = (): void => {
    const idx = this.index();
    if (!idx || this.xr.baseExperience.state !== WebXRState.IN_XR) {
      this.lastX = Number.NaN;
      this.vx = 0;
      this.vz = 0;
      this.motion = 0;
      return;
    }
    const cam = this.xr.baseExperience.camera;
    const p = cam.position;
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    this.head = this.readHead();

    // Primer cuadro o teletransporte: los pies quedan donde dejó el salto.
    const jumped =
      this.jumpPending ||
      Number.isNaN(this.lastX) ||
      Math.hypot(p.x - this.lastX, p.z - this.lastZ) > JUMP_DISTANCE;
    if (jumped) {
      this.jumpPending = false;
      this.feet = idx.groundHeight(p.x, p.z, p.y - this.head);
      this.vx = 0;
      this.vz = 0;
    } else if (idx.isSolid(p.x, p.z, this.feet) && !idx.isSolid(this.lastX, this.lastZ, this.feet)) {
      // La cabeza entró en un muro caminando de verdad por la habitación:
      // vuelve a donde estaba, como el "empujón" de cualquier juego de VR.
      p.x = this.lastX;
      p.z = this.lastZ;
    }

    // --- stick: avance horizontal según el rumbo de la cabeza ---
    let tx = 0;
    let tz = 0;
    let running = false;
    if (this.enabled && this.stick) {
      const s = shapeStick(this.stick.axes.x, this.stick.axes.y);
      if (s.x !== 0 || s.y !== 0) {
        running = this.stick.pressed;
        const speed = running ? RUN_SPEED : WALK_SPEED;
        cam.rotationQuaternion.toEulerAnglesToRef(this.euler);
        const sin = Math.sin(this.euler.y);
        const cos = Math.cos(this.euler.y);
        // Stick hacia adelante = y negativo. Babylon es de mano izquierda:
        // adelante (sin, cos), derecha (cos, −sin).
        const forward = -s.y;
        tx = (sin * forward + cos * s.x) * speed;
        tz = (cos * forward - sin * s.x) * speed;
      }
    }
    const pushing = tx !== 0 || tz !== 0;
    const blend = 1 - Math.exp(-(pushing ? ACCELERATION : BRAKING) * dt);
    this.vx += (tx - this.vx) * blend;
    this.vz += (tz - this.vz) * blend;
    if (!pushing && Math.hypot(this.vx, this.vz) < 0.02) {
      this.vx = 0;
      this.vz = 0;
    }
    if (this.vx !== 0 || this.vz !== 0) {
      const moved = slideMove(idx, p.x, p.z, this.vx * dt, this.vz * dt, this.feet);
      if (moved.hitX) this.vx = 0;
      if (moved.hitZ) this.vz = 0;
      this.stride += Math.hypot(moved.x - p.x, moved.z - p.z);
      if (this.stride >= 0.78) {
        this.stride = 0;
        this.onStep?.(running);
      }
      p.x = moved.x;
      p.z = moved.z;
    }
    this.motion = Math.min(1, Math.hypot(this.vx, this.vz) / WALK_SPEED);

    // --- piso: escalón, descanso, primer o segundo piso ---
    const floor = idx.groundHeight(p.x, p.z, this.feet);
    this.feet = jumped ? floor : followFloor(this.feet, floor, dt);
    const y = this.feet + this.head;
    if (Math.abs(p.y - y) > 0.001) p.y = y;
    this.lastX = p.x;
    this.lastZ = p.z;
  };
}
