import { describe, it, expect } from 'vitest';
import {
  BABBLE_SYL_PER_S,
  estimateSpeechSeconds,
  hashText,
  pickSpanishVoice,
  planBabble,
  planLaugh,
  planTalker,
  seeded,
  speakerProfile,
  splitForTts,
  stressIndex,
  syllabify,
  textSyllables,
} from '../src/audio/speech';
import { CROWDS } from '../src/audio/synth';

/**
 * Habla: sílabas, duración y bla-bla. El director del juego usa la duración
 * para sincronizar los diálogos, así que tiene que ser coherente con lo que
 * de verdad suena.
 */
describe('sílabas del castellano', () => {
  const cases: Array<[string, string[]]> = [
    ['escuela', ['es', 'cue', 'la']],
    ['maestra', ['ma', 'es', 'tra']],
    ['país', ['pa', 'ís']],
    ['instrucción', ['ins', 'truc', 'ción']],
    ['biblioteca', ['bi', 'blio', 'te', 'ca']],
    ['chico', ['chi', 'co']],
    ['carro', ['ca', 'rro']],
    ['llave', ['lla', 've']],
    ['ahora', ['a', 'ho', 'ra']],
    ['Miguel', ['Mi', 'guel']],
    ['queso', ['que', 'so']],
    ['hoy', ['hoy']],
    ['y', ['y']],
    ['recreo', ['re', 'cre', 'o']],
    ['Cané', ['Ca', 'né']],
    ['guardapolvo', ['guar', 'da', 'pol', 'vo']],
    ['pingüino', ['pin', 'güi', 'no']],
    ['atlántico', ['a', 'tlán', 'ti', 'co']],
    ['compra', ['com', 'pra']],
    ['día', ['dí', 'a']],
  ];
  for (const [word, expected] of cases) {
    it(`${word} → ${expected.join('-')}`, () => {
      expect(syllabify(word)).toEqual(expected);
    });
  }

  it('acento: tilde, graves y agudas', () => {
    expect(stressIndex('escuela', syllabify('escuela'))).toBe(1);
    expect(stressIndex('Cané', syllabify('Cané'))).toBe(1);
    expect(stressIndex('reloj', syllabify('reloj'))).toBe(1);
    expect(stressIndex('árbol', syllabify('árbol'))).toBe(0);
  });

  it('marca preguntas, exclamaciones y pausas', () => {
    const s = textSyllables('Hola, chicos. ¿Cómo están? ¡Muy bien!');
    expect(s.length).toBe(10); // Ho-la chi-cos Có-mo es-tán Muy bien
    const hola = s.slice(0, 2);
    expect(hola[1].pause).toBeGreaterThan(0.2); // coma
    const como = s.filter((x) => x.sentence === 1);
    expect(como.every((x) => x.question)).toBe(true);
    const bien = s.filter((x) => x.sentence === 2);
    expect(bien.every((x) => x.exclaim)).toBe(true);
    expect(s[0].question || s[0].exclaim).toBe(false);
  });

  it('los números cuentan como varias sílabas', () => {
    expect(textSyllables('2050').length).toBeGreaterThanOrEqual(4);
  });
});

describe('duración de una línea', () => {
  it('vacía dura cero', () => {
    expect(estimateSpeechSeconds('')).toBe(0);
    expect(estimateSpeechSeconds('   ', 1, 'babble')).toBe(0);
  });

  it('crece con el texto y baja con la velocidad', () => {
    const short = estimateSpeechSeconds('Hola.');
    const long = estimateSpeechSeconds(
      'Hola, bienvenidos a la escuela. Hoy vamos a recorrer el edificio.',
    );
    expect(long).toBeGreaterThan(short);
    expect(estimateSpeechSeconds('Hola, bienvenidos a la escuela.', 2)).toBeLessThan(
      estimateSpeechSeconds('Hola, bienvenidos a la escuela.', 1),
    );
  });

  it('el bla-bla dura exactamente lo que su plan', () => {
    const text = '¿Viste la campana de bronce? Suena en cada recreo.';
    expect(estimateSpeechSeconds(text, 1.1, 'babble')).toBe(planBabble(text, 300, 1.1).duration);
  });

  it('una voz real (5–6 sílabas/s) es más lenta que el bla-bla', () => {
    const text = 'La escuela tiene un patio grande, un gimnasio y un jardín de infantes.';
    expect(estimateSpeechSeconds(text, 1, 'tts')).toBeGreaterThan(
      estimateSpeechSeconds(text, 1, 'babble'),
    );
  });
});

describe('bla-bla', () => {
  const text = 'Bueno, chicos, abran la carpeta en la página doce. ¿Quién empieza?';

  it('es determinista: la misma línea suena siempre igual', () => {
    expect(planBabble(text, 200)).toEqual(planBabble(text, 200));
    expect(hashText(text)).toBe(hashText(text));
  });

  it('las sílabas no se pisan y tienen el ritmo del bla-bla', () => {
    const { notes, duration } = planBabble(text, 200);
    for (let i = 1; i < notes.length; i++)
      expect(notes[i].t).toBeGreaterThanOrEqual(notes[i - 1].t + notes[i - 1].dur - 1e-9);
    const avg = notes.reduce((s, n) => s + n.dur, 0) / notes.length;
    expect(avg).toBeGreaterThan((1 / BABBLE_SYL_PER_S) * 0.8);
    expect(avg).toBeLessThan((1 / BABBLE_SYL_PER_S) * 1.3);
    expect(duration).toBeGreaterThan(notes[notes.length - 1].t);
  });

  it('la pregunta sube al final', () => {
    const { notes } = planBabble('¿Vamos al patio ahora?', 200);
    const last = notes[notes.length - 1];
    const firstHalf = notes.slice(0, notes.length / 2);
    const mean = firstHalf.reduce((s, n) => s + n.f0, 0) / firstHalf.length;
    expect(last.f0End).toBeGreaterThan(mean);
  });

  it('la altura sigue al hablante', () => {
    const kid = planBabble(text, 320).notes;
    const adult = planBabble(text, 120).notes;
    const avg = (n: typeof kid): number => n.reduce((s, x) => s + x.f0, 0) / n.length;
    expect(avg(kid)).toBeGreaterThan(avg(adult) * 2);
  });

  it('risa: varios "ja" que bajan', () => {
    const { notes } = planLaugh(300, seeded(4));
    expect(notes.length).toBeGreaterThanOrEqual(4);
    expect(notes[notes.length - 1].f0).toBeLessThan(notes[0].f0);
  });

  it('hablantes de la multitud: dentro del tiempo y sin superponerse', () => {
    const rnd = seeded(7);
    for (const kind of Object.keys(CROWDS) as Array<keyof typeof CROWDS>) {
      const notes = planTalker(10, CROWDS[kind], rnd);
      expect(notes.length).toBeGreaterThan(10);
      for (let i = 0; i < notes.length; i++) {
        expect(notes[i].t).toBeGreaterThanOrEqual(0);
        expect(notes[i].t + notes[i].dur).toBeLessThanOrEqual(10.2);
        expect(notes[i].amp).toBeLessThanOrEqual(1);
        if (i) expect(notes[i].t).toBeGreaterThanOrEqual(notes[i - 1].t + notes[i - 1].dur - 1e-9);
      }
    }
  });
});

describe('voces', () => {
  it('altura como factor o en Hz', () => {
    expect(speakerProfile({ pitch: 1 }).f0).toBe(180);
    expect(speakerProfile({ pitch: 1.5 }).f0).toBe(270);
    expect(speakerProfile({ pitch: 120 }).f0).toBe(120);
    expect(speakerProfile({ pitch: 0.7 }).gender).toBe('male');
    expect(speakerProfile({ pitch: 1.3 }).gender).toBe('female');
    expect(speakerProfile({ pitch: 1.3, gender: 'male' }).gender).toBe('male');
    expect(speakerProfile({ pitch: Number.NaN }).f0).toBe(180);
    const p = speakerProfile({ pitch: 3, rate: 9 });
    expect(p.ttsPitch).toBeLessThanOrEqual(2);
    expect(p.rate).toBeLessThanOrEqual(2);
  });

  it('elige la voz rioplatense, después América, después España', () => {
    const voices = [
      { lang: 'en-US', name: 'Google US English' },
      { lang: 'es-ES', name: 'Google español' },
      { lang: 'es-MX', name: 'Microsoft Sabina' },
      { lang: 'es-AR', name: 'Microsoft Tomas Online (Natural) - Spanish (Argentina)' },
      { lang: 'es-AR', name: 'Microsoft Elena Online (Natural) - Spanish (Argentina)' },
    ];
    expect(voices[pickSpanishVoice(voices, 'female')].name).toContain('Elena');
    expect(voices[pickSpanishVoice(voices, 'male')].name).toContain('Tomas');
    expect(voices[pickSpanishVoice(voices.slice(0, 3))].lang).toBe('es-MX');
    expect(voices[pickSpanishVoice([voices[0], voices[1]])].lang).toBe('es-ES');
    expect(pickSpanishVoice([voices[0]])).toBe(-1);
    expect(pickSpanishVoice([])).toBe(-1);
    expect(
      pickSpanishVoice([
        { lang: 'es_419', name: 'x' },
        { lang: 'es-ES', name: 'y' },
      ]),
    ).toBe(0);
  });

  it('corta los textos largos para la voz del navegador', () => {
    const long = 'Primera oración corta. ' + 'palabra '.repeat(60) + 'fin. Última.';
    const parts = splitForTts(long, 120);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(120);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long.trim().replace(/\s+/g, ' '));
  });
});
