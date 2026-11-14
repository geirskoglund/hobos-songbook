import {test, expect} from '@playwright/test';
import {openMenu, goSongs, openSettings, closeSettings, beginImport, savedSongs, tool, fillValue} from './song-helpers.mjs';
const url = '/hobos-songbook/test/';
const song = id => ({id, songbookId:'standard', title:`Sang ${id}`, key:'D', original:`\uFEFF{t: Sang ${id}}\r\n{key: D}\r\n[D]Ord\r\n`, origin:{kind:'external',filename:`${id}.cho`,importedAt:'2026-01-01',provider:'future',sourceId:'source',fileId:id,relativePath:`mappe/${id}.cho`}});
const personal = id => ({songId:id,version:3,chorus:{'line:5':true},capo:3,tuning:'DADGAD',chordGrid:'| D |',notes:{one:{line:0,text:'Behold'}},annotations:{'source/line:2':{anchor:{songId:id,sourceLine:2,occurrence:'source/line:2'},highlights:[{start:0,end:3}]}}});
const dialog = (page, name) => page.getByRole('dialog',{name,exact:true});
const button = (scope, name) => scope.getByRole('button',{name,exact:true});
async function snapshot(page) {
  return page.evaluate(() => new Promise((resolve,reject) => {
    const request=indexedDB.open('hobos-songbook-test'); request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result, tx=db.transaction([...db.objectStoreNames]), result={version:db.version};
      for(const name of db.objectStoreNames){const read=tx.objectStore(name).getAll();read.onsuccess=()=>result[name]=read.result;}
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>reject(tx.error);
    };
  }));
}
async function seed(page, withSongs=true) {
  await page.goto(url); await expect(page.locator('#add-song')).toBeEnabled();
  await page.evaluate(({songs,people})=>new Promise(resolve=>{
    const request=indexedDB.open('hobos-songbook-test');request.onsuccess=()=>{
      const db=request.result,tx=db.transaction(['songs','personal','songbooks','setlists'],'readwrite');
      for(const book of [{id:'band',name:'Band'},{id:'empty',name:'Tom bok'}])tx.objectStore('songbooks').put(book);
      for(const item of songs)tx.objectStore('songs').put(item);
      for(const item of people)tx.objectStore('personal').put(item);
      tx.objectStore('setlists').put({id:'refs',name:'Behold referanser',createdAt:1,songIds:songs.map(s=>s.id),future:{keep:true}});
      tx.oncomplete=()=>{db.close();resolve();};
    };
  }),{songs:withSongs?[song('a'),song('b')]:[],people:withSongs?[personal('a'),personal('b')]:[]});
  await page.reload();await expect(page.locator('#add-song')).toBeEnabled();
}
async function goBooks(page) {await openMenu(page);await button(page,'Sangbøker').click();await expect(page.locator('#add-songbook')).toBeEnabled();}
async function rowMenu(page, id, action) {await page.locator(`#songbook-menu-${id}`).click();await page.getByRole('menuitem',{name:action,exact:true}).click();}
async function createBook(page, name) {
  await page.locator('#add-songbook').click();await page.getByLabel('Navn',{exact:true}).fill(name);await button(dialog(page,'Ny sangbok'),'Lagre').click();await expect(dialog(page,'Ny sangbok')).toHaveCount(0);
  return (await snapshot(page)).songbooks.find(book=>book.name===name.trim());
}
async function choose(page, name, scope=page) {await scope.getByRole('button',{name:/^Sangbok:/}).click();await page.getByRole('option',{name,exact:true}).click();}
async function newStep(page, kind='Opprett') {
  await page.locator('#add-song').click();await page.getByRole('menuitem',{name:kind,exact:true}).click();const step=dialog(page,`${kind} i sangbok`);await expect(step).toBeVisible();return step;
}
async function injectAbort(page, storeName, method, nth=1) {
  await page.evaluate(({storeName,method,nth})=>{
    const original=IDBObjectStore.prototype[method];let writes=0;
    IDBObjectStore.prototype[method]=function(...args){const request=original.apply(this,args);if(this.name===storeName&&++writes===nth)this.transaction.abort();return request;};
    window.restoreBookStorage=()=>{IDBObjectStore.prototype[method]=original;};
  },{storeName,method,nth});
}
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('menu, L02 administration, validation, rename identity, D09 icons and safe focus follow the shared controls',async({page})=>{
  await seed(page);const before=await snapshot(page);await openMenu(page);
  await expect(page.locator('#main-menu > button')).toHaveText(['Sanger','Setlister','Synkronisering','Sangbøker','Filer','Innstillinger']);
  expect(await page.locator('[data-destination=songbooks] .icon path').first().getAttribute('d')).toContain('M12 6.5');
  await button(page,'Sangbøker').click();await expect(page.locator('#songbook-list .count-choice')).toHaveText(['Band0 sanger','Standard2 sanger','Tom bok0 sanger']);
  await rowMenu(page,'standard','Endre navn');const field=page.getByLabel('Navn',{exact:true}), save=button(dialog(page,'Endre navn på sangbok'),'Lagre');
  for(const name of ['   ','Band','bAnD','CON.txt','Navn.','A/B']){await field.fill(name);await expect(save).toBeDisabled();await expect(field).toHaveAttribute('aria-invalid','true');await expect(page.locator('#songbook-name-error')).not.toBeEmpty();}
  await field.fill('  sTANDARD  ');await expect(save).toBeEnabled();await save.click();await expect(page.locator('#songbook-menu-standard')).toBeFocused();
  const renamed=await snapshot(page);expect(renamed).toEqual({...before,songbooks:before.songbooks.map(b=>b.id==='standard'?{...b,name:'sTANDARD'}:b)});
  const created=await createBook(page,'  Ærlig (2026) + #1!  ');expect(created.id).not.toBe('standard');
  await page.locator('#songbook-standard').click();await expect(page.locator('#library')).toBeVisible();await expect(page.locator('#songbook-filter')).toHaveText('sTANDARD');
  await page.locator('#songbook-filter').click();await expect(dialog(page,'Sangbok').locator('h2 .icon')).toHaveCount(1);await expect(page.getByRole('option')).toHaveText(['Alle','Band','sTANDARD','Tom bok','Ærlig (2026) + #1!']);await expect(button(dialog(page,'Sangbok'),'Ny sangbok')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(page.locator('#songbook-filter')).toBeFocused();await page.reload();await expect(page.locator('#songbook-filter')).toHaveText('sTANDARD');
});

test('deletion transfers only membership, keeps references and personal data, and deleted active filter becomes Alle',async({page})=>{
  await seed(page);await page.locator('#songbook-filter').click();await page.getByRole('option',{name:'Standard',exact:true}).click();const before=await snapshot(page);await goBooks(page);
  await rowMenu(page,'standard','Slett');const box=dialog(page,'Slett sangbok');await expect(button(box,'Avbryt')).toBeFocused();await expect(box).toContainText('2 sanger');await expect(button(box,'Slett')).toBeDisabled();
  await box.getByRole('button',{name:/^Sangbok:/}).click();await expect(page.getByRole('option')).toHaveText(['Band','Tom bok']);await page.getByRole('option',{name:'Band',exact:true}).click();await page.keyboard.press('Escape');expect(await snapshot(page)).toEqual(before);
  await rowMenu(page,'standard','Slett');await choose(page,'Band',box);await button(box,'Slett').click();await expect(box).toHaveCount(0);
  const after=await snapshot(page);expect(after).toEqual({...before,songbooks:before.songbooks.filter(b=>b.id!=='standard'),songs:before.songs.map(s=>({...s,songbookId:'band'}))});
  await page.reload();await expect(page.locator('#songbook-filter')).toHaveText('Alle');expect((await snapshot(page)).songbooks.some(b=>b.id==='standard')).toBe(false);
  await goBooks(page);await rowMenu(page,'empty','Slett');await expect(dialog(page,'Slett sangbok').getByRole('button',{name:/^Sangbok:/})).toBeHidden();await button(dialog(page,'Slett sangbok'),'Slett').click();await expect(dialog(page,'Slett sangbok')).toHaveCount(0);
  await rowMenu(page,'band','Slett');await expect(dialog(page,'Slett sangbok')).toContainText('siste sangboken');await expect(button(dialog(page,'Slett sangbok'),'Slett')).toBeDisabled();await page.keyboard.press('Escape');
});

for(const [store,method,nth] of [['songs','put',2],['songbooks','delete',1]])test(`abort at ${store}.${method} rolls the entire transfer back and a single retry succeeds`,async({page})=>{
  await seed(page);const before=await snapshot(page);await goBooks(page);await rowMenu(page,'standard','Slett');const box=dialog(page,'Slett sangbok');await choose(page,'Band',box);
  await injectAbort(page,store,method,nth);await button(box,'Slett').click();await expect(box.getByRole('alert')).toContainText('Ingen sanger er flyttet');expect(await snapshot(page)).toEqual(before);
  await page.evaluate(()=>window.restoreBookStorage());await button(box,'Slett').dblclick();await expect(box).toHaveCount(0);const after=await snapshot(page);expect(after.songs).toEqual(before.songs.map(s=>({...s,songbookId:'band'})));expect(after.personal).toEqual(before.personal);expect(after.setlists).toEqual(before.setlists);
});

test('aborted create and rename retain the name draft and old database until successful retry',async({page})=>{
  await seed(page);await goBooks(page);const before=await snapshot(page);await page.locator('#add-songbook').click();await page.getByLabel('Navn',{exact:true}).fill('Ny bok');await injectAbort(page,'songbooks','add');await button(dialog(page,'Ny sangbok'),'Lagre').click();await expect(page.locator('#songbook-name-error')).not.toBeEmpty();await expect(page.getByLabel('Navn',{exact:true})).toHaveValue('Ny bok');expect(await snapshot(page)).toEqual(before);
  await page.evaluate(()=>window.restoreBookStorage());await button(dialog(page,'Ny sangbok'),'Lagre').click();await expect(dialog(page,'Ny sangbok')).toHaveCount(0);
  const baseline=await snapshot(page);await rowMenu(page,'standard','Endre navn');await page.getByLabel('Navn',{exact:true}).fill('Omdøpt');await injectAbort(page,'songbooks','put');await button(dialog(page,'Endre navn på sangbok'),'Lagre').click();await expect(page.locator('#songbook-name-error')).not.toBeEmpty();expect(await snapshot(page)).toEqual(baseline);await page.evaluate(()=>window.restoreBookStorage());await button(dialog(page,'Endre navn på sangbok'),'Lagre').click();await expect(dialog(page,'Endre navn på sangbok')).toHaveCount(0);
});

test('parallel name saves reject a case duplicate in the transaction and a stale deletion cannot remove the last book',async({page,context})=>{
  await page.goto(url);await goBooks(page);const other=await context.newPage();await other.goto(url);await goBooks(other);
  for(const [tab,name] of [[page,'Lik'],[other,'lIK']]){await tab.locator('#add-songbook').click();await tab.getByLabel('Navn',{exact:true}).fill(name);}
  await Promise.all([button(dialog(page,'Ny sangbok'),'Lagre').click(),button(dialog(other,'Ny sangbok'),'Lagre').click()]);
  await expect.poll(async()=>(await snapshot(page)).songbooks.length).toBe(2);const failed=await dialog(page,'Ny sangbok').count()?page:other;await expect(failed.locator('#songbook-name-error')).toContainText('allerede');await page.keyboard.press('Escape');await other.keyboard.press('Escape');
  await goSongs(page);await goBooks(page);await goSongs(other);await goBooks(other);const second=(await snapshot(page)).songbooks.find(b=>b.id!=='standard');
  await rowMenu(page,'standard','Slett');await rowMenu(other,second.id,'Slett');await button(dialog(other,'Slett sangbok'),'Slett').click();await expect(dialog(other,'Slett sangbok')).toHaveCount(0);
  await button(dialog(page,'Slett sangbok'),'Slett').click();await expect(dialog(page,'Slett sangbok').getByRole('alert')).toContainText('siste sangboken');expect((await snapshot(page)).songbooks).toEqual([{id:'standard',name:'Standard'}]);await other.close();
});

test('choice priority follows successful session use, then filter; cancellation and reload do not invent a last-used book',async({page})=>{
  await seed(page,false);let step=await newStep(page);await expect(button(step,'Fortsett')).toBeDisabled();await choose(page,'Band',step);await button(step,'Fortsett').click();await expect(dialog(page,'Råtekst')).toBeVisible();await button(dialog(page,'Råtekst'),'Avbryt').click();expect(await savedSongs(page)).toEqual([]);
  await page.locator('#songbook-filter').click();await page.getByRole('option',{name:'Tom bok',exact:true}).click();step=await newStep(page);await expect(step.getByRole('button',{name:'Sangbok: Tom bok',exact:true})).toBeVisible();await button(step,'Avbryt').click();
  await beginImport(page,'Band');await page.locator('#song-file').setInputFiles({name:'ny.txt',mimeType:'text/plain',buffer:Buffer.from('{t: Ny}\nOrd')});await expect(page.locator('#song-title')).toHaveText('Ny');expect((await savedSongs(page))[0].songbookId).toBe('band');await goSongs(page);await expect(page.locator('#songbook-filter')).toHaveText('Tom bok');
  step=await newStep(page);await expect(step.getByRole('button',{name:'Sangbok: Band',exact:true})).toBeVisible();await choose(page,'Standard',step);await button(step,'Fortsett').click();await page.locator('#original-text').fill('{t: Lagret}\nOrd');await button(dialog(page,'Råtekst'),'Lagre').click();await expect(dialog(page,'Råtekst')).toHaveCount(0);await goSongs(page);
  step=await newStep(page,'Importer');await expect(step.getByRole('button',{name:'Sangbok: Standard',exact:true})).toBeVisible();await button(step,'Avbryt').click();await page.reload();step=await newStep(page);await expect(step.getByRole('button',{name:'Sangbok: Tom bok',exact:true})).toBeVisible();
});

for(const flow of ['Opprett','Importer','Slett'])test(`a book saved from D10 in ${flow} survives cancelling the parent; cancelling its name keeps the old choice`,async({page})=>{
  await seed(page);const before=await snapshot(page);let parent;
  if(flow==='Slett'){await goBooks(page);await rowMenu(page,'standard','Slett');parent=dialog(page,'Slett sangbok');await choose(page,'Band',parent);}
  else {parent=await newStep(page,flow);await choose(page,'Band',parent);}
  await parent.getByRole('button',{name:/^Sangbok:/}).click();await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(parent.locator('h2 .icon')).toHaveCount(1);await button(parent,'Ny sangbok').click();await page.getByLabel('Navn',{exact:true}).fill('Ikke lagret');await page.keyboard.press('Escape');await expect(parent.getByRole('button',{name:'Sangbok: Band',exact:true})).toBeFocused();
  await parent.getByRole('button',{name:/^Sangbok:/}).click();await button(parent,'Ny sangbok').click();await page.getByLabel('Navn',{exact:true}).fill('Selvstendig');await button(dialog(page,'Ny sangbok'),'Lagre').click();await expect(parent.getByRole('button',{name:'Sangbok: Selvstendig',exact:true})).toBeVisible();await button(parent,'Avbryt').click();
  const after=await snapshot(page);expect(after.songbooks).toHaveLength(4);expect(after.songbooks.some(b=>b.name==='Ikke lagret')).toBe(false);expect(after.songs).toEqual(before.songs);expect(after.personal).toEqual(before.personal);expect(after.setlists).toEqual(before.setlists);
});

test('a vanished target preserves raw draft, allows reselection and saves exactly once; stale editors keep a transferred membership',async({page,context})=>{
  await seed(page,false);const step=await newStep(page);await choose(page,'Standard',step);await button(step,'Fortsett').click();await page.locator('#original-text').fill('{t: Behold utkast}\nOrd');
  const other=await context.newPage();await other.goto(url);await goBooks(other);await rowMenu(other,'standard','Slett');await button(dialog(other,'Slett sangbok'),'Slett').click();await expect(dialog(other,'Slett sangbok')).toHaveCount(0);
  await button(dialog(page,'Råtekst'),'Lagre').click();const recovery=dialog(page,'Velg sangbok');await expect(recovery).toBeVisible();await expect(page.locator('#original-text')).toHaveValue('{t: Behold utkast}\nOrd');await expect(button(recovery,'Fortsett')).toBeDisabled();await choose(page,'Band',recovery);await button(recovery,'Fortsett').click();await expect(dialog(page,'Råtekst')).toHaveCount(0);const created=(await savedSongs(page))[0];expect(created.songbookId).toBe('band');
  await goSongs(other);await goBooks(other);await rowMenu(other,'band','Slett');await choose(other,'Tom bok',dialog(other,'Slett sangbok'));await button(dialog(other,'Slett sangbok'),'Slett').click();await expect(dialog(other,'Slett sangbok')).toHaveCount(0);
  await tool(page,'Tittel');await fillValue(page,'Tittel','Ny tittel');await expect.poll(async()=>(await savedSongs(page))[0].title).toBe('Ny tittel');expect((await savedSongs(page))[0]).toEqual({...created,title:'Ny tittel',original:created.original.replace('Behold utkast','Ny tittel'),songbookId:'empty'});await other.close();
});

test('stale empty-book deletion rereads songs and requires a target; filter persistence failure truthfully reports a completed deletion',async({page,context})=>{
  await seed(page,false);await page.locator('#songbook-filter').click();await page.getByRole('option',{name:'Band',exact:true}).click();await goBooks(page);await rowMenu(page,'band','Slett');const box=dialog(page,'Slett sangbok');
  const other=await context.newPage();await other.goto(url);await beginImport(other,'Band');await other.locator('#song-file').setInputFiles({name:'ny.txt',mimeType:'text/plain',buffer:Buffer.from('{t: Tilkommet}')});await expect(other.locator('#song-title')).toHaveText('Tilkommet');
  await button(box,'Slett').click();await expect(box.getByRole('alert')).toContainText('Velg en annen sangbok');await expect(button(box,'Slett')).toBeDisabled();expect((await savedSongs(page))[0].songbookId).toBe('band');
  await choose(page,'Standard',box);await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('QuotaExceeded');};});await button(box,'Slett').click();await expect(box).toHaveCount(0);await expect(page.locator('#filter-status')).toContainText('kunne ikke lagres');await goSongs(page);await expect(page.locator('#songbook-filter')).toHaveText('Alle');expect((await savedSongs(page))[0].songbookId).toBe('standard');await other.close();
});

for(const width of [320,768,1440])test(`shared list and D10 fit ${width}px with long names, keyboard and offline CRUD`,async({page,context})=>{
  await page.setViewportSize({width,height:700});await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await context.setOffline(true);await goBooks(page);
  const name='Langt navn æøå '.repeat(9).trim();const book=await createBook(page,name);await expect(page.locator(`#songbook-${book.id}`)).toBeInViewport();expect(await page.locator('#songbooks').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
  await page.locator(`#songbook-${book.id}`).click();const step=await newStep(page);await step.getByRole('button',{name:/^Sangbok:/}).click();await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(step).toBeVisible();await expect(button(step,'Fortsett')).toBeEnabled();
  await step.getByRole('button',{name:/^Sangbok:/}).click();const picker=step;expect(await picker.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);await button(picker,'Ny sangbok').click();await page.getByLabel('Navn',{exact:true}).fill('Offline');await page.setViewportSize({width,height:420});await expect(button(dialog(page,'Ny sangbok'),'Lagre')).toBeInViewport();await button(dialog(page,'Ny sangbok'),'Lagre').click();await expect(step.getByRole('button',{name:'Sangbok: Offline',exact:true})).toBeVisible();await button(step,'Avbryt').click();await page.reload();await goBooks(page);expect((await snapshot(page)).songbooks).toHaveLength(3);
  const production=await context.newPage();await context.setOffline(false);await production.goto('/hobos-songbook/app/');await goBooks(production);await expect(production.locator('#songbook-list .count-choice')).toHaveText(['Standard0 sanger']);await production.close();
});

test('worker update restores book-list position, menu and Settings return and protects an unsaved name',async({page,request})=>{
  await page.setViewportSize({width:390,height:600});await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await goBooks(page);
  for(let i=0;i<9;i++)await createBook(page,`Bok ${i}`);
  await page.locator('#songbook-list .count-choice').nth(7).scrollIntoViewIfNeeded();const position=await page.evaluate(()=>scrollY);await openSettings(page);
  await request.post('/__test__/update?channel=test');await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});await button(page,'Oppdater appen').click();await expect(page.locator('.build')).toContainText('ccccccc');await expect(page.locator('#settings')).toBeVisible();await closeSettings(page);await expect(page.locator('#songbooks')).toBeVisible();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(position);
  await page.locator('#add-songbook').click();await page.getByLabel('Navn',{exact:true}).fill('Ulagret');await request.post('/__test__/reset');await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});await expect(page.locator('#apply-update')).toBeVisible();await page.locator('#apply-update').evaluate(b=>b.click());await expect(page.locator('#update-notice-text')).toContainText('ulagret sangboknavn');await expect(page.getByLabel('Navn',{exact:true})).toHaveValue('Ulagret');await page.keyboard.press('Escape');await openMenu(page);const menuScroll=await page.locator('#main-menu').evaluate(n=>n.scrollTop);await button(page,'Oppdater nå').click();await expect(page.locator('.build')).toContainText('bbbbbbb');await expect(page.locator('#songbooks')).toBeVisible();await expect(page.locator('#main-menu')).toBeVisible();expect(await page.locator('#main-menu').evaluate(n=>n.scrollTop)).toBe(menuScroll);
});

test('failed and cancelled imports keep the suggestion; filename-copy confirmation spans books and missing import targets can be reselected',async({page,context})=>{
  await seed(page,false);await page.locator('#songbook-filter').click();await page.getByRole('option',{name:'Standard',exact:true}).click();
  await beginImport(page,'Band');await page.locator('#song-file').setInputFiles({name:'feil.txt',mimeType:'text/plain',buffer:Buffer.from([0xff,0xfe])});await expect(page.locator('#song-status')).toContainText('UTF-8');expect(await savedSongs(page)).toEqual([]);
  let step=await newStep(page);await expect(step.getByRole('button',{name:'Sangbok: Standard',exact:true})).toBeVisible();await button(step,'Avbryt').click();
  await beginImport(page,'Band');await page.locator('#song-file').setInputFiles([]);step=await newStep(page);await expect(step.getByRole('button',{name:'Sangbok: Standard',exact:true})).toBeVisible();await button(step,'Avbryt').click();
  await beginImport(page,'Band');await page.locator('#song-file').setInputFiles({name:'samme.cho',mimeType:'',buffer:Buffer.from('{t: Første}\nOrd')});await expect(page.locator('#song-title')).toHaveText('Første');const first=(await savedSongs(page))[0];
  for(const accepted of [false,true]){
    await beginImport(page,'Tom bok');await page.locator('#song-file').setInputFiles({name:'samme.cho',mimeType:'',buffer:Buffer.from('{t: Kopi}\nNy tekst')});const copy=dialog(page,'Importer kopi');await expect(copy).toBeVisible();await button(copy,accepted?'Importer':'Avbryt').click();await expect(copy).toHaveCount(0);if(!accepted)expect(await savedSongs(page)).toEqual([first]);
  }
  await expect(page.locator('#song-title')).toHaveText('Kopi');const copies=await savedSongs(page);expect(copies).toHaveLength(2);expect(copies.find(s=>s.id===first.id)).toEqual(first);expect(copies.find(s=>s.id!==first.id).songbookId).toBe('empty');
  await beginImport(page,'Standard');const other=await context.newPage();await other.goto(url);await goBooks(other);await rowMenu(other,'standard','Slett');await button(dialog(other,'Slett sangbok'),'Slett').click();await expect(dialog(other,'Slett sangbok')).toHaveCount(0);
  await page.locator('#song-file').setInputFiles({name:'venter.txt',mimeType:'',buffer:Buffer.from('{t: Behold import}\nOrd')});const recovery=dialog(page,'Velg sangbok');await expect(recovery).toBeVisible();await choose(page,'Band',recovery);await button(recovery,'Fortsett').click();await expect(page.locator('#song-title')).toHaveText('Behold import');const after=await savedSongs(page);expect(after).toHaveLength(3);expect(after.find(s=>s.title==='Behold import').songbookId).toBe('band');await other.close();
});

for (const width of [320, 768, 1440]) test(`D10 uses one popup, heading and value when choosing a book at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height:800}); await seed(page);
  for (const flow of ['Opprett', 'Importer', 'Slett']) {
    let box;
    if (flow === 'Slett') {await goBooks(page); await rowMenu(page, 'standard', 'Slett'); box = dialog(page, 'Slett sangbok');}
    else {await goSongs(page); box = await newStep(page, flow);}
    const title = flow === 'Slett' ? 'Slett sangbok' : `${flow} i sangbok`;
    await expect(box.getByRole('heading')).toHaveText([title]);
    await expect(box.locator('h2 .icon')).toHaveCount(1);
    await expect(box.locator('.choice-value')).toHaveCount(1);
    await box.getByRole('button', {name:/^Sangbok:/}).click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(box.getByRole('heading')).toHaveText([title]);
    await expect(box.locator('.choice-value')).toHaveCount(1);
    await expect(box.getByRole('listbox', {name:'Sangbok', exact:true})).toBeVisible();
    await expect(button(box, 'Ny sangbok')).toBeVisible();
    const bounds = await box.boundingBox(), choices = await box.locator('.choice-options').boundingBox(), footer = await box.locator('.dialog-footer').boundingBox();
    expect(choices.x).toBeGreaterThanOrEqual(bounds.x); expect(choices.x + choices.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(choices.y + choices.height).toBeLessThanOrEqual(footer.y);
    expect(await box.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (width === 320) {
      await page.setViewportSize({width, height:420});
      const first = box.getByRole('option').first(); await first.scrollIntoViewIfNeeded();
      await expect(first).toBeInViewport();
      expect(await box.getByRole('listbox').evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(44);
      await expect(button(box, 'Avbryt')).toBeInViewport();
      await button(box, 'Ny sangbok').scrollIntoViewIfNeeded(); await expect(button(box, 'Ny sangbok')).toBeInViewport();
      await page.setViewportSize({width, height:800});
    }
    await page.getByRole('option', {name:'Band', exact:true}).click();
    await expect(box.getByRole('button', {name:'Sangbok: Band', exact:true})).toBeFocused();
    await expect(box.getByRole('listbox')).toBeHidden();
    await button(box, 'Avbryt').click();
  }
});

test('D10 expands and collapses with the keyboard, while a second Escape cancels the flow', async ({page}) => {
  await seed(page, false); const box = await newStep(page), value = box.getByRole('button', {name:'Sangbok: Velg sangbok', exact:true});
  await expect(button(box, 'Fortsett')).toBeDisabled();
  await value.press('ArrowDown'); await expect(page.getByRole('option', {name:'Band', exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const chosen = box.getByRole('button', {name:'Sangbok: Standard', exact:true});
  await expect(chosen).toBeFocused(); await expect(button(box, 'Fortsett')).toBeEnabled();
  await chosen.press('Space'); await expect(box.getByRole('listbox')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(chosen).toBeFocused(); await expect(chosen).toHaveAttribute('aria-expanded', 'false'); await expect(box).toBeVisible();
  await page.keyboard.press('Escape'); await expect(box).toHaveCount(0); await expect(page.locator('#add-song')).toBeFocused(); expect(await savedSongs(page)).toEqual([]);
});
