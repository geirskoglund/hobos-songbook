import type {AppEnvironment} from '../environment.ts';
import type {RemoteFiles} from './model.ts';
import {failureCodes, failureInfo, userActions, type FailureCode, type FailureInfo,type RateInfo} from './failure.ts';

const operations = ['oauth2/token','users/get_current_account','auth/token/revoke','files/get_metadata','files/create_folder_v2','files/create_folder_batch','files/create_folder_batch/check','files/list_folder','files/list_folder/continue','files/download','files/upload','files/upload_session/start','files/upload_session/start_batch','files/upload_session/append_batch','files/upload_session/finish_batch_v2','files/move_v2','files/move_batch_v2','files/move_batch/check_v2','files/delete_v2','files/delete_batch','files/delete_batch/check'] as const;
export interface ApiContext {batchSize?:number;resource?:'personal'|'staging'|'folder'|'content'|'control'|'mixed'|'other';requestId?:string}
export interface ApiEvent extends RateInfo,ApiContext {operation: string; status: number; durationMs: number;retryAttempt?:number;entryLimit?:boolean;transport?:'network'|'abort'|'timeout'}
const entryLimited=(event:ApiEvent)=>event.status===200&&event.entryLimit===true&&['files/upload_session/finish_batch_v2','files/move_batch_v2','files/move_batch/check_v2','files/delete_batch','files/delete_batch/check','files/create_folder_batch','files/create_folder_batch/check'].includes(event.operation);
const rateStatus=(failure:FailureInfo)=>failure.status===200&&failure.code===failureCodes.throttled&&['dropbox.move-batch','dropbox.delete-batch','dropbox.folders-batch'].includes(failure.stage)?429:failure.status;
function safeContext(event:ApiEvent){return{...(typeof event.requestId==='string'&&/^[0-9a-f-]{16,128}$/i.test(event.requestId)?{requestId:event.requestId}:{}),...(Number.isSafeInteger(event.batchSize)&&event.batchSize!>0&&event.batchSize!<=10000?{batchSize:event.batchSize}:{}),...(['personal','staging','folder','content','control','mixed','other'].includes(event.resource??'')?{resource:event.resource}:{}),...(event.status===0&&['network','abort','timeout'].includes(event.transport??'')?{transport:event.transport}:{})};}
type EnvironmentInfo = Record<string, string | number | boolean | null>;
export interface SyncLog {
  version: 1; id: string; timestamp: string;
  app: {channel: AppEnvironment['channel']; sha: string; pr: number | null};
  failure: RateInfo & {code: FailureCode; stage: string; status?: number; action?: FailureInfo['action']; type: string; causeType?: string; stack: {line: number; column: number}[]};
  manual: boolean; environment: EnvironmentInfo; operations: ApiEvent[];
  operationTotals?:Record<string,number>;
}
interface LogStore {version: 1; active: string | null; entries: SyncLog[]; pending: string[]; owners: Record<string,string>}
const limit = 20;
const codes = new Set<string>(Object.values(failureCodes));
const errorTypes = new Set(['Error','SyncFailure','DropboxError','TypeError','SyntaxError','AbortError','QuotaExceededError','InvalidStateError','SecurityError','UnknownError','DataError','NotFoundError','ConstraintError','TransactionInactiveError','DataCloneError','TimeoutError']);
const stages = new Set(['sync','sync.run','sync.song','sync.manifest','sync.personal','sync.original','sync.book-name','sync.book-state','sync.file','sync.storage','sync.upload-index','sync.namespace','app.start','app.connect','app.disconnect','app.storage','app.capability','dropbox.request','dropbox.token','dropbox.account','dropbox.oauth','dropbox.file-metadata','dropbox.create-folder','dropbox.ensure-folder','dropbox.locate-folder','dropbox.move','dropbox.move-batch','dropbox.delete-batch','dropbox.folders-batch','dropbox.list','dropbox.download','dropbox.upload','dropbox.batch','dropbox.revoke']);
const version = (value: unknown) => typeof value === 'string' && /^\d[\d.]{0,39}$/.test(value);
const numericKeys = new Set(['viewportWidth','viewportHeight','screenWidth','screenHeight','pixelRatio','touchPoints','logicalProcessors','storageUsageBytes','storageQuotaBytes','rttMs','downlinkMbps']);
const booleanKeys = new Set(['online','secureContext','standalone','webLocks','indexedDB','serviceWorker','clipboardWrite','storagePersisted','saveData','cookiesEnabled']);
function safeRate(value:RateInfo,status?:number):RateInfo{return status===429?{
  ...(['too_many_requests','too_many_write_operations','unknown'].includes(value.limitReason??'')?{limitReason:value.limitReason}:{}),
  ...(typeof value.retryAfterMs==='number'&&Number.isFinite(value.retryAfterMs)&&value.retryAfterMs>=0?{retryAfterMs:value.retryAfterMs}:{}),
}:{};}
function safeEnvironment(source: EnvironmentInfo): EnvironmentInfo {
  const out: EnvironmentInfo = {};
  for (const [key,value] of Object.entries(source)) {
    if (numericKeys.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
    else if (booleanKeys.has(key) && typeof value === 'boolean') out[key] = value;
    else if (['osVersion','browserVersion','engineVersion','platformVersion'].includes(key) && version(value)) out[key] = value;
    else if (key === 'os' && ['iOS','iPadOS','Android','Windows','macOS','Linux','Other'].includes(String(value))) out[key] = value;
    else if (key === 'browser' && ['Edge','Opera','Chrome','Firefox','Safari','Other'].includes(String(value))) out[key] = value;
    else if (key === 'engine' && ['WebKit','Gecko','Blink','Other'].includes(String(value))) out[key] = value;
    else if (key === 'networkType' && ['slow-2g','2g','3g','4g'].includes(String(value))) out[key] = value;
    else if (key === 'architecture' && ['arm','x86','32','64'].includes(String(value))) out[key] = value;
    else if (key === 'locale' && typeof value === 'string') {try {if (new Intl.Locale(value).toString() === value) out[key] = value;} catch { /* No arbitrary browser strings. */ }}
    else if (key === 'timeZone' && typeof value === 'string' && (value === 'UTC' || typeof Intl.supportedValuesOf==='function'&&Intl.supportedValuesOf('timeZone').includes(value))) out[key] = value;
  }
  return out;
}
function environmentInfo(): EnvironmentInfo {
  if (typeof navigator === 'undefined') return {};
  const ua = navigator.userAgent ?? '', info: EnvironmentInfo = {os:'Other',browser:'Other',engine:'Other'};
  const os = /(?:iPhone|iPad|iPod).*OS ([\d_]+)/.exec(ua), android = /Android ([\d.]+)/.exec(ua), mac = /Mac OS X ([\d_]+)/.exec(ua), windows = /Windows NT ([\d.]+)/.exec(ua);
  if(os){info.os=/iPad/.test(ua)?'iPadOS':'iOS';info.osVersion=os[1].replaceAll('_','.');}
  else if(android){info.os='Android';info.osVersion=android[1];}
  else if(mac){info.os=navigator.maxTouchPoints>1?'iPadOS':'macOS';if(info.os==='macOS')info.osVersion=mac[1].replaceAll('_','.');}
  else if(windows){info.os='Windows';info.osVersion=windows[1];}else if(/Linux/.test(ua))info.os='Linux';
  for(const [name,pattern] of [['Edge',/(?:Edg|EdgiOS|EdgA)\/([\d.]+)/],['Opera',/OPR\/([\d.]+)/],['Firefox',/(?:Firefox|FxiOS)\/([\d.]+)/],['Chrome',/(?:Chrome|CriOS)\/([\d.]+)/],['Safari',/Version\/([\d.]+).*Safari/]] as const){const match=pattern.exec(ua);if(match){info.browser=name;info.browserVersion=match[1];break;}}
  const webkit=/AppleWebKit\/([\d.]+)/.exec(ua),gecko=/rv:([\d.]+).*Gecko\//.exec(ua);
  if(webkit){info.engine=info.os==='iOS'||info.os==='iPadOS'||info.browser==='Safari'?'WebKit':'Blink';info.engineVersion=info.engine==='Blink'?/Chrome\/([\d.]+)/.exec(ua)?.[1]??'':webkit[1];}else if(gecko){info.engine='Gecko';info.engineVersion=gecko[1];}
  Object.assign(info,{online:navigator.onLine,secureContext:globalThis.isSecureContext,standalone:typeof matchMedia==='function'&&matchMedia('(display-mode: standalone)').matches||(navigator as Navigator & {standalone?:boolean}).standalone===true,webLocks:Boolean(navigator.locks),indexedDB:typeof indexedDB!=='undefined',serviceWorker:'serviceWorker' in navigator,clipboardWrite:Boolean(navigator.clipboard?.writeText),touchPoints:navigator.maxTouchPoints,logicalProcessors:navigator.hardwareConcurrency,cookiesEnabled:navigator.cookieEnabled,locale:navigator.language,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
  if(typeof window!=='undefined')Object.assign(info,{viewportWidth:innerWidth,viewportHeight:innerHeight,pixelRatio:devicePixelRatio,screenWidth:screen.width,screenHeight:screen.height});
  const connection=(navigator as Navigator & {connection?:{effectiveType?:string;rtt?:number;downlink?:number;saveData?:boolean}}).connection;
  if(connection)Object.assign(info,{networkType:connection.effectiveType,rttMs:connection.rtt,downlinkMbps:connection.downlink,saveData:connection.saveData});
  return safeEnvironment(info);
}
function safeLog(value: SyncLog): SyncLog {
  const status=value.failure.status;
  return {
    version:1,id:/^[0-9a-f-]{36}$/.test(value.id)?value.id:'',timestamp:new Date(value.timestamp).toISOString(),
    app:{channel:value.app.channel==='production'?'production':'test',sha:/^[0-9a-f]{40}$/.test(value.app.sha)?value.app.sha:'',pr:Number.isSafeInteger(value.app.pr)?value.app.pr:null},
    failure:{code:codes.has(value.failure.code)?value.failure.code:failureCodes.unexpected,stage:stages.has(value.failure.stage)?value.failure.stage:'sync',
      ...(typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599?{status}:{}),...safeRate(value.failure,rateStatus(value.failure)),
      ...(value.failure.action&&Object.hasOwn(userActions,value.failure.action)?{action:value.failure.action}:{}),
      type:errorTypes.has(value.failure.type)?value.failure.type:'Error',
      ...(value.failure.causeType&&errorTypes.has(value.failure.causeType)?{causeType:value.failure.causeType}:{}),
      stack:value.failure.stack.filter(p=>Number.isSafeInteger(p.line)&&p.line>0&&Number.isSafeInteger(p.column)&&p.column>0).slice(0,8).map(p=>({line:p.line,column:p.column}))},
    manual:Boolean(value.manual),environment:safeEnvironment(value.environment),
    ...(value.operationTotals?{operationTotals:Object.fromEntries(Object.entries(value.operationTotals).filter(([operation,count])=>operations.includes(operation as typeof operations[number])&&Number.isSafeInteger(count)&&count>0&&count<=1e9))}:{}),
    operations:value.operations.filter(o=>operations.includes(o.operation as typeof operations[number])&&Number.isInteger(o.status)&&o.status>=0&&o.status<=599&&Number.isFinite(o.durationMs)&&o.durationMs>=0).slice(-30).map(o=>({operation:o.operation,status:o.status,durationMs:o.durationMs,...safeContext(o),...(entryLimited(o)?{entryLimit:true}:{}),...safeRate(o,entryLimited(o)?429:o.status),...((o.status===429||entryLimited(o))&&Number.isInteger(o.retryAttempt)&&o.retryAttempt!>=0&&o.retryAttempt!<=2?{retryAttempt:o.retryAttempt}:{})})),
  };
}
function stackPositions(error:unknown) {
  if(!(error instanceof Error))return [];
  // The first stack line is the raw error message and may contain user data.
  return (error.stack??'').split('\n').slice(1).flatMap(line=>{
    const match=/:(\d+):(\d+)\)?$/.exec(line);return match?[{line:Number(match[1]),column:Number(match[2])}]:[];
  });
}
export function syncDiagnostics(env: AppEnvironment, notify: () => void = () => {}) {
  const key=`${env.namespace}:sync-diagnostics-v1`,empty=():LogStore=>({version:1,active:null,entries:[],pending:[],owners:{}});let memory=empty();
  const read=():LogStore=>{try{const raw=localStorage.getItem(key);if(raw){const value=JSON.parse(raw);if(value.version===1&&Array.isArray(value.entries)&&Array.isArray(value.pending)){const entries:SyncLog[]=value.entries.map(safeLog).slice(-limit);memory={version:1,active:value.active,entries,pending:value.pending.filter((id:unknown)=>typeof id==='string'),owners:Object.fromEntries(entries.filter(e=>typeof value.owners?.[e.id]==='string').map(e=>[e.id,value.owners[e.id]]))};}}}catch{/* Logging must also work in memory when storage fails. */}return memory;};
  const save=(store:LogStore)=>{memory=store;try{localStorage.setItem(key,JSON.stringify(store));}catch{/* Never make sync depend on diagnostics storage. */}};
  function record(error:unknown,stage:string,manual:boolean,events:ApiEvent[],accountId?:string,totals?:Record<string,number>) {
    let environment:EnvironmentInfo={};try{environment=environmentInfo();}catch{/* Missing browser diagnostics are not a sync error. */}
    const operationTotals=totals??events.reduce<Record<string,number>>((result,event)=>{result[event.operation]=(result[event.operation]??0)+1;return result;},{});
    const info=failureInfo(error,stage),entry:SyncLog=safeLog({version:1,id:crypto.randomUUID(),timestamp:new Date().toISOString(),app:{channel:env.channel,sha:env.sha,pr:env.pr},failure:{code:info.code,stage:info.stage,status:info.status,action:info.action,...safeRate(info,rateStatus(info)),type:error instanceof Error?error.name:'Error',causeType:error instanceof Error&&error.cause instanceof Error?error.cause.name:undefined,stack:stackPositions(error)},manual,environment,operations:events,operationTotals});
    const store=read();store.entries=[...store.entries,entry].slice(-limit);store.pending=[...store.pending,entry.id].filter(id=>store.entries.some(e=>e.id===id));store.active=entry.id;if(accountId)store.owners[entry.id]=accountId;store.owners=Object.fromEntries(Object.entries(store.owners).filter(([id])=>store.entries.some(e=>e.id===id)));save(store);
    void enrich(entry.id);return {entry,info};
  }
  async function enrich(id:string) {
    try{
      const estimate=await navigator.storage?.estimate(),persisted=await navigator.storage?.persisted?.();
      let hints:{platformVersion?:string;architecture?:string;fullVersionList?:{brand:string;version:string}[]}|undefined;
      try{hints=await (navigator as Navigator & {userAgentData?:{getHighEntropyValues?(keys:string[]):Promise<typeof hints>}}).userAgentData?.getHighEntropyValues?.(['platformVersion','architecture','fullVersionList']);}catch{/* Browser policy may withhold client hints. */}
      const store=read(),entry=store.entries.find(e=>e.id===id);if(!entry)return;
      const brand=entry.environment.browser==='Edge'?'Microsoft Edge':entry.environment.browser==='Chrome'?'Google Chrome':undefined,full=hints?.fullVersionList?.find(v=>v.brand===brand)?.version;
      entry.environment=safeEnvironment({...entry.environment,...(estimate?{storageUsageBytes:estimate.usage!,storageQuotaBytes:estimate.quota!}:{}),...(persisted===undefined?{}:{storagePersisted:persisted}),...(hints?.platformVersion?{platformVersion:hints.platformVersion}:{}),...(hints?.architecture?{architecture:hints.architecture}:{}),...(full?{browserVersion:full}:{})});save(store);notify();
    }catch{/* Optional environment data never changes the actual failure. */}
  }
  async function flush(files:RemoteFiles,accountId?:string) {
    const local=read(),pending=local.entries.filter(e=>local.pending.includes(e.id)&&(!local.owners[e.id]||local.owners[e.id]===accountId));if(!pending.length)return;
    try {
      await files.folder('/.app');const previous=await files.read('/.app/sync-errors.json');let old:SyncLog[]=[];
      if(previous){const value=JSON.parse(previous.text);if(value.version!==1||!Array.isArray(value.entries)||value.entries.length>limit)return;old=value.entries.map(safeLog);if(JSON.stringify(old)!==JSON.stringify(value.entries))return;}
      const combined=new Map([...old,...pending].map(e=>[e.id,e]));
      await files.write('/.app/sync-errors.json',JSON.stringify({version:1,entries:[...combined.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).slice(-limit)},null,2),previous?.rev??null);
      const latest=read();latest.pending=latest.pending.filter(id=>!pending.some(e=>e.id===id&&JSON.stringify(e)===JSON.stringify(latest.entries.find(v=>v.id===id))));save(latest);
    }catch{/* A failed log upload stays pending and cannot replace the sync error. */}
  }
  return {record,flush,entry:(id:string)=>read().entries.find(e=>e.id===id)??null,active:()=>{const s=read();return s.entries.find(e=>e.id===s.active)??null;},clear:(expectedId?:string)=>{const s=read();if(!expectedId||s.active===expectedId){s.active=null;save(s);}},text:(entry:SyncLog)=>JSON.stringify(safeLog(entry),null,2)};
}
