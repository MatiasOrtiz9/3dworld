import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import type { Rng } from '../../utils/rng';
import { PALETTE } from '../Palette';

/** Altura de la planta baja. Más alta que las plantas tipo, como en la realidad. */
export const GROUND_FLOOR_H = 4.3;

/** Colores de toldo. Tela lisa, saturada pero no chillona. */
const AWNING_TONES = [
  PALETTE.terracotta,
  PALETTE.sun,
  PALETTE.signal,
  PALETTE.leafDeep,
  PALETTE.glassBlue,
] as const;

/**
 * Detalle a nivel de calle.
 *
 * Parado en la vereda, el ojo ve sobre todo los primeros cinco metros de un
 * edificio. Es donde está la puerta, el local, el toldo, el cartel, el cordón.
 * Desde 100 m una fachada lisa pasa; desde 1,70 m de altura y dos metros de
 * distancia, delata que es una caja.
 *
 * Por eso todo el detalle se concentra abajo: es donde compra realismo por
 * triángulo. Arriba del tercer piso no se agrega casi nada, porque nadie lo
 * mira de cerca.
 */
export class StreetLevel {
  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly rng: Rng,
    /**
     * Detalle completo o reducido.
     *
     * El detalle de calle es lo más caro por metro cuadrado de todo el
     * proyecto: en calidad alta suma ~130k triángulos. En VR, donde el
     * presupuesto tiene que alcanzar para dos ojos a 72 Hz, se recorta lo que
     * sólo se aprecia a menos de diez metros — parteluces, faldón del toldo,
     * balcones de los pisos altos, bicicleteros — y se conserva lo que define
     * la silueta: zócalo, vitrina, cartel, puerta.
     */
    private readonly full = true,
  ) {}

  /** ¿Está activo el detalle fino? Lo consultan los otros constructores. */
  get fullDetail(): boolean {
    return this.full;
  }

  /**
   * Planta baja comercial sobre una cara.
   *
   * Se compone de: zócalo oscuro, vitrina retranqueada con parteluces, banda de
   * cartelería, y a veces toldo y puerta de acceso. La clave visual es el
   * RETRANQUEO: el vidrio entra unos centímetros respecto del plano de fachada,
   * así la sombra propia dibuja el hueco. Sin eso el local se ve pegado encima
   * del muro, como una calcomanía.
   *
   * @param face  Cara sobre la que se monta: 'north'/'south' miran en Z, 'east'/'west' en X.
   */
  shopfront(
    cx: number,
    cz: number,
    width: number,
    depth: number,
    face: 'north' | 'south' | 'east' | 'west',
  ): void {
    const alongX = face === 'north' || face === 'south';
    const span = alongX ? width : depth;
    if (span < 5) return;

    // Posición del plano de fachada y hacia dónde es "afuera".
    const out = face === 'north' || face === 'east' ? 1 : -1;
    const faceOffset = (alongX ? depth : width) / 2;

    const px = (t: number) => (alongX ? cx + t : cx + out * faceOffset);
    const pz = (t: number) => (alongX ? cz + out * faceOffset : cz + t);
    const posAt = (t: number, y: number, dOut = 0) =>
      alongX
        ? new Vector3(px(t), y, pz(t) + out * dOut)
        : new Vector3(px(t) + out * dOut, y, pz(t));
    const size = (long: number, h: number, thick: number) =>
      alongX ? new Vector3(long, h, thick) : new Vector3(thick, h, long);

    const bays = Math.max(2, Math.round(span / 4.5));
    const bayW = span / bays;
    const entranceBay = this.rng.int(0, bays - 1);

    const plinth = this.mats.surface(PALETTE.concreteShade, 0.85, 0, 'concrete');
    const glass = this.mats.glass(PALETTE.glassBlue, 0.94);
    const frame = this.mats.surface(PALETTE.timberDark, 0.8, 0, 'timber');
    const interiorWall = this.mats.surface(PALETTE.concreteShade, 0.95, 0, 'concrete');
    const counterMat = this.mats.surface(PALETTE.timberMid, 0.7, 0, 'timber');

    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) * bayW - span / 2;
      const isEntrance = b === entranceBay;

      // Zócalo: protege el vidrio y ancla el edificio al piso.
      this.farm.add(
        'box',
        plinth,
        posAt(t, 0.28, 0),
        size(bayW * 0.96, 0.56, 0.36),
      );

      if (isEntrance) {
        // Acceso: hueco más alto, marco marcado y hoja de vidrio retranqueada.
        this.farm.add(
          'box',
          frame,
          posAt(t, GROUND_FLOOR_H * 0.5, 0),
          size(bayW * 0.86, GROUND_FLOOR_H * 0.94, 0.26),
        );
        this.farm.add(
          'box',
          glass,
          posAt(t, GROUND_FLOOR_H * 0.48, -0.12),
          size(bayW * 0.66, GROUND_FLOOR_H * 0.8, 0.14),
        );
        // Escalón de entrada.
        this.farm.add(
          'box',
          plinth,
          posAt(t, 0.08, 0.5),
          size(bayW * 0.8, 0.16, 1.1),
        );
      } else {
        // Vitrina: vidrio grande entre zócalo y dintel, retranqueado 12 cm.
        const glassH = GROUND_FLOOR_H - 0.56 - 0.75;
        this.farm.add(
          'box',
          glass,
          posAt(t, 0.56 + glassH / 2, -0.12),
          size(bayW * 0.88, glassH, 0.16),
        );
        // Parteluz central e interiores insinuados: sólo en detalle completo.
        if (this.full) {
          this.farm.add(
            'box',
            frame,
            posAt(t, 0.56 + glassH / 2, 0),
            size(0.14, glassH, 0.2),
          );

          // Fondo del local: pared posterior en penumbra que da profundidad.
          this.farm.add(
            'box',
            interiorWall,
            posAt(t, 0.56 + glassH / 2, -0.65),
            size(bayW * 0.84, glassH * 0.95, 0.1),
          );

          // Mostrador / anaquel de madera.
          this.farm.add(
            'box',
            counterMat,
            posAt(t, 0.56 + 0.4, -0.38),
            size(bayW * 0.62, 0.8, 0.26),
          );

          // Objeto en vitrina / exhibición para romper monotonía.
          if (this.rng.chance(0.65)) {
            const decorColor = this.rng.pick([
              PALETTE.leafDeep,
              PALETTE.terracotta,
              PALETTE.sun,
              PALETTE.glassGreen,
            ]);
            const decorMat = this.mats.surface(decorColor, 0.65, 0, null);
            this.farm.add(
              'box',
              decorMat,
              posAt(t, 0.56 + 0.92, -0.38),
              size(0.28, 0.24, 0.2),
            );
          }
        }
      }

      // Jamba entre locales.
      this.farm.add(
        'box',
        plinth,
        posAt(t + bayW / 2, GROUND_FLOOR_H / 2, 0),
        size(0.22, GROUND_FLOOR_H, 0.3),
      );
    }

    // Banda de cartelería continua sobre los locales. En un tono propio y más
    // oscuro que la fachada: si comparte el color del muro, el remate del local
    // no se lee y la planta baja se funde con el resto del edificio.
    this.farm.add(
      'box',
      this.mats.surfaceVaried(PALETTE.timberDark, 0.7, 0, 'timber', 0.12),
      new Vector3(px(0), GROUND_FLOOR_H - 0.34, pz(0)),
      size(span, 0.68, 0.42),
    );

    // Toldo: el elemento que más "calle viva" aporta por triángulo.
    if (this.rng.chance(0.55)) {
      const awning = this.mats.surface(this.rng.pick(AWNING_TONES), 0.85, 0, null);
      const projection = this.rng.range(1.1, 1.7);
      this.farm.add(
        'box',
        awning,
        new Vector3(
          px(0) + (alongX ? 0 : (out * projection) / 2),
          GROUND_FLOOR_H - 0.85,
          pz(0) + (alongX ? (out * projection) / 2 : 0),
        ),
        size(span * 0.92, 0.1, projection),
        0,
        alongX ? out * 0.18 : 0,
        alongX ? 0 : -out * 0.18,
      );
      // Faldón colgante del toldo: sólo en detalle completo.
      if (this.full) this.farm.add(
        'box',
        awning,
        new Vector3(
          px(0) + (alongX ? 0 : out * projection),
          GROUND_FLOOR_H - 1.16,
          pz(0) + (alongX ? out * projection : 0),
        ),
        size(span * 0.92, 0.34, 0.08),
      );
    }
  }

  /**
   * Balcones sobre una cara, en los pisos bajos.
   *
   * Sólo hasta el cuarto piso: por encima ya no se distinguen desde la vereda y
   * multiplicarían el coste sin que nadie los mire.
   */
  balconies(
    cx: number,
    cz: number,
    width: number,
    depth: number,
    face: 'north' | 'south' | 'east' | 'west',
    floors: number,
    baseY: number,
    floorH: number,
  ): void {
    const alongX = face === 'north' || face === 'south';
    const span = alongX ? width : depth;
    if (span < 6) return;

    const out = face === 'north' || face === 'east' ? 1 : -1;
    const faceOffset = (alongX ? depth : width) / 2;
    const proj = this.rng.range(1.1, 1.6);

    const slab = this.mats.surface(PALETTE.concreteLight, 0.72, 0, 'concrete');
    const rail = this.mats.metal(PALETTE.solarFrame, 0.45);
    const balustrade = this.mats.glass(PALETTE.glassGreen, 0.55);

    const count = Math.max(1, Math.floor(span / 5.5));
    // Antes el tope era 4 pisos, elegido por miedo al coste. La medición con
    // GPU real mostró que TODA la geometría de la ciudad cuesta 2,5 ms de un
    // cuadro de 11 — el 14 % — así que ese miedo estaba mal calibrado. Ahora
    // los balcones suben hasta 8 pisos y las fachadas altas dejan de ser lisas.
    const visibleFloors = Math.min(floors, this.full ? 8 : 3);

    for (let f = 0; f < visibleFloors; f++) {
      const y = baseY + f * floorH;
      for (let b = 0; b < count; b++) {
        if (this.rng.chance(0.28)) continue; // no todos tienen balcón
        const t = (b + 0.5) * (span / count) - span / 2;
        const bw = (span / count) * 0.7;

        const bx = alongX ? cx + t : cx + out * (faceOffset + proj / 2);
        const bz = alongX ? cz + out * (faceOffset + proj / 2) : cz + t;

        // Losa del balcón.
        this.farm.add(
          'box',
          slab,
          new Vector3(bx, y + 0.1, bz),
          alongX ? new Vector3(bw, 0.2, proj) : new Vector3(proj, 0.2, bw),
        );
        // Baranda: paño de vidrio apoyado en la losa y pasamanos encima.
        //
        // Antes eran dos barras sueltas a 0,42 y 0,9 m, sin parantes: miradas
        // de cerca flotaban en el aire delante de cada balcón. Un paño de
        // vidrio cuesta la misma caja y se apoya de verdad en la losa.
        const ex = alongX ? bx : bx + (out * (proj - 0.05)) / 2;
        const ez = alongX ? bz + (out * (proj - 0.05)) / 2 : bz;
        this.farm.add(
          'box',
          balustrade,
          new Vector3(ex, y + 0.2 + 0.38, ez),
          alongX ? new Vector3(bw, 0.76, 0.05) : new Vector3(0.05, 0.76, bw),
        );
        this.farm.add(
          'box',
          rail,
          new Vector3(ex, y + 0.99, ez),
          alongX ? new Vector3(bw + 0.04, 0.06, 0.08) : new Vector3(0.08, 0.06, bw + 0.04),
        );
        // Una maceta en algunos.
        if (this.full && this.rng.chance(0.4)) {
          this.farm.add(
            'box',
            this.mats.foliage(PALETTE.leafMid),
            new Vector3(bx, y + 0.45, bz),
            new Vector3(0.6, 0.5, 0.5),
          );
        }
      }
    }
  }

  /** Cordón de vereda: la línea que separa calzada de vereda. */
  kerb(
    axis: 'x' | 'z',
    at: number,
    laneHalf: number,
    length: number,
  ): void {
    const mat = this.mats.surface(PALETTE.concreteShade, 0.9, 0, 'pavement');
    for (const s of [-1, 1]) {
      const pos =
        axis === 'x'
          ? new Vector3(0, 0.08, at + s * laneHalf)
          : new Vector3(at + s * laneHalf, 0.08, 0);
      this.farm.add(
        'box',
        mat,
        pos,
        axis === 'x' ? new Vector3(length, 0.17, 0.32) : new Vector3(0.32, 0.17, length),
      );
    }
  }

  /** Alcorque: el cuadro de tierra alrededor del tronco de un árbol de vereda. */
  treePit(x: number, z: number): void {
    this.farm.add(
      'box',
      this.mats.surface(PALETTE.soil, 0.95, 0, null),
      new Vector3(x, 0.07, z),
      new Vector3(1.5, 0.14, 1.5),
    );
    // Borde de hormigón.
    const edge = this.mats.surface(PALETTE.concreteShade, 0.9, 0, 'pavement');
    for (const [dx, dz, w, d] of [
      [0, -0.85, 1.9, 0.2],
      [0, 0.85, 1.9, 0.2],
      [-0.85, 0, 0.2, 1.9],
      [0.85, 0, 0.2, 1.9],
    ] as const) {
      this.farm.add('box', edge, new Vector3(x + dx, 0.09, z + dz), new Vector3(w, 0.18, d));
    }
  }

  /** Bicicletero: arcos invertidos. Señal inequívoca de ciudad sin autos. */
  bikeRack(x: number, z: number, rotY: number): void {
    const mat = this.mats.metal(PALETTE.solarFrame, 0.4);
    // Cada arco son 3 piezas; en detalle reducido bastan dos arcos.
    const arcs = this.full ? 4 : 2;
    for (let i = 0; i < arcs; i++) {
      const o = (i - (arcs - 1) / 2) * 0.75;
      const ox = Math.cos(rotY) * o;
      const oz = Math.sin(rotY) * o;
      // Dos montantes y un travesaño: la "U" invertida clásica.
      for (const s of [-1, 1]) {
        this.farm.add(
          'cylinder',
          mat,
          new Vector3(x + ox - Math.sin(rotY) * s * 0.35, 0.35, z + oz + Math.cos(rotY) * s * 0.35),
          new Vector3(0.07, 0.7, 0.07),
        );
      }
      this.farm.add(
        'box',
        mat,
        new Vector3(x + ox, 0.7, z + oz),
        new Vector3(0.07, 0.07, 0.78),
        rotY,
      );
    }
  }

  /** Bolardo: separa vereda de calzada en los cruces. */
  bollard(x: number, z: number): void {
    this.farm.add(
      'cylinder',
      this.mats.metal(PALETTE.solarFrame, 0.42),
      new Vector3(x, 0.45, z),
      new Vector3(0.14, 0.9, 0.14),
    );
  }

  /** Parada de tranvía: marquesina con banco y panel solar en la cubierta. */
  tramStop(x: number, z: number, rotY: number): void {
    const post = this.mats.metal(PALETTE.solarFrame, 0.4);
    const roof = this.mats.solar();
    const bench = this.mats.surface(PALETTE.timberLight, 0.85, 0, 'timber');

    // Ejes locales de una caja girada `rotY` en Babylon: X → (cos, −sin),
    // Z → (sin, cos). Los parantes van sobre la línea del respaldo de vidrio,
    // así sostienen techo y vidrio; antes estaban en el eje y el vidrio y el
    // banco quedaban flotando.
    const lx = (a: number, b: number) => x + Math.cos(rotY) * a + Math.sin(rotY) * b;
    const lz = (a: number, b: number) => z - Math.sin(rotY) * a + Math.cos(rotY) * b;
    for (const s of [-1, 1]) {
      this.farm.add(
        'cylinder',
        post,
        new Vector3(lx(s * 2.2, 0.78), 1.33, lz(s * 2.2, 0.78)),
        new Vector3(0.12, 2.66, 0.12),
      );
    }
    // Cubierta: el techo de la parada también genera energía.
    this.farm.add('box', roof, new Vector3(x, 2.68, z), new Vector3(5, 0.12, 1.9), rotY, 0, -0.06);
    // Respaldo de vidrio, entre los parantes.
    this.farm.add(
      'box',
      this.mats.glass(PALETTE.glassGreen, 0.55),
      new Vector3(lx(0, 0.78), 1.4, lz(0, 0.78)),
      new Vector3(4.3, 1.8, 0.06),
      rotY,
    );
    // Banco con sus patas.
    this.farm.add('box', bench, new Vector3(lx(0, 0.35), 0.46, lz(0, 0.35)), new Vector3(3.6, 0.1, 0.5), rotY);
    for (const s of [-1, 1]) {
      this.farm.add(
        'box',
        post,
        new Vector3(lx(s * 1.5, 0.35), 0.21, lz(s * 1.5, 0.35)),
        new Vector3(0.08, 0.42, 0.42),
        rotY,
      );
    }
  }

  /**
   * Equipamiento de azotea: tanques de agua, conductos y antenas.
   *
   * Es lo que hace que un techo se lea como un techo y no como una tapa. Se ve
   * desde la calle en los edificios vecinos y, sobre todo, desde las torres y
   * la vista aérea, donde antes la ciudad terminaba en una cuadrícula de
   * superficies planas.
   */
  roofClutter(cx: number, cz: number, width: number, depth: number, y: number): void {
    if (width < 6 || depth < 6) return;
    const tank = this.mats.metal(PALETTE.solarFrame, 0.5);
    const duct = this.mats.surface(PALETTE.concreteShade, 0.85, 0, 'concrete');

    // Tanques de agua sobre patas, agrupados en una esquina.
    const tanks = this.rng.int(1, 3);
    for (let i = 0; i < tanks; i++) {
      const tx = cx + this.rng.range(-width * 0.3, width * 0.3);
      const tz = cz + this.rng.range(-depth * 0.3, depth * 0.3);
      const r = this.rng.range(0.7, 1.15);
      const h = this.rng.range(1.5, 2.3);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          this.farm.add(
            'box',
            duct,
            new Vector3(tx + sx * r * 0.6, y + 0.35, tz + sz * r * 0.6),
            new Vector3(0.12, 0.7, 0.12),
          );
        }
      }
      this.farm.add(
        'cylinder',
        tank,
        new Vector3(tx, y + 0.7 + h / 2, tz),
        new Vector3(r * 2, h, r * 2),
      );
    }

    // Conductos de ventilación: cajas bajas y alargadas.
    const ducts = this.rng.int(1, 3);
    for (let i = 0; i < ducts; i++) {
      this.farm.addBoxOnGround(
        duct,
        cx + this.rng.range(-width * 0.32, width * 0.32),
        cz + this.rng.range(-depth * 0.32, depth * 0.32),
        this.rng.range(1.2, 3),
        this.rng.range(0.5, 0.9),
        this.rng.range(0.8, 1.4),
        y,
        this.rng.range(0, Math.PI),
      );
    }

    // Antena o mástil, en algunos.
    if (this.rng.chance(0.4)) {
      const h = this.rng.range(3, 6);
      this.farm.add(
        'cylinder',
        tank,
        new Vector3(cx + this.rng.range(-width * 0.3, width * 0.3), y + h / 2, cz + this.rng.range(-depth * 0.3, depth * 0.3)),
        new Vector3(0.09, h, 0.09),
      );
    }
  }

  /**
   * Cornisa de remate: un canto que sobresale en el borde superior.
   *
   * Un edificio que termina en un corte limpio se lee como una caja. La cornisa
   * le da un remate y, más importante, proyecta una línea de sombra que separa
   * el volumen del cielo.
   */
  cornice(cx: number, cz: number, width: number, depth: number, y: number): void {
    this.farm.addBoxOnGround(
      this.mats.surface(PALETTE.concreteLight, 0.72, 0, 'concrete'),
      cx,
      cz,
      width + 0.85,
      0.34,
      depth + 0.85,
      y - 0.34,
    );
  }

  /** Cesto de basura con separación de residuos. */
  bin(x: number, z: number): void {
    const body = this.mats.surface(PALETTE.concreteShade, 0.8, 0, 'concrete');
    const lid = this.mats.surface(PALETTE.leafDeep, 0.7, 0, null);
    this.farm.add('cylinder', body, new Vector3(x, 0.42, z), new Vector3(0.46, 0.84, 0.46));
    this.farm.add('cylinder', lid, new Vector3(x, 0.88, z), new Vector3(0.5, 0.1, 0.5));
  }
}
