import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSync} from '../src/sync/engine.ts';
import {dropbox,DropboxError,pkceChallenge,appKeys} from '../src/sync/dropbox.ts';
import {emptySyncState,dirtySong,songPath,collisionPath,validSharedLink,accessLabel} from '../src/domain/sync.ts';
import {newSong} from '../src/domain/original.ts';
import {withOriginal} from '../src/domain/original.ts';
import {createEditSession} from '../src/domain/edit-session.ts';
const auth={account_id:'account-one',access_token:'mock-access',refresh_token:'mock-refresh',expires:Date.now()+3600000};
function library(songs=[]){const state=emptySyncState();state.owner=auth.account_id;state.auth={...auth};return {songs,personal:[],songbooks:[{id:'standard',name:'Standard'},{id:'band',name:'Band A'}],setlists:[],state};}
function memory(initial=library()){
 let value=structuredClone(initial),tail=Promise.resolve();
 return {syncData:async()=>structuredClone(value),syncTransaction(fn){const next=tail.then(()=>{const draft=structuredClone(value),result=fn(draft);value=draft;return structuredClone(result);});tail=next.catch(()=>{});return next;},async editing(id,editing){await this.syncTransaction(data=>{data.state.songs[id]??={id:`song:${id}`,songId:id,generation:0,dirty:false,editing:false};data.state.songs[id].editing=editing;});}};
}
function remote(){
 let revision=0;const files=new Map(),writes=[],sourceFiles=new Map();
 const info=(path,text='',tag='file')=>({'.tag':tag,id:`id:${++revision}`,name:path.split('/').pop(),path_display:path,path_lower:path.toLowerCase(),rev:String(++revision),size:Buffer.byteLength(text),text});
 const add=(path,text,tag='file')=>{const item=info(path,text,tag);files.set(item.id,item);return item;};
 const api={
 async list(){return [...files.values()].map(item=>({...item}));},
 async download(file){const item=files.get(file.id);if(!item)throw new DropboxError(409,'path/not_found','download');return {text:item.text,file:{id:item.id,rev:item.rev,path:item.path_display}};},
 async upload(path,text,rev){const current=[...files.values()].find(item=>item.path_lower===path.toLowerCase());if(current?rev!==current.rev:Boolean(rev))throw new DropboxError(409,current?'path/conflict/file':'path/not_found','upload');const item=current??add(path,text);item.text=text;item.rev=String(++revision);writes.push({path,text,rev});return {id:item.id,rev:item.rev,path:item.path_display};},
 async folder(path){let entry=[...files.values()].find(item=>item.path_lower===path.toLowerCase());if(entry&&entry['.tag']!=='folder')throw new DropboxError(409,'path/conflict/file','folder');return entry??add(path,'','folder');},
 async move(file,path){if([...files.values()].some(item=>item.path_lower===path.toLowerCase()))throw new DropboxError(409,'to/conflict/file','move');const item=files.get(file.id);if(!item)throw new DropboxError(409,'from_lookup/not_found','move');item.path_display=path;item.path_lower=path.toLowerCase();item.name=path.split('/').pop();writes.push({move:path});return {id:item.id,rev:item.rev,path};},
 async sourceFiles(url){const entry=sourceFiles.get(url);if(entry instanceof Error)throw entry;return entry??[];},
 async sourceText(url,file){return file.text;},async link(path){return `https://www.dropbox.com/scl/fo/mock/${encodeURIComponent(path)}`;},async revoke(){},async account(){return {account_id:auth.account_id};},
 };return {api,files,writes,add,sourceFiles};
}
const song=(title='Sang')=>withOriginal({...newSong(),songbookId:'band'},`\uFEFF{t: ${title}}\r\n{key: D}\r\n[D]Ord\r\n`);
const trackAll=async store=>store.syncTransaction(data=>{for(const song of data.songs)data.state.songs[song.id]=dirtySong(song.id);});
const engine=(store,cloud,protectedSong=()=>false)=>createSync(store,{namespace:'hobos-songbook-test',channel:'test',api:cloud.api,automatic:false,protectedSong,changed:()=>{},status:()=>{}});
const filesOf=cloud=>[...cloud.files.values()].filter(file=>/^\/(Private|Shared|Import)\//.test(file.path_display)&&file['.tag']==='file');

test('filenames, access and shared links preserve the simple product model',()=>{
 const item=song('A/B');assert.equal(songPath(item,[]),'/Private/A-B.cho');item.sync={access:'shared'};assert.throws(()=>songPath({...item,songbookId:'standard'},[{id:'standard',name:'Standard'}]));assert.equal(songPath(item,[{id:'band',name:'Band A'}]),'/Shared/Band A/A-B.cho');assert.equal(collisionPath('/Private/Sang.cho',1),'/Private/Sang (2).cho');assert.throws(()=>validSharedLink('https://www.dropbox.com.attacker.example/f'));assert.throws(()=>validSharedLink('javascript:alert(1)'));assert.equal(validSharedLink('https://www.dropbox.com/scl/fo/a?rlkey=b&dl=0'),'https://www.dropbox.com/scl/fo/a?rlkey=b');assert.equal(appKeys.production,'9hivdq3nxrgtquz');
});
test('PKCE matches the RFC7636 vector',async()=>assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'));
test('imported source is guarded at the common edit-session boundary, including history',()=>{
 const item={...song(),sync:{access:'import'}},session=createEditSession(item,{songId:item.id,chorus:{}});
 assert.throws(()=>session.replaceOriginal({...item,original:'overskrevet'}),/skrivebeskyttet/);session.update(state=>({...state,capo:3}));session.undo();assert.equal(session.song.original,item.original);assert.equal(session.personal.capo,undefined);session.redo();assert.equal(session.personal.capo,3);
});
test('local draft and personal data stay off Dropbox across restart until editing ends',async()=>{
 const item=song(),store=memory(library([item])),cloud=remote();await trackAll(store);await store.editing(item.id,true);
 await engine(store,cloud).synchronize();assert.equal(filesOf(cloud).length,0);
 const restarted=engine(memory(await store.syncData()),cloud);await restarted.synchronize();assert.equal(filesOf(cloud).length,0);
 await store.editing(item.id,false);await engine(store,cloud).synchronize();assert.equal(filesOf(cloud).length,1);assert.equal(filesOf(cloud)[0].text,item.original);assert.equal((await store.syncData()).state.songs[item.id].dirty,false);
});
test('another device reads per-song personal data and preserves exact source bytes',async()=>{
 const item=song(),first=memory(library([item])),cloud=remote();await trackAll(first);await first.syncTransaction(data=>data.personal.push({songId:item.id,chorus:{},version:3,capo:2,notes:{one:{line:0,text:'Husk'}}}));await engine(first,cloud).synchronize();
 const second=memory(library());await engine(second,cloud).synchronize();const received=await second.syncData();assert.equal(received.songs[0].id,item.id);assert.equal(received.songs[0].original,item.original);assert.equal(received.personal[0].notes.one.text,'Husk');assert.equal(received.personal[0].capo,2);assert.equal(filesOf(cloud).length,1);
});
test('publishing and unpublishing preserve file identity and hide private personal data',async()=>{
 const item=song(),store=memory(library([item])),cloud=remote(),sync=engine(store,cloud);await trackAll(store);await sync.synchronize();const id=filesOf(cloud)[0].id;
 await sync.access(item.id,'shared');assert.match(accessLabel((await store.syncData()).songs[0]),/venter/);await sync.synchronize();assert.equal(filesOf(cloud)[0].id,id);assert.equal(filesOf(cloud)[0].path_display,'/Shared/Band A/Sang.cho');assert.equal((await store.syncData()).songs[0].sync.pending,false);assert.ok(cloud.writes.filter(write=>write.path?.startsWith('/Shared/')).every(write=>!write.text.includes('personal')));
 await sync.access(item.id,'private');await sync.synchronize();assert.equal(filesOf(cloud)[0].id,id);assert.equal(filesOf(cloud)[0].path_display,'/Private/Sang.cho');
});
test('manual copies and same titles stay independent and use readable collision names',async()=>{
 const one=song(),two=song(),store=memory(library([one,two])),cloud=remote();await trackAll(store);await engine(store,cloud).synchronize();assert.deepEqual(filesOf(cloud).map(file=>file.name).sort(),['Sang (2).cho','Sang.cho']);cloud.add('/Private/Manuell.cho',one.original);await engine(store,cloud).synchronize();assert.equal((await store.syncData()).songs.length,3);assert.equal(new Set((await store.syncData()).songs.map(song=>song.id)).size,3);
});
test('an external edit conflicts with a ready local edit without overwriting either version',async()=>{
 const item=song(),store=memory(library([item])),cloud=remote(),sync=engine(store,cloud);await trackAll(store);await sync.synchronize();const file=filesOf(cloud)[0];file.text=file.text.replace('Ord','Dropbox');file.rev='external';await store.syncTransaction(data=>{data.songs[0].original=data.songs[0].original.replace('Ord','Lokalt');data.state.songs[item.id]=dirtySong(item.id,data.state.songs[item.id]);});await sync.synchronize();const state=await store.syncData();assert.match(state.songs[0].original,/Lokalt/);assert.match(filesOf(cloud)[0].text,/Dropbox/);assert.equal(state.state.conflicts.length,1);assert.match(JSON.stringify(state.state.conflicts[0].remote),/Dropbox/);assert.equal(state.state.songs[item.id].dirty,true);
});
test('a deleted band folder is not recreated by pending edits; keep-private asks for a target in the UI',async()=>{
 const item={...song(),sync:{access:'shared'}},store=memory(library([item])),cloud=remote(),sync=engine(store,cloud);await trackAll(store);await sync.synchronize();await store.syncTransaction(data=>{data.songs[0].original+='Uferdig';data.state.songs[item.id]=dirtySong(item.id,data.state.songs[item.id],true);});for(const [id,file]of cloud.files)if(file.path_display.startsWith('/Shared/'))cloud.files.delete(id);cloud.writes.length=0;await sync.synchronize();let state=await store.syncData();assert.equal(state.songs[0].sync.deleted,true);assert.match(state.songs[0].original,/Uferdig/);assert.equal(state.songbooks.some(book=>book.id==='band'),true);assert.equal(filesOf(cloud).length,0);assert.equal(cloud.writes.some(write=>write.path?.startsWith('/Shared/')),false);
 await sync.keepPrivate(item.id,'standard');await sync.synchronize();state=await store.syncData();assert.equal(state.songs[0].id,item.id);assert.equal(state.songs[0].songbookId,'standard');assert.equal(filesOf(cloud)[0].path_display,'/Private/Sang.cho');
});
test('external sources are manual; failure of one leaves other sources and downloaded copies intact',async()=>{
 const store=memory(),cloud=remote(),sync=engine(store,cloud);const one={id:'one',name:'En',url:'https://www.dropbox.com/s/a',songbookId:'band'},two={id:'two',name:'To',url:'https://www.dropbox.com/s/b',songbookId:'band'};await sync.saveSource(one);await sync.saveSource(two);cloud.sourceFiles.set(one.url,[{'.tag':'file',id:'source:one',name:'Sang.txt',relative:'/Sang.txt',rev:'1',text:'{t: Kildesang}\n[D]Hei'}]);cloud.sourceFiles.set(two.url,new Error('Tilgangen er tilbakekalt'));
 await sync.synchronize();assert.equal((await store.syncData()).songs.length,0);await sync.synchronize(['one','two']);let state=await store.syncData();assert.equal(state.songs.length,1);assert.equal(state.songs[0].sync.access,'import');assert.equal(state.state.config.sources[1].error,'Tilgangen er tilbakekalt');assert.equal(filesOf(cloud)[0].path_display,'/Import/Kildesang.txt');
 cloud.sourceFiles.set(one.url,new Error('Lenken er borte'));await sync.synchronize(['one']);state=await store.syncData();assert.equal(state.songs[0].sync.deleted,undefined);await sync.removeSource('one');assert.equal((await store.syncData()).songs[0].sync.detached,true);assert.equal((await store.syncData()).songs[0].sync.access,'import');
});
test('an older upload acknowledgement cannot clear edits made during the request',async()=>{
 const item=song(),store=memory(library([item])),cloud=remote(),sync=engine(store,cloud);await trackAll(store);await sync.synchronize();await store.syncTransaction(data=>{data.songs[0].original+='Første';data.state.songs[item.id]=dirtySong(item.id,data.state.songs[item.id]);});const upload=cloud.api.upload;let injected=false;cloud.api.upload=async(...args)=>{const result=await upload(...args);if(!injected&&args[0].startsWith('/.app/songs/')){injected=true;await store.syncTransaction(data=>{data.songs[0].original+=' Nyere';data.state.songs[item.id]=dirtySong(item.id,data.state.songs[item.id],true);});}return result;};await sync.synchronize();assert.equal((await store.syncData()).state.songs[item.id].dirty,true);assert.match((await store.syncData()).songs[0].original,/Nyere/);
});
test('revision upload uses strict_conflict, exact rev, and UTF-8-safe Dropbox arguments',async()=>{
 const calls=[],api=dropbox(async()=>auth,async()=>{},appKeys.test,async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({id:'id:a',rev:'next',path_display:'/Private/Blå.cho'}));});await api.upload('/Private/Blå.cho','\uFEFFtekst\r\n','previous');const arg=JSON.parse(calls[0].options.headers['Dropbox-API-Arg']);assert.deepEqual(arg.mode,{'.tag':'update',update:'previous'});assert.equal(arg.strict_conflict,true);assert.equal(arg.autorename,false);assert.equal(arg.path,'/Private/Blå.cho');assert.equal(calls[0].options.body,'\uFEFFtekst\r\n');
});

test('pre-existing local songs join the outbox on first connection without losing identity',async()=>{
 const item=song(),store=memory(library([item])),cloud=remote();await engine(store,cloud).synchronize();assert.equal(filesOf(cloud).length,1);assert.equal((await store.syncData()).songs[0].id,item.id);
});
test('distinct book names that sanitize to one name get separate shared folders',async()=>{
 const one={...song('En'),songbookId:'one',sync:{access:'shared'}},two={...song('To'),songbookId:'two',sync:{access:'shared'}},initial=library([one,two]);initial.songbooks.push({id:'one',name:'A/B'},{id:'two',name:'A-B'});const store=memory(initial),cloud=remote();await engine(store,cloud).synchronize();assert.deepEqual(filesOf(cloud).map(file=>file.path_display).sort(),['/Shared/A-B (2)/To.cho','/Shared/A-B/En.cho']);
});
test('folder renaming retains the book identity and nested files use the same book',async()=>{
 const cloud=remote(),folder=cloud.add('/Shared/Start','','folder');cloud.add('/Shared/Start/Under/Sang.cho',song().original);const store=memory();await engine(store,cloud).synchronize();const before=await store.syncData(),bookId=before.songs[0].songbookId;assert.ok(filesOf(cloud).some(file=>file.path_display==='/Shared/Start/Under/Sang.cho'));folder.path_display='/Shared/Nytt';folder.path_lower='/shared/nytt';folder.name='Nytt';for(const file of cloud.files.values())if(file.path_display.startsWith('/Shared/Start/')){file.path_display=file.path_display.replace('/Shared/Start/','/Shared/Nytt/');file.path_lower=file.path_display.toLowerCase();}await engine(store,cloud).synchronize();assert.equal((await store.syncData()).songs[0].songbookId,bookId);assert.equal((await store.syncData()).songbooks.find(book=>book.id===bookId).name,'Nytt');
});
test('adapter downloads retain the UTF-8 BOM and shared-link listing traverses and paginates',async()=>{
 const calls=[],api=dropbox(async()=>auth,async()=>{},appKeys.test,async(url,options)=>{
  const endpoint=new URL(url).pathname,args=JSON.parse(options.headers['Dropbox-API-Arg']??options.body);calls.push({endpoint,args});
  if(endpoint.endsWith('/download'))return new Response(Buffer.from('\uFEFF{t: Original}\r\n'),{headers:{'Dropbox-API-Result':JSON.stringify({id:'file',rev:'1',path_display:'/Private/Test.cho'})}});
  const body=endpoint.endsWith('/continue')?{entries:[{'.tag':'folder',name:'Under',id:'folder'}],cursor:'done',has_more:false}:args.path===''?{entries:[{'.tag':'file',id:'one',name:'En.cho'}],has_more:true,cursor:'root'}:{entries:[{'.tag':'file',id:'two',name:'To.cho'}],has_more:false,cursor:'nested'};
  return new Response(JSON.stringify(body));
 });assert.equal((await api.download({id:'file'})).text,'\uFEFF{t: Original}\r\n');const files=await api.sourceFiles('https://www.dropbox.com/s/test');assert.deepEqual(files.map(file=>file.relative),['/En.cho','/Under/To.cho']);assert.equal(calls.find(call=>call.endpoint.endsWith('/list_folder')).args.recursive,false);assert.equal(calls.filter(call=>call.endpoint.endsWith('/continue')).length,1);
});

test('keep-private updates existing metadata and another device recovers the same ID and personal data',async()=>{
 const item={...song(),sync:{access:'shared'}},store=memory(library([item])),cloud=remote(),sync=engine(store,cloud);await store.syncTransaction(data=>data.personal.push({songId:item.id,chorus:{},version:3,capo:4}));await sync.synchronize();for(const [id,file]of cloud.files)if(file.path_display.startsWith('/Shared/'))cloud.files.delete(id);await sync.synchronize();await sync.keepPrivate(item.id,'standard');await sync.synchronize();assert.equal((await store.syncData()).state.songs[item.id].dirty,false);const other=memory(library());await engine(other,cloud).synchronize();assert.equal((await other.syncData()).songs[0].id,item.id);assert.equal((await other.syncData()).personal[0].capo,4);
});
test('keep-private from a disconnected import moves its app copy and preserves the metadata revision',async()=>{
 const store=memory(),cloud=remote(),sync=engine(store,cloud),source={id:'source',name:'Band',url:'https://www.dropbox.com/s/source',songbookId:'band'};await sync.saveSource(source);cloud.sourceFiles.set(source.url,[{'.tag':'file',id:'source:file',rev:'1',name:'Sang.cho',relative:'/Sang.cho',text:song().original}]);await sync.synchronize(['source']);const item=(await store.syncData()).songs[0];await sync.removeSource(source.id);await sync.synchronize();await sync.keepPrivate(item.id,'standard');await sync.synchronize();const state=await store.syncData();assert.equal(state.state.songs[item.id].dirty,false);assert.equal(filesOf(cloud).length,1);assert.equal(filesOf(cloud)[0].path_display,'/Private/Sang.cho');const second=memory(library());await engine(second,cloud).synchronize();assert.equal((await second.syncData()).songs[0].id,item.id);assert.equal((await second.syncData()).songs[0].sync.access,'private');
});

test('expired access tokens refresh once for simultaneous requests and keep the refresh token private',async()=>{
 let current={...auth,expires:0},refreshes=0,saves=0;const api=dropbox(async()=>current,async value=>{current=value;saves++;},appKeys.test,async(url,options)=>{
  if(url.endsWith('/oauth2/token')){refreshes++;const form=new URLSearchParams(options.body);assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('refresh_token'),auth.refresh_token);assert.equal(form.has('client_secret'),false);return new Response(JSON.stringify({access_token:'fresh-access',expires_in:3600}));}
  assert.equal(options.headers.Authorization,'Bearer fresh-access');return new Response('innhold',{headers:{'Dropbox-API-Result':JSON.stringify({id:'file',rev:'1',path_display:'/Private/Fil.cho'})}});
 });await Promise.all([api.download({id:'file'}),api.download({id:'file'})]);assert.equal(refreshes,1);assert.equal(saves,1);assert.equal(current.refresh_token,auth.refresh_token);
});
test('OAuth callback verifies state, sends the PKCE verifier and removes the code from the URL',async t=>{
 const {authorize,finishAuthorization}=await import('../src/sync/dropbox.ts');const originals={};for(const name of ['location','sessionStorage','history'])originals[name]=Object.getOwnPropertyDescriptor(globalThis,name);
 t.after(()=>{for(const [name,descriptor]of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 const values=new Map(),location={origin:'https://geirskoglund.github.io',pathname:'/hobos-songbook/test/',href:'https://geirskoglund.github.io/hobos-songbook/test/',assign(url){this.authorizeUrl=url;}};
 Object.defineProperty(globalThis,'location',{value:location,configurable:true});Object.defineProperty(globalThis,'sessionStorage',{value:{setItem:(key,value)=>values.set(key,value),getItem:key=>values.get(key),removeItem:key=>values.delete(key)},configurable:true});Object.defineProperty(globalThis,'history',{value:{replaceState(state,title,path){location.href=location.origin+path;}},configurable:true});
 await authorize('test',appKeys.test,location.href);const url=new URL(location.authorizeUrl),pending=JSON.parse(values.get('test:oauth'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_challenge'),await pkceChallenge(pending.verifier));assert.equal(url.searchParams.has('client_secret'),false);location.href+='?code=mock-code&state='+pending.state;
 const result=await finishAuthorization('test',appKeys.test,async(url,options)=>{const args=new URLSearchParams(options.body);assert.equal(args.get('code_verifier'),pending.verifier);assert.equal(args.get('redirect_uri'),pending.redirect);return new Response(JSON.stringify({...auth,expires_in:3600}));});assert.equal(result.account_id,auth.account_id);assert.equal(values.size,0);assert.equal(new URL(location.href).search,'');
 values.set('test:oauth',JSON.stringify(pending));location.href+='?code=never-redeem&state=wrong';let fetched=false;await assert.rejects(()=>finishAuthorization('test',appKeys.test,async()=>{fetched=true;}),/annen fane/);assert.equal(fetched,false);assert.equal(new URL(location.href).search,'');
});

test('switching a published book never returns the old audience link under the new book name',async()=>{
 const item={...song(),sync:{access:'shared'}},store=memory(library([item])),cloud=remote(),sync=engine(store,cloud);await sync.synchronize();await store.syncTransaction(data=>data.songbooks.push({id:'second-band',name:'Band B'}));await sync.changeBook(item.id,'second-band');await assert.rejects(()=>sync.share('second-band'),/venter/);await sync.synchronize();assert.match(await sync.share('second-band'),/Band%20B/);assert.equal((await store.syncData()).songs[0].id,item.id);
});

test('connecting a different account revokes the new authorization before any local library upload',async t=>{
 const originals={};for(const name of ['location','sessionStorage','history','fetch'])originals[name]=Object.getOwnPropertyDescriptor(globalThis,name);t.after(()=>{for(const[name,descriptor]of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 const redirect='https://geirskoglund.github.io/hobos-songbook/test/',values=new Map([['hobos-songbook-test:oauth',JSON.stringify({state:'nonce',verifier:'verifier',redirect,created:Date.now()})]]),location={origin:'https://geirskoglund.github.io',pathname:'/hobos-songbook/test/',href:redirect+'?code=code&state=nonce'};Object.defineProperty(globalThis,'location',{value:location,configurable:true});Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:key=>values.get(key),removeItem:key=>values.delete(key)},configurable:true});Object.defineProperty(globalThis,'history',{value:{replaceState(state,title,path){location.href=location.origin+path;}},configurable:true});let revoked=false;
 Object.defineProperty(globalThis,'fetch',{value:async(url,options)=>{if(url.endsWith('/oauth2/token'))return new Response(JSON.stringify({account_id:'other-account',access_token:'other-access',refresh_token:'other-refresh',expires_in:3600}));assert.equal(url,'https://api.dropboxapi.com/2/auth/token/revoke');assert.equal(options.headers.Authorization,'Bearer other-access');revoked=true;return new Response('null');},configurable:true});const initial=library([song()]);delete initial.state.auth;const store=memory(initial),cloud=remote(),sync=engine(store,cloud);await sync.initialize();assert.equal(revoked,true);assert.equal((await store.syncData()).state.owner,auth.account_id);assert.equal((await store.syncData()).state.auth,undefined);assert.equal(cloud.writes.length,0);assert.match(sync.getStatus().message,/annen Dropbox-konto/);
});

test('removing a source during an in-flight download preserves the detached version already on the device',async()=>{
 const store=memory(),cloud=remote(),sync=engine(store,cloud),source={id:'source',name:'Band',url:'https://www.dropbox.com/s/source',songbookId:'band'};await sync.saveSource(source);const entry={'.tag':'file',id:'source:file',rev:'1',name:'Sang.cho',relative:'/Sang.cho',text:song().original};cloud.sourceFiles.set(source.url,[entry]);await sync.synchronize(['source']);const before=(await store.syncData()).songs[0];entry.rev='2';entry.text=entry.text.replace('Ord','Ny tekst');let started,release;const waiting=new Promise(resolve=>{started=resolve;});cloud.api.sourceText=async()=>{started();return new Promise(resolve=>{release=()=>resolve(entry.text);});};const pending=sync.synchronize(['source']);await waiting;await sync.removeSource(source.id);release();await pending;const final=await store.syncData();assert.equal(final.songs[0].original,before.original);assert.equal(final.songs[0].sync.detached,true);assert.equal(final.state.config.sources.length,0);
});
