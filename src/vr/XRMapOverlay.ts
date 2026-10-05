import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { HudInfo } from './XRWristPanel';

const SIZE = 288;
const DIAMETER = 0.26;
const FORWARD = new Vector3(0, 0, 1);
const RIGHT = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);

/** Minimapa redondo fijo arriba a la derecha de la vista del visor. */
export class XRMapOverlay {
  private readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private drawn = '';
  private info: HudInfo | null = null;

  constructor(scene: Scene) {
    this.texture = new DynamicTexture('xrMapOverlayTex', { width: SIZE, height: SIZE }, scene, true);
    this.texture.hasAlpha = true;
    this.material = new StandardMaterial('xrMapOverlayMat', scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveTexture = this.texture;
    this.material.opacityTexture = this.texture;
    this.material.disableLighting = true;
    this.material.fogEnabled = false;
    this.material.backFaceCulling = false;

    this.mesh = CreatePlane('xrMapOverlay', { width: DIAMETER, height: DIAMETER }, scene);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.mesh.renderingGroupId = 1;
    this.mesh.setEnabled(false);
  }

  set(info: HudInfo): void {
    this.info = info;
    this.mesh.setEnabled(Boolean(info.mapCanvas));
    const key = `${info.mapKey ?? ''}|${info.mapLevel ?? ''}`;
    if (!info.mapCanvas || key === this.drawn) return;
    this.drawn = key;

    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 8, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(info.mapCanvas, 0, 0, SIZE, SIZE);
    ctx.restore();

    ctx.strokeStyle = 'rgba(238,246,242,0.92)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '700 20px Arial, Helvetica, sans-serif';
    const label = info.mapLevel ?? '';
    const width = Math.max(44, ctx.measureText(label).width + 18);
    ctx.fillStyle = 'rgba(13,27,24,0.94)';
    roundRect(ctx, 14, 14, width, 32, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(238,246,242,0.65)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#eef6f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 14 + width / 2, 30, width - 8);
    this.texture.update(true);
  }

  update(camera: Camera): void {
    if (!this.info?.mapCanvas) return;
    const forward = camera.getDirection(FORWARD).scale(0.88);
    const right = camera.getDirection(RIGHT).scale(0.34);
    const up = camera.getDirection(UP).scale(0.27);
    this.mesh.position.copyFrom(camera.globalPosition).addInPlace(forward).addInPlace(right).addInPlace(up);
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
