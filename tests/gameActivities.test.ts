import { describe, expect, it } from 'vitest';
import { ROBOT_CHOICES, ROBOT_LEVELS, RobotRoute, simulate } from '../src/game/activities/RobotRoute';
import { HealthyMenu, MENU_ROUNDS } from '../src/game/activities/HealthyMenu';
import { Recycling, WASTE } from '../src/game/activities/Recycling';
import { TRIVIA, Trivia } from '../src/game/activities/Trivia';
import { BEAT, DanceSequence, MOVES } from '../src/game/activities/DanceSequence';
import { Penalty, ZONES } from '../src/game/activities/Penalty';
import { seeded, type Activity } from '../src/game/activities/types';

/** Avanza el tiempo de una actividad en pasos chicos. */
function run(a: Activity, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) a.update(0.05);
}

/** Juega con las soluciones de la actividad hasta cerrarla. */
function solveAll(a: Activity): void {
  for (let g = 0; g < 300 && !a.closed; g++) {
    for (const i of a.solve()) a.input(i);
    run(a, 1);
  }
}

describe('robot Educabot', () => {
  it('las soluciones de cada pista llegan a la meta sin chocar', () => {
    for (const L of ROBOT_LEVELS) {
      const sim = simulate(L, L.solution);
      expect(sim.crashed).toBe(false);
      expect(sim.atGoal).toBe(true);
      expect(L.solution.length).toBeLessThanOrEqual(L.maxLen);
    }
  });

  it('choca contra un vaso y contra el borde de la pista', () => {
    const L = ROBOT_LEVELS[0];
    // De (0,4) mirando al norte: derecha y avanzar dos → (2,4); el vaso está en (2,3): girar a la izquierda y avanzar choca.
    expect(simulate(L, ['R', 'F', 'F', 'L', 'F']).crashed).toBe(true);
    expect(simulate(L, ['L', 'F']).crashed).toBe(true);
    expect(simulate(L, ['F']).atGoal).toBe(false);
  });

  it('se programa, se ejecuta paso a paso y pasa de pista', () => {
    const r = new RobotRoute();
    expect(r.view().choices[ROBOT_CHOICES.run].disabled).toBe(true);
    // Un programa equivocado: choca, el programa queda para corregir.
    r.input(ROBOT_CHOICES.L);
    r.input(ROBOT_CHOICES.F);
    r.input(ROBOT_CHOICES.run);
    expect(r.running).toBe(true);
    expect(r.view().busy).toBe(true);
    run(r, 3);
    expect(r.running).toBe(false);
    expect(r.program).toEqual(['L', 'F']);
    expect(r.view().feedback?.tone).toBe('bad');
    // Corregido: llega y pasa a la pista 2.
    for (const i of r.solve()) r.input(i);
    run(r, 6);
    expect(r.levelIndex).toBe(1);
    expect(r.program).toEqual([]);
    for (const i of r.solve()) r.input(i);
    run(r, 8);
    expect(r.finished).toBe(true);
    expect(r.success).toBe(true);
    // Al final el robot queda en la meta.
    const p = r.pose();
    expect([p.x, p.y]).toEqual([...ROBOT_LEVELS[1].goal]);
    r.input(0);
    expect(r.closed).toBe(true);
  });

  it('no acepta más órdenes que el máximo', () => {
    const r = new RobotRoute();
    for (let k = 0; k < 30; k++) r.input(ROBOT_CHOICES.F);
    expect(r.program.length).toBe(ROBOT_LEVELS[0].maxLen);
  });
});

describe('cantina, reciclaje y trivia', () => {
  it('la bandeja suma puntos y se puede rearmar', () => {
    const m = new HealthyMenu();
    for (let k = 0; k < MENU_ROUNDS.length; k++) {
      m.input(2); // lo menos equilibrado
      m.input(0); // siguiente
    }
    expect(m.finished).toBe(true);
    expect(m.score).toBeLessThan(m.maxScore / 2);
    m.input(1); // armar otra
    expect(m.finished).toBe(false);
    solveAll(m);
    expect(m.success).toBe(true);
    expect(m.score).toBe(m.maxScore);
  });

  it('cada residuo tiene su cesto y un error no deja avanzar', () => {
    const r = new Recycling();
    const first = WASTE[0];
    r.input((first.bin + 1) % 3);
    expect(r.index).toBe(0);
    expect(r.view().feedback?.tone).toBe('bad');
    solveAll(r);
    expect(r.success).toBe(true);
    expect(r.score).toBe(r.maxScore - 1);
  });

  it('la trivia sólo pregunta cosas con una respuesta válida y cuenta aciertos al primer intento', () => {
    for (const q of TRIVIA) {
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.options.length);
      expect(new Set(q.options).size).toBe(q.options.length);
    }
    const t = new Trivia();
    t.input((TRIVIA[0].answer + 1) % TRIVIA[0].options.length);
    solveAll(t);
    expect(t.success).toBe(true);
    expect(t.score).toBe(TRIVIA.length - 1);
  });
});

describe('danza y penales', () => {
  it('la profe muestra los pasos al ritmo y después se repiten', () => {
    const d = new DanceSequence(seeded(11));
    const shown: number[] = [];
    for (let t = 0; t < BEAT * 6; t += 0.05) {
      d.update(0.05);
      for (const e of d.drainEvents()) if (e.type === 'demo') shown.push(e.move);
    }
    expect(shown).toEqual(d.seq.slice(0, 3));
    expect(d.phase).toBe('input');
    // Nunca dos pasos iguales seguidos.
    for (let k = 1; k < d.seq.length; k++) expect(d.seq[k]).not.toBe(d.seq[k - 1]);
    // Un error vuelve a mostrar la misma ronda.
    d.input((d.seq[0] + 1) % MOVES.length);
    expect(d.round).toBe(0);
    expect(d.phase).not.toBe('input');
    solveAll(d);
    expect(d.success).toBe(true);
    expect(d.seq.length).toBe(5);
  });

  it('tres lanzamientos, la pelota vuela y el sello se gana igual', () => {
    const p = new Penalty(seeded(5));
    p.input(0);
    expect(p.shot()?.zone).toBe(0);
    expect(p.view().busy).toBe(true);
    // Mientras vuela no se puede volver a lanzar.
    p.input(1);
    expect(p.results.length).toBe(0);
    run(p, 3);
    expect(p.results.length).toBe(1);
    solveAll(p);
    expect(p.results.length).toBe(3);
    expect(p.success).toBe(true);
    expect(ZONES.length).toBe(5);
  });

  it('la arquera ataja algunos y deja pasar otros (con semilla, siempre igual)', () => {
    const outcomes = (seed: number) => {
      const p = new Penalty(seeded(seed));
      solveAll(p);
      return p.results.join(',');
    };
    expect(outcomes(9)).toBe(outcomes(9));
    const all = new Set<string>();
    for (let s = 1; s < 30; s++) all.add(outcomes(s));
    expect(all.size).toBeGreaterThan(1);
  });
});
