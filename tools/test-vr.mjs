/**
 * Prueba de la experiencia VR con un Meta Quest 3 emulado.
 *
 * Nadie puede ponerse el casco después de cada cambio, y compilar no dice nada
 * de cómo se siente adentro. IWER (Immersive Web Emulation Runtime, de Meta)
 * implementa `navigator.xr` en JavaScript: la página cree que corre en un
 * Quest 3 —incluido el user agent, así que elige el perfil VR igual que en el
 * visor— y desde acá se mueven la cabeza, los mandos y sus botones.
 *
 * Recorre lo que hace una persona con el casco puesto:
 *
 *  - entrar desde el título: aparece la MISMA pantalla de inicio (sello 40,
 *    "Recorrido 40") en el visor, parado sobre el piso y sin poder caminar;
 *  - moverse por el inicio con el stick, elegir con el gatillo apuntando el
 *    láser (se elige al soltar), cambiar un ajuste de confort (se guarda),
 *    volver con B, ver los controles;
 *  - empezar con la A: se cierra el panel, arranca la partida y se camina;
 *  - saludar a Rubén con la A (en silencio: el juego no tiene frases);
 *  - Y abre y cierra el menú del juego (pausa, sin caminar), stick y B dentro
 *    de él, el grip arrastra el panel, "Volver al inicio" y "Continuar";
 *  - stick izquierdo camina, derecho gira y teletransporta, paredes;
 *  - salir de VR desde el menú y volver al escritorio, sin errores.
 *
 * Limitación conocida del emulador (HANDOFF 62 y 6): la cámara XR vuelve al
 * origen en cada cuadro (no respeta el espacio de referencia desplazado), así
 * que "el stick izquierdo camina", "gira" y "teletransporta" fallan en IWER
 * aunque la caminata calcule bien (`__xr().motion`). Se informan como LIM y
 * no cambian el resultado; cualquier otra falla sí.
 *
 *   node tools/test-vr.mjs [url] [carpeta-capturas] [--sw]
 *
 * `--sw` usa SwiftShader (render por software) si la máquina no tiene GPU.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// Con título y la historia de verdad: entrar al visor desde ahí tiene que
// mostrar el inicio del visor, no arrancar solo.
const baseUrl = positional[0] ?? 'http://localhost:5190/?seed=42';
const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'titulo=1&libre=0&hud=1';
const shotDir = positional[1] ?? 'shots';
const software = process.argv.includes('--sw');
mkdirSync(shotDir, { recursive: true });

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const IWER = readFileSync(join(import.meta.dirname, '../node_modules/iwer/build/iwer.min.js'), 'utf8');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: software
    ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
    : ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 800 });

const errors = [];
const warnings = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error] ${m.text().slice(0, 300)}`);
  else if (m.type() === 'warn') warnings.push(`[warn] ${m.text().slice(0, 300)}`);
});
// Un modelo de mando pedido a un CDN que no responde también es un error.
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));

// El runtime emulado tiene que estar instalado ANTES de que la página pregunte
// si hay visor.
await page.evaluateOnNewDocument(IWER);
await page.evaluateOnNewDocument(() => {
  const device = new window.IWER.XRDevice(window.IWER.metaQuest3);
  device.installRuntime({ forceInstall: true });
  window.__xrDevice = device;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
/** Lo que falla sólo por la cámara del emulador (ver arriba): se informa, no cuenta. */
const EMULATOR_LIMITED = new Set(['el stick izquierdo camina', 'mirando al piso camina a la misma velocidad', 'el stick derecho gira por pasos', 'el stick derecho teletransporta']);
const check = (name, ok, extra = '') =>
  results.push(`${ok ? 'OK  ' : EMULATOR_LIMITED.has(name) ? 'LIM ' : 'FALL'}  ${name}${extra ? '  — ' + extra : ''}`);
const fmt = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : String(n));
const until = (fn, timeout = 10000, ...args) =>
  page
    .waitForFunction(fn, { timeout, polling: 100 }, ...args)
    .then(() => true)
    .catch(() => false);

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 240000,
  polling: 200,
});
const ready = await page
  .waitForFunction(
    () => {
      const b = document.getElementById('btn-vr');
      return b && !b.disabled && /Entrar/.test(b.textContent ?? '');
    },
    { timeout: 60000, polling: 200 },
  )
  .then(() => true)
  .catch(() => false);
check('se habilita el botón de VR', ready, await page.$eval('#btn-vr', (b) => b.textContent ?? ''));
if (!ready) await finish();
const tier = await page.$eval('#btn-quality', (el) => el.textContent);
check('el user agent del Quest elige el perfil VR', /VR/.test(tier ?? ''), tier ?? '');

// Con la pantalla de título, el botón de VR es el suyo ("Jugar en VR").
const titleVr = await page.$eval('#title-vr', (b) => !b.hidden && b.offsetParent !== null).catch(() => false);
check('el título ofrece jugar en VR', titleVr);
await page.click(titleVr ? '#title-vr' : '#btn-vr');
const entered = await until(() => window.__scene?.activeCamera?.getClassName() === 'WebXRCamera', 120000);
check('entra en VR', entered);
if (!entered) await finish();
await sleep(2500);

// --------------------------------------------------------------- utilidades

/** Estado de la cabeza en el mundo y lo que el índice dice del lugar. */
const state = () =>
  page.evaluate(() => {
    const s = window.__scene;
    const cam = s.activeCamera;
    const p = cam.position;
    const e = cam.rotationQuaternion.toEulerAngles();
    const idx = window.__index?.();
    // `realWorldHeight` sólo se puede leer dentro del cuadro XR: la altura real
    // de la cabeza es la del visor emulado.
    const head = window.__xrDevice.position.y;
    const feet = p.y - head;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: e.y,
      head,
      feet,
      ground: idx ? idx.groundHeight(p.x, p.z, feet) : null,
      solid: idx ? idx.isSolid(p.x, p.z, feet) : null,
      fps: s.getEngine().getFps(),
      postTonemap: s.imageProcessingConfiguration.applyByPostProcess,
    };
  });

/** Lo que muestra el panel del visor y en qué está el juego (campos internos del director). */
const ui = () =>
  page.evaluate(() => {
    const g = window.__game;
    const p = g?.panel;
    const m = p?.model;
    const screen = m?.kind === 'screen' ? m.screen : null;
    return {
      atTitle: g?.atTitle ?? null,
      modal: g?.modal ?? null,
      busy: g?.xrBusy ?? null,
      visible: Boolean(p?.visible),
      kind: p?.kind ?? null,
      style: screen ? (screen.style ?? 'default') : null,
      title: screen?.title ?? null,
      buttons: screen ? screen.buttons.map((b) => b.label) : [],
      highlight: p?.highlight ?? -1,
      menu: g?.menus?.current ?? null,
      root: g?.menus?.root ?? null,
      canWalk: window.__xr()?.canWalk ?? null,
      clock: g?.clock ?? 0,
      pinned: Boolean(p?.pinned),
      pos: p ? { x: p.position.x, y: p.position.y, z: p.position.z } : null,
      hints: Boolean(window.__scene.getMeshByName('xrHint-right')?.isEnabled()),
    };
  });

const stick = (hand, x, y) =>
  page.evaluate((h, ax, ay) => window.__xrDevice.controllers[h].updateAxes('thumbstick', ax, ay), hand, x, y);

/** Un empujón del stick (un paso en un menú). */
const flick = async (hand, x, y) => {
  await stick(hand, x, y);
  await sleep(180);
  await stick(hand, 0, 0);
  await sleep(220);
};

const button = (hand, b, v) => page.evaluate((h, id, val) => window.__xrDevice.controllers[h].updateButtonValue(id, val), hand, b, v);

/** Aprieta y suelta un botón del mando (ids de IWER: trigger, squeeze, thumbstick, a-button…). */
const press = async (hand, b, hold = 150) => {
  await button(hand, b, 1);
  await sleep(hold);
  await button(hand, b, 0);
  await sleep(450);
};

/** Empuja el stick izquierdo para avanzar en una dirección del MUNDO (x, z). */
const stickToward = (dx, dz) =>
  page.evaluate(
    (wx, wz) => {
      const cam = window.__scene.activeCamera;
      const yaw = cam.rotationQuaternion.toEulerAngles().y;
      // Babylon es de mano izquierda: adelante = (sin, cos), derecha = (cos, −sin).
      const f = wx * Math.sin(yaw) + wz * Math.cos(yaw);
      const r = wx * Math.cos(yaw) - wz * Math.sin(yaw);
      const l = Math.hypot(f, r) || 1;
      window.__xrDevice.controllers.left.updateAxes('thumbstick', r / l, -f / l);
    },
    dx,
    dz,
  );

const shot = (name) => page.screenshot({ path: `${shotDir}/${name}.png` });

// Posición original de los mandos. Después de apuntar al panel vuelven ahí,
// apuntando al piso: un láser olvidado sobre el panel movería el resaltado
// (y la A elegiría otra cosa) o le robaría el foco a la mirada.
const restPose = await page.evaluate(() =>
  Object.fromEntries(
    ['left', 'right'].map((h) => {
      const c = window.__xrDevice.controllers[h];
      return [h, [c.position.x, c.position.y, c.position.z]];
    }),
  ),
);
const restHands = () =>
  page.evaluate((pose) => {
    const s = Math.SQRT1_2;
    for (const h of ['left', 'right']) {
      const c = window.__xrDevice.controllers[h];
      c.position.set(...pose[h]);
      // −90° en X (mano derecha): el láser apunta hacia abajo.
      c.quaternion.set(-s, 0, 0, s);
    }
  }, restPose);

/**
 * Orienta el mando emulado para que su láser caiga en el centro del botón
 * `zone` del panel. Busca el botón probando rayos contra el panel (la misma
 * `hitTest` del juego) y gira el mando lo que falte, corrigiendo con lo que
 * el juego lee de verdad (`rayOf`) hasta que el láser queda encima.
 */
const aimAt = async (hand, zone) => {
  await page.evaluate((h) => {
    // La mano a la altura del pecho, delante y al costado.
    const head = window.__xrDevice.position;
    const c = window.__xrDevice.controllers[h];
    c.position.set(head.x + (h === 'right' ? 0.18 : -0.18), head.y - 0.3, head.z - 0.25);
  }, hand);
  await sleep(150);
  for (let k = 0; k < 6; k++) {
    const r = await page.evaluate(
      (h, z) => {
        const g = window.__game;
        const V = window.__BABYLON_Vector3;
        const panel = g.panel;
        const mesh = window.__scene.getMeshByName('gamePanel');
        if (!panel?.visible || !mesh) return { done: false, why: 'sin panel' };
        const RayC = g.ray.constructor;
        const ray = new RayC(V.Zero(), new V(0, 0, 1), 20);
        if (!g.xrControls.input.rayOf(h, ray)) return { done: false, why: 'sin rayo' };
        const now = panel.hitTest(ray);
        if (now && now.zone === z && g.onPanel[h] === z) return { done: true };
        const O = ray.origin.clone();
        const D0 = ray.direction.clone().normalize();
        mesh.computeWorldMatrix(true);
        const wm = mesh.getWorldMatrix();
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (let iy = 0; iy <= 48; iy++) {
          for (let ix = 0; ix <= 48; ix++) {
            const w = V.TransformCoordinates(new V(-0.5 + ix / 48, 0.5 - iy / 48, 0), wm);
            const probe = new RayC(O, w.subtract(O).normalize(), 20);
            const hit = panel.hitTest(probe);
            if (hit && hit.zone === z) {
              sx += w.x;
              sy += w.y;
              sz += w.z;
              n++;
            }
          }
        }
        if (!n) return { done: false, why: `botón ${z} no encontrado` };
        const D = new V(sx / n - O.x, sy / n - O.y, sz / n - O.z).normalize();
        // Giro (en el mundo) que lleva el láser actual al botón: eje y ángulo.
        const axis = V.Cross(D0, D);
        const s = axis.length();
        const ang = Math.atan2(s, V.Dot(D0, D));
        if (s < 1e-6) return { done: false, why: 'alineado sin acierto' };
        axis.scaleInPlace(1 / s);
        // El mundo de Babylon es de mano izquierda y el del dispositivo de mano
        // derecha (z invertida): un giro (a, φ) del mundo es (−F·a, φ) en el visor.
        const ax = -axis.x;
        const ay = -axis.y;
        const az = axis.z;
        const sh = Math.sin(ang / 2);
        const rq = [ax * sh, ay * sh, az * sh, Math.cos(ang / 2)];
        const c = window.__xrDevice.controllers[h];
        const q = [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w];
        // rq ⊗ q: primero la pose actual, después la corrección.
        const m = [
          rq[3] * q[0] + rq[0] * q[3] + rq[1] * q[2] - rq[2] * q[1],
          rq[3] * q[1] - rq[0] * q[2] + rq[1] * q[3] + rq[2] * q[0],
          rq[3] * q[2] + rq[0] * q[1] - rq[1] * q[0] + rq[2] * q[3],
          rq[3] * q[3] - rq[0] * q[0] - rq[1] * q[1] - rq[2] * q[2],
        ];
        const l = Math.hypot(...m);
        c.quaternion.set(m[0] / l, m[1] / l, m[2] / l, m[3] / l);
        return { done: false, why: `corrigiendo ${((ang * 180) / Math.PI).toFixed(1)}°` };
      },
      hand,
      zone,
    );
    if (r.done) return { ok: true };
    if (/sin panel|sin rayo|no encontrado/.test(r.why)) return { ok: false, why: r.why };
    await sleep(120);
  }
  return { ok: false, why: 'no se pudo apuntar' };
};

/** Apunta al botón con ese rótulo y lo elige con el gatillo (apretar y soltar encima). */
const triggerPick = async (hand, label) => {
  const before = await ui();
  const zone = before.buttons.indexOf(label);
  if (zone < 0) return { ok: false, why: `sin botón «${label}» en ${JSON.stringify(before.buttons)}` };
  // Recién abierto, el panel no acepta elecciones (armado): se espera.
  await sleep(400);
  const aim = await aimAt(hand, zone);
  if (!aim.ok) return aim;
  await button(hand, 'trigger', 1);
  await sleep(160);
  const pressedOk = await page.evaluate((z) => window.__game.panel.pressed === z, zone);
  await button(hand, 'trigger', 0);
  await sleep(450);
  return { ok: pressedOk, why: pressedOk ? '' : 'el botón no se vio apretado' };
};

/**
 * Orienta el mando para que el láser corte el plano del panel en el píxel
 * (px, py) del lienzo (puede ser el hueco entre botones o fuera de uno). Usa
 * `canvasPoint`, la misma cuenta con la que el panel mide cuánto se corrió
 * el láser al soltar el gatillo.
 */
const aimAtCanvas = async (hand, px, py) => {
  for (let k = 0; k < 8; k++) {
    const r = await page.evaluate(
      (h, X, Y) => {
        const g = window.__game;
        const V = window.__BABYLON_Vector3;
        const panel = g.panel;
        const mesh = window.__scene.getMeshByName('gamePanel');
        if (!panel?.visible || !mesh) return { done: false, why: 'sin panel' };
        const RayC = g.ray.constructor;
        const ray = new RayC(V.Zero(), new V(0, 0, 1), 20);
        if (!g.xrControls.input.rayOf(h, ray)) return { done: false, why: 'sin rayo' };
        const at = panel.canvasPoint(ray);
        if (at && Math.hypot(at.px - X, at.py - Y) < 4) return { done: true };
        mesh.computeWorldMatrix(true);
        const w = V.TransformCoordinates(new V(X / 1024 - 0.5, 0.5 - Y / panel.contentH, 0), mesh.getWorldMatrix());
        const O = ray.origin.clone();
        const D0 = ray.direction.clone().normalize();
        const D = w.subtract(O).normalize();
        const axis = V.Cross(D0, D);
        const s = axis.length();
        const ang = Math.atan2(s, V.Dot(D0, D));
        if (s < 1e-7) return { done: false, why: 'alineado sin acierto' };
        axis.scaleInPlace(1 / s);
        const sh = Math.sin(ang / 2);
        const rq = [-axis.x * sh, -axis.y * sh, axis.z * sh, Math.cos(ang / 2)];
        const c = window.__xrDevice.controllers[h];
        const q = [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w];
        const m = [
          rq[3] * q[0] + rq[0] * q[3] + rq[1] * q[2] - rq[2] * q[1],
          rq[3] * q[1] - rq[0] * q[2] + rq[1] * q[3] + rq[2] * q[0],
          rq[3] * q[2] + rq[0] * q[1] - rq[1] * q[0] + rq[2] * q[3],
          rq[3] * q[3] - rq[0] * q[0] - rq[1] * q[1] - rq[2] * q[2],
        ];
        const l = Math.hypot(...m);
        c.quaternion.set(m[0] / l, m[1] / l, m[2] / l, m[3] / l);
        return { done: false, why: 'corrigiendo' };
      },
      hand,
      px,
      py,
    );
    if (r.done) return { ok: true };
    if (/sin panel|sin rayo/.test(r.why)) return { ok: false, why: r.why };
    await sleep(120);
  }
  return { ok: false, why: `no se pudo apuntar a (${px}, ${py})` };
};

/** Rectángulo (px del lienzo) del botón con ese rótulo, o null. */
const zoneRect = (label) =>
  page.evaluate((lb) => {
    const g = window.__game;
    const i = g.panel.btns.findIndex((b) => b.label === lb);
    const z = g.panel.zones.find((zz) => zz.index === g.panel.btns[i]?.index);
    return z ? { ...z } : null;
  }, label);

// ----------------------------------------------------- inicio en el visor

const spawn = await state();
const title = await ui();
await shot('vr-1-inicio');
check('colores: el mapeo tonal se aplica en el material', spawn.postTonemap === false);
check(
  'aparece parado sobre el piso',
  spawn.ground !== null && Math.abs(spawn.feet - spawn.ground) < 0.05,
  `pies ${fmt(spawn.feet)} · piso ${fmt(spawn.ground)} · cabeza ${fmt(spawn.head)}`,
);
check('no aparece dentro de un muro', spawn.solid === false);
// Lo pidió el usuario: al entrar NO se va directo frente a la escuela; primero
// la misma pantalla de inicio que en la PC y el celular.
check(
  'al entrar aparece la pantalla de inicio en el visor',
  title.atTitle === true && title.visible && title.kind === 'screen' && title.style === 'title' && title.root === 'title',
  `${title.title} · ${title.buttons.join(' / ')}`,
);
check('en el inicio no se camina', title.canWalk === false);
check('en el inicio se ven los rótulos de los mandos', title.hints);
check('el título HTML queda oculto detrás del visor', await page.$eval('#title', (t) => t.classList.contains('hidden') || window.getComputedStyle(t).display === 'none').catch(() => true));

// Stick: mueve el resaltado (abajo y arriba) sin elegir nada. Abajo con el
// DERECHO: ahí vivía el paso atrás de Babylon, que no miraba si la locomoción
// estaba apagada (cada paso del resaltado alejaba 0,8 m al jugador).
const h0 = title.highlight;
const feetBefore = await page.evaluate(() => {
  const c = window.__scene.activeCamera.position;
  return { x: c.x, z: c.z };
});
await flick('right', 0, 1);
const h1 = (await ui()).highlight;
const feetAfter = await page.evaluate(() => {
  const c = window.__scene.activeCamera.position;
  return { x: c.x, z: c.z };
});
await flick('left', 0, -1);
const h2 = await ui();
check('el stick mueve el resaltado del inicio', h0 === 0 && h1 === 1 && h2.highlight === 0 && h2.atTitle, `${h0} → ${h1} → ${h2.highlight}`);
const babylonBack = await page.evaluate(
  () => window.__game.xr?.baseExperience.featuresManager.getEnabledFeature('xr-controller-teleportation')?.backwardsMovementEnabled ?? null,
);
const titleDrift = Math.hypot(feetAfter.x - feetBefore.x, feetAfter.z - feetBefore.z);
check('bajar en el inicio con el stick derecho no da un paso atrás', babylonBack === false && titleDrift < 0.2, `paso de Babylon ${babylonBack} · corrimiento ${fmt(titleDrift)} m`);

// Gatillo con el láser sobre "Ajustes de confort": se elige al soltar.
const pickComfort = await triggerPick('right', 'Ajustes de confort');
const comfortUi = await ui();
check('el gatillo con el láser elige al soltar (Ajustes de confort)', pickComfort.ok && comfortUi.menu === 'comfort', pickComfort.why || `${comfortUi.title}`);
await shot('vr-1b-confort');

// Un ajuste: el giro pasa de por pasos a continuo, se aplica y se guarda.
const turnBefore = await page.evaluate(() => window.__game.xrControls.getComfort().turnMode);
const pickTurn = await triggerPick('right', comfortUi.buttons[0] ?? '');
const turnAfter = await page.evaluate(() => ({
  mode: window.__game.xrControls.getComfort().turnMode,
  saved: JSON.parse(window.localStorage.getItem('cimdip-vr-comfort-v1') ?? 'null')?.turnMode ?? null,
}));
check(
  'un ajuste de confort cambia y se guarda',
  pickTurn.ok && turnBefore !== turnAfter.mode && turnAfter.saved === turnAfter.mode,
  `${turnBefore} → ${turnAfter.mode} (guardado: ${turnAfter.saved})`,
);
// La A elige lo resaltado (el mismo ajuste): vuelve al giro por pasos.
await restHands();
await sleep(200);
await press('right', 'a-button');
const turnBack = await page.evaluate(() => window.__game.xrControls.getComfort().turnMode);
check('la A elige lo resaltado (el ajuste vuelve)', turnBack === turnBefore, `${turnAfter.mode} → ${turnBack}`);

// B vuelve al inicio, con el resaltado donde estaba.
await press('right', 'b-button');
const backUi = await ui();
check('B vuelve un nivel (confort → inicio)', backUi.menu === 'title' && backUi.buttons[backUi.highlight] === 'Ajustes de confort', `${backUi.menu} · ${backUi.buttons[backUi.highlight]}`);

// Fácil de clickear: al tirar del gatillo el mando cabecea y el láser baja.
// Se apunta a «Ajustes de confort», se empieza a apretar, el láser cae sobre
// el botón de abajo (el cabeceo) y así se aprieta y se suelta: tiene que
// elegir el botón apuntado al empezar, no el de abajo ni nada.
await sleep(400);
const dipRect = await zoneRect('Ajustes de confort');
if (dipRect) {
  const cx = (dipRect.x0 + dipRect.x1) / 2;
  const cy = (dipRect.y0 + dipRect.y1) / 2;
  const aimed0 = await aimAtCanvas('right', cx, cy);
  const sameMap = await page.evaluate(() => {
    const g = window.__game;
    const V = window.__BABYLON_Vector3;
    const ray = new g.ray.constructor(V.Zero(), new V(0, 0, 1), 20);
    g.xrControls.input.rayOf('right', ray);
    return g.panel.hitTest(ray)?.zone ?? -9;
  });
  check('el plano del panel y su textura coinciden (canvasPoint ↔ hitTest)', aimed0.ok && sameMap === dipRect.index, `zona ${sameMap} · esperada ${dipRect.index}`);
  await button('right', 'trigger', 0.3);
  await sleep(150);
  const dip = (dipRect.y1 - dipRect.y0) / 2 + 28; // ≈7 cm hacia abajo: sobre el botón vecino
  const dipAim = await aimAtCanvas('right', cx, cy + dip);
  // Sin la corrección, el láser ahí elige el botón de abajo.
  const dipZone = await page.evaluate(() => {
    const g = window.__game;
    const V = window.__BABYLON_Vector3;
    const ray = new g.ray.constructor(V.Zero(), new V(0, 0, 1), 20);
    g.xrControls.input.rayOf('right', ray);
    return g.panel.hitTest(ray)?.zone ?? -9;
  });
  await button('right', 'trigger', 1);
  await sleep(160);
  const dipPressed = await page.evaluate(() => window.__game.panel.pressed);
  await button('right', 'trigger', 0);
  await sleep(450);
  const dipUi = await ui();
  check(
    'con el cabeceo del gatillo se elige el botón apuntado al empezar a apretar',
    dipAim.ok && dipZone !== dipRect.index && dipPressed === dipRect.index && dipUi.menu === 'comfort',
    `láser cayó en ${dipZone} · apretado ${dipPressed} (esperado ${dipRect.index}) · ${dipUi.menu}`,
  );
  if (dipUi.menu !== 'title') {
    await press('right', 'b-button');
    await sleep(300);
  }

  // El hueco entre dos botones también es clickeable (imán al más cercano).
  await sleep(400);
  const gapRect = await zoneRect('Ajustes de confort');
  await aimAtCanvas('right', (gapRect.x0 + gapRect.x1) / 2, gapRect.y1 + 6);
  await sleep(150);
  await button('right', 'trigger', 1);
  await sleep(160);
  const gapPressed = await page.evaluate(() => window.__game.panel.pressed);
  await button('right', 'trigger', 0);
  await sleep(450);
  const gapUi = await ui();
  check('el gatillo en el hueco entre botones elige el más cercano', gapPressed === gapRect.index && gapUi.menu === 'comfort', `apretado ${gapPressed} · ${gapUi.menu}`);
  if (gapUi.menu !== 'title') {
    await press('right', 'b-button');
    await sleep(300);
  }

  // Arrepentirse: apretar sobre un botón y soltar lejos (otro botón, a más de medio botón) no elige.
  await sleep(400);
  const r0 = await zoneRect('Ajustes de confort');
  await aimAtCanvas('right', (r0.x0 + r0.x1) / 2, (r0.y0 + r0.y1) / 2);
  await button('right', 'trigger', 1);
  await sleep(160);
  await aimAtCanvas('right', (r0.x0 + r0.x1) / 2, r0.y1 + 150);
  await button('right', 'trigger', 0);
  await sleep(450);
  const regretUi = await ui();
  check('apretar y llevar el láser lejos antes de soltar no elige nada', regretUi.menu === 'title', regretUi.menu);
} else {
  check('con el cabeceo del gatillo se elige el botón apuntado al empezar a apretar', false, 'sin botón «Ajustes de confort»');
}
await restHands();
await sleep(200);

// Controles: el esquema de botones se lee en el visor.
const pickControls = await triggerPick('right', 'Controles');
const controlsUi = await ui();
check('se abre la pantalla de controles', pickControls.ok && controlsUi.menu === 'controls', pickControls.why);
await restHands();
await sleep(300);
await shot('vr-1c-controles');
await press('right', 'b-button');

// La A sobre "Nueva partida" empieza: fundido, la partida arranca, el panel se
// cierra y se camina. Sin progreso no hay "Continuar".
let startUi = await ui();
for (let k = 0; k < 6 && startUi.buttons[startUi.highlight] !== 'Nueva partida'; k++) {
  await flick('left', 0, -1);
  startUi = await ui();
}
await press('right', 'a-button');
const started = await until(() => {
  const g = window.__game;
  return g && !g.atTitle && g.modal === null && !g.xrBusy && window.__xr()?.canWalk === true;
}, 15000);
const afterStart = await ui();
check('la A en «Nueva partida» arranca la partida y se camina', started, `${startUi.buttons[startUi.highlight]} · ${JSON.stringify({ atTitle: afterStart.atTitle, modal: afterStart.modal, canWalk: afterStart.canWalk })}`);
check('al empezar se cierra el panel (la misma pulsación no elige otra cosa)', !afterStart.visible && afterStart.menu === null, afterStart.kind ?? '');
check('los primeros segundos de juego se ven los rótulos de los mandos', afterStart.hints);
check('apenas empieza se puede caminar', afterStart.canWalk === true);
await shot('vr-2-partida');

// ------------------------------------------------------------ saludar a Rubén

// El juego no tiene frases (lo pidió el usuario, ver src/game/story/phrases.ts):
// la A sobre Rubén abre el portal en silencio, sin panel con líneas, sin
// comentarios y sin voz, y se sigue caminando.
// En el emulador la cabeza no se puede llevar hasta Rubén (ver HANDOFF 62):
// se lo pone a él a 1,4 m delante de la mirada, como si el jugador se hubiera
// acercado. Para señalarlo alcanza con mirarlo (la mirada es el respaldo).
await page.evaluate(() => {
  window.__voices = 0;
  const snd = window.__sound;
  const voice = snd.voice.bind(snd);
  snd.voice = (...a) => {
    window.__voices++;
    return voice(...a);
  };
  const cam = window.__scene.activeCamera;
  const f = cam.getDirection(new window.__BABYLON_Vector3(0, 0, 1));
  const l = Math.hypot(f.x, f.z) || 1;
  const p = cam.globalPosition;
  const fr = window.__schoolFrame();
  const x = p.x + (f.x / l) * 1.4;
  const z = p.z + (f.z / l) * 1.4;
  // De frente al jugador: rumbo del plano hacia la cabeza (u = ox − x, v = z − oz).
  const yaw = Math.atan2(p.x - x, p.z - z);
  window.__people().character('ruben').teleport({ u: fr.ox - x, v: z - fr.oz, level: 0 }, yaw);
});
await sleep(900);
const aimed = await page.evaluate(() => ({ focus: window.__director().focus?.key ?? null, label: window.__director().panel?.labelText ?? '' }));
check('mirando a Rubén, el cartel dice «Saludar» (nadie habla)', aimed.focus === 'npc:ruben' && /Saludar/.test(aimed.label) && !/Hablar/.test(aimed.label), JSON.stringify(aimed));
await press('right', 'a-button');
await sleep(500);
const greeted = await page.evaluate(() => {
  const g = window.__director();
  return {
    portero: g.engine.done('p.portero'),
    entrada: g.engine.zone('entrada'),
    greet: g.lastGreeting,
    modal: g.modal,
    panel: Boolean(window.__scene.getMeshByName('gamePanel')?.isEnabled()),
    voices: window.__voices,
    bark: !document.getElementById('bark').classList.contains('hidden'),
    canWalk: window.__xr()?.canWalk,
  };
});
check(
  'la A sobre Rubén abre el portal sin panel con líneas ni voz',
  greeted.portero && greeted.entrada && greeted.greet?.npc === 'ruben' && greeted.modal === null && !greeted.panel && greeted.voices === 0 && !greeted.bark,
  JSON.stringify(greeted),
);
check('después de saludar se sigue caminando', greeted.canWalk === true);

const controllers = await page.evaluate(() => {
  const s = window.__scene;
  const underGrip = (m) => {
    for (let n = m.parent; n; n = n.parent) if (/-(grip|pointer)$/.test(n.name)) return true;
    return false;
  };
  return s.meshes.filter((m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0 && underGrip(m)).length;
});
check('se ven los mandos', controllers >= 2, `${controllers} mallas en los mandos`);

// ------------------------------------------------------------ menú del juego

await press('left', 'y-button');
const pause = await ui();
await sleep(500);
const pauseLater = await ui();
check('Y abre el menú del juego', pause.root === 'pause' && pause.visible && pause.title === 'Menú del juego', pause.title ?? '');
check('con el menú abierto no se camina y el reloj se detiene', pause.canWalk === false && Math.abs(pauseLater.clock - pause.clock) < 1e-6, `reloj ${fmt(pause.clock)} → ${fmt(pauseLater.clock)}`);
await shot('vr-3-menu');
await flick('right', 1, 0);
const moved = await ui();
check('el stick mueve el resaltado del menú', moved.highlight === 1 && moved.buttons[1] === 'Pasaporte 40', `${pause.highlight} → ${moved.highlight}`);
await press('right', 'a-button');
const passport = await ui();
check('la A abre lo resaltado (pasaporte)', passport.menu === 'passport', passport.title ?? '');
await shot('vr-3b-pasaporte');
await press('right', 'b-button');
const backPause = await ui();
check('B vuelve del pasaporte al menú con el mismo resaltado', backPause.menu === 'pause' && backPause.highlight === 1, `${backPause.menu} · ${backPause.highlight}`);

// Grip sobre el panel: se arrastra y queda fijo donde se lo deja.
const dragAim = await aimAt('right', 0);
const dragFrom = (await ui()).pos;
await button('right', 'squeeze', 1);
await sleep(200);
await page.evaluate(() => {
  // Gira la mano ~12° a un costado con el grip apretado.
  const c = window.__xrDevice.controllers.right;
  const a = 0.21;
  const r = [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
  const q = [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w];
  const m = [
    r[3] * q[0] + r[0] * q[3] + r[1] * q[2] - r[2] * q[1],
    r[3] * q[1] - r[0] * q[2] + r[1] * q[3] + r[2] * q[0],
    r[3] * q[2] + r[0] * q[1] - r[1] * q[0] + r[2] * q[3],
    r[3] * q[3] - r[0] * q[0] - r[1] * q[1] - r[2] * q[2],
  ];
  c.quaternion.set(...m);
});
await sleep(500);
await button('right', 'squeeze', 0);
await sleep(300);
const dragged = await ui();
const dragDist = dragFrom && dragged.pos ? Math.hypot(dragged.pos.x - dragFrom.x, dragged.pos.z - dragFrom.z) : 0;
check('el grip arrastra el panel y queda fijo', dragAim.ok && dragDist > 0.15 && dragged.pinned && dragged.menu === 'pause', `${fmt(dragDist)} m · fijo ${dragged.pinned}${dragAim.ok ? '' : ' · ' + dragAim.why}`);
// Clic del stick derecho: lo trae delante otra vez.
await press('right', 'thumbstick');
await sleep(500);
const recentered = await ui();
check('el clic del stick derecho trae el panel delante', !recentered.pinned, `fijo ${recentered.pinned}`);
await restHands();

await press('left', 'y-button');
const closed = await ui();
check('Y cierra el menú y se vuelve a caminar', !closed.visible && closed.root === null && closed.canWalk === true, JSON.stringify({ root: closed.root, canWalk: closed.canWalk }));

// "Volver al inicio" desde el menú y "Continuar" desde el inicio.
await press('left', 'y-button');
const toTitle = await triggerPick('right', 'Volver al inicio');
const confirmUi = await ui();
const toTitleYes = confirmUi.menu === 'toTitle' ? await triggerPick('right', 'Sí, volver al inicio') : { ok: false, why: confirmUi.menu };
const backAtTitle = await until(() => {
  const g = window.__game;
  return g.atTitle && g.menus?.root === 'title' && g.panel?.visible && !g.xrBusy;
}, 8000);
const titleAgain = await ui();
check(
  'el menú vuelve al inicio del visor (con Continuar)',
  toTitle.ok && toTitleYes.ok && backAtTitle && titleAgain.style === 'title' && titleAgain.buttons[0] === 'Continuar' && titleAgain.canWalk === false,
  `${toTitle.why || toTitleYes.why || ''} ${titleAgain.buttons.join(' / ')}`,
);
await restHands();
await sleep(300);
await press('right', 'a-button');
const continued = await until(() => {
  const g = window.__game;
  return g && !g.atTitle && g.modal === null && !g.xrBusy && !g.panel?.visible && window.__xr()?.canWalk === true;
}, 12000);
check('«Continuar» retoma la partida guardada', continued && (await page.evaluate(() => window.__game.engine.done('p.portero'))));

// ---------------------------------------------------------------- caminata

// Hacia un punto libre: la calle frente a la escuela.
const before = await state();
await stickToward(-Math.sin(before.yaw), -Math.cos(before.yaw)); // de espaldas a la escuela
await sleep(250);
const samples = [];
let motion = 0;
for (let i = 0; i < 6; i++) {
  await sleep(200);
  samples.push(await state());
  motion = Math.max(motion, (await page.evaluate(() => window.__xr()?.motion ?? 0)) || 0);
}
await stick('left', 0, 0);
const released = await state();
await sleep(700);
const settled = await state();
const walked = Math.hypot(released.x - before.x, released.z - before.z);
const drift = Math.hypot(settled.x - released.x, settled.z - released.z);
const sink = Math.max(...samples.map((s) => Math.abs(s.feet - (s.ground ?? 0))));
check('el stick izquierdo pide caminar (velocidad calculada)', motion > 0.5, `motion ${fmt(motion)}`);
check('el stick izquierdo camina', walked > 1, `${fmt(walked)} m en ~1,4 s`);
check('al soltar el stick no derrapa', drift < 0.25, `${fmt(drift)} m después de soltar`);
check('caminando, los pies siguen el piso', sink < 0.08, `desvío máx. ${fmt(sink, 3)} m`);
await shot('vr-4-caminata');

// Mirando hacia abajo: con el movimiento de Babylon esto hundía al jugador.
await page.evaluate(() => {
  const q = window.__xrDevice.quaternion;
  const a = -0.5; // ~57° hacia abajo, en el eje X del visor
  q.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
});
await sleep(300);
const lookDown0 = await state();
await stickToward(Math.sin(lookDown0.yaw), Math.cos(lookDown0.yaw));
const downSamples = [];
for (let i = 0; i < 5; i++) {
  await sleep(200);
  downSamples.push(await state());
}
await stick('left', 0, 0);
await page.evaluate(() => window.__xrDevice.quaternion.set(0, 0, 0, 1));
const downSink = Math.max(...downSamples.map((s) => Math.abs(s.feet - (s.ground ?? 0))));
const downWalked = Math.hypot(downSamples.at(-1).x - lookDown0.x, downSamples.at(-1).z - lookDown0.z);
check('mirando al piso camina a la misma velocidad', downWalked > 0.8, `${fmt(downWalked)} m`);
check('mirando al piso no se hunde', downSink < 0.08, `desvío máx. ${fmt(downSink, 3)} m`);
await sleep(400);

// Clic del stick izquierdo: correr.
await press('left', 'thumbstick');
await stick('left', 0, -1);
await sleep(300);
const running = await page.evaluate(() => window.__xr()?.running);
await stick('left', 0, 0);
await sleep(900);
const stopped = await page.evaluate(() => window.__xr()?.running);
check('el clic del stick izquierdo corre y se apaga al soltar', running === true && stopped === false, `${running} → ${stopped}`);

// ------------------------------------------------------------------- giro

const turn0 = await state();
await stick('right', 1, 0);
await sleep(250);
await stick('right', 0, 0);
await sleep(400);
const turn1 = await state();
let dYaw = turn1.yaw - turn0.yaw;
while (dYaw > Math.PI) dYaw -= 2 * Math.PI;
while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
const dYawDeg = (Math.abs(dYaw) * 180) / Math.PI;
check('el stick derecho gira por pasos', dYawDeg > 15 && dYawDeg < 50, `${fmt(dYawDeg, 0)}°`);

// ----------------------------------------------------------- teletransporte

// Mirando a lo largo de la calle, el arco cae sobre la vereda.
const tp0 = await state();
await stick('right', 0, -1);
await sleep(900);
const laserHidden = await page.evaluate(() => {
  const m = window.__scene.getMeshByName('xrLaser-right');
  return m ? !m.isEnabled() : null;
});
await shot('vr-5-apuntando');
await stick('right', 0, 0);
await sleep(600);
const tp1 = await state();
const jumped = Math.hypot(tp1.x - tp0.x, tp1.z - tp0.z);
if (laserHidden !== null) check('apuntando el salto se esconde el láser derecho', laserHidden);
check('el stick derecho teletransporta', jumped > 1.5, `${fmt(jumped)} m`);
check(
  'después del salto sigue parado sobre el piso',
  tp1.ground !== null && Math.abs(tp1.feet - tp1.ground) < 0.05,
  `pies ${fmt(tp1.feet)} · piso ${fmt(tp1.ground)}`,
);

// ------------------------------------------------------------------ paredes

// Busca la pared más cercana a la altura de los pies y camina contra ella.
const wall = await page.evaluate(() => {
  const cam = window.__scene.activeCamera;
  const idx = window.__index();
  const p = cam.position;
  const feet = p.y - window.__xrDevice.position.y;
  let best = null;
  for (let a = 0; a < 48; a++) {
    const ang = (a / 48) * Math.PI * 2;
    for (let d = 1; d < 25; d += 0.5) {
      const x = p.x + Math.cos(ang) * d;
      const z = p.z + Math.sin(ang) * d;
      if (idx.isSolid(x, z, feet)) {
        if (!best || d < best.d) best = { d, dx: Math.cos(ang), dz: Math.sin(ang) };
        break;
      }
    }
  }
  return best;
});
if (wall) {
  await stickToward(wall.dx, wall.dz);
  await sleep(Math.min(9000, (wall.d / 1.5) * 1000 + 2500));
  await stick('left', 0, 0);
  await sleep(300);
  const atWall = await state();
  check('no atraviesa paredes', atWall.solid === false, `pared a ${fmt(wall.d)} m`);
  await shot('vr-6-pared');
} else {
  check('no atraviesa paredes', false, 'no se encontró ninguna pared cerca');
}

// ------------------------------------------------------------ mano izquierda

// Mano izquierda delante de la cara, como quien mira el reloj.
await page.evaluate(() => {
  const head = window.__xrDevice.position;
  const left = window.__xrDevice.controllers.left;
  left.position.set(head.x - 0.08, head.y - 0.22, head.z - 0.32);
  const a = 0.6;
  left.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
});
await sleep(600);
await shot('vr-7-mano');
await restHands();

const fps = (await state()).fps;
results.push(`INFO  fps en el emulador: ${fmt(fps, 0)} (no representa al visor)`);

// ------------------------------------------------------------------- salida

// Desde el menú del juego: "Salir de VR" y su confirmación.
await press('left', 'y-button');
const exitPick = await triggerPick('right', 'Salir de VR');
const exitConfirm = (await ui()).menu === 'exit' ? await triggerPick('right', 'Sí, salir de VR') : { ok: false, why: 'sin confirmación' };
const exited = await until(() => window.__scene?.activeCamera?.getClassName() !== 'WebXRCamera', 15000);
check('salir de VR desde el menú vuelve al escritorio', exitPick.ok && exitConfirm.ok && exited, exitPick.why || exitConfirm.why || '');
await sleep(800);
const desk = await page.evaluate(() => ({
  atTitle: window.__game.atTitle,
  panel: Boolean(window.__scene.getMeshByName('gamePanel')?.isEnabled()),
  title: !document.getElementById('title').classList.contains('hidden'),
  btn: document.getElementById('btn-vr').textContent,
}));
check('en el escritorio sigue la partida, sin panel del visor', !desk.atTitle && !desk.panel && /Entrar/.test(desk.btn ?? ''), JSON.stringify(desk));

await finish();

async function finish() {
  check('sin errores en consola', errors.length === 0, errors.slice(0, 6).join(' | '));
  console.log(results.join('\n'));
  if (warnings.length) console.log(`\nAvisos:\n${warnings.slice(0, 12).join('\n')}`);
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FALL')) ? 1 : 0);
}
