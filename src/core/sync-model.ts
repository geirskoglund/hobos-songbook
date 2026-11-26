import type {Song, SongPersonal} from './song.ts';
import type {FailureInfo, RateInfo} from './failure.ts';
import {journalKey} from './paths.ts';

/** Wire formats deliberately exclude credentials and local operation/session state. */
export interface BookArchive {
  at: string;
  basePath: string;
  path: string;
  parentId: string;
  done?: boolean;
}
export interface BookLink {
  id: string;
  name: string;
  deleted?: boolean;
  folderId?: string;
  path?: string;
  archive?: BookArchive;
}
export interface SongLink {
  id: string;
  songbookId: string;
  origin: Song['origin'];
  fileId?: string;
  path: string;
  originalFile?: {fileId: string; path: string};
}
export interface PersonalFile {
  version: 1;
  songId: string;
  original: {rev: string; hash: string};
  data: SongPersonal;
}
export interface FileValue {
  text: string;
  rev: string;
  id: string;
  path: string;
}
export interface RemoteEntry {
  id?: string;
  path: string;
  folder?: boolean;
  rev?: string;
  deleted?: boolean;
  size?: number;
}
export interface UploadIntent {
  key: string;
  songId: string;
  kind: 'content' | 'personal' | 'original' | 'seed';
  path: string;
  text: string;
  rev: string | null;
  fileId?: string;
  base: {original: string; personal: PersonalFile; link?: SongLink};
}
interface UploadSession {
  id: string;
  created: number;
}
export interface UploadJob extends UploadIntent {
  status: 'planned' | 'committing' | 'done';
  session?: UploadSession;
  value?: FileValue;
  creation?: {
    path: string;
    basePath: string;
    number: number;
    file?: FileValue;
    attempted?: boolean;
    collision?: boolean;
    failure?: FailureInfo;
    discarded?: boolean;
    folderId?: string;
    book?: BookLink;
  };
}
type BeginUploadResult = {session: UploadSession} | {failure: FailureInfo};
export type UploadResult = {value: FileValue} | {failure: FailureInfo; resetSession?: boolean};
export interface MoveEntry {
  key: string;
  from: string;
  to: string;
  fileId: string;
  toReference?: string;
  folder?: boolean;
  link?: SongLink;
  book?: BookLink;
  archive?: {bookId: string; sourcePath: string};
  sourceBookFolderId?: string;
  publication?: {sourcePath: string; rev: string};
}
export type MoveResult =
  | {value: {id: string; path: string; rev?: string; folder?: boolean}}
  | {failure: FailureInfo; collision?: boolean; missing?: boolean; verifyEffect?: boolean};
export type MoveReply = {entries: MoveResult[]} | {asyncJobId: string} | {inProgress: true} | {jobExpired: true};
export interface DeleteEntry {
  key: string;
  path: string;
  fileId: string;
  rev?: string;
  folder?: boolean;
  category: 'personal' | 'staging' | 'folder';
  sourcePath?: string;
  bookId?: string;
}
export interface FolderEntry {
  key: string;
  path: string;
  parentId?: string;
  book?: BookLink;
  temporary?: boolean;
}
interface NamespaceBatchOptions {
  revalidateAfterWait: boolean;
}
export interface RemoteFiles {
  read(path: string, knownPath?: string): Promise<FileValue | null>;
  write(path: string, text: string, rev: string | null): Promise<FileValue>;
  releaseMutation?(text: string, rev: string): Promise<FileValue>;
  beginUpload?(text: string): Promise<UploadSession>;
  beginUploadBatch?(texts: string[]): Promise<BeginUploadResult[]>;
  commitBatch?(jobs: UploadJob[]): Promise<UploadResult[]>;
  moveBatch?(entries: MoveEntry[], retryAttempt?: number, options?: NamespaceBatchOptions): Promise<MoveReply>;
  withMoveReceipt?(work: () => Promise<void>): Promise<void>;
  checkMoveBatch?(id: string, retryAttempt?: number): Promise<MoveReply>;
  deleteBatch?(entries: DeleteEntry[], retryAttempt?: number, options?: NamespaceBatchOptions): Promise<MoveReply>;
  checkDeleteBatch?(id: string, retryAttempt?: number): Promise<MoveReply>;
  createFoldersBatch?(
    entries: FolderEntry[],
    retryAttempt?: number,
    options?: NamespaceBatchOptions,
  ): Promise<MoveReply>;
  checkCreateFoldersBatch?(id: string, retryAttempt?: number): Promise<MoveReply>;
  metadata?(path: string): Promise<RemoteEntry | null>;
  /** Complete, freshly paginated metadata, detached from later local receipts. */
  metadataSnapshot?(): Promise<RemoteEntry[]>;
  inspectFile?(path: string): Promise<FileValue | null>;
  folder(path: string, expectedId?: string, knownMissing?: boolean): Promise<{id: string; path: string}>;
  locateFolder(id: string): Promise<{id: string; path: string} | null>;
  move(from: string, to: string, known?: {id: string; path: string}): Promise<{id: string; path: string}>;
  list(path: string): Promise<{id: string; path: string; folder: boolean}[]>;
  removeEmpty(path: string): Promise<boolean>;
  deleteFile?(path: string, rev: string): Promise<void>;
  deleteFiles?(entries: DeleteEntry[]): Promise<void>;
  changes?(cursor?: string): Promise<{entries: RemoteEntry[]; cursor: string; reset: boolean}>;
}
export interface LocalJournal {
  id: typeof journalKey;
  version: 1;
  generation: number;
  recoveryRequired?: boolean;
  deletedBooks: Record<string, BookLink>;
  sessions: Record<string, {songId: string; edited: boolean}>;
}
export const emptyJournal = (): LocalJournal => ({
  id: journalKey,
  version: 1,
  generation: 0,
  deletedBooks: {},
  sessions: {},
});
export interface ApiContext {
  batchSize?: number;
  resource?: 'personal' | 'staging' | 'folder' | 'content' | 'control' | 'mixed' | 'other';
  requestId?: string;
}
export interface ApiEvent extends RateInfo, ApiContext {
  operation: string;
  status: number;
  durationMs: number;
  retryAttempt?: number;
  entryLimit?: boolean;
  transport?: 'network' | 'abort' | 'timeout';
}
