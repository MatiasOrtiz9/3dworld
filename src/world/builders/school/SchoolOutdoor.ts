import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CityPlan } from '../../CityLayout';
import { PALETTE } from '../../Palette';
import {
  AMPHI_INNER,
  AMPHI_PLATFORM,
  AMPHI_WEST,
  APEX,
  FRONT_PLANTERS,
  FURNITURE,
  LEVEL_Y,
  MC_COS,
  MEETING_POINT,
  SCHOOL,
  U,
  V,
  amphiRear,
  amphiStrips,
  fromPlan,
  miguelCaneU,
  planU,
  planV,
  rearV,
  roundChairAngles,
  toWorld,
  type Item,
  type ItemKind,
  type P,
} from '../../SchoolLayout';
import { faceDir, type SchoolKit } from './SchoolKit';
import type { SchoolItems } from './SchoolItems';

/**
 * Ítems de exterior, patio y gimnasio que dibuja `SchoolOutdoor` (el resto,
 * `SchoolItems`). `SchoolBuilder.build` reparte cada ítem del plano según
 * esta lista, sin cambiar el orden del plano.
 */
export const OUTDOOR_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'planter',
  'tree',
  'goal',
  'bleachers',
  'flagpole',
  'hoop',
  'palm',
  'amphi',
  'roundPlanter',
  'cafeTable',
  'boxBench',
  'pot',
  'bunting',
  'bareTree',
  'slimTree',
  'hedge',
  'solarTree',
]);

/** Clase de planta de `plants` (las tarjetas recortadas de `FoliageCards`). */
export type PlantClass = 'grass' | 'fern' | 'flower' | 'shrub';

/**
 * Exterior de la escuela: terreno, calle Miguel Cané y plazoleta, la franja
 * de frente (canteros, palmeras y árbol), la vegetación, los patios y el
 * equipamiento del gimnasio. Dibuja con el kit compartido (`SchoolKit`) y
 * usa las sillas de `SchoolItems` (mesas del patio).
 */
export class SchoolOutdoor {
  constructor(
    private readonly k: SchoolKit,
    private readonly items: SchoolItems,
  ) {}

  // ================================================================== terreno

  grounds(plan: CityPlan): void {
    const f = this.k.f;
    const top = f.site.z0 - f.oz;
    // Borde oeste del predio en u (u = ox − x: el oeste, +x, es site.x1).
    // Antes era `site.x0 − ox`, con el signo cambiado: el césped llegaba por
    // debajo de la calle oeste y de la manzana cívica.
    const west = f.ox - f.site.x1;
    const front = SCHOOL.front;
    // Franja de frente y ochavo de Miguel Cané: solado exterior.
    this.k.prisms.plan(
      this.k.m.paving,
      [
        [miguelCaneU(front), front],
        [miguelCaneU(0), 0],
        [U.e + SCHOOL.eastGap, 0],
        [U.e + SCHOOL.eastGap, front],
      ],
      0,
      0.06,
      { bottom: false },
    );
    this.k.prisms.plan(
      this.k.m.paving,
      // Hasta el testero de la salida del pasillo sur (el rincón del ochavo).
      [
        [miguelCaneU(0), 0],
        [U.w, 0],
        [U.w, V.classTop],
        [U.jog, V.classTop],
        [U.jog, V.jogN],
      ],
      0,
      0.06,
      { bottom: false },
    );
    // Fondos de los vecinos detrás de la medianera: pasto y algún árbol.
    this.k.prisms.plan(this.k.m.lawn, [APEX, [miguelCaneU(top), top], [U.teaE, top], [U.teaE, rearV(U.teaE)]], 0, 0.05, {
      bottom: false,
    });
    // Donde no hay aulas del primer piso contra la medianera: detrás de las
    // del Aula Maker y del patio este las copas entraban en ellas.
    for (const [u, v] of [
      fromPlan(43.5, -37.8),
      fromPlan(54.5, -37.0),
      fromPlan(49, -34.4),
    ]) {
      const p = toWorld(f, u, v);
      this.k.nature.broadleaf(p.x, p.z, 0.9 + this.k.rng.range(0, 0.3), 0.05);
    }

    // Calle Miguel Cané: calzada en diagonal y cordones, de Laprida a la calle
    // del norte. La vereda es el solado base de la ciudad.
    const w = plan.streetWidth;
    const lane = w * 0.42;
    const offU = w / 2 / MC_COS;
    const vS = front + w / 2 - lane / 2;
    const vN = top - w / 2 + lane / 2;
    const a: P = [miguelCaneU(vS) - offU, vS];
    const b: P = [miguelCaneU(vN) - offU, vN];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mid = toWorld(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const rot = this.k.yaw(b[0] - a[0], b[1] - a[1]);
    // Un pelo más baja que las calles de la grilla: en el cruce no pelean.
    this.k.farm.add('box', this.k.m.lane, new Vector3(mid.x, 0.038, mid.z), new Vector3(len, 0.075, lane), rot);
    for (const s of [-1, 1]) {
      this.k.piece(this.k.m.kerb, a, b, 0.32, 0, 0.165, s * (lane / 2 + 0.16));
    }
    // Plazoleta al oeste de Miguel Cané, en lo que sobra de la manzana doble.
    const parkEdge = (v: number) => miguelCaneU(v) - w / MC_COS;
    const park: P[] = [
      [west, front],
      [parkEdge(front), front],
      [parkEdge(top), top],
      [west, top],
    ];
    this.k.prisms.plan(this.k.m.lawn, park, 0, 0.06, { bottom: false });
    for (let v = -4; v > top + 3; v -= 7.5) {
      const u = (west + parkEdge(v)) / 2 + this.k.rng.range(-1.5, 1.5);
      if (u > parkEdge(v) - 2.5 || u < west + 2.5) continue;
      const p = toWorld(f, u, v);
      this.k.nature.broadleaf(p.x, p.z, this.k.rng.range(0.8, 1.15), 0.06);
    }
    // Arbolado de la vereda oeste de Miguel Cané.
    for (let v = -2; v > top + 2; v -= 11) {
      const u = miguelCaneU(v) - (w - 2.1) / MC_COS;
      const p = toWorld(f, u, v);
      this.k.street.treePit(p.x, p.z);
      this.k.nature.broadleaf(p.x, p.z, this.k.rng.range(0.7, 1.0), 0.1);
    }
  }

  /**
   * Franja de frente: canteros azul y rojo del lado de la vereda, las
   * palmeras, el árbol del edificio de bloque, el cartel de salida del ochavo
   * y los postes de carteles. El cerco (`fences`) y el remate de sierra
   * (`crest`, justo después de esto) son de la envolvente (`SchoolBuilder`).
   */
  frontage(): void {
    const m = this.k.m;
    for (const r of FRONT_PLANTERS) {
      const uc = (r.u0 + r.u1) / 2;
      const vc = (r.v0 + r.v1) / 2;
      // Canteros alternados azul marino y rojo (0:04–0:08).
      const n = Math.max(1, Math.round((r.u1 - r.u0) / 3.2));
      for (let k = 0; k < n; k++) {
        const a = r.u0 + ((r.u1 - r.u0) * k) / n;
        const b = r.u0 + ((r.u1 - r.u0) * (k + 1)) / n;
        this.k.box(k % 2 === 0 ? m.navy : m.red, (a + b) / 2, vc, b - a - 0.04, 0.5, r.v1 - r.v0, 0.06);
      }
      this.k.box(m.soil, uc, vc, r.u1 - r.u0 - 0.2, 0.03, r.v1 - r.v0 - 0.2, 0.55);
      if (r.u0 > planU(42) && r.u0 < planU(43)) {
        // Cantero del edificio de bloque: matas de pasto ornamental seco, no
        // arbustos (0:09–0:16). Hojas finas abiertas en abanico.
        for (const u of [43.2, 44.6, 46.0, 47.4, 48.8].map(planU)) {
          const p = toWorld(this.k.f, u, vc);
          const n = this.k.detailed ? 8 : 5;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + this.k.rng.range(-0.3, 0.3);
            const tilt = this.k.rng.range(0.12, 0.36);
            const len = this.k.rng.range(1.0, 1.35);
            this.k.farm.add(
              'box',
              m.tuft,
              new Vector3(p.x + Math.sin(a) * Math.sin(tilt) * len * 0.5, 0.57 + Math.cos(tilt) * len * 0.5, p.z + Math.cos(a) * Math.sin(tilt) * len * 0.5),
              new Vector3(0.035, len, 0.035),
              a,
              tilt,
            );
          }
        }
        continue;
      }
      for (let u = r.u0 + 1.2; u < r.u1 - 0.6; u += 1.6) {
        const pt = toWorld(this.k.f, u, vc);
        this.k.nature.shrub(pt.x, pt.z, this.k.rng.range(0.45, 0.75), 0.57);
      }
    }
    // Palmeras: esquina de Miguel Cané, las dos de la vereda de las aulas
    // (0:04) y la del frente del edificio de bloque.
    for (const [u, v, h] of [
      [-2.6, 0.6, 7.5],
      [7.5, 2.6, 6.2],
      [17.0, 2.6, 6.0],
    ] as const) {
      this.palm(planU(u), planV(v), h);
    }
    // Árbol de hoja ancha frente al edificio de bloque (0:12).
    const tree = toWorld(this.k.f, planU(47.0), planV(3.0));
    this.k.nature.broadleaf(tree.x, tree.z, 0.8, 0.06);
    // Cartel de salida de emergencia sobre la salida del ochavo, en el
    // testero del pasillo sur y 5 mm afuera de su cara.
    const exitMid = (V.classTop + V.jogN) / 2;
    this.k.piece(m.exitSign, [U.jog, exitMid + 0.2], [U.jog, exitMid - 0.2], 0.05, 2.45, 2.67, -(SCHOOL.extT / 2 + 0.03));
    // Poste de los carteles de calle (Laprida y Miguel Cané) y del punto de
    // encuentro; las chapas las pinta SchoolIdentity.
    this.k.cyl(m.metalDark, planU(-6.3), planV(3.3), 0.07, 3.35, 0);
    this.k.cyl(m.metalDark, MEETING_POINT[0], MEETING_POINT[1] - 0.02, 0.06, 2.35, 0);
  }

  // ============================================== ítems de exterior y patio

  item(it: Item): void {
    const m = this.k.m;
    const { u, v, w, d } = it;
    const level = it.level ?? 0;
    // Piso del nivel del objeto: todo lo que sigue se apoya en `FY`.
    const FY = LEVEL_Y[level];
    this.k.fy = FY;
    const alongV = it.face === 'e' || it.face === 'w';
    switch (it.kind) {
      case 'planter': {
        const ph = it.h ?? 0.6;
        this.k.box(this.k.mat(it.color, m.blue), u, v, w, ph, d, FY);
        this.k.box(m.soil, u, v, w - 0.12, 0.04, d - 0.12, FY + ph - 0.02);
        // Los canteros rojos altos del patio aire libre (video 2026) llevan una
        // hilera pareja de plantitas (cintas, agaves chicos), no matas grandes.
        const small = ph >= 0.95;
        // En el visor, la mitad de plantitas (presupuesto de triángulos).
        const n = Math.max(1, Math.round(Math.max(w, d) / (small ? (this.k.detailed ? 0.75 : 1.5) : 1.1)));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const p = toWorld(this.k.f, u + (w >= d ? t * (w - 0.5) : 0), v + (w >= d ? 0 : t * (d - 0.5)));
          this.k.nature.shrub(p.x, p.z, small ? this.k.rng.range(0.28, 0.36) : this.k.rng.range(0.55, 0.8), FY + ph);
        }
        break;
      }
      case 'tree': {
        // Cordón de 10 cm alrededor y la tierra 2,5 cm más abajo: con la
        // tapa del cordón y la tierra en el mismo plano, el borde titilaba.
        this.k.box(m.soil, u, v, 1.1, 0.095, 1.1, FY - 0.08);
        for (const s of [-1, 1]) {
          this.k.box(m.slab, u + s * 0.6, v, 0.1, 0.12, 1.3, FY - 0.08);
          this.k.box(m.slab, u, v + s * 0.6, 1.1, 0.12, 0.1, FY - 0.08);
        }
        const p = toWorld(this.k.f, u, v);
        this.k.nature.broadleaf(p.x, p.z, this.k.rng.range(0.75, 0.95), FY);
        break;
      }
      case 'goal': {
        // Arco de handball rojo: postes y travesaño en el frente, red blanca
        // (malla de hilos) atrás, a los costados y arriba.
        const [fu, fv] = faceDir(it.face);
        const width = alongV ? d : w;
        const depth = alongV ? w : d;
        const pu = u + fu * depth * 0.45;
        const pv = v + fv * depth * 0.45;
        const bu = u - fu * depth * 0.45;
        const bv = v - fv * depth * 0.45;
        const across = (c: number) => (alongV ? [0, c] : [c, 0]);
        for (const sgn of [-1, 1]) {
          const [du, dv] = across((sgn * width) / 2);
          this.k.box(m.red, pu + du, pv + dv, 0.08, 2.0, 0.08, FY);
        }
        this.k.box(m.red, pu, pv, alongV ? 0.08 : width + 0.08, 0.08, alongV ? width + 0.08 : 0.08, FY + 2.0);
        // Malla: hilos verticales y horizontales.
        for (let k = 0; k <= 8; k++) {
          const [du, dv] = across((k / 8 - 0.5) * width);
          this.k.box(m.board, bu + du, bv + dv, 0.015, 2.0, 0.015, FY);
        }
        for (let k = 1; k <= 4; k++) {
          this.k.box(m.board, bu, bv, alongV ? 0.015 : width, 0.015, alongV ? width : 0.015, FY + k * 0.5 - 0.05);
        }
        for (const sgn of [-1, 1]) {
          const [du, dv] = across((sgn * width) / 2);
          for (let k = 1; k <= 3; k++) {
            this.k.box(m.board, u + du, v + dv, alongV ? depth * 0.9 : 0.015, 0.015, alongV ? 0.015 : depth * 0.9, FY + k * 0.62);
          }
        }
        break;
      }
      case 'bleachers': {
        // Tribuna de caño negro: tres gradas que suben hacia el muro, con
        // estructura a la vista (no son macizas) y asientos de chapa.
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        const span = alongV ? d : w;
        for (let k = 0; k < 3; k++) {
          const off = (k - 1) * (depth / 3);
          const cu = u - fu * off;
          const cv = v - fv * off;
          const top = FY + 0.42 * (k + 1);
          this.k.box(m.metalDark, cu, cv, alongV ? depth / 3 : span, 0.04, alongV ? span : depth / 3, top - 0.04);
          // Patas y riostras.
          for (const sgn of [-1, 1]) {
            const pu = cu + (alongV ? 0 : (sgn * span) / 2);
            const pv = cv + (alongV ? (sgn * span) / 2 : 0);
            this.k.box(m.metalDark, pu, pv, 0.05, top - FY, 0.05, FY);
          }
        }
        // Baranda del fondo.
        const ru = u - fu * (depth / 2);
        const rv = v - fv * (depth / 2);
        this.k.box(m.metalDark, ru, rv, alongV ? 0.05 : span, 0.05, alongV ? span : 0.05, FY + 2.2);
        break;
      }
      case 'flagpole': {
        const ph = it.h ?? 6.5;
        // En 2026 los mástiles son blancos (con color, el de la bandera).
        this.k.cyl(it.color ? m.frame : m.metal, u, v, 0.07, ph, FY);
        if (it.color && it.color !== 'frame') {
          // Bandera quieta, caída junto al mástil: la argentina (celeste,
          // blanca, celeste) o una toda azul.
          const sky = this.k.mat(it.color, m.blue);
          const stripes = it.color === 'skyWall' ? [sky, m.frame, sky] : [sky, sky, sky];
          stripes.forEach((mat, k) => this.k.box(mat, u + 0.05, v, 0.02, 0.3, 0.55, FY + ph - 0.45 - (k + 1) * 0.3));
        }
        break;
      }
      case 'hoop': {
        // Aro de básquet chico: tablero rojo, aro naranja y red blanca.
        const [nu, nv] = faceDir(it.face);
        this.k.box(m.red, u, v, alongV ? 0.04 : w, 0.45, alongV ? w : 0.04, FY + 1.85);
        this.k.cyl(m.orange, u + nu * 0.25, v + nv * 0.25, 0.4, 0.02, FY + 1.95, true);
        this.k.cyl(m.board, u + nu * 0.25, v + nv * 0.25, 0.3, 0.3, FY + 1.65);
        break;
      }
      case 'palm':
        this.palm(u, v, it.h ?? 6, FY + (it.y ?? 0));
        break;
      case 'amphi': {
        // Gradas del patio nuevo (video 2026, 0:58–1:03): cuatro escalones de
        // hormigón pintado de azul contra el muro del norte. Al este, un
        // cuarto de anillo cóncavo hacia el patio que se une al cantero
        // redondo (la curva en S); al oeste, un tramo recto que termina en la
        // plataforma alta del lado del comedor, con la baranda de caño rojo
        // que baja por los escalones y la de la plataforma. Todo cajas de la
        // granja, sin malla propia.
        const mat = this.k.mat(it.color, m.navy);
        const r = w / 2;
        const n = this.k.detailed ? 7 : 5;
        const half = Math.PI / 4 / n;
        const tiers = 4;
        const rise = 0.42;
        const uW = u - AMPHI_WEST;
        const uP = uW + AMPHI_PLATFORM;
        const fr = (s: number) => AMPHI_INNER + ((1 - AMPHI_INNER) * s) / tiers;
        for (let s = 0; s < tiers; s++) {
          const f0 = fr(s);
          const f1 = fr(s + 1);
          const h = rise * (s + 1);
          const rIn = f0 * r * Math.cos(half);
          const rOut = f1 * r;
          for (let k = 0; k < n; k++) {
            const t = 1.5 * Math.PI + ((k + 0.5) / n) * (Math.PI / 2);
            const mid = (rIn + rOut) / 2;
            const p = toWorld(this.k.f, u + Math.cos(t) * mid, v + Math.sin(t) * mid);
            this.k.farm.add('box', mat, new Vector3(p.x, FY + h / 2, p.z), new Vector3(rOut - rIn, h, 2 * rOut * Math.sin(half) + 0.03), this.k.yaw(Math.cos(t), Math.sin(t)));
          }
          // Tramo recto (el escalón de arriba lo reemplaza la plataforma en el extremo).
          const a = s === tiers - 1 ? uP : uW;
          this.k.box(mat, (a + u + 0.02) / 2, v - ((f0 + f1) / 2) * r, u + 0.02 - a, h, (f1 - f0) * r, FY);
        }
        // Plataforma alta: del frente del último escalón a la medianera, en
        // tres tajadas que siguen el muro en diagonal (las franjas de colisión).
        const top = FY + rise * tiers;
        const front = v - fr(tiers - 1) * r;
        for (const st of amphiStrips(it).slice(-3)) this.k.box(mat, (st.u0 + st.u1) / 2, (st.v0 + front) / 2, st.u1 - st.u0, top - FY, front - st.v0, FY);
        // Barandas de caño rojo: pasamanos y dos travesaños que bajan por el
        // borde oeste de los escalones, y la baranda de la plataforma hasta el muro.
        const rail = (ua: number, va: number, ya: number, ub: number, vb: number, yb: number) => {
          const pa = toWorld(this.k.f, ua, va);
          const pb = toWorld(this.k.f, ub, vb);
          const run = Math.hypot(pb.x - pa.x, pb.z - pa.z);
          this.k.farm.add('box', m.red, new Vector3((pa.x + pb.x) / 2, (ya + yb) / 2, (pa.z + pb.z) / 2), new Vector3(Math.hypot(run, yb - ya), 0.045, 0.045), this.k.yaw(ub - ua, vb - va), 0, Math.atan2(yb - ya, run));
        };
        const ur = uW + 0.05;
        const vLo = v - r * AMPHI_INNER + 0.25;
        const back = amphiRear(uW) + 0.1;
        for (const dy of [0.95, 0.62, 0.3]) rail(ur, vLo, FY + dy, ur, front, top + dy);
        for (const dy of [1.0, 0.67, 0.34]) rail(ur, front, top + dy, ur, back, top + dy);
        for (const [pv, y0] of [
          [vLo, FY],
          [v - fr(2) * r + 0.2, FY + rise * 2],
          [front, top],
          [(front + back) / 2, top],
          [back, top],
        ] as const) {
          const yTop = pv === vLo ? FY + 0.95 : pv <= front ? top + 1.0 : FY + 0.95 + ((top - FY) * (vLo - pv)) / (vLo - front);
          this.k.box(m.red, ur, pv, 0.045, yTop - y0, 0.045, y0);
        }
        break;
      }
      case 'roundPlanter': {
        // Cantero redondo escalonado del rincón NE (video 2026, 1:04–1:06):
        // tres anillos concéntricos de hormigón pintado de azul marino, el de
        // arriba lleno de tierra con arbustos y un arbolito. Cada anillo son
        // gajos rectos de la granja (como las gradas), sin malla propia. El de
        // arriba asoma por encima de las gradas (1,68 m), como en el video.
        const PLANTER_TOP = 2.08;
        const mat = this.k.mat(it.color, m.navy);
        const r = Math.min(w, d) / 2;
        const n = this.k.detailed ? 16 : 10;
        const half = Math.PI / n;
        for (const [a0, a1, h] of [
          [0.86, 1, 0.62],
          [0.72, 0.86, 1.24],
          [0, 0.72, 2.08],
        ] as const) {
          const rIn = a0 * r * Math.cos(half);
          const rOut = a1 * r;
          for (let k = 0; k < n; k++) {
            const t = ((k + 0.5) / n) * Math.PI * 2;
            const mid = (rIn + rOut) / 2;
            const p = toWorld(this.k.f, u + Math.cos(t) * mid, v + Math.sin(t) * mid);
            this.k.farm.add('box', mat, new Vector3(p.x, FY + h / 2, p.z), new Vector3(rOut - rIn, h, 2 * rOut * Math.sin(half) + 0.03), this.k.yaw(Math.cos(t), Math.sin(t)));
          }
        }
        this.k.box(m.soil, u, v, r * 0.95, 0.02, r * 0.95, FY + PLANTER_TOP);
        for (let k = 0; k < 5; k++) {
          const t = (k / 5) * Math.PI * 2 + 0.4;
          const p = toWorld(this.k.f, u + Math.cos(t) * r * 0.45, v + Math.sin(t) * r * 0.45);
          this.k.nature.shrub(p.x, p.z, this.k.rng.range(0.4, 0.55), FY + PLANTER_TOP);
        }
        // Arbolito de flores rosadas, casi sin hojas: dos tallos finos y
        // matas chicas de flor (la pintura rosa, sin material propio).
        const bark = this.k.mats.surface(PALETTE.barkLight, 0.95, 0, 'timber');
        this.k.cyl(bark, u + 0.03, v, 0.06, 1.5, FY + PLANTER_TOP);
        this.k.cyl(bark, u - 0.04, v + 0.02, 0.05, 1.3, FY + PLANTER_TOP);
        const top = toWorld(this.k.f, u, v);
        for (const [dx, dy, dz] of [
          [0.15, 3.38, 0.05],
          [-0.2, 3.18, -0.1],
          [0.05, 3.58, -0.15],
        ] as const) {
          this.k.farm.add('blob', m.pinkWall, new Vector3(top.x + dx, FY + dy, top.z + dz), new Vector3(0.45, 0.35, 0.45));
        }
        break;
      }
      case 'cafeTable': {
        // Mesa del patio nuevo: pie central rojo con cruz y tapa de madera
        // rojiza; con `chess`, un damero de azulejos (en 2026 lo tienen las
        // del patio de las gradas; las del tramo largo son lisas). Las bajas
        // llevan sillas plásticas negras (`roundChairAngles`), las altas son
        // de pie.
        const hgt = (it.h ?? FURNITURE.tableTop) - 0.05;
        this.k.box(this.k.mat(it.color, m.timberDark), u, v, w, 0.05, d, FY + hgt);
        this.k.box(m.red, u, v, 0.09, hgt, 0.09, FY);
        this.k.box(m.red, u, v, w * 0.7, 0.04, 0.07, FY);
        this.k.box(m.red, u, v, 0.07, 0.04, d * 0.7, FY);
        if (it.chess && this.k.detailed) {
          const c = 0.11;
          this.k.box(m.frame, u, v, 4 * c + 0.02, 0.004, 4 * c + 0.02, FY + hgt + 0.05);
          for (let a = 0; a < 4; a++) {
            for (let b = 0; b < 4; b++) {
              if ((a + b) % 2 === 0) this.k.box(m.navy, u + (a - 1.5) * c, v + (b - 1.5) * c, c, 0.003, c, FY + hgt + 0.054);
            }
          }
        }
        if (it.h !== undefined) break;
        for (const a of roundChairAngles(it)) {
          this.items.chair(m.metalDark, u + Math.cos(a) * (w / 2 + FURNITURE.roundChair), v + Math.sin(a) * (w / 2 + FURNITURE.roundChair), [-Math.cos(a), -Math.sin(a)]);
        }
        break;
      }
      case 'boxBench': {
        // Chapa plegada en U, pintada (rojo o azul): tapa y dos laterales.
        const mat = this.k.mat(it.color, m.red);
        const h = it.h ?? 0.46;
        if (it.legs) {
          // Arte y Teatro (video 2026, 1:13–1:19): tapa roja sobre patas y
          // largueros de caño azul (cajas finas de la granja).
          const lm = this.k.mat(it.legs, m.blue);
          const long = w >= d;
          const L = long ? w : d;
          const S = long ? d : w;
          this.k.box(mat, u, v, w, 0.035, d, FY + h - 0.035);
          for (const a of [-1, 1]) {
            for (const b of [-1, 1]) {
              const da = a * (L / 2 - 0.1);
              const db = b * (S / 2 - 0.05);
              this.k.box(lm, u + (long ? da : db), v + (long ? db : da), 0.03, h - 0.035, 0.03, FY);
            }
            // Larguero bajo la tapa en cada lado largo.
            const db = a * (S / 2 - 0.05);
            this.k.box(lm, u + (long ? 0 : db), v + (long ? db : 0), long ? L - 0.2 : 0.03, 0.03, long ? 0.03 : L - 0.2, FY + h - 0.07);
          }
          break;
        }
        this.k.box(mat, u, v, w, 0.04, d, FY + h - 0.04);
        for (const s of [-1, 1]) {
          if (w >= d) this.k.box(mat, u + s * (w / 2 - 0.02), v, 0.04, h - 0.04, d, FY);
          else this.k.box(mat, u, v + s * (d / 2 - 0.02), w, h - 0.04, 0.04, FY);
        }
        break;
      }
      case 'pot': {
        this.k.cyl(m.frame, u, v, w, 0.55, FY, true);
        this.k.cyl(m.soil, u, v, w - 0.06, 0.02, FY + 0.53);
        const p = toWorld(this.k.f, u, v);
        // Las macetas chicas (0,45 m) llevan una planta chica.
        this.k.nature.shrub(p.x, p.z, w < 0.5 ? this.k.rng.range(0.3, 0.38) : this.k.rng.range(0.5, 0.7), FY + 0.55);
        break;
      }
      case 'bunting': {
        // Guirnalda de banderines (papel picado del video 2026) de muro a
        // muro: cordón y banderines de colores; en VR, la mitad.
        const y = FY + (it.y ?? 3.1);
        this.k.piece(m.metalDark, [u - w / 2, v], [u + w / 2, v], 0.01, y - 0.01, y);
        // Papel picado pastel, banderines chicos casi pegados (video 2026).
        const cols = [m.pinkWall, m.skyWall, m.yellow, m.orange, m.lilac, m.frame];
        const step = this.k.detailed ? 0.18 : 0.36;
        const n = Math.floor(w / step);
        for (let k = 0; k < n; k++) {
          const fu = u - w / 2 + (k + 0.5) * (w / n);
          // Cuelga un poco más en el medio (catenaria baja).
          const sag = 0.25 * (1 - ((2 * (k + 0.5)) / n - 1) ** 2);
          this.k.box(cols[k % cols.length], fu, v, 0.15, 0.18, 0.008, y - 0.19 - sag);
        }
        break;
      }
      case 'bareTree': {
        // Árbol pelado de invierno: tronco y cinco ramas abiertas (2:01–2:13),
        // cada una en dos tramos que se afinan y se bifurcan. Antes eran cinco
        // varas rectas desde un mismo nudo: se leía como un perchero.
        this.k.box(m.soil, u, v, 1.1, 0.04, 1.1, FY);
        this.k.cyl(m.timberDark, u, v, 0.16, 2.6, FY);
        const p = toWorld(this.k.f, u, v);
        // Tramo de rama desde `s`: giro `a`, inclinación `lean` (+Y va a `d`).
        const limb = (s: Vector3, a: number, lean: number, len: number, th: number): Vector3 => {
          const d = new Vector3(Math.sin(a) * Math.sin(lean), Math.cos(lean), Math.cos(a) * Math.sin(lean));
          this.k.farm.add('box', m.timberDark, s.add(d.scale(len / 2)), new Vector3(th, len, th), a, lean);
          return s.add(d.scale(len * 0.95));
        };
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.4;
          const lean = 0.5 + 0.15 * (k % 2);
          const side = k % 2 ? 1 : -1;
          const mid = limb(new Vector3(p.x, FY + 1.9 + 0.15 * k, p.z), a, lean, 1.1, 0.075);
          limb(mid, a + side * 0.25, lean - 0.2, 0.9, 0.045);
          limb(mid, a - side * 0.7, lean + 0.35, 0.6, 0.035);
        }
        break;
      }
      case 'slimTree': {
        const ph = it.h ?? 3.4;
        const bark = this.k.mats.surface(PALETTE.barkLight, 0.95, 0, 'timber');
        if (w >= 0.4) {
          // Palmera de tronco grueso y peludo contra el salón (video 2026,
          // 0:07): el tronco sale de cuadro; arriba, un penacho corto de hojas
          // paradas (con las frondas largas de `palm` se metían en el salón).
          this.k.cyl(bark, u, v, 0.45, ph, FY);
          const frond = this.k.mats.foliage(PALETTE.leafMid);
          const p = toWorld(this.k.f, u, v);
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2;
            this.k.farm.add('box', frond, new Vector3(p.x + Math.sin(a) * 0.25, FY + ph + 0.2, p.z + Math.cos(a) * 0.25), new Vector3(0.3, 0.05, 0.9), a, -0.7);
          }
          break;
        }
        // Arbolito de pocos troncos finos (video 2026): dos tallos de corteza
        // gris oliva y una copa chica arriba, en su cazuela.
        for (const [du, dv, k] of [
          [0.04, 0.03, 1],
          [-0.05, -0.02, 0.9],
        ] as const) {
          this.k.cyl(bark, u + du, v + dv, 0.07, ph * k, FY);
        }
        const p = toWorld(this.k.f, u, v);
        this.k.farm.add('blob', this.k.mats.foliage(PALETTE.leafMid), new Vector3(p.x, FY + ph - 0.1, p.z), new Vector3(1.0, 0.9, 1.0));
        break;
      }
      case 'hedge': {
        // Del tamaño del ítem (que es macizo): con un arbusto genérico de
        // 1,6–3,5 m de ancho la gente lo atravesaba. Los vecinos se pisan
        // 15 cm y forman un cerco continuo de 1,25 m.
        const p = toWorld(this.k.f, u, v);
        this.k.farm.add('blob', this.k.mats.foliage(PALETTE.leafMid), new Vector3(p.x, FY + 0.6, p.z), new Vector3(w + 0.15, 1.3, d + 0.1));
        break;
      }
      // Escuela 2050 (paquete C): árbol solar, todavía sin dibujo.
      case 'solarTree':
        break;
    }
  }

  private palm(u: number, v: number, h: number, base = 0): void {
    const trunk = this.k.mats.surface(PALETTE.barkLight, 0.95, 0, 'timber');
    this.k.cyl(trunk, u, v, 0.34, h * 0.55, base);
    this.k.cyl(trunk, u, v, 0.26, h * 0.45, base + h * 0.55);
    const frond = this.k.mats.foliage(PALETTE.leafMid);
    const p = toWorld(this.k.f, u, v);
    // Una palmera joven tiene hojas más cortas: con las de una adulta, la del
    // patio este metía las frondas dentro del salón.
    const scale = Math.min(1, h / 6);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + this.k.rng.range(-0.15, 0.15);
      const len = this.k.rng.range(2.8, 3.3) * scale;
      const droop = this.k.rng.range(0.6, 0.9);
      const cx = p.x + Math.sin(a) * len * 0.45;
      const cz = p.z + Math.cos(a) * len * 0.45;
      // Hoja: caja chata girada hacia afuera y caída en la punta.
      this.k.farm.add('box', frond, new Vector3(cx, base + h - 0.25, cz), new Vector3(0.35, 0.05, len), a, droop);
    }
  }

  // =========================================================== Escuela 2050

  /**
   * Mata de vegetación en (u, v) sobre `base` (paquete C, `FoliageCards`):
   * todavía sin dibujo. Preparada para reemplazar las bolas de
   * `nature.shrub` sin cambiar cuántos números saca el generador.
   */
  plants(_u: number, _v: number, _kind: PlantClass, _scale = 1, _base = 0): void {}

  /**
   * Equipamiento de vereda 2050 (paquete C: bancos con jardinera,
   * bicicletero, "Recorrido 40" al ras, deck del mirador): todavía vacío.
   * Va al final de `build`: lo que agregue no reordena la granja.
   */
  streetscape(): void {}
}
