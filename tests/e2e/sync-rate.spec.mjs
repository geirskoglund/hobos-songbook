import {test, expect} from './fixtures.mjs';
import {dropboxMock} from './dropbox-mock.mjs';
import {openMenu, importAndOpenSong, goSongs, savedSongs, importListChecked} from './song-helpers.mjs';
import {stubClipboard, copiedText} from './clipboard-stub.mjs';
test.use({serviceWorkers: 'block'});
const url = '/hobos-songbook/test/';
async function syncPage(page) {
  await openMenu(page);
  await page.locator('#main-menu').getByRole('button', {name: 'Synkronisering', exact: true}).click();
  await importListChecked(page);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
}
async function setup(page, context, song = true) {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  if (song) {
    await importAndOpenSong(page, 'sang.cho', '{t: Lokal}\nTekst');
    await goSongs(page);
    await expect.poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length).toBe(1);
  }
  await syncPage(page);
  return mock;
}
async function state(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('hobos-songbook-test');
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(['songs', 'personal', 'sync']),
            out = {};
          for (const name of ['songs', 'personal', 'sync']) {
            const q = tx.objectStore(name).getAll();
            q.onsuccess = () => (out[name] = q.result);
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
}
async function seed(page, count) {
  await page.evaluate(
    count =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('hobos-songbook-test');
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(['songs', 'personal', 'sync'], 'readwrite'),
            read = tx.objectStore('sync').get('private-local-v1');
          read.onsuccess = () => {
            const journal = read.result ?? {
              id: 'private-local-v1',
              version: 1,
              generation: 0,
              deletedBooks: {},
              sessions: {},
            };
            journal.generation++;
            tx.objectStore('sync').put(journal);
          };
          for (let i = 0; i < count; i++) {
            const id = 'rate-' + i;
            tx.objectStore('songs').put({
              id,
              songbookId: 'standard',
              original: '{t: Sang ' + i + '}\nTekst',
              title: 'Sang ' + i,
              key: null,
              origin: {kind: 'local', filename: id + '.cho', importedAt: '2026-11-16'},
            });
            tx.objectStore('personal').put({songId: id, version: 3, chorus: {}, capo: i % 6});
          }
          tx.oncomplete = () => {
            db.close();
            document.dispatchEvent(new Event('library-local-change'));
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    count,
  );
}
test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});
test('bulk automatic upload recovers from simulated HTTP 429 with serial namespace commits', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context, false);
  mock.latency(30);
  mock.limitConcurrentWrites();
  mock.fault('/finish_batch_v2', 429, 0, {repeat: 2});
  await seed(page, 20);
  await expect
    .poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length, {timeout: 15000})
    .toBe(20);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  expect(mock.throttled()).toBeGreaterThan(0);
  expect([...mock.entries.values()].filter(e => e.path_display.endsWith('.cho'))).toHaveLength(20);
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  const local = await state(page);
  expect(local.songs).toHaveLength(20);
  for (let i = 0; i < 20; i++)
    expect(JSON.parse(mock.find('/.app/songs/rate-' + i + '.json').text).data.capo).toBe(i % 6);
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
});
test('persistent 429 produces a bounded error with safe rate details; elapsed cooldown does not schedule background sync', async ({
  page,
  context,
}) => {
  await stubClipboard(page);
  const mock = await setup(page, context);
  const sync = page.locator('#dropbox-sync'),
    status = page.locator('#sync-status');
  const fencePath = '/.app/mutation.json',
    releases = [];
  await context.route('https://content.dropboxapi.com/2/files/upload', async route => {
    const request = route.request(),
      args = JSON.parse(request.headers()['dropbox-api-arg']);
    if (args.path === fencePath && request.postDataJSON().owner === null) {
      releases.push({time: Date.now(), revision: mock.find(fencePath).rev});
    }
    await route.fallback();
  });
  mock.fault('/list_folder/continue', 429, 0, {repeat: 3});
  const start = mock.calls.length;
  await sync.click();
  const failure = 'Synkronisering feilet (Feilkode SYNC-007)';
  await expect(status).toHaveText(failure);
  const log = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1'));
    return saved.entries.find(entry => entry.id === saved.active);
  });
  expect(log.failure.limitReason).toBe('too_many_write_operations');
  expect(log.failure.retryAfterMs).toBeGreaterThanOrEqual(1000);
  expect(log.operations.filter(event => event.status === 429).map(event => event.retryAttempt)).toEqual([0, 1, 2]);
  const copy = page.getByRole('button', {name: 'Kopier feillogg', exact: true});
  await copy.click();
  const copied = await copiedText(page);
  expect(JSON.parse(copied.split('\n\n')[1]).failure.limitReason).toBe('too_many_write_operations');
  for (const forbidden of ['fixture-access', 'fixture-refresh', 'dbid:fixture', '@eksempel.no', 'error_summary'])
    expect(copied).not.toContain(forbidden);
  await expect(status).toHaveText(failure);
  for (const width of [320, 800]) {
    await page.setViewportSize({width, height: 1202});
    const dimensions = await copy.evaluate(node => {
      const r = node.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        icon: node.querySelector('svg').getBoundingClientRect().width,
        underline: getComputedStyle(node.closest('p')).textDecorationLine,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(dimensions).toEqual({width: 44, height: 44, icon: 20, underline: 'none', overflow: false});
  }
  // The error text can be shown while the original run waits to release its fence.
  await expect(sync).toBeEnabled({timeout: 8000});
  const stopped = mock.calls.length;
  await page.waitForTimeout(4100);
  expect(mock.calls).toHaveLength(stopped);
  const calls = mock.calls.slice(start);
  expect(calls.filter(call => call.endpoint.endsWith('/list_folder/continue'))).toHaveLength(3);
  expect(releases).toHaveLength(1);
  const [{time, revision}] = releases;
  const until = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hobos-songbook-test:dropbox-rate-v1')).until,
  );
  expect(time).toBeGreaterThanOrEqual(until);
  const afterLastAttempt = calls.slice(
    calls.findLastIndex(call => call.endpoint.endsWith('/list_folder/continue')) + 1,
  );
  expect(afterLastAttempt).toEqual([
    {
      endpoint: '/2/files/upload',
      args: expect.objectContaining({path: fencePath, mode: {'.tag': 'update', update: revision}}),
    },
  ]);
  expect(JSON.parse(mock.find(fencePath).text).owner).toBe(null);
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  await sync.click();
  await expect(status).toContainText('Sist synkronisert:');
  expect(await savedSongs(page)).toHaveLength(1);
});
test('opening a song cancels a pending retry; an explicit manual request resumes only after actual exit', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context),
    song = (await savedSongs(page))[0],
    link = JSON.parse(mock.find('/.app/library.json').text).songs[song.id];
  mock.put(link.path, '{t: Fra Dropbox}\nNy tekst');
  mock.fault('/download', 429, 0, {retryAfter: 1, path: link.fileId});
  await page.locator('#dropbox-sync').click();
  await expect.poll(() => mock.throttled()).toBe(1);
  await goSongs(page);
  await page.locator('#song-list .row-choice').click();
  await expect(page.locator('#song-title')).toHaveText('Lokal');
  const start = mock.calls.length;
  await page.waitForTimeout(1100);
  expect(mock.calls.slice(start).filter(c => c.endpoint.endsWith('/download'))).toHaveLength(0);
  await expect(page.locator('#song-title')).toHaveText('Lokal');
  await goSongs(page);
  await expect.poll(async () => (await savedSongs(page))[0].title).toBe('Fra Dropbox');
  await syncPage(page);
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
});
test('long cooldown survives restart without new file requests, and disconnect remains immediately available', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context);
  mock.fault('/list_folder/continue', 429, 0, {retryAfter: 60, reason: 'too_many_requests'});
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-007');
  await page.reload();
  await syncPage(page);
  const start = mock.calls.length;
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-007');
  expect(mock.calls.length).toBe(start);
  await page.locator('#dropbox-disconnect').click();
  await page
    .getByRole('dialog', {name: 'Koble fra Dropbox', exact: true})
    .getByRole('button', {name: 'Koble fra', exact: true})
    .click();
  await expect(page.locator('#dropbox-connect')).toBeVisible();
  expect(mock.calls.slice(start).map(c => c.endpoint)).toEqual(['/2/auth/token/revoke']);
  expect(await savedSongs(page)).toHaveLength(1);
});
test('new local generation cancels the queued retry and restarts from the newest saved data', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context),
    song = (await savedSongs(page))[0],
    link = JSON.parse(mock.find('/.app/library.json').text).songs[song.id];
  mock.put(link.path, '{t: Ny versjon}\nNy tekst');
  mock.fault('/download', 429, 0, {retryAfter: 1, path: link.fileId});
  const start = mock.calls.length;
  await page.locator('#dropbox-sync').click();
  await expect.poll(() => mock.throttled()).toBe(1);
  await page.evaluate(
    id =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('hobos-songbook-test');
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(['personal', 'sync'], 'readwrite'),
            p = tx.objectStore('personal').get(id),
            j = tx.objectStore('sync').get('private-local-v1');
          p.onsuccess = () =>
            tx
              .objectStore('personal')
              .put({...p.result, songId: id, version: 3, chorus: p.result?.chorus ?? {}, capo: 5});
          j.onsuccess = () => tx.objectStore('sync').put({...j.result, generation: j.result.generation + 1});
          tx.oncomplete = () => {
            db.close();
            document.dispatchEvent(new Event('library-local-change'));
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    song.id,
  );
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  const current = await state(page);
  expect(current.personal.find(p => p.songId === song.id).capo).toBe(5);
  expect(current.songs[0].title).toBe('Ny versjon');
  expect(JSON.parse(mock.find('/.app/songs/' + song.id + '.json').text).data.capo).toBe(5);
  expect(
    mock.calls.slice(start).filter(c => c.endpoint.endsWith('/download') && c.args.path === link.fileId),
  ).toHaveLength(2);
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
});
