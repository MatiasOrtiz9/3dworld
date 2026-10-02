import { DOORS, type DoorDef } from './SchoolDoors';
import { SCHOOL, WALLS, type Level, type P } from './SchoolLayout';

/**
 * Luces de las aulas que se prenden y se apagan con su interruptor.
 *
 * Puro: qué aulas tienen interruptor y dónde está (junto a la puerta, del
 * lado del picaporte y adentro del aula). Las luminarias las ubica el
 * constructor de la escuela (`SchoolBuilder.lights`) con su grilla de
 * siempre; para estas aulas dibuja sólo el marco y deja anotada cada
 * luminaria en `switchable`, que el juego enciende o apaga.
 */

export interface Fixture {
  /** Centro en el mundo (ya convertido por el constructor). */
  x: number;
  y: number;
  z: number;
  /** Medidas de la parte que se enciende (en mundo, alineadas a la grilla del plano). */
  sx: number;
  sy: number;
  sz: number;
}

export interface SwitchDef {
  roomId: string;
  label: string;
  level: Level;
  /** Punto del plano sobre la cara del muro, adentro del aula. */
  at: P;
  /** Normal hacia el aula (la placa mira hacia acá). */
  facing: [number, number];
}

/** Aulas con interruptor: las de clase (no oficinas ni baños). */
export function isSwitchableRoom(roomId: string): boolean {
  return /^aula|^tecnologia|^arte$|^teatro$|^bilingue$|^biblioteca$/.test(roomId);
}

/**
 * ¿La placa (8,5 cm de ancho) cabe en `p` sobre el eje del muro de la
 * puerta, con muro lleno alrededor: lejos de otros vanos (6 cm del marco de
 * una ventana, 13 de la jamba de una puerta) y de un muro que llegue de
 * costado? Si el picaporte cae contra una esquina, la placa quedaba metida
 * en el muro vecino, colgando más allá del extremo del muro o sobre un vidrio.
 */
function clearOnWall(level: Level, p: P): boolean {
  for (const w of WALLS) {
    if (w.level !== level) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const du = (w.b[0] - w.a[0]) / len;
    const dv = (w.b[1] - w.a[1]) / len;
    const ru = p[0] - w.a[0];
    const rv = p[1] - w.a[1];
    const t = ru * du + rv * dv;
    const n = Math.abs(-ru * dv + rv * du);
    const half = (w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT) / 2;
    // Otro muro que pasa por ahí (de costado): la placa quedaría adentro.
    if (n < half + 0.055 && t > -half - 0.055 && t < len + half + 0.055) {
      if (n > 0.02) return false;
      if (t < 0.06 || t > len - 0.06) return false;
      const near = (o: (typeof w.openings)[number]) => (o.type === 'window' || o.type === 'band' || o.type === 'high' ? 0.06 : 0.13);
      if (w.openings.some((o) => t > o.t0 - near(o) && t < o.t1 + near(o))) return false;
    }
  }
  return true;
}

function switchFor(d: DoorDef): SwitchDef {
  // Del lado del picaporte (el extremo `b` del vano), 25 cm más allá del
  // marco; si ahí no hay muro lleno, del lado de las bisagras.
  // Si tampoco, lo más cerca del marco que se pueda (el paño entre la
  // puerta y una ventana puede ser angosto).
  const onAxis = (end: P, s: number, dist: number): P => [end[0] + d.dir[0] * dist * s, end[1] + d.dir[1] * dist * s];
  const options: P[] = [];
  for (const dist of [0.25, 0.2, 0.16, 0.13]) options.push(onAxis(d.b, 1, dist), onAxis(d.a, -1, dist));
  const base = options.find((p) => clearOnWall(d.level, p)) ?? options[0];
  const at: P = [base[0] + d.swing[0] * (d.wallT / 2 + 0.01), base[1] + d.swing[1] * (d.wallT / 2 + 0.01)];
  return { roomId: d.room.id, label: d.label, level: d.level, at, facing: d.swing };
}

/** Un interruptor por aula, junto a su (primera) puerta. */
export const SWITCHES: readonly SwitchDef[] = (() => {
  const seen = new Set<string>();
  const out: SwitchDef[] = [];
  for (const d of DOORS) {
    if (!isSwitchableRoom(d.room.id) || seen.has(d.room.id)) continue;
    seen.add(d.room.id);
    out.push(switchFor(d));
  }
  return out;
})();

export const SWITCHABLE_ROOMS: ReadonlySet<string> = new Set(SWITCHES.map((s) => s.roomId));
