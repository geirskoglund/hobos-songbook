import {test,expect} from '@playwright/test';
import {dropboxMock} from './dropbox-mock.mjs';
import {openMenu,importSong,goSongs} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
async function syncPage(page){await openMenu(page);await page.locator('#main-menu').getByRole('button',{name:'Synkronisering',exact:true}).click();}
async function fail(page,mock,status=500){mock.fault('/download',status);await page.locator('#dropbox-sync').click();await expect(page.locator('#sync-status')).toContainText('Synkronisering feilet (Feilkode');}
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('documented Dropbox folder creation completes all book folders without a false failure or log',async({page,context})=>{
 const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);
 for(const path of ['/Songbooks','/Songbooks/Standard','/Songbooks/Standard/Private','/Songbooks/Standard/Shared','/Songbooks/Standard/Import','/Songbooks/Standard/Originals'])expect(mock.find(path)?.['.tag']).toBe('folder');
 await expect(page.locator('#sync-status')).not.toContainText('feilet');await expect(page.getByRole('button',{name:'Kopier feillogg',exact:true})).toBeHidden();expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
 await importSong(page,'sang.cho','{t: Frisk synk}\n[D]Tekst');await expect(page.locator('#sync-status')).not.toContainText('feilet');
 await goSongs(page);await expect.poll(()=>Object.keys(JSON.parse(mock.find('/.app/library.json').text).songs).length).toBe(1);expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
});
test('only the copy icon acts on an error; exact message and private-data-free technical log reach the clipboard',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);await fail(page,mock);
 const copy=page.getByRole('button',{name:'Kopier feillogg',exact:true});await expect(copy).toBeVisible();await expect(page.locator('#sync-status')).toHaveCSS('text-decoration-line','none');await expect(page.locator('#sync-status')).toHaveCSS('color','rgb(199, 186, 169)');
 await page.locator('#sync-status').click({position:{x:5,y:5}});await expect(page.locator('dialog[open]')).toHaveCount(0);
 for(const width of [320,768,1440]){
  await page.setViewportSize({width,height:800});await expect(copy).toBeInViewport();expect((await copy.boundingBox()).width).toBe(44);expect((await copy.boundingBox()).height).toBe(44);await expect(copy.locator('.icon')).toHaveCSS('width','20px');
  expect(await page.locator('#sync-status .sync-error-code').evaluate(n=>n.getClientRects().length)).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`work/sync-diagnostics/error-copy-${width}.png`});
 }
 await page.locator('#dropbox-sync').focus();await page.keyboard.press('Tab');await expect(copy).toBeFocused();await copy.press('Enter');await expect(page.locator('#sync-status')).toContainText('Kopiert.');const text=await page.evaluate(()=>navigator.clipboard.readText()),[message,json]=text.split('\n\n'),entry=JSON.parse(json);
 expect(message).toBe('Synkronisering feilet (Feilkode SYNC-003)');expect(entry.failure.code).toBe('SYNC-003');expect(entry.failure.status).toBe(500);expect(entry.manual).toBe(true);expect(entry.environment.browser).toBe('Chrome');expect(entry.environment.browserVersion).toMatch(/^\d/);expect(entry.environment.os).toBeTruthy();expect(entry.operations.some(o=>o.operation==='files/download'&&o.status===500)).toBe(true);
 for(const forbidden of ['fixture-access','fixture-refresh','dbid:fixture','Prøvebruker','@eksempel.no','Authorization','userAgent','path_display'])expect(text).not.toContain(forbidden);
 await expect.poll(()=>Boolean(mock.find('/.app/sync-errors.json'))).toBe(true);expect(JSON.parse(mock.find('/.app/sync-errors.json').text).entries.some(e=>e.id===entry.id)).toBe(true);
 await page.locator('#dropbox-sync').click();await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');await expect(copy).toBeHidden();await expect(page.locator('#sync-status [role=button]')).toHaveCount(0);
});
test('a local error can be copied after an offline restart without Dropbox',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const mock=await dropboxMock(context);await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);await fail(page,mock);const before=JSON.parse(await page.evaluate(()=>localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1'))).active;
 await context.setOffline(true);await page.reload();await syncPage(page);await expect(page.locator('#sync-status')).toHaveText('Synkronisering feilet (Feilkode SYNC-003)');await page.getByRole('button',{name:'Kopier feillogg',exact:true}).click();
 const text=await page.evaluate(()=>navigator.clipboard.readText());expect(JSON.parse(text.split('\n\n')[1]).id).toBe(before);await expect(page.locator('dialog[open]')).toHaveCount(0);
});
test('failed clipboard access keeps the original sync log and uses existing inline status feedback',async({page,context})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked');}}});document.execCommand=()=>{throw Error('blocked fallback');};});
 const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);await fail(page,mock);const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1')).active);
 await page.getByRole('button',{name:'Kopier feillogg',exact:true}).click();await expect(page.locator('#sync-status')).toContainText('Kopiering mislyktes. Prøv igjen.');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hobos-songbook-test:sync-diagnostics-v1')).active)).toBe(before);await expect(page.locator('#sync-status textarea')).toHaveCount(0);await expect(page.locator('dialog[open]')).toHaveCount(0);
});
test('an authentication failure remains locally copyable after Dropbox access is removed',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);mock.fault('/download',401);await page.locator('#dropbox-sync').click();
 await expect(page.locator('#dropbox-connect')).toBeVisible();await expect(page.locator('.sync-connect [role=status]')).toContainText('Feilkode SYNC-004');await expect(page.locator('.sync-connect [role=status]')).toContainText('Koble til Dropbox på nytt.');
 for(const width of [320,768,1440]){await page.setViewportSize({width,height:800});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await expect(page.locator('.topbar')).toBeInViewport();await expect(page.getByRole('button',{name:'Kopier feillogg',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`work/sync-diagnostics/auth-error-${width}.png`});}
 await page.getByRole('button',{name:'Kopier feillogg',exact:true}).click();const text=await page.evaluate(()=>navigator.clipboard.readText());expect(JSON.parse(text.split('\n\n')[1]).failure.code).toBe('SYNC-004');expect(mock.find('/.app/sync-errors.json')).toBeUndefined();await expect(page.locator('dialog[open]')).toHaveCount(0);
});
test('a transport failure keeps its log local and uploads it after healthy sync without extra failed requests',async({page,context})=>{
 const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);await expect(page.locator('#dropbox-sync')).toBeEnabled();const before=mock.calls.length;
 await fail(page,mock,0);await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-002');await expect(page.locator('#dropbox-sync')).toBeEnabled();expect(mock.calls.length-before).toBe(1);expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
 await page.locator('#dropbox-sync').click();await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');await expect.poll(()=>Boolean(mock.find('/.app/sync-errors.json'))).toBe(true);expect(JSON.parse(mock.find('/.app/sync-errors.json').text).entries.at(-1).failure.code).toBe('SYNC-002');
});
test('disconnecting during a retry cannot resurrect its earlier failure or leave an empty status block',async({page,context})=>{
 const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);await fail(page,mock);await expect(page.locator('#dropbox-sync')).toBeEnabled();
 await expect.poll(()=>Boolean(mock.find('/.app/sync-errors.json'))).toBe(true);
 const release=mock.hold('/download');try{await page.locator('#dropbox-sync').click();await expect(page.locator('#sync-status')).toContainText('Synkroniserer…');await page.locator('#dropbox-disconnect').click();await page.getByRole('dialog',{name:'Koble fra Dropbox',exact:true}).getByRole('button',{name:'Koble fra',exact:true}).click();}finally{release();}
 await expect(page.locator('#dropbox-connect')).toBeVisible();await expect(page.locator('.sync-connect [role=status]')).toBeHidden();await expect(page.getByRole('button',{name:'Kopier feillogg',exact:true})).toBeHidden();
 const button=await page.locator('#dropbox-connect').boundingBox(),container=await page.locator('.sync-connect').boundingBox();expect(Math.abs(button.y+button.height/2-container.y-container.height/2)).toBeLessThan(2);
});
test('an ordinary Dropbox folder rename waits for manual sync without generating an error or log',async({page,context})=>{
 const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);await expect(page.locator('#dropbox-sync')).toBeEnabled();
 const book=JSON.parse(mock.find('/.app/library.json').text).books.standard;mock.rename(book.folderId,'/Songbooks/Nytt navn');await page.evaluate(()=>dispatchEvent(new Event('online')));
 await expect(page.locator('#sync-status')).toContainText('Dropbox har endringer. Trykk Synkroniser for å hente dem.');await expect(page.locator('#sync-status')).not.toContainText('feilet');await expect(page.getByRole('button',{name:'Kopier feillogg',exact:true})).toBeHidden();expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
 await page.locator('#dropbox-sync').click();await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');expect(JSON.parse(mock.find('/.app/library.json').text).books.standard.name).toBe('Nytt navn');expect(mock.find('/.app/sync-errors.json')).toBeUndefined();
});
test('a real folder collision and unconfirmed revocation give concrete user guidance',async({page,context})=>{
 const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await syncPage(page);await expect(page.locator('#dropbox-sync')).toBeEnabled();
 mock.entries.delete('/.app/songs');mock.put('/.app/songs','PRIVATE_FILE_CONTENT');await page.locator('#dropbox-sync').click();
 await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-010');await expect(page.locator('#sync-status')).toContainText('flytt filen eller endre filnavnet');expect(mock.find('/.app/songs').text).toBe('PRIVATE_FILE_CONTENT');
 await page.setViewportSize({width:320,height:800});await expect(page.getByRole('button',{name:'Kopier feillogg',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);await page.screenshot({path:'work/sync-diagnostics/folder-collision-320.png'});
 mock.fault('/token/revoke',500);await page.locator('#dropbox-disconnect').click();await page.getByRole('dialog',{name:'Koble fra Dropbox',exact:true}).getByRole('button',{name:'Koble fra',exact:true}).click();await expect(page.locator('.sync-connect [role=status]')).toContainText('Feilkode SYNC-023');await expect(page.locator('.sync-connect [role=status]')).toContainText('Kontroller appens tilgang under tilkoblede apper i Dropbox.');
});
