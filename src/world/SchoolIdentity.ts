import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import {
  FLAG,
  ITEMS,
  MEETING_POINT,
  ROOMS,
  SCHOOL,
  STAIRS,
  U,
  V,
  WALLS,
  WALKABLE,
  rearV,
  toWorld,
  type SchoolFrame,
} from './SchoolLayout';

/** Atlas: todas las superficies pintadas del campus en una textura. */
const AW = 1024;
const AH = 2048;

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
  lapr: [0, 1544, 508, 1640],
  mcane: [516, 1544, 1024, 1640],
  plan: [0, 1648, 640, 2040],
  meet: [648, 1648, 904, 1944],
} as const;

type Region = readonly [number, number, number, number];

/** Carteles de los ambientes, con el texto tal como figura en el plano. */
const PLATES = [
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
type PlateName = (typeof PLATES)[number];

function plateRegion(name: PlateName): Region {
  const i = PLATES.indexOf(name);
  const col = i % 2;
  const row = Math.floor(i / 2);
  return [col * 512 + 4, 1032 + row * 72, col * 512 + 508, 1032 + row * 72 + 64];
}

const FY = SCHOOL.floorY;

/**
 * Señalética y superficies pintadas del campus CIMDIP & Miguel Cané.
 *
 * Marquesina del portal, escudo, bandera, banner del hall, mural de
 * Tecnología, cancha del gimnasio, carteles de cada ambiente con los nombres
 * del plano, carteles de calle, punto de encuentro y un plano de evacuación
 * dibujado desde los MISMOS datos con los que se levanta la escuela. Todo
 * comparte UNA textura y UNA malla: un solo draw call, que en VR es lo que
 * importa.
 */
export class SchoolIdentity {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;

  constructor(scene: Scene, frame: SchoolFrame) {
    this.texture = new DynamicTexture('schoolAtlas', { width: AW, height: AH }, scene, true);
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    drawAtlas(ctx);
    this.texture.update(true);
    this.texture.anisotropicFilteringLevel = 8;

    this.material = new StandardMaterial('schoolIdentity', scene);
    this.material.diffuseTexture = this.texture;
    this.material.diffuseColor = new Color3(0.5, 0.5, 0.5);
    this.material.specularColor = Color3.Black();
    // Luz propia moderada: los carteles se leen aunque queden en sombra.
    this.material.emissiveColor = new Color3(0.46, 0.46, 0.46);
    // La bandera se ve de los dos lados.
    this.material.backFaceCulling = false;

    const q = new QuadBatch(frame);
    const S = 1; // mira al sur (+v)
    const N = -1; // mira al norte (−v)
    const portalU = (32.95 + 41.9) / 2;
    // Portal sobre Laprida: marquesina y escudo.
    q.wall(portalU, 0.585, 3.5, 8.3, 1.4, 0, S, R.sign);
    q.wall(portalU, 0.525, 6.78, 0.72, 0.62, 0, S, R.crest);
    q.wall(FLAG.u, FLAG.v, FLAG.y, 1.6, 1.0, 0, S, R.flag);

    // Hall de acceso: banner de pie, reloj sobre las puertas y plano de evacuación.
    const banner = ITEMS.find((it) => it.kind === 'banner');
    if (banner) q.wall(banner.u + 0.03, banner.v, FY + 1.3, 0.84, 1.9, 1, 0, R.totem);
    q.wall(37.45, V.hallDoors - 0.13, 3.0, 0.42, 0.42, 0, N, R.clock);
    q.wall(U.east1 + 0.12, -4.4, 1.65, 1.3, 0.8, 1, 0, R.plan);

    // Tecnología: mural "imagina · diseña · crea" y cartel del aula maker.
    q.wall(25.0, V.nBlockN - 0.115, 1.95, 3.7, 1.48, 0, N, R.mural);
    q.wall(15.7, V.nBlockN - 0.115, 1.8, 0.9, 1.46, 0, N, R.maker);

    // Gimnasio: la cancha ocupa todo el piso; escudo en el muro norte.
    q.floorAlongV(U.gymW + 0.1, V.gymTop + 0.1, U.e - 0.15, -0.15, FY + 0.006, R.court);
    q.wall(57.8, V.gymTop + 0.14, 5.1, 1.6, 1.6, 0, S, R.crest);

    // Carteles de los ambientes sobre sus puertas.
    const plate = (name: PlateName, u: number, v: number, nu: number, nv: number, w = 1.15, y = 2.42) =>
      q.wall(u, v, y, w, w * (64 / 504), nu, nv, plateRegion(name));
    plate('E.P', 18.7, V.nBlockS + 0.115, 0, S);
    plate('TECNOLOGÍA', 18.7, V.nBlockN + 0.115, 0, S);
    plate('TECNOLOGÍA', 28.05, V.nBlockN + 0.115, 0, S);
    plate('ADM', 10.7, V.corrN - 0.115, 0, N, 0.8);
    plate('PROF.', 12.4, V.profB + 0.115, 0, S, 0.8);
    plate('DIR. PRIM', 5.5, V.dirTop - 0.115, 0, N, 0.9);
    plate('BUFFET', 29.4, V.corrS + 0.115, 0, S);
    plate('SALÓN DE LOS ESPEJOS', U.salonW - 0.115, -12.1, -1, 0, 1.5);
    plate('GIMNASIO · SUM', U.gymW - 0.115, -10.1, -1, 0, 1.5, 2.5);
    plate('GIMNASIO · SUM', 59.3, V.gymTop - 0.115, 0, N, 1.6, 2.55);
    plate('ARTE', 52.35, V.artB + 0.115, 0, S, 0.8);
    plate('TEATRO', 55.05, V.artB + 0.115, 0, S, 0.9);
    plate('V. DAMAS', U.vdW - 0.115, -25.95, -1, 0, 0.9);
    {
      // Puerta del jardín sobre la medianera vieja (diagonal).
      const k = 0.2496;
      const l = Math.hypot(1, k);
      const nu = -k / l;
      const nv = 1 / l;
      plate('JARDÍN DE INFANTES CIMPID', 60.75 + nu * 0.115, rearV(60.75) + nv * 0.115, nu, nv, 1.6);
    }
    plate('PATIO AIRE LIBRE', 24.45, V.corrS + 0.115, 0, S, 1.3, 2.78);
    plate('PATIO AIRE LIBRE', 37.2, V.hallTop + 0.115, 0, S, 1.3, 2.78);
    plate('HALL DE ACCESO', 37.45, V.hallDoors - 0.115, 0, N, 1.3, 3.35);

    // Esquina de Laprida y Miguel Cané: carteles de calle y punto de encuentro.
    const pole = { u: -6.3, v: 3.3 };
    for (const s of [S, N]) {
      q.wall(pole.u + 0.5, pole.v + s * 0.035, 2.95, 0.9, 0.17, 0, s, R.lapr);
    }
    {
      const du = 0.5382;
      const dv = -0.8428;
      for (const s of [1, -1]) {
        const nu = -dv * s;
        const nv = du * s;
        q.wall(pole.u + du * 0.5 + nu * 0.035, pole.v + dv * 0.5 + nv * 0.035, 3.2, 0.9, 0.17, nu, nv, R.mcane);
      }
    }
    q.wall(MEETING_POINT[0], MEETING_POINT[1] + 0.03, 2.0, 0.55, 0.64, 0, S, R.meet);

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

type L = [number, number, number];

/** Acumula quads texturizados en coordenadas locales del campus. */
class QuadBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  constructor(private readonly f: SchoolFrame) {}

  /**
   * Cartel vertical centrado en (u, v) a la altura `y`, con normal horizontal
   * (nu, nv). Para quien lo mira de frente, la derecha es (−nv, nu).
   */
  wall(u: number, v: number, y: number, w: number, h: number, nu: number, nv: number, r: Region): void {
    // Todo en mundo: +u es −x, así que la derecha del lector se calcula con
    // la normal ya transformada. En local el texto salía espejado.
    const c = toWorld(this.f, u, v);
    const o = toWorld(this.f, 0, 0);
    const n = toWorld(this.f, nu, nv);
    const nx = n.x - o.x;
    const nz = n.z - o.z;
    const rx = -nz;
    const rz = nx;
    const hw = w / 2;
    const hh = h / 2;
    const bl: L = [c.x - rx * hw, y - hh, c.z - rz * hw];
    const br: L = [c.x + rx * hw, y - hh, c.z + rz * hw];
    const tr: L = [c.x + rx * hw, y + hh, c.z + rz * hw];
    const tl: L = [c.x - rx * hw, y + hh, c.z - rz * hw];
    this.push([bl, br, tr, tl], [nx, 0, nz], r);
  }

  /** Superficie horizontal con el eje largo del dibujo a lo largo de v. */
  floorAlongV(u0: number, v0: number, u1: number, v1: number, y: number, r: Region): void {
    const w = (u: number, v: number): L => {
      const p = toWorld(this.f, u, v);
      return [p.x, y, p.z];
    };
    this.push([w(u1, v0), w(u1, v1), w(u0, v1), w(u0, v0)], [0, 1, 0], r);
  }

  /** Esquinas ya en mundo: inferior-izq, inferior-der, superior-der, superior-izq. */
  private push(c: [L, L, L, L], nLocal: [number, number, number], r: Region): void {
    const base = this.positions.length / 3;
    for (const p of c) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nLocal[0], nLocal[1], nLocal[2]);
    }
    // Con invertY (el valor por defecto) la fila 0 del canvas es v = 1.
    const u0 = r[0] / AW;
    const u1 = r[2] / AW;
    const vb = 1 - r[3] / AH;
    const vt = 1 - r[1] / AH;
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
    if (fx * nLocal[0] + fy * nLocal[1] + fz * nLocal[2] >= 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
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

// -------------------------------------------------------------------- dibujo

const GREEN = '#173b35';
const GREEN_2 = '#1f5147';
const GOLD = '#e0b049';
const CREAM = '#f7f2e8';
const RED = '#b8353c';

function drawAtlas(ctx: CanvasRenderingContext2D): void {
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
 * Cancha del gimnasio / SUM: piso completo con demarcación de handball en
 * escala reducida (el eje largo del dibujo corre de norte a sur). Se dibuja
 * en metros, así los círculos salen redondos aunque la región no tenga la
 * proporción del piso.
 */
function drawCourt(ctx: CanvasRenderingContext2D, r: Region): void {
  const [x0, y0, x1, y1] = r;
  const L = -V.gymTop - 0.25; // largo (v)
  const W = U.e - U.gymW - 0.25; // ancho (u)
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  ctx.translate(x0, y0);
  ctx.scale((x1 - x0) / L, (y1 - y0) / W);
  ctx.fillStyle = '#bcb8ad';
  ctx.fillRect(0, 0, L, W);
  // Cancha: deja libre la franja de las gradas (lado este = arriba del dibujo).
  const m = 0.7;
  const cw = W - 3.2;
  const cy0 = W - m - cw;
  ctx.fillStyle = '#b1ada2';
  ctx.fillRect(m, cy0, L - m * 2, cw);
  ctx.strokeStyle = '#f4f3ef';
  ctx.lineWidth = 0.08;
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
    ctx.strokeStyle = '#2f5aa8';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(gx, cyc, 4, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = '#c0393f';
    ctx.setLineDash([0.3, 0.3]);
    ctx.beginPath();
    ctx.arc(gx, cyc, 6, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f4f3ef';
    ctx.fillRect(gx + dir * 7 - 0.05, cyc - 0.5, 0.1, 1);
  }
  ctx.strokeStyle = '#f4f3ef';
  ctx.beginPath();
  ctx.arc(L / 2, cyc, 1.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // Emblema en el círculo central (en píxeles, fuera de la escala).
  const px = x0 + ((x1 - x0) * (L / 2)) / L;
  const py = y0 + ((y1 - y0) * cyc) / W;
  emblem(ctx, px, py, 26);
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
  for (const room of ROOMS) {
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
    const [a, b] = [at(s.u0, s.v0), at(s.u1, s.v1)];
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  }
  // Muros, con los vanos transitables abiertos.
  ctx.strokeStyle = '#15171c';
  ctx.lineCap = 'butt';
  for (const wl of WALLS) {
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
