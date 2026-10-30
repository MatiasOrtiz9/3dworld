import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Nullable } from '@babylonjs/core/types';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowDepthWrapper } from '@babylonjs/core/Materials/shadowDepthWrapper';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { InstanceFarm } from '../core/InstanceFarm';
import { Rng, seedFromString } from '../utils/rng';
import { STANDARD_SUN_COMP } from './Materials';

/**
 * Vegetación en tarjetas recortadas (Escuela 2050, auditoría ítem 12).
 *
 * Las matas, las frondas de palmera y los jardines verticales de la escuela
 * eran icoesferas abolladas (80 triángulos, "almohadones" rosas y violetas
 * en los canteros) y cajas chatas (palmeras de tablones, palitos beige). De
 * cerca —y en el visor todo está cerca— se leían como juguetes. Ahora son
 * planos con un dibujo de hojas recortado por alfa: dos planos cruzados (4
 * triángulos) ya tienen silueta de planta, que es lo que el ojo reconoce.
 *
 * Todo sale de UN canvas (`ATLAS_W` × `ATLAS_H`, pintado acá, sin archivos)
 * y UN material: todas las tarjetas de la escuela son un solo draw call
 * (la primitiva `plane` de la granja con este material).
 *
 * El truco para elegir el dibujo SIN atributos por instancia (la granja sólo
 * guarda matrices): un plano no tiene espesor, así que la escala en Z de su
 * matriz no mueve ningún vértice. Ahí va la clase de la tarjeta (`CARD`):
 * `escala Z = clase + 1`. El vertex shader la lee (largo de la tercera
 * columna de la matriz) y lleva la UV a la región del atlas que toca.
 *
 * El resto lo hace el plugin (`CardPlugin`):
 *  - **Recorte por alfa compensado por mip**: con el alfa promediado de los
 *    mipmaps, una mata recortada se "deshojaba" a los 10 m. Se escala el alfa
 *    con el nivel de mip estimado (derivadas de la UV), y la mata conserva su
 *    masa de lejos.
 *  - **Viento**: la base quieta y la punta libre (peso según la altura en
 *    la tarjeta), con las mismas ráfagas que viajan del `WindPlugin`; la fase
 *    sale de una celda de 2 m, así las dos tarjetas de una mata (y los dos
 *    tramos de una fronda) se mueven juntas.
 *  - **Sombra con el recorte**: `ShadowDepthWrapper` dibuja el mapa de
 *    sombras con este mismo shader, así una mata proyecta hojas y no un
 *    rectángulo (el generador de sombras sólo sabe recortar con la textura
 *    entera, no con la región de cada instancia).
 *
 * La luz imita a `Materials.foliage` (HANDOFF 11): difuso compensado y piso
 * emisivo, que el StandardMaterial multiplica por el color de la textura, así
 * la mata en sombra no se apaga en negro.
 */

/** Ancho del atlas, en píxeles. */
const ATLAS_W = 1024;
/** Alto del atlas, en píxeles. */
const ATLAS_H = 1024;

/** Clase de tarjeta (el dibujo y cómo se mueve con el viento). */
export type CardKind =
  /** Tramo de la base de una fronda de palmera (sube del tronco). */
  | 'frondIn'
  /** Tramo de la punta de una fronda (cae). */
  | 'frondOut'
  /** Fronda entera en una sola tarjeta (penachos cortos, hojas paradas). */
  | 'frond'
  /** Gramínea ornamental: hojas finas en abanico y espigas claras. */
  | 'grass'
  /** Mata de hojas anchas (cubresuelo, helecho, arbusto bajo). */
  | 'fern'
  /** Mata florida (hojas chicas y flores rosas, blancas, amarillas y lilas). */
  | 'flower'
  /** Paño de jardín vertical: hojas chicas apretadas, casi sin huecos. */
  | 'ivy'
  /** Red blanca de malla romboidal (aros y arcos). */
  | 'net'
  /** Mulch: chips de corteza con algún brote, para la tierra de los canteros. */
  | 'mulch'
  /** Masa de copa de árbol: nube de hojas de borde calado (envuelve la icoesfera). */
  | 'crown'
  /** Masa de copa en flor (jacarandá, palo borracho): racimos lilas y rosados entre pocas hojas. */
  | 'bloom';

/** Índice de cada clase: la escala Z del plano es `índice + 1`. */
export const CARD: Readonly<Record<CardKind, number>> = {
  frondIn: 0,
  frondOut: 1,
  frond: 2,
  grass: 3,
  fern: 4,
  flower: 5,
  ivy: 6,
  net: 7,
  mulch: 8,
  crown: 9,
  bloom: 10,
};

/**
 * Regiones del atlas (u0, v0, du, dv en UV, v hacia arriba) y viento de cada
 * clase (peso en la base, peso en la punta, amplitud en metros). Tiene que
 * coincidir con `regionGlsl` (el shader las lleva escritas).
 */
/** Las clases de siempre ocupan la mitad de abajo del atlas (v 0–0,5). */
const LOWER: readonly (readonly [number, number, number, number, number, number, number])[] = [
  // frondIn: la parte de la fronda junto al tronco.
  [0.0, 0.0, 0.25, 0.42, 0.0, 0.3, 0.1],
  // frondOut: de ahí a la punta.
  [0.0, 0.42, 0.25, 0.58, 0.3, 1.0, 0.1],
  // frond: entera.
  [0.0, 0.0, 0.25, 1.0, 0.0, 1.0, 0.08],
  // grass, fern, flower.
  [0.25, 0.5, 0.25, 0.5, 0.0, 1.0, 0.07],
  [0.25, 0.0, 0.25, 0.5, 0.0, 1.0, 0.045],
  [0.5, 0.5, 0.25, 0.5, 0.0, 1.0, 0.045],
  // ivy: pegada a su marco, apenas tiembla.
  [0.5, 0.0, 0.25, 0.5, 1.0, 1.0, 0.0],
  // net, mulch: quietas.
  [0.75, 0.5, 0.25, 0.5, 0.0, 0.0, 0.0],
  [0.75, 0.0, 0.25, 0.5, 0.0, 0.0, 0.0],
];
const REGIONS: readonly (readonly [number, number, number, number, number, number, number])[] = [
  ...LOWER.map(([u0, v0, du, dv, w0, w1, a]) => [u0, v0 / 2, du, dv / 2, w0, w1, a] as const),
  // crown: arriba a la izquierda, cuadrada (512 px); se mece entera, poco.
  [0.0, 0.5, 0.5, 0.5, 0.6, 1.0, 0.05],
  // bloom: arriba a la derecha, igual que la copa.
  [0.5, 0.5, 0.5, 0.5, 0.6, 1.0, 0.05],
];

/** `if` encadenado con las regiones (los uniformes en arreglo no hacen falta: son fijas). */
function regionGlsl(): string {
  const f = (n: number) => n.toFixed(4);
  return REGIONS.map(
    ([u0, v0, du, dv, w0, w1, amp], i) =>
      `${i === 0 ? '' : 'else '}if (cCls < ${i}.5) { cReg = vec4(${f(u0)}, ${f(v0)}, ${f(du)}, ${f(dv)}); cWind = vec3(${f(w0)}, ${f(w1)}, ${f(amp)}); }`,
  ).join('\n');
}

/**
 * Plugin de las tarjetas: región del atlas por instancia, viento, recorte
 * compensado por mip, sombra de base y tinte por planta.
 */
class CardPlugin extends MaterialPluginBase {
  /** Reloj del viento (segundos). */
  time = 0;

  constructor(material: Material) {
    super(material, 'FoliageCards', 125, { CARDS: true }, true, true);
  }

  override getClassName(): string {
    return 'FoliageCardsPlugin';
  }

  override prepareDefines(defines: Record<string, unknown>, _scene: Scene, _mesh: AbstractMesh): void {
    defines.CARDS = true;
  }

  override isCompatible(): boolean {
    return true;
  }

  override getUniforms() {
    return {
      ubo: [{ name: 'cardTime', size: 1, type: 'float' }],
      vertex: `uniform float cardTime;`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('cardTime', this.time);
  }

  override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
          #ifdef CARDS
          varying vec2 vCard;
          #endif
        `,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
          #ifdef CARDS
          {
            // Clase de la tarjeta: la escala Z de su matriz (un plano no
            // tiene espesor: esa escala no mueve ningún vértice).
            float cCls = floor(length(finalWorld[2].xyz) + 0.5) - 1.0;
            vec4 cReg = vec4(0.0, 0.0, 1.0, 1.0);
            vec3 cWind = vec3(0.0);
            ${regionGlsl()}
            float cT = clamp(uvUpdated.y, 0.0, 1.0);
            // Peso del viento: la base quieta, la punta libre (cuadrático: la
            // hoja se dobla, no gira como una tabla).
            float cW = mix(cWind.x, cWind.y, cT);
            cW *= cW;
            vec3 cA = finalWorld[3].xyz;
            // Fase por celda de 2 m: las tarjetas de una misma planta (y los
            // dos tramos de una fronda) se mueven juntas.
            vec2 cCell = floor(cA.xz * 0.5);
            vec2 cDir = vec2(0.86, 0.51);
            float cGA = sin(dot(cCell * 2.0, cDir) * 0.06 - cardTime * 0.37);
            float cGB = sin(dot(cCell * 2.0, vec2(-0.42, 0.91)) * 0.033 - cardTime * 0.21 + 1.3);
            float cGust = clamp(0.5 + 0.5 * (cGA * 0.65 + cGB * 0.35), 0.0, 1.0);
            cGust = 0.28 + 0.72 * cGust * cGust * (3.0 - 2.0 * cGust);
            float cPh = dot(cCell, vec2(1.7, 2.3));
            float cOsc = sin(cardTime * 1.3 + cPh) * 0.6 + sin(cardTime * 2.17 + cPh * 1.7) * 0.4;
            float cFlut = sin(cardTime * 7.3 + dot(worldPos.xyz, vec3(2.3, 1.9, 2.7))) * 0.6
                        + sin(cardTime * 11.1 + dot(worldPos.xyz, vec3(-3.1, 2.6, 1.7))) * 0.4;
            float cPush = cWind.z * cW * (0.45 * cGust + cOsc * (0.35 + 0.65 * cGust));
            worldPos.xz += cDir * cPush;
            worldPos.y -= abs(cPush) * 0.25;
            // vNormalW sólo existe con NORMAL (sin luces no se declara).
            #ifdef NORMAL
            worldPos.xyz += vNormalW * cFlut * cWind.z * 0.18 * cW;
            #endif
            uvUpdated = cReg.xy + uvUpdated * cReg.zw;
            // Tinte suave por planta (más cálido o más frío), sin otro material.
            float cH = fract(sin(dot(cCell, vec2(12.9898, 78.233))) * 43758.5453);
            vCard = vec2(cT, 0.92 + 0.16 * cH);
          }
          #endif
        `,
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef CARDS
        varying vec2 vCard;
        #endif
      `,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef CARDS
        {
          // Recorte con el alfa escalado por el nivel de mip: los mipmaps
          // promedian hojas y huecos, y sin esto la mata se deshojaba de lejos.
          vec2 cTex = vDiffuseUV * vec2(${ATLAS_W.toFixed(1)}, ${ATLAS_H.toFixed(1)});
          vec2 cDx = dFdx(cTex);
          vec2 cDy = dFdy(cTex);
          float cLod = max(0.0, 0.5 * log2(max(dot(cDx, cDx), dot(cDy, cDy))));
          if (baseColor.a * (1.0 + cLod * 0.28) < 0.5) discard;
          // Los huecos del canvas son negros transparentes: el filtrado y los
          // mipmaps mezclan ese negro con la hoja y, de lejos, la palmera y las
          // matas quedaban casi negras. Dividir por el alfa devuelve el color
          // promedio de las hojas (el alfa ya es la fracción de hoja).
          baseColor.rgb /= max(baseColor.a, 0.25);
          // La base de la planta, más oscura (sombra propia de la mata).
          baseColor.rgb *= mix(0.68, 1.0, smoothstep(0.0, 0.55, vCard.x)) * vCard.y;
        }
        #endif
      `,
    };
  }
}

interface CardMaterial {
  material: StandardMaterial;
  plugin: CardPlugin;
}

/**
 * Un material por escena (se reusa al reconstruir la ciudad con otra
 * semilla: el atlas no depende de la semilla).
 */
const byScene = new WeakMap<Scene, CardMaterial>();

function cardMaterial(scene: Scene): CardMaterial {
  const hit = byScene.get(scene);
  if (hit && hit.material.getScene().materials.includes(hit.material)) return hit;
  const tex = new DynamicTexture('foliageCardsAtlas', { width: ATLAS_W, height: ATLAS_H }, scene, true);
  paintAtlas(tex.getContext() as unknown as CanvasRenderingContext2D);
  // invertY: la fila de arriba del canvas es la punta de la tarjeta.
  tex.update(true);
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;

  const mat = new StandardMaterial('cards|foliage', scene);
  mat.diffuseTexture = tex;
  // El recorte lo hace el plugin (con la región y el mip de cada instancia):
  // para el motor el material es opaco (se dibuja con lo opaco, escribe
  // profundidad y no se ordena).
  mat.transparencyMode = Material.MATERIAL_OPAQUE;
  mat.useAlphaFromDiffuseTexture = false;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  // Como `Materials.foliage`: difuso compensado por el sol PBR y piso de luz
  // propia (el estándar lo multiplica por el color de la textura).
  mat.diffuseColor = new Color3(1, 1, 1).scale(STANDARD_SUN_COMP * 0.72);
  mat.emissiveColor = new Color3(0.66, 0.68, 0.64);
  mat.specularColor = new Color3(0.035, 0.04, 0.035);
  const plugin = new CardPlugin(mat);
  // Sombra con el recorte y el viento de cada tarjeta (ver el encabezado).
  mat.shadowDepthWrapper = new ShadowDepthWrapper(mat, scene, { standalone: true });
  scene.onBeforeRenderObservable.add(() => {
    plugin.time += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
  });
  const out = { material: mat, plugin };
  byScene.set(scene, out);
  return out;
}

/**
 * Plantador de tarjetas sobre la granja: una tarjeta suelta (`card`) o una
 * mata de tarjetas cruzadas (`tuft`). Coordenadas del MUNDO.
 */
export class FoliageCards {
  private readonly mat: StandardMaterial;

  constructor(
    private readonly farm: InstanceFarm,
    scene: Scene,
  ) {
    this.mat = cardMaterial(scene).material;
  }

  /**
   * Una tarjeta de `w` × `h` con centro en `center`. Sin giros es vertical,
   * con el dibujo hacia −Z y la punta arriba; `yaw` gira sobre Y, `pitch`
   * inclina la punta hacia +Z local (π/2: acostada, mirando arriba).
   */
  card(kind: CardKind, center: Vector3, w: number, h: number, yaw = 0, pitch = 0, roll = 0): void {
    this.farm.add('plane', this.mat, center, new Vector3(w, h, CARD[kind] + 1), yaw, pitch, roll);
  }

  /**
   * Tramo de hoja de `a` a `len` metros en la dirección (`yaw`, `elev`):
   * elevación sobre la horizontal (negativa: cae). Devuelve la punta.
   */
  blade(kind: CardKind, a: Vector3, yaw: number, elev: number, len: number, w: number): Vector3 {
    const ce = Math.cos(elev);
    const d = new Vector3(Math.sin(yaw) * ce, Math.sin(elev), Math.cos(yaw) * ce);
    this.card(kind, a.add(d.scale(len / 2)), w, len, yaw, Math.PI / 2 - elev);
    return a.add(d.scale(len));
  }

  /**
   * Mata de `n` tarjetas verticales cruzadas (repartidas en 180°), apoyada en
   * `y`, de `w` de ancho y `h` de alto.
   */
  tuft(kind: CardKind, x: number, z: number, y: number, w: number, h: number, yaw = 0, n = 2): void {
    for (let k = 0; k < n; k++) this.card(kind, new Vector3(x, y + h / 2, z), w, h, yaw + (k / n) * Math.PI);
  }

  /** Tarjeta acostada (mulch, cubresuelo) de `w` × `d`, a la altura `y`. */
  flat(kind: CardKind, x: number, z: number, y: number, w: number, d: number, yaw = 0): void {
    this.card(kind, new Vector3(x, y, z), w, d, yaw, Math.PI / 2);
  }
}

// ======================================================================= atlas

type Ctx = CanvasRenderingContext2D;

/** Región en píxeles del canvas (y hacia abajo) de una clase. */
function px(i: number): { x: number; y: number; w: number; h: number } {
  const [u0, v0, du, dv] = REGIONS[i];
  return { x: u0 * ATLAS_W, y: (1 - v0 - dv) * ATLAS_H, w: du * ATLAS_W, h: dv * ATLAS_H };
}

const rgb = (r: number, g: number, b: number, a = 1) =>
  `rgba(${Math.round(Math.max(0, Math.min(255, r)))},${Math.round(Math.max(0, Math.min(255, g)))},${Math.round(Math.max(0, Math.min(255, b)))},${a})`;

/** Pinta todas las regiones. Determinista: no depende de la semilla de la ciudad. */
function paintAtlas(ctx: Ctx): void {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  const r = new Rng(seedFromString('foliageCards'));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  paintFrond(ctx, px(CARD.frond), r);
  paintGrass(ctx, px(CARD.grass), r);
  paintMound(ctx, px(CARD.fern), r, false);
  paintMound(ctx, px(CARD.flower), r, true);
  paintIvy(ctx, px(CARD.ivy), r);
  paintNet(ctx, px(CARD.net));
  paintMulch(ctx, px(CARD.mulch), r);
  paintCrown(ctx, px(CARD.crown), new Rng(seedFromString('foliageCrown')));
  paintBloom(ctx, px(CARD.bloom), new Rng(seedFromString('foliageBloom')));
}

/**
 * Copa en flor: el mismo contorno lobulado que `paintCrown`, pero hecho de
 * racimos de flores lilas (jacarandá) con algún rosa y blanco, y pocas hojas
 * verdes asomando. Reemplaza el borde liso de la icoesfera violeta, que de
 * cerca se leía como un globo.
 */
function paintBloom(ctx: Ctx, R: { x: number; y: number; w: number; h: number }, r: Rng): void {
  const cx = R.x + R.w / 2;
  const cy = R.y + R.h * 0.52;
  const rad = R.w * 0.46;
  const lobes = [r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28)];
  const edge = (a: number) =>
    rad * (0.8 + 0.11 * Math.sin(a * 3 + lobes[0]) + 0.07 * Math.sin(a * 6 + lobes[1]) + 0.04 * Math.sin(a * 11 + lobes[2]));
  ctx.strokeStyle = rgb(74, 58, 44);
  for (let k = 0; k < 8; k++) {
    const a = r.range(0, Math.PI * 2);
    ctx.lineWidth = r.range(2, 4);
    ctx.beginPath();
    ctx.moveTo(cx, cy + rad * 0.3);
    ctx.lineTo(cx + Math.cos(a) * edge(a) * r.range(0.5, 0.85), cy + Math.sin(a) * edge(a) * r.range(0.5, 0.85));
    ctx.stroke();
  }
  const n = 2600;
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const a = r.range(0, Math.PI * 2);
    const d = Math.sqrt(r.range(0.04, 1)) * (0.55 + 0.45 * t);
    if (d > 1.02) continue;
    const e = edge(a);
    const x = cx + Math.cos(a) * e * d;
    const y = cy + Math.sin(a) * e * d * 0.92;
    const up = (cy - y) / rad;
    const g = (0.6 + 0.4 * t + 0.2 * up) * r.range(0.86, 1.12);
    if (r.chance(0.16)) {
      // Hoja verde entre los racimos.
      const ang = a + r.range(-1.2, 1.2);
      const len = r.range(10, 18);
      leaf(ctx, x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5, ang, len, len * 0.42, rgb(64 * g, 104 * g, 50 * g));
      continue;
    }
    // Racimo: tres o cuatro florcitas apretadas.
    const base = r.chance(0.12) ? [214, 150, 186] : r.chance(0.08) ? [232, 226, 240] : r.chance(0.5) ? [150, 128, 206] : [128, 108, 190];
    const m = 3 + Math.floor(r.range(0, 2));
    for (let q = 0; q < m; q++) {
      const fx = x + r.range(-5, 5);
      const fy = y + r.range(-5, 5);
      const fr = r.range(2.6, 4.6);
      ctx.fillStyle = rgb(base[0] * g, base[1] * g, base[2] * g);
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(base[0] * g * 1.18, base[1] * g * 1.15, base[2] * g * 1.08, 0.6);
      ctx.beginPath();
      ctx.arc(fx - fr * 0.3, fy - fr * 0.3, fr * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Masa de copa: una nube de hojas chicas, más densa y oscura adentro, con el
 * borde calado y alguna rama asomando. Va cruzada sobre la icoesfera de la
 * copa, que tapa los huecos del centro: lo que se ve es el contorno de hojas.
 */
function paintCrown(ctx: Ctx, R: { x: number; y: number; w: number; h: number }, r: Rng): void {
  const cx = R.x + R.w / 2;
  const cy = R.y + R.h * 0.52;
  const rad = R.w * 0.46;
  // Contorno irregular: radio que varía con el ángulo (lóbulos).
  const lobes = [r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28)];
  const edge = (a: number) =>
    rad * (0.82 + 0.1 * Math.sin(a * 3 + lobes[0]) + 0.06 * Math.sin(a * 5 + lobes[1]) + 0.04 * Math.sin(a * 9 + lobes[2]));
  // Ramitas que asoman entre las hojas.
  ctx.strokeStyle = rgb(78, 62, 46);
  for (let k = 0; k < 7; k++) {
    const a = r.range(0, Math.PI * 2);
    const e = edge(a) * r.range(0.55, 0.85);
    ctx.lineWidth = r.range(2, 4);
    ctx.beginPath();
    ctx.moveTo(cx, cy + rad * 0.3);
    ctx.lineTo(cx + Math.cos(a) * e, cy + Math.sin(a) * e);
    ctx.stroke();
  }
  const n = 1500;
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const a = r.range(0, Math.PI * 2);
    // Primero las del fondo (adentro, oscuras); al final las del borde y arriba.
    const d = Math.sqrt(r.range(0.04, 1)) * (0.55 + 0.45 * t);
    const e = edge(a);
    if (d > 1.02) continue;
    const x = cx + Math.cos(a) * e * d;
    const y = cy + Math.sin(a) * e * d * 0.92;
    const up = (cy - y) / rad; // > 0 arriba
    const g = (0.62 + 0.38 * t + 0.22 * up) * r.range(0.85, 1.12);
    const base = r.chance(0.25) ? [70, 112, 50] : r.chance(0.5) ? [58, 104, 46] : [64, 118, 58];
    const ang = a + r.range(-1.2, 1.2);
    const len = r.range(13, 24);
    leaf(ctx, x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5, ang, len, len * 0.42, rgb(base[0] * g, base[1] * g, base[2] * g), rgb(base[0] * g * 1.3, base[1] * g * 1.22, base[2] * g * 1.1, 0.45));
  }
}

/** Hoja lanceolada de `len` en la dirección `ang` (radianes, canvas), desde (x, y). */
function leaf(ctx: Ctx, x: number, y: number, ang: number, len: number, wid: number, fill: string, vein?: string): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const tip = [x + c * len, y + s * len];
  const nx = -s * wid;
  const ny = c * wid;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + c * len * 0.45 + nx, y + s * len * 0.45 + ny, tip[0], tip[1]);
  ctx.quadraticCurveTo(x + c * len * 0.45 - nx, y + s * len * 0.45 - ny, x, y);
  ctx.fill();
  if (vein) {
    ctx.strokeStyle = vein;
    ctx.lineWidth = Math.max(0.6, wid * 0.18);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + c * len * 0.85, y + s * len * 0.85);
    ctx.stroke();
  }
}

/**
 * Fronda de palmera (pinnada), con la base abajo. La tarjeta se estira ~2×
 * a lo largo (0,6–0,7 m de ancho por 2,8–3,3 m de largo en 256 × 512 px):
 * los folíolos van más tendidos en el canvas para quedar a ~50° en la hoja.
 */
function paintFrond(ctx: Ctx, R: { x: number; y: number; w: number; h: number }, r: Rng): void {
  const cx = R.x + R.w / 2;
  const top = R.y + 10;
  const bot = R.y + R.h - 4;
  const len = bot - top;
  // Raquis levemente curvo.
  const rach = (t: number) => cx + Math.sin(t * Math.PI) * 5 - t * 3;
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 64; k++) {
      const t = 0.06 + (k / 64) * 0.92;
      const y = bot - t * len;
      const x = rach(t);
      // Folíolos más largos a media hoja, cortos en la base y en la punta.
      const L = R.w * 0.48 * Math.sin(Math.min(1, t * 1.25) * Math.PI) ** 0.7 * r.range(0.86, 1.06);
      if (L < 6) continue;
      const side = i === 0 ? -1 : 1;
      // Hacia afuera y hacia la punta (arriba en el canvas).
      const ang = Math.atan2(-0.5 - r.range(-0.08, 0.08), side);
      const g = r.range(0.85, 1.12);
      const dry = r.chance(0.05);
      const fill = dry ? rgb(150 * g, 135 * g, 70 * g) : rgb(52 * g, 104 * g, 46 * g);
      leaf(ctx, x, y, ang, L, r.range(2.6, 3.6), fill, rgb(110 * g, 150 * g, 70 * g, 0.7));
    }
  }
  // Raquis encima de los folíolos.
  ctx.strokeStyle = rgb(118, 128, 72);
  for (let k = 0; k < 24; k++) {
    const t0 = k / 24;
    const t1 = (k + 1) / 24;
    ctx.lineWidth = 6.5 - t0 * 4.8;
    ctx.beginPath();
    ctx.moveTo(rach(t0), bot - t0 * len);
    ctx.lineTo(rach(t1), bot - t1 * len);
    ctx.stroke();
  }
}

/** Gramínea ornamental: abanico de hojas finas y algunas espigas claras. */
function paintGrass(ctx: Ctx, R: { x: number; y: number; w: number; h: number }, r: Rng): void {
  const bx = R.x + R.w / 2;
  const by = R.y + R.h - 3;
  for (let k = 0; k < 70; k++) {
    const sx = bx + r.range(-22, 22);
    const lean = r.range(-1, 1);
    const hgt = R.h * r.range(0.55, 0.95) * (1 - Math.abs(lean) * 0.25);
    const ex = sx + lean * R.w * 0.42;
    const ey = by - hgt;
    const g = r.range(0.8, 1.15);
    // Más secas las de afuera (el pasto ornamental del video, en verde 2050).
    const dry = Math.abs(lean) > 0.75 && r.chance(0.4);
    ctx.strokeStyle = dry ? rgb(170 * g, 158 * g, 96 * g) : rgb(70 * g, 128 * g, 58 * g);
    const steps = 8;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      // Curva: sube derecho y se abre arriba.
      const p = (t: number) => [sx + (ex - sx) * t * t, by + (ey - by) * t];
      const [x0, y0] = p(t0);
      const [x1, y1] = p(t1);
      ctx.lineWidth = 3.4 * (1 - t0) + 0.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  // Espigas: plumeros claros arriba.
  for (let k = 0; k < 9; k++) {
    const x = bx + r.range(-R.w * 0.3, R.w * 0.3);
    const y = R.y + R.h * r.range(0.06, 0.25);
    ctx.strokeStyle = rgb(206, 192, 140, 0.95);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 40);
    ctx.lineTo(x + r.range(-4, 4), y);
    ctx.stroke();
    for (let j = 0; j < 14; j++) {
      ctx.fillStyle = rgb(225 * r.range(0.9, 1), 210 * r.range(0.9, 1), 160, 0.9);
      ctx.beginPath();
      ctx.ellipse(x + r.range(-3, 3), y + j * 2.2, 2.2, 3, r.range(-0.4, 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Mata en domo (hojas anchas, oscuras abajo y claras arriba); con `flowers`,
 * hojas más chicas y racimos de flores.
 */
function paintMound(ctx: Ctx, R: { x: number; y: number; w: number; h: number }, r: Rng, flowers: boolean): void {
  const cx = R.x + R.w / 2;
  const by = R.y + R.h - 3;
  const rw = R.w * 0.46;
  const rh = R.h * 0.9;
  const n = flowers ? 150 : 95;
  for (let k = 0; k < n; k++) {
    // De abajo hacia arriba: las de arriba tapan a las de abajo.
    const t = k / n;
    const a = r.range(-Math.PI * 0.95, -Math.PI * 0.05);
    const rad = Math.sqrt(r.range(0.05, 1));
    const lift = 0.15 + 0.85 * t;
    const x = cx + Math.cos(a) * rw * rad * (0.6 + 0.4 * lift);
    const y = by + Math.sin(a) * rh * rad * lift;
    const ang = Math.atan2(y - by - 20, x - cx) + r.range(-0.6, 0.6);
    const len = (flowers ? r.range(16, 26) : r.range(26, 44)) * (0.8 + 0.3 * t);
    const g = (0.72 + 0.4 * t) * r.range(0.9, 1.1);
    const base = flowers ? [62, 118, 54] : r.chance(0.3) ? [58, 112, 66] : [66, 124, 52];
    leaf(ctx, x, y, ang, len, len * (flowers ? 0.3 : 0.34), rgb(base[0] * g, base[1] * g, base[2] * g), rgb(base[0] * g * 1.35, base[1] * g * 1.25, base[2] * g * 1.1, 0.55));
  }
  if (!flowers) return;
  const palette = [
    [236, 128, 168],
    [250, 246, 240],
    [246, 206, 72],
    [178, 136, 222],
    [232, 92, 120],
  ];
  for (let k = 0; k < 55; k++) {
    const a = r.range(-Math.PI * 0.92, -Math.PI * 0.08);
    const rad = Math.sqrt(r.range(0.1, 1));
    const x = cx + Math.cos(a) * rw * rad * 0.95;
    const y = by + Math.sin(a) * rh * rad * 0.92;
    const [pr, pg, pb] = palette[k % palette.length];
    const s = r.range(4.5, 7.5);
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2 + k;
      ctx.fillStyle = rgb(pr, pg, pb);
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(pa) * s * 0.55, y + Math.sin(pa) * s * 0.55, s * 0.55, s * 0.36, pa, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rgb(250, 214, 90);
    ctx.beginPath();
    ctx.arc(x, y, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Jardín vertical: hojas chicas apretadas en todo el paño, con pocas flores. */
function paintIvy(ctx: Ctx, R: { x: number; y: number; w: number; h: number }, r: Rng): void {
  // Fondo verde profundo (se ve entre las hojas: el paño no tiene agujeros grandes).
  ctx.fillStyle = rgb(34, 66, 38);
  ctx.fillRect(R.x + 2, R.y + 2, R.w - 4, R.h - 4);
  for (let k = 0; k < 520; k++) {
    const x = R.x + r.range(6, R.w - 6);
    const y = R.y + r.range(6, R.h - 6);
    const g = r.range(0.75, 1.2);
    const tone = r.pick([
      [64, 124, 56],
      [82, 140, 62],
      [52, 108, 70],
      [96, 150, 70],
    ]);
    const len = r.range(10, 18);
    leaf(ctx, x, y, r.range(0, Math.PI * 2), len, len * 0.42, rgb(tone[0] * g, tone[1] * g, tone[2] * g), rgb(tone[0] * g * 1.3, tone[1] * g * 1.2, tone[2] * g, 0.5));
  }
  for (let k = 0; k < 26; k++) {
    const x = R.x + r.range(10, R.w - 10);
    const y = R.y + r.range(10, R.h - 10);
    ctx.fillStyle = r.chance(0.5) ? rgb(240, 238, 228) : rgb(222, 120, 160);
    ctx.beginPath();
    ctx.arc(x, y, r.range(2, 3.4), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Red blanca de malla romboidal (los hilos, sin fondo). */
function paintNet(ctx: Ctx, R: { x: number; y: number; w: number; h: number }): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(R.x + 2, R.y + 2, R.w - 4, R.h - 4);
  ctx.clip();
  ctx.strokeStyle = rgb(246, 246, 240);
  ctx.lineWidth = 2.2;
  const step = 22;
  for (let k = -R.h; k < R.w + R.h; k += step) {
    ctx.beginPath();
    ctx.moveTo(R.x + k, R.y);
    ctx.lineTo(R.x + k + R.h, R.y + R.h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(R.x + k, R.y + R.h);
    ctx.lineTo(R.x + k + R.h, R.y);
    ctx.stroke();
  }
  // Borde: la relinga de la red.
  ctx.lineWidth = 4;
  ctx.strokeRect(R.x + 4, R.y + 4, R.w - 8, R.h - 8);
  ctx.restore();
}

/** Mulch de corteza: chips de tres marrones y algún brote verde. */
function paintMulch(ctx: Ctx, R: { x: number; y: number; w: number; h: number }, r: Rng): void {
  ctx.fillStyle = rgb(62, 44, 32);
  ctx.fillRect(R.x + 1, R.y + 1, R.w - 2, R.h - 2);
  for (let k = 0; k < 900; k++) {
    const g = r.range(0.7, 1.35);
    const tone = r.pick([
      [104, 72, 48],
      [128, 92, 60],
      [84, 58, 40],
    ]);
    ctx.fillStyle = rgb(tone[0] * g, tone[1] * g, tone[2] * g);
    ctx.save();
    ctx.translate(R.x + r.range(4, R.w - 4), R.y + r.range(4, R.h - 4));
    ctx.rotate(r.range(0, Math.PI));
    ctx.fillRect(-r.range(2, 6), -r.range(1, 2.5), r.range(4, 12), r.range(2, 5));
    ctx.restore();
  }
  for (let k = 0; k < 30; k++) {
    leaf(ctx, R.x + r.range(8, R.w - 8), R.y + r.range(8, R.h - 8), r.range(0, Math.PI * 2), r.range(5, 9), 2.2, rgb(84, 140, 64));
  }
}
