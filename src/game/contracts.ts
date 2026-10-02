/**
 * Contratos entre los sistemas del juego.
 *
 * El juego son varias piezas que se escriben por separado y se encuentran
 * acá: la gente (`world/people`), el audio (`audio`), el director del juego
 * con la historia, las misiones, las interacciones y el HUD (`game`, `ui`) y
 * `main.ts`, que las conecta. Cada pieza depende de estas interfaces, no de
 * la implementación de las otras: así se pueden cambiar sin romper el resto.
 *
 * Sin imports del motor salvo tipos: es un archivo de datos y firmas.
 */

import type { Level } from '../world/SchoolBase';

// ===================================================================== lugares

/** Punto de la escuela en coordenadas del plano (u este, v sur) y su nivel. */
export interface SchoolPoint {
  u: number;
  v: number;
  level: Level;
}

/** Posición en el mundo (metros, y = altura de los pies). */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** Momentos del día escolar: la gente se reparte distinto en cada uno. */
export type SchoolPhase = 'entrada' | 'clase' | 'recreo' | 'acto' | 'salida';

// ======================================================================== gente

export type NpcRole =
  | 'student' // primaria: chomba roja y pantalón/pollera azul marino
  | 'studentSecondary' // secundaria: más altos, mismo uniforme con buzo azul
  | 'kid' // jardín: guardapolvo a cuadritos, chiquitos
  | 'teacher' // docentes: ropa de calle, algunos con guardapolvo blanco
  | 'staff' // portería, maestranza, cantina: uniforme de trabajo
  | 'visitor'; // familias y visitas del acto

export type NpcAnim =
  | 'idle' // respiración, peso que cambia de pierna
  | 'walk'
  | 'run'
  | 'talk' // gestos de manos mientras habla
  | 'listen' // asiente, mira al que habla
  | 'sit' // sentado (en banco, silla o pupitre)
  | 'wave' // saludo con la mano
  | 'point' // señala hacia donde mira
  | 'lookAround'
  | 'clap'
  | 'write'; // en el pizarrón

/** Aspecto de un personaje: todo opcional, lo que falte lo decide la semilla. */
export interface CharacterLook {
  role: NpcRole;
  /** Altura total en metros. */
  height?: number;
  skin?: string;
  hair?: string;
  hairStyle?: 'short' | 'long' | 'bun' | 'ponytail' | 'curly' | 'bald';
  /** Prenda de arriba y de abajo (hex). Si el rol tiene uniforme, lo pisan. */
  top?: string;
  bottom?: string;
  skirt?: boolean;
  /** Guardapolvo blanco (docentes de primaria). */
  labCoat?: boolean;
  glasses?: boolean;
  backpack?: boolean;
  seed?: number;
}

/** Un personaje con nombre, que el director del juego mueve y anima. */
export interface NpcHandle {
  readonly id: string;
  /** Posición de los pies en el mundo. */
  position(): WorldPoint;
  /** Camina (o corre) hasta el punto por la escuela, esquivando muros. Se resuelve al llegar (false si no hay camino). */
  goTo(p: SchoolPoint, opts?: { run?: boolean }): Promise<boolean>;
  /** Lo ubica de golpe (sin caminar). */
  teleport(p: SchoolPoint, facing?: number): void;
  /** Gira el cuerpo hacia un punto del mundo. */
  face(target: { x: number; z: number }): void;
  /** Animación: en bucle hasta que se pida otra, o una vez y vuelve a 'idle'. */
  play(anim: NpcAnim, loop?: boolean): void;
  /** Mira al jugador con la cabeza cuando está cerca (por defecto, sí). */
  setLookAtPlayer(on: boolean): void;
  setVisible(visible: boolean): void;
}

/** La gente de la escuela: la multitud anónima y los personajes con nombre. */
export interface PopulationApi {
  /** Crea un personaje con nombre (los de la historia). */
  spawnCharacter(id: string, look: CharacterLook, at: SchoolPoint, facing?: number): NpcHandle;
  character(id: string): NpcHandle | null;
  /** Cambia el momento del día: la multitud se redistribuye caminando. */
  setSchoolPhase(phase: SchoolPhase): void;
  /** Para que la gente reaccione al jugador (mirarlo, saludar, abrirle paso). */
  setPlayer(getFeet: () => WorldPoint): void;
  /** Cantidad de personas activas (para el panel de métricas). */
  readonly population: number;
  /** Nivel adaptativo 0-3 (menos gente / menos detalle cuando el cuadro va justo). */
  setAdaptiveLevel(level: number): void;
  /**
   * Recorre a la gente presente (posición en el plano y piso). Opcional: lo
   * usan las puertas de las aulas para abrirse cuando alguien llega.
   */
  forEachPerson?(fn: (u: number, v: number, level: Level) => void): void;
  dispose(): void;
}

// ======================================================================== audio

/** Ambientes sonoros por zona: el audio cruza suave entre uno y otro. */
export type AmbienceZone = 'street' | 'patio' | 'corridor' | 'classroom' | 'gym' | 'cantina' | 'stair' | 'kindergarten' | 'quiet';

/** Superficie bajo los pies para los pasos. */
export type Surface = 'tile' | 'wood' | 'rubber' | 'metal' | 'concrete' | 'grass' | 'carpet';

export interface AudioApi {
  readonly available: boolean;
  resume(): Promise<void> | void;
  toggleMute(): boolean;
  readonly isMuted: boolean;
  /** Zona donde está el jugador (se llama varias veces por segundo). */
  setZone(zone: AmbienceZone): void;
  /** Momento del día escolar: el bullicio cambia (recreo, clase, acto). */
  setPhase(phase: SchoolPhase): void;
  step(running: boolean, surface?: Surface): void;
  /** Sonidos posicionados opcionalmente (distancia al jugador → volumen). */
  door(open: boolean, at?: WorldPoint): void;
  bell(at?: WorldPoint): void;
  click(pitch?: number): void;
  /** Interfaz: abrir diálogo, objetivo cumplido, recompensa, error, desbloqueo. */
  ui(kind: 'open' | 'close' | 'objective' | 'reward' | 'error' | 'unlock' | 'select'): void;
  /** Voz de un personaje: "bla-bla" con su timbre, o síntesis de voz si está disponible. Devuelve cuándo termina (s). */
  voice(text: string, speaker: { pitch: number; rate?: number }): number;
  stopVoice(): void;
  /** Música sutil: sólo en la introducción, el acto final y los créditos. */
  music(track: 'none' | 'intro' | 'act' | 'credits'): void;
  /** Posición del oyente (cámara), para los sonidos posicionados. */
  setListener(p: WorldPoint, forward?: { x: number; z: number }): void;
  dispose(): void;
}

// ================================================================= el jugador

/** Lo que el juego necesita del jugador (escritorio y VR). */
export interface PlayerApi {
  /** Posición de los pies y orientación de la cabeza. */
  feet(): WorldPoint;
  /** Dirección de la mirada (horizontal y vertical). */
  forward(): WorldPoint;
  /** Bloquea el movimiento mientras hay un diálogo o una actividad abierta. */
  setPaused(paused: boolean): void;
  /** Lleva al jugador a un lugar (cambio de escena, inicio de capítulo). */
  teleport(p: WorldPoint, lookAt?: WorldPoint): void;
  readonly inVR: boolean;
}

// ================================================================= cerraduras

/**
 * Las zonas que se desbloquean con la historia se cierran con
 * `setDynamicSolid(id, rect)` de `world/SchoolLayout` (rectángulo en
 * coordenadas del plano y su nivel; `null` lo abre). Lo respetan el jugador
 * (escritorio y VR) y la gente, porque todos consultan `schoolSolidLocal`.
 * El que cierra una puerta también debe mostrarla cerrada (una hoja
 * propia del juego), porque las hojas que dibuja la escuela están abiertas.
 */
export type { Rect } from '../world/SchoolBase';
