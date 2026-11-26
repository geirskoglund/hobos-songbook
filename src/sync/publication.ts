import {parseChordPro} from '../domain/chordpro.ts';
import type {Song} from '../core/song.ts';
import type {SyncSnapshot} from '../storage/sync.ts';
import {DeferredSync, failureCodes, failureInfo, PublicationInProgress} from '../core/failure.ts';
import {syncIdentities} from './identities.ts';
import {ownSong, songLocation, type PublicationView} from './model.ts';
import type {RemoteEntry, SongLink} from '../core/sync-model.ts';
import {metadataView, pathKey} from './remote.ts';
import {isBookPath} from '../core/paths.ts';

export function publicationCatalog(snapshot: SyncSnapshot) {
  const {state} = snapshot;
  const manifest = state.library?.value ?? state.manifest;
  const {find} = metadataView(Object.values(state.remote?.entries ?? {}));
  const books = new Map(snapshot.songbooks.map(book => [book.id, book]));
  const roots = new Map<string, RemoteEntry>();
  for (const book of Object.values(manifest.books)) {
    if (book.deleted || snapshot.journal.deletedBooks[book.id] || !book.folderId) continue;
    const root = find(book.folderId);
    if (!root?.folder || !isBookPath(root.path)) continue;
    roots.set(book.id, root);
    if (!books.has(book.id)) books.set(book.id, {id: book.id, name: book.name});
  }

  type PublicationRecord = {id: string; songbookId: string; local?: Song; link?: SongLink; entry?: RemoteEntry};
  const records = new Map<string, PublicationRecord>();
  for (const local of snapshot.songs.filter(ownSong)) {
    records.set(local.id, {id: local.id, songbookId: local.songbookId, local});
  }
  const localIds = new Set(snapshot.songs.map(song => song.id));
  for (const link of Object.values(manifest.songs)) {
    if (!ownSong(link) || !link.fileId || manifest.deletedSongs?.[link.id]) continue;
    const local = records.get(link.id);
    if (localIds.has(link.id) && !local) continue;
    const physical = find(link.fileId),
      root = roots.get(link.songbookId);
    const location = physical && !physical.folder && songLocation(physical.path);
    const entry = root && location && pathKey(location.bookPath) === pathKey(root.path) ? physical : undefined;
    if (entry || local?.songbookId === link.songbookId)
      records.set(link.id, {...local, id: link.id, songbookId: link.songbookId, link, entry});
  }
  return {manifest, records, roots, books, find};
}

export function publicationView(source: SyncSnapshot, identities = syncIdentities(source)): PublicationView {
  const snapshot = identities.project();
  const catalog = publicationCatalog(snapshot);
  const songId = (id: string) => identities.localId('songs', id);
  const bookId = (id: string) => identities.localId('books', id);
  const songs = Array.from(catalog.records.values(), ({id, songbookId, local, link, entry}) => {
    const stored = entry?.id ? snapshot.state.publicationContent?.[entry.id] : undefined;
    const base = snapshot.state.bases[id];
    const localEdit = local && (!base || local.original !== base.original);
    const filename = link?.origin.filename || entry?.path.split('/').at(-1) || '';
    const metadata =
      stored && stored.rev === entry?.rev && !localEdit
        ? stored
        : local
          ? parseChordPro(local.original, local.title)
          : {title: filename.replace(/\.cho$/i, ''), key: null, time: null};
    return {
      id: songId(id),
      songbookId: bookId(songbookId),
      title: metadata.title,
      key: metadata.key,
      time: metadata.time,
      published: songLocation(entry?.path ?? (snapshot.state.remote ? '' : (link?.path ?? '')))?.area === 'Shared',
    };
  });
  const books = Array.from(catalog.books.values(), book => ({id: bookId(book.id), name: book.name}));
  return {songs, books};
}

export function publicationError(error: unknown): string {
  const {code, action} = failureInfo(error, 'publication');
  if (code === failureCodes.throttled) return 'Dropbox ber om en pause. Prøv igjen om litt.';
  if (action === 'reconnect') return 'Koble til Dropbox på nytt i Synkronisering.';
  if (code === failureCodes.permission)
    return 'Dropbox ga ikke nødvendig tilgang. Kontroller tilkoblingen i Synkronisering.';
  if (action === 'check-move' || error instanceof PublicationInProgress)
    return 'Dropbox har ennå ikke bekreftet alle flyttingene. Prøv igjen for å kontrollere status.';
  if (code === failureCodes.network || (error instanceof DeferredSync && error.reason === 'connection'))
    return 'Dropbox er utilgjengelig akkurat nå. Åpne Publisering på nytt når forbindelsen er tilbake.';
  if (error instanceof DeferredSync && error.reason === 'remote')
    return 'Dropbox har en uferdig overføring. Prøv igjen når den er ferdig.';
  return 'Kunne ikke fullføre Dropbox-handlingen. Prøv igjen.';
}
