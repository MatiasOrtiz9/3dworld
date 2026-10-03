/**
 * Frases del juego: diálogos, comentarios al pasar, voces, entrevistas y lo
 * que dicen los personajes dentro de los guiones y las actividades.
 *
 * El usuario pidió un juego callado ("no quiero que nadie me hable, así que
 * sacá todas las frases; capaz más adelante agregamos"): por defecto nadie
 * dice nada. Saludar a alguien aplica, sin una sola línea, lo que esa charla
 * hacía avanzar (`StoryEngine.silentTalk`), así que la historia se juega
 * igual de punta a punta.
 *
 * Todo el texto sigue en `dialogues.ts`, `characters.ts` y las actividades:
 * para recuperarlo tal como estaba alcanza con poner `FRASES = true`, o abrir
 * la página con `?frases=1` (`?frases=0` fuerza el modo callado aunque la
 * constante esté encendida).
 */
export const FRASES = false;

/** Lo que pide la dirección de la página (`?frases=1|0`); sin el parámetro, la constante. */
export function phrasesFromQuery(params: URLSearchParams): boolean {
  const v = params.get('frases');
  if (v === '1') return true;
  if (v === '0') return false;
  return FRASES;
}
