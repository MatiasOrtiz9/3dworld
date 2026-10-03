/**
 * Réplica sin Babylon del modo caminar de `PlayerController` (colisión por
 * ejes separados con una sonda a RADIUS delante, sub-pasos de COLLISION_STEP,
 * gravedad y seguimiento del piso) contra la colisión real de la escuela. La
 * usan las pruebas de puertas y escaleras: "se ve una puerta" tiene que querer
 * decir "el jugador pasa", y "se ve una escalera", "se sube y se baja".
 */
import { LEVEL_Y, schoolFloorLocal, schoolSolidLocal, solidPieces, WALKABLE, WALLS, type Level, type Stair, type Wall } from '../src/world/SchoolLayout';

export const RADIUS = 0.45;
const COLLISION_STEP = RADIUS * 0.5;
const ACCELERATION = 11;
const GRAVITY = -18;

export interface Body {
  u: number;
  v: number;
  feet: number;
}

/**
 * Camina en la dirección fija (du, dv) (normalizada) a `speed` m/s durante
 * `seconds` a `fps` cuadros por segundo. Devuelve dónde terminó.
 */
export function walk(start: Body, du: number, dv: number, speed: number, fps: number, seconds: number, stopAt?: (b: Body) => boolean): Body {
  const len = Math.hypot(du, dv);
  const tu = (du / len) * speed;
  const tv = (dv / len) * speed;
  const dt = 1 / fps;
  const b = { ...start };
  let velU = 0;
  let velV = 0;
  let velY = 0;
  let grounded = true;
  const blend = 1 - Math.exp(-ACCELERATION * dt);
  for (let f = 0; f < seconds * fps; f++) {
    velU += (tu - velU) * blend;
    velV += (tv - velV) * blend;
    const mu = velU * dt;
    const mv = velV * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(mu), Math.abs(mv)) / COLLISION_STEP));
    for (let i = 0; i < steps; i++) {
      const nu = b.u + mu / steps;
      if (mu === 0 || !blockedMove(b, nu + Math.sign(mu) * RADIUS, b.v, grounded)) b.u = nu;
      else velU = 0;
      const nv = b.v + mv / steps;
      if (mv === 0 || !blockedMove(b, b.u, nv + Math.sign(mv) * RADIUS, grounded)) b.v = nv;
      else velV = 0;
    }
    const floor = schoolFloorLocal(b.u, b.v, b.feet);
    velY += GRAVITY * dt;
    b.feet += velY * dt;
    grounded = false;
    if (b.feet <= floor) {
      b.feet = floor;
      velY = 0;
      grounded = true;
    }
    if (stopAt?.(b)) break;
  }
  return b;
}

/** La misma prueba que hace el controlador antes de mover un eje. */
function blockedMove(b: Body, u: number, v: number, grounded: boolean): boolean {
  return schoolSolidLocal(u, v, b.feet) || (grounded && schoolFloorLocal(u, v, b.feet) < b.feet - 0.65);
}

export interface Doorway {
  wall: Wall;
  level: Level;
  /** Centro del vano sobre el eje del muro. */
  u: number;
  v: number;
  /** Dirección del muro y su normal. */
  du: number;
  dv: number;
  nu: number;
  nv: number;
  width: number;
  label: string;
}

/** Todos los vanos transitables a nivel de piso (sin antepecho alto). */
export function doorways(): Doorway[] {
  const out: Doorway[] = [];
  for (const w of WALLS) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    for (const o of w.openings) {
      if (!WALKABLE.has(o.type) || (o.hb ?? 0) > 0.45) continue;
      const t = (o.t0 + o.t1) / 2;
      const u = w.a[0] + du * t;
      const v = w.a[1] + dv * t;
      out.push({
        wall: w,
        level: w.level,
        u,
        v,
        du,
        dv,
        nu: -dv,
        nv: du,
        width: o.t1 - o.t0,
        label: `L${w.level} ${o.type} w${(o.t1 - o.t0).toFixed(2)} @(${u.toFixed(2)},${v.toFixed(2)})`,
      });
    }
  }
  return out;
}

/** ¿Cruza el vano de un lado al otro? Signo `side`: arranca del lado +normal (1) o −normal (−1). */
export function crosses(d: Doorway, side: 1 | -1, offset: number, depth = 1.0, need = 0.5): { ok: boolean; solidStart: boolean; why: string } {
  const feet = LEVEL_Y[d.level];
  // Arranca a `depth` del muro o, en un cuarto chico, un poco más cerca.
  let su = NaN;
  let sv = NaN;
  for (const k of [depth, 0.85, 0.7]) {
    su = d.u + d.nu * side * k + d.du * offset;
    sv = d.v + d.nv * side * k + d.dv * offset;
    if (!schoolSolidLocal(su, sv, feet)) break;
    su = NaN;
  }
  if (Number.isNaN(su)) return { ok: false, solidStart: true, why: 'arranque macizo' };
  const end = walk({ u: su, v: sv, feet }, -d.nu * side, -d.nv * side, 4.2, 60, 1.5, (b) => passed(b) >= 0.8);
  function passed(b: Body): number {
    return -((b.u - d.u) * d.nu + (b.v - d.v) * d.nv) * side;
  }
  const p = passed(end);
  return { ok: p >= need, solidStart: false, why: `llegó a ${p.toFixed(2)} del plano desde (${su.toFixed(2)},${sv.toFixed(2)})` };
}

export { solidPieces };

export interface FlightRun {
  ok: boolean;
  why: string;
}

/**
 * Sube un tramo desde `before` m antes del pie hasta `after` m pasada la
 * llegada (o lo baja, con `down`), corrido `offset` del eje, y dice si llegó
 * con los pies a la cota del otro extremo.
 */
export function runFlight(s: Stair, down: boolean, offset: number, speed: number, fps: number, before = 0.6, after = 0.6): FlightRun {
  const alongU = s.dir === 'u+' || s.dir === 'u-';
  const sign = s.dir === 'u+' || s.dir === 'v+' ? 1 : -1;
  const lo = alongU ? s.u0 : s.v0;
  const hi = alongU ? s.u1 : s.v1;
  const foot = sign > 0 ? lo : hi;
  const top = sign > 0 ? hi : lo;
  const mid = alongU ? (s.v0 + s.v1) / 2 + offset : (s.u0 + s.u1) / 2 + offset;
  const y0 = LEVEL_Y[0] + s.y0;
  const y1 = LEVEL_Y[0] + s.y1;
  const from = down ? top + sign * after : foot - sign * before;
  const to = down ? foot - sign * before : top + sign * after;
  const dir = down ? -sign : sign;
  const startFeet = down ? y1 : y0;
  const at = (a: number): [number, number] => (alongU ? [a, mid] : [mid, a]);
  const [su, sv] = at(from);
  const feet = schoolFloorLocal(su, sv, startFeet + 0.05);
  if (Math.abs(feet - startFeet) > 0.2) return { ok: false, why: `arranque a ${feet.toFixed(2)}, se esperaba ${startFeet.toFixed(2)}` };
  if (schoolSolidLocal(su, sv, feet)) return { ok: false, why: 'arranque macizo' };
  const pos = (b: Body) => (alongU ? b.u : b.v);
  const moved = walk({ u: su, v: sv, feet }, alongU ? dir : 0, alongU ? 0 : dir, speed, fps, 8, (b) => (pos(b) - to) * dir >= 0);
  // Quien baja corriendo llega a la meta todavía en el aire: medio segundo quieto.
  const end = walk(moved, alongU ? dir : 0, alongU ? 0 : dir, 0, fps, 0.5);
  const want = down ? y0 : y1;
  const ok = (pos(end) - to) * dir >= -0.05 && Math.abs(end.feet - want) < 0.2;
  return { ok, why: `terminó en ${pos(end).toFixed(2)} (meta ${to.toFixed(2)}) con pies ${end.feet.toFixed(2)} (se esperaba ${want.toFixed(2)})` };
}
