import {readFile, writeFile, mkdir, cp, readdir, lstat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseDeployment, paths} from './pages-plan.mjs';
import {placeholder} from './build-channel.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
export const appName = channel => channel === 'production' ? "Hobo's Songbook" : "Hobo's Songbook Test";

/** A pure read contract, shared by artifact and post-deploy HTTPS verification. Never executes build code. */
export async function validateChannel(read, source, channel) {
  const json = async path => JSON.parse((await read(path)).toString());
  const info = await json('build-info.json');
  assert(info.version === 1 && info.channel === channel && info.sha === source.sha &&
    info.pr === source.pr && info.kind === source.kind, 'Feil miljø, PR, byggtype eller kildecommit.');
  const html = (await read('index.html')).toString();
  if (source.kind === 'placeholder') {
    assert(html === placeholder(info), 'Plassholderen må være generert av betrodd infrastruktur.');
    return;
  }
  const manifest = await json('manifest.webmanifest');
  assert(manifest.name === appName(channel) && manifest.short_name === appName(channel) &&
    manifest.id === './' && manifest.start_url === './' && manifest.scope === './' &&
    manifest.display === 'standalone', 'Feil PWA-identitet eller scope.');
  assert(html.includes('id="app"') && html.includes(`<title>${appName(channel)}</title>`) &&
    html.includes('apple-touch-icon') && (channel !== 'test' || html.includes('Testversjon')), 'Feil appinngang eller testmerking.');
  assert(Array.isArray(manifest.icons) && manifest.icons.some(icon => icon.sizes === '192x192') &&
    manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose?.split(' ').includes('maskable')), 'Mangler installasjonsikoner.');
  for (const icon of [...manifest.icons, {src: 'apple-touch-icon.png', sizes: '180x180'}]) {
    assert(/^[a-z0-9-]+\.png$/.test(icon.src), 'Utrygg ikonsti.');
    const size = /^(\d+)x(\d+)$/.exec(icon.sizes);
    const png = await read(icon.src);
    assert(size && png.length >= 24 && png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' &&
      png.toString('ascii', 12, 16) === 'IHDR' && png.readUInt32BE(16) === Number(size[1]) &&
      png.readUInt32BE(20) === Number(size[2]), 'Ugyldig PNG eller ikonstørrelse.');
  }
  assert((await read('sw.js')).length > 0, 'Mangler service worker.');
}

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
      assert((await readdir(directory)).sort().join(',') === 'build-info.json,index.html', 'Plassholder inneholder appkode.');
    }
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
