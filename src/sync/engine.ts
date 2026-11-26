import {parseChordPro} from '../domain/chordpro.ts';
import type {Song} from '../core/song.ts';
import type {syncStorage} from '../storage/sync.ts';
import {
  hash,
  mergeManifest,
  ownSong,
  parseManifest,
  same,
  songLocation,
  type PublicationChoice,
  type PublicationResult,
} from './model.ts';
import {
  emptyManifest,
  type Conflict,
  type FileValue,
  type Manifest,
  type MoveEntry,
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
import {maxFileBytes, SkippedFile} from '../core/limits.ts';
import {songFilename, originalFilename, numberedPath} from './filenames.ts';
import {claimReady} from './bridge.ts';
import {archiveBooks, needsArchive} from './archive.ts';
import {publicationCatalog, publicationError, publicationView} from './publication.ts';
import {PausedSync, SyncSession, type SyncHooks} from './session.ts';
import {hasLocalWork, hasUnconfirmedNamespaceChanges, localManifest, personalOf} from './local-work.ts';
import {inspectRemovals, removedChanges} from './removals.ts';
import {discover, ensureBooks, finishBookNames, refreshBookNames} from './books.ts';
import {finishContent, prepareSong, songDestination, type SongPlan} from './song-plan.ts';
import {deletedFolder, isBookPath, libraryPath, mutationPath, personalPath, syncErrorsPath} from '../core/paths.ts';
export {PausedSync};
export function syncEngine(
  storage: ReturnType<typeof syncStorage>,
  files: RemoteFiles,
  accountId: string,
  hooks: SyncHooks,
) {
  const s = new SyncSession(storage, files, accountId, hooks);
  async function run(manual: boolean, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) {
    s.manualRecovery = manual;
    await s.start();
    if (!manual && !resolution && !hasLocalWork(s)) {
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
        !hasLocalWork(s) &&
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
      await inspectRemovals(s, remote);
      s.removedIds = new Set(Object.keys(remote.deletedSongs ?? {}));
      await s.uploads.recover();
      for (const [id, link] of Object.entries(s.confirmedLinks)) base.songs[id] ??= structuredClone(link);
      if (s.identities.reconcile(remote)) {
        s.snapshot = s.identities.project();
        await s.save();
      }
      await inspectRemovals(s, remote);
      s.state.skipped = {};
      if (manual) await refreshBookNames(s, remote);
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
      let local = localManifest(s);
      // The automatically seeded Standard book is not a conflicting user edit on a new device.
      if (s.identities.emptySeed() && Object.keys(remote.books).length) local.books = {};
      let merged = mergeManifest(base, local, remote);
      const pendingNames = await ensureBooks(s, merged);
      if (manual) {
        await discover(s, merged, publishedIds);
        if (await s.identities.songs(merged, ownSong, s.uploads.discard, s.uploads.discardMany)) {
          const previous = local;
          s.snapshot = s.identities.project();
          local = localManifest(s);
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
        const desired = `${songDestination(s, entry, merged.books)}/${entry.path.split('/').at(-1)}`;
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
            s,
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
        const parent = songDestination(s, plan.link, merged.books),
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
          finishing.push(await finishContent(s, plan));
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
        const removed = removedChanges(s, merged);
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
      const names = await finishBookNames(s, merged);
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
      if (!s.state.placement?.jobId && !hasUnconfirmedNamespaceChanges(s))
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
      if (acquired && !s.state.placement && !hasUnconfirmedNamespaceChanges(s)) {
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
    if (s.state.placement || hasUnconfirmedNamespaceChanges(s)) {
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
