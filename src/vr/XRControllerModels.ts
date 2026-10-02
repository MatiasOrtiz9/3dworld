import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { WebXRInput } from '@babylonjs/core/XR/webXRInput';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';

/**
 * Mandos dibujados por código.
 *
 * Babylon descarga los modelos de los controles de un CDN y los carga con el
 * importador glTF, que este proyecto no incluye (regla de cero assets, y el
 * importador pesa más que toda la ciudad). Resultado medido en un Quest
 * emulado: ningún mando visible y avisos en consola. Sin ver las manos se
 * pierde la escala del propio cuerpo y apuntar se vuelve adivinar.
 *
 * Una forma simple —empuñadura, cara superior con el stick y el aro de
 * seguimiento— alcanza para saber dónde está cada mano. Es UNA malla con
 * colores por vértice, clonada por mano: un draw call por control.
 */
export class ControllerModels {
  private readonly template: Mesh;
  private readonly material: StandardMaterial;
  private readonly models = new Map<string, Mesh>();
  private readonly addedObserver: Observer<WebXRInputSource>;
  private readonly removedObserver: Observer<WebXRInputSource>;

  constructor(
    scene: Scene,
    private readonly input: WebXRInput,
    /** Avisa cuando aparece (o se va) el control izquierdo: ahí va el panel de muñeca. */
    private readonly onLeftGrip: (node: TransformNode | null) => void = () => {},
  ) {
    this.material = new StandardMaterial('xrControllerMat', scene);
    this.material.diffuseColor = Color3.White();
    this.material.specularColor = new Color3(0.25, 0.25, 0.25);
    this.material.specularPower = 48;
    // Un poco de luz propia: a la sombra de un edificio no deben desaparecer.
    this.material.emissiveColor = new Color3(0.12, 0.12, 0.12);
    this.material.fogEnabled = false;
    this.template = buildTemplate(scene);
    this.template.material = this.material;
    this.template.setEnabled(false);

    this.addedObserver = input.onControllerAddedObservable.add(this.attach);
    this.removedObserver = input.onControllerRemovedObservable.add(this.detach);
    for (const source of input.controllers) this.attach(source);
  }

  dispose(): void {
    this.input.onControllerAddedObservable.remove(this.addedObserver);
    this.input.onControllerRemovedObservable.remove(this.removedObserver);
    for (const model of this.models.values()) model.dispose();
    this.models.clear();
    this.template.dispose();
    this.material.dispose();
  }

  private attach = (source: WebXRInputSource): void => {
    // Con seguimiento de manos se dibujan las articulaciones, no un control.
    if (source.inputSource.hand || this.models.has(source.uniqueId)) return;
    const holder = source.grip ?? source.pointer;
    const model = this.template.clone(`xrController-${source.inputSource.handedness}`, holder);
    model.setEnabled(true);
    model.isPickable = false;
    this.models.set(source.uniqueId, model);
    if (source.inputSource.handedness === 'left') this.onLeftGrip(holder);
  };

  private detach = (source: WebXRInputSource): void => {
    const model = this.models.get(source.uniqueId);
    if (!model) return;
    model.dispose();
    this.models.delete(source.uniqueId);
    if (source.inputSource.handedness === 'left') this.onLeftGrip(null);
  };
}

/**
 * Forma de un control tipo Touch, en el espacio de la empuñadura de WebXR
 * (convertido por Babylon: +Z hacia donde apunta, +Y hacia arriba). El origen
 * está en la palma.
 */
function buildTemplate(scene: Scene): Mesh {
  const body = new Color3(0.14, 0.16, 0.17);
  const face = new Color3(0.24, 0.27, 0.29);
  const accent = new Color3(0.31, 0.67, 0.48); // verde de la paleta (#4faa7a)
  const stick = new Color3(0.06, 0.06, 0.07);

  const grip = CreateCylinder('xrc-grip', { height: 0.11, diameterTop: 0.036, diameterBottom: 0.03, tessellation: 12 }, scene);
  grip.rotation.x = 0.42;
  grip.position.set(0, -0.032, -0.012);
  paint(grip, body);

  const top = CreateCylinder('xrc-face', { height: 0.018, diameter: 0.052, tessellation: 18 }, scene);
  top.rotation.x = -0.3;
  top.position.set(0, 0.016, 0.01);
  paint(top, face);

  const ring = CreateTorus('xrc-ring', { diameter: 0.074, thickness: 0.01, tessellation: 22 }, scene);
  ring.rotation.x = 1.05;
  ring.position.set(0, 0.02, 0.036);
  paint(ring, accent);

  const nub = CreateSphere('xrc-stick', { diameter: 0.017, segments: 6 }, scene);
  nub.position.set(0, 0.027, 0.006);
  paint(nub, stick);

  const merged = Mesh.MergeMeshes([grip, top, ring, nub], true, true)!;
  merged.name = 'xrControllerTemplate';
  merged.useVertexColors = true;
  merged.isPickable = false;
  return merged;
}

function paint(mesh: Mesh, color: Color3): void {
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}
