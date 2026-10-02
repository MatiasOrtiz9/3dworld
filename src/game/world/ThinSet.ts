import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Color3 } from '@babylonjs/core/Maths/math.color';

/**
 * Conjunto de thin instances de UNA malla unitaria, con color por instancia
 * y buffer dinámico. Es el patrón de `InstanceFarm`/`Life` (un draw call por
 * malla, sin importar cuántas copias) aplicado a lo que el juego mueve:
 * hojas de puerta, la campana, el robot, la pelota, los marcadores.
 *
 * Las mallas se marcan `alwaysSelectAsActiveMesh`: las copias están
 * repartidas por toda la escuela y mantener su volumen envolvente al día
 * costaría más que el recorte que ahorraría (son pocas instancias).
 */
export class ThinSet {
  private matrices: Float32Array;
  private colors: Float32Array;
  private count = 0;
  private dirtyM = false;
  private dirtyC = false;
  private static readonly tmpM = new Matrix();
  private static readonly tmpQ = new Quaternion();
  private static readonly tmpS = new Vector3();
  private static readonly tmpT = new Vector3();

  constructor(
    readonly mesh: Mesh,
    private capacity: number,
  ) {
    this.matrices = new Float32Array(capacity * 16);
    this.colors = new Float32Array(capacity * 4);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    mesh.thinInstanceCount = 0;
    // Apagada hasta tener copias: si el material se compilara con cero
    // instancias, quedaría sin el color por instancia (el bloqueo de
    // materiales "sucios" de la escena impide recompilarlo después).
    mesh.setEnabled(false);
  }

  get size(): number {
    return this.count;
  }

  /** Agrega una instancia (oculta hasta que se le dé una pose). Devuelve su índice. */
  add(color: Color3, alpha = 1): number {
    if (this.count >= this.capacity) this.grow();
    const i = this.count++;
    this.colors.set([color.r, color.g, color.b, alpha], i * 4);
    this.matrices.fill(0, i * 16, i * 16 + 16);
    this.dirtyM = true;
    this.dirtyC = true;
    return i;
  }

  private grow(): void {
    this.capacity = Math.max(8, this.capacity * 2);
    const m = new Float32Array(this.capacity * 16);
    m.set(this.matrices);
    const c = new Float32Array(this.capacity * 4);
    c.set(this.colors);
    this.matrices = m;
    this.colors = c;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
  }

  /** Pose: posición, giro (yaw, y opcionalmente pitch/roll) y escala por eje. */
  set(i: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, pitch = 0, roll = 0): void {
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, ThinSet.tmpQ);
    ThinSet.tmpS.set(sx, sy, sz);
    ThinSet.tmpT.set(x, y, z);
    Matrix.ComposeToRef(ThinSet.tmpS, ThinSet.tmpQ, ThinSet.tmpT, ThinSet.tmpM);
    this.matrices.set(ThinSet.tmpM.m, i * 16);
    this.dirtyM = true;
  }

  /** Pose con una matriz ya armada. */
  setMatrix(i: number, m: Matrix): void {
    this.matrices.set(m.m, i * 16);
    this.dirtyM = true;
  }

  /** Oculta una instancia (escala cero: no se dibuja nada, el buffer no cambia de tamaño). */
  hide(i: number): void {
    this.matrices.fill(0, i * 16, i * 16 + 16);
    this.dirtyM = true;
  }

  color(i: number, c: Color3, alpha = 1): void {
    const o = i * 4;
    if (this.colors[o] === c.r && this.colors[o + 1] === c.g && this.colors[o + 2] === c.b && this.colors[o + 3] === alpha) return;
    this.colors[o] = c.r;
    this.colors[o + 1] = c.g;
    this.colors[o + 2] = c.b;
    this.colors[o + 3] = alpha;
    this.dirtyC = true;
  }

  /** Vacía el conjunto (para listas que se rearman cada cuadro, como los marcadores). */
  clear(): void {
    if (this.count === 0) return;
    this.count = 0;
    this.dirtyM = true;
  }

  /** Agrega una instancia con pose y color en un solo paso. */
  put(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, color: Color3, alpha = 1, pitch = 0, roll = 0): number {
    if (this.count >= this.capacity) this.grow();
    const i = this.count++;
    const o = i * 4;
    this.colors[o] = color.r;
    this.colors[o + 1] = color.g;
    this.colors[o + 2] = color.b;
    this.colors[o + 3] = alpha;
    this.dirtyC = true;
    this.set(i, x, y, z, yaw, sx, sy, sz, pitch, roll);
    return i;
  }

  /** Sube a la GPU sólo lo que cambió. Llamar una vez por cuadro. */
  flush(): void {
    if (this.mesh.thinInstanceCount !== this.count) this.mesh.thinInstanceCount = this.count;
    if (this.dirtyM) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      this.dirtyM = false;
    }
    if (this.dirtyC) {
      this.mesh.thinInstanceBufferUpdated('color');
      this.dirtyC = false;
    }
    this.mesh.setEnabled(this.count > 0);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
