import {test, expect} from './fixtures.mjs';
import {openMenu, goSongs, savedSongs} from './song-helpers.mjs';
import {dropboxMock} from './dropbox-mock.mjs';

const url = '/hobos-songbook/test/';
const source = 'https://www.dropbox.com/scl/fo/kilde/Bandet?rlkey=a';
const base = '/Songbooks/Standard/Import/Bandet';
async function go(page, name) {
  await openMenu(page);
  await page.getByRole('button', {name, exact: true}).click();
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
