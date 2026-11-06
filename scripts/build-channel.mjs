import {readFile, mkdir, writeFile, cp, rm} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {validSha} from './pages-plan.mjs';

export function buildInfo(env) {
  const pr = env.APP_PR ? Number(env.APP_PR) : null;
  if (!['production', 'test'].includes(env.APP_CHANNEL) || !validSha(env.APP_SHA) ||
      !['app', 'placeholder'].includes(env.APP_KIND) ||
      (pr !== null && (!Number.isSafeInteger(pr) || pr < 1)) ||
      (env.APP_CHANNEL === 'production' && pr !== null) || (env.APP_KIND === 'placeholder' && pr !== null)) {
    throw new Error('Ugyldig byggmiljø.');
  }
  return {version: 1, channel: env.APP_CHANNEL, sha: env.APP_SHA, pr, kind: env.APP_KIND};
}

export function placeholder(info) {
  const label = info.channel === 'test' ? 'Testversjon' : 'Produksjon';
  return `<!doctype html><html lang="nb"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hobo's Songbook – oppstart</title><main><h1>Hobo's Songbook</h1><h2>${label} – oppstartsplassholder</h2>
<p>Appskallet er ikke levert ennå. Denne siden er ikke en installérbar eller offline-klar app.</p>
<p>Grunnlag: master <code>${info.sha}</code></p></main></html>\n`;
}

export async function buildChannel(source, destination, env = process.env, run = (command, args, options) => {
  const result = spawnSync(command, args, {...options, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} feilet (${result.status}).`);
}) {
  const info = buildInfo(env);
  await rm(destination, {recursive: true, force: true});
  await mkdir(destination, {recursive: true});
  if (info.kind === 'placeholder') {
    await writeFile(join(destination, 'index.html'), placeholder(info));
    await writeFile(join(destination, 'build-info.json'), JSON.stringify(info));
    return;
  }
  const contract = JSON.parse(await readFile(join(source, 'app-build.json'), 'utf8'));
  if (contract.version !== 1) throw new Error('Ukjent appbyggkontrakt.');
  const options = {cwd: source, env: {...process.env, ...env}};
  // Runs only in a read-only job, never in the Pages/deployment job.
  await run('npm', ['ci'], options);
  await run('npm', ['run', 'check'], options);
  await run('npm', ['run', 'build'], options);
  await cp(join(source, 'dist'), destination, {recursive: true, dereference: false});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildChannel(resolve(process.argv[2]), resolve(process.argv[3]));
}
