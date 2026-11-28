import {test, expect} from './fixtures.mjs';
import {dropboxMock} from './dropbox-mock.mjs';
import {openMenu, importAndOpenSong, goSongs} from './song-helpers.mjs';
import {stubClipboard, copiedText} from './clipboard-stub.mjs';
const url = '/hobos-songbook/test/';
async function syncPage(page) {
  await openMenu(page);
  await page.locator('#main-menu').getByRole('button', {name: 'Synkronisering', exact: true}).click();
}
async function fail(page, mock, status = 500) {
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  mock.fault('/list_folder/continue', status);
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Synkronisering feilet (Feilkode');
}
test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});

test('documented Dropbox folder creation completes all book folders without a false failure or log', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  for (const path of [
    '/Songbooks',
    '/Songbooks/Standard',
    '/Songbooks/Standard/Private',
    '/Songbooks/Standard/Shared',
    '/Songbooks/Standard/Import',
    '/Songbooks/Standard/Originals',
  ])
    expect(mock.find(path)?.['.tag']).toBe('folder');
  await expect(page.locator('#sync-status')).not.toContainText('feilet');
  await expect(page.getByRole('button', {name: 'Kopier feillogg', exact: true})).toBeHidden();
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  await importAndOpenSong(page, 'sang.cho', '{t: Frisk synk}\n[D]Tekst');
  await expect(page.locator('#sync-status')).not.toContainText('feilet');
  await goSongs(page);
  await expect.poll(() => Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length).toBe(1);
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
});
test('only the copy icon acts on an error; exact message and private-data-free technical log reach the clipboard', async ({
  page,
  context,
}) => {
  await stubClipboard(page);
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await fail(page, mock);
  const copy = page.getByRole('button', {name: 'Kopier feillogg', exact: true});
  await expect(copy).toBeVisible();
  await expect(page.locator('#sync-status')).toHaveCSS('text-decoration-line', 'none');
  await expect(page.locator('#sync-status')).toHaveCSS('color', 'rgb(199, 186, 169)');
  await page.locator('#sync-status').click({position: {x: 5, y: 5}});
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 800});
    await expect(copy).toBeInViewport();
    expect((await copy.boundingBox()).width).toBe(44);
    expect((await copy.boundingBox()).height).toBe(44);
    await expect(copy.locator('.icon')).toHaveCSS('width', '20px');
    expect(await page.locator('#sync-status .sync-error-code').evaluate(n => n.getClientRects().length)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({path: `work/sync-diagnostics/error-copy-${width}.png`});
  }
  await page.locator('#dropbox-sync').focus();
  await page.keyboard.press('Tab');
  await expect(copy).toBeFocused();
  await copy.press('Enter');
  await expect(copy).toBeEnabled();
  const text = await copiedText(page),
    [message, json] = text.split('\n\n'),
    entry = JSON.parse(json);
  expect(message).toBe('Synkronisering feilet (Feilkode SYNC-003)');
  expect(entry.failure.code).toBe('SYNC-003');
  expect(entry.failure.status).toBe(500);
  expect(entry.manual).toBe(true);
  expect(entry.environment.browser).toBe('Chrome');
  expect(entry.environment.browserVersion).toMatch(/^\d/);
  expect(entry.environment.os).toBeTruthy();
  expect(entry.operations.some(o => o.operation === 'files/list_folder/continue' && o.status === 500)).toBe(true);
  for (const forbidden of [
    'fixture-access',
    'fixture-refresh',
    'dbid:fixture',
    'Prøvebruker',
    '@eksempel.no',
    'Authorization',
    'userAgent',
    'path_display',
  ])
    expect(text).not.toContain(forbidden);
  await expect.poll(() => Boolean(mock.find('/.app/sync-errors.json'))).toBe(true);
  expect(JSON.parse(mock.find('/.app/sync-errors.json').text).entries.some(e => e.id === entry.id)).toBe(true);
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  await expect(copy).toBeHidden();
  // The test address keeps a timing log after a successful sync; it holds no paths and is not uploaded.
  const timing = page.getByRole('button', {name: 'Kopier synklogg', exact: true});
  await expect(page.locator('#sync-status button:visible')).toHaveCount(1);
  await expect(timing).toBeVisible();
  const uploads = mock.calls.length;
  await timing.click();
  const log = await copiedText(page);
  expect(log).toMatch(/^Synklogg Hobo's Songbook Test /);
  expect(log).toMatch(/manuell ok: \d+ ms, \d+ kall \d+ ms, utenom kall -?\d+ ms/);
  expect(log).toContain('[synk]');
  expect(log).toContain('files/list_folder');
  for (const forbidden of ['Songbooks', 'library.json', '.cho']) expect(log).not.toContain(forbidden);
  expect(mock.calls.length).toBe(uploads);
});
test('a local error can be copied after an offline restart without Dropbox', async ({page, context}) => {
  await stubClipboard(page);
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect(page.locator('#offline-status')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await fail(page, mock);
  const before = JSON.parse(
    await page.evaluate(() => localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1')),
  ).active;
  await context.setOffline(true);
  await page.reload();
  await syncPage(page);
  await expect(page.locator('#sync-status')).toHaveText('Synkronisering feilet (Feilkode SYNC-003)');
  await page.getByRole('button', {name: 'Kopier feillogg', exact: true}).click();
  const text = await copiedText(page);
  expect(JSON.parse(text.split('\n\n')[1]).id).toBe(before);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
test('failed clipboard access preserves the log and does not add status text', async ({page, context}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error('blocked');
        },
      },
    });
    document.execCommand = () => {
      throw Error('blocked fallback');
    };
  });
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await fail(page, mock);
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1')).active,
  );
  await page.getByRole('button', {name: 'Kopier feillogg', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Kopier feillogg', exact: true})).toBeEnabled();
  await expect(page.locator('#sync-status')).toHaveText('Synkronisering feilet (Feilkode SYNC-003)');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1')).active),
  ).toBe(before);
  await expect(page.locator('#sync-status textarea')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
test('an authentication failure remains locally copyable after Dropbox access is removed', async ({page, context}) => {
  await stubClipboard(page);
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  mock.fault('/list_folder/continue', 401);
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#dropbox-connect')).toBeVisible();
  await expect(page.locator('.sync-connect [role=status]')).toContainText('Feilkode SYNC-004');
  await expect(page.locator('.sync-connect [role=status]')).toContainText('Koble til Dropbox på nytt.');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 800});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(page.locator('.topbar')).toBeInViewport();
    await expect(page.getByRole('button', {name: 'Kopier feillogg', exact: true})).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({path: `work/sync-diagnostics/auth-error-${width}.png`});
  }
  await page.getByRole('button', {name: 'Kopier feillogg', exact: true}).click();
  const text = await copiedText(page);
  expect(JSON.parse(text.split('\n\n')[1]).failure.code).toBe('SYNC-004');
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
test('a transport failure keeps its log local and uploads it after healthy sync without extra failed requests', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  const before = mock.calls.length;
  await fail(page, mock, 0);
  await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-002');
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  expect(mock.calls.length - before).toBe(1);
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  await expect.poll(() => Boolean(mock.find('/.app/sync-errors.json'))).toBe(true);
  expect(JSON.parse(mock.find('/.app/sync-errors.json').text).entries.at(-1).failure.code).toBe('SYNC-002');
});
test('disconnecting during a retry cannot resurrect its earlier failure or leave an empty status block', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await fail(page, mock);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  await expect.poll(() => Boolean(mock.find('/.app/sync-errors.json'))).toBe(true);
  const release = mock.hold('/list_folder/continue');
  try {
    await page.locator('#dropbox-sync').click();
    await expect(page.locator('#sync-status')).toContainText('Synkroniserer…');
    await page.locator('#dropbox-disconnect').click();
    await page
      .getByRole('dialog', {name: 'Koble fra Dropbox', exact: true})
      .getByRole('button', {name: 'Koble fra', exact: true})
      .click();
  } finally {
    release();
  }
  await expect(page.locator('#dropbox-connect')).toBeVisible();
  await expect(page.locator('.sync-connect [role=status]')).toBeHidden();
  await expect(page.getByRole('button', {name: 'Kopier feillogg', exact: true})).toBeHidden();
  const button = await page.locator('#dropbox-connect').boundingBox(),
    container = await page.locator('.sync-connect').boundingBox();
  expect(Math.abs(button.y + button.height / 2 - container.y - container.height / 2)).toBeLessThan(2);
});
test('an ordinary Dropbox folder rename waits for manual sync without generating an error or log', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  const book = JSON.parse(mock.find('/.app/library.json').text).books.standard;
  mock.rename(book.folderId, '/Songbooks/Nytt navn');
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  await expect(page.locator('#sync-status')).toHaveText('Ikke synkronisert');
  await expect(page.locator('#sync-status')).not.toContainText('feilet');
  await expect(page.getByRole('button', {name: 'Kopier feillogg', exact: true})).toBeHidden();
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
  expect(JSON.parse(mock.find('/.app/library.json').text).books.standard.name).toBe('Nytt navn');
  expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
});
test('a real folder collision gives concrete user guidance and unconfirmed revocation shows no message', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  mock.entries.delete('/.app/songs');
  mock.put('/.app/songs', 'PRIVATE_FILE_CONTENT');
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-010');
  await expect(page.locator('#sync-status')).toContainText('flytt filen eller endre filnavnet');
  expect(mock.find('/.app/songs').text).toBe('PRIVATE_FILE_CONTENT');
  await page.setViewportSize({width: 320, height: 800});
  await expect(page.getByRole('button', {name: 'Kopier feillogg', exact: true})).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({path: 'work/sync-diagnostics/folder-collision-320.png'});
  mock.fault('/token/revoke', 500);
  await page.locator('#dropbox-disconnect').click();
  await page
    .getByRole('dialog', {name: 'Koble fra Dropbox', exact: true})
    .getByRole('button', {name: 'Koble fra', exact: true})
    .click();
  await expect(page.locator('#dropbox-connect')).toBeVisible();
  await expect(page.locator('.sync-connect [role=status]')).toHaveText('');
});

for (const lostAfterRevoke of [false, true])
  test(`disconnect shows no message when revoke is unconfirmed, also after restart (${lostAfterRevoke ? 'effect with lost reply' : 'request aborted'})`, async ({
    page,
    context,
  }) => {
    const mock = await dropboxMock(context);
    await page.goto(url);
    await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
    await syncPage(page);
    await expect(page.locator('#dropbox-sync')).toBeEnabled();
    let revoked = false;
    await context.route('https://api.dropboxapi.com/2/auth/token/revoke', async route => {
      if (lostAfterRevoke) revoked = true;
      await route.abort('failed');
    });
    await page.locator('#dropbox-disconnect').click();
    await page
      .getByRole('dialog', {name: 'Koble fra Dropbox', exact: true})
      .getByRole('button', {name: 'Koble fra', exact: true})
      .click();
    await expect(page.locator('#dropbox-connect')).toBeVisible();
    await expect(page.locator('.sync-connect [role=status]')).toHaveText('');
    expect(await page.evaluate(() => localStorage.getItem('hobos-songbook-test:dropbox-auth-v1'))).toBeNull();
    expect(revoked).toBe(lostAfterRevoke);
    // The mock's normal connection bootstrap must not reconnect this restart.
    await context.unroute('https://api.dropboxapi.com/2/auth/token/revoke');
    await page.reload();
    await syncPage(page);
    await expect(page.locator('#dropbox-connect')).toBeVisible();
    await expect(page.locator('.sync-connect [role=status]')).toHaveText('');
  });

test('disconnect renews an expired access token before revoking it', async ({page, context}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await syncPage(page);
  await expect(page.locator('#dropbox-sync')).toBeEnabled();
  await page.evaluate(() => {
    const key = 'hobos-songbook-test:dropbox-auth-v1',
      saved = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({...saved, accessToken: 'expired-access', expires: Date.now() - 1000}));
  });
  const bearers = [];
  await context.route('https://api.dropboxapi.com/2/auth/token/revoke', async route => {
    const bearer = route.request().headers().authorization;
    bearers.push(bearer);
    if (bearer === 'Bearer expired-access')
      return route.fulfill({status: 401, json: {error_summary: 'expired_access_token/'}});
    await route.fulfill({status: 200, json: null});
  });
  const start = mock.calls.length;
  await page.locator('#dropbox-disconnect').click();
  await page
    .getByRole('dialog', {name: 'Koble fra Dropbox', exact: true})
    .getByRole('button', {name: 'Koble fra', exact: true})
    .click();
  await expect(page.locator('#dropbox-connect')).toBeVisible();
  await expect.poll(() => bearers).toEqual(['Bearer fixture-access']);
  expect(mock.calls.slice(start).map(c => c.endpoint)).toEqual(['/oauth2/token']);
  await expect(page.locator('.sync-connect [role=status]')).toHaveText('');
});
test('#106: disabled controls show the normal arrow, also where the control otherwise shows a hand', async ({
  page,
  context,
}) => {
  await dropboxMock(context);
  await page.goto(url);
  await syncPage(page);
  const sync = page.locator('#dropbox-sync');
  await expect(sync).toBeEnabled();
  await context.setOffline(true);
  await expect(sync).toBeDisabled();
  await expect(sync).toHaveCSS('cursor', 'default');
  // A dialog footer button sets a hand cursor of its own.
  await page.evaluate(() => {
    const footer = document.createElement('div');
    footer.className = 'dialog-footer';
    footer.innerHTML = '<button type="button" disabled id="probe">Lagre</button>';
    document.body.append(footer);
  });
  await expect(page.locator('#probe')).toHaveCSS('cursor', 'default');
});
