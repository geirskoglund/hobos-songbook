import {importsPath} from '../core/paths.ts';
import type {RemoteFiles} from '../core/sync-model.ts';
import {failureCodes, SyncFailure} from '../core/failure.ts';
import {DropboxError} from '../adapters/dropbox.ts';
import type {SharedImport} from '../domain/shared-import.ts';

/**
 * /.app/imports.json holds every registered import for the account (#101 F06). The file is
 * written alone with its expected rev, so devices adding imports at the same time cannot
 * overwrite each other. Book IDs in the file are cloud IDs.
 */
interface ImportsFile {
  version: 1;
  imports: Record<string, {name: string; folder: string; songbookId: string}>;
}
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);
function parse(text: string): SharedImport[] {
  const value: unknown = JSON.parse(text);
  const file = value as ImportsFile;
  if (file?.version !== 1 || !file.imports || typeof file.imports !== 'object' || Array.isArray(file.imports))
    throw new SyncFailure({code: failureCodes.response, stage: 'imports.read'}, 'Ukjent format på importlisten.');
  return Object.entries(file.imports)
    .filter(
      ([id, item]) =>
        validId(id) &&
        typeof item?.name === 'string' &&
        typeof item.folder === 'string' &&
        typeof item.songbookId === 'string',
    )
    .map(([id, item]) => ({id, name: item.name, folder: item.folder, songbookId: item.songbookId}));
}
function serialize(imports: SharedImport[]): string {
  const file: ImportsFile = {version: 1, imports: {}};
  for (const {id, name, folder, songbookId} of imports) file.imports[id] = {name, folder, songbookId};
  return JSON.stringify(file);
}
export async function readImports(files: RemoteFiles): Promise<{rev: string | null; imports: SharedImport[]}> {
  const file = await files.read(importsPath);
  return file ? {rev: file.rev, imports: parse(file.text)} : {rev: null, imports: []};
}
const conflict = (error: unknown) =>
  (error instanceof SyncFailure && error.info.code === failureCodes.changed) ||
  (error instanceof DropboxError && error.status === 409 && /^path\/conflict(?:\/|$)/.test(error.summary));

/** Adds one import to the freshest list; `check` repeats the field rules against that list. */
export async function addImport(
  files: RemoteFiles,
  entry: SharedImport,
  check: (current: SharedImport[]) => void,
): Promise<{rev: string; imports: SharedImport[]}> {
  for (let attempt = 0; ; attempt++) {
    const current = await readImports(files);
    check(current.imports);
    const next = [...current.imports.filter(item => item.id !== entry.id), entry];
    try {
      const written = await files.write(importsPath, serialize(next), current.rev);
      return {rev: written.rev, imports: next};
    } catch (error) {
      if (!conflict(error) || attempt === 2) throw error;
    }
  }
}
