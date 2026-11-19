import {DeferredSync,failureCodes,SyncFailure} from './failure.ts';
import {parseManifest,type FileValue,type RemoteEntry,type RemoteFiles,type SyncState,type MoveReply,type MoveEntry} from './model.ts';
import {checkSize,textBytes} from './limits.ts';
import {parseUploadIndex,uploadIndexPath} from './bridge.ts';

export const pathKey=(path:string)=>path.normalize('NFC').toLowerCase();
/** A phase uses one immutable, complete view for IDs, paths and all children. */
export function metadataView(entries:RemoteEntry[]){
  const values=entries.map(entry=>Object.freeze({...entry})),paths=new Map(values.map(entry=>[pathKey(entry.path),entry])),ids=new Map(values.filter(entry=>entry.id).map(entry=>[entry.id!,entry]));
  return{find:(path:string)=>path.startsWith('id:')?ids.get(path):paths.get(pathKey(path)),nonempty:(path:string)=>values.some(entry=>pathKey(entry.path).startsWith(pathKey(path)+'/'))};
}
/** A complete metadata index, advanced only after every page has been received. */
export function indexedFiles(raw:RemoteFiles,state:SyncState){
  let refreshing=false;
  const find=(path:string)=>state.remote&&(path.startsWith('id:')?Object.values(state.remote.entries).find(e=>e.id===path):state.remote.entries[pathKey(path)]);
  function remember(key:string){if(!state.remote||refreshing)return;const before=state.remote.beforeUpdates??={};if(!Object.hasOwn(before,key))before[key]=state.remote.entries[key]?{...state.remote.entries[key]}:null;}
  function set(entry:RemoteEntry){if(!state.remote)return;const key=pathKey(entry.path);remember(key);state.remote.entries[key]={...entry};}
  function remove(path:string){if(!state.remote)return;const key=pathKey(path);for(const current of Object.keys(state.remote.entries))if(current===key||current.startsWith(key+'/')){remember(current);delete state.remote.entries[current];}}
  function put(entry:RemoteEntry){
    if(!state.remote)return;
    if(entry.deleted){remove(entry.path);return;}
    const previous=entry.id&&Object.values(state.remote.entries).find(e=>e.id===entry.id);
    if(previous&&previous.path!==entry.path){
      const key=pathKey(previous.path),children=previous.folder?Object.values(state.remote.entries).filter(e=>pathKey(e.path).startsWith(key+'/')):[];
      remove(previous.path);for(const child of children)set({...child,path:entry.path+child.path.slice(previous.path.length)});
    }
    if(!entry.folder)remove(entry.path);
    set(entry);
    let parent=entry.path.slice(0,entry.path.lastIndexOf('/'));
    while(parent){if(!state.remote.entries[pathKey(parent)])set({path:parent,folder:true});parent=parent.slice(0,parent.lastIndexOf('/'));}
  }
  function moved(reply:MoveReply,entries:MoveEntry[]){
    if(!('entries'in reply))return reply;
    if(reply.entries.length!==entries.length)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move-batch'},'Ufullstendig flytteresultat.');
    for(let i=0;i<entries.length;i++){
      const result=reply.entries[i],plan=entries[i];if(!('value'in result))continue;
      let path=result.value.path;
      // Dropbox permits omitted display paths. A folder-ID-relative target can
      // have moved since launch, so its old absolute name is not a receipt.
      // Return transport receipts before any follow-up request/generation guard.
      // The durable queue resolves optional paths after journaling the receipt.
      if(!path&&plan.toReference)continue;
      path||=plan.to;
      const matches=plan.toReference?pathKey(path.split('/').at(-1)!)===pathKey(plan.to.split('/').at(-1)!):pathKey(path)===pathKey(plan.to);
      if(result.value.id!==plan.fileId||!matches)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move-batch'},'Ugyldig flyttekvittering.');
      // A complete receipt for the folder-ID request can confirm a result
      // before the next inventory. A different or omitted path needs lookup.
      if(plan.publication&&pathKey(path)!==pathKey(plan.to))continue;
      result.value.path=path;const old=find(result.value.id);put({...old,...result.value,folder:result.value.folder??plan.folder??false});
    }
    return reply;
  }
  const files:RemoteFiles={
    ...(raw.changes?{async metadataSnapshot(){
      await refresh();
      // Child metadata can prove that a parent exists even if its own entry is
      // absent. Resolve only such inferred parents; never treat that as deletion.
      for(const entry of Object.values(state.remote!.entries))if(entry.folder&&!entry.id){const actual=await raw.locateFolder(entry.path);if(actual)put({...actual,folder:true});}
      return Object.values(state.remote!.entries).map(entry=>({...entry}));
    }}:{}),
    ...(raw.metadata?{async metadata(path:string){const value=await raw.metadata!(path);if(value)put(value);else{const old=find(path);if(old)remove(old.path);}return value;}}:{}),
    async inspectFile(path){const result=await raw.read(path);if(result)put({id:result.id,path:result.path,rev:result.rev,folder:false,size:textBytes(result.text)});else{const entry=find(path);if(entry)remove(entry.path);}return result;},
    async read(path){
      if(path.startsWith('rev:')){const match=Object.entries(state.bases).find(([,base])=>base.contentRev===path.slice(4));if(match){const link=state.manifest.songs[match[0]]??state.reservations[match[0]];if(link?.fileId)return{text:match[1].original,id:link.fileId,rev:path.slice(4),path};}}
      const entry=find(path);
      if(entry?.size!==undefined)checkSize(entry.size);
      if(state.remote&&!entry&&!path.startsWith('rev:'))return null;
      if(entry?.id&&entry.rev){
        let text:string|undefined;
        if(pathKey(entry.path)==='/.app/library.json'&&state.library?.rev===entry.rev)text=JSON.stringify(state.library.value);
        if(pathKey(entry.path)===uploadIndexPath&&state.uploadIndex?.rev===entry.rev)text=JSON.stringify(state.uploadIndex.value);
        const personal=/^\/\.app\/songs\/([^/]+)\.json$/i.exec(entry.path),base=personal&&state.bases[personal[1]];
        if(base&&base.personalRev===entry.rev)text=JSON.stringify(base.personal);
        if(text===undefined){const link=Object.values(state.manifest.songs).find(s=>s.fileId===entry.id)??Object.values(state.reservations).find(s=>s.fileId===entry.id);const basis=link&&state.bases[link.id];if(basis?.contentRev===entry.rev)text=basis.original;}
        if(text!==undefined)return{text,id:entry.id,rev:entry.rev,path:entry.path};
      }
      const result=await raw.read(path,entry?.path);
      if(result&&!path.startsWith('rev:')){put({id:result.id,path:result.path,rev:result.rev,folder:false});if(pathKey(result.path)==='/.app/library.json')state.library={id:result.id,rev:result.rev,value:parseManifest(result.text)};}
      else if(entry)remove(entry.path);
      return result;
    },
    async write(path,text,rev){const result=await raw.write(path,text,rev);put({id:result.id,path:result.path,rev:result.rev,folder:false});if(pathKey(path)==='/.app/library.json')state.library={id:result.id,rev:result.rev,value:parseManifest(text)};if(pathKey(path)===uploadIndexPath)state.uploadIndex={id:result.id,rev:result.rev,value:parseUploadIndex(text)};return result;},
    ...(raw.beginUpload?{beginUpload:raw.beginUpload}:{}),
    ...(raw.beginUploadBatch?{beginUploadBatch:raw.beginUploadBatch}:{}),
    ...(raw.withMoveReceipt?{withMoveReceipt:raw.withMoveReceipt}:{}),
    ...(raw.commitBatch?{async commitBatch(jobs){const results=await raw.commitBatch!(jobs);for(const result of results)if('value'in result)put({id:result.value.id,path:result.value.path,rev:result.value.rev,folder:false,size:textBytes(result.value.text)});return results;}}:{}),
    ...(raw.moveBatch?{async moveBatch(entries,retryAttempt,options){return moved(await raw.moveBatch!(entries,retryAttempt,options),entries);}}:{}),
    ...(raw.checkMoveBatch?{async checkMoveBatch(id,retryAttempt){return moved(await raw.checkMoveBatch!(id,retryAttempt),state.namespaceJob?.kind==='move'?state.namespaceJob.entries as MoveEntry[]:state.placement?.entries??[]);}}:{}),
    ...(raw.createFoldersBatch?{async createFoldersBatch(entries,retryAttempt,options){const reply=await raw.createFoldersBatch!(entries,retryAttempt,options);return foldersCreated(reply,entries);}}:{}),
    ...(raw.checkCreateFoldersBatch?{async checkCreateFoldersBatch(id,retryAttempt){return foldersCreated(await raw.checkCreateFoldersBatch!(id,retryAttempt),state.namespaceJob?.entries as import('./model.ts').FolderEntry[]??[]);}}:{}),
    ...(raw.deleteBatch?{async deleteBatch(entries,retryAttempt,options){return deleted(await raw.deleteBatch!(entries,retryAttempt,options),entries);}}:{}),
    ...(raw.checkDeleteBatch?{async checkDeleteBatch(id,retryAttempt){return deleted(await raw.checkDeleteBatch!(id,retryAttempt),state.namespaceJob?.entries as import('./model.ts').DeleteEntry[]??[]);}}:{}),
    async folder(path,expectedId){
      const current=find(expectedId??path);
      if(current){
        if(!current.folder)throw new SyncFailure({code:failureCodes.folderOccupied,stage:'dropbox.ensure-folder',action:'folder-layout'},'En fil står på en nødvendig mappeplassering.');
        if(expectedId&&pathKey(current.path)!==pathKey(path))throw new DeferredSync('remote','Mappeendringer venter på manuell synk.');
        if(current.id)return{id:current.id,path:current.path};
      }
      const result=await raw.folder(path,expectedId,Boolean(state.remote&&!current));put({...result,folder:true});return result;
    },
    async locateFolder(id){
      if(!state.remote)return raw.locateFolder(id);const entry=find(id);if(entry?.folder&&entry.id)return{id:entry.id,path:entry.path};
      // A complete inventory proves absence, except an inferred parent lacking
      // its own metadata. Preserve the conservative incomplete-parent fallback.
      const book=Object.values({...state.manifest.books,...state.folders}).find(book=>book.folderId===id),parent=book?.path&&find(book.path);
      if(!entry&&!(parent&&parent.folder&&!parent.id))return null;
      const actual=await raw.locateFolder(id);if(actual)put({...actual,folder:true});return actual;
    },
    async move(from,to){const current=find(from),result=await raw.move(from,to,current?.id?{id:current.id,path:current.path}:undefined);put({...current,...result,folder:current?.folder??false});return result;},
    async list(path){if(!state.remote)return raw.list(path);const prefix=pathKey(path)+'/',entries=Object.values(state.remote.entries).filter(e=>pathKey(e.path).startsWith(prefix)&&!e.path.slice(path.length+1).includes('/'));for(const entry of entries)if(!entry.id&&entry.folder){const actual=await raw.locateFolder(entry.path);if(actual){Object.assign(entry,actual);put({...actual,folder:true});}else remove(entry.path);}return entries.filter(e=>e.id).map(e=>({id:e.id!,path:e.path,folder:Boolean(e.folder)}));},
    async removeEmpty(path){if(state.remote&&(await files.list(path)).length)return false;const removed=await raw.removeEmpty(path);if(removed)remove(path);return removed;},
    ...(raw.deleteFile?{async deleteFile(path:string,rev:string){await raw.deleteFile!(path,rev);const entry=find(path);if(entry)remove(entry.path);}}:{}),
  };
  function foldersCreated(reply:MoveReply,entries:import('./model.ts').FolderEntry[]){
    if(!('entries'in reply))return reply;if(reply.entries.length!==entries.length)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.folders-batch'},'Ufullstendig mappekvittering.');
    for(let i=0;i<entries.length;i++){const result=reply.entries[i];if(!('value'in result))continue;result.value.path||=entries[i].path;put({...result.value,folder:true});}return reply;
  }
  function deleted(reply:MoveReply,entries:import('./model.ts').DeleteEntry[]){
    if(!('entries'in reply))return reply;if(reply.entries.length!==entries.length)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.delete-batch'},'Ufullstendig slettekvittering.');
    for(let i=0;i<entries.length;i++){const result=reply.entries[i],entry=entries[i];if('value'in result&&result.value.id!==entry.fileId)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.delete-batch'},'Sletting bekreftet feil identitet.');if('value'in result||result.missing){const old=find(entry.fileId);if(old&&(entry.category!=='staging'||pathKey(old.path)===pathKey(entry.path)))remove(old.path);}}return reply;
  }
  async function refresh(){
    if(!raw.changes)return;
    const update=await raw.changes(state.remote?.cursor),previous=state.remote;
    state.remote={cursor:update.cursor,entries:update.reset?{}:{...previous?.entries},epoch:(previous?.epoch??0)+(update.reset?1:0)};
    if(!update.reset)for(const [key,before]of Object.entries(previous?.beforeUpdates??{})){if(before)state.remote.entries[key]=before;else delete state.remote.entries[key];}
    refreshing=true;try{for(const entry of update.entries)put(entry);}finally{refreshing=false;}
  }
  function unchangedFile(id:string|undefined,rev:string,path:string){const entry=find(id??path);return Boolean(entry?.id&&entry.rev===rev&&!entry.folder);}
  return{files,refresh,find,unchangedFile,forget(id:string){const old=find(id);if(old)remove(old.path);}};
}
