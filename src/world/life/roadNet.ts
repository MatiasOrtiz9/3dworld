/**
 * La red de calles del barrio, vista por un auto: carriles con sentido,
 * esquinas y los giros posibles en cada una.
 *
 * Datos puros (no importa nada del motor): sale del mismo `CityPlan` que
 * dibuja las calzadas, así que los autos andan exactamente sobre el asfalto
 * que se ve, respetan `span` (la calle existe sólo a lo largo del barrio) y
 * `gaps` (entre las dos manzanas de la escuela la calle no existe: ahí el
 * cruce queda en T y nadie atraviesa el predio).
 *
 * Mano derecha, como en la Argentina. En Babylon (zurdo, y = arriba) la
 * derecha de un rumbo (dx, dz) es (dz, −dx).
 */
import { CROSS_AT, type CityPlan, type Street } from '../CityLayout';

/** Proporción de la calle que es calzada (la misma que dibuja InfraBuilder). */
export const ROADWAY_FRACTION = 0.42;
/** Altura de la calzada sobre el suelo (la caja de 8 cm de InfraBuilder). */
export const ROAD_Y = 0.08;
/**
 * Línea de detención: cuántos metros antes del borde de la calzada que se
 * cruza frena un auto. Deja libre el paso peatonal de la esquina.
 */
export const STOP_SETBACK = 2.0;
/**
 * Tramo fuera del barrio por donde los autos entran y salen. Las calles
 * terminan en el borde del barrio; el auto aparece o desaparece ahí, lejos y
 * entre la niebla, en vez de pegar la vuelta en una calle que sigue.
 */
export const RUNOUT = 24;
/**
 * Medio ancho de la senda peatonal (la cebra de InfraBuilder va de
 * CROSS_AT − 1,3 a CROSS_AT + 1,3 m del centro de la esquina).
 */
export const ZEBRA_HALF = 1.3;
/** Un tramo de calle más corto que esto después de una esquina no es un brazo. */
const MIN_ARM = 9;

export type EndKind = 'node' | 'portal' | 'dead';
export type TurnKind = 'straight' | 'right' | 'left' | 'uturn';

/** Un recorrido: polilínea con longitudes acumuladas. */
export interface Path {
  id: number;
  kind: 'lane' | 'turn';
  xs: number[];
  zs: number[];
  cum: number[];
  length: number;
  // ---- carriles
  /** Calle (índice en plan.streets) y su eje. */
  street: number;
  axis: 'x' | 'z';
  /** Rumbo del carril (unitario, sobre un eje). */
  hx: number;
  hz: number;
  startKind: EndKind;
  endKind: EndKind;
  /** Esquina donde termina el carril (−1 si no termina en una). */
  endNode: number;
  /** Giros que salen del final de este carril. */
  turns: number[];
  /** Hay que detenerse antes de entrar a la esquina (calle secundaria en T). */
  mustStop: boolean;
  /**
   * Cuánto antes del final del carril se espera (m). En los cruces con
   * semáforo la línea de detención está retirada: deja doblar a un
   * colectivo, que con la cola barre la esquina por dentro.
   */
  stopBack: number;
  // ---- giros
  node: number;
  turn: TurnKind;
  inLane: number;
  outLane: number;
}

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  /** Brazos presentes, por rumbo saliente: '+x', '-x', '+z', '-z'. */
  arms: string[];
  /** Esquina con semáforo: cruce de cuatro brazos. */
  signal: boolean;
  /** Giros de esta esquina. */
  turns: number[];
  /** conflicts[i][j]: los giros turns[i] y turns[j] no pueden ocuparse a la vez. */
  conflicts: boolean[][];
  /** Lo mismo con un vehículo ancho (colectivo): su caja barre más que la línea del giro. */
  conflictsWide: boolean[][];
  /** Media calzada de cada calle del cruce, por eje. */
  halfX: number;
  halfZ: number;
}

export interface RoadNet {
  paths: Path[];
  nodes: RoadNode[];
  /** Carriles que entran al barrio desde afuera. */
  entries: number[];
  /** Media calzada típica (para pruebas y para ubicar cosas en la vereda). */
  half: number;
}

const armKey = (hx: number, hz: number): string =>
  hx > 0.5 ? '+x' : hx < -0.5 ? '-x' : hz > 0.5 ? '+z' : '-z';

/** Tramos donde la calle existe: su `span` menos sus `gaps`. */
function pieces(st: Street, extent: number): Array<[number, number]> {
  const [a, b] = st.span ?? [-extent, extent];
  let out: Array<[number, number]> = [[a, b]];
  for (const [g0, g1] of st.gaps ?? []) {
    const next: Array<[number, number]> = [];
    for (const [p0, p1] of out) {
      if (g1 <= p0 || g0 >= p1) next.push([p0, p1]);
      else {
        if (g0 > p0) next.push([p0, g0]);
        if (g1 < p1) next.push([g1, p1]);
      }
    }
    out = next;
  }
  return out;
}

const exists = (st: Street, at: number, extent: number): boolean =>
  pieces(st, extent).some(([p0, p1]) => at >= p0 - 1e-6 && at <= p1 + 1e-6);

function makePath(id: number, kind: 'lane' | 'turn', xs: number[], zs: number[]): Path {
  const cum = [0];
  for (let i = 1; i < xs.length; i++)
    cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  return {
    id,
    kind,
    xs,
    zs,
    cum,
    length: cum[cum.length - 1],
    street: -1,
    axis: 'x',
    hx: 0,
    hz: 0,
    startKind: 'node',
    endKind: 'node',
    endNode: -1,
    turns: [],
    mustStop: false,
    stopBack: 0,
    node: -1,
    turn: 'straight',
    inLane: -1,
    outLane: -1,
  };
}

/** Punto y rumbo a una distancia `s` de un recorrido; `hint` acelera la búsqueda del tramo. */
export function sampleAt(
  p: Path,
  s: number,
  out: { x: number; z: number; hx: number; hz: number; seg: number },
  hint = 0,
): void {
  const n = p.xs.length;
  let i = Math.max(0, Math.min(hint, n - 2));
  while (i < n - 2 && s > p.cum[i + 1]) i++;
  while (i > 0 && s < p.cum[i]) i--;
  const l = p.cum[i + 1] - p.cum[i] || 1;
  const t = Math.max(0, Math.min(1, (s - p.cum[i]) / l));
  const dx = p.xs[i + 1] - p.xs[i];
  const dz = p.zs[i + 1] - p.zs[i];
  out.x = p.xs[i] + dx * t;
  out.z = p.zs[i] + dz * t;
  out.hx = dx / l;
  out.hz = dz / l;
  out.seg = i;
}

/** Arma la red de carriles y esquinas del plano. */
export function buildRoadNet(plan: CityPlan): RoadNet {
  const extent = plan.extent;
  const paths: Path[] = [];
  const nodes: RoadNode[] = [];
  const nodeAt = new Map<string, number>();
  const half = (plan.streetWidth * ROADWAY_FRACTION) / 2;

  const getNode = (x: number, z: number): RoadNode => {
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    let id = nodeAt.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodeAt.set(key, id);
      nodes.push({
        id,
        x,
        z,
        arms: [],
        signal: false,
        turns: [],
        conflicts: [],
        conflictsWide: [],
        halfX: half,
        halfZ: half,
      });
    }
    return nodes[id];
  };

  // Lanes que terminan / empiezan en cada esquina, por brazo.
  const incoming = new Map<number, number[]>();
  const outgoing = new Map<number, number[]>();
  const push = (m: Map<number, number[]>, k: number, v: number) => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
  };

  plan.streets.forEach((st, si) => {
    const sh = (st.width * ROADWAY_FRACTION) / 2;
    const lane = sh / 2;
    const isX = st.axis === 'x';
    for (const [p0, p1] of pieces(st, extent)) {
      // Cruces con las calles del otro eje que existen en este punto.
      const crossings: Array<{ c: number; other: number }> = [];
      plan.streets.forEach((o, oi) => {
        if (o.axis === st.axis) return;
        if (o.at < p0 - 1e-6 || o.at > p1 + 1e-6) return;
        if (!exists(o, st.at, extent)) return;
        crossings.push({ c: o.at, other: oi });
      });
      crossings.sort((a, b) => a.c - b.c);
      // Estaciones: extremos del tramo y esquinas. Un extremo a menos de un
      // brazo de una esquina se descarta: el cruce queda en T (es el caso de
      // la calle cortada por la escuela).
      type Station = { at: number; kind: EndKind; node?: RoadNode; cross?: number };
      const stations: Station[] = [];
      const startIsPortal = st.span ? Math.abs(p0 - st.span[0]) < 1e-6 : true;
      const endIsPortal = st.span ? Math.abs(p1 - st.span[1]) < 1e-6 : true;
      const first = crossings[0];
      const last = crossings[crossings.length - 1];
      const crossHalf = (oi: number) => (plan.streets[oi].width * ROADWAY_FRACTION) / 2;
      if (!first || first.c - p0 > crossHalf(first.other) + MIN_ARM)
        stations.push({ at: p0, kind: startIsPortal ? 'portal' : 'dead' });
      for (const cr of crossings) {
        const x = isX ? cr.c : st.at;
        const z = isX ? st.at : cr.c;
        const node = getNode(x, z);
        if (isX) node.halfX = sh;
        else node.halfZ = sh;
        stations.push({ at: cr.c, kind: 'node', node, cross: crossHalf(cr.other) });
      }
      if (!last || p1 - last.c > crossHalf(last.other) + MIN_ARM)
        stations.push({ at: p1, kind: endIsPortal ? 'portal' : 'dead' });

      for (let k = 0; k + 1 < stations.length; k++) {
        const a = stations[k];
        const b = stations[k + 1];
        // Bordes del tramo útil: después de la línea de detención de cada
        // esquina, o el portal (más RUNOUT afuera), o el fondo de la calle.
        const from =
          a.kind === 'node'
            ? a.at + a.cross! + STOP_SETBACK
            : a.kind === 'portal'
              ? a.at - RUNOUT
              : a.at + 1.5;
        const to =
          b.kind === 'node'
            ? b.at - b.cross! - STOP_SETBACK
            : b.kind === 'portal'
              ? b.at + RUNOUT
              : b.at - 1.5;
        if (to - from < 4) continue;
        if (a.node) a.node.arms.push(isX ? '+x' : '+z');
        if (b.node) b.node.arms.push(isX ? '-x' : '-z');
        for (const dir of [1, -1] as const) {
          const hx = isX ? dir : 0;
          const hz = isX ? 0 : dir;
          // Derecha del rumbo: (hz, −hx).
          const ox = hz * lane;
          const oz = -hx * lane;
          const s0 = dir > 0 ? from : to;
          const s1 = dir > 0 ? to : from;
          const xs = isX ? [s0 + ox, s1 + ox] : [st.at + ox, st.at + ox];
          const zs = isX ? [st.at + oz, st.at + oz] : [s0 + oz, s1 + oz];
          const p = makePath(paths.length, 'lane', xs, zs);
          p.street = si;
          p.axis = st.axis;
          p.hx = hx;
          p.hz = hz;
          const startSt = dir > 0 ? a : b;
          const endSt = dir > 0 ? b : a;
          p.startKind = startSt.kind;
          p.endKind = endSt.kind;
          if (endSt.node) {
            p.endNode = endSt.node.id;
            push(incoming, endSt.node.id, p.id);
          }
          if (startSt.node) push(outgoing, startSt.node.id, p.id);
          paths.push(p);
        }
      }
    }
  });

  // Fondo de calle (no lo hay en el plano actual, pero el plano lo admite):
  // el auto pega la vuelta en U al carril de enfrente.
  for (const p of paths.slice()) {
    if (p.kind !== 'lane' || p.endKind !== 'dead') continue;
    const back = paths.find(
      (q) =>
        q.kind === 'lane' &&
        q.street === p.street &&
        q.startKind === 'dead' &&
        q.hx === -p.hx &&
        q.hz === -p.hz &&
        Math.hypot(q.xs[0] - p.xs[1], q.zs[0] - p.zs[1]) < 6,
    );
    if (!back) continue;
    const t = connector(paths.length, p, back, 'uturn');
    p.turns.push(t.id);
    paths.push(t);
  }

  for (const node of nodes) {
    node.signal = node.arms.length >= 4;
    const ins = incoming.get(node.id) ?? [];
    const outs = outgoing.get(node.id) ?? [];
    for (const li of ins) {
      const a = paths[li];
      for (const lo of outs) {
        const b = paths[lo];
        if (b.hx === -a.hx && b.hz === -a.hz) continue; // sin vueltas en U en las esquinas
        const cross = a.hx * b.hz - a.hz * b.hx;
        // Con y arriba y mano derecha: (dx,dz) → derecha (dz,−dx). El giro a
        // la derecha lleva el rumbo a esa dirección.
        const turn: TurnKind =
          Math.abs(cross) < 0.5 ? 'straight' : b.hx === a.hz && b.hz === -a.hx ? 'right' : 'left';
        const t = connector(paths.length, a, b, turn);
        t.node = node.id;
        a.turns.push(t.id);
        node.turns.push(t.id);
        paths.push(t);
      }
    }
    // Sin semáforo, en las T quien llega por la calle que termina (un solo
    // brazo) se detiene antes de entrar; la que sigue tiene prioridad. En una
    // esquina en L (dos brazos, la calle dobla) nadie para: sólo afloja.
    if (!node.signal && node.arms.length === 3) {
      for (const li of ins) {
        const p = paths[li];
        const sameStreet = ins.filter((q) => paths[q].street === p.street).length;
        if (sameStreet < 2) p.mustStop = true;
      }
    }
    for (const li of ins) {
      if (node.signal) paths[li].stopBack = 3.2;
      // Sin semáforo, todo el que espera (no sólo el del pare de la T) lo hace
      // con la trompa 25 cm detrás de la senda (que va de 4,9 a 7,5 m del
      // centro del cruce). Con la línea en el final del carril (a 5,15 m),
      // el auto que esperaba un hueco quedaba con la caja sobre la cebra y la
      // gente le pasaba a través. Sólo frena ahí quien no reservó el giro:
      // el que sigue de largo no se entera.
      else {
        const p = paths[li];
        const endFrom = Math.abs(
          p.axis === 'x' ? p.xs[p.xs.length - 1] - node.x : p.zs[p.zs.length - 1] - node.z,
        );
        p.stopBack = Math.max(0, CROSS_AT + ZEBRA_HALF + 0.25 - endFrom);
      }
    }
    // Conflictos: dos giros que se acercan a menos de 2,3 m en algún punto o
    // que desembocan en el mismo carril. También dos giros distintos desde el
    // mismo carril: van en fila, pero se separan adentro del cruce y la cola
    // de un colectivo que sigue derecho barre el giro del auto de atrás.
    const ts = node.turns.map((id) => paths[id]);
    const table = (clear: number) =>
      ts.map((a) =>
        ts.map((b) => {
          if (a === b) return true;
          if (a.inLane === b.inLane) return true;
          if (a.outLane === b.outLane) return true;
          for (let i = 0; i < a.xs.length; i++) {
            for (let j = 0; j < b.xs.length; j++) {
              if (Math.hypot(a.xs[i] - b.xs[j], a.zs[i] - b.zs[j]) < clear) return true;
            }
          }
          return false;
        }),
      );
    // Dos autos: medio ancho cada uno y medio metro de aire. Con un
    // colectivo, su medio ancho más lo que la caja se mete hacia adentro de
    // la curva (la cuerda entre ejes).
    node.conflicts = table(2.3);
    node.conflictsWide = table(3.7);
  }

  const entries = paths
    .filter((p) => p.kind === 'lane' && p.startKind === 'portal')
    .map((p) => p.id);
  return { paths, nodes, entries, half };
}

/**
 * Giro entre dos carriles: curva de Bézier cúbica entre el final de uno y el
 * comienzo del otro, con los manejadores sobre las rectas de los carriles
 * (0,55 de la distancia a su cruce: casi un cuarto de círculo).
 */
function connector(id: number, a: Path, b: Path, turn: TurnKind): Path {
  const x0 = a.xs[a.xs.length - 1];
  const z0 = a.zs[a.zs.length - 1];
  const x3 = b.xs[0];
  const z3 = b.zs[0];
  let x1: number, z1: number, x2: number, z2: number;
  if (turn === 'straight') {
    x1 = x0 + (x3 - x0) / 3;
    z1 = z0 + (z3 - z0) / 3;
    x2 = x0 + ((x3 - x0) * 2) / 3;
    z2 = z0 + ((z3 - z0) * 2) / 3;
  } else if (turn === 'uturn') {
    const w = Math.hypot(x3 - x0, z3 - z0);
    x1 = x0 + a.hx * w * 0.9;
    z1 = z0 + a.hz * w * 0.9;
    x2 = x3 + a.hx * w * 0.9;
    z2 = z3 + a.hz * w * 0.9;
  } else {
    // Cruce de las rectas de ambos carriles: x0 + a·t = x3 − b·u.
    const det = a.hx * -b.hz - a.hz * -b.hx;
    const rx = x3 - x0;
    const rz = z3 - z0;
    const t = (rx * -b.hz - rz * -b.hx) / det;
    const kx = x0 + a.hx * t;
    const kz = z0 + a.hz * t;
    const k1 = 0.552 * Math.hypot(kx - x0, kz - z0);
    const k2 = 0.552 * Math.hypot(x3 - kx, z3 - kz);
    x1 = x0 + a.hx * k1;
    z1 = z0 + a.hz * k1;
    x2 = x3 - b.hx * k2;
    z2 = z3 - b.hz * k2;
  }
  const n = turn === 'straight' ? 2 : 10;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    xs.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3);
    zs.push(u * u * u * z0 + 3 * u * u * t * z1 + 3 * u * t * t * z2 + t * t * t * z3);
  }
  const p = makePath(id, 'turn', xs, zs);
  p.turn = turn;
  p.inLane = a.id;
  p.outLane = b.id;
  p.street = a.street;
  p.axis = a.axis;
  p.hx = b.hx;
  p.hz = b.hz;
  return p;
}

/** Brazo (rumbo saliente) de un carril que entra a una esquina, visto desde la esquina. */
export function approachArm(p: Path): string {
  return armKey(-p.hx, -p.hz);
}
