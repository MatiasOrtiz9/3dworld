/**
 * Teclas ya usadas por alguien en este mismo evento.
 *
 * Varias piezas escuchan el teclado en `window` (el jugador, el HUD, el
 * director). La que actúa marca el evento acá y las demás lo ignoran: así
 * la misma `E` que abre un diálogo no lo hace avanzar en el mismo cuadro.
 * No se usa `defaultPrevented` porque el controlador del jugador cancela
 * todas las teclas mientras está en pausa.
 */
const consumed = new WeakSet<Event>();

export function consume(e: Event): void {
  consumed.add(e);
  e.preventDefault();
}

export function isConsumed(e: Event): boolean {
  return consumed.has(e);
}

/** ¿El foco está en un campo de texto o un control que necesita las teclas? */
export function typingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}
