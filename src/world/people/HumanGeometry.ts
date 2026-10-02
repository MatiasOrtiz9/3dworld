import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

/**
 * Geometría de las personas (reemplaza a `PeopleGeometry` para la escuela).
 *
 * Figura de referencia: adulto de 1,72 m mirando a +Z, con +X a su derecha
 * (las cotas están en `Looks.REF`). Cada pieza se modela UNA vez con el origen
 * en su articulación —cadera, cintura, base del cuello, hombro, codo,
 * rodilla— y cada persona la reutiliza como thin instance con su matriz y su
 * color. El color final es color de vértice (sombreado, ojos, suela,
 * cuadrillé) × color de la instancia (ropa, piel, pelo): UN material para
 * toda la gente.
 *
 * Caras planas a propósito, como el resto del proyecto, pero con más lados
 * donde se mira (cabeza, manos): de cerca, en VR, una cabeza octogonal se lee
 * como un dado. El nivel de detalle baja la cantidad de lados para el visor.
 *
 * Detalles que hacen que una figura se lea como persona y no como muñeco de
 * cajas: cuello, hombros caídos, codos y rodillas articulados, manos con
 * pulgar, zapatos con suela, orejas, nariz, cejas y boca, cuello de la
 * chomba, peinados con la línea del nacimiento del pelo.
 */

type P3 = [number, number, number];

interface Ring {
  pts: P3[];
  cx: number;
  cz: number;
  y: number;
  shade: number;
  capY?: number;
  capShade?: number;
}

/** Acumulador de triángulos con normal plana y sombreado por vértice. */
class Builder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  /** Triángulo orientado lejos de `inside` (ver `PeopleGeometry`). */
  tri(a: P3, b: P3, c: P3, shade: number | [number, number, number], inside: P3, flip = false): void {
    let nx = (a[1] - b[1]) * (c[2] - b[2]) - (a[2] - b[2]) * (c[1] - b[1]);
    let ny = (a[2] - b[2]) * (c[0] - b[0]) - (a[0] - b[0]) * (c[2] - b[2]);
    let nz = (a[0] - b[0]) * (c[1] - b[1]) - (a[1] - b[1]) * (c[0] - b[0]);
    const mx = (a[0] + b[0] + c[0]) / 3 - inside[0];
    const my = (a[1] + b[1] + c[1]) / 3 - inside[1];
    const mz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    let pts: P3[] = [a, b, c];
    let shades = typeof shade === 'number' ? [shade, shade, shade] : shade;
    const outward = nx * mx + ny * my + nz * mz >= 0;
    if (outward === flip) {
      pts = [a, c, b];
      shades = [shades[0], shades[2], shades[1]];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    const base = this.positions.length / 3;
    for (let i = 0; i < 3; i++) {
      const p = pts[i];
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx / len, ny / len, nz / len);
      const s = shades[i];
      this.colors.push(s, s, s, 1);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  quad(a: P3, b: P3, c: P3, d: P3, shade: number, inside: P3, flip = false): void {
    this.tri(a, b, c, shade, inside, flip);
    this.tri(a, c, d, shade, inside, flip);
  }

  /**
   * Sólido "lofteado" entre anillos. `checker` subdivide cada cara en 2×2 con
   * sombreado alternado (el cuadrillé del guardapolvo); `twoSided` agrega la
   * cara interior, más oscura, para prendas abiertas.
   */
  loft(rings: Ring[], capBottom = true, capTop = true, opts: { checker?: boolean; twoSided?: boolean; arc?: [number, number] } = {}): void {
    const n = rings[0].pts.length;
    const closed = !opts.arc;
    const segs = closed ? n : n - 1;
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r];
      const B = rings[r + 1];
      const inside: P3 = [(A.cx + B.cx) / 2, (A.y + B.y) / 2, (A.cz + B.cz) / 2];
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        const a = A.pts[i];
        const b = A.pts[j];
        const c = B.pts[j];
        const d = B.pts[i];
        if (opts.checker) {
          // Cuadrillé: cada cara un tono, alternando como en un tablero.
          const sh = ((i + r) & 1) === 0 ? (A.shade + B.shade) / 2 : ((A.shade + B.shade) / 2) * 0.8;
          this.quad(a, b, c, d, sh, inside);
        } else {
          this.tri(a, b, c, [A.shade, A.shade, B.shade], inside);
          this.tri(a, c, d, [A.shade, B.shade, B.shade], inside);
        }
        if (opts.twoSided) {
          this.tri(a, b, c, A.shade * 0.55, inside, true);
          this.tri(a, c, d, B.shade * 0.55, inside, true);
        }
      }
    }
    if (closed && capBottom) this.cap(rings[0], rings[1]);
    if (closed && capTop) this.cap(rings[rings.length - 1], rings[rings.length - 2]);
  }

  private cap(ring: Ring, neighbour: Ring): void {
    const n = ring.pts.length;
    const center: P3 = [ring.cx, ring.capY ?? ring.y, ring.cz];
    const inside: P3 = [neighbour.cx, neighbour.y, neighbour.cz];
    for (let i = 0; i < n; i++) {
      this.tri(ring.pts[i], ring.pts[(i + 1) % n], center, ring.capShade ?? ring.shade, inside);
    }
  }

  /** Viga de sección rectangular entre dos puntos (mango del lampazo, anteojos). */
  beam(p0: P3, p1: P3, tw: number, th: number, shade: number): void {
    const d: P3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    d[0] /= len;
    d[1] /= len;
    d[2] /= len;
    const ref: P3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(d, ref));
    const v = norm(cross(d, u));
    const corner = (p: P3, su: number, sv: number): P3 => [
      p[0] + u[0] * su * tw / 2 + v[0] * sv * th / 2,
      p[1] + u[1] * su * tw / 2 + v[1] * sv * th / 2,
      p[2] + u[2] * su * tw / 2 + v[2] * sv * th / 2,
    ];
    const signs: Array<[number, number]> = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    const a = signs.map(([su, sv]) => corner(p0, su, sv));
    const b = signs.map(([su, sv]) => corner(p1, su, sv));
    const mid: P3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(a[i], a[j], b[j], b[i], shade, mid);
    }
    this.quad(a[0], a[1], a[2], a[3], shade, mid);
    this.quad(b[0], b[1], b[2], b[3], shade, mid);
  }

  /** Caja alineada (centro y medias medidas). */
  box(c: P3, h: P3, shade: number): void {
    const [x, y, z] = c;
    const [a, b, d] = h;
    const p = (sx: number, sy: number, sz: number): P3 => [x + sx * a, y + sy * b, z + sz * d];
    const faces: Array<[P3, P3, P3, P3]> = [
      [p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)],
      [p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1)],
      [p(1, -1, -1), p(1, -1, 1), p(1, 1, 1), p(1, 1, -1)],
      [p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1)],
      [p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1)],
      [p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1)],
    ];
    for (const f of faces) this.quad(f[0], f[1], f[2], f[3], shade, c);
  }

  toMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.colors = this.colors;
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    return mesh;
  }

  get triangles(): number {
    return this.indices.length / 3;
  }
}

function cross(a: P3, b: P3): P3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: P3): P3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Anillo elíptico de `n` lados a la altura `y`. Con `phase` = π/n una cara
 * plana queda mirando al frente (+Z): ahí van los rasgos de la cara.
 * `yOf` permite inclinarlo (el nacimiento del pelo baja hacia la nuca) y
 * `rOf` deformar el radio (rulos, pliegues).
 */
function ring(
  y: number,
  rx: number,
  rz: number,
  n: number,
  shade: number,
  opts: { cx?: number; cz?: number; phase?: number; yOf?: (x: number, z: number) => number; rOf?: (a: number, i: number) => number; arc?: [number, number] } = {},
): Ring {
  const cx = opts.cx ?? 0;
  const cz = opts.cz ?? 0;
  const ph = opts.phase ?? Math.PI / n;
  const pts: P3[] = [];
  const count = opts.arc ? n + 1 : n;
  for (let i = 0; i < count; i++) {
    const a = opts.arc ? opts.arc[0] + ((opts.arc[1] - opts.arc[0]) * i) / n : ph + (i / n) * Math.PI * 2;
    const k = opts.rOf ? opts.rOf(a, i) : 1;
    // Ángulo 0 = frente (+Z), creciendo hacia +X.
    const x = Math.sin(a) * rx * k;
    const z = Math.cos(a) * rz * k;
    pts.push([cx + x, opts.yOf ? opts.yOf(x, z) : y, cz + z]);
  }
  return { pts, cx, cz, y, shade };
}

export type HumanPart =
  | 'hips'
  | 'torso'
  | 'smock'
  | 'coat'
  | 'trim'
  | 'skirt'
  | 'apron'
  | 'backpack'
  | 'head'
  | 'hairShort'
  | 'hairLong'
  | 'hairBun'
  | 'hairPony'
  | 'hairCurly'
  | 'cap'
  | 'glasses'
  | 'upperArm'
  | 'sleeve'
  | 'forearm'
  | 'hand'
  | 'thigh'
  | 'shin'
  | 'shoe'
  | 'mop';

export const HUMAN_PARTS: readonly HumanPart[] = [
  'hips', 'torso', 'smock', 'coat', 'trim', 'skirt', 'apron', 'backpack', 'head', 'hairShort', 'hairLong', 'hairBun',
  'hairPony', 'hairCurly', 'cap', 'glasses', 'upperArm', 'sleeve', 'forearm', 'hand', 'thigh', 'shin', 'shoe', 'mop',
];

/** Detalle: 1 = escritorio (más lados), 0 = visor. */
export interface GeometryStats {
  triangles: Record<HumanPart, number>;
}

/** Construye las piezas. Se llama una vez por población. */
export function buildHumanParts(scene: Scene, detail: 0 | 1): { meshes: Record<HumanPart, Mesh>; stats: GeometryStats } {
  const meshes = {} as Record<HumanPart, Mesh>;
  const tris = {} as Record<HumanPart, number>;
  const hi = detail === 1;
  const make = (name: HumanPart, fill: (b: Builder) => void) => {
    const b = new Builder();
    fill(b);
    meshes[name] = b.toMesh(`npc-${name}`, scene);
    tris[name] = b.triangles;
  };
  /** Lados: escritorio / visor. */
  const N = (a: number, b: number) => (hi ? a : b);

  // ------------------------------------------------------------------ cuerpo

  // Cadera (origen: centro de las articulaciones de la cadera). El tiro baja
  // entre los muslos y el cinturón marca la cintura.
  make('hips', (b) => {
    const n = N(8, 7);
    // La parte de arriba queda bajo la remera (más angosta que su ruedo): si
    // asomaba, el cinturón se veía atravesando la chomba.
    b.loft([
      ring(-0.1, 0.1, 0.08, n, 0.7),
      ring(0.03, 0.162, 0.104, n, 0.94),
      ring(0.1, 0.146, 0.094, n, 0.8),
      ring(0.14, 0.14, 0.09, n, 0.8),
    ]);
  });

  /** Anillos del tronco (origen: cintura; base del cuello a 0,43). */
  const torsoRings = (n: number, loose = 1): Ring[] => {
    const rings = [
      ring(-0.04, 0.155 * loose, 0.1 * loose, n, 0.84),
      ring(0.1, 0.15 * loose, 0.102 * loose, n, 0.93),
      ring(0.26, 0.174 * loose, 0.112 * loose, n, 1, { cz: 0.004 }),
      ring(0.34, 0.19 * loose, 0.106 * loose, n, 1),
      ring(0.392, 0.165 * loose, 0.088 * loose, n, 0.94, { cz: -0.004 }),
      { ...ring(0.43, 0.068, 0.058, n, 0.9, { cz: -0.006 }), capShade: 0.9 },
    ];
    // Un anillo más en escritorio: el pecho redondeado.
    if (hi) rings.splice(2, 0, ring(0.18, 0.162 * loose, 0.108 * loose, n, 0.98, { cz: 0.002 }));
    return rings;
  };

  /** Cuello de chomba/camisa y tapeta: sombreado sobre el tronco. */
  const collar = (b: Builder, front = 0.11) => {
    const n = N(9, 7);
    b.loft([ring(0.398, 0.078, 0.066, n, 0.82, { cz: -0.004 }), ring(0.448, 0.07, 0.06, n, 0.95, { cz: -0.008 })], false, false);
    // Tapeta en V: dos triángulos un poco más oscuros sobre el pecho.
    b.tri([0, 0.405, front], [-0.032, 0.39, front - 0.002], [0, 0.315, front + 0.003], 0.72, [0, 0.36, 0]);
    b.tri([0, 0.405, front], [0.032, 0.39, front - 0.002], [0, 0.315, front + 0.003], 0.78, [0, 0.36, 0]);
  };

  make('torso', (b) => {
    b.loft(torsoRings(N(10, 8)));
    collar(b);
  });

  // Guardapolvo de jardín a cuadritos: más suelto, hasta medio muslo. El
  // cuadrillé alterna el sombreado cara por cara (sin subdividir: costaba el
  // cuádruple de triángulos y de lejos no se distinguía).
  make('smock', (b) => {
    const n = N(12, 10);
    const rings: Ring[] = [];
    // Bandas angostas parejas: cuadros de ~5 cm en un chico de jardín.
    const ys = hi ? [-0.36, -0.27, -0.18, -0.09, 0, 0.09, 0.18, 0.26, 0.34, 0.392] : [-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.34, 0.392];
    for (const y of ys) {
      const t = (y + 0.36) / 0.75;
      const rx = y < -0.04 ? 0.205 - (0.205 - 0.16) * ((y + 0.36) / 0.32) : y > 0.3 ? (y > 0.37 ? 0.17 : 0.198) : 0.156 + 0.04 * Math.max(0, (y - 0.1) / 0.24);
      const rz = y < -0.04 ? 0.155 - (0.155 - 0.105) * ((y + 0.36) / 0.32) : y > 0.37 ? 0.09 : 0.104 + 0.012 * Math.max(0, (y - 0.1) / 0.24);
      rings.push(ring(y, rx * 1.03, rz * 1.03, n, 0.86 + 0.14 * Math.min(1, t * 1.6)));
    }
    rings.push({ ...ring(0.43, 0.07, 0.06, n, 0.95, { cz: -0.006 }), capShade: 0.95 });
    b.loft(rings, false, true, { checker: true });
    // Cuello redondo claro.
    b.loft([ring(0.395, 0.085, 0.072, N(10, 8), 1.15, { cz: -0.004 }), ring(0.44, 0.075, 0.064, N(10, 8), 1.2, { cz: -0.008 })], false, false);
  });

  // Guardapolvo blanco: tronco con solapas y faldón abierto adelante, hasta la rodilla.
  make('coat', (b) => {
    const n = N(10, 8);
    b.loft(torsoRings(n, 1.035));
    collar(b, 0.115);
    // Solapas: dos franjas un poco más oscuras en V.
    for (const s of [-1, 1]) {
      b.quad([s * 0.012, 0.31, 0.118], [s * 0.065, 0.41, 0.1], [s * 0.09, 0.4, 0.094], [s * 0.03, 0.29, 0.116], 0.82, [0, 0.33, 0]);
    }
    // Botones.
    if (hi) for (let k = 0; k < 3; k++) b.box([0.008, 0.08 + k * 0.08, 0.108], [0.007, 0.007, 0.004], 0.5);
    // Faldón abierto: arco de 290° alrededor de la espalda.
    const arc: [number, number] = [0.42, Math.PI * 2 - 0.42];
    const m = N(10, 7);
    b.loft(
      [ring(-0.04, 0.16, 0.106, m, 0.95, { arc }), ring(-0.52, 0.2, 0.15, m, 0.84, { arc })],
      false,
      false,
      { twoSided: true, arc },
    );
    // Bolsillos.
    for (const s of [-1, 1]) b.quad([s * 0.07, -0.13, 0.135], [s * 0.15, -0.13, 0.112], [s * 0.15, -0.22, 0.12], [s * 0.07, -0.22, 0.142], 0.8, [s * 0.1, -0.17, 0]);
  });

  // Ribete rojo del buzo de secundaria: escote en V, cintura y escudo.
  make('trim', (b) => {
    const n = N(10, 8);
    b.loft([ring(-0.045, 0.158, 0.103, n, 0.95), ring(0.005, 0.153, 0.104, n, 1)], false, false);
    for (const s of [-1, 1]) {
      b.quad([s * 0.004, 0.3, 0.116], [s * 0.07, 0.408, 0.094], [s * 0.084, 0.4, 0.092], [s * 0.016, 0.288, 0.116], 1, [0, 0.33, 0]);
    }
    // Escudo bordado sobre el pecho izquierdo (−X).
    b.quad([-0.105, 0.225, 0.112], [-0.065, 0.225, 0.114], [-0.065, 0.27, 0.114], [-0.105, 0.27, 0.112], 1.1, [-0.085, 0.25, 0]);
  });

  // Pollera tableada: radio alternado da los pliegues.
  make('skirt', (b) => {
    const n = N(14, 10);
    const pleat = (_a: number, i: number) => (i % 2 === 0 ? 1.04 : 0.96);
    b.loft(
      [ring(-0.32, 0.225, 0.18, n, 0.82, { rOf: pleat }), ring(-0.06, 0.19, 0.142, n, 0.95, { rOf: pleat }), ring(0.14, 0.158, 0.104, n, 1)],
      false,
      false,
    );
  });

  // Delantal de la cantina: paño delantero de la cintura a la rodilla.
  make('apron', (b) => {
    const arc: [number, number] = [-1.15, 1.15];
    const m = N(6, 5);
    b.loft([ring(-0.45, 0.2, 0.15, m, 0.86, { arc }), ring(0.12, 0.17, 0.114, m, 1, { arc })], false, false, { twoSided: true, arc });
  });

  // Mochila: cuerpo redondeado, bolsillo y tiras sobre los hombros.
  make('backpack', (b) => {
    const n = N(8, 6);
    const top = ring(0.35, 0.112, 0.058, n, 1, { cz: -0.188 });
    top.capY = 0.372;
    b.loft([ring(0.05, 0.124, 0.07, n, 0.72, { cz: -0.19 }), ring(0.24, 0.134, 0.074, n, 0.92, { cz: -0.196 }), top]);
    // Bolsillo: una caja baja más oscura.
    b.box([0, 0.14, -0.262], [0.085, 0.065, 0.022], 0.64);
    // Tiras: dos franjas por lado sobre el hombro y el pecho.
    for (const s of [-1, 1]) {
      b.quad([s * 0.08, 0.36, -0.13], [s * 0.115, 0.36, -0.13], [s * 0.125, 0.415, -0.01], [s * 0.09, 0.415, -0.01], 0.62, [s * 0.1, 0.3, -0.06]);
      b.quad([s * 0.09, 0.415, -0.01], [s * 0.125, 0.415, -0.01], [s * 0.128, 0.2, 0.116], [s * 0.093, 0.2, 0.116], 0.62, [s * 0.11, 0.3, 0]);
    }
  });

  // ------------------------------------------------------------------ cabeza

  // Cabeza (origen: base del cuello; coronilla a 0,27). Rasgos sobre la cara
  // plana del frente: ojos, cejas, nariz, boca y orejas.
  const n = N(12, 9);
  make('head', (b) => {
    b.loft([ring(-0.01, 0.05, 0.052, N(7, 5), 0.8), ring(0.075, 0.046, 0.049, N(7, 5), 0.88, { cz: 0.004 })], false, false);
    const top = ring(0.245, 0.064, 0.08, n, 0.98, { cz: -0.01 });
    top.capY = 0.272;
    const rings: Ring[] = [
      { ...ring(0.05, 0.05, 0.058, n, 0.78, { cz: 0.022 }), capShade: 0.7 },
      ring(0.095, 0.071, 0.086, n, 0.92, { cz: 0.01 }),
      ring(0.165, 0.082, 0.1, n, 1),
      ring(0.215, 0.08, 0.097, n, 1, { cz: -0.005 }),
      top,
    ];
    if (hi) rings.splice(2, 0, ring(0.13, 0.078, 0.095, n, 0.98, { cz: 0.006 }));
    b.loft(rings);
    // Profundidad de la cara plana del frente a cada altura (interpolada
    // entre los anillos que la forman).
    const c = Math.cos(Math.PI / n);
    const faceZ = (y: number) => {
      if (y <= 0.095) return 0.086 * c + 0.01 + ((y - 0.095) / 0.045) * 0.02;
      if (y <= 0.165) return 0.086 * c + 0.01 + ((y - 0.095) / 0.07) * (0.1 * c - 0.086 * c - 0.01);
      return 0.1 * c + ((y - 0.165) / 0.05) * (0.097 * c - 0.005 - 0.1 * c);
    };
    const inside: P3 = [0, 0.15, 0];
    for (const s of [-1, 1]) {
      // Ojos: oscuros (piel × 0,1), un poco hundidos bajo la ceja.
      const zy = faceZ(0.155) + 0.002;
      b.quad([s * 0.019, 0.147, zy], [s * 0.043, 0.147, zy - 0.004], [s * 0.043, 0.164, zy - 0.004], [s * 0.019, 0.164, zy], 0.1, inside);
      // Brillo en el ojo: un triangulito claro hace que la mirada "viva".
      if (hi) b.tri([s * 0.026, 0.158, zy + 0.0008], [s * 0.031, 0.158, zy + 0.0006], [s * 0.026, 0.161, zy + 0.0008], 1.4, inside);
      // Cejas, inclinadas apenas hacia afuera.
      const zb = faceZ(0.182) + 0.003;
      b.quad([s * 0.016, 0.178, zb], [s * 0.048, 0.175, zb - 0.006], [s * 0.048, 0.182, zb - 0.006], [s * 0.016, 0.186, zb], 0.32, inside);
      // Orejas: una aleta a cada lado (cuatro triángulos).
      const ex = s * 0.081;
      b.tri([ex, 0.125, 0.012], [ex + s * 0.016, 0.15, 0.0], [ex, 0.175, 0.012], 0.82, [0, 0.15, 0]);
      b.tri([ex, 0.125, 0.012], [ex + s * 0.016, 0.15, 0.0], [ex, 0.125, -0.022], 0.74, [0, 0.15, 0]);
      b.tri([ex, 0.175, 0.012], [ex + s * 0.016, 0.15, 0.0], [ex, 0.175, -0.02], 0.86, [0, 0.15, 0]);
      b.tri([ex, 0.125, -0.022], [ex + s * 0.016, 0.15, 0.0], [ex, 0.175, -0.02], 0.7, [0, 0.15, 0]);
    }
    // Nariz: cuña con su base sombreada.
    const zn = faceZ(0.15);
    b.tri([0, 0.158, zn], [-0.014, 0.118, zn], [0, 0.12, zn + 0.024], 0.96, inside);
    b.tri([0, 0.158, zn], [0.014, 0.118, zn], [0, 0.12, zn + 0.024], 0.88, inside);
    b.tri([-0.014, 0.118, zn], [0.014, 0.118, zn], [0, 0.12, zn + 0.024], 0.62, inside);
    // Boca.
    const zm = faceZ(0.097) + 0.002;
    b.quad([-0.02, 0.094, zm - 0.003], [0.02, 0.094, zm - 0.003], [0.017, 0.101, zm], [-0.017, 0.101, zm], 0.42, inside);
  });

  /** Casco de pelo con el nacimiento bajando de la frente a la nuca. */
  const hairCap = (b: Builder, opts: { back?: number; side?: number; front?: number; grow?: number; curls?: boolean; top?: number } = {}) => {
    const g = opts.grow ?? 1;
    const front = opts.front ?? 0.205;
    const side = opts.side ?? 0.142;
    const back = opts.back ?? 0.075;
    const edge = (_x: number, z: number) => {
      const t = Math.max(-1, Math.min(1, z / 0.105));
      return t >= 0 ? side + (front - side) * t * t : side + (back - side) * t * t;
    };
    const rOf = opts.curls ? (a: number) => 1 + 0.07 * Math.sin(a * 7) : undefined;
    const top = ring(0.252, 0.074 * g, 0.09 * g, n, 1, { cz: -0.011, rOf });
    top.capY = opts.top ?? 0.292;
    b.loft([ring(0, 0.087 * g, 0.105 * g, n, 0.8, { cz: -0.005, yOf: edge, rOf }), ring(0.205, 0.089 * g, 0.107 * g, n, 0.94, { cz: -0.006, rOf }), top], false, true);
  };

  make('hairShort', (b) => hairCap(b));
  make('hairLong', (b) => {
    hairCap(b, { back: 0.04, side: 0.11 });
    // Melena sobre la espalda y mechones a los costados de la cara.
    const m = N(7, 5);
    b.loft([ring(-0.12, 0.092, 0.03, m, 0.78, { cz: -0.088 }), ring(0.04, 0.098, 0.048, m, 0.88, { cz: -0.072 }), ring(0.2, 0.088, 0.05, m, 0.95, { cz: -0.06 })]);
    for (const s of [-1, 1]) b.box([s * 0.084, 0.115, 0.022], [0.012, 0.06, 0.035], 0.88);
  });
  make('hairBun', (b) => {
    hairCap(b, { back: 0.1 });
    const m = N(8, 6);
    const t = ring(0.275, 0.026, 0.026, m, 1, { cz: -0.105 });
    t.capY = 0.29;
    const bt = ring(0.205, 0.026, 0.026, m, 0.82, { cz: -0.1 });
    bt.capY = 0.19;
    b.loft([bt, ring(0.24, 0.045, 0.043, m, 0.95, { cz: -0.112 }), t]);
  });
  make('hairPony', (b) => {
    hairCap(b, { back: 0.1 });
    const m = N(6, 5);
    // Gomita y cola que cae sobre la nuca.
    const tip = ring(-0.02, 0.012, 0.012, m, 0.78, { cz: -0.118 });
    tip.capY = -0.035;
    b.loft([tip, ring(0.09, 0.03, 0.026, m, 0.9, { cz: -0.13 }), ring(0.19, 0.024, 0.022, m, 0.6, { cz: -0.11 }), ring(0.215, 0.024, 0.022, m, 0.6, { cz: -0.108 })]);
  });
  make('hairCurly', (b) => hairCap(b, { grow: 1.13, curls: true, back: 0.08, side: 0.13, front: 0.212, top: 0.31 }));
  // Gorro de cocina (blanco): banda y copa por encima de la cabeza.
  make('cap', (b) => {
    const top = ring(0.32, 0.094, 0.11, n, 1);
    top.capY = 0.33;
    b.loft([ring(0.185, 0.087, 0.104, n, 0.85, { cz: -0.004 }), top], false, true);
  });

  // Anteojos: aros de frente (cuatro franjas planas por lente), puente y patillas.
  make('glasses', (b) => {
    const z = 0.107;
    const t = 0.0045;
    const fr = (x0: number, y0: number, x1: number, y1: number) => b.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], 1, [0, 0.155, 0]);
    for (const s of [-1, 1]) {
      const cx = s * 0.031;
      fr(cx - 0.019, 0.144, cx + 0.019, 0.144 + t);
      fr(cx - 0.019, 0.168 - t, cx + 0.019, 0.168);
      fr(cx - 0.019, 0.144, cx - 0.019 + t, 0.168);
      fr(cx + 0.019 - t, 0.144, cx + 0.019, 0.168);
      // Patilla: una franja vertical fina hasta la oreja (se ve de costado).
      b.quad([s * 0.05, 0.161, z - 0.004], [s * 0.084, 0.161, -0.008], [s * 0.084, 0.166, -0.008], [s * 0.05, 0.166, z - 0.004], 0.9, [0, 0.163, 0]);
    }
    fr(-0.012, 0.16, 0.012, 0.164);
  });

  // ---------------------------------------------------------------- brazos

  // Brazo (origen: hombro). Tope bajo y chato: queda adentro del hombro del
  // tronco (si asomaba, la chomba parecía tener hombreras).
  make('upperArm', (b) => {
    const m = N(7, 5);
    const top = ring(0.012, 0.05, 0.053, m, 0.95);
    top.capY = 0.03;
    const rings: Ring[] = [{ ...ring(-0.295, 0.04, 0.041, m, 0.86), capShade: 0.8 }, ring(-0.13, 0.05, 0.053, m, 0.98), ring(-0.035, 0.056, 0.058, m, 1), top];
    b.loft(rings);
  });
  // Manga corta: tubo apenas más ancho hasta medio brazo.
  make('sleeve', (b) => {
    const m = N(7, 5);
    const top = ring(0.012, 0.058, 0.061, m, 1);
    top.capY = 0.036;
    b.loft([ring(-0.135, 0.06, 0.063, m, 0.8), ring(-0.035, 0.064, 0.066, m, 1), top], false, true);
  });
  // Antebrazo (origen: codo).
  make('forearm', (b) => {
    const m = N(7, 5);
    b.loft([ring(-0.245, 0.031, 0.036, m, 0.92), ring(-0.08, 0.045, 0.048, m, 1), ring(0.02, 0.043, 0.045, m, 0.92)]);
  });
  // Mano (origen: codo). Palma de canto hacia el cuerpo, dedos apenas
  // curvados hacia adelante y pulgar.
  make('hand', (b) => {
    const m = N(6, 4);
    const tip = ring(-0.405, 0.014, 0.032, m, 0.9, { cz: 0.014 });
    tip.capY = -0.415;
    const rings: Ring[] = [ring(-0.24, 0.024, 0.031, m, 0.92), ring(-0.31, 0.022, 0.045, m, 1, { cz: 0.005 }), tip];
    b.loft(rings);
    // Pulgar: una cuña (en el visor) o un taco (escritorio).
    if (hi) b.beam([0, -0.268, 0.03], [0.002, -0.322, 0.055], 0.02, 0.018, 0.92);
    else {
      b.tri([0.012, -0.26, 0.03], [-0.012, -0.26, 0.03], [0.002, -0.325, 0.058], 0.92, [0, -0.29, 0]);
      b.tri([0.012, -0.26, 0.03], [-0.012, -0.26, 0.03], [0.002, -0.325, 0.058], 0.85, [0, -0.29, 0.06]);
    }
  });

  // ---------------------------------------------------------------- piernas

  // Muslo (origen: cadera).
  make('thigh', (b) => {
    const m = N(8, 6);
    // El tope queda siempre adentro de la cadera: sin tapa.
    const rings: Ring[] = [{ ...ring(-0.455, 0.05, 0.054, m, 0.88), capShade: 0.85 }, ring(-0.24, 0.067, 0.074, m, 0.98), ring(0.06, 0.079, 0.086, m, 0.95)];
    if (hi) rings.splice(2, 0, ring(-0.06, 0.08, 0.088, m, 1));
    b.loft(rings, true, false);
  });
  // Pierna (origen: rodilla): rodilla, gemelo hacia atrás, tobillo.
  make('shin', (b) => {
    const m = N(8, 6);
    // El tobillo queda adentro del zapato: sin tapa abajo.
    b.loft([ring(-0.44, 0.034, 0.036, m, 0.92), ring(-0.13, 0.051, 0.058, m, 1, { cz: -0.008 }), ring(0.03, 0.054, 0.057, m, 0.92)], false, true);
  });
  // Zapato (origen: rodilla; suela a −0,48): puntera redondeada, suela
  // marcada, caña baja.
  make('shoe', (b) => {
    const m = N(8, 6);
    const sole = ring(-0.48, 0.045, 0.112, m, 0.32, { cz: 0.042 });
    sole.capShade = 0.25;
    const collarRing = ring(-0.395, 0.038, 0.046, m, 0.78, { cz: -0.004 });
    collarRing.capShade = 0.4;
    const rings: Ring[] = [sole, ring(-0.462, 0.047, 0.116, m, 1, { cz: 0.042 }), collarRing];
    if (hi) rings.splice(2, 0, ring(-0.425, 0.043, 0.09, m, 0.98, { cz: 0.026 }));
    b.loft(rings);
  });

  // Lampazo (en la mano derecha, origen: codo): mango y mecha.
  make('mop', (b) => {
    const grip: P3 = [0, -0.31, 0.01];
    const dir: P3 = norm([0, -0.45, -0.89]);
    const top: P3 = [grip[0] - dir[0] * 0.32, grip[1] - dir[1] * 0.32, grip[2] - dir[2] * 0.32];
    const end: P3 = [grip[0] + dir[0] * 1.0, grip[1] + dir[1] * 1.0, grip[2] + dir[2] * 1.0];
    b.beam(top, end, 0.026, 0.026, 0.55);
    // Cabezal: barra y flecos.
    b.beam([end[0] - 0.16, end[1], end[2]], [end[0] + 0.16, end[1], end[2]], 0.05, 0.05, 0.5);
    for (let k = 0; k < (hi ? 6 : 4); k++) {
      const x = -0.15 + (k * 0.3) / ((hi ? 6 : 4) - 1);
      b.beam([end[0] + x, end[1] - 0.01, end[2]], [end[0] + x * 1.1, end[1] - 0.03, end[2] + 0.12], 0.035, 0.02, 1);
    }
  });

  return { meshes, stats: { triangles: tris } };
}
