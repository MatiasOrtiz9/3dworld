import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
// Sólo tipos del visor: WebXR y sus módulos se cargan dinámicamente (main.ts).
import type { HapticPattern, XRButtonEvent, XRHand, XRInput, XRReleaseEvent } from '../vr/XRInput';
import type { PointerState, XRPointer } from '../vr/XRPointer';
import type { ComfortSettings } from '../vr/XRComfort';
import type { HudInfo } from '../vr/XRWristPanel';
import type { CityIndex } from '../world/CityIndex';
import {
  ITEMS,
  LEVEL_Y,
  fromPlan,
  inLot,
  levelOf,
  planV,
  roomAt,
  roomLabel,
  schoolSolidLocal,
  setDynamicSolid,
  toLocal,
  toWorld,
  type Level,
  type SchoolFrame,
} from '../world/SchoolLayout';
import type { AudioApi, NpcAnim, NpcHandle, PlayerApi, PopulationApi, SchoolPhase, WorldPoint } from './contracts';
import type { Hud, LineView, PassportView } from '../ui/Hud';
import { consume, isConsumed, typingTarget } from '../ui/input';
import { createActivity, type Activity } from './activities';
import type { ActivityView } from './activities/types';
import { RobotRoute } from './activities/RobotRoute';
import { Penalty } from './activities/Penalty';
import { DanceSequence } from './activities/DanceSequence';
import { resolveAnchor, roomIdAt, standNear, standable, yawCardinal, yawLocal, type Resolved } from './story/anchors';
import { CHARACTERS } from './story/characters';
import { ITEMS_INFO, STAMPS, STAMP_ORDER, ZONES, chapter, objective } from './story/objectives';
import { phrasesFromQuery } from './story/phrases';
import { localSaveStore, type SaveStore } from './story/save';
import { DialogueRunner, StoryEngine } from './story/StoryEngine';
import type { ActivityId, CharacterDef, ChapterId, Effect, InteractableDef, ObjectiveDef, Spot, StationDef, ZoneId } from './story/types';
import { ACT, DOOR_LOCKS, ENTRANCE_U, EVAC_ROUTE, INTERACTABLES, LOCKS, PLACES, START, STAIR_GUIDES, isJardinRoom, outsideRoom, placeForRoom, safeToRelock } from './story/world';
import { focusByGaze, focusByRay, type Candidate } from './Interaction';
import { GameProps, PENALTY_SPOT, GOAL_MOUTH_U } from './world/GameProps';
import { Doors } from './world/Doors';
import { Lights } from './world/Lights';
import type { Fixture } from '../world/SchoolLights';
import { Markers, type Glow } from './world/Markers';
import { Screens, type ScreenSpec } from './world/Screens';
import type { GamePanel3D, PanelModel, PanelScreen } from './xr/GamePanel3D';
import type { StickRepeat, XRMenuHost, XRMenus } from './xr/XRGameUI';

/**
 * Director del juego "Recorrido 40".
 *
 * Une la historia (puro, en `story/`) con el mundo: personajes que caminan y
 * hablan, objetos que se encienden, puertas que se abren, la campana, el
 * robot, la pelota, el HUD de escritorio y el panel del visor. Cada acción
 * del jugador entra al motor de la historia (`StoryEngine`) y lo que éste
 * devuelve (efectos) se presenta acá: carteles, sonidos, animaciones.
 *
 * Lo que necesita de las otras piezas está en `contracts.ts` (gente, audio,
 * jugador): no depende de cómo están hechas.
 *
 * Por defecto el juego no tiene frases (lo pidió el usuario, ver
 * `story/phrases.ts`): nadie habla, no hay voces ni comentarios, y saludar a
 * un personaje hace avanzar la historia en silencio (`greet`). Con
 * `?frases=1` vuelven los diálogos tal como eran.
 */

export interface GameDirectorDeps {
  scene: Scene;
  camera: Camera;
  school: SchoolFrame;
  index: CityIndex;
  population: PopulationApi;
  audio: AudioApi;
  player: PlayerApi;
  hud: Hud;
  /** Opcional: si ahora se puede interactuar (por ejemplo, no mientras se vuela). */
  canInteract?: () => boolean;
  /** Luminarias de las aulas con interruptor (`City.lightFixtures`). Sin ellas no hay interruptores. */
  fixtures?: ReadonlyMap<string, Fixture[]>;
  /** Un aula prendió o apagó sus luces: `main.ts` baja la luz de su mapa (Environment). */
  onRoomLights?: (roomId: string, on: boolean) => void;
}

/**
 * Lo que el juego usa del visor (un subconjunto de `XRControls`, ver
 * `vr/XRSetup.ts`): la entrada cruda de los mandos, el láser, la caminata,
 * la muñeca, el confort, los rótulos de los mandos, el fundido y la salida.
 */
export interface XRGameControls {
  readonly input: XRInput;
  readonly pointer: XRPointer;
  /** Caminar, girar y teletransporte. */
  setLocomotionEnabled(enabled: boolean): void;
  setHud(info: HudInfo): void;
  /** Flecha de la muñeca hacia el objetivo (null la oculta). */
  setObjectiveTarget(p: { x: number; y: number; z: number } | null): void;
  getComfort(): ComfortSettings;
  setComfort(s: ComfortSettings): void;
  /** Rótulos con la función de cada botón junto a los mandos. */
  setHints(on: boolean): void;
  /** Fundido a negro dentro del visor (el `#fade` del HTML no se ve ahí). */
  fade(toBlack: boolean, ms?: number): Promise<void>;
  exit(): Promise<void>;
}

const HANDS: readonly XRHand[] = ['right', 'left'];
/** Gatillo apenas tocado (0–1): el dedo empezó a apretar y el láser queda fijo en su botón. */
const PULL_START = 0.12;
/** Un apretón de verdad llega al fondo en menos que esto (ms). */
const PULL_MS = 400;
const otherHand = (h: XRHand): XRHand => (h === 'right' ? 'left' : 'right');
const FORWARD = new Vector3(0, 0, 1);
/** A qué distancia de la empuñadura se agarra la pelota (y cuánto puede errarle el láser). */
const GRAB_REACH = 0.45;
const GRAB_AIM = 0.3;
const GRAB_AIM_RANGE = 4;
/** Velocidad de la mano (en planta) a partir de la cual soltar la pelota es lanzarla. */
const THROW_MIN = 1.2;
/** Segundos fuera del predio tras los que la pelota vuelve a su lugar. */
const BALL_AWAY_RESET = 4;
/** Rótulos de los mandos a la vista al empezar a jugar (ms). */
const HINTS_AFTER_START = 12000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ================================================================ sesión

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const automated = typeof navigator !== 'undefined' && navigator.webdriver === true;

/**
 * Estado de la página (sobrevive a que `main.ts` reconstruya la escuela por
 * un cambio de calidad o al entrar al visor): si ya se pasó el título y si
 * está el modo libre. Las herramientas automáticas (puppeteer) entran
 * directo y con todo abierto, para que sus capturas y pruebas no dependan
 * de la historia.
 */
const SESSION = {
  started: false,
  /**
   * La pantalla de inicio está abierta (la del escritorio o la del visor).
   * Una reconstrucción (cambio de calidad, salir del visor) la vuelve a
   * mostrar aunque la partida ya haya empezado: "Volver al inicio" del
   * visor deja `started` en true.
   */
  atTitle: false,
  skipTitle: params.get('titulo') === '0' || (automated && params.get('titulo') !== '1'),
  freeRoam: params.get('libre') === '1' || (automated && params.get('libre') !== '0'),
  // Con herramientas automáticas, sin HUD salvo que se pida (`?hud=1`): las
  // capturas de la escuela no deberían tapar nada.
  hud: params.get('hud') === '1' || (!automated && params.get('hud') !== '0'),
  /** Diálogos, voces y comentarios: apagados salvo `?frases=1` (ver `story/phrases.ts`). */
  phrases: phrasesFromQuery(params),
};

const TALK_RANGE = 2.6;
const TOTAL_STAMPS = STAMP_ORDER.length;
const GOLD = Color3.FromHexString('#f2c14e');
const SOFT = Color3.FromHexString('#cfe2db');
const STAR = Color3.FromHexString('#ffd34d');
const GREEN = Color3.FromHexString('#28c76f');
const PHASE_BY_CHAPTER: Record<ChapterId, SchoolPhase> = {
  prologo: 'entrada',
  c1: 'clase',
  c2: 'clase',
  c3: 'clase',
  c4: 'clase',
  c5: 'clase',
  fin: 'salida',
};

/** Insignias: lo que se hizo de más (no hacen falta para terminar). `phrases`: sólo existe con frases. */
const BADGES: ReadonlyArray<{ title: string; got: (e: StoryEngine) => boolean; phrases?: boolean }> = [
  { title: 'Cronista', got: (e) => e.interviews >= 4, phrases: true },
  { title: 'Explorador', got: (e) => e.places >= 24 },
  { title: 'Programación de manual', got: (e) => e.flag('perfecto:robot') },
  { title: 'Bandeja perfecta', got: (e) => e.flag('perfecto:menu') },
  { title: 'Ojo de lince', got: (e) => e.flag('perfecto:trivia') },
  { title: 'Primera fila', got: (e) => e.flag('perfecto:danza') },
  { title: 'Tres de tres', got: (e) => e.flag('perfecto:penales') },
];

interface NpcSlot {
  def: CharacterDef;
  handle: NpcHandle | null;
  station: StationDef | null;
  /** Lugar actual conocido (si no hay personaje real, es donde "estaría"). */
  at: Spot;
  following: boolean;
  /** Lo controla un guion (penales, acto): la sincronización de lugares no lo toca. */
  busy: boolean;
  walking: boolean;
  followTarget: Spot | null;
  nextFollow: number;
}

interface ItemSlot {
  def: InteractableDef;
  at: Resolved;
  x: number;
  y: number;
  z: number;
  baseY: number;
  radius: number;
}

interface ActiveActivity {
  id: ActivityId;
  act: Activity;
  version: number;
  host: string | null;
}

interface Timer {
  at: number;
  fn: () => void;
}

/** Lo que hace un personaje en su lugar. Sin frases nadie gesticula como si hablara. */
function stationAnim(st: StationDef): NpcAnim {
  const a = st.anim ?? 'idle';
  return a === 'talk' && !SESSION.phrases ? 'idle' : a;
}

/** Nivel de un punto: el de los pies dentro del predio, planta baja afuera. */
function levelAt(u: number, v: number, feetY: number): Level {
  return inLot(u, v) ? levelOf(feetY) : 0;
}

export class GameDirector {
  private readonly scene: Scene;
  private readonly hud: Hud;
  private readonly audio: AudioApi;
  private readonly player: PlayerApi;
  private readonly population: PopulationApi;
  private readonly frame: SchoolFrame;
  private readonly store: SaveStore;
  private engine: StoryEngine;

  private readonly props: GameProps;
  private readonly doors: Doors;
  private readonly lights: Lights | null;
  private readonly markers: Markers;
  private readonly screens: Screens;
  private readonly items: ItemSlot[] = [];
  private readonly npcs: NpcSlot[] = [];
  private readonly stationSpots = new Map<StationDef, { spot: Spot; yaw: number }>();

  private readonly beforeRender: Observer<Scene>;

  private mode: 'title' | 'play' = 'play';
  private modal: 'dialogue' | 'activity' | 'card' | 'cutscene' | null = null;
  private clock = 0;
  private senseT = 0;
  private mapT = 0;
  private saveT = 0;
  private timers: Timer[] = [];
  private focus: Candidate | null = null;
  private candidates: Candidate[] = [];
  private readonly candList: Candidate[] = [];
  private readonly itemCands: Candidate[] = [];
  private readonly npcCands: Candidate[] = [];
  private readonly lockCands: Candidate[] = [];
  private readonly doorCands: Candidate[] = [];
  private readonly switchCands: Candidate[] = [];
  private itemCandsVisible: Candidate[] = [];
  private lockCandsVisible: Candidate[] = [];
  private readonly newsNpcs = new Set<string>();
  /** Pies del jugador en este cuadro. */
  private feet: WorldPoint = { x: 0, y: 0, z: 0 };
  private activity: ActiveActivity | null = null;
  private actDrawn = 0;
  private pendingActivity: ActivityId | null = null;
  private currentChapter: ChapterId | null = null;
  private currentMain = '';
  private room = '';
  private roomName = '';
  private level: Level = 0;
  private feetLocal = { u: 0, v: 0 };
  private drill: { t: number; arrows: Glow[]; next: number } | null = null;
  private drillTime = 0;
  private phase: SchoolPhase = 'entrada';
  private phaseSet = false;
  /** Las cerraduras se vuelven a poner al salir del modo libre, cuando el jugador está en planta baja. */
  private locksDirty = false;
  /** Dónde se abrió la ficha informativa (se cierra al alejarse). */
  private cardAt: { u: number; v: number } | null = null;
  private titleT = 0;
  private lastPick = 0;
  private distanceText = '';
  /** Último saludo sin frases: a quién, cuándo y si hizo avanzar la historia (lo leen las herramientas). */
  private greeted: { npc: string; at: number; due: boolean } | null = null;

  // VR
  private xr: WebXRDefaultExperience | null = null;
  private xrControls: XRGameControls | null = null;
  private xrStateObs: Observer<WebXRState> | null = null;
  private panel: GamePanel3D | null = null;
  private inXR = false;
  /** Lo que muestra el panel/HUD ahora, para re-mostrarlo al entrar o salir del visor. */
  private shown: { model: PanelModel; pick: (i: number) => void; toward?: { x: number; z: number } } | null = null;
  /** Inicio y menú del juego del visor (se cargan con el panel, sólo si hay visor). */
  private menus: XRMenus | null = null;
  private stickNav: StickRepeat | null = null;
  private hintFor: ((phrases: boolean) => string) | null = null;
  /** Suscripciones a los botones de los mandos (se sueltan al reconectar y al desarmar). */
  private xrSubs: Array<() => void> = [];
  /**
   * Ya se desarmó: `connectXR` espera un import dinámico y, si la escuela se
   * reconstruye mientras tanto, el director viejo no debe crear un panel ni
   * suscribirse a los botones (cada pulsación se procesaba dos veces).
   */
  private disposed = false;
  /** El inicio del visor se abrió con la partida en curso: "Continuar" sólo lo cierra. */
  private xrTitleInPlace = false;
  /** Un fundido del visor en curso: los botones no hacen nada. */
  private xrBusy = false;
  /** Lo que el láser de cada mano señala en el mundo, y en qué zona del panel está (null: no lo toca). */
  private readonly handFocus: Record<XRHand, Candidate | null> = { left: null, right: null };
  private readonly onPanel: Record<XRHand, number | null> = { left: null, right: null };
  /**
   * Botón que apuntaba cada mano ANTES de empezar a apretar el gatillo (−1
   * ninguno). Al tirar del gatillo el mando cabecea unos grados y el láser
   * baja medio botón: sin esto el clic caía en el de abajo o en el hueco.
   */
  private readonly preZone: Record<XRHand, number> = { left: -1, right: -1 };
  /** Desde cuándo (ms) cada gatillo está apenas tocado, sin llegar a apretarse. */
  private readonly pullSince: Record<XRHand, number> = { left: 0, right: 0 };
  /** Gatillo apretado sobre un botón del panel: se elige al soltar sobre el mismo. */
  private pressed: { hand: XRHand; zone: number } | null = null;
  private dragHand: XRHand | null = null;
  private ballHand: XRHand | null = null;
  /**
   * El candidato de la pelota sigue a la pelota: con el agarre del visor se la
   * lleva (o se la lanza) a cualquier lugar de planta baja, y el rótulo y el
   * "Patear" quedaban flotando en su lugar original.
   */
  private ballCand: Candidate | null = null;
  /** Altura del rótulo sobre el centro de la pelota (la del ancla, con la pelota en reposo). */
  private ballCandLift = 0;
  /** Segundos que la pelota lleva fuera del predio: pasado un rato vuelve a su lugar. */
  private ballAway = 0;
  private lastFocusKey = '';
  private hoverSoundAt = 0;
  private menuHints = false;
  private hintsOn = false;
  private hintsUntil = 0;
  private panelSize: 'normal' | 'large' = 'normal';
  /**
   * Contenido nuevo en el panel: el primer cuadro el láser sólo registra
   * dónde está, sin mover el resaltado. Así el foco que trae la pantalla
   * (en una confirmación, "Volver") no salta al botón que el láser tenía
   * debajo por casualidad.
   */
  private seedLaser = false;
  private wristKey = '';
  /** Cuándo hay que redibujar el minimapa del visor (lo calcula `updateMap`). */
  private xrMapKey = '';
  private targetKey = '';
  private readonly ray = new Ray(Vector3.Zero(), new Vector3(0, 0, 1), 20);
  private readonly tmpDir = new Vector3();

  constructor(private readonly deps: GameDirectorDeps) {
    this.scene = deps.scene;
    this.hud = deps.hud;
    this.audio = deps.audio;
    this.player = deps.player;
    this.population = deps.population;
    this.frame = deps.school;
    this.store = localSaveStore();
    this.engine = new StoryEngine(this.store.load(), { phrases: SESSION.phrases });

    // --- objetos interactivos: ancla → punto del mundo -------------------
    for (const def of INTERACTABLES) {
      const at = resolveAnchor(def.anchor);
      const W = toWorld(this.frame, at.u, at.v);
      const size = def.size ?? [0.6, 0.6, 0.6];
      this.items.push({
        def,
        at,
        x: W.x,
        y: LEVEL_Y[at.level] + def.y,
        z: W.z,
        baseY: LEVEL_Y[at.level],
        radius: Math.max(0.25, Math.max(size[0], size[2]) / 2),
      });
    }
    const item = (id: string) => this.items.find((i) => i.def.id === id)!.at;
    const bell = this.items.find((i) => i.def.id === 'campana')!;
    this.props = new GameProps(this.scene, this.frame, {
      bell: { ...bell.at, y: bell.def.y },
      mat: item('pista'),
      ball: item('pelota'),
      printer: item('impresora'),
      bins: item('puntoLimpio'),
    });
    this.doors = new Doors(this.scene, this.frame, (open, at) => this.audio.door(open, at));
    this.lights = deps.fixtures && deps.fixtures.size > 0 ? new Lights(this.scene, this.frame, deps.fixtures, deps.onRoomLights) : null;
    this.markers = new Markers(this.scene);
    this.screens = new Screens(this.scene, this.frame, this.screenSpecs());

    // --- personajes -----------------------------------------------------------
    for (const def of CHARACTERS) this.spawn(def);
    try {
      this.population.setPlayer(() => this.player.feet());
    } catch {
      // Sin multitud real: los personajes del juego igual funcionan.
    }

    this.hud.bind({
      onPause: () => this.applyPause(),
      onReset: () => this.newGame(),
      onFreeRoam: (on) => this.setFreeRoam(on),
      onFreeRoamStart: () => this.startFreeRoam(),
      passport: () => this.passport(),
    });
    this.hud.setFreeRoam(SESSION.freeRoam);
    this.hud.setVisible(SESSION.hud);
    this.hud.setPhrases(SESSION.phrases);

    this.beforeRender = this.scene.onBeforeRenderObservable.add(this.update);
    window.addEventListener('keydown', this.onKey);

    if (SESSION.skipTitle || (SESSION.started && !SESSION.atTitle)) {
      SESSION.started = true;
      this.resume(false);
    } else {
      this.showTitle();
    }
  }

  // ======================================================================= API

  /** Avance para el panel de muñeca del visor y herramientas: "3/8 sellos · objetivo". */
  get progressText(): string {
    const o = this.engine.mainObjectives()[0];
    const head = `${this.engine.stamps}/${TOTAL_STAMPS} sellos`;
    return o ? `${head} · ${this.engine.objectiveTitle(o)}` : `${head} · Recorrido completo`;
  }

  /** Si está la pantalla de título (todavía no se juega). */
  get atTitle(): boolean {
    return this.mode === 'title';
  }

  /** Nombre del ambiente donde está el jugador (el HUD ya lo muestra). */
  get placeLabel(): string {
    return this.roomName;
  }

  /** Si el juego tiene frases (`?frases=1`) o es callado (por defecto). */
  get phrases(): boolean {
    return SESSION.phrases;
  }

  /** Último saludo sin frases, para las herramientas: a quién, cuándo (reloj del juego) y si avanzó la historia. */
  get lastGreeting(): { npc: string; at: number; due: boolean } | null {
    return this.greeted;
  }

  /**
   * Mirador de la pantalla de inicio en el visor: el punto central del paneo
   * del título de escritorio (`titleCamera`), de pie sobre la vereda de
   * enfrente de Laprida, mirando la fachada. `main.ts` aparece ahí al entrar
   * al visor desde el título.
   */
  get xrLookout(): { eye: WorldPoint; look: WorldPoint } {
    const e = toWorld(this.frame, ...fromPlan(44, 9.5));
    const l = toWorld(this.frame, ...fromPlan(38, -3));
    let ground = 0;
    try {
      ground = this.deps.index.groundHeight(e.x, e.z);
    } catch {
      // Sin índice: la vereda está a nivel de calle.
    }
    return { eye: { x: e.x, y: ground + 1.7, z: e.z }, look: { x: l.x, y: 3.8, z: l.z } };
  }

  /** Conecta el panel 3D, el láser, los botones y la muñeca del visor. */
  async connectXR(experience: WebXRDefaultExperience, controls: XRGameControls): Promise<void> {
    this.disconnectXR();
    if (this.disposed) return;
    if (!this.panel) {
      const [{ GamePanel3D }, ui] = await Promise.all([import('./xr/GamePanel3D'), import('./xr/XRGameUI')]);
      // Desarmado durante la espera: nada que crear ni a qué suscribirse.
      if (this.disposed) return;
      // Dos conexiones seguidas: la primera que vuelve crea el panel.
      if (!this.panel) {
        this.panel = new GamePanel3D(this.scene);
        this.menus = new ui.XRMenus(this.menuHost());
        this.stickNav = new ui.StickRepeat();
        this.hintFor = ui.controlsHint;
      }
    }
    // Otra conexión pudo suscribirse durante la espera: se queda la última.
    this.disconnectXR();
    this.xr = experience;
    this.xrControls = controls;
    // Una sola entrada para los botones: `XRInput` lee el gamepad crudo de
    // los dos mandos (el puntero de Babylon no se habilita: en el Quest no
    // siempre entregaba el clic y no permite elegir al soltar).
    const press = controls.input.onPress.add((e) => this.onXRPress(e));
    const release = controls.input.onRelease.add((e) => this.onXRRelease(e));
    this.xrSubs = [() => controls.input.onPress.remove(press), () => controls.input.onRelease.remove(release)];
    this.xrStateObs = experience.baseExperience.onStateChangedObservable.add((s) => this.onXRState(s));
    this.onXRState(experience.baseExperience.state);
    this.applyPause();
  }

  private disconnectXR(): void {
    for (const off of this.xrSubs) off();
    this.xrSubs = [];
    if (this.xr && this.xrStateObs) this.xr.baseExperience.onStateChangedObservable.remove(this.xrStateObs);
    this.xrStateObs = null;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    this.scene.onBeforeRenderObservable.remove(this.beforeRender);
    this.disconnectXR();
    if (this.hintsOn) this.xrControls?.setHints(false);
    this.xrControls?.setObjectiveTarget(null);
    // El láser no se queda con el largo y el color del último cuadro (una
    // reconstrucción tarda varios): el director nuevo vuelve a decirle dónde
    // termina cada rayo.
    for (const hand of HANDS) this.xrControls?.pointer.setHit(hand, null);
    this.xrControls?.pointer.setEnabled(true);
    this.xrControls?.setLocomotionEnabled(true);
    this.save();
    this.hud.hideDialogue();
    this.hud.hideActivity();
    this.hud.closeCard();
    this.hud.setPrompt(null);
    this.hud.setDrill(null);
    if (this.modal) this.player.setPaused(false);
    for (const l of LOCKS) setDynamicSolid(l.id, null);
    this.props.dispose();
    this.doors.dispose();
    this.lights?.dispose();
    this.markers.dispose();
    this.screens.dispose();
    this.panel?.dispose();
    this.panel = null;
  }

  // ==================================================================== título

  private showTitle(): void {
    this.mode = 'title';
    SESSION.atTitle = true;
    this.applyPause();
    this.music('intro');
    const has = this.engine.data.done.length > 0;
    const ch = chapter(this.engine.currentChapter());
    this.hud.showTitle({
      progress: has ? `${ch.kicker} · ${this.engine.stamps}/${TOTAL_STAMPS} sellos` : null,
      onStart: () => {
        this.setFreeRoam(false);
        this.newGame();
      },
      onContinue: () => {
        this.setFreeRoam(false);
        this.resume(true);
      },
      onFreeRoam: () => this.startFreeRoam(),
    });
  }

  /** Partida nueva: se borra lo guardado y la historia empieza en Laprida. */
  private newGame(): void {
    // Lo que estuviera abierto (diálogo, actividad) se cierra sin resultado.
    this.activity = null;
    this.pendingActivity = null;
    this.closeModalUI();
    this.modal = null;
    this.markers.setArrows([]);
    this.store.clear();
    this.engine = new StoryEngine(null, { phrases: SESSION.phrases });
    this.stationSpots.clear();
    this.currentChapter = null;
    this.currentMain = '';
    this.drill = null;
    this.hud.setDrill(null);
    for (const id of ['tele', 'pizarra'] as const) this.screens.off(id);
    this.props.resetBall();
    this.props.robotLevel(0);
    this.resume(true);
  }

  private setFreeRoam(on: boolean): void {
    SESSION.freeRoam = on;
    this.hud.setFreeRoam(on);
    if (on) {
      this.applyLocks(true);
      this.locksDirty = false;
    } else {
      // Esperar a la planta baja evita dejar al jugador encerrado arriba.
      this.locksDirty = true;
    }
  }

  private startFreeRoam(): void {
    this.setFreeRoam(true);
    this.resume(true);
    const feet = this.worldOf({ u: START.feet.u, v: START.feet.v, level: 0 });
    const look = toWorld(this.frame, START.look.u, START.look.v);
    this.player.teleport(feet, { x: look.x, y: START.look.y, z: look.z });
  }

  private resume(fromTitle: boolean): void {
    SESSION.started = true;
    SESSION.atTitle = false;
    this.mode = 'play';
    this.hud.hideTitle();
    this.menus?.close();
    this.menuHints = false;
    this.xrTitleInPlace = false;
    this.panel?.hide();
    // El modo libre sólo saca las cerraduras: no toca la partida guardada.
    this.applyLocks(false);
    this.syncStations(true);
    this.refreshObjectives(false);
    this.setPhase(this.storyPhase());
    this.repaintScreens();
    this.applyPause();
    // Partida retomada en pleno simulacro: las flechas vuelven a estar.
    if (this.engine.available('c3.evacuar') && !this.drill) void this.scriptDrill();
    const fresh = this.engine.data.done.length === 0;
    if (fresh && fromTitle && !SESSION.freeRoam) void this.intro();
    else if (fresh && !SESSION.freeRoam) void this.intro();
    else {
      this.music('none');
      if (fromTitle && !SESSION.freeRoam) {
        const ch = chapter(this.engine.currentChapter());
        this.hud.chapterCard(ch.kicker, ch.title);
      }
    }
  }

  /** Prólogo: frente al portal, Lola saluda, Rubén espera. */
  private async intro(): Promise<void> {
    this.setModal('cutscene');
    await this.hud.fade(true, 350);
    const feet = this.worldOf({ u: START.feet.u, v: START.feet.v, level: 0 });
    const look = toWorld(this.frame, START.look.u, START.look.v);
    this.player.teleport(feet, { x: look.x, y: START.look.y, z: look.z });
    this.syncStations(true);
    await this.wait(0.35);
    void this.hud.fade(false, 1100);
    this.music('intro');
    this.hud.chapterCard('Prólogo', 'Llegada a Laprida', 3.6);
    this.vrToast('Prólogo', 'Llegada a Laprida');
    this.endCutscene();
    await this.wait(1.6);
    // Lola saluda sin hablar: no comenta por su cuenta (lo pidió el usuario);
    // la misión sale en el panel de objetivos.
    this.npc('lola')?.handle?.play('wave');
  }

  // ===================================================================== cuadro

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    // El menú del visor (inicio o pausa) detiene el reloj de la historia,
    // como el menú de pausa del escritorio.
    const paused = this.hud.paused || this.xrMenuOpen;
    if (!paused) {
      this.clock += dt;
      if (this.mode === 'play' && SESSION.started && !SESSION.freeRoam) this.engine.tick(dt);
    }
    this.props.update(dt);
    this.screens.flush();
    this.panel?.update(dt);
    this.runTimers();
    if (this.inXR) this.xrFrame(dt);

    if (this.mode === 'title') {
      this.titleCamera(dt);
      this.markers.setDiamonds([]);
      if (this.inXR) this.xrWorldHits(false);
      return;
    }

    const feet = this.player.feet();
    this.feet = feet;
    const { u, v } = toLocal(this.frame, feet.x, feet.z);
    this.feetLocal = { u, v };
    this.level = levelAt(u, v, feet.y);
    const eye = this.eye();
    this.doors.update(dt, { u, v, level: this.level }, this.population.forEachPerson?.bind(this.population));
    try {
      this.audio.setListener(eye, this.player.forward());
    } catch {
      // El audio es opcional.
    }

    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = 0.25;
      this.sense();
    }
    if (!paused) {
      this.updateFollow();
      this.updateActivity(dt);
      if (this.drill) this.updateDrill(dt);
    }
    this.updateFocus(feet, eye);
    this.updateMarkers();
    this.mapT -= dt;
    if (this.mapT <= 0) {
      this.mapT = 0.1;
      this.updateMap();
    }
    this.saveT -= dt;
    if (this.saveT <= 0) {
      // El tiempo de juego se guarda cada tanto; los cambios de historia, al momento.
      this.saveT = 10;
      this.save();
    }
  };

  /** Lo que se consulta 4 veces por segundo: lugar, zona de audio, objetivos de "llegar". */
  private sense(): void {
    this.refreshCandidates();
    const { u, v } = this.feetLocal;
    const room = roomAt(u, v, this.level);
    const id = room?.id ?? outsideRoom(u, v);
    if (id !== this.room) {
      this.room = id;
      this.roomName = room ? roomLabel(room) : id === '__encuentro' ? 'Punto de encuentro' : id === '__laprida' ? 'Vereda de Laprida' : '';
      this.hud.setPlace(this.roomName);
      const place = placeForRoom(id);
      if (place && SESSION.started && !SESSION.freeRoam) this.react(this.engine.enterPlace(place.id));
    }
    this.hud.setLevelBadge(this.level === 0 ? 'PB' : `${this.level}° PISO`);
    if (this.locksDirty && safeToRelock({ u, v, level: this.level, room: this.room }, this.engine.zone('entrada'))) {
      this.locksDirty = false;
      this.applyLocks(false);
    }
    if (this.cardAt && Math.hypot(this.cardAt.u - u, this.cardAt.v - v) > 4) {
      this.cardAt = null;
      this.hud.closeCard();
    }
    if (SESSION.started && !SESSION.freeRoam && this.modal === null) this.react(this.engine.atSpot(u, v, this.level));
    // Distancia al objetivo, en el panel.
    const t = this.targetOf(this.engine.mainObjectives()[0]);
    const text = !t ? '' : t.spot.level !== this.level && inLot(u, v) ? (t.spot.level > this.level ? '▲ arriba' : '▼ abajo') : `${Math.round(Math.hypot(t.spot.u - u, t.spot.v - v))} m`;
    if (text !== this.distanceText) {
      this.distanceText = text;
      this.hud.setDistance(text);
    }
    if (this.inXR && this.xrControls) this.updateWrist();
  }

  /** Muñeca del visor: lugar, capítulo, objetivo, distancia y sellos (sólo al cambiar), y la flecha al objetivo. */
  private updateWrist(): void {
    const c = this.xrControls;
    if (!c) return;
    const free = SESSION.freeRoam;
    // En el paseo libre no hay misión: ni objetivo, ni flecha, ni capítulo.
    const o = free ? undefined : this.engine.mainObjectives()[0];
    const info: HudInfo = {
      // Fuera de los ambientes con nombre: la escuela o la calle (no la marca: no es un lugar).
      place: this.roomName || (inLot(this.feetLocal.u, this.feetLocal.v) ? 'Escuela CIMDIP' : ''),
      progress: free ? 'Toda la escuela abierta · sin misiones' : this.progressText,
      objective: free ? 'Toda la escuela abierta · sin misiones' : o ? this.engine.objectiveTitle(o) : 'Recorrido completo',
      distance: free ? '' : this.distanceText,
      stamps: `${this.engine.stamps}/${TOTAL_STAMPS} sellos`,
      chapter: free ? undefined : chapter(this.engine.currentChapter()).kicker,
      mapCanvas: this.hud.minimap.sourceCanvas,
      mapKey: this.xrMapKey,
      mapLevel: this.level === 0 ? 'PB' : `${this.level}°`,
      freeRoam: free,
    };
    const key = `${info.place}|${info.progress}|${info.objective}|${info.distance}|${info.stamps}|${info.chapter}|${info.mapKey}|${free ? 1 : 0}`;
    if (key !== this.wristKey) {
      this.wristKey = key;
      c.setHud(info);
    }
    // En otro piso, la flecha lleva a la escalera (como el rombo del objetivo).
    const raw = this.targetOf(o);
    const t = raw ? this.guideTo(raw).world : null;
    const tKey = t ? `${Math.round(t.x * 4)},${Math.round(t.y * 4)},${Math.round(t.z * 4)}` : '';
    if (tKey !== this.targetKey) {
      this.targetKey = tKey;
      c.setObjectiveTarget(t);
    }
  }

  // ================================================================== personajes

  private spawn(def: CharacterDef): void {
    const st = this.engine.stationFor(def.id);
    const place = st ? this.stationSpot(st) : { spot: { u: ENTRANCE_U, v: planV(3), level: 0 as Level }, yaw: 0 };
    let handle: NpcHandle | null = null;
    try {
      // Si la gente sobrevivió a una reconstrucción, el personaje ya existe: se reusa.
      handle = this.population.character(def.id);
      if (handle) handle.teleport(place.spot, place.yaw);
      else handle = this.population.spawnCharacter(def.id, def.look, place.spot, place.yaw);
      handle.setLookAtPlayer(true);
      handle.setVisible(true);
    } catch (err) {
      console.warn(`[recorrido40] No se pudo crear a ${def.name}:`, err);
    }
    this.npcs.push({
      def,
      handle,
      station: st,
      at: place.spot,
      following: Boolean(st?.follow),
      busy: false,
      walking: false,
      followTarget: null,
      nextFollow: 0,
    });
  }

  private npc(id: string): NpcSlot | undefined {
    return this.npcs.find((n) => n.def.id === id);
  }

  /** Lugar de pie y rumbo de una estación (calculado una vez). */
  private stationSpot(st: StationDef): { spot: Spot; yaw: number } {
    const hit = this.stationSpots.get(st);
    if (hit) return hit;
    const r = resolveAnchor(st.at);
    const s = standNear(r, { min: 0 });
    let yaw = 0;
    if (typeof st.face === 'string') yaw = yawCardinal(st.face);
    else if (st.face) {
      const f = resolveAnchor(st.face);
      yaw = yawLocal(s, f);
    }
    const out = { spot: { u: s.u, v: s.v, level: s.level }, yaw };
    this.stationSpots.set(st, out);
    return out;
  }

  /** Posición actual de un personaje (del personaje real si existe). */
  private npcSpot(n: NpcSlot): Spot {
    if (n.handle) {
      try {
        const p = n.handle.position();
        const { u, v } = toLocal(this.frame, p.x, p.z);
        n.at = { u, v, level: levelAt(u, v, p.y) };
      } catch {
        // Se queda con la última posición conocida.
      }
    }
    return n.at;
  }

  private worldOf(s: Spot, dy = 0): WorldPoint {
    const W = toWorld(this.frame, s.u, s.v);
    return { x: W.x, y: LEVEL_Y[s.level] + dy, z: W.z };
  }

  /** ¿El jugador ve (más o menos) este punto? Para no teletransportar a nadie a la vista. */
  private seen(s: Spot): boolean {
    if (s.level !== this.level) return false;
    const du = s.u - this.feetLocal.u;
    const dv = s.v - this.feetLocal.v;
    const d = Math.hypot(du, dv);
    if (d > 16) return false;
    if (d < 2.5) return true;
    const f = this.player.forward();
    // Adelante del jugador en coordenadas del plano: (−fx, fz).
    const dot = (-f.x * du + f.z * dv) / (Math.hypot(f.x, f.z) * d || 1);
    return dot > 0.3;
  }

  private teleportNpc(n: NpcSlot, spot: Spot, yaw: number): void {
    n.at = spot;
    n.walking = false;
    try {
      n.handle?.teleport(spot, yaw);
    } catch {
      // Personaje no disponible.
    }
  }

  private walkNpc(n: NpcSlot, spot: Spot, yaw: number, run = false): void {
    if (!n.handle) {
      n.at = spot;
      return;
    }
    n.walking = true;
    const h = n.handle;
    h.goTo(spot, { run })
      .then((ok) => {
        n.walking = false;
        if (!ok && !this.seen(n.at)) this.teleportNpc(n, spot, yaw);
        else if (ok) {
          n.at = spot;
          const W = toWorld(this.frame, spot.u + Math.sin(-yaw), spot.v + Math.cos(yaw));
          h.face({ x: W.x, z: W.z });
          const st = n.station;
          if (st && !st.follow && !n.busy) h.play(stationAnim(st), true);
        }
      })
      .catch(() => {
        n.walking = false;
      });
  }

  /** Lleva a cada personaje a donde lo pone la historia ahora. */
  private syncStations(instant: boolean): void {
    for (const n of this.npcs) {
      const st = this.engine.stationFor(n.def.id);
      if (!st) continue;
      if (!instant && st === n.station) continue;
      n.station = st;
      if (n.busy) continue;
      if (st.follow) {
        n.following = true;
        if (instant) this.placeBehindPlayer(n, true);
        continue;
      }
      n.following = false;
      const { spot, yaw } = this.stationSpot(st);
      const here = this.npcSpot(n);
      if (instant || !this.seen(here) || here.level !== spot.level || Math.hypot(here.u - spot.u, here.v - spot.v) > 30) {
        this.teleportNpc(n, spot, yaw);
        n.handle?.play(stationAnim(st), true);
      } else {
        this.walkNpc(n, spot, yaw);
      }
    }
  }

  /** Un lugar libre detrás del jugador (para quien lo acompaña). */
  private behindPlayer(dist = 1.5): Spot {
    const f = this.player.forward();
    const fl = Math.hypot(f.x, f.z) || 1;
    // Adelante en el plano: (−fx, fz). Detrás y un poco a la derecha.
    const fu = -f.x / fl;
    const fv = f.z / fl;
    const u = this.feetLocal.u - fu * dist - fv * 0.7;
    const v = this.feetLocal.v - fv * dist + fu * 0.7;
    const level = this.level;
    if (standable(u, v, level)) return { u, v, level };
    const s = standNear({ u, v, level, room: roomIdAt(u, v, level) }, { min: 0, max: 2.5, prefer: null });
    return s.ok ? { u: s.u, v: s.v, level } : { u: this.feetLocal.u, v: this.feetLocal.v, level };
  }

  private placeBehindPlayer(n: NpcSlot, force = false): void {
    const s = this.behindPlayer();
    if (!force && this.seen(s)) return;
    this.teleportNpc(n, s, yawLocal(s, this.feetLocal));
  }

  /** Quien acompaña al jugador (Lola) lo sigue de cerca sin pegarse. */
  private updateFollow(): void {
    for (const n of this.npcs) {
      if (!n.following || n.busy || this.clock < n.nextFollow) continue;
      n.nextFollow = this.clock + 0.4;
      const at = this.npcSpot(n);
      const d = Math.hypot(at.u - this.feetLocal.u, at.v - this.feetLocal.v);
      if (at.level !== this.level || d > 24) {
        // Quedó en otro piso o muy lejos: aparece detrás, fuera de la vista.
        if (!this.seen(at)) this.placeBehindPlayer(n);
        continue;
      }
      if (d > 3.4) {
        const target = this.behindPlayer();
        const moved = !n.followTarget || Math.hypot(target.u - n.followTarget.u, target.v - n.followTarget.v) > 1.6;
        if (!n.walking || moved) {
          n.followTarget = target;
          this.walkNpc(n, target, yawLocal(target, this.feetLocal), d > 8);
        }
      } else if (!n.walking && n.handle) {
        const P = this.worldOf({ ...this.feetLocal, level: this.level });
        n.handle.face({ x: P.x, z: P.z });
      }
    }
  }

  // ================================================================== cerraduras

  /** Pone o saca las puertas cerradas según la historia. */
  private applyLocks(animate: boolean): void {
    for (const l of LOCKS) {
      const locked = SESSION.started && !SESSION.freeRoam && !this.engine.zone(l.zone);
      setDynamicSolid(l.id, locked ? l.rect : null);
      this.props.setLock(l, locked, animate);
    }
    // Puertas del juego cerradas con llave (la de la portería al atrio): su
    // hoja y su colisión las maneja `Doors`.
    for (const l of DOOR_LOCKS) {
      const locked = SESSION.started && !SESSION.freeRoam && !this.engine.zone(l.zone);
      this.doors.setLocked(l.door.id, locked, !animate);
    }
  }

  private openZone(zone: ZoneId): void {
    for (const l of LOCKS) {
      if (l.zone !== zone) continue;
      setDynamicSolid(l.id, null);
      this.props.setLock(l, false, true);
      try {
        this.audio.door(true, this.props.lockCenter(l));
      } catch {
        // Audio opcional.
      }
    }
    // La puerta del juego se abre sola al sacarle la llave (y suena como cualquiera).
    for (const l of DOOR_LOCKS) if (l.zone === zone) this.doors.setLocked(l.door.id, false);
  }

  // =================================================================== efectos

  /** Presenta lo que pasó en la historia (y guarda). */
  private react(effects: readonly Effect[]): void {
    if (effects.length === 0) return;
    let objectivesChanged = false;
    for (const e of effects) {
      switch (e.do) {
        case 'complete': {
          objectivesChanged = true;
          const o = objective(e.id);
          if (o && !o.optional) this.notify('objective', 'Objetivo cumplido', this.engine.objectiveTitle(o));
          else if (o) this.notify('objective', 'Secundario cumplido', this.engine.objectiveTitle(o));
          this.sfx('objective');
          break;
        }
        case 'stamp':
          this.notify('stamp', `Sello: ${STAMPS[e.id].title}`, `Pasaporte 40 · ${this.engine.stamps}/${TOTAL_STAMPS}`);
          this.sfx('reward');
          this.repaintScreens();
          break;
        case 'unlock':
          if (!SESSION.freeRoam) {
            this.openZone(e.zone);
            this.notify('unlock', 'Se abrió', ZONES[e.zone]);
            this.sfx('unlock');
          }
          break;
        case 'item':
          this.notify('item', ITEMS_INFO[e.id]?.title ?? e.id, ITEMS_INFO[e.id]?.text);
          this.sfx('reward');
          break;
        case 'interview':
          this.notify('voice', 'Voces del recorrido', `Entrevista guardada (${this.engine.interviews})`);
          break;
        case 'activity':
          this.pendingActivity = e.id;
          break;
        case 'script':
          void this.script(e.id);
          break;
        case 'phase':
          this.setPhase(e.phase);
          break;
        case 'bark':
          this.bark(e.who, e.text);
          break;
        case 'toast':
          this.notify('info', e.title, e.text);
          break;
        case 'discover': {
          const p = PLACES.find((pl) => pl.id === e.place);
          if (p) this.notify('place', 'Lugar descubierto', p.title);
          break;
        }
        default:
          break;
      }
    }
    if (objectivesChanged) {
      this.syncStations(false);
      // Un "llegá a…" que se abre con el jugador ya adentro de ese lugar se
      // cumple ahí mismo: el atrio de la entrada es parte del hall (CAD) y a
      // Rubén se lo saluda parado en él; sin esto "Entrá a Recepción" esperaba
      // a que el jugador saliera a la vereda y volviera a entrar.
      const here = placeForRoom(this.room);
      if (here && SESSION.started && this.engine.availableObjectives().some((o) => o.target.kind === 'reach' && o.target.place === here.id)) {
        this.react(this.engine.enterPlace(here.id));
        return;
      }
    }
    this.refreshObjectives(true);
    this.refreshCandidates();
    this.save();
  }

  private notify(kind: Parameters<Hud['toast']>[0]['kind'], title: string, text?: string): void {
    this.hud.toast({ kind, title, text });
    this.vrToast(title, text);
  }

  private vrToast(title: string, text?: string): void {
    if (!this.inXR || !this.panel || !this.xr) return;
    const cam = this.xr.baseExperience.camera;
    const f = cam.getDirection(new Vector3(0, 0, 1));
    this.panel.showToast(cam.globalPosition, { x: f.x, z: f.z }, title, text);
  }

  private bark(who: string, text: string): void {
    // Sin frases nadie comenta nada: ni en el HUD, ni en el visor, ni con voz.
    if (!SESSION.phrases) return;
    const c = CHARACTERS.find((ch) => ch.id === who);
    if (!c) return;
    this.hud.bark(c.name, c.color, text, Math.min(9, 2.5 + text.length / 18));
    if (this.inXR) this.vrToast(c.name, text.length > 46 ? `${text.slice(0, 44)}…` : text);
    try {
      this.audio.voice(text, c.voice);
    } catch {
      // Audio opcional.
    }
  }

  private music(track: Parameters<AudioApi['music']>[0]): void {
    try {
      this.audio.music(track);
    } catch {
      // Audio opcional.
    }
  }

  private sfx(kind: Parameters<AudioApi['ui']>[0]): void {
    try {
      this.audio.ui(kind);
    } catch {
      // Audio opcional.
    }
  }

  /** Momento del día que corresponde al estado de la historia (al retomar una partida). */
  private storyPhase(): SchoolPhase {
    const e = this.engine;
    if (e.finished) return 'recreo';
    if (e.done('c5.juli')) return 'acto';
    if (e.available('c3.evacuar') || e.available('c3.ines')) return 'salida';
    if (e.done('c1.campana') && !e.done('c1.martin')) return 'recreo';
    return PHASE_BY_CHAPTER[e.currentChapter()];
  }

  private setPhase(phase: SchoolPhase): void {
    if (phase === this.phase && this.phaseSet) return;
    this.phaseSet = true;
    this.phase = phase;
    try {
      this.population.setSchoolPhase(phase);
    } catch {
      // Sin multitud.
    }
    this.doors.setPhase(phase);
    this.lights?.setPhase(phase);
    try {
      this.audio.setPhase(phase);
    } catch {
      // Audio opcional.
    }
  }

  private save(): void {
    if (SESSION.started) this.store.write(this.engine.serialize());
  }

  // =================================================================== objetivos

  private refreshObjectives(announce: boolean): void {
    const ch = this.engine.currentChapter();
    const main = this.engine.mainObjectives();
    const side = this.engine.sideObjectives();
    const def = chapter(ch);
    const title = (o: ObjectiveDef) => this.engine.objectiveTitle(o);
    const items = [
      ...main.slice(0, 3).map((o, k) => ({ text: title(o), hint: k === 0 ? o.hint : undefined, distance: k === 0 ? this.distanceText : undefined })),
      ...side.slice(0, 2).map((o) => ({ text: title(o), side: true })),
    ];
    if (ch === 'fin') items.push({ text: 'Seguí explorando: la escuela queda abierta.', hint: 'Reiniciá desde el menú para jugar otra vez.', distance: undefined });
    this.hud.setObjective({ chapter: def.kicker, title: def.title, items, stamps: this.engine.stamps, totalStamps: TOTAL_STAMPS });
    const first = main[0]?.id ?? '';
    if (announce && first && first !== this.currentMain) this.hud.flashObjective();
    this.currentMain = first;
    if (this.currentChapter !== null && ch !== this.currentChapter && announce) {
      if (this.currentChapter === 'prologo') {
        // La música del inicio acompaña la llegada; con la misión en marcha, el ambiente de la escuela.
        this.music('none');
      }
      this.hud.chapterCard(def.kicker, def.title);
      this.vrToast(def.kicker, def.title);
      // El recreo, el simulacro y el acto mandan sobre el capítulo.
      if (ch !== 'fin' && this.phase !== 'recreo' && this.phase !== 'acto' && this.phase !== 'salida') this.setPhase(PHASE_BY_CHAPTER[ch]);
    }
    this.currentChapter = ch;
  }

  /** Dónde está el objetivo (en el plano y en el mundo). */
  private targetOf(o: ObjectiveDef | undefined): { spot: Spot; world: WorldPoint; ring?: number } | null {
    if (!o) return null;
    const t = o.target;
    switch (t.kind) {
      case 'talk': {
        const n = this.npc(t.npc);
        if (!n) return null;
        const s = this.npcSpot(n);
        return { spot: s, world: this.worldOf(s, 2.3) };
      }
      case 'interact': {
        const it = this.items.find((i) => i.def.id === t.id);
        if (!it) return null;
        const h = (it.def.size?.[1] ?? 0.6) / 2;
        return { spot: it.at, world: { x: it.x, y: it.y + h + 0.45, z: it.z } };
      }
      case 'reach': {
        const place = PLACES.find((p) => p.id === t.place);
        const r = place ? resolveAnchor({ room: place.rooms[0] }) : null;
        if (!r) return null;
        return { spot: r, world: this.worldOf(r, 2.2) };
      }
      case 'spot': {
        const r = resolveAnchor(t.anchor);
        return { spot: r, world: this.worldOf(r, 1.9), ring: t.radius };
      }
      case 'collect': {
        let best: ItemSlot | null = null;
        let bd = Infinity;
        for (const id of t.ids) {
          if (this.engine.flag(`got:${id}`)) continue;
          const it = this.items.find((i) => i.def.id === id);
          if (!it) continue;
          const d = Math.hypot(it.at.u - this.feetLocal.u, it.at.v - this.feetLocal.v) + Math.abs(it.at.level - this.level) * 12;
          if (d < bd) {
            bd = d;
            best = it;
          }
        }
        if (!best) return null;
        return { spot: best.at, world: { x: best.x, y: best.y + 0.6, z: best.z } };
      }
    }
  }

  /**
   * Si el objetivo está en otro piso, el marcador lleva a la escalera abierta
   * más cercana que sube (o baja) hacia él.
   */
  private guideTo(t: { spot: Spot; world: WorldPoint; ring?: number }): { spot: Spot; world: WorldPoint; ring?: number } {
    if (t.spot.level === this.level || !inLot(this.feetLocal.u, this.feetLocal.v)) return t;
    const up = t.spot.level > this.level;
    const targetJardin = isJardinRoom(roomIdAt(t.spot.u, t.spot.v, t.spot.level));
    const hereJardin = isJardinRoom(this.room);
    let best: Spot | null = null;
    let bd = Infinity;
    for (const g of STAIR_GUIDES) {
      if (g.zone && !this.engine.zone(g.zone) && !SESSION.freeRoam) continue;
      const from = up ? g.low : g.high;
      if (from.level !== this.level) continue;
      if (Boolean(g.jardin) !== (up ? targetJardin : hereJardin)) continue;
      const d = Math.hypot(from.u - this.feetLocal.u, from.v - this.feetLocal.v);
      if (d < bd) {
        bd = d;
        best = from;
      }
    }
    return best ? { spot: best, world: this.worldOf(best, 1.9) } : t;
  }

  // ================================================================= interacción

  /**
   * Lo que se puede usar ahora: objetos visibles, personajes y puertas
   * cerradas. Los objetos y las puertas se filtran 4 veces por segundo
   * (`refreshCandidates`); los personajes se mueven y se actualizan en cada
   * cuadro sin crear objetos nuevos.
   */
  private buildCandidates(): Candidate[] {
    for (const c of this.npcCands) {
      const n = this.npc(c.key.slice(4))!;
      const s = this.npcSpot(n);
      const W = toWorld(this.frame, s.u, s.v);
      c.x = W.x;
      c.z = W.z;
      c.baseY = LEVEL_Y[s.level];
      c.y = c.baseY + 1.35;
    }
    const ball = this.ballCand;
    if (ball) {
      const b = this.props.ballWorld();
      ball.x = b.x;
      ball.y = b.y + this.ballCandLift;
      ball.z = b.z;
    }
    this.candList.length = 0;
    // En la mano no se ofrece "Patear": soltarla (o lanzarla) ya la usa.
    for (const c of this.itemCandsVisible) if (c !== ball || !this.ballHand) this.candList.push(c);
    for (const c of this.npcCands) this.candList.push(c);
    for (const c of this.lockCandsVisible) this.candList.push(c);
    for (const c of this.doorCands) this.candList.push(c);
    for (const c of this.switchCands) this.candList.push(c);
    return this.candList;
  }

  /** Recalcula qué objetos existen y qué puertas siguen cerradas (y quién tiene novedades). */
  private refreshCandidates(): void {
    if (this.itemCands.length === 0) {
      for (const it of this.items) {
        const c: Candidate = { key: `it:${it.def.id}`, x: it.x, y: it.y, z: it.z, radius: it.radius, range: it.def.range ?? 2.6, baseY: it.baseY };
        this.itemCands.push(c);
        if (it.def.id === 'pelota') {
          this.ballCand = c;
          // La pelota descansa con el centro a 0,1 m del piso (GameProps).
          this.ballCandLift = it.y - (it.baseY + 0.1);
        }
      }
      for (const n of this.npcs) this.npcCands.push({ key: `npc:${n.def.id}`, x: 0, y: 0, z: 0, radius: 0.35, range: TALK_RANGE, baseY: 0 });
      for (const l of LOCKS) {
        const c = this.props.lockCenter(l);
        this.lockCands.push({ key: `lock:${l.id}`, x: c.x, y: c.y, z: c.z, radius: 0.6, range: 2.0, baseY: LEVEL_Y[l.rect.level] });
      }
      for (const d of this.doors.all) {
        const c = d.center;
        this.doorCands.push({ key: `door:${d.def.id}`, x: c.x, y: c.y, z: c.z, radius: 0.5, range: 2.1, baseY: LEVEL_Y[d.def.level] });
      }
      for (const r of this.lights?.all ?? []) {
        const c = r.center;
        this.switchCands.push({ key: `sw:${r.sw.roomId}`, x: c.x, y: c.y, z: c.z, radius: 0.22, range: 1.9, baseY: LEVEL_Y[r.sw.level] });
      }
    }
    this.itemCandsVisible = this.itemCands.filter((_c, k) => this.engine.interactableVisible(this.items[k].def));
    this.lockCandsVisible =
      SESSION.started && !SESSION.freeRoam ? this.lockCands.filter((_c, k) => !this.engine.zone(LOCKS[k].zone)) : [];
    this.newsNpcs.clear();
    for (const o of this.engine.availableObjectives()) if (o.target.kind === 'talk') this.newsNpcs.add(o.target.npc);
  }

  private updateFocus(feet: WorldPoint, eye: WorldPoint): void {
    this.candidates = this.buildCandidates();
    const blocked = this.mode !== 'play' || this.modal !== null || (!this.inXR && this.hud.modal) || this.xrMenuOpen || this.xrBusy;
    if (this.inXR) this.xrWorldHits(!blocked);
    if (blocked) {
      this.setFocus(null);
      this.lastFocusKey = '';
      return;
    }
    let f: Candidate | null = null;
    if (this.inXR) {
      // La mano del láser primero, después la otra; si ninguna apunta a
      // nada, alcanza con mirar a quien está cerca (como en la computadora):
      // hablar con un profe no exige puntería.
      const active = this.xrControls?.pointer.activeHand ?? 'right';
      const byHand = this.handFocus[active] ? active : this.handFocus[otherHand(active)] ? otherHand(active) : null;
      f = byHand ? this.handFocus[byHand] : focusByGaze(this.candidates, eye, this.player.forward(), feet, (c) => this.occluded(c, feet));
      // Algo nuevo bajo el láser (o la mirada): un tic en la mano. Con el
      // láser también un clic muy suave; con la mirada sola, sin sonido
      // (mirar alrededor no debería hacer ruido).
      const key = f?.key ?? '';
      if (key && key !== this.lastFocusKey) {
        this.fx('hover', byHand ?? active);
        if (byHand) this.hoverSound();
      }
      this.lastFocusKey = key;
    } else if (this.deps.canInteract?.() ?? true) {
      const dir = this.player.forward();
      f = focusByGaze(this.candidates, eye, dir, feet, (c) => this.occluded(c, feet));
    }
    this.setFocus(f);
  }

  /**
   * ¿Hay un muro entre el jugador y el objeto? Sólo cuenta entre ambientes
   * distintos: dentro del mismo, lo que hay en el medio (un cantero, una
   * mesa) es bajo y no tapa la vista.
   */
  private occluded(c: Candidate, feet: WorldPoint): boolean {
    const a = toLocal(this.frame, feet.x, feet.z);
    const b = toLocal(this.frame, c.x, c.z);
    const d = Math.hypot(b.u - a.u, b.v - a.v);
    if (d < 1.3) return false;
    const lv = levelOf(c.baseY + 0.1);
    if (roomIdAt(b.u, b.v, lv) === roomIdAt(a.u, a.v, this.level)) return false;
    const stop = d - Math.max(0.9, c.radius + 0.4);
    for (let s = 0.4; s < stop; s += 0.25) {
      const u = a.u + ((b.u - a.u) * s) / d;
      const v = a.v + ((b.v - a.v) * s) / d;
      if (schoolSolidLocal(u, v, feet.y)) return true;
    }
    return false;
  }

  private setFocus(f: Candidate | null): void {
    this.focus = f;
    if (!f) {
      this.hud.setPrompt(null);
      this.panel?.setLabel(null);
      return;
    }
    const { verb, target, locked } = this.describe(f.key);
    if (this.inXR) {
      this.hud.setPrompt(null);
      // Cerrado: el rótulo lo dice solo (no hay nada que apretar).
      this.panel?.setLabel(target, locked ? 'Cerrado' : `Gatillo o A · ${verb}`, { x: f.x, y: f.y + 0.75, z: f.z });
    } else {
      this.hud.setPrompt({ verb, target, locked }, () => this.interact(f.key));
    }
  }

  private describe(key: string): { verb: string; target: string; locked?: boolean } {
    const [kind, id] = key.split(':') as [string, string];
    if (kind === 'npc') {
      const n = this.npc(id)!;
      // Sin frases nadie contesta: a la gente se la saluda.
      return { verb: SESSION.phrases ? 'Hablar' : 'Saludar', target: `${n.def.name} · ${n.def.role}` };
    }
    if (kind === 'lock') return { verb: 'Cerrado', target: 'Puerta', locked: true };
    if (kind === 'door') {
      if (this.doors.isLocked(id)) return { verb: 'Cerrado', target: `Puerta · ${this.doors.label(id)}`, locked: true };
      return { verb: this.doors.isOpen(id) ? 'Cerrar' : 'Abrir', target: `Puerta · ${this.doors.label(id)}` };
    }
    if (kind === 'sw') return { verb: this.lights?.isOn(id) ? 'Apagar' : 'Encender', target: `Luces · ${this.lights?.label(id) ?? ''}` };
    const it = this.items.find((i) => i.def.id === id)!;
    const ready = this.engine.interactableReady(it.def);
    return { verb: ready ? it.def.verb : 'Mirar', target: it.def.label };
  }

  private interact(key: string): void {
    if (this.mode !== 'play' || this.modal !== null) return;
    const now = performance.now();
    if (now - this.lastPick < 250) return;
    this.lastPick = now;
    const [kind, id] = key.split(':') as [string, string];
    if (kind === 'npc') void this.talk(id);
    else if (kind === 'it') void this.useItem(id);
    else if (kind === 'sw') {
      const on = this.lights?.toggle(id) ?? false;
      this.audio.click(on ? 1500 : 1150);
      if (this.focus?.key === key) this.setFocus(this.focus);
    } else if (kind === 'door') {
      const l = this.doors.isLocked(id) ? DOOR_LOCKS.find((x) => x.door.id === id) : undefined;
      if (l) {
        this.sfx('error');
        this.notify('info', 'Está cerrado', (!SESSION.phrases && l.silentReason) || l.reason);
        return;
      }
      this.doors.toggle(id);
      // El texto del aviso cambia (Abrir ↔ Cerrar) sin esperar a mirar otra cosa.
      if (this.focus?.key === key) this.setFocus(this.focus);
    }
    else if (kind === 'lock') {
      const l = LOCKS.find((x) => x.id === id);
      if (l) {
        this.sfx('error');
        this.notify('info', 'Está cerrado', (!SESSION.phrases && l.silentReason) || l.reason);
      }
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (typingTarget(e) || isConsumed(e) || e.repeat) return;
    if (e.code !== 'KeyE' || this.mode !== 'play' || this.modal !== null || this.hud.modal) return;
    if (!this.focus) return;
    consume(e);
    this.interact(this.focus.key);
  };

  /**
   * Toque en la pantalla del celular: lo que señala el dedo (un rayo desde
   * la cámara por ese punto), con la misma regla que el láser del visor y
   * sin atravesar muros. Devuelve si había algo para usar.
   */
  tapAt(origin: WorldPoint, dir: WorldPoint): boolean {
    if (this.inXR || this.mode !== 'play' || this.modal !== null || this.hud.modal) return false;
    if (!(this.deps.canInteract?.() ?? true)) return false;
    const f = focusByRay(this.candidates, origin, dir, this.feet, 1);
    if (!f || this.occluded(f, this.feet)) return false;
    this.interact(f.key);
    return true;
  }

  // ===================================================================== diálogos

  private fill(text: string): string {
    const o = this.engine.mainObjectives()[0];
    const t = o ? this.engine.objectiveTitle(o) : '';
    const goal = o ? t.charAt(0).toLowerCase() + t.slice(1) : 'seguir explorando';
    return text.replace('{objetivo}', goal).replace('{sellos}', `${this.engine.stamps} de ${TOTAL_STAMPS}`);
  }

  private async talk(npcId: string): Promise<void> {
    const n = this.npc(npcId);
    if (!n) return;
    if (!SESSION.phrases) {
      this.greet(n);
      return;
    }
    const def = this.engine.dialogueFor(npcId);
    if (!def) {
      this.bark(npcId, n.def.idle[Math.floor(Math.random() * n.def.idle.length)] ?? '¡Hola!');
      return;
    }
    const runner = new DialogueRunner(def, this.engine);
    this.setModal('dialogue');
    this.sfx('open');
    const P = this.worldOf({ ...this.feetLocal, level: this.level });
    try {
      n.handle?.face({ x: P.x, z: P.z });
      n.handle?.setLookAtPlayer(true);
    } catch {
      // Personaje no disponible.
    }
    this.react(this.engine.apply(runner.start()));
    while (!runner.done && runner.node) {
      const node = runner.node;
      const who = CHARACTERS.find((c) => c.id === node.who);
      const speaker = who ?? n.def;
      const handle = this.npc(speaker.id)?.handle;
      if (node.anim) handle?.play(node.anim);
      const text = this.fill(node.text);
      try {
        this.audio.voice(text, speaker.voice);
      } catch {
        // Audio opcional.
      }
      const choices = runner.choices().map((c) => c.text);
      const line: LineView = { speaker: who ? who.name : n.def.name, role: who ? who.role : n.def.role, color: speaker.color, text, choices };
      const speakerAt = this.npcSpot(this.npc(speaker.id) ?? n);
      const pick = await this.ask({ kind: 'line', line }, this.worldOf(speakerAt));
      try {
        this.audio.stopVoice();
      } catch {
        // Audio opcional.
      }
      if (choices.length) this.sfx('select');
      this.react(this.engine.apply(runner.step(pick)));
    }
    this.closeModalUI();
    this.setModal(null);
    this.sfx('close');
    const st = n.station;
    if (st && !st.follow) n.handle?.play(stationAnim(st), true);
    const act = this.pendingActivity;
    this.pendingActivity = null;
    if (act) this.startActivity(act, npcId);
  }

  /**
   * Saludar sin frases: lo que la charla pendiente hacía avanzar pasa igual,
   * en silencio (`StoryEngine.silentTalk`: puertas, actividades, objetivos,
   * sellos), y el personaje contesta sólo con el cuerpo: se da vuelta y
   * saluda, señala o aplaude. Si la charla abría una actividad, empieza. Sin
   * nada pendiente, un saludo con la mano y un clic.
   */
  private greet(n: NpcSlot): void {
    const P = this.worldOf({ ...this.feetLocal, level: this.level });
    const { effects, anim } = this.engine.silentTalk(n.def.id);
    const due = effects.length > 0;
    this.greeted = { npc: n.def.id, at: this.clock, due };
    try {
      n.handle?.face({ x: P.x, z: P.z });
      n.handle?.setLookAtPlayer(true);
      n.handle?.play(anim ?? (due ? 'listen' : 'wave'));
    } catch {
      // Personaje no disponible.
    }
    this.click(due ? 880 : 660);
    this.react(effects);
    // El gesto es de una vez: después vuelve a lo que hacía en su lugar, si
    // sigue ahí y ningún guion (simulacro, créditos) tomó el control.
    const st = n.station;
    if (!effects.some((e) => e.do === 'script')) {
      this.after(2.2, () => {
        if (st && n.station === st && !st.follow && !n.busy && !n.walking && this.modal === null) n.handle?.play(stationAnim(st), true);
      });
    }
    const act = this.pendingActivity;
    this.pendingActivity = null;
    if (act) this.startActivity(act, n.def.id);
  }

  /** Muestra algo que espera una elección (HUD o panel del visor) y la devuelve. */
  private ask(model: PanelModel, toward?: WorldPoint): Promise<number> {
    return new Promise((resolve) => {
      const pick = (i: number) => {
        this.shown = null;
        resolve(i);
      };
      this.shown = { model, pick, toward: toward ? { x: toward.x, z: toward.z } : undefined };
      this.present();
    });
  }

  /** Dibuja lo que hay que mostrar en la interfaz que corresponde (HUD o visor). */
  private present(): void {
    const s = this.shown;
    if (!s) return;
    if (this.inXR && this.panel && this.xr) {
      this.hud.hideDialogue();
      this.hud.hideActivity();
      // El menú del visor está encima: lo de abajo vuelve al cerrarlo (closeXRMenu).
      if (this.xrMenuOpen) return;
      const fresh = !this.panel.visible || this.panelSize !== 'normal' || this.panel.kind !== s.model.kind;
      if (fresh) {
        const cam = this.xr.baseExperience.camera;
        cam.getDirectionToRef(FORWARD, this.tmpDir);
        this.panel.place(cam.globalPosition, { x: this.tmpDir.x, z: this.tmpDir.z }, s.toward);
        // Contenido nuevo: un gatillo apretado sobre lo anterior no elige nada
        // de esto. (Una actividad que sólo se redibuja conserva el gesto.)
        this.cancelPanelGestures();
      }
      this.panelSize = 'normal';
      // Una actividad que se redibuja mientras anima no es contenido nuevo.
      if (fresh || s.model.kind !== 'activity') this.seedLaser = true;
      this.panel.show(s.model, s.pick);
      return;
    }
    const m = s.model;
    if (m.kind === 'line') this.hud.showDialogue(m.line, s.pick);
    else if (m.kind === 'activity') this.hud.showActivity(m.view, s.pick);
    else if (m.kind === 'card') this.hud.showCard(m.card, () => s.pick(0));
  }

  private closeModalUI(): void {
    this.shown = null;
    this.hud.hideDialogue();
    this.hud.hideActivity();
    this.panel?.hide();
  }

  // ================================================================== objetos

  private async useItem(id: string): Promise<void> {
    const it = this.items.find((i) => i.def.id === id);
    if (!it) return;
    const def = it.def;
    if (!this.engine.interactableReady(def)) {
      this.sfx('error');
      const text = (!SESSION.phrases && def.silentNotReady) || def.notReady || 'Todavía no.';
      this.showCard({ kicker: def.label, title: def.label, text });
      return;
    }
    switch (def.kind) {
      case 'info':
        this.react(this.engine.interact(id));
        if (def.card) this.showCard(def.card);
        this.sfx('open');
        break;
      case 'screen':
        this.react(this.engine.interact(id));
        this.sfx('select');
        this.click(880);
        this.paintScreen(id === 'tele' ? 'tele' : 'pizarra', true);
        break;
      case 'bell': {
        const P = this.props.bellPosition();
        this.props.ringBell();
        if (this.engine.available('c1.campana')) {
          this.react(this.engine.interact(id));
        } else {
          try {
            this.audio.bell(P);
          } catch {
            // Audio opcional.
          }
          this.bark('lola', this.engine.done('c1.campana') ? '¡Ya tocamos la campana! Una vez por recreo alcanza.' : 'Todavía no es la hora del recreo: primero los tres sellos de la planta baja.');
        }
        break;
      }
      case 'printer':
        if (this.engine.item('llavero')) {
          this.showCard({ kicker: 'Aula Maker', title: 'Impresora 3D', text: 'Ya imprimiste el llavero del 40. La impresora deposita plástico capa por capa: por eso las piezas tienen esas líneas finitas.' });
          break;
        }
        this.setModal('cutscene');
        this.notify('info', 'Imprimiendo…', 'Capa por capa');
        await this.props.printKeychain();
        this.setModal(null);
        this.click(1200);
        this.react(this.engine.interact(id));
        break;
      case 'piano':
      case 'drums': {
        const notes = def.kind === 'piano' ? [523, 659, 784, 1046] : [140, 220, 140, 330];
        notes.forEach((p, k) => this.after(k * 0.18, () => this.click(p)));
        this.react(this.engine.interact(id));
        break;
      }
      case 'star':
        this.click(1320);
        this.react(this.engine.interact(id));
        {
          const got = ['estrellaAmarilla', 'estrellaRosa', 'estrellaRoja'].filter((s) => this.engine.flag(`got:${s}`)).length;
          if (got < 3) this.notify('item', `Estrella ${got} de 3`, def.label);
        }
        break;
      case 'locker':
        this.click(500);
        try {
          this.audio.door(true, { x: it.x, y: it.y, z: it.z });
        } catch {
          // Audio opcional.
        }
        this.react(this.engine.interact(id));
        break;
      case 'ball': {
        const f = this.player.forward();
        this.props.kickBall(-f.x, f.z, 7);
        this.click(180);
        this.react(this.engine.interact(id));
        break;
      }
      case 'bins':
      case 'activity':
        this.react(this.engine.interact(id));
        if (def.activity) this.startActivity(def.activity, null);
        break;
    }
  }

  private showCard(card: { kicker?: string; title: string; text: string }): void {
    if (this.inXR && this.panel) {
      this.setModal('card');
      void this.ask({ kind: 'card', card }).then(() => {
        this.closeModalUI();
        this.setModal(null);
      });
      return;
    }
    // En escritorio la ficha no detiene el juego: se cierra con E o alejándose.
    this.cardAt = { ...this.feetLocal };
    this.hud.showCard(card, () => {
      this.cardAt = null;
    });
  }

  private click(pitch: number): void {
    try {
      this.audio.click(pitch);
    } catch {
      // Audio opcional.
    }
  }

  // ================================================================= actividades

  private startActivity(id: ActivityId, host: string | null): void {
    const act = createActivity(id, Math.random, SESSION.phrases);
    this.activity = { id, act, version: -1, host };
    this.setModal('activity');
    this.sfx('open');
    if (act instanceof RobotRoute) this.props.robotLevel(act.levelIndex);
    if (act instanceof Penalty) this.penaltySetup(true);
    this.renderActivity();
  }

  private renderActivity(): void {
    const a = this.activity;
    if (!a) return;
    a.version = a.act.version;
    const view = a.act.view();
    const toward = a.host ? this.worldOf(this.npcSpot(this.npc(a.host)!)) : undefined;
    this.shown = { model: { kind: 'activity', view }, pick: (i) => this.onActivityPick(i), toward: toward ? { x: toward.x, z: toward.z } : undefined };
    this.present();
  }

  private onActivityPick(i: number): void {
    const a = this.activity;
    if (!a) return;
    const view: ActivityView = a.act.view();
    const c = view.choices[i];
    if (!c || c.disabled) return;
    if (c.exit) {
      this.endActivity(false);
      this.notify('info', 'Actividad en pausa', 'Podés volver cuando quieras.');
      return;
    }
    a.act.input(i);
    if (a.act.version !== a.version) this.renderActivity();
  }

  private updateActivity(dt: number): void {
    const a = this.activity;
    if (!a) return;
    a.act.update(dt);
    for (const e of a.act.drainEvents()) {
      switch (e.type) {
        case 'good':
          this.click(990);
          break;
        case 'bad':
          this.sfx('error');
          break;
        case 'select':
          this.sfx('select');
          break;
        case 'step':
          this.click(a.act instanceof DanceSequence ? [440, 554, 659, 880][e.index] ?? 660 : 640);
          break;
        case 'demo': {
          this.click([440, 554, 659, 880][e.move] ?? 660);
          const anims: NpcAnim[] = ['point', 'lookAround', 'clap', 'wave'];
          this.npc('ana')?.handle?.play(anims[e.move] ?? 'wave');
          break;
        }
        case 'shot':
          this.click(240);
          this.keeperDive(a.act as Penalty);
          break;
        case 'finish':
          if (e.success) this.sfx('reward');
          break;
      }
    }
    if (a.act instanceof RobotRoute) {
      if (this.props.robotLevelShown !== a.act.levelIndex && !a.act.running) this.props.robotLevel(a.act.levelIndex);
      const p = a.act.pose();
      this.props.robotPose(p.x, p.y, p.dir);
    } else if (a.act instanceof Penalty) {
      this.props.setShot(a.act.shot());
    }
    // En el visor el panel es una textura grande: durante una animación se
    // redibuja a 10 Hz como mucho (en escritorio, cada cambio).
    if (a.act.version !== a.version && (!this.inXR || this.clock - this.actDrawn >= 0.1)) {
      this.actDrawn = this.clock;
      this.renderActivity();
    }
    if (a.act.closed) this.endActivity(true);
  }

  private endActivity(completed: boolean): void {
    const a = this.activity;
    if (!a) return;
    this.activity = null;
    this.closeModalUI();
    this.setModal(null);
    this.sfx('close');
    if (a.act instanceof Penalty) this.penaltySetup(false);
    if (a.act instanceof RobotRoute && !completed) this.props.robotLevel(0);
    if (completed) this.react(this.engine.activityResult(a.id, a.act.success, a.act.score === a.act.maxScore));
  }

  /** Penales: Lola al arco, el jugador detrás de la línea de siete metros. */
  private penaltySetup(on: boolean): void {
    const lola = this.npc('lola');
    if (on) {
      if (lola) {
        lola.busy = true;
        this.teleportNpc(lola, { u: GOAL_MOUTH_U - 0.55, v: PENALTY_SPOT.v, level: 0 }, yawCardinal('w'));
        lola.handle?.play('idle', true);
      }
      this.props.setShot(null);
      const from = this.worldOf({ u: PENALTY_SPOT.u - 1.2, v: PENALTY_SPOT.v, level: 0 });
      const goal = this.worldOf({ u: GOAL_MOUTH_U, v: PENALTY_SPOT.v, level: 0 }, 1.0);
      this.player.teleport(from, goal);
    } else {
      if (lola) {
        lola.busy = false;
        lola.station = null;
      }
      this.props.resetBall();
      this.syncStations(false);
    }
  }

  private keeperDive(p: Penalty): void {
    const s = p.shot();
    const lola = this.npc('lola');
    if (!s || !lola?.handle) return;
    // Se tira hacia su lado: un paso rápido (la animación de correr vende el salto).
    this.after(0.12, () => {
      lola.handle?.play('run');
      this.teleportNpc(lola, { u: GOAL_MOUTH_U - 0.55, v: PENALTY_SPOT.v + s.keeper * 0.9, level: 0 }, yawCardinal('w'));
    });
    this.after(1.6, () => {
      this.teleportNpc(lola, { u: GOAL_MOUTH_U - 0.55, v: PENALTY_SPOT.v, level: 0 }, yawCardinal('w'));
      lola.handle?.play(s.saved ? 'clap' : 'idle');
    });
  }

  // ===================================================================== guiones

  private async script(id: string): Promise<void> {
    switch (id) {
      case 'recreo':
        return this.scriptRecreo();
      case 'simulacro':
        return this.scriptDrill();
      case 'simulacroFin':
        return this.scriptDrillEnd();
      case 'acto':
        return this.scriptAct();
      case 'creditos':
        return this.scriptCredits();
      case 'pizarraSimulacro':
        return this.boardWrite('SIMULACRO', [
          '1. Dejar todo y escuchar a la seño',
          '2. Salir caminando: sin correr ni empujar',
          '3. Seguir las flechas verdes',
          '4. Punto de encuentro: Laprida y Miguel Cané',
        ]);
    }
  }

  private async scriptRecreo(): Promise<void> {
    const P = this.props.bellPosition();
    try {
      this.audio.bell(P);
    } catch {
      // Audio opcional.
    }
    await this.wait(1.4);
    try {
      this.audio.bell(P);
    } catch {
      // Audio opcional.
    }
    // Un recreo dura lo que dura: después la escuela vuelve a clase.
    this.after(80, () => {
      if (this.phase === 'recreo') this.setPhase('clase');
    });
  }

  private async scriptDrill(): Promise<void> {
    // Alarma: la campana tres veces, sin posición (se oye en toda la escuela).
    for (let k = 0; k < 3; k++) {
      this.after(k * 0.7, () => {
        try {
          this.audio.bell();
        } catch {
          // Audio opcional.
        }
      });
    }
    const arrows: Glow[] = [];
    for (let i = 0; i < EVAC_ROUTE.length - 1; i++) {
      const [u0, v0] = EVAC_ROUTE[i];
      const [u1, v1] = EVAC_ROUTE[i + 1];
      const len = Math.hypot(u1 - u0, v1 - v0);
      const n = Math.max(1, Math.round(len / 2.2));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const W = toWorld(this.frame, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t);
        // +X de la flecha hacia adelante: (du, dv) del plano → mundo (−du, dv).
        arrows.push({ x: W.x, y: LEVEL_Y[0] + 0.05, z: W.z, size: 0.8, color: GREEN, yaw: Math.atan2(-(v1 - v0), -(u1 - u0)) });
      }
    }
    this.drill = { t: 0, arrows, next: 0 };
    this.hud.setDrill(0);
    this.notify('info', 'Simulacro de evacuación', 'Seguí las flechas verdes, caminando');
  }

  private updateDrill(dt: number): void {
    const d = this.drill;
    if (!d) return;
    d.t += dt;
    this.drillTime = d.t;
    this.hud.setDrill(d.t);
    // Las flechas ya pasadas se apagan: sólo se ve el camino que falta.
    const P = this.worldOf({ ...this.feetLocal, level: 0 });
    for (let k = d.next; k < d.arrows.length; k++) {
      const a = d.arrows[k];
      if (Math.hypot(a.x - P.x, a.z - P.z) < 1.6) d.next = k + 1;
    }
    this.markers.setArrows(d.arrows.slice(d.next));
  }

  private async scriptDrillEnd(): Promise<void> {
    this.drill = null;
    this.markers.setArrows([]);
    this.hud.setDrill(null);
    const s = Math.round(this.drillTime);
    this.notify('info', 'Llegaste al punto de encuentro', `Evacuación en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    this.npc('ines')?.handle?.play('wave');
  }

  private async scriptAct(): Promise<void> {
    this.setModal('cutscene');
    await this.hud.fade(true, 600);
    this.setPhase('acto');
    this.music('act');
    const stage = this.worldOf(ACT.stage, 1.55);
    this.player.teleport(this.worldOf(ACT.player), stage);
    this.syncStations(true);
    for (const n of this.npcs) {
      // Sin frases Inés no da un discurso: saluda al público desde el escenario.
      if (n.def.id === 'ines') n.handle?.play(SESSION.phrases ? 'talk' : 'wave', SESSION.phrases);
      else if (n.station?.anim) n.handle?.play('listen', true);
    }
    await this.wait(0.5);
    void this.hud.fade(false, 1000);
    this.hud.chapterCard('El acto', '40 años', 3);
    this.vrToast('El acto', '40 años');
    await this.wait(2.6);
    this.endCutscene();
    await this.talk('ines');
  }

  private async scriptCredits(): Promise<void> {
    for (const n of this.npcs) n.handle?.play('clap', true);
    this.sfx('reward');
    await this.wait(3.2);
    // Si la última línea del acto sigue abierta, se espera a que termine.
    for (let g = 0; g < 600 && this.modal !== null; g++) await this.wait(0.2);
    this.music('credits');
    const d = this.engine.data;
    // Sin frases no hubo discurso ni entrevistas: los créditos no citan a nadie.
    const phrases = SESSION.phrases;
    const speech = !phrases
      ? ''
      : ({ personas: '«Las personas: cada una me enseñó algo.»', espacios: '«Los espacios para crear, jugar y aprender.»', cuidado: '«Que acá nos cuidamos entre todos.»' }[
          this.engine.choice('discurso') ?? 'personas'
        ] ?? '');
    const mins = Math.max(1, Math.round(d.seconds / 60));
    const stats = [
      { value: `${this.engine.stamps}/${TOTAL_STAMPS}`, label: 'SELLOS' },
      { value: `${this.engine.places}/${PLACES.length}`, label: 'LUGARES' },
      ...(phrases ? [{ value: `${this.engine.interviews}`, label: 'VOCES' }] : []),
    ];
    const lines = [
      '#Recorrido 40',
      'Escuela CIMDIP & Miguel Cané',
      'Laprida y Miguel Cané',
      '',
      '#Personajes (ficticios)',
      ...CHARACTERS.map((c) => `${c.name} · ${c.role}`),
      '',
      ...(phrases && Object.keys(d.interviews).length
        ? ['#Voces del recorrido', ...Object.entries(d.interviews).map(([who, q]) => `«${q}» — ${CHARACTERS.find((c) => c.id === who)?.name ?? who}`), '']
        : []),
      '#La escuela',
      'Reconstruida desde el plano de evacuación',
      'y el recorrido virtual de 2020',
      '',
      '#Hecho con código',
      'Geometría, texturas y sonido generados en el navegador',
      'Babylon.js · WebXR',
      '',
      `Tiempo de juego: ${mins} min`,
      '',
      '#¡Gracias por recorrer la escuela!',
    ];
    if (this.inXR && this.panel) {
      this.setModal('card');
      const text = phrases
        ? `Tu mensaje en el acto: ${speech} Sellos ${stats[0].value} · lugares ${stats[1].value} · voces ${stats[2].value}.`
        : `Sellos ${stats[0].value} · lugares ${stats[1].value}.`;
      await this.ask({ kind: 'menu', kicker: 'Recorrido 40 completo', title: '¡Felicitaciones!', text, buttons: ['Seguir explorando'] });
      this.closeModalUI();
      this.setModal(null);
      this.setPhase('recreo');
      this.music('none');
      return;
    }
    this.setModal('cutscene');
    this.hud.showCredits({ speech: speech ? `Tu mensaje en el acto: ${speech}` : '', stats, lines }, () => {
      this.setModal(null);
      this.setPhase('recreo');
      this.music('none');
      this.syncStations(true);
    });
  }

  // ===================================================================== marcas

  private updateMarkers(): void {
    const diamonds: Glow[] = [];
    // Sin HUD (capturas limpias o herramientas), tampoco marcas en el mundo.
    if (!SESSION.hud) {
      this.markers.setDiamonds(diamonds);
      this.markers.setRing(null);
      return;
    }
    const t = this.clock;
    const bob = Math.sin(t * 2.4) * 0.06;
    if (this.mode === 'play') {
      // Objetivo principal: rombo dorado grande (o la escalera que lleva a él).
      const raw = this.targetOf(this.engine.mainObjectives()[0]);
      const target = raw ? this.guideTo(raw) : null;
      const focusKey = this.focus?.key ?? '';
      if (target && this.modal === null && !SESSION.freeRoam) {
        diamonds.push({ ...target.world, y: target.world.y + bob, size: 0.3, color: GOLD, yaw: t * 1.5 });
        if (target.ring && target.spot === raw?.spot) {
          const W = this.worldOf(target.spot);
          this.markers.setRing({ ...W, radius: target.ring * 0.45, pulse: t * 3 });
        } else this.markers.setRing(null);
      } else this.markers.setRing(null);
      // Objetos cercanos: rombos tenues; el enfocado, dorado.
      if (this.modal === null) {
        const feet = this.feet;
        for (const c of this.candidates) {
          if (c.key.startsWith('lock:')) continue;
          const d = Math.hypot(c.x - feet.x, c.z - feet.z);
          const focused = c.key === focusKey;
          if (!focused && (d > 7 || Math.abs(c.baseY - feet.y) > 1.3)) continue;
          const npc = c.key.startsWith('npc:');
          const hasNews = npc && this.newsNpcs.has(c.key.slice(4));
          if (npc && !focused && !hasNews) continue;
          const y = npc ? c.baseY + 2.15 : c.y + 0.42;
          diamonds.push({ x: c.x, y: y + (focused ? bob : 0), z: c.z, size: focused ? 0.17 : hasNews ? 0.15 : 0.09, color: focused || hasNews ? GOLD : SOFT, yaw: t });
        }
      }
    } else this.markers.setRing(null);
    this.markers.setDiamonds(diamonds);
    // Estrellas del jardín que faltan.
    const stars: Glow[] = [];
    if (this.engine.done('c4.caro')) {
      for (const it of this.items) {
        if (it.def.kind !== 'star' || !this.engine.interactableVisible(it.def)) continue;
        stars.push({ x: it.x, y: it.y + 0.22 + Math.sin(t * 2 + it.x) * 0.05, z: it.z, size: 0.42, color: STAR, yaw: t * 1.2 });
      }
    }
    this.markers.setStars(stars);
  }

  private updateMap(): void {
    const f = this.player.forward();
    const heading = Math.atan2(-f.x, -f.z);
    const raw = this.targetOf(this.engine.mainObjectives()[0]);
    const target = raw && !SESSION.freeRoam ? this.guideTo(raw) : null;
    const people = this.npcs
      .filter((n) => n.handle || n.station)
      .map((n) => ({ ...this.npcSpot(n), color: n.def.color }));
    const mapState = {
      u: this.feetLocal.u,
      v: this.feetLocal.v,
      level: this.level,
      heading,
      target: target ? { ...target.spot, level: raw!.spot.level } : null,
      people,
    };
    this.hud.updateMap(mapState);
    // Minimapa del visor: se redibuja a 2 Hz o al moverse/girar (lo manda `updateWrist`).
    this.xrMapKey = `${Math.floor(this.clock * 2)}|${Math.round(mapState.u * 2)}|${Math.round(mapState.v * 2)}|${Math.round(heading * 10)}|${this.level}`;
  }

  // ===================================================================== pantallas

  private screenSpecs(): ScreenSpec[] {
    const out: ScreenSpec[] = [];
    const board = this.items.find((i) => i.def.id === 'pizarra')?.at.item;
    if (board) out.push({ id: 'pizarra', item: board, level: board.level ?? 0, y: 1.5, width: Math.max(1.2, board.d * 0.94), height: 1.1, depth: 0.06, out: 0.012 });
    const tv = this.items.find((i) => i.def.id === 'tele')?.at.item ?? ITEMS.find((it) => it.kind === 'tv');
    if (tv) out.push({ id: 'tele', item: tv, level: tv.level ?? 0, y: (tv.y ?? 1.5) + (tv.h ?? 0.62) / 2, width: tv.w * 0.92, height: (tv.h ?? 0.62) * 0.86, depth: 0.06, out: 0.008 });
    return out;
  }

  private teleSlide = 0;

  private paintScreen(id: 'tele' | 'pizarra', fresh: boolean): void {
    const stamps = this.engine.stamps;
    if (id === 'pizarra') {
      this.screens.paint('pizarra', (ctx, w, h) => {
        ctx.fillStyle = '#e8eae5';
        ctx.fillRect(0, 0, w, h);
        // Lo proyectado: un rectángulo de luz sobre la pizarra.
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#1d2b4f');
        g.addColorStop(1, '#0f1a30');
        ctx.fillStyle = g;
        ctx.fillRect(w * 0.06, h * 0.07, w * 0.88, h * 0.86);
        ctx.strokeStyle = '#c0303a';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(w * 0.2, h * 0.42, h * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#f2c14e';
        ctx.font = `800 ${Math.round(h * 0.17)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('40', w * 0.2, h * 0.43);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${Math.round(h * 0.09)}px Arial, sans-serif`;
        ctx.fillText('40 años construyendo', w * 0.36, h * 0.27);
        ctx.fillText('la mejor escuela', w * 0.36, h * 0.38);
        ctx.fillStyle = '#a9c2b8';
        ctx.font = `600 ${Math.round(h * 0.055)}px Arial, sans-serif`;
        ctx.fillText(`Recorrido 40 · sellos ${stamps} de ${TOTAL_STAMPS}`, w * 0.36, h * 0.52);
        STAMP_ORDER.forEach((s, k) => {
          const x = w * 0.36 + (k % 4) * w * 0.14;
          const y = h * 0.66 + Math.floor(k / 4) * h * 0.13;
          const got = this.engine.stamp(s);
          ctx.fillStyle = got ? '#4faa7a' : 'rgba(255,255,255,0.18)';
          ctx.fillRect(x, y - h * 0.035, h * 0.06, h * 0.06);
          ctx.fillStyle = got ? '#ffffff' : 'rgba(255,255,255,0.45)';
          ctx.font = `600 ${Math.round(h * 0.045)}px Arial, sans-serif`;
          ctx.fillText(STAMPS[s].title, x + h * 0.08, y);
        });
      });
      return;
    }
    if (fresh) this.teleSlide = 0;
    const slide = this.teleSlide % 3;
    this.screens.paint('tele', (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, slide === 1 ? '#1d2b4f' : '#173b35');
      g.addColorStop(1, '#0b1210');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (slide === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(h * 0.2)}px Arial, sans-serif`;
        ctx.fillText('PRO FOOD.', w / 2, h * 0.3);
        ctx.fillStyle = '#8fe0ad';
        ctx.font = `600 ${Math.round(h * 0.085)}px Arial, sans-serif`;
        ctx.fillText('Menú del día', w / 2, h * 0.52);
        ctx.fillStyle = '#eef6f2';
        ctx.fillText('Milanesa al horno · ensalada de colores · fruta', w / 2, h * 0.7, w * 0.9);
      } else if (slide === 1) {
        ctx.fillStyle = '#f2c14e';
        ctx.font = `800 ${Math.round(h * 0.3)}px Arial, sans-serif`;
        ctx.fillText('40', w / 2, h * 0.36);
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(h * 0.08)}px Arial, sans-serif`;
        ctx.fillText('40 años construyendo la mejor escuela', w / 2, h * 0.68, w * 0.9);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${Math.round(h * 0.11)}px Arial, sans-serif`;
        ctx.fillText('Recorrido 40', w / 2, h * 0.32);
        ctx.fillStyle = '#f2c14e';
        ctx.font = `700 ${Math.round(h * 0.14)}px Arial, sans-serif`;
        ctx.fillText(`${stamps} / ${TOTAL_STAMPS} sellos`, w / 2, h * 0.6);
      }
    });
    // Carrusel: cambia de placa cada seis segundos mientras está encendido.
    this.after(6, () => {
      if (!this.screens.isOn('tele')) return;
      this.teleSlide++;
      this.paintScreen('tele', false);
    });
  }

  /**
   * La seño escribe en la pizarra: el texto aparece de a poco, con letra de
   * marcador. Se redibuja unas pocas veces por segundo (cada vez se sube la
   * textura de las pantallas: más seguido no se nota y cuesta en el visor).
   */
  private async boardWrite(title: string, lines: string[]): Promise<void> {
    const total = lines.reduce((n, l) => n + l.length, 0);
    for (let shown = 0; shown <= total + 6; shown += 6) {
      let left = shown;
      this.screens.paint('pizarra', (ctx, w, h) => {
        ctx.fillStyle = '#eceee9';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#c0303a';
        ctx.font = `700 ${Math.round(h * 0.13)}px "Segoe Print", "Comic Sans MS", cursive`;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillText(title, w * 0.06, h * 0.2);
        ctx.fillStyle = '#1f3f8f';
        ctx.font = `600 ${Math.round(h * 0.085)}px "Segoe Print", "Comic Sans MS", cursive`;
        lines.forEach((l, k) => {
          if (left <= 0) return;
          ctx.fillText(l.slice(0, left), w * 0.07, h * (0.38 + k * 0.16), w * 0.88);
          left -= l.length;
        });
      });
      await this.wait(0.16);
    }
  }

  private repaintScreens(): void {
    if (this.screens.isOn('pizarra')) this.paintScreen('pizarra', false);
  }

  // ===================================================================== utilidades

  private eye(): WorldPoint {
    if (this.inXR && this.xr) {
      const p = this.xr.baseExperience.camera.globalPosition;
      return { x: p.x, y: p.y, z: p.z };
    }
    const p = this.deps.camera.globalPosition;
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Termina una escena guionada sin pisar lo que se haya abierto mientras tanto. */
  private endCutscene(): void {
    if (this.modal === 'cutscene') this.setModal(null);
  }

  private setModal(m: GameDirector['modal']): void {
    this.modal = m;
    this.applyPause();
  }

  private applyPause(): void {
    const menu = this.xrMenuOpen;
    const paused = this.mode === 'title' || this.modal !== null || this.hud.paused || menu;
    try {
      this.player.setPaused(paused);
    } catch {
      // Jugador no disponible.
    }
    // En el visor la caminata nunca queda trabada por un diálogo, cartel o
    // actividad: si el clic no entraba, el jugador quedaba quieto sin poder
    // cerrarlo (lo que se reportó con el visor puesto). Se frena en las
    // escenas guionadas (la historia mueve al jugador), con el inicio o el
    // menú del juego abiertos (ahí el stick mueve el resaltado) y durante un
    // fundido del visor: caminar a ciegas mientras se salta marea.
    this.xrControls?.setLocomotionEnabled(this.mode === 'play' && this.modal !== 'cutscene' && !menu && !this.xrBusy);
  }

  /** ¿Está abierto el inicio o el menú del juego del visor? */
  private get xrMenuOpen(): boolean {
    return this.inXR && (this.menus?.open ?? false);
  }

  private wait(seconds: number): Promise<void> {
    return new Promise((r) => this.after(seconds, r));
  }

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.clock + seconds, fn });
  }

  private runTimers(): void {
    if (this.timers.length === 0) return;
    const due = this.timers.filter((t) => t.at <= this.clock);
    if (due.length === 0) return;
    this.timers = this.timers.filter((t) => t.at > this.clock);
    for (const t of due) t.fn();
  }

  /** Cámara del título: un paneo lento frente a la fachada sobre Laprida. */
  private titleCamera(dt: number): void {
    if (this.inXR) return;
    const cam = this.deps.camera as TargetCamera;
    if (typeof cam.setTarget !== 'function') return;
    this.titleT += dt;
    // Sobre la mano de enfrente de Laprida, por debajo de las copas de la
    // vereda opuesta (que quedan detrás): el portal, las aulas con sus rejas y
    // el gimnasio entran en cuadro sin nada delante.
    const k = Math.sin(this.titleT * 0.045);
    const eye = toWorld(this.frame, ...fromPlan(44 + k * 8, 9.5));
    const look = toWorld(this.frame, ...fromPlan(38 + k * 5, -3));
    cam.position.set(eye.x, 2.3 + Math.sin(this.titleT * 0.1) * 0.15, eye.z);
    cam.setTarget(new Vector3(look.x, 3.8, look.z));
  }

  // ======================================================================= pasaporte

  private passport(): PassportView {
    const d = this.engine.data;
    const ch = chapter(this.engine.currentChapter());
    // Sin frases no hay entrevistas: ni voces en el resumen, ni citas, ni la insignia de Cronista.
    const phrases = SESSION.phrases;
    const voices = phrases ? ` · voces ${this.engine.interviews}` : '';
    return {
      summary: `${ch.kicker} · ${ch.title}. Sellos ${this.engine.stamps}/${TOTAL_STAMPS} · lugares ${this.engine.places}/${PLACES.length}${voices}. Tiempo de juego: ${Math.round(d.seconds / 60)} min.`,
      stamps: STAMP_ORDER.map((s) => ({ title: STAMPS[s].title, got: this.engine.stamp(s) })),
      places: PLACES.map((p) => ({ title: p.title, got: this.engine.discovered(p.id) })),
      quotes: !phrases
        ? []
        : Object.entries(d.interviews).map(([who, text]) => {
            const c = CHARACTERS.find((ch2) => ch2.id === who);
            return { who: c ? `${c.name}, ${c.role}` : who, text };
          }),
      items: [
        ...Object.entries(ITEMS_INFO).map(([id, info]) => ({ title: info.title, got: this.engine.item(id) })),
        ...BADGES.filter((b) => phrases || !b.phrases).map((b) => ({ title: `Insignia: ${b.title}`, got: b.got(this.engine) })),
      ],
    };
  }

  // ========================================================================== VR

  /**
   * Entrar o salir del visor. Al entrar SIEMPRE aparece primero la pantalla
   * de inicio (la misma del escritorio, adaptada): desde el título, en el
   * mirador de Laprida; con la partida en curso, donde está el jugador. Antes
   * se jugaba directo y se aparecía frente a la escuela sin haber elegido
   * nada.
   */
  private onXRState(state: WebXRState): void {
    const now = state === WebXRState.IN_XR;
    if (now === this.inXR) return;
    this.inXR = now;
    this.resetHands();
    if (now) {
      this.hud.setPrompt(null);
      this.wristKey = '';
      this.targetKey = '';
      this.hintsOn = false;
      // Al entrar, el visor reubica al jugador en este mismo cuadro: el
      // inicio se ubica después de dibujarlo, cuando la cámara ya está en su
      // lugar.
      this.scene.onAfterRenderObservable.addOnce(() => {
        if (this.inXR) this.openXRTitle(this.mode !== 'title');
      });
    } else {
      const inTitle = this.menus?.root === 'title';
      this.menus?.close();
      this.menuHints = false;
      this.hintsOn = false;
      this.xrBusy = false;
      this.panel?.hide();
      this.panel?.setLabel(null);
      // Saliendo desde el inicio, el escritorio vuelve a su título HTML (salvo
      // que haya algo a medio contestar debajo: eso sigue en la pantalla).
      if (this.mode === 'title' || (inTitle && this.modal === null)) this.showTitle();
      else if (this.shown) this.present();
      this.applyPause();
    }
  }

  // ------------------------------------------------------------ inicio y menú

  /** Pantalla de inicio del visor. `inPlace`: la partida ya estaba en curso (no se mueve al jugador). */
  private openXRTitle(inPlace: boolean): void {
    this.xrTitleInPlace = inPlace;
    this.hud.hideTitle();
    if (!inPlace) {
      SESSION.atTitle = true;
      this.music('intro');
    }
    this.openXRMenu('title');
  }

  private openXRMenu(root: 'title' | 'pause'): void {
    if (!this.menus || !this.panel) return;
    this.resetHands();
    this.stickNav?.reset();
    this.setFocus(null);
    this.menus.openRoot(root);
    this.applyPause();
  }

  private closeXRMenu(): void {
    if (!this.menus?.open) return;
    this.menus.close();
    this.menuHints = false;
    this.cancelPanelGestures();
    this.panel?.hide();
    this.applyPause();
    // Lo que estaba abierto debajo (diálogo, actividad, ficha) vuelve delante.
    if (this.shown) this.present();
  }

  /** Una pantalla del menú en el panel: se reubica delante sólo al abrirse o al cambiar de tamaño. */
  private showXRScreen(screen: PanelScreen, onPick: (i: number) => void, large: boolean): void {
    const panel = this.panel;
    const xr = this.xr;
    if (!panel || !xr) return;
    const size = large ? 'large' : 'normal';
    if (!panel.visible || panel.kind !== 'screen' || size !== this.panelSize) {
      const cam = xr.baseExperience.camera;
      cam.getDirectionToRef(FORWARD, this.tmpDir);
      panel.place(cam.globalPosition, { x: this.tmpDir.x, z: this.tmpDir.z });
      this.cancelPanelGestures();
    }
    this.panelSize = size;
    panel.setLabel(null);
    this.seedLaser = true;
    panel.show({ kind: 'screen', screen }, onPick, { size });
  }

  /** Lo que los menús del visor (`XRMenus`) le piden al juego. */
  private menuHost(): XRMenuHost {
    const progress = (): string => `${chapter(this.engine.currentChapter()).kicker} · ${this.engine.stamps}/${TOTAL_STAMPS} sellos`;
    return {
      phrases: SESSION.phrases,
      canContinue: () => this.xrTitleInPlace || SESSION.started || this.engine.data.done.length > 0,
      hasProgress: () => this.engine.data.done.length > 0,
      progressLabel: progress,
      chapterLabel: () => {
        const ch = chapter(this.engine.currentChapter());
        return `${ch.kicker} · ${ch.title}`;
      },
      objectiveLabel: () => {
        const o = this.engine.mainObjectives()[0];
        if (!o) return 'Recorrido completo: la escuela queda abierta para explorar.';
        return `Objetivo: ${this.engine.objectiveTitle(o)}${this.distanceText ? ` (${this.distanceText})` : ''}`;
      },
      passport: () => this.passport(),
      comfort: () => this.xrControls!.getComfort(),
      setComfort: (s) => this.xrControls?.setComfort(s),
      muted: () => {
        try {
          return this.audio.isMuted;
        } catch {
          return true;
        }
      },
      toggleMute: () => {
        try {
          this.audio.toggleMute();
        } catch {
          // Audio opcional.
        }
      },
      freeRoam: () => SESSION.freeRoam,
      setFreeRoam: (on) => {
        this.setFreeRoam(on);
        this.hud.setFreeRoam(on);
      },
      canLeaveToTitle: () => this.canLeaveToTitle(),
      continueGame: () => void this.startFromXRTitle(false),
      startNewGame: () => void this.startFromXRTitle(true),
      backToTitle: () => void this.backToXRTitle(),
      exitVR: () => {
        const c = this.xrControls;
        if (!c) return;
        // Al salir, `onXRState` cierra el menú (y vuelve al título si se salió desde el inicio).
        this.xrBusy = true;
        c.exit().catch(() => {
          this.xrBusy = false;
        });
      },
      closeMenu: () => {
        this.closeXRMenu();
        this.sfx('close');
      },
      show: (screen, onPick, large) => this.showXRScreen(screen, onPick, large),
      setHints: (on) => {
        this.menuHints = on;
      },
      toggled: () => this.click(1500),
    };
  }

  private canLeaveToTitle(): boolean {
    return this.mode === 'play' && this.modal === null && !this.activity && !this.xrBusy;
  }

  /**
   * "Continuar" o "Nueva partida" en el inicio del visor. Desde el mirador:
   * fundido a negro, arranca la partida, el jugador aparece frente al portal
   * (como el prólogo) y entra a la escuela caminando. Con la partida ya en
   * curso, "Continuar" sólo cierra el inicio.
   */
  private async startFromXRTitle(fresh: boolean): Promise<void> {
    const c = this.xrControls;
    if (!c || this.xrBusy) return;
    if (this.mode !== 'title' && !fresh) {
      this.xrTitleInPlace = false;
      this.closeXRMenu();
      this.sfx('close');
      return;
    }
    this.xrBusy = true;
    this.closeXRMenu();
    try {
      await c.fade(true, 380);
      if (!this.inXR) return;
      if (fresh) this.newGame();
      else this.resume(true);
      // Una partida nueva (o sin nada hecho) pasa por el prólogo, que ya lleva
      // al jugador frente al portal; una retomada también arranca ahí.
      if (this.engine.data.done.length > 0) {
        const feet = this.worldOf({ u: START.feet.u, v: START.feet.v, level: 0 });
        const look = toWorld(this.frame, START.look.u, START.look.v);
        this.player.teleport(feet, { x: look.x, y: START.look.y, z: look.z });
        this.syncStations(true);
        const ch = chapter(this.engine.currentChapter());
        this.after(1.2, () => this.vrToast(ch.kicker, ch.title));
      }
      // El salto del visor se aplica en el cuadro siguiente: se espera a
      // verlo en su lugar antes de aclarar.
      await sleep(650);
      await c.fade(false, 700);
    } finally {
      this.xrBusy = false;
      this.applyPause();
    }
    // Los rótulos de los mandos acompañan los primeros pasos, y a los pocos
    // segundos un recordatorio de lo básico.
    this.hintsUntil = performance.now() + HINTS_AFTER_START;
    const hint = this.hintFor?.(SESSION.phrases);
    if (hint) this.after(5, () => this.vrToast('Controles', hint));
  }

  /** "Volver al inicio" del menú del juego: se guarda y se vuelve al mirador de Laprida. */
  private async backToXRTitle(): Promise<void> {
    const c = this.xrControls;
    if (!c || this.xrBusy || !this.canLeaveToTitle()) return;
    this.xrBusy = true;
    this.closeXRMenu();
    try {
      await c.fade(true, 380);
      if (!this.inXR) return;
      this.save();
      this.resetHands();
      this.mode = 'title';
      SESSION.atTitle = true;
      this.setFocus(null);
      this.markers.setRing(null);
      const L = this.xrLookout;
      this.player.teleport({ x: L.eye.x, y: L.eye.y - 1.7, z: L.eye.z }, L.look);
      this.applyPause();
      // El panel se ubica con la cabeza ya en el mirador.
      await sleep(250);
      if (!this.inXR) return;
      this.openXRTitle(false);
      await c.fade(false, 650);
    } finally {
      this.xrBusy = false;
      this.applyPause();
    }
  }

  // ------------------------------------------------------------------ mandos

  /** Vibración en una mano (la del láser si no se dice). */
  private fx(pattern: HapticPattern, hand?: XRHand): void {
    const c = this.xrControls;
    if (!c || !this.inXR) return;
    try {
      c.input.haptic(hand ?? c.pointer.activeHand, pattern);
    } catch {
      // Sin vibración en este mando.
    }
  }

  /** Clic agudo y muy corto al pasar por un botón u objeto (con un tope para no tartamudear). */
  private hoverSound(): void {
    const now = performance.now();
    if (now - this.hoverSoundAt < 90) return;
    this.hoverSoundAt = now;
    this.click(1900);
  }

  /** Se eligió algo en el panel: vibración de confirmación y un clic. */
  private pickedFx(hand: XRHand): void {
    this.fx('confirm', hand);
    this.click(1320);
  }

  /**
   * Por cuadro, en el visor: rótulos de los mandos, láser encendido o no,
   * panel que sigue a la vista (o arrastrado con el grip), la pelota en la
   * mano, el stick en los menús y cada mano contra el panel.
   */
  private xrFrame(dt: number): void {
    const c = this.xrControls;
    const panel = this.panel;
    const xr = this.xr;
    if (!c || !panel || !xr) return;
    const input = c.input;
    const pointer = c.pointer;
    const cam = xr.baseExperience.camera;
    cam.getDirectionToRef(FORWARD, this.tmpDir);

    // Rótulos de los mandos: en el inicio, en Controles y los primeros segundos de juego.
    const hints = this.menuHints || performance.now() < this.hintsUntil;
    if (hints !== this.hintsOn) {
      this.hintsOn = hints;
      c.setHints(hints);
    }

    // Láser apagado durante los fundidos y en las escenas guionadas sin panel.
    pointer.setEnabled(!this.xrBusy && !(this.modal === 'cutscene' && !panel.visible));

    // El panel queda fijo en el mundo (pegado a la cara marea); si sale de
    // la vista un rato, vuelve solo delante. Agarrado con el grip, sigue al rayo.
    if (this.dragHand) {
      if (panel.visible && input.rayOf(this.dragHand, this.ray)) panel.dragTo(this.ray);
      else this.endPanelDrag();
    } else if (panel.visible) {
      panel.follow(cam.globalPosition, this.tmpDir, dt);
    }

    if (this.ballHand) {
      const g = input.gripPosition(this.ballHand);
      if (!g || this.mode !== 'play' || this.modal !== null || this.level !== 0) this.releaseBall(false);
      else this.props.holdBall({ x: g.x, y: g.y, z: g.z });
      this.ballAway = 0;
    } else {
      // Lanzada o dejada fuera del predio (la vereda, la calle): a los pocos
      // segundos vuelve al gimnasio, para que no se pierda una pieza que la
      // historia puede pedir.
      const p = this.props.ballPosition();
      this.ballAway = inLot(p.u, p.v) ? 0 : this.ballAway + dt;
      if (this.ballAway > BALL_AWAY_RESET) {
        this.ballAway = 0;
        this.props.resetBall();
      }
    }

    // Inicio y menú del juego: el stick (cualquiera) mueve el resaltado.
    if (this.xrMenuOpen && this.stickNav && !this.xrBusy) {
      const l = input.stick('left');
      const r = input.stick('right');
      const s = Math.hypot(l.x, l.y) >= Math.hypot(r.x, r.y) ? l : r;
      const step = this.stickNav.update(s.x, s.y, dt);
      if (step && panel.navigate(step.dx, step.dy)) {
        this.fx('hover');
        this.hoverSound();
      }
    } else {
      this.stickNav?.reset();
    }

    // Cada mano contra el panel: el láser termina en él, y el resaltado lo
    // lleva la mano activa (o la otra, si sólo ella está encima de un botón).
    // El láser mueve el resaltado sólo cuando PASA a otro botón: un láser
    // quieto sobre el panel no deshace lo que se eligió con el stick
    // (comprobado en el emulador: el resaltado volvía solo al botón apuntado).
    let over: XRHand | null = null;
    let overZone = -1;
    for (const hand of HANDS) {
      const before = this.onPanel[hand];
      this.onPanel[hand] = null;
      // El dedo empezó a apretar: desde acá el láser ya no cambia de botón.
      // Un dedo apoyado en el gatillo sin apretar (más de PULL_MS) no congela nada.
      const touched = input.analog(hand, 'trigger') >= PULL_START;
      if (!touched) this.pullSince[hand] = 0;
      else if (this.pullSince[hand] === 0) this.pullSince[hand] = performance.now();
      const pulling = touched && performance.now() - this.pullSince[hand] < PULL_MS && !input.isDown(hand, 'trigger');
      if (!pulling) this.preZone[hand] = -1;
      if (!panel.visible || this.xrBusy || !input.has(hand) || !input.rayOf(hand, this.ray)) continue;
      const hit = panel.hitTest(this.ray);
      if (!hit) continue;
      this.onPanel[hand] = hit.zone;
      if (!pulling) this.preZone[hand] = hit.zone;
      const holding = this.pressed?.hand === hand;
      const state: PointerState = holding ? 'press' : hit.zone < 0 ? 'idle' : input.isDown(hand, 'trigger') ? 'press' : 'hover';
      pointer.setHit(hand, { distance: hit.distance, state, onTop: true });
      if (hit.zone >= 0 && hit.zone !== before && !pulling && !holding && !this.seedLaser && (over === null || hand === pointer.activeHand)) {
        over = hand;
        overZone = hit.zone;
      }
    }
    if (panel.visible) this.seedLaser = false;
    if (over && panel.setHighlight(overZone)) {
      this.fx('hover', over);
      this.hoverSound();
    }
  }

  /**
   * Lo que cada láser señala en el mundo (las manos que no están sobre el
   * panel). Es la misma regla que el foco (`focusByRay`): geometría contra
   * los candidatos, sin picking contra la escuela.
   */
  private xrWorldHits(allowed: boolean): void {
    const c = this.xrControls;
    if (!c) return;
    for (const hand of HANDS) {
      this.handFocus[hand] = null;
      if (this.onPanel[hand] !== null) continue;
      if (!allowed || this.xrBusy || !c.input.has(hand) || !c.input.rayOf(hand, this.ray)) {
        c.pointer.setHit(hand, null);
        continue;
      }
      const o = this.ray.origin;
      const d = this.ray.direction;
      const dl = d.length() || 1;
      const f = focusByRay(this.candidates, o, d, this.feet);
      this.handFocus[hand] = f;
      const press = c.input.isDown(hand, 'trigger');
      if (f) {
        // Hasta el punto del rayo más cercano al objeto.
        const t = ((f.x - o.x) * d.x + (f.y - o.y) * d.y + (f.z - o.z) * d.z) / dl;
        c.pointer.setHit(hand, { distance: Math.max(0.15, t), state: press ? 'press' : 'hover' });
      } else {
        const t = this.ballAim(hand);
        c.pointer.setHit(hand, t > 0 ? { distance: t, state: press ? 'press' : 'hover' } : null);
      }
    }
  }

  /** Sueltan todo lo que las manos tenían (al entrar o salir del visor y al abrir un menú). */
  private resetHands(): void {
    this.cancelPanelGestures();
    if (this.ballHand) this.releaseBall(false);
    this.handFocus.left = null;
    this.handFocus.right = null;
    this.onPanel.left = null;
    this.onPanel.right = null;
    this.lastFocusKey = '';
  }

  private cancelPanelGestures(): void {
    if (this.pressed) {
      this.pressed = null;
      this.panel?.cancelPress();
    }
    this.endPanelDrag(true);
  }

  private endPanelDrag(silent = false): void {
    const hand = this.dragHand;
    if (!hand) return;
    this.dragHand = null;
    this.panel?.endDrag();
    if (!silent) this.fx('release', hand);
  }

  /**
   * Botones del Quest 3 (mapeo acordado, ver `XRGameUI.CONTROL_MAP`):
   * gatillo elige con el láser; A/X usa o acepta; B vuelve; Y abre y cierra
   * el menú del juego; grip agarra (el panel, la pelota) o usa lo apuntado;
   * clic del stick derecho trae el panel delante o recuerda el objetivo. El
   * clic del stick izquierdo (correr) y los sticks los maneja la caminata.
   */
  private onXRPress(e: XRButtonEvent): void {
    if (!this.inXR || this.xrBusy || !this.xrControls) return;
    switch (e.button) {
      case 'trigger':
        // La mano que aprieta el gatillo pasa a ser la del láser.
        this.xrControls.pointer.activeHand = e.hand;
        this.xrTrigger(e.hand);
        return;
      case 'primary':
        this.xrAccept(e.hand);
        return;
      case 'secondary':
        if (e.hand === 'left') this.toggleXRMenu(e.hand);
        else this.xrBack(e.hand);
        return;
      case 'grip':
        this.xrGrip(e.hand);
        return;
      case 'stick':
        if (e.hand === 'right') this.xrRecenter();
        return;
    }
  }

  private onXRRelease(e: XRReleaseEvent): void {
    if (e.button === 'trigger' && this.pressed?.hand === e.hand) {
      // Se elige al SOLTAR sobre el mismo botón: apretar, arrepentirse y
      // correr el láser fuera no elige nada (y un roce del gatillo al
      // caminar tampoco, porque el panel recién abierto no está armado).
      this.pressed = null;
      const panel = this.panel;
      const c = this.xrControls;
      if (!panel?.visible || !c || !this.inXR || this.xrBusy) {
        panel?.cancelPress();
        return;
      }
      // Tolera el cabeceo del mando al aflojar el dedo (ver `releaseRay`).
      const picked = panel.releaseRay(c.input.rayOf(e.hand, this.ray) ? this.ray : null);
      if (picked >= 0) this.pickedFx(e.hand);
      else panel.cancelPress();
      return;
    }
    if (e.button === 'grip') {
      if (this.dragHand === e.hand) this.endPanelDrag();
      if (this.ballHand === e.hand) this.releaseBall(this.inXR);
    }
  }

  /** Gatillo: sobre el panel, aprieta el botón (se elige al soltar); en el mundo, usa lo apuntado. */
  private xrTrigger(hand: XRHand): void {
    const panel = this.panel;
    const c = this.xrControls;
    if (!c) return;
    if (panel?.visible && c.input.rayOf(hand, this.ray)) {
      const hit = panel.hitTest(this.ray);
      // El botón apuntado cuando el dedo empezó a apretar, aunque el
      // cabeceo del mando haya llevado el láser al hueco, al vecino o
      // apenas fuera del borde de abajo.
      const pre = this.preZone[hand];
      const zone = pre >= 0 ? pre : hit ? hit.zone : -1;
      if (hit || pre >= 0) {
        // Recién abierto, el panel no está armado: un gatillo que venía
        // apretado (o un roce al caminar) no aprieta nada.
        if (zone >= 0 && panel.armed) {
          panel.setHighlight(zone);
          panel.press(zone);
          this.pressed = { hand, zone };
          this.fx('press', hand);
        }
        return;
      }
    }
    if (this.xrMenuOpen) return;
    this.useFocus(hand, this.handFocus[hand] ?? this.focus);
  }

  /** A / X: en un panel, elige lo resaltado (o la única opción, o la primera de un diálogo); si no, usa lo señalado. */
  private xrAccept(hand: XRHand): void {
    const panel = this.panel;
    if (panel?.visible) {
      if (panel.confirm()) this.pickedFx(hand);
      else this.fx('tick', hand);
      return;
    }
    if (this.xrMenuOpen) return;
    this.useFocus(hand, this.focus);
  }

  /** B: vuelve un nivel (submenú, menú) o cierra la ficha. */
  private xrBack(hand: XRHand): void {
    const panel = this.panel;
    if (!panel?.visible) return;
    if (panel.back()) {
      this.fx('confirm', hand);
      this.click(1100);
    } else {
      this.fx('tick', hand);
    }
  }

  /** Y: abre o cierra el menú del juego. En el inicio no hace nada (no hay juego que pausar). */
  private toggleXRMenu(hand: XRHand): void {
    if (this.xrMenuOpen) {
      if (this.menus?.root === 'pause') {
        this.closeXRMenu();
        this.fx('confirm', hand);
        this.sfx('close');
      } else {
        this.fx('tick', hand);
      }
      return;
    }
    if (this.mode !== 'play' || this.modal === 'cutscene') {
      this.fx('error', hand);
      return;
    }
    this.openXRMenu('pause');
    this.fx('confirm', hand);
    this.sfx('open');
  }

  /** Clic del stick derecho: trae el panel delante; sin panel, recuerda el objetivo y la distancia. */
  private xrRecenter(): void {
    const panel = this.panel;
    const xr = this.xr;
    if (!panel || !xr) return;
    const cam = xr.baseExperience.camera;
    cam.getDirectionToRef(FORWARD, this.tmpDir);
    if (panel.visible) {
      panel.recenter(cam.globalPosition, this.tmpDir);
      this.fx('tick', 'right');
      return;
    }
    if (this.mode !== 'play') return;
    const o = this.engine.mainObjectives()[0];
    const ch = chapter(this.engine.currentChapter());
    const title = o ? this.engine.objectiveTitle(o) : 'Recorrido completo';
    this.vrToast(title, this.distanceText ? `${ch.kicker} · ${this.distanceText}` : ch.kicker);
    this.fx('tick', 'right');
  }

  /** Grip: sobre el panel lo arrastra; cerca de la pelota (o apuntándola) la toma; si no, usa lo que apunta esa mano. */
  private xrGrip(hand: XRHand): void {
    const panel = this.panel;
    const c = this.xrControls;
    if (!c) return;
    if (panel?.visible && !this.dragHand && c.input.rayOf(hand, this.ray) && panel.hitTest(this.ray)) {
      if (panel.beginDrag(this.ray)) {
        if (this.pressed?.hand === hand) this.cancelPanelGestures();
        this.dragHand = hand;
        this.fx('grab', hand);
      }
      return;
    }
    if (this.xrMenuOpen) return;
    if (this.grabBall(hand)) return;
    // Sólo lo que apunta ESA mano (no la mirada): apoyar los dedos en el grip
    // sin querer no debería abrir una puerta.
    this.useFocus(hand, this.handFocus[hand]);
  }

  private useFocus(hand: XRHand, f: Candidate | null): void {
    if (!f || this.mode !== 'play' || this.modal !== null) return;
    const { locked } = this.describe(f.key);
    this.fx(locked ? 'error' : 'confirm', hand);
    this.interact(f.key);
  }

  // ------------------------------------------------------------------ pelota

  /** Distancia por el láser de esa mano hasta la pelota si le apunta (dentro de 4 m), o −1. */
  private ballAim(hand: XRHand): number {
    const c = this.xrControls;
    if (!c || this.mode !== 'play' || this.modal !== null || this.level !== 0 || this.ballHand) return -1;
    if (!c.input.rayOf(hand, this.ray)) return -1;
    const b = this.props.ballWorld();
    const o = this.ray.origin;
    const d = this.ray.direction;
    const dl = d.length() || 1;
    const vx = b.x - o.x;
    const vy = b.y - o.y;
    const vz = b.z - o.z;
    const t = (vx * d.x + vy * d.y + vz * d.z) / dl;
    if (t <= 0 || t > GRAB_AIM_RANGE) return -1;
    const miss = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - t * t));
    return miss < GRAB_AIM ? t : -1;
  }

  private grabBall(hand: XRHand): boolean {
    const c = this.xrControls;
    if (!c || this.ballHand || this.mode !== 'play' || this.modal !== null || this.level !== 0) return false;
    const g = c.input.gripPosition(hand);
    if (!g) return false;
    const b = this.props.ballWorld();
    const near = Math.hypot(g.x - b.x, g.y - b.y, g.z - b.z) < GRAB_REACH;
    if (!near && this.ballAim(hand) < 0) return false;
    this.ballHand = hand;
    this.props.holdBall({ x: g.x, y: g.y, z: g.z });
    this.fx('grab', hand);
    this.click(240);
    return true;
  }

  /**
   * Soltar la pelota: con la mano quieta cae ahí; con un movimiento, sale
   * con la velocidad de la mano (y cuenta como usarla, igual que patearla).
   */
  private releaseBall(throwIt: boolean): void {
    const hand = this.ballHand;
    if (!hand) return;
    this.ballHand = null;
    if (this.level !== 0) {
      // Llevada a un piso alto: vuelve a su lugar (cae sólo al piso del gimnasio).
      this.props.resetBall();
      return;
    }
    const c = this.xrControls;
    const g = c?.input.gripPosition(hand) ?? null;
    if (!throwIt || !c || !g) {
      this.props.holdBall(null);
      return;
    }
    const v = c.input.handVelocity(hand);
    this.props.throwBall({ x: g.x, y: g.y, z: g.z }, { x: v.x, y: v.y, z: v.z });
    this.fx('release', hand);
    if (Math.hypot(v.x, v.z) < THROW_MIN) return;
    this.click(180);
    const it = this.items.find((i) => i.def.id === 'pelota');
    if (it && this.mode === 'play' && this.modal === null && this.engine.interactableVisible(it.def) && this.engine.interactableReady(it.def)) {
      this.react(this.engine.interact('pelota'));
    }
  }
}
