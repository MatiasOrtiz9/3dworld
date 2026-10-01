import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import type { Ray } from '@babylonjs/core/Culling/ray';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import type { WebXRMotionControllerTeleportation } from '@babylonjs/core/XR/features/WebXRControllerTeleportation';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import { SCHOOL, STATION_SPOTS, toWorld, type SchoolFrame } from '../world/SchoolLayout';
import type { StationPanel3D } from './StationPanel3D';

type StationId = 'tech' | 'robotics' | 'science' | 'sport' | 'environment';

interface Question {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}

interface StationDefinition {
  id: StationId;
  guide: string;
  title: string;
  short: string;
  greeting: string;
  color: string;
  questions: Question[];
}

interface Station extends StationDefinition {
  position: Vector3;
  beaconIndex: number;
}

const STORAGE_KEY = 'cimdip-challenge-progress-v1';
const INTERACT_RANGE = 5.5;

const GUIDE_COLORS = {
  shirts: ['#c74750', '#b83e49', '#cb5154', '#aa3441', '#bd4550'],
  trousers: ['#273854', '#26334b', '#2c3d58', '#242f48', '#2b3952'],
  skin: ['#d99a72', '#b97b5c', '#e2ae87', '#895b43', '#c98b68'],
  hair: ['#30231f', '#332720', '#17191d', '#553923', '#211b1b'],
} as const;

const DEFINITIONS: StationDefinition[] = [
  {
    id: 'tech',
    guide: 'Profe Maia',
    title: 'Tecnología',
    short: 'Aula Maker',
    greeting: '¡Hola! En el Aula Maker probamos ideas, aprendemos del error y volvemos a intentar. ¿Te animás a resolver un caso?',
    color: '#4c91b5',
    questions: [
      {
        prompt: 'Una pieza sale débil de la impresora 3D. ¿Qué ajuste mejora primero su resistencia?',
        options: ['Reducir el relleno', 'Aumentar el relleno', 'Apagar la base'],
        answer: 1,
        explanation: 'Más relleno interno distribuye mejor las cargas de la pieza.',
      },
    ],
  },
  {
    id: 'robotics',
    guide: 'Profe Tomás',
    title: 'Robótica',
    short: 'Secuencia de robot',
    greeting: '¡Bienvenido al taller! Vamos a preparar una secuencia segura para que el robot complete su recorrido.',
    color: '#d48b42',
    questions: [
      {
        prompt: 'Paso 1 de 3: antes de mover un robot, ¿qué debe comprobarse?',
        options: ['Que el camino esté libre', 'La música de fondo', 'El color de la carcasa'],
        answer: 0,
        explanation: 'Primero se valida un recorrido seguro.',
      },
      {
        prompt: 'Paso 2 de 3: el robot debe girar a la derecha. ¿Qué instrucción corresponde?',
        options: ['Avanzar', 'Girar a la derecha', 'Detener programa'],
        answer: 1,
        explanation: 'La instrucción de giro cambia su orientación antes de avanzar.',
      },
      {
        prompt: 'Paso 3 de 3: después de completar el recorrido, ¿qué instrucción cierra la secuencia?',
        options: ['Repetir sin límite', 'Detenerse', 'Borrar el sensor'],
        answer: 1,
        explanation: 'Detenerse deja al robot en un estado seguro.',
      },
    ],
  },
  {
    id: 'science',
    guide: 'Profe Elena',
    title: 'Ciencia',
    short: 'Mesa de experimentos',
    greeting: 'Antes de sacar conclusiones, en ciencias comparamos resultados con cuidado. Veamos este experimento.',
    color: '#7b6aa7',
    questions: [
      {
        prompt: 'Para comparar dos reacciones, ¿qué variable debe mantenerse igual?',
        options: ['La condición de control', 'El resultado esperado', 'El nombre del experimento'],
        answer: 0,
        explanation: 'Una condición de control permite atribuir el cambio a una sola variable.',
      },
    ],
  },
  {
    id: 'sport',
    guide: 'Profe Juli',
    title: 'Deporte',
    short: 'Circuito activo',
    greeting: '¡Hola, equipo! En un relevo importa la velocidad, pero también cómo nos organizamos. ¿Cuál opción elegirías?',
    color: '#bf5f50',
    questions: [
      {
        prompt: 'En un circuito de relevos, ¿qué mejora el trabajo del equipo?',
        options: ['Coordinar el pase', 'Correr en direcciones opuestas', 'Ignorar la señal de salida'],
        answer: 0,
        explanation: 'La coordinación hace que la velocidad individual se convierta en rendimiento colectivo.',
      },
    ],
  },
  {
    id: 'environment',
    guide: 'Profe Nico',
    title: 'Medio ambiente',
    short: 'Energía y residuos',
    greeting: 'La escuela también cuida el ambiente con decisiones cotidianas. Pensemos juntos qué conviene hacer.',
    color: '#4f9b69',
    questions: [
      {
        prompt: '¿Qué acción reduce mejor residuos de un laboratorio escolar?',
        options: ['Reutilizar materiales seguros', 'Usar descartables siempre', 'Mezclar los residuos'],
        answer: 0,
        explanation: 'Reutilizar y separar reduce consumo y facilita una gestión responsable.',
      },
    ],
  },
];

/** Cinco docentes que convierten el recorrido por el campus en una conversación. */
export class ChallengeSystem {
  private readonly stations: Station[] = [];
  private readonly completed = new Set<StationId>();
  private readonly missionEl = document.getElementById('mission') as HTMLDivElement;
  private readonly missionTitle = document.getElementById('mission-title') as HTMLParagraphElement;
  private readonly missionProgress = document.getElementById('mission-progress') as HTMLDivElement;
  private readonly promptEl = document.getElementById('station-prompt') as HTMLDivElement;
  private readonly promptName = document.getElementById('station-name') as HTMLSpanElement;
  private readonly dialog = document.getElementById('challenge') as HTMLDivElement;
  private readonly dialogTitle = document.getElementById('challenge-title') as HTMLHeadingElement;
  private readonly dialogBody = document.getElementById('challenge-body') as HTMLDivElement;
  private readonly beforeRender: Observer<Scene>;
  private readonly xrPointer: Observer<PointerInfo>;
  private readonly guideMeshes: Mesh[] = [];
  private readonly guideMaterials: StandardMaterial[] = [];
  private beaconMesh: Mesh | null = null;
  private beaconMaterial: StandardMaterial | null = null;
  private beaconMatrices = new Float32Array();
  private beaconColors = new Float32Array();
  private readonly beaconScale = new Vector3(1, 1.55, 1);
  private readonly beaconRotation = new Quaternion();
  private readonly beaconTranslation = new Vector3();
  private readonly beaconTransform = Matrix.Identity();
  private active: Station | null = null;
  private questionIndex = 0;
  private nearbyId: StationId | null = null;
  private elapsed = 0;
  private previousFocus: HTMLElement | null = null;
  private introPending = false;
  private xrExperience: WebXRDefaultExperience | null = null;
  private setXRMovementEnabled: ((enabled: boolean) => void) | null = null;
  private xrTeleportation: WebXRMotionControllerTeleportation | null = null;
  private xrStateObserver: Observer<WebXRState> | null = null;
  private xrPanel: StationPanel3D | null = null;
  private inXR = false;
  private xrWelcomeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    school: SchoolFrame,
    private readonly onModalChange: (paused: boolean) => void = () => {},
    private readonly canTalk: () => boolean = () => true,
  ) {
    this.restore();
    this.createStations(school);
    this.createGuides(school);
    this.beforeRender = this.scene.onBeforeRenderObservable.add(this.update);
    this.xrPointer = this.scene.onPointerObservable.add(this.onXRPointer);
    window.addEventListener('keydown', this.onKeyDown);
    this.updateMission();
  }

  /** Conecta las interacciones 3D al visor sin cargar sus texturas en escritorio. */
  async connectXR(
    experience: WebXRDefaultExperience,
    setMovementEnabled?: (enabled: boolean) => void,
  ): Promise<void> {
    if (this.xrStateObserver && this.xrExperience) {
      this.xrExperience.baseExperience.onStateChangedObservable.remove(this.xrStateObserver);
    }
    this.xrExperience = experience;
    this.setXRMovementEnabled = setMovementEnabled ?? null;
    this.xrTeleportation = experience.baseExperience.featuresManager.getEnabledFeature(WebXRFeatureName.TELEPORTATION);
    const { StationPanel3D } = await import('./StationPanel3D');
    this.xrPanel ??= new StationPanel3D(this.scene);
    this.xrStateObserver = experience.baseExperience.onStateChangedObservable.add(this.onXRStateChanged);
    this.onXRStateChanged(experience.baseExperience.state);
  }

  private createStations(school: SchoolFrame): void {
    // Las estaciones están DENTRO de la escuela (ver SchoolLayout): Tecnología,
    // un aula de Laprida, el gimnasio y el patio oeste. Antes se derivaban de
    // fracciones de la manzana y dos quedaban en medio de la calle.
    //
    // Un único diamante instanciado marca a los cinco docentes.
    this.beaconMaterial = new StandardMaterial('npc-marker', this.scene);
    this.beaconMaterial.diffuseColor = Color3.White();
    this.beaconMaterial.emissiveColor = new Color3(0.62, 0.62, 0.62);
    this.beaconMaterial.specularColor = Color3.Black();
    this.beaconMesh = CreatePolyhedron('npc-markers', { type: 1, size: 0.3 }, this.scene);
    this.beaconMesh.material = this.beaconMaterial;
    // Solo se vuelve pickable en XR: la ciudad de escritorio evita esos raycasts.
    this.beaconMesh.isPickable = false;
    this.beaconColors = new Float32Array(DEFINITIONS.length * 4);

    for (let index = 0; index < DEFINITIONS.length; index++) {
      const definition = DEFINITIONS[index];
      const spot = STATION_SPOTS[definition.id];
      const w = toWorld(school, spot.u, spot.v);
      const position = new Vector3(w.x, SCHOOL.floorY, w.z);
      const color = Color3.FromHexString(definition.color);
      const markerColor = color.scale(this.completed.has(definition.id) ? 0.95 : 0.68);
      this.beaconColors.set([markerColor.r, markerColor.g, markerColor.b, 1], index * 4);
      this.stations.push({ ...definition, position, beaconIndex: index });
    }

    this.beaconMatrices = new Float32Array(this.stations.length * 16);
    this.beaconMesh.thinInstanceSetBuffer('matrix', this.beaconMatrices, 16, false);
    this.beaconMesh.thinInstanceSetBuffer('color', this.beaconColors, 4, false);
    this.updateBeaconMatrices();
    this.beaconMesh.thinInstanceRefreshBoundingInfo(true);
  }

  private updateBeaconMatrices(): void {
    for (const station of this.stations) {
      const phase = this.elapsed * 1.6 + station.position.x;
      Quaternion.RotationYawPitchRollToRef(this.elapsed * 1.8 + station.beaconIndex, 0, 0, this.beaconRotation);
      this.beaconTranslation.set(station.position.x, 2.55 + Math.sin(phase) * 0.07, station.position.z);
      Matrix.ComposeToRef(this.beaconScale, this.beaconRotation, this.beaconTranslation, this.beaconTransform);
      this.beaconMatrices.set(this.beaconTransform.m, station.beaconIndex * 16);
    }
    this.beaconMesh?.thinInstanceBufferUpdated('matrix');
  }

  /** Cinco guías articulables en una sola silueta compartida por canal. */
  private createGuides(school: SchoolFrame): void {
    const material = new StandardMaterial('school-guides', this.scene);
    material.diffuseColor = Color3.White();
    material.emissiveColor = new Color3(0.11, 0.11, 0.11);
    material.specularColor = Color3.Black();
    this.guideMaterials.push(material);

    const tops = [
      CreateBox('guide-torso-shape', { width: 0.58, height: 0.76, depth: 0.3 }, this.scene),
      CreateBox('guide-arm-left-shape', { width: 0.19, height: 0.66, depth: 0.27 }, this.scene),
      CreateBox('guide-arm-right-shape', { width: 0.19, height: 0.66, depth: 0.27 }, this.scene),
    ];
    tops[0].position.y = 1.21;
    tops[1].position.set(-0.39, 1.2, 0);
    tops[1].rotation.z = -0.12;
    tops[2].position.set(0.39, 1.2, 0);
    tops[2].rotation.z = 0.12;
    this.configureGuidePart(Mesh.MergeMeshes(tops, true, true)!, 'guide-tops', material, 'shirts', school);

    const lower = [
      CreateBox('guide-leg-left-shape', { width: 0.2, height: 0.82, depth: 0.29 }, this.scene),
      CreateBox('guide-leg-right-shape', { width: 0.2, height: 0.82, depth: 0.29 }, this.scene),
      CreateBox('guide-shoe-left-shape', { width: 0.25, height: 0.14, depth: 0.38 }, this.scene),
      CreateBox('guide-shoe-right-shape', { width: 0.25, height: 0.14, depth: 0.38 }, this.scene),
    ];
    lower[0].position.set(-0.14, 0.48, 0);
    lower[1].position.set(0.14, 0.48, 0);
    lower[2].position.set(-0.14, 0.07, 0.06);
    lower[3].position.set(0.14, 0.07, 0.06);
    this.configureGuidePart(Mesh.MergeMeshes(lower, true, true)!, 'guide-lower', material, 'trousers', school);

    const skin = [
      CreateSphere('guide-head-shape', { diameter: 0.46, segments: 8 }, this.scene),
      CreateSphere('guide-hand-left-shape', { diameter: 0.16, segments: 6 }, this.scene),
      CreateSphere('guide-hand-right-shape', { diameter: 0.16, segments: 6 }, this.scene),
    ];
    skin[0].position.y = 1.84;
    skin[1].position.set(-0.49, 0.88, 0);
    skin[2].position.set(0.49, 0.88, 0);
    this.configureGuidePart(Mesh.MergeMeshes(skin, true, true)!, 'guide-skin', material, 'skin', school);

    const hair = CreateSphere('guide-hair-shape', { diameter: 0.49, segments: 8 }, this.scene);
    hair.scaling.y = 0.42;
    hair.position.y = 2.0;
    this.configureGuidePart(hair, 'guide-hair', material, 'hair', school);
  }

  private configureGuidePart(
    mesh: Mesh,
    name: string,
    material: StandardMaterial,
    colorKey: keyof typeof GUIDE_COLORS,
    school: SchoolFrame,
  ): void {
    mesh.name = name;
    mesh.material = material;
    // En escritorio estas figuras no se usan para raycast. En VR se habilitan
    // junto con los marcadores para que el gatillo también funcione apuntando
    // al docente, no solo al rombo flotante.
    mesh.isPickable = this.inXR;
    mesh.useVertexColors = true;
    const matrices = new Float32Array(this.stations.length * 16);
    const colors = new Float32Array(this.stations.length * 4);
    for (let i = 0; i < this.stations.length; i++) {
      const station = this.stations[i];
      // Cada docente mira hacia la puerta por la que se llega a su estación.
      const rotation = Quaternion.RotationYawPitchRoll(school.rot + STATION_SPOTS[station.id].yaw, 0, 0);
      const transform = Matrix.Compose(Vector3.One(), rotation, station.position);
      matrices.set(transform.m, i * 16);
      const color = Color3.FromHexString(GUIDE_COLORS[colorKey][i]);
      colors.set([color.r, color.g, color.b, 1], i * 4);
    }
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
    mesh.thinInstanceSetBuffer('color', colors, 4, true);
    mesh.thinInstanceRefreshBoundingInfo(true);
    mesh.freezeWorldMatrix();
    this.guideMeshes.push(mesh);
  }

  private update = (): void => {
    // Reconciliar el estado además del observable: algunos navegadores XR pueden
    // entregar el primer IN_XR antes de que se suscriba el panel de desafíos.
    const xrState = this.xrExperience?.baseExperience.state;
    if (xrState !== undefined && (xrState === WebXRState.IN_XR) !== this.inXR) {
      this.onXRStateChanged(xrState);
    }
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    this.elapsed += dt;
    this.updateBeaconMatrices();

    if (this.active) return;
    const nearby = this.findNearby();
    if (this.inXR) {
      const prompt = nearby
        ? `${nearby.guide}\nA menos de 5 m: apuntá y apretá gatillo izquierdo`
        : null;
      this.xrPanel?.setLabel(prompt, nearby?.position);
      this.promptEl.classList.add('hidden');
      return;
    }
    this.xrPanel?.setLabel(null);
    if (nearby?.id === this.nearbyId) return;
    this.nearbyId = nearby?.id ?? null;
    this.promptEl.classList.toggle('hidden', !nearby);
    if (nearby) this.promptName.textContent = `${nearby.guide} · ${nearby.short}`;
  };

  private onXRStateChanged = (state: WebXRState): void => {
    const entering = state === WebXRState.IN_XR && !this.inXR;
    const leaving = state !== WebXRState.IN_XR && this.inXR;
    this.inXR = state === WebXRState.IN_XR;
    if (this.beaconMesh) this.beaconMesh.isPickable = this.inXR;
    for (const guide of this.guideMeshes) guide.isPickable = this.inXR;
    if (entering) {
      if (this.active) this.close();
      this.showXRWelcome();
    } else if (leaving) {
      if (this.xrWelcomeTimer !== null) clearTimeout(this.xrWelcomeTimer);
      this.xrWelcomeTimer = null;
      this.xrPanel?.hide();
      this.xrPanel?.setLabel(null);
      this.setXRPanelActive(false);
      if (this.active) this.close();
    }
  };

  private showXRWelcome(): void {
    const panel = this.xrPanel;
    const camera = this.xrExperience?.baseExperience.camera;
    if (!panel || !camera) return;
    // La bienvenida orienta, pero no debe bloquear el movimiento. Si el panel
    // no aparece por una diferencia del navegador XR, el recorrido sigue usable.
    const viewer = camera.globalPosition;
    const forward = camera.getDirection(new Vector3(0, 0, 1));
    forward.y = 0;
    forward.normalize();
    panel.placeFacing(viewer, new Vector3(viewer.x + forward.x, viewer.y, viewer.z + forward.z));
    panel.showMessage(
      'RECORRIDO CIMDIP',
      'CONTROLES VR',
      'Stick izquierdo: caminar. Gatillo izquierdo: apuntar al torso o la cabeza del docente y conversar; usalo también para elegir respuestas. Gatillo derecho: teletransportarte.',
      'Cerca de un docente, apuntale y presioná el gatillo izquierdo.',
      'INICIO',
      () => {
        if (this.xrWelcomeTimer !== null) clearTimeout(this.xrWelcomeTimer);
        this.xrWelcomeTimer = null;
        panel.hide();
      },
    );
    // La bienvenida se cierra sola para que nunca deje al usuario detenido si
    // el botón 3D no recibe el puntero del visor.
    if (this.xrWelcomeTimer !== null) clearTimeout(this.xrWelcomeTimer);
    this.xrWelcomeTimer = setTimeout(() => {
      panel.hide();
      this.xrWelcomeTimer = null;
    }, 10000);
  }

  private onXRPointer = (info: PointerInfo): void => {
    if (
      !this.inXR ||
      this.active ||
      info.type !== PointerEventTypes.POINTERDOWN
    ) {
      return;
    }
    const pick = info.pickInfo;
    const pickedMesh = pick?.pickedMesh;
    if (
      !pick?.hit ||
      !pickedMesh ||
      (pickedMesh !== this.beaconMesh && !this.guideMeshes.some((guide) => guide.uniqueId === pickedMesh.uniqueId)) ||
      pick.thinInstanceIndex < 0
    ) return;
    const station = this.stations[pick.thinInstanceIndex];
    if (station && this.findNearby()?.id === station.id) this.open(station);
  };

  private viewerPosition(): Vector3 {
    if (this.inXR && this.xrExperience) return this.xrExperience.baseExperience.camera.globalPosition;
    return this.camera.globalPosition;
  }

  /** Selección directa por rayo: no depende de que el navegador reporte bien el thin-instance pick. */
  interactWithRay(ray: Ray): boolean {
    if (!this.inXR || this.active) return false;

    const viewer = this.viewerPosition();
    const maxDistanceSquared = INTERACT_RANGE * INTERACT_RANGE;
    let best: Station | null = null;
    let bestRayDistanceSquared = 0.85 * 0.85;
    const rayDirection = ray.direction;

    for (const station of this.stations) {
      const dx = viewer.x - station.position.x;
      const dz = viewer.z - station.position.z;
      if (dx * dx + dz * dz > maxDistanceSquared) continue;

      // Probar torso y cabeza como blancos amplios hace que apuntar se sienta
      // tolerante desde un mando, incluso si falla el raycast de thin instances.
      for (const height of [0.9, 1.35, 1.8]) {
        const toTargetX = station.position.x - ray.origin.x;
        const toTargetY = station.position.y + height - ray.origin.y;
        const toTargetZ = station.position.z - ray.origin.z;
        const alongRay = toTargetX * rayDirection.x + toTargetY * rayDirection.y + toTargetZ * rayDirection.z;
        if (alongRay < 0 || alongRay > 9) continue;
        const offsetX = toTargetX - rayDirection.x * alongRay;
        const offsetY = toTargetY - rayDirection.y * alongRay;
        const offsetZ = toTargetZ - rayDirection.z * alongRay;
        const rayDistanceSquared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
        if (rayDistanceSquared >= bestRayDistanceSquared) continue;
        best = station;
        bestRayDistanceSquared = rayDistanceSquared;
      }
    }

    if (!best) return false;
    this.open(best);
    return true;
  }

  private setXRPanelActive(active: boolean): void {
    this.setXRMovementEnabled?.(!active);
    if (this.xrTeleportation) this.xrTeleportation.teleportationEnabled = !active;
  }

  private findNearby(): Station | null {
    let nearest: Station | null = null;
    let best = INTERACT_RANGE * INTERACT_RANGE;
    const viewer = this.viewerPosition();
    for (const station of this.stations) {
      const dx = viewer.x - station.position.x;
      const dz = viewer.z - station.position.z;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        nearest = station;
      }
    }
    return nearest;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.active) {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.code !== 'KeyE' || this.active || !this.canTalk()) return;
    const station = this.findNearby();
    if (!station) return;
    event.preventDefault();
    this.open(station);
  };

  private open(station: Station): void {
    this.active = station;
    if (this.xrWelcomeTimer !== null) clearTimeout(this.xrWelcomeTimer);
    this.xrWelcomeTimer = null;
    this.questionIndex = 0;
    this.introPending = true;
    this.nearbyId = station.id;
    if (this.inXR) {
      const panel = this.xrPanel;
      if (!panel) return;
      this.setXRPanelActive(true);
      this.xrPanel?.setLabel(null);
      this.onModalChange(true);
      panel.placeFacing(this.viewerPosition(), station.position);
      panel.showMessage(
        station.guide,
        station.title,
        station.greeting,
        'Usá el control izquierdo: apuntá a una respuesta y presioná el gatillo.',
        'PRESENTACIÓN',
        () => this.renderXRQuestion(),
      );
      return;
    }
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.promptEl.classList.add('hidden');
    this.dialog.classList.remove('hidden');
    this.dialog.setAttribute('aria-hidden', 'false');
    this.onModalChange(true);
    this.renderQuestion();
  }

  private renderXRQuestion(message = ''): void {
    const station = this.active;
    const panel = this.xrPanel;
    if (!station || !panel) return;
    const question = station.questions[this.questionIndex];
    panel.showQuestion(
      {
        title: station.guide,
        step: `${station.title} · pregunta ${this.questionIndex + 1}`,
        question: question.prompt,
        options: question.options,
        feedback: message,
        progress: `${this.completed.size} / ${DEFINITIONS.length} docentes`,
      },
      (choice) => this.answer(choice),
      () => this.close(),
    );
  }

  private renderQuestion(message = ''): void {
    const station = this.active;
    if (!station) return;
    const question = station.questions[this.questionIndex];
    const greeting = this.introPending ? `<p class="challenge-greeting">${station.greeting}</p>` : '';
    this.introPending = false;
    this.dialogTitle.textContent = station.guide;
    this.dialogBody.innerHTML = `
      <p class="challenge-step">${station.title} · ${this.questionIndex + 1}/${station.questions.length}</p>
      ${greeting}
      <p class="challenge-question">${question.prompt}</p>
      <div class="challenge-options">
        ${question.options.map((option, index) => `<button class="challenge-choice" type="button" data-choice="${index}">${option}</button>`).join('')}
      </div>
      <p class="challenge-feedback ${message ? 'show' : ''}" role="status" aria-live="polite">${message}</p>
      <button class="challenge-close" type="button">Cerrar conversación <kbd>Esc</kbd></button>
    `;
    for (const button of this.dialogBody.querySelectorAll<HTMLButtonElement>('.challenge-choice')) {
      button.addEventListener('click', () => this.answer(Number(button.dataset.choice)));
    }
    this.dialogBody.querySelector<HTMLButtonElement>('.challenge-close')?.addEventListener('click', () => this.close());
    this.dialogBody.querySelector<HTMLButtonElement>('.challenge-choice')?.focus();
  }

  private answer(choice: number): void {
    const station = this.active;
    if (!station) return;
    const question = station.questions[this.questionIndex];
    if (choice !== question.answer) {
      if (this.inXR) {
        this.renderXRQuestion('No es esa. Pensá la situación y volvé a elegir.');
        return;
      }
      this.renderQuestion('Probá otra vez: observá la consigna y elegí la acción más segura.');
      return;
    }
    if (this.questionIndex < station.questions.length - 1) {
      this.questionIndex++;
      if (this.inXR) {
        this.renderXRQuestion(`Correcto. ${question.explanation}`);
        return;
      }
      this.renderQuestion(`Correcto. ${question.explanation}`);
      return;
    }

    this.completed.add(station.id);
    const color = Color3.FromHexString(station.color).scale(0.95);
    this.beaconColors.set([color.r, color.g, color.b, 1], station.beaconIndex * 4);
    this.beaconMesh?.thinInstanceBufferUpdated('color');
    this.persist();
    this.updateMission();
    if (this.inXR) {
      this.xrPanel?.showMessage(
        station.guide,
        'ESTACIÓN COMPLETADA',
        question.explanation,
        '+1 conocimiento',
        `${this.completed.size} / ${DEFINITIONS.length}`,
        () => this.close(),
      );
      return;
    }
    this.dialogBody.innerHTML = `
      <p class="challenge-step">ESTACIÓN COMPLETADA</p>
      <p class="challenge-question">${question.explanation}</p>
      <p class="challenge-feedback show">+1 conocimiento</p>
      <button class="challenge-close" type="button">Continuar</button>
    `;
    this.dialogBody.querySelector<HTMLButtonElement>('.challenge-close')?.addEventListener('click', () => this.close());
  }

  private close(): void {
    this.active = null;
    this.nearbyId = null;
    this.xrPanel?.hide();
    this.setXRPanelActive(false);
    this.dialog.classList.add('hidden');
    this.dialog.setAttribute('aria-hidden', 'true');
    this.onModalChange(false);
    this.previousFocus?.focus();
    this.previousFocus = null;
  }

  private updateMission(): void {
    const count = this.completed.size;
    this.missionEl.classList.remove('hidden');
    this.missionProgress.style.setProperty('--progress', `${(count / DEFINITIONS.length) * 100}%`);
    this.missionProgress.textContent = `${count} / ${DEFINITIONS.length}`;
    this.missionTitle.textContent =
      count === DEFINITIONS.length
        ? '¡Completaste las cinco charlas! Tu avance quedó guardado en este dispositivo.'
        : 'Recorré el campus, acercate a los docentes y respondé sus preguntas.';
  }

  private restore(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) {
        for (const id of saved) {
          if (DEFINITIONS.some((definition) => definition.id === id)) this.completed.add(id);
        }
      }
    } catch {
      // El desafío sigue funcionando aunque el navegador no permita persistencia.
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.completed]));
    } catch {
      // Persistir es una mejora de experiencia, no una razón para bloquear el juego.
    }
  }

  dispose(): void {
    if (this.xrWelcomeTimer !== null) clearTimeout(this.xrWelcomeTimer);
    this.xrWelcomeTimer = null;
    if (this.active) this.onModalChange(false);
    window.removeEventListener('keydown', this.onKeyDown);
    this.scene.onBeforeRenderObservable.remove(this.beforeRender);
    this.scene.onPointerObservable.remove(this.xrPointer);
    if (this.xrExperience && this.xrStateObserver) {
      this.xrExperience.baseExperience.onStateChangedObservable.remove(this.xrStateObserver);
    }
    this.setXRPanelActive(false);
    this.xrPanel?.dispose();
    this.xrPanel = null;
    this.stations.length = 0;
    this.beaconMesh?.dispose();
    this.beaconMesh = null;
    this.beaconMaterial?.dispose();
    this.beaconMaterial = null;
    for (const mesh of this.guideMeshes) mesh.dispose();
    this.guideMeshes.length = 0;
    for (const material of this.guideMaterials) material.dispose();
    this.guideMaterials.length = 0;
  }
}
