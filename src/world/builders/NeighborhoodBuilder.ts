import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import type { Block, BlockSide, CityPlan } from '../CityLayout';
import { HOUSE_DEPTH } from '../CityLayout';
import type { NatureBuilder } from './NatureBuilder';
import type { StreetLevel } from './StreetLevel';

const hex = (h: string) => Color3.FromHexString(h);

/** Frentes del conurbano: blancos, cremas, ocres claros, algún verde o rosa gastado. */
const FACADES = ['#e9e4d8', '#ddd2bd', '#e4c99a', '#c9d3c4', '#e6c2b4', '#d8d8d2', '#cbbfa8', '#b9c4cc'];
const CARS = ['#e8e8e6', '#b4b8bc', '#2c2f35', '#8c2f2f', '#2f4a6d', '#c9b28a'];

/**
 * El barrio alrededor de la escuela: UNA hilera de casas del otro lado de
 * cada calle que la rodea (ver `CityLayout`).
 *
 * Casas entre medianeras como las de la zona (croquis del plano y Street
 * View): una o dos plantas, revoque claro con zócalo, ventanas con rejas y
 * persianas, portones de garaje, algún almacén en la esquina, techos de losa
 * con pretil y tanque de agua o de tejas, jardincito de frente con reja baja.
 * En la vereda, árboles en sus alcorques y algún auto estacionado. Detrás de
 * la hilera, los fondos: pasto y árboles.
 *
 * Todo son cajas y cilindros en la granja de instancias, con pocos materiales
 * compartidos: el barrio entero cuesta unas pocas decenas de draw calls.
 */
export class NeighborhoodBuilder {
  private readonly facades: Material[];
  private readonly plinth: Material;
  private readonly glass: Material;
  private readonly bars: Material;
  private readonly frame: Material;
  private readonly door: Material;
  private readonly garage: Material;
  private readonly roofTile: Material;
  private readonly slab: Material;
  private readonly tank: Material;
  private readonly wall: Material;
  private readonly shutter: Material;
  private readonly awnings: Material[];
  private readonly cars: Material[];
  private readonly tyre: Material;
  private readonly yard: Material;

  constructor(
    private readonly farm: InstanceFarm,
    mats: Materials,
    private readonly rng: Rng,
    private readonly nature: NatureBuilder,
    private readonly street: StreetLevel,
    private readonly detailed = true,
  ) {
    const s = (h: string, rough = 0.85, metal = 0, kind: Parameters<Materials['surface']>[3] = 'concreteXL') =>
      mats.surface(hex(h), rough, metal, kind);
    this.facades = FACADES.map((c) => s(c, 0.9));
    this.plinth = s('#8d8478', 0.9, 0, 'concrete');
    this.glass = mats.glass(hex('#2a3a44'), 0.92);
    this.bars = s('#22252a', 0.5, 0.2, 'metal');
    this.frame = s('#e6e8e8', 0.45, 0.1, null);
    this.door = s('#6b4a32', 0.7, 0, 'timber');
    this.garage = s('#9aa0a6', 0.5, 0.25, 'metal');
    this.roofTile = s('#a5533a', 0.8, 0, 'corrugated');
    this.slab = s('#a9a7a1', 0.9, 0, 'concrete');
    this.tank = s('#1e2023', 0.6, 0.1, null);
    this.wall = s('#c8c3b8', 0.95, 0, 'concreteXL');
    this.shutter = s('#cfd2d2', 0.6, 0.1, 'corrugated');
    this.awnings = ['#2f6f8f', '#b8433a', '#3f7a4a'].map((c) => s(c, 0.9, 0, null));
    this.cars = CARS.map((c) => s(c, 0.35, 0.3, null));
    this.tyre = s('#1b1c1e', 0.9, 0, null);
    this.yard = s('#77845a', 0.95, 0, 'pavementXL');
  }

  /** Levanta la hilera de casas, la vereda y los fondos de una manzana vecina. */
  build(block: Block, plan: CityPlan): void {
    const sides = block.frontage ?? [];
    if (sides.length === 0) return;
    // Fondos: tierra con pasto gastado (no césped de cancha); las casas van encima.
    this.farm.add('box', this.yard, new Vector3(block.cx, 0.02, block.cz), new Vector3(block.width, 0.04, block.depth));
    sides.forEach((side, k) => {
      // En una manzana de esquina el segundo frente arranca después de la
      // casa de la esquina, que ya pertenece al primero.
      const skipStart = k > 0 && this.sharedCorner(sides[0], side) === 'start' ? HOUSE_DEPTH : 0;
      const skipEnd = k > 0 && this.sharedCorner(sides[0], side) === 'end' ? HOUSE_DEPTH : 0;
      this.frontRow(block, side, skipStart, skipEnd, plan);
    });
    this.backyard(block, sides);
  }

  // ============================================================== geometría

  /** Punto del borde de la manzana a `along` metros desde su inicio y `inward` hacia adentro. */
  private at(block: Block, side: BlockSide, along: number, inward: number): { x: number; z: number } {
    const hw = block.width / 2;
    const hd = block.depth / 2;
    switch (side) {
      case 'zp':
        return { x: block.cx - hw + along, z: block.cz + hd - inward };
      case 'zn':
        return { x: block.cx - hw + along, z: block.cz - hd + inward };
      case 'xp':
        return { x: block.cx + hw - inward, z: block.cz - hd + along };
      case 'xn':
        return { x: block.cx - hw + inward, z: block.cz - hd + along };
    }
  }

  /** Caja orientada al frente: `w` a lo largo de la calle, `d` hacia adentro. */
  private box(mat: Material, block: Block, side: BlockSide, along: number, inward: number, w: number, h: number, d: number, y: number): void {
    const p = this.at(block, side, along, inward);
    const alongX = side === 'zp' || side === 'zn';
    this.farm.add('box', mat, new Vector3(p.x, y + h / 2, p.z), alongX ? new Vector3(w, h, d) : new Vector3(d, h, w));
  }

  /** ¿En qué punta del lado `b` está la esquina que comparte con `a`? */
  private sharedCorner(a: BlockSide, b: BlockSide): 'start' | 'end' | null {
    // Los lados en x corren a lo largo de z desde −z; los lados en z, a lo
    // largo de x desde −x.
    if (b === 'xp' || b === 'xn') return a === 'zn' ? 'start' : a === 'zp' ? 'end' : null;
    return a === 'xn' ? 'start' : a === 'xp' ? 'end' : null;
  }

  // ============================================================ la hilera

  private frontRow(block: Block, side: BlockSide, skipStart: number, skipEnd: number, plan: CityPlan): void {
    const length = side === 'zp' || side === 'zn' ? block.width : block.depth;
    let a = skipStart;
    const end = length - skipEnd;
    let lot = 0;
    while (end - a > 6) {
      const remaining = end - a;
      let w = this.rng.range(7.6, 11.2);
      if (remaining - w < 6.5) w = remaining;
      const corner = lot === 0 && skipStart === 0;
      this.house(block, side, a, a + w, corner && this.rng.chance(0.45));
      a += w;
      lot++;
    }
    this.sidewalk(block, side, skipStart, end, plan);
  }

  private house(block: Block, side: BlockSide, a0: number, a1: number, shop: boolean): void {
    const rng = this.rng;
    const w = a1 - a0;
    const mid = (a0 + a1) / 2;
    const setback = shop ? 0 : rng.chance(0.5) ? 2.4 : 0;
    const depth = Math.min(HOUSE_DEPTH - setback, rng.range(9.5, 12.5));
    const floors = rng.chance(0.42) ? 2 : 1;
    const h = floors === 2 ? 5.9 : 3.1;
    const facade = rng.pick(this.facades);
    // Cuerpo de la casa, entre medianeras.
    this.box(facade, block, side, mid, setback + depth / 2, w - 0.02, h, depth, 0);
    // Zócalo más oscuro sobre el frente.
    this.box(this.plinth, block, side, mid, setback - 0.02, w, 0.6, 0.06, 0);
    const front = setback - 0.05;

    if (shop) {
      // Almacén de esquina: vidriera, persiana metálica a medio bajar, toldo.
      this.box(this.glass, block, side, mid, front, w - 1.6, 2.3, 0.04, 0.6);
      this.box(this.shutter, block, side, mid, front - 0.04, w - 1.6, 0.7, 0.05, 2.2);
      this.box(rng.pick(this.awnings), block, side, mid, front - 0.7, w - 0.8, 0.08, 1.4, 2.85);
      this.box(this.frame, block, side, mid, front - 0.02, w - 1.0, 0.45, 0.04, 2.95);
    } else {
      // Puerta, ventana con reja y persiana, y portón de garaje en los lotes anchos.
      const garage = w > 8.4 && rng.chance(0.45);
      const doorAt = garage ? a0 + 1.3 : a0 + w * rng.range(0.22, 0.32);
      this.box(this.door, block, side, doorAt, front, 0.95, 2.1, 0.08, 0);
      if (garage) this.garageDoor(block, side, a1 - 2.0, front);
      const windows = garage ? [a0 + 3.4] : [a0 + w * 0.62, ...(w > 9.5 ? [a0 + w * 0.86] : [])];
      for (const u of windows) this.window(block, side, u, front, 1.0);
    }
    if (floors === 2) {
      for (const u of [a0 + w * 0.3, a0 + w * 0.72]) this.window(block, side, u, front, 3.95);
      if (rng.chance(0.4)) {
        // Balcón corrido con baranda.
        this.box(this.slab, block, side, mid, front - 0.5, w * 0.55, 0.12, 1.0, 3.0);
        this.railing(block, side, mid, front - 0.98, w * 0.55, 3.12);
      }
    }
    // Techo: losa con pretil y tanque de agua, o tejas a dos aguas.
    if (rng.chance(0.68)) {
      this.box(this.slab, block, side, mid, setback + depth / 2, w, 0.1, depth, h);
      this.box(facade, block, side, mid, setback + 0.1, w, 0.55, 0.2, h);
      const tankAt = this.at(block, side, a0 + w * rng.range(0.3, 0.7), setback + depth - 1.6);
      this.farm.add('box', this.slab, new Vector3(tankAt.x, h + 0.35, tankAt.z), new Vector3(1.3, 0.7, 1.3));
      this.farm.add('cylinder', this.tank, new Vector3(tankAt.x, h + 1.25, tankAt.z), new Vector3(1.05, 1.1, 1.05));
    } else {
      // Dos faldones con la cumbrera paralela a la calle.
      const run = depth / 2 + 0.3;
      const slope = 0.5;
      for (const sgn of [-1, 1]) {
        const p = this.at(block, side, mid, setback + depth / 2 + (sgn * run) / 2);
        const alongX = side === 'zp' || side === 'zn';
        const inward = side === 'zp' ? -1 : side === 'zn' ? 1 : side === 'xp' ? -1 : 1;
        // Gira sobre el eje paralelo a la calle; el faldón baja hacia afuera de la cumbrera.
        const tilt = slope * sgn * inward;
        this.farm.add(
          'box',
          this.roofTile,
          new Vector3(p.x, h + (run / 2) * Math.tan(slope) + 0.05, p.z),
          alongX ? new Vector3(w + 0.3, 0.12, run / Math.cos(slope)) : new Vector3(run / Math.cos(slope), 0.12, w + 0.3),
          0,
          alongX ? -tilt : 0,
          alongX ? 0 : tilt,
        );
      }
    }
    // Equipo de aire acondicionado en algunos frentes.
    if (rng.chance(0.3)) this.box(this.frame, block, side, a0 + w * 0.8, front - 0.2, 0.8, 0.55, 0.3, floors === 2 ? 4.9 : 2.4);
    // Jardincito con reja baja.
    if (setback > 0) {
      this.fence(block, side, a0, a1, 0.15);
      const g = this.at(block, side, a0 + w * 0.65, setback / 2);
      this.nature.shrub(g.x, g.z, rng.range(0.5, 0.8), 0.04);
    }
  }

  private window(block: Block, side: BlockSide, along: number, front: number, y: number): void {
    const w = 1.25;
    const h = 1.15;
    this.box(this.glass, block, side, along, front, w, h, 0.04, y);
    this.box(this.frame, block, side, along, front - 0.01, w + 0.1, 0.06, 0.05, y - 0.06);
    // Cajón de la persiana arriba y persiana a medio bajar en algunas.
    const drop = this.rng.chance(0.35) ? 0.55 : 0.18;
    this.box(this.shutter, block, side, along, front - 0.04, w + 0.1, drop, 0.08, y + h - drop + 0.18);
    const n = this.detailed ? 5 : 3;
    for (let k = 1; k < n; k++) this.box(this.bars, block, side, along - w / 2 + (k * w) / n, front - 0.08, 0.025, h, 0.025, y);
    this.box(this.bars, block, side, along, front - 0.08, w, 0.03, 0.025, y + h / 2);
  }

  private garageDoor(block: Block, side: BlockSide, along: number, front: number): void {
    this.box(this.garage, block, side, along, front, 2.6, 2.25, 0.06, 0);
    if (this.detailed) for (const y of [0.55, 1.1, 1.65]) this.box(this.frame, block, side, along, front - 0.04, 2.5, 0.03, 0.02, y);
  }

  private railing(block: Block, side: BlockSide, along: number, inward: number, w: number, y: number): void {
    this.box(this.bars, block, side, along, inward, w, 0.04, 0.04, y + 0.95);
    const n = Math.max(2, Math.round(w / (this.detailed ? 0.3 : 0.6)));
    for (let k = 0; k <= n; k++) this.box(this.bars, block, side, along - w / 2 + (k * w) / n, inward, 0.025, 0.95, 0.025, y);
  }

  /** Muro bajo con reja sobre la línea municipal. */
  private fence(block: Block, side: BlockSide, a0: number, a1: number, inward: number): void {
    const w = a1 - a0;
    const mid = (a0 + a1) / 2;
    this.box(this.wall, block, side, mid, inward, w, 0.55, 0.22, 0);
    this.box(this.bars, block, side, mid, inward, w, 0.04, 0.04, 1.55);
    const step = this.detailed ? 0.32 : 0.7;
    for (let a = a0 + step / 2; a < a1; a += step) this.box(this.bars, block, side, a, inward, 0.025, 1.0, 0.025, 0.55);
  }

  // =============================================================== la vereda

  private sidewalk(block: Block, side: BlockSide, a0: number, a1: number, plan: CityPlan): void {
    // Línea de árboles a ~1 m del cordón y autos estacionados contra él.
    const lane = plan.streetWidth * 0.21;
    const walk = plan.streetWidth / 2 - lane - 0.32;
    const treeOut = -(walk - 1.0);
    for (let a = a0 + 4 + this.rng.range(0, 3); a < a1 - 3; a += this.rng.range(8.5, 12)) {
      const p = this.at(block, side, a, treeOut);
      this.street.treePit(p.x, p.z);
      this.nature.broadleaf(p.x, p.z, this.rng.range(0.6, 1.0), 0.1);
    }
    const cars = this.rng.int(0, 2);
    for (let k = 0; k < cars; k++) {
      const a = a0 + ((k + 0.5) / Math.max(cars, 1)) * (a1 - a0) + this.rng.range(-3, 3);
      this.car(block, side, a, -(walk + 0.32 + 1.0));
    }
  }

  /** Auto estacionado: carrocería, habitáculo vidriado y ruedas. */
  private car(block: Block, side: BlockSide, along: number, inward: number): void {
    const body = this.rng.pick(this.cars);
    this.box(body, block, side, along, inward, 4.1, 0.62, 1.72, 0.32);
    this.box(body, block, side, along - 0.2, inward, 2.3, 0.55, 1.6, 0.94);
    this.box(this.glass, block, side, along - 0.2, inward, 2.2, 0.42, 1.64, 0.99);
    const alongX = side === 'zp' || side === 'zn';
    for (const da of [-1.35, 1.35]) {
      for (const di of [-0.78, 0.78]) {
        const p = this.at(block, side, along + da, inward + di);
        this.farm.add('cylinder', this.tyre, new Vector3(p.x, 0.32, p.z), new Vector3(0.64, 0.24, 0.64), 0, alongX ? Math.PI / 2 : 0, alongX ? 0 : Math.PI / 2);
      }
    }
  }

  // ================================================================ fondos

  private backyard(block: Block, sides: BlockSide[]): void {
    // Árboles de los fondos, lejos de la hilera de casas.
    const free = (x: number, z: number) =>
      sides.every((s) => {
        const hw = block.width / 2;
        const hd = block.depth / 2;
        const d = s === 'zp' ? block.cz + hd - z : s === 'zn' ? z - (block.cz - hd) : s === 'xp' ? block.cx + hw - x : x - (block.cx - hw);
        return d > HOUSE_DEPTH + 2.5;
      });
    let placed = 0;
    for (let tries = 0; tries < 14 && placed < 5; tries++) {
      const x = block.cx + this.rng.range(-block.width / 2 + 3, block.width / 2 - 3);
      const z = block.cz + this.rng.range(-block.depth / 2 + 3, block.depth / 2 - 3);
      if (!free(x, z)) continue;
      this.nature.broadleaf(x, z, this.rng.range(0.8, 1.25), 0.04);
      placed++;
    }
    // Cerco de fondo sobre los lados que no dan a la escuela.
    const all: BlockSide[] = ['xp', 'xn', 'zp', 'zn'];
    for (const s of all) {
      if (sides.includes(s)) continue;
      const length = s === 'zp' || s === 'zn' ? block.width : block.depth;
      this.box(this.wall, block, s, length / 2, 0.15, length, 2.1, 0.25, 0);
    }
  }
}
