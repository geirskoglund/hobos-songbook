// PostToolUse-hook for Edit og Write: formaterer filen Claude Code endret med prosjektets Prettier,
// og kjører deretter ESLint på den. Lintfeil meldes tilbake til agenten som tilleggskontekst.
// Stopper aldri en redigering. Mangler Prettier eller ESLint, eller feiler et av dem, er hooken stille; CI fanger det.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const prettier = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
const eslint = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const linted = /\.(?:ts|mjs|cjs|js)$/;

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const file = JSON.parse(input)?.tool_input?.file_path;
  const path = typeof file === 'string' ? resolve(root, file) : '';
  const inside = path && relative(root, path);
  if (inside && !inside.startsWith('..') && !isAbsolute(inside)) {
    if (existsSync(prettier)) {
      spawnSync(process.execPath, [prettier, '--write', '--ignore-unknown', '--log-level', 'silent', inside], {
        cwd: root,
        stdio: 'ignore',
        timeout: 20_000,
      });
    }
    if (linted.test(inside) && existsSync(eslint)) {
      const result = spawnSync(process.execPath, [eslint, '--no-warn-ignored', '--no-color', inside], {
        cwd: root,
        encoding: 'utf8',
        timeout: 20_000,
      });
      // Statuskode 1 betyr lintfeil. Andre koder betyr at ESLint selv feilet, og da er hooken stille.
      if (result.status === 1 && result.stdout.trim()) {
        const additionalContext = `ESLint fant feil i ${inside}:\n${result.stdout.trim()}`;
        process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'PostToolUse', additionalContext}}));
      }
    }
  }
} catch {
  // Bevisst stille: hooken skal aldri blokkere arbeidet.
}
process.exit(0);
