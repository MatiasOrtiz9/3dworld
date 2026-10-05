import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import { XR_HANDS, type XRHand, type XRInput, type XRSourceChange } from './XRInput';

export type PointerState = 'idle' | 'hover' | 'press';
/** `onTop`: el impacto es un panel (grupo de render 1, por encima de la ciudad). */
export interface PointerHit {
  distance: number;
  state: PointerState;
  onTop?: boolean;
}

/** Largo del láser sin impacto en la mano activa: alcanza para ver hacia dónde apunta. */
const IDLE_LENGTH = 2.5;
/** Tramo de la mano que no tiene el láser: sólo dice "esta mano también apunta". */
const STUB_LENGTH = 0.22;
/** Diámetro de la retícula por metro de distancia (~1,1°): igual de grande cerca y lejos. */
const RETICLE_ANGLE = 0.019;
/** La retícula se adelanta un poco hacia la mano: pegada al panel parpadeaba con él. */
const RETICLE_LIFT = 0.006;

type Look = 'idle' | 'hover' | 'press' | 'faint';
const LOOKS: Record<Look, { color: string; laser: number; reticle: number }> = {
  idle: { color: '#b7d4ca', laser: 0.4, reticle: 0.75 },
  // Cian, como el botón resaltado: "lo que apuntás" tiene un solo color (el
  // dorado queda para lo importante y los botones del mando). Apretado, el
  // mismo blanco cian del contorno del botón apretado.
  hover: { color: '#3fe6e0', laser: 0.9, reticle: 1 },
  press: { color: '#e9fffd', laser: 1, reticle: 1 },
  faint: { color: '#b7d4ca', laser: 0.16, reticle: 0.5 },
};

interface HandVisual {
  laser: Mesh;
  reticle: Mesh;
  source: WebXRInputSource | null;
  hit: PointerHit | null;
  hidden: boolean;
}

/**
 * Láser y retícula de los dos mandos.
 *
 * El puntero de Babylon (POINTER_SELECTION) se reemplazó por `XRInput`: el
 * juego prueba sus propios rayos contra los paneles y lo enfocable, y le
 * cuenta a este objeto, cuadro a cuadro, dónde terminó cada rayo y en qué
 * estado (`setHit`). Acá sólo se dibuja:
 *
 *  - **El láser** es un cilindro fino (≈2,5 mm, un poco más grueso en la
 *    punta para que se vea lejos) hijo del nodo puntero del mando, que en
 *    Babylon apunta hacia +Z local (−Z con el sistema de mano derecha). Se
 *    estira con `scaling.z`: no se reconstruye nada.
 *  - **La retícula** (punto y anillo) va en la punta, perpendicular al rayo,
 *    y escala con la distancia: ocupa el mismo ángulo cerca y lejos.
 *  - **El color dice el estado**: verde agua tenue sin nada, dorado sobre algo
 *    que se puede elegir, blanco cálido (y retícula más chica) apretando.
 *
 * Los materiales son emisivos sin luz ni niebla: con niebla y sin luz
 * (de noche, a la sombra) el láser se pintaba negro. Son 4 mallas en total.
 */
export class XRPointer {
  private active: XRHand = 'right';
  private enabled = true;
  private readonly hands: Record<XRHand, HandVisual>;
  private readonly laserMats: Record<Look, StandardMaterial>;
  private readonly reticleMats: Record<Look, StandardMaterial>;
  private readonly forward: number;
  private readonly sourceObserver: Observer<XRSourceChange>;

  constructor(
    scene: Scene,
    private readonly input: XRInput,
  ) {
    this.forward = scene.useRightHandedSystem ? -1 : 1;
    this.laserMats = materials(scene, 'xrLaser', 'laser');
    this.reticleMats = materials(scene, 'xrReticle', 'reticle');
    const laserTemplate = buildLaser(scene);
    const reticleTemplate = buildReticle(scene);
    const make = (hand: XRHand): HandVisual => {
      const laser = laserTemplate.clone(`xrLaser-${hand}`);
      const reticle = reticleTemplate.clone(`xrReticle-${hand}`);
      for (const m of [laser, reticle]) {
        m.isPickable = false;
        m.setEnabled(false);
        // Pegado al mando: nunca sale del cuadro, no hace falta probar su caja.
        m.alwaysSelectAsActiveMesh = true;
      }
      return { laser, reticle, source: null, hit: null, hidden: false };
    };
    this.hands = { left: make('left'), right: make('right') };
    laserTemplate.dispose();
    reticleTemplate.dispose();

    for (const hand of XR_HANDS) this.attach(hand, input.source(hand));
    // El nodo puntero es de la fuente de Babylon y muere con ella: al cambiar
    // el mando de una mano, el láser se muda al nodo nuevo.
    this.sourceObserver = input.onSourceChanged.add(({ hand, source }) => this.attach(hand, source));
  }

  get activeHand(): XRHand {
    return this.active;
  }

  /** La mano del láser: el juego la cambia cuando se aprieta el gatillo de la otra. */
  set activeHand(hand: XRHand) {
    if (hand === this.active) return;
    this.active = hand;
    for (const h of XR_HANDS) this.apply(h);
  }

  /** Dónde terminó el rayo de la mano en este cuadro (o `null`: no tocó nada). */
  setHit(hand: XRHand, hit: PointerHit | null): void {
    const v = this.hands[hand];
    const prev = v.hit;
    if (
      prev === hit ||
      (prev && hit && prev.state === hit.state && prev.onTop === hit.onTop && Math.abs(prev.distance - hit.distance) < 1e-4)
    ) {
      return;
    }
    v.hit = hit ? { distance: hit.distance, state: hit.state, onTop: hit.onTop } : null;
    this.apply(hand);
  }

  /** Esconde el láser de una mano (p. ej. mientras el stick apunta el teletransporte). */
  setHidden(hand: XRHand, hidden: boolean): void {
    if (this.hands[hand].hidden === hidden) return;
    this.hands[hand].hidden = hidden;
    this.apply(hand);
  }

  /** Todo apagado (escenas guionadas, pantalla en negro). */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    for (const hand of XR_HANDS) this.apply(hand);
  }

  dispose(): void {
    this.input.onSourceChanged.remove(this.sourceObserver);
    for (const hand of XR_HANDS) {
      this.hands[hand].laser.dispose();
      this.hands[hand].reticle.dispose();
    }
    for (const m of Object.values(this.laserMats)) m.dispose();
    for (const m of Object.values(this.reticleMats)) m.dispose();
  }

  // ------------------------------------------------------------------ interno

  private attach(hand: XRHand, source: WebXRInputSource | null): void {
    const v = this.hands[hand];
    v.source = source;
    v.hit = null;
    v.laser.parent = source?.pointer ?? null;
    v.reticle.parent = source?.pointer ?? null;
    this.apply(hand);
  }

  private apply(hand: XRHand): void {
    const v = this.hands[hand];
    const { laser, reticle, hit } = v;
    const isActive = hand === this.active;
    if (!this.enabled || v.hidden || !v.source) {
      laser.setEnabled(false);
      reticle.setEnabled(false);
      return;
    }
    const group = hit?.onTop ? 1 : 0;
    laser.renderingGroupId = group;
    reticle.renderingGroupId = group;
    let look: Look;
    let length: number;
    if (hit) {
      look = hit.state;
      length = Math.max(0.02, hit.distance - RETICLE_LIFT);
    } else if (isActive) {
      look = 'idle';
      length = IDLE_LENGTH;
    } else {
      look = 'faint';
      length = STUB_LENGTH;
    }
    // La mano sin el láser, sin impacto, sólo muestra un tramo apenas visible.
    if (hit && !isActive && hit.state === 'idle') look = 'faint';
    laser.material = this.laserMats[look];
    laser.scaling.z = length * this.forward;
    laser.setEnabled(true);

    if (!hit) {
      reticle.setEnabled(false);
      return;
    }
    const size = Math.max(0.008, hit.distance * RETICLE_ANGLE) * (hit.state === 'press' ? 0.7 : 1);
    reticle.material = this.reticleMats[look];
    reticle.position.set(0, 0, length * this.forward);
    reticle.scaling.setAll(size);
    reticle.setEnabled(true);
  }
}

function materials(scene: Scene, name: string, which: 'laser' | 'reticle'): Record<Look, StandardMaterial> {
  const out = {} as Record<Look, StandardMaterial>;
  for (const look of Object.keys(LOOKS) as Look[]) {
    const m = new StandardMaterial(`${name}-${look}`, scene);
    const c = Color3.FromHexString(LOOKS[look].color);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = c;
    m.disableLighting = true;
    m.fogEnabled = false;
    m.backFaceCulling = false;
    m.alpha = LOOKS[look][which];
    // Transparente y sin escribir profundidad: no tapa lo que señala.
    m.disableDepthWrite = true;
    out[look] = m;
  }
  return out;
}

/** Cilindro de largo 1 desde el origen hacia +Z: se estira con `scaling.z`. */
function buildLaser(scene: Scene): Mesh {
  const m = CreateCylinder('xrLaserTemplate', { height: 1, diameterTop: 0.0034, diameterBottom: 0.0022, tessellation: 6 }, scene);
  // El cilindro nace a lo largo de +Y: se acuesta sobre +Z y se corre para que arranque en el mando.
  m.rotation.x = Math.PI / 2;
  m.position.z = 0.5;
  m.bakeCurrentTransformIntoVertices();
  return m;
}

/** Punto y anillo de diámetro 1, en el plano XY (perpendicular al rayo). */
function buildReticle(scene: Scene): Mesh {
  const dot = CreateDisc('xrReticleDot', { radius: 0.17, tessellation: 14, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const ring = CreateTorus('xrReticleRing', { diameter: 0.86, thickness: 0.1, tessellation: 24 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.bakeCurrentTransformIntoVertices();
  return Mesh.MergeMeshes([dot, ring], true, true)!;
}
