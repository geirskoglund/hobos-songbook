import {readFile, writeFile, mkdir, cp, readdir, lstat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseDeployment, paths} from './pages-plan.mjs';
import {validateChannel} from './channel-contract.mjs';
import {inventoryName, verifyInventory, sealChannel} from './channel-files.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
export {appName,validateChannel} from './channel-contract.mjs';

async function checkTree(directory) {
  for (const entry of await readdir(directory)) {
    assert(!entry.startsWith('.') && entry !== 'node_modules', 'Artifact inneholder skjulte eller uønskede filer.');
    const path = join(directory, entry), stat = await lstat(path);
    assert(!stat.isSymbolicLink(), 'Artifact inneholder symlenke.');
    if (stat.isDirectory()) await checkTree(path);
    else assert(stat.isFile(), 'Artifact inneholder annen filtype.');
  }
}

export async function assemblePages(builds, destination, metadata) {
  const expected = parseDeployment(metadata);
  // Validate both entire inputs before writing any deployable output.
  for (const [target, channel] of [['production', 'production'], ['preview', 'test']]) {
    const directory = join(builds, target);
    await checkTree(directory);
    await validateChannel(path => readFile(join(directory, path)), expected[target], channel);
    if (expected[target].kind === 'placeholder') {
      assert((await readdir(directory)).filter(name => name !== inventoryName).sort().join(',') === 'build-info.json,index.html', 'Plassholder inneholder appkode.');
    }
    if ((await readdir(directory)).includes(inventoryName)) await verifyInventory(directory);
    else await sealChannel(directory, expected[target], channel); // Legacy sources receive an inventory once.
  }
  await mkdir(destination); // Never reuse an old or partially assembled site.
  for (const target of ['production', 'preview']) {
    await cp(join(builds, target), join(destination, paths[target]), {recursive: true});
  }
  await writeFile(join(destination, 'deployment.json'), JSON.stringify({...expected, paths}, null, 2));
  await writeFile(join(destination, '.nojekyll'), '');
  await writeFile(join(destination, 'index.html'), '<!doctype html><html lang="nb"><meta charset="utf-8"><title>Hobo\'s Songbook</title><a href="app/">Hobo\'s Songbook</a> <a href="test/">Testversjon</a></html>\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await assemblePages(resolve(process.argv[2]), resolve(process.argv[3]), JSON.parse(process.env.PAGES_PLAN).metadata);
}
