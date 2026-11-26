// ESLint fanger feil i koden. Stil er Prettiers ansvar, så ingen stilregler slås på her.
// En ny regel slås bare på i en PR som samtidig retter alle bruddene i kodebasen.
import path from 'node:path';
import js from '@eslint/js';
import {defineConfig} from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Lagene i src/, laveste lag først. Et lag importerer bare fra seg selv og lavere lag.
// Rotfilen environment.ts har ingen importer og kan brukes av alle lag unntatt core.
// Regelen løser opp hver relativ sti, så undermapper og skrivemåter som ./../ håndteres riktig.
const layers = ['core', 'domain', 'storage', 'adapters', 'sync', 'ui'];
const src = path.resolve(import.meta.dirname, 'src');
const layerOf = file => path.relative(src, file).split(path.sep)[0];
const layerImports = {
  meta: {type: 'problem', schema: []},
  create(context) {
    const layer = layerOf(context.filename);
    const rank = layers.indexOf(layer);
    if (rank < 0) return {};
    const allowed = target => {
      const relative = path.relative(src, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return true; // Utenfor src/, for eksempel assets/.
      const top = layerOf(target);
      if (top === 'environment.ts') return rank > 0;
      return layers.includes(top) && layers.indexOf(top) <= rank;
    };
    const check = (node, source) => {
      if (!source) return;
      const spec =
        source.type === 'Literal'
          ? source.value
          : source.type === 'TemplateLiteral' && !source.expressions.length
            ? source.quasis[0].value.cooked
            : null;
      if (spec === null)
        return context.report({node, message: 'Lagregelen kan ikke kontrollere en beregnet importsti.'});
      if (typeof spec !== 'string' || !spec.startsWith('.')) return;
      if (allowed(path.resolve(path.dirname(context.filename), spec))) return;
      const lower = layers.slice(0, rank);
      context.report({
        node,
        message: rank
          ? `${layer}/ importerer bare fra ${lower.join(', ')} og environment.ts. Se docs/ARCHITECTURE.md.`
          : 'core/ importerer ikke fra andre lag. Se docs/ARCHITECTURE.md.',
      });
    };
    return {
      ImportDeclaration: node => check(node, node.source),
      ExportNamedDeclaration: node => check(node, node.source),
      ExportAllDeclaration: node => check(node, node.source),
      ImportExpression: node => check(node, node.source),
      TSImportType: node => check(node, node.argument?.literal ?? node.argument),
    };
  },
};

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
  {
    files: ['src/**/*.ts'],
    plugins: {layers: {rules: {imports: layerImports}}},
    rules: {'layers/imports': 'error'},
  },
);
