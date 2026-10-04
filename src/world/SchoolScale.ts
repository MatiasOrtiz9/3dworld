import { SC, SCHOOL, type Facing, type Opening, type Item, type Landing, type Level, type P, type Rect, type Stair, type Volume, type Wall } from './SchoolBase';

/**
 * Pasada del plano CAD a metros reales (ver `SC` en `SchoolBase`).
 *
 * El plano se había registrado con 67,4 m de frente y el edificio real mide
 * ~78 m: todo se escala en planta, con centro en la esquina de Laprida y
 * Miguel Cané (u = 0, v = 0). Una escala uniforme lleva rectas a rectas y
 * conserva los ángulos, así que muros, vanos, ambientes, escaleras, descansos
 * y huecos quedan exactos (la diagonal de Miguel Cané y la medianera siguen
 * siendo rectas con la misma pendiente, y los tramos que se tocaban se siguen
 * tocando). Lo único que pide criterio es el equipamiento: un pupitre no se
 * agranda porque el aula sea más grande, y lo que iba contra la pared tiene
 * que seguir contra la pared (si se escalara su centro, se despegaría unos
 * centímetros del muro). Eso lo resuelven las reglas de `scaleItems`.
 *
 * Funciones puras: sólo dependen de `SchoolBase`. Con `SC = 1` todo es la
 * identidad (las distancias medidas sobre muros iguales dan iguales).
 */

export const S = (p: P): P => [p[0] * SC, p[1] * SC];

type Lines<T> = { readonly [K in keyof T]: T[K] extends readonly number[] ? readonly number[] : number };
/** Líneas del plano (objeto de números o de listas de números) → reales. */
export function scaleLines<T extends Record<string, number | readonly number[]>>(o: T): Lines<T> {
  const out: Record<string, number | readonly number[]> = {};
  for (const k of Object.keys(o)) {
    const x = o[k];
    out[k] = typeof x === 'number' ? x * SC : x.map((y) => y * SC);
  }
  return out as Lines<T>;
}

/**
 * Hoja simple más ancha que se acepta. En el CAD achicado las puertas medían
 * 0,70–1,2 m; escaladas, las del CAD de 0,70–0,77 pasan a 0,81–0,89 (lo real),
 * pero nueve superaban 1,2 m, que ya no es una hoja simple (HANDOFF 88). Las
 * que ya eran anchas en el plano no se achican.
 */
const MAX_LEAF: Partial<Record<Opening['type'], number>> = {
  door: 1.1,
  // Las hojas de las puertas dobles y de las salidas también son de fábrica:
  // con la escala, un portón de 2,8 m pasaba a 3,24 y una salida a 2,66.
  double: 2.6,
  exit: 2.2,
};

/**
 * Vanos que conservan el ancho del plano (centro del vano en metros del
 * plano y nivel). Cada uno con su porqué.
 */
const KEEP_WIDTH: ReadonlySet<string> = new Set([
  // Puerta del comedor al patio este, debajo de la escalera blanca: su mitad
  // sur ya queda bajo el tramo (a menos de 2,1 m); más ancha, sólo sumaba
  // vano bajo la escalera, por donde no se pasa.
  '32.48,-15.70#0',
]);

export function scaleWall(w: Wall): Wall {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return {
    ...w,
    a: S(w.a),
    b: S(w.b),
    openings: w.openings.map((o) => {
      const c = ((o.t0 + o.t1) / 2) * SC;
      let half = ((o.t1 - o.t0) / 2) * SC;
      // El centro se conserva: el juego encuentra las puertas por cercanía.
      const cap = MAX_LEAF[o.type];
      if (cap !== undefined) half = Math.min(half, Math.max(o.t1 - o.t0, cap) / 2);
      const t = (o.t0 + o.t1) / 2 / len;
      const key = `${(w.a[0] + (w.b[0] - w.a[0]) * t).toFixed(2)},${(w.a[1] + (w.b[1] - w.a[1]) * t).toFixed(2)}#${w.level}`;
      if (KEEP_WIDTH.has(key)) half = (o.t1 - o.t0) / 2;
      return { ...o, t0: c - half, t1: c + half };
    }),
  };
}

export const scalePoly = (poly: readonly P[]): P[] => poly.map(S);
export function scaleRect<T extends Rect>(r: T): T {
  return { ...r, u0: r.u0 * SC, v0: r.v0 * SC, u1: r.u1 * SC, v1: r.v1 * SC };
}
export const scaleStair = (s: Stair): Stair => scaleRect(s);
export const scaleLanding = (l: Landing): Landing => scaleRect(l);
export const scaleVolume = (v: Volume): Volume => ({ ...v, poly: scalePoly(v.poly) });

// ================================================================ equipamiento

function wallThickness(w: Wall): number {
  return w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT;
}

interface WallHit {
  /** Índice del muro en la lista (el real tiene el mismo). */
  i: number;
  gap: number;
}

/**
 * Muro que tiene detrás un punto (la cara trasera de algo que mira hacia
 * `face`) y la distancia a su cara, en una lista de muros cualquiera. Es la
 * misma cuenta que `wallGapBehind` de `SchoolLayout`, pero sirve para los muros
 * del plano y los reales a la vez.
 */
export function wallBehindIn(walls: readonly Wall[], level: Level, u: number, v: number, face: Facing): WallHit | null {
  const fu = face === 'e' ? 1 : face === 'w' ? -1 : 0;
  const fv = face === 's' ? 1 : face === 'n' ? -1 : 0;
  let best: WallHit | null = null;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (w.level !== level) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    const ru = u - w.a[0];
    const rv = v - w.a[1];
    const t = ru * du + rv * dv;
    if (t < 0 || t > len) continue;
    const n = -ru * dv + rv * du;
    const facing = fu * -dv + fv * du;
    if (Math.abs(facing) < 0.5 || facing * n <= 0) continue;
    const gap = Math.abs(n) - wallThickness(w) / 2;
    if (gap > -0.1 && gap < 1 && (!best || gap < best.gap)) best = { i, gap };
  }
  return best;
}

/** Distancia a la cara del muro de atrás (`Infinity` si no hay a menos de 1 m). */
export function wallGapBehindIn(walls: readonly Wall[], level: Level, u: number, v: number, face: Facing): number {
  return wallBehindIn(walls, level, u, v, face)?.gap ?? Infinity;
}

/**
 * Corrimiento a lo largo de un eje (`axis` 0 = u, 1 = v) que deja el punto
 * `p` (ya escalado) a la distancia `gap` de la cara del muro real `w`, del
 * mismo lado. Con un muro en diagonal (Miguel Cané, la medianera) se mueve
 * sobre el eje, no sobre la normal: así los dos ejes se resuelven por separado.
 */
function shiftToGap(w: Wall, p: P, gap: number, side: number, axis: 0 | 1): number {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const du = (w.b[0] - w.a[0]) / len;
  const dv = (w.b[1] - w.a[1]) / len;
  const n = -(p[0] - w.a[0]) * dv + (p[1] - w.a[1]) * du;
  const target = side * (wallThickness(w) / 2 + gap);
  // Componente de la normal (−dv, du) sobre el eje.
  const k = axis === 0 ? -dv : du;
  if (Math.abs(k) < 1e-6) return 0;
  return (target - n) / k;
}

/** Hasta dónde una cara trasera cuenta como "contra el muro", y una lateral. */
const BACK_ANCHOR = 0.35;
const SIDE_ANCHOR = 0.15;

/**
 * Lo que puede estirarse si toca muros en sus dos extremos: vigas, espejos,
 * barras, mesadas, bancos corridos y revestimientos que cubren un paño de
 * pared a pared. El resto (pupitres, sillas, mesas, boxes, piano…) tiene
 * medida de fábrica: queda contra el primer muro y la luz aparece del otro lado.
 */
const STRETCH: ReadonlySet<Item['kind']> = new Set<Item['kind']>([
  'wallPanel',
  'mirror',
  'barre',
  'counter',
  'sinkCounter',
  'buffetLine',
  'lockers',
  'benchSeat',
  'greenWall',
  'wallMat',
  'stage',
  'bleachers',
  'risers',
  'planter',
  'trophyShelf',
  'pendantRail',
  'coatBench',
  'bench',
  'seats',
]);

/** Ligados a un vano (que se escala): su largo sobre el muro también. */
const OPENING_BOUND: ReadonlySet<Item['kind']> = new Set<Item['kind']>(['gate', 'curtain', 'louvredDoor']);

/**
 * Superficies del plano: las guirnaldas se agrandan con el patio. Los cercos
 * vivos NO: son plantas (medida real, como los árboles); su fila sigue junta
 * porque las matas se tocan y van en `GROUPABLE`.
 */
const SURFACE: ReadonlySet<Item['kind']> = new Set<Item['kind']>(['bunting']);

/**
 * Pintura y vinílico de piso: pasan por la escala uniforme entera (centro y
 * las dos medidas × SC), sin anclarse a muros ni agruparse. Una pista pintada
 * es parte del plano, no un mueble: anclada sólo de un lado o en un solo eje
 * quedaba 1,3 m corta en cada punta (pista azul del Aula Maker) o estirada en
 * un solo sentido (franja del hall). Escalada entera nunca se mete más en un
 * muro que en el plano (el muro no engorda).
 */
const UNIFORM: ReadonlySet<Item['kind']> = new Set<Item['kind']>(['floorPatch']);

/**
 * Muebles que forman un conjunto rígido si se tocan: la silla metida bajo el
 * pupitre, las sillas de una mesa, una fila de boxes. Escalados uno por uno
 * se despegaban (9 cm entre la silla y el pupitre).
 */
const GROUPABLE: ReadonlySet<Item['kind']> = new Set<Item['kind']>([
  'desk',
  'chair',
  'table',
  'hexTable',
  'roundTable',
  'teacherDesk',
  'stool',
  'plasticChair',
  'cafeTable',
  'boxBench',
  'stall',
  'longTable',
  'benchSeat',
  'workbench',
  'desk2',
  'bench',
  'piano',
  'drumKit',
  'stack',
  'pot',
  'copier',
  'filing',
  'drawers',
  'cabinet',
  'laserCutter',
  'printer3d',
  'hedge',
]);
const GROUP_GAP = 0.12;

/**
 * Excepciones puntuales, por clave `${kind}@${u},${v}#${level}` en metros del
 * plano (dos decimales). 'scale': centro escalado sin anclar; [du, dv]:
 * corrimiento real extra después de las reglas. Cada entrada con su porqué.
 */
export const ITEM_OVERRIDES: Readonly<Record<string, 'scale' | readonly [number, number]>> = {};

const keyOf = (it: Item): string => `${it.kind}@${it.u.toFixed(2)},${it.v.toFixed(2)}#${it.level ?? 0}`;

/** ¿El punto cae sobre un vano de algún muro del nivel (en metros del plano)? */
function onOpening(walls: readonly Wall[], level: Level, u: number, v: number): boolean {
  for (const w of walls) {
    if (w.level !== level || w.openings.length === 0) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    const t = (u - w.a[0]) * du + (v - w.a[1]) * dv;
    const n = Math.abs(-(u - w.a[0]) * dv + (v - w.a[1]) * du);
    if (n > wallThickness(w) / 2 + 0.3) continue;
    if (w.openings.some((o) => t >= o.t0 - 0.2 && t <= o.t1 + 0.2)) return true;
  }
  return false;
}

/**
 * Un telón que no está en un vano cuelga del borde de un escenario: toma el
 * centro y el largo REALES del escenario sobre su eje largo. Escalado por su
 * cuenta, el del SUM del jardín medía 6,48 m sobre un escenario de 5,60 (que
 * no se estira porque no toca muros en las dos puntas): una pata quedaba en
 * el aire y se veía pared blanca entre el fondo y el telón.
 */
function followStage(items: readonly Item[], out: Item[]): void {
  for (let k = 0; k < items.length; k++) {
    const c = items[k];
    if (c.kind !== 'curtain') continue;
    const level = c.level ?? 0;
    const alongU = c.w >= c.d;
    for (let j = 0; j < items.length; j++) {
      const s = items[j];
      if (s.kind !== 'stage' || (s.level ?? 0) !== level) continue;
      const near = alongU
        ? Math.abs(s.u - c.u) < 0.3 && Math.abs(s.v - c.v) <= (s.d + c.d) / 2 + 0.2
        : Math.abs(s.v - c.v) < 0.3 && Math.abs(s.u - c.u) <= (s.w + c.w) / 2 + 0.2;
      if (!near) continue;
      const r = out[j];
      out[k] = alongU ? { ...out[k], u: r.u, w: r.w } : { ...out[k], v: r.v, d: r.d };
      break;
    }
  }
}

interface Report {
  anchored: number;
  stretched: number;
  grouped: number;
  scaled: number;
}
const report: Report = { anchored: 0, stretched: 0, grouped: 0, scaled: 0 };
/** Cuántos ítems resolvió cada regla (diagnóstico). */
export function scaleReport(): Readonly<Report> {
  return report;
}

interface Side {
  /** Coordenada del plano de esa cara del ítem. */
  c: number;
  /** Coordenada real de esa cara si queda anclada; `null` si no toca muro. */
  real: number | null;
}

/**
 * Equipamiento del plano → real. Reglas, en orden:
 * 1. Anclaje: una cara trasera a ≤ 0,35 m de un muro (o una lateral a ≤ 0,15)
 *    queda a la MISMA distancia de la cara del muro escalado.
 * 2. Estirado: si toca muros en los dos extremos de un eje y es de los que
 *    cubren un paño (`STRETCH`), su largo pasa a la luz real menos las dos
 *    distancias; si no, queda contra el primer muro.
 * 3. Ligados a un vano (rejas, cortinas): su largo sobre el muro × SC.
 * 4. Superficies (`SURFACE`): w y d × SC donde no quedaron ancladas.
 * 5. Grupos rígidos: muebles que se tocan se mueven juntos (con el
 *    corrimiento de sus anclados en cada eje, o con el de su centroide).
 * 6. El resto: centro escalado, medida real.
 */
export function scaleItems(items: readonly Item[], planWalls: readonly Wall[], realWalls: readonly Wall[]): Item[] {
  report.anchored = report.stretched = report.grouped = report.scaled = 0;
  const n = items.length;
  // Resultado de las reglas 1–4 por ítem: centro y medida reales, y en qué ejes quedó anclado.
  const out: Item[] = new Array<Item>(n);
  const anchoredAxis: Array<[boolean, boolean]> = new Array<[boolean, boolean]>(n);
  // Anclajes contra muros en diagonal: si el grupo corre el ítem sobre el
  // otro eje, la distancia a la diagonal cambia y hay que volver a medirla.
  const diagonal: Array<Array<{ axis: 0 | 1; hi: boolean; i: number; gap: number; nside: number }>> = Array.from({ length: n }, () => []);

  for (let k = 0; k < n; k++) {
    const it = items[k];
    const level = it.level ?? 0;
    const ov = ITEM_OVERRIDES[keyOf(it)];
    if (ov === 'scale' || SC === 1) {
      out[k] = { ...it, u: it.u * SC, v: it.v * SC };
      anchoredAxis[k] = [SC === 1, SC === 1];
      continue;
    }
    if (UNIFORM.has(it.kind)) {
      const o: Item = { ...it, u: it.u * SC, v: it.v * SC, w: it.w * SC, d: it.d * SC };
      // Si su cara trasera iba contra un muro, se corre (sin cambiar medida)
      // para quedar a la misma distancia: igual que un mueble, pero entera.
      const axis: 0 | 1 = it.face === 'e' || it.face === 'w' ? 0 : 1;
      const sgn = it.face === 'e' || it.face === 's' ? -1 : 1;
      const bp: P = axis === 0 ? [it.u + (sgn * it.w) / 2, it.v] : [it.u, it.v + (sgn * it.d) / 2];
      const hit = wallBehindIn(planWalls, level, bp[0], bp[1], it.face);
      if (hit && hit.gap <= BACK_ANCHOR) {
        const pw = planWalls[hit.i];
        const len = Math.hypot(pw.b[0] - pw.a[0], pw.b[1] - pw.a[1]);
        const nside = Math.sign(-(bp[0] - pw.a[0]) * ((pw.b[1] - pw.a[1]) / len) + (bp[1] - pw.a[1]) * ((pw.b[0] - pw.a[0]) / len));
        const rp: P = axis === 0 ? [o.u + (sgn * o.w) / 2, o.v] : [o.u, o.v + (sgn * o.d) / 2];
        const sh = shiftToGap(realWalls[hit.i], rp, hit.gap, nside, axis);
        if (axis === 0) o.u += sh;
        else o.v += sh;
      }
      out[k] = o;
      anchoredAxis[k] = [false, false];
      continue;
    }
    // Una reja o cortina sigue a su vano sólo si de verdad está en uno: el
    // telón de un escenario cuelga delante de un muro ciego y tiene que medir
    // lo que mide el escenario (ver `followStage`).
    const bound = OPENING_BOUND.has(it.kind) && (it.kind !== 'curtain' || onOpening(planWalls, level, it.u, it.v));
    const res: [number, number] = [0, 0];
    const size: [number, number] = [it.w, it.d];
    const anch: [boolean, boolean] = [false, false];
    for (const axis of [0, 1] as const) {
      const center = axis === 0 ? it.u : it.v;
      const half = (axis === 0 ? it.w : it.d) / 2;
      // Cara "menor" (oeste o norte) y "mayor" (este o sur) sobre el eje.
      const lo: Side = { c: center - half, real: null };
      const hi: Side = { c: center + half, real: null };
      const loFace: Facing = axis === 0 ? 'e' : 's'; // mirando hacia +, el muro queda atrás (−)
      const hiFace: Facing = axis === 0 ? 'w' : 'n';
      // Umbral de cada lado: la cara opuesta al frente es la trasera; las
      // laterales cuentan sólo al ras. Lo ligado a un vano no se ancla sobre
      // su largo (sigue al vano, que se escala).
      const backIsHi = it.face === hiFace;
      const lateral = (axis === 0 ? 'ns' : 'ew').includes(it.face);
      const boundAxis = bound && (axis === 0 ? it.w >= it.d : it.d > it.w);
      const sideThr = lateral && !boundAxis ? SIDE_ANCHOR : -1;
      const thrLo = it.face === loFace ? BACK_ANCHOR : sideThr;
      const thrHi = backIsHi ? BACK_ANCHOR : sideThr;
      for (const [side, face, thr] of [
        [lo, loFace, thrLo],
        [hi, hiFace, thrHi],
      ] as const) {
        if (thr < 0) continue;
        const pu = axis === 0 ? side.c : it.u;
        const pv = axis === 0 ? it.v : side.c;
        const hit = wallBehindIn(planWalls, level, pu, pv, face);
        if (!hit || hit.gap > thr) continue;
        // El muro real correspondiente y de qué lado queda el ítem.
        const pw = planWalls[hit.i];
        const len = Math.hypot(pw.b[0] - pw.a[0], pw.b[1] - pw.a[1]);
        const nside = Math.sign(-(pu - pw.a[0]) * ((pw.b[1] - pw.a[1]) / len) + (pv - pw.a[1]) * ((pw.b[0] - pw.a[0]) / len));
        const sp: P = [pu * SC, pv * SC];
        side.real = side.c * SC + shiftToGap(realWalls[hit.i], sp, hit.gap, nside, axis);
        if (Math.abs(pw.a[0] - pw.b[0]) > 1e-6 && Math.abs(pw.a[1] - pw.b[1]) > 1e-6) {
          diagonal[k].push({ axis, hi: side === hi, i: hit.i, gap: hit.gap, nside });
        }
      }
      const scaleSize = boundAxis || (SURFACE.has(it.kind) && lo.real === null && hi.real === null);
      const sz = scaleSize ? 2 * half * SC : 2 * half;
      if (lo.real !== null && hi.real !== null) {
        anch[axis] = true;
        if (STRETCH.has(it.kind)) {
          res[axis] = (lo.real + hi.real) / 2;
          size[axis] = Math.max(sz, hi.real - lo.real);
          report.stretched++;
        } else {
          // Medida de fábrica: contra la cara trasera si la hay, si no la menor.
          const useHi = backIsHi;
          res[axis] = useHi ? (hi.real as number) - sz / 2 : (lo.real as number) + sz / 2;
          size[axis] = sz;
        }
      } else if (lo.real !== null) {
        anch[axis] = true;
        res[axis] = lo.real + sz / 2;
        size[axis] = sz;
      } else if (hi.real !== null) {
        anch[axis] = true;
        res[axis] = hi.real - sz / 2;
        size[axis] = sz;
      } else {
        res[axis] = center * SC;
        size[axis] = sz;
      }
    }
    if (anch[0] || anch[1]) report.anchored++;
    out[k] = { ...it, u: res[0], v: res[1], w: size[0], d: size[1] };
    anchoredAxis[k] = anch;
  }

  // 5. Grupos rígidos: unión de muebles que se tocan, del mismo nivel y al piso.
  if (SC !== 1) {
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const cand: number[] = [];
    for (let k = 0; k < n; k++) {
      const it = items[k];
      if (GROUPABLE.has(it.kind) && (it.y ?? 0) < 0.3 && ITEM_OVERRIDES[keyOf(it)] !== 'scale') cand.push(k);
    }
    for (let x = 0; x < cand.length; x++) {
      const a = items[cand[x]];
      for (let y = x + 1; y < cand.length; y++) {
        const b = items[cand[y]];
        if ((a.level ?? 0) !== (b.level ?? 0)) continue;
        if (Math.abs(a.u - b.u) <= (a.w + b.w) / 2 + GROUP_GAP && Math.abs(a.v - b.v) <= (a.d + b.d) / 2 + GROUP_GAP) {
          parent[find(cand[x])] = find(cand[y]);
        }
      }
    }
    const groups = new Map<number, number[]>();
    for (const k of cand) {
      const r = find(k);
      const g = groups.get(r);
      if (g) g.push(k);
      else groups.set(r, [k]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const delta: [number, number] = [0, 0];
      for (const axis of [0, 1] as const) {
        const anchored = g.filter((k) => anchoredAxis[k][axis]);
        const from = anchored.length > 0 ? anchored : g;
        let sum = 0;
        for (const k of from) {
          const p = axis === 0 ? items[k].u : items[k].v;
          const q = axis === 0 ? out[k].u : out[k].v;
          sum += anchored.length > 0 ? q - p : p * SC - p;
        }
        delta[axis] = sum / from.length;
      }
      for (const k of g) {
        // Los anclados conservan su lugar; los demás siguen al conjunto.
        const it = items[k];
        out[k] = {
          ...out[k],
          u: anchoredAxis[k][0] ? out[k].u : it.u + delta[0],
          v: anchoredAxis[k][1] ? out[k].v : it.v + delta[1],
        };
        report.grouped++;
      }
    }
  }

  // Contra una diagonal, se vuelve a medir con la posición final sobre el
  // otro eje (sólo los anclados de un lado: los estirados no van en diagonal).
  for (let k = 0; k < n; k++) {
    for (const d of diagonal[k]) {
      if (diagonal[k].some((e) => e !== d && e.axis === d.axis)) continue;
      const o = out[k];
      const half = (d.axis === 0 ? o.w : o.d) / 2;
      const c = (d.axis === 0 ? o.u : o.v) + (d.hi ? half : -half);
      const p: P = d.axis === 0 ? [c, o.v] : [o.u, c];
      const sh = shiftToGap(realWalls[d.i], p, d.gap, d.nside, d.axis);
      out[k] = d.axis === 0 ? { ...o, u: o.u + sh } : { ...o, v: o.v + sh };
    }
  }

  followStage(items, out);

  for (let k = 0; k < n; k++) {
    const ov = ITEM_OVERRIDES[keyOf(items[k])];
    if (Array.isArray(ov)) out[k] = { ...out[k], u: out[k].u + ov[0], v: out[k].v + ov[1] };
    if (!anchoredAxis[k][0] && !anchoredAxis[k][1]) report.scaled++;
  }
  return out;
}
