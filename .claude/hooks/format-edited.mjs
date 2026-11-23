// PostToolUse-hook for Edit og Write: formaterer filen Claude Code endret med prosjektets Prettier.
// Stopper aldri en redigering. Mangler Prettier, eller feiler formateringen, gjør hooken ingenting; CI fanger det.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const prettier = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const file = JSON.parse(input)?.tool_input?.file_path;
  if (typeof file === 'string' && existsSync(prettier)) {
    const path = resolve(root, file);
    const inside = relative(root, path);
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) {
      spawnSync(process.execPath, [prettier, '--write', '--ignore-unknown', '--log-level', 'silent', inside], {
        cwd: root,
        stdio: 'ignore',
        timeout: 20_000,
      });
    }
  }
} catch {
  // Bevisst stille: hooken skal aldri blokkere arbeidet.
}
process.exit(0);
