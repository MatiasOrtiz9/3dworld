import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
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
   * Árbol de hoja ancha.
   *
   * Tres portes distintos, sorteados: copa ancha y baja (tipo tipa), copa
   * redonda estándar, y copa alta y angosta (tipo álamo joven). En la primera
   * versión todos los árboles eran una bola sobre un palo del mismo tamaño y
   * la calle se veía como una fila de chupetines: la variedad de PORTE importa
   * más que la variedad de color.
   */
  broadleaf(x: number, z: number, scale = 1, groundY = 0): void {
    const form = this.rng.next();
    let height: number;
    let trunkRatio: number;
    let crownRatio: number;
    let squash: number;

    if (form < 0.3) {
      // Copa ancha y baja: da sombra, buena para plazas.
      height = this.rng.range(5, 7.5) * scale;
      trunkRatio = this.rng.range(0.3, 0.38);
      crownRatio = this.rng.range(0.38, 0.5);
      squash = this.rng.range(0.85, 1.05);
    } else if (form < 0.78) {
      // Porte estándar.
      height = this.rng.range(6, 9) * scale;
      trunkRatio = this.rng.range(0.36, 0.46);
      crownRatio = this.rng.range(0.27, 0.36);
      squash = this.rng.range(1.15, 1.45);
    } else {
      // Alto y angosto: acompaña bien las fachadas altas.
      height = this.rng.range(8, 12) * scale;
      trunkRatio = this.rng.range(0.42, 0.52);
      crownRatio = this.rng.range(0.17, 0.24);
      squash = this.rng.range(1.7, 2.2);
    }

    const trunkH = height * trunkRatio;
    const trunkR = height * this.rng.range(0.022, 0.032);
    const trunkMat = this.mats.surface(
      this.rng.chance(0.5) ? PALETTE.bark : PALETTE.barkLight,
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

    // Tronco, con una leve inclinación: ningún árbol real es una plomada.
    const lean = this.rng.range(-0.05, 0.05);
    this.farm.add(
      'cylinder',
      trunkMat,
      new Vector3(x, groundY + trunkH / 2, z),
      new Vector3(trunkR * 2, trunkH, trunkR * 1.9),
      0,
      lean,
      this.rng.range(-0.05, 0.05),
    );

    const crownR = height * crownRatio;

    // Ramas principales: el tronco se abre en dos o tres brazos que se meten
    // en la copa. Sin ellas la copa "flota" sobre un palo, que es lo que hace
    // que un árbol low-poly parezca un chupetín. Fuera de VR solamente: son
    // dos cilindros más por árbol.
    if (this.highDetail) {
      const limbs = height > 9.5 ? 3 : 2;
      const yaw0 = this.rng.range(0, Math.PI * 2);
      for (let i = 0; i < limbs; i++) {
        const yaw = yaw0 + (i / limbs) * Math.PI * 2 + this.rng.range(-0.4, 0.4);
        const tilt = this.rng.range(0.45, 0.75);
        const len = crownR * this.rng.range(0.75, 1.05);
        const baseY = groundY + trunkH * this.rng.range(0.78, 0.95);
        // Rotar Z por −tilt y luego Y por yaw lleva el eje del cilindro a
        // (sin t·cos y, cos t, −sin t·sin y).
        const dx = Math.sin(tilt) * Math.cos(yaw);
        const dy = Math.cos(tilt);
        const dz = -Math.sin(tilt) * Math.sin(yaw);
        this.farm.add(
          'cylinder',
          trunkMat,
          new Vector3(x + (dx * len) / 2, baseY + (dy * len) / 2, z + (dz * len) / 2),
          new Vector3(trunkR * 1.15, len, trunkR * 1.15),
          yaw,
          0,
          -tilt,
        );
      }
    }
    // Copa hecha de VARIAS masas chicas en vez de una o dos grandes.
    //
    // Antes eran 1-2 esferas grandes y el resultado se leía como un caramelo
    // sobre un palo. Un racimo de 3-5 masas menores, desplazadas y de tonos
    // distintos, produce una silueta irregular — que es lo que el ojo reconoce
    // como follaje — por un coste de triángulos parecido.
    // `height` YA incluye `scale` (ver la selección de porte, más arriba).
    //
    // Acá había un bug que inflaba el presupuesto de la escena: el umbral era
    // `height * scale > 8`, o sea que aplicaba la escala DOS VECES. Con eso,
    // casi cualquier árbol de escala mayor a 1 calificaba como "grande" y
    // pagaba doble: copa de 80 triángulos en vez de 20, y 3-5 masas de follaje
    // en vez de 2-3. Con el umbral bien calculado, "grande" vuelve a significar
    // grande de verdad.
    const big = height > 9.5;
    // En VR el follaje de alto detalle se desactiva: las copas grandes son
    // ~480 por ciudad y a 80 triángulos cada una se llevan 38k de un
    // presupuesto que tiene que alcanzar para dos ojos a 72 Hz.
    const prim = big && this.highDetail ? 'blobHi' : 'blob';
    const blobs = big ? this.rng.int(3, 5) : this.rng.int(2, 3);

    for (let i = 0; i < blobs; i++) {
      // La primera masa es la principal; las demás la acompañan más chicas.
      const main = i === 0;
      const r = crownR * (main ? this.rng.range(0.9, 1.1) : this.rng.range(0.45, 0.78));
      const off = crownR * (main ? 0.15 : 0.75);
      this.farm.add(
        prim,
        this.mats.foliage(this.rng.pick(LEAF_TONES)),
        new Vector3(
          x + this.rng.range(-off, off),
          groundY + trunkH + crownR * squash * this.rng.range(main ? 0.45 : 0.25, main ? 0.7 : 0.95),
          z + this.rng.range(-off, off),
        ),
        new Vector3(r * 2, r * 2 * squash * 0.72, r * 2 * this.rng.range(0.85, 1.15)),
        // Rotación al azar: sin esto todas las facetas se alinean y la calle
        // entera muestra el mismo polígono en la misma orientación.
        this.rng.range(0, Math.PI * 2),
        this.rng.range(-0.3, 0.3),
        this.rng.range(-0.3, 0.3),
      );
    }
  }

  /** Conífera / árbol columnar: silueta vertical, buena para alinear calles. */
  conifer(x: number, z: number, scale = 1, groundY = 0): void {
    const height = this.rng.range(7, 12) * scale;
    const trunkH = height * 0.2;
    this.farm.add(
      'cylinder',
      this.mats.surface(PALETTE.bark, 0.95, 0, 'concrete', { metric: false }),
      new Vector3(x, groundY + trunkH / 2, z),
      new Vector3(height * 0.05, trunkH, height * 0.05),
    );
    const coneH = height - trunkH;
    const r = height * this.rng.range(0.15, 0.2);
    const leaf = this.mats.foliage(this.rng.pick([PALETTE.leafDeep, PALETTE.moss, PALETTE.leafMid]));
    // Dos pisos de copa encastrados: un cono único se lee como un cucurucho;
    // escalonado, como una conífera.
    const lowH = coneH * 0.62;
    this.farm.add(
      'cone',
      leaf,
      new Vector3(x, groundY + trunkH + lowH / 2, z),
      new Vector3(r * 2, lowH, r * 2),
      this.rng.range(0, Math.PI),
    );
    const topH = coneH * 0.66;
    this.farm.add(
      'cone',
      leaf,
      new Vector3(x, groundY + height - topH / 2, z),
      new Vector3(r * 1.45, topH, r * 1.45),
      this.rng.range(0, Math.PI),
    );
  }

  /** Arbusto bajo: rellena bordes y jardineras a costo casi nulo. */
  shrub(x: number, z: number, scale = 1, groundY = 0): void {
    const r = this.rng.range(0.5, 1.1) * scale;
    this.farm.add(
      'blob',
      this.mats.foliage(this.rng.pick(LEAF_TONES)),
      new Vector3(x, groundY + r * 0.5, z),
      new Vector3(r * 2, r * this.rng.range(0.9, 1.3), r * 2 * this.rng.range(0.8, 1.2)),
      this.rng.range(0, Math.PI * 2),
      this.rng.range(-0.25, 0.25),
      this.rng.range(-0.25, 0.25),
    );
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

    const area = width * depth;
    // 0,09 y no 0,14: una jardinera de 30 x 3 m generaba 12 arbustos, de los
    // cuales la mitad quedaba tapada por los de adelante. Se ven los del borde;
    // los del fondo sólo cuestan triángulos.
    const count = Math.max(1, Math.round(area * 0.09 * density));
    for (let i = 0; i < count; i++) {
      this.shrub(
        x + this.rng.range(-width / 2 + 0.4, width / 2 - 0.4),
        z + this.rng.range(-depth / 2 + 0.4, depth / 2 - 0.4),
        this.rng.range(0.6, 1.2),
        y + wallH * 0.7,
      );
    }
  }

  /**
   * Cortina vegetal colgante, para cantos de losa y jardines verticales.
   * Se apoya en un borde y cae: da esa textura de "edificio comido por plantas".
   */
  hangingVines(
    x: number,
    z: number,
    length: number,
    y: number,
    axis: 'x' | 'z',
    drop = 3,
  ): void {
    const steps = Math.max(2, Math.round(length / 1.6));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const px = axis === 'x' ? x - length / 2 + t * length : x;
      const pz = axis === 'z' ? z - length / 2 + t * length : z;
      const d = drop * this.rng.range(0.45, 1);
      this.farm.add(
        'box',
        this.mats.foliage(this.rng.pick([PALETTE.leafMid, PALETTE.leafBright, PALETTE.moss])),
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
