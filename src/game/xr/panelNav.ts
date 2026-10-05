/**
 * Navegación de los botones del panel del visor: puro (sin motor ni DOM),
 * para poder probarlo.
 *
 * Los botones son rectángulos en píxeles del lienzo del panel. El stick mueve
 * el resaltado por la GEOMETRÍA real (la fila o columna más cercana en esa
 * dirección), no por el orden de la lista: así sirve igual para una columna,
 * dos columnas o la grilla irregular de una actividad (con la última fila
 * más corta, o botones deshabilitados que no tienen zona).
 */

export interface NavZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Índice de opción (el que recibe quien elige). Único entre las zonas. */
  index: number;
}

/** La zona con ese índice de opción, si existe. */
export function zoneByIndex(zones: readonly NavZone[], index: number): NavZone | undefined {
  return index < 0 ? undefined : zones.find((z) => z.index === index);
}

/** Índice de opción bajo el punto (px, py), o −1. */
export function zoneAt(zones: readonly NavZone[], px: number, py: number): number {
  for (const z of zones) if (px >= z.x0 && px <= z.x1 && py >= z.y0 && py <= z.y1) return z.index;
  return -1;
}

/**
 * Como `zoneAt`, pero el botón resaltado (`current`) se agranda `pad`
 * píxeles por lado: con el temblor natural de la mano, un láser que apunta
 * al borde no hace titilar el resaltado entre dos botones ni lo pierde en
 * la separación. Un botón tocado de lleno gana siempre.
 */
export function zoneAtWithHysteresis(zones: readonly NavZone[], px: number, py: number, current: number, pad: number): number {
  // Un botón tocado de verdad manda siempre (la franja nunca le roba el láser a un vecino).
  const exact = zoneAt(zones, px, py);
  if (exact >= 0) return exact;
  const cur = zoneByIndex(zones, current);
  if (cur && px >= cur.x0 - pad && px <= cur.x1 + pad && py >= cur.y0 - pad && py <= cur.y1 + pad) return cur.index;
  return -1;
}

/** Distancia (px) del punto al rectángulo de la zona; 0 adentro. */
export function distToZone(z: NavZone, px: number, py: number): number {
  const dx = Math.max(z.x0 - px, 0, px - z.x1);
  const dy = Math.max(z.y0 - py, 0, py - z.y1);
  return Math.hypot(dx, dy);
}

/** La opción más cercana a (px, py), a no más de `max` px; −1 si no hay ninguna. */
export function nearestZone(zones: readonly NavZone[], px: number, py: number, max: number): number {
  let best = -1;
  let bestD = max;
  for (const z of zones) {
    const d = distToZone(z, px, py);
    if (d <= bestD) {
      best = z.index;
      bestD = d;
    }
  }
  return best;
}

/**
 * Lo que apunta el láser sobre el panel, de más a menos seguro: un botón
 * tocado de lleno; el resaltado, agrandado `pad` px (histéresis contra el
 * temblor); y si no, el botón más cercano a no más de `snap` px (imán: la
 * separación entre botones y sus bordes también eligen, así el clic nunca
 * "cae en el hueco").
 */
export function aimZone(zones: readonly NavZone[], px: number, py: number, current: number, pad: number, snap: number): number {
  const z = zoneAtWithHysteresis(zones, px, py, current, pad);
  return z >= 0 ? z : nearestZone(zones, px, py, snap);
}

/** La primera zona en orden de lectura (arriba a abajo, izquierda a derecha), o −1. */
export function firstZone(zones: readonly NavZone[]): number {
  let best: NavZone | undefined;
  for (const z of zones) {
    if (!best) best = z;
    else {
      const sameRow = Math.abs(z.y0 - best.y0) < 4;
      if ((sameRow && z.x0 < best.x0) || (!sameRow && z.y0 < best.y0)) best = z;
    }
  }
  return best ? best.index : -1;
}

/**
 * Mueve el resaltado con el stick: `dx`/`dy` son −1, 0 o 1 (manda el eje de
 * mayor magnitud; +y es hacia abajo, como en el lienzo). Busca la fila (o
 * columna) más cercana en esa dirección y, dentro de ella, el botón más
 * alineado con el actual. Sin nada en esa dirección se queda donde está
 * (sin dar la vuelta: en el visor un salto al otro extremo desorienta).
 * Sin resaltado, empieza por el primero.
 */
export function navigateGrid(zones: readonly NavZone[], current: number, dx: number, dy: number): number {
  const cur = zoneByIndex(zones, current);
  if (!cur) return firstZone(zones);
  if (dx === 0 && dy === 0) return cur.index;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const sign = horizontal ? Math.sign(dx) : Math.sign(dy);
  const cx = (cur.x0 + cur.x1) / 2;
  const cy = (cur.y0 + cur.y1) / 2;
  // Distancia a lo largo del movimiento y desvío perpendicular de cada candidato.
  const cands: Array<{ z: NavZone; along: number; across: number }> = [];
  for (const z of zones) {
    if (z === cur) continue;
    const zx = (z.x0 + z.x1) / 2;
    const zy = (z.y0 + z.y1) / 2;
    const along = (horizontal ? zx - cx : zy - cy) * sign;
    if (along <= 2) continue;
    cands.push({ z, along, across: Math.abs(horizontal ? zy - cy : zx - cx) });
  }
  if (!cands.length) return cur.index;
  // A los costados, primero la misma fila (aunque haya un hueco de un
  // deshabilitado): pasar a otra fila con el stick de costado sorprende.
  if (horizontal) {
    const row = cands.filter((c) => c.z.y0 < cur.y1 && c.z.y1 > cur.y0);
    if (row.length) {
      row.sort((a, b) => a.along - b.along);
      return row[0].z.index;
    }
  }
  // La fila/columna siguiente: los candidatos a la distancia mínima, con
  // tolerancia de media altura (o ancho) del botón actual.
  const tol = (horizontal ? cur.x1 - cur.x0 : cur.y1 - cur.y0) / 2;
  const nearest = Math.min(...cands.map((c) => c.along));
  let best: { z: NavZone; along: number; across: number } | undefined;
  for (const c of cands) {
    if (c.along > nearest + tol) continue;
    if (!best || c.across < best.across - 0.5 || (Math.abs(c.across - best.across) <= 0.5 && c.along < best.along)) best = c;
  }
  return best ? best.z.index : cur.index;
}
