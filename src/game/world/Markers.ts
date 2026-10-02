import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ThinSet } from './ThinSet';

/**
 * Señales del juego en el mundo, con UN material sin iluminación (brillan
 * igual de día, de noche y bajo techo):
 *
 * - rombos sobre lo que se puede usar cerca (tenues) y sobre lo enfocado
 *   (dorado, más grande), y el rombo grande del objetivo actual;
 * - estrellas del jardín, flechas verdes del simulacro y el aro dorado de
 *   "pararse acá" (sólo existen mientras hacen falta);
 * - cajas invisibles de selección para el láser del visor.
 *
 * Todo en thin instances: rombos, estrellas y flechas son un draw call cada
 * uno, y sólo cuando hay alguno a la vista.
 */

const RING_COLOR = Color3.FromHexString('#f2c14e');

export interface Glow {
  x: number;
  y: number;
  z: number;
  size: number;
  color: Color3;
  yaw?: number;
}

export interface Proxy {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

export class Markers {
  readonly material: StandardMaterial;
  private readonly diamonds: ThinSet;
  private readonly stars: ThinSet;
  private readonly arrows: ThinSet;
  private readonly ring: ThinSet;
  private readonly proxies: ThinSet;
  private proxyCount = 0;

  constructor(scene: Scene) {
    this.material = new StandardMaterial('game-glow', scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = Color3.White();
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.fogEnabled = false;
    this.material.backFaceCulling = false;

    const diamond = CreatePolyhedron('game-diamond', { type: 1, size: 0.5 }, scene);
    diamond.scaling.y = 1;
    diamond.material = this.material;
    this.diamonds = new ThinSet(diamond, 48);

    const star = starMesh(scene);
    star.material = this.material;
    this.stars = new ThinSet(star, 4);

    const arrow = arrowMesh(scene);
    arrow.material = this.material;
    this.arrows = new ThinSet(arrow, 48);

    const ring = CreateTorus('game-ring', { diameter: 1, thickness: 0.035, tessellation: 40 }, scene);
    ring.material = this.material;
    this.ring = new ThinSet(ring, 1);

    // Cajas de selección para el láser VR: no se dibujan (visibilidad 0),
    // pero el puntero del visor las toca (ver vr/XRSetup: `xrInteractive`).
    const proxy = CreateBox('game-pick', { size: 1 }, scene);
    proxy.visibility = 0;
    proxy.metadata = { xrInteractive: true };
    this.proxies = new ThinSet(proxy, 64);
    proxy.isPickable = false;
    proxy.thinInstanceEnablePicking = true;
  }

  /** Rombos de este cuadro (reemplaza los del anterior). */
  setDiamonds(list: readonly Glow[]): void {
    this.diamonds.clear();
    for (const g of list) this.diamonds.put(g.x, g.y, g.z, g.yaw ?? 0, g.size * 0.75, g.size * 1.2, g.size * 0.75, g.color);
    this.diamonds.flush();
  }

  setStars(list: readonly Glow[]): void {
    this.stars.clear();
    for (const g of list) this.stars.put(g.x, g.y, g.z, g.yaw ?? 0, g.size, g.size, g.size, g.color);
    this.stars.flush();
  }

  /** Flechas en el piso: posición y rumbo (giro en mundo, +X de la flecha hacia adelante). */
  setArrows(list: readonly Glow[]): void {
    this.arrows.clear();
    for (const g of list) this.arrows.put(g.x, g.y, g.z, g.yaw ?? 0, g.size, 1, g.size, g.color);
    this.arrows.flush();
  }

  /** Aro dorado en el piso (null: sin aro). */
  setRing(at: { x: number; y: number; z: number; radius: number; pulse: number } | null): void {
    this.ring.clear();
    if (at) {
      const r = at.radius * 2 * (1 + 0.06 * Math.sin(at.pulse));
      this.ring.put(at.x, at.y + 0.06, at.z, 0, r, 1, r, RING_COLOR);
    }
    this.ring.flush();
  }

  // ==================================================================== láser VR

  setProxies(list: readonly Proxy[]): void {
    this.proxies.clear();
    for (const p of list) this.proxies.put(p.x, p.y, p.z, 0, p.sx, p.sy, p.sz, Color3.White());
    this.proxyCount = list.length;
    this.proxies.flush();
    // El rayo descarta la malla entera si no toca su volumen: hay que recalcularlo.
    if (this.proxyCount > 0) this.proxies.mesh.thinInstanceRefreshBoundingInfo(false);
  }

  setPickable(on: boolean): void {
    this.proxies.mesh.isPickable = on;
  }

  get proxyMesh(): Mesh {
    return this.proxies.mesh;
  }

  dispose(): void {
    this.diamonds.dispose();
    this.stars.dispose();
    this.arrows.dispose();
    this.ring.dispose();
    this.proxies.dispose();
    this.material.dispose();
  }
}

/** Estrella de cinco puntas, plana, en el plano XY (de frente a ±Z), de 1 m de alto. */
function starMesh(scene: Scene): Mesh {
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? 0.5 : 0.21;
    positions.push(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  for (let k = 0; k < 10; k++) indices.push(0, 1 + k, 1 + ((k + 1) % 10));
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = positions.map((_, i) => (i % 3 === 2 ? 1 : 0));
  const mesh = new Mesh('game-star', scene);
  vd.applyToMesh(mesh, false);
  return mesh;
}

/** Flecha plana sobre el piso (plano XZ), apuntando a +X, de 1 m de largo. */
function arrowMesh(scene: Scene): Mesh {
  // Cuerpo y punta como chevrón: se lee de lejos y no parece una cruz.
  const p: Array<[number, number]> = [
    [-0.5, -0.11],
    [0.1, -0.11],
    [0.1, -0.3],
    [0.5, 0],
    [0.1, 0.3],
    [0.1, 0.11],
    [-0.5, 0.11],
  ];
  const positions = p.flatMap(([x, z]) => [x, 0, z]);
  const indices = [0, 1, 5, 0, 5, 6, 2, 3, 4, 1, 2, 4, 1, 4, 5];
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = p.flatMap(() => [0, 1, 0]);
  const mesh = new Mesh('game-arrow', scene);
  vd.applyToMesh(mesh, false);
  return mesh;
}
