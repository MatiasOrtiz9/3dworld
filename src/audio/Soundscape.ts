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
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.ambientGain = null;
    this.started = false;
  }
}
