/**
 * ¿Soporta este navegador sesiones VR inmersivas?
 *
 * Vive en su propio archivo, separado de `XRSetup`, por una razón concreta de
 * tamaño de descarga: no importa nada de Babylon, así que se puede consultar
 * ANTES de decidir si vale la pena cargar todo el módulo de WebXR. Si estuviera
 * dentro de `XRSetup`, preguntar "¿hay visor?" obligaría a descargar el soporte
 * de VR completo aunque la respuesta fuera que no.
 */
export async function isVrSupported(): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  // No ocultar la entrada solo porque el sondeo previo respondió false o
  // rechazó la promesa: algunos navegadores Quest informan la disponibilidad
  // real recién al intentar requestSession desde el toque del usuario.
  return Boolean(xr);
}
