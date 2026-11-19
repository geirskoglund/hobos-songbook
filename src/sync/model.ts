import {cleanPersonal} from '../domain/annotations.ts';
import type {Song, SongPersonal} from '../domain/song.ts';
import {failureCodes, SyncFailure, type FailureInfo} from './failure.ts';

/** Wire formats deliberately exclude credentials and local operation/session state. */
export interface BookArchive {at:string;basePath:string;path:string;parentId:string;done?:boolean}
export interface BookLink {id: string; name: string; deleted?: boolean; folderId?: string; path?: string;archive?:BookArchive}
export interface SongLink {id: string; songbookId: string; origin: Song['origin']; fileId?: string; path: string;originalFile?:{fileId:string;path:string}}
export const ownSong = ({origin}: Pick<Song, 'origin'>) => origin.kind === 'local' || origin.provider === 'dropbox' && !origin.sourceId;
export type SongArea = 'Private' | 'Shared';
export function songLocation(path: string) {
  const match = /^(\/Songbooks\/[^/]+)\/(Private|Shared)\/([^/]+\.cho)$/i.exec(path);
  if (!match) return undefined;
  const area: SongArea = match[2].toLowerCase() === 'shared' ? 'Shared' : 'Private';
  return {bookPath: match[1], area, name: match[3]};
}
export interface PublicationSong {id:string; songbookId:string; title:string; key:string|null; time:string|null; published:boolean}
export interface PublicationView {songs:PublicationSong[]; books:{id:string;name:string}[]}
export interface PublicationChoice {id:string; published:boolean}
export interface PublicationResult {view:PublicationView; completed:string[]; moved:string[]; message?:string; unavailable?:boolean}
export interface DeletedSong {id: string; fileId?: string; songbookId?: string}
export interface Manifest {version: 1; books: Record<string, BookLink>; songs: Record<string, SongLink>; deletedSongs?: Record<string, DeletedSong>}
export interface PersonalFile {version: 1; songId: string; original: {rev: string; hash: string}; data: SongPersonal}
export interface FileValue {text: string; rev: string; id: string; path: string}
export interface RemoteEntry {id?: string; path: string; folder?: boolean; rev?: string; deleted?: boolean; size?:number}
export interface UploadIntent {key:string; songId:string; kind:'content'|'personal'|'original'|'seed'; path:string; text:string; rev:string|null; fileId?:string; base:{original:string;personal:PersonalFile;link?:SongLink}}
export interface UploadSession {id:string;created:number}
export interface UploadJob extends UploadIntent {status:'planned'|'committing'|'done'; session?:UploadSession; value?:FileValue; creation?:{path:string;basePath:string;number:number;file?:FileValue;attempted?:boolean;collision?:boolean;failure?:FailureInfo;discarded?:boolean;folderId?:string;book?:BookLink}}
export type BeginUploadResult={session:UploadSession}|{failure:FailureInfo};
export type UploadResult={value:FileValue}|{failure:FailureInfo;resetSession?:boolean};
export interface MoveEntry {key:string;from:string;to:string;fileId:string;toReference?:string;folder?:boolean;link?:SongLink;book?:BookLink;archive?:{bookId:string;sourcePath:string}; sourceBookFolderId?:string; publication?:{sourcePath:string; rev:string}}
export type MoveResult={value:{id:string;path:string;rev?:string;folder?:boolean}}|{failure:FailureInfo;collision?:boolean;missing?:boolean};
export type MoveReply={entries:MoveResult[]}|{asyncJobId:string}|{inProgress:true}|{jobExpired:true};
export interface DeleteEntry {key:string;path:string;fileId:string;rev?:string;folder?:boolean;category:'personal'|'staging'|'folder';sourcePath?:string;bookId?:string}
export interface FolderEntry {key:string;path:string;parentId?:string;book?:BookLink;temporary?:boolean}
export type NamespaceEntry=MoveEntry|DeleteEntry|FolderEntry;
export interface NamespaceJob {id:string;kind:'move'|'delete'|'folders';entries:NamespaceEntry[];submitted?:boolean;jobId?:string;attempt:number;reply?:MoveReply;quarantinedParents?:string[]}
export interface PlacementJob {id?:string;entries:MoveEntry[];jobId?:string;retryAttempt?:number;reply?:MoveReply}
export interface RemoteIndex {cursor: string; entries: Record<string, RemoteEntry>; beforeUpdates?:Record<string,RemoteEntry|null>;epoch?:number}
export interface RemoteFiles {
  read(path: string, knownPath?:string): Promise<FileValue | null>;
  write(path: string, text: string, rev: string | null): Promise<FileValue>;
  beginUpload?(text:string):Promise<UploadSession>;
  beginUploadBatch?(texts:string[]):Promise<BeginUploadResult[]>;
  commitBatch?(jobs:UploadJob[]):Promise<UploadResult[]>;
  moveBatch?(entries:MoveEntry[],retryAttempt?:number):Promise<MoveReply>;
  withMoveReceipt?(work:()=>Promise<void>):Promise<void>;
  checkMoveBatch?(id:string,retryAttempt?:number):Promise<MoveReply>;
  deleteBatch?(entries:DeleteEntry[],retryAttempt?:number):Promise<MoveReply>;
  checkDeleteBatch?(id:string,retryAttempt?:number):Promise<MoveReply>;
  createFoldersBatch?(entries:FolderEntry[],retryAttempt?:number):Promise<MoveReply>;
  checkCreateFoldersBatch?(id:string,retryAttempt?:number):Promise<MoveReply>;
  metadata?(path:string):Promise<RemoteEntry|null>;
  /** Complete, freshly paginated metadata, detached from later local receipts. */
  metadataSnapshot?():Promise<RemoteEntry[]>;
  inspectFile?(path:string):Promise<FileValue|null>;
  folder(path: string, expectedId?: string, knownMissing?: boolean): Promise<{id: string; path: string}>;
  locateFolder(id: string): Promise<{id: string; path: string} | null>;
  move(from: string, to: string, known?:{id:string;path:string}): Promise<{id: string; path: string}>;
  list(path: string): Promise<{id: string; path: string; folder: boolean}[]>;
  removeEmpty(path: string): Promise<boolean>;
  deleteFile?(path:string,rev:string):Promise<void>;
  deleteFiles?(entries:DeleteEntry[]):Promise<void>;
  changes?(cursor?: string): Promise<{entries: RemoteEntry[]; cursor: string; reset: boolean}>;
}
export interface SongBase {original: string; personal: PersonalFile; contentRev: string; personalRev: string}
export interface Conflict {songId: string; kind: 'content' | 'personal'; title: string; local: Song; localPersonal: SongPersonal; remote: Song; remotePersonal: SongPersonal; remotePersonalOriginal: string; contentRev: string; personalRev: string; personalFile: PersonalFile; generation: number}
export interface SyncState {
  id: string; version: 1; accountId: string; manifest: Manifest; bases: Record<string, SongBase>;
  conflicts: Conflict[]; pending: boolean; awaitingDownload?: boolean; localGeneration?: number; error?: string; lastManual?: string;
  failure?: FailureInfo;
  // Durable reservations make retry after a lost response use the same names/identities.
  decisions: Record<string, {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}>;
  renames?: Record<string, {from: string; to: string}>;
  reservations: Record<string, SongLink>; folders: Record<string, BookLink>;
  remote?: RemoteIndex;
  library?: {rev: string; id: string; value: Manifest};
  originals?: Record<string, boolean>;
  uploads?:Record<string,UploadJob>;
  placement?:PlacementJob;
  namespaceJob?:NamespaceJob;
  mutationOwner?:string;
  mutationFileId?:string;
  mutationPending?:boolean;
  movedSongs?:Record<string,SongLink>;
  movedPublications?:Record<string,SongLink>;
  movedBooks?:Record<string,BookLink>;
  createdBooks?:Record<string,BookLink>;
  abandoned?:{path:string;fileId?:string;rev?:string}[];
  cleanupProofs?:Record<string,string>;
  cleanupPending?:boolean;
  archivePending?:boolean;
  archiveIntents?:Record<string,Omit<BookArchive,'done'>&{folderId:string}>;
  uploadIndex?:{id:string;rev:string;value:import('./bridge.ts').UploadIndex};
  skipped?:Record<string,boolean>;
  held?:Record<string,boolean>;
  joined?:boolean;
  publicationContent?:Record<string, {rev:string; title:string; key:string|null; time:string|null}>;
  // Account-local links preserve local IDs while using one cloud identity.
  bindings?:{books:Record<string,string>;songs:Record<string,string>};
}
export interface LocalJournal {id: 'private-local-v1'; version: 1; generation: number; recoveryRequired?: boolean; deletedBooks: Record<string, BookLink>; sessions: Record<string, {songId: string; edited: boolean}>}
export const emptyManifest = (): Manifest => ({version: 1, books: {}, songs: {}});
export const emptyJournal = (): LocalJournal => ({id: 'private-local-v1', version: 1, generation: 0, deletedBooks: {}, sessions: {}});
export const newSyncState = (accountId: string): SyncState => ({id: `private-account-v1:${accountId}`, version: 1, accountId, manifest: emptyManifest(), bases: {}, conflicts: [], pending: true, decisions: {}, reservations: {}, folders: {}});
export function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const personalData = (value: SongPersonal) => cleanPersonal({...value, version: 3});
export type Choice = 'same' | 'upload' | 'download' | 'conflict' | 'remote';
export function direction(local: unknown, remote: unknown, base: unknown, manual: boolean): Choice {
  if (same(local, remote)) return 'same';
  if (remote === undefined) return base === undefined ? 'upload' : 'conflict';
  if (local === undefined) return manual ? 'download' : 'remote';
  if (base === undefined) return 'conflict';
  if (same(remote, base)) return 'upload';
  if (same(local, base)) return manual ? 'download' : 'remote';
  return 'conflict';
}
export async function hash(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function readManifest(text: string): Manifest {
  const value = JSON.parse(text);
  if (value?.version !== 1 || !value.books || !value.songs || typeof value.books !== 'object' || typeof value.songs !== 'object' || Array.isArray(value.books) || Array.isArray(value.songs)) throw new Error('Ukjent Dropbox-bibliotekformat.');
  for (const [id, book] of Object.entries(value.books) as [string, BookLink][]) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || book.id !== id || !book.name || /[\\/]/.test(book.name) || book.path && !book.path.toLowerCase().startsWith('/songbooks/')) throw new Error('Ugyldig sangbokmetadata i Dropbox.');
    if(book.archive){
      const a=book.archive,archivePath=(v:unknown)=>typeof v==='string'&&/^\/Deleted\/[^/\\\u0000-\u001f]+$/.test(v);
      if(!book.deleted||!book.folderId||typeof a.at!=='string'||!Number.isFinite(Date.parse(a.at))||!archivePath(a.basePath)||!archivePath(a.path)||!a.path.startsWith(a.basePath)||a.path!==a.basePath&&!/^ \((?:[2-9]|[1-9]\d+)\)$/.test(a.path.slice(a.basePath.length))||typeof a.parentId!=='string'||!a.parentId||a.done!==undefined&&typeof a.done!=='boolean')throw new Error('Ugyldig arkivintensjon.');
    }
  }
  const fileIds=new Set<string>();
  for (const [id, song] of Object.entries(value.songs) as [string, SongLink][]) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || song.id !== id || !song.origin || !value.books[song.songbookId] || !songLocation(song.path)) throw new Error('Ugyldig sangkobling i Dropbox.');
    if(song.fileId){if(fileIds.has(song.fileId))throw new Error('Dropbox-filen har flere sangidentiteter.');fileIds.add(song.fileId);}
    // A receipt for the generated source copy survives a later external move.
    if(song.originalFile&&(typeof song.originalFile.fileId!=='string'||!song.originalFile.fileId||typeof song.originalFile.path!=='string'||!/^\/[^\u0000]+$/.test(song.originalFile.path)))throw new Error('Ugyldig originalkopi.');
  }
  if(value.deletedSongs!==undefined){
    if(!value.deletedSongs||typeof value.deletedSongs!=='object'||Array.isArray(value.deletedSongs))throw new Error('Ugyldige slettemarkeringer.');
    for(const [id,entry]of Object.entries(value.deletedSongs)as[string,DeletedSong][])if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||entry?.id!==id||entry.fileId!==undefined&&typeof entry.fileId!=='string'||entry.songbookId!==undefined&&typeof entry.songbookId!=='string')throw new Error('Ugyldig slettemarkering.');
  }
  return value;
}
export function parseManifest(text: string): Manifest {
  try{return readManifest(text);}catch(cause){throw new SyncFailure({code:failureCodes.manifest,stage:'sync.manifest'},'Bibliotekformatet kunne ikke leses.',cause);}
}
function readPersonal(text: string, songId: string): PersonalFile {
  const value = JSON.parse(text);
  if (value?.version !== 1 || value.songId !== songId || value.data?.songId !== songId || value.data.version !== 3 || !value.data.chorus || typeof value.original?.rev !== 'string' || !/^[0-9a-f]{64}$/.test(value.original.hash)) throw new Error('Personfilen mangler gyldig originalreferanse. Ingen persondata overskrives.');
  if (!same(value.data, personalData(value.data))) throw new Error('Personfilen inneholder ugyldige data. Ingen persondata overskrives.');
  return value;
}
export function parsePersonal(text: string, songId: string): PersonalFile {
  try{return readPersonal(text,songId);}catch(cause){throw new SyncFailure({code:failureCodes.personal,stage:'sync.personal'},'Personformatet kunne ikke leses.',cause);}
}
function logicalBook(book: BookLink | undefined) {return book && {id: book.id, name: book.name, deleted: Boolean(book.deleted)};}
function logicalSong(song: SongLink | undefined) {return song && {id: song.id, songbookId: song.songbookId, origin: song.origin};}
/** Per-identity three-way merge; absence in a local snapshot never deletes remote identities. */
export function mergeManifest(base: Manifest, local: Manifest, remote: Manifest): Manifest {
  const result: Manifest = structuredClone(remote);
  const deleted={...base.deletedSongs,...local.deletedSongs,...remote.deletedSongs};
  if(Object.keys(deleted).length)result.deletedSongs=deleted;
  for (const [kind, logical] of [['books', logicalBook], ['songs', logicalSong]] as const) {
    for (const [id, entry] of Object.entries(local[kind])) {
      if(kind==='songs'&&(deleted[id]||remote.books[(entry as SongLink).songbookId]?.deleted))continue;
      if(kind==='books'&&remote.books[id]?.deleted)continue;
      const previous = base[kind][id], other = remote[kind][id];
      const a = logical(entry as never), b = logical(other as never), p = logical(previous as never);
      if (same(a, b) || same(a, p)) {if (other) (result[kind] as Record<string, unknown>)[id] = {...entry, ...other};}
      else if (other === undefined && previous === undefined || same(b, p)) (result[kind] as Record<string, unknown>)[id] = entry;
      else throw new SyncFailure({code:failureCodes.bookChanges,stage:'sync.book-state'},'Bibliotekendringer kan ikke samordnes trygt.');
    }
  }
  for(const id of Object.keys(deleted))delete result.songs[id];
  const names = new Map<string, string>();
  for (const book of Object.values(result.books).filter(b => !b.deleted)) {
    const key = book.name.normalize('NFC').toLocaleLowerCase('nb');
    if (names.has(key) && names.get(key) !== book.id) throw new SyncFailure({code:failureCodes.bookName,stage:'sync.book-name',action:'book-names'},'Flere sangbøker har samme navn.');
    names.set(key, book.id);
  }
  for (const song of Object.values(result.songs)) if (result.books[song.songbookId]?.deleted) throw new SyncFailure({code:failureCodes.bookChanges,stage:'sync.book-state'},'En sangkobling peker på en slettet bok.');
  const fileIds=new Set<string>();
  for(const song of Object.values(result.songs))if(song.fileId){if(fileIds.has(song.fileId))throw new SyncFailure({code:failureCodes.manifest,stage:'sync.manifest'},'Dropbox-filen har flere sangidentiteter.');fileIds.add(song.fileId);}
  return result;
}
