import {mkdir, rm, cp, appendFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {build} from 'vite';
import {assemblePages} from './assemble-pages.mjs';
import {buildChannel} from './build-channel.mjs';
import {repository} from './pages-plan.mjs';

const root = resolve('work/e2e');
await rm(root, {recursive: true, force: true});
await mkdir(root, {recursive: true});
// Test the real shared controls with app CSS, including unused footer variants.
// This fixture is served only by e2e-server and never enters a product build.
await build({configFile:false, logLevel:'warn', build:{
  lib:{entry:resolve('src/ui/controls.ts'), formats:['es'], fileName:()=>'controls.js'},
  outDir:join(root,'design-fixture'), emptyOutDir:true,
}});
const variants = [
  {target: 'production-v1', channel: 'production', sha: 'a'.repeat(40), pr: ''},
  {target: 'test-v1', channel: 'test', sha: 'b'.repeat(40), pr: '7'},
  {target: 'test-v2', channel: 'test', sha: 'c'.repeat(40), pr: '8'},
  {target: 'production-v2', channel: 'production', sha: 'd'.repeat(40), pr: ''},
];
for (const variant of variants) {
  process.env.APP_CHANNEL = variant.channel; process.env.APP_SHA = variant.sha; process.env.APP_PR = variant.pr;
  await build({logLevel: 'warn', build: {outDir: join(root, variant.target), emptyOutDir: true}});
}
// A regenerated worker can change bytes without changing the app build.
await cp(join(root, 'test-v1'), join(root, 'test-v1-repacked'), {recursive: true});
await appendFile(join(root, 'test-v1-repacked/sw.js'), '\n// Repacked worker, identical app version.\n');
// The actual new app must fit bootstrap's placeholder-production / PR-test assembly contract.
const builds = join(root, 'bootstrap-builds');
const master = {sha: 'a'.repeat(40), pr: null, kind: 'placeholder'};
await buildChannel(root, join(builds, 'production'), {APP_CHANNEL: 'production', APP_SHA: master.sha, APP_PR: '', APP_KIND: 'placeholder'});
await cp(join(root, 'test-v1'), join(builds, 'preview'), {recursive: true});
await assemblePages(builds, join(root, 'bootstrap-site'), {version: 1, repository, production: master, preview: {sha: 'b'.repeat(40), pr: 7, kind: 'app'}});
