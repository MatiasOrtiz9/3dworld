import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { CharacterLook, NpcAnim, NpcHandle, PopulationApi, SchoolPhase, SchoolPoint, WorldPoint } from '../../game/contracts';
import type { CityPlan } from '../CityLayout';
import type { CityIndex } from '../CityIndex';
import { STANDARD_SUN_COMP } from '../Materials';
import { LEVEL_Y, ROOMS, inPoly, levelOf, roomLevel, toLocal, toWorld, type Level, type SchoolFrame } from '../SchoolLayout';
import { POSE_N, SIT, evalPose } from './Anim';
import { HUMAN_PARTS, buildHumanParts, type HumanPart } from './HumanGeometry';
import { hexRgb, type RGB } from './Looks';
import { NAV_BOUNDS } from './NavGrid';
import { treadFloor } from './Places';
import { F_CHEST, F_FARM_L, F_FARM_R, F_HEAD, F_PELVIS, F_SHIN_L, F_SHIN_R, F_THIGH_L, F_THIGH_R, F_UARM_L, F_UARM_R, Rig } from './Rig';
import { PeopleSim, type Agent, type SimView } from './Sim';

/**
 * La gente de la escuela: alumnos de jardín, primaria y secundaria,
 * docentes, personal y familias, con su rutina según el momento del día.
 * Implementa `PopulationApi` (ver `game/contracts`).
 *
 * Coste: UN material (color de vértice × color de instancia) y una malla por
 * pieza del cuerpo con thin instances: toda la gente cabe en ≤ 25 draw calls
 * (24 piezas + la sombra de contacto), y una pieza que nadie visible lleva
 * (el lampazo, el gorro de la cantina) no dibuja nada. Por cuadro sólo se
 * escriben las personas que la cámara puede ver —distancia, cono de visión
 * y, adentro del edificio, el piso en el que se está—, compactadas al
 * principio de cada buffer. Lejos se omiten piezas chicas (manos, zapatos,
 * anteojos, mangas): el triángulo más barato es el que no se manda.
 *
 * La lógica (quién va a dónde, caminos, esquive, animación) vive en
 * `PeopleSim`, sin motor; acá se la alimenta con la cámara y el jugador y
 * se dibuja el resultado.
 */

export interface PopulationOptions {
  /** Cantidad de gente (perfil de calidad: ~90 en VR, 180 en Alta). */
  crowdSize: number;
  /** Detalle de escritorio: más lados por pieza y distancias de detalle mayores. */
  detailed: boolean;
}

/** Buffers de una pieza: matrices + colores, compactados cada cuadro. */
interface Channel {
  mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  n: number;
  cap: number;
}

/** Piezas que van de a dos por persona (izquierda y derecha). */
const TWICE: ReadonlySet<HumanPart> = new Set<HumanPart>(['upperArm', 'sleeve', 'forearm', 'hand', 'thigh', 'shin', 'shoe']);

/** Medias de colegiala: azul marino oscuro. */
const TIGHTS = hexRgb('#1d2433');
const PROP_GREY = hexRgb('#9aa3ad');

const FORWARD = new Vector3(0, 0, 1);
const _dir = new Vector3();

/**
 * Mapa grueso (1 m) de ambientes techados por nivel: 0 = afuera (patio,
 * vereda) y k = ambiente k−1. Sirve para no dibujar a quien queda detrás de
 * muros: la escuela tiene decenas de aulas y sin esto, desde la vereda, se
 * dibujaba a casi toda la gente de adentro.
 */
class RoomMap {
  private readonly maps: Array<Uint16Array | null> = [null, null, null];
  private readonly nu = Math.ceil(NAV_BOUNDS.u1 - NAV_BOUNDS.u0);
  private readonly nv = Math.ceil(NAV_BOUNDS.v1 - NAV_BOUNDS.v0);

  at(level: Level, u: number, v: number): number {
    const i = Math.floor(u - NAV_BOUNDS.u0);
    const j = Math.floor(v - NAV_BOUNDS.v0);
    if (i < 0 || j < 0 || i >= this.nu || j >= this.nv) return 0;
    const m = this.maps[level] ?? (this.maps[level] = this.build(level));
    return m[j * this.nu + i];
  }

  private build(level: Level): Uint16Array {
    const m = new Uint16Array(this.nu * this.nv);
    const rooms = ROOMS.map((r, k) => ({ r, k })).filter(({ r }) => roomLevel(r) === level && r.roofed);
    for (let j = 0; j < this.nv; j++) {
      const v = NAV_BOUNDS.v0 + j + 0.5;
      for (let i = 0; i < this.nu; i++) {
        const u = NAV_BOUNDS.u0 + i + 0.5;
        for (const { r, k } of rooms) {
          if (inPoly(r.poly, u, v)) {
            m[j * this.nu + i] = k + 1;
            break;
          }
        }
      }
    }
    return m;
  }
}

export class Population implements PopulationApi {
  /** Simulación (pública para depuración y herramientas). */
  readonly sim: PeopleSim;
  private readonly channels = new Map<HumanPart, Channel>();
  private readonly material: StandardMaterial;
  private readonly shadowMat: StandardMaterial;
  private readonly shadowTex: DynamicTexture;
  private readonly shadow: Channel;
  private readonly rig = new Rig();
  private readonly pose = new Float32Array(POSE_N);
  /** Persona que se está escribiendo (para `footFloor`, sin crear un cierre por persona). */
  private footAgent: Agent | null = null;
  private readonly rooms = new RoomMap();
  /** Distancias de oclusión por muros: otro ambiente, adentro visto de afuera y afuera visto de adentro. */
  private readonly occl: { other: number; inFromOut: number; outFromIn: number };
  private readonly handles = new Map<string, NpcHandle>();
  private readonly observer: Observer<Scene> | null;
  private getFeet: (() => WorldPoint) | null = null;
  private readonly baseDraw: number;
  private readonly baseNear: number;
  private readonly baseMid: number;
  private draw: number;
  private near: number;
  private mid: number;
  private started = false;
  /** Personas que entran en los buffers. */
  private people = 0;
  /** Personas dibujadas en el último cuadro (para el panel de métricas). */
  drawn = 0;

  constructor(
    private readonly scene: Scene,
    plan: CityPlan,
    index: CityIndex,
    private readonly school: SchoolFrame,
    seed: number,
    opts: PopulationOptions,
  ) {
    const f = school;
    // La vereda de Laprida: del borde del predio al cordón (la calzada central
    // sobresale `0.21 · ancho` del eje).
    const curb = 2 + plan.streetWidth / 2 - plan.streetWidth * 0.21;
    this.sim = new PeopleSim(seed, { crowdSize: opts.crowdSize, detailed: opts.detailed }, {
      surface: (u, v) => {
        const w = toWorld(f, u, v);
        return index.surfaceHeight(w.x, w.z);
      },
      blocked: (u, v) => {
        if (v > curb - 0.3) return true;
        const w = toWorld(f, u, v);
        return index.isPedestrianBlocked(w.x, w.z);
      },
    });
    this.occl = opts.detailed ? { other: 22, inFromOut: 26, outFromIn: 34 } : { other: 12, inFromOut: 14, outFromIn: 18 };
    this.baseDraw = opts.detailed ? 95 : 50;
    this.baseNear = opts.detailed ? 16 : 9;
    this.baseMid = opts.detailed ? 40 : 22;
    this.draw = this.baseDraw;
    this.near = this.baseNear;
    this.mid = this.baseMid;

    // Un único material: el color sale del vértice (sombreado, ojos, suela,
    // cuadrillé) multiplicado por el de la instancia (ropa, piel, pelo).
    const mat = new StandardMaterial('npc', scene);
    // Blanco atenuado: ver STANDARD_SUN_COMP. Al sol pleno la ropa da su color
    // y los costados en sombra conservan volumen.
    mat.diffuseColor = new Color3(STANDARD_SUN_COMP, STANDARD_SUN_COMP, STANDARD_SUN_COMP).scale(1.1);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mat.specularPower = 24;
    // Piso de luz propia: adentro, sin IBL (StandardMaterial no lo usa), la
    // ropa oscura quedaba negra. Multiplica al color base: no aplana tonos.
    mat.emissiveColor = new Color3(0.46, 0.46, 0.48);
    this.material = mat;

    const { meshes } = buildHumanParts(scene, opts.detailed ? 1 : 0);
    // Lugar para la multitud y una docena de personajes con nombre.
    const n = (this.people = this.sim.agents.length + 12);
    for (const part of HUMAN_PARTS) this.channels.set(part, this.makeChannel(meshes[part], n * (TWICE.has(part) ? 2 : 1), true));

    // Sombra de contacto: un disco difuso bajo cada persona. En VR no hay
    // sombras proyectadas, y sin este disco la gente parece flotar.
    this.shadowTex = new DynamicTexture('npcShadowTex', { width: 64, height: 64 }, scene, false);
    const ctx = this.shadowTex.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(0,0,0,0.46)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.24)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    this.shadowTex.hasAlpha = true;
    this.shadowTex.update();
    const smat = new StandardMaterial('npcShadow', scene);
    smat.diffuseColor = Color3.Black();
    smat.specularColor = Color3.Black();
    smat.emissiveColor = Color3.Black();
    smat.disableLighting = true;
    smat.opacityTexture = this.shadowTex;
    smat.disableDepthWrite = true;
    smat.zOffset = -2;
    this.shadowMat = smat;
    const disc = CreateGround('npcShadow', { width: 1, height: 1 }, scene);
    disc.material = smat;
    this.shadow = this.makeChannel(disc, n, false);

    this.observer = scene.onBeforeRenderObservable.add(this.update);
  }

  private makeChannel(mesh: Mesh, cap: number, colored: boolean): Channel {
    mesh.isPickable = false;
    if (colored) mesh.material = this.material;
    // El volumen envolvente de instancias que se mueven cada cuadro no se
    // puede mantener barato: siempre activa, y el recorte se hace a mano.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.freezeWorldMatrix();
    const matrices = new Float32Array(cap * 16);
    const colors = new Float32Array(cap * 4);
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    if (colored) mesh.thinInstanceSetBuffer('color', colors, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    return { mesh, matrices, colors, n: 0, cap };
  }

  // ===================================================================== API

  get population(): number {
    return this.sim.population;
  }

  forEachPerson(fn: (u: number, v: number, level: Level) => void): void {
    for (const a of this.sim.agents) if (a.alive) fn(a.u, a.v, a.level);
  }

  /** Momento del día vigente. */
  get phase(): SchoolPhase {
    return this.sim.phase;
  }

  setSchoolPhase(phase: SchoolPhase): void {
    // Antes del primer cuadro (o recién creada) se reparte de una: la
    // primera imagen ya muestra la escuela en ese momento del día.
    this.sim.setPhase(phase, !this.started || this.sim.time < 1);
  }

  setPlayer(getFeet: () => WorldPoint): void {
    this.getFeet = getFeet;
  }

  setAdaptiveLevel(level: number): void {
    const t = Math.max(0, Math.min(3, Math.round(level)));
    this.sim.setActiveFraction([1, 0.8, 0.62, 0.45][t]);
    const k = [1, 0.86, 0.72, 0.6][t];
    this.draw = this.baseDraw * k;
    this.near = this.baseNear * k;
    this.mid = this.baseMid * k;
  }

  spawnCharacter(id: string, look: CharacterLook, at: SchoolPoint, facing?: number): NpcHandle {
    const a = this.sim.spawnNamed(id, look, at, facing);
    const existing = this.handles.get(id);
    if (existing) return existing;
    const h = this.makeHandle(a);
    this.handles.set(id, h);
    return h;
  }

  character(id: string): NpcHandle | null {
    return this.handles.get(id) ?? null;
  }

  private makeHandle(a: Agent): NpcHandle {
    const sim = this.sim;
    const f = this.school;
    return {
      id: a.id,
      position: () => {
        const w = toWorld(f, a.u, a.v);
        return { x: w.x, y: a.y, z: w.z };
      },
      goTo: (p: SchoolPoint, opts?: { run?: boolean }) => sim.goTo(a, p, opts?.run ?? false),
      teleport: (p: SchoolPoint, facing?: number) => sim.teleportNamed(a, p, facing),
      face: (target: { x: number; z: number }) => {
        const l = toLocal(f, target.x, target.z);
        sim.face(a, l.u, l.v);
      },
      play: (anim: NpcAnim, loop?: boolean) => sim.play(a, anim, loop),
      setLookAtPlayer: (on: boolean) => {
        a.lookPlayer = on;
      },
      setVisible: (visible: boolean) => {
        a.hidden = !visible;
      },
    };
  }

  dispose(): void {
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer);
    for (const a of this.sim.agents) {
      a.resolve?.(false);
      a.resolve = null;
    }
    for (const ch of this.channels.values()) ch.mesh.dispose();
    this.channels.clear();
    this.shadow.mesh.dispose();
    this.material.dispose();
    this.shadowMat.dispose();
    this.shadowTex.dispose();
    this.handles.clear();
  }

  // ================================================================== cuadro

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    this.started = true;
    const f = this.school;
    const cam = this.scene.activeCamera;
    let cx = f.ox - 37;
    let cy = 1.7;
    let cz = f.oz + 12;
    let fx = 0;
    let fz = -1;
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
    const camL = toLocal(f, cx, cz);
    let player: SimView['player'] = null;
    if (this.getFeet) {
      const p = this.getFeet();
      const l = toLocal(f, p.x, p.z);
      player = { u: l.u, v: l.v, y: p.y };
    }
    // Local: u = ox − x (el este es −x), v = z − oz.
    this.sim.update(dt, { cu: camL.u, cv: camL.v, cy, fu: -fx, fv: fz, player });
    this.render(cx, cy, cz, fx, fz, camL.u, camL.v);
  };

  /** Recorte, nivel de detalle y escritura de las piezas de cada persona visible. */
  private render(cx: number, cy: number, cz: number, fx: number, fz: number, cu: number, cv: number): void {
    for (const ch of this.channels.values()) ch.n = 0;
    this.shadow.n = 0;
    const f = this.school;
    const far2 = this.draw * this.draw;
    const near2 = this.near * this.near;
    const mid2 = this.mid * this.mid;
    // Desde lo alto (volando) el cono horizontal no sirve.
    const overhead = cy > 14;
    const camFeet = cy - 1.62;
    const camLevel = levelOf(camFeet);
    const camRoom = camFeet < LEVEL_Y[2] + 2.5 ? this.rooms.at(camLevel, cu, cv) : 0;
    const oc = this.occl;
    const other2 = oc.other * oc.other;
    const inOut2 = oc.inFromOut * oc.inFromOut;
    const outIn2 = oc.outFromIn * oc.outFromIn;
    let drawn = 0;
    this.ensureCapacity();
    for (const a of this.sim.agents) {
      a.visible = false;
      if (!a.alive || a.hidden) continue;
      // Local → mundo (ver `toWorld`): el este (+u) es −x.
      const wx = f.ox - a.u;
      const wz = f.oz + a.v;
      const dx = wx - cx;
      const dz = wz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2) continue;
      if (!overhead && d2 > 25) {
        const d = Math.sqrt(d2);
        if ((dx * fx + dz * fz) / d < 0.2) continue;
      }
      // Muros y losas: quien está en otro ambiente techado (u otro piso) se ve
      // sólo de cerca, por una puerta, una ventana o el hueco de una escalera.
      if (!overhead && d2 > 36) {
        const room = this.rooms.at(a.level, a.u, a.v);
        if (a.level !== camLevel) {
          if (camRoom !== 0 || room !== 0 ? d2 > other2 * 0.5 : d2 > outIn2) continue;
        } else if (room !== camRoom) {
          if (camRoom === 0 ? d2 > inOut2 : room === 0 ? d2 > outIn2 : d2 > other2) continue;
        }
      }
      a.visible = true;
      drawn++;
      this.writePerson(a, wx, wz, d2 < near2 ? 0 : d2 < mid2 ? 1 : 2);
    }
    this.drawn = drawn;
    for (const ch of this.channels.values()) this.flush(ch, true);
    this.flush(this.shadow, false);
  }

  /**
   * Piso bajo un pie (mundo), para quien pisa algo que no es plano: la huella
   * de un escalón o el umbral de 12 cm del portón (vereda / planta baja).
   */
  private readonly footFloor = (x: number, z: number): number => {
    const a = this.footAgent!;
    const u = this.school.ox - x;
    const v = z - this.school.oz;
    if (a.onStair) {
      const y = treadFloor(u, v, a.y);
      if (!Number.isNaN(y)) return y;
      // Fuera del tramo: el piso del nivel más cercano (arranque o llegada).
      let best = LEVEL_Y[0];
      for (const ly of LEVEL_Y) if (Math.abs(ly - a.y) < Math.abs(best - a.y)) best = ly;
      return best;
    }
    return this.sim.floorAt(a.level, u, v);
  };

  private writePerson(a: Agent, x: number, z: number, lod: 0 | 1 | 2): void {
    const L = a.look;
    const d = a.body;
    evalPose(a.anim, this.pose);
    const seated = this.pose[SIT] > 0.01;
    // Piso desparejo: escalera, o a un paso del umbral del portón (v = 0).
    const uneven = !seated && (a.onStair || (a.level === 0 && Math.abs(a.v) < 0.7));
    this.footAgent = a;
    this.rig.pose(this.pose, d, x, z, a.yaw, a.y, seated ? a.seatY : a.y, uneven ? this.footFloor : null);
    const depth = d.s * L.build;
    const legColor: RGB = L.skirt ? (L.bareLegs ? L.skin : TIGHTS) : L.bottom;
    // Tronco y cadera.
    this.part('hips', F_PELVIS, d.hipW, d.torsoS, depth, L.skirt ? legColor : L.bottom);
    const torso: HumanPart = L.torsoPart === 'smock' ? 'smock' : L.torsoPart === 'coat' ? 'coat' : 'torso';
    this.part(torso, F_CHEST, d.shoulderW, d.torsoS, depth, L.top);
    if (L.trim && lod < 2) this.part('trim', F_CHEST, d.shoulderW, d.torsoS, depth, L.trim);
    if (L.skirt) this.part('skirt', F_PELVIS, d.hipW, d.legS, depth, L.bottom);
    if (L.apron) this.part('apron', F_PELVIS, d.hipW, d.legS, depth, L.apron);
    // Sentado, la mochila está colgada en la silla (si no, atraviesa el respaldo).
    if (L.backpack && !seated) this.part('backpack', F_CHEST, d.shoulderW, d.torsoS, depth, L.backpack);
    // Cabeza, pelo y anteojos.
    this.part('head', F_HEAD, d.headS, d.headS, d.headS, L.skin);
    const hair = hairPart(L.hairStyle);
    if (hair) this.part(hair, F_HEAD, d.headS, d.headS, d.headS, L.hair);
    if (L.glasses && lod === 0) this.part('glasses', F_HEAD, d.headS, d.headS, d.headS, L.glasses);
    // Brazos: manga corta = brazo de piel con la manga encima.
    const short = L.shortSleeves && L.torsoPart === 'torso';
    for (const [ua, fa] of [
      [F_UARM_L, F_FARM_L],
      [F_UARM_R, F_FARM_R],
    ] as const) {
      this.part('upperArm', ua, d.limbW, d.armS, d.limbW, short ? L.skin : L.top);
      if (short && lod < 2) this.part('sleeve', ua, d.limbW, d.armS, d.limbW, L.top);
      this.part('forearm', fa, d.limbW, d.armS, d.limbW, short ? L.skin : L.top);
      if (lod === 0) this.part('hand', fa, d.limbW, d.armS, d.limbW, L.skin);
    }
    if (L.prop === 'mop') this.part('mop', F_FARM_R, d.armS, d.armS, d.armS, PROP_GREY);
    // Piernas.
    for (const [th, sh] of [
      [F_THIGH_L, F_SHIN_L],
      [F_THIGH_R, F_SHIN_R],
    ] as const) {
      this.part('thigh', th, d.limbW, d.legS, d.limbW, legColor);
      // Lejos no hay zapato: la pierna se estira hasta la suela (termina en el
      // tobillo, 4 cm arriba) para que nadie quede flotando.
      this.part('shin', sh, d.limbW, lod < 2 ? d.legS : d.legS * 1.09, d.limbW, legColor);
      if (lod < 2) this.part('shoe', sh, d.limbW, d.legS, d.limbW, L.shoe);
    }
    // Sombra de contacto, apenas sobre el piso (bajo la silla si está sentado).
    const sh = this.shadow;
    if (sh.n < sh.cap) {
      // En la escalera, chica y sobre la huella que tiene debajo: un disco de
      // 60 cm sobre la rampa quedaba medio metido en un escalón y flotando
      // sobre el otro.
      const stairY = a.onStair ? treadFloor(a.u, a.v, a.y) : NaN;
      const onTread = !Number.isNaN(stairY);
      const r = 0.6 * d.s * L.build * (seated ? 1.15 : onTread ? 0.55 : 1);
      const yaw = a.yaw;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const o = sh.n * 16;
      const m = sh.matrices;
      m[o] = c * r;
      m[o + 1] = 0;
      m[o + 2] = -s * r;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = 1;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s * r * 1.1;
      m[o + 9] = 0;
      m[o + 10] = c * r * 1.1;
      m[o + 11] = 0;
      // Sentado, los pies quedan adelante de la cadera: el disco se corre
      // hacia ellos y cubre silla y pies (centrado en la cadera, los pies
      // quedaban en el borde, sin sombra).
      const fwd = seated ? 0.16 * d.s : 0;
      m[o + 12] = x + s * fwd;
      m[o + 13] = (onTread ? stairY : a.y) + 0.02;
      m[o + 14] = z + c * fwd;
      m[o + 15] = 1;
      sh.n++;
    }
  }

  /**
   * Los personajes con nombre se suman después de crear los buffers: si no
   * entran, se agrandan (al doble, pocas veces en toda la sesión).
   */
  private ensureCapacity(): void {
    const need = this.sim.agents.length;
    if (need <= this.people) return;
    this.people = Math.max(need, this.people * 2);
    const grow = (ch: Channel, per: number, colored: boolean) => {
      ch.cap = this.people * per;
      ch.matrices = new Float32Array(ch.cap * 16);
      ch.colors = new Float32Array(ch.cap * 4);
      ch.mesh.thinInstanceSetBuffer('matrix', ch.matrices, 16, false);
      if (colored) ch.mesh.thinInstanceSetBuffer('color', ch.colors, 4, false);
      ch.n = 0;
    };
    for (const [part, ch] of this.channels) grow(ch, TWICE.has(part) ? 2 : 1, true);
    grow(this.shadow, 1, false);
  }

  private part(name: HumanPart, frame: number, sx: number, sy: number, sz: number, color: RGB): void {
    const ch = this.channels.get(name)!;
    if (ch.n >= ch.cap) return;
    const i = ch.n++;
    this.rig.writePart(frame, sx, sy, sz, ch.matrices, i * 16);
    const c = i * 4;
    ch.colors[c] = color[0];
    ch.colors[c + 1] = color[1];
    ch.colors[c + 2] = color[2];
    ch.colors[c + 3] = 1;
  }

  private flush(ch: Channel, colored: boolean): void {
    const visible = ch.n > 0;
    ch.mesh.isVisible = visible;
    if (!visible) return;
    ch.mesh.thinInstanceCount = ch.n;
    ch.mesh.thinInstanceBufferUpdated('matrix');
    if (colored) ch.mesh.thinInstanceBufferUpdated('color');
  }
}

function hairPart(style: string): HumanPart | null {
  switch (style) {
    case 'short':
      return 'hairShort';
    case 'long':
      return 'hairLong';
    case 'bun':
      return 'hairBun';
    case 'ponytail':
      return 'hairPony';
    case 'curly':
      return 'hairCurly';
    case 'cap':
      return 'cap';
    default:
      return null;
  }
}
