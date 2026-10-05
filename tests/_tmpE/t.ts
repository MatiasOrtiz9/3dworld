import { ROOMS } from '../../src/world/SchoolLayout';
import { SchoolVisibility } from '../../src/world/SchoolVisibility';
const vis = new SchoolVisibility();
let t0 = performance.now();
vis.nodeAt(0, 0, 0);
console.log('grid ms', Math.round(performance.now() - t0));
t0 = performance.now();
const times: [number, string][] = [];
for (let k = 0; k < ROOMS.length; k++) { if (!ROOMS[k].roofed) continue; const t = performance.now(); vis.compute(k); times.push([performance.now() - t, ROOMS[k].id]); }
console.log('rays ms', Math.round(performance.now() - t0));
times.sort((a, b) => b[0] - a[0]); console.log(times.slice(0, 8).map(([t, id]) => id + ':' + t.toFixed(0)).join(' '));
