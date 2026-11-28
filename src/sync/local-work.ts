import type {SyncSnapshot} from './store.ts';
import {ownSong, personalData, same} from './model.ts';
import {emptyManifest, type Manifest} from './state.ts';
import {originalFilename} from './filenames.ts';
import {needsArchive} from './archive.ts';
import type {SyncSession} from './session.ts';
export const personalOf = (snapshot: SyncSnapshot, id: string) =>
  personalData(snapshot.personal.find(p => p.songId === id) ?? {songId: id, version: 3, chorus: {}});
export function localManifest(s: SyncSession): Manifest {
  const local = emptyManifest();
  for (const book of s.snapshot.songbooks)
    local.books[book.id] = {...s.state.manifest.books[book.id], ...s.state.folders[book.id], ...book};
  for (const [id, book] of Object.entries(s.snapshot.journal.deletedBooks))
    local.books[id] = {...s.state.manifest.books[id], ...s.state.folders[id], ...book};
  for (const song of s.snapshot.songs.filter(ownSong)) {
    const previous = s.state.manifest.songs[song.id] ?? s.state.reservations[song.id];
    local.songs[song.id] = {
      ...previous,
      id: song.id,
      songbookId: song.songbookId,
      origin: song.origin,
      path: previous?.path ?? '',
    };
  }
  return local;
}
export function hasLocalWork(s: SyncSession) {
  if (
    s.state.archivePending ||
    s.state.cleanupPending ||
    Object.values(s.state.manifest.books).some(book => needsArchive(book, s.index.find)) ||
    s.state.mutationPending ||
    s.state.namespaceJob ||
    Object.keys(s.state.movedPublications ?? {}).length ||
    Object.keys(s.state.renames ?? {}).length ||
    Object.keys(s.state.decisions).length ||
    Object.values(s.state.uploads ?? {}).some(job => job.status !== 'done')
  )
    return true;
  for (const book of s.snapshot.songbooks) {
    const known = s.state.manifest.books[book.id];
    if (known?.deleted) continue;
    if (!known?.folderId || known.name !== book.name) return true;
  }
  for (const book of Object.values(s.snapshot.journal.deletedBooks))
    if (!s.state.manifest.books[book.id]?.deleted) return true;
  for (const song of s.snapshot.songs.filter(ownSong)) {
    if (
      s.state.manifest.deletedSongs?.[song.id] ||
      s.state.manifest.books[song.songbookId]?.deleted ||
      s.state.held?.[song.id]
    )
      continue;
    const base = s.state.bases[song.id],
      link = s.state.manifest.songs[song.id];
    if (originalFilename(song) && !link?.originalFile && !s.state.originals?.[song.id]) return true;
    if (
      !base ||
      !base.contentRev ||
      !base.personalRev ||
      base.personal.original.rev !== base.contentRev ||
      !link ||
      link.songbookId !== song.songbookId ||
      !same(link.origin, song.origin) ||
      song.original !== base.original ||
      !same(personalOf(s.snapshot, song.id), base.personal.data)
    )
      return true;
  }
  // Imported songs are never edited, but their personal layer syncs like any other (#101 F16).
  for (const song of s.snapshot.songs.filter(song => !ownSong(song))) {
    const base = s.state.bases[song.id];
    if (s.state.manifest.songs[song.id] && base && !same(personalOf(s.snapshot, song.id), base.personal.data))
      return true;
  }
  return false;
}
export function hasUnconfirmedNamespaceChanges(s: SyncSession) {
  return (
    s.state.namespaceJob?.submitted ||
    s.state.archivePending ||
    Object.keys(s.state.movedSongs ?? {}).length ||
    Object.keys(s.state.movedPublications ?? {}).length ||
    Object.keys(s.state.movedBooks ?? {}).length ||
    Object.keys(s.state.renames ?? {}).length
  );
}
