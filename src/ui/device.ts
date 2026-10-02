/**
 * Qué clase de dispositivo es éste, para el modo celular.
 *
 * Sin nada de Babylon a propósito: se consulta ANTES de crear el motor (las
 * opciones del contexto WebGL dependen de la respuesta) y las funciones de
 * cálculo son puras, así que los tests las prueban sin navegador.
 */

/** Gama de un celular o tableta: decide resolución y punto de partida de la calidad. */
export type DeviceClass = 'weak' | 'mid' | 'strong';

export interface DeviceInfo {
  /** GB que informa el navegador (`navigator.deviceMemory`, sólo Chromium). */
  memory?: number;
  /** Hilos de CPU (`navigator.hardwareConcurrency`). */
  cores?: number;
  /** Nombre de la GPU (WEBGL_debug_renderer_info). Puede venir vacío. */
  gpu?: string;
}

/**
 * ¿Se juega con los dedos? Manda el puntero PRINCIPAL: una notebook con
 * pantalla táctil sigue siendo de mouse y teclado; un celular o una tableta
 * no. Los visores (Quest, Pico) quedan afuera aunque informen toque: allí
 * se juega con los mandos. `?touch=1|0` lo fuerza para probar en la PC.
 */
export function detectTouchMode(search = location.search): boolean {
  const forced = new URLSearchParams(search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (/OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent)) return false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse && (navigator.maxTouchPoints ?? 0) > 0;
}

/** Datos del equipo tal como los expone el navegador. */
export function readDeviceInfo(gpu = ''): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { memory: nav.deviceMemory, cores: nav.hardwareConcurrency, gpu };
}

/**
 * Gama del celular. Heurística conservadora: ante la duda, gama media, y la
 * calidad adaptativa corrige en los primeros segundos de juego.
 *
 * - Débil: poca memoria o pocos núcleos, o GPUs de entrada (Mali-G5x,
 *   Mali-G71/72, Adreno 3xx–5xx y 60x/61x, PowerVR) o render por software.
 * - Fuerte: 8 GB y 8 núcleos con una GPU de gama alta (Adreno 73x+,
 *   Immortalis, Xclipse, Mali-G710+).
 */
export function classifyDevice(info: DeviceInfo): DeviceClass {
  const gpu = info.gpu ?? '';
  const weakGpu =
    /swiftshader|llvmpipe|software|powervr|mali-(?:t|g5\d|g7[12]\b)|adreno[^\d]*(?:[345]\d\d|6[01]\d)\b/i.test(gpu);
  if (weakGpu || (info.memory !== undefined && info.memory <= 3) || (info.cores !== undefined && info.cores <= 4)) {
    return 'weak';
  }
  const strongGpu = /adreno[^\d]*(?:7[3-9]\d|[89]\d\d)\b|immortalis|xclipse|mali-g(?:7[1-9]0|[89]\d\d)\b/i.test(gpu);
  if (strongGpu && (info.memory ?? 0) >= 8 && (info.cores ?? 0) >= 8) return 'strong';
  return 'mid';
}

/**
 * Píxeles de render por píxel CSS.
 *
 * El motor dibuja en píxeles CSS (`adaptToDeviceRatio` apagado): en un
 * celular de densidad 3 eso es un píxel de render cada 9 de pantalla y se ve
 * borroso. Cada gama tiene una densidad objetivo y un techo de píxeles por
 * cuadro (el costo real en una GPU móvil es el ancho de banda por píxel); se
 * usa lo menor de los dos y nunca más que la densidad física.
 */
export function mobileRenderScale(cls: DeviceClass, cssWidth: number, cssHeight: number, dpr: number): number {
  const target = { weak: 0.9, mid: 1.25, strong: 1.6 }[cls];
  const budget = { weak: 0.33e6, mid: 0.62e6, strong: 1.0e6 }[cls];
  const px = Math.max(1, cssWidth * cssHeight);
  const byBudget = Math.sqrt(budget / px);
  const scale = Math.min(target, byBudget, Math.max(1, dpr));
  return Math.max(0.6, Math.round(scale * 100) / 100);
}

/**
 * Campo visual vertical para una pantalla de esta proporción.
 *
 * El escritorio fija el vertical en 56°: en 16:9 da ~87° horizontales. Un
 * celular apaisado es 19,5:9 o más, y con el mismo vertical el horizontal
 * pasa los 100° — gente y pupitres estirados en los bordes, y todo más chico
 * en una pantalla que ya es chica. Se fija el horizontal (~90°) y el
 * vertical sale de la proporción, sin pasar nunca el del escritorio.
 */
export function fovForAspect(aspect: number, horizontalDeg = 90, max = 0.98, min = 0.78): number {
  const a = Math.max(0.5, aspect);
  const v = 2 * Math.atan(Math.tan((horizontalDeg * Math.PI) / 360) / a);
  return Math.min(max, Math.max(min, v));
}

/** ¿La pantalla está vertical? Con dedos, el juego pide girar el teléfono. */
export function isPortrait(): boolean {
  if (typeof matchMedia === 'function') return matchMedia('(orientation: portrait)').matches;
  return window.innerHeight > window.innerWidth;
}

/** Frecuencias de pantalla habituales: la medición se pega a la más cercana. */
const REFRESH_RATES = [60, 72, 75, 90, 100, 120, 144, 165];

/**
 * Frecuencia de la pantalla a partir de intervalos entre cuadros (ms).
 *
 * Se usa el percentil 20 y no el promedio: mientras carga la escuela o con
 * una escena pesada muchos cuadros duran dos o tres refrescos, pero los más
 * cortos siguen siendo un refresco exacto.
 */
export function estimateRefresh(intervals: readonly number[]): number {
  const ok = intervals.filter((d) => d > 3 && d < 60).sort((a, b) => a - b);
  if (ok.length < 8) return 60;
  const p = ok[Math.floor(ok.length * 0.2)];
  const hz = 1000 / p;
  return REFRESH_RATES.reduce((best, r) => (Math.abs(r - hz) < Math.abs(best - hz) ? r : best), 60);
}

/**
 * Tope de cuadros que divide exacto la frecuencia de la pantalla, lo más
 * cerca posible del pedido. Un tope de 60 en una pantalla de 90 Hz dibuja
 * dos cuadros de cada tres: uno dura 11 ms y el siguiente 22 — se ve a
 * saltos. 45 parejos (uno de cada dos) se ven más suaves.
 */
export function evenCap(refreshHz: number, wanted: number): number {
  const n = Math.max(1, Math.round(refreshHz / Math.max(1, wanted)));
  return refreshHz / n;
}

/** Mide la frecuencia de la pantalla durante `frames` cuadros (en paralelo al motor). */
export function sampleRefresh(onResult: (hz: number) => void, frames = 150): void {
  const gaps: number[] = [];
  let last = 0;
  const tick = (t: number): void => {
    if (last) gaps.push(t - last);
    last = t;
    if (gaps.length < frames) requestAnimationFrame(tick);
    else onResult(estimateRefresh(gaps));
  };
  requestAnimationFrame(tick);
}
