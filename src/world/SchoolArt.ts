/**
 * Gráficas de la escuela tal como aparecen en el recorrido virtual de 2020:
 * el mural de San Martín del hall con el lema sobre el zócalo de mármol, los
 * vinilos del Aula Maker, el cartel de la cantina, la bandera con el escudo
 * del polideportivo, los afiches del aula de danzas y las carteleras.
 *
 * Dibujo puro sobre canvas, sin motor: lo usa `SchoolAtlas` y se puede
 * revisar fuera de Babylon. Cada función pinta su región completa.
 */

export type Region = readonly [number, number, number, number];

type Ctx = CanvasRenderingContext2D;

const SANS = 'Arial, Helvetica, sans-serif';

/** Generador determinista: el atlas sale igual en cada carga. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clip(ctx: Ctx, r: Region): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
  ctx.clip();
}

// ---------------------------------------------------------------- escudo

/** Escudo institucional según el blasón publicado por la escuela. */
export function emblem(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  const scale = r / 64;
  ctx.scale(scale, scale);
  // Ramas laterales y cruce inferior.
  ctx.strokeStyle = '#253e79';
  ctx.lineWidth = 5;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 25, 43);
    ctx.bezierCurveTo(side * 63, 9, side * 46, -43, side * 29, -45);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const ly = 27 - i * 15;
      ctx.beginPath();
      ctx.ellipse(side * (31 + (i % 2) * 9), ly, 5, 10, side * -0.65, 0, Math.PI * 2);
      ctx.fillStyle = '#314e8c';
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#253e79';
  ctx.beginPath();
  ctx.moveTo(-25, 43);
  ctx.quadraticCurveTo(0, 66, 25, 43);
  ctx.stroke();

  // Escudo piel de toro, con cuatro cuarteles y borde marino.
  ctx.beginPath();
  ctx.moveTo(-28, -46);
  ctx.lineTo(28, -46);
  ctx.lineTo(28, 13);
  ctx.quadraticCurveTo(27, 37, 0, 48);
  ctx.quadraticCurveTo(-27, 37, -28, 13);
  ctx.closePath();
  ctx.fillStyle = '#f4eee2';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#183d79';
  ctx.fillRect(-28, -46, 28, 47);
  ctx.fillStyle = '#f4eee2';
  ctx.fillRect(0, -46, 28, 47);
  ctx.fillStyle = '#c63850';
  ctx.fillRect(-28, 0, 28, 48);
  ctx.fillStyle = '#183d79';
  ctx.fillRect(0, 0, 28, 48);
  // Iniciales en los campos superiores e inferiores.
  ctx.fillStyle = '#c63850';
  ctx.font = 'bold 27px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', -14, -24);
  ctx.fillStyle = '#183d79';
  ctx.fillText('M', -14, 23);
  ctx.fillStyle = '#c63850';
  ctx.fillText('C', 14, 23);
  ctx.restore();
  ctx.strokeStyle = '#172b55';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Banda argentina y sol naciente en el cuartel superior derecho.
  ctx.save();
  ctx.beginPath();
  ctx.rect(1, -44, 25, 42);
  ctx.clip();
  ctx.rotate(-0.48);
  ctx.fillStyle = '#79b9df';
  ctx.fillRect(-10, -55, 15, 82);
  ctx.fillStyle = '#fff';
  ctx.fillRect(5, -55, 8, 82);
  ctx.fillStyle = '#79b9df';
  ctx.fillRect(13, -55, 12, 82);
  ctx.fillStyle = '#e6ad32';
  ctx.beginPath();
  ctx.arc(13, -8, 8, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Flor de lis roja sobre el escudo.
  ctx.fillStyle = '#c63850';
  ctx.beginPath();
  ctx.moveTo(0, -63);
  ctx.bezierCurveTo(-14, -54, -7, -48, 0, -49);
  ctx.bezierCurveTo(7, -48, 14, -54, 0, -63);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- hall

/**
 * Mural del hall: el cruce de los Andes. Cielo azul con nubes, cordillera
 * nevada a la izquierda, la columna de granaderos que baja la quebrada,
 * San Martín en el caballo blanco y las banderas.
 */
export function drawSanMartin(ctx: Ctx, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(1817);
  clip(ctx, r);
  const sky = ctx.createLinearGradient(0, y0, 0, y0 + h * 0.55);
  sky.addColorStop(0, '#1f5aa6');
  sky.addColorStop(0.55, '#5d93cf');
  sky.addColorStop(1, '#b9d3ea');
  ctx.fillStyle = sky;
  ctx.fillRect(x0, y0, w, h);
  // Pinceladas de nubes.
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 9; i++) {
    const cx = x0 + rnd() * w;
    const cy = y0 + 18 + rnd() * h * 0.28;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 30 + rnd() * 50, 6 + rnd() * 8, -0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cordillera nevada.
  const ridge = (base: number, color: string, peaks: number[][]) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + base);
    for (const [px, py] of peaks) ctx.lineTo(x0 + px * w, y0 + py * h);
    ctx.lineTo(x1, y0 + base);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
    ctx.closePath();
    ctx.fill();
  };
  ridge(h * 0.62, '#e9eef3', [
    [0, 0.42],
    [0.08, 0.3],
    [0.16, 0.4],
    [0.25, 0.24],
    [0.36, 0.42],
    [0.45, 0.36],
    [0.55, 0.5],
    [0.7, 0.44],
    [0.85, 0.52],
    [1, 0.47],
  ]);
  // Sombras grises de la nieve.
  ctx.fillStyle = 'rgba(120,135,155,.45)';
  for (const [px, py] of [
    [0.25, 0.24],
    [0.08, 0.3],
    [0.45, 0.36],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0 + px * w, y0 + py * h);
    ctx.lineTo(x0 + (px + 0.06) * w, y0 + (py + 0.2) * h);
    ctx.lineTo(x0 + (px + 0.015) * w, y0 + (py + 0.2) * h);
    ctx.closePath();
    ctx.fill();
  }
  // Ladera parda y quebrada en primer plano.
  ridge(h * 0.75, '#9c7b56', [
    [0, 0.6],
    [0.2, 0.56],
    [0.4, 0.62],
    [0.6, 0.55],
    [0.8, 0.6],
    [1, 0.52],
  ]);
  const ground = ctx.createLinearGradient(0, y0 + h * 0.62, 0, y1);
  ground.addColorStop(0, '#8a6a49');
  ground.addColorStop(1, '#5b412d');
  ctx.fillStyle = ground;
  ctx.fillRect(x0, y0 + h * 0.72, w, h * 0.28);

  // Columna de granaderos bajando desde la izquierda: figuras oscuras con
  // penacho rojo, cada vez más grandes hacia el frente.
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const px = x0 + w * (0.02 + t * 0.36) + (rnd() - 0.5) * 12;
    const py = y0 + h * (0.5 + t * 0.32) + (rnd() - 0.5) * 10;
    const s = 4 + t * 9;
    ctx.fillStyle = '#1d2230';
    ctx.fillRect(px - s * 0.35, py - s * 1.6, s * 0.7, s * 1.6);
    ctx.fillStyle = '#c8262c';
    ctx.fillRect(px - s * 0.3, py - s * 2.05, s * 0.6, s * 0.45);
    // Bayoneta.
    ctx.strokeStyle = '#d7d7d2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + s * 0.3, py - s * 0.7);
    ctx.lineTo(px + s * 0.45, py - s * 2.6);
    ctx.stroke();
  }

  // Caballos: uno blanco (San Martín) y varios oscuros a su derecha.
  const horse = (cx: number, cy: number, s: number, body: string, rider: string) => {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 30 * s, 14 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // Cuello y cabeza hacia la izquierda.
    ctx.beginPath();
    ctx.moveTo(cx - 22 * s, cy - 6 * s);
    ctx.lineTo(cx - 36 * s, cy - 30 * s);
    ctx.lineTo(cx - 46 * s, cy - 24 * s);
    ctx.lineTo(cx - 40 * s, cy - 16 * s);
    ctx.lineTo(cx - 28 * s, cy + 4 * s);
    ctx.closePath();
    ctx.fill();
    // Patas.
    ctx.fillRect(cx - 24 * s, cy + 8 * s, 5 * s, 26 * s);
    ctx.fillRect(cx - 12 * s, cy + 8 * s, 5 * s, 24 * s);
    ctx.fillRect(cx + 12 * s, cy + 8 * s, 5 * s, 26 * s);
    ctx.fillRect(cx + 22 * s, cy + 6 * s, 5 * s, 24 * s);
    // Cola.
    ctx.beginPath();
    ctx.moveTo(cx + 28 * s, cy - 4 * s);
    ctx.quadraticCurveTo(cx + 44 * s, cy + 6 * s, cx + 36 * s, cy + 24 * s);
    ctx.lineTo(cx + 30 * s, cy + 6 * s);
    ctx.fill();
    // Jinete con capa y bicornio.
    ctx.fillStyle = rider;
    ctx.fillRect(cx - 8 * s, cy - 36 * s, 14 * s, 26 * s);
    ctx.beginPath();
    ctx.ellipse(cx - 1 * s, cy - 42 * s, 5 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 10 * s, cy - 50 * s, 18 * s, 4 * s);
  };
  horse(x0 + w * 0.45, y0 + h * 0.66, 1.15, '#f3f1ea', '#1e2433');
  horse(x0 + w * 0.6, y0 + h * 0.62, 1.0, '#3b2a20', '#202736');
  horse(x0 + w * 0.73, y0 + h * 0.66, 1.05, '#251a14', '#1e2230');
  horse(x0 + w * 0.86, y0 + h * 0.63, 0.95, '#4a3426', '#202432');

  // Banderas: la argentina y la amarilla del ejército, en lo alto.
  const flag = (px: number, top: number, colors: string[]) => {
    ctx.strokeStyle = '#3a2c20';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px, top + h * 0.38);
    ctx.stroke();
    const fw = 36;
    const fh = 26;
    colors.forEach((c, k) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(px, top + (k * fh) / colors.length);
      ctx.quadraticCurveTo(px + fw / 2, top + (k * fh) / colors.length - 4, px + fw, top + (k * fh) / colors.length + 2);
      ctx.lineTo(px + fw, top + ((k + 1) * fh) / colors.length + 2);
      ctx.quadraticCurveTo(px + fw / 2, top + ((k + 1) * fh) / colors.length - 4, px, top + ((k + 1) * fh) / colors.length);
      ctx.closePath();
      ctx.fill();
    });
  };
  flag(x0 + w * 0.5, y0 + h * 0.2, ['#77b5e3', '#ffffff', '#77b5e3']);
  flag(x0 + w * 0.62, y0 + h * 0.26, ['#f2d24b', '#f7f3e3']);
  // Pátina de pintura sobre revoque.
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  for (let i = 0; i < 300; i++) ctx.fillRect(x0 + rnd() * w, y0 + rnd() * h, 2, 2);
  ctx.restore();
}

/** Placas de mármol beige con vetas grises (zócalo del hall y columnas). */
export function drawMarble(ctx: Ctx, r: Region, seed = 7, tiles = 2): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(seed);
  clip(ctx, r);
  ctx.fillStyle = '#d9d1c4';
  ctx.fillRect(x0, y0, w, h);
  for (let tx = 0; tx < tiles; tx++) {
    for (let ty = 0; ty < tiles; ty++) {
      const cx0 = x0 + (tx * w) / tiles;
      const cy0 = y0 + (ty * h) / tiles;
      const tw = w / tiles;
      const th = h / tiles;
      const shade = 200 + Math.round(rnd() * 22);
      ctx.fillStyle = `rgb(${shade + 14},${shade + 6},${shade - 8})`;
      ctx.fillRect(cx0, cy0, tw, th);
      ctx.strokeStyle = 'rgba(110,104,96,.55)';
      for (let k = 0; k < 7; k++) {
        ctx.lineWidth = 0.6 + rnd() * 1.6;
        ctx.beginPath();
        let px = cx0 + rnd() * tw;
        let py = cy0;
        ctx.moveTo(px, py);
        while (py < cy0 + th) {
          px += (rnd() - 0.45) * tw * 0.18;
          py += th * (0.08 + rnd() * 0.12);
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = '#efeae1';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx0 + 1, cy0 + 1, tw - 2, th - 2);
    }
  }
  ctx.restore();
}

/** "SERÁS LO QUE DEBAS SER O NO SERÁS NADA", pintado sobre el mármol. */
export function drawMotto(ctx: Ctx, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  drawMarble(ctx, r, 11, 4);
  ctx.fillStyle = '#1b1b1d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(h * 0.3)}px ${SANS}`;
  ctx.fillText('SERÁS LO QUE DEBAS SER', x0 + w / 2, y0 + h * 0.3, w - 16);
  ctx.fillText('O NO SERÁS NADA', x0 + w / 2, y0 + h * 0.72, w - 16);
}

// ---------------------------------------------------------------- aula maker

const MAKER_COLORS = ['#f2b51c', '#2e3a8f', '#3d8fd1', '#8b4fb3', '#f07f1e', '#e66ea6'];

/** Íconos blancos de las placas de color (flecha, tijera, lupa, auriculares…). */
function makerGlyph(ctx: Ctx, kind: number, x: number, y: number, s: number, color = '#fff'): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind % 9) {
    case 0: // flecha
      ctx.beginPath();
      ctx.moveTo(-15, 0);
      ctx.lineTo(13, 0);
      ctx.moveTo(4, -10);
      ctx.lineTo(14, 0);
      ctx.lineTo(4, 10);
      ctx.stroke();
      break;
    case 1: // tijera
      ctx.beginPath();
      ctx.arc(-6, 10, 5, 0, Math.PI * 2);
      ctx.arc(6, 10, 5, 0, Math.PI * 2);
      ctx.moveTo(-3, 6);
      ctx.lineTo(8, -14);
      ctx.moveTo(3, 6);
      ctx.lineTo(-8, -14);
      ctx.stroke();
      break;
    case 2: // auriculares
      ctx.beginPath();
      ctx.arc(0, 2, 13, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(-15, 0, 7, 12);
      ctx.fillRect(8, 0, 7, 12);
      break;
    case 3: // lupa
      ctx.beginPath();
      ctx.arc(-3, -3, 9, 0, Math.PI * 2);
      ctx.moveTo(4, 4);
      ctx.lineTo(13, 13);
      ctx.stroke();
      break;
    case 4: // cohete
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.quadraticCurveTo(9, -6, 6, 10);
      ctx.lineTo(-6, 10);
      ctx.quadraticCurveTo(-9, -6, 0, -16);
      ctx.fill();
      ctx.fillRect(-11, 4, 5, 9);
      ctx.fillRect(6, 4, 5, 9);
      break;
    case 5: // engranaje
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        ctx.fillRect(Math.cos(a) * 11 - 2.5, Math.sin(a) * 11 - 2.5, 5, 5);
      }
      break;
    case 6: // lamparita
      ctx.beginPath();
      ctx.arc(0, -4, 9, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(4, 10);
      ctx.lineTo(-4, 10);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(-4, 12, 8, 3);
      break;
    case 7: // calculadora
      ctx.strokeRect(-10, -14, 20, 28);
      for (let k = 0; k < 6; k++) ctx.fillRect(-6 + (k % 2) * 8, -4 + Math.floor(k / 2) * 6, 4, 3);
      break;
    default: // dron
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      ctx.lineTo(10, 10);
      ctx.moveTo(10, -10);
      ctx.lineTo(-10, 10);
      ctx.stroke();
      for (const [px, py] of [
        [-11, -11],
        [11, -11],
        [-11, 11],
        [11, 11],
      ]) {
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
  }
  ctx.restore();
}

/**
 * Pared del Aula Maker: fondo blanco, placas cuadradas de color con íconos
 * blancos, íconos sueltos de colores y las palabras en azul. `words` va de
 * izquierda a derecha; `variant` cambia la disposición de las placas.
 */
export function drawMakerWall(ctx: Ctx, r: Region, words: readonly string[], variant: number): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(300 + variant * 17);
  clip(ctx, r);
  ctx.fillStyle = '#f7f7f4';
  ctx.fillRect(x0, y0, w, h);
  // Cada palabra ocupa un segmento: mitad para la palabra, mitad para un
  // mosaico de 3 × 2 placas que entra entero en su zona.
  const n = words.length;
  const seg = w / n;
  for (let k = 0; k < n; k++) {
    const sx = x0 + k * seg;
    const tilesRight = (k + variant) % 2 === 0;
    const zone = seg * 0.5;
    const tile = Math.min(h * 0.4, (zone - 8) / 3);
    const mx = tilesRight ? sx + seg - zone + 4 : sx + 4;
    const my = y0 + (h - 2 * tile) / 2 - tile * 0.08;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        if (rnd() < 0.18) continue;
        const tx = mx + col * tile;
        const ty = my + row * tile + (col % 2) * tile * 0.16;
        const color = MAKER_COLORS[Math.floor(rnd() * MAKER_COLORS.length)];
        ctx.fillStyle = color;
        ctx.fillRect(tx, ty, tile - 3, tile - 3);
        makerGlyph(ctx, Math.floor(rnd() * 9), tx + tile / 2, ty + tile / 2, tile / 52);
      }
    }
    // Palabra grande en azul, centrada en su mitad.
    const wx = tilesRight ? sx + (seg - zone) / 2 : sx + zone + (seg - zone) / 2;
    const maxW = seg - zone - 16;
    ctx.fillStyle = '#2b3d9e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Letras de ~0,32 m sobre un paño de 2,35 m, a 1,3-1,65 m del piso.
    ctx.font = `900 ${Math.round(h * 0.15)}px ${SANS}`;
    ctx.fillText(words[k], wx, y0 + h * 0.5, maxW);
    // Íconos sueltos de colores arriba y abajo de la palabra.
    for (let i = 0; i < 6; i++) {
      const ix = wx + (rnd() - 0.5) * maxW;
      const iy = rnd() < 0.5 ? y0 + h * (0.12 + rnd() * 0.18) : y0 + h * (0.78 + rnd() * 0.12);
      makerGlyph(ctx, Math.floor(rnd() * 9), ix, iy, 0.75 + rnd() * 0.4, MAKER_COLORS[Math.floor(rnd() * 6)]);
    }
  }
  ctx.restore();
}

/** Mueble Educabot: panel violeta con píxeles de colores y "AULA MAKER". */
export function drawEducabot(ctx: Ctx, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(41);
  clip(ctx, r);
  ctx.fillStyle = '#4a2a91';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#3a2484';
  ctx.fillRect(x0 + w * 0.55, y0, w * 0.45, h);
  // Píxeles de colores en la parte alta.
  const px = w / 5;
  const pal = ['#f07f1e', '#2bb3a3', '#e66ea6', '#f2b51c', '#ffffff', '#3d8fd1'];
  for (let i = 0; i < 26; i++) {
    const cx = x0 + Math.floor(rnd() * 5) * px;
    const cy = y0 + h * 0.05 + Math.floor(rnd() * 14) * px * 0.9;
    ctx.fillStyle = pal[Math.floor(rnd() * pal.length)];
    ctx.fillRect(cx, cy, px - 1, px - 1);
  }
  // Textos verticales, de abajo hacia arriba, dentro del panel.
  const vertical = (text: string, yBottom: number, size: number, maxLen: number) => {
    ctx.save();
    ctx.translate(x0 + w * 0.42, yBottom);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(size)}px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0, maxLen);
    ctx.restore();
  };
  vertical('AULA MAKER', y1 - h * 0.11, w * 0.3, h * 0.42);
  vertical('EDUCABOT', y0 + h * 0.4, w * 0.2, h * 0.3);
  ctx.fillStyle = '#e8622a';
  ctx.fillRect(x0, y1 - h * 0.08, w * 0.55, h * 0.08);
  ctx.restore();
}

// ---------------------------------------------------------------- cantina

/** Cartel ovalado de la cantina: "PRO FOOD." con cubiertos verdes. Fuera del óvalo es transparente. */
export function drawProFood(ctx: Ctx, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.clearRect(x0, y0, w, h);
  clip(ctx, r);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#dcd9d3';
  ctx.fill();
  ctx.strokeStyle = '#b9b5ae';
  ctx.lineWidth = 3;
  ctx.stroke();
  // Cuchara y tenedor verdes.
  ctx.fillStyle = '#25a24a';
  const s = h / 130;
  ctx.beginPath();
  ctx.ellipse(x0 + w * 0.17, cy - 26 * s, 9 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x0 + w * 0.17 - 3.5 * s, cy - 14 * s, 7 * s, 54 * s);
  const fx = x0 + w * 0.27;
  ctx.fillRect(fx - 9 * s, cy - 40 * s, 18 * s, 26 * s);
  ctx.fillRect(fx - 3.5 * s, cy - 16 * s, 7 * s, 56 * s);
  ctx.fillStyle = '#dcd9d3';
  for (const k of [-4.5, 1.5]) ctx.fillRect(fx + k * s, cy - 40 * s, 3 * s, 18 * s);
  // Letras negras geométricas.
  ctx.fillStyle = '#26272a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.25)}px ${SANS}`;
  ctx.fillText('PRO', x0 + w * 0.36, cy - h * 0.15, w * 0.5);
  ctx.fillText('FOOD.', x0 + w * 0.36, cy + h * 0.15, w * 0.5);
  ctx.fillStyle = '#d0587a';
  ctx.font = `600 ${Math.round(h * 0.07)}px ${SANS}`;
  ctx.fillText("by COOK'S", x0 + w * 0.42, cy + h * 0.38);
  ctx.restore();
}

/** Cartel verde de salida de emergencia. */
export function drawSalida(ctx: Ctx, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#1d9a50';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = '#e9f7ee';
  ctx.lineWidth = 3;
  ctx.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6);
  // Hombrecito corriendo hacia la puerta.
  const s = h / 64;
  const mx = x0 + h * 0.55;
  const my = y0 + h * 0.5;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(mx + 4 * s, my - 18 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mx + 2 * s, my - 10 * s);
  ctx.lineTo(mx - 3 * s, my + 6 * s);
  ctx.lineTo(mx - 12 * s, my + 18 * s);
  ctx.moveTo(mx - 3 * s, my + 6 * s);
  ctx.lineTo(mx + 8 * s, my + 18 * s);
  ctx.moveTo(mx - 10 * s, my - 6 * s);
  ctx.lineTo(mx + 2 * s, my - 10 * s);
  ctx.lineTo(mx + 12 * s, my - 2 * s);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(h * 0.46)}px ${SANS}`;
  ctx.fillText('SALIDA', x0 + h * 1.05, y0 + h * 0.54, w - h * 1.15);
}

// ---------------------------------------------------------------- polideportivo

/** Bandera blanca con el escudo, colgada en el testero del polideportivo. */
export function drawCrestBanner(ctx: Ctx, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const cloth = ctx.createLinearGradient(x0, 0, x1, 0);
  cloth.addColorStop(0, '#e9e7e1');
  cloth.addColorStop(0.5, '#fbfaf7');
  cloth.addColorStop(1, '#e6e3dc');
  ctx.fillStyle = cloth;
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#2b2b33';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(h * 0.05)}px Georgia, serif`;
  ctx.fillText('EN NUESTRA HISTORIA', x0 + w / 2, y0 + h * 0.08, w - 16);
  ctx.fillText('ESTÁ SU CONFIANZA', x0 + w / 2, y0 + h * 0.14, w - 16);
  // Cinta roja con el nombre.
  ctx.fillStyle = '#c0303a';
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.12, y0 + h * 0.26);
  ctx.quadraticCurveTo(x0 + w / 2, y0 + h * 0.18, x0 + w * 0.88, y0 + h * 0.26);
  ctx.lineTo(x0 + w * 0.88, y0 + h * 0.32);
  ctx.quadraticCurveTo(x0 + w / 2, y0 + h * 0.24, x0 + w * 0.12, y0 + h * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(h * 0.035)}px Georgia, serif`;
  ctx.fillText('CIMDIP & MIGUEL CANÉ', x0 + w / 2, y0 + h * 0.255, w * 0.6);
  emblem(ctx, x0 + w / 2, y0 + h * 0.6, h * 0.19);
  ctx.fillStyle = '#3b3b44';
  ctx.font = `italic ${Math.round(h * 0.04)}px Georgia, serif`;
  ctx.fillText('La mejor escuela para sus hijos', x0 + w / 2, y0 + h * 0.92, w - 20);
  // Pliegues verticales sutiles.
  ctx.fillStyle = 'rgba(0,0,0,.04)';
  for (let i = 1; i < 5; i++) ctx.fillRect(x0 + (i * w) / 5 - 2, y0, 4, h);
}

// ---------------------------------------------------------------- danza y carteleras

/** Afiches negros de los actos de danza (dos variantes). */
export function drawBalletPoster(ctx: Ctx, r: Region, variant: number): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(90 + variant);
  ctx.fillStyle = '#121216';
  ctx.fillRect(x0, y0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (variant === 0) {
    ctx.fillStyle = '#e6dcc8';
    ctx.font = `600 ${Math.round(h * 0.045)}px Georgia, serif`;
    ctx.fillText('MUESTRA ANUAL', x0 + w / 2, y0 + h * 0.08, w - 10);
    ctx.fillStyle = '#f2c3d2';
    ctx.font = `700 ${Math.round(h * 0.07)}px Georgia, serif`;
    ctx.fillText('DANZAS', x0 + w / 2, y0 + h * 0.17, w - 10);
    // Fila de bailarinas con tutú.
    for (let i = 0; i < 7; i++) {
      const cx = x0 + w * (0.1 + i * 0.133);
      const cy = y0 + h * 0.62 + (rnd() - 0.5) * 6;
      ctx.fillStyle = '#f5e6ef';
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.06, h * 0.025, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - 1.5, cy - h * 0.12, 3, h * 0.12);
      ctx.fillRect(cx - 1.5, cy, 2, h * 0.13);
      ctx.beginPath();
      ctx.arc(cx, cy - h * 0.14, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // El lago de los cisnes: cisne blanco sobre fondo oscuro.
    ctx.fillStyle = '#d8d8de';
    ctx.font = `italic 700 ${Math.round(h * 0.12)}px Georgia, serif`;
    ctx.fillText('Lago', x0 + w / 2, y0 + h * 0.62, w - 8);
    ctx.font = `italic ${Math.round(h * 0.07)}px Georgia, serif`;
    ctx.fillText('de los Cisnes', x0 + w / 2, y0 + h * 0.74, w - 8);
    ctx.fillStyle = '#f4f4f6';
    ctx.beginPath();
    ctx.ellipse(x0 + w * 0.5, y0 + h * 0.34, w * 0.22, h * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#f4f4f6';
    ctx.beginPath();
    ctx.moveTo(x0 + w * 0.36, y0 + h * 0.32);
    ctx.quadraticCurveTo(x0 + w * 0.28, y0 + h * 0.16, x0 + w * 0.36, y0 + h * 0.15);
    ctx.stroke();
  }
  ctx.fillStyle = '#9a8f78';
  ctx.font = `${Math.round(h * 0.035)}px ${SANS}`;
  ctx.fillText('CIMDIP & M. CANÉ', x0 + w / 2, y1 - h * 0.05, w - 10);
}

/** Cartelera de corcho con marco rojo y trabajos de los chicos. */
export function drawCorkBoard(ctx: Ctx, r: Region, seed: number): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(500 + seed);
  ctx.fillStyle = '#c0242c';
  ctx.fillRect(x0, y0, w, h);
  const m = Math.round(Math.min(w, h) * 0.06);
  ctx.fillStyle = '#c99b62';
  ctx.fillRect(x0 + m, y0 + m, w - 2 * m, h - 2 * m);
  // Granulado del corcho.
  ctx.fillStyle = 'rgba(110,70,30,.25)';
  for (let i = 0; i < 260; i++) ctx.fillRect(x0 + m + rnd() * (w - 2 * m), y0 + m + rnd() * (h - 2 * m), 2, 2);
  const papers = ['#ffffff', '#fef3a6', '#bfe3f7', '#ffd1dc', '#c9f0c1', '#ffffff'];
  for (let i = 0; i < 7; i++) {
    const pw = w * (0.18 + rnd() * 0.14);
    const ph = h * (0.22 + rnd() * 0.18);
    const px = x0 + m + rnd() * (w - 2 * m - pw);
    const py = y0 + m + rnd() * (h - 2 * m - ph);
    ctx.save();
    ctx.translate(px + pw / 2, py + ph / 2);
    ctx.rotate((rnd() - 0.5) * 0.18);
    ctx.fillStyle = papers[Math.floor(rnd() * papers.length)];
    ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    // Dibujos con crayón.
    for (let k = 0; k < 5; k++) {
      ctx.strokeStyle = ['#d23a3a', '#2f6fd0', '#2f9a4a', '#f0a020', '#7b3fb0'][Math.floor(rnd() * 5)];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo((rnd() - 0.5) * pw * 0.8, (rnd() - 0.5) * ph * 0.8);
      ctx.quadraticCurveTo((rnd() - 0.5) * pw, (rnd() - 0.5) * ph, (rnd() - 0.5) * pw * 0.8, (rnd() - 0.5) * ph * 0.8);
      ctx.stroke();
    }
    ctx.fillStyle = '#d23a3a';
    ctx.beginPath();
    ctx.arc(0, -ph / 2 + 4, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Murales de los chicos del pasillo de Arte y Teatro (video 2026, 1:13–1:22):
 * sobre blanco, nubes celestes, flores, peces, patos, un chancho y un auto,
 * pintados con contorno negro grueso, como témpera de jardín. `grass` es la
 * fracción de alto del pasto: en el túnel del pasillo el mural nace del piso
 * con una franja verde ondulada de ~40 cm y flores altas (1:11–1:20).
 */
export function drawKidsMural(ctx: Ctx, r: Region, seed: number, grass = 0.08): void {
  clip(ctx, r);
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(seed);
  ctx.fillStyle = '#f4f3ee';
  ctx.fillRect(x0, y0, w, h);
  ctx.lineWidth = Math.max(2, h / 90);
  ctx.strokeStyle = '#1d1d1f';
  const blob = (cx: number, cy: number, rx: number, ry: number, fill: string) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  // Nubes celestes arriba.
  for (let i = 0; i < 4; i++) {
    const cx = x0 + w * (0.1 + i * 0.27 + rnd() * 0.05);
    const cy = y0 + h * (0.14 + rnd() * 0.06);
    for (let k = 0; k < 3; k++) blob(cx + (k - 1) * h * 0.08, cy - (k === 1 ? h * 0.04 : 0), h * 0.07, h * 0.06, '#a9d3ea');
  }
  const colors = ['#e94b5c', '#f6c443', '#7a5bd6', '#3fa56b', '#ef8f3a', '#ea7fb6', '#3c8fd8'];
  const pick = () => colors[Math.floor(rnd() * colors.length)];
  // Fila de figuras: flor, pez, pato, chancho o auto, alternadas.
  const n = Math.max(4, Math.round(w / h / 0.42));
  for (let i = 0; i < n; i++) {
    const cx = x0 + (w * (i + 0.5)) / n + (rnd() - 0.5) * w * 0.03;
    const cy = y0 + h * (0.52 + (rnd() - 0.5) * 0.18);
    const s = h * (0.13 + rnd() * 0.05);
    const kind = (i + seed) % 5;
    if (kind === 0) {
      // Flor: tallo, cinco pétalos y centro.
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, y1 - h * 0.08);
      ctx.strokeStyle = '#2f7d3c';
      ctx.stroke();
      ctx.strokeStyle = '#1d1d1f';
      const c = pick();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        blob(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55, s * 0.4, s * 0.4, c);
      }
      blob(cx, cy, s * 0.32, s * 0.32, '#f6c443');
    } else if (kind === 1) {
      // Pez: cuerpo, cola y ojo.
      const c = pick();
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.9, cy);
      ctx.lineTo(cx + s * 1.5, cy - s * 0.5);
      ctx.lineTo(cx + s * 1.5, cy + s * 0.5);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      ctx.stroke();
      blob(cx, cy, s, s * 0.55, c);
      blob(cx - s * 0.5, cy - s * 0.12, s * 0.1, s * 0.1, '#ffffff');
    } else if (kind === 2) {
      // Pato amarillo.
      blob(cx, cy + s * 0.2, s * 0.9, s * 0.55, '#f6d23f');
      blob(cx - s * 0.7, cy - s * 0.45, s * 0.42, s * 0.42, '#f6d23f');
      ctx.beginPath();
      ctx.moveTo(cx - s * 1.05, cy - s * 0.5);
      ctx.lineTo(cx - s * 1.45, cy - s * 0.38);
      ctx.lineTo(cx - s * 1.05, cy - s * 0.28);
      ctx.closePath();
      ctx.fillStyle = '#ef8f3a';
      ctx.fill();
      ctx.stroke();
    } else if (kind === 3) {
      // Chancho rosado.
      blob(cx, cy, s * 1.05, s * 0.75, '#f2a0bf');
      blob(cx - s * 0.95, cy - s * 0.05, s * 0.28, s * 0.22, '#e77fa6');
      for (const dx of [-0.5, 0.5]) {
        ctx.fillStyle = '#e77fa6';
        ctx.fillRect(cx + dx * s - s * 0.12, cy + s * 0.6, s * 0.24, s * 0.4);
        ctx.strokeRect(cx + dx * s - s * 0.12, cy + s * 0.6, s * 0.24, s * 0.4);
      }
    } else {
      // Auto: carrocería, cabina y dos ruedas.
      const c = pick();
      ctx.fillStyle = c;
      ctx.fillRect(cx - s * 1.2, cy - s * 0.1, s * 2.4, s * 0.7);
      ctx.strokeRect(cx - s * 1.2, cy - s * 0.1, s * 2.4, s * 0.7);
      ctx.fillRect(cx - s * 0.6, cy - s * 0.6, s * 1.2, s * 0.5);
      ctx.strokeRect(cx - s * 0.6, cy - s * 0.6, s * 1.2, s * 0.5);
      for (const dx of [-0.7, 0.7]) blob(cx + dx * s, cy + s * 0.65, s * 0.3, s * 0.3, '#2b2b2b');
    }
  }
  if (grass > 0.1) {
    // Flores altas que salen del pasto (tulipanes violetas y rojos,
    // margaritas amarillas, hojas largas) entre las figuras, como en el video.
    const m = Math.round(w / h / 0.3);
    for (let i = 0; i < m; i++) {
      const cx = x0 + (w * (i + 0.25 + rnd() * 0.5)) / m;
      const top = y0 + h * (0.42 + rnd() * 0.2);
      const s = h * (0.05 + rnd() * 0.025);
      ctx.strokeStyle = '#2f7d3c';
      ctx.lineWidth = Math.max(2, h / 70);
      ctx.beginPath();
      ctx.moveTo(cx, y1 - h * grass * 0.6);
      ctx.quadraticCurveTo(cx + s * 0.6, (top + y1) / 2, cx, top);
      ctx.stroke();
      ctx.lineWidth = Math.max(2, h / 90);
      ctx.strokeStyle = '#1d1d1f';
      // Hoja larga a un costado del tallo.
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.7, top + (y1 - top) * 0.45, s * 0.8, s * 0.25, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = '#4f9d4a';
      ctx.fill();
      ctx.stroke();
      if (i % 2 === 0) {
        // Tulipán: copa de tres puntas.
        ctx.beginPath();
        ctx.moveTo(cx - s, top - s * 1.3);
        ctx.lineTo(cx - s * 0.35, top - s * 0.6);
        ctx.lineTo(cx, top - s * 1.4);
        ctx.lineTo(cx + s * 0.35, top - s * 0.6);
        ctx.lineTo(cx + s, top - s * 1.3);
        ctx.quadraticCurveTo(cx + s, top + s * 0.2, cx, top + s * 0.2);
        ctx.quadraticCurveTo(cx - s, top + s * 0.2, cx - s, top - s * 1.3);
        ctx.fillStyle = i % 4 === 0 ? '#6a3fb8' : '#e94b5c';
        ctx.fill();
        ctx.stroke();
      } else {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          blob(cx + Math.cos(a) * s * 0.7, top - s * 0.4 + Math.sin(a) * s * 0.7, s * 0.42, s * 0.42, '#f6c443');
        }
        blob(cx, top - s * 0.4, s * 0.35, s * 0.35, '#ef8f3a');
      }
    }
  }
  // Pasto verde al pie: franja recta si es baja, ondulada si es la del túnel.
  ctx.fillStyle = '#4fa64a';
  if (grass > 0.1) {
    const gy = y1 - h * grass;
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    ctx.lineTo(x0, gy);
    const waves = Math.max(3, Math.round(w / (h * 0.35)));
    for (let i = 0; i < waves; i++) {
      const xa = x0 + (w * (i + 0.5)) / waves;
      const xb = x0 + (w * (i + 1)) / waves;
      ctx.quadraticCurveTo(xa, gy - h * grass * (0.35 + rnd() * 0.4), xb, gy + h * grass * (rnd() - 0.5) * 0.3);
    }
    ctx.lineTo(x1, y1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(x0, y1 - h * grass, w, h * grass);
  }
  ctx.restore();
}

/**
 * Paño pintado entre Arte y Teatro (video 2026, 1:19–1:20): árbol de copa
 * de hojas verdes con tronco marrón sobre el pasto, y nubes celestes arriba.
 */
export function drawKidsTree(ctx: Ctx, r: Region, seed: number): void {
  clip(ctx, r);
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(seed);
  ctx.fillStyle = '#f6f5f0';
  ctx.fillRect(x0, y0, w, h);
  ctx.lineWidth = Math.max(2, w / 60);
  ctx.strokeStyle = '#1d1d1f';
  const cx = x0 + w / 2;
  // Nubes recortadas celestes (como las del frente de Arte, 1:15–1:16).
  ctx.fillStyle = '#a9d3ea';
  for (const [fx, fy] of [
    [0.25, 0.07],
    [0.75, 0.12],
  ] as const) {
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(x0 + w * fx + (k - 1) * w * 0.12, y0 + h * fy - (k === 1 ? h * 0.015 : 0), w * 0.13, h * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#7a4a26';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.1, y1 - h * 0.12);
  ctx.lineTo(cx - w * 0.06, y0 + h * 0.5);
  ctx.lineTo(cx + w * 0.06, y0 + h * 0.5);
  ctx.lineTo(cx + w * 0.12, y1 - h * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Copa: muchas hojas superpuestas en tres verdes.
  const greens = ['#2f6b3a', '#3f8f4a', '#256045'];
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd());
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * d * w * 0.42, y0 + h * 0.36 + Math.sin(a) * d * h * 0.17, w * 0.075, w * 0.04, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = greens[i % 3];
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#4fa64a';
  ctx.fillRect(x0, y1 - h * 0.12, w, h * 0.12);
  ctx.restore();
}

/**
 * Bajo las ventanas de Arte y Teatro (video 2026, 1:13 y 1:20): estrellas de
 * mar rosadas y naranjas y delfines azules sobre blanco.
 */
export function drawSeaMural(ctx: Ctx, r: Region, seed: number): void {
  clip(ctx, r);
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  const rnd = seeded(seed);
  ctx.fillStyle = '#f6f5f0';
  ctx.fillRect(x0, y0, w, h);
  ctx.lineWidth = Math.max(2, h / 70);
  ctx.strokeStyle = '#1d1d1f';
  const n = Math.max(3, Math.round(w / (h * 0.45)));
  for (let i = 0; i < n; i++) {
    const cx = x0 + (w * (i + 0.5)) / n;
    const cy = y0 + h * (0.3 + rnd() * 0.45);
    const s = h * (0.13 + rnd() * 0.05);
    ctx.beginPath();
    if (i % 2 === 0) {
      // Estrella de mar de cinco puntas.
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 === 0 ? s : s * 0.45;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = i % 4 === 0 ? '#f2a0bf' : '#ef8f3a';
    } else {
      // Delfín: cuerpo curvo, cola.
      ctx.moveTo(cx - s * 1.4, cy);
      ctx.quadraticCurveTo(cx - s * 0.2, cy - s * 0.9, cx + s * 1.1, cy - s * 0.1);
      ctx.lineTo(cx + s * 1.5, cy - s * 0.45);
      ctx.lineTo(cx + s * 1.4, cy + s * 0.15);
      ctx.quadraticCurveTo(cx, cy + s * 0.5, cx - s * 1.4, cy);
      ctx.closePath();
      ctx.fillStyle = i % 3 === 0 ? '#3c8fd8' : '#2e5fb0';
    }
    ctx.fill();
    ctx.stroke();
  }
  // Algas verdes al pie.
  ctx.fillStyle = '#4fa64a';
  ctx.fillRect(x0, y1 - h * 0.1, w, h * 0.1);
  ctx.restore();
}
