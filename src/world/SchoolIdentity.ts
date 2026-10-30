import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import {
  ITEMS,
  MC_COS,
  MC_SLOPE,
  MEETING_POINT,
  PORTAL,
  SCHOOL,
  U,
  V,
  rearV,
  toWorld,
  GYM_MID,
  makerWallAt,
  SC,
  planU,
  planV,
  FURNITURE,
  LEVEL_Y,
  roomAt,
  type Level,
  type SchoolFrame,
} from './SchoolLayout';
import { createGymGlints } from './GymGlints';
import { createLightPools, type LightPoolsHandle } from './LightPools';
import { createSchoolFloorGlints, type FloorGlints } from './FloorGlints';
import { DOORS } from './SchoolDoors';
import type { LampFixture } from './builders/school/SchoolKit';
import {
  AH,
  AW,
  R,
  SH,
  SR,
  SW,
  boardScreenRegion,
  doorPlateRegion,
  drawAtlas,
  drawScreens,
  plateRegion,
  type PlateName,
  type Region,
} from './SchoolAtlas';

const FY = SCHOOL.floorY;

/**
 * Señalética y superficies pintadas del campus CIMDIP & Miguel Cané.
 *
 * Marquesina del portal, escudo, bandera, banner del hall, mural de
 * Tecnología, cancha del gimnasio, carteles de cada ambiente con los nombres
 * del plano, carteles de calle, punto de encuentro y un plano de evacuación
 * dibujado desde los MISMOS datos con los que se levanta la escuela. Todo
 * comparte UNA textura y UNA malla: un solo draw call, que en VR es lo que
 * importa.
 */
export class SchoolIdentity {
  private readonly mesh: Mesh;
  private readonly floorMesh: Mesh;
  private readonly glints: ReturnType<typeof createGymGlints>;
  private readonly material: StandardMaterial;
  private readonly floorMaterial: StandardMaterial;
  private readonly texture: DynamicTexture;
  /** Pantallas, LED y escudo retroiluminado (Escuela 2050): luz propia, un draw call. */
  private readonly screenMesh: Mesh;
  private readonly screenMaterial: StandardMaterial;
  private readonly screenTexture: DynamicTexture;
  /** Pozos de luz de las luminarias (sólo si el constructor pasó `fixtures`). */
  private readonly pools: LightPoolsHandle | null;
  /** Reflejos de las luminarias en los pisos pulidos (fuera del polideportivo). */
  private readonly floorGlints: FloorGlints | null;

  /**
   * `fixtures`: las luminarias que anotó el constructor
   * (`SchoolBuilder.fixtures`). Con ellas se arman los pozos de luz falsos
   * (`LightPools`) y los reflejos del polideportivo siguen a las barras LED
   * de la bóveda; sin ellas, sólo los reflejos de siempre.
   */
  constructor(scene: Scene, frame: SchoolFrame, fixtures?: readonly LampFixture[]) {
    this.texture = new DynamicTexture('schoolAtlas', { width: AW, height: AH }, scene, true);
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    drawAtlas(ctx);
    this.texture.update(true);
    this.texture.anisotropicFilteringLevel = 8;
    // Recorte por alfa (sin mezcla): permite carteles con silueta, como el
    // óvalo de la cantina, sin ordenar transparencias. Todo lo demás es opaco.
    this.texture.hasAlpha = true;

    this.material = new StandardMaterial('schoolIdentity', scene);
    this.material.diffuseTexture = this.texture;
    this.material.diffuseColor = new Color3(0.5, 0.5, 0.5);
    this.material.specularColor = Color3.Black();
    // Luz propia moderada: los carteles se leen aunque queden en sombra.
    this.material.emissiveColor = new Color3(0.46, 0.46, 0.46);
    // La bandera se ve de los dos lados.
    this.material.backFaceCulling = false;

    // La cancha del polideportivo va aparte, con más luz propia: el
    // estándar multiplica el emisivo por la textura, y bajo la bóveda (sin
    // sol directo) el cemento claro quedaba gris oscuro. Un draw call más,
    // sólo cuando el polideportivo está en cuadro.
    this.floorMaterial = new StandardMaterial('schoolIdentityFloor', scene);
    this.floorMaterial.diffuseTexture = this.texture;
    this.floorMaterial.diffuseColor = new Color3(0.42, 0.42, 0.42);
    // Video 2026 (1:31–1:37): el piso del polideportivo está pulido. Brillo
    // marcado y un reflejo tenue del cielo (la sonda de la escena) que sube en
    // ángulo rasante; sólo este material, el resto sigue mate.
    this.floorMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
    this.floorMaterial.specularPower = 90;
    this.floorMaterial.emissiveColor = new Color3(0.66, 0.66, 0.64);
    const sheen = new FresnelParameters();
    sheen.bias = 0.06;
    sheen.power = 2.5;
    sheen.leftColor = new Color3(0.3, 0.3, 0.3);
    sheen.rightColor = new Color3(0.03, 0.03, 0.03);
    this.floorMaterial.reflectionFresnelParameters = sheen;

    // Pantallas de la Escuela 2050 (auditoría 2050, ítems 5, 15, 17 y 18):
    // otro atlas (`drawScreens`) con luz propia y sin sombra, como una
    // pantalla encendida. El color de vértice da la ganancia de cada pieza:
    // ~0,9 el contenido (no encandila), 1,8 las tiras LED (pasan el umbral
    // del bloom en escritorio y en el visor se ven blancas cálidas).
    this.screenTexture = new DynamicTexture('schoolScreens', { width: SW, height: SH }, scene, true);
    drawScreens(this.screenTexture.getContext() as unknown as CanvasRenderingContext2D);
    this.screenTexture.update(true);
    this.screenTexture.anisotropicFilteringLevel = 8;
    // El escudo del portal es un disco: recorte por alfa, como el atlas.
    this.screenTexture.hasAlpha = true;
    this.screenMaterial = new StandardMaterial('schoolScreens', scene);
    this.screenMaterial.diffuseTexture = this.screenTexture;
    this.screenMaterial.diffuseColor = Color3.Black();
    this.screenMaterial.specularColor = Color3.Black();
    this.screenMaterial.emissiveColor = Color3.White();
    this.screenMaterial.disableLighting = true;
    const sq = new QuadBatch(frame);

    const q = new QuadBatch(frame);
    const S = 1; // mira al sur (+v)
    const N = -1; // mira al norte (−v)
    const portalU = (PORTAL.g0 + PORTAL.g1) / 2;
    // Portal sobre Laprida: marquesina y escudo.
    // El portal sobresale 0,85 m de la fachada (ver SchoolBuilder.portal).
    q.wall((PORTAL.u0 + PORTAL.u1) / 2, PORTAL.front + 0.025, 3.15, 8.2, 1.36, 0, S, R.sign);
    // Escudo retroiluminado de 1,1 m (ítem 15): disco claro con luz propia,
    // delante de las franjas, para leerse desde la vereda de enfrente (antes
    // era un cartel oscuro de 0,7 m). El disco de luz cálida de 1,3 m que lo
    // rodea es de la envolvente (SchoolBuilder.portal), un poco más atrás.
    sq.gain = 0.92;
    sq.wall(portalU, PORTAL.front + 0.085, CREST_Y, CREST_D, CREST_D, 0, S, SR.crestDisc);
    // Bandera colgada de la punta del mástil (antes flotaba delante del
    // muro): tres paños que caen de los últimos 1,2 m del mástil, con
    // pliegues alternados de ±8°.
    hangFlag(q, frame);
    // Jardín: marquesina "Educación Inicial" y banda "CIMDIP" sobre la calle del norte.
    q.wall(planU(63.3), V.top - 0.97, 3.2, 8.0, 0.88, 0, N, R.inicial);
    q.wall(planU(58.525), V.top - 0.27, 6.0, 1.4, 5.2, 0, N, R.cimdip);

    // Hall de acceso: banner de pie, reloj sobre las puertas y plano de evacuación.
    // Tótem digital (ítem 5): dos caras de pantalla a los lados del parante
    // y cantos oscuros, con filete LED. La lona de una sola cara se veía
    // espejada desde el norte (D06).
    const banner = ITEMS.find((it) => it.kind === 'banner');
    if (banner) {
      sq.gain = 0.95;
      sq.wall(banner.u, banner.v + 0.035, FY + 1.3, 0.84, 1.9, 0, S, SR.totemFront);
      sq.wall(banner.u, banner.v - 0.035, FY + 1.3, 0.84, 1.9, 0, N, SR.totemBack);
      for (const s of [-1, 1]) sq.wall(banner.u + s * 0.42, banner.v, FY + 1.3, 0.07, 1.9, s, 0, SR.dark);
      sq.floorAlongU(banner.u - 0.42, banner.v - 0.035, banner.u + 0.42, banner.v + 0.035, FY + 2.25, SR.dark);
    }

    // Recepción: mural del cruce de los Andes en el muro oeste (el del aula
    // 5, entre el frente del hall y la boca del pasillo sur), con el lema
    // pintado debajo sobre el zócalo de mármol (0:18-0:23).
    // Escuela 2050 (ítem 5): el mural es una pantalla LED de 2,3 × 1,25 m a
    // FY + 2,1 (el split y el parante, que lo tapaban, se corren: datos de
    // SchoolGround), con un halo LED cálido detrás que asoma 4 cm por los
    // bordes; el lema, grabado en vidrio ahumado sobre el zócalo.
    sq.gain = 1.8;
    sq.wall(U.east1 + 0.103, planV(-4.25), FY + 2.1, 2.38, 1.33, 1, 0, SR.ledWarm);
    sq.gain = 0.9;
    sq.wall(U.east1 + 0.109, planV(-4.25), FY + 2.1, 2.3, 1.25, 1, 0, SR.sanMartin);
    sq.wall(U.east1 + 0.106, planV(-4.25), FY + 1.05, 2.5, 0.62, 1, 0, SR.motto);

    // Aula Maker: el mural de vinilo sobre la medianera (dos paños) y
    // COMPARTE en el testero este; Educabot al costado de los muebles de la
    // entrada; cartel de salida sobre la puerta de emergencia.
    for (const [s0, s1, region] of [
      [0.6, 6.4, R.makerA],
      [6.4, 12.2, R.makerB],
    ] as const) {
      const [cu, cv] = makerWallAt((s0 + s1) / 2, 0.16);
      const [au, av] = makerWallAt(0, 0);
      const [bu, bv] = makerWallAt(0, 1);
      // `s` es del plano: el paño real mide (s1 − s0)·SC.
      q.wall(cu, cv, FY + 1.275, (s1 - s0) * SC, 2.35, bu - au, bv - av, region);
    }
    // COMPARTE va sobre el banco de la láser, al norte del portón al patio.
    q.wall(U.tecE - 0.16, planV(-34.7), FY + 1.95, 2.05, 1.175, -1, 0, R.makerC);
    // Educabot: en el costado del primer mueble, frente a la puerta.
    q.wall(planU(13.69), planV(-31.89), FY + 0.95, 0.45, 1.9, 0, S, R.educabot);
    q.wall(U.tecE - 0.11, planV(-32.45), FY + 2.5, 0.5, 0.18, -1, 0, R.salida);
    q.wall(planU(13.2), V.nBlockN + 0.115, FY + 2.42, 0.5, 0.18, 0, S, R.salida);

    // Pasillo sur: carteleras de corcho de marco rojo cerca de la salida.
    q.wall(planU(2.6), V.classTop - 0.115, FY + 1.9, 1.4, 1.0, 0, N, R.cork1);
    q.wall(planU(6.35), V.corrS + 0.115, FY + 1.9, 1.4, 1.0, 0, S, R.cork2);
    // Reloj sobre la entrada, del lado del hall.
    const entrance = planU((34.2 + 36.27) / 2);
    q.wall(entrance, V.hallDoors - 0.13, 3.0, 0.42, 0.42, 0, N, R.clock);
    // El plano de evacuación cuelga en el frente de la oficina de recepción.
    q.wall(planU(37.6), V.recB - 0.115, 1.65, 1.0, 0.62, 0, -1, R.plan);

    // Tecnología: mural "imagina · diseña · crea" y cartel del aula maker.
    q.wall(planU(25.0), V.nBlockN - 0.115, 1.95, 3.7, 1.48, 0, N, R.mural);
    q.wall(planU(14.6), V.nBlockN - 0.115, 1.8, 0.9, 1.46, 0, N, R.maker);

    // Pasillo de Arte y Teatro, el "túnel" del patio al hall del jardín (video
    // 2026, 1:11–1:22): el muro del polideportivo (a la derecha entrando) está
    // pintado de punta a punta desde el piso, con la franja de pasto ondulada
    // abajo, flores altas y figuras, hasta la ventanita de celosía. Las
    // proporciones de kidsA y kidsC son las de sus paños (2,05 m de alto).
    const kidsY = FY + 0.012 + 1.025;
    const kidsU0 = planU(50.35);
    // Los murales pintados se ven del blanco del muro (D12): el material
    // compartido de la cartelería los dejaba ~15 % más grises que el látex.
    q.gain = KIDS_GAIN;
    q.wall(kidsU0 + 2.262, V.gymTop - 0.115, kidsY, 4.524, 2.05, 0, N, R.kidsA);
    q.wall(kidsU0 + 4.524 + 1.339, V.gymTop - 0.115, kidsY, 2.678, 2.05, 0, N, R.kidsC);
    // A la izquierda (Arte y Teatro): árbol en el paño ciego entre las dos
    // puertas y estrellas de mar y delfines bajo las dos ventanas.
    q.wall(planU(53.65), V.artB + 0.115, FY + 0.012 + 0.87, 1.0, 1.74, 0, S, R.kidsTree);
    q.wall(planU(50.9), V.artB + 0.115, FY + 0.012 + 0.31, 0.86, 0.62, 0, S, R.sea1);
    q.wall(planU(56.85), V.artB + 0.115, FY + 0.012 + 0.42, 1.24, 0.84, 0, S, R.sea2);
    q.wall(U.teaX + 0.115, planV(-25.8), FY + 1.7, 2.6, 1.48, 1, 0, R.kidsB);
    q.gain = 1;

    // Aula de danzas: afiches de las muestras en el testero norte.
    q.wall(planU(45.6), V.gymTop + 0.115, 2.35, 0.75, 1.12, 0, S, R.ballet1);
    q.wall(planU(46.55), V.gymTop + 0.115, 2.35, 0.75, 1.12, 0, S, R.ballet2);

    // Polideportivo: la cancha ocupa todo el piso (corre de oeste a este) y
    // la bandera blanca con el escudo cuelga en el testero este.
    const floor = new QuadBatch(frame);
    floor.floorAlongU(U.gymW + 0.1, V.gymTop + 0.1, U.e - 0.15, -0.15, FY + 0.006, R.court);
    this.floorMesh = floor.toMesh('schoolIdentityFloor', scene);
    this.floorMesh.material = this.floorMaterial;
    // La sonda del cielo se crea (y se rehace al cambiar la hora) después de
    // construir la escuela: se toma la vigente al dibujar el piso.
    this.floorMesh.onBeforeRenderObservable.add(() => {
      const env = scene.environmentTexture;
      if (this.floorMaterial.reflectionTexture !== env) this.floorMaterial.reflectionTexture = env;
    });
    this.floorMesh.isPickable = false;
    // Reflejos de las luminarias en el piso pulido (ver GymGlints).
    this.glints = createGymGlints(scene, frame, fixtures);
    // Pozos de luz falsos bajo las luminarias (ítem 24).
    this.pools = fixtures ? createLightPools(scene, frame, fixtures) : null;
    // Y su reflejo en los pisos encerados de pasillos, hall y aulas.
    this.floorGlints = fixtures ? createSchoolFloorGlints(scene, frame, fixtures) : null;
    q.wall(U.e - 0.18, GYM_MID, 5.1, 2.2, 2.75, -1, 0, R.crestBanner);

    // Carteles de los ambientes sobre sus puertas.
    const plate = (name: PlateName, u: number, v: number, nu: number, nv: number, w = 1.15, y = 2.42) =>
      q.wall(u, v, y, w, w * (64 / 504), nu, nv, plateRegion(name));
    plate('E.P', planU(18.25), V.nBlockS + 0.115, 0, S);
    // Sobre la boca del pasillo del Aula Maker (paso alto) y sobre su portón al patio este.
    plate('TECNOLOGÍA', planU(13.3), V.nBlockS + 0.115, 0, S, 1.15, 2.78);
    plate('TECNOLOGÍA', U.tecE + 0.115, planV(-32.45), 1, 0, 1.15, 2.52);
    plate('ADM', planU(9.6), V.admN - 0.115, 0, N, 0.8);
    plate('PROF.', planU(11.5), V.profB + 0.115, 0, S, 0.8);
    plate('DIR. PRIM', planU(4.3), V.corrS + 0.115, 0, S, 0.9);
    plate('BUFFET', planU(28.67), V.corrS + 0.115, 0, S);
    // Su puerta es doble (vano de 2,25 m): el cartel va por encima del cabezal.
    plate('SALÓN DE LOS ESPEJOS', U.salonW - 0.115, planV(-11.85), -1, 0, 1.5, 2.46);
    plate('GIMNASIO · SUM', U.gymW - 0.115, planV(-10.1), -1, 0, 1.5, 2.5);
    plate('GIMNASIO · SUM', planU(59.3), V.gymTop - 0.115, 0, N, 1.6, 2.55);
    plate('ARTE', planU(52.35), V.artB + 0.115, 0, S, 0.8);
    plate('TEATRO', planU(55.05), V.artB + 0.115, 0, S, 0.9);
    plate('V. DAMAS', U.vdW - 0.115, planV(-25.95), -1, 0, 0.9);
    {
      // Puerta del jardín sobre la medianera vieja (diagonal).
      const k = 0.2496;
      const l = Math.hypot(1, k);
      const nu = -k / l;
      const nv = 1 / l;
      const uj = planU(60.75);
      plate('JARDÍN DE INFANTES CIMPID', uj + nu * 0.115, rearV(uj) + nv * 0.115, nu, nv, 1.6);
    }
    plate('PATIO AIRE LIBRE', planU(23.02), V.corrS + 0.115, 0, S, 1.3, 2.78);
    plate('PATIO AIRE LIBRE', planU(36.2), V.hallTop + 0.115, 0, S, 1.3, 2.78);
    // Sobre la entrada, del lado del atrio (a 3,35 m quedaba sobre el cielorraso).
    plate('HALL DE ACCESO', entrance, V.hallDoors + 0.115, 0, S, 1.3, 2.95);

    // Esquina de Laprida y Miguel Cané: carteles de calle y punto de encuentro.
    // El mismo poste que dibuja `SchoolOutdoor.frontage` (coordenadas del plano).
    const pole = { u: planU(-6.3), v: planV(3.3) };
    for (const s of [S, N]) {
      q.wall(pole.u + 0.5, pole.v + s * 0.035, 2.95, 0.9, 0.17, 0, s, R.lapr);
    }
    {
      // A lo largo de Miguel Cané, hacia el norte.
      const du = MC_SLOPE * MC_COS;
      const dv = -MC_COS;
      for (const s of [1, -1]) {
        const nu = -dv * s;
        const nv = du * s;
        q.wall(pole.u + du * 0.5 + nu * 0.035, pole.v + dv * 0.5 + nv * 0.035, 3.2, 0.9, 0.17, nu, nv, R.mcane);
      }
    }
    q.wall(MEETING_POINT[0], MEETING_POINT[1] + 0.03, 2.0, 0.55, 0.64, 0, S, R.meet);

    this.mesh = q.toMesh('schoolIdentity', scene);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;

    // Pantallas de las aulas (ítem 17) y plaquitas de las puertas (ítem 18).
    boardScreens(sq);
    doorPlates(sq);
    mirrorLeds(sq);
    this.screenMesh = sq.toMesh('schoolScreens', scene);
    this.screenMesh.material = this.screenMaterial;
    this.screenMesh.isPickable = false;
  }

  get shadowCasters(): Mesh[] {
    return [this.mesh, this.floorMesh];
  }

  /**
   * Luces de un aula encendidas o apagadas (el interruptor del juego): apaga
   * también sus pozos de luz. Lo llama quien llama a
   * `Environment.setRoomLights` (main.ts).
   */
  setRoomLights(room: string, on: boolean): void {
    this.pools?.setRoom(room, on);
    this.floorGlints?.setRoom(room, on);
  }

  dispose(): void {
    this.mesh.dispose();
    this.floorMesh.dispose();
    this.screenMesh.dispose();
    this.screenMaterial.dispose();
    this.screenTexture.dispose();
    this.pools?.dispose();
    this.floorGlints?.dispose();
    this.glints.dispose();
    this.material.dispose();
    this.floorMaterial.dispose();
    this.texture.dispose();
  }
}

// ------------------------------------------------------------------ Escuela 2050

/** Escudo retroiluminado del portal: centro y diámetro (el disco LED de la envolvente lo rodea). */
export const CREST_Y = 6.8;
export const CREST_D = 1.1;

/** Ganancia de los murales pintados de los chicos (ver el constructor). */
const KIDS_GAIN = 1.16;

/**
 * Mástil inclinado del portal, tal como lo dibuja `SchoolBuilder.portal`:
 * centro, largo y cabeceo. Si la envolvente lo mueve, hay que moverlo acá.
 */
const MAST = { u: -0.2, v: 1.45, y: 5.35, len: 1.9, pitch: -0.6 } as const;

/** Dirección local (Δu, Δv) hacia la que mira un frente. */
function faceDir(face: 'n' | 's' | 'e' | 'w'): [number, number] {
  return face === 'n' ? [0, -1] : face === 's' ? [0, 1] : face === 'e' ? [1, 0] : [-1, 0];
}

/**
 * Bandera argentina colgada de la punta del mástil del portal (ítem 15): su
 * borde de arriba va a lo largo del último 1,2 m del mástil y cae 0,77 m en
 * tres paños con pliegues alternados de ±8° (la tela no es una tabla).
 */
function hangFlag(q: QuadBatch, f: SchoolFrame): void {
  const c = toWorld(f, PORTAL.u0 + MAST.u, MAST.v);
  const rot = Quaternion.FromEulerAngles(MAST.pitch, 0, 0);
  const half = new Vector3(0, 0, MAST.len / 2).applyRotationQuaternion(rot);
  const tip = new Vector3(c.x, MAST.y, c.z).add(half);
  const back = half.normalizeToNew().scale(-1);
  const len = 1.2;
  const drop = 0.77;
  const fold = 0.4 * Math.sin((8 * Math.PI) / 180);
  // Junta k (0 = punta): arriba sobre el mástil (5 cm por debajo de su eje)
  // y abajo corrida de costado (±x de mundo, perpendicular al mástil).
  const at = (k: number, bottom: boolean): L => {
    const p = tip.add(back.scale((len * k) / 3));
    const side = (k % 2 ? 1 : 0) * fold * (bottom ? 1 : 0.3);
    return [p.x + side, p.y - 0.05 - (bottom ? drop : 0), p.z];
  };
  const r = R.flag;
  for (let i = 0; i < 3; i++) {
    // La imagen va de la punta de adentro (izquierda) a la de afuera.
    const kIn = 3 - i;
    const kOut = 2 - i;
    const x0 = r[0] + ((r[2] - r[0]) * i) / 3;
    const x1 = r[0] + ((r[2] - r[0]) * (i + 1)) / 3;
    q.quad([at(kIn, true), at(kOut, true), at(kOut, false), at(kIn, false)], [1, 0, 0], [x0, r[1], x1, r[3]]);
  }
}

/**
 * Contenido de las pantallas de las aulas (ítem 17) sobre cada pizarra
 * (`board`), que la Escuela 2050 vuelve un panel de vidrio oscuro (B): a
 * 3 cm de la cara del muro (el panel queda a 2 cm) y 4 cm adentro de cada
 * borde. Cuatro contenidos alternados por posición.
 */
function boardScreens(sq: QuadBatch): void {
  sq.gain = 0.9;
  const h = FURNITURE.boardTop - FURNITURE.boardBottom;
  for (const it of ITEMS) {
    if (it.kind !== 'board') continue;
    const alongV = it.face === 'e' || it.face === 'w';
    const len = alongV ? it.d : it.w;
    const depth = alongV ? it.w : it.d;
    const [fu, fv] = faceDir(it.face);
    const off = Math.max(0.012, -depth / 2 + 0.03);
    const y = LEVEL_Y[(it.level ?? 0) as Level] + FURNITURE.boardBottom + h / 2;
    const variant = Math.abs(Math.round(it.u * 7 + it.v * 3)) % 4;
    sq.wall(it.u + fu * off, it.v + fv * off, y, len - 0.08, h - 0.08, fu, fv, boardScreenRegion(variant));
  }
}

/**
 * Filo LED de los espejos (ítem 22): una línea de luz cálida sobre el canto
 * de arriba de cada espejo (sobre el travesaño del marco, si tiene).
 */
function mirrorLeds(sq: QuadBatch): void {
  sq.gain = 1.6;
  for (const it of ITEMS) {
    if (it.kind !== 'mirror') continue;
    const alongV = it.face === 'e' || it.face === 'w';
    const len = alongV ? it.d : it.w;
    const depth = alongV ? it.w : it.d;
    const [fu, fv] = faceDir(it.face);
    const fy = LEVEL_Y[(it.level ?? 0) as Level];
    const top = fy + 0.25 + (it.h ?? 1.9);
    const off = it.color ? (depth + 0.03) / 2 + 0.004 : depth / 2 + 0.004;
    const y = it.color ? top + 0.03 : top - 0.012;
    sq.wall(it.u + fu * off, it.v + fv * off, y, len - 0.04, 0.016, fu, fv, SR.ledWarm);
  }
}

/**
 * Plaquitas digitales de las puertas del juego (ítem 18): del lado del
 * pasillo, junto a la jamba del picaporte, a 1,5 m. Se omiten si caen en
 * otro vano o si el muro no sigue (una esquina).
 */
function doorPlates(sq: QuadBatch): void {
  sq.gain = 0.95;
  const W = 0.4;
  const Hp = 0.07;
  for (const d of DOORS) {
    const nu = -d.swing[0];
    const nv = -d.swing[1];
    let end = d.b;
    if (d.leaves.length === 1) {
      const hg = d.leaves[0].hinge;
      const da = Math.hypot(hg[0] - d.a[0], hg[1] - d.a[1]);
      const db = Math.hypot(hg[0] - d.b[0], hg[1] - d.b[1]);
      end = da > db ? d.a : d.b;
    }
    const cx = (d.a[0] + d.b[0]) / 2;
    const cy = (d.a[1] + d.b[1]) / 2;
    const ol = Math.hypot(end[0] - cx, end[1] - cy) || 1;
    const ou = (end[0] - cx) / ol;
    const ov = (end[1] - cy) / ol;
    const pu = end[0] + ou * (0.12 + W / 2 + 0.06);
    const pv = end[1] + ov * (0.12 + W / 2 + 0.06);
    const face = d.wallT / 2 + 0.008;
    const level = d.level;
    // El muro sigue detrás de la plaquita (del lado del ambiente) y delante
    // hay pasillo, en las dos puntas.
    let ok = true;
    for (const s of [-1, 1]) {
      const eu = pu + ou * s * (W / 2 + 0.05);
      const ev = pv + ov * s * (W / 2 + 0.05);
      const behind = roomAt(eu - nu * (face + 0.25), ev - nv * (face + 0.25), level);
      const front = roomAt(eu + nu * (face + 0.25), ev + nv * (face + 0.25), level);
      if (behind?.id !== d.room.id || !front || front.id === d.room.id) ok = false;
    }
    // Ningún otro vano del juego en ese tramo.
    for (const e of DOORS) {
      if (e === d || e.level !== level) continue;
      const ex = e.b[0] - e.a[0];
      const ey = e.b[1] - e.a[1];
      const el = Math.hypot(ex, ey) || 1;
      const t = Math.max(0, Math.min(1, ((pu - e.a[0]) * ex + (pv - e.a[1]) * ey) / (el * el)));
      if (Math.hypot(pu - (e.a[0] + ex * t), pv - (e.a[1] + ey * t)) < W / 2 + 0.2) ok = false;
    }
    if (!ok) continue;
    sq.wall(pu + nu * face, pv + nv * face, LEVEL_Y[level] + 1.5, W, Hp, nu, nv, doorPlateRegion(d.label));
  }
}

// ------------------------------------------------------------------ geometría

type L = [number, number, number];

/** Acumula quads texturizados en coordenadas locales del campus. */
class QuadBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  /**
   * Ganancia de los quads que se agregan desde ahora (color de vértice: el
   * StandardMaterial multiplica la textura por él). 1 = el dibujo tal cual.
   */
  gain = 1;

  constructor(private readonly f: SchoolFrame) {}

  /**
   * Cartel vertical centrado en (u, v) a la altura `y`, con normal horizontal
   * (nu, nv). Para quien lo mira de frente, la derecha es (−nv, nu).
   */
  wall(u: number, v: number, y: number, w: number, h: number, nu: number, nv: number, r: Region): void {
    // Todo en mundo: +u es −x, así que la derecha del lector se calcula con
    // la normal ya transformada. En local el texto salía espejado.
    const c = toWorld(this.f, u, v);
    const o = toWorld(this.f, 0, 0);
    const n = toWorld(this.f, nu, nv);
    const nx = n.x - o.x;
    const nz = n.z - o.z;
    const rx = -nz;
    const rz = nx;
    const hw = w / 2;
    const hh = h / 2;
    const bl: L = [c.x - rx * hw, y - hh, c.z - rz * hw];
    const br: L = [c.x + rx * hw, y - hh, c.z + rz * hw];
    const tr: L = [c.x + rx * hw, y + hh, c.z + rz * hw];
    const tl: L = [c.x - rx * hw, y + hh, c.z - rz * hw];
    this.push([bl, br, tr, tl], [nx, 0, nz], r);
  }

  /** Superficie horizontal: el ancho del dibujo a lo largo de u (oeste → este) y el alto a lo largo de v (norte → sur). */
  floorAlongU(u0: number, v0: number, u1: number, v1: number, y: number, r: Region): void {
    const w = (u: number, v: number): L => {
      const p = toWorld(this.f, u, v);
      return [p.x, y, p.z];
    };
    this.push([w(u0, v1), w(u1, v1), w(u1, v0), w(u0, v0)], [0, 1, 0], r);
  }

  /** Superficie horizontal con el eje largo del dibujo a lo largo de v. */
  floorAlongV(u0: number, v0: number, u1: number, v1: number, y: number, r: Region): void {
    const w = (u: number, v: number): L => {
      const p = toWorld(this.f, u, v);
      return [p.x, y, p.z];
    };
    this.push([w(u1, v0), w(u1, v1), w(u0, v1), w(u0, v0)], [0, 1, 0], r);
  }

  /**
   * Quad con las esquinas ya en mundo (inferior-izq, inferior-der,
   * superior-der, superior-izq) y su normal en mundo.
   */
  quad(c: [L, L, L, L], n: [number, number, number], r: Region): void {
    this.push(c, n, r);
  }

  /** Esquinas ya en mundo: inferior-izq, inferior-der, superior-der, superior-izq. */
  private push(c: [L, L, L, L], nLocal: [number, number, number], r: Region): void {
    const base = this.positions.length / 3;
    for (const p of c) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nLocal[0], nLocal[1], nLocal[2]);
      this.colors.push(this.gain, this.gain, this.gain, 1);
    }
    // Con invertY (el valor por defecto) la fila 0 del canvas es v = 1.
    const u0 = r[0] / AW;
    const u1 = r[2] / AW;
    const vb = 1 - r[3] / AH;
    const vt = 1 - r[1] / AH;
    this.uvs.push(u0, vb, u1, vb, u1, vt, u0, vt);

    // Orden de índices que Babylon considera cara frontal para esta normal:
    // su normal de cara es (a−b)×(c−b).
    const P = (i: number) => this.positions.slice((base + i) * 3, (base + i) * 3 + 3);
    const a = P(0);
    const b = P(1);
    const cc = P(2);
    const fx = (a[1] - b[1]) * (cc[2] - b[2]) - (a[2] - b[2]) * (cc[1] - b[1]);
    const fy = (a[2] - b[2]) * (cc[0] - b[0]) - (a[0] - b[0]) * (cc[2] - b[2]);
    const fz = (a[0] - b[0]) * (cc[1] - b[1]) - (a[1] - b[1]) * (cc[0] - b[0]);
    if (fx * nLocal[0] + fy * nLocal[1] + fz * nLocal[2] >= 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  toMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.colors = this.colors;
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    mesh.freezeWorldMatrix();
    return mesh;
  }
}
