import {cp, mkdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildInfo} from './build-channel.mjs';
import {sealChannel} from './channel-files.mjs';

/** Called after the single successful CI check, with dependencies already installed. */
export async function buildValidated(source, destination, env = process.env, run = (command,args,options) => {
  const result = spawnSync(command,args,{...options,stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Bygg av validert kilde feilet.');
}) {
  const channels = env.APP_PR ? ['test'] : ['production','test'];
  for (const channel of channels) {
    const settings = {...env,APP_CHANNEL:channel,APP_KIND:'app'};
    const info = buildInfo(settings), out = join(destination,channel);
    await rm(out,{recursive:true,force:true}); await mkdir(out,{recursive:true});
    await run('npm',['run','build'],{cwd:source,env:{...process.env,...settings}});
    await cp(join(source,'dist'),out,{recursive:true});
    await sealChannel(out,info,channel);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildValidated(process.cwd(),resolve('release'));
