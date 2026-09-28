import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { STATION_SPOTS, toWorld, type SchoolFrame } from '../world/SchoolLayout';

type StationId = 'tech' | 'robotics' | 'science' | 'sport' | 'environment';

interface Question {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}

interface StationDefinition {
  id: StationId;
  title: string;
  short: string;
  color: string;
  questions: Question[];
}

interface Station extends StationDefinition {
  position: Vector3;
  beacon: Mesh;
  material: StandardMaterial;
}

const STORAGE_KEY = 'cimdip-challenge-progress-v1';
const INTERACT_RANGE = 8;

const DEFINITIONS: StationDefinition[] = [
  {
    id: 'tech',
    title: 'Tecnología',
    short: 'Aula Maker',
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
    title: 'Robótica',
    short: 'Secuencia de robot',
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
    title: 'Ciencia',
    short: 'Mesa de experimentos',
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
    title: 'Deporte',
    short: 'Circuito activo',
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
    title: 'Medio ambiente',
    short: 'Energía y residuos',
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

/** Cinco microdesafíos físicos que convierten el recorrido en una misión. */
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
  private active: Station | null = null;
  private stands: Mesh | null = null;
  private standMaterial: StandardMaterial | null = null;
  private questionIndex = 0;
  private nearbyId: StationId | null = null;
  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    school: SchoolFrame,
  ) {
    this.restore();
    this.createStations(school);
    this.beforeRender = this.scene.onBeforeRenderObservable.add(this.update);
    window.addEventListener('keydown', this.onKeyDown);
    this.updateMission();
  }

  private createStations(school: SchoolFrame): void {
    // Las estaciones están DENTRO del campus (ver SchoolLayout): explanada,
    // patio y huerta. Antes se derivaban de fracciones de la manzana y dos
    // quedaban en medio de la calle y otra del otro lado, junto a la plaza.
    //
    // Cada estación es un pedestal sobrio y un diamante de su color que flota
    // y gira: se lee como "punto interactivo" sin parecer un chupetín. Los
    // cinco pedestales se funden en UNA malla; en total, 6 draw calls en vez
    // de los 15 de antes.
    this.standMaterial = new StandardMaterial('station-stand', this.scene);
    this.standMaterial.diffuseColor = Color3.FromHexString('#1f5147').scale(0.6);
    this.standMaterial.emissiveColor = Color3.FromHexString('#1f5147').scale(0.25);
    this.standMaterial.specularColor = new Color3(0.08, 0.08, 0.08);

    const parts: Mesh[] = [];
    for (const definition of DEFINITIONS) {
      const spot = STATION_SPOTS[definition.id];
      const w = toWorld(school, spot.u, spot.v);
      const position = new Vector3(w.x, 0.05, w.z);
      const color = Color3.FromHexString(definition.color);
      const material = new StandardMaterial(`station-${definition.id}`, this.scene);
      material.diffuseColor = color.scale(0.35);
      material.emissiveColor = this.completed.has(definition.id) ? color.scale(0.95) : color.scale(0.6);
      material.specularColor = new Color3(0.3, 0.3, 0.3);

      const pieces: Array<[number, number, number]> = [
        // diámetro, alto, altura del centro
        [1.5, 0.16, 0.08],
        [0.34, 1.12, 0.72],
        [0.82, 0.08, 1.3],
      ];
      for (const [dia, h, y] of pieces) {
        const c = CreateCylinder(`station-part-${definition.id}`, { diameter: dia, height: h, tessellation: 6 }, this.scene);
        c.position.set(position.x, position.y + y, position.z);
        parts.push(c);
      }

      const beacon = CreatePolyhedron(`station-${definition.id}`, { type: 1, size: 0.3 }, this.scene);
      beacon.position.set(position.x, 2.05, position.z);
      beacon.scaling.set(1, 1.55, 1);
      beacon.material = material;
      beacon.isPickable = true;

      this.stations.push({ ...definition, position, beacon, material });
    }
    const stands = Mesh.MergeMeshes(parts, true, true);
    if (stands) {
      stands.name = 'station-stands';
      stands.material = this.standMaterial;
      stands.isPickable = false;
      stands.freezeWorldMatrix();
      this.stands = stands;
    }
  }

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    this.elapsed += dt;
    for (const station of this.stations) {
      // Gira y flota: el movimiento es lo que lo distingue del mobiliario.
      const phase = this.elapsed * 1.6 + station.position.x;
      station.beacon.rotation.y += dt * 1.1;
      station.beacon.position.y = 2.05 + Math.sin(phase) * 0.07;
    }

    if (this.active) return;
    const nearby = this.findNearby();
    if (nearby?.id === this.nearbyId) return;
    this.nearbyId = nearby?.id ?? null;
    this.promptEl.classList.toggle('hidden', !nearby);
    if (nearby) this.promptName.textContent = nearby.title;
  };

  private findNearby(): Station | null {
    let nearest: Station | null = null;
    let best = INTERACT_RANGE * INTERACT_RANGE;
    for (const station of this.stations) {
      const dx = this.camera.position.x - station.position.x;
      const dz = this.camera.position.z - station.position.z;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        nearest = station;
      }
    }
    return nearest;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyE' || this.active) return;
    const station = this.findNearby();
    if (!station) return;
    event.preventDefault();
    this.open(station);
  };

  private open(station: Station): void {
    this.active = station;
    this.questionIndex = 0;
    this.promptEl.classList.add('hidden');
    this.dialog.classList.remove('hidden');
    this.dialog.setAttribute('aria-hidden', 'false');
    this.renderQuestion();
  }

  private renderQuestion(message = ''): void {
    const station = this.active;
    if (!station) return;
    const question = station.questions[this.questionIndex];
    this.dialogTitle.textContent = station.title;
    this.dialogBody.innerHTML = `
      <p class="challenge-step">${station.short} · ${this.questionIndex + 1}/${station.questions.length}</p>
      <p class="challenge-question">${question.prompt}</p>
      <div class="challenge-options">
        ${question.options.map((option, index) => `<button class="challenge-choice" data-choice="${index}">${option}</button>`).join('')}
      </div>
      <p class="challenge-feedback ${message ? 'show' : ''}">${message}</p>
      <button class="challenge-close" type="button">Cerrar</button>
    `;
    for (const button of this.dialogBody.querySelectorAll<HTMLButtonElement>('.challenge-choice')) {
      button.addEventListener('click', () => this.answer(Number(button.dataset.choice)));
    }
    this.dialogBody.querySelector<HTMLButtonElement>('.challenge-close')?.addEventListener('click', () => this.close());
  }

  private answer(choice: number): void {
    const station = this.active;
    if (!station) return;
    const question = station.questions[this.questionIndex];
    if (choice !== question.answer) {
      this.renderQuestion('Probá otra vez: observá la consigna y elegí la acción más segura.');
      return;
    }
    if (this.questionIndex < station.questions.length - 1) {
      this.questionIndex++;
      this.renderQuestion(`Correcto. ${question.explanation}`);
      return;
    }

    this.completed.add(station.id);
    station.material.emissiveColor = Color3.FromHexString(station.color).scale(0.95);
    this.persist();
    this.updateMission();
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
    this.dialog.classList.add('hidden');
    this.dialog.setAttribute('aria-hidden', 'true');
  }

  private updateMission(): void {
    const count = this.completed.size;
    this.missionEl.classList.remove('hidden');
    this.missionProgress.style.setProperty('--progress', `${(count / DEFINITIONS.length) * 100}%`);
    this.missionProgress.textContent = `${count} / ${DEFINITIONS.length}`;
    this.missionTitle.textContent =
      count === DEFINITIONS.length
        ? 'Desafío final desbloqueado: el campus está listo para compartir.'
        : 'Recorré el campus y activá las estaciones de aprendizaje.';
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
    window.removeEventListener('keydown', this.onKeyDown);
    this.scene.onBeforeRenderObservable.remove(this.beforeRender);
    for (const station of this.stations) {
      station.beacon.dispose();
      station.material.dispose();
    }
    this.stations.length = 0;
    this.stands?.dispose();
    this.stands = null;
    this.standMaterial?.dispose();
    this.standMaterial = null;
  }
}
