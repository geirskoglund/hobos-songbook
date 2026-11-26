// ESLint fanger feil i koden. Stil er Prettiers ansvar, så ingen stilregler slås på her.
// En ny regel slås bare på i en PR som samtidig retter alle bruddene i kodebasen.
import js from '@eslint/js';
import {defineConfig} from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
);
