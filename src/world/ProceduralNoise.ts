/**
 * Ruido de valor periódico, para texturas procedurales sin costura.
 *
 * Las texturas de la ciudad se repiten decenas de veces sobre un muro o un
 * piso: cualquier discontinuidad en el borde se ve como una grilla. Este
 * ruido envuelve su retícula cada `period` celdas, así que una textura que
 * recorre exactamente `period` unidades empalma consigo misma por
 * construcción, en todas las octavas.
 *
 * Es determinista (hash entero de la celda y la semilla, sin estado): la
 * misma semilla da siempre la misma textura, como exige la generación.
 * Datos puros: no importa nada del motor y se prueba en Node.
 */
export class TileableNoise {
  /**
   * Retículas ya calculadas, por período (px, py). Las texturas piden ruido
   * para cada uno de sus 65 536 píxeles, varias veces: con la tabla, cada
   * muestra son cuatro lecturas en vez de cuatro hashes, y la generación de
   * texturas (que en el visor corre en una CPU ~3 veces más lenta) baja a
   * menos de la mitad. Los valores son exactamente los del hash: la textura
   * no cambia.
   */
  private readonly lattices = new Map<number, Float64Array>();

  constructor(
    private readonly seed: number,
    /** Celdas de la retícula por repetición, en la octava base. */
    readonly period: number,
  ) {}

  /** Valor pseudoaleatorio en [0, 1) de una celda entera (ya envuelta). */
  private cell(ix: number, iy: number, px: number, py: number): number {
    const x = ((ix % px) + px) % px;
    const y = ((iy % py) + py) % py;
    let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(px, 0x9e3779b1) ^ this.seed) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Última tabla pedida: los pintores repiten el mismo período píxel a píxel. */
  private lastKey = -1;
  private lastTable: Float64Array | null = null;

  /** Tabla de la retícula de período (px, py), o null si no conviene. */
  private lattice(px: number, py: number): Float64Array | null {
    const key = px * 65536 + py;
    if (key === this.lastKey) return this.lastTable;
    if (!Number.isInteger(px) || !Number.isInteger(py) || px < 1 || py < 1 || px * py > 1 << 16) return null;
    let t = this.lattices.get(key);
    if (!t) {
      t = new Float64Array(px * py);
      for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) t[y * px + x] = this.cell(x, y, px, py);
      this.lattices.set(key, t);
    }
    this.lastKey = key;
    this.lastTable = t;
    return t;
  }

  /**
   * Ruido de valor suavizado en (x, y), con retícula periódica cada
   * `period` unidades (y `periodY` en vertical, si se quiere estirado: las
   * chorreaduras de una chapa son largas en un sentido y cortas en el otro).
   * Devuelve [0, 1).
   */
  noise(x: number, y: number, period = this.period, periodY = period): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    // Interpolación quíntica: sin la arista visible de la lineal.
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    let a: number;
    let b: number;
    let c: number;
    let d: number;
    const t = this.lattice(period, periodY);
    if (t) {
      const x0 = ((ix % period) + period) % period;
      const y0 = ((iy % periodY) + periodY) % periodY;
      const x1 = x0 + 1 === period ? 0 : x0 + 1;
      const r0 = y0 * period;
      const r1 = (y0 + 1 === periodY ? 0 : y0 + 1) * period;
      a = t[r0 + x0];
      b = t[r0 + x1];
      c = t[r1 + x0];
      d = t[r1 + x1];
    } else {
      a = this.cell(ix, iy, period, periodY);
      b = this.cell(ix + 1, iy, period, periodY);
      c = this.cell(ix, iy + 1, period, periodY);
      d = this.cell(ix + 1, iy + 1, period, periodY);
    }
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
  }

  /**
   * Suma fractal de octavas (fBm), normalizada a [0, 1).
   *
   * Cada octava duplica la frecuencia Y el período, así sigue siendo
   * periódica con el período de la octava base.
   */
  fbm(x: number, y: number, octaves = 4, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq, y * freq, this.period * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / norm;
  }
}
