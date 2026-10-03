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
const ROOMISH = /^(aula|tecnologia|arte|teatro|bilingue|biblioteca|dirPrim|dirSec|gerencia|secretaria|prof$|precep|sala|adm$|ep$|recepcionOf)/;

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

/** Hoja abierta en planta: de la bisagra hacia adentro del ambiente. */
function openLeaf(d: DoorDef, L: LeafDef): [P, P] {
  return [L.hinge, [L.hinge[0] + d.swing[0] * L.width, L.hinge[1] + d.swing[1] * L.width]];
}

/** Distancia mínima entre dos segmentos (0 si se cruzan). */
function segmentGap([a, b]: [P, P], [c, d]: [P, P]): number {
  const cross = (o: P, p: P, q: P) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const toSeg = (p: P, s0: P, s1: P) => {
    const du = s1[0] - s0[0];
    const dv = s1[1] - s0[1];
    const l2 = du * du + dv * dv;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - s0[0]) * du + (p[1] - s0[1]) * dv) / l2)) : 0;
    return Math.hypot(p[0] - (s0[0] + du * t), p[1] - (s0[1] + dv * t));
  };
  return Math.min(toSeg(a, c, d), toSeg(b, c, d), toSeg(c, a, b), toSeg(d, a, b));
}

/** Holgura mínima entre dos hojas abiertas (el espesor de una hoja y algo más). */
const LEAF_CLEAR = 0.06;

/** ¿Dos hojas abiertas de puertas distintas se tocan o se atraviesan? */
export function leavesClash(d: DoorDef, L: LeafDef, e: DoorDef, M: LeafDef): boolean {
  return d !== e && d.level === e.level && segmentGap(openLeaf(d, L), openLeaf(e, M)) < LEAF_CLEAR;
}

function build(): DoorDef[] {
  const out: DoorDef[] = [];
  /** Bisagra alternativa de las puertas simples (la otra jamba), si ahí entra la hoja. */
  const alternatives = new Map<DoorDef, LeafDef>();
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
      // La hoja entra 5 mm en cada jamba (el marco cubre 0–7 cm del vano):
      // arrancando en 8 cm, con la hoja cerrada quedaba una ranura de 1 cm a
      // cada lado por la que se veía el aula o el pasillo. Entre las dos hojas
      // de una doble NO se solapan: son coplanares y titilarían.
      // Una hoja simple abierta contra un muro en diagonal (la dirección de
      // primaria, junto a Miguel Cané) lo atravesaba: ahí la bisagra va del
      // otro lado del vano.
      const fits = (hinge: P, hd: [number, number], width: number) =>
        [0.5, 1].every((k) => roomAt(hinge[0] + hd[0] * 0.05 + nu * s * width * k, hinge[1] + hd[1] * 0.05 + nv * s * width * k, w.level) === room);
      // Elegida y, si la otra jamba también sirve, la alternativa.
      const single = (): [LeafDef, LeafDef | null] => {
        const width = len2 - 0.13;
        const near: LeafDef = { hinge: face(0.065), dir: [du, dv], width };
        const far: LeafDef = { hinge: face(len2 - 0.065), dir: [-du, -dv], width };
        const farFits = fits(far.hinge, far.dir, width);
        if (fits(near.hinge, near.dir, width)) return [near, farFits ? far : null];
        return farFits ? [far, null] : [near, null];
      };
      const [first, alternative] = o.type === 'door' ? single() : [null, null];
      const leaves: LeafDef[] = first
        ? [first]
        : [
            { hinge: face(0.065), dir: [du, dv], width: (len2 - 0.13) / 2 },
            { hinge: face(len2 - 0.065), dir: [-du, -dv], width: (len2 - 0.13) / 2 },
          ];
      const def: DoorDef = {
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
        // abierta entre las hojas y el cabezal del marco. La hoja entra 5 mm
        // en el cabezal (con 1 cm por debajo se veía luz por arriba).
        height: Math.min(o.ht ?? (o.type === 'double' ? 2.25 : 2.15), w.h - 0.15) - 0.025 - (SCHOOL.floorY - 0.03),
        color: o.color,
        glass: Boolean(o.color && o.color !== 'red' && o.color !== 'timberDark'),
        room,
        label: roomLabel(room),
      };
      out.push(def);
      if (alternative) alternatives.set(def, alternative);
    }
  }
  // Dos puertas en esquina cuyas hojas abiertas se cruzan (la portería: la
  // del atrio y la de madera del vestíbulo, que se abren a la vez): la
  // simple pasa la bisagra a la otra jamba si ahí deja de cruzarse.
  const clashes = (d: DoorDef, L: LeafDef) => out.some((e) => e.leaves.some((M) => leavesClash(d, L, e, M)));
  for (const [d, alt] of alternatives) {
    if (clashes(d, d.leaves[0]) && !clashes(d, alt)) d.leaves = [alt];
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
