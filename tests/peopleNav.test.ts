import { describe, it, expect } from 'vitest';
import { NavGrid, climb, polyLength, stairLinks, type NavPath } from '../src/world/people/NavGrid';
import { LEVEL_Y, levelOf, roomAt, schoolSolidLocal, setDynamicSolid, type Level } from '../src/world/SchoolLayout';

/**
 * Navegación de la gente: la grilla sale de la misma colisión que el jugador,
 * así que estos tests son también una auditoría de que la escuela "se camina":
 * puertas que conectan, patios a los que se llega, nada que atraviese muros.
 */

const nav = new NavGrid();

/** Recorre el camino a pasos de 5 cm: ningún punto puede caer dentro de un muro. */
function assertClear(path: NavPath): void {
  for (const leg of path.legs) {
    if (leg.stair) continue;
    for (let i = 2; i < leg.pts.length; i += 2) {
      const u0 = leg.pts[i - 2];
      const v0 = leg.pts[i - 1];
      const u1 = leg.pts[i];
      const v1 = leg.pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.05));
      for (let k = 0; k <= n; k++) {
        const u = u0 + ((u1 - u0) * k) / n;
        const v = v0 + ((v1 - v0) * k) / n;
        // Sin margen de cuerpo (las puertas angostas se cruzan por su línea
        // media): lo que se exige es no meterse DENTRO de un muro o mueble.
        expect(insideWall(u, v, leg.level), `camino dentro de un muro en ${u.toFixed(2)}, ${v.toFixed(2)} (nivel ${leg.level})`).toBe(false);
      }
    }
  }
}

/** Dentro de un muro: macizo en el punto y en los cuatro vecinos a 12 cm. */
function insideWall(u: number, v: number, level: Level): boolean {
  const f = LEVEL_Y[level];
  const s = (a: number, b: number) => schoolSolidLocal(a, b, f, true);
  return s(u, v) && s(u + 0.12, v) && s(u - 0.12, v) && s(u, v + 0.12) && s(u, v - 0.12);
}

const P = (u: number, v: number, level: Level = 0) => ({ u, v, level });

describe('gente — grilla de navegación', () => {
  it('se arma rápido y la planta baja es una sola pieza grande', () => {
    const t0 = performance.now();
    const l0 = nav.level(0);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500);
    const biggest = Math.max(...l0.sizes);
    // Más de 12.000 celdas de 25 cm: el edificio, los patios y la vereda.
    expect(biggest).toBeGreaterThan(12000);
  });

  const routes: Array<[string, [number, number], [number, number]]> = [
    ['hall → patio este', [37.5, -6.0], [45.0, -22.0]],
    ['hall → polideportivo', [37.5, -6.0], [58.0, -10.0]],
    ['pasillo sur → patio oeste', [20.0, -8.2], [22.0, -18.0]],
    ['vereda → hall (por el portón)', [37.0, 4.0], [37.5, -6.0]],
    ['vereda → aula 4', [37.0, 4.0], [24.5, -6.5]],
    ['patio oeste → comedor', [22.0, -18.0], [32.25, -19.0]],
    ['hall → jardín (sala amarilla)', [37.5, -6.0], [62.9, -32.0]],
    ['pasillo sur → aula maker', [20.0, -8.2], [24.0, -31.0]],
  ];
  for (const [name, a, b] of routes) {
    it(`hay camino: ${name}`, () => {
      const path = nav.findPath(P(a[0], a[1]), P(b[0], b[1]));
      expect(path, name).not.toBeNull();
      assertClear(path!);
      // Ni un rodeo absurdo: menos de 3,5 veces la distancia en línea recta.
      expect(path!.length).toBeLessThan(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3.5 + 6);
    });
  }

  it('el portón es la entrada: de la vereda al hall no se pasa por una salida de emergencia', () => {
    const path = nav.findPath(P(37.0, 4.0), P(37.5, -6.0))!;
    const pts = path.legs[0].pts;
    for (let i = 0; i < pts.length; i += 2) {
      const u = pts[i];
      const v = pts[i + 1];
      if (v > -0.5 && v < 1.0) expect(u, 'cruza la línea de fachada por el portón').toBeGreaterThan(32.9);
    }
  });

  it('no hay camino a través de los muros: el aula 1 está cerrada salvo su puerta', () => {
    // Desde el aula 1 a la calle Miguel Cané: hay que salir al pasillo y dar la vuelta.
    const path = nav.findPath(P(3.0, -3.5), P(-5.0, -3.5));
    if (path) {
      // Si existe, no cruza el muro oeste: el largo delata el rodeo.
      expect(path.length).toBeGreaterThan(10);
      assertClear(path);
    }
  });

  it('una puerta con llave (setDynamicSolid) se respeta y al abrirse vuelve a pasarse', () => {
    // Cierra el acceso al polideportivo desde el pasaje.
    setDynamicSolid('test-gym', { u0: 49.8, v0: -11.2, u1: 50.8, v1: -9.1, level: 0 });
    try {
      const path = nav.findPath(P(45.0, -10.1), P(55.0, -10.0));
      if (path) {
        for (const leg of path.legs) {
          for (let i = 0; i < leg.pts.length; i += 2) {
            const u = leg.pts[i];
            const v = leg.pts[i + 1];
            expect(u > 49.8 && u < 50.8 && v > -11.2 && v < -9.1, 'pasa por la puerta cerrada').toBe(false);
          }
        }
      }
    } finally {
      setDynamicSolid('test-gym', null);
    }
    nav.now += 100;
    const again = nav.findPath(P(45.0, -10.1), P(55.0, -10.0));
    expect(again).not.toBeNull();
  });

  it('las escaleras se derivan del plano y llevan a cada piso', () => {
    expect(stairLinks().length).toBeGreaterThanOrEqual(nav.usableLinks().length);
    const links = nav.usableLinks();
    const has = (from: Level, to: Level, uMin: number, uMax: number) =>
      links.some((l) => l.from === from && l.to === to && l.pts[0][0] >= uMin && l.pts[0][0] <= uMax);
    // Edificio principal (hall o bloque norte o ala oeste), bloque al aula de danzas, y el jardín.
    expect(has(0, 1, 5, 40), 'planta baja → primer piso').toBe(true);
    expect(has(1, 2, 40, 50), 'primer piso → aula de danzas').toBe(true);
    expect(has(0, 1, 55, 62), 'jardín: planta baja → primer piso').toBe(true);
    expect(has(1, 2, 55, 62), 'jardín: primer → segundo piso').toBe(true);
    for (const link of links) {
      const feet = climb(link.pts, LEVEL_Y[link.from]);
      expect(Number.isFinite(feet), `escalera ${link.id} choca`).toBe(true);
      expect(levelOf(feet)).toBe(link.to);
      const a = link.pts[0];
      const b = link.pts[link.pts.length - 1];
      expect(nav.nearestWalkable(link.from, a[0], a[1], 0.8), `pie de ${link.id}`).not.toBeNull();
      expect(nav.nearestWalkable(link.to, b[0], b[1], 0.8), `llegada de ${link.id}`).not.toBeNull();
    }
  });

  it('de la planta baja al aula de danzas del segundo piso, por escaleras', () => {
    const path = nav.findPath(P(37.5, -6.0), P(47.0, -8.0, 2));
    expect(path).not.toBeNull();
    const stairs = path!.legs.filter((l) => l.stair).map((l) => l.stair!.id);
    expect(stairs.length).toBeGreaterThanOrEqual(2);
    expect(roomAt(47.0, -8.0, 2)?.id).toBe('aulaDanzas');
  });

  it('los caminos son cortos de calcular', () => {
    const t0 = performance.now();
    let n = 0;
    for (const [, a, b] of routes) {
      if (nav.findPath(P(a[0], a[1]), P(b[0], b[1]))) n++;
    }
    const ms = (performance.now() - t0) / routes.length;
    expect(n).toBe(routes.length);
    expect(ms).toBeLessThan(25);
    expect(polyLength([0, 0, 3, 4])).toBe(5);
  });
});
