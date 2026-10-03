import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Nullable } from '@babylonjs/core/types';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/**
 * Luminancia del horizonte de la mañana (TimeOfDay, `[0,72, 0,78, 0,86]`):
 * con ese cielo el relleno de la copa vale exactamente el color de la hoja.
 */
const SKY_REF = 0.77;

/**
 * Viento y "piel" del follaje.
 *
 * Desplaza los vértices en el VERTEX SHADER, no moviendo objetos desde
 * JavaScript. La diferencia es decisiva: el follaje son miles de copias en
 * *thin instances* con buffer estático; reescribir esas matrices en cada
 * cuadro significaría recalcular y volver a subir todas 72 veces por segundo
 * en el visor. En el shader cuesta unas pocas instrucciones por vértice y no
 * toca la CPU.
 *
 * Lo que hace que se lea como viento (y en el visor, como un lugar vivo) y no
 * como vibración ni como gelatina:
 *
 *  - **Desplazamiento en el MUNDO, no en la pieza.** Antes se sumaba en el
 *    espacio de la primitiva unitaria: la escala de la copa lo multiplicaba
 *    (0,16 de la pieza eran 80 cm en una copa de 5 m) y la rotación al azar
 *    de cada masa lo mandaba para otro lado, así que las masas de un mismo
 *    árbol se movían cada una por su cuenta. Ahora todo el barrio se mece en
 *    la dirección del viento, con amplitud proporcional al tamaño de la pieza.
 *  - **Copa casi rígida, arbusto anclado.** Una masa que cuelga de un tronco
 *    se mueve entera (con algo más de vaivén arriba); un arbusto en el suelo
 *    o una jardinera deja la base quieta. Las cajas (frondas de palmera,
 *    enredaderas, macetas: `WINDHANG`) cuelgan: arriba quietas, abajo libres.
 *  - **Ráfagas que viajan.** Dos frentes lentos de distinta dirección
 *    recorren la ciudad a ~6 m/s: los árboles de una cuadra se inclinan uno
 *    detrás del otro, que es lo que el ojo reconoce como viento.
 *  - **Hojas que tiemblan.** Un temblor rápido y chico (2 cm) a lo largo de
 *    la normal, con fase por vértice: de cerca la silueta de la copa titila
 *    como hojas, sin un triángulo más.
 *  - **Fase según la posición en el mundo** (de la matriz de instancia): sin
 *    eso todos los árboles se mecerían al unísono.
 *
 * Y en el fragmento, la "piel" que saca a las copas del verde plástico plano:
 * racimos de hojas y huecos más oscuros (ruido en metros, que se apaga con
 * la distancia para no centellear), parches del color secundario de la
 * especie (flores lilas entre hojas verdes en el jacarandá), la panza de la
 * copa más oscura que la cara que mira al cielo, y un tinte sutil por árbol
 * (más cálido o más frío, más claro u oscuro) para que dos árboles con el
 * mismo material no sean idénticos. Todo dentro del mismo draw call.
 *
 * Por último, el relleno de cielo y la luz que atraviesa las hojas (ver
 * `leafFill` más abajo): sin eso, la panza de la copa vista desde abajo
 * —caminando bajo los árboles de la vereda o en el patio— era una mancha
 * verde negruzca contra el cielo claro.
 */
export class WindPlugin extends MaterialPluginBase {
  /** Amplitud del vaivén por metro de tamaño de la pieza. */
  strength = 0.04;
  /** Velocidad del reloj del viento. */
  speed = 1;
  private time = 0;
  /**
   * Color secundario como cociente del principal (rgb) y cuánto se mezcla (a).
   * En el verde, un verde más amarillo en los racimos; en las flores, las
   * hojas que asoman entre ellas.
   */
  private readonly second: [number, number, number, number];
  /**
   * Tono del relleno de cielo: el color de la hoja llevado a luminancia 1 y
   * un poco desaturado (ver el constructor).
   */
  private readonly fillHue: [number, number, number];

  constructor(
    material: Material,
    second: readonly [number, number, number, number] = [1, 1, 1, 0],
    /**
     * Profundidad de los huecos entre racimos (1: la del verde). Las flores
     * llevan menos: el emisivo del follaje se suma en espacio gamma y el
     * producto se estira al pasar a lineal, así que un hueco que en el verde
     * es sombra suave en una copa lila se leía como manchas de leopardo.
     */
    private readonly gap = 1,
    /**
     * Color propio de la hoja (el del material, sin compensar), para el
     * relleno de cielo y la translucidez. Por omisión, un verde medio.
     */
    albedo: readonly [number, number, number] = [0.27, 0.5, 0.35],
  ) {
    // El nombre debe ser único por material; 120 es la prioridad (después del
    // procesamiento base). Los dos `true` son distintos y hacen falta los
    // dos: el primero registra el plugin en el material, el segundo lo
    // ACTIVA. Con sólo el primero —como estaba— el define WIND llegaba al
    // shader (su valor por omisión es true) pero Babylon no inyectaba el
    // código ni llamaba a bindForSubMesh: el follaje no se movía y la prueba
    // que mira el define pasaba igual.
    super(material, 'Wind', 120, { WIND: true, WINDHANG: false }, true, true);
    this.second = [second[0], second[1], second[2], second[3]];
    // El relleno lleva el TONO de la hoja, no su brillo: proporcional al
    // color, la panza de las especies claras (plátano, tipa: verde pálido)
    // se encendía en verde lima casi tan claro como el cielo, y la del verde
    // profundo salía esmeralda. Con la luminancia fija, todas suben lo mismo
    // y la diferencia de especie la sigue poniendo el emisivo. Casi a mitad
    // de camino hacia el gris: la luz de cielo que rebota en la hoja no es
    // tan saturada, y los verdes azulados (el del patio) tienen el rojo en el
    // pie del ACES y la gradación del visor: con el tono puro, la panza
    // salía verde esmeralda. Y algo más en las especies oscuras: su panza
    // parte más abajo, donde la misma suma rinde menos (medido en el visor:
    // con el mismo relleno, el verde del patio quedaba en 51 y el claro de
    // la vereda en 61-82).
    const l = Math.max(0.05, 0.2126 * albedo[0] + 0.7152 * albedo[1] + 0.0722 * albedo[2]);
    const dark = 1 - 0.6 * Math.min(1, l);
    const hue = (c: number): number => (0.55 * (c / l) + 0.45) * dark;
    this.fillHue = [hue(albedo[0]), hue(albedo[1]), hue(albedo[2])];
  }

  override getClassName(): string {
    return 'WindPlugin';
  }

  /** Avanza el reloj del viento. Lo llama la escena una vez por cuadro. */
  tick(deltaSeconds: number): void {
    this.time += deltaSeconds;
  }

  /** Reloj actual, en segundos. Lo consulta la prueba de viento. */
  get clock(): number {
    return this.time;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'windTime', size: 1, type: 'float' },
        { name: 'windStrength', size: 1, type: 'float' },
        { name: 'leafSecond', size: 4, type: 'vec4' },
        { name: 'leafGap', size: 1, type: 'float' },
        { name: 'leafFill', size: 3, type: 'vec3' },
      ],
      vertex: `
        uniform float windTime;
        uniform float windStrength;
      `,
      fragment: `
        uniform vec4 leafSecond;
        uniform float leafGap;
        uniform vec3 leafFill;
      `,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene): void {
    uniformBuffer.updateFloat('windTime', this.time * this.speed);
    uniformBuffer.updateFloat('windStrength', this.strength);
    const s = this.second;
    uniformBuffer.updateFloat4('leafSecond', s[0], s[1], s[2], s[3]);
    uniformBuffer.updateFloat('leafGap', this.gap);
    // Relleno de cielo: el tono de la hoja teñido por el del horizonte (la
    // niebla, que TimeOfDay pone en el color del cielo bajo de cada hora).
    // Así acompaña la hora sin que nadie lo avise: a la mañana, verde apenas
    // frío; al atardecer, más cálido y más tenue (el horizonte del ocaso
    // tiene la mitad de luz). Normalizado al horizonte de la mañana.
    const f = scene.fogColor;
    const h = this.fillHue;
    uniformBuffer.updateFloat3('leafFill', (h[0] * f.r) / SKY_REF, (h[1] * f.g) / SKY_REF, (h[2] * f.b) / SKY_REF);
  }

  override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
          #ifdef WIND
          varying vec4 vLeaf;
          #endif
        `,
        // Después de calcular worldPos y vNormalW y antes de proyectar: el
        // desplazamiento queda en metros del mundo y vale para los dos ojos.
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
          #ifdef WIND
          // Posición en reposo, para la sombra (ver la regla de abajo).
          vec4 wRest = worldPos;
          {
            // Centro de la pieza: la traslación de su matriz (Babylon arma
            // finalWorld columna por columna; la cuarta es la posición).
            vec3 wA = finalWorld[3].xyz;
            // Medio alto de la pieza en el mundo (caja unitaria girada y
            // escalada): de ahí su tamaño y la altura relativa del vértice.
            float wExt = 0.5 * (abs(finalWorld[0].y) + abs(finalWorld[1].y) + abs(finalWorld[2].y));
            float wSize = max(2.0 * wExt, 0.05);
            float wv = clamp((worldPos.y - (wA.y - wExt)) / wSize, 0.0, 1.0);

            vec2 wDir = vec2(0.86, 0.51);
            float wt = windTime;
            // Ráfagas: dos frentes lentos que recorren el barrio.
            float gA = sin(dot(wA.xz, wDir) * 0.06 - wt * 0.37);
            float gB = sin(dot(wA.xz, vec2(-0.42, 0.91)) * 0.033 - wt * 0.21 + 1.3);
            float gust = clamp(0.5 + 0.5 * (gA * 0.65 + gB * 0.35), 0.0, 1.0);
            gust = 0.28 + 0.72 * gust * gust * (3.0 - 2.0 * gust);

            float ph = dot(wA.xz, vec2(0.13, 0.09));
            float osc = sin(wt * 1.3 + ph) * 0.6 + sin(wt * 2.17 + ph * 1.7) * 0.4;
            float flut = sin(wt * 7.3 + dot(worldPos.xyz, vec3(2.3, 1.9, 2.7))) * 0.6
                       + sin(wt * 11.1 + dot(worldPos.xyz, vec3(-3.1, 2.6, 1.7))) * 0.4;

            #ifdef WINDHANG
              // Cuelga: arriba quieta, la punta libre.
              float ww = (1.0 - wv) * (1.0 - wv);
              // Las fajas de enredadera de la torre (tres pisos) casi no se
              // mueven: pegadas a la fachada, un vaivén grande las despegaba.
              float amp = windStrength * 1.6 * min(wSize, 2.5) * (1.0 - 0.7 * smoothstep(3.0, 6.0, wSize));
              float side = amp * ww * (0.45 * gust + osc * (0.35 + 0.65 * gust));
              worldPos.xz += wDir * side;
              worldPos.y += flut * 0.03 * (0.4 + 0.6 * gust) * ww;
              float wAO = 1.0;
            #else
              // Copa sobre un tronco (la base de la pieza bien arriba del
              // piso): se mueve casi entera. Arbusto: base quieta.
              float elevated = smoothstep(0.4, 1.6, wA.y - wExt);
              float ww = mix(wv * wv, 0.55 + 0.45 * wv, elevated);
              float amp = windStrength * clamp(wSize, 0.6, 5.0);
              float push = amp * ww * (0.45 * gust + osc * (0.35 + 0.65 * gust));
              worldPos.xz += wDir * push;
              // Un poco de vaivén cruzado: el recorrido es un ocho, no un péndulo.
              worldPos.xz += vec2(-wDir.y, wDir.x) * amp * ww * 0.25 * gust * sin(wt * 1.71 + ph * 2.3);
              worldPos.xyz += vNormalW * flut * 0.022 * (0.4 + 0.6 * gust) * (0.3 + 0.7 * wv);
              // La panza de cada masa, más oscura (sombra propia de la copa).
              float wAO = mix(0.9, 1.04, wv);
            #endif

            // Tinte por árbol: celdas de 4 m (las masas de un mismo árbol
            // caen casi siempre en la misma), más cálido o más frío y más
            // claro u oscuro, siempre sutil.
            vec2 wCell = floor(wA.xz * 0.25);
            float h1 = fract(sin(dot(wCell, vec2(12.9898, 78.233))) * 43758.5453);
            float h2 = fract(sin(dot(wCell, vec2(39.3468, 11.135))) * 24634.6345);
            vec3 wTint = vec3(1.0 + (h1 - 0.5) * 0.16, 1.0 + (h2 - 0.5) * 0.06, 1.0 - (h1 - 0.5) * 0.14);
            vLeaf = vec4(wTint * (0.93 + 0.12 * h2), wAO);
          }
          #endif
        `,
        // La sombra se busca con la posición EN REPOSO. El mapa de sombras
        // se dibuja sin viento (y en el visor, una sola vez): con la copa
        // mecida y el temblor de 2 cm a lo largo de la normal, cada vértice
        // entraba y salía de la sombra de su propia masa y las copas al sol
        // se llenaban de manchas oscuras que, encima, caminaban. Se restaura
        // después de proyectar y de fijar vPositionW: lo que sigue (sombras
        // y distancia de niebla) usa el reposo, a menos de 20 cm del real.
        '!vPositionW=vec3\\(worldPos\\);': `
          vPositionW=vec3(worldPos);
          #ifdef WIND
          worldPos = wRest;
          #endif
        `,
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef WIND
        varying vec4 vLeaf;
        #endif
      `,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
        #ifdef WIND
        // Racimo/hueco de este píxel, para el relleno de cielo (más abajo).
        float leafPat = 1.0;
        {
          vec3 lp = vPositionW;
          // Racimos de ~30 cm: se apagan entre 14 y 40 m, donde ya no se
          // resuelven y sólo centellearían (sobre todo en el visor). De lejos
          // queda una variación suave de parches de ~1,5 m: con contraste
          // fuerte a esa escala la copa se leía como ropa de camuflaje.
          float lFade = 1.0 - smoothstep(14.0, 40.0, length(vEyePosition.xyz - lp));
          // Suma (no producto) de tres ondas planas en direcciones que no se
          // alinean, sobre coordenadas deformadas: manchas cuasi aleatorias.
          // Con el producto de senos de antes salía un damero (la copa
          // parecía una tela estampada).
          // Más finos y de borde más blando que los primeros (×2,6, borde de
          // 0,7): a 5-10 m, en el visor, una copa grande se leía estampada
          // de manchas de leopardo y no como hojas.
          vec3 lq = lp * 3.2 + sin(lp.yzx * 1.3 + 0.7) * 0.55;
          float lFine = (sin(dot(lq, vec3(1.0, 0.31, 0.67)) * 3.1)
                       + sin(dot(lq, vec3(-0.43, 0.89, 0.29)) * 2.7 + 1.9)
                       + sin(dot(lq, vec3(0.37, -0.52, 0.91)) * 3.4 + 4.1)) * 0.4;
          vec3 lr = lp * 0.55 + sin(lp.zxy * 0.4) * 0.8;
          float lBig = (sin(dot(lr, vec3(0.83, 0.42, -0.37)) * 2.3) + sin(dot(lr, vec3(-0.29, 0.61, 0.74)) * 1.9 + 2.3)) * 0.5;
          float cF = smoothstep(-0.55, 0.65, lFine);
          float cB = smoothstep(-0.6, 0.6, lBig);
          float clump = mix(cB, cF, lFade);
          vec3 lSecond = mix(vec3(1.0), leafSecond.rgb, leafSecond.a * (1.0 - clump) * mix(0.45, 1.0, lFade));
          // Huecos entre racimos, más oscuros de cerca.
          float lGap = 1.0 + (mix(0.96 + 0.08 * cB, 0.88 + 0.22 * cF, lFade) - 1.0) * leafGap;
          // Lo que mira al cielo, más claro; la panza, más oscura. Los tres
          // factores promedian ~1: la copa gana modelado sin perder el brillo
          // medio calibrado (ver Materials.foliage y HANDOFF 11).
          float lUp = mix(0.9, 1.08, smoothstep(-0.8, 0.9, normalW.y));
          baseColor.rgb *= vLeaf.rgb * lSecond * (lGap * lUp * vLeaf.a);
          leafPat = lGap;
        }
        #endif
      `,
      // Relleno de cielo y translucidez, SUMADOS al final (antes de la
      // niebla, que los cubre igual que al resto de la copa).
      //
      // La panza de la copa no recibe sol y la hemisférica de la escena es
      // casi nula (la ciudad es PBR y vive del IBL): sólo le quedaba el
      // emisivo, sumado en gamma y achicado por la propia panza (×0,81) y los
      // huecos. Al pasar a lineal y por el ACES (el pie de la curva hunde los
      // oscuros) medía luminancia 25-35 contra un cielo de 150: desde abajo,
      // caminando bajo los árboles de la vereda o en el patio, se veía una
      // mancha verde negruzca. Una copa real vista desde abajo es lo más
      // claro del árbol después del cielo: el cielo la ilumina por los
      // costados y el sol la atraviesa (hoja fina, luz verde amarillenta).
      //
      // - Cielo: todo lo que no mira hacia arriba recibe un poco (las caras
      //   de arriba ya tienen el sol y el emisivo; sumarles más volvía al
      //   "plástico pálido" de HANDOFF 11).
      // - Translucidez: crece hacia las caras que miran al suelo, con un
      //   tinte más amarillo.
      //
      // Va casi sin el dibujo de racimos (sólo un 35 %): el emisivo ya lo
      // lleva multiplicado y un relleno parejo baja el contraste relativo de
      // la panza, que en el pie del ACES se estiraba en manchas de leopardo.
      // Calibrado en el visor (gradación en el material): panza de 25-35 a
      // ~65-75 de luminancia; vista aérea y copas al sol, casi iguales.
      CUSTOM_FRAGMENT_BEFORE_FOG: `
        #ifdef WIND
        {
          float fDown = clamp(-normalW.y, 0.0, 1.0);
          float fSky = 1.0 - smoothstep(0.2, 0.85, normalW.y);
          // Luminancia sumada (gamma), para el verde profundo: 0,04 de cielo
          // en lo que no mira hacia arriba y hasta 0,125 de translucidez,
          // verde amarillenta, en lo que mira al suelo (las especies claras,
          // un 25 % menos: ver el constructor).
          vec3 fLight = vec3(0.048) * fSky + vec3(0.188, 0.15, 0.083) * fDown;
          color.rgb += leafFill * vLeaf.rgb * fLight * mix(1.0, leafPat, 0.35);
        }
        #endif
      `,
    };
  }

  /**
   * Activa el define en cada preparación del shader.
   *
   * Esto NO es opcional y el error es fácil de cometer: pasar `{ WIND: true }`
   * al constructor sólo REGISTRA el nombre del define; quien tiene que ponerlo
   * en true es este método. Con un override vacío —como estaba— el plugin
   * queda instalado, el shader compila sin una sola queja y no desplaza ni un
   * vértice. Lo detectó la prueba que comprueba que el define llegue al efecto
   * compilado, no la que mira si la imagen cambia: esa pasaba igual porque los
   * pájaros y la gente se mueven.
   *
   * `WINDHANG`: las cajas de follaje (frondas, enredaderas, macetas) cuelgan
   * en vez de apoyarse. Los defines son por malla: cada primitiva de la
   * granja es su propia malla.
   */
  override prepareDefines(defines: Record<string, unknown>, _scene: Scene, mesh: AbstractMesh): void {
    defines.WIND = true;
    defines.WINDHANG = mesh.name.startsWith('box|');
  }

  override isCompatible(): boolean {
    return true;
  }
}
