import {execFileSync} from 'node:child_process';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {environment} from './src/environment.ts';

const sha = process.env.APP_SHA || execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const env = environment(process.env.APP_CHANNEL || 'test', sha, process.env.APP_PR || '');
export default defineConfig({
  base: env.base,
  publicDir: `assets/icons/${env.channel}`,
  define: {__APP_ENV__: JSON.stringify(env)},
  build: {target: 'es2022'},
  plugins: [{
    name: 'environment-identity',
    generateBundle() {
      this.emitFile({type: 'asset', fileName: 'build-info.json', source: JSON.stringify(env)});
    },
    transformIndexHtml(html) {
      return html.replaceAll('__APP_NAME__', env.name)
        .replaceAll('__APP_LABEL__', env.channel === 'test' ? 'Testversjon' : 'Produksjon')
        .replaceAll('__APP_SOURCE__', env.pr ? `PR #${env.pr}` : 'master')
        .replaceAll('__APP_SHA__', env.sha.slice(0, 7));
    },
  }, VitePWA({
    registerType: 'prompt', injectRegister: false, scope: env.base,
    manifest: {name: env.name, short_name: env.name, lang: 'nb', id: './', start_url: './', scope: './',
      display: 'standalone', theme_color: '#171b20', background_color: '#171b20',
      icons: [{src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
        {src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'}]},
    workbox: {cacheId: env.namespace, cleanupOutdatedCaches: false, clientsClaim: true, skipWaiting: false,
      globPatterns: ['**/*.{html,js,css,png,json,webmanifest}'],
      navigateFallback: 'index.html', navigateFallbackAllowlist: [new RegExp(`^${env.base}`)],
    },
  })],
});
