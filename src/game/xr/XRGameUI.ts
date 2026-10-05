import type { PassportView } from '../../ui/Hud';
import { drawStamp, type Ctx } from '../../ui/draw';
import { COMFORT_OPTIONS, comfortValueLabel, cycleComfort, type ComfortSettings } from '../../vr/XRComfort';
import type { PanelButton, PanelScreen } from './GamePanel3D';
import { chamferRect, ellipsize, font, HOLO, keyChip, keyChipWidth, progressBar, spacedLeft, wrapLines, wrapSmart } from './holoStyle';

/**
 * Los menús de pantalla completa del visor: la pantalla de inicio (la misma
 * del escritorio, `#title` en `index.html`, adaptada a VR) y el menú del
 * juego que abre la Y (pausa, pasaporte, confort, sonido, controles, volver
 * al inicio, salir).
 *
 * Sin motor: arma los `PanelScreen` que dibuja `GamePanel3D` y decide qué
 * hace cada botón a través de `XRMenuHost` (el director). Así el director no
 * engorda con textos y pantallas, y la navegación (pila de submenús, foco al
 * volver, B = volver) se puede probar sin visor.
 *
 * También vive acá la repetición del stick para moverse por un menú y el
 * dibujo del esquema de controles y del pasaporte, que en escritorio son
 * HTML y en el visor tienen que ser canvas.
 */

// ================================================================== mapeo

/**
 * Qué hace cada botón del Quest 3 (el mapeo acordado, en el mismo orden en
 * que se lee el mando de arriba abajo). Lo dibuja la pantalla de Controles y
 * lo repite la ayuda de `index.html`: si cambia uno, cambiar el otro.
 */
export const CONTROL_MAP: Readonly<Record<'left' | 'right', ReadonlyArray<readonly [string, string]>>> = {
  left: [
    ['Stick', 'Caminar (clic: correr)'],
    ['Gatillo', 'Apuntar y elegir'],
    // Sin " · " cuando no son dos cosas: partido en dos líneas se leía "Agarrar mover panel".
    ['Grip', 'Agarrar y mover el panel'],
    ['X', 'Usar · aceptar'],
    ['Y', 'Menú del juego'],
  ],
  right: [
    ['Stick', 'Girar · ↑ saltar · ↓ paso'],
    // El mismo nombre que en la muñeca y junto al mando: "¿Adónde voy?".
    ['Clic', '¿Adónde voy? · panel al frente'],
    ['Gatillo', 'Apuntar y elegir'],
    ['Grip', 'Agarrar y mover el panel'],
    ['A', 'Usar · aceptar'],
    ['B', 'Volver · cerrar'],
  ],
};

/** Aviso de controles a los pocos segundos de empezar (sin frases nadie habla: se saluda). */
export function controlsHint(phrases: boolean): string {
  // "Gatillo o A", en ese orden, como en el pie de los paneles y el cartel.
  return phrases ? 'Stick izq.: caminar · Gatillo o A: hablar y elegir · Y: menú' : 'Stick izq.: caminar · Gatillo o A: saludar y usar · Y: menú';
}

// ======================================================= repetición del stick

/** Inclinación que cuenta como un paso, y la que rearma al volver al centro (histéresis). */
const STICK_ON = 0.6;
const STICK_OFF = 0.35;
/** Mantenido: primera repetición a los 0,45 s y después cada 0,28 s. */
const REPEAT_DELAY = 0.45;
const REPEAT_EVERY = 0.28;

/**
 * El stick como cursor de un menú: inclinarlo da UN paso; mantenerlo repite
 * despacio; volver al centro rearma. Sin la histéresis, un stick que tiembla
 * cerca del umbral daba pasos dobles y el resaltado saltaba dos botones.
 * Sólo cuenta el eje dominante: en diagonal no se mueve en dos sentidos.
 */
export class StickRepeat {
  private dx = 0;
  private dy = 0;
  private held = 0;
  private next = 0;

  /** Devuelve el paso de este cuadro ({dx, dy} con −1, 0 o 1; y > 0 = abajo) o null. */
  update(x: number, y: number, dt: number): { dx: number; dy: number } | null {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const m = Math.max(ax, ay);
    if (m < STICK_OFF) {
      this.reset();
      return null;
    }
    const active = this.dx !== 0 || this.dy !== 0;
    if (m < STICK_ON && !active) return null;
    const dx = ax >= ay ? Math.sign(x) : 0;
    const dy = ax >= ay ? 0 : Math.sign(y);
    if (!active || dx !== this.dx || dy !== this.dy) {
      // Recién inclinado (o cambió de sentido sin pasar por el centro).
      if (m < STICK_ON) return null;
      this.dx = dx;
      this.dy = dy;
      this.held = 0;
      this.next = REPEAT_DELAY;
      return { dx, dy };
    }
    this.held += dt;
    if (this.held < this.next) return null;
    this.next += REPEAT_EVERY;
    return { dx, dy };
  }

  reset(): void {
    this.dx = 0;
    this.dy = 0;
    this.held = 0;
    this.next = 0;
  }
}

// ==================================================================== menús

export type MenuId = 'title' | 'newConfirm' | 'comfort' | 'controls' | 'pause' | 'passport' | 'toTitle' | 'exit';

/** Lo que los menús necesitan del juego (lo implementa el director). */
export interface XRMenuHost {
  readonly phrases: boolean;
  /** Hay partida para seguir: guardada, o en curso en esta página. */
  canContinue(): boolean;
  /** "Nueva partida" borraría algo: pide confirmación. */
  hasProgress(): boolean;
  /** "Capítulo 2 · 3/8 sellos". */
  progressLabel(): string;
  /** "Capítulo 2 · La planta alta". */
  chapterLabel(): string;
  /** El objetivo principal, en una línea. */
  objectiveLabel(): string;
  passport(): PassportView;
  comfort(): ComfortSettings;
  setComfort(s: ComfortSettings): void;
  muted(): boolean;
  toggleMute(): void;
  freeRoam(): boolean;
  setFreeRoam(on: boolean): void;
  /** Volver al inicio sólo sin nada a medio hacer (diálogo, actividad, escena). */
  canLeaveToTitle(): boolean;
  continueGame(): void;
  startNewGame(): void;
  backToTitle(): void;
  exitVR(): void;
  /** Cierra el menú del juego (Seguir jugando, o B en la raíz). */
  closeMenu(): void;
  /** Muestra una pantalla en el panel; `large` sólo para el inicio. */
  show(screen: PanelScreen, onPick: (i: number) => void, large: boolean): void;
  /** Rótulos de los mandos a la vista (en el inicio y en Controles). */
  setHints(on: boolean): void;
  /** Un ajuste cambió de valor (sonido y tic de confirmación). */
  toggled(): void;
}

interface Entry {
  id: MenuId;
  /** Botón resaltado en esta pantalla (al volver de un submenú, el que lo abrió). */
  focus?: number;
}

const TITLE_TEXT =
  'La escuela cumple 40 años y te eligieron para armar el recorrido del aniversario. Recorré cada sector, ayudá a quienes la hacen todos los días y llegá al acto final en el Polideportivo.';
const TITLE_FOOTER = 'Personajes ficticios; escuela reconstruida desde su plano y el recorrido virtual de 2020.';
const yesNo = (on: boolean): string => (on ? 'Sí' : 'No');

/**
 * Pila de pantallas del visor. La raíz es el inicio o el menú del juego; los
 * submenús (confort, controles, pasaporte, confirmaciones) se apilan encima
 * y B (o su botón Volver) vuelve un nivel con el resaltado donde estaba.
 */
export class XRMenus {
  private stack: Entry[] = [];

  constructor(private readonly host: XRMenuHost) {}

  get open(): boolean {
    return this.stack.length > 0;
  }

  /** La raíz abierta ('title' o 'pause'), o null. */
  get root(): MenuId | null {
    return this.stack[0]?.id ?? null;
  }

  get current(): MenuId | null {
    return this.stack[this.stack.length - 1]?.id ?? null;
  }

  openRoot(root: 'title' | 'pause', focus?: number): void {
    this.stack = [{ id: root, focus }];
    this.render();
  }

  close(): void {
    this.stack = [];
  }

  /** Vuelve a dibujar la pantalla de arriba (por ejemplo, al volver de la pausa a un diálogo). */
  refresh(): void {
    if (this.open) this.render();
  }

  private push(id: MenuId, from: number): void {
    const top = this.stack[this.stack.length - 1];
    if (top) top.focus = from;
    this.stack.push({ id });
    this.render();
  }

  /** Un nivel atrás. En la raíz del menú del juego, lo cierra; en el inicio no hace nada. */
  back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render();
    } else if (this.root === 'pause') {
      this.host.closeMenu();
    }
  }

  private render(): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    const screen = this.build(top.id);
    if (top.focus !== undefined) screen.focus = top.focus;
    this.host.setHints(this.root === 'title' || top.id === 'controls');
    this.host.show(
      screen,
      (i) => {
        // Lo que se elija vuelve a abrir esta pantalla con el mismo resaltado.
        top.focus = i;
        this.pick(top.id, i, screen);
      },
      this.root === 'title' && top.id === 'title',
    );
  }

  /** Arma una pantalla. Público para los tests. */
  build(id: MenuId): PanelScreen {
    const h = this.host;
    switch (id) {
      case 'title': {
        const cont = h.canContinue();
        const buttons: PanelButton[] = [];
        if (cont) buttons.push({ label: 'Continuar', sub: h.progressLabel(), tone: 'accent', icon: 'play' });
        // Con "Continuar" arriba, "Nueva partida" es reiniciar (otro ícono: no son lo mismo).
        buttons.push({ label: 'Nueva partida', sub: 'empieza en Laprida', tone: cont ? 'normal' : 'accent', icon: cont ? 'spin' : 'play' });
        buttons.push({ label: 'Ajustes de confort', sub: 'giro, velocidad, viñeta', icon: 'gear' });
        buttons.push({ label: 'Controles', sub: 'qué hace cada botón', icon: 'pad' });
        buttons.push({ label: 'Salir de VR', sub: 'volver a la pantalla', icon: 'close' });
        return {
          style: 'title',
          kicker: 'Escuela CIMDIP & Miguel Cané',
          title: 'Recorrido 40',
          text: TITLE_TEXT,
          buttons,
          columns: 1,
          footer: TITLE_FOOTER,
        };
      }
      case 'newConfirm':
        return {
          kicker: 'Nueva partida',
          title: '¿Empezar de nuevo?',
          text: h.phrases
            ? 'Se borran los sellos, los lugares descubiertos y las entrevistas guardadas en este dispositivo. La historia vuelve a empezar en Laprida.'
            : 'Se borran los sellos y los lugares descubiertos en este dispositivo. La historia vuelve a empezar en Laprida.',
          // Lo seguro (Volver) es lo que más llama la atención; lo que borra, rojo y a la izquierda.
          buttons: [
            { label: 'Sí, borrar y empezar', sub: 'no se puede deshacer', tone: 'bad', icon: 'trash' },
            { label: 'Volver', tone: 'accent', icon: 'left' },
          ],
          columns: 2,
          focus: 1,
          back: 1,
        };
      case 'comfort': {
        const s = h.comfort();
        const buttons: PanelButton[] = COMFORT_OPTIONS.map((o) => ({ label: o.label, value: comfortValueLabel(s, o) }));
        buttons.push({ label: 'Volver', tone: 'accent', icon: 'left' });
        return {
          kicker: 'Ajustes',
          title: 'Confort en VR',
          text: 'Cada toque cambia el valor y se aplica al instante. Si algo marea: giro por pasos, caminar lento y viñeta fuerte.',
          buttons,
          columns: 2,
          back: buttons.length - 1,
          footer: 'Se guarda en este visor.',
        };
      }
      case 'controls':
        return {
          kicker: 'Ayuda',
          title: 'Controles del visor',
          draw: (ctx, area) => drawControls(ctx, area),
          // Las funciones van en letra de 30 (algunas en dos líneas): el esquema necesita este alto.
          drawHeight: 548,
          buttons: [{ label: 'Volver', tone: 'accent', icon: 'left' }],
          back: 0,
          footer: 'El botón ≡ y el de Meta son del sistema: el juego no los recibe.',
        };
      case 'pause': {
        const leave = h.canLeaveToTitle();
        const p = h.passport();
        const got = p.stamps.filter((s) => s.got).length;
        return {
          kicker: h.chapterLabel(),
          title: 'Menú del juego',
          text: h.objectiveLabel(),
          buttons: [
            { label: 'Seguir jugando', sub: 'Y o B también cierra', tone: 'accent', icon: 'play' },
            // El visor muestra la cuenta en una casilla dorada; el detalle queda para el escritorio.
            { label: 'Pasaporte 40', sub: `${got}/${p.stamps.length} sellos`, value: `${got}/${p.stamps.length}`, icon: 'stamp' },
            { label: 'Ajustes de confort', sub: 'giro, velocidad, viñeta', icon: 'gear' },
            // Sí/No: interruptor (sin ícono: el interruptor es lo que se mira).
            { label: 'Sonido', value: yesNo(!h.muted()) },
            { label: 'Explorar libre', sub: 'todo abierto', value: yesNo(h.freeRoam()) },
            { label: 'Controles', sub: 'qué hace cada botón', icon: 'pad' },
            { label: 'Volver al inicio', sub: leave ? 'el progreso queda guardado' : 'terminá lo que estás haciendo', disabled: !leave, icon: 'home' },
            { label: 'Salir de VR', sub: 'seguir en la pantalla', icon: 'close' },
          ],
          columns: 2,
          back: 0,
        };
      }
      case 'passport': {
        const p = h.passport();
        return {
          kicker: 'Tu recorrido',
          title: 'Pasaporte 40',
          draw: (ctx, area) => drawPassport(ctx, area, p),
          drawHeight: 400,
          buttons: [{ label: 'Volver', tone: 'accent', icon: 'left' }],
          back: 0,
          footer: p.summary,
        };
      }
      case 'toTitle':
        return {
          kicker: 'Menú del juego',
          title: '¿Volver al inicio?',
          text: 'Tu progreso queda guardado: desde el inicio podés continuar cuando quieras.',
          buttons: [
            { label: 'Sí, volver al inicio', icon: 'home' },
            { label: 'Seguir jugando', tone: 'accent', icon: 'play' },
          ],
          columns: 2,
          focus: 1,
          back: 1,
        };
      case 'exit':
        return {
          kicker: 'Realidad virtual',
          title: '¿Salir de VR?',
          text: 'Tu progreso queda guardado. Podés seguir en la pantalla o volver a entrar cuando quieras.',
          buttons: [
            { label: 'Sí, salir de VR', icon: 'close' },
            { label: 'Volver', tone: 'accent', icon: 'left' },
          ],
          columns: 2,
          focus: 1,
          back: 1,
        };
    }
  }

  private pick(id: MenuId, i: number, screen: PanelScreen): void {
    const h = this.host;
    const b = screen.buttons[i];
    if (!b || b.disabled) return;
    switch (id) {
      case 'title': {
        const action = b.label;
        if (action === 'Continuar') h.continueGame();
        else if (action === 'Nueva partida') {
          if (h.hasProgress()) this.push('newConfirm', i);
          else h.startNewGame();
        } else if (action === 'Ajustes de confort') this.push('comfort', i);
        else if (action === 'Controles') this.push('controls', i);
        else if (action === 'Salir de VR') this.push('exit', i);
        return;
      }
      case 'newConfirm':
        if (i === 0) h.startNewGame();
        else this.back();
        return;
      case 'comfort': {
        const opt = COMFORT_OPTIONS[i];
        if (!opt) {
          this.back();
          return;
        }
        h.setComfort(cycleComfort(h.comfort(), opt.key));
        h.toggled();
        this.render();
        return;
      }
      case 'controls':
      case 'passport':
        this.back();
        return;
      case 'pause':
        switch (i) {
          case 0:
            h.closeMenu();
            return;
          case 1:
            this.push('passport', i);
            return;
          case 2:
            this.push('comfort', i);
            return;
          case 3:
            h.toggleMute();
            h.toggled();
            this.render();
            return;
          case 4:
            h.setFreeRoam(!h.freeRoam());
            h.toggled();
            this.render();
            return;
          case 5:
            this.push('controls', i);
            return;
          case 6:
            this.push('toTitle', i);
            return;
          case 7:
            this.push('exit', i);
            return;
        }
        return;
      case 'toTitle':
        if (i === 0) h.backToTitle();
        else this.back();
        return;
      case 'exit':
        if (i === 0) h.exitVR();
        else this.back();
        return;
    }
  }
}

// =================================================================== dibujo

type Area = { x: number; y: number; w: number; h: number };

/** Silueta de un mando: aro de seguimiento, cuerpo y stick (cian: estructura). */
function controllerGlyph(ctx: Ctx, cx: number, cy: number, s: number, side: 'left' | 'right'): void {
  ctx.save();
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.18, s * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = HOLO.cyanFaint;
  chamferRect(ctx, cx - s * 0.2, cy - s * 0.05, s * 0.4, s * 0.85, s * 0.1);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = HOLO.text;
  ctx.beginPath();
  ctx.arc(cx + (side === 'left' ? -s * 0.06 : s * 0.06), cy - s * 0.2, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Columna fija de las fichas en el esquema (px): las funciones quedan alineadas. */
const CHIP_COL = 132;
const ROW_1 = 62;
const ROW_2 = 86;

/**
 * Esquema de controles: una columna por mano, cada botón como la ficha
 * dorada que se ve en el pie y junto a los mandos, con su función en letra
 * de 30 (en dos líneas si no entra: comprimida no se lee a un brazo).
 */
export function drawControls(ctx: Ctx, area: Area): void {
  const gap = 28;
  const colW = (area.w - gap) / 2;
  const headH = 52;
  const textW = colW - CHIP_COL - 30;
  (['left', 'right'] as const).forEach((side, k) => {
    const x0 = area.x + k * (colW + gap);
    controllerGlyph(ctx, x0 + 20, area.y + 22, 34, side);
    ctx.fillStyle = HOLO.cyanText;
    ctx.font = font(700, 26);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    spacedLeft(ctx, side === 'left' ? 'MANO IZQUIERDA' : 'MANO DERECHA', x0 + 52, area.y + 22, 2);
    let y = area.y + headH;
    CONTROL_MAP[side].forEach(([btn, what], r) => {
      ctx.font = font(600, 30);
      const lines = wrapSmart(ctx, what, textW);
      const rowH = lines.length > 1 ? ROW_2 : ROW_1;
      if (r % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(x0, y, colW, rowH);
      }
      const cy = y + rowH / 2;
      const cw = keyChipWidth(ctx, btn, 40);
      keyChip(ctx, btn, x0 + CHIP_COL - cw, cy, 40);
      // Guía de la ficha a la función.
      ctx.fillStyle = HOLO.cyanLine;
      ctx.fillRect(x0 + CHIP_COL + 6, cy - 1, 14, 2);
      ctx.fillStyle = HOLO.text;
      ctx.font = font(600, 30);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, x0 + CHIP_COL + 28, cy + 1 + (i - (lines.length - 1) / 2) * 34));
      y += rowH;
    });
  });
  ctx.textBaseline = 'alphabetic';
}

/**
 * Pasaporte en el visor: los ocho sellos (los obtenidos, como el sello del
 * menú de escritorio; los que faltan, una ranura con "?") y, al costado,
 * contadores de lugares y objetos con su barra.
 */
export function drawPassport(ctx: Ctx, area: Area, p: PassportView): void {
  const leftW = area.w * 0.6;
  const cols = 4;
  const rows = Math.max(1, Math.ceil(p.stamps.length / cols));
  const cw = leftW / cols;
  const ch = area.h / rows;
  const r = Math.min(cw, ch) * 0.4;
  p.stamps.forEach((s, k) => {
    const cx = area.x + (k % cols) * cw + cw / 2;
    const cy = area.y + Math.floor(k / cols) * ch + ch / 2;
    if (s.got) {
      drawStamp(ctx, cx, cy, r, s.title, true);
      return;
    }
    // Ranura vacía: se ve que falta algo, sin un nombre chico que no se lee.
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(63,230,224,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = HOLO.cyanText;
    ctx.font = font(700, Math.round(r * 0.5));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx, cy + 2);
  });
  const x = area.x + leftW + area.w * 0.04;
  const w = area.w - (x - area.x);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const places = p.places.filter((q) => q.got).length;
  const got = p.items.filter((i) => i.got);
  let y = area.y + 8;
  const counter = (label: string, n: number, total: number) => {
    ctx.fillStyle = HOLO.cyanText;
    ctx.font = font(700, 24);
    spacedLeft(ctx, label, x, y + 22, 2);
    ctx.fillStyle = HOLO.gold;
    ctx.font = font(800, 34);
    ctx.fillText(`${n}/${total}`, x, y + 62);
    progressBar(ctx, x, y + 76, w, 12, total ? n / total : 0);
    y += 112;
  };
  counter('LUGARES', places, p.places.length);
  counter('OBJETOS', got.length, p.items.length);
  ctx.font = font(500, 30);
  const lh = 38;
  const maxLines = Math.max(0, Math.floor((area.y + area.h - y) / lh));
  if (maxLines === 0) return;
  if (got.length === 0) {
    ctx.fillStyle = HOLO.dim;
    wrapLines(ctx, 'Todavía nada: recorré la escuela.', w, maxLines).forEach((l, i) => ctx.fillText(l, x, y + 26 + i * lh));
    return;
  }
  const shown = got.slice(0, maxLines);
  shown.forEach((it, k) => {
    const more = k === shown.length - 1 && got.length > shown.length ? ` (+${got.length - shown.length})` : '';
    const ly = y + 26 + k * lh;
    // ✓ dibujado en verde (hecho) y el nombre en blanco.
    ctx.strokeStyle = HOLO.ok;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 2, ly - 10);
    ctx.lineTo(x + 9, ly - 3);
    ctx.lineTo(x + 22, ly - 18);
    ctx.stroke();
    ctx.fillStyle = HOLO.text;
    ctx.fillText(ellipsize(ctx, `${it.title}${more}`, w - 34), x + 34, ly);
  });
}
