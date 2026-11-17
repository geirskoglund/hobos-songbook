import {test,expect} from '@playwright/test';
import {dropboxMock} from './dropbox-mock.mjs';
import {openMenu} from './song-helpers.mjs';
test.use({serviceWorkers:'block'});
const url='/hobos-songbook/test/';
async function state(page){return page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songs','personal','songbooks','sync']),data={};for(const name of ['songs','personal','songbooks','sync']){const q=tx.objectStore(name).getAll();q.onsuccess=()=>data[name]=q.result;}tx.oncomplete=()=>{db.close();resolve(data);};};}));}
const account=data=>data.sync.find(row=>row.id.startsWith('private-account-v1:'));
async function syncPage(page){await openMenu(page);await page.locator('#main-menu').getByRole('button',{name:'Synkronisering',exact:true}).click();await expect(page.locator('#dropbox-sync')).toBeEnabled();}
async function synchronize(page){await page.locator('#dropbox-sync').click();await expect(page.locator('#dropbox-sync')).toBeEnabled({timeout:30000});}
async function setup(page,context){const mock=await dropboxMock(context);await page.goto(url);await syncPage(page);await expect.poll(async()=>account(await state(page))?.pending).toBe(false);return mock;}
async function mutate(page,mode,count=12){await page.evaluate(({mode,count})=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songs','personal','songbooks','sync'],'readwrite'),store=tx.objectStore('sync'),q=store.get('private-local-v1');q.onsuccess=()=>{const j=q.result??{id:'private-local-v1',version:1,generation:0,deletedBooks:{},sessions:{}};j.generation++;if(mode==='transfer'){j.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};tx.objectStore('songbooks').delete('standard');}store.put(j);};if(mode==='seed'){for(let i=0;i<4;i++)tx.objectStore('songbooks').put({id:'book-'+i,name:'Book '+i});for(let i=0;i<count;i++){const id='bulk-'+i;tx.objectStore('songs').put({id,songbookId:'standard',title:'Song '+i,key:null,original:'{t: Song '+i+'}\nText',origin:{kind:'local',filename:'Song '+i+'.cho',importedAt:''}});tx.objectStore('personal').put({songId:id,version:3,chorus:{},...(i%2?{capo:3}:{})});}}if(mode==='transfer'){const songs=tx.objectStore('songs').getAll();songs.onsuccess=()=>{for(const song of songs.result)tx.objectStore('songs').put({...song,songbookId:'book-0'});};}tx.oncomplete=()=>{db.close();resolve();};};}),{mode,count});}
const manifest=mock=>JSON.parse(mock.find('/.app/library.json').text);
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('all namespace mutations: grouped layouts, existing file transfers and historical folder archival use supported batch routes',async({page,context})=>{
 const mock=await setup(page,context),start=mock.calls.length;await mutate(page,'seed',100);await synchronize(page);const before=manifest(mock),saved=await state(page),created=mock.calls.slice(start);
 expect(created.filter(call=>call.endpoint.endsWith('/create_folder_batch')).some(call=>call.args.paths.length>=16)).toBe(true);expect(created.filter(call=>call.endpoint.endsWith('/create_folder_v2'))).toHaveLength(0);
 const transferStart=mock.calls.length;await mutate(page,'transfer');await synchronize(page);const after=manifest(mock),calls=mock.calls.slice(transferStart);
 expect(calls.filter(call=>call.endpoint.endsWith('/move_batch_v2')).map(call=>call.args.entries.length)).toEqual([100,1]);
 expect(calls.filter(call=>call.endpoint.endsWith('/get_metadata'))).toHaveLength(0);expect(calls.length).toBeLessThan(30);
 expect(calls.filter(call=>call.endpoint.endsWith('/delete_batch'))).toHaveLength(0);expect(after.books.standard.archive.done).toBe(true);expect(mock.find(after.books.standard.archive.path+'/Originals')).toBeTruthy();
 expect(calls.filter(call=>call.endpoint.endsWith('/move_v2')||call.endpoint.endsWith('/delete_v2'))).toHaveLength(0);
 for(const [id,link]of Object.entries(after.songs)){expect(link.fileId).toBe(before.songs[id].fileId);expect(link.songbookId).toBe('book-0');expect(mock.find(link.fileId).path_display).toBe(link.path);}
 expect((await state(page)).personal).toEqual(saved.personal);expect(account(await state(page)).pending).toBe(false);expect(mock.find('/Songbooks/Standard')).toBeUndefined();
});

test('lost personal cleanup reply: local F57 is committed, missing sidecars are accepted and the same batch resumes after reload',async({page,context})=>{
 const mock=await setup(page,context);await mutate(page,'seed');await synchronize(page);const book=manifest(mock).books.standard;for(const [key,value]of [...mock.entries])if(value.path_display===book.path||value.path_display.startsWith(book.path+'/'))mock.entries.delete(key);
 mock.loseDeleteReply();const start=mock.calls.length;await synchronize(page);await expect(page.locator('#sync-status')).toContainText('SYNC-002');let data=await state(page);expect(data.songs).toHaveLength(0);expect(data.personal).toHaveLength(0);expect(data.songbooks.some(book=>book.id==='standard')).toBe(false);expect(account(data).namespaceJob.kind).toBe('delete');
 await page.reload();await syncPage(page);await synchronize(page);data=await state(page);expect(account(data).pending).toBe(false);expect(account(data).namespaceJob).toBeUndefined();expect(data.songs).toHaveLength(0);
 const calls=mock.calls.slice(start);expect(calls.filter(call=>call.endpoint.endsWith('/delete_batch')).every(call=>call.args.entries.length===12)).toBe(true);expect(calls.filter(call=>call.endpoint.endsWith('/delete_v2'))).toHaveLength(0);
});

test('asynchronous folder batches are checked without relaunch; lost completed folder replies resume by confirmed parent and identity',async({page,context})=>{
 const mock=await setup(page,context);mock.asyncNamespace('folders',1);await mutate(page,'seed',0);const start=mock.calls.length;await synchronize(page);
 expect(mock.calls.slice(start).filter(call=>call.endpoint.endsWith('/create_folder_batch/check'))).toHaveLength(2);expect(account(await state(page)).pending).toBe(false);
 // A distinct new root is created by an accepted request whose response is lost.
 await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songbooks','sync'],'readwrite');tx.objectStore('songbooks').put({id:'lost',name:'Lost response'});const q=tx.objectStore('sync').get('private-local-v1');q.onsuccess=()=>tx.objectStore('sync').put({...q.result,generation:(q.result?.generation??0)+1});tx.oncomplete=()=>{db.close();resolve();};};}));
 mock.loseFoldersReply();await synchronize(page);await expect(page.locator('#sync-status')).toContainText('SYNC-002');const id=mock.find('/Songbooks/Lost response').id;await page.reload();await syncPage(page);await synchronize(page);expect(manifest(mock).books.lost.folderId).toBe(id);expect(account(await state(page)).pending).toBe(false);
});

test('async delete receipt survives a local generation change and resumes the same server job',async({page,context})=>{
 const mock=await setup(page,context);await mutate(page,'seed',3);await synchronize(page);const book=manifest(mock).books.standard;for(const [key,value]of [...mock.entries])if(value.path_display===book.path||value.path_display.startsWith(book.path+'/'))mock.entries.delete(key);
 mock.asyncNamespace('delete',0);const release=mock.hold('/delete_batch/check');await page.locator('#dropbox-sync').click();let jobId;try{await expect.poll(async()=>account(await state(page)).namespaceJob?.jobId).toBeTruthy();jobId=account(await state(page)).namespaceJob.jobId;await mutate(page,'generation',0);}finally{release();}
 await expect(page.locator('#dropbox-sync')).toBeEnabled();expect(account(await state(page)).namespaceJob.jobId).toBe(jobId);await synchronize(page);expect(account(await state(page)).pending).toBe(false);expect(mock.calls.filter(call=>call.endpoint.endsWith('/delete_batch'))).toHaveLength(1);
});

test('a generation change after the sent journal commits but before folder launch persists an unsent job across reload',async({page,context})=>{
 const mock=await setup(page,context);await mutate(page,'seed',1);
 await page.evaluate(()=>{
  const transact=IDBDatabase.prototype.transaction,put=IDBObjectStore.prototype.put,interrupted=new WeakSet();let armed=true;
  IDBDatabase.prototype.transaction=function(...args){const tx=transact.apply(this,args);if(tx.mode==='readwrite'&&tx.objectStoreNames.contains('sync'))tx.addEventListener('complete',()=>{if(!interrupted.has(tx))return;window.preflightInterrupted=true;const next=transact.call(this,'sync','readwrite'),q=next.objectStore('sync').get('private-local-v1');q.onsuccess=()=>put.call(next.objectStore('sync'),{...q.result,generation:q.result.generation+1,recoveryRequired:true});},{once:true});return tx;};
  IDBObjectStore.prototype.put=function(value,...args){if(armed&&this.name==='sync'&&value.namespaceJob?.kind==='folders'&&value.namespaceJob.submitted&&value.namespaceJob.entries.some(entry=>entry.path==='/Songbooks/Book 0/Private')){armed=false;interrupted.add(this.transaction);}return put.call(this,value,...args);};
 });
 const start=mock.calls.length;await synchronize(page);expect(await page.evaluate(()=>window.preflightInterrupted)).toBe(true);let data=await state(page);expect(account(data).namespaceJob.submitted).toBe(false);expect(account(data).pending).toBe(true);expect(mock.find('/Songbooks/Book 0/Private')).toBeUndefined();expect(mock.calls.slice(start).filter(c=>c.endpoint.endsWith('/create_folder_batch')).some(c=>c.args.paths.includes('/Songbooks/Book 0/Private'))).toBe(false);
 await page.reload();await syncPage(page);data=await state(page);expect(account(data).namespaceJob.submitted).toBe(false);await synchronize(page);data=await state(page);expect(account(data).pending).toBe(false);expect(account(data).namespaceJob).toBeUndefined();expect(manifest(mock).songs['bulk-0']).toBeTruthy();expect(mock.find('/Songbooks/Book 0/Private')).toBeTruthy();expect(data.songs).toHaveLength(1);
});

test('two independent IndexedDB installations cannot overtake a delayed ID transfer on the same Dropbox backend',async({page,context,browser})=>{
 const mock=await setup(page,context);await mutate(page,'seed',2);await synchronize(page);const otherContext=await browser.newContext({serviceWorkers:'block',baseURL:test.info().project.use.baseURL});
 try{
  const second=await dropboxMock(otherContext,{backend:mock}),other=await otherContext.newPage();await other.goto(url);await syncPage(other);await synchronize(other);expect((await state(other)).songs).toHaveLength(2);expect(account(await state(other)).mutationOwner).not.toBe(account(await state(page)).mutationOwner);
  mock.asyncMove(0,true);await mutate(page,'transfer');await synchronize(page);await expect(page.locator('#sync-status')).toContainText('SYNC-002');expect(account(await state(page)).namespaceJob.submitted).toBe(true);
  await mutate(other,'transfer');const start=second.calls.length;await synchronize(other);expect(second.calls.slice(start).filter(call=>call.endpoint.endsWith('/move_batch_v2'))).toHaveLength(0);expect(account(await state(other)).pending).toBe(true);
  mock.finishMoves();await synchronize(page);await synchronize(other);expect(account(await state(other)).pending).toBe(false);
  for(const link of Object.values(manifest(mock).songs))expect(mock.find(link.fileId).path_display).toBe(link.path);
 }finally{await otherContext.close();}
});

async function localBookChange(page,{book,capo}={}){await page.evaluate(({book,capo})=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songbooks','personal','sync'],'readwrite');if(book)tx.objectStore('songbooks').put(book);if(capo!==undefined){const p=tx.objectStore('personal').get('bulk-0');p.onsuccess=()=>tx.objectStore('personal').put({...p.result,capo});}const q=tx.objectStore('sync').get('private-local-v1');q.onsuccess=()=>tx.objectStore('sync').put({...q.result,generation:q.result.generation+1});tx.oncomplete=()=>{db.close();resolve();};};}),{book,capo});}
for(const offline of [false,true])test(`archive and reuse name: inactive IndexedDB client keeps moved songs and gets the replacement (offline ${offline})`,async({page,context,browser})=>{
 const mock=await setup(page,context);await mutate(page,'seed',2);await synchronize(page);const old=manifest(mock).books.standard;const source=mock.put('/Songbooks/Standard/Originals/unknown.pdf','preserved source'),otherContext=await browser.newContext({serviceWorkers:'block',baseURL:test.info().project.use.baseURL});
 try{
  const second=await dropboxMock(otherContext,{backend:mock}),other=await otherContext.newPage();await other.goto(url);await syncPage(other);await synchronize(other);expect((await state(other)).songs).toHaveLength(2);
  await mutate(page,'transfer');if(!offline)await synchronize(page);await localBookChange(page,{book:{id:'replacement',name:'Standard'}});await synchronize(page);await localBookChange(page,{capo:9});await synchronize(page);
  const m=manifest(mock);expect(m.books.standard.archive.done).toBe(true);expect(m.books.replacement.folderId).not.toBe(old.folderId);expect(mock.find(source.id).path_display).toBe(m.books.standard.archive.path+'/Originals/unknown.pdf');
  await synchronize(other);const data=await state(other);expect(data.songbooks.some(b=>b.id==='standard')).toBe(false);expect(data.songbooks.find(b=>b.id==='replacement').name).toBe('Standard');expect(data.songs.map(s=>s.id).sort()).toEqual(['bulk-0','bulk-1']);expect(data.songs.every(s=>s.songbookId==='book-0')).toBe(true);expect(data.personal.find(p=>p.songId==='bulk-0').capo).toBe(9);expect(account(data).conflicts).toHaveLength(0);expect(account(data).pending).toBe(false);expect(manifest(mock).deletedSongs?.['bulk-0']).toBeUndefined();expect(second.calls.some(c=>c.endpoint.endsWith('/delete_batch'))).toBe(false);
 }finally{await otherContext.close();}
});
