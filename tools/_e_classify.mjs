// (temporal, paquete E) Clasifica los triángulos de la granja por zona con la caja de cada instancia.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:5190/?seed=42&quality=vr&hud=0';
const out = process.argv[3] ?? 'classify.json';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 300000, polling: 500 });
const res = await page.evaluate(async () => {
  const L = await import('/src/world/SchoolLayout.ts');
  const f = window.__schoolFrame();
  const scene = window.__scene;
  const keys = {};
  const roomsByLevel = [0, 1, 2].map((l) => L.ROOMS.filter((r) => (r.level ?? 0) === l && r.roofed));
  const cu = 40, cv = -20;
  for (const m of scene.meshes) {
    if (!m.name.includes('|')) continue;
    const st = m._thinInstanceDataStorage;
    const n = m.thinInstanceCount;
    if (!n || !st?.matrixData) continue;
    const tris = m.getTotalIndices() / 3;
    const d = st.matrixData;
    const k = (keys[m.name] = { tris, n, zones: {} });
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      const x = d[o + 12], y = d[o + 13], z = d[o + 14];
      const hx = 0.5 * (Math.abs(d[o]) + Math.abs(d[o + 4]) + Math.abs(d[o + 8]));
      const hy = 0.5 * (Math.abs(d[o + 1]) + Math.abs(d[o + 5]) + Math.abs(d[o + 9]));
      const hz = 0.5 * (Math.abs(d[o + 2]) + Math.abs(d[o + 6]) + Math.abs(d[o + 10]));
      const u = f.ox - x, v = z - f.oz;
      let zone;
      if (!L.inLot(u, v)) {
        const a = Math.atan2(v - cv, u - cu);
        zone = 'city:' + (Math.abs(a) < Math.PI / 4 ? 'E' : Math.abs(a) > (3 * Math.PI) / 4 ? 'W' : a > 0 ? 'S' : 'N');
      } else {
        zone = 'shell';
        for (let lvl = 0; lvl < 3 && zone === 'shell'; lvl++) {
          const y0 = L.LEVEL_Y[lvl];
          if (y - hy < y0 - 0.35 || y + hy > y0 + 3.3 + 0.35) continue;
          for (const r of roomsByLevel[lvl]) {
            const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => L.inPoly(r.poly, u + a * hx, v + b * hz));
            if (ok) { zone = 'int:' + lvl + ':' + r.id; break; }
          }
        }
      }
      k.zones[zone] = (k.zones[zone] ?? 0) + tris;
    }
  }
  return keys;
});
writeFileSync(out, JSON.stringify(res));
await browser.close();
