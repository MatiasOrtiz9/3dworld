import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CityIndex } from '../world/CityIndex';

export type MoveMode = 'walk' | 'fly';

const EYE_HEIGHT = 1.68;
const WALK_SPEED = 4.2; // m/s — paso rápido de persona
const RUN_SPEED = 8.5;
const FLY_SPEED = 18;
const FLY_BOOST = 55;
const GRAVITY = -18;
const JUMP = 6.4;
const RADIUS = 0.45; // radio del cuerpo para la colisión

/**
 * Controlador del jugador.
 *
 * Dos modos, y el cambio entre ellos es la diferencia entre "mirar una maqueta"
 * y "estar en un lugar":
 *
 *  - **Caminar**: altura de ojos fija a 1,68 m, gravedad, salto y colisión
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
  private grounded = false;
  private readonly keys = new Set<string>();
  private onModeChange?: (mode: MoveMode) => void;
  private onStep?: (running: boolean) => void;
  /** Distancia acumulada desde el último paso, en metros. */
  private strideAccum = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: UniversalCamera,
    private readonly index: CityIndex,
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
    if (mode === 'walk') {
      // Al aterrizar, buscar un punto libre cercano para no quedar dentro de un muro.
      const p = this.camera.position;
      const free = this.findFreeSpot(p.x, p.z);
      this.camera.position.set(free.x, this.index.groundHeight(free.x, free.z) + EYE_HEIGHT, free.z);
    }
    this.onModeChange?.(mode);
  }

  toggleMode(): void {
    this.setMode(this.mode === 'walk' ? 'fly' : 'walk');
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
    this.keys.add(e.code);
    if (e.code === 'KeyF') this.toggleMode();
    if (e.code === 'Space') e.preventDefault();
  };

  private handleUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05);
    const cam = this.camera;

    // Vectores de avance y lateral, aplanados al suelo en modo caminar.
    const forward = cam.getDirection(Vector3.Forward());
    const right = cam.getDirection(Vector3.Right());
    if (this.mode === 'walk') {
      forward.y = 0;
      right.y = 0;
      forward.normalize();
      right.normalize();
    }

    let dx = 0;
    let dz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dz -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;

    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    if (this.mode === 'fly') {
      const speed = (running ? FLY_BOOST : FLY_SPEED) * dt;
      const move = forward.scale(dz * speed).add(right.scale(dx * speed));
      if (this.keys.has('KeyE')) move.y += speed;
      if (this.keys.has('KeyQ')) move.y -= speed;
      cam.position.addInPlace(move);
      return;
    }

    // --- caminar ---
    const speed = (running ? RUN_SPEED : WALK_SPEED) * dt;
    const move = forward.scale(dz * speed).add(right.scale(dx * speed));

    // Colisión por ejes separados: si el eje X está bloqueado pero Z no, el
    // jugador se desliza a lo largo de la pared en vez de quedarse trabado.
    // Es la diferencia entre una colisión que se siente natural y una que
    // frustra.
    const px = cam.position.x;
    const pz = cam.position.z;
    const before = { x: px, z: pz };
    if (!this.blocked(px + move.x + Math.sign(move.x) * RADIUS, pz)) {
      cam.position.x = px + move.x;
    }
    if (!this.blocked(cam.position.x, pz + move.z + Math.sign(move.z) * RADIUS)) {
      cam.position.z = pz + move.z;
    }

    // Pisadas: una cada 0,78 m recorridos, que es la zancada de una persona.
    if (this.onStep && this.grounded) {
      this.strideAccum += Math.hypot(cam.position.x - before.x, cam.position.z - before.z);
      if (this.strideAccum >= 0.78) {
        this.strideAccum = 0;
        this.onStep(running);
      }
    }

    // Gravedad y salto.
    const floor = this.index.groundHeight(cam.position.x, cam.position.z) + EYE_HEIGHT;
    if (this.grounded && this.keys.has('Space')) {
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

  private blocked(x: number, z: number): boolean {
    return this.index.isSolid(x, z);
  }

  /** Espiral de búsqueda de un punto libre, para no aterrizar dentro de un muro. */
  private findFreeSpot(x: number, z: number): { x: number; z: number } {
    if (!this.index.isSolid(x, z)) return { x, z };
    for (let r = 2; r <= 40; r += 2) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const nx = x + Math.cos(ang) * r;
        const nz = z + Math.sin(ang) * r;
        if (!this.index.isSolid(nx, nz)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }
}
