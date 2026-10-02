import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import type { CityPlan } from '../CityLayout';
import type { NatureBuilder } from './NatureBuilder';
import type { StreetLevel } from './StreetLevel';
import { PALETTE } from '../Palette';
import { PrismBatch, offsetPolygon, polygonArea, subtractRects } from './PrismBatch';
import {
  APEX,
  CEILING_H,
  FENCES,
  FURNITURE,
  KINDER_ROOMS,
  ceilingHeight,
  LANDINGS,
  LEVEL_Y,
  MEETING_POINT,
  FRONT_PLANTERS,
  ITEMS,
  MC_COS,
  ROOFS,
  ROOMS,
  SCHOOL,
  STAIRS,
  SALON_COLUMNS,
  makerWallAt,
  riserCount,
  wallGapBehind,
  GYM_MID,
  GYM_PILASTERS,
  U,
  UPPER,
  V,
  WALLS,
  inLot,
  inPoly,
  miguelCaneU,
  rearV,
  roomAt,
  roomLevel,
  toWorld,
  voidsAt,
  volumeTop,
  type Item,
  type Level,
  type Opening,
  type OpeningType,
  type P,
  type Room,
  type SchoolFrame,
  type Stair,
  type Volume,
  type Wall,
  CREST,
  U1,
  V1,
} from '../SchoolLayout';
import { isInteractiveDoor } from '../SchoolDoors';
import { SWITCHABLE_ROOMS, type Fixture } from '../SchoolLights';

const hex = (h: string) => Color3.FromHexString(h);

/** Dirección local (Δu, Δv) hacia la que mira un frente. */
function faceDir(face: Item['face']): [number, number] {
  return face === 'n' ? [0, -1] : face === 's' ? [0, 1] : face === 'e' ? [1, 0] : [-1, 0];
}

const H = SCHOOL.storey;
const FY = SCHOOL.floorY;

/** Alto de cada tipo de vano: [antepecho, dintel]. */
const HOLE: Record<OpeningType, [number, number]> = {
  door: [0, 2.15],
  double: [0, 2.25],
  pass: [0, 2.6],
  exit: [0, 2.3],
  entrance: [0, 2.75],
  window: [0.95, 2.35],
  high: [4.3, 6.2],
  band: [1.95, 2.75],
  counter: [0.95, 2.05],
};

/** Vanos con marco de puerta (jambas y cabezal de 8 cm sobre el dintel). */
const FRAMED: ReadonlySet<OpeningType> = new Set(['door', 'double', 'exit', 'entrance']);

/** Guarda roja de pasillos y patios: de 1,16 a 1,24 m sobre el piso. */
const STRIPE: readonly [number, number] = [1.16, 1.24];

/** Antepecho y dintel de un vano, con la altura propia si la tiene. */
function holeOf(o: Opening, wallH: number): [number, number] {
  const [hb, ht] = HOLE[o.type];
  return [o.hb ?? hb, Math.min(o.ht ?? ht, wallH - 0.15)];
}

/**
 * Terminaciones de cada ambiente, tal como se ven en el recorrido de 2020.
 * Las claves de material son las de `SchoolBuilder.m`.
 */
interface RoomStyle {
  /** Material de las paredes (por defecto, blanco). */
  wall?: string;
  /** Zócalo: material y alto desde el piso. */
  wainscot?: readonly [string, number];
  /** Guarda roja a la altura de la mano (por defecto en paredes blancas sin zócalo). */
  stripe?: boolean;
  /** Material del cielorraso; `null` deja la losa a la vista. */
  ceiling?: string | null;
  /** Luminarias: tubos (por defecto), paneles LED, campanas colgantes o ninguna. */
  lights?: 'tube' | 'panel' | 'dome' | 'none';
  /** Cortinas de las ventanas a la calle (por defecto, azules). */
  curtain?: string;
}

const STYLES: Readonly<Record<string, RoomStyle>> = {
  // Aulas de primaria: zócalo de madera hasta la altura del pupitre.
  // Aulas: zócalo de madera de 1,05 m (al ras del antepecho). Las del frente
  // (las que se ven sin chicos) tienen la pared en un celeste agua muy claro.
  aula1: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula2: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula3: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula4: { wall: 'aqua', wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula5: { wall: 'aqua', wainscot: ['woodIn', 1.05], stripe: false, curtain: 'sky' },
  aula6: { wainscot: ['woodIn', 1.05], stripe: false },
  dirPrim: { wainscot: ['woodIn', 1.0], stripe: false },
  prof: { stripe: false },
  recepcionOf: { stripe: false },
  // Administración y su hall: revoque gris texturado hasta 2,4 m, bloque de
  // hormigón a la vista arriba, cielorraso de placas.
  adm: { wall: 'block', wainscot: ['render', 2.4], stripe: false, ceiling: 'panels', lights: 'panel' },
  hallAdm: { wall: 'block', wainscot: ['render', 2.4], stripe: false, ceiling: 'panels', lights: 'panel' },
  wcAdm: { wall: 'ceramic', stripe: false, ceiling: 'panels' },
  pasilloMaker: { wall: 'block', stripe: false, ceiling: 'panels', lights: 'panel' },
  // Aula Maker: paredes blancas con vinilos, cielorraso de placas y paneles LED.
  tecnologia: { stripe: false, ceiling: 'panels', lights: 'panel' },
  // Hall de recepción: zócalo de cerámico símil mármol de 1,40 m y campanas
  // blancas colgadas.
  hall: { wainscot: ['marble', 1.4], stripe: false, lights: 'dome' },
  // Cantina y comedor: retícula de listones de madera; las luces son las
  // campanas negras del riel (equipamiento).
  buffet: { stripe: false, ceiling: 'lattice', lights: 'none' },
  // Aula de danzas: tablas de madera con vigas negras.
  salon: { stripe: false, ceiling: 'woodIn' },
  // Polideportivo: laterales blancos; los testeros llevan su terminación
  // propia (bloque al oeste, gris al este) en los datos del muro.
  gimnasio: { stripe: false },
  jardin: { wall: 'yellow', stripe: false },
  torreHall: { stripe: false, lights: 'none' },

  // ---------------------------------------------------- plantas altas
  // Pasillo de lockers y sector nuevo: cerámico beige, cielorraso de placas
  // y la guarda roja de toda la escuela (5:12–6:56).
  pasilloL1: { ceiling: 'panels', lights: 'panel' },
  pasilloNorteL1: { ceiling: 'panels', lights: 'panel' },
  rellanoNorte: { ceiling: 'panels', lights: 'panel' },
  pasilloOesteL1: { ceiling: 'panels', lights: 'panel' },
  pasilloTrofeos: { lights: 'tube' },
  secretaria: { wall: 'greige', stripe: false },
  aulaS1: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet', ceiling: 'panels' },
  aulaS2: { stripe: true, curtain: 'violet', ceiling: 'panels' },
  aulaS3: { stripe: false, curtain: 'curtainWhite', ceiling: 'panels' },
  aulaS4: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet', ceiling: 'panels' },
  aulaS5: { stripe: true, curtain: 'violet', ceiling: 'panels' },
  banosS: { wall: 'ceramic', stripe: false, ceiling: 'panels', lights: 'panel' },
  banosN: { wall: 'cream', stripe: false, ceiling: 'panels', lights: 'panel' },
  aula6BD: { stripe: true, curtain: 'violet' },
  aula6AC: { stripe: true, curtain: 'violet' },
  aulaC1: { stripe: false, curtain: 'curtainWhite', ceiling: 'panels' },
  aulaC2: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet', ceiling: 'panels' },
  biblioteca: { stripe: true, ceiling: 'panels', lights: 'panel' },
  bilingue: { stripe: false, curtain: 'curtainWhite', ceiling: 'panels' },
  galeria: { stripe: true, lights: 'panel' },
  pasarela: { wall: 'white', wainscot: ['black', 0.9], stripe: false, lights: 'tube' },
  dirSec: { wall: 'cream', stripe: false, curtain: 'curtainRed', ceiling: 'panels' },
  precepSec: { wall: 'cream', stripe: true, ceiling: 'panels', lights: 'panel' },
  aulaSec: { stripe: false, ceiling: 'panels' },
  escaleraOeste: { stripe: false, lights: 'none' },
  escaleraNorteL1: { lights: 'none' },
  // Edificio de bloque: bloque de hormigón a la vista, cerámico blanco y
  // cubierta de chapa blanca sobre perfiles negros (8:08–8:42).
  pasilloBloque: { wall: 'block', stripe: false, ceiling: 'panels' },
  aulaBloqueD: { wall: 'block', stripe: false, curtain: 'violet' },
  aulaBloqueC: { wall: 'block', stripe: false },
  aulaBloqueA: { stripe: false, curtain: 'violet' },
  // Aula de danzas: el cielorraso es la bóveda del polideportivo.
  aulaDanzas: { wainscot: ['block', 0.8], stripe: false, ceiling: null, lights: 'dome' },
  hallDanzas: { stripe: false, ceiling: null, lights: 'none' },
  // Jardín: cada sala con su color (10:45–13:41).
  jardinRecepcion: { stripe: false, ceiling: 'panels', lights: 'panel' },
  jardinEscalera: { wall: 'yellow', stripe: false, lights: 'none' },
  jardinGaleria: { wall: 'mint', stripe: false },
  salaAmarilla: { wall: 'yellow', stripe: false, curtain: 'curtainWhite' },
  jardinHall1: { wall: 'pinkWall', stripe: false },
  salaCeleste: { wall: 'skyWall', stripe: false, curtain: 'curtainWhite' },
  jardinGaleria1: { wall: 'mint', stripe: false },
  salaRosa: { wall: 'pinkWall', stripe: false },
  salaRoja: { wall: 'redWall', stripe: false },
  jardinHall2: { wall: 'orangeWall', stripe: false },
  espacioMusica: { stripe: false },
  sum: { stripe: false, lights: 'panel', ceiling: 'panels' },
};

interface Side {
  bands: Array<[number, number, Material]>;
  stripe: boolean;
  exterior: boolean;
  room: Room | null;
}

interface Layer {
  off: number;
  t: number;
  side: Side;
}

/**
 * Escuela CIMDIP & Miguel Cané, levantada desde el plano de evacuación.
 *
 * Todo sale de `SchoolLayout`: muros con sus vanos reales (se cortan en
 * antepechos, dinteles y tramos llenos, así las ventanas se ven desde adentro
 * y las puertas se atraviesan), pisos y losas con el polígono exacto de cada
 * ambiente, la planta alta como volumen cerrado sobre las alas que la tienen,
 * el gimnasio con su bóveda y el equipamiento que se ve en el recorrido
 * virtual de 2020. Los colores también vienen de ahí: muros blancos con
 * guarda roja, gimnasio gris, aula de danzas con piso de madera y columnas
 * rojas, Tecnología con piso verde y sillas azules, jardín amarillo.
 */
export class SchoolBuilder {
  private f!: SchoolFrame;
  private prisms!: PrismBatch;
  private readonly m: Record<string, Material>;
  /**
   * Luminarias de las aulas con interruptor, por aula: la parte que se
   * enciende la dibuja el juego (`game/world/Lights`); acá queda el marco.
   */
  readonly switchable = new Map<string, Fixture[]>();
  /** Piso del nivel del objeto que se está armando (ver `item`). */
  private fy: number = FY;

  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly rng: Rng,
    private readonly nature: NatureBuilder,
    private readonly street: StreetLevel,
    /**
     * Detalle fino de mobiliario y herrería. En VR (perfiles sin detalle de
     * calle) pupitres, sillas, rejas, mallas y cortinas se arman con menos
     * piezas: a la distancia de lectura de un visor no se distinguen y la
     * planta alta multiplicó esas piezas.
     */
    private readonly detailed = true,
  ) {
    // Toda superficie de la escuela es MÉTRICA: la UV sale de la posición en
    // el mundo (Materials, MetricUVPlugin), así cada textura mide lo real en
    // cualquier caja, y suma relieve (normales) y capa de detalle según la
    // calidad. `detail`: 'floor' para pisos (marcas de uso), 'wall' para
    // paredes grandes (tono y ondulación que rompen la repetición).
    const i = (
      h: string,
      kind: Parameters<Materials['interior']>[1] = null,
      lift?: number,
      rough?: number,
      detail?: 'floor' | 'wall',
    ) => mats.interior(hex(h), kind, lift, rough, { metric: true, detail });
    const s = (
      h: string,
      rough = 0.8,
      metal = 0,
      kind: Parameters<Materials['surface']>[3] = null,
      detail?: 'floor' | 'wall',
    ) => mats.surface(hex(h), rough, metal, kind, { metric: true, detail });
    this.m = {
      // Exterior: gris claro de la fachada real, zócalos y remates. La
      // fachada es revoque pintado (no hormigón con juntas de encofrado).
      facade: s('#d9d7d6', 0.9, 0, 'plaster', 'wall'),
      slab: s('#d9dbd9', 0.85, 0, 'concrete'),
      // Chapa galvanizada: metal sin pintar pero gastado, no espejo.
      roof: s('#7b7f84', 0.58, 0.25, 'corrugated'),
      // Chapa de la bóveda: herrumbre rojiza, como en la toma aérea.
      gymRoof: s('#7e4630', 0.85, 0.15, 'corrugated'),
      jardinRoof: s('#a9bcc4', 0.6, 0.2, 'corrugated'),
      // Portal: revoque gris grafito; pilares de granito rosado pulido.
      portal: s('#5d5f64', 0.92, 0, 'plaster', 'wall'),
      stone: s('#ab8a78', 0.42, 0, 'granite'),
      // Verde oliva del muro del patio este: látex exterior.
      olive: s('#6f735e', 0.9, 0, 'plaster', 'wall'),
      sand: s('#8a7a62', 0.95, 0, 'pavement'),
      // Césped del parque visto de lejos: el árido fino de las superficies
      // enormes (pavementXL), sin juntas.
      lawn: mats.surface(hex('#6f8a55'), 0.95, 0, 'pavementXL'),
      patio: s('#aeaba4', 0.9, 0, 'pavement', 'floor'),
      // Interior (con luz rebotada simulada). Látex mate sobre revoque.
      white: i('#efefeb', 'plaster', undefined, undefined, 'wall'),
      // La guarda es esmalte sintético: satinada, algo más lisa que el látex.
      stripe: i('#b81e24', 'plaster', 0.2, 0.62),
      ceiling: i('#f4f4f0', 'plaster', 0.3, 0.95),
      // Granito gris de hall, pasillos y aulas; parquet del aula de danzas;
      // damero del comedor y cerámico claro de los sectores nuevos.
      // Granito reconstituido gris de 30 × 30 (pasillos, aulas, ala oeste).
      tile: i('#a6a59f', 'granite', undefined, undefined, 'floor'),
      // Piso del hall: claro y pulido, con bandas oscuras.
      hallStone: i('#c4bdb5', 'pavement', undefined, undefined, 'floor'),
      terracotta: i('#9a5a2e', 'ceramic', undefined, undefined, 'floor'),
      aqua: i('#dce6e4', 'plaster', undefined, undefined, 'wall'),
      marble: i('#cbc1b6', 'marble', 0.2),
      render: i('#8a857e', 'plaster', 0.16, undefined, 'wall'),
      wood: i('#c08a55', 'parquet', undefined, undefined, 'floor'),
      checker: i('#ffffff', 'checker', 0.16, undefined, 'floor'),
      ceramic: i('#e6dfd3', 'ceramic', undefined, undefined, 'floor'),
      ceramicTan: i('#bba07c', 'ceramic', undefined, undefined, 'floor'),
      tuft: s('#b39a6e', 0.95),
      rubber: i('#3b3e43', 'rubber', 0.12, undefined, 'floor'),
      lattice: i('#b8875a', 'lattice', 0.2),
      panels: i('#f3f3ef', 'panels', 0.3),
      // Madera de interior (zócalos de las aulas y tablas del cielorraso del
      // aula de danzas), con la luz rebotada de los interiores. Barnizada:
      // satinada, con el reflejo suave de las ventanas.
      woodIn: i('#a8784a', 'timber', 0.22, 0.5),
      // Bloque de hormigón a la vista (polideportivo, aula de danzas, Adm.).
      block: i('#a5a49f', 'block', 0.16, undefined, 'wall'),
      // Cortinas: celestes en las aulas del frente, violetas en las demás.
      // Tela con pliegues (relieve y sombra propia), mate.
      sky: s('#2fa8d8', 0.95, 0, 'fabric'),
      violet: s('#3d3a6e', 0.95, 0, 'fabric'),
      // Tapas de pupitre y sillas verde salvia de las aulas de primaria:
      // laminado plástico, satinado. El mobiliario pintado o plástico lleva la
      // textura del látex (variación de tono de ±3 %): un color perfectamente
      // liso es lo que lo hacía leerse como bloque de juguete.
      sage: s('#b9bd9a', 0.55, 0, 'plaster'),
      orange: s('#e8822a', 0.6, 0, 'plaster'),
      lime: s('#a6c23a', 0.6, 0, 'plaster'),
      chalk: s('#141816', 0.92),
      // El polideportivo se ilumina por las franjas traslúcidas y las ventanas
      // altas (9:22–9:28), que el sol directo no atraviesa en el modelo: más
      // rebote propio en su piso y sus muros, o queda en penumbra.
      gymFloor: i('#bdb9ae', 'pavement', 0.52, undefined, 'floor'),
      // Vinílico del Aula Maker: verde salvia y azul acero.
      green: i('#4f8a5f', 'rubber', undefined, 0.7, 'floor'),
      steel: i('#4d6b85'),
      gymWall: i('#8e9296', 'plaster', 0.46, undefined, 'wall'),
      yellow: i('#e9c23c', 'plaster', undefined, undefined, 'wall'),
      // Plantas altas y patio este (recorrido 4:28–9:16, 9:40–10:06).
      dance: i('#7a3e2e', 'parquet', undefined, undefined, 'floor'),
      blockDark: i('#9a9184', 'block', 0.14, undefined, 'wall'),
      // Chapas pintadas: esmalte sobre metal, satinado.
      redSheet: s('#9a4f45', 0.55, 0.12, 'corrugated'),
      blueSheet: i('#3f4f96', 'corrugated', 0.12, 0.55),
      brickWhite: s('#e2e1dc', 0.92, 0, 'brick', 'wall'),
      jardinRed: s('#c22832', 0.82, 0, 'plaster', 'wall'),
      mint: i('#a9dcc6', 'plaster', undefined, undefined, 'wall'),
      skyWall: i('#9fd0e8', 'plaster', undefined, undefined, 'wall'),
      pinkWall: i('#f1b7ca', 'plaster', undefined, undefined, 'wall'),
      redWall: i('#dc6a5c', 'plaster', undefined, undefined, 'wall'),

      // Carpintería, herrería y mobiliario.
      glass: mats.glass(hex('#a9c3cf'), 0.26),
      glassDark: mats.glass(PALETTE.glassBlue, 0.9),
      // Marcos y aberturas pintados con esmalte: satinado y dieléctrico (la
      // metalicidad los agrisaba como si fueran aluminio crudo).
      frame: s('#e6e8e8', 0.42, 0),
      red: s('#b81e24', 0.55, 0, 'plaster'),
      // Azul francia: sillas, canteros, protecciones y gráficas del recorrido.
      // Polipropileno: mate-satinado, no el brillo de juguete.
      blue: s('#1d4fb0', 0.6, 0, 'plaster'),
      navy: s('#243b67', 0.65, 0, 'plaster'),
      // Herrería pintada (rejas, barandas): esmalte gastado sobre hierro. Sin
      // el cepillado del aluminio, que en un hierro pintado no existe.
      metalDark: s('#2c2f35', 0.55, 0.2, 'plaster'),
      // Aluminio de marcos y pizarras: cepillado fino a su escala real.
      metal: mats.surface(PALETTE.solarFrame, 0.4, 0.25, 'metal', { metric: true }),
      // Madera barnizada de pupitres, bancos y estantes.
      timber: s('#c99a62', 0.55, 0, 'timber'),
      timberDark: s('#7b5236', 0.55, 0, 'timber'),
      chairGreen: s('#2f7a5c', 0.6, 0, 'plaster'),
      // Pizarra blanca, hojas y mesadas: melamina o esmalte, con brillo.
      board: i('#f6f7f6', null, 0.35, 0.4),
      // Cortinas blancas (aulas del sector nuevo, salas del jardín): tela, no
      // la melamina de la pizarra con la que compartían material.
      curtainWhite: s('#ecebe6', 0.95, 0, 'fabric'),
      // Espejos (salón de los espejos y aula de danzas): plata pulida con un
      // reflejo de ambiente procedural (ver Materials.mirror). Los de marco
      // de color y los sin marco comparten material: un draw call.
      mirrorGlass: mats.mirror(),
      soil: mats.surface(PALETTE.soil, 0.95, 0, null),
      grass: mats.grass(PALETTE.leafMid),
      stair: i('#9a9a96', 'concrete', 0.18, undefined, 'floor'),
      light: mats.glow(hex('#f5f8ff'), 0.95),
      exitSign: mats.glow(hex('#37c46b'), 0.9),
      lit: mats.glow(PALETTE.glassLit, 0.7),
      lane: mats.surface(PALETTE.pavementDark, 0.88, 0, 'pavementXL'),
      kerb: mats.surface(PALETTE.concreteShade, 0.9, 0, 'pavement'),
    };
    // Alias: mismos materiales con otro nombre de uso. Cada material nuevo es
    // una malla fuente más (un draw call); acá se comparten a propósito.
    const m = this.m;
    Object.assign(m, {
      bars: m.metalDark,
      black: m.metalDark,
      appliance: m.frame,
      // Espejo sin marco de color: el mismo espejo (con el blanco de los
      // marcos se leía como una pared).
      mirror: m.mirrorGlass,
      leaf: m.board,
      chairBlue: m.blue,
      curtainBlue: m.blue,
      curtainRed: m.red,
      // Colores de las plantas altas y del patio que se leen igual con uno
      // existente: cada material propio sería otro draw call.
      mesh: m.metalDark,
      gravel: m.patio,
      patioGreen: m.green,
      greige: m.render,
      cream: m.white,
      orangeWall: m.orange,
      // Colores del recorrido que comparten material con uno cercano.
      charcoal: m.metalDark,
      darkGreen: m.chairGreen,
      darkRed: m.red,
      brick: m.red,
      oak: m.timber,
      pine: m.timber,
      cherry: m.timberDark,
      alu: m.metal,
      paving: m.patio,
      tileDark: m.tile,
    });
  }

  build(frame: SchoolFrame, plan: CityPlan, scene: Scene): Mesh[] {
    this.f = frame;
    this.prisms = new PrismBatch((u, v) => toWorld(frame, u, v), 0.3);
    this.grounds(plan);
    this.floors();
    for (const w of WALLS) this.wall(w);
    this.ceilings();
    this.upperFloors();
    this.roofs();
    this.gym();
    for (const s of STAIRS) this.stair(s);
    this.cores();
    this.salonBeams();
    this.makerWall();
    for (const it of ITEMS) this.item(it);
    this.lights();
    this.portal();
    this.jardinFacade();
    this.frontage();
    this.fences();
    this.utilityLines();
    return this.prisms.build(scene, 'school');
  }

  // ================================================================ utilidades

  /** Caja alineada, apoyada en `y`, en coordenadas locales. */
  private box(mat: Material, u: number, v: number, w: number, h: number, d: number, y = 0): void {
    const p = toWorld(this.f, u, v);
    this.farm.addBoxOnGround(mat, p.x, p.z, w, h, d, y, 0);
  }

  private cyl(mat: Material, u: number, v: number, dia: number, h: number, y = 0): void {
    const p = toWorld(this.f, u, v);
    this.farm.add('cylinder', mat, new Vector3(p.x, y + h / 2, p.z), new Vector3(dia, h, dia));
  }

  /**
   * Caja a lo largo del segmento a→b (cualquier ángulo), de espesor `t`,
   * entre `y0` e `y1`, corrida `off` metros hacia la normal izquierda.
   */
  private piece(mat: Material, a: P, b: P, t: number, y0: number, y1: number, off = 0): void {
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const len = Math.hypot(du, dv);
    if (len < 0.01 || y1 - y0 < 0.004) return;
    const nu = -dv / len;
    const nv = du / len;
    const p = toWorld(this.f, (a[0] + b[0]) / 2 + nu * off, (a[1] + b[1]) / 2 + nv * off);
    // rotY lleva +X a (cos, −sin): el eje largo va sobre la dirección del
    // segmento EN EL MUNDO, donde +u es −x.
    this.farm.add('box', mat, new Vector3(p.x, (y0 + y1) / 2, p.z), new Vector3(len, y1 - y0, t), this.yaw(du, dv));
  }

  /** Giro en Y que alinea +X con la dirección local (du, dv). */
  private yaw(du: number, dv: number): number {
    const a = toWorld(this.f, 0, 0);
    const b = toWorld(this.f, du, dv);
    return Math.atan2(-(b.z - a.z), b.x - a.x);
  }

  // ================================================================== terreno

  private grounds(plan: CityPlan): void {
    const f = this.f;
    const top = f.site.z0 - f.oz;
    const west = f.site.x0 - f.ox;
    const front = SCHOOL.front;
    // Franja de frente y ochavo de Miguel Cané: solado exterior.
    this.prisms.plan(
      this.m.paving,
      [
        [miguelCaneU(front), front],
        [miguelCaneU(0), 0],
        [U.e + SCHOOL.eastGap, 0],
        [U.e + SCHOOL.eastGap, front],
      ],
      0,
      0.06,
      { bottom: false },
    );
    this.prisms.plan(
      this.m.paving,
      [
        [miguelCaneU(0), 0],
        [U.w, 0],
        [U.w, V.classTop],
        [miguelCaneU(V.corrS), V.corrS],
      ],
      0,
      0.06,
      { bottom: false },
    );
    // Fondos de los vecinos detrás de la medianera: pasto y algún árbol.
    this.prisms.plan(this.m.lawn, [APEX, [miguelCaneU(top), top], [U.teaE, top], [U.teaE, rearV(U.teaE)]], 0, 0.05, {
      bottom: false,
    });
    for (const [u, v] of [
      [27, -38.6],
      [38, -36.8],
      [49, -34.4],
    ] as const) {
      const p = toWorld(f, u, v);
      this.nature.broadleaf(p.x, p.z, 0.9 + this.rng.range(0, 0.3), 0.05);
    }

    // Calle Miguel Cané: calzada en diagonal y cordones, de Laprida a la calle
    // del norte. La vereda es el solado base de la ciudad.
    const w = plan.streetWidth;
    const lane = w * 0.42;
    const offU = w / 2 / MC_COS;
    const vS = front + w / 2 - lane / 2;
    const vN = top - w / 2 + lane / 2;
    const a: P = [miguelCaneU(vS) - offU, vS];
    const b: P = [miguelCaneU(vN) - offU, vN];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mid = toWorld(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const rot = this.yaw(b[0] - a[0], b[1] - a[1]);
    // Un pelo más baja que las calles de la grilla: en el cruce no pelean.
    this.farm.add('box', this.m.lane, new Vector3(mid.x, 0.038, mid.z), new Vector3(len, 0.075, lane), rot);
    for (const s of [-1, 1]) {
      this.piece(this.m.kerb, a, b, 0.32, 0, 0.165, s * (lane / 2 + 0.16));
    }
    // Plazoleta al oeste de Miguel Cané, en lo que sobra de la manzana doble.
    const parkEdge = (v: number) => miguelCaneU(v) - w / MC_COS;
    const park: P[] = [
      [west, front],
      [parkEdge(front), front],
      [parkEdge(top), top],
      [west, top],
    ];
    this.prisms.plan(this.m.lawn, park, 0, 0.06, { bottom: false });
    for (let v = -4; v > top + 3; v -= 7.5) {
      const u = (west + parkEdge(v)) / 2 + this.rng.range(-1.5, 1.5);
      if (u > parkEdge(v) - 2.5 || u < west + 2.5) continue;
      const p = toWorld(f, u, v);
      this.nature.broadleaf(p.x, p.z, this.rng.range(0.8, 1.15), 0.06);
    }
    // Arbolado de la vereda oeste de Miguel Cané.
    for (let v = -2; v > top + 2; v -= 11) {
      const u = miguelCaneU(v) - (w - 2.1) / MC_COS;
      const p = toWorld(f, u, v);
      this.street.treePit(p.x, p.z);
      this.nature.broadleaf(p.x, p.z, this.rng.range(0.7, 1.0), 0.1);
    }
  }

  private floors(): void {
    const mat: Record<Room['floor'], Material> = {
      tile: this.m.tile,
      wood: this.m.wood,
      gym: this.m.gymFloor,
      green: this.m.green,
      patio: this.m.patio,
      dark: this.m.tileDark,
      checker: this.m.checker,
      ceramic: this.m.ceramic,
      ceramicTan: this.m.ceramicTan,
      rubber: this.m.rubber,
      terracotta: this.m.terracotta,
      hallStone: this.m.hallStone,
      dance: this.m.dance,
    };
    for (const r of ROOMS) {
      const level = roomLevel(r);
      const top = LEVEL_Y[level];
      // Planta baja: contrapiso desde el terreno. Pisos altos: losa de 14 cm
      // (la cara inferior la tapa el cielorraso del ambiente de abajo), sin
      // los huecos de escalera de ese nivel.
      if (level === 0) {
        this.prisms.plan(mat[r.floor], r.poly, 0, top, { bottom: false });
        continue;
      }
      // Con cara inferior: bajo la galería en voladizo y bajo la pasarela se ve
      // la losa desde el patio (oscura, como en el video).
      for (const piece of subtractRects(r.poly, voidsAt(level))) {
        this.prisms.plan(mat[r.floor], piece, top - 0.14, top);
      }
    }
  }

  // =================================================================== muros

  private side(w: Wall, room: Room | null): Side {
    if (w.kind === 'medianera' || !room) {
      const ext = (w.ext && this.m[w.ext]) || this.m.facade;
      return { bands: [[0, w.h, ext]], stripe: false, exterior: true, room };
    }
    const st = STYLES[room.id] ?? {};
    const key = w.finish?.[room.id] ?? st.wall ?? 'white';
    if (key === 'blockTwoTone') {
      // Testero del polideportivo: bloque claro abajo, más oscuro desde ~4 m.
      return {
        bands: [
          [0, 4.1, this.m.block],
          [4.1, w.h, this.m.blockDark],
        ],
        stripe: false,
        exterior: false,
        room,
      };
    }
    const mat = this.m[key];
    const stripe = st.stripe ?? (mat === this.m.white && !st.wainscot);
    // Muro alto del gimnasio visto desde un ambiente bajo: por encima del
    // techo vecino ya es fachada.
    const top = w.h > 3.8 && room.id !== 'gimnasio' ? H : w.h;
    const bands: Array<[number, number, Material]> = [];
    if (st.wainscot) {
      const [wm, wh] = st.wainscot;
      bands.push([0, wh, this.m[wm]], [wh, top, mat]);
    } else {
      bands.push([0, top, mat]);
    }
    if (top < w.h) bands.push([top, w.h, (w.upper && this.m[w.upper]) || this.m.facade]);
    return { bands, stripe, exterior: false, room };
  }

  private wall(w: Wall): void {
    const [au, av] = w.a;
    const len = Math.hypot(w.b[0] - au, w.b[1] - av);
    const du = (w.b[0] - au) / len;
    const dv = (w.b[1] - av) / len;
    const nu = -dv;
    const nv = du;
    const t = w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT;
    // Base del muro: los de los pisos altos apoyan sobre la losa de su nivel.
    const yb = w.level * H;
    const at = (d: number): P => [au + du * d, av + dv * d];
    const roomsAt = (d: number): [Room | null, Room | null] => {
      const [pu, pv] = at(d);
      return [roomAt(pu + nu * 0.45, pv + nv * 0.45, w.level), roomAt(pu - nu * 0.45, pv - nv * 0.45, w.level)];
    };

    // Un muro largo pasa por varios ambientes: se corta donde llega otro muro
    // o termina un ambiente, y cada tramo toma la terminación de los ambientes
    // que tiene a cada lado. Antes se miraba sólo el centro del muro: el fondo
    // de la recepción del jardín se pintaba entero del amarillo de la Sala
    // Amarilla, también del lado de la galería verde (y se veía en el vano).
    const along = (p: P): number | null => {
      const ru = p[0] - au;
      const rv = p[1] - av;
      const d = ru * du + rv * dv;
      return Math.abs(-ru * dv + rv * du) <= t / 2 + 0.16 && d > 0.05 && d < len - 0.05 ? d : null;
    };
    const roomCuts: number[] = [];
    for (const o of WALLS) {
      if (o === w || o.level !== w.level) continue;
      for (const p of [o.a, o.b]) {
        const d = along(p);
        if (d !== null) roomCuts.push(d);
      }
    }
    for (const r of ROOMS) {
      if (roomLevel(r) !== w.level) continue;
      for (const p of r.poly) {
        const d = along(p);
        if (d !== null) roomCuts.push(d);
      }
    }
    // Tramos de terminación: entre cortes, fusionando los que ven lo mismo.
    const marks = [0, ...roomCuts.sort((x, y) => x - y), len];
    const finishes: Array<{ t0: number; t1: number; layers: Layer[]; key: string }> = [];
    for (let k = 0; k < marks.length - 1; k++) {
      const t0 = marks[k];
      const t1 = marks[k + 1];
      if (t1 - t0 < 0.02) continue;
      const [rp, rn] = roomsAt((t0 + t1) / 2);
      const key = `${rp?.id ?? '-'}|${rn?.id ?? '-'}`;
      const last = finishes[finishes.length - 1];
      if (last && last.key === key) {
        last.t1 = t1;
        continue;
      }
      const pos = this.side(w, rp);
      const neg = this.side(w, rn);
      const same =
        pos.bands.length === neg.bands.length &&
        pos.bands.every((b, j) => b[2] === neg.bands[j][2] && b[0] === neg.bands[j][0] && b[1] === neg.bands[j][1]) &&
        pos.stripe === neg.stripe;
      const layers: Layer[] = same
        ? [{ off: 0, t, side: pos }]
        : [
            { off: t / 4, t: t / 2, side: pos },
            { off: -t / 4, t: t / 2, side: neg },
          ];
      finishes.push({ t0: last ? last.t1 : t0, t1, layers, key });
    }
    if (finishes.length) {
      finishes[0].t0 = 0;
      finishes[finishes.length - 1].t1 = len;
    }

    // Tramos: el muro se corta en cada borde de vano y de terminación; en
    // cada tramo quedan los vanos que lo cubren (varios, a distinta altura).
    const cuts = [0, len];
    for (const o of w.openings) cuts.push(o.t0, o.t1);
    for (const f of finishes) cuts.push(f.t0, f.t1);
    cuts.sort((x, y) => x - y);
    const spans: Array<{ t0: number; t1: number; holes: Array<[number, number]>; layers: Layer[] }> = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k];
      const t1 = cuts[k + 1];
      if (t1 - t0 < 0.005) continue;
      const mid = (t0 + t1) / 2;
      const holes = w.openings
        .filter((o) => o.t0 <= mid && o.t1 >= mid)
        .map((o): [number, number] => {
          const [hb, ht] = holeOf(o, w.h);
          // Las puertas llevan un cabezal de marco de 8 cm sobre el vano: el
          // dintel del muro arranca encima. Si arrancaba en el mismo plano
          // que la cara inferior del cabezal, las dos caras titilaban.
          return [hb, FRAMED.has(o.type) ? Math.min(ht + 0.08, w.h) : ht];
        })
        .sort((x, y) => x[0] - y[0]);
      const fin = finishes.find((f) => mid >= f.t0 && mid <= f.t1) ?? finishes[0];
      spans.push({ t0, t1, holes, layers: fin.layers });
    }

    const stripeCut = spans.map((s) => s.holes.some(([hb, ht]) => hb < STRIPE[1] && ht > STRIPE[0]));
    spans.forEach((s, k) => {
      const a = at(s.t0);
      const b = at(s.t1);
      for (const L of s.layers) {
        for (const [y0, y1, mat] of L.side.bands) {
          // Lleno entre vanos, dentro de la franja [y0, y1].
          let y = y0;
          for (const [hb, ht] of s.holes) {
            if (hb > y + 0.005) this.piece(mat, a, b, L.t, yb + y, yb + Math.min(y1, hb), L.off);
            y = Math.max(y, ht);
            if (y >= y1) break;
          }
          if (y < y1 - 0.005) this.piece(mat, a, b, L.t, yb + y, yb + y1, L.off);
        }
        // Guarda roja fina a 1,20 m (centro), como en todos los pasillos del
        // recorrido: corre por los antepechos y se corta en las puertas. Donde
        // termina contra un vano se retira 3 mm: su canto quedaba en el mismo
        // plano que el canto del muro y titilaba.
        if (L.side.stripe && !stripeCut[k]) {
          const t0 = s.t0 + (k > 0 && stripeCut[k - 1] ? 0.003 : 0);
          const t1 = s.t1 - (k < spans.length - 1 && stripeCut[k + 1] ? 0.003 : 0);
          this.piece(this.m.stripe, at(t0), at(t1), L.t + 0.02, yb + STRIPE[0], yb + STRIPE[1], L.off);
        }
      }
    });

    for (const o of w.openings) {
      const [rp, rn] = roomsAt((o.t0 + o.t1) / 2);
      const pe = !rp || w.kind === 'medianera';
      const ne = !rn || w.kind === 'medianera';
      const extSign = pe && !ne ? 1 : ne && !pe ? -1 : 0;
      this.opening(w, o, at(o.t0), at(o.t1), o.t1 - o.t0, t, [nu, nv], extSign, rp, rn);
    }
  }

  /** Carpintería y herrería de un vano. */
  private opening(
    w: Wall,
    o: Opening,
    a: P,
    b: P,
    len: number,
    t: number,
    n: P,
    extSign: number,
    roomPos: Room | null,
    roomNeg: Room | null,
  ): void {
    const type = o.type;
    const yb = w.level * H;
    const [hb0, ht0] = holeOf(o, w.h);
    const hb = yb + hb0;
    const ht = yb + ht0;
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const along = (d: number): P => [a[0] + du * d, a[1] + dv * d];
    const m = this.m;

    if (type === 'window' || type === 'high' || type === 'band') {
      const fm = (o.color && m[o.color]) || m.frame;
      this.piece(m.glass, along(0.03), along(len - 0.03), 0.02, hb + 0.03, ht - 0.03);
      this.piece(fm, a, b, 0.1, hb, hb + 0.06);
      this.piece(fm, a, b, 0.1, ht - 0.06, ht);
      this.piece(fm, a, along(0.06), 0.1, hb, ht);
      this.piece(fm, along(len - 0.06), b, 0.1, hb, ht);
      if (this.detailed || len > 2.4) this.piece(fm, along(len / 2 - 0.025), along(len / 2 + 0.025), 0.08, hb, ht);
      const grille = o.grille ?? (w.level > 0 ? 'whiteBars' : 'bars');
      if (extSign !== 0 && type === 'window' && grille !== 'none') {
        const off = extSign * (t / 2 + 0.06);
        if (grille === 'bars' || grille === 'whiteBars') {
          // Rejas: negras en planta baja, blancas en los pisos altos (Street View).
          const bars = grille === 'bars' ? m.bars : m.frame;
          this.piece(m.slab, along(-0.05), along(len + 0.05), 0.16, hb - 0.06, hb, extSign * (t / 2 + 0.02));
          const nb = this.detailed ? 7 : 4;
          for (let k = 1; k < nb; k++) {
            const d = (k * len) / nb;
            this.piece(bars, along(d - 0.012), along(d + 0.012), 0.025, hb + 0.02, ht - 0.02, off);
          }
          for (const y of this.detailed ? [hb + 0.45, ht - 0.45] : [(hb + ht) / 2]) this.piece(bars, a, b, 0.025, y, y + 0.03, off);
        } else if (grille === 'mesh') {
          // Malla romboidal: una trama fina y oscura delante del vidrio.
          const step = this.detailed ? 0.14 : 0.28;
          const n = Math.max(3, Math.round(len / step));
          for (let k = 1; k < n; k++) {
            const d = (k * len) / n;
            this.piece(m.mesh, along(d - 0.006), along(d + 0.006), 0.012, hb + 0.02, ht - 0.02, off);
          }
          for (let y = hb + step; y < ht - 0.05; y += step) this.piece(m.mesh, a, b, 0.012, y, y + 0.012, off);
        } else {
          // Parasoles horizontales de chapa clara (galería roja, 2:08).
          for (let y = hb + 0.12; y < ht - 0.05; y += 0.16) this.piece(m.frame, a, b, 0.12, y, y + 0.03, extSign * (t / 2 + 0.1));
        }
      }
      // Cortinas en aulas, oficinas y en el jardín: celestes, violetas, blancas
      // o con cenefa roja según el ambiente (recorrido y fachada).
      // El ambiente de cada ventana (no el del centro del muro): un muro largo
      // de fachada pasa por varias aulas con cortinas distintas.
      const wm = along(len / 2);
      const inner = extSign !== 0 ? roomAt(wm[0] - n[0] * extSign * 0.45, wm[1] - n[1] * extSign * 0.45, w.level) : null;
      if (type === 'window' && inner && (inner.id.startsWith('aula') || inner.id === 'jardin' || STYLES[inner.id]?.curtain)) {
        const off = -extSign * (t / 2 + 0.06);
        const cm = m[STYLES[inner.id]?.curtain ?? 'curtainBlue'];
        // Sobre Laprida las cortinas están casi cerradas: desde la calle cada
        // ventana se lee como un rectángulo violeta oscuro (0:04–0:08).
        const onLaprida = Math.abs(w.a[1]) < 0.01 && Math.abs(w.b[1]) < 0.01 && w.level <= 1;
        if (onLaprida) {
          this.piece(cm, along(-0.3), along(len * 0.42), 0.06, hb - 0.05, ht + 0.02, off);
          this.piece(cm, along(len * 0.58), along(len + 0.3), 0.06, hb - 0.05, ht + 0.02, off);
          return;
        }
        // Barral negro, cenefa y paños a los costados.
        if (this.detailed) {
          this.piece(m.metalDark, along(-0.3), along(len + 0.3), 0.03, ht + 0.28, ht + 0.31, off);
          this.piece(cm, along(-0.2), along(len + 0.2), 0.05, ht + 0.02, ht + 0.28, off);
        }
        this.piece(cm, along(-0.3), along(0.18), 0.06, hb - 0.05, ht + 0.02, off);
        this.piece(cm, along(len - 0.18), along(len + 0.3), 0.06, hb - 0.05, ht + 0.02, off);
      }
      return;
    }

    if (type === 'counter') {
      // Mostrador apoyado SOBRE el antepecho (no en su mismo plano).
      this.piece(m.timber, a, b, t + 0.36, hb, hb + 0.05);
      return;
    }
    if (type === 'pass') return;

    // Puertas: marco rojo (o el de su color) y hojas abiertas contra el muro.
    const own = o.color ? m[o.color] : undefined;
    const frameMat = type === 'exit' ? m.metalDark : own === m.frame || own === m.timberDark ? own : m.red;
    this.piece(frameMat, a, along(0.07), t + 0.05, yb, ht);
    this.piece(frameMat, along(len - 0.07), b, t + 0.05, yb, ht);
    this.piece(frameMat, a, b, t + 0.05, ht, ht + 0.08);

    // Las de aulas y oficinas las dibuja y mueve el juego (`game/world/Doors`).
    if (isInteractiveDoor(w.level, a, b)) return;

    // Las hojas abren hacia el ambiente (no hacia el pasillo); las de
    // emergencia, hacia la calle.
    const isHall = (r: Room | null) => !r || r.name === 'Pasillo' || !r.roofed;
    let s = !isHall(roomPos) ? 1 : !isHall(roomNeg) ? -1 : 1;
    if (type === 'exit' && extSign !== 0) s = extSign;
    const leafMat = own ?? (type === 'exit' ? m.frame : type === 'entrance' ? m.glass : m.leaf);
    const hinges = type === 'door' ? [0.08] : [0.08, len - 0.08];
    const leafW = type === 'door' ? len - 0.16 : (len - 0.16) / 2;
    for (const h of hinges) {
      const p = along(h);
      const q0: P = [p[0] + n[0] * s * (t / 2 + 0.02), p[1] + n[1] * s * (t / 2 + 0.02)];
      const q1: P = [q0[0] + n[0] * s * leafW, q0[1] + n[1] * s * leafW];
      if (type === 'entrance' || type === 'exit' || !own || !this.detailed) {
        this.piece(leafMat, q0, q1, 0.045, yb + 0.03, ht - 0.04);
        // Picaporte cerca del borde libre (de los dos lados de la hoja).
        if (this.detailed && type !== 'entrance' && type !== 'exit') {
          const k: P = [q1[0] - (q1[0] - q0[0]) * 0.08, q1[1] - (q1[1] - q0[1]) * 0.08];
          const k2: P = [q1[0] - (q1[0] - q0[0]) * 0.13, q1[1] - (q1[1] - q0[1]) * 0.13];
          this.piece(m.metal, k2, k, 0.12, yb + 0.98, yb + 1.02);
        }
      } else {
        // Hoja con vidrio: tablero abajo (hasta 0,9 m), vidrio arriba en su marco.
        this.piece(leafMat, q0, q1, 0.045, yb + 0.03, yb + 0.9);
        this.piece(m.glass, q0, q1, 0.02, yb + 0.9, ht - 0.12);
        this.piece(leafMat, q0, q1, 0.05, ht - 0.12, ht - 0.04);
        const qa: P = [q0[0] + (q1[0] - q0[0]) * 0.06, q0[1] + (q1[1] - q0[1]) * 0.06];
        const qb: P = [q1[0] - (q1[0] - q0[0]) * 0.06, q1[1] - (q1[1] - q0[1]) * 0.06];
        this.piece(leafMat, q0, qa, 0.05, yb + 0.9, ht - 0.12);
        this.piece(leafMat, qb, q1, 0.05, yb + 0.9, ht - 0.12);
      }
      if (type === 'entrance') {
        for (const y of [yb + 0.03, ht - 0.12]) this.piece(m.red, q0, q1, 0.06, y, y + 0.1);
      }
      if (type === 'exit') {
        // Barra antipánico roja a 0,98 m.
        const mid: P = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2];
        const e: P = [q1[0] - (q1[0] - q0[0]) * 0.1, q1[1] - (q1[1] - q0[1]) * 0.1];
        this.piece(m.red, mid, e, 0.12, yb + 0.95, yb + 1.01);
      }
    }
    if (type === 'exit') {
      const inside = extSign !== 0 ? -extSign : 1;
      this.piece(
        m.exitSign,
        along(len / 2 - 0.2),
        along(len / 2 + 0.2),
        0.05,
        ht + 0.14,
        ht + 0.34,
        inside * (t / 2 + 0.04),
      );
    }
  }

  // ======================================================== losas y volúmenes

  private ceilings(): void {
    for (const r of ROOMS) {
      if (!r.roofed || r.id === 'gimnasio') continue;
      const kind = STYLES[r.id]?.ceiling;
      if (kind === null) continue;
      const level = roomLevel(r);
      const y = LEVEL_Y[level] + ceilingHeight(r);
      // Por donde sube una escalera al nivel de arriba, el cielorraso se abre.
      const above = level < 2 ? voidsAt((level + 1) as 1 | 2) : [];
      const pieces = subtractRects(r.poly, above);
      // Canto visible sólo alrededor de un hueco; contra los muros no se ve.
      const sides = pieces.length > 1;
      for (const piece of pieces) {
        this.prisms.plan(this.m[kind ?? 'ceiling'], piece, y, y + 0.06, { top: false, sides });
      }
    }
  }

  /**
   * Plantas altas: cornisa en cada losa, azotea con pretil y, donde ese nivel
   * todavía no tiene ambientes, un cerramiento con ventanas. Se decide arista
   * por arista: donde adentro hay un ambiente de ese nivel, sus muros reales
   * (con sus vanos) hacen de fachada.
   */
  private upperFloors(): void {
    for (const vol of UPPER) {
      const poly = vol.poly;
      const top = volumeTop(vol);
      const body = offsetPolygon(poly, 0.15);
      const inward = polygonArea(poly) > 0 ? 1 : -1;
      const ringPath = offsetPolygon(poly, 0.245);
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        const du = (b[0] - a[0]) / len;
        const dv = (b[1] - a[1]) / len;
        // Normal hacia adentro del volumen.
        const iu = -dv * inward;
        const iv = du * inward;
        const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const inside: P = [mid[0] + iu * 0.5, mid[1] + iv * 0.5];
        const outside: P = [mid[0] - iu * 0.45, mid[1] - iv * 0.45];
        for (let level = 1; level <= vol.floors; level++) {
          const y0 = level * H;
          // Cornisa entre plantas: sólo en las caras a la intemperie (contra
          // otro volumen igual de alto o contra el gimnasio quedaría adentro).
          if (vol.cornice !== false && !this.covered(vol, outside, level)) {
            const ra = ringPath[i];
            const rb = ringPath[(i + 1) % poly.length];
            const rl = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]);
            const e = 0.095 / Math.max(rl, 0.01);
            this.piece(
              this.m.facade,
              [ra[0] - (rb[0] - ra[0]) * e, ra[1] - (rb[1] - ra[1]) * e],
              [rb[0] + (rb[0] - ra[0]) * e, rb[1] + (rb[1] - ra[1]) * e],
              0.19,
              y0,
              y0 + 0.22,
            );
          }
          // Cerramiento genérico donde ese nivel no tiene ambientes: arista por
          // arista, porque donde los hay sus muros reales hacen de fachada.
          if (vol.shell === false || roomAt(inside[0], inside[1], level as Level)) continue;
          const e = 0.15 / len;
          const a2: P = [a[0] - (b[0] - a[0]) * e, a[1] - (b[1] - a[1]) * e];
          const b2: P = [b[0] + (b[0] - a[0]) * e, b[1] + (b[1] - a[1]) * e];
          this.piece(this.m.facade, a2, b2, SCHOOL.extT, y0, y0 + H);
          this.upperWindows(vol, a, b, level as Level);
        }
      }
      if (vol.roof === false) continue;
      this.prisms.plan((vol.roofMat && this.m[vol.roofMat]) || this.m.roof, body, top, top + 0.04, { bottom: false, sides: false });
      // Pretil: no contra un volumen vecino que suba hasta acá o más.
      const bodyIn = polygonArea(body) > 0 ? 1 : -1;
      for (let i = 0; i < body.length; i++) {
        const a = body[i];
        const b = body[(i + 1) % body.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        const nu = (-(b[1] - a[1]) / len) * bodyIn;
        const nv = ((b[0] - a[0]) / len) * bodyIn;
        const probe: P = [(a[0] + b[0]) / 2 - nu * 0.6, (a[1] + b[1]) / 2 - nv * 0.6];
        if (UPPER.some((o) => o !== vol && volumeTop(o) >= top && inPoly(o.poly, probe[0], probe[1]))) continue;
        this.piece(this.m.slab, a, b, 0.2, top, top + 0.55, bodyIn * 0.1);
      }
    }
  }

  /** ¿Del otro lado de esa cara hay otro volumen alto (o el gimnasio)? */
  private covered(vol: Volume, p: P, level: number): boolean {
    if (UPPER.some((o) => o !== vol && o.floors >= level && inPoly(o.poly, p[0], p[1]))) return true;
    return roomAt(p[0], p[1])?.id === 'gimnasio';
  }

  private parapet(poly: readonly P[], y: number, h: number): void {
    const inward = polygonArea(poly) > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      this.piece(this.m.slab, a, b, 0.2, y, y + h, inward * 0.1);
    }
  }

  /** Ventanas genéricas sobre una arista de un volumen sin ambientes en ese nivel. */
  private upperWindows(vol: Volume, a: P, b: P, level: Level): void {
    const inward = polygonArea(vol.poly) > 0 ? 1 : -1;
    const spacing = 3.25;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.floor((len - 0.8) / spacing);
    if (count < 1) return;
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    const ou = inward * dv; // normal exterior
    const ov = -inward * du;
    const start = (len - (count - 1) * spacing) / 2;
    for (let k = 0; k < count; k++) {
      const d = start + k * spacing;
      const c: P = [a[0] + du * d, a[1] + dv * d];
      const probe: P = [c[0] + ou * 0.9, c[1] + ov * 0.9];
      // No se abren ventanas contra otro volumen igual de alto ni contra el gimnasio.
      if (UPPER.some((p) => p !== vol && p.floors >= level && inPoly(p.poly, probe[0], probe[1]))) continue;
      if (roomAt(probe[0], probe[1])?.id === 'gimnasio') continue;
      // El portal del acceso lleva su propia composición.
      if (Math.abs(c[1]) < 0.05 && c[0] > 32.4 && c[0] < 42.4) continue;
      const street = !inLot(probe[0], probe[1]);
      this.upperWindow(c, [du, dv], -inward, street, level * H);
    }
  }

  /** Ventana de planta alta sobre la cara del volumen. `side` es el signo de la normal exterior. */
  private upperWindow(c: P, d: P, side: number, street: boolean, base: number): void {
    const m = this.m;
    const hw = 0.78;
    const a: P = [c[0] - d[0] * hw, c[1] - d[1] * hw];
    const b: P = [c[0] + d[0] * hw, c[1] + d[1] * hw];
    const y0 = base + 1.05;
    const y1 = base + 2.35;
    this.piece(m.glassDark, a, b, 0.03, y0, y1, side * 0.165);
    if (this.rng.chance(0.55)) this.piece(m.lit, a, b, 0.01, y0 + 0.05, y1 - 0.05, side * 0.185);
    const fa: P = [a[0] - d[0] * 0.06, a[1] - d[1] * 0.06];
    const fb: P = [b[0] + d[0] * 0.06, b[1] + d[1] * 0.06];
    this.piece(m.frame, fa, fb, 0.08, y0 - 0.06, y0, side * 0.18);
    this.piece(m.frame, fa, fb, 0.08, y1, y1 + 0.06, side * 0.18);
    this.piece(m.frame, fa, a, 0.08, y0, y1, side * 0.18);
    this.piece(m.frame, b, fb, 0.08, y0, y1, side * 0.18);
    this.piece(m.slab, fa, fb, 0.2, y0 - 0.12, y0 - 0.06, side * 0.22);
    if (!street) return;
    for (let k = 1; k < 7; k++) {
      const t = -hw + (k * 2 * hw) / 7;
      const p: P = [c[0] + d[0] * t, c[1] + d[1] * t];
      const q: P = [p[0] + d[0] * 0.025, p[1] + d[1] * 0.025];
      this.piece(m.bars, p, q, 0.025, y0, y1, side * 0.26);
    }
    // Equipos de aire acondicionado junto a varias ventanas de la calle.
    if (this.rng.chance(0.5)) {
      const e: P = [c[0] + d[0] * 1.35, c[1] + d[1] * 1.35];
      const f: P = [c[0] + d[0] * 2.25, c[1] + d[1] * 2.25];
      this.piece(m.appliance, e, f, 0.4, base + 1.85, base + 2.45, side * 0.35);
      this.piece(m.bars, e, f, 0.02, base + 1.9, base + 2.3, side * 0.56);
    }
  }

  /** Cubiertas de una planta: losa, membrana y pretil. */
  private roofs(): void {
    for (const r of ROOFS) {
      // 8 cm: queda dentro del muro, sin asomar del otro lado (el
      // polideportivo veía la cornisa de Arte y Teatro como un saliente).
      const body = offsetPolygon(r.poly, 0.08);
      this.prisms.plan(this.m.facade, body, r.y, r.y + 0.22, { bottom: false, top: false });
      this.prisms.plan(this.m.roof, body, r.y + 0.22, r.y + 0.24, { bottom: false, sides: false });
      this.parapet(body, r.y + 0.22, 0.35);
    }
  }

  // ================================================================ gimnasio

  /**
   * Gimnasio / SUM: muros de 7,2 m y bóveda de chapa (la cubierta curva que se
   * ve en la toma aérea), con cabriadas, tímpanos, luminarias, bandas rojas y
   * azules como en el video y la cancha pintada (en SchoolIdentity).
   */
  private gym(): void {
    const m = this.m;
    const wallTop = SCHOOL.gymWall;
    const rise = SCHOOL.gymRise;
    const chord = -V.gymTop;
    const r = (chord * chord) / 4 / (2 * rise) + rise / 2;
    const vc = V.gymTop / 2;
    const yc = wallTop + rise - r;
    const arcV = (phi: number, rr = r) => vc + rr * Math.sin(phi);
    const arcY = (phi: number, rr = r) => yc + rr * Math.cos(phi);
    const half = Math.asin(chord / 2 / r);
    const over = Math.asin(Math.min(0.99, (chord / 2 + 0.45) / r));
    const segs = 14;
    // La bóveda sigue al oeste sobre el aula de danzas del segundo piso hasta
    // el muro de los espejos (8:44–9:16, 9:38): el cielorraso inclinado del
    // aula es esta misma curva.
    const u0 = U1.vaultW;
    const uMid = (u0 + U.e) / 2;
    const uLen = U.e - u0 + 0.7;
    for (let i = 0; i < segs; i++) {
      const p0 = -over + ((2 * over) / segs) * i;
      const p1 = p0 + (2 * over) / segs;
      const pm = (p0 + p1) / 2;
      const w = 2 * r * Math.sin((p1 - p0) / 2) + 0.04;
      const pos = toWorld(this.f, uMid, arcV(pm));
      this.farm.add('box', m.gymRoof, new Vector3(pos.x, arcY(pm), pos.z), new Vector3(uLen, 0.1, w), 0, pm);
      // Cara interior oscura de la chapa, sólo sobre el polideportivo.
      const inner = toWorld(this.f, (U.gymW + U.e) / 2, arcV(pm, r - 0.08));
      this.farm.add('box', m.metalDark, new Vector3(inner.x, arcY(pm, r - 0.08), inner.z), new Vector3(U.e - U.gymW, 0.04, w), 0, pm);
      // Franjas de policarbonato traslúcido de alero a alero (9:22–9:28).
      for (const us of [54.58, 60.28, 65.98]) {
        const sp = toWorld(this.f, us, arcV(pm, r + 0.03));
        this.farm.add('box', m.light, new Vector3(sp.x, arcY(pm, r + 0.03), sp.z), new Vector3(1.0, 0.1, w), 0, pm);
        const ip = toWorld(this.f, us, arcV(pm, r - 0.1));
        this.farm.add('box', m.light, new Vector3(ip.x, arcY(pm, r - 0.1), ip.z), new Vector3(1.0, 0.04, w), 0, pm);
      }
    }
    // Cielorraso blanco de placas que sigue la curva sobre el aula de danzas.
    const dMid = (u0 + U.gymW) / 2;
    for (let i = 0; i < segs; i++) {
      const p0 = -half + ((2 * half) / segs) * i;
      const p1 = p0 + (2 * half) / segs;
      const pm = (p0 + p1) / 2;
      const rr = r - 0.14;
      const w = 2 * rr * Math.sin((p1 - p0) / 2) + 0.03;
      const pos = toWorld(this.f, dMid, arcV(pm, rr));
      this.farm.add('box', m.ceiling, new Vector3(pos.x, arcY(pm, rr), pos.z), new Vector3(U.gymW - u0, 0.04, w), 0, pm);
    }
    // Cabriadas curvas bajo la chapa, sobre cada pilastra.
    for (const u of GYM_PILASTERS) {
      for (let i = 0; i < 10; i++) {
        const p0 = -half + ((2 * half) / 10) * i;
        const p1 = p0 + (2 * half) / 10;
        const pm = (p0 + p1) / 2;
        const rr = r - 0.35;
        const w = 2 * rr * Math.sin((p1 - p0) / 2) + 0.04;
        const pos = toWorld(this.f, u, arcV(pm, rr));
        this.farm.add('box', m.metalDark, new Vector3(pos.x, arcY(pm, rr), pos.z), new Vector3(0.14, 0.3, w), 0, pm);
      }
      // Tensor horizontal.
      this.box(m.metalDark, u, vc, 0.08, 0.08, chord - 0.4, wallTop - 0.2);
      // Luminarias colgadas.
      for (const v of [vc - 5.5, vc, vc + 5.5]) this.box(m.light, u, v, 0.5, 0.12, 0.5, wallTop - 0.6);
    }
    /** Altura de la bóveda (cara interior) en v. */
    const archY = (v: number) => yc + Math.sqrt(Math.max(0, r * r - (v - vc) * (v - vc)));
    // Tímpanos: el este, ciego; el del oeste del polideportivo, ahora interior,
    // de chapa azul con las tres ventanas del aula de danzas; y el del muro de
    // los espejos, con cuatro ventanas altas al cielo y el paso al hall.
    this.gable(m.facade, U.e - 0.15, U.e + 0.15, wallTop, archY, []);
    // Cara interior gris del testero este (9:28).
    this.gable(m.gymWall, U.e - 0.17, U.e - 0.15, wallTop, archY, []);
    const danceWin: Array<[number, number, number, number]> = [
      [-11.0, -9.5, 7.52, 8.57],
      [-7.9, -6.4, 7.52, 8.57],
      [-4.8, -3.3, 7.52, 8.57],
    ];
    this.gable(m.blueSheet, U.gymW, U.gymW + 0.12, wallTop, archY, danceWin);
    this.gable(m.white, U.gymW - 0.12, U.gymW, wallTop, archY, danceWin);
    for (const [v0, v1, y0, y1] of danceWin) {
      // Corredizas blancas con malla romboidal del lado del polideportivo.
      this.box(m.glass, U.gymW, (v0 + v1) / 2, 0.02, y1 - y0, v1 - v0, y0);
      this.box(m.frame, U.gymW, (v0 + v1) / 2, 0.14, 0.05, v1 - v0, y0);
      this.box(m.frame, U.gymW, (v0 + v1) / 2, 0.14, 0.05, v1 - v0, y1 - 0.05);
      for (let v = v0 + 0.1; v < v1; v += 0.12) this.box(m.mesh, U.gymW + 0.16, v, 0.012, y1 - y0, 0.012, y0);
    }
    const mirrorWin: Array<[number, number, number, number]> = [
      [-5.45, -4.55, 8.85, 9.25],
      [-7.65, -6.75, 8.85, 9.35],
      [-9.85, -8.95, 8.85, 9.45],
      [-12.05, -11.15, 8.85, 9.45],
      // Paso del hall del segundo piso, bajo la bóveda.
      [V1.blockA, V1.blockHall, 2 * H, 8.75],
    ];
    this.gable(m.facade, u0 - 0.15, u0 + 0.15, 2 * H, archY, mirrorWin);
    for (const [v0, v1, y0, y1] of mirrorWin.slice(0, 4)) this.box(m.glassDark, u0, (v0 + v1) / 2, 0.06, y1 - y0, v1 - v0, y0);
    // Testero este: dos franjas rojo-blanco-azul a los lados de la bandera,
    // con el azul hacia el centro y más alto (9:28).
    const face = U.e - SCHOOL.extT / 2 - 0.02;
    for (const side of [-1, 1]) {
      const bc = GYM_MID + side * 4.25;
      const bars: Array<[Material, number]> = [
        [m.red, 6.9],
        [m.slab, 7.6],
        [m.navy, 8.4],
      ];
      bars.forEach(([mat, top], k) => {
        // k = 0 afuera (rojo) … k = 2 adentro (azul).
        const bv = bc - side * (k - 1) * 0.3;
        this.box(mat, face, bv, 0.04, top - 0.1, 0.3, FY + 0.1);
      });
    }
    // Columnas reticuladas blancas sobre cada pilastra, hasta la bóveda.
    for (const u of GYM_PILASTERS) {
      for (const v of [V.gymTop + 0.3, -0.45]) {
        for (const sgn of [-1, 1]) this.box(m.frame, u + sgn * 0.15, v, 0.06, wallTop - 2.75, 0.06, 2.75);
        for (let y = 3.2; y < wallTop; y += 0.9) this.box(m.frame, u, v, 0.3, 0.04, 0.04, y);
      }
    }
    // Zócalo gris oscuro y portón de chapa de la salida a Laprida.
    this.box(m.metalDark, 51.8, 0.05, 2.2, 0.16, 0.1, 2.5);
  }

  /**
   * Tímpano bajo la bóveda en u0..u1, desde `yb` hasta la curva, con huecos
   * rectangulares [v0, v1, y0, y1]: se arma en franjas verticales entre los
   * bordes de los huecos.
   */
  private gable(
    mat: Material,
    u0: number,
    u1: number,
    yb: number,
    archY: (v: number) => number,
    holes: ReadonlyArray<readonly [number, number, number, number]>,
  ): void {
    const cuts = new Set<number>([V.gymTop, 0]);
    for (const [v0, v1] of holes) {
      cuts.add(Math.max(V.gymTop, Math.min(0, v0)));
      cuts.add(Math.max(V.gymTop, Math.min(0, v1)));
    }
    const vs = [...cuts].sort((a, b) => a - b);
    for (let k = 0; k < vs.length - 1; k++) {
      const va = vs[k];
      const vb = vs[k + 1];
      if (vb - va < 0.01) continue;
      const vm = (va + vb) / 2;
      // Tramos sólidos en altura: de yb a la curva, menos los huecos de esta franja.
      const spans = holes
        .filter(([h0, h1]) => Math.min(h0, h1) <= vm && Math.max(h0, h1) >= vm)
        .map(([, , y0, y1]) => [y0, y1] as const)
        .sort((x, y) => x[0] - y[0]);
      let y = yb;
      const steps = Math.max(1, Math.ceil((vb - va) / 1.2));
      const arch: P[] = [];
      for (let i = steps; i >= 0; i--) {
        const v = va + ((vb - va) * i) / steps;
        arch.push([v, archY(v)]);
      }
      for (const [y0, y1] of spans) {
        if (y0 > y + 0.01) {
          this.prisms.alongU(
            mat,
            [
              [va, y],
              [vb, y],
              [vb, y0],
              [va, y0],
            ],
            u0,
            u1,
          );
        }
        y = Math.max(y, y1);
      }
      // Las franjas de los extremos apoyan en los aleros (la curva vale yb
      // ahí): se cierran con los puntos de la curva que quedan por encima.
      const crown = arch.filter(([, ay]) => ay > y + 0.01);
      if (crown.length) this.prisms.alongU(mat, [[va, y], [vb, y], ...crown], u0, u1);
    }
  }

  // ================================================================ escaleras

  private stair(s: Stair): void {
    const m = this.m;
    const n = riserCount(s);
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const from = s.dir === 'u+' ? s.u0 : s.dir === 'u-' ? s.u1 : s.dir === 'v+' ? s.v0 : s.v1;
    const to = s.dir === 'u+' ? s.u1 : s.dir === 'u-' ? s.u0 : s.dir === 'v+' ? s.v1 : s.v0;
    const run = (to - from) / n;
    // Los tramos que arrancan en planta baja son macizos; los de los pisos
    // altos, una losa escalonada con luz por debajo (también la escalera
    // exterior de chapa del comedor).
    const solid = s.y0 < 0.5 && !s.hollow;
    // La de chapa del edificio de bloque es negra, con baranda negra (8:12).
    const chequer = s.u0 >= U1.blockStair0 - 0.01 && s.y0 >= 3;
    const tread = chequer ? m.metalDark : m.stair;
    // La del jardín tiene pasamanos negro (11:49–13:06).
    const rail = chequer || s.u0 >= 57.65 ? m.metalDark : s.hollow ? m.frame : m.red;
    for (let i = 0; i < n; i++) {
      const c = from + run * (i + 0.5);
      const top = FY + s.y0 + ((i + 1) * (s.y1 - s.y0)) / n;
      const bottom = solid ? 0 : top - 0.24;
      if (alongU) this.box(tread, c, (s.v0 + s.v1) / 2, Math.abs(run) + 0.01, top - bottom, s.v1 - s.v0, bottom);
      else this.box(tread, (s.u0 + s.u1) / 2, c, s.u1 - s.u0, top - bottom, Math.abs(run) + 0.01, bottom);
      // Nariz de escalón clara (las del acceso llevan una franja amarilla).
      if (!this.detailed && i > 0 && i < n - 1) continue;
      // Narices amarillas en el primer escalón y en la llegada (0:19, 1:35).
      const yellow = !chequer && (i === n - 1 || (i === 0 && s.y0 < 0.5));
      const nose = yellow ? m.yellow : m.slab;
      if (alongU) this.box(nose, c - run * 0.45, (s.v0 + s.v1) / 2, 0.05, 0.02, s.v1 - s.v0, top);
      else this.box(nose, (s.u0 + s.u1) / 2, c - run * 0.45, s.u1 - s.u0, 0.02, 0.05, top);
    }
    const rise = s.y1 - s.y0;
    const length = Math.abs(to - from);
    const ang = Math.atan2(rise, length);
    const hyp = Math.hypot(rise, length);
    const yMid = FY + (s.y0 + s.y1) / 2;
    // Giro que inclina una caja a lo largo del tramo (+u es −x en el mundo:
    // subir hacia +u levanta el extremo −X).
    const east = toWorld(this.f, 1, 0).x < toWorld(this.f, 0, 0).x;
    const tilt = alongU ? (east ? -1 : 1) * (s.dir === 'u+' ? ang : -ang) : s.dir === 'v+' ? -ang : ang;
    const sloped = (mat: Material, across: number, y: number, thick: number, width: number) => {
      const p = alongU ? toWorld(this.f, (s.u0 + s.u1) / 2, across) : toWorld(this.f, across, (s.v0 + s.v1) / 2);
      if (alongU) this.farm.add('box', mat, new Vector3(p.x, y, p.z), new Vector3(hyp, thick, width), 0, 0, tilt);
      else this.farm.add('box', mat, new Vector3(p.x, y, p.z), new Vector3(width, thick, hyp), 0, tilt, 0);
    };
    const mid = alongU ? (s.v0 + s.v1) / 2 : (s.u0 + s.u1) / 2;
    const width = alongU ? s.v1 - s.v0 : s.u1 - s.u0;
    if (!solid) {
      // Debajo: losa inclinada lisa (hormigón) o dos zancas (chapa), en vez
      // del serrucho de escalones sueltos que se veía desde abajo. Su cara
      // superior pasa por el pie de cada contrahuella y baja 26 cm.
      if (s.hollow || chequer) {
        for (const sgn of [-1, 1]) sloped(tread, mid + sgn * (width / 2 - 0.03), yMid - 0.13, 0.26 * Math.cos(ang), 0.06);
      } else {
        sloped(tread, mid, yMid - 0.13, 0.26 * Math.cos(ang), width);
      }
    }
    // Pasamanos a 0,9 m sobre la línea de los escalones. Del lado de un muro
    // va sobre ménsulas; del lado abierto, sobre parantes con travesaño medio
    // (antes era un caño suelto flotando en el aire).
    const runAt = (t: number) => from + (to - from) * t;
    const treadTop = (t: number) => FY + s.y0 + (Math.min(n - 1, Math.floor(t * n)) + 1) * (rise / n);
    for (const side of [0, 1]) {
      const edge = alongU ? (side ? s.v1 : s.v0) : side ? s.u1 : s.u0;
      const inward = side ? -1 : 1;
      const walled = this.stairSideWalled(s, edge);
      const across = edge + inward * (walled ? 0.07 : 0.04);
      sloped(rail, across, yMid + 0.9, 0.05, 0.05);
      const posts = Math.max(2, Math.round(length / 1.1) + 1);
      for (let k = 0; k < posts; k++) {
        const t = 0.06 + (0.88 * k) / (posts - 1);
        const at = runAt(t);
        const railY = yMid + 0.9 + (t - 0.5) * rise;
        const [pu, pv] = alongU ? [at, across] : [across, at];
        if (walled) {
          // Ménsula corta hasta el muro.
          if (this.detailed) this.box(rail, alongU ? pu : pu - inward * 0.035, alongU ? pv - inward * 0.035 : pv, 0.03, 0.03, 0.03, railY - 0.07);
        } else {
          const y0 = treadTop(t);
          this.box(rail, pu, pv, 0.04, railY - y0, 0.04, y0);
        }
      }
      if (!walled && this.detailed) sloped(rail, across, yMid + 0.45, 0.03, 0.03);
    }
  }

  /** ¿Hay un muro (o el tabique entre tramos) pegado a este costado del tramo? */
  private stairSideWalled(s: Stair, edge: number): boolean {
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const level = Math.min(2, Math.floor((s.y0 + 0.01) / H));
    const lo = alongU ? s.u0 : s.v0;
    const hi = alongU ? s.u1 : s.v1;
    // Tabique entre los dos tramos de la escalera principal (ver `cores`).
    if (alongU && Math.abs(edge + 27.47) < 0.2 && s.u0 < 25.9 && s.u1 > 23.3) return true;
    for (const w of WALLS) {
      if (w.level !== level) continue;
      const parallel = alongU ? Math.abs(w.a[1] - w.b[1]) < 0.01 : Math.abs(w.a[0] - w.b[0]) < 0.01;
      if (!parallel) continue;
      const line = alongU ? w.a[1] : w.a[0];
      if (Math.abs(line - edge) > (w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT) / 2 + 0.12) continue;
      const a = alongU ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
      const b = alongU ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
      if (Math.min(b, hi) - Math.max(a, lo) > (hi - lo) * 0.5) return true;
    }
    return false;
  }

  /**
   * Pared del mural del Aula Maker (la medianera, en diagonal): estante largo
   * sobre ménsulas azules, televisor, mueble bajo con robots y tablero
   * perforado, estantería con cajas negras y el camión a control remoto; y
   * en el testero de Miguel Cané, el pizarrón interactivo entre dos
   * estanterías con cajas celestes (recorrido 2:32-3:20).
   */
  private makerWall(): void {
    const m = this.m;
    const at = (s: number, off = 0): P => makerWallAt(s, off);
    const face = 0.15;
    // Estante a 1,05 m, de punta a punta salvo el tramo del mueble bajo.
    this.piece(m.board, at(0.8), at(9.3), 0.25, FY + 1.03, FY + 1.06, face + 0.125);
    for (let s = 1.2; s < 9.3; s += 1.6) this.piece(m.blue, at(s - 0.02), at(s + 0.02), 0.2, FY + 0.9, FY + 1.03, face + 0.1);
    // Objetos sobre el estante: mapas de madera, robots y cajas.
    for (const [s, mat, h] of [
      [1.9, m.timber, 0.35],
      [2.4, m.metalDark, 0.25],
      [4.5, m.timberDark, 0.3],
      [5.2, m.blue, 0.2],
      [6.9, m.board, 0.25],
      [8.0, m.timber, 0.4],
    ] as const) {
      this.piece(mat, at(s - 0.15), at(s + 0.15), 0.2, FY + 1.06, FY + 1.06 + h, face + 0.125);
    }
    // Televisor de 55" entre las columnas azul marino y roja.
    this.piece(m.metalDark, at(7.1), at(8.3), 0.06, FY + 1.4, FY + 2.1, face + 0.04);
    // Mueble bajo con robots y tablero perforado con herramientas.
    this.piece(m.timber, at(9.5), at(10.7), 0.45, FY, FY + 0.6, face + 0.225);
    this.piece(m.timber, at(9.5), at(10.7), 0.03, FY + 0.6, FY + 2.1, face + 0.03);
    for (const [s, mat] of [
      [9.7, m.red],
      [10.0, m.lime],
      [10.3, m.orange],
      [10.55, m.blue],
    ] as const) {
      this.piece(mat, at(s - 0.06), at(s + 0.06), 0.12, FY + 0.6, FY + 0.78, face + 0.25);
      this.piece(mat, at(s - 0.02), at(s + 0.02), 0.06, FY + 1.6, FY + 1.85, face + 0.07);
    }
    // Estantería alta con ocho cajas negras y el camión amarillo arriba.
    this.piece(m.timber, at(10.8), at(11.6), 0.4, FY, FY + 1.9, face + 0.2);
    for (const y of [0.15, 0.6, 1.05, 1.5]) {
      this.piece(m.metalDark, at(10.85), at(11.55), 0.36, FY + y, FY + y + 0.32, face + 0.22);
    }
    this.piece(m.yellow, at(11.0), at(11.45), 0.3, FY + 1.9, FY + 2.15, face + 0.2);
    // Testero de Miguel Cané: pizarrón interactivo y dos estanterías.
    const mcIn = (v: number, off: number): P => {
      const u = miguelCaneU(v);
      // Normal hacia adentro (este) de la línea de Miguel Cané.
      return [u + off * MC_COS, v + off * 0.6386 * MC_COS];
    };
    this.piece(m.metalDark, mcIn(-33.45, 0.17), mcIn(-34.95, 0.17), 0.05, FY + 0.88, FY + 2.12);
    this.piece(m.board, mcIn(-33.5, 0.2), mcIn(-34.9, 0.2), 0.02, FY + 0.92, FY + 2.08);
    for (const [v0, v1] of [
      [-31.9, -32.6],
      [-35.7, -36.4],
    ] as const) {
      this.piece(m.timber, mcIn(v0, 0.35), mcIn(v1, 0.35), 0.4, FY, FY + 1.8);
      this.piece(m.blue, mcIn(v0, 0.35), mcIn(v1, 0.35), 0.36, FY + 1.8, FY + 2.0);
    }
  }

  /** Vigas negras del aula de danzas, de columna roja a columna roja. */
  private salonBeams(): void {
    for (const v of SALON_COLUMNS) {
      this.box(this.m.metalDark, (U.salonW + U.gymW) / 2, v, U.gymW - U.salonW - 0.2, 0.26, 0.2, FY + 3.1 - 0.26);
    }
  }

  /** Núcleo gris del plano, descanso de la escalera exterior y descanso principal. */
  private cores(): void {
    // Descansos: macizos los bajos, losa los de los pisos altos.
    for (const l of LANDINGS) {
      const top = FY + l.y;
      const bottom = l.y < 3 && !l.hollow ? 0 : top - 0.24;
      this.box(this.m.stair, (l.u0 + l.u1) / 2, (l.v0 + l.v1) / 2, l.u1 - l.u0, top - bottom, l.v1 - l.v0, bottom);
    }
    // Tabique entre tramos.
    this.box(this.m.white, 24.6, -27.47, 2.6, 3.2, 0.12, 0);
  }

  // ============================================================ equipamiento

  private item(it: Item): void {
    const m = this.m;
    const { u, v, w, d } = it;
    const level = it.level ?? 0;
    const room = roomAt(u, v, level);
    // Piso del nivel del objeto: todo lo que sigue se apoya en `FY`.
    const FY = LEVEL_Y[level];
    this.fy = FY;
    const alongV = it.face === 'e' || it.face === 'w';
    switch (it.kind) {
      case 'desk': {
        // Tapa (madera o laminado de color) sobre cuatro patas finas y un travesaño.
        const top = FURNITURE.deskTop - 0.04;
        this.box(this.mat(it.color, m.timber), u, v, w, 0.04, d, FY + top);
        if (!this.detailed) {
          // Dos laterales en vez de cuatro patas y travesaño.
          for (const s of [-1, 1]) {
            if (alongV) this.box(m.metalDark, u, v + s * (d / 2 - 0.05), w - 0.1, top, 0.03, FY);
            else this.box(m.metalDark, u + s * (w / 2 - 0.05), v, 0.03, top, d - 0.1, FY);
          }
          break;
        }
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(m.metalDark, u + su * (w / 2 - 0.05), v + sv * (d / 2 - 0.05), 0.035, top, 0.035, FY);
        }
        if (alongV) this.box(m.metalDark, u + w / 2 - 0.05, v, 0.03, 0.03, d - 0.1, FY + 0.25);
        else this.box(m.metalDark, u, v + d / 2 - 0.05, w - 0.1, 0.03, 0.03, FY + 0.25);
        // Bandeja portalibros de chapa bajo la tapa, como en los bancos reales.
        this.box(m.metalDark, u, v, w - 0.1, 0.015, d - 0.1, FY + top - 0.15);
        break;
      }
      case 'chair': {
        const mat = room?.id === 'tecnologia' ? m.chairBlue : room?.id === 'teatro' ? m.black : m.chairGreen;
        // Las sillitas del jardín (36 cm en el plano) son de talle chico: antes
        // se dibujaban de adulto junto a mesas de adulto.
        this.chair(this.mat(it.color, mat), u, v, it.face, room && KINDER_ROOMS.has(room.id) ? FURNITURE.smallScale : 1);
        break;
      }
      case 'table': {
        const top = (room && KINDER_ROOMS.has(room.id) ? FURNITURE.smallTable : FURNITURE.tableTop) - 0.04;
        this.box(this.mat(it.color, m.timber), u, v, w, 0.04, d, FY + top);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(m.metalDark, u + su * (w / 2 - 0.08), v + sv * (d / 2 - 0.08), 0.04, top, 0.04, FY);
        }
        // Bastidor de caño bajo la tapa (sin él la tapa parecía apoyada en
        // cuatro palitos sueltos).
        if (this.detailed) {
          for (const s of [-1, 1]) {
            if (w >= d) this.box(m.metalDark, u, v + s * (d / 2 - 0.08), w - 0.2, 0.05, 0.02, FY + top - 0.05);
            else this.box(m.metalDark, u + s * (w / 2 - 0.08), v, 0.02, 0.05, d - 0.2, FY + top - 0.05);
          }
        }
        break;
      }
      case 'teacherDesk': {
        this.box(m.timberDark, u, v, w, 0.05, d, FY + 0.73);
        if (alongV) {
          for (const s of [-1, 1]) this.box(m.timberDark, u, v + s * (d / 2 - 0.03), w, 0.73, 0.05, FY);
        } else {
          for (const s of [-1, 1]) this.box(m.timberDark, u + s * (w / 2 - 0.03), v, 0.05, 0.73, d, FY);
        }
        // Faldón del lado de los alumnos (el docente se sienta del otro).
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        const span = (alongV ? d : w) - 0.1;
        this.box(m.timberDark, u + fu * (depth / 2 - 0.04), v + fv * (depth / 2 - 0.04), alongV ? 0.025 : span, 0.55, alongV ? span : 0.025, FY + 0.18);
        break;
      }
      case 'hexTable':
      case 'roundTable': {
        const top = this.mat(it.color, it.kind === 'hexTable' ? m.timber : m.blue);
        const hgt = (it.kind === 'hexTable' ? FURNITURE.tableTop : FURNITURE.smallTable) - 0.05;
        this.cyl(top, u, v, w, 0.05, FY + hgt);
        this.box(m.metalDark, u, v, 0.08, hgt, 0.08, FY);
        // Pie en cruz en el piso: con un solo poste la mesa no se sostendría.
        if (this.detailed) {
          this.box(m.metalDark, u, v, w * 0.6, 0.03, 0.06, FY);
          this.box(m.metalDark, u, v, 0.06, 0.03, w * 0.6, FY);
        }
        const chairMat = it.kind === 'hexTable' ? m.chairBlue : m.red;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          const cu = u + Math.cos(a) * (w / 2 + 0.3);
          const cv = v + Math.sin(a) * (w / 2 + 0.3);
          // Mirando al centro de la mesa (a 45°, no al norte o al sur).
          this.chair(chairMat, cu, cv, [-Math.cos(a), -Math.sin(a)], it.kind === 'roundTable' ? FURNITURE.smallScale : 1);
        }
        break;
      }
      case 'board':
        // Pizarra blanca con marco de aluminio y bandeja para fibrones.
        this.wallBoard(it, m.board, m.metal, FY + FURNITURE.boardBottom, FURNITURE.boardTop - FURNITURE.boardBottom);
        break;
      case 'shelf': {
        const mat = this.mat(it.color, room?.id === 'jardin' ? m.appliance : m.timberDark);
        const levels = [0.5, 0.95, 1.4];
        // Mismo azar en escritorio y en VR (la semilla tiene que dar lo mismo).
        const picks = levels.map(() => this.rng.pick([m.red, m.navy, m.chairGreen, m.timber]));
        if (!this.detailed) {
          this.box(mat, u, v, w, 1.85, d, FY);
          levels.forEach((y, k) => {
            if (alongV) this.box(picks[k], u, v, w + 0.02, 0.28, d - 0.2, FY + y);
            else this.box(picks[k], u, v, w - 0.2, 0.28, d + 0.02, FY + y);
          });
          break;
        }
        // Biblioteca abierta: laterales, techo, zócalo, fondo y estantes, con
        // libros y biblioratos que no llenan cada estante (antes era un bloque
        // macizo con tres franjas de color que asomaban por los costados).
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        const span = alongV ? d : w;
        const slab = (mt: Material, a: number, off: number, l: number, dep: number, y: number, h: number) =>
          this.box(mt, u + (alongV ? 0 : a) + fu * off, v + (alongV ? a : 0) + fv * off, alongV ? dep : l, h, alongV ? l : dep, y);
        for (const s of [-1, 1]) slab(mat, (s * (span - 0.025)) / 2, 0, 0.025, depth, FY, 1.85);
        const inner = span - 0.05;
        slab(mat, 0, 0, inner, depth, FY + 1.83, 0.02);
        slab(mat, 0, 0.01, inner, depth - 0.02, FY, 0.08);
        slab(mat, 0, -(depth / 2 - 0.006), inner, 0.012, FY + 0.08, 1.75);
        levels.forEach((y, k) => {
          slab(mat, 0, 0.005, inner, depth - 0.02, FY + y - 0.02, 0.02);
          // Dos tramos de lomos por estante, de ancho y alto distintos.
          const h0 = 0.22 + ((k * 37 + Math.round(u * 13 + v * 7)) % 5) * 0.015;
          const l0 = inner * (0.42 + ((k * 53 + Math.round(u * 11)) % 4) * 0.08);
          slab(picks[k], -inner / 2 + l0 / 2 + 0.01, -0.02, l0, depth - 0.1, FY + y, h0);
          const l1 = inner * 0.22;
          slab(picks[(k + 1) % picks.length], inner / 2 - l1 / 2 - 0.04, -0.02, l1, depth - 0.12, FY + y, h0 + 0.03);
        });
        // Cajas sobre el zócalo.
        slab(picks[2], -inner / 4, -0.02, inner * 0.4, depth - 0.1, FY + 0.08, 0.3);
        break;
      }
      case 'counter': {
        const body = this.mat(it.color, room?.id === 'buffet' ? m.black : m.appliance);
        this.box(body, u, v, w, 0.92, d, FY);
        this.box(room?.id === 'buffet' ? m.timberDark : m.frame, u, v, w + 0.04, 0.05, d + 0.04, FY + 0.92);
        break;
      }
      case 'fridge': {
        this.box(m.appliance, u, v, w, 1.9, d, FY);
        this.box(m.glass, u - 0.36, v, 0.02, 1.6, d - 0.1, FY + 0.15);
        break;
      }
      case 'planter': {
        this.box(this.mat(it.color, m.blue), u, v, w, 0.6, d, FY);
        this.box(m.soil, u, v, w - 0.12, 0.04, d - 0.12, FY + 0.58);
        const n = Math.max(1, Math.round(Math.max(w, d) / 1.1));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const p = toWorld(this.f, u + (w >= d ? t * (w - 0.5) : 0), v + (w >= d ? 0 : t * (d - 0.5)));
          this.nature.shrub(p.x, p.z, this.rng.range(0.55, 0.8), FY + 0.6);
        }
        break;
      }
      case 'bench': {
        const mat = this.mat(it.color, room?.id === 'buffet' ? m.timberDark : m.red);
        this.box(mat, u, v, w, 0.06, d, FY + 0.42);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(m.metalDark, u + s * (w / 2 - 0.12), v, 0.06, 0.42, d - 0.06, FY);
          else this.box(m.metalDark, u, v + s * (d / 2 - 0.12), w - 0.06, 0.42, 0.06, FY);
        }
        break;
      }
      case 'tree': {
        this.box(m.soil, u, v, 1.1, 0.04, 1.1, FY);
        this.box(m.slab, u, v, 1.3, 0.12, 1.3, FY - 0.08);
        const p = toWorld(this.f, u, v);
        this.nature.broadleaf(p.x, p.z, this.rng.range(0.75, 0.95), FY);
        break;
      }
      case 'column': {
        // Columnas de sección cuadrada: comparten malla con el resto de las
        // cajas de su color (un cilindro por color sería un draw call más).
        const mat = room?.id === 'salon' ? m.red : room?.id === 'tecnologia' ? m.blue : m.chairGreen;
        this.box(mat, u, v, w, 3.22 - FY, d, FY);
        break;
      }
      case 'mirror': {
        const mh = it.h ?? 1.9;
        this.box(it.color ? m.mirrorGlass : m.mirror, u, v, w, mh, d, FY + 0.25);
        const len = alongV ? d : w;
        const [fu, fv] = faceDir(it.face);
        if (it.color) {
          // Marco de color (rojo en el aula de danzas).
          const fm = this.m[it.color];
          for (const sgn of [-1, 1]) {
            if (alongV) this.box(fm, u, v + (sgn * len) / 2, w + 0.03, mh + 0.08, 0.06, FY + 0.21);
            else this.box(fm, u + (sgn * len) / 2, v, 0.06, mh + 0.08, d + 0.03, FY + 0.21);
          }
          for (const y of [FY + 0.21, FY + 0.25 + mh]) {
            this.box(fm, u, v, alongV ? w + 0.03 : len + 0.06, 0.06, alongV ? len + 0.06 : d + 0.03, y);
          }
        } else if (wallGapBehind(level, u - (fu * w) / 2, v - (fv * d) / 2, it.face) > 0.1) {
          // Espejo de pie (lejos del muro): parantes negros y patas en escuadra
          // hacia atrás, en vez de un vidrio flotando a 25 cm del piso.
          for (const sgn of [-1, 1]) {
            const eu = u + (alongV ? 0 : (sgn * (len + 0.03)) / 2);
            const ev = v + (alongV ? (sgn * (len + 0.03)) / 2 : 0);
            this.box(m.metalDark, eu, ev, 0.03, mh + 0.28, 0.03, FY);
            this.box(m.metalDark, eu - fu * 0.15, ev - fv * 0.15, alongV ? 0.32 : 0.03, 0.03, alongV ? 0.03 : 0.32, FY);
          }
          for (const y of [FY + 0.22, FY + 0.25 + mh]) {
            this.box(m.metalDark, u, v, alongV ? 0.03 : len + 0.06, 0.03, alongV ? len + 0.06 : 0.03, y);
          }
        }
        break;
      }
      case 'barre': {
        // Barra de ballet: pasamano a 1 m sobre parantes cada ~2 m.
        const rail = this.mat(it.color, m.timber);
        const len = alongV ? d : w;
        this.box(rail, u, v, alongV ? 0.05 : len, 0.05, alongV ? len : 0.05, FY + 1.0);
        const n = Math.max(1, Math.round(len / 2));
        for (let k = 0; k <= n; k++) {
          const t = k / n - 0.5;
          this.box(m.metalDark, u + (alongV ? 0 : t * len), v + (alongV ? t * len : 0), 0.04, 1.02, 0.04, FY);
        }
        break;
      }
      case 'stall': {
        // Cubículo: dos tabiques, frente con puerta entornada e inodoro.
        for (const s of [-1, 1]) this.box(m.frame, u, v + s * (d / 2), w, 1.9, 0.04, FY + 0.12);
        this.box(m.leaf, u - w / 2, v - 0.18, 0.04, 1.8, d - 0.45, FY + 0.12);
        this.box(m.appliance, u + w / 2 - 0.35, v, 0.55, 0.42, 0.38, FY);
        // Los tabiques se separan 12 cm del piso sobre patas de acero (antes
        // flotaban en el aire).
        if (this.detailed) {
          for (const s of [-1, 1]) {
            for (const e of [-1, 1]) this.box(m.metal, u + e * (w / 2 - 0.08), v + s * (d / 2), 0.03, 0.12, 0.03, FY);
          }
        }
        break;
      }
      case 'stage': {
        // Tarima con zócalo al frente (hacia `face`, donde cuelga el telón) y
        // fondo negro atrás. Antes los dos iban siempre al norte: en el SUM
        // el fondo tapaba el frente y en Teatro el zócalo quedaba atrás.
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        const span = alongV ? d : w;
        const thin = (off: number, t: number, len: number, y0: number, hgt: number, mat: Material) =>
          this.box(mat, u + fu * off, v + fv * off, alongV ? t : len, hgt, alongV ? len : t, y0);
        this.box(m.black, u, v, w, 0.62, d, FY);
        thin(depth / 2 + 0.01, 0.02, span, FY, 0.6, m.black);
        thin(-(depth / 2 - 0.06), 0.04, span - 0.1, FY + 0.62, FURNITURE.backdrop, m.black);
        break;
      }
      case 'curtain': {
        // Telón rojo recogido a los costados y bambalina contra el cielorraso
        // de su ambiente (antes iba a una altura fija de planta baja: en el SUM
        // del 2º piso la bambalina quedaba dos pisos más abajo).
        const ceil = FY + (room ? ceilingHeight(room) : 3.1) - 0.03;
        for (const s of [-1, 1]) this.box(m.curtainRed, u + s * (w / 2 - 0.35), v, 0.7, ceil - (FY + 0.62), 0.16, FY + 0.62);
        this.box(m.curtainRed, u, v, w, 0.45, 0.18, ceil - 0.45);
        break;
      }
      case 'goal': {
        // Arco de handball rojo: postes y travesaño en el frente, red blanca
        // (malla de hilos) atrás, a los costados y arriba.
        const [fu, fv] = faceDir(it.face);
        const width = alongV ? d : w;
        const depth = alongV ? w : d;
        const pu = u + fu * depth * 0.45;
        const pv = v + fv * depth * 0.45;
        const bu = u - fu * depth * 0.45;
        const bv = v - fv * depth * 0.45;
        const across = (c: number) => (alongV ? [0, c] : [c, 0]);
        for (const sgn of [-1, 1]) {
          const [du, dv] = across((sgn * width) / 2);
          this.box(m.red, pu + du, pv + dv, 0.08, 2.0, 0.08, FY);
        }
        this.box(m.red, pu, pv, alongV ? 0.08 : width + 0.08, 0.08, alongV ? width + 0.08 : 0.08, FY + 2.0);
        // Malla: hilos verticales y horizontales.
        for (let k = 0; k <= 8; k++) {
          const [du, dv] = across((k / 8 - 0.5) * width);
          this.box(m.board, bu + du, bv + dv, 0.015, 2.0, 0.015, FY);
        }
        for (let k = 1; k <= 4; k++) {
          this.box(m.board, bu, bv, alongV ? 0.015 : width, 0.015, alongV ? width : 0.015, FY + k * 0.5 - 0.05);
        }
        for (const sgn of [-1, 1]) {
          const [du, dv] = across((sgn * width) / 2);
          for (let k = 1; k <= 3; k++) {
            this.box(m.board, u + du, v + dv, alongV ? depth * 0.9 : 0.015, 0.015, alongV ? 0.015 : depth * 0.9, FY + k * 0.62);
          }
        }
        break;
      }
      case 'bleachers': {
        // Tribuna de caño negro: tres gradas que suben hacia el muro, con
        // estructura a la vista (no son macizas) y asientos de chapa.
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        const span = alongV ? d : w;
        for (let k = 0; k < 3; k++) {
          const off = (k - 1) * (depth / 3);
          const cu = u - fu * off;
          const cv = v - fv * off;
          const top = FY + 0.42 * (k + 1);
          this.box(m.metalDark, cu, cv, alongV ? depth / 3 : span, 0.04, alongV ? span : depth / 3, top - 0.04);
          // Patas y riostras.
          for (const sgn of [-1, 1]) {
            const pu = cu + (alongV ? 0 : (sgn * span) / 2);
            const pv = cv + (alongV ? (sgn * span) / 2 : 0);
            this.box(m.metalDark, pu, pv, 0.05, top - FY, 0.05, FY);
          }
        }
        // Baranda del fondo.
        const ru = u - fu * (depth / 2);
        const rv = v - fv * (depth / 2);
        this.box(m.metalDark, ru, rv, alongV ? 0.05 : span, 0.05, alongV ? span : 0.05, FY + 2.2);
        break;
      }
      case 'seats': {
        const n = Math.max(2, Math.round(Math.max(w, d) / 0.55));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          this.chair(m.black, u + (alongV ? 0 : t * w), v + (alongV ? t * d : 0), it.face);
        }
        break;
      }
      case 'booth': {
        // Cabina de recepción (0:18-0:28): frente rojo hasta 1,02 m, mostrador
        // blanco, vidrio en marcos de aluminio blanco hasta 2,4 m y techo.
        // Dos caras a la vista: la que mira a `face` y la del norte (−v).
        const [fu, fv] = faceDir(it.face);
        const faces: Array<[number, number, number, boolean]> = [
          [u + fu * (w / 2), v + fv * (d / 2), alongV ? d : w, alongV],
          [u, v - d / 2, w, false],
        ];
        for (const [cu, cv, len, onV] of faces) {
          const bw = onV ? 0.06 : len;
          const bd = onV ? len : 0.06;
          this.box(m.red, cu, cv, bw, 1.02, bd, FY);
          this.box(m.board, cu, cv, onV ? 0.3 : len + 0.04, 0.04, onV ? len + 0.04 : 0.3, FY + 1.02);
          this.box(m.glass, cu, cv, onV ? 0.02 : len, 1.3, onV ? len : 0.02, FY + 1.06);
          const n = Math.max(1, Math.round(len / 1.0));
          for (let k = 0; k <= n; k++) {
            const t = k / n - 0.5;
            this.box(m.frame, cu + (onV ? 0 : t * len), cv + (onV ? t * len : 0), 0.05, 1.34, 0.05, FY + 1.06);
          }
          this.box(m.frame, cu, cv, onV ? 0.08 : len, 0.06, onV ? len : 0.08, FY + 2.36);
        }
        this.box(m.board, u, v, w, 0.06, d, FY + 2.42);
        break;
      }
      case 'playhouse': {
        const jardin = room?.id === 'jardin';
        const body = jardin ? m.yellow : m.timber;
        this.box(body, u, v, w, 1.3, d, FY);
        this.box(m.bars, u, v - d / 2, w * 0.35, 0.9, 0.02, FY + 0.1);
        const p = toWorld(this.f, u, v);
        for (const s of [-1, 1]) {
          this.farm.add(
            'box',
            jardin ? m.red : m.timberDark,
            new Vector3(p.x, FY + 1.62, p.z + s * (d / 4 + 0.02)),
            new Vector3(w + 0.2, 0.06, d / 2 + 0.25),
            0,
            s * 0.62,
          );
        }
        break;
      }
      case 'banner': {
        // Banner de pie: base y parante; la lona la pinta SchoolIdentity.
        if (alongV) this.box(m.metalDark, u, v, 0.25, 0.08, w, FY);
        else this.box(m.metalDark, u, v, w, 0.08, 0.25, FY);
        this.box(m.metalDark, u, v, 0.03, 2.2, 0.03, FY);
        break;
      }
      case 'lockers': {
        // Cuatro puertas: juntas verticales, rejilla de ventilación arriba y
        // manija en cada una. Las juntas siguen al frente (antes, en los que
        // miran al este, cortaban el costado del mueble en vez del frente).
        const span = alongV ? d : w;
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        this.box(this.mat(it.color, m.navy), u, v, w, 1.8, d, FY);
        const front = (a: number, off: number, l: number, y: number, h: number, mt: Material, dep = 0.02) =>
          this.box(mt, u + (alongV ? 0 : a) + fu * off, v + (alongV ? a : 0) + fv * off, alongV ? dep : l, h, alongV ? l : dep, y);
        for (let k = 1; k < 4; k++) front(-span / 2 + (k * span) / 4, depth / 2, 0.012, FY + 0.05, 1.7, m.bars);
        if (this.detailed) {
          for (let k = 0; k < 4; k++) {
            const c = -span / 2 + ((k + 0.5) * span) / 4;
            // Tres ranuras finas de ventilación arriba de cada puerta.
            for (const y of [1.52, 1.56, 1.6]) front(c, depth / 2, span / 4 - 0.2, FY + y, 0.012, m.bars, 0.008);
            front(c + span / 8 - 0.07, depth / 2 + 0.01, 0.02, FY + 0.95, 0.12, m.metal, 0.03);
          }
        }
        break;
      }
      // ------------------------------------------------ recorrido 2020
      case 'extinguisher': {
        const y = FY + (it.y ?? 0.95);
        this.cyl(m.red, u, v, 0.17, 0.52, y);
        this.box(m.metalDark, u, v, 0.08, 0.12, 0.08, y + 0.52);
        break;
      }
      case 'fan': {
        // Ventilador de pared: soporte, motor y rejilla circular.
        const y = FY + (it.y ?? 2.35);
        const [nu, nv] = faceDir(it.face);
        this.box(m.frame, u - nu * 0.05, v - nv * 0.05, 0.08, 0.2, 0.08, y - 0.1);
        // Motor y rejilla redonda (antes, una placa cuadrada de 46 cm).
        this.box(m.frame, u + nu * 0.04, v + nv * 0.04, 0.12, 0.14, 0.12, y + 0.14);
        const g = toWorld(this.f, u + nu * 0.14, v + nv * 0.14);
        this.farm.add('cylinder', m.frame, new Vector3(g.x, y + 0.21, g.z), new Vector3(0.46, 0.09, 0.46), 0, alongV ? 0 : Math.PI / 2, alongV ? Math.PI / 2 : 0);
        break;
      }
      case 'ac': {
        const y = FY + (it.y ?? 2.45);
        this.box(m.frame, u, v, alongV ? 0.22 : 0.86, 0.29, alongV ? 0.86 : 0.22, y);
        // Boca de salida del aire, oscura, en el frente inferior del split.
        const [nu, nv] = faceDir(it.face);
        if (this.detailed) this.box(m.metalDark, u + nu * 0.1, v + nv * 0.1, alongV ? 0.03 : 0.7, 0.03, alongV ? 0.7 : 0.03, y + 0.03);
        break;
      }
      case 'projector': {
        const top = FY + (it.y ?? 3.0);
        this.box(m.frame, u, v, 0.05, 0.4, 0.05, top - 0.4);
        this.box(m.frame, u, v, 0.36, 0.12, 0.3, top - 0.52);
        break;
      }
      case 'speaker':
        this.box(m.metalDark, u, v, alongV ? 0.22 : 0.26, 0.38, alongV ? 0.26 : 0.22, FY + (it.y ?? 2.5));
        break;
      case 'tv':
        this.box(m.metalDark, u, v, alongV ? 0.06 : w, it.h ?? 0.62, alongV ? w : 0.06, FY + (it.y ?? 1.5));
        break;
      case 'blackboard':
        // Pizarrón de tiza con marco de aluminio y bandeja de tizas.
        this.wallBoard(it, this.mat(it.color, m.chalk), m.frame, FY + (it.y ?? 0.9), it.h ?? 1.2);
        break;
      case 'roundColumn':
        this.cyl(this.mat(it.color, m.red), u, v, w, it.h ?? 3.1, FY);
        break;
      case 'paddedColumn': {
        // Columna con protección acolchada hasta 2 m (como la verde del hall).
        const top = it.h ?? 3.1;
        this.box(m.white, u, v, w * 0.8, top, d * 0.8, FY);
        this.box(this.mat(it.color, m.chairGreen), u, v, w, 2.0, d, FY + 0.05);
        break;
      }
      case 'workbench': {
        const legs = this.mat(it.color, m.blue);
        this.box(m.timber, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(legs, u + su * (w / 2 - 0.06), v + sv * (d / 2 - 0.06), 0.05, 0.74, 0.05, FY);
        }
        if (w >= d) this.box(legs, u, v, w - 0.12, 0.04, 0.04, FY + 0.3);
        else this.box(legs, u, v, 0.04, 0.04, d - 0.12, FY + 0.3);
        break;
      }
      case 'benchSeat': {
        const legs = this.mat(it.color, m.blue);
        this.box(m.timber, u, v, w, 0.04, d, FY + 0.44);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(legs, u + s * (w / 2 - 0.1), v, 0.05, 0.44, d - 0.05, FY);
          else this.box(legs, u, v + s * (d / 2 - 0.1), w - 0.05, 0.44, 0.05, FY);
        }
        break;
      }
      case 'stool': {
        const mat = this.mat(it.color, m.metalDark);
        this.box(mat, u, v, 0.34, 0.04, 0.34, FY + 0.72);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(mat, u + su * 0.13, v + sv * 0.13, 0.03, 0.72, 0.03, FY);
        }
        break;
      }
      case 'pegboard': {
        this.box(m.timber, u, v, alongV ? 0.03 : w, it.h ?? 1.0, alongV ? w : 0.03, FY + (it.y ?? 1.0));
        const [nu, nv] = faceDir(it.face);
        for (let k = 0; k < 4; k++) {
          const t = (k + 0.5) / 4 - 0.5;
          const tool = [m.red, m.orange, m.lime, m.blue][k];
          this.box(tool, u + (alongV ? nu * 0.04 : t * w * 0.8), v + (alongV ? t * w * 0.8 : nv * 0.04), 0.06, 0.18, 0.06, FY + (it.y ?? 1.0) + 0.55);
        }
        break;
      }
      case 'cabinet': {
        // Mueble alto de melamina clara con estantes y cajas.
        const hgt = it.h ?? 1.9;
        this.box(m.timber, u, v, w, hgt, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 5; k++) {
          const y = FY + (k * hgt) / 5;
          const box = k % 2 === 0 ? m.blue : m.metalDark;
          this.box(box, u + nu * 0.02, v + nv * 0.02, alongV ? d * 0.9 : w * 0.85, 0.22, alongV ? w * 0.85 : d * 0.9, y - 0.25);
        }
        break;
      }
      case 'laserCutter': {
        // Apoyada sobre la mesa de trabajo (antes se hundía 2 cm en la tapa).
        const b = FY + FURNITURE.benchTop;
        this.box(m.blue, u, v, w, 0.26, d, b);
        this.box(m.board, u, v, w * 0.96, 0.08, d * 0.96, b + 0.26);
        this.box(m.metalDark, u, v, w * 0.5, 0.01, d * 0.5, b + 0.34);
        break;
      }
      case 'printer3d': {
        const b = FY + FURNITURE.benchTop;
        this.box(m.metalDark, u, v, w, w, d, b);
        this.box(m.blue, u, v, w * 1.02, 0.06, d * 1.02, b);
        break;
      }
      case 'buffetLine': {
        // Mostrador de acero inoxidable con mampara de vidrio.
        this.box(m.metal, u, v, w, 0.9, d, FY);
        this.box(m.metal, u, v, w + 0.04, 0.04, d + 0.04, FY + 0.9);
        if (alongV) this.box(m.glass, u, v, 0.02, 0.45, d - 0.1, FY + 1.25);
        else this.box(m.glass, u, v, w - 0.1, 0.45, 0.02, FY + 1.25);
        for (const s of [-1, 1]) {
          if (alongV) this.box(m.metal, u, v + s * (d / 2 - 0.05), 0.03, 0.4, 0.03, FY + 0.94);
          else this.box(m.metal, u + s * (w / 2 - 0.05), v, 0.03, 0.4, 0.03, FY + 0.94);
        }
        break;
      }
      case 'displayCase':
        this.box(m.metal, u, v, w, 0.85, d, FY);
        this.box(m.glass, u, v, w * 0.96, 0.42, d * 0.9, FY + 0.85);
        this.box(m.metal, u, v, w, 0.03, d, FY + 1.27);
        break;
      case 'fridgeGlass': {
        this.box(m.metalDark, u, v, w, 2.0, d, FY);
        const [nu, nv] = faceDir(it.face);
        this.box(m.glass, u + nu * (d / 2 + 0.01), v + nv * (d / 2 + 0.01), alongV ? 0.02 : w - 0.1, 1.7, alongV ? w - 0.1 : 0.02, FY + 0.15);
        // Botellas de colores detrás del vidrio.
        for (let k = 0; k < 4; k++) {
          const y = FY + 0.3 + k * 0.4;
          this.box([m.orange, m.lime, m.red, m.blue][k], u, v, alongV ? d * 0.6 : w * 0.8, 0.22, alongV ? w * 0.8 : d * 0.6, y);
        }
        break;
      }
      case 'pendantRail': {
        // Viga negra colgada con campanas industriales negras.
        const ceil = FY + 3.1;
        const y = ceil - 0.75;
        this.box(m.metalDark, u, v, w, 0.14, d, y);
        const n = Math.max(2, Math.round(Math.max(w, d) / 1.1));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const lu = u + (w >= d ? t * w : 0);
          const lv = v + (w >= d ? 0 : t * d);
          this.box(m.metalDark, lu, lv, 0.03, 0.3, 0.03, y - 0.3);
          this.cyl(m.metalDark, lu, lv, 0.3, 0.16, y - 0.46);
          this.cyl(m.light, lu, lv, 0.16, 0.02, y - 0.48);
        }
        for (const s of [-1, 1]) {
          this.box(m.metalDark, u + (w >= d ? s * w * 0.4 : 0), v + (w >= d ? 0 : s * d * 0.4), 0.02, ceil - y - 0.14, 0.02, y + 0.14);
        }
        break;
      }
      case 'longTable': {
        const frame = this.mat(it.color, m.chairGreen);
        this.box(m.board, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(frame, u + su * (w / 2 - 0.08), v + sv * (d / 2 - 0.08), 0.05, 0.74, 0.05, FY);
        }
        // Bancos verdes a los dos lados.
        for (const s of [-1, 1]) {
          if (w >= d) this.box(frame, u, v + s * (d / 2 + 0.3), w - 0.2, 0.05, 0.3, FY + 0.45);
          else this.box(frame, u + s * (w / 2 + 0.3), v, 0.3, 0.05, d - 0.2, FY + 0.45);
        }
        break;
      }
      case 'greenWall':
        this.box(m.green, u, v, alongV ? 0.08 : w, it.h ?? 1.8, alongV ? w : 0.08, FY + (it.y ?? 1.0));
        break;
      case 'bamboo': {
        this.box(m.metalDark, u, v, 0.35, 0.45, 0.35, FY);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          this.cyl(m.timber, u + Math.cos(a) * 0.08, v + Math.sin(a) * 0.08, 0.04, 1.9 + (k % 3) * 0.25, FY + 0.4);
        }
        break;
      }
      case 'piano':
        this.box(m.timberDark, u, v, w, 1.25, d, FY);
        this.box(m.board, u, v, alongV ? d * 0.4 : w * 0.9, 0.04, alongV ? w * 0.9 : d * 0.4, FY + 0.75);
        break;
      case 'drawers': {
        this.box(this.mat(it.color, m.board), u, v, w, it.h ?? 0.85, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 4; k++) {
          this.box(m.frame, u + nu * (d / 2 + 0.005), v + nv * (d / 2 + 0.005), alongV ? 0.01 : w * 0.95, 0.01, alongV ? w * 0.95 : 0.01, FY + (k * (it.h ?? 0.85)) / 4);
        }
        break;
      }
      case 'coatBench': {
        // Banco rojo con tablero rojo de percheros arriba.
        this.box(m.red, u, v, w, 0.05, d, FY + 0.42);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(m.metalDark, u + s * (w / 2 - 0.1), v, 0.05, 0.42, d - 0.06, FY);
          else this.box(m.metalDark, u, v + s * (d / 2 - 0.1), w - 0.06, 0.42, 0.05, FY);
        }
        const [nu, nv] = faceDir(it.face);
        this.box(m.red, u - nu * (d / 2 - 0.02), v - nv * (d / 2 - 0.02), alongV ? 0.03 : w, 0.28, alongV ? w : 0.03, FY + 1.5);
        break;
      }
      case 'gate': {
        // Reja de barrotes verticales.
        const mat = this.mat(it.color, m.red);
        const hgt = it.h ?? 2.1;
        // Barandas bajas: barrotes más espaciados (y aún más en VR).
        const step = (it.h ?? 2.1) < 1.3 ? (this.detailed ? 0.18 : 0.3) : this.detailed ? 0.12 : 0.2;
        const n = Math.max(3, Math.round(Math.max(w, d) / step));
        for (let k = 0; k <= n; k++) {
          const t = k / n - 0.5;
          this.box(mat, u + (alongV ? 0 : t * w), v + (alongV ? t * d : 0), 0.025, hgt, 0.025, FY);
        }
        for (const y of [0.1, hgt - 0.05]) this.box(mat, u, v, alongV ? 0.04 : w, 0.05, alongV ? d : 0.04, FY + y);
        break;
      }
      case 'plaques': {
        // Placas de bronce sobre madera oscura y un diploma de marco dorado,
        // apiladas (recorrido 0:20).
        const stack: Array<[Material, number, number, number]> = [
          [m.timberDark, 0.6, 1.05, 0.5],
          [m.yellow, 0.5, 1.1, 0.4],
          [m.timberDark, 0.55, 1.65, 0.45],
          [m.yellow, 0.45, 1.7, 0.35],
          [m.yellow, 0.55, 2.2, 0.75],
          [m.board, 0.45, 2.27, 0.61],
        ];
        const [nu, nv] = faceDir(it.face);
        stack.forEach(([mat, sw, y, sh], k) => {
          const off = 0.015 + (k % 2) * 0.012;
          this.box(mat, u + nu * off, v + nv * off, alongV ? 0.02 : sw, sh, alongV ? sw : 0.02, FY + y);
        });
        break;
      }
      case 'trophyShelf': {
        const y = FY + (it.y ?? 2.15);
        this.box(m.timberDark, u, v, w, 0.04, d, y);
        this.box(m.timberDark, u, v, w, 0.04, d, y + 0.42);
        const n = Math.max(3, Math.round(Math.max(w, d) / 0.22));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const tu = u + (alongV ? 0 : t * w);
          const tv = v + (alongV ? t * d : 0);
          this.cyl(m.yellow, tu, tv, 0.08, 0.22 + (k % 3) * 0.06, y + 0.04);
          this.box(m.timberDark, tu, tv, 0.1, 0.05, 0.1, y + 0.04);
        }
        break;
      }
      case 'waterCooler':
        this.box(m.board, u, v, 0.32, 1.0, 0.32, FY);
        this.cyl(m.glass, u, v, 0.26, 0.42, FY + 1.0);
        break;
      case 'plasticChair':
        this.chair(m.board, u, v, it.face);
        break;
      case 'filing': {
        this.box(m.red, u, v, w, it.h ?? 1.35, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 6; k++) {
          this.box(m.metalDark, u + nu * (d / 2 + 0.005), v + nv * (d / 2 + 0.005), alongV ? 0.01 : w * 0.95, 0.012, alongV ? w * 0.95 : 0.01, FY + (k * (it.h ?? 1.35)) / 6);
        }
        break;
      }
      case 'sinkCounter': {
        // Mesada con venecitas, bachas blancas y espejos encima.
        this.box(m.yellow, u, v, w, 0.85, d, FY);
        this.box(m.board, u, v, w + 0.02, 0.05, d + 0.02, FY + 0.85);
        const n = Math.max(1, Math.round(Math.max(w, d) / 0.8));
        const [nu, nv] = faceDir(it.face);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const su = u + (alongV ? 0 : t * w);
          const sv = v + (alongV ? t * d : 0);
          this.cyl(m.board, su, sv, 0.36, 0.06, FY + 0.88);
          this.box(m.glass, su - nu * (d / 2 - 0.02), sv - nv * (d / 2 - 0.02), alongV ? 0.02 : 0.5, 0.7, alongV ? 0.5 : 0.02, FY + 1.15);
        }
        break;
      }
      case 'copier':
        this.box(m.board, u, v, w, 0.95, d, FY);
        this.box(m.metalDark, u, v, w * 0.9, 0.06, d * 0.8, FY + 0.95);
        break;
      case 'desk2': {
        // Escritorio de oficina (blanco o del color indicado) con monitor.
        const top = this.mat(it.color, m.board);
        this.box(top, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          if (alongV) this.box(top, u, v + su * (d / 2 - 0.02), w, 0.74, 0.04, FY);
          else this.box(top, u + su * (w / 2 - 0.02), v, 0.04, 0.74, d, FY);
        }
        this.box(m.metalDark, u, v, alongV ? 0.05 : 0.55, 0.36, alongV ? 0.55 : 0.05, FY + 0.82);
        break;
      }
      case 'wallMat':
        this.box(this.mat(it.color, m.red), u, v, alongV ? 0.1 : w, it.h ?? 2.0, alongV ? w : 0.1, FY + (it.y ?? 0));
        break;
      case 'padPilaster':
        // Pilastra del polideportivo: verde abajo y roja arriba en el lateral
        // norte; toda roja en el de Laprida (9:22–9:32).
        if (it.face === 'n') {
          this.box(m.red, u, v, w, 2.7, d, FY + 0.1);
        } else {
          this.box(m.chairGreen, u, v, w, 1.3, d, FY + 0.1);
          this.box(m.red, u, v, w, 1.4, d, FY + 1.4);
        }
        break;
      case 'flagpole':
        this.cyl(m.metal, u, v, 0.07, it.h ?? 6.5, FY);
        break;
      case 'stack': {
        const mat = this.mat(it.color, m.red);
        const n = Math.round((it.h ?? 1.6) / 0.09);
        this.box(mat, u, v, w, 0.45, d, FY);
        for (let k = 0; k < n; k++) this.box(mat, u, v, w, 0.03, d, FY + 0.45 + k * 0.09);
        break;
      }
      case 'drumKit':
        this.cyl(m.red, u, v, 0.55, 0.45, FY + 0.05);
        for (const [du, dv] of [
          [-0.45, 0.25],
          [0.45, 0.25],
          [0, 0.45],
        ]) {
          this.cyl(m.red, u + du, v + dv, 0.32, 0.25, FY + 0.6);
          this.box(m.metal, u + du, v + dv, 0.02, 0.6, 0.02, FY);
        }
        this.cyl(m.yellow, u - 0.6, v - 0.2, 0.4, 0.01, FY + 1.1);
        break;
      case 'risers': {
        // Gradas de 3 escalones (rojo y azul alternados).
        for (let k = 0; k < 3; k++) {
          const [nu, nv] = faceDir(it.face);
          const off = (1 - k) * (alongV ? w : d) / 3;
          const mat = k % 2 === 0 ? m.red : m.blue;
          this.box(mat, u - nu * off, v - nv * off, alongV ? w / 3 : w, 0.3 * (k + 1), alongV ? d : d / 3, FY);
        }
        break;
      }
      case 'slide': {
        // Juego de plástico: torre, techo y tobogán.
        const tower = this.mat(it.color, m.yellow);
        this.box(tower, u, v, w * 0.5, 1.2, d * 0.5, FY);
        this.box(m.red, u, v, w * 0.55, 0.08, d * 0.55, FY + 1.6);
        const p = toWorld(this.f, u + w * 0.45, v);
        this.farm.add('box', m.red, new Vector3(p.x, FY + 0.6, p.z), new Vector3(1.4, 0.06, 0.5), this.yaw(1, 0), 0, -0.6);
        const q = toWorld(this.f, u, v + d * 0.45);
        this.farm.add('box', m.lime, new Vector3(q.x, FY + 0.6, q.z), new Vector3(0.5, 0.06, 1.4), 0, 0.6, 0);
        break;
      }
      case 'swing': {
        const frame = this.mat(it.color, m.lime);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(frame, u + s * w / 2, v, 0.08, 2.2, 0.08, FY);
          else this.box(frame, u, v + s * d / 2, 0.08, 2.2, 0.08, FY);
        }
        // Travesaño rojo arriba (9:52).
        this.box(m.red, u, v, w >= d ? w : 0.08, 0.08, w >= d ? 0.08 : d, FY + 2.2);
        for (const s of [-0.25, 0.25]) {
          const su = u + (w >= d ? s * w : 0);
          const sv = v + (w >= d ? 0 : s * d);
          this.box(m.metalDark, su, sv, 0.02, 1.7, 0.02, FY + 0.5);
          this.box(m.red, su, sv, 0.45, 0.04, 0.25, FY + 0.48);
        }
        break;
      }
      case 'wallPanel':
        this.box(this.mat(it.color, m.white), u, v, w, it.h ?? 1.0, d, FY + (it.y ?? 0));
        break;
      case 'floorPatch':
        // `y` levanta un parche sobre otro (líneas sobre el vinílico) sin z-fighting.
        this.box(this.mat(it.color, m.metalDark), u, v, w, 0.008, d, FY + 0.002 + (it.y ?? 0));
        break;
      case 'hoop': {
        // Aro de básquet chico: tablero rojo, aro naranja y red blanca.
        const [nu, nv] = faceDir(it.face);
        this.box(m.red, u, v, alongV ? 0.04 : w, 0.45, alongV ? w : 0.04, FY + 1.85);
        this.cyl(m.orange, u + nu * 0.25, v + nv * 0.25, 0.4, 0.02, FY + 1.95);
        this.cyl(m.board, u + nu * 0.25, v + nv * 0.25, 0.3, 0.3, FY + 1.65);
        break;
      }
      case 'ceilingFan': {
        // Cuatro aspas beige y una campana de bronce colgadas del techo.
        const y = FY + 2.75;
        this.box(m.metalDark, u, v, 0.03, 0.3, 0.03, y + 0.05);
        this.cyl(m.yellow, u, v, 0.2, 0.12, y - 0.05);
        this.box(m.timber, u, v, w, 0.015, 0.14, y);
        this.box(m.timber, u, v, 0.14, 0.015, d, y);
        break;
      }
      case 'palm':
        this.palm(u, v, it.h ?? 6, FY + (it.y ?? 0));
        break;
      case 'playTower': {
        // Torre de madera rojiza con techo, baranda y dos toboganes (9:44).
        const tw = Math.min(w, d) * 0.55;
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(m.timberDark, u + (su * tw) / 2, v + (sv * tw) / 2, 0.1, 2.6, 0.1, FY);
        }
        this.box(m.timberDark, u, v, tw, 0.08, tw, FY + 1.3);
        this.box(m.timber, u, v, tw, 0.5, 0.04, FY + 1.38);
        this.box(m.red, u, v, tw + 0.3, 0.08, tw + 0.3, FY + 2.6);
        for (const s of [-1, 1]) {
          const p = toWorld(this.f, u + s * (tw / 2 + 0.75), v);
          this.farm.add('box', s > 0 ? m.yellow : m.lime, new Vector3(p.x, FY + 0.65, p.z), new Vector3(1.7, 0.05, 0.5), this.yaw(1, 0), 0, s * 0.72);
        }
        break;
      }
      case 'aviary': {
        // Jaula de malla con marco de color y techo de chapa.
        const frame = this.mat(it.color, m.red);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(frame, u + (su * w) / 2, v + (sv * d) / 2, 0.06, 2.0, 0.06, FY);
        }
        this.box(m.metal, u, v, w + 0.2, 0.05, d + 0.2, FY + 2.0);
        this.box(m.mesh, u, v + d / 2, w, 1.9, 0.01, FY + 0.05);
        this.box(frame, u, v + d / 2, w, 0.05, 0.05, FY + 1.0);
        break;
      }
      case 'hut':
        // Choza de paja sobre parantes, contra la medianera azul.
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.box(m.timberDark, u + (su * w) / 2.4, v + (sv * d) / 2.4, 0.1, 1.9, 0.1, FY);
        }
        this.cyl(m.timber, u, v, Math.max(w, d) * 0.9, 0.7, FY + 1.9);
        this.cyl(m.timber, u, v, Math.max(w, d) * 0.5, 0.45, FY + 2.55);
        break;
      case 'climber': {
        // Domo trepador: aros de caño de colores.
        const p = toWorld(this.f, u, v);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI;
          this.farm.add('box', [m.red, m.blue, m.yellow, m.lime][k], new Vector3(p.x, FY + 0.6, p.z), new Vector3(w, 0.05, 0.05), a, 0, 0);
        }
        this.cyl(m.red, u, v, w * 0.7, 0.05, FY + 1.15);
        break;
      }
      case 'bikeRack':
        for (let k = 0; k < 5; k++) {
          const t = (k / 4 - 0.5) * (alongV ? d : w);
          this.box(m.metal, u + (alongV ? 0 : t), v + (alongV ? t : 0), alongV ? 0.5 : 0.04, 0.75, alongV ? 0.04 : 0.5, FY);
        }
        break;
      case 'waterTank':
        // Tanque de agua negro sobre una base, en la azotea.
        this.box(m.slab, u, v, w + 0.2, 0.3, d + 0.2, FY + (it.y ?? 0));
        this.cyl(m.metalDark, u, v, w, 1.4, FY + (it.y ?? 0) + 0.3);
        break;
      case 'bareTree': {
        // Árbol pelado de invierno: tronco y cinco ramas abiertas (2:01–2:13).
        this.box(m.soil, u, v, 1.1, 0.04, 1.1, FY);
        this.cyl(m.timberDark, u, v, 0.16, 2.6, FY);
        const p = toWorld(this.f, u, v);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.4;
          const lean = 0.55 + (k % 2) * 0.15;
          const len = 2.0 + (k % 3) * 0.3;
          this.farm.add(
            'box',
            m.timberDark,
            new Vector3(p.x + Math.sin(a) * Math.sin(lean) * len * 0.5, FY + 2.2 + Math.cos(lean) * len * 0.5, p.z + Math.cos(a) * Math.sin(lean) * len * 0.5),
            new Vector3(0.07, len, 0.07),
            a,
            lean,
          );
        }
        break;
      }
      case 'hedge': {
        const p = toWorld(this.f, u, v);
        this.nature.shrub(p.x, p.z, 1.6, FY);
        break;
      }
      case 'condenser': {
        // Unidad exterior blanca con la rejilla del ventilador y su ménsula.
        const y = FY + (it.y ?? 3.6);
        const [nu, nv] = faceDir(it.face);
        this.box(m.frame, u, v, alongV ? 0.3 : 0.8, 0.55, alongV ? 0.8 : 0.3, y);
        this.cyl(m.metalDark, u + nu * 0.16 + (alongV ? 0 : 0.12), v + nv * 0.16 + (alongV ? 0.12 : 0), 0.38, 0.03, y + 0.27);
        this.box(m.metalDark, u, v, alongV ? 0.32 : 0.86, 0.03, alongV ? 0.86 : 0.32, y - 0.04);
        break;
      }
      case 'louvredDoor':
        this.box(m.metalDark, u, v, alongV ? 0.05 : w, 2.05, alongV ? w : 0.05, FY);
        break;
    }
  }

  /**
   * Pizarra o pizarrón colgado: paño, marco perimetral que sobresale 1 cm y
   * bandeja abajo, todo hacia el lado al que mira (`face`). Antes el marco
   * era una caja del mismo espesor que el paño, centradas en el mismo plano:
   * las dos caras frontales coincidían y titilaban (la "mancha" de ruido del
   * pizarrón del Aula 1). En las que miraban al oeste o al norte, además, el
   * paño quedaba detrás del marco y la pizarra se veía gris oscura.
   */
  private wallBoard(it: Item, panel: Material, rim: Material, y0: number, hgt: number): void {
    const { u, v } = it;
    const alongV = it.face === 'e' || it.face === 'w';
    const len = alongV ? it.d : it.w;
    const [fu, fv] = faceDir(it.face);
    // Pieza a lo largo del muro: `a` corrido sobre el muro, `off` hacia el frente.
    const part = (mat: Material, a: number, off: number, l: number, depth: number, y: number, h: number) =>
      this.box(mat, u + (alongV ? 0 : a) + fu * off, v + (alongV ? a : 0) + fv * off, alongV ? depth : l, h, alongV ? l : depth, y);
    // Paño: de −1,5 a +0,5 cm respecto del plano del objeto.
    part(panel, 0, -0.005, len, 0.02, y0, hgt);
    if (!this.detailed) {
      // VR: un solo marco detrás, más grande, en vez de cuatro listones.
      part(rim, 0, -0.012, len + 0.05, 0.016, y0 - 0.025, hgt + 0.05);
      return;
    }
    // Marco: de −2 a +1,5 cm (sobresale 1 cm del paño). Los laterales van de
    // punta a punta y el de arriba y el de abajo entre ellos, sin encimarse.
    for (const s of [-1, 1]) part(rim, (s * (len + 0.025)) / 2, -0.0025, 0.025, 0.035, y0 - 0.025, hgt + 0.05);
    part(rim, 0, -0.0025, len, 0.035, y0 + hgt, 0.025);
    part(rim, 0, -0.0025, len, 0.035, y0 - 0.025, 0.025);
    // Bandeja de tizas/fibrones bajo el paño.
    part(rim, 0, 0.03, len * 0.9, 0.06, y0 - 0.045, 0.02);
  }

  /** Material por clave, con uno por defecto. */
  private mat(key: string | undefined, fallback: Material): Material {
    return (key && this.m[key]) || fallback;
  }

  /**
   * Silla escolar de caño: asiento y respaldo de multilaminado, cuatro patas
   * y dos parantes que sostienen el respaldo. `face` es hacia dónde mira, o
   * una dirección cualquiera del plano (las sillas alrededor de una mesa
   * redonda miran a su centro). Antes eran dos placas macizas bajo el
   * asiento (se leía como un bloque).
   */
  private chair(mat: Material, u: number, v: number, face: Item['face'] | readonly [number, number], scale = 1): void {
    const s = scale;
    const FY = this.fy;
    // Adelante (hacia donde mira quien se sienta) y costado, en el plano.
    const [fu, fv] = typeof face === 'string' ? faceDir(face) : face;
    const su = -fv;
    const sv = fu;
    const rot = this.yaw(su, sv);
    // Caja con el ancho sobre el costado y la profundidad hacia adelante.
    const part = (m: Material, ahead: number, side: number, w: number, h: number, d: number, y: number) => {
      const p = toWorld(this.f, u + fu * ahead + su * side, v + fv * ahead + sv * side);
      this.farm.addBoxOnGround(m, p.x, p.z, w, h, d, y, rot);
    };
    // Asiento a `FURNITURE.seat` (la gente se sienta a esa altura).
    const legs = (FURNITURE.seat - 0.04) * s;
    part(mat, 0, 0, 0.42 * s, 0.04 * s, 0.42 * s, FY + legs);
    if (!this.detailed) {
      part(mat, -0.2 * s, 0, 0.42 * s, 0.36 * s, 0.025, FY + legs + 0.06 * s);
      // Un solo pie central bajo el asiento.
      part(this.m.metalDark, 0, 0, 0.3 * s, legs, 0.3 * s, FY);
      return;
    }
    // Respaldo curvo separado del asiento (como el de las sillas reales).
    part(mat, -0.2 * s, 0, 0.42 * s, 0.22 * s, 0.025, FY + legs + 0.18 * s);
    const leg = 0.022;
    const k = 0.18 * s;
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) part(this.m.metalDark, a * k, b * k, leg, legs, leg, FY);
    }
    // Parantes del respaldo: del asiento al borde superior.
    for (const t of [-1, 1]) part(this.m.metalDark, -0.2 * s * 0.92, t * k, leg, 0.38 * s, leg, FY + legs + 0.02 * s);
  }

  /** Tubos fluorescentes en todos los ambientes cubiertos. */
  private lights(): void {
    for (const r of ROOMS) {
      if (!r.roofed || r.id === 'gimnasio' || r.id === 'escalera' || r.id === 'nicho') continue;
      const kind = STYLES[r.id]?.lights ?? 'tube';
      if (kind === 'none') continue;
      const ceil = LEVEL_Y[roomLevel(r)] + (CEILING_H[r.id] ?? (STYLES[r.id]?.ceiling === null ? 2.9 : 3.1));
      const y = ceil - 0.05;
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      for (const [u, v] of r.poly) {
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
      }
      const step = 2.9;
      const own: Fixture[] | null = SWITCHABLE_ROOMS.has(r.id) && kind !== 'dome' ? [] : null;
      if (own) this.switchable.set(r.id, own);
      // Luminaria: en las aulas con interruptor, marco acá y luz en el juego.
      const lamp = (u: number, v: number, w: number, h: number, d: number, yb: number) => {
        if (!own) {
          this.box(this.m.light, u, v, w, h, d, yb);
          return;
        }
        this.box(this.m.board, u, v, w + 0.04, h - 0.01, d + 0.04, yb + 0.01);
        const p = toWorld(this.f, u, v);
        own.push({ x: p.x, y: yb + h / 2, z: p.z, sx: w, sy: h, sz: d });
      };
      const nu = Math.max(1, Math.round((u1 - u0) / step));
      const nv = Math.max(1, Math.round((v1 - v0) / step));
      const long = u1 - u0 >= v1 - v0;
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const u = u0 + ((i + 0.5) * (u1 - u0)) / nu;
          const v = v0 + ((j + 0.5) * (v1 - v0)) / nv;
          if (!inPoly(r.poly, u, v)) continue;
          if (kind === 'panel') {
            // Panel LED de 60 × 60 embutido en el cielorraso de placas.
            lamp(u, v, 0.6, 0.03, 0.6, y + 0.02);
          } else if (kind === 'dome') {
            // Campana blanca colgada de un cable, como las del hall.
            this.box(this.m.metalDark, u, v, 0.012, 0.6, 0.012, ceil - 0.6);
            this.cyl(this.m.board, u, v, 0.34, 0.16, ceil - 0.76);
            this.cyl(this.m.light, u, v, 0.26, 0.02, ceil - 0.775);
          } else {
            lamp(u, v, long ? 1.2 : 0.16, 0.05, long ? 0.16 : 1.2, y);
          }
        }
      }
    }
  }

  // ================================================================ fachada

  /**
   * Portal del acceso sobre Laprida: volumen gris grafito con tres ventanas,
   * franjas rojo-blanco-azul, marquesina roja con el nombre, pilares de piedra
   * y columnas azules junto a las puertas rojas (la tipografía y el escudo los
   * dibuja SchoolIdentity).
   */
  private portal(): void {
    const m = this.m;
    const u0 = 33.55;
    const u1 = 41.3;
    const uc = (u0 + u1) / 2;
    const w = u1 - u0;
    // El portal sobresale ~0,85 m de la fachada y sube a ~8,2 m (0:09–0:16).
    // Arriba es un marco gris grafito que deja ver las tres ventanas enrejadas
    // del primer piso (la Secretaría y 6° BD), con su retiro hasta el muro.
    const front = 0.85;
    const depth = 0.2;
    const vf = front - depth / 2;
    const y0 = 4.0;
    const top = 8.2;
    const wins: Array<[number, number]> = [
      [34.6, 36.0],
      [36.8, 38.2],
      [39.1, 40.5],
    ];
    const wy0 = H + 1.45;
    const wy1 = H + 2.85;
    // Paño frontal, cortado alrededor de las ventanas.
    this.box(m.portal, uc, vf, w, top - wy1, depth, wy1);
    this.box(m.portal, uc, vf, w, wy0 - y0, depth, y0);
    let prev = u0;
    for (const [a, b] of wins) {
      this.box(m.portal, (prev + a) / 2, vf, a - prev, wy1 - wy0, depth, wy0);
      prev = b;
    }
    this.box(m.portal, (prev + u1) / 2, vf, u1 - prev, wy1 - wy0, depth, wy0);
    // Laterales y retiros de las ventanas hasta la fachada.
    // Los laterales son del gris claro de las aulas (0:12, Street View).
    for (const u of [u0 + 0.1, u1 - 0.1]) this.box(m.facade, u, front / 2, 0.2, top - y0, front, y0);
    for (const [a, b] of wins) {
      this.box(m.portal, (a + b) / 2, front / 2, b - a, 0.08, front - depth, wy0 - 0.08);
      this.box(m.portal, (a + b) / 2, front / 2, b - a, 0.08, front - depth, wy1);
      for (const u of [a + 0.04, b - 0.04]) this.box(m.portal, u, front / 2, 0.08, wy1 - wy0, front - depth, wy0);
      // Reja negra en el plano del frente y un marco saliente gris.
      for (let k = 1; k < 6; k++) this.box(m.bars, a + ((b - a) * k) / 6, front + 0.03, 0.025, wy1 - wy0, 0.025, wy0);
      for (const y of [wy0 + 0.4, wy1 - 0.4]) this.box(m.bars, (a + b) / 2, front + 0.03, b - a, 0.03, 0.025, y);
      this.box(m.portal, (a + b) / 2, front + 0.03, b - a + 0.3, 0.15, 0.06, wy1);
      this.box(m.portal, (a + b) / 2, front + 0.03, b - a + 0.3, 0.15, 0.06, wy0 - 0.15);
    }
    // Losa inferior del volumen saliente y franjas rojo-blanco-azul arriba.
    this.box(m.portal, uc, front / 2, w, 0.12, front, y0 - 0.12);
    for (const [y, mat] of [
      [7.25, m.red],
      [7.42, m.slab],
      [7.59, m.navy],
    ] as const) {
      this.box(mat, uc, front + 0.02, w, 0.14, 0.04, y);
    }
    // Marquesina roja con filetes (2,45–3,85 m); el texto va en el atlas.
    this.box(m.red, 37.425, front - 0.15, 8.25, 1.4, 0.3, 2.45);
    // Banda roja del primer piso del edificio de bloque, al este del portal (0:15).
    this.box(m.red, 46.125, 0.17, 8.35, 0.6, 0.04, 3.05);
    // Planta baja: dos pilares revestidos en granito y tres columnas azul
    // marino, con la reja de malla cuadrada de toda la altura (2020) y su
    // portón abierto frente a las puertas.
    const g0 = 32.95;
    const g1 = 41.9;
    for (const pu of [g0 + 0.4, g1 - 0.4]) this.box(m.stone, pu, front / 2, 0.8, 2.45, front, 0);
    for (const u of [33.7, 37.5, 41.0]) this.box(m.navy, u, front - 0.2, 0.3, 2.45, 0.3, 0.12);
    for (let u = g0 + 0.85; u < g1 - 0.8; u += 0.15) {
      if (u > 35.6 && u < 39.3) continue;
      this.box(m.bars, u, front - 0.05, 0.02, 2.3, 0.02, 0.12);
    }
    for (const y of [0.2, 1.3, 2.38]) {
      this.box(m.bars, (g0 + 0.85 + 35.6) / 2, front - 0.05, 35.6 - g0 - 0.85, 0.03, 0.02, y);
      this.box(m.bars, (39.3 + g1 - 0.8) / 2, front - 0.05, g1 - 0.8 - 39.3, 0.03, 0.02, y);
    }
    // Escalinata de tres huellas hasta el nivel del vestíbulo.
    for (const [v0, v1, h] of [
      [1.4, 2.0, 0.08],
      [0.8, 1.4, 0.1],
      [0, 0.8, FY],
    ] as const) {
      this.box(m.slab, (33.4 + 40.85) / 2, (v0 + v1) / 2, 40.85 - 33.4, h, v1 - v0, 0);
    }
    // Mástil inclinado con la bandera, a la izquierda del portal.
    const p = toWorld(this.f, 33.35, 1.1);
    this.farm.add('box', m.metal, new Vector3(p.x, 5.35, p.z + 0.35), new Vector3(0.06, 0.06, 1.9), 0, -0.6);
  }

  /**
   * Fachada del jardín sobre la calle de atrás (10:38–10:41): banda vertical
   * azul marino con "CIMDIP" hasta el pretil gris, marquesina roja de
   * "Educación Inicial" sobre las puertas y un pilar rojo entre ventanas.
   */
  private jardinFacade(): void {
    const m = this.m;
    const v = V.top - 0.21;
    // Banda azul marino con CIMDIP en el extremo oeste (a la derecha de quien
    // mira desde la calle), marquesina roja saliente con su cielorraso gris,
    // pilar rojo entre las ventanas del primer piso, antepecho rojo del
    // segundo, pretil gris y columna de borde gris al este.
    this.box(m.navy, 58.525, v, 1.75, 8.9, 0.1, 0);
    this.box(m.red, 63.3, V.top - 0.55, 8.2, 0.9, 0.8, 2.75);
    this.box(m.slab, 63.3, V.top - 0.55, 8.2, 0.04, 0.8, 2.71);
    this.box(m.red, 62.3, v + 0.15, 0.4, 1.3, 0.08, H + 0.95);
    this.box(m.jardinRed, 63.2, V.top - 0.2, 7.6, 1.9, 0.1, 5.6);
    this.box(m.facade, 62.525, V.top - 0.18, 9.75, 1.0, 0.06, 8.9);
    this.box(m.facade, 67.2, v, 0.4, 9.9, 0.12, 0);
  }

  /**
   * Franja de frente: cerco negro sobre muro rojo, canteros azul y rojo del
   * lado de la vereda, las dos palmeras y el remate de sierra.
   */
  private frontage(): void {
    const m = this.m;
    for (const r of FRONT_PLANTERS) {
      const uc = (r.u0 + r.u1) / 2;
      const vc = (r.v0 + r.v1) / 2;
      // Canteros alternados azul marino y rojo (0:04–0:08).
      const n = Math.max(1, Math.round((r.u1 - r.u0) / 3.2));
      for (let k = 0; k < n; k++) {
        const a = r.u0 + ((r.u1 - r.u0) * k) / n;
        const b = r.u0 + ((r.u1 - r.u0) * (k + 1)) / n;
        this.box(k % 2 === 0 ? m.navy : m.red, (a + b) / 2, vc, b - a - 0.04, 0.5, r.v1 - r.v0, 0.06);
      }
      this.box(m.soil, uc, vc, r.u1 - r.u0 - 0.2, 0.03, r.v1 - r.v0 - 0.2, 0.55);
      if (r.u0 > 42 && r.u0 < 43) {
        // Cantero del edificio de bloque: matas de pasto ornamental seco, no
        // arbustos (0:09–0:16). Hojas finas abiertas en abanico.
        for (const u of [43.2, 44.6, 46.0, 47.4, 48.8]) {
          const p = toWorld(this.f, u, vc);
          const n = this.detailed ? 8 : 5;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
            const tilt = this.rng.range(0.12, 0.36);
            const len = this.rng.range(1.0, 1.35);
            this.farm.add(
              'box',
              m.tuft,
              new Vector3(p.x + Math.sin(a) * Math.sin(tilt) * len * 0.5, 0.57 + Math.cos(tilt) * len * 0.5, p.z + Math.cos(a) * Math.sin(tilt) * len * 0.5),
              new Vector3(0.035, len, 0.035),
              a,
              tilt,
            );
          }
        }
        continue;
      }
      for (let u = r.u0 + 1.2; u < r.u1 - 0.6; u += 1.6) {
        const pt = toWorld(this.f, u, vc);
        this.nature.shrub(pt.x, pt.z, this.rng.range(0.45, 0.75), 0.57);
      }
    }
    // Palmeras: esquina de Miguel Cané, las dos de la vereda de las aulas
    // (0:04) y la del frente del edificio de bloque.
    for (const [u, v, h] of [
      [-2.6, 0.6, 7.5],
      [7.5, 2.6, 6.2],
      [17.0, 2.6, 6.0],
    ] as const) {
      this.palm(u, v, h);
    }
    // Árbol de hoja ancha frente al edificio de bloque (0:12).
    const tree = toWorld(this.f, 47.0, 3.0);
    this.nature.broadleaf(tree.x, tree.z, 0.8, 0.06);
    // Cartel de salida de emergencia sobre el ochavo.
    this.box(m.exitSign, 0.2, -8.2, 0.05, 0.22, 0.45, 2.45);
    // Poste de los carteles de calle (Laprida y Miguel Cané) y del punto de
    // encuentro; las chapas las pinta SchoolIdentity.
    this.cyl(m.metalDark, -6.3, 3.3, 0.07, 3.35, 0);
    this.cyl(m.metalDark, MEETING_POINT[0], MEETING_POINT[1] - 0.02, 0.06, 2.35, 0);

    // Remate de sierra: las puntas de las chapas onduladas del techo asoman
    // sobre los muros (0:04, 2:01–2:07). Sobre Laprida sube 0,75 m en u ≈ 11,1.
    const tooth = (u: number, v: number, y: number, alongU: boolean) => {
      const p = toWorld(this.f, u, v);
      const size = new Vector3(alongU ? 0.4 : 0.1, 0.4, alongU ? 0.1 : 0.4);
      this.farm.add('box', m.slab, new Vector3(p.x, y, p.z), size, 0, alongU ? 0 : Math.PI / 4, alongU ? Math.PI / 4 : 0);
    };
    for (const [a, b, y] of [
      [U.w + 0.3, CREST.step, H + CREST.west],
      [CREST.step, U.east1 - 0.2, H + CREST.east],
    ] as const) {
      for (let u = a; u <= b; u += 0.86) tooth(u, 0.05, y, true);
    }
    // Hacia el patio oeste: pasillo de lockers, sector nuevo y galería.
    const parapet = 2 * H + 0.55;
    for (let u = U1.wing + 0.3; u < U1.gallery; u += 0.86) tooth(u, V.corrS - 0.05, parapet, true);
    for (let u = U.patioW + 0.3; u < U.bufW; u += 0.86) tooth(u, V.corrN + 0.05, parapet, true);
    for (let v = V.corrS - 0.3; v > V.corrN; v -= 0.86) tooth(U1.wing + 0.05, v, parapet, false);
  }

  private palm(u: number, v: number, h: number, base = 0): void {
    const trunk = this.mats.surface(PALETTE.barkLight, 0.95, 0, 'timber');
    this.cyl(trunk, u, v, 0.34, h * 0.55, base);
    this.cyl(trunk, u, v, 0.26, h * 0.45, base + h * 0.55);
    const frond = this.mats.foliage(PALETTE.leafMid);
    const p = toWorld(this.f, u, v);
    // Una palmera joven tiene hojas más cortas: con las de una adulta, la del
    // patio este metía las frondas dentro del salón.
    const scale = Math.min(1, h / 6);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + this.rng.range(-0.15, 0.15);
      const len = this.rng.range(2.8, 3.3) * scale;
      const droop = this.rng.range(0.6, 0.9);
      const cx = p.x + Math.sin(a) * len * 0.45;
      const cz = p.z + Math.cos(a) * len * 0.45;
      // Hoja: caja chata girada hacia afuera y caída en la punta.
      this.farm.add('box', frond, new Vector3(cx, base + h - 0.25, cz), new Vector3(0.35, 0.05, len), a, droop);
    }
  }

  private fences(): void {
    const m = this.m;
    for (const [a, b] of FENCES) {
      // Muro bajo rojo bajo el cerco negro (0:04–0:08).
      this.piece(m.red, a, b, 0.3, 0, 0.45);
      this.piece(m.bars, a, b, 0.06, 1.95, 2.02);
      this.piece(m.bars, a, b, 0.05, 0.95, 1.0);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const du = (b[0] - a[0]) / len;
      const dv = (b[1] - a[1]) / len;
      const n = Math.floor(len / 0.16);
      for (let k = 0; k <= n; k++) {
        const d = (k * len) / n;
        const p: P = [a[0] + du * d, a[1] + dv * d];
        const q: P = [p[0] + du * 0.025, p[1] + dv * 0.025];
        this.piece(m.bars, p, q, 0.025, 0.45, 2.02);
      }
    }
  }

  /** Postes y cableado aéreo sobre la vereda de Laprida, como en las fotos. */
  private utilityLines(): void {
    const m = this.m;
    const poleV = SCHOOL.front + 3.2;
    // Postes de hormigón con su cruceta (Street View).
    const poles = [-4, 12.1, 20, 44, 66];
    for (const u of poles) {
      this.cyl(m.slab, u, poleV, 0.22, 9.6, 0);
      this.box(m.slab, u, poleV, 1.4, 0.1, 0.1, 8.5);
    }
    for (let i = 0; i < poles.length - 1; i++) {
      const u0 = poles[i];
      const u1 = poles[i + 1];
      for (const [y, off] of [
        [8.9, 0],
        [8.45, 0.4],
        [8.45, -0.4],
      ] as const) {
        const segs = 8;
        for (let k = 0; k < segs; k++) {
          const t = (k + 0.5) / segs;
          const sag = 0.35 * (1 - Math.pow(2 * t - 1, 2));
          this.box(m.bars, u0 + (u1 - u0) * t + off, poleV, (u1 - u0) / segs + 0.03, 0.025, 0.025, y - sag);
        }
      }
    }
  }
}
