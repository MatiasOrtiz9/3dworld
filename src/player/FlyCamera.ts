import type { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * Crea y configura la cámara del jugador.
 *
 * Esta función se ocupa SÓLO de la cámara: posición inicial, orientación,
 * sensibilidad del mouse y planos de recorte. Todo el movimiento —teclado,
 * gravedad, salto y colisión— vive en `PlayerController`.
 *
 * Esa separación es deliberada, y antes no lo era: esta función asignaba
 * `keysUp`, `keysDown`, `keysLeft`, `keysRight`, `keysUpward` y `keysDownward`,
 * y además registraba dos listeners en `window` para que `Shift` modificara
 * `camera.speed`. Nada de eso hacía nada, porque `PlayerController` vacía esos
 * seis arrays en su constructor y escribe `camera.position` directamente —
 * `camera.speed` ya no se lee nunca. Encima esos dos listeners no se quitaban
 * jamás. Parecían dos sistemas de movimiento compitiendo, y sólo había uno.
 *
 * La posición inicial es provisoria: `main.ts` la reemplaza, una vez armada la
 * ciudad, por la vereda de enfrente de la escuela.
 */
export function createFlyCamera(scene: Scene, canvas: HTMLCanvasElement): UniversalCamera {
  const camera = new UniversalCamera('playerCam', new Vector3(0, 1.7, -20), scene);
  camera.setTarget(new Vector3(0, 5.5, 0));
  camera.attachControl(canvas, true);

  camera.inertia = 0.82;
  camera.angularSensibility = 1600;
  // Plano cercano de 10 cm, igual que en el visor. La colisión deja el ojo a
  // ≥ 20 cm de cualquier muro (margen de la grilla de la escuela), pero con
  // 15 cm la esquina del plano cercano llegaba a 23 cm del ojo: al rozar un
  // marco de puerta o la baranda de una escalera y girar la cabeza se veía
  // a través del muro. Con 10 cm la esquina queda a ~15 cm. La precisión de
  // profundidad sigue sobrada: ~6 mm a 100 m con el búfer de 24 bits.
  camera.minZ = 0.1;
  // Campo vertical de ~56° (≈ 87° horizontales en 16:9): el de 60° estiraba
  // a la gente y los pupitres en los bordes del cuadro como un gran angular.
  camera.fov = 0.98;

  return camera;
}
