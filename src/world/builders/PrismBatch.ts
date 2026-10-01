import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

type V2 = readonly [number, number];
type V3 = [number, number, number];

interface Group {
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

/**
 * Prismas de base poligonal, agrupados en UNA malla por material.
 *
 * La granja de instancias sólo sabe de cajas, cilindros y conos; la planta de
 * la escuela tiene dos diagonales (Miguel Cané y la medianera del fondo) que
 * cortan pisos, losas y volúmenes. Esas piezas se extruyen acá desde el
 * polígono exacto del plano. Todas las del mismo material comparten malla: el
 * coste es un draw call por material, no por pieza.
 */
export class PrismBatch {
  private readonly groups = new Map<Material, Group>();

  /** @param toWorld local (u, v) → mundo (x, z); @param uvScale repeticiones por metro. */
  constructor(
    private readonly toWorld: (u: number, v: number) => { x: number; z: number },
    private readonly uvScale = 0.25,
  ) {}

  /**
   * Prisma vertical: polígono en planta (u, v) entre `y0` e `y1`.
   * `top`/`bottom`/`sides` permiten omitir caras que nunca se ven.
   */
  plan(
    mat: Material,
    poly: readonly V2[],
    y0: number,
    y1: number,
    faces: { top?: boolean; bottom?: boolean; sides?: boolean } = {},
  ): void {
    const g = this.group(mat);
    const pts = poly.map(([u, v]) => {
      const w = this.toWorld(u, v);
      return [w.x, w.z] as const;
    });
    const tris = triangulate(pts);
    const s = this.uvScale;
    if (faces.top !== false) {
      for (const [a, b, c] of tris) {
        this.tri(g, [pts[a][0], y1, pts[a][1]], [pts[b][0], y1, pts[b][1]], [pts[c][0], y1, pts[c][1]], [0, 1, 0], (p) => [
          p[0] * s,
          p[2] * s,
        ]);
      }
    }
    if (faces.bottom !== false) {
      for (const [a, b, c] of tris) {
        this.tri(g, [pts[a][0], y0, pts[a][1]], [pts[b][0], y0, pts[b][1]], [pts[c][0], y0, pts[c][1]], [0, -1, 0], (p) => [
          p[0] * s,
          p[2] * s,
        ]);
      }
    }
    if (faces.sides === false) return;
    const ccw = signedArea(pts) > 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      // Normal exterior de la arista según la orientación del polígono.
      const nx = (ccw ? dz : -dz) / len;
      const nz = (ccw ? -dx : dx) / len;
      const uvOf = (pt: V3): [number, number] => {
        const along = ((pt[0] - p[0]) * dx + (pt[2] - p[1]) * dz) / len;
        return [along * s, pt[1] * s];
      };
      const a: V3 = [p[0], y0, p[1]];
      const b: V3 = [q[0], y0, q[1]];
      const c: V3 = [q[0], y1, q[1]];
      const d: V3 = [p[0], y1, p[1]];
      this.tri(g, a, b, c, [nx, 0, nz], uvOf);
      this.tri(g, a, c, d, [nx, 0, nz], uvOf);
    }
  }

  /**
   * Prisma a lo largo de u: polígono en el plano vertical (v, y), extruido
   * entre `u0` y `u1`. Sirve para los tímpanos curvos del gimnasio.
   */
  alongU(mat: Material, poly: readonly V2[], u0: number, u1: number): void {
    const g = this.group(mat);
    const tris = triangulate(poly);
    const s = this.uvScale;
    const at = (u: number, [v, y]: V2): V3 => {
      const w = this.toWorld(u, v);
      return [w.x, y, w.z];
    };
    // La cara de u1 mira hacia donde crece u, sea +x o −x en el mundo.
    const sx = Math.sign(this.toWorld(1, 0).x - this.toWorld(0, 0).x) || 1;
    const uvOf = (p: V3): [number, number] => [p[2] * s, p[1] * s];
    for (const [a, b, c] of tris) {
      this.tri(g, at(u1, poly[a]), at(u1, poly[b]), at(u1, poly[c]), [sx, 0, 0], uvOf);
      this.tri(g, at(u0, poly[a]), at(u0, poly[b]), at(u0, poly[c]), [-sx, 0, 0], uvOf);
    }
  }

  /** Crea una malla por material. Devuelve las mallas para sombras y precompilado. */
  build(scene: Scene, name: string): Mesh[] {
    const out: Mesh[] = [];
    let i = 0;
    for (const [mat, g] of this.groups) {
      if (g.idx.length === 0) continue;
      const mesh = new Mesh(`${name}-${i++}`, scene);
      const vd = new VertexData();
      vd.positions = g.pos;
      vd.normals = g.nrm;
      vd.uvs = g.uv;
      vd.indices = g.idx;
      vd.applyToMesh(mesh, false);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      out.push(mesh);
    }
    this.groups.clear();
    return out;
  }

  private group(mat: Material): Group {
    let g = this.groups.get(mat);
    if (!g) {
      g = { pos: [], nrm: [], uv: [], idx: [] };
      this.groups.set(mat, g);
    }
    return g;
  }

  /**
   * Triángulo con la normal pedida. Babylon toma como cara frontal la que
   * cumple (a−b)×(c−b) · n > 0 (es la convención de `ComputeNormals`); si el
   * orden llega al revés se invierte, así ningún llamador tiene que pensarlo.
   */
  private tri(g: Group, a: V3, b: V3, c: V3, n: V3, uvOf: (p: V3) => [number, number]): void {
    const abx = a[0] - b[0];
    const aby = a[1] - b[1];
    const abz = a[2] - b[2];
    const cbx = c[0] - b[0];
    const cby = c[1] - b[1];
    const cbz = c[2] - b[2];
    const fx = aby * cbz - abz * cby;
    const fy = abz * cbx - abx * cbz;
    const fz = abx * cby - aby * cbx;
    const flip = fx * n[0] + fy * n[1] + fz * n[2] < 0;
    const base = g.pos.length / 3;
    for (const p of flip ? [a, c, b] : [a, b, c]) {
      g.pos.push(p[0], p[1], p[2]);
      g.nrm.push(n[0], n[1], n[2]);
      const [tu, tv] = uvOf(p);
      g.uv.push(tu, tv);
    }
    g.idx.push(base, base + 1, base + 2);
  }
}

function signedArea(pts: readonly V2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  }
  return a / 2;
}

/**
 * Triangulación por recorte de orejas. Los polígonos del plano tienen pocos
 * vértices (≤ 10), así que el coste cuadrático no importa y a cambio acepta
 * polígonos cóncavos como el hall o el patio este.
 */
export function triangulate(pts: readonly V2[]): Array<[number, number, number]> {
  const n = pts.length;
  if (n < 3) return [];
  const isCCW = signedArea(pts) > 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: Array<[number, number, number]> = [];
  const cross = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  // Estrictamente dentro: un vértice colineal sobre el borde no invalida la oreja.
  const inside = (p: V2, a: V2, b: V2, c: V2) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    return (d1 > 1e-9 && d2 > 1e-9 && d3 > 1e-9) || (d1 < -1e-9 && d2 < -1e-9 && d3 < -1e-9);
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 500) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const c = cross(pts[ia], pts[ib], pts[ic]);
      // Sólo vértices convexos según la orientación del polígono.
      if (isCCW ? c <= 1e-9 : c >= -1e-9) continue;
      let ear = true;
      for (const k of idx) {
        if (k === ia || k === ib || k === ic) continue;
        if (inside(pts[k], pts[ia], pts[ib], pts[ic])) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Sólo quedan vértices colineales: se descarta uno y se sigue.
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/**
 * Desplaza un polígono simple hacia afuera `d` metros (unión a inglete).
 * Lo usan los volúmenes altos para cubrir el medio espesor del muro de abajo.
 */
export function offsetPolygon(poly: readonly V2[], d: number): V2[] {
  const n = poly.length;
  const isCCW = signedArea(poly) > 0;
  // Normal exterior de una arista de dirección (x, z).
  const outward = (x: number, z: number): V2 => {
    const l = Math.hypot(x, z) || 1;
    return isCCW ? [z / l, -x / l] : [-z / l, x / l];
  };
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i + n - 1) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const n1 = outward(p1[0] - p0[0], p1[1] - p0[1]);
    const n2 = outward(p2[0] - p1[0], p2[1] - p1[1]);
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    if (k < 0.2) {
      out.push([p1[0] + n2[0] * d, p1[1] + n2[1] * d]);
    } else {
      out.push([p1[0] + ((n1[0] + n2[0]) / k) * d, p1[1] + ((n1[1] + n2[1]) / k) * d]);
    }
  }
  return out;
}

export function polygonArea(poly: readonly V2[]): number {
  return signedArea(poly);
}

/** Rectángulo alineado en planta (u, v). */
export interface HoleRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * Polígono simple menos rectángulos alineados: los huecos de escalera de una
 * losa. Se corta en franjas de v constante en cada vértice y en cada borde de
 * hueco, y cada franja en trapecios; los lados de un trapecio son aristas del
 * polígono (pueden ir en diagonal, como Miguel Cané) o bordes del hueco. Sin
 * huecos que lo toquen devuelve el polígono tal cual, sin partir.
 */
export function subtractRects(poly: readonly V2[], holes: readonly HoleRect[]): V2[][] {
  let pu0 = Infinity;
  let pu1 = -Infinity;
  let pv0 = Infinity;
  let pv1 = -Infinity;
  for (const [u, v] of poly) {
    pu0 = Math.min(pu0, u);
    pu1 = Math.max(pu1, u);
    pv0 = Math.min(pv0, v);
    pv1 = Math.max(pv1, v);
  }
  const hs = holes.filter((h) => h.u0 < pu1 && h.u1 > pu0 && h.v0 < pv1 && h.v1 > pv0);
  if (hs.length === 0) return [poly.slice()];
  const cuts = new Set<number>();
  for (const [, v] of poly) cuts.add(v);
  for (const h of hs) {
    if (h.v0 > pv0 && h.v0 < pv1) cuts.add(h.v0);
    if (h.v1 > pv0 && h.v1 < pv1) cuts.add(h.v1);
  }
  const ys = [...cuts].sort((a, b) => a - b);
  const out: V2[][] = [];
  const n = poly.length;
  for (let k = 0; k < ys.length - 1; k++) {
    const va = ys[k];
    const vb = ys[k + 1];
    if (vb - va < 1e-6) continue;
    const vm = (va + vb) / 2;
    // Aristas que cruzan la franja: entre dos cortes consecutivos no hay
    // vértices, así que cada una la atraviesa entera.
    const xs: Array<{ a: number; b: number; m: number }> = [];
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      if ((p[1] - vm) * (q[1] - vm) >= 0) continue;
      const at = (v: number) => p[0] + ((q[0] - p[0]) * (v - p[1])) / (q[1] - p[1]);
      xs.push({ a: at(va), b: at(vb), m: at(vm) });
    }
    xs.sort((x, y) => x.m - y.m);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // Intervalo interior [L, R]; los huecos que cubren la franja lo parten.
      let pieces: Array<[{ a: number; b: number; m: number }, { a: number; b: number; m: number }]> = [[xs[i], xs[i + 1]]];
      for (const h of hs) {
        if (h.v0 > va + 1e-9 || h.v1 < vb - 1e-9) continue;
        const next: typeof pieces = [];
        for (const [L, R] of pieces) {
          if (h.u1 <= L.m || h.u0 >= R.m) {
            next.push([L, R]);
            continue;
          }
          if (h.u0 > L.m) next.push([L, { a: h.u0, b: h.u0, m: h.u0 }]);
          if (h.u1 < R.m) next.push([{ a: h.u1, b: h.u1, m: h.u1 }, R]);
        }
        pieces = next;
      }
      for (const [L, R] of pieces) {
        const quad: V2[] = [];
        const push = (p: V2) => {
          const last = quad[quad.length - 1];
          if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) quad.push(p);
        };
        push([L.a, va]);
        push([R.a, va]);
        push([R.b, vb]);
        push([L.b, vb]);
        const first = quad[0];
        const last = quad[quad.length - 1];
        if (quad.length > 1 && Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) quad.pop();
        if (quad.length >= 3) out.push(quad);
      }
    }
  }
  return out;
}
