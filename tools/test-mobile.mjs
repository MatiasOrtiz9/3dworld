/**
 * Prueba del modo celular (pantalla horizontal, controles táctiles).
 *
 * Emula un teléfono de verdad —844 × 390, densidad 3, pantalla táctil y el
 * agente de un Android— y juega con los dedos: los toques se mandan por el
 * protocolo de Chrome (`Input.dispatchTouchEvent`), con varios dedos a la
 * vez, igual que una pantalla táctil. No hay atajos: si el joystick no
 * mueve al jugador acá, no lo mueve en el teléfono.
 *
 *   node tools/test-mobile.mjs [url-base] [carpeta-capturas] [sw]
 *
 * Verifica: detección (modo táctil, perfil 'Móvil', escala de render, campo
 * visual), título, diálogo con toques, joystick analógico, mirar
 * deslizando, los dos pulgares a la vez, saltar, correr, tocar a una
 * persona, el botón de usar, menú y ajustes, HUD mínimo, volar, actividad
 * en dos columnas, que nada se superponga ni salga de pantalla, el aviso
 * de girar el teléfono, tope de cuadros y la consola limpia. Al final,
 * que el escritorio NO entra en modo táctil.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const base = process.argv[2] ?? 'http://localhost:5190/';
const shotDir = process.argv[3] ?? 'shots/mobile';
const gpu = process.argv[4] !== 'sw';
mkdirSync(shotDir, { recursive: true });

const PHONE = { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true };
const PORTRAIT = { ...PHONE, width: 390, height: 844, isLandscape: false };
const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: gpu
    ? ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FALL'}  ${name}${extra ? '  — ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let k = 0;
        const tick = () => (++k >= n ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
const visible = (page, sel) =>
  page.$eval(sel, (el) => {
    const s = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return !el.hidden && !el.classList.contains('hidden') && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && r.width > 0;
  });
const box = (page, sel) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

// ------------------------------------------------------------------ dedos (CDP)
function fingers(cdp) {
  const down = new Map();
  const send = (type) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...down.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 6, radiusY: 6, force: 1 })),
    });
  return {
    async start(id, x, y) {
      down.set(id, { x, y });
      await send('touchStart');
    },
    async move(id, x, y) {
      down.set(id, { x, y });
      await send('touchMove');
    },
    async end(id) {
      const p = down.get(id);
      down.delete(id);
      // touchEnd lleva los dedos que SIGUEN apoyados; el que se levanta es el que falta.
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [...down.entries()].map(([k, q]) => ({ x: q.x, y: q.y, id: k })),
      });
      return p;
    },
    async tap(x, y, id = 9) {
      await this.start(id, x, y);
      await sleep(60);
      await this.end(id);
    },
    /** Arrastre en pasos (como un dedo de verdad, no un salto). */
    async drag(id, x0, y0, x1, y1, steps = 8, page = null) {
      await this.start(id, x0, y0);
      for (let i = 1; i <= steps; i++) {
        await this.move(id, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        if (page) await frames(page, 1);
      }
    },
  };
}

async function open(query, viewport, tag) {
  const page = await browser.newPage();
  await page.emulate({ viewport, userAgent: UA });
  page.on('pageerror', (e) => errors.push(`[${tag}] [pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${tag}] [console.error] ${m.text()}`);
  });
  const url = base + (base.includes('?') ? '&' : '?') + query;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
    timeout: 240000,
    polling: 200,
  });
  await sleep(1200);
  return page;
}

/**
 * ¿El tope vigente es el pedido, ajustado a un divisor exacto de la pantalla?
 * (60 jugando en 60 o 120 Hz, 45 en 90 Hz; ver evenCap en src/ui/device.ts.)
 */
const capIs = (page, wanted) =>
  page.evaluate((wanted) => {
    const hz = window.__refreshHz();
    const want = hz / Math.max(1, Math.round(hz / wanted));
    const got = window.__scene.getEngine().maxFPS;
    return { ok: Math.abs(got - want) < 0.01, text: `${got} (pantalla ${hz} Hz, pedido ${wanted})` };
  }, wanted);

const cam = (page) =>
  page.evaluate(() => {
    const c = window.__scene.activeCamera;
    return { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.rotation.y, pitch: c.rotation.x, fov: c.fov };
  });

/** Ninguna pieza fija del HUD se sale de la pantalla ni pisa a otra. */
async function layoutProblems(page, sels) {
  return page.evaluate((sels) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const boxes = [];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (el.hidden || st.display === 'none' || r.width === 0) continue;
      boxes.push({ s, l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    const out = [];
    for (const a of boxes) {
      if (a.l < -1 || a.t < -1 || a.r > W + 1 || a.b > H + 1) out.push(`${a.s} fuera de pantalla (${a.l | 0},${a.t | 0},${a.r | 0},${a.b | 0})`);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ix = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const iy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ix > 2 && iy > 2) out.push(`${a.s} pisa a ${b.s}`);
      }
    return out;
  }, sels);
}

// ======================================================================= celular
{
  const page = await open('seed=42&titulo=1&libre=0&hud=1', PHONE, 'celular');
  const cdp = await page.createCDPSession();
  const touch = fingers(cdp);

  // --- detección y perfil ---
  const det = await page.evaluate(() => ({
    touch: document.documentElement.classList.contains('touch'),
    device: window.__device,
    tier: window.__quality.current,
    scaling: window.__scene.getEngine().getHardwareScalingLevel(),
    render: [window.__scene.getEngine().getRenderWidth(), window.__scene.getEngine().getRenderHeight()],
    maxFPS: window.__scene.getEngine().maxFPS,
    fov: window.__scene.activeCamera.fov,
    touchInputs: Object.keys(window.__scene.activeCamera.inputs.attached),
  }));
  check('detecta el celular (modo táctil)', det.touch, JSON.stringify(det.device));
  check("perfil de calidad 'Móvil'", det.tier === 'mobile', det.tier);
  check('render por encima de la resolución CSS y por debajo del techo', det.render[0] >= 844 && det.render[0] * det.render[1] <= 1.05e6, `${det.render.join('×')} (escala ${det.scaling.toFixed(3)})`);
  check('campo visual ajustado a 19,5:9 (< 56°)', det.fov < 0.98 && det.fov > 0.78, `${((det.fov * 180) / Math.PI).toFixed(1)}°`);
  check('sin la entrada táctil propia de Babylon (caminaba sin colisión)', !det.touchInputs.includes('touch'), det.touchInputs.join(','));

  // --- título ---
  check('pantalla de título', await visible(page, '#title'));
  const titleProblems = await layoutProblems(page, ['#title .brand', '#title .tag', '#title .menu-buttons', '#title .fine']);
  check('el título entra en la pantalla horizontal', titleProblems.length === 0, titleProblems.join('; '));
  await sleep(2500); // la frecuencia de la pantalla se mide al terminar de cargar
  const capTitle = await capIs(page, 30);
  check('título a 30 cuadros (ahorro)', capTitle.ok, capTitle.text);
  await page.screenshot({ path: `${shotDir}/m1-titulo.png` });

  const start = await box(page, '#title-start');
  await touch.tap(start.cx, start.cy);
  await sleep(2500);
  check('tocar "Nueva partida" empieza', !(await visible(page, '#title')));

  // --- diálogo del prólogo: se avanza tocando la pantalla ---
  let dialogShot = false;
  for (let i = 0; i < 14 && (await visible(page, '#dialogue')); i++) {
    if (!dialogShot) {
      await sleep(700);
      await page.screenshot({ path: `${shotDir}/m2-dialogo.png` });
      const dp = await layoutProblems(page, ['#dialogue']);
      check('el diálogo entra en pantalla', dp.length === 0, dp.join('; '));
      dialogShot = true;
    }
    const choices = await page.$$('#dlg-choices .choice');
    if (choices.length) {
      const c = await box(page, '#dlg-choices .choice');
      await touch.tap(c.cx, c.cy);
    } else {
      await touch.tap(420, 120);
    }
    await sleep(450);
  }
  check('tocar la pantalla avanza y cierra el diálogo', !(await visible(page, '#dialogue')));
  await sleep(600);

  // --- controles a la vista ---
  for (const sel of ['#t-use', '#t-jump', '#t-run', '#t-menu', '#t-hud', '#stick-move']) {
    check(`control visible: ${sel}`, await visible(page, sel));
  }
  check('los botones de PC no aparecen', !(await visible(page, '#quick')));
  const hudProblems = await layoutProblems(page, ['#objective', '#mapbox', '#t-top', '#t-actions', '#stick-move']);
  check('HUD y controles sin superponerse ni salirse', hudProblems.length === 0, hudProblems.join('; '));
  const capPlay = await capIs(page, 60);
  check('juego a ~60 cuadros parejos (tope para pantallas de 90/120 Hz)', capPlay.ok, capPlay.text);
  await page.screenshot({ path: `${shotDir}/m3-jugando.png` });

  // Lugar despejado para las pruebas de movimiento: vereda de Laprida mirando a lo largo.
  const placeOpen = () =>
    page.evaluate(() => {
      const f = window.__schoolFrame();
      // En la calle Laprida, mirando a lo largo: nada contra qué chocar.
      const toW = (u, v) => ({ x: f.ox - u, z: f.oz + v });
      const a = toW(20, 8);
      const b = toW(60, 8);
      window.__player.teleport({ x: a.x, y: 0, z: a.z }, { x: b.x, y: 1.6, z: b.z });
    });
  const hasFrame = await page.evaluate(() => Number.isFinite(window.__schoolFrame()?.ox));
  if (hasFrame) await placeOpen();
  await frames(page, 10);

  // --- joystick izquierdo: caminar ---
  const p0 = await cam(page);
  await touch.drag(1, 140, 300, 140, 220, 6, page);
  const held = await page.evaluate(() => ({ x: window.__input.x, y: window.__input.y }));
  await frames(page, 30);
  const p1 = await cam(page);
  await touch.end(1);
  await frames(page, 4);
  const released = await page.evaluate(() => ({ x: window.__input.x, y: window.__input.y }));
  const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const fwd = { x: Math.sin(p0.yaw), z: Math.cos(p0.yaw) };
  const along = ((p1.x - p0.x) * fwd.x + (p1.z - p0.z) * fwd.z) / Math.max(1e-6, walked);
  check('el joystick da avance pleno hacia arriba', held.y > 0.9 && Math.abs(held.x) < 0.05, JSON.stringify(held));
  check('el joystick camina hacia donde se mira', walked > 0.8 && along > 0.9, `${walked.toFixed(2)} m, alineación ${along.toFixed(2)}`);
  check('al soltar, se frena', released.x === 0 && released.y === 0);
  await page.screenshot({ path: `${shotDir}/m4-joystick.png` });

  // --- analógico: medio recorrido, medio paso ---
  if (hasFrame) await placeOpen();
  await frames(page, 6);
  const a0 = await cam(page);
  await touch.drag(1, 140, 300, 140, 270, 4, page);
  const half = await page.evaluate(() => window.__input.y);
  await frames(page, 30);
  const a1 = await cam(page);
  await touch.end(1);
  const halfWalk = Math.hypot(a1.x - a0.x, a1.z - a0.z);
  check('el joystick es analógico (medio recorrido, más lento)', half > 0.2 && half < 0.75 && halfWalk < walked * 0.85, `y=${half.toFixed(2)} → ${halfWalk.toFixed(2)} m vs ${walked.toFixed(2)} m`);

  // --- mirar deslizando ---
  const l0 = await cam(page);
  await touch.drag(2, 560, 200, 700, 160, 10, page);
  await touch.end(2);
  const l1 = await cam(page);
  check('deslizar a la derecha gira a la derecha', l1.yaw - l0.yaw > 0.2, `Δyaw ${(l1.yaw - l0.yaw).toFixed(2)} rad`);
  check('deslizar hacia arriba mira hacia arriba', l1.pitch < l0.pitch, `Δpitch ${(l1.pitch - l0.pitch).toFixed(2)} rad`);

  // --- dos pulgares a la vez ---
  if (hasFrame) await placeOpen();
  await frames(page, 6);
  const b0 = await cam(page);
  await touch.start(1, 140, 300);
  await touch.start(2, 600, 220);
  for (let i = 1; i <= 8; i++) {
    await touch.move(1, 140, 300 - i * 10);
    await touch.move(2, 600 - i * 6, 220);
    await frames(page, 2);
  }
  await frames(page, 15);
  const b1 = await cam(page);
  await touch.end(2);
  await touch.end(1);
  check('caminar y mirar a la vez (multitáctil)', Math.hypot(b1.x - b0.x, b1.z - b0.z) > 0.4 && b0.yaw - b1.yaw > 0.05, `${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(2)} m, Δyaw ${(b1.yaw - b0.yaw).toFixed(2)}`);

  // --- saltar ---
  await frames(page, 20);
  const j = await box(page, '#t-jump');
  const y0 = (await cam(page)).y;
  await touch.tap(j.cx, j.cy);
  let peak = y0;
  for (let i = 0; i < 14; i++) {
    await frames(page, 2);
    peak = Math.max(peak, (await cam(page)).y);
  }
  check('el botón salta', peak - y0 > 0.3, `+${(peak - y0).toFixed(2)} m`);
  await frames(page, 40);

  // --- correr ---
  if (hasFrame) await placeOpen();
  await frames(page, 6);
  const r = await box(page, '#t-run');
  await touch.tap(r.cx, r.cy);
  const runOn = await page.$eval('#t-run', (el) => el.classList.contains('on'));
  const r0 = await cam(page);
  await touch.drag(1, 140, 300, 140, 220, 6, page);
  const runFlag = await page.evaluate(() => window.__input.run);
  await frames(page, 30);
  const r1 = await cam(page);
  await touch.end(1);
  const ran = Math.hypot(r1.x - r0.x, r1.z - r0.z);
  check('correr queda puesto y es más rápido', runOn && runFlag && ran > walked * 1.3, `${ran.toFixed(2)} m vs ${walked.toFixed(2)} m caminando`);
  await frames(page, 70);
  check('correr se apaga solo al quedarse quieto', !(await page.$eval('#t-run', (el) => el.classList.contains('on'))));

  // --- tocar a una persona: ponerla en cuadro, a un costado, y tocarla ---
  const target = await page.evaluate(() => {
    const g = window.__game;
    const npcs = (g.candidates ?? []).filter((c) => c.key.startsWith('npc:'));
    if (!npcs.length) return null;
    const c = npcs[0];
    // Parado a 1,8 m, mirando un poco al costado de la persona.
    const ang = 0.9;
    const px = c.x + Math.sin(ang) * 1.8;
    const pz = c.z + Math.cos(ang) * 1.8;
    const side = { x: c.x + Math.cos(ang) * 0.5, y: c.baseY + 1.5, z: c.z - Math.sin(ang) * 0.5 };
    window.__player.teleport({ x: px, y: c.baseY, z: pz }, side);
    return { key: c.key, x: c.x, y: c.baseY + 1.1, z: c.z };
  });
  if (target) {
    await frames(page, 12);
    const scr = await page.evaluate((t) => {
      const c = window.__scene.activeCamera;
      const V = window.__BABYLON_Vector3;
      const m = c.getViewMatrix().multiply(c.getProjectionMatrix());
      const v = V.TransformCoordinates(new V(t.x, t.y, t.z), m);
      return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
    }, target);
    await touch.tap(scr.x, scr.y);
    await sleep(500);
    const reacted = (await visible(page, '#dialogue')) || (await visible(page, '#bark'));
    check('tocar a una persona le habla', reacted, `${target.key} en (${scr.x | 0}, ${scr.y | 0})`);
    await page.screenshot({ path: `${shotDir}/m5-tocar-persona.png` });
    for (let i = 0; i < 14 && (await visible(page, '#dialogue')); i++) {
      const choices = await page.$$('#dlg-choices .choice');
      if (choices.length) {
        const c = await box(page, '#dlg-choices .choice');
        await touch.tap(c.cx, c.cy);
      } else await touch.tap(420, 120);
      await sleep(450);
    }
    await sleep(400);

    // --- botón de usar: mirando a la persona se enciende y dice el verbo ---
    await page.evaluate((t) => {
      const f = { x: t.x + 1.6, z: t.z };
      window.__player.teleport({ x: f.x, y: t.y - 1.1, z: f.z }, { x: t.x, y: t.y + 0.4, z: t.z });
    }, target);
    await frames(page, 15);
    const ready = await page.$eval('#t-use', (el) => ({ on: el.classList.contains('ready'), label: el.textContent.trim() }));
    check('el botón de usar se enciende con algo a mano', ready.on, ready.label);
    if (ready.on) {
      const u = await box(page, '#t-use');
      await touch.tap(u.cx, u.cy);
      await sleep(500);
      check('el botón de usar interactúa', (await visible(page, '#dialogue')) || (await visible(page, '#bark')));
      for (let i = 0; i < 14 && (await visible(page, '#dialogue')); i++) {
        const choices = await page.$$('#dlg-choices .choice');
        if (choices.length) {
          const c = await box(page, '#dlg-choices .choice');
          await touch.tap(c.cx, c.cy);
        } else await touch.tap(420, 120);
        await sleep(450);
      }

      // --- el aviso deja pasar el dedo (joystick), pero un toque encima usa ---
      await sleep(5200);
      await frames(page, 10);
      if (await visible(page, '#prompt')) {
        const pe = await page.$eval('#prompt', (el) => window.getComputedStyle(el).pointerEvents);
        const pick0 = await page.evaluate(() => window.__game.lastPick);
        const pr = await box(page, '#prompt');
        await touch.tap(pr.cx, pr.cy);
        await sleep(400);
        const pick1 = await page.evaluate(() => window.__game.lastPick);
        check('tocar el aviso de interacción usa (sin atrapar al pulgar)', pe === 'none' && pick1 > pick0, `pointer-events ${pe}`);
        for (let i = 0; i < 14 && (await visible(page, '#dialogue')); i++) {
          const choices = await page.$$('#dlg-choices .choice');
          if (choices.length) {
            const c = await box(page, '#dlg-choices .choice');
            await touch.tap(c.cx, c.cy);
          } else await touch.tap(420, 120);
          await sleep(450);
        }
      }
    }
  } else {
    check('hay personas para tocar', false);
  }

  // --- HUD mínimo ---
  const eye = await box(page, '#t-hud');
  await touch.tap(eye.cx, eye.cy);
  await sleep(200);
  const minimal = !(await visible(page, '#objective')) && !(await visible(page, '#mapbox'));
  await page.screenshot({ path: `${shotDir}/m6-hud-minimo.png` });
  await touch.tap(eye.cx, eye.cy);
  await sleep(200);
  check('el ojo oculta y vuelve a mostrar objetivo y mapa', minimal && (await visible(page, '#objective')));

  // --- objetivo plegable ---
  const ob = await box(page, '#objective');
  await touch.tap(ob.cx, ob.y + 10);
  await sleep(150);
  const folded = await page.$eval('#objective', (el) => el.classList.contains('collapsed'));
  await touch.tap(ob.cx, ob.y + 10);
  check('el objetivo se pliega con un toque', folded);

  // --- menú y ajustes ---
  const menu = await box(page, '#t-menu');
  await touch.tap(menu.cx, menu.cy);
  await sleep(400);
  check('≡ abre el menú', await visible(page, '#pause'));
  const pauseProblems = await layoutProblems(page, ['#pause .sheet']);
  check('el menú entra en pantalla', pauseProblems.length === 0, pauseProblems.join('; '));
  const capMenu = await capIs(page, 30);
  check('menú a 30 cuadros', capMenu.ok, capMenu.text);
  const tab = await box(page, '#pause .tab[data-tab="ajustes"]');
  await touch.tap(tab.cx, tab.cy);
  await sleep(300);
  check('ajustes del celular a la vista', await visible(page, '#t-sens'));
  await page.screenshot({ path: `${shotDir}/m7-ajustes.png` });
  // El panel se desplaza: los ajustes del celular quedan abajo.
  await page.$eval('#btn-battery', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await page.screenshot({ path: `${shotDir}/m7b-ajustes-celular.png` });
  const bat = await box(page, '#btn-battery');
  await touch.tap(bat.cx, bat.cy);
  await sleep(100);
  const resume = await box(page, '#pause .tab[data-tab="juego"]');
  await touch.tap(resume.cx, resume.cy);
  await sleep(200);
  const res = await box(page, '#pause-resume');
  await touch.tap(res.cx, res.cy);
  await sleep(400);
  check('"Seguir jugando" cierra el menú', !(await visible(page, '#pause')));
  await frames(page, 4);
  const capSave = await capIs(page, 30);
  check('ahorro de batería: 30 cuadros jugando', capSave.ok, capSave.text);
  await page.evaluate(() => document.getElementById('btn-battery').click());
  await frames(page, 4);
  check('sin ahorro: vuelve a 60', (await capIs(page, 60)).ok);

  // --- mirar con joystick (opción de Ajustes) ---
  await page.evaluate(() => document.getElementById('btn-look-mode').click());
  await frames(page, 3);
  check('modo joystick de cámara: aparece el segundo stick', await visible(page, '#stick-look'));
  const s0 = await cam(page);
  await touch.drag(3, 600, 250, 660, 250, 4, page);
  await frames(page, 20);
  const s1 = await cam(page);
  await frames(page, 20);
  const s2 = await cam(page);
  await touch.end(3);
  await page.screenshot({ path: `${shotDir}/m7c-dos-sticks.png` });
  check('el stick de cámara gira mientras se sostiene', s1.yaw - s0.yaw > 0.1 && s2.yaw - s1.yaw > 0.1, `${(s1.yaw - s0.yaw).toFixed(2)}, ${(s2.yaw - s1.yaw).toFixed(2)} rad`);
  await page.evaluate(() => document.getElementById('btn-look-mode').click());
  await frames(page, 3);

  // --- volar: subir y bajar ---
  await page.evaluate(() => document.getElementById('btn-mode').click());
  await sleep(200);
  check('volando aparecen subir y bajar', (await visible(page, '#t-up')) && (await visible(page, '#t-down')) && !(await visible(page, '#t-jump')));
  const up = await box(page, '#t-up');
  const f0 = (await cam(page)).y;
  await touch.start(5, up.cx, up.cy);
  await frames(page, 25);
  await touch.end(5);
  const f1 = (await cam(page)).y;
  check('mantener "subir" sube', f1 - f0 > 1, `+${(f1 - f0).toFixed(2)} m`);
  await page.evaluate(() => document.getElementById('btn-mode').click());
  await sleep(300);

  // --- actividad: dos columnas, entra en pantalla ---
  await page.evaluate(() => {
    const hud = window.__game.hud;
    hud.showActivity(
      {
        kicker: 'Actividad · Robot Educabot',
        title: 'Programá la ruta del robot',
        text: 'Armá la secuencia de pasos para llevar al robot hasta la bandera sin chocar con los bloques.',
        progress: 'Nivel 1 de 3',
        choices: [
          { label: 'Avanzar', icon: 'up' },
          { label: 'Girar izq.', icon: 'left' },
          { label: 'Girar der.', icon: 'right' },
          { label: 'Borrar', icon: 'undo', tone: 'ghost' },
          { label: 'Ejecutar', icon: 'play', tone: 'accent' },
          { label: 'Salir', icon: 'close', tone: 'ghost', exit: true },
        ],
        grid: { cols: 6, rows: 6, blocks: [[2, 2], [3, 4]], goal: [5, 0], start: [0, 5], robot: { x: 0, y: 5, dir: 0 }, trail: [], crashed: false },
        sequence: [{ label: 'Avanzar', icon: 'up', state: 'idle' }, { label: 'Girar', icon: 'right', state: 'idle' }],
      },
      () => {},
    );
  });
  await sleep(300);
  const actProblems = await layoutProblems(page, ['#activity']);
  const actFits = await page.$eval('#activity', (el) => el.scrollHeight <= el.clientHeight + 2);
  check('la actividad entra en pantalla', actProblems.length === 0, actProblems.join('; '));
  check('la actividad no necesita desplazarse', actFits);
  check('con un panel abierto se esconden los controles', !(await visible(page, '#t-actions')) && !(await visible(page, '#stick-move')));
  await page.screenshot({ path: `${shotDir}/m8-actividad.png` });
  await page.evaluate(() => window.__game.hud.hideActivity());
  await frames(page, 4);
  check('al cerrar el panel vuelven los controles', await visible(page, '#t-actions'));

  // --- teléfono vertical ---
  await page.setViewport(PORTRAIT);
  await sleep(500);
  await frames(page, 3);
  check('vertical: aviso de girar el teléfono', await visible(page, '#rotate'));
  const capPortrait = await capIs(page, 10);
  check('vertical: 10 cuadros (la escena está tapada)', capPortrait.ok, capPortrait.text);
  await page.screenshot({ path: `${shotDir}/m9-vertical.png` });
  await page.setViewport(PHONE);
  await sleep(500);
  await frames(page, 3);
  check('horizontal otra vez: sin aviso y a 60', !(await visible(page, '#rotate')) && (await capIs(page, 60)).ok);

  // --- rendimiento informado ---
  await frames(page, 60);
  const perf = await page.evaluate(() => {
    const e = window.__scene.getEngine();
    return { fps: e.getFps(), level: window.__quality.adaptiveLevel, render: [e.getRenderWidth(), e.getRenderHeight()] };
  });
  check('rendimiento (informativo)', true, `${perf.fps.toFixed(0)} fps · adaptativo ${perf.level} · ${perf.render.join('×')}`);
  await page.close();
}

// ============================================================ celular de entrada
{
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
  });
  await page.emulate({ viewport: PHONE, userAgent: UA });
  page.on('pageerror', (e) => errors.push(`[entrada] [pageerror] ${e.message}`));
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'seed=42', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 240000, polling: 200 });
  const weak = await page.evaluate(() => ({
    cls: window.__device.cls,
    scale: window.__device.renderScale,
    level: window.__quality.adaptiveLevel,
    render: [window.__scene.getEngine().getRenderWidth(), window.__scene.getEngine().getRenderHeight()],
  }));
  check('celular de entrada: menos resolución y un escalón abajo de entrada', weak.cls === 'weak' && weak.scale <= 0.9 && weak.level >= 1, JSON.stringify(weak));
  await page.close();
}

// ================================================================= escritorio
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 800 });
  page.on('pageerror', (e) => errors.push(`[escritorio] [pageerror] ${e.message}`));
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'seed=42', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 240000, polling: 200 });
  const desk = await page.evaluate(() => ({
    touch: document.documentElement.classList.contains('touch'),
    ui: !document.getElementById('touch-ui').hidden,
    tier: window.__quality.current,
    maxFPS: window.__scene.getEngine().maxFPS ?? null,
    fov: window.__scene.activeCamera.fov,
  }));
  check('escritorio: sin modo táctil ni controles', !desk.touch && !desk.ui, JSON.stringify(desk));
  check("escritorio: perfil de siempre, sin tope ni cambio de campo visual", desk.tier !== 'mobile' && desk.maxFPS === null && Math.abs(desk.fov - 0.98) < 1e-6);
  await page.close();
}

console.log('=== CELULAR (horizontal) ===');
for (const r of results) console.log('  ' + r);
console.log('');
console.log(`=== ERRORES DE CONSOLA (${errors.length}) ===`);
console.log(errors.slice(0, 12).join('\n') || '  (ninguno)');

await browser.close();
process.exit(results.some((r) => r.startsWith('FALL')) || errors.length ? 1 : 0);
