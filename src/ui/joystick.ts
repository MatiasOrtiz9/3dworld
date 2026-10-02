/**
 * Matemática de los controles táctiles, sin DOM ni motor (la prueban los
 * tests). Coordenadas de pantalla: x a la derecha, y hacia abajo.
 */

export interface StickOutput {
  /** Lateral, −1 a 1. */
  x: number;
  /** Adelante (dedo hacia arriba) = +1. */
  y: number;
  /** Recorrido útil, 0 a 1, ya sin la zona muerta. */
  mag: number;
}

/** Zona muerta del stick: el pulgar apoyado nunca está quieto del todo. */
export const DEAD_ZONE = 0.14;
/** Ventana de imán a los ejes (rad): caminar derecho por un pasillo sin pelear con el pulgar. */
const AXIS_SNAP = 0.1;

/**
 * Salida del stick para el dedo a (dx, dy) píxeles del centro.
 *
 * La zona muerta se descuenta y el resto se reescala, así que pasarla no da
 * un salto: la velocidad arranca desde cero. Cerca de un eje (±6°) la
 * dirección se pega al eje.
 */
export function stickOutput(dx: number, dy: number, radius: number, dead = DEAD_ZONE): StickOutput {
  const d = Math.hypot(dx, dy);
  if (radius <= 0 || d < 1e-6) return { x: 0, y: 0, mag: 0 };
  const raw = Math.min(1, d / radius);
  const mag = raw <= dead ? 0 : (raw - dead) / (1 - dead);
  if (mag === 0) return { x: 0, y: 0, mag: 0 };
  let angle = Math.atan2(-dy, dx);
  const quarter = Math.PI / 2;
  const nearest = Math.round(angle / quarter) * quarter;
  if (Math.abs(angle - nearest) < AXIS_SNAP) angle = nearest;
  const x = Math.cos(angle) * mag;
  const y = Math.sin(angle) * mag;
  return { x: Math.abs(x) < 1e-9 ? 0 : x, y: Math.abs(y) < 1e-9 ? 0 : y, mag };
}

/**
 * Joystick que persigue al dedo: si el dedo se pasa del borde, la base se
 * corre detrás de él. Así cambiar de dirección nunca exige volver primero
 * hasta el centro (lo que en un stick fijo se siente como un retraso).
 */
export function followBase(baseX: number, baseY: number, fingerX: number, fingerY: number, radius: number): { x: number; y: number } {
  const dx = fingerX - baseX;
  const dy = fingerY - baseY;
  const d = Math.hypot(dx, dy);
  if (d <= radius) return { x: baseX, y: baseY };
  const k = (d - radius) / d;
  return { x: baseX + dx * k, y: baseY + dy * k };
}

/** Curva del stick de cámara: fina cerca del centro para apuntar, rápida en el borde para girar. */
export function lookCurve(v: number): number {
  const a = Math.min(1, Math.abs(v));
  return Math.sign(v) * (0.3 * a + 0.7 * a * a * a);
}

/**
 * Ganancia del deslizamiento según la velocidad del dedo (px/ms): un
 * movimiento lento apunta con precisión y uno rápido da la vuelta sin
 * levantar el dedo varias veces. Como la aceleración del mouse.
 */
export function swipeGain(pxPerMs: number): number {
  const t = Math.min(1, Math.max(0, (pxPerMs - 0.3) / 1.5));
  return 1 + 0.6 * t * t * (3 - 2 * t);
}

/** Inclinación vertical permitida (rad): un poco menos de mirar justo arriba o abajo. */
export const PITCH_LIMIT = 1.42;

export function clampPitch(p: number): number {
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, p));
}

/** Un toque y no un arrastre: corto y casi sin moverse. */
export function isTap(ms: number, travelPx: number): boolean {
  return ms <= 300 && travelPx <= 12;
}
