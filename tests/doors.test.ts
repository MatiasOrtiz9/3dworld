import { describe, expect, it } from 'vitest';
import { DOORS, doorRect } from '../src/world/SchoolDoors';
import { LOCKS } from '../src/game/story/world';
import { LEVEL_Y, SCHOOL, WALLS, inRect, roomAt } from '../src/world/SchoolLayout';

describe('puertas que se abren', () => {
  it('hay puertas de aulas y oficinas en planta baja y primer piso', () => {
    expect(DOORS.length).toBeGreaterThan(12);
    expect(DOORS.some((d) => d.level === 1)).toBe(true);
  });

  it('ids únicos', () => {
    expect(new Set(DOORS.map((d) => d.id)).size).toBe(DOORS.length);
  });

  it('ninguna coincide con una cerradura de la historia', () => {
    for (const d of DOORS) {
      const r = doorRect(d);
      for (const l of LOCKS) {
        if (l.rect.level !== d.level) continue;
        const cu = (l.a[0] + l.b[0]) / 2;
        const cv = (l.a[1] + l.b[1]) / 2;
        expect(inRect(r, cu, cv), `${d.id} vs ${l.id}`).toBe(false);
      }
    }
  });

  it('la hoja abierta queda dentro de su ambiente', () => {
    for (const d of DOORS) {
      for (const L of d.leaves) {
        // Punta de la hoja abierta, un poco despegada del muro.
        const mid = L.width * 0.5;
        const u = L.hinge[0] + L.dir[0] * 0.05 + d.swing[0] * mid;
        const v = L.hinge[1] + L.dir[1] * 0.05 + d.swing[1] * mid;
        expect(roomAt(u, v, d.level)?.id, d.id).toBe(d.room.id);
      }
    }
  });

  it('las aulas de primaria tienen puerta doble', () => {
    for (const id of ['aula1', 'aula2', 'aula3', 'aula4', 'aula5']) {
      const d = DOORS.find((x) => x.room.id === id);
      expect(d?.leaves.length, id).toBe(2);
    }
  });

  it('las hojas llegan hasta el cabezal del marco (sin ranura arriba)', () => {
    for (const d of DOORS) {
      // El vano de la puerta en su muro: su dintel, sobre la base del muro.
      let top = -1;
      for (const w of WALLS) {
        if (w.level !== d.level) continue;
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        for (const o of w.openings) {
          const a = [w.a[0] + ((w.b[0] - w.a[0]) / len) * o.t0, w.a[1] + ((w.b[1] - w.a[1]) / len) * o.t0];
          if (Math.hypot(a[0] - d.a[0], a[1] - d.a[1]) > 0.01) continue;
          top = w.level * SCHOOL.storey + Math.min(o.ht ?? (o.type === 'double' ? 2.25 : 2.15), w.h - 0.15);
        }
      }
      expect(top, d.id).toBeGreaterThan(0);
      const leafTop = LEVEL_Y[d.level] + d.height;
      // La hoja entra hasta 5 mm en el cabezal (sin ranura, sin caras coplanares).
      expect(top - leafTop, d.id).toBeGreaterThanOrEqual(-0.006);
      expect(top - leafTop, d.id).toBeLessThan(0.02);
    }
  });
});
