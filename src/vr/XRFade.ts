import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

/** Distancia a los ojos: por delante del plano cercano del visor (0,1 m). */
const DISTANCE = 0.2;
/** Lado del plano: a 0,2 m cubre de sobra los ~110° por ojo del Quest 3. */
const SIZE = 3;
const DEFAULT_MS = 250;

/**
 * Fundido a negro pegado a los ojos.
 *
 * En el visor un salto de lugar a pantalla abierta (entrar a la escuela, un
 * cambio de capítulo, volver al título) es de lo que más marea: el mundo
 * "se corre" sin que el cuerpo se mueva. Cerrar a negro, mover y abrir es lo
 * que hacen todos los juegos de Quest.
 *
 * Es un plano negro hijo de la cámara XR en el grupo de render 3, el último,
 * con el depth limpio: tapa todo, paneles y viñeta incluidos. Transparente
 * queda desactivado y no cuesta nada.
 */
export class XRFade {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private level = 0;
  private from = 0;
  private to = 0;
  private start = 0;
  private duration = 0;
  private observer: Observer<Scene> | null = null;
  private pending: (() => void) | null = null;
  private safety = 0;

  constructor(
    private readonly scene: Scene,
    camera: Camera,
  ) {
    this.mesh = CreatePlane('xrFade', { size: SIZE }, scene);
    this.mesh.parent = camera;
    // La cámara mira a +Z (−Z con el sistema de mano derecha).
    this.mesh.position.z = scene.useRightHandedSystem ? -DISTANCE : DISTANCE;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 3;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.material = new StandardMaterial('xrFadeMat', scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveColor = Color3.Black();
    this.material.disableLighting = true;
    this.material.fogEnabled = false;
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.mesh.material = this.material;
    this.mesh.visibility = 0;
    this.mesh.setEnabled(false);
  }

  /** Totalmente negro (se puede mover al jugador sin que lo vea). */
  get black(): boolean {
    return this.level >= 0.999;
  }

  /**
   * Cierra a negro (`true`) o abre (`false`) en `ms`. La promesa se cumple al
   * terminar, o al empezar otro fundido (el anterior queda interrumpido).
   */
  fade(toBlack: boolean, ms = DEFAULT_MS): Promise<void> {
    this.finish();
    const target = toBlack ? 1 : 0;
    if (ms <= 0 || Math.abs(this.level - target) < 0.001) {
      this.setLevel(target);
      return Promise.resolve();
    }
    this.from = this.level;
    this.to = target;
    // Un fundido a medias tarda lo que le falta, no la duración entera.
    this.duration = ms * Math.abs(target - this.level);
    this.start = performance.now();
    this.observer = this.scene.onBeforeRenderObservable.add(this.step);
    // Si el motor deja de dibujar (pestaña oculta, sesión cortada), la
    // promesa igual se cumple: nadie queda esperando un fundido que no avanza.
    this.safety = window.setTimeout(() => {
      this.setLevel(this.to);
      this.finish();
    }, this.duration + 400);
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  dispose(): void {
    this.finish();
    this.mesh.dispose();
    this.material.dispose();
  }

  private step = (): void => {
    const t = Math.min(1, (performance.now() - this.start) / Math.max(1, this.duration));
    // Suave en los extremos: el negro no "golpea".
    const e = t * t * (3 - 2 * t);
    this.setLevel(this.from + (this.to - this.from) * e);
    if (t >= 1) this.finish();
  };

  private finish(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    if (this.safety) {
      clearTimeout(this.safety);
      this.safety = 0;
    }
    const resolve = this.pending;
    this.pending = null;
    resolve?.();
  }

  private setLevel(level: number): void {
    this.level = level;
    this.mesh.visibility = level;
    const on = level > 0.001;
    if (this.mesh.isEnabled() !== on) this.mesh.setEnabled(on);
  }
}
