import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import type { Block } from '../CityLayout';
import type { NatureBuilder } from './NatureBuilder';
import { StreetLevel, GROUND_FLOOR_H } from './StreetLevel';
import { FACADE_TONES, PALETTE } from '../Palette';

const FLOOR_H = 3.4;

/** Cara de un volumen que da a la calle. */
type StreetFace = 'north' | 'south' | 'east' | 'west';

/**
 * Edificios.
 *
 * La silueta solarpunk se construye con tres reglas:
 *
 *  1. **Retranqueos plantados.** El volumen se va angostando hacia arriba y en
 *     cada escalón queda una terraza con jardineras. Esto es lo que diferencia
 *     un edificio solarpunk de una caja: la planta ocupa el volumen que el
 *     edificio "devuelve".
 *  2. **Bandas horizontales.** Losas claras que sobresalen + vidrio retranqueado.
 *     Leen la altura del edificio y le dan escala sin necesidad de texturas.
 *  3. **Parasoles de madera.** Lamas verticales en las caras más expuestas.
 *     Son 6-10 cajas finas y cambian por completo la lectura de la fachada.
 */
export class BuildingBuilder {
  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly rng: Rng,
    private readonly nature: NatureBuilder,
    private readonly street: StreetLevel = new StreetLevel(farm, mats, rng),
  ) {}

  build(block: Block): void {
    switch (block.kind) {
      case 'residential':
        this.terracedBlock(block);
        break;
      case 'tower':
        this.tower(block);
        break;
      case 'civic':
        this.civic(block);
        break;
      case 'market':
        this.market(block);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- vivienda

  /** Vivienda en manzana perimetral con patio interior y terrazas escalonadas. */
  private terracedBlock(block: Block): void {
    const { cx, cz, width, depth } = block;
    const facade = this.rng.pick(FACADE_TONES);
    const bodyMat = this.mats.surfaceVaried(facade, 0.78, 0, 'concreteXL');
    const slabMat = this.mats.surface(PALETTE.concreteLight, 0.7, 0, 'concrete');

    // Manzana perimetral: cuatro barras alrededor de un patio.
    const barDepth = this.rng.range(11, 14);
    // Cada barra sabe hacia qué calle da: ahí van la planta baja comercial y
    // los balcones. La cara interior, al patio, queda lisa a propósito.
    const sides: Array<{
      x: number;
      z: number;
      w: number;
      d: number;
      face: StreetFace;
    }> = [
      { x: cx, z: cz - depth / 2 + barDepth / 2, w: width, d: barDepth, face: 'south' },
      { x: cx, z: cz + depth / 2 - barDepth / 2, w: width, d: barDepth, face: 'north' },
      {
        x: cx - width / 2 + barDepth / 2,
        z: cz,
        w: barDepth,
        d: depth - barDepth * 2,
        face: 'west',
      },
      {
        x: cx + width / 2 - barDepth / 2,
        z: cz,
        w: barDepth,
        d: depth - barDepth * 2,
        face: 'east',
      },
    ];

    for (const side of sides) {
      if (side.w <= 1 || side.d <= 1) continue;
      const floors = Math.max(2, Math.round(block.height / FLOOR_H) + this.rng.int(-1, 1));
      this.steppedMass(
        side.x,
        side.z,
        side.w,
        side.d,
        floors,
        bodyMat,
        slabMat,
        facade,
        side.face,
      );
    }

    // Patio interior: verde y sombra.
    const courtW = width - barDepth * 2;
    const courtD = depth - barDepth * 2;
    if (courtW > 6 && courtD > 6) {
      this.nature.lawn(cx, cz, courtW * 0.94, courtD * 0.94);
      const trees = this.rng.int(2, 5);
      for (let i = 0; i < trees; i++) {
        this.nature.broadleaf(
          cx + this.rng.range(-courtW / 2 + 2, courtW / 2 - 2),
          cz + this.rng.range(-courtD / 2 + 2, courtD / 2 - 2),
          this.rng.range(0.8, 1.15),
        );
      }
    }
  }

  /**
   * Volumen escalonado: el motor de forma de casi todos los edificios.
   * Apila 1-3 tramos, cada uno más angosto, y planta cada retranqueo.
   */
  private steppedMass(
    x: number,
    z: number,
    width: number,
    depth: number,
    floors: number,
    bodyMat: ReturnType<Materials['surface']>,
    slabMat: ReturnType<Materials['surface']>,
    facadeTone: (typeof FACADE_TONES)[number],
    streetFace: StreetFace | null = null,
  ): void {
    const steps = floors > 7 ? this.rng.int(2, 3) : floors > 4 ? 2 : 1;
    let y = 0;
    let w = width;
    let d = depth;
    let remaining = floors;

    // ---- planta baja ----
    //
    // Se construye aparte y más alta (4,3 m contra 3,4 m). Es la diferencia
    // entre un edificio y una caja: en la realidad la planta baja siempre es
    // distinta — más alta, más vidriada, con acceso y local. Y es justo la
    // parte que se mira desde la vereda.
    if (streetFace && remaining > 1) {
      this.farm.addBoxOnGround(bodyMat, x, z, w, GROUND_FLOOR_H, d, 0);
      this.street.shopfront(x, z, w, d, streetFace);
      // Losa de separación con el primer piso.
      this.farm.addBoxOnGround(slabMat, x, z, w + 0.3, 0.22, d + 0.3, GROUND_FLOOR_H - 0.22);
      y = GROUND_FLOOR_H;
      remaining -= 1;
    }

    for (let s = 0; s < steps; s++) {
      const stepFloors = s === steps - 1 ? remaining : Math.max(1, Math.round(remaining / (steps - s) + this.rng.range(-0.6, 0.6)));
      const h = stepFloors * FLOOR_H;
      if (h <= 0 || w <= 2 || d <= 2) break;

      // Cuerpo.
      this.farm.addBoxOnGround(bodyMat, x, z, w, h, d, y);

      // Bandas de losa + vidrio: una por piso.
      this.floorBands(x, z, w, d, y, stepFloors, slabMat);

      // Parasoles de madera en una de las caras largas.
      if (this.rng.chance(0.55)) {
        this.louvers(x, z, w, d, y, h);
      }

      // Balcones: sólo en el primer tramo y sobre la cara que da a la calle.
      if (s === 0 && streetFace && this.rng.chance(0.75)) {
        this.street.balconies(x, z, w, d, streetFace, stepFloors, y + 0.2, FLOOR_H);
      }

      y += h;
      remaining -= stepFloors;

      // Retranqueo: la terraza que queda se planta.
      if (s < steps - 1 && remaining > 0) {
        const shrinkX = Math.min(w * 0.3, this.rng.range(2.5, 5));
        const shrinkZ = Math.min(d * 0.3, this.rng.range(2.5, 5));
        // Parapeto de la terraza.
        this.terraceEdge(x, z, w, d, y, shrinkX, shrinkZ);
        w -= shrinkX * 2;
        d -= shrinkZ * 2;
      }
    }

    // Remate superior: cornisa que separa el volumen del cielo.
    this.street.cornice(x, z, w, d, y);

    // Coronamiento: pérgola solar o jardín en azotea.
    if (this.rng.chance(0.75)) {
      this.roofSolar(x, z, w * 0.82, d * 0.82, y);
    } else {
      this.nature.planter(x, z, w * 0.7, d * 0.7, y, 1.4);
    }

    // Equipamiento de azotea: tanques, conductos, antenas.
    if (this.street.fullDetail && this.rng.chance(0.65)) {
      this.street.roofClutter(x, z, w, d, y);
    }
    // Un poco de vegetación cayendo del borde superior.
    if (this.rng.chance(0.5)) {
      this.nature.hangingVines(x, z - d / 2, w * 0.8, y, 'x', this.rng.range(2, 5));
    }
    // Insinúa la estructura: un canto de losa del tono de la fachada.
    this.farm.addBoxOnGround(
      this.mats.surface(facadeTone, 0.7, 0, 'concrete'),
      x,
      z,
      w + 0.3,
      0.28,
      d + 0.3,
      y - 0.28,
    );
  }

  /**
   * Ventanas y losas.
   *
   * Acá estaba el peor error visual de la primera versión: el vidrio se
   * generaba como una caja MÁS GRANDE que el cuerpo (w + 0.12), así que
   * envolvía el edificio como un aro que sobresalía. Apilado piso a piso, el
   * resultado parecía una pila de platos, no un edificio.
   *
   * La corrección: el vidrio es una banda más ANGOSTA que el cuerpo en el eje
   * largo (deja las esquinas macizas) y apenas sobresale en el eje corto, para
   * que se lea sólo en la cara. Eso produce una ventana corrida con esquinas
   * de obra, que es exactamente el lenguaje de la arquitectura que buscamos.
   */
  private floorBands(
    x: number,
    z: number,
    w: number,
    d: number,
    baseY: number,
    floors: number,
    slabMat: ReturnType<Materials['surface']>,
  ): void {
    const glassMat = this.mats.glass(
      this.rng.chance(0.6) ? PALETTE.glassGreen : PALETTE.glassBlue,
      0.92,
    );
    const mullionMat = this.mats.surface(PALETTE.concreteShade, 0.8, 0, 'concrete');
    // Las esquinas quedan macizas: la ventana no da la vuelta al edificio.
    const windowW = w * 0.82;
    const windowD = d * 0.82;
    const sillH = 0.95;
    const headH = 0.5;
    const glassH = Math.max(0.6, FLOOR_H - sillH - headH);

    for (let f = 0; f < floors; f++) {
      const y = baseY + f * FLOOR_H;

      // Ventana corrida en las dos caras largas (sobresale apenas 4 cm).
      this.farm.addBoxOnGround(glassMat, x, z, windowW, glassH, d + 0.08, y + sillH);

      // Variante ENCENDIDA de la misma ventana, generada desde el principio y
      // apagada de día. Conmutar visibilidad es gratis; mutar el material no,
      // porque están congelados para no recompilar shaders. Sólo una parte de
      // las ventanas se enciende: un edificio con todas las luces prendidas se
      // ve tan falso como uno con todas apagadas.
      if (this.rng.chance(0.34)) {
        this.farm.addBoxOnGround(
          this.mats.glow(PALETTE.glassLit, 0.7),
          x,
          z,
          windowW * this.rng.range(0.4, 0.92),
          glassH * 0.82,
          d + 0.1,
          y + sillH + glassH * 0.09,
        );
      }
      // Y en las caras cortas, si el volumen es lo bastante ancho.
      if (w > 9) {
        this.farm.addBoxOnGround(glassMat, x, z, w + 0.08, glassH, windowD, y + sillH);
      }

      // Losa: apenas insinuada. Antes sobresalía 0,6 m y 0,3 de canto, y era
      // lo que generaba el rayado horizontal.
      this.farm.addBoxOnGround(slabMat, x, z, w + 0.22, 0.16, d + 0.22, y + FLOOR_H - 0.16);

      // Parteluz vertical cada dos pisos: rompe la horizontalidad.
      if (f % 2 === 0) {
        this.farm.addBoxOnGround(mullionMat, x, z + d / 2 + 0.02, 0.2, FLOOR_H, 0.2, y);
      }
    }
  }

  /** Lamas verticales de madera sobre una cara. */
  private louvers(
    x: number,
    z: number,
    w: number,
    d: number,
    baseY: number,
    height: number,
  ): void {
    const mat = this.mats.surfaceVaried(
      this.rng.pick([PALETTE.timberMid, PALETTE.timberLight]),
      0.85,
      0,
      'timber',
    );
    const onXFace = w >= d;
    const span = (onXFace ? w : d) * 0.86;
    const count = Math.max(3, Math.round(span / 1.5));
    const edge = onXFace ? d / 2 + 0.25 : w / 2 + 0.25;

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count - 0.5;
      const px = onXFace ? x + t * span : x + edge;
      const pz = onXFace ? z + edge : z + t * span;
      this.farm.add(
        'box',
        mat,
        new Vector3(px, baseY + height / 2, pz),
        onXFace ? new Vector3(0.28, height * 0.92, 0.5) : new Vector3(0.5, height * 0.92, 0.28),
      );
    }
  }

  /** Parapeto de una terraza de retranqueo, con jardineras. */
  private terraceEdge(
    x: number,
    z: number,
    w: number,
    d: number,
    y: number,
    shrinkX: number,
    shrinkZ: number,
  ): void {
    const railMat = this.mats.surface(PALETTE.concreteLight, 0.75, 0, 'concrete');
    const railH = 1.05;
    // Cuatro tramos de baranda en el perímetro exterior.
    this.farm.addBoxOnGround(railMat, x, z - d / 2 + 0.2, w, railH, 0.22, y);
    this.farm.addBoxOnGround(railMat, x, z + d / 2 - 0.2, w, railH, 0.22, y);
    this.farm.addBoxOnGround(railMat, x - w / 2 + 0.2, z, 0.22, railH, d, y);
    this.farm.addBoxOnGround(railMat, x + w / 2 - 0.2, z, 0.22, railH, d, y);

    // Jardineras en las franjas liberadas por el retranqueo.
    if (shrinkZ > 1.2) {
      this.nature.planter(x, z - d / 2 + shrinkZ / 2 + 0.3, w * 0.86, shrinkZ * 0.7, y, 1.3);
      this.nature.planter(x, z + d / 2 - shrinkZ / 2 - 0.3, w * 0.86, shrinkZ * 0.7, y, 1.3);
    }
    if (shrinkX > 1.2) {
      this.nature.planter(x - w / 2 + shrinkX / 2 + 0.3, z, shrinkX * 0.7, d * 0.5, y, 1.3);
      this.nature.planter(x + w / 2 - shrinkX / 2 - 0.3, z, shrinkX * 0.7, d * 0.5, y, 1.3);
    }
  }

  /** Pérgola de paneles solares sobre la azotea, apoyada en pilares. */
  private roofSolar(x: number, z: number, w: number, d: number, y: number): void {
    if (w < 3 || d < 3) return;
    const legMat = this.mats.metal(PALETTE.solarFrame, 0.45);
    const panelMat = this.mats.solar();
    const legH = this.rng.range(2.2, 3.2);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.farm.add(
          'cylinder',
          legMat,
          new Vector3(x + (sx * w) / 2.4, y + legH / 2, z + (sz * d) / 2.4),
          new Vector3(0.24, legH, 0.24),
        );
      }
    }

    // Filas de paneles con inclinación hacia el norte solar (hemisferio sur).
    const rows = Math.max(1, Math.floor(d / 2.6));
    const tilt = -0.42;
    for (let r = 0; r < rows; r++) {
      const pz = z - d / 2 + (r + 0.5) * (d / rows);
      this.farm.add(
        'box',
        panelMat,
        new Vector3(x, y + legH, pz),
        new Vector3(w, 0.1, (d / rows) * 0.82),
        0,
        tilt,
      );
    }
  }

  // -------------------------------------------------------------------- torre

  /** Torre alta con jardines en altura cada pocos pisos. */
  private tower(block: Block): void {
    const { cx, cz, height } = block;
    const footprint = this.rng.range(17, 24);
    const floors = Math.round(height / FLOOR_H);
    const bodyMat = this.mats.surfaceVaried(this.rng.pick(FACADE_TONES), 0.72, 0, 'concreteXL');
    const slabMat = this.mats.surface(PALETTE.concreteLight, 0.68, 0, 'concrete');
    const coreMat = this.mats.surface(PALETTE.concreteShade, 0.8, 0, 'concrete');

    // Base ancha de dos plantas: conecta la torre con la calle.
    const podiumH = GROUND_FLOOR_H + FLOOR_H;
    const podiumW = footprint * 1.65;
    this.farm.addBoxOnGround(bodyMat, cx, cz, podiumW, podiumH, podiumW, 0);
    // Locales en las cuatro caras del basamento: una torre que apoya en un
    // zócalo ciego mata la calle. Con locales, la torre participa del barrio.
    for (const face of ['north', 'south', 'east', 'west'] as const) {
      this.street.shopfront(cx, cz, podiumW, podiumW, face);
    }
    this.farm.addBoxOnGround(
      slabMat,
      cx,
      cz,
      footprint * 1.75,
      0.4,
      footprint * 1.75,
      podiumH - 0.4,
    );
    this.nature.planter(cx, cz + footprint * 0.7, footprint * 1.3, 3.2, podiumH, 1.5);

    // Fuste.
    let y = podiumH;
    let w = footprint;
    const skyGardenEvery = this.rng.int(4, 6);
    for (let f = 0; f < floors; f++) {
      const isGarden = f > 0 && f % skyGardenEvery === 0;

      if (isGarden) {
        // Jardín en altura: piso abierto, solo losa, núcleo y vegetación.
        this.farm.addBoxOnGround(slabMat, cx, cz, w + 1.2, 0.4, w + 1.2, y);
        this.farm.addBoxOnGround(coreMat, cx, cz, w * 0.34, FLOOR_H, w * 0.34, y);
        this.nature.planter(cx - w * 0.3, cz, w * 0.3, w * 0.7, y + 0.4, 1.8);
        this.nature.planter(cx + w * 0.3, cz, w * 0.3, w * 0.7, y + 0.4, 1.8);
        this.nature.hangingVines(cx, cz + w / 2, w * 0.9, y, 'x', this.rng.range(3, 7));
        // Barandas.
        const railMat = this.mats.metal(PALETTE.solarFrame, 0.4);
        this.farm.addBoxOnGround(railMat, cx, cz - w / 2, w, 1.1, 0.15, y + 0.4);
        this.farm.addBoxOnGround(railMat, cx, cz + w / 2, w, 1.1, 0.15, y + 0.4);
      } else {
        this.farm.addBoxOnGround(bodyMat, cx, cz, w, FLOOR_H, w, y);
        // Ventana corrida con esquinas macizas, igual que en vivienda.
        const gw = w * 0.84;
        this.farm.addBoxOnGround(
          this.mats.glass(PALETTE.glassGreen, 0.9),
          cx,
          cz,
          gw,
          FLOOR_H - 1.35,
          w + 0.08,
          y + 0.9,
        );
        this.farm.addBoxOnGround(
          this.mats.glass(PALETTE.glassGreen, 0.9),
          cx,
          cz,
          w + 0.08,
          FLOOR_H - 1.35,
          gw,
          y + 0.9,
        );
        this.farm.addBoxOnGround(slabMat, cx, cz, w + 0.26, 0.16, w + 0.26, y + FLOOR_H - 0.16);
      }

      y += FLOOR_H;
      // Se angosta muy suavemente con la altura.
      if (f > 0 && f % 8 === 0) w *= 0.93;
    }

    // Aristas verticales de vegetación: el rasgo más característico.
    const vineCorners = this.rng.chance(0.7);
    if (vineCorners) {
      for (const sx of [-1, 1]) {
        const vx = cx + (sx * footprint) / 2;
        const segments = Math.floor((y - podiumH) / 4);
        for (let i = 0; i < segments; i++) {
          this.farm.add(
            'box',
            this.mats.foliage(this.rng.pick([PALETTE.leafMid, PALETTE.moss, PALETTE.leafDeep])),
            new Vector3(vx, podiumH + i * 4 + 2, cz + this.rng.range(-footprint / 3, footprint / 3)),
            new Vector3(0.8, this.rng.range(2.4, 3.8), 0.8),
          );
        }
      }
    }

    // Corona: paneles solares y turbina de eje vertical.
    this.roofSolar(cx, cz, w * 0.9, w * 0.9, y);
    if (this.rng.chance(0.4)) this.verticalTurbine(cx, cz, y + 3.4, this.rng.range(5, 8));
  }

  /** Turbina de eje vertical (Darrieus): silenciosa, apta para techos. */
  verticalTurbine(x: number, z: number, y: number, height: number): void {
    const mat = this.mats.metal(PALETTE.turbineBody, 0.35);
    // Mástil.
    this.farm.add('cylinder', mat, new Vector3(x, y + height / 2, z), new Vector3(0.26, height, 0.26));
    // Tres palas curvas, aproximadas con cajas inclinadas.
    const r = height * 0.28;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.farm.add(
        'box',
        mat,
        new Vector3(x + Math.cos(a) * r, y + height / 2, z + Math.sin(a) * r),
        new Vector3(0.14, height * 0.82, 0.62),
        a,
      );
    }
  }

  // -------------------------------------------------------------------- civico

  /** Equipamiento público: bajo, ancho, mucho vidrio y cubierta de madera. */
  private civic(block: Block): void {
    const { cx, cz, width, depth, height } = block;
    const w = width * 0.82;
    const d = depth * 0.82;
    const bodyMat = this.mats.surfaceVaried(PALETTE.concreteWarm, 0.76, 0, 'concreteXL');
    const timber = this.mats.surface(PALETTE.timberMid, 0.85, 0, 'timber');

    const floors = Math.max(2, Math.round(height / FLOOR_H));
    for (let f = 0; f < floors; f++) {
      const y = f * FLOOR_H;
      const inset = f * 1.4; // se angosta: terrazas en todos los pisos
      const fw = w - inset * 2;
      const fd = d - inset * 2;
      if (fw < 4 || fd < 4) break;

      this.farm.addBoxOnGround(bodyMat, cx, cz, fw, 0.45, fd, y); // losa
      // Muro muy vidriado: cuatro paños finos en vez de un volumen macizo.
      const glass = this.mats.glass(PALETTE.glassGreen, 0.78);
      this.farm.addBoxOnGround(glass, cx, cz - fd / 2, fw, FLOOR_H - 0.6, 0.18, y + 0.45);
      this.farm.addBoxOnGround(glass, cx, cz + fd / 2, fw, FLOOR_H - 0.6, 0.18, y + 0.45);
      this.farm.addBoxOnGround(glass, cx - fw / 2, cz, 0.18, FLOOR_H - 0.6, fd, y + 0.45);
      this.farm.addBoxOnGround(glass, cx + fw / 2, cz, 0.18, FLOOR_H - 0.6, fd, y + 0.45);

      // Columnas de madera en el perímetro.
      const cols = Math.max(3, Math.round(fw / 5));
      for (let i = 0; i < cols; i++) {
        const t = (i + 0.5) / cols - 0.5;
        for (const sz of [-1, 1]) {
          this.farm.add(
            'cylinder',
            timber,
            new Vector3(cx + t * fw, y + FLOOR_H / 2, cz + (sz * fd) / 2),
            new Vector3(0.34, FLOOR_H, 0.34),
          );
        }
      }

      if (f > 0) {
        this.nature.planter(cx, cz - fd / 2 - 0.8, fw * 0.8, 1.5, y, 1.6);
      }
    }

    const topY = Math.min(floors, Math.floor((w - 4) / 2.8)) * FLOOR_H;
    this.roofSolar(cx, cz, w * 0.6, d * 0.6, topY);
    // Árboles pegados al edificio: difuminan el límite entre dentro y fuera.
    for (let i = 0; i < 4; i++) {
      this.nature.broadleaf(
        cx + this.rng.range(-width / 2, width / 2),
        cz + this.rng.range(-depth / 2, depth / 2),
        this.rng.range(0.85, 1.2),
      );
    }
  }

  // ------------------------------------------------------------------ mercado

  /** Mercado cubierto: estructura de madera laminada, abierta en los costados. */
  private market(block: Block): void {
    const { cx, cz, width, depth, height } = block;
    const w = width * 0.8;
    const d = depth * 0.8;
    const timber = this.mats.surface(PALETTE.timberMid, 0.86, 0, 'timber');
    const timberLight = this.mats.surface(PALETTE.timberLight, 0.84, 0, 'timber');

    // Piso.
    this.farm.addBoxOnGround(
      this.mats.surface(PALETTE.pavementDark, 0.85, 0, 'pavement'),
      cx,
      cz,
      w,
      0.25,
      d,
      0,
    );

    // Pórticos transversales, cada uno con dos columnas y un dintel curvo
    // aproximado por tres cajas inclinadas (un arco rebajado).
    const bays = Math.max(4, Math.round(w / 6));
    for (let i = 0; i < bays; i++) {
      const t = (i + 0.5) / bays - 0.5;
      const px = cx + t * w;
      for (const sz of [-1, 1]) {
        this.farm.add(
          'cylinder',
          timber,
          new Vector3(px, height / 2, cz + (sz * d) / 2),
          new Vector3(0.46, height, 0.46),
        );
      }
      // Arco: dos tramos inclinados + una clave horizontal.
      const rise = height * 0.22;
      const halfSpan = d / 2;
      for (const sz of [-1, 1]) {
        this.farm.add(
          'box',
          timberLight,
          new Vector3(px, height + rise * 0.45, cz + (sz * halfSpan) / 2),
          new Vector3(0.34, 0.34, halfSpan * 1.08),
          0,
          0,
          0,
        );
        // inclinación sobre el eje X para simular la curva
        this.farm.add(
          'box',
          timberLight,
          new Vector3(px, height + rise * 0.78, cz + (sz * halfSpan) / 4),
          new Vector3(0.3, 0.3, halfSpan * 0.6),
        );
      }
      this.farm.add(
        'box',
        timberLight,
        new Vector3(px, height + rise, cz),
        new Vector3(0.3, 0.3, d * 0.3),
      );
    }

    // Cubierta: lamas traslúcidas alternadas con paneles solares.
    const slats = Math.max(6, Math.round(d / 2.2));
    for (let i = 0; i < slats; i++) {
      const t = (i + 0.5) / slats - 0.5;
      const pz = cz + t * d;
      const solar = i % 3 === 0;
      this.farm.add(
        'box',
        solar ? this.mats.solar() : this.mats.glass(PALETTE.glassGreen, 0.42),
        new Vector3(cx, height + 0.6, pz),
        new Vector3(w * 1.04, 0.12, (d / slats) * 0.8),
      );
    }

    // Puestos.
    const stalls = this.rng.int(6, 11);
    for (let i = 0; i < stalls; i++) {
      const sx = cx + this.rng.range(-w / 2 + 2, w / 2 - 2);
      const sz = cz + this.rng.range(-d / 2 + 2, d / 2 - 2);
      this.farm.addBoxOnGround(
        this.mats.surfaceVaried(
          this.rng.pick([PALETTE.terracotta, PALETTE.sun, PALETTE.signal]),
          0.7,
          0,
          null,
          0.12,
        ),
        sx,
        sz,
        this.rng.range(2, 3.4),
        this.rng.range(2.1, 2.6),
        this.rng.range(1.6, 2.4),
        0.25,
      );
    }
  }
}
