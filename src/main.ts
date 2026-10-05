import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// Efectos secundarios de Babylon: registran componentes que usamos.
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';

import { City } from './world/City';
import { DEFAULT_HOUR, Environment, formatHour } from './world/Environment';
import { QualityManager, TIER_ORDER, type QualityTier } from './core/QualityManager';
import { createFlyCamera } from './player/FlyCamera';
import { RenderPipeline } from './core/RenderPipeline';
import { PlayerController, type MoveMode } from './player/PlayerController';
import { Life } from './world/Life';
import { Population } from './world/people/Population';
import { Soundscape } from './audio/Soundscape';
import { acousticsAtWorld } from './audio/schoolAcoustics';
import { isHeadsetBrowser, isVrSupported } from './vr/isVrSupported';
import type { XRControls } from './vr/XRSetup';
import { seedFromString } from './utils/rng';
import { Hud } from './ui/Hud';
import { GameDirector } from './game/GameDirector';
import type { PlayerApi, WorldPoint } from './game/contracts';
import { SCHOOL, toWorld } from './world/SchoolLayout';

// ---------------------------------------------------------------- referencias

const canvas = document.getElementById('render') as HTMLCanvasElement;
const boot = document.getElementById('boot') as HTMLDivElement;
const bootMsg = document.getElementById('boot-msg') as HTMLParagraphElement;
const bootBar = document.getElementById('boot-bar') as HTMLElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
const btnVr = document.getElementById('btn-vr') as HTMLButtonElement;
const btnQuality = document.getElementById('btn-quality') as HTMLButtonElement;
const timeSlider = document.getElementById('time-slider') as HTMLInputElement;
const timeLabel = document.getElementById('time-label') as HTMLSpanElement;
const btnMode = document.getElementById('btn-mode') as HTMLButtonElement;
const btnSound = document.getElementById('btn-sound') as HTMLButtonElement;
const helpWalk = document.getElementById('help-walk') as HTMLDivElement;
const helpFly = document.getElementById('help-fly') as HTMLDivElement;
const vrStatus = document.getElementById('vr-status') as HTMLDivElement | null;

/** Por qué no se pudo entrar en VR, a la vista: en el visor no hay consola. */
const reportVrProblem = (message: string): void => {
  if (!vrStatus) return;
  vrStatus.hidden = false;
  vrStatus.textContent = message;
};
const errorText = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

const progress = (pct: number, msg?: string) => {
  bootBar.style.width = `${pct}%`;
  if (msg) bootMsg.textContent = msg;
  // Cede el hilo para que el navegador pinte el avance.
  return new Promise((r) => requestAnimationFrame(() => r(undefined)));
};

/** Altura de los ojos sobre los pies en escritorio (la misma del controlador). */
const EYE = 1.62;

// -------------------------------------------------------------------- estado

let city: City | null = null;
let environment: Environment | null = null;
let life: Life | null = null;
let people: Population | null = null;
let player: PlayerController | null = null;
let director: GameDirector | null = null;
let xr: XRControls | null = null;
let hour = DEFAULT_HOUR;
// La semilla se puede fijar por URL (?seed=1234 o ?seed=cualquier-texto). Sólo
// cambia el barrio de alrededor (casas, autos): la escuela es siempre la misma.
const seedParam = new URLSearchParams(location.search).get('seed');
const seed = seedParam
  ? /^\d+$/.test(seedParam)
    ? Number(seedParam) >>> 0
    : seedFromString(seedParam)
  : seedFromString('cimdip-miguel-cane');

// -------------------------------------------------------------------- arranque

const engine = new Engine(canvas, true, {
  antialias: true,
  stencil: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
});
engine.setHardwareScalingLevel(1);

const scene = new Scene(engine);
// El barrio es estático: avisarle a Babylon ahorra mucho trabajo por cuadro.
scene.autoClear = true;
scene.autoClearDepthAndStencil = true;
// Se activa recién después de armar la escena: si se bloquea antes, los
// materiales no incorporan los defines del generador de sombras.
scene.blockMaterialDirtyMechanism = false;
scene.skipPointerMovePicking = true;

// ?quality=low|vr|balanced|high fuerza un perfil para comparar equipos.
const qualityParam = new URLSearchParams(location.search).get('quality') as QualityTier | null;
const initialTier: QualityTier =
  qualityParam && (TIER_ORDER.includes(qualityParam) || qualityParam === 'vr')
    ? qualityParam
    : QualityManager.suggestInitial(canvas);
const quality = new QualityManager(engine, scene, initialTier);
const camera = createFlyCamera(scene, canvas);

const renderPipeline = new RenderPipeline(scene, camera);

// El audio arranca suspendido: ningún navegador deja sonar nada hasta que haya
// un gesto del usuario. El Soundscape se despierta solo con el primer clic.
const sound = new Soundscape({ lowPower: initialTier === 'vr' });

// El HUD vive toda la sesión: cada director nuevo (al cambiar la calidad) se
// vuelve a enganchar al mismo.
const hud = new Hud();

const inXR = (): boolean => Boolean(xr && scene.activeCamera?.getClassName() === 'WebXRCamera');

/** El jugador, tal como lo ve el juego: escritorio o visor, el mismo contrato. */
const playerApi: PlayerApi = {
  feet(): WorldPoint {
    const cam = scene.activeCamera ?? camera;
    const p = cam.globalPosition;
    // En el visor los ojos están a la altura real de cada persona; la caminata
    // VR sabe dónde están los pies.
    const y = inXR() ? xr!.debug().feet : p.y - EYE;
    return { x: p.x, y, z: p.z };
  },
  forward(): WorldPoint {
    const d = (scene.activeCamera ?? camera).getDirection(Vector3.Forward());
    return { x: d.x, y: d.y, z: d.z };
  },
  setPaused(paused: boolean): void {
    player?.setPaused(paused);
  },
  teleport(p: WorldPoint, lookAt?: WorldPoint): void {
    const look = lookAt
      ? new Vector3(lookAt.x, lookAt.y, lookAt.z)
      : new Vector3(p.x, p.y + EYE, p.z + 1);
    if (inXR()) {
      xr!.placeAt(new Vector3(p.x, p.y + EYE, p.z), look, p.y);
      return;
    }
    camera.position.set(p.x, p.y + EYE, p.z);
    camera.setTarget(look);
  },
  get inVR(): boolean {
    return inXR();
  },
};

// Gancho de depuración: deja que herramientas externas (tools/shoot.mjs) muevan
// la cámara para capturar la escuela desde ángulos concretos.
Object.assign(window as unknown as Record<string, unknown>, {
  __scene: scene,
  __BABYLON_Vector3: Vector3,
  // El plano, para que las herramientas puedan encuadrar una manzana concreta.
  __plan: () => city?.plan ?? null,
  // Marco de la escuela: las capturas se encuadran en coordenadas del plano (u, v).
  __schoolFrame: () => city?.schoolFrame ?? null,
  // Colisión y pisos: tools/test-vr.mjs verifica con el mismo índice que el juego.
  __index: () => city?.index ?? null,
  // Estado de la caminata VR (pies, cabeza, movimiento) para tools/test-vr.mjs.
  __xr: () => xr?.debug() ?? null,
  // Gente y juego, para las herramientas de verificación.
  __people: () => people,
  __director: () => director,
  __player: playerApi,
  __sound: sound,
  // Conmutadores para medir por ablación cuánto cuesta cada efecto. Sin esto,
  // atribuir el coste entre sombras, oclusión ambiental y bloom es adivinar.
  __setShadows: (on: boolean) => {
    if (!environment || !city) return;
    const p = quality.profile;
    if (on) environment.enableShadows(city.shadowCasters, p.shadowResolution || 1024, p.shadowMode, p.shadowFilter);
    else environment.disableShadows();
    environment.setAdaptiveLevel(quality.adaptiveLevel);
  },
  __setPost: (mode: 'off' | 'lite' | 'balanced' | 'high') => renderPipeline.apply(mode),
  __windClock: () => city?.windClock ?? -1,
});

// El director vigente (cambia al reconstruir), para guiones de prueba.
Object.defineProperty(window, '__game', { get: () => director, configurable: true });

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  xr?.dispose();
  engine.stopRenderLoop();
  director?.dispose();
  life?.dispose();
  people?.dispose();
  player?.dispose();
  hud.dispose();
  renderPipeline.dispose();
  environment?.dispose();
  city?.dispose();
  sound.dispose();
  scene.dispose();
  engine.dispose();
}, { once: true });

/** Primer cuadro, en escritorio y en VR: la fachada de la escuela desde Laprida. */
function startView(c: City): { eye: Vector3; look: Vector3 } {
  const eye = toWorld(c.schoolFrame, 31, SCHOOL.front + 11.8);
  const look = toWorld(c.schoolFrame, 36.5, 0);
  return { eye: new Vector3(eye.x, 1.7, eye.z), look: new Vector3(look.x, 3.6, look.z) };
}

/**
 * Dónde aparece el visor al entrar: donde estaba el jugador de escritorio,
 * mirando hacia el mismo lado. Antes de empezar (título), frente al portal.
 */
function xrSpawn(): { eye: Vector3; look: Vector3 } {
  if (!city) throw new Error('sin escuela');
  if (!director || director.atTitle || player?.mode !== 'walk') return startView(city);
  const f = camera.getDirection(Vector3.Forward());
  const flat = new Vector3(f.x, 0, f.z);
  if (flat.lengthSquared() < 1e-4) flat.set(0, 0, 1);
  flat.normalize();
  const eye = camera.position.clone();
  return { eye, look: eye.add(flat.scale(4)) };
}

/** Construye (o reconstruye) la escuela y su barrio. */
async function buildCity(newSeed: number): Promise<void> {
  await progress(10, 'Abriendo la escuela…');

  // Al cambiar la calidad se reconstruye todo: el jugador sigue donde estaba.
  const keep = city ? { pos: camera.position.clone(), target: camera.getTarget().clone() } : null;

  scene.blockMaterialDirtyMechanism = false;
  director?.dispose();
  life?.dispose();
  people?.dispose();
  player?.dispose();
  director = null;
  life = null;
  people = null;
  player = null;
  city?.dispose();
  environment?.dispose();
  city = null;
  environment = null;

  const profile = quality.profile;

  await progress(30, 'Levantando la escuela y el barrio…');
  city = new City(scene, newSeed, {
    gridSize: profile.gridSize,
    greenDensity: profile.greenDensity,
    highDetailFoliage: profile.highDetailFoliage,
    highDetailStreet: profile.highDetailStreet,
  });
  // La fachada es la primera vista y también debe orientar el calentamiento
  // selectivo de shaders que sigue más abajo.
  const start = startView(city);
  camera.position = keep?.pos ?? start.eye;
  camera.setTarget(keep?.target ?? start.look);

  await progress(55, 'Calculando el cielo…');
  environment = new Environment(scene, city.plan.extent);
  // La sombra estática gasta su resolución en la escuela, no en el barrio.
  const centre = toWorld(city.schoolFrame, 34, -20);
  environment.setFocus({ x: centre.x, z: centre.z }, 95);
  // Mapa de luz natural de los interiores (ventanas, fondos de aula, debajo
  // de mesas y escaleras) y adaptación de la exposición al entrar: sin esto,
  // las aulas quedan con la luz pareja de antes.
  environment.setSchool(city.schoolFrame);
  applyTime(hour);

  if (profile.shadows) {
    await progress(65, 'Proyectando sombras…');
    environment.enableShadows(city.shadowCasters, profile.shadowResolution, profile.shadowMode, profile.shadowFilter);
    environment.setAdaptiveLevel(quality.adaptiveLevel);
  }

  // IBL desde el propio cielo: sin esto los metales salen negros.
  environment.captureEnvironment();

  // Post-procesado (oclusión ambiental, bloom). Antes de precompilar: añade
  // sus propios defines a los shaders.
  await progress(72, 'Preparando el render…');
  renderPipeline.apply(quality.profile.post);
  renderPipeline.setAdaptiveLevel(quality.adaptiveLevel);

  // El orden importa: primero las sombras, después el congelado. Al revés, los
  // materiales quedan con el shader viejo y no se ve ni una sombra.
  city.freezeMaterials();
  scene.blockMaterialDirtyMechanism = true;

  // Calienta las variantes de la fachada con espera limitada; el resto se
  // compila cuando entra en cuadro, sin alargar la pantalla de carga.
  const warm = await city.precompile(camera, (done, total) => {
    bootBar.style.width = `${78 + (done / total) * 20}%`;
    bootMsg.textContent = `Compilando materiales… ${done}/${total}`;
  });
  if (import.meta.env.DEV) {
    // Diagnóstico intencional: la consola es la interfaz de las herramientas de
    // verificación. Sólo en desarrollo — en producción este bloque no se emite.
    // eslint-disable-next-line no-console
    console.log(`[precompile] ${warm.compiled}/${warm.total} en ${warm.ms} ms`);
  }

  // Autos por las calles del barrio y pájaros.
  life = new Life(scene, city.plan, newSeed);

  // Alumnos, docentes, familias y personal: la escuela viva.
  people = new Population(scene, city.plan, city.index, city.schoolFrame, newSeed, {
    crowdSize: profile.crowdSize,
    detailed: profile.highDetailStreet,
  });
  people.setAdaptiveLevel(quality.adaptiveLevel);
  people.setSchoolPhase('entrada');

  // Jugador con colisión y modo caminar/volar.
  player = new PlayerController(scene, camera, city.index);
  player.onModeChanged(updateModeButton);
  player.onFootstep((running) => sound.step(running));

  // El juego: historia, personajes, actividades, HUD y panel del visor.
  director = new GameDirector({
    scene,
    camera,
    school: city.schoolFrame,
    index: city.index,
    population: people,
    audio: sound,
    player: playerApi,
    hud,
    // E sube mientras se vuela: sólo se interactúa caminando.
    canInteract: () => player?.mode === 'walk',
    fixtures: city.lightFixtures,
  });
  if (xr) await director.connectXR(xr.experience, xr);

  quality.applyRuntime();
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

/** Panel de métricas (Ajustes → Métricas): es la herramienta de trabajo, no adorno. */
function updateStats(): void {
  if (!city || !document.body.classList.contains('metrics')) return;
  const s = city.stats;
  const fmt = (n: number) => n.toLocaleString('es-AR');
  // Draw calls REALES: la granja de instancias más todo lo que se dibuja fuera
  // de ella (gente, autos, pájaros, cielo, juego).
  const drawn = scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.material).length;
  statsEl.innerHTML = [
    `${engine.getFps().toFixed(0)} fps`,
    `${fmt(s.instances)} objetos · ${fmt(Math.round(s.triangles / 1000))}k tris`,
    `${drawn} mallas · ${s.materials} materiales`,
    `${people?.population ?? 0} personas · ${people?.drawn ?? 0} dibujadas · ${s.buildTimeMs} ms`,
  ].join('<br>');
}

/** Ambiente sonoro y piso bajo los pies, 4 veces por segundo. */
let acousticsMs = 0;
scene.onBeforeRenderObservable.add(() => {
  if (!city) return;
  if ((acousticsMs -= engine.getDeltaTime()) > 0) return;
  acousticsMs = 250;
  const f = playerApi.feet();
  const a = acousticsAtWorld(city.schoolFrame, f.x, f.z, f.y);
  sound.setZone(a.zone);
  sound.setSurface(a.surface);
});

// ------------------------------------------------------------------ controles

btnQuality.addEventListener('click', async () => {
  const tier = quality.cycle();
  updateQualityButton();
  btnQuality.disabled = true;
  boot.classList.remove('hidden');
  await rebuildFor(tier);
  boot.classList.add('hidden');
  btnQuality.disabled = false;
});

async function rebuildFor(_tier: QualityTier): Promise<void> {
  // La densidad de verde, el detalle y la multitud son datos de generación:
  // cambiarlos exige reconstruir. El resto se aplica en caliente.
  await buildCity(seed);
}

function updateQualityButton(): void {
  const suffix = quality.adaptiveLevel ? ` · ajuste ${quality.adaptiveLevel}/3` : '';
  btnQuality.textContent = `Calidad: ${quality.profile.label}${suffix}`;
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

btnMode.addEventListener('click', () => {
  player?.toggleMode();
  sound.click(520);
});

btnSound.addEventListener('click', () => {
  const muted = sound.toggleMute();
  showSoundState(muted);
  if (!muted) sound.click(780);
});

function showSoundState(muted: boolean): void {
  btnSound.textContent = muted ? 'Sonido: off' : 'Sonido';
  btnSound.setAttribute('aria-pressed', String(!muted));
}

function updateModeButton(mode: MoveMode): void {
  btnMode.textContent = mode === 'walk' ? 'Modo: Caminar' : 'Modo: Volar';
  helpWalk.hidden = mode !== 'walk';
  helpFly.hidden = mode === 'walk';
}

// ---------------------------------------------------------------------- inicio

async function start(): Promise<void> {
  updateQualityButton();
  if (!sound.available) {
    btnSound.disabled = true;
    btnSound.textContent = 'Sin audio';
  } else {
    showSoundState(sound.isMuted);
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
    const adaptiveLevel = quality.observeFrame(
      engine.getDeltaTime(),
      scene.activeCamera?.getClassName().includes('WebXR') ?? false,
    );
    if (adaptiveLevel !== null) {
      people?.setAdaptiveLevel(adaptiveLevel);
      environment?.setAdaptiveLevel(adaptiveLevel);
      renderPipeline.setAdaptiveLevel(adaptiveLevel);
      // En el visor la escala de resolución del canvas no cuenta: la palanca
      // equivalente es la foveación fija.
      xr?.setPerformanceLevel(adaptiveLevel);
      updateQualityButton();
    }
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());
  setInterval(updateStats, 500);

  boot.classList.add('hidden');

  // VR en segundo plano: si no hay visor, la experiencia de escritorio ya funciona.
  if (await isVrSupported()) {
    try {
      // Import dinámico: WebXR y todas sus dependencias de Babylon salen del
      // paquete principal y se descargan SÓLO si hay un visor de verdad.
      const { setupXR } = await import('./vr/XRSetup');
      const { WebXRState } = await import('@babylonjs/core/XR/webXRTypes');
      xr = await setupXR(scene, {
        worldExtent: city!.plan.extent,
        spawn: xrSpawn,
        // El punto y un radio de cuerpo alrededor (el de la caminata VR): un
        // destino pegado a una fachada dejaba la cabeza dentro del muro.
        canTeleportTo: (x, z) => {
          const idx = city?.index;
          if (!idx) return false;
          const r = 0.3;
          return [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => !idx.isPedestrianBlocked(x + dx, z + dz));
        },
        // Se pide en cada cuadro: la escuela se reconstruye al cambiar la calidad.
        index: () => city?.index ?? null,
        onStep: (running) => sound.step(running),
        onMenu: () => director?.toggleXRMenu(),
      });
      const controls = xr;
      const base = controls.experience.baseExperience;
      await director?.connectXR(controls.experience, controls);

      // Calidad con la que se venía en escritorio: al salir del visor se vuelve a ella.
      let tierBeforeVr: QualityTier | null = null;
      const vrIdle = (text = 'Entrar en VR'): void => {
        btnVr.disabled = false;
        btnVr.textContent = text;
      };
      base.onStateChangedObservable.add((state) => {
        if (state === WebXRState.IN_XR) {
          // El visor tiene su propio plano lejano y foveación: aplicar el
          // nivel adaptativo vigente desde el primer cuadro.
          controls.setPerformanceLevel(quality.adaptiveLevel);
          sound.setLowPower(true);
          vrIdle('Salir de VR');
        } else if (state === WebXRState.NOT_IN_XR) {
          vrIdle();
          sound.setLowPower(quality.current === 'vr');
          const previous = tierBeforeVr;
          tierBeforeVr = null;
          if (previous && previous !== quality.current) {
            quality.set(previous);
            updateQualityButton();
            boot.classList.remove('hidden');
            void rebuildFor(previous).finally(() => boot.classList.add('hidden'));
          }
        }
      });
      vrIdle();

      btnVr.addEventListener('click', async () => {
        // Con el visor de PC puesto, el botón del escritorio también sirve para salir.
        if (base.state === WebXRState.IN_XR) {
          await base.exitXRAsync();
          return;
        }
        if (base.state !== WebXRState.NOT_IN_XR) return;
        btnVr.disabled = true;
        btnVr.textContent = 'Preparando…';
        boot.classList.remove('hidden');
        try {
          // El perfil VR cambia el follaje, la multitud y quita el post-proceso
          // (que dentro del visor dejaba los colores sin mapeo tonal).
          if (quality.current !== 'vr') {
            tierBeforeVr = quality.current;
            quality.set('vr');
            updateQualityButton();
            await rebuildFor('vr');
          }
          await base.enterXRAsync('immersive-vr', 'local-floor');
        } catch (err) {
          // Típicamente: el navegador exige que la sesión se pida pegada al
          // clic, y reconstruir la escuela tardó demasiado. Ya quedó en perfil
          // VR, así que el segundo intento entra de inmediato.
          console.warn('[cimdip] No se pudo entrar en VR:', err);
          btnVr.title = errorText(err);
          reportVrProblem(`WebXR no pudo iniciar la sesión: ${errorText(err)}`);
          vrIdle('Tocá de nuevo para entrar');
        } finally {
          boot.classList.add('hidden');
          if (base.state === WebXRState.NOT_IN_XR && btnVr.disabled) vrIdle();
        }
      });
    } catch (err) {
      console.warn('[cimdip] No se pudo inicializar WebXR:', err);
      btnVr.textContent = 'VR no disponible';
      btnVr.title = errorText(err);
      reportVrProblem(`WebXR detectado, pero no se pudo preparar Babylon XR: ${errorText(err)}`);
    }
  } else {
    btnVr.textContent = 'VR no disponible';
    btnVr.title =
      'WebXR necesita un visor y un contexto seguro (HTTPS o localhost). En escritorio podés recorrer la escuela con WASD.';
    // En el visor sí se explica por qué (en una computadora sin visor es lo normal).
    if (isHeadsetBrowser()) {
      const reason = window.isSecureContext
        ? 'navigator.xr no existe en esta pestaña del navegador del visor.'
        : 'la página no está en un contexto seguro: WebXR requiere HTTPS confiable o localhost.';
      reportVrProblem(`WebXR no detectado: ${reason} Origen: ${location.origin}`);
    }
  }
}

start().catch((err) => {
  console.error(err);
  bootMsg.textContent = 'Error al abrir la escuela — ver la consola.';
});
