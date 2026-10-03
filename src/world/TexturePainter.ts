import { TileableNoise } from './ProceduralNoise';
import { seedFromString } from '../utils/rng';

/**
 * Pintor de texturas de superficie, píxel por píxel y sin motor.
 *
 * La versión anterior dibujaba con el canvas 2D: rectángulos sueltos al azar
 * para el grano y líneas para las juntas. Se leía "impreso": grano de un solo
 * tamaño, juntas planas, mismo tono en todas las piezas. Acá cada superficie
 * se arma como en la realidad, por capas:
 *
 *  - **variación por pieza** (cada baldosa, ladrillo o tablilla con su tono),
 *  - **mancha grande** (ruido fractal: humedad, desgaste, encerado),
 *  - **grano fino** (poros, áridos, fibras),
 *  - **juntas con bisel**: la junta oscura y una arista apenas más clara al
 *    lado, que es lo que la hace leerse hundida y no dibujada.
 *
 * Cada pintor devuelve además la ALTURA del píxel en milímetros (junta
 * hundida, poro, onda de la chapa, veta de la madera). De esa altura sale el
 * relieve (`reliefMap`: normales y rugosidad), así coincide exactamente con el
 * dibujo: la junta oscura es también la junta que hace sombra.
 *
 * Todo es periódico sobre el lado de la textura (las piezas dividen el lado y
 * el ruido envuelve su retícula), así que repite sin costura. Determinista:
 * la semilla sale del nombre del tipo.
 *
 * Se entrega en escala de grises (salvo maderas, levemente cálidas) porque el
 * color lo pone el material: la textura MULTIPLICA el color base. Por eso el
 * brillo medio se mantiene alto (~0,85-0,95): una textura más oscura
 * oscurecería todos los tonos de la paleta.
 */
export type PaintedKind =
  | 'concrete'
  | 'pavement'
  | 'granite'
  | 'checker'
  | 'parquet'
  | 'ceramic'
  | 'marble'
  | 'block'
  | 'corrugated'
  | 'brick'
  | 'panels'
  | 'timber'
  // Pintura látex sobre revoque (muros de la escuela, fachada).
  | 'plaster'
  // Tela de cortina con sus pliegues verticales.
  | 'fabric'
  // Piso de goma (bandas del hall, vinílico del Aula Maker).
  | 'rubber'
  // Árido fino sin juntas: asfalto, cemento alisado, tierra apisonada.
  | 'aggregate'
  // Chapa semillada (diamantada) de la escalera del edificio de bloque.
  | 'treadPlate';

export const PAINTED_KINDS: readonly PaintedKind[] = [
  'concrete',
  'pavement',
  'granite',
  'checker',
  'parquet',
  'ceramic',
  'marble',
  'block',
  'corrugated',
  'brick',
  'panels',
  'timber',
  'plaster',
  'fabric',
  'rubber',
  'aggregate',
  'treadPlate',
];

/**
 * Metros que cubre UNA repetición de cada textura cuando se aplica en
 * coordenadas de mundo (materiales "métricos" de la escuela, ver
 * `Materials`). Es el tamaño real de las piezas: granito de 40 cm (4 por
 * lado), bloque de 40 × 20, ladrillo de 26 × 6,5, chapa con onda cada 7,6 cm.
 * Con él se convierte la altura (mm) en pendiente para el mapa de normales.
 */
export const PERIOD_M: Record<PaintedKind, number> = {
  concrete: 2.4,
  pavement: 1.2,
  granite: 1.6,
  checker: 1.6,
  parquet: 1.6,
  ceramic: 0.66,
  marble: 1.2,
  block: 0.8,
  corrugated: 0.912,
  brick: 0.52,
  panels: 0.6,
  timber: 1.2,
  plaster: 1.8,
  fabric: 0.9,
  rubber: 0.5,
  aggregate: 2,
  // 8 × 8 lágrimas a 3 cm.
  treadPlate: 0.24,
};

/**
 * Ganancia del relieve sobre la pendiente física. 1 = el milímetro de la
 * altura es un milímetro real; a 256 px por repetición un píxel mide 3-9 mm,
 * así que el grano más fino queda por debajo de la resolución y se compensa
 * un poco. Las juntas ya miden lo suyo: no se exageran (un piso con juntas de
 * 5 mm de hondo parece adoquinado).
 */
const RELIEF_GAIN: Record<PaintedKind, number> = {
  concrete: 1.6,
  pavement: 1.3,
  granite: 1.1,
  checker: 1.1,
  parquet: 1.2,
  ceramic: 1.1,
  marble: 1.1,
  block: 1.2,
  corrugated: 1,
  brick: 1.3,
  panels: 1.2,
  timber: 1.4,
  // 1,3 y no 2,2: con el relieve repetido ×2,5 (ver Textures.relief) el
  // grano fino ya se lee; más fuerte volvía a parecer granulado grueso.
  plaster: 1.3,
  fabric: 1,
  rubber: 1.4,
  aggregate: 1.4,
  treadPlate: 1,
};

type Shade = (x: number, y: number) => number | [number, number, number];

/** Celdas de áridos del granito por lado de la textura (2 cm cada una). */
const CHIP_CELLS = 80;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Hash entero → [0, 1). Grano de un píxel, sin estado. */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Junta con bisel: devuelve el factor de un píxel según su distancia (en px)
 * al borde de la pieza. Dentro de la junta, `joint`; en el primer píxel de la
 * pieza, una arista apenas más clara; después, 1.
 */
function jointFactor(d: number, width: number, joint: number, bevel = 1.04): number {
  if (d < width) return joint;
  if (d < width + 1) return bevel;
  return 1;
}

/**
 * Perfil de altura de una junta (mm): `-depth` en el fondo y una arista
 * redondeada de `round` px hasta la cara de la pieza. Sin el redondeo, la
 * pendiente de un solo píxel daba una línea de luz dura que titilaba.
 */
function groove(d: number, width: number, depth: number, round = 1.5): number {
  return -depth * (1 - smooth(width - 0.5, width + round, d));
}

/**
 * Suciedad y desgaste junto a la junta: la pastina junta mugre y el canto de
 * la pieza se gasta. Factor de brillo (≤ 1) que cae a `1 - amount` pegado a
 * la junta y vuelve a 1 a `reach` px.
 */
function edgeGrime(d: number, width: number, reach: number, amount: number): number {
  return 1 - amount * (1 - smooth(width, width + reach, d));
}

/** Distancia al borde más cercano de una pieza de `w × h` px. */
function edgeDist(lx: number, ly: number, w: number, h: number): number {
  return Math.min(lx, ly, w - 1 - lx, h - 1 - ly);
}

/**
 * Campo de baja frecuencia (fBm de 3 octavas, 4 celdas por lado) calculado a
 * un cuarto de resolución por lado e interpolado. Es la capa más cara de casi
 * todas las superficies y no tiene detalle de un píxel: calcularla en 1/16 de
 * los píxeles baja el costo total de las texturas a menos de la mitad, que en
 * un visor autónomo (CPU ~3 veces más lenta) es tiempo de carga real.
 */
function lowField(noise: TileableNoise, size: number): (x: number, y: number) => number {
  // Un cuarto de la resolución por lado: la octava más fina tiene 16 celdas
  // por lado, así que 64 muestras siguen siendo 4 por celda.
  const n = size >> 2;
  const field = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) field[y * n + x] = noise.fbm((x / n) * 4, (y / n) * 4, 3);
  }
  return (x, y) => {
    const fx = x / 4;
    const fy = y / 4;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const x1 = (x0 + 1) % n;
    const y1 = (y0 + 1) % n;
    const a = field[y0 * n + x0] + (field[y0 * n + x1] - field[y0 * n + x0]) * tx;
    const b = field[y1 * n + x0] + (field[y1 * n + x1] - field[y1 * n + x0]) * tx;
    return a + (b - a) * ty;
  };
}

/**
 * Los pintores de cada superficie. Cada uno devuelve el color del píxel y
 * deja su altura (mm, 0 = cara de la pieza) en `out.h`.
 */
function painters(size: number, seed: number, out: { h: number }): Record<PaintedKind, Shade> {
  const big = new TileableNoise(seed, 4);
  const mid = new TileableNoise(seed ^ 0x51ed, 16);
  // Grano de dos píxeles: suave, a diferencia del hash de un píxel, que como
  // relieve parpadea con cada movimiento de cabeza (sobre todo en el visor).
  const fine = new TileableNoise(seed ^ 0x2c1b, size >> 1);
  const low = lowField(big, size);
  // Ruido de valor de alta frecuencia: piedritas del árido y polvo del cemento
  // del granito (sus áridos grandes son granos, ver granite). Cada uso pasa
  // su propio período.
  const chips = new TileableNoise(seed ^ 0x6a09, 96);
  const grain = (x: number, y: number) => fine.noise(x / 2, y / 2);
  const s = size;

  return {
    /** Hormigón: manchas, grano, poros y juntas de encofrado muy tenues. */
    concrete: (x, y) => {
      const u = (x / s) * 4;
      const v = (y / s) * 4;
      const m = mid.noise(u * 4, v * 4);
      let val = 0.91 + (low(x, y) - 0.5) * 0.18 + (m - 0.5) * 0.06;
      val += (hash(x, y, seed) - 0.5) * 0.06;
      const g = grain(x, y);
      out.h = (g - 0.5) * 0.5 + (m - 0.5) * 0.6;
      if (hash(x, y, seed + 7) < 0.005) {
        val *= 0.72; // poro
        out.h -= 0.8;
      }
      // Juntas de encofrado apenas marcadas: en la fachada (concreteXL) la
      // retícula se repite decenas de veces y, marcada, se leía como azulejo.
      const fx = x % (s / 4);
      const fy = y % (s / 4);
      if (fx === 0 || fy === 0) {
        val *= 0.965;
        out.h -= 0.3;
      }
      return val;
    },

    /** Losetas de vereda o del hall: 4 × 4, tono por pieza, desgaste. */
    pavement: (x, y) => {
      const t = s / 4;
      const tx = Math.floor(x / t);
      const ty = Math.floor(y / t);
      const tone = 0.94 + (hash(tx, ty, seed) - 0.5) * 0.08;
      let val = tone + (low(x, y) - 0.5) * 0.1;
      val += (hash(x, y, seed + 1) - 0.5) * 0.06;
      const d = edgeDist(x - tx * t, y - ty * t, t, t);
      out.h = groove(d, 1.5, 2) + (grain(x, y) - 0.5) * 0.35;
      // Canto de la loseta con un poco de mugre y gastado.
      val *= edgeGrime(d, 1.5, 4, 0.05);
      return val * jointFactor(d, 1.5, 0.64);
    },

    /**
     * Granito reconstituido: áridos claros y oscuros de dos tamaños sobre un
     * cemento gris, pulido (manchas de encerado), paños de 40 cm con junta fina.
     */
    granite: (x, y) => {
      const t = s / 4;
      const tx = Math.floor(x / t);
      const ty = Math.floor(y / t);
      let val = 0.9 + (hash(tx, ty, seed) - 0.5) * 0.06;
      // Áridos: un grano elíptico por celda de una retícula de 80 por lado
      // (2 cm), corrido al azar dentro de su celda, girado y con su tamaño y
      // su tono (oscuro, claro o medio). Antes eran ruido de valor
      // umbralizado: las manchas seguían la retícula del ruido y a menos de
      // 2 m el piso se leía como camuflaje de píxeles, no como piedra partida.
      // El borde se suaviza un píxel (sin escalera al acercarse).
      const cs = s / CHIP_CELLS;
      const gx = x / cs;
      const gy = y / cs;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      let cover = 0;
      let tone = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          // Celdas envueltas: el grano que cruza el borde reaparece del otro
          // lado y la textura repite sin costura.
          const kx = (((ix + ox) % CHIP_CELLS) + CHIP_CELLS) % CHIP_CELLS;
          const ky = (((iy + oy) % CHIP_CELLS) + CHIP_CELLS) % CHIP_CELLS;
          const h0 = hash(kx, ky, seed + 101);
          if (h0 > 0.62) continue; // celda sin grano: cemento
          const dx = gx - (ix + ox + 0.2 + hash(kx, ky, seed + 102) * 0.6);
          const dy = gy - (iy + oy + 0.2 + hash(kx, ky, seed + 103) * 0.6);
          if (Math.abs(dx) > 0.75 || Math.abs(dy) > 0.75) continue;
          const ang = hash(kx, ky, seed + 104) * Math.PI;
          const ca = Math.cos(ang);
          const sn = Math.sin(ang);
          const r = 0.2 + hash(kx, ky, seed + 105) * 0.34;
          const asp = 0.55 + hash(kx, ky, seed + 106) * 0.45;
          const px = dx * ca + dy * sn;
          const py = (-dx * sn + dy * ca) / asp;
          const cv = smooth(r + 0.5 / cs, r - 0.5 / cs, Math.hypot(px, py));
          if (cv > cover) {
            cover = cv;
            tone = h0 / 0.62;
          }
        }
      }
      // Polvo de árido fino del cemento entre los granos.
      const c = chips.noise((x / s) * 160 + 5.5, (y / s) * 160 + 3.5, 160);
      if (c > 0.7) val -= 0.08;
      else if (c < 0.22) val += 0.03;
      val += ((tone < 0.45 ? 0.52 + tone * 0.25 : tone < 0.8 ? 1.0 : 0.72) - val) * cover;
      val += (hash(x, y, seed + 9) - 0.5) * 0.05;
      val += (low(x, y) - 0.5) * 0.08;
      const d = edgeDist(x - tx * t, y - ty * t, t, t);
      // Pulido: los áridos quedan al ras. Sólo la junta y una ondulación
      // mínima del pulido a máquina.
      out.h = groove(d, 1, 1.2) + (grain(x, y) - 0.5) * 0.08;
      val *= edgeGrime(d, 1, 3, 0.04);
      return val * jointFactor(d, 1, 0.62, 1.02);
    },

    /** Damero del comedor: gris oscuro y claro con pastina. */
    checker: (x, y) => {
      const t = s / 4;
      const tx = Math.floor(x / t);
      const ty = Math.floor(y / t);
      const dark = (tx + ty) % 2 === 0;
      let val = dark ? 0.32 + hash(tx, ty, seed) * 0.03 : 0.85 + hash(tx, ty, seed) * 0.04;
      val *= 1 + (low(x, y) - 0.5) * 0.08;
      val += (hash(x, y, seed + 2) - 0.5) * 0.03;
      const d = edgeDist(x - tx * t, y - ty * t, t, t);
      out.h = groove(d, 1, 1.2) + (grain(x, y) - 0.5) * 0.08;
      if (!dark) val *= edgeGrime(d, 1, 3, 0.05);
      return val * jointFactor(d, 1, dark ? 0.85 : 0.4, 1.03);
    },

    /**
     * Parquet en cesta (aula de danzas): cuatro tablillas por paño, con su
     * tono, su veta a lo largo y una ranura oscura entre tablillas.
     */
    parquet: (x, y) => {
      const cell = s / 4;
      const slat = cell / 4;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const vertical = (cx + cy) % 2 === 0;
      const lx = x - cx * cell;
      const ly = y - cy * cell;
      const k = Math.floor((vertical ? lx : ly) / slat);
      const tone = 0.8 + hash(cx * 4 + k, cy, seed) * 0.2;
      const along = vertical ? y : x;
      const across = vertical ? x : y;
      const grainW = mid.noise((along / s) * 2 + k * 0.37, (across / s) * 48, 2, 48);
      let val = tone * (0.9 + grainW * 0.12) + (hash(x, y, seed + 4) - 0.5) * 0.04;
      const inSlat = (vertical ? lx : ly) - k * slat;
      const d = Math.min(inSlat, slat - 1 - inSlat, vertical ? ly : lx, cell - 1 - (vertical ? ly : lx));
      // Veta apenas abierta bajo el plastificado y ranura fina entre tablillas.
      out.h = groove(d, 1, 0.9, 1) + (grainW - 0.5) * 0.12;
      val *= jointFactor(d, 1, 0.58, 1.03);
      return [val, val * 0.925, val * 0.83];
    },

    /** Cerámico esmaltado de 33 cm: cuerpo parejo, pastina ancha y bisel. */
    ceramic: (x, y) => {
      const t = s / 2;
      const tx = Math.floor(x / t);
      const ty = Math.floor(y / t);
      let val = 0.955 + (hash(tx, ty, seed) - 0.5) * 0.03;
      val += (low(x, y) - 0.5) * 0.04;
      val += (hash(x, y, seed + 6) - 0.5) * 0.02;
      const d = edgeDist(x - tx * t, y - ty * t, t, t);
      // Canto almohadillado del esmalte: baja redondeado hasta la pastina,
      // que queda 1,5 mm abajo.
      out.h = -1.5 * (1 - smooth(1.5, 5, d));
      if (d < 2) return val * 0.7;
      if (d < 3) return val * 0.88; // canto redondeado, en sombra
      if (d < 4) return val * 1.03;
      return val;
    },

    /** Placas símil mármol: vetas finas onduladas, juntas trabadas. */
    marble: (x, y) => {
      const u = x / s;
      const v = y / s;
      const h = s / 4;
      const row = Math.floor(y / h);
      const off = (row % 2) * (s / 2);
      const px = (x + off) % s;
      const plate = Math.floor(px / (s / 2));
      let val = 0.95 + (hash(plate, row, seed) - 0.5) * 0.06;
      const w = low(x, y);
      // Veta: bandas diagonales deformadas por turbulencia (el modelo clásico
      // del mármol), pocas por placa y con una intensidad que va y viene. Cada
      // placa tiene su fase: la veta no cruza la junta, como en placas reales
      // cortadas de distintas partes del bloque. La versión anterior trazaba
      // muchas líneas finas paralelas y se leía como curvas de nivel.
      const t = u * 2 + v + w * 1.6 + hash(plate, row, seed + 5) * 4;
      const vein = Math.abs(Math.sin(Math.PI * t));
      const fade = 0.35 + 0.65 * smooth(0.2, 0.55, mid.noise(u * 4 + plate * 1.7, v * 4 + row * 0.9, 4));
      val *= 1 - (0.2 * smooth(0.06, 0, vein) + 0.08 * smooth(0.25, 0, vein)) * fade;
      // Nubes suaves de fondo: el mármol no es un blanco liso.
      val += (w - 0.5) * 0.06 + (mid.noise(u * 16, v * 16) - 0.5) * 0.03;
      const d = Math.min(y - row * h, h - 1 - (y - row * h), px % (s / 2), s / 2 - 1 - (px % (s / 2)));
      out.h = groove(d, 1, 1);
      return val * jointFactor(d, 1, 0.66, 1.02);
    },

    /** Bloque de hormigón a la vista: cara porosa, junta profunda. */
    block: (x, y) => {
      const rows = 4;
      const h = s / rows;
      const w = s / 2;
      const r = Math.floor(y / h);
      const px = (x + (r % 2) * (w / 2)) % s;
      const c = Math.floor(px / w);
      let val = 0.9 + (hash(c, r, seed) - 0.5) * 0.1;
      val += (low(x, y) - 0.5) * 0.08;
      val += (hash(x, y, seed + 8) - 0.5) * 0.1;
      const d = edgeDist(px - c * w, y - r * h, w, h);
      // Junta tomada y rehundida ~6 mm; cara de árido grueso, áspera.
      out.h = groove(d, 2.5, 6, 2) + (grain(x, y) - 0.5) * 1.4;
      if (hash(x, y, seed + 11) < 0.012) {
        val *= 0.7;
        out.h -= 1.2;
      }
      return val * jointFactor(d, 2.5, 0.55, 1.05);
    },

    /**
     * Chapa acanalada vertical: la onda da luz y sombra propias aunque la
     * superficie sea plana, y unas chorreaduras verticales la ensucian.
     */
    corrugated: (x, y) => {
      const u = x / s;
      const v = y / s;
      const rib = Math.cos(u * 12 * Math.PI * 2);
      // La onda está también en el relieve (18 mm de alto): el sombreado
      // pintado se modera para no contarla dos veces donde hay normales.
      let val = 0.84 + 0.16 * rib + 0.05 * Math.max(0, rib) ** 8;
      out.h = rib * 9;
      // Chorreaduras: ruido de 16 celdas a lo ancho y 2 a lo alto.
      val *= 0.94 + 0.06 * mid.noise(u * 16, v * 2, 16, 2);
      val += (hash(x, y, seed) - 0.5) * 0.04;
      return val;
    },

    /**
     * Ladrillo común pintado a la cal: tono por pieza, junta en sombra. Dos
     * ladrillos por hilada (26 × 6,5 cm con el período métrico): con cuatro
     * medían 13 cm de largo, la mitad de un ladrillo real.
     */
    brick: (x, y) => {
      const rows = 8;
      const h = s / rows;
      const w = s / 2;
      const r = Math.floor(y / h);
      const px = (x + (r % 2) * (w / 2)) % s;
      const c = Math.floor(px / w);
      let val = 0.9 + (hash(c, r, seed) - 0.5) * 0.09;
      val += (low(x, y) - 0.5) * 0.05;
      val += (hash(x, y, seed + 3) - 0.5) * 0.05;
      const d = edgeDist(px - c * w, y - r * h, w, h);
      out.h = groove(d, 2, 3, 1.5) + (grain(x, y) - 0.5) * 0.8;
      if (hash(x >> 1, y >> 1, seed + 12) < 0.006) {
        val *= 0.8; // descascarado
        out.h -= 0.6;
      }
      return val * jointFactor(d, 2, 0.74, 1.03);
    },

    /** Placa de cielorraso de 60 × 60: fibra mineral picada y perfil. */
    panels: (x, y) => {
      let val = 0.95 + (low(x, y) - 0.5) * 0.04;
      const pit = hash(x, y, seed);
      out.h = (grain(x, y) - 0.5) * 0.3;
      if (pit < 0.04) {
        val -= 0.1 + pit;
        out.h -= 0.5;
      }
      const d = edgeDist(x, y, s, s);
      // La placa apoya en el perfil T: canto rebajado de ~4 mm.
      out.h += groove(d, 3, 4, 1.5);
      if (d < 3) return val * 0.74;
      if (d < 4) return val * 1.04;
      return val;
    },

    /** Madera: veta longitudinal ondulada, poros alargados. */
    timber: (x, y) => {
      const u = x / s;
      const v = y / s;
      // Tablas de ~15 cm a lo largo de u, cada una con su tono y su fase de
      // veta. La veta corre casi recta (apenas ondulada): la anterior, de
      // anillos anchos y muy ondulados, se leía como dibujo animado.
      const plank = Math.floor(y / (s / 8));
      const py = y - plank * (s / 8);
      const tone = 0.87 + (hash(plank, 3, seed) - 0.5) * 0.1;
      const warp = low(x, y);
      const rings = Math.sin((v * 64 + warp * 1.2 + plank * 0.37) * Math.PI * 2);
      const pores = mid.noise(u * 4, v * 128, 4, 128);
      let val = tone + rings * 0.035 + (pores - 0.5) * 0.07;
      val += (hash(x, y, seed) - 0.5) * 0.03;
      // Unión entre tablas: una línea fina apenas más oscura.
      const seam = py === 0 ? 0.9 : 1;
      out.h = rings * 0.06 + (pores - 0.5) * 0.2 + (py === 0 ? -0.4 : 0);
      val *= seam;
      return [val, val * 0.94, val * 0.86];
    },

    /**
     * Látex sobre revoque fino: el color es casi parejo (la pintura cubre),
     * pero la cara tiene la piel de naranja del rodillo y las ondas suaves de
     * la llana, que con luz rasante es lo que separa una pared de un plano.
     */
    plaster: (x, y) => {
      const u = (x / s) * 4;
      const v = (y / s) * 4;
      const m = mid.noise(u * 2, v * 2, 8);
      const g = grain(x, y);
      let val = 0.95 + (low(x, y) - 0.5) * 0.035 + (m - 0.5) * 0.015 + (g - 0.5) * 0.02;
      out.h = (m - 0.5) * 1.1 + (g - 0.5) * 0.28 + (low(x, y) - 0.5) * 0.8;
      // Algún poro del revoque que la pintura no llegó a tapar.
      if (hash(x, y, seed + 21) < 0.0008) {
        val *= 0.9;
        out.h -= 0.4;
      }
      return val;
    },

    /**
     * Cortina de tela: pliegues verticales de ancho desparejo (la onda no es
     * una senoide pura) y la trama fina del tejido. El pliegue hundido queda en
     * sombra también en el color, porque la luz rebotada no entra.
     */
    fabric: (x, y) => {
      const u = x / s;
      // Cinco pliegues por repetición, con la fase deformada por un ruido
      // periódico de baja frecuencia: cada pliegue tiene su ancho.
      const phase = u * 5 + (big.noise(u * 4, 0.5) - 0.5) * 0.7;
      const fold = Math.sin(phase * Math.PI * 2);
      const weave = ((x + y) & 1) * 0.5 + ((x - y) & 2) * 0.25;
      let val = 0.9 + fold * 0.08 + (weave - 0.5) * 0.03 + (hash(x, y, seed) - 0.5) * 0.02;
      val += (low(x, y) - 0.5) * 0.04;
      out.h = fold * 14 + (weave - 0.5) * 0.15;
      return val;
    },

    /**
     * Goma de piso: superficie mate con granulado fino en relieve (el
     * antideslizante) y algún grano más claro del reciclado.
     */
    rubber: (x, y) => {
      const g = grain(x, y);
      let val = 0.9 + (low(x, y) - 0.5) * 0.06 + (g - 0.5) * 0.06;
      out.h = (g - 0.5) * 0.9;
      const fleck = hash(x >> 1, y >> 1, seed + 31);
      if (fleck < 0.025) val += 0.12;
      return val;
    },

    /**
     * Árido fino sin juntas (calzadas, suelo del barrio, césped visto de
     * lejos): piedritas claras y oscuras de 1-2 cm en la matriz, manchas de
     * desgaste grandes y algún parche. Reemplaza a la loseta que se usaba en
     * las superficies enormes y que, estirada sobre una calle de 250 m, se
     * leía como un entablonado.
     */
    aggregate: (x, y) => {
      const g = grain(x, y);
      const a = chips.noise((x / s) * 96, (y / s) * 96, 96);
      let val = 0.9 + (low(x, y) - 0.5) * 0.14 + (g - 0.5) * 0.08;
      out.h = (g - 0.5) * 0.8;
      if (a > 0.76) {
        val += 0.08;
        out.h += 0.4;
      } else if (a < 0.2) {
        val -= 0.07;
        out.h -= 0.3;
      }
      val += (hash(x, y, seed) - 0.5) * 0.06;
      return val;
    },

    /**
     * Chapa semillada (la escalera negra del edificio de bloque, 8:37-8:41):
     * lágrimas de ~24 × 6 mm cada 3 cm, alternadas a ±45°, en relieve de
     * 1,2 mm. El color lo pone el material (casi negro): la lágrima apenas
     * más clara por el desgaste de la pisada.
     */
    treadPlate: (x, y) => {
      const cell = s / 8;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const lx = (x + 0.5 - cx * cell) / cell - 0.5;
      const ly = (y + 0.5 - cy * cell) / cell - 0.5;
      const flip = (cx + cy) % 2 === 0;
      const a = (flip ? lx + ly : lx - ly) * Math.SQRT1_2;
      const b = (flip ? lx - ly : lx + ly) * Math.SQRT1_2;
      const lug = smooth(1, 0.7, Math.hypot(a / 0.4, b / 0.1));
      out.h = lug * 1.2 + (grain(x, y) - 0.5) * 0.1;
      return 0.86 + lug * 0.1 + (low(x, y) - 0.5) * 0.06;
    },
  };
}

/** Píxeles y alturas de una superficie pintada. */
export interface PaintedSurface {
  /** RGBA de `size × size`. */
  rgba: Uint8ClampedArray;
  /** Altura de cada píxel en mm (0 = cara de la pieza). */
  height: Float32Array;
}

/**
 * Pinta un tipo de superficie y devuelve sus píxeles y su altura.
 * `size` debe ser múltiplo de 8 para que todas las piezas dividan el lado.
 */
export function paintSurfaceMaps(kind: PaintedKind, size = 256): PaintedSurface {
  const seed = seedFromString(`surface:${kind}`);
  const h = { h: 0 };
  const shade = painters(size, seed, h)[kind];
  const rgba = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h.h = 0;
      const c = shade(x, y);
      const p = y * size + x;
      const i = p * 4;
      height[p] = h.h;
      if (typeof c === 'number') {
        const g = clamp01(c) * 255;
        rgba[i] = g;
        rgba[i + 1] = g;
        rgba[i + 2] = g;
      } else {
        rgba[i] = clamp01(c[0]) * 255;
        rgba[i + 1] = clamp01(c[1]) * 255;
        rgba[i + 2] = clamp01(c[2]) * 255;
      }
      rgba[i + 3] = 255;
    }
  }
  return { rgba, height };
}

/** Sólo el color (compatibilidad con quien no usa el relieve). */
export function paintSurface(kind: PaintedKind, size = 256): Uint8ClampedArray {
  return paintSurfaceMaps(kind, size).rgba;
}


/**
 * Cuánto más rugoso es lo hundido, por milímetro de profundidad (tope 0,35):
 * la pastina y la junta son mate y juntan polvo; la cara de la baldosa está
 * pulida o encerada. Es lo que hace que el reflejo de la ventana sobre el
 * granito se corte en cada junta, como en un piso real. Cero en las
 * superficies cuyo relieve es una onda (chapa, tela, látex), donde "abajo"
 * no es una junta.
 */
const ROUGH_PER_MM: Record<PaintedKind, number> = {
  concrete: 0.15,
  pavement: 0.12,
  granite: 0.28,
  checker: 0.28,
  parquet: 0.25,
  ceramic: 0.2,
  marble: 0.28,
  block: 0.03,
  corrugated: 0,
  brick: 0.05,
  panels: 0.04,
  timber: 0,
  plaster: 0,
  fabric: 0,
  rubber: 0,
  aggregate: 0.1,
  treadPlate: 0,
};

/**
 * Relieve de una superficie en el formato del `detailMap` de Babylon:
 * R = brillo (0,5: neutro, el color ya está en la textura base), G/A = normal
 * en espacio tangente (y/x), B = rugosidad (0,5 neutra; más = más rugoso).
 *
 * Va por el mapa de DETALLE y no por el de normales a propósito: el
 * renderizador de geometría del SSAO usa el mapa de normales del material y
 * lo pasa por la matriz de mundo de la instancia; con las cajas escaladas de
 * la escuela (6 × 3 × 0,1 m) eso deforma la normal y el SSAO pintaba
 * manchones negros en las paredes. El mapa de detalle no lo ve.
 *
 * La normal sale de la altura en mm por diferencias centrales con borde
 * envuelto (repite sin costura igual que el color). La pendiente es física:
 * mm de altura sobre mm de píxel (`PERIOD_M` / tamaño), por la ganancia del
 * tipo. Convención: +x hacia donde crece la u y +y hacia donde crece la v
 * (fila siguiente del canvas, que se sube sin invertir), el marco que arma
 * Babylon con las derivadas de la UV cuando la malla no trae tangentes.
 * `size` debe ser potencia de 2 (el borde se envuelve con una máscara).
 */
export function reliefMap(kind: PaintedKind, height: Float32Array, size: number): Uint8ClampedArray {
  const pxMm = (PERIOD_M[kind] * 1000) / size;
  const k = RELIEF_GAIN[kind] / (2 * pxMm);
  const rough = ROUGH_PER_MM[kind];
  const out = new Uint8ClampedArray(size * size * 4);
  const m = size - 1;
  for (let y = 0; y < size; y++) {
    const yu = ((y - 1) & m) * size;
    const yd = ((y + 1) & m) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const dx = (height[row + ((x + 1) & m)] - height[row + ((x - 1) & m)]) * k;
      const dy = (height[yd + x] - height[yu + x]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const r = Math.min(0.35, Math.max(0, -height[row + x]) * rough);
      const i = (row + x) * 4;
      out[i] = 128;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (0.5 + r) * 255;
      out[i + 3] = (-dx * inv * 0.5 + 0.5) * 255;
    }
  }
  return out;
}

/**
 * Variación de gran escala en formato ORM (R = oclusión ambiente, G =
 * multiplicador de rugosidad, B = metalicidad, que queda en 1).
 *
 * Rompe la repetición de las texturas base, que repiten cada 0,5-2 m: un
 * pasillo de 30 m mostraba la misma mancha de encerado cada 1,6 m. Este mapa
 * se aplica con un período grande y NO múltiplo del de la base (ver
 * `Textures.MACRO_PERIOD_M`), así cada paño cae sobre otra parte de él: zonas
 * apenas más apagadas (la luz ambiente llega menos limpia) y zonas más o
 * menos lustrosas. `traffic` agrega las marcas de uso de un piso: rayones de
 * suela, más lisos (la goma deja su brillo) y apenas más oscuros.
 */
export function paintMacro(size: number, traffic: boolean): Uint8ClampedArray {
  const seed = seedFromString(traffic ? 'macro:floor' : 'macro:wall');
  const big = new TileableNoise(seed, 3);
  const midN = new TileableNoise(seed ^ 0x77, 7);
  const streak = new TileableNoise(seed ^ 0x1234, 24);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const a = big.fbm(u * 3, v * 3, 3);
      const b = midN.noise(u * 7, v * 7);
      let ao = 0.95 + (a - 0.5) * 0.12 + (b - 0.5) * 0.04;
      let rough = 0.9 + (a - 0.5) * 0.18 + (b - 0.5) * 0.12;
      if (traffic) {
        // Trazos finos y largos en dos direcciones.
        const s1 = streak.noise(u * 24, v * 3, 24, 3);
        const s2 = streak.noise(v * 24 + 7.3, u * 3, 24, 3);
        const mark = smooth(0.78, 0.9, Math.max(s1, s2));
        ao -= mark * 0.05;
        rough -= mark * 0.12;
      }
      const i = (y * size + x) * 4;
      out[i] = clamp01(ao) * 255;
      out[i + 1] = clamp01(rough) * 255;
      out[i + 2] = 255;
      out[i + 3] = 255;
    }
  }
  return out;
}
