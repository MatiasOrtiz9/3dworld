import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { WebXRMotionControllerTeleportation } from '@babylonjs/core/XR/features/WebXRControllerTeleportation';
import type { WebXRControllerPointerSelection } from '@babylonjs/core/XR/features/WebXRControllerPointerSelection';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { XRLocomotion, type WalkIndex } from './XRLocomotion';
import { ComfortVignette } from './XRComfortVignette';
import { ControllerModels } from './XRControllerModels';
import { WristPanel, type HudInfo } from './XRWristPanel';
import { XRMapOverlay } from './XRMapOverlay';
// Efecto secundario: registra `scene.beginAnimation`, que usa el anillo
// giratorio del destino de teletransporte.
import '@babylonjs/core/Animations/animatable';

export interface XRSetupOptions {
  /** Medio lado de la ciudad: tamaño del piso de teletransporte y del cielo. */
  worldExtent: number;
  /** Dónde pararse al entrar: se consulta en cada entrada (la ciudad puede haberse regenerado). */
  spawn: () => { eye: Vector3; look: Vector3 };
  /** Rechaza destinos de teletransporte dentro de edificios, agua o fuera del barrio. */
  canTeleportTo: (x: number, z: number) => boolean;
  /** Colisión y pisos: el mismo índice del escritorio. Se pide en cada cuadro. */
  index: () => WalkIndex | null;
  /** Pisada caminando con el stick (sonido de pasos). */
  onStep?: (running: boolean) => void;
  /** Abre el menú de mapa y ajustes con el botón secundario del mando. */
  onMenu?: () => void;
}

export interface XRControls {
  experience: WebXRDefaultExperience;
  /** Pausa caminata y teletransporte mientras hay un panel abierto. */
  setLocomotionEnabled(enabled: boolean): void;
  /** Texto del panel de muñeca. */
  setHud(info: HudInfo): void;
  /** Nivel adaptativo 0-3. En el visor se traduce en foveación. */
  setPerformanceLevel(level: number): void;
  /** Para al usuario en `eye` (x, z) mirando hacia `look`; `feetY` elige el piso. */
  placeAt(eye: Vector3, look: Vector3, feetY?: number): void;
  /** Estado interno para herramientas de verificación. */
  debug(): { feet: number; head: number; motion: number };
  dispose(): void;
}

/** Las mallas que el puntero láser puede tocar llevan esta marca en `metadata`. */
export const XR_INTERACTIVE = 'xrInteractive';

/** Foveación fija por nivel adaptativo: más agresiva cuanto peor va el cuadro. */
const FOVEATION = [0.5, 0.7, 0.85, 1];

/**
 * Configura la sesión VR.
 *
 * Controles, los de casi cualquier juego de Quest:
 *
 *  - **Stick izquierdo: caminar** (clic: correr), con colisión y pisos. Ver
 *    `XRLocomotion`.
 *  - **Stick derecho: girar de a 30°** a los costados, **teletransporte** hacia
 *    adelante (arco hasta el destino, se suelta para saltar) y un paso atrás
 *    hacia abajo.
 *  - **Gatillo: elegir**, apuntando con el láser. Empieza en la mano derecha y
 *    pasa a la otra con apretar su gatillo.
 *
 * Lo que se desactiva a propósito de la experiencia por defecto de Babylon:
 *
 *  - **Su botón de VR en el canvas.** Entraba sin pasar por el perfil VR de
 *    calidad ni por la configuración de acá.
 *  - **Los modelos de mandos y manos del CDN.** Necesitan el importador glTF,
 *    que el proyecto no incluye: no se veía ningún mando. Se dibujan por código
 *    (`ControllerModels`) y las manos como articulaciones.
 *  - **La interacción cercana.** Agrega una capa utilitaria que se dibuja en
 *    cada cuadro y la experiencia no tiene nada que se toque con la mano.
 *
 * Y para el rendimiento del visor: el piso de teletransporte no se dibuja (era
 * un plano transparente sobre media pantalla, por ojo), el láser sólo prueba
 * contra lo interactivo (no contra la ciudad entera en cada cuadro) y se usa
 * foveación fija.
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
  teleportFloor.position.y = 0.02;
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

  // --- puntero láser: sólo contra paneles y docentes ---
  const pointer = features.enableFeature(WebXRFeatureName.POINTER_SELECTION, 'stable', {
    xrInput: experience.input,
    enablePointerSelectionOnAllControllers: false,
    preferredHandedness: 'right',
    disableSwitchOnClick: false,
    disablePointerUpOnTouchOut: false,
    forceGazeMode: false,
    // Los paneles leen el impacto del rayo, no las coordenadas de pantalla:
    // proyectarlas en cada cuadro es trabajo perdido.
    disableScenePointerVectorUpdate: true,
    maxPointerDistance: 15,
  }) as WebXRControllerPointerSelection;
  pointer.raySelectionPredicate = (mesh: AbstractMesh) =>
    mesh.isEnabled() && mesh.isVisible && mesh.isPickable && mesh.metadata?.[XR_INTERACTIVE] === true;
  pointer.laserPointerDefaultColor = Color3.FromHexString('#b7d4ca');

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
  teleport.setSelectionFeature(pointer); // el láser se esconde mientras se apunta
  teleport.parabolicRayEnabled = true; // parábola: se lee mejor que el rayo recto
  teleport.straightRayEnabled = false;
  teleport.parabolicCheckRadius = 6;
  teleport.rotationAngle = Math.PI / 6; // giro por pasos de 30° a los costados
  // Llegar mirando hacia donde se miraba. Con esto activo, el stick al volver
  // al centro pasaba por posiciones diagonales y se aterrizaba girado al azar.
  teleport.rotationEnabled = false;
  teleport.backwardsMovementEnabled = true;
  teleport.backwardsTeleportationDistance = 0.8;
  const teleportTargetObserver = teleport.onTargetMeshPositionUpdatedObservable.add((pick) => {
    const point = pick.pickedPoint;
    const allowed = Boolean(point && options.canTeleportTo(point.x, point.z));
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

  // --- cuerpo: caminata, mandos, panel de muñeca, viñeta ---
  const locomotion = new XRLocomotion(scene, experience, options.index, options.onStep);
  const teleportedObserver = teleport.onAfterCameraTeleport.add(() => locomotion.markTeleported());
  const wrist = new WristPanel(scene);
  const mapOverlay = new XRMapOverlay(scene);
  const mapOverlayObserver = scene.onBeforeRenderObservable.add(() => {
    if (base.state === WebXRState.IN_XR) mapOverlay.update(cam);
  });
  const models = new ControllerModels(scene, experience.input, (grip) => wrist.attachTo(grip));
  const vignette = new ComfortVignette(scene, cam);
  const vignetteObserver = scene.onBeforeRenderObservable.add(() => {
    if (base.state !== WebXRState.IN_XR) return;
    vignette.update(locomotion.motion, Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1));
  });

  // Vibración corta al apretar el gatillo: confirma que el clic se registró.
  const controllerAddedObserver = experience.input.onControllerAddedObservable.add((controller) => {
    controller.onMotionControllerInitObservable.add((motionController) => {
      motionController.getMainComponent()?.onButtonStateChangedObservable.add((component) => {
        if (component.changes.pressed?.current) motionController.pulse(0.22, 25).catch(() => undefined);
      });
      const menuId = controller.inputSource.handedness === 'left' ? 'y-button' : 'b-button';
      motionController.getComponent(menuId)?.onButtonStateChangedObservable.add((component) => {
        if (component.changes.pressed?.current) options.onMenu?.();
      });
    });
  });

  let performanceLevel = 0;
  const applyFoveation = (): void => {
    const sm = base.sessionManager;
    if (sm.isFixedFoveationSupported) sm.fixedFoveation = FOVEATION[performanceLevel];
  };

  // Al entrar, el jugador aparece de pie frente a la escuela, sobre Laprida,
  // mirando el portal: el mismo primer cuadro que en escritorio.
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
      vignette.hide();
    }
  });

  let disposed = false;
  return {
    experience,
    setLocomotionEnabled(enabled: boolean): void {
      locomotion.setEnabled(enabled);
      teleport.teleportationEnabled = enabled;
    },
    setHud(info: HudInfo): void {
      wrist.set(info);
      mapOverlay.set(info);
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
    debug: () => ({ ...locomotion.debug, motion: locomotion.motion }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scene.onBeforeRenderObservable.remove(vignetteObserver);
      scene.onBeforeRenderObservable.remove(mapOverlayObserver);
      teleport.onTargetMeshPositionUpdatedObservable.remove(teleportTargetObserver);
      teleport.onAfterCameraTeleport.remove(teleportedObserver);
      base.onStateChangedObservable.remove(stateObserver);
      experience.input.onControllerAddedObservable.remove(controllerAddedObserver);
      locomotion.dispose();
      models.dispose();
      wrist.dispose();
      mapOverlay.dispose();
      vignette.dispose();
      experience.dispose();
      jointSource.dispose();
      jointMaterial.dispose();
      teleportFloor.dispose();
    },
  };
}
