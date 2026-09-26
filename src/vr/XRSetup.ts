import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { WebXRMotionControllerTeleportation } from '@babylonjs/core/XR/features/WebXRControllerTeleportation';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// Efectos secundarios que Babylon necesita para XR y para el gizmo de teleport.
import '@babylonjs/core/Materials/Textures/Loaders/envTextureLoader';
import '@babylonjs/core/Helpers/sceneHelpers';

export interface XRResult {
  experience: WebXRDefaultExperience;
  teleportFloor: Mesh;
}

/**
 * Configura la sesión VR.
 *
 * Decisiones de confort, tomadas a propósito y no por defecto:
 *
 *  - **Teletransporte, no movimiento continuo.** El desplazamiento continuo con
 *    joystick es la causa principal de mareo en VR, porque el sistema vestibular
 *    no recibe la aceleración que los ojos reportan. El teletransporte la elimina.
 *  - **Giro por pasos (snap) de 30°.** Misma razón, aplicada a la rotación.
 *  - **Suelo de teletransporte propio y plano.** La ciudad son decenas de miles
 *    de instancias finas; hacer raycast contra todas para validar el destino
 *    sería carísimo. Un plano invisible a nivel de calle resuelve el 95 % de los
 *    casos por una fracción del costo.
 */
export async function setupXR(scene: Scene, worldExtent: number): Promise<XRResult> {
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

  // Al entrar en VR, poner al jugador de pie en la plaza mirando al Árbol Solar.
  experience.baseExperience.onStateChangedObservable.add((state) => {
    if (state !== WebXRState.IN_XR) return;
    const cam = experience.baseExperience.camera;
    cam.position = new Vector3(0, 0, -20);
    cam.setTarget(new Vector3(0, 9, 0));
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

  experience.baseExperience.onStateChangedObservable.add((state) => {
    grid.setEnabled(state === WebXRState.IN_XR);
  });

  scene.onBeforeRenderObservable.add(() => {
    if (!grid.isEnabled()) return;
    const cam = experience.baseExperience.camera;
    grid.position.set(cam.position.x, 0.05, cam.position.z);
  });

  return { experience, teleportFloor };
}
