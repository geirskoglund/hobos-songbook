import {test, expect} from './fixtures.mjs';
import {openMenu, importListChecked, savedSongs, goSongs} from './song-helpers.mjs';
import {dropboxMock} from './dropbox-mock.mjs';

// #116: Dropbox-kallene for vanlige synker med to delte mapper, i rekkefølge.
const url = '/hobos-songbook/test/';
const sources = {
  bandet: 'https://www.dropbox.com/scl/fo/kilde/Bandet?rlkey=a',
  koret: 'https://www.dropbox.com/scl/fo/kilde/Koret?rlkey=b',
};
async function synchronize(page) {
  await openMenu(page);
  await page.getByRole('button', {name: 'Synkronisering', exact: true}).click();
  await importListChecked(page);
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#dropbox-sync')).not.toHaveAttribute('data-syncing');
  await expect(page.locator('#sync-status')).toHaveText(/^Sist synkronisert: /);
}
const label = call =>
  call.endpoint.split('/2/')[1] + (call.args?.path?.startsWith('/.app/') ? ' ' + call.args.path.slice(6) : '');

test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});

test('#116: antall kall for synk uten endringer, med slettet fil og med nye filer i delt mappe', async ({
  page,
  context,
}) => {
  const mock = await dropboxMock(context, {sharing: true});
  mock.shareForeign(sources.bandet, {files: {'/Alfa.cho': '{t: Alfa}\n[C]Ord', '/Beta.cho': '{t: Beta}\n[G]Ord'}});
  mock.shareForeign(sources.koret, {files: {'/Gamma.cho': '{t: Gamma}\n[D]Ord'}});
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  mock.put(
    '/.app/imports.json',
    JSON.stringify({
      version: 1,
      imports: {
        bandet: {name: 'Bandet', folder: sources.bandet, songbookId: 'standard'},
        koret: {name: 'Koret', folder: sources.koret, songbookId: 'standard'},
      },
    }),
  );
  await synchronize(page);
  await synchronize(page);
  const measure = async () => {
    mock.latency(40);
    const start = mock.calls.length;
    await synchronize(page);
    return {calls: mock.calls.slice(start).map(label), parallel: mock.maximum()};
  };
  const listing = 'files/list_folder/continue',
    unchanged = await measure();
  // Own Dropbox and both shared folders are listed at once.
  expect(unchanged).toEqual({calls: [listing, listing, listing], parallel: 3});

  mock.sharePut(sources.bandet, '/Beta.cho', null);
  const deleted = await measure();
  // The lock is taken with one write, no second listing follows and the unchanged library is not read.
  expect(deleted.calls).toEqual([
    listing,
    listing,
    listing,
    'files/upload mutation.json',
    'files/upload import-state.json',
    'files/upload mutation.json',
  ]);

  for (const name of ['Delta', 'Epsilon', 'Zeta', 'Eta'])
    mock.sharePut(sources.koret, `/${name}.cho`, `{t: ${name}}\n[A]Ord`);
  const added = await measure();
  // The new copies are not read back: their text came from the shared folder. Beta's copy is kept.
  expect(added.calls).toEqual([
    listing,
    listing,
    listing,
    'files/upload mutation.json',
    ...Array(4).fill('sharing/get_shared_link_file'),
    'files/upload_session/start_batch',
    'files/upload_session/append_batch',
    'files/upload_session/finish_batch_v2',
    'files/upload import-state.json',
    'files/upload_session/start_batch',
    'files/upload_session/append_batch',
    'files/upload_session/finish_batch_v2',
    'files/upload library.json',
    'files/upload mutation.json',
  ]);
  await goSongs(page);
  await expect(page.locator('#song-list .row-title')).toHaveText([
    'Alfa',
    'Beta',
    'Delta',
    'Epsilon',
    'Eta',
    'Gamma',
    'Zeta',
  ]);
  expect((await savedSongs(page)).find(song => song.title === 'Delta').original).toBe('{t: Delta}\n[A]Ord');
});
