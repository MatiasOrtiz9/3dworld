/**
 * Paisaje sonoro, generado por código.
 *
 * Sin un solo archivo de audio, igual que la geometría y las texturas. Todo se
 * sintetiza con Web Audio: ruido filtrado para el ambiente, ráfagas cortas
 * para los pasos, tonos para la interfaz.
 *
 * El sonido de una ciudad sin autos no es silencio: es viento entre los
 * árboles, pasos, voces lejanas indistinguibles y, cada tanto, un tranvía. Eso
 * es lo que se reconstruye acá, y en ese orden de importancia.
 *
 * Los navegadores no dejan sonar nada hasta que la persona interactúa con la
 * página, así que el contexto arranca suspendido y se reanuda en el primer
 * clic o tecla.
 */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private started = false;
  private muted = false;
  private lastStep = 0;
  private birdTimer: ReturnType<typeof setTimeout> | null = null;

  /** Crea el contexto. No suena nada hasta `resume()`. */
  constructor() {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
  }

  get available(): boolean {
    return this.ctx !== null;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Reanuda el audio. Hay que llamarlo desde un gesto del usuario. */
  async resume(): Promise<void> {
    if (!this.ctx || this.started) return;
    try {
      await this.ctx.resume();
    } catch {
      return; // el navegador lo rechazó; no es motivo para romper nada
    }
    this.started = true;
    this.buildAmbience();
    this.scheduleBirds();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.08);
    }
    return this.muted;
  }

  // ------------------------------------------------------------- ambiente

  /**
   * Fondo continuo: dos capas de ruido filtrado.
   *
   * Una grave y muy lenta, que es el "cuerpo" de una ciudad a lo lejos; otra
   * aguda con la ganancia oscilando despacio, que el oído interpreta como
   * viento entre las hojas. Ninguna de las dos tiene un patrón audible, que es
   * lo que hace que no canse.
   */
  private buildAmbience(): void {
    if (!this.ctx || !this.master) return;

    const ctx = this.ctx;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.0;
    this.ambientGain.connect(this.master);
    // Entrada suave: un ambiente que aparece de golpe se nota como un click.
    this.ambientGain.gain.setTargetAtTime(0.22, ctx.currentTime, 1.5);

    const noise = this.createNoiseSource(6);

    // Capa grave: rumor de fondo.
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 340;
    low.Q.value = 0.6;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.5;
    noise.connect(low).connect(lowGain).connect(this.ambientGain);

    // Capa aguda: hojas. La ganancia oscila con un LFO muy lento.
    const high = ctx.createBiquadFilter();
    high.type = 'bandpass';
    high.frequency.value = 2600;
    high.Q.value = 0.7;
    const highGain = ctx.createGain();
    highGain.gain.value = 0.1;
    noise.connect(high).connect(highGain).connect(this.ambientGain);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07; // un ciclo cada 14 segundos
    const lfoAmount = ctx.createGain();
    lfoAmount.gain.value = 0.06;
    lfo.connect(lfoAmount).connect(highGain.gain);
    lfo.start();

    noise.start();
  }

  /** Fuente de ruido blanco en bucle, de `seconds` de duración. */
  private createNoiseSource(seconds: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  // ------------------------------------------------------------- pájaros
  /**
   * Canto procedural de pájaros en intervalos irregulares.
   * Modula ondas senoidales puras simulando gorjeos biófilos.
   */
  private scheduleBirds(): void {
    if (!this.ctx || !this.started) return;
    const nextCallMs = (4 + Math.random() * 8) * 1000;
    this.birdTimer = setTimeout(() => {
      if (this.started && !this.muted) {
        this.playBirdSong();
      }
      this.scheduleBirds();
    }, nextCallMs);
  }

  private playBirdSong(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = Math.floor(Math.random() * 3) + 2;
    const baseFreq = 2600 + Math.random() * 800;

    for (let i = 0; i < notes; i++) {
      const noteStart = now + i * (0.08 + Math.random() * 0.04);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';

      const f0 = baseFreq * (1 + (i % 2 === 0 ? 0.12 : -0.08));
      const f1 = f0 * (1 + (Math.random() * 0.25 - 0.12));
      osc.frequency.setValueAtTime(f0, noteStart);
      osc.frequency.exponentialRampToValueAtTime(f1, noteStart + 0.055);

      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(0.022, noteStart + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.065);

      osc.connect(gain).connect(this.master);
      osc.start(noteStart);
      osc.stop(noteStart + 0.075);
    }
  }

  // ------------------------------------------------------------- tranvía
  /** Campanilla metálica de dos tonos ("ding-ding") típica de tranvía moderno. */
  tramChime(vol = 1.0): void {
    if (!this.ctx || !this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const ring = (freq: number, t: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      // Armónico para timbre metálico
      const oscH = ctx.createOscillator();
      oscH.type = 'sine';
      oscH.frequency.setValueAtTime(freq * 2.76, t);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.06 * Math.min(1.0, Math.max(0.1, vol)), t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.32);

      osc.connect(gain).connect(this.master!);
      oscH.connect(gain);
      osc.start(t);
      oscH.start(t);
      osc.stop(t + 0.34);
      oscH.stop(t + 0.34);
    };

    ring(1240, now);
    ring(1520, now + 0.13);
  }

  // ---------------------------------------------------------------- pasos

  /**
   * Un paso. Se llama desde el controlador del jugador al ritmo de la marcha.
   *
   * Es un golpe de ruido muy corto pasado por un pasabanda: el oído reconoce
   * una suela contra el piso por su envolvente —ataque casi instantáneo y caída
   * de unos 60 ms— mucho más que por su contenido espectral.
   */
  step(running: boolean): void {
    if (!this.ctx || !this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Protección contra ráfagas: un paso no puede seguir al anterior antes de
    // 180 ms, o suena a metralleta.
    if (now - this.lastStep < 0.18) return;
    this.lastStep = now;

    const src = this.createNoiseSource(0.2);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    // Correr golpea más fuerte y un poco más grave.
    band.frequency.value = running ? 900 : 1250;
    band.Q.value = 1.1;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(running ? 0.16 : 0.1, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0008, now + 0.075);

    src.connect(band).connect(env).connect(this.master!);
    src.start(now);
    src.stop(now + 0.12);
  }

  // ------------------------------------------------------------- interfaz

  /** Tono corto para la interfaz. */
  click(pitch = 660): void {
    if (!this.ctx || !this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.72, now + 0.09);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.07, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0005, now + 0.11);

    osc.connect(env).connect(this.master!);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  dispose(): void {
    if (this.birdTimer) {
      clearTimeout(this.birdTimer);
      this.birdTimer = null;
    }
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.ambientGain = null;
    this.started = false;
  }
}
