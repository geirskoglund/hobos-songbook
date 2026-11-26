import {parseChordPro} from '../domain/chordpro.ts';
import {reconcilePersonal} from '../domain/annotations.ts';
import {songbookName} from '../domain/songbook.ts';
import type {Song, SongPersonal} from '../core/song.ts';
import type {syncStorage, SyncSnapshot} from '../storage/sync.ts';
import {
  direction,
  hash,
  mergeManifest,
  ownSong,
  parseManifest,
  parsePersonal,
  personalData,
  same,
  songLocation,
  type PublicationChoice,
  type PublicationResult,
} from './model.ts';
import {
  emptyManifest,
  type BookLink,
  type Conflict,
  type FileValue,
  type Manifest,
  type MoveEntry,
  type FolderEntry,
  type PersonalFile,
  type RemoteFiles,
  type SongLink,
  type SyncState,
  type UploadIntent,
} from '../core/sync-model.ts';
import {
  DeferredSync,
  failureCodes,
  failureInfo,
  BatchStatusUnconfirmed,
  SyncFailure,
  RetrySync,
  PublicationInProgress,
} from '../core/failure.ts';
import {pathKey} from './remote.ts';
import {checkSize, textBytes, maxFileBytes, SkippedFile} from '../core/limits.ts';
import {songFilename, originalFilename, numberedPath} from './filenames.ts';
import {claimReady} from './bridge.ts';
import {archiveBooks, needsArchive} from './archive.ts';
import {publicationCatalog, publicationError, publicationView} from './publication.ts';
import {PausedSync, SyncSession, type SyncHooks} from './session.ts';
import {
  appFolder,
  bookAreas,
  bookPath,
  deletedFolder,
  isBookPath,
  libraryPath,
  mutationPath,
  personalFolder,
  personalPath,
  renameStagingPath,
  songbooksFolder,
  syncErrorsPath,
} from '../core/paths.ts';
const personalOf = (snapshot: SyncSnapshot, id: string) =>
  personalData(snapshot.personal.find(p => p.songId === id) ?? {songId: id, version: 3, chorus: {}});
function fromRemote(link: SongLink, text: string): Song {
  const parsed = parseChordPro(text, link.origin.filename.replace(/\.[^.]+$/, ''));
  return {
    id: link.id,
    songbookId: link.songbookId,
    origin: link.origin,
    original: text,
    title: parsed.title,
    key: parsed.key,
  };
}
function project(personal: SongPersonal, source: Song, target: Song) {
  return personalData(source.original === target.original ? personal : reconcilePersonal(source, target, personal));
}
export {PausedSync};
export function syncEngine(
  storage: ReturnType<typeof syncStorage>,
  files: RemoteFiles,
  accountId: string,
  hooks: SyncHooks,
) {
  const s = new SyncSession(storage, files, accountId, hooks);
  function remoteBookName(value: string, books: BookLink[], ownId?: string) {
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
  function localManifest(): Manifest {
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
  function hasLocalWork() {
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
    return false;
  }
  function deleteSong(remote: Manifest, link: SongLink) {
    (remote.deletedSongs ??= {})[link.id] = {
      id: link.id,
      ...(link.fileId ? {fileId: link.fileId} : {}),
      songbookId: link.songbookId,
    };
    delete remote.songs[link.id];
  }
  async function inspectRemovals(remote: Manifest) {
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
    for (const link of Object.values(remote.songs))
      if (remote.books[link.songbookId]?.deleted) deleteSong(remote, link);
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
  function removedChanges(remote: Manifest) {
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
  async function refreshBookNames(remote: Manifest) {
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
  async function ensureBooks(merged: Manifest) {
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
  async function finishBookNames(merged: Manifest) {
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
  async function discover(remote: Manifest, publishedIds: Set<string>) {
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
  async function personalFile(
    link: SongLink,
    content: FileValue,
    fresh: boolean,
  ): Promise<{file: PersonalFile; value: FileValue | null; original: string}> {
    const value = await s.read(personalPath(link.id));
    if (!value) {
      if (!fresh)
        throw new SyncFailure(
          {code: failureCodes.personal, stage: 'sync.personal'},
          'Personfilen for en kjent sang mangler.',
        );
      return {
        value: null,
        original: content.text,
        file: {
          version: 1,
          songId: link.id,
          original: {rev: content.rev, hash: await hash(content.text)},
          data: {songId: link.id, version: 3, chorus: {}},
        },
      };
    }
    const file = parsePersonal(value.text, link.id);
    let original = content.text;
    if ((await hash(content.text)) !== file.original.hash) {
      const previous = await s.read(`rev:${file.original.rev}`);
      if (!previous || (await hash(previous.text)) !== file.original.hash)
        throw new SyncFailure(
          {code: failureCodes.original, stage: 'sync.original'},
          'Persondataenes originalgrunnlag er utilgjengelig.',
        );
      original = previous.text;
    }
    return {value, file, original};
  }
  async function prepareSong(
    link: SongLink,
    remoteKnown: boolean,
    manual: boolean,
    resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'},
  ) {
    const local = s.snapshot.songs.find(song => song.id === link.id),
      basis = s.state.bases[link.id];
    // A readable path without a confirmed ID may belong to another importer.
    // Only the durable creation journal can acknowledge a new physical file.
    const content = !link.fileId && local && !remoteKnown ? null : await s.read(link.fileId ?? link.path);
    if (!content && (remoteKnown || !local)) throw new RetrySync();
    const localPersonal = local && personalOf(s.snapshot, local.id);
    const remoteSong = content && fromRemote(link, content.text);
    const fresh = !remoteKnown;
    const person = content ? await personalFile(link, content, fresh) : null;
    // A newly discovered file has no sidecar yet; establish its default remote
    // layer so the existing conflict dialog can reference a concrete revision.
    const remotePersonal = person?.value ? personalData(person.file.data) : undefined;
    if (
      resolution &&
      (!content ||
        content.rev !== resolution.conflict.contentRev ||
        person?.value?.rev !== resolution.conflict.personalRev ||
        !same(local, resolution.conflict.local) ||
        !same(localPersonal, resolution.conflict.localPersonal))
    ) {
      // A dialog choice belongs to the displayed snapshots, never to a later revision.
      delete s.state.decisions[`${link.id}:content`];
      delete s.state.decisions[`${link.id}:personal`];
      resolution = undefined;
    }

    let contentChoice = direction(local?.original, content?.text, basis?.original, manual);
    let personChoice = direction(
      localPersonal,
      remotePersonal,
      basis?.personalRev ? basis.personal.data : undefined,
      manual,
    );
    if (resolution) {
      s.state.decisions[`${link.id}:${resolution.conflict.kind}`] = resolution;
      await s.save();
    }
    let contentDecision = s.state.decisions[`${link.id}:content`],
      personDecision = s.state.decisions[`${link.id}:personal`];
    for (const decision of [contentDecision, personDecision])
      if (
        decision &&
        (decision.conflict.contentRev !== content?.rev ||
          decision.conflict.personalRev !== person?.value?.rev ||
          !same(decision.conflict.local, local) ||
          !same(decision.conflict.localPersonal, localPersonal))
      ) {
        delete s.state.decisions[`${link.id}:${decision.conflict.kind}`];
        if (decision.conflict.kind === 'content') contentDecision = undefined!;
        else personDecision = undefined!;
      }
    if (contentDecision) contentChoice = contentDecision.choice === 'local' ? 'upload' : 'download';
    if (personDecision) personChoice = personDecision.choice === 'local' ? 'upload' : 'download';
    s.state.conflicts = s.state.conflicts.filter(c => c.songId !== link.id);
    const conflicts: Conflict[] = [];
    if (local && remoteSong && content && person?.value) {
      for (const kind of ['content', 'personal'] as const)
        if ((kind === 'content' ? contentChoice : personChoice) === 'conflict')
          conflicts.push({
            songId: link.id,
            kind,
            title: local.title,
            local,
            localPersonal: localPersonal!,
            remote: remoteSong,
            remotePersonal: remotePersonal!,
            remotePersonalOriginal: person.original,
            contentRev: content.rev,
            personalRev: person.value.rev,
            personalFile: person.file,
            generation: s.generation,
          });
    }
    if (conflicts.length) {
      s.state.conflicts.push(...conflicts);
      await s.save();
    }
    // A content choice must not silently dispose of a separate personal conflict.
    if (contentChoice === 'conflict' || personChoice === 'conflict') return false;
    const waitingRemote = contentChoice === 'remote' || personChoice === 'remote';
    if (waitingRemote) s.state.awaitingDownload = true;
    const chosenSong = contentChoice === 'download' || !local ? remoteSong! : {...local, songbookId: link.songbookId};
    const chosenPersonal =
      personChoice === 'download' || !local
        ? project(personalData(person!.file.data), {...remoteSong!, original: person!.original}, chosenSong)
        : project(localPersonal!, local, chosenSong);
    if (contentDecision?.choice === 'copy') {
      const copyId = s.state.reservations[`copy:${link.id}`]?.id ?? crypto.randomUUID();
      if (!s.snapshot.songs.some(song => song.id === copyId) && !s.removedIds.has(copyId)) {
        const copy: Song = {...local!, id: copyId, origin: {...local!.origin, kind: 'local'}};
        const copied = structuredClone(localPersonal!);
        copied.songId = copyId;
        for (const annotation of Object.values(copied.annotations ?? {})) annotation.anchor.songId = copyId;
        s.state.reservations[`copy:${link.id}`] = {
          id: copyId,
          songbookId: copy.songbookId,
          origin: copy.origin,
          path: '',
        };
        await s.save({songs: [copy], personal: [copied]});
        s.snapshot.songs.push(copy);
        s.snapshot.personal.push(copied);
      }
    }
    checkSize(textBytes(chosenSong.original));
    const personal: PersonalFile = {
      version: 1,
      songId: link.id,
      original: {rev: content?.rev ?? '', hash: await hash(chosenSong.original)},
      data: chosenPersonal,
    };
    const contentIntent: UploadIntent | undefined =
      contentChoice === 'upload'
        ? {
            key: `content:${link.id}`,
            songId: link.id,
            kind: 'content',
            path: content?.path ?? link.path,
            text: chosenSong.original,
            rev: content?.rev ?? null,
            ...(content ? {fileId: content.id} : {}),
            base: {original: chosenSong.original, personal, link: {...link}},
          }
        : undefined;
    return {
      link,
      local,
      basis,
      content,
      person,
      contentChoice,
      personChoice,
      chosenSong,
      chosenPersonal,
      waitingRemote,
      apply: manual || Boolean(contentDecision || personDecision),
      contentIntent,
    };
  }
  type SongPlan = Exclude<Awaited<ReturnType<typeof prepareSong>>, false>;
  async function finishContent(plan: SongPlan) {
    const {link, chosenSong, chosenPersonal, basis, contentChoice, personChoice, person, local} = plan;
    const content = plan.content;
    if (!content)
      throw new SyncFailure(
        {code: failureCodes.missingFile, stage: 'sync.file'},
        'Ingen sangfilversjon er tilgjengelig.',
      );
    if (plan.contentIntent?.rev === null) link.path = content.path;
    link.path = content.path;
    link.fileId = content.id;
    s.state.reservations[link.id] = {...link};
    await s.save();
    const referenceRev = contentChoice === 'remote' ? basis!.contentRev : content.rev;
    const nextPerson: PersonalFile = {
      version: 1,
      songId: link.id,
      original: {rev: referenceRev, hash: await hash(chosenSong.original)},
      data: chosenPersonal,
    };
    const savedPerson =
      personChoice === 'remote' ? person!.value! : person?.value && same(nextPerson, person.file) ? person.value : null;
    const intents: UploadIntent[] = [];
    if (!savedPerson)
      intents.push({
        key: `personal:${link.id}`,
        songId: link.id,
        kind: 'personal',
        path: personalPath(link.id),
        text: JSON.stringify(nextPerson),
        rev: person?.value?.rev ?? null,
        ...(person?.value ? {fileId: person.value.id} : {}),
        base: {original: chosenSong.original, personal: nextPerson},
      });
    const sourceName = local && originalFilename(local);
    if (link.originalFile) {
      (s.state.originals ??= {})[link.id] = true;
      await s.uploads.discardOriginal(link.id);
    }
    if (
      local &&
      sourceName &&
      !link.originalFile &&
      !s.state.originals?.[link.id] &&
      !s.uploads.originalPending(link.id)
    ) {
      // Old generated copies are identified from their deterministic metadata
      // name; adopting their ID does not rename or rewrite the user's file.
      const stem =
        local.origin.filename
          .replace(/\.[^.]+$/, '')
          .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')
          .slice(0, 100) || 'Sang';
      const oldLeaf = `${stem}--${await hash(link.id)}.${local.origin.filename.split('.').at(-1)}`;
      const legacy = Object.values(s.state.remote?.entries ?? {}).filter(
        entry =>
          !entry.folder &&
          /\/Originals\//i.test(entry.path) &&
          pathKey(entry.path.split('/').at(-1)!) === pathKey(oldLeaf),
      );
      if (legacy.length === 1 && legacy[0].id) {
        link.originalFile = {fileId: legacy[0].id, path: legacy[0].path};
        s.state.reservations[link.id] = {...link};
        (s.state.originals ??= {})[link.id] = true;
      }
    }
    if (
      local &&
      sourceName &&
      !link.originalFile &&
      !s.state.originals?.[link.id] &&
      !s.uploads.originalPending(link.id)
    ) {
      const prefix = `${s.state.folders[link.songbookId].path}/Originals/`,
        prior = s.state.uploads?.[`original:${link.id}`]?.path;
      const path = prior && pathKey(prior).startsWith(pathKey(prefix)) ? prior : prefix + sourceName;
      intents.push({
        key: `original:${link.id}`,
        songId: link.id,
        kind: 'original',
        path,
        text: local.original,
        rev: null,
        base: {original: chosenSong.original, personal: nextPerson, link: {...link}},
      });
    }
    for (const intent of intents) checkSize(textBytes(intent.text));
    return {...plan, content, referenceRev, nextPerson, savedPerson, intents};
  }
  function songDestination(link: SongLink, books: Manifest['books']) {
    const parent = s.state.folders[link.songbookId]?.path ?? bookPath(books[link.songbookId].name);
    const current = songLocation(s.index.find(link.fileId ?? link.path)?.path ?? link.path);
    // Only confirmed book transfers change Shared to Private. File edits within
    // the same book stay where Dropbox currently has the song.
    const area = current && pathKey(current.bookPath) === pathKey(parent) ? current.area : 'Private';
    return `${parent}/${area}`;
  }
  async function run(manual: boolean, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) {
    s.manualRecovery = manual;
    await s.start();
    if (!manual && !resolution && !hasLocalWork()) {
      s.state.localGeneration = s.generation;
      s.hooks.idle?.();
      await s.save();
      return s.state;
    }
    const library = s.state.library?.value ?? s.state.manifest;
    const localBooks = new Map(s.snapshot.songbooks.map(book => [book.id, book]));
    const localSongs = new Map(s.snapshot.songs.map(song => [song.id, song]));
    const retiredPath = (path: string) =>
      Object.values(library.books).some(
        book => book.deleted && !book.folderId && book.path && pathKey(book.path) === pathKey(path),
      );
    const unprocessed = (link: SongLink) => {
      const basis = s.state.bases[link.id],
        entry = s.index.find(link.fileId ?? link.path);
      return (
        !basis ||
        entry?.rev !== basis.contentRev ||
        pathKey(entry?.path ?? '') !== pathKey(link.path) ||
        !s.index.unchangedFile(undefined, basis.personalRev, personalPath(link.id))
      );
    };
    // Reading the remote manifest in Publisering also advances the cursor.
    // The manual shortcut must still detect domain changes not applied locally.
    const incoming =
      Object.values(library.books).some(book => {
        const local = localBooks.get(book.id);
        if (book.deleted) return Boolean(local);
        return (
          local?.name !== book.name ||
          Boolean(book.folderId && book.path && s.index.find(book.folderId)?.path !== book.path)
        );
      }) ||
      Object.values(library.songs).some(
        song => localSongs.get(song.id)?.songbookId !== song.songbookId || unprocessed(song),
      ) ||
      s.snapshot.songs.some(song => library.deletedSongs?.[song.id]) ||
      Object.values(s.state.remote?.entries ?? {}).some(entry => {
        if (entry.folder && isBookPath(entry.path))
          return !retiredPath(entry.path) && !Object.values(library.books).some(book => book.folderId === entry.id);
        if (
          !entry.folder &&
          /^\/Songbooks\/[^/]+\/Private\/[^/]+\.cho$/i.test(entry.path) &&
          (entry.size ?? 0) <= maxFileBytes
        )
          return (
            !retiredPath(entry.path.split('/').slice(0, 3).join('/')) &&
            !Object.values(library.songs).some(song => song.fileId === entry.id)
          );
        return false;
      });
    const cleanState =
      !incoming &&
      !s.state.cleanupPending &&
      !s.state.pending &&
      !s.state.awaitingDownload &&
      !Object.keys(s.state.held ?? {}).length &&
      !s.snapshot.songs.some(song => s.state.manifest.deletedSongs?.[song.id]) &&
      !s.snapshot.songbooks.some(book => s.state.manifest.books[book.id]?.deleted);
    delete s.state.error;
    delete s.state.failure;
    s.state.pending = true;
    s.state.awaitingDownload = false;
    try {
      // A cursor-only check has no namespace effects and needs no shared fence.
      // Ignore only our mutex and diagnostic log; library/provenance changes
      // still require fenced, fresh processing. No stale snapshot is published.
      if (
        cleanState &&
        manual &&
        !resolution &&
        !hasLocalWork() &&
        s.state.remote &&
        !s.state.conflicts.length &&
        s.state.localGeneration === s.generation
      ) {
        const domain = () =>
          Object.fromEntries(
            Object.entries(s.state.remote!.entries)
              .filter(
                ([path]) =>
                  path !== pathKey(deletedFolder) &&
                  !path.startsWith(pathKey(deletedFolder) + '/') &&
                  ![mutationPath, syncErrorsPath].includes(path),
              )
              .map(([path, entry]) => [
                path,
                {
                  id: entry.id,
                  path: entry.path,
                  folder: Boolean(entry.folder),
                  ...(!entry.folder ? {rev: entry.rev} : {}),
                },
              ]),
          );
        const before = structuredClone(domain()),
          epochBefore = s.state.remote.epoch;
        await s.step(() => s.index.refresh());
        const resetCleanup =
          epochBefore !== s.state.remote.epoch &&
          Object.values(library.books).some(book => needsArchive(book, s.index.find));
        if (same(before, domain()) && !resetCleanup) {
          s.state.pending = false;
          s.state.localGeneration = s.generation;
          s.state.lastManual = new Date().toISOString();
          s.state.joined = true;
          await s.save({recoveryComplete: true});
          return s.state;
        }
      }
      await s.fence.acquire();
      await s.step(() => s.index.refresh());
      const manifestFile = await s.step(() => (s.files.inspectFile ?? s.files.read)(libraryPath));
      if (manifestFile)
        s.state.library = {id: manifestFile.id, rev: manifestFile.rev, value: parseManifest(manifestFile.text)};
      if (!manifestFile && s.state.library)
        throw new SyncFailure(
          {code: failureCodes.manifest, stage: 'sync.manifest'},
          'Kjent bibliotekmetadata mangler.',
        );
      await s.namespace.recover();
      const remote = manifestFile ? parseManifest(manifestFile.text) : emptyManifest();
      const published = structuredClone(remote);
      s.uploads.observeManifest(published);
      s.claims = Object.values((await s.uploads.claims()).entries).filter(claim => !claimReady(claim, published));
      // A confirmed folder is a real component basis even before the first
      // manifest commit. Capture it before fresh remote bindings/names replace it.
      const base: Manifest = structuredClone({
        ...s.state.manifest,
        books: {
          ...Object.fromEntries(Object.entries(s.state.folders).filter(([, book]) => book.folderId)),
          ...s.state.manifest.books,
          ...s.state.createdBooks,
          ...s.state.movedBooks,
        },
        songs: {
          ...Object.fromEntries(
            Object.entries(s.state.reservations).filter(([key, link]) => !key.startsWith('copy:') && link.fileId),
          ),
          ...s.state.manifest.songs,
          ...s.state.movedSongs,
        },
      });
      for (const claim of s.claims) {
        if (
          Object.values(remote.books).some(book => book.folderId === claim.book.folderId) ||
          remote.books[claim.book.id]?.deleted
        )
          continue;
        const folder = s.index.find(claim.book.folderId!);
        if (folder?.folder && isBookPath(folder.path))
          remote.books[claim.book.id] = {
            ...claim.book,
            path: folder.path,
            name: s.state.renames?.[claim.book.id] ? claim.book.name : folder.path.split('/').at(-1)!,
          };
      }
      if (s.identities.reconcile(remote)) {
        s.snapshot = s.identities.project();
        await s.save();
      }
      const publishedIds = new Set([...Object.keys(s.state.manifest.songs), ...Object.keys(remote.songs)]);
      await inspectRemovals(remote);
      s.removedIds = new Set(Object.keys(remote.deletedSongs ?? {}));
      await s.uploads.recover();
      for (const [id, link] of Object.entries(s.confirmedLinks)) base.songs[id] ??= structuredClone(link);
      if (s.identities.reconcile(remote)) {
        s.snapshot = s.identities.project();
        await s.save();
      }
      await inspectRemovals(remote);
      s.state.skipped = {};
      if (manual) await refreshBookNames(remote);
      const joinedBooks = s.identities.books(remote),
        joinedSongs = await s.identities.songs(remote, ownSong, s.uploads.discard, s.uploads.discardMany);
      if (joinedBooks || joinedSongs) {
        s.snapshot = s.identities.project();
        await s.save();
      }
      if (!s.state.joined && !s.state.lastManual) {
        const key = (song: Song) => JSON.stringify([song.songbookId, song.origin.filename.normalize('NFC')]);
        const locals = s.snapshot.songs.filter(ownSong);
        for (const song of locals) {
          if (!song.origin.filename) continue;
          if (
            s.state.reservations[song.id]?.fileId ||
            s.state.manifest.songs[song.id] ||
            Object.entries(s.state.reservations).some(([id, link]) => id.startsWith('copy:') && link.id === song.id) ||
            locals.filter(other => key(other) === key(song)).length !== 1
          )
            continue;
          const matches = s.claims.filter(
            claim =>
              claim.role === 'content' &&
              claim.song.id !== song.id &&
              claim.book.folderId === s.state.folders[song.songbookId]?.folderId &&
              claim.song.origin.filename.normalize('NFC') === song.origin.filename.normalize('NFC'),
          );
          if (new Set(matches.map(claim => claim.song.id)).size === 1) {
            s.state.held ??= {};
            s.state.held[song.id] = true;
            s.state.awaitingDownload = true;
          }
        }
      }
      let local = localManifest();
      // The automatically seeded Standard book is not a conflicting user edit on a new device.
      if (s.identities.emptySeed() && Object.keys(remote.books).length) local.books = {};
      let merged = mergeManifest(base, local, remote);
      const pendingNames = await ensureBooks(merged);
      if (manual) {
        await discover(merged, publishedIds);
        if (await s.identities.songs(merged, ownSong, s.uploads.discard, s.uploads.discardMany)) {
          const previous = local;
          s.snapshot = s.identities.project();
          local = localManifest();
          for (const id of Object.keys(previous.songs))
            if (!local.songs[id] && !remote.songs[id]) delete merged.songs[id];
          await s.save();
        }
        merged = mergeManifest(base, local, merged);
      }
      // Reserve all new file paths before contacting Dropbox, including ambiguous-response retries.
      for (const song of s.snapshot.songs.filter(ownSong)) {
        const entry = merged.songs[song.id];
        if (!entry) continue;
        if (!entry.path) {
          const reserved = s.state.reservations[song.id];
          entry.path = reserved?.path || `${merged.books[song.songbookId].path}/Private/${songFilename(song)}`;
          s.state.reservations[song.id] = {...entry};
          await s.save();
        }
      }
      let complete = true;
      const readySongs: Manifest['songs'] = Object.fromEntries(
        Object.entries(remote.songs).filter(([id]) => publishedIds.has(id)),
      );
      const entries = Object.values(merged.songs);
      const failed = new Set<string>();
      function fail(id: string, error: unknown) {
        complete = false;
        failed.add(id);
        if (error instanceof SkippedFile) {
          (s.state.skipped ??= {})[id] = true;
          return;
        }
        s.state.failure = failureInfo(error, 'sync.song');
        s.hooks.failed?.(error);
      }
      function fatal(error: unknown) {
        return (
          error instanceof DeferredSync ||
          error instanceof BatchStatusUnconfirmed ||
          (error instanceof SyncFailure &&
            [failureCodes.network, failureCodes.authentication, failureCodes.permission, failureCodes.throttled].some(
              code => code === error.info.code,
            ))
        );
      }
      async function send(intents: UploadIntent[]) {
        try {
          const results = await s.uploads.write(intents);
          for (const intent of intents) {
            const result = results.get(intent.key);
            if (result && 'failure' in result)
              fail(intent.songId, new SyncFailure(result.failure, 'En fil ble ikke overført.'));
          }
          return results;
        } catch (error) {
          if (fatal(error)) throw error;
          for (const intent of intents) fail(intent.songId, error);
          await s.save();
          return new Map();
        }
      }
      // First-join conflicts need concrete remote personal revisions. Establish
      // these defaults in a batch rather than one upload per discovered match.
      const seeds: UploadIntent[] = [];
      await s.parallel(entries, async entry => {
        if (publishedIds.has(entry.id) || s.state.held?.[entry.id]) return;
        if (
          !s.snapshot.songs.some(song => song.id === entry.id) ||
          !Object.values(s.state.bindings?.songs ?? {}).includes(entry.id)
        )
          return;
        try {
          const content = await s.read(entry.fileId ?? entry.path);
          if (!content || (await s.read(personalPath(entry.id)))) return;
          const personal: PersonalFile = {
            version: 1,
            songId: entry.id,
            original: {rev: content.rev, hash: await hash(content.text)},
            data: {songId: entry.id, version: 3, chorus: {}},
          };
          seeds.push({
            key: `seed:${entry.id}`,
            songId: entry.id,
            kind: 'seed',
            path: personalPath(entry.id),
            text: JSON.stringify(personal),
            rev: null,
            base: {original: content.text, personal},
          });
        } catch (error) {
          if (fatal(error)) throw error;
          fail(entry.id, error);
        }
      });
      await send(seeds);
      const plans: SongPlan[] = [];
      await s.parallel(entries, async entry => {
        if (s.state.held?.[entry.id] || failed.has(entry.id)) return;
        if (!manual && !s.snapshot.songs.some(song => song.id === entry.id)) return;
        const current = s.snapshot.songs.find(s => s.id === entry.id),
          base = s.state.bases[entry.id],
          prior = s.state.manifest.songs[entry.id];
        const desired = `${songDestination(entry, merged.books)}/${entry.path.split('/').at(-1)}`;
        const localSame = Boolean(
          current &&
          base &&
          prior &&
          base.personal.original.rev === base.contentRev &&
          current.original === base.original &&
          same(personalOf(s.snapshot, entry.id), base.personal.data) &&
          current.songbookId === entry.songbookId &&
          same(current.origin, entry.origin) &&
          entry.path === desired,
        );
        const remoteSame = Boolean(
          base &&
          s.index.unchangedFile(entry.fileId, base.contentRev, entry.path) &&
          s.index.unchangedFile(undefined, base.personalRev, personalPath(entry.id)),
        );
        const unfinished = Object.values(s.state.uploads ?? {}).some(
          job => job.songId === entry.id && job.status !== 'done',
        );
        const needsOriginal =
          current && originalFilename(current) && !entry.originalFile && !s.state.originals?.[entry.id];
        if (localSame && !unfinished && !needsOriginal && (!resolution || resolution.conflict.songId !== entry.id)) {
          if (remoteSame) {
            readySongs[entry.id] = entry;
            return;
          }
          if (!manual) {
            s.state.awaitingDownload = true;
            readySongs[entry.id] = entry;
            return;
          }
        }
        try {
          const plan = await prepareSong(
            entry,
            publishedIds.has(entry.id) && Boolean(remote.songs[entry.id]),
            manual,
            resolution?.conflict.songId === entry.id ? resolution : undefined,
          );
          if (plan) plans.push(plan);
          else complete = false;
        } catch (error) {
          if (fatal(error)) throw error;
          fail(entry.id, error);
          await s.save();
        }
      });
      const contentResults = await send(plans.flatMap(plan => (plan.contentIntent ? [plan.contentIntent] : [])));
      const transfers: MoveEntry[] = [];
      const targets = new Set<string>();
      for (const plan of plans) {
        if (failed.has(plan.link.id)) continue;
        if (plan.contentIntent) {
          const result = contentResults.get(plan.contentIntent.key);
          if (!result || !('value' in result)) continue;
          plan.content = result.value;
        }
        if (!plan.content) continue;
        if (plan.contentIntent?.rev === null) plan.link.path = plan.content.path;
        const parent = songDestination(plan.link, merged.books),
          baseTarget = parent + '/' + plan.content.path.split('/').at(-1);
        let target = baseTarget,
          n = 1;
        while (targets.has(pathKey(target)) || (s.index.find(target) && s.index.find(target)!.id !== plan.content.id))
          target = numberedPath(baseTarget, ++n);
        targets.add(pathKey(target));
        if (plan.content.path !== target) {
          const source = songLocation(plan.content.path),
            sourceBookFolderId = source && s.index.find(source.bookPath)?.id;
          if (!source || (s.state.remote && !sourceBookFolderId)) throw new RetrySync();
          const destination = await s.folder(parent);
          transfers.push({
            key: 'song:' + plan.link.id,
            from: plan.content.id,
            to: target,
            toReference: destination.id + '/' + target.split('/').at(-1),
            fileId: plan.content.id,
            link: {...plan.link, path: target},
            sourceBookFolderId,
          });
        }
      }
      if (transfers.length) {
        await s.namespace.move(transfers);
        for (const plan of plans) {
          const moved = s.state.movedSongs?.[plan.link.id];
          if (moved && plan.content) {
            plan.content = {...plan.content, path: moved.path};
            plan.link.path = moved.path;
          }
        }
      }
      const finishing: Awaited<ReturnType<typeof finishContent>>[] = [];
      await s.parallel(plans, async plan => {
        if (failed.has(plan.link.id)) return;
        if (plan.contentIntent) {
          const result = contentResults.get(plan.contentIntent.key);
          if (!result || !('value' in result)) return;
        }
        try {
          finishing.push(await finishContent(plan));
        } catch (error) {
          if (fatal(error)) throw error;
          fail(plan.link.id, error);
          await s.save();
        }
      });
      const finalResults = await send(finishing.flatMap(plan => plan.intents));
      for (const plan of finishing) {
        const {link, basis, chosenSong, chosenPersonal, contentChoice, personChoice, local} = plan;
        if (failed.has(link.id) || plan.intents.some(intent => !finalResults.has(intent.key))) continue;
        const result = finalResults.get(`personal:${link.id}`),
          savedPerson = plan.savedPerson ?? (result && 'value' in result ? result.value : null);
        if (!savedPerson) {
          complete = false;
          continue;
        }
        s.state.bases[link.id] = {
          original: contentChoice === 'remote' ? basis!.original : chosenSong.original,
          personal: personChoice === 'remote' ? basis!.personal : plan.nextPerson,
          contentRev: plan.referenceRev,
          personalRev: personChoice === 'remote' ? basis!.personalRev : savedPerson.rev,
        };
        if (s.state.reservations[link.id]?.originalFile) link.originalFile = s.state.reservations[link.id].originalFile;
        delete s.state.decisions[`${link.id}:content`];
        delete s.state.decisions[`${link.id}:personal`];
        if (plan.apply)
          await s.save({
            ...(manual
              ? {
                  books: Object.values(s.state.folders)
                    .filter(b => !b.deleted)
                    .map(({id, name}) => ({id, name})),
                }
              : {}),
            songs: [{...chosenSong, songbookId: manual ? link.songbookId : (local?.songbookId ?? link.songbookId)}],
            personal: [chosenPersonal],
          });
        else await s.save();
        if (!plan.waitingRemote) readySongs[link.id] = link;
        else complete = false;
      }
      merged.songs = readySongs;
      for (const [id, book] of Object.entries(merged.books))
        if (book.deleted && Object.values(readySongs).some(song => song.songbookId === id)) {
          if (!remote.books[id])
            throw new SyncFailure(
              {code: failureCodes.bookChanges, stage: 'sync.book-state'},
              'Flytting av sangene er ikke fullført.',
            );
          merged.books[id] = remote.books[id];
          complete = false;
        }
      // A conflict can postpone retiring the old book. Do not publish a second
      // active book under that name; the owner retains the staged identity.
      for (const id of pendingNames) {
        const book = merged.books[id];
        if (!book) continue;
        const duplicate = Object.values(merged.books).some(
          other => other.id !== id && !other.deleted && pathKey(other.name) === pathKey(book.name),
        );
        if (duplicate) {
          complete = false;
          if (remote.books[id]) book.name = remote.books[id].name;
          else {
            delete merged.books[id];
            for (const [songId, link] of Object.entries(merged.songs))
              if (link.songbookId === id) delete merged.songs[songId];
          }
        }
      }
      const finalText = JSON.stringify(merged);
      // Validate invariants before publishing, including IDs learned during uploads.
      parseManifest(finalText);
      // Conditional whole-manifest write preserves independent remote changes or stops for retry.
      if (!manifestFile || !same(parseManifest(manifestFile.text), merged))
        await s.write(libraryPath, finalText, manifestFile?.rev ?? null);
      // Only acknowledge the local identities actually represented in this manifest.
      for (const [id, book] of Object.entries(local.books))
        if (
          merged.books[id] &&
          book.name === merged.books[id].name &&
          Boolean(book.deleted) === Boolean(merged.books[id].deleted)
        )
          s.state.manifest.books[id] = merged.books[id];
      for (const song of s.snapshot.songs)
        if (readySongs[song.id]?.songbookId === song.songbookId && same(readySongs[song.id].origin, song.origin))
          s.state.manifest.songs[song.id] = readySongs[song.id];
      if (merged.deletedSongs) s.state.manifest.deletedSongs = {...merged.deletedSongs};
      for (const book of Object.values(merged.books).filter(b => b.deleted))
        s.state.manifest.books[book.id] = {...book};
      for (const [key, copy] of Object.entries(s.state.reservations))
        if (
          key.startsWith('copy:') &&
          !s.state.decisions[`${key.slice(5)}:content`] &&
          (merged.songs[copy.id] || merged.deletedSongs?.[copy.id])
        )
          delete s.state.reservations[key];
      if (manual) {
        const books = Object.values(merged.books)
          .filter(b => !b.deleted && !local.books[b.id]?.deleted)
          .map(({id, name}) => ({
            ...s.snapshot.songbooks.find(b => b.id === id),
            id,
            name: s.state.renames?.[id] ? (s.snapshot.songbooks.find(b => b.id === id)?.name ?? name) : name,
          }));
        const deleted = s.snapshot.songbooks
          .filter(b => merged.books[b.id]?.deleted || (!local.books[b.id] && !merged.books[b.id]))
          .map(b => b.id);
        const cleanup = Object.keys(merged.deletedSongs ?? {}).flatMap(id => {
          const sourcePath = personalPath(id),
            entry = s.index.find(sourcePath);
          return entry?.id && entry.rev
            ? [
                {
                  key: 'personal:' + id,
                  path: entry.id,
                  fileId: entry.id,
                  rev: entry.rev,
                  sourcePath,
                  category: 'personal' as const,
                },
              ]
            : [];
        });
        s.state.manifest = structuredClone(merged);
        const removed = removedChanges(merged);
        await s.save({
          books,
          deleteBooks: [...new Set([...deleted, ...removed.deleteBooks])],
          deleteSongs: removed.deleteSongs,
        });
        await s.namespace.remove(cleanup);
      }
      const publish = async (value: Manifest) => {
        const text = JSON.stringify(value);
        parseManifest(text);
        await s.write(libraryPath, text, s.state.library?.rev ?? null);
        for (const book of Object.values(value.books))
          if (book.deleted || s.state.manifest.books[book.id]) s.state.manifest.books[book.id] = structuredClone(book);
        for (const link of Object.values(value.songs)) {
          const previous = s.state.manifest.songs[link.id];
          if (previous?.fileId === link.fileId && previous?.songbookId === link.songbookId)
            s.state.manifest.songs[link.id] = structuredClone(link);
        }
        await s.save();
      };
      await archiveBooks(merged, s.files, s.state, {
        check: () => s.check(),
        save: () => s.save(),
        find: s.index.find,
        move: s.namespace.move,
        publish,
      });
      const names = await finishBookNames(merged);
      if (names.changed) await publish(merged);
      s.state.archivePending = names.waiting;
      complete &&= !names.waiting;
      await s.uploads.clearClaims(merged);
      for (const id of Object.keys(s.state.movedSongs ?? {}))
        if (
          (s.state.manifest.songs[id] &&
            merged.songs[id] &&
            s.state.manifest.songs[id].songbookId === merged.songs[id].songbookId) ||
          merged.deletedSongs?.[id]
        )
          delete s.state.movedSongs![id];
      for (const [id, receipt] of Object.entries(s.state.movedPublications ?? {}))
        if (merged.songs[id]?.fileId === receipt.fileId || merged.deletedSongs?.[id])
          delete s.state.movedPublications![id];
      for (const id of Object.keys(s.state.movedBooks ?? {}))
        if (s.state.manifest.books[id] && merged.books[id] && s.state.manifest.books[id].name === merged.books[id].name)
          delete s.state.movedBooks![id];
      for (const id of Object.keys(s.state.createdBooks ?? {}))
        if (s.state.manifest.books[id] && merged.books[id] && s.state.manifest.books[id].name === merged.books[id].name)
          delete s.state.createdBooks![id];
      complete &&=
        !s.state.conflicts.length &&
        !s.snapshot.songs.some(song => ownSong(song) && !merged.deletedSongs?.[song.id] && !readySongs[song.id]);
      complete &&= !Object.values(s.state.uploadIndex?.value.entries ?? {}).some(claim => !claimReady(claim, merged));
      if (
        Object.values(readySongs).some(link => s.snapshot.songs.some(song => song.id === link.id) && unprocessed(link))
      ) {
        complete = false;
        s.state.awaitingDownload = true;
      }
      s.state.pending = !complete;
      if (complete) s.state.localGeneration = s.generation;
      if (manual && complete) s.state.lastManual = new Date().toISOString();
      if (manual && complete) s.state.joined = true;
      s.uploads.clearDone();
      await s.save({recoveryComplete: manual && complete});
      if (!s.state.archivePending) await s.fence.release();
      return s.state;
    } catch (error) {
      delete s.state.error;
      s.state.pending = true;
      if (error instanceof DeferredSync) {
        delete s.state.failure;
        if (error.reason === 'remote') s.state.awaitingDownload = true;
      } else {
        s.state.failure = failureInfo(error, 'sync.run');
        s.hooks.failed?.(error);
      }
      // A stale run must not acknowledge work or overwrite state belonging to a newer session.
      try {
        await s.save();
      } catch {
        /* The next safe run starts from durable progress. */
      }
      // Keep the fence for known staging jobs and unconfirmed namespace work.
      // With no staging job ID, the shared upload index and unique source
      // paths already protect recovery while other devices sync.
      if (!s.state.placement?.jobId && !hasUnconfirmedNamespaceChanges())
        try {
          await s.fence.release();
        } catch {
          /* Same owner resumes; never expire an unknown release. */
        }
      throw error;
    }
  }
  async function readPublicationInventory(fenced = false) {
    await s.step(() => s.index.refresh());
    const value = await s.step(() => (fenced ? s.files.inspectFile!(libraryPath) : s.files.read(libraryPath)));
    if (value) s.state.library = {id: value.id, rev: value.rev, value: parseManifest(value.text)};
    else if (s.state.library)
      throw new SyncFailure({code: failureCodes.manifest, stage: 'sync.manifest'}, 'Kjent bibliotekmetadata mangler.');
    return publicationCatalog(s.snapshot);
  }

  async function refreshPublication() {
    s.manualRecovery = true;
    await s.start();
    const catalog = await readPublicationInventory();
    const previous = s.state.publicationContent ?? {};
    const content: NonNullable<SyncState['publicationContent']> = {};
    await s.parallel(Array.from(catalog.records.values()), async ({id, local, link, entry}) => {
      if (!entry?.id || !entry.rev || !link) return;
      const basis = s.state.bases[id];
      if (local && (!basis || local.original !== basis.original || entry.rev === basis.contentRev)) return;
      const known = previous[entry.id];
      if (known?.rev === entry.rev) {
        content[entry.id] = known;
        return;
      }
      let value: FileValue | null;
      try {
        value = await s.read(entry.id);
      } catch (error) {
        if (error instanceof SkippedFile || error instanceof TypeError) return;
        throw error;
      }
      if (!value || value.id !== entry.id || pathKey(value.path) !== pathKey(entry.path)) throw new RetrySync();
      const {title, key, time} = parseChordPro(
        value.text,
        (link.origin.filename || entry.path.split('/').at(-1)!).replace(/\.[^.]+$/, ''),
      );
      content[entry.id] = {rev: value.rev, title, key, time};
    });
    s.state.publicationContent = content;
    const view = publicationView(s.snapshot, s.identities);
    await s.save();
    return view;
  }

  async function savePublicationMoves() {
    const receipts = s.state.movedPublications ?? {};
    if (!Object.keys(receipts).length) return;
    const {manifest, records} = publicationCatalog(s.snapshot);
    const value = structuredClone(manifest);
    const acknowledged: string[] = [];
    for (const [id, receipt] of Object.entries(receipts)) {
      const entry = records.get(id)?.entry,
        link = value.songs[id];
      if (link?.fileId !== receipt.fileId || !entry || entry.id !== receipt.fileId) continue;
      value.songs[id] = {...link, path: entry.path};
      acknowledged.push(id);
    }
    if (!same(value, manifest)) {
      const text = JSON.stringify(value);
      parseManifest(text);
      await s.write(libraryPath, text, s.state.library?.rev ?? null);
    }
    for (const id of acknowledged) {
      if (s.state.manifest.songs[id]?.fileId === value.songs[id].fileId) s.state.manifest.songs[id] = value.songs[id];
      s.state.reservations[id] = value.songs[id];
      delete receipts[id];
    }
    await s.save();
  }

  async function settlePublication(work: () => Promise<void>) {
    if (s.files.withMoveReceipt) await s.files.withMoveReceipt(work);
    else await work();
  }

  function hasUnconfirmedNamespaceChanges() {
    return (
      s.state.namespaceJob?.submitted ||
      s.state.archivePending ||
      Object.keys(s.state.movedSongs ?? {}).length ||
      Object.keys(s.state.movedPublications ?? {}).length ||
      Object.keys(s.state.movedBooks ?? {}).length ||
      Object.keys(s.state.renames ?? {}).length
    );
  }

  async function executePublication(
    choices: PublicationChoice[],
    retryConflicts = false,
    confirmedMoves = new Set<string>(),
  ): Promise<PublicationResult> {
    s.manualRecovery = true;
    await s.start();
    s.publicationMoves = confirmedMoves;
    let verified = false,
      acquired = false,
      conflict = false,
      failure: unknown;
    const desired = () => new Map(choices.map(choice => [s.identities.wireId('songs', choice.id), choice.published]));
    try {
      const preliminary = await readPublicationInventory();
      verified = true;
      const needsFirstUpload = [...desired()].some(
        ([id, published]) =>
          published &&
          preliminary.records.get(id)?.local &&
          !preliminary.manifest.songs[id] &&
          !s.state.manifest.songs[id]?.fileId &&
          !preliminary.manifest.deletedSongs?.[id],
      );
      if (needsFirstUpload && !s.snapshot.journal.recoveryRequired && !s.state.namespaceJob) {
        // The ordinary, already authorized outbox prepares the initial Private
        // file and sidecar. Publication never creates a replacement in Shared.
        await run(false);
        s.manualRecovery = true;
        await s.start();
      }
      await s.fence.acquire();
      acquired = true;
      await readPublicationInventory(true);
      await s.namespace.recover();
      const {records, roots, find} = publicationCatalog(s.snapshot);
      const targets = new Set<string>();
      const moves: MoveEntry[] = [];
      for (const [id, published] of desired()) {
        const item = records.get(id),
          entry = item?.entry,
          link = item?.link;
        if (!entry?.id || !entry.rev || !link) continue;
        const location = songLocation(entry.path)!;
        const area = published ? 'Shared' : 'Private';
        if (location.area === area) {
          if (link.path !== entry.path) (s.state.movedPublications ??= {})[id] = {...link, path: entry.path};
          continue;
        }
        const root = roots.get(link.songbookId)!;
        const parent = find(`${root.path}/${area}`);
        if (!parent?.folder || !parent.id) continue;
        if (
          Object.values(s.state.uploads ?? {}).some(
            job => job.songId === id && job.kind === 'content' && job.status === 'committing',
          )
        )
          continue;
        const basis = s.state.bases[id],
          local = item.local;
        if (local && (!basis || (local.original !== basis.original && entry.rev !== basis.contentRev))) {
          let current: FileValue | null;
          try {
            current = await s.read(entry.id);
          } catch (error) {
            if (error instanceof SkippedFile) {
              conflict = true;
              continue;
            }
            throw error;
          }
          if (
            current?.id !== entry.id ||
            current.rev !== entry.rev ||
            (current.text !== local.original && current.text !== basis?.original)
          ) {
            conflict = true;
            continue;
          }
        }
        const base = `${parent.path}/${location.name}`;
        let target = base,
          number = 1;
        while (targets.has(pathKey(target)) || find(target)) target = numberedPath(base, ++number);
        targets.add(pathKey(target));
        moves.push({
          key: `publication:${id}`,
          from: entry.id,
          fileId: entry.id,
          to: target,
          toReference: `${parent.id}/${target.split('/').at(-1)}`,
          link: {...link, path: target},
          publication: {sourcePath: entry.path, rev: entry.rev},
        });
      }
      if (moves.length) await s.namespace.move(moves);
      await savePublicationMoves();
      await s.save();
    } catch (error) {
      failure = error;
      const pending = s.state.namespaceJob;
      if (
        acquired &&
        failureInfo(error).code === failureCodes.network &&
        pending?.submitted &&
        pending.kind === 'move' &&
        pending.entries.every(entry => (entry as MoveEntry).publication)
      ) {
        // The reply can be lost while metadata is still reachable. Only check
        // the submitted operation. Never re-send the choices after this failure.
        try {
          await s.namespace.recover();
          failure = undefined;
        } catch (cause) {
          failure = cause;
        }
      }
      // A terminated partial batch can have receipts from earlier chunks. If
      // Dropbox is unreachable their journal remains under the shared fence.
      if (
        acquired &&
        (!(failure instanceof DeferredSync) || failure instanceof PublicationInProgress) &&
        failureInfo(failure).code !== failureCodes.network
      ) {
        try {
          await settlePublication(savePublicationMoves);
        } catch (cause) {
          failure ??= cause;
        }
      }
      try {
        await s.save();
      } catch {
        /* Do not acknowledge a newer local s.generation. */
      }
    } finally {
      s.publicationMoves = undefined;
      if (acquired && !s.state.placement && !hasUnconfirmedNamespaceChanges()) {
        try {
          await s.fence.release();
        } catch (error) {
          failure ??= error;
        }
      }
    }
    if (retryConflicts && failure instanceof RetrySync) throw failure;
    const {records} = publicationCatalog(s.snapshot);
    const completed = verified
      ? choices
          .filter(choice => {
            const entry = records.get(s.identities.wireId('songs', choice.id))?.entry;
            return entry && (songLocation(entry.path)?.area === 'Shared') === choice.published;
          })
          .map(choice => choice.id)
      : [];
    const pending = s.state.namespaceJob;
    if (pending?.kind === 'move' && pending.reply && 'entries' in pending.reply) {
      pending.reply.entries.forEach((result, i) => {
        const entry = pending.entries[i] as MoveEntry;
        if (
          entry?.publication &&
          entry.link &&
          'value' in result &&
          result.value.id === entry.fileId &&
          pathKey(result.value.path) === pathKey(entry.to)
        ) {
          confirmedMoves.add(s.identities.localId('songs', entry.link.id));
        }
      });
    }
    const unavailable =
      (failure instanceof DeferredSync && failure.reason === 'connection') ||
      [failureCodes.network, failureCodes.authentication, failureCodes.permission].some(
        code => code === failureInfo(failure).code,
      );
    const message = failure
      ? publicationError(failure)
      : conflict
        ? 'Synkroniser og avklar sangversjonen før du prøver de gjenstående valgene igjen.'
        : completed.length !== choices.length
          ? 'Kontroller tilkoblingen og at sangene er synkronisert, og prøv de gjenstående valgene igjen.'
          : undefined;
    return {
      view: publicationView(s.snapshot, s.identities),
      completed,
      moved: completed.filter(id => confirmedMoves.has(id)),
      message,
      unavailable,
    };
  }

  async function withSharedFolder(
    localBookId: string,
    link: (folder: {id: string; path: string}, verifyTarget: () => Promise<void>) => Promise<string>,
  ) {
    s.manualRecovery = true;
    await s.start();
    if (s.state.placement || hasUnconfirmedNamespaceChanges()) {
      throw new SyncFailure(
        {code: failureCodes.changed, stage: 'publication.shared-folder'},
        'Fullfør den ventende Dropbox-flyttingen før du kopierer delingslenken.',
      );
    }
    let completed = false;
    try {
      // Hold the same account-wide fence as book moves through link lookup and
      // creation. A stable folder ID can otherwise follow a book into Deleted.
      await s.fence.acquire();
      const catalog = await readPublicationInventory(true);
      const bookId = s.identities.wireId('books', localBookId);
      const root = catalog.roots.get(bookId);
      const shared = root && catalog.find(`${root.path}/Shared`);
      if (!shared?.folder || !shared.id) {
        throw new SyncFailure(
          {code: failureCodes.missingFolder, stage: 'publication.shared-folder'},
          'Sangboken må synkroniseres før den kan få en delingslenke.',
        );
      }
      const target = {id: shared.id, path: shared.path};
      const verifyTarget = async () => {
        await s.check();
        const actual = await s.rawFiles.locateFolder(target.id);
        await s.check();
        if (actual?.id !== target.id || pathKey(actual.path) !== pathKey(target.path)) {
          throw new SyncFailure(
            {code: failureCodes.changed, stage: 'publication.shared-folder'},
            'Sangbokens delingsmappe har flyttet seg. Kontroller sangboken og prøv igjen.',
          );
        }
      };
      const url = await link(target, verifyTarget);
      await verifyTarget();
      completed = true;
      return url;
    } finally {
      try {
        await s.fence.release();
      } catch (error) {
        // eslint-disable-next-line no-unsafe-finally -- a failed release after a completed publication must reach the caller
        if (completed) throw error;
      }
    }
  }

  return {run, refreshPublication, executePublication, withSharedFolder};
}
