import type {RemoteFile, SyncState} from '../domain/sync.ts';
export interface Entry {'.tag': 'file' | 'folder' | 'deleted'; id: string; name: string; path_display?: string; path_lower?: string; rev?: string; content_hash?: string; size?: number; relative?: string}
export const scopes = ['account_info.read','files.metadata.read','files.content.read','files.content.write','sharing.read','sharing.write'];
export const appKeys = {test: 'le5cddh388klcjz', production: '9hivdq3nxrgtquz'};
export class DropboxError extends Error {
  status: number; tag: string; endpoint: string;
  constructor(status: number, tag: string, endpoint: string) {super(status === 401 ? 'Dropbox-tilgangen må fornyes. Koble til på nytt.' : status === 429 ? 'Dropbox ber oss vente. Prøv synkronisering igjen om litt.' : `Dropbox kunne ikke fullføre handlingen (${status}, ${tag}). Lokale data er beholdt.`); this.status=status;this.tag=tag;this.endpoint=endpoint;}
}
const ascii = (value: unknown) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
export const remoteFile = (entry: Entry): RemoteFile => ({id: entry.id, rev: entry.rev!, path: entry.path_display!, hash: entry.content_hash});
const responseText = async (response: Response) => {const bytes=await response.arrayBuffer();try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error('Dropbox-filen kan ikke leses som UTF-8. Filen og lokale data er beholdt.');}};
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function pkceChallenge(verifier: string) {return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));}
export async function authorize(namespace: string, key: string, redirect: string) {
  if (!key) throw Error('Dropbox-appen for dette miljøet er ikke konfigurert ennå.');
  const verifier = base64(crypto.getRandomValues(new Uint8Array(64))), state = base64(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(`${namespace}:oauth`, JSON.stringify({verifier, state, redirect, created: Date.now()}));
  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  for (const [name,value] of Object.entries({client_id:key,response_type:'code',redirect_uri:redirect,state,code_challenge:await pkceChallenge(verifier),code_challenge_method:'S256',token_access_type:'offline',scope:scopes.join(' ')})) url.searchParams.set(name,value);
  location.assign(url.href);
}
async function token(body: Record<string,string>, transport: typeof fetch) {
  const response = await transport('https://api.dropboxapi.com/oauth2/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(25000)});
  if (!response.ok) throw Error('Dropbox-innloggingen kunne ikke fullføres. Koble til på nytt.');
  return response.json();
}
export async function finishAuthorization(namespace: string, key: string, transport: typeof fetch = fetch): Promise<SyncState['auth'] | undefined> {
  const url = new URL(location.href);
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) return;
  const stored = sessionStorage.getItem(`${namespace}:oauth`); sessionStorage.removeItem(`${namespace}:oauth`);
  const code = url.searchParams.get('code'), state = url.searchParams.get('state'), error = url.searchParams.get('error');
  for (const name of ['code','state','error','error_description']) url.searchParams.delete(name);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  const pending = stored ? JSON.parse(stored) : undefined;
  if (!pending || state !== pending.state || Date.now() - pending.created > 10 * 60 * 1000 || pending.redirect !== location.origin + location.pathname) throw Error('Innloggingen er utløpt eller tilhører en annen fane. Koble til på nytt.');
  if (error || !code) throw Error('Dropbox-tilkoblingen ble avbrutt. Lokale data er beholdt.');
  const value = await token({code,grant_type:'authorization_code',client_id:key,code_verifier:pending.verifier,redirect_uri:pending.redirect},transport);
  if (!value.access_token || !value.refresh_token || !value.account_id || !Number.isFinite(value.expires_in)) throw Error('Dropbox returnerte ufullstendig innlogging. Prøv igjen.');
  return {...value, expires:Date.now()+value.expires_in*1000};
}
/** Only this adapter knows Dropbox endpoints. Never sends a token outside Dropbox. */
export function dropbox(auth: () => Promise<NonNullable<SyncState['auth']>>, save: (value: NonNullable<SyncState['auth']>) => Promise<void>, key: string, transport: typeof fetch = fetch) {
  let refreshing: Promise<NonNullable<SyncState['auth']>> | undefined;
  async function credentials() {
    const current = await auth();
    if (current.expires > Date.now()+60000) return current;
    if (!refreshing) refreshing = (async () => {const value = await token({grant_type:'refresh_token',refresh_token:current.refresh_token,client_id:key},transport); const next = {...current,access_token:value.access_token,expires:Date.now()+value.expires_in*1000}; await save(next); return next;})();
    try {return await refreshing;} finally {refreshing = undefined;}
  }
  async function request(endpoint: string, args: unknown, content?: string, download = false): Promise<Response> {
    const value = await credentials();
    const headers: Record<string,string> = {Authorization:`Bearer ${value.access_token}`};
    if (content !== undefined || download) headers['Dropbox-API-Arg'] = ascii(args); else headers['Content-Type'] = 'application/json';
    if (content !== undefined) headers['Content-Type'] = 'application/octet-stream';
    const response = await transport(`https://${content !== undefined || download ? 'content' : 'api'}.dropboxapi.com/2/${endpoint}`, {method:'POST',headers,body:download?undefined:content??JSON.stringify(args),signal:AbortSignal.timeout(25000)});
    if (!response.ok) {const error = await response.json().catch(()=>({})); throw new DropboxError(response.status, String(error.error_summary ?? 'nettverksfeil').split('/').slice(0,3).join('/'), endpoint);}
    return response;
  }
  const rpc = async <T>(endpoint: string, args: unknown): Promise<T> => (await request(endpoint,args)).json();
  async function list(path = '', link?: string): Promise<Entry[]> {
    let page = await rpc<{entries:Entry[];cursor:string;has_more:boolean}>('files/list_folder', {path, recursive:!link, include_deleted:false, ...(link?{shared_link:{url:link}}:{})});
    const entries = [...page.entries];
    while (page.has_more) {page = await rpc('files/list_folder/continue',{cursor:page.cursor}); entries.push(...page.entries);}
    return entries;
  }
  return {
    rpc, list,
    account: () => rpc<{account_id:string;name:{display_name:string}}>('users/get_current_account',null),
    async download(file: Entry | RemoteFile) {
      if ('size' in file && file.size! > 5*1024*1024) throw Error('Filen er større enn 5 MB. Den er beholdt i Dropbox.');
      const response = await request('files/download', {path:file.id}, undefined,true);
      return {text:await responseText(response), file:remoteFile(JSON.parse(response.headers.get('Dropbox-API-Result')!))};
    },
    async sourceFiles(url: string) {
      const result: Entry[] = [], pending = [''];
      while (pending.length) {
        const path = pending.pop()!;
        for (const entry of await list(path,url)) {
          const relative = `${path}/${entry.name}`;
          if (entry['.tag'] === 'folder') pending.push(relative); else if (entry['.tag'] === 'file') result.push({...entry,relative});
        }
      }
      return result;
    },
    async sourceText(url: string, entry: Entry) {
      if ((entry.size ?? 0) > 5*1024*1024) throw Error('Kildefilen er større enn 5 MB.');
      const response = await request('sharing/get_shared_link_file',{url,path:entry.relative},undefined,true);
      return responseText(response);
    },
    async upload(path: string, text: string, rev?: string) {
      const response = await request('files/upload',{path,mode:rev?{'.tag':'update',update:rev}:{'.tag':'add'},autorename:false,strict_conflict:true,mute:true},text);
      return remoteFile(await response.json());
    },
    async move(file: RemoteFile, path: string) {return remoteFile((await rpc<{metadata:Entry}>('files/move_v2',{from_path:file.id,to_path:path,autorename:false})).metadata);},
    async folder(path: string) {try {return (await rpc<{metadata:Entry}>('files/create_folder_v2',{path,autorename:false})).metadata;} catch(error) {if (error instanceof DropboxError && error.tag.startsWith('path/conflict/folder')) return; throw error;}},
    async link(path: string) {
      const list = await rpc<{links:{url:string}[]}>('sharing/list_shared_links',{path,direct_only:true});
      if (list.links[0]) return list.links[0].url;
      try {return (await rpc<{url:string}>('sharing/create_shared_link_with_settings',{path,settings:{requested_visibility:'public',audience:'public',access:'viewer',allow_download:true}})).url;}
      catch(error) {if (error instanceof DropboxError && error.tag.startsWith('shared_link_already_exists')) {const again=await rpc<{links:{url:string}[]}>('sharing/list_shared_links',{path,direct_only:true}); if(again.links[0])return again.links[0].url;} throw error;}
    },
    revoke: () => rpc('auth/token/revoke',null),
  };
}
export type Dropbox = ReturnType<typeof dropbox>;
