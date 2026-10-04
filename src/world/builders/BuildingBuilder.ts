import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import { SIDEWALK_H, type Block } from '../CityLayout';
import type { NatureBuilder } from './NatureBuilder';
import { StreetLevel, GROUND_FLOOR_H, SHOP_DEPTH } from './StreetLevel';
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
    // Misma clave que balcones y cornisas: un draw call menos por manzana.
    const slabMat = this.mats.surface(PALETTE.concreteLight, 0.72, 0, 'concrete');

    // Manzana perimetral: cuatro barras alrededor de un patio.
    const barDepth = block.barDepth ?? this.rng.range(11, 14);
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
        side.face,
        // Las barras largas tienen el hall de entrada de los departamentos.
        side.face === 'north' || side.face === 'south',
        faceIsOuter(block, side.face),
      );
    }

    // Patio interior: verde y sombra, sobre el solado de la manzana.
    const courtW = width - barDepth * 2;
    const courtD = depth - barDepth * 2;
    if (courtW > 6 && courtD > 6) {
      this.nature.lawn(cx, cz, courtW * 0.94, courtD * 0.94, SIDEWALK_H + 0.06);
      const trees = this.rng.int(2, 5);
      for (let i = 0; i < trees; i++) {
        const x = cx + this.rng.range(-courtW / 2 + 2, courtW / 2 - 2);
        const z = cz + this.rng.range(-courtD / 2 + 2, courtD / 2 - 2);
        const scale = this.rng.range(0.8, 1.15);
        // En el visor no se plantan: el patio queda encerrado por las cuatro
        // barras y desde la calle o la escuela no se ve, pero las instancias
        // de la granja no se recortan por oclusión ni por distancia y, con la
        // manzana de 49 m (escuela a tamaño real), esas copas sumaban ~20 mil
        // triángulos a cada vista de la escuela. Se consume el mismo azar que
        // un árbol plantado: el resto del barrio no cambia.
        if (this.street.fullDetail) this.nature.broadleaf(x, z, scale, SIDEWALK_H);
        else this.nature.skipBroadleaf(scale);
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
    streetFace: StreetFace | null = null,
    lobby = false,
    outer = false,
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
      // La caja de la planta baja se retira detrás de la vidriera: el hueco
      // es el local, con la losa del primer piso como cielorraso.
      const alongX = streetFace === 'north' || streetFace === 'south';
      const out = streetFace === 'north' || streetFace === 'east' ? 1 : -1;
      this.farm.addBoxOnGround(
        bodyMat,
        alongX ? x : x - (out * SHOP_DEPTH) / 2,
        alongX ? z - (out * SHOP_DEPTH) / 2 : z,
        alongX ? w : w - SHOP_DEPTH,
        GROUND_FLOOR_H,
        alongX ? d - SHOP_DEPTH : d,
        0,
      );
      this.street.shopfront(x, z, w, d, streetFace, lobby, outer);
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
      // Sin balcones, la fachada igual muestra gente: aires colgados.
      if (s === 0 && streetFace && this.rng.chance(0.75)) {
        this.street.balconies(x, z, w, d, streetFace, stepFloors, y + 0.2, FLOOR_H);
      } else if (streetFace) {
        this.street.facadeLife(x, z, w, d, streetFace, stepFloors, y, FLOOR_H);
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

    // Equipamiento de azotea: tanques de agua, conductos, antenas. También
    // en el visor (son cajas de color, casi gratis): una azotea vacía se lee
    // como una tapa desde los patios y desde arriba.
    if (this.rng.chance(0.8)) {
      this.street.roofClutter(x, z, w, d, y);
    }
    // Un poco de vegetación cayendo del borde superior.
    if (this.rng.chance(0.5)) {
      this.nature.hangingVines(x, z - d / 2, w * 0.8, y, 'x', this.rng.range(2, 5));
    }
    // Insinúa la estructura: un canto de losa del tono de la fachada (con el
    // mismo material del cuerpo: un material por tono era un draw call más).
    this.farm.addBoxOnGround(
      bodyMat,
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
    const mullionMat = this.mats.surface(PALETTE.concreteShade, 0.85, 0, 'concrete');
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

      // Parteluz vertical cada dos pisos: rompe la horizontalidad. En el
      // visor no: una varilla de 20 cm a 20 m no se distingue del vidrio.
      if (f % 2 === 0 && this.street.fullDetail) {
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
    // Dos maderas fijas: con la variante teñida por edificio eran hasta doce
    // materiales (doce draw calls) para lamas que de lejos se ven iguales.
    const mat = this.mats.surface(this.rng.pick([PALETTE.timberMid, PALETTE.timberLight]), 0.85, 0, 'timber');
    const onXFace = w >= d;
    const span = (onXFace ? w : d) * 0.86;
    // En el visor, la mitad de lamas y más anchas: el ritmo se lee igual.
    const full = this.street.fullDetail;
    const count = Math.max(3, Math.round(span / (full ? 1.5 : 2.6)));
    const fin = full ? 0.28 : 0.42;
    const edge = onXFace ? d / 2 + 0.25 : w / 2 + 0.25;

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count - 0.5;
      const px = onXFace ? x + t * span : x + edge;
      const pz = onXFace ? z + edge : z + t * span;
      this.farm.add(
        'box',
        mat,
        new Vector3(px, baseY + height / 2, pz),
        onXFace ? new Vector3(fin, height * 0.92, 0.5) : new Vector3(0.5, height * 0.92, fin),
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
    const railMat = this.mats.surface(PALETTE.concreteLight, 0.72, 0, 'concrete');
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

    // Dos largueros de apoyo sobre los pilares. Sin ellos sólo las filas de
    // los extremos tocaban una pata: las del medio flotaban en el aire.
    for (const sx of [-1, 1]) {
      this.farm.add(
        'box',
        legMat,
        new Vector3(x + (sx * w) / 2.4, y + legH - 0.07, z),
        new Vector3(0.16, 0.14, d * 0.96),
      );
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
    const footprint = block.footprint ?? this.rng.range(17, 24);
    const floors = Math.round(height / FLOOR_H);
    const bodyMat = this.mats.surfaceVaried(this.rng.pick(FACADE_TONES), 0.72, 0, 'concreteXL');
    const slabMat = this.mats.surface(PALETTE.concreteLight, 0.68, 0, 'concrete');
    const coreMat = this.mats.surface(PALETTE.concreteShade, 0.8, 0, 'concrete');

    // Base ancha de dos plantas: conecta la torre con la calle. La planta
    // baja se retira detrás de las vidrieras de los locales (ver SHOP_DEPTH).
    const podiumH = GROUND_FLOOR_H + FLOOR_H;
    const podiumW = footprint * 1.65;
    this.farm.addBoxOnGround(bodyMat, cx, cz, podiumW - SHOP_DEPTH * 2, GROUND_FLOOR_H, podiumW - SHOP_DEPTH * 2, 0);
    this.farm.addBoxOnGround(bodyMat, cx, cz, podiumW, FLOOR_H, podiumW, GROUND_FLOOR_H);
    // Locales en las cuatro caras del basamento: una torre que apoya en un
    // zócalo ciego mata la calle. Con locales, la torre participa del barrio.
    for (const face of ['north', 'south', 'east', 'west'] as const) {
      this.street.shopfront(cx, cz, podiumW, podiumW, face, face === 'west', faceIsOuter(block, face));
    }
    this.street.facadeLife(cx, cz, podiumW, podiumW, 'west', 1, GROUND_FLOOR_H, FLOOR_H);
    this.street.facadeLife(cx, cz, podiumW, podiumW, 'north', 1, GROUND_FLOOR_H, FLOOR_H);
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
    // Ancho de cada piso: la torre se angosta, y lo que se cuelga de la
    // fachada (aristas vegetales) tiene que seguir ese ancho, no el de la base.
    const widths: number[] = [];
    for (let f = 0; f < floors; f++) {
      widths.push(w);
      const isGarden = f > 0 && f % skyGardenEvery === 0;

      if (isGarden) {
        // Jardín en altura: piso abierto, solo losa, núcleo y vegetación.
        this.farm.addBoxOnGround(slabMat, cx, cz, w + 1.2, 0.4, w + 1.2, y);
        this.farm.addBoxOnGround(coreMat, cx, cz, w * 0.34, FLOOR_H, w * 0.34, y);
        this.nature.planter(cx - w * 0.3, cz, w * 0.3, w * 0.7, y + 0.4, 1.8);
        this.nature.planter(cx + w * 0.3, cz, w * 0.3, w * 0.7, y + 0.4, 1.8);
        this.nature.hangingVines(cx, cz + w / 2, w * 0.9, y, 'x', this.rng.range(3, 7));
        // Barandas.
        const railMat = this.mats.metal(PALETTE.solarFrame, 0.45);
        this.farm.addBoxOnGround(railMat, cx, cz - w / 2, w, 1.1, 0.15, y + 0.4);
        this.farm.addBoxOnGround(railMat, cx, cz + w / 2, w, 1.1, 0.15, y + 0.4);
      } else {
        this.farm.addBoxOnGround(bodyMat, cx, cz, w, FLOOR_H, w, y);
        // Ventana corrida con esquinas macizas, igual que en vivienda.
        const gw = w * 0.84;
        this.farm.addBoxOnGround(
          this.mats.glass(PALETTE.glassGreen, 0.92),
          cx,
          cz,
          gw,
          FLOOR_H - 1.35,
          w + 0.08,
          y + 0.9,
        );
        this.farm.addBoxOnGround(
          this.mats.glass(PALETTE.glassGreen, 0.92),
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

    // Fajas verticales de vegetación: el rasgo más característico. Antes eran
    // trozos de 2–4 m sueltos a alturas y posiciones al azar, que se leían
    // como manchas verdes pegadas a la fachada. Ahora son dos columnas
    // continuas por cara, de piso a azotea, que siguen el angostamiento.
    const vineCorners = this.rng.chance(0.7);
    if (vineCorners) {
      const leaf = this.mats.foliage(PALETTE.leafMid);
      const moss = this.mats.foliage(PALETTE.moss);
      for (const sx of [-1, 1]) {
        for (const k of [-0.3, 0.3]) {
          // Tramos de tres pisos encadenados (el ancho de la torre cambia cada 8).
          for (let f = 0; f < widths.length; f += 3) {
            const n = Math.min(3, widths.length - f);
            const fw = widths[f];
            this.farm.add(
              'box',
              (f / 3) % 2 === 1 ? moss : leaf,
              new Vector3(cx + (sx * (fw + 0.5)) / 2, podiumH + (f + n / 2) * FLOOR_H, cz + k * fw),
              new Vector3(0.5, n * FLOOR_H + 0.05, 1.3 + ((f * 7) % 3) * 0.25),
            );
          }
        }
      }
    }

    // Corona: paneles solares, tanques y turbina de eje vertical.
    this.roofSolar(cx, cz, w * 0.9, w * 0.9, y);
    this.street.roofClutter(cx, cz, w, w, y);
    if (this.rng.chance(0.4)) this.verticalTurbine(cx, cz, y + 3.4, this.rng.range(5, 8), y);
  }

  /** Turbina de eje vertical (Darrieus): silenciosa, apta para techos. */
  /**
   * @param baseY  de dónde arranca el mástil. En las torres el rotor va por
   *               encima de la pérgola solar, pero el mástil tiene que llegar
   *               hasta la losa: antes arrancaba en el aire, sobre los paneles.
   */
  verticalTurbine(x: number, z: number, y: number, height: number, baseY = y): void {
    const mat = this.mats.metal(PALETTE.turbineBody, 0.35);
    // Mástil.
    const top = y + height;
    this.farm.add('cylinder', mat, new Vector3(x, (baseY + top) / 2, z), new Vector3(0.26, top - baseY, 0.26));
    // Tres palas, aproximadas con cajas, unidas al mástil por dos brazos cada
    // una. Sin los brazos las palas quedaban suspendidas alrededor del eje.
    const r = height * 0.28;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      // Babylon: girar θ sobre Y lleva +X a (cos θ, −sin θ). La pala se
      // ubica sobre esa dirección para que su cara quede tangente al giro.
      const dx = Math.cos(a);
      const dz = -Math.sin(a);
      this.farm.add(
        'box',
        mat,
        new Vector3(x + dx * r, y + height / 2, z + dz * r),
        new Vector3(0.14, height * 0.82, 0.62),
        a,
      );
      for (const k of [0.2, 0.8]) {
        this.farm.add(
          'box',
          mat,
          new Vector3(x + (dx * r) / 2, y + height * k, z + (dz * r) / 2),
          new Vector3(r, 0.08, 0.08),
          a,
        );
      }
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
      this.civicInterior(cx, cz, fw, fd, y + 0.45, f);
    }
    this.civicFront(block, w, d);

    const topY = Math.min(floors, Math.floor((w - 4) / 2.8)) * FLOOR_H;
    this.roofSolar(cx, cz, w * 0.6, d * 0.6, topY);
    // Árboles pegados al edificio: difuminan el límite entre dentro y fuera.
    // Sólo en la franja entre el vidrio y la vereda: sorteados en toda la
    // manzana, dos de cada tres caían adentro y la copa atravesaba la losa.
    const out = (w / 2 + width / 2) / 2;
    for (let side = 0; side < 4; side++) {
      const along = this.rng.range(-width / 2 + 3, width / 2 - 3);
      const tx = side < 2 ? cx + along : cx + (side === 2 ? -out : out);
      const tz = side < 2 ? cz + (side === 0 ? -out : out) : cz + along;
      this.nature.broadleaf(tx, tz, this.rng.range(0.7, 0.95));
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

    // Pórticos transversales: dos columnas, dos cabios inclinados que forman
    // una cubierta a dos aguas, y la cumbrera corrida. Antes el "arco" eran
    // cajas horizontales a distintas alturas y las lamas del techo flotaban
    // entre ellas sin tocar nada.
    const rise = height * 0.22;
    const halfSpan = d / 2;
    const slope = Math.atan2(rise, halfSpan);
    const rafter = Math.hypot(rise, halfSpan);
    const bays = Math.max(4, Math.round(w / 6));
    for (let i = 0; i < bays; i++) {
      const t = (i + 0.5) / bays - 0.5;
      const px = cx + t * w;
      for (const sz of [-1, 1]) {
        this.farm.add(
          'cylinder',
          timber,
          new Vector3(px, height / 2, cz + sz * halfSpan),
          new Vector3(0.46, height, 0.46),
        );
        // Cabio: de la cabeza de la columna a la cumbrera. Girar +α sobre X
        // baja el extremo +Z, así que el faldón +Z usa +α y el −Z, −α.
        this.farm.add(
          'box',
          timberLight,
          new Vector3(px, height + rise / 2, cz + (sz * halfSpan) / 2),
          new Vector3(0.34, 0.34, rafter + 0.3),
          0,
          sz * slope,
        );
      }
    }
    // Cumbrera y vigas de borde: atan los pórticos entre sí.
    this.farm.add('box', timberLight, new Vector3(cx, height + rise, cz), new Vector3(w + 0.6, 0.34, 0.34));
    for (const sz of [-1, 1]) {
      this.farm.add('box', timber, new Vector3(cx, height - 0.1, cz + sz * halfSpan), new Vector3(w + 0.6, 0.3, 0.36));
    }

    // Cubierta: lamas traslúcidas alternadas con paneles solares, apoyadas
    // sobre los cabios y con la misma pendiente.
    const slats = Math.max(6, Math.round(d / 2.2));
    for (let i = 0; i < slats; i++) {
      const t = (i + 0.5) / slats - 0.5;
      const off = t * d;
      const pz = cz + off;
      const solar = i % 3 === 0;
      const yTop = height + rise * (1 - Math.abs(off) / halfSpan) + 0.17 / Math.cos(slope) + 0.06;
      this.farm.add(
        'box',
        solar ? this.mats.solar() : this.mats.glass(PALETTE.glassGreen, 0.42),
        new Vector3(cx, yTop, pz),
        new Vector3(w * 1.04, 0.12, (d / slats) * 0.96 / Math.cos(slope)),
        0,
        Math.sign(off) * slope,
      );
    }

    // Puestos: los decide el plano (la colisión los conoce).
    const stalls =
      block.stalls ??
      Array.from({ length: this.rng.int(6, 11) }, () => ({
        x: cx + this.rng.range(-w / 2 + 2, w / 2 - 2),
        z: cz + this.rng.range(-d / 2 + 2, d / 2 - 2),
        w: this.rng.range(2, 3.4),
        h: this.rng.range(2.1, 2.6),
        d: this.rng.range(1.6, 2.4),
      }));
    this.marketLife(cx, cz, stalls, w, d, height);
  }

  /**
   * Interior del edificio cívico visto a través del vidrio: núcleo de
   * servicios, luminarias encendidas bajo cada losa, estanterías o escritorios
   * y gente. Sin esto, el vidrio mostraba otra pared de vidrio detrás: una
   * pecera vacía.
   */
  private civicInterior(cx: number, cz: number, fw: number, fd: number, y: number, floor: number): void {
    const tint = this.street.tint;
    const rng = this.street.deco(cx, cz + floor * 7, 61);
    const h = FLOOR_H - 0.6;
    // Núcleo cálido en el centro (escaleras, baños): el fondo encendido.
    tint.boxOn('glow', [0.78, 0.7, 0.58], cx, cz, fw * 0.32, h, fd * 0.32, y);
    // Luminarias lineales bajo la losa de arriba.
    for (let i = -1; i <= 1; i++) {
      tint.add('plane', 'glow', [0.96, 0.93, 0.86], new Vector3(cx + i * fw * 0.28, y + h - 0.02, cz), new Vector3(0.3, fd * 0.75, 1), 0, -Math.PI / 2);
    }
    // Estanterías de biblioteca o escritorios de trabajo, y quien los usa.
    const n = this.street.fullDetail ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const px = cx + rng.range(-fw * 0.4, fw * 0.4);
      const pz = cz + side * fd * rng.range(0.25, 0.4);
      // De cara al vidrio más cercano (el que da a la calle de ese lado).
      if (rng.chance(0.5)) {
        tint.panel('glow', [0.45, 0.32, 0.2], px, y + 0.9, pz, 2.4, 1.8, 0, side);
        tint.panel('glow', rng.pick(BOOKS), px, y + 1.1, pz + side * 0.02, 2.2, 0.9, 0, side);
      } else {
        tint.panel('glow', [0.62, 0.5, 0.36], px, y + 0.38, pz, 1.6, 0.75, 0, side);
        tint.panel('glow', rng.pick(PEOPLE), px, y + 0.62, pz - side * 0.7, 0.45, 1.25, 0, side);
      }
    }
  }

  /** Frente del edificio cívico: su nombre, bicicleteros y bancos en la explanada. */
  private civicFront(block: Block, w: number, d: number): void {
    const { cx, cz } = block;
    const rng = this.street.deco(cx, cz, 67);
    const names = ['BIBLIOTECA DEL BARRIO', 'CENTRO DE SALUD', 'CENTRO CULTURAL', 'CLUB DE BARRIO'];
    const name = names[Math.abs(Math.round((cx + 3 * cz) / 64)) % names.length];
    const style = { text: name, bg: '#24423a', fg: '#f3ead2', font: 'sans' as const };
    const g = SIDEWALK_H;
    // El cartel sobre la losa del primer piso, en las dos caras largas.
    for (const s of [-1, 1]) {
      this.street.tint.add('box', 'lit', [0.14, 0.26, 0.22], new Vector3(cx, g + FLOOR_H + 0.1, cz + s * (d / 2 + 0.12)), new Vector3(Math.min(9, w * 0.5), 0.75, 0.12));
      this.street.signs.plate(style, cx, g + FLOOR_H + 0.1, cz + s * (d / 2 + 0.19), Math.min(8.6, w * 0.48), 0.6, 0, s);
    }
    // Explanada: bicicletero entre el vidrio y la vereda. Los bancos de al
    // lado son del plano (`plan.benches`, la gente se sienta en ellos); el
    // dado se sigue tirando para que el bicicletero no se mueva.
    const out = (w / 2 + block.width / 2) / 2;
    for (const s of [-1, 1]) {
      this.street.bikeRack(cx + rng.range(-6, 6), cz + s * out, Math.PI / 2, g);
      rng.range(8, 12);
    }
  }

  /**
   * El mercado vivo: puestos de colores con su toldo, mercadería en el
   * mostrador, cajones apilados y guirnaldas de luz bajo la cubierta.
   */
  private marketLife(
    cx: number,
    cz: number,
    stalls: NonNullable<Block['stalls']>,
    w: number,
    d: number,
    height: number,
  ): void {
    const tint = this.street.tint;
    const rng = this.street.deco(cx, cz, 71);
    const base = 0.25;
    const STALL: Array<readonly [number, number, number]> = [
      [0.79, 0.44, 0.28],
      [0.95, 0.76, 0.31],
      [0.91, 0.52, 0.36],
      [0.35, 0.55, 0.42],
      [0.3, 0.45, 0.65],
      [0.85, 0.85, 0.8],
    ];
    const GOODS: Array<readonly [number, number, number]> = [
      [0.85, 0.22, 0.15],
      [0.95, 0.6, 0.12],
      [0.4, 0.65, 0.25],
      [0.92, 0.85, 0.3],
      [0.6, 0.3, 0.55],
      [0.8, 0.65, 0.45],
    ];
    for (const st of stalls) {
      const c = rng.pick(STALL);
      const along = st.w >= st.d;
      // Mostrador de madera y el puesto detrás, abierto hacia el pasillo.
      tint.boxOn('lit', [0.55, 0.38, 0.22], st.x, st.z, st.w, 0.9, st.d, base);
      tint.boxOn('lit', c, st.x + (along ? 0 : st.w * 0.4), st.z + (along ? st.d * 0.4 : 0), along ? st.w : st.w * 0.2, st.h - 0.9, along ? st.d * 0.2 : st.d, base + 0.9);
      // Mercadería sobre el mostrador, en dos o tres montones de color.
      const n = this.street.fullDetail ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        // Paño horizontal sobre el mostrador: de pie se ve desde arriba.
        tint.decal(rng.pick(GOODS), st.x + (along ? t * st.w * 0.85 : -st.w * 0.15), base + 0.915, st.z + (along ? -st.d * 0.15 : t * st.d * 0.85), along ? st.w / n - 0.1 : st.w * 0.5, along ? st.d * 0.5 : st.d / n - 0.1);
      }
      // Toldo a dos colores sobre el puesto.
      tint.add('box', 'lit', c, new Vector3(st.x, base + st.h + 0.08, st.z), new Vector3(st.w + 0.5, 0.06, st.d + 0.5), 0, along ? 0.12 : 0, along ? 0 : 0.12);
      // Cajones apilados al costado.
      if (rng.chance(0.6)) {
        const sx = st.x + (along ? (st.w / 2 + 0.45) * (rng.chance(0.5) ? -1 : 1) : 0);
        const sz = st.z + (along ? 0 : (st.d / 2 + 0.45) * (rng.chance(0.5) ? -1 : 1));
        tint.boxOn('lit', [0.6, 0.45, 0.28], sx, sz, 0.6, 0.35, 0.45, base);
        tint.boxOn('lit', rng.pick(GOODS), sx, sz, 0.55, 0.1, 0.4, base + 0.35);
      }
    }
    // Guirnaldas de lamparitas cruzando la nave bajo la cumbrera.
    const strands = this.street.fullDetail ? 4 : 2;
    for (let k = 0; k < strands; k++) {
      const px = cx + ((k + 0.5) / strands - 0.5) * w * 0.8;
      const bulbs = this.street.fullDetail ? 9 : 5;
      for (let i = 0; i < bulbs; i++) {
        const t = (i + 0.5) / bulbs - 0.5;
        const sag = 0.6 * (1 - 4 * t * t);
        tint.add('box', 'glow', [1, 0.86, 0.55], new Vector3(px, height - 0.4 - sag, cz + t * d * 0.85), new Vector3(0.14, 0.14, 0.14));
      }
    }
  }
}

/**
 * ¿La cara da a la calle perimetral (de espaldas al barrio)? Del otro lado
 * de la calle está la manzana vecina de la grilla: si cae fuera del barrio
 * (gx 0–3, gz 1–3), la cara mira afuera. Las caras usan +z = 'north' y
 * +x = 'east' (ver `StreetLevel.shopfront`).
 */
function faceIsOuter(block: Block, face: StreetFace): boolean {
  const gx = block.gx + (face === 'east' ? 1 : face === 'west' ? -1 : 0);
  const gz = block.gz + (face === 'north' ? 1 : face === 'south' ? -1 : 0);
  return gx < 0 || gx > 3 || gz < 1 || gz > 3;
}

/** Lomos de libros y carpetas vistos de lejos: franjas de color apagadas. */
const BOOKS: Array<readonly [number, number, number]> = [
  [0.55, 0.3, 0.25],
  [0.3, 0.4, 0.55],
  [0.6, 0.55, 0.35],
  [0.35, 0.5, 0.38],
];
/** Ropa de la gente adentro de los edificios (siluetas sin luz propia). */
const PEOPLE: Array<readonly [number, number, number]> = [
  [0.25, 0.3, 0.45],
  [0.55, 0.25, 0.25],
  [0.3, 0.3, 0.3],
  [0.7, 0.65, 0.55],
];
