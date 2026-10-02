/**
 * ¿Soporta este navegador sesiones VR inmersivas?
 *
 * Vive en su propio archivo, separado de `XRSetup`, por una razón concreta de
 * tamaño de descarga: no importa nada de Babylon, así que se puede consultar
 * ANTES de decidir si vale la pena cargar todo el módulo de WebXR. Si estuviera
 * dentro de `XRSetup`, preguntar "¿hay visor?" obligaría a descargar el soporte
 * de VR completo aunque la respuesta fuera que no.
 */
/** Navegador de un visor (Quest, Pico, Wolvic): ahí siempre se ofrece entrar. */
export function isHeadsetBrowser(): boolean {
  return /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
}

export async function isVrSupported(): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) return false;
  // En un visor no se oculta la entrada aunque el sondeo previo responda
  // false o rechace la promesa: algunos navegadores Quest informan la
  // disponibilidad real recién al intentar requestSession desde el toque del
  // usuario (comprobado en el visor).
  if (isHeadsetBrowser()) return true;
  // En una computadora sí se pregunta: Chrome expone navigator.xr aunque no
  // haya ningún visor conectado, y el botón invitaría a una VR que no existe.
  try {
    return (await xr.isSessionSupported('immersive-vr')) ?? false;
  } catch {
    return false;
  }
}
