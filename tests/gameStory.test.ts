import { describe, expect, it } from 'vitest';
import { LEVEL_Y, ROOMS, setDynamicSolid, schoolSolidLocal } from '../src/world/SchoolLayout';
import { resolveAnchor, roomIdAt, standNear, standable } from '../src/game/story/anchors';
import { CHARACTERS } from '../src/game/story/characters';
import { DIALOGUES, TALK, dialogue } from '../src/game/story/dialogues';
import { ACTIVITY_REWARDS, OBJECTIVES, RULES, objective } from '../src/game/story/objectives';
import { DialogueRunner, StoryEngine } from '../src/game/story/StoryEngine';
import type { Effect, ObjectiveDef } from '../src/game/story/types';
import { INTERACTABLES, LOCKS, PLACES, interactable, outsideRoom } from '../src/game/story/world';
import { createActivity } from '../src/game/activities';
import { seeded } from '../src/game/activities/types';

/**
 * Integridad de la historia: todo lo que la historia nombra existe, cada
 * personaje y cada objeto están en el ambiente que dicen, y la historia se
 * puede jugar de punta a punta sin callejones sin salida.
 */

const ROOM_IDS = new Set(ROOMS.map((r) => r.id));
const NPC_IDS = new Set(CHARACTERS.map((c) => c.id));
const ZONE_IDS = new Set(['entrada', 'primerPiso', 'segundoPiso', 'jardin']);

function effectsOf(): Array<[string, Effect]> {
  const out: Array<[string, Effect]> = [];
  for (const d of DIALOGUES) {
    for (const nd of d.nodes) {
      for (const e of nd.effects ?? []) out.push([`${d.id}/${nd.id}`, e]);
      for (const c of nd.choices ?? []) for (const e of c.effects ?? []) out.push([`${d.id}/${nd.id}*`, e]);
    }
  }
  for (const o of OBJECTIVES) for (const e of o.onComplete ?? []) out.push([o.id, e]);
  for (const r of RULES) for (const e of r.effects) out.push([r.id, e]);
  for (const i of INTERACTABLES) for (const e of i.effects ?? []) out.push([i.id, e]);
  return out;
}

describe('datos de la historia', () => {
  it('los objetivos apuntan a personajes, objetos y lugares que existen', () => {
    const ids = new Set<string>();
    for (const o of OBJECTIVES) {
      expect(ids.has(o.id), `objetivo repetido ${o.id}`).toBe(false);
      ids.add(o.id);
      for (const r of o.requires ?? []) expect(objective(r), `${o.id} pide ${r}`).toBeDefined();
      const t = o.target;
      if (t.kind === 'talk') expect(NPC_IDS.has(t.npc), `${o.id}: ${t.npc}`).toBe(true);
      if (t.kind === 'interact') expect(interactable(t.id), `${o.id}: ${t.id}`).toBeDefined();
      if (t.kind === 'reach') expect(PLACES.some((p) => p.id === t.place), `${o.id}: ${t.place}`).toBe(true);
      if (t.kind === 'collect') {
        for (const id of t.ids) expect(id.startsWith('voz:') || interactable(id) !== undefined, `${o.id}: ${id}`).toBe(true);
      }
    }
  });

  it('los efectos nombran objetivos, zonas y actividades válidas', () => {
    for (const [where, e] of effectsOf()) {
      if (e.do === 'complete') expect(objective(e.id), `${where}: ${e.id}`).toBeDefined();
      if (e.do === 'unlock') expect(ZONE_IDS.has(e.zone), `${where}: ${e.zone}`).toBe(true);
      if (e.do === 'activity') expect(ACTIVITY_REWARDS[e.id], `${where}: ${e.id}`).toBeDefined();
      if (e.do === 'bark') expect(NPC_IDS.has(e.who), `${where}: ${e.who}`).toBe(true);
    }
  });

  it('cada diálogo se puede recorrer: los saltos existen y hablan personajes reales', () => {
    for (const d of DIALOGUES) {
      const ids = new Set(d.nodes.map((nd) => nd.id));
      expect(ids.size, `${d.id}: ids repetidos`).toBe(d.nodes.length);
      for (const nd of d.nodes) {
        expect(NPC_IDS.has(nd.who) || nd.who === 'player' || nd.who === 'narrator', `${d.id}/${nd.id}: ${nd.who}`).toBe(true);
        expect(nd.text.length, `${d.id}/${nd.id} sin texto`).toBeGreaterThan(0);
        const jumps = [nd.next, ...(nd.choices ?? []).map((c) => c.next)].filter((x): x is string => x !== undefined);
        for (const j of jumps) expect(j === '$end' || ids.has(j), `${d.id}/${nd.id} → ${j}`).toBe(true);
      }
    }
    for (const [npc, rules] of Object.entries(TALK)) {
      expect(NPC_IDS.has(npc)).toBe(true);
      for (const r of rules) expect(dialogue(r.dialogue), `${npc}: ${r.dialogue}`).toBeDefined();
    }
  });

  it('los lugares de la libreta usan ambientes del plano', () => {
    for (const p of PLACES) {
      for (const r of p.rooms) expect(r.startsWith('__') || ROOM_IDS.has(r), `${p.id}: ${r}`).toBe(true);
    }
  });

  it('cada personaje está, en cada momento, dentro de su ambiente y parado en piso libre', () => {
    for (const c of CHARACTERS) {
      for (const st of c.stations) {
        const r = resolveAnchor(st.at);
        expect(r.missing, `${c.id}: ancla sin resolver (${JSON.stringify(st.at)})`).toBeFalsy();
        const s = standNear(r, { min: 0 });
        expect(s.ok, `${c.id}: sin lugar libre cerca de ${JSON.stringify(st.at)}`).toBe(true);
        const room = r.room === '' ? outsideRoom(s.u, s.v) || roomIdAt(s.u, s.v, s.level) : roomIdAt(s.u, s.v, s.level);
        if (r.room === '') expect(roomIdAt(s.u, s.v, s.level), `${c.id} debería estar afuera`).toBe('');
        else expect(room, `${c.id} en ${s.u.toFixed(2)}, ${s.v.toFixed(2)}`).toBe(r.room);
        expect(standable(s.u, s.v, s.level)).toBe(true);
      }
    }
  });

  it('cada objeto interactivo está en su ambiente y tiene dónde pararse', () => {
    for (const i of INTERACTABLES) {
      const r = resolveAnchor(i.anchor);
      expect(r.missing, `${i.id}: ancla sin resolver`).toBeFalsy();
      if (r.room !== '') expect(ROOM_IDS.has(r.room), `${i.id}: ${r.room}`).toBe(true);
      const s = standNear(r);
      expect(s.ok, `${i.id}: sin lugar de pie`).toBe(true);
      expect(Math.hypot(s.u - r.u, s.v - r.v), `${i.id}: lugar de pie fuera de alcance`).toBeLessThanOrEqual(i.range ?? 2.6);
    }
  });

  it('las cerraduras existen y cierran su paso sólo mientras están puestas', () => {
    const ids = LOCKS.map((l) => l.id);
    for (const id of [
      'lock-blanca',
      'lock-chapa',
      'lock-entrada',
      'lock-exterior',
      'lock-hall',
      'lock-jardin',
      'lock-jardinCalle1',
      'lock-norte',
      'lock-oeste',
      'lock-puertaGimnasio',
      'lock-salidaGimnasio',
      'lock-salidaNorte',
      'lock-salidaOchavo',
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LOCKS) {
      const mu = (l.a[0] + l.b[0]) / 2;
      const mv = (l.a[1] + l.b[1]) / 2;
      const feet = LEVEL_Y[l.rect.level];
      setDynamicSolid(l.id, l.rect);
      expect(schoolSolidLocal(mu, mv, feet), `${l.id} cerrada`).toBe(true);
      setDynamicSolid(l.id, null);
    }
  });
});

// ======================================================================= jugar

/** Juega una actividad hasta el final con sus propias soluciones. */
function playActivity(id: Parameters<typeof createActivity>[0], fumble = false): { success: boolean; perfect: boolean } {
  const act = createActivity(id, seeded(7));
  let guard = 0;
  // Con `fumble`, antes de resolver se equivoca a propósito (si la actividad lo admite).
  if (fumble && id === 'trivia') act.input((act.solve()[0] + 1) % 3);
  while (!act.closed && guard++ < 400) {
    const inputs = act.solve();
    for (const i of inputs) act.input(i);
    for (let k = 0; k < 20; k++) act.update(0.25);
  }
  expect(act.closed, `${id} no terminó`).toBe(true);
  return { success: act.success, perfect: act.score === act.maxScore };
}

/**
 * Lo que hace el jugador para cumplir un objetivo. Con frases recorre el
 * diálogo eligiendo la primera opción; sin frases, saluda (`silentTalk`).
 * Devuelve todo lo que pasó, para ver que sin frases nadie dijo nada.
 */
function attempt(engine: StoryEngine, o: ObjectiveDef, log: string[]): Effect[] {
  const seen: Effect[] = [];
  const settle = (happened: Effect[]) => {
    seen.push(...happened);
    for (const e of happened) {
      if (e.do !== 'activity') continue;
      const r = playActivity(e.id);
      seen.push(...engine.activityResult(e.id, r.success, r.perfect));
      log.push(`  actividad ${e.id}: ${r.success ? 'ok' : 'falló'}`);
    }
  };
  const runEffects = (effects: Effect[]) => settle(engine.apply(effects));
  const t = o.target;
  switch (t.kind) {
    case 'talk': {
      const d = engine.dialogueFor(t.npc);
      expect(d, `${o.id}: ${t.npc} no tiene qué decir`).not.toBeNull();
      if (!engine.phrases) {
        settle(engine.silentTalk(t.npc).effects);
        log.push(`saludar ${t.npc} (${d!.id})`);
        break;
      }
      const runner = new DialogueRunner(d!, engine);
      runEffects(runner.start());
      let guard = 0;
      while (!runner.done && guard++ < 50) runEffects(runner.step(0));
      log.push(`hablar ${t.npc} (${d!.id})`);
      break;
    }
    case 'interact': {
      const def = interactable(t.id)!;
      const effects = engine.interact(t.id);
      settle(effects);
      if (def.activity) {
        const r = playActivity(def.activity);
        seen.push(...engine.activityResult(def.activity, r.success, r.perfect));
      }
      log.push(`usar ${t.id}`);
      break;
    }
    case 'reach':
      seen.push(...engine.enterPlace(t.place));
      log.push(`llegar ${t.place}`);
      break;
    case 'spot': {
      const r = resolveAnchor(t.anchor);
      seen.push(...engine.atSpot(r.u, r.v, r.level));
      log.push(`pararse en ${o.id}`);
      break;
    }
    case 'collect':
      for (const id of t.ids) {
        if (id.startsWith('voz:')) continue;
        settle(engine.interact(id));
      }
      log.push(`juntar ${t.ids.join(', ')}`);
      break;
  }
  return seen;
}

describe('jugar la historia', () => {
  it('se puede terminar sin callejones sin salida (con frases)', () => {
    const engine = new StoryEngine(null, { phrases: true });
    const log: string[] = [];
    const chapters: string[] = [];
    for (let guard = 0; guard < 80 && !engine.finished; guard++) {
      const ch = engine.currentChapter();
      if (chapters[chapters.length - 1] !== ch) chapters.push(ch);
      const main = engine.mainObjectives();
      expect(main.length, `sin objetivos en ${ch}: ${log.slice(-4).join(' | ')}`).toBeGreaterThan(0);
      const before = engine.data.done.length;
      attempt(engine, main[0], log);
      expect(engine.data.done.length, `atascado en ${main[0].id}: ${log.slice(-3).join(' | ')}`).toBeGreaterThan(before);
    }
    expect(engine.finished, log.join('\n')).toBe(true);
    expect(chapters).toEqual(['prologo', 'c1', 'c2', 'c3', 'c4', 'c5']);
    expect(engine.stamps).toBe(8);
    expect(engine.currentChapter()).toBe('fin');
    for (const z of ZONE_IDS) expect(engine.zone(z as never)).toBe(true);
  });

  it('los secundarios también se pueden completar (con frases)', () => {
    const engine = new StoryEngine(null, { phrases: true });
    const log: string[] = [];
    for (let guard = 0; guard < 120 && !engine.finished; guard++) {
      // Primero los secundarios disponibles (salvo las entrevistas, que se hacen hablando).
      const side = engine.sideObjectives().find((o) => o.id !== 's.voces');
      const o = side ?? engine.mainObjectives()[0];
      attempt(engine, o, log);
      // Entrevistas: a todo personaje que ya tenga una charla con entrevista.
      for (const c of CHARACTERS) {
        const d = engine.dialogueFor(c.id);
        if (!d || !d.nodes.some((nd) => nd.id === 'iv') || engine.interviewed(c.id)) continue;
        const runner = new DialogueRunner(d, engine);
        engine.apply(runner.start());
        engine.apply(runner.step(0)); // "¿Te puedo hacer una pregunta…?"
        while (!runner.done) engine.apply(runner.step(0));
      }
    }
    expect(engine.finished).toBe(true);
    for (const id of ['s.llavero', 's.camara', 's.musica', 's.voces']) expect(engine.done(id), id).toBe(true);
    expect(engine.item('llavero')).toBe(true);
    expect(engine.item('camara')).toBe(true);
    expect(engine.interviews).toBeGreaterThanOrEqual(4);
  });

  it('sin frases se juega entera saludando: prólogo → créditos, 8 sellos, nadie dice nada', () => {
    const engine = new StoryEngine(null, { phrases: false });
    const log: string[] = [];
    const chapters: string[] = [];
    const seen: Effect[] = [];
    for (let guard = 0; guard < 80 && !engine.finished; guard++) {
      const ch = engine.currentChapter();
      if (chapters[chapters.length - 1] !== ch) chapters.push(ch);
      const main = engine.mainObjectives();
      expect(main.length, `sin objetivos en ${ch}: ${log.slice(-4).join(' | ')}`).toBeGreaterThan(0);
      // Lo que sólo existe con frases no aparece nunca.
      expect(engine.sideObjectives().map((o) => o.id)).not.toContain('s.voces');
      const before = engine.data.done.length;
      seen.push(...attempt(engine, main[0], log));
      expect(engine.data.done.length, `atascado en ${main[0].id}: ${log.slice(-3).join(' | ')}`).toBeGreaterThan(before);
    }
    expect(engine.finished, log.join('\n')).toBe(true);
    expect(chapters).toEqual(['prologo', 'c1', 'c2', 'c3', 'c4', 'c5']);
    expect(engine.stamps).toBe(8);
    expect(engine.currentChapter()).toBe('fin');
    for (const z of ZONE_IDS) expect(engine.zone(z as never)).toBe(true);
    // El discurso del acto: la primera opción, aplicada sin mostrarla.
    expect(engine.choice('discurso')).toBe('personas');
    // Ni comentarios ni entrevistas: nada que alguien diga.
    expect(seen.filter((e) => e.do === 'bark' || e.do === 'interview')).toEqual([]);
    expect(engine.interviews).toBe(0);
    // Los guiones siguen: simulacro, acto y créditos.
    for (const id of ['simulacro', 'simulacroFin', 'acto', 'creditos']) {
      expect(seen.some((e) => e.do === 'script' && e.id === id), id).toBe(true);
    }
  });

  it('sin frases los secundarios (salvo las entrevistas) también se completan', () => {
    const engine = new StoryEngine(null, { phrases: false });
    const log: string[] = [];
    for (let guard = 0; guard < 120 && !engine.finished; guard++) {
      const o = engine.sideObjectives()[0] ?? engine.mainObjectives()[0];
      attempt(engine, o, log);
    }
    expect(engine.finished).toBe(true);
    for (const id of ['s.llavero', 's.camara', 's.musica']) expect(engine.done(id), id).toBe(true);
    expect(engine.done('s.voces')).toBe(false);
  });
});
