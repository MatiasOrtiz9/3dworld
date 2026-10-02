/**
 * Señales calculadas a mano (sin Web Audio): ruidos, la respuesta al impulso
 * de la reverberación, la campana de bronce y el aplauso.
 *
 * Son funciones puras sobre Float32Array, deterministas con el generador que
 * se les pasa. Se calculan una sola vez al arrancar el audio y después se
 * reproducen como buffers, que es muchísimo más barato que sintetizarlas en
 * vivo con decenas de osciladores (lo que importa en un visor de VR).
 */

export type Rand = () => number;

/** Ruido blanco, rosa (−3 dB/oct, suena "parejo") o marrón (−6 dB/oct, rumor). */
export function makeNoise(
  length: number,
  rnd: Rand,
  color: 'white' | 'pink' | 'brown' = 'white',
): Float32Array {
  const out = new Float32Array(length);
  if (color === 'white') {
    for (let i = 0; i < length; i++) out[i] = rnd() * 2 - 1;
    return out;
  }
  if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
      out[i] = last * 3.5;
    }
    return out;
  }
  // Rosa: filtro de Paul Kellet (aproximación de −3 dB/oct en todo el audible).
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/**
 * Cierra un bucle sin costura: el final (`fade` muestras más allá del largo
 * del bucle) se funde con el principio a potencia constante. Un bucle con
 * salto se oye como un "clic" cada vez que vuelve a empezar, y a los pocos
 * ciclos el oído ya lo espera.
 */
export function crossfadeLoop(data: Float32Array, loopLen: number, fade: number): Float32Array {
  const n = Math.min(loopLen, data.length);
  const f = Math.max(0, Math.min(fade, data.length - n, n));
  const out = data.slice(0, n);
  for (let i = 0; i < f; i++) {
    const x = (i + 0.5) / f;
    const gIn = Math.sin((x * Math.PI) / 2);
    const gOut = Math.cos((x * Math.PI) / 2);
    out[i] = data[i] * gIn + data[n + i] * gOut;
  }
  return out;
}

/**
 * Respuesta al impulso estéreo para el ConvolverNode: unas pocas reflexiones
 * tempranas (las paredes cercanas) y una cola de ruido que decae y se oscurece
 * (el aire y las superficies absorben antes los agudos). Los dos canales son
 * distintos para que la sala "abra" en estéreo.
 */
export function renderImpulse(
  sampleRate: number,
  seconds: number,
  rnd: Rand,
): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.floor(sampleRate * seconds));
  const tau = seconds / 6.9; // seconds = tiempo hasta −60 dB
  const chans: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  for (const ch of chans) {
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t / tau);
      // El filtro se cierra con el tiempo: cola cada vez más oscura.
      const a = 0.85 - 0.6 * Math.min(1, t / seconds);
      lp += a * (rnd() * 2 - 1 - lp);
      // Entrada suave de la cola (unos 12 ms de predelay difuso).
      const onset = Math.min(1, t / 0.012);
      ch[i] = lp * env * onset;
    }
    // Reflexiones tempranas.
    for (let k = 0; k < 6; k++) {
      const at = Math.floor(sampleRate * (0.007 + rnd() * 0.04));
      if (at < len) ch[at] += (rnd() < 0.5 ? -1 : 1) * (0.5 - k * 0.06);
    }
  }
  // Normalización por energía: el nivel del envío no depende del largo.
  let e = 0;
  for (const ch of chans) for (let i = 0; i < len; i++) e += ch[i] * ch[i];
  const g = e > 0 ? 1 / Math.sqrt(e / 2) : 1;
  for (const ch of chans) for (let i = 0; i < len; i++) ch[i] *= g * 0.35;
  return chans;
}

/**
 * Parciales de una campana de bronce, relativos a la nota fundamental
 * ("prime"): el "hum" una octava abajo, la tercera menor (el color triste de
 * las campanas), la quinta, el "nominal" a la octava y los superiores
 * inarmónicos. [razón, amplitud, constante de caída en s]. Los graves duran
 * mucho más que los agudos: por eso el golpe brilla y la cola zumba.
 */
export const BELL_PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 0.32, 3.4],
  [1.0, 0.5, 2.6],
  [1.183, 0.42, 2.0],
  [1.506, 0.16, 1.3],
  [2.0, 0.55, 1.5],
  [2.514, 0.22, 0.95],
  [2.662, 0.2, 0.85],
  [3.011, 0.14, 0.62],
  [4.166, 0.11, 0.42],
  [5.433, 0.07, 0.28],
  [6.796, 0.05, 0.2],
];

/**
 * Un golpe de la campana de bronce, mono. Cada parcial grave es en realidad
 * un par de frecuencias muy cercanas (la campana no es perfectamente
 * simétrica): de ahí el "batido" lento que la hace sonar viva. Se sintetiza
 * con osciladores recursivos (una rotación por muestra, sin `Math.sin`), y
 * cada parcial se deja de calcular cuando ya cayó 80 dB.
 */
export function renderBell(
  sampleRate: number,
  seconds: number,
  fundamental: number,
  rnd: Rand,
): Float32Array {
  const len = Math.max(1, Math.floor(sampleRate * seconds));
  const out = new Float32Array(len);
  const nyq = sampleRate / 2;
  BELL_PARTIALS.forEach(([ratio, amp, tau], idx) => {
    const comps: Array<[number, number]> =
      idx < 6
        ? (() => {
            const beat = 0.4 + rnd() * 1.2;
            return [
              [fundamental * ratio - beat / 2, amp * 0.55],
              [fundamental * ratio + beat / 2, amp * 0.45],
            ];
          })()
        : [[fundamental * ratio * (1 + (rnd() - 0.5) * 0.004), amp]];
    for (const [f, a] of comps) {
      if (f >= nyq * 0.95) continue;
      const w = (2 * Math.PI * f) / sampleRate;
      const c = Math.cos(w);
      const s = Math.sin(w);
      const ph = rnd() * 2 * Math.PI;
      let x = Math.cos(ph);
      let y = Math.sin(ph);
      const decay = Math.exp(-1 / (tau * sampleRate));
      let env = a;
      const n = Math.min(len, Math.ceil(tau * 9.2 * sampleRate));
      for (let i = 0; i < n; i++) {
        out[i] += y * env;
        const nx = x * c - y * s;
        y = x * s + y * c;
        x = nx;
        env *= decay;
      }
    }
  });
  // Golpe del badajo: ruido muy corto y brillante.
  const strike = Math.floor(sampleRate * 0.006);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < strike && i < len; i++) {
    const w = rnd() * 2 - 1;
    hp = 0.7 * (hp + w - prev);
    prev = w;
    out[i] += hp * 0.5 * (1 - i / strike);
  }
  // Ataque de 1,5 ms (sin clic) y cola que llega a cero.
  const atk = Math.floor(sampleRate * 0.0015);
  for (let i = 0; i < atk && i < len; i++) out[i] *= i / atk;
  const tail = Math.floor(sampleRate * 0.4);
  for (let i = 0; i < tail && i < len; i++) out[len - 1 - i] *= i / tail;
  normalizePeak(out, 0.9);
  return out;
}

/**
 * Aplauso de una sala: cada persona aplaude a su propio ritmo y con su propio
 * "tono" de palmas (la forma de las manos cambia la resonancia). Cada palmada
 * es un ruido de pocos milisegundos por un resonador. Estéreo: la gente está
 * repartida alrededor.
 */
export function renderApplause(
  sampleRate: number,
  seconds: number,
  rnd: Rand,
  people = 24,
): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.floor(sampleRate * seconds));
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const clapLen = Math.floor(sampleRate * 0.03);
  for (let p = 0; p < people; p++) {
    const fc = 700 + rnd() * 1900;
    const q = 1.5 + rnd() * 2;
    const period = 0.22 + rnd() * 0.16;
    const pan = rnd();
    const gl = Math.cos((pan * Math.PI) / 2);
    const gr = Math.sin((pan * Math.PI) / 2);
    const loud = 0.4 + rnd() * 0.6;
    // Biquad pasabanda (RBJ), coeficientes fijos por persona.
    const w0 = (2 * Math.PI * fc) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b2 = -alpha / a0;
    const a1 = (-2 * Math.cos(w0)) / a0;
    const a2 = (1 - alpha) / a0;
    let t = rnd() * period;
    while (t < seconds) {
      const start = Math.floor(t * sampleRate);
      const amp = loud * (0.6 + rnd() * 0.4);
      const tauS = sampleRate * (0.003 + rnd() * 0.003);
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < clapLen && start + i < len; i++) {
        const x = (rnd() * 2 - 1) * Math.exp(-i / tauS);
        const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        L[start + i] += y * amp * gl;
        R[start + i] += y * amp * gr;
      }
      t += period * (0.85 + rnd() * 0.3);
    }
  }
  const peak = Math.max(peakOf(L), peakOf(R));
  if (peak > 0) {
    const g = 0.9 / peak;
    for (let i = 0; i < len; i++) {
      L[i] *= g;
      R[i] *= g;
    }
  }
  return [L, R];
}

export function peakOf(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rmsOf(data: Float32Array): number {
  let e = 0;
  for (let i = 0; i < data.length; i++) e += data[i] * data[i];
  return data.length ? Math.sqrt(e / data.length) : 0;
}

export function normalizePeak(data: Float32Array, target: number): void {
  const p = peakOf(data);
  if (p <= 0) return;
  const g = target / p;
  for (let i = 0; i < data.length; i++) data[i] *= g;
}
