import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Ray } from '@babylonjs/core/Culling/ray';
import type { ActivityView, IconId } from '../activities/types';
import type { CardView, LineView } from '../../ui/Hud';
import { drawGrid, UI } from '../../ui/draw';
import { aimZone, distToZone, firstZone, navigateGrid, zoneByIndex, type NavZone } from './panelNav';
import {
  chamferRect,
  circuitLine,
  diamond,
  drawFeedbackBanner,
  drawHoloIcon,
  drawHoloSequence,
  drawKeyRow,
  drawLines,
  drawLock,
  ellipsize,
  fitFont,
  font,
  hexPath,
  HOLO,
  insetBox,
  kickerTab,
  miniSeal,
  paintHoloButton,
  parseHints,
  spacedCenter,
  spacedLeft,
  spacedWidth,
  splitKeyRows,
  wrapLines,
  wrapSmart,
  type HintSeg,
  type HoloButton,
  type HoloState,
} from './holoStyle';

/**
 * Panel del visor: diálogos, actividades, fichas, menús y la pantalla de
 * inicio dentro del mundo.
 *
 * En VR no hay HTML. Este panel es un plano dibujado en canvas que se ubica a
 * un brazo de distancia, un poco por debajo de los ojos y de frente al
 * jugador. No escucha al puntero de Babylon (en el Quest no siempre entregaba
 * el clic y no permite elegir al soltar): el director le pasa el rayo de cada
 * mando (`hitTest`), el resaltado (`setHighlight`) y los botones (`press`,
 * `release`, `confirm`, `back`, `navigate`).
 *
 * Contra las elecciones accidentales:
 *  - se elige al SOLTAR el gatillo sobre el botón que se apretó (como un
 *    botón de escritorio: si te arrepentís, llevás el láser lejos y soltás);
 *  - recién abierto no acepta nada por 280 ms: el gatillo o la A que lo abrió
 *    no puede elegir la primera opción de rebote;
 *  - el botón resaltado se agranda 24 px para el láser (histéresis): el
 *    temblor de la mano no lo hace titilar ni lo pierde en la separación;
 *  - los deshabilitados no tienen zona.
 *
 * Y para que sea fácil acertar: los huecos y bordes eligen el botón más
 * cercano (imán), y al soltar se tolera el cabeceo del mando (`releaseRay`).
 * El director fija el botón cuando el gatillo apenas se toca (ver `preZone`).
 *
 * Para leerlo caminando: queda fijo en el mundo (pegado a la cara marea),
 * gira siempre de frente al jugador y, si queda fuera de la vista más de
 * 0,6 s, se desliza suave delante (`follow`). Con el grip se arrastra a otro
 * lugar y queda ahí (`pinned`) hasta el próximo panel.
 *
 * Dibujo: el contenido se pinta UNA vez por `show` en un lienzo de respaldo;
 * resaltar o apretar copia ese respaldo y repinta sólo el botón afectado
 * antes de subir la textura. Nunca por cuadro.
 *
 * Además: el cartel flotante de lo que se está apuntando ("A · Saludar") y
 * avisos breves (sellos, lugares) que aparecen frente a la cara y se van.
 */

/** Un botón de una pantalla genérica (menú del juego, ajustes, título). */
export interface PanelButton {
  label: string;
  /** Texto chico: a la derecha del rótulo (como en el título HTML) o debajo si hay `value`. */
  sub?: string;
  /** Valor vigente de un ajuste, a la derecha ("Giro ........ Por pasos"). */
  value?: string;
  tone?: 'accent' | 'bad' | 'normal';
  disabled?: boolean;
  icon?: IconId;
}

/** Pantalla genérica: la arma el juego (menú de pausa, ajustes, pasaporte, título). */
export interface PanelScreen {
  /** 'title' dibuja el sello 40 y la marca como la pantalla de inicio HTML (#title en index.html). */
  style?: 'title' | 'default';
  kicker?: string;
  title: string;
  text?: string;
  /** Dibujo propio en la zona de contenido (sellos del pasaporte, esquema de controles). */
  draw?: (ctx: CanvasRenderingContext2D, area: { x: number; y: number; w: number; h: number }) => void;
  /** Alto de la zona de `draw` en píxeles del lienzo (1024 de ancho). Por defecto 320. */
  drawHeight?: number;
  buttons: PanelButton[];
  columns?: 1 | 2;
  /** Botón resaltado al abrir (por defecto, el primero habilitado). */
  focus?: number;
  /** Índice que elige B; omitido = B no hace nada. */
  back?: number;
  /** Texto chico al pie (por defecto, las pistas de los botones). */
  footer?: string;
}

export type PanelModel =
  | { kind: 'line'; line: LineView }
  | { kind: 'activity'; view: ActivityView }
  | { kind: 'card'; card: CardView }
  | { kind: 'menu'; kicker: string; title: string; text: string; buttons: string[] }
  | { kind: 'screen'; screen: PanelScreen };

/** Lo que toca un rayo: a qué distancia y sobre qué opción (−1 fuera de los botones). */
export interface PanelHit {
  distance: number;
  zone: number;
}

/** Ancho del lienzo; el alto se ajusta al contenido hasta `HMAX`. */
const W = 1024;
const HMAX = 1024;
/** Ancho real del panel (m): 1 px del lienzo ≈ 1,07 mm, un botón de 84 px ≈ 9 cm. */
const PANEL_W = { normal: 1.1, large: 1.5 } as const;
/** Distancia a los ojos: a un brazo para leer y apuntar; el título, más lejos y más grande. */
const DIST = { normal: 1.2, large: 2.0 } as const;
/** Inclinación hacia atrás (rad): por debajo de los ojos, el plano queda perpendicular a la mirada. */
const TILT = { normal: 0.12, large: 0.05 } as const;
const PAD = 56;
const BTN_H = 84;
const GAP = 18;
const FOOTER_H = 62;
/** Silueta del panel: cortes grandes arriba-izquierda y abajo-derecha (arriba-izq, arriba-der, abajo-der, abajo-izq). */
const FRAME_CUTS = [34, 12, 34, 12] as const;
/** Dónde va el sello 40 de la pantalla de inicio (y su anillo holográfico). */
const SEAL_Y = 106;
const RING_PX = 192;
/** Cuánto dura la aparición (s): entra dentro del armado (280 ms). */
const APPEAR_S = 0.18;
const SCAN_S = 0.22;
/** Destello al elegir: brillo del panel y del resplandor (s). */
const PICK_FLASH_S = 0.12;
const PICK_GLOW_S = 0.14;
/** Latido del resaltado (Hz) y su alfa mínimo/máximo; quieto en 0,35 mientras se apunta. */
const GLOW_HZ = 1.2;
const GLOW_REST = 0.35;
/** Cuánto sobresale el resplandor del botón resaltado (px) y cuánto entra en él. */
const GLOW_OUT = 18;
const GLOW_IN = 8;
/**
 * Tiempo tras abrir en que no se acepta ninguna elección (ms): el gatillo
 * que abrió el panel, o un roce al caminar, no eligen nada. Más largo
 * molestaba a quien ya sabía qué botón quería.
 */
const ARM_MS = 280;
/** Histéresis del láser sobre el botón resaltado (px del lienzo, ≈2,5 cm): el temblor de la mano no lo suelta. */
const HYSTERESIS = 24;
/**
 * Imán (px): apuntando al hueco entre botones o a su borde se toma el más
 * cercano. Antes un clic a 1 cm de un botón no hacía nada.
 */
const SNAP = 46;
/**
 * Al soltar el gatillo, cuánto se puede haber corrido el láser del botón
 * apretado (px, ≈10 cm a un brazo) y que igual cuente: al aflojar el dedo el
 * mando vuelve a cabecear. Más lejos (o fuera del panel por mucho) es
 * arrepentirse y no elige.
 */
const RELEASE_SLOP = 96;
/** Lo mismo cuando el láser quedó sobre el botón vecino (px). */
const RELEASE_SLOP_NEIGHBOR = 44;
/** Después de un láser sobre el panel, cuánto tiempo no se lo mueve solo (s). */
const AIM_HOLD_S = 0.8;
/** Antirrebote: dos caminos (gatillo y A) en el mismo cuadro no eligen dos veces. */
const DEBOUNCE_MS = 200;
/** Cuánto tiempo fuera de la vista antes de deslizarse delante (s), y cuánto dura el deslizamiento. */
const AWAY_S = 0.6;
const GLIDE_S = 0.35;
/** Fuera de la vista: más de ~40° del frente. */
const AWAY_COS = Math.cos((40 * Math.PI) / 180);
/**
 * Aviso: lienzo de 704 de ancho y un alto que alcanza para el título y tres
 * filas de detalle. Se dibuja centrado en alto; lo que sobra queda
 * transparente (el plano es siempre del mismo tamaño, 1 px ≈ 0,94 mm).
 */
const TOAST_W = 704;
const TOAST_TEX_H = 264;
const TOAST_PLANE_W = 0.66;

/**
 * Qué clase de aviso es: decide el bloque de la izquierda. La medalla del 40
 * es SÓLO para logros (un sello, un lugar nuevo); un consejo o una puerta que
 * se abrió llevan un ícono en un círculo cian (si no, el chico creía que
 * había ganado un sello).
 */
export type ToastKind = 'stamp' | 'place' | 'objective' | 'unlock' | 'controls' | 'voice' | 'info';

/** La clase de aviso según su título (los que arma el director). */
export function toastKind(title: string): ToastKind {
  if (/^sello/i.test(title)) return 'stamp';
  if (/lugar descubierto/i.test(title)) return 'place';
  if (/^controles$/i.test(title.trim())) return 'controls';
  if (/^se abri/i.test(title)) return 'unlock';
  if (/cumplido/i.test(title)) return 'objective';
  if (/^voces/i.test(title)) return 'voice';
  return 'info';
}

/** La pantalla de "recorrido completo": el premio del juego, con sello grande y borde dorado. */
function isFinale(model: PanelModel): boolean {
  return model.kind === 'menu' && /complet/i.test(model.kicker);
}

/** Un botón ya ubicado en el lienzo (lo que pinta `paintHoloButton`, más su índice de opción). */
interface Btn extends HoloButton {
  index: number;
}

/** Botón a ubicar (antes de saber dónde va). */
type BtnSpec = Omit<Btn, 'index' | 'x' | 'y' | 'w' | 'h' | 'font' | 'solid' | 'align'> & {
  solid?: boolean;
};

interface Glide {
  from: Vector3;
  to: Vector3;
  fromYaw: number;
  toYaw: number;
  t: number;
}

export class GamePanel3D {
  private readonly panel: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  /** Respaldo con el contenido sin estados (se pinta una vez por `show`). */
  private readonly base: HTMLCanvasElement;
  /** El mismo respaldo sin los botones: al resaltar uno se repone de acá su lugar antes de pintarlo. */
  private readonly bare: HTMLCanvasElement;
  private readonly baseUVs: number[];
  /** Resplandor del botón resaltado: un marco difuso que late (sólo su alfa cambia por cuadro). */
  private readonly glow: Mesh;
  private readonly glowMaterial: StandardMaterial;
  private readonly glowTexture: DynamicTexture;
  /** Barra de escaneo que baja al aparecer el panel. */
  private readonly scan: Mesh;
  private readonly scanMaterial: StandardMaterial;
  private readonly scanTexture: DynamicTexture;
  /** Anillo holográfico que gira alrededor del sello 40 del inicio (gira la textura, no la malla). */
  private readonly ring: Mesh;
  private readonly ringMaterial: StandardMaterial;
  private readonly ringTexture: DynamicTexture;
  private readonly label: Mesh;
  private readonly labelTexture: DynamicTexture;
  private readonly labelMaterial: StandardMaterial;
  private readonly toast: Mesh;
  private readonly toastTexture: DynamicTexture;
  private readonly toastMaterial: StandardMaterial;

  private btns: Btn[] = [];
  private zones: NavZone[] = [];
  private onPick: ((i: number) => void) | null = null;
  private model: PanelModel | null = null;
  /** Identidad del contenido: el mismo (actividad animándose, ajuste que cambió) es un refresco. */
  private modelKey: string | null = null;
  private size: 'normal' | 'large' = 'normal';
  private compact = false;
  /** Alto del contenido en el lienzo, y el alto al que están recortadas las coordenadas de textura. */
  private contentH = 600;
  private uvH = -1;
  private shownAt = 0;
  private lastPickAt = 0;
  private highlighted = -1;
  private pressed = -1;
  /** Botón que se ve apretado un instante después de elegir (A, o el gatillo al soltar). */
  private flash = { index: -1, left: 0 };

  /** Último `place`: se aplica en el `show` siguiente, cuando ya se sabe el alto y el tamaño. */
  private anchor: { head: Vector3; fx: number; fz: number } | null = null;
  private anchorPending = false;
  private isPinned = false;
  private dragging = false;
  private drag = { dist: 1, offR: 0, offU: 0 };
  private glide: Glide | null = null;
  private awayFor = 0;
  /** Tiempo desde que un láser estuvo por última vez sobre el panel (s). */
  private sinceAimed = Infinity;
  private readonly inv = new Matrix();
  private readonly tmpO = new Vector3();
  private readonly tmpD = new Vector3();

  private labelText = '';
  private toastLeft = 0;
  /** Cuánto dura el aviso de ahora (s): depende de cuánto hay para leer. */
  private toastDur = 3.4;
  /** Alto de reposo del aviso (el salto de entrada se suma encima). */
  private toastY = 0;
  /** Medio alto (m) de lo dibujado en el aviso: lo separa del borde de arriba del panel. */
  private toastHalf = 0.0675;

  /** Escala real del plano (sin la de presentación) y el tiempo desde que apareció (s). */
  private baseScale = { x: 1, y: 1 };
  private appearT = Infinity;
  /** Dónde está dibujado el resplandor (px del lienzo) y su latido. */
  private glowKey = '';
  private glowT = 0;
  private pickGlow = 0;
  private pickFlash = 0;
  private labelPop = Infinity;

  constructor(scene: Scene) {
    const mkMat = (name: string, tex: DynamicTexture) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      tex.hasAlpha = true;
      m.disableLighting = true;
      m.fogEnabled = false;
      return m;
    };
    this.texture = new DynamicTexture('gamePanelTex', { width: W, height: HMAX }, scene, true);
    // Letras nítidas aunque el panel quede de costado (arrastrado, o caminando al lado).
    this.texture.anisotropicFilteringLevel = 4;
    this.material = mkMat('gamePanel', this.texture);
    // Plano de 1 × 1 escalado al tamaño real; las coordenadas de textura se
    // recortan al alto del contenido (updatable) para no estirar el dibujo.
    this.panel = CreatePlane('gamePanel', { width: 1, height: 1, updatable: true }, scene);
    this.baseUVs = Array.from(this.panel.getVerticesData(VertexBuffer.UVKind) ?? [0, 0, 1, 0, 1, 1, 0, 1]);
    this.panel.material = this.material;
    // Sin picking de escena: el director prueba el rayo con `hitTest`, y un
    // pick de la ciudad no debe frenar en el panel.
    this.panel.isPickable = false;
    // Siempre por encima de la escuela: un panel tapado por una pared no se puede contestar.
    this.panel.renderingGroupId = 1;
    this.panel.setEnabled(false);

    this.base = document.createElement('canvas');
    this.base.width = W;
    this.base.height = HMAX;
    this.bare = document.createElement('canvas');
    this.bare.width = W;
    this.bare.height = HMAX;
    // Delante del panel, en este orden: anillo, resplandor, escaneo. El cartel
    // y el aviso (sin índice) quedan siempre encima.
    this.panel.alphaIndex = 10;

    // Hijos del panel, sin picking (el láser sólo prueba el plano) y dibujados
    // una sola vez: lo que se anima es el alfa, la posición o el giro de la textura.
    const mkFx = (name: string, tex: DynamicTexture, alphaIndex: number) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = Color3.FromHexString(HOLO.cyan);
      m.opacityTexture = tex;
      tex.hasAlpha = true;
      m.disableLighting = true;
      m.fogEnabled = false;
      m.backFaceCulling = false;
      return { m, alphaIndex };
    };
    this.glowTexture = new DynamicTexture('gamePanelGlowTex', { width: 64, height: 4 }, scene, true);
    paintGlowProfile(this.glowTexture);
    const glowFx = mkFx('gamePanelGlow', this.glowTexture, 12);
    this.glowMaterial = glowFx.m;
    this.glowMaterial.alpha = GLOW_REST;
    this.glow = buildGlowFrame(scene);
    this.glow.material = this.glowMaterial;
    this.glow.parent = this.panel;
    this.glow.position.z = -0.002;
    this.glow.alphaIndex = glowFx.alphaIndex;

    this.scanTexture = new DynamicTexture('gamePanelScanTex', { width: 64, height: 4 }, scene, true);
    paintScanProfile(this.scanTexture);
    const scanFx = mkFx('gamePanelScan', this.scanTexture, 13);
    this.scanMaterial = scanFx.m;
    this.scanMaterial.alpha = 0.6;
    this.scan = CreatePlane('gamePanelScan', { width: 1, height: 1 }, scene);
    this.scan.material = this.scanMaterial;
    this.scan.parent = this.panel;
    this.scan.position.z = -0.003;
    this.scan.alphaIndex = scanFx.alphaIndex;

    this.ringTexture = new DynamicTexture('gamePanelRingTex', { width: 256, height: 256 }, scene, true);
    paintRing(this.ringTexture);
    const ringFx = mkFx('gamePanelRing', this.ringTexture, 11);
    this.ringMaterial = ringFx.m;
    this.ringMaterial.emissiveColor = Color3.White();
    this.ringMaterial.emissiveTexture = this.ringTexture;
    this.ring = CreatePlane('gamePanelRing', { width: 1, height: 1 }, scene);
    this.ring.material = this.ringMaterial;
    this.ring.parent = this.panel;
    this.ring.position.z = -0.001;
    this.ring.alphaIndex = ringFx.alphaIndex;
    for (const m of [this.glow, this.scan, this.ring]) {
      m.isPickable = false;
      m.renderingGroupId = 1;
      // Se mueven y cambian de tamaño a mano: sin recalcular su caja de visibilidad.
      m.alwaysSelectAsActiveMesh = true;
      m.setEnabled(false);
    }

    this.labelTexture = new DynamicTexture('gameLabelTex', { width: 640, height: 160 }, scene, true);
    this.labelMaterial = mkMat('gameLabel', this.labelTexture);
    this.label = CreatePlane('gameLabel', { width: 0.84, height: 0.21 }, scene);
    this.label.material = this.labelMaterial;
    this.label.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.label.isPickable = false;
    this.label.renderingGroupId = 1;
    this.label.setEnabled(false);

    this.toastTexture = new DynamicTexture('gameToastTex', { width: TOAST_W, height: TOAST_TEX_H }, scene, true);
    this.toastMaterial = mkMat('gameToast', this.toastTexture);
    this.toast = CreatePlane('gameToast', { width: TOAST_PLANE_W, height: (TOAST_PLANE_W * TOAST_TEX_H) / TOAST_W }, scene);
    this.toast.material = this.toastMaterial;
    this.toast.isPickable = false;
    this.toast.renderingGroupId = 1;
    this.toast.setEnabled(false);
  }

  // ==================================================================== estado

  get visible(): boolean {
    return this.panel.isEnabled();
  }

  /** Qué muestra el panel ahora (null cerrado). */
  get kind(): PanelModel['kind'] | null {
    return this.visible && this.model ? this.model.kind : null;
  }

  /** Dónde está el panel (para volver a ponerlo delante si el jugador mira a otro lado). */
  get position(): Vector3 {
    return this.panel.position;
  }

  /** Lo reubicó el jugador con el grip: no lo sigue hasta el próximo panel. */
  get pinned(): boolean {
    return this.isPinned;
  }

  /** Pasó el tiempo de gracia desde que se abrió: ya acepta elecciones. */
  get armed(): boolean {
    return this.visible && performance.now() - this.shownAt >= ARM_MS;
  }

  /** Opción resaltada (−1 ninguna). */
  get highlight(): number {
    return zoneByIndex(this.zones, this.highlighted) ? this.highlighted : -1;
  }

  /** ¿Este pick es del panel? (para que el director no lo trate como "apuntar a algo"). */
  isPanel(mesh: unknown): boolean {
    return mesh === this.panel;
  }

  // ================================================================= ubicación

  /**
   * Ubica el panel frente al jugador. `toward` (opcional) es hacia dónde está
   * quien habla: el panel se corre un poco al costado para no taparlo. Se
   * aplica en el acto y se vuelve a ajustar en el `show` siguiente (con el
   * alto y el tamaño del contenido nuevo).
   */
  place(head: Vector3, forward: { x: number; z: number }, toward?: { x: number; z: number }): void {
    let fx = forward.x;
    let fz = forward.z;
    if (toward) {
      const dx = toward.x - head.x;
      const dz = toward.z - head.z;
      const d = Math.hypot(dx, dz);
      const fl = Math.hypot(fx, fz) || 1;
      const cos = d > 0 ? (dx * fx + dz * fz) / (d * fl) : 1;
      // Sólo si quien habla está cerca y más o menos adelante: si no, el
      // panel iría a parar fuera de la vista.
      if (d > 0.3 && d < 4.5 && cos > 0.55) {
        // Dirección hacia el personaje, girada 18° a la derecha.
        const a = Math.atan2(dx, dz) + 0.32;
        fx = Math.sin(a);
        fz = Math.cos(a);
      }
    }
    const l = Math.hypot(fx, fz) || 1;
    this.anchor = { head: head.clone(), fx: fx / l, fz: fz / l };
    this.anchorPending = true;
    this.glide = null;
    this.awayFor = 0;
    this.applyAnchor();
  }

  /**
   * Cada cuadro, con la cabeza del jugador: lo mantiene de frente (sólo el
   * rumbo, suave) y, si quedó fuera de la vista (~40° del frente, muy lejos o
   * muy cerca) más de 0,6 s, lo desliza delante. Nunca si está fijado con el
   * grip o arrastrándose.
   */
  follow(head: Vector3, forward: Vector3, dt: number): void {
    if (!this.visible || this.dragging) {
      this.awayFor = 0;
      return;
    }
    const p = this.panel.position;
    const dx = p.x - head.x;
    const dz = p.z - head.z;
    const d = Math.hypot(dx, dz);
    if (!this.glide && d > 0.2) {
      const yaw = Math.atan2(dx, dz);
      this.panel.rotation.y = lerpAngle(this.panel.rotation.y, yaw, 1 - Math.exp(-dt * 8));
    }
    this.sinceAimed += dt;
    // Mientras se lo apunta o se aprieta un botón no se mueve: deslizarse
    // justo cuando se va a elegir hacía errar el clic.
    if (this.isPinned || this.glide || this.pressed >= 0 || this.sinceAimed < AIM_HOLD_S) {
      this.awayFor = 0;
      return;
    }
    const fl = Math.hypot(forward.x, forward.z);
    // Mirando derecho arriba o abajo el rumbo no dice nada: no se mueve.
    if (fl < 0.2) return;
    const cos = d > 0 ? (forward.x * dx + forward.z * dz) / (fl * d) : 1;
    const dist = DIST[this.size];
    const away = cos < AWAY_COS || d > dist * 2.2 || d < 0.45 || Math.abs(p.y - this.centerY(head.y)) > 0.75;
    this.awayFor = away ? this.awayFor + dt : 0;
    if (this.awayFor > AWAY_S) {
      this.awayFor = 0;
      this.glideTo(head, forward.x / fl, forward.z / fl);
    }
  }

  /** Clic del stick derecho: lo trae delante (suave) y lo suelta si estaba fijado. */
  recenter(head: Vector3, forward: Vector3): void {
    if (!this.visible) return;
    const fl = Math.hypot(forward.x, forward.z) || 1;
    this.isPinned = false;
    this.dragging = false;
    this.glideTo(head, forward.x / fl, forward.z / fl);
  }

  // ===================================================================== grip

  /** Grip sobre el panel: empieza a arrastrarlo por el rayo. false si el rayo no lo toca. */
  beginDrag(ray: Ray): boolean {
    if (!this.visible) return false;
    const pick = this.atRest(() => {
      this.panel.computeWorldMatrix(true);
      return ray.intersectsMesh(this.panel);
    });
    if (!pick.hit || !pick.pickedPoint) return false;
    const yaw = this.panel.rotation.y;
    const off = this.panel.position.subtract(pick.pickedPoint);
    // Dónde se lo agarró, en ejes del panel: no salta a centrarse en el rayo.
    this.drag = {
      dist: pick.distance,
      offR: off.x * Math.cos(yaw) - off.z * Math.sin(yaw),
      offU: off.y,
    };
    this.dragging = true;
    this.glide = null;
    this.cancelPress();
    return true;
  }

  dragTo(ray: Ray): void {
    if (!this.dragging || !this.visible) return;
    const dist = Math.max(0.4, Math.min(4.5, this.drag.dist));
    const px = ray.origin.x + ray.direction.x * dist;
    const py = ray.origin.y + ray.direction.y * dist;
    const pz = ray.origin.z + ray.direction.z * dist;
    const head = this.headPosition() ?? ray.origin;
    let yaw = Math.atan2(px - head.x, pz - head.z);
    const tx = px + Math.cos(yaw) * this.drag.offR;
    const ty = py + this.drag.offU;
    const tz = pz - Math.sin(yaw) * this.drag.offR;
    // Un poco de suavizado: a 2 m, el temblor de la mano se multiplica.
    const p = this.panel.position;
    p.set(p.x + (tx - p.x) * 0.5, p.y + (ty - p.y) * 0.5, p.z + (tz - p.z) * 0.5);
    yaw = Math.atan2(p.x - head.x, p.z - head.z);
    this.panel.rotation.y = yaw;
  }

  /** Soltó el grip: queda donde lo dejó hasta el próximo panel. */
  endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.isPinned = true;
  }

  // ==================================================================== mostrar

  show(model: PanelModel, onPick: (i: number) => void, opts?: { size?: 'normal' | 'large' }): void {
    const key = modelKey(model);
    // Mismo contenido redibujado (actividad animándose, ajuste que cambió):
    // conserva el armado, lo apretado, el resaltado y dónde quedó el panel.
    const wasVisible = this.visible;
    const refresh = wasVisible && key !== null && key === this.modelKey;
    this.onPick = onPick;
    this.model = model;
    this.modelKey = key;
    const size = opts?.size ?? 'normal';
    const compact = model.kind === 'activity' && Boolean(model.view.compact);
    const reshape = size !== this.size || compact !== this.compact;
    this.size = size;
    this.compact = compact;
    if (!refresh) {
      this.shownAt = performance.now();
      this.pressed = -1;
      this.flash.index = -1;
      this.isPinned = false;
      this.dragging = false;
      // Contenido nuevo: aparece (un refresco, como un ajuste que cambió, no).
      this.appearT = 0;
      this.pickGlow = 0;
      this.glowKey = '';
    }

    const prevH = this.contentH;
    this.paintBase(model);
    this.applyGeometry();
    if (this.anchorPending) {
      this.anchorPending = false;
      this.applyAnchor();
    } else if (!wasVisible || (!refresh && reshape)) {
      // Abierto sin `place` (o cambió de tamaño): delante de la cabeza de
      // ahora, no donde quedó la última vez.
      this.placeInFront();
    } else if (prevH !== this.contentH && !this.glide) {
      // Creció o se achicó: el borde de arriba queda donde estaba.
      this.panel.position.y += ((prevH - this.contentH) / 2 / W) * PANEL_W[this.size];
    }

    if (!refresh || (this.highlighted >= 0 && !zoneByIndex(this.zones, this.highlighted) && model.kind !== 'activity')) {
      // En una actividad el resaltado se recuerda aunque su botón se apague
      // mientras anima: vuelve solo cuando se rehabilita.
      this.highlighted = this.defaultZone(model);
    }
    if (this.pressed >= 0 && !zoneByIndex(this.zones, this.pressed)) this.pressed = -1;
    this.compose();
    this.placeRing((model.kind === 'screen' && model.screen.style === 'title') || isFinale(model));
    this.applyPresentation();
    this.panel.setEnabled(true);
  }

  hide(): void {
    this.panel.setEnabled(false);
    this.zones = [];
    this.btns = [];
    this.onPick = null;
    this.model = null;
    this.modelKey = null;
    this.highlighted = -1;
    this.pressed = -1;
    this.flash.index = -1;
    this.dragging = false;
    this.isPinned = false;
    this.glide = null;
    this.awayFor = 0;
    this.appearT = Infinity;
    this.pickGlow = 0;
    this.pickFlash = 0;
    this.material.emissiveColor.set(0, 0, 0);
    this.glowKey = '';
    for (const m of [this.glow, this.scan, this.ring]) m.setEnabled(false);
  }

  // ===================================================================== rayos

  /** Qué toca el rayo de un mando: distancia y opción (con histéresis sobre la resaltada). */
  hitTest(ray: Ray): PanelHit | null {
    if (!this.visible) return null;
    const pick = this.atRest(() => {
      this.panel.computeWorldMatrix(true);
      const p = ray.intersectsMesh(this.panel);
      return { hit: p.hit, distance: p.distance, uv: p.hit ? p.getTextureCoordinates() : null };
    });
    if (!pick.hit) return null;
    const uv = pick.uv;
    if (!uv) return { distance: pick.distance, zone: -1 };
    // Con invertY (por defecto) la fila 0 del lienzo corresponde a v = 1;
    // las coordenadas recortadas llegan hasta v = 1 − alto/HMAX.
    const px = uv.x * W;
    const py = (1 - uv.y) * HMAX;
    const current = this.pressed >= 0 ? this.pressed : this.highlighted;
    this.sinceAimed = 0;
    return {
      distance: pick.distance,
      zone: aimZone(this.zones, px, py, current, HYSTERESIS, SNAP),
    };
  }

  /**
   * Dónde corta el rayo el PLANO del panel, en píxeles del lienzo, aunque
   * caiga fuera de sus bordes (null si va paralelo o hacia atrás). Sirve
   * para medir cuánto se corrió el láser al soltar el gatillo.
   */
  private canvasPoint(ray: Ray): { px: number; py: number } | null {
    this.atRest(() => this.panel.computeWorldMatrix(true).invertToRef(this.inv));
    Vector3.TransformCoordinatesToRef(ray.origin, this.inv, this.tmpO);
    Vector3.TransformNormalToRef(ray.direction, this.inv, this.tmpD);
    if (Math.abs(this.tmpD.z) < 1e-6) return null;
    const t = -this.tmpO.z / this.tmpD.z;
    if (t <= 0) return null;
    // Plano de 1 × 1 (escalado): x de −0,5 a 0,5 a lo ancho; y de 0,5 (arriba) a −0,5.
    const lx = this.tmpO.x + this.tmpD.x * t;
    const ly = this.tmpO.y + this.tmpD.y * t;
    return { px: (lx + 0.5) * W, py: (0.5 - ly) * this.contentH };
  }

  /**
   * Mientras aparece, el plano está achicado (escala de presentación): los
   * rayos se prueban contra el tamaño final. Si no, un láser quieto "barría"
   * los botones mientras el panel crecía y se llevaba el resaltado
   * (comprobado en el emulador: el hueco elegía el botón de abajo).
   */
  private atRest<T>(fn: () => T): T {
    const s = this.panel.scaling;
    if (s.x === this.baseScale.x && s.y === this.baseScale.y) return fn();
    const kx = s.x;
    const ky = s.y;
    s.set(this.baseScale.x, this.baseScale.y, 1);
    this.panel.computeWorldMatrix(true);
    try {
      return fn();
    } finally {
      s.set(kx, ky, 1);
      this.panel.computeWorldMatrix(true);
    }
  }

  /** Cambia el resaltado (láser o stick). true si cambió: tic háptico/sonoro. −1 lo quita. */
  setHighlight(zone: number): boolean {
    const z = zoneByIndex(this.zones, zone) ? zone : -1;
    if (z === this.highlighted) return false;
    this.highlighted = z;
    this.compose();
    return true;
  }

  /** Gatillo apretado sobre una opción: se ve presionada. Antes del armado no hace nada. */
  press(zone: number): void {
    if (!this.armed || !zoneByIndex(this.zones, zone)) return;
    this.pressed = zone;
    this.highlighted = zone;
    this.compose();
  }

  /**
   * Gatillo soltado: elige si se suelta sobre la MISMA opción que se apretó
   * y el panel está armado. Devuelve la opción elegida o −1.
   */
  release(zone: number): number {
    const p = this.pressed;
    if (p < 0) return -1;
    this.pressed = -1;
    if (zone !== p || !this.armed || !zoneByIndex(this.zones, p)) {
      this.compose();
      return -1;
    }
    return this.fire(p) ? p : -1;
  }

  /** Opción apretada con el gatillo (−1 ninguna). */
  get pressedZone(): number {
    return this.pressed;
  }

  /**
   * Gatillo soltado, con el rayo de ese momento (null: sin rayo). Elige lo
   * apretado si el láser sigue sobre ese botón o a menos de `RELEASE_SLOP`
   * de él — el cabeceo del mando al aflojar el dedo no anula el clic —, y no
   * elige si se lo llevó claramente a otro botón o lejos. Devuelve la opción
   * elegida o −1.
   */
  releaseRay(ray: Ray | null): number {
    const p = this.pressed;
    if (p < 0) return -1;
    const z = zoneByIndex(this.zones, p);
    let keep = false;
    if (ray && z) {
      const hit = this.hitTest(ray);
      const at = this.canvasPoint(ray);
      const d = at ? distToZone(z, at.px, at.py) : Infinity;
      // Sobre OTRO botón la tolerancia es chica: llevar el láser al vecino
      // es cambiar de idea; en el hueco, el borde o fuera del panel, amplia.
      const other = hit !== null && hit.zone >= 0 && hit.zone !== p;
      keep = (hit !== null && hit.zone === p) || d <= (other ? RELEASE_SLOP_NEIGHBOR : RELEASE_SLOP);
    }
    return this.release(keep ? p : -1);
  }

  /** Suelta lo apretado sin elegir (se fue el mando, empezó a arrastrar…). */
  cancelPress(): void {
    if (this.pressed < 0) return;
    this.pressed = -1;
    this.compose();
  }

  /** Stick: mueve el resaltado por la grilla real de botones. true si cambió. */
  navigate(dx: number, dy: number): boolean {
    if (!this.visible || !this.zones.length) return false;
    const next = navigateGrid(this.zones, this.highlight, dx, dy);
    if (next === this.highlighted) return false;
    this.highlighted = next;
    this.compose();
    return true;
  }

  /**
   * A/X: elige lo resaltado; sin resaltado, la única opción, la primera de
   * un diálogo o el foco de una pantalla. En una actividad sin resaltado no
   * adivina (la primera podría ser "Salir").
   */
  confirm(): boolean {
    if (!this.armed || !this.model) return false;
    let i = this.highlight;
    if (i < 0 && this.zones.length === 1) i = this.zones[0].index;
    if (i < 0 && this.model.kind !== 'activity') i = this.defaultZone(this.model);
    return i >= 0 && this.fire(i);
  }

  /** B: la opción "volver" de una pantalla, o cierra la ficha. */
  back(): boolean {
    if (!this.armed || !this.model) return false;
    if (this.model.kind === 'card') return this.zones.length > 0 && this.fire(this.zones[0].index);
    if (this.model.kind === 'screen') {
      const b = this.model.screen.back;
      return b !== undefined && b >= 0 && b < this.model.screen.buttons.length && this.fire(b);
    }
    return false;
  }

  // ======================================= compatibilidad (director anterior)

  /** Clic inmediato con el rayo de un mando: true si cayó sobre una opción del panel. */
  clickRay(ray: Ray): boolean {
    const hit = this.hitTest(ray);
    if (!hit || hit.zone < 0) return false;
    if (this.armed) this.fire(hit.zone);
    return true;
  }

  /** Con una sola opción (Continuar, Cerrar, Comenzar), cualquier botón la elige sin apuntar. */
  pickSingle(): boolean {
    if (!this.armed || this.zones.length !== 1) return false;
    return this.fire(this.zones[0].index);
  }

  /** A/X en un diálogo con opciones y sin apuntar: la primera (la que sigue la historia). */
  pickFirstChoice(): boolean {
    if (!this.armed || this.model?.kind !== 'line' || this.zones.length === 0) return false;
    return this.fire(firstZone(this.zones));
  }

  /** B/Y: cierra los carteles informativos (los diálogos y actividades se responden). */
  cancel(): boolean {
    if (!this.armed || this.model?.kind !== 'card' || this.zones.length === 0) return false;
    return this.fire(this.zones[0].index);
  }

  private fire(index: number): boolean {
    const now = performance.now();
    if (now - this.lastPickAt < DEBOUNCE_MS) return false;
    this.lastPickAt = now;
    // Se ve apretado un instante (si el panel sigue abierto, p. ej. un ajuste).
    this.flash = { index, left: 0.14 };
    this.highlighted = index;
    // Elegir se nota también en la malla: el panel brilla y el resplandor se enciende y se apaga.
    this.pickGlow = PICK_GLOW_S;
    this.pickFlash = PICK_FLASH_S;
    this.compose();
    this.onPick?.(index);
    return true;
  }

  private defaultZone(model: PanelModel): number {
    if (!this.zones.length) return -1;
    if (model.kind === 'screen' && model.screen.focus !== undefined && zoneByIndex(this.zones, model.screen.focus)) return model.screen.focus;
    if (model.kind === 'activity') {
      // El botón destacado (Probar, Continuar…) si lo hay; nunca uno de salida.
      const accent = model.view.choices.findIndex((c, i) => c.tone === 'accent' && zoneByIndex(this.zones, i));
      if (accent >= 0) return accent;
      const play = model.view.choices.findIndex((c, i) => !c.exit && zoneByIndex(this.zones, i));
      return play;
    }
    return firstZone(this.zones);
  }

  // ===================================================================== cartel

  /**
   * Cartel flotante sobre lo apuntado. `sub` del estilo "Gatillo o A · Saludar"
   * se dibuja como fichas de botón y el verbo. `null` lo oculta.
   */
  setLabel(title: string | null, sub = '', at?: { x: number; y: number; z: number }): void {
    if (!title || !at) {
      this.label.setEnabled(false);
      this.labelText = '';
      return;
    }
    this.label.position.set(at.x, at.y, at.z);
    this.label.setEnabled(true);
    const key = `${title}\n${sub}`;
    if (key === this.labelText) return;
    this.labelText = key;
    // Cambió lo apuntado: el cartel entra con un saltito (sólo escala, no flota).
    this.labelPop = 0;
    this.label.scaling.setAll(0.92);
    const LW = 640;
    const LH = 160;
    const ctx = this.labelTexture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, LW, LH);
    // Cuerpo biselado y una muesca abajo que señala lo apuntado. Sin brillo:
    // flota sobre la ciudad, y un halo ahí se confunde con una luz.
    chamferRect(ctx, 4, 4, LW - 8, 128, [20, 6, 20, 6]);
    ctx.fillStyle = 'rgba(7,20,23,0.92)';
    ctx.fill();
    ctx.strokeStyle = HOLO.cyan;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = HOLO.cyan;
    ctx.beginPath();
    ctx.moveTo(LW / 2 - 14, 132);
    ctx.lineTo(LW / 2 + 14, 132);
    ctx.lineTo(LW / 2, 154);
    ctx.closePath();
    ctx.fill();
    // "Rubén · portero": el nombre fuerte y el rol al lado, si entra.
    const cut = title.indexOf(' · ');
    const name = cut > 0 ? title.slice(0, cut) : title;
    const role = cut > 0 ? title.slice(cut + 3) : '';
    const maxW = LW - 48;
    const nameSize = fitFont(ctx, name, 700, 44, 36, maxW);
    const nameW = Math.min(ctx.measureText(name).width, maxW);
    ctx.font = font(600, 30);
    const roleW = role ? ctx.measureText(role).width : 0;
    const withRole = role !== '' && nameW + 16 + roleW <= maxW;
    const total = withRole ? nameW + 16 + roleW : nameW;
    const cy = sub ? 48 : 68;
    let x = LW / 2 - total / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(700, nameSize);
    ctx.fillStyle = HOLO.text;
    ctx.fillText(ellipsize(ctx, name, maxW), x, cy + 1);
    if (withRole) {
      x += nameW + 16;
      ctx.font = font(600, 30);
      ctx.fillStyle = HOLO.dim;
      ctx.fillText(role, x, cy + 3);
    }
    if (sub) {
      if (/^cerrado$/i.test(sub.trim())) {
        // Cerrado: un candado y la palabra (no hay botón que apretar).
        ctx.font = font(600, 30);
        const tw = ctx.measureText(sub).width;
        const x0 = LW / 2 - (tw + 40) / 2;
        drawLock(ctx, x0 + 13, 100, 26, HOLO.dim);
        ctx.fillStyle = HOLO.dim;
        ctx.fillText(sub, x0 + 40, 101);
      } else {
        drawKeyRow(ctx, sub, LW / 2, 100, maxW, { h: 40, size: 30 });
      }
    }
    this.labelTexture.update(true);
  }

  // ====================================================================== aviso

  /**
   * Aviso breve que se va solo. Un logro (sello, lugar nuevo) es un "logro
   * desbloqueado" con la medalla del 40; lo demás (controles, una puerta que
   * se abrió, un dato) lleva un ícono en un círculo cian. El detalle va
   * entero en hasta dos líneas (cortado con "…" se perdía justo "Y: menú");
   * si son botones del mando ("Stick izq.: caminar · …"), como fichas, en
   * las filas que hagan falta. Un poco por encima de la línea de los ojos,
   * sin tapar el centro de la vista; si hay un panel abierto, sobre su borde
   * de arriba.
   */
  showToast(head: Vector3, forward: { x: number; z: number }, title: string, text = '', kind: ToastKind = toastKind(title)): void {
    const TW = TOAST_W;
    const ctx = this.toastTexture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, TW, TOAST_TEX_H);
    const textX = 160;
    const maxW = TW - textX - 28;
    // Primero se mide el detalle: el alto del aviso sale de ahí (144 a 224 px).
    const segs: HintSeg[] = text ? parseHints(text) : [];
    const keyed = segs.some((q) => q.kind === 'keys');
    let rows: HintSeg[][] = [];
    let lines: string[] = [];
    let detailH = 0;
    if (keyed) {
      // Fichas como las del pie (40 px, verbo en 30): es el aviso que más
      // hay que leer, y con 34/28 "Stick izq." quedaba en ~15 px de panel.
      rows = splitKeyRows(ctx, segs, maxW, 40, 30).slice(0, 3);
      detailH = rows.length * 48;
    } else if (text) {
      ctx.font = font(500, 30);
      // Hasta tres líneas: la presentación de cada capítulo (una o dos frases) entra entera.
      lines = wrapLines(ctx, text, maxW, 3);
      detailH = lines.length * 38;
    }
    const blockH = 40 + (detailH ? 6 + detailH : 0);
    const TH = Math.min(TOAST_TEX_H - 8, Math.max(144, blockH + 60));
    const medal = kind === 'stamp' || kind === 'place';
    const trophy = medal || kind === 'objective';
    ctx.save();
    // Centrado en alto: el plano es siempre del mismo tamaño.
    ctx.translate(0, Math.round((TOAST_TEX_H - TH) / 2));
    const cuts = [28, 8, 28, 8] as const;
    chamferRect(ctx, 4, 4, TW - 8, TH - 8, cuts);
    ctx.fillStyle = 'rgba(7,20,23,0.95)';
    ctx.fill();
    // Bloque de la izquierda, separado por una línea cian.
    ctx.save();
    chamferRect(ctx, 4, 4, TW - 8, TH - 8, cuts);
    ctx.clip();
    ctx.fillStyle = trophy ? HOLO.goldFill : HOLO.cyanFaint;
    ctx.fillRect(4, 4, 132, TH - 8);
    ctx.fillStyle = HOLO.cyan;
    ctx.fillRect(136, 4, 2, TH - 8);
    ctx.restore();
    // Borde dorado para un logro; cian (estructura) para un aviso.
    ctx.strokeStyle = trophy ? HOLO.gold : HOLO.cyan;
    ctx.lineWidth = 3;
    chamferRect(ctx, 4, 4, TW - 8, TH - 8, cuts);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(63,230,224,0.3)';
    ctx.lineWidth = 2;
    chamferRect(ctx, 12, 12, TW - 24, TH - 24, [22, 4, 22, 4]);
    ctx.stroke();
    paintToastBadge(ctx, kind, 70, TH / 2);
    // Título y detalle, centrados en alto.
    const y0 = (TH - blockH) / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fitFont(ctx, title, 800, 38, 32, maxW);
    ctx.fillStyle = HOLO.text;
    ctx.fillText(ellipsize(ctx, title, maxW), textX, y0 + 21);
    if (keyed) {
      rows.forEach((r, i) => drawKeyRow(ctx, r, textX, y0 + 46 + 24 + i * 48, maxW, { h: 40, size: 30, align: 'left', verbColor: HOLO.body2 }));
    } else if (lines.length) {
      ctx.font = font(500, 30);
      ctx.fillStyle = HOLO.body2;
      lines.forEach((l, i) => ctx.fillText(l, textX, y0 + 46 + 20 + i * 38));
    }
    ctx.restore();
    this.toastTexture.update(true);
    this.toastHalf = ((TOAST_PLANE_W / TW) * TH) / 2;
    const l = Math.hypot(forward.x, forward.z) || 1;
    const fx = forward.x / l;
    const fz = forward.z / l;
    let y = head.y + 0.24;
    let dist = 1.4;
    if (this.visible) {
      const p = this.panel.position;
      const top = p.y + this.halfHeight();
      y = Math.max(y, top + 0.06 + this.toastHalf);
      // A la distancia del panel (apenas delante): más lejos, el panel le
      // tapaba la mitad de abajo en perspectiva.
      dist = Math.max(0.6, Math.hypot(p.x - head.x, p.z - head.z) - 0.08);
    }
    this.toastY = y;
    this.toast.position.set(head.x + fx * dist, y + 0.03, head.z + fz * dist);
    this.toast.rotation.set(-0.1, Math.atan2(fx, fz), 0);
    this.toast.scaling.setAll(0.85);
    this.toast.visibility = 0;
    this.toast.setEnabled(true);
    // Más filas de controles, más tiempo para leerlas (con 3,4 s el de
    // controles ya se apagaba a mitad de la segunda fila).
    this.toastDur = keyed ? 3.4 + 1.6 * rows.length : lines.length > 2 ? 6 : lines.length > 1 ? 4.4 : 3.4;
    this.toastLeft = this.toastDur;
  }

  update(dt: number): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      const t = this.toastDur - this.toastLeft;
      // Entra en 0,2 s y se apaga en los últimos 0,5 s: aparecer de golpe sobresalta.
      this.toast.visibility = Math.min(1, t / 0.2, this.toastLeft / 0.5);
      // Salta como una medalla: 0,85 → 1,04 → 1 y baja 3 cm a su lugar (0,22 s).
      const u = Math.min(1, t / 0.22);
      this.toast.scaling.setAll(u < 0.6 ? 0.85 + 0.19 * easeOutCubic(u / 0.6) : 1.04 - 0.04 * ((u - 0.6) / 0.4));
      if (this.toastLeft <= 0) this.toast.setEnabled(false);
      else if (this.visible && !this.glide) this.keepToastClear();
      this.toast.position.y = this.toastY + 0.03 * (1 - easeOutCubic(u));
    }
    if (this.labelPop < 0.12 && this.label.isEnabled()) {
      this.labelPop += dt;
      this.label.scaling.setAll(0.92 + 0.08 * easeOutCubic(Math.min(1, this.labelPop / 0.12)));
    }
    if (this.flash.index >= 0) {
      this.flash.left -= dt;
      if (this.flash.left <= 0) {
        this.flash.index = -1;
        if (this.visible) this.compose();
      }
    }
    const g = this.glide;
    if (g) {
      g.t = Math.min(1, g.t + dt / GLIDE_S);
      const k = g.t * g.t * (3 - 2 * g.t);
      Vector3.LerpToRef(g.from, g.to, k, this.panel.position);
      this.panel.rotation.y = lerpAngle(g.fromYaw, g.toYaw, k);
      if (g.t >= 1) this.glide = null;
    }
    if (this.visible) this.animate(dt);
  }

  /**
   * Lo que se mueve del panel, todo en la malla y el material (ningún lienzo
   * se redibuja por cuadro): la aparición, la barra de escaneo, el brillo al
   * elegir, el latido del resaltado y el giro del anillo del inicio.
   */
  private animate(dt: number): void {
    if (this.appearT < SCAN_S) {
      this.appearT += dt;
      this.applyPresentation();
    }
    if (this.pickFlash > 0) {
      this.pickFlash = Math.max(0, this.pickFlash - dt);
      const e = 0.08 * Math.sin((Math.PI * this.pickFlash) / PICK_FLASH_S);
      this.material.emissiveColor.set(e, e, e);
    }
    if (this.glow.isEnabled()) {
      let a: number;
      if (this.pickGlow > 0) {
        this.pickGlow = Math.max(0, this.pickGlow - dt);
        a = 0.9 * (this.pickGlow / PICK_GLOW_S);
        // Terminó el destello: el resplandor vuelve (o no) según el estado.
        if (this.pickGlow === 0) this.syncGlow();
      } else if (this.pressed >= 0 || this.sinceAimed < AIM_HOLD_S || this.isPinned || this.dragging || this.glide) {
        // Quieto mientras se apunta, se aprieta o se mueve el panel: un brillo
        // que late bajo el láser distrae justo cuando se va a elegir.
        a = GLOW_REST;
      } else {
        this.glowT += dt;
        a = GLOW_REST + 0.1 * Math.sin(2 * Math.PI * GLOW_HZ * this.glowT);
      }
      this.glowMaterial.alpha = a * this.panel.visibility;
    }
    if (this.ring.isEnabled()) {
      if (!this.isPinned && !this.dragging) this.ringTexture.wAng += 0.25 * dt;
      this.ringMaterial.alpha = this.panel.visibility;
    }
  }

  /** Escala de presentación (multiplica la real, nunca la pisa), visibilidad y la barra de escaneo. */
  private applyPresentation(): void {
    const t = this.appearT;
    const k = easeOutCubic(Math.min(1, t / APPEAR_S));
    const kx = 0.96 + 0.04 * k;
    const ky = 0.06 + 0.94 * k;
    this.panel.scaling.set(this.baseScale.x * kx, this.baseScale.y * ky, 1);
    this.panel.visibility = Math.min(1, t / 0.12);
    if (t < SCAN_S) {
      this.scan.setEnabled(true);
      const panelH = (PANEL_W[this.size] * this.contentH) / W;
      this.scan.scaling.set(1, 0.012 / panelH, 1);
      this.scan.position.y = 0.5 - t / SCAN_S;
    } else {
      this.scan.setEnabled(false);
    }
  }

  /** Anillo holográfico alrededor del sello del inicio: sólo en esa pantalla. */
  private placeRing(on: boolean): void {
    this.ring.setEnabled(on);
    if (!on) return;
    // Hijo de un plano escalado distinto en x y en y: se compensa para que siga redondo.
    this.ring.scaling.set(RING_PX / W, RING_PX / this.contentH, 1);
    this.ring.position.x = 0;
    this.ring.position.y = 0.5 - SEAL_Y / this.contentH;
  }

  /**
   * Ubica el resplandor sobre el botón resaltado (sólo cuando cambia) y lo
   * enciende o apaga: sin resaltado o apretado no hay latido; al elegir, el
   * destello de `pickGlow` lo mantiene un instante.
   */
  private syncGlow(): void {
    const hl = this.highlight;
    const b = hl >= 0 ? this.btns.find((q) => q.index === hl) : undefined;
    const pressedHere = b !== undefined && ((this.pressed === b.index && hl === b.index) || this.flash.index === b.index);
    const on = b !== undefined && !b.disabled && (!pressedHere || this.pickGlow > 0);
    this.glow.setEnabled(on);
    if (!on || !b) return;
    // La cara del botón apuntado (subida 3 px), en coordenadas del plano.
    const key = `${b.x},${b.y},${b.w},${b.h},${this.contentH}`;
    if (key !== this.glowKey) {
      this.glowKey = key;
      const fy = b.y - 3;
      const fh = b.h - 6;
      const lx = (px: number) => px / W - 0.5;
      const ly = (py: number) => 0.5 - py / this.contentH;
      const o = { x0: lx(b.x - GLOW_OUT), x1: lx(b.x + b.w + GLOW_OUT), y0: ly(fy - GLOW_OUT), y1: ly(fy + fh + GLOW_OUT) };
      const i = { x0: lx(b.x + GLOW_IN), x1: lx(b.x + b.w - GLOW_IN), y0: ly(fy + GLOW_IN), y1: ly(fy + fh - GLOW_IN) };
      // prettier-ignore
      this.glow.updateVerticesData(VertexBuffer.PositionKind, [
        o.x0, o.y0, 0, o.x1, o.y0, 0, o.x1, o.y1, 0, o.x0, o.y1, 0,
        i.x0, i.y0, 0, i.x1, i.y0, 0, i.x1, i.y1, 0, i.x0, i.y1, 0,
      ]);
    }
    if (this.pickGlow <= 0) this.glowMaterial.alpha = GLOW_REST * this.panel.visibility;
  }

  dispose(): void {
    for (const m of [this.glow, this.scan, this.ring, this.panel, this.label, this.toast]) m.dispose();
    for (const m of [this.material, this.labelMaterial, this.toastMaterial, this.glowMaterial, this.scanMaterial, this.ringMaterial]) m.dispose();
    for (const t of [this.texture, this.labelTexture, this.toastTexture, this.glowTexture, this.scanTexture, this.ringTexture]) t.dispose();
  }

  // ============================================================ ubicación (privado)

  /**
   * Un aviso que salió antes que el panel (saludo y enseguida la Y) quedaba
   * detrás de él, a medio tapar: mientras dura, se lo sube sobre el borde de
   * arriba y se lo trae a la distancia del panel. Sólo con aviso y panel a la
   * vez: unas cuentas por cuadro.
   */
  private keepToastClear(): void {
    const head = this.headPosition();
    if (!head) return;
    const p = this.panel.position;
    const t = this.toast.position;
    const top = p.y + this.halfHeight() + 0.06 + this.toastHalf;
    const dp = Math.hypot(p.x - head.x, p.z - head.z);
    const dx = t.x - head.x;
    const dz = t.z - head.z;
    const dt = Math.hypot(dx, dz);
    if (dt > dp && dt > 0.01) {
      const k = Math.max(0.6, dp - 0.08) / dt;
      t.x = head.x + dx * k;
      t.z = head.z + dz * k;
    }
    if (this.toastY < top) this.toastY = top;
  }

  private halfHeight(): number {
    return ((this.contentH / W) * PANEL_W[this.size]) / 2;
  }

  /** Alto del centro: el borde de arriba un poco sobre los ojos; el título, algo más abajo. */
  private centerY(headY: number): number {
    if (this.size === 'large') return headY - 0.1;
    const y = headY + 0.2 - this.halfHeight();
    // Una actividad compacta (lo importante pasa en el 3D) va más abajo.
    return this.compact ? y - 0.28 : y;
  }

  private targetFor(head: Vector3, fx: number, fz: number): { pos: Vector3; yaw: number } {
    const dist = DIST[this.size];
    return {
      pos: new Vector3(head.x + fx * dist, this.centerY(head.y), head.z + fz * dist),
      yaw: Math.atan2(fx, fz),
    };
  }

  private applyAnchor(): void {
    const a = this.anchor;
    if (!a) return;
    const t = this.targetFor(a.head, a.fx, a.fz);
    this.panel.position.copyFrom(t.pos);
    // CreatePlane muestra su cara hacia −Z: con +Z apuntando lejos del jugador, la cara lo mira.
    this.panel.rotation.set(TILT[this.size], t.yaw, 0);
  }

  private glideTo(head: Vector3, fx: number, fz: number): void {
    const t = this.targetFor(head, fx, fz);
    this.anchor = { head: head.clone(), fx, fz };
    this.panel.rotation.x = TILT[this.size];
    this.glide = {
      from: this.panel.position.clone(),
      to: t.pos,
      fromYaw: this.panel.rotation.y,
      toYaw: t.yaw,
      t: 0,
    };
  }

  private headPosition(): Vector3 | null {
    return this.panel.getScene().activeCamera?.globalPosition ?? null;
  }

  /** Delante de la cámara activa (la del visor en XR), con el alto y tamaño vigentes. */
  private placeInFront(): void {
    const cam = this.panel.getScene().activeCamera;
    if (!cam) return;
    const f = cam.getDirection(Vector3.Forward());
    const l = Math.hypot(f.x, f.z);
    this.place(cam.globalPosition, l > 0.2 ? { x: f.x, z: f.z } : this.anchor ? { x: this.anchor.fx, z: this.anchor.fz } : { x: 0, z: 1 });
    this.anchorPending = false;
  }

  /** Escala el plano al tamaño real y recorta las coordenadas de textura al alto del contenido. */
  private applyGeometry(): void {
    const pw = PANEL_W[this.size];
    this.baseScale = { x: pw, y: (pw * this.contentH) / W };
    this.panel.scaling.set(this.baseScale.x, this.baseScale.y, 1);
    if (this.uvH === this.contentH) return;
    this.uvH = this.contentH;
    const f = this.contentH / HMAX;
    const uvs = this.baseUVs.map((v, i) => (i % 2 === 1 ? 1 - (1 - v) * f : v));
    this.panel.updateVerticesData(VertexBuffer.UVKind, uvs);
  }

  // ===================================================================== dibujo

  /** Pinta el contenido sin estados en el respaldo y fija `contentH`, `btns` y `zones`. */
  private paintBase(model: PanelModel): void {
    const ctx = this.base.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, HMAX);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    this.btns = [];
    let h: number;
    const title = model.kind === 'screen' && model.screen.style === 'title';
    switch (model.kind) {
      case 'line':
        h = this.layoutLine(ctx, model.line);
        break;
      case 'activity':
        h = this.layoutActivity(ctx, model.view);
        break;
      case 'card':
        h = this.layoutCard(ctx, model.card);
        break;
      case 'menu':
        h = this.layoutMenu(ctx, model);
        break;
      case 'screen':
        h = title ? this.layoutTitle(ctx, model.screen) : this.layoutScreen(ctx, model.screen);
        break;
    }
    this.contentH = Math.max(240, Math.min(HMAX, Math.ceil(h)));
    this.paintFrame(ctx, title, isFinale(model));
    // El respaldo sin botones: de acá se repone el lugar de un botón antes de pintarlo resaltado.
    const bare = this.bare.getContext('2d');
    if (bare) {
      bare.clearRect(0, 0, W, HMAX);
      bare.drawImage(this.base, 0, 0);
    }
    for (const b of this.btns) paintHoloButton(ctx, b, 'normal');
    this.zones = this.btns.filter((b) => !b.disabled).map((b) => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h, index: b.index }));
  }

  /**
   * Marco VISOR 40: silueta biselada de vidrio oscuro, borde de luz cian,
   * filete interior y esquineros en los cortes grandes. El vidrio va DEBAJO
   * de lo ya pintado (el alto se supo al final); el borde, encima.
   */
  private paintFrame(ctx: CanvasRenderingContext2D, title: boolean, finale = false): void {
    const H = this.contentH;
    // El final lleva el borde dorado (es el premio); el resto, cian (estructura).
    const edge = finale ? HOLO.gold : HOLO.cyan;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    // Con destination-over lo primero queda arriba: el radial del inicio, después el vidrio.
    if (title || finale) {
      const r = ctx.createRadialGradient(W / 2, SEAL_Y, 0, W / 2, SEAL_Y, 360);
      r.addColorStop(0, 'rgba(20,70,76,0.9)');
      r.addColorStop(1, 'rgba(20,70,76,0)');
      ctx.fillStyle = r;
      chamferRect(ctx, 8, 8, W - 16, H - 16, FRAME_CUTS);
      ctx.fill();
    }
    const g = ctx.createLinearGradient(0, 8, 0, H - 8);
    g.addColorStop(0, HOLO.glassTop);
    g.addColorStop(0.6, HOLO.glassMid);
    g.addColorStop(1, HOLO.glassBot);
    ctx.fillStyle = g;
    chamferRect(ctx, 8, 8, W - 16, H - 16, FRAME_CUTS);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 3;
    ctx.shadowColor = finale ? 'rgba(242,193,78,0.8)' : 'rgba(63,230,224,0.8)';
    ctx.shadowBlur = 16;
    chamferRect(ctx, 8, 8, W - 16, H - 16, FRAME_CUTS);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(63,230,224,0.18)';
    ctx.lineWidth = 2;
    chamferRect(ctx, 18, 18, W - 36, H - 36, [28, 8, 28, 8]);
    ctx.stroke();
    // Esquineros: un trazo grueso paralelo a cada corte grande (en el inicio, a los cuatro).
    ctx.save();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 6;
    ctx.lineCap = 'square';
    const along = (cx: number, cy: number, dx: number, dy: number, len: number) => {
      ctx.beginPath();
      ctx.moveTo(cx - (dx * len) / 2, cy - (dy * len) / 2);
      ctx.lineTo(cx + (dx * len) / 2, cy + (dy * len) / 2);
      ctx.stroke();
    };
    const s = Math.SQRT1_2;
    // Centro del corte (34 px) corrido 5 px hacia adentro, entre el borde y el filete.
    along(8 + 17 + 4, 8 + 17 + 4, s, -s, 40);
    along(W - 8 - 17 - 4, H - 8 - 17 - 4, s, -s, 40);
    if (title || finale) {
      along(W - 8 - 6 - 4, 8 + 6 + 4, s, s, 20);
      along(8 + 6 + 4, H - 8 - 6 - 4, s, s, 20);
    }
    ctx.restore();
  }

  /** Copia el respaldo a la textura, pinta encima el botón resaltado/apretado y la sube. */
  private compose(): void {
    if (!this.model) return;
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, HMAX);
    ctx.drawImage(this.base, 0, 0);
    const hl = this.highlight;
    for (const b of this.btns) {
      if (b.disabled) continue;
      const pressedHere = (this.pressed === b.index && hl === b.index) || this.flash.index === b.index;
      const state: HoloState | null = pressedHere ? (this.flash.index === b.index ? 'flash' : 'press') : hl === b.index ? 'hover' : null;
      if (!state) continue;
      // Se repone el lugar del botón sin él (la cara sube o baja y el estado
      // normal no debe asomar), con margen para la mira (≤ 9 px, menos que la separación).
      const m = 12;
      ctx.clearRect(b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m);
      ctx.drawImage(this.bare, b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m, b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m);
      paintHoloButton(ctx, b, state);
    }
    this.texture.update(true);
    this.syncGlow();
  }

  /** Ubica botones en una grilla de `cols` columnas desde (x, y); devuelve el y libre debajo. */
  private placeButtons(
    specs: BtnSpec[],
    o: {
      x: number;
      y: number;
      w: number;
      cols: number;
      h?: number;
      gap?: number;
      font?: number;
      align?: 'left' | 'center';
      /** Índice de opción del primero (para armar una pantalla en dos tramos). */
      indexBase?: number;
      /**
       * Si en la última fila queda uno solo, ocupa todo el ancho: un botón a
       * media fila con un hueco al lado parecía una pantalla sin terminar.
       */
      fillLast?: boolean;
      /**
       * La última fila incompleta se reparte todo el ancho (5 en 3 columnas:
       * 3 arriba y 2 anchos abajo), sin un hueco que parezca un botón que falta.
       */
      spreadLast?: boolean;
      /** Índice de opción de cada uno, cuando no son correlativos (la salida va aparte). */
      indexes?: readonly number[];
    },
  ): number {
    const gap = o.gap ?? GAP;
    const bh = o.h ?? BTN_H;
    const cols = Math.max(1, o.cols);
    const bw = (o.w - gap * (cols - 1)) / cols;
    const font = o.font ?? (cols >= 3 ? 30 : cols === 2 ? 32 : 34);
    const base = o.indexBase ?? 0;
    const lone = Boolean(o.fillLast) && cols > 1 && specs.length % cols === 1;
    const rest = specs.length % cols;
    const lastRow = Math.floor((specs.length - 1) / cols);
    const spread = Boolean(o.spreadLast) && cols > 1 && rest > 0;
    const sw = spread ? (o.w - gap * (rest - 1)) / rest : bw;
    specs.forEach((s, i) => {
      const wide = lone && i === specs.length - 1;
      const inSpread = spread && Math.floor(i / cols) === lastRow;
      const col = i % cols;
      this.btns.push({
        ...s,
        solid: Boolean(s.solid),
        index: o.indexes?.[i] ?? base + i,
        x: wide ? o.x : inSpread ? o.x + col * (sw + gap) : o.x + col * (bw + gap),
        y: o.y + Math.floor(i / cols) * (bh + gap),
        w: wide ? o.w : inSpread ? sw : bw,
        h: bh,
        font,
        align: o.align ?? 'left',
      });
    });
    const rows = Math.ceil(specs.length / cols);
    return o.y + rows * bh + Math.max(0, rows - 1) * gap;
  }

  /**
   * Pie con las pistas de los botones: banda de ancho completo con las
   * fichas doradas ("[Gatillo] o (A) Elegir"). Lo que no son botones del
   * mando se pinta como texto. Devuelve el alto total del panel.
   */
  private footer(ctx: CanvasRenderingContext2D, y: number, text: string): number {
    const top = y + 22;
    const bottom = top + FOOTER_H;
    const H = Math.max(240, Math.min(HMAX, Math.ceil(bottom)));
    ctx.save();
    chamferRect(ctx, 8, 8, W - 16, H - 16, FRAME_CUTS);
    ctx.clip();
    ctx.fillStyle = 'rgba(63,230,224,0.07)';
    ctx.fillRect(0, top, W, FOOTER_H + 8);
    ctx.fillStyle = 'rgba(63,230,224,0.35)';
    ctx.fillRect(0, top, W, 2);
    ctx.restore();
    // Centrado en la banda visible (el marco entra 8 px abajo): a FOOTER_H / 2
    // el texto llano quedaba bajo, rozando el bisel.
    drawKeyRow(ctx, text, W / 2, top + (FOOTER_H - 8) / 2 + 1, W - PAD * 2, { h: 40, size: 28 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return bottom;
  }

  /**
   * Encabezado: pestaña con el kicker, título grande y la línea de circuito.
   * A la derecha, el sello mini (o la "i" de una ficha, o el progreso de una
   * actividad). Devuelve el y libre debajo.
   */
  private header(
    ctx: CanvasRenderingContext2D,
    kicker: string,
    title: string,
    o: { progress?: string; mark?: 'seal' | 'info' | 'none'; tone?: 'normal' | 'bad' } = {},
  ): number {
    const mark = o.mark ?? 'seal';
    let rightW = 0;
    if (o.progress) rightW = this.paintProgress(ctx, o.progress);
    else if (mark === 'seal') {
      miniSeal(ctx, W - 58, 52);
      rightW = 90;
    } else if (mark === 'info') {
      // Ficha informativa: una "i" en un círculo cian.
      ctx.strokeStyle = HOLO.cyan;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(W - 58, 52, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = HOLO.cyanText;
      ctx.beginPath();
      ctx.arc(W - 58, 43, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(W - 60, 49, 4, 14);
      rightW = 90;
    }
    if (kicker) kickerTab(ctx, kicker, PAD - 8, 30, W - PAD - (PAD - 8) - rightW - 16, o.tone);
    const maxW = W - PAD * 2;
    const size = fitFont(ctx, title, 800, 50, 44, maxW);
    ctx.font = font(800, size);
    ctx.fillStyle = HOLO.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ellipsize(ctx, title, maxW), PAD, 118);
    circuitLine(ctx, PAD, 142, W - PAD, o.tone === 'bad' ? HOLO.bad : HOLO.gold);
    return 142 + 26;
  }

  /**
   * Progreso de una actividad, arriba a la derecha: "2/4" como segmentos
   * (hechos dorados, el actual cian) más el número; cualquier otro texto,
   * tal cual. Devuelve el ancho ocupado.
   */
  private paintProgress(ctx: CanvasRenderingContext2D, progress: string): number {
    const right = W - PAD;
    const cy = 52;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = font(700, 28);
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(progress.trim());
    const n = m ? Number(m[1]) : 0;
    const total = m ? Number(m[2]) : 0;
    ctx.fillStyle = HOLO.text;
    ctx.fillText(progress, right, cy + 1);
    let w = ctx.measureText(progress).width;
    if (m && total > 0 && total <= 8) {
      const sw = 26;
      const sg = 6;
      let x = right - w - 18 - total * (sw + sg) + sg;
      for (let k = 1; k <= total; k++) {
        ctx.fillStyle = k < n ? HOLO.gold : k === n ? HOLO.cyan : 'rgba(255,255,255,0.12)';
        chamferRect(ctx, x, cy - 6, sw, 12, 4);
        ctx.fill();
        x += sw + sg;
      }
      w += 18 + total * (sw + sg) - sg;
    }
    ctx.restore();
    return w;
  }

  /** Cuerpo de texto a lo ancho del panel (32 px, gris claro); devuelve el y libre debajo. */
  private body(ctx: CanvasRenderingContext2D, text: string, y: number, o: { size?: number; lh?: number; color?: string; lines?: number; x?: number; w?: number } = {}): number {
    const size = o.size ?? 32;
    const lh = o.lh ?? 44;
    ctx.font = font(500, size);
    ctx.fillStyle = o.color ?? HOLO.body2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lines = wrapLines(ctx, text, o.w ?? W - PAD * 2, o.lines ?? 10);
    return drawLines(ctx, lines, o.x ?? PAD, y, lh);
  }

  /**
   * Objetivo del menú del juego como chip de misión: rombo dorado, el texto
   * (dos líneas como máximo) y la distancia en una casilla dorada maciza.
   * Devuelve el y libre debajo.
   */
  private mission(ctx: CanvasRenderingContext2D, text: string, distance: string, y: number): number {
    const x = PAD;
    let right = W - PAD;
    const cy0 = y + 22;
    if (distance) {
      ctx.font = font(800, 28);
      const dw = ctx.measureText(distance).width + 28;
      chamferRect(ctx, right - dw, cy0 - 22, dw, 44, 8);
      ctx.fillStyle = HOLO.gold;
      ctx.fill();
      ctx.fillStyle = HOLO.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(distance, right - dw / 2, cy0 + 1);
      right -= dw + 18;
    }
    diamond(ctx, x + 6, cy0, 12);
    ctx.font = font(600, 30);
    ctx.fillStyle = HOLO.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lines = wrapLines(ctx, text, right - (x + 26), 2);
    lines.forEach((l, i) => ctx.fillText(l, x + 26, cy0 + 1 + i * 40));
    ctx.textBaseline = 'alphabetic';
    return cy0 + 22 + (lines.length - 1) * 40;
  }

  private layoutLine(ctx: CanvasRenderingContext2D, line: LineView): number {
    // Retrato: hexágono del color del personaje dentro de un anillo cian ("canal de comunicación").
    const px = 110;
    const py = 108;
    hexPath(ctx, px, py, 58);
    ctx.fillStyle = line.color;
    ctx.fill();
    hexPath(ctx, px, py, 65);
    ctx.strokeStyle = HOLO.cyan;
    ctx.lineWidth = 3;
    ctx.stroke();
    const lum = luminance(line.color);
    ctx.fillStyle = lum > 0.45 ? HOLO.ink : HOLO.text;
    ctx.font = font(800, 42);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initials = line.speaker
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
    ctx.fillText(initials, px, py + 2);
    miniSeal(ctx, W - 58, 52);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // El nombre en el color del personaje (aclarado si es oscuro: sobre el vidrio no se leería).
    ctx.fillStyle = readableOnGlass(line.color);
    const nameW = W - 196 - 100;
    fitFont(ctx, line.speaker, 800, 44, 38, nameW);
    ctx.fillText(ellipsize(ctx, line.speaker, nameW), 196, 96);
    ctx.fillStyle = HOLO.body2;
    ctx.font = font(700, 24);
    const role = line.role.toUpperCase();
    if (spacedWidth(ctx, role, 2) <= W - 196 - PAD) spacedLeft(ctx, role, 196, 138, 2);
    else ctx.fillText(ellipsize(ctx, role, W - 196 - PAD), 196, 138);
    // Texto con un riel cian a la izquierda, a lo alto del párrafo.
    ctx.font = font(500, 36);
    const maxLines = line.choices.length > 2 ? 4 : 6;
    const lines = wrapLines(ctx, line.text, W - PAD * 2, maxLines);
    ctx.fillStyle = 'rgba(63,230,224,0.4)';
    ctx.fillRect(PAD - 20, 222 - 34, 4, (lines.length - 1) * 50 + 46);
    ctx.fillStyle = HOLO.text;
    let y = drawLines(ctx, lines, PAD, 222, 50) - 10;
    if (line.choices.length) {
      y = this.placeButtons(
        line.choices.map((c, i) => ({
          label: c,
          tone: i === 0 ? 'accent' : 'normal',
          disabled: false,
        })),
        { x: PAD - 16, y: y + 8, w: W - (PAD - 16) * 2, cols: 1 },
      );
      // Sin "Stick": fuera del inicio y del menú el stick camina y gira (el
      // pie no puede prometer que mueve el resaltado).
      return this.footer(ctx, y, 'Apuntá con el láser  ·  Gatillo o A: elegir');
    }
    y = this.placeButtons([{ label: 'Continuar', tone: 'accent', icon: 'next', disabled: false, keys: ['A'] }], {
      x: W - PAD - 380,
      y: y + 8,
      w: 380,
      cols: 1,
    });
    return this.footer(ctx, y, 'Gatillo o A: continuar');
  }

  private layoutCard(ctx: CanvasRenderingContext2D, card: CardView): number {
    let y = this.header(ctx, card.kicker || 'Dato', card.title, { mark: 'info' });
    y = this.body(ctx, card.text, y + 36, { size: 34, lh: 47, color: HOLO.text }) - 10;
    y = this.placeButtons([{ label: 'Cerrar', tone: 'accent', icon: 'close', disabled: false, keys: ['A', 'B'] }], {
      x: W - PAD - 400,
      y: y + 10,
      w: 400,
      cols: 1,
    });
    return this.footer(ctx, y, 'Gatillo, A o B: cerrar');
  }

  private layoutMenu(ctx: CanvasRenderingContext2D, m: { kicker: string; title: string; text: string; buttons: string[] }): number {
    if (/complet/i.test(m.kicker)) return this.layoutFinale(ctx, m);
    let y = this.header(ctx, m.kicker, m.title);
    y = this.body(ctx, m.text, y + 34, { lines: 8 }) - 8;
    const cols = m.buttons.length > 3 ? 2 : 1;
    y = this.placeButtons(
      // El primero (el que sigue: "Seguir explorando") con su flecha, como todos los demás botones.
      m.buttons.map((label, i) => ({
        label,
        tone: i === 0 ? 'accent' : 'normal',
        icon: i === 0 ? 'next' : undefined,
        disabled: false,
      })),
      {
        x: PAD - 16,
        y: y + 10,
        w: W - (PAD - 16) * 2,
        cols,
        fillLast: true,
      },
    );
    return this.footer(ctx, y, m.buttons.length > 1 ? 'Apuntá con el láser  ·  Gatillo o A: elegir' : 'Gatillo o A: continuar');
  }

  /**
   * "Recorrido 40 completo": el premio del juego. No puede verse como una
   * confirmación más: sello grande del 40 (con el anillo que gira, como en el
   * inicio), título centrado, la fila de sellos ganados y el borde dorado.
   */
  private layoutFinale(ctx: CanvasRenderingContext2D, m: { kicker: string; title: string; text: string; buttons: string[] }): number {
    const cx = W / 2;
    paintBigSeal(ctx, cx, SEAL_Y);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = HOLO.cyanText;
    ctx.font = font(700, 26);
    spacedCenter(ctx, m.kicker.toUpperCase(), cx, 222, 5);
    const size = fitFont(ctx, m.title, 800, 60, 44, W - PAD * 2);
    ctx.font = font(800, size);
    ctx.fillStyle = HOLO.text;
    ctx.textAlign = 'center';
    ctx.fillText(ellipsize(ctx, m.title, W - PAD * 2), cx, 284);
    circuitLine(ctx, cx - 150, 308, cx + 150);
    let y = 308;
    if (m.text) {
      ctx.fillStyle = HOLO.body2;
      ctx.font = font(500, 32);
      const lines = wrapLines(ctx, m.text, 860, 5);
      y = drawLines(ctx, lines, cx, y + 54, 44) - 30;
    }
    ctx.textAlign = 'left';
    // Los sellos ganados ("Sellos 8/8" en el texto del director): la fila del pasaporte, en chico.
    const st = /sellos\s+(\d+)\s*\/\s*(\d+)/i.exec(m.text);
    if (st) {
      const got = Number(st[1]);
      const total = Math.min(8, Number(st[2]));
      if (total > 0) {
        const r = 22;
        const step = 2 * r + 14;
        ctx.font = font(800, 30);
        const label = `${got}/${Number(st[2])} sellos`;
        const boxW = ctx.measureText(label).width + 40;
        const rowW = total * step - 14 + 28 + boxW;
        let sx = cx - rowW / 2 + r;
        const sy = y + 26 + r;
        for (let k = 0; k < total; k++, sx += step) paintFinaleStamp(ctx, sx, sy, r, k < got);
        // La cuenta en una casilla dorada maciza (sin chevron: no es un ajuste).
        const bx = sx - r + 14;
        chamferRect(ctx, bx, sy - 24, boxW, 48, 8);
        ctx.fillStyle = HOLO.gold;
        ctx.fill();
        ctx.fillStyle = HOLO.ink;
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + 20, sy + 1);
        ctx.textBaseline = 'alphabetic';
        y = sy + r + 6;
      }
    }
    y = this.placeButtons(
      m.buttons.map((label, i) => ({ label, tone: i === 0 ? 'accent' : 'normal', icon: i === 0 ? 'next' : undefined, disabled: false })),
      { x: PAD - 16, y: y + 22, w: W - (PAD - 16) * 2, cols: m.buttons.length > 3 ? 2 : 1, fillLast: true },
    );
    return this.footer(ctx, y, m.buttons.length > 1 ? 'Apuntá con el láser  ·  Gatillo o A: elegir' : 'Gatillo o A: continuar');
  }

  private layoutActivity(ctx: CanvasRenderingContext2D, v: ActivityView): number {
    let y = this.header(ctx, v.kicker, v.title, { progress: v.progress ?? '', mark: 'none' });
    const textX = v.grid ? 392 : PAD;
    const textW = W - textX - PAD;
    let textBottom = this.body(ctx, v.text, y + 32, { x: textX, w: textW, lines: this.compact ? 2 : 4 }) - 10;
    // Lugares libres del programa ("3/10 órdenes"): hasta dos punteados después de la última.
    const slots = /^(\d+)\s*\/\s*(\d+)\s*órden/.exec(v.progress ?? '');
    const free = slots ? Math.min(2, Math.max(0, Number(slots[2]) - Number(slots[1]))) : 0;
    if (v.sequence && (v.sequence.length || free)) {
      let sy = textBottom + 4;
      if (slots) {
        // El programa del robot con su rótulo: dos casillas punteadas sueltas
        // no decían que ahí se arma la secuencia con Avanzar y Girar.
        ctx.save();
        ctx.font = font(700, 26);
        ctx.fillStyle = HOLO.cyanText;
        ctx.textBaseline = 'alphabetic';
        spacedLeft(ctx, 'TU PROGRAMA', textX, sy + 24, 3);
        ctx.restore();
        sy += 34;
      }
      textBottom = drawHoloSequence(ctx, v.sequence, textX, sy, textW, 60, free, Boolean(slots) && v.sequence.length === 0) + 4;
    }
    if (v.feedback?.text) textBottom = drawFeedbackBanner(ctx, textX, textBottom + 8, textW, v.feedback.text, v.feedback.tone);
    if (v.grid) {
      // La pista del robot en una caja con esquineros; el papel crema se mantiene.
      const gx = PAD + 8;
      const gy = y + 14;
      insetBox(ctx, gx - 18, gy - 18, 290 + 36, 290 + 36);
      drawGrid(ctx, v.grid, gx, gy, 290);
      y = Math.max(textBottom, gy + 290 + 18);
    } else {
      y = textBottom;
    }
    const n = v.choices.length;
    // La salida ("Salir") NO va en la grilla: entre las respuestas de la
    // trivia se leía como una opción más, y su ✗ como "esa está mal". Va
    // sola, abajo a la derecha, apagada en reposo y con una puerta. Cada
    // botón conserva el índice de su opción en la vista.
    const answers: number[] = [];
    const exits: number[] = [];
    v.choices.forEach((c, i) => (c.exit ? exits : answers).push(i));
    const spec = (i: number): BtnSpec => {
      const c = v.choices[i];
      const off = Boolean(c.disabled) || Boolean(v.busy && !c.exit);
      return {
        label: c.label,
        icon: c.exit && (c.icon === 'close' || !c.icon) ? 'door' : c.icon,
        tone: c.exit ? 'ghost' : c.tone === 'accent' || c.tone === 'good' ? 'accent' : c.tone === 'bad' ? 'bad' : 'normal',
        disabled: off,
        // Mientras anima no hay candado: vuelve solo.
        busy: off && Boolean(v.busy),
      };
    };
    const m = answers.length;
    // Tres respuestas de texto (trivia, menú saludable): una debajo de la
    // otra, a todo lo ancho, como en un juego de preguntas. Con íconos
    // (los cestos) entran las tres en una fila.
    const allIcons = answers.every((i) => Boolean(v.choices[i].icon));
    const cols = m > 4 ? 3 : m === 3 ? (allIcons ? 3 : 1) : m > 1 ? 2 : 1;
    let right = W - (PAD - 16);
    if (m === 1) {
      y = this.placeButtons(answers.map(spec), { x: W - PAD - 380, y: y + 16, w: 380, cols: 1, indexes: answers });
      right = W - PAD;
    } else if (m > 1) {
      y = this.placeButtons(answers.map(spec), { x: PAD - 16, y: y + 16, w: W - (PAD - 16) * 2, cols, spreadLast: true, indexes: answers });
    }
    if (exits.length) {
      const ew = 300;
      const total = ew * exits.length + GAP * (exits.length - 1);
      y = this.placeButtons(exits.map(spec), { x: right - total, y: y + (m ? GAP : 16), w: total, cols: exits.length, font: 30, indexes: exits });
    }
    return this.footer(ctx, y, n > 1 ? 'Apuntá con el láser  ·  Gatillo o A: elegir' : 'Gatillo o A: continuar');
  }

  /** Pantalla genérica (menú de pausa, ajustes, pasaporte, confirmaciones). */
  private layoutScreen(ctx: CanvasRenderingContext2D, s: PanelScreen): number {
    const danger = s.buttons.some((b) => b.tone === 'bad');
    let y = this.header(ctx, s.kicker ?? '', s.title, { tone: danger ? 'bad' : 'normal' });
    const n = s.buttons.length;
    // Cuánto ocupan los botones: si no entran, más bajos y después en dos columnas.
    let cols: number = s.columns ?? 1;
    let bh = BTN_H;
    let gap = GAP;
    // Una confirmación (dos opciones lado a lado) lleva botones más altos: es la decisión de la pantalla.
    if (n === 2 && cols === 2 && !s.draw) bh = 96;
    const drawH = s.draw ? (s.drawHeight ?? 320) : 0;
    const blockH = () => {
      const rows = Math.ceil(n / cols);
      return rows * bh + Math.max(0, rows - 1) * gap;
    };
    const fixed = () => y + 20 + (drawH ? drawH + 24 : 0) + blockH() + 22 + FOOTER_H + 4;
    if (fixed() > HMAX) {
      bh = BTN_H;
      gap = 16;
    }
    if (fixed() > HMAX && cols === 1 && n > 3) cols = 2;
    if (s.text) {
      // "Objetivo: … (55 m)" del menú del juego: como misión, con la distancia aparte.
      const mm = /^Objetivo:\s*(.*?)(?:\s*\(([^()]+)\))?$/.exec(s.text);
      if (mm) {
        y = this.mission(ctx, `Objetivo: ${mm[1]}`, mm[2] ?? '', y + 14);
      } else {
        const room = HMAX - fixed() - 10;
        const lines = Math.max(1, Math.min(10, Math.floor(room / 44)));
        y = this.body(ctx, s.text, y + 34, { lines }) - 14;
      }
    }
    if (s.draw) {
      const area = { x: PAD - 16, y: y + 16, w: W - (PAD - 16) * 2, h: drawH };
      insetBox(ctx, area.x, area.y, area.w, area.h);
      const inner = { x: area.x + 18, y: area.y + 14, w: area.w - 36, h: area.h - 28 };
      ctx.save();
      ctx.beginPath();
      ctx.rect(inner.x, inner.y, inner.w, inner.h);
      ctx.clip();
      s.draw(ctx, inner);
      ctx.restore();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      y = area.y + area.h + 8;
    }
    const specs: BtnSpec[] = s.buttons.map((b, i) => ({
      label: b.label,
      sub: b.sub,
      value: b.value,
      tone: b.tone ?? 'normal',
      icon: b.icon,
      disabled: Boolean(b.disabled),
      // B elige este: la ficha lo dice siempre, sin tener que apuntarlo.
      keys: s.back === i ? ['B'] : undefined,
    }));
    y = this.placeButtons(specs, {
      x: PAD - 16,
      y: y + 16,
      w: W - (PAD - 16) * 2,
      cols,
      h: bh,
      gap,
      font: cols >= 2 ? 32 : 34,
      fillLast: true,
    });
    const hint = s.back !== undefined ? 'Gatillo o A: elegir  ·  B: volver  ·  Stick: moverse' : 'Gatillo o A: elegir  ·  Stick: moverse';
    return this.footer(ctx, y, s.footer ?? hint);
  }

  /** La pantalla de inicio de PC/celular (#title en index.html), adaptada al visor. */
  private layoutTitle(ctx: CanvasRenderingContext2D, s: PanelScreen): number {
    const cx = W / 2;
    // Grilla de puntos alrededor del sello (la única textura del panel: lejos de todo texto).
    for (let gy = 20; gy < 190; gy += 24) {
      for (let gx = 20; gx < W - 20; gx += 24) {
        const d = Math.hypot(gx - cx, gy - SEAL_Y);
        const a = 0.06 * Math.max(0, 1 - d / 330);
        if (a <= 0.004) continue;
        ctx.fillStyle = `rgba(63,230,224,${a.toFixed(3)})`;
        ctx.fillRect(gx - 1.5, gy - 1.5, 3, 3);
      }
    }
    // Sello 40 como el de la PC: disco, anillo rojo, anillo interior tenue y el número dorado.
    paintBigSeal(ctx, cx, SEAL_Y);
    ctx.textAlign = 'center';

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = HOLO.body2;
    ctx.font = font(700, 26);
    spacedCenter(ctx, (s.kicker ?? 'Escuela CIMDIP & Miguel Cané').toUpperCase(), cx, 222, 5);

    // "RECORRIDO 40": espaciado, con el 40 en dorado y negrita (como el h1 HTML).
    // 400 en vez del 300 de la PC: misma silueta, trazo que se sostiene en el visor.
    const word = (s.title || 'Recorrido 40').toUpperCase();
    const m = /^(.*?)(\s*\d+)$/.exec(word);
    const head = m ? m[1] : word;
    const num = m ? m[2].trim() : '';
    const sp = 16;
    ctx.font = font(400, 80);
    const hw = spacedWidth(ctx, head, sp);
    ctx.font = font(800, 80);
    const nw = num ? spacedWidth(ctx, num, sp) + 28 : 0;
    let x = cx - (hw + nw) / 2;
    ctx.fillStyle = HOLO.text;
    ctx.font = font(400, 80);
    x = spacedLeft(ctx, head, x, 302, sp);
    if (num) {
      ctx.fillStyle = HOLO.gold;
      ctx.font = font(800, 80);
      spacedLeft(ctx, num, x + 28, 302, sp);
    }
    circuitLine(ctx, cx - 150, 326, cx + 150);

    let y = 352;
    if (s.text) {
      ctx.textAlign = 'center';
      ctx.fillStyle = HOLO.body2;
      ctx.font = font(500, 32);
      const lines = wrapLines(ctx, s.text, 860, 4);
      y = drawLines(ctx, lines, cx, y + 26, 44) - 30;
    }
    ctx.textAlign = 'left';
    const legalLines = (() => {
      ctx.font = font(500, 24);
      // Parejas: "2020." solo en la segunda línea parecía un error.
      return s.footer ? wrapSmart(ctx, s.footer, 880) : [];
    })();
    const tail = 30 + 40 + 24 + legalLines.length * 30;
    const specs: BtnSpec[] = s.buttons.map((b, i) => ({
      label: b.label,
      sub: b.sub,
      value: b.value,
      tone: b.tone ?? 'normal',
      icon: b.icon,
      disabled: Boolean(b.disabled),
      // El principal, dorado macizo como `.big-btn.primary`.
      solid: i === 0 && b.tone === 'accent',
    }));
    const n = specs.length;
    const top = y + 22;
    const oneCol = (h: number, gap: number) => top + n * h + (n - 1) * gap + tail;
    if (oneCol(90, 18) <= HMAX) {
      y = this.placeButtons(specs, { x: cx - 340, y: top, w: 680, cols: 1, h: 90, gap: 18, font: 36 });
    } else if (oneCol(BTN_H, 16) <= HMAX) {
      y = this.placeButtons(specs, { x: cx - 340, y: top, w: 680, cols: 1, h: BTN_H, gap: 16, font: 34 });
    } else {
      // No entran en una columna (con "Continuar" son cinco): el principal a lo
      // ancho y el resto de a dos, sin achicar ninguno.
      const w = W - (PAD - 16) * 2;
      y = this.placeButtons(specs.slice(0, 1), { x: PAD - 16, y: top, w, cols: 1, h: 90, font: 36 });
      y = this.placeButtons(specs.slice(1), { x: PAD - 16, y: y + 16, w, cols: 2, h: BTN_H, gap: 16, font: 32, indexBase: 1, fillLast: true });
    }
    // Pie: las fichas de los botones y, debajo, la letra legal.
    drawKeyRow(ctx, 'Gatillo o A: elegir  ·  Stick: moverse', cx, y + 30 + 20, 880, { h: 40, size: 28 });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(169,194,184,0.85)';
    ctx.font = font(500, 24);
    const end = drawLines(ctx, legalLines, cx, y + 30 + 40 + 24 + 20, 30);
    ctx.textAlign = 'left';
    return end + 4;
  }
}

/** Identidad del contenido para decidir si un `show` es un refresco del mismo panel. */
function modelKey(model: PanelModel): string | null {
  switch (model.kind) {
    case 'activity':
      return `activity|${model.view.kicker}|${model.view.title}`;
    case 'screen':
      return `screen|${model.screen.style ?? ''}|${model.screen.kicker ?? ''}|${model.screen.title}|${model.screen.buttons.length}`;
    case 'menu':
      return `menu|${model.kicker}|${model.title}`;
    default:
      // Cada línea de diálogo y cada ficha es nueva: se vuelve a armar.
      return null;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function easeOutCubic(t: number): number {
  const u = 1 - Math.max(0, Math.min(1, t));
  return 1 - u * u * u;
}

/** Luminancia relativa (0 a 1) de un color "#rrggbb" (o "#rgb"). */
function luminance(hex: string): number {
  const c = Color3.FromHexString(expandHex(hex));
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * El color del personaje, legible sobre el vidrio: si es oscuro se le sube
 * la LUZ (HSL) a 0,68 o más, con saturación de 0,55 o más, hasta un
 * contraste de 4,5:1 con el vidrio. Mezclado con blanco, el azul de Rubén
 * quedaba gris celeste y parecía un rótulo apagado.
 */
function readableOnGlass(hex: string): string {
  if (luminance(hex) >= 0.35) return hex;
  const c = Color3.FromHexString(expandHex(hex));
  const { h, s, l } = toHsl(c.r, c.g, c.b);
  const sat = Math.max(s, 0.55);
  let light = Math.max(l, 0.68);
  let out = fromHsl(h, sat, light);
  const glass = luminance('#0c232a');
  while ((luminance(out) + 0.05) / (glass + 0.05) < 4.5 && light < 0.9) {
    light += 0.04;
    out = fromHsl(h, sat, light);
  }
  return out;
}

function expandHex(hex: string): string {
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
}

function toHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return new Color3(r + m, g + m, b + m).toHexString();
}

/**
 * Bloque izquierdo del aviso. Medalla del 40 llena sólo para un logro: un
 * sello (anillo rojo del sello) o un lugar nuevo (anillo verde: verde =
 * lugar). Un objetivo cumplido, un ✓ verde; lo demás, un ícono cian en un
 * círculo: el mando (controles), un candado abierto (se abrió algo), un
 * parlante (entrevista) o una "i" (un dato).
 */
/** Sello grande del 40 (inicio y final): disco, anillo rojo, anillo interior tenue y el número dorado. */
function paintBigSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.fillStyle = UI.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, 64, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(192,48,58,0.18)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = HOLO.red40;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 64, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = HOLO.gold;
  ctx.font = font(800, 58);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('40', cx, cy + 3);
  ctx.restore();
}

/**
 * Un sello de la fila del final: ganado, como en el pasaporte (anillo rojo,
 * girado, el 40 dorado; sin el nombre, que en chico no se lee); el que
 * falta, la ranura punteada.
 */
function paintFinaleStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, got: boolean): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (got) {
    ctx.rotate(-0.12);
    ctx.fillStyle = UI.ink;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = HOLO.red40;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = HOLO.gold;
    ctx.font = font(800, 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('40', 0, 1);
  } else {
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(63,230,224,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function paintToastBadge(ctx: CanvasRenderingContext2D, kind: ToastKind, cx: number, cy: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind === 'place') {
    // Lugar nuevo: disco verde con un pin de ubicación. El "40" es sólo de
    // los sellos (con el 40 el chico creía que había ganado uno y después el
    // pasaporte seguía en 0/8).
    ctx.fillStyle = HOLO.ok;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = HOLO.ink;
    ctx.fillStyle = HOLO.ink;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    // Gota: un círculo con la punta abajo y el agujero al centro.
    const py = cy - 8;
    ctx.beginPath();
    ctx.arc(cx, py, 14, Math.PI * 0.8, Math.PI * 2.2);
    ctx.lineTo(cx, py + 30);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, py, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (kind === 'stamp') {
    ctx.fillStyle = HOLO.gold;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = HOLO.red40;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, 43, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = HOLO.ink;
    ctx.font = font(800, 34);
    ctx.fillText('40', cx, cy + 2);
    ctx.restore();
    return;
  }
  const ring = kind === 'objective' ? HOLO.ok : HOLO.cyan;
  ctx.fillStyle = 'rgba(7,20,23,0.6)';
  ctx.beginPath();
  ctx.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = HOLO.cyanText;
  ctx.fillStyle = HOLO.cyanText;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'objective':
      ctx.strokeStyle = HOLO.ok;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 17, cy + 1);
      ctx.lineTo(cx - 5, cy + 13);
      ctx.lineTo(cx + 18, cy - 13);
      ctx.stroke();
      break;
    case 'controls':
      drawHoloIcon(ctx, 'pad', cx, cy, 46, HOLO.cyanText);
      break;
    case 'voice':
      drawHoloIcon(ctx, 'sound', cx, cy, 42, HOLO.cyanText);
      break;
    case 'unlock':
      // Candado abierto: el arco suelto de un lado.
      ctx.lineWidth = 4;
      ctx.strokeRect(cx - 14, cy - 2, 28, 22);
      ctx.beginPath();
      ctx.arc(cx - 2, cy - 10, 10, Math.PI, Math.PI * 1.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy - 10);
      ctx.lineTo(cx - 12, cy - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + 9, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.beginPath();
      ctx.arc(cx, cy - 15, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 3);
      ctx.lineTo(cx, cy + 18);
      ctx.stroke();
  }
  ctx.restore();
}

/**
 * Marco del resplandor: un anillo de 8 vértices (borde de afuera y de
 * adentro) con la textura de perfil cruzándolo. Así el halo tiene el mismo
 * grosor en un botón angosto que en uno de lado a lado (un plano estirado lo
 * deformaba). Las posiciones se escriben al cambiar el resaltado.
 */
function buildGlowFrame(scene: Scene): Mesh {
  const mesh = new Mesh('gamePanelGlow', scene);
  const vd = new VertexData();
  vd.positions = new Array(24).fill(0);
  // u = 0 afuera, 1 adentro (el perfil de la textura va de transparente a brillo a transparente).
  vd.uvs = [0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5];
  // prettier-ignore
  vd.indices = [
    0, 1, 5, 0, 5, 4, // arriba
    1, 2, 6, 1, 6, 5, // derecha
    2, 3, 7, 2, 7, 6, // abajo
    3, 0, 4, 3, 4, 7, // izquierda
  ];
  vd.normals = new Array(24).fill(0).map((_, i) => (i % 3 === 2 ? -1 : 0));
  vd.applyToMesh(mesh, true);
  return mesh;
}

/** Perfil del resplandor: transparente afuera, brillo en el borde del botón, transparente adentro. */
function paintGlowProfile(tex: DynamicTexture): void {
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  const edge = GLOW_OUT / (GLOW_OUT + GLOW_IN);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(edge * 0.55, 'rgba(255,255,255,0.35)');
  g.addColorStop(edge, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.clearRect(0, 0, 64, 4);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);
  tex.update(true);
}

/** Perfil de la barra de escaneo: se apaga hacia los costados. */
function paintScanProfile(tex: DynamicTexture): void {
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.2, 'rgba(255,255,255,1)');
  g.addColorStop(0.8, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.clearRect(0, 0, 64, 4);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);
  tex.update(true);
}

/** Anillo punteado del sello del inicio (r 88 px del lienzo en un cuadrado de 192). */
function paintRing(tex: DynamicTexture): void {
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const k = 256 / RING_PX;
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(63,230,224,0.5)';
  ctx.lineWidth = 3 * k;
  ctx.setLineDash([14 * k, 12 * k]);
  ctx.beginPath();
  ctx.arc(128, 128, 88 * k, 0, Math.PI * 2);
  ctx.stroke();
  tex.update(true);
}
