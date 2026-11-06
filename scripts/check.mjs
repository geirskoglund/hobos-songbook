import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

for (const directory of ['scripts', 'tests']) {
  for (const path of await readdir(directory)) {
    if (!path.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${path}`], {stdio: 'inherit'});
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
const result = spawnSync(process.execPath, ['--test', 'tests/*.test.mjs'], {stdio: 'inherit'});
process.exit(result.status ?? 1);
