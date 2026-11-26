import {DeferredSync, RetrySync, SyncFailure, failureCodes} from '../core/failure.ts';
import {pathKey} from './remote.ts';
import type {BookLink, Manifest, MoveEntry, RemoteEntry, RemoteFiles, SyncState} from '../core/sync-model.ts';

const sourcePath = (path: string) => /^\/Songbooks\/[^/]+$/i.test(path);
export function needsArchive(book: BookLink, find: (path: string) => RemoteEntry | undefined) {
  return Boolean(book.deleted && book.folderId && !book.archive?.done && sourcePath(find(book.folderId)?.path ?? ''));
}
function archiveBase(name: string, date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `/Deleted/${name} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}
/** A shared, published intent precedes the ID move. The mutation fence spans
 * its receipt and final manifest acknowledgement. Timestamps survive retries. */
export async function archiveBooks(
  manifest: Manifest,
  files: RemoteFiles,
  state: SyncState,
  hooks: {
    check(): Promise<void>;
    save(): Promise<void>;
    publish(value: Manifest): Promise<void>;
    find(path: string): RemoteEntry | undefined;
    move(entries: MoveEntry[]): Promise<void>;
  },
) {
  for (const book of Object.values(manifest.books)) if (book.archive?.done) delete state.archiveIntents?.[book.id];
  const books = Object.values(manifest.books).filter(
    book =>
      book.deleted &&
      book.folderId &&
      !book.archive?.done &&
      (needsArchive(book, hooks.find) || (book.archive && hooks.find(book.folderId))),
  );
  if (!books.length) {
    state.archivePending = false;
    delete state.cleanupPending;
    delete state.cleanupProofs;
    return;
  }
  state.archivePending = true;
  await hooks.save();
  await hooks.check();
  if (files.metadataSnapshot) await files.metadataSnapshot();
  await hooks.check();
  const anchored =
    books.find(book => book.archive)?.archive ?? books.map(book => state.archiveIntents?.[book.id]).find(Boolean);
  if (anchored) {
    const parent = hooks.find(anchored.parentId);
    if (!parent?.folder || pathKey(parent.path) !== '/deleted')
      throw new SyncFailure(
        {code: failureCodes.bookChanges, stage: 'sync.namespace', action: 'check-folders'},
        'Arkivroten er erstattet eller flyttet.',
      );
  }
  const root = await files.folder('/Deleted', anchored?.parentId);
  await hooks.check();
  const targets = new Set<string>(),
    moves: MoveEntry[] = [],
    placing: BookLink[] = [];
  let changed = false;
  for (const book of books) {
    const actual = hooks.find(book.folderId!);
    if (!actual) continue;
    if (!book.archive && !sourcePath(actual.path)) continue;
    if (!actual.folder)
      throw new SyncFailure(
        {code: failureCodes.bookChanges, stage: 'sync.namespace', action: 'check-folders'},
        'Arkivkilden er ikke en mappe.',
      );
    if (
      Object.values(manifest.songs).some(
        link =>
          link.songbookId === book.id ||
          pathKey(hooks.find(link.fileId ?? link.path)?.path ?? '').startsWith(pathKey(actual.path) + '/'),
      )
    )
      throw new RetrySync();
    if (
      Object.values(state.uploads ?? {}).some(
        job => job.creation?.book?.id === book.id && job.status !== 'done' && !job.creation.discarded,
      )
    )
      throw new DeferredSync('remote', 'Bokens filarbeid må fullføres før arkivering.');
    if (!book.archive) {
      const saved = state.archiveIntents?.[book.id];
      if (saved && saved.folderId !== book.folderId)
        throw new SyncFailure(
          {code: failureCodes.manifest, stage: 'sync.namespace', action: 'mutation-state'},
          'Arkivintensjonen tilhører en annen mappe.',
        );
      if (saved) {
        const {folderId, ...intent} = saved;
        book.archive = {...intent};
      } else {
        const date = new Date(),
          basePath = archiveBase(book.name, date);
        book.archive = {at: date.toISOString(), basePath, path: basePath, parentId: root.id};
      }
      changed = true;
    }
    const intent = book.archive;
    if (intent.parentId !== root.id)
      throw new SyncFailure(
        {code: failureCodes.bookChanges, stage: 'sync.namespace', action: 'check-folders'},
        'Arkivroten er erstattet eller flyttet.',
      );
    if (pathKey(actual.path) === pathKey(intent.path)) {
      intent.done = true;
      changed = true;
      continue;
    }
    if (!sourcePath(actual.path))
      throw new SyncFailure(
        {code: failureCodes.bookChanges, stage: 'sync.namespace', action: 'check-move'},
        'Arkivflyttingen er fortsatt uavklart.',
      );
    let target = intent.path,
      n = 1;
    while (targets.has(pathKey(target)) || (hooks.find(target) && hooks.find(target)!.id !== book.folderId))
      target = `${intent.basePath} (${++n})`;
    targets.add(pathKey(target));
    if (target !== intent.path) {
      intent.path = target;
      changed = true;
    }
    moves.push({
      key: 'archive:' + book.id,
      from: book.folderId!,
      fileId: book.folderId!,
      to: target,
      toReference: intent.parentId + '/' + target.split('/').at(-1),
      folder: true,
      archive: {bookId: book.id, sourcePath: actual.path},
    });
    placing.push(book);
  }
  for (const book of books)
    if (book.archive) {
      const {done, ...intent} = book.archive;
      (state.archiveIntents ??= {})[book.id] = {...intent, folderId: book.folderId!};
    }
  // A rejected/unsent publication must not allocate another timestamp next run.
  await hooks.save();
  if (changed) await hooks.publish(manifest);
  if (moves.length) {
    await hooks.move(moves);
    for (const book of placing) {
      const actual = hooks.find(book.folderId!),
        intent = book.archive!;
      if (!actual || pathKey(actual.path) !== pathKey(intent.path) || hooks.find('/Deleted')?.id !== intent.parentId)
        throw new RetrySync();
      intent.done = true;
    }
    for (const link of Object.values(manifest.songs))
      if (link.originalFile) {
        const actual = hooks.find(link.originalFile.fileId);
        if (actual) link.originalFile.path = actual.path;
      }
    await hooks.publish(manifest);
  }
  for (const book of books) if (book.archive?.done) delete state.archiveIntents?.[book.id];
  state.archivePending = false;
  delete state.cleanupPending;
  delete state.cleanupProofs;
  await hooks.save();
}
