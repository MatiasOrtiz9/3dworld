/**
 * Prueba de la experiencia VR con un Meta Quest 3 emulado.
 *
 * Nadie puede ponerse el casco después de cada cambio, y compilar no dice nada
 * de cómo se siente adentro. IWER (Immersive Web Emulation Runtime, de Meta)
 * implementa `navigator.xr` en JavaScript: la página cree que corre en un
 * Quest 3 —incluido el user agent, así que elige el perfil VR igual que en el
 * visor— y desde acá se mueven la cabeza y los mandos.
 *
 * Verifica lo que se nota en los primeros diez segundos con el casco puesto:
 * aparecer parado sobre el piso frente a la escuela, colores iguales a los del
 * escritorio, el stick izquierdo camina sin derrapar ni hundirse, el derecho
 * gira y teletransporta, las paredes no se atraviesan, se ven los mandos y no
 * hay errores en consola.
 *
 *   node tools/test-vr.mjs [url] [carpeta-capturas] [--sw]
 *
 * `--sw` usa SwiftShader (render por software) si la máquina no tiene GPU.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// Con título: al entrar al visor tiene que aparecer el menú del juego delante.
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
const check = (name, ok, extra = '') =>
  results.push(`${ok ? 'OK  ' : 'FALL'}  ${name}${extra ? '  — ' + extra : ''}`);
const fmt = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : String(n));

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
const entered = await page
  .waitForFunction(() => window.__scene?.activeCamera?.getClassName() === 'WebXRCamera', {
    timeout: 120000,
    polling: 100,
  })
  .then(() => true)
  .catch(() => false);
check('entra en VR', entered);
if (!entered) {
  await finish();
}
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

const stick = (hand, x, y) =>
  page.evaluate((h, ax, ay) => window.__xrDevice.controllers[h].updateAxes('thumbstick', ax, ay), hand, x, y);

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

// ------------------------------------------------------------------- llegada

const spawn = await state();
await shot('vr-1-llegada');
check('colores: el mapeo tonal se aplica en el material', spawn.postTonemap === false);
check(
  'aparece parado sobre el piso',
  spawn.ground !== null && Math.abs(spawn.feet - spawn.ground) < 0.05,
  `pies ${fmt(spawn.feet)} · piso ${fmt(spawn.ground)} · cabeza ${fmt(spawn.head)}`,
);
check('no aparece dentro de un muro', spawn.solid === false);

const welcome = await page.evaluate(() => {
  const s = window.__scene;
  const panel = s.getMeshByName('gamePanel');
  if (!panel?.isEnabled()) return null;
  const cam = s.activeCamera;
  const to = panel.getAbsolutePosition().subtract(cam.position);
  const dist = to.length();
  const yaw = cam.rotationQuaternion.toEulerAngles().y;
  const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const cos = (to.x * fwd.x + to.z * fwd.z) / Math.hypot(to.x, to.z);
  return { dist, angle: (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI };
});
check(
  'el menú del juego queda delante, a distancia de lectura',
  welcome !== null && welcome.dist > 0.8 && welcome.dist < 2.6 && welcome.angle < 30,
  welcome ? `${fmt(welcome.dist)} m · ${fmt(welcome.angle, 0)}°` : 'no visible',
);

// Se empieza la partida como lo haría el gatillo sobre "Comenzar": con el menú
// abierto la caminata está pausada a propósito (leer en movimiento marea).
await page.evaluate(() => window.__director()?.resume(true));
await sleep(2500);
const paused = await page.evaluate(() => window.__director()?.modal ?? null);
check('al empezar, el juego deja caminar', paused === null, String(paused));

const controllers = await page.evaluate(() => {
  const s = window.__scene;
  const underGrip = (m) => {
    for (let n = m.parent; n; n = n.parent) if (/-(grip|pointer)$/.test(n.name)) return true;
    return false;
  };
  return s.meshes.filter((m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0 && underGrip(m)).length;
});
check('se ven los mandos', controllers >= 2, `${controllers} mallas en los mandos`);

// ---------------------------------------------------------------- caminata

// Hacia un punto libre: la calle frente a la escuela.
const before = await state();
await stickToward(-Math.sin(before.yaw), -Math.cos(before.yaw)); // de espaldas a la escuela
await sleep(250);
const samples = [];
for (let i = 0; i < 6; i++) {
  await sleep(200);
  samples.push(await state());
}
await stick('left', 0, 0);
const released = await state();
await sleep(700);
const settled = await state();
const walked = Math.hypot(released.x - before.x, released.z - before.z);
const drift = Math.hypot(settled.x - released.x, settled.z - released.z);
const sink = Math.max(...samples.map((s) => Math.abs(s.feet - (s.ground ?? 0))));
check('el stick izquierdo camina', walked > 1, `${fmt(walked)} m en ~1,4 s`);
check('al soltar el stick no derrapa', drift < 0.25, `${fmt(drift)} m después de soltar`);
check('caminando, los pies siguen el piso', sink < 0.08, `desvío máx. ${fmt(sink, 3)} m`);
await shot('vr-2-caminata');

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
await shot('vr-3-apuntando');
await stick('right', 0, 0);
await sleep(600);
const tp1 = await state();
const jumped = Math.hypot(tp1.x - tp0.x, tp1.z - tp0.z);
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
  await shot('vr-4-pared');
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
await shot('vr-5-mano');

const fps = (await state()).fps;
results.push(`INFO  fps en el emulador: ${fmt(fps, 0)} (no representa al visor)`);

// ------------------------------------------------------------------- salida

await page.evaluate(() => window.__xrDevice.activeSession?.end());
const exited = await page
  .waitForFunction(() => window.__scene?.activeCamera?.getClassName() !== 'WebXRCamera', {
    timeout: 15000,
    polling: 100,
  })
  .then(() => true)
  .catch(() => false);
check('sale de VR y vuelve el escritorio', exited);
await sleep(800);

await finish();

async function finish() {
  check('sin errores en consola', errors.length === 0, errors.slice(0, 6).join(' | '));
  console.log(results.join('\n'));
  if (warnings.length) console.log(`\nAvisos:\n${warnings.slice(0, 12).join('\n')}`);
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FALL')) ? 1 : 0);
}
