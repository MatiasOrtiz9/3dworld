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

interface Pod {
  axis: 'x' | 'z';
  at: number;
  laneOffset: number;
  pos: number;
  dir: 1 | -1;
  speed: number;
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
  flapFreq: number;
}

/**
 * Movimiento y vida urbana de Ciudad 2050:
 * - Trenes ligeros/tranvías articulados con cabinas aerodinámicas, luces LED y pantógrafo/equipos de techo.
 * - Vehículos urbanos autónomos eléctricos (eco-shuttles/pods) circulando por las calzadas.
 * - Bandadas de pájaros con aleteo biomecánico y planeos dinámicos.
 *
 * Todo dibujado mediante Thin Instances de buffer dinámico para un rendimiento de cuadro óptimo.
 */
export class Life {
  private readonly trams: Tram[] = [];
  private readonly pods: Pod[] = [];
  private readonly birds: Bird[] = [];

  // Mallas del tranvía articulado
  private tramCar!: Mesh;
  private tramGlass!: Mesh;
  private tramBellows!: Mesh;
  private tramRoof!: Mesh;
  private tramHeadlight!: Mesh;
  private tramTaillight!: Mesh;

  private tramCarBuf!: Float32Array;
  private tramGlassBuf!: Float32Array;
  private tramBellowsBuf!: Float32Array;
  private tramRoofBuf!: Float32Array;
  private tramHeadlightBuf!: Float32Array;
  private tramTaillightBuf!: Float32Array;

  // Mallas de autos autónomos (EcoPods)
  private podBody!: Mesh;
  private podGlass!: Mesh;
  private podChassis!: Mesh;
  private podHeadlight!: Mesh;
  private podTaillight!: Mesh;

  private podBodyBuf!: Float32Array;
  private podGlassBuf!: Float32Array;
  private podChassisBuf!: Float32Array;
  private podHeadlightBuf!: Float32Array;
  private podTaillightBuf!: Float32Array;

  // Mallas de pájaros con alas articuladas
  private birdBody!: Mesh;
  private birdWingL!: Mesh;
  private birdWingR!: Mesh;

  private birdBodyBuf!: Float32Array;
  private birdWingLBuf!: Float32Array;
  private birdWingRBuf!: Float32Array;

  private time = 0;
  private onTramStop?: (x: number, z: number) => void;

  constructor(
    private readonly scene: Scene,
    private readonly plan: CityPlan,
    seed: number,
  ) {
    const rng = new Rng(seed ^ 0x1f1f);
    this.createTrams(rng);
    this.createPods(rng);
    this.createBirds(rng);
    this.scene.onBeforeRenderObservable.add(this.update);
  }

  /** Callback opcional que avisa cuando un tranvía frena en una esquina (para sonido de campana). */
  setOnTramStop(cb: (x: number, z: number) => void): void {
    this.onTramStop = cb;
  }

  // --------------------------------------------------------------- tranvías

  private createTrams(rng: Rng): void {
    const avenues = this.plan.streets.filter((s) => s.tram);

    for (const av of avenues) {
      const count = rng.chance(0.55) ? 2 : 1;
      for (let i = 0; i < count; i++) {
        this.trams.push({
          axis: av.axis,
          at: av.at,
          pos: rng.range(-this.plan.extent, this.plan.extent),
          dir: i === 0 ? 1 : -1,
          speed: rng.range(7.5, 11.5),
          stopped: 0,
        });
      }
    }

    const bodyMat = new PBRMetallicRoughnessMaterial('tramBody', this.scene);
    bodyMat.baseColor = Color3.FromHexString('#eae7de');
    bodyMat.roughness = 0.3;
    bodyMat.metallic = 0.35;

    const glassMat = new PBRMetallicRoughnessMaterial('tramGlass', this.scene);
    glassMat.baseColor = Color3.FromHexString('#1c3340');
    glassMat.roughness = 0.05;
    glassMat.metallic = 0.65;

    const bellowsMat = new PBRMetallicRoughnessMaterial('tramBellowsMat', this.scene);
    bellowsMat.baseColor = Color3.FromHexString('#1e2124');
    bellowsMat.roughness = 0.85;
    bellowsMat.metallic = 0.1;

    const roofMat = new PBRMetallicRoughnessMaterial('tramRoofMat', this.scene);
    roofMat.baseColor = Color3.FromHexString('#333840');
    roofMat.roughness = 0.5;
    roofMat.metallic = 0.6;

    const headMat = new StandardMaterial('tramHeadMat', this.scene);
    headMat.emissiveColor = Color3.FromHexString('#fff6dc');
    headMat.disableLighting = true;

    const tailMat = new StandardMaterial('tramTailMat', this.scene);
    tailMat.emissiveColor = Color3.FromHexString('#ff2828');
    tailMat.disableLighting = true;

    // Vagón (2 por tranvía: delantero y trasero)
    this.tramCar = CreateBox('tramCarSrc', { width: 2.5, height: 3.1, depth: 8.5 }, this.scene);
    this.tramCar.material = bodyMat;
    this.tramCar.isPickable = false;

    this.tramGlass = CreateBox('tramGlassSrc', { width: 2.56, height: 1.18, depth: 7.9 }, this.scene);
    this.tramGlass.material = glassMat;
    this.tramGlass.isPickable = false;

    // Fuelle articulado en el centro
    this.tramBellows = CreateBox('tramBellowsSrc', { width: 2.42, height: 2.95, depth: 1.1 }, this.scene);
    this.tramBellows.material = bellowsMat;
    this.tramBellows.isPickable = false;

    // Equipos solares y climatización sobre el techo
    this.tramRoof = CreateBox('tramRoofSrc', { width: 1.8, height: 0.42, depth: 6.2 }, this.scene);
    this.tramRoof.material = roofMat;
    this.tramRoof.isPickable = false;

    // Luces delanteras y traseras
    this.tramHeadlight = CreateBox('tramHeadlightSrc', { width: 2.2, height: 0.18, depth: 0.2 }, this.scene);
    this.tramHeadlight.material = headMat;
    this.tramHeadlight.isPickable = false;

    this.tramTaillight = CreateBox('tramTaillightSrc', { width: 2.2, height: 0.18, depth: 0.2 }, this.scene);
    this.tramTaillight.material = tailMat;
    this.tramTaillight.isPickable = false;

    const totalCars = this.trams.length * 2;
    this.tramCarBuf = new Float32Array(totalCars * 16);
    this.tramGlassBuf = new Float32Array(totalCars * 16);
    this.tramRoofBuf = new Float32Array(totalCars * 16);
    this.tramBellowsBuf = new Float32Array(this.trams.length * 16);
    this.tramHeadlightBuf = new Float32Array(this.trams.length * 16);
    this.tramTaillightBuf = new Float32Array(this.trams.length * 16);

    this.tramCar.thinInstanceSetBuffer('matrix', this.tramCarBuf, 16, false);
    this.tramGlass.thinInstanceSetBuffer('matrix', this.tramGlassBuf, 16, false);
    this.tramRoof.thinInstanceSetBuffer('matrix', this.tramRoofBuf, 16, false);
    this.tramBellows.thinInstanceSetBuffer('matrix', this.tramBellowsBuf, 16, false);
    this.tramHeadlight.thinInstanceSetBuffer('matrix', this.tramHeadlightBuf, 16, false);
    this.tramTaillight.thinInstanceSetBuffer('matrix', this.tramTaillightBuf, 16, false);
  }

  // ---------------------------------------------------------------- autos autónomos (EcoPods)

  private createPods(rng: Rng): void {
    const streets = this.plan.streets;

    for (const st of streets) {
      // Autos autónomos circulando en ambos sentidos por las calzadas
      const count = rng.chance(0.65) ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const dir: 1 | -1 = i === 0 ? 1 : -1;
        const laneOffset = dir * (st.tram ? 4.2 : 2.5);
        this.pods.push({
          axis: st.axis,
          at: st.at,
          laneOffset,
          pos: rng.range(-this.plan.extent, this.plan.extent),
          dir,
          speed: rng.range(5.5, 9.5),
          stopped: 0,
        });
      }
    }

    const podBodyMat = new PBRMetallicRoughnessMaterial('podBodyMat', this.scene);
    podBodyMat.baseColor = Color3.FromHexString('#f4f2ea');
    podBodyMat.roughness = 0.28;
    podBodyMat.metallic = 0.3;

    const podGlassMat = new PBRMetallicRoughnessMaterial('podGlassMat', this.scene);
    podGlassMat.baseColor = Color3.FromHexString('#162b38');
    podGlassMat.roughness = 0.05;
    podGlassMat.metallic = 0.7;

    const chassisMat = new PBRMetallicRoughnessMaterial('podChassisMat', this.scene);
    chassisMat.baseColor = Color3.FromHexString('#25282d');
    chassisMat.roughness = 0.75;
    chassisMat.metallic = 0.2;

    const podHeadMat = new StandardMaterial('podHeadMat', this.scene);
    podHeadMat.emissiveColor = Color3.FromHexString('#8eecff');
    podHeadMat.disableLighting = true;

    const podTailMat = new StandardMaterial('podTailMat', this.scene);
    podTailMat.emissiveColor = Color3.FromHexString('#ff3232');
    podTailMat.disableLighting = true;

    this.podBody = CreateBox('podBodySrc', { width: 1.85, height: 1.35, depth: 3.3 }, this.scene);
    this.podBody.material = podBodyMat;
    this.podBody.isPickable = false;

    this.podGlass = CreateBox('podGlassSrc', { width: 1.88, height: 0.72, depth: 2.15 }, this.scene);
    this.podGlass.material = podGlassMat;
    this.podGlass.isPickable = false;

    this.podChassis = CreateBox('podChassisSrc', { width: 1.9, height: 0.42, depth: 3.0 }, this.scene);
    this.podChassis.material = chassisMat;
    this.podChassis.isPickable = false;

    this.podHeadlight = CreateBox('podHeadlightSrc', { width: 1.68, height: 0.1, depth: 0.12 }, this.scene);
    this.podHeadlight.material = podHeadMat;
    this.podHeadlight.isPickable = false;

    this.podTaillight = CreateBox('podTaillightSrc', { width: 1.68, height: 0.1, depth: 0.12 }, this.scene);
    this.podTaillight.material = podTailMat;
    this.podTaillight.isPickable = false;

    const count = this.pods.length;
    this.podBodyBuf = new Float32Array(count * 16);
    this.podGlassBuf = new Float32Array(count * 16);
    this.podChassisBuf = new Float32Array(count * 16);
    this.podHeadlightBuf = new Float32Array(count * 16);
    this.podTaillightBuf = new Float32Array(count * 16);

    this.podBody.thinInstanceSetBuffer('matrix', this.podBodyBuf, 16, false);
    this.podGlass.thinInstanceSetBuffer('matrix', this.podGlassBuf, 16, false);
    this.podChassis.thinInstanceSetBuffer('matrix', this.podChassisBuf, 16, false);
    this.podHeadlight.thinInstanceSetBuffer('matrix', this.podHeadlightBuf, 16, false);
    this.podTaillight.thinInstanceSetBuffer('matrix', this.podTaillightBuf, 16, false);
  }

  // ---------------------------------------------------------------- pájaros

  private createBirds(rng: Rng): void {
    const count = 48;
    for (let i = 0; i < count; i++) {
      this.birds.push({
        cx: rng.range(-this.plan.extent * 0.72, this.plan.extent * 0.72),
        cz: rng.range(-this.plan.extent * 0.72, this.plan.extent * 0.72),
        radius: rng.range(16, 56),
        height: rng.range(26, 76),
        angle: rng.range(0, Math.PI * 2),
        speed: rng.range(0.14, 0.34),
        bobPhase: rng.range(0, Math.PI * 2),
        flapFreq: rng.range(7.2, 9.4),
      });
    }

    const birdBodyMat = new StandardMaterial('birdBodyMat', this.scene);
    birdBodyMat.diffuseColor = Color3.FromHexString('#3a3a40');
    birdBodyMat.emissiveColor = Color3.FromHexString('#3a3a40').scale(0.3);

    const wingMat = new StandardMaterial('birdWingMat', this.scene);
    wingMat.diffuseColor = Color3.FromHexString('#4b4d54');
    wingMat.emissiveColor = Color3.FromHexString('#4b4d54').scale(0.32);

    // Cuerpo aerodinámico del ave
    this.birdBody = CreateBox('birdBodySrc', { width: 0.28, height: 0.16, depth: 0.78 }, this.scene);
    this.birdBody.material = birdBodyMat;
    this.birdBody.isPickable = false;

    // Alas izquierda y derecha articuladas
    this.birdWingL = CreateBox('birdWingLSrc', { width: 0.68, height: 0.04, depth: 0.36 }, this.scene);
    this.birdWingL.material = wingMat;
    this.birdWingL.isPickable = false;

    this.birdWingR = CreateBox('birdWingRSrc', { width: 0.68, height: 0.04, depth: 0.36 }, this.scene);
    this.birdWingR.material = wingMat;
    this.birdWingR.isPickable = false;

    this.birdBodyBuf = new Float32Array(count * 16);
    this.birdWingLBuf = new Float32Array(count * 16);
    this.birdWingRBuf = new Float32Array(count * 16);

    this.birdBody.thinInstanceSetBuffer('matrix', this.birdBodyBuf, 16, false);
    this.birdWingL.thinInstanceSetBuffer('matrix', this.birdWingLBuf, 16, false);
    this.birdWingR.thinInstanceSetBuffer('matrix', this.birdWingRBuf, 16, false);
  }

  // ----------------------------------------------------------------- update

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    this.time += dt;

    const limit = this.plan.extent + 30;
    const pitch = this.plan.blockSize + this.plan.streetWidth;

    // Actualización de tranvías
    for (let i = 0; i < this.trams.length; i++) {
      const t = this.trams[i];

      if (t.stopped > 0) {
        t.stopped -= dt;
      } else {
        const before = t.pos;
        t.pos += t.speed * t.dir * dt;

        const cross = Math.floor(t.pos / pitch) !== Math.floor(before / pitch);
        if (cross && Math.random() < 0.45) {
          t.stopped = 2.2;
          const stopX = t.axis === 'x' ? t.pos : t.at;
          const stopZ = t.axis === 'x' ? t.at : t.pos;
          this.onTramStop?.(stopX, stopZ);
        }

        if (t.pos > limit) t.pos = -limit;
        if (t.pos < -limit) t.pos = limit;
      }

      const rotY = t.axis === 'x' ? Math.PI / 2 : 0;
      const fwd = t.dir;
      const dx = t.axis === 'x' ? 1 : 0;
      const dz = t.axis === 'x' ? 0 : 1;

      const cx = t.axis === 'x' ? t.pos : t.at;
      const cz = t.axis === 'x' ? t.at : t.pos;

      // Vagón 1 (delantero) y Vagón 2 (trasero)
      const c1x = cx + dx * fwd * 4.6;
      const c1z = cz + dz * fwd * 4.6;
      const c2x = cx - dx * fwd * 4.6;
      const c2z = cz - dz * fwd * 4.6;

      const idx1 = i * 2;
      const idx2 = i * 2 + 1;

      writeMatrix(this.tramCarBuf, idx1, c1x, 1.72, c1z, rotY);
      writeMatrix(this.tramGlassBuf, idx1, c1x, 2.22, c1z, rotY);
      writeMatrix(this.tramRoofBuf, idx1, c1x, 3.42, c1z, rotY);

      writeMatrix(this.tramCarBuf, idx2, c2x, 1.72, c2z, rotY);
      writeMatrix(this.tramGlassBuf, idx2, c2x, 2.22, c2z, rotY);
      writeMatrix(this.tramRoofBuf, idx2, c2x, 3.42, c2z, rotY);

      // Fuelle articulado central
      writeMatrix(this.tramBellowsBuf, i, cx, 1.68, cz, rotY);

      // Luces LED (delanteras en punta frontal, traseras en cola)
      const hx = cx + dx * fwd * 8.85;
      const hz = cz + dz * fwd * 8.85;
      const tx = cx - dx * fwd * 8.85;
      const tz = cz - dz * fwd * 8.85;

      writeMatrix(this.tramHeadlightBuf, i, hx, 1.15, hz, rotY);
      writeMatrix(this.tramTaillightBuf, i, tx, 1.15, tz, rotY);
    }

    if (this.trams.length) {
      this.tramCar.thinInstanceBufferUpdated('matrix');
      this.tramGlass.thinInstanceBufferUpdated('matrix');
      this.tramRoof.thinInstanceBufferUpdated('matrix');
      this.tramBellows.thinInstanceBufferUpdated('matrix');
      this.tramHeadlight.thinInstanceBufferUpdated('matrix');
      this.tramTaillight.thinInstanceBufferUpdated('matrix');
    }

    // Actualización de autos autónomos (EcoPods)
    for (let i = 0; i < this.pods.length; i++) {
      const p = this.pods[i];

      if (p.stopped > 0) {
        p.stopped -= dt;
      } else {
        const before = p.pos;
        p.pos += p.speed * p.dir * dt;

        // Ceder el paso en esquinas ocasionalmente
        const cross = Math.floor(p.pos / pitch) !== Math.floor(before / pitch);
        if (cross && Math.random() < 0.28) {
          p.stopped = 1.6;
        }

        if (p.pos > limit) p.pos = -limit;
        if (p.pos < -limit) p.pos = limit;
      }

      const rotY = p.axis === 'x' ? Math.PI / 2 : 0;
      const fwd = p.dir;
      const dx = p.axis === 'x' ? 1 : 0;
      const dz = p.axis === 'x' ? 0 : 1;
      const perpX = p.axis === 'x' ? 0 : 1;
      const perpZ = p.axis === 'x' ? 1 : 0;

      const px = (p.axis === 'x' ? p.pos : p.at) + perpX * p.laneOffset;
      const pz = (p.axis === 'x' ? p.at : p.pos) + perpZ * p.laneOffset;
      const py = 0.88;

      writeMatrix(this.podBodyBuf, i, px, py, pz, rotY);
      writeMatrix(this.podGlassBuf, i, px, py + 0.35, pz, rotY);
      writeMatrix(this.podChassisBuf, i, px, 0.28, pz, rotY);

      // Barra frontal y trasera
      const fx = px + dx * fwd * 1.66;
      const fz = pz + dz * fwd * 1.66;
      const rx = px - dx * fwd * 1.66;
      const rz = pz - dz * fwd * 1.66;

      writeMatrix(this.podHeadlightBuf, i, fx, 0.72, fz, rotY);
      writeMatrix(this.podTaillightBuf, i, rx, 0.72, rz, rotY);
    }

    if (this.pods.length) {
      this.podBody.thinInstanceBufferUpdated('matrix');
      this.podGlass.thinInstanceBufferUpdated('matrix');
      this.podChassis.thinInstanceBufferUpdated('matrix');
      this.podHeadlight.thinInstanceBufferUpdated('matrix');
      this.podTaillight.thinInstanceBufferUpdated('matrix');
    }

    // Actualización de pájaros con aleteo biomecánico
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.angle += b.speed * dt;
      const x = b.cx + Math.cos(b.angle) * b.radius;
      const z = b.cz + Math.sin(b.angle) * b.radius;

      // Planeo y cabeceo
      const climb = Math.sin(this.time * 0.85 + b.bobPhase);
      const y = b.height + climb * 2.2;
      const rotY = -b.angle + Math.PI / 2;
      const bank = 0.28;

      // Aleteo dinámico: alterna fases de aleteo con planeo horizontal
      const isGliding = climb > 0.35;
      const flapAngle = isGliding ? -0.04 : Math.sin(this.time * b.flapFreq + b.bobPhase) * 0.44;

      writeMatrix(this.birdBodyBuf, i, x, y, z, rotY, climb * 0.08, bank);

      // Alas izquierda y derecha compensadas
      const wingDist = 0.42;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);

      const wlx = x - cosY * wingDist;
      const wlz = z + sinY * wingDist;
      const wrx = x + cosY * wingDist;
      const wrz = z - sinY * wingDist;

      writeMatrix(this.birdWingLBuf, i, wlx, y + 0.02, wlz, rotY, climb * 0.08, bank + flapAngle);
      writeMatrix(this.birdWingRBuf, i, wrx, y + 0.02, wrz, rotY, climb * 0.08, bank - flapAngle);
    }

    if (this.birds.length) {
      this.birdBody.thinInstanceBufferUpdated('matrix');
      this.birdWingL.thinInstanceBufferUpdated('matrix');
      this.birdWingR.thinInstanceBufferUpdated('matrix');
    }
  };

  dispose(): void {
    this.scene.onBeforeRenderObservable.removeCallback(this.update);

    // Dispose tranvías
    this.tramCar?.material?.dispose();
    this.tramGlass?.material?.dispose();
    this.tramBellows?.material?.dispose();
    this.tramRoof?.material?.dispose();
    this.tramHeadlight?.material?.dispose();
    this.tramTaillight?.material?.dispose();

    this.tramCar?.dispose();
    this.tramGlass?.dispose();
    this.tramBellows?.dispose();
    this.tramRoof?.dispose();
    this.tramHeadlight?.dispose();
    this.tramTaillight?.dispose();

    // Dispose pods
    this.podBody?.material?.dispose();
    this.podGlass?.material?.dispose();
    this.podChassis?.material?.dispose();
    this.podHeadlight?.material?.dispose();
    this.podTaillight?.material?.dispose();

    this.podBody?.dispose();
    this.podGlass?.dispose();
    this.podChassis?.dispose();
    this.podHeadlight?.dispose();
    this.podTaillight?.dispose();

    // Dispose pájaros
    this.birdBody?.material?.dispose();
    this.birdWingL?.material?.dispose();
    this.birdWingR?.material?.dispose();

    this.birdBody?.dispose();
    this.birdWingL?.dispose();
    this.birdWingR?.dispose();
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
