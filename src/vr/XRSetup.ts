import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { WebXRMotionControllerTeleportation } from '@babylonjs/core/XR/features/WebXRControllerTeleportation';
import { WebXRControllerComponent } from '@babylonjs/core/XR/motionController/webXRControllerComponent';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// Efectos secundarios que Babylon necesita para XR y para el gizmo de teleport.
import '@babylonjs/core/Materials/Textures/Loaders/envTextureLoader';
import '@babylonjs/core/Helpers/sceneHelpers';

export interface XRResult {
  experience: WebXRDefaultExperience;
  teleportFloor: Mesh;
  setMovementEnabled(enabled: boolean): void;
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
  /** Rechaza destinos de teletransporte dentro de edificios, agua o fuera del barrio. */
  canTeleportTo: (x: number, z: number) => boolean,
  /** Abre una conversación si el rayo del gatillo izquierdo apunta a un docente cercano. */
  onTeacherInteract?: (ray: Ray) => boolean,
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
    // La app configura sus propias características más abajo. Desactivar las
    // automáticas evita que Babylon intente activar near-interaction, UI y
    // otras capacidades opcionales antes de que sepamos cuáles admite Quest.
    disableDefaultUI: true,
    disablePointerSelection: true,
    disableTeleportation: true,
    disableNearInteraction: true,
    disableHandTracking: true,
    uiOptions: {
      sessionMode: 'immersive-vr',
      referenceSpaceType: 'local-floor',
    },
  });

  if (!experience.baseExperience || !experience.input) {
    throw new Error(
      'Babylon devolvió una experiencia XR incompleta (baseExperience/input ausentes). Revisá la consola del navegador para ver el error interno.',
    );
  }

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
    forceHandedness: 'right',
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
  const teleportTargetObserver = teleport.onTargetMeshPositionUpdatedObservable.add((pick) => {
    const point = pick.pickedPoint;
    const allowed = Boolean(point && canTeleportTo(point.x, point.z));
    teleport.skipNextTeleportation = !allowed;
    // Oculta el anillo cuando el arco termina dentro de un obstáculo.
    const target = teleport.teleportationTargetMesh;
    if (target) target.isVisible = allowed;
  });

  // Quest: stick izquierdo para caminar. Esta ruta propia evita habilitar la
  // característica MOVEMENT de Babylon, que es incompatible con TELEPORTATION.
  const forwardAxis = new Vector3(0, 0, 1);
  const rightAxis = new Vector3(1, 0, 0);
  const forward = Vector3.Zero();
  const right = Vector3.Zero();
  let manualMovementEnabled = true;
  const manualMove = scene.onBeforeRenderObservable.add(() => {
    if (experience.baseExperience.state !== WebXRState.IN_XR || !manualMovementEnabled) return;
    const left = experience.input.controllers.find((controller) => controller.inputSource.handedness === 'left');
    const stick = left?.motionController?.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE);
    const gamepadAxes = left?.inputSource.gamepad?.axes;
    // El perfil del navegador puede no exponer el thumbstick como componente
    // Babylon. En ese caso, tomar el par de ejes más activo del gamepad XR.
    let rawX = stick?.axes.x ?? 0;
    let rawY = stick?.axes.y ?? 0;
    if (Math.hypot(rawX, rawY) < 0.16 && gamepadAxes) {
      let strongest = 0;
      for (let i = 0; i + 1 < gamepadAxes.length; i += 2) {
        const x = gamepadAxes[i];
        const y = gamepadAxes[i + 1];
        const magnitude = Math.hypot(x, y);
        if (magnitude > strongest) {
          strongest = magnitude;
          rawX = x;
          rawY = y;
        }
      }
    }
    const x = Math.abs(rawX) > 0.16 ? rawX : 0;
    const y = Math.abs(rawY) > 0.16 ? rawY : 0;
    if (x === 0 && y === 0) return;

    const cam = experience.baseExperience.camera;
    cam.getDirectionToRef(forwardAxis, forward);
    cam.getDirectionToRef(rightAxis, right);
    forward.y = 0;
    right.y = 0;
    forward.normalize();
    right.normalize();
    let dx = right.x * x - forward.x * y;
    let dz = right.z * x - forward.z * y;
    const magnitude = Math.hypot(dx, dz);
    if (magnitude > 1) {
      dx /= magnitude;
      dz /= magnitude;
    }
    // Un paso de velocidad por cuadro, como el movimiento nativo de Babylon.
    const distance = cam._computeLocalCameraSpeed() * 0.65;
    const nextX = cam.position.x + dx * distance;
    const nextZ = cam.position.z + dz * distance;
    // Mantener el índice urbano como colisión y deslizarse por las paredes.
    if (canTeleportTo(nextX, cam.position.z)) cam.position.x = nextX;
    if (canTeleportTo(cam.position.x, nextZ)) cam.position.z = nextZ;
    // WebXRCamera detecta este cambio fuera del ciclo XR y desplaza su espacio
    // de referencia en el siguiente cuadro; así la pose de la cabeza no lo pisa.
  });

  // Punteros: sirven para señalar e interactuar con paneles.
  features.enableFeature(WebXRFeatureName.POINTER_SELECTION, 'stable', {
    xrInput: experience.input,
    // Separar las acciones evita que hablar con un docente active también
    // el teletransporte: izquierda interactúa, derecha teletransporta.
    enablePointerSelectionOnAllControllers: false,
    preferredHandedness: 'left',
    disableSwitchOnClick: true,
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

  // Respaldo directo para conversar con docentes usando el gatillo izquierdo.
  // Las thin instances no siempre entregan thinInstanceIndex de forma fiable
  // en Quest Browser, por eso primero resolvemos la conversación por geometría.
  // El puntero integrado queda encargado de los botones del panel.
  const selectionCleanup: Array<() => void> = [];
  let pointerId = 1000;
  const bindManualSelection = (controller: (typeof experience.input.controllers)[number]): void => {
    const bind = (motionController: NonNullable<typeof controller.motionController>): void => {
      const trigger = motionController.getMainComponent();
      if (!trigger) return;
      const id = pointerId++;
      const pointerEvent = { pointerId: id, pointerType: 'xr' };
      let pressedPick: PickingInfo | null = null;
      const observer = trigger.onButtonStateChangedObservable.add((component) => {
        const pressed = component.changes.pressed?.current;
        if (pressed === undefined || controller.inputSource.handedness !== 'left') return;
        if (experience.baseExperience.state !== WebXRState.IN_XR) return;
        if (pressed) {
          const ray = new Ray(Vector3.Zero(), Vector3.Zero());
          controller.getWorldPointerRayToRef(ray);
          if (onTeacherInteract?.(ray)) {
            motionController.pulse(0.45, 70).catch(() => undefined);
            return;
          }
          const pick = scene.pickWithRay(ray, (mesh) =>
            mesh.isPickable &&
            mesh.name === 'stationPanel',
          );
          if (!pick?.hit) return;
          pressedPick = pick;
          scene.simulatePointerDown(pick, pointerEvent);
        } else if (pressedPick) {
          scene.simulatePointerUp(pressedPick, pointerEvent);
          pressedPick = null;
        }
      });
      selectionCleanup.push(() => trigger.onButtonStateChangedObservable.remove(observer));
    };
    if (controller.motionController) {
      bind(controller.motionController);
    } else {
      const observer = controller.onMotionControllerInitObservable.addOnce(bind);
      selectionCleanup.push(() => controller.onMotionControllerInitObservable.remove(observer));
    }
  };
  for (const controller of experience.input.controllers) bindManualSelection(controller);
  const selectionControllerObserver = experience.input.onControllerAddedObservable.add(bindManualSelection);

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
    scene.onBeforeRenderObservable.remove(manualMove);
    teleport.onTargetMeshPositionUpdatedObservable.remove(teleportTargetObserver);
    stateObservable.remove(enterObserver);
    stateObservable.remove(gridStateObserver);
    experience.input.onControllerAddedObservable.remove(controllerAddedObserver);
    experience.input.onControllerAddedObservable.remove(selectionControllerObserver);
    for (const cleanup of selectionCleanup) cleanup();
    experience.dispose();
    grid.dispose();
    gridMat.dispose();
    floorMat.dispose();
    teleportFloor.dispose();
  };

  return {
    experience,
    teleportFloor,
    setMovementEnabled: (enabled) => {
      manualMovementEnabled = enabled;
    },
    dispose,
  };
}
