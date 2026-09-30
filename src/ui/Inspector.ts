import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CityIndex } from '../world/CityIndex';
import type { Block } from '../world/CityLayout';

/**
 * Inspección de la ciudad.
 *
 * Hacer clic sobre un edificio y que te cuente qué es, cuánta gente vive ahí y
 * cuánta energía genera. Es lo que convierte el mundo de "un lugar por donde
 * caminar" en "un lugar que podés interrogar".
 *
 * La detección no usa el picking de Babylon: los edificios son thin instances
 * y no existen como objetos seleccionables. En su lugar se marcha a lo largo
 * del rayo de la cámara consultando el índice de manzanas, que es una simple
 * cuenta aritmética. El coste es de ~120 consultas por clic: nada.
 */
export class Inspector {
  private readonly panel: HTMLDivElement;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly index: CityIndex,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.panel = document.createElement('div');
    this.panel.id = 'inspector';
    this.panel.className = 'hidden';
    document.body.appendChild(this.panel);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.panel.remove();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      null,
      this.camera,
    );
    const hit = this.march(ray.origin, ray.direction);
    if (hit) this.show(hit);
    else this.hide();
  };

  /**
   * Avanza por el rayo hasta encontrar construcción o tocar el suelo.
   * Paso de 1,5 m: fino para no saltarse un edificio angosto, grueso para que
   * 300 m de alcance sean sólo 200 pasos.
   */
  private march(origin: Vector3, dir: Vector3): Block | null {
    const step = 1.5;
    const maxDist = 320;
    for (let d = 1; d < maxDist; d += step) {
      const x = origin.x + dir.x * d;
      const y = origin.y + dir.y * d;
      const z = origin.z + dir.z * d;

      const block = this.index.blockAt(x, z);
      if (block) {
        // Golpeó el volumen construido: hay que estar por debajo de su altura.
        if (this.index.isSolid(x, z) && y <= block.height + 2 && y > -2) return block;
        // O tocó el suelo dentro de una manzana abierta (parque, huerta).
        if (y <= 0.4) return block;
      }
      if (y < -3) return null; // se fue bajo tierra
    }
    return null;
  }

  private show(block: Block): void {
    const i = this.index.describe(block);
    const rows: Array<[string, string]> = [];

    if (i.floors > 0) rows.push(['Plantas', String(i.floors)]);
    if (i.people > 0) rows.push(['Habitantes (est.)', i.people.toLocaleString('es-AR')]);
    if (i.solarM2 > 0) {
      rows.push(['Superficie solar', `${i.solarM2.toLocaleString('es-AR')} m²`]);
      rows.push(['Generación', `${i.kwhDay.toLocaleString('es-AR')} kWh/día`]);
    }
    rows.push(['Posición', `${Math.round(block.cx)} m, ${Math.round(block.cz)} m`]);

    this.panel.innerHTML = `
      <button class="close" aria-label="Cerrar">×</button>
      <h3>${i.label}</h3>
      <p class="detail">${i.detail}</p>
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <p class="note">Valores estimados a partir del plano generado, no medidos.</p>
    `;
    this.panel.querySelector('.close')?.addEventListener('click', () => this.hide());
    this.panel.classList.remove('hidden');
  }

  hide(): void {
    this.panel.classList.add('hidden');
  }
}
