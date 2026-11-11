import {test, expect} from '@playwright/test';
import {importSong, savedSongs, openMenu, goSongs, setCapo} from './song-helpers.mjs';
const url = '/hobos-songbook/test/';
const legacy = {id:'stable-song', original:'\uFEFF{title: Behold meg}\r\n{key: Am}\r\nTekst\r\n',title:'Behold meg',key:'Am',origin:{kind:'external',filename:'behold.cho',importedAt:'2026-01-01',provider:'future',fileId:'external-id'}};
const personal = {songId:legacy.id,version:3,capo:3,tuning:'DADGAD',chorus:{},notes:{one:{line:0,text:'Husk dette'}},chordGrid:'| Am |'};
test.beforeEach(async ({request}) => {await request.post('/__test__/reset');});

async function seed(page, version=1) {
  await page.goto('/__test__/ready');
  await page.evaluate(({version,song,personal}) => new Promise((resolve,reject) => {
    const request=indexedDB.open('hobos-songbook-test',version);
    request.onupgradeneeded=()=>{
      const db=request.result;db.createObjectStore('songs',{keyPath:'id'}).add(song);db.createObjectStore('personal',{keyPath:'songId'}).add(personal);
      if(version===2){const books=db.createObjectStore('songbooks',{keyPath:'id'});books.add({id:'standard',name:'Standard'});books.add({id:'band',name:'Band'});books.add({id:'empty',name:'Tom sangbok'});}
    };
    request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve();};
  }), {version,song:version===1?legacy:{...legacy,songbookId:'band'},personal});
}
async function snapshot(page) {
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('hobos-songbook-test');request.onerror=()=>reject(request.error);request.onsuccess=()=>{
      const db=request.result,tx=db.transaction([...db.objectStoreNames]),data={version:db.version};
      for(const name of db.objectStoreNames){const get=tx.objectStore(name).getAll();get.onsuccess=()=>{data[name]=get.result;};}
      tx.oncomplete=()=>{db.close();resolve(data);};tx.onabort=()=>reject(tx.error);
    };
  }));
}
async function chooseBook(page, name) {
  await page.locator('#songbook-filter').click();await page.getByRole('option',{name,exact:true}).click();
}

test('v1 upgrades atomically, preserves every stored field and remains stable offline',async({page,context})=>{
  await seed(page);await page.goto(url);await expect(page.locator('.song-choice')).toHaveCount(1);
  const state=await snapshot(page);expect(state).toEqual({version:2,songs:[{...legacy,songbookId:'standard'}],personal:[personal],songbooks:[{id:'standard',name:'Standard'}]});
  await expect(page.locator('.row-metadata')).toHaveText('Am4/4Capo 3: F#mStemming: DADGAD');
  await chooseBook(page,'Standard');await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');
  await page.reload();await expect(page.locator('#songbook-filter')).toHaveText('Standard');expect(await snapshot(page)).toEqual(state);
  await context.setOffline(true);await page.reload();await expect(page.locator('#songbook-filter')).toHaveText('Standard');
  await page.locator('.song-choice').click();await expect(page.locator('#song-title')).toHaveText('Behold meg');expect(await savedSongs(page)).toEqual(state.songs);
});

test('an aborted upgrade rolls back new store and song changes; retry migrates once',async({page})=>{
  await seed(page);await page.addInitScript(()=>{
    const update=IDBCursor.prototype.update;
    IDBCursor.prototype.update=function(...args){const request=update.apply(this,args);this.source.transaction.abort();return request;};
    window.restoreMigration=()=>{IDBCursor.prototype.update=update;};
  });
  await page.goto(url);await expect(page.locator('#retry-storage')).toBeVisible();await expect(page.locator('#library-status')).not.toContainText('Ingen sanger');
  expect(await snapshot(page)).toEqual({version:1,songs:[legacy],personal:[personal]});
  await page.evaluate(()=>window.restoreMigration());await page.locator('#retry-storage').click();await expect(page.locator('.song-choice')).toHaveCount(1);
  const state=await snapshot(page);expect(state.songbooks).toEqual([{id:'standard',name:'Standard'}]);expect(state.songs).toEqual([{...legacy,songbookId:'standard'}]);expect(state.personal).toEqual([personal]);
});

test('an old open connection reports blocked upgrade and allows a safe retry',async({page,context})=>{
  await seed(page);
  await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('hobos-songbook-test',1);request.onsuccess=()=>{window.blocker=request.result;resolve();};}));
  const app=await context.newPage();await app.goto('http://127.0.0.1:4173'+url);await expect(app.locator('#library-status')).toContainText('blokkert');
  await page.evaluate(()=>window.blocker.close());await app.locator('#retry-storage').click();await expect(app.locator('.song-choice')).toHaveCount(1);
  expect((await snapshot(app)).songbooks).toHaveLength(1);await app.close();
});

test('book choices filter real songs, preserve membership and persist separately from production',async({page,context})=>{
  await seed(page,2);await page.goto(url);await importSong(page,'local.txt','{t: Lokal}\nTekst');await goSongs(page);
  await page.locator('#songbook-filter').click();await expect(page.getByRole('option')).toHaveText(['Alle','Band','Standard','Tom sangbok']);
  await page.getByRole('option',{name:'Band',exact:true}).click();await expect(page.locator('.song-choice')).toHaveCount(1);await expect(page.locator('.song-choice')).toContainText('Behold meg');
  await openMenu(page);await page.getByRole('button',{name:'Filer',exact:true}).click();await goSongs(page);await expect(page.locator('#songbook-filter')).toHaveText('Band');
  await page.reload();await expect(page.locator('#songbook-filter')).toHaveText('Band');expect((await snapshot(page)).songs.find(s=>s.id===legacy.id).songbookId).toBe('band');
  await chooseBook(page,'Tom sangbok');await expect(page.locator('#library-status')).toContainText('Ingen sanger i Tom sangbok');await expect(page.locator('#add-song')).toBeEnabled();
  await chooseBook(page,'Alle');await expect(page.locator('.song-choice')).toHaveCount(2);
  const prod=await context.newPage();await prod.goto('http://127.0.0.1:4173/hobos-songbook/app/');await expect(prod.locator('#songbook-filter')).toHaveText('Alle');await expect(prod.locator('.song-choice')).toHaveCount(0);await prod.close();
  await page.evaluate(()=>localStorage.setItem('hobos-songbook-test:songbook-filter','missing'));await page.reload();await expect(page.locator('#songbook-filter')).toHaveText('Alle');await expect(page.locator('.song-choice')).toHaveCount(2);
});

test('menu and picker use real keyboard/touch entrypoints, focus return and native file selection',async({page})=>{
  await page.goto(url);await expect(page.locator('#add-song')).toBeEnabled();await expect(page.locator('#new-song,.song-actions,.import-panel')).toHaveCount(0);
  await page.locator('#add-song').click();await expect(page.getByRole('menuitem')).toHaveText(['Opprett','Importer']);await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'Importer',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#add-song')).toBeFocused();await expect(page.locator('#add-song')).toHaveAttribute('aria-expanded','false');
  await page.locator('#add-song').click();const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'Importer',exact:true}).click();
  await (await chooser).setFiles({name:'valgt.txt',mimeType:'text/plain',buffer:Buffer.from('{t: Valgt sang}\nTekst')});await expect(page.locator('#song-title')).toHaveText('Valgt sang');
  await page.locator('#back').click();await page.locator('.song-choice').click();await expect(page.locator('#song-title')).toHaveText('Valgt sang');
  await page.locator('#back').click();await page.locator('#songbook-filter').click();await page.keyboard.press('End');await expect(page.getByRole('option',{name:'Standard',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#songbook-filter')).toHaveText('Standard');await expect(page.locator('#songbook-filter')).toBeFocused();
  await page.locator('#songbook-filter').click();await page.mouse.click(2,page.viewportSize().height-2);await expect(page.getByRole('dialog',{name:'Sangbok',exact:true})).toHaveCount(0);await expect(page.locator('#songbook-filter')).toHaveText('Standard');
});

test('rows use saved personal metadata; drafts and discarded edits never leak',async({page})=>{
  await page.goto(url);await importSong(page,'meta.txt','{t: Metadata}\n{key: Am}\nTekst');await page.locator('#edit-song').click();await setCapo(page,3);
  await page.locator('#edit-save').click();await expect(page.locator('#edit-save')).toBeDisabled();await page.locator('#back').click();await page.locator('#back').click();
  await expect(page.locator('.row-metadata')).toHaveText('Am4/4Capo 3: F#m');await expect(page.locator('.song-choice')).not.toContainText('Standard stemming');
  await page.locator('.song-choice').click();await page.locator('#edit-song').click();await setCapo(page,7);await goSongs(page);await page.getByRole('button',{name:'Forkast endringer',exact:true}).click();await expect(page.locator('.row-metadata')).toContainText('Capo 3: F#m');
  await importSong(page,'uten.txt','{t: Uten toneart}\nTekst');await page.locator('#edit-song').click();await setCapo(page,2);await page.locator('#edit-save').click();await expect(page.locator('#edit-save')).toBeDisabled();await page.locator('#back').click();await page.locator('#back').click();
  await expect(page.locator('.song-choice').filter({hasText:'Uten toneart'})).toContainText('Capo 2');await expect(page.locator('.song-choice').filter({hasText:'Uten toneart'})).not.toContainText('Capo 2:');
});

test('metadata read and filter storage errors remain truthful and retry keeps stored data',async({page})=>{
  await seed(page,2);await page.addInitScript(()=>{
    const cursor=IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor=function(...args){const result=cursor.apply(this,args);if(this.name==='personal')this.transaction.abort();return result;};
    window.restoreListRead=()=>{IDBObjectStore.prototype.openCursor=cursor;};
  });
  await page.goto(url);await expect(page.locator('#library-status')).toContainText('Kunne ikke lese sanglisten og metadata');await expect(page.locator('.song-choice')).toHaveCount(0);await expect(page.locator('#retry-storage')).toBeVisible();
  await page.evaluate(()=>window.restoreListRead());await page.locator('#retry-storage').click();await expect(page.locator('.row-metadata')).toContainText('Capo 3: F#m');
  const before=await snapshot(page);await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,...args){if(key.endsWith(':songbook-filter'))throw new Error('QuotaExceeded');return set.call(this,key,...args);};});
  await chooseBook(page,'Band');await expect(page.locator('#songbook-filter')).toHaveText('Band');await expect(page.locator('#filter-status')).toContainText('kunne ikke lagres');expect(await snapshot(page)).toEqual(before);
});

test('touch controls wait for release and cancelled outside gestures keep the picker',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:800},hasTouch:true,isMobile:true}),page=await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4173'+url);await expect(page.locator('#add-song')).toBeEnabled();const fab=await page.locator('#add-song').boundingBox(),cdp=await context.newCDPSession(page);
    expect(fab.width).toBeGreaterThanOrEqual(44);expect(fab.height).toBeGreaterThanOrEqual(44);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:fab.x+fab.width/2,y:fab.y+fab.height/2}]});await expect(page.getByRole('menuitem')).toHaveCount(0);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.getByRole('menuitem',{name:'Opprett',exact:true})).toBeVisible();
    await page.getByRole('menuitem',{name:'Opprett',exact:true}).tap();await page.getByRole('button',{name:'Avbryt',exact:true}).tap();await expect(page.locator('#library')).toBeVisible();expect(await savedSongs(page)).toEqual([]);
    await page.locator('#songbook-filter').tap();const box=page.getByRole('dialog',{name:'Sangbok',exact:true});
    await box.dispatchEvent('pointerdown',{clientX:2,clientY:700,pointerId:7,pointerType:'touch'});await box.dispatchEvent('pointercancel',{pointerId:7,pointerType:'touch'});await box.dispatchEvent('click',{clientX:2,clientY:700});await expect(box).toBeVisible();
    await page.getByRole('option',{name:'Standard',exact:true}).tap();await expect(page.locator('#songbook-filter')).toHaveText('Standard');
  } finally {await context.close();}
});

test('a real worker update preserves chosen songbook and active song',async({page,request})=>{
  await seed(page,2);await page.goto(url);await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await chooseBook(page,'Band');await page.locator('.song-choice').click();
  await request.post('/__test__/update?channel=test');await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});await page.getByRole('button',{name:'Oppdater nå',exact:true}).click();
  await expect(page.locator('.build')).toContainText('ccccccc');await expect(page.locator('#song-title')).toHaveText('Behold meg');await page.locator('#back').click();await expect(page.locator('#songbook-filter')).toHaveText('Band');expect((await snapshot(page)).songs[0].songbookId).toBe('band');
});

test('header stays centered and long rows, picker and final row fit mobile/tablet/desktop',async({page})=>{
  await seed(page,2);await page.goto(url);await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('hobos-songbook-test');request.onsuccess=()=>{const db=request.result,tx=db.transaction(['songs','songbooks'],'readwrite');tx.objectStore('songbooks').put({id:'band',name:'Veldig lang sangbok med norske tegn æøå og mange ord'});for(let i=0;i<24;i++)tx.objectStore('songs').put({id:`song-${i}`,songbookId:'band',original:`{t: Lang tittel ${'Veldiglangtord'.repeat(10)} ${i}}\nTekst`,title:`Lang tittel ${'Veldiglangtord'.repeat(10)} ${i}`,key:null,origin:{kind:'local',filename:`${i}.txt`,importedAt:String(i)}});tx.oncomplete=()=>{db.close();resolve();};};}));await page.reload();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:800});await chooseBook(page,'Veldig lang sangbok med norske tegn æøå og mange ord');
    const button=await page.locator('#songbook-filter').boundingBox(),header=await page.locator('.topbar').boundingBox();expect(Math.abs(button.x+button.width/2-(header.x+header.width/2))).toBeLessThan(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));const last=await page.locator('.song-choice').last().boundingBox(),fab=await page.locator('#add-song').boundingBox();expect(last.y+last.height).toBeLessThanOrEqual(fab.y);
    await page.locator('#songbook-filter').click();const picker=await page.getByRole('dialog',{name:'Sangbok',exact:true}).boundingBox();expect(picker.x).toBeGreaterThanOrEqual(0);expect(picker.x+picker.width).toBeLessThanOrEqual(width);await page.keyboard.press('Escape');
  }
});
