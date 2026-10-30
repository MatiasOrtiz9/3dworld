import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ROOMS, toWorld, type Floor, type SchoolFrame } from './SchoolLayout';
import type { LampFixture } from './builders/school/SchoolKit';

/**
 * Reflejo de las luminarias en un piso pulido, sin espejo en tiempo real.
 *
 * Cada luminaria es un cuadradito cuyo vértice se corre, en la GPU, al punto
 * donde el piso refleja esa luminaria vista desde el ojo (la imagen virtual
 * bajo el piso cortada con el plano del piso), estirado hacia quien mira
 * como el reflejo borroso de un piso encerado. Una sola malla y un draw call
 * (aditivo, sin escribir profundidad: los muros y muebles lo tapan como a
 * cualquier cosa); en la CPU, sólo el uniforme del ojo al dibujar (lo hace
 * cada ojo en el visor).
 *
 * El brillo sigue a Fresnel: un piso pulido casi no refleja mirando hacia
 * abajo y refleja mucho en ángulo rasante. Sin eso las luminarias de encima
 * del jugador se veían como óvalos blancos a sus pies (el reflejo más
 * cercano es el más perpendicular y por eso el más débil) y las del fondo
 * del pasillo, que en una foto real son las que brillan, se perdían.
 */
export interface GlintLamp {
  /** Centro de la luminaria en el mundo. */
  x: number;
  y: number;
  z: number;
  /** Eje largo de la luminaria en planta (unitario, mundo). */
  ax: number;
  az: number;
  /** Medio largo sobre el eje y medio ancho (m). */
  half: number;
  width: number;
  /** Cota del piso que la refleja. */
  floorY: number;
  /** Caja del ambiente en el mundo (x0, x1, z0, z1): el reflejo no sale de ahí. */
  box: readonly [number, number, number, number];
  /** Brillo del reflejo según el piso (0..1). */
  gain: number;
  /** Ambiente (para apagar los reflejos con las luces del aula). */
  room?: string;
}

/**
 * Cuánto refleja cada piso de la escuela. El cerámico esmaltado y el damero
 * del comedor son los más lisos (rugosidad 0,40–0,42); el granito de los
 * pasillos y aulas devuelve un reflejo más apagado; la madera, mucho menos;
 * el caucho y la loseta del patio, nada.
 */
export const FLOOR_GLINT: Partial<Record<Floor, number>> = {
  ceramic: 1,
  ceramicBeige: 1,
  ceramicTan: 0.95,
  checker: 0.9,
  hallStone: 0.85,
  tile: 0.7,
  terracotta: 0.55,
  wood: 0.45,
  dance: 0.5,
};

export class FloorGlints {
  readonly mesh: Mesh;
  private readonly mat: StandardMaterial;
  private readonly data: Float32Array;
  /** Ambientes con las luces apagadas. */
  private readonly off = new Set<string>();

  constructor(
    scene: Scene,
    name: string,
    private readonly lamps: readonly GlintLamp[],
    color: Color3,
  ) {
    const n = lamps.length;
    const pos = new Float32Array(n * 12);
    const a = new Float32Array(n * 16);
    const b = new Float32Array(n * 16);
    const c = new Float32Array(n * 16);
    const idx: number[] = [];
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    lamps.forEach((l, k) => {
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      corners.forEach(([cu, cv], q) => {
        const vi = k * 4 + q;
        pos.set([l.x, l.y, l.z], vi * 3);
        a.set([cu, cv, l.floorY, l.gain], vi * 4);
        b.set(l.box, vi * 4);
        c.set([l.ax, l.az, l.half, l.width], vi * 4);
      });
      idx.push(4 * k, 4 * k + 1, 4 * k + 2, 4 * k, 4 * k + 2, 4 * k + 3);
      x0 = Math.min(x0, l.box[0]);
      x1 = Math.max(x1, l.box[1]);
      z0 = Math.min(z0, l.box[2]);
      z1 = Math.max(z1, l.box[3]);
      y0 = Math.min(y0, l.floorY);
      y1 = Math.max(y1, l.y);
    });
    this.data = a;

    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(mesh);
    mesh.setVerticesData('glintA', a, true, 4);
    mesh.setVerticesData('glintB', b, false, 4);
    mesh.setVerticesData('glintC', c, false, 4);
    // Los vértices se mueven en el shader: la caja es la de los ambientes.
    if (n > 0) {
      mesh.setBoundingInfo(new BoundingInfo(new Vector3(x0, y0 - 0.1, z0), new Vector3(x1, y1 + 0.1, z1)));
    }
    mesh.doNotSyncBoundingInfo = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();

    const mat = new StandardMaterial(name, scene);
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = color;
    mat.alpha = 0.999;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    mat.zOffset = -2;
    mat.fogEnabled = false;
    new FloorGlintPlugin(mat, scene);
    mesh.material = mat;
    this.mat = mat;
    this.mesh = mesh;

  }

  /** Prende o apaga los reflejos de las luminarias de un ambiente (interruptor del juego). */
  setRoom(room: string, on: boolean): void {
    if (on) this.off.delete(room);
    else this.off.add(room);
    const off = this.off;
    let changed = false;
    this.lamps.forEach((l, k) => {
      const g = l.room && off.has(l.room) ? 0 : l.gain;
      for (let q = 0; q < 4; q++) {
        const i = (k * 4 + q) * 4 + 3;
        if (this.data[i] !== g) {
          this.data[i] = g;
          changed = true;
        }
      }
    });
    if (changed) this.mesh.updateVerticesData('glintA', this.data);
  }

  dispose(): void {
    this.mesh.dispose();
    this.mat.dispose();
  }
}

/**
 * Reflejos de las luminarias de cielorraso de la escuela en sus pisos
 * pulidos (pasillos, hall, aulas, comedor, sanitarios). Las del polideportivo
 * tienen los suyos (`GymGlints`).
 */
export function createSchoolFloorGlints(scene: Scene, frame: SchoolFrame, lamps: readonly LampFixture[]): FloorGlints {
  const rooms = new Map(ROOMS.map((r) => [r.id, r]));
  const out: GlintLamp[] = [];
  for (const l of lamps) {
    if (l.kind === 'gym' || !l.room) continue;
    const r = rooms.get(l.room);
    if (!r) continue;
    const gain = FLOOR_GLINT[r.floorLook ?? r.floor] ?? 0;
    if (gain <= 0) continue;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [u, v] of r.poly) {
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const a = toWorld(frame, u0, v0);
    const b = toWorld(frame, u1, v1);
    // El eje largo: los tubos van a lo largo del ambiente; paneles y campanas
    // son cuadrados (el eje da igual).
    const alongX = l.sx >= l.sz;
    out.push({
      x: l.x,
      y: l.y,
      z: l.z,
      ax: alongX ? 1 : 0,
      az: alongX ? 0 : 1,
      half: Math.max(l.sx, l.sz) / 2,
      width: Math.min(l.sx, l.sz) / 2,
      floorY: l.floor + 0.004,
      box: [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z)],
      gain,
      room: l.switchable ? l.room : undefined,
    });
  }
  return new FloorGlints(scene, 'floorGlints', out, new Color3(0.62, 0.62, 0.6));
}

class FloorGlintPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly scene: Scene,
  ) {
    super(material, 'FloorGlint', 200, { FLOORGLINT: false }, true, true);
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.FLOORGLINT = true;
  }

  override getClassName(): string {
    return 'FloorGlintPlugin';
  }

  override getAttributes(attributes: string[]): void {
    attributes.push('glintA', 'glintB', 'glintC');
  }

  override getUniforms(): {
    ubo: Array<{ name: string; size: number; type: string }>;
    vertex: string;
  } {
    return {
      ubo: [{ name: 'fgEye', size: 4, type: 'vec4' }],
      vertex: `#ifdef FLOORGLINT
uniform vec4 fgEye;
#endif`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const cam = this.scene.activeCamera;
    const e = cam ? cam.globalPosition : Vector3.Zero();
    // Sin post-proceso (visor, celular) el reflejo pasa por el mapeo tonal
    // por separado y se suma ya comprimido sobre el piso: rinde bastante más
    // que en escritorio, donde se suma antes de comprimir.
    const inMaterial = !this.scene.imageProcessingConfiguration.applyByPostProcess;
    ubo.updateFloat4('fgEye', e.x, e.y, e.z, inMaterial ? 0.6 : 1);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef FLOORGLINT
attribute vec4 glintA;
attribute vec4 glintB;
attribute vec4 glintC;
varying vec3 vGlint;
#endif`,
        CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef FLOORGLINT
{
  vec3 L = positionUpdated;
  vec3 E = fgEye.xyz;
  float fy = glintA.z;
  vec3 Q = vec3(E.x, -100.0, E.z);
  vGlint = vec3(0.0);
  // Sólo con el ojo por encima de ese piso y la luminaria por encima del ojo
  // o a la vista (otro piso, apagada o sin brillo: el cuadrado se colapsa).
  if (E.y > fy + 0.05 && glintA.w > 0.0) {
    vec3 Li = vec3(L.x, 2.0 * fy - L.y, L.z);
    float t = (E.y - fy) / max(E.y - Li.y, 0.01);
    vec3 P = E + t * (Li - E);
    vec4 bx = glintB;
    if (P.x > bx.x && P.x < bx.y && P.z > bx.z && P.z < bx.w) {
      vec2 d = E.xz - P.xz;
      float dist = length(d);
      vec2 toEye = dist > 0.001 ? d / dist : vec2(0.0, 1.0);
      vec2 side = vec2(-toEye.y, toEye.x);
      vec2 ax = glintC.xy;
      vec2 axP = vec2(-ax.y, ax.x);
      // Huella de la luminaria proyectada a lo ancho y a lo largo de la
      // mirada, más el estiramiento del reflejo borroso hacia el ojo.
      float wSide = abs(dot(ax, side)) * glintC.z + abs(dot(axP, side)) * glintC.w + 0.08;
      float wEye = 0.25 + 0.2 * dist + 0.5 * (abs(dot(ax, toEye)) * glintC.z + abs(dot(axP, toEye)) * glintC.w);
      // Fresnel (Schlick, exponente 5): coseno entre la mirada y la vertical
      // en el centro del reflejo. Casi nada mirando a los pies (≈0,05 a 2 m
      // con la luminaria encima), fuerte en el fondo de un pasillo.
      float c = (E.y - fy) / max(length(vec2(dist, E.y - fy)), 0.01);
      float fres = 0.03 + 1.6 * pow(1.0 - clamp(c, 0.0, 1.0), 5.0);
      // A lo lejos el cuadrado queda de un píxel y titila: se apaga.
      float far = 1.0 - smoothstep(22.0, 38.0, dist);
      vGlint = vec3(glintA.xy, min(fres, 1.0) * far * glintA.w * fgEye.w);
      P.xz += side * glintA.x * wSide + toEye * glintA.y * wEye;
      P.y = fy;
      Q = P;
    }
  }
  positionUpdated = Q;
}
#endif`,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef FLOORGLINT
varying vec3 vGlint;
#endif`,
        // Mancha blanda: núcleo y halo que se apaga en el borde del cuadrado.
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef FLOORGLINT
{
  float gq = dot(vGlint.xy, vGlint.xy);
  color.rgb *= vGlint.z * (0.75 * exp(-4.0 * gq) + 0.25 * max(0.0, 1.0 - gq)) * step(gq, 1.0);
}
#endif`,
      };
    }
    return null;
  }
}
