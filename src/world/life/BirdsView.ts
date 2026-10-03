/**
 * Dibuja los pájaros de `BirdSim`: dos mallas (cuerpo y ala) para todas las
 * bandadas, los chimangos y las palomas de la vereda. El ala es una sola
 * pieza de dos caras; la izquierda es la derecha girada media vuelta sobre
 * el eje del cuerpo (espejarla invertiría las caras de la instancia).
 */
import type { Scene } from '@babylonjs/core/scene';
import { Channel, Frame, writeBasis } from './channel';
import { GeoKit, PAINT, type RGBA } from './geoKit';
import type { LifeMaterials } from './lifeMaterials';
import { lin } from './vehicleShapes';
import type { BirdSim, Plumage } from './birdSim';

type RGB = [number, number, number];

const BEAK: RGBA = [...lin('#2a2624'), 0.5] as unknown as RGBA;
const FEET: RGBA = [...lin('#b4554c'), 0.7] as unknown as RGBA;
const NECK: RGBA = [...lin('#4f6a62'), 0.35] as unknown as RGBA;

/** Paloma de 32 cm: huso, cuello tornasolado, cabeza, pico, cola y patas. */
function bodyKit(): GeoKit {
  const k = new GeoKit();
  k.lathe(
    [
      [-0.12, 0.012, 0.01],
      [-0.07, 0.048, 0.045],
      [0.0, 0.062, 0.058],
      [0.06, 0.046, 0.05],
      [0.1, 0.026, 0.03],
    ],
    5,
    0.13,
    (r) => (r === 3 ? NECK : PAINT),
  );
  k.box(0, 0.185, 0.112, 0.042, 0.048, 0.056, PAINT, '-y');
  k.box(0, 0.178, 0.148, 0.012, 0.012, 0.024, BEAK, '-y');
  k.box(0, 0.128, -0.165, 0.07, 0.012, 0.1, PAINT);
  for (const s of [-1, 1]) k.box(s * 0.02, 0.045, 0.0, 0.012, 0.09, 0.012, FEET, '+y-y');
  return k;
}

/** Ala derecha: raíz en el origen, punta hacia +x, plana y de dos caras. */
function wingKit(): GeoKit {
  const k = new GeoKit();
  const pts: Array<[number, number, number]> = [
    [0, 0, 0.05],
    [0.15, 0, 0.035],
    [0.3, 0, -0.03],
    [0.27, 0, -0.085],
    [0.12, 0, -0.08],
    [0, 0, -0.07],
  ];
  k.face(pts, PAINT, [0, 1, 0]);
  k.face(pts.slice(), PAINT, [0, -1, 0]);
  return k;
}

const COLORS: Record<Plumage, RGB> = {
  pigeon: lin('#7f8591'),
  parrot: lin('#5b9a3c'),
  starling: lin('#2a2a2e'),
  raptor: lin('#6f5847'),
};
const PIGEON_WHITE = lin('#d6d4cf');
const PIGEON_BROWN = lin('#6d5a4c');

export class BirdsView {
  private readonly body: Channel;
  private readonly wing: Channel;
  private readonly f = new Frame();
  private readonly near: number;

  constructor(
    scene: Scene,
    private readonly sim: BirdSim,
    mats: LifeMaterials,
    lite: boolean,
  ) {
    const n = sim.poses.length;
    this.body = new Channel(scene, 'life-birdBody', bodyKit(), mats.matte, n, true);
    this.wing = new Channel(scene, 'life-birdWing', wingKit(), mats.matte, n * 2, true);
    this.near = lite ? 55 : 80;
  }

  update(vx: number, vz: number): void {
    this.body.begin();
    this.wing.begin();
    const near2 = this.near * this.near;
    for (const p of this.sim.poses) {
      if (!p.visible) continue;
      // Las palomas de la vereda son chicas: lejos no se ven.
      if (
        p.plumage === 'pigeon' &&
        !p.wings &&
        (p.x - vx) * (p.x - vx) + (p.z - vz) * (p.z - vz) > near2
      )
        continue;
      const col = this.color(p.plumage, p.tint);
      const f = this.f.set(p.x, p.y, p.z, p.yaw, p.pitch, p.roll);
      const i = this.body.next();
      if (i < 0) break;
      const s = p.scale;
      f.write(this.body.matrices, i, 0, 0, 0, s, s, s);
      this.body.color(i, col[0], col[1], col[2]);
      if (!p.wings) continue;
      const cf = Math.cos(p.flap);
      const sf = Math.sin(p.flap);
      for (let side = -1; side <= 1; side += 2) {
        const wi = this.wing.next();
        if (wi < 0) break;
        // Ejes del ala en el marco del cuerpo. Derecha: X = (cos φ, sen φ, 0),
        // Y = (−sen φ, cos φ, 0). Izquierda: la misma girada π sobre Z.
        const lxx = side > 0 ? cf : -cf;
        const lxy = sf;
        const lyx = side > 0 ? -sf : -sf;
        const lyy = side > 0 ? cf : -cf;
        // Hombro: un poco arriba y adelante del centro del cuerpo.
        const ax = side * 0.03 * s;
        const ay = 0.155 * s;
        const az = 0.02 * s;
        writeBasis(
          this.wing.matrices,
          wi,
          f.px(ax, ay, az),
          f.py(ax, ay, az),
          f.pz(ax, ay, az),
          f.xx * lxx + f.yx * lxy,
          f.xy * lxx + f.yy * lxy,
          f.xz * lxx + f.yz * lxy,
          f.xx * lyx + f.yx * lyy,
          f.xy * lyx + f.yy * lyy,
          f.xz * lyx + f.yz * lyy,
          f.zx,
          f.zy,
          f.zz,
          s,
          s,
          s,
        );
        this.wing.color(wi, col[0] * 0.92, col[1] * 0.92, col[2] * 0.92);
      }
    }
    this.body.flush();
    this.wing.flush();
  }

  private color(pl: Plumage, tint: number): RGB {
    if (pl === 'pigeon') {
      if (tint > 0.9) return PIGEON_WHITE;
      if (tint < 0.12) return PIGEON_BROWN;
    }
    return COLORS[pl];
  }

  dispose(): void {
    this.body.dispose();
    this.wing.dispose();
  }
}
