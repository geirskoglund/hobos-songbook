import {readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {buildInfo} from './build-channel.mjs';
import {validateChannel} from './channel-contract.mjs';
import {sealChannel,verifyInventory} from './channel-files.mjs';
const directory = resolve(process.argv[2]), source = buildInfo(process.env), channel = process.env.APP_CHANNEL;
if (process.env.APP_LEGACY === 'true') await sealChannel(directory,source,channel);
await verifyInventory(directory);
await validateChannel(path => readFile(join(directory,path)),source,channel);
