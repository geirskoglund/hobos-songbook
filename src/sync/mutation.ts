import {DeferredSync,RetrySync,SyncFailure,failureCodes} from './failure.ts';
import type {RemoteFiles,SyncState} from './model.ts';

export const mutationPath='/.app/mutation.json';
type Lock={version:1;owner:string|null;libraryRev:string|null};
function parse(text:string):Lock{
 try{const value=JSON.parse(text);if(value?.version!==1||value.owner!==null&&(typeof value.owner!=='string'||!/^[a-f0-9-]{36}$/.test(value.owner))||value.libraryRev!==null&&(typeof value.libraryRev!=='string'||!value.libraryRev))throw Error();return value;}
 catch(cause){throw new SyncFailure({code:failureCodes.manifest,stage:'sync.namespace'},'Ugyldig mutasjonsvern.',cause);}
}
/** All cooperating devices acquire this CAS fence before reading their working
 * library and mutating its namespace. It has no clock-based takeover: Dropbox
 * cannot cancel/fence a delayed ID-based move or absolute folder creation.
 * The same durable owner resumes after interruption, through manifest commit. */
export function mutationFence(files:RemoteFiles,state:SyncState,hooks:{check():Promise<void>;save():Promise<void>}){
 let held=false,revision:string|undefined;
 async function acquire(){
  state.mutationOwner??=crypto.randomUUID();state.mutationPending=true;await hooks.save();await hooks.check();
  const current=await files.read(mutationPath);await hooks.check();const lock=current?parse(current.text):null;
  if(state.mutationFileId&&!current||current&&state.mutationFileId&&current.id!==state.mutationFileId)throw new SyncFailure({code:failureCodes.manifest,stage:'sync.namespace',action:'mutation-state'},'Kjent mutasjonsvern er erstattet eller fjernet.');
  if(lock?.owner&&lock.owner!==state.mutationOwner)throw new DeferredSync('remote','En annen enhet har et uferdig mutasjonsløp.');
  if(lock?.owner===state.mutationOwner){held=true;revision=current!.rev;state.mutationFileId=current!.id;await hooks.save();return;}
  // Infrastructure bootstrap only. No user folder can be created before the
  // fence. Repeating this fixed app-owned root cannot move or rename anything.
  if(!current){if(files.createFoldersBatch)await files.createFoldersBatch([{key:'/.app',path:'/.app'}]);else await files.folder('/.app');await hooks.check();}
  let result;
  try{result=await files.write(mutationPath,JSON.stringify({version:1,owner:state.mutationOwner,libraryRev:lock?.libraryRev??null}),current?.rev??null);}
  catch(error){if(error instanceof SyncFailure&&error.info.code===failureCodes.changed)throw new RetrySync();throw error;}
  held=true;revision=result.rev;state.mutationFileId=result.id;await hooks.save();
 }
 async function release(){
  if(!held)return;
  // The exact revision is the ownership proof, including when an older release
  // response was lost. A fresh acquire always precedes any subsequent write.
  await hooks.check();
  try{await files.write(mutationPath,JSON.stringify({version:1,owner:null,libraryRev:state.library?.rev??null}),revision!);}
  catch(error){if(error instanceof SyncFailure&&error.info.code===failureCodes.changed)throw new RetrySync();throw error;}
  held=false;state.mutationPending=false;await hooks.save();
 }
 return{acquire,release};
}
