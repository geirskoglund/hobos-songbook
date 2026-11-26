import {
  DeferredSync,
  SubmittedBatchInterruption,
  RetrySync,
  SyncFailure,
  failureCodes,
  BatchJobFailed,
  BatchRateRejected,
  UnsentBatch,
  NamespacePlanNeedsRefresh,
  BatchStatusUnconfirmed,
  PublicationInProgress,
} from '../core/failure.ts';
import {metadataView, pathKey} from './remote.ts';
import {ownSong, songLocation} from './model.ts';
import type {
  DeleteEntry,
  FolderEntry,
  MoveEntry,
  MoveReply,
  MoveResult,
  NamespaceJob,
  RemoteEntry,
  RemoteFiles,
  SyncState,
} from '../core/sync-model.ts';

type Hooks = {
  check(): Promise<void>;
  save(): Promise<void>;
  receipt(job: NamespaceJob): Promise<void>;
  retireTemporary?(job: NamespaceJob): Promise<void>;
  freshList: RemoteFiles['list'];
  find(path: string): RemoteEntry | undefined;
  removed(entry: DeleteEntry): void;
  moved(entry: MoveEntry, value: {id: string; path: string}): void;
};
class MissingCreatedFolder extends Error {}
const publicationJob = (job: NamespaceJob) =>
  job.kind === 'move' && job.entries.some(item => Boolean((item as MoveEntry).publication));
/** One persisted namespace mutation at a time. Completion receipts never
 * acknowledge a newer generation. Deletes use ID+rev; staging uses its nonce
 * literal path. Unknown ID-move/create launches are never blindly replayed. */
export function namespaceQueue(files: RemoteFiles, state: SyncState, hooks: Hooks) {
  const size = 100;
  let view: ReturnType<typeof metadataView> | undefined;
  const fallback = new Map<string, RemoteEntry | null>();
  async function refresh() {
    await hooks.check();
    view = undefined;
    fallback.clear();
    if (files.metadataSnapshot) view = metadataView(await files.metadataSnapshot());
    await hooks.check();
  }
  const inspect = async (path: string): Promise<RemoteEntry | null> => {
    await hooks.check();
    if (view) return view.find(path) ?? null;
    const key = path.startsWith('id:') ? path : pathKey(path);
    if (!fallback.has(key))
      fallback.set(
        key,
        files.metadata
          ? await files.metadata(path)
          : await files.locateFolder(path).then(value => (value ? {...value, folder: true} : null)),
      );
    await hooks.check();
    return fallback.get(key)!;
  };
  const nonempty = async (path: string) => (view ? view.nonempty(path) : Boolean((await hooks.freshList(path)).length));
  const stage = (kind: NamespaceJob['kind']) => `dropbox.${kind === 'move' ? 'move' : kind}-batch`;
  const bad = (kind: NamespaceJob['kind'], message: string) =>
    new SyncFailure({code: failureCodes.response, stage: stage(kind)}, message);
  const invalid = () =>
    new SyncFailure(
      {code: failureCodes.manifest, stage: 'sync.namespace', action: 'mutation-state'},
      'Ugyldig fullmakt i batchjournalen.',
    );
  const knownBooks = () => ({...state.manifest.books, ...state.folders, ...state.library?.value.books});
  async function publicationTarget(entry: MoveEntry) {
    const target = songLocation(entry.to)!,
      parent = await inspect(entry.toReference!.split('/')[0]);
    const book = knownBooks()[entry.link!.songbookId];
    if (!parent?.folder || !parent.path.toLowerCase().endsWith('/' + target.area.toLowerCase())) return null;
    const root = await inspect(parent.path.slice(0, parent.path.lastIndexOf('/')));
    if (!root?.folder || root.id !== book?.folderId || book.deleted || !/^\/Songbooks\/[^/]+$/i.test(root.path))
      return null;
    return {path: `${parent.path}/${target.name}`, bookPath: root.path};
  }
  async function authorize(job: NamespaceJob) {
    if (
      !job ||
      !['move', 'delete', 'folders'].includes(job.kind) ||
      typeof job.id !== 'string' ||
      !Array.isArray(job.entries) ||
      !job.entries.length ||
      job.entries.length > size ||
      !Number.isInteger(job.attempt) ||
      job.attempt < 0 ||
      job.attempt > 2
    )
      throw invalid();
    const manifest = state.library?.value,
      books = knownBooks(),
      publishing = publicationJob(job);
    for (const item of job.entries) {
      if (!item || typeof item.key !== 'string') throw invalid();
      if (job.kind === 'delete') {
        const entry = item as DeleteEntry;
        if (typeof entry.fileId !== 'string' || !entry.fileId || typeof entry.path !== 'string') throw invalid();
        if (entry.category === 'personal') {
          const id = /^personal:([a-zA-Z0-9_-]{1,128})$/.exec(entry.key)?.[1];
          if (
            !id ||
            !manifest?.deletedSongs?.[id] ||
            entry.sourcePath !== `/.app/songs/${id}.json` ||
            entry.path !== entry.fileId ||
            !entry.rev ||
            entry.folder
          )
            throw invalid();
          const actual = await inspect(entry.fileId);
          if (actual && (actual.folder || pathKey(actual.path) !== pathKey(entry.sourcePath))) throw invalid();
        } else if (entry.category === 'staging') {
          if (
            !/^\/\.app\/uploads\/[a-f0-9-]{36}\.cho$/.test(entry.path) ||
            entry.folder ||
            !entry.rev ||
            (!Object.values(state.uploads ?? {}).some(upload => upload.creation?.path === entry.path) &&
              !state.abandoned?.some(row => row.path === entry.path))
          )
            throw invalid();
          const actual = await inspect(entry.path);
          if (actual && (actual.id !== entry.fileId || actual.folder)) throw invalid();
        } else if (entry.category === 'folder') {
          if (!entry.folder || entry.rev || entry.path !== entry.fileId || typeof entry.sourcePath !== 'string')
            throw invalid();
          if (!/^\/Songbooks\/[^/]+(?:\/(?:Private|Shared|Import|Originals))?$/i.test(entry.sourcePath))
            throw invalid();
          const rootPath = entry.sourcePath.split('/').slice(0, 3).join('/'),
            root = await inspect(rootPath);
          const book = Object.values(manifest?.books ?? {}).find(
            book =>
              book.deleted &&
              book.folderId &&
              (entry.bookId
                ? book.id === entry.bookId
                : root?.id === book.folderId || (book.path && pathKey(rootPath) === pathKey(book.path))),
          );
          if (root && root.id !== book?.folderId) throw invalid();
          if (!book) throw invalid();
          const actual = await inspect(entry.fileId);
          if (actual) {
            if (!actual.folder || pathKey(actual.path) !== pathKey(entry.sourcePath)) throw invalid();
            if (pathKey(actual.path) === pathKey(rootPath)) {
              if (actual.id !== book.folderId) throw invalid();
            } else if ((await inspect(actual.path.slice(0, actual.path.lastIndexOf('/'))))?.id !== book.folderId)
              throw invalid();
          }
        } else throw invalid();
      } else if (job.kind === 'move') {
        const entry = item as MoveEntry;
        if (typeof entry.fileId !== 'string' || entry.from !== entry.fileId || typeof entry.to !== 'string')
          throw invalid();
        if (publishing !== Boolean(entry.publication)) throw invalid();
        if (entry.publication) {
          const link = entry.link,
            known = link && (manifest?.songs[link.id] ?? state.reservations[link.id] ?? state.manifest.songs[link.id]);
          const source = songLocation(entry.publication.sourcePath),
            target = songLocation(entry.to),
            reference = entry.toReference?.split('/');
          if (
            entry.folder ||
            entry.book ||
            entry.archive ||
            !known ||
            !ownSong(known) ||
            known.fileId !== entry.fileId ||
            known.songbookId !== link?.songbookId ||
            !books[known.songbookId]?.folderId ||
            !source ||
            !target ||
            source.area === target.area ||
            pathKey(source.bookPath) !== pathKey(target.bookPath) ||
            !entry.publication.rev ||
            reference?.length !== 2 ||
            !reference[0].startsWith('id:') ||
            reference[1] !== target.name
          )
            throw invalid();
          continue;
        }
        if (entry.archive) {
          const archive = entry.archive,
            book = manifest?.books[archive.bookId],
            intent = book?.archive,
            parent = intent && (await inspect(intent.parentId)),
            actual = await inspect(entry.fileId);
          if (
            !entry.folder ||
            entry.book ||
            entry.link ||
            !book?.deleted ||
            book.folderId !== entry.fileId ||
            !intent ||
            intent.done ||
            entry.to !== intent.path ||
            entry.toReference !== intent.parentId + '/' + intent.path.split('/').at(-1) ||
            !parent?.folder ||
            pathKey(parent.path) !== '/deleted' ||
            !/^\/Songbooks\/[^/]+$/i.test(archive.sourcePath)
          )
            throw invalid();
          if (
            actual &&
            (!actual.folder ||
              (pathKey(actual.path) !== pathKey(archive.sourcePath) &&
                !(job.submitted && pathKey(actual.path) === pathKey(intent.path))))
          )
            throw new SyncFailure(
              {code: failureCodes.bookChanges, stage: 'sync.namespace', action: 'check-move'},
              'Arkivkilden er endret.',
            );
          if (
            Object.values(manifest!.songs).some(link => {
              const current = view ? view.find(link.fileId ?? link.path) : hooks.find(link.fileId ?? link.path);
              return (
                link.songbookId === book.id ||
                (current && pathKey(current.path).startsWith(pathKey(archive.sourcePath) + '/'))
              );
            })
          )
            throw invalid();
        } else if (entry.folder) {
          const book = Object.values(books).find(book => book.folderId === entry.fileId);
          if (!book || (entry.book && entry.book.id !== book.id) || !/^\/Songbooks\/[^/]+$/.test(entry.to))
            throw invalid();
        } else {
          const link = entry.link,
            known = link && (state.reservations[link.id] ?? manifest?.songs[link.id] ?? state.manifest.songs[link.id]);
          if (
            !link ||
            known?.fileId !== entry.fileId ||
            !books[link.songbookId] ||
            !/^\/Songbooks\/[^/]+\/Private\/[^/]+\.cho$/i.test(entry.to) ||
            !entry.toReference
          )
            throw invalid();
          const parent = await inspect(entry.toReference.split('/')[0]),
            book = books[link.songbookId];
          if (
            !parent?.folder ||
            (await inspect(parent.path.slice(0, parent.path.lastIndexOf('/'))))?.id !== book.folderId ||
            parent.path.split('/').at(-1)!.toLowerCase() !== 'private'
          )
            throw invalid();
        }
      } else {
        const entry = item as FolderEntry;
        if (
          typeof entry.path !== 'string' ||
          !/^\/(?:Deleted|\.app(?:\/(?:songs|uploads))?|Songbooks(?:\/[^/]+(?:\/(?:Private|Shared|Import|Originals))?)?)$/i.test(
            entry.path,
          )
        )
          throw invalid();
        const match = /^\/Songbooks\/([^/]+)/i.exec(entry.path);
        if (
          match &&
          !Object.values(books).some(
            book => pathKey(book.path ?? `/Songbooks/${book.name}`) === pathKey('/Songbooks/' + match[1]),
          )
        )
          throw invalid();
        if (entry.book) {
          const intent = state.renames?.[entry.book.id],
            base = `/Songbooks/.rename-${entry.book.id}`,
            staged =
              entry.temporary &&
              intent?.from === entry.path &&
              intent.to === `/Songbooks/${entry.book.name}` &&
              (entry.path === base ||
                (entry.path.startsWith(base + '-') && /^\d+$/.test(entry.path.slice(base.length + 1))));
          if (!books[entry.book.id] || (entry.path !== `/Songbooks/${entry.book.name}` && !staged)) throw invalid();
        } else if (entry.temporary) throw invalid();
      }
    }
  }
  async function receipt(job: NamespaceJob, reply: MoveReply) {
    job.reply = reply;
    if ('asyncJobId' in reply) job.jobId = reply.asyncJobId;
    await hooks.receipt(job);
    await hooks.check();
  }
  async function verifyFolder(entry: FolderEntry, value: {id: string; path: string}) {
    // A newly confirmed empty folder may be absent from an incomplete/lagging
    // listing. Resolve that receipt by ID rather than declaring it deleted.
    const current = (await inspect(value.id)) ?? (await files.metadata?.(value.id));
    await hooks.check();
    if (!current) throw new MissingCreatedFolder();
    if (!current.folder) throw bad('folders', 'Opprettingskvitteringen viser ikke en mappe.');
    const actual: RemoteEntry = current;
    if (entry.parentId) {
      const parent = await inspect(actual.path.slice(0, actual.path.lastIndexOf('/')));
      if (parent?.id !== entry.parentId) {
        if (parent?.id) {
          const job = state.namespaceJob!;
          job.quarantinedParents = [...new Set([...(job.quarantinedParents ?? []), parent.id])];
          await hooks.save();
        }
        throw new SyncFailure(
          {code: failureCodes.bookChanges, stage: 'sync.namespace', action: 'check-folders'},
          'Mappen ble opprettet under en annen forelder.',
        );
      }
    }
    return {id: value.id, path: actual.path, folder: true};
  }
  async function apply(job: NamespaceJob, reply: MoveReply, fresh = false, active = false): Promise<boolean> {
    if ('asyncJobId' in reply || 'inProgress' in reply) {
      delete job.reply;
      await hooks.save();
      return false;
    }
    if ('jobExpired' in reply) {
      delete job.jobId;
      delete job.reply;
      await hooks.save();
      return false;
    }
    if (reply.entries.length !== job.entries.length) throw bad(job.kind, 'Ufullstendig batchkvittering.');
    // The whole transport receipt was persisted before this network/guard boundary.
    const publishing = publicationJob(job);
    if (!fresh && (job.kind !== 'delete' || reply.entries.some(result => 'missing' in result && result.missing))) {
      if (publishing && files.withMoveReceipt) await files.withMoveReceipt(refresh);
      else await refresh();
    }
    let failure: MoveResult | undefined,
      missingCreation = false;
    const retry: NamespaceJob['entries'] = [],
      limited: NamespaceJob['entries'] = [];
    for (let i = 0; i < job.entries.length; i++) {
      const entry = job.entries[i],
        result = reply.entries[i];
      if (job.kind === 'delete') {
        const deletion = entry as DeleteEntry;
        if ('value' in result && result.value.id !== deletion.fileId)
          throw bad(job.kind, 'Sletting bekreftet en annen filidentitet.');
        if ('failure' in result && result.missing && deletion.category !== 'staging') {
          const remaining = await inspect(deletion.fileId);
          if (remaining) {
            failure = {failure: {code: failureCodes.changed, stage: stage('delete')}, collision: true};
            retry.push(entry);
            continue;
          }
        }
        if ('value' in result || result.missing) {
          hooks.removed(deletion);
          continue;
        }
      } else if (job.kind === 'folders') {
        const creation = entry as FolderEntry;
        if ('value' in result) {
          try {
            const value = await verifyFolder(creation, result.value);
            if (creation.book) {
              (state.createdBooks ??= {})[creation.book.id] = {
                ...creation.book,
                folderId: value.id,
                path: creation.path,
              };
              state.folders[creation.book.id] = {
                ...creation.book,
                folderId: value.id,
                path: value.path,
                name: creation.temporary ? creation.book.name : value.path.split('/').at(-1)!,
              };
              if (pathKey(value.path) !== pathKey(creation.path)) missingCreation = true;
            }
          } catch (error) {
            if (!(error instanceof MissingCreatedFolder)) throw error;
            missingCreation = true;
            if (creation.book)
              state.folders[creation.book.id] = {
                ...creation.book,
                folderId: result.value.id,
                path: result.value.path || creation.path,
              };
          }
          continue;
        }
        if (result.collision) {
          if (creation.temporary) {
            missingCreation = true;
            continue;
          }
          const actual = await inspect(creation.path);
          if (actual?.folder) {
            await verifyFolder(creation, {id: actual.id!, path: actual.path});
            if (creation.book)
              state.folders[creation.book.id] = {...creation.book, folderId: actual.id, path: actual.path};
            continue;
          }
        }
      } else if ('value' in result || (publishing && result.verifyEffect)) {
        const move = entry as MoveEntry;
        if ('value' in result && result.value.id !== move.fileId)
          throw bad(job.kind, 'Flytting bekreftet en annen identitet.');
        const actual = await inspect(move.fileId);
        if (publishing) {
          const target = await publicationTarget(move);
          if (actual?.id === move.fileId && !actual.folder && target && pathKey(actual.path) === pathKey(target.path))
            hooks.moved(move, {id: move.fileId, path: actual.path});
          continue;
        }
        if (!actual) {
          failure = {failure: {code: failureCodes.changed, stage: stage(job.kind)}};
          continue;
        }
        const path = actual.path;
        hooks.moved(move, {id: move.fileId, path});
        if (pathKey(path) !== pathKey(move.to))
          failure = {failure: {code: failureCodes.changed, stage: stage(job.kind)}};
        continue;
      } else if (job.kind === 'move' && result.missing) {
        await inspect((entry as MoveEntry).fileId);
        failure = {failure: {code: failureCodes.changed, stage: stage('move')}};
        continue;
      }
      if (result.failure.code === failureCodes.throttled) limited.push(entry);
      failure ??= result;
      retry.push(entry);
    }
    delete state.namespaceJob;
    await hooks.save();
    if (missingCreation) throw new RetrySync();
    if (publishing) {
      if (active && limited.length && job.attempt < 2) {
        state.namespaceJob = {id: crypto.randomUUID(), kind: 'move', entries: limited, attempt: job.attempt + 1};
        await hooks.save();
        await recover(true);
      }
      if (active && limited.length && job.attempt >= 2)
        throw new SyncFailure(
          {code: failureCodes.throttled, stage: stage('move'), status: 200, limitReason: 'too_many_write_operations'},
          'Dropbox begrenser flyttingene.',
        );
      if (active && reply.entries.some(result => 'failure' in result && result.collision)) throw new RetrySync();
      return true;
    }
    if (failure && 'failure' in failure) {
      if (
        failure.failure.code === failureCodes.throttled &&
        job.attempt < 2 &&
        reply.entries.every(
          result => 'value' in result || result.missing || result.failure.code === failureCodes.throttled,
        )
      ) {
        state.namespaceJob = {id: crypto.randomUUID(), kind: job.kind, entries: retry, attempt: job.attempt + 1};
        await hooks.save();
        await recover(true);
        return true;
      }
      if (failure.collision || failure.failure.code === failureCodes.changed) throw new RetrySync();
      throw new SyncFailure(failure.failure, 'En batchoperasjon er ikke fullført.');
    }
    return true;
  }
  async function observeUnknown(job: NamespaceJob, requireMoveProof = false) {
    // A lost nonce-folder create cannot overwrite or move any existing ID. Once
    // every old path is durably reserved, a fresh nonce may be used. Never reuse
    // this rule for ID moves, mixed batches or a job with a usable receipt/ID.
    if (
      job.kind === 'folders' &&
      !job.jobId &&
      !job.reply &&
      job.entries.every(entry => (entry as FolderEntry).temporary) &&
      hooks.retireTemporary
    ) {
      await hooks.retireTemporary(job);
      await hooks.check();
      delete state.namespaceJob;
      await hooks.save();
      throw new RetrySync();
    }
    const entries: MoveResult[] = [];
    if (publicationJob(job)) {
      for (const entry of job.entries as MoveEntry[]) {
        const target = await publicationTarget(entry),
          actual = await inspect(entry.fileId);
        if (actual?.id === entry.fileId && !actual.folder && target && pathKey(actual.path) === pathKey(target.path)) {
          hooks.moved(entry, {id: entry.fileId, path: actual.path});
          entries.push({value: {id: entry.fileId, path: actual.path, rev: actual.rev}});
        }
      }
      if (entries.length === job.entries.length) return apply(job, {entries}, true);
      await hooks.save();
      throw new SyncFailure(
        {code: failureCodes.changed, stage: stage('move'), action: 'check-move'},
        'Dropbox har ennå ikke bekreftet alle flyttingene.',
      );
    }
    for (const item of job.entries) {
      if (job.kind === 'move') {
        const entry = item as MoveEntry,
          actual = await inspect(entry.fileId);
        if (!actual) {
          if (entry.archive || requireMoveProof)
            throw new SyncFailure(
              {code: failureCodes.changed, stage: 'sync.namespace', action: 'check-move'},
              'Flyttingen er fortsatt uavklart.',
            );
          entries.push({failure: {code: failureCodes.missingFile, stage: stage('move')}, missing: true});
          continue;
        }
        const reference = entry.toReference?.split('/')[0],
          parent = reference ? (hooks.find(reference) ?? (await inspect(reference))) : null;
        const target = parent ? parent.path + '/' + entry.to.split('/').at(-1) : entry.to;
        if (
          actual.id !== entry.fileId ||
          Boolean(actual.folder) !== Boolean(entry.folder) ||
          (requireMoveProof && reference && (!parent?.folder || parent.id !== reference)) ||
          pathKey(actual.path) !== pathKey(target)
        )
          throw new SyncFailure(
            {code: failureCodes.changed, stage: 'sync.namespace', action: 'check-move'},
            'Flyttingen er fortsatt uavklart.',
          );
        entries.push({value: {id: entry.fileId, path: actual.path, folder: actual.folder, rev: actual.rev}});
      } else if (job.kind === 'delete') {
        const entry = item as DeleteEntry,
          reference = entry.category === 'staging' ? entry.path : entry.fileId;
        if (await inspect(reference))
          throw new SyncFailure(
            {code: failureCodes.changed, stage: stage('delete')},
            'Dropbox har ennå ikke bekreftet alle slettingene.',
          );
        entries.push({failure: {code: failureCodes.missingFile, stage: stage('delete')}, missing: true});
      } else {
        const entry = item as FolderEntry,
          actual = await inspect(entry.path);
        if (entry.temporary)
          throw new SyncFailure(
            {code: failureCodes.changed, stage: 'sync.namespace', action: 'check-folders'},
            'Opprettelsen av den midlertidige bokmappen er fortsatt uavklart.',
          );
        if (!actual?.folder || !actual.id)
          throw new SyncFailure(
            {code: failureCodes.changed, stage: 'sync.namespace', action: 'check-folders'},
            'Mappeopprettelsen er fortsatt uavklart.',
          );
        entries.push({value: {id: actual.id, path: actual.path, folder: true}});
      }
    }
    return apply(job, {entries}, true);
  }
  async function launch(job: NamespaceJob, authorized: boolean, active: boolean, revalidations: number) {
    await hooks.check();
    if (!authorized) {
      await refresh();
      await authorize(job);
    }
    if (job.submitted && job.kind !== 'delete') return observeUnknown(job);
    if (publicationJob(job)) {
      const safe: MoveEntry[] = [];
      for (const entry of job.entries as MoveEntry[]) {
        const target = await publicationTarget(entry),
          actual = await inspect(entry.fileId);
        if (!target || !actual || actual.folder) continue;
        if (pathKey(actual.path) === pathKey(target.path)) {
          hooks.moved(entry, {id: entry.fileId, path: actual.path});
          continue;
        }
        const source = songLocation(entry.publication!.sourcePath)!;
        const occupied = await inspect(target.path);
        if (
          !occupied &&
          actual.rev === entry.publication!.rev &&
          pathKey(actual.path) === pathKey(`${target.bookPath}/${source.area}/${source.name}`)
        )
          safe.push(entry);
      }
      if (!safe.length) {
        delete state.namespaceJob;
        await hooks.save();
        return true;
      }
      job.entries = safe;
    } else if (job.kind === 'move')
      for (const entry of job.entries as MoveEntry[])
        if (entry.sourceBookFolderId) {
          const actual = await inspect(entry.fileId),
            location = actual && !actual.folder && songLocation(actual.path);
          const source = location && (await inspect(location.bookPath));
          if (!source || source.id !== entry.sourceBookFolderId) {
            delete state.namespaceJob;
            await hooks.save();
            throw new RetrySync();
          }
        }
    if (job.kind === 'folders')
      for (const entry of job.entries as FolderEntry[])
        if (entry.parentId) {
          const parent = await inspect(entry.parentId);
          if (!parent || pathKey(parent.path) !== pathKey(entry.path.slice(0, entry.path.lastIndexOf('/')))) {
            delete state.namespaceJob;
            await hooks.save();
            throw new RetrySync();
          }
        }
    if (job.kind === 'delete')
      for (const entry of job.entries as DeleteEntry[])
        if (entry.folder) {
          const actual = await inspect(entry.fileId);
          if (actual && (await nonempty(actual.path))) {
            delete state.namespaceJob;
            await hooks.save();
            throw new DeferredSync('remote', 'Mappen har fått nytt innhold.');
          }
        }
    job.submitted = true;
    delete job.reply;
    await hooks.save();
    let reply: MoveReply;
    try {
      // This guard is still before transport. Its cancellation must durably undo
      // the sent flag even when a newer local generation prevents ordinary save.
      await hooks.check();
      const options = {revalidateAfterWait: true};
      if (job.kind === 'move') {
        if (!files.moveBatch) throw bad(job.kind, 'Batchflytting mangler.');
        reply = await files.moveBatch(job.entries as MoveEntry[], job.attempt, options);
      } else if (job.kind === 'delete') {
        if (!files.deleteBatch) throw bad(job.kind, 'Batchsletting mangler.');
        reply = await files.deleteBatch(job.entries as DeleteEntry[], job.attempt, options);
      } else {
        if (!files.createFoldersBatch) throw bad(job.kind, 'Batchoppretting mangler.');
        reply = await files.createFoldersBatch(job.entries as FolderEntry[], job.attempt, options);
      }
    } catch (error) {
      // This adapter returns successful transport receipts before its post-request
      // generation guard. Preflight guards and explicit 4xx rejection therefore
      // prove that this launch was not accepted, unlike an unknown network reply.
      const rejected =
        error instanceof UnsentBatch ||
        (error instanceof DeferredSync && !(error instanceof SubmittedBatchInterruption)) ||
        (error instanceof SyncFailure &&
          error.info.status !== undefined &&
          error.info.status >= 400 &&
          error.info.status < 500 &&
          error.info.status !== 408);
      if (rejected) {
        job.submitted = false;
        delete job.jobId;
        await hooks.receipt(job);
        if (error instanceof SyncFailure && error.info.status === 409) throw new RetrySync();
      }
      if (error instanceof BatchRateRejected && job.attempt < 2) {
        job.attempt++;
        await hooks.save();
        await recover(true, revalidations);
        return true;
      }
      if (error instanceof NamespacePlanNeedsRefresh && revalidations < 2) {
        await recover(true, revalidations + 1);
        return true;
      }
      throw error;
    }
    await receipt(job, reply);
    return apply(job, reply, false, active);
  }
  async function recover(plannedNow = false, revalidations = 0) {
    const job = state.namespaceJob;
    if (!job) return;
    await refresh();
    await authorize(job);
    // A journal saved before launch, or explicitly rejected by Dropbox, has no
    // physical effect to resume. Recompute it after fresh master inspection;
    // Shared/Originals/missing sources can have changed since it was planned.
    if (!plannedNow && !job.submitted && !job.jobId && !job.reply) {
      delete state.namespaceJob;
      await hooks.save();
      if (publicationJob(job)) return;
      throw new RetrySync();
    }
    for (const id of job.quarantinedParents ?? [])
      if (await inspect(id))
        throw new SyncFailure(
          {code: failureCodes.bookChanges, stage: 'sync.namespace', action: 'check-folders'},
          'En uavklart foreldermappe finnes fortsatt.',
        );
    if (job.reply) {
      if (await apply(job, job.reply, true, plannedNow)) return;
    }
    if (!job.jobId) {
      if (await launch(job, true, plannedNow, revalidations)) return;
      if (!state.namespaceJob) return;
    }
    const check =
      job.kind === 'move'
        ? files.checkMoveBatch
        : job.kind === 'delete'
          ? files.checkDeleteBatch
          : files.checkCreateFoldersBatch;
    if (!check) throw bad(job.kind, 'Batchstatus mangler.');
    for (const delay of [0, 250, 750, 1500, 3000]) {
      if (!job.jobId) {
        if (await launch(job, false, plannedNow, revalidations)) return;
        continue;
      }
      for (let left = delay; left > 0; left -= 100) {
        await hooks.check();
        await new Promise(resolve => setTimeout(resolve, Math.min(100, left)));
      }
      await hooks.check();
      let reply: MoveReply;
      try {
        reply = await check(job.jobId, job.attempt);
      } catch (error) {
        if (error instanceof BatchStatusUnconfirmed) {
          await refresh();
          await authorize(job);
          return observeUnknown(job, true);
        }
        if (error instanceof BatchJobFailed) {
          delete state.namespaceJob;
          if (error.info.code === failureCodes.throttled && job.attempt < 2 && (!publicationJob(job) || plannedNow)) {
            state.namespaceJob = {
              id: crypto.randomUUID(),
              kind: job.kind,
              entries: job.entries,
              attempt: job.attempt + 1,
            };
            await hooks.save();
            await recover(true);
            return;
          }
          await hooks.save();
          if (publicationJob(job)) return;
          if (error.info.code === failureCodes.throttled) throw error;
          throw new RetrySync();
        }
        throw error;
      }
      await receipt(job, reply);
      if (await apply(job, reply, false, plannedNow)) return;
    }
    if (publicationJob(job)) throw new PublicationInProgress();
    throw new DeferredSync('connection', 'Dropbox-jobben er ikke ferdig.');
  }
  async function execute(kind: NamespaceJob['kind'], entries: NamespaceJob['entries']) {
    await recover();
    for (let offset = 0; offset < entries.length; offset += size) {
      state.namespaceJob = {
        id: crypto.randomUUID(),
        kind,
        entries: structuredClone(entries.slice(offset, offset + size)),
        attempt: 0,
      };
      await hooks.save();
      await recover(true);
    }
  }
  async function folders(entries: FolderEntry[]) {
    const byPath = new Map(entries.map(entry => [pathKey(entry.path), entry]));
    for (const depth of [...new Set([...byPath.values()].map(entry => entry.path.split('/').length))].sort(
      (a, b) => a - b,
    )) {
      const group: FolderEntry[] = [];
      for (const entry of byPath.values())
        if (entry.path.split('/').length === depth) {
          const current = hooks.find(entry.path);
          if (current?.folder && current.id) {
            if (entry.temporary) throw new RetrySync();
            continue;
          }
          if (current && !current.folder)
            throw new SyncFailure(
              {code: failureCodes.folderOccupied, stage: 'dropbox.ensure-folder', action: 'folder-layout'},
              'En fil står på mappeplassen.',
            );
          const parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
          group.push({...entry, ...(parent ? {parentId: hooks.find(parent)?.id} : {})});
        }
      for (const temporary of [false, true]) {
        const batch = group.filter(entry => Boolean(entry.temporary) === temporary);
        if (batch.length) await execute('folders', batch);
      }
    }
  }
  async function folder(path: string, expectedId?: string) {
    if (expectedId) return files.folder(path, expectedId);
    if (!hooks.find(path)?.id) await folders([{key: path, path}]);
    return files.folder(path);
  }
  async function remove(entries: DeleteEntry[]) {
    if (entries.length) await execute('delete', entries);
  }
  async function removeEmpty(paths: string[]) {
    if (!paths.length) return;
    await refresh();
    const entries: DeleteEntry[] = [];
    for (const path of paths) {
      const current = await inspect(path);
      if (!current) continue;
      if (!current.folder) throw bad('delete', 'Slettemålet er ikke en mappe.');
      if (!(await nonempty(current.path))) {
        const root = await inspect(current.path.split('/').slice(0, 3).join('/')),
          book = Object.values(state.library?.value.books ?? state.manifest.books).find(
            book => book.deleted && book.folderId === root?.id,
          );
        entries.push({
          key: current.id!,
          path: current.id!,
          sourcePath: current.path,
          fileId: current.id!,
          folder: true,
          category: 'folder',
          ...(book ? {bookId: book.id} : {}),
        });
      }
    }
    await remove(entries);
  }
  return {recover, folders, folder, remove, removeEmpty, move: (entries: MoveEntry[]) => execute('move', entries)};
}
