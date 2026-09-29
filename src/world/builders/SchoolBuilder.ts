import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import type { NatureBuilder } from './NatureBuilder';
import type { StreetLevel } from './StreetLevel';
import { PALETTE } from '../Palette';
import { FLAG, SCHOOL, toWorld, type SchoolFrame } from '../SchoolLayout';

/**
 * Campus de la escuela CIMDIP & Miguel Cané.
 *
 * No replica planos reales: es una reconstrucción artística que tiene que
 * reconocerse de un vistazo como ESCUELA —y como esta escuela— en vez de como
 * un equipamiento genérico más. Lo que la hace legible:
 *
 *  - Bloque de aulas de dos pisos con ventanas en serie:
 *    la tipología de escuela, no la de oficina ni la de vivienda.
 *  - Hall de acceso pasante bajo un portal gris con el escudo y la marquesina
 *    institucional roja, visibles desde la plaza.
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
    roof: Material;
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
      wall: mats.surface(Color3.FromHexString('#85878a'), 0.86, 0, 'concreteXL'),
      slab: mats.surface(PALETTE.concreteLight, 0.75, 0, 'concrete'),
      brick: mats.surface(PALETTE.brick, 0.86, 0, 'concrete'),
      green: mats.surface(Color3.FromHexString('#343943'), 0.62, 0.04, 'metal'),
      gold: mats.surface(Color3.FromHexString('#b74b58'), 0.62, 0.02, null),
      glass: mats.glass(PALETTE.glassBlue, 0.9),
      timber: mats.surface(PALETTE.timberMid, 0.85, 0, 'timber'),
      metal: mats.metal(PALETTE.solarFrame, 0.4),
      roof: mats.surface(Color3.FromHexString('#5c6064'), 0.74, 0.08, 'metal'),
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
    this.courtyard();
    this.makerClassroom();
    this.playground();
    this.garden();
    this.forecourt();
    this.fence();
    this.utilityLines();
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
    // Rejas negras como las de las ventanas de la escuela real. Las barras
    // quedan por fuera del vidrio y comparten la misma granja de instancias.
    for (let i = -2; i <= 2; i++) {
      [pu, pv] = at(0.34);
      [sw, sd] = size(0.045, 0.045);
      const [bu, bv] = alongU ? [pu + (i * (width - 0.26)) / 6, pv] : [pu, pv + (i * (width - 0.26)) / 6];
      this.box(green, bu, bv, sw, 1.77, sd, y + 0.14);
    }
    for (const railY of [0.43, 1.28]) {
      [pu, pv] = at(0.37);
      [sw, sd] = size(width - 0.04, 0.045);
      this.box(green, pu, pv, sw, 0.045, sd, y + railY);
    }
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

    // Portal gris grafito del acceso, como el volumen central de la fachada real.
    const portalW = 13.2;
    const portalFront = S.frontV - 0.34;
    this.box(green, 0, portalFront, portalW, 4.55, 0.42, 3.55);
    // Franjas horizontales institucionales que coronan el portal.
    this.box(this.mats.surface(Color3.FromHexString('#b74b58'), 0.65, 0, null), 0, portalFront - 0.025, portalW, 0.18, 0.06, 7.54);
    this.box(this.mats.surface(Color3.FromHexString('#e5e7e8'), 0.75, 0, null), 0, portalFront - 0.03, portalW, 0.12, 0.06, 7.69);
    this.box(this.mats.surface(Color3.FromHexString('#243b67'), 0.65, 0, null), 0, portalFront - 0.035, portalW, 0.18, 0.06, 7.84);
    // Tres ventanas protegidas sobre el acceso, embutidas en el volumen oscuro.
    for (const u of [-4.35, 0, 4.35]) this.window(u, portalFront - 0.18, 4.58, 0, -1, 2.05);

    // Marquesina roja con líneas celeste y azul; la tipografía la pinta el atlas.
    this.box(this.mats.surface(Color3.FromHexString('#b74b58'), 0.68, 0, null), 0, S.frontV - 0.6, 13.2, 2.45, 0.36, 3.12);
    this.box(this.mats.surface(Color3.FromHexString('#e5e7e8'), 0.75, 0, null), 0, S.frontV - 0.8, 13.2, 0.13, 0.04, 4.28);
    this.box(this.mats.surface(Color3.FromHexString('#243b67'), 0.65, 0, null), 0, S.frontV - 0.82, 13.2, 0.14, 0.04, 4.12);

    // Entrada vidriada con laterales azules y marcos rojos.
    for (const side of [-1, 1]) {
      this.box(glass, side * 1.28, S.frontV - 0.13, 2.12, 2.75, 0.1, 0.1);
      this.box(this.m.gold, side * 2.4, S.frontV - 0.22, 0.14, 3.05, 0.18, 0.05);
    }
    this.box(this.m.gold, 0, S.frontV - 0.22, 4.9, 0.16, 0.18, 3.0);
    this.box(this.m.gold, 0, S.frontV - 0.24, 0.12, 2.75, 0.18, 0.1);
    for (const side of [-1, 1]) {
      for (const y of [1.1, 2.05]) {
        this.box(this.m.gold, side * 1.28, S.frontV - 0.23, 1.98, 0.09, 0.15, y);
      }
      this.box(this.m.metal, side * 0.19, S.frontV - 0.34, 0.035, 0.34, 0.045, 1.18);
    }
    for (const side of [-1, 1]) {
      this.box(this.mats.surface(Color3.FromHexString('#243b67'), 0.65, 0, null), side * 3.55, S.frontV - 0.49, 0.28, 3.55, 0.35, 0.02);
      this.box(this.mats.surface(Color3.FromHexString('#b74b58'), 0.68, 0, null), side * 2.55, S.frontV - 0.39, 0.12, 2.75, 0.18, 0.1);
    }

    // Escalinata ancha de acceso: tres huellas bajas de hormigón, como en la
    // entrada de Laprida. La explanada conserva paso libre a ambos lados.
    for (let i = 0; i < 3; i++) {
      this.box(slab, 0, S.frontV - 1.02 - i * 0.58, 8.2, 0.18, 0.68, i * 0.18);
    }

    // Aires acondicionados exteriores entre ventanas, con rejilla y cañería.
    for (const u of [-15.3, -8.5, 8.5, 15.3]) {
      this.frontAirConditioner(u, S.frontV - 0.37, 6.38);
    }
    for (const u of [-15.3, 15.3]) this.frontAirConditioner(u, S.frontV - 0.37, 2.9);
  }

  private frontAirConditioner(u: number, v: number, y: number): void {
    const { white, green } = this.m;
    this.box(white, u, v, 0.92, 0.58, 0.42, y);
    this.box(green, u, v - 0.225, 0.63, 0.37, 0.045, y + 0.015);
    for (let i = -2; i <= 2; i++) {
      this.box(white, u + i * 0.115, v - 0.254, 0.035, 0.31, 0.018, y + 0.015);
    }
    // Soportes y desagote fino bajo la unidad.
    for (const side of [-1, 1]) this.box(green, u + side * 0.31, v - 0.05, 0.12, 0.045, 0.56, y - 0.32);
    this.box(white, u + 0.52, v - 0.04, 0.045, 0.72, 0.045, y - 0.22);
  }

  // --------------------------------------------------------------------- alas

  private wings(): void {
    const S = SCHOOL;
    const { wall, slab, brick, roof } = this.m;
    const w = S.halfWidth - S.wingInner;
    const uc = (S.halfWidth + S.wingInner) / 2;
    const d = S.wingEndV - S.frontBackV;
    const vc = (S.wingEndV + S.frontBackV) / 2;
    const H = S.wingFloors * S.floorH;

    for (const s of [-1, 1]) {
      this.box(wall, s * uc, vc, w, H, d, 0);
      this.box(brick, s * uc, vc, w + 0.12, 0.75, d + 0.12, 0);
      this.box(slab, s * uc, vc, w + 0.5, 0.3, d + 0.5, S.floorH - 0.15);
      this.box(slab, s * uc, vc, w + 0.5, 0.22, d + 0.5, H);
      // Techo de chapa acanalada gris, característico de las alas que se ven
      // en Street View y en la toma aérea. El patio conserva la vegetación.
      this.box(roof, s * uc, vc, w - 0.45, 0.12, d - 0.45, H + 0.22);
      const ribCount = Math.floor((w - 0.8) / 0.34);
      for (let i = 0; i <= ribCount; i++) {
        const ru = s * uc - (w - 0.8) / 2 + i * 0.34;
        this.box(slab, ru, vc, 0.055, 0.055, d - 0.9, H + 0.34);
      }
      this.box(roof, s * uc, S.wingEndV - 0.2, w + 0.08, 0.16, 0.12, H + 0.22);

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
      // Equipos y cañerías sobre la fachada lateral que da a la vereda.
      for (const v of [0, 6.8]) {
        for (const y of [2.9, 6.35]) {
          this.box(this.m.white, s * (S.halfWidth + 0.22), v, 0.42, 0.58, 0.92, y);
          this.box(this.m.green, s * (S.halfWidth + 0.445), v, 0.045, 0.37, 0.63, y + 0.015);
          for (let i = -2; i <= 2; i++) {
            this.box(this.m.white, s * (S.halfWidth + 0.47), v + i * 0.115, 0.018, 0.31, 0.035, y + 0.015);
          }
        }
      }
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

  /** Patio de juegos visible y separado de la cancha para los más chicos. */
  private playground(): void {
    const { green, gold, timber, metal } = this.m;
    const safety = this.mats.surface(PALETTE.signal, 0.6, 0, null);
    const centerU = -10;
    const centerV = 16.1;

    // Piso blando terracota y borde de madera bajo: el patio se distingue
    // desde arriba y queda separado de los canteros sin cerrar el recorrido.
    this.box(safety, centerU, centerV, 8.6, 0.08, 6.2, 0.04);
    // Rayuela pintada para que el área se lea como patio infantil incluso
    // desde la vista aérea y sin depender de que haya alumnos justo ahí.
    for (let i = 0; i < 6; i++) {
      this.box(this.m.white, -13.45 + i * 0.5, 13.85, 0.38, 0.035, 0.38, 0.085);
    }
    for (const side of [-1, 1]) {
      const u = centerU + side * 4.25;
      for (const v of [centerV - 2.85, centerV, centerV + 2.85]) {
        this.box(green, u, v, 0.12, 0.82, 0.12, 0.08);
      }
      this.box(timber, u, centerV, 0.12, 0.1, 5.7, 0.76);
    }
    this.box(timber, centerU - 4.25, centerV + 2.85, 8.5, 0.1, 0.12, 0.76);

    // Torre de trepa con techo, escalones bajos y un tobogán inclinado.
    const towerU = -11.1;
    const towerV = 16.7;
    for (const du of [-0.72, 0.72]) {
      for (const dv of [-0.65, 0.65]) this.box(metal, towerU + du, towerV + dv, 0.1, 2.05, 0.1, 0.08);
    }
    this.box(timber, towerU, towerV, 1.7, 0.16, 1.55, 1.22);
    this.box(green, towerU, towerV, 1.9, 0.13, 1.75, 2.03);
    this.box(green, towerU + 1.35, towerV - 0.18, 1.65, 0.14, 0.46, 0.82);
    for (let i = 0; i < 4; i++) {
      this.box(timber, towerU + 0.85 + i * 0.24, towerV - 1.0, 0.34, 0.12, 0.72, 0.17 + i * 0.2);
    }
    const slide = toWorld(this.f, towerU + 1.75, towerV + 0.05);
    this.farm.add(
      'box',
      gold,
      new Vector3(slide.x, 0.78, slide.z),
      new Vector3(1.15, 0.1, 2.05),
      this.f.rot,
      0.38,
    );

    // Hamaca doble con asientos rojos; perfiles y piezas compartidas por la granja.
    const swingU = -7.25;
    const swingV = 16.5;
    for (const u of [swingU - 1.05, swingU + 1.05]) this.cyl(metal, u, swingV, 0.12, 2.05, 0.08);
    this.box(green, swingU, swingV, 2.3, 0.12, 0.14, 2.08);
    for (const u of [swingU - 0.48, swingU + 0.48]) {
      for (const v of [swingV - 0.24, swingV + 0.24]) this.box(metal, u, v, 0.04, 0.9, 0.04, 1.12);
      this.box(safety, u, swingV, 0.62, 0.12, 0.48, 0.62);
    }
  }

  private garden(): void {
    // Canteros elevados de la huerta escolar.
    for (const [u, v] of [
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
    // Se mantiene libre la línea de visión entre patio, huerta y zona de juegos.
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

    // Directorio del Aula Maker: panel visible desde la explanada de entrada.
    this.box(this.m.green, 6.8, -20.45, 3.18, 2.5, 0.16, 0.05);
    this.box(this.m.gold, 6.8, -20.45, 3.3, 0.12, 0.2, 2.5);
    for (const u of [5.65, 7.95]) this.box(metal, u, -20.45, 0.1, 0.45, 0.14, 0.05);

    // Jardineras bajas a los lados: mantienen despejada la vista del acceso.
    for (const s of [-1, 1]) {
      this.box(this.m.brick, s * 11.6, -16.25, 9.2, 0.46, 1.15, 0.05);
      this.box(this.m.green, s * 11.6, -16.25, 9.25, 0.12, 1.2, 0.48);
      for (const u of [9.1, 11.6, 14.1]) {
        const p = toWorld(this.f, s * u, -16.25);
        this.nature.shrub(p.x, p.z, 0.48, 0.6);
      }
      this.bench(s > 0 ? 15.8 : -11.6, -15.2, true);
    }
    // Bicicletero de alumnos.
    const r = toWorld(this.f, 15.8, S.fenceV + 1.3);
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

  /** Postes y cableado aéreo que aparecen en las vistas reales de Laprida. */
  private utilityLines(): void {
    const poleV = SCHOOL.fenceV - 1.55;
    for (const u of [-20.2, 20.2]) {
      this.cyl(this.m.green, u, poleV, 0.17, 10.4, 0);
      this.box(this.m.green, u, poleV, 1.45, 0.11, 0.11, 9.15);
      for (let i = -1; i <= 1; i++) {
        this.box(this.m.white, u + i * 0.43, poleV, 0.08, 0.34, 0.08, 9.2);
      }
    }
    const span = 40.4;
    const segments = 24;
    for (const [line, height] of [
      [0, 9.48],
      [1, 9.05],
      [2, 8.64],
    ] as const) {
      for (let i = 0; i < segments; i++) {
        const u = -span / 2 + (i + 0.5) * (span / segments);
        const sag = 0.15 * (1 - Math.pow((2 * u) / span, 2));
        this.box(this.m.green, u, poleV, span / segments + 0.035, 0.025, 0.025, height - sag - 0.0125 - line * 0.005);
      }
    }
  }

  /** Mesas, portátiles y sillas azules frente al mural del aula maker. */
  private makerClassroom(): void {
    const chair = this.mats.surface(Color3.FromHexString('#2858a4'), 0.68, 0.02, 'metal');
    const screen = this.mats.surface(Color3.FromHexString('#161a20'), 0.35, 0.04, null);
    const device = this.mats.surface(Color3.FromHexString('#d8ddd9'), 0.58, 0.08, 'metal');
    const accent = this.mats.surface(Color3.FromHexString('#dd743d'), 0.62, 0.02, null);
    const places = [-6.3, -2.8];

    for (const u of places) {
      const v = -2.65;
      // Mesas de madera con patas metálicas sencillas, en escala de aula.
      this.box(this.m.timber, u, v, 2.25, 0.09, 1.35, 0.72);
      for (const du of [-0.96, 0.96]) {
        for (const dv of [-0.52, 0.52]) this.box(this.m.green, u + du, v + dv, 0.075, 0.68, 0.075, 0.04);
      }
      // Portátil abierto, teclado y pequeño prototipo de robótica en cada mesa.
      this.box(device, u - 0.35, v + 0.03, 0.56, 0.035, 0.38, 0.815);
      const p = toWorld(this.f, u - 0.35, v - 0.12);
      this.farm.add(
        'box',
        screen,
        new Vector3(p.x, 1.02, p.z),
        new Vector3(0.56, 0.39, 0.045),
        this.f.rot,
        0,
        -0.08,
      );
      this.box(device, u + 0.42, v + 0.05, 0.4, 0.23, 0.34, 0.815);
      this.box(accent, u + 0.42, v - 0.13, 0.46, 0.05, 0.12, 1.05);
      this.box(screen, u + 0.42, v + 0.05, 0.12, 0.1, 0.1, 1.07);

      // Cuatro sillas por mesa, con respaldo; las piezas se instancian en lote.
      for (const side of [-1, 1]) {
        for (const du of [-0.55, 0.55]) {
          const su = u + du;
          const sv = v + side * 1.02;
          this.box(chair, su, sv, 0.48, 0.1, 0.44, 0.47);
          this.box(chair, su, sv + side * 0.2, 0.48, 0.62, 0.08, 0.55);
          for (const legU of [-0.17, 0.17]) {
            for (const legV of [-0.15, 0.15]) this.box(this.m.green, su + legU, sv + legV, 0.045, 0.45, 0.045, 0.04);
          }
        }
      }
    }
  }
}
