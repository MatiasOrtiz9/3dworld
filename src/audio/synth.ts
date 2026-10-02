/**
 * Sintetizadores de sonidos sueltos con Web Audio: pasos, puertas, interfaz,
 * los sonidos del ambiente y el bla-bla de las voces.
 *
 * Cada función arma una cadena chica de nodos (de 3 a 12), la programa en el
 * tiempo `t` del contexto y la suelta: las fuentes se detienen solas y el
 * navegador recoge los nodos. No guardan estado, así que sirven igual para el
 * contexto en vivo y para uno `OfflineAudioContext` (las multitudes se
 * "graban" así una vez al arrancar, fuera del hilo principal).
 *
 * Criterio de diseño: cortos, suaves y variados. Un sonido de juego que se
 * repite idéntico cansa a los diez minutos; uno fuerte, a los dos.
 */

import { crossfadeLoop, makeNoise, peakOf, rmsOf, type Rand } from './dsp';
import type { Burst, StepParams } from './mix';
import { formantsFor, planTalker, seeded, type BabbleNote, type TalkerProfile } from './speech';

export interface Kit {
  ctx: BaseAudioContext;
  /** Ruido blanco mono de 2 s, compartido por todas las ráfagas. */
  noise: AudioBuffer;
  /** Onda de la voz: armónicos que caen suave, como una glotis. */
  voiceWave: PeriodicWave;
  rnd: Rand;
}

export function createKit(ctx: BaseAudioContext, rnd: Rand): Kit {
  const len = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  noise.getChannelData(0).set(makeNoise(len, rnd));
  const n = 18;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = 1 / Math.pow(k, 1.35);
  const voiceWave = ctx.createPeriodicWave(real, imag);
  return { ctx, noise, voiceWave, rnd };
}

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/**
 * Entrada de un sonido suelto hacia `dest`: ganancia, paneo y, si hace falta,
 * corte de agudos (distancia, paredes). Devuelve el nodo al que conectar.
 */
export function outlet(k: Kit, dest: AudioNode, gain: number, pan = 0, cutoff = 0): AudioNode {
  const ctx = k.ctx;
  const g = ctx.createGain();
  g.gain.value = gain;
  if (pan !== 0) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    g.connect(p).connect(dest);
  } else g.connect(dest);
  if (cutoff > 0 && cutoff < 15000) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.5;
    f.connect(g);
    return f;
  }
  return g;
}

/** Ganancia con envolvente de ataque lineal y caída exponencial. */
function envGain(
  k: Kit,
  dest: AudioNode,
  t: number,
  peak: number,
  attack: number,
  decay: number,
): GainNode {
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(0, t + attack, Math.max(0.002, decay / 3));
  g.connect(dest);
  return g;
}

function noiseSource(k: Kit, t: number, dur: number, loop = false): AudioBufferSourceNode {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noise;
  src.loop = loop;
  const maxOff = Math.max(0, k.noise.duration - (loop ? 0 : dur) - 0.01);
  src.start(t, k.rnd() * maxOff);
  src.stop(t + dur);
  return src;
}

/** Ráfaga de ruido filtrado: la base de casi todos los golpes. */
export function noiseBurst(
  k: Kit,
  dest: AudioNode,
  t: number,
  b: Omit<Burst, 'delay'>,
  attack = 0.002,
): void {
  const f = k.ctx.createBiquadFilter();
  f.type = b.type;
  f.frequency.value = b.freq;
  f.Q.value = b.q;
  const g = envGain(k, dest, t, b.gain, attack, b.decay);
  noiseSource(k, t, attack + b.decay * 1.6 + 0.02)
    .connect(f)
    .connect(g);
}

/** Tono con glissando y envolvente percusiva. */
export function tone(
  k: Kit,
  dest: AudioNode,
  t: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  gain: number,
  decay: number,
  attack = 0.003,
): void {
  const o = k.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
  const g = envGain(k, dest, t, gain, attack, decay);
  o.connect(g);
  o.start(t);
  o.stop(t + attack + decay * 1.6 + 0.02);
}

/** Golpe de mazo (marimba, xilofón): fundamental y un parcial agudo que muere rápido. */
export function mallet(
  k: Kit,
  dest: AudioNode,
  t: number,
  f: number,
  gain: number,
  decay: number,
  bright = 0.2,
): void {
  tone(k, dest, t, 'sine', f, f, gain, decay, 0.004);
  if (bright > 0) tone(k, dest, t, 'sine', f * 3.99, f * 3.99, gain * bright, decay * 0.22, 0.002);
}

/** Reproduce un buffer (campana, aplauso) con su velocidad y su envolvente. */
export function playBuffer(
  k: Kit,
  dest: AudioNode,
  buffer: AudioBuffer,
  t: number,
  rate = 1,
  gain = 1,
  dur = buffer.duration / rate,
  fadeIn = 0,
  fadeOut = 0,
  loop = false,
): void {
  const src = k.ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  src.playbackRate.value = rate;
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(fadeIn > 0 ? 0 : gain, t);
  if (fadeIn > 0) g.gain.linearRampToValueAtTime(gain, t + fadeIn);
  if (fadeOut > 0) {
    g.gain.setValueAtTime(gain, Math.max(t + fadeIn, t + dur - fadeOut));
    g.gain.linearRampToValueAtTime(0, t + dur);
  }
  src.connect(g).connect(dest);
  src.start(t, loop ? k.rnd() * buffer.duration * 0.8 : 0);
  src.stop(t + dur + 0.02);
}

// ======================================================================== pasos

export function playStep(k: Kit, dest: AudioNode, p: StepParams, t: number): void {
  noiseBurst(k, dest, t, p.hit);
  if (p.toe) noiseBurst(k, dest, t + p.toe.delay, p.toe);
  if (p.thump)
    tone(k, dest, t, 'sine', p.thump.freq * 1.3, p.thump.freq, p.thump.gain, p.thump.decay);
  if (p.ring) {
    const env = envGain(k, dest, t, p.ring.gain, 0.002, p.ring.decay);
    p.ring.freqs.forEach((f, i) => {
      const o = k.ctx.createOscillator();
      o.frequency.value = f;
      const g = k.ctx.createGain();
      g.gain.value = 1 / (i + 1);
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + p.ring!.decay * 1.8 + 0.03);
    });
  }
  if (p.grit) {
    for (let i = 0; i < p.grit.grains; i++) {
      noiseBurst(
        k,
        dest,
        t + k.rnd() * p.grit.spread,
        {
          type: 'highpass',
          freq: p.grit.freq * (0.8 + 0.4 * k.rnd()),
          q: 0.7,
          decay: 0.008 + 0.012 * k.rnd(),
          gain: p.grit.gain * (0.5 + 0.5 * k.rnd()),
        },
        0.001,
      );
    }
  }
  if (p.squeak) squeak(k, dest, t + 0.03, 0.35, 1);
}

// ======================================================================= puertas

function latch(k: Kit, dest: AudioNode, t: number, gain: number): void {
  noiseBurst(k, dest, t, { type: 'bandpass', freq: 3200, q: 4, decay: 0.012, gain: 0.5 * gain });
  tone(k, dest, t, 'sine', 1900, 1750, 0.1 * gain, 0.02, 0.001);
  noiseBurst(k, dest, t + 0.085, {
    type: 'bandpass',
    freq: 2700,
    q: 4,
    decay: 0.01,
    gain: 0.3 * gain,
  });
}

function ringPartials(
  k: Kit,
  dest: AudioNode,
  t: number,
  freqs: readonly number[],
  gain: number,
  decay: number,
): void {
  const env = envGain(k, dest, t, gain, 0.002, decay);
  freqs.forEach((f, i) => {
    const o = k.ctx.createOscillator();
    o.frequency.value = f * (1 + (k.rnd() - 0.5) * 0.02);
    const g = k.ctx.createGain();
    g.gain.value = 1 / (1 + i * 0.6);
    o.connect(g).connect(env);
    o.start(t);
    o.stop(t + decay * 1.8 + 0.05);
  });
}

/** Bisagra que cruje: sierra grave por un pasabanda angosto, con la altura que tambalea. */
function creak(k: Kit, dest: AudioNode, t: number, dur: number, gain: number): void {
  const o = k.ctx.createOscillator();
  o.type = 'sawtooth';
  const f0 = 85 + k.rnd() * 40;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f0 * 1.5, t + dur * 0.4);
  o.frequency.linearRampToValueAtTime(f0 * 1.1, t + dur);
  const bp = k.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800 + k.rnd() * 500;
  bp.Q.value = 6;
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.05);
  g.gain.setValueAtTime(gain, t + dur - 0.08);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(bp).connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/**
 * Puerta. Madera: picaporte, aire que se mueve y, al cerrar, el golpe sordo
 * del marco. Chapa (las salidas de emergencia y el portón): la barra
 * antipánico y la hoja que retumba con sus parciales metálicos.
 */
export function playDoor(
  k: Kit,
  dest: AudioNode,
  t: number,
  open: boolean,
  metal: boolean,
): number {
  const air = (at: number, g: number): void =>
    noiseBurst(k, dest, at, { type: 'lowpass', freq: 420, q: 0.5, decay: 0.22, gain: g }, 0.1);
  if (!metal) {
    if (open) {
      latch(k, dest, t, 1);
      air(t + 0.08, 0.12);
      if (k.rnd() < 0.35) creak(k, dest, t + 0.12, 0.3 + k.rnd() * 0.25, 0.035);
      return 0.8;
    }
    air(t, 0.1);
    tone(k, dest, t + 0.14, 'sine', 95, 68, 0.6, 0.16);
    noiseBurst(k, dest, t + 0.14, { type: 'lowpass', freq: 700, q: 0.6, decay: 0.09, gain: 0.5 });
    latch(k, dest, t + 0.15, 0.6);
    return 0.7;
  }
  if (open) {
    noiseBurst(k, dest, t, { type: 'bandpass', freq: 1300, q: 1.5, decay: 0.03, gain: 0.6 });
    ringPartials(k, dest, t, [520, 1340, 2210], 0.1, 0.35);
    latch(k, dest, t + 0.02, 0.8);
    air(t + 0.1, 0.1);
    return 1;
  }
  air(t, 0.1);
  tone(k, dest, t + 0.14, 'sine', 70, 55, 0.5, 0.3);
  noiseBurst(k, dest, t + 0.14, { type: 'lowpass', freq: 900, q: 0.6, decay: 0.15, gain: 0.6 });
  ringPartials(k, dest, t + 0.14, [180, 455, 890, 1460, 2330], 0.11, 0.7);
  latch(k, dest, t + 0.16, 0.7);
  return 1.4;
}

// ===================================================================== interfaz

export type UiKind = 'open' | 'close' | 'objective' | 'reward' | 'error' | 'unlock' | 'select';

/** Notas de la interfaz, en re mayor (la misma tonalidad que la música de inicio). */
const D5 = 587.33;
const FS5 = 739.99;
const A5 = 880;
const D6 = 1174.66;

/**
 * Sonidos de interfaz: marimba suave en re mayor, cortos y sin agudos que
 * pinchen. Un "objetivo cumplido" tiene que alegrar, no sobresaltar.
 */
export function playUi(k: Kit, dest: AudioNode, t: number, kind: UiKind): void {
  switch (kind) {
    case 'select':
      tone(k, dest, t, 'sine', 1320, 1240, 0.05, 0.035, 0.001);
      return;
    case 'open':
      mallet(k, dest, t, D5, 0.07, 0.25);
      mallet(k, dest, t + 0.06, A5, 0.06, 0.3);
      return;
    case 'close':
      mallet(k, dest, t, A5, 0.05, 0.2);
      mallet(k, dest, t + 0.06, D5, 0.045, 0.25);
      return;
    case 'objective':
      mallet(k, dest, t, D5, 0.07, 0.35);
      mallet(k, dest, t + 0.08, FS5, 0.07, 0.35);
      mallet(k, dest, t + 0.16, A5, 0.07, 0.4);
      mallet(k, dest, t + 0.26, D6, 0.06, 0.9, 0.12);
      return;
    case 'reward': {
      [D5, FS5, A5, D6].forEach((f, i) => mallet(k, dest, t + i * 0.07, f, 0.075, 0.45 + i * 0.1));
      const sparkle = [1760, 2349.3, 2637, 2960];
      for (let i = 0; i < 4; i++) {
        const f = sparkle[Math.floor(k.rnd() * sparkle.length)];
        mallet(k, dest, t + 0.35 + i * 0.065, f, 0.022, 0.4, 0);
      }
      return;
    }
    case 'error': {
      const soft = outlet(k, dest, 1, 0, 1500);
      tone(k, soft, t, 'triangle', 311, 300, 0.07, 0.12);
      tone(k, soft, t + 0.13, 'triangle', 233, 225, 0.07, 0.2);
      return;
    }
    case 'unlock':
      noiseBurst(k, dest, t, { type: 'bandpass', freq: 2500, q: 3, decay: 0.015, gain: 0.25 });
      noiseBurst(k, dest, t + 0.06, { type: 'bandpass', freq: 1900, q: 3, decay: 0.02, gain: 0.2 });
      mallet(k, dest, t + 0.1, D5, 0.06, 0.4);
      mallet(k, dest, t + 0.17, A5, 0.06, 0.45);
      mallet(k, dest, t + 0.25, D6, 0.055, 0.9, 0.1);
      tone(k, dest, t + 0.25, 'sine', 2349, 2353, 0.012, 0.6, 0.05);
      return;
  }
}

// ===================================================================== ambiente

/**
 * Pájaros del barrio: gorriones que pían, el "bien-te-veo" del benteveo y el
 * trino acelerado del hornero, los tres sonidos más porteños de un patio.
 */
export function birdSong(k: Kit, dest: AudioNode, t: number): number {
  const pick = k.rnd();
  const chirp = (at: number, f0: number, f1: number, dur: number, g: number): void => {
    const o = k.ctx.createOscillator();
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const env = k.ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(g, at + 0.008);
    env.gain.setTargetAtTime(0, at + dur * 0.6, dur * 0.2);
    o.connect(env).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
  };
  if (pick < 0.45) {
    // Gorrión: dos a cinco píos cortos.
    const n = 2 + Math.floor(k.rnd() * 4);
    const base = 2900 + k.rnd() * 900;
    let at = t;
    for (let i = 0; i < n; i++) {
      const f0 = base * (1 + (i % 2 ? -0.08 : 0.12));
      chirp(at, f0, f0 * (0.85 + k.rnd() * 0.3), 0.06, 0.5);
      at += 0.09 + k.rnd() * 0.06;
    }
    return at - t + 0.1;
  }
  if (pick < 0.75) {
    // Benteveo: "bien" (sube) – "te" (corto, alto) – "veo" (baja).
    const b = 1900 + k.rnd() * 300;
    chirp(t, b, b * 1.25, 0.14, 0.45);
    chirp(t + 0.2, b * 1.4, b * 1.35, 0.07, 0.4);
    chirp(t + 0.33, b * 1.3, b * 0.95, 0.22, 0.5);
    return 0.7;
  }
  // Hornero: trino que se acelera y baja.
  const n = 10 + Math.floor(k.rnd() * 7);
  let at = t;
  let gap = 0.1;
  for (let i = 0; i < n; i++) {
    const f = 3300 - i * 45 + k.rnd() * 80;
    chirp(at, f, f * 0.9, 0.035, 0.35);
    at += gap;
    gap = Math.max(0.045, gap * 0.94);
  }
  return at - t + 0.1;
}

/**
 * Un vehículo eléctrico que pasa lejos: sin motor, sólo el siseo de las
 * gomas que crece, se abre en agudos al pasar y se va del otro lado.
 */
export function carPass(k: Kit, dest: AudioNode, t: number, gain: number): number {
  const dur = 3.2 + k.rnd() * 2;
  const dir = k.rnd() < 0.5 ? -1 : 1;
  const lp = k.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(260, t);
  lp.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
  lp.frequency.linearRampToValueAtTime(300, t + dur);
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.5);
  g.gain.linearRampToValueAtTime(0, t + dur);
  const p = k.ctx.createStereoPanner();
  p.pan.setValueAtTime(-0.85 * dir, t);
  p.pan.linearRampToValueAtTime(0.85 * dir, t + dur);
  noiseSource(k, t, dur, true).connect(lp).connect(g).connect(p).connect(dest);
  return dur;
}

/** Timbre de bicicleta: "riiing-riiing", dos campanitas inarmónicas. */
export function bikeBell(k: Kit, dest: AudioNode, t: number): number {
  const f = 2600 + k.rnd() * 500;
  const n = k.rnd() < 0.6 ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const at = t + i * 0.14;
    tone(k, dest, at, 'sine', f, f, 0.35, 0.35, 0.002);
    tone(k, dest, at, 'sine', f * 2.41, f * 2.41, 0.12, 0.2, 0.002);
  }
  return 0.3 + n * 0.14;
}

/** Perro a lo lejos: dos o tres ladridos (sierra que cae, por un pasabanda). */
export function dogBark(k: Kit, dest: AudioNode, t: number): number {
  const n = 2 + Math.floor(k.rnd() * 2);
  const f = 480 + k.rnd() * 220;
  let at = t;
  for (let i = 0; i < n; i++) {
    const o = k.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * 0.62, at + 0.11);
    const bp = k.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 750;
    bp.Q.value = 1.4;
    const g = envGain(k, dest, at, 0.5, 0.01, 0.1);
    o.connect(bp).connect(g);
    o.start(at);
    o.stop(at + 0.2);
    noiseBurst(
      k,
      dest,
      at,
      { type: 'bandpass', freq: 1200, q: 0.8, decay: 0.06, gain: 0.12 },
      0.01,
    );
    at += 0.3 + k.rnd() * 0.15;
  }
  return at - t + 0.2;
}

/**
 * Pelota. En el patio: la patada y dos o tres piques sobre el cemento que se
 * aceleran. En el gimnasio: un pique de básquet regular, con su "ping".
 */
export function ball(k: Kit, dest: AudioNode, t: number, gym: boolean): number {
  if (gym) {
    const n = 4 + Math.floor(k.rnd() * 5);
    const period = 0.42 + k.rnd() * 0.1;
    for (let i = 0; i < n; i++) {
      const at = t + i * period * (0.97 + k.rnd() * 0.06);
      const g = 0.5 * (0.85 + k.rnd() * 0.3);
      tone(k, dest, at, 'sine', 150, 85, g, 0.08, 0.002);
      noiseBurst(
        k,
        dest,
        at,
        { type: 'bandpass', freq: 1600, q: 1, decay: 0.015, gain: g * 0.6 },
        0.001,
      );
      tone(k, dest, at, 'sine', 390, 370, g * 0.12, 0.12, 0.002);
    }
    return n * period + 0.2;
  }
  tone(k, dest, t, 'sine', 115, 60, 0.5, 0.07, 0.002);
  noiseBurst(k, dest, t, { type: 'bandpass', freq: 900, q: 1, decay: 0.02, gain: 0.4 }, 0.001);
  let at = t + 0.45 + k.rnd() * 0.2;
  let gap = 0.38;
  let g = 0.4;
  const n = 2 + Math.floor(k.rnd() * 2);
  for (let i = 0; i < n; i++) {
    tone(k, dest, at, 'sine', 130, 75, g, 0.06, 0.002);
    noiseBurst(
      k,
      dest,
      at,
      { type: 'bandpass', freq: 1300, q: 1, decay: 0.012, gain: g * 0.5 },
      0.001,
    );
    at += gap;
    gap *= 0.7;
    g *= 0.6;
  }
  return at - t + 0.1;
}

/**
 * Silbato de preceptor (de bolita): un tono agudo con el trino rápido de la
 * bolita adentro, en dos soplidos: "fuít — fuiiiít".
 */
export function whistle(k: Kit, dest: AudioNode, t: number): number {
  const f = 2750 + k.rnd() * 300;
  const o = k.ctx.createOscillator();
  o.frequency.value = f;
  const lfo = k.ctx.createOscillator();
  lfo.frequency.value = 28 + k.rnd() * 8;
  const depth = k.ctx.createGain();
  depth.gain.value = 140;
  lfo.connect(depth).connect(o.frequency);
  const env = k.ctx.createGain();
  const blasts: Array<[number, number]> =
    k.rnd() < 0.5
      ? [
          [0, 0.16],
          [0.26, 0.85],
        ]
      : [[0, 0.7]];
  env.gain.setValueAtTime(0, t);
  for (const [a, b] of blasts) {
    env.gain.setValueAtTime(0, t + a);
    env.gain.linearRampToValueAtTime(0.35, t + a + 0.015);
    env.gain.setValueAtTime(0.32, t + b - 0.03);
    env.gain.linearRampToValueAtTime(0, t + b);
  }
  const end = blasts[blasts.length - 1][1];
  const bp = k.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = 2;
  const breath = k.ctx.createGain();
  breath.gain.value = 0.25;
  o.connect(env);
  noiseSource(k, t, end + 0.05)
    .connect(bp)
    .connect(breath)
    .connect(env);
  env.connect(dest);
  o.start(t);
  lfo.start(t);
  o.stop(t + end + 0.05);
  lfo.stop(t + end + 0.05);
  return end + 0.1;
}

/** Silla que se arrastra: ruido por un pasabanda que sube, con el "trac-trac" del roce. */
export function chairScrape(k: Kit, dest: AudioNode, t: number): number {
  const dur = 0.25 + k.rnd() * 0.35;
  const bp = k.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 5;
  const f = 350 + k.rnd() * 150;
  bp.frequency.setValueAtTime(f, t);
  bp.frequency.linearRampToValueAtTime(f * (1.6 + k.rnd() * 0.6), t + dur);
  const am = k.ctx.createGain();
  am.gain.value = 0.5;
  const lfo = k.ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 35 + k.rnd() * 25;
  const depth = k.ctx.createGain();
  depth.gain.value = 0.45;
  lfo.connect(depth).connect(am.gain);
  const env = k.ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.9, t + 0.03);
  env.gain.setValueAtTime(0.8, t + dur - 0.05);
  env.gain.linearRampToValueAtTime(0, t + dur);
  noiseSource(k, t, dur + 0.02)
    .connect(bp)
    .connect(am)
    .connect(env)
    .connect(dest);
  lfo.start(t);
  lfo.stop(t + dur + 0.02);
  return dur;
}

export function cough(k: Kit, dest: AudioNode, t: number): number {
  const n = k.rnd() < 0.5 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const at = t + i * 0.28;
    noiseBurst(k, dest, at, { type: 'bandpass', freq: 520, q: 1, decay: 0.1, gain: 0.6 }, 0.012);
    noiseBurst(k, dest, at, { type: 'bandpass', freq: 1700, q: 1.3, decay: 0.07, gain: 0.3 }, 0.01);
    tone(k, dest, at, 'triangle', 150, 120, 0.12, 0.08, 0.01);
  }
  return 0.3 + n * 0.28;
}

/** Un lápiz que cae y rebota, o dos golpecitos en un pupitre. */
export function knock(k: Kit, dest: AudioNode, t: number): number {
  if (k.rnd() < 0.5) {
    const gaps = [0, 0.09, 0.15, 0.195];
    gaps.forEach((g, i) =>
      noiseBurst(
        k,
        dest,
        t + g,
        { type: 'bandpass', freq: 3800 + k.rnd() * 600, q: 3, decay: 0.01, gain: 0.5 / (i + 1) },
        0.001,
      ),
    );
    return 0.3;
  }
  for (let i = 0; i < 2; i++) {
    const at = t + i * 0.16;
    tone(k, dest, at, 'sine', 190, 170, 0.4, 0.05, 0.001);
    noiseBurst(
      k,
      dest,
      at,
      { type: 'bandpass', freq: 1100, q: 1.2, decay: 0.02, gain: 0.35 },
      0.001,
    );
  }
  return 0.3;
}

/** Chirrido de zapatillas en el piso del gimnasio. */
export function squeak(
  k: Kit,
  dest: AudioNode,
  t: number,
  gain = 1,
  count = 1 + Math.floor(k.rnd() * 3),
): number {
  let at = t;
  for (let i = 0; i < count; i++) {
    const dur = 0.07 + k.rnd() * 0.07;
    const f = 1600 + k.rnd() * 500;
    const o = k.ctx.createOscillator();
    o.frequency.setValueAtTime(f, at);
    o.frequency.linearRampToValueAtTime(f * (1.35 + k.rnd() * 0.25), at + dur);
    const vib = k.ctx.createOscillator();
    vib.frequency.value = 55;
    const vd = k.ctx.createGain();
    vd.gain.value = 90;
    vib.connect(vd).connect(o.frequency);
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.3 * gain, at + 0.01);
    g.gain.setValueAtTime(0.28 * gain, at + dur - 0.025);
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    vib.start(at);
    o.stop(at + dur + 0.01);
    vib.stop(at + dur + 0.01);
    at += dur + 0.08 + k.rnd() * 0.1;
  }
  return at - t;
}

/** Cubiertos y platos del comedor: "tinks" inarmónicos y, a veces, un plato que se apoya. */
export function clatter(k: Kit, dest: AudioNode, t: number): number {
  const n = 2 + Math.floor(k.rnd() * 4);
  for (let i = 0; i < n; i++) {
    const at = t + k.rnd() * 0.45;
    const f = 2200 + k.rnd() * 3000;
    const d = 0.05 + k.rnd() * 0.13;
    tone(k, dest, at, 'sine', f, f, 0.18, d, 0.001);
    tone(k, dest, at, 'sine', f * 2.76, f * 2.76, 0.08, d * 0.6, 0.001);
  }
  if (k.rnd() < 0.35) {
    const at = t + 0.2 + k.rnd() * 0.3;
    tone(k, dest, at, 'sine', 620, 610, 0.25, 0.12, 0.001);
    tone(k, dest, at, 'sine', 1460, 1450, 0.12, 0.09, 0.001);
    noiseBurst(k, dest, at, { type: 'lowpass', freq: 1200, q: 0.7, decay: 0.03, gain: 0.3 }, 0.001);
  }
  return 0.7;
}

/** Juguetes del jardín: un xilofón de colores, un muñeco que chilla o un sonajero. */
export function toy(k: Kit, dest: AudioNode, t: number): number {
  const pick = k.rnd();
  if (pick < 0.5) {
    const scale = [1046.5, 1174.7, 1318.5, 1568, 1760];
    let idx = Math.floor(k.rnd() * scale.length);
    const n = 3 + Math.floor(k.rnd() * 3);
    let at = t;
    for (let i = 0; i < n; i++) {
      mallet(k, dest, at, scale[idx], 0.25, 0.35, 0.35);
      idx = clamp(idx + (k.rnd() < 0.5 ? -1 : 1), 0, scale.length - 1);
      at += 0.16 + k.rnd() * 0.08;
    }
    return at - t + 0.3;
  }
  if (pick < 0.8) {
    const o = k.ctx.createOscillator();
    const f = 700 + k.rnd() * 200;
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 1.65, t + 0.08);
    o.frequency.linearRampToValueAtTime(f * 1.1, t + 0.22);
    const bp = k.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 2;
    const g = envGain(k, dest, t, 0.4, 0.02, 0.2);
    o.type = 'triangle';
    o.connect(bp).connect(g);
    o.start(t);
    o.stop(t + 0.4);
    return 0.4;
  }
  const dur = 0.4 + k.rnd() * 0.3;
  const bp = k.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 4200;
  bp.Q.value = 2;
  const am = k.ctx.createGain();
  am.gain.value = 0.5;
  const lfo = k.ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 14 + k.rnd() * 6;
  const depth = k.ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(am.gain);
  const env = k.ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.5, t + 0.02);
  env.gain.linearRampToValueAtTime(0, t + dur);
  noiseSource(k, t, dur + 0.02)
    .connect(bp)
    .connect(am)
    .connect(env)
    .connect(dest);
  lfo.start(t);
  lfo.stop(t + dur + 0.02);
  return dur;
}

/** Tic-tac de un reloj de pared. */
export function clockTick(k: Kit, dest: AudioNode, t: number, tock: boolean): void {
  noiseBurst(
    k,
    dest,
    t,
    { type: 'bandpass', freq: tock ? 2600 : 3400, q: 4, decay: 0.006, gain: 0.5 },
    0.0005,
  );
  tone(k, dest, t, 'sine', tock ? 1800 : 2300, tock ? 1750 : 2250, 0.08, 0.01, 0.0005);
}

// ======================================================================= voces

/** Programa una envolvente sin tiempos que vayan para atrás (Web Audio los rechaza). */
class Ramp {
  private last = -Infinity;
  constructor(private readonly p: AudioParam) {}
  set(t: number, v: number): void {
    t = Math.max(t, this.last + 1e-4);
    this.p.setValueAtTime(v, t);
    this.last = t;
  }
  to(t: number, v: number): void {
    t = Math.max(t, this.last + 1e-4);
    this.p.linearRampToValueAtTime(v, t);
    this.last = t;
  }
}

export interface BabbleHandle {
  /** Fin programado (tiempo del contexto). */
  end: number;
  /** Corta con un fundido muy corto. */
  stop(at: number): void;
}

export interface BabbleOptions {
  gain?: number;
  /** Cuánto del tono "limpio" (sin formantes): más alto, más "bip" de videojuego. */
  tone?: number;
  /** Cuánto ruido en las consonantes. */
  breath?: number;
}

/**
 * Bla-bla: una sola voz para toda la línea. Un oscilador con la onda de la
 * glotis pasa por dos formantes (F1 y F2, lo que distingue una "a" de una
 * "i") y un ruido agudo pone las consonantes. Por sílaba sólo se mueven
 * parámetros, así que una línea entera son diez nodos, no cien.
 */
export function scheduleBabble(
  k: Kit,
  dest: AudioNode,
  notes: readonly BabbleNote[],
  t0: number,
  opts: BabbleOptions = {},
): BabbleHandle {
  const ctx = k.ctx;
  const out = ctx.createGain();
  out.gain.value = opts.gain ?? 1;
  out.connect(dest);
  const last = notes[notes.length - 1];
  const end = t0 + (last ? last.t + last.dur : 0) + 0.08;
  if (!last) return { end: t0, stop: () => undefined };

  const osc = ctx.createOscillator();
  osc.setPeriodicWave(k.voiceWave);
  const voiced = ctx.createGain();
  voiced.gain.value = 0;
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 4.5;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 6;
  const g2 = ctx.createGain();
  g2.gain.value = 0.55;
  const direct = ctx.createBiquadFilter();
  direct.type = 'lowpass';
  direct.frequency.value = 1800;
  direct.Q.value = 0.5;
  const dg = ctx.createGain();
  dg.gain.value = opts.tone ?? 0.35;
  osc.connect(voiced);
  voiced.connect(f1).connect(out);
  voiced.connect(f2).connect(g2).connect(out);
  voiced.connect(direct).connect(dg).connect(out);
  // Los formantes resonantes ganan mucho: compensado para que la voz quede pareja con el resto.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2200;
  const cons = ctx.createGain();
  cons.gain.value = 0;
  const noise = noiseSource(k, t0, end - t0 + 0.05, true);
  noise.connect(hp).connect(cons).connect(out);

  const vg = new Ramp(voiced.gain);
  const ng = new Ramp(cons.gain);
  const pf = new Ramp(osc.frequency);
  const r1 = new Ramp(f1.frequency);
  const r2 = new Ramp(f2.frequency);
  const breath = opts.breath ?? 1;
  vg.set(t0, 0);
  ng.set(t0, 0);
  for (const n of notes) {
    const t = t0 + n.t;
    const c = n.onset === 'none' ? 0 : Math.min(0.045, n.dur * 0.3);
    const vStart = t + c;
    const vEnd = t + Math.max(c + 0.03, n.dur * n.voiced);
    const [F1, F2] = formantsFor(n.vowel, n.f0);
    // Altura: salto al comienzo de la sílaba y leve glissando.
    pf.set(t, n.f0);
    pf.to(vEnd, n.f0End);
    // Formantes: las nasales arrancan con F1 muy bajo ("m", "n").
    r1.set(t, n.onset === 'nasal' ? 260 : F1);
    r1.to(vStart + 0.02, F1);
    r2.set(t, n.onset === 'nasal' ? 1100 : F2);
    r2.to(vStart + 0.02, F2);
    // Sonoridad: las nasales y líquidas suenan desde el principio, más bajo.
    const pre = n.onset === 'nasal' || n.onset === 'liquid' ? n.amp * 0.3 : 0;
    vg.set(t, pre);
    vg.to(vStart, pre);
    vg.to(vStart + 0.02, n.amp);
    vg.to(vEnd - 0.02, n.amp * 0.7);
    vg.to(vEnd, 0);
    // Consonantes de ruido.
    if (n.onset === 'fric') {
      ng.set(t, 0);
      ng.to(t + 0.012, n.amp * 0.28 * breath);
      ng.to(vStart + 0.005, 0);
    } else if (n.onset === 'stop') {
      const b = t + c * 0.6;
      ng.set(b, 0);
      ng.to(b + 0.003, n.amp * 0.4 * breath);
      ng.to(b + 0.02, 0);
    }
  }
  osc.start(t0);
  osc.stop(end + 0.05);
  return {
    end,
    stop(at: number) {
      out.gain.cancelScheduledValues(at);
      out.gain.setTargetAtTime(0, at, 0.03);
      try {
        osc.stop(at + 0.2);
        noise.stop(at + 0.2);
      } catch {
        // ya estaba detenido: nada que hacer
      }
    },
  };
}

// ==================================================================== multitudes

/** Cómo charla cada multitud del colegio. */
export const CROWDS = {
  /** Chicos de primaria y secundaria en el recreo: agudos, rápidos, con gritos y risas. */
  kids: { f0: [240, 370], rate: [1.05, 1.35], excite: 0.6, phrase: [3, 12], gap: [0.15, 1.1] },
  /** Murmullo de aula y de público: adultos y adolescentes, más grave y parejo. */
  murmur: { f0: [105, 235], rate: [0.9, 1.1], excite: 0.15, phrase: [5, 16], gap: [0.3, 1.2] },
  /** Nenes del jardín: muy agudos, cantarines, con pausas largas. */
  little: { f0: [320, 470], rate: [0.95, 1.2], excite: 0.45, phrase: [2, 8], gap: [0.3, 1.6] },
} as const satisfies Record<string, TalkerProfile>;

export type CrowdKind = keyof typeof CROWDS;

/**
 * "Graba" una multitud en un buffer estéreo que se repite sin costura. Se hace
 * con un `OfflineAudioContext` (el navegador lo calcula fuera del hilo
 * principal, así no traba ni un cuadro) usando el mismo bla-bla de las
 * voces: cada hablante con su altura, su ritmo, su lugar en el estéreo y su
 * distancia. Devuelve null si el navegador no tiene audio offline.
 */
export async function renderCrowd(
  target: BaseAudioContext,
  kind: CrowdKind,
  talkers: number,
  seconds: number,
  sampleRate: number,
  seed: number,
): Promise<AudioBuffer | null> {
  const OAC = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext;
  if (!OAC) return null;
  const fade = 0.6;
  const total = seconds + fade;
  const off = new OAC(2, Math.ceil(total * sampleRate), sampleRate);
  const rnd = seeded(seed);
  const kit = createKit(off, rnd);
  const profile = CROWDS[kind];
  for (let i = 0; i < talkers; i++) {
    const notes = planTalker(total, profile, rnd);
    const p = off.createStereoPanner();
    p.pan.value = (rnd() * 2 - 1) * 0.9;
    // Los lejanos llegan más bajos y más opacos.
    const near = 0.25 + rnd() * 0.75;
    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800 + near * 5000;
    lp.connect(p).connect(off.destination);
    scheduleBabble(kit, lp, notes, 0, { gain: near * 0.5, tone: 0.3, breath: 0.8 });
  }
  const rendered = await off.startRendering();
  const loopLen = Math.floor(seconds * sampleRate);
  const fadeLen = Math.floor(fade * sampleRate);
  const chans = [0, 1].map((c) => crossfadeLoop(rendered.getChannelData(c), loopLen, fadeLen));
  // Nivel parejo entre multitudes: así las tablas de mezcla hablan en las mismas unidades.
  const rms = Math.sqrt((rmsOf(chans[0]) ** 2 + rmsOf(chans[1]) ** 2) / 2);
  let g = rms > 0 ? 0.16 / rms : 1;
  const peak = Math.max(peakOf(chans[0]), peakOf(chans[1])) * g;
  if (peak > 0.98) g *= 0.98 / peak;
  const buf = target.createBuffer(2, loopLen, sampleRate);
  chans.forEach((d, c) => {
    for (let i = 0; i < d.length; i++) d[i] *= g;
    buf.getChannelData(c).set(d);
  });
  return buf;
}
