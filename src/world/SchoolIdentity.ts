import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import {
  FLAG,
  ITEMS,
  MEETING_POINT,
  SCHOOL,
  U,
  V,
  rearV,
  toWorld,
  GYM_MID,
  makerWallAt,
  type SchoolFrame,
} from './SchoolLayout';
import { AH, AW, R, drawAtlas, plateRegion, type PlateName, type Region } from './SchoolAtlas';

const FY = SCHOOL.floorY;

/**
 * Señalética y superficies pintadas del campus CIMDIP & Miguel Cané.
 *
 * Marquesina del portal, escudo, bandera, banner del hall, mural de
 * Tecnología, cancha del gimnasio, carteles de cada ambiente con los nombres
 * del plano, carteles de calle, punto de encuentro y un plano de evacuación
 * dibujado desde los MISMOS datos con los que se levanta la escuela. Todo
 * comparte UNA textura y UNA malla: un solo draw call, que en VR es lo que
 * importa.
 */
export class SchoolIdentity {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;

  constructor(scene: Scene, frame: SchoolFrame) {
    this.texture = new DynamicTexture('schoolAtlas', { width: AW, height: AH }, scene, true);
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    drawAtlas(ctx);
    this.texture.update(true);
    this.texture.anisotropicFilteringLevel = 8;
    // Recorte por alfa (sin mezcla): permite carteles con silueta, como el
    // óvalo de la cantina, sin ordenar transparencias. Todo lo demás es opaco.
    this.texture.hasAlpha = true;

    this.material = new StandardMaterial('schoolIdentity', scene);
    this.material.diffuseTexture = this.texture;
    this.material.diffuseColor = new Color3(0.5, 0.5, 0.5);
    this.material.specularColor = Color3.Black();
    // Luz propia moderada: los carteles se leen aunque queden en sombra.
    this.material.emissiveColor = new Color3(0.46, 0.46, 0.46);
    // La bandera se ve de los dos lados.
    this.material.backFaceCulling = false;

    const q = new QuadBatch(frame);
    const S = 1; // mira al sur (+v)
    const N = -1; // mira al norte (−v)
    const portalU = (32.95 + 41.9) / 2;
    // Portal sobre Laprida: marquesina y escudo.
    q.wall(portalU, 0.585, 3.5, 8.3, 1.4, 0, S, R.sign);
    q.wall(portalU, 0.525, 6.78, 0.72, 0.62, 0, S, R.crest);
    q.wall(FLAG.u, FLAG.v, FLAG.y, 1.6, 1.0, 0, S, R.flag);

    // Hall de acceso: banner de pie, reloj sobre las puertas y plano de evacuación.
    const banner = ITEMS.find((it) => it.kind === 'banner');
    if (banner) q.wall(banner.u, banner.v + 0.03, FY + 1.3, 0.84, 1.9, 0, S, R.totem);

    // Recepción: mural del cruce de los Andes en el muro oeste, con el lema
    // pintado debajo sobre el zócalo de mármol (0:18-0:23).
    q.wall(U.east1 + 0.105, -5.1, FY + 2.3, 2.6, 1.5, 1, 0, R.sanMartin);
    q.wall(U.east1 + 0.106, -5.1, FY + 1.05, 2.5, 0.62, 1, 0, R.motto);

    // Aula Maker: el mural de vinilo sobre la medianera (dos paños) y
    // COMPARTE en el testero este; Educabot al costado de los muebles de la
    // entrada; cartel de salida sobre la puerta de emergencia.
    for (const [s0, s1, region] of [
      [0.6, 6.4, R.makerA],
      [6.4, 12.2, R.makerB],
    ] as const) {
      const [cu, cv] = makerWallAt((s0 + s1) / 2, 0.16);
      const [au, av] = makerWallAt(0, 0);
      const [bu, bv] = makerWallAt(0, 1);
      q.wall(cu, cv, FY + 1.275, s1 - s0, 2.35, bu - au, bv - av, region);
    }
    q.wall(U.tecE - 0.16, -33.15, FY + 1.275, 4.1, 2.35, -1, 0, R.makerC);
    q.wall(15.89, -30.25, FY + 0.95, 0.45, 1.9, -1, 0, R.educabot);
    q.wall(U.tecE - 0.11, -30.4, FY + 2.5, 0.5, 0.18, -1, 0, R.salida);
    q.wall(14.92, V.nBlockN + 0.115, FY + 2.42, 0.5, 0.18, 0, S, R.salida);

    // Pasillo sur: carteleras de corcho de marco rojo cerca de la salida.
    q.wall(2.6, V.classTop - 0.115, FY + 1.9, 1.4, 1.0, 0, N, R.cork1);
    q.wall(5.0, V.corrS + 0.115, FY + 1.9, 1.4, 1.0, 0, S, R.cork2);
    q.wall(37.45, V.hallDoors - 0.13, 3.0, 0.42, 0.42, 0, N, R.clock);
    q.wall(U.east1 + 0.12, -4.4, 1.65, 1.3, 0.8, 1, 0, R.plan);

    // Tecnología: mural "imagina · diseña · crea" y cartel del aula maker.
    q.wall(25.0, V.nBlockN - 0.115, 1.95, 3.7, 1.48, 0, N, R.mural);
    q.wall(15.7, V.nBlockN - 0.115, 1.8, 0.9, 1.46, 0, N, R.maker);

    // Aula de danzas: afiches de las muestras en el testero norte.
    q.wall(45.6, V.gymTop + 0.115, 2.35, 0.75, 1.12, 0, S, R.ballet1);
    q.wall(46.55, V.gymTop + 0.115, 2.35, 0.75, 1.12, 0, S, R.ballet2);

    // Polideportivo: la cancha ocupa todo el piso (corre de oeste a este) y
    // la bandera blanca con el escudo cuelga en el testero este.
    q.floorAlongU(U.gymW + 0.1, V.gymTop + 0.1, U.e - 0.15, -0.15, FY + 0.006, R.court);
    q.wall(U.e - 0.18, GYM_MID, 5.1, 2.2, 2.75, -1, 0, R.crestBanner);

    // Carteles de los ambientes sobre sus puertas.
    const plate = (name: PlateName, u: number, v: number, nu: number, nv: number, w = 1.15, y = 2.42) =>
      q.wall(u, v, y, w, w * (64 / 504), nu, nv, plateRegion(name));
    plate('E.P', 18.7, V.nBlockS + 0.115, 0, S);
    plate('TECNOLOGÍA', 18.7, V.nBlockN + 0.115, 0, S);
    plate('TECNOLOGÍA', 28.05, V.nBlockN + 0.115, 0, S);
    plate('ADM', 10.7, V.corrN - 0.115, 0, N, 0.8);
    plate('PROF.', 12.4, V.profB + 0.115, 0, S, 0.8);
    plate('DIR. PRIM', 5.5, V.dirTop - 0.115, 0, N, 0.9);
    plate('BUFFET', 29.4, V.corrS + 0.115, 0, S);
    plate('SALÓN DE LOS ESPEJOS', U.salonW - 0.115, -12.1, -1, 0, 1.5);
    plate('GIMNASIO · SUM', U.gymW - 0.115, -10.1, -1, 0, 1.5, 2.5);
    plate('GIMNASIO · SUM', 59.3, V.gymTop - 0.115, 0, N, 1.6, 2.55);
    plate('ARTE', 52.35, V.artB + 0.115, 0, S, 0.8);
    plate('TEATRO', 55.05, V.artB + 0.115, 0, S, 0.9);
    plate('V. DAMAS', U.vdW - 0.115, -25.95, -1, 0, 0.9);
    {
      // Puerta del jardín sobre la medianera vieja (diagonal).
      const k = 0.2496;
      const l = Math.hypot(1, k);
      const nu = -k / l;
      const nv = 1 / l;
      plate('JARDÍN DE INFANTES CIMPID', 60.75 + nu * 0.115, rearV(60.75) + nv * 0.115, nu, nv, 1.6);
    }
    plate('PATIO AIRE LIBRE', 24.45, V.corrS + 0.115, 0, S, 1.3, 2.78);
    plate('PATIO AIRE LIBRE', 36.65, V.hallTop + 0.115, 0, S, 1.3, 2.78);
    plate('HALL DE ACCESO', 37.45, V.hallDoors - 0.115, 0, N, 1.3, 3.35);

    // Esquina de Laprida y Miguel Cané: carteles de calle y punto de encuentro.
    const pole = { u: -6.3, v: 3.3 };
    for (const s of [S, N]) {
      q.wall(pole.u + 0.5, pole.v + s * 0.035, 2.95, 0.9, 0.17, 0, s, R.lapr);
    }
    {
      const du = 0.5382;
      const dv = -0.8428;
      for (const s of [1, -1]) {
        const nu = -dv * s;
        const nv = du * s;
        q.wall(pole.u + du * 0.5 + nu * 0.035, pole.v + dv * 0.5 + nv * 0.035, 3.2, 0.9, 0.17, nu, nv, R.mcane);
      }
    }
    q.wall(MEETING_POINT[0], MEETING_POINT[1] + 0.03, 2.0, 0.55, 0.64, 0, S, R.meet);

    this.mesh = q.toMesh('schoolIdentity', scene);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
  }

  get shadowCasters(): Mesh[] {
    return [this.mesh];
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

// ------------------------------------------------------------------ geometría

type L = [number, number, number];

/** Acumula quads texturizados en coordenadas locales del campus. */
class QuadBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  constructor(private readonly f: SchoolFrame) {}

  /**
   * Cartel vertical centrado en (u, v) a la altura `y`, con normal horizontal
   * (nu, nv). Para quien lo mira de frente, la derecha es (−nv, nu).
   */
  wall(u: number, v: number, y: number, w: number, h: number, nu: number, nv: number, r: Region): void {
    // Todo en mundo: +u es −x, así que la derecha del lector se calcula con
    // la normal ya transformada. En local el texto salía espejado.
    const c = toWorld(this.f, u, v);
    const o = toWorld(this.f, 0, 0);
    const n = toWorld(this.f, nu, nv);
    const nx = n.x - o.x;
    const nz = n.z - o.z;
    const rx = -nz;
    const rz = nx;
    const hw = w / 2;
    const hh = h / 2;
    const bl: L = [c.x - rx * hw, y - hh, c.z - rz * hw];
    const br: L = [c.x + rx * hw, y - hh, c.z + rz * hw];
    const tr: L = [c.x + rx * hw, y + hh, c.z + rz * hw];
    const tl: L = [c.x - rx * hw, y + hh, c.z - rz * hw];
    this.push([bl, br, tr, tl], [nx, 0, nz], r);
  }

  /** Superficie horizontal: el ancho del dibujo a lo largo de u (oeste → este) y el alto a lo largo de v (norte → sur). */
  floorAlongU(u0: number, v0: number, u1: number, v1: number, y: number, r: Region): void {
    const w = (u: number, v: number): L => {
      const p = toWorld(this.f, u, v);
      return [p.x, y, p.z];
    };
    this.push([w(u0, v1), w(u1, v1), w(u1, v0), w(u0, v0)], [0, 1, 0], r);
  }

  /** Superficie horizontal con el eje largo del dibujo a lo largo de v. */
  floorAlongV(u0: number, v0: number, u1: number, v1: number, y: number, r: Region): void {
    const w = (u: number, v: number): L => {
      const p = toWorld(this.f, u, v);
      return [p.x, y, p.z];
    };
    this.push([w(u1, v0), w(u1, v1), w(u0, v1), w(u0, v0)], [0, 1, 0], r);
  }

  /** Esquinas ya en mundo: inferior-izq, inferior-der, superior-der, superior-izq. */
  private push(c: [L, L, L, L], nLocal: [number, number, number], r: Region): void {
    const base = this.positions.length / 3;
    for (const p of c) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nLocal[0], nLocal[1], nLocal[2]);
    }
    // Con invertY (el valor por defecto) la fila 0 del canvas es v = 1.
    const u0 = r[0] / AW;
    const u1 = r[2] / AW;
    const vb = 1 - r[3] / AH;
    const vt = 1 - r[1] / AH;
    this.uvs.push(u0, vb, u1, vb, u1, vt, u0, vt);

    // Orden de índices que Babylon considera cara frontal para esta normal:
    // su normal de cara es (a−b)×(c−b).
    const P = (i: number) => this.positions.slice((base + i) * 3, (base + i) * 3 + 3);
    const a = P(0);
    const b = P(1);
    const cc = P(2);
    const fx = (a[1] - b[1]) * (cc[2] - b[2]) - (a[2] - b[2]) * (cc[1] - b[1]);
    const fy = (a[2] - b[2]) * (cc[0] - b[0]) - (a[0] - b[0]) * (cc[2] - b[2]);
    const fz = (a[0] - b[0]) * (cc[1] - b[1]) - (a[1] - b[1]) * (cc[0] - b[0]);
    if (fx * nLocal[0] + fy * nLocal[1] + fz * nLocal[2] >= 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  toMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    mesh.freezeWorldMatrix();
    return mesh;
  }
}
