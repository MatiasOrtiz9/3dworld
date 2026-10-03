/**
 * Dibuja el tránsito de `TrafficSim`: una malla por forma de vehículo, una
 * para todas las ruedas, una para accesorios y postes, una para todas las
 * luces y una para las sombras de contacto. Ocho draw calls para toda la
 * calle, se vean 3 vehículos o 40.
 *
 * Cada cuadro escribe sólo lo que se ve (distancia y cono de la mirada), con
 * menos detalle lejos: sin ruedas ni piernas de ciclista, sin luces de día.
 * Las ruedas giran y las delanteras doblan; la carrocería cabecea al frenar
 * y rola en las curvas; motos y bicis se inclinan.
 */
import type { Scene } from '@babylonjs/core/scene';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { Channel, Frame, writeBasis } from './channel';
import type { LifeMaterials } from './lifeMaterials';
import { ROAD_Y, type TurnKind } from './roadNet';
import type { TrafficSim, Vehicle, VehicleKind } from './traffic';
import {
  BIKE,
  bikeShape,
  busShape,
  hatchShape,
  lampKit,
  lin,
  motoShape,
  partKit,
  sedanShape,
  vanShape,
  wheelKit,
  type Shape,
} from './vehicleShapes';

export interface ViewState {
  /** Cámara (ojos) en el mundo y mirada horizontal unitaria. */
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  /** 0 de día, 1 de noche: enciende faros y le da brillo a las luces. */
  night: number;
  time: number;
}

type RGB = [number, number, number];

const PALETTE_CAR: RGB[] = [
  ...Array(5).fill('#e8e8e4'),
  ...Array(4).fill('#a7abaf'),
  ...Array(4).fill('#5c6166'),
  ...Array(3).fill('#17181a'),
  '#8a8f94',
  '#3d4a5c',
  '#9a1c1a',
  '#a52a22',
  '#1d3457',
  '#22406e',
  '#5a1a24',
  '#7fa3c4',
  '#bfb39a',
  '#29483a',
].map((h) => lin(h));
const PALETTE_VAN: RGB[] = ['#ecece8', '#ecece8', '#ecece8', '#e9e8e2', '#b5b8bb', '#9c2a23'].map(
  (h) => lin(h),
);
/** Colectivos: cada línea tiene sus colores (faldón; la franja es crema). */
const PALETTE_BUS: RGB[] = ['#1f5aa6', '#b92a2d', '#1e7a4b', '#d18a1d'].map((h) => lin(h));
const PALETTE_MOTO: RGB[] = ['#b3241e', '#18191b', '#1f4c8f', '#d9d9d6', '#56595c', '#d4a21c'].map(
  (h) => lin(h),
);
const PALETTE_SHIRT: RGB[] = [
  '#c23b2c',
  '#2a59a8',
  '#e0c23a',
  '#ececec',
  '#2f8a4f',
  '#e07a26',
  '#7b7f86',
  '#3a3a3f',
].map((h) => lin(h));
const PALETTE_PANTS: RGB[] = ['#23324a', '#1d1e22', '#3d4652', '#5a4a3a'].map((h) => lin(h));
const DELIVERY: RGB[] = ['#e8452c', '#f08a1c', '#e3c21b', '#1b9a8a', '#d23a64'].map((h) => lin(h));
const TAXI_BODY = lin('#121314');
const TAXI_ROOF = lin('#e9b80c');
const TAXI_SIGN = lin('#f2e9c8');
/** Rojo, amarillo y verde del semáforo encendido (pasan de 1: brillan). */
const SIGNAL_COLORS: RGB[] = [
  [2.2, 0.1, 0.05],
  [2.2, 1.15, 0.06],
  [0.12, 2.0, 1.05],
];
const POLE = lin('#3c4044');
const HOUSING = lin('#141516');
const BACKPLATE = lin('#d9b11a');
const STOP_BLUE = lin('#1f4f9c');
const STOP_WHITE = lin('#eeeeea');

interface Kind {
  shape: Shape;
  channel: Channel;
}

export interface TrafficViewOptions {
  lite: boolean;
  /** Altura del piso (vereda) en un punto, para postes. */
  ground: (x: number, z: number) => number;
}

export class TrafficView {
  private readonly kinds: Record<'hatch' | 'sedan' | 'van' | 'bus' | 'moto' | 'bike', Kind>;
  private readonly wheels: Channel;
  private readonly parts: Channel;
  private readonly lamps: Channel;
  private readonly shadows: Channel;
  /** Halos de noche (faros, traseras, semáforos): mirando siempre a la cámara. */
  private readonly glows: Channel;
  private readonly f = new Frame();
  private readonly far: number;
  private readonly wheelFar: number;
  /** Luces de semáforo: [índice de instancia, esquina, eje, color 0 rojo / 1 amarillo / 2 verde / 3 mano / 4 peatón]. */
  private readonly signalLamps: Array<[number, number, 'x' | 'z', number]> = [];
  private readonly channels: Channel[];

  constructor(
    scene: Scene,
    private readonly sim: TrafficSim,
    mats: LifeMaterials,
    private readonly opts: TrafficViewOptions,
  ) {
    const count = (k: VehicleKind | VehicleKind[]) =>
      sim.vehicles.filter((v) => (Array.isArray(k) ? k.includes(v.kind) : v.kind === k)).length;
    const mk = (name: string, shape: Shape, n: number): Kind => ({
      shape,
      channel: new Channel(scene, `life-${name}`, shape.kit, mats.paint, Math.max(1, n), true),
    });
    this.kinds = {
      hatch: mk('hatch', hatchShape(), count('hatch')),
      sedan: mk('sedan', sedanShape(), count(['sedan', 'taxi'])),
      van: mk('van', vanShape(), count('van')),
      bus: mk('bus', busShape(), count('bus')),
      moto: mk('moto', motoShape(), count('moto')),
      bike: mk('bike', bikeShape(), count('bike')),
    };
    const nv = sim.vehicles.length;
    this.wheels = new Channel(scene, 'life-wheels', wheelKit(), mats.paint, nv * 4, false);
    const signalCorners = sim.net.nodes.filter((n) => n.signal).length * 4;
    this.parts = new Channel(
      scene,
      'life-parts',
      partKit(),
      mats.matte,
      signalCorners * 4 + sim.stops.length * 3 + nv * 4,
      true,
    );
    this.lamps = new Channel(
      scene,
      'life-lamps',
      lampKit(),
      mats.lamp,
      signalCorners * 5 + nv * 8,
      true,
    );
    const disc = CreateGround('life-shadows', { width: 1, height: 1 }, scene);
    this.shadows = new Channel(scene, 'life-shadows', disc, mats.shadow, nv, false);
    const quad = CreatePlane('life-glows', { size: 1 }, scene);
    this.glows = new Channel(
      scene,
      'life-glows',
      quad,
      mats.glow,
      nv * 3 + signalCorners * 2,
      true,
    );
    this.channels = [
      ...Object.values(this.kinds).map((k) => k.channel),
      this.wheels,
      this.parts,
      this.lamps,
      this.shadows,
      this.glows,
    ];
    // Las carrocerías reciben la sombra de los edificios (al cruzar la
    // sombra de una torre el auto se oscurece, como todo lo demás).
    for (const k of Object.values(this.kinds)) k.channel.mesh.receiveShadows = true;
    this.wheels.mesh.receiveShadows = true;

    this.far = opts.lite ? 150 : 210;
    this.wheelFar = opts.lite ? 55 : 90;
    this.buildStatic();
  }

  /** Semáforos y paradas: instancias fijas al principio de los buffers. */
  private buildStatic(): void {
    const { parts, lamps } = this;
    const { net } = this.sim;
    const g = this.opts.ground;
    for (const node of net.nodes) {
      if (!node.signal) continue;
      // Una columna por carril que llega, en la esquina de enfrente a su
      // derecha, mirando a quien viene (como en tantas esquinas porteñas).
      for (const p of net.paths) {
        if (p.kind !== 'lane' || p.endNode !== node.id) continue;
        const dx = p.hx;
        const dz = p.hz;
        const rx = dz;
        const rz = -dx;
        const half = p.axis === 'x' ? node.halfZ : node.halfX;
        const across = p.axis === 'x' ? node.halfX : node.halfZ;
        const cx = node.x + dx * (half + 0.8) + rx * (across + 0.8);
        const cz = node.z + dz * (half + 0.8) + rz * (across + 0.8);
        const base = g(cx, cz);
        // Mira hacia −d: su +z local es −d.
        const yaw = Math.atan2(-dx, -dz);
        this.f.set(cx, base, cz, yaw);
        const put = (
          ch: Channel,
          x: number,
          y: number,
          z: number,
          sx: number,
          sy: number,
          sz: number,
          c: RGB,
        ) => {
          const i = ch.next();
          if (i < 0) return -1;
          this.f.write(ch.matrices, i, x, y, z, sx, sy, sz);
          ch.color(i, c[0], c[1], c[2]);
          return i;
        };
        put(parts, 0, 1.8, 0, 0.11, 3.6, 0.11, POLE);
        put(parts, 0, 3.0, 0.1, 0.34, 0.98, 0.26, HOUSING);
        put(parts, 0, 3.0, -0.05, 0.52, 1.14, 0.03, BACKPLATE);
        // Semáforo peatonal más abajo, mirando al cruce de la calle que corre a lo largo de d.
        const pedYaw = Math.atan2(-rx, -rz);
        const pf = new Frame().set(cx, base, cz, pedYaw);
        const pi = parts.next();
        if (pi >= 0) {
          pf.write(parts.matrices, pi, 0, 2.35, 0.1, 0.28, 0.56, 0.22);
          parts.color(pi, HOUSING[0], HOUSING[1], HOUSING[2]);
        }
        for (let k = 0; k < 3; k++) {
          const i = put(lamps, 0, 3.3 - k * 0.3, 0.24, 0.2, 0.2, 0.04, [0, 0, 0]);
          if (i >= 0) this.signalLamps.push([i, node.id, p.axis, k]);
        }
        for (let k = 0; k < 2; k++) {
          const i = lamps.next();
          if (i < 0) continue;
          pf.write(lamps.matrices, i, 0, 2.48 - k * 0.26, 0.22, 0.18, 0.18, 0.04);
          // El peatón cruza la calle por la que viene d: camina con el eje de d en rojo.
          this.signalLamps.push([i, node.id, p.axis, 3 + k]);
        }
      }
    }
    // Paradas de colectivo: poste con la chapa azul y la franja blanca.
    for (const st of this.sim.stops) {
      // Con refugio en el plano, lo dibuja InfraBuilder.
      if (st.sheltered) continue;
      const base = g(st.x, st.z);
      this.f.set(st.x, base, st.z, Math.atan2(st.hx, st.hz));
      const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: RGB) => {
        const i = parts.next();
        if (i < 0) return;
        this.f.write(parts.matrices, i, x, y, z, sx, sy, sz);
        parts.color(i, c[0], c[1], c[2]);
      };
      put(0, 1.4, 0, 0.07, 2.8, 0.07, POLE);
      put(0, 2.55, 0, 0.04, 0.5, 0.56, STOP_BLUE);
      put(0, 2.47, 0, 0.05, 0.14, 0.5, STOP_WHITE);
    }
    parts.fixed = parts.n;
    lamps.fixed = lamps.n;
  }

  update(view: ViewState): void {
    for (const ch of this.channels) ch.begin();
    this.updateSignals(view);
    const far2 = this.far * this.far;
    for (const v of this.sim.vehicles) {
      if (!v.active) continue;
      const dx = v.x - view.x;
      const dz = v.z - view.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2) continue;
      const d = Math.sqrt(d2);
      // Detrás de la cámara (con margen por el largo del vehículo y el FOV del visor).
      if (d > v.spec.len + 6 && (dx * view.fx + dz * view.fz) / d < -0.35) continue;
      this.drawVehicle(v, d, view);
    }
    for (const ch of this.channels) ch.flush();
  }

  private updateSignals(view: ViewState): void {
    const bright = 1 + view.night * 0.8;
    const c = this.lamps.colors!;
    const blink = Math.sin(view.time * 6.5) > 0;
    for (const [i, node, axis, k] of this.signalLamps) {
      const o = i * 4;
      let r: number;
      let g: number;
      let b: number;
      if (k < 3) {
        const light = this.sim.light(node, axis);
        const on =
          (k === 0 && light === 'red') ||
          (k === 1 && light === 'amber') ||
          (k === 2 && light === 'green');
        const s = on ? bright : 0.07;
        const col = SIGNAL_COLORS[k];
        r = col[0] * s;
        g = col[1] * s;
        b = col[2] * s;
      } else {
        // Peatón: camina cuando el eje de d está en rojo y al otro le queda verde.
        const cross = axis === 'x' ? 'z' : 'x';
        const left = this.sim.greenLeft(node, cross);
        const walk = left > 4 || (left > 0 && blink);
        const hand = !walk && !(left > 0);
        if (k === 3) {
          const s = hand || (left > 0 && left <= 4 && !blink) ? bright : 0.06;
          r = 2.0 * s;
          g = 0.55 * s;
          b = 0.12 * s;
        } else {
          const s = walk ? bright : 0.06;
          r = 1.6 * s;
          g = 1.8 * s;
          b = 1.8 * s;
        }
      }
      c[o] = r;
      c[o + 1] = g;
      c[o + 2] = b;
      c[o + 3] = 1;
      // De noche, la luz encendida tiene halo.
      if (view.night > 0.2 && r + g + b > 1.5) {
        const m = this.lamps.matrices;
        this.glow(
          m[i * 16 + 12],
          m[i * 16 + 13],
          m[i * 16 + 14],
          0.9,
          r,
          g,
          b,
          view.night * 0.32,
          view,
        );
      }
    }
  }

  /**
   * Halo que mira a la cámara: un cuadrado con la mancha radial, corrido
   * hacia el ojo para que la carrocería no lo tape. Se apaga con la
   * distancia (no tiene niebla).
   */
  private glow(
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
    k: number,
    view: ViewState,
  ): void {
    let tx = view.x - x;
    let ty = view.y - y;
    let tz = view.z - z;
    const d = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    if (d > 160) return;
    const i = this.glows.next();
    if (i < 0) return;
    tx /= d;
    ty /= d;
    tz /= d;
    // Derecha = arriba × hacia la cámara; arriba' = hacia la cámara × derecha.
    let rx = tz;
    let rz = -tx;
    const rl = Math.sqrt(rx * rx + rz * rz) || 1;
    rx /= rl;
    rz /= rl;
    const ux = ty * rz;
    const uy = tz * rx - tx * rz;
    const uz = -ty * rx;
    const fade = k * Math.min(1, 1.6 - d / 100);
    const s = size * (1 + d * 0.012);
    writeBasis(
      this.glows.matrices,
      i,
      x + tx * 0.25,
      y + ty * 0.25,
      z + tz * 0.25,
      rx,
      0,
      rz,
      ux,
      uy,
      uz,
      tx,
      ty,
      tz,
      s,
      s,
      1,
    );
    this.glows.color(i, r * fade, g * fade, b * fade);
  }

  private drawVehicle(v: Vehicle, d: number, view: ViewState): void {
    const kindKey = v.kind === 'taxi' ? 'sedan' : v.kind;
    const kind = this.kinds[kindKey];
    const shape = kind.shape;
    const two = v.kind === 'moto' || v.kind === 'bike';
    // Rolido: los autos se recuestan hacia afuera de la curva; motos y bicis
    // se inclinan hacia adentro.
    const roll = two ? v.lean : Math.max(-0.035, Math.min(0.035, -v.v * v.yawRate * 0.004));
    const f = this.f.set(v.x, ROAD_Y, v.z, v.yaw, two ? 0 : v.pitch, roll);
    const ch = kind.channel;
    const i = ch.next();
    if (i < 0) return;
    f.write(ch.matrices, i, 0, 0, 0, 1, 1, 1);
    const paint = this.paintOf(v);
    ch.color(i, paint[0], paint[1], paint[2]);

    // Sombra de contacto.
    if (d < 90) {
      const si = this.shadows.next();
      if (si >= 0) {
        const c = Math.cos(v.yaw);
        const s = Math.sin(v.yaw);
        const w = v.spec.width + (two ? 0.35 : 0.55);
        const l = v.spec.len + 0.6;
        writeBasis(
          this.shadows.matrices,
          si,
          v.x,
          ROAD_Y + 0.012,
          v.z,
          c,
          0,
          -s,
          0,
          1,
          0,
          s,
          0,
          c,
          w,
          1,
          l,
        );
      }
    }

    // Ruedas: giran con la distancia recorrida; las delanteras doblan.
    if (d < this.wheelFar) {
      const wb = Math.abs(shape.wheels[0][1] - shape.wheels[shape.wheels.length - 1][1]);
      const steer = two
        ? 0
        : Math.max(-0.5, Math.min(0.5, Math.atan((wb * v.yawRate) / Math.max(1, v.v))));
      const r = shape.wheelR;
      const caR = Math.cos(v.wheel);
      const saR = Math.sin(v.wheel);
      const caL = caR;
      const saL = -saR;
      for (const [wx, wz] of shape.wheels) {
        const wi = this.wheels.next();
        if (wi < 0) break;
        const front = wz > 0 && !two;
        // Eje de la rueda en el marco del vehículo, con dirección (yaw local)
        // si es delantera. La malla tiene la llanta sólo en +x: las ruedas
        // izquierdas van giradas media vuelta (yaw + π), con el giro al revés.
        const left = wx < 0;
        const yawW = (front ? steer : 0) + (left ? Math.PI : 0);
        const cs = Math.cos(yawW);
        const ss = Math.sin(yawW);
        const ca = left ? caL : caR;
        const sa = left ? saL : saR;
        // Ejes locales de la rueda: X' = (cs, 0, −ss), Z' = (ss, 0, cs); giro sobre X'.
        const lxx = cs;
        const lxz = -ss;
        const lyx = ss * sa;
        const lyy = ca;
        const lyz = cs * sa;
        const lzx = ss * ca;
        const lzy = -sa;
        const lzz = cs * ca;
        // Pasar al mundo con el marco del vehículo (sin arreglos: se llama
        // cientos de veces por cuadro).
        writeBasis(
          this.wheels.matrices,
          wi,
          f.px(wx, r, wz),
          f.py(wx, r, wz),
          f.pz(wx, r, wz),
          f.xx * lxx + f.zx * lxz,
          f.xy * lxx + f.zy * lxz,
          f.xz * lxx + f.zz * lxz,
          f.xx * lyx + f.yx * lyy + f.zx * lyz,
          f.xy * lyx + f.yy * lyy + f.zy * lyz,
          f.xz * lyx + f.yz * lyy + f.zz * lyz,
          f.xx * lzx + f.yx * lzy + f.zx * lzz,
          f.xy * lzx + f.yy * lzy + f.zy * lzz,
          f.xz * lzx + f.yz * lzy + f.zz * lzz,
          shape.wheelW,
          r,
          r,
        );
      }
    }

    // Luces: faros (de día, apenas encendidos) y traseras (más con el freno).
    if (view.night > 0.15 || d < 80) {
      const n = view.night;
      const head = 0.75 + n * 1.9;
      // Apagada, la óptica igual es roja (plástico rojo al sol).
      const tail = (v.brake ? 1.6 : 0.55) + n * (v.brake ? 1.0 : 0.6);
      const bike = v.kind === 'bike';
      for (const L of shape.heads) {
        const li = this.lamps.next();
        if (li < 0) break;
        f.write(this.lamps.matrices, li, L.x, L.y, L.z, L.w, L.h, 0.04);
        this.lamps.color(li, head, head * 0.96, head * 0.86);
        if (n > 0.2)
          this.glow(
            f.px(L.x, L.y, L.z),
            f.py(L.x, L.y, L.z),
            f.pz(L.x, L.y, L.z),
            1.25,
            1,
            0.92,
            0.75,
            n * 0.55,
            view,
          );
      }
      // La bici titila su luz roja de noche.
      const tb = bike ? (n > 0.3 && Math.sin(view.time * 9 + v.id) > 0 ? 2.0 : 0.25) : tail;
      for (const L of shape.tails) {
        const li = this.lamps.next();
        if (li < 0) break;
        f.write(this.lamps.matrices, li, L.x, L.y, L.z, L.w, L.h, 0.04);
        this.lamps.color(li, tb, tb * 0.035, tb * 0.025);
        if (n > 0.2 && L === shape.tails[0]) {
          // Un halo por par de traseras, centrado: alcanza y cuesta la mitad.
          const cx = shape.tails.length > 1 ? 0 : L.x;
          const big = shape.tails.length > 1 ? 1.4 : 0.6;
          this.glow(
            f.px(cx, L.y, L.z),
            f.py(cx, L.y, L.z),
            f.pz(cx, L.y, L.z),
            big,
            1,
            0.08,
            0.05,
            n * (v.brake ? 0.5 : 0.28),
            view,
          );
        }
      }
      // Giro: el guiño ámbar de ese lado, adelante y atrás, desde unos 30 m
      // antes de la esquina hasta terminar de doblar. Lo que más delata a
      // un auto de juguete es que doble sin avisar.
      if (shape.heads.length > 1) {
        const side = this.blinker(v);
        if (side !== 0 && Math.sin(view.time * 9.4 + v.id * 0.7) > -0.1) {
          const k = 1.5 + n * 1.2;
          const H = shape.heads[side < 0 ? 0 : 1];
          const T = shape.tails[side < 0 ? 0 : 1];
          const hx = H.x + Math.sign(H.x) * (H.w / 2 + 0.05);
          const fi = this.lamps.next();
          if (fi >= 0) {
            f.write(this.lamps.matrices, fi, hx, H.y, H.z, 0.1, H.h * 0.9, 0.05);
            this.lamps.color(fi, 2.2 * k, 0.95 * k, 0.06 * k);
          }
          const ri = this.lamps.next();
          if (ri >= 0) {
            f.write(this.lamps.matrices, ri, T.x, T.y - T.h / 2 - 0.05, T.z, T.w * 0.8, 0.07, 0.05);
            this.lamps.color(ri, 2.2 * k, 0.95 * k, 0.06 * k);
          }
        }
      }
      if (v.kind === 'bus') {
        // Cartel de recorrido: led ámbar sobre el parabrisas.
        const li = this.lamps.next();
        if (li >= 0) {
          f.write(this.lamps.matrices, li, 0, 2.62, v.spec.len / 2 + 0.01, 1.7, 0.26, 0.04);
          const s = 1 + n * 0.6;
          this.lamps.color(li, 1.7 * s, 0.8 * s, 0.08 * s);
        }
        // De noche, el salón iluminado se ve por las ventanas: una franja de
        // luz entre el vidrio y los parantes, de cada lado.
        if (n > 0.25) {
          const hw = v.spec.width / 2 - 0.012;
          const lw = v.spec.len - 2.0;
          for (let side = -1; side <= 1; side += 2) {
            const bi = this.lamps.next();
            if (bi < 0) break;
            f.write(this.lamps.matrices, bi, side * hw, 1.86, -0.35, 0.006, 0.95, lw);
            this.lamps.color(bi, 0.62 * n, 0.66 * n, 0.55 * n);
          }
        }
      }
    }

    // Accesorios.
    if (v.kind === 'taxi') {
      // Taxi porteño: negro con el techo amarillo y el cartelito.
      this.part(0, 1.452, -0.33, 1.5, 0.02, 1.08, TAXI_ROOF);
      // El cartelito del techo es una luz: de noche se lee de lejos.
      const ti = this.lamps.next();
      if (ti >= 0) {
        f.write(this.lamps.matrices, ti, 0, 1.55, -0.18, 0.5, 0.17, 0.2);
        const k = 0.75 + view.night * 0.9;
        this.lamps.color(ti, TAXI_SIGN[0] * k, TAXI_SIGN[1] * k, TAXI_SIGN[2] * k);
      }
    } else if (v.kind === 'moto' && v.paint % 3 !== 0) {
      // Reparto: la caja térmica atrás.
      this.part(0, 1.24, -0.64, 0.44, 0.42, 0.44, DELIVERY[v.paint % DELIVERY.length]);
    } else if (v.kind === 'bike' && d < 32) {
      this.bikeLegs(v);
    }
  }

  /** Guiño que lleva puesto: −1 izquierda, 1 derecha, 0 ninguno. */
  private blinker(v: Vehicle): number {
    const paths = this.sim.net.paths;
    const P = paths[v.path];
    let t: TurnKind | null = null;
    if (P.kind === 'turn') t = P.turn;
    else if (v.next >= 0 && P.length - v.s < 30) t = paths[v.next].turn;
    // El colectivo que sale de la parada pone el de la izquierda.
    else if (v.dwell > 0 && v.dwell < 2.5) return -1;
    return t === 'left' || t === 'uturn' ? -1 : t === 'right' ? 1 : 0;
  }

  private part(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: RGB): void {
    const i = this.parts.next();
    if (i < 0) return;
    this.f.write(this.parts.matrices, i, x, y, z, sx, sy, sz);
    this.parts.color(i, c[0], c[1], c[2]);
  }

  /** Piernas del ciclista: muslo y pantorrilla por pierna, con los pies en los pedales. */
  private bikeLegs(v: Vehicle): void {
    const f = this.f;
    const pants = PALETTE_PANTS[(v.paint >> 3) % PALETTE_PANTS.length];
    const [hz, hy] = BIKE.hip;
    const t = BIKE.thigh;
    const s = BIKE.shin;
    for (let side = -1; side <= 1; side += 2) {
      const a = v.pedal + (side > 0 ? Math.PI : 0);
      const fz = BIKE.crank[0] + Math.cos(a) * BIKE.crankR;
      const fy = BIKE.crank[1] + Math.sin(a) * BIKE.crankR;
      const dz = fz - hz;
      const dy = fy - hy;
      const D = Math.min(t + s - 0.01, len2(dz, dy));
      const alpha = Math.acos(Math.max(-1, Math.min(1, (t * t + D * D - s * s) / (2 * t * D))));
      const beta = Math.atan2(dy, dz);
      const kz = hz + t * Math.cos(beta + alpha);
      const ky = hy + t * Math.sin(beta + alpha);
      const x = side * 0.1;
      this.bone(f, x, hy, hz, ky, kz, 0.13, pants);
      this.bone(f, x, ky, kz, fy, fz, 0.11, pants);
    }
  }

  /** Caja a lo largo de un hueso en el plano (z, y) del vehículo. */
  private bone(
    f: Frame,
    x: number,
    y0: number,
    z0: number,
    y1: number,
    z1: number,
    t: number,
    c: RGB,
  ): void {
    const i = this.parts.next();
    if (i < 0) return;
    const ly = y1 - y0;
    const lz = z1 - z0;
    const len = len2(ly, lz) || 1;
    const uy = ly / len;
    const uz = lz / len;
    // Eje Y del hueso en el mundo; X = el lateral del vehículo; Z = X × Y.
    const Yx = f.yx * uy + f.zx * uz;
    const Yy = f.yy * uy + f.zy * uz;
    const Yz = f.yz * uy + f.zz * uz;
    const Zx = f.xy * Yz - f.xz * Yy;
    const Zy = f.xz * Yx - f.xx * Yz;
    const Zz = f.xx * Yy - f.xy * Yx;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    writeBasis(
      this.parts.matrices,
      i,
      f.px(x, cy, cz),
      f.py(x, cy, cz),
      f.pz(x, cy, cz),
      f.xx,
      f.xy,
      f.xz,
      Yx,
      Yy,
      Yz,
      Zx,
      Zy,
      Zz,
      t,
      len,
      t,
    );
    this.parts.color(i, c[0], c[1], c[2]);
  }

  private paintOf(v: Vehicle): RGB {
    switch (v.kind) {
      case 'taxi':
        return TAXI_BODY;
      case 'van':
        return PALETTE_VAN[v.paint % PALETTE_VAN.length];
      case 'bus':
        return PALETTE_BUS[v.paint % PALETTE_BUS.length];
      case 'moto':
        return PALETTE_MOTO[v.paint % PALETTE_MOTO.length];
      case 'bike':
        return PALETTE_SHIRT[v.paint % PALETTE_SHIRT.length];
      default:
        return PALETTE_CAR[v.paint % PALETTE_CAR.length];
    }
  }

  /** Triángulos de cada forma (para medir). */
  get shapeTriangles(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.kinds)) out[k] = v.shape.kit.triangles;
    return out;
  }

  dispose(): void {
    for (const ch of this.channels) ch.dispose();
  }
}

/** Largo de (a, b): Math.hypot es varias veces más lento y esto corre cada cuadro. */
function len2(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}
