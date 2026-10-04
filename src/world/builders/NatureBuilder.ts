import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import { Rng } from '../../utils/rng';
import { LEAF_TONES, PALETTE } from '../Palette';

/**
 * Vegetación.
 *
 * En una ciudad solarpunk el verde no es relleno: es infraestructura. Sombra,
 * temperatura, agua, aire. Así que la vegetación se genera con la misma
 * atención que los edificios.
 *
 * Truco visual importante: cada copa se arma con 2-3 esferas de tonos de verde
 * DISTINTOS y desplazadas entre sí. Un solo verde plano se lee inmediatamente
 * como falso; la variación tonal es lo que hace que un cono de 12 triángulos
 * pase por un árbol.
 */
export class NatureBuilder {
  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly rng: Rng,
    /** Copas de 80 triángulos para los árboles grandes. Se apaga en VR. */
    private readonly highDetail = true,
  ) {}

  /**
   * Árbol de hoja ancha, de una especie de las veredas y patios porteños.
   *
   * La especie (plátano, fresno, tipa, jacarandá o palo borracho) sale de la
   * POSICIÓN del árbol, no del azar compartido: así el visor y el escritorio
   * plantan la misma especie en el mismo lugar, y el generador común de la
   * ciudad consume exactamente los mismos números que antes (ver
   * `legacyDraws`): agregar especies no corre ni una ventana ni un cartel
   * del resto del barrio.
   *
   * Cada especie tiene su porte (la variedad de PORTE importa más que la de
   * color: con todos iguales la calle era una fila de chupetines), su
   * corteza y sus tonos. El jacarandá y el palo borracho llevan flores
   * (lila y rosa) con hojas que asoman entre ellas (el color secundario del
   * material, ver WindPlugin). Las flores reemplazan masas verdes en vez de
   * sumarlas: mismo costo en triángulos.
   */
  broadleaf(x: number, z: number, scale = 1, groundY = 0): void {
    this.legacyDraws(scale);
    const r = localRng(x, z, 0x7a1b);
    const sp = pickSpecies(r);
    const shape = SPECIES[sp];

    const height = r.range(shape.h[0], shape.h[1]) * scale;
    const trunkH = height * r.range(shape.trunk[0], shape.trunk[1]);
    const trunkR = height * r.range(0.022, 0.03) * (sp === 'paloBorracho' ? 1.15 : 1);
    // Tope del radio de copa: el de la versión anterior (copa ancha de 7,5 m
    // por 0,5). Los patios de la escuela se verificaron con ese alcance.
    const crownR = Math.min(height * r.range(shape.crown[0], shape.crown[1]), 3.6 * scale);
    const squash = r.range(shape.squash[0], shape.squash[1]);
    const trunkMat = this.bark(shape.bark);

    // Tronco, con una leve inclinación: ningún árbol real es una plomada (el
    // jacarandá, de tronco torcido, más).
    const leanMax = sp === 'jacaranda' ? 0.1 : 0.05;
    const lean = r.range(-leanMax, leanMax);
    const tilt = r.range(-leanMax, leanMax);
    this.farm.add(
      'cylinder',
      trunkMat,
      new Vector3(x, groundY + trunkH / 2, z),
      new Vector3(trunkR * 2, trunkH, trunkR * 1.9),
      0,
      lean,
      tilt,
    );
    if (sp === 'paloBorracho') {
      // Tronco en botella: la panza ocupa los dos tercios de abajo. Es lo
      // que lo identifica de lejos, antes que las flores.
      const bellyH = trunkH * 0.62;
      this.farm.add(
        'cylinder',
        trunkMat,
        new Vector3(x, groundY + bellyH * 0.5, z),
        new Vector3(trunkR * 4.4, bellyH, trunkR * 4.2),
        r.range(0, Math.PI),
        lean * 0.5,
        tilt * 0.5,
      );
    }

    // Ramas principales: el tronco se abre en dos o tres brazos que se meten
    // en la copa. Sin ellas la copa "flota" sobre un palo, que es lo que hace
    // que un árbol low-poly parezca un chupetín. Fuera de VR solamente: son
    // dos cilindros más por árbol.
    if (this.highDetail) {
      const limbs = height > 9.5 || sp === 'tipa' ? 3 : 2;
      const yaw0 = r.range(0, Math.PI * 2);
      for (let i = 0; i < limbs; i++) {
        const yaw = yaw0 + (i / limbs) * Math.PI * 2 + r.range(-0.4, 0.4);
        // La tipa abre los brazos casi horizontales (copa en sombrilla).
        const lt = sp === 'tipa' ? r.range(0.7, 0.95) : r.range(0.45, 0.75);
        const len = crownR * r.range(0.75, 1.05);
        const baseY = groundY + trunkH * r.range(0.78, 0.95);
        // Rotar Z por −lt y luego Y por yaw lleva el eje del cilindro a
        // (sin t·cos y, cos t, −sin t·sin y).
        const dx = Math.sin(lt) * Math.cos(yaw);
        const dy = Math.cos(lt);
        const dz = -Math.sin(lt) * Math.sin(yaw);
        this.farm.add(
          'cylinder',
          trunkMat,
          new Vector3(x + (dx * len) / 2, baseY + (dy * len) / 2, z + (dz * len) / 2),
          new Vector3(trunkR * 1.15, len, trunkR * 1.15),
          yaw,
          0,
          -lt,
        );
      }
    }

    // Copa hecha de VARIAS masas chicas en vez de una o dos grandes: un
    // racimo de masas desplazadas y de tonos distintos produce una silueta
    // irregular, que es lo que el ojo reconoce como follaje. `height` YA
    // incluye `scale` (no aplicarla dos veces al decidir si es grande).
    const big = height > 9.5;
    // En VR el follaje de alto detalle se desactiva: la piel del shader
    // (racimos, panza oscura, tinte por árbol, ver WindPlugin) da la variedad.
    const prim = big && this.highDetail ? 'blobHi' : 'blob';
    // Tres masas como mínimo: con dos, la principal dominaba y la copa era
    // un elipsoide liso sobre un palo (un hongo, en el visor).
    const blobs = this.highDetail ? (big ? r.int(4, 5) : r.int(3, 4)) : big ? 4 : 3;
    const leaf = this.mats.foliage(r.pick(shape.tones));
    const flower = shape.flower ? this.flowerMat(shape.flower) : null;
    const a0 = r.range(0, Math.PI * 2);

    for (let i = 0; i < blobs; i++) {
      // La primera masa es la principal; las demás la acompañan más chicas,
      // repartidas alrededor (al azar puro se amontonaban de un lado).
      const main = i === 0;
      const rad = crownR * (main ? r.range(0.78, 0.92) : r.range(0.55, 0.8));
      const ang = a0 + (i / Math.max(1, blobs - 1)) * Math.PI * 2 + r.range(-0.5, 0.5);
      const dist = main ? crownR * r.range(0, 0.15) : crownR * shape.spread * r.range(0.7, 1);
      const rise = main ? r.range(0.45, 0.7) : sp === 'tipa' ? r.range(0.3, 0.6) : r.range(0.25, 0.95);
      const mat =
        flower && (main || r.chance(shape.flowerFrac)) ? flower : main ? leaf : this.mats.foliage(r.pick(shape.tones));
      this.farm.add(
        prim,
        mat,
        new Vector3(x + Math.cos(ang) * dist, groundY + trunkH + crownR * squash * rise, z + Math.sin(ang) * dist),
        new Vector3(rad * 2, rad * 2 * squash * 0.72, rad * 2 * r.range(0.85, 1.15)),
        // Rotación al azar: sin esto todas las facetas se alinean y la calle
        // entera muestra el mismo polígono en la misma orientación.
        r.range(0, Math.PI * 2),
        r.range(-0.3, 0.3),
        r.range(-0.3, 0.3),
      );
    }
  }

  /**
   * Un árbol que no se planta pero consume del generador compartido lo mismo
   * que `broadleaf`: así un perfil puede omitir árboles que no se ven (el
   * visor, en los patios cerrados de las manzanas) sin correr el azar del
   * resto del barrio (HANDOFF 42).
   */
  skipBroadleaf(scale = 1): void {
    this.legacyDraws(scale);
  }

  /**
   * Los números que la versión anterior de `broadleaf` sacaba del generador
   * COMPARTIDO de la ciudad, en el mismo orden y cantidad (los valores se
   * descartan). Todos los constructores comparten ese generador: si un árbol
   * consumiera otra cantidad, cambiarían los carteles, los balcones y los
   * árboles siguientes de todo el barrio, y lo que otros ya ajustaron se
   * movería. La forma del árbol sale ahora de `localRng` (su posición).
   */
  private legacyDraws(scale: number): void {
    const g = this.rng;
    const form = g.next();
    const height = (form < 0.3 ? g.range(5, 7.5) : form < 0.78 ? g.range(6, 9) : g.range(8, 12)) * scale;
    // Proporciones de tronco y copa, aplastado, radio, corteza, inclinación
    // y giro del tronco.
    for (let i = 0; i < 7; i++) g.next();
    if (this.highDetail) {
      g.next();
      for (let i = 0, n = (height > 9.5 ? 3 : 2) * 4; i < n; i++) g.next();
    }
    const blobs = height > 9.5 ? g.int(3, 5) : g.int(2, 3);
    for (let i = 0; i < blobs * 9; i++) g.next();
  }

  /** Corteza de tronco (grano irregular, UV propia del cilindro). */
  private bark(color: Color3): Material {
    return this.mats.surface(
      color,
      0.95,
      0,
      // Grano irregular, no la veta con nudos de la madera laminada: con esa
      // textura los troncos parecían postes de obra.
      'concrete',
      // Fuera de la escala métrica: a tamaño real, el hormigón trae sus juntas
      // de encofrado cada 60 cm, que en un tronco se leían como anillos de
      // caño. Con la UV del cilindro queda la corteza de grano fino de antes.
      { metric: false },
    );
  }

  /** Flores con hojas entre ellas (el verde asoma en los huecos de los racimos). */
  private flowerMat(color: Color3): Material {
    // Mezcla baja: el verde se multiplica en gamma y el paso a lineal lo
    // estira; con 0,32 la copa florida se veía manchada, no salpicada.
    return this.mats.foliage(color, PALETTE.leafBright, 0.15);
  }

  /**
   * Conífera: ciprés columnar (el de las plazas y los fondos porteños). Antes
   * eran dos conos de seis caras, que de cerca se leían como un arbolito de
   * Navidad de papel; dos masas abolladas alargadas tienen silueta de follaje
   * y se mecen como el resto. Mismos números del generador compartido.
   */
  conifer(x: number, z: number, scale = 1, groundY = 0): void {
    const height = this.rng.range(7, 12) * scale;
    const trunkH = height * 0.2;
    this.farm.add(
      'cylinder',
      this.bark(PALETTE.bark),
      new Vector3(x, groundY + trunkH / 2, z),
      new Vector3(height * 0.05, trunkH, height * 0.05),
    );
    const coneH = height - trunkH;
    const r = height * (this.rng.range(0.15, 0.2) - 0.04);
    const leaf = this.mats.foliage(this.rng.pick([PALETTE.leafDeep, PALETTE.moss, PALETTE.leafMid]));
    const lowH = coneH * 0.68;
    this.farm.add(
      'blob',
      leaf,
      new Vector3(x, groundY + trunkH * 0.7 + lowH / 2, z),
      new Vector3(r * 2, lowH, r * 2),
      this.rng.range(0, Math.PI),
    );
    const topH = coneH * 0.6;
    this.farm.add(
      'blob',
      leaf,
      new Vector3(x, groundY + height - topH / 2, z),
      new Vector3(r * 1.45, topH, r * 1.45),
      this.rng.range(0, Math.PI),
    );
  }

  /**
   * Arbusto bajo: rellena bordes y jardineras a costo casi nulo. Uno de cada
   * cinco florece (azalea rosa u hortensia lila, sorteado por su posición):
   * los canteros porteños nunca son sólo verdes.
   */
  shrub(x: number, z: number, scale = 1, groundY = 0): void {
    this.shrubAt(x, z, scale, groundY, true);
  }

  /**
   * `emit = false` consume los mismos números del generador compartido sin
   * dibujar nada (jardineras raleadas en el visor, ver `planter`).
   */
  private shrubAt(x: number, z: number, scale: number, groundY: number, emit: boolean): void {
    const g = this.rng;
    const r = g.range(0.5, 1.1) * scale;
    const tone = g.pick(LEAF_TONES);
    const sy = g.range(0.9, 1.3);
    const sz = g.range(0.8, 1.2);
    const ry = g.range(0, Math.PI * 2);
    const rx = g.range(-0.25, 0.25);
    const rz = g.range(-0.25, 0.25);
    if (!emit) return;
    const bloom = localRng(x, z + groundY, 0x3c5d).next();
    const mat =
      bloom < 0.12
        ? this.flowerMat(PALETTE.blossomPink)
        : bloom < 0.2
          ? this.flowerMat(PALETTE.jacaranda)
          : this.mats.foliage(tone);
    this.farm.add('blob', mat, new Vector3(x, groundY + r * 0.5, z), new Vector3(r * 2, r * sy, r * 2 * sz), ry, rx, rz);
  }

  /**
   * Jardinera: cajón de hormigón u obra con vegetación desbordando.
   * Es el elemento que más "solarpunk" hace ver a un edificio.
   */
  planter(
    x: number,
    z: number,
    width: number,
    depth: number,
    y: number,
    density = 1,
  ): void {
    const wallH = 0.55;
    this.farm.addBoxOnGround(
      this.mats.surface(PALETTE.concreteShade, 0.8),
      x,
      z,
      width,
      wallH,
      depth,
      y,
    );
    // Tierra apenas por debajo del borde.
    this.farm.addBoxOnGround(
      this.mats.surface(PALETTE.soil, 0.95),
      x,
      z,
      width * 0.92,
      wallH * 0.75,
      depth * 0.92,
      y,
    );

    const lr = localRng(x, z + y, 0x91a7);
    // Cantero bajo que cubre la tierra: flores (rosas o lilas, con hojas entre
    // ellas) o cubresuelo verde. Una caja chata de 12 triángulos que se lee
    // como plantas bajas, y de lejos como un cantero florido.
    const bed = lr.next();
    const bedMat =
      bed < 0.3
        ? this.flowerMat(PALETTE.blossomPink)
        : bed < 0.55
          ? this.flowerMat(PALETTE.jacaranda)
          : this.mats.foliage(PALETTE.leafBright);
    this.farm.add('box', bedMat, new Vector3(x, y + wallH * 0.75, z), new Vector3(width * 0.86, 0.16, depth * 0.86));

    const area = width * depth;
    // 0,09 y no 0,14: una jardinera de 30 x 3 m generaba 12 arbustos, de los
    // cuales la mitad quedaba tapada por los de adelante. Se ven los del borde;
    // los del fondo sólo cuestan triángulos.
    const count = Math.max(1, Math.round(area * 0.09 * density));
    // En el visor, las jardineras de terrazas y azoteas (por encima de la
    // vista desde la vereda) llevan menos de la mitad de los arbustos: el
    // cantero ya las cubre y eran ~500 copas de 80 triángulos que no se veían.
    const thin = !this.highDetail && y > 2.5;
    for (let i = 0; i < count; i++) {
      const px = x + this.rng.range(-width / 2 + 0.4, width / 2 - 0.4);
      const pz = z + this.rng.range(-depth / 2 + 0.4, depth / 2 - 0.4);
      const sc = this.rng.range(0.6, 1.2);
      this.shrubAt(px, pz, sc, y + wallH * 0.7, !thin || i === 0 || lr.chance(0.35));
    }
  }

  /**
   * Cortina vegetal colgante, para cantos de losa y jardines verticales.
   * Se apoya en un borde y cae: da esa textura de "edificio comido por plantas".
   * Una de cada cuatro es una santa rita florida (rosa), la enredadera de los
   * balcones y medianeras de Buenos Aires.
   */
  hangingVines(
    x: number,
    z: number,
    length: number,
    y: number,
    axis: 'x' | 'z',
    drop = 3,
  ): void {
    const santaRita = localRng(x, z + y, 0x5a17).chance(0.28);
    const steps = Math.max(2, Math.round(length / 1.6));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const px = axis === 'x' ? x - length / 2 + t * length : x;
      const pz = axis === 'z' ? z - length / 2 + t * length : z;
      const d = drop * this.rng.range(0.45, 1);
      const tone = this.rng.pick([PALETTE.leafMid, PALETTE.leafBright, PALETTE.moss]);
      this.farm.add(
        'box',
        santaRita && i % 3 !== 1 ? this.flowerMat(PALETTE.blossomPink) : this.mats.foliage(tone),
        new Vector3(px, y - d / 2, pz),
        new Vector3(this.rng.range(0.5, 1.1), d, this.rng.range(0.5, 1.1)),
      );
    }
  }

  /** Bosque urbano dentro de una manzana, con un claro central. */
  urbanForest(cx: number, cz: number, width: number, depth: number, density = 1): void {
    const count = Math.round(width * depth * 0.013 * density);
    for (let i = 0; i < count; i++) {
      // Distribución en anillo: deja un claro en el medio para poder caminar.
      const ang = this.rng.range(0, Math.PI * 2);
      const rad = Math.sqrt(this.rng.range(0.12, 1));
      const x = cx + Math.cos(ang) * rad * (width / 2 - 2);
      const z = cz + Math.sin(ang) * rad * (depth / 2 - 2);
      if (this.rng.chance(0.72)) this.broadleaf(x, z, this.rng.range(0.8, 1.25));
      else this.conifer(x, z, this.rng.range(0.8, 1.1));
    }
    // Sotobosque. Bajo a propósito: bajo la copa de un bosque urbano apenas se
    // distingue, y multiplicado por 17 parques por ciudad pesa de verdad.
    const shrubs = Math.round(count * 0.45);
    for (let i = 0; i < shrubs; i++) {
      this.shrub(
        cx + this.rng.range(-width / 2 + 1, width / 2 - 1),
        cz + this.rng.range(-depth / 2 + 1, depth / 2 - 1),
        this.rng.range(0.7, 1.4),
      );
    }
  }

  /** Césped / pradera de una manzana. */
  lawn(cx: number, cz: number, width: number, depth: number, y = 0.06): void {
    this.farm.add(
      'box',
      this.mats.grass(PALETTE.leafMid),
      new Vector3(cx, y / 2, cz),
      new Vector3(width, y, depth),
    );
  }
}

/** Especies de árbol de las veredas y patios porteños. */
type Species = 'platano' | 'fresno' | 'tipa' | 'jacaranda' | 'paloBorracho';

interface SpeciesShape {
  /** Alto total (m, antes de `scale`). */
  h: readonly [number, number];
  /** Fracción del alto que es tronco libre. */
  trunk: readonly [number, number];
  /** Radio de copa como fracción del alto. */
  crown: readonly [number, number];
  /** Aplastado vertical de las masas (< 1: copa en sombrilla). */
  squash: readonly [number, number];
  /** Qué tan lejos del centro van las masas secundarias (× radio de copa). */
  spread: number;
  tones: readonly Color3[];
  bark: Color3;
  /** Color de la flor (la masa principal y una fracción de las demás). */
  flower?: Color3;
  flowerFrac: number;
}

/**
 * Porte, corteza y follaje de cada especie. Los altos son los de un árbol
 * de vereda ya formado, algo menores que los reales (la escala del barrio
 * es la de las fachadas de dos a seis pisos).
 */
const SPECIES: Record<Species, SpeciesShape> = {
  // Plátano: el árbol de vereda más común de Buenos Aires. Copa grande y
  // redonda, corteza clara que se descascara en placas.
  platano: {
    h: [7.5, 11],
    trunk: [0.34, 0.42],
    crown: [0.3, 0.36],
    squash: [0.95, 1.15],
    spread: 0.75,
    tones: [PALETTE.leafMid, PALETTE.leafBright, PALETTE.moss],
    bark: PALETTE.barkLight,
    flowerFrac: 0,
  },
  // Fresno americano: copa ovalada, densa y de verde oscuro.
  fresno: {
    h: [6, 9],
    trunk: [0.36, 0.44],
    crown: [0.27, 0.33],
    squash: [1.15, 1.4],
    spread: 0.7,
    tones: [PALETTE.leafDeep, PALETTE.leafMid, PALETTE.moss],
    bark: PALETTE.bark,
    flowerFrac: 0,
  },
  // Tipa: tronco alto y copa en sombrilla, ancha y chata, de verde claro.
  tipa: {
    h: [6.5, 9],
    trunk: [0.42, 0.5],
    crown: [0.42, 0.5],
    squash: [0.78, 0.92],
    spread: 0.95,
    tones: [PALETTE.leafBright, PALETTE.leafPale, PALETTE.leafMid],
    bark: PALETTE.bark,
    flowerFrac: 0,
  },
  // Jacarandá: copa abierta e irregular, cubierta de flores lilas en
  // primavera.
  jacaranda: {
    h: [5.5, 8.5],
    trunk: [0.38, 0.46],
    crown: [0.36, 0.44],
    squash: [0.85, 1.0],
    spread: 0.85,
    tones: [PALETTE.leafBright, PALETTE.leafMid],
    bark: PALETTE.bark,
    flower: PALETTE.jacaranda,
    flowerFrac: 0.7,
  },
  // Palo borracho: tronco verde en botella y copa rala con flores rosas.
  paloBorracho: {
    h: [7, 10],
    trunk: [0.45, 0.52],
    crown: [0.26, 0.32],
    squash: [0.85, 1.05],
    spread: 0.75,
    tones: [PALETTE.leafMid, PALETTE.leafBright],
    bark: PALETTE.barkGreen,
    flower: PALETTE.blossomPink,
    flowerFrac: 0.4,
  },
};

/** Proporción de cada especie: el plátano y el fresno dominan las veredas. */
const SPECIES_WEIGHTS: readonly (readonly [Species, number])[] = [
  ['platano', 0.27],
  ['fresno', 0.23],
  ['tipa', 0.18],
  ['jacaranda', 0.2],
  ['paloBorracho', 0.12],
];

function pickSpecies(r: Rng): Species {
  let t = r.next();
  for (const [sp, w] of SPECIES_WEIGHTS) {
    if (t < w) return sp;
    t -= w;
  }
  return 'platano';
}

/**
 * Generador propio de una planta, sembrado con su posición (al centímetro).
 * Determinista e independiente del generador compartido: la misma planta
 * sale igual en el visor y en el escritorio, y lo que se sortea acá no corre
 * nada del resto de la ciudad.
 */
function localRng(x: number, z: number, salt: number): Rng {
  let h = (Math.imul(Math.round(x * 100), 0x27d4eb2d) ^ Math.imul(Math.round(z * 100), 0x165667b1) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return new Rng((h ^ (h >>> 16)) >>> 0);
}
