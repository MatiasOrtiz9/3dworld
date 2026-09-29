import type { Block, CityPlan } from './CityLayout';

/**
 * Trazado del campus CIMDIP & Miguel Cané.
 *
 * Datos puros, como `CityLayout`: no importa nada del motor. Lo consultan el
 * constructor del edificio, el índice de colisión, la multitud y las
 * estaciones de desafíos, y por eso vive en un solo lugar. Antes cada uno
 * derivaba sus propias coordenadas con fracciones sueltas de `block.depth` y
 * terminaban en desacuerdo: estaciones en medio de la calle y un patio que se
 * salía de la manzana.
 *
 * Todo se describe en coordenadas LOCALES de la manzana:
 *   u → a lo ancho de la fachada (+u a la derecha de quien mira la escuela)
 *   v → de adelante hacia atrás (la fachada principal mira hacia −v)
 * y se rota para que la entrada mire siempre hacia la plaza, esté la escuela
 * donde esté.
 */

export interface Rect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface SchoolFrame {
  block: Block;
  cx: number;
  cz: number;
  /** Rotación sobre Y (convención de Babylon) de local → mundo. */
  rot: number;
  cos: number;
  sin: number;
}

/** Medidas del campus, en metros, para una manzana de 42 × 42. */
export const SCHOOL = {
  /** Borde de la manzana (semiancho). */
  half: 21,
  /** Fachada principal y fondo del bloque de aulas del frente. */
  frontV: -14,
  frontBackV: -4,
  /** Semiancho del edificio. */
  halfWidth: 19,
  /** Alas laterales: de `frontBackV` hasta `wingEndV`, entre |u| = wingInner y halfWidth. */
  wingInner: 11,
  wingEndV: 11,
  /** Hall pasante de planta baja (se cruza caminando al patio). */
  lobbyHalf: 3.2,
  /** Pisos: bloque del frente y alas, según las fotos de la sede. */
  frontFloors: 2,
  wingFloors: 2,
  floorH: 3.6,
  /** Reja de frente: se interrumpe en el portón. */
  fenceV: -20.2,
  gateHalf: 4.2,
} as const;

/** Cancha del patio, entre las alas (el eje largo corre a lo ancho, en u). */
export const COURT: Rect = { u0: -9, v0: -1.2, u1: 9, v1: 10.4 };
/** Patio completo entre las alas, detrás del bloque del frente. */
export const COURTYARD: Rect = { u0: -10.6, v0: -3.6, u1: 10.6, v1: 12 };
/** Explanada de acceso entre la reja y la fachada. */
export const FORECOURT: Rect = { u0: -19, v0: -20, u1: 19, v1: -15 };
/** Huerta escolar al fondo. */
export const GARDEN: Rect = { u0: -19, v0: 12.6, u1: 19, v1: 19.8 };
/** Patio de juegos iniciales, detrás del ala izquierda del campus. */
export const PLAYGROUND: Rect = { u0: -14.2, v0: 13, u1: -5.8, v1: 19.1 };

/** Mástil de la bandera, en la explanada. */
export const FLAG = { u: -12.2, v: -17.6 } as const;

/** Posiciones locales de las estaciones de aprendizaje. */
export const STATION_SPOTS = {
  tech: { u: -7.5, v: -17.2 },
  robotics: { u: 7.5, v: -17.2 },
  science: { u: -9.2, v: -2.3 },
  sport: { u: 9.2, v: 11.6 },
  environment: { u: -3, v: 16.4 },
} as const;

export function schoolFrame(block: Block, plan: CityPlan): SchoolFrame {
  // La fachada mira hacia la plaza: la escuela se lee desde el lugar donde
  // aparece el jugador y desde donde llega la mayor parte de la gente.
  const dx = plan.plazaCenter.x - block.cx;
  const dz = plan.plazaCenter.z - block.cz;
  let rot: number;
  if (Math.abs(dz) >= Math.abs(dx)) rot = dz < 0 ? 0 : Math.PI;
  else rot = dx < 0 ? Math.PI / 2 : -Math.PI / 2;
  // Fachada hacia −v. Con rot = 0, −v es −z; rotar la manzana lleva −v hacia
  // la plaza en los otros tres casos.
  return {
    block,
    cx: block.cx,
    cz: block.cz,
    rot,
    cos: Math.round(Math.cos(rot)),
    sin: Math.round(Math.sin(rot)),
  };
}

/** Local (u, v) → mundo (x, z). */
export function toWorld(f: SchoolFrame, u: number, v: number): { x: number; z: number } {
  return { x: f.cx + u * f.cos + v * f.sin, z: f.cz - u * f.sin + v * f.cos };
}

/** Mundo (x, z) → local (u, v). */
export function toLocal(f: SchoolFrame, x: number, z: number): { u: number; v: number } {
  const dx = x - f.cx;
  const dz = z - f.cz;
  return { u: dx * f.cos - dz * f.sin, v: dx * f.sin + dz * f.cos };
}

export function inRect(r: Rect, u: number, v: number, margin = 0): boolean {
  return u > r.u0 - margin && u < r.u1 + margin && v > r.v0 - margin && v < r.v1 + margin;
}

/**
 * ¿Ese punto local está ocupado por el edificio?
 *
 * El hall de acceso de planta baja NO bloquea: se atraviesa caminando desde la
 * explanada hasta el patio, que es el recorrido natural de un alumno.
 */
export function schoolSolidLocal(u: number, v: number, margin = 0.35): boolean {
  const S = SCHOOL;
  const au = Math.abs(u);
  // Bloque del frente, salvo el hall pasante.
  if (v > S.frontV - margin && v < S.frontBackV + margin && au < S.halfWidth + margin) {
    return au > S.lobbyHalf - margin;
  }
  // Alas laterales.
  if (v >= S.frontBackV && v < S.wingEndV + margin && au > S.wingInner - margin && au < S.halfWidth + margin) {
    return true;
  }
  // Reja del frente (menos el portón) y cercos vivos laterales y del fondo.
  if (Math.abs(v - S.fenceV) < 0.25 + margin * 0.3 && au > S.gateHalf && au < S.half) return true;
  if (au > S.half - 0.8 - margin && v > S.fenceV - 0.3) return true;
  if (v > S.half - 0.8 - margin) return true;
  // Mástil de la bandera, pedestales de las estaciones y columnas de la marquesina.
  if (Math.hypot(u - FLAG.u, v - FLAG.v) < 0.5) return true;
  if (Math.hypot(u - 6.8, v + 20.45) < 1.65) return true;
  // Equipamiento del patio infantil: torre, tobogán y postes de hamacas.
  if (Math.hypot(u + 11.1, v - 16.7) < 0.95) return true;
  if (Math.hypot(u + 9.35, v - 16.75) < 0.5) return true;
  for (const swingU of [-8.3, -6.2]) {
    if (Math.hypot(u - swingU, v - 16.5) < 0.28) return true;
  }
  for (const k in STATION_SPOTS) {
    const p = STATION_SPOTS[k as keyof typeof STATION_SPOTS];
    if (Math.hypot(u - p.u, v - p.v) < 0.85) return true;
  }
  if (Math.abs(au - 4.3) < 0.3 && Math.abs(v - (S.frontV - 3.4)) < 0.3) return true;
  return false;
}
