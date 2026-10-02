import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Ray } from '@babylonjs/core/Culling/ray';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { ActivityView } from '../activities/types';
import type { CardView, LineView } from '../../ui/Hud';
import { drawGrid, drawIcon, drawSequence, roundRect, UI, wrapText } from '../../ui/draw';

/**
 * Panel del visor: diálogos, actividades, fichas y menús dentro del mundo.
 *
 * En VR no hay HTML. Este panel es un plano dibujado en canvas que se ubica a
 * un brazo de distancia, un poco por debajo de los ojos y de frente al
 * jugador, y se contesta apuntando con el láser y apretando el gatillo (el
 * puntero de WebXR genera eventos de puntero normales de la escena). Mientras
 * está abierto el director pausa la caminata: leer y moverse a la vez marea.
 *
 * Además: el cartel flotante de lo que se está apuntando ("Gatillo · Hablar")
 * y avisos breves (sellos, lugares) que aparecen frente a la cara y se van.
 */

export type PanelModel =
  | { kind: 'line'; line: LineView }
  | { kind: 'activity'; view: ActivityView }
  | { kind: 'card'; card: CardView }
  | { kind: 'menu'; kicker: string; title: string; text: string; buttons: string[] };

const W = 1024;
const H = 700;
const PANEL_W = 1.1;
const PANEL_H = (PANEL_W * H) / W;
/** Distancia del panel a los ojos: a un brazo, cómodo para leer y apuntar. */
const DIST = 1.2;

interface Zone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  index: number;
}

export class GamePanel3D {
  private readonly panel: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private readonly label: Mesh;
  private readonly labelTexture: DynamicTexture;
  private readonly labelMaterial: StandardMaterial;
  private readonly toast: Mesh;
  private readonly toastTexture: DynamicTexture;
  private readonly toastMaterial: StandardMaterial;
  private readonly pointer: Observer<PointerInfo>;
  private zones: Zone[] = [];
  private onPick: ((i: number) => void) | null = null;
  /** Qué muestra el panel ahora (B/Y sólo cierra carteles). */
  private kind: PanelModel['kind'] | null = null;
  /** Antirrebote: el gatillo puede llegar por dos caminos en el mismo cuadro. */
  private lastPickAt = 0;
  private labelText = '';
  private toastLeft = 0;

  constructor(scene: Scene) {
    const mkMat = (name: string, tex: DynamicTexture, alpha: boolean) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveTexture = tex;
      if (alpha) {
        m.opacityTexture = tex;
        tex.hasAlpha = true;
      }
      m.disableLighting = true;
      m.fogEnabled = false;
      return m;
    };
    this.texture = new DynamicTexture('gamePanelTex', { width: W, height: H }, scene, true);
    this.material = mkMat('gamePanel', this.texture, false);
    this.panel = CreatePlane('gamePanel', { width: PANEL_W, height: PANEL_H }, scene);
    this.panel.material = this.material;
    this.panel.isPickable = true;
    this.panel.metadata = { xrInteractive: true };
    // Siempre por encima de la escuela: un panel tapado por una pared no se puede contestar.
    this.panel.renderingGroupId = 1;
    this.panel.setEnabled(false);

    this.labelTexture = new DynamicTexture('gameLabelTex', { width: 512, height: 128 }, scene, true);
    this.labelMaterial = mkMat('gameLabel', this.labelTexture, true);
    this.label = CreatePlane('gameLabel', { width: 0.9, height: 0.225 }, scene);
    this.label.material = this.labelMaterial;
    this.label.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.label.isPickable = false;
    this.label.renderingGroupId = 1;
    this.label.setEnabled(false);

    this.toastTexture = new DynamicTexture('gameToastTex', { width: 512, height: 112 }, scene, true);
    this.toastMaterial = mkMat('gameToast', this.toastTexture, true);
    this.toast = CreatePlane('gameToast', { width: 0.6, height: 0.13 }, scene);
    this.toast.material = this.toastMaterial;
    this.toast.isPickable = false;
    this.toast.renderingGroupId = 1;
    this.toast.setEnabled(false);

    this.pointer = scene.onPointerObservable.add(this.onPointer);
  }

  get visible(): boolean {
    return this.panel.isEnabled();
  }

  /** Dónde está el panel (para volver a ponerlo delante si el jugador mira a otro lado). */
  get position(): Vector3 {
    return this.panel.position;
  }

  /** ¿Este pick es del panel? (para que el director no lo trate como "apuntar a algo"). */
  isPanel(mesh: unknown): boolean {
    return mesh === this.panel;
  }

  /**
   * Ubica el panel frente al jugador. `toward` (opcional) es hacia dónde está
   * quien habla: el panel se corre un poco al costado para no taparlo.
   */
  place(head: Vector3, forward: { x: number; z: number }, toward?: { x: number; z: number }): void {
    let fx = forward.x;
    let fz = forward.z;
    if (toward) {
      const dx = toward.x - head.x;
      const dz = toward.z - head.z;
      const d = Math.hypot(dx, dz);
      const fl = Math.hypot(fx, fz) || 1;
      const cos = d > 0 ? (dx * fx + dz * fz) / (d * fl) : 1;
      // Sólo si quien habla está cerca y más o menos adelante: si no, el
      // panel iría a parar fuera de la vista.
      if (d > 0.3 && d < 4.5 && cos > 0.55) {
        // Dirección hacia el personaje, girada 18° a la derecha.
        const a = Math.atan2(dx, dz) + 0.32;
        fx = Math.sin(a);
        fz = Math.cos(a);
      }
    }
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    this.panel.position.set(head.x + fx * DIST, head.y - 0.16, head.z + fz * DIST);
    // CreatePlane muestra su cara hacia −Z: con +Z apuntando lejos del jugador, la cara lo mira.
    this.panel.rotation.set(0.12, Math.atan2(fx, fz), 0);
  }

  show(model: PanelModel, onPick: (i: number) => void): void {
    this.onPick = onPick;
    this.kind = model.kind;
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(12,22,20,0.97)';
    roundRect(ctx, 0, 0, W, H, 28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,193,78,0.55)';
    ctx.lineWidth = 4;
    roundRect(ctx, 3, 3, W - 6, H - 6, 26);
    ctx.stroke();
    this.zones = [];
    switch (model.kind) {
      case 'line':
        this.drawLine(ctx, model.line);
        break;
      case 'activity':
        this.drawActivity(ctx, model.view);
        break;
      case 'card':
        this.header(ctx, model.card.kicker ?? '', model.card.title, '', UI.gold);
        ctx.fillStyle = UI.text;
        ctx.font = `500 34px ${UI.font}`;
        wrapText(ctx, model.card.text, 56, 210, W - 112, 46, 8);
        this.buttons(ctx, ['Cerrar'], H - 120, true);
        break;
      case 'menu':
        this.header(ctx, model.kicker, model.title, '', UI.gold);
        ctx.fillStyle = UI.text;
        ctx.font = `500 32px ${UI.font}`;
        wrapText(ctx, model.text, 56, 210, W - 112, 44, 6);
        this.buttons(ctx, model.buttons, H - 60 - Math.ceil(model.buttons.length / 2) * 92, false, 2);
        break;
    }
    this.texture.update(true);
    this.panel.setEnabled(true);
  }

  hide(): void {
    this.panel.setEnabled(false);
    this.zones = [];
    this.onPick = null;
    this.kind = null;
  }

  /**
   * Clic con el rayo de un control (los botones del visor, sin depender del
   * puntero de Babylon): true si cayó sobre una opción del panel.
   */
  clickRay(ray: Ray): boolean {
    if (!this.visible) return false;
    const pick = ray.intersectsMesh(this.panel);
    if (!pick.hit) return false;
    const zone = this.zoneAt(pick.getTextureCoordinates());
    if (zone) this.fire(zone.index);
    return Boolean(zone);
  }

  /** Con una sola opción (Continuar, Cerrar, Comenzar), cualquier botón la elige sin apuntar. */
  pickSingle(): boolean {
    if (!this.visible || this.zones.length !== 1) return false;
    this.fire(this.zones[0].index);
    return true;
  }

  /**
   * A/X en un diálogo con opciones y sin apuntar: la primera (la que sigue la
   * historia). Con el gatillo sobre un botón se elige cualquiera.
   */
  pickFirstChoice(): boolean {
    if (!this.visible || this.kind !== 'line' || this.zones.length === 0) return false;
    this.fire(this.zones[0].index);
    return true;
  }

  /** B/Y: cierra los carteles informativos (los diálogos y actividades se responden). */
  cancel(): boolean {
    if (!this.visible || this.kind !== 'card' || this.zones.length === 0) return false;
    this.fire(this.zones[0].index);
    return true;
  }

  private fire(index: number): void {
    const now = performance.now();
    if (now - this.lastPickAt < 300) return;
    this.lastPickAt = now;
    this.onPick?.(index);
  }

  private zoneAt(uv: { x: number; y: number } | null): Zone | undefined {
    if (!uv) return undefined;
    // Con invertY (por defecto) la fila 0 del canvas corresponde a v = 1.
    const px = uv.x * W;
    const py = (1 - uv.y) * H;
    return this.zones.find((z) => px >= z.x0 && px <= z.x1 && py >= z.y0 && py <= z.y1);
  }

  // ===================================================================== cartel

  /** Cartel flotante sobre lo apuntado. `null` lo oculta. */
  setLabel(title: string | null, sub = '', at?: { x: number; y: number; z: number }): void {
    if (!title || !at) {
      this.label.setEnabled(false);
      this.labelText = '';
      return;
    }
    this.label.position.set(at.x, at.y, at.z);
    this.label.setEnabled(true);
    const key = `${title}\n${sub}`;
    if (key === this.labelText) return;
    this.labelText = key;
    const ctx = this.labelTexture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(12,22,20,0.88)';
    roundRect(ctx, 4, 4, 504, 120, 22);
    ctx.fill();
    ctx.strokeStyle = UI.gold;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI.gold;
    ctx.font = `700 38px ${UI.font}`;
    ctx.fillText(title, 256, sub ? 46 : 64, 480);
    if (sub) {
      ctx.fillStyle = UI.text;
      ctx.font = `500 26px ${UI.font}`;
      ctx.fillText(sub, 256, 92, 480);
    }
    this.labelTexture.update(true);
  }

  // ====================================================================== aviso

  /** Aviso breve frente a la cara (sello, lugar nuevo…), que se va solo. */
  showToast(head: Vector3, forward: { x: number; z: number }, title: string, text = ''): void {
    const ctx = this.toastTexture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 112);
    ctx.fillStyle = 'rgba(12,22,20,0.9)';
    roundRect(ctx, 4, 4, 504, 104, 50);
    ctx.fill();
    ctx.fillStyle = UI.gold;
    ctx.beginPath();
    ctx.arc(56, 56, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = UI.ink;
    ctx.font = `800 28px ${UI.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('40', 56, 58);
    ctx.textAlign = 'left';
    ctx.fillStyle = UI.text;
    ctx.font = `700 32px ${UI.font}`;
    ctx.fillText(title, 108, text ? 40 : 58, 390);
    if (text) {
      ctx.fillStyle = UI.dim;
      ctx.font = `500 24px ${UI.font}`;
      ctx.fillText(text, 108, 78, 390);
    }
    this.toastTexture.update(true);
    const l = Math.hypot(forward.x, forward.z) || 1;
    const fx = forward.x / l;
    const fz = forward.z / l;
    this.toast.position.set(head.x + fx * 1.4, head.y + 0.32, head.z + fz * 1.4);
    this.toast.rotation.set(-0.15, Math.atan2(fx, fz), 0);
    this.toast.setEnabled(true);
    this.toastLeft = 3.2;
  }

  update(dt: number): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toast.setEnabled(false);
    }
  }

  dispose(): void {
    this.panel.getScene().onPointerObservable.remove(this.pointer);
    for (const m of [this.panel, this.label, this.toast]) m.dispose();
    for (const m of [this.material, this.labelMaterial, this.toastMaterial]) m.dispose();
    for (const t of [this.texture, this.labelTexture, this.toastTexture]) t.dispose();
  }

  // ===================================================================== dibujo

  private header(ctx: CanvasRenderingContext2D, kicker: string, title: string, progress: string, color: string): void {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.font = `700 26px ${UI.font}`;
    ctx.fillText(kicker.toUpperCase(), 56, 74, W - 300);
    ctx.fillStyle = UI.text;
    ctx.font = `700 46px ${UI.font}`;
    ctx.fillText(title, 56, 132, W - 112);
    if (progress) {
      ctx.textAlign = 'right';
      ctx.fillStyle = UI.dim;
      ctx.font = `500 26px ${UI.font}`;
      ctx.fillText(progress, W - 56, 74);
      ctx.textAlign = 'left';
    }
  }

  private drawLine(ctx: CanvasRenderingContext2D, line: LineView): void {
    // Retrato: círculo con las iniciales en el color del personaje.
    ctx.fillStyle = line.color;
    ctx.beginPath();
    ctx.arc(104, 104, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = UI.ink;
    ctx.font = `800 40px ${UI.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      line.speaker
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join(''),
      104,
      106,
    );
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = line.color;
    ctx.font = `750 42px ${UI.font}`;
    ctx.fillText(line.speaker, 180, 96, W - 240);
    ctx.fillStyle = UI.dim;
    ctx.font = `500 26px ${UI.font}`;
    ctx.fillText(line.role, 180, 134, W - 240);
    ctx.fillStyle = UI.text;
    ctx.font = `500 36px ${UI.font}`;
    const lines = line.choices.length > 2 ? 4 : 6;
    wrapText(ctx, line.text, 56, 218, W - 112, 48, lines);
    if (line.choices.length) this.buttons(ctx, line.choices.map((c, i) => `${i + 1}. ${c}`), H - 40 - line.choices.length * 84, false, 1);
    else this.buttons(ctx, ['Continuar'], H - 120, true);
  }

  private drawActivity(ctx: CanvasRenderingContext2D, v: ActivityView): void {
    this.header(ctx, v.kicker, v.title, v.progress ?? '', UI.gold);
    let y = 182;
    ctx.fillStyle = UI.dim;
    ctx.font = `500 28px ${UI.font}`;
    const textX = v.grid ? 360 : 56;
    y = wrapText(ctx, v.text, textX, y, W - textX - 56, 36, 3);
    if (v.grid) drawGrid(ctx, v.grid, 62, 168, 260);
    if (v.sequence?.length) y = drawSequence(ctx, v.sequence, textX, y - 8, W - textX - 56, 58) + 6;
    if (v.feedback?.text) {
      ctx.fillStyle = v.feedback.tone === 'good' ? '#8fe0ad' : v.feedback.tone === 'bad' ? '#ff9c8f' : UI.gold;
      ctx.font = `600 28px ${UI.font}`;
      wrapText(ctx, v.feedback.text, textX, Math.max(y + 8, v.grid ? 380 : y + 8), W - textX - 56, 34, 2);
    }
    const cols = v.choices.length > 4 ? 3 : v.choices.length > 1 ? 2 : 1;
    const rows = Math.ceil(v.choices.length / cols);
    this.choiceGrid(ctx, v, H - 36 - rows * 84, cols);
  }

  private choiceGrid(ctx: CanvasRenderingContext2D, v: ActivityView, top: number, cols: number): void {
    const gap = 14;
    const x0 = 40;
    const bw = (W - x0 * 2 - gap * (cols - 1)) / cols;
    v.choices.forEach((c, i) => {
      const x = x0 + (i % cols) * (bw + gap);
      const y = top + Math.floor(i / cols) * 84;
      const dis = Boolean(c.disabled) || Boolean(v.busy && !c.exit);
      ctx.globalAlpha = dis ? 0.38 : 1;
      ctx.fillStyle = c.tone === 'accent' ? 'rgba(242,193,78,0.3)' : c.tone === 'bad' ? 'rgba(226,87,76,0.25)' : 'rgba(255,255,255,0.08)';
      roundRect(ctx, x, y, bw, 70, 14);
      ctx.fill();
      ctx.strokeStyle = c.tone === 'accent' ? UI.gold : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.stroke();
      let tx = x + 22;
      if (c.icon) {
        drawIcon(ctx, c.icon, x + 40, y + 35, 34, c.tone === 'accent' ? UI.gold : UI.text);
        tx = x + 70;
      }
      ctx.fillStyle = UI.text;
      ctx.font = `600 28px ${UI.font}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(c.label, tx, y + 37, bw - (tx - x) - 14);
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
      if (!dis) this.zones.push({ x0: x, y0: y, x1: x + bw, y1: y + 70, index: i });
    });
  }

  /** Botones apilados (`cols` columnas) desde `top`; `accent` resalta el único botón. */
  private buttons(ctx: CanvasRenderingContext2D, labels: string[], top: number, accent: boolean, cols = 1): void {
    const gap = 14;
    const x0 = accent ? W - 340 : 40;
    const width = accent ? 300 : W - 80;
    const bw = (width - gap * (cols - 1)) / cols;
    labels.forEach((label, i) => {
      const x = x0 + (i % cols) * (bw + gap);
      const y = top + Math.floor(i / cols) * 84;
      ctx.fillStyle = accent || (cols > 1 && i === 0) ? 'rgba(242,193,78,0.3)' : 'rgba(255,255,255,0.08)';
      roundRect(ctx, x, y, bw, 70, 14);
      ctx.fill();
      ctx.strokeStyle = accent || (cols > 1 && i === 0) ? UI.gold : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = UI.text;
      ctx.font = `600 30px ${UI.font}`;
      ctx.textAlign = accent ? 'center' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, accent ? x + bw / 2 : x + 24, y + 37, bw - 40);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      this.zones.push({ x0: x, y0: y, x1: x + bw, y1: y + 70, index: i });
    });
  }

  private onPointer = (info: PointerInfo): void => {
    if (info.type !== PointerEventTypes.POINTERDOWN || !this.visible) return;
    const pick = info.pickInfo;
    if (!pick?.hit || pick.pickedMesh !== this.panel) return;
    const zone = this.zoneAt(pick.getTextureCoordinates());
    if (zone) this.fire(zone.index);
  };
}
