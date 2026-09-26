import type { Block, CityPlan } from './CityLayout';

export interface BlockInfo {
  block: Block;
  /** Nombre legible del tipo de manzana. */
  label: string;
  /** Descripción de una línea. */
  detail: string;
  /** Pisos estimados. */
  floors: number;
  /** Superficie de paneles solares estimada, m². */
  solarM2: number;
  /** Generación diaria estimada, kWh. */
  kwhDay: number;
  /** Habitantes estimados. */
  people: number;
}

const LABELS: Record<Block['kind'], string> = {
  plaza: 'Plaza central',
  park: 'Parque urbano',
  water: 'Canal',
  residential: 'Vivienda',
  civic: 'Equipamiento público',
  tower: 'Torre residencial',
  market: 'Mercado',
  energy: 'Huerta solar',
};

const DETAILS: Record<Block['kind'], string> = {
  plaza: 'Árbol Solar: pérgola fotovoltaica y espejo de agua.',
  park: 'Bosque urbano. Sombra, infiltración de agua y refugio de fauna.',
  water: 'Canal navegable. Regula temperatura y drenaje.',
  residential: 'Manzana perimetral con patio interior y terrazas plantadas.',
  civic: 'Escuela, biblioteca o centro de salud. Planta baja abierta al barrio.',
  tower: 'Torre con jardines en altura cada 4-6 pisos.',
  market: 'Mercado de abastecimiento en estructura de madera laminada.',
  energy: 'Huerta solar comunitaria con turbinas de eje vertical y baterías.',
};

/**
 * Índice espacial de la ciudad.
 *
 * Existe para resolver dos problemas que comparten la misma causa: la ciudad
 * son decenas de miles de *thin instances*, que no son objetos individuales
 * para Babylon. No se puede hacer clic sobre un edificio ni chocar contra él,
 * porque para el motor no existen como entidades separadas.
 *
 * En vez de pagar el coste enorme de volverlos pickables, se consulta el PLANO:
 * dada una posición del mundo, se calcula en qué manzana cae. Eso alcanza para
 * colisión al caminar y para identificar qué se está mirando, y cuesta una
 * división y un redondeo.
 */
export class CityIndex {
  private readonly pitch: number;
  private readonly half: number;
  private readonly grid: Map<string, Block>;

  constructor(private readonly plan: CityPlan) {
    this.pitch = plan.blockSize + plan.streetWidth;
    this.half = (Math.sqrt(plan.blocks.length) - 1) / 2;
    this.grid = new Map();
    for (const b of plan.blocks) this.grid.set(`${b.gx},${b.gz}`, b);
  }

  /** Manzana que contiene ese punto, o null si cae en la calle. */
  blockAt(x: number, z: number): Block | null {
    const gx = Math.round(x / this.pitch + this.half);
    const gz = Math.round(z / this.pitch + this.half);
    const b = this.grid.get(`${gx},${gz}`);
    if (!b) return null;
    // Dentro de la manzana propiamente dicha, no en la calle que la rodea.
    const inside =
      Math.abs(x - b.cx) <= b.width / 2 && Math.abs(z - b.cz) <= b.depth / 2;
    return inside ? b : null;
  }

  /**
   * ¿Ese punto está ocupado por construcción?
   *
   * Sólo bloquean los tipos con volumen edificado. Plaza, parque y huerta solar
   * se pueden atravesar caminando, que es justamente lo que uno haría en la
   * ciudad real.
   */
  isSolid(x: number, z: number): boolean {
    const b = this.blockAt(x, z);
    if (!b) return false;
    switch (b.kind) {
      case 'tower':
        // La torre ocupa sólo su huella más el basamento, no la manzana entera.
        return Math.abs(x - b.cx) < 16 && Math.abs(z - b.cz) < 16;
      case 'residential': {
        // Manzana perimetral: el patio interior es transitable.
        const inner = b.width / 2 - 13;
        const inCourt = Math.abs(x - b.cx) < inner && Math.abs(z - b.cz) < inner;
        return !inCourt;
      }
      case 'civic':
      case 'market':
        return (
          Math.abs(x - b.cx) < b.width * 0.41 && Math.abs(z - b.cz) < b.depth * 0.41
        );
      default:
        return false;
    }
  }

  /** Altura del suelo transitable en ese punto (el canal está hundido). */
  groundHeight(x: number, z: number): number {
    const b = this.blockAt(x, z);
    if (b?.kind === 'water') return -0.6;
    return 0;
  }

  /** Ficha informativa de una manzana, para el panel de inspección. */
  describe(block: Block): BlockInfo {
    const floors = Math.max(0, Math.round(block.height / 3.4));
    const area = block.width * block.depth;

    // Estimaciones declaradamente aproximadas, pero con números coherentes:
    // ~20 % de la superficie de manzana en paneles para edificios, ~55 % para
    // una huerta solar dedicada.
    const solarFrac =
      block.kind === 'energy' ? 0.55 : block.kind === 'plaza' ? 0.06 : floors > 0 ? 0.2 : 0;
    const solarM2 = Math.round(area * solarFrac);

    // 1 m² de panel ≈ 0,2 kW pico. Buenos Aires ≈ 4,5 h solares pico/día.
    const kwhDay = Math.round(solarM2 * 0.2 * 4.5);

    const peoplePerFloorArea =
      block.kind === 'residential' ? 0.028 : block.kind === 'tower' ? 0.035 : 0;
    const footprint = block.kind === 'tower' ? 400 : area * 0.55;
    const people = Math.round(footprint * floors * peoplePerFloorArea);

    return {
      block,
      label: LABELS[block.kind],
      detail: DETAILS[block.kind],
      floors,
      solarM2,
      kwhDay,
      people,
    };
  }

  /** Totales de la ciudad, para el panel de energía. */
  totals(): { kwhDay: number; people: number; solarM2: number; blocks: number } {
    let kwhDay = 0;
    let people = 0;
    let solarM2 = 0;
    for (const b of this.plan.blocks) {
      const info = this.describe(b);
      kwhDay += info.kwhDay;
      people += info.people;
      solarM2 += info.solarM2;
    }
    return { kwhDay, people, solarM2, blocks: this.plan.blocks.length };
  }
}
