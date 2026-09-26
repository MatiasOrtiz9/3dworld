/**
 * Auditoria automatizada: recoge hechos, no opiniones.
 *
 * Cada dato de aqui sale de ejecutar el proyecto, no de leer el codigo. Es la
 * diferencia entre "creo que el VR no anda" y saber exactamente que devuelve
 * navigator.xr.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const url = process.argv[2] ?? 'http://localhost:5174/?seed=42';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--disable-frame-rate-limit'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

const logs = [];
page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: e.message }));
page.on('requestfailed', (r) => logs.push({ type: 'requestfailed', text: r.url() }));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 180000,
  polling: 200,
});
await new Promise((r) => setTimeout(r, 2000));

// ---------------------------------------------------------------- WebXR
const xr = await page.evaluate(async () => {
  const out = {
    secureContext: window.isSecureContext,
    protocol: location.protocol,
    host: location.hostname,
    hasNavigatorXr: 'xr' in navigator,
    immersiveVr: null,
    inline: null,
    error: null,
    btnText: document.getElementById('btn-vr')?.textContent,
    btnDisabled: document.getElementById('btn-vr')?.disabled,
  };
  if (navigator.xr) {
    try {
      out.immersiveVr = await navigator.xr.isSessionSupported('immersive-vr');
      out.inline = await navigator.xr.isSessionSupported('inline');
    } catch (e) {
      out.error = String(e);
    }
  }
  return out;
});

console.log('=== WEBXR ===');
console.log(`  contexto seguro       ${xr.secureContext}   (${xr.protocol}//${xr.host})`);
console.log(`  navigator.xr existe   ${xr.hasNavigatorXr}`);
console.log(`  immersive-vr          ${xr.immersiveVr}`);
console.log(`  inline                ${xr.inline}`);
if (xr.error) console.log(`  error                 ${xr.error}`);
console.log(`  boton dice            "${xr.btnText}"  (deshabilitado: ${xr.btnDisabled})`);
console.log('');

// ------------------------------------------------- inventario de la escena
const scene = await page.evaluate(() => {
  const s = window.__scene;
  const drawn = s.meshes.filter((m) => m.isEnabled() && m.material);
  const byMat = {};
  for (const m of drawn) {
    const k = m.material.getClassName();
    byMat[k] = (byMat[k] ?? 0) + 1;
  }
  // Mallas habilitadas SIN instancias: geometria que ocupa un draw call y no
  // dibuja nada.
  const empty = drawn.filter((m) => m.thinInstanceCount === 0 && m.getTotalVertices() > 0);
  return {
    meshesTotal: s.meshes.length,
    meshesDrawn: drawn.length,
    materials: s.materials.length,
    textures: s.textures.length,
    lights: s.lights.length,
    byMaterialClass: byMat,
    emptyInstanced: empty.map((m) => m.name).slice(0, 10),
    emptyCount: empty.length,
    activeMeshes: s.getActiveMeshes().length,
    stats: document.getElementById('stats')?.innerText.replace(/\n/g, ' · '),
  };
});

console.log('=== ESCENA ===');
console.log(`  mallas en escena      ${scene.meshesTotal}  (dibujadas: ${scene.meshesDrawn})`);
console.log(`  materiales            ${scene.materials}`);
console.log(`  texturas              ${scene.textures}`);
console.log(`  luces                 ${scene.lights}`);
console.log(`  por clase de material ${JSON.stringify(scene.byMaterialClass)}`);
console.log(`  mallas con 0 copias   ${scene.emptyCount} ${scene.emptyCount ? JSON.stringify(scene.emptyInstanced) : ''}`);
console.log(`  HUD informa           ${scene.stats}`);
console.log('');

// ------------------------------------------- artefactos: cosas mal ubicadas
const artifacts = await page.evaluate(() => {
  const plan = window.__plan();
  const pitch = plan.blockSize + plan.streetWidth;
  const out = { peopleInsideBuildings: 0, peopleOutOfBounds: 0, sampled: 0 };

  // Muestra las posiciones de los peatones leyendo sus matrices de instancia.
  for (const m of window.__scene.meshes) {
    if (!/^torso\d/.test(m.name)) continue;
    const data = m._thinInstanceDataStorage?.matrixData;
    if (!data) continue;
    for (let i = 0; i < m.thinInstanceCount; i++) {
      const x = data[i * 16 + 12];
      const z = data[i * 16 + 14];
      out.sampled++;
      if (Math.abs(x) > plan.extent + 40 || Math.abs(z) > plan.extent + 40) out.peopleOutOfBounds++;
      // Reimplementa isSolid de forma aproximada usando el plano.
      const gx = Math.round(x / pitch + 4);
      const gz = Math.round(z / pitch + 4);
      const b = plan.blocks.find((bb) => bb.gx === gx && bb.gz === gz);
      if (!b) continue;
      const inside = Math.abs(x - b.cx) <= b.width / 2 && Math.abs(z - b.cz) <= b.depth / 2;
      if (!inside) continue;
      if (b.kind === 'tower' && Math.abs(x - b.cx) < 16 && Math.abs(z - b.cz) < 16) {
        out.peopleInsideBuildings++;
      } else if (b.kind === 'residential') {
        const inner = b.width / 2 - 13;
        if (!(Math.abs(x - b.cx) < inner && Math.abs(z - b.cz) < inner)) out.peopleInsideBuildings++;
      } else if (b.kind === 'civic' || b.kind === 'market') {
        if (Math.abs(x - b.cx) < b.width * 0.41 && Math.abs(z - b.cz) < b.depth * 0.41) {
          out.peopleInsideBuildings++;
        }
      }
    }
  }
  return out;
});

console.log('=== ARTEFACTOS ===');
console.log(`  peatones muestreados          ${artifacts.sampled}`);
console.log(`  dentro de edificios           ${artifacts.peopleInsideBuildings}`);
console.log(`  fuera del terreno             ${artifacts.peopleOutOfBounds}`);
console.log('');

// ---------------------------------------------------------------- consola
const errors = logs.filter((l) => l.type === 'error' || l.type === 'pageerror');
const warnings = logs.filter((l) => l.type === 'warning' || l.type === 'warn');
const failed = logs.filter((l) => l.type === 'requestfailed');

console.log('=== CONSOLA ===');
console.log(`  errores        ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(`     ${e.text.slice(0, 120)}`);
console.log(`  advertencias   ${warnings.length}`);
for (const w of warnings.slice(0, 4)) console.log(`     ${w.text.slice(0, 120)}`);
console.log(`  peticiones fallidas  ${failed.length}`);
for (const f of failed.slice(0, 4)) console.log(`     ${f.text.slice(0, 120)}`);

await browser.close();
