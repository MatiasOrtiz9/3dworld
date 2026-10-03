import { describe, it, expect } from 'vitest';
import { generateCityPlan, KERB_W, LANE_FRAC } from '../src/world/CityLayout';

const SEEDS = [1, 7, 42, 99, 123, 2050, 31337];

/**
 * El barrio de la escuela: la escuela en el centro y UNA hilera de manzanas
 * con los edificios de la ciudad 2050 del otro lado de cada calle que la
 * rodea, con una torre en la esquina noreste. Nada más.
 */
describe('barrio de la escuela', () => {
  it('la escuela ocupa las dos manzanas centrales, sin la calle intermedia', () => {
    for (const seed of SEEDS) {
      const plan = generateCityPlan(seed);
      const school = plan.blocks.find((b) => b.landmark === 'school')!;
      const annex = plan.blocks.find((b) => b.landmark === 'schoolAnnex')!;
      expect(school.cx).toBe(0);
      expect(school.cz).toBe(0);
      expect(annex.gx).toBe(school.gx - 1);
      const gap = plan.streets.find((s) => s.axis === 'z' && Math.abs(s.at + (plan.blockSize + plan.streetWidth) / 2) < 1e-6);
      expect(gap?.gaps).toContainEqual([plan.schoolSite!.z0, plan.schoolSite!.z1]);
    }
  });

  it('alrededor hay una sola hilera de edificios de la ciudad, sin casas', () => {
    for (const seed of SEEDS) {
      const plan = generateCityPlan(seed);
      const others = plan.blocks.filter((b) => !b.landmark);
      expect(others).toHaveLength(10);
      for (const b of others) {
        expect(['residential', 'civic', 'market', 'tower']).toContain(b.kind);
        // Pegadas al predio: a lo sumo una manzana de distancia.
        expect(b.ring).toBeLessThanOrEqual(2);
        expect(b.gz).toBeGreaterThanOrEqual(1);
        expect(b.gz).toBeLessThanOrEqual(3);
      }
      // Vivienda enfrente del portal (al sur de Laprida).
      expect(others.find((b) => b.gx === 2 && b.gz === 3)?.kind).toBe('residential');
    }
  });

  it('una sola torre, en la esquina sureste, y es lo más alto del barrio', () => {
    for (const seed of SEEDS) {
      const plan = generateCityPlan(seed);
      const towers = plan.blocks.filter((b) => b.kind === 'tower');
      expect(towers).toHaveLength(1);
      const t = towers[0];
      // Sureste: este es −x y sur es +z (cruzando Laprida). Nada alto al
      // norte, detrás de la escuela: aparecería detrás del portal.
      expect(t.cx).toBeLessThan(plan.schoolSite!.x0);
      expect(t.cz).toBeGreaterThan(plan.schoolSite!.z1);
      for (const b of plan.blocks.filter((k) => k.cz < plan.schoolSite!.z0)) expect(b.height).toBeLessThanOrEqual(23);
      for (const b of plan.blocks) if (b !== t) expect(b.height).toBeLessThan(t.height / 2);
      // La vivienda no aplasta a la escuela de dos plantas.
      for (const b of plan.blocks.filter((k) => k.kind === 'residential')) expect(b.height).toBeLessThanOrEqual(23);
    }
  });

  it('sin canal, tranvías ni avenidas: las cuatro calles de la escuela con su nombre', () => {
    const plan = generateCityPlan(42);
    expect(plan.canal.halfWidth).toBe(0);
    expect(plan.streets.every((s) => !s.tram)).toBe(true);
    const names = plan.streets.map((s) => s.name).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(['Laprida', 'Lafinur', 'Gral. Acha']));
    // Laprida corre al sur de la escuela (z > 0) y Lafinur al norte.
    expect(plan.streets.find((s) => s.name === 'Laprida')!.at).toBeGreaterThan(0);
    expect(plan.streets.find((s) => s.name === 'Lafinur')!.at).toBeLessThan(0);
  });

  it('las medidas de cada edificio son datos del plano (iguales en escritorio y VR)', () => {
    for (const seed of SEEDS) {
      const plan = generateCityPlan(seed);
      for (const b of plan.blocks) {
        if (b.kind === 'tower') expect(b.footprint).toBeGreaterThanOrEqual(17);
        if (b.kind === 'residential') expect(b.barDepth).toBeGreaterThanOrEqual(11);
        if (b.kind === 'market') {
          expect(b.stalls!.length).toBeGreaterThanOrEqual(4);
          // Puestos sobre la plataforma y sin pisarse.
          for (const s of b.stalls!) {
            expect(Math.abs(s.x - b.cx) + s.w / 2).toBeLessThan(b.width * 0.4);
            expect(Math.abs(s.z - b.cz) + s.d / 2).toBeLessThan(b.depth * 0.4);
          }
          for (const [i, s] of b.stalls!.entries()) {
            for (const o of b.stalls!.slice(i + 1)) {
              const apart = Math.abs(o.x - s.x) >= (o.w + s.w) / 2 + 1.6 || Math.abs(o.z - s.z) >= (o.d + s.d) / 2 + 1.6;
              expect(apart).toBe(true);
            }
          }
        }
      }
    }
  });

  it('calles perimetrales: la hilera tiene calle también del lado de afuera', () => {
    const plan = generateCityPlan(42);
    const pitch = plan.blockSize + plan.streetWidth;
    const has = (axis: 'x' | 'z', at: number) => plan.streets.some((s) => s.axis === axis && Math.abs(s.at - at) < 1e-6);
    expect(has('x', -1.5 * pitch)).toBe(true);
    expect(has('x', 1.5 * pitch)).toBe(true);
    expect(has('z', -2.5 * pitch)).toBe(true);
    expect(has('z', 1.5 * pitch)).toBe(true);
  });

  it('la ciudad sigue más allá del barrio, sin invadirlo ni tapar la escuela', () => {
    for (const seed of SEEDS) {
      const plan = generateCityPlan(seed);
      const pitch = plan.blockSize + plan.streetWidth;
      const { masses, blocks, streets } = plan.backdrop;
      expect(blocks).toHaveLength(18);
      expect(masses.length).toBeGreaterThan(150);
      expect(streets.length).toBeGreaterThan(8);
      const tower = plan.blocks.find((b) => b.kind === 'tower')!;
      for (const m of masses) {
        // Fuera del barrio (calles perimetrales incluidas).
        const inside = Math.abs(m.x + pitch / 2) < 2 * pitch + m.w / 2 && Math.abs(m.z) < 1.5 * pitch + m.d / 2;
        expect(inside, `volumen en (${m.x.toFixed(0)}, ${m.z.toFixed(0)})`).toBe(false);
        expect(m.h).toBeGreaterThan(5);
        // Nada del fondo compite con la torre del barrio.
        expect(m.h).toBeLessThan(tower.height + 5);
        // Al norte, detrás de la escuela, la ciudad es baja: no asoma tras el portal.
        if (m.z < -1.5 * pitch) expect(m.h).toBeLessThanOrEqual(40);
      }
    }
  });

  it('bancos: sobre la vereda, mirando a la calle, lejos de farolas y paradas', () => {
    for (const seed of SEEDS) {
      const plan = generateCityPlan(seed);
      const pitch = plan.blockSize + plan.streetWidth;
      // Cara interior del cordón, desde el centro de la manzana.
      const kerb = pitch / 2 - (plan.streetWidth * LANE_FRAC) / 2 - KERB_W;
      const walk = plan.benches.filter((b) => b.kind === 'sidewalk');
      expect(walk.length).toBeGreaterThan(10);
      expect(plan.benches.filter((b) => b.kind === 'stop')).toHaveLength(4);
      for (const b of plan.benches) {
        const block = plan.blocks.find((k) => Math.abs(b.x - k.cx) < pitch / 2 && Math.abs(b.z - k.cz) < pitch / 2)!;
        expect(block, `banco en (${b.x}, ${b.z})`).toBeDefined();
        const dx = b.x - block.cx;
        const dz = b.z - block.cz;
        // Dentro de la vereda (o de la explanada), nunca en la calzada.
        expect(Math.max(Math.abs(dx), Math.abs(dz))).toBeLessThan(kerb - 0.4);
        if (b.kind !== 'sidewalk') continue;
        // Mira hacia afuera de la manzana: (sin, cos) apunta a la calle.
        expect(Math.sin(b.rotY) * dx + Math.cos(b.rotY) * dz).toBeGreaterThan(20);
        // A más de 1 m de las farolas (±9 m del medio de la cuadra).
        const along = Math.abs(dx) > Math.abs(dz) ? dz : dx;
        expect(Math.abs(Math.abs(along) - 9)).toBeGreaterThan(1.9);
        for (const p of plan.props) expect(Math.abs(p.x - b.x) < 5 && Math.abs(p.z - b.z) < 5).toBe(false);
      }
    }
  });

  it('es determinista', () => {
    expect(JSON.stringify(generateCityPlan(77))).toBe(JSON.stringify(generateCityPlan(77)));
  });

  it('las mesitas de café arrancan vacías: las publica la ciudad al levantar los locales', () => {
    // La gente de la vereda las lee del plano (Sidewalks): el campo tiene que
    // existir aunque el plano se use sin construir la ciudad.
    for (const seed of SEEDS) expect(generateCityPlan(seed).cafeTables).toEqual([]);
  });
});
