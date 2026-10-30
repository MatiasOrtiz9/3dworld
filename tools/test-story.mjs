/**
 * La historia en el juego real (sin frases, como se juega por defecto).
 *
 * Los tests de `tests/gameStory.test.ts` juegan la historia sin navegador;
 * esto mira lo que VE el jugador en los momentos que no se pueden probar ahí:
 * la presentación de cada capítulo, el aviso de «próximo paso» al saludar a
 * alguien sin nada pendiente, el simulacro (correr tiene aviso y queda en el
 * resultado), el panel del acto donde se elige el mensaje, los créditos que
 * lo citan y el epílogo que guía a los lugares sin descubrir.
 *
 *   node tools/test-story.mjs [url-base] [carpeta-capturas]
 *
 * Para llegar rápido a cada momento, los pasos intermedios se cumplen por
 * dentro (`__game.engine`, como los tests) y sus efectos se presentan con el
 * director (`react`): puertas, sellos y avisos pasan como en el juego.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) =>
  existsSync(p),
);
const base = process.argv[2] ?? 'http://localhost:5190/';
const shotDir = process.argv[3] ?? 'shots';
mkdirSync(shotDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FALL'}  ${name}${extra ? '  — ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (page, sel) =>
  page.$eval(sel, (el) => {
    const s = window.getComputedStyle(el);
    return !el.hidden && !el.classList.contains('hidden') && s.display !== 'none' && Number(s.opacity) > 0.05;
  });
const toasts = (page) => page.$$eval('#toasts .toast', (els) => els.map((e) => e.textContent ?? ''));

/**
 * Cumple por dentro los objetivos principales hasta que el primero sea `stop`
 * (las actividades se dan por bien hechas). Devuelve los ids cumplidos.
 */
const fastForward = (page, stop) =>
  page.evaluate((stop) => {
    const g = window.__game;
    const e = g.engine;
    const done = [];
    for (let guard = 0; guard < 60; guard++) {
      const o = e.mainObjectives()[0];
      if (!o || o.id === stop) break;
      let fx = [];
      const t = o.target;
      if (t.kind === 'talk') fx = e.silentTalk(t.npc).effects;
      else if (t.kind === 'interact') fx = e.interact(t.id);
      else if (t.kind === 'reach') fx = e.enterPlace(t.place);
      else if (t.kind === 'collect') for (const id of t.ids) fx.push(...e.interact(id));
      else if (t.kind === 'spot') {
        const s = g.targetOf(o).spot;
        fx = e.atSpot(s.u, s.v, s.level);
      }
      const acts = fx.filter((x) => x.do === 'activity').map((x) => x.id);
      g.react(fx.filter((x) => x.do !== 'activity'));
      for (const id of acts) g.react(e.activityResult(id, true, false));
      if (t.kind === 'interact' && !e.done(o.id)) {
        // Objeto que abre una actividad (punto limpio, vitrina): el resultado la cumple.
        const id = { puntoLimpio: 'reciclaje', vitrina: 'trivia' }[t.id];
        if (id) g.react(e.activityResult(id, true, false));
      }
      done.push(o.id);
    }
    return done;
  }, stop);

/** Pone al jugador a 1,4 m de un personaje, mirándolo, y aprieta E. */
const greet = async (page, npc) => {
  await page.evaluate((npc) => {
    const r = window.__people().character(npc).position();
    const f = window.__player.feet();
    const dx = f.x - r.x;
    const dz = f.z - r.z;
    const d = Math.hypot(dx, dz) || 1;
    window.__player.teleport({ x: r.x + (dx / d) * 1.4, y: r.y, z: r.z + (dz / d) * 1.4 }, { x: r.x, y: r.y + 1.4, z: r.z });
  }, npc);
  await sleep(500);
  await page.keyboard.press('KeyE');
  await sleep(700);
};

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 800 });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
});
await page.goto(`${base}${base.includes('?') ? '&' : '?'}seed=42&titulo=1&libre=0&hud=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 240000, polling: 200 });
await sleep(1200);
await page.evaluate(() => window.localStorage.removeItem('cimdip-recorrido40-v1'));

// --- prólogo: el capítulo se presenta ---------------------------------------
await page.click('#title-start');
await sleep(1500);
const brief = await page.$eval('#chapter-brief', (el) => (el.hidden ? '' : el.textContent ?? ''));
check('el prólogo se presenta (narrador, bajo el título)', /40 años/.test(brief), brief);
await page.screenshot({ path: `${shotDir}/s1-prologo.png` });

// --- saludar a Rubén abre; saludar a Lola recuerda el próximo paso ---------
await greet(page, 'ruben');
check('saludar a Rubén cumple el objetivo', await page.evaluate(() => window.__game.engine.done('p.portero')));
await sleep(4200);
await greet(page, 'lola');
const t1 = await toasts(page);
check('saludar sin nada pendiente recuerda el próximo paso', t1.some((t) => /Próximo paso/.test(t) && /Recepción/.test(t)), t1.join(' | '));
await page.screenshot({ path: `${shotDir}/s2-proximo-paso.png` });

// --- capítulo 1: presentación con el porqué ---------------------------------
await fastForward(page, 'c1.maker');
await sleep(600);
const brief1 = await page.$eval('#chapter-brief', (el) => (el.hidden ? '' : el.textContent ?? ''));
check('el capítulo 1 dice qué hay que juntar', /Tres sellos/.test(brief1), brief1);
await page.screenshot({ path: `${shotDir}/s3-capitulo1.png` });

// --- simulacro: correr tiene aviso y queda en el resultado -------------------
await fastForward(page, 'c3.laura');
await sleep(600);
const title3 = await page.$eval('#obj-list li', (el) => el.textContent ?? '');
check('el simulacro pide saludar a la Seño Laura', /Saludá a la Seño Laura/.test(title3), title3);
await greet(page, 'laura');
await sleep(800);
check('empieza el simulacro', await page.evaluate(() => Boolean(window.__game.drill)));
// Correr: 0,22 m por cuadro (unos 13 m/s) durante un segundo y medio, por el pasillo.
await page.evaluate(
  () =>
    new Promise((res) => {
      const p0 = window.__player.feet();
      let k = 0;
      const tick = () => {
        const f = window.__player.feet();
        const step = k < 45 ? 0.22 : -0.22;
        window.__player.teleport({ x: f.x, y: p0.y, z: f.z + step });
        if (++k < 90) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    }),
);
await sleep(300);
const t2 = await toasts(page);
check('correr en el simulacro tiene aviso', t2.some((t) => /Sin correr/.test(t)), t2.join(' | '));
await page.screenshot({ path: `${shotDir}/s4-sin-correr.png` });
await page.evaluate(() => {
  const g = window.__game;
  const t = g.targetOf(g.engine.mainObjectives()[0]);
  window.__player.teleport(t.world);
});
await sleep(1500);
const t3 = await toasts(page);
check('el resultado del simulacro cuenta las corridas', t3.some((t) => /punto de encuentro/.test(t) && /corriste/.test(t)), t3.join(' | '));
await page.screenshot({ path: `${shotDir}/s5-encuentro.png` });

// --- el acto: el jugador elige su mensaje -----------------------------------
await fastForward(page, 'c5.acto');
await sleep(800);
await page.evaluate(() => {
  const g = window.__game;
  const t = g.targetOf(g.engine.mainObjectives()[0]);
  window.__player.teleport({ x: t.world.x, y: t.world.y - 1.9, z: t.world.z });
});
await page.waitForFunction(() => document.getElementById('act-title')?.textContent === 'Tu mensaje para el acto', { timeout: 20000, polling: 200 }).catch(() => {});
await sleep(400);
const act = await page.evaluate(() => ({
  title: document.getElementById('act-title')?.textContent,
  choices: [...document.querySelectorAll('#act-choices .choice span')].map((s) => s.textContent),
  dialogue: !document.getElementById('dialogue')?.classList.contains('hidden'),
}));
check('en el acto se elige el mensaje (sin diálogo)', act.title === 'Tu mensaje para el acto' && act.choices.length === 3 && !act.dialogue, JSON.stringify(act));
await page.screenshot({ path: `${shotDir}/s6-acto.png` });
await page.keyboard.press('Digit2');
await page.waitForFunction(() => !document.getElementById('credits')?.classList.contains('hidden'), { timeout: 20000, polling: 200 }).catch(() => {});
await sleep(1200);
const credits = await page.evaluate(() => ({
  speech: document.getElementById('credits-speech')?.textContent,
  stats: [...document.querySelectorAll('#credits-summary span')].map((s) => s.textContent),
}));
check('los créditos citan el mensaje elegido', /Los espacios/.test(credits.speech ?? ''), JSON.stringify(credits));
check('los créditos cuentan las insignias', credits.stats.includes('INSIGNIAS'), credits.stats.join(','));
await page.screenshot({ path: `${shotDir}/s7-creditos.png` });

// --- epílogo: a descubrir lugares -------------------------------------------
await page.click('#credits-close');
await sleep(1500);
const epi = await page.$eval('#obj-list li', (el) => el.textContent ?? '');
check('el epílogo guía a los lugares sin descubrir', /Descubrí los lugares/.test(epi) && /Próximo:/.test(epi), epi);
const marker = await page.evaluate(() => Boolean(window.__game.mainTarget()));
check('el rombo dorado marca un lugar nuevo', marker);
await page.screenshot({ path: `${shotDir}/s8-epilogo.png` });

check('sin errores en la consola', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FALL')) ? 1 : 0);
