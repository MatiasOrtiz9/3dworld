import { ARM_L, ARM_R, BOUNCE, HPITCH, HROLL, HYAW, LEAN, LEG_L, LEG_R, PROLL, PTWIST, ROLL, SIT, TWIST } from './Anim';
import type { BodyDims } from './Looks';

/**
 * Esqueleto: de los canales de una pose a los marcos (rotación + posición)
 * de cada pieza, en el mundo.
 *
 * Matemática propia y mínima en vez de `Matrix` de Babylon: son 11 marcos
 * por persona y por cuadro, y así no se crea ni un objeto. Convención de
 * Babylon (vector fila): la fila i de la rotación es la imagen del eje i, y
 * un hijo se compone como `local · padre`.
 *
 * Los marcos son RÍGIDOS (sin escala). Cada pieza aplica su propia escala al
 * escribirse (`writePart`): si la escala viajara por la jerarquía, el
 * antebrazo de alguien ancho de hombros saldría deformado (cizallado).
 *
 * Los pies se apoyan solos: la cadera se ubica a la altura que deja la suela
 * más baja sobre el piso, así el rebote del paso sale de la propia pierna y
 * ningún pie se hunde ni flota (ni en la escalera, que es una rampa).
 */

export const F_PELVIS = 0;
export const F_CHEST = 1;
export const F_HEAD = 2;
export const F_UARM_L = 3;
export const F_UARM_R = 4;
export const F_FARM_L = 5;
export const F_FARM_R = 6;
export const F_THIGH_L = 7;
export const F_THIGH_R = 8;
export const F_SHIN_L = 9;
export const F_SHIN_R = 10;
const NF = 11;

// Rotaciones elementales en arreglos de 9 (filas = imágenes de los ejes).
function yawM(o: Float64Array, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  o[0] = c; o[1] = 0; o[2] = -s;
  o[3] = 0; o[4] = 1; o[5] = 0;
  o[6] = s; o[7] = 0; o[8] = c;
}

/** Cabeceo: lleva −Y (un miembro colgando) hacia +Z (adelante) con a > 0. */
function pitchM(o: Float64Array, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  o[0] = 1; o[1] = 0; o[2] = 0;
  o[3] = 0; o[4] = c; o[5] = -s;
  o[6] = 0; o[7] = s; o[8] = c;
}

/** Rolido: lleva +Y hacia +X con a > 0. */
function rollM(o: Float64Array, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  o[0] = c; o[1] = -s; o[2] = 0;
  o[3] = s; o[4] = c; o[5] = 0;
  o[6] = 0; o[7] = 0; o[8] = 1;
}

/** out = a · b (3×3). `out` puede ser `a` o `b`. */
function mul(out: Float64Array, a: Float64Array, ao: number, b: Float64Array, bo: number, oo = 0): void {
  const a0 = a[ao], a1 = a[ao + 1], a2 = a[ao + 2], a3 = a[ao + 3], a4 = a[ao + 4], a5 = a[ao + 5], a6 = a[ao + 6], a7 = a[ao + 7], a8 = a[ao + 8];
  const b0 = b[bo], b1 = b[bo + 1], b2 = b[bo + 2], b3 = b[bo + 3], b4 = b[bo + 4], b5 = b[bo + 5], b6 = b[bo + 6], b7 = b[bo + 7], b8 = b[bo + 8];
  out[oo] = a0 * b0 + a1 * b3 + a2 * b6;
  out[oo + 1] = a0 * b1 + a1 * b4 + a2 * b7;
  out[oo + 2] = a0 * b2 + a1 * b5 + a2 * b8;
  out[oo + 3] = a3 * b0 + a4 * b3 + a5 * b6;
  out[oo + 4] = a3 * b1 + a4 * b4 + a5 * b7;
  out[oo + 5] = a3 * b2 + a4 * b5 + a5 * b8;
  out[oo + 6] = a6 * b0 + a7 * b3 + a8 * b6;
  out[oo + 7] = a6 * b1 + a7 * b4 + a8 * b7;
  out[oo + 8] = a6 * b2 + a7 * b5 + a8 * b8;
}

const tA = new Float64Array(9);
const tB = new Float64Array(9);
const tC = new Float64Array(9);
const tL = new Float64Array(9);

export class Rig {
  /** 11 marcos × 12 números: rotación (9) y posición (3). */
  readonly f = new Float64Array(NF * 12);

  /** Rotación local = yaw · roll · pitch (se aplica en ese orden). */
  private local(yaw: number, roll: number, pitch: number): Float64Array {
    yawM(tA, yaw);
    rollM(tB, roll);
    mul(tC, tA, 0, tB, 0);
    pitchM(tA, pitch);
    mul(tL, tC, 0, tA, 0);
    return tL;
  }

  /** Marco hijo: rotación local · padre, y la articulación en (ox, oy, oz) del padre. */
  private child(idx: number, parent: number, rot: Float64Array, ox: number, oy: number, oz: number): void {
    const f = this.f;
    const p = parent * 12;
    const o = idx * 12;
    mul(f, rot, 0, f, p, o);
    f[o + 9] = ox * f[p] + oy * f[p + 3] + oz * f[p + 6] + f[p + 9];
    f[o + 10] = ox * f[p + 1] + oy * f[p + 4] + oz * f[p + 7] + f[p + 10];
    f[o + 11] = ox * f[p + 2] + oy * f[p + 5] + oz * f[p + 8] + f[p + 11];
  }

  /**
   * Arma el esqueleto. `x, z` es la cadera en el mundo; `yaw`, el rumbo del
   * cuerpo; `floorY`, el piso bajo los pies; `seatY`, la tapa del asiento
   * (para el canal SIT). `footFloor` (opcional) da el piso bajo cada pie
   * (mundo) cuando no es plano.
   */
  pose(p: Float32Array, d: BodyDims, x: number, z: number, yaw: number, floorY: number, seatY: number, footFloor: ((x: number, z: number) => number) | null = null): void {
    const f = this.f;
    // Pelvis: guiñada y rolido propios sobre el rumbo.
    yawM(tA, p[PTWIST]);
    rollM(tB, p[PROLL]);
    mul(tC, tA, 0, tB, 0);
    yawM(tA, yaw);
    mul(f, tC, 0, tA, 0, 0);
    f[9] = x;
    f[10] = 0;
    f[11] = z;
    // Tronco desde la cintura; cabeza desde la base del cuello.
    this.child(F_CHEST, F_PELVIS, this.local(p[TWIST], p[ROLL], -p[LEAN]), 0, d.waist, 0);
    // Cabeza: rolido, cabeceo y después la guiñada (gira la cabeza ya inclinada).
    rollM(tA, p[HROLL]);
    pitchM(tB, -p[HPITCH]);
    mul(tC, tA, 0, tB, 0);
    yawM(tA, p[HYAW]);
    mul(tL, tC, 0, tA, 0);
    this.child(F_HEAD, F_CHEST, tL, 0, d.torso, -0.012 * d.s);
    for (const side of [-1, 1]) {
      const a = side < 0 ? ARM_L : ARM_R;
      const ua = side < 0 ? F_UARM_L : F_UARM_R;
      const fa = side < 0 ? F_FARM_L : F_FARM_R;
      this.child(ua, F_CHEST, this.local(-side * p[a + 2], -side * p[a + 1], p[a]), side * d.shoulderX, d.shoulderY, 0);
      pitchM(tL, p[a + 3]);
      this.child(fa, ua, tL, 0, -d.upperArm, 0);
      const l = side < 0 ? LEG_L : LEG_R;
      const th = side < 0 ? F_THIGH_L : F_THIGH_R;
      const sh = side < 0 ? F_SHIN_L : F_SHIN_R;
      this.child(th, F_PELVIS, this.local(side * p[l + 2], -side * p[l + 1], p[l]), side * d.hipX, 0, 0);
      pitchM(tL, -p[l + 3]);
      this.child(sh, th, tL, 0, -d.thigh, 0);
    }
    // Pies en el piso: la suela más baja toca `floorY`.
    const sole = (sh: number): number => {
      const o = sh * 12;
      return -d.shin * f[o + 4] + 0.035 * d.legS * f[o + 7] + f[o + 10];
    };
    let stand: number;
    if (footFloor) {
      // Piso desparejo (escalones, el umbral del portón): cada pie mira el
      // piso que tiene debajo y ninguno se hunde. El que queda arriba es el
      // que pisa; el otro, a lo sumo, va levantado como al subir.
      const lift = (sh: number): number => {
        const o = sh * 12;
        const px = -d.shin * f[o + 3] + 0.035 * d.legS * f[o + 6] + f[o + 9];
        const pz = -d.shin * f[o + 5] + 0.035 * d.legS * f[o + 8] + f[o + 11];
        return footFloor(px, pz) - sole(sh);
      };
      stand = Math.max(lift(F_SHIN_L), lift(F_SHIN_R)) + p[BOUNCE] * d.legS;
    } else {
      stand = floorY - Math.min(sole(F_SHIN_L), sole(F_SHIN_R)) + p[BOUNCE] * d.legS;
    }
    const s = p[SIT];
    const k = s * s * (3 - 2 * s);
    const hipY = stand + (seatY + d.seatOffset - stand) * k;
    for (let i = 0; i < NF; i++) f[i * 12 + 10] += hipY;
  }

  /** Altura (mundo) de los ojos, para mirar a alguien a los ojos. */
  eyeY(d: BodyDims): number {
    const o = F_HEAD * 12;
    return this.f[o + 10] + 0.17 * d.headS * this.f[o + 4];
  }

  /**
   * Escribe la matriz de una pieza (escala propia × marco) en un buffer de
   * thin instances, en el formato de `Matrix.m` de Babylon.
   */
  writePart(frame: number, sx: number, sy: number, sz: number, out: Float32Array, off: number): void {
    const f = this.f;
    const b = frame * 12;
    out[off] = f[b] * sx;
    out[off + 1] = f[b + 1] * sx;
    out[off + 2] = f[b + 2] * sx;
    out[off + 3] = 0;
    out[off + 4] = f[b + 3] * sy;
    out[off + 5] = f[b + 4] * sy;
    out[off + 6] = f[b + 5] * sy;
    out[off + 7] = 0;
    out[off + 8] = f[b + 6] * sz;
    out[off + 9] = f[b + 7] * sz;
    out[off + 10] = f[b + 8] * sz;
    out[off + 11] = 0;
    out[off + 12] = f[b + 9];
    out[off + 13] = f[b + 10];
    out[off + 14] = f[b + 11];
    out[off + 15] = 1;
  }

  /** Punto local (x, y, z) de un marco, en el mundo. */
  point(frame: number, x: number, y: number, z: number, out: { x: number; y: number; z: number }): void {
    const f = this.f;
    const b = frame * 12;
    out.x = x * f[b] + y * f[b + 3] + z * f[b + 6] + f[b + 9];
    out.y = x * f[b + 1] + y * f[b + 4] + z * f[b + 7] + f[b + 10];
    out.z = x * f[b + 2] + y * f[b + 5] + z * f[b + 8] + f[b + 11];
  }
}
