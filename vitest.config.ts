import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Entorno Node puro: la lógica que se testea acá (generación del plano,
    // índice espacial, generador pseudoaleatorio) no toca el DOM ni WebGL a
    // propósito. Ése es justamente el motivo de que pueda correr en
    // milisegundos en vez de minutos de navegador.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'dot',
  },
});
