import { describe, it, expect } from 'vitest';
import {
  LANDINGS,
  LEVEL_Y,
  ROOMS,
  SCHOOL,
  STAIRS,
  levelOf,
  roomAt,
  roomLevel,
  schoolFloorLocal,
  schoolSolidLocal,
  stairY,
  type Stair,
} from '../src/world/SchoolLayout';

/**
 * Pisos y escaleras de la escuela.
 *
 * La colisión y la altura del piso dependen de a qué altura están los pies:
 * así se sube por una escalera (rampa bajo los escalones), se llega al primer
 * piso y desde ahí lo que bloquea son los muros de ese nivel.
 */

const FY = SCHOOL.floorY;

/** Camina en línea recta dejando que los pies sigan el piso, como el jugador. */
function climb(path: Array<[number, number]>, feet0: number): number {
  let feet = feet0;
  for (let i = 0; i < path.length - 1; i++) {
    const [u0, v0] = path[i];
    const [u1, v1] = path[i + 1];
    const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.05);
    for (let k = 1; k <= n; k++) {
      const u = u0 + ((u1 - u0) * k) / n;
      const v = v0 + ((v1 - v0) * k) / n;
      expect(schoolSolidLocal(u, v, feet), `bloqueado en ${u.toFixed(2)}, ${v.toFixed(2)} (pies ${feet.toFixed(2)})`).toBe(false);
      feet = schoolFloorLocal(u, v, feet);
    }
  }
  return feet;
}

function center(s: Stair): [number, number] {
  return [(s.u0 + s.u1) / 2, (s.v0 + s.v1) / 2];
}

describe('niveles de la escuela', () => {
  it('cada nivel está una planta más arriba', () => {
    expect(LEVEL_Y[0]).toBe(FY);
    expect(LEVEL_Y[1] - LEVEL_Y[0]).toBeCloseTo(SCHOOL.storey);
    expect(LEVEL_Y[2] - LEVEL_Y[1]).toBeCloseTo(SCHOOL.storey);
    expect(levelOf(LEVEL_Y[0])).toBe(0);
    expect(levelOf(LEVEL_Y[1])).toBe(1);
    expect(levelOf(LEVEL_Y[2])).toBe(2);
    // A mitad de una escalera todavía se está en el nivel de abajo.
    expect(levelOf((LEVEL_Y[0] + LEVEL_Y[1]) / 2)).toBe(0);
  });

  it('los ambientes de un mismo nivel no se superponen', () => {
    for (const lv of [0, 1, 2] as const) {
      const rooms = ROOMS.filter((r) => roomLevel(r) === lv);
      for (let u = -2; u < 68; u += 0.7) {
        for (let v = -39; v < 0; v += 0.7) {
          let hits = 0;
          for (const r of rooms) {
            let inside = false;
            const p = r.poly;
            for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
              if (p[i][1] > v !== p[j][1] > v && u < ((p[j][0] - p[i][0]) * (v - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) {
                inside = !inside;
              }
            }
            if (inside) hits++;
          }
          expect(hits, `nivel ${lv} en ${u.toFixed(1)}, ${v.toFixed(1)}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('escaleras', () => {
  it('cada tramo sube de su altura de arranque a la de llegada', () => {
    for (const s of STAIRS) {
      const [uc, vc] = center(s);
      const low: [number, number] =
        s.dir === 'u+' ? [s.u0 + 0.01, vc] : s.dir === 'u-' ? [s.u1 - 0.01, vc] : s.dir === 'v+' ? [uc, s.v0 + 0.01] : [uc, s.v1 - 0.01];
      const high: [number, number] =
        s.dir === 'u+' ? [s.u1 - 0.01, vc] : s.dir === 'u-' ? [s.u0 + 0.01, vc] : s.dir === 'v+' ? [uc, s.v1 - 0.01] : [uc, s.v0 + 0.01];
      const a = stairY(s, low[0], low[1]);
      const b = stairY(s, high[0], high[1]);
      expect(a).toBeLessThan(b);
      expect(a).toBeGreaterThanOrEqual(FY + s.y0);
      expect(b).toBeLessThanOrEqual(FY + s.y1 + 1e-9);
      // A lo sumo medio escalón por debajo de cada extremo.
      expect(b).toBeGreaterThan(FY + s.y1 - 0.2);
    }
  });

  it('el costado de un tramo es macizo para quien está abajo', () => {
    // A mitad del primer tramo del hall (sube al norte contra el muro oeste)
    // los escalones están a la altura de la cadera.
    expect(schoolSolidLocal(33.5, -11.4, FY)).toBe(true);
    // Pero el arranque se pisa.
    expect(schoolSolidLocal(33.24, -9.0, FY)).toBe(false);
  });

  it('en el núcleo del bloque norte no hay escalera (CAD): baños, pozo y depósito', () => {
    // Donde estaba la escalera principal hay un baño de alumnos y el pozo de
    // luz cerrado; ningún tramo arranca en el bloque norte.
    expect(roomAt(24.0, -26.5)?.id).toBe('salaNorte');
    expect(roomAt(23.0, -27.9)).toBeNull();
    expect(STAIRS.some((s) => s.u0 < 26.76 && s.u1 > 19.5 && s.v0 < -23.25 && s.v1 > -30.4)).toBe(false);
  });

  it('el descanso del ala oeste termina contra el testero de la caja, no en el aire', () => {
    // Al oeste del descanso (2,2 m) estaba la cuña contra Miguel Cané, sin
    // muro: el que se caía quedaba encerrado en un rincón sin salida.
    const feet = FY + 2.2;
    expect(schoolFloorLocal(6.4, -11.7, feet)).toBeCloseTo(feet, 5);
    for (const v of [-9.0, -11.7, -12.6]) expect(schoolSolidLocal(5.3, v, feet), `v ${v}`).toBe(true);
    // La cuña, debajo de la Gerencia del primer piso, no es un ambiente.
    expect(roomAt(4.0, -11.7)).toBeNull();
    expect(roomAt(6.0, -11.7)?.id).toBe('hallOeste');
  });

  it('el paso de la torre a la pasarela es muro para quien está abajo', () => {
    // El vano arranca a la altura del descanso (2,45 m): desde el jardincito
    // se atravesaba la parte llena del muro y se entraba al cuartito.
    let blocked = false;
    for (let u = 36.3; u >= 34.5; u -= 0.05) if (schoolSolidLocal(u, -14.2, FY)) blocked = true;
    expect(blocked).toBe(true);
    expect(schoolSolidLocal(35.31, -14.2, FY, true)).toBe(true);
    // Desde el descanso sí se pasa (la caminata de la pasarela lo recorre entero).
    expect(schoolSolidLocal(35.31, -14.2, FY + 2.45)).toBe(false);
    // Del cuartito se sale por su puerta al hall.
    expect(climb([[34.6, -13.6], [34.6, -11.8]], FY)).toBeCloseTo(FY, 5);
  });

  it('la multitud no usa las escaleras que arrancan del suelo', () => {
    // Los tramos y descansos de los pisos altos pasan por encima: debajo se
    // camina (el arranque de la pasarela sobre el patio, por ejemplo).
    for (const s of STAIRS.filter((st) => st.y0 < 0.5)) {
      const [uc, vc] = center(s);
      expect(schoolSolidLocal(uc, vc, FY, true), `${uc}, ${vc}`).toBe(true);
    }
    for (const l of LANDINGS.filter((ld) => ld.y < 2 || !ld.hollow)) {
      expect(schoolSolidLocal((l.u0 + l.u1) / 2, (l.v0 + l.v1) / 2, FY, true)).toBe(true);
    }
  });
});

describe('plantas altas del recorrido', () => {
  it('"Acceso al Nivel Secundario": del hall al pasillo de los trofeos', () => {
    // Primer tramo al norte hasta el descanso de la torre, segundo tramo de
    // vuelta al sur (arranca dentro del descanso) y el pasillo este hasta la PR.
    const top = climb(
      [
        [33.24, -8.7],
        [33.24, -14.4],
        [34.7, -14.4],
        [34.7, -11.6],
        [34.0, -5.0],
      ],
      FY,
    );
    expect(levelOf(top)).toBe(1);
    expect(roomAt(34.0, -5.0, 1)?.id).toBe('pasilloTrofeos');
  });

  it('del descanso, por la pasarela vidriada, al edificio de bloque y al aula de danzas', () => {
    const l1 = climb(
      [
        [33.24, -8.7],
        [33.24, -14.2],
        [36.0, -14.2],
        [40.0, -14.2],
        [41.6, -14.2],
        [41.6, -15.3],
      ],
      FY,
    );
    expect(levelOf(l1)).toBe(1);
    const l2 = climb(
      [
        [41.6, -15.3],
        [44.6, -15.3],
        [48.2, -15.3],
        [48.2, -16.9],
        [44.6, -16.9],
        [43.2, -16.9],
        [43.2, -14.1],
        [45.6, -14.1],
        [45.6, -10.0],
      ],
      l1,
    );
    expect(levelOf(l2)).toBe(2);
    expect(roomAt(45.6, -10.0, 2)?.id).toBe('aulaDanzas');
  });

  it('"Acceso a primer piso": la escalera del ala oeste sube en U', () => {
    // Del pie del primer tramo (al oeste) al descanso, segundo tramo al este
    // hasta la cabecera, y por el ensanche del pasillo al pasillo de lockers.
    const top = climb(
      [
        [11.6, -11.7],
        [6.4, -11.7],
        [6.4, -9.5],
        [9.6, -9.5],
        [11.4, -9.5],
        [11.4, -7.4],
        [8.0, -7.4],
      ],
      FY,
    );
    expect(levelOf(top)).toBe(1);
    expect(roomAt(8.0, -7.4, 1)?.id).toBe('pasilloL1');
  });

  it('por la escalera exterior del patio este se sube al balcón y al aula nueva', () => {
    // Tramo corto al oeste, descanso de la esquina, tramo largo al norte
    // contra el bloque norte y, desde el balcón, la puerta del aula.
    const top = climb(
      [
        [35.6, -26.2],
        [33.25, -26.2],
        [33.25, -33.75],
        [35.0, -33.75],
      ],
      FY,
    );
    expect(levelOf(top)).toBe(1);
    expect(roomAt(35.0, -33.75, 1)?.id).toBe('aulaNE');
  });

  it('el jardín sube sus tres plantas', () => {
    const l1 = climb(
      [
        [58.4, -36.0],
        [58.4, -31.5],
        [59.8, -31.5],
        [59.8, -35.9],
      ],
      FY,
    );
    expect(levelOf(l1)).toBe(1);
    const l2 = climb(
      [
        [59.8, -35.9],
        [58.4, -35.9],
        [58.4, -31.5],
        [59.8, -31.5],
        [59.8, -35.9],
        [61.3, -35.9],
        [61.3, -33.0],
      ],
      l1,
    );
    expect(levelOf(l2)).toBe(2);
    expect(roomAt(61.3, -33.0, 2)?.id).toBe('sum');
  });

  it('por la escalera exterior blanca del patio este se llega al descanso de la torre', () => {
    const top = climb(
      [
        [33.55, -20.2],
        [33.55, -14.5],
      ],
      FY,
    );
    expect(top).toBeGreaterThan(FY + 2.3);
  });
});

