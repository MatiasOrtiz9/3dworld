import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

/**
 * Sube a la GPU el color por instancia de las primeras `count` copias.
 *
 * `thinInstanceBufferUpdated('color')` sube el búfer ENTERO (la capacidad: la
 * gente reserva lugar para toda la multitud y dibuja unas decenas), mientras
 * que el de matrices ya se limita a `thinInstanceCount`. Acá, lo mismo para
 * el color: en un lote de 180 lugares con 30 dibujados, 6 veces menos bytes
 * por cuadro y por pieza. Sin el búfer (no debería pasar), lo de siempre.
 */
export function uploadThinColors(mesh: Mesh, data: Float32Array, count: number): void {
  const vb = mesh.getVertexBuffer(VertexBuffer.ColorInstanceKind);
  // `_buffer` es el Buffer de Babylon detrás del VertexBuffer (tipado público):
  // su `updateDirectly` acepta cuántas copias subir.
  if (vb && vb.isUpdatable() && count > 0) vb._buffer.updateDirectly(data, 0, count);
  else mesh.thinInstanceBufferUpdated('color');
}
