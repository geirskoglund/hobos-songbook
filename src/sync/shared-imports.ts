import type {FileValue, MoveEntry, SharedListing} from '../core/sync-model.ts';
import type {ImportSource, ImportSourceFile, ImportStateFile, Manifest} from './state.ts';
import type {SyncSession} from './session.ts';
import type {ImportRemoval, SharedImport} from '../domain/shared-import.ts';
import {importStatePath, importsPath} from '../core/paths.ts';
import {failureCodes, SyncFailure} from '../core/failure.ts';
import {maxBatchAppendBytes, maxFileBytes, SkippedFile, textBytes} from '../core/limits.ts';
import {DropboxError} from '../adapters/dropbox.ts';
import {pathKey} from './remote.ts';
import {clearRemovals, readImports, type ImportList} from './imports.ts';
import {deleteSong} from './removals.ts';
import {same} from './model.ts';

/**
 * Henting fra importenes delte mapper ved manuell Synkroniser (#101 F09–F15).
 *
 * Hver import kopieres til `Import/<importnavn>/` i sin sangbok. Kopiene blir vanlige sanger i
 * biblioteket, så persondata, nedlasting til enhetene og sletting følger den vanlige synken.
 * `/.app/import-state.json` kobler kildens filer til sangene og holder en cursor per mappe,
 * fordi Dropbox ikke lister en delingslenke rekursivt. Uendret kilde koster ett kall per mappe.
 */

const validId = /^[a-zA-Z0-9_-]{1,128}$/;
const unsafeKey = (id: string) => ['__proto__', 'constructor', 'prototype'].includes(id);
const parent = (path: string) => path.slice(0, path.lastIndexOf('/'));
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function parseState(text: string): ImportStateFile {
  const value: unknown = JSON.parse(text);
  const invalid = () =>
    new SyncFailure({code: failureCodes.response, stage: 'imports.state'}, 'Ukjent format på importtilstanden.');
  if (!record(value) || value.version !== 1 || !record(value.imports)) throw invalid();
  for (const [id, source] of Object.entries(value.imports)) {
    if (!validId.test(id) || unsafeKey(id) || !record(source) || !record(source.files) || !record(source.folders))
      throw invalid();
    for (const [fileId, file] of Object.entries(source.files))
      if (
        unsafeKey(fileId) ||
        !record(file) ||
        typeof file.songId !== 'string' ||
        !validId.test(file.songId) ||
        typeof file.path !== 'string' ||
        !file.path.startsWith('/') ||
        typeof file.hash !== 'string' ||
        (file.own !== undefined &&
          (!record(file.own) ||
            typeof file.own.id !== 'string' ||
            typeof file.own.rev !== 'string' ||
            typeof file.own.hash !== 'string'))
      )
        throw invalid();
    for (const folder of Object.values(source.folders))
      if (!record(folder) || typeof folder.path !== 'string' || typeof folder.cursor !== 'string') throw invalid();
  }
  return value as unknown as ImportStateFile;
}

/** A failure that belongs to one import's shared folder and does not stop the sync (#101 F15). */
function sourceFailure(error: unknown) {
  if (error instanceof DropboxError) return error.status !== 401 && error.status !== 429;
  return error instanceof SyncFailure && error.info.code === failureCodes.permission;
}

/** Runs a shared-link call with the session's guards; Dropbox' 409 answers are not retried as a sync. */
async function guarded<T>(s: SyncSession, operation: () => Promise<T>): Promise<T> {
  await s.check();
  const result = await operation();
  await s.check();
  return result;
}

/** The registered imports and removals, with wire book IDs. The saved list is used while its rev is current. */
async function registeredImports(s: SyncSession): Promise<Omit<ImportList, 'rev'>> {
  const entry = s.index.find(importsPath);
  if (!entry?.rev) return {imports: [], removals: []};
  const saved = 'imports' in s.storage ? await s.storage.imports(s.accountId) : undefined;
  if (saved?.rev === entry.rev && saved.removals) return {imports: saved.imports, removals: saved.removals};
  const current = await s.step(() => readImports(s.files));
  if ('saveImports' in s.storage) await s.storage.saveImports(s.accountId, current);
  return current;
}

async function readState(s: SyncSession): Promise<{rev: string | null; value: ImportStateFile}> {
  const entry = s.index.find(importStatePath),
    cached = s.state.sharedImports?.file;
  if (!entry?.rev) return {rev: null, value: {version: 1, imports: {}}};
  if (cached?.rev === entry.rev) return {rev: cached.rev, value: structuredClone(cached.value)};
  const file = await s.read(importStatePath);
  if (!file) return {rev: null, value: {version: 1, imports: {}}};
  const value = parseState(file.text);
  (s.state.sharedImports ??= {status: {}}).file = {id: file.id, rev: file.rev, value: structuredClone(value)};
  return {rev: file.rev, value};
}

/** Lists one folder; a probe earlier in the same run already answered the same request. */
async function listFolder(s: SyncSession, item: SharedImport, path: string, cursor?: string): Promise<SharedListing> {
  const key = JSON.stringify([item.id, pathKey(path), cursor ?? '']),
    known = s.importListings.get(key);
  if (known) return known;
  const listing = await guarded(s, () => s.rawFiles.listShared!(item.folder, path, cursor));
  s.importListings.set(key, listing);
  return listing;
}

/**
 * Reads the source's current files into a new mapping. Known folders are continued from their
 * cursors; new folders are listed. Files the source no longer has are marked gone, not removed.
 */
async function scan(s: SyncSession, item: SharedImport, source: ImportSource): Promise<ImportSource> {
  const next: ImportSource = {files: structuredClone(source.files), folders: {}};
  const removed = new Set<string>(),
    unknown: {id: string; path: string; hash: string}[] = [],
    queue = [''],
    seen = new Set<string>();
  const knownChildren = (path: string) =>
    Object.values(source.folders).filter(folder => folder.path && pathKey(parent(folder.path)) === pathKey(path));
  const filesAt = (path: string) => Object.values(next.files).filter(file => pathKey(file.path) === pathKey(path));
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const key = pathKey(path);
    if (seen.has(key) || removed.has(key)) continue;
    seen.add(key);
    const prior = source.folders[key];
    let listing: SharedListing;
    try {
      listing = await listFolder(s, item, path, prior?.cursor);
    } catch (error) {
      // A subfolder that can no longer be read is gone; the link itself failing fails the import.
      if (path && error instanceof DropboxError && error.status === 409) {
        removed.add(key);
        continue;
      }
      throw error;
    }
    next.folders[key] = {path, cursor: listing.cursor};
    for (const entry of listing.entries)
      if (entry.kind === 'deleted') {
        const child = `${path}/${entry.name}`;
        if (source.folders[pathKey(child)]) removed.add(pathKey(child));
        for (const file of filesAt(child)) file.gone = true;
      }
    const folders = new Set<string>(),
      present = new Set<string>();
    for (const entry of listing.entries) {
      const child = `${path}/${entry.name}`;
      if (entry.kind === 'folder') {
        folders.add(pathKey(child));
        removed.delete(pathKey(child));
        queue.push(child);
      } else if (entry.kind === 'file') {
        const file = next.files[entry.id];
        // F10: only .cho files within the size limit are fetched.
        if (!/\.cho$/i.test(entry.name) || entry.size > maxFileBytes) {
          if (file) file.gone = true;
          continue;
        }
        present.add(entry.id);
        if (file) {
          file.path = child;
          file.hash = entry.hash;
          delete file.gone;
        } else unknown.push({id: entry.id, path: child, hash: entry.hash});
      }
    }
    if (!prior || listing.reset) {
      // A full listing names every child: what it leaves out is gone.
      for (const [id, file] of Object.entries(next.files))
        if (pathKey(parent(file.path)) === key && !present.has(id)) file.gone = true;
      for (const folder of knownChildren(path))
        if (!folders.has(pathKey(folder.path))) removed.add(pathKey(folder.path));
    } else for (const folder of knownChildren(path)) if (!removed.has(pathKey(folder.path))) queue.push(folder.path);
  }
  for (const key of removed)
    for (const file of Object.values(next.files)) if (pathKey(file.path).startsWith(key + '/')) file.gone = true;
  // F13: a new file with the name of a removed one in the same folder is the same song.
  for (const file of unknown) {
    const match = Object.entries(next.files).find(
      ([, known]) => known.gone && pathKey(known.path) === pathKey(file.path),
    );
    if (match) {
      delete next.files[match[0]];
      const {gone: _gone, ...kept} = match[1];
      next.files[file.id] = {...kept, path: file.path, hash: file.hash};
    } else next.files[file.id] = {songId: '', path: file.path, hash: file.hash};
  }
  return next;
}

/** Uploads copies with the same batch transport as songs; a refused copy gives no value. */
async function upload(s: SyncSession, jobs: {path: string; text: string; rev: string | null}[]) {
  const values = new Map<number, FileValue>();
  const single = async (index: number) => {
    const job = jobs[index];
    try {
      values.set(index, await guarded(s, () => s.files.write(job.path, job.text, job.rev)));
    } catch (error) {
      if (!(error instanceof DropboxError && error.status === 409)) throw error;
    }
  };
  const groups: number[][] = [];
  let group: number[] = [],
    bytes = 0;
  for (let i = 0; i < jobs.length; i++) {
    const size = textBytes(jobs[i].text);
    if (group.length === 500 || (group.length && bytes + size > maxBatchAppendBytes)) {
      groups.push(group);
      group = [];
      bytes = 0;
    }
    group.push(i);
    bytes += size;
  }
  if (group.length) groups.push(group);
  for (const indexes of groups) {
    if (indexes.length === 1 || !s.files.beginUploadBatch || !s.files.commitBatch) {
      for (const index of indexes) await single(index);
      continue;
    }
    const started = await guarded(s, () => s.files.beginUploadBatch!(indexes.map(i => jobs[i].text)));
    const ready = indexes.flatMap((index, n) => {
      const result = started[n];
      return 'session' in result ? [{index, job: {...jobs[index], session: result.session}}] : [];
    });
    if (!ready.length) continue;
    const results = await guarded(s, () => s.files.commitBatch!(ready.map(entry => entry.job)));
    ready.forEach((entry, n) => {
      const result = results[n];
      if ('value' in result) values.set(entry.index, result.value);
    });
  }
  return values;
}

/** Moves copies whose file has a new name or folder in the source (#101 F13). */
async function move(s: SyncSession, entries: MoveEntry[]) {
  if (!s.files.moveBatch) return false;
  let complete = true;
  for (let start = 0; start < entries.length; start += 100) {
    const chunk = entries.slice(start, start + 100);
    let reply = await guarded(s, () => s.files.moveBatch!(chunk));
    if ('asyncJobId' in reply && s.rawFiles.checkMoveBatch) {
      const id = reply.asyncJobId;
      for (let check = 0; check < 6; check++) {
        await new Promise(resolve => setTimeout(resolve, 900));
        const status = await guarded(s, () => s.rawFiles.checkMoveBatch!(id));
        if ('inProgress' in status) continue;
        // The raw status has no index receipt; a fresh index shows where each file ended up.
        if ('entries' in status) {
          await s.step(() => s.index.refresh());
          reply = status;
        }
        break;
      }
    }
    if (!('entries' in reply) || reply.entries.some(entry => !('value' in entry))) complete = false;
  }
  return complete;
}

/** One import in this run: its scanned source and whether every file arrived. */
interface ImportWork {
  item: SharedImport;
  base: string;
  next?: ImportSource;
  needed: {id: string; file: ImportSourceFile; path: string; rev: string | null}[];
  complete: boolean;
  failed: boolean;
}

/** Picks the files to download: new files, changed files and copies changed outside the app. */
function planCopies(s: SyncSession, work: ImportWork, merged: Manifest) {
  const next = work.next!,
    copies = new Set(Object.values(next.files).flatMap(file => (file.own ? [file.own.id] : [])));
  for (const [id, file] of Object.entries(next.files)) {
    if (!file.songId || merged.deletedSongs?.[file.songId]) file.songId = crypto.randomUUID();
    if (file.gone) continue;
    const target = work.base + file.path,
      own = file.own && s.index.find(file.own.id);
    if (own && !own.folder) {
      // F14: a copy changed outside the app is replaced by the source's version.
      if (own.rev !== file.own!.rev || file.own!.hash !== file.hash)
        work.needed.push({id, file, path: own.path, rev: own.rev ?? null});
      continue;
    }
    const occupant = s.index.find(target);
    // Never take over the copy of another song, for example one kept after its source file was removed.
    if (occupant?.folder || (occupant?.id && copies.has(occupant.id))) {
      work.complete = false;
      continue;
    }
    work.needed.push({id, file, path: target, rev: occupant?.rev ?? null});
  }
}

/**
 * Brings every import's copies up to date with its source. Only new and changed files are
 * downloaded, at most four at once, and the copies of all imports are written in one round.
 */
async function copyFiles(s: SyncSession, works: ImportWork[]) {
  const downloads = works.flatMap(work => work.needed.map(entry => ({work, entry})));
  const texts = new Map<(typeof downloads)[number], string>();
  await s.parallel(downloads, async download => {
    const {work, entry} = download;
    if (work.failed) return;
    try {
      texts.set(download, await guarded(s, () => s.rawFiles.readShared!(work.item.folder, entry.file.path)));
    } catch (error) {
      if (error instanceof SkippedFile) return;
      if (error instanceof DropboxError && error.status === 409) work.complete = false;
      else if (sourceFailure(error)) work.failed = true;
      else throw error;
    }
  });
  const jobs = downloads.filter(download => !download.work.failed && texts.has(download));
  let written: Map<number, FileValue>;
  try {
    written = await upload(
      s,
      jobs.map(download => ({path: download.entry.path, text: texts.get(download)!, rev: download.entry.rev})),
    );
  } catch (error) {
    if (!sourceFailure(error)) throw error;
    for (const {work} of jobs) work.failed = true;
    return;
  }
  jobs.forEach(({work, entry}, i) => {
    const value = written.get(i);
    if (!value) {
      work.complete = false;
      return;
    }
    entry.file.own = {id: value.id, rev: value.rev, hash: entry.file.hash};
    // Dropbox' hash of the copy equals the source's: the sync can use the text without reading it back.
    if (value.hash && value.hash === entry.file.hash) s.index.confirm(value);
  });
}

/** Moves copies whose file has a new name or folder in the source (#101 F13). */
async function moveCopies(s: SyncSession, work: ImportWork) {
  const next = work.next!,
    moves: MoveEntry[] = [];
  for (const [id, file] of Object.entries(next.files)) {
    const own = !file.gone && file.own && s.index.find(file.own.id),
      target = work.base + file.path;
    if (own && !own.folder && own.id && pathKey(own.path) !== pathKey(target))
      moves.push({key: `import:${id}`, from: own.id, to: target, fileId: own.id});
  }
  if (moves.length && !(await move(s, moves))) work.complete = false;
  // A move can give the copy a new rev; it is still the copy the app wrote.
  for (const entry of moves) {
    const file = next.files[entry.key.slice('import:'.length)],
      own = s.index.find(entry.fileId);
    if (own?.rev && pathKey(own.path) === pathKey(entry.to)) file.own = {...file.own!, rev: own.rev};
  }
}

/** Adds or updates the library link of every copy; songs whose copy is gone leave the mapping. */
function linkSongs(s: SyncSession, item: SharedImport, next: ImportSource, merged: Manifest, added: Set<string>) {
  for (const [id, file] of Object.entries(next.files)) {
    const own = file.own && s.index.find(file.own.id);
    if (!own || own.folder || !own.id) {
      // F14: a copy deleted by hand with its file gone from the source leaves the library.
      if (file.gone || merged.deletedSongs?.[file.songId]) delete next.files[id];
      continue;
    }
    if (merged.deletedSongs?.[file.songId]) {
      if (file.gone) {
        delete next.files[id];
        continue;
      }
      file.songId = crypto.randomUUID();
    }
    const link = merged.songs[file.songId];
    if (link) {
      link.fileId = own.id;
      link.path = own.path;
      continue;
    }
    merged.songs[file.songId] = {
      id: file.songId,
      songbookId: item.songbookId,
      origin: {
        kind: 'external',
        provider: 'dropbox',
        sourceId: item.id,
        filename: own.path.split('/').at(-1)!,
        importedAt: new Date().toISOString(),
      },
      fileId: own.id,
      path: own.path,
    };
    added.add(file.songId);
  }
}

/**
 * Manuell Synkroniser: henter hver import til sangboken og legger kopiene inn i det flettede
 * biblioteket. Svarer med ID-ene til nye sanger, som ennå ikke har persondata i Dropbox.
 */
export async function fetchImports(s: SyncSession, merged: Manifest): Promise<Set<string>> {
  const added = new Set<string>();
  if (!s.rawFiles.listShared || !s.rawFiles.readShared) return added;
  const {imports} = await registeredImports(s);
  const status = (s.state.sharedImports ??= {status: {}}).status;
  for (const id of Object.keys(status)) if (!imports.some(item => item.id === id)) delete status[id];
  const {rev, value} = await readState(s),
    before = structuredClone(value);
  // #101 F17: a deleted import's mapping leaves the state; its songs stay or are removed.
  for (const id of Object.keys(value.imports)) if (!imports.some(item => item.id === id)) delete value.imports[id];
  const works: ImportWork[] = [];
  for (const item of [...imports].sort((a, b) => a.id.localeCompare(b.id))) {
    const book = merged.books[item.songbookId],
      bookPath = s.state.folders[item.songbookId]?.path ?? book?.path;
    const work = {item, base: `${bookPath}/Import/${item.name}`, needed: [], complete: true, failed: false};
    if (book && !book.deleted && bookPath) works.push(work);
    else status[item.id] = {...status[item.id], failed: true};
  }
  // The imports' folders are independent: they are listed four at once.
  await s.parallel(works, async work => {
    try {
      work.next = await scan(s, work.item, value.imports[work.item.id] ?? {files: {}, folders: {}});
    } catch (error) {
      if (!sourceFailure(error)) throw error;
      work.failed = true;
    }
  });
  const scanned = works.filter(work => !work.failed);
  for (const work of scanned) planCopies(s, work, merged);
  await copyFiles(s, scanned);
  for (const work of works) {
    if (!work.failed)
      try {
        await moveCopies(s, work);
        linkSongs(s, work.item, work.next!, merged, added);
        value.imports[work.item.id] = work.next!;
      } catch (error) {
        if (!sourceFailure(error)) throw error;
        work.failed = true;
      }
    const ok = !work.failed && work.complete;
    status[work.item.id] = ok ? {synced: new Date().toISOString()} : {...status[work.item.id], failed: true};
  }
  // The status is written after the copies and before the songs' personal data: personal
  // data for a song whose mapping is not saved would give its copy a second identity.
  if (!same(before, value)) {
    const file = await s.write(importStatePath, JSON.stringify(value), rev);
    s.state.sharedImports!.file = {id: file.id, rev: file.rev, value: structuredClone(value)};
  }
  await s.save();
  return added;
}

/**
 * Manuell Synkroniser uten andre endringer: svarer true hvis en import har noe å hente,
 * aldri er hentet her eller feilet sist. Listingene gjenbrukes hvis hele synken må kjøre.
 */
export async function importsPending(s: SyncSession): Promise<boolean> {
  if (!s.rawFiles.listShared) return false;
  const {imports, removals} = await registeredImports(s);
  if (removals.length) return true;
  if (!imports.length) return false;
  const {value} = await readState(s);
  const folders: {item: SharedImport; path: string; cursor: string}[] = [];
  for (const item of imports) {
    const status = s.state.sharedImports?.status[item.id],
      source = value.imports[item.id];
    if (!status || status.failed || !source || !Object.keys(source.folders).length) return true;
    for (const folder of Object.values(source.folders)) folders.push({item, ...folder});
  }
  // F11: every folder is listed, at most four at once; the full sync reuses the listings.
  let pending = false;
  await s.parallel(folders, async ({item, path, cursor}) => {
    try {
      const listing = await listFolder(s, item, path, cursor);
      if (listing.reset || listing.entries.length) pending = true;
    } catch (error) {
      if (!sourceFailure(error)) throw error;
      pending = true;
    }
  });
  return pending;
}

/**
 * #101 F17, Slett import og innhold: before the libraries are merged, the songs of every
 * removed import become confirmed deletions, like copies deleted in Dropbox, and its copy
 * folder is deleted. Personal data and the songs on this device then go as for any deleted
 * song. The removal stays in the import list until the library without the songs is written
 * (`finishRemovals`), so an interrupted run is completed by the next Synkroniser.
 */
export async function removeImports(s: SyncSession, remote: Manifest) {
  if (!s.rawFiles.listShared) return;
  const {removals} = await registeredImports(s);
  const shared = (s.state.sharedImports ??= {status: {}});
  delete shared.removing;
  if (!removals.length) return;
  shared.removing = Object.fromEntries(removals.map(item => [item.id, true]));
  await s.save();
  const removing = new Set(removals.map(item => item.id));
  for (const link of [...Object.values(s.state.manifest.songs), ...Object.values(remote.songs)])
    if (link.origin.kind === 'external' && link.origin.sourceId && removing.has(link.origin.sourceId))
      deleteSong(remote, link);
  const folders = removals.flatMap((item: ImportRemoval) => {
    const book = s.state.folders[item.songbookId] ?? remote.books[item.songbookId],
      folder = book?.path && !book.deleted ? s.index.find(`${book.path}/Import/${item.name}`) : undefined;
    // A deleted songbook's folder is archived with the book.
    return folder?.folder && folder.id
      ? [
          {
            key: `import:${item.id}`,
            path: folder.id,
            fileId: folder.id,
            folder: true,
            category: 'import' as const,
            sourcePath: folder.path,
          },
        ]
      : [];
  });
  await s.namespace.remove(folders);
}

/** After the library is written: the removals of this run are done and leave the import list. */
export async function finishRemovals(s: SyncSession) {
  const removing = s.state.sharedImports?.removing;
  if (!removing) return;
  const current = await clearRemovals(
    {read: path => s.read(path), write: (path, text, rev) => s.write(path, text, rev)},
    new Set(Object.keys(removing)),
  );
  if ('saveImports' in s.storage) await s.storage.saveImports(s.accountId, current);
  delete s.state.sharedImports!.removing;
  await s.save();
}
