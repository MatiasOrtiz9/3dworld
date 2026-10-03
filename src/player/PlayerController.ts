import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CityIndex } from '../world/CityIndex';
import { VirtualInput } from './VirtualInput';
import { RUN_SPEED, WALK_SPEED, walkStep, type WalkState } from './walkPhysics';

export type MoveMode = 'walk' | 'fly';

// Ojos de un adulto de ~1,73 m. Con 1,68 (un adulto de 1,80) el jugador veía
// por encima de la cabeza de la maestra (1,68 m de alto) y los pupitres de
// 0,74 m parecían de juguete.
const EYE_HEIGHT = 1.62;
const FLY_SPEED = 18;
const FLY_BOOST = 55;
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
  private readonly state: WalkState = { x: 0, z: 0, feet: 0, vx: 0, vz: 0, vy: 0, grounded: false };
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
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const targetX = (this.forward.x * dz + this.right.x * dx) * speed;
    const targetZ = (this.forward.z * dz + this.right.z * dx) * speed;
    // La física vive en walkPhysics: las pruebas de puertas y escaleras corren
    // la misma función, no una copia.
    const st = this.state;
    st.x = cam.position.x;
    st.z = cam.position.z;
    st.feet = cam.position.y - EYE_HEIGHT;
    st.vx = this.velocityX;
    st.vz = this.velocityZ;
    st.vy = this.velocityY;
    st.grounded = this.grounded;
    const wasGrounded = this.grounded;
    const jump = this.grounded && (this.keys.has('Space') || this.input.takeJump());
    const moved = walkStep(this.index, st, targetX, targetZ, dt, jump);
    cam.position.set(st.x, st.feet + EYE_HEIGHT, st.z);
    this.velocityX = st.vx;
    this.velocityZ = st.vz;
    this.velocityY = st.vy;
    this.grounded = st.grounded;

    if (this.onStep && wasGrounded) {
      this.strideAccum += moved;
      if (this.strideAccum >= 0.78) {
        this.strideAccum = 0;
        this.onStep(running);
      }
    }
  };

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
