import type { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { SkyMaterial } from '@babylonjs/materials/sky/skyMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
// El CSM usa el depth renderer para ajustar las cascadas (autoCalcDepthBounds).
// Sin este import de efecto secundario, Babylon lanza en tiempo de ejecución.
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';

export type TimeOfDay = 'morning' | 'noon' | 'goldenHour' | 'dusk';

export const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: 'Mañana',
  noon: 'Mediodía',
  goldenHour: 'Hora dorada',
  dusk: 'Atardecer',
};

export const TIME_ORDER: TimeOfDay[] = ['morning', 'noon', 'goldenHour', 'dusk'];

/**
 * Hora del reloj a la que corresponde cada preajuste.
 *
 * Sirven de fotogramas clave del ciclo continuo: entre dos horas consecutivas
 * se interpola todo —elevación y azimut del sol, color e intensidad de la luz,
 * turbidez del cielo, niebla— así que el deslizador recorre un día entero sin
 * saltos en vez de conmutar entre cuatro estados.
 */
const KEYFRAMES: Array<{ hour: number; time: TimeOfDay }> = [
  { hour: 8, time: 'morning' },
  { hour: 13, time: 'noon' },
  { hour: 18.5, time: 'goldenHour' },
  { hour: 20.5, time: 'dusk' },
];

export const DAY_START = 8;
export const DAY_END = 20.5;

/** Nombre legible de una hora decimal: 13.5 -> "13:30". */
export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface TimePreset {
  /** Inclinación solar: 0 = horizonte, 1 = cenit. */
  elevation: number;
  /** Azimut en radianes. */
  azimuth: number;
  sunColor: Color3;
  sunIntensity: number;
  skyColor: Color3;
  groundColor: Color3;
  ambientIntensity: number;
  /** Parámetros del cielo de Rayleigh/Mie. */
  turbidity: number;
  luminance: number;
  fogDensity: number;
  fogColor: Color3;
}

const PRESETS: Record<TimeOfDay, TimePreset> = {
  morning: {
    elevation: 0.32,
    azimuth: 2.5,
    sunColor: new Color3(1, 0.9, 0.74),
    sunIntensity: 2.1,
    skyColor: new Color3(0.44, 0.58, 0.72),
    groundColor: new Color3(0.2, 0.2, 0.17),
    ambientIntensity: 0.16,
    turbidity: 6,
    luminance: 1,
    fogDensity: 0.0011,
    fogColor: new Color3(0.72, 0.82, 0.88),
  },
  noon: {
    elevation: 0.78,
    azimuth: 1.4,
    sunColor: new Color3(1, 0.97, 0.9),
    sunIntensity: 2.4,
    skyColor: new Color3(0.42, 0.56, 0.74),
    groundColor: new Color3(0.22, 0.23, 0.19),
    ambientIntensity: 0.15,
    turbidity: 2.6,
    luminance: 1,
    fogDensity: 0.0007,
    fogColor: new Color3(0.74, 0.84, 0.92),
  },
  goldenHour: {
    elevation: 0.14,
    azimuth: 5.4,
    sunColor: new Color3(1, 0.72, 0.42),
    sunIntensity: 2.3,
    skyColor: new Color3(0.5, 0.45, 0.44),
    groundColor: new Color3(0.2, 0.15, 0.12),
    ambientIntensity: 0.14,
    turbidity: 9,
    luminance: 1.05,
    fogDensity: 0.0017,
    fogColor: new Color3(0.9, 0.73, 0.55),
  },
  dusk: {
    elevation: 0.035,
    azimuth: 5.9,
    sunColor: new Color3(1, 0.52, 0.34),
    sunIntensity: 1.4,
    skyColor: new Color3(0.26, 0.3, 0.46),
    groundColor: new Color3(0.1, 0.1, 0.15),
    ambientIntensity: 0.13,
    turbidity: 14,
    luminance: 1.15,
    fogDensity: 0.0026,
    fogColor: new Color3(0.55, 0.47, 0.56),
  },
};

/** Interpola dos preajustes. `t` va de 0 (a) a 1 (b). */
function blendPresets(a: TimePreset, b: TimePreset, t: number): TimePreset {
  const n = (x: number, y: number) => x + (y - x) * t;
  const c = (x: Color3, y: Color3) => new Color3(n(x.r, y.r), n(x.g, y.g), n(x.b, y.b));
  return {
    elevation: n(a.elevation, b.elevation),
    azimuth: n(a.azimuth, b.azimuth),
    sunColor: c(a.sunColor, b.sunColor),
    sunIntensity: n(a.sunIntensity, b.sunIntensity),
    skyColor: c(a.skyColor, b.skyColor),
    groundColor: c(a.groundColor, b.groundColor),
    ambientIntensity: n(a.ambientIntensity, b.ambientIntensity),
    turbidity: n(a.turbidity, b.turbidity),
    luminance: n(a.luminance, b.luminance),
    fogDensity: n(a.fogDensity, b.fogDensity),
    fogColor: c(a.fogColor, b.fogColor),
  };
}

/**
 * Cielo, sol y atmósfera.
 *
 * Usa el SkyMaterial de Babylon (dispersión de Rayleigh y Mie), que da un
 * cielo físicamente plausible a costo casi nulo: es un shader procedural sobre
 * un cubo, sin texturas ni HDRI que descargar.
 *
 * La niebla es deliberada y no decorativa: en VR, una atmósfera con densidad
 * da profundidad y escala. Sin ella, una ciudad de primitivas se ve plana y
 * como de cartón, sin importar cuánta geometría tenga.
 */
export class Environment {
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  readonly skyBox: Mesh;
  private readonly skyMaterial: SkyMaterial;
  private shadows: CascadedShadowGenerator | null = null;
  private probe: ReflectionProbe | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly worldExtent: number,
  ) {
    this.skyMaterial = new SkyMaterial('sky', scene);
    this.skyMaterial.backFaceCulling = false;
    this.skyMaterial.useSunPosition = true;

    this.skyBox = CreateBox('skyBox', { size: worldExtent * 8 }, scene);
    this.skyBox.material = this.skyMaterial;
    this.skyBox.infiniteDistance = true;
    this.skyBox.isPickable = false;

    this.ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
    this.sun.autoUpdateExtends = false;

    scene.fogMode = 2; // FOGMODE_EXP2
    scene.clearColor = new Color4(0.75, 0.85, 0.9, 1);

    // Mapeo tonal ACES.
    //
    // Es el ajuste que más acerca el resultado a "producto terminado". PBR
    // trabaja en rango dinámico alto: sin mapeo tonal, todo lo que supera 1.0
    // se recorta a blanco puro, y una ciudad clara bajo sol de mediodía queda
    // como una maqueta de papel sin detalle. ACES comprime los altos siguiendo
    // una curva de cine, así que el hormigón conserva textura y las sombras no
    // se tapan.
    //
    // En Babylon esto se compila DENTRO del shader del material, no es un
    // post-proceso: en VR no cuesta un segundo pase de pantalla completa.
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.18;
    ip.contrast = 1.35;

    this.apply('noon');
  }

  /**
   * Hora continua del día, entre DAY_START y DAY_END.
   *
   * Interpola linealmente entre los preajustes vecinos. Es la versión continua
   * de `apply()`, que sigue existiendo para fijar una hora concreta.
   */
  applyHour(hour: number): void {
    const h = Math.min(DAY_END, Math.max(DAY_START, hour));

    let a = KEYFRAMES[0];
    let b = KEYFRAMES[KEYFRAMES.length - 1];
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (h >= KEYFRAMES[i].hour && h <= KEYFRAMES[i + 1].hour) {
        a = KEYFRAMES[i];
        b = KEYFRAMES[i + 1];
        break;
      }
    }
    const span = b.hour - a.hour;
    const t = span > 0 ? (h - a.hour) / span : 0;
    this.applyPreset(blendPresets(PRESETS[a.time], PRESETS[b.time], t));
  }

  /** Fija una hora concreta a partir de un preajuste con nombre. */
  apply(time: TimeOfDay): void {
    this.applyPreset(PRESETS[time]);
  }

  private applyPreset(p: TimePreset): void {

    // Posición del sol en coordenadas esféricas.
    const el = (p.elevation * Math.PI) / 2;
    const sunDir = new Vector3(
      Math.cos(el) * Math.cos(p.azimuth),
      Math.sin(el),
      Math.cos(el) * Math.sin(p.azimuth),
    );

    this.skyMaterial.sunPosition = sunDir.scale(100);
    this.skyMaterial.turbidity = p.turbidity;
    this.skyMaterial.luminance = p.luminance;
    this.skyMaterial.rayleigh = 2;
    this.skyMaterial.mieCoefficient = 0.005;
    this.skyMaterial.mieDirectionalG = 0.82;

    // La luz direccional apunta DESDE el sol hacia la escena.
    this.sun.direction = sunDir.scale(-1).normalize();
    this.sun.diffuse = p.sunColor;
    this.sun.specular = p.sunColor.scale(0.35);
    this.sun.intensity = p.sunIntensity;
    this.sun.position = sunDir.scale(this.worldExtent * 1.6);

    this.ambient.diffuse = p.skyColor;
    this.ambient.groundColor = p.groundColor;
    this.ambient.intensity = p.ambientIntensity;

    this.scene.fogDensity = p.fogDensity;
    this.scene.fogColor = p.fogColor;
    this.scene.clearColor = new Color4(p.fogColor.r, p.fogColor.g, p.fogColor.b, 1);

    if (this.shadows) this.refreshShadowBounds();
    // Al cambiar la hora cambia el cielo, y con el la luz ambiental: hay que
    // volver a capturar la sonda una vez.
    this.probe?.cubeTexture.resetRefreshCounter();
  }

  /**
   * Captura el entorno para la iluminación basada en imagen (IBL).
   *
   * Sin `scene.environmentTexture`, todo material PBR con algo de metalicidad
   * se ve negro y los materiales rugosos pierden el rebote de luz del cielo.
   * En vez de descargar un HDRI —que además habría que licenciar y versionar—
   * renderizamos UNA sola vez una sonda de reflexión desde el centro de la
   * ciudad. Cuesta un cubemap de 128 px al cargar y cero por cuadro.
   *
   * Hay que llamarla cuando la ciudad ya está construida.
   */
  captureEnvironment(): void {
    this.probe?.dispose();
    const probe = new ReflectionProbe('skyEnv', 128, this.scene);
    probe.position.set(0, 30, 0);

    // Sólo el cielo entra en la sonda, por dos razones:
    //
    //  1. Si se incluye la ciudad, se forma un bucle de realimentación: los
    //     materiales PBR muestrean la textura de entorno mientras esa misma
    //     textura se está renderizando desde ellos. WebGL lo rechaza
    //     ("Feedback loop formed between Framebuffer and active Texture").
    //  2. El cielo es, de todos modos, el 90 % de la luz ambiental al aire
    //     libre. El rebote de los edificios aporta poco y cuesta mucho.
    //
    // El SkyMaterial no muestrea environmentTexture, así que no hay ciclo.
    probe.renderList = [this.skyBox];
    probe.refreshRate = 0; // REFRESHRATE_RENDER_ONCE: el cielo no cambia solo
    probe.cubeTexture.coordinatesMode = Texture.CUBIC_MODE;
    probe.cubeTexture.gammaSpace = false;

    this.scene.environmentTexture = probe.cubeTexture;
    // Bajo a propósito. El IBL se SUMA a la luz hemisférica, así que con 0,85
    // la ciudad quedaba sobreexpuesta en blanco y las sombras desaparecían.
    // La hemisférica baja en paralelo (ver presets): entre las dos no puede
    // haber más luz ambiental que antes, sólo mejor repartida.
    this.scene.environmentIntensity = 0.3;
    this.probe = probe;
  }

  /**
   * Activa sombras de sol con mapas en cascada (CSM).
   *
   * Un único mapa de sombra para una ciudad de ~400 m da ~0,2 m por pixel: las
   * sombras salen tan borrosas que desaparecen. El CSM parte el rango de vista
   * en varias cascadas, así lo cercano recibe casi toda la resolución y lo
   * lejano se resuelve con lo que sobra. Es la diferencia entre "no hay
   * sombras" y una ciudad con volumen.
   */
  enableShadows(casters: Mesh[], resolution: number): void {
    this.disableShadows();
    const gen = new CascadedShadowGenerator(resolution, this.sun);
    gen.numCascades = 4;
    gen.lambda = 0.85; // reparto logarítmico: privilegia el detalle cercano
    gen.stabilizeCascades = true; // evita el hervor de bordes al moverse
    gen.shadowMaxZ = 420; // más allá, la niebla ya se come la sombra
    gen.depthClamp = true;
    gen.autoCalcDepthBounds = true;
    gen.bias = 0.008;
    gen.normalBias = 0.015;
    gen.darkness = 0.12;
    gen.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
    gen.usePercentageCloserFiltering = true;
    gen.penumbraDarkness = 0.7;

    for (const mesh of casters) {
      gen.addShadowCaster(mesh, false);
      mesh.receiveShadows = true;
    }
    this.shadows = gen;
    this.refreshShadowBounds();
  }

  disableShadows(): void {
    if (!this.shadows) return;
    this.shadows.dispose();
    this.shadows = null;
  }

  private refreshShadowBounds(): void {
    // El CSM calcula sus propias cajas por cascada a partir del frustum de la
    // cámara, así que acá sólo fijamos el rango útil.
    this.sun.shadowMinZ = 0.5;
    this.sun.shadowMaxZ = this.worldExtent * 2.5;
  }

  dispose(): void {
    this.probe?.dispose();
    this.probe = null;
    this.scene.environmentTexture = null;
    this.disableShadows();
    this.skyBox.dispose();
    this.skyMaterial.dispose();
    this.sun.dispose();
    this.ambient.dispose();
  }
}
