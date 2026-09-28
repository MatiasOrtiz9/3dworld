/**
 * Captura la ciudad desde un Chrome headless.
 *
 * Existe porque mirar el typecheck no dice nada sobre si la ciudad se VE bien.
 * Además recoge los errores de consola, que es donde aparecen los problemas
 * reales de Babylon (shaders que no compilan, buffers mal armados, etc).
 *
 * Uso: node tools/shoot.mjs [url] [salida.png] [--cam=x,y,z] [--target=x,y,z] [--time=noon]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v = 'true'] = a.replace(/^--/, '').split('=');
      return [k, v];
    }),
);

const url = positional[0] ?? 'http://localhost:5173/';
const out = positional[1] ?? 'shot.png';
const width = Number(flags.w ?? 1600);
const height = Number(flags.h ?? 900);

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No encontré Chrome ni Edge.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // WebGL en headless: sin estos flags Babylon no arranca.
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    `--window-size=${width},${height}`,
  ],
});

const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Espera a que la pantalla de carga se oculte (la ciudad terminó de generarse).
await page
  .waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
    timeout: 180000,
    polling: 500,
  })
  .catch(() => logs.push('[warn] la pantalla de carga no se ocultó a tiempo'));

// Cambio de hora opcional, para comparar iluminaciones.
// Ahora la hora es un valor continuo: --time=19.5 en vez de un nombre.
if (flags.time) {
  const h = Number(flags.time);
  if (Number.isFinite(h)) {
    await page.$eval(
      '#time-slider',
      (el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      h,
    );
    await new Promise((r) => setTimeout(r, 400));
  }
}

// Reposiciona la cámara si se pidió, exponiendo la escena vía window.
if (flags.cam) {
  const cam = flags.cam.split(',').map(Number);
  const tgt = (flags.target ?? '0,10,0').split(',').map(Number);
  await page.evaluate(
    ([c, t]) => {
      const scene = window.__scene;
      if (!scene) return;
      const cameraObj = scene.activeCamera;
      cameraObj.position.set(c[0], c[1], c[2]);
      cameraObj.setTarget(new window.__BABYLON_Vector3(t[0], t[1], t[2]));
    },
    [cam, tgt],
  );
}

// Deja correr unos cuadros para que se estabilicen fps y sombras.
await new Promise((r) => setTimeout(r, 2500));

const stats = await page.$eval('#stats', (el) => el.innerText).catch(() => '(sin métricas)');

await page.screenshot({ path: out });
await browser.close();

console.log('--- métricas ---');
console.log(stats);
const cost = logs.find((l) => l.includes('COSTBREAKDOWN'));
if (cost) {
  const rows = JSON.parse(cost.slice(cost.indexOf('[{')));
  console.log('--- coste por primitiva/material (top) ---');
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(pad('clave', 42) + padL('copias', 9) + padL('tris/u', 8) + padL('tris', 11));
  for (const r of rows) {
    console.log(pad(r.key.slice(0, 41), 42) + padL(r.instances, 9) + padL(r.trisEach, 8) + padL(r.tris.toLocaleString('es-AR'), 11));
  }
}

const noise = /Babylon\.js v|Engine\.|WebGL: |deprecat|COSTBREAKDOWN|\[vite\]/i;
const important = logs.filter((l) => !noise.test(l));
console.log(`--- consola (${important.length} relevantes de ${logs.length}) ---`);
console.log(important.slice(0, 30).join('\n') || '(sin errores)');
console.log(`\nGuardado: ${out}`);
