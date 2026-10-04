import { describe, it, expect } from 'vitest';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';
import {
  PORTAL_COLUMNS,
  PORTAL_PILLARS,
  PORTAL_RAILS,
  ROOMS,
  SC,
  SCHOOL,
  STATION_SPOTS,
  STUDENT_ZONES,
  U,
  V,
  WALLS,
  fromPlan,
  inPoly,
  miguelCaneU,
  planU,
  planV,
  roomAt,
  toLocal,
  toWorld,
} from '../src/world/SchoolLayout';
import { triangulate } from '../src/world/builders/PrismBatch';

const SEEDS = [1, 7, 42, 99, 123, 2050, 31337, 424242, 7777, 55555, 8, 13, 21, 34, 89];

/**
 * Camina en línea recta de a pasos cortos: false si algún punto está
 * bloqueado. Los vértices se leen en el plano (`fromPlan`), como los cita
 * HANDOFF: así el recorrido sigue a la escuela a tamaño real.
 */
function walkable(index: CityIndex, f: ReturnType<CityIndex['school']> & object, path: Array<[number, number]>): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const [u0, v0] = path[i];
    const [u1, v1] = path[i + 1];
    const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.1);
    for (let k = 0; k <= n; k++) {
      const p = toWorld(f, ...fromPlan(u0 + ((u1 - u0) * k) / n, v0 + ((v1 - v0) * k) / n));
      if (index.isPedestrianBlocked(p.x, p.z)) return false;
    }
  }
  return true;
}

describe('escuela CIMDIP & Miguel Cané — planta del plano de evacuación', () => {
  for (const gridSize of [5, 9]) {
    for (const seed of SEEDS) {
      const plan = generateCityPlan(seed, { gridSize });
      const index = new CityIndex(plan);

      it(`grilla ${gridSize}, semilla ${seed}: existe, ocupa dos manzanas y no es agua`, () => {
        const f = index.school;
        expect(f).not.toBeNull();
        expect(f!.block.kind).not.toBe('water');
        const annex = plan.blocks.find((b) => b.landmark === 'schoolAnnex');
        expect(annex?.kind).toBe('civic');
        // Laprida (v = 0) mira al sur, a la fila de manzanas de enfrente.
        const facade = toWorld(f!, 30, 0);
        const front = plan.blocks.find((b) => b.gx === f!.block.gx && b.gz === f!.block.gz + 1)!;
        expect(facade.z).toBeLessThan(front.cz);
        expect(front.cz - facade.z).toBeLessThan(plan.blockSize + plan.streetWidth);
      });

      it(`grilla ${gridSize}, semilla ${seed}: todo el edificio cae dentro del predio`, () => {
        const f = index.school!;
        for (const w of WALLS) {
          for (const p of [w.a, w.b]) {
            const q = toWorld(f, p[0], p[1]);
            expect(q.x).toBeGreaterThanOrEqual(f.site.x0);
            expect(q.x).toBeLessThanOrEqual(f.site.x1);
            expect(q.z).toBeGreaterThanOrEqual(f.site.z0);
            expect(q.z).toBeLessThanOrEqual(f.site.z1);
          }
        }
      });

      it(`grilla ${gridSize}, semilla ${seed}: el canal no toca el predio`, () => {
        const { canal } = plan;
        const f = index.school!;
        for (const [x, z] of [
          [f.site.x0, f.site.z0],
          [f.site.x1, f.site.z1],
          [f.site.x0, f.site.z1],
          [f.site.x1, f.site.z0],
        ]) {
          const d = Math.abs(canal.slope * x - z + canal.offset) / Math.hypot(canal.slope, 1);
          expect(d).toBeGreaterThan(canal.halfWidth);
        }
      });
    }
  }

  const plan = generateCityPlan(42, { gridSize: 5 });
  const index = new CityIndex(plan);
  const f = index.school!;

  it('local ↔ mundo es reversible', () => {
    for (const [u, v] of [
      [3, -7],
      [-12.5, 18],
      [60, -30],
    ]) {
      const w = toWorld(f, u, v);
      const l = toLocal(f, w.x, w.z);
      expect(l.u).toBeCloseTo(u, 6);
      expect(l.v).toBeCloseTo(v, 6);
    }
  });

  it('respeta las proporciones medidas del plano', () => {
    // Frente sobre Laprida: el real, ~78 m (OpenStreetMap), no los 67,4 del plano.
    expect(SCHOOL.width).toBeGreaterThan(77);
    expect(SCHOOL.width).toBeLessThan(79);
    // Cinco aulas sobre Laprida: ~6,5 m en el plano, ~7,5 m reales.
    const aulas = [U.w, U.c2, U.c3, U.c4, U.c5, U.east1];
    for (let i = 0; i < 5; i++) {
      const w = aulas[i + 1] - aulas[i];
      expect(w).toBeGreaterThan(5.8 * SC);
      expect(w).toBeLessThan(7.4 * SC);
    }
    // El gimnasio es el ambiente más grande.
    const gym = ROOMS.find((r) => r.id === 'gimnasio')!;
    expect((U.e - U.gymW) * -V.gymTop).toBeGreaterThan(300);
    expect(gym.name).toBe('Gimnasio SUM');
  });

  it('están todos los ambientes rotulados del plano', () => {
    const names = new Set(ROOMS.map((r) => r.name));
    for (const n of [
      'Tecnología',
      'E.P',
      'ADM',
      'Prof.',
      'Dir. Prim',
      'Buffet',
      'Patio aire libre',
      'Salón de los espejos',
      'Gimnasio SUM',
      'Arte',
      'Teatro',
      'V. Damas',
      'Jardín de infantes CIMPID',
    ]) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('los ambientes de planta baja no se superponen', () => {
    // Muestreo en grilla: cada punto cae a lo sumo en un ambiente.
    const ground = ROOMS.filter((r) => (r.level ?? 0) === 0);
    for (let u = planU(-2); u < planU(68); u += 0.7) {
      for (let v = planV(-39); v < 0; v += 0.7) {
        const hits = ground.filter((r) => inPoly(r.poly, u, v)).map((r) => r.id);
        expect(hits.length, `${u.toFixed(1)}, ${v.toFixed(1)}: ${hits.join(',')}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('todos los polígonos se triangulan por completo', () => {
    for (const r of ROOMS) {
      expect(triangulate(r.poly).length, r.id).toBe(r.poly.length - 2);
    }
  });

  it('el ala oeste se apoya sobre la diagonal de Miguel Cané', () => {
    // A 30 cm dentro de la línea municipal hay muro; a 1 m, ambiente.
    for (const v of [-12, -16, -19, -35.5].map(planV)) {
      const inside = toWorld(f, miguelCaneU(v) + 1.0, v);
      expect(index.isSolid(inside.x, inside.z), `v=${v}`).toBe(false);
      const wall = toWorld(f, miguelCaneU(v), v);
      expect(index.isSolid(wall.x, wall.z), `muro v=${v}`).toBe(true);
    }
  });

  it('se entra desde Laprida y se recorren pasillos, patios y gimnasio', () => {
    // Vereda → escalinata → portón (al costado de la columna del medio, que
    // está sobre el eje de la entrada) → atrio → puertas → hall.
    expect(walkable(index, f, [[35.84, 5], [35.84, -1.2], [35.24, -3.6]])).toBe(true);
    // Hall → pasillo sur → hasta el ochavo, pasando frente a las cinco aulas.
    expect(walkable(index, f, [[35.24, -3.6], [34.2, -7.4], [2, -7.4]])).toBe(true);
    // Pasillo sur → pasillo oeste → pasillo norte → nicho → salida a Miguel Cané.
    expect(walkable(index, f, [[13.65, -7.4], [13.65, -22.1], [9.7, -22.1], [9.7, -24.2], [11.5, -26.0], [11.5, -27.45], [10.3, -27.45]])).toBe(true);
    // Pasillo sur → patio oeste por su paso, rodeando los canteros.
    expect(walkable(index, f, [[23.02, -7.4], [23.02, -10.0], [17.2, -10.0], [17.2, -15.0]])).toBe(true);
    // Hall → patio este por la puerta del testero norte.
    expect(walkable(index, f, [[36.2, -9], [36.2, -18]])).toBe(true);
    // Hall → pasaje → gimnasio por la puerta doble.
    expect(walkable(index, f, [[39, -9.8], [52, -9.8]])).toBe(true);
    // Gimnasio → salida a Laprida.
    expect(walkable(index, f, [[51.8, -3], [51.8, 4]])).toBe(true);
    // Patio este → pasillo del gimnasio → V. Damas.
    expect(walkable(index, f, [[48, -21.7], [61, -21.7], [61, -25.95], [64, -25.95]])).toBe(true);
    // Pasillo → jardín por su puerta, por la galería hasta la recepción.
    expect(walkable(index, f, [[61.4, -22.5], [61.4, -36.5]])).toBe(true);
    // Pasillo norte → pasillo de bloque → Aula Maker por su puerta vidriada.
    expect(walkable(index, f, [[18.7, -22.1], [13.3, -22.1], [13.3, -31.5], [22.0, -31.5]])).toBe(true);
    // Pasillo oeste → baño de la columna de Administración, por su puerta.
    expect(walkable(index, f, [[13.6, -19.0], [11.6, -19.0]])).toBe(true);
  });

  it('el portal: pilares, columnas y reja son macizos y se pasa por el portón', () => {
    // Se atravesaban (jugador y gente): la reja de toda la altura, los
    // pilares de granito y la columna del medio, justo en el eje de la entrada.
    for (const r of [...PORTAL_PILLARS, ...PORTAL_COLUMNS]) {
      const p = toWorld(f, (r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
      expect(index.isSolid(p.x, p.z), `${r.u0}`).toBe(true);
      expect(index.isPedestrianBlocked(p.x, p.z), `${r.u0}`).toBe(true);
    }
    for (const [a, b] of PORTAL_RAILS) {
      const p = toWorld(f, (a[0] + b[0]) / 2, a[1]);
      expect(index.isPedestrianBlocked(p.x, p.z)).toBe(true);
    }
    // A cada lado de la columna del medio queda un paso de ~1,2 m.
    for (const u of [34.5, 35.95]) expect(walkable(index, f, [[u, 3], [u, -1.5]]), `${u}`).toBe(true);
  });

  it('las aulas, el gimnasio y los muros bloquean', () => {
    // Muro entre dos aulas y muro entre el pasillo y el patio oeste.
    for (const [u, v] of [
      [U.c3, -3],
      [U.patioW, -15],
      [U.gymW, -15],
      [planU(41.5), V.facade],
    ]) {
      const p = toWorld(f, u, v);
      expect(index.isSolid(p.x, p.z), `${u}, ${v}`).toBe(true);
    }
  });

  it('la calle entre las dos manzanas ya no existe y no se atraviesan muros por ella', () => {
    const pitch = plan.blockSize + plan.streetWidth;
    // x = −pitch/2 era el eje de esa calle: ahora cae dentro del predio.
    const site = plan.schoolSite!;
    const b = index.blockAt(-pitch / 2, (site.z0 + site.z1) / 2);
    expect(b?.landmark).toBeTruthy();
    const gapStreet = plan.streets.find((s) => s.axis === 'z' && Math.abs(s.at + pitch / 2) < 1e-6);
    expect(gapStreet?.gaps).toContainEqual([site.z0, site.z1]);
  });

  it('cada estación tiene lugar libre alrededor para acercarse', () => {
    for (const [id, spot] of Object.entries(STATION_SPOTS)) {
      const c = toWorld(f, spot.u, spot.v);
      expect(index.isSolid(c.x, c.z), `${id} en un muro`).toBe(false);
      expect(roomAt(spot.u, spot.v), id).not.toBeNull();
      let free = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const p = toWorld(f, spot.u + Math.cos(a) * 1.8, spot.v + Math.sin(a) * 1.8);
        if (!index.isSolid(p.x, p.z)) free++;
      }
      expect(free, id).toBeGreaterThanOrEqual(4);
    }
  });

  it('las zonas de alumnos tienen lugar libre', () => {
    for (const [id, r] of Object.entries(STUDENT_ZONES)) {
      let free = 0;
      let total = 0;
      for (let u = r.u0; u < r.u1; u += 0.5) {
        for (let v = r.v0; v < r.v1; v += 0.5) {
          total++;
          const p = toWorld(f, u, v);
          if (!index.isPedestrianBlocked(p.x, p.z)) free++;
        }
      }
      expect(free / total, id).toBeGreaterThan(0.6);
    }
  });
});
