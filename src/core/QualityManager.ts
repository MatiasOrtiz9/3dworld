import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import type { RenderQuality } from './RenderPipeline';

export type QualityTier = 'vr' | 'balanced' | 'high';

export interface QualityProfile {
  label: string;
  /** Escala de resolución: >1 renderiza por debajo de la nativa. */
  hardwareScaling: number;
  shadows: boolean;
  shadowResolution: number;
  /** Multiplicador de densidad de vegetación. */
  greenDensity: number;
  /** Manzanas por lado. */
  gridSize: number;
  /** Distancia de recorte. */
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
  // Perfil pensado para Quest 2/3: el objetivo son 72 fps sostenidos.
  // Sin sombras dinámicas (es el gasto más grande) y ciudad más compacta.
  vr: {
    label: 'VR',
    hardwareScaling: 1.15,
    shadows: false,
    shadowResolution: 0,
    greenDensity: 0.55,
    gridSize: 7,
    maxZ: 700,
    highDetailFoliage: false,
    highDetailStreet: false,
    crowdSize: 90,
    // Bloom y antialiasing SÍ, oclusión ambiental no.
    //
    // La ablación en GPU real midió que bloom + FXAA cuestan 0,11 ms por
    // cuadro, contra 2,18-7,28 ms de la oclusión ambiental. Apagar todo el
    // post-proceso en VR —como estaba— tiraba una mejora visual notable para
    // ahorrar una décima de milisegundo. La oclusión sí se queda afuera.
    post: 'lite',
  },
  balanced: {
    label: 'Media',
    hardwareScaling: 1,
    shadows: true,
    shadowResolution: 1024,
    greenDensity: 0.85,
    gridSize: 9,
    maxZ: 1200,
    highDetailFoliage: true,
    highDetailStreet: true,
    crowdSize: 170,
    post: 'balanced',
  },
  high: {
    label: 'Alta',
    hardwareScaling: 1,
    shadows: true,
    shadowResolution: 2048,
    greenDensity: 1.15,
    gridSize: 9,
    maxZ: 2000,
    highDetailFoliage: true,
    highDetailStreet: true,
    crowdSize: 230,
    post: 'high',
  },
};

export const TIER_ORDER: QualityTier[] = ['vr', 'balanced', 'high'];

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

  /** Aplica los ajustes que no requieren reconstruir la ciudad. */
  applyRuntime(): void {
    const p = this.profile;
    this.engine.setHardwareScalingLevel(p.hardwareScaling);
    for (const camera of this.scene.cameras) camera.maxZ = p.maxZ;
  }

  set(tier: QualityTier): void {
    this.tier = tier;
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
  static suggestInitial(): QualityTier {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const mobile = /Android|iPhone|iPad|Quest|Pico/i.test(navigator.userAgent);
    if (mobile) return 'vr';
    if (cores <= 4) return 'balanced';
    return 'high';
  }
}
