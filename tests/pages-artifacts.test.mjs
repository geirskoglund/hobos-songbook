import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {buildChannel} from '../scripts/build-channel.mjs';
import {assemblePages, appName} from '../scripts/assemble-pages.mjs';
import {verifyPages, verifyWithRetry} from '../scripts/verify-pages.mjs';
import {planPages, repository, siteUrl} from '../scripts/pages-plan.mjs';

const sha = 'a'.repeat(40), testSha = 'b'.repeat(40);
const source = (sha, pr = null, kind = 'app') => ({sha, pr, kind});
const metadata = () => ({version: 1, repository, production: source(sha), preview: source(testSha, 7)});
const env = (channel, source) => ({APP_CHANNEL: channel, APP_SHA: source.sha, APP_PR: source.pr?.toString() || '', APP_KIND: source.kind});
async function temp(t) {
  const path = await mkdtemp(join(tmpdir(), 'hobos-pages-'));
  t.after(() => rm(path, {recursive: true, force: true}));
  return path;
}
// Generate real minimal fixture PNGs; these are contract fixtures, not product icons or browser evidence.
function png(size) {
  const chunk = (name, data) => {
    const type = Buffer.from(name), content = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of content) {crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);}
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, content, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(size * (1 + size * 4)))), chunk('IEND', Buffer.alloc(0))]);
}
async function app(directory, source, channel) {
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, 'build-info.json'), JSON.stringify({version: 1, ...source, channel}));
  await writeFile(join(directory, 'index.html'), `<title>${appName(channel)}</title><link rel="apple-touch-icon" href="apple-touch-icon.png"><div id="app">${channel === 'test' ? 'Testversjon' : 'Produksjon'}</div>`);
  const manifest = {name: appName(channel), short_name: appName(channel), id: './', start_url: './', scope: './', display: 'standalone',
    icons: [{src: 'icon-192.png', sizes: '192x192'}, {src: 'icon-512.png', sizes: '512x512', purpose: 'maskable'}]};
  await writeFile(join(directory, 'manifest.webmanifest'), JSON.stringify(manifest));
  for (const size of [192, 512, 180]) await writeFile(join(directory, size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`), png(size));
  await writeFile(join(directory, 'sw.js'), '// fixture worker, not an offline test');
}
const served = directory => async url => {
  const path = new URL(url).pathname.slice(new URL(siteUrl).pathname.length);
  try {const bytes = await readFile(join(directory, path)); return new Response(bytes, {status: 200});}
  catch {return new Response('', {status: 404});}
};

test('complete bootstrap plan, separate placeholder builds, assembly and HTTPS contract', async t => {
  const root = await temp(t), builds = join(root, 'builds'), site = join(root, 'site');
  const {metadata} = await planPages({eventName: 'workflow_dispatch', event: {}, selection: 'keep', masterSha: sha,
    previous: null, hasApp: async () => false, isValidated: async () => true});
  for (const [target, channel] of [['production', 'production'], ['preview', 'test']]) {
    await buildChannel(root, join(builds, target), env(channel, metadata[target]), () => {throw Error('placeholder cannot execute app code');});
  }
  await assemblePages(builds, site, metadata);
  await verifyPages(metadata, served(site));
  assert.match(await readFile(join(site, 'app/index.html'), 'utf8'), /Produksjon – oppstartsplassholder/);
  assert.match(await readFile(join(site, 'test/index.html'), 'utf8'), /Testversjon – oppstartsplassholder/);
  await assert.rejects(access(join(site, 'app/manifest.webmanifest')));
  await assert.rejects(assemblePages(builds, site, metadata), /EEXIST/);
});
test('app contract fixtures assemble on sibling paths and compare exact published sources', async t => {
  const root = await temp(t), builds = join(root, 'builds'), site = join(root, 'site'), expected = metadata();
  await app(join(builds, 'production'), expected.production, 'production');
  await app(join(builds, 'preview'), expected.preview, 'test');
  await assemblePages(builds, site, expected);
  await verifyPages(expected, served(site));
  await assert.rejects(verifyPages({...expected, preview: source(sha, 7)}, served(site)), /avviker/);
});
test('bad identity, source, manifest, icon, worker and symlink block all output before deploy', async t => {
  const cases = [
    async dir => writeFile(join(dir, 'build-info.json'), JSON.stringify({version: 1, ...source(sha), channel: 'production'})),
    async dir => writeFile(join(dir, 'manifest.webmanifest'), JSON.stringify({name: 'wrong', scope: '/'})),
    async dir => {const file = join(dir, 'manifest.webmanifest'), m = JSON.parse(await readFile(file)); m.icons[0].src = '../app/icon.png'; await writeFile(file, JSON.stringify(m));},
    async dir => writeFile(join(dir, 'icon-192.png'), png(180)),
    async dir => writeFile(join(dir, 'icon-512.png'), 'not a PNG'),
    async dir => rm(join(dir, 'sw.js')),
    async dir => symlink('/etc/passwd', join(dir, 'leak.txt')),
    async dir => writeFile(join(dir, '.hidden'), 'bad'),
    async dir => writeFile(join(dir, 'index.html'), '<title>Test</title>'),
  ];
  for (const mutate of cases) {
    const root = await temp(t), builds = join(root, 'builds'), site = join(root, 'site'), expected = metadata();
    await app(join(builds, 'production'), expected.production, 'production');
    await app(join(builds, 'preview'), expected.preview, 'test');
    await mutate(join(builds, 'preview'));
    await assert.rejects(assemblePages(builds, site, expected));
    await assert.rejects(access(site));
  }
});
test('placeholder cannot hide PR code or additional executable files', async t => {
  const root = await temp(t), builds = join(root, 'builds'), expected = {version: 1, repository,
    production: source(sha, null, 'placeholder'), preview: source(sha, null, 'placeholder')};
  await buildChannel(root, join(builds, 'production'), env('production', expected.production));
  await buildChannel(root, join(builds, 'preview'), env('test', expected.preview));
  await writeFile(join(builds, 'production', 'sw.js'), 'untrusted');
  await assert.rejects(assemblePages(builds, join(root, 'site'), expected), /appkode/);
});
test('real failed npm validation stops before app build and deployable assembly', async t => {
  const root = await temp(t), src = join(root, 'source'), out = join(root, 'builds/preview');
  await mkdir(src);
  await writeFile(join(src, 'app-build.json'), '{"version":1}');
  await writeFile(join(src, 'package.json'), JSON.stringify({name: 'failing-fixture', version: '1.0.0',
    scripts: {check: 'node -e "process.exit(23)"', build: 'node -e "throw Error(\'must not build\')"'}}));
  await writeFile(join(src, 'package-lock.json'), JSON.stringify({name: 'failing-fixture', version: '1.0.0', lockfileVersion: 3,
    packages: {'': {name: 'failing-fixture', version: '1.0.0'}}}));
  await assert.rejects(buildChannel(src, out, {...env('test', source(testSha, 7)), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false'}), /npm run check feilet/);
  await assert.rejects(assemblePages(join(root, 'builds'), join(root, 'site'), metadata()));
  await assert.rejects(access(join(root, 'site')));
});
test('app build driver passes stable channel/SHA/PR to each step and copies dist', async t => {
  const root = await temp(t), src = join(root, 'source'), out = join(root, 'build'), seen = [];
  await mkdir(join(src, 'dist'), {recursive: true});
  await writeFile(join(src, 'app-build.json'), '{"version":1}');
  await writeFile(join(src, 'dist/index.html'), 'fixture');
  await buildChannel(src, out, env('test', source(testSha, 7)), (command, args, options) => {
    seen.push([command, args]); assert.equal(options.env.APP_SHA, testSha); assert.equal(options.env.APP_PR, '7');
    assert.equal(options.env.APP_CHANNEL, 'test'); assert.equal(options.cwd, src);
  });
  assert.deepEqual(seen, [['npm', ['ci']], ['npm', ['run', 'check']], ['npm', ['run', 'build']]]);
  assert.equal(await readFile(join(out, 'index.html'), 'utf8'), 'fixture');
});
test('post-deploy failures are reported without claiming rollback; retries can recover', async t => {
  const root = await temp(t), builds = join(root, 'builds'), site = join(root, 'site'), expected = metadata();
  await app(join(builds, 'production'), expected.production, 'production');
  await app(join(builds, 'preview'), expected.preview, 'test');
  await assemblePages(builds, site, expected);
  let failures = 1;
  await verifyWithRetry(expected, {attempts: 2, wait: async () => {}, fetchImpl: async url => failures-- > 0 ? new Response('', {status: 503}) : served(site)(url)});
  await assert.rejects(verifyWithRetry(expected, {attempts: 2, wait: async () => {}, fetchImpl: async () => new Response('', {status: 503})}), /etter deploy.*ikke automatisk gjenopprettet/);
  assert.equal((await readFile(join(site, 'deployment.json'), 'utf8')).includes(testSha), true);
});
