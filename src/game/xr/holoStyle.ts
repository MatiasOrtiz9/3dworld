import { drawIcon, UI, type Ctx } from '../../ui/draw';
import type { IconId, SequenceToken } from '../activities/types';

/**
 * "VISOR 40": el estilo de los paneles del visor (panel principal, cartel,
 * aviso, muñeca y rótulos de los mandos).
 *
 * Cuatro reglas que un chico aprende solo, sin explicación:
 *  1. CIAN es lo que estás apuntando (y la estructura: marco, líneas).
 *  2. DORADO es lo importante: la opción recomendada, el 40, los valores y
 *     las fichas de los botones del mando ("dorado = un botón de tu mano").
 *  3. VERDE es bien/hecho/lugar; ROJO es cuidado/borrar. Nunca solos: siempre
 *     con un ícono, una forma o una palabra.
 *  4. Un botón es una pieza con ESCALÓN: sube al apuntarlo y se hunde al
 *     apretarlo. La decoración va en el marco, nunca detrás del texto.
 *
 * Todo es canvas 2D sin imágenes ni fuentes descargadas. Nada de esto se
 * llama por cuadro: el panel pinta una vez por `show` y por cambio de estado.
 * No toca `UI`, `roundRect`, `drawSequence` ni `drawGrid` de `ui/draw`: los
 * usa el HUD de escritorio y del celular.
 */

export const HOLO = {
  // Vidrio (alfa ≥ 0,94 detrás de texto: el fondo de la ciudad no se cuela entre las letras).
  glassTop: 'rgba(12,35,42,0.96)',
  glassMid: 'rgba(7,22,26,0.96)',
  glassBot: 'rgba(5,15,18,0.96)',
  glassInset: 'rgba(63,230,224,0.05)',
  /** Texto sobre cian o dorado macizo. */
  ink: '#04211f',
  // Cian: lo apuntado y la estructura.
  cyan: '#3fe6e0',
  cyanText: '#7ff3ee',
  cyanLine: 'rgba(63,230,224,0.45)',
  cyanFaint: 'rgba(63,230,224,0.14)',
  cyanHoverTop: '#15505a',
  cyanHoverBot: '#0f3a41',
  cyanLip: '#1a8f8a',
  // Dorado: lo importante.
  gold: '#f2c14e',
  goldHi: '#ffd56b',
  goldHot: '#ffe08a',
  goldDeep: '#c9982f',
  goldFill: 'rgba(242,193,78,0.16)',
  goldHoverFill: '#4d4018',
  goldLip: '#8a6a1e',
  goldSolidLip: '#b98a24',
  // Texto.
  text: '#eef6f2',
  /** Cuerpo secundario (≈11:1 sobre el vidrio). */
  body2: '#c9dcd7',
  /** Sólo subs y pie. */
  dim: '#a9c2b8',
  /** Rótulo deshabilitado (≈6:1: se lee, pero se nota apagado). */
  off: '#8ea8a1',
  // Semánticos.
  red40: '#c0303a',
  bad: '#ff6b5e',
  badFill: 'rgba(255,107,94,0.14)',
  badHoverFill: '#4a1f1c',
  badLip: '#6a2420',
  ok: '#5fe39a',
  okFill: 'rgba(95,227,154,0.16)',
  leaf: '#4faa7a',
  // Escalón y sombra.
  lip: '#0b3236',
  shadow: 'rgba(0,0,0,0.55)',
} as const;

/** Alto del escalón de un botón (px): se ve debajo de la cara, como una tecla. */
export const LIP = 6;

/** Cortes de una silueta biselada: arriba-izq, arriba-der, abajo-der, abajo-izq. */
export type Cuts = number | readonly [number, number, number, number];

export const font = (weight: number, size: number): string => `${weight} ${size}px ${UI.font}`;

// =================================================================== formas

/** Rectángulo con las esquinas cortadas en diagonal (sólo arma el camino). */
export function chamferRect(ctx: Ctx, x: number, y: number, w: number, h: number, cuts: Cuts): void {
  const [a, b, c, d] = typeof cuts === 'number' ? [cuts, cuts, cuts, cuts] : cuts;
  const m = Math.max(0, Math.min(w, h) / 2);
  const tl = Math.min(a, m);
  const tr = Math.min(b, m);
  const br = Math.min(c, m);
  const bl = Math.min(d, m);
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.lineTo(x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.lineTo(x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.lineTo(x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.closePath();
}

/**
 * Esquineros en L (la "mira"): marcan un rectángulo sin taparlo. `off` los
 * corre hacia afuera; con trazo de 4 y `off` 5 llegan a 7 px del borde,
 * dentro de la separación entre botones.
 */
export function cornerTicks(ctx: Ctx, x: number, y: number, w: number, h: number, len: number, lw: number, color: string, off = 0): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  const x0 = x - off;
  const y0 = y - off;
  const x1 = x + w + off;
  const y1 = y + h + off;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + len);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + len, y0);
  ctx.moveTo(x1 - len, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y0 + len);
  ctx.moveTo(x1, y1 - len);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - len, y1);
  ctx.moveTo(x0 + len, y1);
  ctx.lineTo(x0, y1);
  ctx.lineTo(x0, y1 - len);
  ctx.stroke();
  ctx.restore();
}

/** Hexágono con punta arriba (el retrato del diálogo: "canal de comunicación"). */
export function hexPath(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Rombo dorado (marca de misión y de pestaña). */
export function diamond(ctx: Ctx, cx: number, cy: number, size: number, color: string = HOLO.gold): void {
  const h = size / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h);
  ctx.lineTo(cx + h, cy);
  ctx.lineTo(cx, cy + h);
  ctx.lineTo(cx - h, cy);
  ctx.closePath();
  ctx.fill();
}

/**
 * Línea de circuito bajo el título: recta, baja 10 px a 45° y termina en un
 * nodo. El segmento grueso de la izquierda dice de qué color es el panel
 * (dorado normal, rojo en una confirmación que borra).
 */
export function circuitLine(ctx: Ctx, x0: number, y: number, x1: number, accent: string = HOLO.gold): void {
  ctx.save();
  ctx.strokeStyle = HOLO.cyanLine;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1 - 70, y);
  ctx.lineTo(x1 - 60, y + 10);
  ctx.lineTo(x1 - 5, y + 10);
  ctx.stroke();
  ctx.fillStyle = HOLO.cyan;
  ctx.beginPath();
  ctx.arc(x1, y + 10, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(x0, y - 2, 72, 4);
  ctx.restore();
}

/** Candado chico (deshabilitado): rectángulo y arco, trazo de 3 px a 26 px de alto. */
export function drawLock(ctx: Ctx, cx: number, cy: number, size: number, color: string): void {
  const k = size / 26;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 * k;
  ctx.lineJoin = 'round';
  ctx.strokeRect(cx - 8 * k, cy - 1 * k, 16 * k, 12 * k);
  ctx.beginPath();
  ctx.arc(cx, cy - 1 * k, 6 * k, Math.PI, 0);
  ctx.stroke();
  ctx.restore();
}

/**
 * Ícono de los paneles del visor. Las flechas (avanzar, girar, volver,
 * siguiente) van con trazo grueso y punta llena: las de `drawIcon` (las del
 * escritorio, que no se tocan) a 34 px dentro de la losa quedaban finitas y
 * el giro a la derecha parecía un "~". El giro es un codo de 90° claro: sube
 * y dobla. El resto, el de `drawIcon`.
 */
export function drawHoloIcon(ctx: Ctx, icon: IconId, cx: number, cy: number, s: number, color: string): void {
  const h = s / 2;
  const lw = Math.max(3, s * 0.13);
  const head = (tx: number, ty: number, dx: number, dy: number, len: number, half: number) => {
    // Punta llena: vértice en (tx, ty) mirando hacia (dx, dy).
    const bx = tx - dx * len;
    const by = ty - dy * len;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(bx - dy * half, by + dx * half);
    ctx.lineTo(bx + dy * half, by - dx * half);
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (icon) {
    case 'up':
    case 'step':
    case 'next': {
      if (icon === 'next') ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.8);
      ctx.lineTo(0, -h * 0.15);
      ctx.stroke();
      head(0, -h * 0.9, 0, -1, h * 0.8, h * 0.58);
      break;
    }
    case 'left':
    case 'right': {
      // Codo: sube desde abajo, dobla un cuarto de vuelta y sigue hacia el costado.
      ctx.scale(icon === 'left' ? -1 : 1, 1);
      const x0 = -h * 0.5;
      const r = h * 0.42;
      ctx.beginPath();
      ctx.moveTo(x0, h * 0.85);
      ctx.lineTo(x0, -h * 0.2 + r);
      ctx.arc(x0 + r, -h * 0.2 + r, r, Math.PI, Math.PI * 1.5);
      ctx.lineTo(h * 0.25, -h * 0.2);
      ctx.stroke();
      head(h * 0.92, -h * 0.2, 1, 0, h * 0.72, h * 0.52);
      break;
    }
    case 'door': {
      // Salida: un marco de puerta abierto a la derecha y una flecha que sale.
      // No es la ✗: en las actividades la ✗ ya quiere decir "esa no era".
      ctx.beginPath();
      ctx.moveTo(h * 0.15, -h * 0.4);
      ctx.lineTo(h * 0.15, -h * 0.85);
      ctx.lineTo(-h * 0.8, -h * 0.85);
      ctx.lineTo(-h * 0.8, h * 0.85);
      ctx.lineTo(h * 0.15, h * 0.85);
      ctx.lineTo(h * 0.15, h * 0.4);
      ctx.moveTo(-h * 0.4, 0);
      ctx.lineTo(h * 0.45, 0);
      ctx.stroke();
      head(h * 0.98, 0, 1, 0, h * 0.6, h * 0.42);
      break;
    }
    default:
      ctx.restore();
      drawIcon(ctx, icon, cx, cy, s, color);
      return;
  }
  ctx.restore();
}

/** Sello mini del 40 (anillo rojo, número dorado), arriba a la derecha de los paneles. */
export function miniSeal(ctx: Ctx, cx: number, cy: number, r = 22): void {
  ctx.save();
  ctx.fillStyle = UI.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = HOLO.red40;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = HOLO.gold;
  ctx.font = font(800, Math.round(r * 0.9));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('40', cx, cy + 1);
  ctx.restore();
}

// =================================================================== texto

/** Ancho de un texto con espaciado entre letras (sin depender de `ctx.letterSpacing`). */
export function spacedWidth(ctx: Ctx, text: string, sp: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + sp;
  return Math.max(0, w - sp);
}

/** Dibuja un texto espaciado desde x (alineado a la izquierda); devuelve el x final. */
export function spacedLeft(ctx: Ctx, text: string, x: number, y: number, sp: number): number {
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + sp;
  }
  ctx.textAlign = align;
  return x - sp;
}

/** Texto espaciado centrado en cx. */
export function spacedCenter(ctx: Ctx, text: string, cx: number, y: number, sp: number): void {
  spacedLeft(ctx, text, cx - spacedWidth(ctx, text, sp) / 2, y, sp);
}

/**
 * El tamaño (de a 2 px, entre `size` y `min`) en que el texto entra en
 * `maxW`. Deja puesta la fuente. Si ni al mínimo entra, devuelve el mínimo:
 * quien llama decide si parte en dos líneas o corta con "…". Nunca se
 * comprime con `maxWidth` (letras finas de 10 px no se leen en el visor).
 */
export function fitFont(ctx: Ctx, text: string, weight: number, size: number, min: number, maxW: number): number {
  let s = size;
  ctx.font = font(weight, s);
  while (s > min && ctx.measureText(text).width > maxW) {
    s -= 2;
    ctx.font = font(weight, s);
  }
  return s;
}

/** Corta con "…" lo que no entra (con la fuente puesta). */
export function ellipsize(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Parte un texto en líneas de `maxW` (con la fuente puesta); la última, con "…" si sobra. */
export function wrapLines(ctx: Ctx, text: string, maxW: number, maxLines = 99): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines - 1) {
        lines.push(ellipsize(ctx, words.slice(i).join(' '), maxW));
        return lines;
      }
    } else {
      line = test;
    }
  }
  if (line) lines.push(lines.length === maxLines - 1 ? ellipsize(ctx, line, maxW) : line);
  return lines;
}

/**
 * Hasta dos líneas que se lean como frases: si hay " · ", se corta ahí
 * (sin el punto); si hay un paréntesis, antes de él; si no, el corte que
 * deja las dos líneas más parejas (sin una palabra huérfana abajo). Con la
 * fuente puesta.
 */
export function wrapSmart(ctx: Ctx, text: string, maxW: number): string[] {
  const fits = (s: string) => ctx.measureText(s).width <= maxW;
  if (fits(text)) return [text];
  const best = (cands: Array<[string, string]>): string[] | null => {
    let pick: [string, string] | null = null;
    let score = Infinity;
    for (const [a, b] of cands) {
      if (!fits(a) || !fits(b)) continue;
      const s = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (s < score) {
        score = s;
        pick = [a, b];
      }
    }
    return pick;
  };
  const parts = text.split(' · ');
  if (parts.length > 1) {
    // La primera línea cierra con " ·": sin el punto, "Agarrar / mover panel"
    // se leía como una sola frase ("Agarrar mover panel").
    const r = best(parts.slice(1).map((_, k) => [`${parts.slice(0, k + 1).join(' · ')} ·`, parts.slice(k + 1).join(' · ')]));
    if (r) return r;
  }
  const paren = text.indexOf(' (');
  if (paren > 0) {
    const r = best([[text.slice(0, paren), text.slice(paren + 1)]]);
    if (r) return r;
  }
  const words = text.split(/\s+/);
  const r = best(words.slice(1).map((_, k) => [words.slice(0, k + 1).join(' '), words.slice(k + 1).join(' ')]));
  return r ?? wrapLines(ctx, text, maxW, 2);
}

/** Dibuja líneas desde la base `y` (con la fuente, el color y la alineación puestos); devuelve el y siguiente. */
export function drawLines(ctx: Ctx, lines: readonly string[], x: number, y: number, lineH: number): number {
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
  return y + lines.length * lineH;
}

// ==================================================================== pestaña

/**
 * Pestaña del encabezado (kicker): rombo dorado y el rótulo en MAYÚSCULAS
 * espaciadas, con el lado derecho en diagonal. Devuelve el borde derecho.
 */
export function kickerTab(ctx: Ctx, text: string, x: number, y: number, maxW: number, tone: 'normal' | 'bad' = 'normal'): number {
  const t = text.toUpperCase();
  const h = 40;
  // Primero se achica el espaciado, después la letra, y recién al final se corta.
  let sp = 3;
  let size = 26;
  ctx.font = font(700, size);
  while (spacedWidth(ctx, t, sp) + 52 > maxW && (sp > 1 || size > 22)) {
    if (sp > 1) sp--;
    else size -= 2;
    ctx.font = font(700, size);
  }
  let shown = t;
  if (spacedWidth(ctx, shown, sp) + 52 > maxW) {
    while (shown.length > 1 && spacedWidth(ctx, `${shown}…`, sp) + 52 > maxW) shown = shown.slice(0, -1);
    shown = `${shown.trimEnd()}…`;
  }
  const w = spacedWidth(ctx, shown, sp) + 52;
  ctx.save();
  ctx.fillStyle = tone === 'bad' ? HOLO.badFill : HOLO.cyanFaint;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - 14, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  diamond(ctx, x + 18, y + h / 2, 12, tone === 'bad' ? HOLO.bad : HOLO.gold);
  ctx.fillStyle = tone === 'bad' ? '#ffb3aa' : HOLO.cyanText;
  ctx.textBaseline = 'middle';
  spacedLeft(ctx, shown, x + 36, y + h / 2 + 1, sp);
  ctx.restore();
  return x + w;
}

// ============================================================ fichas del mando

const KEYS: ReadonlyMap<string, string> = new Map([
  ['gatillo', 'Gatillo'],
  ['a', 'A'],
  ['b', 'B'],
  ['x', 'X'],
  ['y', 'Y'],
  ['grip', 'Grip'],
  ['stick', 'Stick'],
  ['clic', 'Clic'],
  // De qué mano, cuando importa (el clic del stick izquierdo corre; el del derecho, "¿adónde voy?").
  ['stick izq.', 'Stick izq.'],
  ['stick der.', 'Stick der.'],
  ['clic izq.', 'Clic izq.'],
  ['clic der.', 'Clic der.'],
]);

/** Nombre canónico de un botón del mando ("gatillo" → "Gatillo"), o null si no es uno. */
export function keyName(s: string): string | null {
  return KEYS.get(s.trim().toLowerCase()) ?? null;
}

const isLetter = (k: string): boolean => /^[ABXY]$/.test(k);
/**
 * Stick y Clic llevan un puntito a la izquierda: la cabeza del stick. Así
 * "Clic" se lee "apretá el stick" y no un botón suelto que no existe.
 */
const isDotted = (k: string): boolean => k.startsWith('Stick') || k.startsWith('Clic');

/** Ancho de una ficha (sin dibujarla). */
export function keyChipWidth(ctx: Ctx, key: string, h = 40): number {
  const k = keyName(key) ?? key;
  if (isLetter(k)) return h;
  const s = h / 40;
  ctx.font = font(800, Math.round(24 * s));
  const extra = isDotted(k) ? 12 * s : 0;
  return Math.max(44 * s, ctx.measureText(k).width + 26 * s + extra);
}

/**
 * Ficha de un botón del mando, siempre dorada. A/B/X/Y redondas como en el
 * Quest; Gatillo, Grip, Stick y Clic, biseladas con la palabra. Se dibuja
 * desde `x` centrada en `cy`; devuelve el ancho.
 */
export function keyChip(ctx: Ctx, key: string, x: number, cy: number, h = 40): number {
  const k = keyName(key) ?? key;
  const s = h / 40;
  const w = keyChipWidth(ctx, k, h);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (isLetter(k)) {
    ctx.fillStyle = HOLO.gold;
    ctx.beginPath();
    ctx.arc(x + h / 2, cy, h / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = HOLO.goldHot;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + h / 2, cy, h / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = HOLO.ink;
    ctx.font = font(800, Math.round(26 * s));
    ctx.fillText(k, x + h / 2, cy + 1);
  } else {
    ctx.fillStyle = HOLO.gold;
    chamferRect(ctx, x, cy - h / 2, w, h, 8 * s);
    ctx.fill();
    ctx.fillStyle = HOLO.ink;
    ctx.font = font(800, Math.round(24 * s));
    if (isDotted(k)) {
      ctx.beginPath();
      ctx.arc(x + 15 * s, cy, 4 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(k, x + w / 2 + 6 * s, cy + 1);
    } else {
      ctx.fillText(k, x + w / 2, cy + 1);
    }
  }
  ctx.restore();
  return w;
}

/** Un tramo de una fila de pistas: fichas + verbo, o texto llano. */
export type HintSeg = { kind: 'keys'; keys: string[]; seps: Array<'o' | ','>; verb: string } | { kind: 'plain'; text: string };

/** "Gatillo o A" / "Gatillo, A o B" → fichas, o null si algo no es un botón del mando. */
function parseKeys(s: string): { keys: string[]; seps: Array<'o' | ','> } | null {
  const parts = s.trim().split(/(\s+o\s+|\s*,\s*)/);
  const keys: string[] = [];
  const seps: Array<'o' | ','> = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      seps.push(parts[i].includes(',') ? ',' : 'o');
      continue;
    }
    const k = keyName(parts[i]);
    if (!k) return null;
    keys.push(k);
  }
  return keys.length ? { keys, seps } : null;
}

/** Mayúscula en la primera letra ("¿adónde voy?" → "¿Adónde voy?"). */
const capital = (s: string): string => s.replace(/\p{L}/u, (c) => c.toUpperCase());

/**
 * Lee un texto de pistas ("Gatillo o A: elegir · B: volver", o el del
 * cartel "A o gatillo · Saludar") y lo separa en fichas y verbos. Lo que no
 * son botones del mando ("Se guarda en este visor.") queda como texto llano.
 * El texto del modelo no cambia: sólo cómo se pinta.
 */
export function parseHints(text: string): HintSeg[] {
  const segs = text
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: HintSeg[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const colon = s.indexOf(':');
    if (colon > 0) {
      const k = parseKeys(s.slice(0, colon));
      if (k) {
        out.push({ kind: 'keys', ...k, verb: capital(s.slice(colon + 1).trim()) });
        continue;
      }
    }
    const k = parseKeys(s);
    if (k && i + 1 < segs.length && !parseKeys(segs[i + 1])) {
      out.push({ kind: 'keys', ...k, verb: capital(segs[i + 1]) });
      i++;
      continue;
    }
    out.push({ kind: 'plain', text: s });
  }
  // Sin ninguna ficha es una frase (el resumen del pasaporte): se pinta entera.
  if (!out.some((s) => s.kind === 'keys')) return [{ kind: 'plain', text: text.trim() }];
  return out;
}

/** Separación entre tramos de una fila de pistas (lleva un punto cian en el medio). */
const SEG_GAP = 40;

/** Ancho de un tramo de pistas (fichas + verbo, o texto llano) con fichas de alto `h` y letra `size`. */
function measureSeg(ctx: Ctx, s: HintSeg, h: number, size: number): number {
  if (s.kind === 'plain') {
    ctx.font = font(600, size);
    return ctx.measureText(s.text).width;
  }
  let w = 0;
  s.keys.forEach((k, j) => {
    if (j > 0) {
      ctx.font = font(500, 24);
      w += ctx.measureText('o').width + 20;
    }
    w += keyChipWidth(ctx, k, h);
  });
  if (s.verb) {
    ctx.font = font(600, size);
    w += 12 + ctx.measureText(s.verb).width;
  }
  return w;
}

/** Ancho de una fila de pistas entera. */
export function measureKeyRow(ctx: Ctx, segs: readonly HintSeg[], h = 40, size = 28): number {
  let w = 0;
  segs.forEach((s, i) => {
    if (i > 0) w += SEG_GAP;
    w += measureSeg(ctx, s, h, size);
  });
  return w;
}

/**
 * Reparte los tramos en filas de `maxW` (sin partir ninguno: una ficha y su
 * verbo van siempre juntos). Para el aviso de controles, que en una sola
 * fila se cortaba con "…" justo antes de "Y: menú".
 */
export function splitKeyRows(ctx: Ctx, segs: readonly HintSeg[], maxW: number, h = 40, size = 28): HintSeg[][] {
  const rows: HintSeg[][] = [];
  let row: HintSeg[] = [];
  let w = 0;
  for (const s of segs) {
    const sw = measureSeg(ctx, s, h, size);
    if (row.length && w + SEG_GAP + sw > maxW) {
      rows.push(row);
      row = [];
      w = 0;
    }
    w += (row.length ? SEG_GAP : 0) + sw;
    row.push(s);
  }
  if (row.length) rows.push(row);
  return rows;
}

/**
 * Fila de pistas: fichas doradas y el verbo, o texto llano en gris. Centrada
 * en `x` (o desde `x` con `align: 'left'`). Si no entra, primero baja la
 * letra y las fichas; lo que igual sobra se corta con "…".
 */
export function drawKeyRow(
  ctx: Ctx,
  text: string | HintSeg[],
  x: number,
  cy: number,
  maxW: number,
  opts: { h?: number; size?: number; align?: 'center' | 'left'; plainColor?: string; verbColor?: string } = {},
): void {
  const segs = typeof text === 'string' ? parseHints(text) : text;
  let h = opts.h ?? 40;
  let size = opts.size ?? 28;
  const plainColor = opts.plainColor ?? HOLO.dim;
  const verbColor = opts.verbColor ?? HOLO.text;
  let total = measureKeyRow(ctx, segs, h, size);
  while (total > maxW && size > 24) {
    size -= 2;
    h = Math.max(34, h - 2);
    total = measureKeyRow(ctx, segs, h, size);
  }
  let at = opts.align === 'left' ? x : x - Math.min(total, maxW) / 2;
  const end = at + maxW;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  segs.forEach((s, i) => {
    if (i > 0) {
      // Separador: un punto cian chico entre tramos.
      ctx.fillStyle = HOLO.cyanLine;
      ctx.beginPath();
      ctx.arc(at + SEG_GAP / 2, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      at += SEG_GAP;
    }
    if (s.kind === 'plain') {
      ctx.font = font(600, size);
      ctx.fillStyle = plainColor;
      const t = ellipsize(ctx, s.text, Math.max(0, end - at));
      ctx.fillText(t, at, cy + 1);
      at += ctx.measureText(t).width;
      return;
    }
    s.keys.forEach((k, j) => {
      if (j > 0) {
        // "Gatillo, A o B" también lleva la "o" entre fichas: pegadas se
        // leían como una combinación ("Gatillo+A").
        ctx.font = font(500, 24);
        ctx.fillStyle = HOLO.dim;
        ctx.fillText('o', at + 10, cy + 1);
        at += ctx.measureText('o').width + 20;
      }
      at += keyChip(ctx, k, at, cy, h);
    });
    if (s.verb) {
      ctx.font = font(600, size);
      ctx.fillStyle = verbColor;
      const t = ellipsize(ctx, s.verb, Math.max(0, end - at - 12));
      ctx.fillText(t, at + 12, cy + 1);
      at += 12 + ctx.measureText(t).width;
    }
  });
  ctx.restore();
}

// ================================================================= botones

export interface HoloButton {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  value?: string;
  /**
   * `ghost`: la salida de una actividad. En reposo, apagado (sin riel ni
   * relleno, rótulo tenue): no se confunde con una respuesta más. Apuntado y
   * apretado, como cualquier botón.
   */
  tone: 'accent' | 'bad' | 'normal' | 'ghost';
  icon?: IconId;
  disabled: boolean;
  /** Apagado mientras la actividad anima: como deshabilitado, sin candado (vuelve solo). */
  busy?: boolean;
  /** Relleno dorado macizo: el botón principal del inicio. */
  solid: boolean;
  align: 'left' | 'center';
  font: number;
  /** Fichas del mando siempre visibles a la derecha ([B] en Volver, (A) en Continuar). */
  keys?: readonly string[];
}

export type HoloState = 'normal' | 'hover' | 'press' | 'flash';

const BTN_CUTS = [16, 4, 16, 4] as const;
/** Ficha "A" del resaltado: reserva fija (se decide sin mirar el estado: el botón no cambia de forma al apuntarlo). */
const A_RESERVE = 60;
const KEY_H = 36;

const isToggle = (v: string | undefined): boolean => v === 'Sí' || v === 'No';

/** Cuánto ocupan a la derecha las fichas fijas y la "A" del resaltado. */
function keyReserve(ctx: Ctx, b: HoloButton): { fixed: number; showA: boolean } {
  let fixed = 0;
  for (const k of b.keys ?? []) fixed += keyChipWidth(ctx, k, KEY_H) + 10;
  // En tres columnas (≈300 px) no: la reserva le dejaba 120 px al rótulo y
  // "Girar izq." se partía en dos. Ahí el resaltado ya lo dicen la mira, el escalón y el riel.
  const showA = b.w >= 320 && !b.value && !(b.keys ?? []).includes('A');
  return { fixed, showA };
}

/**
 * Un botón del panel en un estado. La ZONA de clic sigue siendo el
 * rectángulo completo (x, y, w, h) con el escalón incluido: el dibujo no la
 * achica. Normal va en el respaldo; resaltado, apretado y el destello se
 * pintan encima al componer.
 */
export function paintHoloButton(ctx: Ctx, b: HoloButton, state: HoloState): void {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (b.disabled) {
    paintOff(ctx, b);
    ctx.restore();
    return;
  }
  const hover = state === 'hover';
  const pressed = state === 'press' || state === 'flash';
  const accent = b.tone === 'accent';
  const bad = b.tone === 'bad';
  // La salida en reposo: sin color propio (ni riel ni relleno), sólo el contorno gris.
  const ghost = b.tone === 'ghost' && !hover && !pressed;
  const { x, w } = b;
  const faceH = b.h - LIP;
  const fy = b.y + (hover ? -3 : pressed ? 4 : 0);
  const cy = fy + faceH / 2;

  // Escalón (debajo de la cara: se ve 6 px en reposo, 9 apuntado, 2 apretado).
  let lip: string = HOLO.lip;
  if (b.solid) lip = HOLO.goldSolidLip;
  else if (bad) lip = HOLO.badLip;
  else if (accent) lip = HOLO.goldLip;
  else if (hover || pressed) lip = HOLO.cyanLip;
  ctx.fillStyle = lip;
  chamferRect(ctx, x, b.y + LIP, w, b.h - LIP, BTN_CUTS);
  ctx.fill();

  // Cara: primero opaca (que el escalón no se transparente), después el tono.
  ctx.fillStyle = '#0a1d21';
  chamferRect(ctx, x, fy, w, faceH, BTN_CUTS);
  ctx.fill();
  let face: string | CanvasGradient;
  if (pressed) face = b.solid ? HOLO.goldDeep : bad ? HOLO.bad : HOLO.cyan;
  else if (hover) {
    if (b.solid) face = HOLO.goldHot;
    else if (accent) {
      // Dorado que se enciende (no un marrón apagado): la opción segura, apuntada, sigue leyéndose dorada.
      const g = ctx.createLinearGradient(0, fy, 0, fy + faceH);
      g.addColorStop(0, '#6b5519');
      g.addColorStop(1, HOLO.goldHoverFill);
      face = g;
    }
    else if (bad) face = HOLO.badHoverFill;
    else {
      const g = ctx.createLinearGradient(0, fy, 0, fy + faceH);
      g.addColorStop(0, HOLO.cyanHoverTop);
      g.addColorStop(1, HOLO.cyanHoverBot);
      face = g;
    }
  } else if (b.solid) {
    const g = ctx.createLinearGradient(0, fy, 0, fy + faceH);
    g.addColorStop(0, HOLO.goldHi);
    g.addColorStop(1, HOLO.gold);
    face = g;
  } else face = accent ? HOLO.goldFill : bad ? HOLO.badFill : ghost ? 'rgba(0,0,0,0)' : 'rgba(127,230,224,0.07)';
  if (!ghost) {
    ctx.fillStyle = face;
    chamferRect(ctx, x, fy, w, faceH, BTN_CUTS);
    ctx.fill();
  }

  // Riel a la izquierda (dentro de la cara).
  ctx.save();
  chamferRect(ctx, x, fy, w, faceH, BTN_CUTS);
  ctx.clip();
  if (pressed) {
    ctx.fillStyle = 'rgba(4,33,31,0.35)';
    ctx.fillRect(x, fy + 10, 6, faceH - 20);
  } else if (hover) {
    ctx.fillStyle = accent ? HOLO.gold : HOLO.cyan;
    ctx.fillRect(x, fy + 10, 10, faceH - 20);
  } else if (!b.solid && !ghost) {
    ctx.fillStyle = accent ? HOLO.gold : bad ? HOLO.bad : 'rgba(63,230,224,0.55)';
    ctx.fillRect(x, fy + 10, accent ? 8 : 6, faceH - 20);
  }
  if (b.solid && !pressed) {
    // Brillo de arriba, como una tecla de plástico.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x + 22, fy + 6, w - 32, 2);
  }
  ctx.restore();

  // Contorno.
  if (hover) {
    ctx.save();
    ctx.shadowColor = 'rgba(63,230,224,0.85)';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = HOLO.cyan;
    ctx.lineWidth = 4;
    chamferRect(ctx, x, fy, w, faceH, BTN_CUTS);
    ctx.stroke();
    ctx.restore();
  } else if (pressed) {
    ctx.strokeStyle = b.solid ? HOLO.cyan : '#e9fffd';
    ctx.lineWidth = 3;
    chamferRect(ctx, x, fy, w, faceH, BTN_CUTS);
    ctx.stroke();
  } else if (!b.solid) {
    ctx.strokeStyle = accent ? HOLO.gold : bad ? HOLO.bad : ghost ? 'rgba(169,194,184,0.45)' : HOLO.cyanLine;
    ctx.lineWidth = accent ? 3 : 2;
    chamferRect(ctx, x, fy, w, faceH, BTN_CUTS);
    ctx.stroke();
  }
  if (state === 'flash') {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    chamferRect(ctx, x + 6, fy + 6, w - 12, faceH - 12, [12, 2, 12, 2]);
    ctx.stroke();
  }
  // Mira: esquineros por fuera (hasta 7 px, dentro de la separación).
  if (hover || pressed) cornerTicks(ctx, x, fy, w, faceH, 22, 4, HOLO.cyan, 5);

  const dark = pressed || b.solid;
  const ink = dark ? HOLO.ink : hover && accent ? HOLO.goldHot : ghost ? HOLO.dim : HOLO.text;
  const subColor = dark ? 'rgba(4,33,31,0.78)' : HOLO.dim;

  // Losa del ícono.
  if (b.icon) {
    const sx = x + 22;
    const sy = cy - 28;
    chamferRect(ctx, sx, sy, 56, 56, 8);
    let iconColor: string;
    if (hover) {
      ctx.fillStyle = HOLO.cyan;
      ctx.fill();
      iconColor = HOLO.ink;
    } else if (dark) {
      ctx.fillStyle = 'rgba(4,33,31,0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(4,33,31,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      iconColor = HOLO.ink;
    } else if (ghost) {
      // Losa sin relleno: el ícono de la salida no compite con las respuestas.
      ctx.strokeStyle = 'rgba(169,194,184,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      iconColor = HOLO.dim;
    } else {
      ctx.fillStyle = HOLO.cyanFaint;
      ctx.fill();
      ctx.strokeStyle = 'rgba(63,230,224,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      iconColor = accent ? HOLO.gold : HOLO.cyanText;
    }
    drawHoloIcon(ctx, b.icon, sx + 28, sy + 28, 36, iconColor);
  }

  const left = x + (b.icon ? 96 : 30);
  if (b.value) {
    paintValue(ctx, b, left, cy, ink, subColor, hover || pressed, pressed);
    ctx.restore();
    return;
  }
  // Fichas del mando a la derecha: las fijas y, apuntado, la "A". Con el
  // detalle debajo del rótulo van a la altura del rótulo; si el rótulo no
  // entra al lado de la "A", la "A" baja a la línea del detalle y el rótulo
  // usa todo el ancho ("Sí, borrar y empezar" se cortaba con "…"). Se decide
  // sin mirar el estado: el botón no cambia de forma al apuntarlo.
  const { fixed, showA } = keyReserve(ctx, b);
  const textRight = x + w - 24 - fixed - (showA ? A_RESERVE : 0);
  const below = subBelow(ctx, b, textRight - left);
  let aDown = false;
  if (below && !fixed && showA) {
    ctx.font = font(b.solid || accent ? 800 : 700, Math.max(Math.min(b.font, 30), b.font - 4));
    aDown = ctx.measureText(b.label).width > textRight - left;
  }
  const chipCy = below ? cy - 14 : cy;
  let right = x + w - 24;
  for (const k of [...(b.keys ?? [])].reverse()) {
    const cw = keyChipWidth(ctx, k, KEY_H);
    keyChip(ctx, k, right - cw, chipCy, KEY_H);
    right -= cw + 10;
  }
  if (showA && hover) {
    if (aDown) keyChip(ctx, 'A', x + w - 24 - KEY_H, cy + 18, KEY_H);
    else keyChip(ctx, 'A', right - KEY_H, chipCy, KEY_H);
  }
  paintLabel(ctx, b, left, textRight, cy, ink, subColor, undefined, x + w - 24 - (aDown ? A_RESERVE : 0), aDown ? x + w - 24 : textRight);
  ctx.restore();
}

/** ¿El detalle va debajo del rótulo? (no entran los dos en la misma línea). */
function subBelow(ctx: Ctx, b: HoloButton, room: number, weight?: number): boolean {
  if (!b.sub) return false;
  // Con ícono (y sin ser el principal), siempre debajo: al lado, en un botón
  // ancho ("Salir de VR" a todo lo ancho), el detalle quedaba a 400 px del
  // rótulo y parecía otra cosa. Así todas las filas del menú se leen igual.
  if (b.icon && !b.solid && b.tone !== 'accent') return true;
  ctx.font = font(weight ?? (b.solid || b.tone === 'accent' ? 800 : 700), b.font);
  const lw = ctx.measureText(b.label).width;
  ctx.font = font(600, 26);
  return lw + ctx.measureText(b.sub).width + 24 > room;
}

/**
 * Rótulo (y detalle) de un botón común. Con el detalle debajo, `labelRight`
 * es hasta dónde va el rótulo y `subRight` hasta dónde va el detalle (las
 * fichas quedan donde no los tapen).
 */
function paintLabel(
  ctx: Ctx,
  b: HoloButton,
  left: number,
  right: number,
  cy: number,
  ink: string,
  subColor: string,
  weight?: number,
  subRight = right,
  labelRight = right,
): void {
  const w = weight ?? (b.solid || b.tone === 'accent' ? 800 : 700);
  const room = right - left;
  ctx.textAlign = 'left';
  if (b.sub) {
    if (!subBelow(ctx, b, room, w)) {
      // Rótulo y detalle en la misma línea (el detalle, a la derecha).
      ctx.fillStyle = subColor;
      ctx.textAlign = 'right';
      ctx.fillText(b.sub, right, cy + 2);
      ctx.textAlign = 'left';
      ctx.font = font(w, b.font);
      ctx.fillStyle = ink;
      ctx.fillText(b.label, left, cy + 1);
      return;
    }
    const lroom = labelRight - left;
    fitFont(ctx, b.label, w, b.font, Math.max(Math.min(b.font, 30), b.font - 4), lroom);
    ctx.fillStyle = ink;
    ctx.fillText(ellipsize(ctx, b.label, lroom), left, cy - 14);
    fitFont(ctx, b.sub, 600, 26, 24, subRight - left);
    ctx.fillStyle = subColor;
    ctx.fillText(ellipsize(ctx, b.sub, subRight - left), left, cy + 20);
    return;
  }
  ctx.fillStyle = ink;
  // Una línea al tamaño pedido o 2 px menos; si no, DOS líneas (bajando de a
  // 2 px, nunca por debajo de 30); recién al final, "…". Antes bajaba a 28
  // en una línea y la respuesta larga de la trivia quedaba chica.
  const min = Math.min(b.font, 30);
  for (let size = b.font; size >= Math.max(min, b.font - 2); size -= 2) {
    ctx.font = font(w, size);
    if (ctx.measureText(b.label).width > room) continue;
    if (b.align === 'center' && !b.icon) {
      ctx.textAlign = 'center';
      ctx.fillText(b.label, (left + right) / 2, cy + 1);
    } else {
      ctx.fillText(b.label, left, cy + 1);
    }
    return;
  }
  for (let size = b.font; size >= min; size -= 2) {
    ctx.font = font(w, size);
    const lines = wrapSmart(ctx, b.label, room);
    const ok = lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= room);
    if (!ok && size - 2 >= min) continue;
    const shown = ok ? lines : wrapLines(ctx, b.label, room, 2);
    const lh = size + 2;
    shown.forEach((l, i) => ctx.fillText(l, left, cy + 1 + (i - (shown.length - 1) / 2) * lh));
    return;
  }
}

/** Fila de ajuste: rótulo a la izquierda y la casilla de valor (o el interruptor Sí/No) a la derecha. */
function paintValue(ctx: Ctx, b: HoloButton, left: number, cy: number, ink: string, subColor: string, inverted: boolean, pressed: boolean): void {
  const value = b.value ?? '';
  const edge = b.x + b.w - 24;
  let boxLeft: number;
  let sub: string | undefined;
  if (isToggle(value)) {
    boxLeft = drawToggle(ctx, edge, cy, value === 'Sí', pressed ? HOLO.ink : HOLO.text);
    // El interruptor no dice qué hace: el detalle se queda debajo del rótulo.
    sub = b.sub;
  } else {
    boxLeft = drawValueBox(ctx, edge, cy, value, inverted, Math.max(120, b.w * 0.5));
  }
  const room = boxLeft - 16 - left;
  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  const size = fitFont(ctx, b.label, 700, 30, 28, room);
  if (sub) {
    ctx.fillText(ellipsize(ctx, b.label, room), left, cy - 14);
    ctx.font = font(600, 26);
    ctx.fillStyle = subColor;
    ctx.fillText(ellipsize(ctx, sub, room), left, cy + 20);
    return;
  }
  if (ctx.measureText(b.label).width <= room) {
    ctx.fillText(b.label, left, cy + 1);
    return;
  }
  // "Velocidad del giro continuo": dos líneas de 30, nunca aplastado.
  ctx.font = font(700, Math.max(size, 28));
  const lines = wrapSmart(ctx, b.label, room);
  lines.forEach((l, i) => ctx.fillText(l, left, cy + 1 + (i - (lines.length - 1) / 2) * 32));
}

/**
 * Casilla del valor de un ajuste, pegada a `right`: dorada, con un chevron
 * cian que dice "tocá y cambia". Invertida (fondo dorado) al apuntarla.
 * Devuelve su borde izquierdo.
 */
export function drawValueBox(ctx: Ctx, right: number, cy: number, value: string, inverted: boolean, maxW = 360): number {
  ctx.save();
  const size = fitFont(ctx, value, 800, 30, 26, maxW - 56);
  const text = ellipsize(ctx, value, maxW - 56);
  const bw = ctx.measureText(text).width + 56;
  const bx = right - bw;
  chamferRect(ctx, bx, cy - 24, bw, 48, 8);
  ctx.fillStyle = inverted ? HOLO.gold : HOLO.goldFill;
  ctx.fill();
  ctx.strokeStyle = HOLO.gold;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = inverted ? HOLO.ink : HOLO.gold;
  ctx.font = font(800, size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 16, cy + 1);
  const chx = bx + bw - 20;
  ctx.strokeStyle = inverted ? HOLO.ink : HOLO.cyan;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(chx - 4, cy - 7);
  ctx.lineTo(chx + 3, cy);
  ctx.lineTo(chx - 4, cy + 7);
  ctx.stroke();
  ctx.restore();
  return bx;
}

/**
 * Interruptor Sí/No pegado a `right`, con la palabra a su izquierda (el
 * color solo no alcanza). Devuelve su borde izquierdo (el de la palabra).
 */
export function drawToggle(ctx: Ctx, right: number, cy: number, on: boolean, wordColor: string = HOLO.text): number {
  ctx.save();
  const cw = 92;
  const ch = 46;
  const x = right - cw;
  const r = ch / 2;
  ctx.fillStyle = on ? HOLO.ok : '#2b3d3b';
  ctx.beginPath();
  ctx.arc(x + r, cy, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.arc(x + cw - r, cy, r, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  if (!on) {
    ctx.strokeStyle = 'rgba(169,194,184,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = on ? '#ffffff' : HOLO.dim;
  ctx.beginPath();
  ctx.arc(on ? x + cw - r : x + r, cy, 18, 0, Math.PI * 2);
  ctx.fill();
  const word = on ? 'Sí' : 'No';
  ctx.font = font(700, 30);
  ctx.fillStyle = wordColor;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, x - 12, cy + 1);
  const left = x - 12 - ctx.measureText(word).width;
  ctx.restore();
  return left;
}

/** Deshabilitado (con candado) u ocupado (sin candado): sin escalón ni riel, contorno punteado, sin `globalAlpha`. */
function paintOff(ctx: Ctx, b: HoloButton): void {
  const { x, w } = b;
  const faceH = b.h - LIP;
  const cy = b.y + faceH / 2;
  // Ya probada y no era (la respuesta de la trivia, el tacho equivocado):
  // contorno rojo y una ✗. El candado dice "todavía no", y eso no es.
  const wrong = b.tone === 'bad' && !b.busy;
  chamferRect(ctx, x, b.y, w, faceH, BTN_CUTS);
  ctx.fillStyle = wrong ? 'rgba(255,107,94,0.06)' : 'rgba(255,255,255,0.03)';
  ctx.fill();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = wrong ? 'rgba(255,107,94,0.6)' : 'rgba(169,194,184,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);
  if (b.icon) drawHoloIcon(ctx, b.icon, x + 50, cy, 34, HOLO.off);
  let right = x + w - 24;
  const left = x + (b.icon ? 96 : 30);
  if (!b.busy) {
    const below = subBelow(ctx, b, right - 40 - left, 700);
    const my = below ? cy - 14 : cy;
    if (wrong) {
      ctx.save();
      ctx.strokeStyle = HOLO.bad;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(right - 22, my - 9);
      ctx.lineTo(right - 4, my + 9);
      ctx.moveTo(right - 4, my - 9);
      ctx.lineTo(right - 22, my + 9);
      ctx.stroke();
      ctx.restore();
    } else {
      drawLock(ctx, right - 13, my, 26, HOLO.off);
    }
    right -= 40;
  }
  // El detalle (el porqué) puede pasar por debajo del candado.
  paintLabel(ctx, { ...b, value: undefined }, left, right, cy, HOLO.off, HOLO.dim, 700, x + w - 24);
}

// ============================================================== actividades

/**
 * Fichas de una secuencia (programa del robot, pasos de baile) en el estilo
 * del visor: cargada maciza con borde cian, activa dorada, hecha verde,
 * error roja; sólo lo libre o lo oculto va punteado.
 * Devuelve el y libre debajo.
 */
export function drawHoloSequence(
  ctx: Ctx,
  tokens: readonly SequenceToken[],
  x: number,
  y: number,
  w: number,
  chip: number,
  free = 0,
  /** Con el programa vacío, un "+" en el primer lugar: "acá se suman las órdenes". */
  plus = false,
): number {
  const gap = Math.round(chip * 0.18);
  const perRow = Math.max(1, Math.floor((w + gap) / (chip + gap)));
  ctx.save();
  // Lugares libres después de la última orden ("entran más"), punteados y sin ícono.
  for (let k = tokens.length; k < tokens.length + free; k++) {
    const cx = x + (k % perRow) * (chip + gap);
    const cy = y + Math.floor(k / perRow) * (chip + gap);
    chamferRect(ctx, cx, cy, chip, chip, chip * 0.2);
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(63,230,224,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    if (plus && k === 0) {
      const a = chip * 0.18;
      ctx.strokeStyle = HOLO.cyanText;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + chip / 2 - a, cy + chip / 2);
      ctx.lineTo(cx + chip / 2 + a, cy + chip / 2);
      ctx.moveTo(cx + chip / 2, cy + chip / 2 - a);
      ctx.lineTo(cx + chip / 2, cy + chip / 2 + a);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }
  tokens.forEach((t, k) => {
    const cx = x + (k % perRow) * (chip + gap);
    const cy = y + Math.floor(k / perRow) * (chip + gap);
    chamferRect(ctx, cx, cy, chip, chip, chip * 0.2);
    let fg: string = HOLO.text;
    if (t.state === 'idle') {
      // Orden ya cargada: ficha maciza con borde entero. Punteada parecía un
      // lugar vacío y el chico creía que el botón no había tomado.
      ctx.fillStyle = '#0a1d21';
      ctx.fill();
      ctx.fillStyle = HOLO.cyanFaint;
      ctx.fill();
      ctx.strokeStyle = HOLO.cyan;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (t.state === 'active') {
      ctx.fillStyle = HOLO.gold;
      ctx.fill();
      fg = HOLO.ink;
    } else if (t.state === 'done' || t.state === 'wrong') {
      const good = t.state === 'done';
      ctx.fillStyle = '#0a1d21';
      ctx.fill();
      ctx.fillStyle = good ? HOLO.okFill : HOLO.badFill;
      ctx.fill();
      ctx.strokeStyle = good ? HOLO.ok : HOLO.bad;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      // Oculta (la memoria del baile): lugar punteado con un "?".
      ctx.fillStyle = HOLO.glassInset;
      ctx.fill();
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = 'rgba(63,230,224,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      fg = HOLO.cyanText;
    }
    if (t.icon && t.state !== 'hidden') drawHoloIcon(ctx, t.icon, cx + chip / 2, cy + chip / 2, chip * 0.56, fg);
    else {
      ctx.fillStyle = fg;
      ctx.font = font(700, Math.round(chip * 0.42));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.state === 'hidden' ? '?' : t.label.slice(0, 2), cx + chip / 2, cy + chip / 2 + 1);
    }
  });
  ctx.restore();
  const rows = Math.ceil((tokens.length + free) / perRow);
  return y + rows * (chip + gap);
}

/**
 * Devolución de una actividad como banner: riel y ✓/✗ del color, texto
 * blanco (nunca verde ni rojo para leer). Devuelve el y libre debajo.
 */
export function drawFeedbackBanner(ctx: Ctx, x: number, y: number, w: number, text: string, tone: 'good' | 'bad' | 'info'): number {
  ctx.save();
  ctx.font = font(700, 30);
  const textX = x + 70;
  const lines = wrapLines(ctx, text, w - 70 - 20, 2);
  const h = Math.max(60, lines.length * 38 + 22);
  const color = tone === 'good' ? HOLO.ok : tone === 'bad' ? HOLO.bad : HOLO.gold;
  chamferRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = '#0a1d21';
  ctx.fill();
  ctx.fillStyle = tone === 'good' ? HOLO.okFill : tone === 'bad' ? HOLO.badFill : HOLO.goldFill;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 6, h);
  ctx.restore();
  // ✓, ✗ o "i" dibujados (trazo de 5 px, 30 px).
  const gx = x + 36;
  const gy = y + h / 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (tone === 'good') {
    ctx.moveTo(gx - 13, gy + 1);
    ctx.lineTo(gx - 4, gy + 11);
    ctx.lineTo(gx + 14, gy - 11);
    ctx.stroke();
  } else if (tone === 'bad') {
    ctx.moveTo(gx - 11, gy - 11);
    ctx.lineTo(gx + 11, gy + 11);
    ctx.moveTo(gx + 11, gy - 11);
    ctx.lineTo(gx - 11, gy + 11);
    ctx.stroke();
  } else {
    ctx.arc(gx, gy - 11, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(gx, gy - 2);
    ctx.lineTo(gx, gy + 13);
    ctx.stroke();
  }
  ctx.fillStyle = HOLO.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, textX, gy + 1 + (i - (lines.length - 1) / 2) * 38));
  ctx.restore();
  return y + h;
}

/** Caja interna (esquema de controles, pasaporte, pista del robot): vidrio tenue, borde y esquineros. */
export function insetBox(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.save();
  chamferRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = HOLO.glassInset;
  ctx.fill();
  ctx.strokeStyle = 'rgba(63,230,224,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  cornerTicks(ctx, x, y, w, h, 18, 3, HOLO.cyan, 0);
}

/** Barra de progreso biselada, con el degradé hoja → dorado de la carga de la PC (`.bar i`). */
export function progressBar(ctx: Ctx, x: number, y: number, w: number, h: number, frac: number): void {
  ctx.save();
  chamferRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, HOLO.leaf);
    g.addColorStop(1, HOLO.gold);
    ctx.fillStyle = g;
    chamferRect(ctx, x, y, Math.max(h, w * f), h, h / 2);
    ctx.fill();
  }
  ctx.restore();
}
