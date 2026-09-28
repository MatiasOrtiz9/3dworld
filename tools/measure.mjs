import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const url = process.argv[2] ?? 'http://localhost:5173/?seed=42';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const tDom = Date.now() - t0;

await page.waitForFunction(
  () => document.getElementById('boot')?.classList.contains('hidden'),
  { timeout: 180000, polling: 100 },
);
const tReady = Date.now() - t0;

const net = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource');
  const total = res.reduce((a, r) => a + (r.encodedBodySize || 0), 0);
  const js = res.filter((r) => r.name.endsWith('.js') || r.name.includes('.ts'));
  const nav = performance.getEntriesByType('navigation')[0];
  return {
    requests: res.length,
    transferredKB: Math.round(total / 1024),
    jsRequests: js.length,
    domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0),
    biggest: res
      .slice()
      .sort((a, b) => (b.encodedBodySize || 0) - (a.encodedBodySize || 0))
      .slice(0, 6)
      .map((r) => `${Math.round((r.encodedBodySize || 0) / 1024)}KB  ${r.name.split('/').pop().slice(0, 50)}`),
  };
});

console.log('=== TIEMPOS ===');
console.log(`  HTML listo            ${tDom} ms`);
console.log(`  Ciudad en pantalla    ${tReady} ms   <-- lo que percibe el usuario`);
console.log('');
console.log('=== RED ===');
console.log(`  peticiones            ${net.requests}  (${net.jsRequests} de JS)`);
console.log(`  transferido           ${net.transferredKB} KB`);
console.log('  archivos mas pesados:');
for (const b of net.biggest) console.log('    ' + b);

await browser.close();
