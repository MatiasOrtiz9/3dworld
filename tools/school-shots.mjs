// Capturas de la escuela en coordenadas LOCALES del plano: u (este), v (sur), y.
// Uso: node school-shots.mjs <url> <outdir> <views.json> [sw]
// views: [{name, eye:[u,y,v], look:[u,y,v], fly?:bool, wait?:ms}]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
const [url, outDir, viewsFile, mode] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const views = JSON.parse(readFileSync(viewsFile, 'utf8'));
const gpu = mode !== 'sw';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  acceptInsecureCerts: true,
  args: gpu
    ? ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors', '--window-size=1280,720']
    : ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-certificate-errors', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page
  .waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 300000, polling: 500 })
  .catch(() => logs.push('[warn] boot no se ocultó'));
await page.evaluate(() => document.getElementById('help')?.classList.add('hidden'));
const stats = await page.$eval('#stats', (el) => el.innerText).catch(() => '');
console.log(stats.replace(/\n/g, ' | '));
let flying = false;
for (const v of views) {
  if (v.fly && !flying) { await page.keyboard.press('KeyF'); flying = true; }
  await page.evaluate(
    ([e, l]) => {
      const f = window.__schoolFrame();
      const scene = window.__scene;
      const cam = scene.activeCamera;
      const V3 = window.__BABYLON_Vector3;
      cam.position = new V3(f.ox - e[0], e[1], f.oz + e[2]);
      cam.setTarget(new V3(f.ox - l[0], l[1], f.oz + l[2]));
    },
    [v.eye, v.look],
  );
  await new Promise((r) => setTimeout(r, v.wait ?? 1500));
  await page.screenshot({ path: `${outDir}/${v.name}.png` });
  console.log('shot', v.name);
}
const noise = /Babylon\.js v|WebGL: |deprecat|COSTBREAKDOWN|\[vite\]|precompile/i;
console.log(logs.filter((l) => !noise.test(l)).slice(0, 30).join('\n') || '(sin errores)');
await browser.close();
