/**
 * ¿Quién asigna memoria en cada cuadro?
 *
 * La basura por cuadro termina en pausas del recolector, que en el visor se
 * sienten como tirones. Esto deja correr la escena unos segundos con el
 * perfilador de asignaciones por muestreo de V8 (CDP HeapProfiler) y lista
 * las funciones que más bytes asignaron, con archivo y línea, y la pila
 * resumida que llega hasta código del proyecto.
 *
 *   node tools/alloc.mjs <url-base> [calidad=vr] [segundos=4] [vista] [sw]
 *
 * vista: fachada (por omisión), hall, aerea.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const [base = 'http://localhost:5173/', tier = 'vr', secs = '4', view = 'fachada', mode] = process.argv.slice(2);
const gpu = mode !== 'sw';
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const VIEWS = {
  fachada: { eye: [50.9, 1.7, 9.8], look: [44, 3.8, -3.5] },
  hall: { eye: [41.5, 1.74, -1], look: [41.5, 1.6, -14] },
  aerea: { eye: [40, 60, 60], look: [38, 0, -15] },
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    ...(gpu
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']),
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(`${base}?seed=42&quality=${tier}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 400000,
  polling: 100,
});
await page.keyboard.press('KeyF');
const v = VIEWS[view] ?? VIEWS.fachada;
await page.evaluate(([e, l]) => {
  const f = window.__schoolFrame();
  const cam = window.__scene.activeCamera;
  const V3 = window.__BABYLON_Vector3;
  cam.position = new V3(f.ox - e[0], e[1], f.oz + e[2]);
  cam.setTarget(new V3(f.ox - l[0], l[1], f.oz + l[2]));
}, [v.eye, v.look]);
// Los primeros segundos compilan shaders (cientos de KB de cadenas por
// cuadro): se espera a que el cuadro se estabilice.
await page.waitForFunction(
  () => {
    const e = window.__scene.getEngine();
    window.__f0 ??= [e.frameId, performance.now()];
    return e.frameId - window.__f0[0] > 300 && performance.now() - window.__f0[1] > 6000;
  },
  { timeout: 120000, polling: 250 },
);

const cdp = await page.createCDPSession();
await cdp.send('HeapProfiler.enable');
const frames0 = await page.evaluate(() => window.__scene.getEngine().frameId);
await cdp.send('HeapProfiler.startSampling', {
  samplingInterval: 512,
  // Sin esto sólo cuentan los objetos vivos al parar: justo la basura por cuadro no aparece.
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
await new Promise((r) => setTimeout(r, Number(secs) * 1000));
const { profile } = await cdp.send('HeapProfiler.stopSampling');
const frames = (await page.evaluate(() => window.__scene.getEngine().frameId)) - frames0;

// Suma por función (bytes propios) y por la primera función del proyecto en la pila.
const self = new Map();
const owner = new Map();
const isOurs = (u) => /\/src\//.test(u);
const walk = (node, stack) => {
  const cf = node.callFrame;
  const here = `${cf.functionName || '(anónima)'} ${cf.url.replace(/^.*\/(src|node_modules\/\.vite[^/]*\/deps|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
  const st = [...stack, { here, ours: isOurs(cf.url) }];
  const bytes = node.selfSize;
  if (bytes) {
    self.set(here, (self.get(here) ?? 0) + bytes);
    const ours = [...st].reverse().find((s) => s.ours);
    const key = ours ? ours.here : '(motor/sin código propio)';
    owner.set(key, (owner.get(key) ?? 0) + bytes);
  }
  for (const c of node.children) walk(c, st);
};
walk(profile.head, []);
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`${tier} · ${view} · ${frames} cuadros · ${(total / 1024 / Math.max(1, frames)).toFixed(1)} KB/cuadro (muestreo)`);
console.log('\n-- por función propia más cercana en la pila (KB/cuadro)');
for (const [k, b] of top(owner, 25)) console.log(`${(b / 1024 / frames).toFixed(2).padStart(8)}  ${k}`);
console.log('\n-- por función que asigna (KB/cuadro)');
for (const [k, b] of top(self, 25)) console.log(`${(b / 1024 / frames).toFixed(2).padStart(8)}  ${k}`);
await browser.close();
