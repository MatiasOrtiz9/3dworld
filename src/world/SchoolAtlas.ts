/**
 * Atlas de la escuela: todo lo que se PINTA (carteles, murales, cancha,
 * plano de evacuación, gráficas) en un único canvas. No depende del motor: se
 * puede dibujar en cualquier canvas, también fuera de Babylon para revisarlo.
 */
import {
  ROOMS,
  STAIRS,
  U,
  V,
  WALLS,
  WALKABLE,
} from './SchoolLayout';
import {
  drawBalletPoster,
  drawCorkBoard,
  drawCrestBanner,
  drawEducabot,
  drawMakerWall,
  drawMarble,
  drawMotto,
  drawProFood,
  drawSalida,
  drawSanMartin,
  emblem,
} from './SchoolArt';

/** Atlas: todas las superficies pintadas del campus en una textura. */
export const AW = 2048;
export const AH = 2048;

/** Regiones del atlas, en píxeles del canvas: [x0, y0, x1, y1]. */
export const R = {
  sign: [0, 0, 1024, 256],
  court: [0, 264, 560, 624],
  totem: [572, 264, 764, 694],
  flag: [776, 264, 1016, 417],
  clock: [776, 430, 904, 558],
  mural: [0, 636, 560, 860],
  maker: [572, 704, 764, 1016],
  crest: [768, 568, 1024, 824],
  lapr: [0, 1544, 508, 1640],
  mcane: [516, 1544, 1024, 1640],
  plan: [0, 1648, 640, 2040],
  meet: [648, 1648, 904, 1944],
  // Recorrido virtual 2020 (mitad derecha del atlas).
  sanMartin: [1024, 0, 1536, 300],
  motto: [1536, 0, 2048, 128],
  marble: [1536, 136, 1792, 392],
  educabot: [1800, 136, 1864, 392],
  proFood: [1872, 136, 2048, 268],
  salida: [1872, 276, 2048, 340],
  // Mural del Aula Maker: dos paños de 5,8 × 2,35 m sobre la medianera y
  // COMPARTE (4,1 × 2,35 m) en el testero; la proporción de cada región es la
  // del paño, así las placas salen cuadradas.
  makerA: [1024, 400, 2048, 815],
  makerB: [1024, 820, 2048, 1235],
  makerC: [1024, 1240, 1536, 1534],
  crestBanner: [1544, 1240, 1800, 1560],
  ballet1: [1808, 1240, 1928, 1424],
  ballet2: [1928, 1240, 2048, 1424],
  cork1: [1544, 1568, 1800, 1760],
  cork2: [1808, 1568, 2048, 1760],
  // Fachada del jardín: marquesina y banda vertical (10:38–10:41).
  inicial: [1024, 1776, 2048, 1904],
  cimdip: [904, 1648, 1000, 2040],
} as const;

export type Region = readonly [number, number, number, number];

/** Carteles de los ambientes, con el texto tal como figura en el plano. */
export const PLATES = [
  'TECNOLOGÍA',
  'E.P',
  'ADM',
  'PROF.',
  'DIR. PRIM',
  'BUFFET',
  'SALÓN DE LOS ESPEJOS',
  'GIMNASIO · SUM',
  'ARTE',
  'TEATRO',
  'V. DAMAS',
  'JARDÍN DE INFANTES CIMPID',
  'PATIO AIRE LIBRE',
  'HALL DE ACCESO',
] as const;
export type PlateName = (typeof PLATES)[number];

export function plateRegion(name: PlateName): Region {
  const i = PLATES.indexOf(name);
  const col = i % 2;
  const row = Math.floor(i / 2);
  return [col * 512 + 4, 1032 + row * 72, col * 512 + 508, 1032 + row * 72 + 64];
}

// -------------------------------------------------------------------- dibujo

const GREEN = '#173b35';
const GREEN_2 = '#1f5147';
const GOLD = '#e0b049';
const CREAM = '#f7f2e8';
const RED = '#b8353c';

/** Pinta el atlas completo en un contexto de AW × AH. */
export function drawAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, AW, AH);
  drawSign(ctx, R.sign);
  drawCourt(ctx, R.court);
  drawTotem(ctx, R.totem);
  drawFlag(ctx, R.flag);
  drawClock(ctx, R.clock);
  drawMural(ctx, R.mural);
  drawMaker(ctx, R.maker);
  drawCrest(ctx, R.crest);
  for (const name of PLATES) drawPlate(ctx, plateRegion(name), name);
  drawStreetSign(ctx, R.lapr, 'LAPRIDA');
  drawStreetSign(ctx, R.mcane, 'MIGUEL CANÉ');
  drawPlan(ctx, R.plan);
  drawMeetingPoint(ctx, R.meet);
  drawSanMartin(ctx, R.sanMartin);
  drawMotto(ctx, R.motto);
  drawMarble(ctx, R.marble);
  drawEducabot(ctx, R.educabot);
  drawProFood(ctx, R.proFood);
  drawSalida(ctx, R.salida);
  drawMakerWall(ctx, R.makerA, ['IMAGINA', 'DISEÑA'], 0);
  drawMakerWall(ctx, R.makerB, ['CREA', 'APRENDE'], 1);
  drawMakerWall(ctx, R.makerC, ['COMPARTE'], 0);
  drawCrestBanner(ctx, R.crestBanner);
  drawBalletPoster(ctx, R.ballet1, 0);
  drawBalletPoster(ctx, R.ballet2, 1);
  drawCorkBoard(ctx, R.cork1, 1);
  drawCorkBoard(ctx, R.cork2, 2);
  drawInicial(ctx, R.inicial);
  drawCimdipBand(ctx, R.cimdip);
}

/** Marquesina roja del jardín con "Educación Inicial" en blanco. */
function drawInicial(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#c22832';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(x0, y0 + h * 0.82, w, h * 0.07);
  // Texto alineado a la derecha y el gatito del logo a la izquierda (10:40).
  ctx.font = `700 ${Math.round(h * 0.46)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('Educación Inicial', x1 - w * 0.04, y0 + h * 0.42);
  const cx = x0 + h * 0.7;
  ctx.beginPath();
  ctx.arc(cx, y0 + h * 0.42, h * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f3b6a';
  ctx.beginPath();
  ctx.arc(cx, y0 + h * 0.47, h * 0.16, 0, Math.PI * 2);
  ctx.moveTo(cx - h * 0.14, y0 + h * 0.36);
  ctx.lineTo(cx - h * 0.1, y0 + h * 0.2);
  ctx.lineTo(cx - h * 0.02, y0 + h * 0.33);
  ctx.moveTo(cx + h * 0.14, y0 + h * 0.36);
  ctx.lineTo(cx + h * 0.1, y0 + h * 0.2);
  ctx.lineTo(cx + h * 0.02, y0 + h * 0.33);
  ctx.fill();
}

/** Banda azul marino con CIMDIP en letras blancas apiladas. */
function drawCimdipBand(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#1f3b6a';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(w * 0.62)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const letters = 'CIMDIP';
  for (let i = 0; i < letters.length; i++) {
    ctx.fillText(letters[i], x0 + w / 2, y0 + (h * (i + 0.5)) / letters.length);
  }
}

function drawCrest(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.clearRect(x0, y0, w, h);
  ctx.fillStyle = '#343943';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = '#1c2028';
  ctx.lineWidth = 5;
  ctx.strokeRect(x0 + 2.5, y0 + 2.5, w - 5, h - 5);
  emblem(ctx, x0 + w / 2, y0 + h * 0.47, 104);
  ctx.fillStyle = '#f4eee2';
  ctx.font = 'italic 10px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('Desde 1981', x0 + w / 2, y1 - 7);
}

/** Marca compacta inspirada en los colores institucionales. */
function drawSign(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  // Rojo vivo con filete blanco y azul arriba y letras grandes (0:09–0:16).
  ctx.fillStyle = '#d42a2a';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#eef1f0';
  ctx.fillRect(x0, y0 + 8, w, 10);
  ctx.fillStyle = '#243b67';
  ctx.fillRect(x0, y0 + 20, w, 10);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  // La región se estira sobre un cartel de 8,2 × 1,36 m: se comprime en x
  // para que las letras salgan con su proporción.
  ctx.save();
  ctx.translate(x0 + w / 2, 0);
  ctx.scale(0.64, 1);
  ctx.font = 'bold 90px Georgia, "Times New Roman", serif';
  ctx.fillText('C.I.M.D.I.P.& M.CANÉ', 0, y0 + 112);
  ctx.font = '44px Arial, Helvetica, sans-serif';
  ctx.fillText('Educación Inicial, Primaria y Secundaria', 0, y0 + 200);
  ctx.restore();
}

function drawFlag(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#74acdf';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0, y0 + h / 3, w, h / 3);
  // Sol de Mayo.
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  ctx.fillStyle = '#f6b40e';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(3, 0);
    ctx.lineTo(0, i % 2 ? 19 : 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#85340a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawClock(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1] = r;
  const s = x1 - x0;
  const cx = x0 + s / 2;
  const cy = y0 + s / 2;
  ctx.fillStyle = GREEN;
  ctx.fillRect(x0, y0, s, s);
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2d2f33';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.lineWidth = i % 3 === 0 ? 5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * s * 0.33, cy - Math.cos(a) * s * 0.33);
    ctx.lineTo(cx + Math.sin(a) * s * 0.4, cy - Math.cos(a) * s * 0.4);
    ctx.stroke();
  }
  // 10:10, la hora de las fotos de relojes.
  const hand = (a: number, len: number, width: number) => {
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
    ctx.stroke();
  };
  hand(((10 + 10 / 60) / 12) * Math.PI * 2, s * 0.22, 6);
  hand((10 / 60) * Math.PI * 2, s * 0.34, 4);
}

function drawMural(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  // Panel inspirado en el aula maker de las fotos: fondo claro, palabras
  // grandes y módulos de color con iconos de ciencia y tecnología.
  ctx.fillStyle = '#f8f7f2';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#253d91';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 31px Arial, Helvetica, sans-serif';
  ctx.fillText('IMAGINA   ·   DISEÑA   ·   CREA', x0 + w / 2, y0 + 49, w - 24);

  const colors = ['#e5b529', '#493e9d', '#db7c24', '#1686ac', '#cb5688', '#4b71bc', '#6b9c46'];
  const tileW = 54;
  const gap = 8;
  const total = colors.length * tileW + (colors.length - 1) * gap;
  const startX = x0 + (w - total) / 2;
  for (let i = 0; i < colors.length; i++) {
    const tx = startX + i * (tileW + gap);
    const ty = y0 + 82 + (i % 2) * 5;
    ctx.fillStyle = colors[i];
    ctx.fillRect(tx, ty, tileW, 54);
    ctx.strokeStyle = 'rgba(255,255,255,.72)';
    ctx.lineWidth = 2;
    ctx.strokeRect(tx + 4, ty + 4, tileW - 8, 46);
    drawMakerIcon(ctx, i, tx + tileW / 2, ty + 27);
  }
  // Pequeños motivos lineales en los márgenes, como los iconos pintados
  // alrededor de las palabras en el aula de referencia.
  ctx.strokeStyle = '#29a0b7';
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    const cx = x0 + w / 2 + side * (w / 2 - 25);
    const cy = y0 + 152;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.moveTo(cx, cy - 13);
    ctx.lineTo(cx, cy - 20);
    ctx.moveTo(cx, cy + 13);
    ctx.lineTo(cx, cy + 20);
    ctx.moveTo(cx - 13, cy);
    ctx.lineTo(cx - 20, cy);
    ctx.moveTo(cx + 13, cy);
    ctx.lineTo(cx + 20, cy);
    ctx.stroke();
  }
  ctx.fillStyle = '#374d86';
  ctx.font = '700 15px Arial, Helvetica, sans-serif';
  ctx.fillText('ROBÓTICA  ·  CIENCIA  ·  TECNOLOGÍA', x0 + w / 2, y0 + 190, w - 20);
}

function drawMakerIcon(ctx: CanvasRenderingContext2D, index: number, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (index === 0) {
    ctx.beginPath();
    ctx.moveTo(-17, 0);
    ctx.lineTo(15, 0);
    ctx.moveTo(5, -10);
    ctx.lineTo(16, 0);
    ctx.lineTo(5, 10);
    ctx.stroke();
  } else if (index === 1) {
    ctx.font = '700 19px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('</>', 0, 0);
  } else if (index === 2) {
    ctx.beginPath();
    ctx.arc(-10, -8, 5, 0, Math.PI * 2);
    ctx.arc(-10, 8, 5, 0, Math.PI * 2);
    ctx.moveTo(-6, -5);
    ctx.lineTo(16, 12);
    ctx.moveTo(-6, 5);
    ctx.lineTo(16, -12);
    ctx.moveTo(16, -12);
    ctx.lineTo(8, 0);
    ctx.moveTo(16, 12);
    ctx.lineTo(8, 0);
    ctx.stroke();
  } else if (index === 3) {
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.stroke();
    for (let spoke = 0; spoke < 8; spoke++) {
      const a = (spoke * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
      ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16);
      ctx.stroke();
    }
  } else if (index === 4) {
    ctx.beginPath();
    ctx.arc(-3, -3, 10, 0, Math.PI * 2);
    ctx.moveTo(5, 5);
    ctx.lineTo(15, 15);
    ctx.stroke();
  } else if (index === 5) {
    ctx.beginPath();
    ctx.arc(0, -3, 9, Math.PI, Math.PI * 2);
    ctx.lineTo(8, 5);
    ctx.lineTo(5, 9);
    ctx.lineTo(-5, 9);
    ctx.lineTo(-8, 5);
    ctx.closePath();
    ctx.moveTo(-5, 14);
    ctx.lineTo(5, 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -21);
    ctx.lineTo(0, -16);
    ctx.moveTo(-17, -13);
    ctx.lineTo(-13, -10);
    ctx.moveTo(17, -13);
    ctx.lineTo(13, -10);
    ctx.stroke();
  } else {
    ctx.strokeRect(-15, -12, 30, 24);
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, -18);
    ctx.moveTo(-4, -18);
    ctx.lineTo(4, -18);
    ctx.stroke();
    ctx.fillRect(-9, -5, 4, 4);
    ctx.fillRect(5, -5, 4, 4);
    ctx.beginPath();
    ctx.moveTo(-6, 5);
    ctx.lineTo(6, 5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMaker(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = GREEN_2;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 7;
  ctx.strokeRect(x0 + 7, y0 + 7, w - 14, h - 14);
  // Cabeza de robot geométrica: tecnología legible de lejos y en el mapa.
  const cx = x0 + w / 2;
  const cy = y0 + 68;
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 25);
  ctx.lineTo(cx, cy - 42);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(cx, cy - 46, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.fillRect(cx - 43, cy - 25, 86, 66);
  ctx.fillStyle = GREEN;
  ctx.fillRect(cx - 27, cy - 4, 12, 12);
  ctx.fillRect(cx + 15, cy - 4, 12, 12);
  ctx.fillRect(cx - 17, cy + 20, 34, 5);
  ctx.fillStyle = GOLD;
  ctx.fillRect(cx - 56, cy - 7, 13, 27);
  ctx.fillRect(cx + 43, cy - 7, 13, 27);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CREAM;
  ctx.font = '700 27px Arial, Helvetica, sans-serif';
  ctx.fillText('AULA MAKER', cx, y1 - 82);
  ctx.fillStyle = '#d6e5dc';
  ctx.font = '400 17px Arial, Helvetica, sans-serif';
  ctx.fillText('TECNOLOGÍA · ROBÓTICA', cx, y1 - 48);
  ctx.fillText('PROGRAMACIÓN', cx, y1 - 25);
}

/**
 * Cancha del polideportivo: piso completo con demarcación de handball en
 * escala reducida. El eje de la cancha corre de oeste a este (x del dibujo =
 * u) con los arcos en los testeros; arriba del dibujo es el norte. Se dibuja
 * en metros, así los círculos salen redondos aunque la región no tenga la
 * proporción del piso.
 */
function drawCourt(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const L = U.e - U.gymW - 0.25; // largo (u)
  const W = -V.gymTop - 0.25; // ancho (v)
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  ctx.translate(x0, y0);
  ctx.scale((x1 - x0) / L, (y1 - y0) / W);
  // Cemento alisado claro con paños; líneas finas oscuras de handball.
  ctx.fillStyle = '#d3cec4';
  ctx.fillRect(0, 0, L, W);
  ctx.strokeStyle = 'rgba(150,145,135,0.35)';
  ctx.lineWidth = 0.03;
  for (let x = 0; x <= L; x += 1.5) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, W);
    ctx.stroke();
  }
  for (let y = 0; y <= W; y += 1.5) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(L, y);
    ctx.stroke();
  }
  // Cancha: deja libre la franja de las gradas (lateral de Laprida = abajo).
  const m = 0.7;
  const cw = W - 3.4;
  const cy0 = m;
  const line = '#4d5054';
  ctx.strokeStyle = line;
  ctx.lineWidth = 0.06;
  ctx.strokeRect(m, cy0, L - m * 2, cw);
  ctx.beginPath();
  ctx.moveTo(L / 2, cy0);
  ctx.lineTo(L / 2, cy0 + cw);
  ctx.stroke();
  const cyc = cy0 + cw / 2;
  // Áreas de 4 m y líneas de tiro libre punteadas a 6 m, en los dos arcos.
  for (const [gx, dir] of [
    [m, 1],
    [L - m, -1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(gx, cyc, 4, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.stroke();
    ctx.setLineDash([0.3, 0.3]);
    ctx.beginPath();
    ctx.arc(gx, cyc, 6, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = line;
    ctx.fillRect(gx + dir * 7 - 0.04, cyc - 0.5, 0.08, 1);
  }
  ctx.beginPath();
  ctx.arc(L / 2, cyc, 1.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Banner de pie del hall: el que aparece al entrar en el recorrido virtual. */
function drawTotem(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = RED;
  ctx.lineWidth = 8;
  ctx.strokeRect(x0 + 4, y0 + 4, w - 8, h - 8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#7a1f25';
  ctx.font = '700 26px Georgia, "Times New Roman", serif';
  ctx.fillText('ESCUELA', x0 + w / 2, y0 + 48);
  ctx.font = '700 21px Georgia, "Times New Roman", serif';
  ctx.fillText('CIMDIP &', x0 + w / 2, y0 + 80);
  ctx.fillText('MIGUEL CANÉ', x0 + w / 2, y0 + 106);
  ctx.fillStyle = RED;
  ctx.font = '700 15px Arial, Helvetica, sans-serif';
  ctx.fillText('MATERNAL · JARDÍN', x0 + w / 2, y0 + 142);
  ctx.fillText('PRIMARIA · SECUNDARIA', x0 + w / 2, y0 + 164);
  emblem(ctx, x0 + w / 2, y0 + 262, 62);
  ctx.fillStyle = '#7a1f25';
  ctx.font = 'italic 15px Georgia, "Times New Roman", serif';
  ctx.fillText('Desde 1981', x0 + w / 2, y0 + 366);
  ctx.fillStyle = RED;
  ctx.fillRect(x0 + 18, y1 - 34, w - 36, 12);
}

/** Cartel de ambiente: fondo blanco, filete rojo, texto del plano. */
function drawPlate(ctx: CanvasRenderingContext2D, r: Region, text: string): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = RED;
  ctx.fillRect(x0, y0, 16, h);
  ctx.fillRect(x0, y1 - 6, w, 6);
  ctx.fillStyle = '#1f2430';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 32px Arial, Helvetica, sans-serif';
  ctx.fillText(text, x0 + 8 + w / 2, y0 + h / 2 - 2, w - 40);
}

/** Cartel de calle azul con letras blancas. */
function drawStreetSign(ctx: CanvasRenderingContext2D, r: Region, text: string): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = '#1d4f91';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = '#f5f7fa';
  ctx.lineWidth = 5;
  ctx.strokeRect(x0 + 7, y0 + 7, w - 14, h - 14);
  ctx.fillStyle = '#f5f7fa';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 52px Arial, Helvetica, sans-serif';
  ctx.fillText(text, x0 + w / 2, y0 + h / 2 + 2, w - 40);
}

/** Señal de punto de encuentro: cuatro flechas hacia un grupo de personas. */
function drawMeetingPoint(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  ctx.fillStyle = '#f5f7f5';
  ctx.fillRect(x0, y0, w, y1 - y0);
  const s = w - 24;
  const sx = x0 + 12;
  const sy = y0 + 12;
  ctx.fillStyle = '#16884a';
  ctx.fillRect(sx, sy, s, s);
  ctx.fillStyle = '#f5f7f5';
  const cx = sx + s / 2;
  const cy = sy + s / 2;
  // Flechas desde las esquinas hacia el centro.
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4 + (k * Math.PI) / 2);
    ctx.fillRect(-7, -s * 0.46, 14, s * 0.16);
    ctx.beginPath();
    ctx.moveTo(-20, -s * 0.3);
    ctx.lineTo(20, -s * 0.3);
    ctx.lineTo(0, -s * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // Cuatro personas en el centro.
  for (const [dx, sc] of [
    [-30, 0.8],
    [-10, 1],
    [10, 1],
    [30, 0.8],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy - 18 * sc, 7 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx + dx - 7 * sc, cy - 9 * sc, 14 * sc, 30 * sc);
  }
  ctx.fillStyle = '#16884a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 25px Arial, Helvetica, sans-serif';
  ctx.fillText('PUNTO DE', x0 + w / 2, y1 - 44);
  ctx.fillText('ENCUENTRO', x0 + w / 2, y1 - 17);
}

/**
 * Plano de evacuación de planta baja, dibujado desde `SchoolLayout`. Si un
 * muro se corre en los datos, el plano colgado en el hall se corre con él.
 */
function drawPlan(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  ctx.fillStyle = '#fbfbf9';
  ctx.fillRect(x0, y0, w, y1 - y0);
  ctx.fillStyle = '#1f2430';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 20px Arial, Helvetica, sans-serif';
  ctx.fillText('PLANO DE EVACUACIÓN — PLANTA BAJA', x0 + w / 2, y0 + 20);
  const scale = 7.9;
  const ox = x0 + 44;
  const oy = y0 + 48 + 40 * scale; // v = 0 (Laprida)
  const at = (u: number, v: number): [number, number] => [ox + u * scale, oy + v * scale];
  // Ambientes con nombre.
  ctx.font = '600 9px Arial, Helvetica, sans-serif';
  ctx.fillStyle = '#3a4150';
  // Sólo la planta baja: es la copia del plano colgado en el hall.
  for (const room of ROOMS) {
    if ((room.level ?? 0) !== 0) continue;
    if (!room.name || room.name === 'Pasillo' || room.name === 'Aula') continue;
    let cu = 0;
    let cv = 0;
    for (const [u, v] of room.poly) {
      cu += u;
      cv += v;
    }
    const [px, py] = at(cu / room.poly.length, cv / room.poly.length);
    ctx.fillText(room.name.toUpperCase(), px, py, 90);
  }
  // Escaleras en gris.
  ctx.fillStyle = '#b9bcc2';
  for (const s of STAIRS) {
    if (s.y0 > 0.5) continue;
    const [a, b] = [at(s.u0, s.v0), at(s.u1, s.v1)];
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  }
  // Muros, con los vanos transitables abiertos.
  ctx.strokeStyle = '#15171c';
  ctx.lineCap = 'butt';
  for (const wl of WALLS) {
    if (wl.level !== 0) continue;
    const len = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]);
    const du = (wl.b[0] - wl.a[0]) / len;
    const dv = (wl.b[1] - wl.a[1]) / len;
    ctx.lineWidth = wl.kind === 'int' ? 1.6 : 2.4;
    let t = 0;
    const cuts = wl.openings.filter((o) => WALKABLE.has(o.type));
    for (const o of [...cuts, { t0: len, t1: len }]) {
      if (o.t0 > t) {
        const a = at(wl.a[0] + du * t, wl.a[1] + dv * t);
        const b = at(wl.a[0] + du * o.t0, wl.a[1] + dv * o.t0);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      t = Math.max(t, o.t1);
    }
  }
  // Salidas de emergencia en verde.
  ctx.fillStyle = '#16884a';
  for (const wl of WALLS) {
    for (const o of wl.openings) {
      if (o.type !== 'exit' && o.type !== 'entrance') continue;
      const len = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]);
      const t = (o.t0 + o.t1) / 2;
      const [px, py] = at(wl.a[0] + ((wl.b[0] - wl.a[0]) * t) / len, wl.a[1] + ((wl.b[1] - wl.a[1]) * t) / len);
      ctx.fillRect(px - 5, py - 5, 10, 10);
    }
  }
  // Usted está aquí: el plano cuelga en el hall.
  const [hx, hy] = at(U.east1 + 1.2, -4.4);
  ctx.fillStyle = '#d0262d';
  ctx.beginPath();
  ctx.arc(hx, hy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '700 10px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('USTED ESTÁ AQUÍ', hx + 8, hy - 8);
  // Calles.
  ctx.fillStyle = '#1f2430';
  ctx.textAlign = 'center';
  ctx.font = '700 12px Arial, Helvetica, sans-serif';
  ctx.fillText('CALLE LAPRIDA', ox + 34 * scale, oy + 22);
  ctx.save();
  ctx.translate(ox - 22, oy - 20 * scale);
  ctx.rotate(-Math.PI / 2 + 0.56);
  ctx.fillText('CALLE MIGUEL CANÉ', 0, 0);
  ctx.restore();
}
