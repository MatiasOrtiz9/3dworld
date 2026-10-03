import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { RenderQuality } from './RenderPipeline';
import type { ShadowFilter, ShadowMode } from '../world/Environment';

export type QualityTier = 'low' | 'mobile' | 'vr' | 'balanced' | 'high';

export interface QualityProfile {
  label: string;
  /** Escala de resolución: >1 renderiza por debajo de la nativa. */
  hardwareScaling: number;
  /**
   * Hay sombras del sol (cualquier modo). Se conserva por compatibilidad:
   * el modo concreto lo dice `shadowMode`.
   */
  shadows: boolean;
  /**
   * `static`: un mapa sobre el barrio dibujado una vez por cambio de hora
   * (costo por cuadro ≈ una lectura de textura); `cascaded`: cascadas que
   * siguen a la cámara, redibujadas cada cuadro. Ver Environment.
   */
  shadowMode: ShadowMode;
  shadowResolution: number;
  /** Filtrado del borde: `low` = 1 lectura PCF por hardware, `medium` = 4. */
  shadowFilter: ShadowFilter;
  /** Multiplicador de densidad de vegetación. */
  greenDensity: number;
  /**
   * Manzanas por lado. Todos los perfiles usan 5: la experiencia se centra en
   * la escuela y el barrio inmediato. El plano compacto lo ignora (su tamaño
   * es fijo); se conserva para no romper a quien lo lea.
   */
  gridSize: number;
  /**
   * Distancia de recorte. Con el barrio compacto, la niebla funde el suelo a
   * unos `extent + 360` m (ver TimeOfDay.fogReach): más allá no hay nada que
   * ver, y un plano lejano corto mejora la precisión de profundidad. El cielo
   * no depende de él (se dibuja en el fondo del búfer, ver Sky). La calidad
   * adaptativa lo acorta, pero nunca por debajo del cierre de la niebla (ver
   * `setFogReach`).
   */
  maxZ: number;
  /** Copas de follaje de alto detalle. */
  highDetailFoliage: boolean;
  /** Detalle fino a nivel de calle (parteluces, balcones altos, bicicleteros). */
  highDetailStreet: boolean;
  /** Cantidad de peatones y ciclistas. */
  crowdSize: number;
  /** Nivel de post-procesado. */
  post: RenderQuality;
  /**
   * Fracción del filtrado anisótropo original de cada textura (1 si falta).
   * En una GPU móvil cada muestra extra se paga en ancho de banda.
   */
  anisotropy?: number;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  // Perfil de entrada para equipos con integrada débil o poca memoria.
  // La escala 1.5 reduce a ~44 % los píxeles de la resolución nativa. Las
  // sombras DINÁMICAS y el SSAO son las pasadas caras según la auditoría; la
  // sombra estática no lo es (se dibuja una vez), así que este perfil la tiene.
  low: {
    label: 'Baja',
    hardwareScaling: 1.5,
    shadows: true,
    shadowMode: 'static',
    shadowResolution: 1024,
    shadowFilter: 'low',
    greenDensity: 0.55,
    gridSize: 5,
    maxZ: 600,
    highDetailFoliage: false,
    highDetailStreet: false,
    crowdSize: 60,
    // El FXAA evita bordes escalonados a baja resolución y bloom + FXAA
    // midieron sólo 0,11 ms por cuadro en la GPU de referencia.
    post: 'lite',
  },
  // Perfil pensado para Quest 2/3: el objetivo son 72 fps sostenidos.
  //
  // Sombra ESTÁTICA y no dinámica. Cuentas para Quest 2 (13,9 ms por cuadro,
  // cada malla se dibuja dos veces, una por ojo): una sombra dinámica sumaría
  // otra pasada de ~200 mallas por cuadro, que en el navegador del visor son
  // varios milisegundos de CPU sólo en llamadas de dibujo. La estática se
  // dibuja una vez al cargar y al mover la hora; por cuadro cuesta una lectura
  // de textura con PCF por hardware por píxel. A cambio, los interiores dejan
  // de recibir sol a través de los techos (antes, sin sombras, el sol
  // iluminaba los pisos de las aulas) y la fachada gana volumen.
  vr: {
    label: 'VR',
    hardwareScaling: 1.15,
    shadows: true,
    shadowMode: 'static',
    shadowResolution: 2048,
    shadowFilter: 'low',
    greenDensity: 0.55,
    gridSize: 5,
    maxZ: 700,
    highDetailFoliage: false,
    highDetailStreet: false,
    // 110 y no 90: la vereda de la escuela a la hora de entrada es la primera
    // vista dentro del visor y con 90 se veían una docena de personas en la
    // puerta (contra ~120 en Alta). Cada persona dibujada cuesta ~735
    // triángulos y ningún draw call (van en lotes por parte del cuerpo).
    crowdSize: 110,
    // SIN post-proceso, y no por costo: por color.
    //
    // El pipeline de post-proceso se engancha a la cámara de escritorio y,
    // por ser HDR, le avisa a todos los materiales que el mapeo tonal
    // (ACES, exposición, contraste, curvas) lo hará él. Dentro del visor
    // dibuja la cámara XR, que no tiene post-proceso: los materiales salían
    // en espacio lineal, sin mapeo tonal — cielo saturado, verdes casi
    // negros, sol quemado. Sin pipeline, el mapeo tonal se compila dentro
    // de cada material y el visor ve lo mismo que el escritorio.
    post: 'off',
  },
  // Celulares y tabletas. Parte del perfil del visor, que ya resolvió una
  // GPU móvil del mismo orden (el Quest es un Snapdragon) con la escuela
  // entera a 72 fps y DOS ojos:
  //
  //  - SIN post-proceso: el mapeo tonal va dentro de cada material (los
  //    colores son los del visor, ya verificados) y el antialiasing es el
  //    MSAA del búfer de pantalla, que en una GPU por mosaicos (todas las de
  //    celular) se resuelve en la memoria del chip casi gratis. Un pipeline
  //    HDR sumaría un búfer de color a resolución completa ida y vuelta por
  //    cuadro: es justo lo que más batería gasta en un teléfono.
  //  - Sombra estática a 1024: se dibuja una vez por cambio de hora.
  //  - La resolución no sale de acá: `main.ts` la ajusta por gama y por
  //    densidad de pantalla (ver ui/device.ts) con `setDeviceScaling`.
  mobile: {
    label: 'Móvil',
    hardwareScaling: 1,
    shadows: true,
    shadowMode: 'static',
    shadowResolution: 1024,
    shadowFilter: 'low',
    greenDensity: 0.5,
    gridSize: 5,
    maxZ: 600,
    highDetailFoliage: false,
    highDetailStreet: false,
    crowdSize: 70,
    post: 'off',
    anisotropy: 0.5,
  },
  // La sombra estática a 2048 se ve mejor que las cascadas a 1024 (que se
  // redibujaban cuatro veces por cuadro) y no cuesta casi nada por cuadro.
  balanced: {
    label: 'Media',
    hardwareScaling: 1,
    shadows: true,
    shadowMode: 'static',
    shadowResolution: 2048,
    shadowFilter: 'medium',
    greenDensity: 0.85,
    gridSize: 5,
    maxZ: 900,
    highDetailFoliage: true,
    highDetailStreet: true,
    crowdSize: 140,
    post: 'balanced',
  },
  high: {
    label: 'Alta',
    hardwareScaling: 1,
    shadows: true,
    shadowMode: 'cascaded',
    shadowResolution: 2048,
    shadowFilter: 'medium',
    greenDensity: 1.15,
    gridSize: 5,
    maxZ: 1100,
    highDetailFoliage: true,
    highDetailStreet: true,
    crowdSize: 180,
    post: 'high',
  },
};

/**
 * Tiempo sano para recuperar un escalón (sin tope / con tope de cuadros) y
 * techo del factor que lo multiplica tras recuperaciones fallidas.
 */
const RECOVER_MS = 8000;
const CAPPED_RECOVER_MS = 15000;
const MAX_RECOVER_FACTOR = 8;

/**
 * Piso del plano lejano, en múltiplos de la distancia a la que cierra la
 * niebla (95 %, ver TimeOfDay.fogReach). A 1,09 la niebla ya va por el 97 %:
 * el suelo y el perfil de la ciudad se funden ANTES del corte. Más cerca, el
 * corte dejaba ver el cielo bajo el horizonte (marrón, el rebote del suelo)
 * debajo de los edificios del fondo, que quedaban flotando sobre nada.
 */
export const FAR_FLOOR_FACTOR = 1.09;

/** Perfiles de escritorio. VR se activa desde el visor, no desde el ciclo. */
export const TIER_ORDER: QualityTier[] = ['low', 'balanced', 'high'];

/**
 * Perfiles que ofrece el botón en un celular. 'Alta' (cascadas de sombra y
 * SSAO) no tiene sentido en un teléfono; 'Media' queda para tabletas
 * potentes. Lo que baje de 'Móvil' lo hace solo la calidad adaptativa.
 */
export const TOUCH_TIER_ORDER: QualityTier[] = ['mobile', 'balanced'];

/**
 * Niveles de calidad.
 *
 * Existen porque el mismo código tiene que correr en una notebook con GPU
 * integrada, en una placa dedicada y en un visor autónomo cuyo presupuesto de
 * cuadro es de 11 ms para DOS ojos. Un único nivel de calidad siempre termina
 * mal en alguno de los tres.
 */
export class QualityManager {
  private tier: QualityTier;
  private adaptive = 0;
  private sampleElapsedMs = 0;
  private sampleFrames = 0;
  private slowWindows = 0;
  private healthyMs = 0;
  private readonly textureAnisotropy = new WeakMap<BaseTexture, number>();
  /** Multiplica la escala de resolución del perfil (celular: densidad y gama del equipo). */
  private deviceScaling = 1;
  /** Cuadros por segundo a sostener fuera del visor (celular: el tope vigente). */
  private desktopTarget = 60;
  /** Perfiles del botón de calidad (en un celular, otros). */
  private order: QualityTier[] = TIER_ORDER;
  /**
   * Con tope de cuadros (celular): sostener el tope es estar sano, pero
   * para recuperar un escalón se exige más tiempo (ver observeFrame).
   */
  private capped = false;
  /** Tiempo de tirones aislados dentro de la ventana (compilar un shader, GC). */
  private hitchMs = 0;
  /** Reloj de la medición (suma de ventanas) y última recuperación. */
  private clockMs = 0;
  private recoveredAt = -Infinity;
  /** Multiplica el tiempo sano exigido para recuperar; se duplica si una recuperación falla. */
  private recoverFactor = 1;
  /** Cuadros que no se miden (arranque, reconstrucción, entrada al visor). */
  private skipMs = 0;
  /** Plano lejano mínimo (ver `setFogReach`); 0 hasta que haya ciudad. */
  private farFloor = 0;

  constructor(
    private readonly engine: Engine,
    private readonly scene: Scene,
    initial: QualityTier = 'high',
  ) {
    this.tier = initial;
  }

  get current(): QualityTier {
    return this.tier;
  }

  get profile(): QualityProfile {
    return QUALITY[this.tier];
  }

  get adaptiveLevel(): number {
    return this.adaptive;
  }

  /**
   * Ajusta la carga en ventanas de 2,5 s: evita reaccionar a un tirón aislado.
   * Devuelve un nivel sólo cuando cambió, para que el juego actualice sus
   * subsistemas una vez y no dentro de cada cuadro.
   */
  observeFrame(deltaMs: number, inVr: boolean): number | null {
    // Un cuadro aislado muy largo no debe contar como todo el intervalo, pero
    // permitir hasta 1 s hace que la adaptación responda también a 1–2 fps.
    const dt = Math.min(1000, Math.max(0, deltaMs));
    // Los primeros segundos tras arrancar, reconstruir o entrar al visor son
    // compilación de shaders y subida de texturas (se midieron ventanas de 3
    // y 14 fps al arrancar): no dicen nada del equipo. Ver `settle`.
    if (this.skipMs > 0) {
      this.skipMs -= dt;
      return null;
    }
    this.sampleElapsedMs += dt;
    this.sampleFrames++;
    // Un cuadro de un cuarto de segundo es un tirón (un shader que se compila
    // al entrar a un ambiente, el recolector de basura), no un equipo lento.
    // Sin descontarlo, un solo tirón bajaba un escalón.
    const capped = this.capped && !inVr;
    if (dt > 250) this.hitchMs += dt;
    if (this.sampleElapsedMs < 2500) return null;

    // Si los tirones son casi toda la ventana, el equipo ES lento: cuentan.
    const hitches = this.hitchMs < this.sampleElapsedMs * 0.4 ? this.hitchMs : 0;
    const fps = (this.sampleFrames * 1000) / Math.max(1, this.sampleElapsedMs - hitches);
    const target = inVr ? 72 : this.desktopTarget;
    const previous = this.adaptive;
    this.clockMs += this.sampleElapsedMs;
    this.sampleElapsedMs = 0;
    this.sampleFrames = 0;
    this.hitchMs = 0;

    if (fps < target * 0.72 && this.adaptive < 3) {
      this.adaptive++;
      this.slowWindows = 0;
      this.healthyMs = 0;
    } else if (fps < target * 0.9 && this.adaptive < 3) {
      this.slowWindows++;
      this.healthyMs = 0;
      if (this.slowWindows >= 2) {
        this.adaptive++;
        this.slowWindows = 0;
      }
    } else {
      this.slowWindows = 0;
      // Sano es sostener el objetivo, no superarlo: una pantalla de 60 Hz (o
      // el visor, fijado en 72) nunca da más que eso, y con la regla de antes
      // (objetivo + 10) un escalón perdido en el arranque no volvía nunca.
      // Con tope se exige más tiempo. Si una recuperación hace caer los
      // cuadros enseguida, la próxima espera el doble: así no oscila.
      const healthy = fps >= target * 0.96;
      if (healthy && this.adaptive > 0) {
        this.healthyMs += 2500;
        if (this.healthyMs >= (capped ? CAPPED_RECOVER_MS : RECOVER_MS) * this.recoverFactor) {
          this.adaptive--;
          this.healthyMs = 0;
          this.recoveredAt = this.clockMs;
        }
      } else {
        this.healthyMs = 0;
      }
    }

    if (this.adaptive > previous && this.clockMs - this.recoveredAt < 15000) {
      this.recoverFactor = Math.min(MAX_RECOVER_FACTOR, this.recoverFactor * 2);
    }
    if (this.adaptive === previous) return null;
    this.applyRuntime();
    return this.adaptive;
  }

  /** Aplica los ajustes que no requieren reconstruir la ciudad. */
  applyRuntime(): void {
    const p = this.profile;
    const resolutionScale = [1, 1.12, 1.28, 1.5][this.adaptive];
    const distanceScale = [1, 0.86, 0.72, 0.58][this.adaptive];
    const textureScale = [1, 0.75, 0.5, 0.25][this.adaptive] * (p.anisotropy ?? 1);
    this.engine.setHardwareScalingLevel(p.hardwareScaling * resolutionScale * this.deviceScaling);
    for (const camera of this.scene.cameras) {
      // La cámara del visor fija su propio plano lejano (ver vr/XRSetup) y
      // sus cámaras de ojo heredan el de ella; allí la palanca adaptativa es
      // la foveación. Pisarlo recortaba el horizonte dentro del visor.
      if (isXrCamera(camera)) continue;
      camera.maxZ = Math.max(p.maxZ * distanceScale, this.farFloor);
    }
    for (const texture of this.scene.textures) {
      if (!this.textureAnisotropy.has(texture)) {
        this.textureAnisotropy.set(texture, texture.anisotropicFilteringLevel);
      }
      const original = this.textureAnisotropy.get(texture) ?? 1;
      const level = Math.max(1, Math.round(original * textureScale));
      if (texture.anisotropicFilteringLevel !== level) texture.anisotropicFilteringLevel = level;
    }
  }

  set(tier: QualityTier): void {
    this.tier = tier;
    this.adaptive = 0;
    this.resetWindow();
    this.recoverFactor = 1;
    this.applyRuntime();
  }

  /**
   * Deja de medir durante `ms` (por omisión 6 s) y empieza una ventana nueva.
   * Se llama al terminar de arrancar, al reconstruir la escuela y al entrar
   * al visor: esos cuadros son compilación y carga, no el equipo. Con
   * `Infinity` no mide hasta el próximo `settle` (mientras se reconstruye).
   */
  settle(ms = 6000): void {
    this.resetWindow();
    this.skipMs = ms;
  }

  private resetWindow(): void {
    this.sampleElapsedMs = 0;
    this.sampleFrames = 0;
    this.slowWindows = 0;
    this.healthyMs = 0;
    this.hitchMs = 0;
  }

  /**
   * Distancia a la que la niebla funde el suelo (Environment.fogReach): el
   * plano lejano adaptativo no baja de `FAR_FLOOR_FACTOR` veces eso.
   *
   * Recortar antes de la niebla no ahorra casi nada: el suelo es una sola
   * losa y la ciudad de fondo va entera en los lotes de color (TintFarm),
   * que el plano lejano no descarta por partes. Lo único que hacía era
   * mostrar el corte: en 'low' y 'mobile' al nivel 3 el plano caía a 348 m
   * con la niebla al 76 %, y desde el aire aparecía una franja marrón bajo
   * el perfil. Por encima del piso la palanca sigue igual (Alta, Media).
   */
  setFogReach(reach: number): void {
    this.farFloor = Math.max(0, reach) * FAR_FLOOR_FACTOR;
    this.applyRuntime();
  }

  /** Siguiente nivel, en ciclo. Para el botón del HUD. */
  cycle(): QualityTier {
    const i = this.order.indexOf(this.tier);
    this.set(this.order[(i + 1) % this.order.length]);
    return this.tier;
  }

  /** Perfiles que recorre `cycle()` (el celular tiene los suyos). */
  setCycle(order: QualityTier[]): void {
    this.order = order;
  }

  /**
   * Escala de resolución del equipo, encima de la del perfil: <1 dibuja más
   * píxeles que los CSS (pantallas densas), >1 menos.
   */
  setDeviceScaling(scaling: number): void {
    this.deviceScaling = scaling;
    this.applyRuntime();
  }

  /**
   * Arranca ya en un nivel adaptativo (celular de gama baja): mejor empezar
   * liviano que mostrar los primeros segundos a tirones.
   */
  startAdaptive(level: number): void {
    this.adaptive = Math.max(0, Math.min(3, Math.round(level)));
    this.applyRuntime();
  }

  /**
   * Tope de cuadros vigente fuera del visor (celular), o `null` sin tope.
   * Con un tope (ahorro de batería, menú abierto) medir contra 60 bajaría la
   * calidad sin motivo. Reinicia la ventana de medición: no mezcla cuadros
   * de antes y después.
   */
  setFrameCap(fps: number | null): void {
    const capped = fps !== null;
    const target = fps ?? 60;
    if (capped === this.capped && target === this.desktopTarget) return;
    this.capped = capped;
    this.desktopTarget = target;
    this.resetWindow();
  }

  /**
   * Detecta un dispositivo probablemente limitado para elegir el nivel inicial.
   * Es heurístico a propósito: mejor arrancar conservador y que el usuario
   * suba, que arrancar en Alta y que la primera impresión sea a 20 fps.
   */
  static suggestInitial(canvas?: HTMLCanvasElement): QualityTier {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    if (/Quest|Pico/i.test(navigator.userAgent)) return 'vr';
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return 'mobile';
    // Los núcleos no representan la potencia gráfica. La memoria disponible
    // y las GPUs Intel antiguas ayudan a no arrancar con sombras/SSAO en una
    // notebook económica que informa muchos hilos de CPU.
    const renderer = getWebGLRenderer(canvas);
    const weakGpu = /swiftshader|llvmpipe|software rasterizer|intel.*(?:hd graphics|uhd graphics [1-6])/i.test(
      renderer,
    );
    if (cores <= 4 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || weakGpu) {
      return 'low';
    }
    if (cores <= 8 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 8)) return 'balanced';
    return 'high';
  }
}

/** Cámara del visor o cámara de ojo (rig) de cualquier cámara. */
function isXrCamera(camera: { isRigCamera?: boolean; getClassName?: () => string }): boolean {
  return Boolean(camera.isRigCamera) || camera.getClassName?.() === 'WebXRCamera';
}

function getWebGLRenderer(canvas?: HTMLCanvasElement): string {
  try {
    const probe = canvas ?? document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!gl) return '';
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    // Si usamos el canvas de Babylon, es el contexto activo de la ciudad y no
    // se debe liberar. Sólo descartamos el contexto del canvas auxiliar.
    if (!canvas) gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(renderer);
  } catch {
    return '';
  }
}
