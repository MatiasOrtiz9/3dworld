import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const IWER = readFileSync('node_modules/iwer/build/iwer.min.js', 'utf8');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 800 });
page.on('console', (m) => { const t = m.text(); if (!t.startsWith('COST')) console.log('[c]', m.type(), t.slice(0, 250)); });
page.on('requestfailed', (r) => console.log('requestfailed', r.url()));
page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) console.log('request', r.url()); });
await page.evaluateOnNewDocument(IWER);
await page.evaluateOnNewDocument(() => { const d = new window.IWER.XRDevice(window.IWER.metaQuest3); d.installRuntime({ forceInstall: true }); window.__xrDevice = d; });
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /Entrar/.test(document.getElementById('btn-vr')?.textContent ?? '') && !document.getElementById('btn-vr').disabled, { timeout: 240000, polling: 200 });
await page.click('#btn-vr');
await page.waitForFunction(() => window.__scene?.activeCamera?.getClassName() === 'WebXRCamera', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
const r = await page.evaluate(() => {
  return JSON.stringify({
    same: window.XRRigidTransform === window.IWER.XRRigidTransform,
    iwerHas: typeof window.IWER.XRRigidTransform,
    nativeName: window.XRRigidTransform?.name,
    xrSame: navigator.xr && navigator.xr.constructor && navigator.xr.constructor.name,
  });
});
console.log(r);
await browser.close();
