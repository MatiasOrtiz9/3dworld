import type { Scene } from '@babylonjs/core/scene';
import { InstanceFarm } from '../core/InstanceFarm';
import { Materials } from './Materials';
import { Rng } from '../utils/rng';
import { generateCityPlan, type CityPlan, type LayoutOptions } from './CityLayout';
import { NatureBuilder } from './builders/NatureBuilder';
import { BuildingBuilder } from './builders/BuildingBuilder';
import { InfraBuilder } from './builders/InfraBuilder';
import { StreetLevel } from './builders/StreetLevel';
import { CityIndex } from './CityIndex';
import { PALETTE } from './Palette';
import { SchoolIdentity } from './SchoolIdentity';
import { SchoolBuilder } from './builders/SchoolBuilder';
import type { Block } from './CityLayout';
import type { SchoolFrame } from './SchoolLayout';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * Clave del material de ventana encendida.
 *
 * Tiene que coincidir con la que genera `Materials.glow()`, que arma su clave
 * como `e:<hex>:<intensidad>`.
 */
const LIT_WINDOW_KEY = `e:${PALETTE.glassLit.toHexString()}:0.7`;

export interface CityStats {
  seed: number;
  blocks: number;
  instances: number;
  triangles: number;
  drawCalls: number;
  materials: number;
  buildTimeMs: number;
}

export interface CityOptions extends LayoutOptions {
  /** Multiplicador de densidad de vegetación (la palanca de calidad más útil). */
  greenDensity?: number;
  /** Follaje de alto detalle en los árboles grandes. */
  highDetailFoliage?: boolean;
  /** Detalle fino a nivel de calle. */
  highDetailStreet?: boolean;
}

/**
 * La ciudad.
 *
 * Orquesta el plano y los constructores, y deja todo en una sola granja de
 * instancias. Toda la geometría se genera por código: no hay un solo modelo 3D
 * descargado, ni una sola textura. La ciudad completa son primitivas
 * (cajas, cilindros, conos, esferas) combinadas con criterio.
 */
export class City {
  readonly plan: CityPlan;
  readonly stats: CityStats;
  readonly index: CityIndex;
  readonly school: Block;
  /** Marco local del campus: orientación y coordenadas de la escuela. */
  readonly schoolFrame: SchoolFrame;
  private readonly farm: InstanceFarm;
  private readonly mats: Materials;
  private readonly schoolIdentity: SchoolIdentity;
  /** Pisos, losas y volúmenes poligonales de la escuela (fuera de la granja). */
  private schoolMeshes: Mesh[] = [];

  constructor(scene: Scene, seed: number, options: CityOptions = {}) {
    const t0 = performance.now();

    this.plan = generateCityPlan(seed, options);
    this.index = new CityIndex(this.plan);
    const school = this.plan.blocks.find((block) => block.landmark === 'school');
    if (!school || !this.index.school) throw new Error('El plano no contiene una escuela');
    this.school = school;
    this.schoolFrame = this.index.school;
    this.farm = new InstanceFarm(scene);
    this.mats = new Materials(scene);

    const rng = new Rng(seed ^ 0x9e3779b9);
    const nature = new NatureBuilder(
      this.farm,
      this.mats,
      rng,
      options.highDetailFoliage ?? true,
    );
    const street = new StreetLevel(
      this.farm,
      this.mats,
      rng,
      options.highDetailStreet ?? true,
    );
    const buildings = new BuildingBuilder(this.farm, this.mats, rng, nature, street);
    const schoolBuilder = new SchoolBuilder(this.farm, this.mats, rng, nature, street);
    const infra = new InfraBuilder(
      this.farm,
      this.mats,
      rng,
      nature,
      buildings,
      street,
      options.greenDensity ?? 1,
    );

    infra.ground(this.plan);
    infra.streets(this.plan);

    for (const block of this.plan.blocks) {
      switch (block.kind) {
        case 'park':
          infra.park(block);
          break;
        case 'energy':
          infra.energy(block);
          break;
        case 'water':
          // El canal se dibuja una vez, entero, no manzana por manzana.
          break;
        default:
          // La escuela ocupa dos manzanas: se levanta una vez, desde la principal.
          if (block.landmark === 'school') this.schoolMeshes = schoolBuilder.build(this.schoolFrame, this.plan, scene);
          else if (!block.landmark) buildings.build(block);
          break;
      }
      infra.streetscape(block, this.plan);
    }

    // El canal va último: se superpone a lo que haya quedado debajo.
    infra.canal(this.plan);

    this.farm.commit();
    this.schoolIdentity = new SchoolIdentity(scene, this.schoolFrame);

    const schoolTris = this.schoolMeshes.reduce((n, m) => n + m.getTotalIndices() / 3, 0);
    this.stats = {
      seed,
      blocks: this.plan.blocks.length,
      instances: this.farm.instanceCount,
      triangles: this.farm.triangleCount + schoolTris,
      drawCalls: this.farm.drawCalls,
      materials: this.mats.count,
      buildTimeMs: Math.round(performance.now() - t0),
    };
  }

  /**
   * Congela los materiales. Debe llamarse DESPUÉS de configurar las sombras,
   * si no los shaders se quedan sin los defines de sombra.
   */
  freezeMaterials(): void {
    this.mats.freezeAll();
  }

  /** Calienta unas pocas variantes del encuadre inicial sin bloquear el arranque. */
  async precompile(
    camera: Camera | null,
    onProgress?: (done: number, total: number) => void,
    budgetMs = 1400,
  ): Promise<{ compiled: number; total: number; ms: number }> {
    const t0 = performance.now();
    const allMeshes = [...this.farm.sourceMeshes, ...this.schoolMeshes];
    // Solo calentamos materiales que aparecen desde la cámara de inicio. El
    // barrido anterior empezaba por la malla más grande de toda la ciudad —a
    // menudo follaje que ni siquiera entra en cuadro— y llamaba varias veces
    // al mismo material compartido.
    const visibleMeshes = camera ? allMeshes.filter((mesh) => camera.isInFrustum(mesh)) : allMeshes;
    const candidates = visibleMeshes.length ? visibleMeshes : allMeshes;
    candidates.sort((a, b) => {
      const position = camera?.globalPosition;
      if (!position) return b.thinInstanceCount * b.getTotalIndices() - a.thinInstanceCount * a.getTotalIndices();
      const aDistance = Vector3.DistanceSquared(a.getBoundingInfo().boundingSphere.centerWorld, position);
      const bDistance = Vector3.DistanceSquared(b.getBoundingInfo().boundingSphere.centerWorld, position);
      return aDistance - bDistance;
    });

    // Un material puede estar en cientos de mallas. Compilarlo una vez alcanza
    // para que Babylon reutilice el programa; 4 variantes visibles son
    // suficientes para dibujar la primera vista sin retener la pantalla.
    const seenMaterials = new Set<number>();
    const meshes = candidates.filter((mesh) => {
      const id = mesh.material?.uniqueId;
      if (id === undefined || seenMaterials.has(id)) return false;
      seenMaterials.add(id);
      return true;
    }).slice(0, 4);

    let done = 0;
    onProgress?.(done, Math.max(1, meshes.length));
    for (const mesh of meshes) {
      if (performance.now() - t0 > budgetMs) break;
      const mat = mesh.material;
      if (mat) {
        // forceCompilationAsync es asíncrono y puede tardar mucho más que el
        // presupuesto en una GPU integrada. No lo podemos cancelar, pero sí
        // dejar que siga en segundo plano y arrancar el render en 700 ms.
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const compiling = mat.forceCompilationAsync(mesh).then(
          () => true,
          () => true,
        );
        const ready = await Promise.race([
          compiling,
          new Promise<boolean>((resolve) => {
            timeout = setTimeout(() => resolve(false), 700);
          }),
        ]);
        if (timeout !== undefined) clearTimeout(timeout);
        if (!ready) break;
      }
      onProgress?.(++done, Math.max(1, meshes.length));
    }
    return { compiled: done, total: meshes.length, ms: Math.round(performance.now() - t0) };
  }

  /** Avanza el reloj del viento del follaje. */
  tickWind(deltaSeconds: number): void {
    this.mats.tickWind(deltaSeconds);
  }

  /** Reloj del viento, en segundos. */
  get windClock(): number {
    return this.mats.windClock;
  }

  /**
   * Enciende o apaga las ventanas iluminadas.
   *
   * Las dos variantes —apagada y encendida— se generan juntas al construir la
   * ciudad; acá sólo se conmuta cuál se dibuja.
   */
  setLitWindows(on: boolean): void {
    this.farm.setGroupEnabled(LIT_WINDOW_KEY, on);
  }

  /** Desglose de coste, para diagnosticar rendimiento. */
  breakdown() {
    return this.farm.breakdown();
  }

  /** Mallas fuente, para registrarlas como proyectoras de sombra. */
  get shadowCasters() {
    return [...this.farm.sourceMeshes, ...this.schoolMeshes, ...this.schoolIdentity.shadowCasters];
  }

  dispose(): void {
    this.farm.dispose();
    for (const mesh of this.schoolMeshes) mesh.dispose();
    this.schoolMeshes = [];
    this.mats.dispose();
    this.schoolIdentity.dispose();
  }
}
