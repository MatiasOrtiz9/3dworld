import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { CityPlan } from '../CityLayout';
import type { StreetLevel } from './StreetLevel';
import { Rng } from '../../utils/rng';

const hex = (h: string) => Color3.FromHexString(h);
const WARN = { text: 'ACCESO RESTRINGIDO', bg: '#c8261e', fg: '#ffffff', rule: '#ffffff' };
const DANGER = { text: 'PELIGRO - OBRA EN CONSTRUCCION', bg: '#f2c01e', fg: '#1b1b1b', rule: '#1b1b1b' };

/**
 * El borde del mapa como obra en curso (ver `Periphery` en `CityLayout`).
 * Todo va a la granja con materiales cacheados y los carteles al `SignAtlas`
 * del barrio: unos pocos draw calls más y ningún costo por cuadro. Usa su
 * propio generador (no corre el azar compartido, HANDOFF 42/82), así que
 * escritorio y visor arman la misma periferia.
 */
export class PeripheryBuilder {
  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly street: StreetLevel,
  ) {}

  build(plan: CityPlan): void {
    const pe = plan.periphery;
    const rng = new Rng((plan.seed ^ 0x51e7e) >>> 0);
    const panel = this.mats.surface(hex('#dfe3e1'), 0.7, 0.1, null);
    const green = this.mats.surface(hex('#2f6b4f'), 0.7, 0.1, null);
    const post = this.mats.surface(hex('#5b6066'), 0.5, 0.3, null);
    const orange = this.mats.surface(hex('#e8641c'), 0.6, 0, null);
    const white = this.mats.surface(hex('#f2f2ee'), 0.6, 0, null);
    const yellow = this.mats.surface(hex('#e9b81c'), 0.55, 0.2, null);
    const concrete = this.mats.surface(hex('#a9a69e'), 0.9, 0, 'concrete');
    const H = 2.6;
    // Cada lado con su normal hacia el barrio: los carteles miran a la calle.
    const sides = [
      { side: 'zn', fixed: pe.z0, a: pe.x0, b: pe.x1, axis: 'x', n: 1 },
      { side: 'zp', fixed: pe.z1, a: pe.x0, b: pe.x1, axis: 'x', n: -1 },
      { side: 'xn', fixed: pe.x0, a: pe.z0, b: pe.z1, axis: 'z', n: 1 },
      { side: 'xp', fixed: pe.x1, a: pe.z0, b: pe.z1, axis: 'z', n: -1 },
    ] as const;
    for (const s of sides) {
      const at = (t: number, off = 0) =>
        s.axis === 'x' ? new Vector3(t, 0, s.fixed + s.n * off) : new Vector3(s.fixed + s.n * off, 0, t);
      const nx = s.axis === 'z' ? s.n : 0;
      const nz = s.axis === 'x' ? s.n : 0;
      const gate = pe.gates.find((g) => g.side === s.side)?.at ?? 1e9;
      const len = s.b - s.a;
      const n = Math.round(len / 3);
      const step = len / n;
      for (let i = 0; i < n; i++) {
        const t = s.a + (i + 0.5) * step;
        const p = at(t);
        const inGate = Math.abs(t - gate) < 4;
        // Portón: chapa verde y más alta (sigue cerrado: la colisión es la línea entera).
        const h = inGate ? H + 0.4 : H;
        const size = s.axis === 'x' ? new Vector3(step - 0.08, h, 0.05) : new Vector3(0.05, h, step - 0.08);
        this.farm.add('box', inGate ? green : panel, new Vector3(p.x, h / 2, p.z), size);
        if (!inGate) {
          // Zócalo verde: la franja típica del cerco de obra porteño.
          const zs = s.axis === 'x' ? new Vector3(step, 0.5, 0.07) : new Vector3(0.07, 0.5, step);
          this.farm.add('box', green, new Vector3(p.x, 0.25, p.z), zs);
        }
        const q = at(s.a + i * step);
        this.farm.add('post', post, new Vector3(q.x, H / 2 + 0.1, q.z), new Vector3(0.1, H + 0.2, 0.1));
        if (!inGate && i % 5 === 2) {
          const c = at(t, 0.04);
          this.street.signs.plate(i % 10 === 2 ? WARN : DANGER, c.x, 1.6, c.z, 2.4, 0.42, nx, nz);
        }
      }
      if (gate < 1e8) {
        // Barrera a franjas y cartel sobre el portón.
        const g = at(gate, 0.8);
        const bs = s.axis === 'x' ? new Vector3(6, 0.22, 0.12) : new Vector3(0.12, 0.22, 6);
        this.farm.add('box', orange, new Vector3(g.x, 0.85, g.z), bs);
        this.farm.add('box', white, new Vector3(g.x, 0.55, g.z), bs);
        for (const k of [-3, 3]) {
          const f = at(gate + k, 0.8);
          this.farm.add('post', post, new Vector3(f.x, 0.5, f.z), new Vector3(0.1, 1, 0.1));
        }
        const sg = at(gate, 0.06);
        this.street.signs.plate(WARN, sg.x, 2.4, sg.z, 2.6, 0.46, nx, nz);
      }
      // Conos sueltos sobre la vereda exterior, pegados al cerco.
      for (let t = s.a + 12; t < s.b - 12; t += rng.range(14, 26)) {
        const c = at(t, rng.range(0.6, 1.1));
        this.cone(orange, white, c.x, c.z);
      }
    }

    // Edificios en obra: losas y columnas, núcleo macizo y andamio con media sombra.
    for (const site of pe.sites) {
      const fh = 3.2;
      for (let f = 0; f <= site.floors; f++) {
        this.farm.add('box', concrete, new Vector3(site.x, f * fh + 0.12, site.z), new Vector3(site.w, 0.24, site.d));
      }
      const top = site.floors * fh;
      const cx = Math.round(site.w / 5);
      const cz = Math.round(site.d / 5);
      for (let i = 0; i <= cx; i++) {
        for (let j = 0; j <= cz; j++) {
          const x = site.x - site.w / 2 + 0.3 + (i / cx) * (site.w - 0.6);
          const z = site.z - site.d / 2 + 0.3 + (j / cz) * (site.d - 0.6);
          this.farm.add('box', concrete, new Vector3(x, top / 2, z), new Vector3(0.4, top, 0.4));
        }
      }
      this.farm.add('box', concrete, new Vector3(site.x, (top + fh) / 2, site.z), new Vector3(4, top + fh, 4));
      const toward = site.z < 0 ? 1 : -1;
      const face = site.z + toward * (site.d / 2 + 1);
      for (let x = -site.w / 2; x <= site.w / 2 + 0.01; x += 2.5) {
        this.farm.add('post', yellow, new Vector3(site.x + x, top / 2, face), new Vector3(0.06, top, 0.06));
      }
      for (let f = 1; f <= site.floors; f++) {
        this.farm.add('box', yellow, new Vector3(site.x, f * fh, face), new Vector3(site.w, 0.06, 0.9));
        this.farm.add('box', green, new Vector3(site.x, f * fh - 1, face + toward * 0.5), new Vector3(site.w, 1.4, 0.03));
      }
    }

    // Grúa torre: base, mástil, pluma, contrapeso, cabina y cable.
    const cr = pe.crane;
    const ux = Math.cos(cr.rot);
    const uz = -Math.sin(cr.rot);
    this.farm.add('box', concrete, new Vector3(cr.x, 0.5, cr.z), new Vector3(4, 1, 4));
    this.farm.add('box', yellow, new Vector3(cr.x, cr.h / 2, cr.z), new Vector3(1.6, cr.h, 1.6));
    this.farm.add('box', yellow, new Vector3(cr.x + ux * 14, cr.h + 0.6, cr.z + uz * 14), new Vector3(40, 1.1, 1.1), cr.rot);
    this.farm.add('box', concrete, new Vector3(cr.x - ux * 5, cr.h, cr.z - uz * 5), new Vector3(3, 2, 2), cr.rot);
    this.farm.add('box', post, new Vector3(cr.x, cr.h + 1.8, cr.z), new Vector3(2.2, 2.4, 2.2), cr.rot);
    this.farm.add('box', post, new Vector3(cr.x + ux * 24, cr.h - 6, cr.z + uz * 24), new Vector3(0.05, 12, 0.05));

    // Excavadora: orugas, cuerpo, cabina, brazo, balde y montículo de tierra.
    const ex = pe.excavator;
    const ax = Math.cos(ex.rot);
    const az = -Math.sin(ex.rot);
    for (const k of [-1, 1]) {
      this.farm.add('box', post, new Vector3(ex.x + az * k * 1.2, 0.45, ex.z - ax * k * 1.2), new Vector3(4.2, 0.9, 0.8), ex.rot);
    }
    this.farm.add('box', yellow, new Vector3(ex.x, 1.35, ex.z), new Vector3(3.2, 1.0, 2.6), ex.rot);
    this.farm.add('box', yellow, new Vector3(ex.x - ax * 0.4, 2.4, ex.z - az * 0.4), new Vector3(1.4, 1.2, 1.4), ex.rot);
    this.farm.add('box', yellow, new Vector3(ex.x + ax * 2.8, 2.7, ex.z + az * 2.8), new Vector3(4, 0.45, 0.45), ex.rot, 0, 0.45);
    this.farm.add('box', yellow, new Vector3(ex.x + ax * 5, 1.6, ex.z + az * 5), new Vector3(0.4, 2.4, 0.4), ex.rot);
    this.farm.add('box', post, new Vector3(ex.x + ax * 5.3, 0.4, ex.z + az * 5.3), new Vector3(1, 0.8, 1.2), ex.rot);
    this.farm.add('sphere', this.mats.surface(hex('#7a6248'), 0.95, 0, null), new Vector3(ex.x + ax * 8, 0, ex.z + az * 8), new Vector3(6, 3, 5));
  }

  private cone(orange: Material, white: Material, x: number, z: number): void {
    this.farm.add('cone', orange, new Vector3(x, 0.4, z), new Vector3(0.36, 0.7, 0.36));
    this.farm.add('cylinder', white, new Vector3(x, 0.45, z), new Vector3(0.26, 0.1, 0.26));
    this.farm.add('box', orange, new Vector3(x, 0.03, z), new Vector3(0.4, 0.06, 0.4));
  }
}
