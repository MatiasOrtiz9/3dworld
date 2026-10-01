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
  | 'block';

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
      case 'granite':
        this.drawGranite(ctx, size, rng);
        break;
      case 'checker':
        this.drawChecker(ctx, size, rng);
        break;
      case 'parquet':
        this.drawParquet(ctx, size, rng);
        break;
      case 'ceramic':
        this.drawCeramic(ctx, size, rng);
        break;
      case 'lattice':
        this.drawLattice(ctx, size);
        break;
      case 'panels':
        this.drawPanels(ctx, size, rng);
        break;
      case 'marble':
        this.drawMarble(ctx, size, rng);
        break;
      case 'block':
        this.drawBlock(ctx, size, rng);
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

  /**
   * Granito reconstituido de pasillos y hall: 4 × 4 paños con grano mezclado
   * claro y oscuro y junta fina, como el de los pisos del recorrido.
   */
  private drawGranite(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    const tile = size / 4;
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        const v = rng.range(0.9, 1);
        ctx.fillStyle = `rgba(${v * 255},${v * 255},${v * 252},1)`;
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
    this.speckle(ctx, size, rng, 5200, 0.35, 0.35);
    this.speckle(ctx, size, rng, 2600, 0.25, 0.85);
    ctx.strokeStyle = 'rgba(95,95,92,0.45)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * tile, 0);
      ctx.lineTo(i * tile, size);
      ctx.moveTo(0, i * tile);
      ctx.lineTo(size, i * tile);
      ctx.stroke();
    }
  }

  /** Damero gris oscuro y gris claro del comedor (4 × 4 baldosas). */
  private drawChecker(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    const tile = size / 4;
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        const dark = (x + y) % 2 === 0;
        const v = dark ? rng.range(0.3, 0.34) : rng.range(0.82, 0.88);
        ctx.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`;
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
    this.speckle(ctx, size, rng, 1400, 0.06, 0.8);
    ctx.strokeStyle = 'rgba(70,70,70,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * tile, 0);
      ctx.lineTo(i * tile, size);
      ctx.moveTo(0, i * tile);
      ctx.lineTo(size, i * tile);
      ctx.stroke();
    }
  }

  /** Parquet de tablillas en cesta (aula de danzas). */
  private drawParquet(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    const cell = size / 4;
    const slat = cell / 4;
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        const vertical = (x + y) % 2 === 0;
        for (let k = 0; k < 4; k++) {
          const v = rng.range(0.78, 1);
          ctx.fillStyle = `rgb(${v * 255},${v * 236},${v * 212})`;
          if (vertical) ctx.fillRect(x * cell + k * slat, y * cell, slat, cell);
          else ctx.fillRect(x * cell, y * cell + k * slat, cell, slat);
          ctx.strokeStyle = 'rgba(110,80,50,0.35)';
          ctx.lineWidth = 1;
          if (vertical) ctx.strokeRect(x * cell + k * slat + 0.5, y * cell + 0.5, slat - 1, cell - 1);
          else ctx.strokeRect(x * cell + 0.5, y * cell + k * slat + 0.5, cell - 1, slat - 1);
        }
      }
    }
    this.speckle(ctx, size, rng, 900, 0.05, 0.8);
  }

  /** Cerámico claro de 33 cm con pastina (planta alta, jardín). */
  private drawCeramic(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    const tile = size / 2;
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        const v = rng.range(0.94, 1);
        ctx.fillStyle = `rgb(${v * 255},${v * 255},${v * 252})`;
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
    this.speckle(ctx, size, rng, 500, 0.04, 0.85);
    ctx.strokeStyle = 'rgba(120,115,105,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * tile, 0);
      ctx.lineTo(i * tile, size);
      ctx.moveTo(0, i * tile);
      ctx.lineTo(size, i * tile);
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

  /** Cerámico símil mármol: placas apaisadas con vetas grises. */
  private drawMarble(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    const h = size / 4;
    for (let r = 0; r < 4; r++) {
      const v = rng.range(0.92, 1);
      ctx.fillStyle = `rgb(${v * 255},${v * 250},${v * 244})`;
      ctx.fillRect(0, r * h, size, h);
    }
    ctx.strokeStyle = 'rgba(110,100,92,0.45)';
    for (let k = 0; k < 22; k++) {
      ctx.lineWidth = rng.range(0.5, 1.8);
      ctx.beginPath();
      let x = rng.range(0, size);
      let y = rng.range(0, size);
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += rng.range(-30, 40);
        y += rng.range(-14, 14);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(130,120,110,0.6)';
    ctx.lineWidth = 1.5;
    for (let r = 0; r <= 4; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * h);
      ctx.lineTo(size, r * h);
      ctx.stroke();
    }
    for (let r = 0; r < 4; r++) {
      const x = (r % 2) * (size / 2);
      ctx.beginPath();
      ctx.moveTo(x, r * h);
      ctx.lineTo(x, (r + 1) * h);
      ctx.stroke();
    }
  }

  /** Bloque de hormigón a la vista: hiladas trabadas con junta marcada. */
  private drawBlock(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    const rows = 4;
    const h = size / rows;
    const w = size / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < 3; c++) {
        const x = c * w + (r % 2) * (w / 2);
        const v = rng.range(0.86, 1);
        ctx.fillStyle = `rgb(${v * 255},${v * 255},${v * 250})`;
        ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4);
      }
    }
    this.speckle(ctx, size, rng, 2400, 0.12, 0.75);
    ctx.strokeStyle = 'rgba(80,78,74,0.75)';
    ctx.lineWidth = 3;
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * h);
      ctx.lineTo(size, r * h);
      ctx.stroke();
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        const x = c * w + (r % 2) * (w / 2);
        ctx.beginPath();
        ctx.moveTo(x, r * h);
        ctx.lineTo(x, (r + 1) * h);
        ctx.stroke();
      }
    }
  }

  /** Cielorraso de placas de 60 × 60 con perfilería. */
  private drawPanels(ctx: CanvasRenderingContext2D, size: number, rng: Rng): void {
    this.speckle(ctx, size, rng, 3000, 0.08, 0.86);
    ctx.strokeStyle = 'rgba(160,160,160,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
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
