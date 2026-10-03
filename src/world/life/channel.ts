/**
 * Un lote de thin instances que se reescribe cada cuadro: matrices (y color)
 * compactadas al principio del buffer y `thinInstanceCount` = las que se
 * dibujan. Sin instancias, la malla se apaga y no cuesta draw call.
 *
 * Igual que la gente (HANDOFF 23): el volumen envolvente de instancias que se
 * mueven cada cuadro no se puede mantener barato, así que la malla es
 * `alwaysSelectAsActiveMesh` y el recorte se hace a mano antes de escribir.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { GeoKit } from './geoKit';

export class Channel {
  readonly mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array | null;
  n = 0;
  /** Las primeras `fixed` instancias no cambian (postes, semáforos): no se reescriben. */
  fixed = 0;

  constructor(
    scene: Scene,
    name: string,
    kit: GeoKit | Mesh,
    material: Material,
    readonly cap: number,
    colored: boolean,
  ) {
    let mesh: Mesh;
    if (kit instanceof Mesh) mesh = kit;
    else {
      mesh = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = kit.positions;
      vd.normals = kit.normals;
      vd.colors = kit.colors;
      vd.indices = kit.indices;
      vd.applyToMesh(mesh, false);
      // El alfa del vértice es rugosidad, no transparencia (ver lifeMaterials).
      mesh.hasVertexAlpha = false;
    }
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.freezeWorldMatrix();
    this.matrices = new Float32Array(cap * 16);
    this.colors = colored ? new Float32Array(cap * 4) : null;
    // Los buffers van ANTES del primer cuadro: el material compila sus
    // defines (color por instancia) la primera vez que se dibuja, y con
    // `blockMaterialDirtyMechanism` no se vuelve a enterar.
    mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    if (this.colors) mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    this.mesh = mesh;
  }

  /** Empieza un cuadro: conserva las fijas. */
  begin(): void {
    this.n = this.fixed;
  }

  /** Reserva la próxima instancia; devuelve su índice o −1 si no hay lugar. */
  next(): number {
    return this.n < this.cap ? this.n++ : -1;
  }

  color(i: number, r: number, g: number, b: number): void {
    const c = this.colors;
    if (!c) return;
    const o = i * 4;
    c[o] = r;
    c[o + 1] = g;
    c[o + 2] = b;
    c[o + 3] = 1;
  }

  flush(): void {
    const visible = this.n > 0;
    this.mesh.isVisible = visible;
    if (!visible) return;
    this.mesh.thinInstanceCount = this.n;
    this.mesh.thinInstanceBufferUpdated('matrix');
    if (this.colors) this.mesh.thinInstanceBufferUpdated('color');
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

/** Base ortonormal escrita en un buffer de matrices de Babylon (filas: X·sx, Y·sy, Z·sz, posición). */
export function writeBasis(
  m: Float32Array,
  i: number,
  px: number,
  py: number,
  pz: number,
  xx: number,
  xy: number,
  xz: number,
  yx: number,
  yy: number,
  yz: number,
  zx: number,
  zy: number,
  zz: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const o = i * 16;
  m[o] = xx * sx;
  m[o + 1] = xy * sx;
  m[o + 2] = xz * sx;
  m[o + 3] = 0;
  m[o + 4] = yx * sy;
  m[o + 5] = yy * sy;
  m[o + 6] = yz * sy;
  m[o + 7] = 0;
  m[o + 8] = zx * sz;
  m[o + 9] = zy * sz;
  m[o + 10] = zz * sz;
  m[o + 11] = 0;
  m[o + 12] = px;
  m[o + 13] = py;
  m[o + 14] = pz;
  m[o + 15] = 1;
}

/**
 * Marco de un cuerpo: rumbo (yaw), cabeceo (pitch, + trompa arriba) y
 * rolido (roll, + inclinado a la derecha). Rotar θ sobre Y en Babylon lleva
 * +Z a (sin θ, cos θ) y +X a (cos θ, −sin θ) (HANDOFF 18).
 */
export class Frame {
  // ejes en el mundo
  xx = 1;
  xy = 0;
  xz = 0;
  yx = 0;
  yy = 1;
  yz = 0;
  zx = 0;
  zy = 0;
  zz = 1;
  // origen
  ox = 0;
  oy = 0;
  oz = 0;

  set(ox: number, oy: number, oz: number, yaw: number, pitch = 0, roll = 0): this {
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // Rolido sobre Z local.
    const x1x = cr;
    const x1y = -sr;
    const y1x = sr;
    const y1y = cr;
    // Cabeceo sobre X1: Z2 = Z cos p + Y1 sin p ; Y2 = Y1 cos p − Z sin p.
    const y2x = y1x * cp;
    const y2y = y1y * cp;
    const y2z = -sp;
    const z2x = y1x * sp;
    const z2y = y1y * sp;
    const z2z = cp;
    // Rumbo sobre Y del mundo.
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.xx = x1x * c;
    this.xy = x1y;
    this.xz = -x1x * s;
    this.yx = y2x * c + y2z * s;
    this.yy = y2y;
    this.yz = -y2x * s + y2z * c;
    this.zx = z2x * c + z2z * s;
    this.zy = z2y;
    this.zz = -z2x * s + z2z * c;
    return this;
  }

  /** Punto local → mundo. */
  px(x: number, y: number, z: number): number {
    return this.ox + this.xx * x + this.yx * y + this.zx * z;
  }
  py(x: number, y: number, z: number): number {
    return this.oy + this.xy * x + this.yy * y + this.zy * z;
  }
  pz(x: number, y: number, z: number): number {
    return this.oz + this.xz * x + this.yz * y + this.zz * z;
  }

  /** Escribe una pieza alineada al marco, centrada en el punto local (x, y, z). */
  write(
    m: Float32Array,
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    writeBasis(
      m,
      i,
      this.px(x, y, z),
      this.py(x, y, z),
      this.pz(x, y, z),
      this.xx,
      this.xy,
      this.xz,
      this.yx,
      this.yy,
      this.yz,
      this.zx,
      this.zy,
      this.zz,
      sx,
      sy,
      sz,
    );
  }
}
