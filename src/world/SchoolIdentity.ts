import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { COURT, FLAG, SCHOOL, toWorld, type SchoolFrame } from './SchoolLayout';

/** Tamaño del atlas: todas las superficies pintadas del campus en una textura. */
const ATLAS = 1024;

/** Regiones del atlas, en píxeles del canvas: [x0, y0, x1, y1]. */
const R = {
  sign: [0, 0, 1024, 256],
  court: [0, 264, 560, 624],
  totem: [572, 264, 764, 694],
  flag: [776, 264, 1016, 417],
  clock: [776, 430, 904, 558],
  mural: [0, 636, 560, 860],
} as const;

type Region = readonly [number, number, number, number];

/**
 * Señalética y superficies pintadas del campus CIMDIP & Miguel Cané.
 *
 * Cartel institucional, reloj, tótem de ingreso, bandera argentina, cancha
 * demarcada y mural del patio comparten UNA textura (un atlas dibujado en
 * canvas al cargar) y UNA malla. Seis elementos de identidad cuestan un solo
 * draw call, que en VR es lo que importa.
 *
 * Es una reconstrucción artística: no pretende replicar la fachada real, sino
 * que la escuela se reconozca de inmediato por su nombre y sus símbolos.
 */
export class SchoolIdentity {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;

  constructor(scene: Scene, frame: SchoolFrame) {
    this.texture = new DynamicTexture('schoolAtlas', { width: ATLAS, height: ATLAS }, scene, true);
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    drawAtlas(ctx);
    this.texture.update(true);
    this.texture.anisotropicFilteringLevel = 8;

    this.material = new StandardMaterial('schoolIdentity', scene);
    this.material.diffuseTexture = this.texture;
    this.material.diffuseColor = new Color3(0.5, 0.5, 0.5);
    this.material.specularColor = Color3.Black();
    // Luz propia moderada: el cartel se lee aunque la fachada quede en sombra.
    this.material.emissiveColor = new Color3(0.3, 0.3, 0.3);
    // La bandera se ve de los dos lados.
    this.material.backFaceCulling = false;

    const S = SCHOOL;
    const q = new QuadBatch(frame);
    const panelFront = S.frontV - 0.37;
    q.vertical(0, panelFront, 5.6, 6.1, 1.52, -1, R.sign);
    q.vertical(0, panelFront, 8.95, 1.35, 1.35, -1, R.clock);
    // Tótem: el cartel en las dos caras.
    const tv = S.fenceV + 0.95;
    q.vertical(-5.9, tv - 0.22, 1.72, 1.3, 2.9, -1, R.totem);
    q.vertical(-5.9, tv + 0.22, 1.72, 1.3, 2.9, 1, R.totem);
    // Bandera izada, pegada al mástil.
    q.vertical(FLAG.u + 0.98, FLAG.v, 9.15, 1.8, 1.14, -1, R.flag);
    // Cancha pintada sobre el solado del patio.
    q.horizontal(COURT.u0, COURT.v0, COURT.u1, COURT.v1, 0.075, R.court);
    // Mural en la cara del bloque del frente que da al patio.
    q.vertical(-7.1, S.frontBackV + 0.02, 1.85, 6.8, 2.7, 1, R.mural);

    this.mesh = q.toMesh('schoolIdentity', scene);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
  }

  get shadowCasters(): Mesh[] {
    return [this.mesh];
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

// ------------------------------------------------------------------ geometría

/** Acumula quads texturizados en coordenadas locales del campus. */
class QuadBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  constructor(private readonly f: SchoolFrame) {}

  /**
   * Cartel vertical centrado en (u, v) a la altura `y`.
   * `facing` = −1 mira hacia −v (la calle), +1 hacia +v (el patio).
   */
  vertical(u: number, v: number, y: number, w: number, h: number, facing: -1 | 1, r: Region): void {
    // Para quien mira el cartel, "derecha" es +u si mira hacia +v (cartel
    // orientado a −v) y −u en el caso contrario.
    const right = -facing;
    const hw = w / 2;
    const hh = h / 2;
    const bl: L = [u - right * hw, y - hh, v];
    const br: L = [u + right * hw, y - hh, v];
    const tr: L = [u + right * hw, y + hh, v];
    const tl: L = [u - right * hw, y + hh, v];
    this.push([bl, br, tr, tl], [0, 0, facing], r);
  }

  /** Superficie horizontal (cancha), vista desde arriba con +v "hacia arriba". */
  horizontal(u0: number, v0: number, u1: number, v1: number, y: number, r: Region): void {
    this.push(
      [
        [u0, y, v0],
        [u1, y, v0],
        [u1, y, v1],
        [u0, y, v1],
      ],
      [0, 1, 0],
      r,
    );
  }

  private push(c: [L, L, L, L], nLocal: [number, number, number], r: Region): void {
    const base = this.positions.length / 3;
    const n = this.world(nLocal[0], nLocal[2]);
    const nx = n.x - this.f.cx;
    const nz = n.z - this.f.cz;
    for (const p of c) {
      const w = this.world(p[0], p[2]);
      this.positions.push(w.x, p[1], w.z);
      this.normals.push(nx, nLocal[1], nz);
    }
    // Con invertY (el valor por defecto) la fila 0 del canvas es v = 1.
    const u0 = r[0] / ATLAS;
    const u1 = r[2] / ATLAS;
    const vb = 1 - r[3] / ATLAS;
    const vt = 1 - r[1] / ATLAS;
    this.uvs.push(u0, vb, u1, vb, u1, vt, u0, vt);

    // Orden de índices que Babylon considera cara frontal para esta normal:
    // su normal de cara es (a−b)×(c−b).
    const P = (i: number) => this.positions.slice((base + i) * 3, (base + i) * 3 + 3);
    const a = P(0);
    const b = P(1);
    const cc = P(2);
    const fx = (a[1] - b[1]) * (cc[2] - b[2]) - (a[2] - b[2]) * (cc[1] - b[1]);
    const fy = (a[2] - b[2]) * (cc[0] - b[0]) - (a[0] - b[0]) * (cc[2] - b[2]);
    const fz = (a[0] - b[0]) * (cc[1] - b[1]) - (a[1] - b[1]) * (cc[0] - b[0]);
    if (fx * nx + fy * nLocal[1] + fz * nz >= 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  private world(u: number, v: number): { x: number; z: number } {
    return toWorld(this.f, u, v);
  }

  toMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    mesh.freezeWorldMatrix();
    return mesh;
  }
}

type L = [number, number, number];

// -------------------------------------------------------------------- dibujo

const GREEN = '#173b35';
const GREEN_2 = '#1f5147';
const GOLD = '#e0b049';
const CREAM = '#f7f2e8';

function drawAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  drawSign(ctx, R.sign);
  drawCourt(ctx, R.court);
  drawTotem(ctx, R.totem);
  drawFlag(ctx, R.flag);
  drawClock(ctx, R.clock);
  drawMural(ctx, R.mural);
}

/** Emblema: anillo dorado con una hoja y una "C". */
function emblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
  ctx.fill();
  // Hoja: dos arcos.
  ctx.fillStyle = '#7fbf7a';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.2, y - r * 0.18, r * 0.2, r * 0.42, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.font = `700 ${Math.round(r * 1.05)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', x - r * 0.12, y + r * 0.06);
  ctx.restore();
}

function drawSign(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = GREEN;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 8;
  ctx.strokeRect(x0 + 10, y0 + 10, w - 20, h - 20);
  emblem(ctx, x0 + 128, y0 + h / 2, 84);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CREAM;
  ctx.font = '700 84px Arial, Helvetica, sans-serif';
  ctx.fillText('ESCUELA CIMDIP', x0 + 240, y0 + 118);
  ctx.fillStyle = GOLD;
  ctx.font = '700 62px Arial, Helvetica, sans-serif';
  ctx.fillText('MIGUEL CANÉ', x0 + 244, y0 + 196);
  ctx.fillStyle = '#b7d4ca';
  ctx.font = '400 30px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('QUILMES OESTE', x1 - 40, y0 + 196);
}

function drawCourt(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  // Borde exterior verde y campo azul petróleo.
  ctx.fillStyle = '#3f7a5c';
  ctx.fillRect(x0, y0, w, h);
  const m = 16;
  ctx.fillStyle = '#3d7f8f';
  ctx.fillRect(x0 + m, y0 + m, w - m * 2, h - m * 2);
  // Zonas pintadas bajo los aros.
  ctx.fillStyle = '#c8643b';
  const keyW = w * 0.2;
  const keyH = h * 0.34;
  ctx.fillRect(x0 + m, y0 + h / 2 - keyH / 2, keyW, keyH);
  ctx.fillRect(x1 - m - keyW, y0 + h / 2 - keyH / 2, keyW, keyH);
  ctx.strokeStyle = '#f4f2ee';
  ctx.lineWidth = 5;
  ctx.strokeRect(x0 + m, y0 + m, w - m * 2, h - m * 2);
  ctx.strokeRect(x0 + m, y0 + h / 2 - keyH / 2, keyW, keyH);
  ctx.strokeRect(x1 - m - keyW, y0 + h / 2 - keyH / 2, keyW, keyH);
  ctx.beginPath();
  ctx.moveTo(x0 + w / 2, y0 + m);
  ctx.lineTo(x0 + w / 2, y1 - m);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x0 + w / 2, y0 + h / 2, h * 0.14, 0, Math.PI * 2);
  ctx.stroke();
  // Líneas de triple.
  for (const [cx, a0, a1] of [
    [x0 + m, -Math.PI / 2, Math.PI / 2],
    [x1 - m, Math.PI / 2, Math.PI * 1.5],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, y0 + h / 2, h * 0.36, a0, a1);
    ctx.stroke();
  }
  // Emblema en el círculo central.
  emblem(ctx, x0 + w / 2, y0 + h / 2, h * 0.1);
}

function drawTotem(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = GREEN_2;
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x0, y0, w, 10);
  ctx.fillRect(x0, y1 - 10, w, 10);
  emblem(ctx, x0 + w / 2, y0 + 86, 58);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CREAM;
  ctx.font = '700 44px Arial, Helvetica, sans-serif';
  ctx.fillText('CIMDIP', x0 + w / 2, y0 + 200);
  ctx.fillStyle = GOLD;
  ctx.font = '700 30px Arial, Helvetica, sans-serif';
  ctx.fillText('&', x0 + w / 2, y0 + 240);
  ctx.fillStyle = CREAM;
  ctx.font = '700 34px Arial, Helvetica, sans-serif';
  ctx.fillText('MIGUEL', x0 + w / 2, y0 + 284);
  ctx.fillText('CANÉ', x0 + w / 2, y0 + 322);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x0 + 40, y0 + 346, w - 80, 3);
  ctx.fillStyle = '#b7d4ca';
  ctx.font = '400 22px Arial, Helvetica, sans-serif';
  ctx.fillText('Bienvenidos', x0 + w / 2, y0 + 386);
}

function drawFlag(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#74acdf';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0, y0 + h / 3, w, h / 3);
  // Sol de Mayo.
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  ctx.fillStyle = '#f6b40e';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(3, 0);
    ctx.lineTo(0, i % 2 ? 19 : 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#85340a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawClock(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1] = r;
  const s = x1 - x0;
  const cx = x0 + s / 2;
  const cy = y0 + s / 2;
  ctx.fillStyle = GREEN;
  ctx.fillRect(x0, y0, s, s);
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2d2f33';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.lineWidth = i % 3 === 0 ? 5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * s * 0.33, cy - Math.cos(a) * s * 0.33);
    ctx.lineTo(cx + Math.sin(a) * s * 0.4, cy - Math.cos(a) * s * 0.4);
    ctx.stroke();
  }
  // 10:10, la hora de las fotos de relojes.
  const hand = (a: number, len: number, width: number) => {
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
    ctx.stroke();
  };
  hand(((10 + 10 / 60) / 12) * Math.PI * 2, s * 0.22, 6);
  hand((10 / 60) * Math.PI * 2, s * 0.34, 4);
}

function drawMural(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#f3e9d4';
  ctx.fillRect(x0, y0, w, h);
  // Formas grandes y planas: sol, colinas, hojas, engranaje. Lectura de lejos.
  const colors = ['#3d7f8f', '#e0b049', '#c8643b', '#4f9b69', '#8c6bb0', '#1f5147'];
  ctx.fillStyle = colors[1];
  ctx.beginPath();
  ctx.arc(x0 + w * 0.82, y0 + h * 0.3, h * 0.22, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = colors[(i * 2 + 3) % colors.length];
    ctx.beginPath();
    ctx.ellipse(x0 + w * (0.1 + i * 0.26), y1, w * 0.2, h * (0.42 + (i % 2) * 0.16), 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = colors[0];
  for (let i = 0; i < 7; i++) {
    ctx.save();
    ctx.translate(x0 + w * 0.08 + i * w * 0.1, y0 + h * 0.28 + Math.sin(i) * 10);
    ctx.rotate(0.5 + i * 0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = GREEN;
  ctx.font = '700 38px Arial, Helvetica, sans-serif';
  ctx.fillText('APRENDER · CREAR · CUIDAR', x0 + w / 2, y0 + h * 0.62);
}
