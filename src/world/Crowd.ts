import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Block, CityPlan } from './CityLayout';
import type { CityIndex } from './CityIndex';
import { Rng } from '../utils/rng';
import { STANDARD_SUN_COMP } from './Materials';
import {
  BIKE,
  HIP_X,
  HIP_Y,
  SHIN_LEN,
  SHOULDER_X,
  SHOULDER_Y,
  THIGH_LEN,
  buildPeopleParts,
  type PartName,
} from './PeopleGeometry';
import { COURT, FORECOURT, GARDEN, toWorld, type Rect, type SchoolFrame } from './SchoolLayout';

type Mode = 'street' | 'wander' | 'group' | 'cycle';
type RGB = [number, number, number];

interface Person {
  mode: Mode;
  x: number;
  z: number;
  /** Rumbo actual y rumbo deseado: los giros se suavizan, nadie rota en seco. */
  heading: number;
  targetHeading: number;
  speed: number;
  cruise: number;
  /** Segundos que le quedan al estado actual (pausa, caminata, gesto). */
  timer: number;
  walking: boolean;
  /** Calle: lado de la vereda respecto del sentido de marcha y distancia al eje. */
  side: number;
  laneOffset: number;
  inCrossing: boolean;
  /** Deambular: zona y destino. */
  zone: Zone | null;
  tx: number;
  tz: number;
  /** Animación. */
  phase: number;
  gesture: number;
  idleSeed: number;
  /** Cuerpo: escala de altura y de contextura. */
  s: number;
  g: number;
  // Aspecto.
  top: RGB;
  bottom: RGB;
  skin: RGB;
  hair: RGB;
  shoe: RGB;
  bag: RGB;
  bike: RGB;
  hairStyle: 0 | 1 | 2 | 3;
  skirt: boolean;
  shorts: boolean;
  longSleeves: boolean;
  backpack: boolean;
}

/** Área donde una persona deambula: una manzana o un sector del campus. */
interface Zone {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  /** Rectángulo local del campus, si la zona está dentro de la escuela. */
  schoolRect?: Rect;
}

export interface CrowdOptions {
  /** Distancia máxima a la que se dibuja gente. En VR conviene recortarla. */
  drawDistance?: number;
  /** Distancia hasta la que se dibujan manos y zapatos. */
  detailDistance?: number;
}

// ---------------------------------------------------------------- paletas

const hex = (h: string): RGB => {
  const c = Color3.FromHexString(h);
  return [c.r, c.g, c.b];
};

/** Ropa de arriba: tonos tierra y colores vivos pero no fluo. */
const TOPS = [
  '#f4efe6', '#e9dcc0', '#d9a441', '#c8643b', '#b8433a', '#7fa36b', '#4f8a7a',
  '#3f6e9c', '#2f4a6d', '#8c6bb0', '#e39a9a', '#5b5f66', '#2d2f33', '#9ec3d6',
  '#d97b52', '#6f8f3a',
].map(hex);
const BOTTOMS = ['#2f3e5c', '#3b4f73', '#2a2c30', '#4a4038', '#7a6a52', '#5a6b4a', '#c9b99a', '#6d3b3b'].map(hex);
const SKIRTS = ['#7a3b52', '#2f3e5c', '#c26a45', '#3f6e5a', '#d9b36a', '#4b3f6b'].map(hex);
const SKINS = ['#f1c9a5', '#e0ac85', '#c98e66', '#a86f4c', '#8a5638', '#6b4029', '#f3d2b8'].map(hex);
const HAIRS = ['#1e1612', '#2e2018', '#4a3020', '#6b4526', '#a0673a', '#c9a064', '#8c8c8c', '#d9d4c8', '#5a2a1c'].map(hex);
const SHOES = ['#f2f2ef', '#2a2a2a', '#3a2c22', '#c94b3b', '#355f8a', '#d9d9d2'].map(hex);
const BAGS = ['#2f5d8a', '#c8643b', '#3f6e4a', '#d9a441', '#6b3b6b', '#2d2f33', '#b8433a'].map(hex);
const BIKES = ['#2b7a78', '#d9a441', '#c8643b', '#f4efe6', '#3f6e9c', '#2d2f33'].map(hex);
/** Uniforme escolar: remera blanca o chomba azul, pantalón oscuro. */
const UNIFORM_TOPS = ['#f4f2ee', '#f4f2ee', '#2c4a7a', '#1f5f4f'].map(hex);
const UNIFORM_BOTTOMS = ['#1f2a44', '#2a2c30', '#3a3f4a'].map(hex);

/** Qué partes llevan cuántas copias por persona y quién decide su color. */
const PARTS: PartName[] = [
  'torso', 'head', 'hairShort', 'hairLong', 'hairBun', 'skirt', 'backpack',
  'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'shoe', 'bike',
];
const PER_PERSON: Record<PartName, number> = {
  torso: 1, head: 1, hairShort: 1, hairLong: 1, hairBun: 1, skirt: 1, backpack: 1,
  upperArm: 2, forearm: 2, hand: 2, thigh: 2, shin: 2, shoe: 2, bike: 1,
};

/** Buffers de una pieza: matrices + colores, compactados cada cuadro. */
interface Channel {
  mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  n: number;
}

/**
 * Gente.
 *
 * Es lo que más cambia la percepción del espacio: una ciudad con locales,
 * bancos y bicicleteros pero sin nadie sigue siendo una maqueta.
 *
 * Cada persona es una figura low-poly articulada —torso, cabeza con rasgos,
 * tres cortes de pelo, brazos con codo, piernas con rodilla, zapatillas— con
 * altura, contextura, piel, pelo y ropa propios. Hay cuatro comportamientos:
 * caminar por la vereda doblando en las esquinas, deambular con pausas en
 * plazas, parques y el patio de la escuela, charlar en grupos, y andar en bici
 * por la calzada.
 *
 * Coste: todas las piezas comparten UN material y cada pieza es una sola malla
 * con thin instances, así que la multitud entera son ~15 draw calls sin
 * importar cuánta gente haya. Por cuadro sólo se escriben las personas que la
 * cámara puede ver (distancia + cono de visión), compactadas al principio del
 * buffer: en VR, lo que queda detrás de la cabeza no cuesta vértices.
 */
export class Crowd {
  private readonly people: Person[] = [];
  private readonly groupCenters: Array<{ x: number; z: number }> = [];
  private readonly channels = new Map<PartName, Channel>();
  private readonly material: StandardMaterial;
  private readonly shadowMat: StandardMaterial;
  private readonly shadowTex: DynamicTexture;
  private readonly shadow: Channel;
  private readonly rng: Rng;
  private readonly drawDistance: number;
  private readonly detailDistance: number;
  private readonly streetHalf: number;
  private readonly lane: number;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    plan: CityPlan,
    private readonly index: CityIndex,
    seed: number,
    count = 200,
    options: CrowdOptions = {},
  ) {
    this.rng = new Rng(seed ^ 0x9a1c);
    this.drawDistance = options.drawDistance ?? 170;
    this.detailDistance = options.detailDistance ?? 45;
    this.streetHalf = plan.streetWidth / 2;
    this.lane = plan.streetWidth * 0.21;

    this.spawn(plan, count);

    // Un único material para toda la multitud: el color sale del vértice
    // (sombreado, ojos, suela) multiplicado por el de la instancia (ropa, piel).
    const mat = new StandardMaterial('people', scene);
    // Blanco atenuado: ver STANDARD_SUN_COMP. Al sol pleno la ropa da su color
    // exacto y los costados en sombra conservan volumen.
    mat.diffuseColor = new Color3(STANDARD_SUN_COMP, STANDARD_SUN_COMP, STANDARD_SUN_COMP).scale(1.1);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mat.specularPower = 24;
    // Piso de luz propia: en sombra, sin IBL (StandardMaterial no lo usa),
    // la ropa oscura quedaba negra y la figura se perdía contra el solado.
    // Multiplica al color base, así que no aplana los tonos.
    mat.emissiveColor = new Color3(0.38, 0.38, 0.4);
    this.material = mat;

    const parts = buildPeopleParts(scene);
    const n = Math.max(1, this.people.length);
    for (const name of PARTS) {
      this.channels.set(name, this.makeChannel(parts[name], n * PER_PERSON[name]));
    }

    // Sombra de contacto: un disco difuso bajo cada persona. En VR no hay
    // sombras proyectadas, y sin este disco la gente parece flotar.
    this.shadowTex = new DynamicTexture('peopleShadowTex', { width: 64, height: 64 }, scene, false);
    const ctx = this.shadowTex.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    this.shadowTex.hasAlpha = true;
    this.shadowTex.update();

    const smat = new StandardMaterial('peopleShadow', scene);
    smat.diffuseColor = Color3.Black();
    smat.specularColor = Color3.Black();
    smat.emissiveColor = Color3.Black();
    smat.disableLighting = true;
    smat.opacityTexture = this.shadowTex;
    smat.useAlphaFromDiffuseTexture = false;
    smat.disableDepthWrite = true;
    smat.zOffset = -2;
    smat.fogEnabled = true;
    this.shadowMat = smat;

    const disc = CreateGround('peopleShadow', { width: 1, height: 1 }, scene);
    disc.material = smat;
    this.shadow = this.makeChannel(disc, n, false);

    this.scene.onBeforeRenderObservable.add(this.update);
  }

  private makeChannel(mesh: Mesh, capacity: number, colored = true): Channel {
    mesh.isPickable = false;
    if (colored) mesh.material = this.material;
    // El volumen envolvente de una malla con instancias que se mueven cada
    // cuadro no se puede mantener barato. Se la marca como siempre activa y
    // el recorte se hace a mano, persona por persona, en `update`.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    const matrices = new Float32Array(capacity * 16);
    const colors = new Float32Array(capacity * 4);
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    if (colored) mesh.thinInstanceSetBuffer('color', colors, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    return { mesh, matrices, colors, n: 0 };
  }

  // ------------------------------------------------------------------ inicio

  /**
   * Coloca a la gente donde tiene sentido que haya gente.
   *
   * No se reparte de manera uniforme: la mayoría circula por las veredas con
   * más densidad cerca del centro; un grupo grande se queda en plaza, parques
   * y mercados; y el campus tiene sus alumnos, con mochila y uniforme.
   */
  private spawn(plan: CityPlan, count: number): void {
    const rng = this.rng;
    const blocks = plan.blocks;
    // Plaza y parques: espacios de estancia. El mercado queda afuera porque su
    // nave ocupa casi toda la manzana y la gente terminaba apretada en el borde.
    const gathering = blocks.filter((b) => b.kind === 'plaza' || b.kind === 'park');
    const plaza = blocks.find((b) => b.kind === 'plaza');
    const school = this.index.school;

    const nStudents = school ? Math.round(count * 0.16) : 0;
    const nGroups = Math.round(count * 0.14);
    const nWander = Math.round(count * 0.2);
    const nCyclists = Math.round(count * 0.08);

    // --- alumnos: grupos en la explanada y el patio, y algunos deambulando.
    if (school) {
      let placed = 0;
      let guard = 0;
      while (placed < nStudents && guard++ < 400) {
        // Explanada de entrada 45 %, patio 40 %, huerta 15 %.
        const r = rng.next();
        const rect = r < 0.45 ? FORECOURT : r < 0.85 ? COURT : GARDEN;
        const zone = schoolZone(school, rect);
        if (rng.chance(0.6)) {
          placed += this.spawnGroup(zone, rng.int(2, 4), true);
        } else {
          const p = this.randomIn(zone);
          if (!p) continue;
          this.people.push(this.makePerson('wander', p.x, p.z, { student: true, zone }));
          placed++;
        }
      }
    }

    // --- grupos charlando: la plaza pesa el doble que un parque cualquiera.
    let groupPeople = 0;
    let guard = 0;
    while (groupPeople < nGroups && gathering.length > 0 && guard++ < 300) {
      const b = plaza && rng.chance(0.5) ? plaza : rng.pick(gathering);
      groupPeople += this.spawnGroup(blockZone(b), rng.int(2, 4), false);
    }

    // --- gente que deambula con pausas.
    guard = 0;
    let wanderers = 0;
    while (wanderers < nWander && gathering.length > 0 && guard++ < nWander * 20) {
      const b = plaza && rng.chance(0.4) ? plaza : rng.pick(gathering);
      const zone = blockZone(b);
      const p = this.randomIn(zone);
      if (!p) continue;
      this.people.push(this.makePerson('wander', p.x, p.z, { zone }));
      wanderers++;
    }

    // --- veredas y calzada.
    const pitch = plan.blockSize + plan.streetWidth;
    const half = (Math.sqrt(blocks.length) - 1) / 2;
    let cyclists = 0;
    guard = 0;
    while (this.people.length < count && guard++ < count * 40) {
      // Sesgo hacia el centro: elevar un valor aleatorio a una potencia mayor
      // que 1 concentra las muestras cerca de cero.
      const radial = Math.pow(rng.next(), 1.6) * half;
      const angle = rng.range(0, Math.PI * 2);
      const along = Math.sin(angle) * radial * pitch;
      const axis = (Math.round(Math.cos(angle) * radial - 0.5) + 0.5) * pitch;
      const onZ = rng.chance(0.5); // calle que corre a lo largo de Z
      const cyclist = cyclists < nCyclists && rng.chance(0.25);

      const heading = onZ ? (rng.chance(0.5) ? 0 : Math.PI) : rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
      const side = cyclist ? 1 : rng.chance(0.5) ? 1 : -1;
      // Peatones entre la línea de árboles y el borde de la manzana; ciclistas
      // sobre la calzada, fuera de los rieles del centro.
      const off = cyclist ? rng.range(1.6, 2.5) : rng.range(this.lane + 2.5, this.streetHalf - 0.5);
      // Desplazamiento lateral según el lado de la marcha.
      const rx = Math.cos(heading);
      const rz = -Math.sin(heading);
      const x = onZ ? axis + rx * side * off : along;
      const z = onZ ? along : axis + rz * side * off;
      if (this.index.isPedestrianBlocked(x, z)) continue;

      const p = this.makePerson(cyclist ? 'cycle' : 'street', x, z, {});
      p.heading = p.targetHeading = heading;
      p.side = side;
      p.laneOffset = off;
      this.people.push(p);
      if (cyclist) cyclists++;
    }
  }

  /** Un grupo de 2-4 personas mirándose, alrededor de un punto libre. */
  private spawnGroup(zone: Zone, size: number, students: boolean): number {
    const c = this.randomIn(zone, 1.2);
    if (!c) return 0;
    // Dos grupos pegados se leen como uno solo, desordenado: se exige aire.
    for (const g of this.groupCenters) {
      if (Math.hypot(g.x - c.x, g.z - c.z) < 3.5) return 0;
    }
    this.groupCenters.push(c);
    const rng = this.rng;
    const r = size === 2 ? 0.5 : rng.range(0.62, 0.8);
    const start = rng.range(0, Math.PI * 2);
    let added = 0;
    for (let i = 0; i < size; i++) {
      const a = start + (i / size) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      if (this.index.isPedestrianBlocked(x, z)) continue;
      const p = this.makePerson('group', x, z, { student: students, zone });
      // Mirando al centro del grupo.
      p.heading = p.targetHeading = Math.atan2(c.x - x, c.z - z) + rng.range(-0.2, 0.2);
      this.people.push(p);
      added++;
    }
    return added;
  }

  private randomIn(zone: Zone, clearance = 0): { x: number; z: number } | null {
    for (let k = 0; k < 12; k++) {
      const x = zone.cx + this.rng.range(-zone.hx, zone.hx);
      const z = zone.cz + this.rng.range(-zone.hz, zone.hz);
      if (this.index.isPedestrianBlocked(x, z)) continue;
      if (
        clearance > 0 &&
        (this.index.isPedestrianBlocked(x + clearance, z) ||
          this.index.isPedestrianBlocked(x - clearance, z) ||
          this.index.isPedestrianBlocked(x, z + clearance) ||
          this.index.isPedestrianBlocked(x, z - clearance))
      ) {
        continue;
      }
      return { x, z };
    }
    return null;
  }

  private makePerson(
    mode: Mode,
    x: number,
    z: number,
    opts: { student?: boolean; zone?: Zone },
  ): Person {
    const rng = this.rng;
    const student = opts.student ?? false;
    // Alturas reales: adultos 1,55-1,92 m; alumnos de secundaria 1,45-1,78 m.
    const height = student ? rng.range(1.45, 1.78) : rng.range(1.55, 1.92);
    const feminine = rng.chance(0.5);
    const skirt = !student && feminine && rng.chance(0.3);
    const hairStyle: Person['hairStyle'] = feminine
      ? rng.pick([2, 2, 3, 1] as const)
      : rng.chance(0.1)
        ? 0
        : rng.pick([1, 1, 1, 2] as const);
    const skin = rng.pick(SKINS);
    const top = student && rng.chance(0.7) ? rng.pick(UNIFORM_TOPS) : rng.pick(TOPS);
    const bottom = skirt ? rng.pick(SKIRTS) : student ? rng.pick(UNIFORM_BOTTOMS) : rng.pick(BOTTOMS);
    const cruise = mode === 'cycle' ? rng.range(3.8, 5.4) : rng.range(1.05, 1.55);
    const heading = rng.range(0, Math.PI * 2);
    return {
      mode,
      x,
      z,
      heading,
      targetHeading: heading,
      speed: mode === 'group' ? 0 : cruise,
      cruise,
      timer: rng.range(1, 6),
      walking: mode !== 'group',
      side: 1,
      laneOffset: 5,
      inCrossing: false,
      zone: opts.zone ?? null,
      tx: x,
      tz: z,
      phase: rng.range(0, Math.PI * 2),
      gesture: 0,
      idleSeed: rng.range(0, 100),
      s: height / 1.72,
      g: feminine ? rng.range(0.86, 1.02) : rng.range(0.94, 1.16),
      top,
      bottom,
      skin,
      hair: rng.chance(0.08) && !student ? rng.pick(HAIRS.slice(6, 8)) : rng.pick(HAIRS.slice(0, 6).concat(HAIRS[8])),
      shoe: rng.pick(SHOES),
      bag: rng.pick(BAGS),
      bike: rng.pick(BIKES),
      hairStyle,
      skirt,
      shorts: !skirt && !student && rng.chance(0.18),
      longSleeves: rng.chance(0.3),
      backpack: student ? rng.chance(0.85) : mode !== 'group' && rng.chance(0.12),
    };
  }

  // ----------------------------------------------------------------- update

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    this.time += dt;

    const cam = this.scene.activeCamera;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let fx = 0;
    let fz = 1;
    if (cam) {
      const p = cam.globalPosition;
      cx = p.x;
      cy = p.y;
      cz = p.z;
      cam.getDirectionToRef(FORWARD, _dir);
      const l = Math.hypot(_dir.x, _dir.z);
      if (l > 1e-4) {
        fx = _dir.x / l;
        fz = _dir.z / l;
      }
    }

    for (const ch of this.channels.values()) ch.n = 0;
    this.shadow.n = 0;

    const far2 = this.drawDistance * this.drawDistance;
    const detail2 = this.detailDistance * this.detailDistance;
    // Mirando desde lo alto (modo volar) el cono horizontal no sirve.
    const overhead = cy > 30;

    for (const p of this.people) {
      this.simulate(p, dt);

      // --- recorte: distancia y cono de visión horizontal generoso (±110°).
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2) continue;
      if (!overhead && d2 > 36) {
        const d = Math.sqrt(d2);
        if ((dx * fx + dz * fz) / d < -0.35) continue;
      }
      this.pose(p, dt, d2 < detail2);
    }

    for (const ch of this.channels.values()) this.flush(ch, true);
    this.flush(this.shadow, false);
  };

  private flush(ch: Channel, colored: boolean): void {
    const visible = ch.n > 0;
    ch.mesh.isVisible = visible;
    if (!visible) return;
    ch.mesh.thinInstanceCount = ch.n;
    ch.mesh.thinInstanceBufferUpdated('matrix');
    if (colored) ch.mesh.thinInstanceBufferUpdated('color');
  }

  // ----------------------------------------------------------- comportamiento

  private simulate(p: Person, dt: number): void {
    p.timer -= dt;
    switch (p.mode) {
      case 'group':
        // Quietos, pero no estatuas: de a ratos alguien gesticula.
        if (p.timer <= 0) {
          p.gesture = this.rng.chance(0.45) ? 1 : 0;
          p.timer = this.rng.range(2, 7);
        }
        break;
      case 'wander':
        this.wander(p, dt);
        break;
      default:
        this.street(p, dt);
        break;
    }

    // Giro suave hacia el rumbo deseado (≈ 200°/s como máximo).
    let dh = p.targetHeading - p.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const maxTurn = (p.mode === 'cycle' ? 1.6 : 3.4) * dt;
    p.heading += Math.max(-maxTurn, Math.min(maxTurn, dh));

    // Aceleración y frenado graduales: el paso nace y muere, no se corta.
    const want = p.walking ? p.cruise * (Math.abs(dh) > 1.2 ? 0.4 : 1) : 0;
    const acc = p.mode === 'cycle' ? 2 : 2.6;
    p.speed += Math.max(-acc * dt, Math.min(acc * dt, want - p.speed));
    if (p.speed <= 0.001) return;

    const step = p.speed * dt;
    const nx = p.x + Math.sin(p.heading) * step;
    const nz = p.z + Math.cos(p.heading) * step;
    if (this.index.isPedestrianBlocked(nx, nz)) {
      // Obstáculo: media vuelta (calle) o destino nuevo (deambular).
      if (p.mode === 'wander') this.pickTarget(p);
      else p.targetHeading = p.heading + Math.PI;
      p.speed *= 0.3;
      return;
    }
    p.x = nx;
    p.z = nz;
  }

  private wander(p: Person, dt: number): void {
    if (p.walking) {
      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      if (dx * dx + dz * dz < 0.36 || p.timer <= 0) {
        // Llegó: se queda un rato mirando alrededor.
        p.walking = false;
        p.timer = this.rng.range(2, 9);
        p.gesture = this.rng.chance(0.2) ? 1 : 0;
      } else {
        p.targetHeading = Math.atan2(dx, dz);
      }
    } else {
      if (p.timer <= 0) this.pickTarget(p);
      else if (this.rng.chance(dt * 0.25)) p.targetHeading = p.heading + this.rng.range(-1.2, 1.2);
    }
  }

  private pickTarget(p: Person): void {
    if (!p.zone) return;
    const t = this.randomIn(p.zone);
    if (!t) return;
    p.tx = t.x;
    p.tz = t.z;
    p.walking = true;
    p.gesture = 0;
    p.timer = 40;
  }

  /** Veredas (peatones) y calzada (ciclistas): siguen la trama, doblan en esquinas. */
  private street(p: Person, dt: number): void {
    const idx = this.index;
    const sx = idx.nearestStreet(p.x);
    const sz = idx.nearestStreet(p.z);
    const inCrossing = Math.abs(p.x - sx) < this.streetHalf && Math.abs(p.z - sz) < this.streetHalf;
    const aligned = Math.abs(Math.atan2(Math.sin(p.targetHeading - p.heading), Math.cos(p.targetHeading - p.heading))) < 0.05;

    if (inCrossing && !p.inCrossing && aligned) {
      // Esquina: seguir, doblar o (rara vez) volver.
      const r = this.rng.next();
      if (r < 0.22) p.targetHeading = snap(p.heading + Math.PI / 2);
      else if (r < 0.4) p.targetHeading = snap(p.heading - Math.PI / 2);
      else if (r < 0.43 && p.mode === 'street') p.targetHeading = snap(p.heading + Math.PI);
    }
    p.inCrossing = inCrossing;

    // Pausas cortas de peatón: mirar una vidriera, esperar a alguien.
    if (p.mode === 'street') {
      if (p.walking && p.timer <= 0) {
        if (this.rng.chance(0.12) && !inCrossing) {
          p.walking = false;
          p.timer = this.rng.range(1.5, 5);
        } else {
          p.timer = this.rng.range(4, 12);
        }
      } else if (!p.walking && p.timer <= 0) {
        p.walking = true;
        p.timer = this.rng.range(5, 14);
      }
    }

    // Mantenerse en su carril: se corrige la coordenada perpendicular al
    // rumbo hacia (eje de la calle + lado × distancia). Fuera de los cruces.
    if (inCrossing) return;
    const h = p.targetHeading;
    const alongZ = Math.abs(Math.cos(h)) > 0.7;
    const rPerp = alongZ ? Math.cos(h) : -Math.sin(h);
    const axis = alongZ ? sx : sz;
    const desired = axis + Math.sign(rPerp) * p.side * p.laneOffset;
    const cur = alongZ ? p.x : p.z;
    const err = desired - cur;
    const maxFix = (p.mode === 'cycle' ? 1.2 : 0.8) * dt;
    const fix = Math.max(-maxFix, Math.min(maxFix, err));
    if (Math.abs(err) > 0.02) {
      const nx = alongZ ? p.x + fix : p.x;
      const nz = alongZ ? p.z : p.z + fix;
      if (!idx.isPedestrianBlocked(nx, nz)) {
        p.x = nx;
        p.z = nz;
      }
    }
  }

  // --------------------------------------------------------------- animación

  /** Escribe las matrices de una persona en los canales de sus piezas. */
  private pose(p: Person, dt: number, detailed: boolean): void {
    const s = p.s;
    const g = p.g;
    const ground = this.index.surfaceHeight(p.x, p.z);
    const h = p.heading;
    const sinH = Math.sin(h);
    const cosH = Math.cos(h);
    // Vector "derecha" de la persona (local +X).
    const rx = cosH;
    const rz = -sinH;

    let hipY: number;
    let hipX = p.x;
    let hipZ = p.z;
    let lean: number;
    let twist = 0;
    let thighL: number;
    let thighR: number;
    let shinL: number;
    let shinR: number;
    let armL: number;
    let armR: number;
    let rollArm = 0.07;
    let rollSway = 0;

    if (p.mode === 'cycle') {
      // --- en bici: sentado, inclinado hacia el manubrio, pedaleando.
      // Cadencia de ~75 rpm a velocidad crucero: la rueda gira, el plato
      // multiplica, las bielas van más lento que la rueda.
      p.phase += dt * (p.speed / 0.6);
      const bikeY = ground;
      hipY = bikeY + BIKE.seatY * s;
      hipX = p.x + sinH * BIKE.seatZ * s;
      hipZ = p.z + cosH * BIKE.seatZ * s;
      lean = 0.42;
      const legs = pedalIK(p.phase);
      thighL = legs.thighA;
      shinL = legs.shinA;
      const legs2 = pedalIK(p.phase + Math.PI);
      thighR = legs2.thighA;
      shinR = legs2.shinA;
      armL = armR = 0.95;
      rollArm = 0.02;
      this.emit('bike', compose(0, h, 0, s, s, s, p.x, bikeY, p.z), p.bike);
    } else {
      // --- a pie: ciclo de paso proporcional a la velocidad.
      const amp = Math.min(1, p.speed / Math.max(0.1, p.cruise));
      p.phase += dt * p.speed * (4.9 / s);
      const ph = p.phase;
      const A = 0.36 * amp;
      thighL = A * Math.sin(ph);
      thighR = A * Math.sin(ph + Math.PI);
      const kneeL = 0.05 + 0.82 * amp * Math.max(0, Math.cos(ph + 0.55));
      const kneeR = 0.05 + 0.82 * amp * Math.max(0, Math.cos(ph + Math.PI + 0.55));
      shinL = thighL - kneeL;
      shinR = thighR - kneeR;
      armL = -0.34 * amp * Math.sin(ph) + 0.06;
      armR = -0.34 * amp * Math.sin(ph + Math.PI) + 0.06;
      twist = 0.05 * amp * Math.sin(ph);
      lean = 0.035 * amp;
      rollSway = 0.026 * amp * Math.sin(ph);

      if (amp < 0.3) {
        // Parado: se apoya en una pierna, respira y, a veces, gesticula.
        const t = this.time + p.idleSeed;
        const still = 1 - amp / 0.3;
        const shift = Math.sin(t * 0.35) > 0 ? 1 : -1;
        const bend = 0.13 * still;
        if (shift > 0) {
          thighL += bend * 0.4;
          shinL -= bend * 0.6;
        } else {
          thighR += bend * 0.4;
          shinR -= bend * 0.6;
        }
        twist += 0.05 * Math.sin(t * 0.5) * still;
        if (p.gesture) {
          const wave = 0.45 + 0.28 * Math.sin(t * 2.3) + 0.12 * Math.sin(t * 5.1);
          if (Math.sin(p.idleSeed) > 0) armR += wave * still;
          else armL += wave * still;
        }
        armL += 0.03 * Math.sin(t * 1.1);
        armR += 0.03 * Math.sin(t * 1.1 + 1);
      }
      // Altura de cadera: la pierna más estirada toca el piso. Así el balanceo
      // vertical del cuerpo sale solo, y ningún pie se hunde ni flota.
      const dropL = THIGH_LEN * Math.cos(thighL) + SHIN_LEN * Math.cos(shinL);
      const dropR = THIGH_LEN * Math.cos(thighR) + SHIN_LEN * Math.cos(shinR);
      hipY = ground + Math.max(dropL, dropR) * s;
    }

    // --- cuerpo (torso, cabeza, pelo, pollera, mochila): pivota en la cadera.
    // Sway lateral orgánico por transferencia de peso al caminar + leve peralte al doblar.
    rollSway += Math.min(0.05, Math.max(-0.05, (p.targetHeading - p.heading) * 0.12));
    const body = composePivot(lean, h + twist, rollSway, s * g, s, s * g, HIP_Y, hipX, hipY, hipZ);
    body.copyToArray(_bodyArr);
    this.emitArr('torso', _bodyArr, p.top);
    this.emitArr('head', _bodyArr, p.skin);
    if (p.hairStyle === 1) this.emitArr('hairShort', _bodyArr, p.hair);
    else if (p.hairStyle === 2) this.emitArr('hairLong', _bodyArr, p.hair);
    else if (p.hairStyle === 3) this.emitArr('hairBun', _bodyArr, p.hair);
    if (p.skirt) this.emitArr('skirt', _bodyArr, p.bottom);
    if (p.backpack) this.emitArr('backpack', _bodyArr, p.bag);

    // --- brazos: el hombro sigue al torso (inclinación y giro incluidos).
    const forearmColor = p.longSleeves ? p.top : p.skin;
    for (let side = -1; side <= 1; side += 2) {
      Vector3.TransformCoordinatesFromFloatsToRef(side * SHOULDER_X, SHOULDER_Y, 0, body, _v);
      const swing = side < 0 ? armL : armR;
      const m = compose(-swing + (p.mode === 'cycle' ? 0 : lean * 0.5), h + twist, side * rollArm, s * g, s, s * g, _v.x, _v.y, _v.z);
      m.copyToArray(_limbArr);
      this.emitArr('upperArm', _limbArr, p.top);
      this.emitArr('forearm', _limbArr, forearmColor);
      if (detailed) this.emitArr('hand', _limbArr, p.skin);
    }

    // --- piernas: muslo desde la cadera, pierna y zapato desde la rodilla.
    const legColor = p.skirt ? p.skin : p.bottom;
    const shinColor = p.skirt || p.shorts ? p.skin : p.bottom;
    for (let side = -1; side <= 1; side += 2) {
      const hx = hipX + rx * side * HIP_X * s * g;
      const hz = hipZ + rz * side * HIP_X * s * g;
      const thigh = side < 0 ? thighL : thighR;
      const shin = side < 0 ? shinL : shinR;
      const tm = compose(-thigh, h, 0, s * g, s, s * g, hx, hipY, hz);
      tm.copyToArray(_limbArr);
      this.emitArr('thigh', _limbArr, legColor);
      Vector3.TransformCoordinatesFromFloatsToRef(0, -THIGH_LEN, 0, tm, _v);
      const sm = compose(-shin, h, 0, s * g, s, s * g, _v.x, _v.y, _v.z);
      sm.copyToArray(_limbArr);
      this.emitArr('shin', _limbArr, shinColor);
      if (detailed || p.mode === 'cycle') this.emitArr('shoe', _limbArr, p.shoe);
    }

    // --- sombra de contacto, apenas sobre el solado.
    const sh = this.shadow;
    const sw = p.mode === 'cycle' ? 0.75 * s : 0.62 * s * g;
    const sl = p.mode === 'cycle' ? 1.9 * s : 0.62 * s;
    compose(0, h, 0, sw, 1, sl, p.x, ground + 0.025, p.z).copyToArray(sh.matrices, sh.n * 16);
    sh.n++;
  }

  private emit(part: PartName, m: Matrix, color: RGB): void {
    m.copyToArray(_limbArr);
    this.emitArr(part, _limbArr, color);
  }

  private emitArr(part: PartName, arr: Float32Array, color: RGB): void {
    const ch = this.channels.get(part)!;
    const i = ch.n++;
    ch.matrices.set(arr, i * 16);
    const c = i * 4;
    ch.colors[c] = color[0];
    ch.colors[c + 1] = color[1];
    ch.colors[c + 2] = color[2];
    ch.colors[c + 3] = 1;
  }

  get population(): number {
    return this.people.length;
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
    for (const ch of this.channels.values()) ch.mesh.dispose();
    this.channels.clear();
    this.shadow.mesh.dispose();
    this.material.dispose();
    this.shadowMat.dispose();
    this.shadowTex.dispose();
    this.people.length = 0;
  }
}

// ------------------------------------------------------------------ utilidades

function blockZone(b: Block): Zone {
  return { cx: b.cx, cz: b.cz, hx: b.width * 0.44, hz: b.depth * 0.44 };
}

function schoolZone(f: SchoolFrame, r: Rect): Zone {
  const a = toWorld(f, r.u0, r.v0);
  const b = toWorld(f, r.u1, r.v1);
  return {
    cx: (a.x + b.x) / 2,
    cz: (a.z + b.z) / 2,
    hx: Math.abs(a.x - b.x) / 2 - 0.6,
    hz: Math.abs(a.z - b.z) / 2 - 0.6,
    schoolRect: r,
  };
}

/** Redondea un rumbo al múltiplo de 90° más cercano (la trama es ortogonal). */
function snap(h: number): number {
  return Math.round(h / (Math.PI / 2)) * (Math.PI / 2);
}

/**
 * Cinemática inversa de dos segmentos para el pedaleo.
 *
 * Con la cadera fija en el asiento y el pie sobre el pedal, la ley de los
 * cosenos da el ángulo de muslo y pierna. Es lo que hace que la rodilla suba
 * y baje de verdad en vez de que la pierna entera oscile como un péndulo.
 */
function pedalIK(phase: number): { thighA: number; shinA: number } {
  const L1 = THIGH_LEN;
  const L2 = SHIN_LEN - 0.03;
  const py = BIKE.crankY - Math.cos(phase) * BIKE.crankR;
  const pz = BIKE.crankZ + Math.sin(phase) * BIKE.crankR;
  const dy = py - BIKE.seatY; // negativo: el pedal está abajo
  const dz = pz - BIKE.seatZ;
  let D = Math.hypot(dy, dz);
  D = Math.min(L1 + L2 - 1e-3, Math.max(Math.abs(L1 - L2) + 1e-3, D));
  // Ángulo hacia adelante desde la vertical.
  const beta = Math.atan2(dz, -dy);
  const a = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
  const thighA = beta + a;
  const kz = Math.sin(thighA) * L1;
  const ky = -Math.cos(thighA) * L1;
  const shinA = Math.atan2(dz - kz, -(dy - ky));
  return { thighA, shinA };
}

const _q = new Quaternion();
const _m = new Matrix();
const _body = new Matrix();
const _s = new Vector3();
const _p = new Vector3();
const _v = new Vector3();
const _dir = new Vector3();
const FORWARD = new Vector3(0, 0, 1);
const _bodyArr = new Float32Array(16);
const _limbArr = new Float32Array(16);

/** Escala · rotación (YXZ de Babylon) · traslación, en una matriz reutilizada. */
function compose(
  pitch: number,
  yaw: number,
  roll: number,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): Matrix {
  Quaternion.FromEulerAnglesToRef(pitch, yaw, roll, _q);
  _s.set(sx, sy, sz);
  _p.set(x, y, z);
  Matrix.ComposeToRef(_s, _q, _p, _m);
  return _m;
}

/**
 * Como `compose`, pero rotando alrededor del punto local (0, pivotY, 0) y
 * ubicándolo en (x, y, z). Sirve para inclinar el cuerpo desde la cadera.
 */
function composePivot(
  pitch: number,
  yaw: number,
  roll: number,
  sx: number,
  sy: number,
  sz: number,
  pivotY: number,
  x: number,
  y: number,
  z: number,
): Matrix {
  Quaternion.FromEulerAnglesToRef(pitch, yaw, roll, _q);
  _s.set(sx, sy, sz);
  _p.set(0, 0, 0);
  Matrix.ComposeToRef(_s, _q, _p, _body);
  Vector3.TransformCoordinatesFromFloatsToRef(0, pivotY, 0, _body, _v);
  _body.setTranslationFromFloats(x - _v.x, y - _v.y, z - _v.z);
  return _body;
}
