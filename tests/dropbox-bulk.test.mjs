import test from 'node:test';
import assert from 'node:assert/strict';
import {dropboxAdapter} from '../src/adapters/dropbox.ts';
import {maxFileBytes,SkippedFile} from '../src/sync/limits.ts';
import {NamespacePlanNeedsRefresh,UnsentBatch,failureCodes} from '../src/sync/failure.ts';
import {syncEngine} from '../src/sync/engine.ts';
import {fixture} from './sync-fixture.mjs';

async function adapterTest(request,run){
  const old={localStorage:globalThis.localStorage,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
  const values=new Map([['bulk-test:dropbox-auth-v1',JSON.stringify({version:1,accountId:'fixture',name:'Fixture',email:'fixture@example.invalid',accessToken:'fixture',refreshToken:'fixture',expires:Date.now()+3600000})]]);
  globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_key,operation)=>operation()}}});
  try{const events=[],adapter=dropboxAdapter({channel:'test',namespace:'bulk-test'},request,()=>{},event=>events.push(event));adapter.beginRun();await run(adapter,events);}
  finally{globalThis.localStorage=old.localStorage;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;}
}
const job=(id,text='Ord æ🎸')=>({key:'content:'+id,songId:id,kind:'content',path:'/Songbooks/Book/Private/'+id+'.cho',text,rev:null,status:'committing',session:{id:'session-'+id,created:Date.now()}});
const success=(j,rev='new')=>({'.tag':'success',id:'id:'+j.songId,rev,path_display:j.path});

test('Dropbox bulk contract: closed content sessions, byte offsets, strict add/update and flat per-entry metadata',async()=>{
  const calls=[],a=job('a'),b={...job('b'),rev:'expected'};
  await adapterTest(async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/start')){assert.equal(new URL(url).host,'content.dropboxapi.com');assert.equal(JSON.parse(options.headers['Dropbox-API-Arg']).close,true);assert.equal(Buffer.from(options.body).toString(),a.text);return Response.json({session_id:'session-a'});}
    assert.equal(new URL(url).host,'api.dropboxapi.com');assert.ok(url.endsWith('/finish_batch_v2'));
    const entries=JSON.parse(options.body).entries;assert.equal(entries[0].cursor.offset,Buffer.byteLength(a.text));assert.equal(entries[1].commit.mode.update,'expected');assert.equal(entries[0].commit.mode['.tag'],'add');for(const e of entries){assert.equal(e.commit.autorename,false);assert.equal(e.commit.strict_conflict,true);}
    return Response.json({entries:[success(a),success(b)]});
  },async adapter=>{
    const session=await adapter.files.beginUpload(a.text);assert.equal(session.id,'session-a');
    const results=await adapter.files.commitBatch([a,b]);assert.equal(results[0].value.text,a.text);assert.equal(results[1].value.rev,'new');assert.equal(calls.length,2);
  });
});

test('Dropbox bulk contract: start and append group UTF-8 bytes and retain each independent result',async()=>{
  const texts=['æ🎸','', 'Tre'], ids=['a','b','c'], calls=[];
  await adapterTest(async(url,options)=>{
    calls.push(new URL(url).pathname);
    if(url.endsWith('/start_batch')){
      assert.equal(new URL(url).host,'api.dropboxapi.com');
      assert.deepEqual(JSON.parse(options.body),{num_sessions:3});
      return Response.json({session_ids:ids});
    }
    assert.ok(url.endsWith('/append_batch'));
    assert.equal(new URL(url).host,'content.dropboxapi.com');
    assert.equal(Buffer.from(options.body).toString(),texts.join(''));
    assert.deepEqual(JSON.parse(options.headers['Dropbox-API-Arg']).entries,texts.map((text,index)=>({cursor:{session_id:ids[index],offset:0},length:Buffer.byteLength(text),close:true})));
    return Response.json({entries:[{'.tag':'success'},{'.tag':'failure',failure:{'.tag':'not_found'}},{'.tag':'success'}]});
  },async(adapter,events)=>{
    const results=await adapter.files.beginUploadBatch(texts);
    assert.deepEqual(results.map(result=>result.session?.id),['a',undefined,'c']);
    assert.equal(results[1].failure.code,failureCodes.request);
    assert.deepEqual(calls,['/2/files/upload_session/start_batch','/2/files/upload_session/append_batch']);
    assert.deepEqual(events.map(event=>event.batchSize),[3,3]);
  });
});

test('Dropbox move batch contract: a failed token refresh proves that a batch was never sent',async()=>{
  const calls=[];
  await adapterTest(async url=>{calls.push(new URL(url).pathname);throw new TypeError('offline');},async adapter=>{
    const key='bulk-test:dropbox-auth-v1', credentials=JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key,JSON.stringify({...credentials,expires:0}));
    await assert.rejects(adapter.files.moveBatch([{from:'id:source',to:'/destination.cho',fileId:'id:source'}]),error=>error instanceof UnsentBatch&&error.info.code===failureCodes.network);
  });
  assert.deepEqual(calls,['/oauth2/token']);
});

test('Dropbox move batch contract: waiting at the shared rate gate sends the plan back for fresh metadata', async () => {
  const calls = [];
  await adapterTest(async url => {calls.push(new URL(url).pathname);return Response.json({'.tag': 'complete', entries: []});}, async adapter => {
    localStorage.setItem('bulk-test:dropbox-rate-v1', JSON.stringify({version: 1, accountId: 'fixture', until: Date.now() + 1000, reason: 'too_many_requests'}));
    const entries = [{from: 'id:source', to: '/destination.cho', fileId: 'id:source'}];
    await assert.rejects(adapter.files.moveBatch(entries, 0, {revalidateAfterWait: true}), NamespacePlanNeedsRefresh);
    assert.deepEqual(calls, []);
  });
});

test('AK39-03: a rejected move followed by a failed token refresh can be requested again safely', async () => {
  const f = fixture();
  await f.run();
  const move = f.files.moveBatch, routes = [], id = f.data.state.manifest.songs.one.fileId;
  const persist = f.storage.transport, receipts = [];
  f.storage.transport = async (account, job) => {
    await persist(account, job);
    receipts.push(f.data.state.namespaceJob?.submitted);
  };
  const engine = () => syncEngine(f.storage, f.files, 'account', {valid: () => true, changed() {}});
  const choices = [{id: 'one', published: true}];
  await adapterTest(async url => {
    const route = new URL(url).pathname;
    routes.push(route);
    if (route === '/oauth2/token') throw new TypeError('offline');
    assert.equal(route, '/2/files/move_batch_v2');
    const key = 'bulk-test:dropbox-auth-v1', credentials = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({...credentials, expires: 0}));
    return Response.json({error: {reason: {'.tag': 'too_many_write_operations'}}}, {status: 429, headers: {'Retry-After': '1'}});
  }, async adapter => {
    f.files.moveBatch = adapter.files.moveBatch;
    const result = await engine().executePublication(choices);
    assert.deepEqual(result.completed, []);
    assert.equal(result.unavailable, true);
    assert.equal(f.data.state.namespaceJob?.submitted, false);
    assert.deepEqual(routes, ['/2/files/move_batch_v2', '/oauth2/token']);
    assert.deepEqual(receipts, [false, false]);
    assert.equal(f.entries.get('/songbooks/standard/private/en.cho').id, id);
  });
  f.files.moveBatch = move;
  const next = await engine().executePublication(choices);
  assert.deepEqual(next.completed, ['one']);
  assert.deepEqual(next.moved, ['one']);
  assert.equal(f.entries.get('/songbooks/standard/shared/en.cho').id, id);
  assert.equal(JSON.parse(f.entries.get('/.app/mutation.json').text).owner, null);
});

test('Dropbox move batch contract: both internal_error variants require checking the actual location', async () => {
  const internal = {'.tag': 'internal_error'};
  const failures = [internal, {'.tag': 'relocation_error', relocation_error: internal}];
  await adapterTest(async () => Response.json({'.tag': 'complete', entries: failures.map(failure => ({'.tag': 'failure', failure}))}), async adapter => {
    const result = await adapter.files.moveBatch(['a', 'b'].map(id => ({from: `id:${id}`, to: `/${id}.cho`, fileId: `id:${id}`})));
    assert.deepEqual(result.entries.map(entry => entry.verifyEffect), [true, true]);
  });
});

test('Dropbox bulk contract: HTTP 200 can contain an independent revision failure and expired session',async()=>{
  const a=job('a'),b=job('b'),c=job('c');
  await adapterTest(async()=>Response.json({entries:[success(a),{'.tag':'failure',failure:{'.tag':'path',path:{'.tag':'conflict',conflict:{'.tag':'file'}}}},{'.tag':'failure',failure:{'.tag':'lookup_failed',lookup_failed:{'.tag':'not_found'}}}]}),async adapter=>{
    const results=await adapter.files.commitBatch([a,b,c]);assert.equal(results[0].value.id,'id:a');assert.equal(results[1].failure.code,'SYNC-006');assert.equal(results[2].resetSession,true);
  });
});

test('Dropbox bulk contract: per-entry write contention retries only failed entries with the same session/revision',async()=>{
  for(const failure of [{'.tag':'too_many_write_operations'},{'.tag':'path',path:{'.tag':'too_many_write_operations'}}]){
  const a=job('a'),b={...job('b'),rev:'expected'},requests=[];
  await adapterTest(async(_url,options)=>{
    requests.push(JSON.parse(options.body).entries);
    return Response.json(requests.length===1?{entries:[success(a),{'.tag':'failure',failure}]}:{entries:[success(b)]});
  },async(adapter,events)=>{
    const results=await adapter.files.commitBatch([a,b]);assert.equal(results.length,2);assert.equal(requests.length,2);assert.equal(requests[1].length,1);assert.deepEqual(requests[1][0],requests[0][1]);assert.equal(events[0].status,200);assert.equal(events[0].entryLimit,true);
  });
  }
});

test('Dropbox bulk contract: malformed or incomplete success responses cannot acknowledge files',async()=>{
  for(const value of [{entries:[]},{entries:[{'.tag':'unknown'}]},{entries:[{'.tag':'success',id:'id:a'}]}])await adapterTest(async()=>Response.json(value),async adapter=>{await assert.rejects(adapter.files.commitBatch([job('a')]),error=>error.info?.code==='SYNC-008');});
});

test('Dropbox bulk contract: the 10 MB upload guard uses UTF-8 bytes before making a request',async()=>{
  let calls=0;await adapterTest(async()=>{calls++;throw new Error('Must not request');},async adapter=>{
    const text='æ'.repeat(maxFileBytes/2+1);
    await assert.rejects(adapter.files.beginUpload(text),SkippedFile);await assert.rejects(adapter.files.write('/x.cho',text,null),SkippedFile);assert.equal(calls,0);
  });
});

test('Dropbox move batch contract: immutable literal sources, no autorename, wrapped success and async status',async()=>{
 const entries=[{key:'content:a',from:'/.app/uploads/unique.cho',to:'/Songbooks/Book/Private/Readable.cho',fileId:'id:a'}],requests=[];
 await adapterTest(async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,body});assert.equal(new URL(url).host,'api.dropboxapi.com');
  if(url.endsWith('/move_batch_v2')){assert.deepEqual(body,{entries:[{from_path:entries[0].from,to_path:entries[0].to}],autorename:false,allow_ownership_transfer:false});return Response.json({'.tag':'async_job_id',async_job_id:'job'});}
  assert.ok(url.endsWith('/move_batch/check_v2'));assert.deepEqual(body,{async_job_id:'job'});
  return Response.json(requests.length===2?{'.tag':'in_progress'}:{'.tag':'complete',entries:[{'.tag':'success',success:{'.tag':'file',id:'id:a',rev:'r',path_display:entries[0].to}}]});
 },async adapter=>{
  assert.deepEqual(await adapter.files.moveBatch(entries),{asyncJobId:'job'});assert.deepEqual(await adapter.files.checkMoveBatch('job'),{inProgress:true});
  assert.deepEqual(await adapter.files.checkMoveBatch('job'),{entries:[{value:{id:'id:a',path:entries[0].to,rev:'r'}}]});
 });
});

test('Dropbox move batch contract: HTTP 200 per-entry collision, missing source and write lock are separate results',async()=>{
 const failure=relocation=>({'.tag':'failure',failure:{'.tag':'relocation_error',relocation_error:relocation}});
 await adapterTest(async()=>Response.json({'.tag':'complete',entries:[failure({'.tag':'to',to:{'.tag':'conflict',conflict:{'.tag':'file'}}}),failure({'.tag':'from_lookup',from_lookup:{'.tag':'not_found'}}),{'.tag':'failure',failure:{'.tag':'too_many_write_operations'}}]}),async adapter=>{
  const result=await adapter.files.moveBatch(['a','b','c'].map(id=>({from:`/.app/uploads/${id}.cho`,to:`/Songbooks/B/Private/${id}.cho`,key:id,fileId:'id:'+id})));
  assert.equal(result.entries[0].collision,true);assert.equal(result.entries[1].missing,true);assert.equal(result.entries[2].failure.code,'SYNC-007');assert.ok(result.entries.every(e=>e.failure.status===200));
 });
});

test('Dropbox move batch contract: invalid job IDs permit immutable-plan recovery; malformed successes fail closed',async()=>{
 await adapterTest(async()=>Response.json({error_summary:'invalid_async_job_id/'},{status:409}),async adapter=>assert.deepEqual(await adapter.files.checkMoveBatch('expired'),{jobExpired:true}));
 for(const response of [{'.tag':'complete',entries:[{'.tag':'success',id:'id:flat',rev:'r'}]},{'.tag':'complete',entries:[{'.tag':'success',success:{'.tag':'file',id:'id:a'}}]},{'.tag':'unknown'}])await adapterTest(async()=>Response.json(response),async adapter=>assert.rejects(adapter.files.moveBatch([{key:'a',fileId:'id:a',from:'/x',to:'/y'}]),error=>error.info?.code==='SYNC-008'));
});

test('Dropbox move batch contract: per-entry locks arm the shared cooldown without pretending HTTP 429',async()=>{
 const calls=[],entries=[{key:'a',from:'/.app/uploads/a.cho',to:'/Songbooks/B/Private/a.cho',toReference:'id:parent/a.cho',fileId:'id:a'}];
 await adapterTest(async(url,options)=>{
  calls.push({at:Date.now(),args:JSON.parse(options.body)});assert.ok(url.endsWith('/move_batch_v2'));assert.equal(calls.at(-1).args.entries[0].to_path,'id:parent/a.cho');
  return Response.json(calls.length===1?{'.tag':'complete',entries:[{'.tag':'failure',failure:{'.tag':'too_many_write_operations'}}]}:{'.tag':'complete',entries:[{'.tag':'success',success:{'.tag':'file',id:'id:a',rev:'r',path_display:entries[0].to}}]});
 },async(adapter,events)=>{
  const first=await adapter.files.moveBatch(entries,0);assert.equal(first.entries[0].failure.code,'SYNC-007');
  await adapter.files.moveBatch(entries,1);assert.ok(calls[1].at-calls[0].at>=900,'the next mutation respects shared backpressure');
  assert.equal(events[0].status,200);assert.equal(events[0].entryLimit,true);assert.equal(events[0].limitReason,'too_many_write_operations');assert.ok(events[0].retryAfterMs>=1000);
 });
});
