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
 * Infraestructura urbana: suelo, calles, canal y energía.
 *
 * Decisión de diseño: **no hay autos**. En 2050 esta ciudad resolvió la
 * movilidad con tranvía, bici y caminata, así que la calzada es angosta y la
 * vereda es enorme. No es un gesto decorativo: es lo que permite que las calles
 * tengan árboles grandes, bancos y agua, y es lo que hace que la escala se
 * sienta habitable cuando uno la recorre en VR.
 */
export class InfraBuilder {
  /** Paradas de tranvía ya ubicadas: el arbolado de vereda las esquiva. */
  private readonly stops: Array<{ x: number; z: number }> = [];

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
      // Tramos existentes: la calle entre las dos manzanas de la escuela se
      // corta, porque el predio es uno solo.
      for (const [s0, s1] of streetSpans(-length / 2, length / 2, street.gaps)) {
        const c = (s0 + s1) / 2;
        const l = s1 - s0;
        this.farm.add(
          'box',
          street.tram ? tramMat : laneMat,
          new Vector3(isX ? c : street.at, 0.04, isX ? street.at : c),
          isX ? new Vector3(l, 0.08, lane) : new Vector3(lane, 0.08, l),
        );

        // Cordón: la línea que separa calzada de vereda. Es un detalle
        // baratísimo (dos cajas por calle) y de los que más se notan al
        // caminar: sin él, vereda y calzada son el mismo plano pintado de otro
        // color.
        this.street.kerb(street.axis, street.at, lane / 2 + 0.16, l, c);
      }

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
          // La parada central se corre del eje: en el cruce con el eje central
          // caía justo delante del portón de la escuela y lo tapaba.
          const along = k * pitch + (k === 0 ? 19 : 0);
          if (Math.abs(along) > plan.extent - 20) continue;
          const side = k % 2 === 0 ? 1 : -1;
          const offset = lane / 2 + 2.6;
          const sx = isX ? along : street.at + side * offset;
          const sz = isX ? street.at + side * offset : along;
          this.street.tramStop(sx, sz, isX ? 0 : Math.PI / 2);
          this.stops.push({ x: sx, z: sz });
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
    if (block.landmark) {
      this.schoolStreetscape(block, plan);
      return;
    }
    const half = plan.blockSize / 2;
    // Línea de arbolado sobre la vereda, justo detrás del cordón.
    //
    // Antes estaba a 0,3 del ancho de calle desde el borde de la manzana, o sea
    // 15 cm DENTRO de la calzada: los alcorques pisaban el cordón y los troncos
    // salían del asfalto. Ahora el alcorque entero queda en la vereda.
    const lane = plan.streetWidth * 0.21;
    const treeLine = plan.streetWidth / 2 - (lane + 0.32 + 1.0);
    const offset = half + treeLine;
    const spacing = 12;
    const count = Math.max(2, Math.floor((plan.blockSize / spacing) * this.greenDensity));

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count - 0.5;
      const along = t * plan.blockSize + this.rng.range(-1.5, 1.5);
      // Frente de la escuela: el acceso necesita respirar y verse desde la
      // plaza, así que el tramo central queda libre de árboles y mobiliario.
      if (block.landmark === 'school' && Math.abs(along) < 12) continue;

      // Solo dos lados por manzana: asi ninguna calle se planta dos veces.
      // `ax`/`az` es la dirección de la calle (a lo largo de la vereda).
      const spots: Array<{ x: number; z: number; ax: number; az: number }> = [
        { x: block.cx + along, z: block.cz - offset, ax: 1, az: 0 },
        { x: block.cx - offset, z: block.cz + along, ax: 0, az: 1 },
      ];
      for (const spot of spots) {
        const { x, z, ax, az } = spot;
        // Una parada de tranvía ocupa ~5 m de vereda: nada de árboles, bancos
        // ni farolas encima (antes un tronco salía por el medio del banco).
        if (this.stops.some((p) => Math.abs(p.x - x) < 5 && Math.abs(p.z - z) < 5)) continue;
        const streetRot = ax === 1 ? 0 : Math.PI / 2;
        const hasTree = this.rng.chance(0.72);
        if (hasTree) {
          // Rango de escala amplio: arboles nuevos y ejemplares grandes en la
          // misma cuadra, sin tapar fachadas ni cruzarse con el mobiliario.
          const scale = this.rng.range(0.62, 1.12);
          // Alcorque: el árbol de vereda sale de un cuadro de tierra, no del
          // solado. Sin esto los troncos parecen clavados en el hormigón.
          this.street.treePit(x, z);
          if (this.rng.chance(0.82)) this.nature.broadleaf(x, z, scale, 0.1);
          else this.nature.conifer(x, z, scale * 0.9, 0.1);
        } else if (this.street.fullDetail && this.rng.chance(0.3)) {
          // Donde no hay árbol, mobiliario: la vereda vacía se ve muerta.
          const pick = this.rng.next();
          if (pick < 0.4) this.street.bikeRack(x, z, streetRot);
          else if (pick < 0.7) this.street.bin(x, z);
          else this.street.bollard(x, z);
        }
        // Farolas y bancos van sobre la MISMA línea que los árboles, entre
        // alcorques. Antes se corrían hacia la manzana y los bancos terminaban
        // metidos dentro de las fachadas.
        if (this.rng.chance(0.2)) {
          this.solarLamp(x - ax * 3.6, z - az * 3.6);
        }
        if (this.rng.chance(0.14)) {
          this.bench(x + ax * 3.4, z + az * 3.4, streetRot);
        }
      }
    }
  }

  /**
   * Veredas del predio escolar: la manzana doble planta su lado norte entero
   * (la principal) y su lado oeste (el anexo). Laprida, al sur, queda con las
   * palmeras y los postes que levanta la propia escuela.
   */
  private schoolStreetscape(block: Block, plan: CityPlan): void {
    const site = plan.schoolSite;
    if (!site) return;
    const lane = plan.streetWidth * 0.21;
    const treeLine = plan.streetWidth / 2 - (lane + 0.32 + 1.0);
    const north = block.landmark === 'school';
    const from = north ? site.x0 : site.z0;
    const to = north ? site.x1 : site.z1;
    const count = Math.max(2, Math.floor(((to - from) / 12) * this.greenDensity));
    for (let i = 0; i < count; i++) {
      const along = from + ((i + 0.5) / count) * (to - from) + this.rng.range(-1.5, 1.5);
      const x = north ? along : site.x0 - treeLine;
      const z = north ? site.z0 - treeLine : along;
      if (!this.rng.chance(0.72)) continue;
      this.street.treePit(x, z);
      this.nature.broadleaf(x, z, this.rng.range(0.62, 1.1), 0.1);
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
      // El eje X local de una caja girada `rotY` apunta a (cos, −sin). Con +sin
      // las patas quedaban espejadas respecto del asiento en cualquier banco
      // que no estuviera alineado con los ejes (los de la plaza, por ejemplo).
      this.farm.add(
        'box',
        mat,
        new Vector3(x + Math.cos(rotY) * s * 0.75, 0.22, z - Math.sin(rotY) * s * 0.75),
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

    // Lámina de agua. Su cara superior quedaba EXACTAMENTE en y = 0, igual que
    // el suelo base de toda la ciudad: las dos superficies peleaban por el
    // mismo píxel (z-fighting) y el canal se veía como manchas dentadas. Se la
    // sube 3 cm: sigue por debajo de calzadas y cordones, que cruzan encima.
    this.farm.add(
      'box',
      this.mats.water(),
      new Vector3(midX, -0.52, midZ),
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
    // La dirección de la caja girada es (cos(angle), -sin(angle)); su normal
    // correcta es (sin(angle), cos(angle)). Usar -sin desplazaba los bordes
    // hacia una diagonal distinta de la lámina de agua.
    for (const s of [-1, 1]) {
      const nx = Math.sin(angle) * s * (canal.halfWidth + 0.6);
      const nz = Math.cos(angle) * s * (canal.halfWidth + 0.6);
      this.farm.add(
        'box',
        this.mats.surface(PALETTE.concreteShade, 0.85),
        new Vector3(midX + nx, 0.1, midZ + nz),
        new Vector3(length, 0.9, 1.4),
        angle,
      );
      const gx = Math.sin(angle) * s * (canal.halfWidth + 3.4);
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
      // A lo largo de la dirección REAL de la lámina, (cos, −sin) del ángulo.
      // Con (cos, +sin) la ribera se plantaba sobre la diagonal espejada: los
      // árboles caían en medio de las calles y dentro de otras manzanas.
      const bx = midX + Math.cos(angle) * t * length;
      const bz = midZ - Math.sin(angle) * t * length;
      if (Math.abs(bx) > plan.extent || Math.abs(bz) > plan.extent) continue;
      for (const s of [-1, 1]) {
        const d = canal.halfWidth + this.rng.range(2.5, 5);
        const px = bx + Math.sin(angle) * s * d;
        const pz = bz + Math.cos(angle) * s * d;
        const plantTree = this.rng.chance(0.55);
        const plantShrub = this.rng.chance(0.7);
        if (!this.isBankFree(plan, px, pz)) continue;
        if (plantTree) this.nature.broadleaf(px, pz, this.rng.range(0.9, 1.35), 0.18);
        if (plantShrub) this.nature.shrub(px, pz, this.rng.range(0.8, 1.6), 0.18);
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
      const crossLength =
        street.axis === 'x'
          ? (canal.halfWidth * 2 * Math.hypot(1, canal.slope)) / Math.abs(canal.slope)
          : canal.halfWidth * 2 * Math.hypot(1, canal.slope);
      this.bridge(px, pz, street.axis, crossLength + 10);
    }
  }

  /** Puente peatonal/tranvía de madera y acero. */
  /**
   * ¿Se puede plantar en la ribera acá? No en la calzada (la ribera cruza la
   * trama en diagonal) ni dentro de una manzana edificada vecina al canal.
   */
  private isBankFree(plan: CityPlan, x: number, z: number): boolean {
    const pitch = plan.blockSize + plan.streetWidth;
    const lane = plan.streetWidth * 0.21 + 1.2;
    const street = (v: number) => (Math.round(v / pitch - 0.5) + 0.5) * pitch;
    if (Math.abs(x - street(x)) < lane || Math.abs(z - street(z)) < lane) return false;
    const half = (plan.gridSize - 1) / 2;
    const gx = Math.round(x / pitch + half);
    const gz = Math.round(z / pitch + half);
    const b = plan.blocks.find((k) => k.gx === gx && k.gz === gz);
    if (!b || Math.abs(x - b.cx) > b.width / 2 || Math.abs(z - b.cz) > b.depth / 2) return true;
    return b.kind === 'water' || b.kind === 'park' || b.kind === 'energy';
  }

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
    // Arco rebajado sobre cada baranda: dos tramos inclinados que nacen en los
    // extremos del tablero y se encuentran en el centro. Antes eran cajas en
    // el EJE del puente, a 2 m de altura, sin tocar nada: flotaban sobre la
    // calzada del tranvía.
    const rise = 1.8;
    const half = span / 2;
    const slope = Math.atan2(rise, half);
    const len = Math.hypot(rise, half);
    for (const side of [-1, 1]) {
      for (const s of [-1, 1]) {
        const along = (s * half) / 2;
        const cx = isX ? x + along : x + (side * width) / 2;
        const cz = isX ? z + (side * width) / 2 : z + along;
        this.farm.add(
          'box',
          railMat,
          new Vector3(cx, 1.05 + rise / 2 + 0.1, cz),
          isX ? new Vector3(len, 0.24, 0.24) : new Vector3(0.24, 0.24, len),
          0,
          // Z crece → el tramo baja (giro +α sobre X baja el extremo +Z).
          isX ? 0 : s * slope,
          // X crece → el tramo baja (giro −α sobre Z baja el extremo +X).
          isX ? -s * slope : 0,
        );
      }
    }
  }

  // ------------------------------------------------------------------ energía

  /** Manzana de producción: huerta solar en filas + turbinas verticales. */
  energy(block: Block): void {
    const { cx, cz, width, depth } = block;
    this.farm.add(
      'box',
      this.mats.grass(PALETTE.leafPale),
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

/** Tramos de [from, to] que quedan fuera de los huecos indicados. */
function streetSpans(from: number, to: number, gaps?: Array<[number, number]>): Array<[number, number]> {
  if (!gaps || gaps.length === 0) return [[from, to]];
  const out: Array<[number, number]> = [];
  let cur = from;
  for (const [g0, g1] of gaps.slice().sort((a, b) => a[0] - b[0])) {
    if (g0 > cur) out.push([cur, Math.min(g0, to)]);
    cur = Math.max(cur, g1);
  }
  if (cur < to) out.push([cur, to]);
  return out;
}
