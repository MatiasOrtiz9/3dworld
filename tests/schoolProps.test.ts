import { describe, expect, it } from 'vitest';
import {
  FENCES,
  ITEMS,
  LANDINGS,
  VOIDS,
  inRect,
  SCHOOL,
  STAIRS,
  WALLS,
  WALKABLE,
  ceilingHeight,
  hasFloor,
  roomAt,
  voidsAt,
  FURNITURE,
  PRIMARY_ROOMS,
  chairScaleOf,
  deskTopOf,
  furnitureSize,
  type Item,
  type Level,
  type Opening,
  type Stair,
  type Wall,
  riserCount,
  stairY,
  wallGapBehind,
} from '../src/world/SchoolLayout';
import { DOORS, isInteractiveDoor } from '../src/world/SchoolDoors';
import { SWITCHES } from '../src/world/SchoolLights';

/**
 * QA automático del equipamiento, los muros y las escaleras de la escuela.
 *
 * Cada objeto del plano se modela con las cajas que dibuja `SchoolBuilder`
 * (tapa de mesa, asiento y respaldo de silla, cuerpo de un mueble…) y se
 * revisa lo que en un juego se ve como "error de set": objetos metidos en un
 * muro o unos dentro de otros, fuera de su ambiente, flotando o enterrados,
 * atravesando el cielorraso, tapando una puerta; vanos superpuestos o
 * pegados a una esquina; escalones fuera de la medida humana; mesas, sillas
 * y pizarrones a alturas imposibles. Los contactos que existen en la
 * realidad (silla bajo la mesa, lo colgado del muro, lo apoyado encima de
 * otra cosa) están permitidos de forma explícita.
 */

type Box = { u0: number; v0: number; u1: number; v1: number; y0: number; y1: number; tag: string };

const level = (it: Item): Level => it.level ?? 0;
const alongV = (it: Item) => it.face === 'e' || it.face === 'w';
const faceDir = (f: Item['face']): [number, number] => (f === 'n' ? [0, -1] : f === 's' ? [0, 1] : f === 'e' ? [1, 0] : [-1, 0]);
const name = (it: Item) => `${it.kind}@${it.u.toFixed(2)},${it.v.toFixed(2)} L${level(it)}`;

function box(u: number, v: number, w: number, d: number, y0: number, y1: number, tag = 'body'): Box {
  return { u0: u - w / 2, v0: v - d / 2, u1: u + w / 2, v1: v + d / 2, y0, y1, tag };
}

/** Silla escolar: asiento (con sus patas) y respaldo hacia atrás. */
function chairBoxes(u: number, v: number, face: Item['face'], s = 1): Box[] {
  const [fu, fv] = faceDir(face);
  const seat = FURNITURE.seat * s;
  const out = [box(u, v, 0.42 * s, 0.42 * s, 0, seat, 'seat')];
  const bu = u - fu * 0.2 * s;
  const bv = v - fv * 0.2 * s;
  const across = fu !== 0;
  out.push(box(bu, bv, across ? 0.03 : 0.42 * s, across ? 0.42 * s : 0.03, seat + 0.02 * s, seat + 0.38 * s, 'back'));
  return out;
}

/** Sillas que el constructor reparte alrededor de una mesa redonda/hexagonal. */
function ringChairs(it: Item): Box[] {
  const out: Box[] = [];
  const small = it.kind === 'roundTable';
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const cu = it.u + Math.cos(a) * (it.w / 2 + FURNITURE.roundChair);
    const cv = it.v + Math.sin(a) * (it.w / 2 + FURNITURE.roundChair);
    const face: Item['face'] = Math.abs(Math.cos(a)) > 0.5 ? (Math.cos(a) > 0 ? 'w' : 'e') : Math.sin(a) > 0 ? 'n' : 's';
    out.push(...chairBoxes(cu, cv, face, small ? FURNITURE.smallScale : 1));
  }
  return out;
}

/**
 * Volumen de cada objeto, en metros sobre el piso de su nivel. Copia las
 * medidas de `SchoolBuilder.item` (si cambia una, cambia la otra).
 */
function boxes(it: Item): Box[] {
  const { u, v, w, d } = it;
  const y = it.y;
  const h = it.h;
  const V = alongV(it);
  const thin = (t: number, y0: number, y1: number, tag = 'body') => box(u, v, V ? t : w, V ? d : t, y0, y1, tag);
  const all = (y0: number, y1: number, tag = 'body') => box(u, v, w, d, y0, y1, tag);
  switch (it.kind) {
    case 'desk':
      return [all(deskTopOf(it) - 0.04, deskTopOf(it), 'top')];
    case 'table': {
      const top = deskTopOf(it);
      return [all(top - 0.05, top, 'top')];
    }
    case 'teacherDesk': {
      const out = [all(0.73, 0.78, 'top')];
      for (const s of [-1, 1]) {
        if (V) out.push(box(u, v + s * (d / 2 - 0.03), w, 0.05, 0, 0.73, 'side'));
        else out.push(box(u + s * (w / 2 - 0.03), v, 0.05, d, 0, 0.73, 'side'));
      }
      return out;
    }
    case 'desk2': {
      const out = [all(0.74, 0.78, 'top')];
      for (const s of [-1, 1]) {
        if (V) out.push(box(u, v + s * (d / 2 - 0.02), w, 0.04, 0, 0.74, 'side'));
        else out.push(box(u + s * (w / 2 - 0.02), v, 0.04, d, 0, 0.74, 'side'));
      }
      return out;
    }
    case 'workbench':
      return [all(0.74, 0.78, 'top')];
    case 'hexTable':
    case 'roundTable': {
      const top = it.kind === 'hexTable' ? FURNITURE.tableTop : FURNITURE.smallTable;
      return [box(u, v, w * 0.92, w * 0.92, top - 0.05, top, 'top'), box(u, v, 0.1, 0.1, 0, top, 'post'), ...ringChairs(it)];
    }
    case 'longTable': {
      const out = [all(0.74, 0.78, 'top')];
      for (const s of [-1, 1]) {
        if (w >= d) out.push(box(u, v + s * (d / 2 + 0.3), w - 0.2, 0.3, 0, 0.5, 'bench'));
        else out.push(box(u + s * (w / 2 + 0.3), v, 0.3, d - 0.2, 0, 0.5, 'bench'));
      }
      return out;
    }
    case 'chair':
      return chairBoxes(u, v, it.face, chairScaleOf(it));
    case 'plasticChair':
      return chairBoxes(u, v, it.face);
    case 'seats': {
      const n = Math.max(2, Math.round(Math.max(w, d) / 0.55));
      const out: Box[] = [];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n - 0.5;
        out.push(...chairBoxes(u + (V ? 0 : t * w), v + (V ? t * d : 0), it.face));
      }
      return out;
    }
    case 'stool':
      return [box(u, v, 0.34, 0.34, 0, 0.76)];
    case 'bench':
    case 'benchSeat':
      return [all(0, 0.48)];
    case 'coatBench': {
      const [fu, fv] = faceDir(it.face);
      return [all(0, 0.47), box(u - fu * (d / 2 - 0.02), v - fv * (d / 2 - 0.02), V ? 0.03 : w, V ? w : 0.03, 1.5, 1.78, 'rack')];
    }
    case 'board':
      return [thin(0.04, FURNITURE.boardBottom - 0.05, FURNITURE.boardTop + 0.05)];
    case 'blackboard':
      return [thin(0.05, (y ?? 0.9) - 0.04, (y ?? 0.9) + (h ?? 1.2) + 0.04)];
    case 'shelf':
      return [all(0, 1.85)];
    case 'counter':
      return [all(0, 0.97)];
    case 'fridge':
      return [all(0, 1.9)];
    case 'planter':
      return [all(0, 0.62)];
    case 'tree':
      return [box(u, v, 1.3, 1.3, -0.08, 0.04, 'pit'), box(u, v, 0.3, 0.3, 0.04, 3, 'trunk')];
    case 'bareTree':
      return [box(u, v, 1.1, 1.1, 0, 0.04, 'pit'), box(u, v, 0.16, 0.16, 0.04, 2.6, 'trunk')];
    case 'column':
      return [all(0, 3.1)];
    case 'roundColumn':
    case 'paddedColumn':
      return [all(0, h ?? 3.1)];
    case 'mirror':
      return [all(0.21, 0.31 + (h ?? 1.9))];
    case 'barre':
      return [all(0, 1.05)];
    case 'stall':
      return [all(0, 2.02)];
    case 'stage': {
      const [fu, fv] = faceDir(it.face);
      const back = V ? w : d;
      return [all(0, 0.62), box(u - fu * (back / 2 - 0.06), v - fv * (back / 2 - 0.06), V ? 0.04 : w - 0.1, V ? d - 0.1 : 0.04, 0.62, 0.62 + FURNITURE.backdrop, 'backdrop')];
    }
    case 'curtain': {
      const r = roomAt(u, v, level(it));
      return [thin(0.18, 0.62, (r ? ceilingHeight(r) : 3.1) - 0.03)];
    }
    case 'goal':
      return [all(0, 2.08)];
    case 'bleachers':
      return [all(0, 2.25)];
    case 'booth':
      return [all(0, 2.48)];
    case 'playhouse':
      return [all(0, 1.7)];
    case 'banner':
      return [all(0, 2.2)];
    case 'lockers':
      return [all(0, 1.8)];
    case 'extinguisher':
      return [box(u, v, 0.17, 0.17, y ?? 0.95, (y ?? 0.95) + 0.64)];
    case 'fan': {
      const [fu, fv] = faceDir(it.face);
      const yy = y ?? 2.35;
      return [box(u + fu * 0.04, v + fv * 0.04, V ? 0.24 : 0.46, V ? 0.46 : 0.24, yy - 0.1, yy + 0.44)];
    }
    case 'ac':
      return [box(u, v, V ? 0.22 : 0.86, V ? 0.86 : 0.22, y ?? 2.45, (y ?? 2.45) + 0.29)];
    case 'projector': {
      const top = y ?? 3.0;
      return [box(u, v, 0.36, 0.3, top - 0.52, top)];
    }
    case 'speaker':
      return [box(u, v, V ? 0.22 : 0.26, V ? 0.26 : 0.22, y ?? 2.5, (y ?? 2.5) + 0.38)];
    case 'tv':
      return [thin(0.06, y ?? 1.5, (y ?? 1.5) + (h ?? 0.62))];
    case 'pegboard':
      return [thin(0.1, y ?? 1.0, (y ?? 1.0) + (h ?? 1.0))];
    case 'cabinet':
      return [all(0, h ?? 1.9)];
    case 'laserCutter':
      return [all(FURNITURE.benchTop, FURNITURE.benchTop + 0.35)];
    case 'printer3d':
      return [all(FURNITURE.benchTop, FURNITURE.benchTop + w)];
    case 'buffetLine':
      return [all(0, 1.7)];
    case 'displayCase':
      return [all(0, 1.3)];
    case 'fridgeGlass':
      return [all(0, 2.0)];
    case 'pendantRail':
      return [all(3.1 - 1.21, 3.1)];
    case 'greenWall':
      return [thin(0.08, y ?? 1.0, (y ?? 1.0) + (h ?? 1.8))];
    case 'bamboo':
      return [box(u, v, 0.35, 0.35, 0, 2.8)];
    case 'piano':
      return [all(0, 1.25)];
    case 'drawers':
      return [all(0, h ?? 0.85)];
    case 'gate':
      return [all(0, h ?? 2.1)];
    case 'plaques':
      return [thin(0.05, 1.05, 2.95)];
    case 'trophyShelf': {
      const yy = y ?? 2.15;
      return [all(yy, yy + 0.8)];
    }
    case 'waterCooler':
      return [box(u, v, 0.32, 0.32, 0, 1.42)];
    case 'filing':
      return [all(0, h ?? 1.35)];
    case 'sinkCounter': {
      const [fu, fv] = faceDir(it.face);
      return [all(0, 0.9), box(u - fu * (Math.min(w, d) / 2 - 0.02), v - fv * (Math.min(w, d) / 2 - 0.02), V ? 0.02 : w, V ? d : 0.02, 1.15, 1.85, 'mirror')];
    }
    case 'copier':
      return [all(0, 1.01)];
    case 'wallMat':
      return [thin(0.1, y ?? 0, (y ?? 0) + (h ?? 2.0))];
    case 'padPilaster':
      return [all(0.1, 2.8)];
    case 'flagpole':
      return [box(u, v, 0.07, 0.07, 0, h ?? 6.5)];
    case 'stack':
      return [all(0, 0.45 + Math.round((h ?? 1.6) / 0.09) * 0.09)];
    case 'drumKit':
      return [all(0, 1.11)];
    case 'risers':
      return [all(0, 0.9)];
    case 'slide':
    case 'playTower':
    case 'climber':
    case 'swing':
    case 'aviary':
    case 'hut':
      return [all(0, it.kind === 'hut' ? 3.0 : 2.3)];
    case 'wallPanel':
      return [all(y ?? 0, (y ?? 0) + (h ?? 1.0))];
    case 'floorPatch':
      return [all(0.002, 0.01, 'decal')];
    case 'hoop': {
      const [fu, fv] = faceDir(it.face);
      return [thin(0.04, 1.85, 2.3), box(u + fu * 0.25, v + fv * 0.25, 0.4, 0.4, 1.65, 1.97, 'ring')];
    }
    case 'ceilingFan':
      return [all(2.7, 3.1)];
    case 'palm':
      return [box(u, v, 0.4, 0.4, y ?? 0, (y ?? 0) + (h ?? 6))];
    case 'bikeRack':
      return [all(0, 0.75)];
    case 'waterTank':
      return [all(y ?? 0, (y ?? 0) + 1.7)];
    case 'louvredDoor':
      return [thin(0.05, 0, 2.05)];
    case 'condenser':
      return [all((y ?? 3.6) - 0.04, (y ?? 3.6) + 0.55)];
    case 'hedge':
      return [all(0, 1.6)];
  }
  return [all(0, 1)];
}

/** Lo que va colgado de un muro: tiene que tener muro detrás. */
const WALL_MOUNTED = new Set<Item['kind']>([
  'board',
  'blackboard',
  'extinguisher',
  'fan',
  'ac',
  'speaker',
  'tv',
  'plaques',
  'greenWall',
  'pegboard',
  'hoop',
  'wallMat',
  'trophyShelf',
  'mirror',
]);

/** Fuera de los ambientes a propósito: en la fachada o sobre una azotea. */
const OUTSIDE = new Set<Item['kind']>(['condenser', 'waterTank', 'flagpole']);

/** Calcomanías y revestimientos finos: no chocan con lo que tienen encima. */
const DECAL = new Set<Item['kind']>(['floorPatch']);

// ------------------------------------------------------------------ muros

interface WallGeo {
  w: Wall;
  len: number;
  du: number;
  dv: number;
  t: number;
}

const wallGeo = (w: Wall): WallGeo => {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return { w, len, du: (w.b[0] - w.a[0]) / len, dv: (w.b[1] - w.a[1]) / len, t: w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT };
};
const GEOS = WALLS.map(wallGeo);

const HOLE: Record<Opening['type'], [number, number]> = {
  door: [0, 2.15],
  double: [0, 2.25],
  pass: [0, 2.6],
  exit: [0, 2.3],
  entrance: [0, 2.75],
  window: [0.95, 2.35],
  high: [4.3, 6.2],
  band: [1.95, 2.75],
  counter: [0.95, 2.05],
};
const holeOf = (o: Opening, wallH: number): [number, number] => {
  const [hb, ht] = HOLE[o.type];
  return [o.hb ?? hb, Math.min(o.ht ?? ht, wallH - 0.15)];
};

/** Intervalos de la caja proyectada sobre el eje (t) y la normal (n) del muro. */
function project(g: WallGeo, b: Box): { t0: number; t1: number; n0: number; n1: number } {
  const corners: Array<[number, number]> = [
    [b.u0, b.v0],
    [b.u1, b.v0],
    [b.u1, b.v1],
    [b.u0, b.v1],
  ];
  let t0 = Infinity;
  let t1 = -Infinity;
  let n0 = Infinity;
  let n1 = -Infinity;
  for (const [u, v] of corners) {
    const ru = u - g.w.a[0];
    const rv = v - g.w.a[1];
    const t = ru * g.du + rv * g.dv;
    const n = -ru * g.dv + rv * g.du;
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
    n0 = Math.min(n0, n);
    n1 = Math.max(n1, n);
  }
  return { t0, t1, n0, n1 };
}

/** ¿El muro es macizo a la altura [y0, y1] en algún punto del tramo [t0, t1]? */
function wallSolidIn(g: WallGeo, t0: number, t1: number, y0: number, y1: number, tol: number): boolean {
  const cuts = [t0, t1];
  for (const o of g.w.openings) {
    if (o.t0 > t0 && o.t0 < t1) cuts.push(o.t0);
    if (o.t1 > t0 && o.t1 < t1) cuts.push(o.t1);
  }
  cuts.sort((a, b) => a - b);
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k];
    const b = cuts[k + 1];
    if (b - a < tol) continue;
    const mid = (a + b) / 2;
    // Alturas libres en este tramo.
    const holes = g.w.openings.filter((o) => o.t0 < mid && o.t1 > mid).map((o) => holeOf(o, g.w.h));
    let y = Math.max(0, y0);
    const top = Math.min(g.w.h, y1);
    holes.sort((p, q) => p[0] - q[0]);
    for (const [hb, ht] of holes) {
      if (hb > y + tol && Math.min(hb, top) - y > tol) return true;
      y = Math.max(y, ht);
    }
    if (top - y > tol) return true;
  }
  return false;
}

// -------------------------------------------------------------- utilidades

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

function boxesHit(a: Box, b: Box, tol: number): boolean {
  return overlap(a.u0, a.u1, b.u0, b.u1) > tol && overlap(a.v0, a.v1, b.v0, b.v1) > tol && overlap(a.y0, a.y1, b.y0, b.y1) > tol;
}

/** Pares de objetos que se tocan en la realidad: uno apoyado, colgado o metido bajo el otro. */
function allowedPair(a: Item, b: Item): boolean {
  const k = new Set([a.kind, b.kind]);
  const has = (x: Item['kind'], y: Item['kind']) => k.has(x) && k.has(y);
  // Revestimiento del muro / cartel detrás de algo apoyado contra él.
  if (k.has('wallPanel') && (a.kind !== b.kind)) {
    const panel = a.kind === 'wallPanel' ? a : b;
    const other = panel === a ? b : a;
    // Asientos de madera sobre canteros, viga con proyector, toldo sobre la puerta.
    if (['planter', 'projector', 'palm', 'buffetLine', 'shelf', 'fridgeGlass', 'counter', 'displayCase', 'bench', 'pendantRail'].includes(other.kind)) return true;
    if ((panel.h ?? 1) <= 0.06) return true;
  }
  // Palmera plantada en su cantero, árbol en su pozo pintado.
  if (has('palm', 'planter')) return true;
  // Equipo apoyado sobre la mesa de trabajo, parlante sobre la cómoda.
  if (has('laserCutter', 'workbench') || has('printer3d', 'workbench')) return true;
  if (has('speaker', 'drawers')) return true;
  // Dispenser con el estante de trofeos encima.
  if (has('waterCooler', 'trophyShelf')) return true;
  // Barra de ballet delante del espejo.
  if (has('barre', 'mirror')) return true;
  // El telón cuelga al borde del escenario.
  if (has('curtain', 'stage')) return true;
  // Barandas que se encuentran en una esquina.
  if (a.kind === 'gate' && b.kind === 'gate') return true;
  return false;
}

// ================================================================== tests

describe('QA del equipamiento de la escuela', () => {
  it('nada atraviesa un muro (salvo lo colgado, apoyado contra él)', () => {
    const bad: string[] = [];
    for (const it of ITEMS) {
      const lv = level(it);
      // Lo colgado se apoya contra el muro: se le permite 3 cm de contacto.
      const tol = WALL_MOUNTED.has(it.kind) || it.kind === 'wallPanel' ? 0.035 : 0.015;
      for (const b of boxes(it)) {
        if (b.tag === 'decal' || b.tag === 'pit') continue;
        for (const g of GEOS) {
          if (g.w.level !== lv) continue;
          const p = project(g, b);
          if (p.t1 < -0.01 || p.t0 > g.len + 0.01) continue;
          const half = g.t / 2;
          const depth = overlap(p.n0, p.n1, -half, half);
          if (depth <= tol) continue;
          if (wallSolidIn(g, Math.max(0, p.t0), Math.min(g.len, p.t1), b.y0, b.y1, 0.02)) {
            bad.push(`${name(it)} [${b.tag}] ${(depth * 100).toFixed(0)} cm dentro del muro ${g.w.kind} ${g.w.a.map((x) => x.toFixed(2))}→${g.w.b.map((x) => x.toFixed(2))}`);
            break;
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('cada objeto está dentro de un ambiente de su nivel', () => {
    const bad: string[] = [];
    for (const it of ITEMS) {
      if (OUTSIDE.has(it.kind)) continue;
      if (!roomAt(it.u, it.v, level(it))) bad.push(name(it));
    }
    expect(bad).toEqual([]);
  });

  it('lo colgado tiene un muro detrás (no flota delante de la pared)', () => {
    const bad: string[] = [];
    for (const it of ITEMS) {
      if (!WALL_MOUNTED.has(it.kind)) continue;
      const lv = level(it);
      const b = boxes(it)[0];
      // Apoyado sobre otro mueble (el parlante sobre la cómoda).
      if (ITEMS.some((o) => o !== it && level(o) === lv && boxes(o).some((c) => Math.abs(c.y1 - b.y0) < 0.03 && overlap(c.u0, c.u1, b.u0, b.u1) > 0 && overlap(c.v0, c.v1, b.v0, b.v1) > 0))) continue;
      // Cara trasera del objeto, del lado opuesto a hacia donde mira.
      const [fu, fv] = faceDir(it.face);
      const backU = fu > 0 ? b.u0 : fu < 0 ? b.u1 : it.u;
      const backV = fv > 0 ? b.v0 : fv < 0 ? b.v1 : it.v;
      const gap = wallGapBehind(lv, backU, backV, it.face);
      // Espejos de pie (con patas): lejos del muro a propósito.
      if (it.kind === 'mirror' && gap > 0.15) continue;
      let ok = gap < 0.045;
      // Pilares, columnas o paneles contra los que se cuelga.
      for (const o of ITEMS) {
        if (o === it || level(o) !== lv) continue;
        if (!['roundColumn', 'paddedColumn', 'wallPanel', 'column', 'cabinet', 'padPilaster'].includes(o.kind)) continue;
        const ob = boxes(o)[0];
        if (backU >= ob.u0 - 0.045 && backU <= ob.u1 + 0.045 && backV >= ob.v0 - 0.045 && backV <= ob.v1 + 0.045) ok = true;
      }
      if (!ok) bad.push(`${name(it)} a ${gap === Infinity ? 'más de 1 m' : (gap * 100).toFixed(1) + ' cm'} del muro`);
      // Y el muro detrás es macizo: nada colgado sobre una ventana o una puerta.
      for (const g of GEOS) {
        if (g.w.level !== lv) continue;
        const p = project(g, b);
        if (p.t1 < 0 || p.t0 > g.len || overlap(p.n0, p.n1, -g.t / 2 - 0.05, g.t / 2 + 0.05) <= 0) continue;
        for (const o of g.w.openings) {
          const [hb, ht] = holeOf(o, g.w.h);
          if (overlap(p.t0, p.t1, o.t0, o.t1) > 0.02 && overlap(b.y0, b.y1, hb, ht) > 0.02) bad.push(`${name(it)} sobre un vano ${o.type}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('los objetos no se meten unos dentro de otros', () => {
    const bad: string[] = [];
    const list = ITEMS.filter((it) => !DECAL.has(it.kind)).map((it) => ({ it, bs: boxes(it) }));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        if (level(A.it) !== level(B.it)) continue;
        if (allowedPair(A.it, B.it)) continue;
        let hit = '';
        for (const a of A.bs) {
          for (const b of B.bs) {
            if (a.tag === 'pit' || b.tag === 'pit') continue;
            if (boxesHit(a, b, 0.015)) hit = `${a.tag}/${b.tag}`;
          }
        }
        if (hit) bad.push(`${name(A.it)} × ${name(B.it)} (${hit})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('las calcomanías del piso no se superponen en el mismo plano (z-fighting)', () => {
    const bad: string[] = [];
    const patches = ITEMS.filter((it) => it.kind === 'floorPatch');
    for (let i = 0; i < patches.length; i++) {
      for (let j = i + 1; j < patches.length; j++) {
        const a = patches[i];
        const b = patches[j];
        if (level(a) !== level(b) || (a.y ?? 0) !== (b.y ?? 0)) continue;
        const A = boxes(a)[0];
        const B = boxes(b)[0];
        if (overlap(A.u0, A.u1, B.u0, B.u1) > 0.001 && overlap(A.v0, A.v1, B.v0, B.v1) > 0.001) bad.push(`${name(a)} × ${name(b)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('lo que apoya en el piso tiene piso debajo (ni flota sobre un hueco ni se hunde en una escalera)', () => {
    const bad: string[] = [];
    for (const it of ITEMS) {
      if (OUTSIDE.has(it.kind) || WALL_MOUNTED.has(it.kind)) continue;
      const lv = level(it);
      const b = boxes(it)[0];
      if (b.y0 > 0.05) continue;
      const inset = 0.05;
      // Las barandas van al borde de la losa: basta su eje sobre el canto del hueco.
      const pts: Array<[number, number]> =
        it.kind === 'gate'
          ? alongV(it)
            ? [[it.u, b.v0 + inset], [it.u, b.v1 - inset], [it.u, it.v]]
            : [[b.u0 + inset, it.v], [b.u1 - inset, it.v], [it.u, it.v]]
          : [
              [b.u0 + inset, b.v0 + inset],
              [b.u1 - inset, b.v0 + inset],
              [b.u1 - inset, b.v1 - inset],
              [b.u0 + inset, b.v1 - inset],
              [it.u, it.v],
            ];
      for (const [u, v] of pts) {
        const onStair =
          STAIRS.some((s) => u > s.u0 && u < s.u1 && v > s.v0 && v < s.v1 && (s.y0 <= lv * SCHOOL.storey + 0.01 && s.y1 >= lv * SCHOOL.storey - 0.01 ? true : s.y0 < lv * SCHOOL.storey + 2 && s.y1 > lv * SCHOOL.storey)) ||
          LANDINGS.some((l) => u > l.u0 && u < l.u1 && v > l.v0 && v < l.v1 && Math.abs(l.y - lv * SCHOOL.storey) > 0.05 && l.y > lv * SCHOOL.storey - 0.5 && l.y < (lv + 1) * SCHOOL.storey);
        const inVoid = lv > 0 && voidsAt(lv).some((r) => u > r.u0 && u < r.u1 && v > r.v0 && v < r.v1);
        const floor = lv === 0 || hasFloor(lv, u, v);
        if (onStair || inVoid || !floor) {
          bad.push(`${name(it)} en ${u.toFixed(2)},${v.toFixed(2)}${onStair ? ' (escalera)' : inVoid ? ' (hueco)' : ' (sin piso)'}`);
          break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('nada atraviesa el cielorraso de su ambiente', () => {
    const bad: string[] = [];
    for (const it of ITEMS) {
      if (OUTSIDE.has(it.kind) || it.kind === 'palm' || it.kind === 'tree' || it.kind === 'bareTree') continue;
      const r = roomAt(it.u, it.v, level(it));
      if (!r || !r.roofed) continue;
      const ceil = ceilingHeight(r);
      for (const b of boxes(it)) {
        if (b.y1 > ceil + 0.005) bad.push(`${name(it)} [${b.tag}] llega a ${b.y1.toFixed(2)} (cielorraso ${ceil.toFixed(2)} en ${r.id})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('las hojas de las puertas abren sin chocar con muebles', () => {
    const bad: string[] = [];
    for (const d of DOORS) {
      for (const L of d.leaves) {
        // Barrido de la hoja: cuadrado de su ancho desde la bisagra hacia adentro.
        const tip: [number, number] = [L.hinge[0] + L.dir[0] * L.width, L.hinge[1] + L.dir[1] * L.width];
        const far: [number, number] = [L.hinge[0] + d.swing[0] * L.width, L.hinge[1] + d.swing[1] * L.width];
        const u0 = Math.min(L.hinge[0], tip[0], far[0]);
        const u1 = Math.max(L.hinge[0], tip[0], far[0]);
        const v0 = Math.min(L.hinge[1], tip[1], far[1]);
        const v1 = Math.max(L.hinge[1], tip[1], far[1]);
        for (const it of ITEMS) {
          if (level(it) !== d.level || DECAL.has(it.kind)) continue;
          for (const b of boxes(it)) {
            if (b.y0 > 2.0) continue;
            if (overlap(b.u0, b.u1, u0, u1) > 0.02 && overlap(b.v0, b.v1, v0, v1) > 0.02) {
              // Sólo cuenta lo que queda dentro del cuarto de círculo de la hoja.
              const cu = Math.max(b.u0, Math.min(L.hinge[0], b.u1));
              const cv = Math.max(b.v0, Math.min(L.hinge[1], b.v1));
              if (Math.hypot(cu - L.hinge[0], cv - L.hinge[1]) < L.width - 0.02) {
                bad.push(`${d.id}: ${name(it)} [${b.tag}]`);
                break;
              }
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('ningún mueble tapa un vano transitable', () => {
    const bad: string[] = [];
    for (const g of GEOS) {
      for (const o of g.w.openings) {
        if (!WALKABLE.has(o.type)) continue;
        // Franja de 60 cm a cada lado del vano: lo que la invade le resta paso.
        const reach = g.t / 2 + 0.6;
        const taken: Array<[number, number, string]> = [];
        for (const it of ITEMS) {
          if (level(it) !== g.w.level || DECAL.has(it.kind)) continue;
          for (const b of boxes(it)) {
            if (b.y0 > 1.9 || b.y1 < 0.1) continue;
            const p = project(g, b);
            if (overlap(p.t0, p.t1, o.t0, o.t1) > 0.02 && overlap(p.n0, p.n1, -reach, reach) > 0.02) taken.push([p.t0, p.t1, name(it)]);
          }
        }
        if (!taken.length) continue;
        // Paso libre más ancho que queda: tiene que entrar una persona (75 cm).
        taken.sort((x, y) => x[0] - y[0]);
        let free = 0;
        let t = o.t0;
        for (const [a, b] of taken) {
          free = Math.max(free, a - t);
          t = Math.max(t, b);
        }
        free = Math.max(free, o.t1 - t);
        const need = Math.min(0.75, o.t1 - o.t0 - 0.16);
        if (free < need - 0.005) {
          bad.push(`vano ${o.type} de ${g.w.a.map((x) => x.toFixed(2))}→${g.w.b.map((x) => x.toFixed(2))} L${g.w.level}: ${free.toFixed(2)} m libres por ${[...new Set(taken.map((x) => x[2]))].join(', ')}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('QA de medidas humanas', () => {
  it('mesas, sillas y pizarrones a la altura de un aula real', () => {
    // Pupitres y mesas: 0,70–0,78 m; asiento 0,40–0,48; jardín más bajo.
    expect(FURNITURE.deskTop).toBeGreaterThanOrEqual(0.7);
    expect(FURNITURE.deskTop).toBeLessThanOrEqual(0.78);
    expect(FURNITURE.tableTop).toBeGreaterThanOrEqual(0.7);
    expect(FURNITURE.tableTop).toBeLessThanOrEqual(0.78);
    expect(FURNITURE.seat).toBeGreaterThanOrEqual(0.4);
    expect(FURNITURE.seat).toBeLessThanOrEqual(0.48);
    // Diferencia mesa-asiento cómoda (27–32 cm).
    expect(FURNITURE.deskTop - FURNITURE.seat).toBeGreaterThanOrEqual(0.26);
    expect(FURNITURE.deskTop - FURNITURE.seat).toBeLessThanOrEqual(0.33);
    expect(FURNITURE.smallTable).toBeGreaterThanOrEqual(0.46);
    expect(FURNITURE.smallTable).toBeLessThanOrEqual(0.6);
    expect(FURNITURE.seat * FURNITURE.smallScale).toBeGreaterThanOrEqual(0.26);
    expect(FURNITURE.seat * FURNITURE.smallScale).toBeLessThanOrEqual(0.36);
    // Primaria (2º a 6º grado): talle 4–5, pupitre 0,64–0,71 y asiento
    // 0,38–0,43, con la misma diferencia cómoda.
    expect(FURNITURE.primaryDeskTop).toBeGreaterThanOrEqual(0.64);
    expect(FURNITURE.primaryDeskTop).toBeLessThanOrEqual(0.71);
    expect(FURNITURE.primarySeat).toBeGreaterThanOrEqual(0.38);
    expect(FURNITURE.primarySeat).toBeLessThanOrEqual(0.43);
    expect(FURNITURE.primaryDeskTop - FURNITURE.primarySeat).toBeGreaterThanOrEqual(0.24);
    expect(FURNITURE.primaryDeskTop - FURNITURE.primarySeat).toBeLessThanOrEqual(0.3);
    // Pizarrón: borde inferior 0,8–1,0 m y superior 2,0–2,2 m.
    expect(FURNITURE.boardBottom).toBeGreaterThanOrEqual(0.8);
    expect(FURNITURE.boardBottom).toBeLessThanOrEqual(1.0);
    expect(FURNITURE.boardTop).toBeGreaterThanOrEqual(2.0);
    expect(FURNITURE.boardTop).toBeLessThanOrEqual(2.2);
  });

  it('en las aulas de primaria pupitres, mesas y sillas son de un mismo talle', () => {
    for (const id of PRIMARY_ROOMS) {
      const furn = ITEMS.filter((it) => (it.kind === 'desk' || it.kind === 'table' || it.kind === 'chair') && roomAt(it.u, it.v, level(it))?.id === id);
      expect(furn.length, id).toBeGreaterThan(0);
      for (const it of furn) {
        if (it.kind === 'chair') {
          // Sólo la silla del docente (junto a su escritorio) es de adulto.
          const near = ITEMS.some((t) => t.kind === 'teacherDesk' && Math.hypot(t.u - it.u, t.v - it.v) < 1.0);
          expect(furnitureSize(it), `${id} silla ${it.u},${it.v}`).toBe(near ? 'adult' : 'primary');
        } else {
          expect(deskTopOf(it), `${id} ${it.kind} ${it.u},${it.v}`).toBe(FURNITURE.primaryDeskTop);
        }
      }
    }
  });

  it('pizarrones negros, matafuegos y equipos colgados a una altura posible', () => {
    const bad: string[] = [];
    for (const it of ITEMS) {
      const b = boxes(it)[0];
      if (it.kind === 'blackboard' && (b.y0 < 0.75 || b.y1 > 2.6)) bad.push(name(it));
      // Matafuego: la manija entre 1,2 y 1,7 m.
      if (it.kind === 'extinguisher' && (b.y1 < 1.2 || b.y1 > 1.75)) bad.push(name(it));
      if ((it.kind === 'ac' || it.kind === 'speaker' || it.kind === 'projector') && b.y0 < 1.9 && level(it) === (it.level ?? 0) && !(it.kind === 'speaker' && (it.y ?? 2.5) <= 1.01)) bad.push(name(it));
    }
    expect(bad).toEqual([]);
  });

  it('barandas sobre los huecos de 0,9 a 1,1 m', () => {
    for (const it of ITEMS) {
      if (it.kind !== 'gate' || (it.h ?? 2.1) > 1.5) continue;
      expect(it.h ?? 2.1, name(it)).toBeGreaterThanOrEqual(0.9);
      expect(it.h ?? 2.1, name(it)).toBeLessThanOrEqual(1.1);
    }
  });

  it('ningún canto de un hueco de escalera queda sin baranda, muro o tramo', () => {
    // Se recorre cada borde de cada hueco: donde del otro lado hay piso de
    // ese nivel, tiene que haber un muro, una baranda, o un tramo que llegue
    // (o salga) justo ahí. Si no, el piso termina en el aire sobre el hueco.
    const H = SCHOOL.storey;
    // Una cornisa de piso más angosta que esto entre el hueco y un muro o una
    // baranda no se puede pisar (el cuerpo mide 0,45 m de radio).
    const LEDGE = 0.35;
    const bad: string[] = [];
    for (const h of VOIDS) {
      const L = h.level;
      const edges: Array<[number, number, number, number, number, number]> = [
        [h.u0, h.v0, h.u1, h.v0, 0, -1],
        [h.u0, h.v1, h.u1, h.v1, 0, 1],
        [h.u0, h.v0, h.u0, h.v1, -1, 0],
        [h.u1, h.v0, h.u1, h.v1, 1, 0],
      ];
      for (const [a0, b0, a1, b1, nu, nv] of edges) {
        const len = Math.hypot(a1 - a0, b1 - b0);
        const n = Math.round(len / 0.1);
        let open = 0;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const u = a0 + (a1 - a0) * t;
          const v = b0 + (b1 - b0) * t;
          const ou = u + nu * 0.15;
          const ov = v + nv * 0.15;
          const floorOut = !!roomAt(ou, ov, L) && !VOIDS.some((o) => o.level === L && inRect(o, ou, ov));
          const walled = WALLS.some((w) => {
            if (w.level !== L) return false;
            const g = wallGeo(w);
            const tt = (u - w.a[0]) * g.du + (v - w.a[1]) * g.dv;
            const d = Math.abs(-(u - w.a[0]) * g.dv + (v - w.a[1]) * g.du);
            return tt >= -0.05 && tt <= g.len + 0.05 && d < g.t / 2 + LEDGE && !w.openings.some((o) => o.t0 <= tt && o.t1 >= tt && (o.hb ?? 0) < 0.9);
          });
          const railed = ITEMS.some((it) => it.kind === 'gate' && level(it) === L && Math.abs(u - it.u) <= it.w / 2 + LEDGE && Math.abs(v - it.v) <= it.d / 2 + LEDGE);
          // Un tramo que llega a ese nivel o sale de él por ese borde.
          const stair = STAIRS.some((s) => {
            if (!inRect(s, u - nu * 0.05, v - nv * 0.05, 0.02)) return false;
            const top = s.dir === 'u+' ? Math.abs(u - s.u1) < 0.06 : s.dir === 'u-' ? Math.abs(u - s.u0) < 0.06 : s.dir === 'v+' ? Math.abs(v - s.v1) < 0.06 : Math.abs(v - s.v0) < 0.06;
            const foot = s.dir === 'u+' ? Math.abs(u - s.u0) < 0.06 : s.dir === 'u-' ? Math.abs(u - s.u1) < 0.06 : s.dir === 'v+' ? Math.abs(v - s.v0) < 0.06 : Math.abs(v - s.v1) < 0.06;
            return (top && Math.abs(s.y1 - L * H) < 0.2) || (foot && Math.abs(s.y0 - L * H) < 0.2);
          });
          if (floorOut && !walled && !railed && !stair) open++;
          else open = 0;
          // Más de 20 cm seguidos sin protección.
          if (open === 3) bad.push(`L${L} hueco ${h.u0},${h.v0}..${h.u1},${h.v1}: canto abierto en ${u.toFixed(2)},${v.toFixed(2)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('las salidas de emergencia abren sin chocar con la reja de la línea municipal', () => {
    const bad: string[] = [];
    const cross = (p: [number, number], q: [number, number], a: readonly [number, number], b: readonly [number, number]) => {
      const d = (x: readonly [number, number], y: readonly [number, number], z: readonly [number, number]) => (y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]);
      return d(p, q, a) * d(p, q, b) < 0 && d(a, b, p) * d(a, b, q) < 0;
    };
    for (const g of GEOS) {
      if (g.w.level !== 0) continue;
      const nu = -g.dv;
      const nv = g.du;
      for (const o of g.w.openings) {
        if (o.type !== 'exit') continue;
        const at = (d: number): [number, number] => [g.w.a[0] + g.du * d, g.w.a[1] + g.dv * d];
        const [mu, mv] = at((o.t0 + o.t1) / 2);
        const rp = roomAt(mu + nu * 0.45, mv + nv * 0.45, 0);
        const rn = roomAt(mu - nu * 0.45, mv - nv * 0.45, 0);
        const ext = !rp && rn ? 1 : !rn && rp ? -1 : 0;
        if (ext === 0) continue;
        const len = o.t1 - o.t0;
        for (const hng of [0.08, len - 0.08]) {
          const p = at(o.t0 + hng);
          const q0: [number, number] = [p[0] + nu * ext * (g.t / 2 + 0.02), p[1] + nv * ext * (g.t / 2 + 0.02)];
          const q1: [number, number] = [q0[0] + nu * ext * ((len - 0.16) / 2 + 0.1), q0[1] + nv * ext * ((len - 0.16) / 2 + 0.1)];
          for (const [a, b] of FENCES) {
            if (cross(q0, q1, a, b)) bad.push(`salida ${o.t0.toFixed(2)}-${o.t1.toFixed(2)} de ${g.w.a}→${g.w.b}: la hoja cruza la reja ${a}→${b}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('escalones con contrahuella de 14–19 cm y huella de 25 cm o más', () => {
    const bad: string[] = [];
    for (const s of STAIRS) {
      const n = riserCount(s);
      const riser = (s.y1 - s.y0) / n;
      const run = s.dir === 'u+' || s.dir === 'u-' ? s.u1 - s.u0 : s.v1 - s.v0;
      const width = s.dir === 'u+' || s.dir === 'u-' ? s.v1 - s.v0 : s.u1 - s.u0;
      const tread = run / n;
      const id = `tramo ${s.u0},${s.v0} ${s.dir} (${n} × ${(riser * 100).toFixed(1)} cm / huella ${(tread * 100).toFixed(1)} cm, ancho ${width.toFixed(2)})`;
      // Regla de Blondel: 2 contrahuellas + 1 huella ≈ un paso (0,58–0,70 m).
      if (riser < 0.14 || riser > 0.19 || tread < 0.25 || 2 * riser + tread < 0.58 || 2 * riser + tread > 0.7 || width < 0.9) bad.push(id);
    }
    expect(bad).toEqual([]);
  });
});

describe('QA de vanos', () => {
  it('puertas y pasos con anchos de puerta real', () => {
    const bad: string[] = [];
    for (const g of GEOS) {
      for (const o of g.w.openings) {
        const wdt = o.t1 - o.t0;
        const range: Partial<Record<Opening['type'], [number, number]>> = {
          door: [0.7, 1.2],
          // Hasta 3 m: los portones de dos hojas a la calle.
          double: [1.1, g.w.kind === 'ext' ? 3.0 : 2.6],
          exit: [0.8, 2.4],
          pass: [0.8, 6],
          entrance: [1.2, 6],
        };
        const r = range[o.type];
        if (r && (wdt < r[0] || wdt > r[1])) bad.push(`${o.type} de ${wdt.toFixed(2)} m en ${g.w.a}→${g.w.b} L${g.w.level}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('las ventanas tienen antepecho y dintel posibles', () => {
    const bad: string[] = [];
    for (const g of GEOS) {
      for (const o of g.w.openings) {
        if (o.type !== 'window') continue;
        const [hb, ht] = holeOf(o, g.w.h);
        // Puerta vidriada cerrada (la corrediza del aula de danzas al bajo de
        // la bóveda): una ventana a ras del piso, no un vano transitable.
        if (hb < 0.1 && ht >= 1.9 && ht <= g.w.h - 0.15 + 1e-9) continue;
        // Las bandas vidriadas de las barandas bajas pueden ser angostas.
        if (hb < 0.6 || ht - hb < 0.25 || ht > g.w.h - 0.1 || (o.ht !== undefined && o.ht > g.w.h - 0.15 + 1e-9)) bad.push(`ventana ${hb}-${ht} en ${g.w.a}→${g.w.b} L${g.w.level}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('dos vanos del mismo muro no se pisan', () => {
    const bad: string[] = [];
    for (const g of GEOS) {
      const os = g.w.openings;
      for (let i = 0; i < os.length; i++) {
        for (let j = i + 1; j < os.length; j++) {
          const a = os[i];
          const b = os[j];
          const [ab, at] = holeOf(a, g.w.h);
          const [bb, bt] = holeOf(b, g.w.h);
          // Entre dos vanos tiene que quedar al menos un parante de 5 cm.
          if (overlap(a.t0, a.t1, b.t0 - 0.05, b.t1 + 0.05) > 1e-6 && overlap(ab, at, bb - 0.05, bt + 0.05) > 1e-6) {
            bad.push(`${a.type} ${a.t0.toFixed(2)}-${a.t1.toFixed(2)} × ${b.type} ${b.t0.toFixed(2)}-${b.t1.toFixed(2)} en ${g.w.a}→${g.w.b} L${g.w.level}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('ningún vano se mete en el muro que llega a su costado', () => {
    const bad: string[] = [];
    for (const g of GEOS) {
      for (const o of g.w.openings) {
        for (const h of GEOS) {
          if (h === g || h.w.level !== g.w.level) continue;
          // Muro perpendicular (o casi) que toca a este muro dentro del vano.
          if (Math.abs(g.du * h.du + g.dv * h.dv) > 0.5) continue;
          for (const end of [h.w.a, h.w.b]) {
            const ru = end[0] - g.w.a[0];
            const rv = end[1] - g.w.a[1];
            const t = ru * g.du + rv * g.dv;
            const n = -ru * g.dv + rv * g.du;
            if (Math.abs(n) > g.t / 2 + 0.05) continue;
            // El muro que llega ocupa medio espesor a cada lado de su eje
            // (y sólo hasta su altura: no tapa una claraboya más arriba).
            const half = h.t / 2;
            const [hb] = holeOf(o, g.w.h);
            if (hb >= h.w.h - 0.01) continue;
            if (t + half > o.t0 + 0.005 && t - half < o.t1 - 0.005) {
              bad.push(`${o.type} ${o.t0.toFixed(2)}-${o.t1.toFixed(2)} de ${g.w.a}→${g.w.b} L${g.w.level} choca con ${h.w.a}→${h.w.b}`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('QA de interruptores', () => {
  it('cada interruptor está sobre un paño de muro lleno, sin muebles delante', () => {
    const bad: string[] = [];
    for (const sw of SWITCHES) {
      const face: Item['face'] = sw.facing[0] > 0.5 ? 'e' : sw.facing[0] < -0.5 ? 'w' : sw.facing[1] > 0.5 ? 's' : 'n';
      const gap = wallGapBehind(sw.level, sw.at[0], sw.at[1], face);
      if (Math.abs(gap) > 0.03) bad.push(`${sw.roomId}: a ${(gap * 100).toFixed(1)} cm del muro`);
      for (const g of GEOS) {
        if (g.w.level !== sw.level) continue;
        const ru = sw.at[0] - g.w.a[0];
        const rv = sw.at[1] - g.w.a[1];
        const t = ru * g.du + rv * g.dv;
        const n = -ru * g.dv + rv * g.du;
        // Metido en otro muro (el que llega en la esquina).
        if (t > -0.05 && t < g.len + 0.05 && Math.abs(n) < g.t / 2 - 0.005) bad.push(`${sw.roomId}: dentro del muro ${g.w.a}→${g.w.b}`);
        if (t < 0 || t > g.len || Math.abs(Math.abs(n) - g.t / 2) > 0.03) continue;
        for (const o of g.w.openings) {
          const [hb, ht] = holeOf(o, g.w.h);
          // La placa mide 8,5 cm: su borde a más de 1,5 cm del canto del vano.
          if (t > o.t0 - 0.06 && t < o.t1 + 0.06 && ht > 1.0 && hb < 1.3 && !WALKABLE.has(o.type)) bad.push(`${sw.roomId}: sobre un vano ${o.type}`);
        }
      }
      for (const it of ITEMS) {
        if (level(it) !== sw.level) continue;
        for (const b of boxes(it)) {
          if (b.y0 < 1.3 && b.y1 > 1.0 && sw.at[0] > b.u0 - 0.06 && sw.at[0] < b.u1 + 0.06 && sw.at[1] > b.v0 - 0.06 && sw.at[1] < b.v1 + 0.06) bad.push(`${sw.roomId}: tapado por ${name(it)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * Alturas del tramo `s` en la franja que ocupa el muro `g` (su espesor sobre
 * el eje), muestreadas cada 5 cm: del pie de la losa (26 cm bajo la huella;
 * los macizos, desde su arranque como el resto del test) a medio escalón por
 * encima. `null` si el tramo no llega a la franja.
 */
function stairBandBox(s: Stair, g: WallGeo, full: Box): Box | null {
  let lo = Infinity;
  let hi = -Infinity;
  const nu = Math.max(2, Math.ceil((s.u1 - s.u0) / 0.05));
  const nv = Math.max(2, Math.ceil((s.v1 - s.v0) / 0.05));
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = s.u0 + ((s.u1 - s.u0) * i) / nu;
      const v = s.v0 + ((s.v1 - s.v0) * j) / nv;
      const ru = u - g.w.a[0];
      const rv = v - g.w.a[1];
      const t = ru * g.du + rv * g.dv;
      const n = -ru * g.dv + rv * g.du;
      if (Math.abs(n) > g.t / 2 || t < 0 || t > g.len) continue;
      const y = stairY(s, u, v);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  if (lo === Infinity) return null;
  const half = (s.y1 - s.y0) / riserCount(s) / 2;
  const solid = s.y0 < 0.5 && !s.hollow;
  return { ...full, y0: solid ? full.y0 : Math.max(full.y0, lo - 0.26), y1: Math.min(full.y1, hi + half) };
}

describe('QA de escaleras en su lugar', () => {
  const stairLevel = (y0: number): Level => Math.min(2, Math.floor((y0 + 0.01) / SCHOOL.storey)) as Level;

  it('ningún tramo ni descanso atraviesa un muro', () => {
    const bad: string[] = [];
    const rects = [
      ...STAIRS.map((s) => ({ r: s, y0: s.y0, y1: s.y1, id: `tramo ${s.u0},${s.v0} ${s.dir}` })),
      ...LANDINGS.map((l) => ({ r: l, y0: l.y - 0.24, y1: l.y, id: `descanso ${l.u0},${l.v0}` })),
    ];
    for (const { r, y0, y1, id } of rects) {
      // Alturas absolutas (los muros arrancan en 0; los tramos, sobre el piso terminado).
      const full: Box = { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1, y0: SCHOOL.floorY + y0, y1: SCHOOL.floorY + y1, tag: id };
      for (const g of GEOS) {
        const wb = g.w.level * SCHOOL.storey;
        // Un tramo inclinado ocupa, sobre el muro, sólo la altura que tiene
        // donde lo cruza: el tramo largo de la escalera exterior pasa a 1 m
        // por debajo del muro del aula del primer piso que lo cubre en su
        // arranque, no a la altura de su llegada.
        const b = 'dir' in r ? stairBandBox(r, g, full) : full;
        if (!b) continue;
        if (overlap(wb, wb + g.w.h, b.y0 + 0.02, b.y1 - 0.02) <= 0) continue;
        const p = project(g, b);
        if (p.t1 < 0.02 || p.t0 > g.len - 0.02) continue;
        // Empotrar el canto de una losa o de un tramo en el muro es lo normal;
        // pasarlo de lado a lado (que asome del otro lado), no.
        const n0 = Math.max(p.n0, -g.t / 2);
        const n1 = Math.min(p.n1, g.t / 2);
        if (n1 - n0 < g.t - 0.01) continue;
        if (wallSolidIn(g, Math.max(0, p.t0), Math.min(g.len, p.t1), b.y0 - wb + 0.02, b.y1 - wb, 0.02)) {
          bad.push(`${id} atraviesa el muro ${g.w.a}→${g.w.b} L${g.w.level}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('nada queda enterrado bajo un tramo de escalera', () => {
    const bad: string[] = [];
    for (const s of STAIRS) {
      const lv = stairLevel(s.y0);
      const solid = s.y0 < 0.5 && !s.hollow;
      for (const it of ITEMS) {
        if (level(it) !== lv || DECAL.has(it.kind)) continue;
        for (const b of boxes(it)) {
          const ou = overlap(b.u0, b.u1, s.u0, s.u1);
          const ov = overlap(b.v0, b.v1, s.v0, s.v1);
          if (ou <= 0.02 || ov <= 0.02) continue;
          // Altura más baja del tramo sobre el objeto (su cara inferior).
          const corners: Array<[number, number]> = [
            [Math.max(b.u0, s.u0), Math.max(b.v0, s.v0)],
            [Math.min(b.u1, s.u1), Math.min(b.v1, s.v1)],
            [Math.max(b.u0, s.u0), Math.min(b.v1, s.v1)],
            [Math.min(b.u1, s.u1), Math.max(b.v0, s.v0)],
          ];
          const under = Math.min(...corners.map(([cu, cv]) => stairY(s, cu, cv))) - SCHOOL.floorY - lv * SCHOOL.storey - 0.3;
          if (solid || b.y1 > under) bad.push(`${name(it)} [${b.tag}] bajo el tramo ${s.u0},${s.v0}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('QA de las hojas fijas', () => {
  it('las hojas abiertas contra el muro no atraviesan muebles', () => {
    // Mismo criterio que `SchoolBuilder.opening`: abren hacia el ambiente
    // (no hacia el pasillo) y las de emergencia hacia la calle.
    const isHall = (r: ReturnType<typeof roomAt>) => !r || !r.roofed || r.name === 'Pasillo' || r.name === 'Galería' || r.name === 'Hall';
    const bad: string[] = [];
    for (const g of GEOS) {
      const nu = -g.dv;
      const nv = g.du;
      for (const o of g.w.openings) {
        if (!['door', 'double', 'exit', 'entrance'].includes(o.type)) continue;
        const at = (d: number): [number, number] => [g.w.a[0] + g.du * d, g.w.a[1] + g.dv * d];
        if (isInteractiveDoor(g.w.level, at(o.t0), at(o.t1))) continue;
        const [mu, mv] = at((o.t0 + o.t1) / 2);
        const rp = roomAt(mu + nu * 0.45, mv + nv * 0.45, g.w.level);
        const rn = roomAt(mu - nu * 0.45, mv - nv * 0.45, g.w.level);
        let s = !isHall(rp) ? 1 : !isHall(rn) ? -1 : 1;
        const ext = !rp && rn ? 1 : !rn && rp ? -1 : 0;
        if (o.type === 'exit' && ext !== 0) s = ext;
        const len = o.t1 - o.t0;
        const hinges = o.type === 'door' ? [0.08] : [0.08, len - 0.08];
        const leafW = o.type === 'door' ? len - 0.16 : (len - 0.16) / 2;
        for (const h of hinges) {
          const p = at(o.t0 + h);
          const q0: [number, number] = [p[0] + nu * s * (g.t / 2 + 0.02), p[1] + nv * s * (g.t / 2 + 0.02)];
          const q1: [number, number] = [q0[0] + nu * s * leafW, q0[1] + nv * s * leafW];
          const lu0 = Math.min(q0[0], q1[0]) - 0.03;
          const lu1 = Math.max(q0[0], q1[0]) + 0.03;
          const lv0 = Math.min(q0[1], q1[1]) - 0.03;
          const lv1 = Math.max(q0[1], q1[1]) + 0.03;
          for (const it of ITEMS) {
            if (level(it) !== g.w.level || DECAL.has(it.kind)) continue;
            if (boxes(it).some((b) => b.y0 < 2.0 && overlap(b.u0, b.u1, lu0, lu1) > 0.01 && overlap(b.v0, b.v1, lv0, lv1) > 0.01)) {
              bad.push(`hoja de ${o.type} en ${g.w.a}→${g.w.b} L${g.w.level} contra ${name(it)}`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('QA de orientación', () => {
  it('los muebles con frente no le dan la espalda al ambiente (frente contra el muro)', () => {
    const FRONTED = new Set<Item['kind']>(['shelf', 'cabinet', 'drawers', 'lockers', 'filing', 'piano', 'sinkCounter', 'fridgeGlass', 'coatBench', 'trophyShelf', 'copier']);
    const flip: Record<Item['face'], Item['face']> = { n: 's', s: 'n', e: 'w', w: 'e' };
    const bad: string[] = [];
    for (const it of ITEMS) {
      if (!FRONTED.has(it.kind)) continue;
      const b = boxes(it)[0];
      const [fu, fv] = faceDir(it.face);
      const frontU = fu > 0 ? b.u1 : fu < 0 ? b.u0 : it.u;
      const frontV = fv > 0 ? b.v1 : fv < 0 ? b.v0 : it.v;
      const backU = fu > 0 ? b.u0 : fu < 0 ? b.u1 : it.u;
      const backV = fv > 0 ? b.v0 : fv < 0 ? b.v1 : it.v;
      const front = wallGapBehind(level(it), frontU, frontV, flip[it.face]);
      const back = wallGapBehind(level(it), backU, backV, it.face);
      if (front < 0.1 && back > 0.1) bad.push(`${name(it)} mira al muro (frente a ${(front * 100).toFixed(0)} cm)`);
    }
    expect(bad).toEqual([]);
  });
});
