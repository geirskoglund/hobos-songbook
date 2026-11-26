import {test, expect} from './fixtures.mjs';
import {appendFile, mkdir} from 'node:fs/promises';
import {dropboxMock} from './dropbox-mock.mjs';
import {openMenu, importAndOpenSong, goSongs, savedSongs, tool, fillValue, setCapo} from './song-helpers.mjs';
test.use({serviceWorkers: 'block'});
const url = '/hobos-songbook/test/';
async function syncPage(page) {
  await openMenu(page);
  await page.locator('#main-menu').getByRole('button', {name: 'Synkronisering', exact: true}).click();
  await expect(page.locator('#sync')).toBeVisible();
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
}
async function state(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('hobos-songbook-test');
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(['songs', 'personal', 'songbooks', 'sync']),
            out = {};
          for (const name of ['songs', 'personal', 'songbooks', 'sync']) {
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
const account = data => data.sync.find(s => s.id.startsWith('private-account-v1:'));
async function setup(page, context, titles = ['Alpha'], options) {
  const mock = await dropboxMock(context, options);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  for (const [i, title] of titles.entries()) {
    await importAndOpenSong(page, title + '.cho', '{t: ' + title + '}\nText');
    await goSongs(page);
    await expect
      .poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{}}').songs).length)
      .toBe(i + 1);
  }
  await syncPage(page);
  return mock;
}
async function editTitle(page, title, next) {
  await goSongs(page);
  await page.locator('#song-list .song-choice').filter({hasText: title}).click();
  await tool(page, 'Tittel');
  await fillValue(page, 'Tittel', next);
  await goSongs(page);
}
async function synchronize(page) {
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
}
/** Waits until automatic sync has taken up every local change; an enabled button alone can precede the run. */
async function synced(page) {
  await expect
    .poll(async () => {
      const data = await state(page),
        journal = data.sync.find(s => s.id === 'private-local-v1');
      return account(data)?.localGeneration === journal?.generation && !account(data).pending;
    })
    .toBe(true);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
}
async function mutate(page, changes, notify = true) {
  await page.evaluate(
    ({personal, originals, seed, notify}) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('hobos-songbook-test');
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(['songs', 'personal', 'songbooks', 'sync'], 'readwrite'),
            journal = tx.objectStore('sync').get('private-local-v1');
          journal.onsuccess = () => {
            const j = journal.result ?? {
              id: 'private-local-v1',
              version: 1,
              generation: 0,
              deletedBooks: {},
              sessions: {},
            };
            j.generation++;
            tx.objectStore('sync').put(j);
          };
          if (seed)
            for (let i = 0; i < seed; i++) {
              const id = 'bulk-' + i;
              tx.objectStore('songs').put({
                id,
                songbookId: 'standard',
                original: '{t: Bulk ' + i + '}\nText',
                title: 'Bulk ' + i,
                key: null,
                origin: {kind: 'local', filename: id + '.cho', importedAt: '2026-11-16'},
              });
              tx.objectStore('personal').put({songId: id, version: 3, chorus: {}});
            }
          if (personal)
            for (const [id, capo] of Object.entries(personal)) {
              const q = tx.objectStore('personal').get(id);
              q.onsuccess = () =>
                tx
                  .objectStore('personal')
                  .put({...q.result, songId: id, version: 3, chorus: q.result?.chorus ?? {}, capo});
            }
          if (originals)
            for (const id of originals) {
              const q = tx.objectStore('songs').get(id);
              q.onsuccess = () => tx.objectStore('songs').put({...q.result, original: q.result.original + '\nChanged'});
            }
          tx.oncomplete = () => {
            db.close();
            if (notify) document.dispatchEvent(new Event('library-local-change'));
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    {...changes, notify},
  );
}
test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});

test('F25/F39: only agreed status states and offline disables the action', async ({page, context}) => {
  const mock = await setup(page, context);
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
  const release = mock.hold('/list_folder/continue');
  try {
    await page.locator('#dropbox-sync').click();
    await expect(page.locator('#sync-status')).toHaveText('Synkroniserer…');
    await expect(page.locator('#dropbox-sync')).toBeDisabled();
    await expect(page.locator('#dropbox-sync svg')).toHaveCSS('animation-name', 'sync-rotation');
    await expect(page.locator('#header-sync')).toHaveCSS('opacity', '0.65');
  } finally {
    release();
  }
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  await expect(page.locator('#dropbox-sync svg')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  const before = await page.locator('#sync-status').textContent();
  await context.setOffline(true);
  await expect(page.locator('#dropbox-sync')).toBeDisabled();
  await expect(page.locator('#sync-status')).toHaveText(before);
  await context.setOffline(false);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  await expect(page.locator('#sync-status')).toHaveText(before);
});
test('F60: actual adapter with 100 songs, delayed responses and bounded parallel transfers', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context, []);
  await mutate(page, {seed: 100});
  await expect
    .poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{}}').songs).length, {
      timeout: 30000,
    })
    .toBe(100);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  const measured = [];
  mock.latency(150);
  let start = mock.calls.length,
    time = Date.now();
  await synchronize(page);
  let calls = mock.calls.slice(start);
  expect(calls.map(c => c.endpoint)).toEqual(['/2/files/list_folder/continue']);
  measured.push({case: '100 unchanged', calls: calls.length, elapsedMs: Date.now() - time, latencyMs: 150});
  start = mock.calls.length;
  time = Date.now();
  await mutate(page, {personal: {'bulk-37': 4}});
  await synced(page);
  calls = mock.calls.slice(start);
  expect(
    calls.filter(c => !['/.app/mutation.json', '/.app/library.json'].includes(c.args?.path)).map(c => c.endpoint),
  ).toEqual(['/2/files/list_folder/continue', '/2/files/upload']);
  expect(calls.find(c => c.endpoint.endsWith('/upload') && c.args.path !== '/.app/mutation.json').args.path).toBe(
    '/.app/songs/bulk-37.json',
  );
  measured.push({
    case: 'one personal change among 100',
    calls: calls.length,
    elapsedMs: Date.now() - time,
    latencyMs: 150,
  });
  mock.latency(50);
  start = mock.calls.length;
  time = Date.now();
  await mutate(page, {originals: Array.from({length: 20}, (_, i) => 'bulk-' + i)});
  await synced(page);
  calls = mock.calls.slice(start);
  expect(
    calls.filter(
      c => c.endpoint.endsWith('/download') && !['/.app/mutation.json', '/.app/library.json'].includes(c.args.path),
    ),
  ).toHaveLength(0);
  expect(calls.filter(c => c.endpoint.endsWith('/upload') && c.args.path !== '/.app/mutation.json')).toHaveLength(0);
  expect(calls.filter(c => c.endpoint.endsWith('/upload_session/start'))).toHaveLength(0);
  const starts = calls.filter(c => c.endpoint.endsWith('/start_batch')),
    appends = calls.filter(c => c.endpoint.endsWith('/append_batch')),
    batches = calls.filter(c => c.endpoint.endsWith('/finish_batch_v2'));
  expect(starts.map(c => c.args.num_sessions)).toEqual([20, 20]);
  expect(appends.map(c => c.args.entries.length)).toEqual([20, 20]);
  expect(batches.map(c => c.args.entries.length)).toEqual([20, 20]);
  expect(mock.maximum()).toBeLessThanOrEqual(4);
  measured.push({
    case: '20 originals changed among 100',
    calls: calls.length,
    sessionCalls: starts.length + appends.length,
    namespaceCommits: batches.length,
    elapsedMs: Date.now() - time,
    latencyMs: 50,
    maxConcurrent: mock.maximum(),
  });
  await mkdir('work/effective-sync', {recursive: true});
  await appendFile('work/effective-sync/performance.jsonl', JSON.stringify(measured) + '\n');
  console.log(JSON.stringify(measured));
});
test('F60: a local change right after a manual sync is synchronized automatically', async ({page, context}) => {
  const mock = await setup(page, context),
    song = (await savedSongs(page))[0];
  await synchronize(page);
  const start = mock.calls.length;
  // Change the library in the same moment the button returns, while the controller checks for conflicts.
  await page.evaluate(
    songId =>
      new Promise((resolve, reject) => {
        const button = document.getElementById('dropbox-sync');
        const observer = new MutationObserver(() => {
          if (button.disabled) return;
          observer.disconnect();
          const r = indexedDB.open('hobos-songbook-test');
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction(['personal', 'sync'], 'readwrite');
            tx.objectStore('sync').get('private-local-v1').onsuccess = event => {
              const journal = event.target.result ?? {
                id: 'private-local-v1',
                version: 1,
                generation: 0,
                deletedBooks: {},
                sessions: {},
              };
              journal.generation++;
              tx.objectStore('sync').put(journal);
            };
            tx.objectStore('personal').get(songId).onsuccess = event =>
              tx.objectStore('personal').put({songId, version: 3, chorus: {}, ...event.target.result, capo: 7});
            tx.oncomplete = () => {
              db.close();
              document.dispatchEvent(new Event('library-local-change'));
              resolve();
            };
            tx.onabort = () => reject(tx.error);
          };
        });
        observer.observe(button, {attributes: true, attributeFilter: ['disabled']});
        button.click();
      }),
    song.id,
  );
  await expect
    .poll(() => mock.calls.slice(start).some(c => c.endpoint.endsWith('/upload') && c.args.path.includes(song.id)))
    .toBe(true);
  await expect.poll(async () => account(await state(page)).pending).toBe(false);
});
test('F21/F31: an automatic conflict choice never imports another changed song or updates manual time', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context, ['Alpha', 'Beta']),
    songs = await savedSongs(page),
    a = songs.find(s => s.title === 'Alpha'),
    b = songs.find(s => s.title === 'Beta'),
    manifest = JSON.parse(mock.find('/.app/library.json').text);
  mock.put(manifest.songs[a.id].path, '{t: Remote Alpha}\nText');
  mock.put(manifest.songs[b.id].path, '{t: Remote Beta}\nText');
  await editTitle(page, 'Alpha', 'Local Alpha');
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Lokal versjon', exact: true}).click();
  await expect.poll(() => mock.find(manifest.songs[a.id].path).text).toContain('Local Alpha');
  await expect.poll(async () => account(await state(page)).conflicts.length).toBe(0);
  expect((await savedSongs(page)).find(s => s.id === b.id).title).toBe('Beta');
  expect(account(await state(page)).lastManual).toBeUndefined();
  await syncPage(page);
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
});
test('F26: postponing an existing conflict allows independent manual downloads', async ({page, context}) => {
  const mock = await setup(page, context, ['Alpha', 'Beta']),
    songs = await savedSongs(page),
    a = songs.find(s => s.title === 'Alpha'),
    b = songs.find(s => s.title === 'Beta'),
    manifest = JSON.parse(mock.find('/.app/library.json').text);
  mock.put(manifest.songs[a.id].path, '{t: Remote Alpha}\nText');
  await editTitle(page, 'Alpha', 'Local Alpha');
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  mock.put(manifest.songs[b.id].path, '{t: Remote Beta}\nText');
  await syncPage(page);
  await page.locator('#dropbox-sync').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await savedSongs(page)).find(s => s.id === b.id).title).toBe('Remote Beta');
  expect(account(await state(page)).conflicts).toHaveLength(1);
  expect(account(await state(page)).lastManual).toBeUndefined();
});
test('F25/F28: manual copy completion advances the manual timestamp after the copy is uploaded', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context);
  await synchronize(page);
  const before = account(await state(page)).lastManual,
    song = (await savedSongs(page))[0],
    manifest = JSON.parse(mock.find('/.app/library.json').text);
  mock.put(manifest.songs[song.id].path, '{t: Remote Alpha}\nText');
  await editTitle(page, 'Alpha', 'Local Alpha');
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await syncPage(page);
  await page.locator('#dropbox-sync').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Opprett ny fil', exact: true}).click();
  await expect.poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length).toBe(2);
  await expect.poll(async () => account(await state(page)).pending).toBe(false);
  await expect.poll(async () => account(await state(page)).lastManual).not.toBe(before);
  expect((await savedSongs(page)).map(s => s.title).sort()).toEqual(['Local Alpha', 'Remote Alpha']);
});
test('F56/F58: deleted file wins over dirty data and a second older device, without backup or resurrection', async ({
  page,
  context,
  browser,
}) => {
  const mock = await setup(page, context),
    before = await state(page),
    song = before.songs[0],
    path = JSON.parse(mock.find('/.app/library.json').text).songs[song.id].path;
  mock.entries.delete(path.toLowerCase());
  await editTitle(page, 'Alpha', 'Unsent Alpha');
  await syncPage(page);
  expect(mock.find(path)).toBeUndefined();
  expect(await savedSongs(page)).toHaveLength(1);
  await synchronize(page);
  await expect.poll(async () => (await savedSongs(page)).length).toBe(0);
  expect((await state(page)).personal).toHaveLength(0);
  expect(account(await state(page)).bases[song.id]).toBeUndefined();
  expect(mock.find('/.app/songs/' + song.id + '.json')).toBeUndefined();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  const older = await browser.newContext({serviceWorkers: 'block'});
  try {
    await dropboxMock(older, {backend: mock});
    const other = await older.newPage();
    await other.goto(url);
    await other.evaluate(
      data =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open('hobos-songbook-test');
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction(['songs', 'personal', 'songbooks', 'sync'], 'readwrite');
            for (const name of ['songs', 'personal', 'songbooks', 'sync']) {
              tx.objectStore(name).clear();
              for (const value of data[name]) tx.objectStore(name).put(value);
            }
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => reject(tx.error);
          };
        }),
      before,
    );
    await other.reload();
    await syncPage(other);
    await mutate(other, {personal: {[song.id]: 9}});
    await expect(other.locator('#dropbox-sync')).toBeEnabled();
    expect(mock.find(path)).toBeUndefined();
    await synchronize(other);
    await expect.poll(async () => (await savedSongs(other)).length).toBe(0);
    expect(mock.find(path)).toBeUndefined();
  } finally {
    await older.close();
  }
});
for (const mode of ['deleted', 'outside'])
  test(`F57: ${mode} book removes local book/content and preserves another book`, async ({page, context}) => {
    const mock = await setup(page, context, ['Alpha']);
    await goSongs(page);
    await openMenu(page);
    await page.locator('#main-menu').getByRole('button', {name: 'Sangbøker', exact: true}).click();
    await page.locator('#add-songbook').click();
    const name = page.getByRole('dialog').getByRole('textbox');
    await name.fill('Other');
    await page.getByRole('dialog').getByRole('button', {name: 'Lagre', exact: true}).click();
    await syncPage(page);
    const manifest = JSON.parse(mock.find('/.app/library.json').text),
      book = manifest.books.standard,
      path = book.path;
    if (mode === 'outside') mock.rename(book.folderId, '/Outside');
    else
      for (const [key, e] of [...mock.entries])
        if (e.path_display === path || e.path_display.startsWith(path + '/')) mock.entries.delete(key);
    await synchronize(page);
    const after = await state(page);
    expect(after.songbooks.map(b => b.name)).toEqual(['Other']);
    expect(after.songs).toHaveLength(0);
    expect(after.personal).toHaveLength(0);
    expect(account(after).manifest.books.standard.deleted).toBe(true);
    if (mode === 'outside') expect(mock.find('/Outside')).toBeTruthy();
    await synchronize(page);
    expect(mock.find('/Songbooks/Standard')).toBeUndefined();
    await expect(page.locator('#sync-status')).not.toContainText('feilet');
  });
test('F58/F60: cursor reset is normal; a failed later page cannot erase local content', async ({page, context}) => {
  const mock = await setup(page, context, ['Alpha'], {pageSize: 2}),
    song = (await savedSongs(page))[0];
  mock.resetCursors();
  await synchronize(page);
  await expect(page.locator('#sync-status')).not.toContainText('feilet');
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  mock.resetCursors();
  mock.fault('/list_folder/continue', 500, 1);
  await synchronize(page);
  await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-003');
  expect((await savedSongs(page))[0].id).toBe(song.id);
  await synchronize(page);
  await expect(page.locator('#sync-status')).not.toContainText('feilet');
  expect((await savedSongs(page))[0].id).toBe(song.id);
});
test('F23: a revision race is rechecked as an ordinary conflict without a false failure', async ({page, context}) => {
  const mock = await setup(page, context),
    song = (await savedSongs(page))[0];
  await goSongs(page);
  await page.locator('#song-list .song-choice').click();
  await setCapo(page, 4);
  const release = mock.hold('/upload', false, '/.app/songs/' + song.id + '.json');
  try {
    const start = mock.calls.length;
    await goSongs(page);
    await expect.poll(() => mock.calls.slice(start).some(c => c.endpoint.endsWith('/upload'))).toBe(true);
    const path = '/.app/songs/' + song.id + '.json',
      remote = JSON.parse(mock.find(path).text);
    remote.data.capo = 7;
    mock.put(path, JSON.stringify(remote));
  } finally {
    release();
  }
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Personlige tilpasninger');
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  await dialog.getByRole('button', {name: 'Lokal versjon', exact: true}).click();
  await expect.poll(() => JSON.parse(mock.find('/.app/songs/' + song.id + '.json').text).data.capo).toBe(4);
  expect(account(await state(page)).lastManual).toBeUndefined();
});
for (const folder of ['Shared', 'Originals'])
  test(`moving a known private file to ${folder} respects the clarified boundary`, async ({page, context}) => {
    const mock = await setup(page, context),
      song = (await savedSongs(page))[0],
      link = JSON.parse(mock.find('/.app/library.json').text).songs[song.id],
      target = '/Songbooks/Standard/' + folder + '/moved.cho';
    mock.rename(link.fileId, target);
    const before = mock.calls.length;
    await editTitle(page, 'Alpha', 'Local Alpha');
    await syncPage(page);
    await synchronize(page);
    expect(mock.find(target)?.id).toBe(link.fileId);
    expect(mock.find(link.path)).toBeUndefined();
    expect(mock.find(target).text).toContain(folder === 'Shared' ? '{t: Local Alpha}' : '{t: Alpha}');
    expect(
      mock.calls
        .slice(before)
        .some(c => c.endpoint.endsWith('/move_v2') || (c.endpoint.endsWith('/upload') && c.args.path === link.path)),
    ).toBe(false);
    if (folder === 'Shared') {
      expect((await savedSongs(page))[0].id).toBe(song.id);
      expect(account(await state(page)).manifest.songs[song.id].path).toContain('/Shared/');
      expect(account(await state(page)).manifest.deletedSongs?.[song.id]).toBeUndefined();
    } else {
      expect(await savedSongs(page)).toHaveLength(0);
      expect(account(await state(page)).manifest.deletedSongs[song.id]).toBeTruthy();
    }
  });
test('F57: deleting the last master book leaves an empty library without recreating Standard', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context),
    book = JSON.parse(mock.find('/.app/library.json').text).books.standard;
  for (const [key, e] of [...mock.entries])
    if (e.path_display === book.path || e.path_display.startsWith(book.path + '/')) mock.entries.delete(key);
  await synchronize(page);
  await expect.poll(async () => (await state(page)).songbooks.length).toBe(0);
  expect(await savedSongs(page)).toHaveLength(0);
  await page.reload();
  await syncPage(page);
  expect((await state(page)).songbooks).toHaveLength(0);
  expect(mock.find('/Songbooks/Standard')).toBeUndefined();
  await goSongs(page);
  await expect(page.locator('#songbook-filter')).toContainText('Alle');
  await expect(page.locator('#song-list .song-choice')).toHaveCount(0);
});
test('F56/F23: deletion during an upload cannot recreate the file or produce a false failure', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context),
    song = (await savedSongs(page))[0],
    link = JSON.parse(mock.find('/.app/library.json').text).songs[song.id];
  await goSongs(page);
  await page.locator('#song-list .song-choice').click();
  await tool(page, 'Tittel');
  await fillValue(page, 'Tittel', 'Unsent Alpha');
  const release = mock.hold('/upload', false, link.path);
  try {
    const start = mock.calls.length;
    await goSongs(page);
    await expect
      .poll(() => mock.calls.slice(start).some(c => c.endpoint.endsWith('/upload') && c.args.path === link.path))
      .toBe(true);
    mock.entries.delete(link.path.toLowerCase());
  } finally {
    release();
  }
  await syncPage(page);
  expect(mock.find(link.path)).toBeUndefined();
  await expect(page.locator('#sync-status')).not.toContainText('feilet');
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  await synchronize(page);
  await expect.poll(async () => (await savedSongs(page)).length).toBe(0);
  expect(mock.find(link.path)).toBeUndefined();
});
test('automatic content-copy and personal choices continue in sequence without downloading an unrelated song', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context, ['Alpha', 'Beta']),
    songs = await savedSongs(page),
    a = songs.find(s => s.title === 'Alpha'),
    b = songs.find(s => s.title === 'Beta'),
    manifest = JSON.parse(mock.find('/.app/library.json').text),
    personal = '/.app/songs/' + a.id + '.json';
  mock.put(manifest.songs[a.id].path, '{t: Remote Alpha}\nText');
  mock.put(manifest.songs[b.id].path, '{t: Remote Beta}\nText');
  const remote = JSON.parse(mock.find(personal).text);
  remote.data.capo = 7;
  mock.put(personal, JSON.stringify(remote));
  await goSongs(page);
  await page.locator('#song-list .song-choice').filter({hasText: 'Alpha'}).click();
  await setCapo(page, 4);
  await tool(page, 'Tittel');
  await fillValue(page, 'Tittel', 'Local Alpha');
  await goSongs(page);
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Opprett ny fil', exact: true}).click();
  await expect(dialog.locator('button')).toHaveText(['Lokal versjon', 'Dropbox']);
  await dialog.getByRole('button', {name: 'Lokal versjon', exact: true}).click();
  await expect.poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length).toBe(3);
  await syncPage(page);
  expect((await savedSongs(page)).find(s => s.id === b.id).title).toBe('Beta');
  expect(account(await state(page)).lastManual).toBeUndefined();
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
});
test('parallel incoming responses respect a newly opened song session and resume only after real exit', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context, ['Alpha', 'Beta']),
    songs = await savedSongs(page),
    manifest = JSON.parse(mock.find('/.app/library.json').text);
  for (const song of songs) mock.put(manifest.songs[song.id].path, '{t: Remote ' + song.title + '}\nNew text');
  const release = mock.hold('/download', true, manifest.songs[songs[0].id].fileId);
  try {
    const start = mock.calls.length;
    await page.locator('#dropbox-sync').click();
    await expect
      .poll(() => mock.calls.slice(start).filter(c => c.endpoint.endsWith('/download')).length)
      .toBeGreaterThanOrEqual(2);
    await goSongs(page);
    await page.locator('#song-list .song-choice').filter({hasText: 'Alpha'}).click();
    await expect(page.locator('#song-title')).toHaveText('Alpha');
  } finally {
    release();
  }
  await expect.poll(async () => account(await state(page)).pending).toBe(true);
  await expect(page.locator('#song-title')).toHaveText('Alpha');
  expect((await savedSongs(page)).find(s => s.title === 'Alpha')).toBeTruthy();
  await goSongs(page);
  await expect
    .poll(async () => (await savedSongs(page)).map(s => s.title).sort())
    .toEqual(['Remote Alpha', 'Remote Beta']);
  await syncPage(page);
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
});
test('first explicit OAuth coordination counts as a successful manual synchronization', async ({
  page,
  context,
  request,
}) => {
  await dropboxMock(context, {connected: false});
  await context.addInitScript(() =>
    sessionStorage.setItem(
      'hobos-songbook-test:dropbox-pkce-v1',
      JSON.stringify({
        state: 'accepted-first-connect',
        verifier: 'fixture-verifier',
        redirect: 'https://geirskoglund.github.io/hobos-songbook/test/',
        created: Date.now(),
      }),
    ),
  );
  await context.route('https://geirskoglund.github.io/hobos-songbook/**', async route => {
    const source = new URL(route.request().url());
    const response = await request.get(source.pathname);
    await route.fulfill({response});
  });
  await page.goto('https://geirskoglund.github.io/hobos-songbook/test/?code=accepted&state=accepted-first-connect');
  await expect(page.locator('#sync')).toBeVisible();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  expect(account(await state(page)).lastManual).toBeTruthy();
  expect(page.url()).not.toContain('code=');
});

test('review F57: an offline new song is removed with its confirmed deleted book in real IndexedDB', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context),
    book = JSON.parse(mock.find('/.app/library.json').text).books.standard;
  await context.setOffline(true);
  await mutate(page, {seed: 1});
  expect(await savedSongs(page)).toHaveLength(2);
  for (const [key, e] of [...mock.entries])
    if (e.path_display === book.path || e.path_display.startsWith(book.path + '/')) mock.entries.delete(key);
  await context.setOffline(false);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  await synchronize(page);
  await expect.poll(async () => (await state(page)).songs.length).toBe(0);
  const data = await state(page);
  expect(data.songbooks).toHaveLength(0);
  expect(data.personal).toHaveLength(0);
  expect(account(data).uploads ?? {}).toEqual({});
  await page.reload();
  await syncPage(page);
  expect(await savedSongs(page)).toHaveLength(0);
  expect(mock.find(book.path)).toBeUndefined();
});

test('review F26: Dropbox conflict choice cannot introduce an unrelated remote book', async ({page, context}) => {
  const mock = await setup(page, context),
    song = (await savedSongs(page))[0],
    manifestFile = mock.find('/.app/library.json'),
    manifest = JSON.parse(manifestFile.text),
    folder = mock.put('/Songbooks/Unrelated', '', true);
  manifest.books.unrelated = {id: 'unrelated', name: 'Unrelated', folderId: folder.id, path: folder.path_display};
  mock.put(manifestFile.path_display, JSON.stringify(manifest));
  mock.put(manifest.songs[song.id].path, '{t: Remote Alpha}\nRemote words');
  await editTitle(page, 'Alpha', 'Local Alpha');
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Dropbox', exact: true}).click();
  await expect.poll(async () => (await savedSongs(page))[0].title).toBe('Remote Alpha');
  expect((await state(page)).songbooks.map(b => b.id)).toEqual(['standard']);
  await syncPage(page);
  expect(account(await state(page)).lastManual).toBeUndefined();
  await synchronize(page);
  expect((await state(page)).songbooks.some(b => b.id === 'unrelated')).toBe(true);
});

test('review identity: two devices discovering one file converge after a real HTTP revision race', async ({
  page,
  context,
  browser,
}) => {
  const mock = await setup(page, context, []),
    saved = await state(page),
    otherContext = await browser.newContext({serviceWorkers: 'block'});
  try {
    const otherMock = await dropboxMock(otherContext, {backend: mock}),
      other = await otherContext.newPage();
    await other.goto(url);
    await syncPage(other);
    await other.evaluate(
      data =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open('hobos-songbook-test');
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction(['songs', 'personal', 'songbooks', 'sync'], 'readwrite');
            for (const name of ['songs', 'personal', 'songbooks', 'sync']) {
              tx.objectStore(name).clear();
              for (const item of data[name]) {
                if (name === 'sync' && item.id.startsWith('private-account-v1:')) {
                  delete item.mutationOwner;
                  delete item.mutationPending;
                }
                tx.objectStore(name).put(item);
              }
            }
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => reject(tx.error);
          };
        }),
      saved,
    );
    await other.reload();
    await syncPage(other);
    mock.put('/Songbooks/Standard/Private/discovery.cho', '{t: Discovered}\nText');
    const releaseLeft = mock.hold('/upload', false, '/.app/library.json');
    try {
      await page.locator('#dropbox-sync').click();
      await expect
        .poll(() =>
          mock.calls.some(
            c =>
              c.endpoint.endsWith('/upload') &&
              c.args.path === '/.app/library.json' &&
              c.args.mode['.tag'] === 'update',
          ),
        )
        .toBe(true);
      await other.locator('#dropbox-sync').click();
      await expect(other.locator('#dropbox-sync')).toBeEnabled();
      expect(
        otherMock.calls.some(
          c =>
            c.endpoint.endsWith('/upload') && c.args.path === '/.app/library.json' && c.args.mode['.tag'] === 'update',
        ),
      ).toBe(false);
    } finally {
      releaseLeft();
    }
    await expect(page.locator('#dropbox-sync')).toBeEnabled();
    await synchronize(other);
    expect(Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs)).toHaveLength(1);
    expect(await savedSongs(page)).toHaveLength(1);
    expect(await savedSongs(other)).toHaveLength(1);
    const localId = (await savedSongs(other))[0].id;
    await synchronize(other);
    expect((await savedSongs(other))[0].id).toBe(localId);
    expect(await savedSongs(other)).toHaveLength(1);
  } finally {
    await otherContext.close();
  }
});

test('bulk: a lost committed response resumes across reload and a newer local generation', async ({page, context}) => {
  const mock = await setup(page, context, []);
  mock.loseBatchReply();
  await mutate(page, {seed: 30});
  await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-002');
  expect(Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs)).toHaveLength(0);
  const pending = account(await state(page));
  expect(Object.values(pending.uploads).some(j => j.status === 'committing')).toBe(true);
  await mutate(page, {originals: ['bulk-0']}, false);
  await page.reload();
  await expect
    .poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length, {timeout: 20000})
    .toBe(30);
  await syncPage(page);
  const manifest = JSON.parse(mock.find('/.app/library.json').text);
  expect(mock.find(manifest.songs['bulk-0'].path).text).toContain('Changed');
  expect(await savedSongs(page)).toHaveLength(30);
  expect(account(await state(page)).conflicts).toHaveLength(0);
  for (const link of Object.values(manifest.songs)) {
    const p = JSON.parse(mock.find('/.app/songs/' + link.id + '.json').text);
    expect(p.original.rev).toBe(mock.find(link.path).rev);
  }
});

test('bulk: HTTP 200 partial contention retries its subset and completes matching sidecar revisions', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context, []);
  await mutate(page, {seed: 20});
  await expect.poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length).toBe(20);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  const manifest = JSON.parse(mock.find('/.app/library.json').text);
  mock.failBatchEntry(manifest.songs['bulk-0'].path, 'path/too_many_write_operations');
  const start = mock.calls.length;
  await mutate(page, {originals: Array.from({length: 20}, (_, i) => 'bulk-' + i)});
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  const batches = mock.calls.slice(start).filter(c => c.endpoint.endsWith('/finish_batch_v2'));
  expect(batches.map(c => c.args.entries.length)).toEqual([20, 1, 20]);
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  for (const link of Object.values(manifest.songs))
    expect(JSON.parse(mock.find('/.app/songs/' + link.id + '.json').text).original.rev).toBe(mock.find(link.path).rev);
});

test('bulk: first upload of 205 songs uses bounded commits through the real adapter and IndexedDB', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const mock = await setup(page, context, []),
    start = mock.calls.length;
  mock.limitConcurrentWrites();
  await mutate(page, {seed: 205});
  await expect
    .poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length, {timeout: 45000})
    .toBe(205);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  const calls = mock.calls.slice(start),
    batches = calls.filter(c => c.endpoint.endsWith('/finish_batch_v2'));
  expect(batches.map(c => c.args.entries.length)).toEqual([100, 100, 5, 100, 100, 5]);
  expect(calls.filter(c => c.endpoint.endsWith('/move_batch_v2')).map(c => c.args.entries.length)).toEqual([
    100, 100, 5,
  ]);
  expect(calls.filter(c => c.endpoint.endsWith('/upload') && c.args.path === '/.app/upload-index.json')).toHaveLength(
    4,
  );
  expect(
    calls.filter(
      c =>
        c.endpoint.endsWith('/upload') &&
        !['/.app/library.json', '/.app/upload-index.json', '/.app/mutation.json'].includes(c.args.path),
    ),
  ).toHaveLength(0);
  expect(mock.throttled()).toBe(0);
  const manifest = JSON.parse(mock.find('/.app/library.json').text);
  expect(await savedSongs(page)).toHaveLength(205);
  for (const link of Object.values(manifest.songs))
    expect(JSON.parse(mock.find('/.app/songs/' + link.id + '.json').text).original.rev).toBe(mock.find(link.path).rev);
});

test('bulk: opening a song during commit pauses receipts and dependent uploads until real exit', async ({
  page,
  context,
}) => {
  const mock = await setup(page, context, []),
    release = mock.hold('/finish_batch_v2');
  try {
    await mutate(page, {seed: 20});
    await expect.poll(() => mock.calls.some(c => c.endpoint.endsWith('/finish_batch_v2'))).toBe(true);
    await goSongs(page);
    await page.locator('#song-list .song-choice').filter({hasText: 'Bulk 0'}).click();
    await expect(page.locator('#song-title')).toHaveText('Bulk 0');
  } finally {
    release();
  }
  await expect.poll(() => [...mock.entries.values()].filter(e => e.path_display.endsWith('.cho')).length).toBe(20);
  expect(mock.find('/.app/songs/bulk-0.json')).toBeUndefined();
  expect(Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs)).toHaveLength(0);
  const data = await state(page);
  expect(Object.values(account(data).uploads).some(j => j.status === 'committing')).toBe(true);
  await goSongs(page);
  await expect
    .poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length, {timeout: 15000})
    .toBe(20);
  await syncPage(page);
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  expect(await savedSongs(page)).toHaveLength(20);
});

for (const mode of ['deleted', 'Shared', 'Originals', 'rename'])
  test(`bulk: confirmed first-upload ${mode} is respected before any manifest was published`, async ({
    page,
    context,
  }) => {
    const mock = await dropboxMock(context, {connected: false});
    await page.goto(url);
    await mutate(page, {seed: 2}, false);
    await page.evaluate(() =>
      localStorage.setItem(
        'hobos-songbook-test:dropbox-auth-v1',
        JSON.stringify({
          version: 1,
          accountId: 'dbid:fixture',
          name: 'Fixture',
          email: 'fixture@example.invalid',
          accessToken: 'fixture-access',
          refreshToken: 'fixture-refresh',
          expires: Date.now() + 3600000,
        }),
      ),
    );
    mock.fault('/finish_batch_v2', 0, 1);
    await page.reload();
    await syncPage(page);
    await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-002');
    expect(mock.find('/.app/library.json')).toBeUndefined();
    const data = account(await state(page)),
      link = data.reservations['bulk-0'];
    expect(link.fileId).toBeTruthy();
    let target;
    if (mode === 'deleted') mock.entries.delete(link.path.toLowerCase());
    else if (mode === 'rename') mock.rename(data.folders.standard.folderId, '/Songbooks/Renamed');
    else {
      target = '/Songbooks/Standard/' + mode + '/moved.cho';
      mock.rename(link.fileId, target);
    }
    const start = mock.calls.length;
    await synchronize(page);
    await synchronize(page);
    const local = await state(page),
      manifest = JSON.parse(mock.find('/.app/library.json').text);
    if (mode === 'rename') {
      expect(local.songbooks[0].name).toBe('Renamed');
      expect(Object.keys(manifest.songs)).toHaveLength(2);
      expect(manifest.books.standard.folderId).toBe(data.folders.standard.folderId);
      expect(mock.find('/Songbooks/Standard')).toBeUndefined();
    } else if (mode === 'Shared') {
      expect(local.songs).toHaveLength(2);
      expect(mock.find(target)).toBeTruthy();
      expect(mock.find(link.path)).toBeUndefined();
      expect(mock.calls.slice(start).some(c => c.endpoint.endsWith('/move_v2'))).toBe(false);
      expect(account(local).held['bulk-0']).toBe(true);
    } else {
      expect(local.songs.map(s => s.id)).toEqual(['bulk-1']);
      expect(local.personal.map(p => p.songId)).toEqual(['bulk-1']);
      expect(manifest.deletedSongs['bulk-0']).toBeTruthy();
      expect(mock.find(link.path)).toBeUndefined();
      if (target) expect(mock.find(target)).toBeTruthy();
    }
  });
