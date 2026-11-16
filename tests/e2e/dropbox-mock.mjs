/** HTTP-level Dropbox simulator; app builds contain no test hooks or credentials. */
export async function dropboxMock(context, {connected=true}={}) {
  let sequence=0;const entries=new Map(),history=new Map(),calls=[];let fault=null,hold=null;
  const key=path=>path.toLowerCase();
  const find=path=>path.startsWith('id:')?[...entries.values()].find(e=>e.id===path):path.startsWith('rev:')?history.get(path.slice(4)):entries.get(key(path));
  function put(path,text,folder=false){const old=find(path),value={'.tag':folder?'folder':'file',id:old?.id??`id:${++sequence}`,path_display:path,path_lower:key(path),rev:String(++sequence),text};entries.set(key(path),value);history.set(value.rev,{...value});return value;}
  const metadata=value=>{const copy={...value};delete copy.text;return copy;};
  if(connected)await context.addInitScript(()=>{
    const name='hobos-songbook-test:dropbox-auth-v1';
    if(!sessionStorage.getItem('mock-seeded')){localStorage.setItem(name,JSON.stringify({version:1,accountId:'dbid:fixture',name:'Prøvebruker med et langt navn',email:'bruker.med.langt.navn@eksempel.no',accessToken:'fixture-access',refreshToken:'fixture-refresh',expires:Date.now()+3600000}));sessionStorage.setItem('mock-seeded','yes');}
  });
  await context.route(/https:\/\/(api|content)\.dropboxapi\.com\//,async route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.pathname;const body=request.postData();
    const args=JSON.parse(request.headers()['dropbox-api-arg']??body??'null');calls.push({endpoint,args});
    if(hold&&endpoint.endsWith(hold.endpoint)){const resolve=hold.resolve;hold=null;await resolve;}
    if(fault&&endpoint.endsWith(fault.endpoint)){const status=fault.status;fault=null;await route.fulfill({status,json:{error_summary:status===409?'path/conflict/file/':'error/'}});return;}
    const ok=async value=>route.fulfill({status:200,json:value}),missing=async()=>route.fulfill({status:409,json:{error_summary:'path/not_found/'}});
    if(endpoint.endsWith('/get_current_account'))return ok({account_id:'dbid:fixture',name:{display_name:'Prøvebruker'},email:'bruker@eksempel.no'});
    if(endpoint.endsWith('/token/revoke'))return ok(null);
    if(endpoint.endsWith('/get_metadata')){const value=find(args.path);return value?ok(metadata(value)):missing();}
    if(endpoint.endsWith('/create_folder_v2'))return ok({metadata:metadata(put(args.path,'',true))});
    if(endpoint.endsWith('/list_folder'))return ok({entries:[...entries.values()].filter(e=>e.path_lower.startsWith(key(args.path)+'/')&&!e.path_display.slice(args.path.length+1).includes('/')).map(metadata),has_more:false,cursor:'end'});
    if(endpoint.endsWith('/download')){const value=find(args.path);if(!value)return missing();return route.fulfill({status:200,contentType:'application/octet-stream',headers:{'Access-Control-Expose-Headers':'Dropbox-API-Result','Dropbox-API-Result':JSON.stringify(metadata(value))},body:Buffer.from(value.text)});}
    if(endpoint.endsWith('/upload')){const old=find(args.path);if(args.mode['.tag']==='update'?old?.rev!==args.mode.update:Boolean(old))return route.fulfill({status:409,json:{error_summary:'path/conflict/file/'}});return ok(metadata(put(args.path,Buffer.from(request.postDataBuffer()).toString('utf8'))));}
    if(endpoint.endsWith('/move_v2')){const value=find(args.from_path);if(!value)return missing();if(find(args.to_path))return route.fulfill({status:409,json:{error_summary:'to/conflict/'}});const prefix=value.path_display;for(const [k,e]of[...entries])if(e.path_display===prefix||e.path_display.startsWith(prefix+'/')){entries.delete(k);e.path_display=args.to_path+e.path_display.slice(prefix.length);e.path_lower=key(e.path_display);entries.set(e.path_lower,e);}return ok({metadata:metadata(value)});}
    if(endpoint.endsWith('/delete_v2')){const value=find(args.path);if(!value)return missing();entries.delete(key(value.path_display));return ok({metadata:metadata(value)});}
    throw Error('Unexpected Dropbox endpoint '+endpoint);
  });
  return {entries,calls,find,put,fault(endpoint,status){fault={endpoint,status};},hold(endpoint){let release;const resolve=new Promise(r=>release=r);hold={endpoint,resolve};return ()=>release();}};
}
