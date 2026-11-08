import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir, lstat} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {validateChannel} from './channel-contract.mjs';
import {siteUrl, paths} from './pages-plan.mjs';

export const inventoryName = 'build-files.json';
const assert = (ok, message) => {if (!ok) throw Error(message);};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function safeFile(path) {
  return typeof path === 'string' && path.length < 240 && /^[a-zA-Z0-9_/-][a-zA-Z0-9_./-]*$/.test(path) &&
    path.split('/').every(part => part && !part.startsWith('.') && part !== 'node_modules');
}
async function files(directory, prefix = '') {
  const result = [];
  for (const name of await readdir(directory)) {
    const path = prefix + name;
    assert(safeFile(path), 'Utrygg byggsti.');
    const stat = await lstat(join(directory, name));
    assert(!stat.isSymbolicLink(), 'Bygg kan ikke inneholde symlenker.');
    if (stat.isDirectory()) result.push(...await files(join(directory, name), path + '/'));
    else {assert(stat.isFile(), 'Ugyldig filtype i bygg.'); if (path !== inventoryName) result.push(path);}
  }
  return result.sort();
}
export function parseInventory(value) {
  assert(value?.version === 1 && Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 2048, 'Ugyldig bygginventar.');
  let total = 0; const names = new Set();
  for (const entry of value.files) {
    assert(safeFile(entry.path) && entry.path !== inventoryName && !names.has(entry.path) &&
      /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= 10*1024*1024, 'Ugyldig fil i bygginventar.');
    names.add(entry.path); total += entry.size;
  }
  assert(total <= 50*1024*1024, 'Bygginventaret er for stort.'); return value;
}
export async function sealChannel(directory, source, channel) {
  const read = path => readFile(join(directory, path));
  await validateChannel(read, source, channel);
  const entries = [];
  for (const path of await files(directory)) {const bytes = await read(path); entries.push({path, size:bytes.length, sha256:digest(bytes)});}
  const inventory = parseInventory({version:1, files:entries});
  await writeFile(join(directory, inventoryName), JSON.stringify(inventory));
}
export async function verifyInventory(directory) {
  const inventory = parseInventory(JSON.parse(await readFile(join(directory, inventoryName), 'utf8')));
  const actual = await files(directory);
  assert(JSON.stringify(actual) === JSON.stringify(inventory.files.map(file => file.path).sort()), 'Byggfiler avviker fra inventaret.');
  for (const file of inventory.files) {
    const bytes = await readFile(join(directory, file.path));
    assert(bytes.length === file.size && digest(bytes) === file.sha256, 'Byggfil har feil størrelse eller hash.');
  }
}
/** Copies the currently published channel as data. Missing legacy inventory permits a rebuild; corruption does not. */
export async function restorePublished(directory, source, channel, fetchImpl = fetch) {
  const target = channel === 'production' ? 'production' : 'preview';
  async function request(path) {
    const url = new URL(paths[target]+path, siteUrl); url.searchParams.set('reuse', Date.now());
    const response = await fetchImpl(url, {cache:'no-store',signal:AbortSignal.timeout(15000)});
    const final = new URL(response.url || url);
    assert(final.origin === url.origin && final.protocol === 'https:' && final.pathname === url.pathname, 'Uventet adresse ved gjenbruk.');
    return response;
  }
  const response = await request(inventoryName);
  if (response.status === 404) return false;
  assert(response.ok, 'Kan ikke lese publisert bygginventar.');
  const inventory = parseInventory(await response.json());
  await mkdir(directory, {recursive:true});
  let next = 0;
  await Promise.all(Array.from({length:Math.min(4,inventory.files.length)}, async () => {
    while (next < inventory.files.length) {
      const file = inventory.files[next++], response = await request(file.path);
      assert(response.ok, 'Publisert byggfil mangler.');
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(bytes.length === file.size && digest(bytes) === file.sha256, 'Publisert byggfil har feil hash.');
      const path = join(directory,file.path); await mkdir(dirname(path),{recursive:true}); await writeFile(path,bytes);
    }
  }));
  await writeFile(join(directory,inventoryName),JSON.stringify(inventory));
  await verifyInventory(directory);
  await validateChannel(path => readFile(join(directory,path)),source,channel);
  return true;
}
