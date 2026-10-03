import type { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Rng, seedFromString } from '../utils/rng';
import {
  PAINTED_KINDS,
  PERIOD_M,
  paintMacro,
  paintSurfaceMaps,
  reliefMap,
  type PaintedKind,
  type PaintedSurface,
} from './TexturePainter';

export type SurfaceKind =
  | 'concrete'
  | 'concreteXL'
  | 'timber'
  | 'timberXL'
  | 'pavement'
  | 'pavementXL'
  | 'grass'
  | 'solar'
  | 'metal'
  // Interiores de la escuela (recorrido 2020). Van sobre pisos y cielorrasos
  // poligonales, cuyas UV están en metros: el dibujo mantiene su tamaño real.
  | 'granite'
  | 'checker'
  | 'parquet'
  | 'ceramic'
  | 'lattice'
  | 'panels'
  | 'marble'
  | 'block'
  // Chapa acanalada (la galería roja sobre el comedor, el testero azul del
  // polideportivo) y ladrillo pintado a la cal (planta alta y edificio de bloque).
  | 'corrugated'
  | 'brick'
  // Látex sobre revoque, tela de cortina y goma de piso (ver TexturePainter).
  | 'plaster'
  | 'fabric'
  | 'rubber'
  | 'aggregate'
  // Chapa semillada de la escalera negra del edificio de bloque.
  | 'treadPlate';

/**
 * Texturas generadas por código.
 *
 * El salto de realismo más grande que le faltaba a la ciudad: hasta acá cada
 * superficie era un color plano, y un color plano se lee siempre como plástico
 * o como maqueta, por buena que sea la iluminación. Las superficies reales
 * tienen grano, veta, juntas, manchas.
 *
 * Se generan al cargar, en escala de grises, y se usan como mapa de detalle
 * multiplicando el color base del material. Las superficies con piezas y
 * juntas (pisos, ladrillo, bloque, chapa, hormigón, madera) se pintan píxel a
 * píxel en `TexturePainter`; las demás, con el canvas 2D. Ventajas frente a
 * descargar texturas:
 *
 *  - **No pesan nada en la red.** El proyecto sigue sin un solo archivo externo.
 *  - **Se repiten sin costura** por construcción (el ruido envuelve los bordes).
 *  - **Se pueden reteñir**: una sola textura de hormigón sirve para los siete
 *    tonos de fachada, porque el color lo pone el material.
 *
 * Coste: una textura de 256² por tipo usado (~16) más su relieve (otra de
 * 256², ver `relief`) y dos capas de gran escala de 128², generadas una vez
 * y compartidas por todos los materiales de ese tipo; con mipmaps. Pintarlas
 * lleva ~150-230 ms en escritorio (tres o cuatro veces más en un visor
 * autónomo), una sola vez durante la carga.
 *
 * Variantes MÉTRICAS (`metric = true`): las usan casi todos los materiales
 * (todos salvo los paneles solares), que calculan la UV desde la posición en
 * el mundo (ver `Materials`), en metros.
 * Su repetición es `1 / PERIOD_M`: el bloque mide 40 × 20 cm en cualquier
 * muro, sea un antepecho de 30 cm o un paño de 6 m. Con la UV 0..1 de la caja
 * unitaria, la misma textura se estiraba distinto en cada pieza (la fachada
 * se veía como un revestimiento de tablas horizontales).
 */

/**
 * Repeticiones por tipo de superficie.
 *
 * Las variantes XL existen por un problema real: las UV de una primitiva van de
 * 0 a 1 sin importar su tamano fisico, asi que un muro de 42 x 19 m con la
 * misma escala que una caja de 2 m estira la textura hasta convertir el grano
 * en franjas de 12 metros. Las superficies grandes usan una escala mucho mayor
 * para que la baldosa vuelva a medir unos pocos metros.
 */
const UV_SCALE: Record<SurfaceKind, number> = {
  concrete: 3.5,
  concreteXL: 15,
  timber: 2.5,
  timberXL: 9,
  pavement: 6,
  pavementXL: 26,
  grass: 12,
  solar: 2,
  metal: 1.5,
  // La escuela usa 0,3 UV por metro en PrismBatch: período de la textura =
  // 1 / (0,3 × escala). Granito, damero y parquet: 4 paños de 40 cm (1,6 m);
  // cerámico: 2 de 33 cm; retícula de listones: 2 celdas de 25 cm; placas de
  // cielorraso: una de 60 cm.
  granite: 2.08,
  checker: 2.08,
  parquet: 2.08,
  ceramic: 5.05,
  lattice: 6.67,
  panels: 5.56,
  // Los muros son cajas: sus UV van de 0 a 1 por cara. Una repetición media
  // da piezas de mármol de ~60 cm y bloques de ~40 × 20 cm en muros comunes.
  marble: 3,
  block: 5,
  // Onda de chapa cada ~8 cm y ladrillo de ~25 × 7,5 cm en tramos de muro comunes.
  corrugated: 4,
  brick: 3,
  plaster: 3,
  fabric: 2,
  rubber: 6,
  aggregate: 6,
  treadPlate: 1 / 0.24,
};

/**
 * Período en metros de las texturas que no pinta `TexturePainter` (las de
 * canvas 2D), para su variante métrica. Las pintadas usan `PERIOD_M`.
 */
const CANVAS_PERIOD_M: Partial<Record<SurfaceKind, number>> = {
  grass: 2,
  solar: 1.6,
  metal: 1,
  lattice: 0.5,
};

/**
 * Período de la capa de gran escala (`macro`), en metros. No es múltiplo de
 * ningún período base (0,5-2,4 m): cada paño de piso o de pared cae sobre
 * otra parte de ella y la repetición de la textura base deja de leerse.
 */
const MACRO_PERIOD_M = 7.3;

/**
 * Textura base de la que deriva cada variante de escala.
 *
 * Las XL son las superficies enormes (fachadas, suelo, calzadas) y se
 * aplican siempre en metros (ver `Materials.AUTO_METRIC`): la fachada es
 * revoque pintado y el suelo un árido fino sin juntas. Con la UV 0..1 de una
 * caja de 250 m, la loseta y la junta de encofrado se estiraban en tablones.
 */
const BASE_KIND: Partial<Record<SurfaceKind, SurfaceKind>> = {
  concreteXL: 'plaster',
  timberXL: 'timber',
  pavementXL: 'aggregate',
};

/**
 * Superficies que se miran de cerca y en ángulo rasante: los pisos. Filtrado
 * anisotrópico 8× para que la junta del granito no se convierta en una
 * mancha gris a tres metros (el resto se queda en 4×). QualityManager lo
 * escala hacia abajo con el nivel adaptativo.
 */
const FLOOR_KINDS = new Set<SurfaceKind>([
  'granite',
  'checker',
  'parquet',
  'ceramic',
  'pavement',
  'pavementXL',
  'rubber',
  'aggregate',
  'treadPlate',
]);

const PAINTED = new Set<string>(PAINTED_KINDS);

/** ¿El tipo tiene relieve pintado (y por lo tanto mapa de normales)? */
export function hasRelief(kind: SurfaceKind): boolean {
  return PAINTED.has(BASE_KIND[kind] ?? kind);
}

export class Textures {
  private readonly cache = new Map<string, Texture>();
  /** Color y altura de cada superficie pintada: el mapa de normales la reusa. */
  private readonly painted = new Map<PaintedKind, PaintedSurface>();
  /** Tiempo total de generación (ms) y texturas creadas, para el informe de carga. */
  readonly stats = { ms: 0, count: 0 };

  constructor(private readonly scene: Scene) {}

  /**
   * Textura de color de un tipo. `metric`: variante para UV en metros (la
   * escuela); si no, la escala de repetición de `UV_SCALE` (UV 0..1 por cara).
   */
  get(kind: SurfaceKind, metric = false): Texture {
    // En metros, una variante de escala es su textura base: misma textura.
    if (metric) kind = BASE_KIND[kind] ?? kind;
    const key = metric ? `${kind}@m` : kind;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const t0 = performance.now();

    // Las variantes de escala comparten el dibujo de su textura base.
    const drawKind = BASE_KIND[kind] ?? kind;
    const size = drawKind === 'grass' ? 128 : 256;
    const tex = new DynamicTexture(`tex_${key}`, { width: size, height: size }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const rng = new Rng(seedFromString(`tex:${drawKind}`));

    if (PAINTED.has(drawKind)) {
      // Superficies con piezas, juntas y grano: se pintan píxel a píxel (ver
      // TexturePainter). Unos 5-10 ms por textura, una sola vez; las
      // variantes de escala reusan los píxeles ya pintados.
      const image = ctx.createImageData(size, size);
      image.data.set(this.paint(drawKind as PaintedKind).rgba);
      ctx.putImageData(image, 0, 0);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      switch (drawKind) {
        case 'grass':
          this.drawGrass(ctx, size, rng);
          break;
        case 'solar':
          this.drawSolar(ctx, size);
          break;
        case 'metal':
          this.drawMetal(ctx, size, rng);
          break;
        case 'lattice':
          this.drawLattice(ctx, size);
          break;
      }
    }

    // La repeticion se fija aca, una sola vez, porque es constante por tipo de
    // superficie. Antes cada material clonaba la textura para ponerle su escala:
    // con ~110 materiales eso eran 110 clones de un canvas de 256x256, un coste
    // enorme y completamente evitable, ya que todos usaban el mismo valor.
    this.finish(tex, key, this.scaleOf(kind, metric), FLOOR_KINDS.has(kind) ? 8 : 4, t0);
    return tex;
  }

  /**
   * Relieve de un tipo pintado (normales + rugosidad, formato `detailMap`,
   * ver `reliefMap`), con la MISMA repetición métrica que su textura de
   * color: la junta del relieve cae sobre la junta dibujada. Sale de la
   * altura que el pintor ya calculó junto con el color, así que cuesta sólo
   * la pasada de diferencias (~1-2 ms).
   */
  relief(kind: SurfaceKind): Texture | null {
    const drawKind = BASE_KIND[kind] ?? kind;
    if (!PAINTED.has(drawKind)) return null;
    const key = `${drawKind}@m:relief`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const t0 = performance.now();
    const size = 256;
    const surface = this.paint(drawKind as PaintedKind);
    const tex = new DynamicTexture(`tex_${key}`, { width: size, height: size }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const image = ctx.createImageData(size, size);
    image.data.set(reliefMap(drawKind as PaintedKind, surface.height, size));
    ctx.putImageData(image, 0, 0);
    // Una normal no es un color: sin corrección de gamma.
    tex.gammaSpace = false;
    // El relieve del revoque repite cada 0,72 m y no cada 1,8 m: a 7 mm por
    // píxel el grano se veía como manchas de 1-2 cm frente a un interruptor.
    // El látex no tiene juntas, así que color y relieve no necesitan
    // coincidir (el color sigue a 1/1,8 m).
    const tile = drawKind === 'plaster' ? 2.5 : 1;
    this.finish(tex, key, this.scaleOf(kind, true) * tile, FLOOR_KINDS.has(drawKind) ? 8 : 4, t0);
    return tex;
  }

  /**
   * Capa de gran escala en formato ORM (oclusión ambiente y rugosidad, ver
   * `paintMacro`), en metros y compartida por los materiales métricos.
   * `traffic`: la variante de pisos, con marcas de uso.
   */
  macro(traffic: boolean): Texture {
    const key = traffic ? 'macro:floor' : 'macro:wall';
    const hit = this.cache.get(key);
    if (hit) return hit;
    const t0 = performance.now();
    const size = 128;
    const tex = new DynamicTexture(`tex_${key}`, { width: size, height: size }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const image = ctx.createImageData(size, size);
    image.data.set(paintMacro(size, traffic));
    ctx.putImageData(image, 0, 0);
    tex.gammaSpace = false;
    this.finish(tex, key, 1 / MACRO_PERIOD_M, 4, t0);
    return tex;
  }

  /**
   * Suelta las alturas pintadas (≈4 MB): sólo hacen falta mientras se crean
   * los mapas de relieve. Se llama al congelar los materiales.
   */
  trim(): void {
    this.painted.clear();
  }

  private paint(kind: PaintedKind): PaintedSurface {
    let hit = this.painted.get(kind);
    if (!hit) {
      hit = paintSurfaceMaps(kind, 256);
      this.painted.set(kind, hit);
    }
    return hit;
  }

  private scaleOf(kind: SurfaceKind, metric: boolean): number {
    if (!metric) return UV_SCALE[kind];
    const drawKind = BASE_KIND[kind] ?? kind;
    const period = PAINTED.has(drawKind) ? PERIOD_M[drawKind as PaintedKind] : (CANVAS_PERIOD_M[drawKind] ?? 1);
    return 1 / period;
  }

  private finish(tex: DynamicTexture, key: string, scale: number, aniso: number, t0: number): void {
    tex.update(false);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = aniso;
    tex.uScale = scale;
    tex.vScale = scale;
    this.cache.set(key, tex);
    this.stats.ms += performance.now() - t0;
    this.stats.count++;
  }

  /** Césped: motas de dos verdes para romper la alfombra plana. */
  private drawGrass(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    for (let i = 0; i < 4200; i++) {
      const v = rng.range(0.66, 1.08);
      ctx.fillStyle = `rgba(${v * 230},${v * 255},${v * 205},${rng.range(0.25, 0.8)})`;
      ctx.fillRect(rng.range(0, size), rng.range(0, size), rng.range(1, 2.6), rng.range(1, 3.4));
    }
  }

  /** Panel solar: la retícula de celdas y los buses de conexión. */
  private drawSolar(ctx: CanvasRenderingContext2D, size: number): void {
    const cells = 6;
    const c = size / cells;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < cells; x++) {
      for (let y = 0; y < cells; y++) {
        ctx.fillStyle = 'rgba(190,190,205,1)';
        ctx.fillRect(x * c + 1.5, y * c + 1.5, c - 3, c - 3);
        // Buses: las dos líneas claras que cruzan cada celda real.
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(x * c + c * 0.3, y * c + 1.5, 1.6, c - 3);
        ctx.fillRect(x * c + c * 0.68, y * c + 1.5, 1.6, c - 3);
      }
    }
  }

  /** Metal: cepillado direccional muy fino. */
  private drawMetal(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    for (let i = 0; i < 900; i++) {
      const v = rng.range(0.9, 1);
      ctx.strokeStyle = `rgba(${v * 255},${v * 255},${v * 255},${rng.range(0.1, 0.35)})`;
      ctx.lineWidth = rng.range(0.4, 1.2);
      const y = rng.range(0, size);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + rng.range(-1, 1));
      ctx.stroke();
    }
  }

  /** Cielorraso de listones de madera en retícula (comedor). */
  private drawLattice(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.fillStyle = 'rgb(40,32,26)';
    ctx.fillRect(0, 0, size, size);
    const cell = size / 2;
    const bar = cell * 0.32;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 2; i++) {
      ctx.fillRect(i * cell, 0, bar, size);
      ctx.fillRect(0, i * cell, size, bar);
    }
    ctx.fillStyle = 'rgba(200,170,140,0.5)';
    for (let i = 0; i < 2; i++) {
      ctx.fillRect(i * cell + bar * 0.15, 0, bar * 0.2, size);
      ctx.fillRect(0, i * cell + bar * 0.15, size, bar * 0.2);
    }
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.painted.clear();
  }
}
