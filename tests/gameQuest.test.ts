import { describe, expect, it } from 'vitest';
import { DialogueRunner, StoryEngine } from '../src/game/story/StoryEngine';
import { emptySave, memorySaveStore, parseSave } from '../src/game/story/save';
import { dialogue } from '../src/game/story/dialogues';
import { LOCKS } from '../src/game/story/world';
import { focusByGaze, focusByRay, type Candidate } from '../src/game/Interaction';
import { zoneForRoom } from '../src/game/audioZones';
import type { Effect } from '../src/game/story/types';

/**
 * Máquina de estados de la historia: disponibilidad de objetivos, capítulos,
 * reglas que disparan una sola vez, cerraduras, guardado y carga.
 */

/** Recorre un diálogo eligiendo siempre `pick` (o la primera opción). */
function talk(e: StoryEngine, npc: string, pick = 0): Effect[] {
  const d = e.dialogueFor(npc);
  if (!d) return [];
  const r = new DialogueRunner(d, e);
  const out = e.apply(r.start());
  for (let g = 0; g < 40 && !r.done; g++) out.push(...e.apply(r.step(pick)));
  return out;
}

describe('motor de la historia', () => {
  it('empieza en el prólogo con un solo objetivo: hablar con Rubén', () => {
    const e = new StoryEngine();
    expect(e.currentChapter()).toBe('prologo');
    expect(e.mainObjectives().map((o) => o.id)).toEqual(['p.portero']);
    expect(e.dialogueFor('ruben')?.id).toBe('ruben.intro');
    // Inés todavía no da la misión: pide primero mirar el mural.
    expect(e.dialogueFor('ines')?.id).toBe('ines.mural');
  });

  it('hablar con Rubén abre la entrada y desbloquea el siguiente paso', () => {
    const e = new StoryEngine();
    const fx = talk(e, 'ruben');
    expect(fx.some((f) => f.do === 'unlock' && f.zone === 'entrada')).toBe(true);
    expect(e.zone('entrada')).toBe(true);
    expect(e.done('p.portero')).toBe(true);
    expect(e.mainObjectives().map((o) => o.id)).toEqual(['p.hall']);
    // Un objetivo no se cumple dos veces ni fuera de orden.
    expect(e.apply([{ do: 'complete', id: 'p.portero' }])).toEqual([]);
    expect(e.apply([{ do: 'complete', id: 'p.directora' }])).toEqual([]);
  });

  it('llegar a un lugar lo descubre y cumple el objetivo de "entrar"', () => {
    const e = new StoryEngine();
    talk(e, 'ruben');
    const fx = e.enterPlace('hall');
    expect(fx[0]).toEqual({ do: 'discover', place: 'hall' });
    expect(e.done('p.hall')).toBe(true);
    // Volver a entrar no repite el descubrimiento.
    expect(e.enterPlace('hall').some((f) => f.do === 'discover')).toBe(false);
    expect(e.enterPlace('lugarInexistente')).toEqual([]);
  });

  it('los objetos con actividad no cumplen su objetivo al tocarlos, sí al terminarla bien', () => {
    const e = new StoryEngine();
    talk(e, 'ruben');
    e.enterPlace('hall');
    e.interact('mural');
    talk(e, 'ines');
    expect(e.currentChapter()).toBe('c1');
    e.interact('puntoLimpio');
    expect(e.done('c1.patio')).toBe(false);
    e.activityResult('reciclaje', false);
    expect(e.done('c1.patio')).toBe(false);
    const fx = e.activityResult('reciclaje', true, true);
    expect(e.done('c1.patio')).toBe(true);
    expect(e.flag('perfecto:reciclaje')).toBe(true);
    expect(fx.some((f) => f.do === 'stamp' && f.id === 'patio')).toBe(true);
  });

  it('la regla de los tres sellos dispara una sola vez y habilita la campana', () => {
    const e = new StoryEngine();
    talk(e, 'ruben');
    e.enterPlace('hall');
    e.interact('mural');
    talk(e, 'ines');
    e.activityResult('robot', true);
    e.activityResult('menu', true);
    expect(e.available('c1.campana')).toBe(false);
    const fx = e.activityResult('reciclaje', true);
    expect(fx.filter((f) => f.do === 'toast' && f.title === '¡Tres sellos!')).toHaveLength(1);
    expect(e.available('c1.campana')).toBe(true);
    expect(e.data.rules).toContain('r.tresSellos');
    // Más cambios no vuelven a disparar la regla.
    expect(e.interact('palmera').some((f) => f.do === 'toast' && f.title === '¡Tres sellos!')).toBe(false);
    // La campana: recreo y el preceptor baja.
    const bell = e.interact('campana');
    expect(bell.some((f) => f.do === 'phase' && f.phase === 'recreo')).toBe(true);
    expect(bell.some((f) => f.do === 'script' && f.id === 'recreo')).toBe(true);
    expect(e.stationFor('martin')?.at).toEqual({ room: 'hall', at: [34.7, -7.8] });
  });

  it('los objetos que todavía no están listos no hacen nada', () => {
    const e = new StoryEngine();
    expect(e.interact('impresora')).toEqual([]);
    expect(e.item('llavero')).toBe(false);
    // Las estrellas no existen hasta hablar con la seño Caro.
    expect(e.interact('estrellaAmarilla')).toEqual([]);
  });

  it('las entrevistas se guardan una vez por persona y cuentan para "Voces del recorrido"', () => {
    const e = new StoryEngine();
    talk(e, 'ruben');
    e.enterPlace('hall');
    e.interact('mural');
    talk(e, 'ines');
    expect(e.available('s.voces')).toBe(true);
    const d = dialogue('ruben.after')!;
    const r = new DialogueRunner(d, e);
    e.apply(r.start());
    expect(r.choices().map((c) => c.text)[0]).toContain('pregunta');
    e.apply(r.step(0));
    e.apply(r.step(1));
    expect(e.interviewed('ruben')).toBe(true);
    expect(e.flag('got:voz:1')).toBe(true);
    // Ya entrevistado: la opción desaparece y la despedida sola no se muestra.
    const again = new DialogueRunner(d, e);
    expect(again.choices()).toEqual([]);
  });

  it('modo libre: abre todas las zonas sin tocar el progreso', () => {
    const e = new StoryEngine();
    e.openAll();
    for (const z of ['entrada', 'primerPiso', 'segundoPiso', 'jardin'] as const) expect(e.zone(z)).toBe(true);
    expect(e.data.done).toEqual([]);
    expect(e.currentChapter()).toBe('prologo');
  });

  it('cada zona cerrada tiene al menos una cerradura', () => {
    for (const z of ['entrada', 'primerPiso', 'segundoPiso', 'jardin']) {
      expect(LOCKS.some((l) => l.zone === z), z).toBe(true);
    }
  });
});

describe('guardado', () => {
  it('se guarda y se recupera igual', () => {
    const e = new StoryEngine();
    talk(e, 'ruben');
    e.enterPlace('hall');
    e.tick(42);
    const store = memorySaveStore();
    store.write(e.serialize());
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    const e2 = new StoryEngine(loaded);
    expect(e2.done('p.portero')).toBe(true);
    expect(e2.zone('entrada')).toBe(true);
    expect(e2.discovered('hall')).toBe(true);
    expect(e2.data.seconds).toBe(42);
    expect(e2.currentChapter()).toBe(e.currentChapter());
    // El estado del motor es una copia: cambiar uno no cambia el otro.
    e2.interact('mural');
    expect(e.done('p.mural')).toBe(false);
  });

  it('un guardado roto o de otra versión no traba el juego', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('no es json')).toBeNull();
    expect(parseSave('{"v":2}')).toBeNull();
    expect(parseSave('[1,2]')).toBeNull();
    const weird = parseSave('{"v":1,"done":["p.portero",3,null],"interviews":{"ruben":"hola","x":5},"seconds":"mucho"}');
    expect(weird?.done).toEqual(['p.portero']);
    expect(weird?.interviews).toEqual({ ruben: 'hola' });
    expect(weird?.seconds).toBe(0);
    expect(new StoryEngine(weird).done('p.portero')).toBe(true);
  });

  it('reiniciar deja una partida vacía', () => {
    const store = memorySaveStore();
    store.write({ ...emptySave(), done: ['p.portero'] });
    store.clear();
    expect(store.load()).toBeNull();
    expect(new StoryEngine(store.load()).currentChapter()).toBe('prologo');
  });
});

describe('interacción y sonido', () => {
  const c = (key: string, x: number, z: number, extra: Partial<Candidate> = {}): Candidate => ({ key, x, y: 1.4, z, radius: 0.35, range: 2.6, baseY: 0.12, ...extra });

  it('la mirada elige lo que está adelante y al alcance', () => {
    const feet = { x: 0, y: 0.12, z: 0 };
    const eye = { x: 0, y: 1.8, z: 0 };
    const fwd = { x: 0, y: 0, z: 1 };
    const list = [c('a', 0, 2), c('b', 1.5, 1.5), c('lejos', 0, 6), c('atras', 0, -1.5)];
    expect(focusByGaze(list, eye, fwd, feet)?.key).toBe('a');
    expect(focusByGaze([c('lejos', 0, 6)], eye, fwd, feet)).toBeNull();
    expect(focusByGaze([c('atras', 0, -1.6)], eye, fwd, feet)).toBeNull();
    // Otro piso: no.
    expect(focusByGaze([c('arriba', 0, 2, { baseY: 3.42, y: 4.7 })], eye, fwd, feet)).toBeNull();
    // Tapado por un muro: no.
    expect(focusByGaze([c('a', 0, 2)], eye, fwd, feet, () => true)).toBeNull();
  });

  it('el rayo del control elige lo que apunta', () => {
    const feet = { x: 0, y: 0.12, z: 0 };
    const origin = { x: 0.2, y: 1.2, z: 0 };
    const list = [c('izq', -1, 2), c('der', 1, 2)];
    expect(focusByRay(list, origin, { x: 0.4, y: 0.1, z: 1 }, feet)?.key).toBe('der');
    expect(focusByRay(list, origin, { x: -0.6, y: 0.1, z: 1 }, feet)?.key).toBe('izq');
    expect(focusByRay(list, origin, { x: 0, y: 1, z: 0 }, feet)).toBeNull();
  });

  it('cada ambiente tiene una zona de sonido coherente', () => {
    expect(zoneForRoom('')).toBe('street');
    expect(zoneForRoom('gimnasio')).toBe('gym');
    expect(zoneForRoom('buffet')).toBe('cantina');
    expect(zoneForRoom('patioOeste', false)).toBe('patio');
    expect(zoneForRoom('pasilloSur')).toBe('corridor');
    expect(zoneForRoom('salaRosa')).toBe('kindergarten');
    expect(zoneForRoom('aula3')).toBe('classroom');
    expect(zoneForRoom('biblioteca')).toBe('quiet');
    expect(zoneForRoom('torreHall')).toBe('stair');
  });
});
