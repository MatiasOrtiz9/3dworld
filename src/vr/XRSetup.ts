import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { WebXRMotionControllerTeleportation } from '@babylonjs/core/XR/features/WebXRControllerTeleportation';
import type { WebXRControllerMovementRegistrationConfiguration } from '@babylonjs/core/XR/features/WebXRControllerMovement';
import { WebXRControllerComponent } from '@babylonjs/core/XR/motionController/webXRControllerComponent';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// Efectos secundarios que Babylon necesita para XR y para el gizmo de teleport.
import '@babylonjs/core/Materials/Textures/Loaders/envTextureLoader';
import '@babylonjs/core/Helpers/sceneHelpers';
import '@babylonjs/core/XR/features/WebXRControllerMovement';

export interface XRResult {
  experience: WebXRDefaultExperience;
  teleportFloor: Mesh;
  dispose(): void;
}

/**
 * Configura la sesión VR.
 *
 * Decisiones de confort, tomadas a propósito y no por defecto:
 *
 *  - **Movimiento continuo opcional desde el stick izquierdo**, con velocidad
 *    moderada; el teletransporte sigue disponible como alternativa cómoda.
 *  - **Giro por pasos (snap) de 30° al teletransportarse**, para evitar giro
 *    continuo que puede provocar mareo.
 *  - **Suelo de teletransporte propio y plano.** La ciudad son decenas de miles
 *    de instancias finas; hacer raycast contra todas para validar el destino
 *    sería carísimo. Un plano invisible a nivel de calle resuelve el 95 % de los
 *    casos por una fracción del costo.
 */
export async function setupXR(
  scene: Scene,
  worldExtent: number,
  /** Dónde pararse al entrar: se consulta en cada entrada (la ciudad puede haberse regenerado). */
  spawn: () => { eye: Vector3; look: Vector3 },
): Promise<XRResult> {
  // Suelo invisible para validar los destinos de teletransporte.
  const teleportFloor = CreateGround(
    'teleportFloor',
    { width: worldExtent * 2, height: worldExtent * 2, subdivisions: 1 },
    scene,
  );
  teleportFloor.position.y = 0.02;
  const floorMat = new StandardMaterial('teleportFloorMat', scene);
  floorMat.alpha = 0; // invisible pero pickable
  floorMat.disableLighting = true;
  teleportFloor.material = floorMat;
  teleportFloor.isPickable = true;

  const experience = await WebXRDefaultExperience.CreateAsync(scene, {
    floorMeshes: [teleportFloor],
    disableTeleportation: false,
    optionalFeatures: true,
    uiOptions: {
      sessionMode: 'immersive-vr',
      referenceSpaceType: 'local-floor',
    },
  });

  const features = experience.baseExperience.featuresManager;

  // Teletransporte con arco parabólico y anillo de destino.
  const teleport = features.enableFeature(WebXRFeatureName.TELEPORTATION, 'stable', {
    xrInput: experience.input,
    floorMeshes: [teleportFloor],
    defaultTargetMeshOptions: {
      teleportationFillColor: '#4faa7a',
      teleportationBorderColor: '#f2c14e',
      disableLighting: true,
    },
    useMainComponentOnly: true,
    // Solo el suelo de teleport bloquea el rayo: no hay que testear la ciudad.
    blockAllPickableMeshes: false,
  }) as WebXRMotionControllerTeleportation;

  // Estos van como propiedades de la característica, no como opciones.
  teleport.parabolicRayEnabled = true; // parábola: se lee mejor que el rayo recto
  teleport.straightRayEnabled = false;
  teleport.parabolicCheckRadius = 6;
  teleport.rotationEnabled = true; // giro por pasos al teletransportarse
  teleport.rotationAngle = Math.PI / 6; // 30°
  teleport.backwardsTeleportationDistance = 0.8;

  // Quest: stick izquierdo camina (adelante/atrás y lateral). El predeterminado
  // de Babylon asigna estas acciones al revés, por eso se registra el mapeo
  // explícitamente. El stick derecho sigue libre para apuntar el teletransporte.
  const movementControls: WebXRControllerMovementRegistrationConfiguration[] = [
    {
      allowedComponentTypes: [WebXRControllerComponent.THUMBSTICK_TYPE],
      forceHandedness: 'left',
      axisChangedHandler: (axes, state, context) => {
        state.moveX = Math.abs(axes.x) > context.movementThreshold ? axes.x : 0;
        state.moveY = Math.abs(axes.y) > context.movementThreshold ? axes.y : 0;
      },
    },
  ];
  features.enableFeature(WebXRFeatureName.MOVEMENT, 'stable', {
    xrInput: experience.input,
    customRegistrationConfigurations: movementControls,
    movementEnabled: true,
    movementOrientationFollowsViewerPose: true,
    movementOrientationFollowsController: false,
    movementSpeed: 0.65,
    movementThreshold: 0.18,
    rotationEnabled: false,
  });

  // Punteros: sirven para señalar e interactuar con paneles.
  features.enableFeature(WebXRFeatureName.POINTER_SELECTION, 'stable', {
    xrInput: experience.input,
    enablePointerSelectionOnAllControllers: true,
    disablePointerUpOnTouchOut: false,
    forceGazeMode: false,
    disableScenePointerVectorUpdate: false,
  });

  // Seguimiento de manos si el visor lo ofrece (Quest sí).
  try {
    features.enableFeature(WebXRFeatureName.HAND_TRACKING, 'latest', {
      xrInput: experience.input,
    });
  } catch {
    // No todos los visores lo soportan: no es un error.
  }

  // Respuesta háptica táctil en mandos VR al presionar gatillos/botones principales
  const controllerAddedObserver = experience.input.onControllerAddedObservable.add((controller) => {
    controller.onMotionControllerInitObservable.add((motionController) => {
      const mainComp = motionController.getMainComponent();
      if (mainComp) {
        mainComp.onButtonStateChangedObservable.add((component) => {
          if (component.changes.pressed?.current) {
            motionController.pulse(0.22, 25).catch(() => undefined);
          }
        });
      }
    });
  });

  // Al entrar en VR, poner al jugador de pie frente a la escuela, sobre
  // Laprida, mirando el portal: el mismo primer cuadro que en escritorio.
  const stateObservable = experience.baseExperience.onStateChangedObservable;
  const enterObserver = stateObservable.add((state) => {
    if (state !== WebXRState.IN_XR) return;
    const cam = experience.baseExperience.camera;
    const { eye, look } = spawn();
    // Con referencia 'local-floor' la altura de los ojos la pone el visor.
    cam.position = new Vector3(eye.x, 0, eye.z);
    cam.setTarget(look);
    cam.minZ = 0.1;
  });

  // Rejilla de referencia bajo los pies: ancla visual que reduce el mareo
  // al dar al cerebro una superficie estable e inequívoca.
  const grid = CreateGround('comfortGrid', { width: 3.2, height: 3.2, subdivisions: 1 }, scene);
  const gridMat = new StandardMaterial('comfortGridMat', scene);
  gridMat.diffuseColor = Color3.Black();
  gridMat.emissiveColor = Color3.FromHexString('#4faa7a').scale(0.25);
  gridMat.alpha = 0.16;
  gridMat.disableLighting = true;
  grid.material = gridMat;
  grid.isPickable = false;
  grid.setEnabled(false);

  const gridStateObserver = stateObservable.add((state) => {
    grid.setEnabled(state === WebXRState.IN_XR);
  });

  const gridRenderObserver = scene.onBeforeRenderObservable.add(() => {
    if (!grid.isEnabled()) return;
    const cam = experience.baseExperience.camera;
    grid.position.set(cam.position.x, 0.05, cam.position.z);
  });

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    scene.onBeforeRenderObservable.remove(gridRenderObserver);
    stateObservable.remove(enterObserver);
    stateObservable.remove(gridStateObserver);
    experience.input.onControllerAddedObservable.remove(controllerAddedObserver);
    experience.dispose();
    grid.dispose();
    gridMat.dispose();
    floorMat.dispose();
    teleportFloor.dispose();
  };

  return { experience, teleportFloor, dispose };
}
