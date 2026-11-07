import {test, expect} from '@playwright/test';
import {importSong, savedSongs, openMenu} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const original='\uFEFF{t: Personlig}\r\n{key: D}\r\n{sog: shape="2x4" label="Intro"}\r\n| D . D/F# . | Bm7 . A . |\r\n{eog}\r\n[D]Ærlig [D/F#]øvelse å [Bm7]synge\r\n{soc}\r\n[D]Samme tekst\r\n{eoc}\r\n{chorus}\r\n{chorus}\r\n'+('Lang leselinje\r\n').repeat(90);
const edit=async page=>{await openMenu(page);await page.getByRole('button',{name:'Rediger',exact:true}).click();await expect(page.locator('.personal-editor')).toBeVisible();};
const done=async page=>{await page.getByRole('button',{name:'Ferdig',exact:true}).click();await expect(page.locator('.personal-editor')).toHaveCount(0);};
const personal=page=>page.evaluate(()=>new Promise((resolve,reject)=>{
 const request=indexedDB.open('hobos-songbook-test',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,get=db.transaction('personal').objectStore('personal').getAll();get.onsuccess=()=>{db.close();resolve(get.result);};};
}));
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('protected performance, both editing entries, capo in text and grid, removal and return position',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);const before=await savedSongs(page);
 await page.locator('.song-line').first().click({button:'right'});await page.keyboard.press('Escape');
 await expect(page.locator('.personal-editor,.annotate-line')).toHaveCount(0);
 await page.evaluate(()=>scrollTo(0,700));await edit(page);
 await page.locator('#personal-capo').fill('2');await page.locator('#personal-chord-view').selectOption('grips');await page.locator('#personal-tuning').fill('D A D G A D');await done(page);
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(700);
 await expect(page.locator('.song-key').first()).toHaveText('D');await expect(page.locator('.song-metadata')).toContainText('Capo 2: C');
 await expect(page.locator('.song-metadata')).toContainText('D A D G A D');
 expect(await page.locator('.song-line .chord').allTextContents()).toContain('C/E');expect(await page.locator('.grid-chord').allTextContents()).toContain('Am7');
 expect(await savedSongs(page)).toEqual(before);
 await page.getByRole('button',{name:'← Mine sanger'}).click();await page.locator('.song-actions summary').click();await page.locator('.song-actions button').click();
 await expect(page.locator('#personal-capo')).toHaveValue('2');await page.locator('#personal-capo').fill('');await done(page);await expect(page.locator('#library')).toBeVisible();
 await page.locator('.song-choice').click();await expect(page.locator('.song-metadata')).not.toContainText('Capo');
 expect(await page.locator('.song-line .chord').allTextContents()).toContain('D/F#');
});

test('personal grid copies sounding source, validates drafts, previews and falls back after removal',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);
 await page.getByRole('button',{name:'Kopier felles skjema'}).click();await expect(page.locator('#personal-grid')).toHaveValue(/D\/F#/);
 await page.locator('#personal-grid').fill('| Em . G . |');await expect(page.locator('.grid-preview')).toContainText('Em');await done(page);
 await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','personal');await expect(page.locator('#chart-dock')).toContainText('Em');
 await edit(page);await page.locator('#personal-grid').fill('ugyldig');await page.getByRole('button',{name:'Ferdig',exact:true}).click();await expect(page.locator('.personal-editor')).toBeVisible();
 expect((await personal(page))[0].chordGrid).toBe('| Em . G . |');
 await page.getByRole('button',{name:'Fjern personlig skjema'}).click();await done(page);
 await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','shared');await expect(page.locator('#chart-dock')).toContainText('Bm7');
});

test('notes and UTF-16 text spans remain on individual source and repeated chorus occurrences',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);
 const source=page.locator('.song-line[data-occurrence="source/line:5"]');await source.getByRole('button',{name:'Notat / markering'}).click();
 await page.locator('#annotation-note').fill('Syng rolig\nVent på tegn');
 await page.locator('#annotation-text').evaluate(node=>node.setSelectionRange(2,17));await page.getByRole('button',{name:'Gulmarker valgt tekst'}).click();
 await page.getByRole('button',{name:'Refreng',exact:true}).first().click();
 const reference=page.locator('.song-line[data-occurrence="line:9/line:7"]');await reference.getByRole('button',{name:'Notat / markering'}).click();await page.locator('#annotation-note').fill('Bare denne gjentakelsen');await done(page);
 await expect(source.locator('.personal-note')).toHaveText('Syng rolig\nVent på tegn');expect((await source.locator('mark').allTextContents()).join('')).toBe('lig øvelse å sy');
 await expect(page.locator('.personal-note')).toHaveCount(2);await expect(reference.locator('.personal-note')).toHaveText('Bare denne gjentakelsen');
 for(const width of [320,768,1440]) {await page.setViewportSize({width,height:800});await expect(reference.locator('.personal-note')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 const state=(await personal(page))[0];expect(state.annotations['line:9/line:7'].anchor.original).toBe(original);expect(state.annotations['source/line:5'].highlights).toEqual([{start:2,end:17}]);
 await page.reload();await page.locator('.song-choice').click();await expect(page.locator('.personal-note')).toHaveCount(2);
});

test('transaction failure keeps editor changes available for retry without overwriting other fields',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restorePut=()=>{IDBObjectStore.prototype.put=put;};IDBObjectStore.prototype.put=function(...args){if(this.name==='personal'){this.transaction.abort();throw Error('injected failure');}return put.apply(this,args);};});
 await page.locator('#personal-tuning').fill('Drop D');await expect(page.locator('#song-status')).toContainText('Kunne ikke lagre');
 await page.getByRole('button',{name:'Ferdig',exact:true}).click();await expect(page.locator('.personal-editor')).toBeVisible();await expect(page.locator('#personal-tuning')).toHaveValue('Drop D');
 await page.evaluate(()=>window.restorePut());await page.getByRole('button',{name:'Prøv lagring igjen'}).click();await done(page);await expect(page.locator('.song-metadata')).toContainText('Drop D');
});

test('real worker update waits for personal saves, restores editor and return destination exactly once',async({page,request})=>{
 await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'personlig.cho',original);await edit(page);
 await page.locator('#personal-tuning').fill('Åpen G');await request.post('/__test__/update?channel=test');await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());
 await expect(page.locator('#update-notice')).toBeVisible();await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();
 await expect(page.locator('.build')).toContainText('ccccccc');await expect(page.locator('.personal-editor')).toBeVisible();await expect(page.locator('#personal-tuning')).toHaveValue('Åpen G');await done(page);await expect(page.locator('#reader')).toBeVisible();
 await page.reload();await expect(page.locator('#library')).toBeVisible();await expect(page.locator('.personal-editor')).toHaveCount(0);
});

test('independent changes in two tabs preserve fields and stable song identity',async({page,context})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);const songs=await savedSongs(page);
 const other=await context.newPage();await other.goto(url);await other.locator('.song-choice').click();
 await edit(page);await page.locator('#personal-tuning').fill('Drop D');await expect(page.locator('#song-status')).toContainText('er lagret');
 await edit(other);await other.locator('#personal-capo').fill('2');await done(other);
 await page.getByRole('button',{name:'Refreng',exact:true}).first().click();await done(page);
 const state=(await personal(page))[0];expect(state.tuning).toBe('Drop D');expect(state.capo).toBe(2);expect(state.chorus['line:9']).toBe(true);
 await page.getByRole('button',{name:'← Mine sanger'}).click();await importSong(page,'personlig.cho',original);expect((await savedSongs(page)).map(song=>song.id)).toHaveLength(2);
 await edit(page);await expect(page.locator('#personal-capo')).toHaveValue('');await expect(page.locator('#personal-tuning')).toHaveValue('');await done(page);
 expect((await personal(page)).find(record=>record.songId===songs[0].id).tuning).toBe('Drop D');
});

test('personal tuning, capo and chart survive offline reopen without modifying the original',async({page,context})=>{
 await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'personlig.cho',original);const before=await savedSongs(page);
 await edit(page);await page.locator('#personal-capo').fill('7');await page.locator('#personal-tuning').fill('D A D G B E');await page.locator('#personal-grid').fill('| G . D . |');await done(page);
 await context.setOffline(true);await page.reload();await page.locator('.song-choice').click();
 await expect(page.locator('.song-metadata')).toContainText('Capo 7');await expect(page.locator('.song-metadata')).toContainText('D A D G B E');await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','personal');
 expect(await savedSongs(page)).toEqual(before);await context.setOffline(false);
});

test('native lyric selection crosses chord nodes; whole-line and partial removal work in both themes',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);
 const source=page.locator('.song-line[data-occurrence="source/line:5"]');
 await source.evaluate(line=>{
   const lyrics=line.querySelectorAll('.lyric');const range=document.createRange();
   range.setStart(lyrics[0].firstChild,2);range.setEnd(lyrics[4].firstChild,1);
   getSelection().removeAllRanges();getSelection().addRange(range);
   lyrics[4].dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
 });
 const selected=await page.locator('#annotation-text').evaluate(node=>({start:node.selectionStart,end:node.selectionEnd,text:node.value.slice(node.selectionStart,node.selectionEnd)}));
 expect(selected.text).toBe('lig øvelse å');
 await page.getByRole('button',{name:'Gulmarker valgt tekst',exact:true}).click();
 expect((await source.locator('mark').allTextContents()).join('')).toBe(selected.text);
 await page.getByRole('button',{name:'Gulmarker hele linjen',exact:true}).click();
 await page.locator('#annotation-text').evaluate(node=>node.setSelectionRange(2,17));
 await page.getByRole('button',{name:'Fjern markering i valgt tekst',exact:true}).click();
 expect((await source.locator('mark').allTextContents()).join('')).toBe('Ærnge');
 await page.locator('#annotation-note').fill('En lang instruks\nsom skal være lesbar');await done(page);
 for(const theme of ['dark','light']) {
   await openMenu(page);await page.locator('#theme').selectOption(theme);await page.locator('#font-size').fill('36');await page.locator('#font-size').dispatchEvent('input');await page.getByRole('button',{name:'Lukk meny',exact:true}).click();
   await page.setViewportSize({width:320,height:800});await expect(source.locator('.personal-note')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await expect(source.locator('mark').first()).toHaveCSS('background-color','rgb(241, 216, 75)');
 }
 await edit(page);await source.getByRole('button',{name:'Notat / markering'}).click();await page.locator('#annotation-note').fill('');await page.getByRole('button',{name:'Fjern gulmarkeringer',exact:true}).click();await done(page);
 await expect(page.locator('.personal-note,mark')).toHaveCount(0);
});

test('worker reload waits for a genuinely pending transaction and restores the selected annotation',async({page,request})=>{
 await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'personlig.cho',original);await edit(page);
 await page.locator('.song-line[data-occurrence="source/line:5"] .annotate-line').click();
 await request.post('/__test__/update?channel=test');await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());await expect(page.locator('#update-notice')).toBeVisible();
 await page.evaluate(()=>{
   const put=IDBObjectStore.prototype.put; window.releaseWrite=false;window.heldWrite=false;
   IDBObjectStore.prototype.put=function(...args){
     if(this.name!=='personal')return put.apply(this,args);
     const store=this;window.heldWrite=true;
     const keepAlive=()=>{const request=store.get(args[0].songId);request.onsuccess=()=>{if(window.releaseWrite)put.apply(store,args);else keepAlive();};return request;};
     return keepAlive();
   };
 });
 await page.locator('#annotation-note').fill('Bevar også en utestående skriver');await expect.poll(()=>page.evaluate(()=>window.heldWrite)).toBe(true);
 const origin=await page.evaluate(()=>performance.timeOrigin);await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();
 await expect(page.locator('#update-notice-text')).toContainText('Tar i bruk');expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);
 await expect(page.locator('#annotation-note')).toHaveValue('Bevar også en utestående skriver');await page.evaluate(()=>{window.releaseWrite=true;});
 await expect(page.locator('.build')).toContainText('ccccccc');await expect(page.locator('#annotation-note')).toBeVisible();await expect(page.locator('#annotation-note')).toHaveValue('Bevar også en utestående skriver');await done(page);
 await expect(page.locator('.personal-note')).toHaveText('Bevar også en utestående skriver');
});

test('failed saving prevents update reload until retry, including when another tab activates the worker',async({page,request,context})=>{
 await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'personlig.cho',original);await edit(page);
 await request.post('/__test__/update?channel=test');await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());await expect(page.locator('#update-notice')).toBeVisible();
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restorePut=()=>{IDBObjectStore.prototype.put=put;};IDBObjectStore.prototype.put=function(...args){if(this.name==='personal')throw Error('no space');return put.apply(this,args);};});
 await page.locator('#personal-tuning').fill('Bevar ved feil');await expect(page.locator('#song-status')).toContainText('Kunne ikke lagre');
 const other=await context.newPage();await other.goto(url);await expect(other.locator('#update-notice')).toBeVisible();await other.getByRole('button',{name:'Oppdater nå',exact:true}).click();await expect(other.locator('.build')).toContainText('ccccccc');
 const origin=await page.evaluate(()=>performance.timeOrigin);await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();await expect(page.locator('#update-notice-text')).toContainText('kunne ikke lagres');
 expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);await expect(page.locator('#personal-tuning')).toHaveValue('Bevar ved feil');
 await page.evaluate(()=>window.restorePut());await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();await expect(page.locator('.build')).toContainText('ccccccc');await expect(page.locator('#personal-tuning')).toHaveValue('Bevar ved feil');await done(page);
});

test('songs without key or original chords accept personal settings and a new independent grid',async({page})=>{
 await page.goto(url);await importSong(page,'uten.txt','Bare sangtekst\nSamme linje');await edit(page);
 await expect(page.getByRole('button',{name:'Kopier felles skjema'})).toBeDisabled();await page.locator('#personal-capo').fill('2');await page.locator('#personal-chord-view').selectOption('grips');await page.locator('#personal-tuning').fill('Åpen stemming');
 await page.getByRole('button',{name:'Opprett tomt skjema'}).click();await page.locator('#personal-grid').fill('| D . D/F# . |');await done(page);
 await expect(page.locator('.song-metadata')).toHaveText('Capo 2Åpen stemming');await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','personal');expect(await page.locator('.grid-chord').allTextContents()).toEqual(['C','C/E']);
 await edit(page);await page.locator('#personal-capo').fill('1.5');await page.getByRole('button',{name:'Ferdig',exact:true}).click();await expect(page.locator('.personal-editor')).toBeVisible();expect((await personal(page))[0].capo).toBe(2);
 await page.locator('#personal-capo').fill('0');await page.getByRole('button',{name:'Fjern personlig skjema'}).click();await done(page);await expect(page.locator('.song-metadata')).toContainText('Capo 0');await expect(page.locator('#chart-dock')).toHaveCount(0);
});

test('full browser restart offline preserves all personal fields and annotations',async({playwright,browserName},testInfo)=>{
 const {mkdtemp,rm,mkdir}=await import('node:fs/promises');await mkdir('work/profiles',{recursive:true});const profile=await mkdtemp('work/profiles/personal-');
 const launch=()=>playwright[browserName].launchPersistentContext(profile,{executablePath:testInfo.project.use.launchOptions.executablePath,args:['--no-sandbox'],headless:true});let context;
 try {
   context=await launch();let page=context.pages()[0];await page.goto('http://127.0.0.1:4173'+url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'personlig.cho',original);const before=await savedSongs(page);await edit(page);
   await page.locator('#personal-capo').fill('2');await page.locator('#personal-chord-view').selectOption('grips');await page.locator('#personal-tuning').fill('Drop D');await page.locator('#personal-grid').fill('| D . |');await page.locator('.song-line[data-occurrence="source/line:5"] .annotate-line').click();await page.locator('#annotation-note').fill('Gjelder offline');await page.getByRole('button',{name:'Gulmarker hele linjen'}).click();await done(page);const stored=await personal(page);
   await context.close();context=await launch();await context.setOffline(true);page=context.pages()[0];await page.goto('http://127.0.0.1:4173'+url);await page.locator('.song-choice').click();await expect(page.locator('.song-metadata')).toContainText('Capo 2: C');await expect(page.locator('.personal-note')).toHaveText('Gjelder offline');expect((await page.locator('mark').allTextContents()).join('')).toBe('Ærlig øvelse å synge');await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','personal');
   expect(await personal(page)).toEqual(stored);expect(await savedSongs(page)).toEqual(before);
 } finally {await context?.close();await rm(profile,{recursive:true,force:true});}
});
