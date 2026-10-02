import { roomAt, levelOf, toLocal, type Floor, type SchoolFrame } from '../world/SchoolLayout';
import type { AmbienceZone, Surface, WorldPoint } from './contracts';
import { isJardinRoom } from './story/world';

/**
 * De dónde está el jugador a qué suena: el ambiente sonoro de la zona y la
 * superficie bajo los pies. Puro (sin audio): lo usa el director para
 * `AudioApi.setZone` y `main.ts` puede usar `surfaceAt` para los pasos.
 */

/** Zona sonora de un ambiente del plano ('' = afuera). */
export function zoneForRoom(roomId: string, roofed = true): AmbienceZone {
  if (!roomId) return 'street';
  if (isJardinRoom(roomId)) return 'kindergarten';
  if (roomId === 'gimnasio') return 'gym';
  if (roomId === 'buffet') return 'cantina';
  if (!roofed || roomId === 'patioOeste' || roomId === 'patioEste') return 'patio';
  if (/escalera|torreHall/i.test(roomId)) return 'stair';
  if (/^pasillo|^hall|galeria|pasarela|rellano|pasaje/i.test(roomId)) return 'corridor';
  if (/biblioteca|dirPrim|dirSec|secretaria|adm|prof|precep|sala$|recepcionOf/i.test(roomId)) return 'quiet';
  return 'classroom';
}

const SURFACE: Partial<Record<Floor, Surface>> = {
  tile: 'tile',
  wood: 'wood',
  gym: 'rubber',
  green: 'rubber',
  patio: 'concrete',
  dark: 'rubber',
  checker: 'tile',
  ceramic: 'tile',
  rubber: 'rubber',
  terracotta: 'tile',
  hallStone: 'tile',
  dance: 'wood',
};

/** Superficie bajo los pies (para el sonido de los pasos). */
export function surfaceAt(frame: SchoolFrame, feet: WorldPoint): Surface {
  const { u, v } = toLocal(frame, feet.x, feet.z);
  const room = roomAt(u, v, levelOf(feet.y));
  if (!room) return 'concrete';
  // Las escaleras de chapa suenan a metal.
  if (room.caption === 'Acceso a segundo piso') return 'metal';
  return SURFACE[room.floor] ?? 'tile';
}
