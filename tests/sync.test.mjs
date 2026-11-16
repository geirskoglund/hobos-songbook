import {test} from 'node:test';
import assert from 'node:assert/strict';
import {direction, mergeManifest, emptyManifest, newSyncState, emptyJournal, hash, parsePersonal} from '../src/sync/model.ts';
import {syncEngine} from '../src/sync/engine.ts';
import {pkceChallenge, dropboxConfig} from '../src/adapters/dropbox.ts';
const song = (id='one',book='standard',original='{t: En sang}\n[C]Hei') => ({id,songbookId:book,original,title:'En sang',key:null,origin:{kind:'local',filename:'en.txt',importedAt:'2026-01-01'}});
function fixture() {
  let generation=0, rev=0, valid=true, failAfter='', failed=false;
  let data={songs:[song()],songbooks:[{id:'standard',name:'Standard'}],personal:[{songId:'one',version:3,chorus:{},capo:2}],journal:emptyJournal(),state:newSyncState('account')};
  const entries=new Map(),history=new Map(),calls=[];
  const find=path=>path.startsWith('rev:')?history.get(path.slice(4)):path.startsWith('id:')?[...entries.values()].find(e=>e.id===path):entries.get(path.toLowerCase());
  const files={
    async read(path){calls.push(['read',path]);const item=find(path);return item&&!item.folder?structuredClone(item):null;},
    async write(path,text,expected){calls.push(['write',path]);const old=find(path);if(expected?old?.rev!==expected:old)throw Error('409');const value={path,text,rev:String(++rev),id:old?.id??`id:${rev}`};entries.set(path.toLowerCase(),value);history.set(value.rev,structuredClone(value));if(failAfter===path&&!failed){failed=true;throw Error('lost response');}return structuredClone(value);},
    async folder(path,expectedId){let value=find(expectedId??path);if(expectedId&&(!value||value.path.toLowerCase()!==path.toLowerCase()))throw Error('kjent mappe flyttet');if(!value){value={id:`id:${++rev}`,path,folder:true};entries.set(path.toLowerCase(),value);}return structuredClone(value);},
    async locateFolder(id){const value=find(id);return value?.folder?{id:value.id,path:value.path}:null;},
    async move(from,to){calls.push(['move',from,to]);const value=find(from);if(!value)throw Error('missing');if(value.path===to)return structuredClone(value);if(find(to))throw Error('409');const prefix=value.path;for(const [key,e] of [...entries])if(e.path===prefix||e.path.startsWith(prefix+'/')){entries.delete(key);e.path=to+e.path.slice(prefix.length);entries.set(e.path.toLowerCase(),e);}return structuredClone(value);},
    async list(path){calls.push(['list',path]);return [...entries.values()].filter(e=>e.path.toLowerCase().startsWith(path.toLowerCase()+'/')&&!e.path.slice(path.length+1).includes('/')).map(e=>({...e}));},
    async removeEmpty(path){calls.push(['removeEmpty',path]);if((await files.list(path)).length)return false;entries.delete(path.toLowerCase());return true;},
  };
  const storage={async snapshot(){return structuredClone(data);},async commit(expected,state,changes={}){assert.equal(expected,data.journal.generation);if(!valid||Object.keys(data.journal.sessions).length)throw Error('paused');data.state=structuredClone(state);if(changes.recoveryComplete)data.journal.recoveryRequired=false;for(const [field,items,key]of[['songs',changes.songs,'id'],['songbooks',changes.books,'id'],['personal',changes.personal,'songId']])for(const item of items??[]){const i=data[field].findIndex(x=>x[key]===item[key]);if(i<0)data[field].push(structuredClone(item));else data[field][i]=structuredClone(item);}data.songbooks=data.songbooks.filter(b=>!changes.deleteBooks?.includes(b.id));}};
  const run=(manual=true,resolution)=>syncEngine(storage,files,'account',{valid:()=>valid,changed(){}}).run(manual,resolution);
  return {files,storage,run,entries,calls,change(fn){fn(data);data.journal.generation=++generation;},get data(){return data;},set data(value){data=structuredClone(value);},fail(path){failAfter=path;failed=false;},pause(){valid=false;}};
}
test('AK37-01: official clients and RFC7636 S256 vector',async()=>{
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.notEqual(dropboxConfig('production').key,dropboxConfig('test').key);
  assert.equal(dropboxConfig('test').redirect,'https://geirskoglund.github.io/hobos-songbook/test/');
});
test('AK37-04: complete three-way matrix, unknown base, full chorus comparison',()=>{
  for(const [l,r,b,manual,want] of [[1,1,1,true,'same'],[2,1,1,true,'upload'],[1,2,1,true,'download'],[2,3,1,true,'conflict'],[2,2,1,true,'same'],[1,2,1,false,'remote'],[1,2,undefined,true,'conflict'],[1,undefined,undefined,true,'upload']])assert.equal(direction(l,r,b,manual),want);
  assert.equal(direction({chorus:{a:true}},{chorus:{a:false}},{chorus:{}},true),'conflict');
});
test('AK37-09: independent identities merge in either order; unsafe names/rename conflict stop',()=>{
  const base=emptyManifest(),a=emptyManifest(),b=emptyManifest();a.books.a={id:'a',name:'A'};b.books.b={id:'b',name:'B'};
  assert.deepEqual(mergeManifest(base,a,b).books,mergeManifest(base,b,a).books);
  b.books.b.name='A';assert.throws(()=>mergeManifest(base,a,b),/Flere sangbøker/);
  base.books.a={id:'a',name:'Basis'};a.books.a.name='Lokalt';b.books={a:{id:'a',name:'Dropbox'}};assert.throws(()=>mergeManifest(base,a,b),/samordnes trygt/);
});
test('AK37-02/03: empty cloud, BOM/CRLF text, personal sidecar, repeat and new device',async()=>{
  const f=fixture();f.change(d=>d.songs[0].original='\uFEFF{t: Sang}\r\n[C]Ord\r\n{x_future: behold}\r\n');await f.run();
  const manifest=JSON.parse((await f.files.read('/.app/library.json')).text),link=manifest.songs.one;
  assert.equal((await f.files.read(link.path)).text,f.data.songs[0].original);
  const originals=await f.files.list('/Songbooks/Standard/Originals');assert.equal(originals.length,1);assert.equal(originals[0].text,f.data.songs[0].original);
  const person=parsePersonal((await f.files.read('/.app/songs/one.json')).text,'one');assert.equal(person.data.capo,2);assert.equal(person.original.hash,await hash(f.data.songs[0].original));
  const count=f.entries.size;await f.run();assert.equal(f.entries.size,count);
  f.data={songs:[],songbooks:[{id:'standard',name:'Standard'}],personal:[],journal:emptyJournal(),state:newSyncState('account')};await f.run();
  assert.equal(f.data.songs[0].id,'one');assert.equal(f.data.personal[0].capo,2);assert.equal(f.data.songbooks.length,1);
});
test('AK37-04: auto upload preserves timestamp and does not apply remote edits',async()=>{
  const f=fixture();await f.run();const time=f.data.state.lastManual,link=f.data.state.manifest.songs.one;
  let remote=await f.files.read(link.path);await f.files.write(link.path,'{t: Fra Dropbox}\nNy tekst',remote.rev);
  await f.run(false);assert.equal(f.data.songs[0].title,'En sang');assert.equal(f.data.state.lastManual,time);assert.equal(f.data.state.pending,true);
  await f.run(true);assert.equal(f.data.songs[0].title,'Fra Dropbox');
});
test('AK37-05: lost upload response retries same path with no duplicates',async()=>{
  const f=fixture();await f.run();f.change(d=>d.songs[0].original='{t: Ny tekst}\nOrd');const path=f.data.state.manifest.songs.one.path;
  f.fail(path);const result=await f.run();assert.equal(result.pending,true);const count=f.entries.size;
  await f.run();assert.equal(f.entries.size,count);assert.equal(f.data.state.pending,false);
});
test('AK37-06: independent simultaneous conflicts can be deferred and chosen sequentially',async()=>{
  const f=fixture();await f.run();const link=f.data.state.manifest.songs.one;
  const content=await f.files.read(link.path),person=await f.files.read('/.app/songs/one.json');
  await f.files.write(link.path,'{t: Sky}\nSky',content.rev);let p=JSON.parse(person.text);p.data.capo=4;await f.files.write(person.path,JSON.stringify(p),person.rev);
  f.change(d=>{d.songs[0].original='{t: Lokal}\nLokal';d.personal[0].capo=7;});await f.run();assert.equal(f.data.state.conflicts.length,2);const old=(await f.files.read(link.path)).text;
  let c=f.data.state.conflicts.find(c=>c.kind==='content');await f.run(true,{conflict:c,choice:'dropbox'});assert.equal(f.data.state.conflicts.length,1);assert.equal((await f.files.read(link.path)).text,old);
  c=f.data.state.conflicts[0];await f.run(true,{conflict:c,choice:'local'});assert.equal(f.data.state.conflicts.length,0);assert.equal(f.data.songs[0].title,'Sky');assert.equal(f.data.personal[0].capo,7);
});
test('AK37-07: paused or stale generation cannot apply an incoming response',async()=>{
  const f=fixture();await f.run();const before=structuredClone(f.data.songs);const read=f.files.read;f.files.read=async path=>{const result=await read(path);f.pause();return result;};
  await assert.rejects(f.run(),/pauset/);assert.deepEqual(f.data.songs,before);
});
test('AK37-08: rename and deletion preserve unknown Originals and book tombstone',async()=>{
  const f=fixture();await f.run();f.change(d=>d.songbooks[0].name='Endret navn');await f.run();
  assert.equal((await f.files.read('/.app/library.json')).text.includes('Endret navn'),true);assert.equal([...f.entries.values()].some(e=>e.path.startsWith('/Songbooks/Standard/')),false);
  f.change(d=>{d.songbooks.push({id:'target',name:'Mål'});d.songs[0].songbookId='target';d.journal.deletedBooks.standard={id:'standard',name:'Endret navn',deleted:true};d.songbooks=d.songbooks.filter(b=>b.id!=='standard');});await f.run();
  const manifest=JSON.parse((await f.files.read('/.app/library.json')).text);assert.equal(manifest.books.standard.deleted,true);assert.equal((await f.files.list('/Songbooks/Endret navn/Originals')).length,1);assert.match(manifest.songs.one.path,/\/Mål\/Private\//);
  await f.run();assert.equal(f.data.songbooks.some(b=>b.id==='standard'),false);
});
test('AK37-04: independent personal upload does not accept remotely changed content',async()=>{
  const f=fixture();await f.run();const link=f.data.state.manifest.songs.one,old=f.data.songs[0].original;
  const remote=await f.files.read(link.path);await f.files.write(link.path,'{t: Ny skytekst}\nSky',remote.rev);f.change(d=>d.personal[0].capo=5);await f.run(false);
  assert.equal(f.data.songs[0].original,old);assert.equal(f.data.state.conflicts.length,0);const p=JSON.parse((await f.files.read('/.app/songs/one.json')).text);assert.equal(p.data.capo,5);assert.equal(p.original.hash,await hash(old));
  await f.run();assert.equal(f.data.songs[0].title,'Ny skytekst');assert.equal(f.data.personal[0].capo,5);
});
test('AK37-03/06: create new file remaps annotation anchors and retains original identity',async()=>{
  const f=fixture();f.change(d=>{d.personal[0].notes={note:{line:0,text:'Notat'}};d.personal[0].annotations={'source/line:1':{anchor:{songId:'one',sourceLine:1,occurrence:'source/line:1'},highlights:[{start:0,end:3}]}};});await f.run();const link=f.data.state.manifest.songs.one;const remote=await f.files.read(link.path);await f.files.write(link.path,'{t: Sky}\nOrd',remote.rev);f.change(d=>d.songs[0].original='{t: Lokal}\nOrd');await f.run();await f.run(true,{conflict:f.data.state.conflicts[0],choice:'copy'});
  assert.equal(f.data.songs.find(s=>s.id==='one').title,'Sky');const copy=f.data.songs.find(s=>s.id!=='one');assert.ok(copy);assert.equal(copy.original,'{t: Lokal}\nOrd');assert.equal(f.data.personal.find(p=>p.songId===copy.id).annotations['source/line:1'].anchor.songId,copy.id);
  await f.run(false);assert.equal(Object.keys(JSON.parse((await f.files.read('/.app/library.json')).text).songs).length,2);
});
test('AK37-01: single-use callback, exact environment, granted scopes, refresh, disconnect and revoked access',async()=>{
  const env={channel:'test',namespace:'hobos-songbook-test'},values=new Map(),pending=new Map();
  const old={localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,location:globalThis.location,history:globalThis.history,navigator:globalThis.navigator};
  const mem=map=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
  let loc=new URL(dropboxConfig('test').redirect+'?code=one-use&state=known'),requests=[],revoked=false;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name,run)=>run()}}});
  globalThis.localStorage=mem(values);globalThis.sessionStorage=mem(pending);globalThis.location=loc;globalThis.history={replaceState(_state,_unused,path){loc=new URL(path,loc);globalThis.location=loc;}};
  const {dropboxAdapter,requiredScopes}=await import('../src/adapters/dropbox.ts');
  const adapter=dropboxAdapter(env,async(url,options)=>{
    requests.push({url,options});if(url.endsWith('/oauth2/token'))return new Response(JSON.stringify({access_token:'access',refresh_token:'refresh',expires_in:0,account_id:'dbid:one',scope:requiredScopes.join(' ')}));
    if(url.endsWith('/get_current_account'))return new Response(JSON.stringify({account_id:'dbid:one',name:{display_name:'Navn'},email:'navn@eksempel.no'}));
    if(url.endsWith('/token/revoke')){revoked=true;return new Response('null');}
    return new Response(JSON.stringify({error_summary:'expired_access_token/'}),{status:401});
  });
  try {
    pending.set('hobos-songbook-test:dropbox-pkce-v1',JSON.stringify({state:'known',verifier:'verifier',redirect:dropboxConfig('test').redirect,created:Date.now()}));assert.equal(await adapter.callback(),true);assert.equal(loc.search,'');assert.equal(await adapter.callback(),false);assert.equal(adapter.account().id,'dbid:one');
    await assert.rejects(adapter.files.read('/.app/library.json'),/Koble til på nytt/);assert.equal(adapter.account(),null);assert.ok(requests.some(r=>r.options.body instanceof URLSearchParams&&r.options.body.get('grant_type')==='refresh_token'));
    globalThis.location=new URL(dropboxConfig('test').redirect+'?code=replay&state=known');await assert.rejects(adapter.callback(),/ugyldig eller utløpt/);
    values.set('hobos-songbook-test:dropbox-auth-v1',JSON.stringify({version:1,accountId:'dbid:one',refreshToken:'refresh',accessToken:'access'}));assert.equal(await adapter.disconnect(),true);assert.equal(revoked,true);assert.equal(values.size,0);
    assert.equal(dropboxAdapter({...env,channel:'production',namespace:'hobos-songbook-production'}).account(),null);
  } finally {for(const [key,value]of Object.entries(old))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
});
test('AK37-09: two devices upload independent books/songs in both orders without automatic local import',async()=>{
 for(const reverse of [false,true]){
  const a=fixture(),b=fixture();a.change(d=>{d.songbooks.push({id:'a',name:'A'});d.songs[0].songbookId='a';});b.change(d=>{d.songbooks.push({id:'b',name:'B'});d.songs=[song('two','b')];d.personal=[{songId:'two',version:3,chorus:{},tuning:'DADGAD'}];});
  const runA=manual=>syncEngine(a.storage,a.files,'account',{valid:()=>true,changed(){}}).run(manual),runB=manual=>syncEngine(b.storage,a.files,'account',{valid:()=>true,changed(){}}).run(manual);
  if(reverse){await runB(false);await runA(false);}else{await runA(false);await runB(false);}
  assert.equal(a.data.songs.length,1);assert.equal(b.data.songs.length,1);assert.equal(Object.keys(JSON.parse((await a.files.read('/.app/library.json')).text).songs).length,2);
  await runA(true);await runB(true);assert.deepEqual(a.data.songs.map(s=>s.id).sort(),['one','two']);assert.deepEqual(b.data.songs.map(s=>s.id).sort(),['one','two']);assert.deepEqual(a.data.songbooks.map(s=>s.id).sort(),['a','b','standard']);
 }
});
test('AK37-08/09: reused name cannot adopt the physical remnant of a deleted book',async()=>{
 const f=fixture();await f.run();f.change(d=>{d.songbooks.push({id:'target',name:'Mål'});d.songs[0].songbookId='target';d.journal.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};d.songbooks=d.songbooks.filter(b=>b.id!=='standard');});await f.run();f.change(d=>d.songbooks.push({id:'different',name:'Standard'}));await assert.rejects(f.run(),/tilhører en annen eller slettet/);assert.equal(f.data.state.pending,true);assert.equal((await f.files.list('/Songbooks/Standard/Originals')).length,1);
});
test('AK37-06: a dialog choice cannot overwrite a Dropbox revision created while it was open',async()=>{
 const f=fixture();await f.run();const link=f.data.state.manifest.songs.one;let remote=await f.files.read(link.path);await f.files.write(link.path,'{t: Sky én}\nOrd',remote.rev);f.change(d=>d.songs[0].original='{t: Lokal}\nOrd');await f.run();const conflict=f.data.state.conflicts[0];remote=await f.files.read(link.path);const newer=await f.files.write(link.path,'{t: Sky to}\nNyere',remote.rev);await f.run(true,{conflict,choice:'local'});assert.equal((await f.files.read(link.path)).text,newer.text);assert.equal(f.data.state.conflicts[0].contentRev,newer.rev);assert.equal(f.data.songs[0].original,'{t: Lokal}\nOrd');
});
test('AK37-08: real adapter checks all listing pages and keeps a folder with later-page content',async()=>{
 const {dropboxAdapter}=await import('../src/adapters/dropbox.ts');const old=globalThis.localStorage;const calls=[];
 globalThis.localStorage={getItem:()=>JSON.stringify({version:1,accountId:'account',refreshToken:'refresh',accessToken:'access',expires:Date.now()+3600000})};const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_key,run)=>run()}}});
 const adapter=dropboxAdapter({channel:'test',namespace:'hobos-songbook-test'},async(url,options)=>{
  const body=JSON.parse(options.body??'null');calls.push(url);
  if(url.endsWith('/get_metadata'))return Response.json({'.tag':'folder',id:'id:folder',path_display:'/Songbooks/Bok'});
  if(url.endsWith('/list_folder'))return Response.json({entries:[],has_more:true,cursor:'page2'});
  if(url.endsWith('/list_folder/continue')){assert.equal(body.cursor,'page2');return Response.json({entries:[{'.tag':'file',id:'id:unknown',path_display:'/Songbooks/Bok/ukjent.pdf'}],has_more:false});}
  throw Error('Unexpected delete or endpoint');
 });
 try {assert.equal(await adapter.files.removeEmpty('/Songbooks/Bok'),false);assert.ok(calls.some(url=>url.endsWith('/list_folder/continue')));assert.ok(!calls.some(url=>url.endsWith('/delete_v2')));}
 finally {globalThis.localStorage=old;if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
test('AK37-08: manual sync follows a folder rename with the same book and folder identities',async()=>{
 const f=fixture();await f.run();const book=f.data.state.manifest.books.standard;await f.files.move(book.folderId,'/Songbooks/Nytt navn');await f.run();assert.equal(f.data.songbooks[0].name,'Nytt navn');assert.equal(f.data.songbooks[0].id,'standard');assert.equal(f.data.state.manifest.books.standard.folderId,book.folderId);assert.equal((await f.files.list('/Songbooks/Nytt navn/Originals')).length,1);assert.equal([...f.entries.values()].some(e=>e.path.startsWith('/Songbooks/Standard')),false);await f.run();assert.equal(f.data.songbooks.length,1);
});
test('AK37-01/05/07: adapter awaits the account/session guard again after acquiring a token',async()=>{
 const {dropboxAdapter}=await import('../src/adapters/dropbox.ts');const oldStorage=globalThis.localStorage,descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let current='a',sent=0;
 globalThis.localStorage={getItem:()=>JSON.stringify({version:1,accountId:current,refreshToken:'refresh',accessToken:current,expires:Date.now()+3600000})};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_key,run)=>{current='b';return run();}}}});
 const adapter=dropboxAdapter({channel:'test',namespace:'hobos-songbook-test'},async()=>{sent++;return Response.json({});},async()=>{await Promise.resolve();if(adapter.account()?.id!=='a')throw Error('connection changed');});
 try{await assert.rejects(adapter.files.write('/.app/library.json','{}',null),/connection changed/);assert.equal(sent,0);}
 finally{globalThis.localStorage=oldStorage;if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
test('AK37-05/07: crash keeps dirty work until manual sync, including failed sync and ordinary conflicts',async()=>{
 const f=fixture();await f.run();const id=f.data.state.manifest.songs.one.path;let remote=await f.files.read(id);await f.files.write(id,'{t: Dropbox etter krasj}\nSky',remote.rev);f.change(d=>{d.journal.recoveryRequired=true;d.songs[0].original='{t: Lokal etter krasj}\nLokal';});const before=f.calls.length;
 await assert.rejects(f.run(false),/venter på Synkroniser/);assert.equal(f.calls.length,before);assert.equal(f.data.journal.recoveryRequired,true);await f.run(true);assert.equal(f.data.state.conflicts.length,1);assert.equal(f.data.journal.recoveryRequired,true);await f.run(true,{conflict:f.data.state.conflicts[0],choice:'local'});assert.equal(f.data.journal.recoveryRequired,false);assert.equal((await f.files.read(id)).text,'{t: Lokal etter krasj}\nLokal');
});
test('AK37-08: a new empty Dropbox folder becomes exactly one book only on manual sync',async()=>{
 const f=fixture();await f.run();await f.files.folder('/Songbooks/Tom fra Dropbox');await f.run(false);assert.equal(f.data.songbooks.length,1);await f.run();const book=f.data.songbooks.find(b=>b.name==='Tom fra Dropbox');assert.ok(book);await f.run();assert.equal(f.data.songbooks.filter(b=>b.name===book.name).length,1);assert.equal((await f.files.list('/Songbooks/Tom fra Dropbox')).length,4);
});
test('AK37-08: interrupted case rename resumes its recorded operation instead of adopting the temporary name',async()=>{
 const f=fixture();await f.run();f.change(d=>d.songbooks[0].name='sTANDARD');const move=f.files.move;let first=true;f.files.move=async(from,to)=>{const value=await move(from,to);if(first){first=false;throw Error('lost move response');}return value;};await assert.rejects(f.run(),/lost move response/);assert.ok(f.data.state.renames.standard);await f.run();assert.equal(f.data.songbooks[0].name,'sTANDARD');assert.equal(f.data.state.renames.standard,undefined);assert.equal(f.data.songbooks.length,1);assert.equal((await f.files.list('/Songbooks/sTANDARD/Originals')).length,1);
});
test('AK37-08/09: a physically new folder at a deleted book name gets a new identity',async()=>{
 const f=fixture();await f.run();f.change(d=>{d.songbooks.push({id:'target',name:'Mål'});d.songs[0].songbookId='target';d.journal.deletedBooks.standard={id:'standard',name:'Standard',deleted:true};d.songbooks=d.songbooks.filter(b=>b.id!=='standard');});await f.run();for(const [key,value]of[...f.entries])if(value.path==='/Songbooks/Standard'||value.path.startsWith('/Songbooks/Standard/'))f.entries.delete(key);await f.files.folder('/Songbooks/Standard');await f.run();await f.run();const newBook=f.data.songbooks.find(b=>b.name==='Standard');assert.ok(newBook);assert.notEqual(newBook.id,'standard');assert.equal(f.data.state.manifest.books.standard.deleted,true);
});
