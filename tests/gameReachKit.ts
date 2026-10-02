import {
  LEVEL_Y,
  levelOf,
  schoolFloorLocal,
  schoolSolidLocal,
  type Level,
} from '../src/world/SchoolLayout';

/**
 * Herramientas de alcance para los tests del juego: inundación por nivel
 * sobre la misma colisión que usa el jugador y subida por escaleras con el
 * mismo seguimiento de piso. No es parte del juego: sólo verifica que lo que
 * la historia pide se pueda alcanzar caminando.
 */

export const CELL = 0.1;
const U0 = -12;
const V0 = -44;
const U1 = 72;
const V1 = 8;
export const GW = Math.ceil((U1 - U0) / CELL);
export const GH = Math.ceil((V1 - V0) / CELL);

const idx = (u: number, v: number): number => {
  const i = Math.floor((u - U0) / CELL);
  const j = Math.floor((v - V0) / CELL);
  if (i < 0 || j < 0 || i >= GW || j >= GH) return -1;
  return j * GW + i;
};

/** Celdas alcanzables de un nivel desde un punto, con los pies a la cota del nivel. */
export function flood(level: Level, start: readonly [number, number]): Uint8Array {
  const feet = LEVEL_Y[level];
  const seen = new Uint8Array(GW * GH);
  const queue = new Int32Array(GW * GH);
  const s = idx(start[0], start[1]);
  if (s < 0) return seen;
  const cu = (k: number) => U0 + ((k % GW) + 0.5) * CELL;
  const cv = (k: number) => V0 + (Math.floor(k / GW) + 0.5) * CELL;
  if (schoolSolidLocal(cu(s), cv(s), feet)) return seen;
  let head = 0;
  let tail = 0;
  queue[tail++] = s;
  seen[s] = 1;
  while (head < tail) {
    const k = queue[head++];
    const i = k % GW;
    const j = Math.floor(k / GW);
    const next = [i > 0 ? k - 1 : -1, i < GW - 1 ? k + 1 : -1, j > 0 ? k - GW : -1, j < GH - 1 ? k + GW : -1];
    for (const n of next) {
      if (n < 0 || seen[n]) continue;
      seen[n] = 2;
      if (schoolSolidLocal(cu(n), cv(n), feet)) continue;
      seen[n] = 1;
      queue[tail++] = n;
    }
  }
  return seen;
}

export function reached(grid: Uint8Array, u: number, v: number, slack = 0.25): boolean {
  // El punto exacto o alguno a un paso: los puntos de la historia se escriben a mano.
  for (const [du, dv] of [
    [0, 0],
    [slack, 0],
    [-slack, 0],
    [0, slack],
    [0, -slack],
  ]) {
    const k = idx(u + du, v + dv);
    if (k >= 0 && grid[k] === 1) return true;
  }
  return false;
}

/**
 * Camina una poligonal dejando que los pies sigan el piso (como el jugador).
 * Devuelve la altura final de los pies, o null si algo la bloquea.
 */
export function walk(path: ReadonlyArray<readonly [number, number]>, feet0: number): number | null {
  let feet = feet0;
  for (let i = 0; i < path.length - 1; i++) {
    const [u0, v0] = path[i];
    const [u1, v1] = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.05));
    for (let k = 1; k <= n; k++) {
      const u = u0 + ((u1 - u0) * k) / n;
      const v = v0 + ((v1 - v0) * k) / n;
      if (schoolSolidLocal(u, v, feet)) return null;
      feet = schoolFloorLocal(u, v, feet);
    }
  }
  return feet;
}

export { levelOf };
