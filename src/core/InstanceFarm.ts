import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';

export type Primitive = 'box' | 'cylinder' | 'cone' | 'sphere' | 'plane' | 'blob' | 'blobHi';

/**
 * Granja de instancias finas (thin instances).
 *
 * Esta clase es el corazón del rendimiento del proyecto. En vez de crear una
 * malla por cada ventana, árbol o panel solar —lo que daría decenas de miles de
 * draw calls y haría imposible el VR—, registramos UNA malla unitaria por cada
 * combinación de primitiva + material, y acumulamos matrices de transformación.
 *
 * Resultado: la ciudad entera se dibuja en la cantidad de draw calls que hay
 * combinaciones primitiva/material (típicamente 20-40), sin importar si hay
 * 5.000 o 50.000 objetos.
 *
 * Uso:
 *   farm.add('box', mat, pos, size);   // muchas veces
 *   farm.commit();                     // una vez, al final
 */
export class InstanceFarm {
  private readonly farms = new Map<
    string,
    { mesh: Mesh; matrices: number[]; count: number }
  >();
  private committed = false;

  constructor(private readonly scene: Scene) {}

  /**
   * Agrega una copia.
   * @param pos    centro del objeto (para 'box' y 'plane' el centro geométrico)
   * @param size   escala en cada eje
   * @param rotY   rotación sobre el eje vertical, en radianes
   */
  add(
    prim: Primitive,
    material: Material,
    pos: Vector3,
    size: Vector3,
    rotY = 0,
    rotX = 0,
    rotZ = 0,
  ): void {
    if (this.committed) {
      throw new Error('InstanceFarm: no se puede agregar después de commit()');
    }
    const key = `${prim}|${material.name}`;
    let farm = this.farms.get(key);
    if (!farm) {
      farm = { mesh: this.createSource(prim, key, material), matrices: [], count: 0 };
      this.farms.set(key, farm);
    }

    const q = Quaternion.FromEulerAngles(rotX, rotY, rotZ);
    const m = Matrix.Compose(size, q, pos);
    // Babylon espera las matrices en orden columna-mayor plano.
    for (let i = 0; i < 16; i++) farm.matrices.push(m.m[i]);
    farm.count++;
  }

  /** Atajo para cajas alineadas apoyadas en el suelo (lo más común en una ciudad). */
  addBoxOnGround(
    material: Material,
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    groundY = 0,
    rotY = 0,
  ): void {
    this.add(
      'box',
      material,
      new Vector3(x, groundY + height / 2, z),
      new Vector3(width, height, depth),
      rotY,
    );
  }

  /** Sube todos los buffers a la GPU. Se llama una sola vez. */
  commit(): void {
    if (this.committed) return;
    for (const farm of this.farms.values()) {
      if (farm.count === 0) {
        farm.mesh.dispose();
        continue;
      }
      const buffer = new Float32Array(farm.matrices);
      // staticBuffer = true: prometemos no volver a modificarlo, la GPU lo aloja mejor.
      farm.mesh.thinInstanceSetBuffer('matrix', buffer, 16, true);
      // Con staticBuffer hay que recalcular el bounding a mano. Si no se hace,
      // el volumen de la malla sigue siendo la primitiva unitaria en el origen
      // y el generador de sombras descarta toda la ciudad: no se ve ni una sombra.
      farm.mesh.thinInstanceRefreshBoundingInfo(true);
      farm.mesh.freezeWorldMatrix();
      farm.matrices.length = 0; // liberamos la copia en JS
    }
    this.committed = true;
  }

  /** Cantidad de draw calls que va a costar la ciudad. */
  get drawCalls(): number {
    let n = 0;
    for (const farm of this.farms.values()) if (farm.count > 0) n++;
    return n;
  }

  /** Cantidad total de objetos instanciados. */
  get instanceCount(): number {
    let n = 0;
    for (const farm of this.farms.values()) n += farm.count;
    return n;
  }

  /** Triángulos reales enviados al rasterizador. */
  get triangleCount(): number {
    let n = 0;
    for (const farm of this.farms.values()) {
      if (farm.count === 0) continue;
      n += (farm.mesh.getTotalIndices() / 3) * farm.count;
    }
    return n;
  }

  /**
   * Activa o desactiva todos los grupos cuyo material empiece con ese prefijo.
   *
   * Sirve para conmutar variantes generadas de antemano —por ejemplo las
   * ventanas encendidas— sin tocar materiales ya congelados ni reconstruir
   * nada. Como todas las copias de un mismo material comparten UNA malla
   * fuente, encender miles de ventanas es cambiar un booleano.
   */
  setGroupEnabled(materialPrefix: string, enabled: boolean): void {
    for (const [key, farm] of this.farms) {
      if (farm.count > 0 && key.includes(materialPrefix)) farm.mesh.setEnabled(enabled);
    }
  }

  /** Mallas fuente, para registrarlas en el generador de sombras. */
  get sourceMeshes(): Mesh[] {
    return [...this.farms.values()].filter((f) => f.count > 0).map((f) => f.mesh);
  }

  /**
   * Desglose de coste por combinación primitiva/material, ordenado por
   * triángulos. Es la herramienta para saber QUÉ optimizar en vez de adivinar.
   */
  breakdown(): Array<{ key: string; instances: number; trisEach: number; tris: number }> {
    const rows = [...this.farms.entries()]
      .filter(([, f]) => f.count > 0)
      .map(([key, f]) => {
        const trisEach = f.mesh.getTotalIndices() / 3;
        return { key, instances: f.count, trisEach, tris: trisEach * f.count };
      });
    return rows.sort((a, b) => b.tris - a.tris);
  }

  dispose(): void {
    for (const farm of this.farms.values()) farm.mesh.dispose();
    this.farms.clear();
    this.committed = false;
  }

  // --- primitivas unitarias, centradas en el origen ---
  private createSource(prim: Primitive, name: string, material: Material): Mesh {
    let mesh: Mesh;
    switch (prim) {
      case 'box':
        mesh = CreateBox(name, { size: 1 }, this.scene);
        break;
      case 'cylinder':
        // 6 lados: un tronco o una columna no necesitan mas, y baja de 40 a 24 tris.
        mesh = CreateCylinder(name, { height: 1, diameter: 1, tessellation: 6 }, this.scene);
        break;
      case 'cone':
        // Cono de 6 lados: suficiente para una copa de árbol vista a distancia.
        mesh = CreateCylinder(
          name,
          { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 6 },
          this.scene,
        );
        break;
      case 'sphere':
        mesh = CreateSphere(name, { diameter: 1, segments: 8 }, this.scene);
        break;
      case 'blobHi':
        // 80 triángulos. Se reserva para las copas GRANDES y cercanas, donde
        // las facetas de la versión barata se notan y el árbol se lee como un
        // cristal. Es un LOD decidido por tamaño en vez de por distancia:
        // funciona porque la ciudad es estática y los árboles grandes son
        // pocos comparados con arbustos y relleno.
        mesh = CreateIcoSphere(name, { radius: 0.5, subdivisions: 2, flat: false }, this.scene);
        break;
      case 'blob':
        // Icoesfera de subdivisión 1: un icosaedro de SOLO 20 triángulos.
        // Es la pieza clave del presupuesto: la esfera UV de 4 segmentos que
        // usábamos antes costaba 144 tris, y con ~8.000 copias de follaje se
        // comía el 84 % de la escena. Además, facetada se ve mejor: lee como
        // una decisión estilística en vez de como una esfera mal teselada.
        // flat:false promedia las normales entre caras. Con los MISMOS 20
        // triángulos, la copa pasa de leerse como un cristal facetado a leerse
        // como una masa redondeada. Es la mejora visual más barata del proyecto:
        // cuesta cero triángulos.
        mesh = CreateIcoSphere(name, { radius: 0.5, subdivisions: 1, flat: false }, this.scene);
        break;
      case 'plane':
        mesh = CreatePlane(name, { size: 1 }, this.scene);
        break;
    }
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }
}
