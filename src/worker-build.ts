import type {AppEnvironment} from './environment.ts';

/** Ask this particular worker, not the network or another worker's cached metadata. */
export function workerBuild(worker: ServiceWorker, env: AppEnvironment): Promise<AppEnvironment | null> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (value: AppEnvironment | null) => {
      clearTimeout(timeout); channel.port1.close(); channel.port2.close(); resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 3000);
    channel.port1.onmessage = event => {
      const value = event.data;
      finish(value?.version === 1 && value.kind === 'app' && value.channel === env.channel &&
        value.base === env.base && value.namespace === env.namespace && /^[a-f0-9]{40}$/.test(value.sha) &&
        (value.pr === null || Number.isSafeInteger(value.pr) && value.pr > 0) ? value : null);
    };
    try {worker.postMessage({type: 'GET_BUILD_INFO'}, [channel.port2]);}
    catch {finish(null);}
  });
}
