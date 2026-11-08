import {test, expect} from '@playwright/test';
import {importSong, savedSongs, original, openMenu, closeMenu, setDisplay} from './song-helpers.mjs';

const base = '/hobos-songbook/';
const ready = page => expect(page.locator('#offline-status')).toHaveAttribute('data-ready', 'true');
async function metadata(page) {return page.evaluate(async () => (await fetch('./build-info.json')).json());}
async function mark(page, value) {
  return page.evaluate(async value => {
    const info = await (await fetch('./build-info.json')).json();
    localStorage.setItem(`${info.namespace}:probe`, value);
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(`${info.namespace}-harness`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('harness');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('harness', 'readwrite');
        transaction.objectStore('harness').put(value, 'probe');
        transaction.oncomplete = () => {db.close(); resolve();};
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, value);
}
async function markers(page) {
  return page.evaluate(async () => {
    const info = await (await fetch('./build-info.json')).json();
    const value = await new Promise((resolve, reject) => {
      const request = indexedDB.open(`${info.namespace}-harness`, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, result = db.transaction('harness').objectStore('harness').get('probe');
        result.onsuccess = () => {db.close(); resolve(result.result);};
      };
    });
    return {local: localStorage.getItem(`${info.namespace}:probe`), database: value};
  });
}
test.beforeEach(async ({request}) => {await request.post('/__test__/reset');});

test('mobile, tablet and desktop show real environment, local resources and separate install identities', async ({page, request}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[320, 568], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({width, height});
    for (const channel of ['app', 'test']) {
      await page.goto(`${base}${channel}/`); await ready(page);
      await expect(page.getByRole('heading', {level: 1})).toHaveText("Hobo's Songbook");
      await expect(page.locator('.environment')).toHaveText(channel === 'test' ? 'Testversjon' : 'Produksjon');
      await expect(page.locator('.build')).toContainText(channel === 'test' ? 'PR #7' : 'master');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const manifest = await (await request.get(`${base}${channel}/manifest.webmanifest`)).json();
      expect(manifest.name).toBe(channel === 'test' ? "Hobo's Songbook Test" : "Hobo's Songbook");
      for (const key of ['id', 'start_url', 'scope']) expect(new URL(manifest[key], page.url()).pathname).toBe(`${base}${channel}/`);
      expect(manifest.display).toBe('standalone');
      const info = await metadata(page); expect(info.channel).toBe(channel === 'test' ? 'test' : 'production');
      expect(info.sha).toBe((channel === 'test' ? 'b' : 'a').repeat(40));
      expect(await page.evaluate(async () => {
        const image = new Image(); image.src = './icon-512.png'; await image.decode(); return [image.naturalWidth, image.naturalHeight];
      })).toEqual([512, 512]);
      expect(await page.evaluate(() => performance.getEntriesByType('resource').every(resource => new URL(resource.name).origin === location.origin))).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('both real workers reopen offline; PR changes and updates preserve both data namespaces and unrelated cache', async ({context, request}) => {
  let production = await context.newPage(), preview = await context.newPage();
  await production.goto(`${base}app/`); await preview.goto(`${base}test/`);
  await ready(production); await ready(preview);
  await production.reload(); await preview.reload();
  await importSong(production, 'prod.cho', original.replace('Samme tittel', 'Produksjonssang'));
  await importSong(preview, 'test.cho');
  await preview.getByRole('button', {name: 'Refreng', exact: true}).nth(1).click();
  await expect(preview.getByRole('button', {name: 'Refreng', exact: true}).nth(1)).toHaveAttribute('aria-expanded', 'true');
  await setDisplay(preview, {theme:'light'});
  await setDisplay(preview, {fontSize:'30'});
  const productionSongs = await savedSongs(production), previewSongs = await savedSongs(preview);
  expect(productionSongs[0].id).not.toBe(previewSongs[0].id);
  await mark(production, 'production-marker'); await mark(preview, 'test-marker');
  await production.evaluate(async () => {const cache = await caches.open('unrelated-project'); await cache.put('/control', new Response('keep'));});
  const scopes = await production.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(reg => new URL(reg.scope).pathname).sort());
  expect(scopes).toEqual([`${base}app/`, `${base}test/`]);
  expect(await preview.evaluate(() => new URL(navigator.serviceWorker.controller.scriptURL).pathname)).toBe(`${base}test/sw.js`);
  await production.close(); await preview.close();
  await context.setOffline(true);
  production = await context.newPage(); preview = await context.newPage();
  await production.goto(`${base}app/`); await preview.goto(`${base}test/`);
  await expect(production.locator('h1')).toBeVisible(); await expect(preview.locator('h1')).toBeVisible();
  await expect(preview.locator('#connection')).toHaveText('Uten nett');
  expect(await savedSongs(production)).toEqual(productionSongs);
  expect(await savedSongs(preview)).toEqual(previewSongs);
  expect(await markers(production)).toEqual({local: 'production-marker', database: 'production-marker'});
  expect(await markers(preview)).toEqual({local: 'test-marker', database: 'test-marker'});
  await context.setOffline(false);
  for (const [channel, page, expectedSha] of [['test', preview, 'c'], ['app', production, 'd']]) {
    await request.post(`/__test__/update?channel=${channel}`);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await openMenu(page);
    await expect(page.getByRole('button', {name: 'Oppdater appen'})).toBeVisible();
    await openMenu(page);
    await page.getByRole('button', {name: 'Oppdater appen'}).click();
    await expect(page.locator('.build')).toContainText(expectedSha.repeat(7));
    await ready(page);
    expect(await savedSongs(production)).toEqual(productionSongs);
    expect(await savedSongs(preview)).toEqual(previewSongs);
    expect(await markers(production)).toEqual({local: 'production-marker', database: 'production-marker'});
    expect(await markers(preview)).toEqual({local: 'test-marker', database: 'test-marker'});
    expect(await page.evaluate(async () => (await caches.match('/control', {cacheName: 'unrelated-project'})).text())).toBe('keep');
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames.some(name => name.startsWith('hobos-songbook-production-'))).toBe(true);
    expect(cacheNames.some(name => name.startsWith('hobos-songbook-test-'))).toBe(true);
  }
  await expect(preview.locator('.build')).toContainText('PR #8');
  await production.close(); await preview.close(); await context.setOffline(true);
  production = await context.newPage(); preview = await context.newPage();
  await production.goto(`${base}app/`); await preview.goto(`${base}test/`);
  await expect(production.locator('.build')).toContainText('ddddddd');
  await expect(preview.locator('.build')).toContainText('ccccccc');
  expect(await savedSongs(production)).toEqual(productionSongs);
  expect(await savedSongs(preview)).toEqual(previewSongs);
  expect(await markers(production)).toEqual({local: 'production-marker', database: 'production-marker'});
  expect(await markers(preview)).toEqual({local: 'test-marker', database: 'test-marker'});
  await expect(production.locator('#theme')).toHaveValue('dark');
  await expect(preview.locator('#theme')).toHaveValue('light');
  await expect(preview.locator('#font-size')).toHaveValue('30');
  await preview.getByRole('button', {name: /Samme tittel/}).click();
  await expect(preview.getByRole('button', {name: 'Refreng', exact: true}).nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(preview.getByRole('button', {name: 'Refreng', exact: true}).nth(1)).toHaveAttribute('aria-expanded', 'true');
});

test('failed worker registration gives a truthful status and leaves the shell readable', async ({browser}) => {
  const context = await browser.newContext({serviceWorkers: 'block'}), page = await context.newPage();
  await page.goto(`http://127.0.0.1:4173${base}test/`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('#offline-status')).toContainText('kunne ikke fullføres');
  await expect(page.locator('#offline-status')).not.toHaveAttribute('data-ready', 'true');
  await context.close();
});
