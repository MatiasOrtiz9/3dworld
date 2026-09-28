// Sonda temporal de auditoria (artefactos-terreno): capturas encuadradas.
// Solo lectura. Se borra al terminar la auditoria.
import puppeteer from 'puppeteer-core';

const url = 'http://localhost:5174/?seed=42&quality=high';
const dir = 'd:/proyectos-3d/ciudad-2050/shots/';
const shots = [
  ['audit-artefactos-terreno-01-canal-aereo', [45, 40, -5], [-10, 0, -50.8]],
  ['audit-artefactos-terreno-02-puente-x', [124, 28, -98], [124, 0, -142.5]],
  ['audit-artefactos-terreno-03-mercado', [85, 22, 30], [57, 12, 0]],
  ['audit-artefactos-terreno-04-calle-cenital', [-30, 18, 16], [-18, 0, 28.5]],
  ['audit-artefactos-terreno-05-huerta-borde-a', [66, 26, 188], [78, 0, 207]],
  ['audit-artefactos-terreno-06-huerta-borde-b', [66, 26, 188], [78, 0, 207]],
  ['audit-artefactos-terreno-07-borde-mapa-alto', [300, 40, 0], [400, 0, 0]],
  ['audit-artefactos-terreno-08-borde-mapa-ojos', [345, 1.68, 10], [420, 1.0, 10]],
  ['audit-artefactos-terreno-09-azotea', [14, 30, -154], [0, 17, -171]],
];

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1024,576'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 576 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 240000, polling: 300 });
  await new Promise((r) => setTimeout(r, 1000));
  // Pose forzada cada cuadro (la gravedad del modo caminar la bajaria).
  await page.evaluate(() => {
    const scene = window.__scene;
    window.__pose = null;
    scene.onBeforeRenderObservable.add(() => {
      const p = window.__pose;
      if (!p) return;
      const cam = scene.activeCamera;
      cam.position.set(p[0][0], p[0][1], p[0][2]);
      cam.setTarget(new window.__BABYLON_Vector3(p[1][0], p[1][1], p[1][2]));
    });
  });
  for (const [name, cam, tgt] of shots) {
    await page.evaluate((c, t) => { window.__pose = [c, t]; }, cam, tgt);
    await new Promise((r) => setTimeout(r, name.endsWith('-b') ? 3200 : 2600));
    const clock = await page.evaluate(() => (window.__windClock ? window.__windClock() : -1));
    await page.screenshot({ path: `${dir}${name}.png` });
    console.log(name, 'windClock', clock);
  }
} finally {
  await browser.close();
}
