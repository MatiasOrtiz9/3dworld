import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Materials } from '../Materials';
import { PALETTE } from '../Palette';

export type TintPrim = 'box' | 'cylinder' | 'cone' | 'plane';

/**
 * 'lit': PBR blanco con el color por instancia (fachadas lejanas, toldos,
 * aires acondicionados, ropa tendida, pintura de la calzada).
 * 'glow': sin luz, el color tal cual (interiores encendidos de los locales,
 * semáforos, luminarias): se lee "iluminado" a cualquier hora.
 * 'night': como 'glow', pero sólo de noche (ventanas encendidas de la ciudad
 * de fondo): se prende y se apaga con las ventanas encendidas de la granja.
 */
export type TintShade = 'lit' | 'glow' | 'night';

type Rgb = Color3 | readonly [number, number, number];

interface Group {
  prim: TintPrim;
  shade: TintShade;
  matrices: number[];
  colors: number[];
  count: number;
}

/**
 * Granja de instancias finas con COLOR POR INSTANCIA.
 *
 * La `InstanceFarm` cobra un draw call por cada combinación primitiva +
 * material, y cada color distinto es un material: un toldo rojo, uno
 * amarillo y uno verde son tres draw calls, y los productos de las vitrinas,
 * los carteles y la ropa tendida de un barrio entero serían decenas. En el
 * visor no hay margen para eso (≈ 213 de 230 draw calls ya estaban usados).
 *
 * Acá el color viaja en un búfer por instancia (`instanceColor`, que Babylon
 * multiplica por el albedo en PBR y en el material estándar), así que TODO el
 * detalle de color de la ciudad cuesta un draw call por primitiva y sombreado:
 * hoy ~6 en total, con cientos de colores.
 *
 * No proyecta sombra (la lista de proyectores la arma `City` con la granja
 * principal); sí la recibe. Por eso lo que importa como volumen a la luz
 * —muros, losas, árboles— sigue en la granja de siempre, y acá va el detalle.
 */
export class TintFarm {
  private readonly groups = new Map<string, Group>();
  private meshes: Mesh[] = [];
  private committed = false;

  constructor(
    private readonly scene: Scene,
    private readonly mats: Materials,
  ) {}

  add(
    prim: TintPrim,
    shade: TintShade,
    color: Rgb,
    pos: Vector3,
    size: Vector3,
    rotY = 0,
    rotX = 0,
    rotZ = 0,
  ): void {
    if (this.committed) throw new Error('TintFarm: no se puede agregar después de commit()');
    const key = `${prim}|${shade}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { prim, shade, matrices: [], colors: [], count: 0 };
      this.groups.set(key, g);
    }
    const m = Matrix.Compose(size, Quaternion.FromEulerAngles(rotX, rotY, rotZ), pos);
    for (let i = 0; i < 16; i++) g.matrices.push(m.m[i]);
    if (color instanceof Color3) g.colors.push(color.r, color.g, color.b, 1);
    else g.colors.push(color[0], color[1], color[2], 1);
    g.count++;
  }

  /** Caja alineada apoyada en `y0`. */
  boxOn(shade: TintShade, color: Rgb, x: number, z: number, w: number, h: number, d: number, y0 = 0, rotY = 0): void {
    this.add('box', shade, color, new Vector3(x, y0 + h / 2, z), new Vector3(w, h, d), rotY);
  }

  /**
   * Paño vertical (2 triángulos, una sola cara) que mira hacia (nx, nz).
   * Para fajas de ventanas lejanas y carteles: una caja serían 12.
   */
  panel(shade: TintShade, color: Rgb, x: number, y: number, z: number, w: number, h: number, nx: number, nz: number): void {
    // El plano de Babylon mira a −Z; girar θ sobre Y lo lleva a (−sin θ, −cos θ).
    this.add('plane', shade, color, new Vector3(x, y, z), new Vector3(w, h, 1), Math.atan2(-nx, -nz));
  }

  /** Paño horizontal mirando hacia arriba (pintura de la calzada). */
  decal(color: Rgb, x: number, y: number, z: number, w: number, d: number, rotY = 0): void {
    // Girar +90° sobre X lleva la normal −Z del plano a +Y.
    this.add('plane', 'lit', color, new Vector3(x, y, z), new Vector3(w, d, 1), rotY, Math.PI / 2);
  }

  /** Mallas subidas (después de `commit`): para sombras y precompilado. */
  get sourceMeshes(): Mesh[] {
    return this.meshes;
  }

  get instanceCount(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.count;
    return n;
  }

  /** Sube los búferes. Devuelve las mallas (una por primitiva y sombreado). */
  commit(): Mesh[] {
    if (this.committed) return this.meshes;
    this.committed = true;
    // Blanco: el color lo pone la instancia. Ambos materiales salen de la
    // biblioteca: se congelan y se liberan con el resto de la ciudad.
    const lit = this.mats.surface(new Color3(1, 1, 1), 0.82, 0, null);
    const glow = this.mats.glow(new Color3(1, 1, 1), 1);
    // Las ventanas encendidas de la granja (`City.setLitWindows`) mandan:
    // las de 'night' siguen su estado sin que `City` las conozca.
    const litWindows = this.scene.getMeshByName(`box|${this.mats.glow(PALETTE.glassLit, 0.7).name}`);
    for (const [key, g] of this.groups) {
      if (g.count === 0) continue;
      const mesh = this.createSource(g.prim, `tint|${key}`, g.shade === 'lit' ? lit : glow);
      if (g.shade === 'night') {
        mesh.setEnabled(litWindows?.isEnabled(false) ?? false);
        litWindows?.onEnabledStateChangedObservable.add((on) => mesh.setEnabled(on));
      }
      mesh.thinInstanceSetBuffer('matrix', new Float32Array(g.matrices), 16, true);
      mesh.thinInstanceSetBuffer('color', new Float32Array(g.colors), 4, true);
      // Con búfer estático Babylon no recalcula el volumen (HANDOFF 1).
      mesh.thinInstanceRefreshBoundingInfo(true);
      mesh.freezeWorldMatrix();
      mesh.receiveShadows = g.shade === 'lit';
      g.matrices.length = 0;
      g.colors.length = 0;
      this.meshes.push(mesh);
    }
    // La ciudad se reconstruye al cambiar la calidad: `City.dispose` libera
    // la biblioteca de materiales, y con ella estas mallas (que no son de la
    // granja principal y si no quedarían duplicadas en la escena).
    lit.onDisposeObservable.addOnce(() => this.dispose());
    return this.meshes;
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose(false, false);
    this.meshes = [];
    this.groups.clear();
  }

  private createSource(prim: TintPrim, name: string, material: Material): Mesh {
    let mesh: Mesh;
    switch (prim) {
      case 'box':
        mesh = CreateBox(name, { size: 1 }, this.scene);
        break;
      case 'cylinder':
        mesh = CreateCylinder(name, { height: 1, diameter: 1, tessellation: 6 }, this.scene);
        break;
      case 'cone':
        mesh = CreateCylinder(name, { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 6 }, this.scene);
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
