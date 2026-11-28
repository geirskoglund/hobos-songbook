import {appendFile, writeFile} from 'node:fs/promises';
import {test, expect} from './fixtures.mjs';
import {
  openMenu,
  importAndOpenSong,
  goSongs,
  setCapo,
  openSettings,
  closeSettings,
  savedSongs,
} from './song-helpers.mjs';
import {dropboxMock} from './dropbox-mock.mjs';
const url = '/hobos-songbook/test/';
async function syncPage(page) {
  await openMenu(page);
  await page.getByRole('button', {name: 'Synkronisering', exact: true}).click();
  await expect(page.locator('#sync')).toBeVisible();
}
async function synchronize(page) {
  await syncPage(page);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  await page.locator('#dropbox-sync').click();
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
            result = {};
          for (const name of ['songs', 'personal', 'songbooks', 'sync']) {
            const q = tx.objectStore(name).getAll();
            q.onsuccess = () => (result[name] = q.result);
          }
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
}
test.beforeAll(async () => {
  await writeFile('work/ui-quality.jsonl', '');
});
async function quality(page, kind, dialog) {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 800});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (dialog)
      await expect
        .poll(() =>
          page.locator('dialog[open]').evaluate(e => {
            const r = e.getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
          }),
        )
        .toBe(true);
    const data = await page.evaluate(
      ({kind, width}) => {
        const style = e => {
          const s = getComputedStyle(e),
            r = e.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            left: r.left,
            top: r.top,
            font: s.fontFamily,
            size: s.fontSize,
            color: s.color,
            background: s.backgroundColor,
            radius: s.borderRadius,
            padding: s.padding,
            gap: s.gap,
            border: s.borderColor,
            outline: s.outlineColor,
          };
        };
        const box = document.querySelector('dialog[open]');
        return {
          kind,
          width,
          header: style(document.querySelector('.topbar')),
          title: style(document.querySelector('#page-title')),
          button: style(document.querySelector('#dropbox-sync')),
          panel: style(document.querySelector('#sync .display-settings')),
          account: style(document.querySelector('#sync .app-info')),
          dialog: box && style(box),
          footer: box && style(box.querySelector('footer')),
          actions: box && [...box.querySelectorAll('footer button')].map(style),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      {kind, width},
    );
    expect(data.overflow).toBe(false);
    if (dialog) {
      expect(data.dialog.radius).toBe('24px');
      expect(data.dialog.padding).toBe('32px 32px 0px');
      expect(data.actions.at(-1).background).toBe('rgb(226, 192, 151)');
      for (const action of data.actions) {
        expect(action.size).toBe('18px');
        expect(action.height).toBeGreaterThanOrEqual(80);
      }
    }
    expect(data.panel.radius).toBe('12px');
    expect(data.panel.background).toBe('rgb(50, 46, 42)');
    await appendFile('work/ui-quality.jsonl', JSON.stringify(data) + '\n');
    await page.screenshot({path: `work/quality-${kind}-${width}.png`, fullPage: true});
  }
  if (dialog) {
    await page.setViewportSize({width: 320, height: 420});
    for (const action of await page.locator('dialog[open] footer button').all()) await expect(action).toBeInViewport();
    await page.screenshot({path: `work/quality-${kind}-320x420.png`});
    await page.setViewportSize({width: 1440, height: 800});
  }
}
test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});
test('AK37-01/10: local/no account, centered connect, no OAuth before click; N01 keeps long title on one line', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context, {connected: false});
  await page.goto(url);
  await syncPage(page);
  expect(mock.calls).toHaveLength(0);
  await expect(page.locator('#import-list')).toBeHidden();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 800});
    await expect(page.locator('#dropbox-connect')).toBeVisible();
    const m = await page.locator('#page-title').evaluate(e => ({
      height: e.getBoundingClientRect().height,
      font: parseFloat(getComputedStyle(e).fontSize),
      text: e.textContent,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(m.text).toBe('Synkronisering');
    expect(m.height).toBeLessThan(m.font * 1.8);
    expect(m.scroll).toBeLessThanOrEqual(width);
    const button = await page.locator('#dropbox-connect').boundingBox();
    expect(Math.abs(button.x + button.width / 2 - width / 2)).toBeLessThan(2);
  }
  await page.screenshot({path: 'work/quality-disconnected-1440.png'});
  await page.locator('#dropbox-connect').click();
  await expect(page.locator('.sync-connect [role=status]')).toContainText('faste appadressen');
  expect(mock.calls).toHaveLength(0);
});
test('AK37-02/04/07: real IndexedDB outbox, view/edit/settings pause, auto upload only on real exit', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await importAndOpenSong(
    page,
    'privat.txt',
    '\uFEFF{t: Privat}\r\n[C]Ord\r\n{soc}\r\nRefreng\r\n{eoc}\r\n{chorus}\r\n',
  );
  const imported = Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs)[0],
    initialPersonal = mock.find(`/.app/songs/${imported}.json`).text;
  await setCapo(page, 3);
  await openSettings(page);
  await page.waitForTimeout(100);
  expect(mock.find(`/.app/songs/${imported}.json`).text).toBe(initialPersonal);
  await closeSettings(page);
  await page.locator('#edit-song').click();
  await page.waitForTimeout(50);
  expect(mock.find(`/.app/songs/${imported}.json`).text).toBe(initialPersonal);
  await goSongs(page);
  await expect.poll(() => JSON.parse(mock.find(`/.app/songs/${imported}.json`).text).data.capo).toBe(3);
  const manifest = JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{}}'),
    id = Object.keys(manifest.songs)[0];
  expect(mock.find(manifest.songs[id].path).text).toContain('\uFEFF{t: Privat}\r\n');
  expect(JSON.parse(mock.find(`/.app/songs/${id}.json`).text).data.capo).toBe(3);
  await syncPage(page);
  await quality(page, 'connected', false);
  await expect(page.locator('#sync-status')).not.toContainText('Sist synkronisert:');
  await synchronize(page);
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  const version = mock.find(manifest.songs[id].path);
  mock.put(version.path_display, '{t: Fra annen enhet}\nNy tekst');
  await page.reload();
  await expect(page.locator('#song-list .song-choice')).toContainText('Privat');
  await syncPage(page);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.waitForTimeout(100);
  expect((await savedSongs(page))[0].title).toBe('Privat');
  await synchronize(page);
  await expect(page.locator('#sync-status')).not.toContainText('venter på opplasting');
  await goSongs(page);
  await expect(page.locator('#song-list .song-choice')).toContainText('Fra annen enhet');
});
test('#104: one page with sync panel, import list and account panel in that order', async ({page, context}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await expect(page.locator('#dropbox-sync')).toBeVisible();
  expect(await page.locator('#sync [role=tab], #sync [role=tablist]').count()).toBe(0);
  await expect(page.locator('#import-list > li')).toHaveCount(0);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 800});
    const layout = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const panel = box('#sync .display-settings'),
        list = box('#import-list'),
        account = box('#sync .app-info'),
        disconnect = box('#dropbox-disconnect');
      return {
        order: [...document.querySelector('#import-list').parentElement.children].map(e => e.className),
        listBelowPanel: list.top >= panel.bottom,
        accountBelowList: account.top >= list.bottom,
        disconnect: disconnect.height,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout.order).toEqual(['display-settings', 'song-list import-list', 'app-info', 'floating-action']);
    expect(layout.listBelowPanel && layout.accountBelowList).toBe(true);
    expect(layout.disconnect).toBeGreaterThanOrEqual(44);
    expect(layout.overflow).toBe(false);
  }
  await page.locator('#dropbox-disconnect').click();
  await expect(page.locator('dialog[open] h2')).toHaveText('Koble fra Dropbox');
  await expect(page.locator('dialog[open] footer button').first()).toBeFocused();
});
test('AK37-06/10: E04/E03 conflict decisions, safe Enter, Escape, both conflicts and safe disconnect', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await importAndOpenSong(page, 'sang.cho', '{t: Konflikt}\nOrd');
  await goSongs(page);
  await expect
    .poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{}}').songs).length)
    .toBe(1);
  const manifest = JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{}}'),
    id = Object.keys(manifest.songs)[0];
  mock.put(manifest.songs[id].path, '{t: Dropbox}\nSky');
  const p = JSON.parse(mock.find(`/.app/songs/${id}.json`).text);
  p.data.capo = 6;
  mock.put(`/.app/songs/${id}.json`, JSON.stringify(p));
  await page.locator('#song-list .song-choice').click();
  await setCapo(page, 2);
  const {tool, fillValue} = await import('./song-helpers.mjs');
  await tool(page, 'Tittel');
  await fillValue(page, 'Tittel', 'Lokal');
  await goSongs(page);
  const dialog = page.getByRole('dialog', {name: 'Synkroniseringskonflikt', exact: true});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button')).toHaveText(['Lokal versjon', 'Dropbox', 'Opprett ny fil']);
  await expect(dialog.locator('h2')).toBeFocused();
  await quality(page, 'E04', true);
  const before = mock.find(manifest.songs[id].path).text;
  await page.keyboard.press('Enter');
  expect(mock.find(manifest.songs[id].path).text).toBe(before);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#library-title')).toBeFocused();
  await synchronize(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Dropbox', exact: true}).click();
  await expect(dialog.locator('button')).toHaveText(['Lokal versjon', 'Dropbox']);
  await quality(page, 'E03-conflict', true);
  await dialog.getByRole('button', {name: 'Lokal versjon', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#sync-status')).not.toContainText('uløste konflikter');
  expect((await state(page)).personal[0].capo).toBe(2);
  await expect.poll(async () => (await savedSongs(page))[0].title).toBe('Dropbox');
  await page.locator('#dropbox-disconnect').click();
  const confirm = page.getByRole('dialog', {name: 'Koble fra Dropbox', exact: true});
  await expect(confirm.getByRole('button', {name: 'Avbryt', exact: true})).toBeFocused();
  await expect(confirm).toContainText('Lokale sanger og tilpasninger beholdes.');
  await quality(page, 'E03-disconnect', true);
  await confirm.getByRole('button', {name: 'Koble fra', exact: true}).click();
  await expect(page.locator('#dropbox-connect')).toBeVisible();
  await expect(page.locator('#dropbox-connect')).toBeFocused();
  expect((await savedSongs(page))[0].id).toBe(id);
  expect((await state(page)).personal[0].capo).toBe(2);
});
test('AK37-05/07: in-flight response after song opening cannot change song or personal data', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await importAndOpenSong(page, 'sang.cho', '{t: Behold}\nOrd');
  await goSongs(page);
  await expect
    .poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{}}').songs).length)
    .toBe(1);
  const manifest = JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{}}'),
    id = Object.keys(manifest.songs)[0];
  mock.put(manifest.songs[id].path, '{t: Ny}\nFjerntekst');
  const release = mock.hold('/download');
  await syncPage(page);
  await page.locator('#dropbox-sync').click();
  await goSongs(page);
  await page.locator('#song-list .song-choice').click();
  release();
  await expect(page.locator('#song-title')).toHaveText('Behold');
  await page.waitForTimeout(100);
  expect((await savedSongs(page))[0].title).toBe('Behold');
});
test('AK37-01/F61: a rejected OAuth return leaves the connected sync status and saves its technical report', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url + '?code=wrong&state=wrong');
  await expect.poll(() => page.url().includes('code=')).toBe(false);
  await syncPage(page);
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
  await expect(page.locator('#dropbox-connect')).toBeHidden();
  const logs = () => page.evaluate(() => JSON.parse(localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1')));
  await expect.poll(async () => (await logs())?.entries[0]?.failure.code).toBe('SYNC-019');
  expect((await logs()).active).toBeNull();
  expect(
    mock.calls.filter(call => call.endpoint === '/oauth2/token' || call.endpoint.endsWith('/get_current_account')),
  ).toHaveLength(0);

  // The same report can already be active in a browser upgraded from an older build.
  await page.evaluate(() => {
    const key = 'hobos-songbook-test:sync-diagnostics-v1',
      legacy = JSON.parse(localStorage.getItem(key));
    legacy.active = legacy.entries[0].id;
    localStorage.setItem(key, JSON.stringify(legacy));
  });
  await page.reload();
  await syncPage(page);
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
  await expect.poll(async () => (await logs()).active).toBeNull();
  expect((await logs()).entries[0].failure.code).toBe('SYNC-019');
  await synchronize(page);
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
});

test('AK37-01: an invalid OAuth return without a saved account provides the visible login action', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context, {connected: false});
  await page.goto(url + '?code=wrong&state=wrong');
  await syncPage(page);
  await expect(page.locator('#dropbox-connect')).toBeVisible();
  await expect(page.locator('.sync-connect [role=status]')).toHaveText(
    'Synkronisering feilet (Feilkode SYNC-019). Start tilkoblingen på nytt med Koble til Dropbox.',
  );
  expect(mock.calls).toHaveLength(0);
});

test('AK37-01: file-call token expiry renews the ordinary connection during explicit sync', async ({page, context}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect
    .poll(() => mock.find('/.app/mutation.json') && JSON.parse(mock.find('/.app/mutation.json').text).owner)
    .toBeNull();
  await syncPage(page);
  let expired = false,
    renewals = 0;
  await context.route('https://api.dropboxapi.com/2/files/list_folder/continue', async route => {
    if (expired) return route.fallback();
    expired = true;
    await route.fulfill({status: 401, json: {error: {'.tag': 'expired_access_token'}}});
  });
  await context.route('https://api.dropboxapi.com/oauth2/token', async route => {
    renewals++;
    expect(new URLSearchParams(route.request().postData()).get('grant_type')).toBe('refresh_token');
    await route.fulfill({json: {access_token: 'renewed', expires_in: 3600}});
  });
  await synchronize(page);
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  expect(expired).toBe(true);
  expect(renewals).toBe(1);
  await expect(page.locator('#dropbox-connect')).toBeHidden();
});
test('AK37-05/07: interrupted edit survives reload, and failed data write cannot commit its outbox', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await importAndOpenSong(page, 'sang.cho', '{t: Avbrutt}\nOrd');
  const imported = Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs)[0],
    initialPersonal = mock.find(`/.app/songs/${imported}.json`).text;
  await setCapo(page, 3);
  await page.reload();
  await syncPage(page);
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
  expect((await state(page)).sync.find(s => s.id === 'private-local-v1').recoveryRequired).toBe(true);
  expect(mock.find(`/.app/songs/${imported}.json`).text).toBe(initialPersonal);
  await goSongs(page);
  await page.locator('#song-list .song-choice').click();
  await expect(page.locator('#song-title')).toBeVisible();
  await goSongs(page);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.waitForTimeout(100);
  expect(mock.find(`/.app/songs/${imported}.json`).text).toBe(initialPersonal);
  await synchronize(page);
  await expect.poll(() => JSON.parse(mock.find(`/.app/songs/${imported}.json`).text).data.capo).toBe(3);
  expect(Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs)).toHaveLength(1);
  expect((await state(page)).sync.find(s => s.id === 'private-local-v1').recoveryRequired).toBe(false);
  await goSongs(page);
  await page.locator('#song-list .song-choice').click();
  await page.getByRole('button', {name: 'Rediger', exact: true}).click();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const r = put.apply(this, args);
      if (this.name === 'personal') this.transaction.abort();
      return r;
    };
    window.restoreSyncWrite = () => {
      IDBObjectStore.prototype.put = put;
    };
  });
  const before = await state(page);
  const {tool, fillValue} = await import('./song-helpers.mjs');
  await tool(page, 'Stemming', true);
  await fillValue(page, 'Stemming', 'DADGAD');
  await expect(page.locator('#song-status')).toContainText('Kunne ikke lagre');
  const after = await state(page);
  expect(after.personal).toEqual(before.personal);
  expect(after.sync.find(s => s.id === 'private-local-v1').sessions).not.toEqual({});
  await page.evaluate(() => window.restoreSyncWrite());
  await page.getByRole('button', {name: 'Prøv lagring igjen', exact: true}).click();
  await goSongs(page);
  await expect
    .poll(() => JSON.parse(mock.find(`/.app/songs/${after.songs[0].id}.json`).text).data.tuning)
    .toBe('DADGAD');
});
test('AK37-08: manual sync adopts a Dropbox book rename and a new empty book without duplicates', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await importAndOpenSong(page, 'navn.cho', '{t: Samme sang}\nOrd');
  await goSongs(page);
  await expect.poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length).toBe(1);
  const before = await state(page),
    id = before.songs[0].id,
    folderId = JSON.parse(mock.find('/.app/library.json').text).books.standard.folderId;
  mock.rename(folderId, '/Songbooks/Nytt navn');
  mock.put('/Songbooks/Tom bok fra Dropbox', '', true);
  await synchronize(page);
  await expect(page.locator('#sync-status')).not.toContainText('venter på opplasting');
  const after = await state(page);
  expect(after.songbooks.find(b => b.id === 'standard').name).toBe('Nytt navn');
  expect(after.songbooks.some(b => b.name === 'Tom bok fra Dropbox')).toBe(true);
  expect(after.songs[0].id).toBe(id);
  expect(after.songs[0].songbookId).toBe('standard');
  expect(mock.find('/Songbooks/Standard')).toBeUndefined();
  await synchronize(page);
  expect((await state(page)).songbooks).toHaveLength(2);
});
test('AK37-01: local songs remain usable without the browser capability used to serialize Dropbox', async ({
  page,
  context,
}) => {
  await dropboxMock(context, {connected: false});
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', {value: undefined}));
  await page.goto(url);
  await importAndOpenSong(page, 'lokal.cho', '{t: Bare lokalt}\nOrd');
  await setCapo(page, 2);
  await goSongs(page);
  await page.locator('#song-list .song-choice').click();
  await expect(page.locator('#song-title')).toHaveText('Bare lokalt');
  await expect(page.locator('.song-metadata')).toContainText('Capo 2');
});
