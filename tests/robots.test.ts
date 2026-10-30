import { describe, expect, it } from 'vitest';
import { LEVEL_Y, roomAt, schoolSolidLocal } from '../src/world/SchoolLayout';
import { ROBOTS, RobotAgent, ROBOT_RADIUS, type Obstacle } from '../src/world/robots/robotSim';

describe('robots de la Escuela 2050', () => {
  it('cada recorrido pasa libre de muros y muebles, con el robot entero y dentro de un ambiente', () => {
    const bad: string[] = [];
    for (const def of ROBOTS) {
      const r = ROBOT_RADIUS[def.kind] + 0.05;
      const pts = def.loop ? [...def.route, def.route[0]] : def.route;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [u0, v0] = pts[i];
        const [u1, v1] = pts[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.05));
        for (let k = 0; k <= n; k++) {
          const u = u0 + ((u1 - u0) * k) / n;
          const v = v0 + ((v1 - v0) * k) / n;
          if (!roomAt(u, v, def.level)) bad.push(`${def.id} fuera de un ambiente en ${u.toFixed(2)},${v.toFixed(2)}`);
          for (let a = 0; a < 16; a++) {
            const pu = u + Math.cos((a / 16) * Math.PI * 2) * r;
            const pv = v + Math.sin((a / 16) * Math.PI * 2) * r;
            if (schoolSolidLocal(pu, pv, LEVEL_Y[def.level] + 0.1)) {
              bad.push(`${def.id} choca en ${pu.toFixed(2)},${pv.toFixed(2)} (tramo ${i})`);
              break;
            }
          }
        }
      }
    }
    expect([...new Set(bad)].slice(0, 12)).toEqual([]);
  });

  it('recorre todos sus puntos sin salirse del camino ni dar NaN', () => {
    for (const def of ROBOTS) {
      const bot = new RobotAgent(def, 7);
      const seen = new Set<string>();
      let maxOff = 0;
      for (let t = 0; t < 400; t += 1 / 30) {
        bot.step(1 / 30, [], null);
        expect(Number.isFinite(bot.u) && Number.isFinite(bot.v) && Number.isFinite(bot.h)).toBe(true);
        for (const [u, v] of def.route) if (Math.hypot(bot.u - u, bot.v - v) < 0.05) seen.add(`${u},${v}`);
        maxOff = Math.max(maxOff, offRoute(def.route, def.loop, bot.u, bot.v));
      }
      expect(seen.size, def.id).toBe(def.route.length);
      expect(maxOff, def.id).toBeLessThan(0.06);
    }
  });

  it('frena antes de llegar a alguien parado en su camino y sigue cuando se corre', () => {
    const def = ROBOTS.find((d) => d.id === 'limpia-pb')!;
    const bot = new RobotAgent(def, 3);
    const [u0, v0] = def.route[0];
    const [u1] = def.route[1];
    const person: Obstacle = { u: u0 + 4, v: v0, level: def.level };
    for (let t = 0; t < 40; t += 1 / 30) bot.step(1 / 30, [person], null);
    expect(bot.u).toBeLessThan(person.u - ROBOT_RADIUS.cleaner - 0.4);
    expect(bot.speed).toBeLessThan(0.01);
    expect(bot.wary).toBe(true);
    for (let t = 0; t < 120; t += 1 / 30) bot.step(1 / 30, [], null);
    expect(bot.u).toBeGreaterThan(Math.min(person.u + 1, u1 - 1));
  });

  it('gira en el lugar: nunca avanza mientras está lejos del rumbo', () => {
    for (const def of ROBOTS) {
      const bot = new RobotAgent(def, 11);
      let pu = bot.u;
      let pv = bot.v;
      for (let t = 0; t < 200; t += 1 / 30) {
        bot.step(1 / 30, [], null);
        const moved = Math.hypot(bot.u - pu, bot.v - pv);
        if (moved > 1e-4) {
          const dir = Math.atan2(bot.v - pv, bot.u - pu);
          const off = Math.abs(Math.atan2(Math.sin(dir - bot.h), Math.cos(dir - bot.h)));
          expect(off, def.id).toBeLessThan(0.05);
        }
        pu = bot.u;
        pv = bot.v;
      }
    }
  });

  it('la cabeza del robot guía mira al jugador cercano, con un límite de giro', () => {
    const def = ROBOTS.find((d) => d.kind === 'guide')!;
    const bot = new RobotAgent(def, 5);
    const look: Obstacle = { u: bot.u, v: bot.v - 2, level: def.level };
    for (let t = 0; t < 1; t += 1 / 30) bot.step(1 / 30, [], look);
    expect(Math.abs(bot.head)).toBeGreaterThan(0.3);
    expect(Math.abs(bot.head)).toBeLessThanOrEqual(1.25 + 1e-6);
  });
});

function offRoute(route: readonly (readonly [number, number])[], loop: boolean, u: number, v: number): number {
  let best = Infinity;
  const n = loop ? route.length : route.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = route[i];
    const [bx, by] = route[(i + 1) % route.length];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(u - ax - dx * t, v - ay - dy * t));
  }
  return best;
}
