import type { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Rng } from '../utils/rng';

export type SurfaceKind =
  | 'concrete'
  | 'concreteXL'
  | 'timber'
  | 'timberXL'
  | 'pavement'
  | 'pavementXL'
  | 'grass'
  | 'solar'
  | 'metal';

/**
 * Texturas generadas por código.
 *
 * El salto de realismo más grande que le faltaba a la ciudad: hasta acá cada
 * superficie era un color plano, y un color plano se lee siempre como plástico
 * o como maqueta, por buena que sea la iluminación. Las superficies reales
 * tienen grano, veta, juntas, manchas.
 *
 * Se generan en un canvas 2D al cargar, en escala de grises, y se usan como
 * mapa de detalle multiplicando el color base del material. Ventajas frente a
 * descargar texturas:
 *
 *  - **No pesan nada en la red.** El proyecto sigue sin un solo archivo externo.
 *  - **Se repiten sin costura** por construcción (el ruido envuelve los bordes).
 *  - **Se pueden reteñir**: una sola textura de hormigón sirve para los siete
 *    tonos de fachada, porque el color lo pone el material.
 *
 * Coste: ~6 texturas de 256×256 generadas una vez, unos pocos milisegundos.
 */
/** Repeticiones de la textura de detalle, por tipo de superficie. */
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
};

/** Textura base de la que deriva cada variante de escala. */
const BASE_KIND: Partial<Record<SurfaceKind, SurfaceKind>> = {
  concreteXL: 'concrete',
  timberXL: 'timber',
  pavementXL: 'pavement',
};

export class Textures {
  private readonly cache = new Map<string, Texture>();

  constructor(private readonly scene: Scene) {}

  get(kind: SurfaceKind): Texture {
    const hit = this.cache.get(kind);
    if (hit) return hit;

    // Las variantes de escala comparten el dibujo de su textura base.
    const drawKind = BASE_KIND[kind] ?? kind;
    const size = drawKind === 'grass' ? 128 : 256;
    const tex = new DynamicTexture(`tex_${kind}`, { width: size, height: size }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const rng = new Rng(0xc17d + drawKind.length * 977);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    switch (drawKind) {
      case 'concrete':
        this.drawConcrete(ctx, size, rng);
        break;
      case 'timber':
        this.drawTimber(ctx, size, rng);
        break;
      case 'pavement':
        this.drawPavement(ctx, size, rng);
        break;
      case 'grass':
        this.drawGrass(ctx, size, rng);
        break;
      case 'solar':
        this.drawSolar(ctx, size);
        break;
      case 'metal':
        this.drawMetal(ctx, size, rng);
        break;
    }

    tex.update(false);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    // La repeticion se fija aca, una sola vez, porque es constante por tipo de
    // superficie. Antes cada material clonaba la textura para ponerle su escala:
    // con ~110 materiales eso eran 110 clones de un canvas de 256x256, un coste
    // enorme y completamente evitable, ya que todos usaban el mismo valor.
    const scale = UV_SCALE[kind];
    tex.uScale = scale;
    tex.vScale = scale;
    this.cache.set(kind, tex);
    return tex;
  }

  /** Hormigón: grano fino + manchas suaves + alguna veta de encofrado. */
  private drawConcrete(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    // Manchas grandes de humedad/envejecimiento.
    for (let i = 0; i < 26; i++) {
      const r = rng.range(size * 0.08, size * 0.3);
      const g = ctx.createRadialGradient(
        rng.range(0, size),
        rng.range(0, size),
        0,
        rng.range(0, size),
        rng.range(0, size),
        r,
      );
      const v = rng.range(0.86, 1);
      g.addColorStop(0, `rgba(${v * 255},${v * 255},${v * 255},0.5)`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    // Juntas de encofrado en LOS DOS sentidos y muy tenues.
    //
    // Antes eran sólo horizontales: al estirarse sobre un muro ancho se
    // convertían en franjas gruesas y el hormigón parecía chapa ondulada.
    // Cruzadas y suaves, el patrón se lee como paños de encofrado en cualquier
    // proporción de estiramiento.
    ctx.strokeStyle = 'rgba(150,150,150,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i += size / 4) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
    }
    this.speckle(ctx, size, rng, 2600, 0.1, 0.9);
  }

  /** Madera: veta longitudinal con nudos ocasionales. */
  private drawTimber(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    for (let i = 0; i < 150; i++) {
      const y = rng.range(0, size);
      const v = rng.range(0.74, 1);
      ctx.strokeStyle = `rgba(${v * 255},${v * 240},${v * 220},${rng.range(0.15, 0.55)})`;
      ctx.lineWidth = rng.range(0.6, 2.6);
      ctx.beginPath();
      ctx.moveTo(0, y);
      // Veta ligeramente ondulada: una línea recta se ve impresa, no crecida.
      for (let x = 0; x <= size; x += 16) {
        ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 2.2);
      }
      ctx.stroke();
    }
    // Nudos.
    for (let i = 0; i < 3; i++) {
      const cx = rng.range(0, size);
      const cy = rng.range(0, size);
      for (let r = 7; r > 0; r--) {
        ctx.strokeStyle = `rgba(120,95,70,${0.09 * r})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 1.7, r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** Solado: baldosas grandes con junta y desgaste. */
  private drawPavement(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    const tile = size / 4;
    ctx.strokeStyle = 'rgba(120,120,115,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * tile, 0);
      ctx.lineTo(i * tile, size);
      ctx.moveTo(0, i * tile);
      ctx.lineTo(size, i * tile);
      ctx.stroke();
    }
    // Cada baldosa con un tono levemente distinto: evita el patrón obvio.
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        const v = rng.range(0.93, 1);
        ctx.fillStyle = `rgba(${v * 255},${v * 255},${v * 252},0.55)`;
        ctx.fillRect(x * tile + 1, y * tile + 1, tile - 2, tile - 2);
      }
    }
    this.speckle(ctx, size, rng, 1800, 0.08, 0.88);
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

  /** Grano fino, común a varias superficies. */
  private speckle(
    ctx: CanvasRenderingContext2D,
    size: number,
    rng: Rng,
    count: number,
    alpha: number,
    minValue: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const v = rng.range(minValue, 1);
      ctx.fillStyle = `rgba(${v * 255},${v * 255},${v * 255},${alpha + rng.next() * alpha})`;
      ctx.fillRect(rng.range(0, size), rng.range(0, size), rng.range(1, 2.2), rng.range(1, 2.2));
    }
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
  }
}
