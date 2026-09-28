import { Rng } from '../utils/rng';

export type BlockKind =
  | 'plaza' // plaza central, abierta
  | 'park' // parque / bosque urbano
  | 'water' // canal
  | 'residential' // vivienda con terrazas verdes
  | 'civic' // equipamiento bajo y ancho
  | 'tower' // torre alta con jardines verticales
  | 'market' // mercado cubierto, estructura de madera
  | 'energy'; // huerta solar / turbinas

export interface Block {
  /** Índice en la grilla. */
  gx: number;
  gz: number;
  /** Centro en metros (mundo). */
  cx: number;
  cz: number;
  /** Tamaño edificable de la manzana en metros. */
  width: number;
  depth: number;
  kind: BlockKind;
  /** Distancia Chebyshev al centro, en manzanas. */
  ring: number;
  /** Altura sugerida, en metros. */
  height: number;
  /** Hito curado dentro de un plano que por lo demás puede regenerarse. */
  landmark?: 'school';
}

export interface Street {
  /** Eje: 'x' corre este-oeste, 'z' corre norte-sur. */
  axis: 'x' | 'z';
  /** Coordenada fija del eje de la calle. */
  at: number;
  /** Ancho total. */
  width: number;
  /** Si lleva vía de tranvía. */
  tram: boolean;
}

export interface CityPlan {
  seed: number;
  blocks: Block[];
  streets: Street[];
  /** Semiancho del terreno, en metros. */
  extent: number;
  blockSize: number;
  streetWidth: number;
  /** Centro de la plaza, punto de aparición del jugador. */
  plazaCenter: { x: number; z: number };
  /** Eje del canal, como recta z = slope * x + offset. */
  canal: { slope: number; offset: number; halfWidth: number };
}

export interface LayoutOptions {
  /** Manzanas por lado (impar para que haya un centro exacto). */
  gridSize?: number;
  blockSize?: number;
  streetWidth?: number;
}

/**
 * Genera el plano de la ciudad.
 *
 * Criterios de diseño urbano (deliberados, no arbitrarios):
 *
 *  - **Centro abierto, no torre.** Las ciudades que se sienten habitables tienen
 *    vacío en el medio: una plaza. Las torres van en un anillo intermedio.
 *  - **Altura en anillos.** Bajo en el centro (escala humana en la plaza), alto
 *    en el anillo 2-3, y vuelve a bajar en el borde. Esto da un perfil legible
 *    desde cualquier punto y evita el "muro de torres".
 *  - **Un canal diagonal.** Rompe la rigidez de la grilla, da reflejos —que en
 *    VR leen muy bien— y crea bordes de parque naturales.
 *  - **El verde no es decoración.** Parques distribuidos, no relegados al borde.
 */
export function generateCityPlan(seed: number, options: LayoutOptions = {}): CityPlan {
  const rng = new Rng(seed);
  const gridSize = options.gridSize ?? 9;
  const blockSize = options.blockSize ?? 42;
  const streetWidth = options.streetWidth ?? 15;

  const pitch = blockSize + streetWidth;
  const half = (gridSize - 1) / 2;
  const extent = (gridSize * pitch) / 2;

  // El canal cruza la ciudad en diagonal.
  //
  // El desplazamiento mínimo ya no existe para proteger la plaza —de eso se
  // encarga la precedencia de `ring === 0` en `classifyBlock`— sino por una
  // razón puramente GEOMÉTRICA: si el eje del canal pasa demasiado cerca del
  // centro, la lámina de agua se dibuja encima de la plaza y el resultado se ve
  // roto. El mínimo es la distancia a la que el borde del canal deja de tocar
  // la manzana central.
  //
  // Una versión anterior usaba 1,5 manzanas de mínimo, que era mucho más de lo
  // necesario, y como efecto no buscado empujaba el canal al borde: cruzaba
  // 4,6 manzanas en vez de las 9-12 que corresponden a una diagonal sobre una
  // grilla de 9x9. El canal había perdido la mitad de su presencia.
  // Semiancho de 17-21 m (canal de 34-42 m).
  //
  // No es un número estético: se midió. Una manzana pasa a ser agua cuando su
  // CENTRO cae dentro del semiancho, y los centros de una grilla de paso 57 m
  // se agrupan a distancias de 1, 2, 4, 11, 13, 14, 16, 16, 19… y después
  // saltan a 28. Con 14 m el canal tocaba 6 manzanas; con 20 llega a 9, que es
  // el máximo útil — ensancharlo más no suma ninguna manzana hasta pasados los
  // 28 m, y ahí ya sería un río, no un canal urbano.
  const canalHalfWidth = rng.range(17, 21);
  const slope = rng.range(0.55, 0.85) * (rng.chance(0.5) ? 1 : -1);
  // Distancia perpendicular necesaria = media manzana + medio ancho de canal.
  // El factor sqrt(slope^2+1) convierte esa distancia al desplazamiento en Z.
  const clearance = (blockSize / 2 + canalHalfWidth + 1) * Math.hypot(slope, 1);
  const canal = {
    slope,
    // Rango corto a propósito: cuanto más lejos del centro corre el eje, menos
    // manzanas cruza. Con pitch * 1.3 el canal se iba al borde otra vez.
    offset: (rng.chance(0.5) ? 1 : -1) * rng.range(clearance, clearance + pitch * 0.75),
    halfWidth: canalHalfWidth,
  };

  const distanceToCanal = (x: number, z: number) => {
    // Distancia punto-recta para z = slope*x + offset  →  slope*x - z + offset = 0
    return Math.abs(canal.slope * x - z + canal.offset) / Math.hypot(canal.slope, 1);
  };

  const blocks: Block[] = [];

  for (let gx = 0; gx < gridSize; gx++) {
    for (let gz = 0; gz < gridSize; gz++) {
      const cx = (gx - half) * pitch;
      const cz = (gz - half) * pitch;
      const ring = Math.max(Math.abs(gx - half), Math.abs(gz - half));

      const kind = classifyBlock(rng, ring, distanceToCanal(cx, cz), canal.halfWidth);

      blocks.push({
        gx,
        gz,
        cx,
        cz,
        width: blockSize,
        depth: blockSize,
        kind,
        ring,
        height: suggestHeight(rng, kind, ring),
      });
    }
  }

  // El recorrido tiene un destino estable. Elegimos un equipamiento del primer
  // anillo, preferentemente al norte de la plaza, para que el campus no cambie
  // de lugar cada vez que se regenera la ciudad. Nunca se toma una manzana de
  // agua: la escuela debe conservar entrada, patio y caminos transitables.
  const school =
    blocks.find((b) => b.gx === half && b.gz === half + 1 && b.kind !== 'water') ??
    blocks.find((b) => b.ring === 1 && b.kind !== 'water');
  if (school) school.landmark = 'school';

  // Calles: una por cada línea de la grilla, más los bordes.
  const streets: Street[] = [];
  for (let i = 0; i <= gridSize; i++) {
    const at = (i - half - 0.5) * pitch;
    // Avenidas con tranvía cada tres calles, empezando por la central.
    const isAvenue = (i - Math.round(half + 0.5)) % 3 === 0;
    streets.push({ axis: 'x', at, width: isAvenue ? streetWidth * 1.35 : streetWidth, tram: isAvenue });
    streets.push({ axis: 'z', at, width: isAvenue ? streetWidth * 1.35 : streetWidth, tram: isAvenue });
  }

  return {
    seed,
    blocks,
    streets,
    extent,
    blockSize,
    streetWidth,
    plazaCenter: { x: 0, z: 0 },
    canal,
  };
}

/**
 * Decide el tipo de una manzana.
 *
 * Exportada para poder testear directamente la defensa de la plaza. Hay DOS
 * salvaguardas contra que el canal se coma la manzana central: el
 * desplazamiento mínimo del canal (en `generateCityPlan`) y la precedencia de
 * `ring === 0` acá. Probar sólo el plano completo verifica la primera y deja la
 * segunda sin cobertura — una prueba de mutación lo demostró: se puede quitar
 * esta precedencia y la suite sigue en verde.
 */
export function classifyBlock(
  rng: Rng,
  ring: number,
  canalDistance: number,
  canalHalfWidth: number,
): BlockKind {
  // La plaza es INTOCABLE y va primero. Cuando esta comprobación estaba
  // debajo de la del canal, había semillas en las que el agua se comía la
  // manzana central: la ciudad aparecía sin plaza, sin Árbol Solar y con el
  // jugador naciendo en medio de una calle vacía.
  if (ring === 0) return 'plaza';

  // El canal manda sobre el resto: si la manzana lo cruza, es agua.
  if (canalDistance < canalHalfWidth) return 'water';
  // Ribera: parque.
  if (canalDistance < canalHalfWidth * 1.9) return 'park';

  // Reparto por anillos.
  //
  // La auditoría encontró que `market` aparecía 2,4 veces por ciudad (2,9 %) y
  // es el tipo con más geometría específica del proyecto: pórticos de madera,
  // arcos, cubierta mixta de vidrio y paneles, puestos. Se construía mucho para
  // algo que casi no se veía. `civic` estaba igual de relegado.
  //
  // La corrección es sacarlos del anillo 1 —donde competían entre sí por ocho
  // manzanas— y repartirlos también por los anillos 2 y 3. De paso baja el peso
  // de `park`, que ocupaba más de un quinto de la ciudad siendo el tipo con
  // menos geometría interesante.

  if (ring === 1) {
    // Alrededor de la plaza: equipamiento público y mercado, escala baja.
    return rng.chance(0.45) ? 'market' : 'civic';
  }

  if (ring === 2) {
    if (rng.chance(0.34)) return 'tower';
    if (rng.chance(0.21)) return 'civic';
    if (rng.chance(0.15)) return 'market';
    if (rng.chance(0.12)) return 'park';
    return 'residential';
  }

  if (ring === 3) {
    if (rng.chance(0.2)) return 'tower';
    if (rng.chance(0.18)) return 'civic';
    if (rng.chance(0.13)) return 'market';
    if (rng.chance(0.16)) return 'park';
    return 'residential';
  }

  // Borde: producción de energía y verde, escala baja. Deja ver el horizonte.
  if (rng.chance(0.28)) return 'energy';
  if (rng.chance(0.24)) return 'park';
  if (rng.chance(0.1)) return 'market';
  return 'residential';
}

function suggestHeight(rng: Rng, kind: BlockKind, ring: number): number {
  switch (kind) {
    case 'plaza':
    case 'water':
    case 'park':
      return 0;
    case 'energy':
      return rng.range(4, 7);
    case 'civic':
      return rng.range(9, 16);
    case 'market':
      return rng.range(11, 14);
    case 'residential':
      // Baja hacia el borde: perfil urbano legible.
      return rng.range(14, 30) * (ring >= 4 ? 0.62 : 1);
    case 'tower':
      return rng.range(46, 88);
  }
}
