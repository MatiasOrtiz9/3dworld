import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { LEVEL_Y, toWorld, type Item, type SchoolFrame } from '../../world/SchoolLayout';
import { faceVector } from '../story/anchors';

/**
 * Pantallas que se encienden: el televisor del comedor y la pizarra del aula
 * de primaria con el proyector. Comparten UNA textura dinámica (un atlas de
 * dos franjas) y UNA malla con un quad por pantalla: un solo draw call.
 * Encender o cambiar lo que muestran es redibujar su franja del canvas.
 */

export type ScreenId = 'tele' | 'pizarra';

const W = 1024;
const H = 1024;
/** Franja de cada pantalla en el atlas: x0, y0, x1, y1 (px). */
const TILE: Record<ScreenId, readonly [number, number, number, number]> = {
  pizarra: [0, 0, 1024, 500],
  tele: [0, 512, 1024, 1024],
};

export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export interface ScreenSpec {
  id: ScreenId;
  item: Item;
  level: number;
  /** Alto del centro de la pantalla sobre el piso, y su tamaño (m). */
  y: number;
  width: number;
  height: number;
  /** Espesor del objeto (su frente está a la mitad) y separación hacia afuera (m). */
  depth: number;
  out: number;
}

export class Screens {
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private readonly mesh: Mesh;
  private readonly on = new Set<ScreenId>();
  private dirty = false;

  constructor(scene: Scene, frame: SchoolFrame, specs: readonly ScreenSpec[]) {
    this.texture = new DynamicTexture('game-screens', { width: W, height: H }, scene, true);
    this.texture.hasAlpha = false;
    this.material = new StandardMaterial('game-screens', scene);
    this.material.diffuseTexture = this.texture;
    // Sin iluminación: una pantalla encendida emite su propia luz.
    this.material.disableLighting = true;
    this.material.emissiveColor = Color3.White();
    this.material.specularColor = Color3.Black();
    this.material.fogEnabled = false;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const s of specs) {
      const [fu, fv] = faceVector(s.item.face);
      // Frente del objeto + separación.
      const cu = s.item.u + fu * (s.depth / 2 + s.out);
      const cv = s.item.v + fv * (s.depth / 2 + s.out);
      const c = toWorld(frame, cu, cv);
      const o = toWorld(frame, 0, 0);
      const n = toWorld(frame, fu, fv);
      const nx = n.x - o.x;
      const nz = n.z - o.z;
      // Derecha de quien mira la pantalla de frente.
      const rx = -nz;
      const rz = nx;
      const y = LEVEL_Y[s.level as 0 | 1 | 2] + s.y;
      const hw = s.width / 2;
      const hh = s.height / 2;
      const base = positions.length / 3;
      const corners = [
        [c.x - rx * hw, y - hh, c.z - rz * hw],
        [c.x + rx * hw, y - hh, c.z + rz * hw],
        [c.x + rx * hw, y + hh, c.z + rz * hw],
        [c.x - rx * hw, y + hh, c.z - rz * hw],
      ];
      for (const p of corners) {
        positions.push(p[0], p[1], p[2]);
        normals.push(nx, 0, nz);
      }
      const [x0, y0, x1, y1] = TILE[s.id];
      // Con invertY la fila 0 del canvas es v = 1.
      uvs.push(x0 / W, 1 - y1 / H, x1 / W, 1 - y1 / H, x1 / W, 1 - y0 / H, x0 / W, 1 - y0 / H);
      // Orden de índices de cara frontal para esta normal (ver SchoolIdentity.QuadBatch).
      const a = corners[0];
      const b = corners[1];
      const cc = corners[2];
      const fx = (a[1] - b[1]) * (cc[2] - b[2]) - (a[2] - b[2]) * (cc[1] - b[1]);
      const fz = (a[0] - b[0]) * (cc[1] - b[1]) - (a[1] - b[1]) * (cc[0] - b[0]);
      if (fx * nx + fz * nz >= 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      this.paintOff(s.id);
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    this.mesh = new Mesh('game-screens', scene);
    vd.applyToMesh(this.mesh, false);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.freezeWorldMatrix();
    this.texture.update(true);
  }

  isOn(id: ScreenId): boolean {
    return this.on.has(id);
  }

  /** Dibuja el contenido de una pantalla (y la deja encendida). */
  paint(id: ScreenId, painter: Painter): void {
    this.on.add(id);
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    const [x0, y0, x1, y1] = TILE[id];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.translate(x0, y0);
    painter(ctx, x1 - x0, y1 - y0);
    ctx.restore();
    this.dirty = true;
  }

  /** Pantalla apagada: el televisor negro con reflejo, la pizarra blanca. */
  private paintOff(id: ScreenId): void {
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    const [x0, y0, x1, y1] = TILE[id];
    if (id === 'tele') {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, '#16191d');
      g.addColorStop(0.55, '#0b0d10');
      g.addColorStop(1, '#14171b');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = '#e6e8e3';
    }
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    this.dirty = true;
  }

  off(id: ScreenId): void {
    this.on.delete(id);
    this.paintOff(id);
  }

  /** Sube el atlas si algo cambió (una vez por cuadro como mucho). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.texture.update(true);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
