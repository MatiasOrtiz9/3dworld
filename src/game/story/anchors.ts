import {
  ITEMS,
  LEVEL_Y,
  ROOMS,
  WALLS,
  WALKABLE,
  inPoly,
  roomAt,
  roomLevel,
  schoolFloorLocal,
  schoolSolidLocal,
  type Item,
  type Level,
  type OpeningType,
  type Room,
  type Stair,
} from '../../world/SchoolLayout';
import type { Anchor, Spot } from './types';

/**
 * Resolución de anclas: de "la impresora 3D del Aula Maker" a un punto del
 * plano, y de ahí a un lugar donde se pueda estar parado para usarla.
 *
 * La escuela se sigue ajustando (muebles que se corren, ambientes que crecen)
 * y la historia no debería romperse por eso: se ancla a los objetos del plano
 * por tipo y ambiente, y el punto de pie se busca alrededor del objeto con la
 * misma colisión del jugador. Los tests verifican que cada ancla siga
 * cayendo en su ambiente.
 */

/** Ancla resuelta: el punto del objeto (o del lugar) y su nivel. */
export interface Resolved extends Spot {
  /** Ambiente esperado ('' = afuera, en la vereda). */
  room: string;
  item?: Item;
  /** El objeto no se encontró: se usó el centro del ambiente. */
  missing?: boolean;
}

const roomCache = new Map<string, Room>();

export function roomById(id: string): Room | undefined {
  if (roomCache.size === 0) for (const r of ROOMS) roomCache.set(r.id, r);
  return roomCache.get(id);
}

/** Punto interior de un ambiente: su centro si cae adentro, si no el vértice medio más cercano. */
export function roomCenter(r: Room): [number, number] {
  let cu = 0;
  let cv = 0;
  for (const [u, v] of r.poly) {
    cu += u;
    cv += v;
  }
  cu /= r.poly.length;
  cv /= r.poly.length;
  if (inPoly(r.poly, cu, cv)) return [cu, cv];
  // Polígono cóncavo: se busca un punto interior cerca del centro.
  for (let d = 0.5; d < 12; d += 0.5) {
    for (let a = 0; a < 16; a++) {
      const u = cu + Math.cos((a / 16) * Math.PI * 2) * d;
      const v = cv + Math.sin((a / 16) * Math.PI * 2) * d;
      if (inPoly(r.poly, u, v)) return [u, v];
    }
  }
  return [r.poly[0][0], r.poly[0][1]];
}

/** Ambiente (id) en un punto y nivel; '' afuera. */
export function roomIdAt(u: number, v: number, level: Level): string {
  return roomAt(u, v, level)?.id ?? '';
}

export function resolveAnchor(a: Anchor): Resolved {
  if ('item' in a) {
    const room = roomById(a.room);
    const level = room ? roomLevel(room) : 0;
    const matches = ITEMS.filter((it) => it.kind === a.item && (it.level ?? 0) === level && roomIdAt(it.u, it.v, level) === a.room);
    const it = matches[Math.min(a.nth ?? 0, matches.length - 1)];
    if (it) return { u: it.u, v: it.v, level, room: a.room, item: it };
    const [u, v] = room ? roomCenter(room) : [0, 0];
    return { u, v, level, room: a.room, missing: true };
  }
  if (a.room === '') {
    const [u, v] = a.at ?? [0, 2];
    return { u, v, level: 0, room: '' };
  }
  const room = roomById(a.room);
  const level = room ? roomLevel(room) : 0;
  if (a.at) return { u: a.at[0], v: a.at[1], level, room: a.room, missing: !room };
  const [u, v] = room ? roomCenter(room) : [0, 0];
  return { u, v, level, room: a.room, missing: !room };
}

/** Holgura del cuerpo: el punto y cuatro vecinos a este radio, libres. */
const BODY = 0.3;

/** ¿Se puede estar parado acá (en ese nivel, con el cuerpo entero, fuera de una escalera)? */
export function standable(u: number, v: number, level: Level): boolean {
  const feet = LEVEL_Y[level];
  if (schoolSolidLocal(u, v, feet)) return false;
  // Sobre un escalón el piso no es el del nivel: no sirve para pararse a charlar.
  if (Math.abs(schoolFloorLocal(u, v, feet) - feet) > 0.05) return false;
  for (const [du, dv] of [
    [BODY, 0],
    [-BODY, 0],
    [0, BODY],
    [0, -BODY],
  ]) {
    if (schoolSolidLocal(u + du, v + dv, feet)) return false;
  }
  return true;
}

/** Dirección local hacia la que mira el frente de un objeto. */
export function faceVector(face: Item['face'] | 'n' | 's' | 'e' | 'w'): [number, number] {
  return face === 'n' ? [0, -1] : face === 's' ? [0, 1] : face === 'e' ? [1, 0] : [-1, 0];
}

/**
 * Lugar de pie para usar un objeto o hablar con alguien: el más cercano al
 * ancla que sea transitable y esté en el mismo ambiente, prefiriendo el frente
 * del objeto. Busca en anillos crecientes; el resultado es determinista.
 */
export function standNear(r: Resolved, opts: { min?: number; max?: number; prefer?: [number, number] | null } = {}): Spot & { ok: boolean } {
  const it = r.item;
  const base = it ? Math.max(it.w, it.d) / 2 + 0.45 : 0;
  const min = opts.min ?? base;
  const max = opts.max ?? 4;
  const prefer = opts.prefer === null ? null : (opts.prefer ?? (it ? faceVector(it.face) : null));
  const inRoom = (u: number, v: number) => roomIdAt(u, v, r.level) === r.room;
  if (min <= 0.01 && inRoom(r.u, r.v) && standable(r.u, r.v, r.level)) return { u: r.u, v: r.v, level: r.level, ok: true };
  let best: { u: number; v: number; score: number } | null = null;
  for (let d = Math.max(0.15, min); d <= max; d += 0.15) {
    const n = Math.max(12, Math.round((Math.PI * 2 * d) / 0.15));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const du = Math.cos(a);
      const dv = Math.sin(a);
      const u = r.u + du * d;
      const v = r.v + dv * d;
      if (!inRoom(u, v) || !standable(u, v, r.level)) continue;
      // Frente del objeto: penaliza ir por detrás o de costado.
      const align = prefer ? du * prefer[0] + dv * prefer[1] : 1;
      const score = d + (1 - align) * 0.6;
      if (!best || score < best.score) best = { u, v, score };
    }
    // Con un candidato a menos de un anillo de distancia, ya no hay uno mejor lejos.
    if (best && best.score < d + 0.2) break;
  }
  if (best) return { u: best.u, v: best.v, level: r.level, ok: true };
  return { u: r.u, v: r.v, level: r.level, ok: false };
}

/** Rumbo (giro en mundo, 0 = +z) de quien mira desde `from` hacia `to`, en coordenadas del plano. */
export function yawLocal(from: { u: number; v: number }, to: { u: number; v: number }): number {
  // Mundo: x = ox − u, z = oz + v.
  return Math.atan2(-(to.u - from.u), to.v - from.v);
}

/** Rumbo hacia un punto cardinal del plano (n = −v). */
export function yawCardinal(face: 'n' | 's' | 'e' | 'w'): number {
  const [du, dv] = faceVector(face);
  return Math.atan2(-du, dv);
}

// =================================================================== vanos y escaleras

export interface OpeningRef {
  a: [number, number];
  b: [number, number];
  type: OpeningType;
  level: Level;
}

/** Vano transitable más cercano a un punto, en un nivel (para cerrar una puerta con una hoja del juego). */
export function openingNear(level: Level, u: number, v: number, maxDist = 1.5): OpeningRef | null {
  let best: OpeningRef | null = null;
  let bestD = maxDist;
  for (const w of WALLS) {
    if (w.level !== level) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    for (const o of w.openings) {
      if (!WALKABLE.has(o.type)) continue;
      const a: [number, number] = [w.a[0] + du * o.t0, w.a[1] + dv * o.t0];
      const b: [number, number] = [w.a[0] + du * o.t1, w.a[1] + dv * o.t1];
      const d = Math.hypot((a[0] + b[0]) / 2 - u, (a[1] + b[1]) / 2 - v);
      if (d < bestD) {
        bestD = d;
        best = { a, b, type: o.type, level };
      }
    }
  }
  return best;
}

/** Todos los vanos transitables de un nivel cuyo tramo cumple `test` (extremos del vano). */
export function openingsOnLine(level: Level, test: (a: [number, number], b: [number, number]) => boolean): OpeningRef[] {
  const out: OpeningRef[] = [];
  for (const w of WALLS) {
    if (w.level !== level) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    for (const o of w.openings) {
      if (!WALKABLE.has(o.type)) continue;
      const a: [number, number] = [w.a[0] + du * o.t0, w.a[1] + dv * o.t0];
      const b: [number, number] = [w.a[0] + du * o.t1, w.a[1] + dv * o.t1];
      if (test(a, b)) out.push({ a, b, type: o.type, level });
    }
  }
  return out;
}

/** Tramo de escalera que contiene un punto (el primero que lo contiene). */
export function stairAt(stairs: readonly Stair[], u: number, v: number, y0Max = 99): Stair | null {
  for (const s of stairs) {
    if (s.y0 <= y0Max && u >= s.u0 && u <= s.u1 && v >= s.v0 && v <= s.v1) return s;
  }
  return null;
}

/**
 * Pie de un tramo: el borde por donde se empieza a subir y la dirección hacia
 * afuera (desde donde se llega).
 */
export function stairFoot(s: Stair): { a: [number, number]; b: [number, number]; out: [number, number] } {
  switch (s.dir) {
    case 'u+':
      return { a: [s.u0, s.v0], b: [s.u0, s.v1], out: [-1, 0] };
    case 'u-':
      return { a: [s.u1, s.v0], b: [s.u1, s.v1], out: [1, 0] };
    case 'v+':
      return { a: [s.u0, s.v0], b: [s.u1, s.v0], out: [0, -1] };
    default:
      return { a: [s.u0, s.v1], b: [s.u1, s.v1], out: [0, 1] };
  }
}
