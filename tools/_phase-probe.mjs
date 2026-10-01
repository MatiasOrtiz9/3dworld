import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const url = process.argv[2] ?? 'http://localhost:5174/?seed=42';
const gpu = process.argv[3] !== 'sw';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: gpu ? ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors']
            : ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-certificate-errors'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => { const t = m.text(); if (!t.startsWith('COSTBREAKDOWN')) console.log('  [console]', t.slice(0, 200)); });
await page.evaluateOnNewDocument(() => {
  const t0 = performance.now();
  window.__phases = [];
  let last = '';
  const poll = () => {
    const el = document.getElementById('boot-msg');
    const t = el?.textContent?.replace(/\d+\/\d+/, 'n/N') ?? '';
    if (t !== last) { window.__phases.push([Math.round(performance.now() - t0), t]); last = t; }
    if (!document.getElementById('boot')?.classList.contains('hidden')) setTimeout(poll, 5);
    else window.__phases.push([Math.round(performance.now() - t0), 'HIDDEN']);
  };
  // MutationObserver captura cambios aunque el hilo esté bloqueado entre medio
  new MutationObserver(() => {
    const el = document.getElementById('boot-msg');
    const t = el?.textContent?.replace(/\d+\/\d+/, 'n/N') ?? '';
    if (t !== last) { window.__phases.push([Math.round(performance.now() - t0), t]); last = t; }
  }).observe(document, { subtree: true, childList: true, characterData: true });
  setTimeout(poll, 0);
});
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 300000, polling: 200 });
console.log('total', Date.now() - t0, 'ms');
const ph = await page.evaluate(() => window.__phases);
for (let i = 0; i < ph.length; i++) console.log(String(ph[i][0]).padStart(7), (i ? '+' + (ph[i][0] - ph[i - 1][0]) : '').padStart(8), ph[i][1]);
console.log(await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(d.UNMASKED_RENDERER_WEBGL); }));
await browser.close();
