import { describe, it, expect } from 'vitest';
import {
  AMBIENT_EVENTS,
  BED_LAYERS,
  PHASE_FACTORS,
  STEP_RECIPES,
  ZONES,
  ZONE_RECIPES,
  approachWeights,
  defaultSurface,
  dominantZone,
  eventRates,
  fireProbability,
  initialWeights,
  mixBeds,
  mixCutoffs,
  mixScalar,
  spatialize,
  stepParams,
  surfaceForFloor,
  type ZoneWeights,
} from '../src/audio/mix';
import { seeded } from '../src/audio/speech';
import type { Surface } from '../src/game/contracts';

const sum = (w: ZoneWeights): number => ZONES.reduce((s, z) => s + w[z], 0);

describe('cruce entre zonas', () => {
  it('los pesos siguen sumando 1 y convergen a la zona nueva', () => {
    const w = initialWeights('street');
    for (let i = 0; i < 50; i++) {
      approachWeights(w, i < 20 ? 'patio' : 'corridor', 0.2, 1.1);
      expect(sum(w)).toBeCloseTo(1, 9);
    }
    expect(w.corridor).toBeGreaterThan(0.99);
    expect(dominantZone(w)).toBe('corridor');
  });

  it('es suave: medio segundo después todavía se oye la zona anterior', () => {
    const w = approachWeights(initialWeights('patio'), 'classroom', 0.5, 1.1);
    expect(w.patio).toBeGreaterThan(0.5);
    expect(w.classroom).toBeGreaterThan(0.3);
  });

  it('tau 0 o dt grande saltan directo', () => {
    expect(approachWeights(initialWeights('patio'), 'gym', 0.1, 0).gym).toBe(1);
  });

  it('mezcla por potencia: una capa igual en las dos zonas no se hunde a mitad de camino', () => {
    const w = initialWeights('corridor');
    w.corridor = 0.5;
    w.stair = 0.5;
    // "room" vale 0,05 en las dos: la potencia se conserva.
    expect(mixBeds(w, 'clase').room).toBeCloseTo(0.05, 6);
    // "lights" vale 0,022 y 0,015: el resultado está entre ambos, más cerca del mayor que el promedio lineal.
    const l = mixBeds(w, 'clase').lights;
    expect(l).toBeGreaterThan((0.022 + 0.015) / 2);
    expect(l).toBeLessThan(0.022);
  });

  it('una zona pura suena como su receta', () => {
    const g = mixBeds(initialWeights('street'), 'clase');
    expect(g.traffic).toBeCloseTo(0.3, 6);
    expect(g.fridge).toBe(0);
    for (const layer of BED_LAYERS) expect(Number.isFinite(g[layer])).toBe(true);
  });
});

describe('momento del día', () => {
  it('el recreo llena el patio y la clase llena el aula', () => {
    const patio = initialWeights('patio');
    expect(mixBeds(patio, 'recreo').kids).toBeGreaterThan(mixBeds(patio, 'clase').kids * 5);
    const aula = initialWeights('classroom');
    expect(mixBeds(aula, 'clase').class).toBeGreaterThan(mixBeds(aula, 'recreo').class * 5);
  });

  it('el acto tiene aplausos y murmullo; ningún otro momento aplaude', () => {
    const patio = initialWeights('patio');
    expect(eventRates(patio, 'acto').applause).toBeGreaterThan(0);
    for (const ph of ['entrada', 'clase', 'recreo', 'salida'] as const)
      expect(eventRates(patio, ph).applause).toBe(0);
    expect(mixBeds(patio, 'acto').crowd).toBeGreaterThan(mixBeds(patio, 'clase').crowd);
  });

  it('las risas del patio dependen del recreo; la calle no tiene sillas', () => {
    expect(eventRates(initialWeights('patio'), 'recreo').laugh).toBeGreaterThan(
      eventRates(initialWeights('patio'), 'clase').laugh,
    );
    expect(eventRates(initialWeights('street'), 'clase').chair).toBe(0);
    expect(eventRates(initialWeights('classroom'), 'clase').car).toBe(0);
  });

  it('la densidad escala todo', () => {
    const w = initialWeights('gym');
    const a = eventRates(w, 'recreo', 1);
    const b = eventRates(w, 'recreo', 0.5);
    for (const k of AMBIENT_EVENTS) expect(b[k]).toBeCloseTo(a[k] * 0.5, 9);
  });

  it('todas las fases y zonas están definidas', () => {
    for (const z of ZONES) expect(ZONE_RECIPES[z]).toBeDefined();
    for (const ph of Object.keys(PHASE_FACTORS))
      expect(PHASE_FACTORS[ph as keyof typeof PHASE_FACTORS].always).toBe(1);
  });
});

describe('cortes y envíos', () => {
  it('las voces de otro ambiente llegan apagadas', () => {
    expect(mixCutoffs(initialWeights('patio')).kids).toBeCloseTo(9000, 3);
    expect(mixCutoffs(initialWeights('classroom')).kids).toBeLessThan(2000);
  });

  it('la interpolación de cortes es logarítmica', () => {
    const w = initialWeights('patio');
    w.patio = 0.5;
    w.classroom = 0.5;
    expect(mixCutoffs(w).kids).toBeCloseTo(Math.sqrt(9000 * 1300), 3);
  });

  it('el gimnasio reverbera más que el aula y la escalera tiene eco', () => {
    expect(mixScalar(initialWeights('gym'), 'reverb')).toBeGreaterThan(
      mixScalar(initialWeights('classroom'), 'reverb'),
    );
    expect(mixScalar(initialWeights('stair'), 'echo')).toBeGreaterThan(0.1);
    expect(mixScalar(initialWeights('quiet'), 'clock')).toBe(1);
    expect(mixScalar(initialWeights('patio'), 'clock')).toBe(0);
  });

  it('probabilidad de disparo', () => {
    expect(fireProbability(0, 1)).toBe(0);
    expect(fireProbability(60, 0)).toBe(0);
    expect(fireProbability(60, 1)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(fireProbability(1e6, 1)).toBeLessThanOrEqual(1);
  });
});

describe('audio posicional', () => {
  const at = (x: number, y: number, z: number) => ({ x, y, z });
  const L = at(0, 1.7, 0);
  const fwd = { x: 0, z: 1 };

  it('derecha e izquierda según la mirada (Babylon es zurdo: mirando a +z, +x es la derecha)', () => {
    expect(spatialize(L, fwd, at(10, 1.7, 0)).pan).toBeGreaterThan(0.5);
    expect(spatialize(L, fwd, at(-10, 1.7, 0)).pan).toBeLessThan(-0.5);
    expect(Math.abs(spatialize(L, fwd, at(0, 1.7, 10)).pan)).toBeLessThan(1e-9);
    // Girando la cabeza hacia +x, lo que estaba a la derecha queda adelante.
    expect(Math.abs(spatialize(L, { x: 1, z: 0 }, at(10, 1.7, 0)).pan)).toBeLessThan(1e-9);
    expect(spatialize(L, { x: 1, z: 0 }, at(0, 1.7, -10)).pan).toBeGreaterThan(0.5);
  });

  it('sin dirección no hay paneo', () => {
    expect(spatialize(L, null, at(10, 1.7, 0)).pan).toBe(0);
  });

  it('atenuación por distancia, pleno cerca, nada fuera de alcance', () => {
    expect(spatialize(L, fwd, at(1, 1.7, 1)).gain).toBe(1);
    const g10 = spatialize(L, fwd, at(10, 1.7, 0)).gain;
    const g30 = spatialize(L, fwd, at(30, 1.7, 0)).gain;
    expect(g10).toBeGreaterThan(g30);
    expect(spatialize(L, fwd, at(200, 1.7, 0)).gain).toBe(0);
    expect(spatialize(L, fwd, at(200, 1.7, 0), { max: 300 }).gain).toBeGreaterThan(0);
  });

  it('otro piso: más bajo y más opaco', () => {
    const same = spatialize(L, fwd, at(5, 1.7, 5));
    const up = spatialize(L, fwd, at(5, 5.0, 5));
    expect(up.gain).toBeLessThan(same.gain * 0.6);
    expect(up.cutoff).toBeLessThan(1500);
  });

  it('lo que está detrás suena un poco más opaco', () => {
    expect(spatialize(L, fwd, at(0, 1.7, -10)).cutoff).toBeLessThan(
      spatialize(L, fwd, at(0, 1.7, 10)).cutoff,
    );
  });
});

describe('pasos', () => {
  const surfaces = Object.keys(STEP_RECIPES) as Surface[];

  it('todas las superficies dan parámetros finitos', () => {
    const rnd = seeded(1);
    for (const s of surfaces) {
      for (const running of [false, true]) {
        const p = stepParams(s, running, rnd);
        for (const v of [p.hit.freq, p.hit.decay, p.hit.gain])
          expect(Number.isFinite(v) && v > 0).toBe(true);
      }
    }
  });

  it('cada superficie con su carácter', () => {
    const rnd = seeded(2);
    expect(stepParams('metal', false, rnd).ring).not.toBeNull();
    expect(stepParams('grass', false, rnd).grit).not.toBeNull();
    expect(stepParams('tile', false, rnd).ring).toBeNull();
    expect(stepParams('carpet', false, rnd).hit.type).toBe('lowpass');
    expect(stepParams('wood', false, rnd).thump!.gain).toBeGreaterThan(
      stepParams('tile', false, rnd).thump!.gain,
    );
  });

  it('corriendo: más fuerte y sin apoyo de punta separado', () => {
    const a = seeded(3);
    let walk = 0;
    let run = 0;
    for (let i = 0; i < 50; i++) {
      walk += stepParams('tile', false, a).hit.gain;
      const r = stepParams('tile', true, a);
      run += r.hit.gain;
      expect(r.toe).toBeNull();
    }
    expect(run).toBeGreaterThan(walk * 1.3);
    expect(stepParams('tile', false, seeded(9)).toe).not.toBeNull();
  });

  it('dos pasos seguidos nunca son idénticos', () => {
    const rnd = seeded(5);
    expect(stepParams('concrete', false, rnd)).not.toEqual(stepParams('concrete', false, rnd));
  });

  it('pisos del plano → superficies', () => {
    expect(surfaceForFloor('tile')).toBe('tile');
    expect(surfaceForFloor('ceramic')).toBe('tile');
    expect(surfaceForFloor('checker')).toBe('tile');
    expect(surfaceForFloor('terracotta')).toBe('tile');
    expect(surfaceForFloor('hallStone')).toBe('tile');
    expect(surfaceForFloor('wood')).toBe('wood');
    expect(surfaceForFloor('dance')).toBe('wood');
    expect(surfaceForFloor('rubber')).toBe('rubber');
    expect(surfaceForFloor('green')).toBe('rubber');
    expect(surfaceForFloor('gym')).toBe('concrete');
    expect(surfaceForFloor('patio')).toBe('concrete');
    expect(surfaceForFloor(undefined)).toBe('concrete');
    expect(defaultSurface('street')).toBe('concrete');
    expect(defaultSurface('classroom')).toBe('tile');
  });
});
