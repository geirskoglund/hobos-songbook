import {parseChordPro} from '../domain/chordpro.ts';
import {parseManifest, same, songLocation, type PublicationChoice, type PublicationResult} from './model.ts';
import type {FileValue, MoveEntry} from '../core/sync-model.ts';
import type {SyncState} from './state.ts';
import {
  DeferredSync,
  failureCodes,
  failureInfo,
  SyncFailure,
  RetrySync,
  PublicationInProgress,
} from '../core/failure.ts';
import {pathKey} from './remote.ts';
import {SkippedFile} from '../core/limits.ts';
import {numberedPath} from './filenames.ts';
import {publicationCatalog, publicationError, publicationView} from './publication.ts';
import type {SyncSession} from './session.ts';
import {hasUnconfirmedNamespaceChanges} from './local-work.ts';
import {run} from './run.ts';
import {libraryPath} from '../core/paths.ts';
async function readPublicationInventory(s: SyncSession, fenced = false) {
  await s.step(() => s.index.refresh());
  const value = await s.step(() => (fenced ? s.files.inspectFile!(libraryPath) : s.files.read(libraryPath)));
  if (value) s.state.library = {id: value.id, rev: value.rev, value: parseManifest(value.text)};
  else if (s.state.library)
    throw new SyncFailure({code: failureCodes.manifest, stage: 'sync.manifest'}, 'Kjent bibliotekmetadata mangler.');
  return publicationCatalog(s.snapshot);
}
export async function refreshPublication(s: SyncSession) {
  s.manualRecovery = true;
  await s.start();
  const catalog = await readPublicationInventory(s);
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
async function savePublicationMoves(s: SyncSession) {
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
async function settlePublication(s: SyncSession, work: () => Promise<void>) {
  if (s.files.withMoveReceipt) await s.files.withMoveReceipt(work);
  else await work();
}
export async function executePublication(
  s: SyncSession,
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
    const preliminary = await readPublicationInventory(s);
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
      await run(s, false);
      s.manualRecovery = true;
      await s.start();
    }
    await s.fence.acquire();
    acquired = true;
    await readPublicationInventory(s, true);
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
    await savePublicationMoves(s);
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
        await settlePublication(s, () => savePublicationMoves(s));
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
export async function withSharedFolder(
  s: SyncSession,
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
    const catalog = await readPublicationInventory(s, true);
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
