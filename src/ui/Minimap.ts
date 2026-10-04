import { FENCES, ROOMS, STAIRS, U, WALLS, WALKABLE, miguelCaneU, planU, planV, roomLevel, type Level, type Room } from '../world/SchoolLayout';
import { UI } from './draw';

/**
 * Minimapa y brújula: la planta REAL de la escuela (los mismos ambientes y
 * muros con los que se levanta) del piso en el que está el jugador, girando
 * con él (adelante es arriba), con su flecha, el objetivo y la gente de la
 * historia. Fuera del círculo, una marca dorada en el borde indica hacia
 * dónde queda el objetivo; si está en otro piso, lo dice.
 *
 * Cada piso se dibuja una sola vez en un canvas fuera de pantalla: por
 * cuadro sólo se copia, girado y recortado. Es barato aun a 10 Hz.
 */

export interface MapMarker {
  u: number;
  v: number;
  level: Level;
}

export interface MapState {
  u: number;
  v: number;
  level: Level;
  /** Rumbo en el plano: 0 = norte (−v), creciendo hacia el este. */
  heading: number;
  target?: MapMarker | null;
  people?: ReadonlyArray<MapMarker & { color: string }>;
  room?: string;
}

/** Píxeles por metro del plano precalculado. */
const PRE = 7;
/**
 * Marco del lienzo, leído en el plano y pasado a metros reales: la escuela a
 * tamaño real es más grande y el lienzo crece con ella (los píxeles por metro
 * no cambian, así el minimapa se ve a la misma escala que antes).
 */
const U0 = planU(-14);
const V0 = planV(-46);
const U1 = planU(74);
const V1 = planV(14);

function fillFor(r: Room): string {
  if (!r.roofed) return '#29452f';
  const key = `${r.name} ${r.caption ?? ''}`.toLowerCase();
  if (r.id === 'gimnasio') return '#4a3a28';
  if (key.includes('escalera')) return '#3c3d45';
  if (key.includes('pasillo') || key.includes('hall') || key.includes('galería') || key.includes('pasarela') || key.includes('recepción')) return '#2f4842';
  if (key.includes('sanitario') || key.includes('toilette') || key.includes('damas')) return '#263033';
  if (key.includes('aula') || key.includes('sala') || key.includes('maker') || key.includes('bilingual') || key.includes('danzas') || key.includes('espejos')) return '#2a3b4c';
  return '#363250';
}

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly levels: Array<HTMLCanvasElement | null> = [null, null, null];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Planta de un piso, dibujada la primera vez que se pide. */
  private plan(level: Level): HTMLCanvasElement {
    const cached = this.levels[level];
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = Math.ceil((U1 - U0) * PRE);
    c.height = Math.ceil((V1 - V0) * PRE);
    const g = c.getContext('2d')!;
    const at = (u: number, v: number): [number, number] => [(u - U0) * PRE, (v - V0) * PRE];
    if (level === 0) {
      // Calles: Laprida al sur y Miguel Cané en diagonal al oeste.
      g.fillStyle = '#1b2523';
      const [lx0, ly0] = at(U0, planV(2.4));
      g.fillRect(lx0, ly0, c.width, 9 * PRE);
      g.beginPath();
      const p0 = at(miguelCaneU(planV(4)) - 2, planV(4));
      const p1 = at(miguelCaneU(planV(-44)) - 2, planV(-44));
      g.moveTo(p0[0], p0[1]);
      g.lineTo(p1[0], p1[1]);
      g.lineTo(p1[0] - 9 * PRE, p1[1]);
      g.lineTo(p0[0] - 9 * PRE, p0[1]);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(238,246,242,0.28)';
      g.font = `700 ${Math.round(PRE * 1.3)}px ${UI.font}`;
      g.textAlign = 'center';
      const [tx, ty] = at(U.e / 2, planV(7.2));
      g.fillText('LAPRIDA', tx, ty);
    }
    for (const r of ROOMS) {
      if (roomLevel(r) !== level) continue;
      g.fillStyle = fillFor(r);
      g.beginPath();
      r.poly.forEach(([u, v], k) => {
        const [x, y] = at(u, v);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.fill();
    }
    // Escaleras de este nivel: rayado claro.
    g.strokeStyle = 'rgba(238,246,242,0.22)';
    g.lineWidth = 1;
    for (const s of STAIRS) {
      const lv = s.y0 > 6 ? 2 : s.y0 > 3 ? 1 : 0;
      if (lv !== level) continue;
      const [x0, y0] = at(s.u0, s.v0);
      const [x1, y1] = at(s.u1, s.v1);
      const alongU = s.dir === 'u+' || s.dir === 'u-';
      const n = Math.max(4, Math.round((alongU ? x1 - x0 : y1 - y0) / (PRE * 0.3)));
      for (let k = 0; k <= n; k++) {
        g.beginPath();
        if (alongU) {
          const x = x0 + ((x1 - x0) * k) / n;
          g.moveTo(x, y0);
          g.lineTo(x, y1);
        } else {
          const y = y0 + ((y1 - y0) * k) / n;
          g.moveTo(x0, y);
          g.lineTo(x1, y);
        }
        g.stroke();
      }
    }
    // Muros con sus vanos transitables abiertos.
    g.strokeStyle = 'rgba(226,236,232,0.85)';
    g.lineCap = 'round';
    for (const w of WALLS) {
      if (w.level !== level) continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const du = (w.b[0] - w.a[0]) / len;
      const dv = (w.b[1] - w.a[1]) / len;
      g.lineWidth = w.kind === 'int' ? 1.4 : 2.4;
      let t = 0;
      const cuts = w.openings.filter((o) => WALKABLE.has(o.type));
      for (const o of [...cuts, { t0: len, t1: len }]) {
        if (o.t0 > t) {
          const a = at(w.a[0] + du * t, w.a[1] + dv * t);
          const b = at(w.a[0] + du * o.t0, w.a[1] + dv * o.t0);
          g.beginPath();
          g.moveTo(a[0], a[1]);
          g.lineTo(b[0], b[1]);
          g.stroke();
        }
        t = Math.max(t, o.t1);
      }
    }
    if (level === 0) {
      g.strokeStyle = 'rgba(226,236,232,0.35)';
      g.lineWidth = 1;
      for (const [a, b] of FENCES) {
        const pa = at(a[0], a[1]);
        const pb = at(b[0], b[1]);
        g.beginPath();
        g.moveTo(pa[0], pa[1]);
        g.lineTo(pb[0], pb[1]);
        g.stroke();
      }
    }
    this.levels[level] = c;
    return c;
  }

  update(s: MapState): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const R = W / 2;
    // Escala de la vista: el círculo muestra unos 26 m de radio.
    const view = R / 26;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0b1513';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(R, R);
    ctx.rotate(-s.heading);
    const k = view / PRE;
    ctx.scale(k, k);
    ctx.translate(-(s.u - U0) * PRE, -(s.v - V0) * PRE);
    ctx.drawImage(this.plan(s.level), 0, 0);
    // Gente de la historia en este piso.
    for (const p of s.people ?? []) {
      if (p.level !== s.level) continue;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc((p.u - U0) * PRE, (p.v - V0) * PRE, 3.2 / k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Objetivo: adentro del círculo, un rombo; afuera, una marca en el borde.
    const t = s.target;
    if (t) {
      const du = t.u - s.u;
      const dv = t.v - s.v;
      const c = Math.cos(-s.heading);
      const sn = Math.sin(-s.heading);
      let x = (du * c - dv * sn) * view;
      let y = (du * sn + dv * c) * view;
      const d = Math.hypot(x, y);
      const edge = R - 14;
      const outside = d > edge;
      if (outside) {
        x = (x / d) * edge;
        y = (y / d) * edge;
      }
      ctx.save();
      ctx.translate(R + x, R + y);
      ctx.fillStyle = UI.gold;
      ctx.shadowColor = 'rgba(242,193,78,0.8)';
      ctx.shadowBlur = 10;
      if (outside) {
        ctx.rotate(Math.atan2(y, x) + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(8, 5);
        ctx.lineTo(-8, 5);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-7, -7, 14, 14);
      }
      ctx.restore();
      if (t.level !== s.level) {
        ctx.save();
        ctx.fillStyle = UI.ink;
        ctx.strokeStyle = UI.gold;
        ctx.lineWidth = 2;
        const bx = R + x * (outside ? 0.78 : 1);
        const by = R + y * (outside ? 0.78 : 1) - (outside ? 0 : 20);
        ctx.beginPath();
        ctx.arc(bx, by, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = UI.gold;
        ctx.font = `800 13px ${UI.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.level > s.level ? '▲' : '▼', bx, by + 1);
        ctx.restore();
      }
    }

    // Jugador: flecha al centro, siempre hacia arriba.
    ctx.save();
    ctx.translate(R, R);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // Anillo y norte.
    ctx.save();
    ctx.strokeStyle = 'rgba(238,246,242,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.stroke();
    const na = -s.heading - Math.PI / 2;
    const nx = R + Math.cos(na) * (R - 13);
    const ny = R + Math.sin(na) * (R - 13);
    ctx.fillStyle = UI.ink;
    ctx.beginPath();
    ctx.arc(nx, ny, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8a8f';
    ctx.font = `800 13px ${UI.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 1);
    ctx.restore();
  }
}
