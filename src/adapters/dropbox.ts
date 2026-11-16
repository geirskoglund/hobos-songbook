import type {AppEnvironment} from '../environment.ts';
import type {FileValue, RemoteFiles} from '../sync/model.ts';
export const requiredScopes = ['account_info.read', 'files.metadata.read', 'files.content.read', 'files.content.write'];
export function dropboxConfig(channel: AppEnvironment['channel']) {
  return {key: channel === 'production' ? '9hivdq3nxrgtquz' : 'le5cddh388klcjz', redirect: `https://geirskoglund.github.io/hobos-songbook/${channel === 'production' ? 'app' : 'test'}/`};
}
interface Credentials {version: 1; accountId: string; name: string; email: string; accessToken: string; refreshToken: string; expires: number}
interface Pending {state: string; verifier: string; redirect: string; created: number}
export class DropboxError extends Error {
  status: number; summary: string;
  constructor(status: number, summary: string) {super(status === 401 || status === 403 ? 'Dropbox-tilgangen er utløpt eller mangler rettigheter. Koble til på nytt; lokale data er beholdt.' : status === 409 ? 'Dropbox er endret eller navnet er opptatt. Arbeidet er beholdt og må prøves på nytt.' : status === 429 ? 'Dropbox ber om en pause. Endringene venter på opplasting.' : 'Dropbox kunne ikke nås. Endringene er beholdt lokalt.'); this.status = status; this.summary = summary;}
}
const apiArg = (value: unknown) => JSON.stringify(value).replace(/[^\u0000-\u007f]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export async function pkceChallenge(verifier: string) {
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function dropboxAdapter(env: AppEnvironment, request: typeof fetch = fetch, beforeRequest: () => void = () => {}) {
  const config = dropboxConfig(env.channel), authKey = `${env.namespace}:dropbox-auth-v1`, pendingKey = `${env.namespace}:dropbox-pkce-v1`;
  let invalidated = 0;
  function credentials(): Credentials | null {
    const raw = localStorage.getItem(authKey); if (!raw) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || !value.accountId || !value.refreshToken) throw new Error('Dropbox-tilkoblingen må opprettes på nytt. Lokale data er beholdt.');
    return value;
  }
  const account = () => {const value = credentials(); return value && {id: value.accountId, name: value.name, email: value.email};};
  async function token(body: URLSearchParams) {
    const response = await request('https://api.dropboxapi.com/oauth2/token', {method: 'POST', body, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) {if ([400, 401, 403].includes(response.status)) localStorage.removeItem(authKey); throw new DropboxError(response.status === 400 ? 401 : response.status, 'token');}
    return response.json();
  }
  async function access() {
    return navigator.locks.request(`${env.namespace}:dropbox-token`, async () => {
      let value = credentials(); if (!value) throw new Error('Koble til Dropbox først.');
      if (value.expires > Date.now() + 60000) return value.accessToken;
      const epoch = invalidated, previous = value.refreshToken;
      const next = await token(new URLSearchParams({grant_type: 'refresh_token', refresh_token: previous, client_id: config.key}));
      value = credentials();
      if (epoch !== invalidated || value?.refreshToken !== previous) throw new Error('Dropbox-tilkoblingen er endret.');
      value.accessToken = next.access_token; value.expires = Date.now() + next.expires_in * 1000;
      localStorage.setItem(authKey, JSON.stringify(value)); return value.accessToken;
    });
  }
  async function connect() {
    if (location.origin + location.pathname !== config.redirect) throw new Error('Dropbox-tilkobling må startes fra den faste appadressen.');
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
    const pending: Pending | null = raw ? JSON.parse(raw) : null;
    if (!pending || pending.state !== state || pending.redirect !== config.redirect || location.origin + location.pathname !== config.redirect || Date.now() - pending.created > 10 * 60 * 1000 || pending.created > Date.now()) throw new Error('Dropbox-returen er ugyldig eller utløpt. Start tilkoblingen på nytt. Lokale data er beholdt.');
    if (error || !code) throw new Error('Dropbox-tilkoblingen ble avbrutt. Lokale data er beholdt.');
    const epoch = invalidated;
    const value = await token(new URLSearchParams({grant_type: 'authorization_code', code, client_id: config.key, redirect_uri: config.redirect, code_verifier: pending.verifier}));
    if (!value.refresh_token || !requiredScopes.every(scope => String(value.scope ?? '').split(' ').includes(scope))) throw new Error('Dropbox mangler nødvendige rettigheter. Kontroller appens scopes før ny tilkobling.');
    const response = await request('https://api.dropboxapi.com/2/users/get_current_account', {method: 'POST', headers: {Authorization: `Bearer ${value.access_token}`}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) throw new DropboxError(response.status, 'account');
    const user = await response.json();
    if (epoch !== invalidated || user.account_id !== value.account_id) throw new Error('Dropbox-kontoen er endret. Koble til på nytt.');
    localStorage.setItem(authKey, JSON.stringify({version: 1, accountId: user.account_id, name: user.name.display_name, email: user.email, accessToken: value.access_token, refreshToken: value.refresh_token, expires: Date.now() + value.expires_in * 1000} satisfies Credentials));
    return true;
  }
  async function rpc(path: string, body: unknown) {
    beforeRequest(); const accessToken = await access(); beforeRequest();
    const response = await request(`https://api.dropboxapi.com/2/${path}`, {method: 'POST', headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) {if ([401, 403].includes(response.status)) localStorage.removeItem(authKey); const problem = await response.json().catch(() => ({})); throw new DropboxError(response.status, problem.error_summary ?? 'request');}
    return response.json();
  }
  const missing = (error: unknown) => error instanceof DropboxError && error.status === 409 && /^path\/not_found/.test(error.summary);
  async function metadata(path: string) {try {return await rpc('files/get_metadata', {path});} catch (error) {if (missing(error)) return null; throw error;}}
  const fileValue = (data: any, text: string): FileValue => ({text, id: data.id, rev: data.rev, path: data.path_display});
  const files: RemoteFiles = {
    async read(path) {
      beforeRequest(); const accessToken = await access(); beforeRequest();
      const response = await request('https://content.dropboxapi.com/2/files/download', {method: 'POST', headers: {Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Arg': apiArg({path})}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!response.ok) {if ([401, 403].includes(response.status)) localStorage.removeItem(authKey); const value = await response.json().catch(() => ({})); const error = new DropboxError(response.status, value.error_summary ?? 'download'); if (missing(error)) return null; throw error;}
      const meta = JSON.parse(response.headers.get('Dropbox-API-Result') ?? 'null'); if (!meta?.rev) throw new Error('Dropbox ga ingen filversjon.');
      return fileValue(meta, new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(await response.arrayBuffer()));
    },
    async write(path, text, rev) {
      beforeRequest(); const accessToken = await access(); beforeRequest();
      const args = {path, mode: rev ? {'.tag': 'update', update: rev} : {'.tag': 'add'}, autorename: false, strict_conflict: true, mute: true};
      const response = await request('https://content.dropboxapi.com/2/files/upload', {method: 'POST', headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': apiArg(args)}, body: new TextEncoder().encode(text), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!response.ok) {if ([401, 403].includes(response.status)) localStorage.removeItem(authKey); const value = await response.json().catch(() => ({})); throw new DropboxError(response.status, value.error_summary ?? 'upload');}
      return fileValue(await response.json(), text);
    },
    async folder(path) {
      let current = await metadata(path);
      if (!current) {
        try {current = (await rpc('files/create_folder_v2', {path, autorename: false})).metadata;}
        catch (error) {if (!(error instanceof DropboxError && error.status === 409)) throw error; current = await metadata(path);}
      }
      if (current?.['.tag'] !== 'folder') throw new Error('Dropbox-stien er opptatt av en fil. Ingen data overskrives.');
      return {id: current.id, path: current.path_display};
    },
    async move(from, to) {
      const current = await metadata(from);
      if (!current) throw new Error('Dropbox-filen eller mappen mangler. Flyttingen er beholdt for nytt forsøk.');
      if (current.path_display === to) return {id: current.id, path: current.path_display};
      const result = await rpc('files/move_v2', {from_path: from, to_path: to, autorename: false});
      return {id: result.metadata.id, path: result.metadata.path_display};
    },
    async list(path) {
      const entries: {id: string; path: string; folder: boolean}[] = [];
      let page = await rpc('files/list_folder', {path, recursive: false, include_deleted: false});
      for (;;) {
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
  };
  async function disconnect() {
    invalidated++;
    const value = credentials(); localStorage.removeItem(authKey); sessionStorage.removeItem(pendingKey);
    if (!value) return true;
    const response = await request('https://api.dropboxapi.com/2/auth/token/revoke', {method: 'POST', headers: {Authorization: `Bearer ${value.accessToken}`}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    return response.ok;
  }
  return {account, connect, callback, disconnect, files};
}
