import { describe, it, expect } from 'vitest';
import { ZONES } from '../src/audio/mix';
import { acousticsAt, isMetalStair, stairAt, zoneForRoom } from '../src/audio/schoolAcoustics';
import {
  LEVEL_Y,
  ROOMS,
  SCHOOL,
  STAIRS,
  roomAt,
  roomLevel,
  type Room,
} from '../src/world/SchoolLayout';

/** Un punto adentro del ambiente (promedio de vértices, verificado con roomAt). */
function inside(r: Room): { u: number; v: number } | null {
  const u = r.poly.reduce((s, p) => s + p[0], 0) / r.poly.length;
  const v = r.poly.reduce((s, p) => s + p[1], 0) / r.poly.length;
  return roomAt(u, v, roomLevel(r))?.id === r.id ? { u, v } : null;
}

const room = (id: string, name: string, roofed = true, caption?: string) => ({
  id,
  name,
  roofed,
  caption,
});

describe('zona sonora de cada ambiente', () => {
  it('reglas', () => {
    expect(zoneForRoom(null, false)).toBe('street');
    expect(zoneForRoom(null, true)).toBe('patio');
    expect(zoneForRoom(room('patioOeste', 'Patio aire libre', false), true)).toBe('patio');
    expect(zoneForRoom(room('gimnasio', 'Gimnasio SUM'), true)).toBe('gym');
    expect(zoneForRoom(room('buffet', 'Buffet'), true)).toBe('cantina');
    expect(zoneForRoom(room('salaRosa', 'Sala Rosa'), true)).toBe('kindergarten');
    expect(zoneForRoom(room('jardinHall1', 'Hall'), true)).toBe('kindergarten');
    expect(zoneForRoom(room('jardinEscalera', 'Escalera'), true)).toBe('stair');
    expect(zoneForRoom(room('escalera', 'Escalera'), true)).toBe('stair');
    expect(zoneForRoom(room('salaNorte', 'Sanitarios', true, 'Toilette alumnos'), true)).toBe(
      'quiet',
    );
    expect(
      zoneForRoom(room('pasilloL1', 'Pasillo', true, 'Toilette alumnos · lockers'), true),
    ).toBe('corridor');
    expect(zoneForRoom(room('adm', 'ADM'), true)).toBe('quiet');
    expect(zoneForRoom(room('biblioteca', 'Biblioteca'), true)).toBe('quiet');
    expect(zoneForRoom(room('aula3', 'Aula'), true)).toBe('classroom');
    expect(zoneForRoom(room('tecnologia', 'Tecnología'), true)).toBe('classroom');
    expect(zoneForRoom(room('hall', 'Hall de acceso'), true)).toBe('corridor');
    expect(zoneForRoom(room('algoNuevo', 'Depósito'), true)).toBe('corridor');
  });

  it('todos los ambientes del plano tienen una zona válida', () => {
    for (const r of ROOMS) expect(ZONES).toContain(zoneForRoom(r, true));
  });

  it('en el plano real: aulas, gimnasio, comedor y jardín', () => {
    const counts = new Map<string, number>();
    for (const r of ROOMS) {
      const p = inside(r);
      if (!p) continue;
      const a = acousticsAt(p.u, p.v, LEVEL_Y[roomLevel(r)]);
      if (a.roomId !== r.id) continue; // el punto cae sobre una escalera
      counts.set(a.zone, (counts.get(a.zone) ?? 0) + 1);
      if (r.id === 'gimnasio') expect(a).toMatchObject({ zone: 'gym', surface: 'concrete' });
      if (r.id === 'buffet') expect(a).toMatchObject({ zone: 'cantina', surface: 'tile' });
    }
    expect(counts.get('classroom') ?? 0).toBeGreaterThan(5);
    expect(counts.get('corridor') ?? 0).toBeGreaterThan(3);
    expect(counts.get('kindergarten') ?? 0).toBeGreaterThan(2);
  });
});

describe('escaleras y pisos', () => {
  it('sobre un tramo: zona escalera; la de chapa suena a metal', () => {
    const metal = STAIRS.filter(isMetalStair);
    const tile = STAIRS.filter((s) => !isMetalStair(s));
    expect(metal.length).toBeGreaterThan(0);
    expect(tile.length).toBeGreaterThan(0);
    for (const s of STAIRS) {
      const u = (s.u0 + s.u1) / 2;
      const v = (s.v0 + s.v1) / 2;
      const y = SCHOOL.floorY + (s.y0 + s.y1) / 2;
      expect(stairAt(u, v, y)).not.toBeNull();
      const a = acousticsAt(u, v, y);
      expect(a.zone).toBe('stair');
      expect(a.surface).toBe(isMetalStair(s) ? 'metal' : 'tile');
    }
  });

  it('la escalera exterior con luz por debajo es de chapa', () => {
    expect(STAIRS.filter((s) => s.hollow).every(isMetalStair)).toBe(true);
  });

  it('lejos de la escuela: calle y cemento', () => {
    expect(acousticsAt(-40, 30, 0)).toMatchObject({
      zone: 'street',
      surface: 'concrete',
      roomId: null,
    });
  });
});
