import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildInfo} from './build-channel.mjs';
import {restorePublished} from './channel-files.mjs';

const source = buildInfo(process.env);
const reused = await restorePublished(resolve(process.argv[2]),source,process.env.APP_CHANNEL);
await appendFile(process.env.GITHUB_OUTPUT,`reused=${reused}\n`);
