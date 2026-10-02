import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';

export type RenderQuality = 'off' | 'lite' | 'balanced' | 'high';

/** Parámetros de cada nivel; exportados para poder probarlos sin GPU. */
export interface PostSettings {
  bloomThreshold: number;
  bloomWeight: number;
  bloomKernel: number;
  /** Multimuestreo del búfer HDR (bordes de rejas y barandas). 1 = sin MSAA. */
  msaa: number;
  fxaa: boolean;
  sharpen: number;
  vignette: number;
  ssao: null | {
    ratio: number;
    samples: number;
    radius: number;
    strength: number;
    base: number;
    maxZ: number;
    /** Filtro bilateral configurable (bordes limpios) en vez del heredado. */
    bilateral: boolean;
  };
}

/**
 * Ajustes por nivel.
 *
 * El "velo lechoso" de los interiores tenía tres causas, y las tres están
 * corregidas acá o en Environment:
 *
 *  1. **SSAO con radio de 2,6 m** en ambientes de 3 m de alto: cada punto de
 *     un muro "veía" el muro de enfrente y el cielorraso como oclusores, y con
 *     12-16 muestras y el desenfoque heredado eso se convertía en manchas
 *     grises grandes y blandas sobre toda superficie lisa. Ahora el SSAO es
 *     sólo de CONTACTO (radio ~0,55 m): el pie de sillas y mesas, zócalos,
 *     marcos. La oclusión a escala de ambiente —rincones, el fondo de un
 *     aula, bajo las mesas y escaleras— la da el mapa de luz natural de la
 *     escuela (Environment.bakeSchoolDaylight), que también ve el visor. Con
 *     el radio de 1 m y fuerza 1,4 el efecto no se veía (se aplica después
 *     del mapeo tonal y la base 0,1 lo aclaraba): sin base y con fuerza 2,2
 *     las patas de los muebles por fin apoyan.
 *  2. **Bloom con umbral 0,82** sobre la imagen HDR lineal: los muros
 *     blancos con luz rebotada rondan ese valor, así que el resplandor salía
 *     de todo el interior y lo cubría con una neblina. Umbral 1,6 (en
 *     luminancia ya expuesta): brillan las luminarias, el sol, las nubes
 *     doradas y las ventanas encendidas (Materials.GLOW_GAIN), no las paredes
 *     ni la vereda al sol.
 *  3. **IBL con colores de pantalla** en el visor (ver Sky.ts): la luz
 *     ambiente salía el doble de fuerte.
 */
export const POST_SETTINGS: Record<Exclude<RenderQuality, 'off'>, PostSettings> = {
  // Bloom y antialiasing, sin oclusión ambiental: lo barato se queda, lo caro
  // se va (medido: bloom + FXAA 0,11 ms; SSAO 2,2-7,3 ms).
  lite: {
    bloomThreshold: 1.6,
    bloomWeight: 0.12,
    bloomKernel: 32,
    msaa: 1,
    fxaa: true,
    sharpen: 0.15,
    vignette: 0.8,
    ssao: null,
  },
  balanced: {
    bloomThreshold: 1.6,
    bloomWeight: 0.14,
    bloomKernel: 48,
    msaa: 1,
    fxaa: true,
    sharpen: 0.18,
    vignette: 0.8,
    // Filtro bilateral también acá: el heredado dejaba manchas grises
    // moteadas a lo largo de los encuentros de muro y cielorraso.
    ssao: { ratio: 0.5, samples: 12, radius: 0.6, strength: 1.8, base: 0.04, maxZ: 120, bilateral: true },
  },
  high: {
    bloomThreshold: 1.6,
    bloomWeight: 0.16,
    bloomKernel: 64,
    // MSAA en el búfer HDR: las rejas, mallas y barandas de la escuela son
    // líneas de pocos píxeles que el FXAA sólo difumina; con 4 muestras se
    // leen continuas y quietas al moverse.
    msaa: 4,
    fxaa: false,
    sharpen: 0.15,
    vignette: 0.8,
    ssao: { ratio: 0.5, samples: 16, radius: 0.55, strength: 2.2, base: 0, maxZ: 140, bilateral: true },
  },
};

/**
 * Pipeline de post-procesado.
 *
 * Dos efectos hacen casi todo el trabajo:
 *
 *  - **SSAO (oclusión ambiental en espacio de pantalla).** Oscurece los
 *    rincones donde la luz ambiental no llega. Sin él, todo parece flotar
 *    sobre el suelo en vez de apoyarse.
 *  - **Bloom.** Las fuentes de luz derraman luz sobre lo que las rodea, como
 *    en una cámara real: el sol, las luminarias, las ventanas encendidas.
 *
 * En VR ambos se apagan: son pasadas de pantalla completa POR OJO, y el
 * post-proceso además desviaba el color dentro del visor (ver QualityManager).
 */
export class RenderPipeline {
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private quality: RenderQuality = 'off';
  private adaptiveLevel = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  apply(quality: RenderQuality): void {
    this.dispose();
    this.quality = quality;
    this.adaptiveLevel = 0;
    if (quality === 'off') {
      // La viñeta vive en la configuración de imagen de la ESCENA, que sin
      // post-proceso se compila dentro de cada material. Si quedaba prendida
      // de un perfil anterior, el visor la dibujaba centrada en el búfer de
      // los dos ojos: un oscurecimiento corrido en cada ojo.
      this.scene.imageProcessingConfiguration.vignetteEnabled = false;
      return;
    }

    const s = POST_SETTINGS[quality];
    const pipe = new DefaultRenderingPipeline('main', true, this.scene, [this.camera]);
    pipe.samples = s.msaa;
    pipe.fxaaEnabled = s.fxaa;

    pipe.bloomEnabled = true;
    pipe.bloomThreshold = s.bloomThreshold;
    pipe.bloomWeight = s.bloomWeight;
    pipe.bloomKernel = s.bloomKernel;
    pipe.bloomScale = 0.5;

    // Un toque de nitidez compensa el suavizado del FXAA y del SSAO. Poco:
    // más genera halos claros en los bordes contra el cielo.
    pipe.sharpenEnabled = true;
    pipe.sharpen.edgeAmount = s.sharpen;
    pipe.sharpen.colorAmount = 1;

    // Viñeta apenas perceptible: concentra la mirada sin convertir el
    // recorrido en una cámara de acción. Sin aberración ni grano: en
    // fachadas claras generaban bordes de color y ruido.
    pipe.imageProcessing.vignetteEnabled = true;
    pipe.imageProcessing.vignetteWeight = s.vignette;
    pipe.imageProcessing.vignetteStretch = 0.5;
    pipe.imageProcessingEnabled = true;

    this.pipeline = pipe;
    if (s.ssao) this.createSsao(s.ssao);
  }

  /** Reduce efectos costosos sólo al cambiar de nivel adaptativo. */
  setAdaptiveLevel(level: number): void {
    this.adaptiveLevel = Math.max(0, Math.min(3, level));
    if (this.quality === 'off' || !this.pipeline) return;

    const s = POST_SETTINGS[this.quality];
    if (s.ssao && this.adaptiveLevel >= 3 && this.ssao) {
      this.ssao.dispose();
      this.ssao = null;
    } else if (s.ssao && this.adaptiveLevel < 3 && !this.ssao) {
      this.createSsao(s.ssao);
    }

    const full = this.adaptiveLevel === 0;
    this.pipeline.bloomEnabled = this.adaptiveLevel < 2;
    this.pipeline.sharpenEnabled = this.adaptiveLevel < 2;
    this.pipeline.imageProcessing.vignetteEnabled = full;
    this.pipeline.bloomWeight = full ? s.bloomWeight : s.bloomWeight * 0.75;
    this.pipeline.bloomKernel = full ? s.bloomKernel : 24;
    // El MSAA es lo primero que se va: cuadruplica el ancho de banda del
    // búfer HDR, y el FXAA cubre casi lo mismo por una fracción.
    this.pipeline.samples = full ? s.msaa : 1;
    this.pipeline.fxaaEnabled = s.fxaa || !full;
    if (this.ssao && s.ssao) {
      this.ssao.samples = full ? s.ssao.samples : 8;
      this.ssao.bypassBlur = this.adaptiveLevel >= 2;
      // Sin desenfoque el ruido de 8 muestras se ve como grano: más suave.
      this.ssao.totalStrength = this.adaptiveLevel >= 2 ? s.ssao.strength * 0.6 : s.ssao.strength;
      this.ssao.maxZ = full ? s.ssao.maxZ : 80;
    }
  }

  private createSsao(s: NonNullable<PostSettings['ssao']>): void {
    const ssao = new SSAO2RenderingPipeline(
      'ssao',
      this.scene,
      { ssaoRatio: s.ratio, blurRatio: s.bilateral ? 0.5 : 1 },
      [this.camera],
      true,
    );
    ssao.samples = s.samples;
    ssao.radius = s.radius;
    ssao.totalStrength = s.strength;
    ssao.base = s.base;
    ssao.maxZ = s.maxZ;
    // Un poco más de tolerancia de auto-oclusión: en losas y muros lisos el
    // valor por omisión dejaba un moteado fino.
    ssao.epsilon = 0.03;
    ssao.expensiveBlur = s.bilateral;
    if (s.bilateral) {
      // A media resolución el filtro bilateral alcanza con pocas muestras;
      // la tolerancia evita que la sombra de un rincón se corra al muro de
      // enfrente.
      ssao.bilateralSamples = 12;
      // Tolerancia baja: con 0,4 la oclusión de la pata de una silla se
      // corría al piso de atrás y dejaba un halo gris alrededor de la gente.
      ssao.bilateralSoften = 0.1;
      ssao.bilateralTolerance = 0.12;
    }
    this.ssao = ssao;
  }

  dispose(): void {
    this.ssao?.dispose();
    this.ssao = null;
    this.pipeline?.dispose();
    this.pipeline = null;
  }
}
