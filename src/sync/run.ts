import type {Song} from '../core/song.ts';
import {hash, mergeManifest, ownSong, parseManifest, same, songLocation} from './model.ts';
import type {FileValue, MoveEntry, PersonalFile, SongLink, UploadIntent} from '../core/sync-model.ts';
import {emptyManifest, type Conflict, type Manifest} from './state.ts';
import {
  DeferredSync,
  failureCodes,
  failureInfo,
  BatchStatusUnconfirmed,
  SyncFailure,
  RetrySync,
} from '../core/failure.ts';
import {pathKey} from './remote.ts';
import {maxFileBytes, SkippedFile} from '../core/limits.ts';
import {songFilename, originalFilename, numberedPath} from './filenames.ts';
import {claimReady} from './bridge.ts';
import {archiveBooks, needsArchive} from './archive.ts';
import type {SyncSession} from './session.ts';
import {hasLocalWork, hasUnconfirmedNamespaceChanges, localManifest, personalOf} from './local-work.ts';
import {inspectRemovals, removedChanges} from './removals.ts';
import {discover, ensureBooks, finishBookNames, refreshBookNames} from './books.ts';
import {finishContent, prepareSong, songDestination, type SongPlan} from './song-plan.ts';
import {fetchImports, importsPending} from './shared-imports.ts';
import {deletedFolder, isBookPath, libraryPath, mutationPath, personalPath, syncErrorsPath} from '../core/paths.ts';

type Resolution = {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'};
type UploadResults = Awaited<ReturnType<SyncSession['uploads']['write']>>;

/**
 * Vanlig synkronisering. Fasene i rekkefølge:
 * 1. Ingen lokalt arbeid, eller manuell kontroll uten endringer i Dropbox: avslutt tidlig.
 * 2. Les biblioteket og flettegrunnlaget fra Dropbox under den delte låsen (readRemoteLibrary).
 * 3. Flett lokalt og fjernt bibliotek, opprett sangbokmapper og reserver nye stier (mergeLibrary).
 * 4. Synkroniser hver sang: persondata, innhold, flytting og originaler (syncSongs).
 * 5. Skriv biblioteket, bekreft det lokalt og fullfør arkivering og navneendringer.
 */
export async function run(s: SyncSession, manual: boolean, resolution?: Resolution) {
  s.manualRecovery = manual;
  await s.start();
  if (!manual && !resolution && !hasLocalWork(s)) {
    s.state.localGeneration = s.generation;
    s.hooks.idle?.();
    await s.save();
    return s.state;
  }
  const library = s.state.library?.value ?? s.state.manifest;
  const cleanState =
    !hasIncoming(s, library) &&
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
      s.state.localGeneration === s.generation &&
      (await confirmUnchanged(s, library))
    )
      return s.state;
    const {manifestFile, remote, base, publishedIds} = await readRemoteLibrary(s, manual);
    holdFirstJoinMatches(s);
    const {local, merged, pendingNames} = await mergeLibrary(s, remote, base, publishedIds, manual);
    await reservePaths(s, merged);
    const songs = await syncSongs(s, remote, merged, publishedIds, manual, resolution);
    const readySongs = songs.readySongs;
    let complete = songs.complete;
    merged.songs = readySongs;
    complete = settleBooks(merged, remote, readySongs, pendingNames) && complete;
    await writeLibrary(s, manifestFile, merged);
    acknowledgeLibrary(s, merged, local, readySongs);
    if (manual) await applyLibrary(s, merged, local);
    complete = (await settleNamespace(s, merged)) && complete;
    await clearReceipts(s, merged);
    complete &&=
      !s.state.conflicts.length &&
      !s.snapshot.songs.some(song => ownSong(song) && !merged.deletedSongs?.[song.id] && !readySongs[song.id]);
    complete &&= !Object.values(s.state.uploadIndex?.value.entries ?? {}).some(claim => !claimReady(claim, merged));
    if (
      Object.values(readySongs).some(link => s.snapshot.songs.some(song => song.id === link.id) && unprocessed(s, link))
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
    await recordFailure(s, error);
    throw error;
  }
}

/** Sangen er endret i Dropbox siden siste kjente grunnlag. */
function unprocessed(s: SyncSession, link: SongLink) {
  const basis = s.state.bases[link.id],
    entry = s.index.find(link.fileId ?? link.path);
  return (
    !basis ||
    entry?.rev !== basis.contentRev ||
    pathKey(entry?.path ?? '') !== pathKey(link.path) ||
    !s.index.unchangedFile(undefined, basis.personalRev, personalPath(link.id))
  );
}

/** Dropbox har endringer som ikke er tatt inn lokalt. */
function hasIncoming(s: SyncSession, library: Manifest) {
  const localBooks = new Map(s.snapshot.songbooks.map(book => [book.id, book]));
  const localSongs = new Map(s.snapshot.songs.map(song => [song.id, song]));
  const retiredPath = (path: string) =>
    Object.values(library.books).some(
      book => book.deleted && !book.folderId && book.path && pathKey(book.path) === pathKey(path),
    );
  // Reading the remote manifest in Publisering also advances the cursor.
  // The manual shortcut must still detect domain changes not applied locally.
  return (
    Object.values(library.books).some(book => {
      const local = localBooks.get(book.id);
      if (book.deleted) return Boolean(local);
      return (
        local?.name !== book.name ||
        Boolean(book.folderId && book.path && s.index.find(book.folderId)?.path !== book.path)
      );
    }) ||
    Object.values(library.songs).some(
      song => localSongs.get(song.id)?.songbookId !== song.songbookId || unprocessed(s, song),
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
    })
  );
}

/**
 * Manuell synkronisering uten lokale endringer: les bare endringslisten fra Dropbox.
 * Er ingenting endret, lagres kjøringen som fullført og funksjonen svarer true.
 */
async function confirmUnchanged(s: SyncSession, library: Manifest) {
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
    epochBefore = s.state.remote!.epoch;
  // Imports are read from their shared folders, which the index does not cover. Both are
  // asked at once; a full sync reuses the listings, and a changed import list shows in the index.
  const imports = importsPending(s).then(
    pending => ({pending}),
    error => ({error}),
  );
  try {
    await s.step(() => s.index.refresh());
  } finally {
    await imports;
  }
  s.indexFresh = true;
  const probe = await imports;
  if ('error' in probe) throw probe.error;
  const resetCleanup =
    epochBefore !== s.state.remote!.epoch &&
    Object.values(library.books).some(book => needsArchive(book, s.index.find));
  if (!same(before, domain()) || resetCleanup || probe.pending) return false;
  s.state.pending = false;
  s.state.localGeneration = s.generation;
  s.state.lastManual = new Date().toISOString();
  s.state.joined = true;
  await s.save({recoveryComplete: true});
  return true;
}

/**
 * Tar den delte låsen og leser biblioteket i Dropbox. Svarer med bibliotekfilen, det fjerne
 * biblioteket etter sletting og kobling av identiteter, flettegrunnlaget og ID-ene som var publisert.
 */
async function readRemoteLibrary(s: SyncSession, manual: boolean) {
  // Taken straight from our own release, the lock proves no device has changed the namespace
  // since this run's index refresh: the index is still current and needs no second listing.
  if (!((await s.fence.acquire()) && s.indexFresh)) await s.step(() => s.index.refresh());
  // A current index names the library's rev; the stored copy at that rev needs no download.
  const manifestFile = await s.read(libraryPath);
  if (manifestFile)
    s.state.library = {id: manifestFile.id, rev: manifestFile.rev, value: parseManifest(manifestFile.text)};
  if (!manifestFile && s.state.library)
    throw new SyncFailure({code: failureCodes.manifest, stage: 'sync.manifest'}, 'Kjent bibliotekmetadata mangler.');
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
  return {manifestFile, remote, base, publishedIds};
}

/**
 * Første synkronisering på en enhet: en lokal sang som har samme navn som en annen enhets
 * uferdige første opplasting i samme sangbok, venter til den opplastingen er ferdig.
 */
function holdFirstJoinMatches(s: SyncSession) {
  if (s.state.joined || s.state.lastManual) return;
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

/** Fletter lokalt og fjernt bibliotek og oppretter sangbokmappene. Manuelt også nye filer i Private. */
async function mergeLibrary(
  s: SyncSession,
  remote: Manifest,
  base: Manifest,
  publishedIds: Set<string>,
  manual: boolean,
) {
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
      for (const id of Object.keys(previous.songs)) if (!local.songs[id] && !remote.songs[id]) delete merged.songs[id];
      await s.save();
    }
    // New imported songs have no personal file yet, so they are not treated as published.
    for (const id of await fetchImports(s, merged)) publishedIds.delete(id);
    merged = mergeManifest(base, local, merged);
  }
  return {local, merged, pendingNames};
}

async function reservePaths(s: SyncSession, merged: Manifest) {
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
}

/** Feil som stopper hele kjøringen. Andre feil gjelder bare den ene sangen. */
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

/** Felles bokføring for sangene i én kjøring: hvilke som feilet, og om kjøringen er komplett. */
function songBatch(s: SyncSession) {
  const batch = {
    complete: true,
    failed: new Set<string>(),
    fail(id: string, error: unknown) {
      batch.complete = false;
      batch.failed.add(id);
      if (error instanceof SkippedFile) {
        (s.state.skipped ??= {})[id] = true;
        return;
      }
      s.state.failure = failureInfo(error, 'sync.song');
      s.hooks.failed?.(error);
    },
    async send(intents: UploadIntent[]) {
      try {
        const results = await s.uploads.write(intents);
        for (const intent of intents) {
          const result = results.get(intent.key);
          if (result && 'failure' in result)
            batch.fail(intent.songId, new SyncFailure(result.failure, 'En fil ble ikke overført.'));
        }
        return results;
      } catch (error) {
        if (fatal(error)) throw error;
        for (const intent of intents) batch.fail(intent.songId, error);
        await s.save();
        return new Map() as UploadResults;
      }
    },
  };
  return batch;
}
type SongBatch = ReturnType<typeof songBatch>;

/** Synkroniserer sangene i det flettede biblioteket. Svarer med sangene som er klare til publisering. */
async function syncSongs(
  s: SyncSession,
  remote: Manifest,
  merged: Manifest,
  publishedIds: Set<string>,
  manual: boolean,
  resolution?: Resolution,
) {
  const batch = songBatch(s);
  const readySongs: Manifest['songs'] = Object.fromEntries(
    Object.entries(remote.songs).filter(([id]) => publishedIds.has(id)),
  );
  const entries = Object.values(merged.songs);
  await seedPersonalFiles(s, batch, entries, publishedIds);
  const plans = await planSongs(s, batch, entries, {remote, merged, publishedIds, manual, resolution, readySongs});
  const contentResults = await batch.send(plans.flatMap(plan => (plan.contentIntent ? [plan.contentIntent] : [])));
  await moveSongs(s, batch, plans, contentResults, merged);
  await finishSongs(s, batch, plans, contentResults, manual, readySongs);
  return {complete: batch.complete, readySongs};
}

async function seedPersonalFiles(s: SyncSession, batch: SongBatch, entries: SongLink[], publishedIds: Set<string>) {
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
      batch.fail(entry.id, error);
    }
  });
  await batch.send(seeds);
}

/** Planlegger hver sang som er endret lokalt eller i Dropbox. Uendrede sanger blir klare med en gang. */
async function planSongs(
  s: SyncSession,
  batch: SongBatch,
  entries: SongLink[],
  {
    remote,
    merged,
    publishedIds,
    manual,
    resolution,
    readySongs,
  }: {
    remote: Manifest;
    merged: Manifest;
    publishedIds: Set<string>;
    manual: boolean;
    resolution?: Resolution;
    readySongs: Manifest['songs'];
  },
) {
  const plans: SongPlan[] = [];
  await s.parallel(entries, async entry => {
    if (s.state.held?.[entry.id] || batch.failed.has(entry.id)) return;
    if (!manual && !s.snapshot.songs.some(song => song.id === entry.id)) return;
    const current = s.snapshot.songs.find(song => song.id === entry.id),
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
    const needsOriginal = current && originalFilename(current) && !entry.originalFile && !s.state.originals?.[entry.id];
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
      else batch.complete = false;
    } catch (error) {
      if (fatal(error)) throw error;
      batch.fail(entry.id, error);
      await s.save();
    }
  });
  return plans;
}

/** Flytter sangfiler til riktig sangbok og område etter opplastingen av innholdet. */
async function moveSongs(
  s: SyncSession,
  batch: SongBatch,
  plans: SongPlan[],
  contentResults: UploadResults,
  merged: Manifest,
) {
  const transfers: MoveEntry[] = [];
  const targets = new Set<string>();
  for (const plan of plans) {
    if (batch.failed.has(plan.link.id)) continue;
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
}

/** Laster opp persondata og originaler, lagrer nytt grunnlag og tar valgt versjon inn lokalt. */
async function finishSongs(
  s: SyncSession,
  batch: SongBatch,
  plans: SongPlan[],
  contentResults: UploadResults,
  manual: boolean,
  readySongs: Manifest['songs'],
) {
  const finishing: Awaited<ReturnType<typeof finishContent>>[] = [];
  await s.parallel(plans, async plan => {
    if (batch.failed.has(plan.link.id)) return;
    if (plan.contentIntent) {
      const result = contentResults.get(plan.contentIntent.key);
      if (!result || !('value' in result)) return;
    }
    try {
      finishing.push(await finishContent(s, plan));
    } catch (error) {
      if (fatal(error)) throw error;
      batch.fail(plan.link.id, error);
      await s.save();
    }
  });
  const finalResults = await batch.send(finishing.flatMap(plan => plan.intents));
  for (const plan of finishing) {
    const {link, basis, chosenSong, chosenPersonal, contentChoice, personChoice, local} = plan;
    if (batch.failed.has(link.id) || plan.intents.some(intent => !finalResults.has(intent.key))) continue;
    const result = finalResults.get(`personal:${link.id}`),
      savedPerson: FileValue | null = plan.savedPerson ?? (result && 'value' in result ? result.value : null);
    if (!savedPerson) {
      batch.complete = false;
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
    else batch.complete = false;
  }
}

/**
 * Holder igjen sangbøker som ikke kan publiseres ennå: en slettet sangbok med sanger som
 * ikke er flyttet, og en sangbok med samme navn som en annen. Svarer false hvis noe ble holdt igjen.
 */
function settleBooks(merged: Manifest, remote: Manifest, readySongs: Manifest['songs'], pendingNames: Set<string>) {
  let complete = true;
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
  return complete;
}

async function writeLibrary(s: SyncSession, manifestFile: FileValue | null, merged: Manifest) {
  const finalText = JSON.stringify(merged);
  // Validate invariants before publishing, including IDs learned during uploads.
  parseManifest(finalText);
  // Conditional whole-manifest write preserves independent remote changes or stops for retry.
  if (!manifestFile || !same(parseManifest(manifestFile.text), merged))
    await s.write(libraryPath, finalText, manifestFile?.rev ?? null);
}

/** Lagrer i synktilstanden hva det skrevne biblioteket bekrefter. */
function acknowledgeLibrary(s: SyncSession, merged: Manifest, local: Manifest, readySongs: Manifest['songs']) {
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
  for (const book of Object.values(merged.books).filter(b => b.deleted)) s.state.manifest.books[book.id] = {...book};
  for (const [key, copy] of Object.entries(s.state.reservations))
    if (
      key.startsWith('copy:') &&
      !s.state.decisions[`${key.slice(5)}:content`] &&
      (merged.songs[copy.id] || merged.deletedSongs?.[copy.id])
    )
      delete s.state.reservations[key];
}

/** Manuell synkronisering: tar sangbøker og slettinger fra Dropbox inn lokalt og rydder persondata. */
async function applyLibrary(s: SyncSession, merged: Manifest, local: Manifest) {
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

/**
 * Arkiverer slettede sangbøker og fullfører navneendringer. Svarer false hvis en
 * navneendring må vente på en senere kjøring.
 */
async function settleNamespace(s: SyncSession, merged: Manifest) {
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
  return !names.waiting;
}

/** Fjerner kvitteringer for flyttinger og nye sangbøker som biblioteket nå bekrefter. */
async function clearReceipts(s: SyncSession, merged: Manifest) {
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
    if (merged.songs[id]?.fileId === receipt.fileId || merged.deletedSongs?.[id]) delete s.state.movedPublications![id];
  for (const id of Object.keys(s.state.movedBooks ?? {}))
    if (s.state.manifest.books[id] && merged.books[id] && s.state.manifest.books[id].name === merged.books[id].name)
      delete s.state.movedBooks![id];
  for (const id of Object.keys(s.state.createdBooks ?? {}))
    if (s.state.manifest.books[id] && merged.books[id] && s.state.manifest.books[id].name === merged.books[id].name)
      delete s.state.createdBooks![id];
}

async function recordFailure(s: SyncSession, error: unknown) {
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
}
