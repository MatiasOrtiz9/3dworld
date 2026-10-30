import type { Scene } from '@babylonjs/core/scene';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { WebXRMotionControllerTeleportation } from '@babylonjs/core/XR/features/WebXRControllerTeleportation';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { XRLocomotion, type WalkIndex } from './XRLocomotion';
import { ComfortVignette } from './XRComfortVignette';
import { ControllerModels } from './XRControllerModels';
import { WristPanel, type HudInfo } from './XRWristPanel';
import { XRInput } from './XRInput';
import { XRPointer } from './XRPointer';
import { XRFade } from './XRFade';
import { loadComfort, saveComfort, sanitizeComfort, vignetteOpacity, type ComfortSettings } from './XRComfort';
import { XRMapOverlay } from './XRMapOverlay';
// Efecto secundario: registra `scene.beginAnimation`, que usa el anillo
// giratorio del destino de teletransporte.
import '@babylonjs/core/Animations/animatable';

/** El piso de teletransporte va apenas sobre los pies (no se dibuja). */
const TELEPORT_FLOOR_LIFT = 0.02;
/**
 * Stick derecho hacia adelante: desde acá se está apuntando el teletransporte
 * (el láser de esa mano se esconde para no ver dos rayos). Vuelve a aparecer
 * con el stick casi al centro: sin histéresis parpadeaba en el borde.
 */
const TELEPORT_AIM_ON = -0.6;
const TELEPORT_AIM_OFF = -0.3;

export interface XRSetupOptions {
  /** Medio lado de la ciudad: tamaño del piso de teletransporte y del cielo. */
  worldExtent: number;
  /** Dónde pararse al entrar: se consulta en cada entrada (la ciudad puede haberse regenerado). */
  spawn: () => { eye: Vector3; look: Vector3 };
  /**
   * Rechaza destinos de teletransporte dentro de edificios, agua o fuera del
   * barrio. `feet` es la cota del piso apuntado: el de los pies del jugador.
   */
  canTeleportTo: (x: number, z: number, feet: number) => boolean;
  /** Colisión y pisos: el mismo índice del escritorio. Se pide en cada cuadro. */
  index: () => WalkIndex | null;
  /** Pisada caminando con el stick (sonido de pasos). */
  onStep?: (running: boolean) => void;
}

export interface XRControls {
  experience: WebXRDefaultExperience;
  /** Botones de los dos mandos (flancos, hápticos, rayos, velocidad de la mano). */
  readonly input: XRInput;
  /** Láser y retícula: el juego le dice dónde terminó cada rayo. */
  readonly pointer: XRPointer;
  /** Caminar, girar y teletransporte (se pausan en escenas guionadas y menús de pantalla completa). */
  setLocomotionEnabled(enabled: boolean): void;
  /** Texto del panel de muñeca. */
  setHud(info: HudInfo): void;
  /** Flecha del panel de muñeca hacia el objetivo (o `null` sin objetivo). */
  setObjectiveTarget(p: { x: number; y: number; z: number } | null): void;
  /** Ajustes de confort vigentes (copia). */
  getComfort(): ComfortSettings;
  /** Aplica al instante (caminata, giro, viñeta, sentado) y guarda. */
  setComfort(s: ComfortSettings): void;
  /** Rótulos con la función de cada botón junto a los mandos. */
  setHints(on: boolean): void;
  /** Fundido a negro (`true`) o desde negro (`false`). */
  fade(toBlack: boolean, ms?: number): Promise<void>;
  /** Sale de la sesión XR (desde el menú del juego en el visor). */
  exit(): Promise<void>;
  /** Nivel adaptativo 0-3. En el visor se traduce en foveación. */
  setPerformanceLevel(level: number): void;
  /** Para al usuario en `eye` (x, z) mirando hacia `look`; `feetY` elige el piso. */
  placeAt(eye: Vector3, look: Vector3, feetY?: number): void;
  /** Estado interno para herramientas de verificación. */
  debug(): { feet: number; head: number; motion: number; canWalk: boolean; running: boolean };
  dispose(): void;
}

/**
 * Marca en `metadata` de las mallas que el láser del puntero de Babylon podía
 * tocar. El puntero de Babylon ya no se usa (ver `setupXR`): queda exportada
 * por compatibilidad.
 */
export const XR_INTERACTIVE = 'xrInteractive';

/** Foveación fija por nivel adaptativo: más agresiva cuanto peor va el cuadro. */
const FOVEATION = [0.5, 0.7, 0.85, 1];

/**
 * Configura la sesión VR.
 *
 * Controles (el mapeo completo, botón por botón, está en `XRInput` y en los
 * rótulos de `ControllerModels`):
 *
 *  - **Stick izquierdo: caminar** (clic: correr), con colisión y pisos. Ver
 *    `XRLocomotion`.
 *  - **Stick derecho: girar** por pasos o continuo (ajuste de confort),
 *    **teletransporte** hacia adelante (arco hasta el destino, se suelta para
 *    saltar) y un paso atrás hacia abajo.
 *  - **Gatillo, grip, A/X, B/Y y clic del stick derecho** los lee `XRInput`
 *    del gamepad crudo y los interpreta el juego (`GameDirector`).
 *
 * Lo que se desactiva a propósito de la experiencia por defecto de Babylon:
 *
 *  - **Su botón de VR en el canvas.** Entraba sin pasar por el perfil VR de
 *    calidad ni por la configuración de acá.
 *  - **Su puntero láser (POINTER_SELECTION).** En el Quest no siempre
 *    entregaba el clic, sólo sabe "elegir al apretar" (los clics accidentales
 *    en los paneles venían de ahí) y probaba su rayo contra la escena en cada
 *    cuadro. El láser lo dibuja `XRPointer` y los rayos los prueba el juego
 *    contra lo suyo (paneles y cajas de lo enfocable).
 *  - **Los modelos de mandos y manos del CDN.** Necesitan el importador glTF,
 *    que el proyecto no incluye: no se veía ningún mando. Se dibujan por código
 *    (`ControllerModels`) y las manos como articulaciones.
 *  - **La interacción cercana.** Agrega una capa utilitaria que se dibuja en
 *    cada cuadro; el agarre cercano (la pelota) lo resuelve el juego con la
 *    posición de la mano.
 *
 * Y para el rendimiento del visor: el piso de teletransporte no se dibuja (era
 * un plano transparente sobre media pantalla, por ojo) y se usa foveación fija.
 */
export async function setupXR(scene: Scene, options: XRSetupOptions): Promise<XRControls> {
  // Suelo para validar los destinos de teletransporte. La ciudad son decenas de
  // miles de instancias finas: tirar el arco contra todas sería carísimo, y un
  // plano a nivel de calle resuelve el 95 % de los casos. No se dibuja: los
  // predicados del teletransporte no piden visibilidad.
  const teleportFloor = CreateGround(
    'teleportFloor',
    { width: options.worldExtent * 2, height: options.worldExtent * 2, subdivisions: 1 },
    scene,
  );
  teleportFloor.position.y = TELEPORT_FLOOR_LIFT;
  teleportFloor.isVisible = false;
  teleportFloor.isPickable = true;
  teleportFloor.freezeWorldMatrix();

  const experience = await WebXRDefaultExperience.CreateAsync(scene, {
    disableDefaultUI: true,
    disableTeleportation: true,
    disablePointerSelection: true,
    disableNearInteraction: true,
    disableHandTracking: true,
    inputOptions: { doNotLoadControllerMeshes: true },
  });
  // En el Quest Browser Babylon llegó a devolver una experiencia a medias sin
  // avisar: mejor un error claro (se muestra en pantalla) que un botón muerto.
  if (!experience.baseExperience || !experience.input) {
    throw new Error(
      'Babylon devolvió una experiencia XR incompleta (baseExperience/input ausentes). Revisá la consola del navegador para ver el error interno.',
    );
  }
  const base = experience.baseExperience;
  const features = base.featuresManager;
  const cam = base.camera;

  // --- botones y láser propios (antes que nada que lea el gamepad) ---
  const input = new XRInput(scene, experience);
  const pointer = new XRPointer(scene, input);

  // --- teletransporte y giro en el stick derecho ---
  const teleport = features.enableFeature(WebXRFeatureName.TELEPORTATION, 'stable', {
    xrInput: experience.input,
    floorMeshes: [teleportFloor],
    defaultTargetMeshOptions: {
      teleportationFillColor: '#4faa7a',
      teleportationBorderColor: '#f2c14e',
      disableLighting: true,
    },
    forceHandedness: 'right',
    // Sólo el suelo de teleport detiene el arco: no hay que testear la ciudad.
    blockAllPickableMeshes: false,
  }) as WebXRMotionControllerTeleportation;
  teleport.parabolicRayEnabled = true; // parábola: se lee mejor que el rayo recto
  teleport.straightRayEnabled = false;
  teleport.parabolicCheckRadius = 6;
  // El giro (por pasos o continuo) lo hace XRLocomotion leyendo el gamepad
  // crudo: el de Babylon dependía de que el perfil expusiera el stick. Acá
  // queda en 0 para que no gire dos veces cuando el perfil sí lo expone.
  teleport.rotationAngle = 0;
  // Llegar mirando hacia donde se miraba. Con esto activo, el stick al volver
  // al centro pasaba por posiciones diagonales y se aterrizaba girado al azar.
  teleport.rotationEnabled = false;
  // El paso atrás lo da XRLocomotion: el de Babylon no miraba
  // `teleportationEnabled` (bajar el resaltado de un menú con el stick derecho
  // alejaba 0,8 m al jugador, también en escenas guionadas y fundidos) ni las
  // paredes (sólo busca el piso de teletransporte: atravesaba tabiques).
  teleport.backwardsMovementEnabled = false;
  const teleportTargetObserver = teleport.onTargetMeshPositionUpdatedObservable.add((pick) => {
    const point = pick.pickedPoint;
    const allowed = Boolean(point && options.canTeleportTo(point.x, point.z, point.y - TELEPORT_FLOOR_LIFT));
    teleport.skipNextTeleportation = !allowed;
    // Oculta el anillo cuando el arco termina dentro de un obstáculo.
    const target = teleport.teleportationTargetMesh;
    if (target) target.isVisible = allowed;
  });

  // --- manos: articulaciones dibujadas por código, sin modelos del CDN ---
  const jointMaterial = new StandardMaterial('xrJointMat', scene);
  jointMaterial.diffuseColor = new Color3(0.86, 0.78, 0.7);
  jointMaterial.specularColor = Color3.Black();
  jointMaterial.emissiveColor = new Color3(0.2, 0.18, 0.16);
  const jointSource = CreateIcoSphere('xrJoint', { radius: 1, subdivisions: 1 }, scene);
  jointSource.material = jointMaterial;
  jointSource.isPickable = false;
  jointSource.isVisible = false; // sólo la fuente de las instancias
  try {
    features.enableFeature(WebXRFeatureName.HAND_TRACKING, 'latest', {
      xrInput: experience.input,
      jointMeshes: { sourceMesh: jointSource },
      handMeshes: { disableDefaultMeshes: true },
    });
  } catch {
    // No todos los visores lo soportan: no es un error.
  }

  // --- cuerpo: caminata, mandos, panel de muñeca, viñeta, fundido ---
  // Los ajustes de confort son de la persona que usa el visor: se leen una
  // vez y la caminata los consulta en cada cuadro (cambiarlos es instantáneo).
  let comfort = loadComfort();
  const locomotion = new XRLocomotion(scene, experience, options.index, options.onStep, () => comfort);
  const wrist = new WristPanel(scene);
  const mapOverlay = new XRMapOverlay(scene);
  const mapOverlayObserver = scene.onBeforeRenderObservable.add(() => {
    if (base.state === WebXRState.IN_XR) mapOverlay.update(cam);
  });
  const models = new ControllerModels(scene, experience.input, (grip) => wrist.attachTo(grip));
  const vignette = new ComfortVignette(scene, cam);
  vignette.setMaxOpacity(vignetteOpacity(comfort));
  const fade = new XRFade(scene, cam);
  // Cada botón que se lee se ilumina en el mando: confirma qué tomó el juego
  // aunque esa pulsación no haga nada en ese momento. La vibración, en
  // cambio, la decide el juego según lo que la pulsación hizo.
  const flashObserver = input.onPress.add((e) => models.flash(e.hand, e.button));

  let locomotionOn = true;
  const teleportedObserver = teleport.onAfterCameraTeleport.add(() => {
    locomotion.markTeleported();
    // Un tic en la mano del arco: el salto se siente, no sólo se ve.
    input.haptic('right', 'tick');
  });

  // El piso de teletransporte sigue a los pies: en el primer y segundo piso
  // de la escuela el arco caía sobre el plano de la calle, se validaba contra
  // la planta baja y el salto te bajaba a ella. Se recongela sólo al cambiar
  // de cota (subiendo una escalera, cada pocos centímetros).
  let teleportFloorFeet = 0;
  let aimingTeleport = false;
  const frameObserver = scene.onBeforeRenderObservable.add(() => {
    if (base.state !== WebXRState.IN_XR) return;
    const feet = locomotion.debug.feet;
    if (Math.abs(feet - teleportFloorFeet) > 0.03) {
      teleportFloorFeet = feet;
      teleportFloor.position.y = feet + TELEPORT_FLOOR_LIFT;
      teleportFloor.freezeWorldMatrix();
    }
    // Mientras el stick derecho apunta el arco, el láser de esa mano estorba.
    const y = locomotionOn ? input.stick('right').y : 0;
    const aiming = aimingTeleport ? y < TELEPORT_AIM_OFF : y < TELEPORT_AIM_ON;
    if (aiming !== aimingTeleport) {
      aimingTeleport = aiming;
      pointer.setHidden('right', aiming);
    }
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1);
    vignette.update(Math.max(locomotion.motion, locomotion.turning), dt);
  });

  let performanceLevel = 0;
  const applyFoveation = (): void => {
    const sm = base.sessionManager;
    if (sm.isFixedFoveationSupported) sm.fixedFoveation = FOVEATION[performanceLevel];
  };

  // Al entrar, el jugador queda parado en el punto de partida (frente a la
  // escuela, sobre Laprida): el juego decide qué se ve ahí (la pantalla de
  // inicio en el visor) y cuándo se empieza a jugar.
  const stateObserver = base.onStateChangedObservable.add((state) => {
    if (state === WebXRState.IN_XR) {
      const { eye, look } = options.spawn();
      locomotion.placeAt(eye, look);
      // 10 cm, como en escritorio: con la cabeza pegada a un muro o a un
      // marco de puerta, la esquina del plano cercano no lo atraviesa.
      cam.minZ = 0.1;
      // El cielo ya no depende del plano lejano (se dibuja en el fondo del
      // búfer, ver Sky.ts); éste sólo tiene que alcanzar el borde del suelo
      // base y su fundido con la niebla en diagonal. La precisión de
      // profundidad la decide el plano cercano: ~6 mm a 100 m.
      cam.maxZ = options.worldExtent * 7.2;
      applyFoveation();
      // 72 Hz deja más presupuesto que 90 y es lo que espera la calidad adaptativa.
      const rates = base.sessionManager.supportedFrameRates;
      if (rates && Array.from(rates).includes(72)) {
        base.sessionManager.updateTargetFrameRate(72).catch(() => undefined);
      }
    } else if (state === WebXRState.NOT_IN_XR) {
      // Nada del visor sobrevive a la sesión: ni el negro de un fundido a
      // medias (en escritorio taparía la cámara), ni los rótulos, ni un láser
      // escondido por un arco que nunca se soltó.
      vignette.hide();
      void fade.fade(false, 0);
      models.setHints(false);
      aimingTeleport = false;
      for (const hand of ['left', 'right'] as const) {
        pointer.setHidden(hand, false);
        pointer.setHit(hand, null);
      }
    }
  });

  let disposed = false;
  return {
    experience,
    input,
    pointer,
    setLocomotionEnabled(enabled: boolean): void {
      const wasOn = locomotionOn;
      locomotionOn = enabled;
      locomotion.setEnabled(enabled);
      teleport.teleportationEnabled = enabled;
      // Un arco apuntado en el momento de apagar quedaba colgado: al soltar
      // el stick Babylon sale antes de limpiarlo (mira `teleportationEnabled`
      // primero), se seguía dibujando bajo el menú y el siguiente roce del
      // stick saltaba solo. Desenganchar y volver a enganchar lo reinicia.
      const arcOwner = (teleport as unknown as { _currentTeleportationControllerId?: string })._currentTeleportationControllerId;
      if (wasOn && !enabled && arcOwner && teleport.attached) {
        teleport.detach();
        teleport.attach();
      }
    },
    setHud(info: HudInfo): void {
      wrist.set(info);
      mapOverlay.set(info);
    },
    setObjectiveTarget(p: { x: number; y: number; z: number } | null): void {
      wrist.setTarget(p);
    },
    getComfort(): ComfortSettings {
      return { ...comfort };
    },
    setComfort(s: ComfortSettings): void {
      comfort = sanitizeComfort(s);
      vignette.setMaxOpacity(vignetteOpacity(comfort));
      saveComfort(comfort);
    },
    setHints(on: boolean): void {
      models.setHints(on);
    },
    fade(toBlack: boolean, ms?: number): Promise<void> {
      return fade.fade(toBlack, ms);
    },
    async exit(): Promise<void> {
      if (base.state === WebXRState.IN_XR) await base.exitXRAsync();
    },
    placeAt(eye: Vector3, look: Vector3, feetY?: number): void {
      if (base.state !== WebXRState.IN_XR) return;
      // La altura real de la cabeza sólo se puede leer dentro de un cuadro XR;
      // el juego puede pedir el salto desde un temporizador o una promesa.
      scene.onBeforeRenderObservable.addOnce(() => locomotion.placeAt(eye, look, feetY));
    },
    setPerformanceLevel(level: number): void {
      performanceLevel = Math.max(0, Math.min(FOVEATION.length - 1, Math.round(level)));
      if (base.state === WebXRState.IN_XR) applyFoveation();
    },
    debug: () => ({ ...locomotion.debug, motion: locomotion.motion, running: locomotion.running }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scene.onBeforeRenderObservable.remove(frameObserver);
      scene.onBeforeRenderObservable.remove(mapOverlayObserver);
      teleport.onTargetMeshPositionUpdatedObservable.remove(teleportTargetObserver);
      teleport.onAfterCameraTeleport.remove(teleportedObserver);
      base.onStateChangedObservable.remove(stateObserver);
      input.onPress.remove(flashObserver);
      // Lo colgado de los nodos de los mandos se suelta antes de que la
      // experiencia los destruya.
      pointer.dispose();
      models.dispose();
      input.dispose();
      locomotion.dispose();
      wrist.dispose();
      mapOverlay.dispose();
      vignette.dispose();
      fade.dispose();
      experience.dispose();
      jointSource.dispose();
      jointMaterial.dispose();
      teleportFloor.dispose();
    },
  };
}
