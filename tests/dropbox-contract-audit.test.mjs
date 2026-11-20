import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dropboxAdapter,dropboxConfig,requiredScopes} from '../src/adapters/dropbox.ts';
import {BatchJobFailed} from '../src/sync/failure.ts';
import {syncDiagnostics} from '../src/sync/diagnostics.ts';

// Raw payloads serialized by the official Dropbox SDK, independent of our mock.
const {cases}=JSON.parse(await readFile(new URL('./fixtures/dropbox-wire.json',import.meta.url),'utf8'));
async function adapterTest(request,run,{expires=Date.now()+3600000}={}){
 const old={localStorage:globalThis.localStorage,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')},namespace='contract-audit',locks=new Map(),values=new Map([[namespace+':dropbox-auth-v1',JSON.stringify({version:1,accountId:'fixture',name:'Fixture',email:'fixture@example.invalid',accessToken:'fake',refreshToken:'fake-refresh',expires})]]);
 globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request(key,fn){const prior=locks.get(key)??Promise.resolve(),next=prior.catch(()=>{}).then(fn);locks.set(key,next.catch(()=>{}));return next;}}}});
 try{const events=[],adapter=dropboxAdapter({channel:'test',namespace},request,()=>{},e=>events.push(e));adapter.beginRun();await run(adapter,events,values);}finally{globalThis.localStorage=old.localStorage;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;}
}
const deletion={key:'folder',path:'id:folder',fileId:'id:folder',folder:true,category:'folder'};
for(const kind of ['delete','folders'])for(const check of [false,true])test(`official wire: ${kind} ${check?'check':'launch'} accepts inlined result metadata`,()=>adapterTest(async()=>Response.json(cases[`${kind}_${check?'check':'launch'}_complete`]),async a=>{
 const reply=kind==='delete'?await(check?a.files.checkDeleteBatch('job'):a.files.deleteBatch([deletion])):await(check?a.files.checkCreateFoldersBatch('job'):a.files.createFoldersBatch([{key:'folder',path:'/Songbooks/Book/Private'}]));
 assert.equal(reply.entries[0].value.id,'id:folder');assert.equal(reply.entries[0].value.folder,true);
}));
test('official wire: delete path_write conflict is a state conflict',()=>adapterTest(async()=>Response.json(cases.delete_entries_errors),async a=>{
 const reply=await a.files.deleteBatch(Array.from({length:cases.delete_entries_errors.entries.length},()=>deletion));
 const i=cases.delete_entries_errors.entries.findIndex(e=>e.failure?.path_write?.['.tag']==='conflict');assert.ok(i>=0);assert.equal(reply.entries[i].collision,true);assert.equal(reply.entries[i].failure.code,'SYNC-006');
}));
test('official wire: source write lock activates shared backpressure',()=>adapterTest(async()=>Response.json(cases.move_entries_errors),async(a,events,values)=>{
 const reply=await a.files.moveBatch(cases.move_entries_errors.entries.map((_,i)=>({key:String(i),fileId:'id:'+i,from:'id:'+i,to:'/target/'+i})));
 const i=cases.move_entries_errors.entries.findIndex(e=>e.failure?.relocation_error?.from_write?.['.tag']==='too_many_write_operations');assert.ok(i>=0);assert.equal(reply.entries[i].failure.code,'SYNC-007');assert.equal(events[0].entryLimit,true);assert.ok(values.has('contract-audit:dropbox-rate-v1'));
}));
test('official wire: terminal delete-job contention retains HTTP200 and shared cooldown',()=>adapterTest(async()=>Response.json(cases.delete_check_failed_lock),async(a,events,values)=>{
 await assert.rejects(a.files.checkDeleteBatch('job'),e=>e instanceof BatchJobFailed&&e.info.code==='SYNC-007'&&e.info.status===200);assert.equal(events[0].entryLimit,true);assert.ok(values.has('contract-audit:dropbox-rate-v1'));
}));
for(const method of ['metadata','read','write','beginUpload','commitBatch'])test(`HTTP403 ${method} preserves the renewable connection`,()=>adapterTest(async()=>Response.json(cases.auth_access_feature,{status:403}),async a=>{
 const args={metadata:['/fixture'],read:['/fixture'],write:['/fixture','text','rev'],beginUpload:['text'],commitBatch:[[{path:'/fixture',text:'text',rev:'rev',session:{id:'session'}}]]};
 await assert.rejects(a.files[method](...args[method]),e=>e.info.code==='SYNC-005');assert.equal(a.account()?.id,'fixture');
}));
test('AK37-01: a server-expired access token renews a rejected write with the same revision and bytes', async () => {
 const requests = [];
 await adapterTest(async (url, init) => {
  const path = new URL(url).pathname;
  requests.push({path, headers: init.headers, body: init.body});
  if (path === '/oauth2/token') {
   assert.equal(init.body.get('grant_type'), 'refresh_token');
   assert.equal(init.body.get('refresh_token'), 'fake-refresh');
   return Response.json({access_token:'renewed',expires_in:3600});
  }
  if (requests.length === 1) return Response.json({error:{'.tag':'expired_access_token'}}, {status:401});
  return Response.json(cases.download_header);
 }, async (a, events) => {
  await a.files.write('/Songbooks/Book/Private/song.cho', '{t: Prøve}\r\n', 'expected-rev');
  assert.equal(a.account().id, 'fixture');
  assert.deepEqual(requests.map(call => call.path), ['/2/files/upload','/oauth2/token','/2/files/upload']);
  assert.deepEqual(events.map(event => event.status), [401,200,200]);
  const [original,,retried] = requests;
  assert.equal(retried.headers.Authorization, 'Bearer renewed');
  assert.equal(original.headers['Dropbox-API-Arg'], retried.headers['Dropbox-API-Arg']);
  assert.deepEqual(JSON.parse(retried.headers['Dropbox-API-Arg']).mode, {'.tag':'update',update:'expected-rev'});
  assert.deepEqual(original.body, retried.body);
 });
});

test('AK37-01: concurrent rejected requests for one token join one forced refresh', async () => {
 let rejected = 0, refreshes = 0, verified = 0, release;
 const bothOriginals = new Promise(resolve => {release = resolve;});
 await adapterTest(async (url, init) => {
  if (url.endsWith('/oauth2/token')) {
   refreshes++;
   return Response.json({access_token:'renewed',expires_in:3600});
  }
  if (new Headers(init.headers).get('Authorization') === 'Bearer fake') {
   if (++rejected === 2) release();
   await bothOriginals;
   return Response.json({error_summary:'expired_access_token/'}, {status:401});
  }
  verified++;
  return Response.json({...cases.download_header,'.tag':'file'});
 }, async a => {
  await Promise.all([a.files.metadata('/Songbooks/Book/Private/song.cho'), a.files.metadata('/Songbooks/Book/Private/song.cho')]);
  assert.deepEqual([rejected,refreshes,verified], [2,1,2]);
 });
});

for (const tokenError of ['invalid_grant','invalid_client']) test(`AK37-01: refresh ${tokenError} distinguishes lost access from a token endpoint error`, async () => {
 const lost = tokenError === 'invalid_grant';
 await adapterTest(async url => url.endsWith('/oauth2/token')
  ? Response.json({error:tokenError}, {status:lost?400:401})
  : Response.json({error_summary:'expired_access_token/'}, {status:401}), async (a, events) => {
  await assert.rejects(a.files.metadata('/fixture'), error => error.info.code==='SYNC-004' && error.info.status===(lost?400:401)
   && error.info.action===(lost?'reconnect':undefined));
  assert.equal(a.account()?.id, lost?undefined:'fixture');
  assert.deepEqual(events.map(event => event.status), [401,lost?400:401]);
 });
});

test('AK37-01: an expired response after renewal completes the request without an extra refresh or disconnect', async () => {
 let refreshes = 0;
 await adapterTest(async url => {
  if (url.endsWith('/oauth2/token')) {
   refreshes++;
   return Response.json({access_token:'renewed',expires_in:3600});
  }
  return Response.json({error_summary:'expired_access_token/'}, {status:401});
 }, async (a, events) => {
  await assert.rejects(a.files.metadata('/fixture'), error => error.info.code==='SYNC-004' && !error.info.action);
  assert.equal(refreshes, 1);
  assert.equal(a.account().id, 'fixture');
  assert.deepEqual(events.map(event => event.status), [401,200,401]);
 });
});

test('AK37-01: a late rejection of a superseded bearer preserves the renewed account', async () => {
 let respond, received;
 const started = new Promise(resolve => {received = resolve;});
 const reply = new Promise(resolve => {respond = resolve;});
 await adapterTest(async () => {received(); return reply;}, async (a, _events, values) => {
  const initial = a.files.metadata('/fixture');
  await started;
  const key = 'contract-audit:dropbox-auth-v1', saved = JSON.parse(values.get(key));
  values.set(key, JSON.stringify({...saved,accessToken:'newer'}));
  respond(Response.json({error:{'.tag':'invalid_access_token'}}, {status:401}));
  await assert.rejects(initial, error => error.reason==='changed');
  assert.equal(JSON.parse(values.get(key)).accessToken, 'newer');
 });
});
test('OAuth429: queued token refreshes share Retry-After across runs',async()=>{
 let calls=0;await adapterTest(async()=>{calls++;return Response.json(cases.auth_rate,{status:429,headers:{'Retry-After':'60'}});},async(a,_events,values)=>{
  const results=await Promise.allSettled(Array.from({length:4},()=>a.files.metadata('/fixture')));assert.ok(results.every(r=>r.status==='rejected'&&r.reason.info.code==='SYNC-007'));assert.equal(calls,1);assert.ok(values.has('contract-audit:dropbox-rate-v1'));a.beginRun();await assert.rejects(a.files.metadata('/fixture'),e=>e.info.code==='SYNC-007');assert.equal(calls,1);
 },{expires:0});
});
test('short token throttling retries the same grant without recursively entering its refresh lock',async()=>{
 let tokens=0,files=0,firstBody;
 await adapterTest(async(url,options)=>{if(url.endsWith('/oauth2/token')){tokens++;assert.equal(options.headers,undefined);if(tokens===1){firstBody=options.body.toString();return Response.json({...cases.auth_rate,retry_after:0},{status:429,headers:{'Retry-After':'0'}});}assert.equal(options.body.toString(),firstBody);return Response.json({access_token:'renewed',expires_in:3600});}files++;return Response.json(cases.download_header['.tag']?cases.download_header:{...cases.download_header,'.tag':'file'});},async a=>{await a.files.metadata('/Songbooks/Book/Private/song.cho');assert.equal(tokens,2);assert.equal(files,1);},{expires:0});
});
test('first OAuth account lookup retries with its newly exchanged token before credentials exist',async()=>{
 const names=['sessionStorage','location','history'],old=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),session=new Map(),config=dropboxConfig('test');let accounts=0;
 try{
  globalThis.sessionStorage={getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)};globalThis.location={href:config.redirect,origin:new URL(config.redirect).origin,pathname:new URL(config.redirect).pathname,assign(){}};globalThis.history={replaceState(){}};
  await adapterTest(async(url,options)=>{if(url.endsWith('/oauth2/token'))return Response.json({access_token:'exchanged',refresh_token:'renewable',account_id:cases.current_account.account_id,expires_in:3600,scope:requiredScopes.join(' ')});assert.ok(url.endsWith('/users/get_current_account'));assert.equal(new Headers(options.headers).get('Authorization'),'Bearer exchanged');accounts++;return accounts===1?Response.json({...cases.auth_rate,retry_after:0},{status:429,headers:{'Retry-After':'0'}}):Response.json(cases.current_account);},async(a,_events,values)=>{values.delete('contract-audit:dropbox-auth-v1');await a.connect();const pending=JSON.parse(session.get('contract-audit:dropbox-pkce-v1'));location.href=config.redirect+'?code=synthetic&state='+pending.state;assert.equal(await a.callback(),true);assert.equal(accounts,2);assert.equal(a.account().id,cases.current_account.account_id);});
 }finally{for(const k of names)if(old[k])Object.defineProperty(globalThis,k,old[k]);else delete globalThis[k];}
});
test('HTTP200 finish-entry error is not fabricated HTTP409; safe request ID survives logging',()=>adapterTest(async()=>Response.json({entries:[{'.tag':'failure',failure:{'.tag':'path',path:{'.tag':'no_write_permission'}}}]},{headers:{'X-Dropbox-Request-Id':'0123456789abcdef0123456789abcdef'}}),async(a,events)=>{
 const reply=await a.files.commitBatch([{path:'/fixture',text:'text',rev:'rev',session:{id:'session'}}]);assert.equal(reply[0].failure.status,200);assert.equal(events[0].requestId,'0123456789abcdef0123456789abcdef');
 const d=syncDiagnostics({channel:'test',namespace:'contract-audit',sha:'a'.repeat(40),pr:38});const {entry}=d.record(new Error('private'),'sync.run',true,events);assert.equal(entry.operations[0].requestId,events[0].requestId);
}));
test('download body transport failure retains received HTTP status and network classification',()=>adapterTest(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('partial'));c.error(new TypeError('synthetic network loss'));}}),{headers:{'Dropbox-API-Result':JSON.stringify(cases.download_header)}}),async a=>{
 await assert.rejects(a.files.read('id:file'),e=>e.info?.code==='SYNC-002'&&e.info.status===200&&e.info.stage==='dropbox.download');
}));
test('bounded log tail retains complete route counts and excludes arbitrary IDs/keys',()=>adapterTest(async()=>Response.json({}),async()=>{
 const d=syncDiagnostics({channel:'test',namespace:'contract-audit',sha:'a'.repeat(40),pr:38}),event={operation:'files/list_folder/continue',status:200,durationMs:1,requestId:'PRIVATE_PATH'};
 const {entry}=d.record(new Error('private'),'sync.run',true,Array.from({length:30},()=>event),undefined,{'files/list_folder/continue':300,'PRIVATE_PATH':200,'files/upload':-1});
 assert.equal(entry.operations.length,30);assert.deepEqual(entry.operationTotals,{'files/list_folder/continue':300});assert.equal(entry.operations[0].requestId,undefined);assert.ok(!d.text(entry).includes('PRIVATE_PATH'));
}));
test('malformed finish response still records the actual HTTP receipt and request ID',()=>adapterTest(async()=>new Response('{',{headers:{'X-Dropbox-Request-Id':'0123456789abcdef'}}),async(a,events)=>{
 await assert.rejects(a.files.commitBatch([{path:'/fixture',text:'text',rev:'rev',session:{id:'session'}}]),e=>e.info.code==='SYNC-008');assert.equal(events.length,1);assert.equal(events[0].status,200);assert.equal(events[0].requestId,'0123456789abcdef');
}));
