import {test, expect} from '@playwright/test';
import {importSong, savedSongs, original, openMenu, closeMenu, setDisplay} from './song-helpers.mjs';
test.beforeEach(async ({request}) => {await request.post('/__test__/reset');});

test('same titles and same files remain independent; exact originals and chorus state survive reopening', async ({page}) => {
  await page.goto('/hobos-songbook/test/');
  await importSong(page);
  await expect(page.locator('.song-key[aria-label^="Toneart:"]')).toHaveText('D');
  await expect(page.locator('.song-key[aria-label^="Toneart:"]')).toHaveAttribute('aria-label', 'Toneart: D');
  await expect(page.locator('#song-content')).not.toContainText('Klingende toneart');
  await expect(page.locator('.chorus:not(.reference)')).toContainText('Syng med');
  const refs = page.getByRole('button', {name: 'Refreng', exact: true});
  await expect(refs).toHaveCount(2); await expect(refs.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await refs.nth(1).focus(); await page.keyboard.press('Enter');
  await expect(refs.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#song-content b')).toHaveCount(0);
  await expect(page.locator('#song-content')).toContainText('<b>tekst</b>');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.getByRole('button', {name: '← Mine sanger'}).click();
  await importSong(page, 'andre.txt');
  await expect(refs.nth(1)).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', {name: '← Mine sanger'}).click();
  await importSong(page);
  const songs = await savedSongs(page);
  expect(new Set(songs.map(song => song.id)).size).toBe(3);
  expect(songs.every(song => song.original === original && song.origin.importedAt)).toBe(true);
  await page.reload();
  await expect(page.locator('.song-choice')).toHaveCount(3);
  // Sort-independent lookup: the original song is the first import timestamp.
  const first = songs.toSorted((a,b) => a.origin.importedAt.localeCompare(b.origin.importedAt))[0];
  await page.locator(`[data-song-id="${first.id}"]`).click();
  await expect(refs.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(refs.nth(1)).toHaveAttribute('aria-expanded', 'true');
});

test('lyrics and chord anchors wrap at mobile/tablet/desktop at both font limits and themes; navigation resets scroll', async ({page}) => {
  await page.goto('/hobos-songbook/test/');
  await importSong(page, 'lang.txt', '{t: Lang sang}\n'+('En [D]vanlig linje med [Am]akkorder midt i lan[G]ge ord. '+ 'Veldiglangtord'.repeat(12)+'\n[C][D][Em]\n').repeat(30));
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 800});
    for (const theme of ['light', 'dark']) {
      await setDisplay(page, {theme:theme});
      for (const fontSize of ['16', '36']) {
        await setDisplay(page, {fontSize:fontSize});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const geometry = await page.locator('.piece:has(.chord:not(:empty))').evaluateAll(pieces => pieces.every(piece => {
          const chord = piece.querySelector('.chord').getBoundingClientRect(), lyric = piece.querySelector('.lyric').getBoundingClientRect();
          return Math.abs(chord.left - lyric.left) < 1 && chord.bottom <= lyric.top + 1 && chord.right <= innerWidth;
        }));
        expect(geometry).toBe(true);
      }
    }
  }
  await setDisplay(page, {theme:'light'});
  await page.getByRole('button', {name: '← Mine sanger'}).click();
  await importSong(page, 'ren.txt', 'Bare sangtekst\nuten akkorder');
  await expect(page.locator('.song-metadata')).toHaveText('4/4');
  await expect(page.locator('.chord')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('#font-size')).toHaveValue('36'); await expect(page.locator('#theme')).toHaveValue('light');
  await page.getByRole('button', {name: /Lang sang/}).click();
  await expect(page.locator('#song-title')).toHaveText('Lang sang');
  await page.evaluate(() => window.scrollTo(0, 1400)); expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.getByRole('button', {name: '← Mine sanger'}).click();
  await page.getByRole('button', {name: /Lang sang/}).click();
  await expect(page.locator('#song-title')).toHaveText('Lang sang');
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('invalid files, transaction abort, unavailable database and unavailable preferences report truth without data loss', async ({page}) => {
  await page.goto('/hobos-songbook/test/'); await importSong(page);
  await page.getByRole('button', {name: '← Mine sanger'}).click();
  const before = await savedSongs(page);
  for (const [name, buffer] of [['tom.txt', Buffer.from('')], ['bin.CHO', Buffer.from([0,1,2])], ['feil.txt', Buffer.from([0xc3,0x28])], ['feil.pdf', Buffer.from('tekst')]]) {
    await page.locator('#song-file').setInputFiles({name, mimeType: 'text/plain', buffer});
    await expect(page.locator('#song-status')).not.toContainText('Sangen er lagret');
    await expect(page.locator('#song-status')).not.toBeEmpty(); expect(await savedSongs(page)).toEqual(before);
  }
  await page.locator('#song-file').setInputFiles([]);
  expect(await savedSongs(page)).toEqual(before);
  await page.evaluate(() => {
    window.originalRead = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async () => {throw new Error('File unavailable');};
  });
  await page.locator('#song-file').setInputFiles({name:'uleselig.txt', mimeType:'text/plain', buffer:Buffer.from('tekst')});
  await expect(page.locator('#song-status')).toContainText('Filen kunne ikke leses');
  expect(await savedSongs(page)).toEqual(before);
  await page.evaluate(() => {File.prototype.arrayBuffer = window.originalRead;});
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {this.transaction.abort(); return add.apply(this, args);};
  });
  await page.locator('#song-file').setInputFiles({name:'gyldig.txt', mimeType:'', buffer:Buffer.from('Gyldig tekst')});
  await expect(page.locator('#song-status')).toContainText('utilgjengelig'); expect(await savedSongs(page)).toEqual(before);
  await page.reload(); await importSong(page, 'igjen.txt', 'Gyldig tekst');
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {throw new Error('Denied');};
    Storage.prototype.setItem = () => {throw new Error('QuotaExceeded');};
  });
  await page.reload();
  await expect(page.locator('#settings-status')).toContainText('kunne ikke hentes');
  await setDisplay(page, {theme:'light'}); await expect(page.locator('#settings-status')).toContainText('kunne ikke lagres');
  await expect(page.locator('.song-choice')).toHaveCount(2);
  await page.addInitScript(() => {indexedDB.open = () => {throw new Error('Denied');};});
  await page.reload(); await expect(page.locator('#library-status')).not.toContainText('Ingen sanger');
  await expect(page.locator('#retry-storage')).toBeVisible();
});

test('missing chorus is understandable and malformed blocks never swallow following text', async ({page}) => {
  await page.goto('/hobos-songbook/test/');
  await importSong(page, 'markører.txt', '{chorus}\n{eoc}\nBevart\n{soc}\nUferdig\n{x: ukjent}\nEtter');
  await expect(page.locator('#song-content')).toContainText('ingen tidligere refrengtekst');
  for (const text of ['Bevart','Uferdig','{x: ukjent}','Etter']) await expect(page.locator('#song-content')).toContainText(text);
});

test('closing the browser and reopening the same persistent profile offline preserves real songs and choices', async ({playwright, browserName}, testInfo) => {
  const {mkdtemp, rm, mkdir} = await import('node:fs/promises');
  await mkdir('work/profiles', {recursive: true});
  const profile = await mkdtemp('work/profiles/songbook-');
  const launch = () => playwright[browserName].launchPersistentContext(profile, {
    executablePath: testInfo.project.use.launchOptions.executablePath,
    args: ['--no-sandbox'], headless: true, colorScheme: 'light',
  });
  let context;
  try {
    context = await launch(); let page = context.pages()[0];
    await page.goto('http://127.0.0.1:4173/hobos-songbook/test/');
    await expect(page.locator('#offline-status')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#theme')).toHaveValue('dark');
    await importSong(page);
    await page.getByRole('button', {name: 'Refreng', exact: true}).nth(1).click();
    await expect(page.getByRole('button', {name: 'Refreng', exact: true}).nth(1)).toHaveAttribute('aria-expanded', 'true');
    await setDisplay(page, {theme:'light'});
    await setDisplay(page, {fontSize:'28'});
    const before = await savedSongs(page);
    await context.close(); context = await launch(); await context.setOffline(true);
    page = context.pages()[0]; await page.goto('http://127.0.0.1:4173/hobos-songbook/test/');
    await expect(page.locator('#connection')).toHaveText('Uten nett');
    await expect(page.locator('#offline-status')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', {name: /Samme tittel/}).click();
    await expect(page.getByRole('button', {name: 'Refreng', exact: true}).nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#theme')).toHaveValue('light'); await expect(page.locator('#font-size')).toHaveValue('28');
    expect(await savedSongs(page)).toEqual(before);
  } finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
});

test('failed personal state write leaves the prior choice and original intact; retry works', async ({page}) => {
  await page.goto('/hobos-songbook/test/'); await importSong(page);
  const before = await savedSongs(page), refs = page.getByRole('button', {name: 'Refreng', exact: true});
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {this.transaction.abort(); return window.originalPut.apply(this,args);};
  });
  await refs.nth(0).click(); await expect(page.locator('#song-status')).toContainText('Refrengvalget kunne ikke lagres');
  await expect(refs.nth(0)).toHaveAttribute('aria-expanded', 'false'); expect(await savedSongs(page)).toEqual(before);
  await page.evaluate(() => {IDBObjectStore.prototype.put = window.originalPut;});
  await refs.nth(0).click(); await expect(refs.nth(0)).toHaveAttribute('aria-expanded', 'true');
});
