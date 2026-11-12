export async function mockDropbox(page){
 const files=new Map(),sources=new Map(),calls=[];let revision=0;
 function add(path,text='',tag='file'){const file={'.tag':tag,id:`id:mock-${++revision}`,rev:`r${++revision}`,name:path.split('/').pop(),path_display:path,path_lower:path.toLowerCase(),size:Buffer.byteLength(text),text};files.set(file.id,file);return file;}
 const lookup=path=>files.get(path)??[...files.values()].find(file=>file.path_lower===path?.toLowerCase());
 const metadata=file=>{const {text,...rest}=file;return rest;};
 await page.route('https://*.dropboxapi.com/**',async route=>{
  const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.replace(/^\/2\//,''),headers={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Dropbox-API-Result','Access-Control-Allow-Headers':'*'};
  if(request.method()==='OPTIONS'){await route.fulfill({status:200,headers});return;}
  let args;try{args=JSON.parse(request.headers()['dropbox-api-arg']??request.postData()??'null');}catch{args={};}
  calls.push({endpoint,args,body:request.postData()});
  const json=value=>route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(value)});
  const error=tag=>route.fulfill({status:409,headers,contentType:'application/json',body:JSON.stringify({error_summary:tag})});
  if(endpoint==='files/list_folder'){
   if(args.shared_link){const source=sources.get(args.shared_link.url);if(source instanceof Error)return error('shared_link/not_found');return json({entries:(source??[]).filter(file=>file.relative.slice(0,file.relative.lastIndexOf('/'))===args.path).map(metadata),cursor:'source',has_more:false});}
   return json({entries:[...files.values()].map(metadata),cursor:'all',has_more:false});
  }
  if(endpoint==='files/download'){const file=lookup(args.path);if(!file)return error('path/not_found');return route.fulfill({status:200,headers:{...headers,'Dropbox-API-Result':JSON.stringify(metadata(file))},contentType:'application/octet-stream',body:Buffer.from(file.text)});}
  if(endpoint==='files/upload'){let file=lookup(args.path);if(file?args.mode?.update!==file.rev:Boolean(args.mode?.update))return error(file?'path/conflict/file':'path/not_found');file??=add(args.path);file.text=request.postData();file.rev=`r${++revision}`;return json(metadata(file));}
  if(endpoint==='files/create_folder_v2'){const file=lookup(args.path);return file?error('path/conflict/folder'):json({metadata:metadata(add(args.path,'','folder'))});}
  if(endpoint==='files/move_v2'){const file=lookup(args.from_path);if(!file)return error('from_lookup/not_found');if(lookup(args.to_path))return error('to/conflict/file');file.path_display=args.to_path;file.path_lower=args.to_path.toLowerCase();file.name=args.to_path.split('/').pop();return json({metadata:metadata(file)});}
  if(endpoint==='sharing/get_shared_link_file'){const file=(sources.get(args.url)??[]).find(file=>file.relative===args.path);return file?route.fulfill({status:200,headers,body:Buffer.from(file.text)}):error('shared_link/not_found');}
  if(endpoint==='sharing/list_shared_links')return json({links:[]});
  if(endpoint==='sharing/create_shared_link_with_settings')return json({url:'https://www.dropbox.com/scl/fo/mock-link?rlkey=reader'});
  if(endpoint==='auth/token/revoke')return json(null);
  if(endpoint==='users/get_current_account')return json({account_id:'mock-account',name:{display_name:'Testbruker'}});
  return route.fulfill({status:500,headers,body:JSON.stringify({error_summary:`unhandled:${endpoint}`})});
 });
 return {files,sources,calls,add,lookup};
}
export async function authorizeMock(page){await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('hobos-songbook-test');request.onsuccess=()=>{const db=request.result,tx=db.transaction('sync','readwrite'),store=tx.objectStore('sync'),r=store.get('state');r.onsuccess=()=>{const state=r.result??{id:'state',songs:{},config:{id:'config',generation:0,dirty:true,sources:[]},conflicts:[]};state.owner='mock-account';state.auth={account_id:'mock-account',access_token:'mock-access',refresh_token:'mock-refresh',expires:Date.now()+3600000};store.put(state);};tx.oncomplete=()=>{db.close();resolve();};};}));await page.reload();}
export async function syncState(page){return page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('hobos-songbook-test');request.onsuccess=()=>{const db=request.result,r=db.transaction('sync').objectStore('sync').get('state');r.onsuccess=()=>{db.close();resolve(r.result);};};}));}
