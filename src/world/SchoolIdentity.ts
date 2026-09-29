import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { COURT, FLAG, SCHOOL, toWorld, type SchoolFrame } from './SchoolLayout';

/** Tamaño del atlas: todas las superficies pintadas del campus en una textura. */
const ATLAS = 1024;

/** Regiones del atlas, en píxeles del canvas: [x0, y0, x1, y1]. */
const R = {
  sign: [0, 0, 1024, 256],
  court: [0, 264, 560, 624],
  totem: [572, 264, 764, 694],
  flag: [776, 264, 1016, 417],
  clock: [776, 430, 904, 558],
  mural: [0, 636, 560, 860],
  maker: [572, 704, 764, 1016],
  crest: [768, 568, 1024, 824],
} as const;

type Region = readonly [number, number, number, number];

/**
 * Señalética y superficies pintadas del campus CIMDIP & Miguel Cané.
 *
 * Cartel institucional, reloj, tótem de ingreso, bandera argentina, cancha
 * demarcada y mural del patio comparten UNA textura (un atlas dibujado en
 * canvas al cargar) y UNA malla. Seis elementos de identidad cuestan un solo
 * draw call, que en VR es lo que importa.
 *
 * El escudo se dibuja en el atlas a partir del blasón publicado y la fachada
 * sigue las fotos de referencia. Así no se carga una imagen remota en ejecución.
 */
export class SchoolIdentity {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;

  constructor(scene: Scene, frame: SchoolFrame) {
    this.texture = new DynamicTexture('schoolAtlas', { width: ATLAS, height: ATLAS }, scene, true);
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    drawAtlas(ctx);
    this.texture.update(true);
    this.texture.anisotropicFilteringLevel = 8;

    this.material = new StandardMaterial('schoolIdentity', scene);
    this.material.diffuseTexture = this.texture;
    this.material.diffuseColor = new Color3(0.5, 0.5, 0.5);
    this.material.specularColor = Color3.Black();
    // Luz propia moderada: el cartel se lee aunque la fachada quede en sombra.
    this.material.emissiveColor = new Color3(0.3, 0.3, 0.3);
    // La bandera se ve de los dos lados.
    this.material.backFaceCulling = false;

    const S = SCHOOL;
    const q = new QuadBatch(frame);
    const signFront = S.frontV - 0.86;
    const crestFront = S.frontV - 0.63;
    q.vertical(0, signFront, 3.22, 12.8, 2.4, -1, R.sign);
    q.vertical(0, crestFront, 7.43, 1.55, 1.3, -1, R.crest);
    // Tótem: el cartel en las dos caras.
    const tv = S.fenceV + 0.95;
    q.vertical(-5.9, tv - 0.22, 1.72, 1.3, 2.9, -1, R.totem);
    q.vertical(-5.9, tv + 0.22, 1.72, 1.3, 2.9, 1, R.totem);
    // Señal clara del espacio tecnológico junto al acceso del campus.
    q.vertical(6.8, -20.54, 1.45, 3.05, 2.35, -1, R.maker);
    // Bandera izada, pegada al mástil.
    q.vertical(FLAG.u + 0.98, FLAG.v, 9.15, 1.8, 1.14, -1, R.flag);
    // Cancha pintada sobre el solado del patio.
    q.horizontal(COURT.u0, COURT.v0, COURT.u1, COURT.v1, 0.075, R.court);
    // Mural en la cara del bloque del frente que da al patio.
    q.vertical(-7.1, S.frontBackV + 0.02, 1.85, 6.8, 2.7, 1, R.mural);

    this.mesh = q.toMesh('schoolIdentity', scene);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
  }

  get shadowCasters(): Mesh[] {
    return [this.mesh];
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

// ------------------------------------------------------------------ geometría

/** Acumula quads texturizados en coordenadas locales del campus. */
class QuadBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  constructor(private readonly f: SchoolFrame) {}

  /**
   * Cartel vertical centrado en (u, v) a la altura `y`.
   * `facing` = −1 mira hacia −v (la calle), +1 hacia +v (el patio).
   */
  vertical(u: number, v: number, y: number, w: number, h: number, facing: -1 | 1, r: Region): void {
    // Para quien mira el cartel, "derecha" es +u si mira hacia +v (cartel
    // orientado a −v) y −u en el caso contrario.
    const right = -facing;
    const hw = w / 2;
    const hh = h / 2;
    const bl: L = [u - right * hw, y - hh, v];
    const br: L = [u + right * hw, y - hh, v];
    const tr: L = [u + right * hw, y + hh, v];
    const tl: L = [u - right * hw, y + hh, v];
    this.push([bl, br, tr, tl], [0, 0, facing], r);
  }

  /** Superficie horizontal (cancha), vista desde arriba con +v "hacia arriba". */
  horizontal(u0: number, v0: number, u1: number, v1: number, y: number, r: Region): void {
    this.push(
      [
        [u0, y, v0],
        [u1, y, v0],
        [u1, y, v1],
        [u0, y, v1],
      ],
      [0, 1, 0],
      r,
    );
  }

  private push(c: [L, L, L, L], nLocal: [number, number, number], r: Region): void {
    const base = this.positions.length / 3;
    const n = this.world(nLocal[0], nLocal[2]);
    const nx = n.x - this.f.cx;
    const nz = n.z - this.f.cz;
    for (const p of c) {
      const w = this.world(p[0], p[2]);
      this.positions.push(w.x, p[1], w.z);
      this.normals.push(nx, nLocal[1], nz);
    }
    // Con invertY (el valor por defecto) la fila 0 del canvas es v = 1.
    const u0 = r[0] / ATLAS;
    const u1 = r[2] / ATLAS;
    const vb = 1 - r[3] / ATLAS;
    const vt = 1 - r[1] / ATLAS;
    this.uvs.push(u0, vb, u1, vb, u1, vt, u0, vt);

    // Orden de índices que Babylon considera cara frontal para esta normal:
    // su normal de cara es (a−b)×(c−b).
    const P = (i: number) => this.positions.slice((base + i) * 3, (base + i) * 3 + 3);
    const a = P(0);
    const b = P(1);
    const cc = P(2);
    const fx = (a[1] - b[1]) * (cc[2] - b[2]) - (a[2] - b[2]) * (cc[1] - b[1]);
    const fy = (a[2] - b[2]) * (cc[0] - b[0]) - (a[0] - b[0]) * (cc[2] - b[2]);
    const fz = (a[0] - b[0]) * (cc[1] - b[1]) - (a[1] - b[1]) * (cc[0] - b[0]);
    if (fx * nx + fy * nLocal[1] + fz * nz >= 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  private world(u: number, v: number): { x: number; z: number } {
    return toWorld(this.f, u, v);
  }

  toMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    mesh.freezeWorldMatrix();
    return mesh;
  }
}

type L = [number, number, number];

// -------------------------------------------------------------------- dibujo

const GREEN = '#173b35';
const GREEN_2 = '#1f5147';
const GOLD = '#e0b049';
const CREAM = '#f7f2e8';

function drawAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  drawSign(ctx, R.sign);
  drawCourt(ctx, R.court);
  drawTotem(ctx, R.totem);
  drawFlag(ctx, R.flag);
  drawClock(ctx, R.clock);
  drawMural(ctx, R.mural);
  drawMaker(ctx, R.maker);
  drawCrest(ctx, R.crest);
}

/** Escudo institucional según el blasón publicado por la escuela. */
function emblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
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
  ctx.translate(0, 0);
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
  ctx.fillStyle = '#b74b58';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#eef1f0';
  ctx.fillRect(x0, y0 + 11, w, 9);
  ctx.fillStyle = '#243b67';
  ctx.fillRect(x0, y0 + h - 20, w, 9);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = CREAM;
  ctx.font = 'bold 55px Georgia, "Times New Roman", serif';
  ctx.fillText('C.I.M.D.I.P. & M. CANÉ', x0 + w / 2, y0 + 94);
  ctx.font = '30px Arial, Helvetica, sans-serif';
  ctx.fillText('Educación Inicial, Primaria y Secundaria', x0 + w / 2, y0 + 154);
}

function drawCourt(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  // Borde exterior verde y campo azul petróleo.
  ctx.fillStyle = '#3f7a5c';
  ctx.fillRect(x0, y0, w, h);
  const m = 16;
  ctx.fillStyle = '#3d7f8f';
  ctx.fillRect(x0 + m, y0 + m, w - m * 2, h - m * 2);
  // Zonas pintadas bajo los aros.
  ctx.fillStyle = '#c8643b';
  const keyW = w * 0.2;
  const keyH = h * 0.34;
  ctx.fillRect(x0 + m, y0 + h / 2 - keyH / 2, keyW, keyH);
  ctx.fillRect(x1 - m - keyW, y0 + h / 2 - keyH / 2, keyW, keyH);
  ctx.strokeStyle = '#f4f2ee';
  ctx.lineWidth = 5;
  ctx.strokeRect(x0 + m, y0 + m, w - m * 2, h - m * 2);
  ctx.strokeRect(x0 + m, y0 + h / 2 - keyH / 2, keyW, keyH);
  ctx.strokeRect(x1 - m - keyW, y0 + h / 2 - keyH / 2, keyW, keyH);
  ctx.beginPath();
  ctx.moveTo(x0 + w / 2, y0 + m);
  ctx.lineTo(x0 + w / 2, y1 - m);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x0 + w / 2, y0 + h / 2, h * 0.14, 0, Math.PI * 2);
  ctx.stroke();
  // Líneas de triple.
  for (const [cx, a0, a1] of [
    [x0 + m, -Math.PI / 2, Math.PI / 2],
    [x1 - m, Math.PI / 2, Math.PI * 1.5],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, y0 + h / 2, h * 0.36, a0, a1);
    ctx.stroke();
  }
  // Segunda demarcación en dorado: cancha de 18 x 9 para vóley, compatible
  // con el uso multideporte que describe la escuela. Convive con las líneas
  // blancas de básquet sin sumar otra malla ni otra textura.
  const volleyballInset = h * 0.12;
  ctx.strokeStyle = '#f0c75e';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(x0 + m * 1.15, y0 + volleyballInset, w - m * 2.3, h - volleyballInset * 2);
  ctx.beginPath();
  ctx.moveTo(x0 + w / 2, y0 + volleyballInset);
  ctx.lineTo(x0 + w / 2, y1 - volleyballInset);
  for (const side of [-1, 1]) {
    const u = x0 + w / 2 + side * (w - m * 2.3) / 6;
    ctx.moveTo(u, y0 + volleyballInset);
    ctx.lineTo(u, y1 - volleyballInset);
  }
  ctx.stroke();
  // Emblema en el círculo central.
  emblem(ctx, x0 + w / 2, y0 + h / 2, h * 0.1);
}

function drawTotem(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.fillStyle = GREEN_2;
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x0, y0, w, 10);
  ctx.fillRect(x0, y1 - 10, w, 10);
  emblem(ctx, x0 + w / 2, y0 + 86, 58);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CREAM;
  ctx.font = '700 44px Arial, Helvetica, sans-serif';
  ctx.fillText('CIMDIP', x0 + w / 2, y0 + 200);
  ctx.fillStyle = GOLD;
  ctx.font = '700 30px Arial, Helvetica, sans-serif';
  ctx.fillText('&', x0 + w / 2, y0 + 240);
  ctx.fillStyle = CREAM;
  ctx.font = '700 34px Arial, Helvetica, sans-serif';
  ctx.fillText('MIGUEL', x0 + w / 2, y0 + 284);
  ctx.fillText('CANÉ', x0 + w / 2, y0 + 322);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x0 + 40, y0 + 346, w - 80, 3);
  ctx.fillStyle = '#b7d4ca';
  ctx.font = '400 22px Arial, Helvetica, sans-serif';
  ctx.fillText('Bienvenidos', x0 + w / 2, y0 + 386);
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
