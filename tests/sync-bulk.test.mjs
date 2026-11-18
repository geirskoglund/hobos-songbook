import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,song} from './sync-fixture.mjs';
import {SyncFailure,failureCodes,RetrySync} from '../src/sync/failure.ts';
import {maxFileBytes} from '../src/sync/limits.ts';
import {syncEngine} from '../src/sync/engine.ts';

function bulkFixture(count=20){
  const f=fixture(),sessions=new Map(),batches=[],singles=[];let sequence=0,committing=false;
  f.change(d=>{d.songs=Array.from({length:count},(_,i)=>({...song('bulk-'+i,'standard',`{t: Song ${i}}\nWords`),origin:{kind:'local',filename:`song-${i}.cho`,importedAt:'2026-01-01'}}));d.personal=d.songs.map(s=>({songId:s.id,version:3,chorus:{},capo:3}));});
  const write=f.files.write;
  f.files.write=async(...args)=>{if(!committing)singles.push(args[0]);return write(...args);};
  f.files.beginUpload=async text=>{const session={id:'session-'+(++sequence),created:Date.now()};sessions.set(session.id,text);return session;};
  f.files.commitBatch=async jobs=>{
    batches.push(jobs.map(job=>structuredClone(job)));const values=[];committing=true;
    try{for(const job of jobs){assert.equal(sessions.get(job.session.id),job.text);try{values.push({value:await f.files.write(job.path,job.text,job.rev)});}catch(error){if(error.message==='409')values.push({failure:{code:failureCodes.changed,stage:'test.batch',status:409}});else throw error;}}}finally{committing=false;}
    return values;
  };
  return Object.assign(f,{sessions,batches,singles});
}
async function retry(f){for(let n=0;n<3;n++)try{return await f.run();}catch(error){if(!(error instanceof RetrySync)||n===2)throw error;}}

test('bulk: hundreds of songs use bounded batch commits and sidecars reference confirmed content revisions',async()=>{
  const f=bulkFixture(240);await f.run();
  assert.deepEqual(f.batches.map(b=>b.length),[100,100,40,100,100,40]);
  assert.deepEqual(f.singles.filter(path=>!['/.app/upload-index.json','/.app/mutation.json'].includes(path)),['/.app/library.json']);
  assert.equal(f.singles.filter(path=>path==='/.app/mutation.json').length,2,'one global CAS acquire and one release per run, not per song');
  assert.equal(f.singles.filter(path=>path==='/.app/upload-index.json').length,4,'one provenance commit per content group, then one cleanup, rather than per file');
  const manifest=JSON.parse(f.entries.get('/.app/library.json').text);assert.equal(Object.keys(manifest.songs).length,240);
  for(const link of Object.values(manifest.songs)){
    const content=f.entries.get(link.path.toLowerCase()),personal=JSON.parse(f.entries.get('/.app/songs/'+link.id+'.json').text);
    assert.equal(personal.original.rev,content.rev);assert.equal(personal.data.capo,3);
  }
  const count=f.batches.length;await f.run();assert.equal(f.batches.length,count);assert.equal(f.data.state.pending,false);assert.deepEqual(f.data.state.uploads,{});
});

test('bulk: lost commit response plus a newer local generation resumes exact receipts without false conflicts or duplicates',async()=>{
  const f=bulkFixture(),commit=f.files.commitBatch;let lost=false;
  f.files.commitBatch=async jobs=>{const result=await commit(jobs);if(!lost){lost=true;f.change(d=>{d.songs[0].original='{t: Newer}\nNew local words';d.personal[0].capo=8;});throw new SyncFailure({code:failureCodes.network,stage:'test.batch'},'lost response');}return result;};
  await assert.rejects(f.run());assert.equal(f.entries.has('/.app/library.json'),false);assert.ok(Object.values(f.data.state.uploads).some(job=>job.status==='committing'));
  await f.run();assert.equal(f.data.state.conflicts.length,0);assert.equal(f.data.state.pending,false);assert.equal(f.data.state.localGeneration,f.data.journal.generation);
  const manifest=JSON.parse(f.entries.get('/.app/library.json').text),link=manifest.songs['bulk-0'];
  assert.equal(f.entries.get(link.path.toLowerCase()).text,'{t: Newer}\nNew local words');assert.equal(JSON.parse(f.entries.get('/.app/songs/bulk-0.json').text).data.capo,8);
  assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,20);
});

test('bulk: partial revision failure retains successes, rechecks the conflict and finishes independent songs',async()=>{
  const f=bulkFixture();await f.run();
  f.change(d=>{for(const s of d.songs)s.original+='\nLocal edit';});
  const manifest=JSON.parse(f.entries.get('/.app/library.json').text),path=manifest.songs['bulk-0'].path;
  const commit=f.files.commitBatch;let raced=false;
  f.files.commitBatch=async jobs=>{if(!raced&&jobs.some(j=>j.path===path)){raced=true;const old=await f.files.read(path);await f.files.write(path,'{t: Other device}\nRemote edit',old.rev);}return commit(jobs);};
  await retry(f);
  assert.equal(f.entries.get(path.toLowerCase()).text,'{t: Other device}\nRemote edit');assert.ok(f.data.state.conflicts.some(c=>c.songId==='bulk-0'));assert.equal(f.data.state.pending,true);
  for(const id of Object.keys(manifest.songs).filter(id=>id!=='bulk-0')){const link=manifest.songs[id],content=f.entries.get(link.path.toLowerCase()),p=JSON.parse(f.entries.get('/.app/songs/'+id+'.json').text);assert.ok(content.text.endsWith('Local edit'));assert.equal(p.original.rev,content.rev);}
});

test('bulk: generation interruption during staging sends no namespace commit and later resumes',async()=>{
  const f=bulkFixture(),begin=f.files.beginUpload;let interrupted=false;
  f.files.beginUpload=async text=>{const result=await begin(text);if(!interrupted){interrupted=true;f.change(()=>{});}return result;};
  await assert.rejects(f.run());assert.equal(f.batches.length,0);assert.deepEqual([...f.entries.values()].filter(e=>!e.folder).map(e=>e.path),['/.app/mutation.json']);
  await f.run();assert.equal(f.data.state.pending,false);assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,20);
});

test('bulk: interrupted commit reuses unexpired staged bytes, while expired sessions are restaged',async()=>{
  for(const expired of [false,true]){
    const f=bulkFixture(2),commit=f.files.commitBatch;let blocked=true;
    f.files.commitBatch=async jobs=>{if(blocked)throw new SyncFailure({code:failureCodes.network,stage:'test.batch'},'interrupted commit');return commit(jobs);};
    await assert.rejects(f.run());const initial=f.sessions.size;assert.equal(initial,2);
    if(expired)for(const job of Object.values(f.data.state.uploads))job.session.created=Date.now()-8*24*60*60*1000;
    blocked=false;await f.run();
    assert.equal(f.sessions.size,expired?initial+4:initial+2,'only content sessions may be reused; personal bytes follow confirmed content revisions');assert.equal(f.data.state.pending,false);
  }
});

test('bulk: completed data sessions are durable before the entire staging group has finished',async()=>{
  const f=bulkFixture(),begin=f.files.beginUpload;let calls=0,active=true,released=false,release;
  const gate=new Promise(resolve=>{release=resolve;});
  f.files.beginUpload=async text=>{if(++calls>4&&!released)await gate;return begin(text);};
  const running=syncEngine(f.storage,f.files,'account',{valid:()=>active,changed(){}}).run(true);
  try{
    const deadline=Date.now()+5000;
    while(Date.now()<deadline&&Object.values(f.data.state.uploads??{}).filter(job=>job.session).length<4)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(Object.values(f.data.state.uploads).filter(job=>job.session).length,4,'the first four closed sessions survive a page/process interruption');assert.equal(f.batches.length,0);
  }finally{active=false;released=true;release();await assert.rejects(running);}
  const stagedBefore=f.sessions.size;await f.run();assert.ok(f.sessions.size-stagedBefore<40,'durable content bytes are reused on the next run');assert.equal(f.data.state.pending,false);
});

test('bulk F57: a deleted book discards interrupted upload intents, including unpublished songs',async()=>{
  const f=bulkFixture(2);await f.run();
  f.change(d=>{for(const s of d.songs)s.original+='\nUnsent';d.songs.push({...song('never'),origin:{kind:'local',filename:'never.cho',importedAt:'2026-01-01'}});});
  const commit=f.files.commitBatch;f.files.commitBatch=async()=>{throw new SyncFailure({code:failureCodes.network,stage:'test.batch'},'offline');};await assert.rejects(f.run());assert.ok(Object.keys(f.data.state.uploads).length);
  for(const [key,e]of [...f.entries])if(e.path.startsWith('/Songbooks/Standard'))f.entries.delete(key);f.files.commitBatch=commit;
  await f.run();assert.equal(f.data.songs.length,0);assert.equal(f.data.personal.length,0);assert.deepEqual(f.data.state.uploads,{});assert.equal(f.data.state.pending,false);
});

for(const mode of ['deleted','Shared','Originals'])test(`bulk F56/F63: a confirmed unpublished upload moved to ${mode} respects master boundaries`,async()=>{
  const f=bulkFixture(2),commit=f.files.commitBatch;
  f.files.commitBatch=async jobs=>{if(jobs.some(j=>j.kind==='personal'))throw new SyncFailure({code:failureCodes.network,stage:'test.batch'},'sidecar interrupted');return commit(jobs);};
  await assert.rejects(f.run());assert.equal(f.entries.has('/.app/library.json'),false);
  const known=f.data.state.reservations['bulk-0'];assert.ok(known.fileId);assert.ok(f.data.state.bases['bulk-0'].contentRev);
  const target='/Songbooks/Standard/'+mode+'/moved.cho';
  if(mode==='deleted')f.entries.delete(known.path.toLowerCase());else await f.files.move(known.fileId,target);
  const before=f.calls.length;f.files.commitBatch=commit;await f.run();await f.run();
  assert.equal(f.entries.has(known.path.toLowerCase()),false);
  if(mode==='Shared'){
    assert.equal(f.data.songs.length,2);assert.equal(f.data.state.held['bulk-0'],true);assert.ok(f.entries.has(target.toLowerCase()));assert.equal(f.calls.slice(before).some(c=>c[0]==='move'),false);
  }else{
    assert.deepEqual(f.data.songs.map(s=>s.id),['bulk-1']);assert.deepEqual(f.data.personal.map(p=>p.songId),['bulk-1']);assert.ok(f.data.state.manifest.deletedSongs['bulk-0']);assert.equal(f.data.state.pending,false);if(mode==='Originals')assert.ok(f.entries.has(target.toLowerCase()));
  }
  const manifest=JSON.parse(f.entries.get('/.app/library.json').text);assert.ok(manifest.songs['bulk-1']);assert.equal(manifest.songs['bulk-0'],undefined);
});

for(const change of ['remote','local','both'])test(`bulk: ${change} book rename after content success before first manifest is preserved`,async()=>{
  const f=bulkFixture(2),commit=f.files.commitBatch;
  f.files.commitBatch=async jobs=>{if(jobs.some(j=>j.kind==='personal'))throw new SyncFailure({code:failureCodes.network,stage:'test.batch'},'interrupted person batch');return commit(jobs);};
  await assert.rejects(f.run());const book=f.data.state.folders.standard;assert.ok(book.folderId);
  if(change!=='local')await f.files.move(book.folderId,'/Songbooks/Remote name');
  if(change!=='remote')f.change(d=>{d.songbooks[0].name='Local name';});
  f.files.commitBatch=commit;
  if(change==='both'){
    await assert.rejects(f.run(),error=>error.info?.code===failureCodes.bookChanges);assert.equal(f.data.songbooks[0].name,'Local name');assert.ok(f.entries.has('/songbooks/remote name'));assert.equal(f.entries.has('/songbooks/standard'),false);return;
  }
  await f.run();await f.run();const expected=change==='remote'?'Remote name':'Local name';
  assert.equal(f.data.songbooks[0].name,expected);assert.equal(f.data.state.manifest.books.standard.folderId,book.folderId);assert.equal(f.data.state.pending,false);
  const manifest=JSON.parse(f.entries.get('/.app/library.json').text);assert.equal(Object.keys(manifest.songs).length,2);for(const link of Object.values(manifest.songs))assert.ok(link.path.startsWith('/Songbooks/'+expected+'/Private/'));
});

test('10 MB: an oversized UTF-8 local song is retained and skipped while another song uploads',async()=>{
  const f=bulkFixture(2);f.change(d=>{d.songs[0].original='æ'.repeat(maxFileBytes/2+1);});
  await f.run();const manifest=JSON.parse(f.entries.get('/.app/library.json').text);
  assert.equal(manifest.songs['bulk-0'],undefined);assert.ok(manifest.songs['bulk-1']);assert.equal(f.data.songs.length,2);assert.equal(f.data.state.bases['bulk-0'],undefined);assert.equal(f.data.state.pending,true);
});

test('10 MB: remote size metadata skips new files and never turns a known oversized file into a deletion',async()=>{
  const f=bulkFixture(1);await f.run();const link=f.data.state.manifest.songs['bulk-0'],before=structuredClone(f.data.songs);
  const current=f.entries.get(link.path.toLowerCase());current.text='x'.repeat(maxFileBytes+1);current.rev='oversized';
  await f.files.write('/Songbooks/Standard/Private/large.cho','too large',null);
  const changes=f.files.changes;f.files.changes=async cursor=>{const result=await changes(cursor);for(const e of result.entries)if(e.path===link.path||e.path.endsWith('/large.cho'))e.size=maxFileBytes+1;return result;};
  const read=f.files.read;let downloaded=0;f.files.read=async path=>{if(path===link.fileId||path===link.path||path.endsWith('/large.cho'))downloaded++;return read(path);};
  await f.run();assert.equal(downloaded,0);assert.deepEqual(f.data.songs,before);assert.equal(f.data.state.manifest.deletedSongs,undefined);assert.equal(Object.keys(f.data.state.manifest.songs).length,1);
});
