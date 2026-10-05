import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

export type Primitive = 'box' | 'post' | 'cylinder' | 'cylinderHi' | 'cone' | 'sphere' | 'plane' | 'blob' | 'blobHi';

/**
 * Zona de una copia según su caja en el mundo (centro y medio lado por eje).
 * 0 es "el resto": lo que no se puede esconder por zonas. Ver `setPartition`.
 */
export type ZoneOf = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => number;

/** Un trozo de una malla de la granja: las copias de una zona. */
export interface FarmChunk {
  readonly mesh: Mesh;
  readonly zone: number;
  readonly tris: number;
}

/**
 * Una combinación primitiva/material partida en zonas. La malla `global`
 * (todas las copias, la de siempre) sigue existiendo: es la que proyecta
 * sombra y la que conviene dibujar cuando casi todo está a la vista; los
 * trozos son las mismas copias repartidas, para esconder las que no se ven.
 */
export interface FarmPart {
  readonly key: string;
  readonly global: Mesh;
  readonly tris: number;
  readonly chunks: readonly FarmChunk[];
}

/**
 * Agrupa las copias por zona. Las zonas con menos de `minTris` triángulos
 * van al resto (0): un trozo es un draw call y no vale la pena por una
 * maceta. Devuelve null si todo quedó en el resto (no hay nada que partir).
 */
export function groupByZone(zones: ArrayLike<number>, trisEach: number, minTris: number): Map<number, number[]> | null {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    let g = groups.get(z);
    if (!g) groups.set(z, (g = []));
    g.push(i);
  }
  const rest = groups.get(0) ?? [];
  for (const [z, g] of groups) {
    if (z !== 0 && g.length * trisEach < minTris) {
      for (const i of g) rest.push(i);
      groups.delete(z);
    }
  }
  if (rest.length) groups.set(0, rest.sort((a, b) => a - b));
  else groups.delete(0);
  if (groups.size === 1 && groups.has(0)) return null;
  return groups;
}

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
    { mesh: Mesh; prim: Primitive; matrices: number[]; count: number }
  >();
  private committed = false;
  private zoneOf: ZoneOf | null = null;
  private minChunkTris = 60;
  private readonly partsList: FarmPart[] = [];

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
    // Los postes conservan el prefijo de las cajas: `Materials` les da la UV
    // métrica (y el resto del código los trata como cajas) por el nombre.
    const key = prim === 'post' ? `box|post|${material.name}` : `${prim}|${material.name}`;
    let farm = this.farms.get(key);
    if (!farm) {
      farm = { mesh: this.createSource(prim, key, material), prim, matrices: [], count: 0 };
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

  /**
   * Partición espacial (antes de `commit`): cada copia va a la zona que diga
   * `zoneOf` y, además de la malla de siempre, se arma una malla por zona con
   * sus copias. Sin esto el volumen de cada malla es la ciudad entera y la
   * cámara nunca descarta nada: un baño cerrado pagaba los pupitres de toda
   * la escuela. Quién decide qué trozos se dibujan es `ZoneCulling`.
   */
  setPartition(zoneOf: ZoneOf, minChunkTris = 60): void {
    if (this.committed) throw new Error('InstanceFarm: la partición va antes de commit()');
    this.zoneOf = zoneOf;
    this.minChunkTris = minChunkTris;
  }

  /** Combinaciones partidas en zonas (vacío sin `setPartition`). */
  get parts(): readonly FarmPart[] {
    return this.partsList;
  }

  /** Sube todos los buffers a la GPU. Se llama una sola vez. */
  commit(): void {
    if (this.committed) return;
    for (const [key, farm] of this.farms) {
      if (farm.count === 0) {
        farm.mesh.dispose();
        continue;
      }
      const buffer = new Float32Array(farm.matrices);
      if (this.zoneOf) this.split(key, farm.mesh, farm.prim, buffer, farm.count);
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

  /** Arma los trozos de una combinación (ver `setPartition`). */
  private split(key: string, global: Mesh, prim: Primitive, buffer: Float32Array, count: number): void {
    const zoneOf = this.zoneOf!;
    // Medio lado de la caja de cada copia: la primitiva unitaria mide 1 (las
    // copas abolladas sobresalen hasta un 20 %).
    const k = prim === 'blob' || prim === 'blobHi' ? 0.6 : 0.5;
    const zones = new Int32Array(count);
    const b = buffer;
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      zones[i] = zoneOf(
        b[o + 12],
        b[o + 13],
        b[o + 14],
        k * (Math.abs(b[o]) + Math.abs(b[o + 4]) + Math.abs(b[o + 8])),
        k * (Math.abs(b[o + 1]) + Math.abs(b[o + 5]) + Math.abs(b[o + 9])),
        k * (Math.abs(b[o + 2]) + Math.abs(b[o + 6]) + Math.abs(b[o + 10])),
      );
    }
    const trisEach = global.getTotalIndices() / 3;
    const groups = groupByZone(zones, trisEach, this.minChunkTris);
    if (!groups) return;
    const geometry = global.geometry;
    const material = global.material;
    if (!geometry || !material) return;
    const chunks: FarmChunk[] = [];
    for (const [zone, idx] of groups) {
      // Comparte la geometría y el material de la malla de siempre: mismo
      // shader (el nombre conserva el prefijo que leen los complementos de
      // `Materials`), ningún programa nuevo que compilar.
      const mesh = new Mesh(`${key}@${zone}`, this.scene);
      geometry.applyToMesh(mesh);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      const sub = new Float32Array(idx.length * 16);
      for (let n = 0; n < idx.length; n++) sub.set(b.subarray(idx[n] * 16, idx[n] * 16 + 16), n * 16);
      mesh.thinInstanceSetBuffer('matrix', sub, 16, true);
      // Con búfer estático, el volumen se recalcula a mano (HANDOFF 5.1):
      // acá es justamente lo que permite descartar el trozo.
      mesh.thinInstanceRefreshBoundingInfo(true);
      mesh.freezeWorldMatrix();
      // Arranca escondido: hasta que `ZoneCulling` decida, se dibuja la de siempre.
      mesh.isVisible = false;
      chunks.push({ mesh, zone, tris: trisEach * idx.length });
    }
    this.partsList.push({ key, global, tris: trisEach * count, chunks });
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
    for (const part of this.partsList) {
      if (part.key.includes(materialPrefix)) for (const c of part.chunks) c.mesh.setEnabled(enabled);
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
    for (const part of this.partsList) for (const c of part.chunks) c.mesh.dispose();
    this.partsList.length = 0;
    for (const farm of this.farms.values()) farm.mesh.dispose();
    this.farms.clear();
    this.committed = false;
    this.zoneOf = null;
  }

  // --- primitivas unitarias, centradas en el origen ---
  private createSource(prim: Primitive, name: string, material: Material): Mesh {
    let mesh: Mesh;
    switch (prim) {
      case 'box':
        mesh = CreateBox(name, { size: 1 }, this.scene);
        break;
      case 'post':
        // Caja sin la cara de abajo (10 triángulos, no 12): patas, barrotes y
        // parantes que apoyan en el piso, un muro o un zócalo, donde esa cara
        // nunca se ve. Las patas de las sillas son ~1.500 copias y la granja
        // no descarta instancias sueltas: se pagaban en todas las vistas.
        mesh = CreateBox(name, { size: 1 }, this.scene);
        dropBottom(mesh);
        break;
      case 'cylinder':
        // 6 lados: un tronco o una columna no necesitan mas, y baja de 40 a 24 tris.
        mesh = CreateCylinder(name, { height: 1, diameter: 1, tessellation: 6 }, this.scene);
        break;
      case 'cylinderHi':
        // 10 lados (40 tris): lo redondo que se ve a un metro (mesas
        // redondas, matafuegos, piletas, columnas). Con 6 lados una mesa
        // redonda era un hexágono. Mapeo de textura: como el cilindro
        // (`Materials`, mapeo propio de cilindros y conos).
        mesh = CreateCylinder(name, { height: 1, diameter: 1, tessellation: 10 }, this.scene);
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
        mesh = CreateIcoSphere(name, { radius: 0.5, subdivisions: 3, flat: false }, this.scene);
        lumpy(mesh, 0.16);
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
        //
        // Con el barrio chico (unas 800 copas, no 8.000) alcanza para 80
        // triángulos abollados: la silueta deja de ser un poliedro y se lee
        // como follaje — racimos de hojas que sobresalen — sin texturas.
        mesh = CreateIcoSphere(name, { radius: 0.5, subdivisions: 2, flat: false }, this.scene);
        lumpy(mesh, 0.2);
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

/** Quita los triángulos que miran hacia abajo (la base de una caja). */
function dropBottom(mesh: Mesh): void {
  const idx = mesh.getIndices();
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!idx || !nrm) return;
  const keep: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (nrm[idx[i] * 3 + 1] < -0.5) continue;
    keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  mesh.setIndices(keep);
}

/**
 * Abolla una esfera unitaria: cada vértice se aleja o se acerca al centro
 * según un ruido suave de su dirección. Determinista (todas las copas comparten
 * la malla; la variedad la ponen la escala y la rotación de cada instancia).
 */
function lumpy(mesh: Mesh, amount: number): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const idx = mesh.getIndices();
  if (!pos || !idx) return;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    const l = Math.hypot(x, y, z) || 1;
    const nx = x / l;
    const ny = y / l;
    const nz = z / l;
    // Tres octavas de senos cruzados: bultos grandes y algunos chicos.
    const n =
      Math.sin(nx * 5.1 + ny * 2.3) * Math.cos(nz * 4.7 - nx * 1.3) * 0.55 +
      Math.sin(ny * 9.3 + nz * 7.1 + 1.7) * 0.3 +
      Math.cos(nx * 13.7 - nz * 11.9 + ny * 3.1) * 0.15;
    // La base se aplana un poco: las copas reales cuelgan menos por debajo.
    const flatten = ny < -0.35 ? 0.88 : 1;
    const r = 0.5 * (1 + n * amount) * flatten;
    pos[i] = nx * r;
    pos[i + 1] = ny * r;
    pos[i + 2] = nz * r;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  // La icoesfera repite vértices en las costuras: sin soldar las normales
  // cada cara queda con la suya y la copa se ve facetada como un cristal.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  for (const g of groups.values()) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const i of g) {
      nx += normals[i];
      ny += normals[i + 1];
      nz += normals[i + 2];
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const i of g) {
      normals[i] = nx / l;
      normals[i + 1] = ny / l;
      normals[i + 2] = nz / l;
    }
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, pos);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals);
  mesh.refreshBoundingInfo();
}
