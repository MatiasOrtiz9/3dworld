import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import type { FarmPart, ZoneOf } from '../core/InstanceFarm';
import { LEVEL_Y, ROOMS, SCHOOL, inLot, inPoly, levelOf, roomLevel, type Level, type P, type SchoolFrame } from './SchoolLayout';
import { SchoolVisibility, type Surroundings, type VisibilityData } from './SchoolVisibility';

/**
 * Recorte por zonas de la granja de instancias (ítem 3 del plan "Escuela
 * 2050"): qué trozos de cada malla se dibujan según dónde está la cabeza.
 *
 * La granja arma, además de la malla de siempre de cada combinación
 * primitiva/material, un trozo por zona (`InstanceFarm.setPartition`): el
 * equipamiento de cada ambiente techado, el barrio en cuatro cuadrantes y el
 * resto (fachadas, cubiertas, patios). Acá, una vez por cuadro:
 *
 *  1. Ambientes en los que está la cabeza (`SchoolVisibility.roomsNear`, que
 *     en una puerta devuelve los dos lados) y, con la tabla ambiente → zonas
 *     visibles que calcula el worker, qué trozos pueden verse. Afuera, o
 *     mientras la tabla no llegó, todos.
 *  2. Por combinación, lo más barato entre la malla de siempre (un draw
 *     call, todo) y sus trozos visibles (uno por trozo en cuadro). Las dos
 *     muestran lo mismo de lo que se ve: la elección sólo cambia el costo.
 *     Un draw call vale `DRAW_COST` triángulos.
 *
 * Las sombras usan siempre las mallas de siempre: durante el dibujo de los
 * mapas de sombra se vuelven visibles y después se restituye la elección.
 */

/** Zona del resto: lo que se dibuja siempre que la combinación esté en cuadro. */
export const ZONE_REST = 0;
/** Zona del equipamiento de un ambiente techado (índice en `ROOMS`). */
export const roomZone = (k: number): number => 1 + k;
/** Zona de un cuadrante del barrio (0 este, 1 oeste, 2 norte, 3 sur). */
export const cityZone = (q: number): number => 1 + ROOMS.length + q;

/**
 * Costo de un draw call en triángulos. En el visor cada malla se dibuja una
 * vez por ojo y su costo es de CPU (el navegador del Quest valida cada
 * llamada); 1.500 triángulos de un trozo lejano cuestan menos que eso.
 */
export const DRAW_COST = 1500;
/** Draw calls de más que se aceptan sobre los de la granja sin partir (plan: +20 a 40). */
const EXTRA_DRAWS = 36;
/** Radio de la cabeza para los ambientes vecinos (parado en una puerta, los dos lados). */
const HEAD_REACH = 0.6;
/** Márgenes de un nivel para que algo cuente como "adentro de un ambiente" (ver `schoolZoneOf`). */
const LEVEL_GAP = 0.02;

/**
 * Zona de cada copia de la granja: equipamiento de un ambiente techado si su
 * caja entera queda adentro del polígono y entre el piso y la losa de su
 * nivel; un cuadrante si está fuera del predio; el resto si no.
 *
 * "Entre el piso y la losa" es estricto a propósito: una pieza que toca la
 * losa (un solado del piso de arriba, el canto de una losa) se ve desde los
 * dos niveles y va al resto. Un muro tiene el eje en el borde del polígono y
 * su caja lo cruza: también va al resto, igual que todo lo que cuelga de una
 * fachada. Sólo se esconde lo que está encerrado en un ambiente.
 */
export function schoolZoneOf(frame: SchoolFrame): ZoneOf {
  type Box = { k: number; poly: readonly P[]; u0: number; v0: number; u1: number; v1: number };
  const byLevel: Box[][] = [[], [], []];
  let cu0 = Infinity;
  let cv0 = Infinity;
  let cu1 = -Infinity;
  let cv1 = -Infinity;
  ROOMS.forEach((r, k) => {
    let u0 = Infinity;
    let v0 = Infinity;
    let u1 = -Infinity;
    let v1 = -Infinity;
    for (const [u, v] of r.poly) {
      u0 = Math.min(u0, u);
      v0 = Math.min(v0, v);
      u1 = Math.max(u1, u);
      v1 = Math.max(v1, v);
    }
    cu0 = Math.min(cu0, u0);
    cv0 = Math.min(cv0, v0);
    cu1 = Math.max(cu1, u1);
    cv1 = Math.max(cv1, v1);
    if (r.roofed) byLevel[roomLevel(r)].push({ k, poly: r.poly, u0, v0, u1, v1 });
  });
  // Centro del predio, para los cuadrantes del barrio.
  const mu = (cu0 + cu1) / 2;
  const mv = (cv0 + cv1) / 2;
  const top = (L: number) => (L < 2 ? LEVEL_Y[L + 1] : LEVEL_Y[2] + SCHOOL.storey);
  return (x, y, z, hx, hy, hz) => {
    const u = frame.ox - x;
    const v = z - frame.oz;
    if (!inLot(u, v)) {
      const du = u - mu;
      const dv = v - mv;
      return cityZone(Math.abs(du) >= Math.abs(dv) ? (du > 0 ? 0 : 1) : dv < 0 ? 2 : 3);
    }
    const ua = u - hx;
    const ub = u + hx;
    const va = v - hz;
    const vb = v + hz;
    for (let L = 0; L < 3; L++) {
      if (y - hy < LEVEL_Y[L] - LEVEL_GAP || y + hy > top(L) - LEVEL_GAP) continue;
      for (const b of byLevel[L]) {
        if (ua < b.u0 || ub > b.u1 || va < b.v0 || vb > b.v1) continue;
        if (inPoly(b.poly, ua, va) && inPoly(b.poly, ub, va) && inPoly(b.poly, ub, vb) && inPoly(b.poly, ua, vb) && !vertexInside(b.poly, ua, va, ub, vb)) {
          return roomZone(b.k);
        }
      }
    }
    return ZONE_REST;
  };
}

/** ¿Algún vértice del polígono cae dentro de la caja? (un polígono cóncavo puede meter una esquina). */
function vertexInside(poly: readonly P[], u0: number, v0: number, u1: number, v1: number): boolean {
  for (const [u, v] of poly) if (u > u0 && u < u1 && v > v0 && v < v1) return true;
  return false;
}

interface ChunkState {
  readonly part: number;
  readonly zone: number;
  /** -1 resto, -2 barrio, k ambiente. */
  readonly room: number;
}

/** Elección de una combinación: malla de siempre o trozos. */
type Mode = 'global' | 'chunks';

/** Entrada pura del cálculo de costos (se prueba sin motor). */
export interface CostInput {
  /** Triángulos de la malla de siempre, si está en cuadro (0 si no). */
  globalTris: number;
  globalInView: boolean;
  /** Triángulos de cada trozo que puede verse y está en cuadro. */
  chunkTris: number[];
}

/** Costo de cada opción, en triángulos (cada draw call vale `DRAW_COST`). */
export function modeCosts(c: CostInput, drawCost = DRAW_COST): { global: number; chunks: number } {
  let chunks = 0;
  for (const t of c.chunkTris) chunks += t + drawCost;
  return { global: c.globalInView ? c.globalTris + drawCost : 0, chunks };
}

export class ZoneCulling {
  private vis: SchoolVisibility | null = null;
  private worker: Worker | null = null;
  private readonly chunks: ChunkState[][] = [];
  private readonly modes: Mode[];
  /** Zonas que pueden verse: por ambiente y el barrio. */
  private allowAll = true;
  private allowRooms = new Uint8Array(ROOMS.length);
  private allowCity = true;
  private readonly near: Surroundings = { rooms: [], outdoor: false };
  private roomsKey = '';
  private readonly planes = Array.from({ length: 6 }, () => new Plane(0, 0, 0, 0));
  private readonly observers: Array<Observer<Scene>> = [];
  private frame = 0;
  /** Para las herramientas: el último estado. */
  private last = { rooms: [] as string[], outdoor: true, chunks: 0, globals: 0, tris: 0 };
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly school: SchoolFrame,
    private readonly parts: readonly FarmPart[],
  ) {
    this.modes = parts.map(() => 'global');
    parts.forEach((p, i) => {
      this.chunks.push(
        p.chunks.map((c) => {
          const z = c.zone;
          const room = z === ZONE_REST ? -1 : z >= cityZone(0) ? -2 : z - 1;
          return { part: i, zone: z, room };
        }),
      );
    });
    this.observers.push(scene.onBeforeRenderObservable.add(() => this.update()));
    // Las sombras: con la malla de siempre (ver arriba). Dentro de cada
    // cámara, los mapas se dibujan después de elegir las mallas activas, así
    // que volverlas visibles un momento no cambia lo que ve la cámara.
    this.observers.push(scene.onBeforeRenderTargetsRenderObservable.add(() => this.showGlobals(true)));
    this.observers.push(scene.onAfterRenderTargetsRenderObservable.add(() => this.showGlobals(false)));
  }

  /** Arranca el cálculo de la tabla en un worker (si no hay, en el hilo principal, por partes). */
  start(): void {
    if (!this.parts.length) return;
    try {
      const worker = new Worker(new URL('./schoolVisibility.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<VisibilityData>) => {
        if (!this.disposed) this.vis = SchoolVisibility.fromData(e.data);
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      };
      worker.onerror = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.startLocal();
      };
      this.worker = worker;
    } catch {
      this.startLocal();
    }
  }

  /** Sin worker: el mismo cálculo, un poco por cuadro. */
  private startLocal(): void {
    if (this.disposed) return;
    const local = new SchoolVisibility();
    const obs = this.scene.onAfterRenderObservable.add(() => {
      if (!local.step(4)) return;
      this.scene.onAfterRenderObservable.remove(obs);
      if (!this.disposed) this.vis = local;
    });
  }

  /** ¿La tabla está lista? (herramientas y pruebas) */
  get ready(): boolean {
    return this.vis !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const o of this.observers) {
      this.scene.onBeforeRenderObservable.remove(o);
      this.scene.onBeforeRenderTargetsRenderObservable.remove(o);
      this.scene.onAfterRenderTargetsRenderObservable.remove(o);
    }
    this.observers.length = 0;
  }

  /** Estado para las herramientas (`__zones`). */
  debug(): typeof this.last & { ready: boolean } {
    return { ...this.last, ready: this.ready };
  }

  /** Durante los mapas de sombra, las mallas de siempre; después, la elección. */
  private showGlobals(on: boolean): void {
    for (let i = 0; i < this.parts.length; i++) {
      if (this.modes[i] === 'chunks') this.parts[i].global.isVisible = on;
    }
  }

  private update(): void {
    const cam = this.scene.activeCamera;
    if (!cam || !this.parts.length) return;
    const changed = this.updateAllowed(cam);
    // La elección por costo cambia con la mirada: cada dos cuadros alcanza
    // (las dos opciones muestran lo mismo). Al cambiar de ambiente, ya.
    if (changed || (this.frame++ & 1) === 0) this.choose(cam);
  }

  /** Recalcula qué zonas pueden verse. Devuelve si cambió. */
  private updateAllowed(cam: Camera): boolean {
    const vis = this.vis;
    const p = cam.globalPosition;
    const u = this.school.ox - p.x;
    const v = p.z - this.school.oz;
    const near = this.near;
    near.rooms.length = 0;
    near.outdoor = false;
    let known = vis !== null && inLot(u, v) && p.y < LEVEL_Y[2] + SCHOOL.storey + 0.6;
    if (known) {
      // Niveles posibles de los pies: parado (1,6 m) o con la cabeza baja.
      const a = levelOf(p.y - 1.7);
      const b = levelOf(p.y - 0.5);
      for (const L of a === b ? [a] : [a, b]) vis!.roomsNear(L as Level, u, v, HEAD_REACH, near);
      known = !near.outdoor && near.rooms.length > 0 && near.rooms.every((k) => vis!.viewOf(k) !== null);
    }
    const key = known ? near.rooms.slice().sort((x, y) => x - y).join(',') : '*';
    if (key === this.roomsKey) return false;
    this.roomsKey = key;
    if (!known) {
      this.allowAll = true;
      this.allowCity = true;
      this.last.rooms = [];
      this.last.outdoor = true;
      return true;
    }
    this.allowAll = false;
    this.allowRooms.fill(0);
    this.allowCity = false;
    for (const k of near.rooms) {
      const view = vis!.viewOf(k)!;
      for (const r of view.rooms) this.allowRooms[r] = 1;
      if (view.outside) this.allowCity = true;
    }
    this.last.rooms = near.rooms.map((k) => ROOMS[k].id);
    this.last.outdoor = false;
    return true;
  }

  private allowed(c: ChunkState): boolean {
    if (c.room === -1 || this.allowAll) return true;
    if (c.room === -2) return this.allowCity;
    return this.allowRooms[c.room] === 1;
  }

  /** Por combinación, la opción más barata; con un tope de draw calls de más. */
  private choose(cam: Camera): void {
    Frustum.GetPlanesToRef(cam.getTransformationMatrix(), this.planes);
    const planes = this.planes;
    const n = this.parts.length;
    let base = 0;
    let draws = 0;
    const gains: Array<{ i: number; extra: number; gain: number }> = [];
    const chunkTris: number[] = [];
    for (let i = 0; i < n; i++) {
      const part = this.parts[i];
      const inView = part.global.isInFrustum(planes);
      chunkTris.length = 0;
      const cs = this.chunks[i];
      for (let j = 0; j < cs.length; j++) {
        const c = part.chunks[j];
        if (this.allowed(cs[j]) && c.mesh.isInFrustum(planes)) chunkTris.push(c.tris);
      }
      const cost = modeCosts({ globalTris: part.tris, globalInView: inView, chunkTris });
      const g = inView ? 1 : 0;
      base += g;
      if (cost.chunks < cost.global) {
        gains.push({ i, extra: chunkTris.length - g, gain: cost.global - cost.chunks });
        this.modes[i] = 'chunks';
        draws += chunkTris.length;
      } else {
        this.modes[i] = 'global';
        draws += g;
      }
    }
    // Tope: si los trozos suman demasiados draw calls, vuelven a la malla de
    // siempre las combinaciones que menos ahorran por draw call de más.
    if (draws > base + EXTRA_DRAWS) {
      gains.sort((a, b) => a.gain / Math.max(1, a.extra) - b.gain / Math.max(1, b.extra));
      for (const gn of gains) {
        if (draws <= base + EXTRA_DRAWS) break;
        if (gn.extra <= 0) continue;
        this.modes[gn.i] = 'global';
        draws -= gn.extra;
      }
    }
    let shown = 0;
    let globals = 0;
    let tris = 0;
    for (let i = 0; i < n; i++) {
      const part = this.parts[i];
      const chunks = this.modes[i] === 'chunks';
      part.global.isVisible = !chunks;
      if (!chunks) {
        globals++;
        tris += part.tris;
      }
      const cs = this.chunks[i];
      for (let j = 0; j < cs.length; j++) {
        const vis = chunks && this.allowed(cs[j]);
        part.chunks[j].mesh.isVisible = vis;
        if (vis) {
          shown++;
          tris += part.chunks[j].tris;
        }
      }
    }
    this.last.chunks = shown;
    this.last.globals = globals;
    this.last.tris = tris;
  }
}
