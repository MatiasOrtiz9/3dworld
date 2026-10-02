import type { Scene } from '@babylonjs/core/scene';
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { VirtualInput } from '../player/VirtualInput';
import type { Hud } from './Hud';
import { clampPitch, followBase, isTap, lookCurve, stickOutput, swipeGain, type StickOutput } from './joystick';

/**
 * Controles del celular (pantalla horizontal).
 *
 * Como en un juego de celular, no como una PC adaptada:
 *
 *  - **Mitad izquierda**: joystick flotante. Aparece donde apoya el pulgar,
 *    es analógico (a medio recorrido se camina despacio) y persigue al dedo
 *    si se pasa del borde.
 *  - **Mitad derecha**: deslizar para mirar (con aceleración, como el
 *    mouse) o, si se elige en Ajustes, un segundo joystick.
 *  - **Tocar** a una persona u objeto lo usa (un rayo desde la cámara por
 *    el dedo, con la regla del láser del visor). En un diálogo, un toque
 *    avanza.
 *  - **Botones**: usar (se enciende cuando hay algo a mano), saltar (con
 *    margen para un toque apenas antes de caer), correr (queda puesto
 *    mientras se camina) y, volando, subir y bajar. Arriba: menú, HUD y
 *    pantalla completa.
 *
 * Todo escribe en `VirtualInput`, que el jugador lee junto con el teclado:
 * caminar, chocar, subir escaleras y saltar son exactamente el código del
 * escritorio. Los controles se esconden solos con cualquier panel abierto
 * (diálogo, actividad, menú), dentro del visor y con el teléfono vertical.
 */

export interface TouchSettings {
  /** Multiplicador de la velocidad de la cámara. */
  sensitivity: number;
  /** Mirar deslizando o con un segundo joystick. */
  lookMode: 'swipe' | 'stick';
  /** 30 cuadros por segundo: la mitad de trabajo de la GPU. */
  batterySaver: boolean;
  /** Vibración corta al usar y saltar (sólo donde el navegador la ofrece). */
  haptics: boolean;
}

export interface TouchControlsDeps {
  scene: Scene;
  camera: TargetCamera;
  input: VirtualInput;
  hud: Hud;
  /** Usa lo que hay bajo el dedo (x, y en píxeles CSS de la ventana). Devuelve si había algo. */
  tapWorld(x: number, y: number): boolean;
  inXR(): boolean;
  click?(pitch: number): void;
  /** Cambió algo que decide el tope de cuadros (ahorro de batería, teléfono vertical). */
  onPowerChange?(): void;
}

type Role = 'move' | 'look' | 'lookstick' | 'tap' | 'none';

interface Finger {
  id: number;
  role: Role;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  /** Último movimiento, para la velocidad del deslizamiento. */
  tLast: number;
  travel: number;
}

const STORE_KEY = 'cimdip-touch-v1';
const DEFAULTS: TouchSettings = { sensitivity: 1, lookMode: 'swipe', batterySaver: false, haptics: true };
/** Parte de la pantalla (desde la izquierda) que maneja el joystick de movimiento. */
const MOVE_ZONE = 0.42;
/** Radianes por ancho de pantalla al deslizar con sensibilidad 1 (≈ 195°). */
const SWIPE_TURN = 3.4;
/** Giro máximo del stick de cámara (rad/s): horizontal y vertical. */
const STICK_YAW = 2.9;
const STICK_PITCH = 1.8;
/** Correr se apaga solo después de este tiempo quieto. */
const RUN_IDLE_MS = 900;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const NO_STICK: StickOutput = { x: 0, y: 0, mag: 0 };

export class TouchControls {
  readonly settings: TouchSettings;
  private readonly zone = $('touch-zone');
  private readonly ui = $('touch-ui');
  private readonly moveStick = $('stick-move');
  private readonly moveKnob = this.moveStick.querySelector<HTMLElement>('.knob')!;
  private readonly lookStick = $('stick-look');
  private readonly lookKnob = this.lookStick.querySelector<HTMLElement>('.knob')!;
  private readonly useBtn = $<HTMLButtonElement>('t-use');
  private readonly useLabel = $('t-use-label');
  private readonly runBtn = $<HTMLButtonElement>('t-run');

  private readonly fingers = new Map<number, Finger>();
  private moveFinger: Finger | null = null;
  private lookFinger: Finger | null = null;
  private stickFinger: Finger | null = null;
  private moveBase = { x: 0, y: 0 };
  private lookBase = { x: 0, y: 0 };
  private moveOut: StickOutput = NO_STICK;
  private lookOut: StickOutput = NO_STICK;

  private runOn = false;
  private idleMs = 0;
  private rise = { up: false, down: false };
  private flying = false;
  private blocked = false;
  private portrait = false;
  private useReady = false;
  private useVerb = '';
  private triedImmersive = false;
  private readonly portraitQuery = matchMedia('(orientation: portrait)');
  private readonly observer: Observer<Scene>;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly deps: TouchControlsDeps) {
    this.settings = loadSettings();
    document.documentElement.classList.add('touch');
    this.zone.hidden = false;
    this.ui.hidden = false;
    this.portrait = this.portraitQuery.matches;

    // --- superficie de juego: joystick, cámara y toques ---------------------
    this.on(this.zone, 'pointerdown', this.onDown as EventListener);
    this.on(this.zone, 'pointermove', this.onMove as EventListener);
    this.on(this.zone, 'pointerup', this.onUp as EventListener);
    this.on(this.zone, 'pointercancel', this.onCancel as EventListener);
    // Pulsación larga = menú contextual en Android y lupa en iOS; pellizco = zoom.
    for (const el of [this.zone, this.ui]) this.on(el, 'contextmenu', (e) => e.preventDefault());
    this.on(document, 'gesturestart', (e) => e.preventDefault());
    this.on(document, 'dblclick', (e) => e.preventDefault());

    // --- botones -------------------------------------------------------------
    this.press(this.useBtn, () => {
      if (this.deps.hud.primaryAction()) this.buzz(12);
    });
    this.press($('t-jump'), () => {
      this.deps.input.pressJump();
      this.buzz(6);
    });
    this.press(this.runBtn, () => this.setRun(!this.runOn));
    this.hold($('t-up'), (on) => (this.rise.up = on));
    this.hold($('t-down'), (on) => (this.rise.down = on));
    this.on($('t-menu'), 'click', () => {
      this.deps.click?.(620);
      this.deps.hud.setPause(true);
    });
    this.on($('t-hud'), 'click', () => {
      this.deps.click?.(700);
      this.deps.hud.setMinimal(!this.deps.hud.minimal);
      this.syncHudButton();
    });
    this.on($('t-full'), 'click', () => void this.toggleFullscreen());
    // El objetivo se pliega con un toque: en una pantalla chica tapa mucho.
    this.on($('objective'), 'click', () => $('objective').classList.toggle('collapsed'));

    // Pantalla completa y horizontal al empezar a jugar (necesita el gesto).
    for (const id of ['title-start', 'title-continue']) this.on($(id), 'click', () => void this.enterImmersive());

    // --- ajustes del celular (menú → Ajustes) ---------------------------------
    const sens = $<HTMLInputElement>('t-sens');
    sens.value = String(this.settings.sensitivity);
    this.on(sens, 'input', () => {
      this.settings.sensitivity = Number(sens.value);
      this.saveSettings();
    });
    this.on($('btn-look-mode'), 'click', () => {
      this.settings.lookMode = this.settings.lookMode === 'swipe' ? 'stick' : 'swipe';
      this.release();
      this.saveSettings();
    });
    this.on($('btn-battery'), 'click', () => {
      this.settings.batterySaver = !this.settings.batterySaver;
      this.saveSettings();
      this.deps.onPowerChange?.();
    });
    this.on($('btn-haptics'), 'click', () => {
      this.settings.haptics = !this.settings.haptics;
      this.saveSettings();
      this.buzz(15);
    });
    this.on($('btn-fullscreen'), 'click', () => void this.toggleFullscreen());
    this.on(document, 'fullscreenchange', () => this.syncSettings());

    this.on(this.portraitQuery, 'change', () => {
      this.portrait = this.portraitQuery.matches;
      this.release();
      this.deps.onPowerChange?.();
    });
    this.on(window, 'resize', () => this.placeIdle());

    try {
      this.deps.hud.setMinimal(localStorage.getItem('cimdip-hud-min') === '1');
    } catch {
      // sin almacenamiento: HUD completo
    }
    this.syncHudButton();
    this.syncSettings();
    this.placeIdle();
    this.observer = deps.scene.onBeforeRenderObservable.add(this.tick);
  }

  /** Volando aparecen subir y bajar en lugar de saltar. */
  setFlying(on: boolean): void {
    this.flying = on;
    this.ui.classList.toggle('flying', on);
  }

  /** ¿Ahorrar batería ahora? (lo eligió el jugador o el teléfono está vertical, sin jugar). */
  get lowPower(): boolean {
    return this.settings.batterySaver;
  }

  get isPortrait(): boolean {
    return this.portrait;
  }

  dispose(): void {
    this.deps.scene.onBeforeRenderObservable.remove(this.observer);
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
    this.deps.input.reset();
    document.documentElement.classList.remove('touch');
    this.zone.hidden = true;
    this.ui.hidden = true;
  }

  // ================================================================ por cuadro

  private tick = (): void => {
    const hud = this.deps.hud;
    const blocked = hud.modal || this.deps.inXR() || this.portrait;
    if (blocked !== this.blocked) {
      this.blocked = blocked;
      document.body.classList.toggle('touch-blocked', blocked);
      if (blocked) this.release();
    }
    if (blocked) return;

    const dt = Math.min(0.05, this.deps.scene.getEngine().getDeltaTime() / 1000);
    const input = this.deps.input;
    input.x = this.moveOut.x;
    input.y = this.moveOut.y;
    if (this.runOn) {
      if (this.moveOut.mag > 0.05) this.idleMs = 0;
      else if ((this.idleMs += dt * 1000) > RUN_IDLE_MS) this.setRun(false);
    }
    input.run = this.runOn;
    input.rise = this.flying ? Number(this.rise.up) - Number(this.rise.down) : 0;

    if (this.lookOut.mag > 0) {
      const k = this.settings.sensitivity * dt;
      const cam = this.deps.camera;
      cam.rotation.y += lookCurve(this.lookOut.x) * STICK_YAW * k;
      cam.rotation.x = clampPitch(cam.rotation.x - lookCurve(this.lookOut.y) * STICK_PITCH * k);
    }

    // El botón de usar se enciende con algo a mano y dice qué hace.
    const ready = hud.promptActive;
    if (ready !== this.useReady) {
      this.useReady = ready;
      this.useBtn.classList.toggle('ready', ready);
    }
    const verb = ready ? ($('prompt-verb').textContent ?? '') : 'Usar';
    if (verb !== this.useVerb) {
      this.useVerb = verb;
      this.useLabel.textContent = verb;
    }
  };

  // ================================================================ dedos

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      // puntero ya liberado
    }
    const now = performance.now();
    const f: Finger = { id: e.pointerId, role: 'tap', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, tLast: now, travel: 0 };
    this.fingers.set(e.pointerId, f);
    if (this.blocked) return;

    const left = e.clientX < window.innerWidth * MOVE_ZONE;
    if (left) {
      if (this.moveFinger) {
        f.role = 'none';
        return;
      }
      f.role = 'move';
      this.moveFinger = f;
      this.moveBase = { x: e.clientX, y: e.clientY };
      this.moveOut = NO_STICK;
      this.drawStick(this.moveStick, this.moveKnob, this.moveBase, f, true);
    } else if (this.settings.lookMode === 'stick') {
      if (this.stickFinger) {
        f.role = 'none';
        return;
      }
      f.role = 'lookstick';
      this.stickFinger = f;
      this.lookBase = { x: e.clientX, y: e.clientY };
      this.lookOut = NO_STICK;
      this.drawStick(this.lookStick, this.lookKnob, this.lookBase, f, true);
    } else {
      if (this.lookFinger) {
        f.role = 'none';
        return;
      }
      f.role = 'look';
      this.lookFinger = f;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    e.preventDefault();
    const dx = e.clientX - f.x;
    const dy = e.clientY - f.y;
    const now = performance.now();
    const dtMs = Math.max(1, now - f.tLast);
    f.x = e.clientX;
    f.y = e.clientY;
    f.tLast = now;
    f.travel = Math.max(f.travel, Math.hypot(f.x - f.x0, f.y - f.y0));

    if (f.role === 'move') {
      const r = radius(this.moveStick);
      this.moveBase = followBase(this.moveBase.x, this.moveBase.y, f.x, f.y, r);
      this.moveOut = stickOutput(f.x - this.moveBase.x, f.y - this.moveBase.y, r);
      this.drawStick(this.moveStick, this.moveKnob, this.moveBase, f, true);
    } else if (f.role === 'lookstick') {
      const r = radius(this.lookStick);
      this.lookBase = followBase(this.lookBase.x, this.lookBase.y, f.x, f.y, r);
      this.lookOut = stickOutput(f.x - this.lookBase.x, f.y - this.lookBase.y, r, 0.08);
      this.drawStick(this.lookStick, this.lookKnob, this.lookBase, f, true);
    } else if (f.role === 'look') {
      // Deslizar: el giro sigue al dedo. Con aceleración según la velocidad.
      const gain = swipeGain(Math.hypot(dx, dy) / dtMs);
      const k = (SWIPE_TURN / Math.max(320, window.innerWidth)) * this.settings.sensitivity * gain;
      const cam = this.deps.camera;
      cam.rotation.y += dx * k;
      cam.rotation.x = clampPitch(cam.rotation.x + dy * k * 0.85);
    }
  };

  private onUp = (e: PointerEvent): void => {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    this.endFinger(f);
    if (f.role !== 'none' && isTap(performance.now() - f.t0, f.travel)) this.onTap(f.x, f.y);
    // Primer toque de la partida si se entró sin pasar por el título. Al
    // levantar el dedo y no al apoyarlo: con toque, sólo `pointerup` cuenta
    // como gesto para pedir pantalla completa.
    if (!this.triedImmersive && e.pointerType !== 'mouse') void this.enterImmersive();
  };

  private onCancel = (e: PointerEvent): void => {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    this.endFinger(f);
  };

  private endFinger(f: Finger): void {
    if (f === this.moveFinger) {
      this.moveFinger = null;
      this.moveOut = NO_STICK;
      this.deps.input.x = 0;
      this.deps.input.y = 0;
      this.idleStick(this.moveStick, this.moveKnob);
    } else if (f === this.stickFinger) {
      this.stickFinger = null;
      this.lookOut = NO_STICK;
      this.idleStick(this.lookStick, this.lookKnob);
    } else if (f === this.lookFinger) {
      this.lookFinger = null;
    }
  }

  /** Un toque: en un diálogo o una ficha avanza; jugando, usa lo que señala el dedo. */
  private onTap(x: number, y: number): void {
    const hud = this.deps.hud;
    if (hud.modal) {
      if (hud.tapAdvance()) this.buzz(6);
      return;
    }
    if (this.blocked) return;
    if (this.deps.tapWorld(x, y)) {
      this.buzz(12);
      return;
    }
    // El aviso de interacción deja pasar el dedo (ver index.html): si el
    // toque cayó sobre él, es como apretar el botón de usar.
    const r = $('prompt').getBoundingClientRect();
    const onPrompt = hud.promptActive && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (onPrompt && hud.primaryAction()) this.buzz(12);
  }

  /** Suelta todo: un panel se abrió, se giró el teléfono o cambió el modo de cámara. */
  private release(): void {
    for (const f of this.fingers.values()) f.role = 'none';
    this.moveFinger = null;
    this.lookFinger = null;
    this.stickFinger = null;
    this.moveOut = NO_STICK;
    this.lookOut = NO_STICK;
    this.rise.up = false;
    this.rise.down = false;
    this.setRun(false);
    this.deps.input.reset();
    this.idleStick(this.moveStick, this.moveKnob);
    this.idleStick(this.lookStick, this.lookKnob);
    this.syncSettings();
  }

  // ================================================================ dibujo

  /** Base y perilla en su lugar. La base nunca se dibuja cortada por el borde. */
  private drawStick(stick: HTMLElement, knob: HTMLElement, base: { x: number; y: number }, f: Finger, active: boolean): void {
    const r = radius(stick);
    const m = 6;
    const bx = Math.min(window.innerWidth - r - m, Math.max(r + m, base.x));
    const by = Math.min(window.innerHeight - r - m, Math.max(r + m, base.y));
    stick.classList.toggle('idle', !active);
    stick.style.transform = `translate3d(${bx - r}px, ${by - r}px, 0)`;
    let kx = f.x - base.x;
    let ky = f.y - base.y;
    const d = Math.hypot(kx, ky);
    if (d > r) {
      kx = (kx / d) * r;
      ky = (ky / d) * r;
    }
    knob.style.transform = `translate3d(${kx}px, ${ky}px, 0)`;
  }

  /** En reposo: el fantasma del joystick enseña dónde apoyar el pulgar. */
  private idleStick(stick: HTMLElement, knob: HTMLElement): void {
    stick.classList.add('idle');
    knob.style.transform = 'translate3d(0, 0, 0)';
    this.placeIdle();
  }

  private placeIdle(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // La capa de controles lleva de relleno los márgenes seguros (muesca,
    // esquinas redondeadas): leídos de ahí ya vienen en píxeles.
    const css = getComputedStyle(this.ui);
    const safeL = parseFloat(css.paddingLeft) || 0;
    const safeR = parseFloat(css.paddingRight) || 0;
    if (!this.moveFinger) {
      const r = radius(this.moveStick);
      const x = Math.max(safeL + r + 24, w * 0.14);
      const y = h - r - Math.max(22, h * 0.1);
      this.moveStick.style.transform = `translate3d(${x - r}px, ${y - r}px, 0)`;
    }
    if (!this.stickFinger) {
      const r = radius(this.lookStick);
      const actions = $('t-actions').getBoundingClientRect();
      const x = Math.min(w - safeR - r - 24, (actions.width > 0 ? actions.left : w * 0.78) - r - 18);
      const y = h - r - Math.max(22, h * 0.1);
      this.lookStick.style.transform = `translate3d(${x - r}px, ${y - r}px, 0)`;
    }
  }

  private setRun(on: boolean): void {
    this.runOn = on;
    this.idleMs = 0;
    this.runBtn.classList.toggle('on', on);
    this.runBtn.setAttribute('aria-pressed', String(on));
    if (!on) this.deps.input.run = false;
  }

  private syncHudButton(): void {
    $('t-hud').classList.toggle('off', this.deps.hud.minimal);
    $('t-hud').setAttribute('aria-pressed', String(!this.deps.hud.minimal));
  }

  private syncSettings(): void {
    const s = this.settings;
    $('t-sens-label').textContent = `${s.sensitivity.toFixed(1).replace('.', ',')}×`;
    $('btn-look-mode').textContent = s.lookMode === 'swipe' ? 'Deslizar' : 'Joystick';
    this.ui.classList.toggle('look-stick', s.lookMode === 'stick');
    setToggle($('btn-battery'), s.batterySaver, 'Activado', 'Desactivado');
    setToggle($('btn-haptics'), s.haptics, 'Activada', 'Desactivada');
    const full = fullscreenElement() !== null;
    setToggle($('btn-fullscreen'), full, 'Activada', 'Desactivada');
    const canFull = fullscreenEnabled();
    $('btn-fullscreen').closest<HTMLElement>('.setting')!.hidden = !canFull;
    $('t-full').hidden = !canFull;
    $('t-full').classList.toggle('on', full);
  }

  private saveSettings(): void {
    this.syncSettings();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
    } catch {
      // preferencia de una sesión
    }
  }

  // ================================================================ pantalla

  /** Pantalla completa y orientación horizontal fija, donde el navegador lo permite. */
  private async enterImmersive(): Promise<void> {
    this.triedImmersive = true;
    if (!fullscreenElement() && fullscreenEnabled()) {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
      try {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else await el.webkitRequestFullscreen?.();
      } catch {
        // El navegador no quiso: se sigue en la ventana.
      }
    }
    try {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.('landscape');
    } catch {
      // iOS y navegadores sin bloqueo: el aviso de girar cubre el caso.
    }
    this.syncSettings();
  }

  private async toggleFullscreen(): Promise<void> {
    this.deps.click?.(760);
    if (fullscreenElement()) {
      try {
        (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
        await document.exitFullscreen();
      } catch {
        // ya había salido
      }
      this.syncSettings();
      return;
    }
    await this.enterImmersive();
  }

  // ================================================================ utilidades

  /** Botón que responde al apoyar el dedo (no al levantarlo): sin demora. */
  private press(el: HTMLElement, fn: () => void): void {
    this.on(el, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('down');
      fn();
    });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) this.on(el, t, () => el.classList.remove('down'));
  }

  /** Botón que actúa mientras se mantiene apretado. */
  private hold(el: HTMLElement, fn: (on: boolean) => void): void {
    this.on(el, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture((e as PointerEvent).pointerId);
      } catch {
        // sin captura: igual se suelta con pointerup
      }
      el.classList.add('down');
      fn(true);
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.on(el, t, () => {
        el.classList.remove('down');
        fn(false);
      });
    }
  }

  private buzz(ms: number): void {
    if (!this.settings.haptics) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      // sin vibrador
    }
  }

  private on(el: EventTarget, type: string, fn: (e: Event) => void): void {
    el.addEventListener(type, fn, { passive: false });
    this.cleanups.push(() => el.removeEventListener(type, fn));
  }
}

function radius(stick: HTMLElement): number {
  return stick.offsetWidth / 2 || 56;
}

function setToggle(b: HTMLElement, on: boolean, yes: string, no: string): void {
  b.textContent = on ? yes : no;
  b.setAttribute('aria-pressed', String(on));
}

function fullscreenElement(): Element | null {
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

function fullscreenEnabled(): boolean {
  const d = document as Document & { webkitFullscreenEnabled?: boolean };
  return Boolean(document.fullscreenEnabled ?? d.webkitFullscreenEnabled);
}

function loadSettings(): TouchSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<TouchSettings>;
    return {
      sensitivity: typeof s.sensitivity === 'number' ? Math.min(2.2, Math.max(0.4, s.sensitivity)) : DEFAULTS.sensitivity,
      lookMode: s.lookMode === 'stick' ? 'stick' : 'swipe',
      batterySaver: s.batterySaver === true,
      haptics: s.haptics !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}
