import {test,expect} from '@playwright/test';
import {importSong,savedSongs,openMenu,goSongs,setCapo,setDisplay} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const modal=page=>page.getByRole('dialog',{name:'Rediger sangtekst',exact:true});
const ok=page=>modal(page).getByRole('button',{name:'OK',exact:true}).click();
const cancel=page=>modal(page).getByRole('button',{name:'Avbryt',exact:true}).click();
const fresh=async page=>{if(!await page.locator('#library').isVisible())await goSongs(page);await page.getByRole('button',{name:'Legg til sang',exact:true}).click();await page.getByRole('menuitem',{name:'Opprett',exact:true}).click();await expect(modal(page)).toBeVisible();};
const edit=async page=>{await page.getByRole('button',{name:'Rediger',exact:true}).click();};
const original=async page=>{await page.getByRole('button',{name:'Rediger sangtekst',exact:true}).click();};
const save=async page=>{await page.locator('#edit-save').click();await expect(page.locator('#edit-save')).toBeDisabled();};
const records=page=>page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction('personal'),get=tx.objectStore('personal').getAll();tx.oncomplete=()=>{db.close();resolve(get.result);};};}));
test.beforeEach(async({request,page})=>{await request.post('/__test__/reset');await page.goto(url);});

test('new song stays in memory until Save; first cancel and discard leave no orphan, same titles keep distinct identities',async({page})=>{
 await fresh(page);await expect(page.locator('#original-title')).toHaveValue('');await expect(page.locator('#original-text')).toHaveValue('');await expect(modal(page).getByRole('button',{name:'OK',exact:true})).toBeDisabled();
 await page.locator('#original-title').fill('   ');await expect(modal(page).getByRole('button',{name:'OK',exact:true})).toBeDisabled();await cancel(page);await expect(page.locator('#library')).toBeVisible();expect(await savedSongs(page)).toEqual([]);expect(await records(page)).toEqual([]);
 await fresh(page);await page.locator('#original-title').fill('Lik tittel');await ok(page);await expect(page.locator('#song-title')).toHaveText('Lik tittel');expect(await savedSongs(page)).toEqual([]);
 await setCapo(page,2);await original(page);await page.locator('#original-title').fill('Forkast dette');await cancel(page);await expect(page.locator('#song-title')).toHaveText('Lik tittel');await expect(page.locator('#capo-pill')).toContainText('2');
 await page.locator('#back').click();await page.getByRole('button',{name:'Fortsett redigering'}).click();await page.locator('#back').click();await page.getByRole('button',{name:'Forkast endringer'}).click();expect(await savedSongs(page)).toEqual([]);expect(await records(page)).toEqual([]);
 for(let n=0;n<2;n++){await fresh(page);await page.locator('#original-title').fill('Lik tittel');await ok(page);await save(page);await expect(page.locator('.edit-toolbar')).toBeVisible();await page.locator('#back').click();}
 const saved=await savedSongs(page);expect(saved).toHaveLength(2);expect(saved[0].id).not.toBe(saved[1].id);for(const song of saved){expect(song.origin.kind).toBe('local');expect(song.origin.provider).toBeUndefined();expect(song.original).toBe('{title: Lik tittel}\n');}
});

test('modal confirmation, popup cancellation, source preservation, unified Save and undo/clipboard shortcuts',async({page})=>{
 const source='\uFEFF {t: Enkel} \r\nFørste æøå\r\nSiste 😀\r\n';await importSong(page,'enkel.txt',source);const before=(await savedSongs(page))[0];await edit(page);await original(page);await ok(page);await expect(page.locator('#edit-save')).toBeDisabled();expect((await savedSongs(page))[0]).toEqual(before);
 await original(page);await page.locator('#original-title').fill('Ny tittel');await page.locator('#original-time').click();await page.getByRole('textbox',{name:'Takt',exact:true}).fill('6/8');await page.keyboard.press('Escape');await expect(modal(page)).toBeVisible();await expect(page.locator('#original-time')).toContainText('4/4');
 await page.locator('#original-key').click();await page.getByRole('textbox',{name:'Toneart',exact:true}).fill('D');await page.getByRole('dialog',{name:'Toneart',exact:true}).getByRole('button',{name:'OK',exact:true}).click();
 await page.locator('#original-text').focus();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type('Ny linje');await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('#original-text')).toHaveValue('Første æøå\nSiste 😀\n');await page.keyboard.press('ControlOrMeta+Shift+z');
 await page.keyboard.press('ControlOrMeta+s');expect((await savedSongs(page))[0]).toEqual(before);
 await page.locator('#original-text').click({button:'right'});await expect(modal(page).getByRole('menu',{name:'Tekstvalg'})).toBeVisible();await page.keyboard.press('Escape');await expect(modal(page)).toBeVisible();
 await ok(page);await expect(page.locator('#song-title')).toHaveText('Ny tittel');expect((await savedSongs(page))[0]).toEqual(before);await setCapo(page,3);await save(page);
 const saved=(await savedSongs(page))[0];expect(saved.id).toBe(before.id);expect(saved.origin).toEqual(before.origin);expect(saved.original).toBe('\uFEFF{key: D}\r\n {t: Ny tittel} \r\nFørste æøå\r\nSiste 😀\r\nNy linje');expect((await records(page))[0].capo).toBe(3);
 await original(page);await page.locator('#original-key').click();await expect(page.getByRole('textbox',{name:'Toneart',exact:true})).toHaveAttribute('readonly','');await page.keyboard.press('Escape');await expect(modal(page)).toBeVisible();await cancel(page);await expect(page.locator('#edit-original')).toBeFocused();
});

test('transaction abort rolls back both layers and new-song creation; retry does not duplicate',async({page})=>{
 await fresh(page);await page.locator('#original-title').fill('Trygg');await page.locator('#original-text').fill('Tekst');await ok(page);await setCapo(page,2);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restorePut=()=>IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(this.name==='personal')this.transaction.abort();return request;};});
 await page.locator('#edit-save').click();await expect(page.locator('#song-status')).toContainText('Kunne ikke lagre');expect(await savedSongs(page)).toEqual([]);expect(await records(page)).toEqual([]);await expect(page.locator('#edit-save')).toBeEnabled();
 await page.evaluate(()=>window.restorePut());await save(page);const before=(await savedSongs(page))[0];await original(page);await page.locator('#original-title').fill('Endret');await ok(page);await setCapo(page,4);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restorePut=()=>IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(this.name==='personal')this.transaction.abort();return request;};});
 await page.locator('#edit-save').click();await expect(page.locator('#song-status')).toContainText('Kunne ikke lagre');expect((await savedSongs(page))[0]).toEqual(before);expect((await records(page))[0].capo).toBe(2);await page.evaluate(()=>window.restorePut());await save(page);expect(await savedSongs(page)).toHaveLength(1);expect((await records(page))[0].capo).toBe(4);
});

test('protected structures survive and late notes from another tab merge with original edits',async({page})=>{
 await importSong(page,'struktur.cho','{t: Struktur}\n[D]Akkord\n{soc}\nOrd\n{eoc}\n{chorus}\n{x_future: Behold}');const before=(await savedSongs(page))[0];await edit(page);await original(page);await expect(page.locator('#original-text')).toHaveCount(0);await expect(page.locator('#original-protection')).toBeVisible();await expect(page.locator('#original-title')).toHaveAttribute('readonly','');await expect(page.locator('#original-key')).toBeDisabled();await expect(page.locator('#original-time')).toBeDisabled();await expect(page.locator('#original-protection')).toContainText('refreng');await cancel(page);await setCapo(page,2);await save(page);expect((await savedSongs(page))[0]).toEqual(before);await page.locator('#back').click();await page.locator('#back').click();
 await importSong(page,'enkel.txt','{t: Enkel}\nOrd');const plain=(await savedSongs(page)).find(song=>song.title==='Enkel');await edit(page);await original(page);await page.locator('#original-title').fill('Utkast');await ok(page);await setCapo(page,3);
 await page.evaluate(song=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction('personal','readwrite');tx.objectStore('personal').put({songId:song.id,chorus:{},version:3,tuning:'Annen fane',notes:{late:{line:0,text:'Behold notat'}}});tx.oncomplete=()=>{db.close();resolve();};};}),plain);
 await save(page);expect((await savedSongs(page)).find(song=>song.id===plain.id).title).toBe('Utkast');const state=(await records(page)).find(item=>item.songId===plain.id);expect(state.tuning).toBe('Annen fane');expect(state.capo).toBe(3);expect(state.notes.late.text).toBe('Behold notat');await expect(page.locator('#song-title')).toHaveText('Utkast');
});

for(const width of [320,768,1440])test(`own scroll and fixed actions at ${width}px, the dark theme and a reduced keyboard viewport`,async({page})=>{
 await page.setViewportSize({width,height:800});await fresh(page);await page.locator('#original-title').fill('Lang');await page.locator('#original-text').fill(Array.from({length:200},(_,n)=>`Linje ${n} æøå`).join('\n'));await ok(page);
 for(const theme of ['dark']){
  await setDisplay(page,{theme,fontSize:36});await original(page);
  const tools=modal(page).getByRole('toolbar',{name:'Formater sangtekst'});await expect(tools).toBeVisible();await expect(tools.locator('*')).toHaveCount(0);const before=await tools.boundingBox();expect(before.height).toBeGreaterThanOrEqual(44);
  await page.locator('#original-text').focus();await page.keyboard.press('ControlOrMeta+End');expect(await tools.boundingBox()).toEqual(before);
  await page.setViewportSize({width,height:420});await expect(tools).toBeInViewport();const reduced=await tools.boundingBox();
  await expect(modal(page).getByRole('button',{name:'OK',exact:true})).toBeInViewport();await expect(modal(page).getByRole('button',{name:'Avbryt',exact:true})).toBeInViewport();expect(await page.locator('#original-text').evaluate(node=>node.scrollTop)).toBeGreaterThan(0);expect(await modal(page).evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.keyboard.press('ControlOrMeta+Home');expect(await page.locator('#original-text').evaluate(node=>node.scrollTop)).toBe(0);expect(await tools.boundingBox()).toEqual(reduced);
  await page.screenshot({path:`test-results/original-${width}-${theme}.png`});await cancel(page);await page.setViewportSize({width,height:800});
 }
});

test('newer originals are rejected and independent fields merge with the latest stored personal state',async({page})=>{
 await importSong(page,'enkel.txt','Ord');const before=(await savedSongs(page))[0];await edit(page);await original(page);await page.locator('#original-title').fill('Mitt utkast');await ok(page);await setCapo(page,2);
 await page.evaluate(song=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction('personal','readwrite');tx.objectStore('personal').put({songId:song.id,chorus:{},tuning:'Ny stemming fra annen fane'});tx.oncomplete=()=>{db.close();resolve();};};}),before);
 await save(page);expect((await records(page))[0].tuning).toBe('Ny stemming fra annen fane');expect((await records(page))[0].capo).toBe(2);
 await original(page);await page.locator('#original-title').fill('Foreldet utkast');await ok(page);await setCapo(page,4);
 await page.evaluate(song=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction('songs','readwrite');tx.objectStore('songs').put({...song,title:'Annen fane',original:'{title: Annen fane}\nNyere ord'});tx.oncomplete=()=>{db.close();resolve();};};}),before);
 await page.locator('#edit-save').click();await expect(page.locator('#song-status')).toContainText('annen fane');expect((await savedSongs(page))[0].title).toBe('Annen fane');expect((await records(page))[0].capo).toBe(2);await expect(page.locator('#song-title')).toHaveText('Foreldet utkast');
});

test('modal and confirmed original drafts block a real worker update; a combined pending save is awaited and survives offline',async({page,request,context})=>{
 await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await fresh(page);await page.locator('#original-title').fill('Oppdatering');await page.locator('#original-text').fill('Behold æøå 😀');
 await request.post('/__test__/update?channel=test');await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());await expect(page.locator('#update-notice')).toBeVisible();
 const origin=await page.evaluate(()=>performance.timeOrigin);
 await page.locator('#update-notice button').evaluate(node=>node.click());await expect(page.locator('#update-notice-text')).toContainText('ulagrede');expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);await expect(modal(page)).toBeVisible();
 await ok(page);await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();await expect(page.locator('#update-notice-text')).toContainText('ulagrede');await setCapo(page,2);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.releaseWrite=false;window.heldWrite=false;IDBObjectStore.prototype.put=function(...args){if(this.name!=='personal')return put.apply(this,args);const store=this;window.heldWrite=true;const keepAlive=()=>{const request=store.get(args[0].songId);request.onsuccess=()=>{if(window.releaseWrite)put.apply(store,args);else keepAlive();};return request;};return keepAlive();};});
 await page.locator('#edit-save').click();await expect.poll(()=>page.evaluate(()=>window.heldWrite)).toBe(true);await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);
 await page.evaluate(()=>window.releaseWrite=true);await expect(page.locator('.build')).toContainText('ccccccc');await expect(page.locator('.edit-toolbar')).toBeVisible();await expect(page.locator('#song-title')).toHaveText('Oppdatering');await expect(page.locator('#capo-pill')).toContainText('2');const saved=await savedSongs(page);expect(saved).toHaveLength(1);
 await context.setOffline(true);await page.reload();await page.locator('.song-choice').click();await expect(page.locator('#song-title')).toHaveText('Oppdatering');expect(await savedSongs(page)).toEqual(saved);await expect(page.locator('#song-body')).toContainText('Behold æøå 😀');await context.setOffline(false);
});

test('edits during an actual transaction remain dirty relative to the submitted snapshot',async({page})=>{
 await fresh(page);await page.locator('#original-title').fill('Innsendt');await ok(page);await setCapo(page,2);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.releaseWrite=false;window.heldWrite=false;IDBObjectStore.prototype.put=function(...args){if(this.name!=='personal')return put.apply(this,args);const store=this;window.heldWrite=true;const keepAlive=()=>{const request=store.get(args[0].songId);request.onsuccess=()=>{if(window.releaseWrite)put.apply(store,args);else keepAlive();};return request;};return keepAlive();};});
 await page.locator('#edit-save').click();await expect.poll(()=>page.evaluate(()=>window.heldWrite)).toBe(true);await original(page);await page.locator('#original-title').fill('Videre utkast');await ok(page);await page.evaluate(()=>window.releaseWrite=true);await expect.poll(async()=>(await savedSongs(page))[0]?.title).toBe('Innsendt');await expect(page.locator('#song-title')).toHaveText('Videre utkast');await expect(page.locator('#edit-save')).toBeEnabled();await save(page);expect((await savedSongs(page))[0].title).toBe('Videre utkast');
});

test('reverting confirmed fields removes introduced metadata and restores the exact saved source',async({page})=>{
 await importSong(page,'fallback.txt','\uFEFFOrd\r\n');const before=(await savedSongs(page))[0];await edit(page);await original(page);await page.locator('#original-title').fill('Midlertidig');await page.locator('#original-text').fill('Endret tekst\n');await ok(page);await expect(page.locator('#edit-save')).toBeEnabled();
 await original(page);await page.locator('#original-title').fill('fallback');await page.locator('#original-text').fill('Ord\n');await ok(page);await expect(page.locator('#edit-save')).toBeDisabled();expect((await savedSongs(page))[0]).toEqual(before);
 await original(page);await page.locator('#original-title').fill('');await expect(modal(page).getByRole('button',{name:'OK',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator('#edit-original')).toBeFocused();
});

test('a created then edited song survives a full browser restart offline in both isolated environments',async({playwright,browserName},testInfo)=>{
 const {mkdtemp,rm,mkdir}=await import('node:fs/promises');await mkdir('work/profiles',{recursive:true});const profile=await mkdtemp('work/profiles/original-');
 const launch=()=>playwright[browserName].launchPersistentContext(profile,{executablePath:testInfo.project.use.launchOptions.executablePath,args:['--no-sandbox'],headless:true});let context;
 const saved={};
 try {
  context=await launch();let page=context.pages()[0];
  for(const channel of ['app','test']){await page.goto(`http://127.0.0.1:4173/hobos-songbook/${channel}/`);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await fresh(page);await page.locator('#original-title').fill(channel);await page.locator('#original-text').fill('Først');await ok(page);await save(page);const id=(await savedSongs(page))[0].id;await original(page);await page.locator('#original-text').fill('Endret æøå 😀');await ok(page);await setCapo(page,2);await save(page);saved[channel]=await savedSongs(page);expect(saved[channel][0].id).toBe(id);}
  await context.close();context=await launch();await context.setOffline(true);page=context.pages()[0];
  for(const channel of ['app','test']){await page.goto(`http://127.0.0.1:4173/hobos-songbook/${channel}/`);await page.locator('.song-choice').click();await expect(page.locator('#song-title')).toHaveText(channel);await expect(page.locator('#song-body')).toContainText('Endret æøå 😀');await expect(page.locator('.song-metadata')).toContainText('Capo 2');expect(await savedSongs(page)).toEqual(saved[channel]);}
 }finally{await context?.close();await rm(profile,{recursive:true,force:true});}
});

for (const width of [320,390,768]) test(`mobile feedback: protected preview and compact popups at ${width}px`,async({browser},testInfo)=>{
 const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true}),page=await context.newPage();
 const source='{t: Banner of Heaven}\n{key: Em}\n{x_dyn: 5}\n[Em]He came to town last summer\n{x_dyn: 2}\n{soc}\n[C]Under the banner of Heaven\n{eoc}\n{chorus}\n{sog}\n| Em . | C . |\n{eog}\n'+('More words\n').repeat(80);
 try {
  await page.goto('http://127.0.0.1:4173'+url);await importSong(page,'banner.cho',source);const before=await savedSongs(page);await edit(page);await setCapo(page,2);
  const toolbar=page.locator('.edit-toolbar');await expect(toolbar).toHaveText('');await expect(toolbar.locator('button > svg')).toHaveCount(5);
  for(const theme of ['dark']){
   await setDisplay(page,{theme});await original(page);await expect(modal(page).locator('header')).toBeFocused();expect(await page.evaluate(()=>document.activeElement.matches('input,textarea'))).toBe(false);
   await expect(page.locator('#original-title')).toHaveAttribute('readonly','');await expect(page.locator('#original-time')).toBeDisabled();await expect(page.locator('#original-protection')).toContainText('refreng');
   const preview=page.locator('.original-preview');await expect(preview.locator('svg,.highlight-controls,.selection-preview,.personal-note,input,textarea,button')).toHaveCount(0);
   const first=preview.locator('.song-line').first();await expect(first).toBeInViewport();await expect(first).toContainText('He came to town last summer');await expect(first.locator('.chord').first()).toHaveText('Em');
   await expect(preview.locator('.chord-grid')).toHaveCount(1);await expect(page.locator('#dynamics-profile')).toHaveCount(1);
   const tools=modal(page).getByRole('toolbar',{name:'Formater sangtekst'});await expect(tools).toBeVisible();await expect(tools.locator('*')).toHaveCount(0);const position=await tools.boundingBox();expect(position.height).toBeGreaterThanOrEqual(44);
   await page.locator('.original-content').evaluate(node=>node.scrollTop=node.scrollHeight);await expect(preview.locator('.song-line').last()).toBeInViewport();await expect(modal(page).getByRole('button',{name:'OK',exact:true})).toBeInViewport();
   expect(await tools.boundingBox()).toEqual(position);
   await page.locator('.original-content').evaluate(node=>node.scrollTop=0);await page.screenshot({path:testInfo.outputPath(`protected-${theme}-${width}.png`)});await cancel(page);
  }
  expect(await savedSongs(page)).toEqual(before);await expect(page.locator('#edit-save')).toBeEnabled();await page.locator('#back').click();await page.getByRole('button',{name:'Forkast endringer'}).click();
  await fresh(page);await expect(modal(page).locator('header')).toBeFocused();await page.locator('#original-title').fill('Dur i moll');
  const inputBox=await page.locator('#original-title').boundingBox(),pillBox=await page.locator('#original-key').boundingBox();expect(pillBox.y-inputBox.y-inputBox.height).toBeGreaterThanOrEqual(11);
  for(const [field,name,maxWidth] of [['key','Toneart',220],['time','Takt',240]]) {
   await page.locator(`#original-${field}`).tap();const popup=page.getByRole('dialog',{name,exact:true}),input=popup.getByRole('textbox',{name,exact:true});
   const bounds=await popup.boundingBox(),fieldBounds=await input.boundingBox();expect(bounds.width).toBeLessThanOrEqual(maxWidth);expect(fieldBounds.width).toBeLessThan(bounds.width*.8);expect(bounds.width).toBeGreaterThan(fieldBounds.width+60);
   await page.setViewportSize({width,height:420});await expect(popup.getByRole('button',{name:'OK',exact:true})).toBeInViewport();await expect(input).toBeInViewport();
   await page.screenshot({path:testInfo.outputPath(`${field}-${width}.png`)});await page.keyboard.press('Escape');await page.setViewportSize({width,height:844});
  }
  await cancel(page);expect(await savedSongs(page)).toEqual(before);
 }finally{await context.close();}
});

test('navigation to song creation guards drafts before replacing an editing session',async({page})=>{
 await importSong(page,'gammel.txt','{t: Gammel}\nBehold teksten');const before=(await savedSongs(page))[0];
 await fresh(page);await cancel(page);expect((await savedSongs(page))[0]).toEqual(before);await page.locator('.song-choice').click();await edit(page);await setCapo(page,2);
 await goSongs(page);await page.getByRole('button',{name:'Fortsett redigering'}).click();await expect(page.locator('#song-title')).toHaveText('Gammel');await expect(page.locator('#capo-pill')).toContainText('2');
 await goSongs(page);await page.getByRole('button',{name:'Forkast endringer'}).click();await page.getByRole('button',{name:'Legg til sang',exact:true}).click();await page.getByRole('menuitem',{name:'Opprett',exact:true}).click();await expect(modal(page)).toBeVisible();await cancel(page);expect(await records(page)).toEqual([]);
 await page.locator('.song-choice').click();await edit(page);await setCapo(page,3);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restorePut=()=>IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.put=function(...args){if(this.name==='personal')throw Error('unavailable');return put.apply(this,args);};});
 await goSongs(page);await page.getByRole('button',{name:'Lagre og gå ut'}).click();await expect(page.locator('#song-status')).toContainText('Kunne ikke lagre');await expect(modal(page)).toHaveCount(0);await expect(page.locator('#capo-pill')).toContainText('3');
 await page.evaluate(()=>window.restorePut());await goSongs(page);await page.getByRole('button',{name:'Lagre og gå ut'}).click();await page.getByRole('button',{name:'Legg til sang',exact:true}).click();await page.getByRole('menuitem',{name:'Opprett',exact:true}).click();await expect(modal(page)).toBeVisible();expect((await records(page))[0].capo).toBe(3);await cancel(page);expect((await savedSongs(page))[0]).toEqual(before);
});
