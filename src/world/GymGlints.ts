import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { GYM_PILASTERS, SCHOOL, U, V, toWorld, type SchoolFrame } from './SchoolLayout';

/**
 * Reflejos de las luminarias en el piso pulido del polideportivo (video 2026,
 * 1:31–1:37) sin espejo en tiempo real: un cuadradito por luminaria cuyo
 * vértice se corre, en la GPU, al punto donde el piso refleja esa luminaria
 * vista desde el ojo (la imagen virtual bajo el piso, cortada con el plano
 * del piso), estirado hacia quien mira como un reflejo difuso. Una sola
 * malla y un draw call (aditivo, sin escribir profundidad); en la CPU, sólo
 * el uniforme del ojo al dibujar (lo hace cada ojo en VR). Lo que caería
 * fuera de la cancha se descarta.
 */
export function createGymGlints(scene: Scene, frame: SchoolFrame): { mesh: Mesh; dispose(): void } {
  const floorY = SCHOOL.floorY + 0.012;
  const lampY = SCHOOL.gymWall - 0.6;
  const vc = V.gymTop / 2;
  const lamps: Array<[number, number]> = [];
  for (const u of GYM_PILASTERS) for (const v of [vc - 5.5, vc, vc + 5.5]) lamps.push([u, v]);

  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  lamps.forEach(([u, v], k) => {
    const p = toWorld(frame, u, v);
    for (const [a, b] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      pos.push(p.x, lampY, p.z);
      uvs.push(a, b);
    }
    idx.push(4 * k, 4 * k + 1, 4 * k + 2, 4 * k, 4 * k + 2, 4 * k + 3);
  });
  const mesh = new Mesh('gymGlints', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.uvs = uvs;
  vd.indices = idx;
  vd.applyToMesh(mesh);
  // La caja de la cancha: los vértices se mueven en el shader.
  const a = toWorld(frame, U.gymW, V.gymTop);
  const b = toWorld(frame, U.e, 0);
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z);
  const z1 = Math.max(a.z, b.z);
  mesh.setBoundingInfo(new BoundingInfo(new Vector3(x0, floorY - 0.1, z0), new Vector3(x1, lampY + 0.1, z1)));
  mesh.doNotSyncBoundingInfo = true;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();

  // Textura blanca mínima: sólo da las UV; la mancha la arma el shader.
  const tex = new DynamicTexture('gymGlintTex', { width: 4, height: 4 }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 4, 4);
  tex.update(false);
  tex.wrapU = tex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;

  const mat = new StandardMaterial('gymGlint', scene);
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(0.5, 0.5, 0.48);
  mat.alpha = 0.999;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.zOffset = -2;
  mat.fogEnabled = false;
  new GymGlintPlugin(mat, scene, floorY, [x0 + 0.1, x1 - 0.1, z0 + 0.1, z1 - 0.1]);
  mesh.material = mat;

  return {
    mesh,
    dispose() {
      mesh.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

class GymGlintPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly scene: Scene,
    private readonly floorY: number,
    private readonly box: readonly [number, number, number, number],
  ) {
    super(material, 'GymGlint', 200, { GYMGLINT: false }, true, true);
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.GYMGLINT = true;
  }

  override getClassName(): string {
    return 'GymGlintPlugin';
  }

  override getUniforms(): {
    ubo: Array<{ name: string; size: number; type: string }>;
    vertex: string;
    fragment: string;
  } {
    const decl = `#ifdef GYMGLINT
uniform vec4 ggEye;
uniform vec4 ggBox;
#endif`;
    return {
      ubo: [
        { name: 'ggEye', size: 4, type: 'vec4' },
        { name: 'ggBox', size: 4, type: 'vec4' },
      ],
      vertex: decl,
      fragment: decl,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const cam = this.scene.activeCamera;
    const e = cam ? cam.globalPosition : Vector3.Zero();
    ubo.updateFloat4('ggEye', e.x, e.y, e.z, this.floorY);
    ubo.updateFloat4('ggBox', this.box[0], this.box[1], this.box[2], this.box[3]);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef GYMGLINT
{
  vec3 L = positionUpdated;
  vec3 E = ggEye.xyz;
  float fy = ggEye.w;
  // Imagen virtual de la luminaria bajo el piso y su corte con el piso.
  vec3 Li = vec3(L.x, 2.0 * fy - L.y, L.z);
  float t = clamp((E.y - fy) / max(E.y - Li.y, 0.01), 0.0, 1.0);
  vec3 P = E + t * (Li - E);
  vec2 d = E.xz - P.xz;
  float dist = length(d);
  vec2 toEye = dist > 0.001 ? d / dist : vec2(0.0, 1.0);
  vec2 side = vec2(-toEye.y, toEye.x);
  vec2 c = uv * 2.0 - 1.0;
  // Más largo cuanto más rasante (reflejo difuso estirado hacia el ojo).
  float halfLen = 0.25 + 0.18 * dist;
  P.xz += side * c.x * 0.18 + toEye * c.y * halfLen;
  P.y = fy;
  positionUpdated = P;
}
#endif`,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_MAIN_BEGIN: `#ifdef GYMGLINT
if (vPositionW.x < ggBox.x || vPositionW.x > ggBox.y || vPositionW.z < ggBox.z || vPositionW.z > ggBox.w) discard;
#endif`,
        // Mancha blanda: núcleo intenso y halo que se apaga en el borde del cuadrado.
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef GYMGLINT
{
  vec2 gc = vMainUV1 * 2.0 - 1.0;
  float gq = dot(gc, gc);
  color.rgb *= (0.8 * exp(-5.0 * gq) + 0.2 * max(0.0, 1.0 - gq)) * step(gq, 1.0);
}
#endif`,
      };
    }
    return null;
  }
}
