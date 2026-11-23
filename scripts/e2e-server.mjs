import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {resolve, join, extname} from 'node:path';
import {e2eBasePort, e2eMaxWorkers} from './e2e-ports.mjs';

const root = resolve('work/e2e');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

/** One server per Playwright worker, each with its own app version state. */
function workerServer() {
  const variants = {app: 'production-v1', test: 'test-v1'};
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'POST' && url.pathname === '/__test__/reset') {
      variants.app = 'production-v1';
      variants.test = 'test-v1';
      response.end('reset');
      return;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/__test__/update' &&
      ['app', 'test'].includes(url.searchParams.get('channel'))
    ) {
      const channel = url.searchParams.get('channel');
      variants[channel] =
        channel === 'app'
          ? 'production-v2'
          : url.searchParams.get('variant') === 'same'
            ? 'test-v1-repacked'
            : 'test-v2';
      response.end('updated');
      return;
    }
    if (url.pathname === '/__test__/ready') {
      response.end('ready');
      return;
    }
    if (url.pathname === '/__test__/controls.js') {
      response.writeHead(200, {'Content-Type': types['.js'], 'Cache-Control': 'no-store'});
      response.end(await readFile(join(root, 'design-fixture', 'controls.js')));
      return;
    }
    const match = /^\/hobos-songbook\/(app|test)\/(.*)$/.exec(decodeURIComponent(url.pathname));
    if (!match || match[2].split('/').some(part => part === '..')) {
      response.writeHead(404).end();
      return;
    }
    const path = join(root, variants[match[1]], match[2] || 'index.html');
    try {
      const bytes = await readFile(path);
      response.writeHead(200, {
        'Content-Type': types[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
}

const servers = Array.from({length: e2eMaxWorkers}, workerServer);
// Playwright waits for the base port, so it starts listening only after all the others.
for (const [index, server] of servers.entries()) {
  if (index === 0) continue;
  server.listen(e2eBasePort + index, '127.0.0.1');
  await once(server, 'listening');
}
servers[0].listen(e2eBasePort, '127.0.0.1');
process.on('SIGTERM', () => servers.forEach(server => server.close()));
