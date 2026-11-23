import {RetrySync, SyncFailure, failureCodes} from './failure.ts';
import {checkSize, maxBatchAppendBytes, textBytes, SkippedFile} from './limits.ts';
import {
  same,
  type FileValue,
  type RemoteFiles,
  type SyncState,
  type UploadIntent,
  type UploadJob,
  type UploadResult,
} from './model.ts';
import {creationQueue} from './creations.ts';
import {uploadBridge, claimReady} from './bridge.ts';
import {emptyManifest, type Manifest} from './model.ts';

const batchSize = 100,
  sessionLifetime = 7 * 24 * 60 * 60 * 1000;
/** Durable intents precede namespace commits. A lost result is reconciled by exact
 * bytes before any replay, including after a newer local generation. */
export function uploadQueue(
  files: RemoteFiles,
  state: SyncState,
  hooks: {
    check(): Promise<void>;
    save(): Promise<void>;
    record(job: UploadJob, value: FileValue): void;
    receipt?(job: NonNullable<SyncState['placement']>): Promise<void>;
  },
) {
  const journal = (state.uploads ??= {});
  let published = emptyManifest();
  const bridge = uploadBridge(files, state, hooks);
  const creations = creationQueue(files, state, {...hooks, beforePlace: jobs => bridge.publish(jobs, published)});
  const used = new Set<string>();
  async function recover() {
    await creations.resume();
    await creations.sweep();
    for (const job of Object.values(journal)) {
      if (job.status !== 'committing') continue;
      await hooks.check();
      if (job.creation) {
        const value = await creations.recover(job);
        if (value) {
          job.value = value;
          job.status = 'done';
          hooks.record(job, value);
        } else job.status = 'planned';
        continue;
      }
      // Paths can be reused after a remote move. Equal bytes at the old name
      // are not proof that this request wrote the file. Older journals can
      // recover their known content ID from the persisted song link.
      const expectedId =
        job.fileId ??
        (job.rev && job.kind === 'content'
          ? (state.reservations[job.songId] ?? state.manifest.songs[job.songId])?.fileId
          : undefined);
      if (job.rev && !expectedId) {
        job.status = 'planned';
        continue;
      }
      let current: FileValue | null;
      try {
        current = await (files.inspectFile ?? files.read)(expectedId ?? job.path);
      } catch (error) {
        if (!(error instanceof SkippedFile)) throw error;
        job.status = 'planned';
        delete job.session;
        continue;
      }
      await hooks.check();
      if (current && (!expectedId || current.id === expectedId) && current.text === job.text) {
        job.value = current;
        job.status = 'done';
        hooks.record(job, current);
      } else job.status = 'planned';
    }
    await hooks.save();
  }
  async function beginSessions(jobs: UploadJob[], results: Map<string, UploadResult>) {
    if (!files.beginUploadBatch || jobs.length < 2) {
      let next = 0,
        interrupted: unknown;
      await Promise.all(
        Array.from({length: Math.min(4, jobs.length)}, async () => {
          while (next < jobs.length && !interrupted) {
            const job = jobs[next++];
            try {
              await hooks.check();
              job.session = await files.beginUpload!(job.text);
              await hooks.check();
              await hooks.save();
            } catch (error) {
              interrupted = error;
            }
          }
        }),
      );
      if (interrupted) throw interrupted;
      return;
    }
    let group: UploadJob[] = [],
      bytes = 0;
    async function sendGroup() {
      await hooks.check();
      if (group.length === 1) group[0].session = await files.beginUpload!(group[0].text);
      else {
        const started = await files.beginUploadBatch!(group.map(job => job.text));
        if (started.length !== group.length)
          throw new SyncFailure(
            {code: failureCodes.response, stage: 'dropbox.upload'},
            'Ufullstendig svar for opplastingsøktene.',
          );
        started.forEach((value, i) => {
          if ('session' in value) group[i].session = value.session;
          else results.set(group[i].key, value);
        });
      }
      await hooks.check();
      await hooks.save();
      group = [];
      bytes = 0;
    }
    for (const job of jobs) {
      const size = textBytes(job.text);
      if (bytes + size > maxBatchAppendBytes) await sendGroup();
      group.push(job);
      bytes += size;
    }
    if (group.length) await sendGroup();
  }
  async function write(intents: UploadIntent[]): Promise<Map<string, UploadResult>> {
    const results = new Map<string, UploadResult>();
    for (const intent of intents) checkSize(textBytes(intent.text));
    for (const intent of intents) used.add(intent.key);
    for (let offset = 0; offset < intents.length; offset += batchSize) {
      const group = intents.slice(offset, offset + batchSize),
        jobs: UploadJob[] = [];
      for (const intent of group) {
        const old = journal[intent.key];
        const identical =
          old &&
          same(
            {path: old.path, text: old.text, rev: old.rev, fileId: old.fileId},
            {path: intent.path, text: intent.text, rev: intent.rev, fileId: intent.fileId},
          );
        if (old && !identical && old.status !== 'done') await creations.replace(old);
        const job = identical
          ? old
          : (journal[intent.key] = {
              ...intent,
              status: 'planned',
              ...(intent.rev === null && old?.creation && !old.creation.attempted ? {creation: old.creation} : {}),
            });
        if (job.status === 'done' && job.value) {
          results.set(job.key, {value: job.value});
          continue;
        }
        if (job.session && Date.now() - job.session.created >= sessionLifetime) delete job.session;
        if (job.creation?.discarded) {
          await bridge.release([job]);
          delete job.creation;
          delete job.session;
        }
        await creations.prepare(job);
        jobs.push(job);
      }
      await hooks.save();
      if (!jobs.length) continue;
      let needed = jobs.filter(job => !creations.ready(job));
      const bulk =
        (needed.length > 1 || needed.some(job => job.session || job.creation)) &&
        files.beginUpload &&
        files.commitBatch;
      if (bulk) {
        await beginSessions(
          needed.filter(job => !job.session),
          results,
        );
        needed = needed.filter(job => job.session);
      }
      // Persist exact bytes, revisions and session IDs before any commit request.
      for (const job of jobs) if (!results.has(job.key)) job.status = 'committing';
      await hooks.save();
      await hooks.check();
      let values: UploadResult[];
      if (bulk) values = needed.length ? await files.commitBatch!(needed.map(creations.request)) : [];
      else {
        values = [];
        for (const job of needed) {
          await hooks.check();
          try {
            const request = creations.request(job);
            values.push({value: await files.write(request.path, request.text, request.rev)});
          } catch (error) {
            if (
              !(error instanceof SyncFailure) ||
              [failureCodes.network, failureCodes.authentication, failureCodes.permission, failureCodes.throttled].some(
                code => code === error.info.code,
              )
            )
              throw error;
            values.push({failure: error.info});
          }
        }
      }
      await hooks.check();
      let retry = false;
      for (let i = 0; i < needed.length; i++) {
        const job = needed[i],
          result = values[i];
        if (!result) throw new Error('Incomplete upload result');
        results.set(job.key, result);
        if ('value' in result) {
          if (job.creation) {
            await creations.accept(job, result.value);
            results.delete(job.key);
          } else {
            if (job.fileId && job.fileId !== result.value.id)
              throw new SyncFailure(
                {code: failureCodes.response, stage: 'dropbox.upload'},
                'Opplastingen bekreftet en annen filidentitet.',
              );
            job.value = result.value;
            job.status = 'done';
            hooks.record(job, result.value);
          }
        } else {
          job.status = 'planned';
          if (result.resetSession) delete job.session;
          retry ||= result.resetSession === true || result.failure.code === 'SYNC-006';
        }
      }
      await hooks.save();
      if (retry) throw new RetrySync();
      const placed = await creations.place(
        jobs.filter(job => job.creation && creations.ready(job) && !results.has(job.key)),
      );
      for (const job of jobs) {
        const result = placed.get(job.key);
        if (!result) continue;
        results.set(job.key, result);
        if ('value' in result) {
          job.value = result.value;
          job.status = 'done';
          hooks.record(job, result.value);
        } else job.status = 'planned';
      }
      await hooks.save();
    }
    return results;
  }
  function clearDone() {
    for (const [key, job] of Object.entries(journal))
      if (job.status === 'done' || (!used.has(key) && !job.creation)) delete journal[key];
  }
  function originalPending(id: string) {
    const own = journal[`original:${id}`]?.creation?.file?.id;
    return Object.values(state.uploadIndex?.value.entries ?? {}).some(
      claim =>
        claim.role === 'original' && claim.song.id === id && claim.fileId !== own && !claimReady(claim, published),
    );
  }
  async function clearClaims(manifest: Manifest) {
    published = manifest;
    await bridge.clearReady(manifest);
  }
  async function discardMany(ids: string[]) {
    const released = await creations.discardMany(ids);
    await bridge.release(Object.values(journal).filter(job => released.has(job.songId)));
    return released;
  }
  async function discard(id: string) {
    return (await discardMany([id])).has(id);
  }
  async function discardOriginal(id: string) {
    const job = journal[`original:${id}`];
    if (!job) return;
    await creations.discard(id, 'original');
    await bridge.release([job]);
    delete journal[job.key];
    await hooks.save();
  }
  return {
    recover,
    write,
    clearDone,
    discard,
    discardMany,
    discardOriginal,
    claims: bridge.load,
    observeManifest: (manifest: Manifest) => {
      published = manifest;
    },
    clearClaims,
    originalPending,
  };
}
