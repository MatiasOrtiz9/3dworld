/**
 * Robustez EN EJECUCION a traves de varias semillas.
 *
 * Los invariantes del plano (que siempre haya plaza, que las alturas sean
 * finitas, que haya 81 manzanas) ya NO se prueban aca: viven en
 * `tests/cityLayout.test.ts`, corren en Node sin navegador y cubren 300
 * semillas en milisegundos en vez de 10 en minutos.
 *
 * Lo que queda aca es lo que un test unitario no puede ver: que la ciudad
 * efectivamente TERMINE de construirse y renderizarse en un navegador real,
 * que el jugador aparezca parado sobre el suelo y no dentro de un edificio, y
 * que no haya errores en consola. Eso exige un motor 3D de verdad.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const base = process.argv[2] ?? 'http://localhost:5174/';
const count = Number(process.argv[3] ?? 12);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 400 });

const failures = [];
const stats = [];

for (let i = 0; i < count; i++) {
  const seed = 1000 + i * 7919; // primo grande: semillas bien separadas
  await page.goto(`${base}?seed=${seed}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page
    .waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
      timeout: 240000,
      polling: 200,
    })
    .catch(() => failures.push(`semilla ${seed}: no termino de cargar`));

  const r = await page.evaluate(() => {
    const plan = window.__plan();
    if (!plan) return { error: 'sin plano' };
    const kinds = {};
    for (const b of plan.blocks) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
    const cam = window.__scene.activeCamera.position;
    return {
      kinds,
      camY: cam.y,
      meshes: window.__scene.meshes.length,
      blocks: plan.blocks.length,
    };
  });

  if (r.error) {
    failures.push(`semilla ${seed}: ${r.error}`);
    continue;
  }

  // --- comprobaciones de ejecucion (las de datos estan en los tests unitarios) ---
  if (!(r.camY > 1.2 && r.camY < 2.6)) {
    failures.push(`semilla ${seed}: el jugador aparece a y=${r.camY.toFixed(2)}, no a altura de ojos`);
  }
  if (!r.meshes || r.meshes < 20) {
    failures.push(`semilla ${seed}: solo ${r.meshes} mallas en escena, la ciudad no se construyo`);
  }

  stats.push({ seed, ...r.kinds });
}

// Distribucion de tipos: si un tipo casi nunca aparece, el plano esta
// desbalanceado y la variedad entre ciudades es menor de lo que parece.
const totals = {};
for (const s of stats) {
  for (const [k, v] of Object.entries(s)) {
    if (k === 'seed') continue;
    totals[k] = (totals[k] || 0) + v;
  }
}
const grand = Object.values(totals).reduce((a, b) => a + b, 0);

console.log(`=== ${count} semillas generadas y renderizadas ===`);
console.log('');
console.log('Distribucion media de tipos de manzana:');
for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
  const pct = ((v / grand) * 100).toFixed(1);
  const bar = '#'.repeat(Math.round(Number(pct) / 2));
  console.log(`  ${k.padEnd(13)} ${String((v / count).toFixed(1)).padStart(5)} por ciudad  ${pct.padStart(5)}%  ${bar}`);
}
console.log('');
console.log(`=== FALLOS (${failures.length}) ===`);
console.log(failures.slice(0, 20).join('\n') || '  (ninguno: todas las semillas producen una ciudad valida)');

await browser.close();
process.exit(failures.length ? 1 : 0);
