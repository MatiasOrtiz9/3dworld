import { GYM_MID, MEETING_POINT } from '../../world/SchoolLayout';
import type { CharacterDef, Cond } from './types';
import { ACT, actSpot } from './world';

/**
 * Personajes del Recorrido 40. Son FICTICIOS: nombre de pila y rol, nada
 * más. Cada uno tiene una personalidad que se nota en cómo habla (ver
 * `dialogues.ts`) y un lugar según el momento de la historia.
 */

/** Momento del acto final: todos van al polideportivo. */
const ACTO: Cond = (q) => q.done('c5.juli');
/** Simulacro en curso: los adultos esperan en el punto de encuentro. */
const SIMULACRO: Cond = (q) => q.done('c3.laura') && !q.done('c3.ines');

const [MX, MV] = MEETING_POINT;

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: 'lola',
    name: 'Lola',
    role: 'compañera · fotos del recorrido',
    color: '#ff8a5c',
    look: { role: 'studentSecondary', height: 1.62, hairStyle: 'ponytail', hair: '#3a2416', backpack: true, seed: 401 },
    voice: { pitch: 1.3, rate: 1.08 },
    stations: [
      { when: (q) => !q.done('p.portero'), at: { room: '', at: [39.2, 3.6] }, face: 'n', anim: 'wave' },
      { when: (q) => q.available('c5.palabras') || q.done('c5.palabras'), at: { room: 'gimnasio', at: [ACT.player.u, ACT.player.v - 1.1] }, face: 'e', anim: 'clap' },
      { at: { room: 'hall' }, follow: true },
    ],
    idle: ['¿Seguimos? Yo saco las fotos.', '¡Esta va para el recorrido!', 'Mirá ese detalle… ¡foto!'],
  },
  {
    id: 'ruben',
    name: 'Rubén',
    role: 'portero',
    color: '#5aa9e6',
    look: { role: 'staff', height: 1.76, hairStyle: 'short', hair: '#8a8a8a', glasses: true, seed: 402 },
    voice: { pitch: 0.8, rate: 0.95 },
    stations: [
      { when: ACTO, at: actSpot(4), face: 'e', anim: 'clap' },
      { when: SIMULACRO, at: { room: '', at: [MX + 1.6, MV + 2.4] }, face: 'n', anim: 'point' },
      { at: { room: 'hall', at: [37.45, -0.7] }, face: 's' },
    ],
    idle: ['De acá se ve toda Laprida.', 'Buen día, buen día…', 'Cualquier cosa, estoy en el portal.'],
  },
  {
    id: 'ines',
    name: 'Inés',
    role: 'directora',
    color: '#e8b64c',
    look: { role: 'teacher', height: 1.66, hairStyle: 'bun', hair: '#5b3a24', glasses: true, top: '#7a2e3b', bottom: '#2b2b33', seed: 403 },
    voice: { pitch: 1.0, rate: 0.96 },
    stations: [
      { when: ACTO, at: { room: 'gimnasio', at: [ACT.stage.u, ACT.stage.v] }, face: 'w', anim: 'talk' },
      { when: SIMULACRO, at: { room: '', at: [MX - 1.4, MV + 2.0] }, face: 'e', anim: 'idle' },
      { at: { room: 'hall', at: [36.7, -7.3] }, face: 's' },
    ],
    idle: ['La escuela se cuenta mejor caminándola.', 'Cuarenta años… ¡y seguimos aprendiendo!'],
  },
  {
    id: 'laura',
    name: 'Laura',
    role: 'maestra de primaria',
    color: '#7bc96f',
    look: { role: 'teacher', height: 1.63, hairStyle: 'long', hair: '#2b1d14', labCoat: true, seed: 404 },
    voice: { pitch: 1.15 },
    stations: [
      { when: ACTO, at: actSpot(3), face: 'e', anim: 'clap' },
      { when: SIMULACRO, at: { room: '', at: [MX + 0.2, MV + 3.0] }, face: 'n', anim: 'wave' },
      { at: { item: 'board', room: 'aula4' }, face: 'e' },
    ],
    idle: ['Pizarra blanca de un lado, pizarrón del otro: lo mejor de dos mundos.', '¡Shh! Que en el aula de al lado están en prueba.'],
  },
  {
    id: 'tomas',
    name: 'Abi',
    role: 'profe del Aula Maker',
    color: '#4c91d9',
    look: { role: 'teacher', height: 1.68, hairStyle: 'long', hair: '#1d1612', glasses: true, top: '#2f6db5', seed: 405 },
    voice: { pitch: 1.15, rate: 1.04 },
    stations: [
      { when: ACTO, at: actSpot(1), face: 'e', anim: 'clap' },
      { at: { item: 'hexTable', room: 'tecnologia', nth: 4 }, face: { item: 'hexTable', room: 'tecnologia', nth: 5 } },
    ],
    idle: ['Si no sale a la primera, mejor: aprendemos el doble.', 'Cuidado con la cortadora: siempre con la tapa cerrada.'],
  },
  {
    id: 'sofi',
    name: 'Sofi',
    role: 'profe de robótica',
    color: '#db769d',
    look: { role: 'teacher', height: 1.64, hairStyle: 'ponytail', hair: '#38251b', top: '#db769d', seed: 411 },
    voice: { pitch: 1.22, rate: 1.02 },
    stations: [
      { when: ACTO, at: actSpot(8), face: 'e', anim: 'clap' },
      { at: { item: 'hexTable', room: 'tecnologia', nth: 2 }, face: { item: 'hexTable', room: 'tecnologia', nth: 1 } },
    ],
    idle: ['Soy Sofi, profe de robótica. ¡Cuando quieras armamos una secuencia para el robot!', 'En robótica probamos, corregimos y volvemos a probar.'],
  },
  {
    id: 'graciela',
    name: 'Graciela',
    role: 'cantina',
    color: '#f29e4c',
    look: { role: 'staff', height: 1.6, hairStyle: 'bun', hair: '#6b4a2e', top: '#f4f1ea', seed: 406 },
    voice: { pitch: 1.1 },
    stations: [
      { when: ACTO, at: actSpot(5), face: 'e', anim: 'clap' },
      { at: { room: 'buffet', at: [30.75, -20.3] }, face: { item: 'buffetLine', room: 'buffet' } },
    ],
    idle: ['¡Hoy hay milanesas al horno!', 'Agua fresca para todos.'],
  },
  {
    id: 'martin',
    name: 'Martín',
    role: 'preceptor de secundaria',
    color: '#9b8cff',
    look: { role: 'teacher', height: 1.74, hairStyle: 'short', hair: '#23180f', top: '#3c4a5c', seed: 407 },
    voice: { pitch: 0.9 },
    stations: [
      { when: ACTO, at: actSpot(0), face: 'e', anim: 'clap' },
      { when: (q) => q.done('c1.campana') && !q.done('c1.martin'), at: { room: 'hall', at: [34.7, -7.8] }, face: 's', anim: 'wave' },
      { at: { room: 'precepSec', at: [9.0, -15.8] }, face: 'e' },
    ],
    idle: ['¿Tenés el Pasaporte 40 a mano?', 'La pasarela vidriada es lo más lindo del piso.'],
  },
  {
    id: 'ana',
    name: 'Ana',
    role: 'profe de danzas',
    color: '#ff6fb1',
    look: { role: 'teacher', height: 1.68, hairStyle: 'bun', hair: '#141010', top: '#1c1c22', bottom: '#1c1c22', seed: 408 },
    voice: { pitch: 1.2 },
    stations: [
      { when: ACTO, at: actSpot(2), face: 'e', anim: 'clap' },
      { when: (q) => q.done('c2.martin'), at: { room: 'aulaDanzas', at: [47.0, -8.2] }, face: 'w' },
      { at: { room: 'salon', at: [46.0, -16.4] }, face: 'e' },
    ],
    idle: ['Cinco, seis, siete, ocho…', 'El espejo no miente: ¡hombros abajo!'],
  },
  {
    id: 'caro',
    name: 'Caro',
    role: 'maestra del jardín',
    color: '#ffd34d',
    look: { role: 'teacher', height: 1.6, hairStyle: 'ponytail', hair: '#7a4a22', top: '#f2c14e', seed: 409 },
    voice: { pitch: 1.28, rate: 1.05 },
    stations: [
      { when: ACTO, at: actSpot(7), face: 'e', anim: 'clap' },
      { at: { room: 'jardinRecepcion', at: [63.2, -37.0] }, face: 's' },
    ],
    idle: ['¡Despacito por la escalera!', 'Las salas tienen nombre de color: así nadie se pierde.'],
  },
  {
    id: 'juli',
    name: 'Juli',
    role: 'profe de educación física',
    color: '#ff5252',
    look: { role: 'teacher', height: 1.7, hairStyle: 'ponytail', hair: '#2a1a12', top: '#d0262d', bottom: '#1d2b4f', seed: 410 },
    voice: { pitch: 1.08, rate: 1.06 },
    stations: [
      { when: (q) => q.done('c5.juli'), at: actSpot(6), face: 'e', anim: 'clap' },
      { at: { room: 'gimnasio', at: [57.6, GYM_MID - 2.4] }, face: 'e' },
    ],
    idle: ['¡Hidratación, equipo!', 'En handball nadie gana solo.'],
  },
];

export function character(id: string): CharacterDef | undefined {
  return CHARACTERS.find((c) => c.id === id);
}
