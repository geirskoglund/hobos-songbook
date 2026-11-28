// Synkens egen tilstand: biblioteket i Dropbox, synktilstanden per konto og
// jobbene den holder rede på. Typene som også storage/ og adapters/ bruker,
// ligger i core/sync-model.ts.
import type {Song, SongPersonal} from '../core/song.ts';
import type {FailureInfo} from '../core/failure.ts';
import {syncStateKey} from '../core/paths.ts';
import type {
  BookArchive,
  BookLink,
  DeleteEntry,
  FolderEntry,
  MoveEntry,
  MoveReply,
  PersonalFile,
  RemoteEntry,
  SongLink,
  UploadJob,
} from '../core/sync-model.ts';

export interface DeletedSong {
  id: string;
  fileId?: string;
  songbookId?: string;
}
export interface Manifest {
  version: 1;
  books: Record<string, BookLink>;
  songs: Record<string, SongLink>;
  deletedSongs?: Record<string, DeletedSong>;
}
type NamespaceEntry = MoveEntry | DeleteEntry | FolderEntry;
export interface NamespaceJob {
  id: string;
  kind: 'move' | 'delete' | 'folders';
  entries: NamespaceEntry[];
  submitted?: boolean;
  jobId?: string;
  attempt: number;
  reply?: MoveReply;
  quarantinedParents?: string[];
}
export interface PlacementJob {
  id?: string;
  entries: MoveEntry[];
  jobId?: string;
  retryAttempt?: number;
  reply?: MoveReply;
}
interface RemoteIndex {
  cursor: string;
  entries: Record<string, RemoteEntry>;
  beforeUpdates?: Record<string, RemoteEntry | null>;
  epoch?: number;
}
interface SongBase {
  original: string;
  personal: PersonalFile;
  contentRev: string;
  personalRev: string;
}
export interface Conflict {
  songId: string;
  kind: 'content' | 'personal';
  title: string;
  local: Song;
  localPersonal: SongPersonal;
  remote: Song;
  remotePersonal: SongPersonal;
  remotePersonalOriginal: string;
  contentRev: string;
  personalRev: string;
  personalFile: PersonalFile;
  generation: number;
}
/** One file in an import's shared folder and the song it was fetched to (#101 F13). */
export interface ImportSourceFile {
  songId: string;
  /** Path relative to the shared folder, as the source shows it: `/Viser/Sang.cho`. */
  path: string;
  /** The source's content_hash. */
  hash: string;
  /** The copy in the songbook's Import folder and the source hash it was written from. */
  own?: {id: string; rev: string; hash: string};
  /** Removed from the source; the song is kept (#101 F12). */
  gone?: boolean;
}
export interface ImportSource {
  files: Record<string, ImportSourceFile>;
  /** Listed folders by path key, with the cursor that continues each listing. */
  folders: Record<string, {path: string; cursor: string}>;
}
/** /.app/import-state.json */
export interface ImportStateFile {
  version: 1;
  imports: Record<string, ImportSource>;
}
export interface SyncState {
  id: string;
  version: 1;
  accountId: string;
  manifest: Manifest;
  bases: Record<string, SongBase>;
  conflicts: Conflict[];
  pending: boolean;
  awaitingDownload?: boolean;
  localGeneration?: number;
  error?: string;
  lastManual?: string;
  failure?: FailureInfo;
  // Durable reservations make retry after a lost response use the same names/identities.
  decisions: Record<string, {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}>;
  renames?: Record<string, {from: string; to: string}>;
  reservations: Record<string, SongLink>;
  folders: Record<string, BookLink>;
  remote?: RemoteIndex;
  library?: {rev: string; id: string; value: Manifest};
  originals?: Record<string, boolean>;
  uploads?: Record<string, UploadJob>;
  placement?: PlacementJob;
  namespaceJob?: NamespaceJob;
  mutationOwner?: string;
  mutationFileId?: string;
  mutationPending?: boolean;
  movedSongs?: Record<string, SongLink>;
  movedPublications?: Record<string, SongLink>;
  movedBooks?: Record<string, BookLink>;
  createdBooks?: Record<string, BookLink>;
  abandoned?: {path: string; fileId?: string; rev?: string}[];
  cleanupProofs?: Record<string, string>;
  cleanupPending?: boolean;
  archivePending?: boolean;
  archiveIntents?: Record<string, Omit<BookArchive, 'done'> & {folderId: string}>;
  uploadIndex?: {id: string; rev: string; value: UploadIndex};
  skipped?: Record<string, boolean>;
  held?: Record<string, boolean>;
  joined?: boolean;
  publicationContent?: Record<string, {rev: string; title: string; key: string | null; time: string | null}>;
  // Account-local links preserve local IDs while using one cloud identity.
  bindings?: {books: Record<string, string>; songs: Record<string, string>};
  /** The last read import state file, and each import's fetch status on this device (#101 F15). */
  sharedImports?: {
    file?: {id: string; rev: string; value: ImportStateFile};
    status: Record<string, {synced?: string; failed?: boolean}>;
  };
}
export const emptyManifest = (): Manifest => ({version: 1, books: {}, songs: {}});
export const newSyncState = (accountId: string): SyncState => ({
  id: syncStateKey(accountId),
  version: 1,
  accountId,
  manifest: emptyManifest(),
  bases: {},
  conflicts: [],
  pending: true,
  decisions: {},
  reservations: {},
  folders: {},
});
export interface UploadClaim {
  operationId: string;
  role: 'content' | 'original';
  song: SongLink;
  book: BookLink;
  stagePath: string;
  target: string;
  fileId: string;
  rev: string;
}
export interface UploadIndex {
  version: 1;
  entries: Record<string, UploadClaim>;
  libraryRev?: string | null;
}
