// Renderiza el atlas de la escuela (src/world/SchoolAtlas.ts) a un PNG para revisarlo.
// Uso (desde la raíz del proyecto): node tools/atlas-preview.mjs <salida.png> [escala]
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = process.argv[2];
const scale = Number(process.argv[3] ?? 1);
const entry = resolve('src/world/SchoolAtlas.ts');
const res = await build({
  stdin: {
    contents: `import { drawAtlas, AW, AH } from ${JSON.stringify(entry.replace(/\\/g, '/'))};
      const c = document.createElement('canvas'); c.width = AW; c.height = AH;
      document.body.appendChild(c); drawAtlas(c.getContext('2d'));
      window.__atlas = c.toDataURL('image/png');`,
    resolveDir: resolve('.'),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const js = res.outputFiles[0].text;
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent('<html><body style="margin:0;background:#333"></body></html>');
await page.addScriptTag({ content: js });
await page.waitForFunction(() => window.__atlas, { timeout: 60000 });
let data = await page.evaluate(() => window.__atlas);
if (scale !== 1) {
  data = await page.evaluate(async (s) => {
    const img = new window.Image();
    img.src = window.__atlas;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }, scale);
}
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'ok ' + out);
await browser.close();
