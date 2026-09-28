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
 * La cámara aparece dentro de la plaza, en el hueco sin árboles del sector sur,
 * mirando al Árbol Solar.
 */
export function createFlyCamera(scene: Scene, canvas: HTMLCanvasElement): UniversalCamera {
  const camera = new UniversalCamera('playerCam', new Vector3(0, 1.7, -20), scene);
  camera.setTarget(new Vector3(0, 5.5, 0));
  camera.attachControl(canvas, true);

  camera.inertia = 0.82;
  camera.angularSensibility = 1600;
  camera.minZ = 0.15;
  camera.fov = 1.05;

  return camera;
}
