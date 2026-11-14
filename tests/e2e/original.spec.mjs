import {test,expect} from '@playwright/test';
import {importSong,savedSongs,savedPersonal,rawEditor,tool,fillValue,setCapo,openSettings,closeSettings} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const save=page=>page.getByRole('dialog',{name:'Råtekst',exact:true}).getByRole('button',{name:'Lagre',exact:true}).click();
test.beforeEach(async({page,request})=>{await request.post('/__test__/reset');await page.goto(url);});
test('raw creation transaction abort rolls back both stores and retry creates exactly one stable song',async({page})=>{
 await page.getByRole('button',{name:'Legg til sang',exact:true}).click();await page.getByRole('menuitem',{name:'Opprett',exact:true}).click();await page.getByRole('dialog',{name:'Opprett sang',exact:true}).getByRole('button',{name:'Fortsett',exact:true}).click();await page.locator('#original-text').fill('{title: Ny}\nOrd');
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='personal'){this.transaction.abort();IDBObjectStore.prototype.put=put;}return result;};});
 await save(page);await expect(page.locator('.raw-editor .field-error')).toContainText('Kunne ikke lagre');expect(await savedSongs(page)).toHaveLength(0);expect(await savedPersonal(page)).toHaveLength(0);await expect(page.locator('#original-text')).toHaveValue('{title: Ny}\nOrd');
 await save(page);await expect(page.locator('.raw-editor')).toHaveCount(0);expect(await savedSongs(page)).toHaveLength(1);expect(await savedPersonal(page)).toHaveLength(1);
});
test('a failed autosave keeps personal work and retry succeeds without modifying original',async({page})=>{
 await importSong(page,'enkel.txt','{t: Enkel}\nOrd');const before=await savedSongs(page);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='personal'){this.transaction.abort();IDBObjectStore.prototype.put=put;}return result;};});
 await tool(page,'Capo',true);await page.getByRole('button',{name:'Øk capo',exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator('#song-status')).toContainText('Kunne ikke lagre');expect((await savedPersonal(page))[0]?.capo??0).toBe(0);await page.getByRole('button',{name:'Prøv lagring igjen',exact:true}).click();await expect.poll(async()=>(await savedPersonal(page))[0].capo).toBe(1);expect(await savedSongs(page)).toEqual(before);
});
test('autosave drains edits made during an actual held transaction and remains a single undo group',async({page})=>{
 await importSong(page,'kø.txt','{t: Kø}\nOrd');
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.releaseWrite=false;window.heldWrite=false;IDBObjectStore.prototype.put=function(...args){if(this.name!=='personal'||window.releaseWrite)return put.apply(this,args);const store=this;window.heldWrite=true;const alive=()=>{const r=store.get(args[0].songId);r.onsuccess=()=>{if(window.releaseWrite)put.apply(store,args);else alive();};return r;};return alive();};});
 await tool(page,'Capo',true);await page.getByRole('button',{name:'Øk capo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.heldWrite)).toBe(true);await page.getByRole('button',{name:'Øk capo',exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator('.song-metadata')).toContainText('Capo 2');
 await page.evaluate(()=>window.releaseWrite=true);await expect.poll(async()=>(await savedPersonal(page))[0]?.capo).toBe(2);await page.getByRole('button',{name:'Angre',exact:true}).click();await expect.poll(async()=>(await savedPersonal(page))[0]?.capo??0).toBe(0);
});
test('raw changes preserve unrelated late personal fields and reject a newer original from another tab',async({page})=>{
 await importSong(page,'enkel.txt','{t: Enkel}\nOrd');const before=(await savedSongs(page))[0];const field=await rawEditor(page);await field.fill('{t: Mitt navn}\nOrd');
 await page.evaluate(song=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction('personal','readwrite');tx.objectStore('personal').put({songId:song.id,version:3,chorus:{},tuning:'DADGAD',notes:{late:{line:0,text:'Sen beskjed'}}});tx.oncomplete=()=>{db.close();resolve();};};}),before);
 await save(page);await expect(page.locator('.raw-editor')).toHaveCount(0);expect((await savedPersonal(page))[0].tuning).toBe('DADGAD');expect((await savedPersonal(page))[0].notes.late.text).toBe('Sen beskjed');
 await rawEditor(page);await page.locator('#original-text').fill('{t: Foreldet}\nMitt innhold');await page.evaluate(song=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction('songs','readwrite');tx.objectStore('songs').put({...song,title:'Nyere kilde',original:'{t: Nyere kilde}\nAnnet innhold'});tx.oncomplete=()=>{db.close();resolve();};};}),before);
 await save(page);await expect(page.locator('.raw-editor .field-error')).toContainText('Kunne ikke lagre');expect((await savedSongs(page))[0].title).toBe('Nyere kilde');await expect(page.locator('#original-text')).toHaveValue('{t: Foreldet}\nMitt innhold');
});
test('source with mixed endings and unknown structures survives an unchanged raw Save exactly',async({page})=>{
 const source='\uFEFF{t: Bevar}\r\n{key: D}\r{x_future: behold}\n[D]Ord\r\n{soc}\rKor\n{eoc}\r\n{chorus}';await importSong(page,'bevar.cho',source);const before=await savedSongs(page);await rawEditor(page);await save(page);await expect(page.locator('.raw-editor')).toHaveCount(0);expect(await savedSongs(page)).toEqual(before);
});
test('a raw draft blocks real worker reload and saved source/person fields reopen offline',async({page,request,context})=>{
 await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'offline.txt','{t: Offline}\nOrd');await setCapo(page,2);const field=await rawEditor(page);await field.fill('{t: Offline}\nEndret æøå 😀');
 await request.post('/__test__/update?channel=test');await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());await expect(page.locator('#update-notice')).toBeVisible();const origin=await page.evaluate(()=>performance.timeOrigin);
 await page.locator('#update-notice button').evaluate(b=>b.click());await expect(page.locator('#update-notice-text')).toContainText('Fullfør');expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);
 await save(page);await expect(page.locator('.raw-editor')).toHaveCount(0);await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();await expect(page.locator('.build')).toContainText('ccccccc');await expect(page.locator('.edit-toolbar')).toBeVisible();
 await context.setOffline(true);await page.reload();await page.locator('.song-choice').click();await expect(page.locator('#song-body')).toContainText('Endret æøå 😀');await expect(page.locator('.song-metadata')).toContainText('Capo 2');await context.setOffline(false);
});
test('raw metadata editing is literal and never causes an extra transposition',async({page})=>{
 await importSong(page,'toneart.cho','{title: Toneart}\n{key: C}\n[C]Ord');await setCapo(page,2);await tool(page,'Akkordskjema',true);await page.getByRole('textbox',{name:'Skjematekst',exact:true}).fill('| C |');await page.getByRole('button',{name:'OK',exact:true}).click();await expect.poll(async()=>(await savedPersonal(page))[0].chordGrid).toContain('| D |');
 const field=await rawEditor(page);await field.fill('{title: Toneart}\n{key: D}\n[D]Ord');await save(page);await expect.poll(async()=>(await savedSongs(page))[0].key).toBe('D');expect((await savedPersonal(page))[0].chordGrid).toContain('| D |');
});
test('an unsubmitted small value protects a real worker update without silently transposing',async({page,request})=>{
 await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'felt.cho','{t: Felt}\n{key: C}\n[C]Ord');await tool(page,'Toneart');await page.getByRole('textbox',{name:'Toneart',exact:true}).fill('D');
 await request.post('/__test__/update?channel=test');await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());await expect(page.locator('#update-notice')).toBeVisible();const origin=await page.evaluate(()=>performance.timeOrigin);await page.locator('#update-notice button').evaluate(b=>b.click());await expect(page.locator('#update-notice-text')).toContainText('Fullfør');expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);expect((await savedSongs(page))[0].key).toBe('C');await page.getByRole('textbox',{name:'Toneart',exact:true}).press('Enter');await expect.poll(async()=>(await savedSongs(page))[0].key).toBe('D');await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();await expect(page.locator('.build')).toContainText('ccccccc');
});
