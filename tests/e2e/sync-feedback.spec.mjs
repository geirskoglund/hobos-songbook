import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {dropboxMock} from './dropbox-mock.mjs';
import {openMenu,goSongs} from './song-helpers.mjs';
test.use({serviceWorkers:'block'});
const url='/hobos-songbook/test/';
const originals=['{t: Banner of Heaven}\n{k: Am}\n[C]Version A','{t: Banner of Heaven}\n{k: C}\n[G]Version B','{t: Bronco Billy}\n[C]Third song'];
const filenames=['banner of heaven.txt','Banner_of_Heaven_ChordPro_test.cho','Bronco Billy.txt'];
const person=(id,capo)=>({songId:id,version:3,chorus:{},capo});
const library=mock=>JSON.parse(mock.find('/.app/library.json')?.text??'{"songs":{}}');
const privateFiles=mock=>[...mock.entries.values()].filter(e=>/\/Private\/[^/]+\.cho$/i.test(e.path_display));
async function state(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songs','personal','songbooks','sync']),out={};for(const name of ['songs','personal','songbooks','sync']){const q=tx.objectStore(name).getAll();q.onsuccess=()=>out[name]=q.result;}tx.oncomplete=()=>{db.close();resolve(out);};tx.onabort=()=>reject(tx.error);};}));}
const account=data=>data.sync.find(s=>s.id.startsWith('private-account-v1:'));
async function seed(page,prefix,sources=originals,names=filenames){
 await page.goto(url);await expect(page.locator('#add-song')).toBeEnabled();
 await page.evaluate(({prefix,sources,names})=>new Promise((resolve,reject)=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songs','personal','songbooks','sync'],'readwrite');for(const name of ['songs','personal','songbooks','sync'])tx.objectStore(name).clear();tx.objectStore('songbooks').put({id:prefix+'book',name:'Hobos'});for(const [i,original]of sources.entries()){const id=prefix+i;tx.objectStore('songs').put({id,songbookId:prefix+'book',original,title:original.match(/\{t: ([^}]+)\}/)[1],key:null,origin:{kind:'local',filename:names[i],importedAt:prefix}});tx.objectStore('personal').put({songId:id,version:3,chorus:{},capo:2});}tx.objectStore('sync').put({id:'private-local-v1',version:1,generation:1,deletedBooks:{},sessions:{}});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}),{prefix,sources,names});
}
async function connect(page){await page.evaluate(()=>localStorage.setItem('hobos-songbook-test:dropbox-auth-v1',JSON.stringify({version:1,accountId:'dbid:fixture',name:'Fixture',email:'fixture@example.invalid',accessToken:'fixture-access',refreshToken:'fixture-refresh',expires:Date.now()+3600000})));await page.reload();await syncPage(page);}
async function syncPage(page){await openMenu(page);await page.locator('#main-menu').getByRole('button',{name:'Synkronisering',exact:true}).click();await expect(page.locator('#dropbox-sync')).toBeEnabled();}
async function sync(page){await page.locator('#dropbox-sync').click();await expect(page.locator('#dropbox-sync')).toBeEnabled();}
function remote(mock,indices){
 for(const path of ['/.app','/.app/songs','/Songbooks','/Songbooks/Hobos'])if(!mock.find(path))mock.put(path,'',true);
 for(const name of ['Private','Shared','Import','Originals'])if(!mock.find('/Songbooks/Hobos/'+name))mock.put('/Songbooks/Hobos/'+name,'',true);
 const m={version:1,books:{'cloud-book':{id:'cloud-book',name:'Hobos',path:'/Songbooks/Hobos',folderId:mock.find('/Songbooks/Hobos').id}},songs:{...library(mock).songs}};
 for(const i of indices){const id='cloud-'+i,path='/Songbooks/Hobos/Private/'+filenames[i].replace(/\.[^.]+$/,'.cho'),file=mock.find(path)??mock.put(path,originals[i]);m.songs[id]={id,songbookId:'cloud-book',fileId:file.id,path,origin:{kind:'local',filename:filenames[i],importedAt:'cloud'}};mock.put('/.app/songs/'+id+'.json',JSON.stringify({version:1,songId:id,original:{rev:file.rev,hash:createHash('sha256').update(originals[i]).digest('hex')},data:person(id,5)}));}
 mock.put('/.app/library.json',JSON.stringify(m));
}
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('feedback F65: interrupted first coordination and all-Dropbox choices preserve exactly two distinct Banner versions',async({page,context})=>{
 const mock=await dropboxMock(context,{connected:false});remote(mock,[1]);
 await seed(page,'local-',[originals[0],originals[1]+'\nLocal edit',originals[2]]);
 mock.fault('/upload_session/append_batch',0);await connect(page);await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-002');
 expect(Object.values(account(await state(page)).reservations).some(link=>!link.fileId)).toBe(true);
 remote(mock,[0,2]);await page.reload();await syncPage(page);await page.locator('#dropbox-sync').click();
 let choices=0;const dialog=page.getByRole('dialog',{name:'Synkroniseringskonflikt',exact:true});
 while(true){await expect.poll(async()=>await dialog.isVisible()||await page.locator('#dropbox-sync').isEnabled()).toBe(true);if(!await dialog.isVisible())break;expect(++choices).toBeLessThan(10);await dialog.getByRole('button',{name:'Dropbox',exact:true}).click();}
 expect(choices).toBeGreaterThan(0);await sync(page);await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
 const data=await state(page);expect(data.songs.map(s=>s.id).sort()).toEqual(['local-0','local-1','local-2']);expect(data.songs.map(s=>s.original).sort()).toEqual([...originals].sort());expect(data.personal.every(p=>p.capo===5)).toBe(true);expect(privateFiles(mock)).toHaveLength(3);expect(Object.keys(library(mock).songs)).toHaveLength(3);
 await page.reload();await syncPage(page);await sync(page);expect((await state(page)).songs).toHaveLength(3);expect(privateFiles(mock)).toHaveLength(3);
});

test('feedback: pending txt provenance across two real IndexedDB libraries retains one Private song and one Originals copy',async({page,context,browser})=>{
 const mock=await dropboxMock(context,{connected:false}),text='{t: Same song}\n[C]Words',otherContext=await browser.newContext({serviceWorkers:'block'});
 try{
  await seed(page,'owner-',[text],['Same song.txt']);mock.fault('/upload',0,0,{path:'/.app/library.json'});await connect(page);await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-002');
  expect(mock.find('/.app/library.json')).toBeUndefined();expect(privateFiles(mock)).toHaveLength(1);expect(Object.values(JSON.parse(mock.find('/.app/upload-index.json').text).entries).some(c=>c.song.origin.filename==='Same song.txt')).toBe(true);
  const other=await otherContext.newPage();await dropboxMock(otherContext,{connected:false,backend:mock});await seed(other,'other-',[text],['Same song.txt']);await connect(other);await sync(other);
  expect((await state(other)).songs.map(s=>s.id)).toEqual(['other-0']);expect(account(await state(other)).pending).toBe(true);expect(account(await state(other)).lastManual).toBeUndefined();expect(privateFiles(mock)).toHaveLength(1);
  await sync(page);await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');await sync(other);await expect(other.locator('#sync-status')).toContainText('Sist synkronisert:');
  expect((await state(other)).songs.map(s=>s.id)).toEqual(['other-0']);expect(Object.keys(library(mock).songs)).toEqual(['owner-0']);expect(privateFiles(mock).map(e=>e.path_display)).toEqual(['/Songbooks/Hobos/Private/Same song.cho']);expect([...mock.entries.values()].filter(e=>/\/Originals\/[^/]+$/.test(e.path_display)).map(e=>e.path_display)).toEqual(['/Songbooks/Hobos/Originals/Same song.txt']);
 }finally{await otherContext.close();}
});

test('feedback: lost async move launch resumes after reload and a late job cannot move the final file twice',async({page,context})=>{
 const mock=await dropboxMock(context,{connected:false});await seed(page,'local-',['{t: Song v2.0}\nWords'],['']);mock.asyncMove(100,true);await connect(page);await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-002');
 const before=account(await state(page));expect(before.placement.entries[0].from).toMatch(/^\/\.app\/uploads\//);expect(before.placement.entries[0].toReference).toMatch(/^id:/);expect(mock.find('/.app/library.json')).toBeUndefined();expect(mock.moveJobs.size).toBe(1);
 await page.reload();await syncPage(page);await sync(page);await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');
 const link=library(mock).songs['local-0'];expect(link.path).toBe('/Songbooks/Hobos/Private/Song v2.0.cho');mock.finishMoves();await sync(page);
 expect(library(mock).songs['local-0'].fileId).toBe(link.fileId);expect(privateFiles(mock)).toHaveLength(1);expect([...mock.entries.values()].filter(e=>e.path_display.includes('/Originals/')&&!e['.tag'].includes('folder'))).toHaveLength(0);expect(account(await state(page)).pending).toBe(false);await goSongs(page);await expect(page.locator('#song-list .song-choice')).toHaveCount(1);
});

test('feedback: a stale mutex CAS retries with the completed owner manifest and cannot duplicate a txt import',async({page,context,browser})=>{
 const mock=await dropboxMock(context,{connected:false}),text='{t: Same song}\nWords',otherContext=await browser.newContext({serviceWorkers:'block'});let release;
 try{
  await seed(page,'owner-',[text],['Same song.txt']);mock.fault('/upload',0,0,{path:'/.app/library.json'});await connect(page);await expect(page.locator('#sync-status')).toContainText('Feilkode SYNC-002');
  const other=await otherContext.newPage(),peer=await dropboxMock(otherContext,{connected:false,backend:mock});await seed(other,'other-',[text],['Same song.txt']);release=peer.hold('/upload',false,'/.app/mutation.json');
  const connecting=connect(other);await expect.poll(()=>peer.calls.some(c=>c.endpoint.endsWith('/upload')&&c.args.path==='/.app/mutation.json')).toBe(true);
  await sync(page);await expect(page.locator('#sync-status')).toContainText('Sist synkronisert:');expect(JSON.parse(mock.find('/.app/upload-index.json').text).entries).toEqual({});release();await connecting;
  await sync(other);await expect(other.locator('#sync-status')).toContainText('Sist synkronisert:');expect((await state(other)).songs.map(s=>s.id)).toEqual(['other-0']);expect(privateFiles(mock)).toHaveLength(1);expect(Object.keys(library(mock).songs)).toEqual(['owner-0']);
 }finally{release?.();await otherContext.close();}
});
