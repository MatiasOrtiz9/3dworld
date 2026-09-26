import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { CityPlan } from './CityLayout';
import type { CityIndex } from './CityIndex';
import { Rng } from '../utils/rng';

interface Walker {
  x: number;
  z: number;
  /** Dirección de avance, en radianes. */
  heading: number;
  speed: number;
  /** Altura total de la persona, en metros. */
  height: number;
  /** Índice del color de ropa. */
  tone: number;
  /** Fase del ciclo de paso, para que no caminen todos sincronizados. */
  phase: number;
  /** Segundos que faltan para volver a decidir el rumbo. */
  nextTurn: number;
  isCyclist: boolean;
}

/** Cuántos grupos de color de ropa. Cada uno es un draw call extra. */
const TONES = 5;

const CLOTHING = [
  '#3d4a5c',
  '#7a4636',
  '#46584a',
  '#5c4a63',
  '#8a7b52',
];

/**
 * Gente caminando.
 *
 * Es el hueco que la auditoría marcó como el más grande: la ciudad tenía
 * locales, toldos, bancos, bicicleteros y paradas de tranvía, y ni una sola
 * persona. Una ciudad vacía se lee como maqueta por más detalle arquitectónico
 * que tenga; el movimiento humano es lo que el cerebro usa para aceptar un
 * espacio como habitado.
 *
 * Cada persona son cuatro cajas: torso, cabeza y dos piernas que alternan. A la
 * escala a la que se la ve —desde cinco metros para arriba, en movimiento— eso
 * alcanza, y gastar geometría en una silueta más fina no compra nada.
 *
 * Todo va en *thin instances* con buffer dinámico, agrupado por color de ropa:
 * 200 peatones cuestan 5 grupos x 4 partes = 20 draw calls, no 800.
 */
export class Crowd {
  private readonly walkers: Walker[] = [];
  /** [tono][parte] → malla. Partes: 0 torso, 1 cabeza, 2 pierna izq, 3 pierna der. */
  private readonly meshes: Mesh[][] = [];
  private readonly buffers: Float32Array[][] = [];
  private readonly counts: number[] = [];
  private readonly materials: StandardMaterial[] = [];
  private time = 0;

  constructor(
    private readonly scene: Scene,
    plan: CityPlan,
    private readonly index: CityIndex,
    seed: number,
    count = 200,
  ) {
    const rng = new Rng(seed ^ 0x9a1c);
    this.spawn(rng, plan, count);
    this.build();
  }

  // ------------------------------------------------------------------ inicio

  /**
   * Coloca la gente donde tiene sentido que haya gente.
   *
   * No se reparte de manera uniforme sobre el terreno: se siembra en las calles
   * y con más densidad cerca del centro. Una ciudad real no tiene la misma
   * cantidad de gente en la plaza que en una huerta solar del borde, y esa
   * diferencia es la que hace que el centro se sienta como centro.
   */
  private spawn(rng: Rng, plan: CityPlan, count: number): void {
    const pitch = plan.blockSize + plan.streetWidth;
    const half = (Math.sqrt(plan.blocks.length) - 1) / 2;
    let guard = 0;

    // Manzanas abiertas donde la gente se queda, no sólo pasa: plaza, parques
    // y mercados. Sembrar únicamente sobre ejes de calle dejaba a todo el mundo
    // formado en hileras y la plaza —el lugar más concurrido de cualquier
    // ciudad— completamente vacía.
    const gathering = plan.blocks.filter(
      (b) => b.kind === 'plaza' || b.kind === 'park' || b.kind === 'market',
    );

    while (this.walkers.length < count && guard++ < count * 40) {
      // Un tercio se reparte dentro de espacios de estancia; el resto circula
      // por las veredas.
      if (gathering.length > 0 && rng.chance(0.34)) {
        // La plaza pesa más que un parque cualquiera: es el centro.
        const pool = rng.chance(0.4)
          ? gathering.filter((b) => b.kind === 'plaza')
          : gathering;
        const b = rng.pick(pool.length ? pool : gathering);
        const r = b.width * 0.42;
        const px = b.cx + rng.range(-r, r);
        const pz = b.cz + rng.range(-r, r);
        if (this.index.isSolid(px, pz)) continue;
        const cyclist = b.kind !== 'plaza' && rng.chance(0.08);
        this.walkers.push({
          x: px,
          z: pz,
          heading: rng.range(0, Math.PI * 2),
          speed: cyclist ? rng.range(3.5, 4.6) : rng.range(0.7, 1.35),
          height: rng.range(1.55, 1.9),
          tone: rng.int(0, TONES - 1),
          phase: rng.range(0, Math.PI * 2),
          nextTurn: rng.range(1.5, 6),
          isCyclist: cyclist,
        });
        continue;
      }

      // Sesgo hacia el centro: elevar un valor aleatorio a una potencia mayor
      // que 1 concentra las muestras cerca de cero.
      const radial = Math.pow(rng.next(), 1.7) * half;
      const angle = rng.range(0, Math.PI * 2);
      const gx = Math.cos(angle) * radial;
      const gz = Math.sin(angle) * radial;

      // Llevarlo al eje de calle más cercano: la gente camina por la vereda,
      // no en diagonal a través de las manzanas.
      const onZAxis = rng.chance(0.5);
      const snapped = (Math.round(gx - 0.5) + 0.5) * pitch;
      const free = gz * pitch;

      const x = onZAxis ? snapped : free;
      const z = onZAxis ? free : snapped;

      // Desplazamiento lateral hacia la vereda, sin pisar la calzada central.
      const side = rng.chance(0.5) ? 1 : -1;
      const offset = side * rng.range(plan.streetWidth * 0.32, plan.streetWidth * 0.52);

      const px = onZAxis ? x + offset : x + rng.range(-2, 2);
      const pz = onZAxis ? z + rng.range(-2, 2) : z + offset;

      if (Math.abs(px) > plan.extent || Math.abs(pz) > plan.extent) continue;
      if (this.index.isSolid(px, pz)) continue;

      const isCyclist = rng.chance(0.12);
      this.walkers.push({
        x: px,
        z: pz,
        heading: onZAxis ? (rng.chance(0.5) ? 0 : Math.PI) : rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2,
        // Paso humano real: 1,2-1,6 m/s. El ciclista, unos 4,5.
        speed: isCyclist ? rng.range(3.8, 5.2) : rng.range(1.1, 1.65),
        height: rng.range(1.55, 1.9),
        tone: rng.int(0, TONES - 1),
        phase: rng.range(0, Math.PI * 2),
        nextTurn: rng.range(2, 9),
        isCyclist,
      });
    }
  }

  // ----------------------------------------------------------------- mallas

  private build(): void {
    for (let t = 0; t < TONES; t++) {
      const mat = new StandardMaterial(`walker${t}`, this.scene);
      const base = Color3.FromHexString(CLOTHING[t]);
      mat.diffuseColor = base;
      mat.specularColor = Color3.Black();
      // Algo de luz propia: a esta escala las figuras quedan casi negras en
      // sombra y se pierden contra el solado.
      mat.emissiveColor = base.scale(0.45);
      this.materials.push(mat);

      const skin = new StandardMaterial(`walkerHead${t}`, this.scene);
      skin.diffuseColor = Color3.FromHexString('#c9a184');
      skin.specularColor = Color3.Black();
      skin.emissiveColor = Color3.FromHexString('#c9a184').scale(0.45);
      this.materials.push(skin);

      const group = this.walkers.filter((w) => w.tone === t);
      this.counts.push(group.length);

      // Torso · cabeza · pierna izquierda · pierna derecha.
      const torso = CreateBox(`torso${t}`, { width: 0.42, height: 0.6, depth: 0.25 }, this.scene);
      const head = CreateBox(`head${t}`, { width: 0.2, height: 0.24, depth: 0.2 }, this.scene);
      const legL = CreateBox(`legL${t}`, { width: 0.15, height: 0.82, depth: 0.17 }, this.scene);
      const legR = CreateBox(`legR${t}`, { width: 0.15, height: 0.82, depth: 0.17 }, this.scene);

      torso.material = mat;
      head.material = skin;
      legL.material = mat;
      legR.material = mat;

      const parts = [torso, head, legL, legR];
      const bufs: Float32Array[] = [];
      for (const p of parts) {
        p.isPickable = false;
        const buf = new Float32Array(Math.max(1, group.length) * 16);
        p.thinInstanceSetBuffer('matrix', buf, 16, false);
        bufs.push(buf);
        if (group.length === 0) p.setEnabled(false);
      }
      this.meshes.push(parts);
      this.buffers.push(bufs);
    }

    this.scene.onBeforeRenderObservable.add(this.update);
  }

  // ----------------------------------------------------------------- update

  private update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1);
    this.time += dt;

    const cursors = new Array(TONES).fill(0);

    for (const w of this.walkers) {
      // --- decisión de rumbo ---
      w.nextTurn -= dt;
      if (w.nextTurn <= 0) {
        // Giro de un cuarto: quien camina por una vereda dobla en esquina, no
        // en cualquier ángulo. Esto los mantiene alineados con la trama.
        w.heading += (Math.round(Math.random() * 2) - 1) * (Math.PI / 2);
        w.nextTurn = 3 + Math.random() * 8;
      }

      // --- avance con comprobación de choque ---
      const step = w.speed * dt;
      const nx = w.x + Math.sin(w.heading) * step;
      const nz = w.z + Math.cos(w.heading) * step;

      if (this.index.isSolid(nx, nz)) {
        // Choca contra un edificio: media vuelta. Es lo mínimo que hace falta
        // para que nadie atraviese una pared, que es lo único que un
        // espectador nota como error.
        w.heading += Math.PI;
        w.nextTurn = 2 + Math.random() * 4;
      } else {
        w.x = nx;
        w.z = nz;
      }

      // --- animación ---
      const i = cursors[w.tone]++;
      const bufs = this.buffers[w.tone];
      const groundY = this.index.groundHeight(w.x, w.z);
      const s = w.height / 1.72; // escala respecto de la figura base

      if (w.isCyclist) {
        // El ciclista va sentado y no mueve las piernas: se lo lee por la
        // altura, la inclinación del torso y la velocidad.
        write(bufs[0], i, w.x, groundY + 1.05 * s, w.z, w.heading, 0.35, s);
        write(bufs[1], i, w.x, groundY + 1.45 * s, w.z, w.heading, 0, s);
        this.writeLeg(bufs[2], i, w, groundY, s * 0.85, 0.95, +1);
        this.writeLeg(bufs[3], i, w, groundY, s * 0.85, 0.95, -1);
      } else {
        // Ciclo de paso: las piernas oscilan en contrafase y el torso sube y
        // baja apenas. Ese balanceo vertical mínimo es lo que diferencia
        // "caminar" de "deslizarse".
        const cycle = this.time * w.speed * 3.4 + w.phase;
        // 0,3 rad ≈ 17° de apertura máxima. Con 0,45 la zancada quedaba
        // exagerada y las figuras caminaban como con compás.
        const swing = Math.sin(cycle) * 0.3;
        const bob = Math.abs(Math.cos(cycle)) * 0.035;

        write(bufs[0], i, w.x, groundY + (1.16 + bob) * s, w.z, w.heading, 0, s);
        write(bufs[1], i, w.x, groundY + (1.6 + bob) * s, w.z, w.heading, 0, s);
        // Piernas: pivotan en la CADERA, no en su punto medio.
        //
        // Antes se rotaba cada pierna alrededor de su centro, y como las dos
        // giran en contrafase el resultado era una X — la parte de arriba de
        // una se iba para un lado mientras la de abajo se iba para el otro.
        // Una pierna real pivota arriba. Además van separadas lateralmente:
        // superpuestas en el mismo punto no se leen como dos piernas.
        this.writeLeg(bufs[2], i, w, groundY, s, swing, +1);
        this.writeLeg(bufs[3], i, w, groundY, s, swing, -1);
      }
    }

    for (let t = 0; t < TONES; t++) {
      if (this.counts[t] === 0) continue;
      for (const m of this.meshes[t]) m.thinInstanceBufferUpdated('matrix');
    }
  };

  /**
   * Escribe una pierna que pivota en la cadera.
   *
   * @param side  +1 pierna izquierda, -1 derecha. Separa lateralmente y desfasa
   *              el balanceo media zancada.
   */
  private writeLeg(
    buf: Float32Array,
    i: number,
    w: Walker,
    groundY: number,
    s: number,
    swing: number,
    side: 1 | -1,
  ): void {
    const legLen = 0.82 * s;
    const hipY = groundY + 0.86 * s;
    const angle = swing * side;

    // Separación lateral, perpendicular al rumbo.
    const lateral = 0.11 * s * side;
    const hipX = w.x + Math.cos(w.heading) * lateral;
    const hipZ = w.z - Math.sin(w.heading) * lateral;

    // El centro de la pierna cuelga de la cadera y se desplaza con el ángulo.
    const cx = hipX + Math.sin(w.heading) * Math.sin(angle) * (legLen / 2);
    const cz = hipZ + Math.cos(w.heading) * Math.sin(angle) * (legLen / 2);
    const cy = hipY - Math.cos(angle) * (legLen / 2);

    write(buf, i, cx, cy, cz, w.heading, angle, s);
  }

  get population(): number {
    return this.walkers.length;
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
    for (const parts of this.meshes) for (const m of parts) m.dispose();
    for (const m of this.materials) m.dispose();
    this.meshes.length = 0;
    this.materials.length = 0;
  }
}

const _scale = new Vector3(1, 1, 1);
const _pos = new Vector3();
const _rot = new Quaternion();
const _mat = Matrix.Identity();

/** Escribe una matriz en el buffer de instancias. */
function write(
  buf: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  heading: number,
  pitch: number,
  scale: number,
): void {
  _scale.set(scale, scale, scale);
  _pos.set(x, y, z);
  // `pitch` inclina en el plano de avance; `heading` orienta la figura.
  Quaternion.FromEulerAnglesToRef(pitch, heading, 0, _rot);
  Matrix.ComposeToRef(_scale, _rot, _pos, _mat);
  _mat.copyToArray(buf, i * 16);
}
