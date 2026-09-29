import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';

export type RenderQuality = 'off' | 'lite' | 'balanced' | 'high';

/**
 * Pipeline de post-procesado.
 *
 * Esta es la capa que más acerca el resultado a "render" y menos cuesta en
 * tiempo de carga, porque no descarga absolutamente nada: son shaders sobre la
 * imagen ya renderizada.
 *
 * Dos efectos hacen casi todo el trabajo:
 *
 *  - **SSAO (oclusión ambiental en espacio de pantalla).** Es EL efecto que
 *    hace que la arquitectura se vea real. Oscurece los rincones donde la luz
 *    ambiental no llega: el encuentro de un árbol con el piso, el hueco bajo un
 *    balcón, la esquina interior de un patio. Sin él, todo parece flotar sobre
 *    el suelo en vez de apoyarse; con él, los objetos pesan.
 *
 *  - **Bloom.** El sol y las superficies muy iluminadas derraman luz sobre lo
 *    que las rodea, como en una cámara real. Da sensación de aire y de
 *    intensidad lumínica que el rango dinámico de un monitor no puede mostrar.
 *
 * En VR ambos se apagan: son dos pasadas de pantalla completa POR OJO, y el
 * presupuesto de 11 ms para dos ojos no las tolera.
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
    if (quality === 'off') return;

    const high = quality === 'high';
    // 'lite': bloom y antialiasing, sin oclusión ambiental.
    //
    // Existe por una medición: con GPU real, el post-proceso alto cuesta
    // 7,6 ms por cuadro y el medio 2,6 ms, contra 2,2 ms de TODA la geometría
    // de la ciudad. La oclusión ambiental es la parte cara; el bloom es barato.
    // Este nivel conserva lo barato y tira lo caro, que es lo que hace falta
    // cuando el presupuesto de cuadro hay que repartirlo entre dos ojos.
    const lite = quality === 'lite';

    // --- imagen general ---
    const pipe = new DefaultRenderingPipeline('main', true, this.scene, [this.camera]);

    pipe.fxaaEnabled = true;

    pipe.bloomEnabled = true;
    pipe.bloomThreshold = 0.82; // sólo los altos: no queremos niebla lechosa
    pipe.bloomWeight = high ? 0.32 : 0.22;
    pipe.bloomKernel = high ? 48 : 32;
    pipe.bloomScale = 0.5;

    // Un toque de nitidez compensa el suavizado del FXAA y del SSAO.
    pipe.sharpenEnabled = true;
    pipe.sharpen.edgeAmount = 0.22;
    pipe.sharpen.colorAmount = 1;

    // Una viñeta apenas perceptible concentra la mirada sin convertir el
    // recorrido en una cámara de acción. La aberración cromática y el grano se
    // quitaron: en fachadas claras generaban bordes de color y ruido que hacían
    // que el mundo se viera menos nítido, no más cinematográfico.
    pipe.imageProcessing.vignetteEnabled = true;
    pipe.imageProcessing.vignetteWeight = 0.75;
    pipe.imageProcessing.vignetteStretch = 0.4;
    pipe.imageProcessingEnabled = true;

    this.pipeline = pipe;
    if (lite) return;

    // --- oclusión ambiental ---
    //
    // Los parámetros se ajustaron con mediciones en GPU real, no a ojo. La
    // configuración original de 'high' (ratio 0,75 · 24 muestras · blur caro)
    // costaba **7,28 ms por cuadro**, contra 2,18 ms de la media y 2,52 ms de
    // TODA la geometría de la ciudad junta. Pagaba 5 ms extra por una
    // diferencia visual que hay que buscar con lupa.
    //
    // El ratio es la palanca dominante: la oclusión se calcula a esa fracción
    // de la resolución de pantalla, así que su coste crece con el cuadrado.
    this.createSsao(high);
  }

  /** Reduce efectos costosos sólo al cambiar de nivel adaptativo. */
  setAdaptiveLevel(level: number): void {
    this.adaptiveLevel = Math.max(0, Math.min(3, level));
    if (this.quality === 'off' || !this.pipeline) return;

    const high = this.quality === 'high';
    const lite = this.quality === 'lite';
    if (!lite && this.adaptiveLevel >= 3 && this.ssao) {
      this.ssao.dispose();
      this.ssao = null;
    } else if (!lite && this.adaptiveLevel < 3 && !this.ssao) {
      this.createSsao(high);
    }

    this.pipeline.bloomEnabled = this.adaptiveLevel < 2;
    this.pipeline.sharpenEnabled = this.adaptiveLevel < 2;
    this.pipeline.imageProcessing.vignetteEnabled = this.adaptiveLevel === 0;
    this.pipeline.bloomWeight = this.adaptiveLevel === 0 ? (high ? 0.32 : 0.22) : 0.12;
    this.pipeline.bloomKernel = this.adaptiveLevel === 0 ? (high ? 48 : 32) : 16;
    if (this.ssao) {
      this.ssao.samples = this.adaptiveLevel === 0 ? (high ? 16 : 12) : 8;
      this.ssao.bypassBlur = this.adaptiveLevel >= 2;
      this.ssao.maxZ = this.adaptiveLevel === 0 ? 220 : 120;
    }
  }

  private createSsao(high: boolean): void {
    const ssao = new SSAO2RenderingPipeline(
      'ssao',
      this.scene,
      { ssaoRatio: high ? 0.6 : 0.5, blurRatio: 1 },
      [this.camera],
      true,
    );
    ssao.samples = high ? 16 : 12;
    ssao.radius = 2.6;
    ssao.totalStrength = 1.15;
    ssao.base = 0.12;
    ssao.expensiveBlur = false;
    ssao.maxZ = 220;
    this.ssao = ssao;
  }

  dispose(): void {
    this.ssao?.dispose();
    this.ssao = null;
    this.pipeline?.dispose();
    this.pipeline = null;
  }
}
