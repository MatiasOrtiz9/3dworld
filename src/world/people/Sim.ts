import type { CharacterLook, NpcAnim, NpcRole, SchoolPhase } from '../../game/contracts';
import { Rng } from '../../utils/rng';
import { LEVEL_Y, U, V, WALLS, inLot, levelOf, planU, planV, roomAt, schoolFloorLocal, schoolSolidLocal, type Level, type Rect } from '../SchoolLayout';
import { GESTURES, SEATED, newAnimState, setBase, startGesture, tickAnim, type AnimId, type AnimState } from './Anim';
import { bodyDims, dressStaff, makeAppearance, type Appearance, type BodyDims, type StaffKind } from './Looks';
import { NAV_BOUNDS, NavGrid, type NavPoint, type PathJob, type PathLeg } from './NavGrid';
import { Places, yawOfLocal, type Board, type Seat, type Spot } from './Places';

/**
 * La gente de la escuela, sin motor: quién es cada uno, qué está haciendo,
 * adónde va y cómo se mueve. `Population` lo dibuja; esto es lo que se
 * prueba en los tests (determinismo, caminos, reparto por momento del día).
 *
 * Coordenadas: locales del plano (u este, v sur) y nivel; el rumbo del
 * cuerpo (`yaw`) es en el mundo (0 = +z, π/2 = +x), como `STATION_SPOTS`.
 *
 * Cada persona tiene una TAREA (sentarse en tal silla, charlar en tal
 * grupo, dar clase en tal pizarrón, irse por el portón…) y una ETAPA:
 * viajando hacia donde la tarea ocurre, sentándose, haciéndola, o
 * levantándose para la siguiente. Al cambiar el momento del día cada uno
 * recibe su tarea nueva con una demora propia (nadie reacciona a la vez) y
 * camina hasta allá por caminos reales; nadie aparece ni desaparece a la
 * vista: quien no está en cuadro puede apurarse, nada más.
 */

const TAU = Math.PI * 2;
/** Corrimiento a la derecha en las escaleras (m): sube y baja gente a la vez. */
const STAIR_RIGHT = 0.2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Lugar `slot` de una ronda de `size` personas alrededor de (cu, cv), con su variación propia. */
function slotAt(id: number, cu: number, cv: number, r: number, size: number, slot: number): { u: number; v: number } {
  const n = Math.max(2, size);
  const a = (slot / n) * TAU + id * 1.7;
  const jitter = Math.sin(id * 3.1 + slot * 7.7) * 0.12;
  const rr = r + jitter * 0.5;
  return { u: cu + Math.cos(a + jitter) * rr, v: cv + Math.sin(a + jitter) * rr };
}

export interface SimOptions {
  crowdSize: number;
  detailed: boolean;
}

/** Lo que la simulación necesita saber del mundo fuera de la escuela (local). */
export interface SimWorld {
  /** Altura de la vereda/calle fuera de la grilla. */
  surface?: (u: number, v: number) => number;
  /** ¿Un peatón choca acá? (casas del barrio, canal): limita la vereda. */
  blocked?: (u: number, v: number) => boolean;
}

/** Cámara y jugador en coordenadas locales. */
export interface SimView {
  cu: number;
  cv: number;
  cy: number;
  /** Dirección horizontal de la mirada (local, normalizada). */
  fu: number;
  fv: number;
  player: { u: number; v: number; y: number } | null;
}

export type Stage = 'travel' | 'act' | 'sitdown' | 'standup' | 'gone';

export interface Group {
  id: number;
  u: number;
  v: number;
  level: Level;
  r: number;
  members: Agent[];
  speaker: Agent | null;
  next: number;
}

export type Task =
  | { k: 'idle' }
  | { k: 'stand'; at: Spot; anim: AnimId; wave?: boolean }
  | { k: 'post'; at: Spot; anim: AnimId }
  | { k: 'seat'; seat: Seat; anim: AnimId }
  | { k: 'floor'; at: Spot }
  | { k: 'group'; g: Group; slot: number }
  | { k: 'wander'; room: string | null; rect: Rect | null; level: Level }
  | { k: 'play'; rect: Rect; level: Level }
  | { k: 'queue' }
  | { k: 'teach'; board: Board }
  | { k: 'mop' }
  | { k: 'errand'; to: NavPoint }
  | { k: 'leave'; exit: NavPoint }
  | { k: 'stroll' }
  | { k: 'script' };

/** Una persona. Campos públicos: los lee el render y la API de personajes. */
export class Agent {
  u = 0;
  v = 0;
  level: Level = 0;
  /** Altura de los pies (piso bajo ellos) y de la tapa del asiento. */
  y = 0;
  seatY = 0;
  yaw = 0;
  wantYaw = 0;
  vu = 0;
  vv = 0;
  speed = 0;
  readonly radius: number;
  readonly anim: AnimState;
  task: Task = { k: 'idle' };
  stage: Stage = 'act';
  next: Task | null = null;
  delay = 0;
  after: Task | null = null;
  timer = 0;
  sub = 0;
  // Viaje: tramo previo sin grilla (salir de entre los pupitres, la vereda),
  // camino por la grilla y tramo final (hasta la silla, subir la grada).
  pre: number[] | null = null;
  preI = 0;
  path: PathLeg[] | null = null;
  leg = 0;
  wp = 0;
  post: number[] | null = null;
  postI = 0;
  pending = false;
  job: PathJob | null = null;
  goal: NavPoint | null = null;
  /** Atascado en un amontonamiento: unos segundos esquivando apenas, para destrabar. */
  ghost = 0;
  /** Sin camino posible desde donde quedó: se reubica cuando nadie lo vea. */
  rescue = false;
  /**
   * Esperando afuera a que abran la escuela: apertura del portón en la que se
   * quedó (`PeopleSim.gateEpoch`), −1 si no espera eso.
   */
  waitEpoch = -1;
  /** Fallos de camino seguidos (no se borra al empezar otra tarea, sí al llegar). */
  streak = 0;
  run = false;
  stuckT = 0;
  lastU = 0;
  lastV = 0;
  probeT = 0;
  fails = 0;
  /** Asiento ocupado (o reservado) y avance del sentarse (0..1). */
  seat: Seat | null = null;
  sitT = 0;
  sitFrom: [number, number, number] = [0, 0, 0];
  /** Lugar donde está "anclado" haciendo la tarea, y el corrimiento para abrir paso. */
  au = 0;
  av = 0;
  shoveU = 0;
  shoveV = 0;
  gone = false;
  dormant = false;
  hidden = false;
  /** Lo pone el render: se dibujó en el último cuadro. */
  visible = false;
  unseen = 99;
  acc = 0;
  lookPlayer = true;
  greetT = 0;
  playerNear = false;
  /** Animación pedida por el director (personajes con nombre). */
  scriptAnim: AnimId = 'idle';
  scriptOnce = 0;
  resolve: ((ok: boolean) => void) | null = null;
  /** Calle de la vereda (paseantes y los que se van): v del carril y sentido. */
  laneV = planV(4);
  laneDir = 1;
  walkOff = false;
  /** Lugar de la fila al que fue (para avanzar cuando la fila se mueve). */
  slot = -1;
  /** Subiendo o bajando un tramo: el render apoya cada pie en su huella. */
  onStair = false;
  /** Animación de la tarea a retomar después de unos pasos en el lugar. */
  resume: AnimId | null = null;

  constructor(
    readonly idx: number,
    readonly id: string,
    readonly role: NpcRole,
    readonly look: Appearance,
    readonly body: BodyDims,
    readonly staff: StaffKind | null,
    readonly named: boolean,
    readonly priority: number,
    seed: number,
  ) {
    this.radius = 0.16 + 0.1 * body.s * look.build;
    this.anim = newAnimState(seed, look.idleStyle, look.age === 'kid' || look.age === 'child');
    this.anim.waist = body.waist;
    this.anim.shY = body.shoulderY;
    this.anim.l1 = body.upperArm;
    this.anim.l2 = body.forearm;
    this.anim.thigh = body.thigh;
    this.anim.thighR = body.seatOffset;
  }

  get alive(): boolean {
    return !this.gone && !this.dormant;
  }

  get walkSpeed(): number {
    return this.look.walkSpeed;
  }
}

/** Reparto de la multitud por rol, para `crowdSize` personas. */
export function composition(n: number): Record<NpcRole, number> & { pedestrians: number } {
  const staff = n >= 30 ? 4 : 1;
  const teacher = Math.max(3, Math.round(n * 0.09));
  const visitor = Math.round(n * 0.07);
  const pedestrians = Math.round(n * 0.05);
  const kid = Math.round(n * 0.12);
  const studentSecondary = Math.round(n * 0.24);
  const student = Math.max(0, n - staff - teacher - visitor - pedestrians - kid - studentSecondary);
  return { staff, teacher, visitor, pedestrians, kid, studentSecondary, student };
}

/** Aulas por nivel, en orden de preferencia (las de planta baja primero: se ven). */
const PRIMARY_ROOMS = ['aula5', 'aula4', 'aula1', 'aula6AC', 'aula2', 'aula6BD', 'aula3'];
const SECONDARY_ROOMS = ['tecnologia', 'aulaS2', 'aulaS3', 'aulaS4', 'aulaBloqueC', 'aulaBloqueD', 'aulaSec', 'aulaS1', 'aulaC1', 'bilingue', 'aulaS5', 'aulaBloqueA', 'aula4A', 'aula6C'];
const KINDER_ROOMS = ['salaAmarilla', 'salaRoja', 'salaCeleste'];
/** Cupo por aula: un aula llena al 100 % se ve artificial. */
const ROOM_CAP = 18;

/**
 * Eje de la entrada sobre Laprida (u 37 del plano): parte la vereda en dos
 * mitades para los que llegan y se van.
 */
const MID_U = planU(37);
/** Cuánto se agrandó el frente en u: las distancias "a lo largo de la cuadra" crecen con él. */
const SCALE_U = planU(10) / 10;
/** Rectángulo leído en el plano, en metros reales. */
function planRect(u0: number, v0: number, u1: number, v1: number): Rect {
  return { u0: planU(u0), v0: planV(v0), u1: planU(u1), v1: planV(v1) };
}
/** Rincón del patio este, al pie de la escalera exterior, donde charlan los de secundaria. */
const PATIO_EXT_GROUPS: Rect = planRect(33.5, -26.5, 41.5, -20.5);

/** Zonas de juego (local, planta baja). La de los chicos es el piso libre al norte del patio aire libre, donde estaban los juegos que se removieron. */
const PLAY_KIDS: Rect = planRect(34.2, -31.5, 49.2, -23.9);
// Dentro del patio central del CAD (u 14,83–27,36, v −8,53 a −20,96): con el
// rectángulo viejo se jugaba en la punta del comedor y en el pasillo norte.
const PLAY_PRIMARY: Rect = planRect(16.2, -20.4, 26.9, -10.2);
const PLAY_SECONDARY: Rect = planRect(53.0, -18.8, 65.5, -4.2);
/**
 * Baños para los mandados durante la clase, por nivel. En el primer piso sólo
 * Damas y Caballeros, que abren al pasillo de los trofeos: los del sector
 * nuevo (`banosN`) abren al aula del vértice (CAD) y el mandado cruzaba dos
 * aulas en plena clase.
 */
const BATHROOMS: Record<number, string[]> = { 0: ['salaNorte'], 1: ['banosS'], 2: [] };

/** Centro de cada acceso vidriado de planta baja (del plano: hoy, el del hall). */
function entranceCenters(): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (const w of WALLS) {
    if (w.level !== 0) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (len < 1e-6) continue;
    for (const o of w.openings) {
      if (o.type !== 'entrance') continue;
      const t = (o.t0 + o.t1) / 2 / len;
      out.push([w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t]);
    }
  }
  return out;
}

/**
 * Del lado de afuera del acceso vidriado: la vereda, la franja del frente y
 * el atrio del portón (que para el plano es parte del hall), o fuera del predio.
 */
function outsideGate(level: Level, u: number, v: number): boolean {
  if (level !== 0) return false;
  if (v > V.facade || !inLot(u, v)) return true;
  return v > V.hallDoors + 0.2 && u > U.east1 && u < U.salonW;
}

export class PeopleSim {
  readonly agents: Agent[] = [];
  readonly nav: NavGrid;
  readonly places: Places;
  readonly rng: Rng;
  /** Azar de tiempo de ejecución (sembrado igual: los tests son reproducibles). */
  private readonly rt: Rng;
  private readonly named = new Map<string, Agent>();
  private readonly seatOwner = new Map<number, Agent>();
  private readonly homeSeat = new Map<Agent, Seat>();
  private readonly homeSeatIds = new Set<number>();
  private readonly homeRoom = new Map<Agent, string>();
  private readonly teacherBoard = new Map<Agent, Board>();
  /** Maestras del jardín (sin pizarrón): su lugar entre las mesitas (null = todavía no buscado). */
  private readonly teacherSpot = new Map<Agent, Spot | null>();
  private groups: Group[] = [];
  private queue: Agent[] = [];
  private groupId = 0;
  phase: SchoolPhase = 'entrada';
  time = 0;
  private phaseTime = 0;
  private clapT = 20;
  private errandT = 10;
  /** Velocidad estimada del jugador (local). */
  private pvu = 0;
  private pvv = 0;
  private plast: { u: number; v: number } | null = null;
  view: SimView = { cu: MID_U, cv: planV(12), cy: 1.7, fu: 0, fv: -1, player: null };
  /** Personas activas que quiere el nivel adaptativo. */
  private targetActive = Infinity;
  private adaptiveT = 0;
  /** Límites de la vereda de Laprida (u) según el barrio. */
  laneMin = planU(-6.5);
  laneMax = planU(69.2);
  /** Presupuesto de A* por cuadro (expansiones), para no trabar el cuadro. */
  pathBudget: number;
  private readonly hash = new Map<number, Agent[]>();
  /** Centro de cada acceso vidriado de planta baja (el del hall). */
  private readonly entrances = entranceCenters();
  /** ¿Una llave de la historia cierra el portón? Se mira una vez por cuadro. */
  private shutNow = false;
  /** Veces que el portón pasó de cerrado a abierto: quien esperaba afuera vuelve a probar una vez por apertura. */
  private gateEpoch = 0;

  constructor(
    seed: number,
    private readonly opts: SimOptions,
    private readonly world: SimWorld = {},
  ) {
    this.rng = new Rng((seed ^ 0x7e0b1e) >>> 0);
    this.rt = new Rng((seed ^ 0x51d3c0) >>> 0);
    this.nav = new NavGrid(world.surface);
    this.places = new Places(this.nav);
    this.pathBudget = opts.detailed ? 30000 : 18000;
    this.measureLane();
    this.spawnCrowd(Math.max(1, Math.round(opts.crowdSize)));
    this.setPhase('entrada', true);
  }

  // ================================================================ población

  private makeAgent(id: string, look: CharacterLook, staff: StaffKind | null, named: boolean): Agent {
    const rng = this.rng;
    let app: Appearance = makeAppearance(rng, look);
    if (staff) app = dressStaff(app, staff, rng);
    const a = new Agent(this.agents.length, id, look.role, app, bodyDims(app), staff, named, named ? 2 : rng.next(), rng.next());
    a.lookPlayer = true;
    this.agents.push(a);
    return a;
  }

  private spawnCrowd(n: number): void {
    const c = composition(n);
    const staffKinds: StaffKind[] = c.staff >= 4 ? ['porter', 'cantina', 'cantina', 'maintenance'] : ['porter'];
    for (const k of staffKinds) this.makeAgent(`staff-${k}-${this.agents.length}`, { role: 'staff' }, k, false);
    for (let i = 0; i < c.teacher; i++) this.makeAgent(`teacher-${i}`, { role: 'teacher' }, null, false);
    for (let i = 0; i < c.kid; i++) this.makeAgent(`kid-${i}`, { role: 'kid' }, null, false);
    for (let i = 0; i < c.student; i++) this.makeAgent(`student-${i}`, { role: 'student' }, null, false);
    for (let i = 0; i < c.studentSecondary; i++) this.makeAgent(`secondary-${i}`, { role: 'studentSecondary' }, null, false);
    for (let i = 0; i < c.visitor; i++) this.makeAgent(`visitor-${i}`, { role: 'visitor' }, null, false);
    for (let i = 0; i < c.pedestrians; i++) {
      const a = this.makeAgent(`pedestrian-${i}`, { role: 'visitor' }, null, false);
      a.task = { k: 'stroll' };
    }
    this.assignHomes();
  }

  /** Cada alumno tiene su aula y su silla; cada aula con alumnos, su docente. */
  private assignHomes(): void {
    const fill = (role: NpcRole, rooms: string[], small: boolean | null) => {
      const list = this.agents.filter((a) => a.role === role && !a.named);
      let i = 0;
      for (const room of rooms) {
        const cls = this.places.classrooms.get(room);
        if (!cls) continue;
        // Asientos utilizables, en orden aleatorio pero reproducible.
        const seats = this.rng.shuffle(cls.seats.filter((s) => (small === null || s.small === small || !small) && s.kind !== 'bleacher'));
        let taken = 0;
        for (const s of seats) {
          if (i >= list.length || taken >= ROOM_CAP) break;
          if (this.places.lastMile(s).length === 0) continue;
          this.homeSeat.set(list[i], s);
          this.homeSeatIds.add(s.id);
          this.homeRoom.set(list[i], room);
          this.seatOwner.set(s.id, list[i]);
          i++;
          taken++;
        }
        if (i >= list.length) break;
      }
    };
    fill('kid', KINDER_ROOMS, true);
    fill('student', PRIMARY_ROOMS, null);
    fill('studentSecondary', SECONDARY_ROOMS, null);
    // Docentes: uno por aula ocupada, en el orden de las aulas.
    const used = new Map<string, number>();
    for (const r of this.homeRoom.values()) used.set(r, (used.get(r) ?? 0) + 1);
    const teachers = this.agents.filter((a) => a.role === 'teacher' && !a.named);
    let t = 0;
    for (const room of [...KINDER_ROOMS, ...PRIMARY_ROOMS, ...SECONDARY_ROOMS]) {
      if ((used.get(room) ?? 0) < 3 || t >= teachers.length) continue;
      const board = this.places.classrooms.get(room)?.board;
      if (board) this.teacherBoard.set(teachers[t], board);
      // Las salas del jardín no tienen pizarrón: antes se quedaban sin
      // ninguna maestra (15 chicos de 4 años solos en la Sala Amarilla). La
      // maestra se para entre las mesitas (el lugar se busca al primer uso).
      else if (KINDER_ROOMS.includes(room)) this.teacherSpot.set(teachers[t], null);
      else continue;
      this.homeRoom.set(teachers[t], room);
      t++;
    }
  }

  /**
   * Dónde se para la maestra de una sala del jardín: cerca del centro de las
   * sillitas de los chicos, en un lugar transitable, dentro de la sala y sin
   * pisar ninguna silla; de cara a las mesas.
   */
  private kinderSpot(room: string): Spot | null {
    const cls = this.places.classrooms.get(room);
    if (!cls) return null;
    let cu = 0;
    let cv = 0;
    let n = 0;
    for (const s of this.homeSeat.values()) {
      if (s.room !== room) continue;
      cu += s.u;
      cv += s.v;
      n++;
    }
    if (n === 0) return null;
    cu /= n;
    cv /= n;
    const level = cls.level;
    for (const r of [0.9, 1.3, 1.7, 2.2]) {
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * TAU;
        const u = cu + Math.cos(ang) * r;
        const v = cv + Math.sin(ang) * r;
        if (!this.nav.isMain(level, u, v) || !this.nav.clear(level, u, v, 0.3)) continue;
        if (roomAt(u, v, level)?.id !== room) continue;
        if (cls.seats.some((s) => Math.hypot(s.u - u, s.v - v) < 0.65)) continue;
        return { u, v, level, yaw: yawOfLocal(cu - u, cv - v) };
      }
    }
    return null;
  }

  /** Hasta dónde llega la vereda de Laprida sin chocar con el barrio. */
  private measureLane(): void {
    const blocked = this.world.blocked;
    if (!blocked) return;
    const step = (dir: number, limit: number) => {
      let u = MID_U;
      for (let k = 0; k < 400; k++) {
        const nu = u + dir * 0.5;
        if (Math.abs(nu - MID_U) > limit || blocked(nu, planV(3.8)) || blocked(nu, planV(4.8))) break;
        u = nu;
      }
      return u;
    };
    this.laneMin = Math.min(planU(-6.5), step(-1, 70 * SCALE_U));
    this.laneMax = Math.max(planU(69.2), step(1, 70 * SCALE_U));
  }

  get population(): number {
    let n = 0;
    for (const a of this.agents) if (a.alive) n++;
    return n;
  }

  // ============================================================ momentos del día

  /**
   * Cambia el momento del día. Con `instant` (el arranque) cada uno aparece
   * ya donde le toca, salvo los que vienen llegando; si no, todos caminan.
   */
  setPhase(phase: SchoolPhase, instant = false): void {
    this.phase = phase;
    this.phaseTime = 0;
    // Grupos y fila se rehacen: los viejos se disuelven a medida que sus
    // miembros se van.
    this.groups = [];
    this.queue = [];
    // Reservas de asiento de tareas que nunca empezaron (el momento cambió
    // antes de que les tocara): se liberan, si no los asientos se agotan.
    for (const [id, owner] of this.seatOwner) {
      if (this.homeSeatIds.has(id)) continue;
      const t = owner.task;
      if (!(t.k === 'seat' && t.seat.id === id) && owner.seat?.id !== id) this.seatOwner.delete(id);
    }
    const plan = this.planPhase(phase);
    for (const a of this.agents) {
      if (a.named) continue;
      const task = plan.get(a);
      if (!task) continue;
      if (instant) this.place(a, task);
      else this.schedule(a, task, this.reactionDelay(a, task));
    }
    this.clapT = 14 + this.rt.next() * 8;
  }

  private reactionDelay(a: Agent, task: Task): number {
    const r = this.rt.next();
    if (task.k === 'leave') return 1 + r * (a.role === 'teacher' ? 50 : 32);
    if (a.role === 'teacher' || a.role === 'staff') return 0.5 + r * 4;
    return 0.3 + r * 7;
  }

  /** Reparto de tareas para un momento del día (determinista dado el estado). */
  private planPhase(phase: SchoolPhase): Map<Agent, Task> {
    const plan = new Map<Agent, Task>();
    const rng = this.rng;
    const by = (role: NpcRole) => rng.shuffle(this.agents.filter((a) => a.role === role && !a.named && !a.staff && a.task.k !== 'stroll'));
    // Proporciones exactas: las primeras k personas (barajadas) a la primera opción, etc.
    const split = <T>(list: T[], weights: number[]): T[][] => {
      const total = weights.reduce((x, y) => x + y, 0);
      const out: T[][] = [];
      let i = 0;
      let acc = 0;
      for (let w = 0; w < weights.length; w++) {
        acc += weights[w];
        const end = w === weights.length - 1 ? list.length : Math.round((acc / total) * list.length);
        out.push(list.slice(i, end));
        i = end;
      }
      return out;
    };
    const home = (a: Agent, anim: AnimId = 'sitDesk'): Task | null => {
      const s = this.homeSeat.get(a);
      return s ? { k: 'seat', seat: s, anim } : null;
    };
    const groupsIn = (list: Agent[], where: string | Rect, level: Level = 0, sizes: [number, number] = [2, 5]) => {
      let i = 0;
      while (i < list.length) {
        const size = Math.min(list.length - i, rng.int(sizes[0], sizes[1]));
        const members = list.slice(i, i + size);
        i += size;
        const g = this.makeGroup(where, level, members.length);
        members.forEach((m, k) => plan.set(m, g ? { k: 'group', g, slot: k } : this.wanderTask(where, level)));
        if (g) g.members = members;
      }
    };
    const kids = by('kid');
    const prim = by('student');
    const sec = by('studentSecondary');
    const teachers = rng.shuffle(this.agents.filter((a) => a.role === 'teacher' && !a.named));
    const visitors = by('visitor');
    const staff = this.agents.filter((a) => a.staff && !a.named);

    for (const s of staff) plan.set(s, this.staffTask(s, phase));
    for (const p of this.agents) if (p.task.k === 'stroll' && !p.named) plan.set(p, { k: 'stroll' });

    switch (phase) {
      case 'entrada': {
        const [kp, ks] = split(kids, [0.55, 0.45]);
        for (const a of kp) plan.set(a, { k: 'play', rect: PLAY_KIDS, level: 0 });
        for (const a of ks) plan.set(a, home(a, 'sitDesk') ?? { k: 'play', rect: PLAY_KIDS, level: 0 });
        const [pg, ph, ps, pw] = split(prim, [0.4, 0.2, 0.25, 0.15]);
        groupsIn(pg, 'patioOeste');
        groupsIn(ph, 'hall', 0, [2, 4]);
        for (const a of ps) plan.set(a, home(a, 'sitTalk') ?? this.wanderTask('patioOeste', 0));
        for (const a of pw) plan.set(a, this.wanderTask('patioOeste', 0));
        const [sh, se, ss, sw] = split(sec, [0.35, 0.25, 0.25, 0.15]);
        groupsIn(sh, 'hall', 0, [2, 4]);
        groupsIn(se, PATIO_EXT_GROUPS, 0, [3, 5]);
        for (const a of ss) plan.set(a, home(a, 'sitTalk') ?? this.wanderTask('hall', 0));
        for (const a of sw) plan.set(a, this.wanderTask('hall', 0));
        teachers.forEach((t, i) => {
          if (i < 2) plan.set(t, { k: 'stand', at: this.places.portal[i], anim: 'idle', wave: true });
          else plan.set(t, this.teacherWork(t));
        });
        const [vg, vh] = split(visitors, [0.65, 0.35]);
        groupsIn(vg, this.places.sidewalkFront, 0, [2, 4]);
        groupsIn(vh, 'hall', 0, [2, 3]);
        break;
      }
      case 'clase': {
        for (const a of [...kids, ...prim, ...sec]) {
          plan.set(a, home(a, a.role === 'kid' ? 'sitDesk' : rng.chance(0.6) ? 'sitDesk' : 'sit') ?? this.wanderTask(a.role === 'kid' ? 'salaAmarilla' : 'pasilloSur', 0));
        }
        for (const t of teachers) plan.set(t, this.teacherWork(t));
        const [vs, vl] = split(visitors, [0.4, 0.6]);
        for (const a of vs) plan.set(a, this.seatTask(a, ['hall'], 'sit') ?? this.leaveTask(a));
        for (const a of vl) plan.set(a, this.leaveTask(a));
        break;
      }
      case 'recreo': {
        const [kp, kg] = split(kids, [0.75, 0.25]);
        for (const a of kp) plan.set(a, { k: 'play', rect: PLAY_KIDS, level: 0 });
        groupsIn(kg, PLAY_KIDS, 0, [2, 4]);
        const [pg, pp, pse, pq, pw, pc] = split(prim, [0.33, 0.2, 0.15, 0.12, 0.1, 0.1]);
        groupsIn(pg, 'patioOeste');
        for (const a of pp) plan.set(a, { k: 'play', rect: PLAY_PRIMARY, level: 0 });
        for (const a of pse) plan.set(a, this.seatTask(a, ['patioOeste'], 'sitTalk') ?? this.wanderTask('patioOeste', 0));
        for (const a of pq) plan.set(a, this.places.queue.length > 0 ? { k: 'queue' } : this.wanderTask('patioOeste', 0));
        for (const a of pw) plan.set(a, this.wanderTask('patioOeste', 0));
        groupsIn(pc, 'pasilloSur', 0, [2, 3]);
        const [sg, sh, sp, sc, sgy] = split(sec, [0.3, 0.2, 0.2, 0.15, 0.15]);
        groupsIn(sg, PATIO_EXT_GROUPS, 0, [3, 5]);
        groupsIn(sh, 'hall', 0, [2, 4]);
        for (const a of sp) plan.set(a, { k: 'play', rect: PLAY_SECONDARY, level: 0 });
        for (const a of sc) plan.set(a, this.seatTask(a, ['buffet'], 'sitTalk') ?? this.wanderTask('buffet', 0));
        groupsIn(sgy, 'gimnasio', 0, [3, 5]);
        const [ts, tp, tw] = split(teachers, [0.35, 0.45, 0.2]);
        ts.forEach((t, i) => {
          const room = i % 2 === 0 ? 'patioOeste' : 'patioEste';
          const p = this.places.randomIn(room, () => this.rng.next(), 0.5);
          plan.set(t, p ? { k: 'stand', at: { ...p, yaw: this.rng.range(-Math.PI, Math.PI) }, anim: 'lookAround' } : this.wanderTask(room, 0));
        });
        for (const t of tp) plan.set(t, this.seatTask(t, ['prof'], 'sitTalk') ?? this.wanderTask('hall', 0));
        for (const t of tw) plan.set(t, this.wanderTask('pasilloSur', 0));
        const [vs, vl] = split(visitors, [0.4, 0.6]);
        for (const a of vs) plan.set(a, this.seatTask(a, ['hall'], 'sit') ?? this.leaveTask(a));
        for (const a of vl) plan.set(a, this.leaveTask(a));
        break;
      }
      case 'acto': {
        // Filas de cara al oeste: el jardín adelante (sentado en el piso),
        // después primaria y atrás secundaria. Las familias en las gradas.
        const rows = this.places.actoRows;
        const fillRows = (list: Agent[], from: number, to: number, anim: AnimId) => {
          let i = 0;
          for (let r = from; r <= to && i < list.length; r++) {
            const row = [...rows[r]].sort((p, q) => Math.abs(p.v + 10.9) - Math.abs(q.v + 10.9));
            for (const spot of row) {
              if (i >= list.length) break;
              plan.set(list[i++], anim === 'sitFloor' ? { k: 'floor', at: spot } : { k: 'stand', at: spot, anim });
            }
          }
          for (; i < list.length; i++) plan.set(list[i], this.wanderTask('gimnasio', 0));
        };
        fillRows(kids, 0, 1, 'sitFloor');
        fillRows(prim, 2, 5, 'listen');
        fillRows(sec, 6, 9, 'listen');
        teachers.forEach((t, i) => {
          if (i === 0) plan.set(t, { k: 'stand', at: this.places.speaker, anim: 'talk' });
          else {
            const side = i % 2 === 0;
            const u = planU(55.5) + Math.floor((i - 1) / 2) * 1.6;
            const v = side ? planV(-19.0) : planV(-3.4);
            const p = this.nav.nearestWalkable(0, u, v, 1) ?? { u, v };
            plan.set(t, { k: 'stand', at: { u: p.u, v: p.v, level: 0, yaw: side ? 0.35 : Math.PI - 0.35 }, anim: 'idle' });
          }
        });
        for (const a of visitors) plan.set(a, this.seatTask(a, ['gimnasio'], 'sit', 'bleacher') ?? this.wanderTask('gimnasio', 0));
        break;
      }
      case 'salida': {
        for (const a of [...kids, ...prim, ...sec]) plan.set(a, this.leaveTask(a));
        teachers.forEach((t, i) => plan.set(t, i < 2 ? { k: 'stand', at: this.places.portal[i], anim: 'idle', wave: true } : this.leaveTask(t)));
        const [vg, vl] = split(visitors, [0.6, 0.4]);
        groupsIn(vg, this.places.sidewalkFront, 0, [2, 4]);
        for (const a of vl) plan.set(a, this.leaveTask(a));
        break;
      }
    }
    return plan;
  }

  private staffTask(a: Agent, phase: SchoolPhase): Task {
    const p = this.places;
    if (a.staff === 'porter') return { k: 'post', at: p.porter, anim: phase === 'entrada' || phase === 'salida' ? 'lookAround' : 'idle' };
    if (a.staff === 'cantina' && p.cantina.length > 0) {
      const i = this.agents.filter((x) => x.staff === 'cantina').indexOf(a);
      return { k: 'post', at: p.cantina[i % p.cantina.length], anim: 'serve' };
    }
    if (a.staff === 'cantina') return this.wanderTask('buffet', 0);
    return { k: 'mop' };
  }

  /**
   * Docente: a su pizarrón si tiene aula; si no, a la sala de profesores.
   * Si un personaje con nombre ya está parado en ese pizarrón (Laura en el
   * aula 4), la clase es suya: dos docentes en el mismo lugar se dibujaban
   * uno dentro del otro.
   */
  private teacherWork(t: Agent): Task {
    const b = this.teacherBoard.get(t);
    if (b && this.places.boardSpot(b) && !this.namedNear(b.level, b.u, b.v, 1.4)) return { k: 'teach', board: b };
    if (this.teacherSpot.has(t)) {
      let sp = this.teacherSpot.get(t) ?? null;
      if (!sp) {
        const room = this.homeRoom.get(t);
        sp = room ? this.kinderSpot(room) : null;
        if (sp) this.teacherSpot.set(t, sp);
      }
      if (sp && !this.namedNear(sp.level, sp.u, sp.v, 1.4)) return { k: 'stand', at: sp, anim: 'talk' };
    }
    return this.seatTask(t, ['prof'], 'sitTalk') ?? this.wanderTask('hall', 0);
  }

  /** Personaje con nombre parado (o por llegar) a menos de `r` m de un punto. */
  private namedNear(level: Level, u: number, v: number, r: number): Agent | null {
    for (const n of this.named.values()) {
      if (!n.alive || n.hidden) continue;
      const g = n.stage === 'travel' ? n.goal : null;
      if (n.level === level && Math.hypot(n.u - u, n.v - v) < r) return n;
      if (g && g.level === level && Math.hypot(g.u - u, g.v - v) < r) return n;
    }
    return null;
  }

  /**
   * Un personaje con nombre se instaló en un lugar: quien de la multitud
   * tenía ahí su puesto se corre. El docente de ese pizarrón se va a la sala
   * de profesores y el resto corre su punto de anclaje lo justo para no
   * quedar uno dentro del otro.
   */
  private makeRoomFor(n: Agent): void {
    if (!n.alive || n.hidden) return;
    for (const o of this.agents) {
      if (o.named || !o.alive || o.level !== n.level || o.seat) continue;
      const t = o.task;
      if (t.k === 'teach') {
        if (Math.hypot(t.board.u - n.u, t.board.v - n.v) < 1.4) this.begin(o, this.teacherWork(o));
        continue;
      }
      if (o.stage !== 'act' || t.k === 'stroll' || t.k === 'floor') continue;
      const du = o.au - n.u;
      const dv = o.av - n.v;
      const d = Math.hypot(du, dv);
      const need = o.radius + n.radius + 0.12;
      if (d >= need) continue;
      const ku = d > 1e-3 ? du / d : Math.cos(o.idx);
      const kv = d > 1e-3 ? dv / d : Math.sin(o.idx);
      const nu = n.u + ku * need;
      const nv = n.v + kv * need;
      if (this.nav.isWalkable(o.level, nu, nv)) {
        o.au = nu;
        o.av = nv;
      } else if (t.k === 'wander' || t.k === 'play') {
        this.begin(o, t);
      }
    }
  }

  private wanderTask(where: string | Rect, level: Level): Task {
    return typeof where === 'string' ? { k: 'wander', room: where, rect: null, level } : { k: 'wander', room: null, rect: where, level };
  }

  private leaveTask(a: Agent): Task {
    // Cada uno sale hacia la punta de la vereda de "su casa", sin que todos
    // apunten al mismo metro cuadrado.
    const end = this.places.sidewalkEnds[a.priority < 0.5 ? 0 : 1];
    const inward = end.u < MID_U ? 1 : -1;
    const exit = { u: end.u + inward * this.rng.next() * 3, v: planV(2.9) + this.rng.next() * 2.8, level: 0 as Level };
    return { k: 'leave', exit };
  }

  /** Reserva un asiento libre en esos ambientes (y de ese tipo), o null. */
  private seatTask(a: Agent, rooms: string[], anim: AnimId, kind?: Seat['kind']): Task | null {
    const free = this.places.seats.filter(
      (s) => rooms.includes(s.room) && (!kind || s.kind === kind) && !this.seatOwner.has(s.id) && !this.homeSeatIds.has(s.id),
    );
    if (free.length === 0) return null;
    for (let tries = 0; tries < 6; tries++) {
      const s = this.rng.pick(free);
      if (this.places.lastMile(s).length === 0) continue;
      this.seatOwner.set(s.id, a);
      return { k: 'seat', seat: s, anim };
    }
    return null;
  }

  /** Grupo de charla: centro libre con aire alrededor, lejos de otros grupos. */
  private makeGroup(where: string | Rect, level: Level, size: number): Group | null {
    const r = size <= 2 ? 0.48 : size === 3 ? 0.6 : 0.72;
    const rnd = () => this.rng.next();
    for (let k = 0; k < 14; k++) {
      const p = typeof where === 'string' ? this.places.randomIn(where, rnd, r + 0.45) : this.places.randomInRect(where, rnd, level, r + 0.45);
      if (!p) continue;
      if (this.groups.some((g) => g.level === p.level && Math.hypot(g.u - p.u, g.v - p.v) < g.r + r + 1.6)) continue;
      // Cada lugar de la ronda, no sólo el centro, tiene que poder pisarse con
      // aire alrededor: si no, alguien quedaba parado en el marco de una
      // puerta (hall ↔ pasaje) o pegado a un muro.
      const id = this.groupId;
      let ok = true;
      for (let s = 0; s < size && ok; s++) {
        const q = slotAt(id, p.u, p.v, r, size, s);
        ok = this.nav.isWalkable(p.level, q.u, q.v) && this.nav.clear(p.level, q.u, q.v, 0.25);
      }
      if (!ok) continue;
      const g: Group = { id: this.groupId++, u: p.u, v: p.v, level: p.level, r, members: [], speaker: null, next: 0 };
      this.groups.push(g);
      return g;
    }
    return null;
  }

  /** Posición del lugar de un integrante del grupo. */
  private slotOf(g: Group, slot: number): { u: number; v: number; yaw: number } {
    const { u, v } = slotAt(g.id, g.u, g.v, g.r, g.members.length, slot);
    return { u, v, yaw: yawOfLocal(g.u - u, g.v - v) };
  }

  // ======================================================== tareas: ejecución

  /** Programa una tarea nueva con una demora (s). */
  schedule(a: Agent, task: Task, delay: number): void {
    a.next = task;
    a.delay = delay;
  }

  /** Coloca a alguien directamente donde su tarea ocurre (arranque, o fuera de cuadro). */
  private place(a: Agent, task: Task): void {
    this.release(a);
    a.task = task;
    a.next = null;
    a.after = null;
    a.gone = false;
    a.walkOff = false;
    a.rescue = false;
    a.waitEpoch = -1;
    // Sin restos de la ubicación anterior (si el momento se fija dos veces
    // antes del primer cuadro, alguien quedaba "sentado" en el aire).
    a.seat = null;
    a.sitT = 0;
    a.run = task.k === 'play';
    setBase(a.anim, 'idle');
    a.anim.w = 1;
    a.anim.gesture = null;
    const rt = this.rt;
    // Llegando: en la entrada, parte de los chicos todavía viene por la vereda.
    const arriving =
      this.phase === 'entrada' &&
      (a.role === 'student' || a.role === 'studentSecondary' || a.role === 'kid') &&
      task.k !== 'seat' &&
      rt.chance(0.3);
    if (task.k === 'leave') {
      // Arrancando la salida: ya se fueron unos cuantos.
      if (rt.chance(0.45)) {
        a.gone = true;
        a.stage = 'gone';
        return;
      }
    }
    if (task.k === 'stroll') {
      a.laneV = planV(rt.chance(0.5) ? 3.7 : 4.9);
      a.laneDir = rt.chance(0.5) ? 1 : -1;
      this.teleport(a, this.laneMin + rt.next() * (this.laneMax - this.laneMin), a.laneV, 0, a.laneDir > 0 ? -Math.PI / 2 : Math.PI / 2);
      a.stage = 'act';
      setBase(a.anim, 'walk');
      return;
    }
    if (arriving) {
      // En la vereda, rumbo al portón, con una demora para que lleguen escalonados.
      const u = MID_U + (rt.next() - 0.5) * 2 * (rt.chance(0.5) ? 14 : 30) * SCALE_U;
      const v = planV(2.8) + rt.next() * 2.6;
      this.teleport(a, clamp(u, this.laneMin + 1, this.laneMax - 1), v, 0, yawOfLocal(MID_U - u, -v));
      a.stage = 'act';
      a.task = { k: 'idle' };
      this.schedule(a, task, rt.next() * 25);
      return;
    }
    if (task.k === 'leave') {
      // Los que quedan vienen saliendo: frente al portón, rumbo a la vereda.
      const p = this.places.randomInRect(this.places.sidewalkFront, () => rt.next(), 0, 0.3) ?? { u: MID_U, v: planV(3.5), level: 0 as Level };
      this.teleport(a, p.u, p.v, 0, rt.range(-Math.PI, Math.PI));
      a.stage = 'act';
      a.task = { k: 'idle' };
      this.begin(a, task);
      return;
    }
    if (task.k === 'queue' && !this.queue.includes(a)) this.queue.push(a);
    const dest = this.destination(a, task);
    if (task.k === 'seat') {
      const s = task.seat;
      this.seatOwner.set(s.id, a);
      a.seat = s;
      this.teleport(a, s.u - s.fu * 0.06, s.v - s.fv * 0.06, s.level, s.yaw);
      a.y = s.footY;
      this.prepareSit(a, s);
      a.stage = 'act';
      a.sitT = 1;
      setBase(a.anim, task.anim);
      a.anim.w = 1;
      return;
    }
    if (dest) this.teleport(a, dest.u, dest.v, dest.level, dest.yaw ?? a.yaw);
    else {
      const p = this.places.randomIn('hall', () => rt.next(), 0.4);
      if (p) this.teleport(a, p.u, p.v, p.level, rt.range(-Math.PI, Math.PI));
    }
    a.stage = 'act';
    this.startAct(a);
    a.anim.w = 1;
  }

  /** Ubica a alguien de golpe (y ajusta el piso). */
  teleport(a: Agent, u: number, v: number, level: Level, yaw: number): void {
    a.u = u;
    a.v = v;
    a.level = level;
    a.y = this.floorAt(level, u, v);
    a.yaw = a.wantYaw = yaw;
    a.vu = a.vv = a.speed = 0;
    a.onStair = false;
    a.pre = a.post = null;
    a.path = null;
    a.pending = false;
    if (a.job) a.job.cancelled = true;
    a.job = null;
    a.au = u;
    a.av = v;
  }

  /** Dónde ocurre una tarea (punto de llegada) y hacia dónde mirar. */
  private destination(a: Agent, task: Task): (NavPoint & { yaw?: number }) | null {
    switch (task.k) {
      case 'stand':
      case 'post':
      case 'floor':
        return task.at;
      case 'seat':
        return { u: task.seat.au, v: task.seat.av, level: task.seat.level, yaw: task.seat.yaw };
      case 'group': {
        const s = this.slotOf(task.g, task.slot);
        return { u: s.u, v: s.v, level: task.g.level, yaw: s.yaw };
      }
      case 'teach':
        return { u: task.board.u, v: task.board.v, level: task.board.level, yaw: task.board.talkYaw };
      case 'wander': {
        const rnd = () => this.rt.next();
        // Con medio metro de aire: a 35 cm de un muro se quedaban mirándolo.
        return this.awayFromNamed(() => (task.room ? this.places.randomIn(task.room, rnd, 0.5) : task.rect ? this.places.randomInRect(task.rect, rnd, task.level, 0.5) : null));
      }
      case 'play':
        return this.awayFromNamed(() => this.places.randomInRect(task.rect, () => this.rt.next(), task.level, 0.3));
      case 'queue': {
        const i = Math.min(this.queue.indexOf(a) < 0 ? this.queue.length : this.queue.indexOf(a), this.places.queue.length - 1);
        return this.places.queue[i];
      }
      case 'mop': {
        const r = this.places.mopRoute;
        const t = this.rt.next();
        return { u: r[0].u + (r[1].u - r[0].u) * t, v: r[0].v + (r[1].v - r[0].v) * t, level: 0 };
      }
      case 'errand':
        return task.to;
      case 'leave':
        return task.exit;
      default:
        return null;
    }
  }

  /**
   * Un punto al azar (paseo, juego) que no caiga encima de un personaje con
   * nombre: al llegar, el paseo se da por llegado hasta 0,7 m antes y se
   * acomoda en su punto, y con el hall del CAD (más angosto) ese punto caía
   * seguido sobre Inés y el alumno quedaba metido en ella. Unos intentos; si
   * no hay otro, el último.
   */
  private awayFromNamed(pick: () => NavPoint | null): NavPoint | null {
    let p: NavPoint | null = null;
    for (let k = 0; k < 4; k++) {
      p = pick();
      if (!p || !this.namedNear(p.level, p.u, p.v, 0.9)) return p;
    }
    return p;
  }

  /** Suelta lo reservado por la tarea actual (silla, grupo, fila). */
  private release(a: Agent): void {
    const t = a.task;
    if (t.k === 'seat' && this.seatOwner.get(t.seat.id) === a && !this.isHome(a, t.seat)) this.seatOwner.delete(t.seat.id);
    if (t.k === 'group') {
      const g = t.g;
      if (g.speaker === a) g.speaker = null;
    }
    const qi = this.queue.indexOf(a);
    if (qi >= 0) this.queue.splice(qi, 1);
  }

  private isHome(a: Agent, s: Seat): boolean {
    return this.homeSeat.get(a) === s;
  }

  /** Empieza una tarea: si está sentado, primero se levanta. */
  private begin(a: Agent, task: Task): void {
    if (a.gone) {
      if (task.k === 'leave' || task.k === 'idle') return;
      this.reenter(a, task);
      return;
    }
    if ((a.seat || a.task.k === 'floor') && (a.stage === 'act' || a.stage === 'sitdown')) {
      a.after = task;
      a.stage = 'standup';
      if (!a.seat) a.sitT = 1;
      setBase(a.anim, 'idle');
      return;
    }
    if (a.rescue) {
      if (!a.visible) {
        a.rescue = false;
        this.place(a, task);
        return;
      }
      // Todavía a la vista: espera un poco más. Salvo quien esperaba afuera a
      // que abrieran la escuela y ya abrieron: ése vuelve a probar, una vez
      // por apertura (si falla por otra cosa, sigue esperando como antes).
      // Sin esto, antes de Rubén la gente del portón se quedaba parada ahí
      // con la escuela ya abierta, hasta que el jugador mirara para otro lado.
      if (a.waitEpoch < 0 || a.waitEpoch === this.gateEpoch || this.shutNow) {
        this.schedule(a, task, 2);
        return;
      }
      a.waitEpoch = -1;
      a.rescue = false;
    }
    this.release(a);
    a.task = task;
    a.after = null;
    a.fails = 0;
    a.walkOff = false;
    a.run = task.k === 'play';
    if (task.k === 'stroll') {
      a.stage = 'act';
      return;
    }
    if (task.k === 'post' && (!a.visible || Math.hypot(a.u - task.at.u, a.v - task.at.v) < 0.6)) {
      // El portero vive en su cabina: si no está a la vista, ya llegó. Y si
      // ya está en su puesto no "viaja": el puesto queda dentro de la cabina
      // (maciza para la grilla) y el camino arrancaba del otro lado del muro,
      // en el aula 6, a cada cambio de momento del día. A la vista no salta:
      // se acomoda los centímetros que falten.
      if (!a.visible) this.teleport(a, task.at.u, task.at.v, task.at.level, task.at.yaw);
      a.stage = 'act';
      this.startAct(a);
      a.au = task.at.u;
      a.av = task.at.v;
      return;
    }
    if (task.k === 'queue' && !this.queue.includes(a)) this.queue.push(a);
    if (task.k === 'seat') this.seatOwner.set(task.seat.id, a);
    const dest = this.destination(a, task);
    if (!dest) {
      a.stage = 'act';
      this.startAct(a);
      return;
    }
    this.travelTo(a, dest, task.k === 'seat' ? this.places.lastMile(task.seat) : null);
  }

  /** Vuelve a la escuela alguien que se había ido: entra por la vereda, fuera de cuadro. */
  private reenter(a: Agent, task: Task): void {
    a.gone = false;
    const v = this.view;
    const ends = [this.laneMin, this.laneMax];
    // La punta que la cámara no está mirando (o la más lejana).
    const score = (u: number) => {
      const du = u - v.cu;
      const dv = planV(4.2) - v.cv;
      const d = Math.hypot(du, dv) || 1;
      return d * (1.5 - (du * v.fu + dv * v.fv) / d);
    };
    const end = score(ends[0]) > score(ends[1]) ? ends[0] : ends[1];
    // Repartidos a lo largo de unos metros de vereda: si todos aparecen en el
    // mismo punto se empujan entre sí.
    const u = end + (end < MID_U ? 1 : -1) * this.rt.next() * 4;
    a.laneV = planV(3.2) + this.rt.next() * 2.2;
    this.teleport(a, u, a.laneV, 0, u < MID_U ? -Math.PI / 2 : Math.PI / 2);
    a.stage = 'act';
    a.task = { k: 'idle' };
    this.begin(a, task);
  }

  /** Arranca el viaje hacia un punto (con un tramo final opcional fuera de la grilla). */
  private travelTo(a: Agent, dest: NavPoint, mile: number[] | null): void {
    a.stage = 'travel';
    a.resume = null;
    a.path = null;
    a.leg = 0;
    a.wp = 0;
    a.stuckT = 0;
    a.lastU = a.u;
    a.lastV = a.v;
    // Tramo previo: si está fuera de la vereda medida o fuera de la grilla, primero vuelve.
    if (a.v > NAV_BOUNDS.v1 - 1 || a.u < NAV_BOUNDS.u0 + 0.5 || a.u > NAV_BOUNDS.u1 - 0.5) {
      const tu = clamp(a.u, NAV_BOUNDS.u0 + 1, NAV_BOUNDS.u1 - 1);
      a.pre = [a.u, a.v, NaN, tu, Math.min(a.v, planV(5.5)), NaN];
      a.preI = 0;
    } else {
      a.pre = null;
    }
    // Tramo final hasta la silla: el viaje por la grilla termina en su comienzo.
    let to: NavPoint = dest;
    if (mile && mile.length >= 3) {
      a.post = mile;
      a.postI = 0;
      to = { u: mile[0], v: mile[1], level: dest.level };
    } else {
      a.post = null;
    }
    a.goal = to;
    // Escuela cerrada (una llave de la historia en el portón): quien está
    // afuera y va adentro ni busca camino. Una búsqueda imposible recorre
    // toda la vereda (~5 ms en escritorio) y antes de Rubén la gente del
    // portón la repetía cada pocos segundos. Queda como un camino fallido:
    // espera, en cuanto nadie lo vea se lo ubica adentro, y si está a la
    // vista vuelve a probar cuando abren.
    if (this.waitsForGate(a)) {
      this.pathFailed(a);
      return;
    }
    const from: NavPoint = a.pre ? { u: a.pre[3], v: a.pre[4], level: 0 } : { u: a.u, v: a.v, level: a.level };
    this.requestPath(a, from, to);
  }

  private requestPath(a: Agent, from: NavPoint, to: NavPoint): void {
    if (a.job) a.job.cancelled = true;
    a.pending = true;
    a.path = null;
    // Los personajes con nombre y quien está a la vista, primero.
    const job = this.nav.request(
      from,
      to,
      (p) => {
        if (a.job !== job) return;
        a.job = null;
        a.pending = false;
        if (!p) {
          this.pathFailed(a);
          return;
        }
        a.path = p.legs;
        a.leg = 0;
        a.wp = 1;
      },
      a.named || a.visible,
    );
    a.job = job;
  }

  /** Avanza los caminos pedidos con el presupuesto del cuadro. */
  private processPaths(): void {
    this.nav.work(this.pathBudget);
  }

  private pathFailed(a: Agent): void {
    a.path = null;
    a.post = null;
    a.fails++;
    if (a.named) {
      a.stage = 'act';
      a.task = { k: 'script' };
      a.resolve?.(false);
      a.resolve = null;
      return;
    }
    // Sin camino: se queda donde está un rato y vuelve a intentar. Si ya
    // falló varias veces (quedó en un rincón sin salida), la próxima tarea
    // lo ubica directamente en cuanto esté fuera de cuadro. Si es que la
    // escuela está cerrada, anota la apertura del portón que espera.
    a.waitEpoch = this.waitsForGate(a) ? this.gateEpoch : -1;
    a.stage = 'act';
    const t = a.task;
    if (t.k === 'seat' && this.seatOwner.get(t.seat.id) === a && !this.isHome(a, t.seat)) this.seatOwner.delete(t.seat.id);
    a.task = { k: 'idle' };
    a.streak++;
    a.rescue = a.streak >= 2;
    this.schedule(a, t.k === 'idle' || t.k === 'script' ? this.wanderTask('hall', 0) : t, 3 + this.rt.next() * 3);
  }

  /** ¿Está afuera, va adentro (a `goal`) y una llave de la historia cierra el portón? */
  private waitsForGate(a: Agent): boolean {
    const g = a.goal;
    return this.shutNow && !a.named && g !== null && outsideGate(a.level, a.u, a.v) && !outsideGate(g.level, g.u, g.v);
  }

  /** Llegó al final del viaje. */
  private arrive(a: Agent): void {
    const t = a.task;
    a.onStair = false;
    a.streak = 0;
    a.path = null;
    a.pre = a.post = null;
    a.speed = 0;
    if (t.k === 'script') {
      // Personaje con nombre: se queda donde llegó (ese es su lugar ahora).
      a.stage = 'act';
      this.startAct(a);
      this.makeRoomFor(a);
      const r = a.resolve;
      a.resolve = null;
      r?.(true);
      return;
    }
    if (t.k === 'seat') {
      a.seat = t.seat;
      a.stage = 'sitdown';
      a.sitT = 0;
      a.sitFrom = [a.u, a.v, a.y];
      this.prepareSit(a, t.seat);
      setBase(a.anim, t.anim);
      return;
    }
    if (t.k === 'leave') {
      // Llegó a la punta de la vereda: sigue de largo hasta perderse de vista.
      a.walkOff = true;
      a.stage = 'act';
      a.laneDir = t.exit.u < MID_U ? -1 : 1;
      a.laneV = a.v;
      return;
    }
    a.stage = 'act';
    this.startAct(a);
  }

  /** Rodilla y cadera para apoyar los pies desde ese asiento. */
  private prepareSit(a: Agent, s: Seat): void {
    const d = a.body;
    a.seatY = s.y;
    // Mesa adelante, medida desde la cadera (que queda 6 cm detrás del
    // centro del asiento): para apoyar los brazos en la tapa.
    a.anim.deskH = s.desk ? s.deskY - (s.y + d.seatOffset) : NaN;
    a.anim.deskZ = s.deskD + 0.06;
    const top = s.y + d.seatOffset;
    if (s.kind === 'stool') {
      // Banqueta: muslo algo caído y las tibias hacia atrás, con las suelas en
      // el travesaño (con la rodilla hacia adelante los pies quedaban 60 cm
      // delante de la banqueta, en el aire; colgando, a 26 cm del piso).
      const hip = 1.2;
      const drop = top - d.thigh * Math.cos(hip) - s.footY;
      a.anim.hipFlex = hip;
      a.anim.knee = hip + Math.acos(clamp(drop / d.shin, 0, 1));
      a.anim.dangle = false;
      return;
    }
    // Muslo casi horizontal; si así la tibia no llega al piso (adolescentes y
    // adultos en sillas y bancos de 0,46-0,50 m), la rodilla baja un poco
    // (cadera hasta 1,0 rad) en vez de dejar los pies 3-9 cm en el aire.
    let hip = 1.4;
    let drop = top - d.thigh * Math.cos(hip) - s.footY;
    if (d.shin * 0.98 < drop) {
      hip = clamp(Math.acos(clamp((top - s.footY - 0.98 * d.shin) / d.thigh, -1, 1)), 1.0, 1.4);
      drop = top - d.thigh * Math.cos(hip) - s.footY;
    }
    a.anim.hipFlex = hip;
    if (d.shin * 0.98 >= drop) {
      a.anim.knee = hip - Math.acos(clamp(drop / d.shin, 0, 1));
      a.anim.dangle = false;
    } else {
      a.anim.knee = hip - 0.08;
      a.anim.dangle = a.look.age === 'kid' || a.look.age === 'child';
    }
  }

  /** Arranca la parte "en el lugar" de la tarea: mirada y animación. */
  private startAct(a: Agent): void {
    const t = a.task;
    a.au = a.u;
    a.av = a.v;
    a.timer = 0;
    a.sub = 0;
    switch (t.k) {
      case 'stand':
      case 'post':
        a.wantYaw = t.at.yaw;
        setBase(a.anim, t.anim);
        a.timer = 2 + this.rt.next() * 6;
        break;
      case 'floor':
        a.wantYaw = t.at.yaw;
        a.yaw = t.at.yaw;
        a.seatY = a.y;
        setBase(a.anim, 'sitFloor');
        break;
      case 'group': {
        const s = this.slotOf(t.g, t.slot);
        a.wantYaw = s.yaw;
        setBase(a.anim, 'listen');
        break;
      }
      case 'teach':
        a.wantYaw = t.board.writeYaw;
        setBase(a.anim, 'write');
        this.boardStep(a, t.board, true);
        a.timer = 4 + this.rt.next() * 5;
        break;
      case 'queue':
        setBase(a.anim, 'idle');
        a.slot = this.queue.indexOf(a);
        break;
      case 'mop':
        setBase(a.anim, 'mop');
        a.timer = 8 + this.rt.next() * 7;
        break;
      case 'errand':
        setBase(a.anim, 'idle');
        a.timer = 5 + this.rt.next() * 5;
        break;
      case 'wander':
      case 'play':
        setBase(a.anim, this.rt.chance(0.35) ? 'lookAround' : 'idle');
        a.timer = t.k === 'play' ? 0.4 + this.rt.next() * 1.6 : 2 + this.rt.next() * 7;
        if (t.k === 'wander' && !this.nav.isWalkable(a.level, a.u - Math.sin(a.yaw) * 0.8, a.v + Math.cos(a.yaw) * 0.8)) {
          // Llegó mirando una pared (el rincón junto a la escalera del hall):
          // se da vuelta hacia el centro del ambiente en vez de quedarse así.
          const c = this.wanderCenter(t);
          if (c) a.wantYaw = yawOfLocal(c.u - a.u, c.v - a.v);
        }
        break;
      case 'script':
        setBase(a.anim, a.scriptAnim);
        break;
      default:
        setBase(a.anim, 'idle');
        break;
    }
  }

  /** Centro de la zona de un paseo: promedio del polígono del ambiente, o centro del rectángulo. */
  private wanderCenter(t: { room: string | null; rect: Rect | null }): { u: number; v: number } | null {
    if (t.rect) return { u: (t.rect.u0 + t.rect.u1) / 2, v: (t.rect.v0 + t.rect.v1) / 2 };
    const r = t.room ? this.places.room(t.room) : undefined;
    if (!r || r.poly.length === 0) return null;
    let u = 0;
    let v = 0;
    for (const [pu, pv] of r.poly) {
      u += pu;
      v += pv;
    }
    return { u: u / r.poly.length, v: v / r.poly.length };
  }

  /**
   * Para escribir, el docente da un paso hacia el pizarrón (desde el lugar
   * de hablarle a la clase, a 60 cm, la mano escribía en el aire); para
   * hablar vuelve a su lugar.
   */
  private boardStep(a: Agent, b: Board, write: boolean): void {
    const u = b.u - (write ? b.fu * 0.1 : 0);
    const v = b.v - (write ? b.fv * 0.1 : 0);
    if (!write || this.nav.isWalkable(b.level, u, v)) {
      a.au = u;
      a.av = v;
    }
  }

  /** La tarea en su lugar (etapa 'act'). */
  private act(a: Agent, dt: number): void {
    const t = a.task;
    a.timer -= dt;
    switch (t.k) {
      case 'stand':
        if (t.wave && a.timer <= 0) {
          // En el portón: saluda a los que llegan (o se van).
          if (this.rt.chance(0.5)) startGesture(a.anim, 'wave');
          a.timer = 4 + this.rt.next() * 7;
        } else if (!t.wave && a.timer <= 0 && t.anim === 'idle') {
          setBase(a.anim, this.rt.chance(0.3) ? 'lookAround' : 'idle');
          a.timer = 4 + this.rt.next() * 8;
        } else if (!t.wave && a.timer <= 0 && t.anim === 'talk' && this.phase !== 'acto') {
          // La maestra del jardín habla, escucha y se vuelve hacia una mesa u
          // otra (el discurso del acto, en cambio, sigue de frente).
          setBase(a.anim, this.rt.chance(0.6) ? 'talk' : 'listen');
          a.wantYaw = t.at.yaw + (this.rt.next() - 0.5) * 1.0;
          a.timer = 4 + this.rt.next() * 6;
        }
        break;
      case 'post':
        if (a.timer <= 0) {
          if (t.anim !== 'serve') setBase(a.anim, this.rt.chance(0.35) ? 'lookAround' : t.anim);
          a.timer = 5 + this.rt.next() * 8;
        }
        break;
      case 'group':
        this.actGroup(a, t.g, dt);
        break;
      case 'teach':
        if (a.timer <= 0) {
          a.sub = (a.sub + 1) % 3;
          if (a.sub === 1) {
            a.wantYaw = t.board.talkYaw;
            setBase(a.anim, 'talk');
          } else if (a.sub === 2) {
            a.wantYaw = t.board.talkYaw + (this.rt.next() - 0.5) * 0.6;
            setBase(a.anim, 'listen');
            if (this.rt.chance(0.5)) startGesture(a.anim, 'point');
          } else {
            a.wantYaw = t.board.writeYaw;
            setBase(a.anim, 'write');
          }
          this.boardStep(a, t.board, a.sub === 0);
          a.timer = 4 + this.rt.next() * 6;
        }
        break;
      case 'seat':
        if (a.timer <= 0) {
          // Variaciones de estar sentado: escribe, escucha, charla con el de al lado.
          const base = t.anim;
          let next: AnimId = base;
          if (base === 'sitDesk') next = this.rt.chance(0.7) ? 'sitDesk' : 'sit';
          else if (base === 'sitTalk') next = this.rt.chance(0.6) ? 'sitTalk' : 'sit';
          else if (base === 'sit' && t.seat.desk && this.rt.chance(0.3)) next = 'sitDesk';
          if (a.seat?.kind === 'bleacher' || a.seat?.kind === 'ledge') next = next === 'sitDesk' ? 'sit' : next;
          setBase(a.anim, next);
          a.timer = 6 + this.rt.next() * 12;
        }
        break;
      case 'queue': {
        const i = this.queue.indexOf(a);
        if (i < 0) break;
        const spot = this.places.queue[Math.min(i, this.places.queue.length - 1)];
        if (i !== a.slot && i < this.places.queue.length) {
          // Avanza la fila.
          a.slot = i;
          this.travelTo(a, spot, null);
          break;
        }
        a.wantYaw = spot.yaw;
        if (i === 0) {
          if (a.sub === 0) {
            a.sub = 1;
            a.timer = 4 + this.rt.next() * 4;
            setBase(a.anim, 'talk');
          } else if (a.timer <= 0) {
            // Atendido: se va al patio con lo que compró.
            this.queue.shift();
            this.begin(a, this.wanderTask('patioOeste', 0));
          }
        } else if (a.anim.base !== 'idle' && a.anim.base !== 'lookAround' && a.anim.base !== 'walk') setBase(a.anim, 'idle');
        break;
      }
      case 'mop':
        if (a.timer <= 0) this.begin(a, { k: 'mop' });
        break;
      case 'errand':
        if (a.timer <= 0) {
          const s = this.homeSeat.get(a);
          this.begin(a, s ? { k: 'seat', seat: s, anim: 'sitDesk' } : this.wanderTask('pasilloSur', 0));
        }
        break;
      case 'wander':
        if (a.timer <= 0) this.begin(a, t);
        break;
      case 'play':
        if (a.timer <= 0) {
          a.run = true;
          this.begin(a, t);
        }
        break;
      case 'stroll':
        this.stroll(a, dt);
        break;
      case 'leave':
        if (a.walkOff) this.stroll(a, dt);
        break;
      case 'script':
        if (a.scriptOnce > 0) {
          a.scriptOnce -= dt;
          if (a.scriptOnce <= 0) {
            a.scriptAnim = 'idle';
            setBase(a.anim, 'idle');
          }
        }
        break;
      default:
        break;
    }
  }

  /** Grupo: el que habla gesticula, los demás lo miran y asienten; se turnan. */
  private actGroup(a: Agent, g: Group, dt: number): void {
    void dt;
    if (this.time >= g.next || !g.speaker || g.speaker.task.k !== 'group') {
      const present = g.members.filter((m) => m.task.k === 'group' && m.stage === 'act' && (m.task as { g: Group }).g === g);
      g.speaker = present.length > 0 ? present[Math.floor(this.rt.next() * present.length)] : null;
      g.next = this.time + 3 + this.rt.next() * 5;
    }
    const want: AnimId = g.speaker === a ? 'talk' : 'listen';
    // Dando unos pasos (girando, haciendo lugar) no se le corta el paso:
    // retoma al quedarse quieto.
    if (a.anim.base === 'walk' || a.anim.base === 'run') a.resume = want;
    else if (a.anim.base !== want) setBase(a.anim, want);
  }

  /** Vereda: va y viene por su carril, con alguna pausa. */
  private stroll(a: Agent, dt: number): void {
    const walkOff = a.walkOff;
    if (!walkOff && a.timer > 0) {
      a.speed = 0;
      if (a.anim.base !== 'idle' && a.anim.base !== 'lookAround') setBase(a.anim, 'lookAround');
      return;
    }
    if (!walkOff) {
      // El paseo de la vereda no mira a nadie: un personaje con nombre parado
      // en el carril (Lola en el portón) era atravesado. Se da la vuelta antes.
      for (const n of this.named.values()) {
        if (!n.alive || n.hidden || n.level !== 0) continue;
        const ahead = (n.u - a.u) * a.laneDir;
        if (ahead > 0 && ahead < 0.9 && Math.abs(n.v - a.v) < a.radius + n.radius + 0.1) {
          a.laneDir = -a.laneDir;
          break;
        }
      }
    }
    const sp = a.walkSpeed * (walkOff && !a.visible ? 2 : 1);
    if (a.anim.base !== 'walk') setBase(a.anim, 'walk');
    let nu = a.u + a.laneDir * sp * dt;
    const nv = a.v + (a.laneV - a.v) * Math.min(1, dt * 1.5);
    const blocked = this.world.blocked;
    const out = walkOff ? false : nu < this.laneMin || nu > this.laneMax || (blocked !== undefined && blocked(nu, nv));
    if (out) {
      a.laneDir = -a.laneDir;
      nu = a.u;
      if (this.rt.chance(0.4)) a.timer = 2 + this.rt.next() * 5;
    } else if (!walkOff && this.rt.chance(dt * 0.03)) {
      a.timer = 2 + this.rt.next() * 4;
    }
    a.vu = (nu - a.u) / Math.max(dt, 1e-3);
    a.vv = (nv - a.v) / Math.max(dt, 1e-3);
    a.u = nu;
    a.v = nv;
    a.speed = Math.abs(a.vu);
    a.wantYaw = yawOfLocal(a.laneDir, 0);
    a.y = this.floorAt(0, a.u, a.v);
    if (walkOff) {
      // Fuera de cuadro y lejos (o muy lejos): se fue.
      const d = Math.hypot(a.u - this.view.cu, a.v - this.view.cv);
      if ((a.unseen > 1.2 && d > 22) || Math.abs(a.u - MID_U) > 95) {
        a.gone = true;
        a.stage = 'gone';
        a.walkOff = false;
      }
    }
  }

  // ================================================================= movimiento

  floorAt(level: Level, u: number, v: number): number {
    if (level > 0) return LEVEL_Y[level];
    if (u < NAV_BOUNDS.u0 || u > NAV_BOUNDS.u1 || v < NAV_BOUNDS.v0 || v > NAV_BOUNDS.v1) return this.world.surface ? this.world.surface(u, v) : 0;
    return this.nav.floorAt(0, u, v);
  }

  /** Recorre un tramo sin grilla (u, v, y por punto; y NaN = piso). Devuelve true al terminar. */
  private followMile(a: Agent, pts: number[], idx: 'preI' | 'postI', dt: number, speed: number): boolean {
    let i = a[idx];
    let budget = speed * dt;
    while (i < pts.length && budget > 0) {
      const tu = pts[i];
      const tv = pts[i + 1];
      const du = tu - a.u;
      const dv = tv - a.v;
      const d = Math.hypot(du, dv);
      if (d <= budget) {
        a.u = tu;
        a.v = tv;
        budget -= d;
        i += 3;
        continue;
      }
      a.u += (du / d) * budget;
      a.v += (dv / d) * budget;
      a.wantYaw = yawOfLocal(du, dv);
      budget = 0;
    }
    a[idx] = i;
    // Altura: interpolada entre puntos con y (gradas), o el piso.
    const ty = i < pts.length ? pts[i + 2] : pts[pts.length - 1];
    const fy = Number.isFinite(ty) ? ty : this.floorAt(a.level, a.u, a.v);
    a.y += (fy - a.y) * Math.min(1, dt * 6);
    a.speed = speed;
    a.vu = 0;
    a.vv = 0;
    return i >= pts.length;
  }

  private move(a: Agent, dt: number): void {
    if (a.stage === 'travel') {
      if (a.pre) {
        if (this.followMile(a, a.pre, 'preI', dt, a.walkSpeed)) a.pre = null;
        return;
      }
      if (a.pending) {
        a.speed *= Math.max(0, 1 - dt * 6);
        return;
      }
      if (a.path) {
        this.followPath(a, dt);
        return;
      }
      if (a.post) {
        if (this.followMile(a, a.post, 'postI', dt, a.walkSpeed * 0.65)) {
          a.post = null;
          this.arrive(a);
        }
        return;
      }
      this.arrive(a);
      return;
    }
    if (a.stage === 'sitdown' || a.stage === 'standup') {
      const s = a.seat;
      if (!s) {
        // Levantándose del piso (acto): sólo espera que termine la animación.
        a.sitT -= dt / 0.85;
        if (a.sitT <= 0 || a.stage === 'sitdown') {
          a.stage = 'act';
          const next = a.after;
          a.after = null;
          a.task = { k: 'idle' };
          if (next) this.begin(a, next);
        }
        return;
      }
      const dir = a.stage === 'sitdown' ? 1 : -1;
      a.sitT = clamp(a.sitT + (dir * dt) / 0.85, 0, 1);
      const k = a.sitT * a.sitT * (3 - 2 * a.sitT);
      const su = s.u - s.fu * 0.06;
      const sv = s.v - s.fv * 0.06;
      const [fu, fv, fy] = a.stage === 'sitdown' ? a.sitFrom : [s.au, s.av, s.ay];
      a.u = fu + (su - fu) * k;
      a.v = fv + (sv - fv) * k;
      a.y = fy + (s.footY - fy) * k;
      a.wantYaw = s.yaw;
      a.speed = 0;
      if (a.stage === 'sitdown' && a.sitT >= 1) {
        a.stage = 'act';
        a.timer = 4 + this.rt.next() * 8;
      } else if (a.stage === 'standup' && a.sitT <= 0) {
        // De pie junto a la silla: sale por el mismo tramo por el que entró.
        const mile = this.places.lastMile(s);
        const owner = this.seatOwner.get(s.id);
        if (owner === a && !this.isHome(a, s)) this.seatOwner.delete(s.id);
        a.seat = null;
        a.stage = 'act';
        const next = a.after;
        a.after = null;
        const back: number[] = [];
        for (let i = mile.length - 6; i >= 0; i -= 3) back.push(mile[i], mile[i + 1], mile[i + 2]);
        if (next) {
          this.begin(a, next);
          if (back.length > 0 && (a.stage as Stage) === 'travel') {
            a.pre = back;
            a.preI = 0;
            const from: NavPoint = { u: back[back.length - 3], v: back[back.length - 2], level: a.level };
            if (a.goal) this.requestPath(a, from, a.goal);
          }
        }
      }
      return;
    }
    if (a.stage === 'act') this.actMove(a, dt);
  }

  /** En el lugar: girar hacia donde mira, y abrirle paso al jugador. */
  private actMove(a: Agent, dt: number): void {
    const t = a.task;
    if (t.k === 'stroll' || (t.k === 'leave' && a.walkOff)) return;
    const seated = a.seat !== null || t.k === 'floor';
    if (!seated && !a.named && t.k !== 'post') this.separate(a, dt);
    let tu = a.au;
    let tv = a.av;
    const p = this.view.player;
    if (!seated && p && levelOf(p.y) === a.level && t.k !== 'post' && !a.named) {
      // Corrimiento para dejar pasar: hasta 60 cm, lejos del jugador.
      const du = a.au - p.u;
      const dv = a.av - p.v;
      const d = Math.hypot(du, dv);
      const want = d < 0.95 && d > 1e-3 ? (0.95 - d) * 0.9 : 0;
      const su = want > 0 ? (du / d) * want : 0;
      const sv = want > 0 ? (dv / d) * want : 0;
      a.shoveU += (su - a.shoveU) * Math.min(1, dt * 4);
      a.shoveV += (sv - a.shoveV) * Math.min(1, dt * 4);
      tu += a.shoveU;
      tv += a.shoveV;
    } else {
      a.shoveU *= Math.max(0, 1 - dt * 3);
      a.shoveV *= Math.max(0, 1 - dt * 3);
    }
    const du = tu - a.u;
    const dv = tv - a.v;
    const d = Math.hypot(du, dv);
    if (d > 0.03 && !seated) {
      const sp = Math.min(0.9, d * 3);
      const nu = a.u + (du / d) * sp * dt;
      const nv = a.v + (dv / d) * sp * dt;
      if (this.nav.isWalkable(a.level, nu, nv) || !this.nav.isWalkable(a.level, a.u, a.v)) {
        a.u = nu;
        a.v = nv;
        a.speed = sp;
        a.vu = (du / d) * sp;
        a.vv = (dv / d) * sp;
      } else {
        // El ancla (o el corrimiento) cae en un lugar que no se pisa: se queda
        // donde está en vez de caminar en el lugar contra el obstáculo.
        a.speed = 0;
        a.vu = a.vv = 0;
        a.au = a.u;
        a.av = a.v;
      }
    } else {
      a.speed = 0;
      a.vu = a.vv = 0;
    }
  }

  /**
   * Dos parados en el mismo lugar (un paseo que eligió el punto de otro, un
   * grupo armado junto a una fila) quedaban uno dentro del otro: los que
   * están quietos corren de a poco su punto de anclaje hasta no tocarse. Con
   * un personaje con nombre o alguien en su puesto, se corre sólo el otro.
   */
  private separate(a: Agent, dt: number): void {
    const cell = this.hashKey(a.level, a.au, a.av);
    let pu = 0;
    let pv = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = this.hash.get(cell + di + dj * 1000);
        if (!list) continue;
        for (const o of list) {
          if (o === a || o.stage === 'travel') continue;
          const du = a.au - o.u;
          const dv = a.av - o.v;
          const d = Math.hypot(du, dv);
          // De un personaje con nombre, un paso más de distancia (charla, no roce).
          const minD = a.radius + o.radius + (o.named ? 0.3 : 0.04);
          if (d >= minD) continue;
          const share = o.named || o.task.k === 'post' ? 1 : 0.5;
          const ku = d > 1e-3 ? du / d : Math.cos(a.idx * 2.4);
          const kv = d > 1e-3 ? dv / d : Math.sin(a.idx * 2.4);
          pu += ku * (minD - d) * share;
          pv += kv * (minD - d) * share;
        }
      }
    }
    if (pu === 0 && pv === 0) return;
    const k = Math.min(1, dt * 2.5);
    const nu = a.au + pu * k;
    const nv = a.av + pv * k;
    if (this.nav.isWalkable(a.level, nu, nv)) {
      a.au = nu;
      a.av = nv;
    }
  }

  /** Avanza por el camino: escaleras por su recorrido, el resto con esquive. */
  private followPath(a: Agent, dt: number): void {
    const path = a.path!;
    const leg = path[a.leg];
    a.onStair = leg?.stair !== undefined;
    if (!leg) {
      a.path = null;
      return;
    }
    if (leg.stair) {
      // Escalera: a lo largo del tramo, más despacio, con los pies en la
      // rampa. Cada uno por su derecha (los que suben y los que bajan se
      // atravesaban por el medio) y sin pisarle los talones al de adelante.
      const pts = leg.pts;
      let budget = a.walkSpeed * 0.7 * dt;
      if (a.wp > 0 && a.wp < pts.length / 2 && this.stairAhead(a, leg)) budget = 0;
      const moving = budget > 0;
      // Esperando al pie (todavía no pisó el primer escalón): la fila se
      // abre un poco. En el tramo no hay esquive, y los que llegaban por el
      // pasillo se quedaban parados todos en el mismo punto del pie.
      if (!moving && a.wp === 1) this.spreadAtFoot(a);
      while (a.wp < pts.length / 2 && budget > 0) {
        const su = a.wp > 0 ? pts[a.wp * 2] - pts[a.wp * 2 - 2] : 0;
        const sv = a.wp > 0 ? pts[a.wp * 2 + 1] - pts[a.wp * 2 - 1] : 0;
        const sl = Math.hypot(su, sv) || 1;
        const tu = pts[a.wp * 2] - (sv / sl) * STAIR_RIGHT;
        const tv = pts[a.wp * 2 + 1] + (su / sl) * STAIR_RIGHT;
        const du = tu - a.u;
        const dv = tv - a.v;
        const d = Math.hypot(du, dv);
        if (d <= budget) {
          a.u = tu;
          a.v = tv;
          budget -= d;
          a.wp++;
        } else {
          a.u += (du / d) * budget;
          a.v += (dv / d) * budget;
          a.wantYaw = yawOfLocal(du, dv);
          budget = 0;
        }
        a.y = schoolFloorLocal(a.u, a.v, a.y);
      }
      a.speed = moving ? a.walkSpeed * 0.7 : 0;
      if (a.wp >= pts.length / 2) {
        a.level = leg.toLevel ?? a.level;
        a.y = LEVEL_Y[a.level];
        a.leg++;
        a.wp = 1;
        a.onStair = false;
      }
      return;
    }
    const pts = leg.pts;
    const nw = pts.length / 2;
    if (a.wp >= nw) {
      a.leg++;
      a.wp = 1;
      if (a.leg >= path.length) a.path = null;
      return;
    }
    const tu = pts[a.wp * 2];
    const tv = pts[a.wp * 2 + 1];
    const du = tu - a.u;
    const dv = tv - a.v;
    const d = Math.hypot(du, dv);
    // Si el gentío lo sacó del camino, ir derecho al punto siguiente podría
    // llevarlo contra un muro (o a un rincón sin salida): se recalcula.
    if (a.wp > 0 && a.probeT <= 0 && a.goal) {
      const pu = pts[a.wp * 2 - 2];
      const pv = pts[a.wp * 2 - 1];
      const su = tu - pu;
      const sv = tv - pv;
      const l2 = su * su + sv * sv;
      const k = l2 > 0 ? clamp(((a.u - pu) * su + (a.v - pv) * sv) / l2, 0, 1) : 0;
      if (Math.hypot(a.u - pu - su * k, a.v - pv - sv * k) > 1.1) {
        this.requestPath(a, { u: a.u, v: a.v, level: a.level }, a.goal);
        return;
      }
    }
    const last = a.leg === path.length - 1 && a.wp === nw - 1;
    // Al final, los que van "a cualquier lado" (pasear, jugar, irse) no
    // necesitan clavar el punto: en un amontonamiento nadie llegaría.
    const loose = a.task.k === 'leave' || a.task.k === 'wander' || a.task.k === 'play';
    if (d < (last ? (loose ? 0.7 : 0.12) : 0.35)) {
      a.wp++;
      if (last) {
        a.path = null;
        a.u = tu;
        a.v = tv;
      }
      return;
    }
    // Velocidad deseada: crucero, frenando al final; corre si juega o tiene apuro.
    let cruise = a.run ? a.look.runSpeed : a.walkSpeed;
    if (!a.named && a.unseen > 1 && !a.run) cruise *= 2.2;
    const want = Math.min(cruise, last ? Math.max(0.35, d * 1.6) : cruise);
    let vu = (du / d) * want;
    let vv = (dv / d) * want;
    // Esquive local (otras personas y el jugador).
    this.avoid(a, vu, vv, want);
    vu = this.avU;
    vv = this.avV;
    const sp = Math.hypot(vu, vv);
    // Aceleración limitada: el paso nace y muere, no se corta.
    const acc = (a.run ? 5 : 3) * dt;
    const cur = a.speed;
    const target = clamp(sp, cur - acc * 2, cur + acc);
    const k = sp > 1e-4 ? target / sp : 0;
    vu *= k;
    vv *= k;
    const nu = a.u + vu * dt;
    const nv = a.v + vv * dt;
    const nav = this.nav;
    const u0 = a.u;
    const v0 = a.v;
    if (nav.isWalkable(a.level, nu, nv) || !nav.isWalkable(a.level, a.u, a.v)) {
      a.u = nu;
      a.v = nv;
    } else if (nav.isWalkable(a.level, nu, a.v)) {
      a.u = nu;
    } else if (nav.isWalkable(a.level, a.u, nv)) {
      a.v = nv;
    }
    // La velocidad es lo que de verdad avanzó: contra un muro (o un cierre),
    // el ciclo de paso seguía la velocidad pedida y caminaba en el lugar.
    // El rumbo sí sigue a la pedida (hacia donde quiere ir).
    const inv = 1 / Math.max(dt, 1e-3);
    a.vu = (a.u - u0) * inv;
    a.vv = (a.v - v0) * inv;
    a.speed = Math.hypot(a.vu, a.vv);
    if (target > 0.05) a.wantYaw = yawOfLocal(vu, vv);
    const fy = this.floorAt(a.level, a.u, a.v);
    a.y += (fy - a.y) * Math.min(1, dt * 8);
    // Atascado: sin avanzar en 2 s. Primero se "afina" (esquiva apenas y
    // pasa rozando, como en un pasillo lleno); si sigue, recalcula; y si
    // nada sirve y nadie lo ve, llega directamente.
    a.stuckT += dt;
    if (a.ghost > 0) a.ghost -= dt;
    if (a.stuckT > 2) {
      const moved = Math.hypot(a.u - a.lastU, a.v - a.lastV);
      a.lastU = a.u;
      a.lastV = a.v;
      a.stuckT = 0;
      if (moved < 0.3 && a.goal) {
        a.fails++;
        if (a.fails === 1 || a.fails === 3) a.ghost = 2.5;
        else if (a.fails === 2 || a.fails === 4) this.requestPath(a, { u: a.u, v: a.v, level: a.level }, a.goal);
        else if (!a.visible && !a.named) {
          const post = a.post;
          this.teleport(a, a.goal.u, a.goal.v, a.goal.level, a.wantYaw);
          a.post = post;
          a.postI = 0;
          a.stage = 'travel';
        } else if (a.fails > 8) this.pathFailed(a);
      } else if (moved >= 0.3) {
        a.fails = Math.max(0, a.fails - 1);
      }
    }
    // Tanteo: ¿se cerró una puerta más adelante?
    a.probeT -= dt;
    if (a.probeT <= 0 && a.goal) {
      a.probeT = 0.5;
      const ahead = Math.min(0.7, d);
      if (nav.probeClosed(a.level, a.u + (du / d) * ahead, a.v + (dv / d) * ahead)) {
        this.requestPath(a, { u: a.u, v: a.v, level: a.level }, a.goal);
      }
    }
  }

  /**
   * Separa un poco a quien espera al pie de una escalera de los que esperan
   * pegados a él (menos de 0,32 m), sin meterlo en un muro: así la fila de
   * espera no se funde en un solo bulto.
   */
  private spreadAtFoot(a: Agent): void {
    const R = 0.32;
    let pu = 0;
    let pv = 0;
    const cell = this.hashKey(a.level, a.u, a.v);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = this.hash.get(cell + di + dj * 1000);
        if (!list) continue;
        for (const o of list) {
          if (o === a || !o.alive || Math.abs(o.y - a.y) > 0.5) continue;
          const du = a.u - o.u;
          const dv = a.v - o.v;
          const d = Math.hypot(du, dv);
          if (d >= R) continue;
          // Dos exactamente en el mismo punto: se abren según el índice.
          const k = d > 1e-4 ? (R - d) / d : R;
          pu += d > 1e-4 ? du * k : (a.idx < o.idx ? 1 : -1) * k;
          pv += d > 1e-4 ? dv * k : 0;
        }
      }
    }
    const m = Math.hypot(pu, pv);
    if (m < 1e-4) return;
    const step = Math.min(0.04, m * 0.5) / m;
    const nu = a.u + pu * step;
    const nv = a.v + pv * step;
    if (schoolSolidLocal(nu, nv, a.y) || !this.nav.isWalkable(a.level, nu, nv)) return;
    a.u = nu;
    a.v = nv;
  }

  /**
   * ¿Alguien adelante en el mismo tramo, en el mismo sentido y a menos de un
   * escalón y medio? "Adelante" es el AVANCE sobre el recorrido del tramo
   * (punto del recorrido y lo que falta hasta él), no la geometría: en el
   * descanso de una escalera en U el de adelante ya dobló, el rumbo y el
   * costado no coincidían, nadie esperaba y se fundían 6-8 en un bulto. Dos
   * en el mismo punto se ordenan por índice: es un orden total, así que no
   * se traban entre sí. Los que van en sentido contrario no cuentan (van
   * por su derecha). Se miran los dos niveles del tramo: el que baja todavía
   * figura en el piso de arriba.
   */
  private stairAhead(a: Agent, leg: PathLeg): boolean {
    const pts = leg.pts;
    const prog = (x: Agent) => {
      const w = Math.min(x.wp, pts.length / 2 - 1);
      return w - Math.hypot(pts[w * 2] - x.u, pts[w * 2 + 1] - x.v) * 1e-3;
    };
    const pa = prog(a);
    const levels = leg.toLevel !== undefined && leg.toLevel !== a.level ? [a.level, leg.toLevel] : [a.level];
    for (const lv of levels) {
      const cell = this.hashKey(lv, a.u, a.v);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const list = this.hash.get(cell + di + dj * 1000);
          if (!list) continue;
          for (const o of list) {
            if (o === a || !o.onStair || Math.abs(o.y - a.y) > 0.6 || !o.path) continue;
            const ol = o.path[o.leg];
            if (!ol || ol.stair !== leg.stair || ol.toLevel !== leg.toLevel) continue;
            if (Math.hypot(o.u - a.u, o.v - a.v) > 0.55) continue;
            const po = prog(o);
            if (po > pa + 1e-6 || (Math.abs(po - pa) <= 1e-6 && o.idx < a.idx)) return true;
          }
        }
      }
    }
    return false;
  }

  /** Esquive: separación y anticipación con vecinos, y prioridad del jugador. */
  /** Resultado de `avoid` (sin crear un arreglo por persona y por cuadro). */
  private avU = 0;
  private avV = 0;

  private avoid(a: Agent, vu: number, vv: number, want: number): void {
    const sp = Math.hypot(vu, vv) || 1;
    const fu = vu / sp;
    const fv = vv / sp;
    let au = 0;
    let av = 0;
    const consider = (ou: number, ov: number, ovu: number, ovv: number, r: number, weight: number) => {
      const du = ou - a.u;
      const dv = ov - a.v;
      const d = Math.hypot(du, dv);
      if (d < 1e-3 || d > 2.6) return;
      const minD = a.radius + r + 0.06;
      if (d < minD) {
        const push = ((minD - d) / minD) * 1.6 * weight;
        au -= (du / d) * push;
        av -= (dv / d) * push;
      }
      // Anticipación: tiempo al acercamiento máximo con la velocidad relativa.
      const ru = vu - ovu;
      const rv = vv - ovv;
      const r2 = ru * ru + rv * rv;
      if (r2 < 1e-4) return;
      const tc = (du * ru + dv * rv) / r2;
      if (tc <= 0 || tc > 2.2) return;
      const cu = du - ru * tc;
      const cv = dv - rv * tc;
      const miss = Math.hypot(cu, cv);
      if (miss > minD + 0.2) return;
      // Hacia el costado que ya lleva ventaja (o la derecha si va de frente).
      let side = fu * dv - fv * du;
      if (Math.abs(side) < 0.05) side = 1;
      const w = (1 - tc / 2.2) * (1 - miss / (minD + 0.2)) * weight;
      // Perpendicular a la marcha, alejándose del otro.
      const pu = -fv;
      const pv = fu;
      const s = side > 0 ? -1 : 1;
      au += pu * s * w * 1.2;
      av += pv * s * w * 1.2;
      // Y frena un poco si el otro viene de frente.
      au -= fu * w * 0.35;
      av -= fv * w * 0.35;
    };
    const cell = this.hashKey(a.level, a.u, a.v);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = this.hash.get(cell + di + dj * 1000);
        if (!list) continue;
        for (const o of list) {
          if (o === a) continue;
          // Los que están quietos cuentan como obstáculos fijos; afinado, casi
          // nada fuera de cuadro y a medias a la vista (pasa rozando, sin
          // atravesar al otro).
          consider(o.u, o.v, o.vu, o.vv, o.radius, (o.stage === 'travel' ? 1 : 1.3) * (a.ghost > 0 ? (a.visible ? 0.45 : 0.12) : 1));
        }
      }
    }
    const p = this.view.player;
    if (p && levelOf(p.y) === a.level) consider(p.u, p.v, this.pvu, this.pvv, 0.3, 2.0);
    if (!a.named) {
      // A los personajes con nombre (Inés, Lola, Rubén…) se les deja aire como
      // al jugador, también "afinado": la mochila de un alumno atravesaba los
      // brazos de Inés y un visitante se metía en Lola.
      for (const n of this.named.values()) {
        if (!n.alive || n.hidden || n.level !== a.level) continue;
        const du = n.u - a.u;
        const dv = n.v - a.v;
        const d = Math.hypot(du, dv);
        const minD = a.radius + n.radius + 0.21;
        if (d < 1e-3 || d >= minD) continue;
        const push = ((minD - d) / minD) * 1.6 * 2.0;
        au -= (du / d) * push;
        av -= (dv / d) * push;
      }
    }
    const ru = vu + au * want;
    const rv = vv + av * want;
    const m = Math.hypot(ru, rv);
    const max = want * 1.05;
    const k = m > max ? max / m : 1;
    this.avU = ru * k;
    this.avV = rv * k;
  }

  private hashKey(level: Level, u: number, v: number): number {
    return level * 1_000_000 + Math.floor((u + 20) / 1.3) + Math.floor((v + 60) / 1.3) * 1000;
  }

  private rebuildHash(): void {
    for (const list of this.hash.values()) list.length = 0;
    for (const a of this.agents) {
      // Los sentados no ocupan el paso (están en su silla, fuera del pasillo).
      if (!a.alive || a.hidden || a.seat !== null) continue;
      const k = this.hashKey(a.level, a.u, a.v);
      let list = this.hash.get(k);
      if (!list) {
        list = [];
        this.hash.set(k, list);
      }
      list.push(a);
    }
  }

  // =================================================================== animación

  private animate(a: Agent, dt: number): void {
    const an = a.anim;
    // Giro del cuerpo hacia donde quiere mirar.
    const dy = wrap(a.wantYaw - a.yaw);
    const rate = (a.speed > 0.3 ? (a.run ? 7 : 4.5) : 2.6) * dt;
    a.yaw = wrap(a.yaw + clamp(dy, -rate, rate));
    // Girar en el lugar más de unos 20° se hace dando pasitos: sin esto el
    // cuerpo rotaba sobre los pies quietos, como en una bandeja giratoria.
    const still = a.speed < 0.08 && a.seat === null && a.task.k !== 'floor' && !SEATED.has(an.base);
    const turn = still && Math.abs(dy) > 0.35 ? Math.min(0.45, Math.abs(dy) * 0.5) : 0;
    const legs = Math.max(a.speed, turn);
    // Locomoción: el ciclo avanza con la distancia (los pies no patinan).
    const moving = a.stage === 'travel' || (a.stage === 'act' && legs > 0.08);
    if (moving && !SEATED.has(an.base) && legs > 0.05) {
      if (an.base !== 'walk' && an.base !== 'run') {
        // Lo que estaba haciendo en su lugar vuelve cuando deja de moverse:
        // un paso para dejar pasar no le borra la tarea (el docente que
        // escribía seguía "parado" en vez de escribir).
        a.resume = a.stage === 'act' ? an.base : null;
        setBase(an, 'walk');
      }
    } else if ((an.base === 'walk' || an.base === 'run') && legs < 0.05 && a.stage !== 'travel') {
      setBase(an, a.task.k === 'script' ? a.scriptAnim : (a.resume ?? 'idle'));
      a.resume = null;
    }
    const legLen = 0.92 * a.body.legS;
    const runW = clamp((a.speed - a.walkSpeed * 1.25) / Math.max(0.3, a.look.runSpeed * 0.8 - a.walkSpeed * 1.25), 0, 1);
    an.run += (runW - an.run) * Math.min(1, dt * 4);
    const ampT = clamp(legs / Math.max(0.3, a.walkSpeed * 0.9), 0, 1);
    an.amp += (ampT - an.amp) * Math.min(1, dt * 5);
    const stride = legLen * (1.45 + 1.15 * an.run);
    an.phase = (an.phase + (legs * dt * TAU) / stride) % TAU;
    tickAnim(an, dt);
    this.lookAt(a, dt);
  }

  /** Mirada: al jugador si está cerca y adelante; si no, a quien habla en el grupo. */
  private lookAt(a: Agent, dt: number): void {
    const an = a.anim;
    const p = this.view.player;
    let tu = 0;
    let tv = 0;
    let ty = 0;
    let has = false;
    a.playerNear = false;
    if (p && a.lookPlayer && levelOf(p.y) === a.level) {
      const du = p.u - a.u;
      const dv = p.v - a.v;
      const d = Math.hypot(du, dv);
      if (d < 4.2 && d > 0.2) {
        const fwdU = -Math.sin(a.yaw);
        const fwdV = Math.cos(a.yaw);
        if ((du * fwdU + dv * fwdV) / d > -0.3) {
          tu = p.u;
          tv = p.v;
          ty = p.y + 1.6;
          has = true;
          a.playerNear = d < 3;
        }
      }
    }
    if (!has && a.task.k === 'group' && a.stage === 'act') {
      const sp = a.task.g.speaker;
      if (sp && sp !== a) {
        tu = sp.u;
        tv = sp.v;
        ty = sp.y + sp.look.height * 0.93;
        has = true;
      }
    }
    if (has) {
      const du = tu - a.u;
      const dv = tv - a.v;
      const d = Math.hypot(du, dv) || 1;
      // Ojos: de pie, ~93 % de la altura; sentado, el tronco sobre el asiento.
      const eye = a.seat ? a.seatY + a.body.seatOffset + a.look.height * 0.93 - 0.92 * a.body.legS : a.y + a.look.height * 0.93;
      an.lookYaw += (clamp(wrap(yawOfLocal(du, dv) - a.yaw), -1.35, 1.35) - an.lookYaw) * Math.min(1, dt * 5);
      an.lookPitch += (clamp(Math.atan2(eye - ty, d), -0.4, 0.5) - an.lookPitch) * Math.min(1, dt * 5);
      an.lookW = Math.min(1, an.lookW + dt * 2.5);
      // Si hay que girar demasiado, el cuerpo acompaña (sólo parado y quieto).
      if (Math.abs(an.lookYaw) > 1.1 && a.stage === 'act' && !a.seat && a.task.k !== 'teach' && a.speed < 0.1 && a.task.k !== 'floor') {
        a.wantYaw = wrap(a.yaw + an.lookYaw * 0.6);
      }
    } else {
      an.lookW = Math.max(0, an.lookW - dt * 1.5);
    }
    // Saludo: alguno saluda o asiente cuando el jugador se le acerca.
    a.greetT -= dt;
    if (a.playerNear && a.greetT <= 0 && !an.gesture) {
      a.greetT = 25 + this.rt.next() * 20;
      const kid = a.look.age === 'kid' || a.look.age === 'child';
      const r = this.rt.next();
      if (r < (kid ? 0.45 : 0.25)) startGesture(an, a.seat ? 'nod' : 'wave');
      else if (r < 0.6) startGesture(an, 'nod');
    }
  }

  // ===================================================================== cuadro

  update(dt: number, view?: SimView): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.phaseTime += dt;
    this.nav.now = this.time;
    if (view) this.view = view;
    const p = this.view.player;
    if (p) {
      if (this.plast) {
        this.pvu += ((p.u - this.plast.u) / Math.max(dt, 1e-3) - this.pvu) * Math.min(1, dt * 5);
        this.pvv += ((p.v - this.plast.v) / Math.max(dt, 1e-3) - this.pvv) * Math.min(1, dt * 5);
      }
      this.plast = { u: p.u, v: p.v };
    }
    // Cierres dinámicos (cestos del juego, puertas con llave): unas cientas
    // de celdas por cuadro con la colisión viva (~0,1 ms).
    this.nav.sweepDynamic(this.opts.detailed ? 300 : 200);
    // El portón: ¿lo cierra una llave de la historia? Al abrirse, quien
    // esperaba afuera vuelve a probar (ver `begin`).
    let shut = this.entrances.length > 0;
    for (const [u, v] of this.entrances) if (!schoolSolidLocal(u, v, LEVEL_Y[0], true)) shut = false;
    if (this.shutNow && !shut) {
      this.gateEpoch++;
      // Las marcas del cierre viejo duraban unos segundos más: el primero que
      // volvía a probar fallaba de nuevo y se quedaba esperando.
      for (const [u, v] of this.entrances) this.nav.forgetDynamic(0, u, v, 2);
    }
    this.shutNow = shut;
    this.processPaths();
    this.rebuildHash();
    this.phaseEvents(dt);
    // El reparto adaptativo no necesita mirarse en cada cuadro.
    this.adaptiveT -= dt;
    if (this.adaptiveT <= 0) {
      this.adaptiveT = 0.5;
      this.applyAdaptive();
    }
    const cu = this.view.cu;
    const cv = this.view.cv;
    for (const a of this.agents) {
      if (a.dormant) continue;
      if (a.visible) a.unseen = 0;
      else a.unseen += dt;
      // Programado: arranca la tarea siguiente cuando vence su demora.
      if (a.next) {
        a.delay -= dt;
        if (a.delay <= 0) {
          const t = a.next;
          a.next = null;
          this.begin(a, t);
        }
      }
      if (a.gone) continue;
      // Lejos y fuera de cuadro: se simula a 5 Hz con el tiempo acumulado.
      a.acc += dt;
      const far = !a.visible && !a.named && (a.u - cu) ** 2 + (a.v - cv) ** 2 > 25 * 25;
      if (far && a.acc < 0.2) continue;
      const step = Math.min(a.acc, 0.5);
      a.acc = 0;
      if (a.stage === 'act') this.act(a, step);
      this.move(a, step);
      this.animate(a, step);
    }
  }

  /** Eventos del momento: aplausos en el acto, mandados en clase. */
  private phaseEvents(dt: number): void {
    if (this.phase === 'acto') {
      this.clapT -= dt;
      if (this.clapT <= 0) {
        this.clapT = 16 + this.rt.next() * 12;
        for (const a of this.agents) {
          if (!a.alive || a.named || a.stage !== 'act') continue;
          const t = a.task;
          if ((t.k === 'stand' && t.anim !== 'talk') || t.k === 'floor' || (t.k === 'seat' && t.seat.kind === 'bleacher')) {
            // Cada uno arranca un poco después: un aplauso real no es sincrónico.
            a.anim.gesture = 'clap';
            a.anim.gT = -this.rt.next() * 1.2;
          }
        }
      }
    }
    if (this.phase === 'recreo' && this.places.queue.length > 0) {
      // La fila de la cantina no se vacía: cada tanto alguien del patio se suma.
      this.errandT -= dt;
      if (this.errandT <= 0) {
        this.errandT = 5 + this.rt.next() * 6;
        if (this.queue.length < Math.min(5, this.places.queue.length)) {
          const cands = this.agents.filter(
            (a) => (a.role === 'student' || a.role === 'studentSecondary') && a.alive && !a.named && a.stage === 'act' && (a.task.k === 'wander' || (a.task.k === 'group' && a.task.g.speaker !== a)),
          );
          if (cands.length > 0) this.begin(cands[Math.floor(this.rt.next() * cands.length)], { k: 'queue' });
        }
      }
    }
    if (this.phase === 'clase') {
      this.errandT -= dt;
      if (this.errandT <= 0) {
        this.errandT = 10 + this.rt.next() * 10;
        const max = this.opts.detailed ? 3 : 2;
        const out = this.agents.filter((a) => a.task.k === 'errand').length;
        if (out < max) {
          const seated = this.agents.filter((a) => (a.role === 'student' || a.role === 'studentSecondary') && a.stage === 'act' && a.task.k === 'seat' && !a.named);
          if (seated.length > 0) {
            const a = seated[Math.floor(this.rt.next() * seated.length)];
            const rooms = BATHROOMS[a.level] ?? [];
            const room = rooms.length > 0 ? rooms[Math.floor(this.rt.next() * rooms.length)] : null;
            const to = room ? this.places.randomIn(room, () => this.rt.next(), 0.3) : null;
            if (to) this.begin(a, { k: 'errand', to });
          }
        }
      }
    }
  }

  // ============================================================ nivel adaptativo

  /** Fracción de la multitud activa (los personajes con nombre no cuentan). */
  setActiveFraction(f: number): void {
    const crowd = this.agents.filter((a) => !a.named).length;
    this.targetActive = Math.max(1, Math.round(crowd * clamp(f, 0.2, 1)));
  }

  /** Apaga o prende gente de a poco y SÓLO fuera de cuadro (nada aparece a la vista). */
  private applyAdaptive(): void {
    if (!Number.isFinite(this.targetActive)) return;
    const crowd = this.agents.filter((a) => !a.named);
    let active = crowd.filter((a) => !a.dormant).length;
    if (active > this.targetActive) {
      // Primero los de menor prioridad.
      const cands = crowd.filter((a) => !a.dormant && !a.visible && a.task.k !== 'post').sort((x, y) => x.priority - y.priority);
      for (const a of cands) {
        if (active <= this.targetActive) break;
        a.dormant = true;
        if (a.seat && this.seatOwner.get(a.seat.id) === a && !this.isHome(a, a.seat)) this.seatOwner.delete(a.seat.id);
        active--;
      }
    } else if (active < this.targetActive) {
      const cands = crowd.filter((a) => a.dormant).sort((x, y) => y.priority - x.priority);
      for (const a of cands) {
        if (active >= this.targetActive) break;
        a.dormant = false;
        a.unseen = 99;
        a.visible = false;
        active++;
      }
    }
  }

  // ======================================================= personajes con nombre

  spawnNamed(id: string, look: CharacterLook, at: NavPoint, facing?: number): Agent {
    const existing = this.named.get(id);
    if (existing) {
      this.teleport(existing, at.u, at.v, at.level, facing ?? existing.yaw);
      this.makeRoomFor(existing);
      return existing;
    }
    const a = this.makeAgent(id, look, null, true);
    this.named.set(id, a);
    a.task = { k: 'script' };
    a.stage = 'act';
    this.teleport(a, at.u, at.v, at.level, facing ?? 0);
    a.unseen = 99;
    this.makeRoomFor(a);
    return a;
  }

  character(id: string): Agent | null {
    return this.named.get(id) ?? null;
  }

  /** Camina hasta un punto; se resuelve al llegar (false si no hay camino o si otra orden lo interrumpe). */
  goTo(a: Agent, p: NavPoint, run = false): Promise<boolean> {
    a.resolve?.(false);
    a.resolve = null;
    this.standUpNow(a);
    return new Promise<boolean>((resolve) => {
      a.resolve = resolve;
      a.task = { k: 'script' };
      a.run = run;
      a.scriptAnim = 'idle';
      this.travelTo(a, p, null);
    });
  }

  /** Personaje: lo saca del asiento sin animación de levantarse (lo pide el director). */
  private standUpNow(a: Agent): void {
    if (a.seat) {
      const s = a.seat;
      if (this.seatOwner.get(s.id) === a) this.seatOwner.delete(s.id);
      a.u = s.au;
      a.v = s.av;
      a.y = this.floorAt(s.level, s.au, s.av);
      a.seat = null;
      a.sitT = 0;
    }
  }

  teleportNamed(a: Agent, p: NavPoint, facing?: number): void {
    a.resolve?.(false);
    a.resolve = null;
    this.standUpNow(a);
    a.task = { k: 'script' };
    a.stage = 'act';
    this.teleport(a, p.u, p.v, p.level, facing ?? a.yaw);
    setBase(a.anim, a.scriptAnim);
    a.anim.w = 1;
    this.makeRoomFor(a);
  }

  face(a: Agent, u: number, v: number): void {
    a.wantYaw = yawOfLocal(u - a.u, v - a.v);
  }

  /** Animación de un personaje: en bucle, o una vez y vuelve a 'idle'. */
  play(a: Agent, anim: NpcAnim, loop?: boolean): void {
    const once = loop === false || (loop === undefined && GESTURES.has(anim));
    if (GESTURES.has(anim) && once) {
      startGesture(a.anim, anim);
      return;
    }
    if (anim === 'sit') {
      // Sentarse donde está: en la silla más cercana si la hay, si no en el piso.
      const near = this.places.seats.find((s) => s.level === a.level && Math.hypot(s.u - a.u, s.v - a.v) < 0.7 && !this.seatOwner.has(s.id));
      if (near) {
        this.seatOwner.set(near.id, a);
        a.seat = near;
        a.task = { k: 'script' };
        a.stage = 'sitdown';
        a.sitT = 0;
        a.sitFrom = [a.u, a.v, a.y];
        this.prepareSit(a, near);
        a.scriptAnim = near.desk ? 'sitDesk' : 'sit';
        setBase(a.anim, a.scriptAnim);
        return;
      }
      a.seatY = a.y;
      a.scriptAnim = 'sitFloor';
    } else {
      a.scriptAnim = anim;
    }
    a.scriptOnce = once ? 3 : 0;
    if (a.stage === 'act') setBase(a.anim, a.scriptAnim);
  }

  /** Para pruebas y depuración: cuántos hacen cada tarea. */
  census(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.agents) {
      if (!a.alive) continue;
      const key = `${a.task.k}${a.stage === 'act' || a.stage === 'sitdown' ? '' : ':' + a.stage}`;
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }

  /** Ambiente en el que está cada uno (para pruebas). */
  roomOf(a: Agent): string {
    return roomAt(a.u, a.v, a.level)?.id ?? '';
  }
}
