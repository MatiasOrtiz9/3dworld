/**
 * Mandos virtuales del jugador (celular): lo que escriben los joysticks y
 * botones táctiles y lee `PlayerController` junto con el teclado.
 *
 * Vive fuera del controlador porque el controlador se reconstruye al cambiar
 * la calidad y los controles táctiles no: los dos comparten este objeto.
 */
export class VirtualInput {
  /** Lateral, −1 (izquierda) a 1 (derecha). Analógico: a medio recorrido, medio paso. */
  x = 0;
  /** Avance, −1 (atrás) a 1 (adelante). */
  y = 0;
  /** Correr (o, volando, ir rápido). */
  run = false;
  /** Volando: subir (1) o bajar (−1). */
  rise = 0;
  /** Momento del último toque de salto (ms, `performance.now()`); 0 si no hay. */
  private jumpAt = 0;

  /** Margen para un salto tocado justo antes de tocar el piso: se siente que respondió. */
  static readonly JUMP_BUFFER_MS = 160;

  /** Toque del botón de salto. */
  pressJump(now = performance.now()): void {
    this.jumpAt = now;
  }

  /** ¿Hay un salto pendiente? Lo consume: un toque, un salto. */
  takeJump(now = performance.now()): boolean {
    if (this.jumpAt === 0) return false;
    const fresh = now - this.jumpAt <= VirtualInput.JUMP_BUFFER_MS;
    if (fresh) this.jumpAt = 0;
    return fresh;
  }

  /** Suelta todo (pausa, diálogo, teléfono vertical). */
  reset(): void {
    this.x = 0;
    this.y = 0;
    this.run = false;
    this.rise = 0;
    this.jumpAt = 0;
  }
}
