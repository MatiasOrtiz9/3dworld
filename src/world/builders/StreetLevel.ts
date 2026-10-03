import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { InstanceFarm } from '../../core/InstanceFarm';
import type { Materials } from '../Materials';
import { Rng } from '../../utils/rng';
import { PALETTE } from '../Palette';
import { SIDEWALK_H } from '../CityLayout';
import { TintFarm } from './TintFarm';
import { SignAtlas, STREET_SIGN } from './SignAtlas';
import { LAUNDRY, LOBBY, SHOP_CEILING, SHOP_LIGHT, SHOP_TYPES, type ShopType } from './Shops';

/** Altura de la planta baja. Más alta que las plantas tipo, como en la realidad. */
export const GROUND_FLOOR_H = 4.3;

/**
 * Profundidad visible de un local: la planta baja se retira esto detrás de la
 * vidriera. Antes el vidrio quedaba DENTRO de la caja del edificio y desde la
 * vereda sólo se veía el muro con pilastras: plantas bajas ciegas.
 */
export const SHOP_DEPTH = 2.8;

type Face = 'north' | 'south' | 'east' | 'west';
type Rgb = readonly [number, number, number];

const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** Tonos de la granja con color de las piezas que en el visor son un paño. */
const PLINTH_RGB: Rgb = [PALETTE.concreteShade.r * 0.92, PALETTE.concreteShade.g * 0.92, PALETTE.concreteShade.b * 0.92];
const RAIL_RGB: Rgb = [PALETTE.solarFrame.r, PALETTE.solarFrame.g, PALETTE.solarFrame.b];

/** Sillas de café en el visor: madera media y caño gris, no un bloque negro. */
const CHAIR_WOOD: Rgb = [0.45, 0.33, 0.22];
const CHAIR_FRAME: Rgb = [0.36, 0.36, 0.37];

/** Vidrio de vidriera: claro y casi transparente (el reflejo lo pone el IBL). */
const SHOP_GLASS = Color3.FromHexString('#a9c3cf');

/** Pieles y remeras de la gente que atiende detrás del mostrador. */
const SKIN: readonly Rgb[] = [
  [0.85, 0.66, 0.52],
  [0.66, 0.47, 0.34],
  [0.45, 0.31, 0.22],
  [0.92, 0.76, 0.62],
];
const SHIRT: readonly Rgb[] = [
  [0.85, 0.85, 0.82],
  [0.25, 0.35, 0.6],
  [0.6, 0.2, 0.2],
  [0.25, 0.45, 0.3],
  [0.15, 0.15, 0.17],
];

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
 *
 * Lo de color (interiores, carteles, toldos, ropa tendida, aires) va a la
 * `TintFarm` (color por instancia: un draw call para cientos de colores) y
 * los textos al `SignAtlas`; los volúmenes a la luz, a la granja de siempre
 * con materiales que la ciudad ya tenía. Las decisiones de diseño (rubro,
 * toldo, cartel) salen de un azar por posición: el visor y el escritorio
 * levantan el mismo barrio, el visor con menos piezas.
 */
export class StreetLevel {
  private tintFarm: TintFarm | null = null;
  private signAtlas: SignAtlas | null = null;
  private finished = false;

  /**
   * Centros de las mesitas de café que se dibujaron. `InfraBuilder.ground`
   * la reemplaza por `plan.cafeTables`, así quedan publicadas en el plano y
   * la gente de la vereda las esquiva (antes las atravesaba: la mesa cae justo
   * sobre el carril que va pegado a la fachada).
   */
  cafeTables: { x: number; z: number }[] = [];

  constructor(
    private readonly farm: InstanceFarm,
    private readonly mats: Materials,
    private readonly rng: Rng,
    /**
     * Detalle completo o reducido.
     *
     * El detalle de calle es lo más caro por metro cuadrado de todo el
     * proyecto. En VR, donde el presupuesto tiene que alcanzar para dos ojos
     * a 72 Hz, se recorta lo que sólo se aprecia a menos de diez metros
     * —parteluces, rayas del toldo, segunda fila de mercadería— y se conserva
     * lo que define la escena: vidriera con el local encendido, cartel,
     * toldo, puerta, escalón.
     */
    private readonly full = true,
  ) {}

  /** ¿Está activo el detalle fino? Lo consultan los otros constructores. */
  get fullDetail(): boolean {
    return this.full;
  }

  /** Detalle con color por instancia (se sube en `finish`). */
  get tint(): TintFarm {
    if (!this.tintFarm) this.tintFarm = new TintFarm(this.mats.glow(new Color3(1, 1, 1), 1).getScene(), this.mats);
    return this.tintFarm;
  }

  /** Carteles con texto (se pintan en `finish`). */
  get signs(): SignAtlas {
    if (!this.signAtlas) this.signAtlas = new SignAtlas(this.mats.glow(new Color3(1, 1, 1), 1).getScene());
    return this.signAtlas;
  }

  /**
   * Azar de decoración atado a un lugar: el mismo en escritorio y en VR, y no
   * corre el azar compartido de la ciudad (HANDOFF 42).
   */
  deco(x: number, z: number, salt = 0): Rng {
    let h = (this.rng.seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ Math.round(x * 10), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ Math.round(z * 10), 0xc2b2ae35) >>> 0;
    return new Rng((h ^ (h >>> 16)) >>> 0);
  }

  /**
   * Mallas propias del detalle de calle (color por instancia y carteles),
   * fuera de la granja principal. `City` puede sumarlas a los proyectores de
   * sombra y al precompilado; se liberan solas con la biblioteca de materiales.
   */
  get meshes(): Mesh[] {
    const out = [...(this.tintFarm?.sourceMeshes ?? [])];
    const signs = this.signAtlas?.sourceMesh;
    if (signs) out.push(signs);
    return out;
  }

  /** Sube el detalle con color y pinta los carteles. Una sola vez, al final. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.tintFarm?.commit();
    this.signAtlas?.build(this.mats.glow(new Color3(1, 1, 1), 1));
  }

  // ------------------------------------------------------------- planta baja

  /**
   * Planta baja comercial sobre una cara.
   *
   * La caja del edificio tiene que llegar retirada `SHOP_DEPTH` de la línea
   * de fachada (lo hace `BuildingBuilder`): ese hueco es el local. Delante,
   * la vidriera; detrás, el local encendido — pared, piso, cielorraso con
   * luz, estantes con mercadería, mostrador y a veces quien atiende — y sobre
   * cada uno su cartel con el rubro, su toldo, el escalón de la puerta y lo
   * que saca a la vereda. Cada tramo de ~4,5 m es un local distinto.
   *
   * @param face   Cara sobre la que se monta: 'north'/'south' miran en Z, 'east'/'west' en X.
   * @param lobby  Un tramo es el hall de entrada del edificio en vez de un local.
   * @param outer  La cara da a la calle perimetral, de espaldas al barrio: en
   *               el visor sus locales llevan sólo lo que se lee desde lejos.
   */
  shopfront(cx: number, cz: number, width: number, depth: number, face: Face, lobby = false, outer = false): void {
    const lite = outer && !this.full;
    const alongX = face === 'north' || face === 'south';
    const span = alongX ? width : depth;
    if (span < 5) return;

    const out = face === 'north' || face === 'east' ? 1 : -1;
    const nx = alongX ? 0 : out;
    const nz = alongX ? out : 0;
    const faceOffset = (alongX ? depth : width) / 2;
    const px = (t: number, dOut = 0) => (alongX ? cx + t : cx + out * (faceOffset + dOut));
    const pz = (t: number, dOut = 0) => (alongX ? cz + out * (faceOffset + dOut) : cz + t);
    const posAt = (t: number, y: number, dOut = 0) => new Vector3(px(t, dOut), y, pz(t, dOut));
    const size = (long: number, h: number, thick: number) =>
      alongX ? new Vector3(long, h, thick) : new Vector3(thick, h, long);

    const bays = Math.max(2, Math.round(span / 4.5));
    const bayW = span / bays;
    const lobbyBay = lobby ? this.deco(cx + nx * faceOffset, cz + nz * faceOffset, 11).int(0, bays - 1) : -1;

    const plinth = this.mats.surface(PALETTE.concreteShade, 0.85, 0, 'concrete');
    // Vidrio claro: la vidriera tiene que dejar ver el local. El oscuro de las
    // ventanas (HANDOFF 9) es para pisos de vivienda, no para un comercio.
    // Es el mismo vidrio de las ventanas de la escuela: no suma draw call.
    const glass = this.mats.glass(SHOP_GLASS, 0.26);
    const frame = this.mats.surface(PALETTE.timberDark, 0.8, 0, 'timber');
    const tint = this.tint;
    const glassBottom = 0.56;
    const glassTop = GROUND_FLOOR_H - 0.75;
    const glassH = glassTop - glassBottom;
    const floorY = SIDEWALK_H + 0.012;
    const ceilY = GROUND_FLOOR_H - 0.25;
    const back = -SHOP_DEPTH + 0.06;

    let prev = -1;
    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) * bayW - span / 2;
      const isLobby = b === lobbyBay;
      // Un azar por local, no uno para toda la cara: lo que cada local sortea
      // depende del detalle (filas de mercadería, quien atiende, lo de la
      // vereda), y con el azar compartido el escritorio y el visor corrían la
      // secuencia distinto: desde el segundo local de cada cara armaban otro
      // barrio (un café en el visor era una florería en escritorio).
      const rng = this.deco(px(t), pz(t), 13);

      // Pilastra y medianera entre locales: llega hasta el fondo del local.
      this.farm.add(
        'box',
        plinth,
        posAt(t + bayW / 2, GROUND_FLOOR_H / 2, -SHOP_DEPTH / 2 + 0.12),
        size(0.24, GROUND_FLOOR_H, SHOP_DEPTH + 0.24),
      );
      if (b === 0) {
        this.farm.add(
          'box',
          plinth,
          posAt(t - bayW / 2, GROUND_FLOOR_H / 2, -SHOP_DEPTH / 2 + 0.12),
          size(0.24, GROUND_FLOOR_H, SHOP_DEPTH + 0.24),
        );
      }

      if (isLobby) {
        this.lobby(posAt, size, t, bayW, rng, nx, nz);
        continue;
      }

      // Rubro: nunca dos iguales seguidos.
      let k = rng.int(0, SHOP_TYPES.length - 1);
      if (k === prev) k = (k + 1) % SHOP_TYPES.length;
      prev = k;
      const shop = SHOP_TYPES[k];
      const doorLeft = rng.chance(0.5);
      const doorT = t + (doorLeft ? -1 : 1) * (bayW / 2 - 0.75);
      const doorSide = doorLeft ? -1 : 1;

      // Zócalo bajo la vidriera (no delante de la puerta). En el visor, su
      // frente solo, del tono del hormigón: arranca justo donde termina el
      // vidrio, así que no deja hueco, y son 2 triángulos en vez de 12.
      if (this.full) this.farm.add('box', plinth, posAt(t - doorSide * 0.65, 0.28, 0), size(bayW - 1.5, 0.56, 0.36));
      else tint.panel('lit', PLINTH_RGB, px(t - doorSide * 0.65, 0.02), 0.28, pz(t - doorSide * 0.65, 0.02), bayW - 1.5, 0.56, nx, nz);
      // Vidriera, retirada 10 cm de la línea de fachada, y la puerta de vidrio
      // hasta el piso (en el visor, el vano abierto: no se distingue).
      if (this.full) this.farm.add('box', glass, posAt(t, glassBottom + glassH / 2, -0.1), size(bayW - 0.3, glassH, 0.06));
      else this.pane(glass, posAt(t, glassBottom + glassH / 2, -0.07), bayW - 0.3, glassH, nx, nz);
      if (this.full) {
        this.farm.add('box', glass, posAt(doorT, (SIDEWALK_H + glassBottom) / 2, -0.1), size(1.1, glassBottom - SIDEWALK_H, 0.06));
        this.farm.add('box', frame, posAt(doorT - doorSide * 0.58, (SIDEWALK_H + glassTop) / 2, -0.06), size(0.08, glassTop - SIDEWALK_H, 0.12));
        this.farm.add('box', frame, posAt(doorT, glassTop - 0.04, -0.06), size(1.2, 0.08, 0.12));
      }
      // Escalón de la puerta, sobre la vereda.
      this.farm.add('box', plinth, posAt(doorT, SIDEWALK_H + 0.07, 0.28), size(1.3, 0.14, 0.56));

      // ---- el local encendido ----
      // Todo en paños de dos triángulos (se mira a través del vidrio, siempre
      // de frente): fondo, piso, cielorraso, la línea de luz, la estantería
      // con la mercadería, el mostrador y quien atiende.
      const innerW = bayW - 0.3;
      // Paño acostado: su X local corre a lo largo de la fachada y su Y, hacia
      // adentro. El giro de las caras este/oeste ya lo pone `yaw`: si además
      // se cruzaban los lados, el piso y el cielorraso salían 0,7 m a la vereda.
      const flat = new Vector3(innerW, SHOP_DEPTH, 1);
      const yaw = alongX ? 0 : Math.PI / 2;
      tint.panel('glow', scale(shop.wall, 0.95), px(t, back), GROUND_FLOOR_H / 2, pz(t, back), innerW, GROUND_FLOOR_H, nx, nz);
      if (!lite) {
        tint.add('plane', 'glow', scale(shop.floor, 0.9), posAt(t, floorY, -SHOP_DEPTH / 2), flat, yaw, Math.PI / 2);
        tint.add('plane', 'glow', SHOP_CEILING, posAt(t, ceilY, -SHOP_DEPTH / 2), flat, yaw, -Math.PI / 2);
      }
      // Línea de luz: lo que hace leer "encendido" a un local desde la calle.
      tint.add('plane', 'glow', SHOP_LIGHT, posAt(t, ceilY - 0.02, -SHOP_DEPTH * 0.55), new Vector3(innerW * 0.8, 0.3, 1), yaw, -Math.PI / 2);

      // Estantería contra el fondo, con filas de mercadería.
      const shelfW = innerW * 0.86;
      const shelfAt = back + 0.04;
      tint.panel('glow', scale(shop.shelf, 0.95), px(t, shelfAt), SIDEWALK_H + 1.15, pz(t, shelfAt), shelfW, 2.3, nx, nz);
      const rows = this.full ? 3 : lite ? 1 : 2;
      for (let r = 0; r < rows; r++) {
        const y = SIDEWALK_H + 0.55 + r * (this.full ? 0.62 : 0.85);
        const parts = this.full ? 3 : 1;
        for (let p = 0; p < parts; p++) {
          const pw = shelfW / parts;
          const pt = t - shelfW / 2 + pw * (p + 0.5);
          tint.panel('glow', rng.pick(shop.products), px(pt, shelfAt + 0.03), y, pz(pt, shelfAt + 0.03), pw * 0.94, 0.34, nx, nz);
        }
      }
      if (lite) {
        // Sin mostrador ni gente: de espaldas al barrio, sólo se ve de lejos.
      } else if (shop.counter) {
        const ct = t - doorSide * innerW * 0.2;
        const cAt = -SHOP_DEPTH * 0.45;
        if (this.full) tint.add('box', 'glow', scale(shop.shelf, 0.95), posAt(ct, SIDEWALK_H + 0.5, cAt - 0.3), size(innerW * 0.42, 1.0, 0.6));
        else tint.panel('glow', scale(shop.shelf, 0.95), px(ct, cAt), SIDEWALK_H + 0.5, pz(ct, cAt), innerW * 0.42, 1.0, nx, nz);
        // Quien atiende: un torso y una cabeza alcanzan detrás del vidrio.
        if (rng.chance(0.6)) {
          const at = cAt - 0.75;
          tint.panel('glow', scale(rng.pick(SHIRT), 0.8), px(ct, at), SIDEWALK_H + 1.2, pz(ct, at), 0.46, 0.7, nx, nz);
          tint.panel('glow', scale(rng.pick(SKIN), 0.85), px(ct, at), SIDEWALK_H + 1.7, pz(ct, at), 0.2, 0.26, nx, nz);
        }
      } else if (this.full) {
        // Mesa de exhibición en el medio del local.
        tint.add('box', 'glow', scale(shop.shelf, 0.9), posAt(t, SIDEWALK_H + 0.4, -SHOP_DEPTH * 0.5), size(innerW * 0.5, 0.8, 0.8));
        tint.add('plane', 'glow', rng.pick(shop.products), posAt(t, SIDEWALK_H + 0.81, -SHOP_DEPTH * 0.5), new Vector3(innerW * 0.48, 0.75, 1), yaw, Math.PI / 2);
      }

      // ---- cartel, toldo y vereda ----
      this.shopSign(shop, t, bayW, posAt, size, alongX, nx, nz, px, pz, rng);
      if (rng.chance(shop.awningChance)) this.awning(shop, t, bayW, alongX, nx, nz, px, pz, rng);
      if (!lite) this.outside(shop, t, bayW, nx, nz, px, pz, rng);
    }
  }

  /** Hall de entrada de un edificio de vivienda: puerta de madera y vidrio, escalones, timbre. */
  private lobby(
    posAt: (t: number, y: number, dOut?: number) => Vector3,
    size: (long: number, h: number, thick: number) => Vector3,
    t: number,
    bayW: number,
    rng: Rng,
    nx: number,
    nz: number,
  ): void {
    const tint = this.tint;
    const plinth = this.mats.surface(PALETTE.concreteShade, 0.85, 0, 'concrete');
    const glass = this.mats.glass(SHOP_GLASS, 0.26);
    const doorW = 1.8;
    const doorH = GROUND_FLOOR_H - 1.1;
    const recess = -0.6;
    // Muro a ras de la fachada a los dos lados del vano de la puerta.
    const sideW = (bayW - 0.24 - doorW) / 2;
    for (const s of [-1, 1]) {
      this.farm.add('box', plinth, posAt(t + s * (doorW / 2 + sideW / 2), GROUND_FLOOR_H / 2, -0.35), size(sideW, GROUND_FLOOR_H, 0.7));
    }
    // Dintel sobre la puerta.
    this.farm.add('box', plinth, posAt(t, (SIDEWALK_H + 0.3 + doorH + GROUND_FLOOR_H) / 2 + 0.08, -0.35), size(doorW, GROUND_FLOOR_H - SIDEWALK_H - 0.3 - doorH - 0.16, 0.7));
    // Hall encendido detrás de la puerta: fondo, piso y luz de techo.
    const back = -SHOP_DEPTH + 0.06;
    const bp = posAt(t, 0, back);
    tint.panel('glow', LOBBY.wall, bp.x, GROUND_FLOOR_H / 2, bp.z, doorW + 0.6, GROUND_FLOOR_H, nx, nz);
    const fp = posAt(t, 0, (back + recess) / 2);
    const deep = -(back - recess);
    // Igual que el piso de los locales: el giro ya orienta el paño, no se cruzan los lados.
    tint.add('plane', 'glow', LOBBY.floor, new Vector3(fp.x, SIDEWALK_H + 0.31, fp.z), new Vector3(doorW, deep, 1), nz !== 0 ? 0 : Math.PI / 2, Math.PI / 2);
    tint.add('box', 'glow', LOBBY.light, new Vector3(fp.x, GROUND_FLOOR_H - 0.3, fp.z), new Vector3(0.5, 0.06, 0.5));
    // Puerta: marco de madera, hoja vidriada, escalones y luz.
    if (this.full) this.farm.add('box', glass, posAt(t, SIDEWALK_H + 0.3 + doorH / 2, recess - 0.02), size(doorW - 0.2, doorH, 0.06));
    else this.pane(glass, posAt(t, SIDEWALK_H + 0.3 + doorH / 2, recess + 0.01), doorW - 0.2, doorH, nx, nz);
    tint.add('box', 'lit', LOBBY.door, posAt(t, SIDEWALK_H + 0.3 + doorH + 0.04, recess), size(doorW, 0.08, 0.16));
    for (const s of [-1, 1]) tint.add('box', 'lit', LOBBY.door, posAt(t + s * (doorW / 2 - 0.06), SIDEWALK_H + 0.3 + doorH / 2, recess), size(0.12, doorH, 0.16));
    if (this.full) {
      tint.add('box', 'lit', LOBBY.door, posAt(t, SIDEWALK_H + 0.3 + doorH * 0.42, recess), size(doorW - 0.2, 0.09, 0.1));
      tint.add('box', 'lit', LOBBY.door, posAt(t, SIDEWALK_H + 0.3 + doorH / 2, recess), size(0.07, doorH, 0.1));
    }
    // Dos escalones: la entrada sube sobre la vereda.
    this.farm.add('box', plinth, posAt(t, SIDEWALK_H + 0.075, 0.3), size(doorW + 0.4, 0.15, 0.6));
    this.farm.add('box', plinth, posAt(t, SIDEWALK_H + 0.15 + 0.075, (recess - 0.02) / 2), size(doorW, 0.15, -recess));
    // Aplique de luz y portero eléctrico.
    tint.add('box', 'glow', LOBBY.light, posAt(t, SIDEWALK_H + 0.3 + doorH + 0.32, 0.04), size(0.5, 0.12, 0.1));
    tint.add('box', 'lit', LOBBY.brass, posAt(t + doorW / 2 + 0.3, SIDEWALK_H + 1.45, 0.02), size(0.18, 0.32, 0.04));
    if (this.full && rng.chance(0.7)) {
      // Número de la casa.
      tint.add('box', 'lit', LOBBY.brass, posAt(t, SIDEWALK_H + 0.3 + doorH + 0.6, 0.02), size(0.42, 0.14, 0.03));
    }
  }

  private shopSign(
    shop: ShopType,
    t: number,
    bayW: number,
    posAt: (t: number, y: number, dOut?: number) => Vector3,
    size: (long: number, h: number, thick: number) => Vector3,
    alongX: boolean,
    nx: number,
    nz: number,
    px: (t: number, dOut?: number) => number,
    pz: (t: number, dOut?: number) => number,
    rng: Rng,
  ): void {
    const tint = this.tint;
    const bg = hexRgb(shop.sign.bg);
    // Marquesina: la banda del cartel sobre la vidriera, en el color del rubro.
    const y = GROUND_FLOOR_H - 0.42;
    if (this.full) tint.add('box', 'lit', bg, posAt(t, y, 0.08), size(bayW - 0.28, 0.66, 0.2));
    else tint.panel('lit', bg, px(t, 0.18), y, pz(t, 0.18), bayW - 0.28, 0.66, nx, nz);
    this.signs.plate(shop.sign, px(t, 0.19), y, pz(t, 0.19), Math.min(bayW - 0.6, 3.6), 0.46, nx, nz);
    // Cartel bandera, perpendicular: se lee de lejos mirando a lo largo de la vereda.
    if (shop.blade && rng.chance(0.55)) {
      const bt = t + (rng.chance(0.5) ? -1 : 1) * (bayW / 2 - 0.35);
      const by = GROUND_FLOOR_H + 0.55;
      tint.add('box', 'lit', [0.2, 0.2, 0.22], posAt(bt, by + 0.42, 0.45), size(0.06, 0.06, 0.9));
      tint.add('box', 'lit', bg, posAt(bt, by, 0.55), size(0.06, 0.62, 0.86));
      // Las dos caras del cartel miran a lo largo de la calle.
      const ax = alongX ? 1 : 0;
      const az = alongX ? 0 : 1;
      this.signs.plate(shop.sign, px(bt, 0.55) + ax * 0.035, by, pz(bt, 0.55) + az * 0.035, 0.8, 0.4, ax, az, false);
      this.signs.plate(shop.sign, px(bt, 0.55) - ax * 0.035, by, pz(bt, 0.55) - az * 0.035, 0.8, 0.4, -ax, -az, false);
    }
  }

  /** Toldo de lona del local: inclinado, con faldón; a rayas en escritorio. */
  private awning(
    shop: ShopType,
    t: number,
    bayW: number,
    alongX: boolean,
    nx: number,
    nz: number,
    px: (t: number, dOut?: number) => number,
    pz: (t: number, dOut?: number) => number,
    rng: Rng,
  ): void {
    const tint = this.tint;
    const proj = rng.range(1.2, 1.7);
    const slope = 0.32;
    const top = GROUND_FLOOR_H - 0.82;
    const midY = top - Math.sin(slope) * proj * 0.5;
    const w = bayW - 0.35;
    const colors = shop.awning.length ? shop.awning : [[0.6, 0.2, 0.15] as Rgb];
    const stripes = this.full && colors.length > 1 ? Math.max(4, Math.round(w / 0.45)) : 1;
    // Girar sobre el eje de la fachada baja el borde de afuera: +α sobre X
    // baja +Z; −α sobre Z baja +X.
    const rx = alongX ? nz * slope : 0;
    const rz = alongX ? 0 : -nx * slope;
    for (let s = 0; s < stripes; s++) {
      const sw = w / stripes;
      const st = t - w / 2 + sw * (s + 0.5);
      const c = colors[s % colors.length];
      tint.add(
        'box',
        'lit',
        c,
        new Vector3(px(st, proj * 0.5 * Math.cos(slope)), midY, pz(st, proj * 0.5 * Math.cos(slope))),
        alongX ? new Vector3(sw + 0.002, 0.05, proj) : new Vector3(proj, 0.05, sw + 0.002),
        0,
        rx,
        rz,
      );
    }
    // Faldón colgante.
    const edge = proj * Math.cos(slope);
    const lowY = top - Math.sin(slope) * proj;
    tint.panel('lit', colors[0], px(t, edge + 0.01), lowY - 0.15, pz(t, edge + 0.01), w, 0.3, nx, nz);
  }

  /** Lo que el local saca a la vereda: cajones, mesas, baldes de flores, revistero. */
  private outside(
    shop: ShopType,
    t: number,
    bayW: number,
    nx: number,
    nz: number,
    px: (t: number, dOut?: number) => number,
    pz: (t: number, dOut?: number) => number,
    rng: Rng,
  ): void {
    const tint = this.tint;
    const g = SIDEWALK_H;
    const ax = nz !== 0 ? 1 : 0;
    const az = nx !== 0 ? 1 : 0;
    if (shop.outside === 'crates') {
      // Cajones de fruta y verdura en gradas, delante de la vidriera.
      const n = this.full ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const tt = t - bayW * 0.3 + (i * bayW * 0.6) / (n - 1);
        const x = px(tt, 0.55);
        const z = pz(tt, 0.55);
        if (this.full) {
          tint.add('box', 'lit', [0.55, 0.4, 0.24], new Vector3(x, g + 0.32, z), new Vector3(ax * 0.75 + az * 0.55, 0.3, az * 0.75 + ax * 0.55));
          tint.add('box', 'lit', [0.35, 0.28, 0.2], new Vector3(x, g + 0.085, z), new Vector3(ax * 0.7 + az * 0.5, 0.17, az * 0.7 + ax * 0.5));
        }
        if (this.full) {
          tint.add('box', 'lit', rng.pick(shop.products), new Vector3(x, g + 0.5, z), new Vector3(ax * 0.68 + az * 0.48, 0.08, az * 0.68 + ax * 0.48));
        } else {
          // En el visor, un cajón de madera y la mercadería como un paño del
          // color de lo que lleva, apenas sobre el borde. Antes era un cubo
          // macizo del color de la fruta: a un metro parecía un bloque de juguete.
          tint.add('box', 'lit', [0.55, 0.4, 0.24], new Vector3(x, g + 0.225, z), new Vector3(ax * 0.68 + az * 0.48, 0.45, az * 0.68 + ax * 0.48));
          tint.decal(rng.pick(shop.products), x, g + 0.456, z, ax * 0.62 + az * 0.42, az * 0.62 + ax * 0.42);
        }
      }
    } else if (shop.outside === 'tables') {
      // Mesitas de café con dos sillas: la vereda porteña.
      const n = this.full ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const tt = t + (n === 1 ? 0 : (i - 0.5) * bayW * 0.5);
        const x = px(tt, 1.5);
        const z = pz(tt, 1.5);
        tint.add('cylinder', 'lit', [0.85, 0.85, 0.82], new Vector3(x, g + 0.74, z), new Vector3(0.7, 0.04, 0.7));
        tint.add('box', 'lit', [0.2, 0.2, 0.22], new Vector3(x, g + 0.37, z), new Vector3(0.06, 0.74, 0.06));
        this.cafeTables.push({ x, z });
        for (const s of [-1, 1]) {
          const cx = x + ax * s * 0.6;
          const cz = z + az * s * 0.6;
          if (this.full) {
            tint.add('box', 'lit', [0.25, 0.22, 0.2], new Vector3(cx, g + 0.45, cz), new Vector3(0.42, 0.05, 0.42));
            tint.add('box', 'lit', [0.25, 0.22, 0.2], new Vector3(cx + ax * s * 0.2, g + 0.68, cz + az * s * 0.2), new Vector3(ax * 0.05 + az * 0.42, 0.46, az * 0.05 + ax * 0.42));
            tint.add('box', 'lit', [0.2, 0.2, 0.22], new Vector3(cx, g + 0.21, cz), new Vector3(0.36, 0.42, 0.36));
          } else {
            // Silla de madera liviana: asiento, un pie central de caño y el
            // respaldo de un paño por cara, del lado de afuera. Antes era un
            // bloque casi negro de 0,9 m: alrededor de la mesa se leían dos
            // bolardos. Son 28 triángulos por silla y ningún draw call.
            tint.add('box', 'lit', CHAIR_WOOD, new Vector3(cx, g + 0.45, cz), new Vector3(0.42, 0.06, 0.42));
            tint.add('box', 'lit', CHAIR_FRAME, new Vector3(cx, g + 0.21, cz), new Vector3(0.18, 0.42, 0.18));
            const bx = cx + ax * s * 0.2;
            const bz = cz + az * s * 0.2;
            tint.panel('lit', CHAIR_WOOD, bx - ax * s * 0.005, g + 0.7, bz - az * s * 0.005, 0.42, 0.45, -ax * s, -az * s);
            tint.panel('lit', CHAIR_WOOD, bx + ax * s * 0.005, g + 0.7, bz + az * s * 0.005, 0.42, 0.45, ax * s, az * s);
          }
        }
      }
    } else if (shop.outside === 'flowers') {
      const n = this.full ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const tt = t - bayW * 0.32 + (i * bayW * 0.64) / (n - 1);
        const x = px(tt, 0.45);
        const z = pz(tt, 0.45);
        tint.add('cylinder', 'lit', [0.3, 0.32, 0.35], new Vector3(x, g + 0.2, z), new Vector3(0.36, 0.4, 0.36));
        tint.add('cone', 'lit', rng.pick(shop.products), new Vector3(x, g + 0.62, z), new Vector3(0.5, 0.5, 0.5), 0, Math.PI);
      }
    } else if (shop.outside === 'rack') {
      // Exhibidor: revistas, golosinas o bicicletas, contra la vidriera.
      const x = px(t, 0.35);
      const z = pz(t, 0.35);
      tint.add('box', 'lit', [0.3, 0.3, 0.32], new Vector3(x, g + 0.75, z), new Vector3(ax * 1.2 + az * 0.3, 1.5, az * 1.2 + ax * 0.3));
      for (let r = 0; r < (this.full ? 3 : 2); r++) {
        tint.panel('lit', rng.pick(shop.products), x + nx * 0.16, g + 0.45 + r * 0.42, z + nz * 0.16, 1.1, 0.3, nx, nz);
      }
    }
  }

  // ----------------------------------------------------------- plantas altas

  /**
   * Balcones sobre una cara, con la vida de la gente: macetas, ropa tendida
   * y el aire acondicionado colgado.
   */
  balconies(
    cx: number,
    cz: number,
    width: number,
    depth: number,
    face: Face,
    floors: number,
    baseY: number,
    floorH: number,
  ): void {
    const alongX = face === 'north' || face === 'south';
    const span = alongX ? width : depth;
    if (span < 6) return;

    const out = face === 'north' || face === 'east' ? 1 : -1;
    const nx = alongX ? 0 : out;
    const nz = alongX ? out : 0;
    const faceOffset = (alongX ? depth : width) / 2;
    const proj = this.rng.range(1.1, 1.6);
    const rng = this.deco(cx + nx * faceOffset, cz + nz * faceOffset, 23);

    const slab = this.mats.surface(PALETTE.concreteLight, 0.72, 0, 'concrete');
    const rail = this.mats.metal(PALETTE.solarFrame, 0.45);
    const balustrade = this.mats.glass(PALETTE.glassGreen, 0.55);
    const pot = this.mats.foliage(PALETTE.leafMid);
    const tint = this.tint;

    const count = Math.max(1, Math.floor(span / 5.5));
    // Hasta 8 pisos en escritorio; en el visor, los tres primeros (lo que se
    // ve desde la vereda), con la vida de la gente igual.
    const visibleFloors = Math.min(floors, this.full ? 8 : 3);

    for (let f = 0; f < visibleFloors; f++) {
      const y = baseY + f * floorH;
      for (let b = 0; b < count; b++) {
        if (this.rng.chance(0.28)) continue; // no todos tienen balcón
        const t = (b + 0.5) * (span / count) - span / 2;
        const bw = (span / count) * 0.7;

        const bx = alongX ? cx + t : cx + out * (faceOffset + proj / 2);
        const bz = alongX ? cz + out * (faceOffset + proj / 2) : cz + t;
        const along = (d: number) => (alongX ? new Vector3(bx + d, 0, bz) : new Vector3(bx, 0, bz + d));

        this.farm.add('box', slab, new Vector3(bx, y + 0.1, bz), alongX ? new Vector3(bw, 0.2, proj) : new Vector3(proj, 0.2, bw));
        // Baranda: paño de vidrio apoyado en la losa y pasamanos encima.
        const ex = alongX ? bx : bx + (out * (proj - 0.05)) / 2;
        const ez = alongX ? bz + (out * (proj - 0.05)) / 2 : bz;
        if (this.full) this.farm.add('box', balustrade, new Vector3(ex, y + 0.2 + 0.38, ez), alongX ? new Vector3(bw, 0.76, 0.05) : new Vector3(0.05, 0.76, bw));
        else this.pane(balustrade, new Vector3(ex + nx * 0.025, y + 0.2 + 0.38, ez + nz * 0.025), bw, 0.76, nx, nz);
        // Pasamanos (en el visor, su frente solo: a 4 m de altura nadie ve el canto).
        if (this.full) {
          this.farm.add(
            'box',
            rail,
            new Vector3(ex, y + 0.99, ez),
            alongX ? new Vector3(bw + 0.04, 0.06, 0.08) : new Vector3(0.08, 0.06, bw + 0.04),
          );
        } else {
          tint.panel('lit', RAIL_RGB, ex + nx * 0.04, y + 0.99, ez + nz * 0.04, bw + 0.04, 0.07, nx, nz);
        }

        const life = rng.next();
        if (life < 0.45) {
          // Macetas contra la baranda: el verde que cuelga de los balcones.
          const n = this.full ? 3 : 1;
          for (let i = 0; i < n; i++) {
            const p = along(n === 1 ? bw * 0.25 : (i / (n - 1) - 0.5) * bw * 0.7);
            const r = rng.range(0.35, 0.6);
            this.farm.add('box', pot, new Vector3(p.x - nx * proj * 0.18, y + 0.2 + r / 2, p.z - nz * proj * 0.18), new Vector3(r, r, r));
          }
        } else if (life < 0.8) {
          // Ropa tendida en una soga, contra la baranda: sábanas y remeras
          // que asoman por encima del vidrio (lo primero que dice "acá vive alguien").
          const n = this.full ? 4 : 3;
          for (let i = 0; i < n; i++) {
            const p = along((i / (n - 1) - 0.5) * bw * 0.75);
            const h = rng.range(0.55, 0.95);
            const top = y + 1.75;
            const o = proj / 2 - 0.25;
            tint.panel('lit', rng.pick(LAUNDRY), p.x + nx * o, top - h / 2, p.z + nz * o, rng.range(0.45, 0.75), h, nx, nz);
            if (this.full) tint.panel('lit', rng.pick(LAUNDRY), p.x + nx * (o - 0.01), top - h / 2, p.z + nz * (o - 0.01), 0.4, h * 0.9, -nx, -nz);
          }
          // La soga, de punta a punta del balcón.
          const c = along(0);
          if (this.full) tint.add('box', 'lit', [0.85, 0.85, 0.82], new Vector3(c.x + nx * (proj / 2 - 0.25), y + 1.76, c.z + nz * (proj / 2 - 0.25)), alongX ? new Vector3(bw * 0.9, 0.015, 0.015) : new Vector3(0.015, 0.015, bw * 0.9));
          else tint.panel('lit', [0.85, 0.85, 0.82], c.x + nx * (proj / 2 - 0.24), y + 1.76, c.z + nz * (proj / 2 - 0.24), bw * 0.9, 0.02, nx, nz);
        }
        // Equipo exterior del aire acondicionado, en el piso del balcón.
        if (rng.chance(0.35)) {
          const p = along((rng.chance(0.5) ? -1 : 1) * bw * 0.32);
          this.acUnit(p.x - nx * (proj / 2 - 0.25), y + 0.2, p.z - nz * (proj / 2 - 0.25), nx, nz);
        }
      }
    }
  }

  /**
   * Vida en una fachada sin balcones: aires acondicionados colgados bajo las
   * ventanas, como en cualquier frente porteño.
   */
  facadeLife(cx: number, cz: number, width: number, depth: number, face: Face, floors: number, baseY: number, floorH: number): void {
    const alongX = face === 'north' || face === 'south';
    const span = alongX ? width : depth;
    if (span < 5) return;
    const out = face === 'north' || face === 'east' ? 1 : -1;
    const nx = alongX ? 0 : out;
    const nz = alongX ? out : 0;
    const faceOffset = (alongX ? depth : width) / 2 + 0.04;
    const rng = this.deco(cx + nx * faceOffset, cz + nz * faceOffset, 31);
    const per = Math.max(1, Math.round(span / 7));
    for (let f = 0; f < Math.min(floors, this.full ? 9 : 4); f++) {
      for (let i = 0; i < per; i++) {
        if (!rng.chance(0.36)) continue;
        const t = ((i + rng.range(0.2, 0.8)) / per - 0.5) * span * 0.8;
        const x = alongX ? cx + t : cx + nx * faceOffset;
        const z = alongX ? cz + nz * faceOffset : cz + t;
        this.acUnit(x + nx * 0.18, baseY + f * floorH + 0.25, z + nz * 0.18, nx, nz);
      }
    }
  }

  /** Unidad exterior de un aire acondicionado: caja clara con la rejilla oscura. */
  private acUnit(x: number, y: number, z: number, nx: number, nz: number): void {
    const tint = this.tint;
    if (this.full) tint.add('box', 'lit', [0.86, 0.86, 0.84], new Vector3(x, y + 0.28, z), new Vector3(nx !== 0 ? 0.3 : 0.8, 0.56, nx !== 0 ? 0.8 : 0.3));
    // En el visor, el frente solo (a dos metros de la pared nadie ve el canto).
    else tint.panel('lit', [0.86, 0.86, 0.84], x + nx * 0.15, y + 0.28, z + nz * 0.15, 0.8, 0.56, nx, nz);
    tint.panel('lit', [0.18, 0.19, 0.2], x + nx * 0.16, y + 0.28, z + nz * 0.16, 0.42, 0.42, nx, nz);
  }

  /**
   * Paño de vidrio de una sola cara que mira hacia (nx, nz). En el visor
   * reemplaza a la caja de 6 cm: 2 triángulos en vez de 12 (cientos de
   * vidrieras y barandas en todo el barrio) por un draw call más por vidrio.
   * Visto desde la vereda es igual, y con una sola capa el local se ve mejor.
   */
  private pane(mat: Material, pos: Vector3, w: number, h: number, nx: number, nz: number): void {
    // El plano mira a −Z; girar θ sobre Y lo lleva a (−sin θ, −cos θ).
    this.farm.add('plane', mat, pos, new Vector3(w, h, 1), Math.atan2(-nx, -nz));
  }

  // -------------------------------------------------------------------- calle

  /** Cordón de vereda: la línea que separa calzada de vereda. */
  kerb(axis: 'x' | 'z', at: number, laneHalf: number, length: number, center = 0, sides: readonly number[] = [-1, 1], top = 0.17): void {
    const mat = this.mats.surface(PALETTE.concreteShade, 0.9, 0, 'pavement');
    for (const s of sides) {
      const pos = axis === 'x' ? new Vector3(center, top / 2, at + s * laneHalf) : new Vector3(at + s * laneHalf, top / 2, center);
      this.farm.add('box', mat, pos, axis === 'x' ? new Vector3(length, top, 0.32) : new Vector3(0.32, top, length));
    }
  }

  /** Alcorque: el cuadro de tierra alrededor del tronco de un árbol de vereda. */
  treePit(x: number, z: number, groundY = 0): void {
    this.farm.add('box', this.mats.surface(PALETTE.soil, 0.95, 0, null), new Vector3(x, groundY + 0.075, z), new Vector3(1.5, 0.15, 1.5));
    // Borde de hormigón (en el visor, un marco de una pieza bajo la tierra).
    const edge = this.mats.surface(PALETTE.concreteShade, 0.9, 0, 'pavement');
    if (!this.full) {
      this.farm.add('box', edge, new Vector3(x, groundY + 0.06, z), new Vector3(1.9, 0.12, 1.9));
      return;
    }
    for (const [dx, dz, w, d] of [
      [0, -0.85, 1.9, 0.2],
      [0, 0.85, 1.9, 0.2],
      [-0.85, 0, 0.2, 1.9],
      [0.85, 0, 0.2, 1.9],
    ] as const) {
      this.farm.add('box', edge, new Vector3(x + dx, groundY + 0.09, z + dz), new Vector3(w, 0.18, d));
    }
  }

  /** Bicicletero: arcos invertidos. Señal inequívoca de ciudad que pedalea. */
  bikeRack(x: number, z: number, rotY: number, groundY = 0): void {
    const mat = this.mats.metal(PALETTE.solarFrame, 0.45);
    const arcs = this.full ? 4 : 2;
    for (let i = 0; i < arcs; i++) {
      const o = (i - (arcs - 1) / 2) * 0.75;
      const ox = Math.cos(rotY) * o;
      const oz = -Math.sin(rotY) * o;
      // Dos montantes y un travesaño: la "U" invertida clásica, perpendicular
      // a la fila (eje Z local de la fila girada rotY: (sin, cos)).
      for (const s of [-1, 1]) {
        // Montantes: cilindros en escritorio; en el visor, cajas finas (la
        // mitad de triángulos y a esa distancia no se distinguen).
        this.farm.add(
          this.full ? 'cylinder' : 'box',
          mat,
          new Vector3(x + ox + Math.sin(rotY) * s * 0.35, groundY + 0.35, z + oz + Math.cos(rotY) * s * 0.35),
          new Vector3(0.07, 0.7, 0.07),
          rotY,
        );
      }
      this.farm.add('box', mat, new Vector3(x + ox, groundY + 0.7, z + oz), new Vector3(0.07, 0.07, 0.78), rotY);
    }
  }

  /** Bolardo: separa vereda de calzada en los cruces. */
  bollard(x: number, z: number, groundY = 0): void {
    this.farm.add('cylinder', this.mats.metal(PALETTE.solarFrame, 0.45), new Vector3(x, groundY + 0.45, z), new Vector3(0.14, 0.9, 0.14));
  }

  /** Parada de colectivo: refugio con banco, techo solar, cartel y mapa. */
  tramStop(x: number, z: number, rotY: number, groundY = 0): void {
    const post = this.mats.metal(PALETTE.solarFrame, 0.45);
    const roof = this.mats.solar();
    const bench = this.mats.surface(PALETTE.timberLight, 0.85, 0, 'timber');

    // Ejes locales de una caja girada `rotY` en Babylon: X → (cos, −sin),
    // Z → (sin, cos). Los parantes van sobre la línea del respaldo de vidrio,
    // así sostienen techo y vidrio.
    const lx = (a: number, b: number) => x + Math.cos(rotY) * a + Math.sin(rotY) * b;
    const lz = (a: number, b: number) => z - Math.sin(rotY) * a + Math.cos(rotY) * b;
    for (const s of [-1, 1]) {
      this.farm.add('cylinder', post, new Vector3(lx(s * 2.2, 0.78), groundY + 1.33, lz(s * 2.2, 0.78)), new Vector3(0.12, 2.66, 0.12));
    }
    this.farm.add('box', roof, new Vector3(x, groundY + 2.68, z), new Vector3(5, 0.12, 1.9), rotY, 0, -0.06);
    this.farm.add('box', this.mats.glass(PALETTE.glassGreen, 0.55), new Vector3(lx(0, 0.78), groundY + 1.4, lz(0, 0.78)), new Vector3(4.3, 1.8, 0.06), rotY);
    this.farm.add('box', bench, new Vector3(lx(0, 0.35), groundY + 0.46, lz(0, 0.35)), new Vector3(3.6, 0.1, 0.5), rotY);
    for (const s of [-1, 1]) {
      this.farm.add('box', post, new Vector3(lx(s * 1.5, 0.35), groundY + 0.21, lz(s * 1.5, 0.35)), new Vector3(0.08, 0.42, 0.42), rotY);
    }
    // Mapa del barrio encendido en un extremo y el poste con la chapa de la
    // línea en el otro: así se lee "parada" y no "banco con techo".
    const tint = this.tint;
    tint.add('box', 'glow', [0.85, 0.88, 0.8], new Vector3(lx(2.05, 0.74), groundY + 1.35, lz(2.05, 0.74)), new Vector3(0.7, 1.3, 0.05), rotY);
    this.farm.add('cylinder', post, new Vector3(lx(-2.9, -0.3), groundY + 1.4, lz(-2.9, -0.3)), new Vector3(0.08, 2.8, 0.08));
    tint.add('box', 'lit', [0.95, 0.75, 0.15], new Vector3(lx(-2.9, -0.3), groundY + 2.55, lz(-2.9, -0.3)), new Vector3(0.55, 0.4, 0.04), rotY);
    this.signs.plate({ text: 'PARADA', bg: '#f2c01e', fg: '#1b1b1b' }, lx(-2.9, -0.33), groundY + 2.55, lz(-2.9, -0.33), 0.5, 0.18, -Math.sin(rotY), -Math.cos(rotY), true);
  }

  /** Farola de calle: columna, brazo hacia la calzada y luminaria cálida. */
  streetLamp(x: number, z: number, ax: number, az: number, groundY = 0): void {
    const h = 6.2;
    const pole = this.mats.metal(PALETTE.solarFrame, 0.45);
    this.farm.add('cylinder', pole, new Vector3(x, groundY + h / 2, z), new Vector3(0.16, h, 0.16));
    // Base más gruesa: la columna no sale del piso como un palito.
    if (this.full) this.farm.add('cylinder', pole, new Vector3(x, groundY + 0.4, z), new Vector3(0.28, 0.8, 0.28));
    // Brazo hacia la calzada y la luminaria colgando de la punta.
    this.farm.add('box', pole, new Vector3(x + ax * 0.75, groundY + h - 0.05, z + az * 0.75), new Vector3(ax !== 0 ? 1.5 : 0.08, 0.08, az !== 0 ? 1.5 : 0.08));
    this.farm.add('box', this.mats.glow(PALETTE.sun, 0.55), new Vector3(x + ax * 1.35, groundY + h - 0.18, z + az * 1.35), new Vector3(ax !== 0 ? 0.6 : 0.3, 0.12, az !== 0 ? 0.6 : 0.3));
    // Panel solar sobre la luminaria.
    if (this.full) this.tint.add('box', 'lit', [0.2, 0.27, 0.45], new Vector3(x + ax * 1.35, groundY + h + 0.04, z + az * 1.35), new Vector3(ax !== 0 ? 0.75 : 0.5, 0.04, az !== 0 ? 0.75 : 0.5));
  }

  /** Poste de esquina con las chapas de nomenclatura de las dos calles. */
  streetSigns(x: number, z: number, names: ReadonlyArray<{ text: string; ax: number; az: number }>, groundY = 0): void {
    const pole = this.mats.metal(PALETTE.solarFrame, 0.45);
    this.farm.add('cylinder', pole, new Vector3(x, groundY + 1.45, z), new Vector3(0.08, 2.9, 0.08));
    names.forEach((n, i) => {
      const y = groundY + 2.72 - i * 0.26;
      // La chapa corre a lo largo de su calle: se lee desde la vereda de enfrente.
      const cx = x + n.ax * 0.45;
      const cz = z + n.az * 0.45;
      if (this.full) this.tint.add('box', 'lit', [0.12, 0.3, 0.56], new Vector3(cx, y, cz), new Vector3(n.ax !== 0 ? 0.92 : 0.03, 0.22, n.az !== 0 ? 0.92 : 0.03));
      this.signs.plate({ text: n.text.toUpperCase(), ...STREET_SIGN }, cx + n.az * 0.018, y, cz + n.ax * 0.018, 0.88, 0.19, n.az, n.ax);
      this.signs.plate({ text: n.text.toUpperCase(), ...STREET_SIGN }, cx - n.az * 0.018, y, cz - n.ax * 0.018, 0.88, 0.19, -n.az, -n.ax);
    });
  }

  /**
   * Kiosco de diarios y revistas sobre la vereda, verde, con las revistas
   * colgadas y el toldito: un clásico de las esquinas de Buenos Aires.
   */
  newsKiosk(x: number, z: number, nx: number, nz: number, groundY = 0): void {
    const tint = this.tint;
    const green: Rgb = [0.12, 0.33, 0.24];
    const side = nx !== 0;
    const w = 2.4;
    const d = 1.5;
    tint.add('box', 'lit', green, new Vector3(x, groundY + 1.1, z), new Vector3(side ? d : w, 2.2, side ? w : d));
    tint.add('box', 'lit', [0.1, 0.25, 0.18], new Vector3(x, groundY + 2.3, z), new Vector3((side ? d : w) + 0.5, 0.18, (side ? w : d) + 0.5));
    // Frente abierto: las revistas en tres filas y el puestero detrás.
    const fx = x + nx * (d / 2 + 0.01);
    const fz = z + nz * (d / 2 + 0.01);
    tint.panel('glow', [0.55, 0.5, 0.42], fx, groundY + 1.45, fz, w - 0.3, 1.1, nx, nz);
    const colors: Rgb[] = [
      [0.9, 0.25, 0.2],
      [0.2, 0.45, 0.85],
      [0.95, 0.85, 0.2],
      [0.95, 0.95, 0.92],
      [0.3, 0.7, 0.4],
    ];
    const rng = this.deco(x, z, 41);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < (this.full ? 4 : 2); c++) {
        const cols = this.full ? 4 : 2;
        const along = ((c + 0.5) / cols - 0.5) * (w - 0.5);
        tint.panel('glow', rng.pick(colors), fx + nx * 0.02 + (side ? 0 : along), groundY + 1.05 + r * 0.38, fz + nz * 0.02 + (side ? along : 0), (w - 0.6) / cols, 0.3, nx, nz);
      }
    }
    this.signs.plate({ text: 'DIARIOS · REVISTAS', bg: '#123d2b', fg: '#f4e9c6' }, x + nx * (d / 2 + 0.27), groundY + 2.3, z + nz * (d / 2 + 0.27), w + 0.3, 0.17, nx, nz);
  }

  /**
   * Equipamiento de azotea: tanques de agua, conductos y antenas.
   *
   * Es lo que hace que un techo se lea como un techo y no como una tapa. Los
   * tanques de agua están sobre casi todos los techos de Buenos Aires: se ven
   * desde la calle asomando sobre las cornisas, y desde los patios y el aire.
   */
  roofClutter(cx: number, cz: number, width: number, depth: number, y: number): void {
    if (width < 6 || depth < 6) return;
    const tint = this.tint;
    const rng = this.deco(cx, cz + y, 53);
    const tanks = this.full ? rng.int(1, 3) : rng.int(1, 2);
    // Tanque negro de plástico, beige de fibra o de hormigón gris.
    const TANK: Rgb[] = [
      [0.12, 0.12, 0.13],
      [0.78, 0.72, 0.6],
      [0.6, 0.6, 0.58],
    ];
    for (let i = 0; i < tanks; i++) {
      const tx = cx + rng.range(-width * 0.3, width * 0.3);
      const tz = cz + rng.range(-depth * 0.3, depth * 0.3);
      const r = rng.range(0.55, 0.9);
      const h = rng.range(1.1, 1.7);
      // Base de ladrillo bajo el tanque (en el visor, el tanque más alto, solo).
      const base = this.full ? 0.7 : 0;
      if (this.full) tint.add('box', 'lit', [0.62, 0.38, 0.3], new Vector3(tx, y + 0.35, tz), new Vector3(r * 2.1, 0.7, r * 2.1));
      tint.add('cylinder', 'lit', rng.pick(TANK), new Vector3(tx, y + base + (h + 0.7 - base) / 2, tz), new Vector3(r * 2, h + 0.7 - base, r * 2));
    }
    // Conductos y salidas de ventilación.
    const ducts = this.full ? rng.int(1, 3) : 1;
    for (let i = 0; i < ducts; i++) {
      tint.boxOn('lit', [0.72, 0.7, 0.66], cx + rng.range(-width * 0.32, width * 0.32), cz + rng.range(-depth * 0.32, depth * 0.32), rng.range(0.8, 2.2), rng.range(0.5, 0.9), rng.range(0.6, 1.2), y, rng.range(0, Math.PI));
    }
    // Antena o mástil, y alguna parabólica.
    if (rng.chance(0.55)) {
      const h = rng.range(2.5, 5);
      const ax = cx + rng.range(-width * 0.3, width * 0.3);
      const az = cz + rng.range(-depth * 0.3, depth * 0.3);
      tint.add('cylinder', 'lit', [0.55, 0.56, 0.58], new Vector3(ax, y + h / 2, az), new Vector3(0.07, h, 0.07));
      const yaw = rng.range(0, Math.PI);
      if (this.full) tint.add('box', 'lit', [0.55, 0.56, 0.58], new Vector3(ax, y + h * 0.85, az), new Vector3(1.2, 0.04, 0.04), yaw);
    }
    if (this.full && rng.chance(0.4)) {
      tint.add('cylinder', 'lit', [0.88, 0.88, 0.86], new Vector3(cx + rng.range(-width * 0.3, width * 0.3), y + 0.8, cz + rng.range(-depth * 0.3, depth * 0.3)), new Vector3(0.8, 0.06, 0.8), 0, 0.6);
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
    this.farm.addBoxOnGround(this.mats.surface(PALETTE.concreteLight, 0.72, 0, 'concrete'), cx, cz, width + 0.85, 0.34, depth + 0.85, y - 0.34);
  }

  /** Cesto de basura con separación de residuos. */
  bin(x: number, z: number, groundY = 0): void {
    const tint = this.tint;
    tint.add('cylinder', 'lit', [0.3, 0.32, 0.33], new Vector3(x, groundY + 0.42, z), new Vector3(0.46, 0.84, 0.46));
    tint.add('cylinder', 'lit', [0.2, 0.5, 0.3], new Vector3(x, groundY + 0.88, z), new Vector3(0.5, 0.1, 0.5));
  }

  /** Banco de madera con patas de hierro. */
  bench(x: number, z: number, rotY: number, groundY = 0): void {
    const mat = this.mats.surface(PALETTE.timberLight, 0.85, 0, 'timber');
    this.farm.add('box', mat, new Vector3(x, groundY + 0.45, z), new Vector3(1.9, 0.08, 0.5), rotY);
    // Respaldo: tablas inclinadas detrás del asiento (eje Z local: (sin, cos)).
    this.farm.add('box', mat, new Vector3(x - Math.sin(rotY) * 0.24, groundY + 0.78, z - Math.cos(rotY) * 0.24), new Vector3(1.9, 0.32, 0.05), rotY, -0.18);
    // Patas de hierro (en el visor, un solo bastidor bajo el asiento).
    if (!this.full) {
      this.tint.add('box', 'lit', [0.18, 0.19, 0.2], new Vector3(x, groundY + 0.21, z), new Vector3(1.5, 0.42, 0.3), rotY);
      return;
    }
    for (const s of [-1, 1]) {
      // El eje X local de una caja girada `rotY` apunta a (cos, −sin).
      this.tint.add('box', 'lit', [0.18, 0.19, 0.2], new Vector3(x + Math.cos(rotY) * s * 0.8, groundY + 0.22, z - Math.sin(rotY) * s * 0.8), new Vector3(0.06, 0.44, 0.48), rotY);
    }
  }
}

/** "#rrggbb" → [r, g, b] en 0..1. */
export function hexRgb(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
