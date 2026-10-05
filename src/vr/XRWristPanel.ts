import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { UI } from '../ui/draw';
import {
  chamferRect,
  circuitLine,
  diamond,
  drawKeyRow,
  ellipsize,
  fitFont,
  font,
  HOLO,
  miniSeal,
  spacedLeft,
  spacedWidth,
  wrapLines,
} from '../game/xr/holoStyle';

export interface HudInfo {
  /** Ambiente de la escuela en el que se está, o vacío afuera. */
  place: string;
  /** Avance de la misión, p. ej. "2 / 5 docentes" (se muestra si no hay `objective`). */
  progress: string;
  /** Lo que hay que hacer ahora, en una frase. */
  objective?: string;
  /** Distancia al objetivo ("12 m"). */
  distance?: string;
  /** Sellos del Pasaporte 40 ("3/8"). */
  stamps?: string;
  /** Capítulo de la historia ("Capítulo 2 · El patio"). */
  chapter?: string;
}

const W = 640;
const H = 320;
/** Ancho real del panel (m): a la distancia de la muñeca (~40 cm) el texto de 30 px mide ~9 mm. */
const WIDTH = 0.19;
const HEIGHT = (WIDTH * H) / W;
/** Dónde va el panel respecto de la empuñadura: sobre el dorso, un poco hacia el codo. */
const PANEL_AT = { x: 0, y: 0.09, z: -0.035 };
/** La flecha del objetivo, sobre el borde de arriba del panel. */
const ARROW_AT = { x: 0, y: 0.09 + HEIGHT / 2 + 0.03, z: -0.035 };

const GOLD = UI.gold;
/** Latido de la flecha (Hz): lento lejos, más rápido a menos de 5 m ("ya llegás"). */
const PULSE_HZ = 1.2;
const PULSE_NEAR_HZ = 2.5;

/**
 * Panel de muñeca: lo que en escritorio dicen el cartel "Estás en", la barra
 * de misión y los sellos, que en el visor no existen (no hay HTML dentro del
 * casco).
 *
 * Flota sobre el control izquierdo y siempre mira a los ojos: se lee
 * levantando la mano, como un reloj, y con la mano baja queda fuera de la
 * vista. Encima, una flecha dorada chata señala en planta hacia el objetivo,
 * como una brújula: se orienta y late en cada cuadro sin redibujar ninguna
 * textura (a menos de 5 m late más rápido: "ya llegás"). El texto se
 * redibuja sólo cuando cambia, con el estilo VISOR 40 de los paneles.
 */
export class WristPanel {
  private readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private readonly arrow: Mesh;
  private readonly arrowMaterial: StandardMaterial;
  private readonly orient: Observer<Scene>;
  private grip: TransformNode | null = null;
  private target: { x: number; y: number; z: number } | null = null;
  private drawn = '';
  private near = false;
  private pulseT = 0;
  private readonly gold = Color3.FromHexString(GOLD);
  private readonly tmpParent = new Matrix();
  private readonly tmpWorld = new Matrix();
  private readonly arrowRot = new Quaternion();

  constructor(scene: Scene) {
    this.texture = new DynamicTexture('xrWristTex', { width: W, height: H }, scene, true);
    this.texture.hasAlpha = true;
    // Se lee de costado (la muñeca rara vez queda de frente): el filtrado
    // anisotrópico mantiene nítidas las letras inclinadas.
    this.texture.anisotropicFilteringLevel = 4;
    this.material = new StandardMaterial('xrWristMat', scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveTexture = this.texture;
    this.material.opacityTexture = this.texture;
    this.material.disableLighting = true;
    this.material.fogEnabled = false;
    this.material.backFaceCulling = false;

    this.mesh = CreatePlane('xrWristPanel', { width: WIDTH, height: HEIGHT }, scene);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    // Por encima de la ciudad: con la mano contra una pared se sigue leyendo.
    this.mesh.renderingGroupId = 1;
    this.mesh.setEnabled(false);

    this.arrowMaterial = new StandardMaterial('xrWristArrowMat', scene);
    this.arrowMaterial.diffuseColor = Color3.Black();
    this.arrowMaterial.specularColor = Color3.Black();
    this.arrowMaterial.emissiveColor = Color3.FromHexString(GOLD);
    this.arrowMaterial.disableLighting = true;
    this.arrowMaterial.fogEnabled = false;
    this.arrowMaterial.backFaceCulling = false;
    this.arrow = buildArrow(scene);
    this.arrow.material = this.arrowMaterial;
    this.arrow.isPickable = false;
    this.arrow.renderingGroupId = 1;
    this.arrow.rotationQuaternion = this.arrowRot;
    this.arrow.setEnabled(false);

    this.orient = scene.onBeforeRenderObservable.add(this.orientArrow);
  }

  /** Engancha el panel (y la flecha) a la empuñadura izquierda, o los esconde con `null`. */
  attachTo(grip: TransformNode | null): void {
    this.grip = grip;
    this.mesh.parent = grip;
    this.mesh.position.set(PANEL_AT.x, PANEL_AT.y, PANEL_AT.z);
    this.mesh.setEnabled(Boolean(grip));
    this.arrow.parent = grip;
    this.arrow.position.set(ARROW_AT.x, ARROW_AT.y, ARROW_AT.z);
    this.arrow.setEnabled(Boolean(grip && this.target));
  }

  /** Hacia dónde señala la flecha (punto del mundo); `null` la esconde. */
  setTarget(p: { x: number; y: number; z: number } | null): void {
    this.target = p ? { x: p.x, y: p.y, z: p.z } : null;
    this.arrow.setEnabled(Boolean(this.grip && this.target));
  }

  set(info: HudInfo): void {
    const key = [info.place, info.progress, info.objective ?? '', info.distance ?? '', info.stamps ?? '', info.chapter ?? ''].join('|');
    if (key === this.drawn) return;
    this.drawn = key;
    // "Ya llegás": a menos de 5 m del objetivo la flecha late más rápido.
    const m = /^(\d+(?:[.,]\d+)?)\s*m$/.exec((info.distance ?? '').trim());
    this.near = m !== null && Number(m[1].replace(',', '.')) < 5;
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    const cuts = [22, 6, 22, 6] as const;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, HOLO.glassTop);
    g.addColorStop(0.6, HOLO.glassMid);
    g.addColorStop(1, HOLO.glassBot);
    chamferRect(ctx, 4, 4, W - 8, H - 8, cuts);
    ctx.fillStyle = g;
    ctx.fill();
    // Franja de arriba (dónde estoy): un velo cian.
    ctx.save();
    chamferRect(ctx, 4, 4, W - 8, H - 8, cuts);
    ctx.clip();
    ctx.fillStyle = 'rgba(63,230,224,0.07)';
    ctx.fillRect(0, 0, W, 106);
    ctx.restore();
    // Sin brillo: la muñeca se mira de cerca y un halo ahí cansa la vista.
    ctx.strokeStyle = HOLO.cyan;
    ctx.lineWidth = 3;
    chamferRect(ctx, 4, 4, W - 8, H - 8, cuts);
    ctx.stroke();

    // Arriba: dónde estoy y los sellos. Afuera de la escuela se dice eso:
    // "Estás en Recorrido 40" (la marca) no es un lugar y confundía.
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = HOLO.cyanText;
    ctx.font = font(700, 24);
    spacedLeft(ctx, 'ESTÁS EN', 28, 42, 3);
    let right = W - 28;
    if (info.stamps) {
      // "3/8 sellos" → el sello mini y "3/8" (el sello ya dice qué se cuenta).
      const count = info.stamps.replace(/\s*sellos?$/i, '');
      ctx.font = font(800, 30);
      const tw = ctx.measureText(count).width;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = HOLO.gold;
      ctx.fillText(count, W - 28, 55);
      miniSeal(ctx, W - 28 - tw - 32, 54, 22);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      right = W - 28 - tw - 66;
    }
    const place = info.place || 'Afuera de la escuela';
    fitFont(ctx, place, 700, 36, 30, right - 28);
    ctx.fillStyle = HOLO.text;
    ctx.fillText(ellipsize(ctx, place, right - 28), 28, 88);

    circuitLine(ctx, 28, 112, W - 28);

    // Capítulo y objetivo (rombo de misión, hasta dos líneas) y la distancia
    // en una casilla dorada, centrados entre la línea y el pie: sin el hueco
    // muerto que quedaba arriba de las fichas.
    const FOOT_CY = H - 34;
    const top = 126;
    const bottom = FOOT_CY - 26;
    let textRight = W - 28;
    let distW = 0;
    const arrowUp = info.distance ? !/[▲▼]/.test(info.distance) : false;
    if (info.distance) {
      ctx.font = font(800, 28);
      distW = ctx.measureText(info.distance).width + 28 + (arrowUp ? 24 : 0);
      textRight = W - 28 - distW - 14;
    }
    ctx.font = font(600, 30);
    const objective = info.objective || info.progress;
    const lines = wrapLines(ctx, objective, textRight - 54, 2);
    const chapterH = info.chapter ? 36 : 0;
    const LH = 38;
    const blockH = chapterH + lines.length * LH;
    const y0 = top + Math.max(0, (bottom - top - blockH) / 2);
    ctx.textBaseline = 'middle';
    if (info.chapter) {
      ctx.fillStyle = HOLO.gold;
      ctx.font = font(700, 24);
      const ch = info.chapter.toUpperCase();
      if (spacedWidth(ctx, ch, 2) <= W - 56) spacedLeft(ctx, ch, 28, y0 + 14, 2);
      else ctx.fillText(ellipsize(ctx, ch, W - 56), 28, y0 + 14);
    }
    const objCy = y0 + chapterH + LH / 2;
    if (info.distance) {
      const dx = W - 28 - distW;
      chamferRect(ctx, dx, objCy - 22, distW, 44, 8);
      ctx.fillStyle = HOLO.gold;
      ctx.fill();
      ctx.fillStyle = HOLO.ink;
      if (arrowUp) {
        // ▲ dibujado ("adelante"): el glifo de la fuente no siempre está.
        const ax = dx + 22;
        ctx.beginPath();
        ctx.moveTo(ax, objCy - 9);
        ctx.lineTo(ax + 9, objCy + 7);
        ctx.lineTo(ax - 9, objCy + 7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.font = font(800, 28);
      ctx.textAlign = 'left';
      ctx.fillText(info.distance, dx + 14 + (arrowUp ? 24 : 0), objCy + 1);
    }
    diamond(ctx, 34, objCy, 12);
    ctx.fillStyle = HOLO.text;
    ctx.font = font(600, 30);
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, 54, objCy + 1 + i * LH));
    ctx.textBaseline = 'alphabetic';

    // Al pie, los botones que más se usan, como fichas. El clic es el del
    // stick DERECHO (el del izquierdo corre): la ficha lo dice.
    drawKeyRow(ctx, 'Y: menú  ·  A: usar  ·  Clic der.: ¿adónde voy?', 28, FOOT_CY, W - 56, { h: 34, size: 26, align: 'left' });
    this.texture.update(true);
  }

  dispose(): void {
    this.mesh.getScene().onBeforeRenderObservable.remove(this.orient);
    this.mesh.dispose();
    this.material.dispose();
    this.arrow.dispose();
    this.arrowMaterial.dispose();
    this.texture.dispose();
  }

  /**
   * La flecha es hija del agarre (va con la mano) pero apunta en el MUNDO:
   * su rotación local es la del mundo deseada (sólo rumbo, chata) por la
   * inversa de la rotación de la mano. Babylon compone mundo = local × padre.
   */
  private orientArrow = (): void => {
    const grip = this.grip;
    const t = this.target;
    if (!grip || !t || !this.arrow.isEnabled()) return;
    // Latido dorado (sólo el color y la escala de una malla chica, nada se redibuja).
    this.pulseT += this.mesh.getScene().getEngine().getDeltaTime() / 1000;
    const hz = this.near ? PULSE_NEAR_HZ : PULSE_HZ;
    const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * hz * this.pulseT);
    this.arrowMaterial.emissiveColor.copyFrom(this.gold).scaleInPlace(0.7 + 0.3 * w);
    this.arrow.scaling.setAll(this.near ? 1 + 0.12 * w : 1);
    grip.computeWorldMatrix(true);
    const at = this.arrow.getAbsolutePosition();
    const dx = t.x - at.x;
    const dz = t.z - at.z;
    // Encima del objetivo la flecha no tiene rumbo: se queda como está.
    if (dx * dx + dz * dz < 0.04) return;
    grip.absoluteRotationQuaternion.toRotationMatrix(this.tmpParent);
    this.tmpParent.transposeToRef(this.tmpParent); // rotación pura: inversa = traspuesta
    Matrix.RotationYToRef(Math.atan2(dx, dz), this.tmpWorld);
    this.tmpWorld.multiplyToRef(this.tmpParent, this.tmpWorld);
    Quaternion.FromRotationMatrixToRef(this.tmpWorld, this.arrowRot);
  };
}

/**
 * Flecha chata en el plano XZ apuntando a +Z (4 cm de largo): siete
 * vértices, tres triángulos, un solo draw call.
 */
function buildArrow(scene: Scene): Mesh {
  const mesh = new Mesh('xrWristArrow', scene);
  const s = 0.045;
  // prettier-ignore
  const pts = [
    0, 0, 0.55 * s, // punta
    -0.42 * s, 0, 0.05 * s, // ala izquierda
    0.42 * s, 0, 0.05 * s, // ala derecha
    -0.16 * s, 0, 0.05 * s, // cuello
    0.16 * s, 0, 0.05 * s,
    -0.16 * s, 0, -0.45 * s, // cola
    0.16 * s, 0, -0.45 * s,
  ];
  const vd = new VertexData();
  vd.positions = pts;
  vd.indices = [0, 2, 1, 3, 4, 6, 3, 6, 5];
  vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  vd.applyToMesh(mesh);
  return mesh;
}
