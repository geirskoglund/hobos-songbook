import {test, expect} from './fixtures.mjs';
import {openMenu, goSongs, savedSongs, importListChecked} from './song-helpers.mjs';
import {dropboxMock} from './dropbox-mock.mjs';

const url = '/hobos-songbook/test/';
const source = 'https://www.dropbox.com/scl/fo/kilde/Bandet?rlkey=a';
const base = '/Songbooks/Standard/Import/Bandet';
async function go(page, name) {
  await openMenu(page);
  await page.getByRole('button', {name, exact: true}).click();
  if (name === 'Synkronisering') await importListChecked(page);
}
async function synchronize(page) {
  await go(page, 'Synkronisering');
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#dropbox-sync')).not.toHaveAttribute('data-syncing');
  await expect(page.locator('#sync-status')).toHaveText(/^Sist synkronisert: /);
}
const sharedCalls = mock =>
  mock.calls.filter(call => call.args?.shared_link || call.args?.cursor?.startsWith('shared-cursor-'));
const downloads = mock => mock.calls.filter(call => call.endpoint.endsWith('/get_shared_link_file'));

test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});

test('#106: Synkroniser fetches an import into its songbook, keeps it current and protects its files', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context, {sharing: true});
  mock.shareForeign(source, {
    files: {
      '/Alfa.cho': '{t: Alfa}\n[C]Ord',
      '/Viser/Beta.cho': '{t: Beta}\n[G]Ord',
      '/Viser/Notat.txt': 'ikke en sang',
    },
  });
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  // An import registered on another device, in the Standard songbook.
  mock.put(
    '/.app/imports.json',
    JSON.stringify({version: 1, imports: {bandet: {name: 'Bandet', folder: source, songbookId: 'standard'}}}),
  );
  await synchronize(page);

  // F10: every .cho file, also in subfolders, in Import/<importnavn>/ with the source's structure.
  expect(mock.find(`${base}/Alfa.cho`).text).toBe('{t: Alfa}\n[C]Ord');
  expect(mock.find(`${base}/Viser/Beta.cho`).text).toBe('{t: Beta}\n[G]Ord');
  expect(mock.find(`${base}/Viser/Notat.txt`)).toBeUndefined();
  // F15: a fetched import shows only its songbook.
  await expect(page.locator('#import-list .row-metadata > span')).toHaveText(['Standard']);
  await goSongs(page);
  await expect(page.locator('#song-list .row-title')).toHaveText(['Alfa', 'Beta']);

  // F11: an unchanged source gives one listing per folder and no downloads.
  const listed = sharedCalls(mock).length,
    fetched = downloads(mock).length;
  await synchronize(page);
  expect(sharedCalls(mock).length - listed).toBe(2);
  expect(downloads(mock).length).toBe(fetched);
  // Only the changed file is downloaded.
  mock.sharePut(source, '/Viser/Beta.cho', '{t: Beta}\n[G]Nye ord');
  await synchronize(page);
  expect(downloads(mock).map(call => call.args.path)).toEqual(['/Alfa.cho', '/Viser/Beta.cho', '/Viser/Beta.cho']);
  await expect
    .poll(async () => (await savedSongs(page)).find(song => song.title === 'Beta')?.original)
    .toBe('{t: Beta}\n[G]Nye ord');

  // F16: Rediger offers only personal adaptations, and they are kept.
  await goSongs(page);
  await page.locator('#song-list .row-choice', {hasText: 'Alfa'}).click();
  await page.getByRole('button', {name: 'Rediger', exact: true}).click();
  await expect(page.locator('.edit-toolbar')).toBeVisible();
  await expect(page.getByRole('tab', {name: 'Filinnhold'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Råtekst'})).toHaveCount(0);
  await expect(page.locator('.edit-toolbar').getByRole('button', {name: 'Capo', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Visning', exact: true}).click();

  // F16: imported songs are not offered in Publisering.
  await go(page, 'Publisering');
  await expect(page.locator('#publication .row-title', {hasText: 'Alfa'})).toHaveCount(0);

  // F15: an unavailable source does not fail Synkroniser; the row tells when it last succeeded.
  mock.unshare(source);
  await synchronize(page);
  await expect(page.locator('#import-list .row-metadata > span')).toHaveText([
    'Standard',
    /^Feilet, sist synkronisert: \d/,
  ]);
  await goSongs(page);
  await expect(page.locator('#song-list .row-title')).toHaveText(['Alfa', 'Beta']);
});

test('#106: opening Synkronisering shows imports registered on another device before any sync', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context, {sharing: true});
  mock.shareForeign(source, {files: {'/Alfa.cho': '{t: Alfa}\n[C]Ord'}});
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  await go(page, 'Synkronisering');
  await expect(page.locator('#import-list > *')).toHaveCount(0);
  await goSongs(page);
  mock.put(
    '/.app/imports.json',
    JSON.stringify({version: 1, imports: {bandet: {name: 'Bandet', folder: source, songbookId: 'standard'}}}),
  );
  const list = () => mock.calls.filter(call => call.args?.path === '/.app/imports.json'),
    before = list().length;
  await go(page, 'Synkronisering');
  // The row shows this device's status: it has not fetched the import yet.
  await expect(page.locator('#import-list .row-metadata > span')).toHaveText(['Standard', 'Aldri synkronisert']);
  expect(
    list()
      .slice(before)
      .map(call => call.endpoint.split('/2/')[1]),
  ).toEqual(['files/get_metadata', 'files/download']);
  // An unchanged list costs one metadata call and no download.
  await goSongs(page);
  const again = list().length;
  await go(page, 'Synkronisering');
  await expect.poll(() => list().length).toBe(again + 1);
  expect(list().at(-1).endpoint).toMatch(/files\/get_metadata$/);
  await expect(page.locator('#import-list .row-title')).toHaveText(['Bandet']);
});

test('#107: the row menu deletes an import, with or without its content, after confirmation', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context, {sharing: true});
  mock.shareForeign(source, {files: {'/Alfa.cho': '{t: Alfa}\n[C]Ord', '/Viser/Beta.cho': '{t: Beta}\n[G]Ord'}});
  const other = 'https://www.dropbox.com/scl/fo/kilde/Andre?rlkey=b';
  mock.shareForeign(other, {files: {'/Gamma.cho': '{t: Gamma}\n[D]Ord'}});
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  mock.put(
    '/.app/imports.json',
    JSON.stringify({
      version: 1,
      imports: {
        andre: {name: 'Andre', folder: other, songbookId: 'standard'},
        bandet: {name: 'Bandet', folder: source, songbookId: 'standard'},
      },
    }),
  );
  // Dropbox lists the folder that holds the copies; this mock makes only folders it is given.
  mock.put(base, '', true);
  await synchronize(page);
  await expect(page.locator('#import-list .row-title')).toHaveText(['Andre', 'Bandet']);
  const list = () => mock.find('/.app/imports.json').text;

  // F08/F17: the row has a separate H04 menu with the two delete choices only.
  const menu = page.getByRole('button', {name: 'Handlinger for Bandet'});
  await menu.click();
  await expect(page.getByRole('menuitem')).toHaveText(['Slett import', 'Slett import og innhold']);
  await page.getByRole('menuitem', {name: 'Slett import og innhold'}).click();
  // E03: Avbryt has the initial focus and changes nothing.
  const dialog = page.getByRole('dialog', {name: 'Slett import og innhold'});
  await expect(dialog.getByRole('button', {name: 'Avbryt'})).toBeFocused();
  const before = list();
  await dialog.getByRole('button', {name: 'Avbryt'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeFocused();
  expect(list()).toBe(before);

  // Without a connection nothing is deleted, and the dialog says so.
  await context.setOffline(true);
  await menu.click();
  await page.getByRole('menuitem', {name: 'Slett import og innhold'}).click();
  await dialog.getByRole('button', {name: 'Slett'}).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Kunne ikke slette importen/);
  await dialog.getByRole('button', {name: 'Avbryt'}).click();
  expect(list()).toBe(before);
  await expect(page.locator('#import-list .row-title')).toHaveText(['Andre', 'Bandet']);
  await context.setOffline(false);

  // Slett import og innhold: the row, the import folder and its songs go.
  await menu.click();
  await page.getByRole('menuitem', {name: 'Slett import og innhold'}).click();
  await dialog.getByRole('button', {name: 'Slett'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#import-list .row-title')).toHaveText(['Andre']);
  await expect(page.locator('#dropbox-sync')).not.toHaveAttribute('data-syncing');
  await expect(page.locator('#sync-status')).toHaveText(/^Sist synkronisert: /);
  await expect.poll(() => mock.find(base)).toBeUndefined();
  expect(mock.find(`${base}/Alfa.cho`)).toBeUndefined();
  expect(JSON.parse(list()).removals).toBeUndefined();
  await goSongs(page);
  await expect(page.locator('#song-list .row-title')).toHaveText(['Gamma']);

  // Slett import: fetching stops; the songs stay.
  await go(page, 'Synkronisering');
  await page.getByRole('button', {name: 'Handlinger for Andre'}).click();
  await page.getByRole('menuitem', {name: 'Slett import', exact: true}).click();
  await page.getByRole('dialog', {name: 'Slett import'}).getByRole('button', {name: 'Slett'}).click();
  await expect(page.locator('#import-list > *')).toHaveCount(0);
  await expect(page.locator('#add-import')).toBeFocused();
  expect(JSON.parse(list())).toEqual({version: 1, imports: {}});
  mock.sharePut(other, '/Delta.cho', '{t: Delta}\n[E]Ord');
  await synchronize(page);
  await goSongs(page);
  await expect(page.locator('#song-list .row-title')).toHaveText(['Gamma']);
  expect(mock.find('/Songbooks/Standard/Import/Andre/Gamma.cho')).toBeTruthy();
});
