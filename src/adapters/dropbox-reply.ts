// Svar fra Dropbox er ukontrollerte data. De leses som unknown og tolkes her før resten av
// koden bruker dem med en type. Tolkingen kontrollerer bare feltene koden bruker, så nye felter
// tåles. En ukjent .tag går til standardtilfellet, som er det samme som et ugyldig svar.
import type {FileValue, MoveReply, RemoteEntry} from '../core/sync-model.ts';
import {BatchJobFailed, failureCodes, SyncFailure} from '../core/failure.ts';

/** Feltet under stien, eller undefined når et ledd ikke er et objekt. Tilsvarer `value?.a?.b`. */
export function field(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}
export const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
/** `.tag` under stien når den er en streng. */
export const tag = (value: unknown, ...keys: string[]) => text(field(value, ...keys, '.tag'));
export const list = (value: unknown): readonly unknown[] | undefined => (Array.isArray(value) ? value : undefined);
export const oneOf = (value: unknown, options: readonly string[]) =>
  typeof value === 'string' && options.includes(value);
/** Teksten i et feilsvar, som Dropbox gir som error_summary. */
export const errorSummary = (problem: unknown) => text(field(problem, 'error_summary'));

/**
 * Metadata.path_display er valgfri. Uten den settes stien sammen av path_lower og name.
 * Resultatet er ukontrollert: en path_display som ikke er en streng, gir et ugyldig svar hos kalleren.
 */
export function displayPath(data: unknown, fallback?: string): unknown {
  const display = field(data, 'path_display'),
    lower = field(data, 'path_lower'),
    name = field(data, 'name');
  return (
    display ??
    (typeof lower === 'string'
      ? typeof name === 'string'
        ? lower.slice(0, lower.lastIndexOf('/') + 1) + name
        : lower
      : fallback)
  );
}

export function tokenReply(value: unknown) {
  const accessToken = field(value, 'access_token'),
    expiresIn = field(value, 'expires_in');
  if (
    typeof accessToken !== 'string' ||
    !accessToken ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn < 0
  )
    throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.token'}, 'Ugyldig tokenrespons.');
  return {
    accessToken,
    expiresIn,
    refreshToken: text(field(value, 'refresh_token')),
    accountId: field(value, 'account_id'),
    scopes: String(field(value, 'scope') ?? '')
      .split(/\s+/)
      .filter(Boolean),
  };
}

export function fileValue(data: unknown, contents: string, requestedPath: string): FileValue {
  // A literal/revision lookup or strict upload already identifies its path;
  // an ID lookup needs the returned location.
  const path = displayPath(data, /^(\/|rev:)/.test(requestedPath) ? requestedPath : undefined),
    id = field(data, 'id'),
    rev = field(data, 'rev');
  if (!data || typeof id !== 'string' || !id || typeof rev !== 'string' || !rev || typeof path !== 'string')
    throw new SyncFailure(
      {code: failureCodes.response, stage: 'dropbox.file-metadata'},
      'Dropbox returnerte ugyldig filmetadata.',
    );
  return {text: contents, id, rev, path};
}

/** Én oppføring fra files/list_folder med include_deleted. */
export function changeEntry(entry: unknown): RemoteEntry {
  const invalid = () =>
    new SyncFailure({code: failureCodes.response, stage: 'dropbox.list'}, 'Ugyldig oppføring i endringsoversikten.');
  const path = displayPath(entry),
    kind = tag(entry),
    id = field(entry, 'id'),
    rev = field(entry, 'rev'),
    size = field(entry, 'size');
  if (typeof path !== 'string' || !path.startsWith('/')) throw invalid();
  if (kind === 'deleted') return {path, deleted: true};
  if ((kind !== 'file' && kind !== 'folder') || typeof id !== 'string' || !id) throw invalid();
  if (kind === 'folder') return {id, path, folder: true};
  if (typeof rev !== 'string' || !rev) throw invalid();
  if (size !== undefined && (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0))
    throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.list'}, 'Ugyldig filstørrelse.');
  return {id, path, folder: false, rev, ...(size !== undefined ? {size} : {})};
}

/** Svaret fra files/move_batch_v2 (launch) eller files/move_batch/check_v2. */
export function moveReply(value: unknown, launch: boolean): MoveReply {
  const kind = tag(value),
    jobId = field(value, 'async_job_id'),
    entries = list(field(value, 'entries'));
  if (launch && kind === 'async_job_id' && typeof jobId === 'string' && jobId) return {asyncJobId: jobId};
  if (!launch && kind === 'in_progress') return {inProgress: true};
  if (kind !== 'complete' || !entries)
    throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.move-batch'}, 'Ugyldig flytterespons.');
  return {
    entries: entries.map(entry => {
      if (tag(entry) === 'success') {
        const meta = field(entry, 'success'),
          metaKind = tag(meta),
          id = field(meta, 'id'),
          rev = field(meta, 'rev'),
          path = displayPath(meta);
        if (
          (metaKind !== 'file' && metaKind !== 'folder') ||
          typeof id !== 'string' ||
          !id ||
          (metaKind === 'file' && (typeof rev !== 'string' || !rev)) ||
          (path !== undefined && typeof path !== 'string')
        )
          throw new SyncFailure(
            {code: failureCodes.response, stage: 'dropbox.move-batch'},
            'Ugyldig flyttekvittering.',
          );
        return {
          value: {
            id,
            path: typeof path === 'string' ? path : '',
            ...(typeof rev === 'string' && rev ? {rev} : {}),
            ...(metaKind === 'folder' ? {folder: true} : {}),
          },
        };
      }
      const problem = field(entry, 'failure'),
        problemKind = tag(problem);
      if (tag(entry) !== 'failure' || problemKind === undefined)
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.move-batch'}, 'Ugyldig flyttefeil.');
      const relocation = problemKind === 'relocation_error' ? field(problem, 'relocation_error') : null,
        where = tag(relocation);
      const collision = where === 'to' && tag(relocation, 'to') === 'conflict';
      const missing = where === 'from_lookup' && tag(relocation, 'from_lookup') === 'not_found';
      const throttled =
        problemKind === 'too_many_write_operations' ||
        (where === 'to' && tag(relocation, 'to') === 'too_many_write_operations') ||
        (where === 'from_write' && tag(relocation, 'from_write') === 'too_many_write_operations');
      const verifyEffect = problemKind === 'internal_error' || where === 'internal_error';
      return {
        failure: {
          code: collision
            ? failureCodes.changed
            : missing
              ? failureCodes.missingFile
              : throttled
                ? failureCodes.throttled
                : failureCodes.request,
          stage: 'dropbox.move-batch',
          status: 200,
          ...(throttled ? {limitReason: 'too_many_write_operations' as const, retryAfterMs: 0} : {}),
        },
        ...(collision ? {collision: true} : {}),
        ...(missing ? {missing: true} : {}),
        ...(verifyEffect ? {verifyEffect: true} : {}),
      };
    }),
  };
}

/** Svaret fra files/delete_batch og files/create_folder_batch, med eller uten /check. */
export function namespaceReply(value: unknown, kind: 'delete' | 'folders'): MoveReply {
  const stage = `dropbox.${kind}-batch`,
    replyKind = tag(value),
    jobId = field(value, 'async_job_id'),
    entries = list(field(value, 'entries'));
  if (replyKind === 'async_job_id' && typeof jobId === 'string' && jobId) return {asyncJobId: jobId};
  if (replyKind === 'in_progress') return {inProgress: true};
  if (replyKind === 'failed') {
    const throttled = tag(value, 'failed') === 'too_many_write_operations';
    throw new BatchJobFailed(
      {
        code: throttled ? failureCodes.throttled : failureCodes.request,
        stage,
        status: 200,
        ...(throttled ? {limitReason: 'too_many_write_operations' as const, retryAfterMs: 0} : {}),
      },
      'Dropbox-jobben feilet.',
    );
  }
  if (replyKind !== 'complete' || !entries)
    throw new SyncFailure({code: failureCodes.response, stage}, 'Ugyldig batchrespons.');
  return {
    entries: entries.map(entry => {
      if (tag(entry) === 'success') {
        const meta = field(entry, 'metadata'),
          // CreateFolderResult.metadata has no .tag; a present tag must still be folder.
          metaKind = field(meta, '.tag'),
          id = field(meta, 'id'),
          rev = field(meta, 'rev'),
          path = displayPath(meta);
        if (
          typeof id !== 'string' ||
          !id ||
          (path !== undefined && typeof path !== 'string') ||
          (kind === 'folders' && metaKind !== undefined && metaKind !== 'folder') ||
          (kind === 'delete' && !oneOf(metaKind, ['file', 'folder']))
        )
          throw new SyncFailure({code: failureCodes.response, stage}, 'Ugyldig batchkvittering.');
        return {
          value: {
            id,
            path: typeof path === 'string' ? path : '',
            ...(typeof rev === 'string' && rev ? {rev} : {}),
            ...(kind === 'folders' || metaKind === 'folder' ? {folder: true} : {}),
          },
        };
      }
      const failure = field(entry, 'failure'),
        failureKind = tag(failure);
      if (tag(entry) !== 'failure' || failureKind === undefined)
        throw new SyncFailure({code: failureCodes.response, stage}, 'Ugyldig batchfeil.');
      const missing = failureKind === 'path_lookup' && tag(failure, 'path_lookup') === 'not_found';
      const collision =
        (failureKind === 'path' && tag(failure, 'path') === 'conflict') ||
        (failureKind === 'path_write' && tag(failure, 'path_write') === 'conflict');
      const throttled =
        failureKind === 'too_many_write_operations' ||
        (failureKind === 'path_write' && tag(failure, 'path_write') === 'too_many_write_operations') ||
        (failureKind === 'path' && tag(failure, 'path') === 'too_many_write_operations');
      return {
        failure: {
          code: missing
            ? failureCodes.missingFile
            : collision
              ? failureCodes.changed
              : throttled
                ? failureCodes.throttled
                : failureCodes.request,
          stage,
          status: 200,
          ...(throttled ? {limitReason: 'too_many_write_operations' as const, retryAfterMs: 0} : {}),
        },
        ...(missing ? {missing: true} : {}),
        ...(collision ? {collision: true} : {}),
      };
    }),
  };
}
