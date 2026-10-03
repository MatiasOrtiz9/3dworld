/**
 * Horas del día: datos puros de la atmósfera, sin motor.
 *
 * Vive aparte de `Environment` por lo mismo que `Palette` y `CityLayout`: se
 * puede ajustar una luz o una niebla sin tocar el render, y se prueba en Node
 * en milisegundos (interpolación, dirección del sol, niebla según el tamaño
 * del barrio, encuadre de la sombra estática).
 *
 * Todos los colores están en espacio LINEAL y antes de la exposición: son
 * radiancias, no colores de pantalla. El mapeo tonal ACES los lleva a
 * pantalla después, igual que al resto de la escena PBR. Así el horizonte del
 * cielo y la niebla de los objetos lejanos salen del MISMO número y empalman
 * sin costura.
 */

export type Rgb = readonly [number, number, number];

export type TimeOfDay = 'morning' | 'noon' | 'goldenHour' | 'dusk';

export const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: 'Mañana',
  noon: 'Mediodía',
  goldenHour: 'Hora dorada',
  dusk: 'Atardecer',
};

export const TIME_ORDER: TimeOfDay[] = ['morning', 'noon', 'goldenHour', 'dusk'];

/**
 * Hora del reloj de cada preajuste.
 *
 * Son los fotogramas clave del ciclo continuo: entre dos horas consecutivas se
 * interpola todo, así el deslizador recorre el día sin saltos.
 */
export const KEYFRAMES: ReadonlyArray<{ hour: number; time: TimeOfDay }> = [
  { hour: 8, time: 'morning' },
  { hour: 13, time: 'noon' },
  { hour: 18.5, time: 'goldenHour' },
  { hour: 20.5, time: 'dusk' },
];

export const DAY_START = 8;
export const DAY_END = 20.5;

/**
 * Hora con la que arranca el juego: la llegada a la escuela.
 *
 * Sol bajo del este (apenas al sur), cálido y rasante sobre la fachada de
 * Laprida (que mira al sur): las rejas, la gente y las palmeras proyectan
 * sombras largas sobre la vereda. Es la imagen más "de película" del día y la que cuenta la
 * historia —es la hora de entrada—, a diferencia del mediodía, con el sol
 * detrás del edificio y la fachada plana.
 */
export const DEFAULT_HOUR = 8.25;

/** Nombre legible de una hora decimal: 13.5 -> "13:30". */
export function formatHour(hour: number): string {
  let h = Math.floor(hour);
  let m = Math.round((hour - h) * 60);
  // 8,999 no debe mostrarse como "08:60".
  if (m === 60) {
    h += 1;
    m = 0;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface AtmospherePreset {
  /** Inclinación solar: 0 = horizonte, 1 = cenit. */
  elevation: number;
  /**
   * Azimut en radianes (dirección hacia el sol = cos, sin sobre x, z).
   *
   * El norte está en −Z y el este en −X. Valores mayores que 2π son a
   * propósito: el recorrido del sol tiene que ser MONÓTONO para que la
   * interpolación entre la tarde y el ocaso no dé la vuelta por el sur.
   *
   * Es el sol de un día de clases de primavera-verano en Buenos Aires: sale
   * por el este, apenas al sur (la fachada sur recibe luz rasante a la mañana),
   * culmina al norte y se pone por el oeste-sudoeste.
   */
  azimuth: number;
  sunColor: Rgb;
  sunIntensity: number;
  /**
   * Luz hemisférica: el relleno frío del cielo y el rebote cálido del suelo.
   * Baja a propósito: en los PBR de la ciudad vale × π (ver
   * Materials.PBR_DIRECT_GAIN); en follaje y gente, tal cual, y ahí el
   * emisivo propio ya hace de relleno.
   */
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  /** Intensidad del IBL (cielo capturado). */
  envIntensity: number;
  /** Cielo: cénit y horizonte. El horizonte ES el color de la niebla. */
  zenith: Rgb;
  horizon: Rgb;
  /** Franja de bruma sobre el horizonte (0-1). */
  haze: number;
  /** Halo alrededor del sol. */
  sunGlow: number;
  /** Fracción del cielo cubierta por nubes (0-1). */
  cloudCover: number;
  cloudLit: Rgb;
  cloudShade: Rgb;
  /**
   * Espesor de la niebla: 1 la vuelve opaca justo en el borde del suelo,
   * más es más brumoso. Ver `fogDensityFor`.
   */
  fogThickness: number;
  /** Exposición y contraste del mapeo tonal. */
  exposure: number;
  contrast: number;
}

/**
 * Preajustes de la atmósfera.
 *
 * Criterios de iluminación:
 *  - Luz principal cálida, relleno frío: el sol tira a ámbar y la luz del
 *    cielo (hemisférica + IBL) a azul. Las sombras quedan azuladas y los
 *    planos al sol, dorados: la lectura de volumen sale de esa diferencia de
 *    temperatura, no sólo de la de brillo.
 *  - La relación sol / sombra en un muro ronda 6 : 1 a la mañana (aire con
 *    bruma, sombras abiertas) y ~8 : 1 al mediodía. Más que eso empasta las
 *    sombras; menos, y la luz no dibuja nada.
 *  - El sol no pasa de ~2,5: follaje, césped y gente son StandardMaterial
 *    calibrados para ese valor (Materials.STANDARD_SUN_COMP). El contraste se
 *    gana bajando el relleno, no subiendo el sol.
 *  - La exposición compensa la caída de luz al atardecer sin "levantarlo"
 *    hasta parecer de día: el ocaso tiene que leerse como ocaso.
 *  - Exposición y contraste de una cámara, no de una película: un muro
 *    blanco al sol queda apenas por debajo del blanco y el contraste ronda
 *    1,05-1,08 (con 1,12-1,15 las sombras se empastaban y el rojo de los
 *    uniformes saturaba). Bajo techo el ojo se adapta solo (ver
 *    Environment.adaptExposure): la exposición de acá es la de la vereda.
 */
export const PRESETS: Record<TimeOfDay, AtmospherePreset> = {
  morning: {
    elevation: 0.2,
    // Este, apenas al sur (~9°): el sol real de las 8:15 en Buenos Aires en
    // primavera. Con 2,72 (24° al sur) la torre de 66 m del barrio, al
    // sudeste de la escuela, tapaba la fachada entera a la hora de llegada
    // y la primera imagen del juego era un frente gris sin sol.
    azimuth: 2.98,
    sunColor: [1, 0.8, 0.6],
    sunIntensity: 2.5,
    hemiSky: [0.52, 0.64, 0.86],
    hemiGround: [0.34, 0.28, 0.22],
    hemiIntensity: 0.07,
    envIntensity: 0.38,
    // Cénit algo más profundo y horizonte celeste pálido en vez de gris: el
    // horizonte ES la niebla, y con gris la ciudad de fondo se leía como
    // una pared lavada. Celeste, cada capa de edificios se aclara y azula con
    // la distancia (perspectiva aérea) y el lado del sol sigue cálido por
    // la bruma del cielo.
    zenith: [0.09, 0.22, 0.63],
    horizon: [0.72, 0.78, 0.86],
    haze: 0.65,
    sunGlow: 1,
    cloudCover: 0.42,
    cloudLit: [1.35, 1.12, 0.92],
    cloudShade: [0.56, 0.6, 0.74],
    // La mínima que todavía funde el borde del suelo (ver fogDensityFor):
    // con 1,15 la primera hilera de la ciudad de fondo (~150 m) ya estaba
    // a mitad de niebla y la segunda casi borrada.
    fogThickness: 1,
    exposure: 1.04,
    contrast: 1.06,
  },
  noon: {
    elevation: 0.74,
    azimuth: 4.45,
    sunColor: [1, 0.96, 0.9],
    sunIntensity: 2.45,
    hemiSky: [0.46, 0.6, 0.86],
    hemiGround: [0.3, 0.28, 0.24],
    hemiIntensity: 0.07,
    envIntensity: 0.38,
    zenith: [0.06, 0.19, 0.6],
    horizon: [0.7, 0.78, 0.88],
    haze: 0.45,
    sunGlow: 0.6,
    cloudCover: 0.34,
    cloudLit: [1.5, 1.48, 1.42],
    cloudShade: [0.62, 0.68, 0.8],
    fogThickness: 1,
    exposure: 0.92,
    contrast: 1.08,
  },
  goldenHour: {
    elevation: 0.09,
    azimuth: 6.55,
    sunColor: [1, 0.62, 0.32],
    sunIntensity: 2.4,
    hemiSky: [0.48, 0.5, 0.66],
    hemiGround: [0.34, 0.23, 0.16],
    hemiIntensity: 0.075,
    envIntensity: 0.36,
    zenith: [0.13, 0.2, 0.44],
    horizon: [0.96, 0.68, 0.46],
    haze: 0.85,
    sunGlow: 1.7,
    cloudCover: 0.42,
    cloudLit: [1.7, 1.0, 0.58],
    cloudShade: [0.44, 0.36, 0.46],
    fogThickness: 1.2,
    exposure: 1.06,
    contrast: 1.08,
  },
  dusk: {
    elevation: 0.015,
    azimuth: 6.8,
    sunColor: [1, 0.44, 0.24],
    sunIntensity: 1.1,
    hemiSky: [0.3, 0.34, 0.54],
    hemiGround: [0.17, 0.13, 0.13],
    hemiIntensity: 0.09,
    envIntensity: 0.42,
    zenith: [0.035, 0.05, 0.15],
    horizon: [0.62, 0.36, 0.3],
    haze: 0.95,
    sunGlow: 1.5,
    cloudCover: 0.4,
    cloudLit: [1.25, 0.52, 0.36],
    cloudShade: [0.17, 0.14, 0.22],
    fogThickness: 1.3,
    exposure: 1.38,
    contrast: 1.05,
  },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Interpola dos preajustes. `t` va de 0 (a) a 1 (b). */
export function blendPresets(a: AtmospherePreset, b: AtmospherePreset, t: number): AtmospherePreset {
  const out = { ...a } as Record<string, number | Rgb>;
  for (const key of Object.keys(a) as Array<keyof AtmospherePreset>) {
    const x = a[key];
    const y = b[key];
    out[key] = typeof x === 'number' ? lerp(x, y as number, t) : lerpRgb(x, y as Rgb, t);
  }
  return out as unknown as AtmospherePreset;
}

/**
 * Atmósfera de una hora decimal, entre DAY_START y DAY_END.
 *
 * La interpolación es suavizada (smoothstep) y no lineal: con un tramo
 * lineal, al pasar por un fotograma clave la luz cambiaba de ritmo de golpe y
 * se notaba un "escalón" al arrastrar el deslizador.
 */
export function presetAt(hour: number): AtmospherePreset {
  const h = Math.min(DAY_END, Math.max(DAY_START, hour));
  const exact = KEYFRAMES.find((k) => k.hour === h);
  if (exact) return PRESETS[exact.time];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[i + 1];
    if (h >= a.hour && h <= b.hour) {
      const span = b.hour - a.hour;
      const t = span > 0 ? (h - a.hour) / span : 0;
      const s = t * t * (3 - 2 * t);
      return blendPresets(PRESETS[a.time], PRESETS[b.time], s);
    }
  }
  return PRESETS[KEYFRAMES[KEYFRAMES.length - 1].time];
}

/** Dirección unitaria HACIA el sol (no la de la luz, que es la opuesta). */
export function sunDirection(elevation: number, azimuth: number): { x: number; y: number; z: number } {
  const el = (elevation * Math.PI) / 2;
  return {
    x: Math.cos(el) * Math.cos(azimuth),
    y: Math.sin(el),
    z: Math.cos(el) * Math.sin(azimuth),
  };
}

/**
 * Cuánto sigue el suelo base más allá del barrio (InfraBuilder.ground): la
 * losa mide `(extent + GROUND_MARGIN)·2` de lado, centrada en el barrio. Es
 * una sola caja: agrandarla no cuesta nada, y es lo que deja afinar la niebla.
 */
export const GROUND_MARGIN = 640;

/**
 * Distancia a la que el suelo tiene que haberse fundido con el cielo (95 %).
 *
 * Antes la losa terminaba a `extent + 200` y la niebla tenía que cerrar en
 * `extent + 220`: a 160 m (la segunda capa de la ciudad de fondo) ya iba por
 * la mitad y desde el aire todo se veía lavado. Con el suelo hasta
 * `extent + GROUND_MARGIN`, la niebla cierra en `extent + 360`: la manzana de
 * enfrente queda limpia, la ciudad de fondo se aclara y azula por capas
 * (perspectiva aérea) y el borde del suelo, a más de 600 m de cualquier punto
 * del barrio, queda por encima del 98 %.
 */
export function fogReach(worldExtent: number): number {
  return worldExtent + 360;
}

/**
 * Densidad de niebla EXP2 que deja el suelo al 5 % de visibilidad en `reach`.
 *
 * Con niebla exponencial cuadrática, f = exp(-(d·ρ)²); f = 0,05 cuando
 * d·ρ = √(−ln 0,05) ≈ 1,731. Atar la densidad al tamaño del mundo es lo que
 * hace que el mismo preajuste sirva para la grilla anterior y para el barrio
 * compacto: siempre se funde el borde del suelo, nunca la escuela.
 */
export function fogDensityFor(reach: number, thickness = 1): number {
  return (1.7308 * thickness) / Math.max(1, reach);
}

/** Fracción de niebla (0 = nada, 1 = opaca) a una distancia, para EXP2. */
export function fogAmount(distance: number, density: number): number {
  const k = distance * density;
  return 1 - Math.exp(-k * k);
}

/**
 * Encuadre de la sombra estática: una cámara ortográfica cuadrada que mira
 * desde el sol al foco del barrio.
 *
 * La sombra estática se dibuja UNA vez por cambio de hora (la ciudad y sus
 * proyectores no se mueven), así que su costo por cuadro es sólo la lectura
 * del mapa. Todo el mapa se gasta en el foco —la escuela y la primera hilera
 * de casas— en vez de en el cinturón de árboles, que la niebla se come igual.
 */
export function staticShadowFrame(
  center: { x: number; y: number; z: number },
  radius: number,
  toSun: { x: number; y: number; z: number },
  /** Altura máxima de los proyectores sobre el foco (escuela ~12 m). */
  height = 30,
): { position: { x: number; y: number; z: number }; size: number; minZ: number; maxZ: number } {
  const len = Math.hypot(toSun.x, toSun.y, toSun.z) || 1;
  const d = { x: toSun.x / len, y: toSun.y / len, z: toSun.z / len };
  // La cámara se aleja lo suficiente para que nada de lo que cae dentro del
  // cuadrado quede detrás de ella, aunque el sol esté rasante.
  const back = radius + height;
  return {
    position: { x: center.x + d.x * back, y: center.y + d.y * back, z: center.z + d.z * back },
    size: radius * 2,
    minZ: 0.5,
    maxZ: back + radius + height,
  };
}

/**
 * ¿Esta malla debe proyectar sombra?
 *
 *  - Lo transparente (vidrios, agua) NO: el vidrio que proyecta sombra opaca
 *    es lo que dejaba las aulas sin manchas de sol en el piso. Sin él, la luz
 *    de la mañana entra por las ventanas.
 *  - Lo chato a ras del suelo (losa base, calzadas, veredas) tampoco: no hay
 *    nada debajo a quien hacerle sombra y son de las mallas más grandes, que
 *    además inflaban el encuadre de la sombra.
 */
export function castsShadow(info: { minY: number; maxY: number; transparent: boolean }): boolean {
  if (info.transparent) return false;
  return info.maxY >= 0.35;
}
