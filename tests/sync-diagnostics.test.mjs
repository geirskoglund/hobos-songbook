import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dropboxAdapter,DropboxError,dropboxConfig} from '../src/adapters/dropbox.ts';
import {DeferredSync,SyncFailure,failureCodes,failureText} from '../src/sync/failure.ts';
import {syncDiagnostics} from '../src/sync/diagnostics.ts';
import {environment} from '../src/environment.ts';
const env=environment('test','a'.repeat(40),'38');
async function browser(run){
 const old={localStorage:globalThis.localStorage,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')},values=new Map();
 globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155.0.8059.79 Safari/537.36 PRIVATE_SENTINEL',onLine:true,language:'nb-NO',maxTouchPoints:0,hardwareConcurrency:8,locks:{request:async(_name,fn)=>fn()}}});
 values.set(`${env.namespace}:dropbox-auth-v1`,JSON.stringify({version:1,accountId:'PRIVATE_ACCOUNT',refreshToken:'PRIVATE_REFRESH',accessToken:'PRIVATE_ACCESS',expires:Date.now()+3600000}));
 try{await run(values);await new Promise(setImmediate);}finally{globalThis.localStorage=old.localStorage;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;}
}
test('a download by ID accepts optional response paths when the metadata index already identifies the file',()=>browser(async()=>{
 const adapter=dropboxAdapter(env,async()=>new Response('text',{headers:{'Dropbox-API-Result':JSON.stringify({id:'id:file',rev:'current'})}}));assert.equal((await adapter.files.read('id:file','/Songbooks/A/Private/a.cho')).path,'/Songbooks/A/Private/a.cho');
}));
test('a sidecar already deleted by another device is a normal delete_v2 result',()=>browser(async()=>{
 let body;const adapter=dropboxAdapter(env,async(_url,options)=>{body=JSON.parse(options.body);return Response.json({error_summary:'path_lookup/not_found/'},{status:409});});await adapter.files.deleteFile('id:sidecar','revision');assert.deepEqual(body,{path:'id:sidecar',parent_rev:'revision'});
}));
test('optional path_display falls back to path_lower and preserves the documented folder name',()=>browser(async()=>{
 const adapter=dropboxAdapter(env,async()=>Response.json({'.tag':'folder',id:'id:book',path_lower:'/songbooks/mixed name',name:'Mixed Name'}));assert.deepEqual(await adapter.files.locateFolder('id:book'),{id:'id:book',path:'/songbooks/Mixed Name'});assert.deepEqual(await adapter.files.folder('/Songbooks/Mixed Name','id:book'),{id:'id:book',path:'/songbooks/Mixed Name'});
}));
test('Dropbox CreateFolderResult has untagged FolderMetadata; repeat uses tagged get_metadata',()=>browser(async()=>{
 let created=false,creates=0;const meta={id:'id:folder',name:'Songbooks',path_display:'/Songbooks',path_lower:'/songbooks'};
 const adapter=dropboxAdapter(env,async url=>{
  if(url.endsWith('/get_metadata'))return created?Response.json({'.tag':'folder',...meta}):Response.json({error_summary:'path/not_found/'},{status:409});
  assert.ok(url.endsWith('/create_folder_v2'));created=true;creates++;return Response.json({metadata:meta});
 });
 assert.deepEqual(await adapter.files.folder('/Songbooks'),{id:meta.id,path:'/Songbooks'});
 assert.deepEqual(await adapter.files.folder('/Songbooks'),{id:meta.id,path:'/Songbooks'});assert.equal(creates,1);
}));
test('a genuine file collision and malformed creation response remain real failures',()=>browser(async()=>{
 const occupied=dropboxAdapter(env,async()=>Response.json({'.tag':'file',id:'id:file',path_display:'/Songbooks'}));
 await assert.rejects(occupied.files.folder('/Songbooks'),e=>e.info.code===failureCodes.folderOccupied&&e.info.action==='folder-layout');
 const malformed=dropboxAdapter(env,async url=>url.endsWith('/get_metadata')?Response.json({error_summary:'path/not_found/'},{status:409}):Response.json({metadata:{name:'Songbooks'}}));
 await assert.rejects(malformed.files.folder('/Songbooks'),e=>e.info.code===failureCodes.folderResponse);
}));
test('browsers without AbortSignal.timeout can still perform normal Dropbox calls',()=>browser(async()=>{
 const timeout=AbortSignal.timeout,timer=globalThis.setTimeout;AbortSignal.timeout=undefined;globalThis.setTimeout=(fn,_delay)=>timer(fn,1);
 try{const adapter=dropboxAdapter(env,async(_url,options)=>{assert.ok(options.signal instanceof AbortSignal);return Response.json({'.tag':'folder',id:'id:folder',path_display:'/Songbooks'});});assert.equal((await adapter.files.folder('/Songbooks')).id,'id:folder');}finally{AbortSignal.timeout=timeout;globalThis.setTimeout=timer;}
}));
test('optional display paths are not treated as malformed successful create/upload/revision responses',()=>browser(async()=>{
 const adapter=dropboxAdapter(env,async url=>{
  if(url.endsWith('/get_metadata'))return Response.json({error_summary:'path/not_found/'},{status:409});
  if(url.endsWith('/create_folder_v2'))return Response.json({metadata:{id:'id:folder',name:'Songbooks',path_display:null}});
  if(url.endsWith('/upload'))return Response.json({id:'id:file',rev:'r1',path_display:null});
  if(url.endsWith('/download'))return new Response('original',{headers:{'Dropbox-API-Result':JSON.stringify({id:'id:file',rev:'r1'})}});
  throw Error('Unexpected endpoint');
 });
 assert.equal((await adapter.files.folder('/Songbooks')).path,'/Songbooks');assert.equal((await adapter.files.write('/Songbooks/song.cho','original',null)).path,'/Songbooks/song.cho');assert.equal((await adapter.files.read('rev:r1')).text,'original');
}));
test('only a folder creation name race is recovered; unrelated 409 keeps its actual classification',()=>browser(async()=>{
 let reads=0;const adapter=dropboxAdapter(env,async url=>{
  if(url.endsWith('/get_metadata'))return ++reads===1?Response.json({error_summary:'path/not_found/'},{status:409}):Response.json({'.tag':'folder',id:'id:race',path_display:'/Songbooks'});
  return Response.json({error_summary:'path/conflict/folder/'},{status:409});
 });assert.equal((await adapter.files.folder('/Songbooks')).id,'id:race');
 const other=dropboxAdapter(env,async url=>Response.json({error_summary:url.endsWith('/get_metadata')?'path/not_found/':'path/no_write_permission/'},{status:409}));
 await assert.rejects(other.files.folder('/Songbooks'),e=>e instanceof DropboxError&&e.summary==='path/no_write_permission/');
}));
test('late 401 after account change cannot erase the newly connected account',()=>browser(async values=>{
 let valid=true;const adapter=dropboxAdapter(env,async()=>{values.set(`${env.namespace}:dropbox-auth-v1`,JSON.stringify({version:1,accountId:'NEW_ACCOUNT',refreshToken:'NEW_REFRESH',accessToken:'NEW_ACCESS',expires:Date.now()+3600000}));valid=false;return Response.json({error_summary:'expired_access_token/'},{status:401});},()=>{if(!valid)throw new DeferredSync('connection','Tilkoblingen er endret.');});
 await assert.rejects(adapter.files.read('/.app/library.json'),e=>e instanceof DeferredSync);assert.equal(adapter.account().id,'NEW_ACCOUNT');
}));
test('HTTP rejection is not mislabeled as a network failure',()=>{
 const rejected=new DropboxError(400,'PRIVATE_SUMMARY');assert.equal(rejected.info.code,failureCodes.request);assert.equal(rejected.info.status,400);
 assert.equal(failureText(rejected.info),'Synkronisering feilet (Feilkode SYNC-003)');
});
test('declining valid OAuth consent is a normal cancellation',()=>browser(async()=>{
 const old={sessionStorage:globalThis.sessionStorage,location:globalThis.location,history:globalThis.history},pending=JSON.stringify({state:'known',verifier:'private',redirect:dropboxConfig('test').redirect,created:Date.now()});
 globalThis.sessionStorage={getItem:()=>pending,removeItem(){}};globalThis.location=new URL(dropboxConfig('test').redirect+'?error=access_denied&state=known');globalThis.history={replaceState(){}};
 try{let sent=0;const adapter=dropboxAdapter(env,async()=>{sent++;throw Error('unexpected network');});assert.equal(await adapter.callback(),false);assert.equal(sent,0);}finally{Object.assign(globalThis,old);}
}));
test('a malformed refresh request is distinct from an expired grant and does not discard access',()=>browser(async values=>{
 const key=`${env.namespace}:dropbox-auth-v1`,credentials=JSON.parse(values.get(key));credentials.expires=0;values.set(key,JSON.stringify(credentials));
 const rejected=dropboxAdapter(env,async()=>Response.json({error:'invalid_request'},{status:400}));await assert.rejects(rejected.files.read('/.app/library.json'),e=>e.info.code===failureCodes.request);assert.ok(values.has(key));
 const expired=dropboxAdapter(env,async()=>Response.json({error:'invalid_grant'},{status:400}));await assert.rejects(expired.files.read('/.app/library.json'),e=>e.info.code===failureCodes.authentication);assert.equal(values.has(key),false);
}));
test('diagnostics persist locally, redact content and credentials, and survive missing Dropbox access',()=>browser(async values=>{
 const diagnostics=syncDiagnostics(env),cause=new Error('PRIVATE_NAME PRIVATE_EMAIL PRIVATE_ACCESS PRIVATE_REFRESH');cause.stack='Error: PRIVATE_NAME:12345:6789\n at private (https://PRIVATE_HOST/PRIVATE_PATH:23:4)';
 const {entry}=diagnostics.record(cause,'sync.run',true,[{operation:'files/download',status:500,durationMs:17,headers:'PRIVATE_ACCESS',path:'PRIVATE_PATH'},{operation:'PRIVATE_PATH',status:400,durationMs:5}]);
 await diagnostics.flush({folder:async()=>{throw new Error('offline');}});
 const restored=syncDiagnostics(env),text=restored.text(restored.active());assert.equal(restored.active().id,entry.id);
 for(const forbidden of ['PRIVATE_','accountId','refreshToken','accessToken','headers','userAgent'])assert.ok(!text.includes(forbidden),forbidden);
 assert.equal(entry.environment.browser,'Chrome');assert.equal(entry.environment.browserVersion,'155.0.8059.79');assert.equal(entry.environment.engineVersion,'155.0.8059.79');assert.deepEqual(entry.failure.stack,[{line:23,column:4}]);
 assert.equal(JSON.parse(values.get(`${env.namespace}:sync-diagnostics-v1`)).pending.length,1);
 restored.clear();assert.equal(restored.active(),null);assert.equal(JSON.parse(values.get(`${env.namespace}:sync-diagnostics-v1`)).entries.length,1);
}));
test('bounded cloud log merges entries by ID and retries a failed log upload without losing the local entry',()=>browser(async()=>{
 const d=syncDiagnostics(env);let remote=null,rev=0,fail=true;const files={folder:async()=>({id:'id:app',path:'/.app'}),read:async()=>remote,write:async(path,text,expected)=>{assert.equal(path,'/.app/sync-errors.json');assert.equal(expected,remote?.rev??null);if(fail){fail=false;throw new Error('offline');}return remote={text,rev:String(++rev),id:'id:log',path};}};
 for(let i=0;i<23;i++)d.record(new SyncFailure({code:failureCodes.response,stage:'dropbox.request'},'PRIVATE_CONTENT'),'sync.run',false,[]);
 await new Promise(setImmediate);const last=d.active().id;await d.flush(files);assert.equal(remote,null);assert.equal(d.active().id,last);await d.flush(files);assert.equal(JSON.parse(remote.text).entries.length,20);assert.equal(JSON.parse(remote.text).entries.at(-1).id,last);
 const writes=rev;await d.flush(files);assert.equal(rev,writes);
}));
test('unknown cloud log format is preserved and diagnostics still work when browser storage fails',()=>browser(async()=>{
 const d=syncDiagnostics(env);d.record(new Error('PRIVATE_CONTENT'),'sync.run',true,[]);let writes=0;
 await d.flush({folder:async()=>({id:'id:app',path:'/.app'}),read:async()=>({text:'{"version":99,"account":"PRIVATE_ACCOUNT"}',rev:'old'}),write:async()=>{writes++;}});assert.equal(writes,0);
 globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};const memory=syncDiagnostics(env);assert.doesNotThrow(()=>memory.record(new Error('PRIVATE_CONTENT'),'sync.run',false,[]));assert.ok(memory.active());
}));
test('reports remain associated with their own incident and are never uploaded to another account',()=>browser(async()=>{
 const first=syncDiagnostics(env),a=first.record(new Error('private'),'sync.run',true,[],'PRIVATE_ACCOUNT_A').entry;
 const second=syncDiagnostics(env),b=second.record(new Error('private'),'sync.run',true,[],'PRIVATE_ACCOUNT_B').entry;
 first.clear(a.id);assert.equal(second.active().id,b.id);assert.equal(first.entry(a.id).id,a.id);let text='';
 const files={folder:async()=>({id:'id:app',path:'/.app'}),read:async()=>null,write:async(_path,value)=>{text=value;return {rev:'r',text:value};}};
 await first.flush(files,'PRIVATE_ACCOUNT_A');assert.deepEqual(JSON.parse(text).entries.map(e=>e.id),[a.id]);assert.ok(!text.includes('PRIVATE_ACCOUNT'));
 const state=JSON.parse(localStorage.getItem(`${env.namespace}:sync-diagnostics-v1`));assert.deepEqual(state.pending,[b.id]);
}));
test('known user guidance survives local persistence without storing arbitrary message text',()=>browser(async()=>{
 const d=syncDiagnostics(env);
 d.record(new SyncFailure({code:failureCodes.authentication,stage:'dropbox.request',status:401,action:'reconnect'},'PRIVATE_API_DETAILS'),'sync.run',true,[]);
 const callback=d.record(new DropboxError(401,'PRIVATE_API_DETAILS','dropbox.account'),'dropbox.oauth',false,[],undefined,undefined,false).entry;
 await new Promise(setImmediate);
 const restored=syncDiagnostics(env),entry=restored.active();assert.equal(failureText(entry.failure),'Synkronisering feilet (Feilkode SYNC-004). Koble til Dropbox på nytt.');assert.ok(!restored.text(entry).includes('PRIVATE_API_DETAILS'));
 assert.equal(failureText(restored.entry(callback.id).failure),'Synkronisering feilet (Feilkode SYNC-004)');
}));

test('batch diagnostics retain only resource category, count and transport class, never file names or IDs',()=>browser(async()=>{
 const events=[],adapter=dropboxAdapter(env,async()=>{throw new TypeError('PRIVATE_PATH PRIVATE_ID');},()=>{},event=>events.push(event));
 await assert.rejects(adapter.files.deleteBatch([{key:'PRIVATE_KEY',path:'id:PRIVATE_ID',fileId:'id:PRIVATE_ID',rev:'PRIVATE_REV',category:'personal'}]),error=>error.info.code===failureCodes.network);
 assert.equal(events[0].resource,'personal');assert.equal(events[0].batchSize,1);assert.equal(events[0].transport,'network');assert.equal(events[0].status,0);
 const diagnostics=syncDiagnostics(env);diagnostics.record(new SyncFailure({code:failureCodes.network,stage:'dropbox.request'},'PRIVATE_NAME'),'sync.run',true,[...events,{operation:'files/delete_batch',status:0,durationMs:1,batchSize:Infinity,resource:'PRIVATE_PATH',transport:'PRIVATE_ERROR'}]);
 const report=diagnostics.text(diagnostics.active());assert.equal(report.includes('PRIVATE_'),false);assert.equal(diagnostics.active().operations[1].resource,undefined);assert.equal(diagnostics.active().operations[1].batchSize,undefined);
}));
