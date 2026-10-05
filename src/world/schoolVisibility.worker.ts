import { SchoolVisibility } from './SchoolVisibility';

/**
 * Calcula fuera del hilo principal qué ambientes se ven desde cada ambiente
 * (ver `SchoolVisibility`). Son ~1 s de rayos en una PC y varias veces eso
 * en el visor: en el hilo del juego serían tirones o una carga más larga.
 * Mientras tanto se dibuja todo, como antes; al llegar el resultado, el
 * recorte por ambientes empieza solo.
 */
const vis = new SchoolVisibility();
vis.computeAll();
const data = vis.exportData();
const post = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void };
post.postMessage(data, [
  ...data.labels.map((a) => a.buffer),
  ...data.blocks.map((a) => a.buffer),
  data.views.buffer,
]);
