import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reglas de los plugins de material (`MaterialPluginBase`) que el
 * compilador de TypeScript no ve y que en el navegador rompen el shader.
 *
 * Con UBO (WebGL2, el caso normal) Babylon descarta el texto `vertex` /
 * `fragment` de `getUniforms()`: arma las declaraciones desde la lista `ubo`.
 * Lo que no sea un uniforme (un `varying`, una función) desaparece y el
 * shader no compila. Pasó con los reflejos del gimnasio (`vGlintFade:
 * undeclared identifier`, el material nunca se dibujó).
 */

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Cuerpo del método `getUniforms` (hasta el próximo método `override`). */
function uniformsBodies(text: string): string[] {
  const out: string[] = [];
  let at = text.indexOf('getUniforms(');
  while (at >= 0) {
    const end = text.indexOf('override ', at + 1);
    // Sin comentarios (de TypeScript o de GLSL): sólo cuenta el código.
    out.push(text.slice(at, end < 0 ? undefined : end).replace(/\/\/[^\n]*/g, ''));
    at = text.indexOf('getUniforms(', at + 1);
  }
  return out;
}

describe('plugins de material', () => {
  const files = sources(join(__dirname, '..', 'src')).filter((f) => /extends MaterialPluginBase/.test(readFileSync(f, 'utf8')));

  it('hay plugins para revisar', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('getUniforms() declara sólo uniformes (los varying van en CUSTOM_*_DEFINITIONS)', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const body of uniformsBodies(readFileSync(f, 'utf8'))) {
        if (/\bvarying\b|\b(in|out)\s+(float|vec[234])\s+\w+\s*;/.test(body)) bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });
});
