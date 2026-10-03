import { describe, it, expect } from 'vitest';
import { generateCityPlan, SIDEWALK_H } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';

const plan = generateCityPlan(42);
const index = new CityIndex(plan);

/**
 * Exige que la semilla de prueba contenga el tipo de manzana que el test
 * necesita, en vez de saltearse el test en silencio.
 *
 * Es una distincion que importa: un `if (!x) return` convierte un test en un
 * no-op cuando el generador cambia, y entonces la suite sigue en verde
 * mientras la cobertura real se evapora. Preferimos que falle ruidosamente.
 */
function require_<T>(value: T | undefined, kind: string): T {
  if (value === undefined) {
    throw new Error(
      `La semilla de prueba no contiene ninguna manzana de tipo "${kind}". ` +
        'Elegí otra semilla o revisá la distribución del generador.',
    );
  }
  return value;
}

describe('CityIndex.blockAt', () => {
  it('encuentra cada manzana en su propio centro', () => {
    for (const b of plan.blocks) {
      const hit = index.blockAt(b.cx, b.cz);
      expect(hit, `manzana ${b.gx},${b.gz}`).not.toBeNull();
      expect(hit!.gx).toBe(b.gx);
      expect(hit!.gz).toBe(b.gz);
    }
  });

  it('devuelve null en el medio de la calle', () => {
    // El eje de la calle entre dos manzanas: no pertenece a ninguna.
    const pitch = plan.blockSize + plan.streetWidth;
    const mid = pitch / 2;
    expect(index.blockAt(mid, 0)).toBeNull();
    expect(index.blockAt(0, mid)).toBeNull();
  });

  it('devuelve null fuera del terreno', () => {
    expect(index.blockAt(99999, 99999)).toBeNull();
    expect(index.blockAt(-99999, 0)).toBeNull();
  });

  it('el borde de la manzana pertenece a la manzana y un metro más allá no', () => {
    const b = plan.blocks.find((x) => x.ring === 2)!;
    const edge = b.width / 2;
    expect(index.blockAt(b.cx + edge - 0.1, b.cz)).not.toBeNull();
    expect(index.blockAt(b.cx + edge + 1, b.cz)).toBeNull();
  });
});

describe('CityIndex.isSolid', () => {
  it('fuera del terreno no camina nadie, pero el jugador puede volar', () => {
    // Sobre el eje de una calle de la ciudad de fondo: libre de edificios.
    const pitch = plan.blockSize + plan.streetWidth;
    const z = plan.extent + 30;
    expect(index.blockAt(pitch / 2, z)).toBeNull();
    expect(index.isPedestrianBlocked(pitch / 2, z)).toBe(true);
    expect(index.isSolid(pitch / 2, z)).toBe(false);
  });

  it('la calle nunca bloquea', () => {
    const pitch = plan.blockSize + plan.streetWidth;
    for (let i = -3; i <= 3; i++) {
      expect(index.isSolid(i * pitch + pitch / 2, 0)).toBe(false);
    }
  });

  it('la vivienda perimetral es maciza entera (el patio está cerrado) y la vereda no', () => {
    const res = require_(plan.blocks.find((b) => b.kind === 'residential'), 'residential');
    expect(res.barDepth).toBeGreaterThan(10);
    expect(index.isSolid(res.cx, res.cz - res.depth / 2 + 3)).toBe(true);
    // El patio no tiene pasaje en planta baja: macizo, para que ni el
    // teletransporte ni el aterrizaje desde el vuelo dejen a nadie encerrado.
    expect(index.isSolid(res.cx, res.cz)).toBe(true);
    expect(index.isPedestrianBlocked(res.cx, res.cz)).toBe(true);
    expect(index.isSolid(res.cx, res.cz - res.depth / 2 - 2)).toBe(false);
  });

  it('la torre bloquea exactamente su basamento', () => {
    const tower = require_(plan.blocks.find((b) => b.kind === 'tower'), 'tower');
    const half = (tower.footprint! * 1.65) / 2;
    expect(index.isSolid(tower.cx, tower.cz)).toBe(true);
    expect(index.isSolid(tower.cx + half - 0.1, tower.cz)).toBe(true);
    expect(index.isSolid(tower.cx + half + 0.4, tower.cz)).toBe(false);
    expect(index.isSolid(tower.cx + tower.width / 2 - 1, tower.cz + tower.depth / 2 - 1)).toBe(false);
  });

  it('el mercado es una nave abierta: se camina sobre la plataforma entre columnas y puestos', () => {
    const market = require_(plan.blocks.find((b) => b.kind === 'market'), 'market');
    const w = market.width * 0.8;
    const d = market.depth * 0.8;
    const bays = Math.max(4, Math.round(w / 6));
    // Una columna del pórtico es maciza.
    expect(index.isSolid(market.cx + (0.5 / bays - 0.5) * w, market.cz + d / 2)).toBe(true);
    // Los puestos son macizos.
    for (const s of market.stalls!) expect(index.isSolid(s.x, s.z)).toBe(true);
    // Hay lugar libre bajo la cubierta, y ahí el piso es la plataforma.
    let free = 0;
    for (let x = -w / 2 + 1; x < w / 2 - 1; x += 1) {
      for (let z = -d / 2 + 1; z < d / 2 - 1; z += 1) {
        if (!index.isSolid(market.cx + x, market.cz + z)) {
          free++;
          expect(index.groundHeight(market.cx + x, market.cz + z)).toBeCloseTo(0.25);
        }
      }
    }
    expect(free).toBeGreaterThan(600);
    // Fuera de la plataforma, el solado de la manzana a la cota de la vereda.
    expect(index.groundHeight(market.cx + w / 2 + 1, market.cz)).toBe(SIDEWALK_H);
  });
});

describe('CityIndex.groundHeight', () => {
  const pitch = plan.blockSize + plan.streetWidth;
  const laneHalf = plan.streetWidth * 0.21;

  it('las manzanas del barrio y sus veredas están a la cota de la vereda; la calzada, abajo', () => {
    const res = require_(plan.blocks.find((b) => b.kind === 'residential'), 'residential');
    expect(index.groundHeight(res.cx, res.cz)).toBe(SIDEWALK_H);
    for (const b of plan.blocks.filter((k) => !k.landmark)) {
      // Vereda: entre el borde de la manzana y el cordón, en los cuatro lados.
      const off = b.width / 2 + 2;
      for (const [dx, dz] of [
        [0, -off],
        [0, off],
        [-off, 0],
        [off, 0],
      ]) {
        expect(index.groundHeight(b.cx + dx, b.cz + dz), `manzana ${b.gx},${b.gz}`).toBe(SIDEWALK_H);
        expect(index.surfaceHeight(b.cx + dx, b.cz + dz)).toBe(SIDEWALK_H);
      }
      // Calzada (sobre el eje de la calle de al lado): cota de calle.
      expect(index.groundHeight(b.cx + pitch / 2, b.cz + 10)).toBe(0);
      expect(index.surfaceHeight(b.cx + pitch / 2, b.cz + 10)).toBeCloseTo(0.08);
    }
  });

  it('la vereda del lado de la escuela sigue a cota cero (la arma el frente de la escuela)', () => {
    const site = plan.schoolSite!;
    // Laprida, vereda norte, frente a la escuela.
    const z = site.z1 + 2;
    expect(index.blockAt(0, z)).toBeNull();
    expect(index.groundHeight(0, z)).toBe(0);
    expect(index.surfaceHeight(0, z)).toBe(0);
    // Y el cordón de enfrente sí es vereda elevada.
    const across = pitch / 2 + laneHalf + 0.32 + 1;
    expect(index.groundHeight(0, across)).toBe(SIDEWALK_H);
  });
});

describe('CityIndex — calles perimetrales y equipamiento de vereda', () => {
  const pitch = plan.blockSize + plan.streetWidth;

  it('las calles perimetrales se caminan de punta a punta', () => {
    for (const z of [-1.5 * pitch, 1.5 * pitch]) {
      for (let x = -2.5 * pitch; x <= 1.5 * pitch; x += 3) expect(index.isSolid(x, z), `(${x}, ${z})`).toBe(false);
    }
    for (const x of [-2.5 * pitch, 1.5 * pitch]) {
      for (let z = -1.5 * pitch; z <= 1.5 * pitch; z += 3) expect(index.isSolid(x, z), `(${x}, ${z})`).toBe(false);
    }
  });

  it('kiosco y refugios: macizos, sobre vereda elevada y fuera de la calzada', () => {
    expect(plan.props.length).toBeGreaterThanOrEqual(3);
    for (const p of plan.props) {
      const back = p.kind === 'kiosk' ? 0 : -0.55;
      expect(index.isSolid(p.x + p.nx * back, p.z + p.nz * back), p.kind).toBe(true);
      expect(index.groundHeight(p.x, p.z)).toBe(SIDEWALK_H);
      // Del lado de la calle queda vereda libre (bajo el techo del refugio se para).
      expect(index.isSolid(p.x + p.nx * 1.4, p.z + p.nz * 1.4)).toBe(false);
    }
  });
});

describe('CityIndex.describe', () => {
  it('produce números finitos y no negativos para todas las manzanas', () => {
    for (const b of plan.blocks) {
      const info = index.describe(b);
      for (const [k, v] of Object.entries({
        floors: info.floors,
        solarM2: info.solarM2,
        kwhDay: info.kwhDay,
        people: info.people,
      })) {
        expect(Number.isFinite(v), `${b.kind}.${k}`).toBe(true);
        expect(v, `${b.kind}.${k}`).toBeGreaterThanOrEqual(0);
      }
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.detail.length).toBeGreaterThan(0);
    }
  });

  it('los tipos abiertos no tienen plantas ni habitantes', () => {
    for (const b of plan.blocks) {
      if (b.kind === 'park' || b.kind === 'water') {
        const info = index.describe(b);
        expect(info.floors).toBe(0);
        expect(info.people).toBe(0);
      }
    }
  });

  it('la generación es coherente con la superficie de paneles', () => {
    // 1 m² ≈ 0,2 kW pico · 4,5 horas solares pico por día en Buenos Aires.
    for (const b of plan.blocks) {
      const i = index.describe(b);
      expect(i.kwhDay).toBe(Math.round(i.solarM2 * 0.2 * 4.5));
    }
  });
});

describe('CityIndex.totals', () => {
  it('los totales son la suma de las partes', () => {
    const t = index.totals();
    let kwh = 0;
    let people = 0;
    let solar = 0;
    for (const b of plan.blocks) {
      const i = index.describe(b);
      kwh += i.kwhDay;
      people += i.people;
      solar += i.solarM2;
    }
    expect(t.kwhDay).toBe(kwh);
    expect(t.people).toBe(people);
    expect(t.solarM2).toBe(solar);
    expect(t.blocks).toBe(plan.blocks.length);
  });

  it('el barrio da cifras de orden barrial plausibles', () => {
    const t = index.totals();
    // Diez manzanas y una torre alrededor de la escuela: miles de vecinos,
    // no decenas de miles.
    expect(t.people).toBeGreaterThan(500);
    expect(t.people).toBeLessThan(20000);
  });
});

describe('CityIndex — consistencia con otras semillas', () => {
  it('encuentra todas las manzanas con cualquier semilla', () => {
    for (const seed of [1, 7, 123, 2050]) {
      const p = generateCityPlan(seed);
      const idx = new CityIndex(p);
      for (const b of p.blocks) expect(idx.blockAt(b.cx, b.cz), `semilla ${seed}`).not.toBeNull();
    }
  });
});
