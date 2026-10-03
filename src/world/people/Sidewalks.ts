import type { NpcRole, SchoolPhase } from '../../game/contracts';
import { Rng } from '../../utils/rng';
import { CROSS_AT, KERB_W, LANE_FRAC, RAMP_LEN, SIDEWALK_H, type CityPlan, type Street } from '../CityLayout';
import { SIGNAL } from '../life/traffic';
import { setBase, startGesture, tickAnim, type AnimId } from './Anim';
import { bodyDims, hexRgb, makeAppearance, type Appearance } from './Looks';
import { Agent } from './Sim';

/**
 * La gente del barrio: peatones en las veredas de las calles que rodean la
 * escuela (Laprida, Lafinur, Gral. Acha y las dos transversales), sin motor.
 *
 * La multitud de la escuela (`PeopleSim`) camina por una grilla con A*; acá
 * no hace falta: una vereda es un carril. Cada manzana del barrio es una
 * VUELTA (rectángulo a una distancia fija del borde de la manzana) y cada
 * senda peatonal une el lado de una vuelta con el lado de la vuelta de
 * enfrente. Quien camina avanza por su lado, dobla en la esquina, a veces
 * cruza (sólo por las sendas, y en los cruces con semáforo, con el rojo de
 * los autos) y a veces pega la vuelta. Cuesta lo mismo que mover un punto.
 *
 * - Dos carriles por vereda según el sentido de giro alrededor de la manzana
 *   (horario más cerca de la fachada, antihorario más cerca del cordón): dos
 *   personas que vienen de frente nunca están en el mismo carril. Entre los
 *   alcorques (24 m del centro) y las mesas de los cafés queda ~1 m libre.
 * - Las parejas caminan lado a lado (el acompañante sigue al que decide).
 * - Parados: charlas de dos o tres frente a una vidriera, gente en las
 *   paradas de colectivo (sentada en el banco o esperando de pie) y alguien
 *   comprando en el kiosco. Quien camina se corre al pasar.
 * - En la entrada y la salida, chicos de guardapolvo o uniforme con su
 *   mamá o su papá; en el resto del día el chico "llega" y queda sólo el
 *   adulto (el cambio ocurre siempre fuera de cuadro).
 *
 * La vereda de Laprida del lado de la escuela es de `PeopleSim` (los que
 * llegan y se van por el portón, y sus paseantes): acá no se usa.
 *
 * Coordenadas: mundo (x, z). Cada `Agent` lleva también (u, v) locales de la
 * escuela, que es lo que lee el render de `Population`.
 */

const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/**
 * Senda peatonal: a 6,2 m del eje de la esquina, 2,6 m de ancho. Calzada:
 * 0,42 del ancho de calle; cordón de 32 cm; rampa de 1,3 m. Las medidas son
 * las de `CityLayout` (las mismas que pinta InfraBuilder).
 */
export { CROSS_AT };
export const CROSS_HALF = 1.3;
const KERB = KERB_W;
/** Carriles medidos desde el borde de la manzana (la fachada): horario y antihorario. */
const LANE_CW = 1.45;
const LANE_CCW = 2.4;
/** Separación lateral de una pareja (centro a centro). */
const PAIR_GAP = 0.5;
/** Ciclo del semáforo de `life/traffic` (verde, amarillo y todo rojo por eje). */
const HALF_CYCLE = SIGNAL.green + SIGNAL.amber + SIGNAL.allRed;
const CYCLE = HALF_CYCLE * 2;
/** Carril de llegada después de cruzar (el sentido se decide al llegar). */
const ARRIVE_LAT = (LANE_CW + LANE_CCW) / 2;
/** Lugares de espera en el cordón, a lo ancho de la senda (corrimiento lateral). */
const WAIT_SLOTS = [0.35, -0.35, 0.95, -0.95];
/**
 * El jugador: sólo reacciona quien camina a menos de 3 m (cuesta una resta
 * por peatón). Se pasa a 0,95 m de centro a centro (hombro con hombro queda
 * ~40 cm) y nunca fuera de la franja libre de la vereda: de la fachada (las
 * vidrieras sacan cajones hasta 0,9 m) a la línea de los árboles (troncos a
 * 3 m del borde de la manzana, alcorques desde 2,1 m).
 */
const AVOID_R = 3;
const PASS = 0.95;
const SIDE_MIN = 0.6;
const SIDE_MAX = 2.6;
/** En fila india: el acompañante va 0,8 m detrás de quien decide. */
const FILE_GAP = 0.8;

/** Normal hacia afuera de cada lado de una vuelta: 0 = −z, 1 = +x, 2 = +z, 3 = −x. */
const NX = [0, 1, 0, -1] as const;
const NZ = [-1, 0, 1, 0] as const;

/** Algo parado sobre la vereda que quien camina rodea (carril alternativo por sentido). */
interface Obstacle {
  along: number;
  half: number;
  cw: number;
  ccw: number;
}

/** Senda peatonal que sale de un lado de una vuelta. */
interface Crossing {
  along: number;
  to: number;
  side: number;
  /** Eje de la calle que se cruza y la esquina (para el semáforo). */
  axis: 'x' | 'z';
  nodeX: number;
  nodeZ: number;
  signal: boolean;
  /** Distancia de la fachada al eje de la calle cruzada (lado de salida y de llegada). */
  edgeFrom: number;
  edgeTo: number;
  /** Cebra (índice en `Sidewalks.zebras`): la misma para los dos sentidos. */
  zebra: number;
}

/** Centro de una senda peatonal, sobre el eje de la calle que se cruza. */
export interface Zebra {
  x: number;
  z: number;
  axis: 'x' | 'z';
}

export interface SidewalkLoop {
  cx: number;
  cz: number;
  /** Medio lado hasta la línea de fachada (borde de la manzana). */
  hx: number;
  hz: number;
  /** Vereda elevada con rampas (manzanas del barrio) o a cota cero (la escuela). */
  raised: boolean;
  open: [boolean, boolean, boolean, boolean];
  /** Tramo transitable de cada lado (avance mínimo y máximo): una calle que muere contra el lado lo corta. */
  lim: Array<[number, number]>;
  crossings: Crossing[][];
  obstacles: Obstacle[][];
  /** Cercanía a la escuela (1 = pegada): sesgo para quedarse cerca. */
  near: number;
}

type Mode = 'walk' | 'cross' | 'stand' | 'sit';

/** Una persona del barrio: el `Agent` que se dibuja más su estado de vereda. */
export class Walker {
  mode: Mode = 'walk';
  loop = 0;
  side = 0;
  along = 0;
  dir = 1;
  /** Distancia lateral actual a la fachada (se acerca a la del carril). */
  lat = LANE_CW;
  x = 0;
  z = 0;
  y = SIDEWALK_H;
  cruise = 1.25;
  /** Cruce en curso: origen, dirección, avance y largo. */
  cx = 0;
  cz = 0;
  cnx = 0;
  cnz = 0;
  cs = 0;
  cd = 0;
  /** Corrimiento lateral dentro de la senda (cada uno por su derecha). */
  cOff = 0;
  /** Carril al empezar el cruce, hasta dónde avanza esperando y si ya tiene paso. */
  cLat = 0;
  waitAt = 0;
  go = false;
  cross: Crossing | null = null;
  /** Cruce ya evaluado (para no volver a tirar la moneda en el mismo). */
  lastCross = -1;
  /** Pareja: quien decide y quien acompaña. */
  lead: Walker | null = null;
  mate: Walker | null = null;
  offX = 0;
  offZ = 0;
  /** Chico que va a la escuela con su mamá o papá (sólo en entrada y salida). */
  schoolKid = false;
  /** Parado: lugar y animación (charla, parada, kiosco). */
  restAnim: AnimId = 'idle';
  group: Walker[] | null = null;
  talkT = 0;
  /** Pausa (mirar una vidriera, esperar el verde). */
  timer = 0;
  /** La pausa es para mirar el teléfono (de cara al camino), no la vidriera. */
  phone = false;
  /**
   * Pareja en fila india (cruzándose con alguien, al lado de algo parado o
   * pasando al jugador): segundos que le quedan. De a dos, lado a lado, dos
   * parejas de frente se rozaban a 0,45 m.
   */
  singleT = 0;
  /** Corrimiento lateral extra en la senda, para no llevarse puesto al jugador. */
  dodge = 0;
  constructor(readonly a: Agent) {}
}

export interface SidewalkOptions {
  /** Peatones que caminan (las parejas cuentan dos). */
  walkers: number;
  /** Rondas de charla paradas en la vereda. */
  groups: number;
  /** Gente por parada de colectivo (sentados + parados). */
  perStop: number;
  /** Bancos de vereda o de explanada con alguien sentado. */
  benches: number;
  /**
   * Burbuja (m; 0 = sin burbuja): quien camina más lejos que esto de la
   * cámara, fuera de cuadro, reaparece a entre 1/3 y 2/3 de esa distancia,
   * también fuera de cuadro. Ver `regather`.
   */
  bubble: number;
}

/**
 * Cantidades por perfil (ver `Population`). En el visor caminan casi tantos
 * como en escritorio: con 27 caminantes repartidos en ~2 km de vereda, desde
 * cualquier calle se veían 3 personas y el fondo de las veredas vacío. Lo
 * que cuesta es dibujarlos, no moverlos (~0,06 ms por cuadro todos juntos),
 * y lo dibujado sigue con el tope de `Population` (16 en el visor).
 */
export function sidewalkOptions(crowdSize: number, detailed: boolean): SidewalkOptions {
  return {
    walkers: Math.round(crowdSize * (detailed ? 0.34 : 0.55)),
    groups: detailed ? 6 : 5,
    perStop: detailed ? 4 : 3,
    benches: detailed ? 7 : 4,
    // 10 m más que la distancia de dibujo de cada perfil (80 y 90 m, ver
    // `Population`): nadie desaparece a la vista ni aparece dentro de ella.
    bubble: detailed ? 100 : 90,
  };
}

function streetAt(s: Street, at: number): boolean {
  const [a, b] = s.span ?? [-Infinity, Infinity];
  if (at < a - 0.01 || at > b + 0.01) return false;
  return !(s.gaps ?? []).some(([g0, g1]) => at > g0 && at < g1);
}

export class Sidewalks {
  readonly loops: SidewalkLoop[] = [];
  readonly zebras: Zebra[] = [];
  readonly walkers: Walker[] = [];
  /**
   * Quienes ya arrancaron a cruzar (se arma en cada `update`, sin crear
   * arreglos): el tránsito pregunta decenas de veces por cuadro y así recorre
   * dos o tres personas, no cien.
   */
  private readonly crossers: Walker[] = [];
  /** Los `Agent` de todos, en el mismo orden (lo que recorre el render). */
  readonly agents: Agent[] = [];
  private readonly rng: Rng;
  private readonly rt: Rng;
  private readonly laneHalf: number;
  private phase: SchoolPhase = 'entrada';
  time = 0;
  /** Cámara (mundo) y mirada horizontal; la escriben `Population` o las pruebas. */
  camX = 0;
  camZ = 0;
  camY = 1.7;
  /** Mirada horizontal (unitaria): la burbuja no mueve a nadie dentro del cono. */
  camFX = 0;
  camFZ = 1;
  private readonly bubble: number;
  /** Próximo caminante que revisa la burbuja (de a uno por cuadro, en ronda). */
  private bubbleI = 0;
  /** Lugar candidato de `spotNear` (campos: corre seguido). */
  private spotLoop = 0;
  private spotSide = 0;
  private spotAlong = 0;
  /** Pies del jugador (mundo), para que lo miren al pasar. */
  playerX = NaN;
  playerZ = NaN;
  /** Si un peatón puede empezar a cruzar (lo puede conectar el tránsito). */
  gate: ((x: number, z: number, axis: 'x' | 'z') => boolean) | null = null;

  constructor(
    private readonly plan: CityPlan,
    private readonly frame: { ox: number; oz: number },
    seed: number,
    opts: SidewalkOptions,
  ) {
    // Azar propio: la multitud de la escuela no cambia en nada.
    this.rng = new Rng((seed ^ 0x3a7e5d) >>> 0);
    this.rt = new Rng((seed ^ 0x1c0ffe) >>> 0);
    this.laneHalf = (plan.streetWidth * LANE_FRAC) / 2;
    this.bubble = opts.bubble;
    this.buildLoops();
    this.spawn(opts);
  }

  // ================================================================== la red

  private buildLoops(): void {
    const plan = this.plan;
    const half = plan.blockSize / 2;
    for (const b of plan.blocks) {
      if (b.landmark || b.kind === 'water' || b.kind === 'houses') continue;
      this.loops.push(this.makeLoop(b.cx, b.cz, half, half, true, [true, true, true, true]));
    }
    // El predio escolar: sus veredas de Lafinur (norte) y Gral. Acha (este,
    // −x). Laprida es de la escuela; el lado oeste da al ochavo de Miguel Cané.
    const site = plan.schoolSite;
    if (site) {
      this.loops.push(this.makeLoop((site.x0 + site.x1) / 2, (site.z0 + site.z1) / 2, (site.x1 - site.x0) / 2, (site.z1 - site.z0) / 2, false, [true, false, false, true]));
    }
    const sc = site ? { x: (site.x0 + site.x1) / 2, z: (site.z0 + site.z1) / 2 } : { x: 0, z: 0 };
    // Lados cortados por una calle que muere contra ellos (la transversal del
    // medio sigue en diagonal como Miguel Cané): se camina sólo hasta el
    // cordón de esa calle, del lado que da a la escuela (el este).
    for (const l of this.loops) {
      for (let k = 0; k < 4; k++) {
        if (!l.open[k]) continue;
        const alongX = k % 2 === 0;
        const edge = alongX ? l.cz + NZ[k] * l.hz : l.cx + NX[k] * l.hx;
        for (const st of plan.streets) {
          if (st.axis === (alongX ? 'x' : 'z')) continue;
          const c = alongX ? l.cx : l.cz;
          const off = st.at - c;
          if (Math.abs(off) > (alongX ? l.hx : l.hz) - 1) continue;
          // ¿Su calzada llega hasta este borde?
          if (!streetAt(st, edge + (alongX ? NZ[k] : NX[k]) * 0.5)) continue;
          const cut = this.laneHalf + 0.6;
          if (off < 0) l.lim[k][0] = Math.max(l.lim[k][0], off + cut);
          else l.lim[k][1] = Math.min(l.lim[k][1], off - cut);
          // Del predio escolar queda el tramo del lado de la escuela (−x).
          if (!l.raised && alongX) l.lim[k] = [-1e9, off - cut];
        }
      }
    }
    // El predio sólo tiene un lado y medio de vereda: con todo el peso de la
    // cercanía, la gente se juntaba en el tramo que termina contra Miguel Cané.
    for (const l of this.loops) l.near = l.raised ? 1 / (1 + (Math.hypot(l.cx - sc.x, l.cz - sc.z) / 60) ** 2) : 0.45;
    for (let i = 0; i < this.loops.length; i++) for (let k = 0; k < 4; k++) this.loops[i].crossings[k] = this.findCrossings(i, k);
    for (const p of plan.props) this.addPropObstacle(p.kind, p.x, p.z, p.nx, p.nz);
    // Bancos de vereda (sobre la línea de los árboles, de espaldas a la
    // fachada): de a dos no se pasa al lado del respaldo; en fila, sí.
    for (const b of plan.benches ?? []) {
      if (b.kind !== 'sidewalk') continue;
      const hit = this.propSide(b.x, b.z, Math.sin(b.rotY), Math.cos(b.rotY));
      if (hit) this.loops[hit.loop].obstacles[hit.side].push({ along: hit.along, half: 1.0, cw: LANE_CW, ccw: LANE_CCW - 0.1 });
    }
    // Mesitas de los cafés (si la ciudad las publica): quien va por el
    // carril de la fachada pasa entre la vidriera y la mesa; el otro, por
    // fuera. El local de café no saca cajones ni flores: ese hueco está libre.
    for (const t of (plan as { cafeTables?: ReadonlyArray<{ x: number; z: number }> }).cafeTables ?? []) {
      for (let side = 0; side < 4; side++) {
        const hit = this.propSide(t.x, t.z, NX[side], NZ[side]);
        if (!hit || hit.side !== side || hit.lat > 2.4) continue;
        this.loops[hit.loop].obstacles[hit.side].push({ along: hit.along, half: 0.95, cw: Math.max(0.55, hit.lat - 0.85), ccw: Math.max(LANE_CCW - 0.1, hit.lat + 0.85) });
        break;
      }
    }
  }

  private makeLoop(cx: number, cz: number, hx: number, hz: number, raised: boolean, open: [boolean, boolean, boolean, boolean]): SidewalkLoop {
    const lim: Array<[number, number]> = [0, 1, 2, 3].map(() => [-1e9, 1e9]);
    return { cx, cz, hx, hz, raised, open, lim, crossings: [[], [], [], []], obstacles: [[], [], [], []], near: 0 };
  }

  /** Largo hasta la esquina (desde el centro del lado) para un carril dado. */
  private end(l: SidewalkLoop, side: number, lat: number): number {
    return (side % 2 === 0 ? l.hx : l.hz) + lat;
  }

  /** Mundo de un punto (lado, avance, distancia a la fachada). */
  private pos(l: SidewalkLoop, side: number, along: number, lat: number, out: { x: number; z: number }): void {
    if (side % 2 === 0) {
      out.x = l.cx + along;
      out.z = l.cz + NZ[side] * (l.hz + lat);
    } else {
      out.x = l.cx + NX[side] * (l.hx + lat);
      out.z = l.cz + along;
    }
  }

  /** Sendas del lado `k` de la vuelta `i`: cada una lleva a un lado abierto de enfrente. */
  private findCrossings(i: number, k: number): Crossing[] {
    const l = this.loops[i];
    if (!l.open[k]) return [];
    const out: Crossing[] = [];
    const alongX = k % 2 === 0;
    const axis: 'x' | 'z' = alongX ? 'x' : 'z';
    const edge = alongX ? l.cz + NZ[k] * l.hz : l.cx + NX[k] * l.hx;
    const sAt = edge + (alongX ? NZ[k] : NX[k]) * (this.plan.streetWidth / 2);
    const street = this.plan.streets.find((s) => s.axis === axis && Math.abs(s.at - sAt) < 0.5);
    if (!street) return [];
    const c = alongX ? l.cx : l.cz;
    const ext = (alongX ? l.hx : l.hz) + LANE_CCW;
    for (const p of this.plan.streets) {
      if (p.axis === axis || !streetAt(street, p.at) || !streetAt(p, street.at)) continue;
      const signal = [p.at - 12, p.at + 12].every((q) => streetAt(street, q)) && [street.at - 12, street.at + 12].every((q) => streetAt(p, q));
      for (const s of [-1, 1]) {
        if (!streetAt(street, p.at + s * 12)) continue;
        const at = p.at + s * CROSS_AT;
        if (Math.abs(at - c) > ext || at - c < l.lim[k][0] || at - c > l.lim[k][1]) continue;
        // La vuelta de enfrente: su lado opuesto mira a la misma calle.
        const k2 = (k + 2) % 4;
        for (let j = 0; j < this.loops.length; j++) {
          if (j === i) continue;
          const m = this.loops[j];
          if (!m.open[k2]) continue;
          const e2 = alongX ? m.cz + NZ[k2] * m.hz : m.cx + NX[k2] * m.hx;
          const s2 = e2 + (alongX ? NZ[k2] : NX[k2]) * (this.plan.streetWidth / 2);
          if (Math.abs(s2 - street.at) > 0.5) continue;
          const c2 = alongX ? m.cx : m.cz;
          if (Math.abs(at - c2) > (alongX ? m.hx : m.hz) + LANE_CCW || at - c2 < m.lim[k2][0] || at - c2 > m.lim[k2][1]) continue;
          out.push({
            along: at - c,
            to: j,
            side: k2,
            axis,
            nodeX: alongX ? p.at : street.at,
            nodeZ: alongX ? street.at : p.at,
            signal,
            edgeFrom: Math.abs(street.at - edge),
            edgeTo: Math.abs(street.at - e2),
            zebra: this.zebraId(alongX ? at : street.at, alongX ? street.at : at, axis),
          });
        }
      }
    }
    return out;
  }

  private zebraId(x: number, z: number, axis: 'x' | 'z'): number {
    const i = this.zebras.findIndex((q) => q.axis === axis && Math.abs(q.x - x) < 0.5 && Math.abs(q.z - z) < 0.5);
    if (i >= 0) return i;
    this.zebras.push({ x, z, axis });
    return this.zebras.length - 1;
  }

  /** Refugio de colectivo y kiosco: se los rodea (por detrás, y el refugio también por delante). */
  private addPropObstacle(kind: 'busStop' | 'kiosk', x: number, z: number, nx: number, nz: number): void {
    const hit = this.propSide(x, z, nx, nz);
    if (!hit) return;
    const { loop, side, along } = hit;
    const obs = this.loops[loop].obstacles[side];
    if (kind === 'busStop') obs.push({ along, half: 2.9, cw: 0.6, ccw: 3.2 });
    else obs.push({ along, half: 1.7, cw: 0.5, ccw: 1.0 });
  }

  /** Vuelta y lado sobre los que está algo de la vereda con normal (nx, nz). */
  private propSide(x: number, z: number, nx: number, nz: number): { loop: number; side: number; along: number; lat: number } | null {
    const side = nz < -0.5 ? 0 : nx > 0.5 ? 1 : nz > 0.5 ? 2 : 3;
    for (let i = 0; i < this.loops.length; i++) {
      const l = this.loops[i];
      if (!l.open[side]) continue;
      const alongX = side % 2 === 0;
      const lat = alongX ? (z - l.cz) * NZ[side] - l.hz : (x - l.cx) * NX[side] - l.hx;
      const along = alongX ? x - l.cx : z - l.cz;
      if (lat > -0.5 && lat < 4.5 && Math.abs(along) <= (alongX ? l.hx : l.hz)) return { loop: i, side, along, lat };
    }
    return null;
  }

  // =============================================================== población

  private makeAgent(id: string, role: NpcRole, tweak?: (a: Appearance) => Appearance): Agent {
    const rng = this.rng;
    let app = makeAppearance(rng, { role, backpack: role === 'visitor' ? rng.chance(0.18) : undefined });
    // Ropa de calle: algunos de saco o tapado largo (la pieza del guardapolvo
    // largo, en colores oscuros), nada de uniformes.
    if (role === 'visitor' && rng.chance(0.22)) app = { ...app, torsoPart: 'coat', shortSleeves: false, top: rng.pick(COATS) };
    if (tweak) app = tweak(app);
    const a = new Agent(-1 - this.agents.length, id, role, app, bodyDims(app), null, false, 0, rng.next());
    a.lookPlayer = true;
    this.agents.push(a);
    return a;
  }

  private add(a: Agent): Walker {
    const w = new Walker(a);
    w.cruise = a.walkSpeed * this.rng.range(0.92, 1.05);
    this.walkers.push(w);
    return w;
  }

  /** Lado al azar, con más peso cerca de la escuela. */
  private pickSide(kidBias: boolean): { loop: number; side: number } {
    let total = 0;
    const weights: number[] = [];
    for (const l of this.loops) {
      for (let k = 0; k < 4; k++) {
        let wgt = l.open[k] ? l.near * (k % 2 === 0 ? l.hx : l.hz) : 0;
        // Chicos con sus padres: el lado de enfrente de la escuela sobre
        // Laprida y Gral. Acha (los que miran al predio).
        if (kidBias && wgt > 0) {
          const ex = l.cx + NX[k] * (l.hx + 7.5);
          const ez = l.cz + NZ[k] * (l.hz + 7.5);
          const site = this.plan.schoolSite;
          const facing = site && ex > site.x0 - 9 && ex < site.x1 + 9 && ez > site.z0 - 9 && ez < site.z1 + 9;
          wgt *= facing ? 4 : 0.3;
        }
        weights.push(wgt);
        total += wgt;
      }
    }
    let r = this.rng.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0 && weights[i] > 0) return { loop: Math.floor(i / 4), side: i % 4 };
    }
    return { loop: 0, side: 0 };
  }

  private spawn(opts: SidewalkOptions): void {
    const rng = this.rng;
    // Paradas de colectivo y kiosco: gente quieta en lugares de verdad.
    for (const p of this.plan.props) {
      const hit = this.propSide(p.x, p.z, p.nx, p.nz);
      if (!hit) continue;
      const yawOut = Math.atan2(p.nx, p.nz);
      if (p.kind === 'busStop') {
        const seated = Math.max(1, opts.perStop - 1);
        const slots = rng.shuffle([-1.15, 0, 1.15]).slice(0, Math.min(3, seated));
        for (const s of slots) {
          const a = this.makeAgent(`street-bus-${this.agents.length}`, rng.chance(0.15) ? 'studentSecondary' : 'visitor');
          const w = this.add(a);
          // Banco del refugio: 35 cm delante del vidrio, tapa a 0,51 m de la vereda.
          this.place(w, hit.loop, hit.side, hit.along + s, hit.lat - 0.38, 'sit', yawOut);
          this.prepareSit(w, SIDEWALK_H + 0.51, SIDEWALK_H);
        }
        for (let i = seated; i < opts.perStop; i++) {
          const a = this.makeAgent(`street-bus-${this.agents.length}`, 'visitor');
          const w = this.add(a);
          // De pie al costado del refugio, mirando de dónde viene el colectivo.
          const s = i % 2 === 0 ? 2.75 : -2.75;
          this.place(w, hit.loop, hit.side, hit.along + s, hit.lat + 0.1, 'stand', yawOut + (s > 0 ? -0.9 : 0.9));
          w.restAnim = rng.chance(0.5) ? 'lookAround' : 'idle';
        }
      } else {
        const a = this.makeAgent(`street-kiosk-${this.agents.length}`, 'visitor');
        const w = this.add(a);
        // Comprando el diario: frente al mostrador, mirando al kiosco.
        this.place(w, hit.loop, hit.side, hit.along + rng.range(-0.4, 0.4), hit.lat + 1.3, 'stand', yawOut + Math.PI);
        w.restAnim = 'idle';
      }
    }
    // Charlas en la vereda, contra la vidriera.
    for (let g = 0; g < opts.groups; g++) {
      const { loop, side } = this.pickSide(false);
      const l = this.loops[loop];
      const span = (side % 2 === 0 ? l.hx : l.hz) - 4;
      let along = clamp(rng.range(-span, span), l.lim[side][0] + 3, l.lim[side][1] - 3);
      // Lejos de las sendas y de lo que ya hay parado.
      if (l.crossings[side].some((c) => Math.abs(c.along - along) < 4) || l.obstacles[side].some((o) => Math.abs(o.along - along) < o.half + 2.5)) along = rng.range(-span * 0.5, span * 0.5);
      const n = rng.chance(0.35) ? 3 : 2;
      const center = 0.9;
      const members: Walker[] = [];
      for (let i = 0; i < n; i++) {
        const a = this.makeAgent(`street-chat-${this.agents.length}`, rng.chance(0.12) ? 'studentSecondary' : 'visitor');
        const w = this.add(a);
        const ang = (i / n) * TAU + rng.range(-0.3, 0.3);
        const da = Math.cos(ang) * 0.42;
        const dl = Math.sin(ang) * 0.36;
        this.place(w, loop, side, along + da, center + dl, 'stand', 0);
        members.push(w);
      }
      for (const w of members) {
        w.group = members;
        // De cara al centro de la ronda.
        const c = { x: 0, z: 0 };
        this.pos(l, side, along, center, c);
        w.a.yaw = w.a.wantYaw = Math.atan2(c.x - w.x, c.z - w.z);
        w.restAnim = 'listen';
        w.talkT = rng.range(0, 6);
      }
      members[0].restAnim = 'talk';
      l.obstacles[side].push({ along, half: 1.0, cw: 1.95, ccw: 2.6 });
    }
    // Los que caminan: solos, en pareja, o un chico con su mamá o papá.
    let left = opts.walkers;
    while (left > 0) {
      const pair = left >= 2 && rng.chance(0.38);
      const kid = pair && rng.chance(0.45);
      const { loop, side } = this.pickSide(kid);
      const l = this.loops[loop];
      const span = side % 2 === 0 ? l.hx : l.hz;
      const lead = this.add(this.makeAgent(`street-walk-${this.agents.length}`, rng.chance(0.08) ? 'studentSecondary' : 'visitor'));
      this.place(lead, loop, side, clamp(rng.range(-span, span), l.lim[side][0] + 0.5, l.lim[side][1] - 0.5), LANE_CW, 'walk', 0);
      lead.dir = rng.chance(0.5) ? 1 : -1;
      lead.lat = this.lane(lead);
      left--;
      if (pair) {
        const role: NpcRole = kid ? (rng.chance(0.4) ? 'kid' : 'student') : 'visitor';
        const mate = this.add(this.makeAgent(`street-${kid ? 'kid' : 'mate'}-${this.agents.length}`, role));
        mate.lead = lead;
        lead.mate = mate;
        mate.schoolKid = kid;
        mate.mode = 'walk';
        // Van al paso del más lento (un chico de 4 años marca el ritmo).
        const sp = Math.min(lead.cruise, mate.cruise * (kid ? 1.12 : 1));
        lead.cruise = mate.cruise = sp;
        left--;
      }
      // Arrancan escalonados: algunos mirando una vidriera.
      if (rng.chance(0.2)) lead.timer = rng.range(1, 6);
    }
    this.spawnBenches(opts.benches);
    for (const w of this.walkers) this.locate(w);
    this.setPhase('entrada');
  }

  /**
   * Gente sentada en los bancos del plano (los mismos que dibuja
   * `InfraBuilder`), con más chance cerca de la escuela: de a uno o de a dos,
   * con el mismo ajuste de rodillas que en las paradas. Va al final del
   * reparto: no corre el azar de los que ya estaban.
   */
  private spawnBenches(n: number): void {
    const rng = this.rng;
    const site = this.plan.schoolSite;
    const sx = site ? (site.x0 + site.x1) / 2 : 0;
    const sz = site ? (site.z0 + site.z1) / 2 : 0;
    const pool = (this.plan.benches ?? []).filter((b) => b.kind !== 'stop');
    const weight = pool.map((b) => 1 / (1 + (Math.hypot(b.x - sx, b.z - sz) / 60) ** 2));
    for (let k = 0; k < n && pool.length; k++) {
      let total = 0;
      for (const v of weight) total += v;
      let r = rng.next() * total;
      let i = 0;
      while (i < pool.length - 1 && (r -= weight[i]) > 0) i++;
      const b = pool[i];
      pool.splice(i, 1);
      weight.splice(i, 1);
      // El eje largo del banco es su X local: (cos θ, −sin θ); mira a (sin θ, cos θ).
      const ax = Math.cos(b.rotY);
      const az = -Math.sin(b.rotY);
      const two = rng.chance(0.4);
      const offs = two ? [-0.45, 0.45] : [rng.range(-0.5, 0.5)];
      for (const o of offs) {
        const role: NpcRole = rng.chance(two ? 0.1 : 0.2) ? 'studentSecondary' : 'visitor';
        const w = this.add(this.makeAgent(`street-bench-${this.agents.length}`, role));
        w.mode = 'sit';
        w.x = b.x + ax * o + Math.sin(b.rotY) * 0.04;
        w.z = b.z + az * o + Math.cos(b.rotY) * 0.04;
        w.y = SIDEWALK_H;
        w.a.yaw = w.a.wantYaw = b.rotY + (two ? (o > 0 ? -0.25 : 0.25) : 0);
        setBase(w.a.anim, 'sit');
        w.a.anim.w = 1;
        // Tapa del banco de vereda: 0,45 + 0,04 sobre el solado.
        this.prepareSit(w, SIDEWALK_H + 0.49, SIDEWALK_H);
        w.talkT = rng.range(0, 8);
        this.sync(w);
      }
      // De a dos, charlan (se miran de a ratos).
      if (two) {
        const pairW = this.walkers.slice(-2);
        pairW[0].group = pairW;
        pairW[1].group = pairW;
        pairW[0].restAnim = 'talk';
        pairW[1].restAnim = 'listen';
      }
    }
  }

  private place(w: Walker, loop: number, side: number, along: number, lat: number, mode: Mode, yaw: number): void {
    w.loop = loop;
    w.side = side;
    w.along = along;
    w.lat = lat;
    w.mode = mode;
    const p = { x: 0, z: 0 };
    this.pos(this.loops[loop], side, along, lat, p);
    w.x = p.x;
    w.z = p.z;
    w.y = this.loops[loop].raised ? SIDEWALK_H : 0;
    w.a.yaw = w.a.wantYaw = yaw;
    setBase(w.a.anim, mode === 'walk' ? 'walk' : mode === 'sit' ? 'sit' : 'idle');
    w.a.anim.w = 1;
    this.sync(w);
  }

  /** Rodilla y cadera para apoyar los pies desde un banco (como `PeopleSim.prepareSit`). */
  private prepareSit(w: Walker, seatY: number, footY: number): void {
    const a = w.a;
    const d = a.body;
    a.seatY = seatY;
    a.anim.deskH = NaN;
    const top = seatY + d.seatOffset;
    let hip = 1.4;
    let drop = top - d.thigh * Math.cos(hip) - footY;
    if (d.shin * 0.98 < drop) {
      hip = clamp(Math.acos(clamp((top - footY - 0.98 * d.shin) / d.thigh, -1, 1)), 1.0, 1.4);
      drop = top - d.thigh * Math.cos(hip) - footY;
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

  // ============================================================ momento del día

  /** Entrada y salida: aparecen los chicos con sus padres. */
  setPhase(phase: SchoolPhase): void {
    this.phase = phase;
  }

  private kidsOut(): boolean {
    return this.phase === 'entrada' || this.phase === 'salida';
  }

  // ================================================================== cuadro

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    for (const w of this.walkers) {
      const a = w.a;
      if (a.visible) a.unseen = 0;
      else a.unseen += dt;
      // Lejos y fuera de cuadro: a 5 Hz con el tiempo acumulado.
      a.acc += dt;
      const far = !a.visible && (w.x - this.camX) ** 2 + (w.z - this.camZ) ** 2 > 40 * 40;
      if (far && a.acc < 0.2) continue;
      const step = Math.min(a.acc, 0.5);
      a.acc = 0;
      if (w.lead) this.follow(w, step);
      else if (w.mode === 'walk' || w.mode === 'cross') this.walk(w, step);
      else this.rest(w, step);
      this.animate(w, step);
      this.sync(w);
    }
    if (this.bubble > 0) this.regather();
    const cr = this.crossers;
    cr.length = 0;
    for (const w of this.walkers) if (w.mode === 'cross' && w.go && !w.a.hidden) cr.push(w);
  }

  /**
   * La burbuja: la gente se junta donde está el jugador. Con ~50 caminantes
   * en todo el barrio, quien camina en la otra punta no lo ve nadie y deja
   * vacías las veredas que sí se ven. Uno por cuadro (en ronda): si camina a
   * más de `bubble` m de la cámara, fuera de cuadro desde hace más de 1 s
   * (él y su pareja), pasa a otra vereda donde nadie lo ve aparecer:
   * - adelante, en la mirada (±40°), apenas más allá de la distancia de
   *   dibujo (de R − 8 a R − 1; `bubble` es 10 m más que el tope de
   *   `Population`), casi siempre caminando hacia la cámara: entra por el
   *   fondo de la vereda, en la niebla, como cualquiera que se acerca. Sin
   *   esto el fondo de las calles quedaba vacío: los de atrás tardan medio
   *   minuto en pasar al jugador;
   * - o al costado o atrás (a más de 80° de la mirada), entre R/3 y 2R/3:
   *   entra en cuadro cuando el jugador gira la cabeza o lo pasa caminando.
   * Volando (desde arriba se ve todo) no se mueve a nadie.
   */
  private regather(): void {
    const n = this.walkers.length;
    if (n === 0 || this.camY > 14) return;
    this.bubbleI = (this.bubbleI + 1) % n;
    const w = this.walkers[this.bubbleI];
    if (w.lead || w.mode !== 'walk' || w.a.hidden || w.a.unseen < 1) return;
    if (w.mate && !w.mate.a.hidden && w.mate.a.unseen < 1) return;
    const R = this.bubble;
    if ((w.x - this.camX) ** 2 + (w.z - this.camZ) ** 2 < R * R) return;
    // Mirando al campo (sin veredas adelante), el otro lugar.
    let front = this.rt.chance(0.5);
    if (!this.spotNear(R, front) && !this.spotNear(R, (front = !front))) return;
    const l = this.loops[this.spotLoop];
    w.loop = this.spotLoop;
    w.side = this.spotSide;
    w.along = this.spotAlong;
    if (front) {
      // Hacia la cámara (a veces no: no todos van para el mismo lado).
      const camAlong = w.side % 2 === 0 ? this.camX - l.cx : this.camZ - l.cz;
      const toward = camAlong > w.along ? 1 : -1;
      w.dir = this.rt.chance(0.8) ? toward : -toward;
    } else w.dir = this.rt.chance(0.5) ? 1 : -1;
    w.timer = 0;
    w.singleT = 0;
    w.lastCross = -1;
    w.lat = this.lane(w);
    w.y = l.raised ? SIDEWALK_H : 0;
    w.a.acc = 0;
    this.locate(w);
    if (w.mate) {
      this.locate(w.mate);
      w.mate.a.acc = 0;
    }
  }

  /**
   * Un lugar de vereda para la burbuja (ver `regather`): un punto al azar en
   * la franja pedida, llevado al lado de vuelta más cercano (a menos de 8 m),
   * que también tiene que quedar en la franja (al llevarlo a la vereda se
   * pudo acercar a la mirada). Deja el resultado en `spot*`.
   */
  private spotNear(R: number, front: boolean): boolean {
    const rt = this.rt;
    const r = front ? R - 1 - rt.next() * 7 : (R * (1 + rt.next())) / 3;
    const turn = front ? (rt.next() * 2 - 1) * 40 : (80 + rt.next() * 100) * (rt.chance(0.5) ? 1 : -1);
    const ang = Math.atan2(this.camFX, this.camFZ) + (turn * Math.PI) / 180;
    const px = this.camX + Math.sin(ang) * r;
    const pz = this.camZ + Math.cos(ang) * r;
    let best = 8;
    let found = false;
    for (let i = 0; i < this.loops.length; i++) {
      const l = this.loops[i];
      for (let k = 0; k < 4; k++) {
        if (!l.open[k]) continue;
        const alongX = k % 2 === 0;
        const half = (alongX ? l.hx : l.hz) - 1;
        const lo = Math.max(-half, l.lim[k][0] + 1);
        const hi = Math.min(half, l.lim[k][1] - 1);
        if (lo >= hi) continue;
        const lat = alongX ? (pz - l.cz) * NZ[k] - l.hz : (px - l.cx) * NX[k] - l.hx;
        const raw = alongX ? px - l.cx : pz - l.cz;
        const along = clamp(raw, lo, hi);
        const d = Math.abs(lat - ARRIVE_LAT) + Math.abs(along - raw);
        if (d >= best) continue;
        const qx = alongX ? l.cx + along : l.cx + NX[k] * (l.hx + ARRIVE_LAT);
        const qz = alongX ? l.cz + NZ[k] * (l.hz + ARRIVE_LAT) : l.cz + along;
        const dx = qx - this.camX;
        const dz = qz - this.camZ;
        const dq = Math.hypot(dx, dz);
        // Adelante: más allá del tope de dibujo (R − 10) y antes de la burbuja.
        // Al costado: lejos de la cámara y fuera del cono (cos 80° ≈ 0,17).
        if (front ? dq < R - 9.5 || dq > R - 0.5 : dq < R / 4 || dq > R * 0.75 || (dx * this.camFX + dz * this.camFZ) / dq > 0.17) continue;
        best = d;
        found = true;
        this.spotLoop = i;
        this.spotSide = k;
        this.spotAlong = along;
      }
    }
    return found;
  }

  /** Resultado de `avoid` (campos y no un objeto: corre en cada cuadro). */
  private avLat = 0;
  private avSp = 0;

  /**
   * ¿El jugador está en el camino de `w`? Si sí, deja en `avLat` el carril
   * para pasarlo por el lado con más lugar y en `avSp` la velocidad (frena, y
   * hasta espera, si no hay lugar para pasar holgado).
   */
  private avoid(w: Walker, l: SidewalkLoop, lat: number, sp: number): boolean {
    const px = this.playerX;
    const pz = this.playerZ;
    if (Number.isNaN(px)) return false;
    const dx = px - w.x;
    const dz = pz - w.z;
    if (dx * dx + dz * dz > AVOID_R * AVOID_R) return false;
    const alongX = w.side % 2 === 0;
    const pLat = alongX ? (pz - l.cz) * NZ[w.side] - l.hz : (px - l.cx) * NX[w.side] - l.hx;
    // En la calzada o dentro de la manzana: no está en esta vereda.
    if (pLat < -0.4 || pLat > SIDE_MAX + 1.4) return false;
    const ahead = ((alongX ? px - l.cx : pz - l.cz) - w.along) * w.dir;
    if (ahead < -0.4 || ahead > AVOID_R || (Math.abs(pLat - lat) >= PASS && Math.abs(pLat - w.lat) >= PASS)) return false;
    const fac = pLat - PASS;
    const kerb = pLat + PASS;
    let t = pLat > (SIDE_MIN + SIDE_MAX) / 2 ? fac : kerb;
    if (t < SIDE_MIN || t > SIDE_MAX) t = t === fac ? kerb : fac;
    t = clamp(t, SIDE_MIN, SIDE_MAX);
    this.avLat = t;
    this.avSp = Math.abs(pLat - t) < PASS * 0.7 ? sp * clamp((ahead - 0.8) / 1.6, 0, 1) : sp * (ahead < 1.5 ? 0.75 : 0.9);
    return true;
  }

  /** Carril de un caminante según su sentido de giro alrededor de la manzana. */
  private lane(w: Walker): number {
    const sense = w.dir * (w.side < 2 ? 1 : -1);
    const base = sense > 0 ? LANE_CW : LANE_CCW;
    // Rodear lo que hay parado (refugio, kiosco, una charla), con una
    // transición de 2,5 m: el carril es continuo a lo largo del lado.
    let lat = base;
    const paired = w.mate !== null && !w.mate.a.hidden;
    for (const o of this.loops[w.loop].obstacles[w.side]) {
      const d = Math.abs(w.along - o.along) - o.half;
      if (d > 2.5) continue;
      const k = clamp((2.5 - d) / 2.5, 0, 1);
      lat += ((sense > 0 ? o.cw : o.ccw) - lat) * k;
      // Al lado de algo parado, la pareja pasa en fila (no hay lugar para dos).
      if (paired) w.singleT = Math.max(w.singleT, 0.6);
    }
    // En pareja, el carril es el del medio de los dos; en fila, el de quien decide.
    // Antihorario (el acompañante del lado de la fachada): el par se corre
    // 0,2 m hacia el cordón, no 0,25. Con el corrimiento simétrico el de
    // adentro pasaba a 2,0 m de la fachada y se llevaba puestas las mesitas
    // de los cafés (de 1,15 a 1,85 m); más afuera, el de afuera rozaría los
    // troncos de la línea de árboles (a 3 m). Así: 2,1 y 2,6 m.
    if (paired && w.singleT <= 0) lat += sense > 0 ? -PAIR_GAP / 2 : 0.2;
    return lat;
  }

  private walk(w: Walker, dt: number): void {
    const a = w.a;
    if (w.mode === 'cross') {
      this.crossStep(w, dt);
      return;
    }
    if (w.timer > 0) {
      // Mirando una vidriera (de cara a la fachada) o el teléfono (donde estaba).
      w.timer -= dt;
      a.speed = 0;
      if (!w.phone) a.wantYaw = Math.atan2(-NX[w.side], -NZ[w.side]);
      return;
    }
    const l = this.loops[w.loop];
    let sp = w.cruise;
    const paired = w.mate !== null && !w.mate.a.hidden;
    if (w.singleT > 0) w.singleT -= dt;
    // Si alguien va adelante por el mismo carril más despacio, se le pega
    // detrás en vez de atravesarlo. Si viene de frente y van de a dos, se
    // ponen en fila hasta cruzarse.
    const alongX = w.side % 2 === 0;
    for (const o of this.walkers) {
      if (o === w || o === w.mate || o.mode !== 'walk' || o.loop !== w.loop || o.side !== w.side || o.a.hidden) continue;
      // El acompañante va corrido de quien decide (al lado o detrás): cuenta
      // donde está de verdad. Sin esto, quien venía detrás de una pareja en
      // fila se le metía al de atrás.
      const oAlong = o.lead ? o.along + (alongX ? o.offX : o.offZ) : o.along;
      const oLat = o.lead ? o.lat + NX[o.side] * o.offX + NZ[o.side] * o.offZ : o.lat;
      const ahead = (oAlong - w.along) * w.dir;
      if (o.dir !== w.dir) {
        if (paired && !o.lead && ahead > 0 && ahead < 5) w.singleT = Math.max(w.singleT, 1.2);
        continue;
      }
      if (ahead <= 0 || ahead > 1.6 || Math.abs(oLat - w.lat) > 0.45) continue;
      sp = Math.min(sp, ahead < 0.9 ? o.a.speed * 0.8 : o.a.speed);
    }
    // Mirando el teléfono mientras camina: un poco más lento.
    if (a.anim.gesture === 'phone') sp *= 0.8;
    let target = this.lane(w);
    let latRate = 0.9;
    if (this.avoid(w, l, target, sp)) {
      target = this.avLat;
      sp = this.avSp;
      latRate = 1.5;
      if (paired) w.singleT = Math.max(w.singleT, 1.2);
    }
    const prev = w.along;
    w.along += w.dir * sp * dt;
    const dLat = clamp(target - w.lat, -latRate * dt, latRate * dt);
    w.lat += dLat;
    a.speed = sp;
    // De frente a la marcha, con el cambio de carril incluido (el cuerpo
    // acompaña el desvío en vez de deslizarse de costado).
    const lv = dLat / Math.max(dt, 1e-3);
    a.wantYaw = Math.atan2((alongX ? w.dir * sp : 0) + NX[w.side] * lv, (alongX ? 0 : w.dir * sp) + NZ[w.side] * lv);
    // ¿Pasó por una senda? Tal vez cruza.
    const list = l.crossings[w.side];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if ((c.along - prev) * (c.along - w.along) > 0) continue;
      const key = w.loop * 64 + w.side * 16 + i;
      if (key === w.lastCross) continue;
      w.lastCross = key;
      const nextOpen = l.open[this.adjSide(w.side, Math.sign(c.along))];
      const goingToEnd = Math.sign(c.along) === w.dir;
      // Más ganas de cruzar hacia la escuela; si la esquina no sigue, casi seguro.
      let p = 0.3 + 0.3 * (this.loops[c.to].near - l.near);
      if (goingToEnd && !nextOpen) p = 0.8;
      if (this.rt.chance(clamp(p, 0.08, 0.85)) && this.waiting(c) < 4) {
        w.along = c.along;
        this.beginCross(w, c);
        return;
      }
    }
    // Fin del tramo contra una calle que muere ahí: pega la vuelta.
    const [lo, hi] = l.lim[w.side];
    if (w.along < lo || w.along > hi) {
      w.along = clamp(w.along, lo, hi);
      w.dir = -w.dir;
      w.lastCross = -1;
    }
    // Esquina: dobla (o, si el lado que sigue está cerrado, pega la vuelta).
    const end = this.end(l, w.side, w.lat);
    if (Math.abs(w.along) >= end) {
      const e = Math.sign(w.along);
      const ns = this.adjSide(w.side, e);
      if (l.open[ns] && !this.rt.chance(0.05)) {
        const endOnAdj = w.side === 0 || w.side === 3 ? -1 : 1;
        w.side = ns;
        w.dir = -endOnAdj;
        w.along = endOnAdj * this.end(l, ns, w.lat) - w.dir * 0.02;
      } else {
        w.dir = -w.dir;
        w.along = e * end;
      }
      w.lastCross = -1;
    } else if (this.rt.chance(dt * 0.012)) {
      // Alguna pausa: una vidriera o el teléfono (parado, de cara al camino).
      w.timer = 2 + this.rt.next() * 5;
      w.phone = this.rt.chance(0.45);
      if (w.phone) startGesture(a.anim, 'phone', w.timer);
    } else if (!a.anim.gesture && this.rt.chance(dt * 0.006)) {
      // O un vistazo al teléfono sin parar.
      startGesture(a.anim, 'phone', 2.5 + this.rt.next() * 3);
    }
    this.pos(l, w.side, w.along, w.lat, w);
  }

  /** Lado vecino en la esquina `e` (±1) del lado `k`. */
  private adjSide(k: number, e: number): number {
    if (k % 2 === 0) return e > 0 ? 1 : 3;
    return e > 0 ? 2 : 0;
  }

  /** Arranca un cruce por la senda `c`: hasta el cordón, y espera el verde si hace falta. */
  private beginCross(w: Walker, c: Crossing): void {
    const l = this.loops[w.loop];
    w.cross = c;
    w.cnx = NX[w.side];
    w.cnz = NZ[w.side];
    this.pos(l, w.side, c.along, w.lat, w);
    w.cx = w.x;
    w.cz = w.z;
    w.cLat = w.lat;
    w.cs = 0;
    w.cd = c.edgeFrom + c.edgeTo - w.lat - ARRIVE_LAT;
    w.go = this.mayCross(c);
    // Por su derecha dentro de la senda (2,6 m); quien espera, en su lugar
    // junto a los otros que esperan ahí (al borde de la rampa).
    let slot = 0;
    if (!w.go) {
      for (const o of this.walkers) if (o !== w && o.mode === 'cross' && o.cross === c && !o.go && !o.lead) slot++;
    }
    w.cOff = w.go ? 0.45 : WAIT_SLOTS[slot % WAIT_SLOTS.length];
    w.waitAt = Math.max(0, c.edgeFrom - this.laneHalf - KERB - RAMP_LEN - w.lat - 0.55 * Math.floor(slot / WAIT_SLOTS.length));
    w.mode = 'cross';
  }

  /** Cuántos esperan el verde en esa senda (con muchos, se sigue de largo). */
  private waiting(c: Crossing): number {
    let n = 0;
    for (const o of this.walkers) if (o.cross === c && !o.go && !o.lead) n++;
    return n;
  }

  /** ¿Se puede empezar a cruzar? Con semáforo, sólo con el rojo de los autos de esa calle. */
  private mayCross(c: Crossing): boolean {
    if (this.gate) return this.gate(c.nodeX, c.nodeZ, c.axis);
    if (!c.signal) return true;
    // Mismo ciclo que `life/traffic` (desfasaje por esquina incluido): los
    // autos del eje cruzado están en rojo de 14,5 a 32 s de su ciclo; se
    // arranca hasta 7 s antes del verde (lo que se tarda en cruzar).
    const off = (Math.abs(c.nodeX) * 0.11 + Math.abs(c.nodeZ) * 0.07) % CYCLE;
    const t = (this.time + off) % CYCLE;
    const local = c.axis === 'x' ? t : (t + HALF_CYCLE) % CYCLE;
    return local > SIGNAL.green + SIGNAL.amber + 0.5 && local < CYCLE - 7;
  }

  private crossStep(w: Walker, dt: number): void {
    const a = w.a;
    const c = w.cross!;
    a.wantYaw = Math.atan2(w.cnx, w.cnz);
    if (!w.go && this.mayCross(c)) w.go = true;
    const limit = w.go ? w.cd : w.waitAt;
    let sp = w.cs < limit ? w.cruise * (w.go ? 1.08 : 0.8) : 0;
    // El jugador parado en la senda: se lo pasa por el costado, sin salirse
    // de la cebra (2,6 m de ancho); si no hay lugar, frena delante.
    let dodge = 0;
    if (w.singleT > 0) w.singleT -= dt;
    if (!Number.isNaN(this.playerX)) {
      const dx = this.playerX - w.x;
      const dz = this.playerZ - w.z;
      if (dx * dx + dz * dz < AVOID_R * AVOID_R) {
        const ahead = dx * w.cnx + dz * w.cnz;
        // Corrimiento del jugador hacia la derecha de la marcha (como `cOff`).
        const side = dx * w.cnz - dz * w.cnx + w.cOff + w.dodge;
        const here = w.cOff + w.dodge;
        if (ahead > -0.3 && Math.abs(side - here) < PASS) {
          const lim = CROSS_HALF - 0.25;
          const want = clamp(side > here ? side - PASS : side + PASS, -lim, lim);
          dodge = want - w.cOff;
          if (Math.abs(side - want) < PASS * 0.7) sp *= clamp((ahead - 0.8) / 1.6, 0, 1);
          if (w.mate && !w.mate.a.hidden) w.singleT = Math.max(w.singleT, 1.2);
        }
      }
    }
    w.dodge += clamp(dodge - w.dodge, -1.4 * dt, 1.4 * dt);
    w.cs = Math.min(limit, w.cs + sp * dt);
    a.speed = sp;
    // A la derecha (de su marcha) dentro de la senda: entra de a poco.
    const off = (w.cOff + w.dodge) * Math.min(1, w.cs / 1.2);
    w.x = w.cx + w.cnx * w.cs + w.cnz * off;
    w.z = w.cz + w.cnz * w.cs - w.cnx * off;
    // Piso: vereda, rampa, calzada y la otra vereda.
    const startAxis = c.edgeFrom - w.cLat;
    const raised = w.cs <= startAxis ? this.loops[w.loop].raised : this.loops[c.to].raised;
    w.y = this.groundAt(Math.abs(startAxis - w.cs), raised);
    if (!w.go || w.cs < w.cd) return;
    // Llegó a la vereda de enfrente: sigue hacia la esquina más cercana
    // (como quien sigue derecho) o, a veces, para el otro lado.
    const to = this.loops[c.to];
    w.loop = c.to;
    w.side = c.side;
    w.along = c.side % 2 === 0 ? w.x - to.cx : w.z - to.cz;
    w.lat = c.side % 2 === 0 ? (w.z - to.cz) * NZ[c.side] - to.hz : (w.x - to.cx) * NX[c.side] - to.hx;
    const nearEnd = w.along >= 0 ? 1 : -1;
    w.dir = this.rt.chance(0.7) ? nearEnd : -nearEnd;
    w.mode = 'walk';
    w.cross = null;
    w.go = false;
    w.dodge = 0;
    // La senda por la que llegó no se vuelve a evaluar enseguida.
    const list = to.crossings[c.side];
    w.lastCross = -1;
    for (let i = 0; i < list.length; i++) if (Math.abs(list[i].along - w.along) < 1.5) w.lastCross = w.loop * 64 + w.side * 16 + i;
  }

  /** Acompañante: al lado de quien decide (hacia el carril del medio) o a su lado en la senda. */
  private follow(w: Walker, dt: number): void {
    const L = w.lead!;
    const a = w.a;
    // El chico se va (o vuelve) sólo cuando nadie los ve.
    if (w.schoolKid) {
      const want = this.kidsOut();
      if (want === a.hidden && a.unseen > 1 && L.a.unseen > 1) a.hidden = !want;
    }
    let tx: number;
    let tz: number;
    if (L.singleT > 0) {
      // En fila: detrás de quien decide, sobre su marcha.
      const fx = L.mode === 'cross' ? L.cnx : L.side % 2 === 0 ? L.dir : 0;
      const fz = L.mode === 'cross' ? L.cnz : L.side % 2 === 0 ? 0 : L.dir;
      tx = -fx * FILE_GAP;
      tz = -fz * FILE_GAP;
    } else if (L.mode === 'cross') {
      // Al lado de quien decide, hacia el medio de la senda (no se sale de la cebra).
      const s = L.cOff > 0 ? -PAIR_GAP : PAIR_GAP;
      tx = L.cnz * s;
      tz = -L.cnx * s;
    } else {
      // Carril horario: el acompañante va del lado del cordón; antihorario, de la fachada.
      const sense = L.dir * (L.side < 2 ? 1 : -1);
      const s = sense > 0 ? PAIR_GAP : -PAIR_GAP;
      tx = NX[L.side] * s;
      tz = NZ[L.side] * s;
    }
    // El jugador justo donde iría: se corre hasta quedar a 0,8 m.
    if (!Number.isNaN(this.playerX)) {
      const qx = L.x + tx - this.playerX;
      const qz = L.z + tz - this.playerZ;
      const q = Math.hypot(qx, qz);
      if (q < 0.8 && q > 1e-3) {
        tx += (qx / q) * (0.8 - q);
        tz += (qz / q) * (0.8 - q);
      }
    }
    const k = Math.min(1, dt * (L.singleT > 0 ? 4 : 2.5));
    w.offX += (tx - w.offX) * k;
    w.offZ += (tz - w.offZ) * k;
    const nx = L.x + w.offX;
    const nz = L.z + w.offZ;
    const dx = nx - w.x;
    const dz = nz - w.z;
    const moved = Math.hypot(dx, dz);
    w.x = nx;
    w.z = nz;
    w.y = L.y;
    w.loop = L.loop;
    w.side = L.side;
    w.along = L.along;
    w.dir = L.dir;
    w.lat = L.lat;
    w.mode = L.mode === 'cross' ? 'cross' : 'walk';
    a.speed = L.a.speed > 0.05 ? Math.max(L.a.speed * 0.9, Math.min(moved / Math.max(dt, 1e-3), L.a.speed * 1.3)) : 0;
    a.wantYaw = a.speed > 0.05 && moved > 0.005 ? Math.atan2(dx, dz) : L.a.wantYaw;
    // Mirarse de vez en cuando: van charlando.
    w.talkT -= dt;
    if (w.talkT <= 0) {
      w.talkT = 3 + this.rt.next() * 6;
      L.talkT = w.talkT * 0.5;
    }
  }

  /** Quietos: charla (turnos de quien habla), parada y kiosco. */
  private rest(w: Walker, dt: number): void {
    const a = w.a;
    a.speed = 0;
    const g = w.group;
    if (w.mode === 'sit') {
      // De a dos en un banco: turnos para hablar, y se miran (ver `lookAt`).
      if (g) {
        w.talkT -= dt;
        if (w.talkT <= 0 && w.restAnim === 'talk') {
          w.restAnim = 'sit';
          const next = g[0] === w ? g[1] : g[0];
          next.restAnim = 'talk';
          next.talkT = 4 + this.rt.next() * 6;
          w.talkT = next.talkT + 1;
        }
      }
      const want: AnimId = g && w.restAnim === 'talk' ? 'sitTalk' : 'sit';
      if (a.anim.base !== want) setBase(a.anim, want);
      else if (!g && !a.anim.gesture && this.rt.chance(dt * 0.025)) startGesture(a.anim, 'phone', 4 + this.rt.next() * 6);
      return;
    }
    // Esperando el colectivo o en el kiosco: de vez en cuando, el teléfono.
    if (!g && !a.anim.gesture && this.rt.chance(dt * 0.02)) startGesture(a.anim, 'phone', 3 + this.rt.next() * 5);
    if (g) {
      w.talkT -= dt;
      if (w.talkT <= 0 && w.restAnim === 'talk') {
        // Pasa la palabra a otro de la ronda.
        w.restAnim = 'listen';
        const next = g[(g.indexOf(w) + 1 + Math.floor(this.rt.next() * (g.length - 1))) % g.length];
        next.restAnim = 'talk';
        next.talkT = 4 + this.rt.next() * 6;
        if (this.rt.chance(0.3)) startGesture(next.a.anim, this.rt.chance(0.5) ? 'nod' : 'point');
      }
    }
    if (a.anim.base !== w.restAnim) setBase(a.anim, w.restAnim);
  }

  // ================================================================ animación

  private animate(w: Walker, dt: number): void {
    const a = w.a;
    const an = a.anim;
    const dy = wrap(a.wantYaw - a.yaw);
    const rate = (a.speed > 0.3 ? 4.5 : 2.6) * dt;
    a.yaw = wrap(a.yaw + clamp(dy, -rate, rate));
    if (w.mode !== 'sit' && w.mode !== 'stand') {
      if (a.speed > 0.05) {
        if (an.base !== 'walk') setBase(an, 'walk');
      } else if (an.base === 'walk') setBase(an, a.look.idleStyle === 2 ? 'lookAround' : 'idle');
    }
    const legLen = 0.92 * a.body.legS;
    const ampT = clamp(a.speed / Math.max(0.3, a.walkSpeed * 0.9), 0, 1);
    an.amp += (ampT - an.amp) * Math.min(1, dt * 5);
    an.run += (0 - an.run) * Math.min(1, dt * 4);
    an.phase = (an.phase + (a.speed * dt * TAU) / (legLen * 1.45)) % TAU;
    tickAnim(an, dt);
    this.lookAt(w, dt);
  }

  /** Mirada: al jugador si pasa cerca y adelante; si no, a su pareja cada tanto. */
  private lookAt(w: Walker, dt: number): void {
    const a = w.a;
    const an = a.anim;
    let tx = NaN;
    let tz = NaN;
    if (!Number.isNaN(this.playerX)) {
      const dx = this.playerX - w.x;
      const dz = this.playerZ - w.z;
      const d = Math.hypot(dx, dz);
      // Con el teléfono, levanta la vista sólo si se le acerca mucho.
      const reach = an.gesture === 'phone' ? 1.8 : 4;
      if (d < reach && d > 0.3 && (dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw)) / d > -0.2) {
        tx = this.playerX;
        tz = this.playerZ;
        if (d < 2.6 && !an.gesture && this.rt.chance(dt * 0.15)) startGesture(an, 'nod');
      }
    }
    if (Number.isNaN(tx) && w.mode === 'cross' && w.cross) {
      // Antes de bajar a la calzada y en la primera mano: mirar si vienen
      // autos. Primero a la izquierda (de ahí vienen los de la mano de acá) y
      // después a la derecha.
      const road = w.cross.edgeFrom - w.cLat - this.laneHalf;
      if (w.cs > road - 2.2 && w.cs < road + this.laneHalf) {
        const s = Math.sin(this.time * 1.1 + an.seed * 10) > -0.3 ? 1 : -1;
        tx = w.x - w.cnz * s * 8 + w.cnx * 2;
        tz = w.z + w.cnx * s * 8 + w.cnz * 2;
      }
    }
    if (Number.isNaN(tx) && an.gesture !== 'phone') {
      const g = w.mode === 'sit' ? w.group : null;
      const o = w.lead ?? w.mate ?? (g ? (g[0] === w ? g[1] : g[0]) : null);
      if (o && !o.a.hidden && w.talkT > (w.lead ? 1.5 : 2.5)) {
        tx = o.x;
        tz = o.z;
      }
    }
    if (!Number.isNaN(tx)) {
      const yaw = Math.atan2(tx - w.x, tz - w.z);
      an.lookYaw += (clamp(wrap(yaw - a.yaw), -1.2, 1.2) - an.lookYaw) * Math.min(1, dt * 4);
      an.lookPitch += (0 - an.lookPitch) * Math.min(1, dt * 4);
      an.lookW = Math.min(1, an.lookW + dt * 2);
    } else an.lookW = Math.max(0, an.lookW - dt * 1.5);
  }

  /** Posición del `Agent` (local de la escuela, que es lo que dibuja `Population`). */
  private sync(w: Walker): void {
    const a = w.a;
    a.u = this.frame.ox - w.x;
    a.v = w.z - this.frame.oz;
    a.y = w.y;
  }

  private locate(w: Walker): void {
    if (w.lead) {
      const L = w.lead;
      w.offX = NX[L.side] * PAIR_GAP;
      w.offZ = NZ[L.side] * PAIR_GAP;
      w.x = L.x + w.offX;
      w.z = L.z + w.offZ;
      w.y = L.y;
      w.a.yaw = w.a.wantYaw = L.a.yaw;
      setBase(w.a.anim, 'walk');
      w.a.anim.w = 1;
      this.sync(w);
      return;
    }
    if (w.mode !== 'walk') return;
    const p = { x: 0, z: 0 };
    this.pos(this.loops[w.loop], w.side, w.along, w.lat, p);
    w.x = p.x;
    w.z = p.z;
    w.a.yaw = w.a.wantYaw = Math.atan2(w.side % 2 === 0 ? w.dir : 0, w.side % 2 === 0 ? 0 : w.dir);
    this.sync(w);
  }

  // ============================================================ el tránsito

  /**
   * ¿Hay alguien en la senda más cercana a (x, z) sobre la calle que corre a lo
   * largo de `axis`, o a menos de ~1,5 s de bajar a la calzada? Lo consulta el
   * tránsito en las sendas sin semáforo: el auto frena y cede el paso. Sólo
   * quien decide (la pareja va a su lado) y sólo quien ya arrancó a cruzar.
   */
  zebraBusy(x: number, z: number, axis: 'x' | 'z'): boolean {
    // La cebra más cercana de esa calle (unas 50 en todo el barrio).
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.zebras.length; i++) {
      const q = this.zebras[i];
      if (q.axis !== axis) continue;
      const d = (q.x - x) ** 2 + (q.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return false;
    for (const w of this.crossers) {
      if (w.lead || w.mode !== 'cross') continue;
      const c = w.cross!;
      if (c.zebra !== best) continue;
      // Tramo de calzada, medido sobre el avance del cruce.
      const mid = c.edgeFrom - w.cLat;
      if (w.cs >= mid - this.laneHalf - w.cruise * 1.5 && w.cs <= mid + this.laneHalf + 0.3) return true;
    }
    return false;
  }

  /**
   * ¿Alguien cruzando (en la calzada o por bajar) a menos de `r` de (x, z)?
   * Para `TrafficSim.setPedestrianQuery`: el auto que dobla con verde sobre
   * la senda de la calle que tiene rojo no le pasa por encima a nadie.
   */
  crossingNear(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    for (const w of this.crossers) if ((w.x - x) ** 2 + (w.z - z) ** 2 < r2) return true;
    return false;
  }

  /** Piso a una distancia `d` del eje de una calle. */
  groundAt(d: number, raised: boolean): number {
    const road = this.laneHalf;
    if (d <= road) return 0.08;
    if (!raised) return 0;
    const top = road + KERB + RAMP_LEN;
    if (d >= top) return SIDEWALK_H;
    return 0.09 + (SIDEWALK_H - 0.09) * clamp((d - road) / (KERB + RAMP_LEN), 0, 1);
  }
}

/** Sacos y tapados de calle (oscuros, nada que se confunda con un guardapolvo). */
const COATS = ['#2f3640', '#4a3b32', '#5b5f66', '#3b4a5c', '#6b4f3a', '#2e3b2f'].map(hexRgb);
