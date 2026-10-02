/**
 * Habla: sílabas del castellano, duración estimada y el "bla-bla" de los
 * personajes.
 *
 * Datos y funciones puras, sin Web Audio: así se prueban en milisegundos y el
 * director del juego puede preguntar cuánto dura una línea aunque no haya
 * audio (navegador sin sonido, pruebas, silenciado).
 *
 * El bla-bla no es ruido al azar: sale de las sílabas reales del texto. Cada
 * sílaba conserva su vocal (que da el color del sonido), el tipo de consonante
 * con que empieza y si lleva el acento. Por eso una pregunta sube al final,
 * una exclamación suena más alta y la misma línea suena siempre igual: el oído
 * le cree a ese ritmo aunque no entienda ninguna palabra.
 */

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';
/** Cómo arranca la sílaba: sin consonante, oclusiva, fricativa, nasal o líquida. */
export type Onset = 'none' | 'stop' | 'fric' | 'nasal' | 'liquid';

export interface Syl {
  text: string;
  vowel: Vowel;
  onset: Onset;
  /** Termina en consonante (sílaba trabada, un poco más larga). */
  coda: boolean;
  stressed: boolean;
  /** Pausa después de la sílaba, en segundos a velocidad 1. */
  pause: number;
  /** Índice de oración, para la entonación. */
  sentence: number;
  question: boolean;
  exclaim: boolean;
}

// ====================================================================== sílabas

const STRONG = new Set(['a', 'e', 'o', 'á', 'é', 'ó']);
const ACC_WEAK = new Set(['í', 'ú']);
const VOWEL_CHARS = new Set(['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü']);
const ACCENTED = new Set(['á', 'é', 'í', 'ó', 'ú']);
/** Grupos que no se separan: "pla-ya", "tra-bajo", "a-tlán-ti-co" (en América). */
const LIQ_FIRST = new Set(['p', 'b', 'f', 'c', 'g', 't', 'd', 'k']);

interface Unit {
  s: number;
  e: number;
  vowel: boolean;
  ch: string;
}

const isVowelChar = (c: string | undefined): boolean => c !== undefined && VOWEL_CHARS.has(c);

/** Letras de la palabra agrupadas en sonidos: "ch", "ll", "rr", "qu", "gu" cuentan como uno. */
function units(w: string): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  while (i < w.length) {
    const c = w[i];
    const n = w[i + 1];
    const nn = w[i + 2];
    if ((c === 'c' && n === 'h') || (c === 'l' && n === 'l') || (c === 'r' && n === 'r')) {
      out.push({ s: i, e: i + 2, vowel: false, ch: c + n });
      i += 2;
      continue;
    }
    // La "u" de "que/qui" y de "gue/gui" no suena: es parte de la consonante.
    if (
      (c === 'q' && n === 'u') ||
      (c === 'g' && n === 'u' && (nn === 'e' || nn === 'i' || nn === 'é' || nn === 'í'))
    ) {
      out.push({ s: i, e: i + 2, vowel: false, ch: c + 'u' });
      i += 2;
      continue;
    }
    if (c === 'y') {
      // "y" es vocal cuando no la sigue una vocal: "hoy", "muy", "y".
      const vowel = !isVowelChar(n);
      out.push({ s: i, e: i + 1, vowel, ch: vowel ? 'i' : 'y' });
      i += 1;
      continue;
    }
    out.push({ s: i, e: i + 1, vowel: VOWEL_CHARS.has(c), ch: c });
    i += 1;
  }
  return out;
}

/** ¿Dos vocales seguidas van en sílabas distintas (hiato)? */
function hiatus(a: string, b: string): boolean {
  if (STRONG.has(a) && STRONG.has(b)) return true; // "ma-es-tra", "re-cre-o"
  if (ACC_WEAK.has(a) || ACC_WEAK.has(b)) return true; // "pa-ís", "dí-a"
  return a === b; // "chi-i-ta"
}

function inseparable(a: string, b: string): boolean {
  return (b === 'l' || b === 'r') && LIQ_FIRST.has(a) && !(a === 'd' && b === 'l');
}

/**
 * Separa una palabra en sílabas con las reglas ortográficas del castellano:
 * diptongos y hiatos, grupos inseparables ("tr", "bl"…) y dígrafos ("ch",
 * "ll", "rr", "qu"). Devuelve los trozos de la palabra original.
 */
export function syllabify(word: string): string[] {
  const w = word.toLowerCase();
  const us = units(w);
  // Núcleos: corridas de vocales partidas por los hiatos.
  const nuclei: Array<[number, number]> = []; // índices de unidad [desde, hasta]
  for (let k = 0; k < us.length; k++) {
    if (!us[k].vowel) continue;
    const last = nuclei[nuclei.length - 1];
    if (last && last[1] === k - 1 && !hiatus(us[k - 1].ch, us[k].ch)) last[1] = k;
    else nuclei.push([k, k]);
  }
  if (nuclei.length <= 1) return [word];
  // Corte entre núcleos según cuántas consonantes hay en el medio.
  const cuts: number[] = []; // índice de unidad donde arranca cada sílaba (salvo la primera)
  for (let n = 0; n < nuclei.length - 1; n++) {
    const a = nuclei[n][1] + 1;
    const b = nuclei[n + 1][0];
    const count = b - a;
    let cut: number;
    if (count <= 1) cut = a;
    else if (count === 2) cut = inseparable(us[a].ch, us[a + 1].ch) ? a : a + 1;
    else if (count === 3) cut = inseparable(us[a + 1].ch, us[a + 2].ch) ? a + 1 : a + 2;
    else cut = a + 2;
    cuts.push(cut);
  }
  const out: string[] = [];
  let from = 0;
  for (const c of cuts) {
    const s = us[from].s;
    const e = us[c].s;
    out.push(word.slice(s, e));
    from = c;
  }
  out.push(word.slice(us[from].s));
  return out;
}

/** Sílaba tónica: la de la tilde o, si no hay, la regla de graves y agudas. */
export function stressIndex(word: string, syllables: readonly string[]): number {
  for (let i = 0; i < syllables.length; i++) {
    for (const ch of syllables[i].toLowerCase()) if (ACCENTED.has(ch)) return i;
  }
  if (syllables.length < 2) return 0;
  const last = word.toLowerCase().slice(-1);
  return isVowelChar(last) || last === 'n' || last === 's'
    ? syllables.length - 2
    : syllables.length - 1;
}

const PLAIN: Record<string, Vowel> = {
  a: 'a',
  á: 'a',
  e: 'e',
  é: 'e',
  i: 'i',
  í: 'i',
  o: 'o',
  ó: 'o',
  u: 'u',
  ú: 'u',
  ü: 'u',
  y: 'i',
};

function vowelOf(syl: string): Vowel {
  const s = syl.toLowerCase();
  // La vocal abierta manda en un diptongo ("cue" suena a "e"); si no hay, la última.
  let found: Vowel | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (STRONG.has(c)) return PLAIN[c];
    if (VOWEL_CHARS.has(c) || (c === 'y' && i === s.length - 1)) found = PLAIN[c];
  }
  return found ?? 'e';
}

function onsetOf(syl: string): Onset {
  const s = syl.toLowerCase();
  const c = s[0];
  const n = s[1];
  if (s === 'y') return 'none'; // la conjunción "y" es una vocal sola
  if (c === undefined || isVowelChar(c) || c === 'h')
    return c === 'h' && n !== undefined && !isVowelChar(n) ? 'stop' : 'none';
  if (c === 'm' || c === 'n' || c === 'ñ') return 'nasal';
  if (c === 'l' || c === 'r') return n === 'l' ? 'fric' : 'liquid'; // "ll" rioplatense suena "sh"
  if (c === 's' || c === 'z' || c === 'f' || c === 'j' || c === 'x' || c === 'y') return 'fric';
  if (c === 'c')
    return n === 'h' || n === 'e' || n === 'i' || n === 'é' || n === 'í' ? 'fric' : 'stop';
  if (c === 'g') return n === 'e' || n === 'i' ? 'fric' : 'stop';
  return 'stop';
}

const PAUSES: Array<[RegExp, number]> = [
  [/…|\.\.\./, 0.6],
  [/[.!?]/, 0.45],
  [/\n/, 0.35],
  [/[,;:]/, 0.25],
  [/[—–-]/, 0.2],
];

function pauseOf(punct: string): number {
  for (const [re, p] of PAUSES) if (re.test(punct)) return p;
  return 0;
}

const TOKEN = /[\p{L}]+|\d+|[.,;:!?…\n—–-]+/gu;

/** Todas las sílabas de un texto, con lo que hace falta para decirlo. */
export function textSyllables(text: string): Syl[] {
  const out: Syl[] = [];
  let sentence = 0;
  let sentenceStart = 0;
  const closeSentence = (q: boolean, ex: boolean): void => {
    for (let i = sentenceStart; i < out.length; i++) {
      out[i].question = q;
      out[i].exclaim = ex;
    }
    sentenceStart = out.length;
    sentence++;
  };
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0];
    if (/^\d+$/.test(tok)) {
      // Un número se dice con varias sílabas: "dos mil cincuenta".
      const n = Math.max(1, Math.round(tok.length * 1.6));
      for (let i = 0; i < n; i++) {
        out.push({
          text: tok,
          vowel: i % 2 ? 'e' : 'o',
          onset: 'stop',
          coda: false,
          stressed: i === n - 2,
          pause: 0,
          sentence,
          question: false,
          exclaim: false,
        });
      }
      continue;
    }
    if (/^\p{L}+$/u.test(tok)) {
      const syls = syllabify(tok);
      const st = stressIndex(tok, syls);
      syls.forEach((s, i) =>
        out.push({
          text: s,
          vowel: vowelOf(s),
          onset: onsetOf(s),
          coda: !isVowelChar(s.slice(-1).toLowerCase()) && s.slice(-1).toLowerCase() !== 'y',
          stressed: i === st,
          pause: 0,
          sentence,
          question: false,
          exclaim: false,
        }),
      );
      continue;
    }
    // Puntuación: pausa después de la última sílaba y, si cierra, fin de oración.
    const last = out[out.length - 1];
    if (last) last.pause = Math.max(last.pause, pauseOf(tok));
    if (/[.!?…\n]/.test(tok) && out.length > sentenceStart)
      closeSentence(tok.includes('?'), tok.includes('!'));
  }
  if (out.length > sentenceStart) closeSentence(/\?\s*$/.test(text), /!\s*$/.test(text));
  return out;
}

export function countSyllables(text: string): number {
  return textSyllables(text).length;
}

// ===================================================================== duración

/** Sílabas por segundo de una voz sintetizada del navegador a velocidad 1. */
export const TTS_SYL_PER_S = 5.4;
/** El bla-bla va más ligero, como en los juegos que lo popularizaron. */
export const BABBLE_SYL_PER_S = 7.2;
/** Lo que tarda una voz del navegador en empezar a hablar. */
const TTS_LATENCY = 0.3;

/**
 * Cuánto dura una línea dicha, en segundos. Con 'babble' es exacto (es la
 * duración del plan que se va a sonar); con 'tts' es una estimación de la voz
 * del navegador, que no avisa de antemano.
 */
export function estimateSpeechSeconds(
  text: string,
  rate = 1,
  mode: 'tts' | 'babble' = 'tts',
): number {
  if (!text.trim()) return 0;
  const r = clampRate(rate);
  if (mode === 'babble') return planBabble(text, 200, r, hashText(text)).duration;
  const syls = textSyllables(text);
  if (syls.length === 0) return 0;
  const pauses = syls.reduce((s, x) => s + x.pause, 0);
  const t = syls.length / (TTS_SYL_PER_S * r) + pauses / r + TTS_LATENCY;
  return Math.round(Math.max(0.6, t) * 100) / 100;
}

const clampRate = (rate: number): number =>
  Math.min(2, Math.max(0.5, Number.isFinite(rate) ? rate : 1));

// ===================================================================== bla-bla

/** Una sílaba del bla-bla: cuándo, cuánto, con qué altura y qué vocal. */
export interface BabbleNote {
  /** Inicio, en segundos desde el comienzo de la línea. */
  t: number;
  dur: number;
  /** Fracción de la sílaba que suena (el resto es el corte entre sílabas). */
  voiced: number;
  f0: number;
  f0End: number;
  vowel: Vowel;
  onset: Onset;
  amp: number;
}

export interface BabblePlan {
  notes: BabbleNote[];
  duration: number;
}

/** Hash FNV-1a: la misma línea suena siempre igual. */
export function hashText(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 local: la misma idea que utils/rng, sin estado compartido. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plan del bla-bla de una línea. La entonación es la del castellano hablado:
 * la oración arranca un poco alta y baja (declinación), la sílaba tónica sube
 * y se alarga, la pregunta sube al final y la exclamación va más alta. Encima,
 * cada sílaba salta un poco de altura: ese escalonado es lo que lo hace
 * simpático en vez de robótico.
 */
export function planBabble(text: string, f0: number, rate = 1, seed = hashText(text)): BabblePlan {
  const syls = textSyllables(text);
  const rnd = seeded(seed);
  const r = clampRate(rate);
  const base = 1 / (BABBLE_SYL_PER_S * r);
  const notes: BabbleNote[] = [];
  // Cuántas sílabas tiene cada oración, para la declinación.
  const perSentence = new Map<number, number>();
  for (const s of syls) perSentence.set(s.sentence, (perSentence.get(s.sentence) ?? 0) + 1);
  let t = 0.04;
  let k = 0;
  let prevSentence = -1;
  for (const s of syls) {
    if (s.sentence !== prevSentence) {
      k = 0;
      prevSentence = s.sentence;
    }
    const n = perSentence.get(s.sentence) ?? 1;
    const progress = n > 1 ? k / (n - 1) : 1;
    k++;
    const dur = base * (s.coda ? 1.12 : 1) * (s.stressed ? 1.15 : 0.95) * (0.92 + 0.16 * rnd());
    let pitch =
      f0 * (1.07 - 0.14 * progress) * (s.stressed ? 1.12 : 1) * (1 + (rnd() - 0.5) * 0.12);
    let end = pitch * (s.stressed ? 0.96 : 0.99);
    if (s.question && progress > 0.7) {
      pitch *= 1 + 0.3 * ((progress - 0.7) / 0.3);
      end = pitch * (progress >= 1 ? 1.18 : 1.04);
    }
    if (s.exclaim) {
      pitch *= 1.08;
      end *= 1.08;
    }
    const amp = (s.stressed ? 1 : 0.78) * (0.9 + 0.2 * rnd()) * (s.exclaim ? 1.12 : 1);
    notes.push({
      t,
      dur,
      voiced: 0.74,
      f0: pitch,
      f0End: end,
      vowel: s.vowel,
      onset: s.onset,
      amp: Math.min(1, amp),
    });
    t += dur + (s.pause * 0.8) / r;
  }
  return { notes, duration: notes.length ? Math.round((t + 0.06) * 1000) / 1000 : 0 };
}

/** Risa de chico: "ja-ja-ja" que baja y se apaga. */
export function planLaugh(f0: number, rnd: () => number): BabblePlan {
  const n = 4 + Math.floor(rnd() * 4);
  const notes: BabbleNote[] = [];
  let t = 0.02;
  for (let i = 0; i < n; i++) {
    const p = i / Math.max(1, n - 1);
    const dur = 0.105 + rnd() * 0.035;
    const pitch = f0 * (1.25 - 0.35 * p) * (1 + (rnd() - 0.5) * 0.06);
    notes.push({
      t,
      dur,
      voiced: 0.58,
      f0: pitch,
      f0End: pitch * 0.9,
      vowel: 'a',
      onset: 'fric',
      amp: 0.95 - 0.45 * p,
    });
    t += dur + 0.02;
  }
  return { notes, duration: t + 0.05 };
}

/** Cómo charla cada tipo de multitud. */
export interface TalkerProfile {
  /** Rango de la voz (Hz). */
  f0: readonly [number, number];
  rate: readonly [number, number];
  /** 0 = monótono, 1 = muy expresivo (gritos, risas, sube y baja). */
  excite: number;
  /** Largo de las frases en sílabas. */
  phrase: readonly [number, number];
  /** Silencio entre frases (s). */
  gap: readonly [number, number];
}

const VOWELS: readonly Vowel[] = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o'];
const ONSETS: readonly Onset[] = [
  'none',
  'stop',
  'stop',
  'fric',
  'nasal',
  'liquid',
  'stop',
  'fric',
];

/**
 * Un hablante cualquiera de la multitud durante `seconds`: frases de sílabas
 * con pausas. No sale de un texto (nadie entiende a una multitud), pero tiene
 * el mismo ritmo y la misma entonación que una línea dicha.
 */
export function planTalker(seconds: number, p: TalkerProfile, rnd: () => number): BabbleNote[] {
  const f0 = p.f0[0] + rnd() * (p.f0[1] - p.f0[0]);
  const rate = p.rate[0] + rnd() * (p.rate[1] - p.rate[0]);
  const base = 1 / (BABBLE_SYL_PER_S * 0.85 * rate);
  const notes: BabbleNote[] = [];
  let t = rnd() * (p.gap[1] + 0.3);
  while (t < seconds - 0.3) {
    const n = Math.round(p.phrase[0] + rnd() * (p.phrase[1] - p.phrase[0]));
    const loud = rnd() < p.excite * 0.35; // un grito, una risa, alguien que llama
    const lift = loud ? 1.25 + rnd() * 0.3 : 1;
    for (let i = 0; i < n && t < seconds - 0.2; i++) {
      const progress = n > 1 ? i / (n - 1) : 1;
      const stressed = rnd() < 0.3;
      const dur = base * (stressed ? 1.2 : 1) * (0.85 + 0.3 * rnd());
      const swing = 1 + (rnd() - 0.5) * (0.1 + 0.25 * p.excite);
      const pitch = f0 * lift * (1.06 - 0.14 * progress) * (stressed ? 1.1 : 1) * swing;
      const glide = loud && i === n - 1 ? 0.8 : 0.97;
      notes.push({
        t,
        dur,
        voiced: 0.7,
        f0: pitch,
        f0End: pitch * glide,
        vowel: VOWELS[Math.floor(rnd() * VOWELS.length)],
        onset: ONSETS[Math.floor(rnd() * ONSETS.length)],
        amp: Math.min(1, (stressed ? 1 : 0.75) * (loud ? 1.3 : 1) * (0.8 + 0.3 * rnd())),
      });
      t += dur;
    }
    t += p.gap[0] + rnd() * (p.gap[1] - p.gap[0]);
  }
  return notes;
}

/** Formantes de las cinco vocales del castellano (voz adulta, Hz). */
export const FORMANTS: Record<Vowel, readonly [number, number]> = {
  a: [760, 1320],
  e: [470, 1900],
  i: [300, 2300],
  o: [490, 960],
  u: [330, 820],
};

/**
 * Formantes escalados para la altura de la voz: un chico tiene el tracto
 * vocal más corto, y sus formantes suben (no tanto como la altura).
 */
export function formantsFor(vowel: Vowel, f0: number): [number, number] {
  const k = Math.min(1.3, Math.max(0.9, Math.pow(f0 / 170, 0.32)));
  const [a, b] = FORMANTS[vowel];
  return [a * k, b * k];
}

// ====================================================================== voces

export interface VoiceSpeaker {
  /**
   * Altura de la voz. Como factor: 1 = adulto neutro, 0,8 = grave, 1,3 =
   * chico, 1,5 = nene del jardín. Si es mayor que 20 se toma como Hz.
   */
  pitch: number;
  /** Velocidad: 1 = normal. */
  rate?: number;
  /** Para elegir la voz del navegador; si falta, se deduce de la altura. */
  gender?: 'female' | 'male';
}

export interface SpeakerProfile {
  /** Fundamental del bla-bla (Hz). */
  f0: number;
  /** Tono para speechSynthesis (0–2). */
  ttsPitch: number;
  rate: number;
  gender: 'female' | 'male';
}

export function speakerProfile(s: VoiceSpeaker): SpeakerProfile {
  const raw = Number.isFinite(s.pitch) && s.pitch > 0 ? s.pitch : 1;
  const mult = raw > 20 ? raw / 180 : raw;
  const f0 = Math.min(520, Math.max(80, 180 * mult));
  const m = f0 / 180;
  return {
    f0,
    ttsPitch: Math.min(2, Math.max(0.4, 1 + (m - 1) * 1.1)),
    rate: clampRate(s.rate ?? 1),
    gender: s.gender ?? (m < 0.88 ? 'male' : 'female'),
  };
}

/** Lo mínimo de SpeechSynthesisVoice que hace falta para elegir. */
export interface VoiceInfo {
  lang: string;
  name: string;
}

const MALE =
  /\b(tom[aá]s|jorge|pablo|ra[uú]l|[aá]lvaro|diego|juan|carlos|enrique|gonzalo|jaime|lorenzo|mateo|andr[eé]s|gerardo|emilio|federico|alonso|dario|elias|esteban|saul|sergio|rodrigo|mario|nicol[aá]s|manuel|jos[eé]|luis|h[eé]ctor|alberto|male|hombre)\b/i;
const FEMALE =
  /\b(elena|helena|paloma|sabina|laura|m[oó]nica|paulina|luc[ií]a|sof[ií]a|camila|dalia|elvira|abril|valentina|marta|ximena|catalina|isabel|beatriz|carmen|nuria|renata|larissa|triana|vera|irene|estrella|lola|elisa|andrea|salom[eé]|paola|karla|gabriela|teresa|mercedes|luciana|female|mujer)\b/i;

/** Puntaje del idioma: primero el rioplatense, después el resto de América, después España. */
export function langScore(lang: string): number {
  const l = lang.toLowerCase().replace('_', '-');
  if (!l.startsWith('es')) return -1;
  if (l === 'es-ar') return 100;
  if (l === 'es-uy') return 90;
  if (l === 'es-419') return 86;
  if (l === 'es-es') return 60;
  if (l === 'es') return 55;
  return 80; // es-MX, es-US, es-CL, es-CO…
}

/**
 * Elige la mejor voz en castellano del navegador (o −1 si no hay ninguna).
 * Idioma primero; dentro del mismo, las voces neuronales ("Natural",
 * "Online") y las de Google suenan mucho mejor, y si se puede, del género
 * pedido.
 */
export function pickSpanishVoice(
  voices: readonly VoiceInfo[],
  want: 'female' | 'male' | 'any' = 'any',
): number {
  let best = -1;
  let bestScore = -Infinity;
  voices.forEach((v, i) => {
    const ls = langScore(v.lang);
    if (ls < 0) return;
    let score = ls;
    if (/natural|online|neural/i.test(v.name)) score += 8;
    else if (/google/i.test(v.name)) score += 5;
    if (want !== 'any') {
      const isMale = MALE.test(v.name);
      const isFemale = FEMALE.test(v.name);
      if ((want === 'male' && isMale) || (want === 'female' && isFemale)) score += 6;
      else if ((want === 'male' && isFemale) || (want === 'female' && isMale)) score -= 6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * Corta un texto en trozos para speechSynthesis. Chrome corta las locuciones
 * largas (unos 15 s) sin avisar; por oraciones nunca llega.
 */
export function splitForTts(text: string, maxLen = 160): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const out: string[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.length <= maxLen) {
      out.push(p);
      continue;
    }
    // Oración muy larga: por comas, y si no alcanza, por palabras.
    let cur = '';
    for (const w of p.split(/\s+/)) {
      if (cur && cur.length + w.length + 1 > maxLen) {
        out.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) out.push(cur);
  }
  return out;
}
