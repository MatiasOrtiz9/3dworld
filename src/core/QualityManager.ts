import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { RenderQuality } from './RenderPipeline';
import type { ShadowFilter, ShadowMode } from '../world/Environment';

export type QualityTier = 'low' | 'vr' | 'balanced' | 'high';

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
   * unos `extent + 220` m (ver TimeOfDay.fogReach): más allá no hay nada que
   * ver, y un plano lejano corto mejora la precisión de profundidad. El cielo
   * no depende de él (se dibuja en el fondo del búfer, ver Sky).
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
    crowdSize: 90,
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

/** Perfiles de escritorio. VR se activa desde el visor, no desde el ciclo. */
export const TIER_ORDER: QualityTier[] = ['low', 'balanced', 'high'];

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
    this.sampleElapsedMs += Math.min(1000, Math.max(0, deltaMs));
    this.sampleFrames++;
    if (this.sampleElapsedMs < 2500) return null;

    const fps = (this.sampleFrames * 1000) / this.sampleElapsedMs;
    const target = inVr ? 72 : 60;
    const previous = this.adaptive;
    this.sampleElapsedMs = 0;
    this.sampleFrames = 0;

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
      if (fps >= target + 10 && this.adaptive > 0) {
        this.healthyMs += 2500;
        if (this.healthyMs >= 8000) {
          this.adaptive--;
          this.healthyMs = 0;
        }
      } else {
        this.healthyMs = 0;
      }
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
    const textureScale = [1, 0.75, 0.5, 0.25][this.adaptive];
    this.engine.setHardwareScalingLevel(p.hardwareScaling * resolutionScale);
    for (const camera of this.scene.cameras) {
      // La cámara del visor fija su propio plano lejano (ver vr/XRSetup) y
      // sus cámaras de ojo heredan el de ella; allí la palanca adaptativa es
      // la foveación. Pisarlo recortaba el horizonte dentro del visor.
      if (isXrCamera(camera)) continue;
      camera.maxZ = p.maxZ * distanceScale;
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
    this.sampleElapsedMs = 0;
    this.sampleFrames = 0;
    this.slowWindows = 0;
    this.healthyMs = 0;
    this.applyRuntime();
  }

  /** Siguiente nivel, en ciclo. Para el botón del HUD. */
  cycle(): QualityTier {
    const i = TIER_ORDER.indexOf(this.tier);
    this.set(TIER_ORDER[(i + 1) % TIER_ORDER.length]);
    return this.tier;
  }

  /**
   * Detecta un dispositivo probablemente limitado para elegir el nivel inicial.
   * Es heurístico a propósito: mejor arrancar conservador y que el usuario
   * suba, que arrancar en Alta y que la primera impresión sea a 20 fps.
   */
  static suggestInitial(canvas?: HTMLCanvasElement): QualityTier {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const mobile = /Android|iPhone|iPad|Quest|Pico/i.test(navigator.userAgent);
    if (mobile) return 'vr';
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
