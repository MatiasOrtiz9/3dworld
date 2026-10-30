import { describe, expect, it } from 'vitest';
import { parseSave } from '../src/game/story/save';

describe('guardado de la partida', () => {
  it('un guardado con sellos repetidos o desconocidos no cuenta de más', () => {
    const s = parseSave(JSON.stringify({ v: 1, stamps: ['maker', 'maker', 'inventado', 'patio', 3], zones: ['entrada', 'entrada', 'sotano'], done: ['a', 'a'] }));
    expect(s?.stamps).toEqual(['maker', 'patio']);
    expect(s?.zones).toEqual(['entrada']);
    expect(s?.done).toEqual(['a']);
  });

  it('lo ilegible o de otra versión no se carga', () => {
    expect(parseSave('{no es json')).toBeNull();
    expect(parseSave(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseSave(null)).toBeNull();
  });
});
