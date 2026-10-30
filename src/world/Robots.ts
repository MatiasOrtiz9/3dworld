import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Channel, Frame } from './life/channel';
import { GeoKit, PAINT, type RGBA } from './life/geoKit';
import type { LifeMaterials } from './life/lifeMaterials';
import { LEVEL_Y, levelOf, setDynamicSolid, toLocal, toWorld, type Level, type SchoolFrame } from './SchoolLayout';
import { ROBOTS, RobotAgent, type Obstacle } from './robots/robotSim';
import type { WorldPoint } from '../game/contracts';

/**
 * Robots de la Escuela 2050 (la lógica, en `robots/robotSim`).
 *
 * Fregadoras autónomas en los pasillos y robots de atención en el hall, la
 * biblioteca y el hall del jardín. Todos en cinco draw calls: cuerpo de la
 * fregadora, cuerpo y cabeza del robot guía, las luces (cajitas sin
 * iluminación, una instancia por LED) y la sombra de contacto. Usan los
 * materiales de la vida de la calle (`LifeMaterials`): pintura con color por
 * instancia para el acento de cada robot, sin programas de shader nuevos.
 *
 * Son sólidos para el jugador (no se los atraviesa) y frenan ante quien se
 * les cruza; la gente no los esquiva (van por el centro de los pasillos y
 * se detienen ellos).
 */

const WHITE: RGBA = [0.9, 0.91, 0.92, 0.32];
const SHELL: RGBA = [0.8, 0.82, 0.84, 0.4];
const DARK: RGBA = [0.1, 0.11, 0.13, 0.55];
const RUBBER: RGBA = [0.04, 0.04, 0.045, 0.92];
const GLASS: RGBA = [0.015, 0.02, 0.03, 0.08];
const STEEL: RGBA = [0.55, 0.57, 0.6, 0.3];

/** Luces: color base (sin luz, puede pasar de 1). */
const LED_IDLE: readonly [number, number, number] = [0.35, 1.1, 1.35];
const LED_WARY: readonly [number, number, number] = [1.5, 0.85, 0.15];

/** Altura del cuello del robot guía (pivote de la cabeza) sobre el piso. */
const NECK_Y = 0.98;

export class Robots {
  readonly agents: RobotAgent[];
  private readonly cleaner: Channel;
  private readonly guide: Channel;
  private readonly head: Channel;
  private readonly lamps: Channel;
  private readonly shadows: Channel;
  private readonly observer: Observer<Scene>;
  private readonly frame = new Frame();
  private readonly headFrame = new Frame();
  /** Gente que camina, en locales (se junta 5 veces por segundo). */
  private readonly crowd: Obstacle[] = [];
  private crowdN = 0;
  private crowdIn = 0;
  private solidIn = 0;
  private readonly player: Obstacle = { u: 0, v: 0, level: 0 };
  private readonly view: Obstacle[] = [];
  /** Lo que la gente esquiva (se actualiza en el lugar). */
  private readonly movers: Array<{ u: number; v: number; vu: number; vv: number; r: number; level: Level }>;

  constructor(
    private readonly scene: Scene,
    private readonly school: SchoolFrame,
    mats: LifeMaterials,
    private readonly feet: () => WorldPoint | null,
    private readonly people: {
      forEachBody(fn: (u: number, v: number, level: Level) => void): void;
      setMovers(list: ReadonlyArray<{ u: number; v: number; vu: number; vv: number; r: number; level: Level }>): void;
    } | null,
  ) {
    this.agents = ROBOTS.map((d, i) => new RobotAgent(d, i * 37 + 11));
    const nC = ROBOTS.filter((d) => d.kind === 'cleaner').length;
    const nG = ROBOTS.length - nC;
    this.cleaner = new Channel(scene, 'robot-cleaner', cleanerKit(), mats.paint, Math.max(1, nC), true);
    this.guide = new Channel(scene, 'robot-guide', guideKit(), mats.paint, Math.max(1, nG), true);
    this.head = new Channel(scene, 'robot-head', headKit(), mats.paint, Math.max(1, nG), true);
    const unit = new GeoKit();
    unit.box(0, 0, 0, 1, 1, 1, [1, 1, 1, 1]);
    this.lamps = new Channel(scene, 'robot-lamps', unit, mats.lamp, nC * 3 + nG * 11, true);
    const disc = CreateGround('robot-shadows', { width: 1, height: 1 }, scene);
    this.shadows = new Channel(scene, 'robot-shadows', disc, mats.shadow, ROBOTS.length, false);
    for (let i = 0; i < 200; i++) this.crowd.push({ u: 0, v: 0, level: 0 });
    this.movers = this.agents.map((a) => ({ u: a.u, v: a.v, vu: 0, vv: 0, r: a.radius, level: a.level }));
    people?.setMovers(this.movers);
    this.observer = scene.onBeforeRenderObservable.add(this.update);
    if (import.meta.env.DEV) {
      // Gancho para las herramientas (tools/school-shots.mjs: vistas con `robot`).
      (globalThis as { __robots?: () => unknown }).__robots = () =>
        this.agents.map((a) => ({ id: a.def.id, u: a.u, v: a.v, level: a.level, state: a.state }));
    }
  }

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    if (!(dt > 0)) return;
    const f = this.feet();
    let look: Obstacle | null = null;
    if (f) {
      const l = toLocal(this.school, f.x, f.z);
      this.player.u = l.u;
      this.player.v = l.v;
      this.player.level = levelOf(f.y + 0.05);
      look = this.player;
    }
    // La gente que camina, 5 veces por segundo (con el jugador al final).
    if ((this.crowdIn -= dt) <= 0) {
      this.crowdIn = 0.2;
      this.crowdN = 0;
      this.people?.forEachBody((u, v, level) => {
        if (this.crowdN >= this.crowd.length) return;
        const o = this.crowd[this.crowdN++];
        o.u = u;
        o.v = v;
        o.level = level;
      });
    }
    const view = this.view;
    view.length = 0;
    for (let i = 0; i < this.crowdN; i++) view.push(this.crowd[i]);
    if (look) view.push(look);

    const solids = (this.solidIn -= dt) <= 0;
    if (solids) this.solidIn = 0.1;
    this.cleaner.begin();
    this.guide.begin();
    this.head.begin();
    this.lamps.begin();
    this.shadows.begin();
    for (let k = 0; k < this.agents.length; k++) {
      const a = this.agents[k];
      a.step(dt, view, look);
      const m = this.movers[k];
      m.u = a.u;
      m.v = a.v;
      m.vu = Math.cos(a.h) * a.speed;
      m.vv = Math.sin(a.h) * a.speed;
      this.draw(a);
      if (solids) {
        const r = a.radius;
        setDynamicSolid(`robot:${a.def.id}`, { u0: a.u - r, v0: a.v - r, u1: a.u + r, v1: a.v + r, level: a.level }, { playerOnly: true });
      }
    }
    this.cleaner.flush();
    this.guide.flush();
    this.head.flush();
    this.lamps.flush();
    this.shadows.flush();
  };

  private draw(a: RobotAgent): void {
    const w = toWorld(this.school, a.u, a.v);
    const y0 = LEVEL_Y[a.level];
    // Rumbo local (cos h, sin h) → yaw de Babylon (u es −x en el mundo).
    const yaw = Math.atan2(-Math.cos(a.h), Math.sin(a.h));
    const [cr, cg, cb] = a.def.color;
    const led = a.wary ? LED_WARY : LED_IDLE;
    const moving = a.speed > 0.02 || Math.abs(a.turn) > 0.05;
    const fr = this.frame;

    const si = this.shadows.next();
    if (si >= 0) {
      const s = a.def.kind === 'cleaner' ? 0.85 : 0.8;
      this.frame.set(w.x, y0 + 0.006, w.z, yaw).write(this.shadows.matrices, si, 0, 0, 0, s, 1, s * 1.1);
    }

    if (a.def.kind === 'cleaner') {
      // Zumbido de la máquina: vibra apenas al andar; cabecea al frenar.
      const buzz = moving ? Math.sin(a.time * 61) * 0.0012 : 0;
      fr.set(w.x, y0 + buzz, w.z, yaw, clamp(-a.accel * 0.02, -0.02, 0.02));
      const i = this.cleaner.next();
      if (i >= 0) {
        fr.write(this.cleaner.matrices, i, 0, 0, 0, 1, 1, 1);
        this.cleaner.color(i, cr, cg, cb);
      }
      // Tira de LED al frente (late al andar) y luz de estado arriba.
      const pulse = moving ? 0.75 + 0.25 * Math.sin(a.odo * 9) : 1;
      this.lamp(fr, 0, 0.17, 0.315, 0.36, 0.022, 0.012, led[0] * pulse, led[1] * pulse, led[2] * pulse);
      const blink = a.wary ? (Math.sin(a.time * 9) > 0 ? 1 : 0.15) : 1;
      this.lamp(fr, 0, 0.462, -0.16, 0.05, 0.012, 0.05, led[0] * blink, led[1] * blink, led[2] * blink);
      this.lamp(fr, 0, 0.462, -0.08, 0.05, 0.012, 0.05, cr * 1.4, cg * 1.4, cb * 1.4);
      return;
    }

    // Robot guía: se mece apenas al andar y se inclina con la aceleración.
    const bob = moving ? Math.sin(a.odo * 6.5) * 0.006 : Math.sin(a.time * 1.3) * 0.002;
    fr.set(w.x, y0 + bob, w.z, yaw, clamp(-a.accel * 0.05, -0.04, 0.04));
    const i = this.guide.next();
    if (i >= 0) {
      fr.write(this.guide.matrices, i, 0, 0, 0, 1, 1, 1);
      this.guide.color(i, cr, cg, cb);
    }
    // Anillo de LED en la base: ocho segmentos que giran despacio.
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const lit = 0.55 + 0.45 * Math.max(0, Math.cos(ang - a.time * (moving ? 3 : 1.2)));
      this.lamp(fr, Math.sin(ang) * 0.305, 0.2, Math.cos(ang) * 0.305, 0.07, 0.02, 0.07, led[0] * lit, led[1] * lit, led[2] * lit);
    }
    // Cabeza: gira sobre el cuello hacia el jugador; asiente apenas al frenar.
    const hh = a.h + a.head;
    const hyaw = Math.atan2(-Math.cos(hh), Math.sin(hh));
    const hp = fr.py(0, NECK_Y, 0);
    const hf = this.headFrame.set(fr.px(0, NECK_Y, 0), hp, fr.pz(0, NECK_Y, 0), hyaw, clamp(-a.accel * 0.04, -0.05, 0.05) + Math.sin(a.time * 0.7) * 0.02);
    const j = this.head.next();
    if (j >= 0) {
      hf.write(this.head.matrices, j, 0, 0, 0, 1, 1, 1);
      this.head.color(j, cr, cg, cb);
    }
    // Ojos en la pantalla de la cara (parpadean) y la boca.
    const eye = Math.max(0.08, a.eyes);
    for (const x of [-0.065, 0.065]) this.lamp(hf, x, 0.145, 0.141, 0.045, 0.06 * eye, 0.006, led[0], led[1], led[2]);
    this.lamp(hf, 0, 0.085, 0.141, a.wary ? 0.05 : 0.08, 0.012, 0.006, led[0] * 0.8, led[1] * 0.8, led[2] * 0.8);
  }

  private lamp(fr: Frame, x: number, y: number, z: number, sx: number, sy: number, sz: number, r: number, g: number, b: number): void {
    const i = this.lamps.next();
    if (i < 0) return;
    fr.write(this.lamps.matrices, i, x, y, z, sx, sy, sz);
    this.lamps.color(i, r, g, b);
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    delete (globalThis as { __robots?: unknown }).__robots;
    this.people?.setMovers([]);
    for (const a of this.agents) setDynamicSolid(`robot:${a.def.id}`, null);
    this.cleaner.dispose();
    this.guide.dispose();
    this.head.dispose();
    this.lamps.dispose();
    this.shadows.dispose();
  }
}

// ==================================================================== formas
// Frente hacia +z, piso en y = 0.

/** Prisma vertical de `n` lados entre y0 e y1, de radio r0 abajo y r1 arriba. */
function column(k: GeoKit, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, n: number, color: RGBA, cap = true): void {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    k.face(
      [
        [cx + Math.sin(a0) * r0, y0, cz + Math.cos(a0) * r0],
        [cx + Math.sin(a1) * r0, y0, cz + Math.cos(a1) * r0],
        [cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1],
        [cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1],
      ],
      color,
      [Math.sin(am), (r0 - r1) / Math.max(0.01, y1 - y0), Math.cos(am)],
    );
  }
  if (!cap) return;
  const top: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    top.push([cx + Math.sin(a) * r1, y1, cz + Math.cos(a) * r1]);
  }
  k.face(top, color, [0, 1, 0]);
}

/** Fregadora de pasillo: carcasa blanca, tapa del color del robot, paragolpes y sensor al frente. */
function cleanerKit(): GeoKit {
  const k = new GeoKit();
  // Paragolpes de goma alrededor de la base.
  k.box(0, 0.075, 0.0, 0.52, 0.09, 0.64, RUBBER, '-y');
  // Carcasa con los cantos achaflanados (dos cajas cruzadas).
  k.box(0, 0.27, 0.0, 0.5, 0.3, 0.56, SHELL, '-y');
  k.box(0, 0.27, 0.0, 0.46, 0.3, 0.6, SHELL, '-y');
  // Tapa: el color del robot.
  k.box(0, 0.44, -0.02, 0.44, 0.04, 0.5, PAINT, '-y');
  // Ventana del sensor y cámara (vidrio oscuro) al frente.
  k.box(0, 0.3, 0.3, 0.3, 0.08, 0.012, GLASS);
  k.box(0, 0.3, 0.3, 0.06, 0.06, 0.02, DARK);
  // Secador (rasqueta) atrás y depósito.
  k.box(0, 0.05, -0.33, 0.56, 0.05, 0.05, RUBBER);
  k.box(0, 0.47, -0.2, 0.22, 0.02, 0.12, DARK);
  // Ruedas, apenas asomando bajo el paragolpes.
  for (const x of [-0.2, 0.2]) k.box(x, 0.05, 0.12, 0.05, 0.1, 0.1, RUBBER, '+y');
  return k;
}

/** Robot guía (sin la cabeza): base rodante, torso blanco, banda del color del robot, pecho con pantalla y brazos cortos. */
function guideKit(): GeoKit {
  const k = new GeoKit();
  column(k, 0, 0, 0.015, 0.19, 0.3, 0.29, 20, DARK);
  column(k, 0, 0, 0.21, 0.24, 0.29, 0.27, 20, STEEL);
  // Torso: se angosta hacia los hombros.
  column(k, 0, 0, 0.24, 0.62, 0.26, 0.225, 20, WHITE, false);
  column(k, 0, 0, 0.62, 0.68, 0.225, 0.22, 20, PAINT, false);
  column(k, 0, 0, 0.68, 0.9, 0.22, 0.17, 20, WHITE);
  // Pecho: pantalla oscura con marco.
  k.box(0, 0.5, 0.235, 0.24, 0.17, 0.03, DARK);
  k.box(0, 0.5, 0.25, 0.2, 0.13, 0.012, GLASS);
  // Brazos cortos, con mano del color del robot.
  for (const x of [-0.25, 0.25]) {
    k.box(x, 0.72, 0.0, 0.06, 0.16, 0.08, WHITE);
    k.box(x * 1.03, 0.6, 0.02, 0.05, 0.1, 0.07, PAINT);
  }
  // Cuello.
  column(k, 0, 0, 0.9, NECK_Y + 0.01, 0.06, 0.055, 10, STEEL, false);
  return k;
}

/** Cabeza del robot guía, con el pivote en el cuello (y = 0): casco blanco, cara de pantalla, orejas del color del robot. */
function headKit(): GeoKit {
  const k = new GeoKit();
  k.box(0, 0.12, 0, 0.34, 0.22, 0.26, WHITE);
  k.box(0, 0.12, 0, 0.3, 0.26, 0.24, WHITE);
  k.box(0, 0.12, 0, 0.3, 0.2, 0.28, WHITE);
  // Cara: pantalla negra brillante.
  k.box(0, 0.12, 0.137, 0.26, 0.16, 0.008, GLASS);
  // Orejas (micrófonos) y antena.
  for (const x of [-0.18, 0.18]) k.box(x, 0.13, 0, 0.03, 0.09, 0.09, PAINT);
  k.box(0, 0.27, -0.03, 0.012, 0.06, 0.012, STEEL);
  k.box(0, 0.305, -0.03, 0.03, 0.03, 0.03, PAINT);
  return k;
}

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
