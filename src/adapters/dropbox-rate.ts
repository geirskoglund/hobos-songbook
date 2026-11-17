import {DeferredSync,failureCodes,SyncFailure,type RateInfo,type RateLimitReason} from '../sync/failure.ts';
import type {ApiEvent,ApiContext} from '../sync/diagnostics.ts';

export class DropboxError extends SyncFailure {
  status:number;summary:string;
  constructor(status:number,summary:string,stage='dropbox.request',rate:RateInfo={}){
    super({code:status===401?failureCodes.authentication:status===403?failureCodes.permission:status===409?failureCodes.changed:status===429?failureCodes.throttled:failureCodes.request,stage,status,...(status===429?rate:{}),...(status===401?{action:'reconnect'}:{})},'Dropbox avviste forespørselen.');
    this.name='DropboxError';this.status=status;this.summary=summary;
  }
}
const mutations=new Set(['files/upload','files/upload_session/finish_batch_v2','files/create_folder_v2','files/create_folder_batch','files/move_v2','files/move_batch_v2','files/delete_v2','files/delete_batch']);
const transportBatches=new Set(['files/move_batch_v2','files/move_batch/check_v2','files/delete_batch','files/delete_batch/check','files/create_folder_batch','files/create_folder_batch/check']);
const reasons=new Set<RateLimitReason>(['too_many_requests','too_many_write_operations','unknown']);
const maxWait=30000,maxRetries=2;
interface Cooldown {version:1;accountId:string;until:number;reason:RateLimitReason;status?:200|429;stage?:string}

/** Request-scoped recovery, never a scheduled/background synchronization. */
export function dropboxRate(namespace:string,account:()=>string|null,before:()=>void|Promise<void>,observe:(event:ApiEvent)=>void){
  const key=`${namespace}:dropbox-rate-v1`,wakeSlots=new Set<()=>void>();
  let lease=0,writeLimit=4,writes=0,waited=0,retries=true,halted:SyncFailure|null=null,memory:Cooldown|null=null;
  let waiting:{promise:Promise<void>;wake():void}|undefined;
  function emit(event:ApiEvent){try{observe(event);}catch{/* Diagnostics do not change requests. */}}
  function cooldown(id:string|null){
    try{const value=JSON.parse(localStorage.getItem(key)??'null');if(value?.version===1&&value.accountId===id&&Number.isFinite(value.until)&&value.until>=0&&reasons.has(value.reason)&&(!memory||memory.accountId!==id||value.until>memory.until))memory=value;}catch{/* The in-memory cooldown still applies. */}
    return memory?.accountId===id?memory:null;
  }
  function remember(id:string|null,rate:RateInfo,status:200|429=429,stage='dropbox.move-batch'){
    if(!id)return;
    const previous=cooldown(id),until=Math.max(previous?.until??0,Date.now()+(rate.retryAfterMs??1000));
    memory={version:1,accountId:id,until,reason:rate.limitReason??'unknown',status,stage};
    try{localStorage.setItem(key,JSON.stringify(memory));}catch{/* Cooldown cannot depend on writable browser storage. */}
  }
  const limitError=(rate:RateInfo,status:200|429=429,stage='dropbox.move-batch')=>status===200?new SyncFailure({code:failureCodes.throttled,stage,status,...rate},'Dropbox begrenser flytteoperasjonene.'):new DropboxError(429,'rate-limit','dropbox.request',rate);
  function stop(rate:RateInfo,status:200|429=429,stage='dropbox.move-batch'){halted=limitError(rate,status,stage);wake();return halted;}
  function checkTicket(ticket:number){if(ticket!==lease)throw new DeferredSync('changed','Forespørselen er avbrutt.');if(halted)throw halted;}
  async function guard(ticket:number){checkTicket(ticket);await before();checkTicket(ticket);}
  function wake(){waiting?.wake();for(const resume of [...wakeSlots])resume();}
  function begin(retry=true){lease++;wake();waited=0;writeLimit=4;halted=null;retries=retry;}
  function cancel(){lease++;wake();}
  async function wait(ticket:number,id:string|null){
    for(;;){
      await guard(ticket);const value=cooldown(id),delay=(value?.until??0)-Date.now();if(delay<=0)return;
      if(!retries||waited+delay>maxWait)throw stop({limitReason:value!.reason,retryAfterMs:Math.ceil(delay)},value!.status===200?200:429,value!.stage);
      if(!waiting){
        const start=Date.now();let done!:()=>void;const promise=new Promise<void>(resolve=>{done=resolve;});
        const timer=setTimeout(done,delay),current={promise,wake(){clearTimeout(timer);done();}};waiting=current;
        void promise.then(()=>{clearTimeout(timer);if(ticket===lease)waited+=Math.max(0,Date.now()-start);if(waiting===current)waiting=undefined;});
      }
      await waiting.promise;
    }
  }
  function releaseWrite(){writes--;for(const resume of [...wakeSlots])resume();}
  async function slot(ticket:number){
    for(;;){await guard(ticket);if(writes<writeLimit){writes++;return releaseWrite;}await new Promise<void>(resolve=>{const resume=()=>{wakeSlots.delete(resume);resolve();};wakeSlots.add(resume);});}
  }
  async function rateInfo(response:Response,attempt:number):Promise<RateInfo>{
    const body=await response.clone().json().catch(()=>null),value=body?.error??body;
    const candidate=value?.reason?.['.tag']??value?.['.tag'];
    const reason:RateLimitReason=reasons.has(candidate)?candidate:'unknown';
    const seconds=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:undefined;
    const header=response.headers.get('Retry-After'),numeric=header!==null&&header.trim()!==''?Number(header):NaN;
    const headerMs=Number.isFinite(numeric)&&numeric>=0?numeric*1000:header?Math.max(0,Date.parse(header)-Date.now()):NaN;
    const bodySeconds=seconds(value?.retry_after),bodyMs=bodySeconds===undefined?NaN:bodySeconds*1000;
    const hints=[headerMs,bodyMs].filter(Number.isFinite),minimum=hints.length?Math.max(...hints):1000;
    return{limitReason:reason,retryAfterMs:Math.ceil(Math.max(minimum,1000*2**attempt))};
  }
  async function send(operation:string,perform:(attempt:number,check:()=>Promise<void>)=>Promise<Response>,context:()=>ApiContext=()=>({})){
    const recover=operation.startsWith('files/'),ticket=lease,id=recover?account():null;let attempt=0;
    const batchStage=operation.includes('create_folder_batch')?'dropbox.folders-batch':operation.includes('delete_batch')?'dropbox.delete-batch':'dropbox.move-batch';
    for(;;){
      // The caller has just checked account/session/generation. Keep healthy
      // requests on that fast path; recheck after every actual queue/wait.
      if(recover){checkTicket(ticket);if((cooldown(id)?.until??0)>Date.now())await wait(ticket,id);}
      let release=()=>{};
      if(recover&&mutations.has(operation)){if(writes>=writeLimit)release=await slot(ticket);else{writes++;release=releaseWrite;}}
      let response:Response,rate:RateInfo|undefined;
      try{
        if(recover){checkTicket(ticket);if((cooldown(id)?.until??0)>Date.now())continue;}
        const start=performance.now();
        try{response=await perform(attempt,()=>wait(ticket,id));}catch(cause){if(cause instanceof DeferredSync||cause instanceof SyncFailure)throw cause;emit({operation,status:0,durationMs:Math.round(performance.now()-start),...context(),transport:cause instanceof Error&&cause.name==='TimeoutError'?'timeout':cause instanceof Error&&cause.name==='AbortError'?'abort':'network'});throw new SyncFailure({code:failureCodes.network,stage:'dropbox.request'},'Dropbox-forespørselen kunne ikke fullføres.',cause);}
        const durationMs=Math.round(performance.now()-start);
        if(response.status===429)rate=await rateInfo(response,attempt);
        const deferredAttempt=(response as Response&{entryRateAttempt?:number}).entryRateAttempt;
        const deferred=Number.isInteger(deferredAttempt)&&deferredAttempt!>=0&&deferredAttempt!<=maxRetries;
        if(deferred)rate={...await rateInfo(response,deferredAttempt!),limitReason:'too_many_write_operations'};
        const entryLimit=(response as Response&{entryLimit?:boolean}).entryLimit===true||deferred;
        emit({operation,status:entryLimit?200:response.status,durationMs,...context(),...(entryLimit?{entryLimit:true}:{}),...(rate?{...rate,retryAttempt:deferred?deferredAttempt:attempt}:{})});
        if(recover){if(rate){if(!deferred||ticket===lease)remember(id,rate,deferred?200:429,batchStage);if(!deferred||!transportBatches.has(operation))await guard(ticket);if(ticket===lease){writeLimit=1;if(deferred){if(!retries||deferredAttempt!>=maxRetries)stop(rate,200,batchStage);}else if(!retries||attempt>=maxRetries)throw stop(rate);}}else if(!transportBatches.has(operation))checkTicket(ticket);}
      }finally{release();}
      if(!recover||response.status!==429)return response;
      attempt++;
    }
  }
  return{send,begin,cancel};
}
