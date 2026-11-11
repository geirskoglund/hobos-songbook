import {test, expect} from '@playwright/test';
import {importSong, savedSongs, openSettings, closeSettings, setDisplay} from './song-helpers.mjs';
const url = '/hobos-songbook/test/';
const ready = page => expect(page.locator('#offline-status')).toHaveAttribute('data-ready', 'true');
test.beforeEach(async ({request}) => {await request.post('/__test__/reset');});

test('update on first visit activates and reloads without requiring an earlier page reload', async ({page, request}) => {
  await page.goto(url); await ready(page);
  await importSong(page);
  const before = await savedSongs(page);
  await request.post('/__test__/update?channel=test');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await openSettings(page);
  await page.getByRole('button', {name:'Oppdater appen', exact:true}).click();
  await expect(page.locator('.build')).toContainText('ccccccc');
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#song-title')).toHaveText('Samme tittel');
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#update')).toBeFocused();
  expect(await savedSongs(page)).toEqual(before);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await openSettings(page);
  await page.getByRole('button', {name:'Se etter oppdatering',exact:true}).click();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await expect(page.locator('#update-notice')).toBeHidden();
  await closeSettings(page); await page.reload();
  await expect(page.locator('#library')).toBeVisible();
  await expect(page.locator('#reader')).toBeHidden();
});

test('long reading session gets an automatic visible notice; update still needs an explicit choice', async ({page, request}) => {
  await page.clock.install();
  await page.setViewportSize({width:320,height:700});
  await page.goto(url); await ready(page);
  await importSong(page, 'lang.txt', '{title: Lang sang}\n'+Array.from({length:100},(_,index)=>`Linje ${index+1}\n`).join(''));
  const before = await savedSongs(page);

  await page.addStyleTag({content:'.song-line {line-height:1.8; min-height:1.8em}'});
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
  const anchor=await page.locator('.song-line').evaluateAll(rows=>{
    const top=document.querySelector('.topbar').getBoundingClientRect().bottom;
    const row=rows.find(row=>row.getBoundingClientRect().bottom>top);
    return {text:row.textContent,y:row.getBoundingClientRect().top,scroll:scrollY};
  });
  await page.getByRole('button', {name:'Oppdater nå',exact:true}).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.build')).toContainText('ccccccc');
  await expect(page.locator('#song-title')).toHaveText('Lang sang');
  await expect(page.locator('#reader')).toBeVisible();
  const restored=page.locator('.song-line').filter({hasText:new RegExp(`^${anchor.text}$`)});
  await expect.poll(async()=>Math.abs((await restored.boundingBox()).y-anchor.y)).toBeLessThan(1);
  expect(await page.evaluate(()=>scrollY)).toBeLessThan(anchor.scroll);
  await expect(page.locator('#settings')).toBeHidden();
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
  await importSong(page,'første.txt','{t: Første fane}\n'+('Første tekst\n').repeat(120));
  await page.evaluate(()=>scrollTo(0,800));
  await request.post('/__test__/update?channel=test');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect(page.locator('#update-notice')).toBeVisible();
  const other = await context.newPage(); await other.goto(url);
  await importSong(other,'andre.txt','{t: Andre fane}\n'+('Andre tekst\n').repeat(120));
  await other.evaluate(()=>scrollTo(0,400));
  await expect(other.locator('#update-notice')).toBeVisible();
  await expect(other.locator('.build')).toContainText('bbbbbbb');
  await other.getByRole('button', {name:'Oppdater nå',exact:true}).click();
  await expect(other.locator('.build')).toContainText('ccccccc');
  await expect(other.locator('#song-title')).toHaveText('Andre fane');
  await expect(other.locator('#reader')).toBeVisible();
  await expect.poll(()=>other.evaluate(()=>scrollY)).toBe(400);
  await expect(page.locator('.build')).toContainText('bbbbbbb');
  await expect(page.locator('#song-title')).toHaveText('Første fane');
  await page.getByRole('button', {name:'Oppdater nå',exact:true}).click();
  await expect(page.locator('.build')).toContainText('ccccccc');
  await expect(page.locator('#song-title')).toHaveText('Første fane');
  await expect(page.locator('#reader')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(800);
});

test('update restores library scroll, settings dialog and its scroll position', async ({page,request})=>{
  await page.setViewportSize({width:320,height:520}); await page.goto(url); await ready(page);
  for(let index=0;index<6;index++) {
    await importSong(page,`${index}.txt`,`{t: Sang ${index}}\nTekst`);
    await page.getByRole('button',{name:'← Mine sanger'}).click();
  }
  const before=await savedSongs(page);
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  await request.post('/__test__/update?channel=test');
  await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());
  await expect(page.locator('#update-notice')).toBeVisible();
  await openSettings(page);
  await page.locator('#update').scrollIntoViewIfNeeded();
  const position=await page.evaluate(()=>({page:scrollY}));
  await page.getByRole('button',{name:'Oppdater appen',exact:true}).click();
  await expect(page.locator('.build')).toContainText('ccccccc');
  await expect(page.locator('#library')).toBeHidden();
  await expect(page.locator('#settings')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(position.page);
  expect(await savedSongs(page)).toEqual(before);
  await closeSettings(page); await page.getByRole('button',{name:'Sang 2',exact:false}).click();
  await expect(page.locator('#song-title')).toHaveText('Sang 2');
  expect(await page.evaluate(()=>scrollY)).toBe(0);
});

test('update restores the selected song, expanded chorus and released chart', async ({page,request})=>{
  await page.goto(url);await ready(page);
  const original='{t: Samme navn}\n{start_of_grid}\n| C . | G . |\n{end_of_grid}\n{soc}\nRefrengtekst\n{eoc}\n{chorus}\n'+('Sangtekst\n').repeat(120);
  await importSong(page,'første.cho',original);
  await page.getByRole('button',{name:'← Mine sanger'}).click();
  await importSong(page,'valgt.cho',original.replace('Refrengtekst','Valgt refrengtekst'));
  const before=await savedSongs(page);
  await page.getByRole('button',{name:'Refreng',exact:true}).click();
  await expect(page.getByRole('button',{name:'Refreng',exact:true})).toHaveAttribute('aria-expanded','true');
  await page.getByRole('button',{name:'Frigjør akkordskjema'}).click();
  await page.evaluate(()=>scrollTo(0,700));
  await request.post('/__test__/update?channel=test');
  await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());
  await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();
  await expect(page.locator('.build')).toContainText('ccccccc');
  await expect(page.locator('#reader')).toBeVisible();
  await expect(page.locator('#song-content')).toContainText('Valgt refrengtekst');
  await expect(page.getByRole('button',{name:'Refreng',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#chart-dock')).toHaveAttribute('data-sticky','false');
  await expect.poll(()=>page.evaluate(()=>Math.abs(scrollY-700))).toBeLessThanOrEqual(1);
  expect(await savedSongs(page)).toEqual(before);
  await page.getByRole('button',{name:'← Mine sanger'}).click();
  await page.getByRole('button',{name:/valgt.cho/}).click();
  await expect(page.locator('#chart-dock')).toHaveAttribute('data-sticky','true');
  expect(await page.evaluate(()=>scrollY)).toBe(0);
});

test('update still completes without data loss when session history cannot be written', async ({page,request})=>{
  await page.goto(url);await ready(page);await importSong(page);
  const before=await savedSongs(page);
  await request.post('/__test__/update?channel=test');
  await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());
  await expect(page.locator('#update-notice')).toBeVisible();
  await page.evaluate(()=>{History.prototype.replaceState=()=>{throw new DOMException('History unavailable','SecurityError');};});
  await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();
  await expect(page.locator('.build')).toContainText('ccccccc');
  await expect(page.locator('#library')).toBeVisible();
  expect(await savedSongs(page)).toEqual(before);
});


test('same app build never announces a new version when its worker is repacked or takes control', async ({page, request}) => {
  await page.goto(url); await ready(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await importSong(page); const before = await savedSongs(page);
  await request.post('/__test__/update?channel=test&variant=same');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
  await openSettings(page);
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
  await openSettings(page);
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
  await openSettings(page);
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
  await openSettings(page);
  await page.getByRole('button', {name:'Se etter oppdatering',exact:true}).click();
  await expect(page.locator('#update-status')).toHaveText('Du har siste tilgjengelige versjon.');
  await expect(page.locator('#update-notice')).toBeHidden();
  await expect(page.locator('.build')).toContainText('ccccccc');
});


test('manual check joins a background check and its result survives subsequent automatic checks', async ({page}) => {
  await page.goto(url); await ready(page);
  await openSettings(page);
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
  await openSettings(page);
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
