import { inLot } from '../SchoolLayout';

/**
 * Recorte de gente que la escuela tapa, sin motor (lo usa `Population` y se
 * prueba en `tests/peopleSim.test.ts`).
 *
 * La escuela está cerrada en todo su perímetro por edificios de una a tres
 * plantas y medianeras: con los ojos a la altura de una persona, alguien que
 * camina del otro lado del predio no se ve. Desde el portón se dibujaban
 * 12–16 caminantes de la calle del fondo y de la lateral del gimnasio, a
 * 40–80 m detrás del edificio (~10k triángulos en el visor).
 */

/**
 * "Adentro de verdad": a más de 3 m detrás de la fachada (la franja de 2 m
 * hasta la línea municipal y el atrio del portón son del predio pero están
 * delante del frente del hall).
 */
export const SCHOOL_DEEP = 3;
/**
 * Al este del muro oeste del aula 1 (con margen): entre ese muro y la
 * diagonal de Miguel Cané queda el ochavo, un triángulo abierto que también es
 * del predio.
 */
const WEST_SOLID = 1;
/** Paso del muestreo del segmento (m). Dos muestras seguidas adentro: ≥ 1,5 m de edificio. */
const STEP = 1.5;

/**
 * ¿La escuela tapa el punto (u, v), fuera del predio, visto desde (cu, cv)?
 * Sí si el segmento entre los dos recorre al menos 1,5 m bien adentro del
 * predio. Sólo vale con la cámara fuera del edificio y a la altura de una
 * persona (lo decide quien llama): desde un patio, la línea a la calle
 * también pasa por el predio sin que haya un muro en el medio.
 */
export function hiddenBySchool(cu: number, cv: number, u: number, v: number): boolean {
  // El segmento nunca llega a 3 m detrás de la fachada: nada que lo tape.
  if (cv > -SCHOOL_DEEP && v > -SCHOOL_DEEP) return false;
  const du = u - cu;
  const dv = v - cv;
  const n = Math.ceil(Math.hypot(du, dv) / STEP);
  let run = 0;
  for (let k = 1; k < n; k++) {
    const pu = cu + (du * k) / n;
    const pv = cv + (dv * k) / n;
    if (pv < -SCHOOL_DEEP && pu > WEST_SOLID && inLot(pu, pv)) {
      if (++run >= 2) return true;
    } else {
      run = 0;
    }
  }
  return false;
}
