import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Configuración de ESLint (formato plano, ESLint 9).
 *
 * El criterio es que las reglas atrapen errores REALES, no que impongan estilo:
 * el formato lo resuelve Prettier, y `eslint-config-prettier` apaga todo lo que
 * se superponga. Una configuración que grita por comillas simples entrena a
 * ignorarla, y entonces tampoco se ven los avisos que importan.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'shots/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // --- código de la aplicación ---
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json' },
    },
    rules: {
      // El proyecto usa `any` en muy pocos lugares y siempre acotado; que avise
      // sin romper el build.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Un argumento con guion bajo es intencionalmente ignorado.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `!` está permitido: hay lugares donde el tipo no puede expresar una
      // garantía que el código sí tiene (por ejemplo, buscar una manzana que el
      // generador garantiza que existe).
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Errores de verdad.
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // --- tests ---
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: { describe: 'readonly', it: 'readonly', expect: 'readonly' },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // --- herramientas de verificación ---
  //
  // Estos archivos corren en Node, PERO el cuerpo de cada `page.evaluate()` se
  // serializa y se ejecuta dentro del navegador. Por eso conviven globales de
  // los dos entornos en el mismo archivo, y ambos son legítimos.
  {
    files: ['tools/**/*.mjs', '*.config.ts', '*.config.js'],
    languageOptions: {
      globals: {
        // Node
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        // Navegador (dentro de page.evaluate)
        window: 'readonly',
        document: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        Event: 'readonly',
        MutationObserver: 'readonly',
        caches: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  prettier,
);
