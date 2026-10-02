import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

/** Anillos desde el eje de la mirada: transparente adentro, negro en la periferia. */
const RINGS = [
  { angle: 34, alpha: 0 },
  { angle: 52, alpha: 0.9 },
  { angle: 82, alpha: 1 },
];
const SEGMENTS = 40;
/** Distancia a los ojos. Más cerca que el plano de recorte (0,1 m) no se vería. */
const DISTANCE = 0.4;
/** Opacidad con el stick a fondo: oscurece la periferia sin apagarla. */
const MAX_OPACITY = 0.72;

/**
 * Viñeta de confort: oscurece la periferia mientras el stick mueve al jugador.
 *
 * El mareo en VR aparece cuando la vista periférica ve movimiento que el oído
 * interno no siente. Achicar el campo visual SÓLO mientras dura el movimiento
 * artificial es la mitigación estándar (la usan casi todos los juegos de
 * Quest): quieto o caminando de verdad por la habitación no aparece.
 *
 * Es un anillo pegado a la cabeza con opacidad por vértice. Va en el grupo de
 * render 2, que se dibuja último y con el depth limpio: nada lo tapa. Mientras
 * no hay movimiento la malla está desactivada y no cuesta nada.
 */
export class ComfortVignette {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private level = 0;

  constructor(scene: Scene, camera: Camera) {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (const ring of RINGS) {
      const r = DISTANCE * Math.tan((ring.angle * Math.PI) / 180);
      for (let s = 0; s <= SEGMENTS; s++) {
        const a = (s / SEGMENTS) * Math.PI * 2;
        positions.push(Math.cos(a) * r, Math.sin(a) * r, DISTANCE);
        colors.push(0, 0, 0, ring.alpha);
      }
    }
    const row = SEGMENTS + 1;
    for (let r = 0; r < RINGS.length - 1; r++) {
      for (let s = 0; s < SEGMENTS; s++) {
        const a = r * row + s;
        const b = a + row;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const data = new VertexData();
    data.positions = positions;
    data.colors = colors;
    data.indices = indices;

    this.mesh = new Mesh('xrComfortVignette', scene);
    data.applyToMesh(this.mesh);
    this.mesh.hasVertexAlpha = true;
    this.mesh.useVertexColors = true;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 2;
    // Pegada a la cabeza: nunca sale del cuadro, no hace falta recortarla.
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.parent = camera;

    this.material = new StandardMaterial('xrComfortVignetteMat', scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveColor = Color3.Black();
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.material.fogEnabled = false;
    this.material.disableDepthWrite = true;
    this.mesh.material = this.material;
    this.mesh.setEnabled(false);
  }

  /** `target` entre 0 y 1: cuánto movimiento artificial hay en este cuadro. */
  update(target: number, dt: number): void {
    // Aparece rápido (antes de que el cerebro note el desfase) y se va despacio.
    const rate = target > this.level ? 8 : 3;
    this.level += (target - this.level) * Math.min(1, dt * rate);
    if (this.level < 0.01) {
      this.level = 0;
      if (this.mesh.isEnabled()) this.mesh.setEnabled(false);
      return;
    }
    if (!this.mesh.isEnabled()) this.mesh.setEnabled(true);
    this.mesh.visibility = this.level * MAX_OPACITY;
  }

  hide(): void {
    this.level = 0;
    this.mesh.setEnabled(false);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
