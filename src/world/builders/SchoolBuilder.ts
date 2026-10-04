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
  chairScaleOf,
  deskTopOf,
  ceilingHeight,
  LANDINGS,
  LEVEL_Y,
  MEETING_POINT,
  FRONT_PLANTERS,
  ITEMS,
  MC_COS,
  MC_SLOPE,
  PORTAL,
  PORTAL_COLUMNS,
  PORTAL_PILLARS,
  PORTAL_RAILS,
  PORTAL_RAIL_V,
  PORTAL_WINDOWS,
  ROOFS,
  ROOMS,
  SCHOOL,
  STAIRS,
  SALON_COLUMNS,
  makerWallAt,
  riserCount,
  roundChairAngles,
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
  SC,
  U1,
  V1,
  fromPlan,
  planU,
  planV,
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
/**
 * Lado de una reja pedida a mano en un muro interior: hacia el ambiente sin
 * techo (patio) o, entre dos locales, hacia el pasillo; 0 si no hay cómo saberlo.
 */
function grilleSide(rp: Room | null, rn: Room | null): number {
  const open = (r: Room | null) => !!r && !r.roofed;
  const hall = (r: Room | null) => !!r && r.name === 'Pasillo';
  if (open(rp) !== open(rn)) return open(rp) ? 1 : -1;
  if (hall(rp) !== hall(rn)) return hall(rp) ? 1 : -1;
  return 0;
}

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
  /** Cenefa (por defecto, la misma tela). */
  valance?: string;
  /** Cortinas corridas sobre el vidrio (como las de Laprida), no recogidas a los costados. */
  drawn?: boolean;
}

const STYLES: Readonly<Record<string, RoomStyle>> = {
  // Aulas de primaria: zócalo de madera hasta la altura del pupitre.
  // Aulas: zócalo de madera de 1,05 m (al ras del antepecho). Las del frente
  // (las que se ven sin chicos) tienen la pared en un celeste agua muy claro
  // (el aula 5; la 4 es blanca).
  aula1: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula2: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  aula3: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet' },
  // Aula 4: pared blanca y cortinas celestes (0:55).
  aula4: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'sky' },
  aula5: { wall: 'aqua', wainscot: ['woodIn', 1.05], stripe: false, curtain: 'sky' },
  aula6: { wainscot: ['woodIn', 1.05], stripe: false },
  dirPrim: { wainscot: ['woodIn', 1.0], stripe: false },
  prof: { stripe: false },
  recepcionOf: { stripe: false },
  // Administración y su hall: revoque gris texturado hasta 2,4 m, bloque de
  // hormigón a la vista arriba, cielorraso de placas.
  adm: { wall: 'block', wainscot: ['render', 2.4], stripe: false, ceiling: 'panels', lights: 'panel' },
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
  // Video de 2026: el pasillo del jardín, Arte y Teatro van blancos y lisos,
  // sin guarda roja, con cielorraso de placas; V. Damas es un vestuario con
  // azulejos blancos hasta el techo.
  hallJardin: { stripe: false, ceiling: 'panels', lights: 'panel' },
  arte: { stripe: false, ceiling: 'panels' },
  teatro: { stripe: false },
  vDamas: { wall: 'ceramic', stripe: false },
  torreHall: { stripe: false, lights: 'none' },
  // Ambientes del bloque norte que el CAD agrega (sin recorrido): el aula
  // como las de primaria, el depósito y el local del fondo, blancos.
  aulaNorte: { wainscot: ['woodIn', 1.05], stripe: false },
  depositoNucleo: { stripe: false },
  localFinNorte: { stripe: true },

  // ---------------------------------------------------- plantas altas
  // Pasillo de lockers y sector nuevo: cerámico beige, cielorraso de placas
  // y la guarda roja de toda la escuela (5:12–6:56).
  pasilloL1: { ceiling: 'panels', lights: 'panel' },
  pasilloNorteL1: { ceiling: 'panels', lights: 'panel' },
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
  // Voile lila con cenefa roja (4:48–4:54).
  aula6BD: { stripe: true, curtain: 'lilac', valance: 'curtainRed' },
  aula6AC: { stripe: true, curtain: 'lilac', valance: 'curtainRed' },
  aulaC1: { stripe: false, curtain: 'curtainWhite', ceiling: 'panels' },
  aulaC2: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet', ceiling: 'panels' },
  biblioteca: { stripe: true, ceiling: 'panels', lights: 'panel' },
  bilingue: { stripe: false, curtain: 'curtainWhite', ceiling: 'panels' },
  galeria: { stripe: true, lights: 'panel' },
  pasarela: { wall: 'white', wainscot: ['black', 0.9], stripe: false, lights: 'tube' },
  // Cortinas blancas corridas bajo una cenefa bordó (7:27–7:29).
  dirSec: { wall: 'cream', stripe: false, curtain: 'curtainWhite', valance: 'curtainRed', ceiling: 'panels', drawn: true },
  precepSec: { wall: 'cream', stripe: true, ceiling: 'panels', lights: 'panel' },
  aulaSec: { stripe: false, ceiling: 'panels' },
  escaleraOeste: { stripe: false, lights: 'none' },
  // Edificio de bloque: bloque de hormigón a la vista, cerámico blanco y
  // cubierta de chapa blanca sobre perfiles negros (8:08–8:42).
  pasilloBloque: { wall: 'block', stripe: false, ceiling: 'panels' },
  aulaBloqueD: { wall: 'block', stripe: false, curtain: 'violet' },
  aulaBloqueC: { wall: 'block', stripe: false },
  aulaBloqueA: { stripe: false, curtain: 'violet' },
  // Ambientes del primer piso que agregan el CAD y el plano a mano: con las
  // terminaciones de sus vecinos (ningún material nuevo).
  gerencia: { wall: 'cream', stripe: false, curtain: 'curtainWhite', valance: 'curtainRed', ceiling: 'panels' },
  aula6C: { stripe: true, curtain: 'violet', ceiling: 'panels' },
  aula4A: { wainscot: ['woodIn', 1.05], stripe: false, curtain: 'violet', ceiling: 'panels' },
  aulaVertice: { stripe: false, curtain: 'curtainWhite', ceiling: 'panels' },
  aulaN2: { stripe: true, curtain: 'curtainWhite', ceiling: 'panels' },
  aulaNE: { stripe: false, curtain: 'curtainWhite', ceiling: 'panels' },
  prBil: { wall: 'cream', stripe: false, ceiling: 'panels', lights: 'panel' },
  aulaTaller: { stripe: false, curtain: 'violet' },
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

/** Ambientes de un piso alto sobre un patio de planta baja: llevan losa vista por debajo. */
const SOFFIT_ROOMS: ReadonlySet<string> = new Set(['aulaNE']);

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
      // Losetas de cemento de 40 cm del patio aire libre (video 2026): gris
      // beige, granulado fino y juntas finas poco marcadas.
      patioTile: s('#d8d3c8', 0.88, 0, 'granite', 'floor'),
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
      // Cerámico beige rosado del pasillo de lockers (5:12–6:56).
      ceramicBeige: i('#cfc4bf', 'ceramic', undefined, undefined, 'floor'),
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
      // Bloque del frente de Arte al patio (video 2026, 1:04): más claro y
      // más cálido que el del polideportivo.
      blockLight: i('#b9b6ae', 'block', 0.16, undefined, 'wall'),
      // Cortinas: celestes en las aulas del frente, violetas en las demás.
      // Tela con pliegues (relieve y sombra propia), mate.
      sky: s('#2fa8d8', 0.95, 0, 'fabric'),
      violet: s('#3d3a6e', 0.95, 0, 'fabric'),
      // Voile lila de 6° BD y 6° AC (4:48): más claro, la luz pasa a través.
      lilac: s('#8e6bbf', 0.9, 0, 'fabric'),
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
      // Video 2026: gris claro pulido, no beige.
      gymFloor: i('#c6c5bf', 'pavement', 0.52, 0.45, 'floor'),
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
      // Chapa semillada negra de las huellas de la escalera del edificio de
      // bloque (8:37-8:41): lágrimas en relieve, también en VR (LITE_RELIEF).
      metalTread: s('#2c2f35', 0.5, 0.2, 'treadPlate', 'floor'),
      // Aluminio de marcos y pizarras: cepillado fino a su escala real.
      metal: mats.surface(PALETTE.solarFrame, 0.4, 0.25, 'metal', { metric: true }),
      // Madera barnizada de pupitres, bancos y estantes.
      timber: s('#c99a62', 0.55, 0, 'timber'),
      timberDark: s('#7b5236', 0.55, 0, 'timber'),
      chairGreen: s('#2f7a5c', 0.6, 0, 'plaster'),
      // Verde oscuro de la columna acolchada del hall y de los contenedores
      // del patio (video 2026): con el verde de las sillas se leía menta.
      darkGreen: s('#1d5a34', 0.6, 0, 'plaster'),
      plasticCream: s('#e3d8bd', 0.45, 0, 'plaster'),
      // Pizarra blanca, hojas y mesadas: melamina o esmalte, con brillo.
      board: i('#f6f7f6', null, 0.35, 0.4),
      // Cortinas blancas (aulas del sector nuevo, salas del jardín): tela, no
      // la melamina de la pizarra con la que compartían material.
      curtainWhite: s('#ecebe6', 0.95, 0, 'fabric'),
      // Cortinas azules (aulas sin estilo propio) y rojas (telón del SUM,
      // cenefas): también tela plisada. Como alias del plástico azul y del
      // esmalte rojo eran tablas lisas de canto vivo. Cada una es un draw call
      // más, sólo con esas cortinas en cuadro.
      curtainBlue: s('#1d4fb0', 0.95, 0, 'fabric'),
      curtainRed: s('#b3292a', 0.95, 0, 'fabric'),
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

  /**
   * Cilindro vertical. `hi`: de 10 lados, para lo redondo que se ve de cerca
   * (mesas redondas, matafuegos, piletas, columnas, tambores); los postes,
   * mástiles, troncos y las luminarias del cielorraso siguen de 6. Todos los
   * cilindros de un mismo material van, en lo posible, del mismo lado (los
   * dos juntos serían un draw call más).
   */
  private cyl(mat: Material, u: number, v: number, dia: number, h: number, y = 0, hi = false): void {
    const p = toWorld(this.f, u, v);
    this.farm.add(hi ? 'cylinderHi' : 'cylinder', mat, new Vector3(p.x, y + h / 2, p.z), new Vector3(dia, h, dia));
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
    // Borde oeste del predio en u (u = ox − x: el oeste, +x, es site.x1).
    // Antes era `site.x0 − ox`, con el signo cambiado: el césped llegaba por
    // debajo de la calle oeste y de la manzana cívica.
    const west = f.ox - f.site.x1;
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
      // Hasta el testero de la salida del pasillo sur (el rincón del ochavo).
      [
        [miguelCaneU(0), 0],
        [U.w, 0],
        [U.w, V.classTop],
        [U.jog, V.classTop],
        [U.jog, V.jogN],
      ],
      0,
      0.06,
      { bottom: false },
    );
    // Fondos de los vecinos detrás de la medianera: pasto y algún árbol.
    this.prisms.plan(this.m.lawn, [APEX, [miguelCaneU(top), top], [U.teaE, top], [U.teaE, rearV(U.teaE)]], 0, 0.05, {
      bottom: false,
    });
    // Donde no hay aulas del primer piso contra la medianera: detrás de las
    // del Aula Maker y del patio este las copas entraban en ellas.
    for (const [u, v] of [
      fromPlan(43.5, -37.8),
      fromPlan(54.5, -37.0),
      fromPlan(49, -34.4),
    ]) {
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
      ceramicBeige: this.m.ceramicBeige,
      rubber: this.m.rubber,
      terracotta: this.m.terracotta,
      hallStone: this.m.hallStone,
      dance: this.m.dance,
      patioTile: this.m.patioTile,
    };
    for (const r of ROOMS) {
      const level = roomLevel(r);
      const top = LEVEL_Y[level];
      // Planta baja: contrapiso desde el terreno. Pisos altos: losa de 14 cm
      // (la cara inferior la tapa el cielorraso del ambiente de abajo), sin
      // los huecos de escalera de ese nivel.
      if (level === 0) {
        this.prisms.plan(mat[r.floorLook ?? r.floor], r.poly, 0, top, { bottom: false });
        continue;
      }
      // Con cara inferior: bajo la galería en voladizo y bajo la pasarela se ve
      // la losa desde el patio (oscura, como en el video).
      for (const piece of subtractRects(r.poly, voidsAt(level))) {
        this.prisms.plan(mat[r.floorLook ?? r.floor], piece, top - 0.14, top);
        // Bajo un aula sobre el patio se ve un cielorraso de losa, no la cara
        // inferior del piso (el cerámico del aula parecía un techo de baldosas).
        if (SOFFIT_ROOMS.has(r.id)) this.prisms.plan(this.m.slab, piece, top - 0.15, top - 0.15, { top: false, sides: false });
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
    // Terminación: el pozo de una escalera (hueco sin ambiente propio en ese
    // nivel) sigue con la del ambiente del que sube. Sin esto, en el pozo del
    // jardín el muro pasaba del amarillo al gris de fachada en el primer piso.
    const finishRoom = (u: number, v: number): Room | null => {
      for (let lv = w.level; ; lv--) {
        const r = roomAt(u, v, lv as Level);
        if (r || lv === 0) return r;
        if (!voidsAt(lv as Level).some((h) => u > h.u0 && u < h.u1 && v > h.v0 && v < h.v1)) return null;
      }
    };
    const finishRoomsAt = (d: number): [Room | null, Room | null] => {
      const [pu, pv] = at(d);
      return [finishRoom(pu + nu * 0.45, pv + nv * 0.45), finishRoom(pu - nu * 0.45, pv - nv * 0.45)];
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
      const [rp, rn] = finishRoomsAt((t0 + t1) / 2);
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
    // Puntas del muro donde no sigue otro muro alineado: ahí la guarda se
    // retira 3 mm (su canto quedaba en el plano del canto del muro). Donde sí
    // sigue, no: dejaría una ranura blanca de 6 mm en la junta.
    const continues = (p: P): boolean =>
      WALLS.some((o) => {
        if (o === w || o.level !== w.level) return false;
        const end = Math.hypot(o.a[0] - p[0], o.a[1] - p[1]) < 0.01 || Math.hypot(o.b[0] - p[0], o.b[1] - p[1]) < 0.01;
        if (!end) return false;
        const ol = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
        return Math.abs(((o.b[0] - o.a[0]) / ol) * dv - ((o.b[1] - o.a[1]) / ol) * du) < 0.01;
      });
    const pullA = continues(w.a) ? 0 : 0.003;
    const pullB = continues(w.b) ? 0 : 0.003;
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
        // plano que el canto del muro y titilaba. Entre dos ventanas de una
        // tira (la galería roja) no se dibuja: quedaban cuadraditos rojos
        // sueltos sobre los parantes de 8 cm.
        const pier = s.t1 - s.t0 < 0.3 && k > 0 && k < spans.length - 1 && stripeCut[k - 1] && stripeCut[k + 1];
        if (L.side.stripe && !stripeCut[k] && !pier) {
          const t0 = s.t0 + (k > 0 && stripeCut[k - 1] ? 0.003 : k === 0 ? pullA : 0);
          const t1 = s.t1 - (k < spans.length - 1 && stripeCut[k + 1] ? 0.003 : k === spans.length - 1 ? pullB : 0);
          // Bajo un antepecho que arranca justo a 1,24 m, la guarda baja 4 mm:
          // su cara de arriba coincidía con la del alféizar.
          const flush = s.holes.some(([hb]) => hb >= STRIPE[1] - 1e-6 && hb < STRIPE[1] + 0.005);
          this.piece(this.m.stripe, at(t0), at(t1), L.t + 0.02, yb + STRIPE[0], yb + STRIPE[1] - (flush ? 0.004 : 0), L.off);
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
      if (fm === m.red && o.grille === 'none') {
        // Ventanilla de vanos rojos (hall del jardín): el revoque del vano,
        // de cara a cara del muro, pintado de rojo.
        this.piece(m.red, a, b, t + 0.01, hb - 0.01, hb + 0.005);
        this.piece(m.red, a, b, t + 0.01, ht - 0.005, ht + 0.01);
        this.piece(m.red, along(-0.01), along(0.005), t + 0.01, hb, ht);
        this.piece(m.red, along(len - 0.005), along(len + 0.01), t + 0.01, hb, ht);
      }
      const grille = o.grille ?? (w.level > 0 ? 'whiteBars' : 'bars');
      // Reja pedida a mano en un muro interior: del lado del patio (sin
      // techo) o, entre dos locales, del lado del pasillo.
      const gs = extSign !== 0 || o.grille === undefined ? extSign : grilleSide(roomPos, roomNeg);
      if (gs !== 0 && type === 'window' && grille !== 'none') {
        const extSign = gs;
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
          // Barrotes horizontales gruesos de hierro oscuro, unos cinco por
          // paño (galería roja, 2:08): no las lamas blancas finas de antes.
          for (let y = hb + 0.1; y < ht - 0.05; y += 0.2) this.piece(m.metalDark, a, b, 0.04, y, y + 0.05, extSign * (t / 2 + 0.05));
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
        const vk = STYLES[inner.id]?.valance;
        const vm = vk ? m[vk] : cm;
        // Sobre Laprida las cortinas están casi cerradas: desde la calle cada
        // ventana se lee como un rectángulo violeta oscuro (0:04–0:08).
        // La Dirección de secundaria también las tiene corridas (7:27–7:30).
        const onLaprida = (Math.abs(w.a[1]) < 0.01 && Math.abs(w.b[1]) < 0.01 && w.level <= 1) || STYLES[inner.id]?.drawn === true;
        if (onLaprida) {
          // Con cenefa propia (6° BD) se ve igual desde adentro: barral y cenefa.
          if (vk && this.detailed) {
            this.piece(m.metalDark, along(-0.3), along(len + 0.3), 0.03, ht + 0.28, ht + 0.31, off);
            this.piece(vm, along(-0.2), along(len + 0.2), 0.05, ht + 0.02, ht + 0.28, off);
          }
          this.piece(cm, along(-0.3), along(len * 0.42), 0.06, hb - 0.05, ht + 0.02, off);
          this.piece(cm, along(len * 0.58), along(len + 0.3), 0.06, hb - 0.05, ht + 0.02, off);
          return;
        }
        // Barral negro, cenefa y paños a los costados.
        if (this.detailed) {
          this.piece(m.metalDark, along(-0.3), along(len + 0.3), 0.03, ht + 0.28, ht + 0.31, off);
          this.piece(vm, along(-0.2), along(len + 0.2), 0.05, ht + 0.02, ht + 0.28, off);
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
    const frameMat = type === 'exit' ? m.metalDark : own === m.frame || own === m.timberDark || own === m.metalDark ? own : m.red;
    this.piece(frameMat, a, along(0.07), t + 0.05, yb, ht);
    this.piece(frameMat, along(len - 0.07), b, t + 0.05, yb, ht);
    this.piece(frameMat, a, b, t + 0.05, ht, ht + 0.08);

    // Las de aulas y oficinas las dibuja y mueve el juego (`game/world/Doors`).
    if (isInteractiveDoor(w.level, a, b)) return;

    // Las hojas abren hacia el ambiente (no hacia el pasillo, la galería o un
    // hall de distribución); las de emergencia, hacia la calle. Con sólo
    // 'Pasillo', las salas del jardín abrían sobre su galería de 1,5 m.
    const isHall = (r: Room | null) => !r || !r.roofed || r.name === 'Pasillo' || r.name === 'Galería' || r.name === 'Hall';
    let s = !isHall(roomPos) ? 1 : !isHall(roomNeg) ? -1 : 1;
    if (type === 'exit' && extSign !== 0) s = extSign;
    const leafMat = own ?? (type === 'exit' ? m.frame : type === 'entrance' ? m.glass : m.leaf);
    const hinges = type === 'door' ? [0.08] : [0.08, len - 0.08];
    const leafW = type === 'door' ? len - 0.16 : (len - 0.16) / 2;
    for (const h of hinges) {
      const p = along(h);
      const q0: P = [p[0] + n[0] * s * (t / 2 + 0.02), p[1] + n[1] * s * (t / 2 + 0.02)];
      const q1: P = [q0[0] + n[0] * s * leafW, q0[1] + n[1] * s * leafW];
      if (own === m.glass && type !== 'entrance' && type !== 'exit') {
        // Hoja vidriada (puertas del jardín): bastidor rojo como el marco,
        // con zócalo, cabezal y montantes. Antes era una lámina de vidrio sin
        // marco de 1,3 m flotando abierta en la recepción. También en VR.
        const qa: P = [q0[0] + (q1[0] - q0[0]) * 0.06, q0[1] + (q1[1] - q0[1]) * 0.06];
        const qb: P = [q1[0] - (q1[0] - q0[0]) * 0.06, q1[1] - (q1[1] - q0[1]) * 0.06];
        this.piece(m.red, q0, q1, 0.05, yb + 0.03, yb + 0.15);
        // El vidrio entra 2 cm en el bastidor: ningún canto suyo queda en el
        // plano de una cara del marco.
        const ga: P = [q0[0] + (q1[0] - q0[0]) * 0.04, q0[1] + (q1[1] - q0[1]) * 0.04];
        const gb: P = [q1[0] - (q1[0] - q0[0]) * 0.04, q1[1] - (q1[1] - q0[1]) * 0.04];
        this.piece(m.glass, ga, gb, 0.02, yb + 0.13, ht - 0.1);
        this.piece(m.red, q0, q1, 0.05, ht - 0.12, ht - 0.04);
        this.piece(m.red, q0, qa, 0.05, yb + 0.15, ht - 0.12);
        this.piece(m.red, qb, q1, 0.05, yb + 0.15, ht - 0.12);
      } else if (type === 'entrance' || type === 'exit' || !own || !this.detailed || o.grille === 'none') {
        // Sin vidrio (`'none'`): hoja maciza (las rojas del vestuario, la de chapa negra).
        this.piece(leafMat, q0, q1, 0.045, yb + 0.03, ht - 0.04);
        // Picaporte cerca del borde libre (de los dos lados de la hoja).
        if (this.detailed && type !== 'entrance' && type !== 'exit') {
          const k: P = [q1[0] - (q1[0] - q0[0]) * 0.08, q1[1] - (q1[1] - q0[1]) * 0.08];
          const k2: P = [q1[0] - (q1[0] - q0[0]) * 0.13, q1[1] - (q1[1] - q0[1]) * 0.13];
          this.piece(m.metal, k2, k, 0.12, yb + 0.98, yb + 1.02);
        }
      } else {
        // Hoja con vidrio: tablero abajo (hasta 0,9 m), vidrio arriba en su marco.
        // Con `whiteBars`: zócalo bajo y tres paños altos separados por
        // travesaños (la puerta doble de PVC del salón, video 2026).
        const panes = o.grille === 'whiteBars';
        const kick = panes ? 0.55 : 0.9;
        this.piece(leafMat, q0, q1, 0.045, yb + 0.03, yb + kick);
        this.piece(m.glass, q0, q1, 0.02, yb + kick, ht - 0.12);
        this.piece(leafMat, q0, q1, 0.05, ht - 0.12, ht - 0.04);
        const qa: P = [q0[0] + (q1[0] - q0[0]) * 0.06, q0[1] + (q1[1] - q0[1]) * 0.06];
        const qb: P = [q1[0] - (q1[0] - q0[0]) * 0.06, q1[1] - (q1[1] - q0[1]) * 0.06];
        this.piece(leafMat, q0, qa, 0.05, yb + kick, ht - 0.12);
        this.piece(leafMat, qb, q1, 0.05, yb + kick, ht - 0.12);
        if (panes) {
          const pane = (ht - 0.12 - yb - kick) / 3;
          for (const k of [1, 2]) this.piece(leafMat, q0, q1, 0.05, yb + kick + k * pane - 0.025, yb + kick + k * pane + 0.025);
        }
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
      this.ceilingSteps(r, y);
    }
    // Último piso de un volumen: donde el hueco de una escalera no es de
    // ningún ambiente (la torre del hall, el pozo del jardín) no había
    // cielorraso y se veía el cielo por debajo de la cubierta.
    for (const L of [1, 2] as const) {
      for (const h of voidsAt(L)) {
        const cu = (h.u0 + h.u1) / 2;
        const cv = (h.v0 + h.v1) / 2;
        if (roomAt(cu, cv, L)) continue;
        if (!UPPER.some((vol) => vol.floors === L && vol.roof !== false && inPoly(vol.poly, cu, cv))) continue;
        this.prisms.plan(this.m.ceiling, [[h.u0, h.v0], [h.u1, h.v0], [h.u1, h.v1], [h.u0, h.v1]], LEVEL_Y[L] + 3.1, LEVEL_Y[L] + 3.16, { top: false, sides: false });
      }
    }
    // Hall del segundo piso: la bóveda arranca recién en el muro de los
    // espejos; al oeste, bajo la azotea del remate, va un cielorraso común.
    this.prisms.plan(this.m.ceiling, [[U.salonW, V1.blockA], [U1.vaultW, V1.blockA], [U1.vaultW, V1.blockHall], [U.salonW, V1.blockHall]], LEVEL_Y[2] + 3.1, LEVEL_Y[2] + 3.16, {
      top: false,
      sides: false,
    });
  }

  /**
   * Cenefa donde el cielorraso de un ambiente limita, sin muro, con el de un
   * ambiente vecino más alto (la galería roja contra los pasillos): sin ella
   * queda una ranura entre los dos planos por la que se ve el cielo.
   */
  private ceilingSteps(r: Room, y: number): void {
    const level = roomLevel(r);
    const poly = r.poly;
    const inward = polygonArea(poly) > 0 ? 1 : -1;
    const here = ceilingHeight(r);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.3) continue;
      const du = (b[0] - a[0]) / len;
      const dv = (b[1] - a[1]) / len;
      const iu = -dv * inward;
      const iv = du * inward;
      // Altura del cielorraso vecino donde corresponde un escalón sin muro.
      const stepAt = (t: number): number | null => {
        const p: P = [a[0] + du * t, a[1] + dv * t];
        const nb = roomAt(p[0] - iu * 0.2, p[1] - iv * 0.2, level);
        if (!nb || nb === r || !nb.roofed || STYLES[nb.id]?.ceiling === null || ceilingHeight(nb) < here + 0.02) return null;
        if (WALLS.some((w) => w.level === level && this.nearSegment(w.a, w.b, p, (w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT) / 2 + 0.03))) return null;
        return ceilingHeight(nb);
      };
      for (const [t0, t1] of this.runs(len, (t) => stepAt(t) !== null, 0.2)) {
        const top = stepAt((t0 + t1) / 2) ?? here;
        // De 1 cm dentro de la losa de este cielorraso a 3 cm dentro de la
        // del vecino: ninguna cara queda en el plano de otra.
        this.piece(this.m.ceiling, [a[0] + du * t0, a[1] + dv * t0], [a[0] + du * t1, a[1] + dv * t1], 0.04, y + 0.01, y - here + top + 0.03, inward * 0.02);
      }
    }
  }

  /** ¿El punto `p` está a menos de `d` del segmento a→b (dentro de su largo)? */
  private nearSegment(a: P, b: P, p: P, d: number): boolean {
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const l2 = du * du + dv * dv;
    // Sin recortar t: pasada la punta del segmento el muro ya no está.
    const t = l2 > 0 ? ((p[0] - a[0]) * du + (p[1] - a[1]) * dv) / l2 : 0;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    return Math.hypot(p[0] - a[0] - du * t, p[1] - a[1] - dv * t) < d;
  }

  /**
   * Tramos [t0, t1] de un segmento de largo `len` donde vale `ok`: se
   * muestrea cada 10 cm y cada borde se ajusta por bisección. Descarta los
   * tramos más cortos que `min`.
   */
  private runs(len: number, ok: (t: number) => boolean, min: number): Array<[number, number]> {
    const n = Math.max(1, Math.round(len / 0.1));
    const step = len / n;
    const edge = (lo: number, hi: number, loOk: boolean) => {
      for (let k = 0; k < 7; k++) {
        const m = (lo + hi) / 2;
        if (ok(m) === loOk) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    };
    const out: Array<[number, number]> = [];
    let start: number | null = null;
    let prev = false;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * step;
      const cur = ok(t);
      if (cur && start === null) start = k === 0 ? 0 : edge(t - step, t, prev);
      if (!cur && start !== null) {
        out.push([start, edge(t - step, t, prev)]);
        start = null;
      }
      prev = cur;
    }
    if (start !== null) out.push([start, len]);
    return out.filter(([t0, t1]) => t1 - t0 >= min);
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
        for (let level = 1; level <= vol.floors; level++) {
          const y0 = level * H;
          // Cornisa entre plantas: sólo en los tramos de la cara que dan a la
          // intemperie. Antes se decidía la arista entera con UN punto en su
          // mitad: la del hall cruzaba el hueco de la torre como una viga, y la
          // de la galería atravesaba el pasillo de los trofeos como un cordón.
          if (vol.cornice === false) continue;
          const ra = ringPath[i];
          const rb = ringPath[(i + 1) % poly.length];
          const rl = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]);
          const e = 0.095 / Math.max(rl, 0.01);
          for (const [t0, t1] of this.exposedRuns(vol, a, [du, dv], len, [iu, iv], level)) {
            // En la punta de la arista, la esquina del anillo (cierra con la
            // cornisa de la arista vecina); en el medio, corte recto.
            const p0: P = t0 < 0.051 ? [ra[0] - (rb[0] - ra[0]) * e, ra[1] - (rb[1] - ra[1]) * e] : [a[0] + du * t0 - iu * 0.245, a[1] + dv * t0 - iv * 0.245];
            const p1: P = t1 > len - 0.051 ? [rb[0] + (rb[0] - ra[0]) * e, rb[1] + (rb[1] - ra[1]) * e] : [a[0] + du * t1 - iu * 0.245, a[1] + dv * t1 - iv * 0.245];
            this.piece(this.m.facade, p0, p1, 0.19, y0, y0 + 0.22);
          }
        }
        for (let level = 1; level <= vol.floors; level++) {
          const y0 = level * H;
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
      // Con cara inferior: si algún rincón quedara sin cielorraso, se ve la
      // chapa y no el cielo (dos triángulos por volumen).
      this.prisms.plan((vol.roofMat && this.m[vol.roofMat]) || this.m.roof, body, top, top + 0.04, { sides: false });
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

  /**
   * Tramos [t0, t1] de la arista a→a+d·len cuyo exterior (45 cm afuera) está
   * a la intemperie en ese nivel. Se muestrea cada 10 cm y cada borde de
   * tramo se ajusta por bisección; los tramos de menos de 30 cm se descartan.
   */
  private exposedRuns(vol: Volume, a: P, d: P, len: number, inward: P, level: number): Array<[number, number]> {
    return this.runs(len, (t) => !this.covered(vol, [a[0] + d[0] * t - inward[0] * 0.45, a[1] + d[1] * t - inward[1] * 0.45], level), 0.3);
  }

  /**
   * ¿Del otro lado de esa cara hay otro volumen alto, el gimnasio, un ambiente
   * de ese nivel o un hueco de escalera? En los tres últimos casos la cornisa
   * quedaría adentro (un cordón en el piso o una viga sobre el hueco).
   */
  private covered(vol: Volume, p: P, level: number): boolean {
    if (UPPER.some((o) => o !== vol && o.floors >= level && inPoly(o.poly, p[0], p[1]))) return true;
    if (roomAt(p[0], p[1])?.id === 'gimnasio') return true;
    const lv = Math.min(2, level) as Level;
    if (roomAt(p[0], p[1], lv)) return true;
    return voidsAt(lv).some((h) => p[0] > h.u0 && p[0] < h.u1 && p[1] > h.v0 && p[1] < h.v1);
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
      if (Math.abs(c[1]) < 0.05 && c[0] > U.east1 - 0.5 && c[0] < U.salonW + 0.5) continue;
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
      // Sobre el hall del segundo piso la chapa no vuela al oeste: ahí la
      // parte oeste del bloque es más alta y el alero se metía en el hall
      // (se veía su testa desde adentro).
      const va = Math.min(arcV(p0), arcV(p1));
      const vb = Math.max(arcV(p0), arcV(p1));
      const overHall = vb > V1.blockA && va < V1.blockHall;
      const segMid = overHall ? (u0 + 0.01 + U.e + 0.35) / 2 : uMid;
      const segLen = overHall ? U.e + 0.35 - (u0 + 0.01) : uLen;
      const pos = toWorld(this.f, segMid, arcV(pm));
      this.farm.add('box', m.gymRoof, new Vector3(pos.x, arcY(pm), pos.z), new Vector3(segLen, 0.1, w), 0, pm);
      // Cara interior oscura de la chapa, sólo sobre el polideportivo.
      const inner = toWorld(this.f, (U.gymW + U.e) / 2, arcV(pm, r - 0.08));
      this.farm.add('box', m.metalDark, new Vector3(inner.x, arcY(pm, r - 0.08), inner.z), new Vector3(U.e - U.gymW, 0.04, w), 0, pm);
      // Franjas de policarbonato traslúcido de alero a alero (9:22–9:28).
      // 2 cm más angostas que la chapa: en los aleros sus testas quedaban en
      // el plano de las de la chapa y titilaban.
      for (const us of [54.58, 60.28, 65.98].map(planU)) {
        const sp = toWorld(this.f, us, arcV(pm, r + 0.03));
        this.farm.add('box', m.light, new Vector3(sp.x, arcY(pm, r + 0.03), sp.z), new Vector3(1.0, 0.1, w - 0.02), 0, pm);
        const ip = toWorld(this.f, us, arcV(pm, r - 0.1));
        this.farm.add('box', m.light, new Vector3(ip.x, arcY(pm, r - 0.1), ip.z), new Vector3(1.0, 0.04, w - 0.02), 0, pm);
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
    ].map(([v0, v1, y0, y1]): [number, number, number, number] => [planV(v0), planV(v1), y0, y1]);
    this.gable(m.blueSheet, U.gymW, U.gymW + 0.12, wallTop, archY, danceWin);
    this.gable(m.white, U.gymW - 0.12, U.gymW, wallTop, archY, danceWin);
    for (const [v0, v1, y0, y1] of danceWin) {
      // Corredizas blancas con malla romboidal del lado del polideportivo.
      this.box(m.glass, U.gymW, (v0 + v1) / 2, 0.02, y1 - y0, v1 - v0, y0);
      this.box(m.frame, U.gymW, (v0 + v1) / 2, 0.14, 0.05, v1 - v0, y0);
      this.box(m.frame, U.gymW, (v0 + v1) / 2, 0.14, 0.05, v1 - v0, y1 - 0.05);
      for (let v = v0 + 0.1; v < v1; v += 0.12) this.box(m.mesh, U.gymW + 0.16, v, 0.012, y1 - y0, 0.012, y0);
    }
    // La primera, junto a Laprida, baja a 9,10: con 9,25 tocaba la bóveda
    // (que son cuerdas planas, por debajo del arco) y el cielorraso cortaba
    // la esquina del vidrio.
    const mirrorWin: Array<[number, number, number, number]> = [
      ...([
        [-5.45, -4.55, 8.85, 9.1],
        [-7.65, -6.75, 8.85, 9.35],
        [-9.85, -8.95, 8.85, 9.45],
        [-12.05, -11.15, 8.85, 9.45],
      ] as const).map(([v0, v1, y0, y1]): [number, number, number, number] => [planV(v0), planV(v1), y0, y1]),
      // Paso del hall del segundo piso, bajo la bóveda.
      [V1.blockA, V1.blockHall, 2 * H, 8.75],
    ];
    this.gable(m.facade, u0 - 0.15, u0 + 0.15, 2 * H, archY, mirrorWin);
    // Sobre el hall del segundo piso, la parte oeste (dos plantas, techo
    // plano a 3 pisos) es más alta que la bóveda: entre la curva del tímpano
    // y ese techo quedaba un triángulo abierto por el que se veía el cielo y
    // la testa de la chapa desde adentro del hall. Se cierra con el mismo
    // tímpano (blanco hacia el hall, revoque hacia afuera).
    const fill: Array<[number, number]> = [];
    for (let k = 0; k <= 8; k++) {
      const v = V1.blockA + ((V1.blockHall - V1.blockA) * k) / 8;
      fill.push([v, archY(v) - 0.05]);
    }
    fill.push([V1.blockHall, 3 * H + 0.05], [V1.blockA, 3 * H + 0.05]);
    this.prisms.alongU(m.white, fill, u0 - 0.15, u0);
    this.prisms.alongU(m.facade, fill, u0, u0 + 0.15);
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
    this.box(m.metalDark, planU(51.8), 0.05, 2.2, 0.16, 0.1, 2.5);
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
    // Huellas de chapa semilla de melón (relieve también en VR, 8:37–8:41).
    const tread = chequer ? m.metalTread : m.stair;
    // La del jardín tiene pasamanos negro (11:49–13:06).
    // Video 2026: la blanca del comedor tiene baranda de caño rojo.
    const rail = chequer || s.u0 >= U.teaE - 0.01 ? m.metalDark : s.hollow && !s.guard ? m.frame : m.red;
    for (let i = 0; i < n; i++) {
      const c = from + run * (i + 0.5);
      const top = FY + s.y0 + ((i + 1) * (s.y1 - s.y0)) / n;
      const bottom = solid ? 0 : top - 0.24;
      if (alongU) this.box(tread, c, (s.v0 + s.v1) / 2, Math.abs(run) + 0.01, top - bottom, s.v1 - s.v0, bottom);
      else this.box(tread, (s.u0 + s.u1) / 2, c, s.u1 - s.u0, top - bottom, Math.abs(run) + 0.01, bottom);
      // La de chapa no lleva nariz clara: la huella es la chapa entera.
      if (chequer) continue;
      // Nariz de escalón clara (las del acceso llevan una franja amarilla).
      if (!this.detailed && i > 0 && i < n - 1) continue;
      // Narices amarillas en el primer escalón y en la llegada (0:19, 1:35).
      // La del hall (chapa perforada, video 2026) tiene los escalones grises
      // lisos: las amarillas son de la otra escalera.
      const yellow = !chequer && s.guard !== 'perforated' && (i === n - 1 || (i === 0 && s.y0 < 0.5));
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
    const sloped = (mat: Material, across: number, y: number, thick: number, width: number, long = hyp) => {
      const p = alongU ? toWorld(this.f, (s.u0 + s.u1) / 2, across) : toWorld(this.f, across, (s.v0 + s.v1) / 2);
      if (alongU) this.farm.add('box', mat, new Vector3(p.x, y, p.z), new Vector3(long, thick, width), 0, 0, tilt);
      else this.farm.add('box', mat, new Vector3(p.x, y, p.z), new Vector3(width, thick, long), 0, tilt, 0);
    };
    const mid = alongU ? (s.v0 + s.v1) / 2 : (s.u0 + s.u1) / 2;
    const width = alongU ? s.v1 - s.v0 : s.u1 - s.u0;
    if (!solid) {
      // Debajo: losa inclinada lisa (hormigón) o dos zancas (chapa), en vez
      // del serrucho de escalones sueltos que se veía desde abajo. Su cara
      // superior pasa por el pie de cada contrahuella y baja 26 cm.
      if (s.hollow || chequer) {
        // Las zancas de la de chapa siguen de hierro pintado.
        // La blanca del comedor (video 2026) tiene zancas de mampostería
        // blanca, más altas: el costado se lee macizo y blanco.
        const deep = s.guard === 'rails' ? 0.42 : 0.26;
        for (const sgn of [-1, 1]) sloped(chequer ? m.metalDark : s.guard === 'rails' ? m.facade : tread, mid + sgn * (width / 2 - 0.03), yMid - deep / 2, deep * Math.cos(ang), 0.06);
      } else {
        sloped(tread, mid, yMid - 0.13, 0.26 * Math.cos(ang), width);
      }
    }
    // Pasamanos a 0,9 m sobre la línea de los escalones. Del lado de un muro
    // va sobre ménsulas; del lado abierto, sobre parantes con travesaño medio
    // (antes era un caño suelto flotando en el aire).
    const runAt = (t: number) => from + (to - from) * t;
    const treadTop = (t: number) => FY + s.y0 + (Math.min(n - 1, Math.floor(t * n)) + 1) * (rise / n);
    // Pasamanos y travesaño terminan al ras del primer y del último parante
    // (antes asomaban ~25 cm al aire en cada descanso).
    const railLong = hyp * 0.88 + 0.04;
    for (const side of [0, 1]) {
      const edge = alongU ? (side ? s.v1 : s.v0) : side ? s.u1 : s.u0;
      const inward = side ? -1 : 1;
      const face = this.stairSideWall(s, edge, inward);
      const walled = face !== null;
      // Del lado del muro, a 4 cm de su cara (más el radio del caño): antes
      // se medía desde el borde del tramo y quedaba a 10–15 cm del muro, o
      // metido dentro.
      const across = face !== null ? face + inward * 0.065 : edge + inward * 0.04;
      if (!walled && s.guard) {
        this.stairGuard2026(s, rail, sloped, across, yMid, rise, length, railLong, runAt, treadTop);
        continue;
      }
      if (!walled && s.meshGuard) {
        this.stairMesh(s, rail, sloped, across, yMid, rise, length, railLong, runAt, treadTop);
        continue;
      }
      sloped(rail, across, yMid + 0.9, 0.05, 0.05, railLong);
      const posts = Math.max(2, Math.round(length / 1.1) + 1);
      for (let k = 0; k < posts; k++) {
        const t = 0.06 + (0.88 * k) / (posts - 1);
        const at = runAt(t);
        const railY = yMid + 0.9 + (t - 0.5) * rise;
        if (face !== null) {
          // Ménsula desde la cara del muro hasta debajo del caño (también en
          // VR: sin ella el pasamanos flotaba).
          const c = face + inward * 0.0325;
          const [bu, bv] = alongU ? [at, c] : [c, at];
          this.box(rail, bu, bv, alongU ? 0.03 : 0.065, 0.03, alongU ? 0.065 : 0.03, railY - 0.05);
        } else {
          const [pu, pv] = alongU ? [at, across] : [across, at];
          const y0 = treadTop(t);
          this.box(rail, pu, pv, 0.04, railY - y0, 0.04, y0);
        }
      }
      if (!walled && this.detailed) sloped(rail, across, yMid + 0.45, 0.03, 0.03, railLong);
    }
  }

  /**
   * Barandas del video de 2026 en el lado abierto de un tramo, ~1 m sobre la
   * línea de los escalones. `perforated` (la del hall): marco de caño rojo
   * con tres paños de chapa perforada clara separados por parantes.
   * `rails` (la blanca del comedor): caño rojo con pasamanos, dos travesaños
   * paralelos a la pendiente y parantes en las puntas y el medio. La colisión
   * es la misma barrera del costado de siempre.
   */
  private stairGuard2026(
    s: Stair,
    red: Material,
    sloped: (mat: Material, across: number, y: number, thick: number, width: number, long?: number) => void,
    across: number,
    yMid: number,
    rise: number,
    length: number,
    railLong: number,
    runAt: (t: number) => number,
    treadTop: (t: number) => number,
  ): void {
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const ang = Math.atan2(rise, length);
    const H_TOP = s.guard === 'perforated' ? 1.0 : 0.95;
    sloped(red, across, yMid + H_TOP, 0.045, 0.045, railLong);
    if (s.guard === 'perforated') {
      // Zócalo del marco y el paño claro entre él y el pasamanos (chapa
      // perforada blanca rosada: con el blanco de los marcos, sin material nuevo).
      sloped(red, across, yMid + 0.14, 0.035, 0.035, railLong);
      sloped(this.m.frame, across, yMid + (H_TOP + 0.14) / 2, (H_TOP - 0.18) * Math.cos(ang), 0.012, railLong);
    } else {
      for (const y of [0.35, 0.65]) sloped(red, across, yMid + y, 0.032, 0.032, railLong);
    }
    // Parantes: puntas y divisiones de los paños (o el del medio).
    const ts = s.guard === 'perforated' ? [0, 1 / 3, 2 / 3, 1] : [0, 0.5, 1];
    for (const f of ts) {
      const t = 0.06 + 0.88 * f;
      const at = runAt(t);
      const railY = yMid + H_TOP + (t - 0.5) * rise;
      const y0 = f === 0 || f === 1 ? treadTop(t) : yMid + 0.12 + (t - 0.5) * rise;
      const [pu, pv] = alongU ? [at, across] : [across, at];
      this.box(red, pu, pv, 0.045, railY - y0, 0.045, y0);
    }
  }

  /**
   * Paño de metal desplegado con marco, del color del pasamanos, en el lado
   * abierto de un tramo: rojo en la escalera del hall (0:19), blanco en la
   * exterior del comedor (9:44–9:47). ~1 m sobre la línea de los escalones.
   * La trama es una grilla fina de tiras (más abierta en el visor); la
   * colisión es la misma barrera del costado de siempre.
   */
  private stairMesh(
    s: Stair,
    red: Material,
    sloped: (mat: Material, across: number, y: number, thick: number, width: number, long?: number) => void,
    across: number,
    yMid: number,
    rise: number,
    length: number,
    railLong: number,
    runAt: (t: number) => number,
    treadTop: (t: number) => number,
  ): void {
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const H_TOP = 1.0;
    // Marco: pasamanos, zócalo y los dos parantes de punta.
    sloped(red, across, yMid + H_TOP, 0.05, 0.05, railLong);
    sloped(red, across, yMid + 0.12, 0.04, 0.04, railLong);
    const step = this.detailed ? 0.1 : 0.2;
    for (let y = 0.12 + step; y < H_TOP - 0.03; y += step) sloped(red, across, yMid + y, 0.008, 0.012, railLong);
    const cols = Math.max(2, Math.round((length * 0.88) / step));
    for (let k = 0; k <= cols; k++) {
      const t = 0.06 + (0.88 * k) / cols;
      const end = k === 0 || k === cols;
      const at = runAt(t);
      const railY = yMid + H_TOP + (t - 0.5) * rise;
      const y0 = end ? treadTop(t) : yMid + 0.12 + (t - 0.5) * rise;
      const [pu, pv] = alongU ? [at, across] : [across, at];
      const thick = end ? 0.05 : 0.008;
      this.box(red, pu, pv, alongU ? thick : 0.012, railY - y0, alongU ? 0.012 : thick, y0);
    }
  }

  /**
   * Cara del muro (o del tabique entre tramos) pegado a este costado del
   * tramo, del lado de la escalera; `null` si el costado está abierto. Un
   * muro bajo cuenta sólo si llega a la altura del pasamanos: la oficina bajo
   * la escalera de chapa (1,35 m) y el tabique de la escalera principal
   * dejaban caños flotando hasta 3 m por encima.
   */
  private stairSideWall(s: Stair, edge: number, inward: number): number | null {
    const alongU = s.dir === 'u+' || s.dir === 'u-';
    const level = Math.min(2, Math.floor((s.y0 + 0.01) / H));
    const lo = alongU ? s.u0 : s.v0;
    const hi = alongU ? s.u1 : s.v1;
    const railTop = FY + s.y1 + 0.85;
    for (const w of WALLS) {
      if (w.level !== level) continue;
      const parallel = alongU ? Math.abs(w.a[1] - w.b[1]) < 0.01 : Math.abs(w.a[0] - w.b[0]) < 0.01;
      if (!parallel) continue;
      const line = alongU ? w.a[1] : w.a[0];
      const t = w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT;
      if (Math.abs(line - edge) > t / 2 + 0.12) continue;
      const a = alongU ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
      const b = alongU ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
      if (Math.min(b, hi) - Math.max(a, lo) <= (hi - lo) * 0.5) continue;
      // Muro de piso entero (sigue arriba) o que pasa la altura del pasamanos.
      if (w.h < H - 0.01 && w.level * H + w.h < railTop) continue;
      return line + inward * (t / 2);
    }
    return null;
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
      // 1 cm salidas del frente de la estantería (al ras, sus caras titilaban).
      this.piece(m.metalDark, at(10.85), at(11.55), 0.37, FY + y, FY + y + 0.32, face + 0.225);
    }
    this.piece(m.yellow, at(11.0), at(11.45), 0.3, FY + 1.9, FY + 2.15, face + 0.2);
    // Testero de Miguel Cané: pizarrón interactivo entre las dos ventanas
    // altas y una estantería con cajas celestes (la otra son los muebles
    // Educabot, junto a la puerta).
    const mcIn = (v: number, off: number): P => {
      const u = miguelCaneU(v);
      // Normal hacia adentro (este) de la línea de Miguel Cané.
      return [u + off * MC_COS, v + off * MC_SLOPE * MC_COS];
    };
    this.piece(m.metalDark, mcIn(planV(-34.2), 0.17), mcIn(planV(-35.7), 0.17), 0.05, FY + 0.88, FY + 2.12);
    this.piece(m.board, mcIn(planV(-34.25), 0.2), mcIn(planV(-35.65), 0.2), 0.02, FY + 0.92, FY + 2.08);
    for (const [v0, v1] of [[planV(-36.4), planV(-37.1)]] as const) {
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

  /** Descansos de las escaleras. */
  private cores(): void {
    // Descansos: macizos los bajos, losa los de los pisos altos.
    for (const l of LANDINGS) {
      const top = FY + l.y;
      // El descanso de la escalera de chapa del edificio de bloque es de chapa
      // como sus tramos (8 cm, no una losa gris de 24), con un parante en la
      // única esquina que no apoya en un muro ni en un tramo.
      const steel = l.u0 >= U1.blockStair0 - 0.01 && l.y >= 3;
      const bottom = steel ? top - 0.08 : l.y < 3 && !l.hollow ? 0 : top - 0.24;
      // El descanso de chapa, de la misma chapa semilla de melón que los tramos.
      this.box(steel ? this.m.metalTread : this.m.stair, (l.u0 + l.u1) / 2, (l.v0 + l.v1) / 2, l.u1 - l.u0, top - bottom, l.v1 - l.v0, bottom);
      if (steel) this.box(this.m.metalDark, l.u1 - 0.05, l.v1 - 0.05, 0.08, bottom - LEVEL_Y[1], 0.08, LEVEL_Y[1]);
    }
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
        // Tapa (madera o laminado de color) sobre cuatro patas finas y un
        // travesaño. Talle de primaria en las aulas de 2º a 6º grado.
        const top = deskTopOf(it) - 0.04;
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
        // se dibujaban de adulto junto a mesas de adulto. En primaria, de
        // talle de primaria (menos la del docente).
        this.chair(this.mat(it.color, mat), u, v, it.face, chairScaleOf(it));
        break;
      }
      case 'table': {
        const top = deskTopOf(it) - 0.04;
        this.box(this.mat(it.color, m.timber), u, v, w, 0.04, d, FY + top);
        if (!this.detailed) {
          // En VR, dos laterales (como los pupitres) en vez de cuatro patas:
          // 81 mesas, 160 cajas menos en la malla más grande de la escuela.
          for (const s of [-1, 1]) {
            if (w >= d) this.box(m.metalDark, u + s * (w / 2 - 0.08), v, 0.03, top, d - 0.16, FY);
            else this.box(m.metalDark, u, v + s * (d / 2 - 0.08), w - 0.16, top, 0.03, FY);
          }
          break;
        }
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
        this.cyl(top, u, v, w, 0.05, FY + hgt, true);
        this.box(m.metalDark, u, v, 0.08, hgt, 0.08, FY);
        // Pie en cruz en el piso: con un solo poste la mesa no se sostendría.
        if (this.detailed) {
          this.box(m.metalDark, u, v, w * 0.6, 0.03, 0.06, FY);
          this.box(m.metalDark, u, v, 0.06, 0.03, w * 0.6, FY);
        }
        const chairMat = it.kind === 'hexTable' ? m.chairBlue : m.red;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          const cu = u + Math.cos(a) * (w / 2 + FURNITURE.roundChair);
          const cv = v + Math.sin(a) * (w / 2 + FURNITURE.roundChair);
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
        // Mueble bajo de verdad: zócalo oscuro retirado 6 cm, cuerpo, tapa que
        // vuela 2 cm en un laminado más oscuro y juntas de puertas al frente.
        // Antes era un bloque blanco liso con una tapa blanca: en el
        // laboratorio se leía como una caja, no como una mesada.
        const buffet = room?.id === 'buffet';
        const body = this.mat(it.color, buffet ? m.black : m.appliance);
        const [fu, fv] = faceDir(it.face);
        const along = alongV ? d : w;
        this.box(m.metalDark, u - fu * 0.03, v - fv * 0.03, alongV ? w - 0.06 : w, 0.1, alongV ? d : d - 0.06, FY);
        this.box(body, u, v, w, 0.82, d, FY + 0.1);
        this.box(buffet ? m.timberDark : m.black, u, v, w + 0.04, 0.04, d + 0.04, FY + 0.92);
        const doors = Math.max(1, Math.round(along / 0.6));
        for (let k = 1; k < doors; k++) {
          const t = (k / doors - 0.5) * along;
          const half = (alongV ? w : d) / 2;
          this.box(m.metalDark, u + (alongV ? fu * half : t), v + (alongV ? t : fv * half), alongV ? 0.012 : 0.012, 0.74, 0.012, FY + 0.14);
        }
        break;
      }
      case 'fridge': {
        this.box(m.appliance, u, v, w, 1.9, d, FY);
        this.box(m.glass, u - 0.36, v, 0.02, 1.6, d - 0.1, FY + 0.15);
        break;
      }
      case 'planter': {
        const ph = it.h ?? 0.6;
        this.box(this.mat(it.color, m.blue), u, v, w, ph, d, FY);
        this.box(m.soil, u, v, w - 0.12, 0.04, d - 0.12, FY + ph - 0.02);
        // Los canteros rojos altos del patio aire libre (video 2026) llevan una
        // hilera pareja de plantitas (cintas, agaves chicos), no matas grandes.
        const small = ph >= 0.95;
        // En el visor, la mitad de plantitas (presupuesto de triángulos).
        const n = Math.max(1, Math.round(Math.max(w, d) / (small ? (this.detailed ? 0.75 : 1.5) : 1.1)));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const p = toWorld(this.f, u + (w >= d ? t * (w - 0.5) : 0), v + (w >= d ? 0 : t * (d - 0.5)));
          this.nature.shrub(p.x, p.z, small ? this.rng.range(0.28, 0.36) : this.rng.range(0.55, 0.8), FY + ph);
        }
        break;
      }
      case 'bench': {
        if (it.color === 'frame') {
          // Banco de plaza blanco de listones con respaldo (video 2026, 1:05):
          // seis listones de asiento y respaldo sobre patas negras finas.
          const [fu, fv] = faceDir(it.face);
          const len = alongV ? d : w;
          const dep = alongV ? w : d;
          const slat = (off: number, y: number, h: number) =>
            this.box(m.frame, u + fu * off, v + fv * off, alongV ? 0.07 : len, h, alongV ? len : 0.07, FY + y);
          for (let k = 0; k < 4; k++) slat(dep / 2 - 0.06 - k * 0.11, 0.42, 0.03);
          for (let k = 0; k < 3; k++) slat(-dep / 2 + 0.03, 0.55 + k * 0.12, 0.07);
          for (const sgn of [-1, 1]) {
            const a = sgn * (len / 2 - 0.15);
            this.box(m.metalDark, u + (alongV ? 0 : a), v + (alongV ? a : 0), alongV ? dep - 0.04 : 0.05, 0.42, alongV ? 0.05 : dep - 0.04, FY);
            this.box(m.metalDark, u + (alongV ? 0 : a) - fu * (dep / 2 - 0.03), v + (alongV ? a : 0) - fv * (dep / 2 - 0.03), 0.05, 0.45, 0.05, FY + 0.42);
          }
          break;
        }
        const mat = this.mat(it.color, room?.id === 'buffet' ? m.timberDark : m.red);
        this.box(mat, u, v, w, 0.06, d, FY + 0.42);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(m.metalDark, u + s * (w / 2 - 0.12), v, 0.06, 0.42, d - 0.06, FY);
          else this.box(m.metalDark, u, v + s * (d / 2 - 0.12), w - 0.06, 0.42, 0.06, FY);
        }
        break;
      }
      case 'tree': {
        // Cordón de 10 cm alrededor y la tierra 2,5 cm más abajo: con la
        // tapa del cordón y la tierra en el mismo plano, el borde titilaba.
        this.box(m.soil, u, v, 1.1, 0.095, 1.1, FY - 0.08);
        for (const s of [-1, 1]) {
          this.box(m.slab, u + s * 0.6, v, 0.1, 0.12, 1.3, FY - 0.08);
          this.box(m.slab, u, v + s * 0.6, 1.1, 0.12, 0.1, FY - 0.08);
        }
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
        const body = this.mat(it.color, jardin ? m.yellow : m.timber);
        this.box(body, u, v, w, 1.3, d, FY);
        this.box(m.bars, u, v - d / 2, w * 0.35, 0.9, 0.02, FY + 0.1);
        const p = toWorld(this.f, u, v);
        for (const s of [-1, 1]) {
          this.farm.add(
            'box',
            // Con color propio (las casitas rosas de las salas), techo blanco.
            jardin ? m.red : it.color ? m.frame : m.timberDark,
            new Vector3(p.x, FY + 1.62, p.z + s * (d / 4 + 0.02)),
            new Vector3(w + 0.2, 0.06, d / 2 + 0.25),
            0,
            s * 0.62,
          );
        }
        // Tímpanos: sin ellos se veía el triángulo hueco bajo los dos paños,
        // como una caja con una tapa apoyada. Sólo las dos caras de punta
        // (alongU no dibuja los costados), del color de las paredes.
        const slope = Math.tan(0.62);
        const eave = FY + 1.62 - (d / 4 - 0.02) * slope - 0.03;
        const ridge = FY + 1.62 + (d / 4 + 0.02) * slope - 0.03;
        this.prisms.alongU(
          body,
          [
            [v - d / 2, FY + 1.3],
            [v + d / 2, FY + 1.3],
            [v + d / 2, eave],
            [v, ridge],
            [v - d / 2, eave],
          ],
          u - w / 2 + 0.01,
          u + w / 2 - 0.01,
        );
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
        this.cyl(m.red, u, v, 0.17, 0.52, y, true);
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
        this.cyl(this.mat(it.color, m.red), u, v, w, it.h ?? 3.1, FY, true);
        break;
      case 'paddedColumn': {
        // Columna con protección acolchada hasta 2 m (como la verde del hall).
        const top = it.h ?? 3.1;
        this.box(m.white, u, v, w * 0.8, top, d * 0.8, FY);
        this.box(this.mat(it.color, m.chairGreen), u, v, w, 2.0, d, FY + 0.05);
        // Cinta azul en el borde de arriba de la protección (video 2026).
        if (it.color === 'darkGreen') this.box(m.blue, u, v, w + 0.01, 0.05, d + 0.01, FY + 1.85);
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
        // Apoyapiés a 28 cm del piso, de pata a pata (más finos que las patas:
        // entran en ellas sin caras coplanares). La gente sentada apoya ahí
        // las suelas (Places: footDrop 0,48 desde el asiento de 0,76).
        for (const s of [-1, 1]) {
          this.box(mat, u + s * 0.13, v, 0.025, 0.025, 0.26, FY + 0.265);
          this.box(mat, u, v + s * 0.13, 0.26, 0.025, 0.025, FY + 0.265);
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
          this.cyl(m.timber, u + Math.cos(a) * 0.08, v + Math.sin(a) * 0.08, 0.04, 1.9 + (k % 3) * 0.25, FY + 0.4, true);
        }
        break;
      }
      case 'piano': {
        // Piano vertical: caja de 0,33 m contra el muro, teclado que sobresale
        // 22 cm entre dos mejillas, teclas blancas y la franja de las negras.
        // Antes el teclado quedaba DENTRO de la caja y el piano (el de la
        // historia: "tocá el piano") era un cajón liso.
        const [fu, fv] = faceDir(it.face);
        const part = (mat: Material, off: number, side: number, wid: number, h: number, dep: number, y0: number) =>
          this.box(mat, u + fu * off - fv * side, v + fv * off + fu * side, alongV ? dep : wid, h, alongV ? wid : dep, y0);
        part(m.timberDark, -d * 0.2, 0, w, 1.25, d * 0.6, FY);
        part(m.timberDark, d * 0.3, 0, w * 0.95, 0.08, d * 0.4, FY + 0.66);
        part(m.board, d / 2 - 0.095, 0, w * 0.86, 0.02, 0.15, FY + 0.74);
        part(m.black, d / 2 - 0.15, 0, w * 0.84, 0.012, 0.05, FY + 0.76);
        // Mejillas de 4 cm, 5 mm adentro de los costados de la caja, 1 cm
        // más salidas que el teclado y 1 cm metidas en la caja: ninguna cara
        // coplanar con la caja ni con el teclado (que entra 7 mm en ellas).
        for (const sd of [-1, 1]) part(m.timberDark, d * 0.3, sd * (w / 2 - 0.025), 0.04, 0.8, d * 0.4 + 0.02, FY);
        break;
      }
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
        if (it.mesh) {
          // Paño de metal desplegado con marco (guardas de las escaleras):
          // grilla fina de tiras dentro de un marco de caño.
          const L = Math.max(w, d);
          const ms = this.detailed ? 0.1 : 0.2;
          const cols = Math.max(2, Math.round(L / ms));
          for (let k = 0; k <= cols; k++) {
            const t = k / cols - 0.5;
            const end = k === 0 || k === cols;
            const th = end ? 0.05 : 0.008;
            this.box(mat, u + (alongV ? 0 : t * (w - 0.05)), v + (alongV ? t * (d - 0.05) : 0), alongV ? 0.012 : th, hgt, alongV ? th : 0.012, FY);
          }
          for (let y = 0.1 + ms; y < hgt - 0.08; y += ms) this.box(mat, u, v, alongV ? 0.012 : w, 0.008, alongV ? d : 0.012, FY + y);
          for (const y of [0.08, hgt - 0.05]) this.box(mat, u, v, alongV ? 0.05 : w, 0.05, alongV ? d : 0.05, FY + y);
          break;
        }
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
          this.cyl(m.yellow, tu, tv, 0.08, 0.22 + (k % 3) * 0.06, y + 0.04, true);
          this.box(m.timberDark, tu, tv, 0.1, 0.05, 0.1, y + 0.04);
        }
        break;
      }
      case 'waterCooler':
        this.box(m.board, u, v, 0.32, 1.0, 0.32, FY);
        this.cyl(m.glass, u, v, 0.26, 0.42, FY + 1.0, true);
        break;
      case 'plasticChair':
        // Sillones plásticos crema del pasillo de los trofeos (4:36).
        this.chair(m.plasticCream, u, v, it.face);
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
        // Mesada con venecitas, bachas embutidas, griferías y espejos encima.
        this.box(m.yellow, u, v, w, 0.85, d, FY);
        this.box(m.board, u, v, w + 0.02, 0.05, d + 0.02, FY + 0.85);
        const n = Math.max(1, Math.round(Math.max(w, d) / 0.8));
        const [nu, nv] = faceDir(it.face);
        // Fondo de la mesada (hacia el muro): `w` si mira al este u oeste.
        const dep = alongV ? w : d;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const su = u + (alongV ? 0 : t * w);
          const sv = v + (alongV ? t * d : 0);
          // Bacha al ras de la mesada (2 mm arriba, sin cara compartida):
          // antes era un plato blanco 4 cm por encima.
          this.cyl(m.slab, su, sv, 0.34, 0.004, FY + 0.902, true);
          // Grifería: columna y pico hacia la bacha.
          const back = (o: number): [number, number] => [su - nu * (dep / 2 - o), sv - nv * (dep / 2 - o)];
          const [cu, cv] = back(0.07);
          this.box(m.metal, cu, cv, 0.03, 0.2, 0.03, FY + 0.9);
          const [pu, pv] = back(0.12);
          this.box(m.metal, pu, pv, nu ? 0.1 : 0.03, 0.03, nv ? 0.1 : 0.03, FY + 1.07);
          // Espejo contra el muro (antes, en las mesadas que miran al este u
          // oeste, quedaba del otro lado del muro).
          const [mu, mv] = back(0.02);
          this.box(m.glass, mu, mv, alongV ? 0.02 : 0.5, 0.7, alongV ? 0.5 : 0.02, FY + 1.15);
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
      case 'flagpole': {
        const ph = it.h ?? 6.5;
        // En 2026 los mástiles son blancos (con color, el de la bandera).
        this.cyl(it.color ? m.frame : m.metal, u, v, 0.07, ph, FY);
        if (it.color && it.color !== 'frame') {
          // Bandera quieta, caída junto al mástil: la argentina (celeste,
          // blanca, celeste) o una toda azul.
          const sky = this.mat(it.color, m.blue);
          const stripes = it.color === 'skyWall' ? [sky, m.frame, sky] : [sky, sky, sky];
          stripes.forEach((mat, k) => this.box(mat, u + 0.05, v, 0.02, 0.3, 0.55, FY + ph - 0.45 - (k + 1) * 0.3));
        }
        break;
      }
      case 'stack': {
        const mat = this.mat(it.color, m.red);
        const n = Math.round((it.h ?? 1.6) / 0.09);
        this.box(mat, u, v, w, 0.45, d, FY);
        for (let k = 0; k < n; k++) this.box(mat, u, v, w, 0.03, d, FY + 0.45 + k * 0.09);
        break;
      }
      case 'drumKit':
        this.cyl(m.red, u, v, 0.55, 0.45, FY + 0.05, true);
        for (const [du, dv] of [
          [-0.45, 0.25],
          [0.45, 0.25],
          [0, 0.45],
        ]) {
          this.cyl(m.red, u + du, v + dv, 0.32, 0.25, FY + 0.6, true);
          this.box(m.metal, u + du, v + dv, 0.02, 0.6, 0.02, FY);
        }
        this.cyl(m.yellow, u - 0.6, v - 0.2, 0.4, 0.01, FY + 1.1, true);
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
        this.cyl(m.orange, u + nu * 0.25, v + nv * 0.25, 0.4, 0.02, FY + 1.95, true);
        this.cyl(m.board, u + nu * 0.25, v + nv * 0.25, 0.3, 0.3, FY + 1.65);
        break;
      }
      case 'ceilingFan': {
        // Cuatro aspas beige y una campana de bronce colgadas del techo.
        const y = FY + 2.75;
        this.box(m.metalDark, u, v, 0.03, 0.3, 0.03, y + 0.05);
        this.cyl(m.yellow, u, v, 0.2, 0.12, y - 0.05, true);
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
        this.cyl(m.timber, u, v, Math.max(w, d) * 0.9, 0.7, FY + 1.9, true);
        this.cyl(m.timber, u, v, Math.max(w, d) * 0.5, 0.45, FY + 2.55, true);
        break;
      case 'climber': {
        // Domo trepador: aros de caño de colores.
        const p = toWorld(this.f, u, v);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI;
          this.farm.add('box', [m.red, m.blue, m.yellow, m.lime][k], new Vector3(p.x, FY + 0.6, p.z), new Vector3(w, 0.05, 0.05), a, 0, 0);
        }
        this.cyl(m.red, u, v, w * 0.7, 0.05, FY + 1.15, true);
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
        this.cyl(m.metalDark, u, v, w, 1.4, FY + (it.y ?? 0) + 0.3, true);
        break;
      case 'amphi': {
        // Gradas curvas del patio nuevo (video 2026): tres escalones de
        // hormigón pintado de azul en cuarto de círculo con centro en la
        // esquina del ítem; el de arriba es un cantero. Cada escalón son
        // gajos rectos (cajas de la granja, sin malla propia).
        const mat = this.mat(it.color, m.navy);
        const cu = u - w / 2;
        const cv = v - d / 2;
        const r = Math.min(w, d);
        const n = this.detailed ? 9 : 6;
        const half = Math.PI / 4 / n;
        for (const [a0, a1, h] of [
          [0.66, 1, 0.42],
          [0.36, 0.66, 0.84],
          [0, 0.36, 1.1],
        ] as const) {
          const rIn = a0 * r * Math.cos(half);
          const rOut = a1 * r;
          for (let k = 0; k < n; k++) {
            const t = ((k + 0.5) / n) * (Math.PI / 2);
            const mid = (rIn + rOut) / 2;
            const p = toWorld(this.f, cu + Math.cos(t) * mid, cv + Math.sin(t) * mid);
            this.farm.add('box', mat, new Vector3(p.x, FY + h / 2, p.z), new Vector3(rOut - rIn, h, 2 * rOut * Math.sin(half) + 0.03), this.yaw(Math.cos(t), Math.sin(t)));
          }
        }
        for (const t of [0.25, 0.75, 1.25]) {
          const p = toWorld(this.f, cu + Math.cos(t) * r * 0.2, cv + Math.sin(t) * r * 0.2);
          this.nature.shrub(p.x, p.z, this.rng.range(0.6, 0.85), FY + 1.1);
        }
        break;
      }
      case 'roundPlanter': {
        // Cantero redondo escalonado del rincón NE (video 2026, 1:04–1:06):
        // tres anillos concéntricos de hormigón pintado de azul marino, el de
        // arriba lleno de tierra con arbustos y un arbolito. Cada anillo son
        // gajos rectos de la granja (como las gradas), sin malla propia.
        const mat = this.mat(it.color, m.navy);
        const r = Math.min(w, d) / 2;
        const n = this.detailed ? 16 : 10;
        const half = Math.PI / n;
        for (const [a0, a1, h] of [
          [0.76, 1, 0.4],
          [0.54, 0.76, 0.8],
          [0, 0.54, 1.25],
        ] as const) {
          const rIn = a0 * r * Math.cos(half);
          const rOut = a1 * r;
          for (let k = 0; k < n; k++) {
            const t = ((k + 0.5) / n) * Math.PI * 2;
            const mid = (rIn + rOut) / 2;
            const p = toWorld(this.f, u + Math.cos(t) * mid, v + Math.sin(t) * mid);
            this.farm.add('box', mat, new Vector3(p.x, FY + h / 2, p.z), new Vector3(rOut - rIn, h, 2 * rOut * Math.sin(half) + 0.03), this.yaw(Math.cos(t), Math.sin(t)));
          }
        }
        this.box(m.soil, u, v, r * 0.95, 0.02, r * 0.95, FY + 1.25);
        for (let k = 0; k < 5; k++) {
          const t = (k / 5) * Math.PI * 2 + 0.4;
          const p = toWorld(this.f, u + Math.cos(t) * r * 0.36, v + Math.sin(t) * r * 0.36);
          this.nature.shrub(p.x, p.z, this.rng.range(0.4, 0.55), FY + 1.25);
        }
        // Arbolito de flores rosadas, casi sin hojas: dos tallos finos y
        // matas chicas de flor (la pintura rosa, sin material propio).
        const bark = this.mats.surface(PALETTE.barkLight, 0.95, 0, 'timber');
        this.cyl(bark, u + 0.03, v, 0.06, 1.5, FY + 1.25);
        this.cyl(bark, u - 0.04, v + 0.02, 0.05, 1.3, FY + 1.25);
        const top = toWorld(this.f, u, v);
        for (const [dx, dy, dz] of [
          [0.15, 2.55, 0.05],
          [-0.2, 2.35, -0.1],
          [0.05, 2.75, -0.15],
        ] as const) {
          this.farm.add('blob', m.pinkWall, new Vector3(top.x + dx, FY + dy, top.z + dz), new Vector3(0.45, 0.35, 0.45));
        }
        break;
      }
      case 'cafeTable': {
        // Mesa del patio nuevo: pie central rojo con cruz y tapa de madera
        // rojiza; con `chess`, un damero de azulejos (en 2026 lo tienen las
        // del patio de las gradas; las del tramo largo son lisas). Las bajas
        // llevan sillas plásticas negras (`roundChairAngles`), las altas son
        // de pie.
        const hgt = (it.h ?? FURNITURE.tableTop) - 0.05;
        this.box(this.mat(it.color, m.timberDark), u, v, w, 0.05, d, FY + hgt);
        this.box(m.red, u, v, 0.09, hgt, 0.09, FY);
        this.box(m.red, u, v, w * 0.7, 0.04, 0.07, FY);
        this.box(m.red, u, v, 0.07, 0.04, d * 0.7, FY);
        if (it.chess && this.detailed) {
          const c = 0.11;
          this.box(m.frame, u, v, 4 * c + 0.02, 0.004, 4 * c + 0.02, FY + hgt + 0.05);
          for (let a = 0; a < 4; a++) {
            for (let b = 0; b < 4; b++) {
              if ((a + b) % 2 === 0) this.box(m.navy, u + (a - 1.5) * c, v + (b - 1.5) * c, c, 0.003, c, FY + hgt + 0.054);
            }
          }
        }
        if (it.h !== undefined) break;
        for (const a of roundChairAngles(it)) {
          this.chair(m.metalDark, u + Math.cos(a) * (w / 2 + FURNITURE.roundChair), v + Math.sin(a) * (w / 2 + FURNITURE.roundChair), [-Math.cos(a), -Math.sin(a)]);
        }
        break;
      }
      case 'boxBench': {
        // Chapa plegada en U, pintada (rojo o azul): tapa y dos laterales.
        const mat = this.mat(it.color, m.red);
        const h = it.h ?? 0.46;
        this.box(mat, u, v, w, 0.04, d, FY + h - 0.04);
        for (const s of [-1, 1]) {
          if (w >= d) this.box(mat, u + s * (w / 2 - 0.02), v, 0.04, h - 0.04, d, FY);
          else this.box(mat, u, v + s * (d / 2 - 0.02), w, h - 0.04, 0.04, FY);
        }
        break;
      }
      case 'pot': {
        this.cyl(m.frame, u, v, w, 0.55, FY, true);
        this.cyl(m.soil, u, v, w - 0.06, 0.02, FY + 0.53);
        const p = toWorld(this.f, u, v);
        // Las macetas chicas (0,45 m) llevan una planta chica.
        this.nature.shrub(p.x, p.z, w < 0.5 ? this.rng.range(0.3, 0.38) : this.rng.range(0.5, 0.7), FY + 0.55);
        break;
      }
      case 'bunting': {
        // Guirnalda de banderines (papel picado del video 2026) de muro a
        // muro: cordón y banderines de colores; en VR, la mitad.
        const y = FY + (it.y ?? 3.1);
        this.piece(m.metalDark, [u - w / 2, v], [u + w / 2, v], 0.01, y - 0.01, y);
        // Papel picado pastel, banderines chicos casi pegados (video 2026).
        const cols = [m.pinkWall, m.skyWall, m.yellow, m.orange, m.lilac, m.frame];
        const step = this.detailed ? 0.18 : 0.36;
        const n = Math.floor(w / step);
        for (let k = 0; k < n; k++) {
          const fu = u - w / 2 + (k + 0.5) * (w / n);
          // Cuelga un poco más en el medio (catenaria baja).
          const sag = 0.25 * (1 - ((2 * (k + 0.5)) / n - 1) ** 2);
          this.box(cols[k % cols.length], fu, v, 0.15, 0.18, 0.008, y - 0.19 - sag);
        }
        break;
      }
      case 'bareTree': {
        // Árbol pelado de invierno: tronco y cinco ramas abiertas (2:01–2:13),
        // cada una en dos tramos que se afinan y se bifurcan. Antes eran cinco
        // varas rectas desde un mismo nudo: se leía como un perchero.
        this.box(m.soil, u, v, 1.1, 0.04, 1.1, FY);
        this.cyl(m.timberDark, u, v, 0.16, 2.6, FY);
        const p = toWorld(this.f, u, v);
        // Tramo de rama desde `s`: giro `a`, inclinación `lean` (+Y va a `d`).
        const limb = (s: Vector3, a: number, lean: number, len: number, th: number): Vector3 => {
          const d = new Vector3(Math.sin(a) * Math.sin(lean), Math.cos(lean), Math.cos(a) * Math.sin(lean));
          this.farm.add('box', m.timberDark, s.add(d.scale(len / 2)), new Vector3(th, len, th), a, lean);
          return s.add(d.scale(len * 0.95));
        };
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.4;
          const lean = 0.5 + 0.15 * (k % 2);
          const side = k % 2 ? 1 : -1;
          const mid = limb(new Vector3(p.x, FY + 1.9 + 0.15 * k, p.z), a, lean, 1.1, 0.075);
          limb(mid, a + side * 0.25, lean - 0.2, 0.9, 0.045);
          limb(mid, a - side * 0.7, lean + 0.35, 0.6, 0.035);
        }
        break;
      }
      case 'slimTree': {
        const ph = it.h ?? 3.4;
        const bark = this.mats.surface(PALETTE.barkLight, 0.95, 0, 'timber');
        if (w >= 0.4) {
          // Palmera de tronco grueso y peludo contra el salón (video 2026,
          // 0:07): el tronco sale de cuadro; arriba, un penacho corto de hojas
          // paradas (con las frondas largas de `palm` se metían en el salón).
          this.cyl(bark, u, v, 0.45, ph, FY);
          const frond = this.mats.foliage(PALETTE.leafMid);
          const p = toWorld(this.f, u, v);
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2;
            this.farm.add('box', frond, new Vector3(p.x + Math.sin(a) * 0.25, FY + ph + 0.2, p.z + Math.cos(a) * 0.25), new Vector3(0.3, 0.05, 0.9), a, -0.7);
          }
          break;
        }
        // Arbolito de pocos troncos finos (video 2026): dos tallos de corteza
        // gris oliva y una copa chica arriba, en su cazuela.
        for (const [du, dv, k] of [
          [0.04, 0.03, 1],
          [-0.05, -0.02, 0.9],
        ] as const) {
          this.cyl(bark, u + du, v + dv, 0.07, ph * k, FY);
        }
        const p = toWorld(this.f, u, v);
        this.farm.add('blob', this.mats.foliage(PALETTE.leafMid), new Vector3(p.x, FY + ph - 0.1, p.z), new Vector3(1.0, 0.9, 1.0));
        break;
      }
      case 'hedge': {
        // Del tamaño del ítem (que es macizo): con un arbusto genérico de
        // 1,6–3,5 m de ancho la gente lo atravesaba. Los vecinos se pisan
        // 15 cm y forman un cerco continuo de 1,25 m.
        const p = toWorld(this.f, u, v);
        this.farm.add('blob', this.mats.foliage(PALETTE.leafMid), new Vector3(p.x, FY + 0.6, p.z), new Vector3(w + 0.15, 1.3, d + 0.1));
        break;
      }
      case 'condenser': {
        // Unidad exterior blanca con la rejilla del ventilador y su ménsula.
        const y = FY + (it.y ?? 3.6);
        const [nu, nv] = faceDir(it.face);
        this.box(m.frame, u, v, alongV ? 0.3 : 0.8, 0.55, alongV ? 0.8 : 0.3, y);
        this.cyl(m.metalDark, u + nu * 0.16 + (alongV ? 0 : 0.12), v + nv * 0.16 + (alongV ? 0.12 : 0), 0.38, 0.03, y + 0.27, true);
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
    // Patas y parantes: postes (cajas sin base). Apoyan en el piso o nacen
    // dentro del asiento, así que esa cara no se ve; con ~1.500 patas en la
    // escuela son 3 mil triángulos menos en cada vista.
    const post = (ahead: number, side: number, w: number, h: number, y: number) => {
      const p = toWorld(this.f, u + fu * ahead + su * side, v + fv * ahead + sv * side);
      this.farm.add('post', this.m.metalDark, new Vector3(p.x, y + h / 2, p.z), new Vector3(w, h, w), rot);
    };
    // Asiento a `FURNITURE.seat` (la gente se sienta a esa altura).
    const legs = (FURNITURE.seat - 0.04) * s;
    part(mat, 0, 0, 0.42 * s, 0.04 * s, 0.42 * s, FY + legs);
    if (!this.detailed) {
      part(mat, -0.2 * s, 0, 0.42 * s, 0.36 * s, 0.025, FY + legs + 0.06 * s);
      // Cuatro patas, un poco más gruesas que las de escritorio para que no
      // titilen en el visor. Un pie central macizo se leía como un cajón
      // bajo cada silla. Las de atrás siguen hasta el respaldo (hacen de
      // parantes): sin ellas el respaldo flotaba sobre el asiento.
      for (const b of [-1, 1]) {
        post(0.18 * s, b * 0.18 * s, 0.03, legs, FY);
        post(-0.18 * s, b * 0.18 * s, 0.03, legs + 0.36 * s, FY);
      }
      return;
    }
    // Respaldo curvo separado del asiento (como el de las sillas reales).
    part(mat, -0.2 * s, 0, 0.42 * s, 0.22 * s, 0.025, FY + legs + 0.18 * s);
    const leg = 0.022;
    const k = 0.18 * s;
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) post(a * k, b * k, leg, legs, FY);
    }
    // Parantes del respaldo: del asiento a 1 cm del borde superior (con la
    // punta en el plano del borde, el canto del respaldo titilaba).
    for (const t of [-1, 1]) post(-0.2 * s * 0.92, t * k, leg, 0.37 * s, FY + legs + 0.02 * s);
  }

  /** Tubos fluorescentes en todos los ambientes cubiertos. */
  private lights(): void {
    for (const r of ROOMS) {
      if (!r.roofed || r.id === 'gimnasio' || r.id === 'nicho') continue;
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
      // Huecos de escalera del piso de arriba: ahí no hay cielorraso. Una
      // luminaria con el centro en el hueco no va; si sólo lo roza, se corre
      // 10 cm afuera por el lado más corto (antes flotaban sobre los tramos).
      const above = roomLevel(r) < 2 ? voidsAt((roomLevel(r) + 1) as 1 | 2) : [];
      const half: [number, number] = kind === 'panel' ? [0.3, 0.3] : kind === 'dome' ? [0.17, 0.17] : long ? [0.6, 0.08] : [0.08, 0.6];
      const clear = (u: number, v: number): [number, number] | null => {
        for (const h of above) {
          const ou = Math.min(u + half[0], h.u1) - Math.max(u - half[0], h.u0);
          const ov = Math.min(v + half[1], h.v1) - Math.max(v - half[1], h.v0);
          if (ou <= 0 || ov <= 0) continue;
          if (u > h.u0 && u < h.u1 && v > h.v0 && v < h.v1) return null;
          const du = (u < (h.u0 + h.u1) / 2 ? -1 : 1) * (ou + 0.1);
          const dv = (v < (h.v0 + h.v1) / 2 ? -1 : 1) * (ov + 0.1);
          if (Math.abs(du) <= Math.abs(dv)) u += du;
          else v += dv;
        }
        return inPoly(r.poly, u, v) ? [u, v] : null;
      };
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const at = clear(u0 + ((i + 0.5) * (u1 - u0)) / nu, v0 + ((j + 0.5) * (v1 - v0)) / nv);
          if (!at) continue;
          const [u, v] = at;
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
    // Centrado en el frente del hall del CAD (antes, en el del plano de S&O).
    const { u0, u1 } = PORTAL;
    const uc = (u0 + u1) / 2;
    const w = u1 - u0;
    // El portal sobresale ~0,85 m de la fachada y sube a ~8,2 m (0:09–0:16).
    // Arriba es un marco gris grafito que deja ver las tres ventanas enrejadas
    // del primer piso (la Secretaría y 6° BD), con su retiro hasta el muro.
    const front = PORTAL.front;
    const depth = 0.2;
    const vf = front - depth / 2;
    const y0 = 4.0;
    const top = 8.2;
    // Las tres ventanas del primer piso que enmarca: las del muro del primer
    // piso (SchoolUpper), así el recorte del paño siempre coincide con ellas.
    const wins = PORTAL_WINDOWS;
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
    // Terminan en la cara trasera del paño grafito: hasta el frente, sus
    // caras compartían el plano del paño y titilaban en la primera vista.
    for (const u of [u0 + 0.1, u1 - 0.1]) this.box(m.facade, u, (front - depth) / 2, 0.2, top - y0, front - depth, y0);
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
    this.box(m.red, uc, front - 0.15, 8.25, 1.4, 0.3, 2.45);
    // Banda roja del primer piso del edificio de bloque, al este del portal (0:15).
    this.box(m.red, (U.salonW + U.gymW) / 2, 0.17, U.gymW - U.salonW, 0.6, 0.04, 3.05);
    // Planta baja: dos pilares revestidos en granito y tres columnas azul
    // marino, con la reja de malla cuadrada de toda la altura (2020) y su
    // portón abierto frente a las puertas.
    // Pilares, columnas y reja salen de SchoolLayout (la colisión usa las
    // mismas medidas).
    const { g0, g1, gate0, gate1 } = PORTAL;
    const span = (r: { u0: number; v0: number; u1: number; v1: number }) => [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2, r.u1 - r.u0, r.v1 - r.v0] as const;
    for (const r of PORTAL_PILLARS) {
      const [cu, cv, wu, dv] = span(r);
      this.box(m.stone, cu, cv, wu, 2.45, dv, 0);
    }
    // Columnas azul marino: a los costados del portón y en su medio, frente
    // al centro de la entrada (0:16), y la tercera junto al pilar del este.
    for (const r of PORTAL_COLUMNS) {
      const [cu, cv, wu, dv] = span(r);
      this.box(m.navy, cu, cv, wu, 2.45, dv, 0.12);
    }
    // (En el visor, un barrote de cada dos, como el cerco.)
    for (let u = g0 + 0.85; u < g1 - 0.8; u += this.detailed ? 0.15 : 0.3) {
      if (u > gate0 && u < gate1) continue;
      this.box(m.bars, u, PORTAL_RAIL_V, 0.02, 2.3, 0.02, 0.12);
    }
    for (const y of [0.2, 1.3, 2.38]) {
      for (const [a, b] of PORTAL_RAILS) this.box(m.bars, (a[0] + b[0]) / 2, PORTAL_RAIL_V, b[0] - a[0], 0.03, 0.02, y);
    }
    // Escalinata de tres huellas hasta el nivel del vestíbulo, entre los pilares.
    const s0 = g0 + 0.8;
    const s1 = g1 - 0.8;
    for (const [v0, v1, h] of [
      [1.4, 2.0, 0.08],
      [0.8, 1.4, 0.1],
      [0, 0.8, FY],
    ] as const) {
      this.box(m.slab, (s0 + s1) / 2, (v0 + v1) / 2, s1 - s0, h, v1 - v0, 0);
    }
    // Mástil inclinado con la bandera, a la izquierda del portal.
    const p = toWorld(this.f, u0 - 0.2, 1.1);
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
    // Posiciones del plano (`planU`); los paños que van de muro a muro
    // (marquesina, antepecho, pretil) se agrandan con la fachada, las
    // piezas de medida (banda, pilar, columna de borde) no.
    this.box(m.navy, planU(58.525), v, 1.75, 8.9, 0.1, 0);
    this.box(m.red, planU(63.3), V.top - 0.55, 8.2 * SC, 0.9, 0.8, 2.75);
    this.box(m.slab, planU(63.3), V.top - 0.55, 8.2 * SC, 0.04, 0.8, 2.71);
    this.box(m.red, planU(62.3), v + 0.15, 0.4, 1.3, 0.08, H + 0.95);
    this.box(m.jardinRed, planU(63.2), V.top - 0.2, 7.6 * SC, 1.9, 0.1, 5.6);
    this.box(m.facade, planU(62.525), V.top - 0.18, 9.75 * SC, 1.0, 0.06, 8.9);
    this.box(m.facade, U.e - 0.2, v, 0.4, 9.9, 0.12, 0);
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
      if (r.u0 > planU(42) && r.u0 < planU(43)) {
        // Cantero del edificio de bloque: matas de pasto ornamental seco, no
        // arbustos (0:09–0:16). Hojas finas abiertas en abanico.
        for (const u of [43.2, 44.6, 46.0, 47.4, 48.8].map(planU)) {
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
      this.palm(planU(u), planV(v), h);
    }
    // Árbol de hoja ancha frente al edificio de bloque (0:12).
    const tree = toWorld(this.f, planU(47.0), planV(3.0));
    this.nature.broadleaf(tree.x, tree.z, 0.8, 0.06);
    // Cartel de salida de emergencia sobre la salida del ochavo, en el
    // testero del pasillo sur y 5 mm afuera de su cara.
    const exitMid = (V.classTop + V.jogN) / 2;
    this.piece(m.exitSign, [U.jog, exitMid + 0.2], [U.jog, exitMid - 0.2], 0.05, 2.45, 2.67, -(SCHOOL.extT / 2 + 0.03));
    // Poste de los carteles de calle (Laprida y Miguel Cané) y del punto de
    // encuentro; las chapas las pinta SchoolIdentity.
    this.cyl(m.metalDark, planU(-6.3), planV(3.3), 0.07, 3.35, 0);
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
    // Hacia el patio de aire del primer piso: pasillo de lockers (sur), ala
    // oeste y fila norte, hasta la galería.
    const parapet = 2 * H + 0.55;
    for (let u = U.patioW + 0.3; u < U1.gallery; u += 0.86) tooth(u, V.corrS - 0.05, parapet, true);
    for (let u = U.patioW + 0.3; u < U1.gallery; u += 0.86) tooth(u, V.nBlockS + 0.05, parapet, true);
    for (let v = V.corrS - 0.3; v > V.nBlockS; v -= 0.86) tooth(U.patioW + 0.05, v, parapet, false);
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
      // En el visor, un barrote de cada dos: son ~300 cajas que, como la
      // granja no descarta instancias sueltas, se pagaban en todas las vistas.
      const n = Math.floor(len / (this.detailed ? 0.16 : 0.32));
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
    const poles = [-4, 12.1, 20, 44, 66].map(planU);
    // La cruceta va de través a la línea (antes era paralela a los cables).
    for (const u of poles) {
      this.cyl(m.slab, u, poleV, 0.22, 9.6, 0);
      this.box(m.slab, u, poleV, 0.1, 0.1, 1.4, 8.5);
    }
    // Cables en catenaria: tramos rectos inclinados que se tocan punta con
    // punta (antes, cajas horizontales escalonadas hasta 13 cm). El de arriba
    // sale de la cabeza del poste; los dos de abajo, de las puntas de la
    // cruceta, a cada lado de la línea.
    const segs = this.detailed ? 12 : 8;
    for (let i = 0; i < poles.length - 1; i++) {
      const u0 = poles[i];
      const u1 = poles[i + 1];
      for (const [y, off] of [
        [9.5, 0],
        [8.62, 0.6],
        [8.62, -0.6],
      ] as const) {
        const at = (t: number): Vector3 => {
          const p = toWorld(this.f, u0 + (u1 - u0) * t, poleV + off);
          return new Vector3(p.x, y - 0.35 * (1 - (2 * t - 1) ** 2), p.z);
        };
        for (let k = 0; k < segs; k++) {
          const a = at(k / segs);
          const b = at((k + 1) / segs);
          // rotZ lleva +X a (cos, sin): el eje largo sigue al tramo.
          this.farm.add('box', m.bars, a.add(b).scaleInPlace(0.5), new Vector3(Vector3.Distance(a, b) + 0.01, 0.025, 0.025), 0, 0, Math.atan2(b.y - a.y, b.x - a.x));
        }
      }
    }
  }
}
