import type { Block, CityPlan } from './CityLayout';
import {
  inLot,
  miguelCaneOffset,
  schoolFloorLocal,
  schoolFrame,
  schoolSolidLocal,
  SCHOOL,
  toLocal,
  type SchoolFrame,
} from './SchoolLayout';

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
  park: 'Parque urbano',
  water: 'Canal',
  residential: 'Vivienda',
  civic: 'Equipamiento público',
  tower: 'Torre residencial',
  market: 'Mercado',
  energy: 'Huerta solar',
  houses: 'Casas del barrio',
};

const DETAILS: Record<Block['kind'], string> = {
  park: 'Bosque urbano. Sombra, infiltración de agua y refugio de fauna.',
  water: 'Canal navegable. Regula temperatura y drenaje.',
  residential: 'Manzana perimetral con patio interior y terrazas plantadas.',
  civic: 'Escuela, biblioteca o centro de salud. Planta baja abierta al barrio.',
  tower: 'Torre con jardines en altura cada 4-6 pisos.',
  market: 'Mercado de abastecimiento en estructura de madera laminada.',
  energy: 'Huerta solar comunitaria con turbinas de eje vertical y baterías.',
  houses: 'Casas bajas entre medianeras frente a la escuela: una y dos plantas, rejas, persianas y tanques de agua.',
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
  private readonly schoolBlock: Block | null;

  constructor(private readonly plan: CityPlan) {
    this.pitch = plan.blockSize + plan.streetWidth;
    this.size = plan.gridSize;
    this.half = (this.size - 1) / 2;
    this.grid = new Array(this.size * this.size);
    for (const b of plan.blocks) this.grid[b.gx * this.size + b.gz] = b;
    const school = plan.blocks.find((b) => b.landmark === 'school');
    this.schoolBlock = school ?? null;
    this.school = school ? schoolFrame(school, plan) : null;
  }

  /** Manzana que contiene ese punto, o null si cae en la calle. */
  blockAt(x: number, z: number): Block | null {
    const gx = Math.round(x / this.pitch + this.half);
    const gz = Math.round(z / this.pitch + this.half);
    // El predio escolar son dos manzanas SIN la calle intermedia: cualquier
    // punto dentro del rectángulo pertenece a la escuela, también la franja
    // donde antes corría la calle (si no, se atravesarían sus muros).
    const site = this.plan.schoolSite;
    if (site && this.schoolBlock && x >= site.x0 && x <= site.x1 && z >= site.z0 && z <= site.z1) {
      const cell = gx >= 0 && gz >= 0 && gx < this.size && gz < this.size ? this.grid[gx * this.size + gz] : undefined;
      return cell?.landmark ? cell : this.schoolBlock;
    }
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
   * Sólo bloquean los tipos con volumen edificado. Parque y huerta solar
   * se pueden atravesar caminando, que es justamente lo que uno haría en la
   * ciudad real.
   *
   * `feetY` es la altura de los pies de quien pregunta: en la escuela hay
   * varios pisos, y lo que bloquea depende de en cuál está (y las escaleras,
   * de a qué altura las pisa). Sin indicarla, se pregunta a nivel de suelo.
   */
  isSolid(x: number, z: number, feetY?: number): boolean {
    const b = this.blockAt(x, z);
    if (!b) return false;
    if (b.landmark && this.school) {
      const { u, v } = toLocal(this.school, x, z);
      return schoolSolidLocal(u, v, feetY ?? SCHOOL.floorY);
    }
    switch (b.kind) {
      case 'houses':
        // La hilera de casas y sus fondos (cerrados por un cerco): no se entra.
        return true;
      case 'tower': {
        // El basamento (1,65 × el fuste) con el zócalo de los locales.
        const half = ((b.footprint ?? 19.4) * 1.65) / 2 + 0.15;
        return Math.abs(x - b.cx) < half && Math.abs(z - b.cz) < half;
      }
      case 'residential':
        // Manzana perimetral: las cuatro barras cierran el patio sin pasaje
        // en planta baja, así que todo es macizo (si el patio contara como
        // transitable, el teletransporte y el aterrizaje desde el vuelo
        // dejarían al jugador encerrado adentro).
        return true;
      case 'civic':
        // El vidrio del edificio cívico está a 0,41 del ancho.
        return Math.abs(x - b.cx) < b.width * 0.41 && Math.abs(z - b.cz) < b.depth * 0.41;
      case 'market':
        return this.marketSolid(b, x, z);
      default:
        return false;
    }
  }

  /**
   * Mercado: una nave abierta. Macizos sólo las columnas de los pórticos y
   * los puestos; bajo la cubierta se camina (sobre la plataforma de 25 cm).
   */
  private marketSolid(b: Block, x: number, z: number): boolean {
    const w = b.width * 0.8;
    const d = b.depth * 0.8;
    const dx = x - b.cx;
    const dz = z - b.cz;
    if (Math.abs(dx) > w / 2 + 0.4 || Math.abs(dz) > d / 2 + 0.4) return false;
    const bays = Math.max(4, Math.round(w / 6));
    for (let i = 0; i < bays; i++) {
      const px = ((i + 0.5) / bays - 0.5) * w;
      for (const sz of [-1, 1]) {
        if (Math.hypot(dx - px, dz - (sz * d) / 2) < 0.3) return true;
      }
    }
    for (const s of b.stalls ?? []) {
      if (Math.abs(x - s.x) < s.w / 2 && Math.abs(z - s.z) < s.d / 2) return true;
    }
    return false;
  }

  /** Sobre la plataforma del mercado (80 % de la manzana, 25 cm de alto). */
  private onMarketFloor(b: Block, x: number, z: number): boolean {
    return Math.abs(x - b.cx) < b.width * 0.4 && Math.abs(z - b.cz) < b.depth * 0.4;
  }

  /** El canal es transitable para el jugador, pero no para peatones ni destinos VR. */
  isWater(x: number, z: number): boolean {
    return this.blockAt(x, z)?.kind === 'water';
  }

  /**
   * Altura del suelo transitable en ese punto (el canal está hundido). Dentro
   * de la escuela depende de `feetY`: el piso del nivel en el que se está, o
   * el escalón que se pisa.
   */
  groundHeight(x: number, z: number, feetY?: number): number {
    const b = this.blockAt(x, z);
    if (b?.kind === 'water') return -0.6;
    if (b?.kind === 'market' && this.onMarketFloor(b, x, z)) return 0.25;
    if (b?.landmark && this.school) {
      const { u, v } = toLocal(this.school, x, z);
      if (inLot(u, v) && v <= 0) return schoolFloorLocal(u, v, feetY ?? SCHOOL.floorY);
    }
    return 0;
  }

  /**
   * Altura REAL de la superficie pisable, contando solados y césped.
   *
   * `groundHeight` responde "¿dónde está el terreno?" y alcanza para la cámara.
   * Para apoyar los pies de una persona hace falta más precisión: la huerta
   * tiene un solado de 12 cm, el parque su césped y sus senderos. Con el
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
    // Predio escolar: piso interior, franja de frente y la calle Miguel Cané.
    if (b.landmark && this.school) {
      const { u, v } = toLocal(this.school, x, z);
      if (inLot(u, v)) return v > 0 ? 0.06 : SCHOOL.floorY;
      const off = miguelCaneOffset(u, v);
      return Math.abs(off - this.plan.streetWidth / 2) < this.plan.streetWidth * 0.21 ? 0.08 : 0;
    }
    switch (b.kind) {
      case 'water':
        return -0.6;
      case 'park': {
        const onPath = Math.abs(x - b.cx) < 1.6 || Math.abs(z - b.cz) < 1.6;
        return onPath ? 0.15 : 0.06;
      }
      case 'energy':
        return 0.12;
      case 'market':
        return this.onMarketFloor(b, x, z) ? 0.25 : 0;
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
   * Más estricto que `isSolid`: además de edificios excluye el canal y lo que
   * queda fuera del terreno, que el jugador puede recorrer volando pero una
   * persona caminando jamás pisaría.
   */
  isPedestrianBlocked(x: number, z: number): boolean {
    if (Math.abs(x) > this.plan.extent || Math.abs(z) > this.plan.extent) return true;
    const b = this.blockAt(x, z);
    if (!b) return false;
    if (b.kind === 'water') return true;
    // La multitud se queda en planta baja y no usa las escaleras.
    if (b.landmark && this.school) {
      const { u, v } = toLocal(this.school, x, z);
      return schoolSolidLocal(u, v, SCHOOL.floorY, true);
    }
    return this.isSolid(x, z);
  }

  /** Ficha informativa de una manzana, para el panel de inspección. */
  describe(block: Block): BlockInfo {
    if (block.landmark) {
      // Las dos manzanas del predio son un solo edificio: los paneles se
      // cuentan una vez, en la principal.
      const solarM2 = block.landmark === 'school' ? Math.round(SCHOOL.width * SCHOOL.depth * 0.3) : 0;
      return {
        block,
        label: 'Escuela CIMDIP & Miguel Cané',
        detail:
          'Planta baja del plano de evacuación (aulas sobre Laprida, Tecnología, E.P, buffet, ' +
          'polideportivo, Salón de los espejos, Arte, Teatro) y plantas altas del recorrido de 2020: ' +
          'nivel secundario, aula de danzas bajo la bóveda y jardín de tres pisos. Laprida y Miguel Cané.',
        floors: 3,
        solarM2,
        kwhDay: Math.round(solarM2 * 0.2 * 4.5),
        people: 0,
      };
    }
    const floors = Math.max(0, Math.round(block.height / 3.4));
    const area = block.width * block.depth;

    // Estimaciones declaradamente aproximadas, pero con números coherentes:
    // ~20 % de la superficie de manzana en paneles para edificios, ~55 % para
    // una huerta solar dedicada.
    const solarFrac =
      block.kind === 'energy' ? 0.55 : floors > 0 ? 0.2 : 0;
    const solarM2 = Math.round(area * solarFrac);

    // 1 m² de panel ≈ 0,2 kW pico. Buenos Aires ≈ 4,5 h solares pico/día.
    const kwhDay = Math.round(solarM2 * 0.2 * 4.5);

    const peoplePerFloorArea =
      block.kind === 'residential' || block.kind === 'houses' ? 0.028 : block.kind === 'tower' ? 0.035 : 0;
    // Las casas del barrio son sólo la hilera de frente (≈14 m de fondo).
    const footprint =
      block.kind === 'tower' ? 400 : block.kind === 'houses' ? (block.frontage?.length ?? 1) * block.width * 14 : area * 0.55;
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
