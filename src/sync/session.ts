import type {syncStorage, SyncSnapshot} from './store.ts';
import {parseManifest, same} from './model.ts';
import type {BookLink, FileValue, FolderEntry, RemoteFiles, SongLink, UploadJob} from '../core/sync-model.ts';
import {emptyManifest, type NamespaceJob, type SyncState, type UploadClaim} from './state.ts';
import {DeferredSync, failureCodes, SyncFailure, RetrySync} from '../core/failure.ts';
import {libraryPath, stagingFolder} from '../core/paths.ts';
import {indexedFiles, pathKey} from './remote.ts';
import {syncIdentities} from './identities.ts';
import {uploadQueue} from './uploads.ts';
import {namespaceQueue} from './namespace.ts';
import {mutationFence} from './mutation.ts';

export class PausedSync extends DeferredSync {
  constructor() {
    super('session', 'Synkronisering er pauset mens en sang er åpen.');
  }
}
export interface SyncHooks {
  valid(): boolean;
  changed(): void;
  failed?(error: unknown): void;
  idle?(): void;
}
type SyncStorage = ReturnType<typeof syncStorage>;
type CommitChanges = Parameters<SyncStorage['commit']>[2];

/**
 * Tilstanden til én synkronisering og operasjonene alle delene av motoren bruker.
 * `start()` leser lokal tilstand på nytt og bygger køene for hver kjøring.
 */
export class SyncSession {
  readonly rawFiles: RemoteFiles;
  files: RemoteFiles;
  index!: ReturnType<typeof indexedFiles>;
  identities!: ReturnType<typeof syncIdentities>;
  uploads!: ReturnType<typeof uploadQueue>;
  namespace!: ReturnType<typeof namespaceQueue>;
  fence!: ReturnType<typeof mutationFence>;
  interruption: unknown;
  removedIds = new Set<string>();
  confirmedLinks: Record<string, SongLink> = {};
  publicationMoves: Set<string> | undefined;
  claims: UploadClaim[] = [];
  snapshot!: SyncSnapshot;
  state!: SyncState;
  generation = 0;
  manualRecovery = false;

  readonly storage: SyncStorage;
  readonly accountId: string;
  readonly hooks: SyncHooks;

  constructor(storage: SyncStorage, files: RemoteFiles, accountId: string, hooks: SyncHooks) {
    this.storage = storage;
    this.rawFiles = files;
    this.files = files;
    this.accountId = accountId;
    this.hooks = hooks;
  }

  valid() {
    return this.hooks.valid();
  }
  async check() {
    if (this.interruption) throw this.interruption;
    if (!this.valid()) throw new PausedSync();
    const latest = this.storage.status ? await this.storage.status() : await this.storage.snapshot(this.accountId);
    if (latest.journal.recoveryRequired && !this.manualRecovery)
      throw new DeferredSync('recovery', 'Lagrede endringer etter avbrudd venter på Synkroniser.');
    if (Object.keys(latest.journal.sessions).length) throw new PausedSync();
    if (latest.journal.generation !== this.generation)
      throw new DeferredSync(
        'changed',
        'Nyere lokale endringer venter. Synkroniseringen må fortsette fra nyeste versjon.',
      );
    if (!this.valid()) throw new PausedSync();
  }
  async step<T>(operation: () => Promise<T>): Promise<T> {
    await this.check();
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      if (
        error instanceof SyncFailure &&
        [failureCodes.changed, failureCodes.missingFolder, failureCodes.missingFile].some(
          code => code === error.info.code,
        )
      )
        throw new RetrySync();
      throw error;
    }
    await this.check();
    return result;
  }
  async parallel<T>(entries: T[], operation: (entry: T) => Promise<void>) {
    let next = 0;
    await Promise.all(
      Array.from({length: Math.min(4, entries.length)}, async () => {
        while (next < entries.length && !this.interruption) {
          const entry = entries[next++];
          try {
            await operation(entry);
          } catch (error) {
            this.interruption = error;
          }
        }
      }),
    );
    if (this.interruption) throw this.interruption;
  }
  async save(changes: CommitChanges = {}) {
    await this.check();
    await this.storage.commit(this.generation, this.state, this.identities.restore(changes), () => this.valid());
    this.hooks.changed();
  }
  async start() {
    const {storage, rawFiles, accountId} = this;
    const check = () => this.check(),
      save = (changes?: CommitChanges) => this.save(changes);
    this.confirmedLinks = {};
    this.interruption = undefined;
    this.snapshot = await storage.snapshot(accountId);
    this.state = this.snapshot.state;
    this.generation = this.snapshot.journal.generation;
    this.identities = syncIdentities(this.snapshot);
    this.snapshot = this.identities.project();
    this.index = indexedFiles(rawFiles, this.state);
    this.namespace = namespaceQueue(this.index.files, this.state, {
      check,
      save,
      retireTemporary: job => this.retireTemporary(job),
      freshList: rawFiles.list,
      find: this.index.find,
      removed: entry => {
        const current = this.index.find(entry.fileId);
        if (entry.category !== 'staging' || (current && pathKey(current.path) === pathKey(entry.path)))
          this.index.forget(entry.fileId);
      },
      receipt: async job => {
        if (storage.transport) await storage.transport(accountId, job);
        else await save();
      },
      moved: (entry, value) => {
        const {state} = this;
        if (entry.link) {
          const link = {...entry.link, fileId: value.id, path: value.path};
          state.reservations[link.id] = link;
          const receipts = entry.publication ? (state.movedPublications ??= {}) : (state.movedSongs ??= {});
          receipts[link.id] = link;
          if (entry.publication) this.publicationMoves?.add(this.identities.localId('songs', link.id));
        }
        if (entry.book) {
          const book = {...entry.book, folderId: value.id, path: value.path};
          state.folders[book.id] = book;
          (state.movedBooks ??= {})[book.id] = book;
        }
      },
    });
    this.files = {
      ...this.index.files,
      folder: this.namespace.folder,
      deleteFiles: this.namespace.remove,
      deleteFile: async (path, rev) => {
        const entry = (await this.index.files.metadata?.(path)) ?? this.index.find(path);
        if (!entry?.id) return;
        await this.namespace.remove([
          {
            key: path,
            path,
            fileId: entry.id,
            rev,
            category: path.startsWith(stagingFolder + '/') ? 'staging' : 'personal',
          },
        ]);
      },
    };
    this.fence = mutationFence(rawFiles, this.state, {check, save});
    this.uploads = uploadQueue(this.files, this.state, {
      check,
      save,
      record: (job, value) => this.recordUpload(job, value),
      receipt: async job => {
        if (storage.placementReceipt) await storage.placementReceipt(accountId, job);
        else await save();
      },
    });
    await check();
  }
  async read(path: string) {
    return this.step(() => this.files.read(path));
  }
  async write(path: string, text: string, rev: string | null) {
    return this.step(() => this.files.write(path, text, rev));
  }
  async folder(path: string, expectedId?: string) {
    return this.step(() => this.files.folder(path, expectedId));
  }
  async retireTemporary(job: NamespaceJob) {
    const {state} = this;
    const remote = structuredClone(state.library?.value ?? emptyManifest());
    for (const [i, entry] of (job.entries as FolderEntry[]).entries()) {
      const marker: BookLink = {id: `retired-${job.id}-${i}`, name: entry.book!.name, path: entry.path, deleted: true},
        known = remote.books[marker.id];
      if (known && !same(known, marker))
        throw new SyncFailure(
          {code: failureCodes.manifest, stage: 'sync.namespace', action: 'mutation-state'},
          'Reservasjonen av den midlertidige stien er endret.',
        );
      remote.books[marker.id] = marker;
    }
    // No physical folder is adopted, moved or removed. A late create can make
    // this retired path and missing parents, never move an existing identity.
    const text = JSON.stringify(remote);
    parseManifest(text);
    if (!same(remote, state.library?.value)) await this.write(libraryPath, text, state.library?.rev ?? null);
    await this.save();
  }
  recordUpload(job: UploadJob, value: FileValue) {
    const {state} = this;
    if (job.kind === 'seed') return;
    if (job.kind === 'original') {
      (state.originals ??= {})[job.songId] = true;
      const link = state.reservations[job.songId] ?? state.manifest.songs[job.songId];
      if (link && !link.originalFile)
        state.reservations[job.songId] = {...link, originalFile: {fileId: value.id, path: value.path}};
      return;
    }
    const old = state.bases[job.songId];
    if (job.kind === 'content') {
      const link = state.reservations[job.songId] ?? state.manifest.songs[job.songId];
      if (link) {
        const confirmed = {...link, ...job.base.link, fileId: value.id, path: value.path};
        state.reservations[job.songId] = confirmed;
        this.confirmedLinks[job.songId] = confirmed;
      }
      state.bases[job.songId] = {
        original: job.text,
        contentRev: value.rev,
        personal: old?.personal ?? job.base.personal,
        personalRev: old?.personalRev ?? '',
      };
    } else
      state.bases[job.songId] = {
        original: job.base.original,
        contentRev: job.base.personal.original.rev,
        personal: job.base.personal,
        personalRev: value.rev,
      };
  }
}
