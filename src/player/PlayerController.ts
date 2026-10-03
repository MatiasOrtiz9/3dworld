import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CityIndex } from '../world/CityIndex';
import { VirtualInput } from './VirtualInput';

export type MoveMode = 'walk' | 'fly';

// Ojos de un adulto de ~1,73 m. Con 1,68 (un adulto de 1,80) el jugador veía
// por encima de la cabeza de la maestra (1,68 m de alto) y los pupitres de
// 0,74 m parecían de juguete.
const EYE_HEIGHT = 1.62;
const WALK_SPEED = 4.2; // m/s — paso rápido de persona
const RUN_SPEED = 8.5;
const FLY_SPEED = 18;
const FLY_BOOST = 55;
const GRAVITY = -18;
const JUMP = 6.4;
const RADIUS = 0.45; // radio del cuerpo para la colisión
const ACCELERATION = 11;
const BRAKING = 15;
const COLLISION_STEP = RADIUS * 0.5;
/**
 * Caída máxima que se baja caminando sin saltar. En la escuela, más que esto
 * sólo pasa por el costado abierto de un tramo de escalera: sin el límite se
 * atravesaba el pasamanos dibujado y se caía al piso de abajo. Un tramo
 * empinado, mirado RADIUS + un sub-paso adelante, baja ~0,5 m: el límite
 * queda por encima para no trabar a quien baja la escalera.
 */
const MAX_DROP = 0.65;
const FORWARD = new Vector3(0, 0, 1);
const RIGHT = new Vector3(1, 0, 0);

/**
 * Controlador del jugador.
 *
 * Dos modos, y el cambio entre ellos es la diferencia entre "mirar una maqueta"
 * y "estar en un lugar":
 *
 *  - **Caminar**: altura de ojos fija a 1,62 m, gravedad, salto y colisión
 *    contra los edificios. Es el modo que da escala. Un espacio urbano sólo se
 *    entiende cuando no podés atravesar las paredes y tenés que rodear la
 *    manzana.
 *  - **Volar**: libre, sin colisión. Sirve para ver el conjunto y para
 *    desarrollar.
 *
 * La colisión no usa el sistema de Babylon: consulta el índice de la ciudad
 * (ver CityIndex). Chocar contra 19.000 thin instances sería inviable; contra
 * una grilla de manzanas es una división.
 */
export class PlayerController {
  mode: MoveMode = 'walk';
  private velocityY = 0;
  private velocityX = 0;
  private velocityZ = 0;
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly move = new Vector3();
  private grounded = false;
  private readonly keys = new Set<string>();
  private onModeChange?: (mode: MoveMode) => void;
  private onStep?: (running: boolean) => void;
  private paused = false;
  /** Distancia acumulada desde el último paso, en metros. */
  private strideAccum = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: UniversalCamera,
    private readonly index: CityIndex,
    /** Joysticks y botones táctiles (celular). Sin ellos, sólo teclado. */
    private readonly input: VirtualInput = new VirtualInput(),
  ) {
    // Se desactiva el movimiento propio de la cámara: lo manejamos nosotros
    // para poder aplicar gravedad y colisión.
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];
    this.camera.keysUpward = [];
    this.camera.keysDownward = [];

    window.addEventListener('keydown', this.handleDown);
    window.addEventListener('keyup', this.handleUp);
    this.scene.onBeforeRenderObservable.add(this.update);
  }

  setMode(mode: MoveMode): void {
    this.mode = mode;
    this.velocityY = 0;
    this.velocityX = 0;
    this.velocityZ = 0;
    if (mode === 'walk') {
      // Al aterrizar, buscar un punto libre cercano para no quedar dentro de un muro.
      // Desde el vuelo se aterriza en el piso más alto por debajo de los pies
      // (en la escuela puede ser el primer o el segundo piso).
      const p = this.camera.position;
      const landing = this.index.groundHeight(p.x, p.z, p.y - EYE_HEIGHT);
      const free = this.findFreeSpot(p.x, p.z, landing);
      this.camera.position.set(free.x, this.index.groundHeight(free.x, free.z, landing) + EYE_HEIGHT, free.z);
    }
    this.onModeChange?.(mode);
  }

  toggleMode(): void {
    this.setMode(this.mode === 'walk' ? 'fly' : 'walk');
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.input.reset();
      this.velocityY = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
    }
  }

  onModeChanged(cb: (mode: MoveMode) => void): void {
    this.onModeChange = cb;
  }

  /**
   * Se llama en cada pisada.
   *
   * Se dispara por DISTANCIA recorrida, no por tiempo: así la cadencia se
   * acelera sola al correr y se detiene al parar, sin ninguna lógica extra.
   */
  onFootstep(cb: (running: boolean) => void): void {
    this.onStep = cb;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleDown);
    window.removeEventListener('keyup', this.handleUp);
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
  }

  private handleDown = (e: KeyboardEvent): void => {
    // No capturar teclas mientras se escribe en un campo.
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (this.paused) {
      e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'KeyF') this.toggleMode();
    if (e.code === 'Space') e.preventDefault();
  };

  private handleUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private update = (): void => {
    if (this.paused) return;
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05);
    const cam = this.camera;

    // Vectores de avance y lateral, aplanados al suelo en modo caminar.
    cam.getDirectionToRef(FORWARD, this.forward);
    cam.getDirectionToRef(RIGHT, this.right);
    if (this.mode === 'walk') {
      this.forward.y = 0;
      this.right.y = 0;
      this.forward.normalize();
      this.right.normalize();
    }

    let dx = 0;
    let dz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dz -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    // Joystick táctil: analógico, a medio recorrido se camina más despacio.
    dx += this.input.x;
    dz += this.input.y;

    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.input.run;
    const inputLength = Math.hypot(dx, dz);
    if (inputLength > 1) {
      dx /= inputLength;
      dz /= inputLength;
    }

    if (this.mode === 'fly') {
      this.move.set(
        this.forward.x * dz + this.right.x * dx,
        this.forward.y * dz + this.right.y * dx +
          Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ')) + this.input.rise,
        this.forward.z * dz + this.right.z * dx,
      );
      if (this.move.lengthSquared() > 1) this.move.normalize();
      this.move.scaleInPlace((running ? FLY_BOOST : FLY_SPEED) * dt);
      cam.position.addInPlace(this.move);
      return;
    }

    // --- caminar: aceleración y frenado suaves, con velocidad de carrera ---
    const hasInput = dx !== 0 || dz !== 0;
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const targetX = (this.forward.x * dz + this.right.x * dx) * speed;
    const targetZ = (this.forward.z * dz + this.right.z * dx) * speed;
    const blend = 1 - Math.exp(-(hasInput ? ACCELERATION : BRAKING) * dt);
    this.velocityX += (targetX - this.velocityX) * blend;
    this.velocityZ += (targetZ - this.velocityZ) * blend;
    const moveX = this.velocityX * dt;
    const moveZ = this.velocityZ * dt;

    // Colisión por ejes separados: si el eje X está bloqueado pero Z no, el
    // jugador se desliza a lo largo de la pared en vez de quedarse trabado.
    // Es la diferencia entre una colisión que se siente natural y una que
    // frustra.
    const beforeX = cam.position.x;
    const beforeZ = cam.position.z;
    let px = beforeX;
    let pz = beforeZ;
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(moveX), Math.abs(moveZ)) / COLLISION_STEP),
    );
    const stepX = moveX / steps;
    const stepZ = moveZ / steps;
    for (let i = 0; i < steps; i++) {
      const nextX = px + stepX;
      if (
        stepX === 0 ||
        !this.blocked(nextX + Math.sign(stepX) * RADIUS, pz, this.grounded)
      ) {
        px = nextX;
      } else {
        this.velocityX = 0;
      }

      const nextZ = pz + stepZ;
      if (
        stepZ === 0 ||
        !this.blocked(px, nextZ + Math.sign(stepZ) * RADIUS, this.grounded)
      ) {
        pz = nextZ;
      } else {
        this.velocityZ = 0;
      }
    }
    cam.position.x = px;
    cam.position.z = pz;

    // Pisadas: una cada 0,78 m recorridos, que es la zancada de una persona.
    if (this.onStep && this.grounded) {
      this.strideAccum += Math.hypot(cam.position.x - beforeX, cam.position.z - beforeZ);
      if (this.strideAccum >= 0.78) {
        this.strideAccum = 0;
        this.onStep(running);
      }
    }

    // Gravedad y salto. El piso depende de la altura de los pies: en la
    // escuela hay planta alta y escaleras.
    const floor = this.index.groundHeight(cam.position.x, cam.position.z, this.feet()) + EYE_HEIGHT;
    if (this.grounded && (this.keys.has('Space') || this.input.takeJump())) {
      this.velocityY = JUMP;
      this.grounded = false;
    }
    this.velocityY += GRAVITY * dt;
    cam.position.y += this.velocityY * dt;

    if (cam.position.y <= floor) {
      cam.position.y = floor;
      this.velocityY = 0;
      this.grounded = true;
    }
  };

  /** Altura de los pies. */
  private feet(): number {
    return this.camera.position.y - EYE_HEIGHT;
  }

  /** ¿Hay algo en (x, z)? Con los pies en el piso, también un borde de más de MAX_DROP. */
  private blocked(x: number, z: number, grounded: boolean): boolean {
    const feet = this.feet();
    return this.index.isSolid(x, z, feet) || (grounded && this.index.groundHeight(x, z, feet) < feet - MAX_DROP);
  }

  /** Espiral de búsqueda de un punto libre, para no aterrizar dentro de un muro. */
  private findFreeSpot(x: number, z: number, feetY?: number): { x: number; z: number } {
    if (!this.index.isSolid(x, z, feetY)) return { x, z };
    for (let r = 2; r <= 40; r += 2) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const nx = x + Math.cos(ang) * r;
        const nz = z + Math.sin(ang) * r;
        if (!this.index.isSolid(nx, nz, feetY)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }
}
