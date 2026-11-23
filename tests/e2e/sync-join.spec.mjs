import {test, expect} from './fixtures.mjs';
import {createHash} from 'node:crypto';
import {mkdir, appendFile} from 'node:fs/promises';
import {dropboxMock} from './dropbox-mock.mjs';
import {openMenu, goSongs, savedSongs} from './song-helpers.mjs';
test.use({serviceWorkers: 'block'});
const url = '/hobos-songbook/test/',
  original = '{t: Samme sang}\n[C]Tekst';
const person = (id, capo) => ({
  songId: id,
  version: 3,
  chorus: {},
  capo,
  annotations: {
    'source/line:1': {
      anchor: {songId: id, sourceLine: 1, occurrence: 'source/line:1'},
      highlights: [{start: 0, end: 3}],
    },
  },
});
async function state(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('hobos-songbook-test');
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(['songs', 'personal', 'songbooks', 'sync', 'setlists']),
            out = {};
          for (const name of ['songs', 'personal', 'songbooks', 'sync', 'setlists']) {
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
async function syncPage(page) {
  await openMenu(page);
  await page.locator('#main-menu').getByRole('button', {name: 'Synkronisering', exact: true}).click();
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
}
async function quality(page, kind) {
  await mkdir('work/error024/quality', {recursive: true});
  for (const [width, height] of [
    [320, 420],
    [393, 800],
    [768, 800],
    [1440, 800],
  ]) {
    await page.setViewportSize({width, height});
    const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
    await expect(dialog).toBeInViewport();
    const data = await dialog.evaluate(node => {
      const s = getComputedStyle(node);
      return {
        radius: s.borderRadius,
        padding: s.padding,
        actions: [...node.querySelectorAll('footer button')].map(b => ({
          font: getComputedStyle(b).fontSize,
          height: b.getBoundingClientRect().height,
        })),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(data.radius).toBe('24px');
    expect(data.padding).toBe('32px 32px 0px');
    expect(data.overflow).toBe(false);
    for (const action of data.actions) {
      expect(action.font).toBe('18px');
      expect(action.height).toBeGreaterThanOrEqual(80);
    }
    for (const button of await dialog.locator('footer button').all()) await expect(button).toBeInViewport();
    await appendFile('work/error024/quality/measurements.jsonl', JSON.stringify({kind, width, height, ...data}) + '\n');
    await page.screenshot({path: `work/error024/quality/${kind}-${width}.png`});
  }
}
async function prepare(page, context, {text = original, capo = 2} = {}) {
  const mock = await dropboxMock(context, {connected: false});
  for (const path of ['/.app', '/.app/songs', '/Songbooks', '/Songbooks/Hobos', '/Songbooks/Standard'])
    mock.put(path, '', true);
  for (const book of ['Hobos', 'Standard'])
    for (const kind of ['Private', 'Shared', 'Import', 'Originals']) mock.put(`/Songbooks/${book}/${kind}`, '', true);
  const file = mock.put('/Songbooks/Hobos/Private/sang--existing.cho', original),
    manifest = {
      version: 1,
      books: {
        'cloud-hobos': {
          id: 'cloud-hobos',
          name: 'Hobos',
          path: '/Songbooks/Hobos',
          folderId: mock.find('/Songbooks/Hobos').id,
        },
        standard: {
          id: 'standard',
          name: 'Standard',
          path: '/Songbooks/Standard',
          folderId: mock.find('/Songbooks/Standard').id,
        },
      },
      songs: {
        'cloud-song': {
          id: 'cloud-song',
          songbookId: 'cloud-hobos',
          fileId: file.id,
          path: file.path_display,
          origin: {kind: 'local', filename: 'sang.cho', importedAt: '2026-01-01'},
        },
      },
    };
  mock.put(
    '/.app/songs/cloud-song.json',
    JSON.stringify({
      version: 1,
      songId: 'cloud-song',
      original: {rev: file.rev, hash: createHash('sha256').update(original).digest('hex')},
      data: person('cloud-song', 2),
    }),
  );
  mock.put('/.app/library.json', JSON.stringify(manifest));
  await page.goto(url);
  await expect(page.locator('#add-song')).toBeEnabled();
  await page.evaluate(
    ({text, capo, personal}) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('hobos-songbook-test');
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(['songs', 'personal', 'songbooks', 'sync', 'setlists'], 'readwrite');
          for (const name of ['songs', 'personal', 'songbooks', 'sync', 'setlists']) tx.objectStore(name).clear();
          for (const book of [
            {id: 'local-hobos', name: 'Hobos'},
            {id: 'local-sapiens', name: 'Hobo Sapiens'},
            {id: 'standard', name: 'Generell'},
          ])
            tx.objectStore('songbooks').put(book);
          tx.objectStore('songs').put({
            id: 'local-song',
            songbookId: 'local-hobos',
            original: text,
            title: 'Samme sang',
            key: null,
            origin: {kind: 'local', filename: 'sang.cho', importedAt: '2026-11-16'},
          });
          tx.objectStore('personal').put(personal);
          tx.objectStore('sync').put({
            id: 'private-local-v1',
            version: 1,
            generation: 1,
            deletedBooks: {},
            sessions: {},
          });
          tx.objectStore('setlists').put({id: 'local-setlist', name: 'Sett', createdAt: 1, songIds: ['local-song']});
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    {text, capo, personal: person('local-song', capo)},
  );
  await context.addInitScript(() =>
    localStorage.setItem(
      'hobos-songbook-test:dropbox-auth-v1',
      JSON.stringify({
        version: 1,
        accountId: 'dbid:fixture',
        name: 'Prøvebruker',
        email: 'bruker@eksempel.no',
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        expires: Date.now() + 3600000,
      }),
    ),
  );
  await page.reload();
  await syncPage(page);
  return {mock, manifest};
}
test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});
test('F64/F65: independently used local library joins common books and identical songs without duplicates or ID changes', async ({
  page,
  context,
}) => {
  const {mock} = await prepare(page, context);
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const data = await state(page);
  expect(data.songbooks.map(b => b.name).sort()).toEqual(['Generell', 'Hobo Sapiens', 'Hobos', 'Standard']);
  expect(data.songbooks.find(b => b.name === 'Hobos').id).toBe('local-hobos');
  expect(data.songbooks.find(b => b.name === 'Generell').id).toBe('standard');
  expect(data.songs.map(s => [s.id, s.songbookId])).toEqual([['local-song', 'local-hobos']]);
  expect(data.personal[0].annotations['source/line:1'].anchor.songId).toBe('local-song');
  expect(data.setlists[0].songIds).toEqual(['local-song']);
  expect(Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs)).toEqual(['cloud-song']);
  expect([...mock.entries.values()].filter(e => e.path_display.endsWith('.cho'))).toHaveLength(1);
  expect(mock.find('/Songbooks/Hobo Sapiens')).toBeTruthy();
  expect(mock.find('/Songbooks/Generell')).toBeTruthy();
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  await page.reload();
  await syncPage(page);
  const start = mock.calls.length;
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  expect(mock.calls.slice(start).map(c => c.endpoint)).toEqual(['/2/files/list_folder/continue']);
  expect((await state(page)).songs[0].id).toBe('local-song');
});
test('F65: matched first-sync song uses E04/E03, defers across restart and retains local references', async ({
  page,
  context,
}) => {
  const local = '{t: Lokal versjon}\nAnnen tekst',
    {mock} = await prepare(page, context, {text: local, capo: 7});
  await page.locator('#dropbox-sync').click();
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await expect(dialog.locator('button')).toHaveText(['Lokal versjon', 'Dropbox', 'Opprett ny fil']);
  await expect(dialog.locator('h2')).toBeFocused();
  await quality(page, 'E04');
  await page.keyboard.press('Escape');
  expect([...mock.entries.values()].filter(e => e.path_display.endsWith('.cho'))).toHaveLength(1);
  await page.reload();
  await syncPage(page);
  await page.locator('#dropbox-sync').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Lokal versjon', exact: true}).click();
  await expect(dialog.locator('button')).toHaveText(['Lokal versjon', 'Dropbox']);
  await quality(page, 'E03');
  await dialog.getByRole('button', {name: 'Dropbox', exact: true}).click();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  const data = await state(page);
  expect(data.songs.map(s => s.id)).toEqual(['local-song']);
  expect(data.songs[0].original).toBe(local);
  expect(data.personal[0].capo).toBe(2);
  expect(data.setlists[0].songIds).toEqual(['local-song']);
  expect(mock.find('/Songbooks/Hobos/Private/sang--existing.cho').text).toBe(local);
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
});
test('F65/F28: explicit first-sync copy creates one additional song through the existing E04 action', async ({
  page,
  context,
}) => {
  const local = '{t: Lokal versjon}\nAnnen tekst',
    {mock} = await prepare(page, context, {text: local});
  await page.locator('#dropbox-sync').click();
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await dialog.getByRole('button', {name: 'Opprett ny fil', exact: true}).click();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  const data = await state(page);
  expect(data.songs).toHaveLength(2);
  expect(data.songs.find(s => s.id === 'local-song').original).toBe(original);
  expect(data.songs.find(s => s.id !== 'local-song').original).toBe(local);
  expect(data.songs.every(s => s.songbookId === 'local-hobos')).toBe(true);
  expect(data.setlists[0].songIds).toEqual(['local-song']);
  expect([...mock.entries.values()].filter(e => e.path_display.endsWith('.cho'))).toHaveLength(2);
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  expect(await savedSongs(page)).toHaveLength(2);
});

test('E04: programmatic heading focus has no browser outline after keyboard activation', async ({page, context}) => {
  await prepare(page, context, {text: '{t: Local}\nChanged', capo: 7});
  await page.keyboard.press('Tab');
  await page.locator('#dropbox-sync').focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true}).locator('h2');
  await expect(heading).toBeFocused();
  await expect(heading).toHaveCSS('outline-style', 'none');
  await expect(heading).toHaveCSS('font-size', '26px');
  await page.keyboard.press('Escape');
  await expect(heading).toHaveCount(0);
});
