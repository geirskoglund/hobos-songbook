import {mkdir, writeFile} from 'node:fs/promises';
import {test, expect} from './fixtures.mjs';
import {dropboxMock} from './dropbox-mock.mjs';
import {goSongs, importAndOpenSong, openMenu, savedSongs} from './song-helpers.mjs';

const url = '/hobos-songbook/test/';
test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
  await mkdir('work/publication', {recursive: true});
});
const action = (page, name) => page.getByRole('button', {name, exact: true});
async function go(page, name) {
  await openMenu(page);
  await action(page, name).click();
}
async function seed(page, context, {publishedInBand = false, additionalPrivate = 0, ...options} = {}) {
  const mock = await dropboxMock(context, options);
  await page.goto(url);
  await expect
    .poll(() => mock.find('/.app/mutation.json') && JSON.parse(mock.find('/.app/mutation.json').text).owner)
    .toBe(null);
  const manifest = JSON.parse(mock.find('/.app/library.json').text);
  const root = mock.put('/Songbooks/Band', '', true);
  for (const area of ['Private', 'Shared', 'Import', 'Originals']) mock.put(`/Songbooks/Band/${area}`, '', true);
  manifest.books.band = {id: 'band', name: 'Band', path: root.path_display, folderId: root.id};
  function song(id, title, book, area, imported = false) {
    const filename = `${id}.cho`,
      path = `${manifest.books[book].path}/${area}/${filename}`;
    const file = mock.put(path, `{t: ${title}}\n{key: G}\n{time: 3/4}\nOriginal`);
    manifest.songs[id] = {
      id,
      songbookId: book,
      fileId: file.id,
      path,
      origin: {
        kind: imported ? 'external' : 'local',
        filename,
        importedAt: '2026-01-01',
        ...(imported ? {sourceId: 'ext'} : {}),
      },
    };
  }
  song('zeda', 'Zulu', 'band', 'Private');
  song('bela', 'Alfa', 'band', 'Private');
  song('withdraw', 'Avpubliser meg', 'standard', 'Shared');
  if (publishedInBand) song('band-shared', 'Delt i Band', 'band', 'Shared');
  song('hidden', 'Importert', 'standard', 'Private', true);
  for (let i = 0; i < additionalPrivate; i++)
    song(`private-${i}`, `Privat ${String(i).padStart(3, '0')}`, 'band', 'Private');
  for (let i = 0; i < 18; i++) song(`song-${i}`, `Sang ${String(i).padStart(2, '0')}`, 'standard', 'Shared');
  mock.put('/.app/library.json', JSON.stringify(manifest));
  return mock;
}

test.describe('Publisering på smal berøringsskjerm', () => {
  test.use({hasTouch: true, viewport: {width: 320, height: 560}});

  test('AK39-01: touch separates the first song from Select all and toggles only the active filtered tab', async ({
    page,
    context,
  }) => {
    await seed(page, context, {publishedInBand: true});
    await go(page, 'Publisering');
    const root = page.locator('#publication'),
      tabs = root.locator('.publication-tab-row');
    const all = action(page, 'Velg alle'),
      first = root.locator('.metadata-row').first();
    const counts = root.locator('.publication-actions p');
    await expect(root.locator('.song-name')).toHaveText(['Alfa', 'Zulu']);
    await action(page, 'Sangbok: Alle').tap();
    await page.getByRole('option', {name: 'Band', exact: true}).tap();
    const geometry = async () => {
      const row = await tabs.boundingBox(),
        button = await all.boundingBox(),
        song = await first.boundingBox();
      expect(row.height).toBe(52);
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.x + button.width).toBeLessThanOrEqual(row.x + row.width);
      expect(button.y + button.height).toBeLessThanOrEqual(row.y + row.height);
      expect(song.y).toBeGreaterThanOrEqual(row.y + row.height);
      expect(await tabs.evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(Math.ceil(row.width));
      return {button, song};
    };
    await expect(tabs.getByRole('tablist').getByRole('button', {name: 'Velg alle'})).toHaveCount(0);
    const {button, song} = await geometry();
    const x = button.x + button.width / 2;
    await page.touchscreen.tap(x, song.y + 2);
    await expect(counts).toHaveText('1 valgt for publisering · 0 for avpublisering');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    const tapAll = () => page.touchscreen.tap(x, button.y + button.height - 2);
    await tapAll();
    await expect(counts).toHaveText('2 valgt for publisering · 0 for avpublisering');
    await tapAll();
    await expect(counts).toHaveText('0 valgt for publisering · 0 for avpublisering');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await expect(root.locator('.choice-check')).toHaveCount(0);
    await tapAll();
    await expect(counts).toHaveText('2 valgt for publisering · 0 for avpublisering');
    await expect(all).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('tab', {name: 'Publisert', exact: true}).tap();
    await expect(root.locator('.song-name')).toHaveText(['Delt i Band']);
    await all.tap();
    await expect(counts).toHaveText('2 valgt for publisering · 1 for avpublisering');
    await action(page, 'Sangbok: Band').tap();
    await page.getByRole('option', {name: 'Standard', exact: true}).tap();
    await geometry();
    await all.tap();
    await expect(counts).toHaveText('2 valgt for publisering · 20 for avpublisering');
    await all.tap();
    await expect(counts).toHaveText('2 valgt for publisering · 1 for avpublisering');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await expect(root.locator('.choice-check')).toHaveCount(0);
    await action(page, 'Sangbok: Standard').tap();
    await page.getByRole('option', {name: 'Band', exact: true}).tap();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
  });
});

test('AK39-01–03: shared components, paginated refresh, scoped selection, mixed bulk, last row and offline', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context, {pageSize: 7});
  await page.setViewportSize({width: 320, height: 560});
  await go(page, 'Publisering');
  const root = page.locator('#publication'),
    summary = root.locator('.publication-summary dd');
  const privateTab = page.getByRole('tab', {name: 'Upublisert', exact: true});
  const sharedTab = page.getByRole('tab', {name: 'Publisert', exact: true});
  const selected = root.locator('.publication-actions p');
  const perform = action(page, 'Utfør'),
    syncIcon = perform.locator('svg');
  await expect(summary).toHaveText(['21', '19', '2']);
  await expect(privateTab).toHaveAttribute('aria-selected', 'true');
  await expect(root.locator('.song-name')).toHaveText(['Alfa', 'Zulu']);
  await expect(perform).toBeDisabled();
  await expect(perform).toHaveCSS('cursor', 'default');
  await expect(syncIcon).toBeVisible();
  await expect(syncIcon).toHaveCSS('animation-name', 'none');
  await expect(action(page, 'Velg alle')).toBeEnabled();
  await page.screenshot({path: 'work/publication/upublisert-320.png'});
  await action(page, 'Sangbok: Alle').click();
  await expect(page.getByRole('dialog', {name: 'Sangbok'})).toBeVisible();
  await page.getByRole('option', {name: 'Band', exact: true}).click();
  await go(page, 'Sanger');
  await expect(action(page, 'Sangbok: Band')).toBeVisible();
  await expect(page.locator('#song-list li')).toHaveCount(0);
  await action(page, 'Sangbok: Band').click();
  await page.getByRole('option', {name: 'Alle', exact: true}).click();
  await go(page, 'Publisering');
  await expect(action(page, 'Sangbok: Alle')).toBeVisible();
  await action(page, 'Sangbok: Alle').click();
  await page.getByRole('option', {name: 'Band', exact: true}).click();
  await action(page, 'Velg alle').click();
  await expect(selected).toHaveText('2 valgt for publisering · 0 for avpublisering');
  await expect(root.locator('.choice-check')).toHaveCount(2);
  await privateTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(sharedTab).toBeFocused();
  await expect(root.getByText('Ingen publiserte sanger.')).toBeVisible();
  await action(page, 'Sangbok: Band').click();
  await page.getByRole('option', {name: 'Alle', exact: true}).click();
  await root.getByRole('button', {name: 'Avpubliser meg, G, 3/4'}).click();
  await expect(root.locator('.publication-actions p')).toHaveText('2 valgt for publisering · 1 for avpublisering');
  await expect(summary).toHaveText(['21', '19', '2']);
  await expect(perform).toBeEnabled();
  await expect(perform).toHaveCSS('cursor', 'pointer');
  await expect(syncIcon).toBeVisible();
  await expect(syncIcon).toHaveCSS('animation-name', 'none');
  await page.screenshot({path: 'work/publication/publisert-320.png'});
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 560});
    const geometry = await root.evaluate(node => {
      const style = selector => {
        const item = document.querySelector(selector),
          computed = getComputedStyle(item),
          box = item.getBoundingClientRect();
        return {
          x: box.x,
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          width: box.width,
          size: computed.fontSize,
          background: computed.backgroundColor,
          color: computed.color,
          border: computed.borderBottomWidth,
          font: computed.fontFamily,
        };
      };
      const offset = innerWidth / 2;
      return {
        width: innerWidth,
        offset,
        title: style('#page-title'),
        filter: style('#publication-songbook-filter'),
        tabRow: style('.publication-tab-row'),
        tabs: style('.tab-switcher'),
        selectAll: style('.publication-select-all'),
        active: style('[role=tab][aria-selected=true]'),
        row: style('.metadata-row[aria-pressed=true]'),
        check: style('.choice-check'),
        button: style('.primary-action'),
        bar: style('.publication-actions'),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(Math.abs(geometry.filter.x + geometry.filter.width / 2 - geometry.offset)).toBeLessThan(1);
    expect(geometry.title.height).toBeLessThan(36);
    expect(geometry.tabs.height).toBe(52);
    expect(geometry.tabRow.height).toBe(52);
    expect(geometry.selectAll.height).toBeGreaterThanOrEqual(44);
    expect(geometry.selectAll.width).toBeGreaterThanOrEqual(44);
    expect(geometry.selectAll.x + geometry.selectAll.width).toBeLessThanOrEqual(
      geometry.tabRow.x + geometry.tabRow.width,
    );
    expect(geometry.selectAll.bottom).toBeLessThan(geometry.row.top);
    expect(geometry.check.width).toBe(24);
    expect(geometry.row.background).toBe('rgb(64, 56, 49)');
    expect(geometry.button.height).toBeGreaterThanOrEqual(44);
    expect(geometry.bar.bottom).toBe(560);
    await writeFile(`work/publication/geometry-${width}.json`, JSON.stringify(geometry, null, 2));
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const last = await root.locator('.metadata-row').last().boundingBox(),
      bar = await root.locator('.publication-actions').boundingBox();
    expect(last.y + last.height).toBeLessThan(bar.y);
    await expect(perform).toBeInViewport();
    await page.evaluate(() => scrollTo(0, 0));
  }
  const before = mock.calls.length;
  mock.fault('/move_batch_v2', 429);
  const release = mock.hold('/move_batch_v2');
  try {
    await perform.click();
    await expect(selected).toHaveText('2 filer publiseres · 1 fil avpubliseres');
    await expect(perform).toBeDisabled();
    await expect(perform).toHaveCSS('cursor', 'default');
    await expect(action(page, 'Velg alle')).toBeDisabled();
    await expect(root.locator('.metadata-row').first()).toBeDisabled();
    await expect(syncIcon).toBeVisible();
    await expect(syncIcon).toHaveCSS('animation-name', 'sync-rotation');
    await expect(page.locator('#header-sync')).toHaveCSS('opacity', '0.65');
    await expect(page.locator('.environment')).toHaveCSS('opacity', '0');
    await page.screenshot({path: 'work/publication/under-utfør-1440.png'});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await expect(syncIcon).toBeVisible();
    await expect(syncIcon).toHaveCSS('animation-name', 'none');
    await expect(page.locator('#header-sync svg')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('#header-sync')).toHaveCSS('transition-duration', '0s');
    await page.emulateMedia({reducedMotion: 'no-preference'});
  } finally {
    release();
  }
  await expect(selected).toHaveText('2 filer ble publisert · 1 fil ble avpublisert');
  await expect(syncIcon).toBeVisible();
  await expect(syncIcon).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.environment')).toHaveCSS('opacity', '1');
  await expect(summary).toHaveText(['21', '20', '1']);
  const writes = mock.calls.slice(before).filter(call => call.endpoint.endsWith('/move_batch_v2'));
  expect(writes.map(call => call.args.entries.length)).toEqual([3, 3]);
  expect(
    writes[1].args.entries.every(entry => entry.from_path.startsWith('id:') && entry.to_path.startsWith('id:')),
  ).toBe(true);
  expect(
    mock.calls
      .slice(mock.calls.indexOf(writes[0]) + 1, mock.calls.indexOf(writes[1]))
      .some(call => call.endpoint.endsWith('/list_folder/continue')),
  ).toBe(true);
  expect(mock.find('/Songbooks/Band/Shared/bela.cho')).toBeTruthy();
  expect(mock.find('/Songbooks/Standard/Private/withdraw.cho')).toBeTruthy();
  expect(mock.calls.some(call => call.endpoint.includes('/sharing/'))).toBe(false);
  await page.screenshot({path: 'work/publication/etter-utfør-1440.png'});
  const next = root.getByRole('button', {name: 'Alfa, G, 3/4'});
  await next.click();
  await expect(selected).toHaveText('0 valgt for publisering · 1 for avpublisering');
  await next.click();
  await context.setOffline(true);
  await expect(action(page, 'Velg alle')).toBeDisabled();
  await expect(perform).toBeDisabled();
  await expect(perform).toHaveCSS('cursor', 'default');
  await expect(root.getByText('Uten nett. Publisering og avpublisering krever forbindelse til Dropbox.')).toBeVisible();
  await go(page, 'Sanger');
  await go(page, 'Publisering');
  await expect(summary).toHaveText(['21', '20', '1']);
  await expect(selected).toHaveText('0 valgt for publisering · 0 for avpublisering');
  await page.setViewportSize({width: 320, height: 560});
  await page.screenshot({path: 'work/publication/offline-320.png'});
  await context.setOffline(false);
  await expect(action(page, 'Velg alle')).toBeEnabled();
  expect(mock.calls.filter(call => call.endpoint.endsWith('/move_batch_v2')).slice(-2)).toEqual(writes);
  await go(page, 'Synkronisering');
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
  await action(page, 'Koble fra').click();
  await page.getByRole('dialog').getByRole('button', {name: 'Koble fra', exact: true}).click();
  await openMenu(page);
  await expect(action(page, 'Publisering')).toHaveCount(0);
});

test('AK39-03: an HTTP 429 retry leaves songs with a changed path or revision out of the next batch', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context);
  await go(page, 'Publisering');
  const root = page.locator('#publication'),
    counts = root.locator('.publication-actions p');
  await action(page, 'Velg alle').click();
  await page.getByRole('tab', {name: 'Publisert', exact: true}).click();
  await root.getByRole('button', {name: 'Avpubliser meg, G, 3/4'}).click();
  const start = mock.calls.length,
    originalPath = '/Songbooks/Band/Originals/bela.cho';
  const refreshedPath = '/Songbooks/Band/Private/zeda.cho';
  const withdrawal = mock.find('/Songbooks/Standard/Shared/withdraw.cho').id;
  mock.fault('/move_batch_v2', 429);
  const release = mock.hold('/move_batch_v2');
  try {
    await action(page, 'Utfør').click();
    await expect.poll(() => mock.calls.slice(start).some(call => call.endpoint.endsWith('/move_batch_v2'))).toBe(true);
    mock.rename('/Songbooks/Band/Private/bela.cho', originalPath);
    mock.put(refreshedPath, '{t: Zulu, ny revisjon}\nEndret i Dropbox');
  } finally {
    release();
  }
  await expect(counts).toHaveText('1 fil ble avpublisert');
  await expect(root.getByText(/2 gjenstår/)).toBeVisible();
  const writes = mock.calls.slice(start).filter(call => call.endpoint.endsWith('/move_batch_v2'));
  expect(writes.map(call => call.args.entries.length)).toEqual([3, 1]);
  expect(writes[1].args.entries[0].from_path).toBe(withdrawal);
  expect(mock.find(originalPath)).toBeTruthy();
  expect(mock.find(refreshedPath).text).toContain('Endret i Dropbox');
  expect(mock.find('/Songbooks/Band/Shared/bela.cho')).toBeFalsy();
  expect(mock.find('/Songbooks/Band/Shared/zeda.cho')).toBeFalsy();
  expect(mock.calls.slice(start).filter(call => call.endpoint.endsWith('/get_metadata'))).toHaveLength(0);
  expect(JSON.parse(mock.find('/.app/mutation.json').text).owner).toBe(null);
});

test('AK39-03: a throttled OAuth refresh after fresh metadata revalidates the whole move batch', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context);
  await go(page, 'Publisering');
  const root = page.locator('#publication'),
    counts = root.locator('.publication-actions p');
  await action(page, 'Velg alle').click();
  const start = mock.calls.length,
    moveRoute = '/2/files/move_batch_v2';
  const movedExternally = '/Songbooks/Band/Originals/bela.cho';
  const eligible = mock.find('/Songbooks/Band/Private/zeda.cho').id;
  let renewalNeeded = false,
    tokenCalls = 0;
  await context.route('https://api.dropboxapi.com/2/files/list_folder/continue', async route => {
    if (!renewalNeeded && mock.calls.slice(start).some(call => call.endpoint === moveRoute)) {
      renewalNeeded = true;
      // The current metadata request already holds a valid bearer.
      await page.evaluate(() => {
        const key = 'hobos-songbook-test:dropbox-auth-v1';
        const auth = JSON.parse(localStorage.getItem(key));
        localStorage.setItem(key, JSON.stringify({...auth, expires: Date.now() + 59000}));
      });
    }
    await route.fallback();
  });
  await context.route('https://api.dropboxapi.com/oauth2/token', async route => {
    if (++tokenCalls !== 1) return route.fallback();
    mock.rename('/Songbooks/Band/Private/bela.cho', movedExternally);
    mock.put(movedExternally, '{t: Alfa, ny versjon}\nEndret fra Dropbox');
    return route.fulfill({
      status: 429,
      headers: {'Retry-After': '1'},
      json: {error: {reason: {'.tag': 'too_many_requests'}}},
    });
  });
  mock.fault('/move_batch_v2', 429);
  await action(page, 'Utfør').click();
  await expect(counts).toHaveText('1 fil ble publisert', {timeout: 15000});
  expect(tokenCalls).toBe(2);
  const calls = mock.calls.slice(start),
    writes = calls.filter(call => call.endpoint === moveRoute);
  expect(writes.map(call => call.args.entries.length)).toEqual([2, 1]);
  expect(writes[1].args.entries[0].from_path).toBe(eligible);
  const renewal = calls.findIndex(call => call.endpoint === '/oauth2/token');
  expect(renewal).toBeGreaterThan(-1);
  expect(
    calls.slice(renewal + 1, calls.indexOf(writes[1])).some(call => call.endpoint.endsWith('/list_folder/continue')),
  ).toBe(true);
  expect(calls.filter(call => call.endpoint.endsWith('/get_metadata'))).toHaveLength(0);
  expect(mock.find(movedExternally).text).toContain('Endret fra Dropbox');
  expect(mock.find('/Songbooks/Band/Shared/bela.cho')).toBeFalsy();
  expect(mock.find('/Songbooks/Band/Shared/zeda.cho').id).toBe(eligible);
});

test('AK39-03: server-reported token expiry revalidates publication before a second batched launch', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context);
  await go(page, 'Publisering');
  await action(page, 'Velg alle').click();
  const start = mock.calls.length;
  const movedExternally = '/Songbooks/Band/Originals/bela.cho';
  const eligible = mock.find('/Songbooks/Band/Private/zeda.cho').id;
  let offered = 0,
    renewed = 0,
    afterExpiry = 0;
  await context.route('https://api.dropboxapi.com/2/files/move_batch_v2', async route => {
    if (offered++) {
      expect(mock.calls.slice(afterExpiry).some(call => call.endpoint.endsWith('/list_folder/continue'))).toBe(true);
      expect(route.request().headers().authorization).toBe('Bearer renewed');
      return route.fallback();
    }
    expect(route.request().postDataJSON().entries).toHaveLength(2);
    afterExpiry = mock.calls.length;
    mock.rename('/Songbooks/Band/Private/bela.cho', movedExternally);
    return route.fulfill({status: 401, json: {error: {'.tag': 'expired_access_token'}}});
  });
  await context.route('https://api.dropboxapi.com/oauth2/token', async route => {
    renewed++;
    return route.fulfill({json: {access_token: 'renewed', expires_in: 3600}});
  });
  await action(page, 'Utfør').click();
  await expect(page.locator('#publication .publication-actions p')).toHaveText('1 fil ble publisert');
  expect(renewed).toBe(1);
  expect(offered).toBe(2);
  const calls = mock.calls.slice(start);
  expect(
    calls
      .filter(call => call.endpoint.endsWith('/move_batch_v2'))
      .map(call => call.args.entries.map(entry => entry.from_path)),
  ).toEqual([[eligible]]);
  expect(calls.filter(call => call.endpoint.endsWith('/get_metadata'))).toHaveLength(0);
  expect(mock.find(movedExternally)).toBeTruthy();
});

test('F61/AK39-03: a publication still in progress keeps the job and leaves ordinary sync status alone', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context);
  await go(page, 'Publisering');
  await action(page, 'Velg alle').click();
  mock.asyncMove(100);
  await action(page, 'Utfør').click();
  await expect(page.getByText(/2 gjenstår\. Dropbox har ennå ikke bekreftet/)).toBeVisible({timeout: 12000});
  expect(mock.moveJobs.size).toBe(1);
  const [jobId] = mock.moveJobs.keys();
  await go(page, 'Synkronisering');
  const status = page.locator('#sync-status');
  await expect(status).toHaveText('Ikke synkronisert');
  const start = mock.calls.length;
  await action(page, 'Synkroniser').click();
  await expect(status).toHaveText('Synkroniserer…');
  await expect(status).toHaveText('Ikke synkronisert', {timeout: 12000});
  await expect(page.getByRole('button', {name: 'Kopier feillogg', exact: true})).toBeHidden();
  const calls = mock.calls.slice(start);
  expect(calls.filter(call => call.endpoint.endsWith('/check_v2')).map(call => call.args.async_job_id)).toEqual(
    Array(5).fill(jobId),
  );
  expect(calls.filter(call => call.endpoint.endsWith('/move_batch_v2'))).toHaveLength(0);
  expect(JSON.parse(mock.find('/.app/mutation.json').text).owner).toBeTruthy();
});

test('AK39-05/F61: a rejected sharing grant returns to the songbook action with ordinary sync still connected', async ({
  page,
  context,
  request,
}) => {
  const preview = 'https://geirskoglund.github.io/hobos-songbook/test/';
  const mock = await dropboxMock(context);
  await context.addInitScript(redirect => {
    sessionStorage.setItem(
      'hobos-songbook-test:dropbox-pkce-v1',
      JSON.stringify({
        state: 'sharing-return',
        verifier: 'fixture-verifier',
        redirect,
        created: Date.now(),
        sharing: {accountId: 'dbid:fixture', bookId: 'standard'},
      }),
    );
  }, preview);
  await context.route('https://geirskoglund.github.io/hobos-songbook/**', async route => {
    const requested = new URL(route.request().url());
    const response = await request.get(requested.pathname);
    await route.fulfill({response});
  });
  await context.route('https://api.dropboxapi.com/oauth2/token', route =>
    route.fulfill({
      json: {
        access_token: 'sharing-access',
        refresh_token: 'sharing-refresh',
        expires_in: 3600,
        account_id: 'dbid:fixture',
        scope:
          'account_info.read files.metadata.read files.content.read files.content.write sharing.read sharing.write',
      },
    }),
  );
  let rejected = 0;
  await context.route('https://api.dropboxapi.com/2/users/get_current_account', route => {
    rejected++;
    expect(route.request().headers().authorization).toBe('Bearer sharing-access');
    return route.fulfill({status: 401, json: {error: {'.tag': 'invalid_access_token'}}});
  });
  await page.goto(preview + '?code=synthetic&state=sharing-return');
  await expect(page.locator('#songbooks-status')).toHaveText(
    'Dropbox ga ikke tilgang til delingslenker. Velg Kopier delingslenke for å prøve igjen.',
  );
  expect(rejected).toBe(1);
  expect(mock.calls.filter(call => call.endpoint.startsWith('/2/sharing/'))).toHaveLength(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('hobos-songbook-test:dropbox-auth-v1')).refreshToken),
  ).toBe('fixture-refresh');
  await go(page, 'Synkronisering');
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
  await expect(action(page, 'Koble til Dropbox')).toBeHidden();
});

for (const operation of ['share link', 'publish'])
  test(`F04: confirmed access loss during ${operation} shows the existing reconnect action`, async ({
    page,
    context,
  }) => {
    const mock = await seed(page, context, {sharing: true});
    const sharing = operation === 'share link';
    const endpoint = sharing ? '/2/sharing/list_shared_links' : '/2/files/move_batch_v2';
    let rejected = 0,
      refreshes = 0;
    await context.route('https://api.dropboxapi.com' + endpoint, route => {
      rejected++;
      return route.fulfill({status: 401, json: {error: {'.tag': 'expired_access_token'}}});
    });
    await context.route('https://api.dropboxapi.com/oauth2/token', route => {
      refreshes++;
      return route.fulfill({status: 400, json: {error: 'invalid_grant'}});
    });
    if (sharing) {
      await go(page, 'Sangbøker');
      await action(page, 'Handlinger for Standard').click();
      await page.getByRole('menuitem', {name: 'Kopier delingslenke', exact: true}).click();
    } else {
      await go(page, 'Publisering');
      await action(page, 'Velg alle').click();
      await action(page, 'Utfør').click();
    }
    await expect(action(page, 'Koble til Dropbox')).toBeVisible();
    await expect(page.locator('#sync .sync-connect [role=status]')).toHaveText(
      'Synkronisering feilet (Feilkode SYNC-004). Koble til Dropbox på nytt.',
    );
    await expect(page.getByRole('button', {name: 'Kopier feillogg', exact: true})).toBeVisible();
    const report = await page.evaluate(() => {
      const log = JSON.parse(localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1'));
      return log.entries.find(entry => entry.id === log.active);
    });
    expect(report.failure).toMatchObject({code: 'SYNC-004', status: 400, action: 'reconnect'});
    expect(report.operations.map(call => call.status)).toEqual(expect.arrayContaining([401, 400]));
    await expect(page.locator('#songbooks-status')).toHaveText('');
    expect([rejected, refreshes]).toEqual([1, 1]);
    expect(mock.find('/Songbooks/Band/Private/bela.cho')).toBeTruthy();
  });

test('AK39-03: a terminal per-file Dropbox write lock acknowledges successes and frees the mutation fence', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context);
  await go(page, 'Publisering');
  const root = page.locator('#publication'),
    counts = root.locator('.publication-actions p');
  await action(page, 'Velg alle').click();
  const failed = mock.find('/Songbooks/Band/Private/zeda.cho').id;
  mock.failMoveEntry(failed, 3);
  const start = mock.calls.length;
  await action(page, 'Utfør').click();
  await expect(counts).toHaveText('2 filer publiseres');
  await expect(counts).toHaveText('1 fil ble publisert', {timeout: 15000});
  await expect(root.getByText(/1 gjenstår.*Dropbox ber om en pause/)).toBeVisible();
  expect(JSON.parse(mock.find('/.app/library.json').text).songs.bela.path).toBe('/Songbooks/Band/Shared/bela.cho');
  expect(JSON.parse(mock.find('/.app/mutation.json').text).owner).toBe(null);
  expect(
    mock.calls
      .slice(start)
      .filter(call => call.endpoint.endsWith('/move_batch_v2'))
      .map(call => call.args.entries.map(entry => entry.from_path).sort()),
  ).toEqual([[mock.find('/Songbooks/Band/Shared/bela.cho').id, failed].sort(), [failed], [failed]]);
  await action(page, 'Utfør').click();
  await expect(counts).toHaveText('1 fil ble publisert');
  await expect(root.getByText('Ingen upubliserte sanger.')).toBeVisible();
  await go(page, 'Sanger');
  await go(page, 'Publisering');
  await expect(counts).toHaveText('0 valgt for publisering · 0 for avpublisering');
});

test('AK39-03: a terminal HTTP 429 settles earlier confirmed batches within the cooldown budget', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context, {additionalPrivate: 99});
  await go(page, 'Publisering');
  const root = page.locator('#publication'),
    counts = root.locator('.publication-actions p');
  await action(page, 'Velg alle').click();
  await expect(counts).toHaveText('101 valgt for publisering · 0 for avpublisering');
  mock.fault('/move_batch_v2', 429, 1, {repeat: 3, retryAfter: 1});
  const start = mock.calls.length;
  await action(page, 'Utfør').click();
  await expect(counts).toHaveText('100 filer ble publisert', {timeout: 20000});
  await expect(root.getByText(/1 gjenstår.*Dropbox ber om en pause/)).toBeVisible();
  const manifest = JSON.parse(mock.find('/.app/library.json').text);
  expect(Object.values(manifest.songs).filter(link => link.path.startsWith('/Songbooks/Band/Shared/'))).toHaveLength(
    100,
  );
  expect(JSON.parse(mock.find('/.app/mutation.json').text).owner).toBe(null);
  const moves = mock.calls.slice(start).filter(call => call.endpoint.endsWith('/move_batch_v2'));
  expect(moves.map(call => call.args.entries.length)).toEqual([100, 1, 1, 1]);
  const remainingId = moves[1].args.entries[0].from_path;
  expect(moves.slice(1).map(call => call.args.entries[0].from_path)).toEqual(Array(3).fill(remainingId));
  expect(moves[0].args.entries.some(entry => entry.from_path === remainingId)).toBe(false);
  expect(mock.find(remainingId).path_display).toMatch(/^\/Songbooks\/Band\/Private\//);
});

test('AK39-03: a move status internal_error confirms a physically finished job without replay', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context);
  await go(page, 'Publisering');
  const root = page.locator('#publication'),
    counts = root.locator('.publication-actions p');
  const path = '/Songbooks/Band/Shared/bela.cho';
  const fileId = mock.find('/Songbooks/Band/Private/bela.cho').id;
  const start = mock.calls.length;
  let checks = 0;
  mock.asyncMove(0);
  await context.route('https://api.dropboxapi.com/2/files/move_batch/check_v2', route => {
    checks++;
    mock.finishMoves();
    return route.fulfill({status: 409, json: {error: {'.tag': 'internal_error'}}});
  });
  await root.getByRole('button', {name: 'Alfa, G, 3/4'}).click();
  await action(page, 'Utfør').click();
  await expect(counts).toHaveText('1 fil ble publisert');
  expect(checks).toBe(1);
  expect(mock.find(path).id).toBe(fileId);
  expect(JSON.parse(mock.find('/.app/library.json').text).songs.bela.path).toBe(path);
  expect(JSON.parse(mock.find('/.app/mutation.json').text).owner).toBe(null);
  await root.getByRole('button', {name: 'Zulu, G, 3/4'}).click();
  await action(page, 'Utfør').click();
  await expect(counts).toHaveText('1 fil ble publisert');
  const calls = mock.calls.slice(start);
  expect(calls.filter(call => call.endpoint.endsWith('/move_batch_v2')).map(call => call.args.entries.length)).toEqual([
    1, 1,
  ]);
  expect(calls.filter(call => call.endpoint.endsWith('/get_metadata'))).toHaveLength(0);
  expect(checks).toBe(1);
});

test('AK39-05: the songbook H04 action creates and reuses one read link, with manual copy fallback', async ({
  page,
  context,
}) => {
  const mock = await seed(page, context, {sharing: true});
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.copied = text;
        },
      },
    }),
  );
  await go(page, 'Sangbøker');
  const menu = page.getByRole('button', {name: 'Handlinger for Standard', exact: true});
  const share = page.getByRole('menuitem', {name: 'Kopier delingslenke', exact: true});
  await menu.click();
  const icon = await share.locator('svg').evaluate(svg => svg.outerHTML);
  expect(icon).toContain('aria-hidden="true"');
  expect(await share.locator('span').textContent()).toBe('Kopier delingslenke');
  await page.screenshot({path: 'work/publication/sangbokmeny.png'});
  expect(mock.links.size).toBe(0);
  await share.click();
  await expect(page.getByText('Delingslenken er kopiert.')).toBeVisible();
  const folderId = mock.find('/Songbooks/Standard/Shared').id;
  const list = mock.calls.filter(call => call.endpoint.endsWith('/list_shared_links'));
  expect(list[0].args).toEqual({path: folderId, direct_only: true});
  const link = mock.links.get(folderId);
  expect(link.path_lower).toBe('/songbooks/standard/shared');
  expect(await page.evaluate(() => window.copied)).toBe(link.url);
  const created = mock.calls.filter(call => call.endpoint.endsWith('/create_shared_link_with_settings'));
  expect(created).toHaveLength(1);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error('Clipboard unavailable');
        },
      },
    });
    document.execCommand = () => false;
  });
  await menu.click();
  await share.click();
  const fallback = page.getByRole('dialog', {name: 'Delingslenke'});
  await expect(fallback).toBeVisible();
  const field = fallback.getByRole('textbox', {name: 'Delingslenke'});
  await expect(field).toHaveValue(link.url);
  await expect(field).toHaveAttribute('readonly', '');
  await page.screenshot({path: 'work/publication/lenke-manuell.png'});
  await field.click({button: 'right'});
  await expect(page.getByRole('menuitem', {name: 'Merk alt'})).toBeVisible();
  await expect(page.getByRole('menuitem', {name: 'Kopier', exact: true})).toBeVisible();
  expect(mock.calls.filter(call => call.endpoint.endsWith('/create_shared_link_with_settings'))).toEqual(created);
});

test('AK39-05: a rejected share creation verifies the active folder again after waiting', async ({page, context}) => {
  const mock = await seed(page, context, {sharing: true});
  await go(page, 'Sangbøker');
  await action(page, 'Handlinger for Standard').click();
  const share = page.getByRole('menuitem', {name: 'Kopier delingslenke', exact: true});
  const creates = () => mock.calls.filter(call => call.endpoint.endsWith('/create_shared_link_with_settings'));
  mock.fault('/create_shared_link_with_settings', 429, 0, {retryAfter: 1});
  const release = mock.hold('/create_shared_link_with_settings');
  try {
    await share.click();
    await expect.poll(() => creates().length).toBe(1);
    mock.put('/Deleted', '', true);
    mock.rename('/Songbooks/Standard', '/Deleted/Standard');
  } finally {
    release();
  }
  await expect(
    page.getByText('Sangbokens delingsmappe har flyttet seg. Kontroller sangboken og prøv igjen.'),
  ).toBeVisible();
  expect(creates()).toHaveLength(1);
  expect(mock.links.size).toBe(0);
  expect(JSON.parse(mock.find('/.app/mutation.json').text).owner).toBe(null);
});

test('AK39-05: terminal 429 on a link lookup releases the account fence within the same run', async ({
  page,
  context,
  browser,
}) => {
  const mock = await dropboxMock(context, {sharing: true});
  const lockOwner = () => mock.find('/.app/mutation.json') && JSON.parse(mock.find('/.app/mutation.json').text).owner;
  await page.goto(url);
  await expect.poll(lockOwner).toBe(null);
  await importAndOpenSong(page, 'Prøve.cho', '{t: Prøvesang}\nTest');
  await goSongs(page);
  await expect.poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length).toBe(1);
  await expect.poll(lockOwner).toBe(null);
  const peer = await browser.newContext({serviceWorkers: 'block'});
  const copyLink = async page => {
    await go(page, 'Sangbøker');
    await action(page, 'Handlinger for Standard').click();
    await page.getByRole('menuitem', {name: 'Kopier delingslenke', exact: true}).click();
  };
  try {
    const second = await dropboxMock(peer, {sharing: true, backend: mock});
    const otherPage = await peer.newPage();
    await otherPage.goto(url);
    await go(otherPage, 'Synkronisering');
    await action(otherPage, 'Synkroniser').click();
    await expect(otherPage.locator('#sync-status')).toContainText('Sist synkronisert');
    const start = mock.calls.length;
    mock.fault('/list_shared_links', 429, 0, {repeat: 3, retryAfter: 1});
    await copyLink(page);
    await expect(page.getByText('Kunne ikke hente delingslenken fra Dropbox. Prøv igjen.')).toBeVisible({
      timeout: 16000,
    });
    const calls = mock.calls.slice(start);
    expect(calls.filter(call => call.endpoint.endsWith('/list_shared_links'))).toHaveLength(3);
    expect(calls.filter(call => call.endpoint.endsWith('/create_shared_link_with_settings'))).toHaveLength(0);
    expect(calls.filter(call => call.endpoint.endsWith('/upload')).map(call => call.args.path)).toEqual([
      '/.app/mutation.json',
      '/.app/mutation.json',
    ]);
    expect(lockOwner()).toBe(null);
    const until = await page.evaluate(
      () => JSON.parse(localStorage.getItem('hobos-songbook-test:dropbox-rate-v1')).until,
    );
    expect(Date.now()).toBeGreaterThanOrEqual(until);

    await go(otherPage, 'Publisering');
    await action(otherPage, 'Velg alle').click();
    await action(otherPage, 'Utfør').click();
    await expect(otherPage.locator('.publication-actions p')).toHaveText('1 fil ble publisert');
    expect(
      second.calls.filter(call => call.endpoint.endsWith('/move_batch_v2')).map(call => call.args.entries.length),
    ).toEqual([1]);
  } finally {
    await peer.close();
  }
});

test('AK39-04: cancel leaves both songs in place, confirmed offline deletion moves them privately and archives the book', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  const manifest = () => JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{},"books":{}}');
  for (const [i, title] of ['Én privat', 'Én publisert'].entries()) {
    await importAndOpenSong(page, `sang-${i}.cho`, `{t: ${title}}\n[C]Original`);
    await goSongs(page);
    await expect.poll(() => Object.keys(manifest().songs).length).toBe(i + 1);
  }
  const songs = await savedSongs(page),
    one = songs.find(song => song.title === 'Én privat'),
    two = songs.find(song => song.title === 'Én publisert');
  await go(page, 'Sangbøker');
  await action(page, 'Ny sangbok').click();
  await page.getByRole('textbox').fill('Mål');
  await action(page, 'Lagre').click();
  await expect.poll(() => Object.values(manifest().books).some(book => book.name === 'Mål')).toBe(true);
  await go(page, 'Publisering');
  await page.locator(`#publication [data-song-id="${two.id}"]`).click();
  await action(page, 'Utfør').click();
  await expect(page.locator('#publication .publication-actions p')).toHaveText('1 fil ble publisert');
  const before = manifest(),
    sidecar = mock.find(`/.app/songs/${two.id}.json`).text;
  await go(page, 'Sangbøker');
  const dialog = page.getByRole('dialog', {name: 'Slett sangbok'});
  async function deleteBook() {
    await action(page, 'Handlinger for Standard').click();
    await page.getByRole('menuitem', {name: 'Slett', exact: true}).click();
    await expect(dialog.getByText(/Egne sanger blir private i målboken/)).toBeVisible();
    await dialog.getByRole('button', {name: /Sangbok: Velg sangbok/}).click();
    await dialog.getByRole('option', {name: 'Mål', exact: true}).click();
  }
  await deleteBook();
  await dialog.getByRole('button', {name: 'Avbryt', exact: true}).click();
  expect(manifest()).toEqual(before);
  await context.setOffline(true);
  await deleteBook();
  await dialog.getByRole('button', {name: 'Slett', exact: true}).click();
  await expect(dialog).toBeHidden();
  expect(mock.find(before.songs[two.id].fileId).path_display).toContain('/Standard/Shared/');
  mock.rename(before.songs[one.id].fileId, '/Songbooks/Standard/Shared/sang-0.cho');
  const start = mock.calls.length;
  await context.setOffline(false);
  await expect.poll(() => mock.find(before.books.standard.folderId)?.path_display).toContain('/Deleted/Standard ');
  await expect.poll(() => manifest().songs[two.id]?.path).toBe('/Songbooks/Mål/Private/sang-1.cho');
  expect(mock.find(before.songs[one.id].fileId).path_display).toBe('/Songbooks/Mål/Private/sang-0.cho');
  expect(mock.find(before.songs[two.id].fileId).path_display).toBe('/Songbooks/Mål/Private/sang-1.cho');
  expect(mock.find(`/.app/songs/${two.id}.json`).text).toBe(sidecar);
  const held = mock.calls.slice(start).filter(call => call.endpoint.endsWith('/move_batch_v2'));
  expect(held.map(call => call.args.entries.length)).toEqual([2, 1]);
  expect((await savedSongs(page)).map(song => song.id).sort()).toEqual([one.id, two.id].sort());
});
