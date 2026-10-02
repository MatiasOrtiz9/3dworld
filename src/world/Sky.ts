import type { Scene } from '@babylonjs/core/scene';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Nullable } from '@babylonjs/core/types';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TileableNoise } from './ProceduralNoise';
import type { AtmospherePreset, Rgb } from './TimeOfDay';

/**
 * Cielo procedural estilizado.
 *
 * Reemplaza al SkyMaterial de Babylon (Rayleigh/Mie) por tres razones:
 *
 *  1. **Control de dirección de arte.** El modelo físico da un cielo
 *     correcto pero siempre igual: no deja pedir "horizonte con bruma cálida,
 *     cénit azul profundo y nubes suaves" por preajuste. Este sí.
 *  2. **El horizonte ES la niebla.** El color del horizonte y el de la niebla
 *     salen del mismo número (lineal), así el suelo lejano se funde con el
 *     cielo sin la línea que dejaba el SkyMaterial.
 *  3. **Mismo color en escritorio y en el visor.** El SkyMaterial aplica su
 *     propio mapeo tonal y DESPUÉS el de la escena: el cielo salía distinto
 *     con y sin post-proceso. Acá el cielo entrega radiancia lineal y el mapeo
 *     tonal (ACES) es el mismo que el del resto de la escena.
 *
 * Técnica: un StandardMaterial con `disableLighting` al que un plugin le
 * reemplaza el color. Así hereda gratis el procesado de imagen de Babylon en
 * sus dos variantes (dentro del material en VR, en post-proceso en
 * escritorio). Las nubes son UNA textura de ruido periódico de 256² proyectada
 * sobre un plano alto: tres lecturas de textura por píxel de cielo, en vez de
 * ruido calculado en el shader, que en un visor autónomo costaría caro.
 *
 * El cubo se dibuja siempre en el plano lejano (z = w): nunca recorta a lo
 * que está detrás ni lo recorta el plano lejano de la cámara, sea cual sea el
 * tamaño del mundo o el perfil de calidad. El defecto anterior —un cubo de
 * 8 × extent con esquinas más allá del plano lejano de VR— mostraba una cuña
 * celeste en el cielo.
 */
export class SkyDome {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly plugin: SkyPlugin;
  private readonly clouds: DynamicTexture;
  private readonly tick: Nullable<Observer<Scene>>;

  constructor(private readonly scene: Scene) {
    this.clouds = createCloudTexture(scene);

    const mat = new StandardMaterial('skyDome', scene);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.fogEnabled = false;
    // Nunca escribe profundidad: cualquier cosa, a cualquier distancia, se
    // dibuja delante del cielo.
    mat.disableDepthWrite = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.White();
    this.plugin = new SkyPlugin(mat, this.clouds);
    this.material = mat;

    // El tamaño no importa para la imagen (el color sale de la dirección de
    // vista y la profundidad se fuerza al fondo); sí para la sonda de IBL, que
    // mira desde su propio punto: 1 km deja el error de dirección por debajo
    // de unos pocos grados aunque la cámara esté en la otra punta del barrio.
    this.mesh = CreateBox('skyBox', { size: 1000 }, scene);
    this.mesh.material = mat;
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.mesh.receiveShadows = false;
    // Envuelve siempre a la cámara: no tiene sentido gastar el recorte.
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;

    // Deriva lenta de las nubes. Es comportamiento en tiempo de ejecución
    // (no generación), así que no afecta al determinismo de la ciudad.
    this.tick = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
      this.plugin.advance(dt);
    });
  }

  /** Aplica una atmósfera completa (la llama Environment al cambiar la hora). */
  set(p: AtmospherePreset, toSun: { x: number; y: number; z: number }): void {
    this.plugin.configure(p, toSun);
  }

  /**
   * Durante la captura de la sonda de IBL el cielo entrega radiancia lineal
   * cruda, sin mapeo tonal y sin disco solar (el sol ya lo pone la luz
   * direccional; sumarlo al IBL lo contaría dos veces).
   */
  set probeMode(on: boolean) {
    this.plugin.probe = on;
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    this.mesh.dispose();
    this.material.dispose(true, true);
    this.clouds.dispose();
  }
}

/** Plugin que convierte el StandardMaterial del cubo en cielo. */
class SkyPlugin extends MaterialPluginBase {
  probe = false;
  private time = 0;
  private readonly sun = [0, 1, 0];
  private zenith: Rgb = [0.1, 0.25, 0.6];
  private horizon: Rgb = [0.7, 0.75, 0.8];
  private ground: Rgb = [0.3, 0.28, 0.25];
  private sunColor: Rgb = [1, 1, 1];
  private cloudLit: Rgb = [1, 1, 1];
  private cloudShade: Rgb = [0.6, 0.65, 0.75];
  private shape = [0.5, 0.6, 1, 30];
  private cloud = [0.45, 0.85, 1, 0];

  constructor(
    material: Material,
    private readonly clouds: BaseTexture,
  ) {
    // El sexto argumento (enable) es el que ACTIVA el plugin: sin él queda
    // registrado, su define aparece en el shader y sin embargo su código no
    // se inyecta ni se llama a bindForSubMesh.
    super(material, 'Sky', 200, { SKYDOME: true }, true, true);
  }

  override getClassName(): string {
    return 'SkyPlugin';
  }

  advance(dt: number): void {
    this.time += dt;
  }

  configure(p: AtmospherePreset, toSun: { x: number; y: number; z: number }): void {
    this.sun[0] = toSun.x;
    this.sun[1] = toSun.y;
    this.sun[2] = toSun.z;
    this.zenith = p.zenith;
    this.horizon = p.horizon;
    // Debajo del horizonte: el rebote del suelo, para que el IBL ilumine
    // desde abajo con un tono de tierra y no con cielo azul.
    this.ground = [
      p.hemiGround[0] * 0.9 + p.horizon[0] * 0.1,
      p.hemiGround[1] * 0.9 + p.horizon[1] * 0.1,
      p.hemiGround[2] * 0.9 + p.horizon[2] * 0.1,
    ];
    this.sunColor = p.sunColor;
    this.cloudLit = p.cloudLit;
    this.cloudShade = p.cloudShade;
    // shape: x exponente del degradado, y bruma, z halo, w brillo del disco.
    this.shape = [0.42, p.haze, p.sunGlow, 26 * Math.max(0.25, p.sunIntensity / 2.5)];
    // cloud: x umbral de cobertura, y suavidad, z opacidad, w (libre).
    this.cloud = [1 - p.cloudCover * 0.95, 0.2, 0.92, 0];
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'skySun', size: 4, type: 'vec4' },
        { name: 'skyZenith', size: 3, type: 'vec3' },
        { name: 'skyHorizon', size: 3, type: 'vec3' },
        { name: 'skyGround', size: 3, type: 'vec3' },
        { name: 'skySunColor', size: 3, type: 'vec3' },
        { name: 'skyCloudLit', size: 3, type: 'vec3' },
        { name: 'skyCloudShade', size: 3, type: 'vec3' },
        { name: 'skyShape', size: 4, type: 'vec4' },
        { name: 'skyCloud', size: 4, type: 'vec4' },
      ],
      fragment: `
        uniform vec4 skySun;
        uniform vec3 skyZenith;
        uniform vec3 skyHorizon;
        uniform vec3 skyGround;
        uniform vec3 skySunColor;
        uniform vec3 skyCloudLit;
        uniform vec3 skyCloudShade;
        uniform vec4 skyShape;
        uniform vec4 skyCloud;
      `,
    };
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('skyCloudSampler');
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    activeTextures.push(this.clouds);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.clouds;
  }

  override isReadyForSubMesh(): boolean {
    return this.clouds.isReady();
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    // skySun.w: reloj de la deriva de nubes, y en negativo "modo sonda".
    uniformBuffer.updateFloat4('skySun', this.sun[0], this.sun[1], this.sun[2], this.probe ? -1 : this.time);
    uniformBuffer.updateFloat3('skyZenith', ...this.zenith);
    uniformBuffer.updateFloat3('skyHorizon', ...this.horizon);
    uniformBuffer.updateFloat3('skyGround', ...this.ground);
    uniformBuffer.updateFloat3('skySunColor', ...this.sunColor);
    uniformBuffer.updateFloat3('skyCloudLit', ...this.cloudLit);
    uniformBuffer.updateFloat3('skyCloudShade', ...this.cloudShade);
    uniformBuffer.updateFloat4('skyShape', this.shape[0], this.shape[1], this.shape[2], this.shape[3]);
    uniformBuffer.updateFloat4('skyCloud', this.cloud[0], this.cloud[1], this.cloud[2], this.cloud[3]);
    uniformBuffer.setTexture('skyCloudSampler', this.clouds);
  }

  override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType === 'vertex') {
      return {
        // Al fondo del búfer de profundidad: ver el comentario de SkyDome.
        CUSTOM_VERTEX_MAIN_END: `
          gl_Position.z = gl_Position.w * 0.99999;
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        uniform sampler2D skyCloudSampler;

        float skyHash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        // Radiancia lineal del cielo en una dirección. Devuelve en .a la
        // cobertura de nubes, que tapa el disco solar.
        vec4 skyRadiance(vec3 dir, float clock) {
          float h = dir.y;
          float up = max(h, 0.0);
          float mu = dot(dir, skySun.xyz);
          float toward = max(mu, 0.0);

          // Degradado cénit-horizonte: el exponente < 1 deja el azul
          // profundo arriba y una franja ancha y clara abajo.
          vec3 sky = mix(skyHorizon, skyZenith, pow(up, skyShape.x));

          // Bruma: blanquea y calienta el horizonte, más del lado del sol
          // (dispersión hacia adelante). Es lo que da profundidad atmosférica.
          float hazeBand = exp(-up * 7.0) * skyShape.y;
          sky = mix(sky, skyHorizon + skySunColor * pow(toward, 3.0) * 0.35, hazeBand);

          // Halo del sol: ancho y suave + núcleo cercano.
          sky += skySunColor * (pow(toward, 8.0) * 0.35 + pow(toward, 64.0) * 1.2) * skyShape.z;

          // Nubes: plano alto, curvado hacia el horizonte (dir.y + 0,16).
          float cover = 0.0;
          if (h > 0.0) {
            vec2 drift = vec2(clock * 0.0016, clock * 0.0007);
            vec2 uv = dir.xz / (h + 0.16) * 0.22 + drift;
            float n = texture2D(skyCloudSampler, uv).r * 0.68
                    + texture2D(skyCloudSampler, uv * 2.6 + vec2(0.37, 0.11)).r * 0.32;
            cover = smoothstep(skyCloud.x, skyCloud.x + skyCloud.y, n);
            // Autosombreado barato: densidad un paso hacia el sol. Si hay más
            // nube hacia el sol, esta parte está en sombra.
            float nSun = texture2D(skyCloudSampler, uv + skySun.xz * 0.018).r;
            float shade = clamp(0.55 + (n - nSun) * 3.2, 0.0, 1.0);
            vec3 lit = mix(skyCloudShade, skyCloudLit, shade);
            // Borde plateado a contraluz.
            lit += skySunColor * pow(toward, 10.0) * (1.0 - cover) * 1.4;
            // Las nubes lejanas se disuelven en la bruma.
            float fade = smoothstep(0.0, 0.22, h);
            cover *= fade * skyCloud.z;
            sky = mix(sky, mix(skyHorizon, lit, fade), cover);
          }

          // Bajo el horizonte: de la niebla al rebote del suelo.
          sky = mix(sky, skyGround, smoothstep(0.0, -0.2, h));
          return vec4(sky, cover);
        }
      `,
      CUSTOM_FRAGMENT_BEFORE_FOG: `
        vec3 skyDir = normalize(vPositionW - vEyePosition.xyz);
        bool skyProbePass = skySun.w < 0.0;
        vec4 skyRad = skyRadiance(skyDir, max(skySun.w, 0.0));
        vec3 skyLinear = skyRad.rgb;
        if (!skyProbePass) {
          // Disco solar en HDR: el bloom lo hace brillar en escritorio y el
          // mapeo tonal lo deja blanco cálido en el visor.
          float mu = dot(skyDir, skySun.xyz);
          float disk = smoothstep(0.99955, 0.99978, mu) * (1.0 - skyRad.a * 0.85);
          skyLinear += skySunColor * disk * skyShape.w;
        }
        // El material estándar trabaja en espacio gamma y pasa a lineal
        // antes del procesado de imagen: se entrega en gamma para que la
        // vuelta deje exactamente la radiancia calculada.
        color.rgb = pow(max(skyLinear, vec3(0.0)), vec3(1.0 / 2.2));
        // Tramado contra el bandeo de los degradados (se nota mucho en VR).
        color.rgb += (skyHash(gl_FragCoord.xy) - 0.5) / 255.0;
        color.a = 1.0;
      `,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        // En la sonda de IBL va la radiancia lineal cruda, sin mapeo tonal:
        // es luz, no imagen. Sin esto, en el visor (procesado dentro del
        // material) el IBL recibía colores de pantalla leídos como lineales
        // y la iluminación ambiente salía el doble de fuerte.
        if (skyProbePass) {
          color = vec4(skyLinear, 1.0);
        }
      `,
    };
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.SKYDOME = true;
  }

  override isCompatible(): boolean {
    return true;
  }
}

/**
 * Textura de nubes: ruido fractal periódico de 256², en escala de grises.
 *
 * Determinista (semilla fija) y sin costura, porque el plano de nubes la
 * repite muchas veces hacia el horizonte. La forma "algodonosa" sale de
 * elevar el ruido a una potencia: las crestas quedan redondas y los valles se
 * abren en cielo limpio.
 */
function createCloudTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture('skyClouds', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const image = ctx.createImageData(size, size);
  const noise = new TileableNoise(0xc10d5, 8);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 8;
      const v = (y / size) * 8;
      // Un dominio levemente deformado: rompe la grilla del ruido de valor.
      const wu = u + noise.noise(u + 3.1, v) * 1.2;
      const wv = v + noise.noise(u, v + 7.3) * 1.2;
      const n = noise.fbm(wu, wv, 4);
      const puff = Math.pow(Math.min(1, Math.max(0, (n - 0.18) / 0.72)), 1.25);
      const g = Math.round(puff * 255);
      const i = (y * size + x) * 4;
      image.data[i] = g;
      image.data[i + 1] = g;
      image.data[i + 2] = g;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;
  return tex;
}
