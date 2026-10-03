import type { Scene } from '@babylonjs/core/scene';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { SWITCHES, type Fixture, type SwitchDef } from '../../world/SchoolLights';
import { LEVEL_Y, toWorld, type SchoolFrame } from '../../world/SchoolLayout';
import { GLOW_GAIN, INTERIOR_ENV, calibratePbr } from '../../world/Materials';
import type { SchoolPhase, WorldPoint } from '../contracts';
import { ThinSet } from './ThinSet';

/**
 * Luces de las aulas, con su interruptor junto a la puerta.
 *
 * Las luminarias (panel o tubo) son instancias de UNA malla emisiva: apagar
 * un aula es esconder sus instancias, y queda a la vista el marco blanco que
 * dibuja la escuela. Los interruptores son placas con una tecla que cambia de
 * posición. Dos draw calls para todas las aulas.
 *
 * En clase y a la entrada las luces están prendidas; en el recreo, el acto y
 * la salida las aulas quedan vacías y a oscuras, hasta que alguien las prende.
 */

const PLATE = Color3.FromHexString('#f3f3ef');
const ROCKER = Color3.FromHexString('#e4e4de');
/** Altura del interruptor sobre el piso. */
const SWITCH_Y = 1.22;

export interface RoomLights {
  sw: SwitchDef;
  on: boolean;
  fixtures: Fixture[];
  lamps: number[];
  plate: number;
  rocker: number;
  /** Centro del interruptor en el mundo (candidato para interactuar y sonido). */
  center: WorldPoint;
  yaw: number;
  px: number;
  pz: number;
  fx: number;
  fz: number;
}

export class Lights {
  private readonly lampSet: ThinSet;
  private readonly switchSet: ThinSet;
  private readonly lampMat: StandardMaterial;
  private readonly switchMat: PBRMetallicRoughnessMaterial;
  private readonly rooms = new Map<string, RoomLights>();

  constructor(
    scene: Scene,
    frame: SchoolFrame,
    fixtures: ReadonlyMap<string, Fixture[]>,
    /**
     * Avisa cada aula que cambia de estado: el entorno baja la luz de su
     * mapa (sin esto, apagar sólo escondía los tubos y el aula seguía igual
     * de clara).
     */
    private readonly onChange?: (roomId: string, on: boolean) => void,
  ) {
    // Mismo emisivo que las luminarias de la escuela (`m.light`): supera el
    // umbral del bloom en escritorio y queda blanco cálido en el visor.
    this.lampMat = new StandardMaterial('game-lamps', scene);
    this.lampMat.diffuseColor = Color3.Black();
    this.lampMat.specularColor = Color3.Black();
    this.lampMat.emissiveColor = Color3.FromHexString('#f5f8ff').scale(0.95 * GLOW_GAIN);
    this.lampMat.disableLighting = true;
    const lampMesh = CreateBox('game-lamps', { size: 1 }, scene);
    lampMesh.material = this.lampMat;
    this.lampSet = new ThinSet(lampMesh, 128);

    this.switchMat = new PBRMetallicRoughnessMaterial('game-switches', scene);
    calibratePbr(this.switchMat);
    (this.switchMat as unknown as { _environmentIntensity: number })._environmentIntensity = INTERIOR_ENV * 1.4;
    this.switchMat.baseColor = new Color3(1, 1, 1);
    this.switchMat.metallic = 0;
    this.switchMat.roughness = 0.4;
    // Placas blancas: un gris parejo de emisivo no les cambia el tono (en las
    // hojas de color sí lo lavaba). Algo más alto que antes porque ahora
    // reciben sombra y no el sol a través de muros y techos.
    this.switchMat.emissiveColor = new Color3(0.16, 0.16, 0.16);
    const switchMesh = CreateBox('game-switches', { size: 1 }, scene);
    switchMesh.material = this.switchMat;
    // Sólo las mallas de la ciudad reciben sombra desde enableShadows, y
    // éstas se crean después: sin esto la placa junto a la puerta salía
    // iluminada por el sol de la mañana a través del muro, beige como el
    // muro. El material compila después de enableShadows: entran los defines.
    switchMesh.receiveShadows = true;
    this.switchSet = new ThinSet(switchMesh, 64);

    for (const sw of SWITCHES) {
      const fx = fixtures.get(sw.roomId);
      if (!fx || fx.length === 0) continue;
      const [nu, nv] = sw.facing;
      // La placa mira al aula: su +X local corre a lo largo del muro.
      const du = -nv;
      const dv = nu;
      const P = toWorld(frame, sw.at[0], sw.at[1]);
      const F = toWorld(frame, sw.at[0] + nu, sw.at[1] + nv);
      const y = LEVEL_Y[sw.level] + SWITCH_Y;
      const r: RoomLights = {
        sw,
        on: true,
        fixtures: fx,
        lamps: fx.map(() => this.lampSet.add(Color3.White())),
        plate: this.switchSet.add(PLATE),
        rocker: this.switchSet.add(ROCKER),
        center: { x: P.x, y, z: P.z },
        yaw: Math.atan2(-dv, -du),
        px: P.x,
        pz: P.z,
        fx: F.x - P.x,
        fz: F.z - P.z,
      };
      this.rooms.set(sw.roomId, r);
      this.pose(r);
    }
    this.lampSet.flush();
    this.switchSet.flush();
  }

  /** Interruptores, para la lista de cosas con las que se puede interactuar. */
  get all(): readonly RoomLights[] {
    return [...this.rooms.values()];
  }

  isOn(roomId: string): boolean {
    return this.rooms.get(roomId)?.on ?? false;
  }

  label(roomId: string): string {
    return this.rooms.get(roomId)?.sw.label ?? 'Aula';
  }

  /** Prende o apaga un aula. Devuelve el nuevo estado. */
  toggle(roomId: string): boolean {
    const r = this.rooms.get(roomId);
    if (!r) return false;
    r.on = !r.on;
    this.pose(r);
    this.flush();
    this.onChange?.(roomId, r.on);
    return r.on;
  }

  setPhase(phase: SchoolPhase): void {
    const on = phase === 'clase' || phase === 'entrada';
    for (const r of this.rooms.values()) {
      if (r.on === on) continue;
      r.on = on;
      this.pose(r);
      this.onChange?.(r.sw.roomId, on);
    }
    this.flush();
  }

  private flush(): void {
    this.lampSet.flush();
    this.switchSet.flush();
  }

  private pose(r: RoomLights): void {
    r.fixtures.forEach((f, k) => {
      if (r.on) this.lampSet.set(r.lamps[k], f.x, f.y, f.z, 0, f.sx, f.sy, f.sz);
      else this.lampSet.hide(r.lamps[k]);
    });
    // Placa apoyada en el muro y la tecla un poco más afuera, inclinada
    // arriba (prendida) o abajo (apagada).
    const { px, pz, fx, fz, yaw } = r;
    const y = r.center.y;
    this.switchSet.set(r.plate, px + fx * 0.006, y, pz + fz * 0.006, yaw, 0.085, 0.125, 0.012);
    this.switchSet.set(r.rocker, px + fx * 0.016, y, pz + fz * 0.016, yaw, 0.032, 0.055, 0.012, r.on ? -0.28 : 0.28);
  }

  dispose(): void {
    this.lampSet.dispose();
    this.switchSet.dispose();
    this.lampMat.dispose();
    this.switchMat.dispose();
  }
}
