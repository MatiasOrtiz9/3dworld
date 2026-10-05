import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Materials } from '../../Materials';
import { PALETTE } from '../../Palette';
import { drawMirrorRoom } from '../../SchoolArt';

/**
 * Materiales y terminaciones de la escuela: la tabla de materiales por clave
 * (`SchoolKit.m`) y el estilo de cada ambiente (`STYLES`). Aparte del
 * constructor para que la paleta se toque en un solo lugar: los datos del
 * plano (`color`, `finish`, `ext`, `roofMat`…) nombran estas claves.
 */

const hex = (h: string) => Color3.FromHexString(h);

/**
 * Terminaciones de cada ambiente, tal como se ven en el recorrido de 2020.
 * Las claves de material son las de `schoolMaterials` (`SchoolKit.m`).
 */
export interface RoomStyle {
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

export const STYLES: Readonly<Record<string, RoomStyle>> = {
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

/** Materiales de la escuela por clave de uso (las que nombran los datos del plano). */
export type SchoolMats = Record<string, Material>;

/**
 * Arma la tabla de materiales. Se llama una sola vez, al crear el
 * constructor: los materiales se crean en el orden de siempre.
 */
export function schoolMaterials(mats: Materials): SchoolMats {
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
  const m: SchoolMats = {
    // Exterior: gris claro de la fachada real, zócalos y remates. La
    // fachada es revoque pintado (no hormigón con juntas de encofrado).
    facade: s('#d9d7d6', 0.9, 0, 'plaster', 'wall'),
    // Losas, plafones y bordes: revoque liso pintado (Escuela 2050, ítem
    // 13). Con el hormigón de encofrado, sus manchas de ±9 % se leían como
    // hollín bajo las galerías y en los cantos de las losas.
    slab: s('#d9dbd9', 0.85, 0, 'plaster'),
    // Chapa prepintada de junta alzada (ver TexturePainter.corrugated):
    // rugosidad 0,8 en todas las chapas. Con 0,55-0,6 el brillo del sol
    // corría por cada nervadura y titilaba con el menor movimiento.
    roof: s('#8a8e93', 0.8, 0.2, 'corrugated'),
    // Bóveda del polideportivo: junta alzada en grafito, sin la herrumbre
    // (ítem 16). El mismo tono que las albardillas y los marcos 2050.
    gymRoof: s('#45494f', 0.8, 0.22, 'corrugated'),
    jardinRoof: s('#a9bcc4', 0.8, 0.2, 'corrugated'),
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
    // La guarda de los pasillos es una guía de luz (Escuela 2050, ítem 18):
    // el rojo CIMDIP de siempre en un perfil satinado con luz propia suave,
    // que se lee encendido sin volverse cartel (lift 0,75: emisivo 0,6 ×
    // color, debajo del umbral del bloom).
    stripe: i('#b81e24', 'plaster', 0.75, 0.4),
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
    redSheet: s('#9a4f45', 0.8, 0.12, 'corrugated'),
    blueSheet: i('#3f4f96', 'corrugated', 0.12, 0.8),
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
    // Espejos (salón de los espejos y aula de danzas): plata pulida que
    // refleja una sala pintada (la pared de enfrente, parquet y luces
    // lineales; ver Materials.mirror y SchoolArt.drawMirrorRoom). Los de
    // marco de color y los sin marco comparten material: un draw call.
    mirrorGlass: mats.mirror(drawMirrorRoom),
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

  // Escuela 2050: claves nuevas, PEREZOSAS. El material se crea recién la
  // primera vez que alguien lo pide: definirlas no suma materiales, mallas
  // ni draw calls mientras ningún paquete las use.
  const lazy = (key: string, make: () => Material): void => {
    let made: Material | undefined;
    Object.defineProperty(m, key, { get: () => (made ??= make()), enumerable: true });
  };
  // Luz cálida lineal (≈ #ffc27a): LED de albardillas, alféizares, pasamanos
  // y canteros; también hace de "dorado del 40".
  lazy('ledWarm', () => mats.glow(hex('#ffc27a'), 0.9));
  // Grafito satinado: albardillas, marcos finos, columnas de luz y la
  // herrería que queda. Reemplaza al "hierro negro" (metálico ≤ 0,3).
  lazy('graphite', () => s('#3a3d42', 0.45, 0.25, 'plaster'));
  // Fotovoltaico azul noche: el MISMO material de las azoteas del barrio,
  // así no suma un draw call propio.
  lazy('solar', () => mats.solar());
  // Techo verde (sedum y césped) de los paños bajos. PBR y no `mats.grass`:
  // ese StandardMaterial en sombra total sale negro (auditoría 2050, ítem 14).
  lazy('greenRoof', () => s('#5f7d45', 0.95, 0, 'grass'));
  return m;
}
