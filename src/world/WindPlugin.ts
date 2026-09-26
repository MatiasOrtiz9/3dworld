import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Nullable } from '@babylonjs/core/types';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/**
 * Viento en el follaje.
 *
 * Desplaza los vértices en el VERTEX SHADER, no moviendo objetos desde
 * JavaScript. La diferencia es decisiva: la ciudad tiene ~6.000 copias de
 * follaje en *thin instances* con buffer estático; reescribir esas matrices en
 * cada cuadro significaría recalcular y volver a subir 6.000 matrices 60 veces
 * por segundo. En el shader, el mismo efecto cuesta unas pocas instrucciones
 * por vértice y no toca la CPU.
 *
 * Tres detalles que hacen que se lea como viento y no como vibración:
 *
 *  - **El desplazamiento crece con la altura del vértice** dentro de su copa.
 *    La base casi no se mueve; la parte de arriba sí. Es lo que hace que la
 *    masa parezca tener una rama que la sostiene.
 *  - **La fase depende de la posición en el mundo**, que se lee de la matriz de
 *    instancia (`world3.xz`). Sin esto, todos los árboles de la ciudad se
 *    mecerían al unísono, que es inmediatamente antinatural.
 *  - **Dos ondas de frecuencias distintas** superpuestas. Una sola senoidal se
 *    lee como un metrónomo; dos que no son múltiplos entre sí producen un
 *    movimiento que nunca se repite igual.
 */
export class WindPlugin extends MaterialPluginBase {
  /** Amplitud en metros a la altura máxima de la copa. */
  strength = 0.16;
  /** Velocidad del oleaje. */
  speed = 1.1;
  private time = 0;

  constructor(material: Material) {
    // El nombre debe ser único por material; 120 es la prioridad (después del
    // procesamiento base), y `true` lo deja activo desde el principio.
    super(material, 'Wind', 120, { WIND: true }, true);
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
      ],
      vertex: `
        uniform float windTime;
        uniform float windStrength;
      `,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('windTime', this.time * this.speed);
    uniformBuffer.updateFloat('windStrength', this.strength);
  }

  override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType !== 'vertex') return null;

    return {
      // Se engancha justo antes de que la posición pase al espacio de mundo,
      // así el desplazamiento respeta la rotación y escala de cada instancia.
      CUSTOM_VERTEX_UPDATE_POSITION: `
        #ifdef INSTANCES
          // Posición de la copia en el mundo, para desfasar cada árbol.
          //
          // Sale de world3: Babylon arma la matriz como
          // mat4(world0, world1, world2, world3), es decir COLUMNA por columna,
          // así que la traslación vive en la cuarta columna (world3.xyz). Una
          // versión anterior leía world0.w y world2.w —la convención de
          // fila— y todos los árboles compartían la misma fase.
          vec2 windAnchor = vec2(world3.x, world3.z);
        #else
          vec2 windAnchor = vec2(0.0, 0.0);
        #endif

        // Sólo se mueve la parte alta de la pieza. positionUpdated.y va de
        // -0.5 a 0.5 en las primitivas unitarias, así que se normaliza a 0..1
        // y se eleva al cuadrado para que la base quede prácticamente quieta.
        float windH = clamp(positionUpdated.y + 0.5, 0.0, 1.0);
        windH = windH * windH;

        float windPhase = (windAnchor.x + windAnchor.y) * 0.08;
        // Dos frecuencias que no son múltiplos: el patrón no se repite.
        float windWave =
            sin(windTime + windPhase) * 0.65
          + sin(windTime * 1.73 + windPhase * 1.31) * 0.35;

        // El viento sopla en diagonal, constante para toda la ciudad.
        positionUpdated.x += windWave * windH * windStrength;
        positionUpdated.z += windWave * windH * windStrength * 0.55;
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
   */
  override prepareDefines(defines: Record<string, unknown>): void {
    defines.WIND = true;
  }

  override isCompatible(): boolean {
    return true;
  }

}
