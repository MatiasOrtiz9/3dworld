import { resolveAnchor } from './anchors';
import { CHARACTERS } from './characters';
import { TALK, dialogue } from './dialogues';
import { ACTIVITY_REWARDS, OBJECTIVES, RULES, objective } from './objectives';
import { emptySave, type SaveData } from './save';
import type {
  ActivityId,
  ChapterId,
  DialogueChoice,
  DialogueDef,
  DialogueNode,
  Effect,
  InteractableDef,
  ObjectiveDef,
  QuestView,
  StampId,
  StationDef,
  ZoneId,
} from './types';
import { INTERACTABLES, PLACES, interactable } from './world';

/**
 * El motor de la historia: estado, objetivos, reglas y efectos.
 *
 * Es puro (sin motor 3D, sin DOM, sin reloj): recibe acciones ("hablé con
 * Rubén", "entré a Recepción", "terminé el robot") y devuelve la lista de
 * efectos que pasaron, en orden. El director los presenta (carteles,
 * sonidos, puertas que se abren); los tests los usan para jugar la
 * historia completa sin navegador.
 */
export class StoryEngine implements QuestView {
  private s: SaveData;
  /** Cache de disponibilidad por versión del estado (las condiciones se consultan mucho). */
  private version = 0;
  private availCache = new Map<string, boolean>();
  private availVersion = -1;

  constructor(save?: SaveData | null) {
    this.s = save ? structuredCloneSave(save) : emptySave();
  }

  // ================================================================ QuestView

  done(id: string): boolean {
    return this.s.done.includes(id);
  }

  available(id: string): boolean {
    if (this.availVersion !== this.version) {
      this.availCache.clear();
      this.availVersion = this.version;
    }
    const hit = this.availCache.get(id);
    if (hit !== undefined) return hit;
    // Se marca falso antes de evaluar: una condición que se consulta a sí misma no cicla.
    this.availCache.set(id, false);
    const o = objective(id);
    const ok = Boolean(o && !this.done(id) && (o.requires ?? []).every((r) => this.done(r)) && (!o.when || o.when(this)));
    this.availCache.set(id, ok);
    return ok;
  }

  flag(id: string): boolean {
    return this.s.flags.includes(id);
  }

  stamp(id: StampId): boolean {
    return this.s.stamps.includes(id);
  }

  get stamps(): number {
    return this.s.stamps.length;
  }

  item(id: string): boolean {
    return this.s.items.includes(id);
  }

  interviewed(id: string): boolean {
    return id in this.s.interviews;
  }

  get interviews(): number {
    return Object.keys(this.s.interviews).length;
  }

  get places(): number {
    return this.s.places.length;
  }

  zone(id: ZoneId): boolean {
    return this.s.zones.includes(id);
  }

  choice(key: string): string | undefined {
    return this.s.choices[key];
  }

  // ================================================================== consultas

  get data(): Readonly<SaveData> {
    return this.s;
  }

  get finished(): boolean {
    return this.flag('fin');
  }

  /** Objetivos disponibles, en el orden de la historia. */
  availableObjectives(): ObjectiveDef[] {
    return OBJECTIVES.filter((o) => this.available(o.id));
  }

  mainObjectives(): ObjectiveDef[] {
    return this.availableObjectives().filter((o) => !o.optional);
  }

  sideObjectives(): ObjectiveDef[] {
    return this.availableObjectives().filter((o) => o.optional);
  }

  currentChapter(): ChapterId {
    return this.mainObjectives()[0]?.chapter ?? 'fin';
  }

  /** Conversación que abre un personaje ahora (null si no tiene nada que decir). */
  dialogueFor(npc: string): DialogueDef | null {
    for (const rule of TALK[npc] ?? []) {
      if (!rule.when || rule.when(this)) return dialogue(rule.dialogue) ?? null;
    }
    return null;
  }

  stationFor(npc: string): StationDef | null {
    const c = CHARACTERS.find((ch) => ch.id === npc);
    if (!c) return null;
    return c.stations.find((st) => !st.when || st.when(this)) ?? c.stations[c.stations.length - 1];
  }

  /** ¿El objeto existe ahora (se ve y se ofrece)? */
  interactableVisible(def: InteractableDef): boolean {
    return !def.when || def.when(this);
  }

  interactableReady(def: InteractableDef): boolean {
    return !def.ready || def.ready(this);
  }

  /** Lugares de la libreta ya descubiertos. */
  discovered(place: string): boolean {
    return this.s.places.includes(place);
  }

  bark(place: string): boolean {
    if (this.s.barks.includes(place)) return false;
    this.s.barks.push(place);
    this.bump();
    return true;
  }

  // ==================================================================== acciones

  /** Aplica efectos (de un diálogo, un objeto, una actividad) y devuelve todo lo que pasó. */
  apply(effects: readonly Effect[]): Effect[] {
    const out: Effect[] = [];
    for (const e of effects) this.applyOne(e, out);
    this.settle(out);
    return out;
  }

  /** El jugador entró a un lugar de la libreta. */
  enterPlace(placeId: string): Effect[] {
    const out: Effect[] = [];
    if (!PLACES.some((p) => p.id === placeId)) return out;
    if (!this.s.places.includes(placeId)) {
      this.s.places.push(placeId);
      this.bump();
      out.push({ do: 'discover', place: placeId });
    }
    for (const o of this.availableObjectives()) {
      if (o.target.kind === 'reach' && o.target.place === placeId) this.applyOne({ do: 'complete', id: o.id }, out);
    }
    this.settle(out);
    return out;
  }

  /** El jugador está parado en (u, v) del nivel: cumple los objetivos de "llegar a un punto". */
  atSpot(u: number, v: number, level: number): Effect[] {
    const out: Effect[] = [];
    for (const o of this.availableObjectives()) {
      if (o.target.kind !== 'spot') continue;
      const r = resolveAnchor(o.target.anchor);
      if (r.level === level && Math.hypot(r.u - u, r.v - v) <= o.target.radius) this.applyOne({ do: 'complete', id: o.id }, out);
    }
    this.settle(out);
    return out;
  }

  /**
   * Se usó un objeto. Los que abren una actividad (`activity`) no cumplen su
   * objetivo acá: lo cumple el resultado de la actividad.
   */
  interact(id: string): Effect[] {
    const def = interactable(id);
    const out: Effect[] = [];
    if (!def || !this.interactableVisible(def) || !this.interactableReady(def)) return out;
    this.applyOne({ do: 'flag', id: `got:${id}` }, out);
    for (const e of def.effects ?? []) this.applyOne(e, out);
    if (!def.activity) {
      for (const o of this.availableObjectives()) {
        if (o.target.kind === 'interact' && o.target.id === id) this.applyOne({ do: 'complete', id: o.id }, out);
      }
    }
    this.settle(out);
    return out;
  }

  /** Terminó una actividad. Sólo el éxito cumple su objetivo; perfecto deja una marca. */
  activityResult(id: ActivityId, success: boolean, perfect = false): Effect[] {
    const out: Effect[] = [];
    if (success) {
      if (perfect) this.applyOne({ do: 'flag', id: `perfecto:${id}` }, out);
      this.applyOne({ do: 'complete', id: ACTIVITY_REWARDS[id].objective }, out);
    }
    this.settle(out);
    return out;
  }

  /** Abre todas las zonas (modo libre de exposición). No toca el progreso. */
  openAll(): Effect[] {
    return this.apply(
      (['entrada', 'primerPiso', 'segundoPiso', 'jardin'] as const).map((zone): Effect => ({ do: 'unlock', zone })),
    );
  }

  tick(seconds: number): void {
    this.s.seconds += seconds;
  }

  serialize(): SaveData {
    return structuredCloneSave(this.s);
  }

  // ===================================================================== interno

  private bump(): void {
    this.version++;
  }

  private applyOne(e: Effect, out: Effect[]): void {
    const s = this.s;
    switch (e.do) {
      case 'complete': {
        if (!this.available(e.id)) return;
        s.done.push(e.id);
        this.bump();
        out.push(e);
        for (const f of objective(e.id)?.onComplete ?? []) this.applyOne(f, out);
        return;
      }
      case 'flag':
        if (s.flags.includes(e.id)) return;
        s.flags.push(e.id);
        break;
      case 'stamp':
        if (s.stamps.includes(e.id)) return;
        s.stamps.push(e.id);
        break;
      case 'unlock':
        if (s.zones.includes(e.zone)) return;
        s.zones.push(e.zone);
        break;
      case 'item':
        if (s.items.includes(e.id)) return;
        s.items.push(e.id);
        break;
      case 'interview': {
        if (e.id in s.interviews) return;
        s.interviews[e.id] = e.quote;
        // "Voces del recorrido" cuenta entrevistas como cosas juntadas.
        const k = Object.keys(s.interviews).length;
        if (k <= 4 && !s.flags.includes(`got:voz:${k}`)) s.flags.push(`got:voz:${k}`);
        break;
      }
      case 'choice':
        if (s.choices[e.key] === e.value) return;
        s.choices[e.key] = e.value;
        break;
      default:
        // Efectos de presentación: pasan tal cual al director.
        out.push(e);
        return;
    }
    this.bump();
    out.push(e);
  }

  /** Objetivos que se cumplen solos (juntar cosas) y reglas, hasta que nada cambie. */
  private settle(out: Effect[]): void {
    for (let guard = 0; guard < 32; guard++) {
      let changed = false;
      for (const o of this.availableObjectives()) {
        if (o.target.kind === 'collect' && o.target.ids.every((id) => this.flag(`got:${id}`))) {
          this.applyOne({ do: 'complete', id: o.id }, out);
          changed = true;
        }
      }
      for (const r of RULES) {
        if (this.s.rules.includes(r.id) || !r.when(this)) continue;
        this.s.rules.push(r.id);
        this.bump();
        for (const e of r.effects) this.applyOne(e, out);
        changed = true;
      }
      if (!changed) break;
    }
    if (this.flag('fin') && this.s.finished === undefined) this.s.finished = this.s.seconds;
  }
}

function structuredCloneSave(s: SaveData): SaveData {
  return JSON.parse(JSON.stringify(s)) as SaveData;
}

// ==================================================================== diálogos

const END = '$end';

/**
 * Recorre un diálogo: nodo actual, opciones filtradas por estado y efectos
 * al entrar a cada nodo o al elegir. Puro: lo usan el director y los tests.
 */
export class DialogueRunner {
  node: DialogueNode | null;
  private readonly byId: Map<string, number>;

  constructor(
    private readonly def: DialogueDef,
    private readonly q: QuestView,
  ) {
    this.byId = new Map(def.nodes.map((nd, i) => [nd.id, i]));
    this.node = def.nodes[0] ?? null;
  }

  get done(): boolean {
    return this.node === null;
  }

  /** Efectos del primer nodo (se aplican al abrir el diálogo). */
  start(): Effect[] {
    return [...(this.node?.effects ?? [])];
  }

  /**
   * Opciones visibles del nodo actual. Si después de filtrar sólo queda una
   * despedida sin efectos, no se muestra: el nodo se lee como una línea más.
   */
  choices(): DialogueChoice[] {
    const nd = this.node;
    if (!nd?.choices) return [];
    const list = nd.choices.filter((c) => !c.if || c.if(this.q));
    if (list.length === 1 && (list[0].next ?? END) === END && !list[0].effects?.length) return [];
    return list;
  }

  /** Avanza (sin opciones) o elige la opción `index`. Devuelve los efectos que pasaron. */
  step(index = 0): Effect[] {
    const nd = this.node;
    if (!nd) return [];
    const effects: Effect[] = [];
    const list = this.choices();
    let next: string | undefined;
    if (list.length > 0) {
      const c = list[Math.max(0, Math.min(index, list.length - 1))];
      effects.push(...(c.effects ?? []));
      next = c.next ?? END;
    } else if (nd.choices && nd.choices.length > 0) {
      // Opciones colapsadas (sólo quedaba la despedida).
      next = END;
    } else {
      next = nd.next;
    }
    if (next === END) {
      this.node = null;
      return effects;
    }
    const i = next !== undefined ? this.byId.get(next) : (this.byId.get(nd.id) ?? -1) + 1;
    this.node = i !== undefined && i >= 0 && i < this.def.nodes.length ? this.def.nodes[i] : null;
    effects.push(...(this.node?.effects ?? []));
    return effects;
  }
}

/** Todos los objetos con los que se interactúa, para los tests de integridad. */
export const ALL_INTERACTABLES = INTERACTABLES;
