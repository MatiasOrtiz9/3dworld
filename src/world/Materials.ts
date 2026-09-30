import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { PALETTE } from './Palette';
import { Textures, type SurfaceKind } from './Textures';
import { Rng } from '../utils/rng';
import { WindPlugin } from './WindPlugin';

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

  constructor(private readonly scene: Scene) {
    this.textures = new Textures(scene);
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
  ): PBRMetallicRoughnessMaterial {
    const key = `s:${color.toHexString()}:${roughness}:${metallic}:${kind ?? 'flat'}`;
    const hit = this.cache.get(key);
    if (hit) return hit as PBRMetallicRoughnessMaterial;

    const mat = new PBRMetallicRoughnessMaterial(key, this.scene);
    mat.baseColor = color;
    mat.roughness = roughness;
    mat.metallic = metallic;

    if (kind) {
      // Textura COMPARTIDA, no clonada: la escala de repeticion ya viene fijada
      // por tipo desde Textures. Compartirla ademas ayuda al batching, porque
      // los materiales que usan la misma textura evitan un cambio de binding.
      mat.baseTexture = this.textures.get(kind);
    }

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
   */
  interior(
    color: Color3,
    kind: SurfaceKind | null = null,
    lift = 0.24,
    roughness = 0.82,
  ): PBRMetallicRoughnessMaterial {
    const key = `i:${color.toHexString()}:${kind ?? 'flat'}:${lift}:${roughness}`;
    const hit = this.cache.get(key);
    if (hit) return hit as PBRMetallicRoughnessMaterial;

    const mat = new PBRMetallicRoughnessMaterial(key, this.scene);
    mat.baseColor = color;
    mat.roughness = roughness;
    mat.metallic = 0;
    mat.emissiveColor = color.scale(lift);
    if (kind) mat.baseTexture = this.textures.get(kind);
    this.cache.set(key, mat);
    return mat;
  }

  /** Vidrio: translúcido, liso, con reflexión del entorno. */
  glass(color: Color3 = PALETTE.glassGreen, alpha = 0.88): PBRMetallicRoughnessMaterial {
    const key = `g:${color.toHexString()}:${alpha}`;
    const hit = this.cache.get(key);
    if (hit) return hit as PBRMetallicRoughnessMaterial;

    const mat = new PBRMetallicRoughnessMaterial(key, this.scene);
    mat.baseColor = color;
    mat.roughness = 0.05;
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
    mat.diffuseColor = color.scale(STANDARD_SUN_COMP);
    mat.specularColor = new Color3(0.03, 0.035, 0.03);
    // Con 0,3 sin compensar los árboles brillaban por su cuenta; con 0,18
    // quedaban NEGROS a contraluz. Una hoja real es fina y translúcida:
    // iluminada por detrás transmite luz. Este emisivo es un sustituto barato de
    // ese efecto, que de otro modo exigiría dispersión subsuperficial.
    mat.emissiveColor = color.scale(0.3);
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

  /** Material emisivo para señalética, luces y ventanas encendidas. */
  glow(color: Color3, intensity = 1): StandardMaterial {
    const key = `e:${color.toHexString()}:${intensity}`;
    const hit = this.cache.get(key);
    if (hit) return hit as StandardMaterial;

    const mat = new StandardMaterial(key, this.scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = color.scale(intensity);
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
 * Factor con el que los StandardMaterial reciben el sol.
 *
 * El sol vale ~2,4 porque la ciudad es PBR con mapeo tonal. Los materiales
 * baratos (follaje, césped, gente) no pasan por ese modelo y saturaban.
 * 0,45 × 2,4 ≈ 1: al sol pleno dan exactamente su color.
 */
export const STANDARD_SUN_COMP = 0.45;

/** Cuántas variantes de tinte se generan por tono base. */
const VARIANTS = 4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
