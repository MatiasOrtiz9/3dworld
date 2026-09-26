/**
 * Prueba de fugas al regenerar la ciudad.
 *
 * "Regenerar" es el camino que mas se repite y el que mas facil filtra: cada
 * pasada crea ~30.000 objetos, 6 texturas, ~100 materiales, un generador de
 * sombras y una sonda de reflexion. Si algo no se libera, la memoria crece sin
 * techo y en una sesion larga el navegador termina muriendo.
 *
 * IMPORTANTE: no usa el boton "Regenerar", porque ese cambia la semilla y con
 * otra semilla la cantidad de materiales distintos varia legitimamente — se
 * confunde variacion con fuga. Usa el boton de calidad, que cicla vr ->
 * balanced -> high: cada 3 clics vuelve EXACTAMENTE a la misma configuracion y
 * la misma semilla, asi que cualquier diferencia es una fuga de verdad.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const url = process.argv[2] ?? 'http://localhost:5174/?seed=42';
// Multiplos de 3 para cerrar el ciclo de calidad y volver al perfil inicial.
const cycles = Number(process.argv[3] ?? 2);
const rounds = cycles * 3;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });

const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const waitReady = () =>
  page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
    timeout: 240000,
    polling: 200,
  });
await waitReady();

const snapshot = () =>
  page.evaluate(() => {
    const s = window.__scene;
    return {
      meshes: s.meshes.length,
      materials: s.materials.length,
      textures: s.textures.length,
      lights: s.lights.length,
      // Observadores del bucle de render: si crecen, hay callbacks que no se
      // dieron de baja y se ejecutan de mas en cada cuadro.
      beforeRender: s.onBeforeRenderObservable.observers.length,
      afterRender: s.onAfterRenderObservable.observers.length,
      panels: document.querySelectorAll('#inspector').length,
    };
  });

const first = await snapshot();

for (let i = 0; i < rounds; i++) {
  await page.click('#btn-quality');
  await new Promise((r) => setTimeout(r, 600));
  await waitReady();
  await new Promise((r) => setTimeout(r, 400));
}

const last = await snapshot();

const keys = Object.keys(first);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`=== FUGAS tras ${rounds} reconstrucciones (${cycles} ciclos completos) ===`);
console.log(pad('recurso', 16) + padL('inicial', 9) + padL('final', 9) + padL('delta', 9));
let leaked = false;
for (const k of keys) {
  const d = last[k] - first[k];
  // Se tolera un margen minimo: la sonda de reflexion puede quedar en transito.
  const bad = Math.abs(d) > 2;
  if (bad) leaked = true;
  console.log(
    pad(k, 16) + padL(first[k], 9) + padL(last[k], 9) + padL((d >= 0 ? '+' : '') + d, 9) + (bad ? '   <-- FUGA' : ''),
  );
}

console.log('');
console.log(`=== ERRORES (${errors.length}) ===`);
console.log(errors.slice(0, 8).join('\n') || '  (ninguno)');

await browser.close();
process.exit(leaked || errors.length ? 1 : 0);
