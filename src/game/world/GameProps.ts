import type { Scene } from '@babylonjs/core/scene';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { GYM_MID, LEVEL_Y, schoolSolidLocal, setDynamicSolid, toWorld, type SchoolFrame } from '../../world/SchoolLayout';
import { STANDARD_SUN_COMP } from '../../world/Materials';
import type { Resolved } from '../story/anchors';
import type { LockDef } from '../story/types';
import { ROBOT_LEVELS } from '../activities/RobotRoute';
import { FLIGHT, ZONES, type ShotState } from '../activities/Penalty';
import { ThinSet } from './ThinSet';

/**
 * Objetos propios del juego, con UN material y cuatro mallas unitarias en
 * thin instances (≈4 draw calls para todo): las hojas de las puertas que la
 * historia mantiene cerradas, las cintas de las escaleras, la campana de
 * bronce del recreo, el robot Educabot y su pista, la pelota de handball,
 * los cestos del punto limpio y el llavero que imprime la impresora 3D.
 *
 * La escuela (`SchoolBuilder`) dibuja sus puertas abiertas; las de acá son
 * las que se ven cerradas mientras la historia no las abre, y al abrirse
 * giran y desaparecen.
 */

const hex = (h: string) => Color3.FromHexString(h);

const COLORS = {
  leaf: hex('#d9d2c3'),
  glass: hex('#6f93a3'),
  jardinGlass: hex('#7fa7c4'),
  kick: hex('#b8353c'),
  post: hex('#2b2f36'),
  bandRed: hex('#d0262d'),
  bandWhite: hex('#f4f4f0'),
  bronze: hex('#b4823c'),
  bracket: hex('#26282c'),
  mat: hex('#f1eee6'),
  matLine: hex('#5b6470'),
  start: hex('#7fb2e8'),
  goal: hex('#f2c14e'),
  cup: hex('#d0453c'),
  robot: hex('#2f6db5'),
  robotTop: hex('#f2f2ee'),
  wheel: hex('#1b1b1f'),
  ball: hex('#e0582a'),
  binGreen: hex('#3fbf6f'),
  binBrown: hex('#b07a40'),
  binBlack: hex('#50555e'),
  lid: hex('#2c3036'),
  keychain: hex('#f2c14e'),
  head: hex('#9aa3ad'),
};

interface Part {
  set: ThinSet;
  i: number;
}

interface LeafVis {
  parts: Array<Part & { y0: number; y1: number; thick: number }>;
  hinge: [number, number];
  /** Dirección del vano desde la bisagra (unitaria, en el plano). */
  dir: [number, number];
  width: number;
  /** Lado hacia el que abre (normal del muro × signo). */
  swing: [number, number];
}

interface LockVis {
  lock: LockDef;
  leaves: LeafVis[];
  posts: Part[];
  band: Part[];
  /** 0 = cerrada, 1 = abierta del todo (oculta). */
  open: number;
  target: number;
}

/** Tiempo de apertura de una puerta, en segundos. */
const OPEN_TIME = 0.9;

export class GameProps {
  private readonly material: StandardMaterial;
  private readonly box: ThinSet;
  private readonly cyl: ThinSet;
  private readonly cone: ThinSet;
  private readonly ball: ThinSet;
  private readonly locks = new Map<string, LockVis>();
  private readonly frame: SchoolFrame;

  // campana
  private bellParts: { bracket: number; body: number; clapper: number } | null = null;
  private bellPivot = { x: 0, y: 0, z: 0 };
  private bellSwing = 0;
  private bellTime = 0;

  // robot
  private readonly mat: Resolved;
  private matY = 0;
  private readonly cell = 0.168;
  private robotParts: number[] = [];
  private cupParts: number[] = [];
  private goalParts: number[] = [];
  private startPart = -1;
  private robotLevelIndex = -1;

  // pelota
  private ballIndex = -1;
  private ballPos = { u: 0, v: 0, y: 0.12 };
  private ballVel = { u: 0, v: 0 };
  private ballRest: { u: number; v: number };
  private shot: ShotState | null = null;

  // llavero
  private printer: Resolved;
  private printParts: { piece: number; head: number } | null = null;
  private printT = -1;
  private printDone: (() => void) | null = null;

  constructor(
    scene: Scene,
    frame: SchoolFrame,
    anchors: { bell: Resolved & { y: number }; mat: Resolved; ball: Resolved; printer: Resolved; bins: Resolved },
  ) {
    this.frame = frame;
    this.material = new StandardMaterial('game-props', scene);
    // Mismo criterio que la multitud: blanco atenuado (el sol es fuerte) y un
    // piso de luz propia para que en interiores no quede negro sin IBL.
    this.material.diffuseColor = new Color3(STANDARD_SUN_COMP, STANDARD_SUN_COMP, STANDARD_SUN_COMP).scale(1.1);
    this.material.specularColor = new Color3(0.08, 0.08, 0.08);
    this.material.emissiveColor = new Color3(0.34, 0.34, 0.35);

    const mk = (mesh: ReturnType<typeof CreateBox>, cap: number) => {
      mesh.material = this.material;
      return new ThinSet(mesh, cap);
    };
    this.box = mk(CreateBox('game-box', { size: 1 }, scene), 96);
    this.cyl = mk(CreateCylinder('game-cyl', { diameter: 1, height: 1, tessellation: 12 }, scene), 24);
    this.cone = mk(CreateCylinder('game-cone', { diameterTop: 0.45, diameterBottom: 1, height: 1, tessellation: 16 }, scene), 12);
    this.ball = mk(CreateIcoSphere('game-ball', { radius: 0.5, subdivisions: 2 }, scene), 8);

    this.mat = anchors.mat;
    this.printer = anchors.printer;
    this.ballRest = { u: anchors.ball.u, v: anchors.ball.v };
    this.buildBell(anchors.bell);
    this.buildMat();
    this.buildBins(anchors.bins);
    this.buildBall();
    this.flush();
  }

  // ========================================================= utilidades de pose

  private w(u: number, v: number): { x: number; z: number } {
    return toWorld(this.frame, u, v);
  }

  /** Giro en mundo para que el +X local de una caja apunte en la dirección (du, dv) del plano. */
  private yawAlong(du: number, dv: number): number {
    return Math.atan2(-dv, -du);
  }

  // ===================================================================== puertas

  /** Cierra o abre (con animación) el vano de una cerradura. */
  setLock(lock: LockDef, locked: boolean, animate: boolean): void {
    let vis = this.locks.get(lock.id);
    if (!vis) {
      if (!locked) return;
      vis = this.buildLock(lock);
      this.locks.set(lock.id, vis);
    }
    vis.target = locked ? 0 : 1;
    if (!animate || locked) vis.open = vis.target;
    this.poseLock(vis);
  }

  private buildLock(lock: LockDef): LockVis {
    const vis: LockVis = { lock, leaves: [], posts: [], band: [], open: 0, target: 0 };
    const [au, av] = lock.a;
    const [bu, bv] = lock.b;
    const len = Math.hypot(bu - au, bv - av);
    const du = (bu - au) / len;
    const dv = (bv - av) / len;
    // Normal del muro: hacia donde abren las hojas (da igual el lado: al
    // terminar de abrir, desaparecen).
    const n: [number, number] = [-dv, du];
    if (lock.visual === 'barrier') {
      for (let k = 0; k < 2; k++) vis.posts.push({ set: this.cyl, i: this.cyl.add(COLORS.post) });
      for (let k = 0; k < 5; k++) vis.band.push({ set: this.box, i: this.box.add(k % 2 ? COLORS.bandWhite : COLORS.bandRed) });
      return vis;
    }
    const glass = lock.id.includes('jardinCalle') ? COLORS.jardinGlass : lock.h > 2.5 ? COLORS.glass : COLORS.leaf;
    const mkLeaf = (hinge: [number, number], dir: [number, number], width: number): LeafVis => {
      const parts: LeafVis['parts'] = [{ set: this.box, i: this.box.add(glass), y0: 0.03, y1: lock.h - 0.05, thick: 0.045 }];
      if (glass !== COLORS.leaf) {
        // Hojas vidriadas: travesaños rojos abajo y arriba, como las del portal.
        parts.push({ set: this.box, i: this.box.add(COLORS.kick), y0: 0.03, y1: 0.13, thick: 0.06 });
        parts.push({ set: this.box, i: this.box.add(COLORS.kick), y0: lock.h - 0.17, y1: lock.h - 0.07, thick: 0.06 });
      }
      return { parts, hinge, dir, width, swing: n };
    };
    if (lock.visual === 'door') {
      vis.leaves.push(mkLeaf([au + du * 0.06, av + dv * 0.06], [du, dv], len - 0.12));
    } else {
      const half = (len - 0.12) / 2;
      vis.leaves.push(mkLeaf([au + du * 0.06, av + dv * 0.06], [du, dv], half));
      vis.leaves.push(mkLeaf([bu - du * 0.06, bv - dv * 0.06], [-du, -dv], half));
    }
    return vis;
  }

  private poseLock(vis: LockVis): void {
    const base = LEVEL_Y[vis.lock.rect.level];
    const t = vis.open;
    if (vis.lock.visual === 'barrier') {
      const [au, av] = vis.lock.a;
      const [bu, bv] = vis.lock.b;
      // Al abrir, la cinta cae y los postes se hunden en el piso.
      const k = Math.max(0, 1 - t * 1.4);
      vis.posts.forEach((p, idx) => {
        if (t >= 1) return p.set.hide(p.i);
        const [u, v] = idx === 0 ? [au, av] : [bu, bv];
        const W = this.w(u, v);
        const h = 1.0 * Math.max(0.02, 1 - t);
        p.set.set(p.i, W.x, base + h / 2, W.z, 0, 0.07, h, 0.07);
      });
      const n = vis.band.length;
      vis.band.forEach((p, k2) => {
        if (k <= 0) return p.set.hide(p.i);
        const f0 = k2 / n;
        const f1 = (k2 + 1) / n;
        const u = au + (bu - au) * ((f0 + f1) / 2);
        const v = av + (bv - av) * ((f0 + f1) / 2);
        const W = this.w(u, v);
        const seg = Math.hypot(bu - au, bv - av) / n;
        p.set.set(p.i, W.x, base + 0.9 - (1 - k) * 0.7, W.z, this.yawAlong(bu - au, bv - av), seg, 0.07 * k, 0.025);
      });
      return;
    }
    for (const L of vis.leaves) {
      if (t >= 1) {
        for (const p of L.parts) p.set.hide(p.i);
        continue;
      }
      // Gira sobre la bisagra hasta 85°.
      const ang = t * 1.48;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const du = L.dir[0] * c + L.swing[0] * s;
      const dv = L.dir[1] * c + L.swing[1] * s;
      const cu = L.hinge[0] + (du * L.width) / 2;
      const cv = L.hinge[1] + (dv * L.width) / 2;
      const W = this.w(cu, cv);
      const yaw = this.yawAlong(du, dv);
      for (const p of L.parts) {
        p.set.set(p.i, W.x, base + (p.y0 + p.y1) / 2, W.z, yaw, L.width, p.y1 - p.y0, p.thick);
      }
    }
  }

  /** Posición en mundo del centro de una cerradura (para el sonido de la puerta). */
  lockCenter(lock: LockDef): { x: number; y: number; z: number } {
    const W = this.w((lock.a[0] + lock.b[0]) / 2, (lock.a[1] + lock.b[1]) / 2);
    return { x: W.x, y: LEVEL_Y[lock.rect.level] + 1.2, z: W.z };
  }

  // ===================================================================== campana

  private buildBell(at: Resolved & { y: number }): void {
    const W = this.w(at.u, at.v);
    this.bellPivot = { x: W.x, y: LEVEL_Y[at.level] + at.y + 0.16, z: W.z };
    this.bellParts = {
      bracket: this.box.add(COLORS.bracket),
      body: this.cone.add(COLORS.bronze),
      clapper: this.ball.add(COLORS.bronze.scale(0.8)),
    };
    // Ménsula: del pilar (al este) hasta el pivote.
    const B = this.w(at.u + 0.12, at.v);
    this.box.set(this.bellParts.bracket, B.x, this.bellPivot.y + 0.03, B.z, this.yawAlong(1, 0), 0.3, 0.05, 0.05);
    this.poseBell();
  }

  private poseBell(): void {
    const b = this.bellParts;
    if (!b) return;
    const a = this.bellSwing;
    // Cuelga del pivote y oscila en el plano este-oeste (eje z del mundo).
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const P = this.bellPivot;
    this.cone.set(b.body, P.x + dx * 0.12, P.y + dy * 0.12, P.z, 0, 0.26, 0.22, 0.26, 0, a);
    const lag = a * 0.6;
    this.ball.set(b.clapper, P.x + Math.sin(lag) * 0.23, P.y - Math.cos(lag) * 0.23, P.z, 0, 0.055, 0.055, 0.055);
  }

  /** Campana del recreo: hamaca unos segundos. */
  ringBell(): void {
    this.bellTime = 3.2;
  }

  bellPosition(): { x: number; y: number; z: number } {
    return { ...this.bellPivot };
  }

  // ======================================================================= robot

  private buildMat(): void {
    const m = this.mat;
    this.matY = LEVEL_Y[m.level] + 0.795;
    const W = this.w(m.u, m.v);
    const size = this.cell * 5;
    this.box.set(this.box.add(COLORS.mat), W.x, this.matY + 0.012, W.z, 0, size, 0.006, size);
    for (let k = 0; k <= 5; k++) {
      const off = -size / 2 + k * this.cell;
      const A = this.w(m.u + off, m.v);
      this.box.set(this.box.add(COLORS.matLine), A.x, this.matY + 0.0165, A.z, 0, 0.004, 0.002, size);
      const B = this.w(m.u, m.v + off);
      this.box.set(this.box.add(COLORS.matLine), B.x, this.matY + 0.0165, B.z, 0, size, 0.002, 0.004);
    }
    this.startPart = this.box.add(COLORS.start);
    for (let k = 0; k < 6; k++) this.cupParts.push(this.cone.add(COLORS.cup));
    // Meta: baldosa dorada y banderín.
    this.goalParts = [this.box.add(COLORS.goal), this.cyl.add(COLORS.post), this.box.add(COLORS.goal)];
    // Robot: cuerpo, tapa, dos ruedas, dos ojos y el mástil con la bandera del 40.
    this.robotParts = [
      this.box.add(COLORS.robot),
      this.box.add(COLORS.robotTop),
      this.cyl.add(COLORS.wheel),
      this.cyl.add(COLORS.wheel),
      this.ball.add(COLORS.robotTop),
      this.ball.add(COLORS.robotTop),
      this.cyl.add(COLORS.post),
      this.box.add(COLORS.goal),
    ];
    this.robotLevel(0);
  }

  private cellCenter(x: number, y: number): { u: number; v: number } {
    return { u: this.mat.u + (x - 2) * this.cell, v: this.mat.v + (y - 2) * this.cell };
  }

  /** Dispone la pista de un nivel (vasos, salida, meta) y pone el robot en la salida. */
  robotLevel(index: number): void {
    const L = ROBOT_LEVELS[Math.max(0, Math.min(ROBOT_LEVELS.length - 1, index))];
    this.robotLevelIndex = index;
    // Sobre la lámina de la pista (que está 1,5 cm sobre la mesa).
    const y = this.matY + 0.01;
    const s = this.cellCenter(L.start[0], L.start[1]);
    const S = this.w(s.u, s.v);
    this.box.set(this.startPart, S.x, y + 0.007, S.z, 0, this.cell * 0.86, 0.002, this.cell * 0.86);
    this.cupParts.forEach((i, k) => {
      const b = L.blocks[k];
      if (!b) return this.cone.hide(i);
      const c = this.cellCenter(b[0], b[1]);
      const C = this.w(c.u, c.v);
      // Vaso: cono truncado al revés (boca ancha arriba).
      this.cone.set(i, C.x, y + 0.045, C.z, 0, 0.07, 0.085, 0.07, Math.PI, 0);
    });
    const g = this.cellCenter(L.goal[0], L.goal[1]);
    const G = this.w(g.u, g.v);
    this.box.set(this.goalParts[0], G.x, y + 0.007, G.z, 0, this.cell * 0.86, 0.002, this.cell * 0.86);
    this.cyl.set(this.goalParts[1], G.x, y + 0.09, G.z, 0, 0.008, 0.17, 0.008);
    const F = this.w(g.u + 0.035, g.v);
    this.box.set(this.goalParts[2], F.x, y + 0.15, F.z, this.yawAlong(1, 0), 0.07, 0.045, 0.004);
    this.robotPose(L.start[0], L.start[1], L.dir);
  }

  get robotLevelShown(): number {
    return this.robotLevelIndex;
  }

  /** Robot en la casilla (x, y) continua, mirando `dir` (0 = norte, continuo). */
  robotPose(x: number, y: number, dir: number): void {
    const c = this.cellCenter(x, y);
    const a = (dir * Math.PI) / 2;
    const f: [number, number] = [Math.sin(a), -Math.cos(a)];
    const r: [number, number] = [-f[1], f[0]];
    const yaw = this.yawAlong(f[0], f[1]);
    const at = (fo: number, ro: number) => this.w(c.u + f[0] * fo + r[0] * ro, c.v + f[1] * fo + r[1] * ro);
    const base = this.matY + 0.018;
    const [body, top, wl, wr, el, er, pole, flag] = this.robotParts;
    const B = at(0, 0);
    this.box.set(body, B.x, base + 0.04, B.z, yaw, 0.13, 0.055, 0.11);
    this.box.set(top, B.x, base + 0.075, B.z, yaw, 0.1, 0.015, 0.09);
    const WL = at(-0.01, -0.062);
    const WR = at(-0.01, 0.062);
    // Ruedas: cilindros acostados, con el eje a lo ancho del robot.
    this.cyl.set(wl, WL.x, base + 0.028, WL.z, yaw, 0.056, 0.018, 0.056, Math.PI / 2, 0);
    this.cyl.set(wr, WR.x, base + 0.028, WR.z, yaw, 0.056, 0.018, 0.056, Math.PI / 2, 0);
    const EL = at(0.066, -0.025);
    const ER = at(0.066, 0.025);
    this.ball.set(el, EL.x, base + 0.05, EL.z, 0, 0.018, 0.018, 0.018);
    this.ball.set(er, ER.x, base + 0.05, ER.z, 0, 0.018, 0.018, 0.018);
    const P = at(-0.04, 0);
    this.cyl.set(pole, P.x, base + 0.13, P.z, 0, 0.006, 0.11, 0.006);
    const FL = at(-0.04 - 0.03, 0);
    this.box.set(flag, FL.x, base + 0.165, FL.z, yaw, 0.055, 0.035, 0.003);
  }

  /** Centro de la pista en el mundo (para sonidos). */
  matPosition(): { x: number; y: number; z: number } {
    const W = this.w(this.mat.u, this.mat.v);
    return { x: W.x, y: this.matY, z: W.z };
  }

  // ====================================================================== cestos

  private buildBins(at: Resolved): void {
    const y = LEVEL_Y[at.level];
    const colors = [COLORS.binGreen, COLORS.binBrown, COLORS.binBlack];
    colors.forEach((c, k) => {
      const u = at.u + (k - 1) * 0.62;
      const W = this.w(u, at.v);
      this.box.set(this.box.add(c), W.x, y + 0.37, W.z, 0, 0.48, 0.74, 0.46);
      this.box.set(this.box.add(COLORS.lid), W.x, y + 0.765, W.z, 0, 0.52, 0.05, 0.5);
    });
    // Que no se atraviesen (los respeta también la gente).
    setDynamicSolid('game-bins', { u0: at.u - 0.95, u1: at.u + 0.95, v0: at.v - 0.25, v1: at.v + 0.25, level: at.level });
  }

  // ====================================================================== pelota

  private buildBall(): void {
    this.ballIndex = this.ball.add(COLORS.ball);
    this.ballPos = { u: this.ballRest.u, v: this.ballRest.v, y: 0.1 };
    this.poseBall();
  }

  private poseBall(): void {
    const W = this.w(this.ballPos.u, this.ballPos.v);
    this.ball.set(this.ballIndex, W.x, LEVEL_Y[0] + this.ballPos.y, W.z, 0, 0.19, 0.19, 0.19);
  }

  ballPosition(): { u: number; v: number } {
    return { u: this.ballPos.u, v: this.ballPos.v };
  }

  /** Empujón casual: la pelota rueda hacia (du, dv) y rebota contra los muros. */
  kickBall(du: number, dv: number, speed = 6): void {
    const l = Math.hypot(du, dv) || 1;
    this.ballVel = { u: (du / l) * speed, v: (dv / l) * speed };
  }

  /** Lanzamiento de los penales (null: pelota al punto de siete metros, quieta). */
  setShot(shot: ShotState | null): void {
    this.shot = shot;
    this.ballVel = { u: 0, v: 0 };
    if (!shot) {
      this.ballPos = { u: PENALTY_SPOT.u, v: PENALTY_SPOT.v, y: 0.1 };
      this.poseBall();
    }
  }

  /** La pelota vuelve a su lugar de descanso. */
  resetBall(): void {
    this.shot = null;
    this.ballVel = { u: 0, v: 0 };
    this.ballPos = { u: this.ballRest.u, v: this.ballRest.v, y: 0.1 };
    this.poseBall();
  }

  private updateShot(): void {
    const s = this.shot;
    if (!s) return;
    const z = ZONES[s.zone];
    // Mirando al arco (al este), la izquierda del que lanza es el norte (−v).
    const target = { u: GOAL_MOUTH_U + (s.saved ? -0.5 : 0.45), v: GYM_MID + z.side * 1.05, y: z.high ? 1.55 : z.side === 0 ? 1.0 : 0.35 };
    const t = Math.min(1, s.t);
    const from = PENALTY_SPOT;
    if (t < 1) {
      const e = t;
      this.ballPos = {
        u: from.u + (target.u - from.u) * e,
        v: from.v + (target.v - from.v) * e,
        y: 1.1 + (target.y - 1.1) * e + Math.sin(e * Math.PI) * 0.35,
      };
    } else {
      // Después del impacto: cae y rueda un poco hacia atrás (atajada) o queda en la red.
      const k = Math.min(1, (s.t - 1) * FLIGHT * 1.6);
      this.ballPos = {
        u: target.u + (s.saved ? -1.2 * k : 0.15 * k),
        v: target.v,
        y: Math.max(0.1, target.y * (1 - k) + 0.1 * k + Math.abs(Math.sin(k * 6)) * 0.25 * (1 - k)),
      };
    }
    this.poseBall();
  }

  private updateRoll(dt: number): void {
    const v = this.ballVel;
    const sp = Math.hypot(v.u, v.v);
    if (sp < 0.05) {
      if (sp > 0) this.ballVel = { u: 0, v: 0 };
      return;
    }
    const nu = this.ballPos.u + v.u * dt;
    const nv = this.ballPos.v + v.v * dt;
    // Rebote por ejes contra lo que bloquea a una persona.
    if (schoolSolidLocal(nu, this.ballPos.v, LEVEL_Y[0])) v.u *= -0.6;
    else this.ballPos.u = nu;
    if (schoolSolidLocal(this.ballPos.u, nv, LEVEL_Y[0])) v.v *= -0.6;
    else this.ballPos.v = nv;
    const decay = Math.exp(-1.1 * dt);
    v.u *= decay;
    v.v *= decay;
    this.poseBall();
  }

  // ===================================================================== llavero

  /** Imprime el llavero del 40 (unos segundos); resuelve al terminar. */
  printKeychain(): Promise<void> {
    if (!this.printParts) this.printParts = { piece: this.box.add(COLORS.keychain), head: this.box.add(COLORS.head) };
    this.printT = 0;
    return new Promise((r) => {
      this.printDone = r;
    });
  }

  printerPosition(): { x: number; y: number; z: number } {
    const W = this.w(this.printer.u, this.printer.v);
    return { x: W.x, y: LEVEL_Y[this.printer.level] + 1.3, z: W.z };
  }

  private updatePrint(dt: number): void {
    const p = this.printParts;
    if (!p || this.printT < 0) return;
    this.printT += dt;
    const T = 4.5;
    const k = Math.min(1, this.printT / T);
    const top = LEVEL_Y[this.printer.level] + 0.76 + 0.5 + 0.06;
    const W = this.w(this.printer.u, this.printer.v);
    const h = 0.004 + k * 0.016;
    this.box.set(p.piece, W.x, top + h / 2, W.z, 0, 0.09, h, 0.05);
    if (k < 1) {
      const sweep = Math.sin(this.printT * 9) * 0.035;
      const H = this.w(this.printer.u + sweep, this.printer.v + Math.cos(this.printT * 5.3) * 0.015);
      this.box.set(p.head, H.x, top + h + 0.03, H.z, 0, 0.04, 0.04, 0.04);
    } else {
      this.box.hide(p.head);
      this.printT = -1;
      const done = this.printDone;
      this.printDone = null;
      done?.();
    }
  }

  // ===================================================================== cuadro

  update(dt: number): void {
    // Puertas que se están abriendo.
    for (const vis of this.locks.values()) {
      if (vis.open === vis.target) continue;
      vis.open = Math.min(1, vis.open + dt / OPEN_TIME);
      this.poseLock(vis);
    }
    if (this.bellTime > 0) {
      this.bellTime = Math.max(0, this.bellTime - dt);
      const k = this.bellTime / 3.2;
      this.bellSwing = Math.sin((3.2 - this.bellTime) * 9) * 0.5 * k;
      this.poseBell();
    }
    if (this.shot) this.updateShot();
    else this.updateRoll(dt);
    this.updatePrint(dt);
    this.flush();
  }

  private flush(): void {
    this.box.flush();
    this.cyl.flush();
    this.cone.flush();
    this.ball.flush();
  }

  dispose(): void {
    setDynamicSolid('game-bins', null);
    this.box.dispose();
    this.cyl.dispose();
    this.cone.dispose();
    this.ball.dispose();
    this.material.dispose();
  }
}

/** Punto de siete metros, frente al arco este del polideportivo. */
export const PENALTY_SPOT = { u: 59.45, v: GYM_MID } as const;
/** Línea de gol del arco este (el frente del arco, hacia la cancha). */
export const GOAL_MOUTH_U = 66.09;
