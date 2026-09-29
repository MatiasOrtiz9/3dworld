import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

/**
 * Geometría low-poly de las personas.
 *
 * Todas las piezas se modelan una sola vez, en metros, para una figura de
 * referencia de 1,72 m mirando a +Z (+X es su derecha). Cada persona las
 * reutiliza vía thin instances con su propia matriz y su propio color.
 *
 * Dos decisiones sostienen el diseño:
 *
 * 1. **Las piezas articuladas tienen el origen en su pivote** (hombro, cadera,
 *    rodilla). Así el antebrazo y la mano comparten la MISMA matriz que el
 *    brazo —el codo va "horneado" en la geometría— y la zapatilla comparte la
 *    de la pierna. Menos matrices por cuadro, sin juntas que se separen.
 *
 * 2. **El color es color por vértice × color por instancia.** La geometría
 *    guarda sólo un sombreado (blanco = color pleno, oscuro = oclusión o
 *    detalles como ojos y suela) y cada persona aporta su tono de ropa, piel o
 *    pelo por instancia. Un único material para toda la multitud.
 *
 * Caras planas a propósito: normales por cara, sin vértices compartidos. En un
 * estilo low-poly la faceta es la estética; suavizarla con tan pocos
 * polígonos da figuras de plastilina.
 */

/** Altura de la articulación de la cadera sobre el suelo, figura de referencia. */
export const HIP_Y = 0.9;
/** Posición lateral de cada cadera. */
export const HIP_X = 0.085;
/** Hombro: altura y separación lateral. */
export const SHOULDER_Y = 1.385;
export const SHOULDER_X = 0.2;
/** Largo del muslo (cadera → rodilla) y de la pierna (rodilla → suela). */
export const THIGH_LEN = 0.44;
export const SHIN_LEN = 0.46;

type P3 = [number, number, number];

/** Acumulador de triángulos con normal plana y sombreado por vértice. */
class Builder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  /**
   * Triángulo orientado hacia `hint` (un punto interior de la pieza).
   *
   * Babylon calcula la normal de cara como (a−b)×(c−b); si esa normal apunta
   * hacia adentro se invierte el orden. Así el sentido de giro siempre
   * coincide con el de las primitivas del motor y el culling de caras
   * traseras funciona sin sorpresas.
   */
  tri(a: P3, b: P3, c: P3, shade: number | [number, number, number], inside: P3): void {
    let nx = (a[1] - b[1]) * (c[2] - b[2]) - (a[2] - b[2]) * (c[1] - b[1]);
    let ny = (a[2] - b[2]) * (c[0] - b[0]) - (a[0] - b[0]) * (c[2] - b[2]);
    let nz = (a[0] - b[0]) * (c[1] - b[1]) - (a[1] - b[1]) * (c[0] - b[0]);
    const mx = (a[0] + b[0] + c[0]) / 3 - inside[0];
    const my = (a[1] + b[1] + c[1]) / 3 - inside[1];
    const mz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    let pts: P3[] = [a, b, c];
    let shades = typeof shade === 'number' ? [shade, shade, shade] : shade;
    if (nx * mx + ny * my + nz * mz < 0) {
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

  quad(a: P3, b: P3, c: P3, d: P3, shade: number, inside: P3): void {
    this.tri(a, b, c, shade, inside);
    this.tri(a, c, d, shade, inside);
  }

  /**
   * Sólido "lofteado" entre anillos horizontales.
   *
   * Cada anillo es un polígono en XZ a una altura dada (con su propio
   * sombreado, que produce el degradé de oclusión de abajo hacia arriba). Se
   * cierran las tapas con abanicos. Es la herramienta con la que se arma el
   * torso, la cabeza, el pelo y las extremidades.
   */
  loft(rings: Ring[], capBottom = true, capTop = true): void {
    const n = rings[0].pts.length;
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r];
      const B = rings[r + 1];
      const inside: P3 = [
        (A.cx + B.cx) / 2,
        (avgY(A) + avgY(B)) / 2,
        (A.cz + B.cz) / 2,
      ];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = A.pts[i];
        const b = A.pts[j];
        const c = B.pts[j];
        const d = B.pts[i];
        this.tri(a, b, c, [A.shade, A.shade, B.shade], inside);
        this.tri(a, c, d, [A.shade, B.shade, B.shade], inside);
      }
    }
    const first = rings[0];
    const last = rings[rings.length - 1];
    if (capBottom) this.cap(first, rings[1]);
    if (capTop) this.cap(last, rings[rings.length - 2]);
  }

  private cap(ring: Ring, neighbour: Ring): void {
    const n = ring.pts.length;
    const center: P3 = [ring.cx, ring.capY ?? avgY(ring), ring.cz];
    // Punto interior: hacia el anillo vecino, así la tapa mira hacia afuera.
    const inside: P3 = [neighbour.cx, avgY(neighbour), neighbour.cz];
    for (let i = 0; i < n; i++) {
      this.tri(ring.pts[i], ring.pts[(i + 1) % n], center, ring.capShade ?? ring.shade, inside);
    }
  }

  /** Viga de sección cuadrada entre dos puntos (cuadros de bicicleta). */
  beam(p0: P3, p1: P3, t: number, shade: number): void {
    const d: P3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    d[0] /= len;
    d[1] /= len;
    d[2] /= len;
    // Un eje perpendicular cualquiera, y el tercero por producto cruz.
    const ref: P3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(d, ref));
    const v = norm(cross(d, u));
    const h = t / 2;
    const corner = (p: P3, su: number, sv: number): P3 => [
      p[0] + (u[0] * su + v[0] * sv) * h,
      p[1] + (u[1] * su + v[1] * sv) * h,
      p[2] + (u[2] * su + v[2] * sv) * h,
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

  /**
   * Rueda con el eje paralelo a X: cubierta en anillo (no un disco macizo, que
   * de cerca se leía como una tapa negra) y tres rayos cruzados.
   */
  wheel(cz: number, cy: number, radius: number, halfWidth: number, sides: number, shade: number): void {
    const inner = radius * 0.84;
    const pt = (r: number, a: number, x: number): P3 => [x, cy + Math.sin(a) * r, cz + Math.cos(a) * r];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      // Punto interior del segmento de cubierta, para orientar las caras.
      const mid: P3 = [0, cy + Math.sin(am) * (radius + inner) / 2, cz + Math.cos(am) * (radius + inner) / 2];
      const oL0 = pt(radius, a0, -halfWidth);
      const oL1 = pt(radius, a1, -halfWidth);
      const oR0 = pt(radius, a0, halfWidth);
      const oR1 = pt(radius, a1, halfWidth);
      const iL0 = pt(inner, a0, -halfWidth);
      const iL1 = pt(inner, a1, -halfWidth);
      const iR0 = pt(inner, a0, halfWidth);
      const iR1 = pt(inner, a1, halfWidth);
      this.quad(oL0, oL1, oR1, oR0, shade, mid); // banda de rodadura
      this.quad(iL0, iL1, iR1, iR0, shade * 2.5, mid); // llanta
      this.quad(oL0, oL1, iL1, iL0, shade, mid); // flancos
      this.quad(oR0, oR1, iR1, iR0, shade, mid);
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      const p0: P3 = [0, cy + Math.sin(a) * inner, cz + Math.cos(a) * inner];
      const p1: P3 = [0, cy - Math.sin(a) * inner, cz - Math.cos(a) * inner];
      this.beam(p0, p1, 0.014, 0.55);
    }
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
}

interface Ring {
  pts: P3[];
  cx: number;
  cz: number;
  shade: number;
  /** Altura del centro de la tapa (para cúpulas). Por defecto, la del anillo. */
  capY?: number;
  capShade?: number;
}

function avgY(r: Ring): number {
  let s = 0;
  for (const p of r.pts) s += p[1];
  return s / r.pts.length;
}

function cross(a: P3, b: P3): P3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: P3): P3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Anillo rectangular con esquinas achaflanadas (octógono irregular).
 * `yOf` permite inclinar el anillo, p. ej. el borde del pelo que baja en la nuca.
 */
function oct(
  y: number,
  hw: number,
  hd: number,
  c: number,
  shade: number,
  cx = 0,
  cz = 0,
  yOf?: (x: number, z: number) => number,
): Ring {
  const raw: Array<[number, number]> = [
    [hw, hd - c],
    [hw - c, hd],
    [-hw + c, hd],
    [-hw, hd - c],
    [-hw, -hd + c],
    [-hw + c, -hd],
    [hw - c, -hd],
    [hw, -hd + c],
  ];
  const pts: P3[] = raw.map(([x, z]) => [cx + x, yOf ? yOf(x, z) : y, cz + z]);
  return { pts, cx, cz, shade };
}

/** Anillo rectangular simple (extremidades). */
function rect(y: number, hw: number, hd: number, shade: number, cx = 0, cz = 0): Ring {
  const pts: P3[] = [
    [cx + hw, y, cz + hd],
    [cx - hw, y, cz + hd],
    [cx - hw, y, cz - hd],
    [cx + hw, y, cz - hd],
  ];
  return { pts, cx, cz, shade };
}

export type PartName =
  | 'torso'
  | 'tie'
  | 'head'
  | 'hairShort'
  | 'hairLong'
  | 'hairBun'
  | 'skirt'
  | 'backpack'
  | 'upperArm'
  | 'forearm'
  | 'hand'
  | 'thigh'
  | 'shin'
  | 'shoe'
  | 'bike';

/** Construye todas las piezas. Se llama una vez por ciudad. */
export function buildPeopleParts(scene: Scene): Record<PartName, Mesh> {
  const parts = {} as Record<PartName, Mesh>;
  const make = (name: PartName, fill: (b: Builder) => void) => {
    const b = new Builder();
    fill(b);
    parts[name] = b.toMesh(`person-${name}`, scene);
  };

  // --- torso: remera/camisa. El dobladillo baja por debajo de la cadera para
  // tapar la unión con los muslos, que es donde una figura low-poly se "rompe".
  make('torso', (b) => {
    const neck = oct(1.47, 0.1, 0.07, 0.03, 0.92);
    neck.capShade = 0.9;
    b.loft([
      oct(0.83, 0.168, 0.108, 0.045, 0.72),
      oct(1.02, 0.15, 0.1, 0.045, 0.86),
      oct(1.27, 0.185, 0.118, 0.05, 1, 0, 0.008),
      oct(1.4, 0.198, 0.108, 0.055, 1),
      neck,
    ]);
    // Cuello abierto de la camisa, modelado como sombreado en la misma malla.
    b.tri([0, 1.405, 0.112], [-0.062, 1.372, 0.117], [-0.018, 1.286, 0.126], 0.64, [0, 1.36, 0]);
    b.tri([0, 1.405, 0.112], [0.062, 1.372, 0.117], [0.018, 1.286, 0.126], 0.72, [0, 1.36, 0]);
  });

  // Corbata roja opcional para la camisa celeste del uniforme secundario.
  // Es una sola pieza instanciada para toda la multitud, igual que el resto.
  make('tie', (b) => {
    b.tri([0, 1.405, 0.13], [-0.026, 1.35, 0.13], [0, 1.08, 0.13], 0.86, [0, 1.25, 0]);
    b.tri([0, 1.405, 0.13], [0, 1.08, 0.13], [0.026, 1.35, 0.13], 0.72, [0, 1.25, 0]);
  });

  // --- cabeza: cuello, cráneo achaflanado, nariz y ojos.
  make('head', (b) => {
    b.loft([rect(1.43, 0.048, 0.046, 0.8), rect(1.565, 0.044, 0.044, 0.9, 0, -0.005)], false, false);
    const top = oct(1.785, 0.068, 0.078, 0.034, 1, 0, -0.004);
    top.capY = 1.8;
    b.loft([
      oct(1.525, 0.058, 0.066, 0.026, 0.84, 0, 0.018),
      oct(1.6, 0.082, 0.096, 0.036, 0.97, 0, 0.006),
      oct(1.715, 0.088, 0.1, 0.04, 1, 0, 0),
      top,
    ]);
    // Nariz: una cuña mínima. A la distancia no se ve, pero de cerca (VR) es
    // lo que dice hacia dónde mira la persona.
    const zf = 0.1;
    b.tri([0, 1.675, zf], [-0.017, 1.625, zf], [0, 1.628, zf + 0.03], 0.93, [0, 1.64, 0]);
    b.tri([0, 1.675, zf], [0.017, 1.625, zf], [0, 1.628, zf + 0.03], 0.86, [0, 1.64, 0]);
    b.tri([-0.017, 1.625, zf], [0.017, 1.625, zf], [0, 1.628, zf + 0.03], 0.7, [0, 1.66, 0]);
    // Ojos: dos quads oscuros apenas delante de la cara. El color de instancia
    // (piel) multiplicado por 0,12 da un marrón muy oscuro: no hace falta un
    // material aparte.
    for (const sx of [-1, 1]) {
      const x0 = sx * 0.024;
      const x1 = sx * 0.05;
      const z = zf + 0.0035;
      b.quad([x0, 1.672, z], [x1, 1.672, z], [x1, 1.688, z - 0.002], [x0, 1.688, z], 0.12, [0, 1.68, 0]);
    }
    // Orejas pequeñas a ambos lados: ayudan a leer el perfil de la cabeza sin
    // agregar otra malla ni otro draw call por persona.
    for (const sx of [-1, 1]) {
      b.loft(
        [
          oct(1.625, 0.024, 0.026, 0.01, 0.8, sx * 0.087, 0.012),
          oct(1.68, 0.026, 0.028, 0.01, 0.88, sx * 0.09, 0.012),
        ],
        true,
        true,
      );
    }
    // Una línea de boca muy discreta completa la expresión frontal.
    b.quad([-0.025, 1.615, 0.105], [0.025, 1.615, 0.105], [0.021, 1.623, 0.108], [-0.021, 1.623, 0.108], 0.38, [0, 1.62, 0]);
  });

  // --- pelo: tres cortes. El borde inferior baja hacia la nuca: un casco
  // horizontal se lee como gorra, no como pelo.
  const hairCap = (b: Builder, backDrop: number) => {
    const edge = (x: number, z: number) => 1.668 + (z / 0.112) * 0.05 - (Math.abs(x) > 0.09 ? 0.01 : 0) - (z < 0 ? backDrop : 0);
    const top = oct(1.772, 0.094, 0.106, 0.044, 1, 0, -0.008);
    top.capY = 1.822;
    b.loft(
      [
        oct(0, 0.099, 0.113, 0.046, 0.78, 0, -0.006, edge),
        oct(1.73, 0.1, 0.114, 0.047, 0.95, 0, -0.008),
        top,
      ],
      false,
      true,
    );
  };
  make('hairShort', (b) => hairCap(b, 0));
  make('hairLong', (b) => {
    hairCap(b, 0.02);
    // Melena: cae sobre la espalda y los hombros.
    const top = rect(1.72, 0.1, 0.05, 0.95, 0, -0.07);
    b.loft([rect(1.4, 0.115, 0.04, 0.72, 0, -0.085), rect(1.58, 0.108, 0.05, 0.85, 0, -0.08), top]);
  });
  make('hairBun', (b) => {
    hairCap(b, 0);
    const top = oct(1.83, 0.035, 0.035, 0.014, 1, 0, -0.1);
    top.capY = 1.845;
    b.loft([oct(1.74, 0.034, 0.03, 0.014, 0.8, 0, -0.11), oct(1.79, 0.048, 0.046, 0.02, 0.95, 0, -0.108), top]);
  });

  // --- pollera: tronco de cono desde la cintura.
  make('skirt', (b) => {
    b.loft([oct(0.54, 0.235, 0.18, 0.08, 0.78), oct(0.8, 0.2, 0.15, 0.07, 0.92), oct(1.0, 0.162, 0.108, 0.05, 1)]);
  });

  // --- mochila: el signo más claro de "estudiante" a cualquier distancia.
  make('backpack', (b) => {
    const top = oct(1.39, 0.13, 0.06, 0.035, 1, 0, -0.18);
    top.capY = 1.41;
    b.loft([oct(1.02, 0.15, 0.075, 0.03, 0.7, 0, -0.19), oct(1.2, 0.152, 0.078, 0.03, 0.9, 0, -0.19), top]);
    // Bolsillo frontal, un poco más oscuro.
    b.loft([rect(1.06, 0.1, 0.03, 0.62, 0, -0.27), rect(1.2, 0.1, 0.03, 0.66, 0, -0.27)]);
  });

  // --- brazo: origen en el HOMBRO. Manga, antebrazo con el codo apenas
  // flexionado hacia adelante, y mano.
  make('upperArm', (b) => {
    b.loft([rect(0.05, 0.058, 0.064, 1), rect(-0.12, 0.056, 0.06, 0.95), rect(-0.29, 0.046, 0.05, 0.84)]);
  });
  make('forearm', (b) => {
    b.loft([rect(-0.27, 0.042, 0.046, 0.9, 0, 0.004), rect(-0.53, 0.034, 0.036, 1, 0, 0.07)]);
  });
  make('hand', (b) => {
    b.loft([rect(-0.515, 0.03, 0.04, 0.95, 0, 0.074), rect(-0.6, 0.026, 0.045, 1, 0, 0.09), rect(-0.63, 0.018, 0.03, 0.9, 0, 0.095)]);
  });

  // --- pierna: muslo con origen en la CADERA, pierna y zapato con origen en
  // la RODILLA. La parte alta del muslo es ancha: entre los dos forman la pelvis.
  make('thigh', (b) => {
    b.loft([rect(0.07, 0.088, 0.098, 0.7), rect(-0.2, 0.074, 0.085, 0.92), rect(-THIGH_LEN - 0.02, 0.06, 0.066, 1)]);
  });
  make('shin', (b) => {
    b.loft([rect(0.02, 0.058, 0.064, 0.9), rect(-0.17, 0.054, 0.062, 1), rect(-0.41, 0.042, 0.048, 0.95)]);
  });
  make('shoe', (b) => {
    const sole = -SHIN_LEN;
    // Punta achaflanada y empeine estrecho: mantiene el tamaño realista, pero
    // evita que el pie parezca otro bloque rectangular.
    b.loft([
      { ...oct(sole, 0.043, 0.105, 0.035, 0.35, 0, 0.038), capShade: 0.2 },
      oct(sole + 0.022, 0.045, 0.11, 0.038, 0.85, 0, 0.038),
      oct(-0.395, 0.04, 0.062, 0.032, 1, 0, 0.004),
    ]);
  });

  // --- bicicleta: ruedas oscuras, cuadro del color de la instancia.
  make('bike', (b) => {
    const r = 0.34;
    b.wheel(0.52, r, r, 0.024, 12, 0.14);
    b.wheel(-0.52, r, r, 0.024, 12, 0.14);
    const crank: P3 = [0, 0.33, 0.02];
    const seat: P3 = [0, 0.86, -0.2];
    const head: P3 = [0, 0.9, 0.38];
    const t = 0.045;
    b.beam(crank, seat, t, 1); // tubo de asiento
    b.beam(crank, head, t, 1); // tubo diagonal
    b.beam([0, 0.84, -0.18], [0, 0.87, 0.36], t * 0.9, 1); // tubo superior
    b.beam(crank, [0, r, -0.52], t * 0.8, 1); // vainas
    b.beam(seat, [0, r, -0.52], t * 0.7, 1); // tirantes
    b.beam(head, [0, r, 0.52], t * 0.8, 0.9); // horquilla
    b.beam([0, 0.9, 0.38], [0, 1.02, 0.34], t * 0.8, 0.3); // potencia
    b.beam([-0.25, 1.02, 0.34], [0.25, 1.02, 0.34], 0.03, 0.25); // manubrio
    b.beam([-0.06, 0.9, -0.24], [0.06, 0.9, -0.24], 0.07, 0.22); // asiento
    b.beam([0, 0.9, -0.33], [0, 0.9, -0.12], 0.07, 0.22);
    b.beam([0, 0.8, -0.2], [0, 0.9, -0.22], 0.03, 0.4); // tija

    // Luz delantera LED brillante
    b.beam([-0.045, 0.99, 0.42], [0.045, 0.99, 0.42], 0.04, 1.8);
    // Reflector trasero rojo
    b.beam([-0.035, 0.83, -0.27], [0.035, 0.83, -0.27], 0.035, 0.3);

    // Portaequipajes / batería sobre rueda trasera
    b.beam([-0.08, 0.78, -0.32], [0.08, 0.78, -0.32], 0.035, 0.5);
    b.beam([0, 0.78, -0.32], [0, 0.78, -0.58], 0.035, 0.5);
    b.beam([0, r, -0.52], [0, 0.78, -0.56], 0.022, 0.5);

    // Bielas y pedales
    b.beam([-0.12, 0.33, 0.02], [0.12, 0.33, 0.02], 0.024, 0.7);
    b.beam([-0.12, 0.33, 0.02], [-0.12, 0.33 + BIKE.crankR, 0.02], 0.02, 0.4);
    b.beam([0.12, 0.33, 0.02], [0.12, 0.33 - BIKE.crankR, 0.02], 0.02, 0.4);
    b.beam([-0.16, 0.33 + BIKE.crankR, 0.02], [-0.09, 0.33 + BIKE.crankR, 0.02], 0.035, 0.2);
    b.beam([0.09, 0.33 - BIKE.crankR, 0.02], [0.16, 0.33 - BIKE.crankR, 0.02], 0.035, 0.2);
  });

  return parts;
}

/** Hitos de la bicicleta que la animación del ciclista necesita. */
export const BIKE = {
  /** Centro del plato (bielas), relativo al suelo. */
  crankY: 0.33,
  crankZ: 0.02,
  crankR: 0.17,
  seatY: 0.93,
  seatZ: -0.22,
  barY: 1.02,
  barZ: 0.34,
} as const;
