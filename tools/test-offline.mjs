/**
 * Prueba de funcionamiento sin conexion.
 *
 * Que el build genere un `sw.js` no prueba nada: lo que importa es si la ciudad
 * se construye y renderiza con la red cortada. Esto carga la aplicacion una
 * vez, espera a que el service worker tome control, CORTA la red de verdad
 * (CDP Network.emulateNetworkConditions) y recarga.
 *
 * Es tambien el camino recomendado para VR: un visor exige contexto seguro, y
 * una PWA servida por HTTPS resuelve eso y ademas queda disponible sin red.
 *
 * Uso: node tools/test-offline.mjs <url-de-preview>
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const url = process.argv[2] ?? 'http://localhost:4173/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const results = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? 'OK  ' : 'FALL'}  ${name}${extra ? '  — ' + extra : ''}`);

// --- primera carga, con red ---
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 180000,
  polling: 200,
});
check('carga con red', true);

// --- el service worker toma control ---
const swReady = await page
  .evaluate(
    () =>
      new Promise((resolve) => {
        if (!('serviceWorker' in navigator)) return resolve(false);
        navigator.serviceWorker.ready.then(() => resolve(true));
        setTimeout(() => resolve(false), 20000);
      }),
  )
  .catch(() => false);
check('el service worker queda activo', swReady);

// Margen para que termine de precachear antes de cortar la red.
await new Promise((r) => setTimeout(r, 4000));

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  let total = 0;
  for (const n of names) total += (await (await caches.open(n)).keys()).length;
  return { names: names.length, entries: total };
});
check('hay archivos en el cache', cached.entries > 10, `${cached.entries} entradas en ${cached.names} cachés`);

// --- CORTE DE RED REAL ---
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
});

const failures = [];
page.on('requestfailed', (r) => failures.push(r.url()));

let offlineOk = true;
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {
  offlineOk = false;
  check('recarga sin red', false, String(e).slice(0, 80));
}

if (offlineOk) {
  check('recarga sin red', true);
  const built = await page
    .waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
      timeout: 180000,
      polling: 300,
    })
    .then(() => true)
    .catch(() => false);
  check('la ciudad se construye sin red', built);

  if (built) {
    const info = await page.evaluate(() => {
      const plan = window.__plan();
      return { blocks: plan?.blocks.length ?? 0, meshes: window.__scene.meshes.length };
    });
    check(
      'la escena tiene contenido real',
      info.blocks === 81 && info.meshes > 20,
      `${info.blocks} manzanas · ${info.meshes} mallas`,
    );
    await page.screenshot({ path: 'shots/80-offline.png' });
  }
}

console.log('=== SIN CONEXIÓN ===');
for (const r of results) console.log('  ' + r);
console.log('');
console.log(`  peticiones fallidas durante la recarga offline: ${failures.length}`);
if (failures.length) console.log('    ' + failures.slice(0, 5).join('\n    '));

await browser.close();
process.exit(results.some((r) => r.startsWith('FALL')) ? 1 : 0);
