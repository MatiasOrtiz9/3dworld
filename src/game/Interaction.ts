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
    const vx = c.x - origin.x;
    const vy = c.y - origin.y;
    const vz = c.z - origin.z;
    const t = vx * dx + vy * dy + vz * dz;
    if (t < 0) continue;
    const px = vx - dx * t;
    const py = vy - dy * t;
    const pz = vz - dz * t;
    const miss = Math.hypot(px, py, pz);
    if (miss > c.radius + 0.22) continue;
    const score = miss / (c.radius + 0.22) + t * 0.05;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
