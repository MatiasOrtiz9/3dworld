/**
 * Verifica que el viento del follaje realmente se aplique.
 *
 * Que el shader compile sin errores no prueba nada: un plugin mal enganchado
 * compila perfecto y no mueve un solo vertice. Esto comprueba tres cosas
 * independientes:
 *
 *   1. Que el define WIND llegue al efecto compilado del material de follaje.
 *   2. Que el uniforme windTime realmente avance entre cuadros.
 *   3. Que la IMAGEN cambie, en una zona donde solo hay vegetacion.
 *
 * El tercer punto es el que importa: los dos primeros pueden estar bien y el
 * desplazamiento ser cero igual.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

// Perfil MEDIO a proposito: el alto activa grano de pelicula animado, que
// cambia la imagen en cada cuadro por diseno. Con el puesto, la prueba de
// control —comprobar que con el viento congelado la imagen se queda quieta—
// falla siempre, y no por culpa del viento.
const url = process.argv[2] ?? 'http://localhost:5174/?seed=42&quality=balanced';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--disable-frame-rate-limit'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 180000,
  polling: 200,
});

// Se captura SOLO el canvas, no la pagina entera.
//
// El HUD muestra un contador de fps que se refresca cada 500 ms, asi que dos
// capturas de pagina completa NUNCA son identicas — 95 pixeles de 540.000, en
// un rectangulo de 14x9 abajo a la derecha. Suficiente para que el control
// fallara siempre y pareciera que algo se movia en la escena.
const shot = async () => {
  const canvas = await page.$('#render');
  return await canvas.screenshot({ encoding: 'base64' });
};

const results = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? 'OK  ' : 'FALL'}  ${name}${extra ? '  — ' + extra : ''}`);

// --- 1. el define llega al shader ---
const defines = await page.evaluate(() => {
  const mesh = window.__scene.meshes.find(
    (m) => m.material && m.material.name.startsWith('f:'),
  );
  if (!mesh) return { found: false };
  // OJO: en StandardMaterial el efecto compilado vive en la SUBMALLA, no en el
  // material. `material.getEffect()` devuelve null y da un falso negativo — es
  // el error que tuvo la primera version de este test y que casi hace
  // descartar un plugin que funcionaba.
  const effect = mesh.subMeshes?.[0]?.effect;
  const names = mesh.material.pluginManager?._plugins?.map((p) => p.name) ?? [];
  return {
    found: true,
    name: mesh.material.name,
    hasPlugin: names.includes('Wind'),
    defines: effect ? String(effect.defines).includes('#define WIND') : false,
    inSource: effect ? String(effect.vertexSourceCode || '').includes('windStrength') : false,
  };
});
check('hay material de follaje', defines.found, defines.name ?? '');
check('el plugin Wind está instalado', !!defines.hasPlugin);
check('el define WIND llega al shader compilado', !!defines.defines);
check('el código de viento está en el shader de vértices', !!defines.inSource);

// --- 2. el reloj avanza ---
//
// Primero se pasa a modo VOLAR. En modo caminar el controlador aplica gravedad
// en cada cuadro, asi que colocar la camara a 6 m de altura la hace CAER
// durante toda la prueba: la imagen cambia sola y el control da falso negativo.
// Costo encontrarlo; vale la pena dejarlo escrito.
await page.keyboard.press('KeyF');
await new Promise((r) => setTimeout(r, 300));

// Se apunta la cámara a un parque: sólo vegetación, sin gente ni pájaros que
// ensucien la comparación de imagen.
await page.evaluate(() => {
  const plan = window.__plan();
  const park = plan.blocks.find((b) => b.kind === 'park');
  const c = window.__scene.activeCamera;
  c.position.set(park.cx, 6, park.cz - 34);
  c.setTarget(new window.__BABYLON_Vector3(park.cx, 5, park.cz));

  // Se ocultan gente, tranvias y pajaros. Sin esto, la comparacion de imagen
  // pasa siempre —hay cosas moviendose todo el tiempo— y el test daria por
  // bueno el viento aunque estuviera roto. Que fue exactamente lo que paso.
  const moving = /^(torso|head|legL|legR|birdSrc|tramBodySrc|tramGlassSrc)/;
  for (const m of window.__scene.meshes) {
    if (moving.test(m.name)) m.setEnabled(false);
  }
});
await new Promise((r) => setTimeout(r, 700));

// --- 3. el reloj del viento avanza, y se detiene al congelarlo ---
//
// Esto reemplaza a una comparacion de imagenes que resulto ser un mal control.
// Fallaba por tres motivos que no tenian nada que ver con el viento: el grano
// de pelicula animado del perfil alto, la camara cayendo por gravedad, y el
// contador de fps del HUD refrescandose. Medir el reloj es directo, exacto y no
// depende de que nada mas en pantalla este quieto.
const t0 = await page.evaluate(() => window.__windClock());
await new Promise((r) => setTimeout(r, 700));
const t1 = await page.evaluate(() => window.__windClock());
check('el reloj del viento avanza', t1 > t0 + 0.3, `${t0.toFixed(2)} s -> ${t1.toFixed(2)} s`);

await page.evaluate(() => {
  window.__freezeWind = true;
});
await new Promise((r) => setTimeout(r, 200));
const t2 = await page.evaluate(() => window.__windClock());
await new Promise((r) => setTimeout(r, 700));
const t3 = await page.evaluate(() => window.__windClock());
check('congelado, el reloj se detiene', t3 === t2, `${t2.toFixed(3)} s -> ${t3.toFixed(3)} s`);

// Y una comprobacion visual de apoyo: con el viento activo la imagen del
// canvas cambia. Es senal, no control.
await page.evaluate(() => {
  window.__freezeWind = false;
});
const shotA = await shot();
await new Promise((r) => setTimeout(r, 800));
const shotB = await shot();
check('la imagen del canvas cambia con viento activo', shotA !== shotB);

console.log('=== VIENTO ===');
for (const r of results) console.log('  ' + r);

await browser.close();
process.exit(results.some((r) => r.startsWith('FALL')) ? 1 : 0);
