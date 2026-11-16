/** HTTP-level Dropbox simulator; app builds contain no test hooks or credentials. */
export async function dropboxMock(context, {connected=true,pageSize=2000,backend}={}) {
  let sequence=0;const entries=backend?.entries??new Map(),history=backend?.history??new Map(),sessions=backend?.sessions??new Map(),calls=[];let fault=null,hold=null,lostBatch=false,batchFailure=null;
  let latency=0,active=0,maximum=0;
  let limitWrites=false,activeWrites=0,rateCount=0;
  const mutating=endpoint=>['/upload','/upload_session/finish_batch_v2','/create_folder_v2','/move_v2','/delete_v2'].some(value=>endpoint.endsWith(value));
  const rateResponse=async(route,seconds=0,reason='too_many_write_operations')=>{rateCount++;return route.fulfill({status:429,headers:{'Retry-After':String(seconds)},json:{error_summary:reason+'/',error:{reason:{'.tag':reason},retry_after:seconds}}});};
  const key=path=>path.toLowerCase();
  const find=path=>path.startsWith('id:')?[...entries.values()].find(e=>e.id===path):path.startsWith('rev:')?history.get(path.slice(4)):entries.get(key(path));
  function put(path,text,folder=false){if(backend)return backend.put(path,text,folder);const old=find(path),value={'.tag':folder?'folder':'file',id:old?.id??`id:${++sequence}`,path_display:path,path_lower:key(path),rev:String(++sequence),text,...(!folder?{size:Buffer.byteLength(text)}:{})};entries.set(key(path),value);history.set(value.rev,{...value});return value;}
  const metadata=value=>{const copy={...value};delete copy.text;return copy;};
  const cursors=backend?.cursors??new Map();
  const snapshot=args=>new Map([...entries.values()].filter(e=>e.path_lower.startsWith(key(args.path)+'/')&&(args.recursive||!e.path_display.slice(args.path.length+1).includes('/'))).map(e=>[e.path_lower,metadata(e)]));
  const listPage=(items,current,args)=>{const cursor='cursor-'+crypto.randomUUID(),remaining=items.slice(pageSize);cursors.set(cursor,{snapshot:current,args,remaining});return{entries:items.slice(0,pageSize),has_more:remaining.length>0,cursor};};
  if(connected)await context.addInitScript(()=>{
    const name='hobos-songbook-test:dropbox-auth-v1';
    if(!sessionStorage.getItem('mock-seeded')){localStorage.setItem(name,JSON.stringify({version:1,accountId:'dbid:fixture',name:'Prøvebruker med et langt navn',email:'bruker.med.langt.navn@eksempel.no',accessToken:'fixture-access',refreshToken:'fixture-refresh',expires:Date.now()+3600000}));sessionStorage.setItem('mock-seeded','yes');}
  });
  await context.route(/https:\/\/(api|content)\.dropboxapi\.com\//,async route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.pathname;const body=request.postData();
    const args=request.headers()['dropbox-api-arg']?JSON.parse(request.headers()['dropbox-api-arg']):request.headers()['content-type']?.includes('application/json')?JSON.parse(body??'null'):null;calls.push({endpoint,args});
    const writing=mutating(endpoint);active++;if(writing)activeWrites++;maximum=Math.max(maximum,active);try{
    if(limitWrites&&writing&&activeWrites>1)return await rateResponse(route);
    if(latency)await new Promise(resolve=>setTimeout(resolve,latency));
    if(hold&&endpoint.endsWith(hold.endpoint)&&(!hold.path||hold.path===args?.path)){const waiting=hold;if(!waiting.all)hold=null;await waiting.resolve;}
    if(fault&&endpoint.endsWith(fault.endpoint)){if(fault.skip)fault.skip--;else{const current=fault,status=current.status;if(--current.remaining<=0)fault=null;if(status===0)return route.abort('failed');if(status===429)return await rateResponse(route,current.retryAfter,current.reason);await route.fulfill({status,json:{error_summary:status===409?'path/conflict/file/':'error/'}});return;}}
    const ok=async value=>route.fulfill({status:200,json:value}),missing=async()=>route.fulfill({status:409,json:{error_summary:'path/not_found/'}});
    if(endpoint==='/oauth2/token')return ok({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,account_id:'dbid:fixture',scope:'account_info.read files.metadata.read files.content.read files.content.write'});
    if(endpoint.endsWith('/get_current_account'))return ok({account_id:'dbid:fixture',name:{display_name:'Prøvebruker'},email:'bruker@eksempel.no'});
    if(endpoint.endsWith('/token/revoke'))return ok(null);
    if(endpoint.endsWith('/get_metadata')){const value=find(args.path);return value?ok(metadata(value)):missing();}
    if(endpoint.endsWith('/create_folder_v2')){if(find(args.path))return route.fulfill({status:409,json:{error_summary:'path/conflict/folder/'}});const value=metadata(put(args.path,'',true));delete value['.tag'];return ok({metadata:value});}
    if(endpoint.endsWith('/list_folder')){const current=snapshot(args);return ok(listPage([...current.values()],current,args));}
    if(endpoint.endsWith('/list_folder/continue')){const prior=cursors.get(args.cursor);if(!prior)return route.fulfill({status:409,json:{error_summary:'reset/'}});if(prior.remaining.length)return ok(listPage(prior.remaining,prior.snapshot,prior.args));const current=snapshot(prior.args),items=[];for(const [path,e]of prior.snapshot)if(!current.has(path))items.push({'.tag':'deleted',path_display:e.path_display,path_lower:path});for(const [path,e]of current)if(JSON.stringify(prior.snapshot.get(path))!==JSON.stringify(e))items.push(e);return ok(listPage(items,current,prior.args));}
    if(endpoint.endsWith('/download')){const value=find(args.path);if(!value)return missing();const meta=metadata(value);delete meta['.tag'];return route.fulfill({status:200,contentType:'application/octet-stream',headers:{'Access-Control-Expose-Headers':'Dropbox-API-Result','Dropbox-API-Result':JSON.stringify(meta)},body:Buffer.from(value.text)});}
    if(endpoint.endsWith('/upload')){const old=find(args.path);if(args.mode['.tag']==='update'?old?.rev!==args.mode.update:Boolean(old))return route.fulfill({status:409,json:{error_summary:'path/conflict/file/'}});const value=metadata(put(args.path,Buffer.from(request.postDataBuffer()).toString('utf8')));delete value['.tag'];return ok(value);}
    if(endpoint.endsWith('/upload_session/start')){if(url.host!=='content.dropboxapi.com')throw Error('Upload session has wrong host');if(args.close!==true)throw Error('Session must be closed');const id='session-'+crypto.randomUUID();sessions.set(id,Buffer.from(request.postDataBuffer()));return ok({session_id:id});}
    if(endpoint.endsWith('/upload_session/finish_batch_v2')){
      if(url.host!=='api.dropboxapi.com'||!args.entries.length||args.entries.length>1000)throw Error('Invalid batch request');
      const results=args.entries.map(({cursor,commit})=>{
        if(commit.autorename!==false||commit.strict_conflict!==true)throw Error('Batch must preserve revision guards');
        if(batchFailure&&commit.path===batchFailure.path){const failure={'.tag':'failure',failure:batchFailure.tag==='path/too_many_write_operations'?{'.tag':'path',path:{'.tag':'too_many_write_operations'}}:{'.tag':batchFailure.tag}};if(--batchFailure.remaining<=0)batchFailure=null;return failure;}
        const bytes=sessions.get(cursor.session_id);
        if(!bytes)return{'.tag':'failure',failure:{'.tag':'lookup_failed',lookup_failed:{'.tag':'not_found'}}};
        if(cursor.offset!==bytes.length)throw Error('Wrong byte offset');
        const old=find(commit.path);
        if(commit.mode['.tag']==='update'?old?.rev!==commit.mode.update:Boolean(old))return{'.tag':'failure',failure:{'.tag':'path',path:{'.tag':'conflict',conflict:{'.tag':'file'}}}};
        const value=metadata(put(commit.path,bytes.toString('utf8')));sessions.delete(cursor.session_id);return{...value,'.tag':'success'};
      });
      if(lostBatch){lostBatch=false;return route.abort('failed');}return ok({entries:results});
    }
    if(endpoint.endsWith('/move_v2')){const value=find(args.from_path);if(!value)return missing();if(find(args.to_path))return route.fulfill({status:409,json:{error_summary:'to/conflict/'}});const prefix=value.path_display;for(const [k,e]of[...entries])if(e.path_display===prefix||e.path_display.startsWith(prefix+'/')){entries.delete(k);e.path_display=args.to_path+e.path_display.slice(prefix.length);e.path_lower=key(e.path_display);entries.set(e.path_lower,e);}return ok({metadata:metadata(value)});}
    if(endpoint.endsWith('/delete_v2')){const value=find(args.path);if(!value)return route.fulfill({status:409,json:{error_summary:'path_lookup/not_found/'}});if(args.parent_rev&&args.parent_rev!==value.rev)return route.fulfill({status:409,json:{error_summary:'path_lookup/conflict/'}});entries.delete(key(value.path_display));return ok({metadata:metadata(value)});}
    throw Error('Unexpected Dropbox endpoint '+endpoint);
    }finally{active--;if(writing)activeWrites--;}
  });
  return {entries,history,sessions,cursors,calls,find,put,loseBatchReply(){lostBatch=true;},failBatchEntry(path,tag='too_many_write_operations',repeat=1){batchFailure={path,tag,remaining:repeat};},latency(ms){latency=ms;maximum=0;},maximum:()=>maximum,throttled:()=>rateCount,limitConcurrentWrites(){limitWrites=true;},resetCursors(){cursors.clear();},rename(from,to){const value=find(from);const prefix=value.path_display;for(const [k,e]of [...entries])if(e.path_display===prefix||e.path_display.startsWith(prefix+'/')){entries.delete(k);e.path_display=to+e.path_display.slice(prefix.length);e.path_lower=key(e.path_display);entries.set(e.path_lower,e);}},fault(endpoint,status,skip=0,{repeat=1,retryAfter=0,reason='too_many_write_operations'}={}){fault={endpoint,status,skip,remaining:repeat,retryAfter,reason};},hold(endpoint,all=false,path){let release;const resolve=new Promise(r=>release=r),waiting={endpoint,resolve,all,path};hold=waiting;return ()=>{if(hold===waiting)hold=null;release();};}};
}
