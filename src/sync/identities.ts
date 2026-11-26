import type {Song, SongPersonal} from '../core/song.ts';
import type {SyncSnapshot, syncStorage} from './store.ts';
import type {Manifest} from '../core/sync-model.ts';

const nameKey = (name: string) => name.normalize('NFC').toLocaleLowerCase('nb');
const filenameKey = (name: string) => name.normalize('NFC');
type Kind = 'books' | 'songs';
type Changes = Parameters<ReturnType<typeof syncStorage>['commit']>[2];

/** Translate at the storage boundary; cloud IDs never replace existing local IDs. */
export function syncIdentities(source: SyncSnapshot) {
  const state = source.state;
  const emptySeed = () =>
    !source.songs.length &&
    source.songbooks.length === 1 &&
    source.songbooks[0].id === 'standard' &&
    source.songbooks[0].name === 'Standard' &&
    !source.journal.generation;
  const first = () => !state.joined && !state.lastManual;
  const wireId = (kind: Kind, id: string) => state.bindings?.[kind][id] ?? id;
  function bind(kind: Kind, local: string, wire: string) {
    if (local === wire) return;
    (state.bindings ??= {books: {}, songs: {}})[kind][local] = wire;
  }
  function localId(kind: Kind, wire: string) {
    const bindings = state.bindings?.[kind] ?? {},
      known = Object.keys(bindings).find(id => bindings[id] === wire);
    if (known) return known;
    if (bindings[wire] && bindings[wire] !== wire) {
      const id = crypto.randomUUID();
      bind(kind, id, wire);
      return id;
    }
    return wire;
  }
  function personal(value: SongPersonal, id: (id: string) => string): SongPersonal {
    const result = structuredClone(value);
    result.songId = id(value.songId);
    for (const annotation of Object.values(result.annotations ?? {}))
      annotation.anchor.songId = id(annotation.anchor.songId);
    return result;
  }
  function project(): SyncSnapshot {
    const snapshot = {...source, state, journal: structuredClone(source.journal)};
    snapshot.songbooks = snapshot.songbooks.map(book => {
      const id = wireId('books', book.id),
        known = state.folders[id];
      return {
        ...book,
        id,
        ...(first() && known && nameKey(book.name) === nameKey(known.name) ? {name: known.name} : {}),
      };
    });
    snapshot.songs = snapshot.songs.map(song => {
      const id = wireId('songs', song.id),
        known = id !== song.id && (state.manifest.songs[id] ?? state.reservations[id]);
      return {
        ...song,
        id,
        songbookId: wireId('books', song.songbookId),
        ...(known ? {origin: structuredClone(known.origin)} : {}),
      };
    });
    snapshot.personal = snapshot.personal.map(value => personal(value, id => wireId('songs', id)));
    snapshot.journal.deletedBooks = Object.fromEntries(
      Object.values(snapshot.journal.deletedBooks).map(book => {
        const id = wireId('books', book.id);
        return [id, {...book, id}];
      }),
    );
    return snapshot;
  }
  function books(remote: Manifest) {
    if (!first() || (emptySeed() && Object.keys(remote.books).length)) return false;
    let changed = false;
    const retired = new Set(Object.keys(source.journal.deletedBooks).map(id => wireId('books', id)));
    for (const book of source.songbooks) {
      const id = wireId('books', book.id);
      // A confirmed folder owns this identity even before its first manifest.
      // Its later rename must not trigger the independently seeded Standard rule.
      if (
        state.bindings?.books[book.id] ||
        state.manifest.books[id] ||
        (state.folders[id]?.folderId && state.folders[id].folderId === remote.books[id]?.folderId)
      )
        continue;
      // Standard is independently seeded on every installation, not a global identity.
      if (remote.books[id] && id !== 'standard') continue;
      const matches = Object.values(remote.books).filter(
        other => !other.deleted && !retired.has(other.id) && nameKey(other.name) === nameKey(book.name),
      );
      if (matches.length === 1) {
        const target = matches[0];
        if (state.folders[id]?.folderId && state.folders[id].folderId !== target.folderId) continue;
        if (
          Object.entries(state.bindings?.books ?? {}).some(([local, wire]) => wire === target.id && local !== book.id)
        )
          continue;
        if (id !== target.id) delete state.folders[id];
        bind('books', book.id, target.id);
        state.folders[target.id] = {...target};
        changed = true;
      } else if (
        id === 'standard' &&
        remote.books[id] &&
        (remote.books[id].deleted || remote.books[id].name !== book.name)
      ) {
        bind('books', book.id, crypto.randomUUID());
        changed = true;
      }
    }
    return changed;
  }
  async function songs(
    remote: Manifest,
    isPrivate: (song: Song) => boolean,
    release: (id: string) => Promise<boolean> = async () => true,
    releaseMany?: (ids: string[]) => Promise<Set<string>>,
  ) {
    if (!first()) return false;
    let changed = false;
    const snapshot = project(),
      locals = snapshot.songs.filter(isPrivate),
      remotes = Object.values(remote.songs).filter(
        link =>
          link.path &&
          (link.fileId || state.library?.value.songs[link.id] || state.manifest.songs[link.id]) &&
          !remote.books[link.songbookId]?.deleted &&
          !remote.deletedSongs?.[link.id] &&
          !state.held?.[link.id],
      );
    const remoteIds = new Set(remotes.map(link => link.id));
    const key = (book: string, filename: string) => JSON.stringify([book, filenameKey(filename)]);
    const candidates: {original: Song; id: string; link: (typeof remotes)[number]}[] = [];
    for (const original of source.songs.filter(isPrivate)) {
      if (!original.origin.filename) continue;
      const id = wireId('songs', original.id),
        reserved = state.reservations[id];
      const staged = state.uploads?.[`content:${id}`]?.creation;
      const legacyPath = reserved && /--[a-f0-9]{64}\.cho$/i.test(reserved.path);
      const ownsFile =
        reserved &&
        (reserved.fileId ||
          state.bases[id]?.contentRev ||
          (!staged &&
            legacyPath &&
            (!state.remote || state.remote.entries[reserved.path.normalize('NFC').toLowerCase()])));
      const explicitCopy = Object.entries(state.reservations).some(
        ([key, link]) => key.startsWith('copy:') && link.id === id,
      );
      if (
        state.bindings?.songs[original.id] ||
        state.manifest.songs[id] ||
        remoteIds.has(id) ||
        remote.deletedSongs?.[id] ||
        ownsFile ||
        explicitCopy
      )
        continue;
      const local = locals.find(song => song.id === id)!,
        matchKey = key(local.songbookId, local.origin.filename);
      if (locals.filter(song => key(song.songbookId, song.origin.filename) === matchKey).length !== 1) continue;
      const matches = remotes.filter(link => key(link.songbookId, link.origin.filename) === matchKey);
      if (matches.length !== 1 || locals.some(song => song.id === matches[0].id)) continue;
      candidates.push({original, id, link: matches[0]});
    }
    const released = releaseMany ? await releaseMany(candidates.map(candidate => candidate.id)) : null;
    for (const {original, id, link} of candidates) {
      if (released ? !released.has(id) : !(await release(id))) continue;
      bind('songs', original.id, link.id);
      // A planned name is not a cloud identity. A failed first attempt may have
      // reserved paths before another device published the same imported files.
      // Commit recovery precedes this pass; confirmed files never enter here.
      delete state.reservations[id];
      delete state.bases[id];
      delete state.originals?.[id];
      delete state.decisions[`${id}:content`];
      delete state.decisions[`${id}:personal`];
      state.conflicts = state.conflicts.filter(conflict => conflict.songId !== id);
      for (const [key, job] of Object.entries(state.uploads ?? {})) if (job.songId === id) delete state.uploads![key];
      state.reservations[link.id] = {...link};
      changed = true;
    }
    return changed;
  }
  /** A published Dropbox ID wins over an unpublished reservation, on every retry.
   * This is physical identity, independent of the first-join filename heuristic. */
  function reconcile(remote: Manifest) {
    let changed = false;
    for (const [id, book] of Object.entries(state.folders)) {
      if (state.manifest.books[id] || !book.folderId) continue;
      const winner = Object.values(remote.books).find(
        other => !other.deleted && other.folderId === book.folderId && other.id !== id,
      );
      if (!winner) continue;
      for (const local of source.songbooks) if (wireId('books', local.id) === id) bind('books', local.id, winner.id);
      for (const link of Object.values(state.reservations)) if (link.songbookId === id) link.songbookId = winner.id;
      delete state.folders[id];
      state.folders[winner.id] = {...winner};
      changed = true;
    }
    for (const local of source.songs) {
      const id = wireId('songs', local.id),
        reserved = state.reservations[id];
      if (state.manifest.songs[id] || !reserved?.fileId) continue;
      const winner = Object.values(remote.songs).find(other => other.fileId === reserved.fileId && other.id !== id);
      if (!winner) continue;
      if (source.songs.some(other => other.id !== local.id && wireId('songs', other.id) === winner.id))
        throw new Error('Ambiguous local Dropbox identity');
      bind('songs', local.id, winner.id);
      // No invented common personal basis: independently created sidecars may differ.
      delete state.bases[id];
      delete state.reservations[id];
      delete state.originals?.[id];
      delete state.decisions[`${id}:content`];
      delete state.decisions[`${id}:personal`];
      for (const [key, job] of Object.entries(state.uploads ?? {})) if (job.songId === id) delete state.uploads![key];
      state.conflicts = state.conflicts.filter(conflict => conflict.songId !== id);
      state.reservations[winner.id] = {...winner};
      changed = true;
    }
    return changed;
  }
  function restore(changes: Changes = {}): Changes {
    const songId = (id: string) => localId('songs', id),
      bookId = (id: string) => localId('books', id);
    return {
      ...changes,
      ...(changes.books ? {books: changes.books.map(book => ({...book, id: bookId(book.id)}))} : {}),
      ...(changes.songs
        ? {songs: changes.songs.map(song => ({...song, id: songId(song.id), songbookId: bookId(song.songbookId)}))}
        : {}),
      ...(changes.personal ? {personal: changes.personal.map(value => personal(value, songId))} : {}),
      ...(changes.deleteBooks ? {deleteBooks: changes.deleteBooks.map(bookId)} : {}),
      ...(changes.deleteSongs ? {deleteSongs: changes.deleteSongs.map(songId)} : {}),
    };
  }
  return {project, books, songs, reconcile, restore, emptySeed, wireId, localId};
}
