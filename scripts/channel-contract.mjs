import {placeholder} from './build-channel.mjs';
const assert = (ok, message) => {if (!ok) throw new Error(message);};
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

