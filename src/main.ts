import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// Efectos secundarios de Babylon: registran componentes que usamos.
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';

import { City } from './world/City';
import { Environment, formatHour } from './world/Environment';
import { QualityManager, TIER_ORDER, type QualityTier } from './core/QualityManager';
import { createFlyCamera } from './player/FlyCamera';
import { RenderPipeline } from './core/RenderPipeline';
import { PlayerController, type MoveMode } from './player/PlayerController';
import { Life } from './world/Life';
import { Crowd } from './world/Crowd';
import { Inspector } from './ui/Inspector';
import { Soundscape } from './audio/Soundscape';
import { isVrSupported } from './vr/isVrSupported';
import { seedFromString } from './utils/rng';

// ---------------------------------------------------------------- referencias

const canvas = document.getElementById('render') as HTMLCanvasElement;
const boot = document.getElementById('boot') as HTMLDivElement;
const bootMsg = document.getElementById('boot-msg') as HTMLParagraphElement;
const bootBar = document.getElementById('boot-bar') as HTMLElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
const helpEl = document.getElementById('help') as HTMLDivElement;
const btnVr = document.getElementById('btn-vr') as HTMLButtonElement;
const btnQuality = document.getElementById('btn-quality') as HTMLButtonElement;
const timeSlider = document.getElementById('time-slider') as HTMLInputElement;
const timeLabel = document.getElementById('time-label') as HTMLSpanElement;
const btnRegen = document.getElementById('btn-regen') as HTMLButtonElement;
const btnMode = document.getElementById('btn-mode') as HTMLButtonElement;
const btnEnergy = document.getElementById('btn-energy') as HTMLButtonElement;
const btnSound = document.getElementById('btn-sound') as HTMLButtonElement;
const energyEl = document.getElementById('energy') as HTMLDivElement;
const helpWalk = document.getElementById('help-walk') as HTMLDivElement;
const helpFly = document.getElementById('help-fly') as HTMLDivElement;

const progress = (pct: number, msg?: string) => {
  bootBar.style.width = `${pct}%`;
  if (msg) bootMsg.textContent = msg;
  // Cede el hilo para que el navegador pinte el avance.
  return new Promise((r) => requestAnimationFrame(() => r(undefined)));
};

// -------------------------------------------------------------------- estado

let city: City | null = null;
let environment: Environment | null = null;
let life: Life | null = null;
let crowd: Crowd | null = null;
let player: PlayerController | null = null;
let inspector: Inspector | null = null;
let hour = 13;
// La semilla se puede fijar por URL (?seed=1234 o ?seed=cualquier-texto).
// Sirve para volver a una ciudad concreta: comparar cambios, sacar capturas
// equivalentes, o llevar a una exposición siempre la misma ciudad.
const seedParam = new URLSearchParams(location.search).get('seed');
let seed = seedParam
  ? /^\d+$/.test(seedParam)
    ? Number(seedParam) >>> 0
    : seedFromString(seedParam)
  : seedFromString(`ciudad-2050-${Date.now() % 100000}`);

// -------------------------------------------------------------------- arranque

const engine = new Engine(canvas, true, {
  antialias: true,
  stencil: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
});
engine.setHardwareScalingLevel(1);

const scene = new Scene(engine);
// La ciudad es estática: avisarle a Babylon ahorra mucho trabajo por cuadro.
scene.autoClear = true;
scene.autoClearDepthAndStencil = true;
// Se activa recién después de armar la escena: si se bloquea antes, los
// materiales no incorporan los defines del generador de sombras.
scene.blockMaterialDirtyMechanism = false;
scene.skipPointerMovePicking = true;

// ?quality=vr|balanced|high fuerza un perfil. Sirve para medir el presupuesto
// del visor desde una notebook, sin depender del autodetectado.
const qualityParam = new URLSearchParams(location.search).get('quality') as QualityTier | null;
const initialTier: QualityTier =
  qualityParam && TIER_ORDER.includes(qualityParam)
    ? qualityParam
    : QualityManager.suggestInitial();
const quality = new QualityManager(engine, scene, initialTier);
const camera = createFlyCamera(scene, canvas);

const renderPipeline = new RenderPipeline(scene, camera);

// El audio arranca suspendido: ningún navegador deja sonar nada hasta que haya
// un gesto del usuario. Se reanuda con el primer clic o tecla.
const sound = new Soundscape();
const wakeAudio = () => void sound.resume();
window.addEventListener('pointerdown', wakeAudio, { once: true });
window.addEventListener('keydown', wakeAudio, { once: true });

// Gancho de depuración: deja que herramientas externas (tools/shoot.mjs) muevan
// la cámara para capturar la ciudad desde ángulos concretos.
Object.assign(window as unknown as Record<string, unknown>, {
  __scene: scene,
  __BABYLON_Vector3: Vector3,
  // El plano, para que las herramientas puedan encuadrar una manzana concreta
  // por tipo en vez de adivinar coordenadas a mano.
  __plan: () => city?.plan ?? null,
  // Conmutadores para medir por ablación cuánto cuesta cada efecto. Sin esto,
  // atribuir el coste entre sombras, oclusión ambiental y bloom es adivinar.
  __setShadows: (on: boolean) => {
    if (!environment || !city) return;
    if (on) environment.enableShadows(city.shadowCasters, quality.profile.shadowResolution || 1024);
    else environment.disableShadows();
  },
  __setPost: (mode: 'off' | 'lite' | 'balanced' | 'high') => renderPipeline.apply(mode),
  __windClock: () => city?.windClock ?? -1,
});

/** Construye (o reconstruye) la ciudad completa. */
async function buildCity(newSeed: number): Promise<void> {
  await progress(10, 'Trazando la ciudad…');

  scene.blockMaterialDirtyMechanism = false;
  life?.dispose();
  crowd?.dispose();
  player?.dispose();
  inspector?.dispose();
  life = null;
  crowd = null;
  player = null;
  inspector = null;
  city?.dispose();
  environment?.dispose();
  city = null;
  environment = null;

  const profile = quality.profile;

  await progress(30, 'Levantando edificios y vegetación…');
  city = new City(scene, newSeed, {
    gridSize: profile.gridSize,
    greenDensity: profile.greenDensity,
    highDetailFoliage: profile.highDetailFoliage,
    highDetailStreet: profile.highDetailStreet,
  });

  await progress(55, 'Calculando el cielo…');
  environment = new Environment(scene, city.plan.extent);
  applyTime(hour);

  if (profile.shadows) {
    await progress(65, 'Proyectando sombras…');
    environment.enableShadows(city.shadowCasters, profile.shadowResolution);
  }

  // IBL desde la propia ciudad: sin esto los metales salen negros.
  environment.captureEnvironment();

  // Post-procesado (oclusión ambiental, bloom). Antes de precompilar: añade
  // sus propios defines a los shaders.
  await progress(72, 'Preparando el render…');
  renderPipeline.apply(quality.profile.post);

  // El orden importa: primero las sombras, después el congelado. Al revés, los
  // materiales quedan con el shader viejo y no se ve ni una sombra.
  city.freezeMaterials();
  scene.blockMaterialDirtyMechanism = true;

  // Precompilar acá mueve el congelamiento del primer cuadro a la barra de carga.
  const warm = await city.precompile((done, total) => {
    bootBar.style.width = `${78 + (done / total) * 20}%`;
    bootMsg.textContent = `Compilando materiales… ${done}/${total}`;
  });
  if (import.meta.env.DEV) {
    // Diagnóstico intencional: la consola es la interfaz de las herramientas de
    // verificación. Sólo en desarrollo — en producción este bloque no se emite.
    // eslint-disable-next-line no-console
    console.log(`[precompile] ${warm.compiled}/${warm.total} en ${warm.ms} ms`);
  }

  // Vida: tranvías y pájaros. Una ciudad quieta se lee como maqueta.
  life = new Life(scene, city.plan, newSeed);

  // Gente. Es lo que más cambia la percepción del espacio: una ciudad con
  // locales, bancos y bicicleteros pero sin nadie sigue siendo una maqueta.
  crowd = new Crowd(scene, city.plan, city.index, newSeed, profile.crowdSize);

  // Jugador con colisión y modo caminar/volar.
  player = new PlayerController(scene, camera, city.index);
  player.onModeChanged(updateModeButton);
  player.onFootstep((running) => sound.step(running));

  // Clic para inspeccionar manzanas.
  inspector = new Inspector(scene, camera, city.index, canvas);

  updateEnergyPanel();
  quality.applyRuntime();

  // Reubica la cámara mirando al Árbol Solar de la plaza.
  // Aparicion DENTRO de la plaza, en el hueco sin arboles del sector sur, con
  // el Arbol Solar de frente. Antes se aparecia en z=-46, o sea en plena calle
  // y entre troncos: lo primero que se veia era corteza.
  camera.position = new Vector3(0, 1.7, -20);
  camera.setTarget(new Vector3(0, 5.5, 0));
  player.setMode('walk');

  await progress(100, 'Lista');
  updateStats();

  // Diagnóstico de coste: lo lee tools/shoot.mjs para saber QUÉ optimizar en
  // vez de adivinar. Sólo en desarrollo, para no ensuciar la consola en producción.
  if (import.meta.env.DEV) {
    // Lo lee tools/shoot.mjs. Ver comentario anterior.
    // eslint-disable-next-line no-console
    console.log('COSTBREAKDOWN ' + JSON.stringify(city.breakdown().slice(0, 14)));
  }
}

/** Panel de métricas: es la herramienta de trabajo, no adorno. */
function updateStats(): void {
  if (!city) return;
  const s = city.stats;
  const fmt = (n: number) => n.toLocaleString('es-AR');
  // Draw calls REALES: la granja de instancias más todo lo que se dibuja fuera
  // de ella (gente, tranvías, pájaros, cielo). Antes se informaba sólo la
  // granja, así que la cifra subestimaba el coste justo cuando se agregaba
  // movimiento — que es cuando más importa saberlo.
  const drawn = scene.meshes.filter((m) => m.isEnabled() && m.material).length;
  statsEl.innerHTML = [
    `${engine.getFps().toFixed(0)} fps`,
    `${fmt(s.instances)} objetos · ${fmt(Math.round(s.triangles / 1000))}k tris`,
    `${drawn} draw calls · ${s.materials} materiales`,
    `${crowd?.population ?? 0} personas · semilla ${s.seed} · ${s.buildTimeMs} ms`,
  ].join('<br>');
}

// ------------------------------------------------------------------ controles

btnQuality.addEventListener('click', async () => {
  const tier = quality.cycle();
  btnQuality.textContent = `Calidad: ${quality.profile.label}`;
  btnQuality.disabled = true;
  boot.classList.remove('hidden');
  await rebuildFor(tier);
  boot.classList.add('hidden');
  btnQuality.disabled = false;
});

async function rebuildFor(_tier: QualityTier): Promise<void> {
  renderPipeline.apply(quality.profile.post);
  // La densidad de verde y el tamaño de grilla son datos de generación:
  // cambiarlos exige reconstruir. El resto se aplica en caliente.
  await buildCity(seed);
}

timeSlider.addEventListener('input', () => {
  hour = Number(timeSlider.value);
  applyTime(hour);
});

/** Aplica una hora del día: luz, cielo y ventanas encendidas. */
function applyTime(h: number): void {
  environment?.applyHour(h);
  // Las luces se prenden cuando el sol empieza a caer, no antes.
  city?.setLitWindows(h >= 17.5);
  timeLabel.textContent = formatHour(h);
  timeSlider.value = String(h);
}

btnRegen.addEventListener('click', async () => {
  seed = (Math.random() * 0xffffffff) >>> 0;
  btnRegen.disabled = true;
  boot.classList.remove('hidden');
  await buildCity(seed);
  boot.classList.add('hidden');
  btnRegen.disabled = false;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') helpEl.classList.toggle('hidden');
  if (e.key === 'Escape') inspector?.hide();
});

btnMode.addEventListener('click', () => {
  player?.toggleMode();
  sound.click(520);
});

btnSound.addEventListener('click', () => {
  const muted = sound.toggleMute();
  btnSound.textContent = muted ? 'Sonido: off' : 'Sonido';
  btnSound.setAttribute('aria-pressed', String(!muted));
  if (!muted) sound.click(780);
});

function updateModeButton(mode: MoveMode): void {
  btnMode.textContent = mode === 'walk' ? 'Modo: Caminar' : 'Modo: Volar';
  helpWalk.hidden = mode !== 'walk';
  helpFly.hidden = mode === 'walk';
}

/** Panel de energía: totales estimados de la ciudad generada. */
function updateEnergyPanel(): void {
  if (!city) return;
  const t = city.index.totals();
  // Consumo residencial de referencia: ~6 kWh por persona y día, que es el
  // orden de magnitud de un hogar urbano argentino repartido per cápita.
  const demand = t.people * 6;
  const cover = demand > 0 ? Math.round((t.kwhDay / demand) * 100) : 0;
  energyEl.innerHTML = `
    <div class="row"><span>Habitantes</span><b>${t.people.toLocaleString('es-AR')}</b></div>
    <div class="row"><span>Superficie solar</span><b>${t.solarM2.toLocaleString('es-AR')} m²</b></div>
    <div class="row"><span>Generación</span><b>${Math.round(t.kwhDay / 1000).toLocaleString('es-AR')} MWh/día</b></div>
    <div class="row"><span>Demanda est.</span><b>${Math.round(demand / 1000).toLocaleString('es-AR')} MWh/día</b></div>
    <div class="bar"><i style="width:${Math.min(100, cover)}%"></i></div>
    <div class="cover"><b>${cover}%</b> de la demanda cubierta con sol</div>
  `;
}

// ---------------------------------------------------------------------- inicio

async function start(): Promise<void> {
  btnQuality.textContent = `Calidad: ${quality.profile.label}`;
  btnEnergy.addEventListener('click', () => {
    const open = energyEl.classList.toggle('open');
    btnEnergy.setAttribute('aria-pressed', String(open));
    sound.click(open ? 700 : 480);
  });
  if (!sound.available) {
    btnSound.disabled = true;
    btnSound.textContent = 'Sin audio';
  }

  await buildCity(seed);

  // Motor andando antes de tocar VR: así la primera impresión es inmediata.
  engine.runRenderLoop(() => {
    // El viento se anima en el shader; desde acá sólo avanza su reloj.
    // El congelado existe para la prueba de control de tools/test-wind.mjs:
    // sin poder detenerlo, cualquier otra cosa que se mueva en pantalla haría
    // pasar el test por la razón equivocada.
    if (!(window as unknown as { __freezeWind?: boolean }).__freezeWind) {
      city?.tickWind(engine.getDeltaTime() / 1000);
    }
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());
  setInterval(updateStats, 500);

  boot.classList.add('hidden');
  setTimeout(() => helpEl.classList.remove('hidden'), 400);

  // VR en segundo plano: si no hay visor, la experiencia de escritorio ya funciona.
  if (await isVrSupported()) {
    try {
      // Import dinámico: WebXR y todas sus dependencias de Babylon salen del
      // paquete principal y se descargan SÓLO si hay un visor de verdad. Para
      // la enorme mayoría de visitantes —que entran desde una computadora— es
      // peso que ya no viaja por la red.
      const { setupXR } = await import('./vr/XRSetup');
      const { experience } = await setupXR(scene, city!.plan.extent);
      btnVr.disabled = false;
      btnVr.textContent = 'Entrar en VR';
      btnVr.addEventListener('click', async () => {
        // Al entrar en VR forzamos el perfil conservador: 72 fps manda.
        if (quality.current !== 'vr') {
          quality.set('vr');
          btnQuality.textContent = `Calidad: ${quality.profile.label}`;
          environment?.disableShadows();
          renderPipeline.apply(quality.profile.post);
        }
        await experience.baseExperience.enterXRAsync('immersive-vr', 'local-floor');
      });
    } catch (err) {
      console.warn('[ciudad-2050] No se pudo inicializar WebXR:', err);
      btnVr.textContent = 'VR no disponible';
    }
  } else {
    btnVr.textContent = 'VR no disponible';
    btnVr.title =
      'WebXR necesita un visor y un contexto seguro (HTTPS o localhost). En escritorio podés recorrer la ciudad con WASD.';
  }
}

start().catch((err) => {
  console.error(err);
  bootMsg.textContent = 'Error al generar la ciudad — ver la consola.';
});
