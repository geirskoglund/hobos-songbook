import {expect} from '@playwright/test';
export const original = '\uFEFF{title: Samme tittel}\r\n{key: D}\r\n{comment: Rolig <b>tekst</b>}\r\n[D]Hei på [A/C#]deg\r\n[Solo] beholdes\r\n{soc}\r\n[G]Syng med\r\n{eoc}\r\n{chorus}\r\n{chorus}\r\n{x_future: behold}\r\n<img src=x onerror="window.injected=true">\r\n';
export async function importSong(page, name = 'sang.CHO', content = original) {
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
