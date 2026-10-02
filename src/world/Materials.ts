import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Nullable } from '@babylonjs/core/types';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { PALETTE } from './Palette';
import { Textures, hasRelief, type SurfaceKind } from './Textures';
import { Rng } from '../utils/rng';
import { WindPlugin } from './WindPlugin';

/**
 * Relieve de superficie según el perfil de calidad (lo elige City).
 *
 * El mapa de normales y el de detalle no suman draw calls ni triángulos: son
 * un muestreo de textura más por píxel (y el marco tangente por derivadas).
 * En el visor, que paga cada píxel dos veces, se guardan para donde el
 * relieve es grande o se mira de cerca y en ángulo: pisos, bloque, ladrillo,
 * chapa y cortinas. La piel del látex de las paredes y la capa de detalle
 * quedan para escritorio.
 */
export interface SurfaceQuality {
  /** 'all': todo material métrico con relieve; 'lite': sólo `LITE_RELIEF`; 'none'. */
  normals: 'all' | 'lite' | 'none';
  /** Capa de detalle anti-repetición (tono, rugosidad y ondulación). */
  detail: boolean;
}

/** Opciones de superficie de un material. */
export interface SurfaceOpts {
  /**
   * UV en metros desde la posición en el mundo (ver `MetricUVPlugin`): la
   * textura mantiene su tamaño real en cualquier pieza. Activa también el
   * relieve (normales) y la capa de detalle, según la calidad. Es lo normal:
   * toda textura salvo las de `FACE_ALIGNED` lo recibe si no se pide
   * `false` explícitamente.
   */
  metric?: boolean;
  /** Capa de detalle: 'floor' (con marcas de uso) o 'wall'. */
  detail?: 'floor' | 'wall';
}

/**
 * Texturas atadas a la cara de la pieza, que NO pasan a metros: la retícula
 * de celdas de un panel solar tiene que coincidir con el panel. Todas las
 * demás se aplican siempre en metros (ver MetricUVPlugin), también en la
 * ciudad: con la UV 0..1 de una caja de 250 m, la loseta se estiraba en
 * tablones a lo largo de la calle y el revoque de las fachadas en franjas
 * horizontales; en una caja de 2 m, la misma textura salía diminuta.
 */
const FACE_ALIGNED = new Set<SurfaceKind>(['solar']);

/** Tipos cuyo relieve se conserva en el perfil liviano (VR). */
const LITE_RELIEF = new Set<SurfaceKind>([
  'granite',
  'checker',
  'ceramic',
  'pavement',
  'parquet',
  'rubber',
  'block',
  'brick',
  'corrugated',
  'fabric',
]);

/**
 * Biblioteca central de materiales.
 *
 * Toda la ciudad comparte un puñado de materiales. Cada material distinto rompe
 * el batching y suma draw calls, así que se cachean agresivamente.
 *
 * IMPORTANTE sobre freeze(): congelar un material impide que Babylon recompile
 * su shader. Si se congela al crearlo y DESPUÉS se agrega el generador de
 * sombras, los defines de sombra nunca entran y la ciudad queda sin una sola
 * sombra proyectada. Por eso el congelado se difiere a freezeAll().
 */
export class Materials {
  private readonly cache = new Map<string, Material>();
  /** Plugins de viento instalados, para avanzarles el reloj cada cuadro. */
  private readonly winds: WindPlugin[] = [];
  private readonly textures: Textures;
  private readonly rng = new Rng(0x5eed);

  constructor(
    private readonly scene: Scene,
    private readonly quality: SurfaceQuality = { normals: 'all', detail: true },
  ) {
    this.textures = new Textures(scene);
  }

  /** Tiempo de generación de texturas (ms) y cantidad, para el informe. */
  get textureStats(): { ms: number; count: number } {
    return this.textures.stats;
  }

  /**
   * Texturas de un material: color (métrica o no), relieve y capa de gran
   * escala según la calidad. El relieve sólo va en los materiales métricos:
   * con la UV 0..1 de la caja se estiraría igual que se estiraba el color.
   */
  private applyMaps(mat: PBRMetallicRoughnessMaterial, kind: SurfaceKind | null, opts: SurfaceOpts): void {
    const metric = opts.metric === true;
    // Textura COMPARTIDA, no clonada: la escala de repeticion ya viene fijada
    // por tipo desde Textures. Compartirla ademas ayuda al batching, porque
    // los materiales que usan la misma textura evitan un cambio de binding.
    if (kind) mat.baseTexture = this.textures.get(kind, metric);
    const q = this.quality;
    // Un color liso sin capa de detalle no tiene UV que corregir.
    if (!metric || (!kind && !(q.detail && opts.detail))) return;
    // Variación procedural de gran escala (ver MetricUVPlugin): más en pisos,
    // que se ven enteros y en ángulo rasante; menos en paredes; apenas en el
    // mobiliario, donde sólo hace que dos sillas iguales no sean idénticas.
    const [tone, rough] = opts.detail === 'floor' ? [0.05, 0.18] : opts.detail === 'wall' ? [0.035, 0.08] : [0.03, 0.06];
    new MetricUVPlugin(mat, tone, rough);
    if (kind && hasRelief(kind) && (q.normals === 'all' || (q.normals === 'lite' && LITE_RELIEF.has(kind)))) {
      // Relieve por el mapa de DETALLE, no por normalTexture: ver reliefMap
      // (el SSAO deformaba las normales del mapa en las cajas escaladas).
      const d = mat.detailMap;
      d.texture = this.textures.relief(kind);
      d.isEnabled = true;
      d.diffuseBlendLevel = 0;
      d.roughnessBlendLevel = 1;
      d.bumpLevel = 1;
    }
    if (q.detail && opts.detail) {
      // Capa de gran escala: rugosidad (G) y oclusión ambiente (R) que
      // varían cada pocos metros. La oclusión en el rojo no viene activa en
      // PBRMetallicRoughnessMaterial (sí rugosidad y metal): se enciende el
      // campo de la base, como `calibratePbr`.
      mat.metallicRoughnessTexture = this.textures.macro(opts.detail === 'floor');
      (mat as unknown as { _useAmbientOcclusionFromMetallicTextureRed: boolean })._useAmbientOcclusionFromMetallicTextureRed = true;
    }
  }

  private static optsKey(opts: SurfaceOpts): string {
    return opts.metric ? `:m${opts.detail ? `:${opts.detail}` : ''}` : '';
  }

  /**
   * Toda textura va en metros salvo las atadas a la cara (`FACE_ALIGNED`) o
   * las que lo rechazan explícitamente (`metric: false`: los troncos, que
   * conservan la corteza fina de antes en vez del hormigón a escala real con
   * sus juntas de encofrado).
   */
  private static withAuto(kind: SurfaceKind | null, opts: SurfaceOpts): SurfaceOpts {
    return kind && !FACE_ALIGNED.has(kind) && opts.metric === undefined ? { ...opts, metric: true } : opts;
  }

  /**
   * Superficie PBR con mapa de detalle.
   *
   * El `kind` elige la textura procedural y su escala de repetición. En PBR el
   * color base MULTIPLICA la textura, así que una sola textura en grises sirve
   * para todos los tonos: el hormigón beige y el terracota comparten el mismo
   * grano, sólo cambia el tinte.
   */
  surface(
    color: Color3,
    roughness = 0.75,
    metallic = 0,
    kind: SurfaceKind | null = 'concrete',
    opts: SurfaceOpts = {},
  ): PBRMetallicRoughnessMaterial {
    opts = Materials.withAuto(kind, opts);
    const key = `s:${color.toHexString()}:${roughness}:${metallic}:${kind ?? 'flat'}${Materials.optsKey(opts)}`;
    const hit = this.cache.get(key);
    if (hit) return hit as PBRMetallicRoughnessMaterial;

    const mat = new PBRMetallicRoughnessMaterial(key, this.scene);
    calibratePbr(mat);
    mat.baseColor = color;
    mat.roughness = roughness;
    mat.metallic = metallic;

    this.applyMaps(mat, kind, opts);

    this.cache.set(key, mat);
    return mat;
  }

  /**
   * Variante teñida de un color base.
   *
   * Sin esto, todos los edificios que comparten tono son EXACTAMENTE del mismo
   * color, y el ojo lee inmediatamente "copiado y pegado". Variar apenas el
   * matiz y el brillo de cada edificio es de las cosas que más realismo aportan
   * por unidad de esfuerzo.
   *
   * El número de variantes está acotado (`VARIANTS`) para no reventar la cuenta
   * de materiales: con 6 variantes por tono se pierde la repetición evidente y
   * el coste en draw calls es despreciable.
   */
  surfaceVaried(
    color: Color3,
    roughness = 0.75,
    metallic = 0,
    kind: SurfaceKind | null = 'concrete',
    amount = 0.07,
  ): PBRMetallicRoughnessMaterial {
    const v = this.rng.int(0, VARIANTS - 1);
    // Mapea el índice a un desplazamiento simétrico alrededor de 0.
    const t = (v / (VARIANTS - 1) - 0.5) * 2;
    const f = 1 + t * amount;
    // El azul se mueve un poco menos: variar los tres canales por igual sólo
    // cambia el brillo; moverlos distinto cambia también la temperatura, que es
    // lo que de verdad diferencia dos edificios reales.
    const tinted = new Color3(
      clamp01(color.r * f),
      clamp01(color.g * (1 + t * amount * 0.8)),
      clamp01(color.b * (1 + t * amount * 0.55)),
    );
    return this.surface(tinted, roughness, metallic, kind);
  }

  /**
   * Superficie interior: PBR con una luz propia tenue que imita la luz
   * rebotada.
   *
   * Bajo techo, con sombras activas, el sol no llega y sólo queda la luz
   * ambiente del cielo: aulas y pasillos salían casi negros. Sumar cientos de
   * luces puntuales costaría un shader nuevo por material; un emisivo bajo,
   * proporcional al color, da el mismo efecto de "ambiente iluminado" gratis.
   *
   * El emisivo se escala por `INTERIOR_LIFT`: con el valor pleno, el rebote
   * era igual en piso, muro y cielorraso y dominaba sobre la luz del cielo,
   * así que los interiores salían uniformes y lechosos. Más bajo, la
   * diferencia entre lo que mira al cielo y lo que mira al piso vuelve a
   * modelar los ambientes.
   *
   * La rugosidad, si no se pide otra, sale del tipo de superficie: el granito
   * y el cerámico esmaltado de los pisos son pulidos y devuelven un reflejo
   * suave de las ventanas (IBL); la pintura de los muros y las placas del
   * cielorraso, no.
   */
  interior(
    color: Color3,
    kind: SurfaceKind | null = null,
    lift = 0.24,
    roughness?: number,
    opts: SurfaceOpts = {},
  ): PBRMetallicRoughnessMaterial {
    opts = Materials.withAuto(kind, opts);
    const rough = roughness ?? (kind ? INTERIOR_ROUGHNESS[kind] : undefined) ?? 0.84;
    const key = `i:${color.toHexString()}:${kind ?? 'flat'}:${lift}:${rough}${Materials.optsKey(opts)}`;
    const hit = this.cache.get(key);
    if (hit) return hit as PBRMetallicRoughnessMaterial;

    const mat = new PBRMetallicRoughnessMaterial(key, this.scene);
    calibratePbr(mat);
    // Bajo techo se ve una fracción del cielo: el IBL (que es el cielo
    // entero, sin oclusión) se atenúa en las superficies interiores. Es lo
    // que separa un aula de una vereda en sombra; sin esto los interiores
    // recibían la misma luz ambiente que la calle y se veían blancos y planos.
    (mat as unknown as { _environmentIntensity: number })._environmentIntensity = INTERIOR_ENV;
    mat.baseColor = color;
    mat.roughness = rough;
    mat.metallic = 0;
    mat.emissiveColor = color.scale(lift * INTERIOR_LIFT);
    this.applyMaps(mat, kind, opts);
    this.cache.set(key, mat);
    return mat;
  }

  /**
   * Espejo de pared (salón de los espejos, aula de danzas).
   *
   * Un espejo es una capa de plata detrás del vidrio: metal pulido, sin
   * difuso. Pero el único entorno que refleja la escena es el cielo (ver
   * Environment: la sonda NO puede incluir la escuela), así que con el
   * material de antes —o con el blanco de los marcos, que usaban algunos—
   * el espejo devolvía el horizonte claro y se leía como una pared blanca.
   *
   * Acá refleja el cielo atenuado como cualquier interior y, encima, un
   * "ambiente" procedural según la dirección reflejada (`MirrorPlugin`):
   * piso oscuro abajo, paredes con paños claros y oscuros a la altura de la
   * vista, cielorraso claro con luminarias arriba. Cambia con cada paso que
   * da el que mira, que es lo que hace leer un espejo, y cuesta unas pocas
   * instrucciones en los píxeles del espejo: sin cámara espejo (otra pasada
   * de toda la escena por cuadro, impagable en el visor).
   */
  mirror(): PBRMetallicRoughnessMaterial {
    const key = 'mirror';
    const hit = this.cache.get(key);
    if (hit) return hit as PBRMetallicRoughnessMaterial;
    const mat = new PBRMetallicRoughnessMaterial(key, this.scene);
    calibratePbr(mat);
    (mat as unknown as { _environmentIntensity: number })._environmentIntensity = INTERIOR_ENV;
    // Plata apenas fría (el vidrio verdea un poco el reflejo).
    mat.baseColor = new Color3(0.5, 0.53, 0.54);
    mat.metallic = 1;
    mat.roughness = 0.04;
    new MirrorPlugin(mat);
    this.cache.set(key, mat);
    return mat;
  }

  /** Vidrio: translúcido, liso, con reflexión del entorno. */
  glass(color: Color3 = PALETTE.glassGreen, alpha = 0.88): PBRMetallicRoughnessMaterial {
    const key = `g:${color.toHexString()}:${alpha}`;
    const hit = this.cache.get(key);
    if (hit) return hit as PBRMetallicRoughnessMaterial;

    const mat = new PBRMetallicRoughnessMaterial(key, this.scene);
    calibratePbr(mat);
    mat.baseColor = color;
    // Casi espejo: con la sonda de IBL en 256 px y coma flotante, el vidrio
    // refleja las nubes y el halo del sol, que es lo que lo hace leerse vidrio.
    mat.roughness = 0.03;
    // Metalicidad alta con IBL: el vidrio saca casi todo su color del reflejo
    // del cielo, que es exactamente cómo se comporta el vidrio real. Eso da el
    // degradado natural — claro arriba donde refleja cielo, oscuro abajo.
    mat.metallic = 0.72;
    mat.alpha = alpha;
    mat.backFaceCulling = true;
    this.cache.set(key, mat);
    return mat;
  }

  /**
   * Paneles solares.
   *
   * Nota de PBR: un material con `metallic` alto y sin textura de entorno se
   * renderiza casi negro, porque un metal no tiene componente difusa — todo su
   * color viene de lo que refleja. La escena tiene IBL (ver Environment) y
   * además los metales se mantienen bajos.
   */
  solar(): PBRMetallicRoughnessMaterial {
    return this.surface(PALETTE.solarPanel, 0.34, 0.16, 'solar');
  }

  /** Metal claro (estructuras, barandas, mástiles). */
  metal(color: Color3 = PALETTE.solarFrame, roughness = 0.42): PBRMetallicRoughnessMaterial {
    return this.surface(color, roughness, 0.25, 'metal');
  }

  /**
   * Follaje: material barato sin PBR.
   *
   * Emisivo alto a propósito: con icoesferas facetadas y luz dura, las caras en
   * sombra quedaban casi negras y los árboles se leían como cristales. Subir el
   * piso de luz propia aplana esa diferencia y devuelve masa vegetal.
   */
  foliage(color: Color3): StandardMaterial {
    const key = `f:${color.toHexString()}`;
    const hit = this.cache.get(key);
    if (hit) return hit as StandardMaterial;

    const mat = new StandardMaterial(key, this.scene);
    // Compensación de intensidad: el sol está calibrado para PBR (≈2,4) y un
    // StandardMaterial lo multiplica tal cual. Con el color pleno, la cara
    // iluminada de cada copa saturaba por encima de 1, se recortaba canal por
    // canal y el verde se volvía menta blanquecino: el "plástico pálido" de
    // las fotos. Escalado, la cara al sol da el verde real y la sombreada
    // conserva modelado.
    // Algo menos de difuso y más emisivo que antes: al sol da lo mismo
    // (0,85 × 0,45 × 2,4 + 0,45 ≈ 1,37 contra 1,08 + 0,30), pero la copa en
    // sombra —bajo los edificios de enfrente, a contraluz— deja de ser una
    // mancha negra.
    mat.diffuseColor = color.scale(STANDARD_SUN_COMP * 0.85);
    mat.specularColor = new Color3(0.03, 0.035, 0.03);
    // Con 0,3 sin compensar los árboles brillaban por su cuenta; con 0,18
    // quedaban NEGROS a contraluz. Una hoja real es fina y translúcida:
    // iluminada por detrás transmite luz. Este emisivo es un sustituto barato de
    // ese efecto, que de otro modo exigiría dispersión subsuperficial.
    mat.emissiveColor = color.scale(0.45);
    // El viento sólo se instala en follaje: mover un edificio con el viento
    // sería, además de raro, un coste por vértice que no aporta nada.
    this.winds.push(new WindPlugin(mat));
    this.cache.set(key, mat);
    return mat;
  }

  /** Césped con textura de motas. */
  grass(color: Color3): StandardMaterial {
    const key = `gr:${color.toHexString()}`;
    const hit = this.cache.get(key);
    if (hit) return hit as StandardMaterial;

    const mat = new StandardMaterial(key, this.scene);
    mat.diffuseColor = color.scale(STANDARD_SUN_COMP * 1.05);
    mat.specularColor = Color3.Black();
    mat.emissiveColor = color.scale(0.22);
    mat.diffuseTexture = this.textures.get('grass');
    this.cache.set(key, mat);
    return mat;
  }

  /** Agua. */
  water(): PBRMetallicRoughnessMaterial {
    const key = 'water';
    const hit = this.cache.get(key);
    if (hit) return hit as PBRMetallicRoughnessMaterial;

    const mat = new PBRMetallicRoughnessMaterial(key, this.scene);
    calibratePbr(mat);
    // Más profunda y más especular: con el celeste claro y casi sin reflejo el
    // agua se leía como una losa pintada. Oscura, refleja el cielo del IBL y
    // recién ahí parece agua.
    mat.baseColor = PALETTE.waterDeep.scale(1.15);
    mat.roughness = 0.07;
    mat.metallic = 0.45;
    mat.alpha = 0.92;
    this.cache.set(key, mat);
    return mat;
  }

  /**
   * Material emisivo para señalética, luces y ventanas encendidas.
   *
   * La clave NO incluye la ganancia HDR (City.ts la reconstruye para
   * conmutar las ventanas encendidas).
   */
  glow(color: Color3, intensity = 1): StandardMaterial {
    const key = `e:${color.toHexString()}:${intensity}`;
    const hit = this.cache.get(key);
    if (hit) return hit as StandardMaterial;

    const mat = new StandardMaterial(key, this.scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    // Una fuente de luz tiene que ser MÁS brillante que un muro blanco al sol,
    // si no, no se lee como luz. El estándar trabaja en gamma: × 1,9 en gamma
    // es × 4,1 en lineal. Así las luminarias y las ventanas encendidas
    // superan el umbral del bloom (y los muros no), y en el visor, sin bloom,
    // el mapeo tonal las deja blancas cálidas en vez de grises.
    mat.emissiveColor = color.scale(intensity * GLOW_GAIN);
    mat.disableLighting = true;
    this.cache.set(key, mat);
    return mat;
  }

  /**
   * Congela todos los materiales. Se llama UNA vez, al final del armado de la
   * escena y después de configurar las sombras.
   */
  freezeAll(): void {
    for (const mat of this.cache.values()) mat.freeze();
    // Ya no se crean materiales: las alturas pintadas sobran.
    this.textures.trim();
  }

  /** Avanza el reloj del viento. La escena lo llama una vez por cuadro. */
  tickWind(deltaSeconds: number): void {
    for (const w of this.winds) w.tick(deltaSeconds);
  }

  /** Reloj del viento, para verificar que efectivamente avanza. */
  get windClock(): number {
    return this.winds[0]?.clock ?? -1;
  }

  /** Materiales a precompilar, para que el hitch caiga en la barra de carga. */
  get all(): Material[] {
    return [...this.cache.values()];
  }

  get count(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const mat of this.cache.values()) mat.dispose();
    this.cache.clear();
    this.winds.length = 0;
    this.textures.dispose();
  }
}

/**
 * Ganancia de la luz directa en los materiales PBR.
 *
 * El difuso PBR de Babylon divide por π (Lambert normalizado); el
 * StandardMaterial, no. Con el mismo sol, una fachada PBR recibía un tercio
 * de la luz que un árbol o una persona, mientras que el IBL (que no divide)
 * le llegaba entero: el sol apenas se distinguía de la sombra y todo se veía
 * plano y lechoso. Medido en la fachada a las 8:15, el sol aportaba lo mismo
 * que el cielo (relación 2 : 1 entre lo iluminado y la sombra).
 *
 * Con la ganancia π el sol vale lo mismo para PBR y para estándar (follaje,
 * gente, carteles siguen calibrados con STANDARD_SUN_COMP) y la relación
 * pasa a ~4 : 1 con sol rasante y ~7 : 1 al mediodía. La hemisférica en PBR
 * NO divide por π, así que también queda multiplicada: por eso su intensidad
 * en los preajustes es baja (ver TimeOfDay).
 */
export const PBR_DIRECT_GAIN = Math.PI;

/**
 * Aplica la calibración de luz directa a un material PBR.
 *
 * Exportada para los PBR que se crean fuera de esta biblioteca (tranvías,
 * utilería de otros sistemas): sin ella se verían más oscuros al sol que el
 * resto de la ciudad. Babylon no expone `directIntensity` en
 * PBRMetallicRoughnessMaterial aunque su base lo usa (uniforme
 * vLightingIntensity.x); se fija el campo de la base.
 */
export function calibratePbr(mat: PBRMetallicRoughnessMaterial | Material): void {
  (mat as unknown as { _directIntensity: number })._directIntensity = PBR_DIRECT_GAIN;
}

/**
 * Factor con el que los StandardMaterial reciben el sol.
 *
 * El sol vale ~2,4 porque la ciudad es PBR con mapeo tonal. Los materiales
 * baratos (follaje, césped, gente) no pasan por ese modelo y saturaban.
 * 0,45 × 2,4 ≈ 1: al sol pleno dan exactamente su color.
 */
export const STANDARD_SUN_COMP = 0.45;

/**
 * Fracción del rebote simulado que se aplica en interiores (ver `interior`).
 */
export const INTERIOR_LIFT = 0.8;

/**
 * Intensidad del IBL en superficies interiores (la de la escena va de 0,36 a
 * 0,42 según la hora). Fija: la variación diaria ya la trae la sonda, que se
 * vuelve a capturar con cada cambio de cielo.
 */
export const INTERIOR_ENV = 0.26;

/** Ganancia de las fuentes de luz sobre su color nominal (ver `glow`). */
export const GLOW_GAIN = 1.9;

/**
 * Rugosidad de cada familia de superficie interior.
 *
 * Pulido = reflejo suave del cielo de las ventanas sobre el piso, que es lo
 * que distingue un granito encerado de un piso pintado. Nunca por debajo de
 * 0,35: más liso, el IBL (que es sólo cielo) pintaba un "cielo" azul sobre
 * el piso del hall.
 */
export const INTERIOR_ROUGHNESS: Partial<Record<SurfaceKind, number>> = {
  granite: 0.48,
  pavement: 0.44,
  checker: 0.42,
  ceramic: 0.4,
  marble: 0.36,
  parquet: 0.55,
  timber: 0.66,
  lattice: 0.74,
  corrugated: 0.46,
  concrete: 0.88,
  block: 0.9,
  brick: 0.9,
  panels: 0.92,
  // Látex mate: la pared no devuelve reflejo de la ventana, sólo un lustre
  // muy abierto con luz rasante.
  plaster: 0.9,
  fabric: 0.95,
  rubber: 0.82,
};

/** Cuántas variantes de tinte se generan por tono base. */
const VARIANTS = 4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * UV en metros desde la posición en el mundo, para cajas y prismas.
 *
 * La escuela está hecha de cajas unitarias escaladas (granja de instancias):
 * su UV va de 0 a 1 en cada cara sea cual sea el tamaño, así que un
 * antepecho de 30 cm y un paño de 6 m estiraban la misma textura de forma
 * distinta, y la fachada parecía revestida de tablas. Acá la UV se reemplaza
 * en el vertex shader por la posición de mundo proyectada según el eje
 * dominante de la normal (planta para pisos y techos, alzado para muros):
 * cada textura mide lo que mide en la realidad y empalma entre piezas
 * vecinas (un muro cortado en antepecho, dintel y tramos sigue siendo UNA
 * pared).
 *
 * La proyección sólo se usa en cajas y prismas (`isMetricMesh`): en un
 * cilindro, los vértices de un mismo triángulo pueden caer en proyecciones
 * distintas y la UV se interpolaría rota; ahí se escala su UV propia por el
 * tamaño de la instancia (`isTurnedMesh`). El mapa
 * de normales no necesita tangentes: Babylon arma el marco con las derivadas
 * de esta misma UV, así que sigue a la proyección en cada cara.
 */
class MetricUVPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    /** Amplitud de la variación de tono de gran escala (±, fracción del color). */
    private readonly tone: number,
    /** Amplitud de la variación de rugosidad de gran escala (±, fracción). */
    private readonly rough: number,
  ) {
    // Los dos `true` registran Y activan el plugin (ver WindPlugin).
    super(material, 'MetricUV', 110, { METRICUV: false, METRICCYL: false, METRICVAR: false }, true, true);
  }

  override getClassName(): string {
    return 'MetricUVPlugin';
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: Record<string, unknown>, _scene: Scene, mesh: AbstractMesh): void {
    defines.METRICUV = isMetricMesh(mesh);
    defines.METRICCYL = isTurnedMesh(mesh);
    defines.METRICVAR = this.tone > 0 || this.rough > 0;
  }

  override getUniforms() {
    return {
      ubo: [{ name: 'metricVar', size: 2, type: 'vec2' }],
      fragment: `
        #ifdef METRICVAR
        uniform vec2 metricVar;
        #endif
      `,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat2('metricVar', this.tone, this.rough);
  }

  override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType === 'vertex') {
      return {
        // Después de calcular worldPos y vNormalW y antes de que las UV pasen
        // por la matriz de cada textura (que aplica la repetición métrica).
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
          #if defined(METRICUV) && defined(UV1) && defined(NORMAL)
          {
            vec3 muvN = abs(vNormalW);
            uvUpdated = muvN.y >= max(muvN.x, muvN.z) ? worldPos.xz : (muvN.x >= muvN.z ? worldPos.zy : worldPos.xy);
          }
          #endif
          // Cilindros y conos: su UV propia (u alrededor, v a lo largo) pasada
          // a metros con la escala de la instancia (diámetro y alto). Una
          // columna o un caño muestran la textura a su tamaño real, sin la
          // costura que daría proyectarlos por ejes.
          #if defined(METRICCYL) && defined(UV1)
          uvUpdated = vec2(uv.x * 3.14159 * length(finalWorld[0].xyz), uv.y * length(finalWorld[1].xyz));
          #endif
        `,
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      // Campo suave de gran escala (períodos de 6 a 12 m, deformados para que
      // no se lea como ondas): tono y rugosidad que varían a lo largo de un
      // pasillo o de un muro. Es la anti-repetición del visor, que no paga
      // la capa macro con textura: unas pocas instrucciones por píxel.
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef METRICVAR
        float metricField(vec3 p) {
          float a = sin(dot(p.xz, vec2(0.61, 0.23)) + 1.7 * sin(dot(p.xz, vec2(-0.27, 0.53)) + p.y * 0.4));
          float b = sin(dot(p.zy, vec2(0.83, 0.47)) + 1.3 * sin(p.x * 0.91 - p.z * 0.17));
          return a * 0.6 + b * 0.4;
        }
        #endif
      `,
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
        #ifdef METRICVAR
        surfaceAlbedo *= 1.0 + metricVar.x * metricField(vPositionW);
        #endif
      `,
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: `
        #ifdef METRICVAR
        metallicRoughness.g = clamp(metallicRoughness.g * (1.0 + metricVar.y * metricField(vPositionW.zxy * 1.37 + 5.1)), 0.0, 1.0);
        #endif
      `,
    };
  }
}

/**
 * Mallas que reciben la UV métrica: las cajas de la granja (`box|…`) y los
 * prismas de la escuela (`school-…`, PrismBatch), todas de caras planas.
 */
function isMetricMesh(mesh: AbstractMesh): boolean {
  return mesh.name.startsWith('box|') || mesh.name.startsWith('school-');
}

/** Cilindros y conos de la granja (`cylinder|…`, `cone|…`). */
function isTurnedMesh(mesh: AbstractMesh): boolean {
  return mesh.name.startsWith('cylinder|') || mesh.name.startsWith('cone|');
}

/**
 * Reflejo de "ambiente" procedural de los espejos (ver `Materials.mirror`).
 *
 * Con la dirección reflejada se arma una habitación genérica: piso oscuro
 * cálido abajo, paredes a media luz con paños que alternan (puertas,
 * ventanas, la barra) a la altura de la vista y cielorraso claro con
 * luminarias. No reproduce el lugar exacto ni a la gente, pero se mueve como
 * un reflejo: al acercarse o agacharse, el piso sube o baja en el espejo.
 */
class MirrorPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'Mirror', 130, { MIRRORROOM: false }, true, true);
  }

  override getClassName(): string {
    return 'MirrorPlugin';
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.MIRRORROOM = true;
  }

  override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `
        #ifdef MIRRORROOM
        {
          vec3 mR = reflect(-viewDirectionW, normalW);
          float up = mR.y;
          float az = atan(mR.z, mR.x);
          // Piso: la línea piso-pared de la pared de enfrente cae, para una
          // sala de 6-10 m, a unos 10° por debajo de la horizontal.
          vec3 room = mix(vec3(0.15, 0.115, 0.09), vec3(0.5, 0.5, 0.49), smoothstep(-0.2, -0.14, up));
          // Zócalo oscuro justo sobre el piso.
          room *= 1.0 - 0.35 * (smoothstep(-0.15, -0.13, up) - smoothstep(-0.11, -0.09, up));
          // Aberturas en las paredes reflejadas: ventanas claras y puertas
          // oscuras que se alternan alrededor y pasan al moverse.
          float sa = sin(az * 4.0 + 0.7);
          float win = smoothstep(0.55, 0.65, sa) * (smoothstep(-0.02, 0.02, up) - smoothstep(0.2, 0.24, up));
          float door = smoothstep(0.55, 0.65, -sa) * (smoothstep(-0.15, -0.13, up) - smoothstep(0.12, 0.16, up));
          room = mix(room, vec3(1.15, 1.17, 1.2), win * 0.8);
          room = mix(room, vec3(0.2, 0.2, 0.22), door * 0.7);
          // Cielorraso claro con sus luminarias.
          room = mix(room, vec3(0.7, 0.7, 0.68), smoothstep(0.28, 0.4, up));
          room += vec3(1.6, 1.6, 1.5) * smoothstep(0.93, 0.99, sin(az * 7.0) * 0.5 + 0.5) * smoothstep(0.42, 0.6, up) * (1.0 - smoothstep(0.8, 0.95, up));
          finalColor.rgb += room * 0.9;
        }
        #endif
      `,
    };
  }
}
