/**
 * Captura encuadrando una manzana de un tipo concreto.
 *
 * Elegir coordenadas a mano para mirar una fachada es adivinar: se termina
 * dentro de un edificio o apuntando al canal. Esto lee el plano generado, busca
 * una manzana del tipo pedido y coloca la camara en la vereda de enfrente, a
 * altura de ojos, mirandola de frente.
 *
 * Uso: node tools/shoot-block.mjs <url> <salida.png> residential [distancia] [cara]
 *
 * La cara por defecto es 'north': a mediodia el sol esta en +X/+Z, asi que es
 * la que recibe luz directa. Fotografiar una fachada a contraluz no dice nada
 * del detalle que tiene.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const [url, out, kind = 'residential', dist = '16', face = 'north'] = process.argv.slice(2);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
  timeout: 240000,
  polling: 200,
});
await new Promise((r) => setTimeout(r, 1200));

const framed = await page.evaluate(
  ([kind, dist, face]) => {
    const plan = window.__plan();
    if (!plan) return null;
    // La manzana del tipo pedido mas cercana al centro: asi el fondo tiene
    // ciudad detras y no el borde vacio del terreno.
    const cands = plan.blocks
      .filter((b) => b.kind === kind)
      .sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz));
    if (!cands.length) return null;
    const b = cands[0];
    const half = b.width / 2;
    // La distancia se mide desde la CARA del edificio y se topa al ancho de la
    // calle: pedir 26 m con calles de 15 m metia la camara dentro de la manzana
    // de enfrente, y la foto salia pegada a la fachada equivocada.
    const d = Math.min(Number(dist), plan.streetWidth * 0.92);
    const north = face === 'north';
    // Parado en la calle de enfrente, mirando la fachada de frente.
    const camX = b.cx - 5;
    const camZ = north ? b.cz + half + d : b.cz - half - d;
    const cam = window.__scene.activeCamera;
    cam.position.set(camX, 1.68, camZ);
    // Se apunta a media altura del edificio para que entren planta baja y
    // varios pisos en el mismo encuadre.
    cam.setTarget(
      new window.__BABYLON_Vector3(b.cx, Math.min(b.height * 0.45, 11), north ? b.cz + half : b.cz - half),
    );
    return {
      kind: b.kind,
      cx: b.cx,
      cz: b.cz,
      height: Math.round(b.height),
      camX,
      camZ,
      face,
      d,
    };
  },
  [kind, dist, face],
);

if (!framed) {
  console.log(`No hay ninguna manzana de tipo "${kind}" en esta semilla.`);
} else {
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: out });
  console.log(
    `${framed.kind} en (${Math.round(framed.cx)}, ${Math.round(framed.cz)}), ` +
      `${framed.height} m de alto · cara ${framed.face} · d=${framed.d.toFixed(1)} m · ` +
      `camara en (${Math.round(framed.camX)}, ${Math.round(framed.camZ)})`,
  );
  console.log(`Guardado: ${out}`);
}
await browser.close();
