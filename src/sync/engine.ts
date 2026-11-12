import {createSong, decodeSong, acceptedExtensions, type Song, type SongPersonal} from '../domain/song.ts';
import {withOriginal} from '../domain/original.ts';
import {cleanPersonal, reconcilePersonal} from '../domain/annotations.ts';
import {accessOf, collisionPath, dirtySong, filename, parseEnvelope, safeName, songPath, type LibraryEnvelope, type SongEnvelope, type Source, type SyncData, type SyncState, type RemoteFile, type SongSync} from '../domain/sync.ts';
import type {songStorage} from '../storage/songs.ts';
import {appKeys, authorize, dropbox, DropboxError, finishAuthorization, remoteFile, type Dropbox, type Entry} from './dropbox.ts';
export interface SyncStatus {message: string; busy: boolean; error: boolean; connected: boolean}
const same = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const accepted = (name: string) => acceptedExtensions.split(',').some(ext=>name.toLowerCase().endsWith(ext));
const rawPath = (entry: Entry) => /^\/(Private|Shared|Import)\//.test(entry.path_display ?? '') && accepted(entry.name);
const configOf = (data: SyncData): LibraryEnvelope => ({version:1,songbooks:data.songbooks,setlists:data.setlists,sources:data.state.config.sources.map(({error: _error,...source})=>source),settings:data.state.config.settings});
const emptyPersonal = (id: string): SongPersonal => ({songId:id,chorus:{},version:3});
async function stableId(value: string) {return 'dbx-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function conflict(data: SyncData, reason: string, local: unknown, remote: unknown, songId?: string) {
  const current = songId ? data.state.songs[songId] : data.state.config;
  if (current.conflict) return;
  const id = crypto.randomUUID(); current.conflict = id;
  data.state.conflicts.push({id,songId,reason,local:structuredClone(local),remote:structuredClone(remote)});
}
export function createSync(storage: ReturnType<typeof songStorage>, options: {namespace: string; channel: 'test'|'production'; protectedSong: (id: string)=>boolean; changed: ()=>void|Promise<void>; status: (value: SyncStatus)=>void; api?: Dropbox; automatic?: boolean}) {
  let rerun=false,retryDelay=1000;
  let running: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  let status: SyncStatus = {message:'Dropbox er ikke tilkoblet.',busy:false,error:false,connected:false};
  const report = (message: string,error = false,busy = false) => {status={message,error,busy,connected:status.connected};options.status(status);};
  const key = appKeys[options.channel];
  const api = options.api ?? dropbox(async()=>{const auth=(await storage.syncData()).state.auth;if(!auth)throw Error('Koble til Dropbox først.');return auth;},async auth=>{await storage.syncTransaction(data=>{if(data.state.auth?.account_id===auth.account_id)data.state.auth=auth;});},key);
  const data = () => storage.syncData();
  const mutate = storage.syncTransaction;
  let leaseId = '';
  let remoteEntries: Entry[] = [];
  async function fence() {
    const {state} = await data();
    if (stopped || state.lease?.id !== leaseId || state.lease.expires <= Date.now() || state.owner !== state.auth?.account_id) throw Error('Synkroniseringen er avbrutt. Lokale endringer er beholdt.');
  }
  async function eligible(id: string, generation: number) {
    await fence(); const snapshot=await data(), song=snapshot.songs.find(song=>song.id===id), track=snapshot.state.songs[id];
    return Boolean(song && (!song.sync?.deleted||accessOf(song)==='import'&&Boolean(track?.file)) && track?.generation===generation && !track.editing && !track.conflict && !options.protectedSong(id));
  }
  function request() {if(stopped||options.automatic===false)return;if(running){rerun=true;return;}clearTimeout(timer);timer=setTimeout(()=>{void synchronize();},600);}
  async function initialize() {
    try {
      const auth = await finishAuthorization(options.namespace,key);
      if(auth) {
        const current=await data();
        if(current.state.owner && current.state.owner!==auth.account_id) {const other=dropbox(async()=>auth,async()=>{},key);await other.revoke().catch(()=>{});throw Error('Dette lokale biblioteket tilhører en annen Dropbox-konto. Koble til den opprinnelige kontoen for å unngå å blande persondata.');}
        await mutate(data=>{data.state.owner=auth.account_id;data.state.auth=auth;});
      }
      status.connected=Boolean((await data()).state.auth); report(status.connected?'Dropbox er tilkoblet.':'Dropbox er ikke tilkoblet.');
      if(status.connected)request();
    } catch(error) {report(message(error),true);}
  }
  async function locked(operation: ()=>Promise<void>) {
    const id=crypto.randomUUID();
    const acquired=await mutate(data=>{if(data.state.lease && data.state.lease.expires>Date.now())return false;data.state.lease={id,expires:Date.now()+60000};return true;});
    if(!acquired){report('Synkronisering pågår i en annen fane.');return;}
    leaseId=id;
    const heartbeat=setInterval(()=>{void mutate(data=>{if(data.state.lease?.id===id)data.state.lease.expires=Date.now()+60000;}).catch(()=>{});},15000);
    try {await operation();} finally {clearInterval(heartbeat);await mutate(data=>{if(data.state.lease?.id===id)delete data.state.lease;});leaseId='';}
  }
  async function synchronize(sourceIds?: string[]) {
    if(stopped)return;
    if(running){await running;if(sourceIds?.length)return synchronize(sourceIds);return;}
    const snapshot=await data();status.connected=Boolean(snapshot.state.auth);
    if(!status.connected){report('Koble til Dropbox for å synkronisere.');return;}
    if(typeof navigator!=='undefined'&&navigator.onLine===false){report('Uten nett. Lokale endringer venter til enheten er på nett.');return;}
    running=locked(async()=>{
      report('Synkroniserer biblioteket…',false,true);
      try {
        await fence(); await pull(); await push();
        if(sourceIds) {
          const sources=(await data()).state.config.sources.filter(source=>sourceIds.includes(source.id));
          for(const source of sources) {
            try {await pullSource(source);await sourceResult(source);}
            catch(error){await sourceResult(source,message(error));}
          }
          await push();
        }
        await uploadConflicts();
        retryDelay=1000;await mutate(data=>{data.state.lastSync=new Date().toISOString();});
        const latest=await data(), pending=Object.values(latest.state.songs).filter(item=>item.dirty).length, errors=latest.state.config.sources.filter(source=>source.error).length;
        report(`${sourceIds?'Kildesynkronisering fullført. ':''}${pending?`${pending} sang${pending===1?'':'er'} venter på avsluttet redigering eller konfliktbehandling.`:'Biblioteket er oppdatert.'}${latest.state.conflicts.length?` ${latest.state.conflicts.length} konflikt(er) er bevart til senere.`:''}${errors?` ${errors} kilde(r) kunne ikke oppdateres.`:''}`,errors>0);
        await options.changed();
      } catch(error){report(message(error),true);await options.changed();const retry=error instanceof DropboxError&&(error.status===429||error.status>=500)||error instanceof TypeError||error instanceof DOMException&&['TimeoutError','NetworkError'].includes(error.name);if(retry&&!stopped&&options.automatic!==false){clearTimeout(timer);timer=setTimeout(()=>{void synchronize();},retryDelay);retryDelay=Math.min(60000,retryDelay*2);}}
    });
    try {await running;} finally {running=undefined;if(rerun){rerun=false;request();}}
  }
  async function sourceResult(expected: Source,error?: string) {await mutate(data=>{const source=data.state.config.sources.find(source=>source.id===expected.id&&source.url===expected.url&&source.songbookId===expected.songbookId);if(source){source.error=error;if(!error)source.lastSync=new Date().toISOString();data.state.config.dirty=true;data.state.config.generation++;}});}
  async function sharedBook(entry: Entry, entries: Entry[]) {
    const path=entry.path_display!, name=path.split('/')[2], folder=entries.find(item=>item['.tag']==='folder'&&item.path_display?.toLocaleLowerCase('en-US')===`/Shared/${name}`.toLocaleLowerCase('en-US'));
    return mutate(data=>{
      const byFolder=data.songs.find(song=>song.sync?.folderId===folder?.id&&folder?.id)?.songbookId;
      let book=data.songbooks.find(book=>book.folderId===folder?.id&&folder?.id || book.id===byFolder);
      if(!book){const matches=data.songbooks.filter(book=>book.id!=='standard'&&book.name===name);if(matches.length>1)throw Error(`Flere sangbøker heter «${name}». Mappen er beholdt uten automatisk kobling.`);book=matches[0];}
      if(!book){book={id:crypto.randomUUID(),name};data.songbooks.push(book);data.state.config.dirty=true;data.state.config.generation++;}
      if(folder && (book.folderId!==folder.id || book.folderName!==name || book.folderMissing)){if(book.folderId===folder.id&&book.folderName&&book.folderName!==name)book.name=name;book.folderId=folder.id;book.folderName=name;book.folderMissing=false;data.state.config.dirty=true;data.state.config.generation++;}
      return {bookId:book.id,folderId:folder?.id};
    });
  }
  async function pull() {
    // Only a complete successful listing proves a previous file has disappeared.
    const entries=await api.list();remoteEntries=entries;const files=entries.filter(rawPath), byId=new Map(files.map(entry=>[entry.id,entry]));
    await mutate(data=>{
      for(const song of data.songs)if(!data.state.songs[song.id])data.state.songs[song.id]=dirtySong(song.id);
      for(const [id,track] of Object.entries(data.state.songs)) if(track.file&&!byId.has(track.file.id)) {
        const song=data.songs.find(song=>song.id===id);if(song){song.sync={...song.sync,access:accessOf(song),deleted:true};}
      }
    });
    await pullConfig(entries.find(entry=>entry.path_lower==='/.app/library.json'));
    await mutate(data=>{for(const book of data.songbooks)if(book.folderId)book.folderMissing=!entries.some(entry=>entry.id===book.folderId);});
    for(const item of entries.filter(entry=>/^\/\.app\/conflicts\/[a-zA-Z0-9-]+\.json$/.test(entry.path_display??''))){if((await data()).state.conflicts.some(conflict=>item.name===conflict.id+'.json'))continue;const value=JSON.parse((await api.download(item)).text);if(typeof value.id==='string'&&typeof value.reason==='string')await mutate(data=>{if(!data.state.conflicts.some(item=>item.id===value.id))data.state.conflicts.push({...value,uploaded:true});});}
    for(const folder of entries.filter(entry=>entry['.tag']==='folder'&&/^\/Shared\/[^/]+$/.test(entry.path_display??'')))await sharedBook(folder,entries);
    const linked=new Set<string>();
    for(const metadata of entries.filter(entry=>/^\/\.app\/songs\/[a-zA-Z0-9-]+\.json$/.test(entry.path_display??''))) {
      const known=Object.values((await data()).state.songs).find(track=>track.metadata?.id===metadata.id&&track.metadata.rev===metadata.rev);
      const knownFile=known?.file&&byId.get(known.file.id);
      if(knownFile&&knownFile.rev===known.file!.rev&&knownFile.path_display===known.file!.path){linked.add(knownFile.id);continue;}
      const downloaded=await api.download(metadata), envelope=parseEnvelope(downloaded.text), file=byId.get(envelope.file.id);
      if(!file)continue;
      if(linked.has(file.id))throw Error('To metadatafiler peker på samme Dropbox-fil. Begge er beholdt til avklaring.');
      linked.add(file.id);
      await receive(file,downloaded.file,envelope,entries);
    }
    for(const file of files.filter(file=>!linked.has(file.id))) {
      const snapshot=await data(), existing=Object.values(snapshot.state.songs).find(track=>track.file?.id===file.id || track.pendingPath?.toLocaleLowerCase('en-US')===file.path_lower);
      const current=existing && snapshot.songs.find(song=>song.id===existing.songId);
      const downloaded=await api.download(file);
      if(existing&&!existing.file&&current?.original!==downloaded.text)continue; // The pending name was occupied by another file.
      const song=current??{...createSong(file.name,new TextEncoder().encode(downloaded.text)),id:await stableId(`${snapshot.state.owner}:${file.id}`)};
      const personal=snapshot.personal.find(item=>item.songId===song.id)??emptyPersonal(song.id);
      await receive({...file,rev:downloaded.file.rev},undefined,{version:1,song,personal,file:downloaded.file},entries,true,downloaded.text);
    }
  }
  async function receive(entry: Entry, metadata: RemoteFile|undefined, envelope: SongEnvelope, entries: Entry[], orphan=false, downloadedText?: string) {
    const id=envelope.song.id, snapshot=await data(), track=snapshot.state.songs[id];
    if(track?.editing||options.protectedSong(id))return;
    const fileChanged=track?.file?.rev!==entry.rev||track?.file?.path!==entry.path_display, metaChanged=track?.metadata?.rev!==metadata?.rev;
    if(!fileChanged&&!metaChanged&&!orphan)return;
    const downloaded=downloadedText===undefined?await api.download(entry):{text:downloadedText,file:remoteFile(entry)};
    decodeSong(new TextEncoder().encode(downloaded.text));
    const grouping=entry.path_display?.startsWith('/Shared/')?await sharedBook(entry,entries):undefined;
    await mutate(data=>{
      const current=data.songs.find(song=>song.id===id), own=data.state.songs[id];
      if(own?.editing||options.protectedSong(id))return;
      if(own?.file&&own.file.id!==entry.id){conflict(data,'Samme app-ID peker på ulike filer.',{song:current,track:own},{...envelope,actualOriginal:downloaded.text},id);return;}
      const pendingMatch=orphan&&own?.pendingPath&&current?.original===downloaded.text;
      if(own?.dirty&&!pendingMatch) {
        const local={song:current,personal:data.personal.find(item=>item.songId===id)??emptyPersonal(id)};
        const identical=current?.original===downloaded.text&&same(local.personal,cleanPersonal(envelope.personal))&&current.songbookId===envelope.song.songbookId&&accessOf(current)===accessOf(envelope.song);
        if(!identical){if(fileChanged||metaChanged)conflict(data,'Endret både lokalt og i Dropbox.',local,{...envelope,file:downloaded.file,actualOriginal:downloaded.text},id);return;}
      }
      const next=withOriginal({...envelope.song,sync:{...envelope.song.sync,access:accessOf(envelope.song)==='import'?'import':entry.path_display!.startsWith('/Shared/')?'shared':entry.path_display!.startsWith('/Import/')?'import':'private',deleted:envelope.song.sync?.deleted??false,pending:false,...(grouping?{folderId:grouping.folderId}:{})},songbookId:grouping?.bookId??envelope.song.songbookId},downloaded.text);
      // A metadata snapshot names the exact source used by its annotation coordinates.
      const personal=pendingMatch?data.personal.find(item=>item.songId===id)??emptyPersonal(id):reconcilePersonal(envelope.song,next,cleanPersonal(envelope.personal));
      data.songs=[...data.songs.filter(song=>song.id!==id),next];data.personal=[...data.personal.filter(item=>item.songId!==id),personal];
      if(!data.songbooks.some(book=>book.id===next.songbookId)){data.songbooks.push({id:next.songbookId,name:'Gjenopprettet sangbok'});data.state.config.dirty=true;data.state.config.generation++;}
      data.state.songs[id]={...own,id:`song:${id}`,songId:id,generation:own?.generation??0,dirty:!metadata||Boolean(pendingMatch),editing:false,file:downloaded.file,metadata,original:downloaded.text,importOriginal:accessOf(next)==='import'?envelope.song.original:undefined,account:data.state.owner};
    });
  }
  async function pullConfig(entry?: Entry) {
    const snapshot=await data(), config=snapshot.state.config;
    if(!entry||entry.rev===config.remote?.rev)return;
    const downloaded=await api.download(entry), value=JSON.parse(downloaded.text) as LibraryEnvelope;
    if(value.version!==1||!Array.isArray(value.songbooks)||!Array.isArray(value.setlists)||!Array.isArray(value.sources)||value.songbooks.some(book=>typeof book.id!=='string'||typeof book.name!=='string')||value.sources.some(source=>typeof source.id!=='string'||typeof source.url!=='string'||typeof source.songbookId!=='string')||value.setlists.some(item=>typeof item.id!=='string'||typeof item.name!=='string'||!Array.isArray(item.songIds)))throw Error('Bibliotekets metadata kan ikke leses. Lokale data og Dropbox-filen er beholdt.');
    await mutate(data=>{
      const current=data.state.config;
      if(current.dirty&&current.remote) {if(!same(configOf(data),value))conflict(data,'Bibliotekoppsett er endret på flere enheter.',configOf(data),value);return;}
      if(!current.remote) {
        for(const book of value.songbooks) {const local=data.songbooks.find(item=>item.id===book.id);if(!local)data.songbooks.push(book);else if(!same(local,book))conflict(data,'Ulike sangbøker ved første tilkobling.',configOf(data),value);}
        for(const item of value.setlists) {const local=data.setlists.find(local=>local.id===item.id);if(!local)data.setlists.push(item);else if(!same(local,item))conflict(data,'Ulike setlister ved første tilkobling.',configOf(data),value);}
        for(const source of value.sources) {const local=current.sources.find(item=>item.id===source.id);if(!local)current.sources.push(source);else if(!same(local,source))conflict(data,'Ulike kilder ved første tilkobling.',configOf(data),value);}
        if(!current.settings)current.settings=value.settings;else if(value.settings&&!same(current.settings,value.settings))conflict(data,'Ulike innstillinger ved første tilkobling.',configOf(data),value);
      } else {data.songbooks=value.songbooks;data.setlists=value.setlists;current.sources=value.sources;current.settings=value.settings;current.dirty=false;}
      current.remote=downloaded.file;
    });
  }
  async function ensureFolders(path: string) {const parts=path.split('/').filter(Boolean);parts.pop();let parent='';for(const part of parts){parent+='/'+part;await fence();await api.folder(parent);}}
  async function newFile(path: string,text: string,id?: string) {
    await ensureFolders(path);
    for(let attempt=0;attempt<1000;attempt++) {
      const candidate=collisionPath(path,attempt);
      if(id)await mutate(data=>{data.state.songs[id].pendingPath=candidate;});
      await fence();
      if(id){const track=(await data()).state.songs[id];if(!await eligible(id,track.generation))throw Error('Sangen er under redigering. Den synkroniseres når redigeringen avsluttes.');}
      try{return await api.upload(candidate,text);}catch(error){if(!(error instanceof DropboxError)||!error.tag.startsWith('path/conflict'))throw error;}
    }
    throw Error('For mange filer med samme navn. Velg en annen sangtittel.');
  }
  async function prepareShared(bookId: string) {
    let snapshot=await data(),book=snapshot.songbooks.find(book=>book.id===bookId);
    if(!book||book.id==='standard')throw Error('Velg en annen sangbok enn Standard.');
    if(book.folderMissing)throw Error('Bandmappen er slettet i Dropbox. Ventende publisering er beholdt lokalt.');
    if(book.folderId&&remoteEntries.some(entry=>entry.id===book.folderId))return;
    const root=safeName(book.name);let folder:Entry|undefined,name=root;
    await ensureFolders('/Shared/placeholder.cho');
    for(let attempt=0;attempt<1000;attempt++) {
      name=attempt?`${root} (${attempt+1})`:root;
      if(remoteEntries.some(entry=>entry.path_lower===`/Shared/${name}`.toLocaleLowerCase('en-US')))continue;
      await fence();folder=await api.folder(`/Shared/${name}`);
      if(!folder){remoteEntries=await api.list();continue;}
      remoteEntries.push(folder);break;
    }
    if(!folder)throw Error('Kunne ikke velge en egen delingsmappe for sangboken.');
    await mutate(data=>{const book=data.songbooks.find(book=>book.id===bookId)!;book.folderId=folder!.id;book.folderName=name;book.folderMissing=false;data.state.config.generation++;data.state.config.dirty=true;});
    await pushConfig();snapshot=await data();if(snapshot.state.config.conflict)throw Error('Delingsoppsettet har en konflikt. Sangen er beholdt lokalt uten ny deling.');
  }
  async function push() {
    const snapshot=await data();
    for(const song of snapshot.songs) {
      const track=(await data()).state.songs[song.id];
      if(!track?.dirty||!await eligible(song.id,track.generation))continue;
      if(accessOf(song)==='shared')await prepareShared(song.songbookId);
      const latest=await data(), current=latest.songs.find(item=>item.id===song.id)!, personal=latest.personal.find(item=>item.songId===song.id)??emptyPersonal(song.id), generation=track.generation;
      try {
        let file=track.file;
        if(!file)file=await newFile(songPath(current,latest.songbooks),current.original,current.id);
        else {
          if(current.original!==track.original) {if(!await eligible(current.id,generation))continue;file=await api.upload(file.path,current.original,file.rev);}
          await mutate(data=>{const own=data.state.songs[current.id];if(own){own.file=file;own.original=current.original;}});
          const target=songPath(current,latest.songbooks), folder=target.slice(0,target.lastIndexOf('/'));
          if(!file.path.startsWith(folder+'/')) {
            await ensureFolders(target);
            for(let attempt=0;attempt<1000;attempt++) {if(!await eligible(current.id,generation))break;try{file=await api.move(file,collisionPath(target,attempt));break;}catch(error){if(!(error instanceof DropboxError)||!error.tag.startsWith('to/conflict'))throw error;}}
          }
        }
        await mutate(data=>{const own=data.state.songs[current.id];if(own){own.file=file;own.original=current.original;delete own.pendingPath;}});
        if(!await eligible(current.id,generation))continue;
        const envelope:SongEnvelope={version:1,song:{...current,sync:{...current.sync,access:accessOf(current),pending:false}},personal,file};
        const path=`/.app/songs/${current.id}.json`;await ensureFolders(path);
        if(!await eligible(current.id,generation))continue;
        const metadata=await api.upload(path,JSON.stringify(envelope),track.metadata?.rev);
        await mutate(data=>{const own=data.state.songs[current.id];if(!own)return;own.metadata=metadata;if(own.generation===generation&&!own.editing){own.dirty=false;delete own.conflict;const song=data.songs.find(song=>song.id===current.id);if(song?.sync)song.sync.pending=false;}});
      } catch(error) {
        if(error instanceof DropboxError&&error.status===409) {const raw=track.file?await api.download(track.file).catch(()=>undefined):undefined,metadata=track.metadata?await api.download(track.metadata).catch(()=>undefined):undefined;await mutate(data=>conflict(data,'Dropbox-filen er endret eller slettet. Ingen nyere versjon er overskrevet.',{song:current,personal}, {file:raw?.file??track.file,original:raw?.text,metadata:metadata?.text,error:error.tag},current.id));continue;}
        throw error;
      }
    }
    await pushConfig();
  }
  async function pushConfig() {
    const latest=await data(), config=latest.state.config;
    if(config.dirty&&!config.conflict) {
      const captured=configOf(latest);await ensureFolders('/.app/library.json');await fence();
      try {const file=await api.upload('/.app/library.json',JSON.stringify(captured),config.remote?.rev);await mutate(data=>{data.state.config.remote=file;if(data.state.config.generation===config.generation)data.state.config.dirty=false;});}
      catch(error){if(!(error instanceof DropboxError)||error.status!==409)throw error;await mutate(data=>conflict(data,'Bibliotekoppsettet er endret i Dropbox.',captured,{error:error.tag}));}
    }
  }
  async function pullSource(source: Source) {
    const currentSource=(data:SyncData)=>data.state.config.sources.some(item=>item.id===source.id&&item.url===source.url&&item.songbookId===source.songbookId);
    let deferred=false;
    const entries=(await api.sourceFiles(source.url)).filter(entry=>accepted(entry.name));
    const present=new Set(entries.map(entry=>entry.id));
    for(const entry of entries) {
      const snapshot=await data(), existing=snapshot.songs.find(song=>song.origin.sourceId===source.id&&song.origin.fileId===entry.id);
      if(!currentSource(snapshot))return;
      if(existing&&(snapshot.state.songs[existing.id]?.editing||options.protectedSong(existing.id))){deferred=true;continue;}
      if(existing?.sync?.sourceRev===entry.rev&&!existing?.sync?.deleted)continue;
      const text=await api.sourceText(source.url,entry), id=existing?.id??await stableId(`${snapshot.state.owner}:${source.id}:${entry.id}`);
      const next=withOriginal({...createSong(entry.name,new TextEncoder().encode(text)),id,songbookId:source.songbookId,origin:{kind:'external',filename:entry.name,importedAt:existing?.origin.importedAt??new Date().toISOString(),provider:'dropbox-read',sourceId:source.id,fileId:entry.id,relativePath:entry.relative},sync:{access:'import',sourceRev:entry.rev}},text);
      await mutate(data=>{
        if(!currentSource(data))return;const track=data.state.songs[id];if(track?.editing||options.protectedSong(id)){deferred=true;return;}
        const current=data.songs.find(song=>song.id===id), personal=data.personal.find(item=>item.songId===id)??emptyPersonal(id);
        if(current&&track?.importOriginal!==undefined&&current.original!==track.importOriginal){conflict(data,'Både importkopien og den eksterne kilden er endret.',{song:current,personal},{song:next},id);return;}
        const updated=current?reconcilePersonal(current,next,personal):personal;
        data.songs=[...data.songs.filter(song=>song.id!==id),next];data.personal=[...data.personal.filter(item=>item.songId!==id),updated];data.state.songs[id]={...dirtySong(id,track),importOriginal:next.original};
      });
    }
    await mutate(data=>{if(!currentSource(data))return;for(const song of data.songs.filter(song=>song.origin.sourceId===source.id&&!present.has(song.origin.fileId!)&&!song.sync?.deleted)) {song.sync={...song.sync,access:'import',deleted:true};data.state.songs[song.id]=dirtySong(song.id,data.state.songs[song.id]);}});
    if(deferred)throw Error('Noen sanger er under redigering. Synkroniser kilden på nytt når du er ferdig.');
  }
  async function uploadConflicts() {
    for(const item of (await data()).state.conflicts.filter(item=>!item.uploaded)) {
      const path=`/.app/conflicts/${item.id}.json`;await ensureFolders(path);await fence();
      try {await api.upload(path,JSON.stringify(item));} catch(error){if(!(error instanceof DropboxError)||!error.tag.startsWith('path/conflict'))throw error;}
      await mutate(data=>{const saved=data.state.conflicts.find(saved=>saved.id===item.id);if(saved)saved.uploaded=true;});
    }
  }
  const message=(error:unknown)=>error instanceof Error?error.message:'Synkronisering mislyktes. Lokale data er beholdt.';
  return {
    initialize, request, synchronize, getStatus:()=>status,
    connect:()=>authorize(options.namespace,key,location.origin+location.pathname),
    async disconnect(){stopped=true;clearTimeout(timer);if(running)await running;let failure:unknown;try{await api.revoke();}catch(error){failure=error;}await mutate(data=>{delete data.state.auth;delete data.state.lease;});status.connected=false;stopped=false;report(failure?'Koblet fra på enheten. Dropbox kunne ikke tilbakekalle tilgangen; dette kan gjøres i Dropbox-innstillingene.':'Dropbox er koblet fra. Sangene og persondataene er beholdt.',Boolean(failure));},
    async release(id:string){await storage.editing(id,false);request();},
    async access(id:string,access:'private'|'shared',bookId?:string){await mutate(data=>{const song=data.songs.find(song=>song.id===id);if(!song||accessOf(song)==='import'||song.sync?.deleted)throw Error('Denne sangen kan ikke publiseres eller flyttes.');if(bookId)song.songbookId=bookId;if(access==='shared'&&song.songbookId==='standard')throw Error('Velg en annen sangbok enn Standard.');if(!data.state.auth)throw Error('Koble til Dropbox før publisering.');song.sync={...song.sync,access,pending:true};data.state.songs[id]=dirtySong(id,data.state.songs[id]);});request();},
    async changeBook(id:string,bookId:string){await mutate(data=>{const song=data.songs.find(song=>song.id===id);if(!song||accessOf(song)==='import')throw Error('Sangboken styres av importkilden.');if(accessOf(song)==='shared'&&bookId==='standard')throw Error('Publiserte sanger kan ikke ligge i Standard.');song.songbookId=bookId;if(accessOf(song)==='shared')song.sync={...song.sync,access:'shared',pending:true};data.state.songs[id]=dirtySong(id,data.state.songs[id]);});request();},
    async keepPrivate(id:string,bookId:string){await mutate(data=>{const song=data.songs.find(song=>song.id===id);if(!song||!song.sync?.deleted&&!song.sync?.detached)throw Error('Sangen er ikke en reserve eller frakoblet import.');const previous=data.state.songs[id],restore=Boolean(song.sync?.deleted);song.songbookId=bookId;song.origin={kind:'local',filename:filename(song),importedAt:new Date().toISOString()};song.sync={access:'private'};data.state.songs[id]={...dirtySong(id,previous),editing:false,conflict:undefined,file:restore?undefined:previous?.file,metadata:previous?.metadata};});request();},
    async saveSource(source:Source){await mutate(data=>{data.state.config.sources=[...data.state.config.sources.filter(item=>item.id!==source.id),source];for(const song of data.songs.filter(song=>song.origin.sourceId===source.id)){song.songbookId=source.songbookId;data.state.songs[song.id]=dirtySong(song.id,data.state.songs[song.id]);}data.state.config.generation++;data.state.config.dirty=true;});request();},
    async removeSource(id:string){await mutate(data=>{data.state.config.sources=data.state.config.sources.filter(source=>source.id!==id);data.state.config.generation++;data.state.config.dirty=true;for(const song of data.songs.filter(song=>song.origin.sourceId===id)){song.sync={...song.sync,access:'import',detached:true};data.state.songs[song.id]=dirtySong(song.id,data.state.songs[song.id]);}});request();},
    async share(bookId:string){if(running)await running;const snapshot=await data();if(!snapshot.state.auth)throw Error('Koble til Dropbox først.');const songs=snapshot.songs.filter(song=>song.songbookId===bookId&&accessOf(song)==='shared'&&!song.sync?.deleted);if(!songs.length)throw Error('Publiser en sang i sangboken først.');const book=snapshot.songbooks.find(book=>book.id===bookId),path=`/Shared/${book?.folderName??safeName(book?.name??'')}`;const ready=songs.find(song=>!song.sync?.pending&&snapshot.state.songs[song.id]?.file?.path.startsWith(path+'/'));if(!ready)throw Error('Publiseringen venter på Dropbox. Prøv igjen etter synkronisering.');return api.link(path);},
    async settings(settings: Record<string,unknown>){await mutate(data=>{data.state.config.settings=settings;data.state.config.generation++;data.state.config.dirty=true;});request();},
  };
}
export type Synchronizer=ReturnType<typeof createSync>;
