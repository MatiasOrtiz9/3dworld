/**
 * Pájaros del barrio, sin motor (se prueban en `tests/lifeBirds.test.ts`):
 *
 *  - Bandadas que cruzan el cielo de punta a punta (palomas, cotorras,
 *    estorninos), en formación suelta, por encima de los techos y lejos de
 *    la torre. Al salir del barrio esperan un rato y vuelve otra por otro
 *    lado.
 *  - Algunos chimangos planeando en círculos, altos.
 *  - Cotorras que pasan bajo, a la altura de las copas, a lo largo de la
 *    calle donde está el jugador: bajan de los techos, cruzan por encima de
 *    su cabeza gritando y vuelven a subir. Las bandadas del cielo quedan
 *    lejos; éstas son las que se ven y se oyen de verdad con el visor.
 *  - Palomas en las veredas (una bandadita frente a la escuela): caminan,
 *    picotean y, si el jugador se acerca, levantan vuelo todas juntas, dan
 *    vueltas sobre la calle y vuelven a bajar cuando se fue.
 */
import type { CityPlan } from '../CityLayout';
import { Rng } from '../../utils/rng';

/** Tono de plumaje (lo resuelve la vista). */
export type Plumage = 'pigeon' | 'parrot' | 'starling' | 'raptor';

export interface BirdPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** Ángulo de las alas (rad, + arriba). */
  flap: number;
  /** Con alas desplegadas (en vuelo). */
  wings: boolean;
  scale: number;
  plumage: Plumage;
  /** Variación de tono (0–1). */
  tint: number;
  visible: boolean;
}

export interface PigeonSpot {
  x: number;
  z: number;
  /** Eje de la vereda (unitario) y medio largo / medio ancho del lugar. */
  ax: number;
  az: number;
  along: number;
  across: number;
  /** Hacia la calle (unitario): por ahí levantan vuelo. */
  sx: number;
  sz: number;
}

interface Flock {
  plumage: Plumage;
  members: number[];
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  length: number;
  h: number;
  speed: number;
  t: number;
  wait: number;
  /** Pasada baja por la calle del jugador (cotorras), en vez de cruzar el cielo. */
  low?: boolean;
  /** Ya avisó que se acerca (para el sonido). */
  called?: boolean;
}

interface Member {
  lat: number;
  back: number;
  up: number;
  phase: number;
  freq: number;
}

interface Circler {
  cx: number;
  cz: number;
  r: number;
  h: number;
  a: number;
  w: number;
  phase: number;
}

type PigeonState = 'ground' | 'fly' | 'land';

interface Pigeon {
  spot: number;
  state: PigeonState;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  gy: number;
  tx: number;
  tz: number;
  ty: number;
  timer: number;
  peck: number;
  /** Ángulo sobre la vuelta mientras vuela. */
  loop: number;
  loopDir: number;
  flapPhase: number;
  delay: number;
  airTime: number;
}

export interface BirdViewer {
  x: number;
  y: number;
  z: number;
}

const TOWER_CLEAR = 34;

export class BirdSim {
  readonly poses: BirdPose[] = [];
  private readonly flocks: Flock[] = [];
  private readonly members: Member[] = [];
  private readonly circlers: Circler[] = [];
  private readonly circlerBase: number;
  private readonly pigeons: Pigeon[] = [];
  private readonly pigeonBase: number;
  private readonly rng: Rng;
  private readonly radius: number;
  private readonly tower: { x: number; z: number; h: number } | null;
  private time = 0;
  /** Palomas espantadas por lugar (para el sonido del aleteo). */
  private onFlush?: (x: number, z: number) => void;
  /** Las cotorras de la pasada baja se acercan (para el sonido de los gritos). */
  private onParrots?: (x: number, z: number) => void;
  /** Calles sin cortes (por donde pasan bajo las cotorras): eje, coordenada y tramo. */
  private readonly lanes: Array<{ axis: 'x' | 'z'; at: number; a0: number; a1: number }>;
  /** Última posición conocida del jugador (para planear la pasada baja). */
  private readonly seen = { x: 0, z: 0 };

  constructor(
    plan: CityPlan,
    seed: number,
    readonly spots: PigeonSpot[],
    private readonly ground: (x: number, z: number) => number,
    lite: boolean,
  ) {
    this.rng = new Rng((seed ^ 0x51b0) >>> 0);
    this.radius = plan.extent + 120;
    const t = plan.blocks.find((b) => b.kind === 'tower');
    this.tower = t ? { x: t.cx, z: t.cz, h: t.height } : null;

    // Bandadas.
    const kinds: Plumage[] = lite ? ['pigeon', 'parrot'] : ['pigeon', 'parrot', 'starling'];
    for (const plumage of kinds) {
      const n =
        plumage === 'starling'
          ? this.rng.int(12, 16)
          : lite
            ? this.rng.int(7, 9)
            : this.rng.int(9, 13);
      const flock: Flock = {
        plumage,
        members: [],
        ox: 0,
        oz: 0,
        dx: 1,
        dz: 0,
        length: 1,
        h: 40,
        speed: 10,
        t: 0,
        wait: 0,
      };
      for (let i = 0; i < n; i++) {
        flock.members.push(this.poses.length);
        this.members.push({
          lat: this.rng.range(-6, 6),
          back:
            this.rng.range(0, 9) +
            Math.abs(this.rng.range(-6, 6)) * (plumage === 'pigeon' ? 0.6 : 0.2),
          up: this.rng.range(-2, 2),
          phase: this.rng.range(0, Math.PI * 2),
          freq: plumage === 'parrot' ? this.rng.range(11, 13) : this.rng.range(8, 10),
        });
        this.poses.push(
          blankPose(
            plumage,
            plumage === 'parrot' ? 1.05 : plumage === 'starling' ? 0.85 : 1.25,
            this.rng.next(),
          ),
        );
      }
      this.planFlock(flock, true);
      this.flocks.push(flock);
    }

    // Chimangos planeando alto.
    this.circlerBase = this.poses.length;
    const nc = lite ? 2 : 4;
    for (let i = 0; i < nc; i++) {
      let cx = 0;
      let cz = 0;
      for (let k = 0; k < 20; k++) {
        cx = this.rng.range(-plan.extent * 0.7, plan.extent * 0.6);
        cz = this.rng.range(-plan.extent * 0.6, plan.extent * 0.6);
        if (!this.tower || len2(cx - this.tower.x, cz - this.tower.z) > 70) break;
      }
      this.circlers.push({
        cx,
        cz,
        r: this.rng.range(18, 34),
        h: this.rng.range(48, 70),
        a: this.rng.range(0, Math.PI * 2),
        w: this.rng.range(0.16, 0.24) * (this.rng.chance(0.5) ? 1 : -1),
        phase: this.rng.range(0, 10),
      });
      this.poses.push(blankPose('raptor', 2.1, this.rng.next()));
    }

    // Palomas en las veredas.
    this.pigeonBase = this.poses.length;
    const per = lite ? 5 : 7;
    spots.forEach((sp, si) => {
      for (let i = 0; i < per; i++) {
        const p: Pigeon = {
          spot: si,
          state: 'ground',
          x: 0,
          y: 0,
          z: 0,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: this.rng.range(0, Math.PI * 2),
          gy: 0,
          tx: 0,
          tz: 0,
          ty: 0,
          timer: this.rng.range(0, 2),
          peck: 0,
          loop: 0,
          loopDir: 1,
          flapPhase: this.rng.range(0, 6),
          delay: 0,
          airTime: 0,
        };
        this.pickSpotPoint(sp, p);
        p.x = p.tx;
        p.z = p.tz;
        p.gy = p.y = this.ground(p.x, p.z);
        this.pigeons.push(p);
        this.poses.push(blankPose('pigeon', 1, this.rng.next()));
      }
    });

    // Cotorras de la pasada baja (al final: no cambia el sorteo de lo demás).
    this.lanes = plan.streets
      .filter((st) => !(st.gaps && st.gaps.length))
      .map((st) => {
        const [a0, a1] = st.span ?? [-plan.extent, plan.extent];
        return { axis: st.axis, at: st.at, a0, a1 };
      });
    if (this.lanes.length) {
      const low: Flock = {
        plumage: 'parrot',
        members: [],
        ox: 0,
        oz: 0,
        dx: 1,
        dz: 0,
        length: 1,
        h: 12,
        speed: 13,
        t: 0,
        wait: this.rng.range(5, 12),
        low: true,
      };
      const n = lite ? 4 : 6;
      for (let i = 0; i < n; i++) {
        const id = this.poses.length;
        low.members.push(id);
        // Formación apretada: tiene que pasar entre las dos filas de árboles.
        // `members` va por índice de pose (las bandadas lo leen así).
        this.members[id] = {
          lat: this.rng.range(-1.6, 1.6),
          back: this.rng.range(0, 5),
          up: this.rng.range(-0.7, 0.7),
          phase: this.rng.range(0, Math.PI * 2),
          freq: this.rng.range(12, 14),
        };
        this.poses.push(blankPose('parrot', 1.05, this.rng.next()));
      }
      this.flocks.push(low);
    }
  }

  /** Índices (en `poses`) de las cotorras de la pasada baja. */
  get lowBirds(): readonly number[] {
    return this.flocks.find((f) => f.low)?.members ?? [];
  }

  /** La pasada baja de cotorras se acerca al jugador (x, z: la cabeza de la bandada). */
  setOnParrots(cb: (x: number, z: number) => void): void {
    this.onParrots = cb;
  }

  setOnFlush(cb: (x: number, z: number) => void): void {
    this.onFlush = cb;
  }

  /** Cuántas palomas están volando (para pruebas y sonido). */
  get pigeonsFlying(): number {
    return this.pigeons.filter((p) => p.state !== 'ground').length;
  }

  get pigeonCount(): number {
    return this.pigeons.length;
  }

  /**
   * Pasada baja: a lo largo de la calle (sin cortes) más cercana al jugador,
   * por encima del eje de la calzada (entre las copas de las dos veredas),
   * de unos 90 m antes de él a 90 m después. Empieza y termina alta, por
   * encima de los techos: así aparece y desaparece donde no se nota.
   */
  private planLow(f: Flock): void {
    const vx = this.seen.x;
    const vz = this.seen.z;
    let best = this.lanes[0];
    let bestD = Infinity;
    for (const l of this.lanes) {
      const across = Math.abs((l.axis === 'x' ? vz : vx) - l.at);
      const along = l.axis === 'x' ? vx : vz;
      const out = Math.max(0, l.a0 - along, along - l.a1);
      const d = across + out;
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    const along = Math.max(best.a0, Math.min(best.a1, best.axis === 'x' ? vx : vz));
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const a = along - dir * 90;
    const lat = this.rng.range(-1.2, 1.2);
    f.ox = best.axis === 'x' ? a : best.at + lat;
    f.oz = best.axis === 'x' ? best.at + lat : a;
    f.dx = best.axis === 'x' ? dir : 0;
    f.dz = best.axis === 'x' ? 0 : dir;
    f.length = 180;
    f.h = this.rng.range(11, 14.5);
    f.speed = this.rng.range(12, 15);
    f.t = 0;
    f.wait = this.rng.range(22, 48);
    f.called = false;
  }

  /** Nueva pasada de una bandada: entra por un borde, cruza el barrio, sale por el otro. */
  private planFlock(f: Flock, initial: boolean): void {
    if (f.low) {
      this.planLow(f);
      return;
    }
    const a = this.rng.range(0, Math.PI * 2);
    const R = this.radius;
    // Cruza cerca del centro (donde está la escuela), con desvío lateral.
    const off = this.rng.range(-70, 70);
    const sx = Math.cos(a) * R - Math.sin(a) * off;
    const sz = Math.sin(a) * R + Math.cos(a) * off;
    const ex = -Math.cos(a) * R - Math.sin(a) * off * 0.4;
    const ez = -Math.sin(a) * R + Math.cos(a) * off * 0.4;
    f.ox = sx;
    f.oz = sz;
    f.length = len2(ex - sx, ez - sz);
    f.dx = (ex - sx) / f.length;
    f.dz = (ez - sz) / f.length;
    f.speed = f.plumage === 'parrot' ? this.rng.range(11, 14) : this.rng.range(9, 12);
    f.h = this.rng.range(30, 52);
    // Lejos de la torre: si la pasada la roza, va por encima.
    if (this.tower) {
      const px = this.tower.x - sx;
      const pz = this.tower.z - sz;
      const along = px * f.dx + pz * f.dz;
      const dist = Math.abs(px * f.dz - pz * f.dx);
      if (along > -20 && along < f.length + 20 && dist < TOWER_CLEAR) f.h = this.tower.h + 16;
    }
    f.t = initial ? this.rng.range(0.15, 0.7) * f.length : 0;
    f.wait = initial ? 0 : this.rng.range(4, 14);
  }

  private pickSpotPoint(sp: PigeonSpot, p: Pigeon): void {
    const a = this.rng.range(-sp.along, sp.along);
    const c = this.rng.range(-sp.across, sp.across);
    p.tx = sp.x + sp.ax * a + -sp.az * c;
    p.tz = sp.z + sp.az * a + sp.ax * c;
    p.ty = this.ground(p.tx, p.tz);
  }

  step(dt: number, viewer: BirdViewer): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.seen.x = viewer.x;
    this.seen.z = viewer.z;
    this.stepFlocks(dt);
    this.stepCirclers();
    this.stepPigeons(dt, viewer);
  }

  private stepFlocks(dt: number): void {
    const time = this.time;
    for (const f of this.flocks) {
      if (f.wait > 0) {
        f.wait -= dt;
        for (const id of f.members) this.poses[id].visible = false;
        // La pasada baja se arma al salir, donde esté el jugador en ese momento.
        if (f.low && f.wait <= 0) {
          const w = f.wait;
          this.planLow(f);
          f.wait = w;
        }
        continue;
      }
      f.t += f.speed * dt;
      if (f.t > f.length + 30) {
        this.planFlock(f, false);
        continue;
      }
      const yaw = Math.atan2(f.dx, f.dz);
      const rx = f.dz;
      const rz = -f.dx;
      for (const id of f.members) {
        const m = this.members[id];
        const p = this.poses[id];
        // Formación que respira: cada uno se corre un poco, a su ritmo.
        const wob = Math.sin(time * 0.6 + m.phase);
        const lat = m.lat + wob * 1.2;
        const back = m.back + Math.sin(time * 0.43 + m.phase * 1.7) * 1.4;
        const s = f.t - back;
        p.x = f.ox + f.dx * s + rx * lat;
        p.z = f.oz + f.dz * s + rz * lat;
        p.y = f.h + m.up + Math.sin(time * 0.8 + m.phase) * 0.9;
        if (f.low) {
          // Baja de los techos al entrar y vuelve a subir al irse (perfil
          // suave); la formación se cierra sobre la calle.
          const e = Math.min(1, Math.max(0, Math.min(s, f.length - s) / 55));
          const k = e * e * (3 - 2 * e);
          p.y = 30 + (f.h - 30) * k + m.up + Math.sin(time * 1.3 + m.phase) * 0.35;
          p.x -= rx * wob * 0.9;
          p.z -= rz * wob * 0.9;
          p.pitch = 0;
        }
        p.yaw = yaw + wob * 0.08;
        p.pitch = Math.cos(time * 0.8 + m.phase) * 0.08;
        p.roll = -wob * 0.15;
        // Aletea en rachas y planea entre medio.
        const glide = Math.sin(time * 0.5 + m.phase * 2.3) > 0.55;
        p.flap = glide && !f.low ? 0.12 : Math.sin(time * m.freq + m.phase) * 0.75;
        p.wings = true;
        p.visible = s > 0 && s < f.length;
      }
      // Gritos: a unos 45 m del jugador (unos 3 s antes de pasarle por encima).
      if (f.low && !f.called && f.t > f.length / 2 - 45) {
        f.called = true;
        this.onParrots?.(f.ox + f.dx * f.t, f.oz + f.dz * f.t);
      }
    }
  }

  private stepCirclers(): void {
    const time = this.time;
    for (let i = 0; i < this.circlers.length; i++) {
      const c = this.circlers[i];
      const p = this.poses[this.circlerBase + i];
      const a = c.a + c.w * time;
      p.x = c.cx + Math.cos(a) * c.r;
      p.z = c.cz + Math.sin(a) * c.r;
      p.y = c.h + Math.sin(time * 0.3 + c.phase) * 3;
      // Tangente de la vuelta.
      const tx = -Math.sin(a) * Math.sign(c.w);
      const tz = Math.cos(a) * Math.sign(c.w);
      p.yaw = Math.atan2(tx, tz);
      p.roll = c.w > 0 ? -0.35 : 0.35;
      p.pitch = 0;
      // Planea casi siempre; cada tanto, unos aletazos.
      const flapping = Math.sin(time * 0.37 + c.phase) > 0.85;
      p.flap = flapping ? Math.sin(time * 6 + c.phase) * 0.5 : 0.18;
      p.wings = true;
      p.visible = true;
    }
  }

  private stepPigeons(dt: number, viewer: BirdViewer): void {
    const flee = 3.4;
    // Lugares con el jugador encima: todas levantan vuelo.
    for (let si = 0; si < this.spots.length; si++) {
      const sp = this.spots[si];
      // Descarte rápido: el jugador lejos del lugar.
      const ddx = viewer.x - sp.x;
      const ddz = viewer.z - sp.z;
      if (ddx * ddx + ddz * ddz > (sp.along + flee + 2) ** 2) continue;
      let near = false;
      for (const p of this.pigeons) {
        if (p.spot !== si || p.state !== 'ground') continue;
        if (len2(p.x - viewer.x, p.z - viewer.z) < flee && viewer.y - p.gy < 3.6) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      for (const p of this.pigeons) {
        if (p.spot !== si || p.state !== 'ground') continue;
        p.state = 'fly';
        p.delay = this.rng.range(0, 0.45);
        p.airTime = 0;
        const ax = p.x - viewer.x;
        const az = p.z - viewer.z;
        const l = len2(ax, az) || 1;
        // Despegue: hacia la calle y lejos del jugador, casi vertical.
        p.vx = (ax / l) * 1.6 + sp.sx * 1.4;
        p.vz = (az / l) * 1.6 + sp.sz * 1.4;
        p.vy = 3.2;
        p.loop = Math.atan2(p.z - sp.z, p.x - sp.x);
        p.loopDir = this.rng.chance(0.5) ? 1 : -1;
      }
      this.onFlush?.(sp.x, sp.z);
    }

    for (let i = 0; i < this.pigeons.length; i++) {
      const p = this.pigeons[i];
      const pose = this.poses[this.pigeonBase + i];
      const sp = this.spots[p.spot];
      if (p.state === 'ground') this.walk(p, dt);
      else this.fly(p, sp, dt, viewer);
      pose.x = p.x;
      pose.y = p.y;
      pose.z = p.z;
      pose.yaw = p.yaw;
      pose.visible = true;
      if (p.state === 'ground') {
        // Paso de paloma: la cabeza va y viene; picoteo con la trompa abajo.
        const walking = len2(p.tx - p.x, p.tz - p.z) > 0.05 && p.timer <= 0;
        pose.pitch =
          p.peck > 0
            ? -0.55 * Math.sin((p.peck / 0.5) * Math.PI)
            : walking
              ? Math.sin(this.time * 12 + i) * 0.07
              : 0;
        pose.roll = 0;
        pose.wings = false;
        pose.flap = 0;
      } else {
        const hs = len2(p.vx, p.vz);
        pose.pitch = Math.max(-0.5, Math.min(0.6, Math.atan2(p.vy, Math.max(0.5, hs)) * 0.6));
        pose.roll =
          -p.loopDir * Math.min(0.5, hs * 0.06) * (p.state === 'fly' && p.airTime > 1.5 ? 1 : 0.3);
        pose.wings = true;
        // Aleteo rápido al subir y al aterrizar; planeo en la vuelta.
        const climbing = p.vy > 0.4 || p.state === 'land' || p.airTime < 1.5;
        p.flapPhase += dt * (climbing ? 13 : 8);
        const glide = !climbing && Math.sin(this.time * 0.9 + i) > 0.3;
        pose.flap = glide ? 0.3 : Math.sin(p.flapPhase) * 0.85;
      }
    }
  }

  private walk(p: Pigeon, dt: number): void {
    if (p.peck > 0) {
      p.peck -= dt;
      return;
    }
    if (p.timer > 0) {
      p.timer -= dt;
      return;
    }
    const dx = p.tx - p.x;
    const dz = p.tz - p.z;
    const d = len2(dx, dz);
    if (d < 0.05) {
      // Llegó: picotea una o dos veces y descansa.
      if (this.rng.chance(0.6)) p.peck = 0.5;
      p.timer = this.rng.range(0.6, 3.2);
      this.pickSpotPoint(this.spots[p.spot], p);
      return;
    }
    const step = Math.min(d, 0.32 * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    const want = Math.atan2(dx, dz);
    let da = want - p.yaw;
    da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
    p.yaw += da * Math.min(1, dt * 8);
    // A mitad de camino ya pisa la altura del destino (la vereda es pareja;
    // esto sólo evita un escalón al cambiar de baldosa a cordón).
    if (d < 0.5 * step + 0.3) p.gy = p.ty;
    p.y = p.gy;
  }

  private fly(p: Pigeon, sp: PigeonSpot, dt: number, viewer: BirdViewer): void {
    if (p.delay > 0) {
      p.delay -= dt;
      return;
    }
    p.airTime += dt;
    let tx: number;
    let ty: number;
    let tz: number;
    let maxSpeed = 6;
    // Vuelta sobre la calle: elipse a lo largo de la vereda, encima de la calzada.
    const cx = sp.x + sp.sx * 5;
    const cz = sp.z + sp.sz * 5;
    const away = len2(viewer.x - sp.x, viewer.z - sp.z) > 7;
    if (p.state === 'fly') {
      p.loop += p.loopDir * dt * 0.62;
      const a = p.loop + p.loopDir * 0.7;
      const ca = Math.cos(a) * 9;
      const sa = Math.sin(a) * 2.6;
      tx = cx + sp.ax * ca - sp.az * sa;
      tz = cz + sp.az * ca + sp.ax * sa;
      ty = p.gy + 8.5 + Math.sin(p.loop * 2) * 1.2;
      if (p.airTime > 8 && away && this.rng.next() < dt * 0.6) {
        p.state = 'land';
        this.pickSpotPoint(sp, p);
      }
    } else {
      tx = p.tx;
      tz = p.tz;
      ty = p.ty;
      const dist = Math.sqrt((tx - p.x) ** 2 + (ty - p.y) ** 2 + (tz - p.z) ** 2);
      maxSpeed = Math.max(0.6, Math.min(6, dist * 0.9));
      // Si el jugador volvió a acercarse, a dar otra vuelta.
      if (!away && len2(viewer.x - p.tx, viewer.z - p.tz) < 3.4) p.state = 'fly';
      if (dist < 0.25) {
        p.state = 'ground';
        p.x = tx;
        p.z = tz;
        p.y = p.gy = ty;
        p.vx = p.vy = p.vz = 0;
        p.timer = this.rng.range(0.3, 1.5);
        return;
      }
    }
    // Seguimiento suave del objetivo.
    let dx = tx - p.x;
    let dy = ty - p.y;
    let dz = tz - p.z;
    const l = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2) || 1;
    dx = (dx / l) * maxSpeed;
    dy = (dy / l) * maxSpeed;
    dz = (dz / l) * maxSpeed;
    const k = Math.min(1, dt * (p.state === 'land' ? 3.5 : 2.2));
    p.vx += (dx - p.vx) * k;
    p.vy += (dy - p.vy) * k;
    p.vz += (dz - p.vz) * k;
    p.x += p.vx * dt;
    p.y = Math.max(p.gy, p.y + p.vy * dt);
    p.z += p.vz * dt;
    const hs = len2(p.vx, p.vz);
    if (hs > 0.2) {
      const want = Math.atan2(p.vx, p.vz);
      let da = want - p.yaw;
      da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
      p.yaw += da * Math.min(1, dt * 6);
    }
  }
}

function blankPose(plumage: Plumage, scale: number, tint: number): BirdPose {
  return {
    x: 0,
    y: -100,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    flap: 0,
    wings: false,
    scale,
    plumage,
    tint,
    visible: false,
  };
}

/**
 * Lugares de palomas: veredas del barrio (la de enfrente de la escuela, la
 * del frente lejos del portón, la de atrás sobre Lafinur, las de las
 * manzanas vecinas). En coordenadas del mundo, calculadas desde el plano.
 */
export function pigeonSpots(plan: CityPlan, lite: boolean): PigeonSpot[] {
  const pitch = plan.blockSize + plan.streetWidth;
  const sideOff = plan.streetWidth / 2 - 1.9;
  const lafinur = -pitch / 2;
  const laprida = pitch / 2;
  // [eje de la calle, coordenada de la calle, posición a lo largo, lado (+1 / −1)]
  const list: Array<['x' | 'z', number, number, 1 | -1]> = [
    // Frente de la escuela sobre Laprida, lejos del portón (la gente espera ahí).
    ['x', laprida, -25, -1],
    // Vereda de enfrente de la escuela.
    ['x', laprida, -52, 1],
    // Atrás de la escuela, sobre Lafinur.
    ['x', lafinur, -10, 1],
    // Vereda del cívico, calle oeste.
    ['z', pitch / 2, 8, 1],
    // Vereda del mercado sobre Lafinur.
    ['x', lafinur, -60, -1],
    // Gral. Acha, del lado del gimnasio.
    ['z', -1.5 * pitch, -6, 1],
  ];
  const spots = list.slice(0, lite ? 4 : list.length).map(([axis, at, along, side]) => {
    const isX = axis === 'x';
    // `side`: +1 la vereda del lado +z (calle x) o +x (calle z).
    const off = side * (sideOff + 0.0);
    const x = isX ? along : at + off;
    const z = isX ? at + off : along;
    return {
      x,
      z,
      ax: isX ? 1 : 0,
      az: isX ? 0 : 1,
      along: 2.6,
      across: 0.55,
      // Hacia la calle.
      sx: isX ? 0 : -side,
      sz: isX ? -side : 0,
    };
  });
  return spots;
}

/** Largo de (a, b): Math.hypot es varias veces más lento y esto corre cada cuadro. */
function len2(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}
