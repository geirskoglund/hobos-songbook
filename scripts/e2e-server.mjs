import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, join, extname} from 'node:path';

const root = resolve('work/e2e');
const variants = {app: 'production-v1', test: 'test-v1'};
const types = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json'};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'POST' && url.pathname === '/__test__/reset') {
    variants.app = 'production-v1'; variants.test = 'test-v1'; response.end('reset'); return;
  }
  if (request.method === 'POST' && url.pathname === '/__test__/update' && ['app', 'test'].includes(url.searchParams.get('channel'))) {
    const channel = url.searchParams.get('channel'); variants[channel] = channel === 'app' ? 'production-v2' : url.searchParams.get('variant') === 'same' ? 'test-v1-repacked' : 'test-v2'; response.end('updated'); return;
  }
  if (url.pathname === '/__test__/ready') {response.end('ready'); return;}
  const match = /^\/hobos-songbook\/(app|test)\/(.*)$/.exec(decodeURIComponent(url.pathname));
  if (!match || match[2].split('/').some(part => part === '..')) {response.writeHead(404).end(); return;}
  const path = join(root, variants[match[1]], match[2] || 'index.html');
  try {
    const bytes = await readFile(path);
    response.writeHead(200, {'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    response.end(bytes);
  } catch {response.writeHead(404).end();}
});
server.listen(4173, '127.0.0.1');
process.on('SIGTERM', () => server.close());
