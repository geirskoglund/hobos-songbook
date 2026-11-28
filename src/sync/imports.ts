import {importsPath} from '../core/paths.ts';
import type {RemoteFiles} from '../core/sync-model.ts';
import {failureCodes, SyncFailure} from '../core/failure.ts';
import {DropboxError} from '../adapters/dropbox.ts';
import type {ImportRemoval, SharedImport} from '../domain/shared-import.ts';

/**
 * /.app/imports.json holds every registered import for the account (#101 F06). The file is
 * written alone with its expected rev, so devices changing imports at the same time cannot
 * overwrite each other. Book IDs in the file are cloud IDs.
 *
 * `removals` lists imports deleted with their content whose copies a Synkroniser has yet to
 * remove (#101 F17). Older app versions ignore the field.
 */
interface ImportsFile {
  version: 1;
  imports: Record<string, {name: string; folder: string; songbookId: string}>;
  removals?: Record<string, {name: string; songbookId: string}>;
}
export interface ImportList {
  rev: string | null;
  imports: SharedImport[];
  removals: ImportRemoval[];
}
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function parse(text: string): Omit<ImportList, 'rev'> {
  const value: unknown = JSON.parse(text);
  const file = value as ImportsFile;
  if (file?.version !== 1 || !record(file.imports) || (file.removals !== undefined && !record(file.removals)))
    throw new SyncFailure({code: failureCodes.response, stage: 'imports.read'}, 'Ukjent format på importlisten.');
  const imports = Object.entries(file.imports)
    .filter(
      ([id, item]) =>
        validId(id) &&
        typeof item?.name === 'string' &&
        typeof item.folder === 'string' &&
        typeof item.songbookId === 'string',
    )
    .map(([id, item]) => ({id, name: item.name, folder: item.folder, songbookId: item.songbookId}));
  const removals = Object.entries(file.removals ?? {})
    .filter(
      ([id, item]) =>
        validId(id) && !file.imports[id] && typeof item?.name === 'string' && typeof item.songbookId === 'string',
    )
    .map(([id, item]) => ({id, name: item.name, songbookId: item.songbookId}));
  return {imports, removals};
}
function serialize(imports: SharedImport[], removals: ImportRemoval[]): string {
  const file: ImportsFile = {version: 1, imports: {}};
  for (const {id, name, folder, songbookId} of imports) file.imports[id] = {name, folder, songbookId};
  if (removals.length) {
    file.removals = {};
    for (const {id, name, songbookId} of removals) file.removals[id] = {name, songbookId};
  }
  return JSON.stringify(file);
}
export async function readImports(files: Pick<RemoteFiles, 'read'>): Promise<ImportList> {
  const file = await files.read(importsPath);
  return file ? {rev: file.rev, ...parse(file.text)} : {rev: null, imports: [], removals: []};
}
const conflict = (error: unknown) =>
  (error instanceof SyncFailure && error.info.code === failureCodes.changed) ||
  (error instanceof DropboxError && error.status === 409 && /^path\/conflict(?:\/|$)/.test(error.summary));

/**
 * Changes the freshest list and writes it with its rev; another device's write in between
 * gives a new attempt against its list. `change` answers null when nothing is to be written.
 */
async function update(
  files: Pick<RemoteFiles, 'read' | 'write'>,
  change: (current: ImportList) => Omit<ImportList, 'rev'> | null,
): Promise<ImportList> {
  for (let attempt = 0; ; attempt++) {
    const current = await readImports(files),
      next = change(current);
    if (!next) return current;
    try {
      const written = await files.write(importsPath, serialize(next.imports, next.removals), current.rev);
      return {rev: written.rev, ...next};
    } catch (error) {
      if (!conflict(error) || attempt === 2) throw error;
    }
  }
}

/** Adds one import to the freshest list; `check` repeats the field rules against that list. */
export function addImport(files: RemoteFiles, entry: SharedImport, check: (current: SharedImport[]) => void) {
  return update(files, current => {
    check(current.imports);
    return {
      imports: [...current.imports.filter(item => item.id !== entry.id), entry],
      removals: current.removals,
    };
  });
}

/**
 * #101 F17: removes one import from the list, so no device fetches it again. With `content`
 * the import is kept as a removal until a Synkroniser has removed its folder and songs.
 * An import another device has already removed leaves the list as it is.
 */
export function removeImport(files: RemoteFiles, id: string, content: boolean) {
  return update(files, current => {
    const item = current.imports.find(entry => entry.id === id);
    if (!item) return null;
    return {
      imports: current.imports.filter(entry => entry.id !== id),
      removals: content ? [...current.removals, {id, name: item.name, songbookId: item.songbookId}] : current.removals,
    };
  });
}

/** Clears removals whose folder and songs are gone; the sync passes its guarded read and write. */
export function clearRemovals(files: Pick<RemoteFiles, 'read' | 'write'>, ids: Set<string>) {
  return update(files, current =>
    current.removals.some(item => ids.has(item.id))
      ? {imports: current.imports, removals: current.removals.filter(item => !ids.has(item.id))}
      : null,
  );
}
