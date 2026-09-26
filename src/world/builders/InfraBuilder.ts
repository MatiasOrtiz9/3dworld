import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import type { Block, CityPlan } from '../CityLayout';
import type { NatureBuilder } from './NatureBuilder';
import type { BuildingBuilder } from './BuildingBuilder';
import type { StreetLevel } from './StreetLevel';
import { PALETTE } from '../Palette';

/**
 * Infraestructura urbana: suelo, calles, canal, plaza y energía.
 *
 * Decisión de diseño: **no hay autos**. En 2050 esta ciudad resolvió la
 * movilidad con tranvía, bici y caminata, así que la calzada es angosta y la
 * vereda es enorme. No es un gesto decorativo: es lo que permite que las calles
 * tengan árboles grandes, bancos y agua, y es lo que hace que la escala se
 * sienta habitable cuando uno la recorre en VR.
 */
export class InfraBuilder {
  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly rng: Rng,
    private readonly nature: NatureBuilder,
    private readonly buildings: BuildingBuilder,
    private readonly street: StreetLevel,
    private readonly greenDensity = 1,
  ) {}

  /** Suelo base de toda la ciudad. */
  ground(plan: CityPlan): void {
    const size = plan.extent * 2 + 200;
    this.farm.add(
      'box',
      this.mats.surface(PALETTE.pavement, 0.9, 0, 'pavementXL'),
      new Vector3(0, -0.5, 0),
      new Vector3(size, 1, size),
    );
  }

  /** Calzadas y veredas. */
  streets(plan: CityPlan): void {
    const laneMat = this.mats.surface(PALETTE.pavementDark, 0.88, 0, 'pavementXL');
    const tramMat = this.mats.surface(PALETTE.tramLane, 0.7, 0.12, 'pavementXL');
    const length = plan.extent * 2 + 40;

    for (const street of plan.streets) {
      // Calzada central angosta (la mitad del ancho de la calle).
      const lane = street.width * 0.42;
      const isX = street.axis === 'x';
      this.farm.add(
        'box',
        street.tram ? tramMat : laneMat,
        new Vector3(isX ? 0 : street.at, 0.04, isX ? street.at : 0),
        isX ? new Vector3(length, 0.08, lane) : new Vector3(lane, 0.08, length),
      );

      // Cordón: la línea que separa calzada de vereda. Es un detalle
      // baratísimo (dos cajas por calle) y de los que más se notan al caminar:
      // sin él, vereda y calzada son el mismo plano pintado de otro color.
      this.street.kerb(street.axis, street.at, lane / 2 + 0.16, length);

      // Rieles del tranvía: dos líneas finas y brillantes.
      if (street.tram) {
        const railMat = this.mats.metal(PALETTE.solarFrame, 0.2);
        for (const s of [-1, 1]) {
          this.farm.add(
            'box',
            railMat,
            new Vector3(
              isX ? 0 : street.at + s * lane * 0.22,
              0.1,
              isX ? street.at + s * lane * 0.22 : 0,
            ),
            isX ? new Vector3(length, 0.06, 0.12) : new Vector3(0.12, 0.06, length),
          );
        }

        // Paradas cada ~3 manzanas, alternando de lado de la vía.
        const pitch = (plan.blockSize + plan.streetWidth) * 3;
        const stops = Math.floor(plan.extent / pitch) * 2;
        for (let k = -stops / 2; k <= stops / 2; k++) {
          const along = k * pitch;
          if (Math.abs(along) > plan.extent - 20) continue;
          const side = k % 2 === 0 ? 1 : -1;
          const offset = lane / 2 + 2.6;
          const sx = isX ? along : street.at + side * offset;
          const sz = isX ? street.at + side * offset : along;
          this.street.tramStop(sx, sz, isX ? 0 : Math.PI / 2);
        }
      }
    }
  }

  /**
   * Arbolado y mobiliario de calle.
   *
   * Correccion importante respecto de la primera version: antes se plantaban
   * los CUATRO lados de cada manzana, asi que cada calle recibia arboles de
   * las dos manzanas que la comparten y la densidad salia duplicada: la ciudad
   * quedaba tapada por un bosque. Ahora cada manzana planta solo sus lados
   * norte y oeste, de modo que cada calle se planta exactamente una vez.
   */
  streetscape(block: Block, plan: CityPlan): void {
    if (block.kind === 'water') return;
    const half = plan.blockSize / 2;
    const offset = half + plan.streetWidth * 0.3;
    const spacing = 12;
    const count = Math.max(2, Math.floor((plan.blockSize / spacing) * this.greenDensity));

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count - 0.5;
      const along = t * plan.blockSize + this.rng.range(-1.5, 1.5);

      // Solo dos lados por manzana: asi ninguna calle se planta dos veces.
      const spots: Array<[number, number]> = [
        [block.cx + along, block.cz - offset],
        [block.cx - offset, block.cz + along],
      ];
      for (const [x, z] of spots) {
        if (this.rng.chance(0.82)) {
          // Rango de escala amplio: arboles nuevos y ejemplares grandes en la
          // misma cuadra. La variacion es lo que evita el efecto "chupetin".
          const scale = this.rng.range(0.65, 1.6);
          // Alcorque: el árbol de vereda sale de un cuadro de tierra, no del
          // solado. Sin esto los troncos parecen clavados en el hormigón.
          this.street.treePit(x, z);
          if (this.rng.chance(0.82)) this.nature.broadleaf(x, z, scale);
          else this.nature.conifer(x, z, scale * 0.9);
        } else if (this.street.fullDetail && this.rng.chance(0.3)) {
          // Donde no hay árbol, mobiliario: la vereda vacía se ve muerta.
          const pick = this.rng.next();
          if (pick < 0.4) this.street.bikeRack(x, z, this.rng.range(0, Math.PI));
          else if (pick < 0.7) this.street.bin(x, z);
          else this.street.bollard(x, z);
        }
        if (this.rng.chance(0.2)) this.solarLamp(x, z);
        if (this.rng.chance(0.14)) this.bench(x, z, this.rng.range(0, Math.PI));
      }
    }
  }

  /** Farola con panel solar propio y luz cálida. */
  private solarLamp(x: number, z: number): void {
    const h = 5.2;
    const poleMat = this.mats.metal(PALETTE.solarFrame, 0.4);
    this.farm.add('cylinder', poleMat, new Vector3(x, h / 2, z), new Vector3(0.14, h, 0.14));
    // Panel inclinado en la punta.
    this.farm.add(
      'box',
      this.mats.solar(),
      new Vector3(x, h + 0.12, z),
      new Vector3(1.1, 0.07, 0.7),
      0,
      -0.3,
    );
    // Luminaria emisiva (no es una luz real: sería carísimo tener cientos).
    this.farm.add(
      'box',
      this.mats.glow(PALETTE.sun, 0.55),
      new Vector3(x, h - 0.35, z),
      new Vector3(0.5, 0.1, 0.34),
    );
  }

  /** Banco de madera. */
  private bench(x: number, z: number, rotY: number): void {
    const mat = this.mats.surface(PALETTE.timberLight, 0.85, 0, 'timber');
    this.farm.add('box', mat, new Vector3(x, 0.45, z), new Vector3(1.9, 0.12, 0.52), rotY);
    for (const s of [-1, 1]) {
      this.farm.add(
        'box',
        mat,
        new Vector3(x + Math.cos(rotY) * s * 0.75, 0.22, z + Math.sin(rotY) * s * 0.75),
        new Vector3(0.14, 0.44, 0.46),
        rotY,
      );
    }
  }

  // --------------------------------------------------------------------- agua

  /** Canal: agua, taludes verdes y muelles de madera. */
  canal(plan: CityPlan): void {
    const { canal } = plan;
    const length = plan.extent * 2.9;
    // Babylon es zurdo: rotar +X sobre Y por un angulo lo lleva a
    // (cos, 0, -sin). La recta que queremos tiene direccion (cos, 0, +sin),
    // asi que el angulo va NEGADO. Sin esto el canal se dibujaba espejado
    // sobre el eje X y no coincidia con las manzanas marcadas como agua.
    const angle = -Math.atan(canal.slope);
    // Punto medio del eje del canal dentro del terreno.
    const midX = 0;
    const midZ = canal.offset;

    // Lámina de agua, hundida.
    this.farm.add(
      'box',
      this.mats.water(),
      new Vector3(midX, -0.55, midZ),
      new Vector3(length, 1.1, canal.halfWidth * 2),
      angle,
    );
    // Lecho oscuro, para dar profundidad.
    this.farm.add(
      'box',
      this.mats.surface(PALETTE.waterDeep, 0.9),
      new Vector3(midX, -1.5, midZ),
      new Vector3(length, 1, canal.halfWidth * 2.02),
      angle,
    );

    // Muros de borde + franja verde a cada lado.
    for (const s of [-1, 1]) {
      const nx = -Math.sin(angle) * s * (canal.halfWidth + 0.6);
      const nz = Math.cos(angle) * s * (canal.halfWidth + 0.6);
      this.farm.add(
        'box',
        this.mats.surface(PALETTE.concreteShade, 0.85),
        new Vector3(midX + nx, 0.1, midZ + nz),
        new Vector3(length, 0.9, 1.4),
        angle,
      );
      const gx = -Math.sin(angle) * s * (canal.halfWidth + 3.4);
      const gz = Math.cos(angle) * s * (canal.halfWidth + 3.4);
      this.farm.add(
        'box',
        this.mats.grass(PALETTE.leafMid),
        new Vector3(midX + gx, 0.1, midZ + gz),
        new Vector3(length, 0.16, 4.4),
        angle,
      );
    }

    // Vegetación de ribera y juncos.
    const steps = 46;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps - 0.5;
      const bx = midX + Math.cos(angle) * t * length;
      const bz = midZ + Math.sin(angle) * t * length;
      if (Math.abs(bx) > plan.extent || Math.abs(bz) > plan.extent) continue;
      for (const s of [-1, 1]) {
        const ox = -Math.sin(angle) * s * (canal.halfWidth + this.rng.range(2.5, 5));
        const oz = Math.cos(angle) * s * (canal.halfWidth + this.rng.range(2.5, 5));
        if (this.rng.chance(0.55)) {
          this.nature.broadleaf(bx + ox, bz + oz, this.rng.range(0.9, 1.35));
        }
        if (this.rng.chance(0.7)) this.nature.shrub(bx + ox, bz + oz, this.rng.range(0.8, 1.6));
      }
    }

    // Puentes donde el canal cruza las avenidas con tranvía.
    for (const street of plan.streets) {
      if (!street.tram) continue;
      // Intersección del eje de la calle con el eje del canal.
      let px: number;
      let pz: number;
      if (street.axis === 'x') {
        pz = street.at;
        px = (pz - canal.offset) / canal.slope;
      } else {
        px = street.at;
        pz = canal.slope * px + canal.offset;
      }
      if (Math.abs(px) > plan.extent || Math.abs(pz) > plan.extent) continue;
      this.bridge(px, pz, street.axis, canal.halfWidth * 2 + 10);
    }
  }

  /** Puente peatonal/tranvía de madera y acero. */
  private bridge(x: number, z: number, axis: 'x' | 'z', span: number): void {
    const deckMat = this.mats.surface(PALETTE.timberMid, 0.82, 0, 'timber');
    const railMat = this.mats.metal(PALETTE.solarFrame, 0.35);
    const width = 9;
    const isX = axis === 'x';

    this.farm.add(
      'box',
      deckMat,
      new Vector3(x, 0.85, z),
      isX ? new Vector3(span, 0.4, width) : new Vector3(width, 0.4, span),
    );
    // Barandas.
    for (const s of [-1, 1]) {
      this.farm.add(
        'box',
        railMat,
        new Vector3(isX ? x : x + (s * width) / 2, 1.6, isX ? z + (s * width) / 2 : z),
        isX ? new Vector3(span, 1.1, 0.14) : new Vector3(0.14, 1.1, span),
      );
    }
    // Arco estructural sencillo: tres cajas.
    for (const s of [-1, 1]) {
      this.farm.add(
        'box',
        railMat,
        new Vector3(
          isX ? x + (s * span) / 4 : x,
          2.1,
          isX ? z : z + (s * span) / 4,
        ),
        isX ? new Vector3(span * 0.4, 0.22, 0.22) : new Vector3(0.22, 0.22, span * 0.4),
        0,
        isX ? -s * 0.2 : 0,
        isX ? 0 : s * 0.2,
      );
    }
  }

  // -------------------------------------------------------------------- plaza

  /**
   * Plaza central: el corazón de la ciudad y el punto de aparición.
   *
   * Lleva el "Árbol Solar": una pérgola radial de paneles que da sombra y
   * genera energía. Es el hito visual de la ciudad — lo primero que se ve
   * al aparecer y la referencia para orientarse desde cualquier calle.
   */
  plaza(block: Block, plan: CityPlan): void {
    const { cx, cz } = block;
    const size = plan.blockSize;

    // Solado en dos tonos, con un anillo.
    this.farm.add(
      'box',
      this.mats.surface(PALETTE.concreteLight, 0.88, 0, 'pavement'),
      new Vector3(cx, 0.06, cz),
      new Vector3(size, 0.12, size),
    );
    this.farm.add(
      'cylinder',
      this.mats.surface(PALETTE.pavement, 0.85, 0, 'pavement'),
      new Vector3(cx, 0.1, cz),
      new Vector3(size * 0.78, 0.1, size * 0.78),
    );
    // Anillos concéntricos de despiece: rompen la mancha blanca uniforme y,
    // sobre todo, dan referencia de escala al caminar.
    for (let i = 1; i <= 3; i++) {
      this.farm.add(
        'cylinder',
        this.mats.surface(PALETTE.pavementDark, 0.9, 0, 'pavement'),
        new Vector3(cx, 0.12, cz),
        new Vector3(size * (0.2 + i * 0.16), 0.06, size * (0.2 + i * 0.16)),
      );
      this.farm.add(
        'cylinder',
        this.mats.surface(PALETTE.concreteLight, 0.85, 0, 'pavement'),
        new Vector3(cx, 0.13, cz),
        new Vector3(size * (0.2 + i * 0.16) - 0.7, 0.06, size * (0.2 + i * 0.16) - 0.7),
      );
    }

    this.solarTree(cx, cz);

    // Espejo de agua en anillo, cortado en cuatro por los accesos.
    const waterMat = this.mats.water();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const r = size * 0.3;
      this.farm.add(
        'box',
        waterMat,
        new Vector3(cx + Math.cos(a) * r, 0.14, cz + Math.sin(a) * r),
        new Vector3(size * 0.26, 0.16, size * 0.1),
        a + Math.PI / 2,
      );
    }

    // Arboles en el perimetro y bancos mirando al centro.
    // Se deja un hueco deliberado en el sector sur (donde aparece el jugador):
    // aparecer con la cara contra un tronco arruina el primer momento.
    const ring = 12;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      const facingSouth = Math.sin(a) < -0.72;
      const r = size * 0.44;
      if (!facingSouth) {
        this.nature.broadleaf(
          cx + Math.cos(a) * r,
          cz + Math.sin(a) * r,
          this.rng.range(1.1, 1.6),
        );
      }
      if (i % 2 === 0) {
        const br = size * 0.32;
        this.bench(cx + Math.cos(a) * br, cz + Math.sin(a) * br, a + Math.PI / 2);
      }
    }
  }

  /** El Árbol Solar: pérgola radial de paneles sobre un mástil central. */
  private solarTree(x: number, z: number): void {
    const trunkH = 10.5;
    const trunkMat = this.mats.metal(PALETTE.solarFrame, 0.35);
    const panelMat = this.mats.solar();

    // Mástil que se abre en tres tramos.
    this.farm.add('cylinder', trunkMat, new Vector3(x, trunkH / 2, z), new Vector3(1.05, trunkH, 1.05));
    this.farm.add(
      'cylinder',
      trunkMat,
      new Vector3(x, trunkH * 0.92, z),
      new Vector3(2.4, 0.9, 2.4),
    );

    // Dos coronas de "hojas" fotovoltaicas, giradas entre sí.
    // 7 palas en vez de 9 y más cortas: si se tocan entre sí, la copa se
    // fusiona en un disco negro y parece un tejado. Separadas, se lee como una
    // pérgola técnica y deja pasar luz al piso de la plaza.
    const petals = 7;
    for (let layer = 0; layer < 2; layer++) {
      // Radio contenido: con 9,5 m las palas medían 8 m y el árbol tapaba la
      // ciudad entera desde la plaza. Una pérgola de ~12 m de diámetro da
      // sombra y sigue dejando ver el horizonte.
      const r = layer === 0 ? 6.2 : 4.1;
      const y = trunkH + layer * 2.3;
      const tilt = layer === 0 ? -0.26 : -0.34;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + layer * 0.35;
        // El soporte es una VIGA angosta por debajo, no una bandeja: cuando el
        // marco era casi tan grande como el panel, desde abajo se veía sólo
        // marco claro y la pérgola perdía el azul de los paneles.
        this.farm.add(
          'box',
          trunkMat,
          new Vector3(x + Math.cos(a) * r * 0.55, y - 0.18, z + Math.sin(a) * r * 0.55),
          new Vector3(r * 0.98, 0.14, 0.34),
          a,
          0,
          tilt,
        );
        this.farm.add(
          'box',
          panelMat,
          new Vector3(x + Math.cos(a) * r * 0.55, y, z + Math.sin(a) * r * 0.55),
          new Vector3(r * 0.88, 0.11, 2.3),
          a,
          0,
          tilt,
        );
        // Tensor.
        this.farm.add(
          'cylinder',
          trunkMat,
          new Vector3(x + Math.cos(a) * r * 0.3, y - 1.1, z + Math.sin(a) * r * 0.3),
          new Vector3(0.1, 2.2, 0.1),
          0,
          0,
          0,
        );
      }
    }

    // Luz cálida bajo la copa: hace que la plaza funcione también de noche.
    this.farm.add(
      'cylinder',
      this.mats.glow(PALETTE.sun, 0.5),
      new Vector3(x, trunkH - 0.6, z),
      new Vector3(2.6, 0.18, 2.6),
    );
  }

  // ------------------------------------------------------------------ energía

  /** Manzana de producción: huerta solar en filas + turbinas verticales. */
  energy(block: Block): void {
    const { cx, cz, width, depth } = block;
    this.farm.add(
      'box',
      this.mats.foliage(PALETTE.leafPale),
      new Vector3(cx, 0.06, cz),
      new Vector3(width, 0.12, depth),
    );

    // Filas de paneles orientadas al norte (hemisferio sur) e inclinadas ~35°.
    const rows = Math.floor(depth / 5.5);
    const panelMat = this.mats.solar();
    const legMat = this.mats.metal(PALETTE.solarFrame, 0.45);
    for (let r = 0; r < rows; r++) {
      const pz = cz - depth / 2 + (r + 0.6) * (depth / rows);
      const w = width * 0.86;
      this.farm.add(
        'box',
        panelMat,
        new Vector3(cx, 1.9, pz),
        new Vector3(w, 0.12, 3.4),
        0,
        -0.6,
      );
      const legs = Math.max(2, Math.round(w / 7));
      for (let i = 0; i < legs; i++) {
        const t = (i + 0.5) / legs - 0.5;
        this.farm.add(
          'cylinder',
          legMat,
          new Vector3(cx + t * w, 0.9, pz),
          new Vector3(0.16, 1.8, 0.16),
        );
      }
      // Pasto y arbustos entre filas: la huerta solar también es hábitat.
      if (this.rng.chance(0.6)) {
        this.nature.shrub(
          cx + this.rng.range(-w / 2, w / 2),
          pz + 2.4,
          this.rng.range(0.6, 1.1),
        );
      }
    }

    // Turbinas en una esquina.
    const turbines = this.rng.int(1, 3);
    for (let i = 0; i < turbines; i++) {
      this.buildings.verticalTurbine(
        cx + this.rng.range(-width / 2 + 4, width / 2 - 4),
        cz + this.rng.range(-depth / 2 + 4, depth / 2 - 4),
        0,
        this.rng.range(11, 17),
      );
    }

    // Baterías: contenedores bajos y ordenados.
    if (this.rng.chance(0.5)) {
      const bx = cx + width * 0.3;
      const bz = cz - depth * 0.34;
      for (let i = 0; i < 3; i++) {
        this.farm.addBoxOnGround(
          this.mats.surface(PALETTE.concreteLight, 0.6),
          bx,
          bz + i * 3,
          6.5,
          2.6,
          2.4,
          0,
        );
      }
    }
  }

  /** Parque: bosque urbano con senderos y un estanque. */
  park(block: Block): void {
    const { cx, cz, width, depth } = block;
    this.nature.lawn(cx, cz, width, depth);

    // Sendero en cruz suave.
    const pathMat = this.mats.surface(PALETTE.pavement, 0.9, 0, 'pavement');
    this.farm.add('box', pathMat, new Vector3(cx, 0.1, cz), new Vector3(width, 0.1, 3.2));
    this.farm.add('box', pathMat, new Vector3(cx, 0.1, cz), new Vector3(3.2, 0.1, depth));

    this.nature.urbanForest(cx, cz, width, depth, this.greenDensity);

    // Estanque descentrado.
    if (this.rng.chance(0.45)) {
      const px = cx + this.rng.range(-width * 0.2, width * 0.2);
      const pz = cz + this.rng.range(-depth * 0.2, depth * 0.2);
      const r = this.rng.range(6, 10);
      this.farm.add('cylinder', this.mats.water(), new Vector3(px, 0.1, pz), new Vector3(r, 0.3, r * 0.75));
      this.farm.add(
        'cylinder',
        this.mats.surface(PALETTE.soil, 0.95),
        new Vector3(px, 0.05, pz),
        new Vector3(r * 1.12, 0.2, r * 0.86),
      );
    }
  }
}
