import { describe, expect, it } from 'vitest';
import { StickRepeat, XRMenus, type XRMenuHost, type MenuId } from '../src/game/xr/XRGameUI';
import type { PanelScreen } from '../src/game/xr/GamePanel3D';
import { DEFAULT_COMFORT, type ComfortSettings } from '../src/vr/XRComfort';
import { generateCityPlan } from '../src/world/CityLayout';
import { CityIndex } from '../src/world/CityIndex';
import { fromPlan, toWorld } from '../src/world/SchoolLayout';

/**
 * Menús de pantalla completa del visor (inicio y menú del juego): la pila de
 * pantallas, B = volver, los ajustes que cambian al instante y la repetición
 * del stick. Sin motor: `XRMenus` habla con el juego por `XRMenuHost`.
 */

function fakeHost(opts: { progress?: boolean; inPlace?: boolean } = {}) {
  const calls: string[] = [];
  let shown: { screen: PanelScreen; pick: (i: number) => void; large: boolean } | null = null;
  let comfort: ComfortSettings = { ...DEFAULT_COMFORT };
  let muted = false;
  let free = false;
  let hints = false;
  const host: XRMenuHost = {
    phrases: false,
    canContinue: () => Boolean(opts.progress || opts.inPlace),
    hasProgress: () => Boolean(opts.progress),
    progressLabel: () => 'Capítulo 1 · 2/8 sellos',
    chapterLabel: () => 'Capítulo 1 · La planta baja',
    objectiveLabel: () => 'Objetivo: Tocá la campana',
    passport: () => ({ summary: 'resumen', stamps: [{ title: 'Robot', got: true }], places: [], quotes: [], items: [] }),
    comfort: () => comfort,
    setComfort: (s) => {
      comfort = s;
      calls.push('setComfort');
    },
    muted: () => muted,
    toggleMute: () => {
      muted = !muted;
    },
    freeRoam: () => free,
    setFreeRoam: (on) => {
      free = on;
    },
    canLeaveToTitle: () => true,
    continueGame: () => calls.push('continue'),
    startNewGame: () => calls.push('new'),
    startFreeRoam: () => calls.push('free'),
    backToTitle: () => calls.push('toTitle'),
    exitVR: () => calls.push('exit'),
    closeMenu: () => calls.push('close'),
    show: (screen, pick, large) => {
      shown = { screen, pick, large };
    },
    setHints: (on) => {
      hints = on;
    },
    toggled: () => calls.push('toggled'),
  };
  const ui = new XRMenus(host);
  const label = (i: number) => shown!.screen.buttons[i]?.label;
  const pick = (name: string) => {
    const i = shown!.screen.buttons.findIndex((b) => b.label === name);
    expect(i, `botón «${name}» en «${shown!.screen.title}»`).toBeGreaterThanOrEqual(0);
    shown!.pick(i);
  };
  /** B: lo que el panel hace con `screen.back`. */
  const back = () => {
    const b = shown!.screen.back;
    if (b !== undefined) shown!.pick(b);
  };
  return {
    ui,
    calls,
    pick,
    back,
    label,
    get shown() {
      return shown!;
    },
    get comfort() {
      return comfort;
    },
    get muted() {
      return muted;
    },
    get free() {
      return free;
    },
    get hints() {
      return hints;
    },
  };
}

describe('pantalla de inicio del visor', () => {
  it('es la misma del escritorio: marca, texto y botones, en grande', () => {
    const h = fakeHost({ progress: true });
    h.ui.openRoot('title');
    expect(h.shown.large).toBe(true);
    expect(h.shown.screen.style).toBe('title');
    expect(h.shown.screen.title).toBe('Recorrido 40');
    expect(h.shown.screen.text).toMatch(/40 años/);
    expect(h.shown.screen.buttons.map((b) => b.label)).toEqual(['Continuar', 'Nueva partida', 'Paseo libre', 'Ajustes de confort', 'Controles', 'Salir de VR']);
    expect(h.shown.screen.buttons[0].sub).toBe('Capítulo 1 · 2/8 sellos');
    // Los rótulos de los mandos acompañan el inicio.
    expect(h.hints).toBe(true);
  });

  it('"Paseo libre" está en el inicio, como en el escritorio, y arranca sin preguntar', () => {
    const h = fakeHost({ progress: true });
    h.ui.openRoot('title');
    h.pick('Paseo libre');
    // No borra la partida: no pide confirmación.
    expect(h.calls).toEqual(['free']);
  });

  it('sin progreso no hay "Continuar" y "Nueva partida" arranca directo', () => {
    const h = fakeHost();
    h.ui.openRoot('title');
    expect(h.label(0)).toBe('Nueva partida');
    h.pick('Nueva partida');
    expect(h.calls).toEqual(['new']);
  });

  it('con progreso, "Nueva partida" pide confirmación y B vuelve al inicio', () => {
    const h = fakeHost({ progress: true });
    h.ui.openRoot('title');
    h.pick('Nueva partida');
    expect(h.calls).toEqual([]);
    expect(h.shown.screen.title).toMatch(/Empezar de nuevo/);
    // Resaltado por defecto en "Volver": A sin mirar no borra nada.
    expect(h.shown.screen.focus).toBe(1);
    h.back();
    expect(h.shown.screen.title).toBe('Recorrido 40');
    // Vuelve con el resaltado en el botón que abrió la confirmación.
    expect(h.shown.screen.focus).toBe(1);
    h.pick('Nueva partida');
    h.pick('Sí, borrar y empezar');
    expect(h.calls).toEqual(['new']);
  });

  it('"Continuar" sigue la partida; en el inicio B no cierra nada', () => {
    const h = fakeHost({ inPlace: true });
    h.ui.openRoot('title');
    expect(h.shown.screen.back).toBeUndefined();
    h.ui.back();
    expect(h.ui.open).toBe(true);
    expect(h.calls).toEqual([]);
    h.pick('Continuar');
    expect(h.calls).toEqual(['continue']);
  });

  it('Ajustes de confort y Controles vuelven al inicio con B', () => {
    const h = fakeHost();
    h.ui.openRoot('title');
    for (const name of ['Ajustes de confort', 'Controles'] as const) {
      h.pick(name);
      expect(h.shown.large).toBe(false);
      h.back();
      expect(h.ui.current).toBe<MenuId>('title');
      expect(h.shown.large).toBe(true);
    }
  });

  it('Salir de VR pide confirmación', () => {
    const h = fakeHost();
    h.ui.openRoot('title');
    h.pick('Salir de VR');
    expect(h.calls).toEqual([]);
    h.pick('Sí, salir de VR');
    expect(h.calls).toEqual(['exit']);
  });
});

describe('menú del juego del visor (Y)', () => {
  it('B en la raíz lo cierra, como "Seguir jugando"', () => {
    const h = fakeHost({ progress: true });
    h.ui.openRoot('pause');
    expect(h.shown.large).toBe(false);
    expect(h.hints).toBe(false);
    h.back();
    expect(h.calls).toEqual(['close']);
  });

  it('confort: cada pulsación cambia el valor, lo aplica y conserva el resaltado', () => {
    const h = fakeHost({ progress: true });
    h.ui.openRoot('pause');
    h.pick('Ajustes de confort');
    const i = h.shown.screen.buttons.findIndex((b) => b.label === 'Giro');
    expect(h.shown.screen.buttons[i].value).toBe('Por pasos');
    h.shown.pick(i);
    expect(h.comfort.turnMode).toBe('smooth');
    expect(h.calls).toEqual(['setComfort', 'toggled']);
    expect(h.shown.screen.buttons[i].value).toBe('Continuo');
    expect(h.shown.screen.focus).toBe(i);
    // B vuelve al menú, con el resaltado en "Ajustes de confort".
    h.back();
    expect(h.ui.current).toBe<MenuId>('pause');
    expect(h.label(h.shown.screen.focus!)).toBe('Ajustes de confort');
  });

  it('sonido y explorar libre se alternan en el lugar', () => {
    const h = fakeHost({ progress: true });
    h.ui.openRoot('pause');
    h.pick('Sonido');
    expect(h.muted).toBe(true);
    expect(h.shown.screen.buttons.find((b) => b.label === 'Sonido')!.value).toBe('No');
    h.pick('Explorar libre');
    expect(h.free).toBe(true);
    expect(h.shown.screen.buttons.find((b) => b.label === 'Explorar libre')!.value).toBe('Sí');
  });

  it('volver al inicio y salir piden confirmación; el pasaporte dibuja los sellos', () => {
    const h = fakeHost({ progress: true });
    h.ui.openRoot('pause');
    h.pick('Pasaporte 40');
    expect(typeof h.shown.screen.draw).toBe('function');
    h.back();
    h.pick('Volver al inicio');
    h.pick('Seguir jugando');
    expect(h.ui.current).toBe<MenuId>('pause');
    h.pick('Volver al inicio');
    h.pick('Sí, volver al inicio');
    expect(h.calls).toEqual(['toTitle']);
  });

  it('Controles muestra los rótulos de los mandos', () => {
    const h = fakeHost({ progress: true });
    h.ui.openRoot('pause');
    h.pick('Controles');
    expect(h.hints).toBe(true);
    h.back();
    expect(h.hints).toBe(false);
  });
});

describe('stick como cursor de menú', () => {
  const dt = 1 / 72;
  const run = (s: StickRepeat, x: number, y: number, seconds: number) => {
    const steps: Array<{ dx: number; dy: number }> = [];
    for (let t = 0; t < seconds; t += dt) {
      const r = s.update(x, y, dt);
      if (r) steps.push(r);
    }
    return steps;
  };

  it('inclinar da un paso; volver al centro rearma', () => {
    const s = new StickRepeat();
    expect(run(s, 0, 0.9, 0.3)).toEqual([{ dx: 0, dy: 1 }]);
    expect(run(s, 0, 0, 0.1)).toEqual([]);
    expect(run(s, 0, -0.9, 0.3)).toEqual([{ dx: 0, dy: -1 }]);
  });

  it('mantenido repite despacio (0,45 s y después cada 0,28 s)', () => {
    const s = new StickRepeat();
    // 1 s: el paso inicial + a los 0,45 + a los 0,73 = 3.
    expect(run(s, 0.95, 0, 1.0)).toHaveLength(3);
  });

  it('el temblor cerca del umbral no da pasos dobles (histéresis)', () => {
    const s = new StickRepeat();
    let steps = 0;
    // 0,4 s temblando entre 0,45 y 0,62: antes de la primera repetición.
    for (let k = 0; k < 28; k++) if (s.update(0, k % 2 ? 0.62 : 0.45, dt)) steps++;
    expect(steps).toBe(1);
    // Por debajo del umbral de entrada, nada.
    const q = new StickRepeat();
    expect(run(q, 0, 0.5, 1)).toEqual([]);
  });

  it('sólo cuenta el eje dominante', () => {
    const s = new StickRepeat();
    expect(run(s, 0.8, 0.65, 0.2)).toEqual([{ dx: 1, dy: 0 }]);
  });
});

describe('mirador de la pantalla de inicio en el visor', () => {
  it('es un lugar libre sobre la vereda de enfrente de Laprida', () => {
    const index = new CityIndex(generateCityPlan(42, { gridSize: 5 }));
    const f = index.school!;
    const { x, z } = toWorld(f, ...fromPlan(44, 9.5));
    const ground = index.groundHeight(x, z);
    expect(index.isSolid(x, z, ground)).toBe(false);
    // Un radio de cuerpo libre, como el teletransporte.
    const r = 0.3;
    expect([[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => index.canLandAt(x + dx, z + dz, ground))).toBe(true);
  });
});
