import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { LEVEL_Y, SCHOOL, WALLS, type SchoolFrame } from './SchoolLayout';
import type { LampFixture } from './builders/school/SchoolKit';

/**
 * Pozos de luz falsos de los interiores (auditoría 2050, ítem 24).
 *
 * La luz de las aulas y pasillos es un brillo parejo más el mapa de luz
 * natural (HANDOFF §5.52): nada dice "acá hay una luminaria". En el visor,
 * sin SSAO ni bloom, los interiores se veían de plástico. Acá, bajo cada
 * luminaria que anotó el constructor (`SchoolKit.fixtures`), un óvalo
 * aditivo y blando en el piso (alargado con el tubo) y, si hay un muro a
 * menos de un metro, la "vieira" de luz que deja una luminaria contra la
 * pared. Cálida en el hall, el comedor y el jardín; fría en aulas y
 * pasillos. Una sola malla y un draw call (la técnica de `GymGlints`, sin
 * shader propio); unos pocos triángulos por luminaria.
 *
 * Las de las aulas con interruptor se apagan con la luz del aula
 * (`setRoom`, lo llama `SchoolIdentity.setRoomLights`).
 */
export interface LightPoolsHandle {
  mesh: Mesh;
  /** Enciende o apaga los pozos de un ambiente. */
  setRoom(room: string, on: boolean): void;
  dispose(): void;
}

/** Ambientes de luz cálida (2700 K): los de estar, no los de clase. */
const WARM_ROOMS = /^(hall|buffet|comedor|recepcion|jardin|sala[A-Z]|salaAmarilla|sum|espacioMusica|torreHall|galeria|salon)/;

/** Intensidad (fracción sumada en gamma) del centro del pozo, por tipo de luminaria. */
const POOL_GAIN: Record<LampFixture['kind'], number> = {
  tube: 0.085,
  panel: 0.085,
  dome: 0.12,
  pendant: 0.13,
  gym: 0,
};

const WARM = new Color3(1.0, 0.82, 0.6);
const COOL = new Color3(0.86, 0.92, 1.0);

export function createLightPools(scene: Scene, frame: SchoolFrame, fixtures: readonly LampFixture[]): LightPoolsHandle {
  const pos: number[] = [];
  const uvs: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  /** Color de cada vértice encendido, para volver a prenderlo. */
  const lit: number[] = [];
  /** Vértices de cada ambiente. */
  const byRoom = new Map<string, number[]>();

  const quad = (corners: Array<[number, number, number]>, u0: number, u1: number, c: Color3, k: number, room: string | null): void => {
    const base = pos.length / 3;
    const uv = [
      [u0, 0],
      [u1, 0],
      [u1, 1],
      [u0, 1],
    ];
    corners.forEach((p, i) => {
      pos.push(p[0], p[1], p[2]);
      uvs.push(uv[i][0], uv[i][1]);
      cols.push(c.r * k, c.g * k, c.b * k, 1);
      lit.push(c.r * k, c.g * k, c.b * k, 1);
      if (room) {
        let list = byRoom.get(room);
        if (!list) byRoom.set(room, (list = []));
        list.push(base + i);
      }
    });
    // Se ve de los dos lados (material sin descarte de caras).
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (const f of fixtures) {
    const gain = POOL_GAIN[f.kind];
    if (!gain || !f.room) continue;
    const c = WARM_ROOMS.test(f.room) ? WARM : COOL;
    const h = Math.max(1.2, f.y - f.floor);
    // Óvalo del piso: la huella de la luminaria más el cono (≈ 0,45 h).
    const hx = f.sx / 2 + 0.42 * h;
    const hz = f.sz / 2 + 0.42 * h;
    const y = f.floor + 0.008;
    quad(
      [
        [f.x - hx, y, f.z - hz],
        [f.x + hx, y, f.z - hz],
        [f.x + hx, y, f.z + hz],
        [f.x - hx, y, f.z + hz],
      ],
      0,
      0.5,
      c,
      gain,
      f.room,
    );
    wallSplash(frame, f, (corners) => quad(corners, 0.5, 1, c, gain * 0.9, f.room));
  }

  const mesh = new Mesh('schoolLightPools', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.uvs = uvs;
  vd.colors = cols;
  vd.indices = idx;
  vd.applyToMesh(mesh, true);
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();

  // Mitad izquierda: disco blando (piso). Mitad derecha: la vieira del muro,
  // brillante arriba (junto a la luminaria) y abierta hacia abajo.
  const tex = new DynamicTexture('schoolLightPoolTex', { width: 256, height: 128 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 128);
  const disc = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  disc.addColorStop(0, 'rgba(255,255,255,1)');
  disc.addColorStop(0.35, 'rgba(255,255,255,0.62)');
  disc.addColorStop(0.7, 'rgba(255,255,255,0.18)');
  disc.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = disc;
  ctx.fillRect(0, 0, 128, 128);
  // Vieira: elipse alta cuyo centro está arriba; con invertY la fila 0 del
  // canvas es v = 1 (arriba del quad).
  ctx.save();
  ctx.translate(192, 6);
  ctx.scale(1, 2.1);
  const sc = ctx.createRadialGradient(0, 0, 0, 0, 0, 58);
  sc.addColorStop(0, 'rgba(255,255,255,1)');
  sc.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  sc.addColorStop(0.75, 'rgba(255,255,255,0.12)');
  sc.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sc;
  ctx.fillRect(-64, -6, 128, 64);
  ctx.restore();
  tex.update(true);
  tex.wrapU = tex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;

  const mat = new StandardMaterial('schoolLightPool', scene);
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveTexture = tex;
  mat.emissiveColor = Color3.White();
  mat.alpha = 0.999;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.zOffset = -2;
  mat.fogEnabled = false;
  mesh.material = mat;

  return {
    mesh,
    setRoom(room: string, on: boolean): void {
      const list = byRoom.get(room);
      if (!list) return;
      for (const v of list) for (let k = 0; k < 3; k++) cols[v * 4 + k] = on ? lit[v * 4 + k] : 0;
      mesh.updateVerticesData(VertexBuffer.ColorKind, cols);
    },
    dispose(): void {
      mesh.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

/**
 * Vieira de luz en el muro más cercano a una luminaria (a menos de 0,9 m y
 * sin vano en ese tramo): un quad vertical sobre la cara del muro, de ancho
 * ≈ la altura del cielorraso a la mitad, que nace a la altura de la
 * luminaria y se abre hacia el piso.
 */
function wallSplash(frame: SchoolFrame, f: LampFixture, emit: (corners: Array<[number, number, number]>) => void): void {
  // Mundo → local del plano: x = ox − u, z = oz + v.
  const u = frame.ox - f.x;
  const v = f.z - frame.oz;
  // Nivel de la luminaria: el de la cota de piso más cercana.
  let level = 0;
  LEVEL_Y.forEach((y, k) => {
    if (Math.abs(y - f.floor) < Math.abs(LEVEL_Y[level] - f.floor)) level = k;
  });
  let best: { d: number; px: number; pv: number; nu: number; nv: number; t: number; len: number; wall: (typeof WALLS)[number] } | null = null;
  for (const w of WALLS) {
    if (w.level !== level) continue;
    const du = w.b[0] - w.a[0];
    const dv = w.b[1] - w.a[1];
    const len = Math.hypot(du, dv);
    if (len < 1.2) continue;
    const t = ((u - w.a[0]) * du + (v - w.a[1]) * dv) / (len * len);
    if (t < 0 || t > 1) continue;
    const px = w.a[0] + du * t;
    const pv = w.a[1] + dv * t;
    const d = Math.hypot(u - px, v - pv);
    if (d > 0.9 || (best && d >= best.d)) continue;
    best = { d, px, pv, nu: (u - px) / Math.max(d, 1e-6), nv: (v - pv) / Math.max(d, 1e-6), t: t * len, len, wall: w };
  }
  if (!best || best.d < 0.15) return;
  const half = 0.75;
  // Sin vanos en el tramo iluminado (ni cerca de las puntas del muro).
  if (best.t < half || best.t > best.len - half) return;
  for (const o of best.wall.openings) if (o.t1 > best.t - half - 0.1 && o.t0 < best.t + half + 0.1) return;
  const off = SCHOOL.wallT / 2 + 0.012;
  const cu = best.px + best.nu * off;
  const cv = best.pv + best.nv * off;
  // Tangente del muro en local y su paso a mundo (x = −u).
  const tu = -best.nv;
  const tv = best.nu;
  const top = f.y - 0.05;
  const bot = Math.max(f.floor + 0.05, top - 2.2);
  const P = (s: number, y: number): [number, number, number] => [frame.ox - (cu + tu * s), y, frame.oz + (cv + tv * s)];
  emit([P(-half, bot), P(half, bot), P(half, top), P(-half, top)]);
}
