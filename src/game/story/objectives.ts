import { MEETING_POINT } from '../../world/SchoolLayout';
import type { ActivityId, ChapterDef, ChapterId, ObjectiveDef, RuleDef, StampId, ZoneId } from './types';
import { ACT } from './world';

/**
 * La historia como grafo de objetivos.
 *
 * Un objetivo está disponible cuando se cumplieron los que pide (`requires`)
 * y su condición (`when`). Se cumple por efectos (una conversación, una
 * actividad) o solo, si es llegar a un lugar o juntar cosas. El capítulo en
 * curso es el del primer objetivo principal disponible: así el capítulo
 * avanza solo y la historia no depende de un "estado" aparte que se pueda
 * desincronizar.
 *
 * Dentro de cada capítulo hay objetivos en paralelo (se hacen en cualquier
 * orden) y secundarios opcionales.
 */

export const CHAPTERS: readonly ChapterDef[] = [
  { id: 'prologo', kicker: 'Prólogo', title: 'Llegada a Laprida' },
  { id: 'c1', kicker: 'Capítulo 1', title: 'La planta baja' },
  { id: 'c2', kicker: 'Capítulo 2', title: 'El nivel secundario' },
  { id: 'c3', kicker: 'Capítulo 3', title: 'El simulacro' },
  { id: 'c4', kicker: 'Capítulo 4', title: 'El jardín' },
  { id: 'c5', kicker: 'Capítulo 5', title: 'El acto' },
  { id: 'fin', kicker: 'Epílogo', title: 'Recorrido 40 completo' },
];

export function chapter(id: ChapterId): ChapterDef {
  return CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[0];
}

export const STAMPS: Readonly<Record<StampId, { title: string; place: string }>> = {
  maker: { title: 'Aula Maker', place: 'Educabot' },
  cantina: { title: 'Cantina', place: 'PRO FOOD' },
  patio: { title: 'Espacio recreativo', place: 'Punto limpio' },
  trofeos: { title: 'Trofeos', place: 'Trivia' },
  danza: { title: 'Danzas', place: 'Segundo piso' },
  simulacro: { title: 'Simulacro', place: 'Punto de encuentro' },
  jardin: { title: 'Jardín', place: 'CIMPID' },
  polideportivo: { title: 'Polideportivo', place: 'Handball' },
};

export const STAMP_ORDER: readonly StampId[] = ['maker', 'cantina', 'patio', 'trofeos', 'danza', 'simulacro', 'jardin', 'polideportivo'];

/** Qué objetivo cumple cada actividad al terminarla bien (y la marca de "perfecto"). */
export const ACTIVITY_REWARDS: Readonly<Record<ActivityId, { objective: string; title: string }>> = {
  robot: { objective: 'c1.maker', title: 'Robot Educabot' },
  menu: { objective: 'c1.cantina', title: 'Bandeja del día' },
  reciclaje: { objective: 'c1.patio', title: 'Punto limpio' },
  trivia: { objective: 'c2.trivia', title: 'Trivia de los trofeos' },
  danza: { objective: 'c2.danza', title: 'Coreografía' },
  penales: { objective: 'c5.juli', title: 'Penales de handball' },
};

export const ZONES: Readonly<Record<ZoneId, string>> = {
  entrada: 'Recepción',
  primerPiso: 'Primer piso · Nivel secundario',
  segundoPiso: 'Segundo piso · Aula de danzas',
  jardin: 'Jardín de infantes CIMPID',
};

export const ITEMS_INFO: Readonly<Record<string, { title: string; text: string }>> = {
  pasaporte: { title: 'Pasaporte 40', text: 'Un sello por cada sector del recorrido.' },
  llavero: { title: 'Llavero del 40', text: 'Impreso en la impresora 3D del Aula Maker.' },
  camara: { title: 'La cámara de Lola', text: 'Encontrada en su locker. ¡Cien fotos del recorrido!' },
};

export const OBJECTIVES: readonly ObjectiveDef[] = [
  // ------------------------------------------------------------------ prólogo
  {
    id: 'p.portero',
    chapter: 'prologo',
    title: 'Hablá con Rubén, el portero',
    silentTitle: 'Saludá a Rubén, el portero',
    hint: 'Está en el portal, sobre Laprida.',
    target: { kind: 'talk', npc: 'ruben' },
  },
  {
    id: 'p.hall',
    chapter: 'prologo',
    title: 'Entrá a Recepción',
    hint: 'Por las puertas vidriadas del portal.',
    requires: ['p.portero'],
    target: { kind: 'reach', place: 'hall' },
  },
  {
    id: 'p.mural',
    chapter: 'prologo',
    title: 'Leé el lema del mural de San Martín',
    hint: 'En el muro oeste de Recepción.',
    requires: ['p.hall'],
    target: { kind: 'interact', id: 'mural' },
  },
  {
    id: 'p.directora',
    chapter: 'prologo',
    title: 'Hablá con Inés, la directora',
    silentTitle: 'Saludá a Inés, la directora',
    hint: 'Te espera en Recepción.',
    requires: ['p.mural'],
    target: { kind: 'talk', npc: 'ines' },
  },

  // --------------------------------------------------------------- capítulo 1
  {
    id: 'c1.maker',
    chapter: 'c1',
    title: 'Programá el robot Educabot',
    hint: 'Aula Maker: al fondo del pasillo norte, con la Profe Abi.',
    requires: ['p.directora'],
    target: { kind: 'talk', npc: 'tomas' },
    onComplete: [{ do: 'stamp', id: 'maker' }],
  },
  {
    id: 'c1.cantina',
    chapter: 'c1',
    title: 'Armá la bandeja del día con Graciela',
    hint: 'Cantina | Comedor, junto al Espacio recreativo.',
    requires: ['p.directora'],
    target: { kind: 'talk', npc: 'graciela' },
    onComplete: [{ do: 'stamp', id: 'cantina' }],
  },
  {
    id: 'c1.patio',
    chapter: 'c1',
    title: 'Separá los residuos en el punto limpio',
    hint: 'Espacio recreativo: contra el muro del pasillo sur, cerca de la palmera.',
    requires: ['p.directora'],
    target: { kind: 'interact', id: 'puntoLimpio' },
    onComplete: [{ do: 'stamp', id: 'patio' }],
  },
  {
    id: 'c1.campana',
    chapter: 'c1',
    title: 'Tocá la campana del recreo',
    hint: 'Cuelga de una columna de la galería, en el Espacio recreativo.',
    requires: ['c1.maker', 'c1.cantina', 'c1.patio'],
    target: { kind: 'interact', id: 'campana' },
    onComplete: [
      { do: 'phase', phase: 'recreo' },
      { do: 'script', id: 'recreo' },
    ],
  },
  {
    id: 'c1.martin',
    chapter: 'c1',
    title: 'Hablá con Martín, el preceptor',
    silentTitle: 'Saludá a Martín, el preceptor',
    hint: 'Bajó al pie de la escalera del hall.',
    requires: ['c1.campana'],
    target: { kind: 'talk', npc: 'martin' },
  },
  {
    id: 's.llavero',
    chapter: 'c1',
    optional: true,
    title: 'Imprimí el llavero del 40',
    hint: 'Impresora 3D del Aula Maker.',
    requires: ['c1.maker'],
    target: { kind: 'interact', id: 'impresora' },
  },

  // --------------------------------------------------------------- capítulo 2
  {
    id: 'c2.trivia',
    chapter: 'c2',
    title: 'Probá la trivia de Lola en la vitrina de los trofeos',
    hint: 'Primer piso: subí por el «Acceso al Nivel Secundario».',
    requires: ['c1.martin'],
    target: { kind: 'interact', id: 'vitrina' },
    onComplete: [{ do: 'stamp', id: 'trofeos' }],
  },
  {
    id: 'c2.martin',
    chapter: 'c2',
    title: 'Pasá por la Preceptoría de secundaria',
    hint: 'Ala oeste del primer piso.',
    requires: ['c1.martin'],
    target: { kind: 'talk', npc: 'martin' },
  },
  {
    id: 'c2.danza',
    chapter: 'c2',
    title: 'Aprendé la coreografía con la Profe Ana',
    hint: 'Aula de danzas, segundo piso: escalera de chapa del edificio de bloque.',
    requires: ['c2.martin'],
    target: { kind: 'talk', npc: 'ana' },
    onComplete: [{ do: 'stamp', id: 'danza' }],
  },
  {
    id: 's.camara',
    chapter: 'c2',
    optional: true,
    title: 'Encontrá la cámara de Lola',
    hint: 'En su locker, en el pasillo de los lockers del primer piso.',
    requires: ['c1.martin'],
    target: { kind: 'interact', id: 'lockerLola' },
  },

  // --------------------------------------------------------------- capítulo 3
  {
    id: 'c3.laura',
    chapter: 'c3',
    title: 'La Seño Laura te espera para el simulacro',
    hint: 'Aula de primaria, sobre Laprida.',
    requires: ['c2.trivia', 'c2.danza'],
    target: { kind: 'talk', npc: 'laura' },
  },
  {
    id: 'c3.evacuar',
    chapter: 'c3',
    title: 'Seguí las flechas verdes hasta el punto de encuentro',
    hint: 'Caminando, sin correr: esquina de Laprida y Miguel Cané.',
    requires: ['c3.laura'],
    target: { kind: 'spot', anchor: { room: '', at: [MEETING_POINT[0], MEETING_POINT[1]] }, radius: 3.6 },
    onComplete: [
      { do: 'stamp', id: 'simulacro' },
      { do: 'script', id: 'simulacroFin' },
    ],
  },
  {
    id: 'c3.ines',
    chapter: 'c3',
    title: 'Hablá con Inés en el punto de encuentro',
    silentTitle: 'Saludá a Inés en el punto de encuentro',
    requires: ['c3.evacuar'],
    target: { kind: 'talk', npc: 'ines' },
  },

  // --------------------------------------------------------------- capítulo 4
  {
    id: 'c4.caro',
    chapter: 'c4',
    title: 'Visitá a la Seño Caro en el jardín',
    hint: 'Por la puerta del pasillo del gimnasio, la del cartel del jardín.',
    requires: ['c3.ines'],
    target: { kind: 'talk', npc: 'caro' },
  },
  {
    id: 'c4.estrellas',
    chapter: 'c4',
    title: 'Encontrá las tres estrellas de las salas',
    hint: 'Sala Amarilla (planta baja), Sala Rosa y Sala Roja (primer piso).',
    requires: ['c4.caro'],
    target: { kind: 'collect', ids: ['estrellaAmarilla', 'estrellaRosa', 'estrellaRoja'] },
  },
  {
    id: 'c4.volver',
    chapter: 'c4',
    title: 'Llevale las estrellas a la Seño Caro',
    requires: ['c4.estrellas'],
    target: { kind: 'talk', npc: 'caro' },
    onComplete: [{ do: 'stamp', id: 'jardin' }],
  },
  {
    id: 's.musica',
    chapter: 'c4',
    optional: true,
    title: 'Banda sonora: tocá el piano y la batería',
    hint: 'Piano del Salón de los espejos; batería del Espacio de música del jardín.',
    requires: ['c3.ines'],
    target: { kind: 'collect', ids: ['piano', 'bateria'] },
  },

  // --------------------------------------------------------------- capítulo 5
  {
    id: 'c5.juli',
    chapter: 'c5',
    title: 'Lanzá los penales con la Profe Juli',
    hint: 'Polideportivo.',
    requires: ['c4.volver'],
    target: { kind: 'talk', npc: 'juli' },
    onComplete: [{ do: 'stamp', id: 'polideportivo' }, { do: 'phase', phase: 'acto' }],
  },
  {
    id: 'c5.acto',
    chapter: 'c5',
    title: 'Ocupá tu lugar para el acto',
    hint: 'El círculo dorado, frente a la bandera del escudo.',
    requires: ['c5.juli'],
    target: { kind: 'spot', anchor: { room: 'gimnasio', at: [ACT.player.u, ACT.player.v] }, radius: 1.6 },
    onComplete: [{ do: 'script', id: 'acto' }],
  },
  {
    id: 'c5.palabras',
    chapter: 'c5',
    title: 'Decí unas palabras en el acto',
    silentTitle: 'Acompañá a Inés en el escenario',
    requires: ['c5.acto'],
    target: { kind: 'talk', npc: 'ines' },
  },

  // ------------------------------------------------------------- secundarios
  {
    id: 's.voces',
    chapter: 'c1',
    optional: true,
    title: 'Voces del recorrido: entrevistá a 4 personas',
    hint: 'Preguntales a quienes ya te ayudaron.',
    // Las respuestas de las entrevistas son frases: sin ellas no hay qué juntar.
    phrases: true,
    requires: ['p.directora'],
    target: { kind: 'collect', ids: ['voz:1', 'voz:2', 'voz:3', 'voz:4'] },
  },
];

export function objective(id: string): ObjectiveDef | undefined {
  return OBJECTIVES.find((o) => o.id === id);
}

export const RULES: readonly RuleDef[] = [
  {
    id: 'r.tresSellos',
    when: (q) => q.done('c1.maker') && q.done('c1.cantina') && q.done('c1.patio'),
    effects: [
      { do: 'toast', title: '¡Tres sellos!', text: 'La planta baja está recorrida.' },
    ],
  },
  {
    id: 'r.simulacro',
    when: (q) => q.done('c2.trivia') && q.done('c2.danza'),
    effects: [
      { do: 'toast', title: 'Nivel secundario recorrido', text: 'La Seño Laura te espera en su aula de primaria.' },
    ],
  },
  {
    id: 'r.fin',
    when: (q) => q.done('c5.palabras'),
    effects: [
      { do: 'flag', id: 'fin' },
      { do: 'unlock', zone: 'entrada' },
      { do: 'unlock', zone: 'primerPiso' },
      { do: 'unlock', zone: 'segundoPiso' },
      { do: 'unlock', zone: 'jardin' },
      { do: 'script', id: 'creditos' },
    ],
  },
  {
    id: 'r.cronista',
    when: (q) => q.interviews >= 4,
    effects: [{ do: 'toast', title: 'Insignia: Cronista', text: 'Cuatro voces para el Recorrido 40.' }],
  },
  {
    id: 'r.explorador',
    when: (q) => q.places >= 24,
    effects: [{ do: 'toast', title: 'Insignia: Explorador', text: 'Conocés la escuela de punta a punta.' }],
  },
];
