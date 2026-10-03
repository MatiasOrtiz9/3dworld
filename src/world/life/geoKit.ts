/**
 * Geometría de bajo polígono con color por cara, para los vehículos y los
 * pájaros: cajas, prismas extruidos de un perfil y cilindros, todo con
 * normales planas (cada cara con sus propios vértices) y un color RGBA por
 * cara.
 *
 * Convención del color (la interpreta `VehiclePaintPlugin`):
 *  - alfa = 1: la cara se pinta con el color de la instancia (carrocería,
 *    ropa, plumaje) multiplicado por el RGB del vértice.
 *  - alfa < 1: color fijo (vidrio, goma, plástico) y el alfa es su rugosidad.
 *
 * Datos puros: sólo arma arreglos; `toVertexData` los pasa al motor.
 */
export type RGBA = readonly [number, number, number, number];

/** Pintura: toma el color de la instancia. */
export const PAINT: RGBA = [1, 1, 1, 1];

type V3 = [number, number, number];

export class GeoKit {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  /**
   * Polígono convexo plano. `hint` es hacia dónde mira la cara (afuera): el
   * orden de los puntos se corrige solo, así nadie tiene que pensar en el
   * sentido de giro de Babylon (frente = horario visto desde afuera).
   */
  face(pts: V3[], color: RGBA, hint: V3): void {
    if (pts.length < 3) return;
    let n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    if (dot(n, hint) < 0) {
      pts = pts.slice().reverse();
      n = [-n[0], -n[1], -n[2]];
    }
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const base = this.positions.length / 3;
    for (const p of pts) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(color[0], color[1], color[2], color[3]);
    }
    // Babylon: cara de frente con (B−A)×(C−A) opuesto a la normal.
    for (let i = 1; i + 1 < pts.length; i++) this.indices.push(base, base + i + 1, base + i);
  }

  /** Caja alineada a los ejes, centro y medidas; `skip` omite caras ('-y' = la de abajo, etc.). */
  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    color: RGBA | RGBA[],
    skip = '',
  ): void {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const c = (i: number): RGBA =>
      Array.isArray(color[0]) ? (color as RGBA[])[i] : (color as RGBA);
    if (!skip.includes('+x'))
      this.face(
        [
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
        ],
        c(0),
        [1, 0, 0],
      );
    if (!skip.includes('-x'))
      this.face(
        [
          [x0, y0, z0],
          [x0, y1, z0],
          [x0, y1, z1],
          [x0, y0, z1],
        ],
        c(1),
        [-1, 0, 0],
      );
    if (!skip.includes('+y'))
      this.face(
        [
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        c(2),
        [0, 1, 0],
      );
    if (!skip.includes('-y'))
      this.face(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
        c(3),
        [0, -1, 0],
      );
    if (!skip.includes('+z'))
      this.face(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        c(4),
        [0, 0, 1],
      );
    if (!skip.includes('-z'))
      this.face(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
        c(5),
        [0, 0, -1],
      );
  }

  /**
   * Caja girada sobre el eje X (cabeceo): para horquillas, piernas, caños de
   * bici. `a` en radianes, positivo levanta la punta +z.
   */
  boxPitched(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    a: number,
    color: RGBA,
  ): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const P = (x: number, y: number, z: number): V3 => [
      cx + x,
      cy + y * c + z * s,
      cz - y * s + z * c,
    ];
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const v = [
      P(-hx, -hy, -hz),
      P(hx, -hy, -hz),
      P(hx, hy, -hz),
      P(-hx, hy, -hz),
      P(-hx, -hy, hz),
      P(hx, -hy, hz),
      P(hx, hy, hz),
      P(-hx, hy, hz),
    ];
    const ny: V3 = [0, c, -s];
    const nz: V3 = [0, s, c];
    this.face([v[1], v[2], v[6], v[5]], color, [1, 0, 0]);
    this.face([v[0], v[3], v[7], v[4]], color, [-1, 0, 0]);
    this.face([v[3], v[2], v[6], v[7]], color, ny);
    this.face([v[0], v[1], v[5], v[4]], color, [-ny[0], -ny[1], -ny[2]]);
    this.face([v[4], v[5], v[6], v[7]], color, nz);
    this.face([v[0], v[1], v[2], v[3]], color, [-nz[0], -nz[1], -nz[2]]);
  }

  /**
   * Prisma: un perfil convexo en el plano (z, y) extruido de x0 a x1.
   * `strip(i)` da el color de la cara entre el punto i y el i+1 (null la
   * omite); `cap` el de los dos costados.
   */
  prismX(
    profile: Array<[number, number]>,
    x0: number,
    x1: number,
    strip: (i: number) => RGBA | null,
    cap: RGBA | null,
  ): void {
    const n = profile.length;
    let cz = 0;
    let cy = 0;
    for (const [z, y] of profile) {
      cz += z / n;
      cy += y / n;
    }
    if (cap) {
      this.face(
        profile.map(([z, y]) => [x1, y, z] as V3),
        cap,
        [1, 0, 0],
      );
      this.face(
        profile.map(([z, y]) => [x0, y, z] as V3),
        cap,
        [-1, 0, 0],
      );
    }
    for (let i = 0; i < n; i++) {
      const col = strip(i);
      if (!col) continue;
      const [za, ya] = profile[i];
      const [zb, yb] = profile[(i + 1) % n];
      // Normal hacia afuera del perfil: perpendicular al borde, lejos del centro.
      let nz = yb - ya;
      let ny = -(zb - za);
      if (nz * ((za + zb) / 2 - cz) + ny * ((ya + yb) / 2 - cy) < 0) {
        nz = -nz;
        ny = -ny;
      }
      this.face(
        [
          [x0, ya, za],
          [x1, ya, za],
          [x1, yb, zb],
          [x0, yb, zb],
        ],
        col,
        [0, ny, nz],
      );
    }
  }

  /**
   * Rueda con el eje en X: banda de rodamiento, flanco de goma (anillo) y
   * llanta de rayos que alternan dos tonos (así se ve girar). Sólo la cara
   * +x (la de afuera): la de adentro nunca se ve; las ruedas izquierdas se
   * dibujan giradas media vuelta.
   */
  wheelX(seg: number, rim: number, tread: RGBA, wall: RGBA, spoke: RGBA, gap: RGBA): void {
    const ang = (i: number) => (i / seg) * Math.PI * 2;
    for (let i = 0; i < seg; i++) {
      const a0 = ang(i);
      const a1 = ang(i + 1);
      const am = (a0 + a1) / 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      this.face(
        [
          [-0.5, c0, s0],
          [0.5, c0, s0],
          [0.5, c1, s1],
          [-0.5, c1, s1],
        ],
        tread,
        [0, Math.cos(am), Math.sin(am)],
      );
      this.face(
        [
          [0.5, c0 * rim, s0 * rim],
          [0.5, c0, s0],
          [0.5, c1, s1],
          [0.5, c1 * rim, s1 * rim],
        ],
        wall,
        [1, 0, 0],
      );
      this.face(
        [
          [0.47, 0, 0],
          [0.5, c0 * rim, s0 * rim],
          [0.5, c1 * rim, s1 * rim],
        ],
        i % 2 === 0 ? spoke : gap,
        [1, 0, 0],
      );
    }
  }

  /** Huso de sección poligonal a lo largo de z (cuerpo de pájaro): anillos (z, radio, alto). */
  lathe(
    rings: Array<[number, number, number]>,
    sides: number,
    y0: number,
    color: (ring: number) => RGBA,
  ): void {
    const pt = (ri: number, k: number): V3 => {
      const [z, r, h] = rings[ri];
      const a = (k / sides) * Math.PI * 2;
      return [Math.cos(a) * r, y0 + Math.sin(a) * h, z];
    };
    for (let ri = 0; ri + 1 < rings.length; ri++) {
      for (let k = 0; k < sides; k++) {
        const a = pt(ri, k);
        const b = pt(ri, k + 1);
        const c = pt(ri + 1, k + 1);
        const d = pt(ri + 1, k);
        const mid: V3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - y0, 0];
        const quad =
          Math.hypot(rings[ri][1], rings[ri][2]) > 1e-4 &&
          Math.hypot(rings[ri + 1][1], rings[ri + 1][2]) > 1e-4;
        if (quad) this.face([a, b, c, d], color(ri), mid);
        else if (Math.hypot(rings[ri][1], rings[ri][2]) <= 1e-4)
          this.face([a, c, d], color(ri), mid);
        else this.face([a, b, c], color(ri), mid);
      }
    }
  }

  get triangles(): number {
    return this.indices.length / 3;
  }
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
