import {songLocation} from './model.ts';
import type {SongLink} from '../core/sync-model.ts';
import type {Manifest} from './state.ts';
import {pathKey} from './remote.ts';
import type {SyncSession} from './session.ts';
import {isBookPath} from '../core/paths.ts';
export function deleteSong(remote: Manifest, link: SongLink) {
  (remote.deletedSongs ??= {})[link.id] = {
    id: link.id,
    ...(link.fileId ? {fileId: link.fileId} : {}),
    songbookId: link.songbookId,
  };
  delete remote.songs[link.id];
}
export async function inspectRemovals(s: SyncSession, remote: Manifest) {
  s.state.held = {};
  const activeFiles = new Set<string>();
  const knownBooks = {...s.state.manifest.books, ...s.state.folders, ...remote.books};
  for (const book of Object.values(knownBooks)) {
    if (remote.books[book.id]?.deleted || book.deleted) {
      remote.books[book.id] ??= {...book, deleted: true};
      s.state.folders[book.id] = {...remote.books[book.id]};
      continue;
    }
    if (!book.folderId || book.deleted) continue;
    const current = await s.step(() => s.files.locateFolder(book.folderId!));
    if (!current || !isBookPath(current.path)) {
      remote.books[book.id] = {...book, deleted: true};
      s.state.folders[book.id] = {...remote.books[book.id]};
    } else {
      knownBooks[book.id] = {...book, path: current.path};
      remote.books[book.id] ??= {...book};
    }
  }
  const confirmed = Object.fromEntries(
    Object.values(s.state.reservations)
      .filter(link => link.fileId)
      .map(link => [link.id, link]),
  );
  const knownSongs = {...s.state.manifest.songs, ...confirmed, ...remote.songs};
  const booksByPath = new Map(
    Object.values(knownBooks)
      .filter(book => book.path && !book.deleted && !remote.books[book.id]?.deleted)
      .map(book => [pathKey(book.path!), book]),
  );
  for (const link of Object.values(knownSongs)) {
    if (remote.deletedSongs?.[link.id]) {
      delete remote.songs[link.id];
      continue;
    }
    const entry = s.state.remote ? s.index.find(link.fileId ?? link.path) : undefined;
    if (s.state.remote && !entry) {
      deleteSong(remote, link);
      continue;
    }
    if (entry && !entry.folder) {
      const location = songLocation(entry.path),
        owner = location && booksByPath.get(pathKey(location.bookPath));
      if (owner) {
        if (link.fileId === entry.id) activeFiles.add(link.id);
        // A manually relocated initial upload is still waiting for its
        // private first-upload receipt and sidecar. It has no active link yet.
        if (location?.area === 'Shared' && !s.state.manifest.songs[link.id] && !s.state.library?.value.songs[link.id])
          s.state.held[link.id] = true;
        else remote.songs[link.id] = {...link, songbookId: owner.id, path: entry.path};
      } else if (remote.books[link.songbookId]?.deleted) deleteSong(remote, link);
      else if (!/^\/Songbooks\/[^/]+\//i.test(entry.path) || /^\/Songbooks\/[^/]+\/Originals\//i.test(entry.path))
        deleteSong(remote, link);
      else s.state.held[link.id] = true;
    } else if (remote.books[link.songbookId]?.deleted) deleteSong(remote, link);
  }
  for (const link of Object.values(remote.songs)) if (remote.books[link.songbookId]?.deleted) deleteSong(remote, link);
  // F57 covers membership, including offline imports never present in a manifest.
  for (const song of s.snapshot.songs)
    if (remote.books[song.songbookId]?.deleted && !activeFiles.has(song.id)) {
      deleteSong(remote, {
        ...s.state.reservations[song.id],
        id: song.id,
        songbookId: song.songbookId,
        origin: song.origin,
        path: '',
      });
    }
  const discarded = Object.values(s.state.uploads ?? {})
    .filter(job => job.creation && remote.deletedSongs?.[job.songId])
    .map(job => job.songId);
  if (discarded.length) await s.uploads.discardMany([...new Set(discarded)]);
  for (const [key, job] of Object.entries(s.state.uploads ?? {}))
    if (remote.deletedSongs?.[job.songId]) delete s.state.uploads![key];
}
export function removedChanges(s: SyncSession, remote: Manifest) {
  const removed = Object.keys(remote.deletedSongs ?? {}),
    books = Object.values(remote.books)
      .filter(b => b.deleted)
      .map(b => b.id);
  for (const id of removed) {
    delete s.state.bases[id];
    delete s.state.reservations[id];
    delete s.state.reservations[`copy:${id}`];
    delete s.state.originals?.[id];
    delete s.state.held?.[id];
    delete s.state.decisions[`${id}:content`];
    delete s.state.decisions[`${id}:personal`];
  }
  s.state.conflicts = s.state.conflicts.filter(c => !removed.includes(c.songId));
  return {deleteSongs: removed, deleteBooks: books};
}
