import {test, expect} from '@playwright/test';
import {importSong, savedSongs, openMenu} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const original='\uFEFF{t: Personlig}\r\n{key: D}\r\n{sog: shape="2x4" label="Intro"}\r\n| D . D/F# . | Bm7 . A . |\r\n{eog}\r\n[D]Ærlig [D/F#]øvelse å [Bm7]synge\r\n{soc}\r\n[D]Samme tekst\r\n{eoc}\r\n{chorus}\r\n{chorus}\r\n'+('Lang leselinje\r\n').repeat(60);
const edit=async page=>{await openMenu(page);await page.getByRole('button',{name:'Rediger',exact:true}).click();await expect(page.locator('.edit-toolbar')).toBeVisible();};
const save=async page=>{await page.locator('#edit-save').click();await expect(page.locator('#edit-save')).toBeDisabled();};
const exit=async page=>{await page.locator('#back').click();await expect(page.locator('.edit-toolbar')).toHaveCount(0);await expect(page.locator('#reader:not([hidden]),#library:not([hidden])')).toBeVisible();};
const personal=page=>page.evaluate(()=>new Promise((resolve,reject)=>{
 const request=indexedDB.open('hobos-songbook-test',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('personal'),get=tx.objectStore('personal').getAll();tx.oncomplete=()=>{db.close();resolve(get.result);};};
}));
async function capo(page,value) {await page.locator('#capo-pill').click();await page.locator('#personal-capo').fill(String(value));await page.getByRole('button',{name:'OK',exact:true}).click();}
async function select(page,occurrence,start,end) {
 await page.locator(`.song-line[data-occurrence="${occurrence}"]`).evaluate((line,{start,end})=>{
   const lyrics=[...line.querySelectorAll('.lyric')];
   function point(offset){for(const lyric of lyrics){const from=Number(lyric.dataset.offset),len=Number(lyric.dataset.length);if(len && offset>=from && offset<=from+len){const walker=document.createTreeWalker(lyric,NodeFilter.SHOW_TEXT);let node;let at=offset-from;while(node=walker.nextNode()){if(at<=node.length)return [node,at];at-=node.length;}}}throw Error('missing lyric offset');}
   const range=document.createRange();range.setStart(...point(start));range.setEnd(...point(end));getSelection().removeAllRanges();getSelection().addRange(range);
   line.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
 },{start,end});
 await expect(page.locator('.selection-tools')).toHaveCount(0);
}
const source='source/line:5';
test.beforeEach(async({request,page})=>{page.on('pageerror',e=>console.log('PAGEERROR',e.message));await request.post('/__test__/reset');});

test('song stays in view; capo zero is edit-only; save keeps editing and preserves original',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);const before=await savedSongs(page);
 await expect(page.locator('.edit-toolbar,.annotate-line')).toHaveCount(0);await expect(page.locator('.song-metadata')).not.toContainText('Capo');
 await edit(page);await expect(page.locator('#capo-pill')).toHaveText('Uten capo');await expect(page.locator('#song-title')).toBeInViewport();await expect(page.locator('#chart-dock')).toHaveAttribute('data-sticky','false');await page.evaluate(()=>scrollTo(0,700));await expect(page.locator('#chart-dock')).not.toBeInViewport();await expect(page.locator('.edit-toolbar')).toBeInViewport();await page.evaluate(()=>scrollTo(0,0));
 await capo(page,2);await expect(page.locator('.song-line .chord').first()).toHaveText('C');
 expect((await personal(page))[0]?.capo).toBeUndefined();await save(page);await expect(page.locator('.edit-toolbar')).toBeVisible();
 await exit(page);await expect(page.locator('.song-metadata')).toContainText('Capo 2: C');expect(await savedSongs(page)).toEqual(before);
 await edit(page);await capo(page,0);await save(page);await exit(page);await expect(page.locator('.song-metadata')).not.toContainText('Capo');
});

test('one full-width song row and menu dismiss with outside, Escape and edit; library return',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await page.locator('#back').click();
 const row=page.locator('.song-list > li'),menu=page.locator('.song-actions');
 const bounds=await row.boundingBox(), summary=await menu.locator('summary').boundingBox();expect(summary.x+summary.width).toBeLessThanOrEqual(bounds.x+bounds.width);
 await menu.locator('summary').click();await page.locator('#library-title').click();await expect(menu).not.toHaveAttribute('open');
 await menu.locator('summary').click();await page.keyboard.press('Escape');await expect(menu).not.toHaveAttribute('open');
 await menu.locator('summary').click();await menu.getByRole('button',{name:'Rediger'}).click();await expect(menu).not.toHaveAttribute('open');await expect(page.locator('.edit-toolbar')).toBeVisible();await exit(page);await expect(page.locator('#library')).toBeVisible();
});

test('unsaved exit supports cancel, discard and save; save failure retains draft',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);await capo(page,2);
 await page.locator('#back').click();await page.getByRole('button',{name:'Fortsett redigering'}).click();await expect(page.locator('#capo-pill')).toContainText('2');
 await page.locator('#back').click();await page.getByRole('button',{name:'Forkast endringer'}).click();await expect(page.locator('.song-metadata')).not.toContainText('Capo');
 await edit(page);await capo(page,7);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restorePut=()=>IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.put=function(...args){if(this.name==='personal')throw Error('no space');return put.apply(this,args);};});
 await page.locator('#edit-save').click();await expect(page.locator('#song-status')).toContainText('Kunne ikke lagre');await expect(page.locator('#edit-save')).toBeEnabled();
 await page.evaluate(()=>window.restorePut());await page.locator('#back').click();await page.getByRole('button',{name:'Lagre og gå ut'}).click();await expect(page.locator('.edit-toolbar')).toHaveCount(0);expect((await personal(page))[0].capo).toBe(7);
});

test('grid hides tags, preserves shape and labels, converts input capo exactly once and falls back',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);await capo(page,2);
 await page.locator('.edit-chart').click();await page.keyboard.press('Escape');await expect(page.locator('#edit-save')).toBeEnabled();expect((await personal(page))[0]?.chordGrid).toBeUndefined();
 await page.locator('.edit-chart').click();await expect(page.locator('#personal-grid')).not.toHaveValue(/\{sog/);await expect(page.locator('#personal-grid')).toHaveValue(/C\/E/);
 await page.locator('#personal-grid').fill('| C . C/E . | Am7 . G . |');await page.getByRole('button',{name:'OK',exact:true}).click();
 await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','personal');await expect(page.locator('#chart-dock')).toContainText('C/E');await save(page);
 const state=(await personal(page))[0];expect(state.chordGrid).toContain('D/F#');expect(state.chordGrid).toContain('shape="2x4" label="Intro"');
 await page.locator('.edit-chart').click();await expect(page.getByRole('dialog',{name:'Akkordskjema, capo 2',exact:true})).toBeVisible();await expect(page.getByRole('radio')).toHaveCount(0);await expect(page.getByRole('button',{name:'Vis råtekst'})).toHaveCount(0);await page.keyboard.press('Escape');
 await capo(page,0);await expect(page.locator('#chart-dock')).toContainText('D/F#');
 await page.locator('.edit-chart').click();await page.locator('#personal-grid').fill('');await page.getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','shared');await save(page);await exit(page);
});

test('invalid grid stays in the popup; Cancel and Escape discard without touching the draft',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);const before=await savedSongs(page);await edit(page);
 await page.locator('.edit-chart').click();await page.locator('#personal-grid').fill('ugyldig');await page.getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('#personal-grid')).toBeVisible();
 await page.getByRole('button',{name:'Avbryt',exact:true}).click();await expect(page.locator('#edit-save')).toBeDisabled();await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','shared');
 await page.locator('.edit-chart').click();await page.locator('#personal-grid').fill('| C |');await page.keyboard.press('Escape');await expect(page.locator('#edit-save')).toBeDisabled();
 await exit(page);expect(await savedSongs(page)).toEqual(before);
});

test('native selection across chords, highlight resizing and removal stay on the selected occurrence',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);
 await select(page,source,2,17);await page.getByRole('button',{name:'Markeringspenn',exact:true}).click();
 const line=page.locator(`[data-occurrence="${source}"]`);expect((await line.locator('mark').allTextContents()).join('')).toBe('lig øvelse å sy');
 await line.locator('mark').first().click();await expect(page.locator('.highlight-controls:not([hidden]) .highlight-handle')).toHaveCount(2);await page.getByLabel('Dra slutten på markeringen',{exact:true}).focus();for(let index=0;index<5;index++)await page.keyboard.press('ArrowLeft');
 await save(page);expect((await personal(page))[0].annotations[source].highlights.map(({start,end})=>({start,end}))).toEqual([{start:2,end:12}]);
 await line.locator('mark').first().click();await page.getByRole('button',{name:'Fjern markering',exact:true}).click();await expect(line.locator('mark')).toHaveCount(0);await save(page);
});

test('note tool places local notes without selection; repeated chorus has independent notes and deletion',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);
 await page.locator('.edit-toolbar').getByRole('button',{name:'Notat',exact:true}).click();await page.locator(`[data-occurrence="${source}"] .lyric`).first().click();await page.locator('#annotation-note').fill('Syng rolig\nVent på tegn');await page.getByRole('button',{name:'OK',exact:true}).click();
 await page.getByRole('button',{name:'Refreng',exact:true}).first().click();
 const ref=page.locator('[data-occurrence="line:9/line:7"]');await page.locator('.edit-toolbar').getByRole('button',{name:'Notat',exact:true}).click();await ref.locator('.lyric').first().click();await page.locator('#annotation-note').fill('Bare denne gjentakelsen');await page.getByRole('button',{name:'OK',exact:true}).click();
 await save(page);await exit(page);await expect(page.locator('.personal-note')).toHaveCount(2);await expect(ref.locator('.personal-note')).toHaveText('Bare denne gjentakelsen');
 for(const width of [320,768,1440]) {await page.setViewportSize({width,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const row=await ref.boundingBox(),note=await ref.locator('.personal-note').boundingBox();expect(note.y+note.height).toBeLessThanOrEqual(row.y+row.height+1);}
 await edit(page);await ref.getByRole('button',{name:'Slett notat',exact:true}).click();await save(page);await exit(page);await expect(page.locator('.personal-note')).toHaveCount(1);
});

test('independent saved fields from two tabs survive and equal titles remain separate',async({page,context})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);
 const other=await context.newPage();await other.goto(url);await other.locator('.song-choice').click();await edit(other);
 await page.locator('#tuning-pill').click();await page.locator('#personal-tuning').fill('Drop D');await page.getByRole('button',{name:'OK',exact:true}).click();await save(page);
 await capo(other,2);await save(other);const state=(await personal(page))[0];expect(state.tuning).toBe('Drop D');expect(state.capo).toBe(2);
 await exit(page);await page.locator('#back').click();await importSong(page,'personlig.cho',original);await expect(page.locator('.song-metadata')).not.toContainText('Capo');expect(await savedSongs(page)).toHaveLength(2);
});

test('app update blocks unsaved changes, then restores saved editing without leaving',async({page,request})=>{
 await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'personlig.cho',original);await edit(page);await capo(page,2);
 await request.post('/__test__/update?channel=test');await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());await expect(page.locator('#update-notice')).toBeVisible();
 const origin=await page.evaluate(()=>performance.timeOrigin);await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();await expect(page.locator('#update-notice-text')).toContainText('ulagrede');expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);
 await save(page);await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();await expect(page.locator('.build')).toContainText('ccccccc');await expect(page.locator('.edit-toolbar')).toBeVisible();await expect(page.locator('#capo-pill')).toContainText('2');await exit(page);await expect(page.locator('#reader')).toBeVisible();
});

test('actual pending save delays worker reload and preserves note and capo offline',async({page,request,context})=>{
 await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'personlig.cho',original);const before=await savedSongs(page);await edit(page);await capo(page,2);
 await request.post('/__test__/update?channel=test');await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());await expect(page.locator('#update-notice')).toBeVisible();
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.releaseWrite=false;window.heldWrite=false;IDBObjectStore.prototype.put=function(...args){if(this.name!=='personal')return put.apply(this,args);const store=this;window.heldWrite=true;const keepAlive=()=>{const request=store.get(args[0].songId);request.onsuccess=()=>{if(window.releaseWrite)put.apply(store,args);else keepAlive();};return request;};return keepAlive();};});
 await page.locator('#edit-save').click();await expect.poll(()=>page.evaluate(()=>window.heldWrite)).toBe(true);const origin=await page.evaluate(()=>performance.timeOrigin);await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);
 await page.evaluate(()=>window.releaseWrite=true);await expect(page.locator('.build')).toContainText('ccccccc');await exit(page);await context.setOffline(true);await page.reload();await page.locator('.song-choice').click();await expect(page.locator('.song-metadata')).toContainText('Capo 2');expect(await savedSongs(page)).toEqual(before);await context.setOffline(false);
});

test('no-key song supports a new chart, invalid capo correction, whole-line highlight and both themes',async({page})=>{
 await page.goto(url);await importSong(page,'uten.txt','Ærlig øvelse å synge\nSamme linje');await edit(page);await capo(page,2);
 await page.locator('.grid-placeholder').click();await page.locator('#personal-grid').fill('| C . C/E . |');await page.getByRole('button',{name:'OK',exact:true}).click();await save(page);
 expect((await personal(page))[0].chordGrid).toContain('D/F#');await expect(page.locator('#chart-dock')).toContainText('C/E');await expect(page.locator('#capo-pill')).toHaveText('Capo 2');
 await page.locator('#capo-pill').click();await page.locator('#personal-capo').fill('1.5');await page.getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('#personal-capo')).toBeVisible();expect((await personal(page))[0].capo).toBe(2);
 await page.locator('#personal-capo').fill('0');await page.getByRole('button',{name:'OK',exact:true}).click();
 await select(page,'source/line:0',0,20);await page.getByRole('button',{name:'Markeringspenn',exact:true}).click();await save(page);await exit(page);
 const line=page.locator('.song-line').first();expect((await line.locator('mark').allTextContents()).join('')).toBe('Ærlig øvelse å synge');
 for(const theme of ['dark','light']) {
   await openMenu(page);await page.locator('#theme').selectOption(theme);await page.locator('#font-size').evaluate(node=>{node.value='36';node.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#menu-close').click();await page.setViewportSize({width:320,height:800});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(line.locator('mark').first()).toHaveCSS('background-color','rgb(241, 216, 75)');
 }
 await expect(page.locator('.song-metadata')).toHaveText('4/4');
});

test('full browser restart offline preserves saved settings, chart, note and selected spans',async({playwright,browserName},testInfo)=>{
 const {mkdtemp,rm,mkdir}=await import('node:fs/promises');await mkdir('work/profiles',{recursive:true});const profile=await mkdtemp('work/profiles/personal-');
 const launch=()=>playwright[browserName].launchPersistentContext(profile,{executablePath:testInfo.project.use.launchOptions.executablePath,args:['--no-sandbox'],headless:true});let context;
 try {
   context=await launch();let page=context.pages()[0];await page.goto('http://127.0.0.1:4173'+url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await importSong(page,'personlig.cho',original);const before=await savedSongs(page);await edit(page);await capo(page,2);
   await page.locator('#tuning-pill').click();await page.locator('#personal-tuning').fill('Drop D');await page.getByRole('button',{name:'OK',exact:true}).click();
   await page.locator('.edit-chart').click();await page.locator('#personal-grid').fill('| C . |');await page.getByRole('button',{name:'OK',exact:true}).click();
   await select(page,source,2,17);await page.getByRole('button',{name:'Notat',exact:true}).last().click();await page.locator('#annotation-note').fill('Gjelder offline');await page.getByRole('button',{name:'OK',exact:true}).click();
   await select(page,source,2,17);await page.getByRole('button',{name:'Markeringspenn',exact:true}).click();await save(page);await exit(page);const stored=await personal(page);
   await context.close();context=await launch();await context.setOffline(true);page=context.pages()[0];await page.goto('http://127.0.0.1:4173'+url);await page.locator('.song-choice').click();
   await expect(page.locator('.song-metadata')).toContainText('Capo 2: C');await expect(page.locator('.song-metadata')).toContainText('Drop D');await expect(page.locator('.personal-note')).toHaveText('Gjelder offline');
   expect((await page.locator('.song-line').first().locator('mark').allTextContents()).join('')).toBe('lig øvelse å sy');await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','personal');expect(await personal(page)).toEqual(stored);expect(await savedSongs(page)).toEqual(before);
 } finally {await context?.close();await rm(profile,{recursive:true,force:true});}
});

test('edit and exit preserve the reading place while the chart scrolls and toolbar stays available',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await page.evaluate(()=>scrollTo(0,700));
 const reading=()=>page.evaluate(()=>{const top=document.querySelector('.topbar').getBoundingClientRect().bottom;const sticky=document.querySelector('#chart-dock[data-sticky=true]')?.getBoundingClientRect();const tools=document.querySelector('.edit-toolbar')?.getBoundingClientRect();const edge=Math.max(top,sticky&&sticky.top<=top+1?sticky.bottom:top,tools&&tools.top<=top+1?tools.bottom:top);const row=[...document.querySelectorAll('.song-line')].find(row=>{const rect=row.getBoundingClientRect();return rect.height&&rect.bottom>edge;});return row?.dataset.occurrence;});
 const before=await reading();await edit(page);expect(await reading()).toBe(before);await expect(page.locator('#chart-dock')).not.toBeInViewport();await expect(page.locator('.edit-toolbar')).toBeInViewport();await expect(page.locator('#chart-close')).toBeHidden();
 await exit(page);await expect.poll(reading).toBe(before);await expect(page.locator('#chart-dock')).toHaveAttribute('data-sticky','true');
});

test('marker tool accepts a real mouse selection and turns off without adding line controls',async({page})=>{
 await page.goto(url);await importSong(page,'personlig.cho',original);await edit(page);
 const line=page.locator(`[data-occurrence="${source}"]`);const start=await line.locator('.lyric').first().boundingBox(),end=await line.locator('.lyric').last().boundingBox();
 await page.getByRole('button',{name:'Markeringspenn'}).click();await expect(page.getByRole('button',{name:'Markeringspenn'})).toHaveAttribute('aria-pressed','true');
 await page.mouse.move(start.x+2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(end.x+end.width-2,end.y+end.height/2,{steps:15});await page.mouse.up();
 await expect(line.locator('mark').first()).toBeVisible();await expect(page.getByRole('button',{name:'Markeringspenn'})).toHaveAttribute('aria-pressed','false');
 await save(page);expect((await personal(page))[0].annotations[source].highlights.length).toBeGreaterThan(0);await expect(page.locator('.annotate-line')).toHaveCount(0);
});

test('icon order, semantic save state, popup transactions and source time signature',async({page})=>{
 await page.setViewportSize({width:768,height:900});await page.goto(url);await importSong(page,'vals.cho','{key: Em}\n{time: 3/4}\n{sog}\n| Em . | C . | G . | D . |\n{eog}\n[Em]Vals');
 await expect(page.locator('.song-metadata')).toHaveText('Em3/4');
 const bars=await page.locator('.grid-measure').evaluateAll(nodes=>nodes.map(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right})));expect(bars.at(-1).right-bars[0].left).toBeLessThan(550);
 await edit(page);
 expect(await page.locator('.edit-toolbar button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')))).toEqual(['Lagre','Markeringspenn','Notat','Akkordskjema']);
 await expect(page.locator('.edit-toolbar')).toHaveText('');await expect(page.locator('#edit-save')).toBeDisabled();await expect(page.locator('#tuning-pill')).toHaveText('Standard stemming');
 const pills=await page.locator('.song-metadata > .song-key').evaluateAll(nodes=>nodes.map(n=>({top:n.getBoundingClientRect().top,height:n.getBoundingClientRect().height})));
 expect(new Set(pills.map(n=>n.top)).size).toBe(1);expect(new Set(pills.map(n=>n.height)).size).toBe(1);
 await page.locator('#capo-pill').click();expect((await page.locator('#personal-capo').boundingBox()).width).toBeLessThan(90);
 await page.locator('#personal-capo').fill('2');await page.getByRole('button',{name:'Avbryt',exact:true}).click();await expect(page.locator('#capo-pill')).toHaveText('Uten capo');await expect(page.locator('#edit-save')).toBeDisabled();
 await capo(page,2);await expect(page.locator('#edit-save')).toBeEnabled();await capo(page,0);await expect(page.locator('#edit-save')).toBeDisabled();
 await page.getByRole('button',{name:'Akkordskjema',exact:true}).click();const box=await page.locator('.popup-grid').boundingBox();expect(box.width).toBeGreaterThan(700);expect(Math.abs(box.x-(768-box.width)/2)).toBeLessThan(1);
 const cancel=await page.getByRole('button',{name:'Avbryt',exact:true}).boundingBox(),ok=await page.getByRole('button',{name:'OK',exact:true}).boundingBox();expect(cancel.x).toBeLessThan(ok.x);expect(cancel.y).toBe(ok.y);expect(ok.x-cancel.x-cancel.width).toBeLessThanOrEqual(12);expect(box.x+box.width-ok.x-ok.width).toBeLessThanOrEqual(20);
 await expect(page.locator('.popup-grid button')).toHaveText(['Avbryt','OK']);await expect(page.locator('#personal-grid')).not.toHaveValue(/\{sog/);
 await page.locator('#personal-grid').fill('| Am |');await page.getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('#chart-dock')).toContainText('Am');expect((await personal(page))[0]?.chordGrid).toBeUndefined();await save(page);
 await exit(page);await expect(page.locator('.song-metadata')).toHaveText('Em3/4');await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','personal');
});

test('notes use a fresh target in the margin and on a blank line; scrolling or cancelled touch never opens an editor',async({page})=>{
 await page.goto(url);await importSong(page,'steder.cho','Første ord\n\nAndre ord\n'+('Flere ord\n').repeat(40));await edit(page);
 await select(page,'source/line:0',0,6);await page.locator('.song-line').nth(1).click(); // collapses the old selection
 await page.getByRole('button',{name:'Notat',exact:true}).click();await expect(page.locator('#annotation-note')).toHaveCount(0);
 const row=page.locator('[data-occurrence="source/line:2"]'),rect=await row.boundingBox();
 await page.mouse.move(rect.x+rect.width-8,rect.y+rect.height/2);await expect(page.locator('[data-note-target]')).toHaveCount(1);await expect(row).toHaveAttribute('data-note-target','');
 await page.mouse.down();await expect(page.locator('.edit-popup')).toHaveCount(0);await page.mouse.move(rect.x+rect.width-8,rect.y+rect.height/2+40,{steps:5});await page.mouse.up();await expect(page.locator('.edit-popup')).toHaveCount(0);
 await row.dispatchEvent('pointerdown',{pointerId:8,pointerType:'touch',clientX:rect.x+3,clientY:rect.y+3,bubbles:true});await row.dispatchEvent('pointercancel',{pointerId:8,pointerType:'touch',bubbles:true});await expect(page.locator('.edit-popup')).toHaveCount(0);
 await row.click({position:{x:rect.width-8,y:rect.height/2}});await page.locator('#annotation-note').fill('Ved andre linje');await page.getByRole('button',{name:'OK',exact:true}).click();
 await expect(row.locator('.personal-note')).toContainText('Ved andre linje');await expect(page.locator('[data-occurrence="source/line:0"] .personal-note')).toHaveCount(0);
 await page.getByRole('button',{name:'Notat',exact:true}).click();await page.locator('[data-occurrence="source/line:1"]').click();await page.locator('#annotation-note').fill('I pausen');await page.getByRole('button',{name:'OK',exact:true}).click();
 await row.locator('.personal-note').click();await page.locator('#annotation-note').fill('Forkastes');await page.getByRole('button',{name:'Avbryt',exact:true}).click();await expect(row.locator('.personal-note')).toContainText('Ved andre linje');
 await save(page);await exit(page);await expect(page.locator('[data-occurrence="source/line:1"] .personal-note')).toHaveText('I pausen');
 const data=(await personal(page))[0];expect(data.annotations['source/line:1'].anchor.sourceLine).toBe(1);expect(data.annotations['source/line:1'].anchor.text).toBe('');
});

test('highlight end can be dragged directly while lyric offsets remain clean',async({page})=>{
 await page.goto(url);await importSong(page,'ord.cho','En lang sanglinje med flere ord');await edit(page);await select(page,'source/line:0',3,7);await page.getByRole('button',{name:'Markeringspenn'}).click();await page.locator('mark').click();
 const handle=page.getByRole('slider',{name:'Dra slutten på markeringen'}), from=await handle.boundingBox();
 const target=await page.locator('.lyric').filter({hasText:'sanglinje'}).boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width,target.y+target.height/2,{steps:10});await page.mouse.up();
 await save(page);const spans=(await personal(page))[0].annotations['source/line:0'].highlights;expect(spans[0].start).toBe(3);expect(spans[0].end).toBeGreaterThan(7);
 expect(await page.locator('.lyric').allTextContents()).toEqual(['En',' ','lang',' ','sanglinje',' ','med',' ','flere',' ','ord']);
 await expect(page.locator('.selection-tools')).toHaveCount(0);
});

test('keyboard note placement and popup focus, outside scroll and cancel preserve the song draft',async({page})=>{
 await page.goto(url);await importSong(page,'taster.cho','Første\nAndre\n'+('Mer tekst\n').repeat(60));await edit(page);await page.getByRole('button',{name:'Notat',exact:true}).click();
 const row=page.locator('[data-occurrence="source/line:1"]');await row.focus();await expect(row).toHaveAttribute('data-note-target','');await page.keyboard.press('Enter');await expect(page.locator('#annotation-note')).toBeFocused();
 await page.locator('#annotation-note').fill('Bare her');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Avbryt',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'OK',exact:true})).toBeFocused();await page.keyboard.press('Enter');
 await expect(row.locator('.personal-note')).toContainText('Bare her');await page.locator('.personal-note').click();await page.locator('#annotation-note').fill('Forkast dette');
 await page.mouse.move(4,650);await page.mouse.wheel(0,100);await expect(page.locator('#annotation-note')).toBeVisible();
 await page.mouse.click(4,650);await expect(page.locator('.edit-popup')).toHaveCount(0);await expect(row.locator('.personal-note')).toContainText('Bare her');await save(page);
});

test('touch panning in note placement mode scrolls without placing a note or opening a popup',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:750},isMobile:true,hasTouch:true});const page=await context.newPage();
 try {
  await page.goto('http://127.0.0.1:4173'+url);await importSong(page,'beroring.txt',('En lang sang\n').repeat(80));await edit(page);await page.getByRole('button',{name:'Notat',exact:true}).tap();
  const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y:600}]});await expect(page.locator('.edit-popup')).toHaveCount(0);
  for(const y of [560,500,430,360,290]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:330,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(50);await expect(page.locator('.edit-popup,.personal-note')).toHaveCount(0);
 } finally {await context.close();}
});

test('multiple chart sections keep their wrappers; clearing every body restores all shared sections',async({page})=>{
 const original='{sog: shape="2x3" label="Vers"}\n| D . . | A . . |\n{eog}\nTekst\n{sog: shape="1x4" label="Bro"}\n| G . D . |\n{eog}';
 await page.goto(url);await importSong(page,'flere.cho',original);await edit(page);await capo(page,2);await page.getByRole('button',{name:'Akkordskjema',exact:true}).click();
 const fields=page.locator('.popup-grid textarea');await expect(fields).toHaveCount(2);await expect(fields.nth(0)).toHaveValue(/C/);await expect(fields.nth(1)).toHaveValue(/F/);
 await fields.nth(0).fill('| C . G . |');await fields.nth(1).fill('| Am . C/E . |');await page.getByRole('button',{name:'OK',exact:true}).click();await save(page);
 const stored=(await personal(page))[0].chordGrid;expect(stored).toContain('shape="2x3" label="Vers"');expect(stored).toContain('shape="1x4" label="Bro"');expect(stored).toContain('Bm');expect(stored).toContain('D/F#');
 await page.getByRole('button',{name:'Akkordskjema',exact:true}).click();await fields.nth(0).fill('');await fields.nth(1).fill('');await page.getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','shared');await expect(page.locator('#chart-dock figcaption')).toHaveText(['Vers','Bro']);
 await save(page);await exit(page);expect((await savedSongs(page))[0].original).toBe(original);
});
