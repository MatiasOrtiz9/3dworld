/**
 * Paisaje sonoro de la escuela, generado por código.
 *
 * Sin un solo archivo de audio, igual que la geometría y las texturas: todo
 * se sintetiza con Web Audio. Lo que decide QUÉ suena (tablas por zona y por
 * momento del día, pasos por superficie, audio posicional) vive en `mix.ts`;
 * cómo suena cada cosa, en `synth.ts`; el habla, en `speech.ts`; la música,
 * en `music.ts`. Esta clase arma el grafo, lo mantiene y lo expone con el
 * contrato `AudioApi` de `game/contracts`.
 *
 * El grafo:
 *
 *   capas continuas ─┐                       ┌─► envío reverberación ─► convolver ─┐
 *   eventos ─────────┤                       ├─► envío eco ─► delay ───────────────┤
 *   efectos, UI ─────┼─► buses (volúmenes) ──┴──────────────────────────────► master ─► limitador ─► salida
 *   voces, música ───┘
 *
 * Coste: unas 40 piezas fijas (capas, buses, reverberación) más 3–12 nodos
 * efímeros por sonido suelto. Las multitudes se "graban" al arrancar en un
 * `OfflineAudioContext` (fuera del hilo principal) y suenan como buffers en
 * bucle: cuarenta voces de recreo cuestan lo mismo que una.
 *
 * Robustez: sin AudioContext (pruebas, navegadores sin audio) todos los
 * métodos son no-ops seguros, y `voice()` igual devuelve la duración para que
 * los diálogos sigan su curso. El contexto se crea recién con el primer gesto
 * del usuario (los navegadores no dejan sonar nada antes), así que tampoco
 * hay avisos en la consola al cargar.
 */

import type { AmbienceZone, AudioApi, SchoolPhase, Surface, WorldPoint } from '../game/contracts';
import { crossfadeLoop, makeNoise, renderApplause, renderBell, renderImpulse } from './dsp';
import {
  AMBIENT_EVENTS,
  BED_LAYERS,
  PHASE_FACTORS,
  VOICE_LAYERS,
  ZONE_RECIPES,
  approachWeights,
  defaultSurface,
  dominantZone,
  eventRates,
  fireProbability,
  initialWeights,
  mixBeds,
  mixCutoffs,
  mixScalar,
  spatialize,
  stepParams,
  type AmbientEvent,
  type BedLayer,
  type Spatial,
  type SpatialOptions,
  type VoiceLayer,
  type ZoneWeights,
} from './mix';
import { MusicBox, type MusicTrack } from './music';
import {
  estimateSpeechSeconds,
  pickSpanishVoice,
  planBabble,
  planLaugh,
  speakerProfile,
  splitForTts,
  type BabbleNote,
  type SpeakerProfile,
  type VoiceSpeaker,
} from './speech';
import * as S from './synth';

export type { AmbientEvent } from './mix';
export type { MusicTrack } from './music';
export type { VoiceSpeaker } from './speech';

export interface SoundscapeOptions {
  /**
   * Perfil liviano (visor de VR): reverberación más corta, multitudes con
   * menos voces y menos sonidos sueltos simultáneos.
   */
  lowPower?: boolean;
  /** Recordar volumen y silencio entre visitas (localStorage). Por defecto, sí. */
  persist?: boolean;
}

export type MixChannel = 'music' | 'ambience' | 'effects' | 'voice';
/** 'auto': voz del navegador en castellano si hay; si no, bla-bla. */
export type VoiceMode = 'auto' | 'tts' | 'babble';
export type DoorMaterial = 'wood' | 'metal';

/** Constante de tiempo del cruce entre zonas (s): cruzar una puerta se oye, pero no salta. */
const ZONE_TAU = 1.1;
/** Período del temporizador interno (ms). */
const TICK_MS = 200;
const PREFS_KEY = 'ciudad2050.audio.v1';
/** Nivel de la música respecto del resto: siempre por debajo. */
const MUSIC_LEVEL = 0.55;

/** Compensación de cada capa (el filtrado deja a cada una con distinta energía). */
const BED_TRIM: Record<BedLayer, number> = {
  traffic: 1.0,
  wind: 2.2,
  room: 1.6,
  lights: 0.5,
  fridge: 0.45,
  kids: 1,
  class: 1,
  crowd: 1,
  little: 1,
};

/** Volumen base de cada sonido suelto del ambiente. */
const EVENT_LEVEL: Record<AmbientEvent, number> = {
  bird: 0.05,
  car: 0.1,
  bike: 0.04,
  dog: 0.05,
  laugh: 0.07,
  ball: 0.15,
  whistle: 0.06,
  shout: 0.07,
  steps: 0.08,
  voices: 0.05,
  chair: 0.05,
  teacher: 0.08,
  cough: 0.05,
  knock: 0.06,
  squeak: 0.05,
  clatter: 0.07,
  toy: 0.06,
  door: 0.1,
  applause: 0.22,
};

/** Frases para el bla-bla del ambiente (nadie las entiende, pero dan el ritmo justo). */
const PHRASES = {
  kid: [
    '¡Pasala, pasala!',
    '¡Dale, vamos!',
    '¡Te toca a vos!',
    '¡Mirá esto!',
    '¡Esperame!',
    '¡Seño, seño!',
    '¡Ganamos!',
    '¿Jugamos a la mancha?',
    '¡Acá, acá!',
    '¡No vale!',
  ],
  teacher: [
    'Bueno, chicos, abran la carpeta en la página doce.',
    'Silencio, por favor, que no se escucha.',
    '¿Quién me dice la respuesta?',
    'Muy bien, sigamos con el ejercicio.',
    'Copien la consigna del pizarrón.',
    'A ver, levanten la mano.',
  ],
  seno: [
    '¡A ver, chicos, hacemos una ronda!',
    'Vamos a guardar los juguetes.',
    '¿De qué color es este?',
    'Muy bien, mis amores.',
  ],
  chat: [
    '¿Viste lo que pasó ayer?',
    'Sí, en el recreo te cuento.',
    'Che, ¿hiciste la tarea?',
    'Mañana tenemos prueba.',
    'Vamos al buffet.',
    'Re bien, ¿y vos?',
  ],
} as const;

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const clamp01 = (x: number): number => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const idle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Prefs {
  muted: boolean;
  volume: number;
  channels: Record<MixChannel, number>;
}

export class Soundscape implements AudioApi {
  private readonly Ctor: typeof AudioContext | null;
  private ctx: AudioContext | null = null;
  private kit: S.Kit | null = null;
  private failed = false;
  private disposed = false;
  private started = false;
  private lowPower: boolean;
  private readonly persist: boolean;

  // Mezcla.
  private muted = false;
  private vol = 0.8;
  private readonly channels: Record<MixChannel, number> = {
    music: 0.8,
    ambience: 1,
    effects: 1,
    voice: 1,
  };
  private ducked = false;
  private master: GainNode | null = null;
  private busAmb: GainNode | null = null;
  private busEvents: GainNode | null = null;
  private busSfx: GainNode | null = null;
  private busUi: GainNode | null = null;
  private busVoice: GainNode | null = null;
  private busMusic: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private echoSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private clockBus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private readonly beds: Partial<Record<BedLayer, GainNode>> = {};
  private readonly bedApplied = {} as Record<BedLayer, number>;
  private readonly voiceFilters: Partial<Record<VoiceLayer, BiquadFilterNode>> = {};
  private readonly cutApplied = {} as Record<VoiceLayer, number>;
  private sendApplied = { reverb: -1, echo: -1 };

  // Estado del mundo.
  private weights: ZoneWeights = initialWeights('street');
  private zoneTarget: AmbienceZone = 'street';
  private phaseNow: SchoolPhase = 'entrada';
  private surface: Surface | null = null;
  private listener: WorldPoint | null = null;
  private forward: { x: number; z: number } | null = null;

  // Tiempo.
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastStep = -1;
  private foot = 1;
  private eventEnds: number[] = [];
  private clockNext = 0;
  private clockTock = false;
  private clockLevel = 0;
  private warned = false;
  private muteToken = 0;

  // Buffers calculados al arrancar.
  private bellBuf: AudioBuffer | null = null;
  private applauseBuf: AudioBuffer | null = null;
  private pendingBell: { at?: WorldPoint; strikes: number } | null = null;

  // Música.
  private musicBox: MusicBox | null = null;
  private musicWanted: MusicTrack = 'none';

  // Voces.
  private readonly tts: SpeechSynthesis | null;
  private ttsVoices: SpeechSynthesisVoice[] = [];
  private ttsBroken = false;
  private voiceMode: VoiceMode = 'auto';
  private voiceToken = 0;
  private voiceActive = false;
  private ttsSilenced = -1;
  private babble: S.BabbleHandle | null = null;
  private voiceTimer: ReturnType<typeof setTimeout> | null = null;
  private voiceEndCb: (() => void) | null = null;

  private readonly onGesture = (): void => void this.resume();
  private readonly onVoices = (): void => this.loadVoices();

  /** No crea nada pesado: el contexto nace con el primer gesto (`resume`). */
  constructor(opts: SoundscapeOptions = {}) {
    this.lowPower = opts.lowPower ?? false;
    this.persist = opts.persist ?? true;
    const hasWindow = typeof window !== 'undefined';
    const g = globalThis as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    this.Ctor = hasWindow ? (g.AudioContext ?? g.webkitAudioContext ?? null) : null;
    this.loadPrefs();
    let tts: SpeechSynthesis | null;
    try {
      tts = hasWindow && 'speechSynthesis' in window ? window.speechSynthesis : null;
    } catch {
      tts = null;
    }
    this.tts = tts;
    if (this.tts) {
      this.loadVoices();
      try {
        this.tts.addEventListener('voiceschanged', this.onVoices);
      } catch {
        // navegadores viejos: las voces se vuelven a pedir en cada línea
      }
    }
    // Reanudar con el primer gesto, sin depender de quien nos use.
    if (this.Ctor && hasWindow) {
      for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) {
        window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
      }
    }
  }

  // ================================================================ estado

  get available(): boolean {
    return this.Ctor !== null && !this.failed && !this.disposed;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get volume(): number {
    return this.vol;
  }

  /** Hay una línea de diálogo sonando (voz del navegador o bla-bla). */
  get speaking(): boolean {
    return this.voiceActive;
  }

  get zone(): AmbienceZone {
    return this.zoneTarget;
  }

  get phase(): SchoolPhase {
    return this.phaseNow;
  }

  /** Reanuda (o crea) el audio. Hay que llamarlo desde un gesto del usuario; es idempotente. */
  async resume(): Promise<void> {
    if (this.disposed || !this.Ctor || this.failed) return;
    if (!this.ctx) {
      try {
        // En el visor, 'balanced': menos interrupciones del hilo de audio; unos ms de latencia no se notan.
        this.ctx = new this.Ctor({ latencyHint: this.lowPower ? 'balanced' : 'interactive' });
        this.buildGraph();
      } catch {
        // Sin audio (demasiados contextos, política del navegador): todo queda en no-op.
        this.failed = true;
        this.ctx = null;
        this.removeGestureListeners();
        return;
      }
    }
    const ctx = this.ctx;
    if (!this.muted && ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        return; // el navegador lo rechazó: se reintenta con el próximo gesto
      }
    }
    if (this.disposed) return;
    if (!this.started) this.start();
    // Creado con el gesto ya corre aunque esté silenciado: suspendido no gasta CPU.
    if (this.muted && ctx.state === 'running') ctx.suspend().catch(() => undefined);
    if (ctx.state === 'running' || this.muted) this.removeGestureListeners();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Silencio. Además de bajar el volumen, suspende el contexto: silenciado, el
   * audio no gasta CPU (lo que en un visor se nota).
   */
  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.muted = muted;
    this.savePrefs();
    if (muted && this.voiceActive && this.tts) {
      // La línea sigue su curso (el temporizador la termina), pero callada.
      this.ttsSilenced = this.voiceToken;
      try {
        this.tts.cancel();
      } catch {
        // nada que cancelar
      }
    }
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : this.vol, ctx.currentTime, 0.06);
    const token = ++this.muteToken;
    if (muted) {
      setTimeout(() => {
        if (this.muted && token === this.muteToken && this.ctx)
          this.ctx.suspend().catch(() => undefined);
      }, 300);
    } else {
      ctx
        .resume()
        .then(() => {
          if (!this.started && !this.disposed) this.start();
        })
        .catch(() => undefined);
    }
  }

  /** Volumen general (0–1). */
  setMasterVolume(v: number): void {
    this.vol = clamp01(v);
    this.savePrefs();
    if (this.ctx && this.master && !this.muted)
      this.master.gain.setTargetAtTime(this.vol, this.ctx.currentTime, 0.05);
  }

  /** Volumen de un canal (0–1): música, ambiente, efectos o voces. */
  setChannelVolume(channel: MixChannel, v: number): void {
    this.channels[channel] = clamp01(v);
    this.savePrefs();
    this.applyChannelGains(0.08);
  }

  /** Perfil liviano para VR (menos eventos simultáneos; reverberación y multitudes más chicas si aún no se calcularon). */
  setLowPower(on: boolean): void {
    this.lowPower = on;
  }

  /** 'babble' fuerza el bla-bla aunque haya voz del navegador (o 'auto' para preferirla). */
  setVoiceMode(mode: VoiceMode): void {
    this.voiceMode = mode;
  }

  // ================================================================ mundo

  setZone(zone: AmbienceZone): void {
    if (!ZONE_RECIPES[zone] || zone === this.zoneTarget) return;
    this.zoneTarget = zone;
    // Antes de arrancar no hay cruce: se empieza directamente en la zona.
    if (!this.started) this.weights = initialWeights(zone);
  }

  setPhase(phase: SchoolPhase): void {
    if (PHASE_FACTORS[phase]) this.phaseNow = phase;
  }

  /** Superficie por defecto de los pasos (la del piso donde está el jugador); null = según la zona. */
  setSurface(surface: Surface | null): void {
    this.surface = surface;
  }

  /**
   * Oyente (la cámara) para los sonidos posicionados. `forward` es la
   * dirección de la mirada (sólo importan x y z); sin ella no hay paneo.
   */
  setListener(p: WorldPoint, forward?: { x: number; z: number }): void {
    if (!this.listener) this.listener = { x: p.x, y: p.y, z: p.z };
    else {
      this.listener.x = p.x;
      this.listener.y = p.y;
      this.listener.z = p.z;
    }
    if (forward) {
      if (!this.forward) this.forward = { x: forward.x, z: forward.z };
      else {
        this.forward.x = forward.x;
        this.forward.z = forward.z;
      }
    }
  }

  // ================================================================ efectos

  /** Un paso del jugador. La superficie, si falta, es la de `setSurface` o la típica de la zona. */
  step(running: boolean, surface?: Surface): void {
    const ctx = this.live();
    if (!ctx || !this.kit || !this.busSfx) return;
    const now = ctx.currentTime;
    // Un paso no puede seguir al anterior antes de 150–200 ms: sonaría a metralleta.
    if (now - this.lastStep < (running ? 0.15 : 0.2)) return;
    this.lastStep = now;
    const surf = surface ?? this.surface ?? defaultSurface(dominantZone(this.weights));
    this.foot = -this.foot; // pie izquierdo, pie derecho
    const dest = S.outlet(this.kit, this.busSfx, running ? 0.4 : 0.3, this.foot * 0.06);
    S.playStep(this.kit, dest, stepParams(surf, running, Math.random), now + 0.005);
  }

  /** Puerta que se abre o se cierra, opcionalmente en un punto del mundo. */
  door(open: boolean, at?: WorldPoint, material: DoorMaterial = 'wood'): void {
    const ctx = this.live();
    if (!ctx || !this.kit || !this.busSfx) return;
    const sp = this.place(at, { ref: 2.5, max: 45 });
    if (sp.gain < 0.01) return;
    S.playDoor(
      this.kit,
      S.outlet(this.kit, this.busSfx, 0.32 * sp.gain, sp.pan, sp.cutoff),
      ctx.currentTime + 0.01,
      open,
      material === 'metal',
    );
  }

  /**
   * La campana de bronce de la escuela, tocada a mano: el badajo pega de un
   * lado y del otro (golpes alternados, uno más fuerte), y la cola de cada
   * golpe se suma a la anterior. Se oye lejos.
   */
  bell(at?: WorldPoint, strikes = 8): void {
    const ctx = this.live();
    if (!ctx || !this.kit || !this.busSfx) return;
    if (!this.bellBuf) {
      this.pendingBell = { at, strikes }; // suena apenas termine de calcularse
      return;
    }
    const sp = this.place(at, { ref: 6, max: 170 });
    if (sp.gain < 0.005) return;
    const dest = S.outlet(this.kit, this.busSfx, 0.22 * sp.gain, sp.pan, sp.cutoff);
    let t = ctx.currentTime + 0.02;
    const n = Math.max(1, Math.min(24, Math.round(strikes)));
    for (let i = 0; i < n; i++) {
      S.playBuffer(
        this.kit,
        dest,
        this.bellBuf,
        t,
        1 + (Math.random() - 0.5) * 0.004,
        i % 2 ? 0.78 : 1,
      );
      t += (i % 2 ? 0.56 : 0.44) + Math.random() * 0.03;
    }
  }

  /** Tono corto para la interfaz (compatibilidad con los botones del HUD). */
  click(pitch = 660): void {
    const ctx = this.live();
    if (!ctx || !this.kit || !this.busUi) return;
    S.tone(this.kit, this.busUi, ctx.currentTime, 'sine', pitch, pitch * 0.72, 0.07, 0.1, 0.005);
  }

  ui(kind: S.UiKind): void {
    const ctx = this.live();
    if (!ctx || !this.kit || !this.busUi) return;
    S.playUi(this.kit, this.busUi, ctx.currentTime + 0.005, kind);
  }

  /**
   * Dispara a mano un sonido del ambiente (un silbato al terminar el recreo,
   * el aplauso del acto, un pelotazo), opcionalmente en un punto del mundo.
   */
  sfx(kind: AmbientEvent, at?: WorldPoint): void {
    const ctx = this.live();
    if (!ctx) return;
    this.fireAmbient(kind, ctx.currentTime + 0.01, at ?? null, true);
  }

  /** Campanita de tranvía (de la ciudad original). Se mantiene por compatibilidad. */
  tramChime(vol = 1): void {
    const ctx = this.live();
    if (!ctx || !this.kit || !this.busEvents) return;
    const dest = S.outlet(this.kit, this.busEvents, 0.4 * clamp01(vol));
    S.mallet(this.kit, dest, ctx.currentTime, 1240, 0.12, 0.3, 0.3);
    S.mallet(this.kit, dest, ctx.currentTime + 0.13, 1520, 0.12, 0.3, 0.3);
  }

  // ================================================================ voces

  /**
   * Dice una línea. Con voz del navegador en castellano (rioplatense si hay)
   * la dice de verdad; si no, bla-bla con el ritmo del texto. Devuelve la
   * duración estimada en segundos (también sin audio o silenciado, para que el
   * diálogo avance igual). `onEnd` se llama al terminar, salvo que se corte
   * con `stopVoice()` o con otra línea.
   */
  voice(text: string, speaker: VoiceSpeaker, onEnd?: () => void): number {
    this.stopVoice();
    if (this.disposed || !text || !text.trim()) {
      if (onEnd) setTimeout(onEnd, 0);
      return 0;
    }
    const prof = speakerProfile(speaker ?? { pitch: 1 });
    const ttsVoice = this.muted ? null : this.pickTtsVoice(prof.gender);
    const dur = estimateSpeechSeconds(text, prof.rate, ttsVoice ? 'tts' : 'babble');
    const token = ++this.voiceToken;
    this.voiceActive = true;
    this.voiceEndCb = onEnd ?? null;
    this.duck(true);
    if (ttsVoice) this.speakTts(text, prof, ttsVoice, token);
    else this.speakBabble(text, prof);
    // Respaldo: la línea termina sí o sí (la voz del navegador a veces no avisa).
    this.voiceTimer = setTimeout(
      () => this.voiceDone(token),
      (dur + (ttsVoice ? 2.5 : 0.05)) * 1000,
    );
    return dur;
  }

  stopVoice(): void {
    this.voiceToken++;
    if (this.voiceTimer) clearTimeout(this.voiceTimer);
    this.voiceTimer = null;
    if (this.tts && this.voiceActive) {
      try {
        this.tts.cancel();
      } catch {
        // nada que cancelar
      }
    }
    if (this.babble && this.ctx) this.babble.stop(this.ctx.currentTime);
    this.babble = null;
    this.voiceEndCb = null;
    if (this.voiceActive) {
      this.voiceActive = false;
      this.duck(false);
    }
  }

  // ================================================================ música

  music(track: MusicTrack): void {
    this.musicWanted = track;
    if (this.musicBox && this.started) this.musicBox.play(track);
  }

  // ================================================================ diagnóstico

  /** Nivel de salida (dBFS) para herramientas de verificación; null sin audio. */
  levels(): { rms: number; peak: number } | null {
    if (!this.ctx || !this.limiter) return null;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.limiter.connect(this.analyser);
    }
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let e = 0;
    let p = 0;
    for (let i = 0; i < data.length; i++) {
      e += data[i] * data[i];
      p = Math.max(p, Math.abs(data[i]));
    }
    const db = (x: number): number => (x > 1e-9 ? 20 * Math.log10(x) : -180);
    return { rms: db(Math.sqrt(e / data.length)), peak: db(p) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopVoice();
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.removeGestureListeners();
    if (this.tts) {
      try {
        this.tts.removeEventListener('voiceschanged', this.onVoices);
      } catch {
        // nada que quitar
      }
    }
    this.musicBox?.dispose();
    this.musicBox = null;
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.kit = null;
    this.master = null;
    this.started = false;
  }

  // ================================================================ interno: grafo

  /** Contexto listo para sonar ahora mismo, o null. */
  private live(): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || !this.started || this.muted || this.disposed || ctx.state !== 'running')
      return null;
    return ctx;
  }

  private gain(dest: AudioNode, value: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  private buildGraph(): void {
    const ctx = this.ctx!;
    this.kit = S.createKit(ctx, Math.random);
    // Limitador suave al final: nada de saturación aunque coincidan campana, aplauso y pasos.
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.knee.value = 8;
    lim.ratio.value = 6;
    lim.attack.value = 0.003;
    lim.release.value = 0.25;
    lim.connect(ctx.destination);
    this.limiter = lim;
    this.master = this.gain(lim, 0);

    this.busAmb = this.gain(this.master, 0);
    this.busEvents = this.gain(this.master, 0);
    this.busSfx = this.gain(this.master, 0);
    this.busUi = this.gain(this.master, 0);
    this.busVoice = this.gain(this.master, 0);
    this.busMusic = this.gain(this.master, 0);

    // Reverberación: un solo convolver para todo (el tamaño del lugar lo da el envío).
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false;
    this.convolver.connect(this.master);
    this.reverbSend = this.gain(this.convolver, 0);
    this.busSfx.connect(this.reverbSend);
    this.busEvents.connect(this.reverbSend);
    this.busVoice.connect(this.gain(this.reverbSend, 0.25));
    this.busAmb.connect(this.gain(this.reverbSend, 0.35));
    this.busMusic.connect(this.gain(this.reverbSend, 0.3));

    // Eco corto (escaleras, gimnasio): un delay con realimentación oscurecida.
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.13;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 2800;
    const fb = this.gain(delay, 0.3);
    delay.connect(dark).connect(fb);
    dark.connect(this.gain(this.master, 0.6));
    this.echoSend = this.gain(delay, 0);
    this.busSfx.connect(this.echoSend);
    this.busEvents.connect(this.echoSend);

    // Reloj de pared: a un costado, como colgado en la pared.
    const clockPan = ctx.createStereoPanner();
    clockPan.pan.value = 0.45;
    clockPan.connect(this.busEvents);
    this.clockBus = this.gain(clockPan, 0);

    this.buildBeds();
    this.musicBox = new MusicBox(ctx, this.busMusic, this.kit.noise);
  }

  /**
   * Capas continuas. Un solo ruido rosa estéreo (22 kHz, 6 s) alimenta la
   * calle, el viento y el tono de sala por filtros distintos; dos osciladores
   * dan el zumbido de los tubos (100 Hz: la red argentina es de 50 Hz) y la
   * heladera de la cantina. Las multitudes se enchufan cuando terminan de
   * calcularse.
   */
  private buildBeds(): void {
    const ctx = this.ctx!;
    const amb = this.busAmb!;
    for (const layer of BED_LAYERS) {
      this.beds[layer] = this.gain(amb, 0);
      this.bedApplied[layer] = 0;
    }
    const sr = 22050;
    const len = sr * 6;
    const pink = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++)
      pink
        .getChannelData(c)
        .set(crossfadeLoop(makeNoise(len + sr, Math.random, 'pink'), len, sr / 2));
    const src = ctx.createBufferSource();
    src.buffer = pink;
    src.loop = true;

    const filter = (type: BiquadFilterType, f: number, q: number): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    /** Oscilador lento que mueve un parámetro: ráfagas, oleadas de tránsito. */
    const lfo = (param: AudioParam, hz: number, depth: number): void => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const d = ctx.createGain();
      d.gain.value = depth;
      o.connect(d).connect(param);
      o.start();
    };

    // Calle: rumor grave que va y viene.
    const traffic = this.gain(this.beds.traffic!, 0.8);
    src.connect(filter('lowpass', 300, 0.5)).connect(traffic);
    lfo(traffic.gain, 0.05, 0.3);

    // Viento: banda media con ráfagas (dos LFO de períodos que no coinciden) y hojas arriba.
    const wind = this.gain(this.beds.wind!, 0.7);
    src.connect(filter('bandpass', 520, 0.7)).connect(wind);
    lfo(wind.gain, 0.09, 0.3);
    lfo(wind.gain, 0.031, 0.2);
    if (!this.lowPower) src.connect(filter('bandpass', 2800, 0.9)).connect(this.gain(wind, 0.25));

    // Tono de sala: el aire quieto de un ambiente cerrado.
    src.connect(filter('lowpass', 170, 0.5)).connect(this.beds.room!);

    // Tubos fluorescentes.
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 100;
    hum.connect(filter('lowpass', 240, 1.5)).connect(this.beds.lights!);
    hum.start();

    // Heladera de la cantina: compresor a 50 Hz que respira despacio.
    const fridge = ctx.createOscillator();
    fridge.type = 'square';
    fridge.frequency.value = 50;
    const fridgeMod = this.gain(this.beds.fridge!, 0.8);
    fridge.connect(filter('lowpass', 150, 0.8)).connect(fridgeMod);
    lfo(fridgeMod.gain, 0.2, 0.15);
    fridge.start();

    src.start();

    for (const layer of VOICE_LAYERS) {
      const f = filter('lowpass', 2000, 0.5);
      f.connect(this.beds[layer]!);
      this.voiceFilters[layer] = f;
      this.cutApplied[layer] = 2000;
    }
  }

  private start(): void {
    const ctx = this.ctx;
    if (!ctx || this.started || this.disposed) return;
    this.started = true;
    const now = ctx.currentTime;
    this.master?.gain.setTargetAtTime(this.muted ? 0 : this.vol, now, 0.05);
    // El ambiente entra despacio (uno que aparece de golpe se oye como un clic); el resto, ya.
    this.applyChannelGains(0.05, 1.2);
    this.applyMix(now, 0.05);
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.musicWanted !== 'none') this.musicBox?.play(this.musicWanted);
    void this.loadAssets();
  }

  /**
   * Lo pesado, de a un trozo por vez para no trabar cuadros: reverberación,
   * campana, aplauso y las tres multitudes (éstas, fuera del hilo principal).
   */
  private async loadAssets(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const lp = this.lowPower;
    await idle();
    if (this.disposed || !this.convolver) return;
    const [L, R] = renderImpulse(ctx.sampleRate, lp ? 1.3 : 2.1, Math.random);
    const ir = ctx.createBuffer(2, L.length, ctx.sampleRate);
    ir.getChannelData(0).set(L);
    ir.getChannelData(1).set(R);
    this.convolver.buffer = ir;

    await idle();
    if (this.disposed) return;
    const bellSr = 24000;
    const bell = renderBell(bellSr, 6.5, 528, Math.random);
    this.bellBuf = ctx.createBuffer(1, bell.length, bellSr);
    this.bellBuf.getChannelData(0).set(bell);
    if (this.pendingBell) {
      const p = this.pendingBell;
      this.pendingBell = null;
      this.bell(p.at, p.strikes);
    }

    await idle();
    if (this.disposed) return;
    const apSr = 22050;
    const [aL, aR] = renderApplause(apSr, 5.1, Math.random, lp ? 16 : 26);
    const apLen = Math.floor(apSr * 4.5);
    this.applauseBuf = ctx.createBuffer(2, apLen, apSr);
    this.applauseBuf.getChannelData(0).set(crossfadeLoop(aL, apLen, aL.length - apLen));
    this.applauseBuf.getChannelData(1).set(crossfadeLoop(aR, apLen, aR.length - apLen));

    // Multitudes: el patio primero (es lo que más se oye), después el resto.
    const plan: Array<[S.CrowdKind, number, VoiceLayer[]]> = [
      ['kids', lp ? 8 : 12, ['kids']],
      ['murmur', lp ? 7 : 10, ['class', 'crowd']],
      ['little', lp ? 6 : 8, ['little']],
    ];
    let seed = 0xc1d1;
    for (const [kind, talkers, layers] of plan) {
      await idle();
      if (this.disposed || !this.ctx) return;
      let buf: AudioBuffer | null = null;
      try {
        buf = await S.renderCrowd(ctx, kind, talkers, lp ? 8 : 10, 16000, seed++);
      } catch {
        buf = null; // sin audio offline: el ambiente sigue sin esa multitud
      }
      if (!buf || this.disposed || !this.ctx) continue;
      // Distinto punto de arranque por capa: la misma grabación no suena dos veces igual.
      // Las multitudes que se escuchan de cerca y por mucho rato (patio, jardín) son
      // además dos copias a velocidades apenas distintas (±4 %, inaudible en una
      // multitud): el bucle de 10 s nunca vuelve a coincidir y el oído no le
      // encuentra la vuelta.
      const rates = kind === 'murmur' ? [1] : [0.96, 1.035];
      layers.forEach((layer) => {
        for (const rate of rates) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          src.playbackRate.value = rate;
          src.connect(this.gain(this.voiceFilters[layer]!, Math.SQRT1_2 ** (rates.length - 1)));
          src.start(ctx.currentTime + 0.05, Math.random() * buf.duration);
        }
      });
    }
  }

  private applyChannelGains(tau: number, ambienceTau = tau): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const now = ctx.currentTime;
    const set = (node: GainNode | null, v: number, t = tau): void => {
      node?.gain.setTargetAtTime(v, now, t);
    };
    const d = this.ducked;
    set(this.busAmb, this.channels.ambience * (d ? 0.65 : 1), ambienceTau);
    set(this.busEvents, this.channels.ambience * (d ? 0.6 : 1), ambienceTau);
    set(this.busSfx, this.channels.effects);
    set(this.busUi, this.channels.effects);
    set(this.busVoice, this.channels.voice);
    set(this.busMusic, this.channels.music * MUSIC_LEVEL * (d ? 0.3 : 1));
  }

  private duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    this.applyChannelGains(on ? 0.12 : 0.6);
  }

  // ================================================================ interno: tiempo

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    try {
      const nowMs = performance.now();
      const dt = Math.min(1, Math.max(0, (nowMs - this.lastTick) / 1000));
      this.lastTick = nowMs;
      approachWeights(this.weights, this.zoneTarget, dt, ZONE_TAU);
      if (ctx.state !== 'running' || this.muted) return;
      const now = ctx.currentTime;
      this.applyMix(now, 0.25);
      this.musicBox?.tick();
      this.spawnEvents(now, dt);
      this.tickClock(now);
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn('[audio] error en el paisaje sonoro', err);
      }
    }
  }

  /** Lleva capas, cortes y envíos a la mezcla actual (sólo lo que cambió, para no llenar de eventos los parámetros). */
  private applyMix(now: number, tau: number): void {
    const g = mixBeds(this.weights, this.phaseNow);
    for (const layer of BED_LAYERS) {
      const v = g[layer] * BED_TRIM[layer];
      if (Math.abs(v - this.bedApplied[layer]) < 0.0005) continue;
      this.bedApplied[layer] = v;
      this.beds[layer]?.gain.setTargetAtTime(v, now, tau);
    }
    const cuts = mixCutoffs(this.weights);
    for (const layer of VOICE_LAYERS) {
      const c = cuts[layer];
      if (Math.abs(c / this.cutApplied[layer] - 1) < 0.02) continue;
      this.cutApplied[layer] = c;
      this.voiceFilters[layer]?.frequency.setTargetAtTime(c, now, tau);
    }
    const rev = mixScalar(this.weights, 'reverb');
    if (Math.abs(rev - this.sendApplied.reverb) > 0.003) {
      this.sendApplied.reverb = rev;
      this.reverbSend?.gain.setTargetAtTime(rev, now, tau);
    }
    const echo = mixScalar(this.weights, 'echo');
    if (Math.abs(echo - this.sendApplied.echo) > 0.003) {
      this.sendApplied.echo = echo;
      this.echoSend?.gain.setTargetAtTime(echo, now, tau);
    }
  }

  private spawnEvents(now: number, dt: number): void {
    this.eventEnds = this.eventEnds.filter((e) => e > now);
    const max = this.lowPower ? 6 : 10;
    if (this.eventEnds.length >= max) return;
    const rates = eventRates(this.weights, this.phaseNow, this.lowPower ? 0.7 : 1);
    for (const kind of AMBIENT_EVENTS) {
      if (Math.random() < fireProbability(rates[kind], dt)) {
        this.fireAmbient(kind, now + Math.random() * 0.15, null, false);
        if (this.eventEnds.length >= max) return;
      }
    }
  }

  private tickClock(now: number): void {
    const amount = mixScalar(this.weights, 'clock');
    if (!this.clockBus || !this.kit) return;
    if (amount < 0.2) {
      this.clockNext = 0;
      return;
    }
    const level = 0.035 * amount;
    if (Math.abs(level - this.clockLevel) > 0.001) {
      this.clockLevel = level;
      this.clockBus.gain.setTargetAtTime(level, now, 0.3);
    }
    if (this.clockNext < now) this.clockNext = Math.ceil(now);
    while (this.clockNext < now + 0.5) {
      S.clockTick(this.kit, this.clockBus, this.clockNext, this.clockTock);
      this.clockTock = !this.clockTock;
      this.clockNext += 1;
    }
  }

  private place(at: WorldPoint | undefined | null, opts?: SpatialOptions): Spatial {
    if (!at || !this.listener) return { gain: 1, pan: 0, cutoff: 0 };
    return spatialize(this.listener, this.forward, at, opts);
  }

  /**
   * Un sonido suelto del ambiente. Sin posición: en algún lugar alrededor,
   * a una distancia al azar (más lejos = más bajo y más opaco). Con posición,
   * donde corresponde respecto del oyente.
   */
  private fireAmbient(kind: AmbientEvent, t: number, at: WorldPoint | null, manual: boolean): void {
    const kit = this.kit;
    const bus = this.busEvents;
    if (!kit || !bus) return;
    let sp: Spatial;
    if (at) sp = this.place(at, { ref: 3, max: 80 });
    else if (manual) sp = { gain: 1, pan: 0, cutoff: 0 };
    else {
      const near = 0.35 + Math.random() * 0.65;
      sp = { gain: near, pan: (Math.random() * 2 - 1) * 0.85, cutoff: 1500 + 12000 * near * near };
    }
    if (sp.gain < 0.01) return;
    const dest = S.outlet(kit, bus, EVENT_LEVEL[kind] * sp.gain, sp.pan, sp.cutoff);
    const zone = dominantZone(this.weights);
    let dur = 0.5;
    switch (kind) {
      case 'bird':
        dur = S.birdSong(kit, dest, t);
        break;
      case 'car':
        dur = S.carPass(kit, dest, t, 1);
        break;
      case 'bike':
        dur = S.bikeBell(kit, dest, t);
        break;
      case 'dog':
        dur = S.dogBark(kit, dest, t);
        break;
      case 'laugh': {
        const f0 = zone === 'kindergarten' ? 380 + Math.random() * 80 : 270 + Math.random() * 90;
        dur = this.babbleAt(dest, planLaugh(f0, Math.random).notes, t, 0.4);
        break;
      }
      case 'shout':
        dur = this.babbleAt(
          dest,
          planBabble(pick(PHRASES.kid), 280 + Math.random() * 90, 1.15, Math.random() * 1e9).notes,
          t,
          0.35,
        );
        break;
      case 'teacher': {
        const seno = zone === 'kindergarten';
        const male = !seno && Math.random() < 0.3;
        const f0 = seno
          ? 230 + Math.random() * 30
          : male
            ? 115 + Math.random() * 25
            : 185 + Math.random() * 35;
        dur = this.babbleAt(
          dest,
          planBabble(pick(seno ? PHRASES.seno : PHRASES.teacher), f0, 0.95, Math.random() * 1e9)
            .notes,
          t,
          0.3,
        );
        break;
      }
      case 'voices': {
        // Dos que charlan al pasar: una frase cada uno.
        const a = planBabble(
          pick(PHRASES.chat),
          250 + Math.random() * 90,
          1.05,
          Math.random() * 1e9,
        );
        const b = planBabble(
          pick(PHRASES.chat),
          230 + Math.random() * 120,
          1.05,
          Math.random() * 1e9,
        );
        this.babbleAt(dest, a.notes, t, 0.3);
        this.babbleAt(dest, b.notes, t + a.duration + 0.25, 0.3);
        dur = a.duration + b.duration + 0.25;
        break;
      }
      case 'ball':
        dur = S.ball(kit, dest, t, zone === 'gym');
        break;
      case 'whistle':
        dur = S.whistle(kit, dest, t);
        break;
      case 'steps': {
        // Alguien que pasa caminando.
        const surf = defaultSurface(zone);
        const n = 4 + Math.floor(Math.random() * 6);
        const period = 0.48 + Math.random() * 0.1;
        for (let i = 0; i < n; i++)
          S.playStep(kit, dest, stepParams(surf, false, Math.random), t + i * period);
        dur = n * period;
        break;
      }
      case 'chair':
        dur = S.chairScrape(kit, dest, t);
        break;
      case 'cough':
        dur = S.cough(kit, dest, t);
        break;
      case 'knock':
        dur = S.knock(kit, dest, t);
        break;
      case 'squeak':
        dur = S.squeak(kit, dest, t);
        break;
      case 'clatter':
        dur = S.clatter(kit, dest, t);
        break;
      case 'toy':
        dur = S.toy(kit, dest, t);
        break;
      case 'door':
        dur = S.playDoor(kit, dest, t, Math.random() < 0.5, Math.random() < 0.2);
        break;
      case 'applause': {
        if (!this.applauseBuf) return;
        const len = manual ? 4 + Math.random() * 2 : 2.5 + Math.random() * 3;
        S.playBuffer(
          kit,
          dest,
          this.applauseBuf,
          t,
          0.95 + Math.random() * 0.1,
          1,
          len,
          0.5,
          1.4,
          true,
        );
        dur = len;
        break;
      }
    }
    this.eventEnds.push(t + dur);
  }

  private babbleAt(dest: AudioNode, notes: readonly BabbleNote[], t: number, tone: number): number {
    const h = S.scheduleBabble(this.kit!, dest, notes, t, { tone, breath: 0.8 });
    return h.end - t;
  }

  // ================================================================ interno: voces

  private loadVoices(): void {
    if (!this.tts) return;
    try {
      this.ttsVoices = this.tts.getVoices().filter((v) => /^es/i.test(v.lang));
    } catch {
      this.ttsVoices = [];
    }
  }

  private pickTtsVoice(gender: 'female' | 'male'): SpeechSynthesisVoice | null {
    if (!this.tts || this.voiceMode === 'babble' || this.ttsBroken) return null;
    if (!this.ttsVoices.length) this.loadVoices();
    const i = pickSpanishVoice(this.ttsVoices, gender);
    return i >= 0 ? this.ttsVoices[i] : null;
  }

  private speakTts(
    text: string,
    prof: SpeakerProfile,
    v: SpeechSynthesisVoice,
    token: number,
  ): void {
    const tts = this.tts!;
    try {
      tts.cancel();
      const chunks = splitForTts(text);
      chunks.forEach((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.voice = v;
        u.lang = v.lang;
        u.pitch = prof.ttsPitch;
        u.rate = prof.rate;
        u.volume = this.muted ? 0 : clamp01(this.vol * this.channels.voice);
        if (i === chunks.length - 1) {
          u.onend = () => {
            if (this.ttsSilenced !== token) this.voiceDone(token);
          };
        }
        u.onerror = (ev: SpeechSynthesisErrorEvent) => {
          if (token !== this.voiceToken || ev.error === 'interrupted' || ev.error === 'canceled')
            return;
          // La voz del navegador falló (sin permiso, sin motor): bla-bla de acá en adelante.
          this.ttsBroken = true;
          try {
            tts.cancel();
          } catch {
            // nada que cancelar
          }
          this.speakBabble(text, prof);
        };
        tts.speak(u);
      });
    } catch {
      this.ttsBroken = true;
      this.speakBabble(text, prof);
    }
  }

  private speakBabble(text: string, prof: SpeakerProfile): void {
    const ctx = this.live();
    if (!ctx || !this.kit || !this.busVoice) return;
    const plan = planBabble(text, prof.f0, prof.rate);
    const dest = S.outlet(this.kit, this.busVoice, 0.5);
    this.babble = S.scheduleBabble(this.kit, dest, plan.notes, ctx.currentTime + 0.03, {
      tone: 0.45,
      breath: 0.6,
    });
  }

  private voiceDone(token: number): void {
    if (token !== this.voiceToken || !this.voiceActive) return;
    if (this.voiceTimer) clearTimeout(this.voiceTimer);
    this.voiceTimer = null;
    this.voiceActive = false;
    this.babble = null;
    this.duck(false);
    const cb = this.voiceEndCb;
    this.voiceEndCb = null;
    cb?.();
  }

  // ================================================================ interno: varios

  private removeGestureListeners(): void {
    if (typeof window === 'undefined') return;
    for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) {
      window.removeEventListener(ev, this.onGesture, { capture: true });
    }
  }

  private loadPrefs(): void {
    if (!this.persist) return;
    try {
      const raw = globalThis.localStorage?.getItem(PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<Prefs>;
      if (typeof p.muted === 'boolean') this.muted = p.muted;
      if (typeof p.volume === 'number') this.vol = clamp01(p.volume);
      if (p.channels) {
        for (const k of Object.keys(this.channels) as MixChannel[]) {
          const v = p.channels[k];
          if (typeof v === 'number') this.channels[k] = clamp01(v);
        }
      }
    } catch {
      // almacenamiento bloqueado o dañado: valores por defecto
    }
  }

  private savePrefs(): void {
    if (!this.persist) return;
    try {
      const p: Prefs = { muted: this.muted, volume: this.vol, channels: { ...this.channels } };
      globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      // sin almacenamiento: no se recuerda, nada más
    }
  }
}
