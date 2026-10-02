import { afterEach, describe, expect, it } from 'vitest';
import { LEVEL_Y, setDynamicSolid, type Level } from '../src/world/SchoolLayout';
import { resolveAnchor, roomById, roomCenter, standNear } from '../src/game/story/anchors';
import { DialogueRunner, StoryEngine } from '../src/game/story/StoryEngine';
import { EVAC_ROUTE, INTERACTABLES, LOCKS, PLACES, STAIR_GUIDES, interactable } from '../src/game/story/world';
import type { Effect, ObjectiveDef, Spot, ZoneId } from '../src/game/story/types';
import { createActivity } from '../src/game/activities';
import { seeded } from '../src/game/activities/types';
import { flood, reached, walk } from './gameReachKit';

/**
 * Alcance: lo que la historia pide se puede alcanzar CAMINANDO, con las
 * puertas que la historia todavía tiene cerradas, y lo que está cerrado de
 * verdad no se alcanza. Usa la misma colisión que el jugador.
 */

/** Portal sobre Laprida: donde empieza la historia. */
const PORTAL: readonly [number, number] = [37.4, 3.2];

function applyLocks(open: (z: ZoneId) => boolean): void {
  for (const l of LOCKS) setDynamicSolid(l.id, open(l.zone) ? null : l.rect);
}

afterEach(() => {
  for (const l of LOCKS) setDynamicSolid(l.id, null);
});

/** Celdas alcanzables por nivel desde el portal, subiendo por las escaleras abiertas. */
function reachable(open: (z: ZoneId) => boolean): Uint8Array[] {
  applyLocks(open);
  const grids: Uint8Array[] = [flood(0, PORTAL), new Uint8Array(0), new Uint8Array(0)];
  const merge = (level: Level, g: Uint8Array) => {
    if (grids[level].length === 0) grids[level] = g;
    else for (let i = 0; i < g.length; i++) if (g[i] === 1) grids[level][i] = 1;
  };
  // Hasta tres pasadas: una escalera del jardín sólo se alcanza después de subir otra.
  for (let pass = 0; pass < 3; pass++) {
    for (const s of STAIR_GUIDES) {
      if (s.zone && !open(s.zone)) continue;
      const low = grids[s.low.level];
      if (low.length === 0 || !reached(low, s.low.u, s.low.v)) continue;
      const feet = walk(s.path, LEVEL_Y[s.low.level]);
      if (feet === null || Math.abs(feet - LEVEL_Y[s.high.level]) > 0.1) continue;
      const hi = grids[s.high.level];
      if (hi.length > 0 && reached(hi, s.high.u, s.high.v)) continue;
      merge(s.high.level, flood(s.high.level, [s.high.u, s.high.v]));
    }
  }
  return grids;
}

const canReach = (grids: Uint8Array[], p: Spot) => grids[p.level].length > 0 && reached(grids[p.level], p.u, p.v, 0.35);

/** ¿Hay algún punto alcanzable a menos de `range` del lugar? (para hablar o usar algo alcanza con acercarse). */
function canReachNear(grids: Uint8Array[], p: Spot, range: number): boolean {
  const g = grids[p.level];
  if (g.length === 0) return false;
  for (let d = 0; d <= range; d += 0.1) {
    const n = Math.max(1, Math.round((Math.PI * 2 * d) / 0.1));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      if (reached(g, p.u + Math.cos(a) * d, p.v + Math.sin(a) * d, 0)) return true;
    }
  }
  return false;
}

/** Alcance para hablar con alguien (el mismo que usa el director). */
const TALK_RANGE = 2.6;

/** Dónde hay que llegar para cumplir un objetivo (centro y alcance), según el estado. */
function targetSpot(engine: StoryEngine, o: ObjectiveDef): (Spot & { range: number }) | null {
  const t = o.target;
  switch (t.kind) {
    case 'talk': {
      const st = engine.stationFor(t.npc);
      if (!st || st.follow) return null;
      return { ...standNear(resolveAnchor(st.at), { min: 0 }), range: TALK_RANGE };
    }
    case 'interact': {
      const def = interactable(t.id)!;
      return { ...resolveAnchor(def.anchor), range: def.range ?? 2.6 };
    }
    case 'spot':
      return { ...resolveAnchor(t.anchor), range: t.radius };
    case 'reach': {
      const place = PLACES.find((p) => p.id === t.place)!;
      const room = roomById(place.rooms[0]);
      if (!room) return null;
      const [u, v] = roomCenter(room);
      return { ...standNear({ u, v, level: room.level ?? 0, room: room.id }, { min: 0, prefer: null }), range: 0.5 };
    }
    case 'collect':
      return null;
  }
}

describe('alcance caminando', () => {
  it('las escaleras guía llevan de un piso al otro', () => {
    for (const s of STAIR_GUIDES) {
      const feet = walk(s.path, LEVEL_Y[s.low.level]);
      expect(feet, `${s.id}: bloqueada`).not.toBeNull();
      expect(feet!, s.id).toBeCloseTo(LEVEL_Y[s.high.level], 1);
    }
  });

  it('la ruta del simulacro se camina de punta a punta', () => {
    expect(walk(EVAC_ROUTE, LEVEL_Y[0]), 'ruta bloqueada').not.toBeNull();
  });

  it('antes de hablar con Rubén la escuela está cerrada; después, abierta', () => {
    const closed = reachable(() => false);
    expect(canReach(closed, { u: 37.45, v: -6, level: 0 }), 'hall alcanzable sin Rubén').toBe(false);
    const open = reachable((z) => z === 'entrada');
    expect(canReach(open, { u: 37.45, v: -6, level: 0 })).toBe(true);
    // Sin el primer piso abierto no se sube.
    expect(open[1].length === 0 || !reached(open[1], 34.95, -8.0)).toBe(true);
    const all = reachable(() => true);
    expect(canReach(all, { u: 34.95, v: -8.0, level: 1 }), 'pasillo de los trofeos').toBe(true);
    expect(canReach(all, { u: 47.0, v: -8.2, level: 2 }), 'aula de danzas').toBe(true);
    expect(canReach(all, { u: 63.5, v: -32.0, level: 2 }), 'SUM del jardín').toBe(true);
  });

  it('cada paso de la historia se alcanza con las zonas abiertas en ese momento', () => {
    const engine = new StoryEngine();
    const runAll = (effects: Effect[]) => {
      for (const e of engine.apply(effects)) {
        if (e.do !== 'activity') continue;
        const act = createActivity(e.id, seeded(3));
        for (let g = 0; g < 300 && !act.closed; g++) {
          for (const i of act.solve()) act.input(i);
          for (let k = 0; k < 20; k++) act.update(0.25);
        }
        engine.activityResult(e.id, act.success);
      }
    };
    const checked: string[] = [];
    for (let guard = 0; guard < 80 && !engine.finished; guard++) {
      const o = engine.mainObjectives()[0];
      const spot = targetSpot(engine, o);
      if (spot) {
        const grids = reachable((z) => engine.zone(z));
        expect(canReachNear(grids, spot, spot.range), `${o.id}: ${spot.u.toFixed(1)}, ${spot.v.toFixed(1)} (nivel ${spot.level}) inalcanzable`).toBe(true);
        checked.push(o.id);
      }
      if (o.target.kind === 'collect') {
        const grids = reachable((z) => engine.zone(z));
        for (const id of o.target.ids) {
          const def = interactable(id)!;
          expect(canReachNear(grids, resolveAnchor(def.anchor), def.range ?? 2.6), `${o.id}/${id} inalcanzable`).toBe(true);
          runAll(engine.interact(id));
        }
        continue;
      }
      // Cumplirlo, como en el test de la historia.
      const t = o.target;
      if (t.kind === 'talk') {
        const runner = new DialogueRunner(engine.dialogueFor(t.npc)!, engine);
        runAll(runner.start());
        while (!runner.done) runAll(runner.step(0));
      } else if (t.kind === 'interact') {
        runAll(engine.interact(t.id));
        const act = interactable(t.id)!.activity;
        if (act) runAll([{ do: 'activity', id: act }]);
      } else if (t.kind === 'reach') engine.enterPlace(t.place);
      else if (t.kind === 'spot') {
        const r = resolveAnchor(t.anchor);
        engine.atSpot(r.u, r.v, r.level);
      }
    }
    expect(engine.finished).toBe(true);
    expect(checked.length).toBeGreaterThan(12);
  });

  it('todos los objetos interactivos se alcanzan con la escuela abierta', () => {
    const grids = reachable(() => true);
    for (const i of INTERACTABLES) {
      const r = resolveAnchor(i.anchor);
      expect(canReachNear(grids, r, i.range ?? 2.6), `${i.id} en ${r.u.toFixed(1)}, ${r.v.toFixed(1)} nivel ${r.level}`).toBe(true);
    }
  });
});
