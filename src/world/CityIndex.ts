import type { Block, CityPlan } from './CityLayout';
import { schoolFrame, schoolSolidLocal, toLocal, type SchoolFrame } from './SchoolLayout';

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
  private readonly size: number;
  /**
   * Grilla plana indexada por `gx * size + gz`.
   *
   * Antes era un `Map` con claves `"gx,gz"`: cada consulta armaba un string.
   * Con la multitud consultando varias veces por persona y por cuadro, eso
   * eran miles de strings descartables por segundo para el recolector.
   */
  private readonly grid: Array<Block | undefined>;
  /** Marco local del campus, si el plano tiene escuela. */
  readonly school: SchoolFrame | null;

  constructor(private readonly plan: CityPlan) {
    this.pitch = plan.blockSize + plan.streetWidth;
    this.size = Math.round(Math.sqrt(plan.blocks.length));
    this.half = (this.size - 1) / 2;
    this.grid = new Array(this.size * this.size);
    for (const b of plan.blocks) this.grid[b.gx * this.size + b.gz] = b;
    const school = plan.blocks.find((b) => b.landmark === 'school');
    this.school = school ? schoolFrame(school, plan) : null;
  }

  /** Manzana que contiene ese punto, o null si cae en la calle. */
  blockAt(x: number, z: number): Block | null {
    const gx = Math.round(x / this.pitch + this.half);
    const gz = Math.round(z / this.pitch + this.half);
    if (gx < 0 || gz < 0 || gx >= this.size || gz >= this.size) return null;
    const b = this.grid[gx * this.size + gz];
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
    if (b.landmark === 'school' && this.school) {
      const { u, v } = toLocal(this.school, x, z);
      return schoolSolidLocal(u, v);
    }
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

  /** El canal es transitable para el jugador, pero no para peatones ni destinos VR. */
  isWater(x: number, z: number): boolean {
    return this.blockAt(x, z)?.kind === 'water';
  }

  /** Altura del suelo transitable en ese punto (el canal está hundido). */
  groundHeight(x: number, z: number): number {
    const b = this.blockAt(x, z);
    if (b?.kind === 'water') return -0.6;
    return 0;
  }

  /**
   * Altura REAL de la superficie pisable, contando solados y césped.
   *
   * `groundHeight` responde "¿dónde está el terreno?" y alcanza para la cámara.
   * Para apoyar los pies de una persona hace falta más precisión: la plaza
   * tiene un solado de 12-16 cm, el parque su césped y sus senderos. Con el
   * terreno a 0 los peatones quedaban con los zapatos hundidos en el piso.
   */
  surfaceHeight(x: number, z: number): number {
    const b = this.blockAt(x, z);
    if (!b) {
      // Calle: la calzada central sobresale 8 cm de la vereda.
      const lane = this.plan.streetWidth * 0.21;
      const ox = Math.abs(x - this.nearestStreet(x));
      const oz = Math.abs(z - this.nearestStreet(z));
      return ox < lane || oz < lane ? 0.08 : 0;
    }
    // El campus tiene un solado propio de 5 cm (ver SchoolBuilder).
    if (b.landmark === 'school') return 0.05;
    switch (b.kind) {
      case 'water':
        return -0.6;
      case 'plaza': {
        const r = Math.hypot(x - b.cx, z - b.cz);
        return r < b.width * 0.39 ? 0.16 : 0.12;
      }
      case 'park': {
        const onPath = Math.abs(x - b.cx) < 1.6 || Math.abs(z - b.cz) < 1.6;
        return onPath ? 0.15 : 0.06;
      }
      case 'energy':
        return 0.12;
      default:
        return 0;
    }
  }

  /** Coordenada del eje de calle más cercano (vale igual para X que para Z). */
  nearestStreet(v: number): number {
    return (Math.round(v / this.pitch - 0.5) + 0.5) * this.pitch;
  }

  /**
   * ¿Un peatón puede pararse acá?
   *
   * Más estricto que `isSolid`: además de edificios y canal excluye el espejo
   * de agua de la plaza y el mástil del Árbol Solar, que el jugador puede
   * atravesar volando pero que una persona caminando jamás pisaría.
   */
  isPedestrianBlocked(x: number, z: number): boolean {
    if (Math.abs(x) > this.plan.extent || Math.abs(z) > this.plan.extent) return true;
    const b = this.blockAt(x, z);
    if (!b) return false;
    if (b.kind === 'water') return true;
    if (b.kind === 'plaza') {
      const dx = x - b.cx;
      const dz = z - b.cz;
      const r = Math.hypot(dx, dz);
      if (r < 2.2) return true; // mástil y su base
      // Espejo de agua en anillo, cortado por cuatro accesos en cruz.
      const ringIn = b.width * 0.3 - b.width * 0.06;
      const ringOut = b.width * 0.3 + b.width * 0.06;
      if (r > ringIn && r < ringOut) {
        const onAccess = Math.abs(dx) < 2.6 || Math.abs(dz) < 2.6;
        return !onAccess;
      }
      return false;
    }
    return this.isSolid(x, z);
  }

  /** Ficha informativa de una manzana, para el panel de inspección. */
  describe(block: Block): BlockInfo {
    if (block.landmark === 'school') {
      const floors = Math.max(2, Math.round(block.height / 3.4));
      return {
        block,
        label: 'Escuela CIMDIP & Miguel Cané',
        detail: 'Reconstrucción artística del campus: Aula Maker, ciencia, deportes y ambiente.',
        floors,
        solarM2: Math.round(block.width * block.depth * 0.16),
        kwhDay: Math.round(block.width * block.depth * 0.16 * 0.2 * 4.5),
        people: 0,
      };
    }
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
