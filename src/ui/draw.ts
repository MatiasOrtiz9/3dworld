import type { GridView, IconId, SequenceToken } from '../game/activities/types';

/**
 * Dibujo en canvas 2D compartido entre el HUD de escritorio y el panel del
 * visor: íconos, la pista del robot y las fichas de una secuencia. Sin
 * imágenes: todo son trazos, para que se vea nítido a cualquier escala.
 */

export type Ctx = CanvasRenderingContext2D;

export const UI = {
  ink: '#0e1a17',
  panel: '#13231f',
  line: 'rgba(238,246,242,0.16)',
  text: '#eef6f2',
  dim: '#a9c2b8',
  gold: '#f2c14e',
  leaf: '#4faa7a',
  red: '#e2574c',
  font: '"Segoe UI", system-ui, -apple-system, Arial, sans-serif',
} as const;

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Texto con ajuste de línea. Devuelve la altura (y) siguiente libre. */
export function wrapText(ctx: Ctx, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 99): number {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      lines++;
      y += lineH;
      line = w;
      if (lines >= maxLines - 1) {
        // Última línea: lo que queda, recortado con elipsis.
        const rest = words.slice(words.indexOf(w)).join(' ');
        let cut = rest;
        while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
        ctx.fillText(cut === rest ? cut : `${cut}…`, x, y);
        return y + lineH;
      }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
}

/** Ícono de línea centrado en (cx, cy), de lado `s`. */
export function drawIcon(ctx: Ctx, icon: IconId, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.11);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const h = s / 2;
  const arrow = (rot: number) => {
    ctx.save();
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.8);
    ctx.lineTo(0, -h * 0.6);
    ctx.moveTo(-h * 0.55, -h * 0.05);
    ctx.lineTo(0, -h * 0.65);
    ctx.lineTo(h * 0.55, -h * 0.05);
    ctx.stroke();
    ctx.restore();
  };
  const turn = (dir: 1 | -1) => {
    ctx.save();
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.arc(h * 0.15, h * 0.25, h * 0.55, Math.PI, Math.PI * 1.75, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(h * 0.6, -h * 0.55);
    ctx.lineTo(h * 0.55, -h * 0.05);
    ctx.lineTo(h * 0.08, -h * 0.25);
    ctx.stroke();
    ctx.restore();
  };
  switch (icon) {
    case 'up':
    case 'step':
      arrow(0);
      break;
    case 'left':
      turn(-1);
      break;
    case 'right':
      turn(1);
      break;
    case 'next':
      arrow(Math.PI / 2);
      break;
    case 'undo':
      ctx.beginPath();
      ctx.moveTo(-h * 0.7, 0);
      ctx.lineTo(-h * 0.2, -h * 0.5);
      ctx.lineTo(h * 0.7, -h * 0.5);
      ctx.lineTo(h * 0.7, h * 0.5);
      ctx.lineTo(-h * 0.2, h * 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.2);
      ctx.lineTo(h * 0.4, h * 0.2);
      ctx.moveTo(h * 0.4, -h * 0.2);
      ctx.lineTo(0, h * 0.2);
      ctx.stroke();
      break;
    case 'play':
      ctx.beginPath();
      ctx.moveTo(-h * 0.45, -h * 0.65);
      ctx.lineTo(h * 0.65, 0);
      ctx.lineTo(-h * 0.45, h * 0.65);
      ctx.closePath();
      ctx.fill();
      break;
    case 'close':
      ctx.beginPath();
      ctx.moveTo(-h * 0.5, -h * 0.5);
      ctx.lineTo(h * 0.5, h * 0.5);
      ctx.moveTo(h * 0.5, -h * 0.5);
      ctx.lineTo(-h * 0.5, h * 0.5);
      ctx.stroke();
      break;
    case 'spin':
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.6, -Math.PI * 0.3, Math.PI * 1.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(h * 0.62, -h * 0.75);
      ctx.lineTo(h * 0.55, -h * 0.3);
      ctx.lineTo(h * 0.1, -h * 0.42);
      ctx.stroke();
      break;
    case 'clap':
      for (const sx of [-1, 1]) {
        ctx.save();
        ctx.rotate(sx * 0.35);
        roundRect(ctx, sx * h * 0.32 - h * 0.18, -h * 0.55, h * 0.36, h * 1.0, h * 0.18);
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.moveTo(-h * 0.2, -h * 0.85);
      ctx.lineTo(-h * 0.1, -h * 0.7);
      ctx.moveTo(h * 0.2, -h * 0.85);
      ctx.lineTo(h * 0.1, -h * 0.7);
      ctx.stroke();
      break;
    case 'arms':
      ctx.beginPath();
      ctx.arc(0, -h * 0.5, h * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.25);
      ctx.lineTo(0, h * 0.35);
      ctx.moveTo(0, h * 0.35);
      ctx.lineTo(-h * 0.35, h * 0.85);
      ctx.moveTo(0, h * 0.35);
      ctx.lineTo(h * 0.35, h * 0.85);
      ctx.moveTo(0, -h * 0.1);
      ctx.lineTo(-h * 0.55, -h * 0.75);
      ctx.moveTo(0, -h * 0.1);
      ctx.lineTo(h * 0.55, -h * 0.75);
      ctx.stroke();
      break;
    case 'recycle':
      for (let k = 0; k < 3; k++) {
        ctx.save();
        ctx.rotate((k * Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.moveTo(-h * 0.35, h * 0.45);
        ctx.lineTo(h * 0.25, h * 0.45);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(h * 0.25, h * 0.25);
        ctx.lineTo(h * 0.45, h * 0.45);
        ctx.lineTo(h * 0.25, h * 0.65);
        ctx.stroke();
        ctx.restore();
      }
      break;
    case 'leaf':
      ctx.beginPath();
      ctx.moveTo(-h * 0.6, h * 0.6);
      ctx.quadraticCurveTo(-h * 0.6, -h * 0.6, h * 0.65, -h * 0.65);
      ctx.quadraticCurveTo(h * 0.6, h * 0.6, -h * 0.6, h * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-h * 0.6, h * 0.6);
      ctx.lineTo(h * 0.2, -h * 0.2);
      ctx.stroke();
      break;
    case 'trash':
      ctx.beginPath();
      ctx.moveTo(-h * 0.65, -h * 0.45);
      ctx.lineTo(h * 0.65, -h * 0.45);
      ctx.moveTo(-h * 0.2, -h * 0.45);
      ctx.lineTo(-h * 0.15, -h * 0.7);
      ctx.lineTo(h * 0.15, -h * 0.7);
      ctx.lineTo(h * 0.2, -h * 0.45);
      ctx.moveTo(-h * 0.5, -h * 0.3);
      ctx.lineTo(-h * 0.4, h * 0.75);
      ctx.lineTo(h * 0.4, h * 0.75);
      ctx.lineTo(h * 0.5, -h * 0.3);
      ctx.stroke();
      break;
    case 'target':
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

/** Pista del robot: casillas, vasos (obstáculos), bandera, recorrido y el robot con su rumbo. */
export function drawGrid(ctx: Ctx, g: GridView, x: number, y: number, size: number): void {
  const cell = size / Math.max(g.cols, g.rows);
  const w = cell * g.cols;
  const h = cell * g.rows;
  ctx.save();
  ctx.fillStyle = '#f4f1e8';
  roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,40,40,0.25)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= g.cols; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * cell, y);
    ctx.lineTo(x + i * cell, y + h);
    ctx.stroke();
  }
  for (let j = 0; j <= g.rows; j++) {
    ctx.beginPath();
    ctx.moveTo(x, y + j * cell);
    ctx.lineTo(x + w, y + j * cell);
    ctx.stroke();
  }
  const cx = (i: number) => x + (i + 0.5) * cell;
  const cy = (j: number) => y + (j + 0.5) * cell;
  // Salida.
  ctx.fillStyle = 'rgba(76,145,217,0.25)';
  ctx.fillRect(x + g.start[0] * cell + 2, y + g.start[1] * cell + 2, cell - 4, cell - 4);
  // Recorrido.
  if (g.trail.length > 1) {
    ctx.strokeStyle = 'rgba(79,170,122,0.85)';
    ctx.lineWidth = cell * 0.12;
    ctx.beginPath();
    g.trail.forEach(([i, j], k) => (k === 0 ? ctx.moveTo(cx(i), cy(j)) : ctx.lineTo(cx(i), cy(j))));
    ctx.stroke();
  }
  // Obstáculos: vasos rojos.
  for (const [i, j] of g.blocks) {
    ctx.fillStyle = '#d0453c';
    ctx.beginPath();
    ctx.moveTo(cx(i) - cell * 0.26, cy(j) - cell * 0.3);
    ctx.lineTo(cx(i) + cell * 0.26, cy(j) - cell * 0.3);
    ctx.lineTo(cx(i) + cell * 0.18, cy(j) + cell * 0.32);
    ctx.lineTo(cx(i) - cell * 0.18, cy(j) + cell * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(cx(i) - cell * 0.2, cy(j) - cell * 0.22, cell * 0.08, cell * 0.4);
  }
  // Bandera del 40.
  const [gi, gj] = g.goal;
  ctx.strokeStyle = '#333';
  ctx.lineWidth = Math.max(2, cell * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx(gi) - cell * 0.2, cy(gj) + cell * 0.35);
  ctx.lineTo(cx(gi) - cell * 0.2, cy(gj) - cell * 0.35);
  ctx.stroke();
  ctx.fillStyle = UI.gold;
  ctx.fillRect(cx(gi) - cell * 0.18, cy(gj) - cell * 0.35, cell * 0.46, cell * 0.3);
  ctx.fillStyle = '#5a3a00';
  ctx.font = `800 ${Math.round(cell * 0.2)}px ${UI.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('40', cx(gi) + cell * 0.05, cy(gj) - cell * 0.2);
  // Robot: cuerpo, ruedas y una flecha hacia donde mira.
  const r = g.robot;
  ctx.translate(cx(r.x), cy(r.y));
  ctx.rotate((r.dir * Math.PI) / 2);
  ctx.fillStyle = g.crashed ? '#e2574c' : '#2f6db5';
  roundRect(ctx, -cell * 0.3, -cell * 0.32, cell * 0.6, cell * 0.64, cell * 0.12);
  ctx.fill();
  ctx.fillStyle = '#1b1b1f';
  ctx.fillRect(-cell * 0.38, -cell * 0.2, cell * 0.08, cell * 0.4);
  ctx.fillRect(cell * 0.3, -cell * 0.2, cell * 0.08, cell * 0.4);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -cell * 0.28);
  ctx.lineTo(cell * 0.16, -cell * 0.02);
  ctx.lineTo(-cell * 0.16, -cell * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Fichas de una secuencia (programa del robot o pasos de baile). */
export function drawSequence(ctx: Ctx, tokens: readonly SequenceToken[], x: number, y: number, w: number, chip: number): number {
  const gap = chip * 0.18;
  const perRow = Math.max(1, Math.floor((w + gap) / (chip + gap)));
  tokens.forEach((t, k) => {
    const cx = x + (k % perRow) * (chip + gap);
    const cy = y + Math.floor(k / perRow) * (chip + gap);
    const bg =
      t.state === 'active' ? UI.gold : t.state === 'done' ? 'rgba(79,170,122,0.55)' : t.state === 'wrong' ? 'rgba(226,87,76,0.6)' : 'rgba(255,255,255,0.08)';
    ctx.fillStyle = bg;
    roundRect(ctx, cx, cy, chip, chip, chip * 0.2);
    ctx.fill();
    ctx.strokeStyle = t.state === 'hidden' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const fg = t.state === 'active' ? UI.ink : UI.text;
    if (t.icon && t.state !== 'hidden') drawIcon(ctx, t.icon, cx + chip / 2, cy + chip / 2, chip * 0.56, fg);
    else {
      ctx.fillStyle = fg;
      ctx.font = `700 ${Math.round(chip * 0.42)}px ${UI.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.state === 'hidden' ? '?' : t.label.slice(0, 2), cx + chip / 2, cy + chip / 2 + 1);
    }
  });
  const rows = Math.ceil(tokens.length / perRow);
  return y + rows * (chip + gap);
}

/** Sello del Pasaporte 40: círculo con borde doble y el texto. */
export function drawStamp(ctx: Ctx, cx: number, cy: number, r: number, title: string, got: boolean, color = '#c0303a'): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(got ? -0.12 : 0);
  ctx.globalAlpha = got ? 1 : 0.28;
  ctx.strokeStyle = got ? color : '#9fb3ab';
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = r * 0.03;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = got ? color : '#9fb3ab';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(r * 0.5)}px ${UI.font}`;
  ctx.fillText('40', 0, -r * 0.18);
  ctx.font = `700 ${Math.round(r * 0.2)}px ${UI.font}`;
  ctx.fillText(title.toUpperCase(), 0, r * 0.32, r * 1.5);
  ctx.restore();
}
