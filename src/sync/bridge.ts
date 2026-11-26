import {RetrySync, SyncFailure, failureCodes} from '../core/failure.ts';
import {same} from './model.ts';
import {isBookPath, libraryPath, stagingPath, uploadIndexPath} from '../core/paths.ts';
import type {Manifest, RemoteFiles, SyncState, UploadClaim, UploadIndex, UploadJob} from '../core/sync-model.ts';

export function parseUploadIndex(text: string): UploadIndex {
  try {
    const value = JSON.parse(text);
    if (
      value?.version !== 1 ||
      !value.entries ||
      typeof value.entries !== 'object' ||
      Array.isArray(value.entries) ||
      (value.libraryRev !== undefined &&
        value.libraryRev !== null &&
        (typeof value.libraryRev !== 'string' || !value.libraryRev))
    )
      throw Error();
    const ids = new Set<string>();
    const owners = new Map<string, string>();
    const validId = (id: unknown) =>
      typeof id === 'string' &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(id) &&
      !['__proto__', 'constructor', 'prototype'].includes(id);
    for (const [id, row] of Object.entries(value.entries) as [string, UploadClaim][]) {
      if (
        !/^[a-f0-9-]{36}$/.test(id) ||
        row.operationId !== id ||
        !['content', 'original'].includes(row.role) ||
        !validId(row.song?.id) ||
        !row.song.origin ||
        typeof row.song.origin.filename !== 'string' ||
        !validId(row.book?.id) ||
        row.book.id !== row.song.songbookId ||
        typeof row.book.name !== 'string' ||
        !row.book.name ||
        typeof row.book.folderId !== 'string' ||
        !row.book.folderId ||
        !isBookPath(row.book.path ?? '') ||
        row.stagePath !== stagingPath(id) ||
        typeof row.fileId !== 'string' ||
        !row.fileId ||
        typeof row.rev !== 'string' ||
        !row.rev ||
        ids.has(row.fileId) ||
        (owners.has(row.book.folderId) && owners.get(row.book.folderId) !== row.book.id)
      )
        throw Error();
      owners.set(row.book.folderId, row.book.id);
      const folder = row.role === 'content' ? 'Private' : 'Originals';
      if (
        !row.target.startsWith(row.book.path + '/' + folder + '/') ||
        row.target.slice((row.book.path + '/' + folder + '/').length).includes('/') ||
        (row.role === 'content' && !/\.cho$/i.test(row.target))
      )
        throw Error();
      ids.add(row.fileId);
    }
    return value;
  } catch (cause) {
    throw new SyncFailure(
      {code: failureCodes.manifest, stage: 'sync.upload-index'},
      'Ugyldig metadata for uferdige opplastinger.',
      cause,
    );
  }
}
export function claimReady(claim: UploadClaim, manifest: Manifest) {
  if (manifest.deletedSongs?.[claim.song.id] || manifest.books[claim.book.id]?.deleted) return true;
  return Object.values(manifest.songs).some(link =>
    claim.role === 'content' ? link.fileId === claim.fileId : link.originalFile?.fileId === claim.fileId,
  );
}
/** Provenance bridge only: entries are never a ready-song acknowledgement. */
export function uploadBridge(
  files: RemoteFiles,
  state: SyncState,
  hooks: {check(): Promise<void>; save(): Promise<void>},
) {
  let loaded = false;
  async function load() {
    if (!loaded) {
      await hooks.check();
      const file = await files.read(uploadIndexPath);
      await hooks.check();
      state.uploadIndex = file ? {id: file.id, rev: file.rev, value: parseUploadIndex(file.text)} : undefined;
      const anchor = state.uploadIndex?.value.libraryRev;
      if (anchor !== undefined && anchor !== (state.library?.rev ?? null)) {
        // Listing, library and index are separate Dropbox reads. A newer index
        // may have already cleared the claims that our older library still needs.
        // Revisions are opaque: the index anchor can also be older, so verify the
        // actual library once rather than blindly retrying unequal revisions.
        await hooks.check();
        const actual = await (files.inspectFile ?? files.read)(libraryPath);
        await hooks.check();
        if ((actual?.rev ?? null) !== (state.library?.rev ?? null)) throw new RetrySync();
      }
      loaded = true;
    }
    return state.uploadIndex?.value ?? {version: 1 as const, entries: {}};
  }
  async function store(value: UploadIndex) {
    value = {...value, libraryRev: state.library?.rev ?? null};
    const previous = state.uploadIndex;
    await hooks.check();
    let file;
    try {
      file = await files.write(uploadIndexPath, JSON.stringify(value), previous?.rev ?? null);
    } catch (error) {
      if (error instanceof SyncFailure && error.info.code === failureCodes.changed) throw new RetrySync();
      throw error;
    }
    await hooks.check();
    state.uploadIndex = {id: file.id, rev: file.rev, value};
    await hooks.save();
  }
  async function publish(jobs: UploadJob[], manifest: Manifest) {
    const current = await load(),
      value: UploadIndex = {
        version: 1,
        entries: Object.fromEntries(
          Object.entries(current.entries).filter(([, claim]) => !claimReady(claim, manifest)),
        ),
      };
    for (const job of jobs) {
      const c = job.creation!;
      if (!c?.file) continue;
      const song = job.base.link ?? state.reservations[job.songId] ?? state.manifest.songs[job.songId],
        book = c.book ?? (song && state.folders[song.songbookId]);
      if (!song || !book?.folderId)
        throw new SyncFailure(
          {code: failureCodes.manifest, stage: 'sync.upload-index'},
          'Opplastingen mangler bekreftet sangbokidentitet.',
        );
      if (
        Object.values(value.entries).some(claim => claim.book.folderId === book.folderId && claim.book.id !== book.id)
      )
        throw new RetrySync();
      if (
        job.kind === 'original' &&
        Object.values(value.entries).some(
          claim => claim.role === 'original' && claim.song.id === job.songId && claim.fileId !== c.file!.id,
        )
      )
        throw new RetrySync();
      const operationId = c.path.split('/').at(-1)!.slice(0, -4);
      value.entries[operationId] = {
        operationId,
        role: job.kind === 'original' ? 'original' : 'content',
        song: {...song, ...(job.kind === 'content' ? {fileId: c.file.id, path: job.path} : {})},
        book: {...book},
        stagePath: c.path,
        target: job.path,
        fileId: c.file.id,
        rev: c.file.rev,
      };
    }
    // CAS precedes every move plan, including replays and alternate destinations.
    // A stale snapshot retries before making files visible in the user's folders.
    await store(value);
  }
  async function clearReady(manifest: Manifest) {
    const current = await load(),
      entries = Object.fromEntries(Object.entries(current.entries).filter(([, claim]) => !claimReady(claim, manifest)));
    if (!same(entries, current.entries) || (state.uploadIndex && current.libraryRev !== (state.library?.rev ?? null)))
      await store({version: 1, entries});
  }
  async function release(jobs: UploadJob[]) {
    const current = await load(),
      owned = new Set(jobs.flatMap(job => (job.creation ? [job.creation.path] : [])));
    const entries = Object.fromEntries(
      Object.entries(current.entries).filter(([, claim]) => !owned.has(claim.stagePath)),
    );
    if (!same(entries, current.entries)) await store({version: 1, entries});
  }
  return {load, publish, clearReady, release};
}
