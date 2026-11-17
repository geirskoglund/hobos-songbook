import type {AppEnvironment} from '../environment.ts';
import type {FileValue, RemoteFiles, RemoteEntry,UploadResult,MoveReply} from '../sync/model.ts';
import {checkSize,textBytes,maxFileBytes,SkippedFile} from '../sync/limits.ts';
import {DeferredSync,SubmittedBatchInterruption, failureCodes, SyncFailure,BatchJobFailed} from '../sync/failure.ts';
import type {ApiEvent,ApiContext} from '../sync/diagnostics.ts';
import {DropboxError,dropboxRate} from './dropbox-rate.ts';
export {DropboxError} from './dropbox-rate.ts';
export const requiredScopes = ['account_info.read', 'files.metadata.read', 'files.content.read', 'files.content.write'];
export function dropboxConfig(channel: AppEnvironment['channel']) {
  return {key: channel === 'production' ? '9hivdq3nxrgtquz' : 'le5cddh388klcjz', redirect: `https://geirskoglund.github.io/hobos-songbook/${channel === 'production' ? 'app' : 'test'}/`};
}
interface Credentials {version: 1; accountId: string; name: string; email: string; accessToken: string; refreshToken: string; expires: number}
interface Pending {state: string; verifier: string; redirect: string; created: number}
const apiArg = (value: unknown) => JSON.stringify(value).replace(/[^\u0000-\u007f]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export async function pkceChallenge(verifier: string) {
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function dropboxAdapter(env: AppEnvironment, request: typeof fetch = fetch, beforeRequest: () => void | Promise<void> = () => {}, observe: (event: ApiEvent) => void = () => {}) {
  const config = dropboxConfig(env.channel), authKey = `${env.namespace}:dropbox-auth-v1`, pendingKey = `${env.namespace}:dropbox-pkce-v1`;
  let invalidated = 0;
  const rate=dropboxRate(env.namespace,()=>credentials()?.accountId??null,beforeRequest,observe);
  function deadline(){
    if(typeof AbortSignal.timeout==='function')return AbortSignal.timeout(30000);
    const controller=new AbortController();setTimeout(()=>controller.abort(),30000);return controller.signal;
  }
  const resource=(path:string):ApiContext['resource']=>/^\/\.app\/songs\//i.test(path)?'personal':/^\/\.app\/uploads\//i.test(path)?'staging':path.startsWith('/.app/')?'control':/^\/Songbooks\/[^/]+\/Private\//i.test(path)?'content':'other';
  async function send(operation: string, source: RequestInit|(()=>RequestInit), transform?:(response:Response)=>Promise<Response>,context:ApiContext={}) {
    let details=context;
    return rate.send(operation,async(attempt,check)=>{
      const options=typeof source==='function'?source():source;
      if(typeof options.body==='string'&&options.headers&&Object.entries(options.headers).some(([key,value])=>key.toLowerCase()==='content-type'&&value==='application/json'))try{const body=JSON.parse(options.body),count=body.entries?.length??body.paths?.length;if(Number.isInteger(count))details={...details,batchSize:count};}catch{/* Never include request contents in diagnostics. */}
      const headers=attempt?{...(options.headers as Record<string,string>),Authorization:`Bearer ${await access()}`}:options.headers;
      if(attempt)await check();
      const response=await request(`https://${operation==='files/download'||operation==='files/upload'||operation==='files/upload_session/start'?'content':'api'}.dropboxapi.com/${operation==='oauth2/token'?'':'2/'}${operation}`,{...options,headers,signal:options.signal??deadline()});
      return transform?transform(response):response;
    },()=>details);
  }
  async function json(response: Response, stage = 'dropbox.request') {
    try {return await response.json();} catch (cause) {throw new SyncFailure({code:failureCodes.response,stage,status:response.status},'Dropbox returnerte ugyldig JSON.',cause);}
  }
  function credentials(): Credentials | null {
    const raw = localStorage.getItem(authKey); if (!raw) return null;
    let value: Credentials;try {value=JSON.parse(raw);}catch(cause){throw new SyncFailure({code:failureCodes.credentials,stage:'dropbox.oauth',action:'reconnect'},'Ugyldig lagret tilkobling.',cause);}
    if (value?.version !== 1 || !value.accountId || !value.refreshToken) throw new SyncFailure({code:failureCodes.credentials,stage:'dropbox.oauth',action:'reconnect'},'Ugyldig lagret tilkobling.');
    return value;
  }
  const account = () => {const value = credentials(); return value && {id: value.accountId, name: value.name, email: value.email};};
  async function token(body: URLSearchParams) {
    const ticket=invalidated,refresh=body.get('refresh_token');
    const response = await send('oauth2/token', {method: 'POST', body, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) {
      const problem=await response.json().catch(()=>null),expired=response.status===400&&problem?.error==='invalid_grant';
      if((expired||[401,403].includes(response.status))&&refresh&&ticket===invalidated&&credentials()?.refreshToken===refresh)localStorage.removeItem(authKey);
      throw new DropboxError(expired?401:response.status,'token','dropbox.token');
    }
    const value=await json(response,'dropbox.token');
    if(typeof value?.access_token!=='string'||!value.access_token||typeof value.expires_in!=='number'||!Number.isFinite(value.expires_in)||value.expires_in<0)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.token'},'Ugyldig tokenrespons.');
    return value;
  }
  async function access() {
    return navigator.locks.request(`${env.namespace}:dropbox-token`, async () => {
      let value = credentials(); if (!value) throw new DeferredSync('connection','Dropbox er frakoblet.');
      if (value.expires > Date.now() + 60000) return value.accessToken;
      const epoch = invalidated, previous = value.refreshToken;
      const next = await token(new URLSearchParams({grant_type: 'refresh_token', refresh_token: previous, client_id: config.key}));
      value = credentials();
      if (epoch !== invalidated || value?.refreshToken !== previous) throw new DeferredSync('connection','Dropbox-tilkoblingen er endret.');
      value.accessToken = next.access_token; value.expires = Date.now() + next.expires_in * 1000;
      localStorage.setItem(authKey, JSON.stringify(value)); return value.accessToken;
    });
  }
  async function connect() {
    if (location.origin + location.pathname !== config.redirect) throw new SyncFailure({code:failureCodes.configuration,stage:'dropbox.oauth',action:'open-app'},'Dropbox-tilkobling må startes fra den faste appadressen.');
    const pending: Pending = {state: random(), verifier: random(), redirect: config.redirect, created: Date.now()};
    const challenge = await pkceChallenge(pending.verifier);
    sessionStorage.setItem(pendingKey, JSON.stringify(pending));
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.search = new URLSearchParams({client_id: config.key, response_type: 'code', redirect_uri: config.redirect, state: pending.state, code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline', scope: requiredScopes.join(' ')}).toString();
    location.assign(url.href);
  }
  async function callback(): Promise<boolean> {
    const url = new URL(location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) return false;
    const code = url.searchParams.get('code'), state = url.searchParams.get('state'), error = url.searchParams.get('error');
    url.searchParams.delete('code'); url.searchParams.delete('state'); url.searchParams.delete('error'); url.searchParams.delete('error_description');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    const raw = sessionStorage.getItem(pendingKey); sessionStorage.removeItem(pendingKey);
    let pending: Pending | null = null;try {pending=raw?JSON.parse(raw):null;}catch{/* Invalid callback state is handled below. */}
    if (!pending || pending.state !== state || pending.redirect !== config.redirect || location.origin + location.pathname !== config.redirect || Date.now() - pending.created > 10 * 60 * 1000 || pending.created > Date.now()) throw new SyncFailure({code:failureCodes.oauthReturn,stage:'dropbox.oauth',action:'retry-login'},'Dropbox-returen er ugyldig eller utløpt.');
    if (error === 'access_denied') return false;
    if (error || !code) throw new SyncFailure({code:failureCodes.oauthResponse,stage:'dropbox.oauth'},'Dropbox returnerte ingen gyldig innloggingskode.');
    const epoch = invalidated;
    const value = await token(new URLSearchParams({grant_type: 'authorization_code', code, client_id: config.key, redirect_uri: config.redirect, code_verifier: pending.verifier}));
    if (!value.refresh_token || !requiredScopes.every(scope => String(value.scope ?? '').split(' ').includes(scope))) throw new SyncFailure({code:failureCodes.permission,stage:'dropbox.oauth'},'Dropbox mangler nødvendig fornybar tilgang eller nødvendige scopes.');
    const response = await send('users/get_current_account', {method: 'POST', headers: {Authorization: `Bearer ${value.access_token}`}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) throw new DropboxError(response.status, 'account');
    const user = await json(response,'dropbox.account');
    if(epoch!==invalidated)throw new DeferredSync('connection','Dropbox-tilkoblingen er endret.');
    if (typeof user?.account_id!=='string'||user.account_id !== value.account_id||typeof user.name?.display_name!=='string'||typeof user.email!=='string') throw new SyncFailure({code:failureCodes.oauthResponse,stage:'dropbox.account'},'Dropbox returnerte ugyldig kontorespons.');
    localStorage.setItem(authKey, JSON.stringify({version: 1, accountId: user.account_id, name: user.name.display_name, email: user.email, accessToken: value.access_token, refreshToken: value.refresh_token, expires: Date.now() + value.expires_in * 1000} satisfies Credentials));
    return true;
  }
  async function rpc(path: string, body: unknown,entryAttempt=0,context:ApiContext={}) {
    await beforeRequest(); const accessToken = await access(); await beforeRequest();
    const batch=['files/move_batch_v2','files/move_batch/check_v2','files/delete_batch','files/delete_batch/check','files/create_folder_batch','files/create_folder_batch/check'].includes(path);
    const locked=(failure:any):boolean=>failure?.['.tag']==='too_many_write_operations'||['path','path_write','to','relocation_error'].some(key=>failure?.[key]&&locked(failure[key]));
    const response = await send(path, {method: 'POST', headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'},batch?async reply=>{
      if(reply.status===200){const value=await reply.clone().json().catch(()=>null);if(Array.isArray(value?.entries)&&value.entries.some((entry:any)=>locked(entry?.failure)))Object.defineProperty(reply,'entryRateAttempt',{value:entryAttempt});}
      return reply;
    }:undefined,context);
    // Successful transport receipts must reach the account/operation journal
    // before a generation/session guard discards the local continuation.
    if(!batch||!response.ok)try{await beforeRequest();}catch(error){
      const rejected=response.status>=400&&response.status<500&&response.status!==408;
      if(batch&&!rejected&&error instanceof DeferredSync)throw new SubmittedBatchInterruption(error.reason,error.message);
      throw error;
    }
    if (!response.ok) {if ([401, 403].includes(response.status)) localStorage.removeItem(authKey); const problem = await response.json().catch(() => ({})); throw new DropboxError(response.status, problem.error_summary ?? 'request');}
    return json(response);
  }
  const missing = (error: unknown) => error instanceof DropboxError && error.status === 409 && /^path\/not_found/.test(error.summary);
  async function metadata(path: string) {try {return await rpc('files/get_metadata', {path});} catch (error) {if (missing(error)) return null; throw error;}}
  const displayPath=(data:any,fallback?:string):string|undefined=>data?.path_display??(typeof data?.path_lower==='string'?(typeof data.name==='string'?data.path_lower.slice(0,data.path_lower.lastIndexOf('/')+1)+data.name:data.path_lower):fallback);
  const fileValue = (data: any, text: string, requestedPath: string): FileValue => {
    // Metadata.path_display is optional. A literal/revision lookup or strict upload
    // already identifies its path; an ID lookup needs the returned location.
    const path=displayPath(data,/^(\/|rev:)/.test(requestedPath)?requestedPath:undefined);
    if (!data || typeof data.id !== 'string' || !data.id || typeof data.rev !== 'string' || !data.rev || typeof path !== 'string') throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.file-metadata'}, 'Dropbox returnerte ugyldig filmetadata.');
    return {text, id: data.id, rev: data.rev, path};
  };
  function moveReply(value:any,launch:boolean):MoveReply{
    if(launch&&value?.['.tag']==='async_job_id'&&typeof value.async_job_id==='string'&&value.async_job_id)return{asyncJobId:value.async_job_id};
    if(!launch&&value?.['.tag']==='in_progress')return{inProgress:true};
    if(value?.['.tag']!=='complete'||!Array.isArray(value.entries))throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move-batch'},'Ugyldig flytterespons.');
    return{entries:value.entries.map((entry:any)=>{
      if(entry?.['.tag']==='success'){
        const meta=entry.success,path=displayPath(meta);
        if(!['file','folder'].includes(meta?.['.tag'])||typeof meta.id!=='string'||!meta.id||meta['.tag']==='file'&&(typeof meta.rev!=='string'||!meta.rev)||path!==undefined&&typeof path!=='string')throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move-batch'},'Ugyldig flyttekvittering.');
        return{value:{id:meta.id,path:path??'',...(meta.rev?{rev:meta.rev}:{}),...(meta['.tag']==='folder'?{folder:true}:{})}};
      }
      if(entry?.['.tag']!=='failure'||typeof entry.failure?.['.tag']!=='string')throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move-batch'},'Ugyldig flyttefeil.');
      const problem=entry.failure,relocation=problem['.tag']==='relocation_error'?problem.relocation_error:null;
      const collision=relocation?.['.tag']==='to'&&relocation.to?.['.tag']==='conflict';
      const missing=relocation?.['.tag']==='from_lookup'&&relocation.from_lookup?.['.tag']==='not_found';
      const throttled=problem['.tag']==='too_many_write_operations'||relocation?.['.tag']==='to'&&relocation.to?.['.tag']==='too_many_write_operations';
      return{failure:{code:collision?failureCodes.changed:missing?failureCodes.missingFile:throttled?failureCodes.throttled:failureCodes.request,stage:'dropbox.move-batch',status:200,...(throttled?{limitReason:'too_many_write_operations' as const,retryAfterMs:0}:{})},...(collision?{collision:true}:{}),...(missing?{missing:true}:{})};
    })};
  }
  function namespaceReply(value:any,kind:'delete'|'folders'):MoveReply{
    const stage=`dropbox.${kind}-batch`;
    if(value?.['.tag']==='async_job_id'&&typeof value.async_job_id==='string'&&value.async_job_id)return{asyncJobId:value.async_job_id};
    if(value?.['.tag']==='in_progress')return{inProgress:true};
    if(value?.['.tag']==='failed')throw new BatchJobFailed({code:failureCodes.request,stage,status:200},'Dropbox-jobben feilet.');
    if(value?.['.tag']!=='complete'||!Array.isArray(value.entries))throw new SyncFailure({code:failureCodes.response,stage},'Ugyldig batchrespons.');
    return{entries:value.entries.map((entry:any)=>{
      if(entry?.['.tag']==='success'){
        const meta=entry.success?.metadata,path=displayPath(meta);
        if(typeof meta?.id!=='string'||!meta.id||path!==undefined&&typeof path!=='string'||kind==='folders'&&meta['.tag']!==undefined&&meta['.tag']!=='folder'||kind==='delete'&&!['file','folder'].includes(meta['.tag']))throw new SyncFailure({code:failureCodes.response,stage},'Ugyldig batchkvittering.');
        return{value:{id:meta.id,path:path??'',...(meta.rev?{rev:meta.rev}:{}),...(kind==='folders'||meta['.tag']==='folder'?{folder:true}:{})}};
      }
      const failure=entry?.failure,tag=failure?.['.tag'];if(entry?.['.tag']!=='failure'||typeof tag!=='string')throw new SyncFailure({code:failureCodes.response,stage},'Ugyldig batchfeil.');
      const missing=tag==='path_lookup'&&failure.path_lookup?.['.tag']==='not_found';
      const collision=tag==='path'&&failure.path?.['.tag']==='conflict'||tag==='path_lookup'&&failure.path_lookup?.['.tag']==='conflict';
      const throttled=tag==='too_many_write_operations'||tag==='path_write'&&failure.path_write?.['.tag']==='too_many_write_operations'||tag==='path'&&failure.path?.['.tag']==='too_many_write_operations';
      return{failure:{code:missing?failureCodes.missingFile:collision?failureCodes.changed:throttled?failureCodes.throttled:failureCodes.request,stage,status:200,...(throttled?{limitReason:'too_many_write_operations' as const,retryAfterMs:0}:{})},...(missing?{missing:true}:{}),...(collision?{collision:true}:{})};
    })};
  }
  async function namespaceCheck(route:string,id:string,kind:'delete'|'folders',attempt=0){
    try{return namespaceReply(await rpc(route,{async_job_id:id},attempt),kind);}catch(error){if(error instanceof DropboxError&&error.status===409&&/^invalid_async_job_id(?:\/|$)/.test(error.summary))return{jobExpired:true} as const;throw error;}
  }
  const files: RemoteFiles = {
    async metadata(path){const value=await metadata(path);if(!value)return null;const actual=displayPath(value,path.startsWith('/')?path:undefined);if(typeof value.id!=='string'||!value.id||!actual||!['file','folder'].includes(value['.tag'])||value['.tag']==='file'&&(typeof value.rev!=='string'||!value.rev))throw new SyncFailure({code:failureCodes.response,stage:'dropbox.file-metadata'},'Ugyldig metadata.');return{id:value.id,path:actual,folder:value['.tag']==='folder',...(value.rev?{rev:value.rev}:{})};},
    async deleteBatch(entries,attempt=0){
      if(!entries.length||entries.length>1000||entries.some(entry=>entry.folder&&entry.rev||!entry.folder&&!entry.rev))throw new SyncFailure({code:failureCodes.response,stage:'dropbox.delete-batch'},'Ugyldig sletteplan.');
      const result=namespaceReply(await rpc('files/delete_batch',{entries:entries.map(entry=>({path:entry.path,...(entry.rev?{parent_rev:entry.rev}:{})}))},attempt,{resource:new Set(entries.map(entry=>entry.category)).size===1?entries[0].category==='folder'?'folder':entries[0].category:'mixed'}),'delete');
      if('entries'in result&&result.entries.length!==entries.length)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.delete-batch'},'Ufullstendig slettekvittering.');return result;
    },
    checkDeleteBatch:(id,attempt)=>namespaceCheck('files/delete_batch/check',id,'delete',attempt),
    async createFoldersBatch(entries,attempt=0){
      if(!entries.length||entries.length>10000)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.folders-batch'},'Ugyldig mappeplan.');
      const result=namespaceReply(await rpc('files/create_folder_batch',{paths:entries.map(entry=>entry.path),autorename:false,force_async:false},attempt,{resource:'folder'}),'folders');
      if('entries'in result&&result.entries.length!==entries.length)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.folders-batch'},'Ufullstendig mappekvittering.');return result;
    },
    checkCreateFoldersBatch:(id,attempt)=>namespaceCheck('files/create_folder_batch/check',id,'folders',attempt),
    async moveBatch(entries,retryAttempt=0){
      if(!entries.length||entries.length>1000)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move-batch'},'Ugyldig flyttegruppe.');
      const result=moveReply(await rpc('files/move_batch_v2',{entries:entries.map(entry=>({from_path:entry.from,to_path:entry.toReference??entry.to})),autorename:false,allow_ownership_transfer:false},retryAttempt),true);
      if('entries'in result&&result.entries.length!==entries.length)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move-batch'},'Ufullstendig flytterespons.');
      return result;
    },
    async checkMoveBatch(id,retryAttempt=0){try{return moveReply(await rpc('files/move_batch/check_v2',{async_job_id:id},retryAttempt),false);}catch(error){if(error instanceof DropboxError&&error.status===409&&/^invalid_async_job_id(?:\/|$)/.test(error.summary))return{jobExpired:true};throw error;}},
    async changes(cursor){
      let reset=!cursor,page:any;
      try{page=await rpc(cursor?'files/list_folder/continue':'files/list_folder',cursor?{cursor}:{path:'',recursive:true,include_deleted:true});}
      catch(error){if(!cursor||!(error instanceof DropboxError)||error.status!==409||!/^reset(?:\/|$)/.test(error.summary))throw error;reset=true;page=await rpc('files/list_folder',{path:'',recursive:true,include_deleted:true});}
      const entries:RemoteEntry[]=[];
      for(;;){
        if(!Array.isArray(page?.entries)||typeof page.has_more!=='boolean'||typeof page.cursor!=='string'||!page.cursor)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.list'},'Ugyldig endringsoversikt.');
        for(const entry of page.entries){
          const path=displayPath(entry),tag=entry?.['.tag'];
          if(typeof path!=='string'||!path.startsWith('/')||!['file','folder','deleted'].includes(tag)||tag!=='deleted'&&(typeof entry.id!=='string'||!entry.id)||tag==='file'&&(typeof entry.rev!=='string'||!entry.rev))throw new SyncFailure({code:failureCodes.response,stage:'dropbox.list'},'Ugyldig oppføring i endringsoversikten.');
          if(tag==='file'&&entry.size!==undefined&&(!Number.isSafeInteger(entry.size)||entry.size<0))throw new SyncFailure({code:failureCodes.response,stage:'dropbox.list'},'Ugyldig filstørrelse.');
          entries.push(tag==='deleted'?{path,deleted:true}:{id:entry.id,path,folder:tag==='folder',...(tag==='file'?{rev:entry.rev,...(entry.size!==undefined?{size:entry.size}:{})}:{})});
        }
        if(!page.has_more)return{entries,cursor:page.cursor,reset};
        page=await rpc('files/list_folder/continue',{cursor:page.cursor});
      }
    },
    async read(path,knownPath) {
      await beforeRequest(); const accessToken = await access(); await beforeRequest();
      const response = await send('files/download', {method: 'POST', headers: {Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Arg': apiArg({path})}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'},undefined,{resource:resource(path)});
      await beforeRequest();
      if (!response.ok) {if ([401, 403].includes(response.status)) localStorage.removeItem(authKey); const value = await response.json().catch(() => ({})); const error = new DropboxError(response.status, value.error_summary ?? 'download'); if (missing(error)) return null; throw error;}
      let meta;try{meta=JSON.parse(response.headers.get('Dropbox-API-Result')??'null');}catch(cause){throw new SyncFailure({code:failureCodes.response,stage:'dropbox.download'},'Ugyldig metadataheader.',cause);}
      if(meta?.size>maxFileBytes){await response.body?.cancel();throw new SkippedFile();}
      const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
      if(reader)for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxFileBytes){await reader.cancel();throw new SkippedFile();}chunks.push(chunk.value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      return fileValue(meta, new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes),knownPath??path);
    },
    async write(path, text, rev) {
      checkSize(textBytes(text));
      await beforeRequest(); const accessToken = await access(); await beforeRequest();
      const args = {path, mode: rev ? {'.tag': 'update', update: rev} : {'.tag': 'add'}, autorename: false, strict_conflict: true, mute: true};
      const response = await send('files/upload', {method: 'POST', headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': apiArg(args)}, body: new TextEncoder().encode(text), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'},undefined,{resource:resource(path)});
      await beforeRequest();
      if (!response.ok) {if ([401, 403].includes(response.status)) localStorage.removeItem(authKey); const value = await response.json().catch(() => ({})); throw new DropboxError(response.status, value.error_summary ?? 'upload');}
      return fileValue(await json(response,'dropbox.upload'), text,path);
    },
    async beginUpload(text){
      checkSize(textBytes(text));await beforeRequest();const accessToken=await access();await beforeRequest();
      const response=await send('files/upload_session/start',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':apiArg({close:true})},body:new TextEncoder().encode(text),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
      await beforeRequest();if(!response.ok){if([401,403].includes(response.status))localStorage.removeItem(authKey);throw new DropboxError(response.status,'session','dropbox.upload');}
      const value=await json(response,'dropbox.upload');
      if(typeof value?.session_id!=='string'||!value.session_id)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.upload'},'Ugyldig opplastingsøkt.');
      return{id:value.session_id,created:Date.now()};
    },
    async commitBatch(jobs){
      if(!jobs.length||jobs.length>1000||jobs.some(job=>!job.session))throw new SyncFailure({code:failureCodes.response,stage:'dropbox.batch'},'Ugyldig opplastingsgruppe.');
      for(const job of jobs)checkSize(textBytes(job.text));
      await beforeRequest();const accessToken=await access();await beforeRequest();
      let pending=jobs.map((_,i)=>i);const results:UploadResult[]=new Array(jobs.length);
      const response=await send('files/upload_session/finish_batch_v2',()=>({method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({entries:pending.map(i=>{const job=jobs[i];return{cursor:{session_id:job.session!.id,offset:textBytes(job.text)},commit:{path:job.path,mode:job.rev?{'.tag':'update',update:job.rev}:{'.tag':'add'},autorename:false,strict_conflict:true,mute:true}};})}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'}),async reply=>{
        if(!reply.ok)return reply;
        const value=await json(reply,'dropbox.batch');
        if(!Array.isArray(value?.entries)||value.entries.length!==pending.length)throw new SyncFailure({code:failureCodes.response,stage:'dropbox.batch'},'Ufullstendig batchrespons.');
        const throttled:number[]=[];
        for(let n=0;n<pending.length;n++){
          const i=pending[n],entry=value.entries[n],job=jobs[i];
          if(entry?.['.tag']==='success')results[i]={value:fileValue(entry,job.text,job.path)};
          else if(entry?.['.tag']==='failure'&&entry.failure&&typeof entry.failure['.tag']==='string'){
            const tag=entry.failure['.tag'];
            if(tag==='too_many_write_operations'||tag==='path'&&entry.failure.path?.['.tag']==='too_many_write_operations'){throttled.push(i);continue;}
            const resetSession=tag==='lookup_failed'&&['not_found','closed'].includes(entry.failure.lookup_failed?.['.tag']);
            const conflict=tag==='path'&&entry.failure.path?.['.tag']==='conflict';
            results[i]={failure:{code:conflict?failureCodes.changed:failureCodes.request,stage:'dropbox.batch',status:409},...(resetSession?{resetSession:true}:{})};
          }else throw new SyncFailure({code:failureCodes.response,stage:'dropbox.batch'},'Ugyldig batchoppføring.');
        }
        pending=throttled;
        // Per-entry lock contention uses the same bounded shared backpressure as HTTP 429.
        if(pending.length){const limited=new Response(JSON.stringify({error:{reason:{'.tag':'too_many_write_operations'},retry_after:0}}),{status:429,headers:{'Retry-After':'0','Content-Type':'application/json'}});Object.defineProperty(limited,'entryLimit',{value:true});return limited;}
        return new Response(JSON.stringify({entries:results}),{headers:{'Content-Type':'application/json'}});
      });
      await beforeRequest();if(!response.ok){if([401,403].includes(response.status))localStorage.removeItem(authKey);throw new DropboxError(response.status,'batch','dropbox.batch');}
      return (await json(response,'dropbox.batch')).entries;
    },
    async folder(path, expectedId, knownMissing) {
      let current = knownMissing&&!expectedId?null:await metadata(expectedId ?? path);
      if(current)current={...current,path_display:displayPath(current,expectedId?undefined:path)};
      if(expectedId&&!current)throw new SyncFailure({code:failureCodes.missingFolder,stage:'dropbox.ensure-folder'},'Kjent sangbokmappe mangler.');
      if(expectedId&&current?.['.tag']==='folder'&&typeof current.path_display==='string'&&current.path_display.normalize('NFC').toLowerCase()!==path.normalize('NFC').toLowerCase())throw new DeferredSync('remote','Dropbox har endringer som venter på manuell synk.');
      if (!current) {
        try {
          // CreateFolderResult.metadata is FolderMetadata, not the tagged Metadata union.
          // Unlike get_metadata, the successful create response normally has no .tag.
          current = (await rpc('files/create_folder_v2', {path, autorename: false}))?.metadata;
          if(current&&current.path_display==null)current={...current,path_display:path};
          if (!current || current['.tag'] && current['.tag'] !== 'folder' || typeof current.id !== 'string' || !current.id || typeof current.path_display !== 'string' || current.path_display.normalize('NFC').toLowerCase() !== path.normalize('NFC').toLowerCase()) throw new SyncFailure({code: failureCodes.folderResponse, stage: 'dropbox.create-folder'}, 'Dropbox returnerte ugyldig bekreftelse på mappeopprettelse.');
          return {id: current.id, path: current.path_display};
        }
        catch (error) {
          if (!(error instanceof DropboxError && error.status === 409 && /^path\/conflict\//.test(error.summary))) throw error;
          current = await metadata(path); if (!current) throw error;
        }
      }
      if (current?.['.tag'] !== 'folder') throw new SyncFailure({code: failureCodes.folderOccupied, stage: 'dropbox.ensure-folder',action:'folder-layout'}, 'Dropbox-stien er opptatt av en fil.');
      if(typeof current.id!=='string'||!current.id||typeof current.path_display!=='string')throw new SyncFailure({code:failureCodes.response,stage:'dropbox.ensure-folder'},'Ugyldig mappemetadata.');
      return {id: current.id, path: current.path_display};
    },
    async locateFolder(id) {
      let value = await metadata(id);
      if (!value) return null;
      value={...value,path_display:displayPath(value,id.startsWith('/')?id:undefined)};
      if (value['.tag'] !== 'folder'||typeof value.id!=='string'||typeof value.path_display!=='string') throw new SyncFailure({code:failureCodes.response,stage:'dropbox.locate-folder'},'Ugyldig kjent mappemetadata.');
      return {id: value.id, path: value.path_display};
    },
    async move(from, to, known) {
      let current = known?{id:known.id,path_display:known.path}:await metadata(from);
      if (!current) throw new SyncFailure({code:failureCodes.missingFile,stage:'dropbox.move'},'Oppføringen som skal flyttes mangler.');
      current={...current,path_display:displayPath(current,from.startsWith('/')?from:undefined)};
      if (current.path_display === to) return {id: current.id, path: current.path_display};
      const result = await rpc('files/move_v2', {from_path: from, to_path: to, autorename: false});
      if(typeof result?.metadata?.id!=='string'||result.metadata.path_display!=null&&typeof result.metadata.path_display!=='string')throw new SyncFailure({code:failureCodes.response,stage:'dropbox.move'},'Ugyldig flytterespons.');
      return {id: result.metadata.id, path: result.metadata.path_display??to};
    },
    async list(path) {
      const entries: {id: string; path: string; folder: boolean}[] = [];
      let page = await rpc('files/list_folder', {path, recursive: false, include_deleted: false});
      for (;;) {
        if(!Array.isArray(page?.entries)||typeof page.has_more!=='boolean'||page.has_more&&typeof page.cursor!=='string')throw new SyncFailure({code:failureCodes.response,stage:'dropbox.list'},'Ugyldig mappelisting.');
        for (const entry of page.entries) entries.push({id: entry.id, path: entry.path_display, folder: entry['.tag'] === 'folder'});
        if (!page.has_more) return entries;
        page = await rpc('files/list_folder/continue', {cursor: page.cursor});
      }
    },
    async removeEmpty(path) {
      if (!await metadata(path)) return true;
      if ((await files.list(path)).length) return false;
      // Product-approved limitation: Dropbox has no atomic empty-only folder delete.
      await rpc('files/delete_v2', {path}); return true;
    },
    async deleteFile(path,rev){try{await rpc('files/delete_v2',{path,parent_rev:rev});}catch(error){if(!missing(error)&&!(error instanceof DropboxError&&error.status===409&&/^path_lookup\/not_found/.test(error.summary)))throw error;}},
  };
  async function disconnect() {
    invalidated++;rate.cancel();
    const value = credentials(); localStorage.removeItem(authKey); sessionStorage.removeItem(pendingKey);
    if (!value) return true;
    const response = await send('auth/token/revoke', {method: 'POST', headers: {Authorization: `Bearer ${value.accessToken}`}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    return response.ok;
  }
  return {account, connect, callback, disconnect, files,beginRun:rate.begin,cancelPending:rate.cancel};
}
