import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,song} from './sync-fixture.mjs';
import {RetrySync,BatchJobFailed} from '../src/sync/failure.ts';
async function run(f,manual=true){for(let n=0;n<4;n++)try{return await f.run(manual);}catch(e){if(!(e instanceof RetrySync)||n===3)throw e;}}
function library(n){const f=fixture();f.change(d=>{d.songbooks.push({id:'target',name:'Target'});d.songs=Array.from({length:n},(_,i)=>({...song('song-'+i),origin:{kind:'local',filename:'Song '+i+'.cho',importedAt:''}}));d.personal=d.songs.map(s=>({songId:s.id,version:3,chorus:{}}));});return f;}
for(const n of [1,100])test(`metadata budget: transferring ${n} files uses phase snapshots, not per-file metadata`,async()=>{
 const f=library(n);await run(f);const before=f.data.state.manifest.songs,start=f.calls.length;f.change(d=>{for(const s of d.songs)s.songbookId='target';d.songbooks=d.songbooks.filter(b=>b.id!=='standard');d.journal.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};});await run(f,false);
 const calls=f.calls.slice(start);assert.equal(calls.filter(c=>c[0]==='metadata').length,0);assert.ok(calls.filter(c=>c[0]==='changes').length<=12);assert.deepEqual(calls.filter(c=>c[0]==='moveBatch').map(c=>c[1]),[n]);
 for(const [id,link]of Object.entries(f.data.state.manifest.songs)){assert.equal(link.fileId,before[id].fileId);assert.equal(link.songbookId,'target');}assert.equal(f.data.state.pending,false);
});
test('metadata budget: 100 personal deletions use aggregate metadata and one batch',async()=>{
 const f=library(100);await run(f);const book=f.data.state.manifest.books.standard;for(const [key,e]of [...f.entries])if(e.path===book.path||e.path.startsWith(book.path+'/'))f.entries.delete(key);const start=f.calls.length;await run(f);
 const calls=f.calls.slice(start);assert.equal(calls.filter(c=>c[0]==='metadata').length,0);assert.ok(calls.filter(c=>c[0]==='changes').length<=8);assert.ok(calls.some(c=>c[0]==='deleteBatch'&&c[1]===100));assert.equal(f.data.songs.length,0);
});
test('metadata budget: unchanged retained Originals is not repeatedly checked; new subtree changes reactivate cleanup',async()=>{
 const f=library(1);await run(f);await f.files.write('/Songbooks/Standard/Originals/retained.txt','preserved',null);f.change(d=>{d.songs[0].songbookId='target';d.songbooks=d.songbooks.filter(b=>b.id!=='standard');d.journal.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};});await run(f,false);
 let start=f.calls.length;f.change(d=>d.personal[0].capo=5);await run(f,false);let calls=f.calls.slice(start);assert.equal(calls.filter(c=>c[0]==='metadata'||c[0]==='list').length,0);assert.equal(calls.filter(c=>c[0]==='changes').length,1);assert.ok(f.entries.has('/songbooks/standard/originals/retained.txt'));
 await f.files.deleteFile('/Songbooks/Standard/Originals/retained.txt',f.entries.get('/songbooks/standard/originals/retained.txt').rev);f.change(d=>d.personal[0].capo=6);await run(f,false);assert.equal(f.entries.has('/songbooks/standard'),false);
});
test('cleanup follows a retained deleted book by ID through an external rename, then removes the empty tree',async()=>{
 const f=library(1);await run(f);await f.files.write('/Songbooks/Standard/Originals/retained.txt','preserved',null);f.change(d=>{d.songs[0].songbookId='target';d.songbooks=d.songbooks.filter(b=>b.id!=='standard');d.journal.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};});await run(f,false);
 const book=f.data.state.manifest.books.standard;await f.files.move(book.folderId,'/Songbooks/Renamed');f.change(d=>d.personal[0].capo=5);await run(f,false);const retained=f.entries.get('/songbooks/renamed/originals/retained.txt');assert.ok(retained);await f.files.deleteFile(retained.path,retained.rev);f.change(d=>d.personal[0].capo=6);await run(f,false);assert.equal(f.entries.has('/songbooks/renamed'),false);assert.equal(f.data.state.pending,false);
});
test('cleanup proof cannot acknowledge a last-file deletion between child and parent snapshots',async()=>{
 const f=library(1);await run(f);const path='/Songbooks/Standard/Originals/retained.txt';await f.files.write(path,'preserved',null);f.change(d=>{d.songs[0].songbookId='target';d.songbooks=d.songbooks.filter(b=>b.id!=='standard');d.journal.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};});await run(f,false);
 await f.files.write(path,'external edit',f.entries.get(path.toLowerCase()).rev);const changes=f.files.changes;let phases=0;f.files.changes=async cursor=>{const reply=await changes(cursor);if(++phases===2)await f.files.deleteFile(path,f.entries.get(path.toLowerCase()).rev);return reply;};f.change(d=>d.personal[0].capo=5);await run(f,false);assert.equal(f.entries.has('/songbooks/standard'),false);assert.equal(f.data.state.pending,false);
});
test('cursor reset rechecks retained cleanup even when domain metadata compares equal',async()=>{
 const f=library(1);await run(f);await f.files.write('/Songbooks/Standard/Originals/retained.txt','preserved',null);f.change(d=>{d.songs[0].songbookId='target';d.songbooks=d.songbooks.filter(b=>b.id!=='standard');d.journal.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};});await run(f,false);
 const changes=f.files.changes;let calls=0;f.files.changes=async cursor=>changes(++calls===1?undefined:cursor);await run(f);assert.ok(calls>1,'reset must not take the unchanged fast path with old cleanup proof');assert.equal(f.data.state.pending,false);assert.ok(f.entries.has('/songbooks/standard/originals/retained.txt'));
});
test('staging cleanup uses metadata, never owned file bodies',async()=>{
 const f=library(20),write=f.files.write;let fail=true;f.files.write=async(...args)=>{if(fail&&args[0]==='/.app/upload-index.json')throw Error('synthetic interruption');return write(...args);};await run(f);assert.equal(f.data.state.pending,true);assert.equal(Object.keys(f.data.state.uploads).length,20);fail=false;
 const book=f.data.state.folders.standard;for(const [key,e]of [...f.entries])if(e.path===book.path||e.path.startsWith(book.path+'/'))f.entries.delete(key);
 const read=f.files.read;f.files.read=async path=>{assert.ok(!path.startsWith('/.app/uploads/')&&!path.startsWith('id:'),'cleanup must use metadata, not download');return read(path);};await run(f);assert.equal(f.data.songs.length,0);assert.equal([...f.entries.values()].some(e=>e.path.startsWith('/.app/uploads/')),false);
});
test('post-move metadata failure retains the complete receipt and never relaunches the ID move',async()=>{
 const f=library(3);await run(f);const move=f.files.moveBatch,changes=f.files.changes;let fail=false,launches=0;
 f.files.moveBatch=async entries=>{launches++;const reply=await move(entries);fail=true;return reply;};f.files.changes=async(...args)=>{if(fail)throw Error('incomplete metadata page');return changes(...args);};f.change(d=>{for(const s of d.songs)s.songbookId='target';});await assert.rejects(run(f));assert.ok(f.data.state.namespaceJob.reply.entries);assert.equal(launches,1);
 fail=false;await run(f);assert.equal(launches,1);assert.equal(f.data.state.pending,false);assert.ok(Object.values(f.data.state.manifest.songs).every(s=>s.songbookId==='target'));
});
for(const persistent of [false,true])test(`terminal delete-job contention is bounded and retains local F57 (persistent ${persistent})`,async()=>{
 const f=library(5);await run(f);const book=f.data.state.manifest.books.standard;for(const [key,e]of [...f.entries])if(e.path===book.path||e.path.startsWith(book.path+'/'))f.entries.delete(key);
 const remove=f.files.deleteBatch;let launches=0;f.files.deleteBatch=async entries=>{launches++;return persistent||launches===1?{asyncJobId:'job-'+launches}:remove(entries);};f.files.checkDeleteBatch=async()=>{throw new BatchJobFailed({code:'SYNC-007',stage:'dropbox.delete-batch',status:200,limitReason:'too_many_write_operations',retryAfterMs:0},'synthetic lock contention');};
 if(persistent){await assert.rejects(run(f),e=>e.info.code==='SYNC-007');assert.equal(launches,3);assert.equal(f.data.state.pending,true);}else{await run(f);assert.equal(launches,2);assert.equal(f.data.state.pending,false);}assert.equal(f.data.songs.length,0);assert.equal(f.data.personal.length,0);
});
test('new-file async placement receipt survives a generation change before any post-check',async()=>{
 const f=library(1),move=f.files.moveBatch;let plan,launches=0;
 f.files.moveBatch=async entries=>{launches++;plan=structuredClone(entries);f.change(d=>d.personal[0].capo=9);return{asyncJobId:'accepted-placement'};};await assert.rejects(run(f));assert.equal(f.data.state.placement.jobId,'accepted-placement');assert.equal(launches,1);
 f.files.checkMoveBatch=async id=>{assert.equal(id,'accepted-placement');return move(plan);};await run(f);assert.equal(launches,1);assert.equal(f.data.state.pending,false);assert.equal(JSON.parse(f.entries.get('/.app/songs/song-0.json').text).data.capo,9);
});
