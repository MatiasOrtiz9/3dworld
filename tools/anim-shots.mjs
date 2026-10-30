/**
 * Secuencias de cuadros de la gente para juzgar la animación (pies que
 * patinan, poses, transiciones), con la cámara QUIETA al costado de alguien.
 *
 * Uso: node tools/anim-shots.mjs <url> <carpeta> [fase] [modo]
 *   fase: entrada | recreo | clase | salida | acto (por defecto, recreo)
 *   modo: walk (alguien caminando, por defecto) | idle (alguien parado) |
 *         sit (alguien sentado) | run (alguien corriendo)
 *
 * Elige a la persona del modo pedido más cercana al centro del patio, pone
 * la cámara a 3,6 m de su costado (a la altura de la cadera, mirando su
 * camino) y guarda 10 cuadros cada 110 ms, recortados alrededor de ella.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:5203/', outDir = 'shots/anim', phase = 'recreo', mode = 'walk'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 300000, polling: 500 });
// Volando: caminando, la gravedad y la colisión moverían la cámara.
await page.keyboard.press('KeyF');
await page.evaluate((ph) => window.__people().setSchoolPhase(ph), phase);
await new Promise((r) => setTimeout(r, 6000));

// Elige a alguien y deja la cámara fija al costado de su camino.
const pick = await page.evaluate((m) => {
  const pop = window.__people();
  const f = window.__schoolFrame();
  const ok = (a) => {
    if (!a.alive || a.hidden) return false;
    const b = a.anim.base;
    if (m === 'walk') return (b === 'walk' || b === 'run') && a.speed > 0.6 && a.speed < 1.8 && a.level === 0;
    if (m === 'run') return a.speed > 2 && a.level === 0;
    if (m === 'sit') return !!a.seat;
    return b === 'idle' && a.speed < 0.05 && !a.seat && a.level === 0;
  };
  const list = pop.sim.agents.filter(ok);
  if (list.length === 0) return null;
  const a = list[Math.floor(list.length / 2)];
  const x = f.ox - a.u;
  const z = f.oz + a.v;
  const fx = Math.sin(a.yaw);
  const fz = Math.cos(a.yaw);
  // Delante en su camino (lo que va a recorrer en ~1 s) y 3,6 m al costado.
  const ahead = m === 'walk' || m === 'run' ? a.speed * 0.55 : 0;
  const cx = x + fx * ahead + fz * 3.6;
  const cz = z + fz * ahead - fx * 3.6;
  const scene = window.__scene;
  const cam = scene.activeCamera;
  const V3 = window.__BABYLON_Vector3;
  window.__animPick = a;
  cam.position = new V3(cx, a.y + (m === 'sit' ? 1.1 : 1.0), cz);
  cam.setTarget(new V3(x + fx * ahead, a.y + 0.7, z + fz * ahead));
  return { id: a.id, role: a.role, age: a.look.age, speed: a.speed, base: a.anim.base, n: list.length };
}, mode);
console.log('persona', JSON.stringify(pick));
if (pick) {
  for (let i = 0; i < 10; i++) {
    await page.screenshot({ path: `${outDir}/${mode}-${String(i).padStart(2, '0')}.png`, clip: { x: 340, y: 60, width: 600, height: 600 } });
    const st = await page.evaluate(() => {
      const a = window.__animPick;
      const an = a.anim;
      return `${an.base}${an.w < 1 ? `←${an.prev} ${an.w.toFixed(2)}` : ''} v ${a.speed.toFixed(2)} amp ${an.amp.toFixed(2)} fwd ${an.fwd.toFixed(2)} run ${an.run.toFixed(2)} fase ${(an.phase / (Math.PI * 2)).toFixed(2)} giro ${a.yawV.toFixed(2)}`;
    });
    console.log(i, st);
    await new Promise((r) => setTimeout(r, 110));
  }
}
console.log(logs.slice(0, 10).join('\n') || '(sin errores)');
await browser.close();
