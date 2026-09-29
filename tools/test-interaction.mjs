/**
 * Prueba de humo de la interactividad.
 *
 * Compilar no prueba nada: un panel puede compilar y no abrirse nunca. Esto
 * ejercita de verdad los caminos que toca el usuario — abrir el panel de
 * energía, hacer clic sobre un edificio, cambiar de modo, caminar contra una
 * pared — y falla ruidosamente si alguno se rompe.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const url = process.argv[2] ?? 'http://localhost:5174/?seed=42';
const shotDir = process.argv[3] ?? 'shots';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 800 });

const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 240000,
  polling: 200,
});
await new Promise((r) => setTimeout(r, 1500));

const results = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? 'OK  ' : 'FALL'}  ${name}${extra ? '  — ' + extra : ''}`);

// --- 1. panel de energía ---
await page.click('#btn-energy');
await new Promise((r) => setTimeout(r, 500));
const energyOpen = await page.$eval('#energy', (el) => el.classList.contains('open'));
const energyText = await page.$eval('#energy', (el) => el.innerText.replace(/\n/g, ' | '));
check('abre el panel de energía', energyOpen);
check('el panel tiene datos', energyText.length > 20, energyText.slice(0, 120));

// --- 2. inspección: clic en el centro de la pantalla ---
await page.mouse.click(700, 400);
await new Promise((r) => setTimeout(r, 500));
let inspOpen = await page.$eval('#inspector', (el) => !el.classList.contains('hidden'));
// Si el centro dio al cielo, probar más abajo (suelo garantizado).
if (!inspOpen) {
  await page.mouse.click(700, 620);
  await new Promise((r) => setTimeout(r, 500));
  inspOpen = await page.$eval('#inspector', (el) => !el.classList.contains('hidden'));
}
const inspText = inspOpen ? await page.$eval('#inspector', (el) => el.innerText.replace(/\n/g, ' | ')) : '';
check('abre el panel de inspección al hacer clic', inspOpen, inspText.slice(0, 120));

await page.screenshot({ path: `${shotDir}/25-paneles.png` });

// --- 3. cambio de modo caminar/volar ---
const modeBefore = await page.$eval('#btn-mode', (el) => el.textContent);
await page.keyboard.press('KeyF');
await new Promise((r) => setTimeout(r, 300));
const modeAfter = await page.$eval('#btn-mode', (el) => el.textContent);
check('la tecla F cambia de modo', modeBefore !== modeAfter, `${modeBefore} -> ${modeAfter}`);

// --- 4. gravedad: volver a caminar deja al jugador a altura de ojos ---
await page.keyboard.press('KeyF');
await new Promise((r) => setTimeout(r, 600));
const y = await page.evaluate(() => window.__scene.activeCamera.position.y);
check('altura de ojos al caminar (~1,7 m)', y > 1.2 && y < 2.6, `y = ${y.toFixed(2)}`);

// --- 5. caminar hacia adelante mueve al jugador ---
const before = await page.evaluate(() => {
  const p = window.__scene.activeCamera.position;
  return { x: p.x, z: p.z };
});
// Se espera por CUADROS, no por tiempo: el movimiento se integra por cuadro y
// dt esta topado a 50 ms para que un tiron no teletransporte al jugador a
// traves de una pared. Bajo render por software (1 fps) esperar por reloj mide
// el renderizador, no el controlador.
await page.keyboard.down('KeyW');
await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const tick = () => (++n >= 8 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
);
await page.keyboard.up('KeyW');
const after = await page.evaluate(() => {
  const p = window.__scene.activeCamera.position;
  return { x: p.x, z: p.z };
});
const moved = Math.hypot(after.x - before.x, after.z - before.z);
const fps = await page.evaluate(() => window.__scene.getEngine().getFps());
check(
  'caminar desplaza al jugador',
  moved > 0.15,
  `${moved.toFixed(2)} m en 8 cuadros a ${fps.toFixed(0)} fps`,
);

// --- 6. los pájaros se mueven ---
const m1 = await page.evaluate(() => {
  const m = window.__scene.meshes.find((x) => x.name === 'birdBodySrc');
  return m?._thinInstanceDataStorage?.matrixData?.[12] ?? null;
});
await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const tick = () => (++n >= 12 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
);
const m2 = await page.evaluate(() => {
  const m = window.__scene.meshes.find((x) => x.name === 'birdBodySrc');
  return m?._thinInstanceDataStorage?.matrixData?.[12] ?? null;
});
check('los pájaros se mueven', m1 !== null && m2 !== null && m1 !== m2, `x: ${m1} -> ${m2}`);

await page.screenshot({ path: `${shotDir}/26-caminando.png` });

console.log('=== INTERACCIÓN ===');
for (const r of results) console.log('  ' + r);
console.log('');
console.log(`=== ERRORES DE CONSOLA (${errors.length}) ===`);
console.log(errors.slice(0, 10).join('\n') || '  (ninguno)');

await browser.close();
process.exit(results.some((r) => r.startsWith('FALL')) ? 1 : 0);
