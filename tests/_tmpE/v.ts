import { ROOMS } from '../../src/world/SchoolLayout';
import { SchoolVisibility } from '../../src/world/SchoolVisibility';
const vis = new SchoolVisibility();
let t0 = performance.now();
vis.step(1e9);
console.log('all ms', Math.round(performance.now() - t0));
const id = (s: string) => ROOMS.findIndex((r) => r.id === s);
for (const s of ['aulaS1', 'vDamas', 'hall', 'aula1', 'pasilloL1', 'gimnasio', 'salaAmarilla', 'tecnologia']) {
  const v = vis.viewOf(id(s))!;
  console.log(s, 'out', v.outside, v.rooms.size, [...v.rooms].map((k) => ROOMS[k].id).join(' '));
}
let tot = 0; for (const r of ROOMS.keys()) { const v = vis.viewOf(r); if (v) tot += v.rooms.size; }
console.log('avg pvs', tot / ROOMS.filter(r=>r.roofed).length);
