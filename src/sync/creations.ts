import {DeferredSync, RetrySync, SyncFailure, BatchStatusUnconfirmed, failureCodes} from '../core/failure.ts';
import {numberedPath} from './filenames.ts';
import {metadataView, pathKey} from './remote.ts';
import {stagingFolder, stagingPath} from '../core/paths.ts';
import type {
  FileValue,
  MoveReply,
  MoveResult,
  RemoteEntry,
  RemoteFiles,
  SyncState,
  UploadJob,
  UploadResult,
  DeleteEntry,
} from '../core/sync-model.ts';

/** New user-visible files commit first to an app-owned, never-reused path.
 * A readable destination and matching bytes alone cannot prove ownership. */
export function creationQueue(
  files: RemoteFiles,
  state: SyncState,
  hooks: {
    check(): Promise<void>;
    save(): Promise<void>;
    record(job: UploadJob, value: FileValue): void;
    beforePlace(jobs: UploadJob[]): Promise<void>;
    receipt?(job: NonNullable<SyncState['placement']>): Promise<void>;
  },
) {
  const jobs = (state.uploads ??= {});
  const inspect = (path: string) => (files.inspectFile ?? files.read)(path);
  async function metadata(): Promise<(path: string) => Promise<RemoteEntry | null>> {
    await hooks.check();
    if (files.metadataSnapshot) {
      const view = metadataView(await files.metadataSnapshot());
      await hooks.check();
      return async (path: string) => view.find(path) ?? null;
    }
    return files.metadata ?? inspect;
  }
  async function recordLocation(job: UploadJob, entry: RemoteEntry) {
    // Only a file that escaped its nonce needs content recovery. Ordinary staging
    // cleanup uses ID/path/rev alone, independent of file size or decodability.
    const receipt = job.creation?.file ?? (await inspect(entry.id!));
    await hooks.check();
    if (receipt) hooks.record(job, {...receipt, path: entry.path});
  }
  const isNew = (job: UploadJob) => job.rev === null && (job.kind === 'content' || job.kind === 'original');
  const retarget = (job: UploadJob, path: string) => {
    job.path = path;
    if (job.kind === 'content' && state.reservations[job.songId]) state.reservations[job.songId].path = path;
  };
  function available(job: UploadJob, path: string) {
    if (state.remote?.entries[pathKey(path)]) return false;
    if (
      Object.values(state.reservations).some(
        link => link.id !== job.songId && link.fileId && pathKey(link.path) === pathKey(path),
      )
    )
      return false;
    return !Object.values(jobs).some(other => other !== job && other.creation && pathKey(other.path) === pathKey(path));
  }
  function choose(job: UploadJob, afterCollision = false) {
    const creation = job.creation!;
    let n = afterCollision ? creation.number + 1 : creation.number;
    while (!available(job, numberedPath(creation.basePath, n))) n++;
    creation.number = n;
    creation.collision = false;
    retarget(job, numberedPath(creation.basePath, n));
  }
  async function prepare(job: UploadJob) {
    if (!isNew(job)) return;
    if (!files.beginUpload || !files.commitBatch)
      throw new SyncFailure(
        {code: failureCodes.response, stage: 'dropbox.upload'},
        'Ny fil krever idempotent opplastingsøkt.',
      );
    if (!job.creation) {
      job.creation = {path: stagingPath(crypto.randomUUID()), basePath: job.path, number: 1};
      choose(job);
    } else if (job.creation.collision) choose(job, true);
    const source = job.base.link ?? state.reservations[job.songId] ?? state.manifest.songs[job.songId],
      book = source && state.folders[source.songbookId];
    if (!job.creation.attempted && book?.path) {
      const folder = book.path + (job.kind === 'content' ? '/Private' : '/Originals');
      if (job.path.slice(0, job.path.lastIndexOf('/')) !== folder) {
        job.creation.basePath = folder + '/' + job.creation.basePath.split('/').at(-1);
        retarget(job, folder + '/' + job.path.split('/').at(-1));
        delete job.creation.folderId;
      }
      job.creation.book = {...book};
    }
    delete job.creation.failure;
    await hooks.check();
    await files.folder(stagingFolder);
    await hooks.check();
    const parent = job.path.slice(0, job.path.lastIndexOf('/'));
    job.creation.folderId ??= (await files.folder(parent)).id;
    await hooks.check();
  }
  function request(job: UploadJob): UploadJob {
    const c = job.creation;
    if (!c) return job;
    return {...job, path: c.path, rev: c.file?.rev ?? null, ...(c.file ? {fileId: c.file.id} : {})};
  }
  const ready = (job: UploadJob) => Boolean(job.creation?.file?.text === job.text);
  async function accept(job: UploadJob, value: FileValue) {
    const c = job.creation;
    if (!c) return;
    if (c.file && c.file.id !== value.id)
      throw new SyncFailure(
        {code: failureCodes.response, stage: 'dropbox.upload'},
        'Mellomlagringen bekreftet feil filidentitet.',
      );
    c.file = value;
    await hooks.save();
  }
  async function recover(job: UploadJob): Promise<FileValue | null> {
    const c = job.creation;
    if (!c) return null;
    if (c.discarded) return null;
    await hooks.check();
    const actual = await inspect(c.file?.id ?? c.path);
    await hooks.check();
    if (!actual) {
      if (c.file && pathKey(c.file.path) !== pathKey(c.path)) return c.file;
      if (c.file)
        throw new SyncFailure(
          {code: failureCodes.missingFile, stage: 'sync.file'},
          'En bekreftet fil under opprettelse mangler.',
        );
      return null;
    }
    if (!c.file) {
      if (actual.text !== job.text)
        throw new SyncFailure({code: failureCodes.changed, stage: 'sync.file'}, 'Mellomlagringen har ukjent innhold.');
      c.file = actual;
      await hooks.save();
    }
    if (actual.id !== c.file.id)
      throw new SyncFailure({code: failureCodes.response, stage: 'sync.file'}, 'Mellomlagringen har feil identitet.');
    if (pathKey(actual.path) === pathKey(c.path)) {
      if (actual.text !== job.text && actual.text !== c.file.text)
        throw new SyncFailure({code: failureCodes.changed, stage: 'sync.file'}, 'Mellomlagringen er endret.');
      c.file = actual;
      await hooks.save();
      return null;
    }
    // The file may have been moved/edited after the old upload succeeded. This
    // receipt only advances the old submitted bytes/rev; fresh metadata stays fresh.
    return {...c.file, path: actual.path};
  }
  async function apply(reply: MoveReply) {
    const pending = state.placement!;
    delete pending.reply;
    if ('jobExpired' in reply) {
      delete pending.jobId;
      await hooks.save();
      return false;
    }
    if ('asyncJobId' in reply) {
      pending.jobId = reply.asyncJobId;
      await hooks.save();
      return false;
    }
    if ('inProgress' in reply) return false;
    if (reply.entries.length !== pending.entries.length)
      throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.move-batch'}, 'Ufullstendig flytteresultat.');
    const inspectMeta = reply.entries.some(
      (result, i) => 'value' in result && !result.value.path && pending.entries[i].toReference,
    )
      ? await metadata()
      : undefined;
    let changed = false;
    for (let i = 0; i < reply.entries.length; i++) {
      const entry = pending.entries[i],
        job = jobs[entry.key],
        result = reply.entries[i];
      if (!job?.creation) continue;
      if ('value' in result) {
        if (!result.value.path && entry.toReference) {
          const actual = await inspectMeta!(entry.fileId);
          await hooks.check();
          if (!actual) throw new RetrySync();
          result.value.path = actual.path;
        }
        const path = result.value.path || entry.to;
        const matches = entry.toReference
          ? pathKey(path.split('/').at(-1)!) === pathKey(entry.to.split('/').at(-1)!)
          : pathKey(path) === pathKey(entry.to);
        if (result.value.id !== entry.fileId || !matches)
          throw new SyncFailure(
            {code: failureCodes.response, stage: 'dropbox.move-batch'},
            'Flytting bekreftet feil filidentitet eller mål.',
          );
        job.creation.file = {...job.creation.file!, path};
        retarget(job, path);
        if (pathKey(path) !== pathKey(entry.to)) {
          job.value = job.creation.file;
          job.status = 'done';
          hooks.record(job, job.creation.file);
          changed = true;
        }
        if (result.value.rev && result.value.rev !== job.creation.file.rev) {
          const current = await inspect(entry.fileId);
          await hooks.check();
          if (current?.text === job.text && pathKey(current.path) === pathKey(path)) job.creation.file = current;
          else {
            const receipt = {...job.creation.file, ...(current ? {path: current.path} : {})};
            job.value = receipt;
            job.status = 'done';
            hooks.record(job, receipt);
            changed = true;
          }
        }
      } else if (result.collision) job.creation.collision = true;
      else if (result.missing) {
        const receipt = await recover(job);
        if (receipt) {
          job.creation.file = receipt;
          retarget(job, receipt.path);
          if (pathKey(receipt.path) !== pathKey(entry.to)) {
            job.value = receipt;
            job.status = 'done';
            hooks.record(job, receipt);
            changed = true;
          }
        } else job.creation.failure = result.failure;
      } else job.creation.failure = result.failure;
    }
    delete state.placement;
    await hooks.save();
    if (changed) throw new RetrySync();
    return true;
  }
  async function resume() {
    const pending = state.placement;
    if (!pending) return;
    // Never relaunch a plan for a song that was removed or rejoined elsewhere.
    if (pending.entries.every(entry => !jobs[entry.key]?.creation)) {
      delete state.placement;
      await hooks.save();
      return;
    }
    await hooks.check();
    if (!pending.id) {
      pending.id = crypto.randomUUID();
      await hooks.save();
    }
    if (pending.reply && (await apply(pending.reply))) return;
    const receive = async (reply: MoveReply) => {
      pending.reply = reply;
      if ('asyncJobId' in reply) pending.jobId = reply.asyncJobId;
      if (hooks.receipt) await hooks.receipt(pending);
      else await hooks.save();
      await hooks.check();
      return apply(reply);
    };
    const checkStatus = async (id: string): Promise<MoveReply> => {
      if (!files.checkMoveBatch) throw new Error('Missing batch status support');
      try {
        return await files.checkMoveBatch(id, pending.retryAttempt);
      } catch (error) {
        if (!(error instanceof BatchStatusUnconfirmed)) throw error;
        const inspectMeta = await metadata(),
          entries: MoveResult[] = [];
        for (const entry of pending.entries) {
          const reference = entry.toReference?.split('/')[0];
          const parent = reference ? await inspectMeta(reference) : null;
          const actual = await inspectMeta(entry.fileId);
          const target = parent ? `${parent.path}/${entry.to.split('/').at(-1)}` : entry.to;
          if (
            (reference && (!parent?.folder || parent.id !== reference)) ||
            actual?.id !== entry.fileId ||
            actual.folder ||
            pathKey(actual.path) !== pathKey(target)
          )
            throw error;
          entries.push({value: {id: actual.id, path: actual.path, rev: actual.rev}});
        }
        return {entries};
      }
    };
    let reply: MoveReply;
    if (pending.jobId) reply = await checkStatus(pending.jobId);
    else {
      // A lost launch response replays the exact literal source paths. An older
      // server job can never fetch the file again from its final name or a new ID.
      reply = files.moveBatch
        ? await files.moveBatch(pending.entries, pending.retryAttempt)
        : {entries: await serial(pending.entries)};
    }
    if (await receive(reply)) return;
    // Only check the already requested mutation, with a bounded active-run
    // budget. Waiting never schedules another sync or polls the library.
    for (const delay of [0, 250, 750, 1500, 3000]) {
      if (!pending.jobId) break;
      for (let left = delay; left > 0; left -= 100) {
        await hooks.check();
        await new Promise(resolve => setTimeout(resolve, Math.min(left, 100)));
      }
      await hooks.check();
      reply = await checkStatus(pending.jobId);
      if (await receive(reply)) return;
    }
    throw new DeferredSync('connection', 'Flytting pågår hos Dropbox.');
  }
  async function serial(entries: NonNullable<SyncState['placement']>['entries']): Promise<MoveResult[]> {
    const results: MoveResult[] = [];
    for (const entry of entries) {
      await hooks.check();
      try {
        results.push({value: await files.move(entry.from, entry.toReference ?? entry.to)});
      } catch (error) {
        if (!(error instanceof SyncFailure)) throw error;
        results.push({
          failure: error.info,
          collision: error.info.code === failureCodes.changed,
          missing: error.info.code === failureCodes.missingFile,
        });
      }
    }
    return results;
  }
  async function place(group: UploadJob[]): Promise<Map<string, UploadResult>> {
    const results = new Map<string, UploadResult>();
    await resume();
    for (let attempt = 0; attempt < 3; attempt++) {
      const pending = group.filter(
        job =>
          job.creation?.file &&
          !job.creation.collision &&
          !job.creation.failure &&
          pathKey(job.creation.file.path) === pathKey(job.creation.path),
      );
      if (!pending.length) break;
      await hooks.beforePlace(pending);
      // Persist the immutable plan before launch. The source path is never reused
      // for another physical file, even if a launch response is lost.
      const entries = pending.map(job => {
        job.creation!.attempted = true;
        return {
          key: job.key,
          from: job.creation!.path,
          to: job.path,
          toReference: `${job.creation!.folderId}/${job.path.split('/').at(-1)}`,
          fileId: job.creation!.file!.id,
        };
      });
      state.placement = {id: crypto.randomUUID(), entries, retryAttempt: attempt};
      await hooks.save();
      await resume();
      if (attempt < 2)
        for (const job of pending)
          if (job.creation?.failure?.code === failureCodes.throttled) delete job.creation.failure;
    }
    for (const job of group) {
      const c = job.creation;
      if (!c?.file) continue;
      if (c.collision) throw new RetrySync(); // Re-evaluate F65 before choosing (2).
      if (c.failure) {
        results.set(job.key, {failure: c.failure});
        continue;
      }
      if (pathKey(c.file.path) === pathKey(c.path)) throw new DeferredSync('connection', 'Filen venter på plassering.');
      results.set(job.key, {value: c.file});
    }
    return results;
  }
  async function replace(old: UploadJob) {
    if (!old.creation?.attempted) return;
    await prepare(old);
    const result = (await place([old])).get(old.key);
    if (result && 'value' in result) {
      old.value = result.value;
      old.status = 'done';
      hooks.record(old, result.value);
      await hooks.save();
    }
    throw new RetrySync();
  }
  async function discardMany(songIds: string[], role?: 'original') {
    const allowed = new Set(songIds),
      blocked = new Set<string>(),
      deletions: DeleteEntry[] = [],
      observed = new Map<string, RemoteEntry>();
    const group = Object.values(jobs).filter(
      job => allowed.has(job.songId) && job.creation && (!role || job.kind === role),
    );
    if (!group.some(job => !job.creation!.discarded)) return new Set(songIds);
    const inspectMeta = await metadata();
    for (const job of group) {
      const c = job.creation!;
      if (c.discarded) continue;
      await hooks.check();
      const actual = await inspectMeta(c.file?.id ?? c.path);
      await hooks.check();
      if (actual && pathKey(actual.path) !== pathKey(c.path)) {
        await recordLocation(job, actual);
        blocked.add(job.songId);
        continue;
      }
      if (actual) {
        if (!actual.id || !actual.rev || actual.folder)
          throw new SyncFailure({code: failureCodes.response, stage: 'sync.file'}, 'Ugyldig mellomlagringsmetadata.');
        observed.set(job.key, actual);
        deletions.push({key: job.key, path: c.path, fileId: actual.id, rev: actual.rev, category: 'staging'});
      } else (state.abandoned ??= []).push({path: c.path});
    }
    await hooks.save();
    if (deletions.length) {
      if (files.deleteFiles) await files.deleteFiles(deletions);
      else
        for (const entry of deletions) {
          if (!files.deleteFile) return new Set<string>();
          await files.deleteFile(entry.path, entry.rev!);
        }
      await hooks.check();
    }
    const inspectRemaining = observed.size ? await metadata() : inspectMeta;
    for (const job of group) {
      const c = job.creation!;
      if (c.discarded || blocked.has(job.songId)) continue;
      const old = observed.get(job.key);
      if (old) {
        const remaining = await inspectRemaining(old.id!);
        await hooks.check();
        if (remaining) {
          await recordLocation(job, remaining);
          blocked.add(job.songId);
          continue;
        }
      }
      c.discarded = true;
    }
    await hooks.save();
    return new Set(songIds.filter(id => !blocked.has(id)));
  }
  async function discard(songId: string, role?: 'original') {
    return (await discardMany([songId], role)).has(songId);
  }
  async function sweep() {
    if (!state.abandoned?.length) return;
    const inspectMeta = await metadata();
    const keep: NonNullable<SyncState['abandoned']> = [],
      deletions: DeleteEntry[] = [];
    for (const item of state.abandoned ?? []) {
      await hooks.check();
      const current = await inspectMeta(item.fileId ?? item.path);
      await hooks.check();
      if (!current) {
        keep.push(item);
        continue;
      }
      if (current.id && current.rev && !current.folder && pathKey(current.path) === pathKey(item.path))
        deletions.push({key: item.path, path: item.path, fileId: current.id, rev: current.rev, category: 'staging'});
    }
    if (deletions.length) {
      if (files.deleteFiles) await files.deleteFiles(deletions);
      else for (const entry of deletions) await files.deleteFile?.(entry.path, entry.rev!);
      await hooks.check();
    }
    state.abandoned = keep;
  }
  return {prepare, request, ready, accept, recover, resume, place, replace, discard, discardMany, sweep, isNew};
}
