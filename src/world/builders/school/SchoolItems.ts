import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import { polygonArea, subtractRects } from '../PrismBatch';
import {
  CEILING_H,
  FURNITURE,
  ITEMS,
  LEVEL_Y,
  MC_COS,
  MC_SLOPE,
  ROOMS,
  SCHOOL,
  U,
  U1,
  UPPER,
  V1,
  WALLS,
  ceilingHeight,
  chairScaleOf,
  deskTopOf,
  inPoly,
  makerWallAt,
  miguelCaneU,
  planV,
  roomAt,
  roomLevel,
  toWorld,
  voidsAt,
  wallGapBehind,
  type Item,
  type Level,
  type P,
  type Room,
} from '../../SchoolLayout';
import { SWITCHABLE_ROOMS, type Fixture } from '../../SchoolLights';
import { FY, faceDir, type SchoolKit } from './SchoolKit';
import { STYLES } from './SchoolMaterials';

/** Ambientes de paso (por nombre): llevan luz lineal continua a lo largo. */
const CORRIDOR: ReadonlySet<string> = new Set(['Pasillo', 'Galería', 'Pasarela']);

/**
 * Equipamiento e interiores de la escuela: cada ítem del plano que no es de
 * exterior (`item`), sillas, bicicletas, pizarras, luminarias, cielorrasos y
 * la pared del Aula Maker. Dibuja con el kit compartido (`SchoolKit`).
 */
export class SchoolItems {
  constructor(private readonly k: SchoolKit) {}

  // ============================================================ equipamiento

  item(it: Item): void {
    const m = this.k.m;
    const { u, v, w, d } = it;
    const level = it.level ?? 0;
    const room = roomAt(u, v, level);
    // Piso del nivel del objeto: todo lo que sigue se apoya en `FY`.
    const FY = LEVEL_Y[level];
    this.k.fy = FY;
    const alongV = it.face === 'e' || it.face === 'w';
    switch (it.kind) {
      case 'desk': {
        // Escuela 2050: tapa (madera o laminado de color) sobre dos laterales
        // en U de caño fino (patas y patín en el piso) y una tablet apoyada
        // del lado de quien se sienta. Talle de primaria en 2º a 6º grado.
        // Antes, en el visor, los dos laterales eran placas macizas de
        // 40 × 70 cm: de frente se leían como bloques negros bajo cada banco.
        const top = deskTopOf(it) - 0.04;
        this.k.box(this.k.mat(it.color, m.timber), u, v, w, 0.04, d, FY + top);
        // Laterales en los extremos del lado largo; cada U cruza el lado corto.
        this.uLegs(u, v, w, d, top, 0.05, alongV ? 'v' : 'u', this.k.detailed);
        this.tablet(u, v, w, d, it.face, FY + top + 0.04);
        break;
      }
      case 'chair': {
        const mat = room?.id === 'tecnologia' ? m.chairBlue : room?.id === 'teatro' ? m.black : m.chairGreen;
        // Las sillitas del jardín (36 cm en el plano) son de talle chico: antes
        // se dibujaban de adulto junto a mesas de adulto. En primaria, de
        // talle de primaria (menos la del docente).
        this.chair(this.k.mat(it.color, mat), u, v, it.face, chairScaleOf(it));
        break;
      }
      case 'table': {
        // Mesa de aula 2050: tapa sobre dos laterales en U de caño fino (en
        // el visor, sin el patín: sólo las cuatro patas). Las placas macizas
        // de antes se leían como bloques negros en el visor.
        const top = deskTopOf(it) - 0.04;
        this.k.box(this.k.mat(it.color, m.timber), u, v, w, 0.04, d, FY + top);
        this.uLegs(u, v, w, d, top, 0.08, w >= d ? 'u' : 'v', this.k.detailed);
        // Bastidor de caño bajo la tapa, a lo largo (sin él la tapa parecía
        // apoyada en cuatro palitos sueltos).
        if (this.k.detailed) {
          for (const s of [-1, 1]) {
            if (w >= d) this.k.box(m.metalDark, u, v + s * (d / 2 - 0.08), w - 0.2, 0.05, 0.02, FY + top - 0.05);
            else this.k.box(m.metalDark, u + s * (w / 2 - 0.08), v, 0.02, 0.05, d - 0.2, FY + top - 0.05);
          }
        }
        break;
      }
      case 'teacherDesk': {
        this.k.box(m.timberDark, u, v, w, 0.05, d, FY + 0.73);
        if (alongV) {
          for (const s of [-1, 1]) this.k.box(m.timberDark, u, v + s * (d / 2 - 0.03), w, 0.73, 0.05, FY);
        } else {
          for (const s of [-1, 1]) this.k.box(m.timberDark, u + s * (w / 2 - 0.03), v, 0.05, 0.73, d, FY);
        }
        // Faldón del lado de los alumnos (el docente se sienta del otro).
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        const span = (alongV ? d : w) - 0.1;
        this.k.box(m.timberDark, u + fu * (depth / 2 - 0.04), v + fv * (depth / 2 - 0.04), alongV ? 0.025 : span, 0.55, alongV ? span : 0.025, FY + 0.18);
        break;
      }
      case 'hexTable':
      case 'roundTable': {
        const top = this.k.mat(it.color, it.kind === 'hexTable' ? m.timber : m.blue);
        const hgt = (it.kind === 'hexTable' ? FURNITURE.tableTop : FURNITURE.smallTable) - 0.05;
        this.k.cyl(top, u, v, w, 0.05, FY + hgt, true);
        this.k.box(m.metalDark, u, v, 0.08, hgt, 0.08, FY);
        // Pie en cruz en el piso: con un solo poste la mesa no se sostendría.
        if (this.k.detailed) {
          this.k.box(m.metalDark, u, v, w * 0.6, 0.03, 0.06, FY);
          this.k.box(m.metalDark, u, v, 0.06, 0.03, w * 0.6, FY);
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
        // Escuela 2050: la pizarra blanca pasa a ser una pantalla de vidrio
        // oscuro con marco grafito fino (el contenido lo pone `SchoolIdentity`).
        this.screen(it, FY + FURNITURE.boardBottom, FURNITURE.boardTop - FURNITURE.boardBottom);
        break;
      case 'shelf': {
        const mat = this.k.mat(it.color, room?.id === 'jardin' ? m.appliance : m.timberDark);
        const levels = [0.5, 0.95, 1.4];
        // Mismo azar en escritorio y en VR (la semilla tiene que dar lo mismo).
        const picks = levels.map(() => this.k.rng.pick([m.red, m.navy, m.chairGreen, m.timber]));
        if (!this.k.detailed) {
          this.k.box(mat, u, v, w, 1.85, d, FY);
          levels.forEach((y, k) => {
            if (alongV) this.k.box(picks[k], u, v, w + 0.02, 0.28, d - 0.2, FY + y);
            else this.k.box(picks[k], u, v, w - 0.2, 0.28, d + 0.02, FY + y);
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
          this.k.box(mt, u + (alongV ? 0 : a) + fu * off, v + (alongV ? a : 0) + fv * off, alongV ? dep : l, h, alongV ? l : dep, y);
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
        const body = this.k.mat(it.color, buffet ? m.black : m.appliance);
        const [fu, fv] = faceDir(it.face);
        const along = alongV ? d : w;
        this.k.box(m.metalDark, u - fu * 0.03, v - fv * 0.03, alongV ? w - 0.06 : w, 0.1, alongV ? d : d - 0.06, FY);
        this.k.box(body, u, v, w, 0.82, d, FY + 0.1);
        this.k.box(buffet ? m.timberDark : m.black, u, v, w + 0.04, 0.04, d + 0.04, FY + 0.92);
        const doors = Math.max(1, Math.round(along / 0.6));
        for (let k = 1; k < doors; k++) {
          const t = (k / doors - 0.5) * along;
          const half = (alongV ? w : d) / 2;
          this.k.box(m.metalDark, u + (alongV ? fu * half : t), v + (alongV ? t : fv * half), alongV ? 0.012 : 0.012, 0.74, 0.012, FY + 0.14);
        }
        break;
      }
      case 'fridge': {
        this.k.box(m.appliance, u, v, w, 1.9, d, FY);
        this.k.box(m.glass, u - 0.36, v, 0.02, 1.6, d - 0.1, FY + 0.15);
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
            this.k.box(m.frame, u + fu * off, v + fv * off, alongV ? 0.07 : len, h, alongV ? len : 0.07, FY + y);
          for (let k = 0; k < 4; k++) slat(dep / 2 - 0.06 - k * 0.11, 0.42, 0.03);
          for (let k = 0; k < 3; k++) slat(-dep / 2 + 0.03, 0.55 + k * 0.12, 0.07);
          for (const sgn of [-1, 1]) {
            const a = sgn * (len / 2 - 0.15);
            this.k.box(m.metalDark, u + (alongV ? 0 : a), v + (alongV ? a : 0), alongV ? dep - 0.04 : 0.05, 0.42, alongV ? 0.05 : dep - 0.04, FY);
            this.k.box(m.metalDark, u + (alongV ? 0 : a) - fu * (dep / 2 - 0.03), v + (alongV ? a : 0) - fv * (dep / 2 - 0.03), 0.05, 0.45, 0.05, FY + 0.42);
          }
          break;
        }
        const mat = this.k.mat(it.color, room?.id === 'buffet' ? m.timberDark : m.red);
        this.k.box(mat, u, v, w, 0.06, d, FY + 0.42);
        for (const s of [-1, 1]) {
          if (w >= d) this.k.box(m.metalDark, u + s * (w / 2 - 0.12), v, 0.06, 0.42, d - 0.06, FY);
          else this.k.box(m.metalDark, u, v + s * (d / 2 - 0.12), w - 0.06, 0.42, 0.06, FY);
        }
        break;
      }
      case 'column': {
        // Columnas de sección cuadrada: comparten malla con el resto de las
        // cajas de su color (un cilindro por color sería un draw call más).
        const mat = room?.id === 'salon' ? m.red : room?.id === 'tecnologia' ? m.blue : m.chairGreen;
        this.k.box(mat, u, v, w, 3.22 - FY, d, FY);
        break;
      }
      case 'mirror': {
        const mh = it.h ?? 1.9;
        this.k.box(it.color ? m.mirrorGlass : m.mirror, u, v, w, mh, d, FY + 0.25);
        const len = alongV ? d : w;
        const [fu, fv] = faceDir(it.face);
        if (it.color) {
          // Marco de color (rojo en el aula de danzas).
          const fm = this.k.m[it.color];
          for (const sgn of [-1, 1]) {
            if (alongV) this.k.box(fm, u, v + (sgn * len) / 2, w + 0.03, mh + 0.08, 0.06, FY + 0.21);
            else this.k.box(fm, u + (sgn * len) / 2, v, 0.06, mh + 0.08, d + 0.03, FY + 0.21);
          }
          for (const y of [FY + 0.21, FY + 0.25 + mh]) {
            this.k.box(fm, u, v, alongV ? w + 0.03 : len + 0.06, 0.06, alongV ? len + 0.06 : d + 0.03, y);
          }
        } else if (wallGapBehind(level, u - (fu * w) / 2, v - (fv * d) / 2, it.face) > 0.1) {
          // Espejo de pie (lejos del muro): parantes negros y patas en escuadra
          // hacia atrás, en vez de un vidrio flotando a 25 cm del piso.
          for (const sgn of [-1, 1]) {
            const eu = u + (alongV ? 0 : (sgn * (len + 0.03)) / 2);
            const ev = v + (alongV ? (sgn * (len + 0.03)) / 2 : 0);
            this.k.box(m.metalDark, eu, ev, 0.03, mh + 0.28, 0.03, FY);
            this.k.box(m.metalDark, eu - fu * 0.15, ev - fv * 0.15, alongV ? 0.32 : 0.03, 0.03, alongV ? 0.03 : 0.32, FY);
          }
          for (const y of [FY + 0.22, FY + 0.25 + mh]) {
            this.k.box(m.metalDark, u, v, alongV ? 0.03 : len + 0.06, 0.03, alongV ? len + 0.06 : 0.03, y);
          }
        }
        break;
      }
      case 'barre': {
        // Barra de ballet: pasamano a 1 m sobre parantes cada ~2 m.
        const rail = this.k.mat(it.color, m.timber);
        const len = alongV ? d : w;
        this.k.box(rail, u, v, alongV ? 0.05 : len, 0.05, alongV ? len : 0.05, FY + 1.0);
        const n = Math.max(1, Math.round(len / 2));
        for (let k = 0; k <= n; k++) {
          const t = k / n - 0.5;
          this.k.box(m.metalDark, u + (alongV ? 0 : t * len), v + (alongV ? t * len : 0), 0.04, 1.02, 0.04, FY);
        }
        break;
      }
      case 'stall': {
        // Cubículo: dos tabiques, frente con puerta entornada e inodoro.
        for (const s of [-1, 1]) this.k.box(m.frame, u, v + s * (d / 2), w, 1.9, 0.04, FY + 0.12);
        this.k.box(m.leaf, u - w / 2, v - 0.18, 0.04, 1.8, d - 0.45, FY + 0.12);
        // Escuela 2050: inodoro suspendido. Pared técnica de 12 cm hasta
        // 1,05 m (aloja la mochila) con remate grafito, taza colgada a 22 cm
        // del piso con su tapa y pulsador grafito con un punto de luz. Antes
        // era un cubo blanco apoyado en el piso.
        const back = u + w / 2 - 0.02;
        const span = d - 0.08;
        this.k.box(m.appliance, back - 0.06, v, 0.12, 1.05, span, FY);
        this.k.box(m.graphite, back - 0.06, v, 0.13, 0.02, span + 0.01, FY + 1.05);
        this.k.box(m.appliance, back - 0.12 - 0.26, v, 0.52, 0.2, 0.36, FY + 0.22);
        this.k.box(m.board, back - 0.12 - 0.25, v, 0.48, 0.025, 0.37, FY + 0.42);
        this.k.box(m.graphite, back - 0.125, v, 0.012, 0.15, 0.22, FY + 0.82);
        this.k.box(m.light, back - 0.133, v + 0.07, 0.006, 0.02, 0.02, FY + 0.885);
        // Los tabiques se separan 12 cm del piso sobre patas de acero (antes
        // flotaban en el aire).
        if (this.k.detailed) {
          for (const s of [-1, 1]) {
            for (const e of [-1, 1]) this.k.box(m.metal, u + e * (w / 2 - 0.08), v + s * (d / 2), 0.03, 0.12, 0.03, FY);
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
          this.k.box(mat, u + fu * off, v + fv * off, alongV ? t : len, hgt, alongV ? len : t, y0);
        this.k.box(m.black, u, v, w, 0.62, d, FY);
        thin(depth / 2 + 0.01, 0.02, span, FY, 0.6, m.black);
        thin(-(depth / 2 - 0.06), 0.04, span - 0.1, FY + 0.62, FURNITURE.backdrop, m.black);
        break;
      }
      case 'curtain': {
        // Telón rojo recogido a los costados y bambalina contra el cielorraso
        // de su ambiente (antes iba a una altura fija de planta baja: en el SUM
        // del 2º piso la bambalina quedaba dos pisos más abajo).
        const ceil = FY + (room ? ceilingHeight(room) : 3.1) - 0.03;
        for (const s of [-1, 1]) this.k.box(m.curtainRed, u + s * (w / 2 - 0.35), v, 0.7, ceil - (FY + 0.62), 0.16, FY + 0.62);
        this.k.box(m.curtainRed, u, v, w, 0.45, 0.18, ceil - 0.45);
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
          this.k.box(m.red, cu, cv, bw, 1.02, bd, FY);
          this.k.box(m.board, cu, cv, onV ? 0.3 : len + 0.04, 0.04, onV ? len + 0.04 : 0.3, FY + 1.02);
          this.k.box(m.glass, cu, cv, onV ? 0.02 : len, 1.3, onV ? len : 0.02, FY + 1.06);
          const n = Math.max(1, Math.round(len / 1.0));
          for (let k = 0; k <= n; k++) {
            const t = k / n - 0.5;
            this.k.box(m.frame, cu + (onV ? 0 : t * len), cv + (onV ? t * len : 0), 0.05, 1.34, 0.05, FY + 1.06);
          }
          this.k.box(m.frame, cu, cv, onV ? 0.08 : len, 0.06, onV ? len : 0.08, FY + 2.36);
        }
        this.k.box(m.board, u, v, w, 0.06, d, FY + 2.42);
        break;
      }
      case 'playhouse': {
        const jardin = room?.id === 'jardin';
        const body = this.k.mat(it.color, jardin ? m.yellow : m.timber);
        this.k.box(body, u, v, w, 1.3, d, FY);
        this.k.box(m.bars, u, v - d / 2, w * 0.35, 0.9, 0.02, FY + 0.1);
        const p = toWorld(this.k.f, u, v);
        for (const s of [-1, 1]) {
          this.k.farm.add(
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
        this.k.prisms.alongU(
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
        if (alongV) this.k.box(m.metalDark, u, v, 0.25, 0.08, w, FY);
        else this.k.box(m.metalDark, u, v, w, 0.08, 0.25, FY);
        this.k.box(m.metalDark, u, v, 0.03, 2.2, 0.03, FY);
        break;
      }
      case 'lockers': {
        // Cuatro puertas: juntas verticales, rejilla de ventilación arriba y
        // manija en cada una. Las juntas siguen al frente (antes, en los que
        // miran al este, cortaban el costado del mueble en vez del frente).
        // Escuela 2050: bajo las ventanas los lockers son bajos (`h` 1,35 m,
        // con tapa de madera), y cada puerta tiene su tira de estado: una
        // línea de luz cálida corrida bajo la tapa y, de cerca, un punto
        // verde junto a la manija (cerradura electrónica libre).
        const span = alongV ? d : w;
        const [fu, fv] = faceDir(it.face);
        const depth = alongV ? w : d;
        const H = it.h ?? 1.8;
        this.k.box(this.k.mat(it.color, m.navy), u, v, w, H, d, FY);
        const front = (a: number, off: number, l: number, y: number, h: number, mt: Material, dep = 0.02) =>
          this.k.box(mt, u + (alongV ? 0 : a) + fu * off, v + (alongV ? a : 0) + fv * off, alongV ? dep : l, h, alongV ? l : dep, y);
        for (let k = 1; k < 4; k++) front(-span / 2 + (k * span) / 4, depth / 2, 0.012, FY + 0.05, H - 0.1, m.bars);
        if (H < 1.6) {
          // Tapa de madera que vuela 2 cm (sin caras en el plano del cuerpo).
          this.k.box(m.timber, u, v, w + 0.04, 0.03, d + 0.04, FY + H);
        }
        front(0, depth / 2 + 0.003, span - 0.06, FY + H - 0.07, 0.012, m.ledWarm, 0.008);
        if (this.k.detailed) {
          for (let k = 0; k < 4; k++) {
            const c = -span / 2 + ((k + 0.5) * span) / 4;
            // Tres ranuras finas de ventilación arriba de cada puerta.
            for (const y of [0.28, 0.24, 0.2]) front(c, depth / 2, span / 4 - 0.2, FY + H - y, 0.012, m.bars, 0.008);
            front(c + span / 8 - 0.07, depth / 2 + 0.01, 0.02, FY + H * 0.53, 0.12, m.metal, 0.03);
            front(c + span / 8 - 0.07, depth / 2 + 0.013, 0.012, FY + H * 0.53 + 0.16, 0.012, m.exitSign, 0.008);
          }
        }
        break;
      }
      // ------------------------------------------------ recorrido 2020
      case 'extinguisher': {
        const y = FY + (it.y ?? 0.95);
        this.k.cyl(m.red, u, v, 0.17, 0.52, y, true);
        this.k.box(m.metalDark, u, v, 0.08, 0.12, 0.08, y + 0.52);
        // Nicho de seguridad 2050: placa grafito contra el muro con un filo de
        // luz alrededor (una placa emisiva 1,5 cm más grande, detrás).
        const gap = wallGapBehind(level, u, v, it.face);
        if (Number.isFinite(gap) && gap < 0.2) {
          const [nu, nv] = faceDir(it.face);
          const plate = (mat: Material, off: number, t: number, wid: number, y0: number, h: number) =>
            this.k.box(mat, u + nu * (off + t / 2 - gap), v + nv * (off + t / 2 - gap), alongV ? t : wid, h, alongV ? wid : t, y0);
          plate(m.light, 0, 0.008, 0.36, y - 0.16, 0.95);
          plate(m.graphite, 0, 0.014, 0.33, y - 0.145, 0.92);
        }
        break;
      }
      case 'fan': {
        // Escuela 2050: el ventilador de pared pasa a ser una rejilla lineal
        // de aire en el cielorraso, a 45 cm del muro y paralela a él.
        const [nu, nv] = faceDir(it.face);
        const gu = u + nu * 0.45;
        const gv = v + nv * 0.45;
        this.slot(gu, gv, !alongV, 1.0, this.overhead(gu, gv, level, room).y);
        break;
      }
      case 'ac': {
        const y = FY + (it.y ?? 2.45);
        this.k.box(m.frame, u, v, alongV ? 0.22 : 0.86, 0.29, alongV ? 0.86 : 0.22, y);
        // Boca de salida del aire, oscura, en el frente inferior del split.
        const [nu, nv] = faceDir(it.face);
        if (this.k.detailed) this.k.box(m.metalDark, u + nu * 0.1, v + nv * 0.1, alongV ? 0.03 : 0.7, 0.03, alongV ? 0.7 : 0.03, y + 0.03);
        break;
      }
      case 'projector': {
        // Escuela 2050: sin proyector colgado (la pizarra es una pantalla).
        // En su lugar, una rejilla lineal de aire paralela a la pantalla, en
        // el cielorraso o bajo la viga descolgada que lo sostenía.
        const top = this.overhead(u, v, level, room);
        // Bajo una viga, a lo largo de la viga (más angosta que la rejilla).
        const along = top.beam ? top.beam.w >= top.beam.d : !alongV;
        this.slot(u, v, along, 1.2, top.y);
        break;
      }
      case 'speaker':
        this.k.box(m.metalDark, u, v, alongV ? 0.22 : 0.26, 0.38, alongV ? 0.26 : 0.22, FY + (it.y ?? 2.5));
        break;
      case 'tv':
        this.k.box(m.metalDark, u, v, alongV ? 0.06 : w, it.h ?? 0.62, alongV ? w : 0.06, FY + (it.y ?? 1.5));
        break;
      case 'blackboard':
        // Pizarrón de tiza: marco grafito fino, sin bandeja (Escuela 2050).
        this.wallBoard(it, this.k.mat(it.color, m.chalk), m.graphite, FY + (it.y ?? 0.9), it.h ?? 1.2, false);
        break;
      case 'roundColumn':
        this.k.cyl(this.k.mat(it.color, m.red), u, v, w, it.h ?? 3.1, FY, true);
        break;
      case 'paddedColumn': {
        // Columna con protección acolchada hasta 2 m (como la verde del hall).
        const top = it.h ?? 3.1;
        this.k.box(m.white, u, v, w * 0.8, top, d * 0.8, FY);
        this.k.box(this.k.mat(it.color, m.chairGreen), u, v, w, 2.0, d, FY + 0.05);
        // Cinta azul en el borde de arriba de la protección (video 2026).
        if (it.color === 'darkGreen') this.k.box(m.blue, u, v, w + 0.01, 0.05, d + 0.01, FY + 1.85);
        break;
      }
      case 'workbench': {
        const legs = this.k.mat(it.color, m.blue);
        this.k.box(m.timber, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.k.box(legs, u + su * (w / 2 - 0.06), v + sv * (d / 2 - 0.06), 0.05, 0.74, 0.05, FY);
        }
        if (w >= d) this.k.box(legs, u, v, w - 0.12, 0.04, 0.04, FY + 0.3);
        else this.k.box(legs, u, v, 0.04, 0.04, d - 0.12, FY + 0.3);
        break;
      }
      case 'benchSeat': {
        const legs = this.k.mat(it.color, m.blue);
        this.k.box(m.timber, u, v, w, 0.04, d, FY + 0.44);
        for (const s of [-1, 1]) {
          if (w >= d) this.k.box(legs, u + s * (w / 2 - 0.1), v, 0.05, 0.44, d - 0.05, FY);
          else this.k.box(legs, u, v + s * (d / 2 - 0.1), w - 0.05, 0.44, 0.05, FY);
        }
        break;
      }
      case 'stool': {
        const mat = this.k.mat(it.color, m.metalDark);
        this.k.box(mat, u, v, 0.34, 0.04, 0.34, FY + 0.72);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.k.box(mat, u + su * 0.13, v + sv * 0.13, 0.03, 0.72, 0.03, FY);
        }
        // Apoyapiés a 28 cm del piso, de pata a pata (más finos que las patas:
        // entran en ellas sin caras coplanares). La gente sentada apoya ahí
        // las suelas (Places: footDrop 0,48 desde el asiento de 0,76).
        for (const s of [-1, 1]) {
          this.k.box(mat, u + s * 0.13, v, 0.025, 0.025, 0.26, FY + 0.265);
          this.k.box(mat, u, v + s * 0.13, 0.26, 0.025, 0.025, FY + 0.265);
        }
        break;
      }
      case 'pegboard': {
        this.k.box(m.timber, u, v, alongV ? 0.03 : w, it.h ?? 1.0, alongV ? w : 0.03, FY + (it.y ?? 1.0));
        const [nu, nv] = faceDir(it.face);
        for (let k = 0; k < 4; k++) {
          const t = (k + 0.5) / 4 - 0.5;
          const tool = [m.red, m.orange, m.lime, m.blue][k];
          this.k.box(tool, u + (alongV ? nu * 0.04 : t * w * 0.8), v + (alongV ? t * w * 0.8 : nv * 0.04), 0.06, 0.18, 0.06, FY + (it.y ?? 1.0) + 0.55);
        }
        break;
      }
      case 'cabinet': {
        // Mueble alto de melamina clara con estantes y cajas.
        const hgt = it.h ?? 1.9;
        this.k.box(m.timber, u, v, w, hgt, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 5; k++) {
          const y = FY + (k * hgt) / 5;
          const box = k % 2 === 0 ? m.blue : m.metalDark;
          this.k.box(box, u + nu * 0.02, v + nv * 0.02, alongV ? d * 0.9 : w * 0.85, 0.22, alongV ? w * 0.85 : d * 0.9, y - 0.25);
        }
        break;
      }
      case 'laserCutter': {
        // Apoyada sobre la mesa de trabajo (antes se hundía 2 cm en la tapa).
        const b = FY + FURNITURE.benchTop;
        this.k.box(m.blue, u, v, w, 0.26, d, b);
        this.k.box(m.board, u, v, w * 0.96, 0.08, d * 0.96, b + 0.26);
        this.k.box(m.metalDark, u, v, w * 0.5, 0.01, d * 0.5, b + 0.34);
        break;
      }
      case 'printer3d': {
        const b = FY + FURNITURE.benchTop;
        this.k.box(m.metalDark, u, v, w, w, d, b);
        this.k.box(m.blue, u, v, w * 1.02, 0.06, d * 1.02, b);
        break;
      }
      case 'buffetLine': {
        // Mostrador de acero inoxidable con mampara de vidrio.
        this.k.box(m.metal, u, v, w, 0.9, d, FY);
        this.k.box(m.metal, u, v, w + 0.04, 0.04, d + 0.04, FY + 0.9);
        if (alongV) this.k.box(m.glass, u, v, 0.02, 0.45, d - 0.1, FY + 1.25);
        else this.k.box(m.glass, u, v, w - 0.1, 0.45, 0.02, FY + 1.25);
        for (const s of [-1, 1]) {
          if (alongV) this.k.box(m.metal, u, v + s * (d / 2 - 0.05), 0.03, 0.4, 0.03, FY + 0.94);
          else this.k.box(m.metal, u + s * (w / 2 - 0.05), v, 0.03, 0.4, 0.03, FY + 0.94);
        }
        break;
      }
      case 'displayCase':
        this.k.box(m.metal, u, v, w, 0.85, d, FY);
        this.k.box(m.glass, u, v, w * 0.96, 0.42, d * 0.9, FY + 0.85);
        this.k.box(m.metal, u, v, w, 0.03, d, FY + 1.27);
        break;
      case 'fridgeGlass': {
        this.k.box(m.metalDark, u, v, w, 2.0, d, FY);
        const [nu, nv] = faceDir(it.face);
        this.k.box(m.glass, u + nu * (d / 2 + 0.01), v + nv * (d / 2 + 0.01), alongV ? 0.02 : w - 0.1, 1.7, alongV ? w - 0.1 : 0.02, FY + 0.15);
        // Botellas de colores detrás del vidrio.
        for (let k = 0; k < 4; k++) {
          const y = FY + 0.3 + k * 0.4;
          this.k.box([m.orange, m.lime, m.red, m.blue][k], u, v, alongV ? d * 0.6 : w * 0.8, 0.22, alongV ? w * 0.8 : d * 0.6, y);
        }
        break;
      }
      case 'pendantRail': {
        // Viga negra colgada con campanas industriales negras.
        const ceil = FY + 3.1;
        const y = ceil - 0.75;
        this.k.box(m.metalDark, u, v, w, 0.14, d, y);
        const n = Math.max(2, Math.round(Math.max(w, d) / 1.1));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const lu = u + (w >= d ? t * w : 0);
          const lv = v + (w >= d ? 0 : t * d);
          this.k.box(m.metalDark, lu, lv, 0.03, 0.3, 0.03, y - 0.3);
          this.k.cyl(m.metalDark, lu, lv, 0.3, 0.16, y - 0.46);
          this.k.cyl(m.light, lu, lv, 0.16, 0.02, y - 0.48);
          this.k.note(lu, lv, 0.16, 0.16, y - 0.48, 'pendant', room?.id ?? null, FY);
        }
        for (const s of [-1, 1]) {
          this.k.box(m.metalDark, u + (w >= d ? s * w * 0.4 : 0), v + (w >= d ? 0 : s * d * 0.4), 0.02, ceil - y - 0.14, 0.02, y + 0.14);
        }
        break;
      }
      case 'longTable': {
        const frame = this.k.mat(it.color, m.chairGreen);
        this.k.box(m.board, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.k.box(frame, u + su * (w / 2 - 0.08), v + sv * (d / 2 - 0.08), 0.05, 0.74, 0.05, FY);
        }
        // Bancos verdes a los dos lados.
        for (const s of [-1, 1]) {
          if (w >= d) this.k.box(frame, u, v + s * (d / 2 + 0.3), w - 0.2, 0.05, 0.3, FY + 0.45);
          else this.k.box(frame, u + s * (w / 2 + 0.3), v, 0.3, 0.05, d - 0.2, FY + 0.45);
        }
        break;
      }
      case 'greenWall':
        this.k.box(m.green, u, v, alongV ? 0.08 : w, it.h ?? 1.8, alongV ? w : 0.08, FY + (it.y ?? 1.0));
        break;
      case 'bamboo': {
        this.k.box(m.metalDark, u, v, 0.35, 0.45, 0.35, FY);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          this.k.cyl(m.timber, u + Math.cos(a) * 0.08, v + Math.sin(a) * 0.08, 0.04, 1.9 + (k % 3) * 0.25, FY + 0.4, true);
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
          this.k.box(mat, u + fu * off - fv * side, v + fv * off + fu * side, alongV ? dep : wid, h, alongV ? wid : dep, y0);
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
        this.k.box(this.k.mat(it.color, m.board), u, v, w, it.h ?? 0.85, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 4; k++) {
          this.k.box(m.frame, u + nu * (d / 2 + 0.005), v + nv * (d / 2 + 0.005), alongV ? 0.01 : w * 0.95, 0.01, alongV ? w * 0.95 : 0.01, FY + (k * (it.h ?? 0.85)) / 4);
        }
        break;
      }
      case 'coatBench': {
        // Banco rojo con tablero rojo de percheros arriba.
        this.k.box(m.red, u, v, w, 0.05, d, FY + 0.42);
        for (const s of [-1, 1]) {
          if (w >= d) this.k.box(m.metalDark, u + s * (w / 2 - 0.1), v, 0.05, 0.42, d - 0.06, FY);
          else this.k.box(m.metalDark, u, v + s * (d / 2 - 0.1), w - 0.06, 0.42, 0.05, FY);
        }
        const [nu, nv] = faceDir(it.face);
        this.k.box(m.red, u - nu * (d / 2 - 0.02), v - nv * (d / 2 - 0.02), alongV ? 0.03 : w, 0.28, alongV ? w : 0.03, FY + 1.5);
        break;
      }
      case 'gate': {
        // Reja de barrotes verticales.
        const mat = this.k.mat(it.color, m.red);
        const hgt = it.h ?? 2.1;
        if (it.mesh) {
          // Paño de metal desplegado con marco (guardas de las escaleras):
          // grilla fina de tiras dentro de un marco de caño.
          const L = Math.max(w, d);
          const ms = this.k.detailed ? 0.1 : 0.2;
          const cols = Math.max(2, Math.round(L / ms));
          for (let k = 0; k <= cols; k++) {
            const t = k / cols - 0.5;
            const end = k === 0 || k === cols;
            const th = end ? 0.05 : 0.008;
            this.k.box(mat, u + (alongV ? 0 : t * (w - 0.05)), v + (alongV ? t * (d - 0.05) : 0), alongV ? 0.012 : th, hgt, alongV ? th : 0.012, FY);
          }
          for (let y = 0.1 + ms; y < hgt - 0.08; y += ms) this.k.box(mat, u, v, alongV ? 0.012 : w, 0.008, alongV ? d : 0.012, FY + y);
          for (const y of [0.08, hgt - 0.05]) this.k.box(mat, u, v, alongV ? 0.05 : w, 0.05, alongV ? d : 0.05, FY + y);
          break;
        }
        if (it.color === 'metalDark' || it.color === 'black') {
          // Escuela 2050: las barandas de barrotes negros (hueco de la
          // escalera de chapa, jardín) pasan a vidrio: zócalo grafito, paño
          // de vidrio claro, pasamanos de madera y una línea de luz cálida
          // bajo el pasamanos. Cuatro cajas por tramo, mida lo que mida (los
          // barrotes eran una caja cada 18–30 cm). Las rejas y barandas rojas
          // son del video de 2026 y quedan como están.
          const L = alongV ? d : w;
          const run = (mt: Material, l: number, t: number, y0: number, hh: number) => this.k.box(mt, u, v, alongV ? t : l, hh, alongV ? l : t, FY + y0);
          run(m.graphite, L, 0.05, 0, 0.08);
          run(m.glass, L - 0.02, 0.012, 0.08, hgt - 0.11);
          run(m.timber, L + 0.02, 0.06, hgt - 0.045, 0.045);
          run(m.ledWarm, L - 0.04, 0.03, hgt - 0.053, 0.008);
          break;
        }
        // Barandas bajas: barrotes más espaciados (y aún más en VR).
        const step = (it.h ?? 2.1) < 1.3 ? (this.k.detailed ? 0.18 : 0.3) : this.k.detailed ? 0.12 : 0.2;
        const n = Math.max(3, Math.round(Math.max(w, d) / step));
        for (let k = 0; k <= n; k++) {
          const t = k / n - 0.5;
          this.k.box(mat, u + (alongV ? 0 : t * w), v + (alongV ? t * d : 0), 0.025, hgt, 0.025, FY);
        }
        for (const y of [0.1, hgt - 0.05]) this.k.box(mat, u, v, alongV ? 0.04 : w, 0.05, alongV ? d : 0.04, FY + y);
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
          this.k.box(mat, u + nu * off, v + nv * off, alongV ? 0.02 : sw, sh, alongV ? sw : 0.02, FY + y);
        });
        break;
      }
      case 'trophyShelf': {
        // Escuela 2050: el estante pasa a ser una vitrina colgada con fondo
        // de luz, estante y frente de vidrio y marco grafito, con copas con
        // forma (pie, caña y copa) en vez de las velas amarillas.
        this.cups(it, FY + (it.y ?? 2.15), 0.78, true);
        break;
      }
      case 'waterCooler':
        this.k.box(m.board, u, v, 0.32, 1.0, 0.32, FY);
        this.k.cyl(m.glass, u, v, 0.26, 0.42, FY + 1.0, true);
        break;
      case 'plasticChair':
        // Sillones plásticos crema del pasillo de los trofeos (4:36).
        this.chair(m.plasticCream, u, v, it.face);
        break;
      case 'filing': {
        this.k.box(m.red, u, v, w, it.h ?? 1.35, d, FY);
        const [nu, nv] = faceDir(it.face);
        for (let k = 1; k < 6; k++) {
          this.k.box(m.metalDark, u + nu * (d / 2 + 0.005), v + nv * (d / 2 + 0.005), alongV ? 0.01 : w * 0.95, 0.012, alongV ? w * 0.95 : 0.01, FY + (k * (it.h ?? 1.35)) / 6);
        }
        break;
      }
      case 'sinkCounter': {
        // Mesada con venecitas, bachas embutidas, griferías y espejos encima.
        this.k.box(m.yellow, u, v, w, 0.85, d, FY);
        this.k.box(m.board, u, v, w + 0.02, 0.05, d + 0.02, FY + 0.85);
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
          this.k.cyl(m.slab, su, sv, 0.34, 0.004, FY + 0.902, true);
          // Grifería: columna y pico hacia la bacha.
          const back = (o: number): [number, number] => [su - nu * (dep / 2 - o), sv - nv * (dep / 2 - o)];
          const [cu, cv] = back(0.07);
          this.k.box(m.metal, cu, cv, 0.03, 0.2, 0.03, FY + 0.9);
          const [pu, pv] = back(0.12);
          this.k.box(m.metal, pu, pv, nu ? 0.1 : 0.03, 0.03, nv ? 0.1 : 0.03, FY + 1.07);
          // Espejo contra el muro (antes, en las mesadas que miran al este u
          // oeste, quedaba del otro lado del muro).
          const [mu, mv] = back(0.02);
          this.k.box(m.glass, mu, mv, alongV ? 0.02 : 0.5, 0.7, alongV ? 0.5 : 0.02, FY + 1.15);
        }
        break;
      }
      case 'copier':
        this.k.box(m.board, u, v, w, 0.95, d, FY);
        this.k.box(m.metalDark, u, v, w * 0.9, 0.06, d * 0.8, FY + 0.95);
        break;
      case 'desk2': {
        // Escritorio de oficina (blanco o del color indicado) con monitor.
        const top = this.k.mat(it.color, m.board);
        this.k.box(top, u, v, w, 0.04, d, FY + 0.74);
        for (const su of [-1, 1]) {
          if (alongV) this.k.box(top, u, v + su * (d / 2 - 0.02), w, 0.74, 0.04, FY);
          else this.k.box(top, u + su * (w / 2 - 0.02), v, 0.04, 0.74, d, FY);
        }
        this.k.box(m.metalDark, u, v, alongV ? 0.05 : 0.55, 0.36, alongV ? 0.55 : 0.05, FY + 0.82);
        break;
      }
      case 'wallMat':
        this.k.box(this.k.mat(it.color, m.red), u, v, alongV ? 0.1 : w, it.h ?? 2.0, alongV ? w : 0.1, FY + (it.y ?? 0));
        break;
      case 'padPilaster':
        // Pilastra del polideportivo: verde abajo y roja arriba en el lateral
        // norte; toda roja en el de Laprida (9:22–9:32).
        if (it.face === 'n') {
          this.k.box(m.red, u, v, w, 2.7, d, FY + 0.1);
        } else {
          this.k.box(m.chairGreen, u, v, w, 1.3, d, FY + 0.1);
          this.k.box(m.red, u, v, w, 1.4, d, FY + 1.4);
        }
        break;
      case 'stack': {
        const mat = this.k.mat(it.color, m.red);
        const n = Math.round((it.h ?? 1.6) / 0.09);
        this.k.box(mat, u, v, w, 0.45, d, FY);
        for (let k = 0; k < n; k++) this.k.box(mat, u, v, w, 0.03, d, FY + 0.45 + k * 0.09);
        break;
      }
      case 'drumKit':
        this.k.cyl(m.red, u, v, 0.55, 0.45, FY + 0.05, true);
        for (const [du, dv] of [
          [-0.45, 0.25],
          [0.45, 0.25],
          [0, 0.45],
        ]) {
          this.k.cyl(m.red, u + du, v + dv, 0.32, 0.25, FY + 0.6, true);
          this.k.box(m.metal, u + du, v + dv, 0.02, 0.6, 0.02, FY);
        }
        this.k.cyl(m.yellow, u - 0.6, v - 0.2, 0.4, 0.01, FY + 1.1, true);
        break;
      case 'risers': {
        // Gradas de 3 escalones (rojo y azul alternados).
        for (let k = 0; k < 3; k++) {
          const [nu, nv] = faceDir(it.face);
          const off = (1 - k) * (alongV ? w : d) / 3;
          const mat = k % 2 === 0 ? m.red : m.blue;
          this.k.box(mat, u - nu * off, v - nv * off, alongV ? w / 3 : w, 0.3 * (k + 1), alongV ? d : d / 3, FY);
        }
        break;
      }
      case 'slide': {
        // Juego de plástico: torre, techo y tobogán.
        const tower = this.k.mat(it.color, m.yellow);
        this.k.box(tower, u, v, w * 0.5, 1.2, d * 0.5, FY);
        this.k.box(m.red, u, v, w * 0.55, 0.08, d * 0.55, FY + 1.6);
        const p = toWorld(this.k.f, u + w * 0.45, v);
        this.k.farm.add('box', m.red, new Vector3(p.x, FY + 0.6, p.z), new Vector3(1.4, 0.06, 0.5), this.k.yaw(1, 0), 0, -0.6);
        const q = toWorld(this.k.f, u, v + d * 0.45);
        this.k.farm.add('box', m.lime, new Vector3(q.x, FY + 0.6, q.z), new Vector3(0.5, 0.06, 1.4), 0, 0.6, 0);
        break;
      }
      case 'swing': {
        const frame = this.k.mat(it.color, m.lime);
        for (const s of [-1, 1]) {
          if (w >= d) this.k.box(frame, u + s * w / 2, v, 0.08, 2.2, 0.08, FY);
          else this.k.box(frame, u, v + s * d / 2, 0.08, 2.2, 0.08, FY);
        }
        // Travesaño rojo arriba (9:52).
        this.k.box(m.red, u, v, w >= d ? w : 0.08, 0.08, w >= d ? 0.08 : d, FY + 2.2);
        for (const s of [-0.25, 0.25]) {
          const su = u + (w >= d ? s * w : 0);
          const sv = v + (w >= d ? 0 : s * d);
          this.k.box(m.metalDark, su, sv, 0.02, 1.7, 0.02, FY + 0.5);
          this.k.box(m.red, su, sv, 0.45, 0.04, 0.25, FY + 0.48);
        }
        break;
      }
      case 'wallPanel':
        this.k.box(this.k.mat(it.color, m.white), u, v, w, it.h ?? 1.0, d, FY + (it.y ?? 0));
        break;
      case 'floorPatch':
        // `y` levanta un parche sobre otro (líneas sobre el vinílico) sin z-fighting.
        this.k.box(this.k.mat(it.color, m.metalDark), u, v, w, 0.008, d, FY + 0.002 + (it.y ?? 0));
        break;
      case 'ceilingFan': {
        // Cuatro aspas beige y una campana de bronce colgadas del techo.
        const y = FY + 2.75;
        this.k.box(m.metalDark, u, v, 0.03, 0.3, 0.03, y + 0.05);
        this.k.cyl(m.yellow, u, v, 0.2, 0.12, y - 0.05, true);
        this.k.box(m.timber, u, v, w, 0.015, 0.14, y);
        this.k.box(m.timber, u, v, 0.14, 0.015, d, y);
        break;
      }
      case 'playTower': {
        // Torre de madera rojiza con techo, baranda y dos toboganes (9:44).
        const tw = Math.min(w, d) * 0.55;
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.k.box(m.timberDark, u + (su * tw) / 2, v + (sv * tw) / 2, 0.1, 2.6, 0.1, FY);
        }
        this.k.box(m.timberDark, u, v, tw, 0.08, tw, FY + 1.3);
        this.k.box(m.timber, u, v, tw, 0.5, 0.04, FY + 1.38);
        this.k.box(m.red, u, v, tw + 0.3, 0.08, tw + 0.3, FY + 2.6);
        for (const s of [-1, 1]) {
          const p = toWorld(this.k.f, u + s * (tw / 2 + 0.75), v);
          this.k.farm.add('box', s > 0 ? m.yellow : m.lime, new Vector3(p.x, FY + 0.65, p.z), new Vector3(1.7, 0.05, 0.5), this.k.yaw(1, 0), 0, s * 0.72);
        }
        break;
      }
      case 'aviary': {
        // Jaula de malla con marco de color y techo de chapa.
        const frame = this.k.mat(it.color, m.red);
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.k.box(frame, u + (su * w) / 2, v + (sv * d) / 2, 0.06, 2.0, 0.06, FY);
        }
        this.k.box(m.metal, u, v, w + 0.2, 0.05, d + 0.2, FY + 2.0);
        this.k.box(m.mesh, u, v + d / 2, w, 1.9, 0.01, FY + 0.05);
        this.k.box(frame, u, v + d / 2, w, 0.05, 0.05, FY + 1.0);
        break;
      }
      case 'hut':
        // Choza de paja sobre parantes, contra la medianera azul.
        for (const su of [-1, 1]) {
          for (const sv of [-1, 1]) this.k.box(m.timberDark, u + (su * w) / 2.4, v + (sv * d) / 2.4, 0.1, 1.9, 0.1, FY);
        }
        this.k.cyl(m.timber, u, v, Math.max(w, d) * 0.9, 0.7, FY + 1.9, true);
        this.k.cyl(m.timber, u, v, Math.max(w, d) * 0.5, 0.45, FY + 2.55, true);
        break;
      case 'climber': {
        // Domo trepador: aros de caño de colores.
        const p = toWorld(this.k.f, u, v);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI;
          this.k.farm.add('box', [m.red, m.blue, m.yellow, m.lime][k], new Vector3(p.x, FY + 0.6, p.z), new Vector3(w, 0.05, 0.05), a, 0, 0);
        }
        this.k.cyl(m.red, u, v, w * 0.7, 0.05, FY + 1.15, true);
        break;
      }
      case 'bikeRack':
        for (let k = 0; k < 5; k++) {
          const t = (k / 4 - 0.5) * (alongV ? d : w);
          this.k.box(m.metal, u + (alongV ? 0 : t), v + (alongV ? t : 0), alongV ? 0.5 : 0.04, 0.75, alongV ? 0.04 : 0.5, FY);
        }
        break;
      case 'waterTank':
        // Tanque de agua negro sobre una base, en la azotea.
        this.k.box(m.slab, u, v, w + 0.2, 0.3, d + 0.2, FY + (it.y ?? 0));
        this.k.cyl(m.metalDark, u, v, w, 1.4, FY + (it.y ?? 0) + 0.3, true);
        break;
      case 'bike':
        this.bike(u, v, alongV, w, d);
        break;
      case 'condenser': {
        // Unidad exterior blanca con la rejilla del ventilador y su ménsula.
        const y = FY + (it.y ?? 3.6);
        const [nu, nv] = faceDir(it.face);
        this.k.box(m.frame, u, v, alongV ? 0.3 : 0.8, 0.55, alongV ? 0.8 : 0.3, y);
        this.k.cyl(m.metalDark, u + nu * 0.16 + (alongV ? 0 : 0.12), v + nv * 0.16 + (alongV ? 0.12 : 0), 0.38, 0.03, y + 0.27, true);
        this.k.box(m.metalDark, u, v, alongV ? 0.32 : 0.86, 0.03, alongV ? 0.86 : 0.32, y - 0.04);
        break;
      }
      case 'louvredDoor':
        this.k.box(m.metalDark, u, v, alongV ? 0.05 : w, 2.05, alongV ? w : 0.05, FY);
        break;
      // ------------------------------------------------ Escuela 2050
      // Volúmenes modelados en `tests/schoolProps.test.ts` (con estas medidas).
      case 'ledLine': {
        // Perfil lineal de luz a lo largo del lado largo, al ras del
        // cielorraso (o con la cara de abajo a `y`).
        const top = it.y !== undefined ? FY + it.y + 0.05 : this.overhead(u, v, level, room).y;
        const L = Math.max(w, d);
        const a: P = w >= d ? [u - L / 2, v] : [u, v - L / 2];
        const b: P = w >= d ? [u + L / 2, v] : [u, v + L / 2];
        this.lightLine(a, b, top, null, room?.id ?? null, FY);
        break;
      }
      case 'infoScreen':
        // Pantalla informativa de pared: la misma pantalla de las aulas, con
        // una interfaz de luces (barra de título y dos tarjetas).
        this.screen(it, FY + (it.y ?? 1.2), it.h ?? 0.9, true);
        break;
      case 'vitrine':
        // Vitrina de pie con zócalo grafito, fondo de luz y copas.
        this.cups(it, FY, it.h ?? 1.9, false);
        break;
      case 'acousticPanels': {
        // Paneles acústicos de fieltro (azul marino, salvia y verde) de 60 cm,
        // separados 2 cm, con un listón de madera arriba que los une.
        const L = alongV ? d : w;
        const [fu, fv] = faceDir(it.face);
        const gap = wallGapBehind(level, u, v, it.face);
        const back = Number.isFinite(gap) && gap < 0.3 ? -gap : -0.025;
        const y0 = FY + (it.y ?? 1.0);
        const hh = it.h ?? 1.2;
        const n = Math.max(1, Math.round(L / 0.62));
        const pw = (L - (n - 1) * 0.02) / n;
        const felt = [m.navy, m.sage, m.chairGreen];
        for (let k = 0; k < n; k++) {
          const a = -L / 2 + pw / 2 + k * (pw + 0.02);
          const o = back + 0.02 + (k % 2) * 0.008;
          this.k.box(felt[k % 3], u + (alongV ? 0 : a) + fu * o, v + (alongV ? a : 0) + fv * o, alongV ? 0.04 : pw, hh, alongV ? pw : 0.04, y0);
        }
        const o = back + 0.025;
        this.k.box(m.timber, u + fu * o, v + fv * o, alongV ? 0.05 : L + 0.04, 0.04, alongV ? L + 0.04 : 0.05, y0 + hh + 0.02);
        break;
      }
      case 'spotBar': {
        // Barra de focos de Teatro: caño grafito colgado del cielorraso por
        // dos tensores, con focos cilíndricos inclinados hacia `face` y su
        // lente encendida.
        const ceil = this.overhead(u, v, level, room).y;
        const y = ceil - (it.h ?? 0.45);
        const L = alongV ? d : w;
        const [fu, fv] = faceDir(it.face);
        this.k.box(m.graphite, u, v, alongV ? 0.05 : L, 0.05, alongV ? L : 0.05, y);
        for (const s of [-0.4, 0.4]) {
          this.k.box(m.graphite, u + (alongV ? 0 : s * L), v + (alongV ? s * L : 0), 0.012, ceil - y - 0.05, 0.012, y + 0.05);
        }
        const n = Math.max(2, Math.round(L / 0.6));
        const tilt = 0.55;
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) / n - 0.5) * L;
          const su = u + (alongV ? 0 : t) + fu * 0.06;
          const sv = v + (alongV ? t : 0) + fv * 0.06;
          const p = toWorld(this.k.f, su, sv);
          // El cilindro se inclina hacia el frente: giro alrededor del eje del caño.
          const rx = alongV ? 0 : -fv * tilt;
          // (+u es −x en el mundo: el giro en z va al revés que el de x.)
          const rz = alongV ? -fu * tilt : 0;
          this.k.farm.add('cylinderHi', m.graphite, new Vector3(p.x, y - 0.1, p.z), new Vector3(0.14, 0.24, 0.14), 0, rx, rz);
          const q = toWorld(this.k.f, su + fu * 0.065, sv + fv * 0.065);
          this.k.farm.add('cylinderHi', m.ledWarm, new Vector3(q.x, y - 0.2, q.z), new Vector3(0.11, 0.012, 0.11), 0, rx, rz);
          this.k.box(m.graphite, su - fu * 0.06, sv - fv * 0.06, 0.03, 0.06, 0.03, y - 0.03);
        }
        break;
      }
    }
  }

  /**
   * Silla escolar de caño: asiento y respaldo de multilaminado, cuatro patas
   * y dos parantes que sostienen el respaldo. `face` es hacia dónde mira, o
   * una dirección cualquiera del plano (las sillas alrededor de una mesa
   * redonda miran a su centro). Antes eran dos placas macizas bajo el
   * asiento (se leía como un bloque).
   */
  chair(mat: Material, u: number, v: number, face: Item['face'] | readonly [number, number], scale = 1): void {
    const s = scale;
    const FY = this.k.fy;
    // Adelante (hacia donde mira quien se sienta) y costado, en el plano.
    const [fu, fv] = typeof face === 'string' ? faceDir(face) : face;
    const su = -fv;
    const sv = fu;
    const rot = this.k.yaw(su, sv);
    // Caja con el ancho sobre el costado y la profundidad hacia adelante.
    const part = (m: Material, ahead: number, side: number, w: number, h: number, d: number, y: number) => {
      const p = toWorld(this.k.f, u + fu * ahead + su * side, v + fv * ahead + sv * side);
      this.k.farm.addBoxOnGround(m, p.x, p.z, w, h, d, y, rot);
    };
    // Patas y parantes: postes (cajas sin base). Apoyan en el piso o nacen
    // dentro del asiento, así que esa cara no se ve; con ~1.500 patas en la
    // escuela son 3 mil triángulos menos en cada vista.
    const post = (ahead: number, side: number, w: number, h: number, y: number) => {
      const p = toWorld(this.k.f, u + fu * ahead + su * side, v + fv * ahead + sv * side);
      this.k.farm.add('post', this.k.m.metalDark, new Vector3(p.x, y + h / 2, p.z), new Vector3(w, h, w), rot);
    };
    // Asiento a `FURNITURE.seat` (la gente se sienta a esa altura).
    const legs = (FURNITURE.seat - 0.04) * s;
    part(mat, 0, 0, 0.42 * s, 0.04 * s, 0.42 * s, FY + legs);
    if (!this.k.detailed) {
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

  /**
   * Laterales en U de caño fino de un pupitre o una mesa (`w` × `d`): una U
   * en cada punta del eje `axis`, que cruza el lado corto. Patas de 3 cm
   * (postes: la cara de abajo nunca se ve) `inset` metros adentro de las
   * esquinas y, con `runner`, el patín de la U en el piso. Comparten la malla
   * de las patas de las sillas: ni un draw call más.
   */
  private uLegs(u: number, v: number, w: number, d: number, top: number, inset: number, axis: 'u' | 'v', runner: boolean): void {
    const m = this.k.m;
    const FY = this.k.fy;
    const post = (pu: number, pv: number, sw: number, h: number, sd: number) => {
      const p = toWorld(this.k.f, pu, pv);
      this.k.farm.add('post', m.metalDark, new Vector3(p.x, FY + h / 2, p.z), new Vector3(sw, h, sd));
    };
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) post(u + su * (w / 2 - inset), v + sv * (d / 2 - inset), 0.03, top, 0.03);
    }
    if (!runner) return;
    for (const s of [-1, 1]) {
      if (axis === 'v') post(u, v + s * (d / 2 - inset), w - 2 * inset + 0.03, 0.025, 0.035);
      else post(u + s * (w / 2 - inset), v, 0.035, 0.025, d - 2 * inset + 0.03);
    }
  }

  /**
   * Tablet apoyada sobre el pupitre, del lado de quien se sienta (el
   * contrario a `face`) y frente al primer asiento: vidrio oscuro de
   * 24 × 17 cm y 7 mm, 1 mm sobre la tapa (sin caras en el mismo plano).
   */
  private tablet(u: number, v: number, w: number, d: number, face: Item['face'], y: number): void {
    const [fu, fv] = faceDir(face);
    const depth = fu !== 0 ? w : d;
    const ou = -fu * (depth / 2 - 0.12) + (fu !== 0 ? 0 : -0.3);
    const ov = -fv * (depth / 2 - 0.12) + (fv !== 0 ? 0 : -0.3);
    this.k.box(this.k.m.glassDark, u + ou, v + ov, fu !== 0 ? 0.17 : 0.24, 0.007, fu !== 0 ? 0.24 : 0.17, y + 0.001);
  }

  /**
   * Lo que hay sobre (u, v) en el nivel: el cielorraso del ambiente o, si
   * cruza una viga descolgada (un `wallPanel` que llega al cielorraso, como
   * la del proyector de las aulas de planta baja), la cara de abajo de la viga.
   */
  private overhead(u: number, v: number, level: Level, room: Room | null): { y: number; beam: Item | null } {
    const FY = LEVEL_Y[level];
    const ceil = FY + (room ? ceilingHeight(room) : 3.1);
    this.beams ??= ITEMS.filter((b) => b.kind === 'wallPanel' && (b.y ?? 0) > 1.5);
    for (const b of this.beams) {
      if ((b.level ?? 0) !== level || FY + (b.y ?? 0) + (b.h ?? 1) < ceil - 0.06) continue;
      if (Math.abs(u - b.u) <= b.w / 2 + 0.02 && Math.abs(v - b.v) <= b.d / 2 + 0.02) return { y: FY + (b.y ?? 0), beam: b };
    }
    return { y: ceil, beam: null };
  }

  private beams: readonly Item[] | null = null;

  /**
   * Rejilla lineal de aire al ras del cielorraso (`top`): marco grafito de
   * 11 cm y dos ranuras oscuras que asoman 1,5 mm por debajo. Reemplaza a
   * ventiladores de pared y proyectores (Escuela 2050: el aire y la imagen
   * ya no cuelgan del techo).
   */
  private slot(u: number, v: number, alongU: boolean, len: number, top: number): void {
    const m = this.k.m;
    this.k.box(m.graphite, u, v, alongU ? len : 0.11, 0.014, alongU ? 0.11 : len, top - 0.012);
    for (const s of [-1, 1]) {
      const o = s * 0.022;
      this.k.box(m.black, u + (alongU ? 0 : o), v + (alongU ? o : 0), alongU ? len - 0.05 : 0.016, 0.01, alongU ? 0.016 : len - 0.05, top - 0.0135);
    }
  }

  /**
   * Vitrina de trofeos contra el muro (fondo a la cara del muro): caja de
   * vidrio de `hgt` de alto desde `y0`, fondo de luz cálida tenue, estantes
   * de vidrio y copas doradas con pie de madera, caña y copa. `hung`: colgada
   * (marco grafito arriba y abajo); si no, de pie sobre un zócalo grafito
   * (la vitrina `vitrine`, que arranca en el piso).
   */
  private cups(it: Item, y0: number, hgt: number, hung: boolean): void {
    const m = this.k.m;
    const { u, v } = it;
    const alongV = it.face === 'e' || it.face === 'w';
    const len = alongV ? it.d : it.w;
    const depth = alongV ? it.w : it.d;
    const [fu, fv] = faceDir(it.face);
    const gap = wallGapBehind(it.level ?? 0, u - (fu * depth) / 2, v - (fv * depth) / 2, it.face);
    // Corrimiento hacia el muro para que el fondo apoye en su cara.
    const shift = Number.isFinite(gap) && gap < 0.3 ? -gap : 0;
    const part = (mat: Material, a: number, off0: number, off1: number, l: number, y: number, h: number) => {
      const o = -depth / 2 + shift + (off0 + off1) / 2;
      this.k.box(mat, u + (alongV ? 0 : a) + fu * o, v + (alongV ? a : 0) + fv * o, alongV ? off1 - off0 : l, h, alongV ? l : off1 - off0, y);
    };
    const D = depth;
    const base = hung ? 0 : 0.5;
    // Marco: tapa y piso grafito; en la de pie, el zócalo cerrado.
    part(m.graphite, 0, 0, D, len, y0 + hgt - 0.03, 0.03);
    part(m.graphite, 0, 0, D, len, y0 + base - (hung ? 0 : 0.5), hung ? 0.03 : 0.53);
    // Fondo de luz (tenue: `lit`, el de las ventanas encendidas) y frente de vidrio.
    part(m.lit, 0, 0, 0.012, len - 0.02, y0 + base + 0.03, hgt - base - 0.06);
    part(m.glass, 0, D - 0.012, D - 0.002, len - 0.01, y0 + base + 0.03, hgt - base - 0.06);
    // Laterales de vidrio y un estante de vidrio a media altura.
    for (const s of [-1, 1]) part(m.glass, (s * (len - 0.012)) / 2, 0.012, D - 0.012, 0.01, y0 + base + 0.03, hgt - base - 0.06);
    const shelves = [y0 + base + 0.03];
    if (hgt - base > 0.7) shelves.push(y0 + base + (hgt - base) * 0.5);
    for (const sy of shelves.slice(1)) part(m.glass, 0, 0.012, D - 0.012, len - 0.03, sy, 0.012);
    // Copas: pie de madera, caña dorada y copa, de alturas distintas.
    const n = Math.max(3, Math.round(len / 0.24));
    const cu = D / 2 - 0.01;
    shelves.forEach((sy, j) => {
      for (let k = 0; k < n; k++) {
        if (j > 0 && k % 2 === 1) continue;
        const t = ((k + 0.5) / n - 0.5) * (len - 0.08);
        const o = -depth / 2 + shift + cu;
        const tu = u + (alongV ? 0 : t) + fu * o;
        const tv = v + (alongV ? t : 0) + fv * o;
        const s = 0.8 + ((k + j) % 3) * 0.2;
        const y = sy + (j === 0 ? 0.03 : 0.012);
        this.k.box(m.timberDark, tu, tv, 0.08 * s, 0.04 * s, 0.08 * s, y);
        // Caña: una caja (las de 6 lados amarillas serían otro draw call).
        this.k.box(m.yellow, tu, tv, 0.022 * s, 0.09 * s, 0.022 * s, y + 0.04 * s);
        this.k.cyl(m.yellow, tu, tv, 0.1 * s, 0.09 * s, y + 0.13 * s, true);
      }
    });
  }

  /**
   * Bicicleta apoyada (video 2026, 1:05 y 1:25): cuadro de caño rojo, dos
   * ruedas (cubierta negra y llanta gris), asiento y manubrio. Todo con la
   * granja y los materiales que ya hay: unas quince instancias, sin malla propia.
   */
  private bike(u: number, v: number, alongV: boolean, w: number, d: number): void {
    const m = this.k.m;
    const len = Math.max(w, d);
    const dia = Math.min(0.62, len * 0.4);
    const base = len - dia;
    const du = alongV ? 0 : 1;
    const dv = alongV ? 1 : 0;
    const yaw = this.k.yaw(du, dv);
    const at = (s: number, y: number): Vector3 => {
      const p = toWorld(this.k.f, u + du * s, v + dv * s);
      return new Vector3(p.x, FY + y, p.z);
    };
    const tube = (a: Vector3, b: Vector3, mat: Material, t = 0.035): void => {
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      const rise = b.y - a.y;
      const yawT = run > 1e-3 ? Math.atan2(-(b.z - a.z), b.x - a.x) : yaw;
      this.k.farm.add('box', mat, Vector3.Center(a, b), new Vector3(Math.hypot(run, rise), t, t), yawT, 0, Math.atan2(rise, Math.max(run, 1e-4)));
    };
    const r = dia / 2;
    const rear = at(-base / 2, r);
    const front = at(base / 2, r);
    for (const c of [rear, front]) {
      this.k.farm.add('cylinderHi', m.black, c, new Vector3(dia, 0.035, dia), yaw, Math.PI / 2);
      this.k.farm.add('cylinderHi', m.metal, c, new Vector3(dia * 0.82, 0.045, dia * 0.82), yaw, Math.PI / 2);
    }
    const bb = at(-base * 0.05, r - 0.02);
    const seat = at(-base * 0.2, r + 0.5);
    const head = at(base * 0.33, r + 0.42);
    const frame = m.red;
    tube(bb, seat, frame);
    tube(bb, head, frame, 0.042);
    tube(seat, head, frame);
    tube(rear, bb, frame, 0.028);
    tube(rear, seat, frame, 0.028);
    tube(head, front, m.metalDark, 0.03);
    // Asiento y manubrio (perpendicular al cuadro).
    this.k.farm.add('box', m.metalDark, at(-base * 0.2, r + 0.56), new Vector3(0.24, 0.05, 0.11), yaw);
    const bar = at(base * 0.31, r + 0.58);
    tube(head, bar, m.metalDark, 0.03);
    this.k.farm.add('box', m.metalDark, bar, new Vector3(0.03, 0.03, 0.52), yaw);
  }

  /**
   * Pizarra o pizarrón colgado: paño, marco perimetral que sobresale 1 cm y
   * bandeja abajo, todo hacia el lado al que mira (`face`). Antes el marco
   * era una caja del mismo espesor que el paño, centradas en el mismo plano:
   * las dos caras frontales coincidían y titilaban (la "mancha" de ruido del
   * pizarrón del Aula 1). En las que miraban al oeste o al norte, además, el
   * paño quedaba detrás del marco y la pizarra se veía gris oscura.
   */
  private wallBoard(it: Item, panel: Material, rim: Material, y0: number, hgt: number, tray = true): void {
    const { u, v } = it;
    const alongV = it.face === 'e' || it.face === 'w';
    const len = alongV ? it.d : it.w;
    const [fu, fv] = faceDir(it.face);
    // Pieza a lo largo del muro: `a` corrido sobre el muro, `off` hacia el frente.
    const part = (mat: Material, a: number, off: number, l: number, depth: number, y: number, h: number) =>
      this.k.box(mat, u + (alongV ? 0 : a) + fu * off, v + (alongV ? a : 0) + fv * off, alongV ? depth : l, h, alongV ? l : depth, y);
    // Paño: de −1,5 a +0,5 cm respecto del plano del objeto.
    part(panel, 0, -0.005, len, 0.02, y0, hgt);
    if (!this.k.detailed) {
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
    if (tray) part(rim, 0, 0.03, len * 0.9, 0.06, y0 - 0.045, 0.02);
  }

  /**
   * Pantalla de pared (pizarra 2050 y `infoScreen`): paño de vidrio oscuro
   * cuyo frente queda a 2 cm de la cara del muro y marco grafito fino de
   * 1,8 cm, 3 mm más salido que el paño. Acuerdo con `SchoolIdentity` (D):
   * el contenido de la pantalla va en un quad 1 cm delante del paño (a 3 cm
   * del muro), del tamaño del paño: no pisa el marco. Con `ui`, una interfaz
   * hecha con luces (barra de título y dos tarjetas) para las que no tienen
   * contenido del atlas.
   */
  private screen(it: Item, y0: number, hgt: number, ui = false): void {
    const m = this.k.m;
    const { u, v } = it;
    const level = it.level ?? 0;
    const alongV = it.face === 'e' || it.face === 'w';
    const len = alongV ? it.d : it.w;
    const [fu, fv] = faceDir(it.face);
    // Cara del muro, desde el centro del objeto (el dato la deja a 2 cm en
    // las aulas de planta baja y a 2–3,5 cm en el resto).
    const gap = wallGapBehind(level, u, v, it.face);
    const back = -(Number.isFinite(gap) ? Math.min(Math.max(gap, 0), 0.2) : 0.02);
    const part = (mat: Material, a: number, off0: number, off1: number, l: number, y: number, h: number) =>
      this.k.box(mat, u + (alongV ? 0 : a) + fu * (back + (off0 + off1) / 2), v + (alongV ? a : 0) + fv * (back + (off0 + off1) / 2), alongV ? off1 - off0 : l, h, alongV ? l : off1 - off0, y);
    part(m.glassDark, 0, 0, 0.02, len, y0, hgt);
    const r = 0.018;
    if (this.k.detailed) {
      for (const s of [-1, 1]) part(m.graphite, (s * (len + r)) / 2, 0, 0.023, r, y0 - r, hgt + 2 * r);
      part(m.graphite, 0, 0, 0.023, len, y0 + hgt, r);
      part(m.graphite, 0, 0, 0.023, len, y0 - r, r);
      // Testigo de encendido: un punto de luz en el borde de abajo.
      part(m.light, len / 2 - 0.06, 0.023, 0.026, 0.025, y0 - r * 0.7, 0.006);
    } else {
      // Visor: un solo marco detrás del paño (asoma alrededor), no cuatro listones.
      part(m.graphite, 0, 0, 0.017, len + 2 * r, y0 - r, hgt + 2 * r);
    }
    if (!ui) return;
    // Interfaz encendida: 1 cm delante del paño, sin tocarse entre sí.
    const ux = len * 0.88;
    part(m.ledWarm, 0, 0.02, 0.026, ux, y0 + hgt * 0.83, hgt * 0.05);
    for (const s of [-1, 1]) part(m.lit, (s * ux) / 4 + s * 0.01, 0.02, 0.026, ux / 2 - 0.04, y0 + hgt * 0.14, hgt * 0.58);
  }

  /**
   * Luminarias de todos los ambientes cubiertos: luz lineal continua en
   * pasillos y en los ambientes de tubos, paneles LED de 60 × 60 en los
   * cielorrasos de placas y campanas colgadas donde las hay.
   */
  lights(): void {
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
      if (own) this.k.switchable.set(r.id, own);
      // Luminaria: en las aulas con interruptor, marco acá y luz en el juego.
      const lamp = (u: number, v: number, w: number, h: number, d: number, yb: number) => {
        this.k.note(u, v, w, d, yb, kind === 'panel' ? 'panel' : 'tube', r.id, LEVEL_Y[roomLevel(r)], !!own);
        if (!own) {
          this.k.box(this.k.m.light, u, v, w, h, d, yb);
          return;
        }
        this.k.box(this.k.m.board, u, v, w + 0.04, h - 0.01, d + 0.04, yb + 0.01);
        const p = toWorld(this.k.f, u, v);
        own.push({ x: p.x, y: yb + h / 2, z: p.z, sx: w, sy: h, sz: d });
      };
      const nu = Math.max(1, Math.round((u1 - u0) / step));
      const nv = Math.max(1, Math.round((v1 - v0) / step));
      const long = u1 - u0 >= v1 - v0;
      // Huecos de escalera del piso de arriba: ahí no hay cielorraso. Una
      // luminaria con el centro en el hueco no va; si sólo lo roza, se corre
      // 10 cm afuera por el lado más corto (antes flotaban sobre los tramos).
      const above = roomLevel(r) < 2 ? voidsAt((roomLevel(r) + 1) as 1 | 2) : [];
      if (kind === 'tube' || CORRIDOR.has(r.name)) {
        // Escuela 2050: pasillos y ambientes de tubos llevan luz lineal
        // continua (perfil grafito con difusor) en filas a lo largo del lado
        // largo, en las mismas filas que los tubos sueltos de antes y
        // cortada sólo por los huecos de escalera. Dos cajas por tramo, mida
        // lo que mida: más barato que la grilla de tubos o paneles.
        const span = long ? v1 - v0 : u1 - u0;
        const L = long ? u1 - u0 : v1 - v0;
        const rows = Math.max(1, Math.round(span / step));
        const at = (c: number, t: number): P => (long ? [u0 + t, c] : [c, v0 + t]);
        const probe: ReadonlyArray<readonly [number, number]> = long
          ? [[0.45, 0], [-0.45, 0], [0, 0.35], [0, -0.35]]
          : [[0, 0.45], [0, -0.45], [0.35, 0], [-0.35, 0]];
        // 45 cm de muro en las puntas, 35 a los costados y 15 de cada hueco.
        const ok = (c: number, t: number): boolean => {
          const [pu, pv] = at(c, t);
          if (probe.some(([du, dv]) => !inPoly(r.poly, pu + du, pv + dv))) return false;
          return !above.some((h) => pu > h.u0 - 0.15 && pu < h.u1 + 0.15 && pv > h.v0 - 0.15 && pv < h.v1 + 0.15);
        };
        for (let j = 0; j < rows; j++) {
          const c = (long ? v0 : u0) + ((j + 0.5) * span) / rows;
          for (const [t0, t1] of this.k.runs(L, (t) => ok(c, t), 0.8)) this.lightLine(at(c, t0), at(c, t1), ceil, own, r.id, LEVEL_Y[roomLevel(r)]);
        }
        continue;
      }
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
            this.k.box(this.k.m.metalDark, u, v, 0.012, 0.6, 0.012, ceil - 0.6);
            this.k.cyl(this.k.m.board, u, v, 0.34, 0.16, ceil - 0.76);
            this.k.cyl(this.k.m.light, u, v, 0.26, 0.02, ceil - 0.775);
            this.k.note(u, v, 0.26, 0.26, ceil - 0.775, 'dome', r.id, LEVEL_Y[roomLevel(r)]);
          }
        }
      }
    }
  }

  /**
   * Luz lineal de a → b con la cara de arriba en `top` (el cielorraso):
   * perfil grafito de 7 cm embutido 1 cm y difusor encendido de 4,5 cm que
   * asoma 1 cm por debajo. Con interruptor (`own`) el difusor lo dibuja el
   * juego (`game/world/Lights`); acá queda el perfil. Se anota por tramos de
   * ~2,4 m (`LampFixture`): los efectos que siguen a las luminarias ven
   * puntos de luz repartidos, como con los tubos sueltos.
   */
  private lightLine(a: P, b: P, top: number, own: Fixture[] | null, room: string | null, floor: number): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.2) return;
    const du = (b[0] - a[0]) / len;
    const dv = (b[1] - a[1]) / len;
    this.k.piece(this.k.m.graphite, a, b, 0.07, top - 0.035, top + 0.01);
    const yb = top - 0.045;
    const h = 0.012;
    const lu = Math.abs(du) >= Math.abs(dv);
    if (own) {
      const p = toWorld(this.k.f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      own.push({ x: p.x, y: yb + h / 2, z: p.z, sx: lu ? len - 0.03 : 0.045, sy: h, sz: lu ? 0.045 : len - 0.03 });
    } else {
      this.k.piece(this.k.m.light, [a[0] + du * 0.015, a[1] + dv * 0.015], [b[0] - du * 0.015, b[1] - dv * 0.015], 0.045, yb, yb + h);
    }
    const n = Math.max(1, Math.round(len / 2.4));
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n) * len;
      const seg = len / n;
      this.k.note(a[0] + du * t, a[1] + dv * t, lu ? seg : 0.045, lu ? 0.045 : seg, yb, 'tube', room, floor, !!own);
    }
  }

  // ============================================================= cielorrasos

  ceilings(): void {
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
        this.k.prisms.plan(this.k.m[kind ?? 'ceiling'], piece, y, y + 0.06, { top: false, sides });
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
        this.k.prisms.plan(this.k.m.ceiling, [[h.u0, h.v0], [h.u1, h.v0], [h.u1, h.v1], [h.u0, h.v1]], LEVEL_Y[L] + 3.1, LEVEL_Y[L] + 3.16, { top: false, sides: false });
      }
    }
    // Hall del segundo piso: la bóveda arranca recién en el muro de los
    // espejos; al oeste, bajo la azotea del remate, va un cielorraso común.
    this.k.prisms.plan(this.k.m.ceiling, [[U.salonW, V1.blockA], [U1.vaultW, V1.blockA], [U1.vaultW, V1.blockHall], [U.salonW, V1.blockHall]], LEVEL_Y[2] + 3.1, LEVEL_Y[2] + 3.16, {
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
        if (WALLS.some((w) => w.level === level && this.k.nearSegment(w.a, w.b, p, (w.kind === 'int' ? SCHOOL.wallT : SCHOOL.extT) / 2 + 0.03))) return null;
        return ceilingHeight(nb);
      };
      for (const [t0, t1] of this.k.runs(len, (t) => stepAt(t) !== null, 0.2)) {
        const top = stepAt((t0 + t1) / 2) ?? here;
        // De 1 cm dentro de la losa de este cielorraso a 3 cm dentro de la
        // del vecino: ninguna cara queda en el plano de otra.
        this.k.piece(this.k.m.ceiling, [a[0] + du * t0, a[1] + dv * t0], [a[0] + du * t1, a[1] + dv * t1], 0.04, y + 0.01, y - here + top + 0.03, inward * 0.02);
      }
    }
  }

  /**
   * Pared del mural del Aula Maker (la medianera, en diagonal): estante largo
   * sobre ménsulas azules, televisor, mueble bajo con robots y tablero
   * perforado, estantería con cajas negras y el camión a control remoto; y
   * en el testero de Miguel Cané, el pizarrón interactivo entre dos
   * estanterías con cajas celestes (recorrido 2:32-3:20).
   */
  makerWall(): void {
    const m = this.k.m;
    const at = (s: number, off = 0): P => makerWallAt(s, off);
    const face = 0.15;
    // Estante a 1,05 m, de punta a punta salvo el tramo del mueble bajo.
    this.k.piece(m.board, at(0.8), at(9.3), 0.25, FY + 1.03, FY + 1.06, face + 0.125);
    for (let s = 1.2; s < 9.3; s += 1.6) this.k.piece(m.blue, at(s - 0.02), at(s + 0.02), 0.2, FY + 0.9, FY + 1.03, face + 0.1);
    // Objetos sobre el estante: mapas de madera, robots y cajas.
    for (const [s, mat, h] of [
      [1.9, m.timber, 0.35],
      [2.4, m.metalDark, 0.25],
      [4.5, m.timberDark, 0.3],
      [5.2, m.blue, 0.2],
      [6.9, m.board, 0.25],
      [8.0, m.timber, 0.4],
    ] as const) {
      this.k.piece(mat, at(s - 0.15), at(s + 0.15), 0.2, FY + 1.06, FY + 1.06 + h, face + 0.125);
    }
    // Televisor de 55" entre las columnas azul marino y roja.
    this.k.piece(m.metalDark, at(7.1), at(8.3), 0.06, FY + 1.4, FY + 2.1, face + 0.04);
    // Mueble bajo con robots y tablero perforado con herramientas.
    this.k.piece(m.timber, at(9.5), at(10.7), 0.45, FY, FY + 0.6, face + 0.225);
    this.k.piece(m.timber, at(9.5), at(10.7), 0.03, FY + 0.6, FY + 2.1, face + 0.03);
    for (const [s, mat] of [
      [9.7, m.red],
      [10.0, m.lime],
      [10.3, m.orange],
      [10.55, m.blue],
    ] as const) {
      this.k.piece(mat, at(s - 0.06), at(s + 0.06), 0.12, FY + 0.6, FY + 0.78, face + 0.25);
      this.k.piece(mat, at(s - 0.02), at(s + 0.02), 0.06, FY + 1.6, FY + 1.85, face + 0.07);
    }
    // Estantería alta con ocho cajas negras y el camión amarillo arriba.
    this.k.piece(m.timber, at(10.8), at(11.6), 0.4, FY, FY + 1.9, face + 0.2);
    for (const y of [0.15, 0.6, 1.05, 1.5]) {
      // 1 cm salidas del frente de la estantería (al ras, sus caras titilaban).
      this.k.piece(m.metalDark, at(10.85), at(11.55), 0.37, FY + y, FY + y + 0.32, face + 0.225);
    }
    this.k.piece(m.yellow, at(11.0), at(11.45), 0.3, FY + 1.9, FY + 2.15, face + 0.2);
    // Testero de Miguel Cané: pizarrón interactivo entre las dos ventanas
    // altas y una estantería con cajas celestes (la otra son los muebles
    // Educabot, junto a la puerta).
    const mcIn = (v: number, off: number): P => {
      const u = miguelCaneU(v);
      // Normal hacia adentro (este) de la línea de Miguel Cané.
      return [u + off * MC_COS, v + off * MC_SLOPE * MC_COS];
    };
    this.k.piece(m.metalDark, mcIn(planV(-34.2), 0.17), mcIn(planV(-35.7), 0.17), 0.05, FY + 0.88, FY + 2.12);
    this.k.piece(m.board, mcIn(planV(-34.25), 0.2), mcIn(planV(-35.65), 0.2), 0.02, FY + 0.92, FY + 2.08);
    for (const [v0, v1] of [[planV(-36.4), planV(-37.1)]] as const) {
      this.k.piece(m.timber, mcIn(v0, 0.35), mcIn(v1, 0.35), 0.4, FY, FY + 1.8);
      this.k.piece(m.blue, mcIn(v0, 0.35), mcIn(v1, 0.35), 0.36, FY + 1.8, FY + 2.0);
    }
  }
}
