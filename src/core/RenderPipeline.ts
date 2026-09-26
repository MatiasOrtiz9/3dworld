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

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  apply(quality: RenderQuality): void {
    this.dispose();
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

    // Viñeta y aberración: muy sutiles. Son "lenguaje de cámara": el ojo los
    // asocia a una foto, no a un render. Pasados de rosca quedan de videojuego
    // barato, así que van al mínimo perceptible.
    pipe.imageProcessing.vignetteEnabled = true;
    pipe.imageProcessing.vignetteWeight = 1.6;
    pipe.imageProcessing.vignetteStretch = 0.4;
    pipe.imageProcessingEnabled = true;

    if (high) {
      pipe.chromaticAberrationEnabled = true;
      pipe.chromaticAberration.aberrationAmount = 4;
      pipe.grainEnabled = true;
      pipe.grain.intensity = 4;
      pipe.grain.animated = true;
    }

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
    const ssao = new SSAO2RenderingPipeline(
      'ssao',
      this.scene,
      { ssaoRatio: high ? 0.6 : 0.5, blurRatio: 1 },
      [this.camera],
      true,
    );
    ssao.samples = high ? 16 : 12;
    ssao.radius = 2.6; // metros: la escala de un alféizar, un cordón, un tronco
    ssao.totalStrength = 1.15;
    ssao.base = 0.12; // cuánta luz queda igual sin ocluir
    // Blur barato en los dos niveles: el caro no justifica su precio.
    ssao.expensiveBlur = false;
    ssao.maxZ = 220; // más lejos no se percibe y cuesta igual
    this.ssao = ssao;
  }

  dispose(): void {
    this.ssao?.dispose();
    this.ssao = null;
    this.pipeline?.dispose();
    this.pipeline = null;
  }
}
