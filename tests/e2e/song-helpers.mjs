import {expect} from '@playwright/test';
export const original = '\uFEFF{title: Samme tittel}\r\n{key: D}\r\n{comment: Rolig <b>tekst</b>}\r\n[D]Hei på [A/C#]deg\r\n[Solo] beholdes\r\n{soc}\r\n[G]Syng med\r\n{eoc}\r\n{chorus}\r\n{chorus}\r\n{x_future: behold}\r\n<img src=x onerror="window.injected=true">\r\n';
export async function importSong(page, name = 'sang.CHO', content = original) {
  await closeMenu(page);
  await page.locator('#song-file').setInputFiles({name, mimeType: '', buffer: Buffer.from(content)});
  await expect(page.locator('#song-title')).toBeVisible();
  await expect(page.locator('#song-status')).toContainText('Sangen er lagret');
}
export async function savedSongs(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const namespace = `hobos-songbook-${location.pathname.includes('/app/') ? 'production' : 'test'}`;
    const request = indexedDB.open(namespace, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, get = db.transaction('songs').objectStore('songs').getAll();
      get.onsuccess = () => {db.close(); resolve(get.result);};
    };
  }));
}

export async function openMenu(page) {
  if (!await page.locator('#settings-dialog').isVisible()) await page.getByRole('button',{name:'Meny',exact:true}).click();
}
export async function closeMenu(page) {
  if (await page.locator('#settings-dialog').isVisible()) await page.getByRole('button',{name:'Lukk meny',exact:true}).click();
}
export async function setDisplay(page, {theme, fontSize, showGrids, showDynamics}) {
  await openMenu(page);
  if (theme !== undefined) await page.locator('#theme').selectOption(theme);
  if (fontSize !== undefined) {await page.locator('#font-size').fill(String(fontSize)); await page.locator('#font-size').dispatchEvent('input');}
  if (showGrids !== undefined) await page.locator('#show-grids').setChecked(showGrids);
  if (showDynamics !== undefined) await page.locator('#show-dynamics').setChecked(showDynamics);
  await closeMenu(page);
}
