import {test, expect} from './fixtures.mjs';
import {openMenu, goSongs, openSettings} from './song-helpers.mjs';

// D22: appearance is guarded by reference images of the most important screens and components,
// at 320, 768 and 1440 px, in the states rest, selected, keyboard focus and disabled where the control has it.
// References are made and compared on Linux, as in CI. Update them from CI, see TESTING.
test.skip(
  process.platform !== 'linux' && !process.env.SCREENSHOTS_ANY_PLATFORM,
  'Referansebildene lages og sammenlignes på Linux, som i CI.',
);

const url = '/hobos-songbook/test/';
const dialog = (page, name) => page.getByRole('dialog', {name, exact: true});
const button = (scope, name) => scope.getByRole('button', {name, exact: true});
const song = (id, title, songbookId, key) => ({
  id,
  songbookId,
  title,
  key,
  original: `\uFEFF{t: ${title}}\r\n{key: ${key}}\r\n{comment: Rolig}\r\n[${key}]Første linje med [A]ord\r\n{soc}\r\n[G]Syng med\r\n{eoc}\r\n`,
  origin: {kind: 'external', filename: `${id}.cho`, importedAt: '2026-01-01', provider: 'future', fileId: id},
});

async function seed(page) {
  await page.goto(url);
  await expect(page.locator('#add-song')).toBeEnabled();
  await page.evaluate(
    songs =>
      new Promise(resolve => {
        const request = indexedDB.open('hobos-songbook-test');
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(['songs', 'songbooks', 'setlists'], 'readwrite');
          for (const book of [
            {id: 'band', name: 'Band'},
            {id: 'jul', name: 'Jul'},
          ])
            tx.objectStore('songbooks').put(book);
          for (const item of songs) tx.objectStore('songs').put(item);
          tx.objectStore('setlists').put({id: 'fest', name: 'Fest', createdAt: 1, songIds: ['a', 'b']});
          tx.objectStore('setlists').put({id: 'ovelse', name: 'Øvelse', createdAt: 2, songIds: []});
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    [
      song('a', 'Blåbærturen', 'standard', 'D'),
      song('b', 'Sommernatt', 'band', 'G'),
      song('c', 'Vinterveien', 'jul', 'C'),
    ],
  );
  await page.reload();
  await expect(page.locator('#add-song')).toBeEnabled();
  await expect(page.locator('#dropbox-sync')).toBeEnabled({timeout: 30000});
}

/** Gives a control the shared keyboard focus cue by reaching it with real keyboard navigation. */
async function keyboardFocus(page, node) {
  await node.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  if (!(await node.evaluate(n => n === document.activeElement))) {
    await node.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
  }
  await expect(node).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-keyboard-focus', 'true');
}

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, {animations: 'disabled', caret: 'hide'});
}

test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});

for (const width of [320, 768, 1440]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({page}) => {
      await page.setViewportSize({width, height: 800});
      await seed(page);
    });

    test('Sanger: L01, H01 and D09 filter', async ({page}) => {
      await shot(page, `sanger-hvile-${width}`);
      await keyboardFocus(page, page.locator('[data-song-id="b"]'));
      await shot(page, `sanger-fokus-${width}`);
      await page.locator('#add-song').click();
      await expect(page.getByRole('menuitem', {name: 'Opprett', exact: true})).toBeVisible();
      await shot(page, `sanger-plussmeny-${width}`);
      await page.keyboard.press('Escape');
      await page.locator('#songbook-filter').click();
      await page.getByRole('option', {name: 'Band', exact: true}).click();
      await expect(page.locator('#songbook-filter')).toHaveText('Band');
      await page.locator('#songbook-filter').click();
      await expect(page.getByRole('option', {name: 'Band', exact: true})).toBeVisible();
      await shot(page, `sanger-filter-valgt-${width}`);
    });

    test('N02 navigation panel', async ({page}) => {
      await openMenu(page);
      await shot(page, `navigasjon-valgt-${width}`);
      await keyboardFocus(page, button(page.locator('#main-menu'), 'Setlister'));
      await shot(page, `navigasjon-fokus-${width}`);
    });

    test('Setlister: L02 and H04', async ({page}) => {
      await openMenu(page);
      await button(page, 'Setlister').click();
      await expect(page.locator('#setlist-list .row-choice')).toHaveCount(2);
      await shot(page, `setlister-hvile-${width}`);
      await keyboardFocus(page, page.locator('#setlist-menu-fest'));
      await shot(page, `setlister-fokus-${width}`);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menuitem').first()).toBeFocused();
      await shot(page, `setlister-kontekstmeny-${width}`);
    });

    test('Sangbøker: L02, H04 and D02/E03 name dialog', async ({page}) => {
      await openMenu(page);
      await button(page, 'Sangbøker').click();
      await expect(page.locator('#songbook-list .row-choice')).toHaveCount(3);
      await shot(page, `sangboker-hvile-${width}`);
      await page.locator('#songbook-menu-band').click();
      await expect(page.getByRole('menuitem').first()).toBeFocused();
      await shot(page, `sangboker-kontekstmeny-${width}`);
      await page.keyboard.press('Escape');
      await page.locator('#add-songbook').click();
      const name = dialog(page, 'Ny sangbok');
      await expect(name).toBeVisible();
      await shot(page, `navnedialog-hvile-${width}`);
      await keyboardFocus(page, name.getByLabel('Navn', {exact: true}));
      await shot(page, `navnedialog-fokus-${width}`);
      await name.getByLabel('Navn', {exact: true}).fill('Ny bok');
      await keyboardFocus(page, button(name, 'Lagre'));
      await shot(page, `navnedialog-primaer-fokus-${width}`);
    });

    test('Innstillinger: D05 and D06', async ({page}) => {
      await openSettings(page);
      await expect(page.locator('#show-grids')).toBeVisible();
      // Wait for the service worker, so the offline status shows its final text.
      await expect(page.locator('#offline-status')).toHaveText('Klart for bruk uten nett', {timeout: 30000});
      await shot(page, `innstillinger-hvile-${width}`);
      await page.locator('#show-dynamics').setChecked(false);
      await expect(page.locator('#show-dynamics')).not.toBeChecked();
      await keyboardFocus(page, page.locator('#show-dynamics'));
      await shot(page, `innstillinger-bryter-av-fokus-${width}`);
      await keyboardFocus(page, page.locator('#font-size'));
      await shot(page, `innstillinger-skyver-fokus-${width}`);
    });

    test('Sangvisning: N01, D07 and D08', async ({page}) => {
      await page.locator('[data-song-id="a"]').click();
      await expect(page.locator('#song-title')).toBeVisible();
      await shot(page, `sangvisning-hvile-${width}`);
      await button(page, 'Rediger').click();
      await expect(page.locator('.edit-toolbar')).toBeVisible();
      await page.getByRole('tab', {name: 'Egentilpasning', exact: true}).click();
      await shot(page, `sangredigering-fane-valgt-${width}`);
      await button(page, 'Capo').click();
      const capo = dialog(page, 'Capo');
      await expect(capo).toBeVisible();
      // Capo 0: the decrease action is disabled.
      await expect(button(capo, 'Reduser capo')).toBeDisabled();
      await shot(page, `capo-deaktivert-${width}`);
      await keyboardFocus(page, capo.getByRole('spinbutton', {name: 'Capo', exact: true}));
      await shot(page, `capo-fokus-${width}`);
      await page.keyboard.press('Escape');
      await expect(capo).toBeHidden();
      await page.getByRole('tab', {name: 'Filinnhold', exact: true}).click();
      await button(page, 'Toneart').click();
      const key = dialog(page, 'Toneart');
      await expect(key).toBeVisible();
      await shot(page, `toneart-hvile-${width}`);
    });

    test('D10: Opprett i sangbok', async ({page}) => {
      await goSongs(page);
      await page.locator('#add-song').click();
      await page.getByRole('menuitem', {name: 'Opprett', exact: true}).click();
      const step = dialog(page, 'Opprett i sangbok');
      await expect(step).toBeVisible();
      await expect(button(step, 'Fortsett')).toBeDisabled();
      await shot(page, `d10-deaktivert-${width}`);
      const value = step.locator('.choice-value');
      await value.click();
      await step.getByRole('option', {name: 'Band', exact: true}).click();
      await expect(button(step, 'Fortsett')).toBeEnabled();
      await value.click();
      await expect(step.getByRole('option', {name: 'Band', exact: true})).toBeVisible();
      await shot(page, `d10-valgt-${width}`);
      // Options are reached with the arrow keys, as in the shared list.
      await page.keyboard.press('Escape');
      await expect(value).toBeFocused();
      await value.press('ArrowDown');
      await expect(step.locator('[role=option]:focus')).toHaveCount(1);
      await expect(page.locator('html')).toHaveAttribute('data-keyboard-focus', 'true');
      await shot(page, `d10-fokus-${width}`);
    });

    // Built like the sync conflict dialog and opened with the real openDialog, which places it.
    test('E04: dialog with three actions', async ({page}) => {
      await page.evaluate(async () => {
        const {dialogFrame, dialogFooter, controlHeading, openDialog} = await import('/__test__/controls.js');
        const box = dialogFrame('Synkroniseringskonflikt', 'name-dialog sync-dialog'),
          text = document.createElement('p');
        text.textContent = 'Sangen "Blåbærturen" er endret både i Dropbox og her lokalt. Hvilken versjon skal gjelde?';
        const close = () => lifecycle.close();
        box.append(
          controlHeading('Synkroniseringskonflikt', 'synkroniser'),
          text,
          dialogFooter([
            {id: 'local', label: 'Lokal versjon', run: close},
            {id: 'dropbox', label: 'Dropbox', run: close},
            {id: 'copy', label: 'Opprett ny fil', primary: true, run: close},
          ]),
        );
        const lifecycle = openDialog(box, {outside: true});
      });
      const box = dialog(page, 'Synkroniseringskonflikt');
      await expect(box).toBeVisible();
      const bounds = await box.boundingBox();
      expect(bounds.x + bounds.width / 2).toBeCloseTo(width / 2, 0);
      expect(bounds.y).toBeGreaterThan(0);
      await shot(page, `e04-hvile-${width}`);
      await keyboardFocus(page, button(box, 'Dropbox'));
      await shot(page, `e04-fokus-${width}`);
    });
  });
}
