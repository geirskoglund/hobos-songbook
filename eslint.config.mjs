// ESLint fanger feil i koden. Stil er Prettiers ansvar, så ingen stilregler slås på her.
// En ny regel slås bare på i en PR som samtidig retter alle bruddene i kodebasen.
import path from 'node:path';
import js from '@eslint/js';
import {defineConfig} from 'eslint/config';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import playwright from 'eslint-plugin-playwright';
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

// DOM-typene som core/, domain/ og sync/ ikke får bruke.
const domTypes =
  '/^(Document|DocumentFragment|Window|Node|NodeList|Element|HTMLCollection|HTML\\w*Element|SVG\\w*Element|ShadowRoot|Text|DOMParser|MutationObserver|ResizeObserver|IntersectionObserver)$/';

export default defineConfig(
  // .ci-infra/ er CI-ens kopi av master-skriptene, og .claude/worktrees/ har nestede git-worktrees.
  {
    ignores: [
      'dist/',
      'site/',
      'builds/',
      'work/',
      'test-results/',
      'playwright-report/',
      '.ci-infra/',
      '.claude/worktrees/',
    ],
  },
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
      // Fanger løs likhet, som gir uventede typekonverteringer. `== null` fanger både null og undefined og er tillatt.
      eqeqeq: ['error', 'always', {null: 'ignore'}],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {globals: globals.browser},
  },
  {
    // Typebaserte regler for src/, valgt enkeltvis i stedet for hele recommendedTypeChecked.
    files: ['src/**/*.ts'],
    languageOptions: {parserOptions: {projectService: true}},
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Dropbox-unioner har alltid et default-tilfelle, og det regnes som dekkende.
      '@typescript-eslint/switch-exhaustiveness-check': ['error', {considerDefaultExhaustiveForUnions: true}],
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: {'no-unsanitized': noUnsanitized},
    rules: {
      // Fanger HTML fra strenger (innerHTML, insertAdjacentHTML o.l.), som åpner for skriptinjeksjon.
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
  {
    // core/, domain/ og sync/ kjører uten DOM. IndexedDB, crypto, TextEncoder, navigator
    // og andre ikke-DOM-API-er er tillatt.
    files: ['src/core/**/*.ts', 'src/domain/**/*.ts', 'src/sync/**/*.ts'],
    rules: {
      // Fanger bruk av siden og nettleservinduet i lag som ikke skal ha DOM.
      'no-restricted-globals': [
        'error',
        {name: 'document', message: 'core/, domain/ og sync/ bruker ikke DOM. Flytt koden til ui/.'},
        {name: 'window', message: 'core/, domain/ og sync/ bruker ikke DOM. Flytt koden til ui/.'},
      ],
      // Fanger DOM-elementtyper, både som typer og som verdier (instanceof, new).
      'no-restricted-syntax': [
        'error',
        {
          selector: `Identifier[name=${domTypes}]:not(MemberExpression > .property):not(Property > .key)`,
          message: 'core/, domain/ og sync/ bruker ikke DOM-typer. Flytt koden til ui/.',
        },
      ],
    },
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
    files: ['tests/e2e/**/*.mjs'],
    plugins: {playwright},
    rules: {
      // Fanger Playwright-kall og forventninger uten await, som kan passere uten å sjekke noe.
      'playwright/missing-playwright-await': 'error',
      // Fanger test.only og describe.only, som ville hoppet over resten av suiten.
      'playwright/no-focused-test': 'error',
      // Fanger expect uten matcher eller med feil antall argumenter, som ikke sjekker noe.
      'playwright/valid-expect': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: {layers: {rules: {imports: layerImports}}},
    rules: {'layers/imports': 'error'},
  },
);
