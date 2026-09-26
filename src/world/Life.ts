import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { CityPlan } from './CityLayout';
import { Rng } from '../utils/rng';

interface Tram {
  axis: 'x' | 'z';
  at: number;
  pos: number;
  dir: 1 | -1;
  speed: number;
  /** Segundos que lleva detenido en una parada; 0 = en movimiento. */
  stopped: number;
}

interface Bird {
  cx: number;
  cz: number;
  radius: number;
  height: number;
  angle: number;
  speed: number;
  bobPhase: number;
}

/**
 * Lo que se mueve en la ciudad.
 *
 * Una ciudad perfectamente quieta se lee como una maqueta, por buena que sea la
 * iluminación. El movimiento es lo que hace que el cerebro la acepte como un
 * lugar. Y en una ciudad sin autos, lo que se mueve son los tranvías, la gente
 * y los pájaros.
 *
 * Todo se dibuja con *thin instances* de buffer dinámico: los ~40 pájaros son
 * UN draw call y una sola subida de matrices por cuadro, no 40 objetos con sus
 * 40 llamadas.
 */
export class Life {
  private readonly trams: Tram[] = [];
  private readonly birds: Bird[] = [];

  private tramBody!: Mesh;
  private tramGlass!: Mesh;
  private birdMesh!: Mesh;

  private tramBodyBuf!: Float32Array;
  private tramGlassBuf!: Float32Array;
  private birdBuf!: Float32Array;

  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly plan: CityPlan,
    seed: number,
  ) {
    const rng = new Rng(seed ^ 0x1f1f);
    this.createTrams(rng);
    this.createBirds(rng);
    this.scene.onBeforeRenderObservable.add(this.update);
  }

  // --------------------------------------------------------------- tranvías

  private createTrams(rng: Rng): void {
    const avenues = this.plan.streets.filter((s) => s.tram);

    for (const av of avenues) {
      // Uno o dos tranvías por avenida, en sentidos opuestos.
      const count = rng.chance(0.55) ? 2 : 1;
      for (let i = 0; i < count; i++) {
        this.trams.push({
          axis: av.axis,
          at: av.at,
          pos: rng.range(-this.plan.extent, this.plan.extent),
          dir: i === 0 ? 1 : -1,
          speed: rng.range(7, 11), // ~25-40 km/h, velocidad real de tranvía urbano
          stopped: 0,
        });
      }
    }

    const bodyMat = new PBRMetallicRoughnessMaterial('tramBody', this.scene);
    bodyMat.baseColor = Color3.FromHexString('#e8e4da');
    bodyMat.roughness = 0.35;
    bodyMat.metallic = 0.25;

    const glassMat = new PBRMetallicRoughnessMaterial('tramGlass', this.scene);
    glassMat.baseColor = Color3.FromHexString('#2b4450');
    glassMat.roughness = 0.05;
    glassMat.metallic = 0.5;

    this.tramBody = CreateBox('tramBodySrc', { width: 2.5, height: 3.1, depth: 18 }, this.scene);
    this.tramBody.material = bodyMat;
    this.tramBody.isPickable = false;

    // Franja de ventanas: una caja apenas más ancha, a la altura de los ojos.
    this.tramGlass = CreateBox('tramGlassSrc', { width: 2.58, height: 1.15, depth: 16.6 }, this.scene);
    this.tramGlass.material = glassMat;
    this.tramGlass.isPickable = false;

    this.tramBodyBuf = new Float32Array(this.trams.length * 16);
    this.tramGlassBuf = new Float32Array(this.trams.length * 16);
    this.tramBody.thinInstanceSetBuffer('matrix', this.tramBodyBuf, 16, false);
    this.tramGlass.thinInstanceSetBuffer('matrix', this.tramGlassBuf, 16, false);
  }

  // ---------------------------------------------------------------- pájaros

  private createBirds(rng: Rng): void {
    const count = 44;
    for (let i = 0; i < count; i++) {
      this.birds.push({
        cx: rng.range(-this.plan.extent * 0.7, this.plan.extent * 0.7),
        cz: rng.range(-this.plan.extent * 0.7, this.plan.extent * 0.7),
        radius: rng.range(14, 55),
        height: rng.range(26, 74),
        angle: rng.range(0, Math.PI * 2),
        speed: rng.range(0.12, 0.32),
        bobPhase: rng.range(0, Math.PI * 2),
      });
    }

    // El pájaro es una caja muy achatada: a 30 m de altura sólo se percibe la
    // silueta y el movimiento. Gastar geometría acá no compra nada.
    const mat = new StandardMaterial('birdMat', this.scene);
    mat.diffuseColor = Color3.FromHexString('#3a3a3f');
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.FromHexString('#3a3a3f').scale(0.35);

    this.birdMesh = CreateBox('birdSrc', { width: 1.5, height: 0.14, depth: 0.42 }, this.scene);
    this.birdMesh.material = mat;
    this.birdMesh.isPickable = false;

    this.birdBuf = new Float32Array(count * 16);
    this.birdMesh.thinInstanceSetBuffer('matrix', this.birdBuf, 16, false);
  }

  // ----------------------------------------------------------------- update

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    this.time += dt;

    const limit = this.plan.extent + 30;
    const pitch = this.plan.blockSize + this.plan.streetWidth;

    for (let i = 0; i < this.trams.length; i++) {
      const t = this.trams[i];

      if (t.stopped > 0) {
        t.stopped -= dt;
      } else {
        const before = t.pos;
        t.pos += t.speed * t.dir * dt;

        // Parada en cada esquina de manzana: hace que el tranvía se comporte
        // como transporte y no como un objeto que se desliza en bucle.
        const cross = Math.floor(t.pos / pitch) !== Math.floor(before / pitch);
        if (cross && Math.random() < 0.45) t.stopped = 2.2;

        if (t.pos > limit) t.pos = -limit;
        if (t.pos < -limit) t.pos = limit;
      }

      const x = t.axis === 'x' ? t.pos : t.at;
      const z = t.axis === 'x' ? t.at : t.pos;
      const rotY = t.axis === 'x' ? Math.PI / 2 : 0;

      writeMatrix(this.tramBodyBuf, i, x, 1.72, z, rotY);
      writeMatrix(this.tramGlassBuf, i, x, 2.25, z, rotY);
    }
    if (this.trams.length) {
      this.tramBody.thinInstanceBufferUpdated('matrix');
      this.tramGlass.thinInstanceBufferUpdated('matrix');
    }

    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.angle += b.speed * dt;
      const x = b.cx + Math.cos(b.angle) * b.radius;
      const z = b.cz + Math.sin(b.angle) * b.radius;
      // Cabeceo suave: un planeo perfectamente horizontal se ve mecánico.
      const y = b.height + Math.sin(this.time * 0.9 + b.bobPhase) * 1.8;
      // Se orienta en la dirección de vuelo, con alabeo hacia adentro del giro.
      writeMatrix(this.birdBuf, i, x, y, z, -b.angle + Math.PI / 2, 0, 0.35);
    }
    this.birdMesh.thinInstanceBufferUpdated('matrix');
  };

  dispose(): void {
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
    this.tramBody?.material?.dispose();
    this.tramGlass?.material?.dispose();
    this.birdMesh?.material?.dispose();
    this.tramBody?.dispose();
    this.tramGlass?.dispose();
    this.birdMesh?.dispose();
  }
}

const _scale = new Vector3(1, 1, 1);
const _pos = new Vector3();
const _rot = new Quaternion();
const _mat = Matrix.Identity();

/** Escribe una matriz de transformación en el índice i de un buffer plano. */
function writeMatrix(
  buf: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  rotX = 0,
  rotZ = 0,
): void {
  _pos.set(x, y, z);
  Quaternion.FromEulerAnglesToRef(rotX, rotY, rotZ, _rot);
  Matrix.ComposeToRef(_scale, _rot, _pos, _mat);
  _mat.copyToArray(buf, i * 16);
}
