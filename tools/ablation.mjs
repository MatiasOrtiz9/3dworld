/**
 * Atribucion de coste por efecto, con GPU real.
 *
 * El banco general mostro que el perfil VR corre a ~990 fps y el perfil alto a
 * ~80, con solo el doble de triangulos entre ambos. Un factor de 12x no se
 * explica por geometria. Esto mide cuanto cuesta CADA cosa por separado,
 * activandolas una por una sobre la misma escena.
 *
 * Uso: node tools/ablation.mjs <url-base> [segundos]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const base = process.argv[2] ?? 'http://localhost:5174/';
const seconds = Number(process.argv[3] ?? 5);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-frame-rate-limit',
    '--window-size=1920,1080',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });

await page.goto(`${base}?seed=42&quality=high`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 120000,
  polling: 200,
});

const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
});
if (/swiftshader|software/i.test(gpu)) {
  console.log('ABORTA: render por software.');
  await browser.close();
  process.exit(2);
}
console.log(`GPU: ${gpu}`);
console.log('');

async function measure() {
  await new Promise((r) => setTimeout(r, 900));
  return await page.evaluate(
    (secs) =>
      new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          frames++;
          const now = performance.now();
          if (now - t0 < secs * 1000) requestAnimationFrame(tick);
          else resolve(frames / ((now - t0) / 1000));
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );
}

// Camara fija a ras de calle: el caso mas exigente y el mas representativo.
await page.evaluate(() => {
  const c = window.__scene.activeCamera;
  c.position.set(-85.5, 1.68, -150);
  c.setTarget(new window.__BABYLON_Vector3(-85.5, 8, -20));
});

const cases = [
  ['linea base (solo geometria)',  () => { window.__setShadows(false); window.__setPost('off'); }],
  ['+ bloom y FXAA (lite)',        () => { window.__setShadows(false); window.__setPost('lite'); }],
  ['+ oclusion ambiental media',   () => { window.__setShadows(false); window.__setPost('balanced'); }],
  ['+ oclusion ambiental alta',    () => { window.__setShadows(false); window.__setPost('high'); }],
  ['+ sombras CSM solas',          () => { window.__setShadows(true);  window.__setPost('off'); }],
  ['sombras + lite',               () => { window.__setShadows(true);  window.__setPost('lite'); }],
  ['sombras + medio',              () => { window.__setShadows(true);  window.__setPost('balanced'); }],
  ['sombras + alto (perfil Alta)', () => { window.__setShadows(true);  window.__setPost('high'); }],
];

const rows = [];
for (const [label, setup] of cases) {
  await page.evaluate(setup);
  const fps = await measure();
  rows.push([label, fps]);
  console.log(`  ${label.padEnd(32)} ${fps.toFixed(0).padStart(5)} fps   ${(1000 / fps).toFixed(2).padStart(6)} ms/cuadro`);
}

const baseMs = 1000 / rows[0][1];
console.log('');
console.log('=== COSTE ATRIBUIDO (ms por cuadro, sobre la linea base) ===');
for (const [label, fps] of rows.slice(1)) {
  const ms = 1000 / fps - baseMs;
  console.log(`  ${label.padEnd(32)} +${ms.toFixed(2)} ms`);
}

await browser.close();
