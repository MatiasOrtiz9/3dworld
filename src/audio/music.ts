/**
 * Música generativa, muy discreta: un colchón de acordes y unas notas
 * punteadas que se eligen en el momento. Sólo suena en la introducción, en
 * el acto final y en los créditos; el resto del juego lo cuenta el ambiente.
 *
 * Se programa con anticipación (cada `tick` agenda lo que falta del próximo
 * segundo y pico), que es la forma de tener un pulso exacto en Web Audio:
 * los temporizadores de JavaScript se atrasan, el reloj del audio no.
 */

export type MusicTrack = 'none' | 'intro' | 'act' | 'credits';

export interface TrackDef {
  bpm: number;
  /** Acordes (notas MIDI), uno por compás de 4 tiempos. */
  chords: ReadonlyArray<readonly number[]>;
  /** Escala para las notas punteadas (MIDI). */
  scale: readonly number[];
  /** Probabilidad de una nota punteada por corchea. */
  pluck: number;
  /** Arpegio ordenado (acto) en vez de notas sueltas al azar. */
  arp: boolean;
  /** Motivo fijo (índices de la escala, −1 = silencio) que se repite: algo para recordar. */
  motif?: readonly number[];
  padGain: number;
  pluckGain: number;
  /** Corte del colchón (Hz): más bajo, más cálido. */
  padCut: number;
  /** Maraca muy suave a contratiempo. */
  shaker: boolean;
}

/**
 * Tres piezas:
 * - intro: re mayor, lenta, abierta (Dmaj9 – Bm7 – Gmaj7 – Asus4).
 * - act: sol mayor, festiva pero tranquila, arpegios y maraca suave.
 * - credits: fa mayor, nostálgica, con un motivo que vuelve.
 */
export const TRACKS: Record<Exclude<MusicTrack, 'none'>, TrackDef> = {
  intro: {
    bpm: 70,
    chords: [
      [50, 57, 64, 66, 69],
      [47, 54, 62, 66, 69],
      [43, 55, 62, 66, 71],
      [45, 52, 62, 64, 69],
    ],
    scale: [74, 76, 78, 81, 83, 86],
    pluck: 0.3,
    arp: false,
    padGain: 0.03,
    pluckGain: 0.045,
    padCut: 1400,
    shaker: false,
  },
  act: {
    bpm: 96,
    chords: [
      [43, 55, 59, 62, 67],
      [42, 54, 57, 62, 66],
      [40, 52, 59, 64, 67],
      [36, 52, 55, 60, 64],
      [43, 55, 59, 62, 67],
      [36, 52, 55, 60, 64],
      [38, 54, 57, 62, 66],
      [43, 55, 59, 62, 67],
    ],
    scale: [67, 69, 71, 74, 76, 79],
    pluck: 0.7,
    arp: true,
    padGain: 0.025,
    pluckGain: 0.04,
    padCut: 1900,
    shaker: true,
  },
  credits: {
    bpm: 66,
    chords: [
      [41, 57, 60, 64, 69],
      [45, 55, 60, 64, 67],
      [46, 57, 62, 65, 69],
      [48, 55, 60, 64, 69],
    ],
    scale: [65, 67, 69, 72, 74, 77],
    pluck: 0.35,
    arp: false,
    motif: [2, -1, 3, 2, 0, -1, 1, -1, 2, -1, 4, 3, 2, -1, -1, -1],
    padGain: 0.03,
    pluckGain: 0.045,
    padCut: 1300,
    shaker: false,
  },
};

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Acorde del compás `bar` de la pieza (se repite en ciclo). */
export function chordAt(track: Exclude<MusicTrack, 'none'>, bar: number): readonly number[] {
  const c = TRACKS[track].chords;
  return c[((bar % c.length) + c.length) % c.length];
}

/** Notas de la escala que suenan bien sobre el acorde (evita choques de semitono). */
export function consonantScale(track: Exclude<MusicTrack, 'none'>, bar: number): number[] {
  const pcs = new Set(chordAt(track, bar).map((m) => m % 12));
  return TRACKS[track].scale.filter((m) => {
    const pc = m % 12;
    if (pcs.has(pc)) return true;
    for (const c of pcs) if ((pc - c + 12) % 12 === 1 || (c - pc + 12) % 12 === 1) return false;
    return true;
  });
}

const LOOKAHEAD = 1.4;

/**
 * Reproductor de la música generativa. Todo pasa por `out` (el bus de música
 * del Soundscape, que es el que baja de volumen bajo las voces).
 */
export class MusicBox {
  private track: MusicTrack = 'none';
  private nextTime = 0;
  /** Corchea actual dentro de la pieza. */
  private eighth = 0;
  private readonly bus: GainNode;
  private readonly padFilter: BiquadFilterNode;
  private readonly echo: DelayNode;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.Q.value = 0.4;
    this.padFilter.connect(this.bus);
    // Eco de las notas punteadas: da espacio sin reverberación extra.
    this.echo = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.echo.connect(tone).connect(fb).connect(this.echo);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    tone.connect(wet).connect(this.bus);
  }

  get current(): MusicTrack {
    return this.track;
  }

  play(track: MusicTrack): void {
    if (track === this.track) return;
    const now = this.ctx.currentTime;
    this.track = track;
    this.bus.gain.cancelScheduledValues(now);
    if (track === 'none') {
      // Fundido largo: la música se va, no se corta.
      this.bus.gain.setTargetAtTime(0, now, 0.9);
      return;
    }
    const def = TRACKS[track];
    this.padFilter.frequency.setTargetAtTime(def.padCut, now, 0.5);
    this.echo.delayTime.value = (60 / def.bpm) * 0.75;
    this.bus.gain.setTargetAtTime(1, now, 1.2);
    this.eighth = 0;
    this.nextTime = now + 0.15;
  }

  /** Agenda lo que falta del próximo tramo. Se llama varias veces por segundo. */
  tick(): void {
    if (this.track === 'none') return;
    const now = this.ctx.currentTime;
    // Después de una pausa larga (pestaña oculta) no se intenta "ponerse al día".
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;
    const track = this.track;
    const def = TRACKS[track];
    const step = 60 / def.bpm / 2;
    while (this.nextTime < now + LOOKAHEAD) {
      this.scheduleEighth(track, def, this.eighth, this.nextTime, step);
      this.eighth++;
      this.nextTime += step;
    }
  }

  private scheduleEighth(
    track: Exclude<MusicTrack, 'none'>,
    def: TrackDef,
    e: number,
    t: number,
    step: number,
  ): void {
    const bar = Math.floor(e / 8);
    const inBar = e % 8;
    const chord = chordAt(track, bar);
    if (inBar === 0) {
      const dur = step * 8;
      chord.forEach((m, i) => this.pad(midiToHz(m), t, dur, def.padGain * (i === 0 ? 1.2 : 1)));
    }
    if (def.motif) {
      const idx = def.motif[e % def.motif.length];
      if (idx >= 0) this.pluckNote(midiToHz(def.scale[idx % def.scale.length]), t, def.pluckGain);
    } else if (def.arp) {
      // Arpegio ascendente sobre las notas altas del acorde, una octava arriba en los tiempos fuertes.
      const tones = chord.slice(1);
      const m = tones[inBar % tones.length] + 12;
      if (Math.random() < def.pluck)
        this.pluckNote(midiToHz(m), t, def.pluckGain * (inBar % 4 === 0 ? 1 : 0.7));
      if (inBar === 0 || inBar === 4)
        this.pluckNote(midiToHz(m + 12), t, def.pluckGain * 0.35, 0.6);
    } else if (Math.random() < def.pluck) {
      const scale = consonantScale(track, bar);
      const m = scale[Math.floor(Math.random() * scale.length)];
      this.pluckNote(midiToHz(m), t, def.pluckGain * (0.7 + Math.random() * 0.3));
    }
    if (def.shaker && inBar % 2 === 1) this.shake(t, inBar === 3 || inBar === 7 ? 0.018 : 0.011);
  }

  /** Nota de colchón: dos osciladores apenas desafinados, entrada y salida lentas. */
  private pad(f: number, t: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(1.8, dur * 0.4));
    g.gain.setValueAtTime(gain, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.8);
    g.connect(this.padFilter);
    for (const [type, detune] of [
      ['triangle', -5],
      ['sine', 6],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 3.5);
    }
  }

  /** Nota punteada: seno con un poco de octava, ataque corto y cola suave. */
  private pluckNote(f: number, t: number, gain: number, decay = 0.9): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.006, decay / 3);
    g.connect(this.bus);
    g.connect(this.echo);
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    o.connect(g);
    o2.connect(g2).connect(g);
    o.start(t);
    o2.start(t);
    o.stop(t + decay * 2 + 0.1);
    o2.stop(t + decay * 2 + 0.1);
  }

  private shake(t: number, gain: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.setTargetAtTime(0, t + 0.012, 0.02);
    src.connect(hp).connect(g).connect(this.bus);
    src.start(t, Math.random() * (this.noise.duration - 0.2));
    src.stop(t + 0.12);
  }

  dispose(): void {
    this.track = 'none';
    try {
      this.bus.disconnect();
    } catch {
      // el contexto ya estaba cerrado
    }
  }
}
