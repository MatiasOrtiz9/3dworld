/**
 * Acústica de la escuela: qué ambiente sonoro y qué piso hay bajo los pies
 * en un punto del plano.
 *
 * Traduce los datos de `world/SchoolLayout` (ambientes, pisos, escaleras) al
 * vocabulario del audio (`AmbienceZone`, `Surface`), para que quien conecta
 * el juego sólo tenga que preguntar "¿dónde está el jugador?" y pasárselo al
 * `Soundscape`. Sólo lee el plano; no lo modifica.
 */

import type { AmbienceZone, Surface } from '../game/contracts';
import { surfaceForFloor } from './mix';
import {
  SCHOOL,
  STAIRS,
  U1,
  inLot,
  levelOf,
  roomAt,
  toLocal,
  type Level,
  type Room,
  type SchoolFrame,
  type Stair,
} from '../world/SchoolLayout';

export interface Acoustics {
  zone: AmbienceZone;
  surface: Surface;
  /** Ambiente del plano (null afuera o en un lugar sin nombre). */
  roomId: string | null;
  level: Level;
}

const KINDER = new Set([
  'salaAmarilla',
  'salaCeleste',
  'salaRosa',
  'salaRoja',
  'espacioMusica',
  'sum',
]);
const QUIET = new Set([
  'adm',
  'prof',
  'dirPrim',
  'dirSec',
  'secretaria',
  'recepcionOf',
  'biblioteca',
  'precepSec',
  'sala',
  'wcAdm',
  'sanitario',
  'vDamas',
  'salaNorte',
  'banosN',
  'banosS',
]);
const CLASS = new Set(['ep', 'tecnologia', 'arte', 'teatro', 'bilingue', 'salon']);
const QUIET_NAMES = /^(sanitarios|dirección|dir\.|preceptoría|secretaría|biblioteca|adm|prof)/i;
const CORRIDOR_NAMES = /^(pasillo|hall|galería|pasarela)/i;
const CORRIDOR_IDS = /^(pasillo|hall|rellano|galeria|pasarela|pasaje|nicho)/;

/**
 * Ambiente sonoro de un ambiente del plano. Primero los que tienen un sonido
 * propio inconfundible (gimnasio, comedor, jardín, escaleras), después por
 * uso (oficinas y baños callados, aulas) y al final la circulación.
 */
export function zoneForRoom(
  room: (Pick<Room, 'id' | 'name' | 'roofed'> & { caption?: string }) | null,
  insideLot: boolean,
): AmbienceZone {
  if (!room) return insideLot ? 'patio' : 'street';
  const { id, name } = room;
  if (!room.roofed) return 'patio';
  if (id === 'gimnasio') return 'gym';
  if (id === 'buffet') return 'cantina';
  if (KINDER.has(id) || id.startsWith('jardin'))
    return id === 'jardinEscalera' ? 'stair' : 'kindergarten';
  if (name === 'Escalera' || id.startsWith('escalera') || id === 'torreHall') return 'stair';
  if (
    QUIET.has(id) ||
    QUIET_NAMES.test(name) ||
    (/toilette/i.test(room.caption ?? '') && !CORRIDOR_NAMES.test(name))
  )
    return 'quiet';
  if (id.startsWith('aula') || CLASS.has(id) || name === 'Aula') return 'classroom';
  if (CORRIDOR_NAMES.test(name) || CORRIDOR_IDS.test(id)) return 'corridor';
  return 'corridor';
}

/**
 * ¿La escalera es de chapa? Las que tienen luz por debajo, las que están a
 * cielo abierto (las exteriores del patio) y la escalera en U del edificio de
 * bloque, que es de chapa semilla de melón aunque esté adentro.
 */
export function isMetalStair(s: Stair): boolean {
  if (s.hollow) return true;
  if (s.u0 >= U1.blockStair0 - 0.1 && s.u1 <= U1.blockStair2 + 0.1 && s.y0 >= 3.2) return true;
  const room = roomAt((s.u0 + s.u1) / 2, (s.v0 + s.v1) / 2, 0);
  return s.y0 < 0.1 && room !== null && !room.roofed;
}

/** Tramo de escalera bajo los pies (con los pies a `feetY` en el mundo), o null. */
export function stairAt(u: number, v: number, feetY: number): Stair | null {
  for (const s of STAIRS) {
    if (u < s.u0 || u > s.u1 || v < s.v0 || v > s.v1) continue;
    const y0 = SCHOOL.floorY + s.y0 - 0.3;
    const y1 = SCHOOL.floorY + s.y1 + 0.3;
    if (feetY >= y0 && feetY <= y1) return s;
  }
  return null;
}

/** Zona, superficie y ambiente en un punto del plano (u este, v sur) con los pies a `feetY`. */
export function acousticsAt(u: number, v: number, feetY: number): Acoustics {
  const level = levelOf(feetY);
  const stair = stairAt(u, v, feetY);
  if (stair) {
    return {
      zone: 'stair',
      surface: isMetalStair(stair) ? 'metal' : 'tile',
      roomId: roomAt(u, v, level)?.id ?? null,
      level,
    };
  }
  const room = roomAt(u, v, level);
  const inside = inLot(u, v);
  const zone = zoneForRoom(room, inside);
  // Afuera: vereda de cemento. En el predio sin ambiente: el solado del patio.
  const surface: Surface = room ? surfaceForFloor(room.floor) : 'concrete';
  return { zone, surface, roomId: room?.id ?? null, level };
}

/** Igual que `acousticsAt`, desde una posición del mundo. */
export function acousticsAtWorld(
  frame: SchoolFrame,
  x: number,
  z: number,
  feetY: number,
): Acoustics {
  const { u, v } = toLocal(frame, x, z);
  return acousticsAt(u, v, feetY);
}
