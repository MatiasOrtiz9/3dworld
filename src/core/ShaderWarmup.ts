import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

export interface WarmupResult {
  /** Mallas listas (material y sombras compilados) al terminar. */
  ready: number;
  total: number;
  ms: number;
}

/**
 * Compila los shaders de TODA la escena antes de mostrarla, en paralelo.
 *
 * Se llama al final de la construcción, con la gente, los autos y el juego
 * ya creados. Le pregunta a cada malla habilitada `isReady(true)`, el mismo
 * chequeo que hace el render: arma los defines reales de esa malla (thin
 * instances, sombras, plugins) y, si falta el programa, lo manda a compilar.
 * Con `KHR_parallel_shader_compile` (Chrome, el navegador del Quest) los
 * programas se compilan en hilos del driver y acá sólo se consulta si
 * terminaron, un cuadro tras otro, hasta que estén todos o se acabe el
 * presupuesto.
 *
 * Reemplaza a `City.precompile`, que llamaba `forceCompilationAsync` sin
 * instancias: compilaba una variante que la granja no usa (todas sus mallas
 * son thin instances), tardaba ~1 s de pantalla de carga y los ~20 programas
 * reales se compilaban igual en los primeros cuadros de juego, con tirones de
 * hasta un cuarto de segundo justo al aparecer la escuela.
 *
 * El presupuesto es duro (ver HANDOFF, 5.7): con render por software un solo
 * PBR tardó ~45 s. Lo que no llegue se compila cuando entre en cuadro, como
 * antes.
 */
export async function warmUpShaders(
  scene: Scene,
  budgetMs: number,
  onProgress?: (done: number, total: number) => void,
): Promise<WarmupResult> {
  const t0 = performance.now();
  const meshes = scene.meshes.filter(
    (m: AbstractMesh) => m.isEnabled() && m.material !== null && m.subMeshes?.length > 0 && m.getTotalVertices() > 0,
  ) as Mesh[];
  // Gente, autos y pájaros arrancan con cero copias y se llenan en el primer
  // cuadro. Babylon elige la variante con thin instances por la cantidad
  // vigente (`hasThinInstances`): con cero compilaría la que nunca se usa.
  // Mientras se compila, una copia (el bucle de render todavía no corre).
  const empty = meshes.filter((m) => m.thinInstanceCount === 0 && hasThinBuffer(m));
  for (const m of empty) m.thinInstanceCount = 1;
  let pending = meshes;
  try {
    for (;;) {
      pending = pending.filter((m) => !m.isReady(true));
      onProgress?.(meshes.length - pending.length, Math.max(1, meshes.length));
      if (pending.length === 0 || performance.now() - t0 > budgetMs) break;
      // Cede el hilo: el driver compila mientras tanto y la barra se pinta.
      await new Promise((r) => setTimeout(r, 16));
    }
  } finally {
    for (const m of empty) m.thinInstanceCount = 0;
  }
  return { ready: meshes.length - pending.length, total: meshes.length, ms: Math.round(performance.now() - t0) };
}

/** Malla con buffer de thin instances (aunque ahora tenga cero copias). */
function hasThinBuffer(mesh: Mesh): boolean {
  const storage = (mesh as Mesh & { _thinInstanceDataStorage?: { matrixData: Float32Array | null } })
    ._thinInstanceDataStorage;
  return Boolean(storage?.matrixData);
}
