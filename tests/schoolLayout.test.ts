import { describe, it, expect } from 'vitest';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';
import {
  ROOMS,
  SCHOOL,
  STATION_SPOTS,
  STUDENT_ZONES,
  U,
  V,
  WALLS,
  inPoly,
  miguelCaneU,
  roomAt,
  toLocal,
  toWorld,
} from '../src/world/SchoolLayout';
import { triangulate } from '../src/world/builders/PrismBatch';

const SEEDS = [1, 7, 42, 99, 123, 2050, 31337, 424242, 7777, 55555, 8, 13, 21, 34, 89];

/** Camina en línea recta de a pasos cortos: false si algún punto está bloqueado. */
function walkable(index: CityIndex, f: ReturnType<CityIndex['school']> & object, path: Array<[number, number]>): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const [u0, v0] = path[i];
    const [u1, v1] = path[i + 1];
    const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.1);
    for (let k = 0; k <= n; k++) {
      const p = toWorld(f, u0 + ((u1 - u0) * k) / n, v0 + ((v1 - v0) * k) / n);
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
    // Frente sobre Laprida y fondo del jardín.
    expect(SCHOOL.width).toBeGreaterThan(60);
    expect(SCHOOL.width).toBeLessThan(75);
    // Cinco aulas de ~6,5 m sobre Laprida.
    const aulas = [U.w, U.c2, U.c3, U.c4, U.c5, U.east1];
    for (let i = 0; i < 5; i++) {
      const w = aulas[i + 1] - aulas[i];
      expect(w).toBeGreaterThan(5.8);
      expect(w).toBeLessThan(7.4);
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
    for (let u = -2; u < 68; u += 0.7) {
      for (let v = -39; v < 0; v += 0.7) {
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
    for (const v of [-12, -16, -21, -35.5]) {
      const inside = toWorld(f, miguelCaneU(v) + 1.0, v);
      expect(index.isSolid(inside.x, inside.z), `v=${v}`).toBe(false);
      const wall = toWorld(f, miguelCaneU(v), v);
      expect(index.isSolid(wall.x, wall.z), `muro v=${v}`).toBe(true);
    }
  });

  it('se entra desde Laprida y se recorren pasillos, patios y gimnasio', () => {
    // Vereda → escalinata → vestíbulo → puertas → hall.
    expect(walkable(index, f, [[37.4, 5], [37.4, -4]])).toBe(true);
    // Hall → pasillo sur → hasta el ochavo, pasando frente a las cinco aulas.
    expect(walkable(index, f, [[36.5, -4], [34.2, -8.0], [2, -8.0]])).toBe(true);
    // Pasillo sur → pasillo oeste → pasillo norte → salida a Miguel Cané (por
    // delante de la columna forrada del cruce).
    expect(walkable(index, f, [[14.8, -8.2], [14.8, -24.0], [11.4, -24.0], [11.4, -24.3], [9.6, -24.3]])).toBe(true);
    // Pasillo sur → patio oeste por su abertura, rodeando el cantero de la palmera.
    expect(walkable(index, f, [[24.4, -8.2], [24.4, -10.8], [19.0, -10.8], [19.0, -15.0]])).toBe(true);
    // Hall → patio este por la puerta del testero norte.
    expect(walkable(index, f, [[36.65, -9], [36.65, -18]])).toBe(true);
    // Hall → pasaje → gimnasio por la puerta doble.
    expect(walkable(index, f, [[39, -10.1], [52, -10.1]])).toBe(true);
    // Gimnasio → salida a Laprida.
    expect(walkable(index, f, [[53, -3], [53, 4]])).toBe(true);
    // Patio este → pasillo del gimnasio → V. Damas.
    expect(walkable(index, f, [[48, -21.7], [61, -21.7], [61, -25.95], [64, -25.95]])).toBe(true);
    // Pasillo → jardín por su puerta.
    expect(walkable(index, f, [[60.7, -22.5], [60.7, -32]])).toBe(true);
    // Pasillo norte → pasillo de bloque → Aula Maker por su puerta vidriada.
    expect(walkable(index, f, [[18.7, -24.3], [14.95, -24.3], [14.95, -30.4], [17.0, -31.2], [22.0, -31.2]])).toBe(true);
    // Pasillo oeste → Administración → baño (por sus puertas al pasillo).
    expect(walkable(index, f, [[14.8, -18.5], [12.3, -18.5]])).toBe(true);
  });

  it('las aulas, el gimnasio y los muros bloquean', () => {
    // Muro entre dos aulas y muro entre el pasillo y el patio oeste.
    for (const [u, v] of [
      [U.c3, -3],
      [U.patioW, -15],
      [U.gymW, -15],
      [41.5, V.facade],
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
