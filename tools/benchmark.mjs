/**
 * Banco de pruebas con GPU REAL.
 *
 * Todas las herramientas anteriores fuerzan SwiftShader (render por software)
 * para que las capturas sean reproducibles en cualquier maquina. Eso sirve para
 * ver la imagen, pero los fps que informan no significan absolutamente nada.
 *
 * Esta herramienta hace lo contrario: NO desactiva la GPU, verifica en el
 * arranque que efectivamente este usando hardware —si detecta SwiftShader,
 * aborta en vez de informar numeros falsos— y mide cuadros por segundo
 * sostenidos en tres situaciones distintas:
 *
 *   1. Quieto en la plaza (caso mejor)
 *   2. Caminando por la ciudad (caso tipico)
 *   3. Vista aerea (caso peor: se ve todo a la vez)
 *
 * Uso: node tools/benchmark.mjs <url-base> [segundos-por-prueba]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const base = process.argv[2] ?? 'http://localhost:5174/';
const seconds = Number(process.argv[3] ?? 6);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  // Headless moderno: usa la GPU si hay uina disponible.
  headless: true,
  args: [
    '--no-sandbox',
    // Nada de swiftshader aca. Se quiere la GPU de verdad.
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--disable-frame-rate-limit', // sin esto Chrome capa a 60 y no se ve el techo
    '--window-size=1920,1080',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${base}?seed=42`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 120000,
  polling: 200,
});

// --- verificacion de que hay GPU ---
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { renderer: 'sin WebGL2', vendor: '' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  };
});

console.log('=== RENDERIZADOR ===');
console.log(`  ${gpu.vendor}`);
console.log(`  ${gpu.renderer}`);

const isSoftware = /swiftshader|software|llvmpipe/i.test(gpu.renderer);
if (isSoftware) {
  console.log('');
  console.log('  ABORTA: esto es render por software. Los fps no serian reales.');
  await browser.close();
  process.exit(2);
}
console.log('  -> GPU real confirmada. Los numeros de abajo valen.');
console.log('');

/** Mide fps sostenidos contando cuadros durante N segundos. */
async function measure(label, setup) {
  if (setup) await page.evaluate(setup);
  // Un segundo de descarte: los primeros cuadros tras mover la camara incluyen
  // compilaciones de shader y subidas de textura que no representan el estado
  // estacionario.
  await new Promise((r) => setTimeout(r, 1000));

  const result = await page.evaluate(async (secs) => {
    return await new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const times = [];
      let last = t0;
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        frames++;
        if (now - t0 < secs * 1000) requestAnimationFrame(tick);
        else {
          times.sort((a, b) => a - b);
          resolve({
            fps: frames / ((now - t0) / 1000),
            // Percentil 99 del tiempo de cuadro: el tiron peor. Un promedio
            // alto con p99 malo se siente peor que un promedio algo menor y
            // estable, sobre todo en VR.
            p99: times[Math.floor(times.length * 0.99)],
            median: times[Math.floor(times.length / 2)],
          });
        }
      };
      requestAnimationFrame(tick);
    });
  }, seconds);

  const stats = await page.$eval('#stats', (el) => el.innerText.replace(/\n/g, ' · '));
  console.log(`  ${label.padEnd(22)} ${result.fps.toFixed(0).padStart(4)} fps   mediana ${result.median.toFixed(1)} ms   p99 ${result.p99.toFixed(1)} ms`);
  return { label, ...result, stats };
}

const profiles = ['high', 'balanced', 'vr'];
const results = [];

for (const profile of profiles) {
  await page.goto(`${base}?seed=42&quality=${profile}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
    timeout: 120000,
    polling: 200,
  });
  await new Promise((r) => setTimeout(r, 800));

  const info = await page.$eval('#stats', (el) => el.innerText.replace(/\n/g, ' · '));
  console.log(`=== PERFIL: ${profile.toUpperCase()} ===`);
  console.log(`  ${info.replace(/^[\d.]+ fps · /, '')}`);

  results.push(await measure('en la plaza', null));
  results.push(
    await measure('vista aerea', () => {
      const c = window.__scene.activeCamera;
      c.position.set(0, 210, -260);
      c.setTarget(new window.__BABYLON_Vector3(0, 10, 0));
    }),
  );
  results.push(
    await measure('a ras de calle', () => {
      const c = window.__scene.activeCamera;
      c.position.set(-85.5, 1.68, -150);
      c.setTarget(new window.__BABYLON_Vector3(-85.5, 8, -20));
    }),
  );
  console.log('');
}

console.log(`=== ERRORES (${errors.length}) ===`);
console.log(errors.slice(0, 5).join('\n') || '  (ninguno)');

await browser.close();
