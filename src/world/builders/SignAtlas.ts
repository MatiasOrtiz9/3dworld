import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';

/** Un cartel del atlas: texto, fondo y letra. */
export interface SignStyle {
  text: string;
  bg: string;
  fg: string;
  /** Tipografía: 'sans' (palo seco, carteles de calle) o 'serif' (comercios viejos). */
  font?: 'sans' | 'serif' | 'script';
  /** Filete de color alrededor (marquesinas). */
  rule?: string;
}

/** Nomenclatura porteña: chapa azul con letras blancas (como la de Miguel Cané). */
export const STREET_SIGN = { bg: '#1f4f8f', fg: '#ffffff', rule: '#ffffff' } as const;

const COLS = 2;
const ROWS = 24;
const CELL_W = 512;
const CELL_H = 64;

/**
 * Carteles con texto de la calle: nombres de calle y marquesinas de los
 * locales, en UNA textura y UNA malla.
 *
 * Una vereda sin carteles se lee como decorado: el nombre del almacén, de la
 * farmacia, de la calle en la esquina, es lo primero que el ojo busca para
 * saber dónde está. Pintados en un solo lienzo (como el atlas de la escuela)
 * y armados como una sola malla, cuestan un draw call para todo el barrio.
 */
export class SignAtlas {
  private readonly labels = new Map<string, number>();
  private readonly styles: SignStyle[] = [];
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];
  private mesh: Mesh | null = null;
  private material: StandardMaterial | null = null;
  private texture: DynamicTexture | null = null;

  constructor(private readonly scene: Scene) {}

  /** Celda del atlas para ese estilo (se pinta una sola vez). */
  private cell(style: SignStyle): number {
    const key = `${style.text}|${style.bg}|${style.fg}|${style.font ?? 'sans'}|${style.rule ?? ''}`;
    let i = this.labels.get(key);
    if (i === undefined) {
      // Si el atlas se llena, se reutiliza la última celda: nunca se rompe.
      i = Math.min(this.styles.length, COLS * ROWS - 1);
      if (i === this.styles.length) this.styles.push(style);
      this.labels.set(key, i);
    }
    return i;
  }

  /**
   * Cartel plano de `w × h` m centrado en (x, y, z), con la cara hacia (nx, nz).
   * `both`: también por detrás (las chapas de calle se leen de los dos lados).
   */
  plate(style: SignStyle, x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, both = false): void {
    const c = this.cell(style);
    const col = c % COLS;
    const row = Math.floor(c / COLS);
    // Lienzo de arriba hacia abajo; la textura dinámica se sube invertida.
    const W = COLS * CELL_W;
    const H = ROWS * CELL_H;
    const u0 = (col * CELL_W + 2) / W;
    const u1 = ((col + 1) * CELL_W - 2) / W;
    const v1 = 1 - (row * CELL_H + 2) / H;
    const v0 = 1 - ((row + 1) * CELL_H - 2) / H;
    this.quad(x, y, z, w, h, nx, nz, u0, u1, v0, v1);
    if (both) this.quad(x - nx * 0.01, y, z - nz * 0.01, w, h, -nx, -nz, u0, u1, v0, v1);
  }

  private quad(x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, u0: number, u1: number, v0: number, v1: number): void {
    // Derecha de quien mira la cara de frente (mirando hacia −n): arriba × (−n).
    const rx = -nz;
    const rz = nx;
    const hw = w / 2;
    const hh = h / 2;
    const base = this.pos.length / 3;
    const corners: Array<[number, number, number, number, number]> = [
      [x - rx * hw, y - hh, z - rz * hw, u0, v0],
      [x + rx * hw, y - hh, z + rz * hw, u1, v0],
      [x + rx * hw, y + hh, z + rz * hw, u1, v1],
      [x - rx * hw, y + hh, z - rz * hw, u0, v1],
    ];
    for (const [px, py, pz, tu, tv] of corners) {
      this.pos.push(px, py, pz);
      this.nrm.push(nx, 0, nz);
      this.uv.push(tu, tv);
    }
    // Babylon toma como frontal la cara con (a−b)×(c−b)·n > 0 (ver PrismBatch).
    const [a, b, c] = [corners[0], corners[1], corners[2]];
    const abx = a[0] - b[0];
    const aby = a[1] - b[1];
    const abz = a[2] - b[2];
    const cbx = c[0] - b[0];
    const cby = c[1] - b[1];
    const cbz = c[2] - b[2];
    const fx = aby * cbz - abz * cby;
    const fz = abx * cby - aby * cbx;
    if (fx * nx + fz * nz > 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** Pinta el atlas y arma la malla. `owner`: al liberarse, se libera todo. */
  build(owner: Material): Mesh | null {
    if (this.mesh || this.idx.length === 0) return this.mesh;
    const W = COLS * CELL_W;
    const H = ROWS * CELL_H;
    const tex = new DynamicTexture('signAtlas', { width: W, height: H }, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    this.styles.forEach((s, i) => paint(ctx, s, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H));
    tex.update(true);
    tex.anisotropicFilteringLevel = 4;
    tex.wrapU = DynamicTexture.CLAMP_ADDRESSMODE;
    tex.wrapV = DynamicTexture.CLAMP_ADDRESSMODE;

    const mat = new StandardMaterial('signAtlasMat', this.scene);
    mat.diffuseTexture = tex;
    // Un cartel pintado se lee también a la sombra de un toldo: piso de luz
    // propia moderado (como el follaje, ver Materials.foliage) y difuso
    // compensado para el sol calibrado para PBR.
    mat.diffuseColor = new Color3(0.42, 0.42, 0.42);
    mat.emissiveColor = new Color3(0.42, 0.42, 0.42);
    mat.specularColor = new Color3(0.04, 0.04, 0.04);

    const mesh = new Mesh('signAtlasMesh', this.scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.normals = this.nrm;
    vd.uvs = this.uv;
    vd.indices = this.idx;
    vd.applyToMesh(mesh, false);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    // Sin congelar: el post-proceso se arma después y cambia los defines de
    // mapeo tonal de todos los materiales (ver HANDOFF 2).
    this.mesh = mesh;
    this.material = mat;
    this.texture = tex;
    owner.onDisposeObservable.addOnce(() => this.dispose());
    return mesh;
  }

  /** La malla de los carteles (después de `build`). */
  get sourceMesh(): Mesh | null {
    return this.mesh;
  }

  dispose(): void {
    this.mesh?.dispose(false, false);
    this.material?.dispose();
    this.texture?.dispose();
    this.mesh = null;
    this.material = null;
    this.texture = null;
  }
}

const FONTS = {
  sans: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  script: '"Brush Script MT", "Segoe Script", cursive',
} as const;

function paint(ctx: CanvasRenderingContext2D, s: SignStyle, x: number, y: number): void {
  ctx.fillStyle = s.bg;
  ctx.fillRect(x, y, CELL_W, CELL_H);
  if (s.rule) {
    ctx.strokeStyle = s.rule;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 5, y + 5, CELL_W - 10, CELL_H - 10);
  }
  const family = FONTS[s.font ?? 'sans'];
  let size = 44;
  ctx.font = `bold ${size}px ${family}`;
  // Achica la letra hasta que entre en la chapa.
  while (ctx.measureText(s.text).width > CELL_W - 36 && size > 18) {
    size -= 2;
    ctx.font = `bold ${size}px ${family}`;
  }
  ctx.fillStyle = s.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s.text, x + CELL_W / 2, y + CELL_H / 2 + 2);
}
