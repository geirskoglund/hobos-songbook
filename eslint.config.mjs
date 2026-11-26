// ESLint fanger feil i koden. Stil er Prettiers ansvar, så ingen stilregler slås på her.
// En ny regel slås bare på i en PR som samtidig retter alle bruddene i kodebasen.
import js from '@eslint/js';
import {defineConfig} from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Lagene i src/, nederst først. Et lag importerer bare fra lagene under seg.
// Rotfilen environment.ts har ingen importer og kan brukes av alle lag over core.
const layers = ['core', 'domain', 'storage', 'adapters', 'sync', 'ui'];
const layerRules = layers.map((layer, index) => {
  const below = layers.slice(0, index);
  const allowed = index ? [...below, 'environment\\.ts'] : [];
  const message = index
    ? `${layer}/ importerer bare fra ${below.join(', ')} og environment.ts. Se docs/ARCHITECTURE.md.`
    : 'core/ importerer ikke fra andre lag. Se docs/ARCHITECTURE.md.';
  return {
    files: [`src/${layer}/**/*.ts`],
    rules: {
      'no-restricted-imports': ['error', {patterns: [{regex: `^\\.\\./(?!(?:${allowed.join('|')})(?:/|$))`, message}]}],
      // Innebygde import()-er går utenom regelen over.
      'no-restricted-syntax': [
        'error',
        {selector: 'TSImportType, ImportExpression', message: 'Bruk en vanlig import, slik at lagregelen ser den.'},
      ],
    },
  };
});

export default defineConfig(
  // .ci-infra/ er CI-ens kopi av master-skriptene.
  {ignores: ['dist/', 'site/', 'builds/', 'work/', 'test-results/', 'playwright-report/', '.ci-infra/']},
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {parserOptions: {tsconfigRootDir: import.meta.dirname}},
    rules: {
      // `const {done, ...rest} = value` er måten koden utelater et felt på.
      '@typescript-eslint/no-unused-vars': ['error', {ignoreRestSiblings: true}],
      // Playwright-fiksturer må ta imot et objektmønster, også et tomt.
      'no-empty-pattern': ['error', {allowObjectPatternsAsParameters: true}],
      // Filnavn og sangtekst renses bevisst for kontrolltegn.
      'no-control-regex': 'off',
      // Kan slås på når tolkningen av Dropbox-svar har fått typer.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {globals: globals.browser},
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {globals: globals.node},
  },
  {
    // E2E-testene sender funksjoner til nettleseren med page.evaluate().
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: {globals: {...globals.node, ...globals.browser}},
  },
  ...layerRules,
);
