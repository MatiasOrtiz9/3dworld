/**
 * Costo de CPU por cuadro, desglosado, y tiempos de arranque.
 *
 * Los fps de Chrome headless no dicen nada de un visor (ver HANDOFF, 6), pero
 * el trabajo de JavaScript por cuadro sí se traslada: en el Quest la CPU es
 * varias veces más lenta y el mismo reparto se paga multiplicado. Esto mide,
 * en cada encuadre, cuánto tarda el cuadro en el hilo principal y en qué:
 *
 *  - `cuadro`: todo el callback del bucle de render (calidad adaptativa,
 *    viento y `scene.render`), promedio y p95.
 *  - `antes`: cada observador de `onBeforeRenderObservable` por separado
 *    (gente, tránsito, juego, audio…), con un trozo de su código para
 *    reconocerlo.
 *  - `mallas`: evaluación de mallas activas (culling de Babylon).
 *  - `rtt`: render targets (sombras, sondas) y `dibujo`: la pasada principal.
 *  - draw calls, mallas activas, triángulos y KB asignados por cuadro
 *    (crecimiento del heap entre recolecciones; con
 *    `--enable-precise-memory-info` es exacto al byte).
 *
 * Arranque: tiempo hasta ocultar la pantalla de carga y cada fase del mensaje
 * de carga (con MutationObserver: lo registra aunque el hilo esté ocupado).
 *
 *   node tools/perf.mjs <url-base> [calidad=vr] [cuadros=240] [sw] [--json=salida.json]
 *
 * Con GPU (por omisión, `--use-angle=d3d11`) o por software con `sw`.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const pos = args.filter((a) => !a.startsWith('--'));
const base = pos[0] ?? 'http://localhost:5173/';
const tier = pos[1] ?? 'vr';
const FRAMES = Number(pos[2] ?? 240);
const gpu = pos[3] !== 'sw';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

// Encuadres en metros reales, coordenadas locales de la escuela (u este, v sur).
const VIEWS = [
  { name: 'fachada', eye: [50.9, 1.7, 9.8], look: [44, 3.8, -3.5] },
  { name: 'hall', eye: [41.5, 1.74, -1], look: [41.5, 1.6, -14] },
  { name: 'patio', eye: [41, 1.7, -15.5], look: [52, 2, -32] },
  { name: 'gimnasio', eye: [60, 1.7, -22.5], look: [75, 2.5, -5] },
  { name: 'calle', eye: [15, 1.6, 13], look: [15, 4, 0] },
  { name: 'aerea', eye: [40, 60, 60], look: [38, 0, -15] },
  // Adentro de ambientes cerrados: primer piso y salón de danzas.
  { name: 'aula-p1', eye: [5.5, 5.02, -6.5], look: [1, 4.2, -0.5] },
  { name: 'danzas', eye: [57.5, 8.32, -4.5], look: [51.5, 7.5, -15] },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  acceptInsecureCerts: true,
  args: [
    '--no-sandbox',
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    '--window-size=1600,900',
    ...(gpu
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']),
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warn') logs.push(`[${m.type()}] ${t.slice(0, 200)}`);
  if (t.startsWith('[precompile]')) logs.push(t);
});
await page.evaluateOnNewDocument(() => {
  const t0 = performance.now();
  const phases = [];
  window.__bootPhases = phases;
  let last = '';
  new MutationObserver(() => {
    const t = document.getElementById('boot-msg')?.textContent?.replace(/\d+\/\d+/, 'n/N') ?? '';
    if (t && t !== last) {
      phases.push([Math.round(performance.now() - t0), t]);
      last = t;
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
  // Cuadros de los primeros segundos con la escuela a la vista: si quedan
  // shaders por compilar, se pagan acá, como tirones justo al arrancar.
  const frames = [];
  window.__bootFrames = frames;
  let hiddenAt = 0;
  const tick = (t) => {
    if (!hiddenAt && document.getElementById('boot')?.classList.contains('hidden')) hiddenAt = t;
    if (hiddenAt) frames.push(t - hiddenAt);
    if (!hiddenAt || t - hiddenAt < 5000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const t0 = Date.now();
await page.goto(`${base}?seed=42&quality=${tier}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 400000,
  polling: 50,
});
const bootMs = Date.now() - t0;
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const d = gl?.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'desconocido';
});
const phases = await page.evaluate(() => window.__bootPhases);
// Primeros 5 s tras ocultar la carga: cuadros, el peor y cuántos pasan de 50 ms.
await page.waitForFunction(() => (window.__bootFrames.at(-1) ?? 0) >= 5000, { timeout: 120000, polling: 200 });
const afterBoot = await page.evaluate(() => {
  const t = window.__bootFrames;
  const d = t.slice(1).map((x, i) => x - t[i]);
  const slow = d.filter((x) => x > 50);
  return {
    frames: t.length,
    worst: Math.round(Math.max(0, ...d)),
    slow: slow.length,
    slowMs: Math.round(slow.reduce((a, b) => a + b, 0)),
    parallel: Boolean(window.__scene.getEngine().getCaps().parallelShaderCompile),
    effects: Object.keys(window.__scene.getEngine()._compiledEffects ?? {}).length,
  };
});

// Instrumentación: se envuelven el bucle de render y cada observador.
await page.evaluate(() => {
  const scene = window.__scene;
  const engine = scene.getEngine();
  const now = () => performance.now();
  const P = {
    frame: [],
    obs: new Map(),
    meshes: 0,
    rtt: 0,
    draw: 0,
    dc: 0,
    alloc: 0,
    gcs: 0,
    n: 0,
  };
  window.__perf = P;
  let tm = 0, tr = 0, td = 0, lastHeap = performance.memory?.usedJSHeapSize ?? 0;
  const loops = engine._activeRenderLoops;
  for (let i = 0; i < loops.length; i++) {
    const f = loops[i];
    loops[i] = () => {
      const a = now();
      f();
      if (P.on) P.frame.push(now() - a);
    };
  }
  const wrapObservers = (obs, tag) => {
    for (const o of obs.observers) {
      const cb = o.callback;
      const src = `${tag} ${cb.toString().replace(/\s+/g, ' ').slice(0, 90)}`;
      o.callback = (...a) => {
        const s = now();
        const r = cb(...a);
        if (P.on) P.obs.set(src, (P.obs.get(src) ?? 0) + now() - s);
        return r;
      };
    }
  };
  wrapObservers(scene.onBeforeRenderObservable, 'antes');
  wrapObservers(scene.onAfterRenderObservable, 'después');
  wrapObservers(scene.onBeforeAnimationsObservable, 'anim');
  scene.onBeforeActiveMeshesEvaluationObservable.add(() => (tm = now()));
  scene.onAfterActiveMeshesEvaluationObservable.add(() => P.on && (P.meshes += now() - tm));
  scene.onBeforeRenderTargetsRenderObservable.add(() => (tr = now()));
  scene.onAfterRenderTargetsRenderObservable.add(() => P.on && (P.rtt += now() - tr));
  scene.onBeforeDrawPhaseObservable.add(() => (td = now()));
  scene.onAfterDrawPhaseObservable.add(() => P.on && (P.draw += now() - td));
  scene.onAfterRenderObservable.add(() => {
    const h = performance.memory?.usedJSHeapSize ?? 0;
    if (P.on) {
      if (h >= lastHeap) P.alloc += h - lastHeap;
      else P.gcs++;
      P.n++;
    }
    lastHeap = h;
  });
});

async function measureView(v) {
  await page.evaluate(([e, l]) => {
    const f = window.__schoolFrame();
    const cam = window.__scene.activeCamera;
    const V3 = window.__BABYLON_Vector3;
    cam.position = new V3(f.ox - e[0], e[1], f.oz + e[2]);
    cam.setTarget(new V3(f.ox - l[0], l[1], f.oz + l[2]));
  }, [v.eye, v.look]);
  // Descarta: compilar shaders del encuadre nuevo, subir texturas.
  await new Promise((r) => setTimeout(r, 1500));
  return page.evaluate(async (frames) => {
    const P = window.__perf;
    const s = window.__scene;
    const e = s.getEngine();
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    await raf();
    P.frame = [];
    P.obs = new Map();
    P.meshes = P.rtt = P.draw = P.alloc = P.gcs = P.n = 0;
    const dc0 = e._drawCalls?.current ?? 0;
    let active = 0, tris = 0;
    P.on = true;
    for (let i = 0; i < frames; i++) {
      await raf();
      active += s.getActiveMeshes().length;
      tris += s.getActiveIndices() / 3;
    }
    P.on = false;
    const dc = ((e._drawCalls?.current ?? 0) - dc0) / frames;
    const n = Math.max(1, P.frame.length);
    const sorted = [...P.frame].sort((a, b) => a - b);
    const obs = [...P.obs.entries()]
      .map(([k, t]) => [k, t / n])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return {
      frameMs: P.frame.reduce((a, b) => a + b, 0) / n,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      meshesMs: P.meshes / n,
      rttMs: P.rtt / n,
      drawMs: P.draw / n,
      obsMs: [...P.obs.values()].reduce((a, b) => a + b, 0) / n,
      obs,
      dc: Math.round(dc),
      active: Math.round(active / frames),
      ktris: Math.round(tris / frames / 1000),
      allocKB: P.alloc / Math.max(1, P.n) / 1024,
      gcs: P.gcs,
      people: window.__people?.()?.drawn ?? 0,
    };
  }, FRAMES);
}

// Vuela para que la gravedad no mueva la cámara.
await page.keyboard.press('KeyF');
const results = {};
for (const v of VIEWS) results[v.name] = await measureView(v);
const heapMB = await page.evaluate(() => {
  window.gc?.();
  return (performance.memory?.usedJSHeapSize ?? 0) / 1048576;
});
const counts = await page.evaluate(() => {
  const s = window.__scene;
  return {
    meshes: s.meshes.length,
    materials: s.materials.length,
    textures: s.textures.length,
    observersBefore: s.onBeforeRenderObservable.observers.length,
    geometries: s.geometries.length,
  };
});

console.log(`=== ${tier.toUpperCase()} · ${renderer}`);
console.log(`arranque ${bootMs} ms · heap tras GC ${heapMB.toFixed(1)} MB · ${JSON.stringify(counts)}`);
for (let i = 0; i < phases.length; i++) {
  const d = i + 1 < phases.length ? phases[i + 1][0] - phases[i][0] : 0;
  console.log(`  ${String(phases[i][0]).padStart(6)} ms  +${String(d).padStart(5)}  ${phases[i][1]}`);
}
console.log(
  `primeros 5 s: ${afterBoot.frames} cuadros · peor ${afterBoot.worst} ms · ${afterBoot.slow} de más de 50 ms (${afterBoot.slowMs} ms) · ${afterBoot.effects} efectos · compilación paralela ${afterBoot.parallel ? 'sí' : 'no'}`,
);
console.log('');
console.log('vista       cuadro   p95   antes mallas  rtt dibujo |   dc activas ktris  KB/c gcs gente');
for (const [name, r] of Object.entries(results)) {
  console.log(
    `${name.padEnd(10)} ${r.frameMs.toFixed(2).padStart(6)} ${r.p95.toFixed(2).padStart(5)} ${r.obsMs.toFixed(2).padStart(6)} ${r.meshesMs.toFixed(2).padStart(6)} ${r.rttMs.toFixed(2).padStart(4)} ${r.drawMs.toFixed(2).padStart(6)} | ${String(r.dc).padStart(4)} ${String(r.active).padStart(7)} ${String(r.ktris).padStart(5)} ${r.allocKB.toFixed(1).padStart(5)} ${String(r.gcs).padStart(3)} ${String(r.people).padStart(5)}`,
  );
}
console.log('');
for (const [name, r] of Object.entries(results)) {
  console.log(`-- ${name}: observadores (ms/cuadro)`);
  for (const [k, t] of r.obs) console.log(`   ${t.toFixed(3).padStart(6)}  ${k}`);
}
const noise = /Babylon\.js v|WebGL: |deprecat|COSTBREAKDOWN|\[vite\]/i;
const rest = logs.filter((l) => !noise.test(l));
console.log(rest.length ? rest.slice(0, 20).join('\n') : '(consola limpia)');
if (flags.json) writeFileSync(flags.json, JSON.stringify({ tier, bootMs, afterBoot, heapMB, counts, phases, results }, null, 1));
await browser.close();
