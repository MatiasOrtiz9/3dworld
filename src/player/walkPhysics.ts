/**
 * Física del modo caminar, sin Babylon.
 *
 * Vive aparte de `PlayerController` para que las pruebas de puertas y
 * escaleras corran EXACTAMENTE el mismo código que el jugador: una copia en
 * los tests se desincronizaba en silencio y "pasa la prueba" dejaba de querer
 * decir "pasa el jugador".
 */

/** Lo que la caminata le pregunta al mundo (CityIndex, o la escuela sola en los tests). */
export interface WalkWorld {
  isSolid(x: number, z: number, feetY?: number): boolean;
  groundHeight(x: number, z: number, feetY?: number): number;
}

export interface WalkState {
  x: number;
  z: number;
  /** Altura de los pies. */
  feet: number;
  vx: number;
  vz: number;
  vy: number;
  grounded: boolean;
}

export const WALK_SPEED = 4.2; // m/s — paso rápido de persona
export const RUN_SPEED = 8.5;
export const GRAVITY = -18;
export const JUMP = 6.4;
export const RADIUS = 0.45; // radio del cuerpo para la colisión
const ACCELERATION = 11;
const BRAKING = 15;
const COLLISION_STEP = RADIUS * 0.5;
/**
 * Caída máxima que se baja caminando sin saltar. En la escuela, más que esto
 * sólo pasa por el costado abierto de un tramo de escalera: sin el límite se
 * atravesaba el pasamanos dibujado y se caía al piso de abajo. Un tramo
 * empinado, mirado RADIUS + un sub-paso adelante, baja ~0,5 m: el límite
 * queda por encima para no trabar a quien baja la escalera.
 */
export const MAX_DROP = 0.65;
/**
 * Fracción mínima del radio con la que se sonda cada eje. La sonda de cada eje
 * se escala con cuánto de la marcha va por ese eje: cruzando en diagonal una
 * puerta de un muro oblicuo, la sonda entera del eje menor tocaba la jamba y
 * frenaba esa componente (el jugador derrapaba 0,2-0,4 m de costado). El piso
 * de 0,5 deja el cuerpo a ≥ 22 cm de un muro aun yendo casi paralelo, lejos
 * del plano cercano de la cámara (0,10).
 */
const MIN_PROBE = 0.5;

/** ¿Hay algo en (x, z)? Con los pies en el piso, también un borde de más de MAX_DROP. */
export function walkBlocked(world: WalkWorld, x: number, z: number, feet: number, grounded: boolean): boolean {
  return world.isSolid(x, z, feet) || (grounded && world.groundHeight(x, z, feet) < feet - MAX_DROP);
}

/**
 * Un cuadro de caminata: acelera hacia (targetX, targetZ) en m/s, mueve con
 * colisión por ejes separados en sub-pasos y aplica gravedad y piso. El salto
 * se pide con `jump` (sólo si está en el piso). Modifica `s`; devuelve la
 * distancia horizontal recorrida (para los pasos).
 */
export function walkStep(world: WalkWorld, s: WalkState, targetX: number, targetZ: number, dt: number, jump = false): number {
  const hasInput = targetX !== 0 || targetZ !== 0;
  const blend = 1 - Math.exp(-(hasInput ? ACCELERATION : BRAKING) * dt);
  s.vx += (targetX - s.vx) * blend;
  s.vz += (targetZ - s.vz) * blend;
  const moveX = s.vx * dt;
  const moveZ = s.vz * dt;
  const len = Math.hypot(moveX, moveZ);
  const reachX = len > 0 ? RADIUS * Math.max(MIN_PROBE, Math.abs(moveX) / len) : RADIUS;
  const reachZ = len > 0 ? RADIUS * Math.max(MIN_PROBE, Math.abs(moveZ) / len) : RADIUS;

  const beforeX = s.x;
  const beforeZ = s.z;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(moveX), Math.abs(moveZ)) / COLLISION_STEP));
  const stepX = moveX / steps;
  const stepZ = moveZ / steps;
  for (let i = 0; i < steps; i++) {
    const nextX = s.x + stepX;
    if (stepX === 0 || !walkBlocked(world, nextX + Math.sign(stepX) * reachX, s.z, s.feet, s.grounded)) s.x = nextX;
    else s.vx = 0;
    const nextZ = s.z + stepZ;
    if (stepZ === 0 || !walkBlocked(world, s.x, nextZ + Math.sign(stepZ) * reachZ, s.feet, s.grounded)) s.z = nextZ;
    else s.vz = 0;
  }

  const floor = world.groundHeight(s.x, s.z, s.feet);
  if (s.grounded && jump) {
    s.vy = JUMP;
    s.grounded = false;
  }
  s.vy += GRAVITY * dt;
  s.feet += s.vy * dt;
  if (s.feet <= floor) {
    s.feet = floor;
    s.vy = 0;
    s.grounded = true;
  }
  return Math.hypot(s.x - beforeX, s.z - beforeZ);
}
