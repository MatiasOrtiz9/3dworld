/**
 * Capturas de TODOS los paneles del visor, con un Meta Quest 3 emulado.
 *
 * Para revisar el estilo de los paneles (VISOR 40) sin ponerse el casco:
 * entra en VR igual que `test-vr.mjs` (IWER + puppeteer), abre cada panel
 * por el camino más corto (los métodos del director en `window.__game`) y
 * guarda dos imágenes por caso:
 *
 *  - `<caso>.png`: la vista del visor recortada alrededor del panel. Antes de
 *    sacarla, la cabeza emulada se acerca al panel para que ocupe la imagen
 *    (la cámara del emulador sigue la pose del visor; ver HANDOFF 62).
 *  - `<caso>-lienzo.png`: el lienzo tal cual se sube a la textura (los
 *    píxeles exactos que se ven en el visor, sin perspectiva).
 *
 * Casos: inicio (sin progreso y con Continuar), confirmación de nueva
 * partida, confort, controles, salir (desde el inicio), menú del juego,
 * pasaporte, confirmación de volver al inicio, un botón resaltado y otro
 * apretado, un diálogo con opciones, dos actividades (robot y trivia con su
 * devolución), una ficha, los créditos, el cartel de lo apuntado, cuatro
 * avisos, la muñeca y los rótulos de los mandos.
 *
 *   node tools/vr-panels-shots.mjs [url] [carpeta] [--sw]
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const baseUrl = positional[0] ?? 'http://localhost:5190/?seed=42';
const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'titulo=1&libre=0&hud=1';
const shotDir = positional[1] ?? 'shots/panels';
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
const VIEW = { width: 1600, height: 800 };
await page.setViewport(VIEW);

const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error] ${m.text().slice(0, 300)}`);
});

await page.evaluateOnNewDocument(IWER);
await page.evaluateOnNewDocument(() => {
  const device = new window.IWER.XRDevice(window.IWER.metaQuest3);
  device.installRuntime({ forceInstall: true });
  window.__xrDevice = device;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (s) => {
  log.push(s);
  console.log(s);
};
const until = (fn, timeout = 10000, ...args) =>
  page
    .waitForFunction(fn, { timeout, polling: 100 }, ...args)
    .then(() => true)
    .catch(() => false);

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 240000, polling: 200 });
await page.waitForFunction(
  () => {
    const b = document.getElementById('btn-vr');
    return b && !b.disabled && /Entrar/.test(b.textContent ?? '');
  },
  { timeout: 60000, polling: 200 },
);
const titleVr = await page.$eval('#title-vr', (b) => !b.hidden && b.offsetParent !== null).catch(() => false);
await page.click(titleVr ? '#title-vr' : '#btn-vr');
if (!(await until(() => window.__scene?.activeCamera?.getClassName() === 'WebXRCamera', 120000))) {
  note('FALL  no entró en VR');
  await done();
}
await sleep(2500);

// ------------------------------------------------------------- utilidades

const button = (hand, b, v) => page.evaluate((h, id, val) => window.__xrDevice.controllers[h].updateButtonValue(id, val), hand, b, v);
const press = async (hand, b, hold = 150) => {
  await button(hand, b, 1);
  await sleep(hold);
  await button(hand, b, 0);
  await sleep(450);
};

const headPose = await page.evaluate(() => {
  const p = window.__xrDevice.position;
  return [p.x, p.y, p.z];
});
/**
 * Cabeza en su lugar y los mandos bajos, a los costados, apuntando al piso:
 * un láser sobre el panel movería el resaltado, y la muñeca o los rótulos
 * (que se dibujan encima de todo) taparían el panel en la captura.
 */
const rest = () =>
  page.evaluate(
    (head) => {
      window.__xrDevice.position.set(...head);
      window.__xrDevice.quaternion.set(0, 0, 0, 1);
      const s = Math.SQRT1_2;
      for (const h of ['left', 'right']) {
        const c = window.__xrDevice.controllers[h];
        c.position.set(head[0] + (h === 'left' ? -0.35 : 0.35), head[1] - 0.75, head[2] + 0.05);
        c.quaternion.set(-s, 0, 0, s);
      }
    },
    headPose,
  );

/**
 * Acerca la malla a la cámara hasta `dist` metros (sobre la línea que las
 * une, así queda de frente igual). Se mueve la malla y no la cabeza: la
 * cámara del emulador vuelve a su pose en cada cuadro (HANDOFF 62). El
 * aviso guarda su alto aparte (`toastY`): se corre también.
 */
const approach = (meshName, dist) =>
  page.evaluate(
    (name, D) => {
      const s = window.__scene;
      const mesh = s.getMeshByName(name);
      const cam = s.activeCamera;
      if (!mesh || !cam) return false;
      const e = cam.globalPosition;
      const p = mesh.position;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dz = p.z - e.z;
      const L = Math.hypot(dx, dy, dz);
      if (L <= D) return true;
      const k = D / L;
      p.set(e.x + dx * k, e.y + dy * k, e.z + dz * k);
      if (name === 'gameToast') window.__game.panel.toastY = p.y;
      return true;
    },
    meshName,
    dist,
  );

/** Rectángulo en pantalla (px CSS) de un grupo de mallas, con margen. */
const screenRect = (names, pad = 28) =>
  page.evaluate(
    (list, PAD) => {
      const s = window.__scene;
      const cam = s.activeCamera;
      // La vista desde el centro de la cabeza (la cámara XR) con la
      // proyección de un ojo: con la vista del ojo izquierdo, lo que está
      // cerca (el aviso, el cartel) quedaba corrido unos centímetros.
      const rig = cam.rigCameras && cam.rigCameras.length ? cam.rigCameras[0] : cam;
      const V = window.__BABYLON_Vector3;
      const m = cam.getViewMatrix().multiply(rig.getProjectionMatrix());
      const vp = rig.viewport;
      const rect = s.getEngine().getRenderingCanvas().getBoundingClientRect();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const name of list) {
        const mesh = s.getMeshByName(name);
        if (!mesh || !mesh.isEnabled()) continue;
        mesh.computeWorldMatrix(true);
        for (const p of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
          const q = V.TransformCoordinates(p, m);
          const px = ((q.x + 1) / 2) * vp.width + vp.x;
          const py = ((1 - q.y) / 2) * vp.height + (1 - vp.y - vp.height);
          x0 = Math.min(x0, rect.left + px * rect.width);
          x1 = Math.max(x1, rect.left + px * rect.width);
          y0 = Math.min(y0, rect.top + py * rect.height);
          y1 = Math.max(y1, rect.top + py * rect.height);
        }
      }
      if (!Number.isFinite(x0)) return null;
      return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + 2 * PAD, h: y1 - y0 + 2 * PAD };
    },
    names,
    pad,
  );

/** El lienzo de una malla (lo que se sube a su textura), recortado al contenido del panel. */
const canvasOf = (meshName) =>
  page.evaluate((name) => {
    const s = window.__scene;
    const mesh = s.getMeshByName(name);
    const tex = mesh?.material?.emissiveTexture ?? mesh?.material?.opacityTexture;
    if (!tex?.getContext) return null;
    const src = tex.getContext().canvas;
    let h = src.height;
    if (name === 'gamePanel') h = window.__game.panel.contentH;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = h;
    const ctx = out.getContext('2d');
    // Fondo a cuadros oscuro: se ve qué es transparente y qué no.
    ctx.fillStyle = '#1d2a2f';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, src.width, h, 0, 0, src.width, h);
    return out.toDataURL('image/png').split(',')[1];
  }, meshName);

const files = [];
/**
 * Saca el caso: acerca la cabeza (si `dist`), espera a que termine la
 * aparición, recorta la vista alrededor de las mallas y guarda el lienzo.
 */
const capture = async (name, meshes, opts = {}) => {
  const list = Array.isArray(meshes) ? meshes : [meshes];
  if (opts.dist) {
    await approach(list[0], opts.dist);
    await sleep(350);
  } else {
    await sleep(opts.wait ?? 450);
  }
  const r = await screenRect(list, opts.pad ?? 28);
  const path = `${shotDir}/${name}.png`;
  if (r) {
    const x = Math.max(0, Math.floor(r.x));
    const y = Math.max(0, Math.floor(r.y));
    const w = Math.min(VIEW.width - x, Math.ceil(r.w));
    const h = Math.min(VIEW.height - y, Math.ceil(r.h));
    if (w > 20 && h > 20) await page.screenshot({ path, clip: { x, y, width: w, height: h } });
    else await page.screenshot({ path });
  } else {
    await page.screenshot({ path });
  }
  files.push(path);
  if (opts.canvas !== false) {
    for (const m of opts.canvasOf ?? [list[0]]) {
      const b64 = await canvasOf(m);
      if (b64) {
        const p = `${shotDir}/${name}${opts.canvasOf ? '-' + m : ''}-lienzo.png`;
        writeFileSync(p, Buffer.from(b64, 'base64'));
        files.push(p);
      }
    }
  }
  const info = await page.evaluate(() => {
    const p = window.__game.panel;
    if (!p?.visible) return null;
    const bottom = Math.max(0, ...p.btns.map((b) => b.y + b.h));
    return { kind: p.kind, h: p.contentH, bottom };
  });
  if (info && list[0] === 'gamePanel') note(`OK    ${name}: ${info.kind}, alto ${info.h} px (≤ 1024), botones hasta ${Math.round(info.bottom)}`);
  else note(`OK    ${name}`);
  await rest();
  await sleep(150);
};

/** Muestra una pantalla de la pila de menús (método privado de XRMenus, accesible en JS). */
const pushMenu = (id, from) => page.evaluate((i, f) => window.__game.menus.push(i, f), id, from);
const menuBack = () => page.evaluate(() => window.__game.menus.back());

// ------------------------------------------------------------------ inicio

await rest();
await sleep(300);
// Con el inicio se ven los rótulos de los mandos: los mandos delante, a la altura del pecho.
await page.evaluate(() => {
  const head = window.__xrDevice.position;
  const L = window.__xrDevice.controllers.left;
  const R = window.__xrDevice.controllers.right;
  L.position.set(head.x - 0.2, head.y - 0.32, head.z - 0.42);
  R.position.set(head.x + 0.2, head.y - 0.32, head.z - 0.42);
  const s = Math.SQRT1_2;
  L.quaternion.set(-s, 0, 0, s);
  R.quaternion.set(-s, 0, 0, s);
});
await sleep(500);
await capture('20-rotulos-mandos', ['xrHint-left', 'xrHint-right'], { canvasOf: ['xrHint-left', 'xrHint-right'], wait: 300, pad: 16 });

await capture('01-inicio', 'gamePanel', { dist: 1.0 });

// Con partida para seguir: "Continuar" arriba (cinco botones).
await page.evaluate(() => {
  window.__game.xrTitleInPlace = true;
  window.__game.menus.openRoot('title');
});
await sleep(400);
await capture('02-inicio-continuar', 'gamePanel', { dist: 1.0 });

await pushMenu('newConfirm', 1);
await capture('03-confirmar-nueva-partida', 'gamePanel', { dist: 0.58 });
await menuBack();
await pushMenu('comfort', 2);
await capture('04-confort', 'gamePanel', { dist: 0.58 });
await menuBack();
await pushMenu('controls', 3);
await capture('05-controles', 'gamePanel', { dist: 0.58 });
await menuBack();
await pushMenu('exit', 4);
await capture('06-confirmar-salir', 'gamePanel', { dist: 0.58 });
await menuBack();

// Arranca la partida (la A con "Nueva partida" resaltada).
await page.evaluate(() => {
  window.__game.xrTitleInPlace = false;
  window.__game.menus.openRoot('title');
});
await sleep(500);
await page.evaluate(() => {
  const p = window.__game.panel;
  const i = p.model.screen.buttons.findIndex((b) => b.label === 'Nueva partida');
  p.setHighlight(i);
});
await press('right', 'a-button');
const started = await until(() => {
  const g = window.__game;
  return g && !g.atTitle && g.modal === null && !g.xrBusy && window.__xr()?.canWalk === true;
}, 15000);
if (!started) note('FALL  no arrancó la partida');
await sleep(800);

// --------------------------------------------------------- menú del juego

await press('left', 'y-button');
await sleep(400);
await capture('07-menu-juego', 'gamePanel', { dist: 0.58 });

// Resaltado (stick) y apretado: el mismo botón en sus dos estados.
await page.evaluate(() => window.__game.panel.setHighlight(2));
await sleep(200);
await capture('08-boton-resaltado', 'gamePanel', { dist: 0.58 });
await page.evaluate(() => {
  const p = window.__game.panel;
  p.setHighlight(2);
  p.press(2);
});
await sleep(120);
await capture('09-boton-apretado', 'gamePanel', { dist: 0.58 });
await page.evaluate(() => window.__game.panel.cancelPress());

await pushMenu('passport', 1);
await capture('10-pasaporte', 'gamePanel', { dist: 0.58 });
await menuBack();
await pushMenu('toTitle', 6);
await capture('11-confirmar-volver-inicio', 'gamePanel', { dist: 0.58 });
await menuBack();
await press('left', 'y-button');
await sleep(400);

// ------------------------------------------------------- diálogo, ficha…

await page.evaluate(() => {
  void window.__game.ask({
    kind: 'line',
    line: {
      speaker: 'Rubén Gómez',
      role: 'Portero de la escuela',
      color: '#2b4c7e',
      text: '¡Bienvenido al recorrido de los 40 años! Antes de entrar, ¿querés que te cuente por dónde empezar?',
      choices: ['¡Sí, contame!', '¿Qué hay en la planta alta?', 'Después'],
    },
  });
});
await sleep(400);
await capture('12-dialogo', 'gamePanel', { dist: 0.58 });
await page.evaluate(() => window.__game.closeModalUI());
await sleep(300);

await page.evaluate(() => window.__game.startActivity('robot', null));
await sleep(500);
await capture('13-actividad-robot', 'gamePanel', { dist: 0.58 });
// Un programa con fichas: avanzar, girar y avanzar.
await page.evaluate(() => {
  const g = window.__game;
  for (const i of [0, 2, 0]) g.onActivityPick(i);
});
await sleep(400);
await capture('14-actividad-robot-programa', 'gamePanel', { dist: 0.58 });
await page.evaluate(() => window.__game.endActivity(false));
await sleep(400);

await page.evaluate(() => window.__game.startActivity('trivia', null));
await sleep(500);
await page.evaluate(() => window.__game.onActivityPick(0));
await sleep(400);
await capture('15-actividad-trivia', 'gamePanel', { dist: 0.58 });
await page.evaluate(() => window.__game.endActivity(false));
await sleep(400);

await page.evaluate(() => {
  window.__game.showCard({
    kicker: 'Aula Maker',
    title: 'Impresora 3D',
    text: 'Ya imprimiste el llavero del 40. La impresora deposita plástico capa por capa: por eso las piezas tienen esas líneas finitas.',
  });
});
await sleep(400);
await capture('16-ficha', 'gamePanel', { dist: 0.58 });
await page.evaluate(() => window.__game.closeModalUI());
await sleep(300);

await page.evaluate(() => {
  void window.__game.ask({
    kind: 'menu',
    kicker: 'Recorrido 40 completo',
    title: '¡Felicitaciones!',
    // Como lo arma el director (con la cuenta de sellos: el final dibuja la fila).
    text: 'Recorriste la escuela y llegaste al acto de los 40 años. Sellos 8/8 · lugares 31/36.',
    buttons: ['Seguir explorando'],
  });
});
await sleep(400);
await capture('17-creditos', 'gamePanel', { dist: 0.58 });
await page.evaluate(() => window.__game.closeModalUI());
await page.evaluate(() => window.__game.setModal?.(null));
await sleep(400);

// ----------------------------------------------------------------- cartel

// Rubén a 1,4 m delante de la mirada (el emulador no lleva la cabeza hasta él).
await page.evaluate(() => {
  const cam = window.__scene.activeCamera;
  const f = cam.getDirection(new window.__BABYLON_Vector3(0, 0, 1));
  const l = Math.hypot(f.x, f.z) || 1;
  const p = cam.globalPosition;
  const fr = window.__schoolFrame();
  const x = p.x + (f.x / l) * 1.4;
  const z = p.z + (f.z / l) * 1.4;
  const yaw = Math.atan2(p.x - x, p.z - z);
  window.__people().character('ruben').teleport({ u: fr.ox - x, v: z - fr.oz, level: 0 }, yaw);
});
const labelled = await until(() => Boolean(window.__game.panel?.labelText), 4000);
if (!labelled) {
  // Sin foco (otra cosa delante): el cartel directo, delante de la cara.
  await page.evaluate(() => {
    const cam = window.__scene.activeCamera;
    const f = cam.getDirection(new window.__BABYLON_Vector3(0, 0, 1));
    const p = cam.globalPosition;
    window.__game.panel.setLabel('Rubén · portero', 'Gatillo o A · Saludar', { x: p.x + f.x * 1.4, y: p.y + 0.1, z: p.z + f.z * 1.4 });
  });
  note('INFO  cartel forzado con setLabel (Rubén no quedó en foco)');
}
await sleep(300);
await capture('18-cartel', 'gameLabel', { dist: 0.45, pad: 40 });
await page.evaluate(() => window.__game.panel.setLabel(null));

// ------------------------------------------------------------------ avisos

await page.evaluate(() => window.__game.vrToast('Sello: Robótica', 'Pasaporte 40 · 1/8'));
await capture('19-aviso-sello', 'gameToast', { wait: 600, pad: 60, dist: 0.42 });
await sleep(3600);
await page.evaluate(() => window.__game.vrToast('Lugar descubierto', 'Biblioteca'));
await capture('19b-aviso-lugar', 'gameToast', { wait: 600, pad: 60, dist: 0.42 });
// Un consejo (sin medalla: no es un logro) con las fichas en dos filas, y una puerta que se abrió.
await page.evaluate(() => window.__game.vrToast('Controles', 'Stick izq.: caminar · Gatillo o A: saludar y usar · Y: menú'));
await capture('19c-aviso-controles', 'gameToast', { wait: 600, pad: 60, dist: 0.42 });
await page.evaluate(() => window.__game.vrToast('Se abrió', 'Recepción'));
await capture('19d-aviso-se-abrio', 'gameToast', { wait: 600, pad: 60, dist: 0.42 });

// ------------------------------------------------------------------ muñeca

await page.evaluate(() => {
  const head = window.__xrDevice.position;
  const left = window.__xrDevice.controllers.left;
  left.position.set(head.x - 0.02, head.y - 0.15, head.z - 0.26);
  const a = 0.6;
  left.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
});
await sleep(600);
await capture('21-muneca', 'xrWristPanel', { wait: 300, pad: 100 });

await done();

async function done() {
  note(errors.length ? `FALL  errores en consola: ${errors.slice(0, 6).join(' | ')}` : 'OK    sin errores en consola');
  note(`\n${files.length} archivos en ${shotDir}`);
  await browser.close();
  process.exit(log.some((l) => l.startsWith('FALL')) ? 1 : 0);
}
