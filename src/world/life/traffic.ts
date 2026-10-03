/**
 * Tránsito del barrio: autos, taxis, utilitarios, motos, bicis y la línea de
 * colectivo, andando por la red de `roadNet`.
 *
 * Datos puros (no importa nada del motor): se prueba sola en
 * `tests/lifeTraffic.test.ts`. Cada vehículo sigue al de adelante con el
 * modelo IDM (Intelligent Driver Model): acelera y frena suave, hace cola y
 * nunca se superpone. En las esquinas:
 *
 *  - Con semáforo (cruces de cuatro brazos): verde, amarillo y todo rojo,
 *    con desfasaje entre esquinas para que se formen pelotones.
 *  - Sin semáforo (T): quien llega por la calle que termina para y cede.
 *  - Siempre: el giro se reserva antes de entrar; dos giros que se cruzan no
 *    se ocupan a la vez, y quien espera hace rato tiene prioridad.
 *
 * La posición de un vehículo es la de su PARAGOLPES DELANTERO sobre el
 * recorrido: así la cola de un colectivo de 12 m no se mete en el cruce
 * mientras espera, y entra a la curva por la trompa, como uno de verdad.
 */
import {
  buildRoadNet,
  sampleAt,
  RUNOUT,
  ROAD_Y,
  ROADWAY_FRACTION,
  ZEBRA_HALF,
  type Path,
  type RoadNet,
  type RoadNode,
  type TurnKind,
} from './roadNet';
import { CROSS_AT, type CityPlan } from '../CityLayout';
import { Rng } from '../../utils/rng';

export type VehicleKind = 'hatch' | 'sedan' | 'taxi' | 'van' | 'bus' | 'moto' | 'bike';

export interface VehicleSpec {
  len: number;
  width: number;
  /** Velocidad deseada (m/s), mínimo y máximo. */
  v0: [number, number];
  /** IDM: aceleración máxima, frenada cómoda, tiempo de seguimiento y distancia mínima. */
  aMax: number;
  b: number;
  T: number;
  s0: number;
  /** Corrimiento lateral dentro del carril, hacia el cordón (bicis). */
  lateral: number;
  /** Radio de rueda (para que giren a la velocidad del vehículo). */
  wheelR: number;
  /**
   * Vehículo largo: los dos ejes (fracción del largo desde la trompa) van
   * sobre el recorrido y la caja sigue la cuerda entre ellos. Con el centro
   * sobre la curva, la cola de un colectivo barría 1,5 m de vereda al doblar.
   */
  axles?: [number, number];
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  hatch: {
    len: 3.95,
    width: 1.74,
    v0: [7, 9.5],
    aMax: 1.9,
    b: 2.6,
    T: 1.1,
    s0: 2.0,
    lateral: 0,
    wheelR: 0.3,
  },
  sedan: {
    len: 4.45,
    width: 1.78,
    v0: [7.5, 9.5],
    aMax: 1.8,
    b: 2.6,
    T: 1.1,
    s0: 2.0,
    lateral: 0,
    wheelR: 0.31,
  },
  taxi: {
    len: 4.45,
    width: 1.78,
    v0: [8.5, 10.5],
    aMax: 2.2,
    b: 2.8,
    T: 0.9,
    s0: 1.8,
    lateral: 0,
    wheelR: 0.31,
  },
  van: {
    len: 4.6,
    width: 1.86,
    v0: [7, 9],
    aMax: 1.4,
    b: 2.4,
    T: 1.2,
    s0: 2.2,
    lateral: 0,
    wheelR: 0.33,
  },
  bus: {
    len: 10.4,
    width: 2.5,
    v0: [7, 8],
    aMax: 1.0,
    b: 1.9,
    T: 1.4,
    s0: 2.6,
    lateral: -0.15,
    wheelR: 0.48,
    axles: [0.2, 0.83],
  },
  moto: {
    len: 2.0,
    width: 0.75,
    v0: [9, 11.5],
    aMax: 2.8,
    b: 3.2,
    T: 0.8,
    s0: 1.5,
    lateral: 0.35,
    wheelR: 0.3,
  },
  bike: {
    len: 1.75,
    width: 0.6,
    v0: [4.2, 5.6],
    aMax: 1.0,
    b: 2.0,
    T: 0.9,
    s0: 1.3,
    lateral: 0.95,
    wheelR: 0.34,
  },
};

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  spec: VehicleSpec;
  /** Número para elegir color y variantes (lo resuelve la vista). */
  paint: number;
  active: boolean;
  path: number;
  /** Recorridos anteriores (para ubicar la cola cuando la trompa ya dobló). */
  prev1: number;
  prev2: number;
  /** Distancia del paragolpes delantero sobre `path`. */
  s: number;
  v: number;
  acc: number;
  v0: number;
  /** Giro elegido al final del carril actual (−1: sale del barrio o no hay). */
  next: number;
  /** El giro `next` está reservado. */
  committed: boolean;
  /** Esquina y giro reservados todavía ocupados (se liberan al salir del cruce). */
  holdNode: number;
  holdTurn: number;
  waitT: number;
  stopHold: number;
  stopDone: boolean;
  /** Colectivo: sentido inicial sobre Laprida (1: hacia −x, −1: hacia +x); 0 no es colectivo. */
  route: 0 | 1 | -1;
  dwell: number;
  served: boolean;
  respawn: number;
  slot: number;
  // ---- pose para la vista (centro de la caja)
  x: number;
  z: number;
  yaw: number;
  yawRate: number;
  pitch: number;
  lean: number;
  wheel: number;
  pedal: number;
  brake: boolean;
}

export interface Viewer {
  x: number;
  /**
   * Altura de los ojos (mundo). Sin ella (o volando) el jugador no es un
   * obstáculo para el tránsito: sólo sirve para saber qué se ve.
   */
  y?: number;
  z: number;
  /** Mirada horizontal (unitaria o cero). */
  fx: number;
  fz: number;
}

export type TrafficEvent = 'busStop' | 'busGo' | 'horn';

export interface TrafficOptions {
  /** Perfil liviano (visor): menos vehículos. */
  lite?: boolean;
}

/** Ciclo del semáforo (s): verde, amarillo y todo rojo por eje. */
export const SIGNAL = { green: 12, amber: 2.5, allRed: 1.5 };
const HALF_CYCLE = SIGNAL.green + SIGNAL.amber + SIGNAL.allRed;
const CYCLE = HALF_CYCLE * 2;

export type Light = 'green' | 'amber' | 'red';

/**
 * Reloj de los semáforos, compartido: lo adelanta la simulación del tránsito
 * en cada paso y la gente de la vereda (`people/Sidewalks`) lo lee para
 * cruzar con el mismo ciclo que ven los autos y las luces. Con un reloj
 * propio cada uno, los cuadros lentos los iban desfasando.
 */
export const signalClock = { time: 0 };

/** Desfasaje del ciclo de una esquina (ondas verdes cortas entre esquinas vecinas). */
export function signalOffset(nodeX: number, nodeZ: number): number {
  return (Math.abs(nodeX) * 0.11 + Math.abs(nodeZ) * 0.07) % CYCLE;
}

/** Tiempo dentro del ciclo para quien circula por el eje `axis` (0 = empieza su verde). */
function phase(nodeX: number, nodeZ: number, axis: 'x' | 'z', time: number): number {
  const t = (time + signalOffset(nodeX, nodeZ)) % CYCLE;
  return axis === 'x' ? t : (t + HALF_CYCLE) % CYCLE;
}

/** Luz de una esquina con semáforo para quien circula por el eje dado. */
export function lightAt(
  nodeX: number,
  nodeZ: number,
  axis: 'x' | 'z',
  time = signalClock.time,
): Light {
  const local = phase(nodeX, nodeZ, axis, time);
  if (local < SIGNAL.green) return 'green';
  if (local < SIGNAL.green + SIGNAL.amber) return 'amber';
  return 'red';
}

/** Segundos de verde que le quedan al eje (0 si no está en verde). */
export function greenLeftAt(
  nodeX: number,
  nodeZ: number,
  axis: 'x' | 'z',
  time = signalClock.time,
): number {
  const local = phase(nodeX, nodeZ, axis, time);
  return local < SIGNAL.green ? SIGNAL.green - local : 0;
}

/** Aire entre la trompa y la primera franja de la cebra al ceder el paso. */
const ZEBRA_GAP = 0.6;
/**
 * Aire a cada lado de la caja que un auto le deja al jugador parado en la
 * calzada: si lo tiene más cerca que esto por delante, frena y espera.
 */
const PLAYER_CLEAR = 0.7;
/** Ojos a más de esto sobre el asfalto: el jugador vuela (vista aérea), no está en la calle. */
const PLAYER_EYE_MAX = 3.0;

/**
 * ¿Puede un peatón empezar a cruzar la calle que corre a lo largo de `axis`
 * en esa esquina? Con el rojo de esos autos y al menos 4 s de verde del otro
 * eje (lo mismo que muestra el muñequito: fijo mientras quedan más de 4 s y
 * titilando después). Así, quien arranca último termina de cruzar antes de
 * que esos autos vuelvan a tener verde.
 */
function walkWindow(nodeX: number, nodeZ: number, axis: 'x' | 'z', time: number): boolean {
  const local = phase(nodeX, nodeZ, axis, time);
  return local >= HALF_CYCLE && local < HALF_CYCLE + SIGNAL.green - 4;
}

/** Mezcla de vehículos: escritorio y visor. */
const FLEET: Record<'full' | 'lite', Array<[VehicleKind, number]>> = {
  full: [
    ['hatch', 15],
    ['sedan', 13],
    ['taxi', 8],
    ['van', 5],
    ['moto', 6],
    ['bike', 5],
  ],
  lite: [
    ['hatch', 10],
    ['sedan', 9],
    ['taxi', 5],
    ['van', 3],
    ['moto', 3],
    ['bike', 3],
  ],
};

/** Velocidad de paso por cada tipo de giro (m/s). */
const TURN_SPEED: Record<TurnKind, number> = { straight: 99, right: 3.8, left: 4.6, uturn: 2.6 };

export interface BusStop {
  path: number;
  /** Distancia (sobre el carril) donde queda la trompa del colectivo. */
  front: number;
  /** Poste de la parada, en el mundo (la vista lo dibuja). */
  x: number;
  z: number;
  /** Rumbo del carril. */
  hx: number;
  hz: number;
  /** El refugio ya está en el plano (`plan.props`): la vista no dibuja el poste. */
  sheltered: boolean;
}

/** Calzada de una calle: eje, medio ancho, de dónde a dónde existe y sus huecos. */
interface Roadway {
  x: boolean;
  at: number;
  half: number;
  a: number;
  b: number;
  gaps: Array<[number, number]>;
}

/** Tramo del recorrido del colectivo: una calle y su sentido. */
interface Leg {
  street: number;
  hx: number;
  hz: number;
}

interface Pose {
  x: number;
  z: number;
  hx: number;
  hz: number;
  seg: number;
}

export class TrafficSim {
  readonly net: RoadNet;
  readonly vehicles: Vehicle[] = [];
  readonly stops: BusStop[] = [];
  private readonly rng: Rng;
  private time = 0;
  /** Vehículos por recorrido, ordenados por `s` (se rearma cada paso). */
  private readonly onPath: number[][];
  /** Ocupantes de cada giro de cada esquina (ids de vehículos). */
  private readonly occupants: number[][][];
  /** Esperas con derecho a pasar de cada esquina (del paso anterior), en ternas planas: vehículo, índice de giro, segundos. */
  private waiters: number[][];
  private waitersNext: number[][];
  private readonly busStreet: number;
  /** Recorrido del colectivo: vuelta a la manzana de la escuela, siempre doblando a la izquierda. */
  private readonly route: Leg[];
  /** Carriles de la vuelta del colectivo (para ubicarlos al empezar). */
  private loopLanes: number[] = [];
  /** Parada sobre cada recorrido (o null). */
  private readonly stopOn: Array<BusStop | null>;
  /** Calles del borde del barrio (perimetrales). */
  private readonly outer: boolean[];
  private readonly pa: Pose = { x: 0, z: 0, hx: 0, hz: 1, seg: 0 };
  private readonly pb: Pose = { x: 0, z: 0, hx: 0, hz: 1, seg: 0 };
  private readonly pc: Pose = { x: 0, z: 0, hx: 0, hz: 1, seg: 0 };
  /** Para `pedestrianGo` (la consulta la gente, fuera del paso del tránsito). */
  private readonly pq: Pose = { x: 0, z: 0, hx: 0, hz: 1, seg: 0 };
  private onEvent?: (e: TrafficEvent, x: number, z: number) => void;
  private pedQuery: ((x: number, z: number, r: number) => boolean) | null = null;
  private zebraBusy: ((x: number, z: number, axis: 'x' | 'z') => boolean) | null = null;
  /**
   * Cebras de cada carril, por id de recorrido, en ternas (x, z, d): la del
   * brazo por el que llega (`zIn`: centro y cuánto antes del final del
   * carril se para el auto) y la del brazo por el que sale (`zOut`: centro y
   * dónde empieza la cebra, medido desde el comienzo del carril; suele ser
   * negativo, todavía dentro del giro). NaN si no hay cebra.
   */
  private readonly zIn: Float64Array;
  private readonly zOut: Float64Array;
  /** Carriles por los que ya entró alguien en este paso. */
  private readonly spawnedNow: number[] = [];
  /** Calzadas del plano: para saber si el jugador está en la calle o en la vereda. */
  private readonly roads: Roadway[];
  /** Jugador a pie sobre la calzada en este paso (NaN si no). */
  private playerX = NaN;
  private playerZ = NaN;

  constructor(plan: CityPlan, seed: number, opts: TrafficOptions = {}) {
    this.net = buildRoadNet(plan);
    this.rng = new Rng((seed ^ 0x7a3f11) >>> 0);
    const { paths, nodes } = this.net;
    this.onPath = paths.map(() => []);
    this.occupants = nodes.map((n) => n.turns.map(() => []));
    this.waiters = nodes.map(() => []);
    this.waitersNext = nodes.map(() => []);

    // Calles del borde: las que corren por donde terminan las demás.
    const ends = new Set<number>();
    for (const st of plan.streets) if (st.span) ends.add(st.span[0]).add(st.span[1]);
    this.outer = plan.streets.map((st) => [...ends].some((e) => Math.abs(e - st.at) < 0.5));
    const named = plan.streets.findIndex((s) => s.name === 'Laprida');
    this.busStreet = named >= 0 ? named : 0;
    this.route = this.buildRoute(plan);
    this.placeStops(plan);
    this.stopOn = this.net.paths.map((p) => this.stops.find((st) => st.path === p.id) ?? null);
    this.loopLanes = this.walkLoop();
    this.zIn = new Float64Array(paths.length * 3).fill(NaN);
    this.zOut = new Float64Array(paths.length * 3).fill(NaN);
    this.placeZebras();
    this.roads = plan.streets.map((st) => ({
      x: st.axis === 'x',
      at: st.at,
      half: (st.width * ROADWAY_FRACTION) / 2,
      // Los carriles salen RUNOUT metros afuera por los bordes del barrio.
      a: (st.span ? st.span[0] : -plan.extent) - RUNOUT,
      b: (st.span ? st.span[1] : plan.extent) + RUNOUT,
      gaps: st.gaps ?? [],
    }));

    const fleet = FLEET[opts.lite ? 'lite' : 'full'];
    for (const [kind, n] of fleet) for (let i = 0; i < n; i++) this.addVehicle(kind, 0);
    // Colectivos dando la vuelta a la escuela: uno cada ~30 s por la fachada.
    const buses = opts.lite ? 2 : 3;
    for (let i = 0; i < buses; i++) this.addVehicle('bus', i % 2 ? -1 : 1);
    this.placeInitial();
  }

  setOnEvent(cb: (e: TrafficEvent, x: number, z: number) => void): void {
    this.onEvent = cb;
  }

  /**
   * Gente cruzando: `fn(x, z, r)` dice si hay alguien a menos de `r` de ese
   * punto. Con esto, un auto no entra a la esquina (ni dobla sobre la senda)
   * mientras alguien cruza delante.
   */
  setPedestrianQuery(fn: ((x: number, z: number, r: number) => boolean) | null): void {
    this.pedQuery = fn;
  }

  /**
   * Gente del barrio en las sendas sin semáforo: `fn(x, z, axis)` dice si
   * alguien está sobre la cebra más cercana a (x, z) de la calle que corre
   * por `axis`, o a punto de bajar a ella. El auto que llega frena antes de
   * la cebra y espera; en las esquinas con semáforo manda la luz.
   */
  setZebraBusy(fn: ((x: number, z: number, axis: 'x' | 'z') => boolean) | null): void {
    this.zebraBusy = fn;
  }

  /**
   * ¿Puede la gente empezar a cruzar la calle que corre por `axis` en la
   * esquina más cercana a (x, z)? Con semáforo, en la ventana del muñequito
   * (ver `walkWindow`). Sin semáforo ceden los autos (`setZebraBusy`). En
   * las dos, el que ya está sobre la cebra o no llega a frenar antes no
   * cede: con ése a la vista se espera en el cordón (si no, la gente bajaba
   * y lo atravesaba).
   * (x, z) puede ser el centro de la esquina (se miran las dos cebras de esa
   * calle) o el de la cebra (sólo esa).
   */
  pedestrianGo(x: number, z: number, axis: 'x' | 'z'): boolean {
    let best: RoadNode | null = null;
    let bestD = 14 * 14;
    for (const n of this.net.nodes) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) return true;
    // Con semáforo, además de la ventana del muñequito: el que entró con
    // amarillo todavía está pasando por la senda cuando se abre.
    if (best.signal && !walkWindow(best.x, best.z, axis, this.time)) return false;
    const off = axis === 'x' ? x - best.x : z - best.z;
    for (let s = -1; s <= 1; s += 2) {
      if (Math.abs(off) > 3 && Math.sign(off) !== s) continue;
      if (this.vehicleOnZebra(best, axis, s)) return false;
    }
    return true;
  }

  /**
   * ¿Algún vehículo pisa la cebra del lado `s` de la esquina `n` (sobre la
   * calle que corre por `axis`), o la va a pisar sin poder frenar? Se recorre
   * la caja (de la cola a la trompa) y, si anda, lo que tiene por delante
   * sobre su recorrido: la frenada y, sin semáforo, un segundo y medio más
   * (lo que tarda en ver al peatón bajar). Quien no reservó la esquina no pasa de su línea
   * de detención (detrás de la cebra), así que su barrido termina ahí.
   */
  private vehicleOnZebra(n: RoadNode, axis: 'x' | 'z', s: number): boolean {
    const isX = axis === 'x';
    const cx = isX ? n.x + s * CROSS_AT : n.x;
    const cz = isX ? n.z : n.z + s * CROSS_AT;
    // Medio largo de la franja (a lo largo de la calle) y medio ancho de calzada.
    const ax = isX ? ZEBRA_HALF + 0.2 : n.halfZ + 0.3;
    const az = isX ? n.halfX + 0.3 : ZEBRA_HALF + 0.2;
    const { paths } = this.net;
    const q = this.pq;
    for (const v of this.vehicles) {
      if (!v.active) continue;
      const P = paths[v.path];
      // Con semáforo los que doblan ceden (ver `zebraYield`) y en verde pasa
      // un auto tras otro: se espera sólo al que no llega a frenar. Sin
      // semáforo, también al que no vería a tiempo al peatón bajar.
      let reach = v.v < 0.3 ? 0.5 : (n.signal ? 0 : v.v * 1.5) + (v.v * v.v) / 9 + 1;
      if (P.kind === 'lane' && P.endNode >= 0 && !v.committed)
        reach = Math.min(reach, P.length - P.stopBack - v.s);
      const r = v.spec.len + Math.max(0, reach) + 4;
      if (Math.abs(v.x - cx) > r || Math.abs(v.z - cz) > r) continue;
      // Se mira la línea media del recorrido: en marcha (y más al doblar, que
      // las esquinas de la caja barren hacia afuera) se suma el medio ancho y
      // el corrimiento de las bicis. Quieto en su línea, no: la trompa queda
      // a 25 cm de la franja y la gente no tiene por qué esperarlo.
      const w = v.v >= 0.3 || P.kind === 'turn' ? v.spec.width / 2 + Math.abs(v.spec.lateral) : 0;
      const span = v.spec.len + Math.max(0, reach);
      const steps = Math.ceil(span);
      for (let i = 0; i <= steps; i++) {
        const d = -v.spec.len + (span * i) / steps;
        if (d < 0) this.behind(v, -d, q);
        else this.ahead(v, d, q);
        if (Math.abs(q.x - cx) < ax + w && Math.abs(q.z - cz) < az + w) return true;
      }
    }
    return false;
  }

  /** Punto a distancia `d` por delante de la trompa, por el recorrido que va a hacer. */
  private ahead(v: Vehicle, d: number, out: Pose): void {
    const { paths } = this.net;
    const P = paths[v.path];
    let t = v.s + d;
    if (t <= P.length) {
      sampleAt(P, t, out);
      return;
    }
    t -= P.length;
    const T = P.kind === 'lane' ? (v.next >= 0 ? paths[v.next] : null) : paths[P.outLane];
    if (!T) {
      sampleAt(P, P.length, out);
      return;
    }
    if (t <= T.length || T.kind !== 'turn') {
      sampleAt(T, Math.min(t, T.length), out);
      return;
    }
    const O = paths[T.outLane];
    sampleAt(O, Math.min(t - T.length, O.length), out);
  }

  /** Estado del semáforo de una esquina para quien circula por el eje dado. */
  light(node: number, axis: 'x' | 'z'): Light {
    const n = this.net.nodes[node];
    return lightAt(n.x, n.z, axis, this.time);
  }

  /** Segundos que le quedan al verde del eje (para el titilar del peatón). */
  greenLeft(node: number, axis: 'x' | 'z'): number {
    const n = this.net.nodes[node];
    return greenLeftAt(n.x, n.z, axis, this.time);
  }

  // ------------------------------------------------------------- armado

  private addVehicle(kind: VehicleKind, route: 0 | 1 | -1): void {
    const spec = SPECS[kind];
    this.vehicles.push({
      id: this.vehicles.length,
      kind,
      spec,
      paint: this.rng.int(0, 1023),
      active: false,
      path: -1,
      prev1: -1,
      prev2: -1,
      s: 0,
      v: 0,
      acc: 0,
      v0: this.rng.range(spec.v0[0], spec.v0[1]),
      next: -1,
      committed: false,
      holdNode: -1,
      holdTurn: -1,
      waitT: 0,
      stopHold: 0,
      stopDone: false,
      route,
      dwell: 0,
      served: false,
      respawn: this.rng.range(0, 3),
      slot: 0,
      x: 0,
      z: 0,
      yaw: 0,
      yawRate: 0,
      pitch: 0,
      lean: 0,
      wheel: this.rng.range(0, 6.28),
      pedal: this.rng.range(0, 6.28),
      brake: false,
    });
  }

  /**
   * Recorrido del colectivo: da la vuelta a la escuela (Laprida hacia el este,
   * Gral. Acha al norte, Lafinur al oeste y la calle oeste al sur), siempre
   * doblando a la izquierda: un colectivo no entra en el radio chico de la
   * esquina a la derecha sin subirse a la vereda. Así pasa por la fachada
   * en cada vuelta y nunca se va lejos del jugador.
   */
  private buildRoute(plan: CityPlan): Leg[] {
    const pitch = plan.blockSize + plan.streetWidth;
    const find = (name: string) => plan.streets.findIndex((st) => st.name === name);
    const laprida = find('Laprida');
    const lafinur = find('Lafinur');
    const acha = find('Gral. Acha');
    const west = plan.streets.findIndex(
      (st) => st.axis === 'z' && Math.abs(st.at - pitch / 2) < 0.5,
    );
    if (laprida < 0 || lafinur < 0 || acha < 0 || west < 0) return [];
    const legs: Leg[] = [
      { street: laprida, hx: -1, hz: 0 },
      { street: acha, hx: 0, hz: -1 },
      { street: lafinur, hx: 1, hz: 0 },
      { street: west, hx: 0, hz: 1 },
    ];
    // El recorrido tiene que existir: cada tramo dobla al siguiente en alguna esquina.
    const { paths } = this.net;
    const ok = legs.every((leg, k) => {
      const nx = legs[(k + 1) % legs.length];
      return paths.some(
        (t) =>
          t.kind === 'turn' &&
          t.turn === 'left' &&
          paths[t.inLane].street === leg.street &&
          paths[t.inLane].hx === leg.hx &&
          paths[t.inLane].hz === leg.hz &&
          paths[t.outLane].street === nx.street &&
          paths[t.outLane].hx === nx.hx &&
          paths[t.outLane].hz === nx.hz,
      );
    });
    return ok ? legs : [];
  }

  /**
   * Recorre la vuelta del colectivo desde Laprida (la esquina donde dobla al
   * segundo tramo) y junta sus carriles. Laprida y Acha siguen más allá de
   * la vuelta: un colectivo ubicado ahí terminaría en la perimetral.
   */
  private walkLoop(): number[] {
    if (!this.route.length) return [];
    const { paths } = this.net;
    const probe = { route: 1 } as Vehicle;
    const start = paths.find(
      (p) =>
        p.kind === 'lane' &&
        this.legOf(p) === 0 &&
        p.turns.some((t) => {
          const o = paths[paths[t].outLane];
          return this.legOf(o) === 1;
        }),
    );
    if (!start) return [];
    const out: number[] = [];
    let lane = start;
    for (let k = 0; k < 40; k++) {
      out.push(lane.id);
      const t = this.chooseTurn(probe, lane);
      if (t < 0) return [];
      lane = paths[paths[t].outLane];
      if (lane.id === start.id) return out;
    }
    return [];
  }

  private legOf(lane: Path): number {
    return this.route.findIndex(
      (l) => l.street === lane.street && l.hx === lane.hx && l.hz === lane.hz,
    );
  }

  /**
   * Paradas: los refugios del plano (`plan.props`, los dibuja InfraBuilder)
   * sobre el recorrido; sin ellos, dos postes sobre Laprida, uno por mano,
   * al oeste del portón (frente al portón la parada tapaba la fachada).
   */
  private placeStops(plan: CityPlan): void {
    const { paths } = this.net;
    const props = (
      (plan as { props?: Array<{ kind: string; x: number; z: number; nx: number; nz: number }> })
        .props ?? []
    ).filter((pr) => pr.kind === 'busStop');
    const wanted: Array<{ x: number; z: number; hx: number; hz: number; sheltered: boolean }> =
      props.map((pr) => ({
        x: pr.x,
        z: pr.z,
        // El refugio mira a la calle (n): el carril que lo tiene a su derecha
        // va con rumbo (n.z, −n.x).
        hx: pr.nz,
        hz: -pr.nx,
        sheltered: true,
      }));
    if (!wanted.length) {
      const st = plan.streets[this.busStreet];
      if (st?.axis === 'x') {
        const off = this.net.half + 0.45;
        wanted.push(
          { x: 12, z: st.at - off, hx: 1, hz: 0, sheltered: false },
          { x: -2, z: st.at + off, hx: -1, hz: 0, sheltered: false },
        );
      }
    }
    for (const w of wanted) {
      // El carril de ese sentido más cercano al refugio.
      let best: Path | null = null;
      let bestD = 9;
      for (const lane of paths) {
        if (lane.kind !== 'lane' || lane.hx !== w.hx || lane.hz !== w.hz) continue;
        const isX = lane.axis === 'x';
        const across = isX ? Math.abs(lane.zs[0] - w.z) : Math.abs(lane.xs[0] - w.x);
        const a0 = isX ? Math.min(lane.xs[0], lane.xs[1]) : Math.min(lane.zs[0], lane.zs[1]);
        const a1 = isX ? Math.max(lane.xs[0], lane.xs[1]) : Math.max(lane.zs[0], lane.zs[1]);
        const along = isX ? w.x : w.z;
        if (along < a0 + 2 || along > a1 - 2 || across > bestD) continue;
        best = lane;
        bestD = across;
      }
      if (!best) continue;
      // La trompa queda 3 m pasando el refugio: la puerta delantera, frente a él.
      const isX = best.axis === 'x';
      const at = (isX ? w.x : w.z) + (isX ? w.hx : w.hz) * 3;
      const front = (at - (isX ? best.xs[0] : best.zs[0])) * (isX ? w.hx : w.hz);
      if (front < SPECS.bus.len + 1 || front > best.length - best.stopBack - 3) continue;
      this.stops.push({
        path: best.id,
        front,
        x: w.x,
        z: w.z,
        hx: w.hx,
        hz: w.hz,
        sheltered: w.sheltered,
      });
    }
  }

  /**
   * Cebras de cada carril (ver `zIn` / `zOut`): están a CROSS_AT del centro
   * de la esquina, en cada brazo, como las dibuja InfraBuilder.
   */
  private placeZebras(): void {
    const { paths, nodes } = this.net;
    const along = (P: Path, i: number) => (P.axis === 'x' ? P.xs[i] : P.zs[i]);
    for (const P of paths) {
      if (P.kind !== 'lane' || P.endNode < 0) continue;
      const n = nodes[P.endNode];
      const c = P.axis === 'x' ? n.x : n.z;
      const endFrom = Math.abs(c - along(P, P.xs.length - 1));
      const k = P.id * 3;
      this.zIn[k] = P.axis === 'x' ? n.x - P.hx * CROSS_AT : n.x;
      this.zIn[k + 1] = P.axis === 'x' ? n.z : n.z - P.hz * CROSS_AT;
      this.zIn[k + 2] = CROSS_AT + ZEBRA_HALF + ZEBRA_GAP - endFrom;
    }
    for (const T of paths) {
      if (T.kind !== 'turn' || T.node < 0) continue;
      const O = paths[T.outLane];
      const j = O.id * 3;
      if (!Number.isNaN(this.zOut[j])) continue;
      const n = nodes[T.node];
      const c = O.axis === 'x' ? n.x : n.z;
      const startFrom = Math.abs(along(O, 0) - c);
      this.zOut[j] = O.axis === 'x' ? n.x + O.hx * CROSS_AT : n.x;
      this.zOut[j + 1] = O.axis === 'x' ? n.z : n.z + O.hz * CROSS_AT;
      this.zOut[j + 2] = CROSS_AT - ZEBRA_HALF - ZEBRA_GAP - startFrom;
    }
  }

  /**
   * Distancia hasta donde hay que pararse para ceder el paso en una senda
   * sin semáforo (Infinity si no hace falta). La cebra del brazo por el que
   * llega se respeta sólo si todavía le da para frenar sin clavarse (quien ya
   * la está pisando sigue); la del brazo por el que sale, sin reservar el
   * giro se espera en la línea, y ya adentro del cruce, antes de la cebra.
   */
  private zebraYield(v: Vehicle, P: Path): number {
    const fn = this.zebraBusy!;
    const { paths, nodes } = this.net;
    const zi = this.zIn;
    const zo = this.zOut;
    const brake = (v.v * v.v) / (2 * 4.5) - 0.5;
    let best = Infinity;
    if (P.kind === 'lane') {
      if (P.endNode < 0 || nodes[P.endNode].signal) return best;
      const dLine = P.length - v.s;
      if (dLine > 26) return best;
      const k = P.id * 3;
      const dz = dLine - zi[k + 2];
      if (dz > -ZEBRA_GAP && dz > brake && fn(zi[k], zi[k + 1], P.axis)) best = dz;
      if (v.next >= 0) {
        const T = paths[v.next];
        const O = paths[T.outLane];
        const j = O.id * 3;
        const d = dLine + T.length + zo[j + 2];
        if (!Number.isNaN(zo[j]) && d > brake && fn(zo[j], zo[j + 1], O.axis)) {
          const wait = v.committed ? d : dz > -ZEBRA_GAP ? dz : dLine - P.stopBack;
          best = Math.min(best, wait);
        }
      }
    } else if (P.kind === 'turn') {
      if (P.node < 0) return best;
      const O = paths[P.outLane];
      const j = O.id * 3;
      const d = P.length - v.s + zo[j + 2];
      if (Number.isNaN(zo[j]) || d <= -0.3) return best;
      const node = nodes[P.node];
      // Con semáforo, la gente cruza la calle a la que se dobla justo cuando
      // el que dobla tiene verde: mirar sólo al reservar la esquina no
      // alcanzaba (quien bajaba después caminaba a través del auto). Se cede
      // a cualquiera que esté cruzando esa senda o por pisarla.
      const busy = node.signal
        ? this.pedQuery !== null &&
          this.pedQuery(zo[j], zo[j + 1], (O.axis === 'x' ? node.halfX : node.halfZ) + 0.6)
        : fn(zo[j], zo[j + 1], O.axis);
      if (busy) best = d;
    }
    return best;
  }

  /** Reparte la flota a lo largo de los carriles, sin superponer ni meter a nadie en una esquina. */
  private placeInitial(): void {
    const lanes = this.net.paths.filter(
      (p) => p.kind === 'lane' && p.length > 16 && p.startKind !== 'portal',
    );
    const total = lanes.reduce((a, p) => a + p.length, 0);
    for (const v of this.vehicles) {
      for (let tries = 0; tries < 80; tries++) {
        let lane: Path;
        if (v.route !== 0) {
          // Sobre el recorrido (o, sin él, sobre Laprida), en tramos distintos.
          const opts = lanes.filter((p) =>
            this.loopLanes.length
              ? this.loopLanes.includes(p.id)
              : p.street === this.busStreet && p.hx === -v.route,
          );
          if (!opts.length) break;
          lane =
            opts[
              (this.rng.int(0, opts.length - 1) + (v.route > 0 ? 0 : opts.length >> 1)) %
                opts.length
            ];
        } else {
          let r = this.rng.next() * total;
          lane = lanes[lanes.length - 1];
          for (const p of lanes) {
            r -= p.length;
            if (r <= 0) {
              lane = p;
              break;
            }
          }
        }
        // Lejos del final del carril: no arrancar en medio de un cruce.
        const lo = v.spec.len + 0.5;
        const hi = lane.length - 10;
        if (hi <= lo) continue;
        const s = this.rng.range(lo, hi);
        const clash = this.vehicles.some(
          (o) =>
            o !== v &&
            o.active &&
            o.path === lane.id &&
            s > o.s - o.spec.len - 7 &&
            s - v.spec.len < o.s + 7,
        );
        if (clash) continue;
        this.enterLane(v, lane.id, s);
        v.prev1 = v.prev2 = -1;
        v.v = v.v0 * this.rng.range(0.4, 0.9);
        v.active = true;
        break;
      }
    }
    // Pose inicial: sin esto el primer cuadro dibujaría todo en el origen.
    for (const v of this.vehicles) if (v.active) this.updatePose(v, 0);
  }

  private enterLane(v: Vehicle, lane: number, s: number): void {
    v.path = lane;
    v.s = s;
    v.committed = false;
    v.stopDone = false;
    v.stopHold = 0;
    v.waitT = 0;
    const p = this.net.paths[lane];
    v.next = this.chooseTurn(v, p);
    v.served = v.route === 0 || !this.stops.some((st) => st.path === p.id);
  }

  private chooseTurn(v: Vehicle, lane: Path): number {
    if (!lane.turns.length) return -1;
    const paths = this.net.paths;
    if (v.route !== 0) {
      // Colectivo sobre su recorrido: en la esquina del tramo siguiente,
      // dobla a la izquierda; si no, sigue derecho.
      const k = this.legOf(lane);
      if (k >= 0) {
        const nx = this.route[(k + 1) % this.route.length];
        const turn = lane.turns.find((t) => {
          const o = paths[paths[t].outLane];
          return o.street === nx.street && o.hx === nx.hx && o.hz === nx.hz;
        });
        if (turn !== undefined) return turn;
      }
      const straight = lane.turns.find((t) => paths[t].turn === 'straight');
      if (straight !== undefined) return straight;
      const left = lane.turns.find((t) => paths[t].turn === 'left');
      return left ?? lane.turns[0];
    }
    let total = 0;
    for (const t of lane.turns) total += this.weight(lane, paths[t]);
    let r = this.rng.next() * total;
    for (const t of lane.turns) {
      r -= this.weight(lane, paths[t]);
      if (r <= 0) return t;
    }
    return lane.turns[lane.turns.length - 1];
  }

  /**
   * Peso de un giro: derecho es lo más común; y el tránsito se queda cerca
   * de la escuela (donde está el jugador): salir a la calle perimetral es
   * poco probable y volver de ella, muy probable.
   */
  private weight(lane: Path, t: Path): number {
    const out = this.net.paths[t.outLane];
    let w = turnWeight(t.turn);
    const fromOuter = this.outer[lane.street];
    const toOuter = this.outer[out.street];
    if (toOuter && !fromOuter) w *= 0.12;
    else if (fromOuter && !toOuter) w *= 4;
    return w;
  }

  // ------------------------------------------------------------- paso

  /**
   * Avanza la simulación. `viewer` es el jugador: sólo se usa para que los
   * autos entren y salgan del barrio donde no se los ve.
   */
  step(dt: number, viewer: Viewer): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    signalClock.time = this.time;
    const veh = this.vehicles;

    // Listas por recorrido, ordenadas por s.
    for (const l of this.onPath) l.length = 0;
    for (const v of veh) if (v.active) this.onPath[v.path].push(v.id);
    for (const l of this.onPath) {
      if (l.length === 1) veh[l[0]].slot = 0;
      if (l.length < 2) continue;
      for (let i = 1; i < l.length; i++) {
        const id = l[i];
        const s = veh[id].s;
        let j = i - 1;
        while (j >= 0 && veh[l[j]].s > s) {
          l[j + 1] = l[j];
          j--;
        }
        l[j + 1] = id;
      }
      for (let i = 0; i < l.length; i++) veh[l[i]].slot = i;
    }
    const swap = this.waiters;
    this.waiters = this.waitersNext;
    this.waitersNext = swap;
    for (const w of this.waitersNext) w.length = 0;
    this.spawnedNow.length = 0;
    // El jugador a pie en la calzada es un obstáculo (ver `drive`); en la
    // vereda o volando, no.
    const onFoot =
      viewer.y !== undefined &&
      viewer.y - ROAD_Y < PLAYER_EYE_MAX &&
      this.onRoadway(viewer.x, viewer.z);
    this.playerX = onFoot ? viewer.x : NaN;
    this.playerZ = onFoot ? viewer.z : NaN;

    for (const v of veh) {
      if (!v.active) {
        v.respawn -= dt;
        if (v.respawn <= 0) this.trySpawn(v, viewer);
        continue;
      }
      this.drive(v, dt, viewer);
    }
  }

  private drive(v: Vehicle, dt: number, viewer: Viewer): void {
    const { paths, nodes } = this.net;
    const P = paths[v.path];
    const spec = v.spec;
    let v0 = v.v0;
    let gap = Infinity;
    let vl = 0;
    /** El obstáculo es una línea de detención (no un vehículo): se arrima más. */
    let atLine = false;

    // --- el de adelante (gap: de mi trompa a su cola)
    const list = this.onPath[v.path];
    if (v.slot + 1 < list.length) {
      const L = this.vehicles[list[v.slot + 1]];
      // Las listas se arman al empezar el paso: si el de adelante ya pasó al
      // recorrido siguiente en este mismo paso, su `s` es de ese recorrido.
      // Sin esto el gap daba negativo y el de atrás clavaba los frenos de
      // 8 m/s a cero en un cuadro, a veces sobre la senda.
      gap = L.path === v.path ? L.s - L.spec.len - v.s : P.length - v.s + L.s - L.spec.len;
      vl = L.v;
    } else {
      const dist = P.length - v.s;
      if (P.kind === 'lane') {
        // Los que ya entraron al cruce desde este mismo carril siguen adelante.
        for (const t of P.turns) {
          const l = this.onPath[t];
          if (!l.length) continue;
          const L = this.vehicles[l[0]];
          // (Si en este paso ya salió del giro, su `s` es del carril de salida.)
          const g = dist + (L.path === t ? 0 : paths[t].length) + L.s - L.spec.len;
          if (g < gap) {
            gap = g;
            vl = L.v;
          }
        }
        if (gap === Infinity && v.committed && v.next >= 0) {
          const T = paths[v.next];
          const l = this.onPath[T.outLane];
          if (l.length) {
            const L = this.vehicles[l[0]];
            gap = dist + T.length + L.s - L.spec.len;
            vl = L.v;
          }
        }
      } else {
        const l = this.onPath[P.outLane];
        if (l.length) {
          const L = this.vehicles[l[0]];
          gap = dist + L.s - L.spec.len;
          vl = L.v;
        }
      }
    }

    // --- esquina por delante
    if (P.kind === 'lane' && P.endNode < 0 && v.next >= 0) v.committed = true; // fondo de calle: vuelta en U
    if (P.kind === 'lane' && P.endNode >= 0 && v.next >= 0) {
      const node = nodes[P.endNode];
      const T = paths[v.next];
      const dLine = P.length - v.s;
      // Línea de detención (retirada en los cruces con semáforo, ver stopBack).
      const dStop = dLine - P.stopBack;
      // Aflojar antes de doblar: la velocidad permitida crece con la distancia.
      const vt = TURN_SPEED[T.turn];
      if (vt < v0) v0 = Math.min(v0, Math.sqrt(vt * vt + 2 * 1.4 * Math.max(0, dLine)));
      // Reservó en verde pero quedó lejos (lo frenó el de adelante) y ahora
      // cambió: si puede frenar, frena y suelta la esquina.
      if (
        v.committed &&
        node.signal &&
        this.light(node.id, P.axis) !== 'green' &&
        dStop > (v.v * v.v) / (2 * 3.5) + 0.2
      ) {
        const list = this.occupants[node.id][node.turns.indexOf(v.next)];
        const i = list.indexOf(v.id);
        if (i >= 0) list.splice(i, 1);
        v.committed = false;
      }
      if (!v.committed) {
        let ok = true;
        if (node.signal) {
          const light = this.light(node.id, P.axis);
          if (light === 'red') ok = false;
          else if (light === 'amber' && dStop > (v.v * v.v) / (2 * 3.5) + 0.2) ok = false;
        }
        if (P.mustStop && !v.stopDone) {
          if (v.v < 0.35 && dStop < 2.2) {
            v.stopHold += dt;
            if (v.stopHold > 0.8) v.stopDone = true;
          }
          if (!v.stopDone) ok = false;
        }
        const ti = node.turns.indexOf(v.next);
        // Sólo reserva el primero de la fila: si no, el de atrás ocuparía el
        // cruce mientras espera al de adelante.
        const first = v.slot === list.length - 1;
        if (first && dStop < (v.v * v.v) / (2 * 2.2) + 8) {
          if (ok && this.canCommit(v, node.id, ti)) {
            v.committed = true;
            this.occupants[node.id][ti].push(v.id);
            v.waitT = 0;
          } else {
            v.waitT += dt;
            // Sólo cuenta la espera con derecho a pasar (no un semáforo en rojo).
            if (ok) this.waitersNext[node.id].push(v.id, ti, v.waitT);
            // Bocinazo porteño: alguien espera de más con el semáforo en verde.
            if (v.waitT > 7 && ok && v.kind !== 'bike' && this.rng.next() < dt * 0.04)
              this.onEvent?.('horn', v.x, v.z);
          }
        }
        if (!v.committed && dStop < gap) {
          gap = dStop;
          vl = 0;
          atLine = true;
        }
      }
    }
    if (P.kind === 'turn') {
      const vt = TURN_SPEED[P.turn];
      if (vt < v0) v0 = vt + Math.min(3, (v.s / P.length) * 3);
    }

    // --- el jugador parado en la calzada: se lo trata como un peatón que no
    // se corre. El auto frena antes (o no arranca si ya lo tiene encima): en
    // el visor, un auto que atraviesa al jugador se ve por dentro (sin caras
    // traseras) y deja ver la parrilla del de atrás. Un producto escalar por
    // vehículo y sólo con el jugador en la calle.
    if (!Number.isNaN(this.playerX)) {
      const dx = this.playerX - v.x;
      const dz = this.playerZ - v.z;
      if (dx * dx + dz * dz < 40 * 40) {
        const hx = Math.sin(v.yaw);
        const hz = Math.cos(v.yaw);
        // Desde la trompa hacia adelante (negativo: el jugador está dentro de la caja).
        const along = dx * hx + dz * hz - spec.len / 2;
        const lat = Math.abs(dx * hz - dz * hx);
        if (lat < spec.width / 2 + PLAYER_CLEAR && along > -spec.len && along < 35) {
          const g = Math.max(0, along - 1.2);
          if (g < gap) {
            gap = g;
            vl = 0;
            atLine = true;
          }
        }
      }
    }

    // --- sendas sin semáforo: se cede el paso a quien cruza o está por bajar
    if (this.zebraBusy) {
      const dz = this.zebraYield(v, P);
      if (dz < gap) {
        gap = Math.max(0.01, dz);
        vl = 0;
        atLine = true;
      }
    }

    // --- parada del colectivo
    if (v.route !== 0 && !v.served) {
      const stop = this.stopOn[v.path];
      if (stop) {
        if (v.dwell > 0) {
          v.dwell -= dt;
          gap = 0.01;
          vl = 0;
          atLine = true;
          if (v.dwell <= 0) {
            v.served = true;
            this.onEvent?.('busGo', v.x, v.z);
          }
        } else {
          const d = stop.front - v.s;
          if (d < gap) {
            gap = Math.max(0.01, d);
            vl = 0;
            atLine = true;
          }
          if (d < 1.2 && v.v < 0.25) {
            v.dwell = this.rng.range(6, 10);
            this.onEvent?.('busStop', v.x, v.z);
          }
        }
      }
    }

    // --- IDM
    const vv = v.v / Math.max(0.5, v0);
    let acc = spec.aMax * (1 - vv * vv * vv * vv);
    if (gap < 200) {
      const sStar =
        spec.s0 * (atLine ? 0.25 : 1) +
        Math.max(0, v.v * spec.T + (v.v * (v.v - vl)) / (2 * Math.sqrt(spec.aMax * spec.b)));
      const r = sStar / Math.max(gap, 0.15);
      acc -= spec.aMax * r * r;
    }
    acc = Math.max(-7, Math.min(spec.aMax, acc));
    v.acc += (acc - v.acc) * Math.min(1, dt * 6);
    v.v = Math.max(0, v.v + acc * dt);
    let ds = v.v * dt;
    // Nunca superponerse: si el paso se come la distancia, se queda corto.
    if (gap < 200 && ds > gap - 0.25) {
      ds = Math.max(0, gap - 0.25);
      v.v = Math.min(v.v, vl, ds / dt);
    }
    v.brake = acc < -0.7 || (v.v < 0.3 && gap < 6);
    v.s += ds;
    v.wheel = (v.wheel + ds / spec.wheelR) % (Math.PI * 2);
    v.pedal = (v.pedal + ds / 0.62) % (Math.PI * 2);

    // --- cambio de recorrido (cuando la trompa pasa el final)
    let guard = 0;
    while (v.s > paths[v.path].length && guard++ < 4) {
      const cur = paths[v.path];
      if (cur.kind === 'lane') {
        if (cur.endKind === 'portal' || v.next < 0) {
          this.despawn(v);
          return;
        }
        if (!v.committed) {
          v.s = cur.length;
          v.v = 0;
          break;
        }
        v.s -= cur.length;
        if (cur.endNode >= 0) {
          v.holdNode = cur.endNode;
          v.holdTurn = nodes[cur.endNode].turns.indexOf(v.next);
        }
        v.prev2 = v.prev1;
        v.prev1 = v.path;
        v.path = v.next;
      } else {
        v.prev2 = v.prev1;
        v.prev1 = v.path;
        this.enterLane(v, cur.outLane, v.s - cur.length);
      }
    }
    // Liberar la esquina cuando la cola salió del cruce.
    if (v.holdNode >= 0 && paths[v.path].kind === 'lane' && v.s - spec.len > 0.4) this.release(v);

    // Salida del barrio: se va apenas deja de verse.
    const cur = paths[v.path];
    if (
      cur.kind === 'lane' &&
      cur.endKind === 'portal' &&
      v.s - spec.len / 2 > cur.length - RUNOUT &&
      !this.sees(viewer, v.x, v.z)
    ) {
      this.despawn(v);
      return;
    }
    this.updatePose(v, dt);
  }

  private canCommit(v: Vehicle, node: number, ti: number): boolean {
    const n = this.net.nodes[node];
    const occ = this.occupants[node];
    const wide = v.kind === 'bus';
    const conf = n.conflicts[ti];
    const confWide = n.conflictsWide[ti];
    for (let j = 0; j < occ.length; j++) {
      if (j === ti || !occ[j].length) continue;
      if (conf[j]) return false;
      if (confWide[j] && (wide || occ[j].some((id) => this.vehicles[id].kind === 'bus')))
        return false;
    }
    // Ceder a quien espera hace rato con un giro que se cruza.
    const ws = this.waiters[node];
    for (let k = 0; k < ws.length; k += 3) {
      const id = ws[k];
      const tj = ws[k + 1];
      const w = ws[k + 2];
      if (id === v.id || tj === ti || !conf[tj]) continue;
      if (w > 3 && w > v.waitT + 1.5) return false;
    }
    // Lugar del otro lado: no quedar trabado en medio del cruce ni con la
    // cola sobre la senda de salida (la gente le pasaba a través). zOut da
    // dónde empieza esa cebra en el carril de salida (más el aire de cesión).
    const { paths } = this.net;
    const T = paths[n.turns[ti]];
    const zo = this.zOut[T.outLane * 3 + 2];
    const clear = Number.isNaN(zo) ? 3 : Math.max(3, zo + 2 * ZEBRA_HALF + ZEBRA_GAP + 2.5);
    let need = v.spec.len + clear;
    for (let j = 0; j < occ.length; j++) {
      if (paths[n.turns[j]].outLane !== T.outLane) continue;
      for (const id of occ[j]) need += this.vehicles[id].spec.len + 2.5;
    }
    const out = this.onPath[T.outLane];
    const room = out.length
      ? this.vehicles[out[0]].s - this.vehicles[out[0]].spec.len
      : paths[T.outLane].length;
    if (room < need) return false;
    return !this.pedQuery || !this.pedestrianAhead(paths[v.path], T);
  }

  /**
   * ¿Hay alguien cruzando por donde va a pasar? Se mira el tramo entre la
   * línea de detención y el cruce, el giro y los primeros metros del carril
   * de salida (ahí están las sendas).
   */
  private pedestrianAhead(lane: Path, T: Path): boolean {
    const q = this.pedQuery!;
    const pose = this.pc;
    for (let d = lane.length - lane.stopBack; d < lane.length; d += 1.5) {
      sampleAt(lane, d, pose);
      if (q(pose.x, pose.z, 1.7)) return true;
    }
    for (let i = 0; i < T.xs.length; i += 2) if (q(T.xs[i], T.zs[i], 1.7)) return true;
    const out = this.net.paths[T.outLane];
    for (let d = 0; d < Math.min(9, out.length); d += 1.5) {
      sampleAt(out, d, pose);
      if (q(pose.x, pose.z, 1.7)) return true;
    }
    return false;
  }

  private release(v: Vehicle): void {
    const list = this.occupants[v.holdNode]?.[v.holdTurn];
    if (list) {
      const i = list.indexOf(v.id);
      if (i >= 0) list.splice(i, 1);
    }
    v.holdNode = -1;
    v.holdTurn = -1;
  }

  private despawn(v: Vehicle): void {
    if (v.holdNode >= 0) this.release(v);
    const P = this.net.paths[v.path];
    if (v.committed && v.next >= 0 && P.kind === 'lane' && P.endNode >= 0) {
      const n = this.net.nodes[P.endNode];
      const list = this.occupants[n.id][n.turns.indexOf(v.next)];
      const i = list.indexOf(v.id);
      if (i >= 0) list.splice(i, 1);
    }
    v.active = false;
    v.committed = false;
    v.respawn = v.route !== 0 ? this.rng.range(8, 20) : this.rng.range(0.5, 4);
  }

  /** Entra por un borde del barrio, si hay lugar y, a ser posible, donde no se ve. */
  private trySpawn(v: Vehicle, viewer: Viewer): void {
    const { paths, entries } = this.net;
    if (!entries.length) return;
    const options =
      v.route !== 0 ? entries.filter((e) => paths[e].street === this.busStreet) : entries;
    if (!options.length) return;
    const lane = paths[options[this.rng.int(0, options.length - 1)]];
    sampleAt(lane, RUNOUT, this.pa);
    const hidden = !this.sees(viewer, this.pa.x, this.pa.z);
    const s = (hidden ? RUNOUT : 0) + v.spec.len;
    const l = this.onPath[lane.id];
    const first = l.length ? this.vehicles[l[0]] : null;
    // Las listas se arman al principio del paso: dos que entran por el mismo
    // borde en el mismo cuadro no se verían entre sí.
    if ((first && first.s - first.spec.len < s + 8) || this.spawnedNow.includes(lane.id)) {
      v.respawn = 0.5;
      return;
    }
    if (v.route !== 0) v.route = lane.hx > 0 ? -1 : 1;
    this.spawnedNow.push(lane.id);
    this.enterLane(v, lane.id, s);
    v.prev1 = v.prev2 = -1;
    v.v = v.v0 * 0.8;
    v.active = true;
    v.acc = 0;
    this.updatePose(v, 0);
  }

  /** ¿(x, z) está sobre alguna calzada (o en un cruce)? */
  private onRoadway(x: number, z: number): boolean {
    for (const r of this.roads) {
      const across = r.x ? z : x;
      if (Math.abs(across - r.at) > r.half) continue;
      const along = r.x ? x : z;
      if (along < r.a || along > r.b) continue;
      let gap = false;
      for (const g of r.gaps) if (along > g[0] && along < g[1]) gap = true;
      if (!gap) return true;
    }
    return false;
  }

  /** ¿El jugador ve este punto? Cerca o dentro de un cono de ±65°. */
  private sees(viewer: Viewer, x: number, z: number): boolean {
    const dx = x - viewer.x;
    const dz = z - viewer.z;
    const d = len2(dx, dz);
    if (d > 140) return false;
    if (d < 25) return true;
    return (dx * viewer.fx + dz * viewer.fz) / d > 0.38;
  }

  /** Punto a distancia `d` de la trompa, hacia atrás, por los recorridos ya hechos. */
  private behind(v: Vehicle, d: number, out: Pose): void {
    const { paths } = this.net;
    let t = v.s - d;
    if (t >= 0 || v.prev1 < 0) {
      sampleAt(paths[v.path], Math.max(0, t), out);
      return;
    }
    const p1 = paths[v.prev1];
    t += p1.length;
    if (t >= 0 || v.prev2 < 0) {
      sampleAt(p1, Math.max(0, t), out);
      return;
    }
    const p2 = paths[v.prev2];
    sampleAt(p2, Math.max(0, t + p2.length), out);
  }

  private updatePose(v: Vehicle, dt: number): void {
    const len = v.spec.len;
    const axles = v.spec.axles;
    // Autos: centro sobre el recorrido y rumbo por la cuerda de la mitad del
    // cuerpo (en una curva es la tangente en el centro, sin saltos de tramo a
    // tramo). Colectivo: ejes sobre el recorrido (ver `axles`).
    this.behind(v, axles ? len * axles[0] : len * 0.25, this.pa);
    this.behind(v, axles ? len * axles[1] : len * 0.75, this.pb);
    if (!axles) this.behind(v, len / 2, this.pc);
    let hx = this.pa.x - this.pb.x;
    let hz = this.pa.z - this.pb.z;
    const hl = len2(hx, hz);
    if (hl > 1e-4) {
      hx /= hl;
      hz /= hl;
    } else {
      hx = this.pa.hx;
      hz = this.pa.hz;
    }
    if (axles) {
      // Centro de la caja: medio largo detrás de la trompa, sobre la cuerda.
      const back = len * (0.5 - axles[0]);
      this.pc.x = this.pa.x - hx * back;
      this.pc.z = this.pa.z - hz * back;
    }
    // Lateral: corrido hacia el cordón (derecha del rumbo: (hz, −hx)).
    const lat = v.spec.lateral;
    v.x = this.pc.x + hz * lat;
    v.z = this.pc.z - hx * lat;
    const target = Math.atan2(hx, hz);
    if (dt <= 0) {
      v.yaw = target;
      v.yawRate = 0;
      return;
    }
    let d = target - v.yaw;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    v.yaw += d;
    v.yawRate += (d / dt - v.yawRate) * Math.min(1, dt * 5);
    // Cabeceo: la trompa baja al frenar y sube al acelerar (muy poco).
    v.pitch += (-v.acc * 0.006 - v.pitch) * Math.min(1, dt * 4);
    // Motos y bicis se inclinan en las curvas.
    const lean = Math.max(-0.45, Math.min(0.45, Math.atan((v.v * v.yawRate) / 9.8)));
    v.lean += (lean - v.lean) * Math.min(1, dt * 4);
  }

  // ------------------------------------------------------------- consultas

  /** Vehículos activos (cantidad). */
  get activeCount(): number {
    let n = 0;
    for (const v of this.vehicles) if (v.active) n++;
    return n;
  }

  /** Lo más cercano a un punto (para el sonido del tránsito): distancia, velocidad y cuántos hay a 20 m. */
  nearest(x: number, z: number): { distance: number; speed: number; count20: number } {
    let best = Infinity;
    let speed = 0;
    let count = 0;
    for (const v of this.vehicles) {
      if (!v.active) continue;
      const d = len2(v.x - x, v.z - z);
      if (d < 20) count++;
      if (d < best) {
        best = d;
        speed = v.v;
      }
    }
    return { distance: best, speed, count20: count };
  }
}

function turnWeight(t: TurnKind): number {
  return t === 'straight' ? 0.56 : t === 'right' ? 0.24 : t === 'left' ? 0.2 : 1;
}

/** Largo de (a, b): Math.hypot es varias veces más lento y esto corre cada cuadro. */
function len2(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}
