import {test,expect} from '@playwright/test';
import {mkdir,appendFile} from 'node:fs/promises';
import {dropboxMock} from './dropbox-mock.mjs';
import {beginImport,openMenu,savedSongs} from './song-helpers.mjs';
test.use({serviceWorkers:'block'});
const url='/hobos-songbook/test/';
const box=(page,name)=>page.getByRole('dialog',{name,exact:true});
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
async function selectFile(page,name,text){await page.locator('#song-file').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});await expect(page.locator('#add-song')).toBeEnabled();}
async function journal(page){return page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,q=db.transaction('sync').objectStore('sync').get('private-local-v1');q.onsuccess=()=>{db.close();resolve(q.result);};};}));}
const manifest=mock=>JSON.parse(mock.find('/.app/library.json').text);
test.beforeEach(async({request})=>{await request.post('/__test__/reset');await mkdir('work/import-flow',{recursive:true});});

for(const width of [320,768,1440])test(`import returns to the chosen book, allows another import and uploads without a song session at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:800});const mock=await dropboxMock(context);await page.goto(url);await expect.poll(()=>Boolean(mock.find('/.app/library.json'))).toBe(true);await expect(page.locator('#dropbox-sync')).toBeEnabled();
 await page.locator('#songbook-filter').click();await page.getByRole('option',{name:'Standard',exact:true}).click();
 await page.locator('#add-song').click();await page.getByRole('menuitem',{name:'Importer',exact:true}).click();const step=box(page,'Importer i sangbok');await step.getByRole('button',{name:/^Sangbok:/}).click();await button(step,'Ny sangbok').click();
 const name='Import '+width;await page.getByLabel('Navn',{exact:true}).fill(name);await button(box(page,'Ny sangbok'),'Lagre').click();await expect(step.getByRole('button',{name:'Sangbok: '+name,exact:true})).toBeVisible();await expect(page.locator('#songbook-filter')).toHaveText('Standard');await button(step,'Fortsett').click();
 const text='\uFEFF{t: Første import}\r\n[C]Ord\r\n';await selectFile(page,'første.txt',text);
 await expect(page.locator('#library')).toBeVisible();await expect(page.locator('#reader')).toBeHidden();await expect(page.locator('#songbook-filter')).toHaveText(name);await expect(page.locator('#song-list .song-choice')).toHaveCount(1);await expect(page.locator('#song-list')).toContainText('Første import');
 expect((await journal(page)).sessions).toEqual({});await expect.poll(()=>Object.keys(manifest(mock).songs).length).toBe(1);expect(mock.find(`/Songbooks/${name}/Private/første.cho`).text).toBe(text);expect(mock.find(`/Songbooks/${name}/Originals/første.txt`).text).toBe(text);
 await page.locator('#add-song').click();await page.getByRole('menuitem',{name:'Importer',exact:true}).click();await expect(step.getByRole('button',{name:'Sangbok: '+name,exact:true})).toBeVisible();await button(step,'Fortsett').click();await selectFile(page,'andre.txt','{t: Andre import}\nOrd');
 await expect(page.locator('#library')).toBeVisible();await expect(page.locator('#reader')).toBeHidden();await expect(page.locator('#song-list .song-choice')).toHaveCount(2);expect((await journal(page)).sessions).toEqual({});await expect.poll(()=>Object.keys(manifest(mock).songs).length).toBe(2);await expect(page.locator('#dropbox-sync')).toBeEnabled();
 const songs=await savedSongs(page);expect(new Set(songs.map(song=>song.songbookId)).size).toBe(1);await page.reload();await expect(page.locator('#songbook-filter')).toHaveText(name);await expect(page.locator('#song-list .song-choice')).toHaveCount(2);
 const visual=await page.evaluate(()=>{const read=id=>{const e=document.getElementById(id),s=getComputedStyle(e),r=e.getBoundingClientRect();return{id,x:r.x,y:r.y,width:r.width,height:r.height,font:s.fontSize,color:s.color,background:s.backgroundColor,outline:s.outlineStyle};};return{viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,header:read('page-title'),filter:read('songbook-filter'),add:read('add-song'),rows:[...document.querySelectorAll('#song-list .song-choice')].map(e=>({height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize}))};});
 expect(visual.overflow).toBe(false);expect(visual.filter.height).toBeGreaterThanOrEqual(44);expect(visual.add.height).toBeGreaterThanOrEqual(44);expect(visual.rows.every(row=>row.height>=44)).toBe(true);await appendFile('work/import-flow/visual.jsonl',JSON.stringify(visual)+'\n');await page.screenshot({path:`work/import-flow/list-${width}.png`,fullPage:true});
 await page.locator(`[data-song-id="${songs[0].id}"]`).click();await expect(page.locator('#reader')).toBeVisible();expect(Object.values((await journal(page)).sessions).some(session=>session.songId===songs[0].id)).toBe(true);
});

test('offline import errors and cancellation keep the filter; retry returns to the target list exactly once',async({page,context})=>{
 await dropboxMock(context,{connected:false});await page.goto(url);await expect(page.locator('#add-song')).toBeEnabled();await openMenu(page);await button(page,'Sangbøker').click();await page.locator('#add-songbook').click();await page.getByLabel('Navn',{exact:true}).fill('Band');await button(box(page,'Ny sangbok'),'Lagre').click();await openMenu(page);await button(page,'Sanger').click();await page.locator('#songbook-filter').click();await page.getByRole('option',{name:'Standard',exact:true}).click();await context.setOffline(true);
 await beginImport(page,'Band');await selectFile(page,'feil.txt',Buffer.from([0xff,0xfe]));await expect(page.locator('#library-status')).toBeVisible();await expect(page.locator('#library-status')).toContainText('UTF-8');await expect(page.locator('#songbook-filter')).toHaveText('Standard');expect(await savedSongs(page)).toEqual([]);
 await beginImport(page,'Band');await page.locator('#song-file').setInputFiles([]);await expect(page.locator('#songbook-filter')).toHaveText('Standard');
 await page.evaluate(()=>{const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){const r=add.apply(this,args);if(this.name==='songs')this.transaction.abort();return r;};window.restoreImport=()=>IDBObjectStore.prototype.add=add;});
 await beginImport(page,'Band');await selectFile(page,'gyldig.txt','{t: Lagret etter feil}\nOrd');await expect(page.locator('#library-status')).toBeVisible();await expect(page.locator('#library-status')).toHaveAttribute('data-error','true');await expect(page.locator('#songbook-filter')).toHaveText('Standard');expect(await savedSongs(page)).toEqual([]);await page.evaluate(()=>window.restoreImport());
 await beginImport(page,'Band');await selectFile(page,'gyldig.txt','{t: Lagret etter feil}\nOrd');await expect(page.locator('#library')).toBeVisible();await expect(page.locator('#reader')).toBeHidden();await expect(page.locator('#songbook-filter')).toHaveText('Band');await expect(page.locator('#song-list .song-choice')).toHaveCount(1);expect((await journal(page)).sessions).toEqual({});expect(await savedSongs(page)).toHaveLength(1);
 await context.setOffline(false);await page.reload();await expect(page.locator('#songbook-filter')).toHaveText('Band');await expect(page.locator('#song-list .song-choice')).toHaveCount(1);
});
