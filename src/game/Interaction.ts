/**
 * Qué está mirando (o apuntando) el jugador entre las cosas con las que se
 * puede interactuar. Puro: recibe posiciones y direcciones, devuelve el
 * candidato. En escritorio manda la mirada (el centro de la pantalla); en
 * el visor, el rayo del control.
 */

export interface Candidate {
  key: string;
  /** Centro en el mundo. */
  x: number;
  y: number;
  z: number;
  /** Radio aproximado del objeto (para apuntarle sin precisión de cirujano). */
  radius: number;
  /** Distancia máxima, en planta, desde los pies del jugador. */
  range: number;
  /** Cota del piso del objeto: sólo se interactúa en el mismo piso. */
  baseY: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Ángulo mínimo de tolerancia al mirar algo (rad). */
const MIN_ANGLE = 0.2;

/** Por la mirada: lo más alineado con el centro de la pantalla dentro de su alcance. */
export function focusByGaze(cands: readonly Candidate[], eye: V3, dir: V3, feet: V3, occluded?: (c: Candidate) => boolean): Candidate | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    if (Math.abs(feet.y - c.baseY) > 1.3) continue;
    const dPlan = Math.hypot(c.x - feet.x, c.z - feet.z);
    if (dPlan - c.radius * 0.5 > c.range) continue;
    const vx = c.x - eye.x;
    const vy = c.y - eye.y;
    const vz = c.z - eye.z;
    const vl = Math.hypot(vx, vy, vz) || 1;
    const cos = (vx * dir.x + vy * dir.y + vz * dir.z) / (vl * dl);
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    // Muy cerca, alcanza con mirar más o menos hacia ahí.
    const allowed = dPlan < 1.1 ? 1.2 : Math.max(MIN_ANGLE, Math.atan((c.radius + 0.25) / vl));
    if (angle > allowed) continue;
    const score = angle / allowed + (dPlan / c.range) * 0.35;
    if (score < bestScore && !(occluded && occluded(c))) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Por un rayo (control del visor): lo que el rayo pasa más cerca, dentro del alcance. */
export function focusByRay(cands: readonly Candidate[], origin: V3, dir: V3, feet: V3, reach = 1.35): Candidate | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const dx = dir.x / dl;
  const dy = dir.y / dl;
  const dz = dir.z / dl;
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    if (Math.abs(feet.y - c.baseY) > 1.3) continue;
    const dPlan = Math.hypot(c.x - feet.x, c.z - feet.z);
    if (dPlan - c.radius * 0.5 > c.range * reach) continue;
    // A una persona se le apunta a cualquier parte del cuerpo (de la cadera
    // a la cabeza), no a un punto del pecho: con el control en la mano, el
    // rayo casi nunca pasaba a menos de medio metro de ese punto.
    const person = c.key.startsWith('npc:');
    const ys = person ? [c.y - 0.75, c.y - 0.35, c.y, c.y + 0.25] : [c.y];
    const tol = c.radius + (person ? 0.3 : 0.22);
    let miss = Infinity;
    let t = -1;
    for (const y of ys) {
      const vx = c.x - origin.x;
      const vy = y - origin.y;
      const vz = c.z - origin.z;
      const tt = vx * dx + vy * dy + vz * dz;
      if (tt < 0) continue;
      const m = Math.hypot(vx - dx * tt, vy - dy * tt, vz - dz * tt);
      if (m < miss) {
        miss = m;
        t = tt;
      }
    }
    if (t < 0 || miss > tol) continue;
    const score = miss / tol + t * 0.05;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
