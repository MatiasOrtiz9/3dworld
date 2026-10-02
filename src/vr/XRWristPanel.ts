import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

export interface HudInfo {
  /** Ambiente de la escuela en el que se está, o vacío afuera. */
  place: string;
  /** Avance de la misión, p. ej. "2 / 5 docentes". */
  progress: string;
}

const W = 512;
const H = 208;
const WIDTH = 0.17;

/**
 * Panel de muñeca: lo que en escritorio dicen el cartel "Estás en" y la barra
 * de misión, que en el visor no existen (no hay HTML dentro del casco).
 *
 * Flota sobre el control izquierdo y siempre mira a los ojos: se lee
 * levantando la mano, como un reloj, y con la mano baja queda fuera de la
 * vista. Se redibuja sólo cuando cambia el texto.
 */
export class WristPanel {
  private readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private drawn = '';

  constructor(scene: Scene) {
    this.texture = new DynamicTexture('xrWristTex', { width: W, height: H }, scene, true);
    this.texture.hasAlpha = true;
    this.material = new StandardMaterial('xrWristMat', scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveTexture = this.texture;
    this.material.opacityTexture = this.texture;
    this.material.disableLighting = true;
    this.material.fogEnabled = false;
    this.material.backFaceCulling = false;

    this.mesh = CreatePlane('xrWristPanel', { width: WIDTH, height: (WIDTH * H) / W }, scene);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    // Por encima de la ciudad: con la mano contra una pared se sigue leyendo.
    this.mesh.renderingGroupId = 1;
    this.mesh.setEnabled(false);
  }

  /** Engancha el panel a la empuñadura izquierda (o lo esconde con `null`). */
  attachTo(grip: TransformNode | null): void {
    this.mesh.parent = grip;
    this.mesh.position.set(0, 0.085, -0.03);
    this.mesh.setEnabled(Boolean(grip));
  }

  set(info: HudInfo): void {
    const key = `${info.place}|${info.progress}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(13, 27, 24, 0.86)';
    roundRect(ctx, 4, 4, W - 8, H - 8, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242, 193, 78, 0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#b7d4ca';
    ctx.font = '600 24px Arial, Helvetica, sans-serif';
    ctx.fillText(info.place ? 'ESTÁS EN' : 'RECORRIDO CIMDIP', 26, 44);
    ctx.fillStyle = '#eef6f2';
    ctx.font = '700 38px Arial, Helvetica, sans-serif';
    ctx.fillText(info.place || 'Barrio de la escuela', 26, 90, W - 52);
    ctx.fillStyle = '#f2c14e';
    ctx.font = '600 28px Arial, Helvetica, sans-serif';
    ctx.fillText(info.progress, 26, 134, W - 52);
    ctx.fillStyle = '#8fb3a6';
    ctx.font = '400 21px Arial, Helvetica, sans-serif';
    ctx.fillText('Stick izq.: caminar (clic: correr)', 26, 168, W - 52);
    ctx.fillText('Stick der.: girar · adelante: saltar', 26, 192, W - 52);
    this.texture.update(true);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
