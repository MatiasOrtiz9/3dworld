import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { WebXRInput } from '@babylonjs/core/XR/webXRInput';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import type { XRButton, XRHand } from './XRInput';
import { chamferRect, ellipsize, fitFont, HOLO, keyChip, keyChipWidth } from '../game/xr/holoStyle';

/**
 * Qué hace cada botón, según el mapeo del juego (ver `XRInput`). Lo leen los
 * rótulos junto a los mandos.
 */
export const BUTTON_HINTS: Record<XRHand, ReadonlyArray<{ key: string; text: string }>> = {
  left: [
    { key: 'Gatillo', text: 'apuntar y elegir' },
    { key: 'Grip', text: 'agarrar y mover el panel' },
    { key: 'X', text: 'usar · aceptar' },
    { key: 'Y', text: 'menú del juego' },
    { key: 'Stick', text: 'caminar · clic: correr' },
  ],
  right: [
    { key: 'Gatillo', text: 'apuntar y elegir' },
    { key: 'Grip', text: 'agarrar y mover el panel' },
    { key: 'A', text: 'usar · aceptar' },
    { key: 'B', text: 'volver · cerrar' },
    { key: 'Stick', text: 'girar · ↑ saltar · ↓ paso' },
    // El clic del stick en su propia fila, con el mismo nombre que en la
    // muñeca y en Controles ("centrar" no le decía nada a nadie).
    { key: 'Clic', text: '¿adónde voy?' },
  ],
};

/** Dónde está cada botón en la forma del mando (espacio de la empuñadura; `s` = lado). */
function buttonSpot(button: XRButton, s: number): [number, number, number] {
  switch (button) {
    case 'trigger':
      return [0, -0.006, 0.04];
    case 'grip':
      return [-s * 0.02, -0.036, -0.008];
    case 'primary':
      return [s * 0.014, 0.022, -0.006];
    case 'secondary':
      return [s * 0.013, 0.026, 0.012];
    case 'stick':
      return [0, 0.036, 0.006];
  }
}

/**
 * Lienzo del rótulo. Más ancho que alto: las funciones van en letra de 30
 * sin comprimir. Alto para seis filas (la mano derecha: el clic del stick
 * va aparte).
 */
const HINT_W = 640;
const HINT_H = 336;
/** Ancho del rótulo (m): a medio metro, la letra se lee como un cartel a 3 m. */
const HINT_WIDTH = 0.1875;
/** Columna fija de las fichas (px): las funciones quedan alineadas. */
const CHIP_COL = 132;
/** Cuánto dura el destello de un botón apretado (ms). */
const FLASH_MS = 150;

interface Model {
  mesh: Mesh;
  hand: XRHand;
  flash: Mesh;
  timer: number;
  /** Cuándo empezó el destello (ms): la esfera crece de 1 a 1,5 mientras dura. */
  flashAt: number;
}

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
 *
 * Encima, dos ayudas: un destello de ~150 ms sobre el botón que se acaba de
 * apretar (`flash`) y, cuando el juego lo pide, un rótulo junto a cada mando
 * con la función de cada botón (`setHints`).
 */
export class ControllerModels {
  private readonly template: Mesh;
  private readonly material: StandardMaterial;
  private readonly flashMaterial: StandardMaterial;
  private readonly hintMaterials: StandardMaterial[] = [];
  private readonly hintTextures: DynamicTexture[] = [];
  private readonly hints: Record<XRHand, Mesh>;
  private hintsOn = false;
  private readonly models = new Map<string, Model>();
  private readonly addedObserver: Observer<WebXRInputSource>;
  private readonly removedObserver: Observer<WebXRInputSource>;
  private readonly frameObserver: Observer<Scene>;

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

    this.flashMaterial = new StandardMaterial('xrControllerFlash', scene);
    this.flashMaterial.diffuseColor = Color3.Black();
    this.flashMaterial.specularColor = Color3.Black();
    // Cian: apretado = cian, como el botón apretado en los paneles.
    this.flashMaterial.emissiveColor = Color3.FromHexString('#8ff7f2');
    this.flashMaterial.disableLighting = true;
    this.flashMaterial.fogEnabled = false;
    this.hints = { left: this.buildHint(scene, 'left'), right: this.buildHint(scene, 'right') };

    this.addedObserver = input.onControllerAddedObservable.add(this.attach);
    this.removedObserver = input.onControllerRemovedObservable.add(this.detach);
    for (const source of input.controllers) this.attach(source);
    // Sólo hace algo mientras dura un destello (150 ms): escala de una esfera.
    this.frameObserver = scene.onBeforeRenderObservable.add(() => {
      for (const model of this.models.values()) {
        if (!model.flash.isEnabled()) continue;
        const t = Math.min(1, (performance.now() - model.flashAt) / FLASH_MS);
        model.flash.scaling.setAll(1 + 0.5 * t);
      }
    });
  }

  dispose(): void {
    this.template.getScene().onBeforeRenderObservable.remove(this.frameObserver);
    this.input.onControllerAddedObservable.remove(this.addedObserver);
    this.input.onControllerRemovedObservable.remove(this.removedObserver);
    for (const model of this.models.values()) {
      clearTimeout(model.timer);
      model.mesh.dispose();
    }
    this.models.clear();
    for (const hand of ['left', 'right'] as const) this.hints[hand].dispose();
    for (const m of this.hintMaterials) m.dispose();
    for (const t of this.hintTextures) t.dispose();
    this.template.dispose();
    this.material.dispose();
    this.flashMaterial.dispose();
  }

  /**
   * Rótulos junto a cada mando con lo que hace cada botón. Aprender los
   * botones mirando las propias manos es más rápido que leer una lista en
   * un panel; el juego decide cuándo mostrarlos (primera vez, Controles).
   */
  setHints(on: boolean): void {
    this.hintsOn = on;
    for (const hand of ['left', 'right'] as const) this.syncHint(hand);
  }

  /** Destello sobre el botón apretado: confirma qué botón leyó el juego. */
  flash(hand: XRHand, button: XRButton): void {
    for (const model of this.models.values()) {
      if (model.hand !== hand) continue;
      const [x, y, z] = buttonSpot(button, hand === 'left' ? -1 : 1);
      model.flash.position.set(x, y, z);
      model.flash.scaling.setAll(1);
      model.flashAt = performance.now();
      model.flash.setEnabled(true);
      clearTimeout(model.timer);
      model.timer = window.setTimeout(() => model.flash.setEnabled(false), FLASH_MS);
    }
  }

  private syncHint(hand: XRHand): void {
    const hint = this.hints[hand];
    let holder: TransformNode | null = null;
    for (const model of this.models.values()) if (model.hand === hand) holder = model.mesh.parent as TransformNode | null;
    hint.parent = holder;
    hint.setEnabled(this.hintsOn && holder !== null);
  }

  /**
   * Rótulo de una mano: textura chica dibujada una sola vez. Va hacia afuera
   * del mando (a la izquierda del izquierdo, a la derecha del derecho): no
   * tapa el panel de muñeca ni el otro mando, y siempre mira a los ojos.
   */
  private buildHint(scene: Scene, hand: XRHand): Mesh {
    const texture = new DynamicTexture(`xrHintTex-${hand}`, { width: HINT_W, height: HINT_H }, scene, true);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, HINT_W, HINT_H);
    // Estilo VISOR 40: vidrio oscuro biselado, borde cian, fichas doradas como en el pie de los paneles.
    chamferRect(ctx, 4, 4, HINT_W - 8, HINT_H - 8, [20, 6, 20, 6]);
    ctx.fillStyle = 'rgba(7,20,23,0.9)';
    ctx.fill();
    ctx.strokeStyle = HOLO.cyan;
    ctx.lineWidth = 2;
    ctx.stroke();
    const rows = BUTTON_HINTS[hand];
    const rowH = (HINT_H - 36) / rows.length;
    const textX = 22 + CHIP_COL + 16;
    const textW = HINT_W - textX - 22;
    ctx.textBaseline = 'middle';
    rows.forEach((row, i) => {
      const y = 18 + rowH * (i + 0.5);
      const cw = keyChipWidth(ctx, row.key, 40);
      keyChip(ctx, row.key, 22 + CHIP_COL - cw, y, 40);
      ctx.fillStyle = HOLO.text;
      ctx.textAlign = 'left';
      fitFont(ctx, row.text, 500, 30, 26, textW);
      ctx.fillText(ellipsize(ctx, row.text, textW), textX, y + 1);
    });
    texture.update(true);
    this.hintTextures.push(texture);

    const material = new StandardMaterial(`xrHintMat-${hand}`, scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    material.disableLighting = true;
    material.fogEnabled = false;
    material.backFaceCulling = false;
    this.hintMaterials.push(material);

    const mesh = CreatePlane(`xrHint-${hand}`, { width: HINT_WIDTH, height: (HINT_WIDTH * HINT_H) / HINT_W }, scene);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    // Por encima de la ciudad, como el panel de muñeca: se lee contra una pared.
    mesh.renderingGroupId = 1;
    const s = hand === 'left' ? -1 : 1;
    // Hacia afuera y por debajo del panel de muñeca (que va 9 cm arriba del
    // mando izquierdo): a la altura del mando, la muñeca le tapaba la
    // esquina y cortaba "apuntar", "agarrar".
    mesh.position.set(s * (0.05 + HINT_WIDTH / 2), -0.035, 0.02);
    mesh.setEnabled(false);
    return mesh;
  }

  private attach = (source: WebXRInputSource): void => {
    // Con seguimiento de manos se dibujan las articulaciones, no un control.
    if (source.inputSource.hand || this.models.has(source.uniqueId)) return;
    const holder = source.grip ?? source.pointer;
    const hand: XRHand = source.inputSource.handedness === 'left' ? 'left' : 'right';
    const mesh = this.template.clone(`xrController-${source.inputSource.handedness}`, holder);
    mesh.setEnabled(true);
    mesh.isPickable = false;
    const flash = CreateSphere(`xrControllerFlash-${hand}`, { diameter: 0.015, segments: 6 }, mesh.getScene());
    flash.material = this.flashMaterial;
    flash.isPickable = false;
    flash.parent = mesh;
    flash.setEnabled(false);
    this.models.set(source.uniqueId, { mesh, hand, flash, timer: 0, flashAt: 0 });
    this.syncHint(hand);
    if (source.inputSource.handedness === 'left') this.onLeftGrip(holder);
  };

  private detach = (source: WebXRInputSource): void => {
    const model = this.models.get(source.uniqueId);
    if (!model) return;
    clearTimeout(model.timer);
    model.mesh.dispose();
    this.models.delete(source.uniqueId);
    // El rótulo es compartido: se suelta del nodo que se va antes de que Babylon lo destruya.
    this.syncHint(model.hand);
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
