import { describe, expect, it } from 'vitest';
import {
  approachVelocity,
  followFloor,
  headingMove,
  newTurnState,
  shapeStick,
  slideMove,
  smoothTurnRate,
  snapTurnStep,
  sprintStep,
  type SprintState,
  yawWorld,
  type WalkIndex,
} from '../src/vr/XRLocomotion';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * Lo puro de la caminata en el visor: la forma del stick, la colisión por
 * ejes, el piso, el arranque y frenado, correr y los dos giros. Lo que no se
 * puede probar sin un Quest (la pose, el espacio de referencia) queda en
 * `tools/test-vr.mjs`.
 */

/** Pared en x = 1 (sólida de x ≥ 1), piso plano: la habitación más simple. */
const wall: WalkIndex = {
  isSolid: (x) => x >= 1,
  groundHeight: () => 0,
};

describe('stick de caminar', () => {
  it('zona muerta: casi en el centro no se mueve', () => {
    expect(shapeStick(0.1, 0.05)).toEqual({ x: 0, y: 0 });
  });

  it('sin curva es lineal y arranca en 0 al salir de la zona muerta', () => {
    const s = shapeStick(0, -0.16);
    expect(Math.hypot(s.x, s.y)).toBeLessThan(0.02);
    expect(shapeStick(0, -1).y).toBeCloseTo(-1, 5);
    // Compatibilidad: con dos argumentos, como antes.
    expect(shapeStick(0, -0.575).y).toBeCloseTo(-0.5, 5);
  });

  it('con curva da control fino a poca inclinación y llega igual a fondo', () => {
    const lin = shapeStick(0, -0.575);
    const cur = shapeStick(0, -0.575, 0.15, 1.5);
    expect(Math.abs(cur.y)).toBeLessThan(Math.abs(lin.y));
    expect(Math.abs(cur.y)).toBeCloseTo(Math.pow(0.5, 1.5), 5);
    expect(shapeStick(0.8, -0.8, 0.15, 1.5).x).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('conserva la dirección', () => {
    const s = shapeStick(0.6, -0.6, 0.15, 1.5);
    expect(s.x).toBeCloseTo(-s.y, 6);
  });
});

describe('rumbo', () => {
  it('stick adelante empuja hacia el rumbo; a la derecha, a su derecha', () => {
    // Rumbo +z (mano izquierda): la derecha es +x.
    const fwd = headingMove(0, -1, 0, 1, 2);
    expect(fwd.x).toBeCloseTo(0, 6);
    expect(fwd.z).toBeCloseTo(2, 6);
    const right = headingMove(1, 0, 0, 1, 2);
    expect(right.x).toBeCloseTo(2, 6);
    expect(right.z).toBeCloseTo(0, 6);
    // Rumbo +x: la derecha es −z.
    const r2 = headingMove(1, 0, 1, 0, 1);
    expect(r2.z).toBeCloseTo(-1, 6);
  });
});

describe('colisión', () => {
  it('se desliza a lo largo de la pared en vez de trabarse', () => {
    const r = slideMove(wall, 0.5, 0, 0.5, 0.5, 0, 0.28);
    expect(r.hitX).toBe(true);
    expect(r.hitZ).toBe(false);
    expect(r.x).toBeLessThan(1 - 0.28 + 1e-9);
    expect(r.z).toBeCloseTo(0.5, 6);
  });

  it('lejos de la pared se mueve entero', () => {
    const r = slideMove(wall, -2, 0, 0.3, -0.2, 0);
    expect(r.hitX || r.hitZ).toBe(false);
    expect(r.x).toBeCloseTo(-1.7, 9);
    expect(r.z).toBeCloseTo(-0.2, 9);
  });

  it('un salto grande en un cuadro no atraviesa la pared', () => {
    const r = slideMove(wall, 0, 0, 3, 0, 0, 0.28);
    expect(r.hitX).toBe(true);
    expect(r.x).toBeLessThan(1);
  });
});

describe('piso', () => {
  it('un escalón se sube en ~0,1 s, no de golpe', () => {
    let feet = 0;
    feet = followFloor(feet, 0.17, 1 / 72);
    expect(feet).toBeGreaterThan(0);
    expect(feet).toBeLessThan(0.17);
    for (let i = 0; i < 30; i++) feet = followFloor(feet, 0.17, 1 / 72);
    expect(feet).toBe(0.17);
  });

  it('una caída grande no se suaviza', () => {
    expect(followFloor(3.42, 0, 1 / 72)).toBe(0);
  });
});

describe('arranque y frenado', () => {
  const run = (v: { x: number; z: number }, tx: number, tz: number, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 72) approachVelocity(v, tx, tz, 1 / 72);
  };

  it('arranca en ~0,15 s', () => {
    const v = { x: 0, z: 0 };
    run(v, 0, 2, 0.17);
    expect(v.z).toBeGreaterThan(1.8);
    const early = { x: 0, z: 0 };
    run(early, 0, 2, 0.04);
    expect(early.z).toBeLessThan(1.5);
  });

  it('frena en ~0,1 s y queda clavado en 0, sin derrape', () => {
    const v = { x: 0, z: 2 };
    run(v, 0, 0, 0.11);
    expect(v.z).toBeLessThan(0.2);
    run(v, 0, 0, 0.2);
    expect(v).toEqual({ x: 0, z: 0 });
  });

  it('dar media vuelta frena primero (no patina sobre la velocidad vieja)', () => {
    const turn = { x: 0, z: 2 };
    approachVelocity(turn, 0, -2, 1 / 72);
    const accel = { x: 0, z: 0 };
    approachVelocity(accel, 0, 2, 1 / 72);
    // El cambio de un cuadro invirtiendo es proporcionalmente mayor que el de arrancar.
    expect((2 - turn.z) / 4).toBeGreaterThan(accel.z / 2);
  });
});

describe('correr', () => {
  const dt = 1 / 72;
  const fresh = (): SprintState => ({ on: false, idle: 0 });

  it('el clic alterna', () => {
    const s = fresh();
    expect(sprintStep(s, true, true, dt)).toBe(true);
    expect(sprintStep(s, false, true, dt)).toBe(true);
    expect(sprintStep(s, true, true, dt)).toBe(false);
  });

  it('se apaga solo con el stick en el centro ~0,5 s', () => {
    const s = fresh();
    sprintStep(s, true, true, dt);
    for (let t = 0; t < 0.4; t += dt) sprintStep(s, false, false, dt);
    expect(s.on).toBe(true);
    // Volver a empujar antes del medio segundo lo mantiene.
    sprintStep(s, false, true, dt);
    for (let t = 0; t < 0.4; t += dt) sprintStep(s, false, false, dt);
    expect(s.on).toBe(true);
    for (let t = 0; t < 0.2; t += dt) sprintStep(s, false, false, dt);
    expect(s.on).toBe(false);
  });

  it('prendido con el stick quieto da margen para empezar a empujar', () => {
    const s = fresh();
    sprintStep(s, true, false, dt);
    for (let t = 0; t < 0.7; t += dt) sprintStep(s, false, false, dt);
    expect(s.on).toBe(true);
    expect(sprintStep(s, false, true, dt)).toBe(true);
  });
});

describe('giro por pasos', () => {
  const dt = 1 / 72;

  it('un paso por empujón; se rearma al volver al centro', () => {
    const s = newTurnState();
    expect(snapTurnStep(s, 0.8, 0, dt)).toBe(1);
    expect(snapTurnStep(s, 0.8, 0, dt)).toBe(0);
    expect(snapTurnStep(s, 0.5, 0, dt)).toBe(0);
    expect(snapTurnStep(s, 0.8, 0, dt)).toBe(0);
    snapTurnStep(s, 0, 0, dt);
    expect(snapTurnStep(s, -0.8, 0, dt)).toBe(-1);
  });

  it('a fondo se repite cada medio segundo', () => {
    const s = newTurnState();
    let turns = 0;
    for (let t = 0; t < 1.05; t += dt) turns += Math.abs(snapTurnStep(s, 1, 0, dt));
    expect(turns).toBe(3);
  });

  it('sin llegar a fondo no se repite', () => {
    const s = newTurnState();
    let turns = 0;
    for (let t = 0; t < 2; t += dt) turns += Math.abs(snapTurnStep(s, 0.8, 0, dt));
    expect(turns).toBe(1);
  });

  it('adelante o atrás no gira (teletransporte)', () => {
    const s = newTurnState();
    expect(snapTurnStep(s, 0.75, -0.65, dt)).toBe(0);
  });

  it('al soltar el arco del teletransporte, la diagonal de vuelta no gira', () => {
    const s = newTurnState();
    snapTurnStep(s, 0, -1, dt); // apuntando el teletransporte
    expect(snapTurnStep(s, 0.8, -0.4, dt)).toBe(0); // vuelve en diagonal
    expect(snapTurnStep(s, 0.8, 0, dt)).toBe(0);
    snapTurnStep(s, 0, 0, dt); // centro
    expect(snapTurnStep(s, 0.8, 0, dt)).toBe(1);
  });
});

describe('giro continuo', () => {
  it('zona muerta, curva y tope', () => {
    const s = newTurnState();
    expect(smoothTurnRate(s, 0.15, 0, 135)).toBe(0);
    expect(smoothTurnRate(s, 1, 0, 135)).toBeCloseTo(135, 6);
    expect(smoothTurnRate(s, -1, 0, 90)).toBeCloseTo(-90, 6);
    const half = smoothTurnRate(s, 0.6, 0, 180);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(180 * 0.5);
  });

  it('con el stick adelante no gira, y queda bloqueado hasta el centro', () => {
    const s = newTurnState();
    expect(smoothTurnRate(s, 0.3, -0.9, 135)).toBe(0);
    expect(smoothTurnRate(s, 0.9, -0.2, 135)).toBe(0);
    smoothTurnRate(s, 0, 0, 135);
    expect(smoothTurnRate(s, 0.9, -0.2, 135)).toBeGreaterThan(0);
  });
});

describe('giro del visor', () => {
  it('gira sobre el eje vertical del mundo aunque se mire al piso', () => {
    // Cabeza 40° hacia abajo: con el giro en el eje de la cabeza, el "arriba"
    // del mundo quedaba inclinado ~28° después de un paso de 45°.
    const q = Quaternion.FromEulerAngles(0.7, 0.3, 0);
    const before = new Matrix();
    Matrix.ComposeToRef(Vector3.One(), q, Vector3.Zero(), before);
    yawWorld(q, Math.PI / 4);
    const after = new Matrix();
    Matrix.ComposeToRef(Vector3.One(), q, Vector3.Zero(), after);
    const offset = before.clone().invert().multiply(after);
    const up = Vector3.TransformNormal(new Vector3(0, 1, 0), offset);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(1, 6);
    expect(up.z).toBeCloseTo(0, 6);
    // El cabeceo se conserva y el rumbo avanza 45°.
    const e = q.toEulerAngles();
    expect(e.x).toBeCloseTo(0.7, 6);
    expect(e.y).toBeCloseTo(0.3 + Math.PI / 4, 6);
  });
});
