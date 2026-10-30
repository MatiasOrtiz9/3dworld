import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { InstanceFarm } from '../../../core/InstanceFarm';
import type { Materials } from '../../Materials';
import type { Rng } from '../../../utils/rng';
import type { NatureBuilder } from '../NatureBuilder';
import type { FoliageCards } from '../../FoliageCards';
import type { StreetLevel } from '../StreetLevel';
import { PrismBatch } from '../PrismBatch';
import { SCHOOL, toWorld, type Item, type P, type SchoolFrame } from '../../SchoolLayout';
import type { Fixture } from '../../SchoolLights';
import { schoolMaterials, type SchoolMats } from './SchoolMaterials';

/** Alto de una planta de la escuela. */
export const H = SCHOOL.storey;
/** Piso terminado de la planta baja. */
export const FY = SCHOOL.floorY;

/** Dirección local (Δu, Δv) hacia la que mira un frente. */
export function faceDir(face: Item['face']): [number, number] {
  return face === 'n' ? [0, -1] : face === 's' ? [0, 1] : face === 'e' ? [1, 0] : [-1, 0];
}

/**
 * Luminaria de la escuela, en coordenadas del MUNDO: centro de la cara que
 * da luz (`y`), huella (`sx` × `sz`), tipo, ambiente y el piso que ilumina
 * (`floor`). La anota quien la dibuja; sirve para efectos que siguen a las
 * luces (los pozos de luz falsos de `LightPools`) sin recorrer la granja ni
 * repetir la grilla de `SchoolItems.lights`.
 */
export interface LampFixture {
  x: number;
  y: number;
  z: number;
  sx: number;
  sz: number;
  /** tube: tubo lineal · panel: LED 60 × 60 · dome: campana colgada · pendant: riel del comedor · gym: colgada de la bóveda. */
  kind: 'tube' | 'panel' | 'dome' | 'pendant' | 'gym';
  /** Ambiente (id) o `null` si no cae en ninguno. */
  room: string | null;
  /** Altura del piso que ilumina (mundo). */
  floor: number;
  /** Con interruptor del juego (`switchable`): el juego la puede apagar. */
  switchable: boolean;
}

/**
 * Kit compartido de los constructores de la escuela: granja, materiales,
 * generador, naturaleza, marco, detalle y las primitivas en coordenadas
 * locales del plano (`box`, `cyl`, `piece`, `yaw`, `mat`). Hay una sola
 * instancia por escuela, y la reciben `SchoolBuilder` (envolvente),
 * `SchoolItems` (equipamiento e interiores) y `SchoolOutdoor` (exterior,
 * patios y verde): los tres dibujan en la misma granja y sacan números del
 * mismo generador, en el mismo orden que cuando eran un solo archivo.
 */
export class SchoolKit {
  /** Marco de la escuela (lo fija `begin` al empezar `build`). */
  f!: SchoolFrame;
  /** Prismas de planta (pisos, losas, cielorrasos, tímpanos). */
  prisms!: PrismBatch;
  /** Materiales por clave (ver `SchoolMaterials`). */
  readonly m: SchoolMats;
  /** Piso del nivel del objeto que se está armando (ver `SchoolItems.item`). */
  fy: number = FY;
  /**
   * Luminarias de las aulas con interruptor, por aula: la parte que se
   * enciende la dibuja el juego (`game/world/Lights`); acá queda el marco.
   */
  readonly switchable = new Map<string, Fixture[]>();
  /** Todas las luminarias dibujadas, en el orden en que se dibujaron. */
  readonly fixtures: LampFixture[] = [];
  /** Tarjetas de follaje recortado (frondas de palmera, matas): las crea `SchoolBuilder.build`. */
  cards: FoliageCards | null = null;

  constructor(
    readonly farm: InstanceFarm,
    readonly mats: Materials,
    readonly rng: Rng,
    readonly nature: NatureBuilder,
    readonly street: StreetLevel,
    /**
     * Detalle fino de mobiliario y herrería. En VR (perfiles sin detalle de
     * calle) pupitres, sillas, rejas, mallas y cortinas se arman con menos
     * piezas: a la distancia de lectura de un visor no se distinguen y la
     * planta alta multiplicó esas piezas.
     */
    readonly detailed = true,
  ) {
    this.m = schoolMaterials(mats);
  }

  /** Fija el marco y abre el lote de prismas de esta escuela. */
  begin(frame: SchoolFrame): void {
    this.f = frame;
    this.prisms = new PrismBatch((u, v) => toWorld(frame, u, v), 0.3);
  }

  /** Caja alineada, apoyada en `y`, en coordenadas locales. */
  box(mat: Material, u: number, v: number, w: number, h: number, d: number, y = 0): void {
    const p = toWorld(this.f, u, v);
    this.farm.addBoxOnGround(mat, p.x, p.z, w, h, d, y, 0);
  }

  /**
   * Cilindro vertical. `hi`: de 10 lados, para lo redondo que se ve de cerca
   * (mesas redondas, matafuegos, piletas, columnas, tambores); los postes,
   * mástiles, troncos y las luminarias del cielorraso siguen de 6. Todos los
   * cilindros de un mismo material van, en lo posible, del mismo lado (los
   * dos juntos serían un draw call más).
   */
  cyl(mat: Material, u: number, v: number, dia: number, h: number, y = 0, hi = false): void {
    const p = toWorld(this.f, u, v);
    this.farm.add(hi ? 'cylinderHi' : 'cylinder', mat, new Vector3(p.x, y + h / 2, p.z), new Vector3(dia, h, dia));
  }

  /**
   * Caja a lo largo del segmento a→b (cualquier ángulo), de espesor `t`,
   * entre `y0` e `y1`, corrida `off` metros hacia la normal izquierda.
   */
  piece(mat: Material, a: P, b: P, t: number, y0: number, y1: number, off = 0): void {
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const len = Math.hypot(du, dv);
    if (len < 0.01 || y1 - y0 < 0.004) return;
    const nu = -dv / len;
    const nv = du / len;
    const p = toWorld(this.f, (a[0] + b[0]) / 2 + nu * off, (a[1] + b[1]) / 2 + nv * off);
    // rotY lleva +X a (cos, −sin): el eje largo va sobre la dirección del
    // segmento EN EL MUNDO, donde +u es −x.
    this.farm.add('box', mat, new Vector3(p.x, (y0 + y1) / 2, p.z), new Vector3(len, y1 - y0, t), this.yaw(du, dv));
  }

  /** Giro en Y que alinea +X con la dirección local (du, dv). */
  yaw(du: number, dv: number): number {
    const a = toWorld(this.f, 0, 0);
    const b = toWorld(this.f, du, dv);
    return Math.atan2(-(b.z - a.z), b.x - a.x);
  }

  /** ¿El punto `p` está a menos de `d` del segmento a→b (dentro de su largo)? */
  nearSegment(a: P, b: P, p: P, d: number): boolean {
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const l2 = du * du + dv * dv;
    // Sin recortar t: pasada la punta del segmento el muro ya no está.
    const t = l2 > 0 ? ((p[0] - a[0]) * du + (p[1] - a[1]) * dv) / l2 : 0;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    return Math.hypot(p[0] - a[0] - du * t, p[1] - a[1] - dv * t) < d;
  }

  /**
   * Tramos [t0, t1] de un segmento de largo `len` donde vale `ok`: se
   * muestrea cada 10 cm y cada borde se ajusta por bisección. Descarta los
   * tramos más cortos que `min`.
   */
  runs(len: number, ok: (t: number) => boolean, min: number): Array<[number, number]> {
    const n = Math.max(1, Math.round(len / 0.1));
    const step = len / n;
    const edge = (lo: number, hi: number, loOk: boolean) => {
      for (let k = 0; k < 7; k++) {
        const m = (lo + hi) / 2;
        if (ok(m) === loOk) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    };
    const out: Array<[number, number]> = [];
    let start: number | null = null;
    let prev = false;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * step;
      const cur = ok(t);
      if (cur && start === null) start = k === 0 ? 0 : edge(t - step, t, prev);
      if (!cur && start !== null) {
        out.push([start, edge(t - step, t, prev)]);
        start = null;
      }
      prev = cur;
    }
    if (start !== null) out.push([start, len]);
    return out.filter(([t0, t1]) => t1 - t0 >= min);
  }

  /**
   * Anota una luminaria ya dibujada (ver `LampFixture`): centro (u, v) en
   * coordenadas locales, huella `sx` × `sz` y cara que da luz a `y`. No dibuja
   * nada: la granja queda igual.
   */
  note(
    u: number,
    v: number,
    sx: number,
    sz: number,
    y: number,
    kind: LampFixture['kind'],
    room: string | null,
    floor: number,
    switchable = false,
  ): void {
    const p = toWorld(this.f, u, v);
    this.fixtures.push({ x: p.x, y, z: p.z, sx, sz, kind, room, floor, switchable });
  }

  /** Material por clave, con uno por defecto. */
  mat(key: string | undefined, fallback: Material): Material {
    return (key && this.m[key]) || fallback;
  }
}
