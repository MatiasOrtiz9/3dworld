import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { CityPlan } from '../CityLayout';
import type { StreetLevel } from './StreetLevel';
import { Rng } from '../../utils/rng';

const hex = (h: string) => Color3.FromHexString(h);
const sign = (text: string, bg: string, fg: string) => ({ text, bg, fg, rule: fg });
const SIGNS = [
  sign('ACCESO RESTRINGIDO', '#c8261e', '#ffffff'),
  sign('PELIGRO OBRA', '#f2c01e', '#1b1b1b'),
  sign('USO OBLIGATORIO DE CASCO', '#1d5fa8', '#ffffff'),
  sign('PROHIBIDO EL PASO', '#c8261e', '#ffffff'),
];
const OBRA = sign('OBRA', '#f2c01e', '#1b1b1b');
const BRAND = sign('CONSTRUCTORA SUR - NUEVAS VIVIENDAS 2050', '#183b5c', '#f2c01e');
const FH = 3.2;
const STAGES = ['pit', 'frame', 'infill', 'scaffold'] as const;

type Stage = (typeof STAGES)[number];
/** Obra detrás del cerco; (tx, tz) es la normal hacia el barrio. */
interface Site {
  x: number;
  z: number;
  w: number;
  d: number;
  floors: number;
  stage: Stage;
  tx: number;
  tz: number;
}

/**
 * El borde del mapa como obra en curso (ver `Periphery` en `CityLayout`).
 * Todo va a la granja con materiales cacheados y los carteles al `SignAtlas`
 * del barrio: unos pocos draw calls más y ningún costo por cuadro. Usa su
 * propio generador (no corre el azar compartido, HANDOFF 42/82), así que
 * escritorio y visor arman la misma periferia. La colisión es la línea entera
 * del cerco (`CityIndex.outsideFence`): lo de afuera es sólo decorado.
 */
export class PeripheryBuilder {
  private readonly m: Record<string, Material>;

  constructor(
    private readonly farm: InstanceFarm,
    mats: Materials,
    private readonly street: StreetLevel,
  ) {
    const s = (h: string, r = 0.7, met = 0, tex: 'concrete' | null = null) => mats.surface(hex(h), r, met, tex);
    this.m = {
      panel: s('#dfe3e1'),
      green: s('#2f6b4f'),
      post: s('#5b6066', 0.5, 0.3),
      orange: s('#e8641c', 0.6),
      white: s('#f2f2ee', 0.6),
      yellow: s('#e9b81c', 0.55, 0.2),
      concrete: s('#a9a69e', 0.9, 0, 'concrete'),
      navy: s('#183b5c', 0.6),
      mesh: s('#1f4a36', 0.95),
      brick: s('#a4553a', 0.9),
      dirt: s('#7a6248', 0.95),
      sand: s('#c9b27a', 0.95),
      gravel: s('#8d8a84', 0.95),
      wood: s('#9a7a4e', 0.85),
      red: s('#c8261e', 0.6),
      glass: s('#2c3a44', 0.2, 0.4),
      blue: s('#2a6fb0', 0.6, 0.2),
      lamp: s('#fff6c8', 0.3),
    };
  }

  private box(mat: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot = 0): void {
    this.farm.add('box', this.m[mat], new Vector3(x, y, z), new Vector3(sx, sy, sz), rot);
  }

  build(plan: CityPlan): void {
    const pe = plan.periphery;
    const rng = new Rng((plan.seed ^ 0x51e7e) >>> 0);
    const H = 2.6;
    const sides = [
      { side: 'zn', fixed: pe.z0, a: pe.x0, b: pe.x1, axis: 'x', n: 1 },
      { side: 'zp', fixed: pe.z1, a: pe.x0, b: pe.x1, axis: 'x', n: -1 },
      { side: 'xn', fixed: pe.x0, a: pe.z0, b: pe.z1, axis: 'z', n: 1 },
      { side: 'xp', fixed: pe.x1, a: pe.z0, b: pe.z1, axis: 'z', n: -1 },
    ] as const;
    const sites: Site[] = pe.sites.map((s, i) => ({ ...s, stage: i === 0 ? 'infill' : 'scaffold', tx: 0, tz: s.z < 0 ? 1 : -1 }));
    for (const s of sides) {
      // `off` > 0 hacia el barrio, < 0 hacia la obra.
      const at = (t: number, off = 0) =>
        s.axis === 'x' ? new Vector3(t, 0, s.fixed + s.n * off) : new Vector3(s.fixed + s.n * off, 0, t);
      const rot = s.axis === 'x' ? 0 : Math.PI / 2;
      const nx = s.axis === 'z' ? s.n : 0;
      const nz = s.axis === 'x' ? s.n : 0;
      const gate = pe.gates.find((g) => g.side === s.side)?.at ?? 1e9;
      const len = s.b - s.a;
      const n = Math.round(len / 3);
      const step = len / n;
      // Tramos de cerco: chapa impresa, chapa lisa con escalones o malla con media sombra.
      let kind = 0;
      let run = 0;
      for (let i = 0; i < n; i++) {
        const t = s.a + (i + 0.5) * step;
        const p = at(t);
        const q = at(s.a + i * step);
        if (Math.abs(t - gate) < 4) {
          // Portón corredizo: hoja verde sobre riel.
          this.box('green', p.x, (H + 0.4) / 2 + 0.08, p.z, step - 0.04, H + 0.4, 0.06, rot);
          this.box('post', p.x, 0.04, p.z, step, 0.08, 0.16, rot);
          this.box('post', q.x, H + 0.5, q.z, 0.12, 0.12, 0.12, rot);
          continue;
        }
        if (run-- <= 0) {
          kind = rng.int(0, 2);
          run = rng.int(3, 8);
        }
        const h = kind === 1 ? H + (i % 4 === 0 ? 0.3 : 0) + rng.range(-0.05, 0.05) : H;
        const lean = rng.range(-0.025, 0.025);
        if (kind === 2) {
          this.box('mesh', p.x, h / 2 + 0.3, p.z, step - 0.08, h - 0.4, 0.03, rot + lean);
          this.box('concrete', p.x, 0.15, p.z, step, 0.3, 0.3, rot);
        } else {
          this.box('panel', p.x, h / 2, p.z, step - 0.08, h, 0.05, rot + lean);
          // En el visor el cerco se ve siempre de lejos (a 60–120 m desde la
          // escuela): sin el zócalo verde ni el filete amarillo, que a esa
          // distancia ocupan uno o dos píxeles. Son ~5 mil triángulos que se
          // dibujaban en cada vista (la granja no recorta por distancia). El
          // azar del cerco es propio y no se toca: los tramos son los mismos.
          if (this.street.fullDetail) this.box('green', p.x, 0.25, p.z, step, 0.5, 0.07, rot);
          if (kind === 0) {
            // Banda impresa azul con filete amarillo: la gráfica de la constructora.
            const b = at(t, 0.035);
            this.box('navy', b.x, h - 0.45, b.z, step, 0.6, 0.02, rot);
            if (this.street.fullDetail) this.box('yellow', b.x, h - 0.82, b.z, step, 0.08, 0.02, rot);
          }
        }
        this.farm.add('post', this.m.post, new Vector3(q.x, H / 2 + 0.1, q.z), new Vector3(0.1, H + 0.2, 0.1));
        const c = at(t, 0.05);
        if (kind === 0 && i % 9 === 4) {
          this.street.signs.plate(BRAND, c.x, h - 0.45, c.z, Math.min(step * 2.6, 7.6), 0.42, nx, nz);
        } else if (i % 6 === 2) {
          this.street.signs.plate(SIGNS[(i / 6 + Math.round(s.fixed)) & 3], c.x, 1.45, c.z, 1.6, 0.5, nx, nz);
        }
      }
      if (gate < 1e8) this.gateArea(at, rot, gate, nx, nz);
      // Conos sueltos o apilados sobre la vereda, pegados al cerco.
      for (let t = s.a + 12; t < s.b - 12; t += rng.range(16, 30)) {
        if (Math.abs(t - gate) < 12) continue;
        const c = at(t, rng.range(0.6, 1.0));
        this.cone(c.x, c.z, rng.chance(0.3) ? rng.int(2, 4) : 1);
      }
      // Torres de iluminación detrás del cerco.
      for (let t = s.a + 30; t < s.b - 20; t += 55) {
        const f = at(t + rng.range(-6, 6), -3);
        this.floodlight(f.x, f.z, nx, nz);
      }
      // Obras de este lado (los planos traen dos sobre ±z; acá se suman las demás).
      for (const k of s.axis === 'x' ? [0.12, 0.88] : [0.25, 0.72]) {
        const tt = s.a + k * len;
        const probe = at(tt, -18);
        if (Math.abs(tt - gate) < 12 || sites.some((o) => Math.hypot(o.x - probe.x, o.z - probe.z) < 30)) continue;
        const depth = rng.range(12, 16);
        const w = rng.range(16, 24);
        const c = at(tt, -(depth / 2 + 9));
        sites.push({
          x: c.x,
          z: c.z,
          w: s.axis === 'x' ? w : depth,
          d: s.axis === 'x' ? depth : w,
          floors: rng.int(2, 7),
          stage: STAGES[rng.int(0, 3)],
          tx: nx,
          tz: nz,
        });
      }
      // Obrador: contenedores apilados, baño químico y acopios.
      const mid = s.a + len * 0.5;
      const ob = at(mid + (Math.abs(gate - mid) < 20 ? 24 : 0), -6);
      this.siteYard(ob.x, ob.z, rot + (s.n < 0 ? Math.PI : 0), rng);
    }
    for (const site of sites) this.site(site);
    this.corners(pe.x0, pe.x1, pe.z0, pe.z1);

    const cr = pe.crane;
    this.crane(cr.x, cr.z, cr.h, cr.rot);
    const s2 = sites[sites.length - 1];
    this.crane(s2.x - s2.tx * (s2.w / 2 + 6), s2.z - s2.tz * (s2.d / 2 + 6), rng.range(26, 32), rng.range(0, Math.PI * 2));
    const ex = pe.excavator;
    this.excavator(ex.x, ex.z, ex.rot);
    this.truck(ex.x - 9, ex.z + 4 * Math.sign(ex.z), ex.rot + 0.2, false);
    this.truck(sites[0].x - 20, sites[0].z - 2, 0.1, true);
  }

  private gateArea(at: (t: number, off?: number) => Vector3, rot: number, gate: number, nx: number, nz: number): void {
    const sg = at(gate, 0.07);
    this.street.signs.plate(OBRA, sg.x, 2.35, sg.z, 2.4, 0.6, nx, nz);
    const s2 = at(gate - 2.4, 0.07);
    this.street.signs.plate(SIGNS[2], s2.x, 1.5, s2.z, 1.5, 0.5, nx, nz);
    // Barreras New Jersey a cada lado del portón, con balizas.
    for (const k of [-1, 1]) {
      for (let j = 0; j < 2; j++) {
        const b = at(gate + k * (5 + j * 2.1), 0.7);
        this.box('concrete', b.x, 0.25, b.z, 2, 0.5, 0.6, rot);
        this.box('concrete', b.x, 0.62, b.z, 2, 0.3, 0.25, rot);
        this.box(j ? 'red' : 'white', b.x, 0.62, b.z, 0.6, 0.31, 0.27, rot);
        // Baliza de 16 cm: un icosaedro (20 triángulos) se ve igual que la esfera
        // UV (~400), y con el borde de la obra agrandado (escuela a tamaño
        // real) las balizas y faroles sumaban casi 5 mil triángulos por vista.
        if (j === 0) this.farm.add('blob', this.m.orange, new Vector3(b.x, 0.85, b.z), new Vector3(0.16, 0.18, 0.16));
      }
    }
    const cs = at(gate + 3.6, 1.2);
    this.cone(cs.x, cs.z, 3);
    // Casilla de vigilancia adentro, junto al portón.
    const g = at(gate + 6.5, -2);
    this.box('white', g.x, 1.25, g.z, 2, 2.5, 2, rot);
    this.box('glass', g.x, 1.6, g.z, 2.04, 0.8, 1.6, rot);
    this.box('post', g.x, 2.56, g.z, 2.3, 0.12, 2.3, rot);
  }

  private siteYard(x: number, z: number, rot: number, rng: Rng): void {
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const p = (u: number, v: number) => [x + u * c + v * sn, z - u * sn + v * c] as const;
    // Oficina de obra: dos contenedores abajo y uno arriba, con escalera.
    const [ax, az] = p(0, 0);
    const [bx, bz] = p(6.3, 0);
    const [tx, tz] = p(3.1, 0);
    this.box('white', ax, 1.3, az, 6, 2.6, 2.4, rot);
    this.box('blue', bx, 1.3, bz, 6, 2.6, 2.4, rot);
    this.box('white', tx, 3.9, tz, 6, 2.6, 2.4, rot);
    for (const [u, y] of [
      [0, 1.5],
      [6.3, 1.5],
      [3.1, 4.1],
    ]) {
      const [wx, wz] = p(u, 1.21);
      this.box('glass', wx, y, wz, 1.6, 0.8, 0.04, rot);
    }
    const [sx, sz] = p(-3.4, 0.6);
    this.box('post', sx, 1.3, sz, 0.8, 0.06, 1.2, rot);
    this.box('post', sx, 2.6, sz, 0.8, 0.06, 1.2, rot);
    // Baño químico.
    const [wx, wz] = p(10.5, 0.5);
    this.box('blue', wx, 1.15, wz, 1.2, 2.3, 1.2, rot);
    this.box('white', wx, 2.35, wz, 1.25, 0.1, 1.25, rot);
    // Pallets de ladrillo, atado de hierros, montañas de arena y piedra.
    for (let k = 0; k < 4; k++) {
      const [lx, lz] = p(-6 - k * 1.5, -4 + (k % 2) * 1.4);
      this.box('wood', lx, 0.07, lz, 1.2, 0.14, 1.0, rot);
      this.box('brick', lx, 0.6, lz, 1.1, 0.9, 0.95, rot);
    }
    for (let k = 0; k < 6; k++) {
      const [rx, rz] = p(4 + rng.range(-0.2, 0.2), -4.5 + k * 0.12);
      this.box('post', rx, 0.15 + (k % 3) * 0.08, rz, 8, 0.05, 0.05, rot);
    }
    const [mx, mz] = p(-4, -9);
    this.farm.add('sphere', this.m.sand, new Vector3(mx, 0, mz), new Vector3(5, 2.6, 4.4));
    const [gx, gz] = p(2.5, -9.5);
    this.farm.add('sphere', this.m.gravel, new Vector3(gx, 0, gz), new Vector3(4.2, 2, 3.8));
  }

  private site(s: Site): void {
    const { x, z, w, d, floors } = s;
    if (s.stage === 'pit') {
      // Excavación: talud de tierra alrededor, fondo removido y vallado naranja.
      this.box('dirt', x, 0.01, z, w, 0.04, d);
      for (const [ox, oz, sx, sz] of [
        [0, -d / 2, w + 2, 2],
        [0, d / 2, w + 2, 2],
        [-w / 2, 0, 2, d],
        [w / 2, 0, 2, d],
      ]) {
        this.box('dirt', x + ox, 0.4, z + oz, sx, 0.8, sz);
      }
      this.farm.add('sphere', this.m.dirt, new Vector3(x + w / 2 + 4, 0, z), new Vector3(7, 3.4, 6));
      for (let k = -w / 2; k <= w / 2; k += 2.5) {
        this.box('orange', x + k, 1.1, z - d / 2 - 1.6, 2.4, 0.14, 0.05);
        this.box('orange', x + k, 1.1, z + d / 2 + 1.6, 2.4, 0.14, 0.05);
      }
      return;
    }
    for (let f = 0; f <= floors; f++) this.box('concrete', x, f * FH + 0.12, z, w, 0.24, d);
    const top = floors * FH;
    const cx = Math.max(2, Math.round(w / 5));
    const cz = Math.max(2, Math.round(d / 5));
    for (let i = 0; i <= cx; i++) {
      const px = x - w / 2 + 0.3 + (i / cx) * (w - 0.6);
      for (let j = 0; j <= cz; j++) {
        this.box('concrete', px, top / 2, z - d / 2 + 0.3 + (j / cz) * (d - 0.6), 0.4, top, 0.4);
      }
      // Hierros en espera sobre las columnas de un borde.
      this.farm.add('post', this.m.post, new Vector3(px, top + 0.6, z - d / 2 + 0.3), new Vector3(0.08, 1.2, 0.08));
    }
    this.box('concrete', x, (top + FH) / 2, z, 4, top + FH, 4);
    if (s.stage === 'infill') {
      // Mampostería en los pisos bajos, con huecos de ventana; el siguiente a medio levantar.
      const done = Math.max(1, floors - 2);
      for (let f = 0; f < done; f++) {
        const y = f * FH + FH / 2;
        for (const sg of [-1, 1]) {
          this.box('brick', x, y, z + sg * (d / 2 - 0.15), w - 0.2, FH - 0.24, 0.2);
          this.box('glass', x, y + 0.2, z + sg * (d / 2 - 0.04), w * 0.6, 1.1, 0.02);
          this.box('brick', x + sg * (w / 2 - 0.15), y, z, 0.2, FH - 0.24, d - 0.2);
        }
      }
      this.box('brick', x - w / 4, done * FH + 0.7, z + d / 2 - 0.15, w / 2, 1.2, 0.2);
    }
    if (s.stage === 'scaffold' || s.stage === 'infill') {
      // Andamio con media sombra sobre la cara que mira al barrio.
      const alongX = s.tx === 0;
      const fw = alongX ? w : d;
      const face = alongX ? z + s.tz * (d / 2 + 1) : x + s.tx * (w / 2 + 1);
      const r = alongX ? 0 : Math.PI / 2;
      const P = (u: number) => (alongX ? [x + u, face] : [face, z + u]);
      for (let u = -fw / 2; u <= fw / 2 + 0.01; u += 2.5) {
        const [px, pz] = P(u);
        this.farm.add('post', this.m.yellow, new Vector3(px, top / 2, pz), new Vector3(0.06, top, 0.06));
      }
      const [mx, mz] = P(0);
      const ox = alongX ? 0 : s.tx * 0.5;
      const oz = alongX ? s.tz * 0.5 : 0;
      for (let f = 1; f <= floors; f++) {
        this.box('yellow', mx, f * FH, mz, fw, 0.06, 0.9, r);
        if (s.stage === 'scaffold' || f > floors - 2) this.box('mesh', mx + ox, f * FH - 1.1, mz + oz, fw, 2, 0.03, r);
      }
    }
  }

  private corners(x0: number, x1: number, z0: number, z1: number): void {
    for (const x of [x0, x1]) {
      for (const z of [z0, z1]) {
        // Pilar de esquina macizo con faja roja, baliza y torre de luz detrás.
        const ix = Math.sign(-x);
        const iz = Math.sign(-z);
        this.box('concrete', x, 1.6, z, 0.7, 3.2, 0.7);
        this.box('red', x, 3.0, z, 0.72, 0.2, 0.72);
        this.farm.add('blob', this.m.orange, new Vector3(x, 3.35, z), new Vector3(0.24, 0.3, 0.24));
        this.cone(x + ix * 1.3, z + iz * 1.3, 2);
        this.floodlight(x - ix * 3, z - iz * 3, ix, iz);
      }
    }
  }

  private floodlight(x: number, z: number, nx: number, nz: number): void {
    const r = Math.atan2(nx, nz) + Math.PI / 2;
    this.farm.add('post', this.m.post, new Vector3(x, 4.5, z), new Vector3(0.14, 9, 0.14));
    this.box('post', x, 9, z, 1.6, 0.08, 0.08, r);
    for (const k of [-0.5, 0.5]) this.box('lamp', x + Math.cos(r) * k, 9.3, z - Math.sin(r) * k, 0.5, 0.4, 0.18, r);
  }

  private crane(x: number, z: number, h: number, rot: number): void {
    const ux = Math.cos(rot);
    const uz = -Math.sin(rot);
    this.box('concrete', x, 0.5, z, 4, 1, 4);
    // Mástil reticulado: cuatro montantes y travesaños cada 3 m.
    for (const [ox, oz] of [
      [-0.7, -0.7],
      [0.7, -0.7],
      [-0.7, 0.7],
      [0.7, 0.7],
    ]) {
      this.farm.add('post', this.m.yellow, new Vector3(x + ox, h / 2, z + oz), new Vector3(0.18, h, 0.18));
    }
    for (let y = 3; y < h; y += 3) this.box('yellow', x, y, z, 1.5, 0.12, 1.5);
    this.box('yellow', x + ux * 14, h + 0.6, z + uz * 14, 40, 1.1, 1.1, rot);
    this.box('yellow', x, h + 3.2, z, 0.5, 4, 0.5);
    this.box('concrete', x - ux * 5, h, z - uz * 5, 3, 2, 2, rot);
    this.box('post', x, h + 1.8, z, 2.2, 2.4, 2.2, rot);
    this.box('glass', x + ux * 1.12, h + 1.9, z + uz * 1.12, 0.05, 1.2, 1.8, rot);
    this.box('post', x + ux * 24, h - 0.2, z + uz * 24, 1.2, 0.5, 1.4, rot);
    this.box('post', x + ux * 24, h - 7, z + uz * 24, 0.05, 13, 0.05);
    this.box('wood', x + ux * 24, h - 13.6, z + uz * 24, 1.6, 0.4, 1.2, rot);
    this.farm.add('sphere', this.m.red, new Vector3(x + ux * 33.5, h + 1.3, z + uz * 33.5), new Vector3(0.3, 0.3, 0.3));
  }

  private excavator(x: number, z: number, rot: number): void {
    const ax = Math.cos(rot);
    const az = -Math.sin(rot);
    for (const k of [-1, 1]) this.box('post', x + az * k * 1.2, 0.45, z - ax * k * 1.2, 4.2, 0.9, 0.8, rot);
    this.box('yellow', x, 1.35, z, 3.2, 1.0, 2.6, rot);
    this.box('yellow', x - ax * 0.4, 2.4, z - az * 0.4, 1.4, 1.2, 1.4, rot);
    this.box('glass', x - ax * 0.4 + az * 0.71, 2.5, z - az * 0.4 - ax * 0.71, 1.1, 0.8, 0.02, rot);
    this.farm.add('box', this.m.yellow, new Vector3(x + ax * 2.8, 2.7, z + az * 2.8), new Vector3(4, 0.45, 0.45), rot, 0, 0.45);
    this.box('yellow', x + ax * 5, 1.6, z + az * 5, 0.4, 2.4, 0.4, rot);
    this.box('post', x + ax * 5.3, 0.4, z + az * 5.3, 1, 0.8, 1.2, rot);
    this.farm.add('sphere', this.m.dirt, new Vector3(x + ax * 8, 0, z + az * 8), new Vector3(6, 3, 5));
  }

  /** Volcador cargado de piedra, o mixer con el trompo de hormigón. */
  private truck(x: number, z: number, rot: number, mixer: boolean): void {
    const ax = Math.cos(rot);
    const az = -Math.sin(rot);
    const P = (u: number) => new Vector3(x + ax * u, 0, z + az * u);
    for (const u of [-2.2, -0.8, 2.4]) {
      const p = P(u);
      for (const k of [-1, 1]) {
        this.farm.add('cylinder', this.m.post, new Vector3(p.x + az * k * 1.05, 0.5, p.z - ax * k * 1.05), new Vector3(1, 0.35, 1), rot, Math.PI / 2);
      }
    }
    const ch = P(0);
    this.box('post', ch.x, 0.9, ch.z, 6.8, 0.3, 2.2, rot);
    const cab = P(2.6);
    this.box(mixer ? 'white' : 'orange', cab.x, 1.9, cab.z, 1.6, 1.8, 2.3, rot);
    const ws = P(3.42);
    this.box('glass', ws.x, 2.3, ws.z, 0.04, 0.8, 2, rot);
    const bed = P(-1.2);
    if (mixer) {
      this.farm.add('cylinder', this.m.white, new Vector3(bed.x, 2.1, bed.z), new Vector3(1.9, 3.6, 1.9), rot, 0, Math.PI / 2 - 0.2);
      this.box('red', bed.x, 2.1, bed.z, 0.2, 1.95, 1.95, rot);
    } else {
      this.box('orange', bed.x, 1.65, bed.z, 4.2, 1.2, 2.3, rot);
      this.farm.add('sphere', this.m.gravel, new Vector3(bed.x, 2.2, bed.z), new Vector3(3.6, 0.8, 1.9));
    }
  }

  private cone(x: number, z: number, stack: number): void {
    for (let k = 0; k < stack; k++) {
      const y = k * 0.14;
      this.farm.add('cone', this.m.orange, new Vector3(x, 0.4 + y, z), new Vector3(0.36, 0.7, 0.36));
      this.farm.add('cylinder', this.m.white, new Vector3(x, 0.45 + y, z), new Vector3(0.26, 0.1, 0.26));
    }
    this.farm.add('box', this.m.orange, new Vector3(x, 0.03, z), new Vector3(0.4, 0.06, 0.4));
  }
}
