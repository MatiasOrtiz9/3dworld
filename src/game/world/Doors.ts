import type { Scene } from '@babylonjs/core/scene';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DOORS, doorRect, type DoorDef, type LeafDef } from '../../world/SchoolDoors';
import { LEVEL_Y, setDynamicSolid, toWorld, type Level, type SchoolFrame } from '../../world/SchoolLayout';
import { INTERIOR_ENV, calibratePbr } from '../../world/Materials';
import type { SchoolPhase, WorldPoint } from '../contracts';
import { ThinSet } from './ThinSet';

/**
 * Puertas de aulas y oficinas que se abren y se cierran.
 *
 * - El jugador las abre o cierra con E (gatillo en el visor), y se abren
 *   solas cuando alguien llega caminando: la gente de la escuela y también
 *   el jugador, para que una puerta cerrada nunca se sienta como una pared.
 * - Durante la clase las aulas están cerradas; en el recreo, la entrada y la
 *   salida, abiertas.
 * - Una puerta cerrada es maciza sólo para el jugador (`playerOnly`): la gente
 *   no la tiene en cuenta al planear, porque la abre al llegar.
 *
 * Todas las hojas son cajas de UNA malla con color por instancia: un draw call.
 */

const hex = (h: string) => Color3.FromHexString(h);

/** Colores de las hojas: los mismos materiales del constructor de la escuela. */
const LEAF: Record<string, Color3> = {
  frame: hex('#e6e8e8'),
  red: hex('#b81e24'),
  timberDark: hex('#7b5236'),
  blue: hex('#1d4fb0'),
  chairGreen: hex('#2f7a5c'),
};
const BOARD = hex('#f1f2f1');
const GLASS = hex('#86a6b6');
const HANDLE = hex('#2b2f36');

/** Ángulo de la hoja abierta: contra el muro del ambiente, como las dibujaba la escuela. */
const OPEN_ANGLE = Math.PI / 2 - 0.04;
/** Segundos para abrir o cerrar del todo. */
const SWING_TIME = 0.6;
/** Distancia (plano) a la que una persona que llega abre la puerta. */
const NEAR = 1.7;
/** Segundos que queda abierta después de que la persona pasó. */
const HOLD = 2.4;

interface Part {
  i: number;
  /** Fracciones del ancho de la hoja, desde la bisagra. */
  f0: number;
  f1: number;
  /** Alturas sobre el piso del nivel. */
  y0: number;
  y1: number;
  thick: number;
}

interface LeafVis {
  def: LeafDef;
  parts: Part[];
}

export interface DoorState {
  def: DoorDef;
  leaves: LeafVis[];
  /** 0 cerrada, 1 abierta. */
  open: number;
  /** Lo que quiere el jugador (o la fase del día). */
  want: boolean;
  /** Segundos que alguien la mantiene abierta. */
  held: number;
  /** Después de cerrarla a mano, el jugador no la vuelve a abrir al estar al lado. */
  playerSuppressed: boolean;
  solid: boolean;
  moving: boolean;
  center: WorldPoint;
  cu: number;
  cv: number;
  dirty: boolean;
}

export class Doors {
  private readonly set: ThinSet;
  private readonly material: PBRMetallicRoughnessMaterial;
  private readonly states: DoorState[] = [];
  private readonly byId = new Map<string, DoorState>();
  private senseT = 0;
  private phaseSet = false;
  /** Último lugar del jugador: las puertas lejanas no suenan. */
  private player = { u: 0, v: 0, level: 0 as Level };

  constructor(
    scene: Scene,
    private readonly frame: SchoolFrame,
    private readonly onSound: (open: boolean, at: WorldPoint) => void,
  ) {
    // PBR como los muros interiores: con un material estándar la cara que no
    // mira al sol quedaba casi negra; con la luz del cielo (atenuada bajo
    // techo, como los interiores) las dos caras se leen igual que la pared.
    this.material = new PBRMetallicRoughnessMaterial('game-doors', scene);
    calibratePbr(this.material);
    (this.material as unknown as { _environmentIntensity: number })._environmentIntensity = INTERIOR_ENV * 1.4;
    this.material.baseColor = new Color3(1, 1, 1);
    this.material.metallic = 0;
    this.material.roughness = 0.55;
    this.material.emissiveColor = new Color3(0.05, 0.05, 0.05);
    const mesh = CreateBox('game-doors', { size: 1 }, scene);
    mesh.material = this.material;
    this.set = new ThinSet(mesh, 256);

    for (const def of DOORS) {
      const leafColor = (def.color && LEAF[def.color]) || BOARD;
      const top = def.height;
      const leaves = def.leaves.map((L): LeafVis => {
        const parts: Part[] = [];
        const add = (c: Color3, f0: number, f1: number, y0: number, y1: number, thick: number) =>
          parts.push({ i: this.set.add(c), f0, f1, y0, y1, thick });
        if (def.glass) {
          // Hoja de aluminio: tablero abajo, paño vidriado arriba en su marco.
          add(leafColor, 0, 1, -0.02, 0.95, 0.045);
          add(GLASS, 0.06, 0.94, 0.95, top - 0.12, 0.02);
          add(leafColor, 0, 1, top - 0.12, top, 0.05);
          add(leafColor, 0, 0.06, 0.95, top - 0.12, 0.05);
          add(leafColor, 0.94, 1, 0.95, top - 0.12, 0.05);
        } else {
          add(leafColor, 0, 1, -0.02, top, 0.045);
        }
        // Picaporte, de los dos lados.
        add(HANDLE, 0.86, 0.95, 0.96, 1.0, 0.13);
        return { def: L, parts };
      });
      const cu = (def.a[0] + def.b[0]) / 2;
      const cv = (def.a[1] + def.b[1]) / 2;
      const W = toWorld(frame, cu, cv);
      const st: DoorState = {
        def,
        leaves,
        open: 1,
        want: true,
        held: 0,
        playerSuppressed: false,
        solid: false,
        moving: false,
        center: { x: W.x, y: LEVEL_Y[def.level] + 1.1, z: W.z },
        cu,
        cv,
        dirty: true,
      };
      this.states.push(st);
      this.byId.set(def.id, st);
    }
    for (const st of this.states) this.pose(st);
    this.set.flush();
  }

  /** Puertas, para la lista de cosas con las que se puede interactuar. */
  get all(): readonly DoorState[] {
    return this.states;
  }

  /** Abierta (o abriéndose) tal como se ve: la de la fase, la del jugador o la que alguien sostiene. */
  isOpen(id: string): boolean {
    const st = this.byId.get(id);
    return Boolean(st && (st.want || st.held > 0));
  }

  label(id: string): string {
    return this.byId.get(id)?.def.label ?? 'Puerta';
  }

  /** El jugador la abre o la cierra. Devuelve el nuevo estado (true = abierta). */
  toggle(id: string): boolean {
    const st = this.byId.get(id);
    if (!st) return false;
    const open = !(st.want || st.held > 0);
    st.want = open;
    st.held = 0;
    // Cerrada a mano con el jugador al lado: que no se vuelva a abrir sola
    // hasta que se aleje.
    st.playerSuppressed = !open;
    return open;
  }

  /**
   * Momento del día: en clase las aulas cierran; en el resto, abiertas. La
   * primera vez se aplica sin animación (al cargar no deben golpear quince
   * puertas a la vez).
   */
  setPhase(phase: SchoolPhase): void {
    const instant = !this.phaseSet;
    this.phaseSet = true;
    for (const st of this.states) {
      const isClass = /^aula|^tecnologia|^arte|^teatro|^bilingue/.test(st.def.room.id);
      if (!isClass) continue;
      const want = phase !== 'clase';
      if (want !== st.want) {
        st.want = want;
        st.playerSuppressed = false;
      }
      if (instant) {
        st.open = want ? 1 : 0;
        st.dirty = true;
      }
    }
  }

  /**
   * Por cuadro: animación, colisión y quién llega a la puerta.
   * `player` en coordenadas del plano; `people` recorre a la gente presente.
   */
  update(dt: number, player: { u: number; v: number; level: Level }, people?: (fn: (u: number, v: number, level: Level) => void) => void): void {
    this.player = player;
    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = 0.15;
      this.sense(player, people);
    }
    let any = false;
    for (const st of this.states) {
      if (st.held > 0) st.held -= dt;
      const target = st.want || st.held > 0 ? 1 : 0;
      if (st.open !== target) {
        const was = st.open;
        const step = dt / SWING_TIME;
        st.open = target > st.open ? Math.min(target, st.open + step) : Math.max(target, st.open - step);
        // Sonido cuando arranca a moverse (no en cada cuadro).
        if (!st.moving) this.sound(st, target === 1);
        st.moving = st.open !== target;
        if (was !== st.open) st.dirty = true;
      } else {
        st.moving = false;
      }
      // Maciza sólo mientras está casi cerrada.
      const solid = st.open < 0.45;
      if (solid !== st.solid) {
        st.solid = solid;
        setDynamicSolid(`door:${st.def.id}`, solid ? doorRect(st.def) : null, { playerOnly: true });
      }
      if (st.dirty) {
        this.pose(st);
        any = true;
      }
    }
    if (any) this.set.flush();
  }

  private sense(player: { u: number; v: number; level: Level }, people?: (fn: (u: number, v: number, level: Level) => void) => void): void {
    for (const st of this.states) {
      if (st.def.level !== player.level) {
        st.playerSuppressed = false;
        continue;
      }
      const d = Math.hypot(player.u - st.cu, player.v - st.cv);
      if (st.playerSuppressed) {
        if (d > 2.2) st.playerSuppressed = false;
      } else if (d < NEAR) {
        st.held = HOLD;
      }
    }
    if (!people) return;
    people((u, v, level) => {
      for (const st of this.states) {
        if (st.def.level !== level) continue;
        const du = u - st.cu;
        const dv = v - st.cv;
        if (du * du + dv * dv < NEAR * NEAR) st.held = HOLD;
      }
    });
  }

  private sound(st: DoorState, open: boolean): void {
    // Sólo las cercanas: un cambio de fase mueve muchas puertas a la vez.
    const p = this.player;
    if (p.level !== st.def.level || Math.hypot(p.u - st.cu, p.v - st.cv) > 14) return;
    try {
      this.onSound(open, st.center);
    } catch {
      // El audio es opcional.
    }
  }

  private pose(st: DoorState): void {
    st.dirty = false;
    const base = LEVEL_Y[st.def.level];
    const ang = st.open * OPEN_ANGLE;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const [su, sv] = st.def.swing;
    for (const L of st.leaves) {
      const [du0, dv0] = L.def.dir;
      // Dirección de la hoja y su normal (hacia el ambiente cuando está cerrada).
      const du = du0 * c + su * s;
      const dv = dv0 * c + sv * s;
      const nu = -du0 * s + su * c;
      const nv = -dv0 * s + sv * c;
      const yaw = Math.atan2(-dv, -du);
      for (const p of L.parts) {
        const along = L.def.width * ((p.f0 + p.f1) / 2);
        const u = L.def.hinge[0] + du * along + nu * 0.03;
        const v = L.def.hinge[1] + dv * along + nv * 0.03;
        const W = toWorld(this.frame, u, v);
        this.set.set(p.i, W.x, base + (p.y0 + p.y1) / 2, W.z, yaw, L.def.width * (p.f1 - p.f0), p.y1 - p.y0, p.thick);
      }
    }
  }

  dispose(): void {
    for (const st of this.states) setDynamicSolid(`door:${st.def.id}`, null);
    this.set.dispose();
    this.material.dispose();
  }
}
