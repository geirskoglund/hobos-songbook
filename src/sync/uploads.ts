import {RetrySync,SyncFailure,failureCodes} from './failure.ts';
import {checkSize,textBytes,SkippedFile} from './limits.ts';
import {same,type FileValue,type RemoteFiles,type SyncState,type UploadIntent,type UploadJob,type UploadResult} from './model.ts';

const batchSize=100,sessionLifetime=7*24*60*60*1000;
/** Durable intents precede namespace commits. A lost result is reconciled by exact
 * bytes before any replay, including after a newer local generation. */
export function uploadQueue(files:RemoteFiles,state:SyncState,hooks:{check():Promise<void>;save():Promise<void>;record(job:UploadJob,value:FileValue):void}){
  const journal=state.uploads??={};
  const used=new Set<string>();
  async function recover(){
    for(const job of Object.values(journal)){
      if(job.status!=='committing')continue;
      await hooks.check();
      let current:FileValue|null;
      try{current=await files.read(job.path);}catch(error){if(!(error instanceof SkippedFile))throw error;job.status='planned';delete job.session;continue;}
      await hooks.check();
      if(current&&current.text===job.text){job.value=current;job.status='done';hooks.record(job,current);}
      else job.status='planned';
    }
    await hooks.save();
  }
  async function write(intents:UploadIntent[]):Promise<Map<string,UploadResult>>{
    const results=new Map<string,UploadResult>();
    for(const intent of intents)checkSize(textBytes(intent.text));
    for(const intent of intents)used.add(intent.key);
    for(let offset=0;offset<intents.length;offset+=batchSize){
      const group=intents.slice(offset,offset+batchSize),jobs:UploadJob[]=[];
      for(const intent of group){
        const old=journal[intent.key];
        const job=old&&same({path:old.path,text:old.text,rev:old.rev},{path:intent.path,text:intent.text,rev:intent.rev})?old:journal[intent.key]={...intent,status:'planned'};
        if(job.status==='done'&&job.value){results.set(job.key,{value:job.value});continue;}
        if(job.session&&Date.now()-job.session.created>=sessionLifetime)delete job.session;
        jobs.push(job);
      }
      await hooks.save();
      if(!jobs.length)continue;
      const bulk=(jobs.length>1||jobs.some(job=>job.session))&&files.beginUpload&&files.commitBatch;
      if(bulk){
        let next=0,interrupted:unknown;
        await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
          while(next<jobs.length&&!interrupted){const job=jobs[next++];try{
            await hooks.check();
            if(!job.session){job.session=await files.beginUpload!(job.text);await hooks.check();await hooks.save();}
            await hooks.check();
          }catch(error){interrupted=error;}}
        }));
        if(interrupted)throw interrupted;
      }
      // Persist exact bytes, revisions and session IDs before any commit request.
      for(const job of jobs)job.status='committing';
      await hooks.save();await hooks.check();
      let values:UploadResult[];
      if(bulk)values=await files.commitBatch!(jobs);
      else {values=[];for(const job of jobs){await hooks.check();try{values.push({value:await files.write(job.path,job.text,job.rev)});}catch(error){if(!(error instanceof SyncFailure)||[failureCodes.network,failureCodes.authentication,failureCodes.permission,failureCodes.throttled].some(code=>code===error.info.code))throw error;values.push({failure:error.info});}}}
      await hooks.check();
      let retry=false;
      for(let i=0;i<jobs.length;i++){
        const job=jobs[i],result=values[i];
        if(!result)throw new Error('Incomplete upload result');
        results.set(job.key,result);
        if('value'in result){job.value=result.value;job.status='done';hooks.record(job,result.value);}
        else {job.status='planned';if(result.resetSession)delete job.session;retry ||= result.resetSession===true||result.failure.code==='SYNC-006';}
      }
      await hooks.save();if(retry)throw new RetrySync();
    }
    return results;
  }
  function clearDone(){for(const [key,job]of Object.entries(journal))if(job.status==='done'||!used.has(key))delete journal[key];}
  return{recover,write,clearDone};
}
