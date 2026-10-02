import { describe, expect, it } from 'vitest';
import {
  DAY_END,
  DAY_START,
  DEFAULT_HOUR,
  KEYFRAMES,
  PRESETS,
  TIME_ORDER,
  blendPresets,
  castsShadow,
  fogAmount,
  fogDensityFor,
  fogReach,
  formatHour,
  presetAt,
  staticShadowFrame,
  sunDirection,
} from '../src/world/TimeOfDay';
import { TileableNoise } from '../src/world/ProceduralNoise';
import { PAINTED_KINDS, paintSurface } from '../src/world/TexturePainter';

describe('horas del día', () => {
  it('formatea horas decimales sin minutos imposibles', () => {
    expect(formatHour(13.5)).toBe('13:30');
    expect(formatHour(8)).toBe('08:00');
    expect(formatHour(8.999)).toBe('09:00');
  });

  it('los fotogramas clave cubren el día y coinciden con los preajustes', () => {
    expect(KEYFRAMES[0].hour).toBe(DAY_START);
    expect(KEYFRAMES[KEYFRAMES.length - 1].hour).toBe(DAY_END);
    expect(KEYFRAMES.map((k) => k.time)).toEqual(TIME_ORDER);
    for (const k of KEYFRAMES) expect(presetAt(k.hour)).toEqual(PRESETS[k.time]);
  });

  it('la hora por omisión es la llegada a la escuela: sol bajo y cálido del este, apenas al sur', () => {
    const p = presetAt(DEFAULT_HOUR);
    expect(DEFAULT_HOUR).toBeGreaterThanOrEqual(DAY_START);
    expect(DEFAULT_HOUR).toBeLessThan(9);
    const d = sunDirection(p.elevation, p.azimuth);
    // Este = −x, sur = +z: la fachada de Laprida (que mira al sur) recibe luz
    // rasante. Antes se pedía z > 0,2 (este-sudeste, azimut 2,72), pero desde
    // ahí la torre de 66 m del sudeste del barrio dejaba la fachada entera en
    // sombra a la hora de llegada: el sol real de las 8:15 está casi al este.
    expect(d.x).toBeLessThan(-0.85);
    expect(d.z).toBeGreaterThan(0.08);
    expect(d.z).toBeLessThan(0.25);
    expect(d.y).toBeGreaterThan(0.2);
    expect(d.y).toBeLessThan(0.45);
    // Cálido: más rojo que azul.
    expect(p.sunColor[0] - p.sunColor[2]).toBeGreaterThan(0.25);
  });

  it('el sol culmina al norte (−z) y se pone por el oeste', () => {
    const noon = sunDirection(PRESETS.noon.elevation, PRESETS.noon.azimuth);
    expect(noon.z).toBeLessThan(-0.2);
    expect(noon.y).toBeGreaterThan(0.85);
    const dusk = sunDirection(PRESETS.dusk.elevation, PRESETS.dusk.azimuth);
    expect(dusk.x).toBeGreaterThan(0.6);
    expect(dusk.y).toBeLessThan(0.05);
  });

  it('interpola sin saltos: valores intermedios y continuidad entre fotogramas', () => {
    const mid = blendPresets(PRESETS.morning, PRESETS.noon, 0.5);
    expect(mid.elevation).toBeCloseTo((PRESETS.morning.elevation + PRESETS.noon.elevation) / 2);
    expect(mid.zenith[2]).toBeCloseTo((PRESETS.morning.zenith[2] + PRESETS.noon.zenith[2]) / 2);
    // Paso pequeño de hora → cambio pequeño de luz, incluso cruzando un fotograma.
    for (let h = DAY_START; h < DAY_END; h += 0.05) {
      const a = presetAt(h);
      const b = presetAt(h + 0.05);
      expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.08);
      expect(Math.abs(a.azimuth - b.azimuth)).toBeLessThan(0.08);
      expect(Math.abs(a.exposure - b.exposure)).toBeLessThan(0.03);
    }
    // Fuera del rango se fija al extremo.
    expect(presetAt(3)).toEqual(PRESETS.morning);
    expect(presetAt(23)).toEqual(PRESETS.dusk);
  });

  it('el sol no supera la calibración de los StandardMaterial', () => {
    // Follaje, césped y gente están calibrados para un sol de ~2,4
    // (Materials.STANDARD_SUN_COMP): más, y saturan a blanco.
    for (const t of TIME_ORDER) expect(PRESETS[t].sunIntensity).toBeLessThanOrEqual(2.6);
  });
});

describe('niebla atada al tamaño del mundo', () => {
  it('funde el borde del suelo y deja nítida la escuela, en cualquier tamaño de barrio', () => {
    for (const extent of [70, 100, 142.5]) {
      const reach = fogReach(extent);
      // El suelo base termina a extent + 200 m del centro.
      expect(reach).toBeGreaterThan(extent + 200);
      for (const t of TIME_ORDER) {
        const density = fogDensityFor(reach, PRESETS[t].fogThickness);
        expect(fogAmount(reach, density)).toBeGreaterThan(0.94);
        // La fachada vista desde la vereda de enfrente (~25 m), casi limpia.
        expect(fogAmount(25, density)).toBeLessThan(0.05);
      }
    }
  });

  it('un barrio más chico da una niebla más densa', () => {
    expect(fogDensityFor(fogReach(80))).toBeGreaterThan(fogDensityFor(fogReach(140)));
  });
});

describe('sombra estática', () => {
  it('encuadra el foco desde el sol, con margen para el sol rasante', () => {
    const center = { x: -28, y: 0, z: 0 };
    const toSun = sunDirection(0.1, 2.7);
    const f = staticShadowFrame(center, 90, toSun);
    expect(f.size).toBe(180);
    // La cámara está del lado del sol.
    const dx = f.position.x - center.x;
    const dz = f.position.z - center.z;
    expect(dx * toSun.x + dz * toSun.z).toBeGreaterThan(0);
    // El foco queda entre los planos cercano y lejano.
    const dist = Math.hypot(dx, f.position.y - center.y, dz);
    expect(dist).toBeGreaterThan(f.minZ);
    expect(dist + 90).toBeLessThan(f.maxZ + 1e-6);
  });

  it('no proyectan sombra los vidrios ni las losas a ras del suelo', () => {
    expect(castsShadow({ minY: 0, maxY: 3, transparent: true })).toBe(false);
    expect(castsShadow({ minY: -1.02, maxY: -0.02, transparent: false })).toBe(false);
    expect(castsShadow({ minY: 0, maxY: 0.15, transparent: false })).toBe(false);
    expect(castsShadow({ minY: 0, maxY: 12, transparent: false })).toBe(true);
    // Una losa alta (primer piso) sí: hace sombra sobre la planta baja.
    expect(castsShadow({ minY: 3.3, maxY: 3.45, transparent: false })).toBe(true);
  });
});

describe('ruido periódico', () => {
  it('es determinista y repite exactamente con su período, en todas las octavas', () => {
    const a = new TileableNoise(1234, 8);
    const b = new TileableNoise(1234, 8);
    for (const [x, y] of [
      [0.3, 0.7],
      [5.5, 2.25],
      [7.9, 7.9],
    ]) {
      expect(a.noise(x, y)).toBe(b.noise(x, y));
      expect(a.noise(x + 8, y)).toBeCloseTo(a.noise(x, y), 12);
      expect(a.noise(x, y - 8)).toBeCloseTo(a.noise(x, y), 12);
      expect(a.fbm(x + 8, y + 16, 4)).toBeCloseTo(a.fbm(x, y, 4), 12);
      const v = a.fbm(x, y, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new TileableNoise(99, 8).noise(0.3, 0.7)).not.toBe(a.noise(0.3, 0.7));
  });

  it('admite períodos distintos en cada eje', () => {
    const n = new TileableNoise(7, 16);
    expect(n.noise(3.3 + 16, 0.4, 16, 2)).toBeCloseTo(n.noise(3.3, 0.4, 16, 2), 12);
    expect(n.noise(3.3, 0.4 + 2, 16, 2)).toBeCloseTo(n.noise(3.3, 0.4, 16, 2), 12);
  });
});

describe('texturas pintadas', () => {
  // La mitad del tamaño real: las juntas pesan un poco más que a 256 px.
  const size = 128;
  const textures = new Map(PAINTED_KINDS.map((k) => [k, paintSurface(k, size)] as const));
  const lum = (px: Uint8ClampedArray, x: number, y: number) => {
    const i = (y * size + x) * 4;
    return (px[i] + px[i + 1] + px[i + 2]) / 765;
  };

  // Suma de control: comparar 65 000 bytes con toEqual tarda segundos.
  const checksum = (px: Uint8ClampedArray) => {
    let h = 0;
    for (let i = 0; i < px.length; i++) h = (Math.imul(h, 31) + px[i]) >>> 0;
    return h;
  };

  it('son deterministas', () => {
    for (const k of PAINTED_KINDS) expect(checksum(paintSurface(k, size)), k).toBe(checksum(textures.get(k)!));
  });

  it('conservan el brillo medio alto: multiplican el color del material sin apagarlo', () => {
    for (const [kind, px] of textures) {
      let sum = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sum += lum(px, x, y);
      const mean = sum / (size * size);
      // El damero es la excepción (mitad de las baldosas son gris oscuro
      // real) y las maderas son cálidas (el azul baja la luminancia).
      const min = kind === 'checker' ? 0.5 : kind === 'parquet' || kind === 'timber' ? 0.7 : 0.78;
      expect(mean, kind).toBeGreaterThan(min);
      expect(mean, kind).toBeLessThan(0.99);
    }
  });

  it('tienen detalle (no son planas) y son opacas', () => {
    for (const [kind, px] of textures) {
      let lo = 1;
      let hi = 0;
      let opaque = true;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const l = lum(px, x, y);
          lo = Math.min(lo, l);
          hi = Math.max(hi, l);
          opaque &&= px[(y * size + x) * 4 + 3] === 255;
        }
      }
      expect(hi - lo, kind).toBeGreaterThan(0.1);
      expect(opaque, kind).toBe(true);
    }
  });
});

describe('luz natural horneada de la escuela', async () => {
  // Importa Babylon (el plugin vive junto al entorno): se carga una sola vez.
  const { bakeSchoolDaylight, DAYLIGHT_GRID } = await import('../src/world/Environment');
  const bake = bakeSchoolDaylight();
  const cell = (u: number, v: number) =>
    Math.floor((v - DAYLIGHT_GRID.v0) / DAYLIGHT_GRID.cell) * bake.width +
    Math.floor((u - DAYLIGHT_GRID.u0) / DAYLIGHT_GRID.cell);
  const light = (u: number, v: number, level = 0) => bake.light[cell(u, v) * 4 + level] / 128;
  const cover = (u: number, v: number, level = 0) => (bake.cover[cell(u, v) * 4 + level] / 255) * 4;

  it('tiene el tamaño de la grilla y es determinista', () => {
    expect(bake.light.length).toBe(DAYLIGHT_GRID.width * DAYLIGHT_GRID.height * 4);
    expect(bakeSchoolDaylight().light).toEqual(bake.light);
  });

  it('afuera no cambia nada: la vereda y los patios valen 1', () => {
    expect(light(30, 1.4)).toBe(1); // vereda de Laprida, frente a la fachada
    expect(light(22, -16)).toBe(1); // patio oeste, a cielo abierto
    expect(bake.indoor[cell(22, -16)]).toBe(0);
    expect(bake.indoor[cell(22.5, -3.5)] & 1).toBe(1);
  });

  it('un aula sobre Laprida es más clara junto a las ventanas que en el fondo', () => {
    const front = light(22.5, -1.2);
    const back = light(22.5, -6.5);
    expect(front).toBeGreaterThan(back + 0.12);
    // Ni negra ni quemada: es un factor sobre el rebote, no la luz final.
    expect(back).toBeGreaterThan(0.5);
    expect(front).toBeLessThan(1.4);
  });

  it('los rincones son más oscuros que el medio del ambiente', () => {
    // Rincón norte-oeste del aula 4 contra el centro de su fondo.
    expect(light(19.45, -6.95)).toBeLessThan(light(22.5, -6.5) - 0.08);
  });

  it('en un aula sobre Laprida la luz llega del sur (+z), desde las ventanas', () => {
    const k = cell(22.5, -4);
    const x = (bake.dir[k * 4] - 128) / 127;
    const z = (bake.dir[k * 4 + 1] - 128) / 127;
    expect(z).toBeGreaterThan(0.5);
    expect(Math.abs(x)).toBeLessThan(z);
    // Afuera no hay dirección.
    expect(bake.dir[cell(30, 1.4) * 4 + 1]).toBe(128);
  });

  it('bajo los pupitres hay algo que tapa el piso, entre ellos no', () => {
    let under = 0;
    let free = 0;
    for (let u = 19.5; u < 25.5; u += 0.1) {
      for (let v = -6.8; v < -0.4; v += 0.1) {
        const c = cover(u, v);
        if (c > 0.6) under++;
        else if (c < 0.05) free++;
      }
    }
    expect(under).toBeGreaterThan(100);
    expect(free).toBeGreaterThan(under);
  });
});
