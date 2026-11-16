import test from 'node:test';
import assert from 'node:assert/strict';
import {dropboxAdapter} from '../src/adapters/dropbox.ts';
import {maxFileBytes,SkippedFile} from '../src/sync/limits.ts';

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
