import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'functions/node_modules/**', 'src/data/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },
  {
    files: ['functions/**/*.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' }
  }
];
