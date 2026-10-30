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
/** Direcciones de la cámara, reusadas: `update` corre en cada cuadro del visor. */
const _dir = new Vector3();

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
    // Se enciende en `update`, sólo con la cámara del visor.
    this.info = info;
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

  /**
   * Por cuadro, con la cámara del visor (null fuera de él). Fuera del visor
   * se apaga: si no, quedaba flotando (por encima de todo, grupo 1) donde
   * estuvo la cabeza, justo delante de la cámara del escritorio al salir.
   */
  update(camera: Camera | null): void {
    const on = Boolean(camera && this.info?.mapCanvas);
    if (this.mesh.isEnabled() !== on) this.mesh.setEnabled(on);
    if (!on || !camera) return;
    const p = this.mesh.position.copyFrom(camera.globalPosition);
    camera.getDirectionToRef(FORWARD, _dir);
    p.addInPlace(_dir.scaleInPlace(0.88));
    camera.getDirectionToRef(RIGHT, _dir);
    p.addInPlace(_dir.scaleInPlace(0.34));
    camera.getDirectionToRef(UP, _dir);
    p.addInPlace(_dir.scaleInPlace(0.27));
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
