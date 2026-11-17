import test from 'node:test';
import assert from 'node:assert/strict';
import {dropboxAdapter} from '../src/adapters/dropbox.ts';
import {fixture} from './sync-fixture.mjs';
import {DeferredSync,SubmittedBatchInterruption,BatchJobFailed} from '../src/sync/failure.ts';
async function adapterTest(request,run,guard=()=>{}){
 const old={localStorage:globalThis.localStorage,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')},store=new Map([['namespace-test:dropbox-auth-v1',JSON.stringify({version:1,accountId:'fixture',name:'Fixture',email:'fixture@example.invalid',accessToken:'token',refreshToken:'refresh',expires:Date.now()+3600000})]]);
 globalThis.localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_key,operation)=>operation()}}});
 try{const events=[],adapter=dropboxAdapter({channel:'test',namespace:'namespace-test'},request,guard,event=>events.push(event));adapter.beginRun();await run(adapter,events);}finally{globalThis.localStorage=old.localStorage;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;}
}
const deletion=(id,folder=false)=>({key:id,path:'id:'+id,fileId:'id:'+id,...(folder?{folder:true,category:'folder'}:{rev:'rev-'+id,category:'personal'})});
test('namespace contract: file deletion carries stable ID and revision; folders carry no unsupported revision',async()=>{
 const entries=[deletion('a'),deletion('b',true)];
 await adapterTest(async(url,options)=>{assert.ok(url.endsWith('/files/delete_batch'));assert.equal(new URL(url).host,'api.dropboxapi.com');assert.deepEqual(JSON.parse(options.body),{entries:[{path:'id:a',parent_rev:'rev-a'},{path:'id:b'}]});return Response.json({'.tag':'complete',entries:entries.map((e,i)=>({'.tag':'success',success:{metadata:{'.tag':i?'folder':'file',id:e.fileId,path_display:'/example/'+e.key,...(!i?{rev:e.rev}:{})}}}))});},async adapter=>{
  const result=await adapter.files.deleteBatch(entries);assert.equal(result.entries[0].value.id,'id:a');assert.equal(result.entries[1].value.folder,true);
  await assert.rejects(adapter.files.deleteBatch([{...deletion('b',true),rev:'forbidden'}]),error=>error.info.code==='SYNC-008');
 });
});
test('namespace contract: not-found, revision conflict and write contention are separate HTTP200 entry outcomes',async()=>{
 await adapterTest(async()=>Response.json({'.tag':'complete',entries:[{'.tag':'failure',failure:{'.tag':'path_lookup',path_lookup:{'.tag':'not_found'}}},{'.tag':'failure',failure:{'.tag':'path_lookup',path_lookup:{'.tag':'conflict'}}},{'.tag':'failure',failure:{'.tag':'too_many_write_operations'}}]}),async(adapter,events)=>{
  const result=await adapter.files.deleteBatch([deletion('a'),deletion('b'),deletion('c')]);assert.equal(result.entries[0].missing,true);assert.equal(result.entries[1].collision,true);assert.equal(result.entries[2].failure.status,200);assert.equal(events[0].status,200);assert.equal(events[0].entryLimit,true);
 });
});
test('namespace contract: folder batches use absolute paths, no autorename and wrapped FolderMetadata without a union tag',async()=>{
 const entries=[{key:'a',path:'/Songbooks/Åpen'},{key:'b',path:'/Songbooks/Andre'}];
 await adapterTest(async(url,options)=>{assert.ok(url.endsWith('/create_folder_batch'));assert.deepEqual(JSON.parse(options.body),{paths:entries.map(e=>e.path),autorename:false,force_async:false});return Response.json({'.tag':'complete',entries:entries.map(e=>({'.tag':'success',success:{metadata:{id:'id:'+e.key,path_display:e.path}}}))});},async adapter=>{const result=await adapter.files.createFoldersBatch(entries);assert.ok(result.entries.every(e=>e.value.folder));});
});
test('namespace contract: documented asynchronous status, terminal job failure and expired IDs',async()=>{
 await adapterTest(async(url)=>{
  if(url.endsWith('/delete_batch'))return Response.json({'.tag':'async_job_id',async_job_id:'delete-job'});
  if(url.endsWith('/delete_batch/check'))return Response.json({'.tag':'in_progress'});
  if(url.endsWith('/create_folder_batch/check'))return Response.json({'.tag':'failed',failed:{'.tag':'internal_error'}});
  return Response.json({error_summary:'invalid_async_job_id/'},{status:409});
 },async adapter=>{assert.deepEqual(await adapter.files.deleteBatch([deletion('a')]),{asyncJobId:'delete-job'});assert.deepEqual(await adapter.files.checkDeleteBatch('delete-job'),{inProgress:true});await assert.rejects(adapter.files.checkCreateFoldersBatch('failed-job'),BatchJobFailed);assert.deepEqual(await adapter.files.checkMoveBatch('expired'),{jobExpired:true});});
});
test('namespace contract: a successful job receipt reaches its journal even when the local generation changes during fetch',async()=>{
 let allowed=true;
 await adapterTest(async()=>{allowed=false;return Response.json({'.tag':'async_job_id',async_job_id:'accepted-before-edit'});},async adapter=>{assert.deepEqual(await adapter.files.deleteBatch([deletion('a')]),{asyncJobId:'accepted-before-edit'});},()=>{if(!allowed)throw new DeferredSync('changed','new generation');});
});
test('namespace contract: malformed batch results cannot acknowledge work',async()=>{
 for(const value of [{'.tag':'complete',entries:[]},{'.tag':'complete',entries:[{'.tag':'success',metadata:{id:'wrong-shape'}}]},{'.tag':'async_job_id'}])await adapterTest(async()=>Response.json(value),async adapter=>{await assert.rejects(adapter.files.createFoldersBatch([{key:'a',path:'/A'}]),error=>error.info.code==='SYNC-008');});
});

for(const status of [500,408])test(`namespace contract: HTTP${status} followed by a new-generation guard retains the already submitted ID move`,async()=>{
 const f=fixture();f.change(d=>{d.songs[0].origin.filename='Song.cho';d.songbooks.push({id:'target',name:'Target'});});await f.run();f.change(d=>{d.songs[0].songbookId='target';});const generation=f.data.journal.generation;let launched=0;
 await adapterTest(async url=>{assert.ok(url.endsWith('/move_batch_v2'));launched++;f.change(d=>{d.personal[0].capo=9;});return Response.json({error_summary:'uncertain/'},{status});},async adapter=>{
  f.files.moveBatch=adapter.files.moveBatch;await assert.rejects(f.run(),error=>error instanceof SubmittedBatchInterruption);assert.equal(f.data.state.namespaceJob.submitted,true);assert.equal(launched,1);
 },()=>{if(f.data.journal.generation!==generation)throw new DeferredSync('changed','new generation');});
 f.files.moveBatch=async()=>{launched++;throw Error('Unexpected ID replay');};await assert.rejects(f.run(),error=>error.info?.action==='check-move');assert.equal(launched,1);assert.equal(f.data.state.pending,true);
});
