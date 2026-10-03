import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import { CROSS_AT, KERB_W, LANE_FRAC, RAMP_LEN, SIDEWALK_H, type Block, type CityPlan, type Street } from '../CityLayout';
import type { NatureBuilder } from './NatureBuilder';
import type { BuildingBuilder } from './BuildingBuilder';
import type { StreetLevel } from './StreetLevel';
import { DistantCity } from './DistantCity';
import { GROUND_MARGIN } from '../TimeOfDay';
import { PALETTE } from '../Palette';

// LANE_FRAC, RAMP_LEN, CROSS_AT y KERB_W viven en `CityLayout` (los usan
// también la gente y el tránsito).
/** Medio ancho de una rampa (y de la senda). */
const RAMP_HALF = 1.3;

const hex = (h: string) => Color3.FromHexString(h);

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

  /**
   * Suelo: vereda y calzada sólo dentro del barrio; afuera, terreno con pasto
   * gastado y una franja de árboles que sugiere que el barrio sigue, sin
   * construirlo (la escuela es la protagonista).
   */
  ground(plan: CityPlan): void {
    // `ground` es lo primero que se levanta: desde acá, las mesitas que
    // `StreetLevel` saque a la vereda van directo al plano (las lee la gente
    // de la vereda, que se arma después de la ciudad).
    plan.cafeTables.length = 0;
    this.street.cafeTables = plan.cafeTables;
    const b = districtBounds(plan);
    // Una sola caja (el mapeo es métrico: la textura no se estira). Su borde
    // tiene que quedar dentro de la niebla desde cualquier punto del barrio:
    // ver TimeOfDay.GROUND_MARGIN y fogReach. Centrada en el barrio, no en la
    // escuela: el barrio se extiende más hacia el este (−x).
    const size = (plan.extent + GROUND_MARGIN) * 2;
    this.farm.add(
      'box',
      this.mats.surface(hex('#7d8a5c'), 0.95, 0, 'pavementXL'),
      new Vector3((b.x0 + b.x1) / 2, -0.52, (b.z0 + b.z1) / 2),
      new Vector3(size, 1, size),
    );
    const paving = this.mats.surface(PALETTE.pavement, 0.9, 0, 'pavementXL');
    this.farm.add(
      'box',
      paving,
      new Vector3((b.x0 + b.x1) / 2, -0.5, (b.z0 + b.z1) / 2),
      new Vector3(b.x1 - b.x0, 1, b.z1 - b.z0),
    );
    // La ciudad sigue: solado de las manzanas de enfrente (capa 1), en cuatro
    // franjas alrededor del barrio para no superponerse con su solado.
    const o = outerBounds(plan);
    for (const [x0, x1, z0, z1] of [
      [o.x0, o.x1, o.z0, b.z0],
      [o.x0, o.x1, b.z1, o.z1],
      [o.x0, b.x0, b.z0, b.z1],
      [b.x1, o.x1, b.z0, b.z1],
    ] as const) {
      this.farm.add('box', paving, new Vector3((x0 + x1) / 2, -0.5, (z0 + z1) / 2), new Vector3(x1 - x0, 1, z1 - z0));
    }
    new DistantCity(this.street.tint, this.street.fullDetail).build(plan);

    // Cinturón de árboles más allá de la capa 1, entre las torres del
    // horizonte (antes estaba donde hoy están las manzanas de enfrente). Los
    // que caen sobre la capa 1 o sobre una torre no se plantan. En el visor
    // no va: a más de 200 m la niebla los deja en un 90 % y costaban ~15k
    // triángulos (desde la calle los tapan las manzanas de enfrente).
    const count = this.street.fullDetail ? Math.round(110 * this.greenDensity) : 0;
    const masses = plan.backdrop.masses.filter((m) => m.layer === 2);
    const push = o.x1 - b.x1;
    for (let i = 0; i < count; i++) {
      const side = this.rng.int(0, 3);
      const out = 6 + Math.pow(this.rng.next(), 1.6) * 55 + push;
      const t = this.rng.next();
      const x = side === 0 ? b.x0 - out : side === 1 ? b.x1 + out : o.x0 - 40 + t * (o.x1 - o.x0 + 80);
      const z = side === 2 ? b.z0 - out : side === 3 ? b.z1 + out : o.z0 - 40 + t * (o.z1 - o.z0 + 80);
      const conifer = !this.rng.chance(0.85);
      const scale = conifer ? this.rng.range(0.9, 1.3) : this.rng.range(0.9, 1.5);
      const blocked =
        (x > o.x0 - 2 && x < o.x1 + 2 && z > o.z0 - 2 && z < o.z1 + 2) ||
        masses.some((m) => Math.abs(x - m.x) < m.w / 2 + 3 && Math.abs(z - m.z) < m.d / 2 + 3);
      if (blocked) continue;
      if (conifer) this.nature.conifer(x, z, scale, 0);
      else this.nature.broadleaf(x, z, scale, 0);
    }
  }

  /** Calzadas, cordones, veredas elevadas con sus rampas y sendas peatonales. */
  streets(plan: CityPlan): void {
    const laneMat = this.mats.surface(PALETTE.pavementDark, 0.88, 0, 'pavementXL');
    const tramMat = this.mats.surface(PALETTE.tramLane, 0.7, 0.12, 'pavementXL');
    const length = plan.extent * 2 + 40;
    const lane = plan.streetWidth * LANE_FRAC;

    for (const street of plan.streets) {
      const isX = street.axis === 'x';
      // Tramos existentes: la calle entre las dos manzanas de la escuela se
      // corta, porque el predio es uno solo. Cada punta se estira media
      // calzada: en las esquinas del barrio la calzada no queda mordida.
      const [from, to] = street.span ?? [-length / 2, length / 2];
      // El hueco se agranda hasta el borde de la calzada transversal: si no,
      // un muñón de asfalto cortaba la vereda de la escuela sobre Laprida y Lafinur.
      const pad = plan.streetWidth / 2 - lane / 2;
      const gaps = street.gaps?.map(([g0, g1]): [number, number] => [g0 - pad, g1 + pad]);
      for (const [s0, s1] of streetSpans(from - lane / 2, to + lane / 2, gaps)) {
        const c = (s0 + s1) / 2;
        const l = s1 - s0;
        this.farm.add(
          'box',
          street.tram ? tramMat : laneMat,
          new Vector3(isX ? c : street.at, 0.04, isX ? street.at : c),
          isX ? new Vector3(l, 0.08, lane) : new Vector3(lane, 0.08, l),
        );
      }
      this.schoolKerbs(plan, street);
    }
    // Calles de la ciudad de fondo: sólo la calzada (las veredas son de sus manzanas).
    for (const st of plan.backdrop.streets) {
      const isX = st.axis === 'x';
      const c = (st.from + st.to) / 2;
      const l = st.to - st.from + lane;
      this.farm.add('box', laneMat, new Vector3(isX ? c : st.at, 0.04, isX ? st.at : c), isX ? new Vector3(l, 0.08, lane) : new Vector3(lane, 0.08, l));
    }

    // Veredas elevadas: las manzanas del barrio y las de enfrente.
    for (const block of plan.blocks) if (!block.landmark) this.raisedSidewalk(plan, block.cx, block.cz);
    for (const k of plan.backdrop.blocks) this.backdropSidewalk(plan, k.cx, k.cz);

    this.crossings(plan);
    this.corners(plan);
    // Bancos de vereda y de explanada (los de las paradas los arma el refugio).
    for (const b of plan.benches) if (b.kind !== 'stop') this.street.bench(b.x, b.z, b.rotY, SIDEWALK_H);
    for (const p of plan.props) {
      if (p.kind === 'busStop') this.street.tramStop(p.x, p.z, Math.atan2(-p.nx, -p.nz), SIDEWALK_H);
      else this.street.newsKiosk(p.x, p.z, p.nx, p.nz, SIDEWALK_H);
      // El arbolado y el mobiliario de la vereda los esquivan.
      this.stops.push({ x: p.x, z: p.z });
    }
  }

  /**
   * Cordón del lado de la escuela: su vereda sigue a cota cero (la arma el
   * frente de la escuela), así que el cordón es el de antes, un canto de 17 cm.
   */
  private schoolKerbs(plan: CityPlan, street: Street): void {
    const site = plan.schoolSite;
    if (!site) return;
    const lane = plan.streetWidth * LANE_FRAC;
    const reach = plan.streetWidth / 2 - lane / 2 - KERB_W;
    const isX = street.axis === 'x';
    const lo = (isX ? site.x0 : site.z0) - reach;
    const hi = (isX ? site.x1 : site.z1) + reach;
    for (const edge of isX ? [site.z0, site.z1] : [site.x0, site.x1]) {
      if (Math.abs(street.at - edge) > plan.streetWidth / 2 + 0.01) continue;
      const side = edge > street.at ? 1 : -1;
      this.street.kerb(street.axis, street.at, lane / 2 + 0.16, hi - lo, (lo + hi) / 2, [side]);
    }
  }

  /**
   * Vereda elevada de una manzana: solado a `SIDEWALK_H` hasta el cordón,
   * con una rampa en cada senda peatonal.
   *
   * El núcleo es una losa; la franja exterior (la del cordón) se arma por
   * tramos, dejando el hueco de cada rampa, que baja hasta la calzada. Antes
   * la calzada estaba 8 cm POR ENCIMA de la vereda y el cordón era un listón
   * suelto: desde la altura de los ojos, calle y vereda eran el mismo plano.
   */
  private raisedSidewalk(plan: CityPlan, cx: number, cz: number): void {
    const paving = this.mats.surface(PALETTE.pavement, 0.9, 0, 'pavementXL');
    const kerbMat = this.mats.surface(PALETTE.concreteShade, 0.9, 0, 'pavement');
    const lane = plan.streetWidth * LANE_FRAC;
    const pitch = plan.blockSize + plan.streetWidth;
    // Borde exterior de la vereda (cara interior del cordón) desde el centro.
    const E = pitch / 2 - lane / 2 - KERB_W;
    const I = E - RAMP_LEN;
    const H = SIDEWALK_H;
    this.farm.add('box', paving, new Vector3(cx, H / 2 - 0.01, cz), new Vector3(I * 2, H + 0.02, I * 2));
    // Ventanas de rampa a lo largo de cada lado.
    const rampC = pitch / 2 - CROSS_AT;
    const windows: Array<[number, number]> = [
      [-rampC - RAMP_HALF, -rampC + RAMP_HALF],
      [rampC - RAMP_HALF, rampC + RAMP_HALF],
    ];
    const segments = (a: number, b: number): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      let cur = a;
      for (const [w0, w1] of windows) {
        if (w1 <= cur || w0 >= b) continue;
        if (w0 > cur) out.push([cur, w0]);
        cur = Math.max(cur, w1);
      }
      if (cur < b) out.push([cur, b]);
      return out;
    };
    const drop = H - 0.09;
    const len = RAMP_LEN + KERB_W;
    const tilt = Math.atan2(drop, len);
    for (const [nx, nz] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      const alongX = nz !== 0;
      // Las franjas N y S llegan a las esquinas; las E y O van entre ellas.
      const ext = alongX ? E : I;
      const r = (I + E) / 2;
      for (const [a, b] of segments(-ext, ext)) {
        const m = (a + b) / 2;
        const l = b - a;
        const x = alongX ? cx + m : cx + nx * r;
        const z = alongX ? cz + nz * r : cz + m;
        this.farm.add('box', paving, new Vector3(x, H / 2 - 0.01, z), alongX ? new Vector3(l, H + 0.02, RAMP_LEN) : new Vector3(RAMP_LEN, H + 0.02, l));
        // Cordón: canto de piedra más claro sobre el borde.
        const kx = alongX ? x : cx + nx * (E + 0.16);
        const kz = alongX ? cz + nz * (E + 0.16) : z;
        this.farm.add('box', kerbMat, new Vector3(kx, (H + 0.015) / 2, kz), alongX ? new Vector3(l, H + 0.015, KERB_W) : new Vector3(KERB_W, H + 0.015, l));
      }
      // Rampas: bajan de la vereda a la calzada en cada senda peatonal.
      for (const [w0, w1] of windows) {
        const m = (w0 + w1) / 2;
        const rr = (I + E + KERB_W) / 2;
        const x = alongX ? cx + m : cx + nx * rr;
        const z = alongX ? cz + nz * rr : cz + m;
        // Girar +α sobre X baja el extremo +Z; −α sobre Z baja el +X.
        this.farm.add(
          'box',
          paving,
          new Vector3(x, (H + 0.09) / 2 - 0.08, z),
          alongX ? new Vector3(w1 - w0, 0.16, len / Math.cos(tilt)) : new Vector3(len / Math.cos(tilt), 0.16, w1 - w0),
          0,
          alongX ? nz * tilt : 0,
          alongX ? 0 : -nx * tilt,
        );
      }
    }
  }

  /**
   * Vereda de una manzana de la ciudad de fondo: una losa y su cordón, sin
   * rampas (sus esquinas no tienen sendas: no se cruza por ahí).
   */
  private backdropSidewalk(plan: CityPlan, cx: number, cz: number): void {
    const paving = this.mats.surface(PALETTE.pavement, 0.9, 0, 'pavementXL');
    const kerbMat = this.mats.surface(PALETTE.concreteShade, 0.9, 0, 'pavement');
    const pitch = plan.blockSize + plan.streetWidth;
    const E = pitch / 2 - (plan.streetWidth * LANE_FRAC) / 2 - KERB_W;
    const H = SIDEWALK_H;
    this.farm.add('box', paving, new Vector3(cx, H / 2 - 0.01, cz), new Vector3(E * 2, H + 0.02, E * 2));
    for (const [nx, nz] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      const l = E * 2 + (nz !== 0 ? 0.64 : 0);
      this.farm.add('box', kerbMat, new Vector3(cx + nx * (E + 0.16), (H + 0.015) / 2, cz + nz * (E + 0.16)), nz !== 0 ? new Vector3(l, H + 0.015, KERB_W) : new Vector3(KERB_W, H + 0.015, l));
    }
  }

  /** Sendas peatonales (cebra) en cada brazo de cada esquina del barrio. */
  private crossings(plan: CityPlan): void {
    const lane = plan.streetWidth * LANE_FRAC;
    const paint: readonly [number, number, number] = [0.86, 0.86, 0.82];
    const tint = this.street.tint;
    const xs = plan.streets.filter((s) => s.axis === 'x');
    const zs = plan.streets.filter((s) => s.axis === 'z');
    const stripes = 6;
    for (const sx of xs) {
      for (const sz of zs) {
        const X = sz.at;
        const Z = sx.at;
        if (!streetAt(sx, X) || !streetAt(sz, Z)) continue;
        for (const s of [-1, 1]) {
          // Brazo de la calle en X hacia ±x: la senda la cruza a lo largo de Z.
          if (streetAt(sx, X + s * 12)) {
            for (let k = 0; k < stripes; k++) {
              const o = ((k + 0.5) / stripes - 0.5) * (lane - 0.5);
              tint.decal(paint, X + s * CROSS_AT, 0.092, Z + o, RAMP_HALF * 2, 0.5);
            }
          }
          // Brazo de la calle en Z hacia ±z.
          if (streetAt(sz, Z + s * 12)) {
            for (let k = 0; k < stripes; k++) {
              const o = ((k + 0.5) / stripes - 0.5) * (lane - 0.5);
              tint.decal(paint, X + o, 0.092, Z + s * CROSS_AT, 0.5, RAMP_HALF * 2);
            }
          }
        }
      }
    }
  }

  /**
   * Esquinas: chapas con el nombre de las calles. Los semáforos no van acá:
   * los dibuja y los anima el tránsito (`world/life`), sincronizados con los
   * autos; la chapa se corre 1,8 m de la esquina para no pisar su columna.
   */
  private corners(plan: CityPlan): void {
    const pitch = plan.blockSize + plan.streetWidth;
    const lane = plan.streetWidth * LANE_FRAC;
    const E = pitch / 2 - lane / 2 - KERB_W;
    // Esquina de la vereda, a 55 cm de los dos cordones.
    const corner = pitch / 2 - E + 0.55;
    const xs = plan.streets.filter((s) => s.axis === 'x');
    const zs = plan.streets.filter((s) => s.axis === 'z');
    const site = plan.schoolSite;
    const onSchool = (x: number, z: number) => !!site && x > site.x0 - 8 && x < site.x1 + 8 && z > site.z0 - 8 && z < site.z1 + 8;
    for (const sx of xs) {
      for (const sz of zs) {
        const X = sz.at;
        const Z = sx.at;
        if (!streetAt(sx, X) || !streetAt(sz, Z)) continue;
        const names = [sx, sz].filter((s) => s.name);
        if (names.length === 0) continue;
        // Esquinas de vereda elevada (las del lado de la escuela las arma ella).
        const spots = (
          [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ] as const
        ).filter(([s, t]) => !onSchool(X + s * corner, Z + t * corner));
        if (spots.length === 0) continue;
        // Dos postes en esquinas opuestas: se leen llegando por cualquier lado.
        const picks = spots.length > 1 ? [spots[0], spots[spots.length - 1]] : [spots[0]];
        for (const [s, t] of picks) {
          this.street.streetSigns(
            X + s * corner,
            Z + t * (corner + 1.8),
            names.map((n) => ({ text: n.name!, ax: n.axis === 'x' ? 1 : 0, az: n.axis === 'z' ? 1 : 0 })),
            SIDEWALK_H,
          );
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
    // Las casas del barrio plantan su propia vereda (NeighborhoodBuilder).
    if (block.kind === 'water' || block.kind === 'houses') return;
    if (block.landmark) {
      this.schoolStreetscape(block, plan);
      return;
    }
    const half = plan.blockSize / 2;
    // Vereda elevada: todo lo que se apoya en ella arranca a esa cota.
    const g = SIDEWALK_H;
    // Línea de arbolado sobre la vereda, justo detrás del cordón.
    //
    // Antes estaba a 0,3 del ancho de calle desde el borde de la manzana, o sea
    // 15 cm DENTRO de la calzada: los alcorques pisaban el cordón y los troncos
    // salían del asfalto. Ahora el alcorque entero queda en la vereda.
    const lane = plan.streetWidth * 0.21;
    const treeLine = plan.streetWidth / 2 - (lane + KERB_W + 1.0);
    const offset = half + treeLine;
    const spacing = 12;
    const count = Math.max(2, Math.floor((plan.blockSize / spacing) * this.greenDensity));

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count - 0.5;
      const along = t * plan.blockSize + this.rng.range(-1.5, 1.5);

      // Solo dos lados por manzana: asi ninguna calle se planta dos veces.
      // `ax` dice si la calle corre en X (a lo largo de la vereda).
      const spots: Array<{ x: number; z: number; ax: number }> = [
        { x: block.cx + along, z: block.cz - offset, ax: 1 },
        { x: block.cx - offset, z: block.cz + along, ax: 0 },
      ];
      for (const spot of spots) {
        const { x, z, ax } = spot;
        // Una parada o el kiosco ocupan ~5 m de vereda: nada de árboles,
        // bancos ni farolas encima (antes un tronco salía por el medio del banco).
        if (this.stops.some((p) => Math.abs(p.x - x) < 5 && Math.abs(p.z - z) < 5)) continue;
        const streetRot = ax === 1 ? 0 : Math.PI / 2;
        const hasTree = this.rng.chance(0.72);
        if (hasTree) {
          // Rango de escala amplio: arboles nuevos y ejemplares grandes en la
          // misma cuadra, sin tapar fachadas ni cruzarse con el mobiliario.
          const scale = this.rng.range(0.62, 1.12);
          // Alcorque: el árbol de vereda sale de un cuadro de tierra, no del
          // solado. Sin esto los troncos parecen clavados en el hormigón.
          this.street.treePit(x, z, g);
          if (this.rng.chance(0.82)) this.nature.broadleaf(x, z, scale, g + 0.1);
          else this.nature.conifer(x, z, scale * 0.9, g + 0.1);
        } else if (this.rng.chance(0.55)) {
          // Donde no hay árbol, mobiliario: la vereda vacía se ve muerta.
          const pick = this.rng.next();
          if (pick < 0.4) this.street.bikeRack(x, z, streetRot, g);
          else if (pick < 0.75) this.street.bin(x, z, g);
          else this.street.bollard(x, z, g);
        }
        // Los bancos salen del plano (`plan.benches`, los dibuja `streets`):
        // la gente se sienta en ellos. Se sigue tirando el dado de antes para
        // no correr el azar compartido (la escuela se arma después con él).
        this.rng.chance(0.22);
      }
    }
    this.lamps(block, plan);
    this.planters(block, plan);
  }

  /**
   * Canteros en las veredas sur y este de cada manzana, las que no llevan
   * arbolado (cada calle se planta una sola vez, desde el norte y el oeste):
   * sin ellos esas veredas quedaban peladas.
   */
  private planters(block: Block, plan: CityPlan): void {
    const pitch = plan.blockSize + plan.streetWidth;
    const E = pitch / 2 - (plan.streetWidth * LANE_FRAC) / 2 - KERB_W;
    const r = E - 0.9;
    const spots = this.street.fullDetail ? [-15, 3] : [-15];
    for (const [nx, nz] of [
      [0, 1],
      [1, 0],
    ] as const) {
      for (const along of spots) {
        const x = block.cx + (nz !== 0 ? along : nx * r);
        const z = block.cz + (nx !== 0 ? along : nz * r);
        if (this.stops.some((p) => Math.abs(p.x - x) < 4 && Math.abs(p.z - z) < 4)) continue;
        this.nature.planter(x, z, nz !== 0 ? 2.6 : 0.9, nz !== 0 ? 0.9 : 2.6, SIDEWALK_H, 1.6);
      }
    }
  }

  /**
   * Farolas: dos por cuadra en cada vereda del barrio, con el brazo sobre la
   * calzada. Antes salían al azar (una cada cinco lugares) y había cuadras
   * enteras sin una sola luz.
   */
  private lamps(block: Block, plan: CityPlan): void {
    const pitch = plan.blockSize + plan.streetWidth;
    const E = pitch / 2 - (plan.streetWidth * LANE_FRAC) / 2 - KERB_W;
    const r = E - 0.55;
    for (const [nx, nz] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      // En el visor, una por vereda, alternando el lado: con las de la vereda
      // de enfrente queda una luz cada ~20 m de calle.
      const spots = this.street.fullDetail ? [-9, 9] : [nx + nz > 0 ? 9 : -9];
      for (const along of spots) {
        const x = block.cx + (nz !== 0 ? along : nx * r);
        const z = block.cz + (nx !== 0 ? along : nz * r);
        if (this.stops.some((p) => Math.abs(p.x - x) < 4 && Math.abs(p.z - z) < 4)) continue;
        this.street.streetLamp(x, z, nx, nz, SIDEWALK_H);
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
    const treeLine = plan.streetWidth / 2 - (lane + KERB_W + 1.0);
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

  /**
   * Sube el detalle con color (`TintFarm`) y pinta los carteles. Idempotente:
   * lo llama `canal`, que `City` invoca después de todas las manzanas.
   */
  finish(): void {
    this.street.finish();
  }

  // --------------------------------------------------------------------- agua

  /** Canal: agua, taludes verdes y muelles de madera. */
  canal(plan: CityPlan): void {
    // Es lo último que `City` le pide a los constructores antes de subir la
    // granja: el detalle con color y los carteles se suben acá (ver `finish`).
    this.finish();
    const { canal } = plan;
    // El barrio de la escuela no tiene canal.
    if (canal.halfWidth <= 0) return;
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

/** Rectángulo del barrio: calles y manzanas edificadas, con las veredas exteriores. */
export function districtBounds(plan: CityPlan): { x0: number; x1: number; z0: number; z1: number } {
  const pitch = plan.blockSize + plan.streetWidth;
  const margin = plan.streetWidth / 2;
  return { x0: -2.5 * pitch - margin, x1: 1.5 * pitch + margin, z0: -1.5 * pitch - margin, z1: 1.5 * pitch + margin };
}

/** ¿La calle existe en esa coordenada a lo largo de su eje (dentro del tramo y fuera de los huecos)? */
function streetAt(st: Street, v: number): boolean {
  const [a, b] = st.span ?? [-Infinity, Infinity];
  if (v < a - 0.01 || v > b + 0.01) return false;
  return !(st.gaps ?? []).some(([g0, g1]) => v > g0 && v < g1);
}

/** Rectángulo de la capa 1 de la ciudad de fondo, con sus veredas exteriores. */
export function outerBounds(plan: CityPlan): { x0: number; x1: number; z0: number; z1: number } {
  const pitch = plan.blockSize + plan.streetWidth;
  const margin = plan.streetWidth / 2;
  return { x0: -3.5 * pitch - margin, x1: 2.5 * pitch + margin, z0: -2.5 * pitch - margin, z1: 2.5 * pitch + margin };
}
