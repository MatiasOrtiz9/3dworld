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
    // Algunas pruebas recorren la escuela entera (el mapa de luz natural se
    // calcula dos veces para comprobar que es determinista, el QA del
    // equipamiento, los recorridos de la historia). En frío y con todos los
    // archivos en paralelo —como en el build de despliegue, con pocos
    // núcleos— superaban los 5 s por defecto y el build fallaba sin que nada
    // estuviera roto. El límite sólo corta pruebas colgadas.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
