import type { ItemKind, Level } from '../../world/SchoolBase';
import type { CharacterLook, NpcAnim, SchoolPhase } from '../contracts';

/**
 * Tipos de la historia "Recorrido 40".
 *
 * Todo lo que está en `story/` son DATOS y lógica pura: no importa nada del
 * motor. Así la historia entera se puede jugar en un test (sin navegador) y
 * comprobar que no tiene callejones sin salida, que cada personaje está en el
 * ambiente que dice y que cada lugar se alcanza caminando.
 */

/** Punto de la escuela (u este, v sur) en un nivel. */
export interface Spot {
  u: number;
  v: number;
  level: Level;
}

/**
 * Dónde está algo. Se ancla a un objeto del plano (por tipo y ambiente) o a
 * un punto escrito a mano dentro de un ambiente. Anclar a `ITEMS` hace que la
 * historia siga a la escuela si alguien corre un mueble: el test avisa si el
 * ancla deja de caer en su ambiente.
 */
export type Anchor =
  | { room: string; at?: readonly [number, number] }
  | { item: ItemKind; room: string; nth?: number };

export type ChapterId = 'prologo' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'fin';

/** Zonas que se abren con la historia. */
export type ZoneId = 'entrada' | 'primerPiso' | 'segundoPiso' | 'jardin';

export type StampId = 'maker' | 'cantina' | 'patio' | 'trofeos' | 'danza' | 'simulacro' | 'jardin' | 'polideportivo';

export type ActivityId = 'robot' | 'menu' | 'reciclaje' | 'trivia' | 'danza' | 'penales';

/** Lo que la historia puede hacer pasar. Las de estado las aplica el motor; el resto, el director. */
export type Effect =
  | { do: 'complete'; id: string }
  | { do: 'flag'; id: string }
  | { do: 'stamp'; id: StampId }
  | { do: 'unlock'; zone: ZoneId }
  | { do: 'item'; id: string }
  | { do: 'interview'; id: string; quote: string }
  | { do: 'choice'; key: string; value: string }
  | { do: 'activity'; id: ActivityId }
  | { do: 'script'; id: string }
  | { do: 'phase'; phase: SchoolPhase }
  | { do: 'bark'; who: string; text: string }
  | { do: 'toast'; title: string; text?: string }
  /** Lo genera el motor al descubrir un lugar (no se escribe en los datos). */
  | { do: 'discover'; place: string };

/** Lectura del estado para las condiciones de los datos. */
export interface QuestView {
  done(id: string): boolean;
  available(id: string): boolean;
  flag(id: string): boolean;
  stamp(id: StampId): boolean;
  readonly stamps: number;
  item(id: string): boolean;
  interviewed(id: string): boolean;
  readonly interviews: number;
  readonly places: number;
  zone(id: ZoneId): boolean;
  choice(key: string): string | undefined;
}

export type Cond = (q: QuestView) => boolean;

// =================================================================== personajes

export interface CharacterDef {
  id: string;
  /** Nombre de pila (ficticio). */
  name: string;
  /** Rol, como lo ve el jugador: "portero", "directora"… */
  role: string;
  /** Color del nombre y del retrato en el diálogo. */
  color: string;
  look: CharacterLook;
  /** Timbre de la voz sintetizada. */
  voice: { pitch: number; rate?: number };
  /**
   * Dónde está según el momento de la historia: la primera que se cumple.
   * `follow` lo pone a caminar detrás del jugador.
   */
  stations: StationDef[];
  /** Lo que comenta en voz alta (sin abrir diálogo) cuando no tiene nada nuevo. */
  idle: string[];
}

export interface StationDef {
  when?: Cond;
  /** Ambiente y punto (o ancla). `null`: no está en escena (sólo para `hidden`). */
  at: Anchor;
  /** Hacia dónde mira: un ancla o un rumbo (`n`, `s`, `e`, `w`). */
  face?: Anchor | 'n' | 's' | 'e' | 'w';
  anim?: NpcAnim;
  follow?: boolean;
  hidden?: boolean;
}

// ======================================================================= lugares

export interface PlaceDef {
  id: string;
  title: string;
  /** Ambientes del plano que cuentan como este lugar. */
  rooms: string[];
  /** Una línea para la libreta de exploración. */
  blurb: string;
}

export interface InfoCard {
  kicker?: string;
  title: string;
  text: string;
}

export type InteractableKind =
  | 'info'
  | 'screen'
  | 'bell'
  | 'printer'
  | 'piano'
  | 'drums'
  | 'star'
  | 'locker'
  | 'bins'
  | 'ball'
  | 'activity';

export interface InteractableDef {
  id: string;
  kind: InteractableKind;
  /** Nombre del objeto en el aviso: "E · Mirar · Mural de San Martín". */
  label: string;
  verb: string;
  anchor: Anchor;
  /** Altura del centro del objeto sobre el piso de su nivel. */
  y: number;
  /** Medidas de la caja de selección (láser VR), en metros. */
  size?: readonly [number, number, number];
  /** Alcance para usarlo, en metros (por defecto 2,6). */
  range?: number;
  card?: InfoCard;
  effects?: Effect[];
  /** Sólo existe (se ve y se ofrece) si se cumple. */
  when?: Cond;
  /** Se ve pero todavía no se puede usar: muestra `notReady` en vez de actuar. */
  ready?: Cond;
  notReady?: string;
  /** `notReady` del juego sin frases, si el original pide hablar con alguien (ver `phrases.ts`). */
  silentNotReady?: string;
  /** Actividad que abre, si es la entrada a una. */
  activity?: ActivityId;
}

// ===================================================================== objetivos

export type Target =
  | { kind: 'talk'; npc: string }
  | { kind: 'interact'; id: string }
  | { kind: 'reach'; place: string }
  | { kind: 'spot'; anchor: Anchor; radius: number }
  | { kind: 'collect'; ids: string[] };

export interface ObjectiveDef {
  id: string;
  chapter: ChapterId;
  title: string;
  /**
   * Título del juego sin frases (ver `phrases.ts`): «Hablá con Rubén» no
   * tiene sentido si nadie contesta y el aviso dice «Saludar».
   */
  silentTitle?: string;
  hint?: string;
  optional?: boolean;
  /** Sólo existe con frases: las entrevistas son frases, en el juego callado no se ofrece. */
  phrases?: boolean;
  requires?: string[];
  when?: Cond;
  target: Target;
  /** Efectos al cumplirlo (además de marcarlo). */
  onComplete?: Effect[];
}

export interface ChapterDef {
  id: ChapterId;
  kicker: string;
  title: string;
}

/** Reglas: cuando se cumple `when`, una sola vez, pasan sus efectos. */
export interface RuleDef {
  id: string;
  when: Cond;
  effects: Effect[];
}

// ===================================================================== diálogos

export interface DialogueChoice {
  text: string;
  next?: string;
  effects?: Effect[];
  if?: Cond;
}

export interface DialogueNode {
  id: string;
  /** Personaje, 'player' (vos) o 'narrator'. */
  who: string;
  text: string;
  anim?: NpcAnim;
  effects?: Effect[];
  choices?: DialogueChoice[];
  next?: string;
}

export interface DialogueDef {
  id: string;
  nodes: DialogueNode[];
}

/** Qué conversación abre un personaje según el estado: la primera que se cumple. */
export interface TalkRule {
  when?: Cond;
  dialogue: string;
}

// ================================================================== cerraduras

export interface LockDef {
  id: string;
  zone: ZoneId;
  /** Rectángulo macizo mientras está cerrado (coordenadas del plano). */
  rect: { u0: number; v0: number; u1: number; v1: number; level: Level };
  /** Cómo se ve cerrado: hoja de puerta, puerta doble o cinta en una escalera. */
  visual: 'door' | 'double' | 'barrier';
  /** Línea del vano: de `a` a `b`, a la altura del nivel. */
  a: readonly [number, number];
  b: readonly [number, number];
  /** Alto del vano. */
  h: number;
  /** Cartel cuando el jugador intenta pasar. */
  reason: string;
  /** El cartel del juego sin frases, si el original pide hablar con alguien. */
  silentReason?: string;
}
