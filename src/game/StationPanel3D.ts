import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import type { Observer } from '@babylonjs/core/Misc/observable';

const W = 1024;
const H = 680;
const PANEL_W = 1.3;
const PANEL_H = (PANEL_W * H) / W;

interface HitZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  action: () => void;
}

export interface PanelQuestion {
  title: string;
  step: string;
  question: string;
  options: string[];
  feedback: string;
  progress: string;
}

/**
 * Panel de desafíos dentro del visor.
 *
 * En VR no hay HTML: el diálogo del escritorio no existe para quien tiene el
 * casco puesto. Este panel es un plano en el mundo, dibujado en canvas, que se
 * ubica delante del usuario y se contesta apuntando con el control (o con la
 * mano) y apretando el gatillo. El puntero de WebXR genera eventos de puntero
 * normales de la escena, así que el panel sólo tiene que traducir la
 * coordenada de textura del impacto a un botón.
 *
 * Además tiene un cartel flotante que marca la estación cercana.
 */
export class StationPanel3D {
  private readonly panel: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private readonly label: Mesh;
  private readonly labelTexture: DynamicTexture;
  private readonly labelMaterial: StandardMaterial;
  private readonly pointer: Observer<PointerInfo>;
  private zones: HitZone[] = [];
  private labelText = '';

  constructor(private readonly scene: Scene) {
    this.texture = new DynamicTexture('stationPanelTex', { width: W, height: H }, scene, true);
    this.material = new StandardMaterial('stationPanel', scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveTexture = this.texture;
    this.material.disableLighting = true;
    this.material.fogEnabled = false;

    this.panel = CreatePlane('stationPanel', { width: PANEL_W, height: PANEL_H }, scene);
    this.panel.material = this.material;
    this.panel.isPickable = true;
    // Siempre por encima de la ciudad: un panel tapado por un árbol no se puede
    // contestar.
    this.panel.renderingGroupId = 1;
    this.panel.setEnabled(false);

    this.labelTexture = new DynamicTexture('stationLabelTex', { width: 512, height: 128 }, scene, true);
    this.labelMaterial = new StandardMaterial('stationLabel', scene);
    this.labelMaterial.diffuseColor = Color3.Black();
    this.labelMaterial.specularColor = Color3.Black();
    this.labelMaterial.emissiveTexture = this.labelTexture;
    this.labelMaterial.opacityTexture = this.labelTexture;
    this.labelMaterial.disableLighting = true;
    this.labelMaterial.fogEnabled = false;
    this.labelTexture.hasAlpha = true;
    this.label = CreatePlane('stationLabel', { width: 1.6, height: 0.4 }, scene);
    this.label.material = this.labelMaterial;
    this.label.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.label.isPickable = false;
    this.label.setEnabled(false);

    this.pointer = scene.onPointerObservable.add(this.onPointer);
  }

  get visible(): boolean {
    return this.panel.isEnabled();
  }

  /** Ubica el panel entre el usuario y la estación, a la altura de los ojos. */
  placeFacing(viewer: Vector3, station: Vector3): void {
    const dx = station.x - viewer.x;
    const dz = station.z - viewer.z;
    const d = Math.hypot(dx, dz) || 1;
    const dist = Math.min(1.8, Math.max(1.35, d * 0.42));
    const x = viewer.x + (dx / d) * dist;
    const z = viewer.z + (dz / d) * dist;
    this.panel.position.set(x, viewer.y - 0.12, z);
    // CreatePlane muestra su cara hacia −Z: con +Z apuntando desde el usuario
    // hacia el panel, la cara queda mirando al usuario y el texto se lee bien.
    this.panel.rotation.set(0.12, Math.atan2(dx, dz), 0);
  }

  showQuestion(q: PanelQuestion, onChoice: (i: number) => void, onClose: () => void): void {
    const ctx = this.begin(q.title, q.step, q.progress);
    ctx.fillStyle = '#eef6f2';
    ctx.font = '600 36px Arial, Helvetica, sans-serif';
    let y = wrap(ctx, q.question, 56, 190, W - 112, 44);
    y += 22;
    this.zones = [];
    q.options.forEach((opt, i) => {
      const x0 = 56;
      const y0 = y;
      const x1 = W - 56;
      const y1 = y + 74;
      button(ctx, x0, y0, x1, y1, `${String.fromCharCode(65 + i)}.  ${opt}`, false);
      this.zones.push({ x0, y0, x1, y1, action: () => onChoice(i) });
      y += 88;
    });
    this.footer(ctx, q.feedback, 'Cerrar', onClose);
    this.texture.update(true);
    this.panel.setEnabled(true);
  }

  showMessage(title: string, step: string, text: string, feedback: string, progress: string, onClose: () => void): void {
    const ctx = this.begin(title, step, progress);
    ctx.fillStyle = '#eef6f2';
    ctx.font = '600 38px Arial, Helvetica, sans-serif';
    wrap(ctx, text, 56, 210, W - 112, 48);
    this.zones = [];
    this.footer(ctx, feedback, 'Continuar', onClose);
    this.texture.update(true);
    this.panel.setEnabled(true);
  }

  hide(): void {
    this.panel.setEnabled(false);
    this.zones = [];
  }

  /** Cartel flotante sobre la estación cercana. `null` lo oculta. */
  setLabel(text: string | null, at?: Vector3): void {
    if (!text || !at) {
      this.label.setEnabled(false);
      this.labelText = '';
      return;
    }
    this.label.position.set(at.x, at.y + 3, at.z);
    this.label.setEnabled(true);
    if (text === this.labelText) return;
    this.labelText = text;
    const ctx = this.labelTexture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(13, 27, 24, 0.85)';
    roundRect(ctx, 4, 4, 504, 120, 18);
    ctx.fill();
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2c14e';
    ctx.font = '700 40px Arial, Helvetica, sans-serif';
    const [line1, line2] = text.split('\n');
    ctx.fillText(line1, 256, 56);
    ctx.fillStyle = '#eef6f2';
    ctx.font = '400 26px Arial, Helvetica, sans-serif';
    if (line2) ctx.fillText(line2, 256, 98);
    this.labelTexture.update(true);
  }

  dispose(): void {
    this.scene.onPointerObservable.remove(this.pointer);
    this.panel.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.label.dispose();
    this.labelMaterial.dispose();
    this.labelTexture.dispose();
  }

  // ------------------------------------------------------------------ interno

  private onPointer = (info: PointerInfo): void => {
    if (info.type !== PointerEventTypes.POINTERDOWN || !this.visible) return;
    const pick = info.pickInfo;
    if (!pick?.hit || pick.pickedMesh !== this.panel) return;
    const uv = pick.getTextureCoordinates();
    if (!uv) return;
    // Con invertY (por defecto) la fila 0 del canvas corresponde a v = 1.
    const px = uv.x * W;
    const py = (1 - uv.y) * H;
    const zone = this.zones.find((z) => px >= z.x0 && px <= z.x1 && py >= z.y0 && py <= z.y1);
    zone?.action();
  };

  private begin(title: string, step: string, progress: string): CanvasRenderingContext2D {
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1b18';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(242,193,78,0.8)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f2c14e';
    ctx.font = '700 50px Arial, Helvetica, sans-serif';
    ctx.fillText(title, 56, 84);
    ctx.fillStyle = '#4faa7a';
    ctx.font = '700 28px Arial, Helvetica, sans-serif';
    ctx.fillText(step.toUpperCase(), 56, 132);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#b7d4ca';
    ctx.font = '400 26px Arial, Helvetica, sans-serif';
    ctx.fillText(progress, W - 56, 84);
    ctx.textAlign = 'left';
    return ctx;
  }

  private footer(ctx: CanvasRenderingContext2D, feedback: string, label: string, action: () => void): void {
    if (feedback) {
      ctx.fillStyle = '#f2c14e';
      ctx.font = '600 28px Arial, Helvetica, sans-serif';
      wrap(ctx, feedback, 56, H - 118, W - 360, 34);
    }
    const x0 = W - 290;
    const y0 = H - 104;
    const x1 = W - 56;
    const y1 = H - 40;
    button(ctx, x0, y0, x1, y1, label, true);
    this.zones.push({ x0, y0, x1, y1, action });
  }
}

function button(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  text: string,
  accent: boolean,
): void {
  ctx.fillStyle = accent ? 'rgba(79,170,122,0.35)' : 'rgba(255,255,255,0.08)';
  roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 10);
  ctx.fill();
  ctx.strokeStyle = accent ? '#4faa7a' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#eef6f2';
  ctx.font = '500 32px Arial, Helvetica, sans-serif';
  ctx.textAlign = accent ? 'center' : 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, accent ? (x0 + x1) / 2 : x0 + 24, (y0 + y1) / 2 + 2, x1 - x0 - 40);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
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

/** Escribe texto con ajuste de línea. Devuelve la altura siguiente libre. */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
}
