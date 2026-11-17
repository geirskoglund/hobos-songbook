import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,song} from './sync-fixture.mjs';
import {RetrySync,SyncFailure,failureCodes} from '../src/sync/failure.ts';
async function run(f){for(let n=0;n<5;n++)try{return await f.run();}catch(error){if(!(error instanceof RetrySync)||n===4)throw error;}}
const manifest=f=>JSON.parse(f.entries.get('/.app/library.json').text);
function multiple(n=8){const f=fixture();f.change(d=>{d.songs=Array.from({length:n},(_,i)=>({...song('song-'+i),origin:{kind:'local',filename:'Song '+i+'.cho',importedAt:''}}));d.personal=d.songs.map(s=>({songId:s.id,version:3,chorus:{}}));});return f;}
function batchFixture(f){
 const folders=[],deletes=[],moves=[],folder=f.files.folder,remove=f.files.deleteFile,move=f.files.moveBatch;
 f.files.metadata=async path=>{const value=path.startsWith('id:')?[...f.entries.values()].find(e=>e.id===path):f.entries.get(path.toLowerCase());return value?{id:value.id,path:value.path,folder:Boolean(value.folder),...(value.rev?{rev:value.rev}:{})}:null;};
 f.files.createFoldersBatch=async entries=>{folders.push(structuredClone(entries));return{entries:await Promise.all(entries.map(async entry=>({value:await folder(entry.path)})))};};
 f.files.deleteBatch=async entries=>{deletes.push(structuredClone(entries));const results=[];for(const entry of entries){const old=await f.files.metadata(entry.path);if(!old){results.push({failure:{code:failureCodes.missingFile,stage:'dropbox.delete-batch',status:200},missing:true});continue;}if(entry.folder){if((await f.files.list(entry.path)).length)throw Error('Refusing nonempty folder in fixture');f.entries.delete(old.path.toLowerCase());}else await remove(entry.path,entry.rev);results.push({value:old});}return{entries:results};};
 f.files.moveBatch=async entries=>{moves.push(structuredClone(entries));return move(entries);};return{f,folders,deletes,moves};
}
test('namespace batch: several new book layouts use grouped folder creation',async()=>{
 const {f,folders}=batchFixture(fixture());f.change(d=>{d.songbooks=Array.from({length:4},(_,i)=>({id:'book-'+i,name:'Book '+i}));d.songs=[];d.personal=[];});await run(f);
 assert.ok(folders.some(group=>group.length>=4),'new folders must use the documented batch path');
});
test('namespace batch: deleting a master book groups personal cleanup and removes every local member',async()=>{
 const {f,deletes}=batchFixture(multiple());await run(f);const book=manifest(f).books.standard;for(const [key,e]of [...f.entries])if(e.path===book.path||e.path.startsWith(book.path+'/'))f.entries.delete(key);await run(f);
 assert.deepEqual(deletes.filter(group=>group[0].category==='personal').map(group=>group.length),[8]);assert.equal(f.data.songs.length,0);assert.equal(f.data.personal.length,0);assert.equal(f.data.songbooks.length,0);
});
test('namespace batch: master deletion is committed locally even when remote cleanup fails',async()=>{
 const f=multiple();await run(f);const book=manifest(f).books.standard;for(const [key,e]of [...f.entries])if(e.path===book.path||e.path.startsWith(book.path+'/'))f.entries.delete(key);
 const fail=async()=>{throw new SyncFailure({code:failureCodes.network,stage:'dropbox.request'},'simulated transport loss');};f.files.deleteFile=fail;f.files.deleteBatch=fail;
 await assert.rejects(f.run());assert.equal(f.data.songs.length,0);assert.equal(f.data.songbooks.length,0);assert.equal(f.data.state.pending,true);
});
test('namespace batch: transferring existing songs uses one move batch and preserves the physical IDs',async()=>{
 const {f,moves}=batchFixture(multiple(6));f.change(d=>{d.songbooks.push({id:'target',name:'Target'});});await run(f);const before=manifest(f);moves.length=0;
 f.change(d=>{d.songbooks=d.songbooks.filter(book=>book.id!=='standard');for(const song of d.songs)song.songbookId='target';d.journal.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};});await run(f);
 assert.ok(moves.some(group=>group.length===6),'existing files must use the documented move batch');for(const [id,link]of Object.entries(manifest(f).songs)){assert.equal(link.fileId,before.songs[id].fileId);assert.equal(link.songbookId,'target');}
});

test('namespace recovery: lost delete reply leaves F57 committed and resumes after files have already disappeared',async()=>{
 const f=multiple(7);await run(f);const book=manifest(f).books.standard;for(const [key,e]of [...f.entries])if(e.path===book.path||e.path.startsWith(book.path+'/'))f.entries.delete(key);
 const remove=f.files.deleteBatch;let first=true;f.files.deleteBatch=async entries=>{const reply=await remove(entries);if(first){first=false;throw new SyncFailure({code:failureCodes.network,stage:'dropbox.request'},'lost reply');}return reply;};
 await assert.rejects(f.run());assert.equal(f.data.songs.length,0);assert.equal(f.data.personal.length,0);assert.equal(f.data.state.namespaceJob.kind,'delete');await run(f);assert.equal(f.data.state.pending,false);assert.equal(f.data.state.namespaceJob,undefined);
});

test('namespace recovery: several hundred personal files use bounded batches, including missing files from another device',async()=>{
 const {f,deletes}=batchFixture(multiple(205));await run(f);const book=manifest(f).books.standard;
 for(const [key,e]of [...f.entries])if(e.path===book.path||e.path.startsWith(book.path+'/'))f.entries.delete(key);
 const remove=f.files.deleteBatch;let first=true;f.files.deleteBatch=async entries=>{if(first){first=false;f.entries.delete('/.app/songs/song-0.json');}return remove(entries);};
 await run(f);assert.deepEqual(deletes.filter(group=>group[0].category==='personal').map(group=>group.length),[100,100,5]);assert.equal(f.data.state.pending,false);assert.equal(f.data.songs.length,0);
});

test('namespace recovery: an async move receipt survives a new local generation without acknowledging it',async()=>{
 const f=multiple(3);f.change(d=>{d.songbooks.push({id:'target',name:'Target'});});await run(f);const move=f.files.moveBatch;let plan,first=true;
 f.files.moveBatch=async entries=>{if(first){first=false;plan=structuredClone(entries);f.change(d=>{d.personal[0].capo=9;});return{asyncJobId:'saved-job'};}return move(entries);};
 f.change(d=>{for(const song of d.songs)song.songbookId='target';});await assert.rejects(f.run());assert.equal(f.data.state.namespaceJob.jobId,'saved-job');assert.notEqual(f.data.state.localGeneration,f.data.journal.generation);
 f.files.checkMoveBatch=async id=>{assert.equal(id,'saved-job');return move(plan);};await run(f);assert.equal(f.data.state.pending,false);assert.equal(JSON.parse(f.entries.get('/.app/songs/song-0.json').text).data.capo,9);
});

for(const status of [403,429])test(`namespace recovery: explicit HTTP ${status} rejection can retry rather than being held as an unknown launch`,async()=>{
 const f=multiple(2);f.change(d=>d.songbooks.push({id:'target',name:'Target'}));await run(f);const move=f.files.moveBatch;let first=true;
 f.files.moveBatch=async entries=>{if(first){first=false;throw new SyncFailure({code:status===403?failureCodes.permission:failureCodes.throttled,stage:'dropbox.request',status},'rejected');}return move(entries);};f.change(d=>{for(const song of d.songs)song.songbookId='target';});await assert.rejects(f.run());assert.equal(f.data.state.namespaceJob.submitted,false);await run(f);assert.equal(f.data.state.pending,false);
});

test('namespace recovery: HTTP200 partial write contention retries only failed entries',async()=>{
 const f=multiple(3);f.change(d=>d.songbooks.push({id:'target',name:'Target'}));await run(f);const move=f.files.moveBatch,groups=[];let first=true;
 f.files.moveBatch=async entries=>{groups.push(entries.length);if(first){first=false;const reply=await move(entries.slice(1));return{entries:[{failure:{code:failureCodes.throttled,stage:'dropbox.move-batch',status:200}},...reply.entries]};}return move(entries);};f.change(d=>{for(const song of d.songs)song.songbookId='target';});await run(f);assert.deepEqual(groups,[3,1]);assert.equal(f.data.state.pending,false);
});

test('namespace authority: a forged personal deletion cannot delete an active song file',async()=>{
 const f=multiple(1);await run(f);const link=manifest(f).songs['song-0'],value=f.entries.get(link.path.toLowerCase());
 f.data.state.namespaceJob={id:crypto.randomUUID(),kind:'delete',entries:[{key:'personal:song-0',path:link.fileId,fileId:link.fileId,rev:value.rev,sourcePath:'/.app/songs/song-0.json',category:'personal'}],attempt:0};
 await assert.rejects(f.run(),error=>error.info?.code===failureCodes.manifest);assert.equal(f.entries.get(link.path.toLowerCase()).id,link.fileId);assert.equal(f.data.songs.length,1);
});

test('namespace fence: a second device cannot overtake an unknown ID move, including a late first server effect',async()=>{
 const a=fixture(),b=fixture();a.change(d=>{d.songbooks=[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];d.songs=[{...song('one','a'),origin:{kind:'local',filename:'Song.cho',importedAt:''}}];});await run(a);
 b.data=a.data;delete b.data.state.mutationOwner;delete b.data.state.mutationPending;
 const move=a.files.moveBatch;let delayed,launches=0;a.files.moveBatch=async entries=>{if(entries.some(e=>e.to==='/Songbooks/B/Private/Song.cho')){launches++;delayed=structuredClone(entries);throw new SyncFailure({code:failureCodes.network,stage:'dropbox.request'},'unknown launch');}return move(entries);};
 a.change(d=>{d.songs[0].songbookId='b';});await assert.rejects(a.run());b.change(d=>{d.songs[0].songbookId='c';});
 const runB=()=>import('../src/sync/engine.ts').then(({syncEngine})=>syncEngine(b.storage,a.files,'account',{valid:()=>true,changed(){}}).run(true));
 await assert.rejects(runB(),error=>error.reason==='remote');assert.equal(manifest(a).songs.one.songbookId,'a');await assert.rejects(a.run(),error=>error.info?.action==='check-move');assert.equal(launches,1,'unknown ID moves are never replayed');
 await move(delayed);await run(a);await assert.rejects(runB(),error=>error.info?.code===failureCodes.bookChanges);assert.equal(manifest(a).songs.one.songbookId,'b');assert.equal([...a.entries.values()].find(e=>e.id===manifest(a).songs.one.fileId).path,manifest(a).songs.one.path);
});

test('namespace recovery: a known completed move with an omitted path cannot replay after a metadata guard interrupts',async()=>{
 const f=multiple(1);f.change(d=>d.songbooks.push({id:'target',name:'Target'}));await run(f);const move=f.files.moveBatch;let count=0;
 f.files.moveBatch=async entries=>{count++;const reply=await move(entries);for(const result of reply.entries)if('value'in result)delete result.value.path;f.change(()=>{});return reply;};
 f.change(d=>{d.songs[0].songbookId='target';});await assert.rejects(f.run());assert.ok(f.data.state.namespaceJob.reply?.entries);const id=f.data.state.namespaceJob.entries[0].fileId;await f.files.move(id,'/Songbooks/Target/Shared/moved.cho');
 f.files.moveBatch=async entries=>{count++;return move(entries);};await run(f);assert.equal(count,1);assert.ok(f.entries.has('/songbooks/target/shared/moved.cho'));
});

test('namespace recovery: a definitively rejected transfer is recomputed after the file was moved to Shared',async()=>{
 const f=multiple(1);f.change(d=>d.songbooks.push({id:'target',name:'Target'}));await run(f);const move=f.files.moveBatch;let first=true;f.files.moveBatch=async entries=>{if(first){first=false;throw new SyncFailure({code:failureCodes.permission,stage:'dropbox.request',status:403},'rejected');}return move(entries);};
 f.change(d=>{d.songs[0].songbookId='target';});await assert.rejects(f.run());const id=f.data.state.namespaceJob.entries[0].fileId;await f.files.move(id,'/Songbooks/Standard/Shared/moved.cho');await run(f);assert.ok(f.entries.has('/songbooks/standard/shared/moved.cho'));assert.equal(f.data.state.held['song-0'],true);
});

test('namespace recovery: external rename between folder creation and its receipt preserves the sent component basis',async()=>{
 const f=fixture(),create=f.files.createFoldersBatch;let renamed=false;
 f.files.createFoldersBatch=async entries=>{const reply=await create(entries);if(!renamed&&entries.some(entry=>entry.path==='/Songbooks/Standard')){renamed=true;const entry=reply.entries[entries.findIndex(entry=>entry.path==='/Songbooks/Standard')].value;await f.files.move(entry.id,'/Songbooks/DropboxName');}return reply;};
 await run(f);assert.equal(manifest(f).books.standard.name,'DropboxName');assert.equal(f.data.songbooks[0].name,'DropboxName');assert.equal(f.entries.has('/songbooks/standard'),false);assert.equal(f.data.state.pending,false);
});

test('namespace recovery: observing a later content revision during move cannot turn it into processed bytes',async()=>{
 const f=multiple(1);f.change(d=>d.songbooks.push({id:'target',name:'Target'}));await run(f);const move=f.files.moveBatch;let changed=false;f.files.moveBatch=async entries=>{const reply=await move(entries);if(!changed){changed=true;const old=await f.files.read(entries[0].fileId);await f.files.write(old.path,'{t: External edit}\nNew words',old.rev);}return reply;};
 f.change(d=>{d.songs[0].songbookId='target';});await run(f);assert.equal(f.data.state.pending,true);await run(f);assert.equal(f.data.songs[0].original,'{t: External edit}\nNew words');assert.equal(f.data.state.pending,false);
});
