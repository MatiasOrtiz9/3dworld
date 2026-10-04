import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';
import { APEX, ITEMS, SC, SCHOOL, U, V, WALLS, miguelCaneU } from '../src/world/SchoolLayout';
// Sólo la prueba lee los datos en metros del plano, para compararlos con los reales.
import { PLAN_ITEMS, PLAN_WALLS } from '../src/world/SchoolGround';
import { wallGapBehindIn } from '../src/world/SchoolScale';
import type { Item } from '../src/world/SchoolBase';

/**
 * Escuela a tamaño real (HANDOFF 90). El plano CAD se había registrado con
 * 67,4 m de frente y el edificio real mide ~78 m (OpenStreetMap): los datos
 * siguen en metros del plano y `SchoolLayout` los entrega en metros reales.
 * Estas pruebas cuidan las reglas de esa pasada para que nadie las rompa sin
 * darse cuenta.
 */
describe('escuela a tamaño real', () => {
  it('el frente mide lo real y el fondo crece en la misma proporción', () => {
    expect(SCHOOL.width).toBeCloseTo(78, 6);
    expect(U.e).toBeCloseTo(78, 6);
    expect(V.top).toBeCloseTo(-39 * SC, 6);
    expect(V.top).toBeCloseTo(-45.13, 2);
  });

  it('fuera de los módulos de datos nadie importa coordenadas del plano', () => {
    // Las coordenadas de `SchoolBase`, `SchoolGround`, `SchoolUpper` y
    // `SchoolJardin` están en metros del PLANO: importarlas en un consumidor
    // mezcla unidades sin que tsc se queje. Los consumidores importan de
    // `SchoolLayout` (metros reales); de los módulos de datos, sólo tipos.
    const DATA = /from '[./]*(?:world\/|\.\/|\.\.\/)?(SchoolBase|SchoolGround|SchoolUpper|SchoolJardin)'/;
    const ALLOWED = new Set(['SchoolBase.ts', 'SchoolGround.ts', 'SchoolUpper.ts', 'SchoolJardin.ts', 'SchoolScale.ts', 'SchoolLayout.ts']);
    const bad: string[] = [];
    const visit = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          visit(p);
          continue;
        }
        if (!p.endsWith('.ts') || ALLOWED.has(name)) continue;
        for (const line of readFileSync(p, 'utf8').split('\n')) {
          if (DATA.test(line) && !/^\s*(import|export) type\b/.test(line)) bad.push(`${p}: ${line.trim()}`);
        }
      }
    };
    visit(join(__dirname, '..', 'src'));
    expect(bad).toEqual([]);
  });

  it('lo que va contra un muro conserva su distancia real a ese muro', () => {
    // Cara trasera del ítem (la opuesta a la que mira).
    const back = (it: Item): [number, number] => {
      const du = it.face === 'e' ? -it.w / 2 : it.face === 'w' ? it.w / 2 : 0;
      const dv = it.face === 's' ? -it.d / 2 : it.face === 'n' ? it.d / 2 : 0;
      return [it.u + du, it.v + dv];
    };
    expect(ITEMS.length).toBe(PLAN_ITEMS.length);
    let anchored = 0;
    const off: string[] = [];
    PLAN_ITEMS.forEach((p, k) => {
      const level = p.level ?? 0;
      const [pu, pv] = back(p);
      const g0 = wallGapBehindIn(PLAN_WALLS, level, pu, pv, p.face);
      if (!(g0 >= -0.1 && g0 <= 0.35)) return;
      const r = ITEMS[k];
      const [ru, rv] = back(r);
      const g1 = wallGapBehindIn(WALLS, level, ru, rv, r.face);
      anchored++;
      if (Math.abs(g1 - g0) > 0.001) off.push(`${p.kind} ${p.u.toFixed(2)},${p.v.toFixed(2)} L${level}: ${g0.toFixed(3)} → ${g1.toFixed(3)}`);
    });
    expect(anchored).toBeGreaterThan(200);
    expect(off).toEqual([]);
  });

  it('las puertas de una hoja no pasan de 1,1 m (salvo las que ya medían más en el plano) ni se achican', () => {
    // `t0`/`t1` ya son metros a lo largo del muro. Una hoja escalada 15,7 %
    // pasaba el máximo de una hoja (HANDOFF 88); la que el CAD ya dibujaba
    // más ancha conserva su medida.
    expect(WALLS.length).toBe(PLAN_WALLS.length);
    WALLS.forEach((w, i) => {
      w.openings.forEach((o, k) => {
        if (o.type !== 'door') return;
        const p = PLAN_WALLS[i].openings[k];
        const where = `puerta en ${w.a.map((x) => x.toFixed(2)).join(',')} → ${w.b.map((x) => x.toFixed(2)).join(',')}`;
        expect(o.t1 - o.t0, where).toBeLessThanOrEqual(Math.max(1.1, p.t1 - p.t0) + 1e-6);
        expect(o.t1 - o.t0, where).toBeGreaterThanOrEqual(p.t1 - p.t0 - 1e-6);
      });
    });
  });

  it('el predio contiene la escuela con margen al norte y deja la vereda de Miguel Cané', () => {
    for (const gridSize of [5, 9]) {
      const f = new CityIndex(generateCityPlan(42, { gridSize })).school!;
      // Vértice norte (el punto más al norte de la escuela) a ≥ 1 m del borde del predio.
      const north = f.oz + Math.min(V.top, APEX[1]);
      expect(north - f.site.z0, `grilla ${gridSize}`).toBeGreaterThanOrEqual(1);
      // Al oeste de la línea municipal de Miguel Cané, sobre Laprida, quedan
      // ≥ 8 m de predio (vereda, calzada y plazoleta).
      const mcX = f.ox - miguelCaneU(SCHOOL.front);
      expect(f.site.x1 - mcX, `grilla ${gridSize}`).toBeGreaterThanOrEqual(8);
      // Gral. Acha: el muro del gimnasio queda a `eastGap` del borde este.
      expect(f.ox - U.e - f.site.x0).toBeCloseTo(SCHOOL.eastGap, 6);
    }
  });
});
