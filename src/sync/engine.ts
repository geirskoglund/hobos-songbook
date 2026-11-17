import {parseChordPro} from '../domain/chordpro.ts';
import {cleanPersonal, reconcilePersonal} from '../domain/annotations.ts';
import {songbookName} from '../domain/songbook.ts';
import type {Song, SongPersonal} from '../domain/song.ts';
import type {syncStorage, SyncSnapshot} from '../storage/sync.ts';
import {direction, emptyManifest, hash, mergeManifest, parseManifest, parsePersonal, personalData, same, type BookLink, type Conflict, type FileValue, type Manifest, type PersonalFile, type RemoteFiles, type SongLink, type SyncState, type UploadIntent, type UploadJob} from './model.ts';
import {DeferredSync, failureCodes, failureInfo, SyncFailure,RetrySync} from './failure.ts';
import {indexedFiles,pathKey} from './remote.ts';
import {syncIdentities} from './identities.ts';
import {uploadQueue} from './uploads.ts';
import {checkSize,textBytes,maxFileBytes,SkippedFile} from './limits.ts';
import {songFilename,originalFilename,numberedPath} from './filenames.ts';
import {claimReady,type UploadClaim} from './bridge.ts';
export class PausedSync extends DeferredSync {constructor() {super('session','Synkronisering er pauset mens en sang er åpen.');}}
const privateSong = (song: Song) => song.origin.kind === 'local' || song.origin.provider === 'dropbox' && !(song.origin as any).sourceId;
const personalOf = (snapshot: SyncSnapshot, id: string) => personalData(snapshot.personal.find(p => p.songId === id) ?? {songId: id, version: 3, chorus: {}});
function fromRemote(link: SongLink, text: string): Song {
  const parsed = parseChordPro(text, link.origin.filename.replace(/\.[^.]+$/, ''));
  return {id: link.id, songbookId: link.songbookId, origin: link.origin, original: text, title: parsed.title, key: parsed.key};
}
function project(personal: SongPersonal, source: Song, target: Song) {return personalData(source.original === target.original ? personal : reconcilePersonal(source, target, personal));}
export interface SyncHooks {valid(): boolean; changed(): void; failed?(error: unknown): void; idle?():void}
export function syncEngine(storage: ReturnType<typeof syncStorage>, files: RemoteFiles, accountId: string, hooks: SyncHooks) {
  const rawFiles=files;
  let index:ReturnType<typeof indexedFiles>;
  let identities:ReturnType<typeof syncIdentities>;
  let uploads:ReturnType<typeof uploadQueue>;
  let interruption:unknown;
  let removedIds=new Set<string>();
  let confirmedLinks:Record<string,SongLink>={};
  let claims:UploadClaim[]=[];
  let snapshot: SyncSnapshot, state: SyncState, generation = 0, manualRecovery = false;
  const valid = () => hooks.valid();
  async function check() {
    if(interruption)throw interruption;
    if (!valid()) throw new PausedSync();
    const latest = storage.status?await storage.status():await storage.snapshot(accountId);
    if (latest.journal.recoveryRequired && !manualRecovery) throw new DeferredSync('recovery','Lagrede endringer etter avbrudd venter på Synkroniser.');
    if (Object.keys(latest.journal.sessions).length) throw new PausedSync();
    if (latest.journal.generation !== generation) throw new DeferredSync('changed','Nyere lokale endringer venter. Synkroniseringen må fortsette fra nyeste versjon.');
    if (!valid()) throw new PausedSync();
  }
  async function step<T>(operation: () => Promise<T>): Promise<T> {await check();let result:T;try{result=await operation();}catch(error){if(error instanceof SyncFailure&&[failureCodes.changed,failureCodes.missingFolder,failureCodes.missingFile].some(code=>code===error.info.code))throw new RetrySync();throw error;}await check();return result;}
  async function parallel<T>(entries:T[],operation:(entry:T)=>Promise<void>){let next=0;await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{while(next<entries.length&&!interruption){const entry=entries[next++];try{await operation(entry);}catch(error){interruption=error;}}}));if(interruption)throw interruption;}
  async function save(changes: Parameters<typeof storage.commit>[2] = {}) {await check(); await storage.commit(generation, state, identities.restore(changes), valid); hooks.changed();}
  async function start() {
    confirmedLinks={};
    snapshot = await storage.snapshot(accountId); state = snapshot.state; generation = snapshot.journal.generation;
    identities=syncIdentities(snapshot);snapshot=identities.project();
    index=indexedFiles(rawFiles,state);files=index.files;
    uploads=uploadQueue(files,state,{check,save,record:recordUpload});
    await check();
  }
  async function read(path: string) {return step(() => files.read(path));}
  async function write(path: string, text: string, rev: string | null) {return step(() => files.write(path, text, rev));}
  async function folder(path: string, expectedId?: string) {return step(() => files.folder(path, expectedId));}
  function remoteBookName(value: string, books: BookLink[], ownId?: string) {
    try{return songbookName(value,books,ownId);}catch(cause){throw new SyncFailure({code:failureCodes.bookName,stage:'sync.book-name',action:'remote-book-names'},'Ugyldig sangboknavn i Dropbox.',cause);}
  }
  function localManifest(): Manifest {
    const local = emptyManifest();
    for (const book of snapshot.songbooks) local.books[book.id] = {...state.manifest.books[book.id], ...state.folders[book.id], ...book};
    for (const [id, book] of Object.entries(snapshot.journal.deletedBooks)) local.books[id] = {...state.manifest.books[id], ...state.folders[id], ...book};
    for (const song of snapshot.songs.filter(privateSong)) {
      const previous = state.manifest.songs[song.id] ?? state.reservations[song.id];
      local.songs[song.id] = {...previous, id: song.id, songbookId: song.songbookId, origin: song.origin, path: previous?.path ?? ''};
    }
    return local;
  }
  function hasLocalWork(){
    if(Object.keys(state.renames??{}).length||Object.keys(state.decisions).length||Object.values(state.uploads??{}).some(job=>job.status!=='done'))return true;
    for(const book of snapshot.songbooks){const known=state.manifest.books[book.id];if(known?.deleted)continue;if(!known?.folderId||known.name!==book.name)return true;}
    for(const book of Object.values(snapshot.journal.deletedBooks))if(!state.manifest.books[book.id]?.deleted)return true;
    for(const song of snapshot.songs.filter(privateSong)){
      if(state.manifest.deletedSongs?.[song.id]||state.manifest.books[song.songbookId]?.deleted||state.held?.[song.id])continue;
      const base=state.bases[song.id],link=state.manifest.songs[song.id];
      if(originalFilename(song)&&!link?.originalFile&&!state.originals?.[song.id])return true;
      if(!base||!base.contentRev||!base.personalRev||base.personal.original.rev!==base.contentRev||!link||link.songbookId!==song.songbookId||!same(link.origin,song.origin)||song.original!==base.original||!same(personalOf(snapshot,song.id),base.personal.data))return true;
    }
    return false;
  }
  function recordUpload(job:UploadJob,value:FileValue){
    if(job.kind==='seed')return;
    if(job.kind==='original'){
      (state.originals??={})[job.songId]=true;
      const link=state.reservations[job.songId]??state.manifest.songs[job.songId];
      if(link&&!link.originalFile)state.reservations[job.songId]={...link,originalFile:{fileId:value.id,path:value.path}};
      return;
    }
    const old=state.bases[job.songId];
    if(job.kind==='content'){
      const link=state.reservations[job.songId]??state.manifest.songs[job.songId];
      if(link){const confirmed={...link,...job.base.link,fileId:value.id,path:value.path};state.reservations[job.songId]=confirmed;confirmedLinks[job.songId]=confirmed;}
      state.bases[job.songId]={original:job.text,contentRev:value.rev,personal:old?.personal??job.base.personal,personalRev:old?.personalRev??''};
    }else state.bases[job.songId]={original:job.base.original,contentRev:job.base.personal.original.rev,personal:job.base.personal,personalRev:value.rev};
  }
  function deleteSong(remote:Manifest,link:SongLink){
    (remote.deletedSongs??={})[link.id]={id:link.id,...(link.fileId?{fileId:link.fileId}:{}),songbookId:link.songbookId};delete remote.songs[link.id];
  }
  async function inspectRemovals(remote:Manifest){
    state.held={};
    const knownBooks={...state.manifest.books,...state.folders,...remote.books};
    for(const book of Object.values(knownBooks)){
      if(remote.books[book.id]?.deleted||book.deleted){remote.books[book.id]??={...book,deleted:true};state.folders[book.id]={...remote.books[book.id]};continue;}
      if(!book.folderId||book.deleted)continue;
      const current=await step(()=>files.locateFolder(book.folderId!));
      if(!current||!/^\/Songbooks\/[^/]+$/i.test(current.path)){remote.books[book.id]={...book,deleted:true};state.folders[book.id]={...remote.books[book.id]};}
      else {knownBooks[book.id]={...book,path:current.path};remote.books[book.id]??={...book};}
    }
    const confirmed=Object.fromEntries(Object.values(state.reservations).filter(link=>link.fileId).map(link=>[link.id,link]));
    const knownSongs={...state.manifest.songs,...confirmed,...remote.songs};
    for(const link of Object.values(knownSongs)){
      if(remote.deletedSongs?.[link.id]){delete remote.songs[link.id];continue;}
      const entry=state.remote?index.find(link.fileId??link.path):undefined;
      if(state.remote&&!entry){deleteSong(remote,link);continue;}
      if(entry&&!entry.folder){
        const owner=Object.values(knownBooks).find(b=>!b.deleted&&!remote.books[b.id]?.deleted&&b.path&&pathKey(entry.path).startsWith(pathKey(b.path)+'/private/')&&!entry.path.slice(b.path.length+9).includes('/'));
        if(owner)remote.songs[link.id]={...link,songbookId:owner.id,path:entry.path};
        else if(remote.books[link.songbookId]?.deleted)deleteSong(remote,link);
        else if(!/^\/Songbooks\/[^/]+\//i.test(entry.path)||/^\/Songbooks\/[^/]+\/Originals\//i.test(entry.path))deleteSong(remote,link);
        else state.held[link.id]=true;
      }else if(remote.books[link.songbookId]?.deleted)deleteSong(remote,link);
    }
    for(const link of Object.values(remote.songs))if(remote.books[link.songbookId]?.deleted)deleteSong(remote,link);
    // F57 covers membership, including offline imports never present in a manifest.
    for(const song of snapshot.songs)if(remote.books[song.songbookId]?.deleted){
      deleteSong(remote,{...state.reservations[song.id],id:song.id,songbookId:song.songbookId,origin:song.origin,path:''});
    }
    for(const [key,job]of Object.entries(state.uploads??{}))if(remote.deletedSongs?.[job.songId]){if(job.creation)await uploads.discard(job.songId);delete state.uploads![key];}
  }
  function removedChanges(remote:Manifest){
    const removed=Object.keys(remote.deletedSongs??{}),books=Object.values(remote.books).filter(b=>b.deleted).map(b=>b.id);
    for(const id of removed){delete state.bases[id];delete state.reservations[id];delete state.reservations[`copy:${id}`];delete state.originals?.[id];delete state.held?.[id];delete state.decisions[`${id}:content`];delete state.decisions[`${id}:personal`];}
    state.conflicts=state.conflicts.filter(c=>!removed.includes(c.songId));
    return{deleteSongs:removed,deleteBooks:books};
  }
  async function refreshBookNames(remote: Manifest) {
    for (const book of Object.values(remote.books).filter(book => !book.deleted && book.folderId)) {
      const current = await step(() => files.locateFolder(book.folderId!));
      if (!current) throw new SyncFailure({code:failureCodes.missingFolder,stage:'sync.book-state'},'Kjent sangbokmappe mangler.');
      const intent = state.renames?.[book.id];
      if (intent) {
        if ([intent.from, intent.to, `/Songbooks/.rename-${book.id}`].includes(current.path)) continue;
        throw new SyncFailure({code:failureCodes.bookChanges,stage:'sync.book-state'},'Sangbokmappen er endret under en uferdig navneendring.');
      }
      if (!/^\/Songbooks\/[^/]+$/i.test(current.path)) throw new SyncFailure({code:failureCodes.bookChanges,stage:'sync.book-state'},'En kjent sangbokmappe ligger utenfor Songbooks.');
      if (book.path === current.path) continue;
      const previousPath = book.path ?? `/Songbooks/${book.name}`;
      book.name = remoteBookName(current.path.split('/').at(-1)!, Object.values(remote.books).filter(other => !other.deleted), book.id);
      book.path = current.path;
      for (const song of Object.values(remote.songs)) if (song.songbookId === book.id && song.path.toLowerCase().startsWith(previousPath.toLowerCase() + '/')) song.path = current.path + song.path.slice(previousPath.length);
      state.folders[book.id] = {...book}; await save();
    }
  }
  async function ensureBooks(merged: Manifest) {
    await folder('/.app'); await folder('/.app/songs'); await folder('/Songbooks');
    for (const book of Object.values(merged.books).filter(b => !b.deleted)) {
      const target = `/Songbooks/${book.name}`;
      const prior = Object.values(merged.books).find(other => other.id !== book.id && other.path?.toLowerCase() === target.toLowerCase());
      if (prior) {
        const entries = await step(() => files.list('/Songbooks'));
        if (entries.some(entry => entry.path.toLowerCase() === target.toLowerCase() && (!prior.folderId || entry.id === prior.folderId))) throw new SyncFailure({code:failureCodes.bookName,stage:'sync.book-name',action:'book-names'},'Mappen tilhører en annen eller slettet sangbok.');
      }
      const known = state.folders[book.id] ?? state.manifest.books[book.id] ?? book;
      let binding: {id: string; path: string};
      if (known.folderId && (!known.path||pathKey(known.path)!==pathKey(target)||known.path.split('/').at(-1)!==book.name)) {
        (state.renames ??= {})[book.id] = {from: known.path ?? target, to: target}; await save();
        // Dropbox paths are case-insensitive; a temporary name preserves case-only renames.
        if (known.path !== target && known.path?.toLowerCase() === target.toLowerCase()) {
          const intermediate = `/Songbooks/.rename-${book.id}`;
          await step(() => files.move(known.folderId!, intermediate));
        }
        binding = await step(() => files.move(known.folderId!, target));
      } else binding = await folder(target, known.folderId);
      book.folderId = binding.id; book.path = binding.path;
      state.folders[book.id] = {...book}; delete state.renames?.[book.id]; await save();
      for (const kind of ['Private', 'Shared', 'Import', 'Originals']) await folder(`${target}/${kind}`);
    }
  }
  async function discover(remote: Manifest,publishedIds:Set<string>) {
    // Inspect only book directories and Private/. Contents of other subfolders stay out of sync.
    for (const entry of await step(() => files.list('/Songbooks'))) {
      if (!entry.folder || Object.values(remote.books).some(book => book.folderId ? book.folderId === entry.id : book.path?.toLowerCase() === entry.path.toLowerCase())) continue;
      let known = Object.values(state.folders).find(book => book.folderId === entry.id);
      if (!known) {
        const name = entry.path.split('/').at(-1)!;
        remoteBookName(name, Object.values(remote.books).filter(b => !b.deleted));
        known = {id: crypto.randomUUID(), name, path: entry.path, folderId: entry.id}; state.folders[known.id] = known; await save();
      }
      remote.books[known.id] = {...known};
      for (const kind of ['Private', 'Shared', 'Import', 'Originals']) await folder(`${entry.path}/${kind}`);
    }
    for (const book of Object.values(remote.books).filter(book => !book.deleted)) {
      for (const file of await step(() => files.list(`${book.path ?? `/Songbooks/${book.name}`}/Private`))) {
        if ((index.find(file.id)?.size??0)>maxFileBytes)continue;
        if(claims.some(claim=>claim.role==='content'&&claim.fileId===file.id))continue;
        if (file.folder || !file.path.toLowerCase().endsWith('.cho') || Object.values(remote.songs).some(song => song.fileId === file.id || publishedIds.has(song.id)&&song.path.toLowerCase() === file.path.toLowerCase())) continue;
        let known = Object.values(state.reservations).find(song => song.fileId === file.id);
        if (!known) {
          known = {id: crypto.randomUUID(), songbookId: book.id, fileId: file.id, path: file.path, origin: {kind: 'local', filename: file.path.split('/').at(-1)!, importedAt: new Date().toISOString()}};
          state.reservations[known.id] = known; await save();
        }
        remote.songs[known.id] = {...known};
      }
    }
  }
  async function personalFile(link: SongLink, content: FileValue, fresh: boolean): Promise<{file: PersonalFile; value: FileValue | null; original: string}> {
    const value = await read(`/.app/songs/${link.id}.json`);
    if (!value) {
      if (!fresh) throw new SyncFailure({code:failureCodes.personal,stage:'sync.personal'},'Personfilen for en kjent sang mangler.');
      return {value: null, original: content.text, file: {version: 1, songId: link.id, original: {rev: content.rev, hash: await hash(content.text)}, data: {songId: link.id, version: 3, chorus: {}}}};
    }
    const file = parsePersonal(value.text, link.id);
    let original = content.text;
    if (await hash(content.text) !== file.original.hash) {
      const previous = await read(`rev:${file.original.rev}`);
      if (!previous || await hash(previous.text) !== file.original.hash) throw new SyncFailure({code:failureCodes.original,stage:'sync.original'},'Persondataenes originalgrunnlag er utilgjengelig.');
      original = previous.text;
    }
    return {value, file, original};
  }
  async function prepareSong(link: SongLink, remoteKnown: boolean, manual: boolean, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) {
    const local = snapshot.songs.find(song => song.id === link.id), basis = state.bases[link.id];
    // A readable path without a confirmed ID may belong to another importer.
    // Only the durable creation journal can acknowledge a new physical file.
    let content = !link.fileId&&local&&!remoteKnown?null:await read(link.fileId ?? link.path);
    if (!content && (remoteKnown||!local)) throw new RetrySync();
    const localPersonal = local && personalOf(snapshot, local.id);
    const remoteSong = content && fromRemote(link, content.text);
    const fresh = !remoteKnown;
    const person = content ? await personalFile(link, content, fresh) : null;
    // A newly discovered file has no sidecar yet; establish its default remote
    // layer so the existing conflict dialog can reference a concrete revision.
    const remotePersonal = person?.value ? personalData(person.file.data) : undefined;
    if (resolution && (!content || content.rev !== resolution.conflict.contentRev || person?.value?.rev !== resolution.conflict.personalRev || !same(local, resolution.conflict.local) || !same(localPersonal, resolution.conflict.localPersonal))) {
      // A dialog choice belongs to the displayed snapshots, never to a later revision.
      delete state.decisions[`${link.id}:content`]; delete state.decisions[`${link.id}:personal`]; resolution = undefined;
    }

    let contentChoice = direction(local?.original, content?.text, basis?.original, manual);
    let personChoice = direction(localPersonal, remotePersonal, basis?.personalRev?basis.personal.data:undefined, manual);
    if (resolution) {state.decisions[`${link.id}:${resolution.conflict.kind}`] = resolution; await save();}
    let contentDecision = state.decisions[`${link.id}:content`], personDecision = state.decisions[`${link.id}:personal`];
    for (const decision of [contentDecision, personDecision]) if (decision && (decision.conflict.contentRev !== content?.rev || decision.conflict.personalRev !== person?.value?.rev || !same(decision.conflict.local, local) || !same(decision.conflict.localPersonal, localPersonal))) {
      delete state.decisions[`${link.id}:${decision.conflict.kind}`];
      if (decision.conflict.kind === 'content') contentDecision = undefined!; else personDecision = undefined!;
    }
    if (contentDecision) contentChoice = contentDecision.choice === 'local' ? 'upload' : 'download';
    if (personDecision) personChoice = personDecision.choice === 'local' ? 'upload' : 'download';
    state.conflicts = state.conflicts.filter(c => c.songId !== link.id);
    const conflicts: Conflict[] = [];
    if (local && remoteSong && content && person?.value) {
      for (const kind of ['content', 'personal'] as const) if ((kind === 'content' ? contentChoice : personChoice) === 'conflict') conflicts.push({songId: link.id, kind, title: local.title, local, localPersonal: localPersonal!, remote: remoteSong, remotePersonal: remotePersonal!, remotePersonalOriginal: person.original, contentRev: content.rev, personalRev: person.value.rev, personalFile: person.file, generation});
    }
    if (conflicts.length) {state.conflicts.push(...conflicts); await save();}
    // A content choice must not silently dispose of a separate personal conflict.
    if (contentChoice === 'conflict' || personChoice === 'conflict') return false;
    const waitingRemote = contentChoice === 'remote' || personChoice === 'remote';
    if (waitingRemote) state.awaitingDownload = true;
    const chosenSong = contentChoice === 'download' || !local ? remoteSong! : {...local, songbookId: link.songbookId};
    let chosenPersonal = personChoice === 'download' || !local ? project(personalData(person!.file.data), {...remoteSong!, original: person!.original}, chosenSong) : project(localPersonal!, local, chosenSong);
    if (contentDecision?.choice === 'copy') {
      const copyId = state.reservations[`copy:${link.id}`]?.id ?? crypto.randomUUID();
      if(!snapshot.songs.some(song=>song.id===copyId)&&!removedIds.has(copyId)){
      const copy: Song = {...local!, id: copyId, origin: {...local!.origin, kind: 'local'}};
      const copied = structuredClone(localPersonal!); copied.songId = copyId;
      for (const annotation of Object.values(copied.annotations ?? {})) annotation.anchor.songId = copyId;
      state.reservations[`copy:${link.id}`] = {id: copyId, songbookId: copy.songbookId, origin: copy.origin, path: ''};
      await save({songs: [copy], personal: [copied]}); snapshot.songs.push(copy); snapshot.personal.push(copied);
      }
    }
    checkSize(textBytes(chosenSong.original));
    const personal:PersonalFile={version:1,songId:link.id,original:{rev:content?.rev??'',hash:await hash(chosenSong.original)},data:chosenPersonal};
    const contentIntent:UploadIntent|undefined=contentChoice==='upload'?{key:`content:${link.id}`,songId:link.id,kind:'content',path:link.path,text:chosenSong.original,rev:content?.rev??null,...(content?{fileId:content.id}:{}),base:{original:chosenSong.original,personal,link:{...link}}}:undefined;
    return{link,local,basis,content,person,contentChoice,personChoice,chosenSong,chosenPersonal,waitingRemote,apply:manual||Boolean(contentDecision||personDecision),contentIntent};
  }
  type SongPlan=Exclude<Awaited<ReturnType<typeof prepareSong>>,false>;
  async function finishContent(plan:SongPlan){
    const {link,chosenSong,chosenPersonal,basis,contentChoice,personChoice,person,local}=plan;
    let content=plan.content;
    if(!content)throw new SyncFailure({code:failureCodes.missingFile,stage:'sync.file'},'Ingen sangfilversjon er tilgjengelig.');
    if(plan.contentIntent?.rev===null)link.path=content.path;
    const baseTarget=`${state.folders[link.songbookId]?.path??`/Songbooks/${snapshot.songbooks.find(b=>b.id===link.songbookId)?.name}`}/Private/${link.path.split('/').at(-1)}`;
    let target=baseTarget,number=1;
    while(index.find(target)&&index.find(target)!.id!==content.id)target=numberedPath(baseTarget,++number);
    if(content.path!==target){
      let moved;
      try{moved=await step(()=>files.move(content!.id,target));}catch(error){if(error instanceof SyncFailure&&error.info.code===failureCodes.changed)throw new RetrySync();throw error;}
      if(moved.id!==content.id)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move'},'Flyttingen bekreftet en annen sangfil.');
      content={...content,...moved};
    }
    link.path=content.path;link.fileId=content.id;state.reservations[link.id]={...link};await save();
    const referenceRev=contentChoice==='remote'?basis!.contentRev:content.rev;
    const nextPerson:PersonalFile={version:1,songId:link.id,original:{rev:referenceRev,hash:await hash(chosenSong.original)},data:chosenPersonal};
    const savedPerson=personChoice==='remote'?person!.value!:person?.value&&same(nextPerson,person.file)?person.value:null;
    const intents:UploadIntent[]=[];
    if(!savedPerson)intents.push({key:`personal:${link.id}`,songId:link.id,kind:'personal',path:`/.app/songs/${link.id}.json`,text:JSON.stringify(nextPerson),rev:person?.value?.rev??null,...(person?.value?{fileId:person.value.id}:{}),base:{original:chosenSong.original,personal:nextPerson}});
    const sourceName=local&&originalFilename(local);
    if(link.originalFile){(state.originals??={})[link.id]=true;await uploads.discardOriginal(link.id);}
    if(local&&sourceName&&!link.originalFile&&!state.originals?.[link.id]&&!uploads.originalPending(link.id)){
      // Old generated copies are identified from their deterministic metadata
      // name; adopting their ID does not rename or rewrite the user's file.
      const stem=local.origin.filename.replace(/\.[^.]+$/,'').replace(/[\\/<>:"|?*\u0000-\u001f]/g,'_').slice(0,100)||'Sang';
      const oldLeaf=`${stem}--${await hash(link.id)}.${local.origin.filename.split('.').at(-1)}`;
      const legacy=Object.values(state.remote?.entries??{}).filter(entry=>!entry.folder&&/\/Originals\//i.test(entry.path)&&pathKey(entry.path.split('/').at(-1)!)===pathKey(oldLeaf));
      if(legacy.length===1&&legacy[0].id){link.originalFile={fileId:legacy[0].id,path:legacy[0].path};state.reservations[link.id]={...link};(state.originals??={})[link.id]=true;}
    }
    if(local&&sourceName&&!link.originalFile&&!state.originals?.[link.id]&&!uploads.originalPending(link.id)){
      const prefix=`${state.folders[link.songbookId].path}/Originals/`,prior=state.uploads?.[`original:${link.id}`]?.path;
      const path=prior&&pathKey(prior).startsWith(pathKey(prefix))?prior:prefix+sourceName;
      intents.push({key:`original:${link.id}`,songId:link.id,kind:'original',path,text:local.original,rev:null,base:{original:chosenSong.original,personal:nextPerson,link:{...link}}});
    }
    for(const intent of intents)checkSize(textBytes(intent.text));
    return{...plan,content,referenceRev,nextPerson,savedPerson,intents};
  }
  async function run(manual: boolean, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) {
    manualRecovery = manual;
    await start();
    if(!manual&&!resolution&&!hasLocalWork()){state.localGeneration=generation;hooks.idle?.();await save();return state;}
    delete state.error; delete state.failure; state.pending = true; state.awaitingDownload = false;
    try {
      await step(()=>index.refresh());
      const manifestFile = await read('/.app/library.json');
      if(!manifestFile&&state.library)throw new SyncFailure({code:failureCodes.manifest,stage:'sync.manifest'},'Kjent bibliotekmetadata mangler.');
      const remote = manifestFile ? parseManifest(manifestFile.text) : emptyManifest();
      const published=structuredClone(remote);uploads.observeManifest(published);
      claims=Object.values((await uploads.claims()).entries).filter(claim=>!claimReady(claim,published));
      // A confirmed folder is a real component basis even before the first
      // manifest commit. Capture it before fresh remote bindings/names replace it.
      const base:Manifest=structuredClone({...state.manifest,books:{...Object.fromEntries(Object.entries(state.folders).filter(([,book])=>book.folderId)),...state.manifest.books},songs:{...Object.fromEntries(Object.entries(state.reservations).filter(([key,link])=>!key.startsWith('copy:')&&link.fileId)),...state.manifest.songs}});
      for(const claim of claims){
        if(Object.values(remote.books).some(book=>book.folderId===claim.book.folderId)||remote.books[claim.book.id]?.deleted)continue;
        const folder=index.find(claim.book.folderId!);if(folder?.folder&&/^\/Songbooks\/[^/]+$/i.test(folder.path))remote.books[claim.book.id]={...claim.book,path:folder.path,name:folder.path.split('/').at(-1)!};
      }
      if(identities.reconcile(remote)){snapshot=identities.project();await save();}
      const publishedIds=new Set([...Object.keys(state.manifest.songs),...Object.keys(remote.songs)]);
      await inspectRemovals(remote);
      removedIds=new Set(Object.keys(remote.deletedSongs??{}));
      await uploads.recover();
      for(const [id,link]of Object.entries(confirmedLinks))base.songs[id]??=structuredClone(link);
      if(identities.reconcile(remote)){snapshot=identities.project();await save();}
      await inspectRemovals(remote);
      state.skipped={};
      if (manual) await refreshBookNames(remote);
      const joinedBooks=identities.books(remote),joinedSongs=await identities.songs(remote,privateSong,uploads.discard);
      if(joinedBooks||joinedSongs){snapshot=identities.project();await save();}
      if(!state.joined&&!state.lastManual){
        const key=(song:Song)=>JSON.stringify([song.songbookId,song.origin.filename.normalize('NFC')]);
        const locals=snapshot.songs.filter(privateSong);
        for(const song of locals){
          if(!song.origin.filename)continue;
          if(state.reservations[song.id]?.fileId||state.manifest.songs[song.id]||Object.entries(state.reservations).some(([id,link])=>id.startsWith('copy:')&&link.id===song.id)||locals.filter(other=>key(other)===key(song)).length!==1)continue;
          const matches=claims.filter(claim=>claim.role==='content'&&claim.song.id!==song.id&&claim.book.folderId===state.folders[song.songbookId]?.folderId&&claim.song.origin.filename.normalize('NFC')===song.origin.filename.normalize('NFC'));
          if(new Set(matches.map(claim=>claim.song.id)).size===1){state.held??={};state.held[song.id]=true;state.awaitingDownload=true;}
        }
      }
      let local = localManifest();
      // The automatically seeded Standard book is not a conflicting user edit on a new device.
      if (identities.emptySeed()&&Object.keys(remote.books).length) local.books = {};
      let merged = mergeManifest(base, local, remote);
      await ensureBooks(merged);
      if (manual) {
        await discover(merged,publishedIds);
        if(await identities.songs(merged,privateSong,uploads.discard)){
          const previous=local;snapshot=identities.project();local=localManifest();
          for(const id of Object.keys(previous.songs))if(!local.songs[id]&&!remote.songs[id])delete merged.songs[id];
          await save();
        }
        merged = mergeManifest(base, local, merged);
      }
      // Reserve all new file paths before contacting Dropbox, including ambiguous-response retries.
      for (const song of snapshot.songs.filter(privateSong)) {
        const entry = merged.songs[song.id]; if (!entry) continue;
        if (!entry.path) {
          const reserved = state.reservations[song.id];
          entry.path = reserved?.path || `${merged.books[song.songbookId].path}/Private/${songFilename(song)}`;
          state.reservations[song.id] = {...entry}; await save();
        }
      }
      let complete = true;
      const readySongs: Manifest['songs'] = Object.fromEntries(Object.entries(remote.songs).filter(([id])=>publishedIds.has(id)));
      const entries=Object.values(merged.songs);
      const failed=new Set<string>();
      function fail(id:string,error:unknown){
        complete=false;failed.add(id);
        if(error instanceof SkippedFile){(state.skipped??={})[id]=true;return;}
        state.failure=failureInfo(error,'sync.song');hooks.failed?.(error);
      }
      function fatal(error:unknown){return error instanceof DeferredSync||error instanceof SyncFailure&&[failureCodes.network,failureCodes.authentication,failureCodes.permission,failureCodes.throttled].some(code=>code===error.info.code);}
      async function send(intents:UploadIntent[]){
        try{const results=await uploads.write(intents);for(const intent of intents){const result=results.get(intent.key);if(result&&'failure'in result)fail(intent.songId,new SyncFailure(result.failure,'En fil ble ikke overført.'));}return results;}
        catch(error){if(fatal(error))throw error;for(const intent of intents)fail(intent.songId,error);await save();return new Map();}
      }
      // First-join conflicts need concrete remote personal revisions. Establish
      // these defaults in a batch rather than one upload per discovered match.
      const seeds:UploadIntent[]=[];
      await parallel(entries,async entry=>{
        if(publishedIds.has(entry.id)||state.held?.[entry.id])return;
        if(!snapshot.songs.some(song=>song.id===entry.id)||!Object.values(state.bindings?.songs??{}).includes(entry.id))return;
        try{const content=await read(entry.fileId??entry.path);if(!content||await read(`/.app/songs/${entry.id}.json`))return;
          const personal:PersonalFile={version:1,songId:entry.id,original:{rev:content.rev,hash:await hash(content.text)},data:{songId:entry.id,version:3,chorus:{}}};
          seeds.push({key:`seed:${entry.id}`,songId:entry.id,kind:'seed',path:`/.app/songs/${entry.id}.json`,text:JSON.stringify(personal),rev:null,base:{original:content.text,personal}});
        }catch(error){if(fatal(error))throw error;fail(entry.id,error);}
      });
      await send(seeds);
      const plans:SongPlan[]=[];
      await parallel(entries,async entry=>{
        if(state.held?.[entry.id]||failed.has(entry.id))return;
        if(!manual&&!snapshot.songs.some(song=>song.id===entry.id))return;
        const current=snapshot.songs.find(s=>s.id===entry.id),base=state.bases[entry.id],prior=state.manifest.songs[entry.id];
        const desired=`${state.folders[entry.songbookId]?.path??`/Songbooks/${merged.books[entry.songbookId]?.name}`}/Private/${entry.path.split('/').at(-1)}`;
        const localSame=Boolean(current&&base&&prior&&base.personal.original.rev===base.contentRev&&current.original===base.original&&same(personalOf(snapshot,entry.id),base.personal.data)&&current.songbookId===entry.songbookId&&same(current.origin,entry.origin)&&entry.path===desired);
        const remoteSame=Boolean(base&&index.unchangedFile(entry.fileId,base.contentRev,entry.path)&&index.unchangedFile(undefined,base.personalRev,`/.app/songs/${entry.id}.json`));
        const unfinished=Object.values(state.uploads??{}).some(job=>job.songId===entry.id&&job.status!=='done');
        const needsOriginal=current&&originalFilename(current)&&!entry.originalFile&&!state.originals?.[entry.id];
        if(localSame&&!unfinished&&!needsOriginal&&(!resolution||resolution.conflict.songId!==entry.id)){
          if(remoteSame){readySongs[entry.id]=entry;return;}
          if(!manual){state.awaitingDownload=true;readySongs[entry.id]=entry;return;}
        }
        try{const plan=await prepareSong(entry,publishedIds.has(entry.id)&&Boolean(remote.songs[entry.id]),manual,resolution?.conflict.songId===entry.id?resolution:undefined);if(plan)plans.push(plan);else complete=false;}
        catch(error){if(fatal(error))throw error;fail(entry.id,error);await save();}
      });
      const contentResults=await send(plans.flatMap(plan=>plan.contentIntent?[plan.contentIntent]:[]));
      const finishing:Awaited<ReturnType<typeof finishContent>>[]=[];
      await parallel(plans,async plan=>{
        if(failed.has(plan.link.id))return;
        if(plan.contentIntent){const result=contentResults.get(plan.contentIntent.key);if(!result||!('value'in result))return;plan.content=result.value;}
        try{finishing.push(await finishContent(plan));}catch(error){if(fatal(error))throw error;fail(plan.link.id,error);await save();}
      });
      const finalResults=await send(finishing.flatMap(plan=>plan.intents));
      for(const plan of finishing){
        const {link,basis,chosenSong,chosenPersonal,contentChoice,personChoice,local}=plan;
        if(failed.has(link.id)||plan.intents.some(intent=>!finalResults.has(intent.key)))continue;
        const result=finalResults.get(`personal:${link.id}`),savedPerson=plan.savedPerson??(result&&'value'in result?result.value:null);
        if(!savedPerson){complete=false;continue;}
        state.bases[link.id]={original:contentChoice==='remote'?basis!.original:chosenSong.original,personal:personChoice==='remote'?basis!.personal:plan.nextPerson,contentRev:plan.referenceRev,personalRev:personChoice==='remote'?basis!.personalRev:savedPerson.rev};
        if(state.reservations[link.id]?.originalFile)link.originalFile=state.reservations[link.id].originalFile;
        delete state.decisions[`${link.id}:content`];delete state.decisions[`${link.id}:personal`];
        if(plan.apply)await save({...(manual?{books:Object.values(state.folders).filter(b=>!b.deleted).map(({id,name})=>({id,name}))}:{}),songs:[{...chosenSong,songbookId:manual?link.songbookId:local?.songbookId??link.songbookId}],personal:[chosenPersonal]});else await save();
        if(!plan.waitingRemote)readySongs[link.id]=link;else complete=false;
      }
      merged.songs = readySongs;
      for (const [id, book] of Object.entries(merged.books)) if (book.deleted && Object.values(readySongs).some(song => song.songbookId === id)) {
        if (!remote.books[id]) throw new SyncFailure({code:failureCodes.bookChanges,stage:'sync.book-state'},'Flytting av sangene er ikke fullført.');
        merged.books[id] = remote.books[id]; complete = false;
      }
      const finalText = JSON.stringify(merged);
      // Validate invariants before publishing, including IDs learned during uploads.
      parseManifest(finalText);
      // Conditional whole-manifest write preserves independent remote changes or stops for retry.
      if (!manifestFile || !same(parseManifest(manifestFile.text), merged)) await write('/.app/library.json', finalText, manifestFile?.rev ?? null);
      await uploads.clearClaims(merged);
      // Only acknowledge the local identities actually represented in this manifest.
      for (const [id, book] of Object.entries(local.books)) if (merged.books[id] && book.name === merged.books[id].name && Boolean(book.deleted) === Boolean(merged.books[id].deleted)) state.manifest.books[id] = merged.books[id];
      for (const song of snapshot.songs) if (readySongs[song.id]?.songbookId === song.songbookId && same(readySongs[song.id].origin, song.origin)) state.manifest.songs[song.id] = readySongs[song.id];
      if(merged.deletedSongs)state.manifest.deletedSongs={...merged.deletedSongs};
      for(const book of Object.values(merged.books).filter(b=>b.deleted))state.manifest.books[book.id]={...book};
      for(const [key,copy]of Object.entries(state.reservations))if(key.startsWith('copy:')&&!state.decisions[`${key.slice(5)}:content`]&&(merged.songs[copy.id]||merged.deletedSongs?.[copy.id]))delete state.reservations[key];
      if (manual) {
        const books = Object.values(merged.books).filter(b => !b.deleted && !local.books[b.id]?.deleted).map(({id, name}) => ({...snapshot.songbooks.find(b => b.id === id), id, name}));
        const deleted = snapshot.songbooks.filter(b => merged.books[b.id]?.deleted || !local.books[b.id] && !merged.books[b.id]).map(b => b.id);
        if(files.deleteFile)await parallel(Object.keys(merged.deletedSongs??{}),async id=>{const entry=index.find(`/.app/songs/${id}.json`);if(entry?.id&&entry.rev)await step(()=>files.deleteFile!(entry.id!,entry.rev!));});
        state.manifest = structuredClone(merged);const removed=removedChanges(merged);await save({books,deleteBooks:[...new Set([...deleted,...removed.deleteBooks])],deleteSongs:removed.deleteSongs});
      }
      for (const book of Object.values(merged.books).filter(b => b.deleted && b.folderId)) {
        const remaining = await step(() => files.locateFolder(book.folderId!));
        if (!remaining || !/^\/Songbooks\/[^/]+$/i.test(remaining.path)) continue;
        // The deleted folder's ID must still own this path; a reused name is a new identity.
        for (const kind of ['Private', 'Shared', 'Import', 'Originals']) await step(() => files.removeEmpty(`${remaining.path}/${kind}`));
        await step(() => files.removeEmpty(remaining.path));
      }
      complete &&= !state.conflicts.length && !snapshot.songs.some(song => privateSong(song) && !merged.deletedSongs?.[song.id] && !readySongs[song.id]);
      complete &&= !Object.values(state.uploadIndex?.value.entries??{}).some(claim=>!claimReady(claim,merged));
      state.pending = !complete;
      if (complete) state.localGeneration = generation;
      if (manual && complete) state.lastManual = new Date().toISOString();
      if(manual&&complete)state.joined=true;
      uploads.clearDone();await save({recoveryComplete: manual && complete}); return state;
    } catch (error) {
      delete state.error; state.pending = true;
      if(error instanceof DeferredSync){delete state.failure;if(error.reason==='remote')state.awaitingDownload=true;}
      else {state.failure=failureInfo(error,'sync.run');hooks.failed?.(error);}
      // A stale run must not acknowledge work or overwrite state belonging to a newer session.
      try {await save();} catch { /* The next safe run starts from durable progress. */ }
      throw error;
    }
  }
  return {run};
}
