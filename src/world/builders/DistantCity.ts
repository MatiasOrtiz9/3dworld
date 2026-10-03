import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { BackdropMass, CityPlan } from '../CityLayout';
import { SIDEWALK_H } from '../CityLayout';
import type { TintFarm } from './TintFarm';
import { Rng } from '../../utils/rng';

type Rgb = readonly [number, number, number];

/**
 * Tonos de frente de un barrio porteño: revoques claros, ladrillo, ocres y
 * grises de cemento. Bajos de saturación: de lejos la niebla los acerca al
 * cielo, y un color fuerte se despegaría como un error.
 */
const TONES: readonly Rgb[] = [
  [0.86, 0.82, 0.74],
  [0.92, 0.9, 0.86],
  [0.74, 0.72, 0.68],
  [0.7, 0.46, 0.36],
  [0.84, 0.72, 0.54],
  [0.87, 0.76, 0.72],
  [0.64, 0.65, 0.66],
  [0.8, 0.78, 0.63],
];
const GLASS: Rgb = [0.16, 0.2, 0.23];
const GLASS_SKY: Rgb = [0.34, 0.42, 0.5];
const SHOP: Rgb = [0.22, 0.2, 0.19];
/** Locales encendidos vistos de lejos: cálidos, alguno frío (farmacia, heladería). */
const SHOP_GLOW: readonly Rgb[] = [
  [0.82, 0.68, 0.46],
  [0.86, 0.78, 0.6],
  [0.72, 0.8, 0.82],
  [0.88, 0.62, 0.5],
];
/** Bandas de cartel de los locales de enfrente. */
const SIGN: readonly Rgb[] = [
  [0.7, 0.18, 0.15],
  [0.15, 0.4, 0.28],
  [0.92, 0.75, 0.2],
  [0.18, 0.3, 0.55],
  [0.95, 0.94, 0.9],
];
const SLAB: Rgb = [0.88, 0.87, 0.84];
/** Paleta de los murales de medianera: saturada, como la pintura de exterior. */
const MURAL: readonly Rgb[] = [
  [0.85, 0.3, 0.25],
  [0.95, 0.75, 0.2],
  [0.2, 0.55, 0.65],
  [0.35, 0.6, 0.3],
  [0.6, 0.3, 0.6],
  [0.95, 0.55, 0.35],
  [0.15, 0.3, 0.55],
];
/** Ventanas encendidas de noche: cálidas, alguna fría (pantallas, tubos). */
const NIGHT: readonly Rgb[] = [
  [0.98, 0.84, 0.55],
  [0.95, 0.75, 0.45],
  [0.85, 0.88, 0.95],
];

/**
 * La ciudad de fondo (ver `CityLayout.Backdrop`).
 *
 * Cada volumen es UNA caja más paños de dos triángulos: una faja de ventanas
 * por piso en la cara que mira al barrio (y en el costado si es esquina), la
 * planta baja oscura con algún local encendido, el canto de los balcones y,
 * en la capa cercana, el tanque de agua en la azotea. Las medianeras quedan
 * ciegas, como en cualquier cuadra de Buenos Aires con alturas desparejas.
 *
 * Todo va a la `TintFarm`: la ciudad de fondo entera cuesta los mismos draw
 * calls que el resto del detalle de color (ninguno propio) y ~12k triángulos.
 */
export class DistantCity {
  constructor(
    private readonly tint: TintFarm,
    private readonly full: boolean,
  ) {}

  build(plan: CityPlan): void {
    const rng = new Rng((plan.seed ^ 0x0d157a17) >>> 0);
    // Todas, también en el visor: con la niebla más fina (TimeOfDay.fogReach)
    // a 270–350 m queda un 50–77 % y un hueco en el perfil se notaba. Las
    // del fondo son una caja y dos o tres paños: ~600 triángulos en total.
    // Un azar por volumen: cuántos paños lleva cada uno depende del detalle
    // (la cara de atrás sólo en escritorio), y con un azar corrido el visor y
    // el escritorio encendían otros locales y pintaban otros murales (HANDOFF 42).
    plan.backdrop.masses.forEach((m, i) => this.mass(m, new Rng(((plan.seed ^ 0x0d157a17) + Math.imul(i + 1, 0x9e3779b1)) >>> 0)));
    this.murals(plan.backdrop.masses.filter((m) => m.layer === 1), rng);
    this.skyline(plan);
  }

  /**
   * Capa 3: el perfil de la ciudad entre 380 y 640 m, más allá de las torres
   * del fondo. Sólo cajas lisas de tonos pálidos (la niebla las deja en un
   * 80–97 %): sin ellas, con la niebla más fina, entre la ciudad de fondo y el
   * horizonte quedaba una franja de pasto vacío y el barrio parecía una isla.
   * Unas cien cajas: ~1.200 triángulos y ningún draw call propio. Azar propio
   * (escritorio y visor levantan el mismo perfil).
   */
  private skyline(plan: CityPlan): void {
    const rng = new Rng((plan.seed ^ 0x5c71e3) >>> 0);
    const pitch = plan.blockSize + plan.streetWidth;
    // Centro del barrio (la escuela y su anexo), como el de la losa del suelo.
    const cx = -pitch / 2;
    const n = Math.ceil(660 / pitch);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const x = cx + i * pitch + rng.range(-12, 12);
        const z = j * pitch + rng.range(-12, 12);
        const r = Math.hypot(x - cx, z);
        const keep = rng.chance(0.42);
        const tower = rng.chance(0.22);
        const w = rng.range(18, 42);
        const d = rng.range(16, 36);
        const hRaw = tower ? rng.range(34, 58) : rng.range(9, 30);
        const tone = TONES[rng.int(0, TONES.length - 1)];
        if (!keep || r < 380 || r > 640) continue;
        // Al norte (detrás del portal visto desde Laprida), baja.
        const h = z < -150 ? Math.min(hRaw, 24) : hRaw;
        // Un poco más azul y más oscura que la fachada cercana: de lejos el
        // revoque toma el color del aire y la silueta se despega del cielo.
        const c: Rgb = [tone[0] * 0.82, tone[1] * 0.85, tone[2] * 0.9];
        if (this.full) this.tint.boxOn('lit', c, x, z, w, h, d, 0);
        else {
          // En el visor, sólo las dos caras que miran al barrio (4 triángulos
          // en vez de 12): a 380–640 m y en niebla es una silueta, y desde
          // adentro del barrio nunca se ve ni el techo ni la cara de atrás.
          // Compensa lo que suman las fachadas cercanas y las sillas de café.
          const sx = x > cx ? -1 : 1;
          const sz = z > 0 ? -1 : 1;
          this.tint.panel('lit', c, x + (sx * w) / 2, h / 2, z, d, h, sx, 0);
          this.tint.panel('lit', c, x, h / 2, z + (sz * d) / 2, w, h, 0, sz);
        }
        // De noche, algún piso encendido en la cara que mira al barrio.
        if (h > 20 && rng.chance(0.5)) {
          const fx = Math.abs(x - cx) > Math.abs(z) ? -Math.sign(x - cx) : 0;
          const fz = fx === 0 ? -Math.sign(z) : 0;
          const off = (fx !== 0 ? w : d) / 2 + 0.05;
          this.tint.panel('night', rng.pick(NIGHT), x + fx * off, h * rng.range(0.3, 0.8), z + fz * off, (fx !== 0 ? d : w) * 0.6, 2.2, fx, fz);
        }
      }
    }
  }

  /**
   * Murales en las medianeras: donde un edificio le saca más de dos pisos al
   * vecino queda un muro ciego, y en Buenos Aires esos muros se pintan. Un
   * par de paños de color (dos triángulos cada uno) alcanzan para leerlo.
   */
  private murals(near: BackdropMass[], rng: Rng): void {
    for (const m of near) {
      const alongX = m.nz !== 0;
      for (const o of near) {
        if (o === m || o.nx !== m.nx || o.nz !== m.nz) continue;
        // Vecino de lote en la misma tira, pegado a un costado.
        const gap = alongX ? Math.abs(o.x - m.x) - (o.w + m.w) / 2 : Math.abs(o.z - m.z) - (o.d + m.d) / 2;
        const same = alongX ? Math.abs(o.z - m.z) < 0.5 : Math.abs(o.x - m.x) < 0.5;
        if (!same || gap > 0.2 || m.h - o.h < 6.5 || !rng.chance(0.45)) continue;
        const side = alongX ? Math.sign(o.x - m.x) : Math.sign(o.z - m.z);
        const nx = alongX ? side : 0;
        const nz = alongX ? 0 : side;
        const depth = alongX ? m.d : m.w;
        const x = alongX ? m.x + side * (m.w / 2 + 0.03) : m.x;
        const z = alongX ? m.z : m.z + side * (m.d / 2 + 0.03);
        const y0 = o.h + 1;
        const h = Math.min(m.h - y0 - 1, 12);
        if (h < 3) continue;
        const w = depth * 0.8;
        const [a, b, c] = [rng.pick(MURAL), rng.pick(MURAL), rng.pick(MURAL)];
        this.tint.panel('lit', a, x, y0 + h / 2, z, w, h, nx, nz);
        // Una figura simple encima del fondo: un círculo de sol hecho de dos
        // paños cruzados y una franja, en otros colores.
        this.tint.panel('lit', b, x + nx * 0.02, y0 + h * 0.62, z + nz * 0.02, w * 0.45, h * 0.45, nx, nz);
        this.tint.panel('lit', c, x + nx * 0.03, y0 + h * 0.2, z + nz * 0.03, w * 0.9, h * 0.14, nx, nz);
      }
    }
  }

  private mass(m: BackdropMass, rng: Rng): void {
    const t = this.tint;
    const near = m.layer === 1;
    const base = near ? SIDEWALK_H : 0;
    const tone = TONES[m.tone % TONES.length];
    t.boxOn('lit', tone, m.x, m.z, m.w, m.h - base, m.d, base);

    // Caras con ventanas: la del frente y, en las esquinas, la del costado.
    const faces: Array<[number, number]> = [[m.nx, m.nz]];
    if (m.sx !== 0 || m.sz !== 0) faces.push([m.sx, m.sz]);
    // Del lado de afuera también (lo ve quien camina por la calle exterior o
    // vuela): en la capa cercana, la cara opuesta al frente.
    if (near && this.full) faces.push([-m.nx, -m.nz]);

    const glassFloors = near ? 1 : this.full ? 1 : 3;
    for (const [nx, nz] of faces) {
      const span = nx !== 0 ? m.d : m.w;
      const off = (nx !== 0 ? m.w : m.d) / 2 + 0.03;
      const cx = m.x + nx * off;
      const cz = m.z + nz * off;
      const front = nx === m.nx && nz === m.nz;
      const at = (along: number): [number, number] => [cx + (nx !== 0 ? 0 : along), cz + (nx !== 0 ? along : 0)];
      if (near && front) {
        // Planta baja: vidrieras oscuras y, casi siempre, los locales
        // encendidos con la banda de su cartel. Es lo que queda a 8–10 m de
        // quien camina la vereda exterior: con uno solo encendido, la planta
        // baja entera era una franja negra de punta a punta.
        t.panel('lit', SHOP, cx, base + 1.7, cz, span * 0.92, 2.8, nx, nz);
        const shops = span > 13 ? 3 : span > 7 ? 2 : 1;
        // Cada local en su tramo, con un corrido que nunca lo monta sobre el
        // vecino (dos paños en el mismo plano titilarían).
        const bay = (span * 0.84) / shops;
        const w = Math.min(3.6, bay * 0.72);
        for (let k = 0; k < shops; k++) {
          if (!rng.chance(0.85)) continue;
          const along = ((k + 0.5) / shops - 0.5) * span * 0.84 + rng.range(-1, 1) * Math.min(0.8, (bay - w) * 0.4);
          const [sx, sz] = at(along);
          t.panel('glow', rng.pick(SHOP_GLOW), sx + nx * 0.01, base + 1.55, sz + nz * 0.01, w, 2.1, nx, nz);
          t.panel('lit', rng.pick(SIGN), sx + nx * 0.02, base + 3.0, sz + nz * 0.02, w, 0.5, nx, nz);
        }
      }
      // Ventanas piso por piso (de a dos pisos en el horizonte). En la capa
      // cercana, de a dos paños con un pilar al medio: una faja corrida de
      // punta a punta se leía como un galpón, no como un edificio de departamentos.
      // También en el visor, en la cara al barrio y en los tres primeros
      // pisos: es lo que se tiene a 8–10 m desde la vereda de enfrente sin
      // levantar la vista. Más arriba sigue la faja corrida (se ve de lejos y
      // se lee como el cuerpo alto sobre un basamento): son 4 triángulos por
      // piso y la capa cercana tiene 155 volúmenes, que cuentan en cada vista.
      const fine = (f: number) => this.full || (front && f <= 3);
      for (let f = 1; f < m.floors; f += glassFloors) {
        const split = near && span > 7 && fine(f) ? 2 : 1;
        const y = 4 + (f - 1) * 3 + 1.25 + (glassFloors - 1) * 1.5;
        if (f + glassFloors - 1 >= m.floors && glassFloors > 1) break;
        const h = glassFloors === 1 ? 1.45 : glassFloors * 3 - 1.6;
        // Los pisos altos reflejan más cielo: el degradé que delata el vidrio.
        const c: Rgb = f > m.floors * 0.6 && !near ? GLASS_SKY : GLASS;
        for (let k = 0; k < split; k++) {
          const along = split === 1 ? 0 : (k - 0.5) * span * 0.46;
          const [wx, wz] = at(along);
          const ww = (span * 0.8) / split - (split > 1 ? 0.4 : 0);
          t.panel('lit', c, wx, y, wz, ww, h, nx, nz);
          // De noche, algunas ventanas encendidas: la ciudad de fondo no
          // desaparece en la oscuridad, se llena de puntos de luz.
          if (rng.chance(0.38)) {
            const lw = ww * rng.range(0.2, 0.5);
            const [lx, lz] = at(along + rng.range(-(ww - lw) / 2, (ww - lw) / 2));
            t.panel('night', rng.pick(NIGHT), lx + nx * 0.01, y, lz + nz * 0.01, lw, h * 0.8, nx, nz);
          }
        }
        // Canto de losa / balcón corrido bajo cada piso de la cara al barrio.
        // En el visor también: sin el canto, la cara se leía como cartón.
        if (near && front && fine(f)) t.panel('lit', SLAB, cx + nx * 0.01, y - 1.0, cz + nz * 0.01, span * 0.96, 0.18, nx, nz);
      }
    }

    // Azotea: tanque de agua sobre su base, o la sala de máquinas de la torre.
    if (near && rng.chance(0.55) && this.full) {
      const r = rng.range(0.6, 0.9);
      const tx = m.x + rng.range(-m.w * 0.25, m.w * 0.25);
      const tz = m.z + rng.range(-m.d * 0.25, m.d * 0.25);
      t.add('cylinder', 'lit', rng.chance(0.5) ? [0.14, 0.14, 0.15] : [0.75, 0.7, 0.6], new Vector3(tx, m.h + 0.95, tz), new Vector3(r * 2, 1.9, r * 2));
    } else if (!near && m.floors > 10) {
      t.boxOn('lit', TONES[(m.tone + 2) % TONES.length], m.x, m.z, m.w * 0.4, 3.2, m.d * 0.4, m.h);
    }
  }
}
