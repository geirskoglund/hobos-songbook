import {test, expect} from './fixtures.mjs';
import {openMenu} from './song-helpers.mjs';
import {dropboxMock} from './dropbox-mock.mjs';

const url = '/hobos-songbook/test/';
const source = 'https://www.dropbox.com/scl/fo/kilde/Bandet?rlkey=a';
async function syncPage(page) {
  await openMenu(page);
  await page.getByRole('button', {name: 'Synkronisering', exact: true}).click();
  await expect(page.locator('#sync')).toBeVisible();
}
const dialog = page => page.locator('dialog[open].import-dialog');
const primary = page => dialog(page).locator('footer [data-action=primary]');
const linkCalls = mock =>
  mock.calls.filter(call => call.endpoint.endsWith('/get_shared_link_metadata') || call.args?.shared_link);
async function testFolder(page, address) {
  await page.locator('#import-folder').fill(address);
  await expect(primary(page)).toHaveText('Test tilkobling');
  await primary(page).click();
  await expect(page.locator('#import-test-result')).not.toHaveText(/Tester/);
}

test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});

test('#105: H01 only with a connected Dropbox account', async ({page, context}) => {
  await dropboxMock(context, {connected: false});
  await page.goto(url);
  await syncPage(page);
  await expect(page.locator('#dropbox-connect')).toBeVisible();
  await expect(page.locator('#add-import')).toBeHidden();
});

test('#105: register a tested import; every test answer, field errors and other devices', async ({page, context}) => {
  const mock = await dropboxMock(context, {sharing: true});
  mock.shareForeign(source, {
    folders: {'': [{'.tag': 'folder', id: 'id:sub', name: 'Viser'}], '/Viser': []},
  });
  mock.shareForeign('https://www.dropbox.com/s/fil/sang.cho?dl=0', {'.tag': 'file'});
  mock.shareForeign('https://www.dropbox.com/scl/fo/passord/P?rlkey=b', {error: 'shared_link_access_denied/'});
  await page.goto(url);
  await expect.poll(() => Boolean(mock.find('/.app/library.json'))).toBe(true);
  // Own links: one to the app's songbook folder, one to an own folder outside the app folder.
  // Dropbox reports a path for both; only the first ID can be looked up by the app.
  mock.shareForeign('https://www.dropbox.com/scl/fo/egen/Shared?rlkey=c', {
    id: mock.find('/Songbooks/Standard/Shared').id,
    path_lower: '/apps/hobos/songbooks/standard/shared',
  });
  mock.shareForeign('https://www.dropbox.com/scl/fo/utenfor/Musikk?rlkey=g', {path_lower: '/musikk'});
  await syncPage(page);
  await expect(page.locator('#import-list > li')).toHaveCount(0);
  await page.locator('#add-import').click();

  // F03: D02 Navn and Mappe with help text, D10 Sangbok and E03 Avbryt / Test tilkobling.
  await expect(dialog(page).locator('h2')).toHaveText('Ny import');
  await expect(page.locator('#import-name')).toBeFocused();
  await expect(page.locator('#import-folder')).toHaveAttribute('placeholder', 'Nettadresse til delt mappe');
  await expect(dialog(page).locator('.choice-value')).toContainText('Velg sangbok');
  await expect(dialog(page).locator('footer button')).toHaveText(['Avbryt', 'Test tilkobling']);
  await page.locator('#import-name').fill('Bandet');

  // F04: no Dropbox call for an address outside Dropbox.
  await page.locator('#import-folder').fill('https://example.com/Bandet');
  await primary(page).click();
  await expect(page.locator('#import-folder-error')).toHaveText('Adressen er ikke en Dropbox-adresse');
  expect(linkCalls(mock)).toHaveLength(0);

  // F05: the four failures leave the address untested.
  const failures = [
    ['https://www.dropbox.com/s/fil/sang.cho?dl=0', 'Tilkobling feilet: Mappen er ikke delt'],
    ['https://www.dropbox.com/scl/fo/passord/P?rlkey=b', 'Tilkobling feilet: Mappen er ikke delt'],
    ['https://www.dropbox.com/scl/fo/borte/X?rlkey=d', 'Tilkobling feilet: Finner ikke mappen'],
    ['https://www.dropbox.com/scl/fo/egen/Shared?rlkey=c', 'Tilkobling feilet: Peker til egen sangbok'],
  ];
  for (const [address, message] of failures) {
    await testFolder(page, address);
    await expect(page.locator('#import-test-result')).toHaveText(message);
    await expect(page.locator('#import-test-result')).toHaveCSS('color', 'rgb(240, 160, 147)');
    // Disabling the pressed button can leave focus on the dialog itself, which never shows a ring.
    await dialog(page).evaluate(box => box.focus());
    await expect(dialog(page)).toHaveCSS('outline-style', 'none');
    await expect(primary(page)).toHaveText('Test tilkobling');
  }
  mock.fault('/get_shared_link_metadata', 503, 0, {repeat: 3});
  await testFolder(page, source);
  await expect(page.locator('#import-test-result')).toHaveText('Tilkobling feilet: Dropbox utilgjengelig');
  await expect(primary(page)).toHaveText('Test tilkobling');
  mock.clearFault();

  await testFolder(page, 'https://www.dropbox.com/scl/fo/utenfor/Musikk?rlkey=g');
  await expect(page.locator('#import-test-result')).toHaveText('Tilkobling ok');

  // A successful test lists every folder and turns the action into Lagre; changing Mappe undoes it.
  const before = linkCalls(mock).length;
  await testFolder(page, source);
  await expect(page.locator('#import-test-result')).toHaveText('Tilkobling ok');
  expect(
    linkCalls(mock)
      .slice(before)
      .map(call => call.args.path ?? call.args.url),
  ).toEqual([source, '', '/Viser']);
  await expect(primary(page)).toHaveText('Lagre');
  await page.locator('#import-folder').fill(source + '&x=1');
  await expect(primary(page)).toHaveText('Test tilkobling');
  await page.locator('#import-folder').fill(source);
  await expect(primary(page)).toHaveText('Lagre');

  // Lagre needs a songbook (D10) and fetches no songs.
  await expect(primary(page)).toBeDisabled();
  await dialog(page).locator('.choice-value').click();
  await dialog(page).getByRole('option', {name: 'Standard', exact: true}).click();
  await expect(primary(page)).toBeEnabled();
  const downloads = mock.calls.filter(call => call.endpoint.endsWith('/get_shared_link_file')).length;
  await primary(page).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#add-import')).toBeFocused();
  await expect(page.locator('#import-list > li')).toHaveCount(1);
  await expect(page.locator('#import-list .song-name')).toHaveText('Bandet');
  await expect(page.locator('#import-list .row-metadata')).toHaveText('Standard');
  expect(mock.calls.filter(call => call.endpoint.endsWith('/get_shared_link_file')).length).toBe(downloads);
  const file = JSON.parse(mock.find('/.app/imports.json').text);
  expect(Object.values(file.imports)).toEqual([{name: 'Bandet', folder: source, songbookId: 'standard'}]);

  // Name and Mappe already used by another import give field errors.
  await page.locator('#add-import').click();
  await page.locator('#import-name').fill('bandet');
  await expect(page.locator('#import-name-error')).toHaveText('Det finnes allerede en import med dette navnet.');
  await page.locator('#import-name').fill('Ny/import');
  await expect(page.locator('#import-name-error')).toContainText('kan ikke inneholde');
  await page.locator('#import-folder').fill(source);
  await primary(page).click();
  await expect(page.locator('#import-folder-error')).toHaveText('En annen import bruker allerede denne mappen.');

  // No connection test without network.
  await context.setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await page.locator('#import-folder').fill('https://www.dropbox.com/scl/fo/annen/A?rlkey=e');
  await expect(primary(page)).toBeDisabled();
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(primary(page)).toBeEnabled();
  await dialog(page).getByRole('button', {name: 'Avbryt'}).click();
  await expect(dialog(page)).toBeHidden();

  // F06: an import saved on another device appears after Synkroniser.
  file.imports.annen = {
    name: 'Annen enhet',
    folder: 'https://www.dropbox.com/scl/fo/z/Z?rlkey=f',
    songbookId: 'standard',
  };
  mock.put('/.app/imports.json', JSON.stringify(file));
  await page.locator('#dropbox-sync').click();
  await expect(page.locator('#import-list .song-name')).toHaveText(['Annen enhet', 'Bandet']);
  await page.reload();
  await syncPage(page);
  await expect(page.locator('#import-list .song-name')).toHaveText(['Annen enhet', 'Bandet']);
});
