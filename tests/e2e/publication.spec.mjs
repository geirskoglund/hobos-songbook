import {mkdir, writeFile} from 'node:fs/promises';
import {test, expect} from '@playwright/test';
import {dropboxMock} from './dropbox-mock.mjs';
import {goSongs, importAndOpenSong, openMenu, savedSongs} from './song-helpers.mjs';

const url = '/hobos-songbook/test/';
test.beforeEach(async ({request}) => {await request.post('/__test__/reset'); await mkdir('work/publication', {recursive: true});});
const action = (page, name) => page.getByRole('button', {name, exact: true});
async function go(page, name) {await openMenu(page); await action(page, name).click();}
async function seed(page, context, options) {
  const mock = await dropboxMock(context, options);
  await page.goto(url);
  await expect.poll(() => mock.find('/.app/mutation.json') && JSON.parse(mock.find('/.app/mutation.json').text).owner).toBe(null);
  const manifest = JSON.parse(mock.find('/.app/library.json').text);
  const root = mock.put('/Songbooks/Band', '', true);
  for (const area of ['Private', 'Shared', 'Import', 'Originals']) mock.put(`/Songbooks/Band/${area}`, '', true);
  manifest.books.band = {id: 'band', name: 'Band', path: root.path_display, folderId: root.id};
  function song(id, title, book, area, imported = false) {
    const filename = `${id}.cho`, path = `${manifest.books[book].path}/${area}/${filename}`;
    const file = mock.put(path, `{t: ${title}}\n{key: G}\n{time: 3/4}\nOriginal`);
    manifest.songs[id] = {id, songbookId: book, fileId: file.id, path, origin: {kind: imported ? 'external' : 'local', filename, importedAt: '2026-01-01', ...(imported ? {sourceId: 'ext'} : {})}};
  }
  song('zeda', 'Zulu', 'band', 'Private');
  song('bela', 'Alfa', 'band', 'Private');
  song('withdraw', 'Avpubliser meg', 'standard', 'Shared');
  song('hidden', 'Importert', 'standard', 'Private', true);
  for (let i = 0; i < 18; i++) song(`song-${i}`, `Sang ${String(i).padStart(2, '0')}`, 'standard', 'Shared');
  mock.put('/.app/library.json', JSON.stringify(manifest));
  return mock;
}

test('AK39-01–03: shared components, paginated refresh, scoped selection, mixed bulk, last row and offline', async ({page, context}) => {
  const mock = await seed(page, context, {pageSize: 7});
  await page.setViewportSize({width: 320, height: 560});
  await go(page, 'Publisering');
  const root = page.locator('#publication'), summary = root.locator('.publication-summary dd');
  const privateTab = page.getByRole('tab', {name: 'Upublisert', exact: true});
  const sharedTab = page.getByRole('tab', {name: 'Publisert', exact: true});
  const selected = root.locator('.publication-actions p');
  await expect(summary).toHaveText(['21', '19', '2']);
  await expect(privateTab).toHaveAttribute('aria-selected', 'true');
  await expect(root.locator('.song-name')).toHaveText(['Alfa', 'Zulu']);
  await expect(action(page, 'Utfør')).toBeDisabled();
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
  await page.screenshot({path: 'work/publication/publisert-320.png'});
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 560});
    const geometry = await root.evaluate(node => {
      const style = selector => {const item = document.querySelector(selector), computed = getComputedStyle(item), box = item.getBoundingClientRect();return {x: box.x, bottom: box.bottom, height: box.height, width: box.width, size: computed.fontSize, background: computed.backgroundColor, color: computed.color, border: computed.borderBottomWidth, font: computed.fontFamily};};
      const offset = innerWidth / 2;
      return {width: innerWidth, offset, title: style('#page-title'), filter: style('#publication-songbook-filter'), tabs: style('.tab-switcher'), active: style('[role=tab][aria-selected=true]'), row: style('.metadata-row[aria-pressed=true]'), check: style('.choice-check'), button: style('.primary-action'), bar: style('.publication-actions'), overflow: document.documentElement.scrollWidth > innerWidth};
    });
    expect(geometry.overflow).toBe(false);
    expect(Math.abs(geometry.filter.x + geometry.filter.width / 2 - geometry.offset)).toBeLessThan(1);
    expect(geometry.title.height).toBeLessThan(36);
    expect(geometry.tabs.height).toBe(52);
    expect(geometry.check.width).toBe(24);
    expect(geometry.row.background).toBe('rgb(64, 56, 49)');
    expect(geometry.button.height).toBeGreaterThanOrEqual(44);
    expect(geometry.bar.bottom).toBe(560);
    await writeFile(`work/publication/geometry-${width}.json`, JSON.stringify(geometry, null, 2));
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const last = await root.locator('.metadata-row').last().boundingBox(), bar = await root.locator('.publication-actions').boundingBox();
    expect(last.y + last.height).toBeLessThan(bar.y);
    await expect(action(page, 'Utfør')).toBeInViewport();
    await page.evaluate(() => scrollTo(0, 0));
  }
  const before = mock.calls.length;
  mock.fault('/move_batch_v2', 429);
  const release = mock.hold('/move_batch_v2');
  try {
    await action(page, 'Utfør').click();
    await expect(selected).toHaveText('2 filer publiseres · 1 fil avpubliseres');
    await expect(action(page, 'Utfør')).toBeDisabled();
    await expect(action(page, 'Velg alle')).toBeDisabled();
    await expect(root.locator('.metadata-row').first()).toBeDisabled();
    await expect(action(page, 'Utfør').locator('svg')).toHaveCSS('animation-name', 'sync-rotation');
    await expect(page.locator('#header-sync')).toHaveCSS('opacity', '0.65');
    await expect(page.locator('.environment')).toHaveCSS('opacity', '0');
    await page.screenshot({path: 'work/publication/under-utfør-1440.png'});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await expect(action(page, 'Utfør').locator('svg')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('#header-sync svg')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('#header-sync')).toHaveCSS('transition-duration', '0s');
    await page.emulateMedia({reducedMotion: 'no-preference'});
  } finally {release();}
  await expect(selected).toHaveText('2 filer ble publisert · 1 fil ble avpublisert');
  await expect(page.locator('.environment')).toHaveCSS('opacity', '1');
  await expect(summary).toHaveText(['21', '20', '1']);
  const writes = mock.calls.slice(before).filter(call => call.endpoint.endsWith('/move_batch_v2'));
  expect(writes.map(call => call.args.entries.length)).toEqual([3, 3]);
  expect(writes[1].args.entries.every(entry => entry.from_path.startsWith('id:') && entry.to_path.startsWith('id:'))).toBe(true);
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
  await expect(action(page, 'Utfør')).toBeDisabled();
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

test('AK39-03: a terminal per-file Dropbox write lock acknowledges successes and frees the mutation fence', async ({page, context}) => {
  const mock = await seed(page, context);
  await go(page, 'Publisering');
  const root = page.locator('#publication'), counts = root.locator('.publication-actions p');
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
  expect(mock.calls.slice(start).filter(call => call.endpoint.endsWith('/move_batch_v2')).map(call =>
    call.args.entries.map(entry => entry.from_path).sort())).toEqual([[mock.find('/Songbooks/Band/Shared/bela.cho').id, failed].sort(), [failed], [failed]]);
  await action(page, 'Utfør').click();
  await expect(counts).toHaveText('1 fil ble publisert');
  await expect(root.getByText('Ingen upubliserte sanger.')).toBeVisible();
  await go(page, 'Sanger');
  await go(page, 'Publisering');
  await expect(counts).toHaveText('0 valgt for publisering · 0 for avpublisering');
});

test('AK39-05: the songbook H04 action creates and reuses one read link, with manual copy fallback', async ({page, context}) => {
  const mock = await seed(page, context, {sharing: true});
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => {window.copied = text;}}}));
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
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw Error('Clipboard unavailable');}}});
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

test('AK39-04: cancel leaves both songs in place, confirmed offline deletion moves them privately and archives the book', async ({page, context}) => {
  const mock = await dropboxMock(context);
  await page.goto(url);
  const manifest = () => JSON.parse(mock.find('/.app/library.json')?.text ?? '{"songs":{},"books":{}}');
  for (const [i, title] of ['Én privat', 'Én publisert'].entries()) {
    await importAndOpenSong(page, `sang-${i}.cho`, `{t: ${title}}\n[C]Original`);
    await goSongs(page);
    await expect.poll(() => Object.keys(manifest().songs).length).toBe(i + 1);
  }
  const songs = await savedSongs(page), one = songs.find(song => song.title === 'Én privat'), two = songs.find(song => song.title === 'Én publisert');
  await go(page, 'Sangbøker');
  await action(page, 'Ny sangbok').click();
  await page.getByRole('textbox').fill('Mål');
  await action(page, 'Lagre').click();
  await expect.poll(() => Object.values(manifest().books).some(book => book.name === 'Mål')).toBe(true);
  await go(page, 'Publisering');
  await page.locator(`#publication [data-song-id="${two.id}"]`).click();
  await action(page, 'Utfør').click();
  await expect(page.locator('#publication .publication-actions p')).toHaveText('1 fil ble publisert');
  const before = manifest(), sidecar = mock.find(`/.app/songs/${two.id}.json`).text;
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
