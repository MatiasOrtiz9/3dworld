/**
 * Formas de los vehículos del barrio, en metros, con el origen en el piso
 * bajo el centro de la caja: +z adelante, +x a la derecha, y arriba.
 *
 * Cada forma es UNA malla con color por cara (ver `GeoKit`): la carrocería
 * toma el color de la instancia y vidrios, gomas y plásticos son fijos. Las
 * ruedas, las luces y los accesorios (cartel del taxi, caja del delivery)
 * son instancias aparte que la vista ubica con los datos de acá.
 *
 * Proporciones de autos comunes en Buenos Aires: un compacto de 3,95 m, un
 * sedán de 4,45 m, un utilitario de 4,6 m y un colectivo midi de 10,4 m.
 */
import { GeoKit, PAINT, type RGBA } from './geoKit';

/** sRGB → lineal (los colores de vértice e instancia se usan crudos en el shader). */
export function lin(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.pow(v / 255, 2.2);
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}
const fixed = (hex: string, rough: number): RGBA => {
  const [r, g, b] = lin(hex);
  return [r, g, b, rough];
};

// Vidrio: gris azulado y no negro. Casi negro (#1d252c), la luneta y la
// banda de ventanas del colectivo se leían de cerca como agujeros: el
// colectivo parecía vacío y chato en la parada.
export const GLASS = fixed('#3a4853', 0.06);
/** Parte alta de los vidrios grandes: refleja el cielo (más claro y algo más mate). */
const GLASS_SKY = fixed('#71889a', 0.12);
/** Cartel de recorrido trasero (apagado: el de adelante es una luz aparte). */
const SIGN = fixed('#d9d2b0', 0.5);
const TRIM = fixed('#1b1c1e', 0.72);
const GRILLE = fixed('#121314', 0.55);
const UNDER = fixed('#0d0d0e', 0.95);
const CHROME = fixed('#a9adb1', 0.28);
const PLATE = fixed('#e9e9e4', 0.5);
const SKIN = fixed('#b08060', 0.7);
const HAIR = fixed('#2a1d15', 0.8);
const JACKET = fixed('#1e2126', 0.75);
const PANTS = fixed('#2c3442', 0.8);
const CREAM = fixed('#e8e2d2', 0.42);
const ROOF = fixed('#c9cbc8', 0.6);
const TIRE = fixed('#1e1f20', 0.93);
const SIDEWALL = fixed('#2a2b2d', 0.85);
const RIM = fixed('#a8acb0', 0.32);
const RIM_GAP = fixed('#5b5f63', 0.45);

export interface LampSpot {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}

export interface Shape {
  kit: GeoKit;
  /** Centros de rueda (x, z); la altura es el radio. */
  wheels: Array<[number, number]>;
  wheelR: number;
  wheelW: number;
  heads: LampSpot[];
  tails: LampSpot[];
}

/** Rueda unitaria (radio 1, ancho 1, eje X): goma y llanta con rayos que se ven girar. */
export function wheelKit(): GeoKit {
  const k = new GeoKit();
  k.wheelX(10, 0.64, TIRE, SIDEWALL, RIM, RIM_GAP);
  return k;
}

/** Caja unitaria pintada con el color de la instancia (accesorios, piernas, postes). */
export function partKit(): GeoKit {
  const k = new GeoKit();
  k.box(0, 0, 0, 1, 1, 1, PAINT);
  return k;
}

/** Luz: caja unitaria (el material es sin iluminación; el color viene de la instancia). */
export function lampKit(): GeoKit {
  const k = new GeoKit();
  k.box(0, 0, 0, 1, 1, 1, PAINT, '-y');
  return k;
}

interface CarDims {
  len: number;
  width: number;
  wheelBase: number;
  /** Corrimiento de los ejes hacia adelante (+) o atrás. */
  axleShift: number;
  wheelR: number;
  /** Perfil de la carrocería baja (z, y), sin la cabina. */
  body: Array<[number, number]>;
  /** Perfil de la cabina (z, y): base trasera, base delantera, parabrisas arriba, techo atrás. */
  cabin: Array<[number, number]>;
  /** Parante central (z). */
  pillar: number;
}

/**
 * Auto de dos volúmenes o tres: carrocería, cabina vidriada más angosta,
 * paragolpes, zócalo entre los pasaruedas y un piso oscuro que cierra la
 * vista por debajo (a lo lejos, sin ruedas, se lee igual como auto).
 */
function car(d: CarDims): Shape {
  const k = new GeoKit();
  const hl = d.len / 2;
  const hw = d.width / 2;
  const sill = 0.62;
  // Carrocería sobre los pasaruedas.
  k.prismX(d.body, -hw, hw, (i) => (i === 0 ? null : PAINT), PAINT);
  // Cabina: tumblehome de 8 cm por lado; costados de vidrio, techo pintado.
  const cw = hw - 0.08;
  k.prismX(d.cabin, -cw, cw, (i) => (i === 0 ? null : i === 2 ? PAINT : GLASS), GLASS);
  // Parante central: corta el vidrio lateral en dos ventanas.
  const [, yb] = d.cabin[0];
  const roofY = Math.min(d.cabin[2][1], d.cabin[3][1]);
  k.box(0, (yb + roofY) / 2, d.pillar, d.width - 0.15, roofY - yb, 0.1, PAINT, '+y-y');
  // Ejes.
  const fz = d.wheelBase / 2 + d.axleShift;
  const rz = -d.wheelBase / 2 + d.axleShift;
  const arch = d.wheelR + 0.1;
  // Paragolpes delantero (pintado arriba, rejilla abajo) y trasero.
  const frontLen = hl - (fz + arch);
  const rearLen = rz - arch + hl;
  k.box(0, 0.47, hl - frontLen / 2, d.width - 0.02, 0.3, frontLen, PAINT, '-y');
  k.box(0, 0.27, hl - frontLen / 2 + 0.02, d.width - 0.1, 0.12, frontLen - 0.02, GRILLE, '+y');
  k.box(0, 0.45, -hl + rearLen / 2, d.width - 0.02, 0.34, rearLen, PAINT, '-y');
  k.box(0, 0.25, -hl + rearLen / 2 + 0.02, d.width - 0.1, 0.1, rearLen - 0.02, TRIM, '+y');
  // Zócalo entre los pasaruedas.
  k.box(
    0,
    0.44,
    (fz - arch + (rz + arch)) / 2,
    d.width - 0.04,
    0.36,
    fz - arch - (rz + arch),
    PAINT,
    '-y+y',
  );
  // Piso y caja de ruedas oscuros (cierran la vista por los pasaruedas).
  k.box(0, (0.18 + sill) / 2, d.axleShift, d.width - 0.5, sill - 0.18, d.len - 0.5, UNDER, '+y');
  // Espejos, patente y rejilla.
  const mirrorZ = d.cabin[1][0] - 0.12;
  for (const s of [-1, 1])
    k.box(s * (hw + 0.07), d.cabin[1][1] + 0.06, mirrorZ, 0.14, 0.1, 0.08, TRIM);
  k.box(0, 0.47, -hl - 0.005, 0.42, 0.11, 0.02, PLATE, '-y');
  k.box(0, 0.55, hl + 0.004, 0.62, 0.1, 0.02, GRILLE, '-y');
  return {
    kit: k,
    wheels: [
      [hw - 0.12, fz],
      [-(hw - 0.12), fz],
      [hw - 0.12, rz],
      [-(hw - 0.12), rz],
    ],
    wheelR: d.wheelR,
    wheelW: 0.21,
    heads: [-1, 1].map((s) => ({ x: s * (hw - 0.28), y: 0.72, z: hl - 0.01, w: 0.34, h: 0.1 })),
    tails: [-1, 1].map((s) => ({ x: s * (hw - 0.22), y: 0.82, z: -hl + 0.01, w: 0.3, h: 0.11 })),
  };
}

export function sedanShape(): Shape {
  const hl = 4.45 / 2;
  return car({
    len: 4.45,
    width: 1.78,
    wheelBase: 2.65,
    axleShift: 0.04,
    wheelR: 0.31,
    body: [
      [-hl, 0.62],
      [hl, 0.62],
      [hl - 0.03, 0.78],
      [hl - 0.12, 0.86],
      [1.05, 0.97],
      [-1.45, 1.01],
      [-hl + 0.05, 0.98],
    ],
    cabin: [
      [-1.5, 0.99],
      [1.08, 0.96],
      [0.22, 1.43],
      [-0.9, 1.44],
    ],
    pillar: -0.3,
  });
}

export function hatchShape(): Shape {
  const hl = 3.95 / 2;
  return car({
    len: 3.95,
    width: 1.74,
    wheelBase: 2.5,
    axleShift: 0.02,
    wheelR: 0.3,
    body: [
      [-hl, 0.62],
      [hl, 0.62],
      [hl - 0.03, 0.8],
      [hl - 0.13, 0.88],
      [0.85, 0.99],
      [-hl + 0.07, 1.02],
      [-hl, 0.95],
    ],
    cabin: [
      [-hl + 0.08, 1.0],
      [0.88, 0.98],
      [0.04, 1.47],
      [-hl + 0.3, 1.48],
    ],
    pillar: -0.45,
  });
}

/** Utilitario (furgón chico): cabina vidriada y caja de carga ciega y alta. */
export function vanShape(): Shape {
  const len = 4.6;
  const hl = len / 2;
  const width = 1.86;
  const hw = width / 2;
  const k = new GeoKit();
  const wheelR = 0.33;
  const fz = 1.42;
  const rz = -1.33;
  const arch = wheelR + 0.1;
  k.prismX(
    [
      [-hl, 0.62],
      [hl, 0.62],
      [hl - 0.03, 0.83],
      [hl - 0.15, 0.95],
      [1.32, 1.08],
      [-hl, 1.1],
    ],
    -hw,
    hw,
    (i) => (i === 0 ? null : PAINT),
    PAINT,
  );
  const cw = hw - 0.04;
  // Cabina: parabrisas inclinado y ventanas laterales.
  k.prismX(
    [
      [-0.15, 1.08],
      [1.35, 1.07],
      [0.6, 1.84],
      [-0.15, 1.86],
    ],
    -cw,
    cw,
    (i) => (i === 0 || i === 3 ? null : i === 1 ? GLASS : PAINT),
    GLASS,
  );
  // Caja de carga: ciega, con ventanitas en las puertas traseras.
  k.box(0, 1.48, (-hl + -0.15) / 2, width - 0.08, 0.78, hl - 0.15, PAINT, '-y+z');
  for (const s of [-1, 1]) k.box(s * 0.4, 1.55, -hl - 0.005, 0.58, 0.36, 0.02, GLASS, '-y');
  k.box(0, 1.47, -hl - 0.012, 0.03, 0.74, 0.02, TRIM, '-y');
  // Parante B y franja lateral.
  k.box(0, 1.47, -0.15, width - 0.04, 0.78, 0.1, PAINT, '+y-y');
  const frontLen = hl - (fz + arch);
  const rearLen = rz - arch + hl;
  k.box(0, 0.46, hl - frontLen / 2, width - 0.02, 0.32, frontLen, PAINT, '-y');
  k.box(0, 0.26, hl - frontLen / 2 + 0.02, width - 0.1, 0.12, frontLen - 0.02, GRILLE, '+y');
  k.box(0, 0.42, -hl + rearLen / 2, width - 0.02, 0.4, rearLen, TRIM, '-y');
  k.box(
    0,
    0.44,
    (fz - arch + (rz + arch)) / 2,
    width - 0.04,
    0.36,
    fz - arch - (rz + arch),
    PAINT,
    '-y+y',
  );
  k.box(0, 0.4, 0.04, width - 0.5, 0.44, len - 0.5, UNDER, '+y');
  for (const s of [-1, 1]) k.box(s * (hw + 0.08), 1.2, 1.1, 0.16, 0.14, 0.08, TRIM);
  k.box(0, 0.6, -hl - 0.012, 0.42, 0.11, 0.02, PLATE, '-y');
  k.box(0, 0.62, hl + 0.004, 0.7, 0.14, 0.02, GRILLE, '-y');
  return {
    kit: k,
    wheels: [
      [hw - 0.13, fz],
      [-(hw - 0.13), fz],
      [hw - 0.13, rz],
      [-(hw - 0.13), rz],
    ],
    wheelR,
    wheelW: 0.22,
    heads: [-1, 1].map((s) => ({ x: s * (hw - 0.27), y: 0.8, z: hl - 0.03, w: 0.3, h: 0.14 })),
    tails: [-1, 1].map((s) => ({ x: s * (hw - 0.08), y: 1.05, z: -hl + 0.01, w: 0.12, h: 0.42 })),
  };
}

/**
 * Colectivo: faldón con el color de la línea, banda de ventanas, franja
 * crema, techo con el equipo de aire, puertas del lado de la vereda y el
 * cartel de recorrido (luz aparte).
 */
export function busShape(): Shape {
  const len = 10.4;
  const hl = len / 2;
  const width = 2.5;
  const hw = width / 2;
  const wheelR = 0.48;
  // Ejes a 0,2 y 0,83 del largo desde la trompa (ver SPECS.bus.axles).
  const fz = hl - len * 0.2;
  const rz = hl - len * 0.83;
  const arch = wheelR + 0.12;
  const k = new GeoKit();
  // Faldón: arriba de los pasaruedas y entre ellos.
  k.box(0, 1.12, 0, width, 0.26, len, PAINT, '-y');
  const segs: Array<[number, number]> = [
    [fz + arch, hl],
    [rz + arch, fz - arch],
    [-hl, rz - arch],
  ];
  for (const [a, b] of segs) k.box(0, 0.62, (a + b) / 2, width, 0.74, b - a, PAINT, '+y-y');
  k.box(0, 0.62, 0, width - 0.5, 0.74, len - 0.3, UNDER, '+y');
  // Banda de ventanas (vidrio apenas metido) con parantes cada 1,3 m. El
  // tercio de arriba, más claro: el cielo reflejado (mismo material, color de
  // vértice), así la banda no se lee como un hueco negro.
  k.box(0, 1.82, -0.08, width - 0.04, 1.14, len - 0.4, GLASS, '-y+y');
  k.box(0, 2.2, -0.08, width - 0.02, 0.36, len - 0.4, GLASS_SKY, '-y+y-z+z');
  for (let z = -hl + 0.6; z < fz - 0.6; z += 1.32)
    k.box(0, 1.82, z, width, 1.14, 0.12, CREAM, '-y+y');
  // Franja crema y techo.
  k.box(0, 2.62, -0.05, width, 0.46, len - 0.3, CREAM, '-y');
  k.box(0, 2.92, -0.1, width - 0.24, 0.14, len - 0.7, ROOF, '-y');
  k.box(0, 3.08, -0.6, 1.6, 0.24, 2.3, ROOF, '-y');
  // Frente: parabrisas grande y paragolpes; atrás, luneta y paragolpes.
  k.box(0, 1.85, hl - 0.03, width - 0.18, 1.2, 0.06, GLASS, '-y+y');
  k.box(0, 2.3, hl - 0.02, width - 0.2, 0.3, 0.06, GLASS_SKY, '-y+y-z');
  k.box(0, 0.42, hl + 0.02, width - 0.02, 0.3, 0.08, TRIM, '-y');
  k.box(0, 2.0, -hl + 0.12, width - 0.4, 0.8, 0.04, GLASS, '-y+y');
  k.box(0, 2.25, -hl + 0.11, width - 0.42, 0.28, 0.04, GLASS_SKY, '-y+y+z');
  // Cartel de recorrido de atrás, sobre la franja crema.
  k.box(0, 2.62, -hl + 0.085, 1.3, 0.24, 0.02, SIGN, '-y+y+z');
  k.box(0, 0.42, -hl - 0.02, width - 0.02, 0.3, 0.08, TRIM, '-y');
  // Puertas (lado derecho, el de la vereda): delantera y del medio.
  for (const [z0, z1] of [
    [fz + 0.55, hl - 0.25],
    [-1.4, -0.25],
  ] as const) {
    k.box(hw + 0.006, 1.38, (z0 + z1) / 2, 0.02, 1.86, z1 - z0, GLASS, '-y+y-x');
    k.box(hw + 0.012, 1.38, (z0 + z1) / 2, 0.02, 1.86, 0.05, TRIM, '-y+y-x');
  }
  // Espejos retrovisores de colectivo: brazos largos hacia adelante.
  for (const s of [-1, 1]) {
    k.box(s * (hw + 0.18), 2.3, hl + 0.25, 0.06, 0.06, 0.5, TRIM);
    k.box(s * (hw + 0.2), 2.05, hl + 0.48, 0.06, 0.4, 0.16, TRIM);
  }
  k.box(0, 0.75, -hl - 0.03, 0.42, 0.11, 0.02, PLATE, '-y');
  return {
    kit: k,
    wheels: [
      [hw - 0.18, fz],
      [-(hw - 0.18), fz],
      [hw - 0.18, rz],
      [-(hw - 0.18), rz],
    ],
    wheelR,
    wheelW: 0.3,
    heads: [-1, 1].map((s) => ({ x: s * (hw - 0.3), y: 0.72, z: hl + 0.03, w: 0.36, h: 0.16 })),
    tails: [-1, 1].map((s) => ({ x: s * (hw - 0.12), y: 1.0, z: -hl - 0.01, w: 0.16, h: 0.5 })),
  };
}

/** Moto con conductor (la pintura toma tanque, carenado y casco). */
export function motoShape(): Shape {
  const k = new GeoKit();
  const wz = 0.68;
  k.box(0, 0.82, 0.12, 0.32, 0.24, 0.5, PAINT);
  k.box(0, 0.98, 0.55, 0.3, 0.3, 0.2, PAINT);
  k.box(0, 0.9, -0.3, 0.28, 0.1, 0.62, TRIM);
  k.box(0, 0.82, -0.66, 0.2, 0.1, 0.36, PAINT);
  k.box(0, 0.48, 0.03, 0.3, 0.32, 0.44, GRILLE);
  k.box(0.17, 0.4, -0.35, 0.08, 0.08, 0.62, CHROME);
  for (const s of [-1, 1]) k.boxPitched(s * 0.09, 0.64, 0.6, 0.04, 0.7, 0.05, -0.2, CHROME);
  k.boxPitched(0, 0.38, -0.36, 0.06, 0.1, 0.62, 0.15, TRIM);
  k.box(0, 1.09, 0.47, 0.72, 0.035, 0.035, TRIM);
  // Conductor: campera y pantalón oscuros, casco con el color de la moto.
  k.boxPitched(0, 1.28, -0.12, 0.42, 0.58, 0.26, -0.32, JACKET);
  k.box(0, 1.73, 0.0, 0.28, 0.3, 0.32, PAINT);
  k.box(0, 1.72, 0.165, 0.24, 0.12, 0.02, GLASS);
  for (const s of [-1, 1]) {
    k.boxPitched(s * 0.27, 1.27, 0.24, 0.1, 0.5, 0.1, -1.0, JACKET);
    k.boxPitched(s * 0.15, 1.0, 0.0, 0.15, 0.15, 0.55, -0.08, PANTS);
    k.boxPitched(s * 0.17, 0.7, 0.22, 0.13, 0.55, 0.13, 0.35, PANTS);
  }
  return {
    kit: k,
    // Cada rueda dos veces (x ±0): la llanta se ve de los dos lados.
    wheels: [
      [0.001, wz],
      [-0.001, wz],
      [0.001, -wz],
      [-0.001, -wz],
    ],
    wheelR: 0.3,
    wheelW: 0.13,
    heads: [{ x: 0, y: 1.0, z: 0.66, w: 0.16, h: 0.12 }],
    tails: [{ x: 0, y: 0.86, z: -0.85, w: 0.14, h: 0.06 }],
  };
}

/** Caño de bici entre dos puntos del plano (z, y). */
function tube(
  k: GeoKit,
  x: number,
  a: [number, number],
  b: [number, number],
  t: number,
  c: RGBA,
): void {
  const dz = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dz, dy);
  k.boxPitched(x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2, t, l, t, Math.atan2(-dz, dy), c);
}

/** Puntos de la bici que también usa la vista (pedalier, cadera del ciclista). */
export const BIKE = {
  crank: [0.02, 0.3] as [number, number],
  crankR: 0.17,
  hip: [-0.17, 1.0] as [number, number],
  thigh: 0.45,
  shin: 0.48,
};

/** Bici con ciclista (la pintura toma la remera; las piernas son instancias que pedalean). */
export function bikeShape(): Shape {
  const k = new GeoKit();
  const frame = fixed('#2d3f4f', 0.45);
  const wz = 0.52;
  const bb = BIKE.crank;
  const seat: [number, number] = [-0.17, 0.9];
  const head: [number, number] = [0.37, 0.8];
  tube(k, 0, bb, seat, 0.04, frame);
  tube(k, 0, bb, [0.39, 0.74], 0.045, frame);
  tube(k, 0, [-0.13, 0.86], head, 0.035, frame);
  for (const s of [-1, 1]) {
    tube(k, s * 0.05, bb, [-wz, 0.34], 0.025, frame);
    tube(k, s * 0.05, [-0.15, 0.86], [-wz, 0.34], 0.022, frame);
    tube(k, s * 0.05, [0.39, 0.74], [wz, 0.34], 0.025, frame);
  }
  tube(k, 0, head, [0.4, 1.02], 0.03, TRIM);
  k.box(0, 1.03, 0.4, 0.52, 0.03, 0.03, TRIM);
  k.box(0, 0.94, seat[0] - 0.01, 0.12, 0.05, 0.24, TRIM);
  // Ciclista: torso inclinado, cabeza, brazos al manubrio.
  const hip = BIKE.hip;
  const sh: [number, number] = [0.12, 1.47];
  tube(k, 0, hip, sh, 0.34, PAINT);
  k.box(0, 1.69, 0.19, 0.19, 0.23, 0.21, SKIN);
  k.box(0, 1.8, 0.17, 0.2, 0.06, 0.22, HAIR);
  for (const s of [-1, 1])
    tube(k, s * 0.2, [sh[0] + 0.02, sh[1] - 0.04], [0.41, 1.04], 0.08, PAINT);
  return {
    kit: k,
    wheels: [
      [0.001, wz],
      [-0.001, wz],
      [0.001, -wz],
      [-0.001, -wz],
    ],
    wheelR: 0.34,
    wheelW: 0.05,
    heads: [{ x: 0, y: 0.98, z: 0.47, w: 0.07, h: 0.06 }],
    tails: [{ x: 0, y: 0.82, z: -0.32, w: 0.06, h: 0.05 }],
  };
}
