import type { ActivityView, ChoiceView } from '../game/activities/types';
import { drawGrid, drawIcon, drawSequence, drawStamp, UI } from './draw';
import { consume, isConsumed, typingTarget } from './input';
import { Minimap, type MapState } from './Minimap';

/**
 * HUD del Recorrido 40 (escritorio): todo lo que se ve encima del 3D.
 *
 * El marcado y los estilos están en `index.html`; esta clase sólo los
 * enlaza y les da comportamiento. Es independiente del motor: el director
 * del juego le pasa vistas ya armadas (una línea de diálogo, una actividad,
 * una ficha) y recibe lo que elige el jugador.
 *
 * Teclado: `Esc` pausa (o cierra la ficha abierta), `Tab` abre el
 * Pasaporte, `1`-`6` eligen, `E`/`Espacio`/`Enter` avanzan. En el visor no
 * hay HTML: el director usa el panel 3D con las mismas vistas.
 */

export interface LineView {
  speaker: string;
  role: string;
  color: string;
  text: string;
  choices: string[];
}

export interface CardView {
  kicker?: string;
  title: string;
  text: string;
}

export interface ObjectiveView {
  chapter: string;
  title: string;
  items: Array<{ text: string; hint?: string; side?: boolean; distance?: string }>;
  stamps: number;
  totalStamps: number;
}

export type ToastKind = 'objective' | 'stamp' | 'place' | 'unlock' | 'item' | 'info' | 'voice';

export interface ToastView {
  kind: ToastKind;
  title: string;
  text?: string;
}

export interface PassportView {
  summary: string;
  stamps: Array<{ title: string; got: boolean }>;
  places: Array<{ title: string; got: boolean }>;
  quotes: Array<{ who: string; text: string }>;
  items: Array<{ title: string; got: boolean }>;
}

export interface CreditsView {
  speech: string;
  stats: Array<{ value: string; label: string }>;
  lines: string[];
}

export interface HudHandlers {
  /** El menú de pausa se abrió o cerró. */
  onPause?(paused: boolean): void;
  onReset?(): void;
  onFreeRoam?(on: boolean): void;
  passport?(): PassportView;
}

const TOAST_ICON: Record<ToastKind, string> = {
  objective: '✓',
  stamp: '40',
  place: '◎',
  unlock: '⇪',
  item: '★',
  info: 'i',
  voice: '❝',
};

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Caracteres por segundo del texto que se escribe solo. */
const TYPE_SPEED = 52;

export class Hud {
  readonly minimap: Minimap;
  private handlers: HudHandlers = {};
  private readonly prompt = $<HTMLButtonElement>('prompt');
  private readonly crosshair = $('crosshair');
  private promptAction: (() => void) | null = null;
  private promptKey = '';

  // diálogo
  private dlgOpen = false;
  private dlgTyping = false;
  private dlgFull = '';
  private dlgShown = 0;
  private dlgTimer = 0;
  private dlgChoices: string[] = [];
  private dlgHot = 0;
  private dlgPick: ((i: number) => void) | null = null;

  // actividad
  private actOpen = false;
  private actView: ActivityView | null = null;
  private actChoiceSig = '';
  private actPick: ((i: number) => void) | null = null;

  // ficha
  private cardOpen = false;
  private cardClose: (() => void) | null = null;

  private pauseOpen = false;
  private titleOpen = false;
  private creditsOpen = false;
  private creditsClose: (() => void) | null = null;
  private barkTimer = 0;
  private chapterTimer = 0;
  private freeRoam = false;
  private readonly cleanups: Array<() => void> = [];

  constructor() {
    this.minimap = new Minimap($<HTMLCanvasElement>('minimap'));
    this.on(window, 'keydown', this.onKey as EventListener);
    this.on(this.prompt, 'click', () => this.promptAction?.());
    this.on($('dialogue'), 'click', (e) => {
      if ((e.target as HTMLElement).closest('.choice')) return;
      this.advanceDialogue();
    });
    this.on($('card-close'), 'click', () => this.closeCard());
    this.on($('btn-menu'), 'click', () => this.setPause(true));
    this.on($('pause-resume'), 'click', () => this.setPause(false));
    this.on($('pause'), 'click', (e) => {
      if (e.target === $('pause')) this.setPause(false);
    });
    for (const tab of document.querySelectorAll<HTMLButtonElement>('#pause .tab')) {
      this.on(tab, 'click', () => this.showTab(tab.dataset.tab ?? 'juego'));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#pause [data-goto]')) {
      this.on(b, 'click', () => this.showTab(b.dataset.goto ?? 'juego'));
    }
    this.on($('pause-reset'), 'click', () => {
      const b = $<HTMLButtonElement>('pause-reset');
      if (b.dataset.armed !== '1') {
        // Doble confirmación: un clic arma, el segundo borra.
        b.dataset.armed = '1';
        b.firstChild!.textContent = '¿Seguro? Tocá otra vez para borrar ';
        return;
      }
      b.dataset.armed = '';
      b.firstChild!.textContent = 'Borrar y empezar de nuevo ';
      this.setPause(false);
      this.handlers.onReset?.();
    });
    this.on($('btn-metrics'), 'click', () => this.setMetrics(!document.body.classList.contains('metrics')));
    this.on($('btn-free'), 'click', () => {
      this.setFreeRoam(!this.freeRoam);
      this.handlers.onFreeRoam?.(this.freeRoam);
    });
    const clickVr = () => {
      const vr = $<HTMLButtonElement>('btn-vr');
      if (vr.disabled) return;
      this.setPause(false);
      vr.click();
    };
    this.on($('btn-vr-menu'), 'click', clickVr);
    this.on($('title-vr'), 'click', clickVr);
    this.on($('credits-close'), 'click', () => this.closeCredits());
    // El botón de VR lo maneja main.ts (se habilita cuando hay visor): el del
    // título lo refleja mientras está a la vista.
    const vrObserver = new MutationObserver(() => this.syncTitleVr());
    vrObserver.observe($('btn-vr'), { attributes: true, childList: true, characterData: true, subtree: true });
    this.cleanups.push(() => vrObserver.disconnect());
    try {
      this.setMetrics(localStorage.getItem('cimdip-hud-metrics') === '1');
    } catch {
      this.setMetrics(false);
    }
  }

  /** Conecta las acciones del menú con el juego. */
  bind(handlers: HudHandlers): void {
    this.handlers = handlers;
  }

  /** ¿Hay algo del HUD que toma el control (diálogo, actividad, ficha, menú, título, créditos)? */
  get modal(): boolean {
    return this.dlgOpen || this.actOpen || this.cardOpen || this.pauseOpen || this.titleOpen || this.creditsOpen;
  }

  get paused(): boolean {
    return this.pauseOpen;
  }

  /** ¿Hay algo para usar ahora (el aviso de interacción está a la vista)? */
  get promptActive(): boolean {
    return this.promptAction !== null;
  }

  /**
   * El botón de acción del celular: lo mismo que `E`. Avanza el diálogo,
   * elige la única opción de una actividad, cierra la ficha o usa lo que
   * se está mirando. Devuelve si hizo algo.
   */
  primaryAction(): boolean {
    if (this.titleOpen || this.pauseOpen || this.creditsOpen) return false;
    if (this.dlgOpen) {
      this.advanceDialogue();
      return true;
    }
    if (this.actOpen && this.actView) {
      const only = this.singleChoice(this.actView);
      if (only < 0) return false;
      this.actPick?.(only);
      return true;
    }
    if (this.cardOpen) {
      this.closeCard();
      return true;
    }
    if (!this.promptAction) return false;
    this.promptAction();
    return true;
  }

  /**
   * Toque fuera de los paneles (celular): termina de escribir la línea o
   * avanza una sin opciones, y cierra la ficha. Con opciones a la vista no
   * elige nada: hay que tocar una.
   */
  tapAdvance(): boolean {
    if (this.pauseOpen || this.titleOpen || this.creditsOpen) return false;
    if (this.dlgOpen) {
      if (this.dlgTyping) {
        this.finishTyping();
        return true;
      }
      if (this.dlgChoices.length > 0) return false;
      this.pickDialogue(0);
      return true;
    }
    if (this.cardOpen) {
      this.closeCard();
      return true;
    }
    return false;
  }

  /**
   * HUD mínimo (celular): sin objetivo ni mapa, sólo lo que pasa. Se
   * recuerda entre sesiones.
   */
  setMinimal(on: boolean): void {
    document.body.classList.toggle('hud-min', on);
    try {
      localStorage.setItem('cimdip-hud-min', on ? '1' : '0');
    } catch {
      // Preferencia de una sesión, nada más.
    }
  }

  get minimal(): boolean {
    return document.body.classList.contains('hud-min');
  }

  /** Índice de la única opción habilitada que avanza (Continuar, Siguiente), o −1. */
  private singleChoice(view: ActivityView): number {
    const enabled = view.choices.map((c, i) => [c, i] as const).filter(([c]) => !c.disabled && !c.exit);
    return enabled.length === 1 ? enabled[0][1] : -1;
  }

  /** Oculta todo el HUD (capturas limpias: `?hud=0`). */
  setVisible(on: boolean): void {
    document.body.classList.toggle('hud-hidden', !on);
  }

  /**
   * Con o sin frases (ver `game/story/phrases.ts`): sin ellas se ocultan los
   * textos que hablan de diálogos y entrevistas (`.phrases-only`) y se
   * muestran sus reemplazos (`.silent-only`). Va en `<html>` para alcanzar
   * también al título y al menú.
   */
  setPhrases(on: boolean): void {
    document.documentElement.classList.toggle('phrases', on);
  }

  // ===================================================================== título

  showTitle(opts: { progress: string | null; onStart(): void; onContinue(): void }): void {
    this.titleOpen = true;
    document.body.classList.add('in-title');
    const title = $('title');
    title.classList.remove('hidden');
    const cont = $<HTMLButtonElement>('title-continue');
    const start = $<HTMLButtonElement>('title-start');
    cont.hidden = !opts.progress;
    $('title-progress').textContent = opts.progress ?? '';
    start.classList.toggle('primary', !opts.progress);
    this.syncTitleVr();
    cont.onclick = () => {
      this.hideTitle();
      opts.onContinue();
    };
    start.onclick = () => {
      this.hideTitle();
      opts.onStart();
    };
    (opts.progress ? cont : start).focus();
  }

  private syncTitleVr(): void {
    const vr = $<HTMLButtonElement>('btn-vr');
    $('title-vr').hidden = vr.disabled || !/entrar/i.test(vr.textContent ?? '');
    // Sin visor, el botón no aporta nada en la esquina: se oculta (sigue en Ajustes).
    const off = /no disponible/i.test(vr.textContent ?? '');
    if (vr.classList.contains('unavailable') !== off) vr.classList.toggle('unavailable', off);
  }

  hideTitle(): void {
    if (!this.titleOpen) return;
    this.titleOpen = false;
    document.body.classList.remove('in-title');
    $('title').classList.add('hidden');
  }

  // ==================================================================== objetivo

  setObjective(o: ObjectiveView): void {
    $('obj-chapter').textContent = o.chapter;
    $('obj-title').textContent = o.title;
    const stamps = $('obj-stamps');
    stamps.innerHTML = `<i></i>${o.stamps} / ${o.totalStamps}`;
    const list = $('obj-list');
    list.replaceChildren(
      ...o.items.map((it) => {
        const li = document.createElement('li');
        if (it.side) li.className = 'side';
        const main = document.createElement('div');
        main.textContent = it.text;
        if (it.distance) {
          const em = document.createElement('em');
          em.textContent = it.distance;
          main.append(em);
        }
        if (it.hint) {
          const small = document.createElement('small');
          small.textContent = it.hint;
          main.append(small);
        }
        li.append(main);
        return li;
      }),
    );
  }

  /** Destello del panel de objetivo (objetivo nuevo). */
  flashObjective(): void {
    const el = $('objective');
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  setDistance(text: string): void {
    const em = document.querySelector<HTMLElement>('#obj-list li:not(.side) em');
    if (em) em.textContent = text;
  }

  // ======================================================================= lugar

  setPlace(name: string): void {
    const el = $('room-label');
    el.classList.toggle('hidden', !name);
    el.innerHTML = name ? `Estás en: <b>${escapeHtml(name)}</b>` : '';
  }

  setLevelBadge(text: string): void {
    $('map-level').textContent = text;
  }

  updateMap(s: MapState): void {
    this.minimap.update(s);
  }

  // =================================================================== interacción

  setPrompt(p: { verb: string; target: string; locked?: boolean } | null, action?: () => void): void {
    const key = p ? `${p.verb}|${p.target}|${p.locked ? 1 : 0}` : '';
    this.promptAction = action ?? null;
    this.crosshair.classList.toggle('focus', Boolean(p));
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.prompt.classList.toggle('hidden', !p);
    this.prompt.classList.toggle('locked', Boolean(p?.locked));
    if (p) {
      $('prompt-verb').textContent = p.verb;
      $('prompt-target').textContent = p.target;
    }
  }

  /** Comentario al pasar: una línea con el nombre, sin detener el juego. */
  bark(speaker: string, color: string, text: string, seconds = 5): void {
    const el = $('bark');
    $('bark-name').textContent = `${speaker}:`;
    $('bark-name').style.color = color;
    $('bark-text').textContent = text;
    el.classList.remove('hidden');
    window.clearTimeout(this.barkTimer);
    this.barkTimer = window.setTimeout(() => el.classList.add('hidden'), seconds * 1000);
  }

  // ===================================================================== diálogo

  /** Muestra una línea. `onPick` recibe 0 para "continuar" o el índice de la opción. */
  showDialogue(line: LineView, onPick: (i: number) => void): void {
    // El comentario al pasar quedaría debajo del cuadro de diálogo.
    $('bark').classList.add('hidden');
    this.dlgOpen = true;
    this.dlgPick = onPick;
    this.dlgChoices = line.choices;
    this.dlgHot = 0;
    const box = $('dialogue');
    box.classList.remove('hidden');
    const portrait = $('dlg-portrait');
    portrait.textContent = initials(line.speaker);
    portrait.style.background = line.color;
    $('dlg-name').textContent = line.speaker;
    $('dlg-name').style.color = line.color;
    $('dlg-role').textContent = line.role;
    $('dlg-choices').replaceChildren();
    this.dlgFull = line.text;
    this.dlgShown = 0;
    this.dlgTyping = true;
    $('dlg-text').textContent = '';
    $('dlg-next').classList.add('wait');
    window.clearInterval(this.dlgTimer);
    const started = performance.now();
    this.dlgTimer = window.setInterval(() => {
      const n = Math.floor(((performance.now() - started) / 1000) * TYPE_SPEED);
      if (n >= this.dlgFull.length) this.finishTyping();
      else if (n !== this.dlgShown) {
        this.dlgShown = n;
        $('dlg-text').textContent = this.dlgFull.slice(0, n);
      }
    }, 30);
  }

  hideDialogue(): void {
    this.dlgOpen = false;
    this.dlgPick = null;
    window.clearInterval(this.dlgTimer);
    $('dialogue').classList.add('hidden');
  }

  private finishTyping(): void {
    window.clearInterval(this.dlgTimer);
    this.dlgTyping = false;
    $('dlg-text').textContent = this.dlgFull;
    const box = $('dlg-choices');
    box.replaceChildren(
      ...this.dlgChoices.map((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `choice${i === this.dlgHot ? ' hot' : ''}`;
        b.innerHTML = `<b>${i + 1}</b><span></span>`;
        b.querySelector('span')!.textContent = c;
        b.addEventListener('click', () => this.pickDialogue(i));
        return b;
      }),
    );
    $('dlg-next').classList.toggle('wait', this.dlgChoices.length > 0);
  }

  private advanceDialogue(): void {
    if (!this.dlgOpen) return;
    if (this.dlgTyping) {
      this.finishTyping();
      return;
    }
    this.pickDialogue(this.dlgChoices.length > 0 ? this.dlgHot : 0);
  }

  private pickDialogue(i: number): void {
    if (!this.dlgOpen || this.dlgTyping) return;
    blurButtons();
    if (this.dlgChoices.length > 0 && (i < 0 || i >= this.dlgChoices.length)) return;
    const pick = this.dlgPick;
    this.dlgPick = null;
    pick?.(i);
  }

  private moveHot(d: number): void {
    if (!this.dlgOpen || this.dlgTyping || this.dlgChoices.length === 0) return;
    this.dlgHot = (this.dlgHot + d + this.dlgChoices.length) % this.dlgChoices.length;
    $('dlg-choices')
      .querySelectorAll('.choice')
      .forEach((b, k) => b.classList.toggle('hot', k === this.dlgHot));
  }

  // =================================================================== actividad

  showActivity(view: ActivityView, onPick: (i: number) => void): void {
    this.actOpen = true;
    this.actPick = onPick;
    this.actView = view;
    $('activity').classList.remove('hidden');
    $('activity').classList.toggle('compact', Boolean(view.compact));
    $('act-kicker').textContent = view.kicker;
    $('act-title').textContent = view.title;
    $('act-text').textContent = view.text;
    $('act-progress').textContent = view.progress ?? '';
    const fb = $('act-feedback');
    fb.textContent = view.feedback?.text ?? '';
    fb.className = view.feedback?.tone ?? '';
    this.drawActivityCanvas(view);
    const sig = view.choices.map((c) => `${c.label}|${c.icon ?? ''}|${c.tone ?? ''}|${c.disabled ? 1 : 0}`).join(';');
    if (sig !== this.actChoiceSig) {
      this.actChoiceSig = sig;
      $('act-choices').replaceChildren(...view.choices.map((c, i) => this.choiceButton(c, i)));
    }
  }

  hideActivity(): void {
    this.actOpen = false;
    this.actPick = null;
    this.actView = null;
    this.actChoiceSig = '';
    $('activity').classList.add('hidden');
  }

  private choiceButton(c: ChoiceView, i: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `choice${c.tone ? ` ${c.tone}` : ''}`;
    b.disabled = Boolean(c.disabled);
    const num = document.createElement('b');
    num.textContent = String(i + 1);
    b.append(num);
    if (c.icon) {
      const cv = document.createElement('canvas');
      cv.width = 40;
      cv.height = 40;
      const g = cv.getContext('2d');
      if (g) drawIcon(g, c.icon, 20, 20, 30, c.tone === 'accent' ? UI.gold : UI.text);
      b.append(cv);
    }
    const s = document.createElement('span');
    s.textContent = c.label;
    b.append(s);
    b.addEventListener('click', () => {
      blurButtons();
      this.actPick?.(i);
    });
    return b;
  }

  private drawActivityCanvas(view: ActivityView): void {
    const cv = $<HTMLCanvasElement>('act-canvas');
    if (!view.grid && !view.sequence?.length) {
      cv.hidden = true;
      return;
    }
    cv.hidden = false;
    const W = cv.width;
    const gridSize = view.grid ? 300 : 0;
    const chip = 74;
    const seqH = view.sequence?.length ? Math.ceil(view.sequence.length / Math.floor((W - (view.grid ? gridSize + 60 : 0) + 13) / (chip + 13))) * (chip + 13) : 0;
    const H = Math.max(view.grid ? gridSize + 24 : 0, seqH + 10);
    if (cv.height !== H) cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, W, H);
    let x = 0;
    if (view.grid) {
      drawGrid(g, view.grid, 12, 12, gridSize);
      x = gridSize + 60;
    }
    if (view.sequence?.length) drawSequence(g, view.sequence, x, 6, W - x, chip);
  }

  // ======================================================================= ficha

  showCard(card: CardView, onClose?: () => void): void {
    this.cardOpen = true;
    this.cardClose = onClose ?? null;
    $('card-kicker').textContent = card.kicker ?? '';
    $('card-title').textContent = card.title;
    $('card-text').textContent = card.text;
    $('card').classList.remove('hidden');
  }

  closeCard(): void {
    if (!this.cardOpen) return;
    blurButtons();
    this.cardOpen = false;
    $('card').classList.add('hidden');
    const cb = this.cardClose;
    this.cardClose = null;
    cb?.();
  }

  // ====================================================================== avisos

  toast(t: ToastView, seconds = 3.6): void {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${t.kind}`;
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = TOAST_ICON[t.kind];
    const b = document.createElement('b');
    b.textContent = t.title;
    el.append(ico, b);
    if (t.text) {
      const s = document.createElement('span');
      s.textContent = t.text;
      el.append(s);
    }
    box.append(el);
    // Como mucho tres a la vez: los viejos se van primero.
    while (box.children.length > 3) box.firstElementChild?.remove();
    window.setTimeout(() => el.classList.add('out'), seconds * 1000);
    window.setTimeout(() => el.remove(), seconds * 1000 + 450);
  }

  chapterCard(kicker: string, title: string, seconds = 3.2): void {
    const el = $('chapter');
    $('chapter-kicker').textContent = kicker;
    $('chapter-title').textContent = title;
    el.classList.remove('hidden');
    window.clearTimeout(this.chapterTimer);
    this.chapterTimer = window.setTimeout(() => el.classList.add('hidden'), seconds * 1000);
  }

  setDrill(seconds: number | null): void {
    const el = $('drill');
    el.hidden = seconds === null;
    if (seconds !== null) {
      const s = Math.floor(seconds);
      $('drill-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  }

  /** Fundido a negro (1) o desde negro (0). Resuelve al terminar. */
  fade(on: boolean, ms = 600): Promise<void> {
    const el = $('fade');
    el.style.transitionDuration = `${ms}ms`;
    el.classList.toggle('on', on);
    return new Promise((r) => window.setTimeout(r, ms));
  }

  // ======================================================================= pausa

  setPause(open: boolean): void {
    if (open === this.pauseOpen || this.titleOpen || this.creditsOpen) return;
    this.pauseOpen = open;
    $('pause').classList.toggle('hidden', !open);
    if (open) {
      const vr = $<HTMLButtonElement>('btn-vr');
      const vrMenu = $<HTMLButtonElement>('btn-vr-menu');
      vrMenu.textContent = vr.textContent;
      vrMenu.disabled = vr.disabled;
      this.showTab('juego');
      $('pause-resume').focus();
    }
    this.handlers.onPause?.(open);
  }

  private showTab(tab: string): void {
    for (const t of document.querySelectorAll<HTMLButtonElement>('#pause .tab')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    for (const p of document.querySelectorAll<HTMLElement>('#pause [data-pane]')) p.hidden = p.dataset.pane !== tab;
    const data = this.handlers.passport?.();
    if (data) {
      $('pause-summary').textContent = data.summary;
      if (tab === 'pasaporte') this.renderPassport(data);
    }
  }

  private renderPassport(d: PassportView): void {
    const cv = $<HTMLCanvasElement>('stamps-canvas');
    const g = cv.getContext('2d');
    if (g) {
      g.clearRect(0, 0, cv.width, cv.height);
      const cols = 4;
      const cw = cv.width / cols;
      d.stamps.forEach((s, k) => {
        const cx = cw * (k % cols) + cw / 2;
        const cy = 75 + Math.floor(k / cols) * 150;
        drawStamp(g, cx, cy, 58, s.title, s.got);
      });
    }
    const got = d.places.filter((p) => p.got).length;
    $('places-count').textContent = `· ${got} de ${d.places.length}`;
    $('places-list').replaceChildren(
      ...d.places.map((p) => {
        const c = document.createElement('span');
        c.className = `chip${p.got ? ' on' : ''}`;
        c.textContent = p.got ? p.title : '???';
        return c;
      }),
    );
    $('quotes-list').replaceChildren(
      ...(d.quotes.length
        ? d.quotes.map((q) => {
            const el = document.createElement('div');
            el.className = 'quote';
            el.textContent = `«${q.text}»`;
            const cite = document.createElement('cite');
            cite.textContent = q.who;
            el.append(cite);
            return el;
          })
        : [Object.assign(document.createElement('p'), { textContent: 'Todavía no entrevistaste a nadie. Preguntales a quienes te ayudan.' })]),
    );
    $('items-list').replaceChildren(
      ...d.items.map((it) => {
        const c = document.createElement('span');
        c.className = `chip${it.got ? ' on' : ''}`;
        c.textContent = it.got ? it.title : '???';
        return c;
      }),
    );
  }

  setFreeRoam(on: boolean): void {
    this.freeRoam = on;
    const b = $('btn-free');
    b.textContent = on ? 'Activado' : 'Desactivado';
    b.setAttribute('aria-pressed', String(on));
  }

  setMetrics(on: boolean): void {
    document.body.classList.toggle('metrics', on);
    const b = $('btn-metrics');
    b.textContent = on ? 'Visibles' : 'Ocultas';
    b.setAttribute('aria-pressed', String(on));
    try {
      localStorage.setItem('cimdip-hud-metrics', on ? '1' : '0');
    } catch {
      // Preferencia de una sesión, nada más.
    }
  }

  // ==================================================================== créditos

  showCredits(c: CreditsView, onClose: () => void): void {
    this.creditsOpen = true;
    this.creditsClose = onClose;
    document.body.classList.add('in-credits');
    $('credits-speech').textContent = c.speech;
    // Sin frases no hubo discurso: el renglón vacío no ocupa lugar.
    $('credits-speech').hidden = !c.speech;
    $('credits-summary').replaceChildren(
      ...c.stats.map((s) => {
        const d = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = s.value;
        const sp = document.createElement('span');
        sp.textContent = s.label;
        d.append(b, sp);
        return d;
      }),
    );
    $('credits-text').innerHTML = c.lines.map((l) => (l.startsWith('#') ? `<b>${escapeHtml(l.slice(1))}</b>` : escapeHtml(l))).join('<br>');
    $('credits').classList.remove('hidden');
    $('credits-close').focus();
  }

  closeCredits(): void {
    if (!this.creditsOpen) return;
    this.creditsOpen = false;
    document.body.classList.remove('in-credits');
    $('credits').classList.add('hidden');
    const cb = this.creditsClose;
    this.creditsClose = null;
    cb?.();
  }

  // ===================================================================== teclado

  private onKey = (e: KeyboardEvent): void => {
    if (typingTarget(e) || isConsumed(e)) return;
    if (e.code === 'Escape') {
      if (this.creditsOpen) this.closeCredits();
      else if (this.cardOpen && !this.pauseOpen) this.closeCard();
      else if (!this.titleOpen) this.setPause(!this.pauseOpen);
      consume(e);
      return;
    }
    if (this.titleOpen || this.pauseOpen || this.creditsOpen) {
      if (e.code === 'Tab' && this.pauseOpen) consume(e);
      return;
    }
    if (e.code === 'Tab') {
      consume(e);
      this.setPause(true);
      this.showTab('pasaporte');
      return;
    }
    const digit = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
    const advance = e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
    if (this.dlgOpen) {
      if (digit) {
        consume(e);
        if (this.dlgTyping) this.finishTyping();
        this.pickDialogue(Number(digit[1]) - 1);
      } else if (advance) {
        consume(e);
        this.advanceDialogue();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        consume(e);
        this.moveHot(-1);
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        consume(e);
        this.moveHot(1);
      }
      return;
    }
    if (this.actOpen && this.actView) {
      const view = this.actView;
      if (digit) {
        consume(e);
        const i = Number(digit[1]) - 1;
        if (view.choices[i] && !view.choices[i].disabled) this.actPick?.(i);
      } else if (advance) {
        // Con una sola opción habilitada (Continuar, Siguiente), E la elige.
        const only = this.singleChoice(view);
        consume(e);
        if (only >= 0) this.actPick?.(only);
      }
      return;
    }
    if (this.cardOpen && advance) {
      consume(e);
      this.closeCard();
    }
  };

  private on<K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K | string, fn: (e: Event) => void): void {
    el.addEventListener(type, fn);
    this.cleanups.push(() => el.removeEventListener(type, fn));
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
    window.clearInterval(this.dlgTimer);
    window.clearTimeout(this.barkTimer);
    window.clearTimeout(this.chapterTimer);
  }
}

/**
 * Después de elegir con el mouse, el foco queda en el botón y la próxima
 * barra espaciadora lo volvería a apretar (además de avanzar el diálogo).
 */
function blurButtons(): void {
  const a = document.activeElement;
  if (a instanceof HTMLButtonElement) a.blur();
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
