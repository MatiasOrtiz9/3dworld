import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import type { NatureBuilder } from './NatureBuilder';
import type { StreetLevel } from './StreetLevel';
import { PALETTE } from '../Palette';
import { FLAG, SCHOOL, toWorld, type SchoolFrame } from '../SchoolLayout';

/**
 * Letras en una grilla de 5 × 7 (3 × 7 la I). Cada '#' es un cubo; las
 * corridas horizontales se funden en una sola caja para gastar lo mínimo.
 */
const GLYPHS: Record<string, string[]> = {
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
};

/**
 * Campus de la escuela CIMDIP & Miguel Cané.
 *
 * No replica planos reales: es una reconstrucción artística que tiene que
 * reconocerse de un vistazo como ESCUELA —y como esta escuela— en vez de como
 * un equipamiento genérico más. Lo que la hace legible:
 *
 *  - Bloque de aulas de tres pisos con ventanas en serie, aleros y parasoles:
 *    la tipología de escuela, no la de oficina ni la de vivienda.
 *  - Hall de acceso pasante bajo un panel institucional verde con el nombre,
 *    un reloj y las letras CIMDIP sobre la azotea, visibles desde la plaza.
 *  - Reja con zócalo de ladrillo y portón, mástil con la bandera, tótem.
 *  - Patio entre dos alas con la cancha pintada, aros y bancos; huerta al fondo.
 *
 * Todo está en coordenadas locales (ver `SchoolLayout`) y rota con la manzana,
 * así que la entrada siempre mira hacia la plaza. Las superficies con texto o
 * pintura (cartel, tótem, cancha, bandera) viven en `SchoolIdentity`.
 */
export class SchoolBuilder {
  private f!: SchoolFrame;
  private readonly m: {
    wall: Material;
    slab: Material;
    brick: Material;
    green: Material;
    gold: Material;
    glass: Material;
    timber: Material;
    metal: Material;
    paver: Material;
    hedge: Material;
    glow: Material;
    white: Material;
    letters: Material;
  };

  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly rng: Rng,
    private readonly nature: NatureBuilder,
    private readonly street: StreetLevel,
  ) {
    this.m = {
      wall: mats.surface(PALETTE.schoolCream, 0.8, 0, 'concreteXL'),
      slab: mats.surface(PALETTE.concreteLight, 0.75, 0, 'concrete'),
      brick: mats.surface(PALETTE.brick, 0.86, 0, 'concrete'),
      green: mats.surface(PALETTE.schoolGreen, 0.5, 0.12, 'metal'),
      gold: mats.surface(PALETTE.schoolGold, 0.38, 0.28, 'metal'),
      glass: mats.glass(PALETTE.glassBlue, 0.9),
      timber: mats.surface(PALETTE.timberMid, 0.85, 0, 'timber'),
      metal: mats.metal(PALETTE.solarFrame, 0.4),
      paver: mats.surface(PALETTE.concreteLight, 0.88, 0, 'pavement'),
      hedge: mats.grass(PALETTE.leafDeep),
      glow: mats.glow(PALETTE.glassLit, 0.7),
      white: mats.surface(PALETTE.turbineBody, 0.6, 0, null),
      // Las letras son pintura clara y mate, no metal: el dorado metálico con
      // tan poco IBL se veía caqui oscuro contra el cielo.
      letters: mats.surface(PALETTE.sun, 0.5, 0, null),
    };
  }

  build(frame: SchoolFrame): void {
    this.f = frame;
    this.grounds();
    this.frontBlock();
    this.wings();
    this.roofLetters();
    this.courtyard();
    this.garden();
    this.forecourt();
    this.fence();
  }

  // --------------------------------------------------------------- utilidades

  /** Caja apoyada en `y`, en coordenadas locales. */
  private box(mat: Material, u: number, v: number, w: number, h: number, d: number, y = 0): void {
    const p = toWorld(this.f, u, v);
    this.farm.addBoxOnGround(mat, p.x, p.z, w, h, d, y, this.f.rot);
  }

  private cyl(mat: Material, u: number, v: number, dia: number, h: number, y = 0): void {
    const p = toWorld(this.f, u, v);
    this.farm.add('cylinder', mat, new Vector3(p.x, y + h / 2, p.z), new Vector3(dia, h, dia));
  }

  /** Dimensiones mundo de un rectángulo local alineado (para ayudantes no rotables). */
  private dims(w: number, d: number): [number, number] {
    return Math.abs(this.f.sin) === 1 ? [d, w] : [w, d];
  }

  /**
   * Ventana: marco verde saliente, vidrio apenas por delante y parteluz.
   * `nu`/`nv` es la normal de la fachada en coordenadas locales.
   */
  private window(u: number, v: number, y: number, nu: number, nv: number, width = 2.3): void {
    const { green, glass } = this.m;
    const alongU = nv !== 0;
    const n = alongU ? nv : nu;
    const at = (off: number): [number, number] => (alongU ? [u, v + n * off] : [u + n * off, v]);
    const size = (w: number, t: number): [number, number] => (alongU ? [w, t] : [t, w]);

    let [pu, pv] = at(0.1);
    let [sw, sd] = size(width + 0.28, 0.2);
    this.box(green, pu, pv, sw, 2.05, sd, y);
    [pu, pv] = at(0.225);
    [sw, sd] = size(width, 0.05);
    this.box(glass, pu, pv, sw, 1.76, sd, y + 0.145);
    [pu, pv] = at(0.26);
    [sw, sd] = size(0.07, 0.03);
    this.box(green, pu, pv, sw, 1.76, sd, y + 0.145);
    // Aulas con la luz prendida: se encienden con el resto de las ventanas de
    // la ciudad al caer el sol (grupo conmutado por City.setLitWindows).
    if (this.rng.chance(0.55)) {
      [pu, pv] = at(0.253);
      [sw, sd] = size(width - 0.1, 0.01);
      this.box(this.m.glow, pu, pv, sw, 1.66, sd, y + 0.195);
    }
  }

  /**
   * Banco de listones con respaldo. `facingV` dice si el banco mira a lo
   * largo de v; `backSign` hacia qué lado queda el respaldo.
   */
  private bench(u: number, v: number, facingV: boolean, backSign = 1): void {
    const { timber, green } = this.m;
    const [w, d] = facingV ? [1.9, 0.5] : [0.5, 1.9];
    this.box(timber, u, v, w, 0.08, d, 0.42);
    const back: [number, number] = facingV ? [0, 0.22 * backSign] : [0.22 * backSign, 0];
    const [bw, bd] = facingV ? [1.9, 0.06] : [0.06, 1.9];
    this.box(timber, u + back[0], v + back[1], bw, 0.4, bd, 0.55);
    for (const s of [-1, 1]) {
      const lu = facingV ? u + s * 0.78 : u;
      const lv = facingV ? v : v + s * 0.78;
      const [lw, ld] = facingV ? [0.08, 0.46] : [0.46, 0.08];
      this.box(green, lu, lv, lw, 0.42, ld, 0);
    }
  }

  // -------------------------------------------------------------------- suelo

  /** Solados del campus: explanada, hall, patio y huerta. */
  private grounds(): void {
    const S = SCHOOL;
    // Un único solado claro para todo lo transitable dentro de la reja. Mide
    // 5 cm: la multitud y el jugador lo pisan a esa altura (CityIndex).
    this.box(this.m.paver, 0, -2.5, 40.4, 0.05, 35.4, 0);
    // Franja de ladrillo que marca el eje de ingreso: portón → hall → patio.
    this.box(this.m.brick, 0, (S.fenceV + S.frontBackV) / 2, S.lobbyHalf * 2 - 0.8, 0.02, S.frontBackV - S.fenceV, 0.05);
    // Huerta: tierra en vez de solado.
    this.box(this.mats.surface(PALETTE.soil, 0.95, 0, null), 0, 16.3, 40.4, 0.07, 7.4, 0);
  }

  // ------------------------------------------------------------ bloque frente

  private frontBlock(): void {
    const S = SCHOOL;
    const { wall, slab, brick, green, timber, glass, glow } = this.m;
    const vc = (S.frontV + S.frontBackV) / 2;
    const depth = S.frontBackV - S.frontV;
    const W = S.halfWidth * 2;
    const H = S.frontFloors * S.floorH;
    const sideW = S.halfWidth - S.lobbyHalf;
    const sideU = (S.halfWidth + S.lobbyHalf) / 2;

    // Planta baja partida por el hall pasante; pisos altos corridos encima.
    for (const s of [-1, 1]) {
      this.box(wall, s * sideU, vc, sideW, S.floorH, depth, 0);
      // Zócalo de ladrillo, apenas saliente.
      this.box(brick, s * sideU, vc, sideW + 0.12, 0.75, depth + 0.12, 0);
      // Vidrio de los locales que dan al hall.
      this.box(glass, s * (S.lobbyHalf - 0.03), vc, 0.08, 2.4, depth - 3, 0.5);
    }
    this.box(wall, 0, vc, W, H - S.floorH, depth, S.floorH);
    // Losas salientes: leen los pisos desde lejos.
    for (let f = 1; f < S.frontFloors; f++) {
      this.box(slab, 0, vc, W + 0.5, 0.3, depth + 0.5, f * S.floorH - 0.15);
    }
    // Pretil de azotea.
    this.box(slab, 0, vc, W + 0.5, 0.75, depth + 0.5, H);
    // Techo del hall con luminarias.
    this.box(slab, 0, vc, S.lobbyHalf * 2, 0.12, depth, S.floorH - 0.12);
    this.box(glow, 0, vc, 1, 0.04, depth - 2.4, S.floorH - 0.16);

    // Fachada principal: ventanas en serie, salvo el panel institucional.
    const bays = 11;
    const step = 3.4;
    for (let f = 0; f < S.frontFloors; f++) {
      const y = f * S.floorH + 0.9;
      for (let k = 0; k < bays; k++) {
        const u = (k - (bays - 1) / 2) * step;
        const skip = f === 0 ? Math.abs(u) < S.lobbyHalf + 1.5 : Math.abs(u) < 3.4;
        if (skip) continue;
        this.window(u, S.frontV, y, 0, -1);
        // Fachada del patio: sólo donde no la tapan las alas.
        const hiddenByWing = f < S.wingFloors && Math.abs(u) > S.wingInner - 1.3;
        // En planta baja, del lado izquierdo del hall, va el mural del patio.
        const mural = f === 0 && u < 0;
        if (!hiddenByWing && !mural) this.window(u, S.frontBackV, y, 0, 1);
      }
      // Alero de madera sobre cada fila de ventanas, cortado por el panel.
      for (const s of [-1, 1]) {
        this.box(timber, s * 11.35, S.frontV - 0.55, 15.9, 0.1, 0.9, f * S.floorH + 3.05);
      }
    }
    // Parasoles verticales en los pisos altos: ritmo de fachada escolar.
    for (let k = 0; k < bays - 1; k++) {
      const u = (k - (bays - 2) / 2) * step;
      if (Math.abs(u) < 3.5) continue;
      this.box(timber, u, S.frontV - 0.42, 0.14, H - S.floorH - 0.2, 0.6, S.floorH + 0.1);
    }

    // Panel institucional: verde, saliente, con el cartel y el reloj
    // (texturas en SchoolIdentity). Remate dorado arriba.
    this.box(green, 0, S.frontV - 0.18, 6.6, H - S.floorH + 0.75, 0.36, S.floorH);
    this.box(this.m.gold, 0, S.frontV - 0.38, 6.6, 0.12, 0.08, S.floorH + 0.2);

    // Marquesina de acceso sobre dos columnas.
    this.box(green, 0, S.frontV - 1.9, 9.4, 0.3, 3.8, S.floorH - 0.3);
    this.box(this.m.gold, 0, S.frontV - 3.82, 9.4, 0.3, 0.05, S.floorH - 0.3);
    for (const s of [-1, 1]) this.cyl(green, s * 4.3, S.frontV - 3.4, 0.24, S.floorH - 0.3);

    // Cubierta fotovoltaica detrás de las letras.
    this.solarRoof(0, -6.8, 34, 5.6, H + 0.75);
  }

  /** Pérgola de paneles sobre la azotea, inclinada hacia el sol. */
  private solarRoof(u: number, v: number, w: number, d: number, y: number): void {
    const { metal } = this.m;
    const legH = 1.6;
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) this.cyl(metal, u + (su * w) / 2.3, v + (sv * d) / 2.3, 0.18, legH, y);
    }
    // Largueros sobre las patas: cada fila de paneles apoya en algo.
    for (const su of [-1, 1]) this.box(metal, u + (su * w) / 2.3, v, 0.14, 0.12, d * 0.95, y + legH - 0.12);
    const rows = 2;
    for (let r = 0; r < rows; r++) {
      const pv = v - d / 2 + (r + 0.5) * (d / rows);
      const p = toWorld(this.f, u, pv);
      this.farm.add(
        'box',
        this.mats.solar(),
        new Vector3(p.x, y + legH, p.z),
        new Vector3(w, 0.1, (d / rows) * 0.86),
        this.f.rot,
        -0.3,
      );
    }
  }

  // --------------------------------------------------------------------- alas

  private wings(): void {
    const S = SCHOOL;
    const { wall, slab, brick } = this.m;
    const w = S.halfWidth - S.wingInner;
    const uc = (S.halfWidth + S.wingInner) / 2;
    const d = S.wingEndV - S.frontBackV;
    const vc = (S.wingEndV + S.frontBackV) / 2;
    const H = S.wingFloors * S.floorH;

    for (const s of [-1, 1]) {
      this.box(wall, s * uc, vc, w, H, d, 0);
      this.box(brick, s * uc, vc, w + 0.12, 0.75, d + 0.12, 0);
      this.box(slab, s * uc, vc, w + 0.5, 0.3, d + 0.5, S.floorH - 0.15);
      this.box(slab, s * uc, vc, w + 0.5, 0.45, d + 0.5, H);
      // Cubierta verde: la escuela también es infraestructura ambiental.
      this.box(this.mats.grass(PALETTE.leafMid), s * uc, vc, w - 0.6, 0.2, d - 0.6, H + 0.45);
      for (let i = 0; i < 4; i++) {
        const p = toWorld(this.f, s * uc + this.rng.range(-2.5, 2.5), vc + this.rng.range(-6, 6));
        this.nature.shrub(p.x, p.z, this.rng.range(0.5, 0.8), H + 0.62);
      }

      for (let f = 0; f < S.wingFloors; f++) {
        const y = f * S.floorH + 0.9;
        for (let k = 0; k < 4; k++) {
          const v = S.frontBackV + 2.2 + k * 3.45;
          this.window(s * S.wingInner, v, y, -s, 0); // al patio
          this.window(s * S.halfWidth, v, y, s, 0); // a la calle lateral
        }
        this.window(s * (uc - 2), S.wingEndV, y, 0, 1, 2);
        this.window(s * (uc + 2), S.wingEndV, y, 0, 1, 2);
      }
    }
  }

  /** Letras CIMDIP de chapa dorada sobre la azotea: el hito que se ve desde la plaza. */
  private roofLetters(): void {
    const S = SCHOOL;
    const cell = 0.34;
    const word = 'CIMDIP';
    const gap = 1.4; // columnas de separación
    const cols = [...word].reduce((n, ch) => n + GLYPHS[ch][0].length, 0) + gap * (word.length - 1);
    const baseY = S.frontFloors * S.floorH + 0.75 + 0.35;
    const v = S.frontV + 0.9;
    let col = -cols / 2;

    // Bastidor metálico detrás de las letras: zócalo sobre el pretil, dos
    // largueros pegados al dorso de las letras y montantes que los sostienen.
    const width = cols * cell + 0.6;
    const back = v + 0.13 + 0.06;
    this.box(this.m.metal, 0, v + 0.1, width, 0.35, 0.5, baseY - 0.35);
    this.box(this.m.metal, 0, back, width, 0.12, 0.12, baseY + 0.9);
    this.box(this.m.metal, 0, back, width, 0.12, 0.12, baseY + 1.9);
    for (let i = 0; i < 5; i++) {
      const u = (i / 4 - 0.5) * (width - 0.4);
      this.box(this.m.metal, u, back, 0.1, 2.1, 0.1, baseY);
    }

    for (const ch of word) {
      const rows = GLYPHS[ch];
      const w = rows[0].length;
      for (let r = 0; r < rows.length; r++) {
        const y = baseY + (rows.length - 1 - r) * cell;
        let run = 0;
        for (let c = 0; c <= w; c++) {
          if (c < w && rows[r][c] === '#') {
            run++;
            continue;
          }
          if (run > 0) {
            const start = c - run;
            const u = (col + start + run / 2) * cell;
            this.box(this.m.letters, u, v, run * cell, cell, 0.26, y);
            // Frente retroiluminado: sólo se ve de noche, con las ventanas.
            this.box(this.m.glow, u, v - 0.14, run * cell - 0.04, cell - 0.04, 0.01, y + 0.02);
          }
          run = 0;
        }
      }
      col += w + gap;
    }
  }

  // -------------------------------------------------------------------- patio

  private courtyard(): void {
    const { metal, white } = this.m;
    // Aros de básquet en los dos extremos de la cancha (pintada en SchoolIdentity).
    for (const s of [-1, 1]) {
      this.cyl(metal, s * 9.95, 4.6, 0.16, 3.25, 0.05);
      this.box(metal, s * 9.6, 4.6, 0.7, 0.1, 0.1, 3.05);
      this.box(white, s * 9.25, 4.6, 0.06, 1.05, 1.8, 2.7);
      this.cyl(this.mats.surface(PALETTE.signal, 0.6, 0, null), s * 8.98, 4.6, 0.46, 0.03, 3.05);
    }
    // Bancos contra las alas, mirando la cancha.
    for (const s of [-1, 1]) {
      for (const v of [0.6, 8.6]) this.bench(s * 10.35, v, false, s);
    }
  }

  private garden(): void {
    // Canteros elevados de la huerta escolar.
    for (const [u, v] of [
      [-13.5, 14.6],
      [-13.5, 18.2],
      [5.5, 14.6],
      [12.5, 14.6],
      [5.5, 18.2],
    ] as const) {
      const c = toWorld(this.f, u, v);
      const [w, d] = this.dims(5, 2);
      this.nature.planter(c.x, c.z, w, d, 0.07, 1.4);
    }
    // Invernadero chico: vidrio con estructura de madera.
    this.box(this.m.glass, 16.4, 17.6, 3.4, 2.5, 3.4, 0.07);
    this.box(this.m.timber, 16.4, 17.6, 3.6, 0.14, 3.6, 2.57);
    // Tanque de agua de lluvia.
    this.cyl(this.m.green, -18.2, 13.4, 1.3, 2.2, 0.07);
    // Árboles de fondo: dan sombra a la huerta y cierran el campus.
    for (const u of [-6.5, 0.5, 9]) {
      const p = toWorld(this.f, u, 19.2);
      this.nature.broadleaf(p.x, p.z, this.rng.range(0.9, 1.15), 0.07);
    }
  }

  // --------------------------------------------------------------- explanada

  private forecourt(): void {
    const S = SCHOOL;
    const { metal, slab } = this.m;
    // Mástil con la bandera (el paño está en SchoolIdentity).
    this.cyl(slab, FLAG.u, FLAG.v, 1.3, 0.35, 0.05);
    this.cyl(metal, FLAG.u, FLAG.v, 0.14, 9.6, 0.4);
    this.cyl(this.m.gold, FLAG.u, FLAG.v, 0.28, 0.22, 10);

    // Tótem con el nombre, junto al portón.
    this.box(this.m.green, -5.9, S.fenceV + 0.95, 1.5, 3.2, 0.42, 0.05);
    this.box(this.m.gold, -5.9, S.fenceV + 0.95, 1.55, 0.1, 0.46, 3.25);

    // Árboles y canteros a los lados de la explanada.
    for (const s of [-1, 1]) {
      const p = toWorld(this.f, s * 18.4, -16.8);
      this.nature.broadleaf(p.x, p.z, this.rng.range(0.95, 1.15), 0.05);
      this.bench(s * 11.6, -15.2, true);
    }
    // Bicicletero de alumnos.
    const r = toWorld(this.f, 12.8, S.fenceV + 1.3);
    this.street.bikeRack(r.x, r.z, this.f.rot);
  }

  // --------------------------------------------------------------------- reja

  private fence(): void {
    const S = SCHOOL;
    const { brick, green, hedge, gold } = this.m;
    const v = S.fenceV;
    const from = S.gateHalf + 0.4;
    const to = S.half;
    const len = to - from;
    for (const s of [-1, 1]) {
      const uc = s * (from + to) / 2;
      this.box(brick, uc, v, len, 0.55, 0.36, 0);
      this.box(green, uc, v, len, 0.07, 0.07, 2.2);
      this.box(green, uc, v, len, 0.06, 0.06, 0.95);
      // Barrotes cada 26 cm: la reja clásica de escuela.
      const bars = Math.floor(len / 0.26);
      for (let i = 0; i < bars; i++) {
        const u = s * (from + (i + 0.5) * (len / bars));
        this.box(green, u, v, 0.035, 1.68, 0.035, 0.55);
      }
      // Pilares del portón, de ladrillo con remate dorado.
      this.box(brick, s * S.gateHalf, v, 0.7, 2.6, 0.7, 0);
      this.box(gold, s * S.gateHalf, v, 0.8, 0.14, 0.8, 2.6);
      // Cercos vivos laterales.
      this.box(hedge, s * (S.half - 0.4), 0, 0.8, 1.3, S.half * 2 - 1, 0);
    }
    this.box(hedge, 0, S.half - 0.4, S.half * 2, 1.3, 0.8, 0);
  }
}
