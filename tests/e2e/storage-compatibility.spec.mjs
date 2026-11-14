import {test, expect} from '@playwright/test';
import {openMenu, importSong, goSongs, tool, fillValue} from './song-helpers.mjs';
const url = '/hobos-songbook/test/';
const song = {id:'preserved-song',songbookId:'my-book',title:'Behold sangen',key:'D',original:'\uFEFF{t: Behold sangen}\r\n{key: D}\r\n[D]Ord\r\n',origin:{kind:'external',filename:'behold.cho',importedAt:'2026-01-01',provider:'dropbox',sourceId:'fixture-source',fileId:'fixture-file',relativePath:'mappe/behold.cho'},sync:{access:'private',folderId:'fixture-folder',sourceRev:'fixture-rev',pending:true}};
const book = {id:'my-book',name:'Min bok',folderId:'fixture-folder',folderName:'Min bok',folderMissing:false};
const personal = {songId:song.id,version:3,chorus:{},capo:2,tuning:'DADGAD',chordGrid:'| D |',notes:{note:{line:0,text:'Behold notatet'}},annotations:{'source/line:2':{anchor:{songId:song.id,sourceLine:2,occurrence:'source/line:2'},highlights:[{start:0,end:3}]}}};
const setlist = {id:'preserved-list',name:'Konsert',createdAt:1,songIds:[song.id],future:{keep:true}};
const sync = {id:'state',version:1,outbox:[{id:'fixture-pending',songId:song.id}],future:{keep:'uendret'}};

test.beforeEach(async ({request}) => {await request.post('/__test__/reset');});
async function seed(page, version=4, incompatible=false) {
  await page.goto('/__test__/ready');
  await page.evaluate(({version,incompatible,song,book,personal,setlist,sync}) => new Promise((resolve,reject) => {
    const r=indexedDB.open('hobos-songbook-test',version);
    r.onupgradeneeded=()=>{
      const db=r.result;
      db.createObjectStore('songs',{keyPath:incompatible?'otherId':'id'}).add(incompatible?{...song,otherId:song.id}:song);
      db.createObjectStore('songbooks',{keyPath:'id'}).add(book);
      db.createObjectStore('personal',{keyPath:'songId'}).add(personal);
      db.createObjectStore('setlists',{keyPath:'id'}).add(setlist);
      db.createObjectStore('sync',{keyPath:'id'}).add(sync);
    };
    r.onerror=()=>reject(r.error);r.onsuccess=()=>{r.result.close();resolve();};
  }),{version,incompatible,song,book,personal,setlist,sync});
  return snapshot(page);
}
async function snapshot(page) {
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const r=indexedDB.open('hobos-songbook-test');r.onerror=()=>reject(r.error);
    r.onsuccess=()=>{
      const db=r.result,tx=db.transaction([...db.objectStoreNames]),result={version:db.version};
      for(const name of db.objectStoreNames){const q=tx.objectStore(name).getAll();q.onsuccess=()=>result[name]=q.result;}
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>reject(tx.error);
    };
  }));
}
async function goBooks(page) {await openMenu(page);await page.getByRole('button',{name:'Sangbøker',exact:true}).click();await expect(page.locator('#add-songbook')).toBeEnabled();}

test('the previously published v4 database reopens without downgrade, replacement or lost records',async({page,context})=>{
  const before=await seed(page);await page.goto(url);
  await expect(page.locator('#song-list .song-choice')).toHaveText('Behold sangenD4/4Capo 2: CStemming: DADGAD');
  await expect(page.locator('#retry-storage')).toBeHidden();expect(await snapshot(page)).toEqual(before);
  await goBooks(page);await expect(page.locator('#songbook-list .count-choice')).toHaveText(['Min bok1 sang']);
  await page.locator('#songbook-my-book').click();await expect(page.locator('#songbook-filter')).toHaveText('Min bok');
  await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');await page.reload();await expect(page.locator('#songbook-filter')).toHaveText('Min bok');expect(await snapshot(page)).toEqual(before);
  await context.setOffline(true);await page.reload();await expect(page.locator('#song-list .song-choice')).toHaveCount(1);expect(await snapshot(page)).toEqual(before);
});

test('local book and song writes preserve v4 metadata, extra stores, identities and setlist references',async({page})=>{
  const before=await seed(page);await page.goto(url);await goBooks(page);
  await page.locator('#songbook-menu-my-book').click();await page.getByRole('menuitem',{name:'Endre navn',exact:true}).click();await page.getByLabel('Navn',{exact:true}).fill('Nytt boknavn');await page.getByRole('button',{name:'Lagre',exact:true}).click();await expect(page.getByRole('dialog',{name:'Endre navn på sangbok',exact:true})).toHaveCount(0);
  expect(await snapshot(page)).toEqual({...before,songbooks:[{...book,name:'Nytt boknavn'}]});
  await page.locator('#songbook-my-book').click();await page.locator('#song-list .song-choice').click();await tool(page,'Tittel');await fillValue(page,'Tittel','Ny sangtittel');
  await expect.poll(async()=>(await snapshot(page)).songs[0].title).toBe('Ny sangtittel');const edited=await snapshot(page);
  expect(edited.songs).toEqual([{...song,title:'Ny sangtittel',original:song.original.replace('Behold sangen','Ny sangtittel')}]);expect(edited.sync).toEqual(before.sync);expect(edited.personal).toEqual(before.personal);expect(edited.setlists).toEqual(before.setlists);
  await goSongs(page);await importSong(page,'ny.txt','{t: Ny lokal sang}\nOrd');const imported=await snapshot(page);expect(imported.version).toBe(4);expect(imported.songs).toHaveLength(2);expect(imported.songs.find(s=>s.id!==song.id).songbookId).toBe(book.id);expect(imported.sync).toEqual(before.sync);expect(imported.setlists).toEqual(before.setlists);
});

for(const [version,incompatible] of [[5,false],[4,true]])test(`unsupported database v${version}, invalid keys ${incompatible}, stays unchanged with an accurate error`,async({page})=>{
  const before=await seed(page,version,incompatible);await page.goto(url);await expect(page.locator('#retry-storage')).toBeVisible();await expect(page.locator('#library-status')).toContainText('nyere apputgave');await expect(page.locator('#library-status')).not.toContainText('nettleseren tillater');await expect(page.locator('#add-song')).toBeDisabled();expect(await snapshot(page)).toEqual(before);
  await page.locator('#retry-storage').click();await expect(page.locator('#retry-storage')).toBeVisible();expect(await snapshot(page)).toEqual(before);
});
