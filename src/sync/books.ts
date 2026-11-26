import {songbookName} from '../domain/songbook.ts';
import {songLocation} from './model.ts';
import {type BookLink, type Manifest, type MoveEntry, type FolderEntry} from '../core/sync-model.ts';
import {failureCodes, SyncFailure, RetrySync} from '../core/failure.ts';
import {pathKey} from './remote.ts';
import {maxFileBytes} from '../core/limits.ts';
import type {SyncSession} from './session.ts';
import {
  appFolder,
  bookAreas,
  bookPath,
  isBookPath,
  personalFolder,
  renameStagingPath,
  songbooksFolder,
} from '../core/paths.ts';
export function remoteBookName(value: string, books: BookLink[], ownId?: string) {
  try {
    return songbookName(value, books, ownId);
  } catch (cause) {
    throw new SyncFailure(
      {code: failureCodes.bookName, stage: 'sync.book-name', action: 'remote-book-names'},
      'Ugyldig sangboknavn i Dropbox.',
      cause,
    );
  }
}
export async function refreshBookNames(s: SyncSession, remote: Manifest) {
  for (const book of Object.values(remote.books).filter(book => !book.deleted && book.folderId)) {
    const current = await s.step(() => s.files.locateFolder(book.folderId!));
    if (!current)
      throw new SyncFailure(
        {code: failureCodes.missingFolder, stage: 'sync.book-state'},
        'Kjent sangbokmappe mangler.',
      );
    const intent = s.state.renames?.[book.id];
    if (intent) {
      if ([intent.from, intent.to, renameStagingPath(book.id)].includes(current.path)) continue;
      throw new SyncFailure(
        {code: failureCodes.bookChanges, stage: 'sync.book-state'},
        'Sangbokmappen er endret under en uferdig navneendring.',
      );
    }
    if (!isBookPath(current.path))
      throw new SyncFailure(
        {code: failureCodes.bookChanges, stage: 'sync.book-state'},
        'En kjent sangbokmappe ligger utenfor Songbooks.',
      );
    if (book.path === current.path && book.name === current.path.split('/').at(-1)!) continue;
    const previousPath = book.path ?? bookPath(book.name);
    book.name = remoteBookName(
      current.path.split('/').at(-1)!,
      Object.values(remote.books).filter(other => !other.deleted),
      book.id,
    );
    book.path = current.path;
    for (const song of Object.values(remote.songs))
      if (song.songbookId === book.id && song.path.toLowerCase().startsWith(previousPath.toLowerCase() + '/'))
        song.path = current.path + song.path.slice(previousPath.length);
    s.state.folders[book.id] = {...book};
    await s.save();
  }
}
export async function ensureBooks(s: SyncSession, merged: Manifest) {
  await s.namespace.folders([appFolder, personalFolder, songbooksFolder].map(path => ({key: path, path})));
  const active = Object.values(merged.books).filter(book => !book.deleted),
    blocked = new Set<string>();
  for (const book of active) {
    const target = bookPath(book.name),
      prior = Object.values(merged.books).find(
        other => other.id !== book.id && pathKey(other.path ?? '') === pathKey(target),
      ),
      occupying = s.index.find(target);
    if (prior && occupying && (!prior.folderId || occupying.id === prior.folderId)) {
      if (prior.deleted) {
        blocked.add(book.id);
        continue;
      }
      throw new SyncFailure(
        {code: failureCodes.bookName, stage: 'sync.book-name', action: 'book-names'},
        'Mappen tilhører en annen sangbok.',
      );
    }
  }
  const renames: MoveEntry[] = [],
    cases: MoveEntry[] = [],
    creates: FolderEntry[] = [];
  for (const book of active) {
    const target = bookPath(book.name),
      known = s.state.folders[book.id] ?? s.state.manifest.books[book.id] ?? book;
    if (known.folderId) {
      const actual = await s.step(() => s.files.locateFolder(known.folderId!));
      if (!actual)
        throw new SyncFailure(
          {code: failureCodes.missingFolder, stage: 'sync.book-state'},
          'Kjent sangbokmappe mangler.',
        );
      if (actual.path !== target) {
        (s.state.renames ??= {})[book.id] = {from: known.path ?? actual.path, to: target};
        if (!blocked.has(book.id)) {
          const plan = {
            key: `book:${book.id}`,
            from: known.folderId,
            to: target,
            fileId: known.folderId,
            folder: true,
            book: {...book},
          };
          if (pathKey(actual.path) === pathKey(target))
            cases.push({...plan, key: plan.key + ':case', to: renameStagingPath(book.id), book: undefined});
          renames.push(plan);
        }
      }
      if (blocked.has(book.id)) {
        book.path = actual.path;
        s.state.folders[book.id] = {...book, folderId: known.folderId};
      }
    } else {
      let path = target;
      if (blocked.has(book.id)) {
        const base = renameStagingPath(book.id);
        path = s.state.renames?.[book.id]?.from ?? base;
        let n = 1;
        while (
          s.index.find(path) ||
          Object.values(merged.books).some(
            other => other.deleted && other.path && pathKey(other.path) === pathKey(path),
          )
        )
          path = base + '-' + ++n;
        (s.state.renames ??= {})[book.id] = {from: path, to: target};
      }
      s.state.folders[book.id] = {...book, path};
      book.path = path;
      creates.push({key: book.id, path, book: {...book}, ...(blocked.has(book.id) ? {temporary: true} : {})});
    }
  }
  await s.save();
  if (cases.length) await s.namespace.move(cases);
  if (renames.length) await s.namespace.move(renames);
  await s.namespace.folders(creates);
  const children: FolderEntry[] = [];
  for (const book of active) {
    const target = blocked.has(book.id) ? s.state.folders[book.id].path! : bookPath(book.name),
      known = s.state.folders[book.id] ?? book,
      binding = await s.folder(target, known.folderId);
    book.folderId = binding.id;
    book.path = binding.path;
    s.state.folders[book.id] = {...book};
    if (!blocked.has(book.id)) delete s.state.renames?.[book.id];
    for (const kind of bookAreas) children.push({key: book.id + ':' + kind, path: binding.path + '/' + kind});
  }
  await s.save();
  await s.namespace.folders(children);
  return blocked;
}
export async function finishBookNames(s: SyncSession, merged: Manifest) {
  const moves: MoveEntry[] = [];
  let waiting = false;
  for (const id of Object.keys(s.state.renames ?? {})) {
    const local = s.snapshot.songbooks.find(book => book.id === id),
      book = merged.books[id];
    if (!local) {
      if (book?.deleted && (!book.folderId || book.archive?.done)) delete s.state.renames?.[id];
      continue;
    }
    if (!book) {
      waiting = true;
      continue;
    }
    if (book.deleted) continue;
    const target = bookPath(local.name),
      current = book.folderId ? s.index.find(book.folderId) : undefined,
      occupying = s.index.find(target);
    if (!current || !current.id) throw new RetrySync();
    if (occupying && occupying.id !== current.id) {
      waiting = true;
      continue;
    }
    if (pathKey(current.path) !== pathKey(target))
      moves.push({
        key: 'book:' + id,
        from: current.id,
        fileId: current.id,
        to: target,
        folder: true,
        book: {...book, name: local.name},
      });
    else {
      book.name = local.name;
      book.path = current.path;
      delete s.state.renames?.[id];
    }
  }
  if (moves.length) {
    s.state.archivePending = true;
    await s.save();
    await s.namespace.move(moves);
    for (const move of moves) {
      const book = merged.books[move.book!.id],
        current = s.index.find(move.fileId);
      if (!current || pathKey(current.path) !== pathKey(move.to)) throw new RetrySync();
      book.name = move.book!.name;
      book.path = current.path;
      s.state.folders[book.id] = {...book};
      delete s.state.renames?.[book.id];
    }
    for (const link of Object.values(merged.songs)) {
      const current = s.index.find(link.fileId ?? link.path),
        location = current && songLocation(current.path);
      if (
        current?.id === link.fileId &&
        location &&
        pathKey(location.bookPath) === pathKey(merged.books[link.songbookId].path!)
      )
        link.path = current!.path;
      if (link.originalFile) {
        const original = s.index.find(link.originalFile.fileId);
        if (original) link.originalFile.path = original.path;
      }
    }
  }
  return {waiting, changed: Boolean(moves.length)};
}
export async function discover(s: SyncSession, remote: Manifest, publishedIds: Set<string>) {
  // Discover unregistered songs in Private/. Known Shared files follow their existing links.
  for (const entry of await s.step(() => s.files.list(songbooksFolder))) {
    if (
      !entry.folder ||
      Object.values(remote.books).some(book =>
        book.folderId ? book.folderId === entry.id : book.path?.toLowerCase() === entry.path.toLowerCase(),
      )
    )
      continue;
    let known = Object.values(s.state.folders).find(book => book.folderId === entry.id);
    if (!known) {
      const name = entry.path.split('/').at(-1)!;
      remoteBookName(
        name,
        Object.values(remote.books).filter(b => !b.deleted),
      );
      known = {id: crypto.randomUUID(), name, path: entry.path, folderId: entry.id};
      s.state.folders[known.id] = known;
      await s.save();
    }
    remote.books[known.id] = {...known};
    await s.namespace.folders(
      bookAreas.map(kind => ({
        key: entry.id + ':' + kind,
        path: `${entry.path}/${kind}`,
      })),
    );
  }
  for (const book of Object.values(remote.books).filter(book => !book.deleted)) {
    for (const file of await s.step(() => s.files.list(`${book.path ?? bookPath(book.name)}/Private`))) {
      if ((s.index.find(file.id)?.size ?? 0) > maxFileBytes) continue;
      if (s.claims.some(claim => claim.role === 'content' && claim.fileId === file.id)) continue;
      if (
        file.folder ||
        !file.path.toLowerCase().endsWith('.cho') ||
        Object.values(remote.songs).some(
          song =>
            song.fileId === file.id ||
            (publishedIds.has(song.id) && song.path.toLowerCase() === file.path.toLowerCase()),
        )
      )
        continue;
      let known = Object.values(s.state.reservations).find(song => song.fileId === file.id);
      if (!known) {
        known = {
          id: crypto.randomUUID(),
          songbookId: book.id,
          fileId: file.id,
          path: file.path,
          origin: {kind: 'local', filename: file.path.split('/').at(-1)!, importedAt: new Date().toISOString()},
        };
        s.state.reservations[known.id] = known;
        await s.save();
      }
      remote.songs[known.id] = {...known};
    }
  }
}
