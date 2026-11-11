import {test,expect} from '@playwright/test';
import {importSong,savedSongs,openMenu,openSettings,closeSettings,setCapo} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});
test('all destinations use one header and a toggled accessible right panel',async({page})=>{
 await page.goto(url);
 for(const width of [320,768,1440]){
  await page.setViewportSize({width,height:800});
  for(const [label,id] of [['Setlister','setlists'],['Synkronisering','sync'],['Filer','files'],['Innstillinger','settings'],['Sanger','library']]){
   await openMenu(page);const header=await page.locator('.topbar').boundingBox(),panel=await page.locator('#main-menu').boundingBox();expect(panel.y).toBe(header.y+header.height);expect(panel.y+panel.height).toBe(800);
   await page.getByRole('button',{name:label,exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-page',id);await expect(page.locator('#page-title')).toHaveText(label);
   if(['sync','files'].includes(id)){await expect(page.locator(`#${id} button`)).toHaveCount(0);await expect(page.locator(`#${id}`)).toBeVisible();}
   if(id==='setlists')await expect(page.locator('#add-setlist')).toBeEnabled();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await openMenu(page);await page.locator('#menu-button').click();await expect(page.locator('#main-menu')).toBeHidden();
  await openMenu(page);await page.keyboard.press('Escape');await expect(page.locator('#menu-button')).toBeFocused();
 }
});
test('legacy light preference starts dark and keeps other display values',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('hobos-songbook-test:display',JSON.stringify({theme:'light',fontSize:31,showGrids:false,showDynamics:false})));
 await page.goto(url);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('#theme')).toHaveCount(0);await expect(page.locator('#font-size')).toHaveValue('31');await expect(page.locator('#show-grids')).not.toBeChecked();await expect(page.locator('#show-dynamics')).not.toBeChecked();
 await openSettings(page);await page.locator('#show-grids').check();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('hobos-songbook-test:display')));expect(saved).toMatchObject({theme:'dark',fontSize:31,showGrids:true,showDynamics:false});
});
test('settings visit retains an unsaved song draft; actual navigation owns leave decisions',async({page})=>{
 await page.goto(url);await importSong(page,'draft.txt','{t: Utkast}\nBehold dette');const original=await savedSongs(page);
 await page.locator('#edit-song').click();await setCapo(page,2);await openSettings(page);await page.locator('#font-size').fill('30');await page.locator('#font-size').dispatchEvent('input');await closeSettings(page);
 await expect(page.locator('#capo-pill')).toContainText('2');await expect(page.locator('#edit-save')).toBeEnabled();expect(await savedSongs(page)).toEqual(original);
 await openMenu(page);await page.getByRole('button',{name:'Setlister',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Ulagrede endringer'});await expect(dialog.locator('.dialog-footer')).toHaveAttribute('data-count','3');await expect(dialog.getByRole('button',{name:'Fortsett redigering'})).toBeFocused();await dialog.getByRole('button',{name:'Fortsett redigering'}).click();await expect(page.locator('#capo-pill')).toContainText('2');
 await openMenu(page);await page.getByRole('button',{name:'Setlister',exact:true}).click();await dialog.getByRole('button',{name:'Forkast endringer'}).click();await expect(page.locator('#setlists')).toBeVisible();await expect(page.locator('.edit-toolbar')).toHaveCount(0);expect(await savedSongs(page)).toEqual(original);
});
test('one measured header boundary follows a real layout change',async({page})=>{
 await page.goto(url);await importSong(page,'layout.cho','{t: Rammer}\n{sog}\n| D | A |\n{eog}\n'+('Tekst\n').repeat(80));
 await page.evaluate(()=>document.documentElement.style.setProperty('--header-min-height','92px'));
 await expect.poll(()=>page.locator('.topbar').evaluate(e=>e.getBoundingClientRect().height)).toBe(92);
 await page.evaluate(()=>scrollTo(0,300));expect((await page.locator('#chart-dock').boundingBox()).y).toBe(92);
 await page.locator('#edit-song').click();await expect.poll(()=>page.locator('.edit-toolbar').evaluate(e=>e.getBoundingClientRect().top)).toBe(92);
 await openMenu(page);expect((await page.locator('#main-menu').boundingBox()).y).toBe(92);
});
test('font files are precached and load after a new offline page',async({page,context})=>{
 await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'font.txt','{t: Norske tegn}\nÆrlig øving på åser');await page.evaluate(()=>document.fonts.ready);
 expect(await page.locator('.song-line').first().evaluate(e=>getComputedStyle(e).fontFamily)).toContain('Gentium Book Plus');
 const names=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async k=>(await(await caches.open(k)).keys()).map(r=>r.url)))).flat();});expect(names.some(n=>n.endsWith('.woff2'))).toBe(true);
 await context.setOffline(true);await page.reload();await page.getByRole('button',{name:/Norske tegn/}).click();expect(await page.evaluate(async()=>{await document.fonts.load('22px "Gentium Book Plus"');await document.fonts.load('16px "Inter"');return document.fonts.check('22px "Gentium Book Plus"')&&document.fonts.check('16px "Inter"');})).toBe(true);
});
test('a saved legacy update handoff with settings open restores its song context',async({page})=>{
 await page.goto(url);await importSong(page,'legacy.txt','{t: Eldre utgave}\nTekst');const song=(await savedSongs(page))[0];
 await page.evaluate(id=>history.replaceState({'hobos-songbook-test:update-view':{version:1,songId:id,scrollY:0,chartReleased:false,menu:{open:true,scrollTop:0,infoOpen:true},focusId:'update'}},''),song.id);
 await page.reload();await expect(page.locator('#settings')).toBeVisible();await expect(page.locator('#update')).toBeFocused();await page.locator('#back').click();await expect(page.locator('#song-title')).toHaveText('Eldre utgave');
});

test('finishing a slow initial library read does not replace a user-selected page',async({page})=>{
 await page.addInitScript(()=>{
  const open=indexedDB.open.bind(indexedDB);let first=true;
  indexedDB.open=(...args)=>{
   const request=open(...args);if(first){first=false;Object.defineProperty(request,'onsuccess',{set(handler){request.addEventListener('success',()=>{window.resumeLibrary=()=>handler.call(request,new Event('success'));},{once:true});}});}return request;
  };
 });
 await page.goto(url);await expect.poll(()=>page.evaluate(()=>typeof window.resumeLibrary)).toBe('function');
 await openSettings(page);await page.evaluate(()=>window.resumeLibrary());await expect(page.locator('#library-status')).toContainText('Ingen sanger');await expect(page.locator('#settings')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-page','settings');
});
