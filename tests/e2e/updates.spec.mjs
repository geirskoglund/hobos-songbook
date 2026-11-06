import {test, expect} from '@playwright/test';
import {importSong, savedSongs} from './song-helpers.mjs';
const url = '/hobos-songbook/test/';
const ready = page => expect(page.locator('#offline-status')).toHaveAttribute('data-ready', 'true');
test.beforeEach(async ({request}) => {await request.post('/__test__/reset');});

test('update on first visit activates and reloads without requiring an earlier page reload', async ({page, request}) => {
  await page.goto(url); await ready(page);
  await importSong(page);
  const before = await savedSongs(page);
  await request.post('/__test__/update?channel=test');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.getByRole('button', {name:'Oppdater appen', exact:true}).click();
  await expect(page.locator('.build')).toContainText('ccccccc');
  expect(await savedSongs(page)).toEqual(before);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', {name:'Se etter oppdatering',exact:true}).click();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await expect(page.locator('#update-notice')).toBeHidden();
});

test('long reading session gets an automatic visible notice; update still needs an explicit choice', async ({page, request}) => {
  await page.clock.install();
  await page.setViewportSize({width:320,height:700});
  await page.goto(url); await ready(page);
  await importSong(page, 'lang.txt', '{title: Lang sang}\n'+('En tekstlinje\n').repeat(100));
  const before = await savedSongs(page);
  await page.locator('.app-info').evaluate(details => {details.open = false;});
  await page.evaluate(() => scrollTo(0, 1000));
  const navigations = []; page.on('framenavigated', frame => {if (frame === page.mainFrame()) navigations.push(frame.url());});
  await request.post('/__test__/update?channel=test');
  await page.clock.fastForward(60_000);
  await expect(page.locator('#update-notice')).toBeVisible();
  await expect(page.locator('#update-notice-text')).toHaveText('En ny versjon er klar.');
  const box = await page.locator('#update-notice').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(700);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await expect(page.locator('.build')).toContainText('bbbbbbb');
  expect(navigations).toHaveLength(0); expect(await savedSongs(page)).toEqual(before);
  await page.getByRole('button', {name:'Oppdater nå',exact:true}).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.build')).toContainText('ccccccc');
  expect(await savedSongs(page)).toEqual(before);
});

for (const trigger of ['focus', 'online']) {
  test(`automatic update check when returning via ${trigger}`, async ({page, request, context}) => {
    await page.goto(url); await ready(page);
    if (trigger === 'online') await context.setOffline(true);
    await request.post('/__test__/update?channel=test');
    if (trigger === 'online') await context.setOffline(false);
    else await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#update-notice')).toBeVisible();
    await expect(page.locator('.build')).toContainText('bbbbbbb');
    await page.getByRole('button', {name:'Oppdater nå',exact:true}).click();
    await expect(page.locator('.build')).toContainText('ccccccc');
  });
}

test('waiting update is announced after reopening; other tabs only reload by choice', async ({page, request, context}) => {
  await page.goto(url); await ready(page);
  await request.post('/__test__/update?channel=test');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect(page.locator('#update-notice')).toBeVisible();
  const other = await context.newPage(); await other.goto(url);
  await expect(other.locator('#update-notice')).toBeVisible();
  await expect(other.locator('.build')).toContainText('bbbbbbb');
  await other.getByRole('button', {name:'Oppdater nå',exact:true}).click();
  await expect(other.locator('.build')).toContainText('ccccccc');
  await expect(page.locator('.build')).toContainText('bbbbbbb');
  await page.getByRole('button', {name:'Oppdater nå',exact:true}).click();
  await expect(page.locator('.build')).toContainText('ccccccc');
});


test('same app build never announces a new version when its worker is repacked or takes control', async ({page, request}) => {
  await page.goto(url); await ready(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await importSong(page); const before = await savedSongs(page);
  await request.post('/__test__/update?channel=test&variant=same');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
  await page.getByRole('button', {name:'Se etter oppdatering',exact:true}).click();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await expect(page.locator('#update-notice')).toBeHidden();
  await page.evaluate(async () => {
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true});
      navigator.serviceWorker.getRegistration().then(reg => reg.waiting.postMessage({type:'SKIP_WAITING'}));
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', {name:'Se etter oppdatering',exact:true}).click();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await expect(page.locator('#update-notice')).toBeHidden();
  expect(await savedSongs(page)).toEqual(before);
});


test('fresh page already on latest build does not announce its older controller or the matching waiting worker', async ({page, context, request}) => {
  await page.goto(url); await ready(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const keeper = await context.newPage(); await keeper.goto(url); await ready(keeper);
  await request.post('/__test__/update?channel=test');
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  // Reproduce fresh HTML arriving while an older worker still controls the page.
  await session.send('Network.setBypassServiceWorker', {bypass:true});
  await page.reload(); await expect(page.locator('.build')).toContainText('ccccccc');
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
  await page.getByRole('button', {name:'Se etter oppdatering',exact:true}).click();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await expect(page.locator('#update-notice')).toBeHidden();
  await session.send('Network.setBypassServiceWorker', {bypass:false});
  await page.evaluate(async () => {
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true});
      navigator.serviceWorker.getRegistration().then(reg => reg.waiting.postMessage({type:'SKIP_WAITING'}));
    });
  });
  await page.getByRole('button', {name:'Se etter oppdatering',exact:true}).click();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await expect(page.locator('#update-notice')).toBeHidden();
  await expect(page.locator('.build')).toContainText('ccccccc');
});


test('manual check joins a background check and its result survives subsequent automatic checks', async ({page}) => {
  await page.goto(url); await ready(page);
  await page.locator('#update').click();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await page.evaluate(() => {
    const original = ServiceWorkerRegistration.prototype.update;
    const gate = new Promise(resolve => {window.releaseUpdateCheck = resolve;});
    window.updateChecksStarted = 0; window.updateChecksCompleted = 0;
    ServiceWorkerRegistration.prototype.update = async function () {
      window.updateChecksStarted++; await gate;
      const result = await original.call(this); window.updateChecksCompleted++; return result;
    };
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => page.evaluate(() => window.updateChecksStarted)).toBe(1);
  await page.locator('#update').click();
  await expect(page.locator('#update-status')).toHaveText('Ser etter oppdatering…');
  await page.evaluate(() => window.releaseUpdateCheck());
  await expect(page.locator('#update')).toBeEnabled();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate(() => window.updateChecksCompleted)).toBe(2);
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await expect(page.locator('#update-notice')).toBeHidden();
});
