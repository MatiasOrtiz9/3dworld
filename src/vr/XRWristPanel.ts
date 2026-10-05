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
  mapCanvas?: HTMLCanvasElement;
  mapKey?: string;
  mapLevel?: string;
  freeRoam?: boolean;
}

const W = 768;
const H = 360;
const WIDTH = 0.3;

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
    const key = `${info.place}|${info.progress}|${info.mapKey ?? ''}|${info.freeRoam ? 1 : 0}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(13, 27, 24, 0.94)';
    roundRect(ctx, 4, 4, W - 8, H - 8, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242, 193, 78, 0.85)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = info.freeRoam ? '#86dda5' : '#b7d4ca';
    ctx.font = '700 25px Arial, Helvetica, sans-serif';
    ctx.fillText(info.freeRoam ? 'PASEO LIBRE' : 'ESTÁS EN', 28, 45);
    ctx.fillStyle = '#eef6f2';
    ctx.font = '700 34px Arial, Helvetica, sans-serif';
    ctx.fillText(info.place || 'Barrio de la escuela', 28, 93, 390);
    ctx.fillStyle = '#f2c14e';
    ctx.font = '600 23px Arial, Helvetica, sans-serif';
    ctx.fillText(info.progress, 28, 140, 390);
    ctx.fillStyle = '#8fb3a6';
    ctx.font = '400 20px Arial, Helvetica, sans-serif';
    ctx.fillText('Stick izq.: caminar · apretar: correr', 28, 230, 390);
    ctx.fillText('Stick der.: girar · adelante: saltar', 28, 263, 390);
    ctx.fillText('B / Y: abrir mapa y configuración', 28, 296, 390);
    ctx.fillStyle = '#b7d4ca';
    ctx.font = '700 18px Arial, Helvetica, sans-serif';
    ctx.fillText('MAPA COMPLETO', 455, 31, 240);
    const mx = 590;
    const my = 190;
    const mr = 143;
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.clip();
    if (info.mapCanvas) ctx.drawImage(info.mapCanvas, mx - mr, my - mr, mr * 2, mr * 2);
    else {
      ctx.fillStyle = '#0b1513';
      ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(238,246,242,0.65)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.stroke();
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
