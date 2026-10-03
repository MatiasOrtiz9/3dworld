import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CityPlan } from './CityLayout';
import { TrafficSim, type TrafficEvent } from './life/traffic';
import { TrafficView, type ViewState } from './life/TrafficView';
import { BirdSim, pigeonSpots } from './life/birdSim';
import { BirdsView } from './life/BirdsView';
import { createLifeMaterials, type LifeMaterials } from './life/lifeMaterials';

export interface LifeOptions {
  /**
   * Detalle de escritorio (más autos, bandadas más grandes, palomas en más
   * veredas). Sin indicarlo se toma del perfil de calidad vigente
   * (`highDetailStreet`): en el visor, menos.
   */
  detailed?: boolean;
  /** Altura de la superficie pisable (veredas elevadas, frente de la escuela). */
  ground?: (x: number, z: number) => number;
}

/**
 * La vida de la calle: tránsito y pájaros.
 *
 * - Tránsito (`life/traffic`): autos, taxis negros y amarillos, utilitarios,
 *   motos de reparto, bicis y una línea de colectivo con parada sobre
 *   Laprida, por todas las calles del barrio y respetando por dónde existen.
 *   Semáforos en los cruces de cuatro brazos, pare en las T, frenada y
 *   arranque suaves, faros y luces de freno que se leen al atardecer.
 * - Pájaros (`life/birdSim`): bandadas que cruzan el cielo, chimangos
 *   planeando, cotorras que pasan bajo por la calle del jugador y palomas en
 *   las veredas que vuelan si uno se les acerca.
 *
 * Todo con thin instances compactadas por cuadro (10 draw calls en total
 * con todo a la vista) y sin crear objetos por cuadro. La lógica es pura y
 * se prueba sin motor (`tests/lifeTraffic.test.ts`, `tests/lifeBirds.test.ts`).
 */
export class Life {
  readonly traffic: TrafficSim;
  readonly birds: BirdSim;
  private readonly mats: LifeMaterials;
  private readonly trafficView: TrafficView;
  private readonly birdsView: BirdsView;
  private readonly observer: Observer<Scene> | null;
  private readonly sun: DirectionalLight | null;
  private readonly view: ViewState = { x: 0, y: 0, z: 0, fx: 0, fz: 1, night: 0, time: 0 };
  private readonly viewer = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
  private readonly fwd = new Vector3();
  /** Costo de `update` (ms, promedio móvil) para las herramientas de medición. */
  readonly stats = { ms: 0, peakMs: 0, vehicles: 0 };

  constructor(
    private readonly scene: Scene,
    plan: CityPlan,
    seed: number,
    opts: LifeOptions = {},
  ) {
    const detailed = opts.detailed ?? detectDetailed();
    const lite = !detailed;
    const ground = opts.ground ?? detectGround();
    this.mats = createLifeMaterials(scene);
    this.traffic = new TrafficSim(plan, seed, { lite });
    this.trafficView = new TrafficView(scene, this.traffic, this.mats, { lite, ground });
    this.birds = new BirdSim(plan, seed, pigeonSpots(plan, lite), ground, lite);
    this.birdsView = new BirdsView(scene, this.birds, this.mats, lite);
    this.sun = (scene.getLightByName('sun') as DirectionalLight | null) ?? null;
    this.observer = scene.onBeforeRenderObservable.add(this.update);
    if (import.meta.env.DEV) {
      // Gancho de medición para las herramientas (tools/): costo por cuadro,
      // vehículos y pájaros. Sólo en desarrollo.
      (globalThis as { __life?: Life }).__life = this;
    }
  }

  /** Eventos del tránsito para el sonido: el colectivo para y arranca, alguien toca bocina. */
  setOnTrafficEvent(cb: (e: TrafficEvent, x: number, z: number) => void): void {
    this.traffic.setOnEvent(cb);
  }

  /** Las palomas de una vereda levantan vuelo (aleteo). */
  setOnPigeonFlush(cb: (x: number, z: number) => void): void {
    this.birds.setOnFlush(cb);
  }

  /** Tránsito cerca de un punto (para el sonido de la calle). */
  nearestTraffic(x: number, z: number): { distance: number; speed: number; count20: number } {
    return this.traffic.nearest(x, z);
  }

  private update = (): void => {
    const t0 = performance.now();
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    const cam: Camera | null = this.scene.activeCamera;
    const view = this.view;
    if (cam) {
      const p = cam.globalPosition;
      view.x = p.x;
      view.y = p.y;
      view.z = p.z;
      cam.getDirectionToRef(Vector3.Forward(this.scene.useRightHandedSystem), this.fwd);
      const l = Math.hypot(this.fwd.x, this.fwd.z);
      view.fx = l > 1e-3 ? this.fwd.x / l : 0;
      view.fz = l > 1e-3 ? this.fwd.z / l : 0;
    }
    view.time += dt;
    view.night = nightFactor(this.sun);
    const viewer = this.viewer;
    viewer.x = view.x;
    viewer.y = view.y;
    viewer.z = view.z;
    viewer.fx = view.fx;
    viewer.fz = view.fz;

    this.traffic.step(dt, viewer);
    this.trafficView.update(view);
    this.birds.step(dt, viewer);
    this.birdsView.update(view.x, view.z);

    const ms = performance.now() - t0;
    this.stats.ms += (ms - this.stats.ms) * 0.05;
    this.stats.peakMs = Math.max(this.stats.peakMs * 0.995, ms);
    this.stats.vehicles = this.traffic.activeCount;
  };

  dispose(): void {
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer);
    this.trafficView.dispose();
    this.birdsView.dispose();
    this.mats.dispose();
    const g = globalThis as { __life?: Life };
    if (g.__life === this) delete g.__life;
  }
}

/**
 * 0 de día, 1 de noche, según la altura del sol: a la hora dorada los faros
 * ya se prenden a medias y al anochecer, del todo.
 */
function nightFactor(sun: DirectionalLight | null): number {
  if (!sun) return 0;
  const d = sun.direction;
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  const elevation = Math.asin(Math.max(-1, Math.min(1, -d.y / l)));
  return Math.max(0, Math.min(1, (0.14 - elevation) / 0.12));
}

/**
 * Perfil de calidad vigente, si `main.ts` no lo pasa: el gestor de calidad
 * queda en `window.__quality` (el visor arma la escuela con `highDetailStreet`
 * apagado).
 */
function detectDetailed(): boolean {
  const q = (globalThis as { __quality?: { profile?: { highDetailStreet?: boolean } } }).__quality;
  return q?.profile?.highDetailStreet ?? true;
}

/** Altura del piso, si `main.ts` no la pasa: el índice de la ciudad vigente. */
function detectGround(): (x: number, z: number) => number {
  const get = (
    globalThis as { __index?: () => { surfaceHeight(x: number, z: number): number } | null }
  ).__index;
  return (x, z) => {
    const idx = get?.();
    return idx ? idx.surfaceHeight(x, z) : 0;
  };
}
