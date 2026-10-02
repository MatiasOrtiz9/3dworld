import { SCHOOL, WALLS, roomAt, roomLabel, type Level, type P, type Room } from './SchoolLayout';

/**
 * Puertas que se abren y se cierran: las de las aulas, oficinas y salas que
 * dan a un pasillo. Puro (sin motor): lo leen el constructor de la escuela
 * (para no dibujar su hoja fija) y el juego (que dibuja la hoja, la anima y
 * la cierra al paso).
 *
 * Se derivan de los muros del plano: si un vano cambia, la puerta lo sigue.
 * Las puertas de la historia (cerraduras) son otras: portal, salidas de
 * emergencia, escaleras, jardín — ninguna da de un pasillo a un aula.
 */

export interface LeafDef {
  /** Bisagra: en la cara del muro del lado del ambiente. */
  hinge: P;
  /** Dirección de la hoja cerrada, desde la bisagra (unitaria). */
  dir: [number, number];
  /** Ancho de la hoja. */
  width: number;
}

export interface DoorDef {
  id: string;
  level: Level;
  /** Extremos del vano sobre el eje del muro (plano). */
  a: P;
  b: P;
  /** Una hoja (puerta simple) o dos (doble, las de las aulas de primaria). */
  leaves: LeafDef[];
  /** Dirección del muro, de `a` a `b` (unitaria). */
  dir: [number, number];
  /** Hacia dónde abre (hacia adentro del ambiente, unitaria). */
  swing: [number, number];
  /** Espesor del muro. */
  wallT: number;
  /** Alto de la hoja sobre el piso de su nivel. */
  height: number;
  /** Clave de material de hoja y marco en el constructor (si tiene). */
  color?: string;
  /** Hoja con paño vidriado arriba (las de aluminio de las aulas). */
  glass: boolean;
  room: Room;
  label: string;
}

const CORRIDOR = /^(pasillo|hall|galeria|pasarela|rellano|pasaje|nicho|torre)/i;
const ROOMISH = /^(aula|tecnologia|arte|teatro|bilingue|biblioteca|dirPrim|dirSec|secretaria|prof$|precep|sala|adm$|ep$|recepcionOf)/;

function isCorridor(r: Room | null): boolean {
  return !r || !r.roofed || r.name === 'Pasillo' || CORRIDOR.test(r.id);
}

function isRoom(r: Room | null): r is Room {
  return Boolean(r && r.roofed && !isCorridor(r) && ROOMISH.test(r.id));
}

/** Clave de un vano por sus extremos (2 decimales), igual en el constructor y acá. */
export function openingKey(level: Level, a: P, b: P): string {
  const f = (x: number) => x.toFixed(2);
  return `${level}:${f(a[0])},${f(a[1])}:${f(b[0])},${f(b[1])}`;
}

function build(): DoorDef[] {
  const out: DoorDef[] = [];
  for (const w of WALLS) {
    if (w.level > 1) continue;
    const [au, av] = w.a;
    const len = Math.hypot(w.b[0] - au, w.b[1] - av);
    const du = (w.b[0] - au) / len;
    const dv = (w.b[1] - av) / len;
    // Sólo muros a escuadra: el rectángulo de colisión es alineado al plano.
    if (Math.abs(du) > 1e-3 && Math.abs(dv) > 1e-3) continue;
    const nu = -dv;
    const nv = du;
    const t = w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT;
    for (const o of w.openings) {
      if (o.type !== 'door' && o.type !== 'double') continue;
      const a: P = [au + du * o.t0, av + dv * o.t0];
      const b: P = [au + du * o.t1, av + dv * o.t1];
      const mu = (a[0] + b[0]) / 2;
      const mv = (a[1] + b[1]) / 2;
      const pos = roomAt(mu + nu * 0.45, mv + nv * 0.45, w.level);
      const neg = roomAt(mu - nu * 0.45, mv - nv * 0.45, w.level);
      let room: Room;
      let s: number;
      if (isRoom(pos) && isCorridor(neg)) {
        room = pos;
        s = 1;
      } else if (isRoom(neg) && isCorridor(pos)) {
        room = neg;
        s = -1;
      } else continue;
      const len2 = o.t1 - o.t0;
      if (len2 - 0.16 < 0.5) continue;
      const face = (d: number): P => [au + du * (o.t0 + d) + nu * s * (t / 2), av + dv * (o.t0 + d) + nv * s * (t / 2)];
      // Mismas bisagras y anchos que las hojas fijas del constructor.
      const leaves: LeafDef[] =
        o.type === 'door'
          ? [{ hinge: face(0.08), dir: [du, dv], width: len2 - 0.16 }]
          : [
              { hinge: face(0.08), dir: [du, dv], width: (len2 - 0.16) / 2 },
              { hinge: face(len2 - 0.08), dir: [-du, -dv], width: (len2 - 0.16) / 2 },
            ];
      out.push({
        id: `${room.id}-${out.filter((d) => d.room.id === room.id).length + 1}`,
        level: w.level,
        a,
        b,
        leaves,
        dir: [du, dv],
        swing: [nu * s, nv * s],
        wallT: t,
        // El vano de una puerta doble es 10 cm más alto (2,25 m, como lo corta
        // el constructor): con la altura de la simple quedaba una ranura
        // abierta entre las hojas y el cabezal del marco.
        height: Math.min(o.ht ?? (o.type === 'double' ? 2.25 : 2.15), w.h - 0.15) - 0.04 - (SCHOOL.floorY - 0.03),
        color: o.color,
        glass: Boolean(o.color && o.color !== 'red' && o.color !== 'timberDark'),
        room,
        label: roomLabel(room),
      });
    }
  }
  return out;
}

export const DOORS: readonly DoorDef[] = build();

const KEYS = new Set(DOORS.map((d) => openingKey(d.level, d.a, d.b)));

/** ¿Este vano es una puerta que maneja el juego? (el constructor no dibuja su hoja). */
export function isInteractiveDoor(level: Level, a: P, b: P): boolean {
  return KEYS.has(openingKey(level, a, b));
}

/** Rectángulo macizo del vano cerrado (para la colisión del jugador). */
export function doorRect(d: DoorDef): { u0: number; v0: number; u1: number; v1: number; level: Level } {
  const h = d.wallT / 2 + 0.06;
  const u0 = Math.min(d.a[0], d.b[0]);
  const u1 = Math.max(d.a[0], d.b[0]);
  const v0 = Math.min(d.a[1], d.b[1]);
  const v1 = Math.max(d.a[1], d.b[1]);
  const alongU = Math.abs(d.dir[0]) > 0.5;
  return alongU
    ? { u0, v0: v0 - h, u1, v1: v1 + h, level: d.level }
    : { u0: u0 - h, v0, u1: u1 + h, v1, level: d.level };
}
