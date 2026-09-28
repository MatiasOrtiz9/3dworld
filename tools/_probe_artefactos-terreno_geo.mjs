// Sonda temporal de auditoria (artefactos-terreno). Solo lectura: mide geometria
// a partir de las matrices de thin instances. Se borra al terminar la auditoria.
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5174/?seed=42&quality=high';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=800,450'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), { timeout: 240000, polling: 300 });
  await new Promise((r) => setTimeout(r, 800));

  const res = await page.evaluate(() => {
    const scene = window.__scene;
    const plan = window.__plan();
    const V3 = window.__BABYLON_Vector3;
    const pitch = plan.blockSize + plan.streetWidth;
    const half = (Math.sqrt(plan.blocks.length) - 1) / 2;
    const grid = new Map(plan.blocks.map((b) => [`${b.gx},${b.gz}`, b]));
    const blockAt = (x, z) => {
      const gx = Math.round(x / pitch + half), gz = Math.round(z / pitch + half);
      const b = grid.get(`${gx},${gz}`);
      if (!b) return null;
      return Math.abs(x - b.cx) <= b.width / 2 && Math.abs(z - b.cz) <= b.depth / 2 ? b : null;
    };
    const { slope, offset, halfWidth: hw } = plan.canal;
    const dCanal = (x, z) => Math.abs(slope * x - z + offset) / Math.hypot(slope, 1);

    const byName = (pred) => scene.meshes.filter((m) => pred(m.name));
    const inst = (m) => {
      const out = [];
      const data = m._thinInstanceDataStorage?.matrixData;
      const n = m.thinInstanceCount;
      if (!data) return out;
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        const ax = [data[o], data[o + 1], data[o + 2]];
        const ay = [data[o + 4], data[o + 5], data[o + 6]];
        const az = [data[o + 8], data[o + 9], data[o + 10]];
        const len = (v) => Math.hypot(v[0], v[1], v[2]);
        out.push({ x: data[o + 12], y: data[o + 13], z: data[o + 14], sx: len(ax), sy: len(ay), sz: len(az), ax, ay, az });
      }
      return out;
    };
    const all = (pred) => byName(pred).flatMap(inst);
    const r2 = (v) => Math.round(v * 100) / 100;

    const report = { plan: { seed: plan.seed, extent: plan.extent, canal: plan.canal, kinds: {} } };
    for (const b of plan.blocks) report.plan.kinds[b.kind] = (report.plan.kinds[b.kind] ?? 0) + 1;
    report.plan.blocks = plan.blocks.map((b) => `${b.kind[0]}${b.gx}${b.gz}@${Math.round(b.cx)},${Math.round(b.cz)}h${Math.round(b.height)}`).join(' ');

    // --- mallas: nombres y conteos
    report.meshNames = scene.meshes.filter((m) => m.thinInstanceCount > 0).map((m) => `${m.name}#${m.thinInstanceCount}`).length;

    // --- troncos de arbol
    const trunks = all((n) => /^cylinder\|s:#(8A5A30|B97F45):0\.9:0:timber$/.test(n));
    report.trunks = trunks.length;
    // arboles en calzada
    let inLane = 0, inTramLane = 0, pitOverKerb = 0;
    for (const t of trunks) {
      for (const s of plan.streets) {
        const lane = s.width * 0.42;
        const d = s.axis === 'x' ? Math.abs(t.z - s.at) : Math.abs(t.x - s.at);
        const along = s.axis === 'x' ? Math.abs(t.x) : Math.abs(t.z);
        if (along > plan.extent + 20) continue;
        if (d < lane / 2) { inLane++; if (s.tram) inTramLane++; break; }
        if (d < lane / 2 + 0.32 + 0.95) { pitOverKerb++; break; }
      }
    }
    report.treesInCarriageway = inLane;
    report.treesInTramLane = inTramLane;
    report.treesPitOverKerb = pitOverKerb;
    // distancia del tronco al eje de via en avenidas
    // arboles en edificios / agua
    const solid = (x, z) => {
      const b = blockAt(x, z);
      if (!b) return null;
      switch (b.kind) {
        case 'tower': return Math.abs(x - b.cx) < 16 && Math.abs(z - b.cz) < 16 ? b : null;
        case 'residential': { const inner = b.width / 2 - 13; return Math.abs(x - b.cx) < inner && Math.abs(z - b.cz) < inner ? null : b; }
        case 'civic': case 'market': return Math.abs(x - b.cx) < b.width * 0.41 && Math.abs(z - b.cz) < b.depth * 0.41 ? b : null;
        default: return null;
      }
    };
    const inSolid = {};
    let inWater = 0, inWaterBlocks = 0;
    for (const t of trunks) {
      const b = solid(t.x, t.z);
      if (b) inSolid[b.kind] = (inSolid[b.kind] ?? 0) + 1;
      if (dCanal(t.x, t.z) < hw) inWater++;
      const bb = blockAt(t.x, t.z);
      if (bb?.kind === 'water') inWaterBlocks++;
    }
    report.trunksInsideSolidByKind = inSolid;
    report.trunksInsideCanalBand = inWater;
    report.trunksInWaterBlocks = inWaterBlocks;

    // --- farolas
    const lampPoles = all((n) => n === 'cylinder|s:#C9CDD2:0.4:0.25:metal').filter((p) => Math.abs(p.sy - 5.2) < 0.01);
    let lampOnTrunk = 0, lampInLane = 0;
    for (const l of lampPoles) {
      if (trunks.some((t) => Math.hypot(t.x - l.x, t.z - l.z) < 0.3)) lampOnTrunk++;
      for (const s of plan.streets) {
        const lane = s.width * 0.42;
        const d = s.axis === 'x' ? Math.abs(l.z - s.at) : Math.abs(l.x - s.at);
        const along = s.axis === 'x' ? Math.abs(l.x) : Math.abs(l.z);
        if (along <= plan.extent + 20 && d < lane / 2) { lampInLane++; break; }
      }
    }
    report.lampPoles = lampPoles.length;
    report.lampPolesCoincidentWithTrunk = lampOnTrunk;
    report.lampPolesInCarriageway = lampInLane;

    // --- bancos (asiento 1.9x0.12x0.52, patas 0.14x0.44x0.46)
    const benchParts = all((n) => n === 'box|s:#D8A86A:0.85:0:timber');
    const seats = benchParts.filter((p) => Math.abs(p.sx - 1.9) < 0.01 && Math.abs(p.sy - 0.12) < 0.01);
    const legs = benchParts.filter((p) => Math.abs(p.sx - 0.14) < 0.01 && Math.abs(p.sy - 0.44) < 0.01);
    let badBench = 0, benchOnTrunk = 0, maxLegOut = 0;
    const badBenchSamples = [];
    for (const s of seats) {
      const ax = [s.ax[0] / s.sx, s.ax[2] / s.sx];
      const mine = legs.filter((l) => Math.hypot(l.x - s.x, l.z - s.z) < 0.8);
      let bad = false;
      for (const l of mine) {
        const dx = l.x - s.x, dz = l.z - s.z;
        const perp = Math.abs(ax[0] * dz - ax[1] * dx);
        maxLegOut = Math.max(maxLegOut, perp);
        if (perp > 0.26) bad = true;
      }
      if (bad) { badBench++; if (badBenchSamples.length < 6) badBenchSamples.push([r2(s.x), r2(s.z)]); }
      if (trunks.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < 1.0)) benchOnTrunk++;
    }
    report.benches = seats.length;
    report.benchesLegsOutsideSeat = badBench;
    report.benchMaxLegPerpOffset = r2(maxLegOut);
    report.benchSamples = badBenchSamples;
    report.benchesOnTrunk = benchOnTrunk;

    // --- canal: muros y franjas verdes
    const walls = all((n) => n === 'box|s:#D9CFBD:0.85:0:concrete').filter((p) => p.sx > 300);
    const grassStrips = all((n) => n.startsWith('box|gr:')).filter((p) => p.sx > 300);
    report.canalWalls = walls.map((w) => ({ perpDist: r2(dCanal(w.x, w.z)), expected: r2(hw + 0.6), y: r2(w.y) }));
    report.canalGrass = grassStrips.map((w) => ({ perpDist: r2(dCanal(w.x, w.z)), expected: r2(hw + 3.4) }));
    const water = all((n) => n === 'box|water');
    report.waterBoxes = water.map((w) => ({ x: r2(w.x), z: r2(w.z), top: r2(w.y + w.sy / 2), len: r2(w.sx) }));
    const bed = all((n) => n.startsWith('box|s:#1D4F5C'));
    report.canalBed = bed.map((w) => ({ top: r2(w.y + w.sy / 2), bottom: r2(w.y - w.sy / 2) }));
    const ground = all((n) => n === 'box|s:#CFC6B4:0.9:0:pavementXL');
    report.ground = ground.map((g) => ({ top: r2(g.y + g.sy / 2), size: r2(g.sx) }));

    // --- puentes
    const decks = all((n) => n === 'box|s:#B97F45:0.82:0:timber');
    report.bridges = decks.map((d) => {
      const isX = d.sx > d.sz;
      const span = Math.max(d.sx, d.sz);
      const need = isX ? 2 * hw * Math.hypot(1, slope) / Math.abs(slope) : 2 * hw * Math.hypot(1, slope);
      return { x: r2(d.x), z: r2(d.z), axis: isX ? 'x' : 'z', span: r2(span), crossingNeeded: r2(need), deckTop: r2(d.y + d.sy / 2) };
    });
    // arco del puente: caja 0.22 a y=2.1 sobre el eje
    const bridgeBars = all((n) => n === 'box|s:#C9CDD2:0.35:0.25:metal').filter((p) => Math.abs(p.y - 2.1) < 0.05);
    report.bridgeArchBars = bridgeBars.map((b) => ({ x: r2(b.x), z: r2(b.z), yBottom: r2(b.y - 0.11), tiltDeg: r2((Math.asin(Math.min(1, Math.abs((b.sx > b.sz ? b.ax[1] / b.sx : b.az[1] / b.sz)))) * 180) / Math.PI) }));

    // --- vegetacion de ribera: arbustos/arboles fuera de la banda del canal pero sobre la recta espejada
    const mirrored = (x, z) => Math.abs(-slope * x - z + offset) / Math.hypot(slope, 1);
    let nearMirror = 0, nearTrueBank = 0;
    for (const t of trunks) {
      const dm = mirrored(t.x, t.z), dt = dCanal(t.x, t.z);
      if (dm > hw + 2 && dm < hw + 5.5) nearMirror++;
      if (dt > hw + 2 && dt < hw + 5.5) nearTrueBank++;
    }
    report.trunksAtMirroredBank = nearMirror;
    report.trunksAtTrueBank = nearTrueBank;

    // --- mercado: vigas por encima de la cubierta
    const marketBlocks = plan.blocks.filter((b) => b.kind === 'market');
    const archPieces = all((n) => n === 'box|s:#D8A86A:0.84:0:timber');
    report.market = marketBlocks.map((b) => {
      const mine = archPieces.filter((p) => Math.abs(p.x - b.cx) < 21 && Math.abs(p.z - b.cz) < 21);
      const roofTop = b.height + 0.66;
      const floating = mine.filter((p) => p.y - p.sy / 2 > roofTop);
      const minBottom = Math.min(...mine.map((p) => p.y - p.sy / 2));
      return { at: [Math.round(b.cx), Math.round(b.cz)], pillarTop: r2(b.height), roofBottom: r2(b.height + 0.54), archPieces: mine.length, floatingAboveRoof: floating.length, lowestBeamBottom: r2(minBottom) };
    });

    // --- torres: enredaderas separadas de la fachada
    const towers = plan.blocks.filter((b) => b.kind === 'tower');
    const vines = all((n) => n.startsWith('box|f:')).filter((p) => Math.abs(p.sx - 0.8) < 0.01 && Math.abs(p.sz - 0.8) < 0.01 && p.sy > 2.3);
    const tGlass = all((n) => n === 'box|g:#28423C:0.9');
    report.towerVines = towers.map((b) => {
      const mine = vines.filter((v) => Math.abs(v.x - b.cx) < 21 && Math.abs(v.z - b.cz) < 21);
      let maxGap = 0, floating = 0;
      for (const v of mine) {
        const g = tGlass.filter((q) => Math.abs(q.x - b.cx) < 0.5 && Math.abs(q.z - b.cz) < 0.5 && Math.abs(q.y - v.y) < 2);
        if (!g.length) continue;
        const w = Math.max(...g.map((q) => Math.max(q.sx, q.sz))) - 0.08;
        const gap = Math.abs(v.x - b.cx) - 0.4 - w / 2;
        if (gap > 0.05) floating++;
        maxGap = Math.max(maxGap, gap);
      }
      return { at: [Math.round(b.cx), Math.round(b.cz)], h: Math.round(b.height), vines: mine.length, detached: floating, maxGapM: r2(maxGap) };
    });

    // --- huerta solar: turbinas que cruzan filas de paneles
    const energyBlocks = plan.blocks.filter((b) => b.kind === 'energy');
    const masts = all((n) => n === 'cylinder|s:#F2F0EA:0.35:0.25:metal');
    const panels = all((n) => n === 'box|s:#2F4270:0.34:0.16:solar');
    report.energy = energyBlocks.map((b) => {
      const ms = masts.filter((m) => Math.abs(m.x - b.cx) < 21 && Math.abs(m.z - b.cz) < 21 && m.y < 12);
      const rows = panels.filter((p) => Math.abs(p.x - b.cx) < 1 && Math.abs(p.z - b.cz) < 21 && Math.abs(p.y - 1.9) < 0.01);
      let hits = 0;
      for (const m of ms) {
        const r = m.sy * 0.28 + 0.31;
        if (rows.some((p) => Math.abs(m.z - p.z) < 1.41 + r && Math.abs(m.x - p.x) < p.sx / 2 + r)) hits++;
      }
      return { at: [Math.round(b.cx), Math.round(b.cz)], turbines: ms.length, turbinesCrossingPanels: hits, rows: rows.length };
    });
    // suelo de la huerta con material de follaje (viento)
    const energyGround = all((n) => n === 'box|f:#8FAB6D');
    report.energyGroundFoliage = energyGround.map((g) => ({ sx: r2(g.sx), windShiftMaxM: r2(0.16 * g.sx) }));

    // --- techos: tanques y antenas que atraviesan la pergola solar
    const tanks = all((n) => n === 'cylinder|s:#C9CDD2:0.5:0.25:metal');
    const roofPanels = panels.filter((p) => p.y > 5);
    let tankHits = 0, antennaHits = 0, tankCount = 0, antCount = 0;
    for (const t of tanks) {
      const isAnt = t.sx < 0.1;
      if (isAnt) antCount++; else tankCount++;
      const top = t.y + t.sy / 2, bot = t.y - t.sy / 2;
      const hit = roofPanels.some((p) => {
        const halfD = p.sz / 2;
        if (Math.abs(t.x - p.x) > p.sx / 2 + t.sx / 2) return false;
        if (Math.abs(t.z - p.z) > halfD + t.sz / 2) return false;
        const low = p.y - halfD * Math.sin(0.42) - 0.05;
        return top > low && bot < p.y + halfD * Math.sin(0.42);
      });
      if (hit) { if (isAnt) antennaHits++; else tankHits++; }
    }
    report.roofTanks = { tanks: tankCount, tanksThroughSolar: tankHits, antennas: antCount, antennasThroughSolar: antennaHits };

    // --- civic: arboles dentro de la huella
    const civics = plan.blocks.filter((b) => b.kind === 'civic');
    report.civicTreesInside = civics.map((b) => ({ at: [Math.round(b.cx), Math.round(b.cz)], inside: trunks.filter((t) => Math.abs(t.x - b.cx) < b.width * 0.41 && Math.abs(t.z - b.cz) < b.depth * 0.41).length }));

    // --- civic: ultimo piso sin techo (pergola apoyada en el aire)
    // --- estanques: troncos dentro
    const ponds = all((n) => n === 'cylinder|water');
    let trunksInPonds = 0;
    for (const p of ponds) {
      const rx = p.sx / 2, rz = p.sz / 2;
      trunksInPonds += trunks.filter((t) => ((t.x - p.x) / rx) ** 2 + ((t.z - p.z) / rz) ** 2 < 1).length;
    }
    report.ponds = ponds.map((p) => ({ top: r2(p.y + p.sy / 2), diam: r2(p.sx) }));
    report.trunksInPonds = trunksInPonds;

    // --- instancias fuera del terreno o fuera de la ciudad
    const groundHalf = plan.extent + 100;
    let outsideGround = 0, beyondCity = 0;
    const beyondByMesh = {};
    for (const m of scene.meshes) {
      if (!(m.thinInstanceCount > 0) || m.name === 'skyBox') continue;
      for (const p of inst(m)) {
        const ext = Math.max(Math.abs(p.x), Math.abs(p.z));
        if (ext > groundHalf) outsideGround++;
        if (ext > plan.extent + 25 && p.sx < 300 && p.sz < 300) { beyondCity++; beyondByMesh[m.name] = (beyondByMesh[m.name] ?? 0) + 1; }
      }
    }
    report.instancesOutsideGround = outsideGround;
    report.instancesBeyondCity = beyondCity;
    report.beyondByMesh = beyondByMesh;

    // --- mallas habilitadas sin instancias
    report.enabledNoInstances = scene.meshes.filter((m) => m.isEnabled() && m.hasThinInstances && m.thinInstanceCount === 0).map((m) => m.name);

    // --- peatones: torsos en manzanas de agua
    const torsos = scene.meshes.filter((m) => /^torso\d$/.test(m.name)).flatMap(inst);
    let inWaterBlock = 0, inCanal = 0, sunkDry = 0;
    for (const t of torsos) {
      const b = blockAt(t.x, t.z);
      if (b?.kind === 'water') { inWaterBlock++; if (dCanal(t.x, t.z) < hw) inCanal++; else sunkDry++; }
    }
    report.walkers = { total: torsos.length, inWaterBlocks: inWaterBlock, insideCanalBand: inCanal, onDryCornerOfWaterBlock: sunkDry };

    // --- manzanas con edificio que invaden la banda del canal
    const intruding = [];
    for (const b of plan.blocks) {
      if (!['residential', 'tower', 'civic', 'market'].includes(b.kind)) continue;
      let minD = Infinity;
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) minD = Math.min(minD, dCanal(b.cx + sx * 21, b.cz + sz * 21));
      if (minD < hw) intruding.push({ kind: b.kind, at: [Math.round(b.cx), Math.round(b.cz)], cornerDistToAxis: r2(minD) });
    }
    report.builtBlocksCornerInCanal = intruding;
    // parques en la banda
    const parks = plan.blocks.filter((b) => b.kind === 'park');
    report.parkTrunksInCanal = parks.map((b) => ({ at: [Math.round(b.cx), Math.round(b.cz)], n: trunks.filter((t) => Math.abs(t.x - b.cx) < 21 && Math.abs(t.z - b.cz) < 21 && dCanal(t.x, t.z) < hw).length })).filter((q) => q.n > 0);

    // coplanaridad de azoteas: cornisa (0.34) y canto (0.28) con el mismo tope
    const cornices = all((n) => n === 'box|s:#F7F2E8:0.72:0:concrete').filter((p) => Math.abs(p.sy - 0.34) < 0.001);
    report.roofsWithCoplanarTop = cornices.length;
    const cam = scene.activeCamera;
    report.camera = { minZ: cam.minZ, maxZ: cam.maxZ, pos: [r2(cam.position.x), r2(cam.position.y), r2(cam.position.z)] };
    report.meshes = scene.meshes.length;
    return report;
  });
  console.log(JSON.stringify(res, null, 1));
} finally {
  await browser.close();
}
