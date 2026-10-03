/**
 * Prueba de humo de la interactividad.
 *
 * Compilar no prueba nada: un menú puede compilar y no abrirse nunca. Esto
 * ejercita de verdad los caminos que toca el jugador — la pantalla de título,
 * el primer objetivo, el menú de pausa, cambiar de modo, caminar — y falla
 * ruidosamente si alguno se rompe.
 *
 *   node tools/test-interaction.mjs [url-base] [carpeta-capturas] [sw]
 *
 * Tres pasadas:
 *  1. Modo herramienta (como lo ven las capturas): sin título, todo abierto.
 *     Caminar, volar, gente, pájaros.
 *  2. Modo jugador (`?titulo=1&libre=0&hud=1`): título, partida nueva,
 *     objetivo, saludar a Rubén con E (el juego no tiene frases: abre la
 *     escuela sin diálogo, sin comentarios y sin voz), menú de pausa.
 *  3. Con frases (`&frases=1`, ver src/game/story/phrases.ts): la misma E
 *     sobre Rubén abre el diálogo de antes, con voz.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const base = process.argv[2] ?? 'http://localhost:5190/';
const shotDir = process.argv[3] ?? 'shots';
const gpu = process.argv[4] !== 'sw';
mkdirSync(shotDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: gpu
    ? ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const results = [];
const errors = [];
const check = (name, ok, extra = '') =>
  results.push(`${ok ? 'OK  ' : 'FALL'}  ${name}${extra ? '  — ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let k = 0;
        const tick = () => (++k >= n ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
const visible = (page, sel) =>
  page.$eval(sel, (el) => {
    const s = window.getComputedStyle(el);
    return !el.hidden && !el.classList.contains('hidden') && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
  });

/** Cuenta las voces que pide el juego (el audio en sí no se toca). */
const countVoices = (page) =>
  page.evaluate(() => {
    window.__voices = 0;
    const snd = window.__sound;
    const voice = snd.voice.bind(snd);
    snd.voice = (...a) => {
      window.__voices++;
      return voice(...a);
    };
  });

/** Pone al jugador a 1,5 m de Rubén (del lado de Laprida), mirándolo. */
const faceRuben = async (page) => {
  await page.evaluate(() => {
    const r = window.__people().character('ruben').position();
    window.__player.teleport({ x: r.x, y: r.y, z: r.z + 1.5 }, { x: r.x, y: r.y + 1.4, z: r.z });
  });
  await frames(page, 20);
  return page.$eval('#prompt-verb', (el) => el.textContent ?? '');
};

async function open(query, tag) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 800 });
  page.on('pageerror', (e) => errors.push(`[${tag}] [pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${tag}] [console.error] ${m.text()}`);
  });
  const url = base + (base.includes('?') ? '&' : '?') + query;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), {
    timeout: 240000,
    polling: 200,
  });
  await sleep(1200);
  return page;
}

// ============================================================ 1. herramienta
{
  const page = await open('seed=42', 'herramienta');

  // --- cambio de modo caminar/volar ---
  const modeBefore = await page.$eval('#btn-mode', (el) => el.textContent);
  await page.keyboard.press('KeyF');
  await sleep(300);
  const modeAfter = await page.$eval('#btn-mode', (el) => el.textContent);
  check('la tecla F cambia de modo', modeBefore !== modeAfter, `${modeBefore} -> ${modeAfter}`);

  // --- gravedad: volver a caminar deja al jugador a altura de ojos ---
  await page.keyboard.press('KeyF');
  await sleep(600);
  const y = await page.evaluate(() => window.__scene.activeCamera.position.y);
  check('altura de ojos al caminar (~1,7 m)', y > 1.2 && y < 2.6, `y = ${y.toFixed(2)}`);

  // --- caminar hacia adelante mueve al jugador ---
  // Se espera por CUADROS, no por tiempo: el movimiento se integra por cuadro y
  // dt está topado a 50 ms para que un tirón no atraviese una pared.
  const pos = () =>
    page.evaluate(() => {
      const p = window.__scene.activeCamera.position;
      return { x: p.x, z: p.z };
    });
  const before = await pos();
  await page.keyboard.down('KeyW');
  await frames(page, 12);
  await page.keyboard.up('KeyW');
  const after = await pos();
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  const fps = await page.evaluate(() => window.__scene.getEngine().getFps());
  check('caminar desplaza al jugador', moved > 0.15, `${moved.toFixed(2)} m en 12 cuadros a ${fps.toFixed(0)} fps`);

  // --- la escuela tiene gente y se dibuja ---
  await frames(page, 10);
  const people = await page.evaluate(() => {
    const p = window.__people();
    return p ? { n: p.population, drawn: p.drawn, phase: p.phase } : null;
  });
  check('hay gente en la escuela', Boolean(people && people.n > 20), JSON.stringify(people));
  check('se dibuja gente en la vista inicial', Boolean(people && people.drawn > 0));

  // --- los personajes del juego existen ---
  const named = await page.evaluate(() =>
    ['ruben', 'lola', 'ines'].map((id) => Boolean(window.__people()?.character(id))),
  );
  check('personajes de la historia presentes', named.every(Boolean), named.join(','));

  // --- los pájaros se mueven ---
  const bird = () =>
    page.evaluate(() => {
      // `life-birdBody` desde que los pájaros pasaron a src/world/life (antes, `birdBodySrc`).
      const m = window.__scene.meshes.find((x) => x.name === 'life-birdBody' || x.name === 'birdBodySrc');
      return m?._thinInstanceDataStorage?.matrixData?.[12] ?? null;
    });
  const m1 = await bird();
  await frames(page, 12);
  const m2 = await bird();
  check('los pájaros se mueven', m1 !== null && m2 !== null && m1 !== m2, `x: ${m1} -> ${m2}`);

  // --- el HUD no tapa las capturas en modo herramienta ---
  const hudHidden = await page.evaluate(() => document.body.classList.contains('hud-hidden'));
  check('sin HUD en modo herramienta', hudHidden);

  await page.screenshot({ path: `${shotDir}/i1-caminando.png` });
  await page.close();
}

// ============================================================ 2. jugador
{
  const page = await open('seed=42&titulo=1&libre=0&hud=1', 'jugador');

  check('pantalla de título visible', await visible(page, '#title'));
  await page.screenshot({ path: `${shotDir}/i2-titulo.png` });

  await page.click('#title-start');
  await sleep(2500);
  check('el título se cierra al empezar', !(await visible(page, '#title')));

  const obj = await page.$eval('#obj-title', (el) => el.textContent?.trim() ?? '');
  check('hay un objetivo', obj.length > 3, obj);
  const progressText = await page.evaluate(() => window.__director()?.progressText ?? '');
  check('el director informa el avance', /sellos/.test(progressText), progressText);

  // Al empezar, el jugador queda frente al portal sobre Laprida.
  const feet = await page.evaluate(() => window.__player.feet());
  check('el jugador empieza a nivel de vereda', Math.abs(feet.y) < 0.6, `y = ${feet.y.toFixed(2)}`);
  await page.screenshot({ path: `${shotDir}/i3-objetivo.png` });

  // --- sin frases (por defecto): nadie habla ---
  // Lo pidió el usuario ("no quiero que nadie me hable"). El objetivo no pide
  // hablar, a la gente se la saluda y saludar a Rubén abre la escuela igual,
  // sin diálogo, sin comentarios y sin voz.
  const firstItem = await page.$eval('#obj-list li', (el) => el.textContent ?? '');
  check('el objetivo no pide hablar', /^Saludá a Rubén/.test(firstItem) && !/habl/i.test(firstItem), firstItem);
  check('nadie habla al empezar', !(await visible(page, '#dialogue')) && !(await visible(page, '#bark')));
  await countVoices(page);
  const verb = await faceRuben(page);
  check('a la gente se la saluda (no se le habla)', verb === 'Saludar', verb);
  await page.keyboard.press('KeyE');
  await sleep(700);
  const greet = await page.evaluate(() => {
    const g = window.__director();
    return { portero: g.engine.done('p.portero'), entrada: g.engine.zone('entrada'), greet: g.lastGreeting, modal: g.modal, voices: window.__voices };
  });
  const quiet = !(await visible(page, '#dialogue')) && !(await visible(page, '#bark'));
  check(
    'saludar a Rubén abre la escuela sin una sola frase',
    greet.portero && greet.entrada && greet.greet?.npc === 'ruben' && greet.greet.due && greet.modal === null && greet.voices === 0 && quiet,
    JSON.stringify(greet),
  );
  await page.screenshot({ path: `${shotDir}/i3b-saludo.png` });

  // --- menú de pausa ---
  await page.keyboard.press('Escape');
  await sleep(500);
  check('Esc abre el menú', await visible(page, '#pause'));
  await page.screenshot({ path: `${shotDir}/i4-pausa.png` });
  await page.keyboard.press('Escape');
  await sleep(500);
  check('Esc cierra el menú', !(await visible(page, '#pause')));

  await page.close();
}

// ============================================================ 3. con frases
{
  // El interruptor trae todo de vuelta: la misma E sobre Rubén abre el diálogo de antes.
  const page = await open('seed=42&titulo=1&libre=0&hud=1&frases=1', 'frases');
  await page.click('#title-start');
  await sleep(2500);
  await countVoices(page);
  const verb = await faceRuben(page);
  check('con ?frases=1 a la gente se le habla', verb === 'Hablar', verb);
  await page.keyboard.press('KeyE');
  await sleep(900);
  const name = await page.$eval('#dlg-name', (el) => el.textContent ?? '');
  const voices = await page.evaluate(() => window.__voices);
  check('con ?frases=1 Rubén contesta con su diálogo y su voz', (await visible(page, '#dialogue')) && name === 'Rubén' && voices > 0, `${name} · ${voices} voces`);
  await page.screenshot({ path: `${shotDir}/i5-frases.png` });
  for (let i = 0; i < 12 && (await visible(page, '#dialogue')); i++) {
    await page.keyboard.press('KeyE');
    await sleep(450);
  }
  check('con ?frases=1 el diálogo abre la escuela', await page.evaluate(() => window.__director().engine.zone('entrada')));
  await page.close();
}

console.log('=== INTERACCIÓN ===');
for (const r of results) console.log('  ' + r);
console.log('');
console.log(`=== ERRORES DE CONSOLA (${errors.length}) ===`);
console.log(errors.slice(0, 12).join('\n') || '  (ninguno)');

await browser.close();
process.exit(results.some((r) => r.startsWith('FALL')) ? 1 : 0);
