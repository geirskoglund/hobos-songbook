import type {Song, SongPersonal} from './song.ts';
import type {Songbook} from './songbook.ts';
import type {Setlist} from './setlist.ts';
export type Access = 'private' | 'shared' | 'import';
export interface RemoteFile {id: string; rev: string; path: string; hash?: string}
export interface Source {id: string; name: string; url: string; songbookId: string; lastSync?: string; error?: string}
export interface SongSync {
  id: string; songId: string; generation: number; dirty: boolean; editing: boolean;
  file?: RemoteFile; metadata?: RemoteFile; conflict?: string; account?: string;
  original?: string; pendingPath?: string; importOriginal?: string;
}
export interface SyncConfig {id: 'config'; generation: number; dirty: boolean; remote?: RemoteFile; sources: Source[]; settings?: Record<string, unknown>; conflict?: string}
export interface SongEnvelope {version: 1; song: Song; personal: SongPersonal; file: RemoteFile}
export interface LibraryEnvelope {version: 1; songbooks: Songbook[]; setlists: Setlist[]; sources: Source[]; settings?: Record<string, unknown>}
export interface SyncState {
  id: 'state'; songs: Record<string, SongSync>; config: SyncConfig; owner?: string;
  auth?: {access_token: string; refresh_token: string; expires: number; account_id: string};
  conflicts: {id: string; songId?: string; reason: string; local: unknown; remote: unknown; uploaded?: boolean}[];
  lastSync?: string; lease?: {id: string; expires: number};
}
export const emptySyncState = (): SyncState => ({id: 'state', songs: {}, config: {id: 'config', generation: 0, dirty: true, sources: []}, conflicts: []});
export interface SyncData {songs: Song[]; personal: SongPersonal[]; songbooks: Songbook[]; setlists: Setlist[]; state: SyncState}
export const accessOf = (song: Song): Access => song.sync?.access ?? 'private';
export const canEditSource = (song: Song) => accessOf(song) !== 'import' && !song.sync?.deleted;
export const accessLabel = (song: Song) => song.sync?.deleted ? 'Slettet' : song.sync?.detached ? 'Frakoblet' : song.sync?.pending ? (accessOf(song)==='shared'?'Publisering venter':'Avpublisering venter') : ({private: 'Privat', shared: 'Publisert', import: 'Importert'}[accessOf(song)]);
export const songSyncId = (id: string) => `song:${id}`;
export function dirtySong(songId: string, current?: SongSync, editing = false): SongSync {
  return {...current, id: songSyncId(songId), songId, generation: (current?.generation ?? 0) + 1, dirty: true, editing: current?.editing || editing};
}
export function safeName(value: string) {
  const clean = value.normalize('NFC').replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim();
  return Array.from(clean || 'Sang').slice(0, 160).join('');
}
export function filename(song: Song) {
  const ext = song.origin.filename.match(/\.(cho|chordpro|chopro|crd|pro|chord|txt)$/i)?.[0] ?? '.cho';
  return safeName(song.title) + ext.toLowerCase();
}
export function songPath(song: Song, books: Songbook[]) {
  const access = accessOf(song);
  if (access === 'shared') {
    const book = books.find(book => book.id === song.songbookId);
    if (!book || book.id === 'standard') throw Error('Velg en sangbok før publisering.');
    const folder=book.folderName??safeName(book.name);if(/[\\/\u0000-\u001f]/.test(folder)||['.','..',''].includes(folder))throw Error('Ugyldig delingsmappe.');
    return `/Shared/${folder}/${filename(song)}`;
  }
  return `/${access === 'import' ? 'Import' : 'Private'}/${filename(song)}`;
}
export function collisionPath(path: string, attempt: number) {
  if (!attempt) return path;
  return path.replace(/(\.[^./]+)?$/, (_, ext = '') => ` (${attempt + 1})${ext}`);
}
export function validSharedLink(text: string): string {
  let url: URL;
  try {url = new URL(text.trim());} catch {throw Error('Lim inn en delt Dropbox-lenke.');}
  if (url.protocol !== 'https:' || !['dropbox.com', 'www.dropbox.com'].includes(url.hostname) || url.username || url.password || url.port) throw Error('Bruk en https-lenke fra dropbox.com.');
  url.hash = ''; url.searchParams.delete('dl'); url.searchParams.delete('raw');
  return url.href;
}
/** Only metadata files inside our private namespace are interpreted as app data. */
export function parseEnvelope(text: string): SongEnvelope {
  const x = JSON.parse(text);
  if (x?.version !== 1 || typeof x.song?.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(x.song.id) || Object.hasOwn(Object.prototype,x.song.id) || typeof x.song.original !== 'string' || typeof x.song.title !== 'string' || typeof x.song.origin?.filename !== 'string' || typeof x.song.origin.importedAt !== 'string' || typeof x.song.songbookId !== 'string' || x.personal?.songId !== x.song.id || typeof x.file?.id !== 'string' || typeof x.file?.rev !== 'string' || !/^\/(Private|Shared|Import)\//.test(x.file.path)) throw Error('Ukjent eller skadet sangmetadata. Filen er beholdt.');
  return x;
}
