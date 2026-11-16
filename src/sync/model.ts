import {cleanPersonal} from '../domain/annotations.ts';
import type {Song, SongPersonal} from '../domain/song.ts';

/** Wire formats deliberately exclude credentials and local operation/session state. */
export interface BookLink {id: string; name: string; deleted?: boolean; folderId?: string; path?: string}
export interface SongLink {id: string; songbookId: string; origin: Song['origin']; fileId?: string; path: string}
export interface Manifest {version: 1; books: Record<string, BookLink>; songs: Record<string, SongLink>}
export interface PersonalFile {version: 1; songId: string; original: {rev: string; hash: string}; data: SongPersonal}
export interface FileValue {text: string; rev: string; id: string; path: string}
export interface RemoteFiles {
  read(path: string): Promise<FileValue | null>;
  write(path: string, text: string, rev: string | null): Promise<FileValue>;
  folder(path: string): Promise<{id: string; path: string}>;
  move(from: string, to: string): Promise<{id: string; path: string}>;
  list(path: string): Promise<{id: string; path: string; folder: boolean}[]>;
  removeEmpty(path: string): Promise<boolean>;
}
export interface SongBase {original: string; personal: PersonalFile; contentRev: string; personalRev: string}
export interface Conflict {songId: string; kind: 'content' | 'personal'; title: string; local: Song; localPersonal: SongPersonal; remote: Song; remotePersonal: SongPersonal; remotePersonalOriginal: string; contentRev: string; personalRev: string; personalFile: PersonalFile; generation: number}
export interface SyncState {
  id: string; version: 1; accountId: string; manifest: Manifest; bases: Record<string, SongBase>;
  conflicts: Conflict[]; pending: boolean; awaitingDownload?: boolean; localGeneration?: number; error?: string; lastManual?: string;
  // Durable reservations make retry after a lost response use the same names/identities.
  decisions: Record<string, {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}>;
  reservations: Record<string, SongLink>; folders: Record<string, BookLink>;
}
export interface LocalJournal {id: 'private-local-v1'; version: 1; generation: number; deletedBooks: Record<string, BookLink>; sessions: Record<string, {songId: string; edited: boolean}>}
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
export function parseManifest(text: string): Manifest {
  const value = JSON.parse(text);
  if (value?.version !== 1 || !value.books || !value.songs || Array.isArray(value.books) || Array.isArray(value.songs)) throw new Error('Ukjent eller skadet Dropbox-bibliotek. Ingen data overskrives.');
  for (const [id, book] of Object.entries(value.books) as [string, BookLink][]) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || book.id !== id || !book.name || /[\\/]/.test(book.name) || book.path && !book.path.toLowerCase().startsWith('/songbooks/')) throw new Error('Ugyldig sangbokmetadata i Dropbox.');
  }
  for (const [id, song] of Object.entries(value.songs) as [string, SongLink][]) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || song.id !== id || !song.origin || !value.books[song.songbookId] || !/^\/Songbooks\/[^/]+\/Private\/[^/]+\.cho$/i.test(song.path)) throw new Error('Ugyldig sangkobling i Dropbox.');
  }
  return value;
}
export function parsePersonal(text: string, songId: string): PersonalFile {
  const value = JSON.parse(text);
  if (value?.version !== 1 || value.songId !== songId || value.data?.songId !== songId || value.data.version !== 3 || !value.data.chorus || typeof value.original?.rev !== 'string' || !/^[0-9a-f]{64}$/.test(value.original.hash)) throw new Error('Personfilen mangler gyldig originalreferanse. Ingen persondata overskrives.');
  if (!same(value.data, personalData(value.data))) throw new Error('Personfilen inneholder ugyldige data. Ingen persondata overskrives.');
  return value;
}
function logicalBook(book: BookLink | undefined) {return book && {id: book.id, name: book.name, deleted: Boolean(book.deleted)};}
function logicalSong(song: SongLink | undefined) {return song && {id: song.id, songbookId: song.songbookId, origin: song.origin};}
/** Per-identity three-way merge; absence in a local snapshot never deletes remote identities. */
export function mergeManifest(base: Manifest, local: Manifest, remote: Manifest): Manifest {
  const result: Manifest = structuredClone(remote);
  for (const [kind, logical] of [['books', logicalBook], ['songs', logicalSong]] as const) {
    for (const [id, entry] of Object.entries(local[kind])) {
      const previous = base[kind][id], other = remote[kind][id];
      const a = logical(entry as never), b = logical(other as never), p = logical(previous as never);
      if (same(a, b) || same(a, p)) {if (other) (result[kind] as Record<string, unknown>)[id] = {...entry, ...other};}
      else if (other === undefined && previous === undefined || same(b, p)) (result[kind] as Record<string, unknown>)[id] = entry;
      else throw new Error(`Sangbok- eller bibliotekendringer for «${'name' in entry ? entry.name : entry.origin.filename}» kan ikke samordnes trygt. Begge versjoner er beholdt.`);
    }
  }
  const names = new Map<string, string>();
  for (const book of Object.values(result.books).filter(b => !b.deleted)) {
    const key = book.name.normalize('NFC').toLocaleLowerCase('nb');
    if (names.has(key) && names.get(key) !== book.id) throw new Error(`Flere sangbøker heter «${book.name}». Endre navn lokalt før du synkroniserer. Ingen bøker er slått sammen.`);
    names.set(key, book.id);
  }
  for (const song of Object.values(result.songs)) if (result.books[song.songbookId]?.deleted) throw new Error('Sangboktilordningen er endret på en annen enhet. Ingen sanger overskrives.');
  return result;
}
