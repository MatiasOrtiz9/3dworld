import type { Scene } from '@babylonjs/core/scene';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { CityIndex } from '../world/CityIndex';

/**
 * En VR, mantiene al jugador sobre el piso real del lugar en el que está.
 *
 * La caminata con el stick mueve la cámara en un plano: sin esto, en la
 * escuela se atravesaban los escalones y la planta alta quedaba inalcanzable.
 * Cada cuadro se consulta el MISMO índice que usa el modo escritorio:
 *
 *  - **Piso**: la altura del piso bajo los pies (escalón, descanso, primer o
 *    segundo piso) se suma a la altura real de la cabeza del usuario, con un
 *    suavizado corto para que subir una escalera no dé saltos de 17 cm.
 *  - **Paredes**: si el último movimiento metió los pies dentro de un muro, se
 *    vuelve a la posición anterior, que es lo que hace cualquier juego de VR
 *    con su "empujón" de colisión.
 *
 * `index` se pide en cada cuadro porque la ciudad se puede regenerar.
 */
export function followFloors(scene: Scene, xr: WebXRDefaultExperience, index: () => CityIndex | null): () => void {
  const cam = xr.baseExperience.camera;
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  // Altura de los pies que se viene siguiendo: decide en qué nivel se está.
  let feet = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const idx = index();
    if (!idx || xr.baseExperience.state !== WebXRState.IN_XR) {
      lastX = Number.NaN;
      return;
    }
    const head = cam.realWorldHeight > 0.5 ? cam.realWorldHeight : 1.6;
    const p = cam.position;
    if (Number.isNaN(lastX)) feet = p.y - head;
    // Un salto grande es un teletransporte: se acepta y se toma su altura.
    const jumped = !Number.isNaN(lastX) && Math.hypot(p.x - lastX, p.z - lastZ) > 1.5;
    if (jumped) feet = p.y - head;
    if (!jumped && !Number.isNaN(lastX) && idx.isSolid(p.x, p.z, feet) && !idx.isSolid(lastX, lastZ, feet)) {
      p.x = lastX;
      p.z = lastZ;
    }
    const floor = idx.groundHeight(p.x, p.z, feet);
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1);
    feet += (floor - feet) * Math.min(1, dt * 14);
    if (Math.abs(floor - feet) < 0.002) feet = floor;
    const target = feet + head;
    if (Math.abs(p.y - target) > 0.002) p.y = target;
    lastX = p.x;
    lastZ = p.z;
  });
  return () => {
    scene.onBeforeRenderObservable.remove(observer);
  };
}
