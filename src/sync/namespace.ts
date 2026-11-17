import {DeferredSync,SubmittedBatchInterruption,RetrySync,SyncFailure,failureCodes,BatchJobFailed} from './failure.ts';
import {pathKey} from './remote.ts';
import type {BookLink,DeleteEntry,FolderEntry,MoveEntry,MoveReply,MoveResult,NamespaceJob,RemoteEntry,RemoteFiles,SyncState} from './model.ts';

type Hooks={check():Promise<void>;save():Promise<void>;receipt(job:NamespaceJob):Promise<void>;freshList:RemoteFiles['list'];find(path:string):RemoteEntry|undefined;removed(entry:DeleteEntry):void;moved(entry:MoveEntry,value:{id:string;path:string}):void};
class MissingCreatedFolder extends Error {}
/** One persisted namespace mutation at a time. Completion receipts never
 * acknowledge a newer generation. Deletes use ID+rev; staging uses its nonce
 * literal path. Unknown ID-move/create launches are never blindly replayed. */
export function namespaceQueue(files:RemoteFiles,state:SyncState,hooks:Hooks){
 const size=100;
 const inspect=async(path:string):Promise<RemoteEntry|null>=>{await hooks.check();const value=files.metadata?await files.metadata(path):await files.locateFolder(path).then(value=>value?{...value,folder:true}:null);await hooks.check();return value;};
 const stage=(kind:NamespaceJob['kind'])=>`dropbox.${kind==='move'?'move':kind}-batch`;
 const bad=(kind:NamespaceJob['kind'],message:string)=>new SyncFailure({code:failureCodes.response,stage:stage(kind)},message);
 const invalid=()=>new SyncFailure({code:failureCodes.manifest,stage:'sync.namespace',action:'mutation-state'},'Ugyldig fullmakt i batchjournalen.');
 async function authorize(job:NamespaceJob){
  if(!job||!['move','delete','folders'].includes(job.kind)||typeof job.id!=='string'||!Array.isArray(job.entries)||!job.entries.length||job.entries.length>size||!Number.isInteger(job.attempt)||job.attempt<0||job.attempt>2)throw invalid();
  const manifest=state.library?.value,books={...state.manifest.books,...state.folders,...manifest?.books};
  for(const item of job.entries){
   if(!item||typeof item.key!=='string')throw invalid();
   if(job.kind==='delete'){
    const entry=item as DeleteEntry;if(typeof entry.fileId!=='string'||!entry.fileId||typeof entry.path!=='string')throw invalid();
    if(entry.category==='personal'){
     const id=/^personal:([a-zA-Z0-9_-]{1,128})$/.exec(entry.key)?.[1];
     if(!id||!manifest?.deletedSongs?.[id]||entry.sourcePath!==`/.app/songs/${id}.json`||entry.path!==entry.fileId||!entry.rev||entry.folder)throw invalid();
     const actual=await inspect(entry.fileId);if(actual&&(actual.folder||pathKey(actual.path)!==pathKey(entry.sourcePath)))throw invalid();
    }else if(entry.category==='staging'){
     if(!/^\/\.app\/uploads\/[a-f0-9-]{36}\.cho$/.test(entry.path)||entry.folder||!entry.rev||!Object.values(state.uploads??{}).some(upload=>upload.creation?.path===entry.path)&&!state.abandoned?.some(row=>row.path===entry.path))throw invalid();
     const actual=await inspect(entry.path);if(actual&&(actual.id!==entry.fileId||actual.folder))throw invalid();
    }else if(entry.category==='folder'){
     if(!entry.folder||entry.rev||entry.path!==entry.fileId||typeof entry.sourcePath!=='string')throw invalid();
     const book=Object.values(manifest?.books??{}).find(book=>book.deleted&&book.folderId&&book.path&&(pathKey(entry.sourcePath!)===pathKey(book.path)||['Private','Shared','Import','Originals'].some(kind=>pathKey(entry.sourcePath!)===pathKey(book.path+'/'+kind))));
     if(!book)throw invalid();const actual=await inspect(entry.fileId);
     if(actual){if(!actual.folder||pathKey(actual.path)!==pathKey(entry.sourcePath))throw invalid();if(pathKey(actual.path)===pathKey(book.path!)){if(actual.id!==book.folderId)throw invalid();}else if((await inspect(actual.path.slice(0,actual.path.lastIndexOf('/'))))?.id!==book.folderId)throw invalid();}
    }else throw invalid();
   }else if(job.kind==='move'){
    const entry=item as MoveEntry;if(typeof entry.fileId!=='string'||entry.from!==entry.fileId||typeof entry.to!=='string')throw invalid();
    if(entry.folder){const book=Object.values(books).find(book=>book.folderId===entry.fileId);if(!book||entry.book&&entry.book.id!==book.id||!/^\/Songbooks\/[^/]+$/.test(entry.to))throw invalid();}
    else{
     const link=entry.link,known=link&&(state.reservations[link.id]??manifest?.songs[link.id]??state.manifest.songs[link.id]);
     if(!link||known?.fileId!==entry.fileId||!books[link.songbookId]||!/^\/Songbooks\/[^/]+\/Private\/[^/]+\.cho$/i.test(entry.to)||!entry.toReference)throw invalid();
     const parent=await inspect(entry.toReference.split('/')[0]),book=books[link.songbookId];
     if(!parent?.folder||(await inspect(parent.path.slice(0,parent.path.lastIndexOf('/'))))?.id!==book.folderId||parent.path.split('/').at(-1)!.toLowerCase()!=='private')throw invalid();
    }
   }else{
    const entry=item as FolderEntry;
    if(typeof entry.path!=='string'||!/^\/(?:\.app(?:\/(?:songs|uploads))?|Songbooks(?:\/[^/]+(?:\/(?:Private|Shared|Import|Originals))?)?)$/i.test(entry.path))throw invalid();
    const match=/^\/Songbooks\/([^/]+)/i.exec(entry.path);
    if(match&&!Object.values(books).some(book=>pathKey(book.path??`/Songbooks/${book.name}`)===pathKey('/Songbooks/'+match[1])))throw invalid();
    if(entry.book&&(!books[entry.book.id]||entry.path!==`/Songbooks/${entry.book.name}`))throw invalid();
   }
  }
 }
 async function receipt(job:NamespaceJob,reply:MoveReply){job.reply=reply;if('asyncJobId'in reply)job.jobId=reply.asyncJobId;await hooks.receipt(job);await hooks.check();}
 async function verifyFolder(entry:FolderEntry,value:{id:string;path:string}){
  const current=await inspect(value.id);if(!current)throw new MissingCreatedFolder();if(!current.folder)throw bad('folders','Opprettingskvitteringen viser ikke en mappe.');
  let actual:RemoteEntry=current;
  if(entry.parentId){
   let parent=await inspect(actual.path.slice(0,actual.path.lastIndexOf('/')));
   if(parent?.id!==entry.parentId){if(parent?.id){const job=state.namespaceJob!;job.quarantinedParents=[...new Set([...(job.quarantinedParents??[]),parent.id])];await hooks.save();}throw new SyncFailure({code:failureCodes.bookChanges,stage:'sync.namespace',action:'check-folders'},'Mappen ble opprettet under en annen forelder.');}
  }
  return{id:value.id,path:actual.path,folder:true};
 }
 async function apply(job:NamespaceJob,reply:MoveReply):Promise<boolean>{
  if('asyncJobId'in reply||'inProgress'in reply){delete job.reply;await hooks.save();return false;}
  if('jobExpired'in reply){delete job.jobId;delete job.reply;await hooks.save();return false;}
  if(reply.entries.length!==job.entries.length)throw bad(job.kind,'Ufullstendig batchkvittering.');
  let failure:MoveResult|undefined,missingCreation=false;const retry:NamespaceJob['entries']=[];
  for(let i=0;i<job.entries.length;i++){
   const entry=job.entries[i],result=reply.entries[i];
   if(job.kind==='delete'){
    const deletion=entry as DeleteEntry;
    if('value'in result&&result.value.id!==deletion.fileId)throw bad(job.kind,'Sletting bekreftet en annen filidentitet.');
    if('failure'in result&&result.missing&&deletion.category!=='staging'){
      const remaining=await inspect(deletion.fileId);
      if(remaining){failure={failure:{code:failureCodes.changed,stage:stage('delete')},collision:true};retry.push(entry);continue;}
    }
    if('value'in result||result.missing){hooks.removed(deletion);continue;}
   }else if(job.kind==='folders'){
    const creation=entry as FolderEntry;
    if('value'in result){
     try{const value=await verifyFolder(creation,result.value);if(creation.book){
       (state.createdBooks??={})[creation.book.id]={...creation.book,folderId:value.id,path:creation.path};
       state.folders[creation.book.id]={...creation.book,folderId:value.id,path:value.path,name:value.path.split('/').at(-1)!};
       if(pathKey(value.path)!==pathKey(creation.path))missingCreation=true;
     }}
     catch(error){if(!(error instanceof MissingCreatedFolder))throw error;missingCreation=true;if(creation.book)state.folders[creation.book.id]={...creation.book,folderId:result.value.id,path:result.value.path||creation.path};}
     continue;
    }
    if(result.collision){const actual=await inspect(creation.path);if(actual?.folder){await verifyFolder(creation,{id:actual.id!,path:actual.path});if(creation.book)state.folders[creation.book.id]={...creation.book,folderId:actual.id,path:actual.path};continue;}}
   }else if('value'in result){
    const move=entry as MoveEntry;if(result.value.id!==move.fileId)throw bad(job.kind,'Flytting bekreftet en annen identitet.');
    const actual=await inspect(move.fileId);
    if(!actual){failure={failure:{code:failureCodes.changed,stage:stage(job.kind)}};continue;}
    const path=actual.path;hooks.moved(move,{id:move.fileId,path});
    if(pathKey(path)!==pathKey(move.to))failure={failure:{code:failureCodes.changed,stage:stage(job.kind)}};
    continue;
   }else if(job.kind==='move'&&result.missing){await inspect((entry as MoveEntry).fileId);failure={failure:{code:failureCodes.changed,stage:stage('move')}};continue;}
   failure??=result;retry.push(entry);
  }
  delete state.namespaceJob;await hooks.save();
  if(missingCreation)throw new RetrySync();
  if(failure&&'failure'in failure){
   if(failure.failure.code===failureCodes.throttled&&job.attempt<2&&reply.entries.every(result=>'value'in result||result.missing||result.failure.code===failureCodes.throttled)){
    state.namespaceJob={id:crypto.randomUUID(),kind:job.kind,entries:retry,attempt:job.attempt+1};await hooks.save();await recover(true);return true;
   }
   if(failure.collision||failure.failure.code===failureCodes.changed)throw new RetrySync();throw new SyncFailure(failure.failure,'En batchoperasjon er ikke fullført.');
  }
  return true;
 }
 async function observeUnknown(job:NamespaceJob){
  const entries:MoveResult[]=[];
  for(const item of job.entries){
   if(job.kind==='move'){
    const entry=item as MoveEntry,actual=await inspect(entry.fileId);
    if(!actual){entries.push({failure:{code:failureCodes.missingFile,stage:stage('move')},missing:true});continue;}
    const reference=entry.toReference?.split('/')[0],parent=reference?(hooks.find(reference)??await inspect(reference)):null;
    const target=parent?parent.path+'/'+entry.to.split('/').at(-1):entry.to;
    if(pathKey(actual.path)!==pathKey(target))throw new SyncFailure({code:failureCodes.changed,stage:'sync.namespace',action:'check-move'},'Flyttingen er fortsatt uavklart.');
    entries.push({value:{id:entry.fileId,path:actual.path,folder:actual.folder,rev:actual.rev}});
   }else{
    const entry=item as FolderEntry,actual=await inspect(entry.path);
    if(!actual?.folder)throw new SyncFailure({code:failureCodes.changed,stage:'sync.namespace',action:'check-folders'},'Mappeopprettelsen er fortsatt uavklart.');
    entries.push({value:{id:actual.id!,path:actual.path,folder:true}});
   }
  }
  return apply(job,{entries});
 }
 async function launch(job:NamespaceJob){
  await hooks.check();await authorize(job);
  if(job.submitted&&job.kind!=='delete')return observeUnknown(job);
  if(job.kind==='folders')for(const entry of job.entries as FolderEntry[])if(entry.parentId){const parent=await inspect(entry.parentId);if(!parent||pathKey(parent.path)!==pathKey(entry.path.slice(0,entry.path.lastIndexOf('/')))){delete state.namespaceJob;await hooks.save();throw new RetrySync();}}
  if(job.kind==='delete')for(const entry of job.entries as DeleteEntry[])if(entry.folder){const actual=await inspect(entry.fileId);if(actual&&(await hooks.freshList(actual.path)).length){delete state.namespaceJob;await hooks.save();throw new DeferredSync('remote','Mappen har fått nytt innhold.');}}
  job.submitted=true;delete job.reply;await hooks.save();await hooks.check();
  let reply:MoveReply;
  try{
   if(job.kind==='move'){if(!files.moveBatch)throw bad(job.kind,'Batchflytting mangler.');reply=await files.moveBatch(job.entries as MoveEntry[],job.attempt);}
   else if(job.kind==='delete'){if(!files.deleteBatch)throw bad(job.kind,'Batchsletting mangler.');reply=await files.deleteBatch(job.entries as DeleteEntry[],job.attempt);}
   else{if(!files.createFoldersBatch)throw bad(job.kind,'Batchoppretting mangler.');reply=await files.createFoldersBatch(job.entries as FolderEntry[],job.attempt);}
  }catch(error){
   // This adapter returns successful transport receipts before its post-request
   // generation guard. Preflight guards and explicit 4xx rejection therefore
   // prove that this launch was not accepted, unlike an unknown network reply.
   const rejected=error instanceof DeferredSync&&!(error instanceof SubmittedBatchInterruption)||error instanceof SyncFailure&&error.info.status!==undefined&&error.info.status>=400&&error.info.status<500&&error.info.status!==408;
   if(rejected){job.submitted=false;delete job.jobId;await hooks.receipt(job);if(error instanceof SyncFailure&&error.info.status===409)throw new RetrySync();}
   throw error;
  }
  await receipt(job,reply);return apply(job,reply);
 }
 async function recover(plannedNow=false){
  const job=state.namespaceJob;if(!job)return;
  await authorize(job);
  // A journal saved before launch, or explicitly rejected by Dropbox, has no
  // physical effect to resume. Recompute it after fresh master inspection;
  // Shared/Originals/missing sources can have changed since it was planned.
  if(!plannedNow&&!job.submitted&&!job.jobId&&!job.reply){delete state.namespaceJob;await hooks.save();throw new RetrySync();}
  for(const id of job.quarantinedParents??[])if(await inspect(id))throw new SyncFailure({code:failureCodes.bookChanges,stage:'sync.namespace',action:'check-folders'},'En uavklart foreldermappe finnes fortsatt.');
  if(job.reply){if(await apply(job,job.reply))return;}
  if(!job.jobId){if(await launch(job))return;if(!state.namespaceJob)return;}
  const check=job.kind==='move'?files.checkMoveBatch:job.kind==='delete'?files.checkDeleteBatch:files.checkCreateFoldersBatch;
  if(!check)throw bad(job.kind,'Batchstatus mangler.');
  for(const delay of [0,250,750,1500,3000]){
   if(!job.jobId){if(await launch(job))return;continue;}
   for(let left=delay;left>0;left-=100){await hooks.check();await new Promise(resolve=>setTimeout(resolve,Math.min(100,left)));}
   await hooks.check();let reply:MoveReply;
   try{reply=await check(job.jobId,job.attempt);}catch(error){if(error instanceof BatchJobFailed){delete state.namespaceJob;await hooks.save();throw new RetrySync();}throw error;}
   await receipt(job,reply);if(await apply(job,reply))return;
  }
  throw new DeferredSync('connection','Dropbox-jobben er ikke ferdig.');
 }
 async function execute(kind:NamespaceJob['kind'],entries:NamespaceJob['entries']){
  await recover();for(let offset=0;offset<entries.length;offset+=size){state.namespaceJob={id:crypto.randomUUID(),kind,entries:structuredClone(entries.slice(offset,offset+size)),attempt:0};await hooks.save();await recover(true);}
 }
 async function folders(entries:FolderEntry[]){
  const byPath=new Map(entries.map(entry=>[pathKey(entry.path),entry]));
  for(const depth of [...new Set([...byPath.values()].map(entry=>entry.path.split('/').length))].sort((a,b)=>a-b)){
   const group:FolderEntry[]=[];
   for(const entry of byPath.values())if(entry.path.split('/').length===depth){
    const current=hooks.find(entry.path);if(current?.folder&&current.id)continue;if(current&&!current.folder)throw new SyncFailure({code:failureCodes.folderOccupied,stage:'dropbox.ensure-folder',action:'folder-layout'},'En fil står på mappeplassen.');
    const parent=entry.path.slice(0,entry.path.lastIndexOf('/'));group.push({...entry,...(parent?{parentId:hooks.find(parent)?.id}:{})});
   }
   if(group.length)await execute('folders',group);
  }
 }
 async function folder(path:string,expectedId?:string){
  if(expectedId)return files.folder(path,expectedId);
  if(!hooks.find(path)?.id)await folders([{key:path,path}]);
  return files.folder(path);
 }
 async function remove(entries:DeleteEntry[]){if(entries.length)await execute('delete',entries);}
 async function removeEmpty(paths:string[]){
  const entries:DeleteEntry[]=[];
  for(const path of paths){const current=await inspect(path);if(!current)continue;if(!current.folder)throw bad('delete','Slettemålet er ikke en mappe.');if(!(await hooks.freshList(current.path)).length)entries.push({key:current.id!,path:current.id!,sourcePath:current.path,fileId:current.id!,folder:true,category:'folder'});}
  await remove(entries);
 }
 return{recover,folders,folder,remove,removeEmpty,move:(entries:MoveEntry[])=>execute('move',entries)};
}
