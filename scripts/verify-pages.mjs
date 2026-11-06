import {parseDeployment, paths, siteUrl} from './pages-plan.mjs';
import {validateChannel} from './assemble-pages.mjs';

export async function verifyPages(metadata, fetchImpl = fetch) {
  const expected = parseDeployment(metadata);
  const read = async path => {
    const url = new URL(path, siteUrl);
    url.searchParams.set('verify', Date.now());
    const response = await fetchImpl(url, {cache: 'no-store', signal: AbortSignal.timeout(10000)});
    const finalUrl = new URL(response.url || url);
    if (!response.ok || finalUrl.protocol !== 'https:' || finalUrl.origin !== url.origin || finalUrl.pathname !== url.pathname) {
      throw new Error(`HTTPS-kontroll feilet: ${path} (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  };
  const actual = parseDeployment(JSON.parse((await read('deployment.json')).toString()));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Publisert metadata avviker fra planen.');
  for (const [target, channel] of [['production', 'production'], ['preview', 'test']]) {
    await validateChannel(path => read(paths[target] + path), expected[target], channel);
  }
}

export async function verifyWithRetry(metadata, {attempts = 6, delay = 3000, fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { await verifyPages(metadata, fetchImpl); return; }
    catch (error) { lastError = error; if (attempt < attempts - 1) await wait(delay); }
  }
  throw new Error(`Etterkontroll feilet etter deploy. Nettstedet er ikke automatisk gjenopprettet. ${lastError.message}`);
}
