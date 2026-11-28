import assert from 'node:assert/strict';
import {emptyJournal} from '../src/core/sync-model.ts';
import {newSyncState} from '../src/sync/state.ts';
import {syncEngine} from '../src/sync/engine.ts';
import {SyncFailure, failureCodes} from '../src/core/failure.ts';
export const song = (id = 'one', book = 'standard', original = '{t: En sang}\n[C]Hei') => ({
  id,
  songbookId: book,
  original,
  title: 'En sang',
  key: null,
  origin: {kind: 'local', filename: 'en.txt', importedAt: '2026-01-01'},
});
export function fixture() {
  let generation = 0,
    rev = 0,
    valid = true,
    failAfter = '',
    failed = false;
  let data = {
    songs: [song()],
    songbooks: [{id: 'standard', name: 'Standard'}],
    personal: [{songId: 'one', version: 3, chorus: {}, capo: 2}],
    journal: emptyJournal(),
    state: newSyncState('account'),
  };
  const entries = new Map(),
    history = new Map(),
    calls = [],
    cursors = new Map(),
    sessions = new Map();
  let cursorSequence = 0,
    sessionSequence = 0;
  const reference = path => {
    if (!path.startsWith('id:') || !path.includes('/')) return path;
    const slash = path.indexOf('/'),
      parent = [...entries.values()].find(e => e.id === path.slice(0, slash));
    return parent ? parent.path + path.slice(slash) : path;
  };
  const find = path =>
    path.startsWith('rev:')
      ? history.get(path.slice(4))
      : path.startsWith('id:') && !path.includes('/')
        ? [...entries.values()].find(e => e.id === path)
        : entries.get(reference(path).toLowerCase());
  const files = {
    async metadata(path) {
      calls.push(['metadata', path]);
      const value = find(path);
      return value
        ? {id: value.id, path: value.path, folder: Boolean(value.folder), ...(value.rev ? {rev: value.rev} : {})}
        : null;
    },
    async createFoldersBatch(group) {
      calls.push(['folderBatch', group.length]);
      return {
        entries: await Promise.all(
          group.map(async entry => {
            const old = find(entry.path);
            if (old && !old.folder)
              return {failure: {code: 'SYNC-006', stage: 'dropbox.folders-batch', status: 200}, collision: true};
            return {value: await files.folder(entry.path)};
          }),
        ),
      };
    },
    async deleteBatch(group) {
      calls.push(['deleteBatch', group.length]);
      const results = [];
      for (const entry of group) {
        const old = find(entry.path);
        if (!old) {
          results.push({failure: {code: 'SYNC-012', stage: 'dropbox.delete-batch', status: 200}, missing: true});
          continue;
        }
        if (entry.rev && old.rev !== entry.rev) {
          results.push({failure: {code: 'SYNC-006', stage: 'dropbox.delete-batch', status: 200}, collision: true});
          continue;
        }
        if (entry.folder && entry.category === 'import') {
          // Dropbox deletes a folder with its content.
          for (const k of [...entries.keys()])
            if (k === old.path.toLowerCase() || k.startsWith(old.path.toLowerCase() + '/')) entries.delete(k);
        } else if (entry.folder) {
          if (!(await files.removeEmpty(old.path))) {
            results.push({failure: {code: 'SYNC-006', stage: 'dropbox.delete-batch', status: 200}, collision: true});
            continue;
          }
        } else await files.deleteFile(entry.path, entry.rev);
        results.push({
          value: {id: old.id, path: old.path, folder: Boolean(old.folder), ...(old.rev ? {rev: old.rev} : {})},
        });
      }
      return {entries: results};
    },
    async changes(cursor) {
      calls.push(['changes']);
      const current = new Map(
          [...entries.values()].map(e => [
            e.path.toLowerCase(),
            {id: e.id, path: e.path, folder: Boolean(e.folder), ...(!e.folder ? {rev: e.rev} : {})},
          ]),
        ),
        previous = cursors.get(cursor),
        updates = [];
      if (previous)
        for (const [path, e] of previous) if (!current.has(path)) updates.push({path: e.path, deleted: true});
      for (const [path, e] of current)
        if (!previous || JSON.stringify(previous.get(path)) !== JSON.stringify(e)) updates.push(e);
      const next = String(++cursorSequence);
      cursors.set(next, structuredClone(current));
      return {entries: updates, cursor: next, reset: !previous};
    },
    async read(path) {
      calls.push(['read', path]);
      const item = find(path);
      return item && !item.folder ? structuredClone(item) : null;
    },
    async write(path, text, expected) {
      calls.push(['write', path]);
      const old = find(path);
      if (expected ? old?.rev !== expected : old)
        throw new SyncFailure({code: failureCodes.changed, stage: 'dropbox.upload', status: 409}, '409');
      const value = {path, text, rev: String(++rev), id: old?.id ?? `id:${rev}`};
      entries.set(path.toLowerCase(), value);
      history.set(value.rev, structuredClone(value));
      if (failAfter === path && !failed) {
        failed = true;
        throw Error('lost response');
      }
      return structuredClone(value);
    },
    async beginUpload(text) {
      const id = 'fixture-session-' + ++sessionSequence;
      sessions.set(id, text);
      return {id, created: Date.now()};
    },
    async commitBatch(jobs) {
      const results = [];
      for (const job of jobs) {
        if (!sessions.has(job.session.id)) {
          results.push({failure: {code: 'SYNC-003', stage: 'dropbox.batch'}, resetSession: true});
          continue;
        }
        try {
          results.push({value: await files.write(job.path, sessions.get(job.session.id), job.rev)});
          sessions.delete(job.session.id);
        } catch (error) {
          if (error.message !== '409') throw error;
          results.push({failure: {code: 'SYNC-006', stage: 'dropbox.batch', status: 409}});
        }
      }
      return results;
    },
    async moveBatch(entries) {
      calls.push(['moveBatch', entries.length]);
      const results = [];
      for (const entry of entries) {
        const to = reference(entry.toReference ?? entry.to);
        if (to.startsWith('id:')) {
          results.push({failure: {code: 'SYNC-003', stage: 'dropbox.move-batch'}});
          continue;
        }
        try {
          results.push({value: await files.move(entry.from, to)});
        } catch (error) {
          if (error.message === '409')
            results.push({failure: {code: 'SYNC-006', stage: 'dropbox.move-batch'}, collision: true});
          else if (error.message === 'missing')
            results.push({failure: {code: 'SYNC-012', stage: 'dropbox.move-batch'}, missing: true});
          else throw error;
        }
      }
      return {entries: results};
    },
    async folder(path, expectedId) {
      let value = find(expectedId ?? path);
      if (expectedId && (!value || value.path.toLowerCase() !== path.toLowerCase())) throw Error('kjent mappe flyttet');
      if (!value) {
        value = {id: `id:${++rev}`, path, folder: true};
        entries.set(path.toLowerCase(), value);
      }
      return structuredClone(value);
    },
    async locateFolder(id) {
      const value = find(id);
      return value?.folder ? {id: value.id, path: value.path} : null;
    },
    async move(from, to) {
      calls.push(['move', from, to]);
      const value = find(from);
      if (!value) throw Error('missing');
      if (value.path === to) return structuredClone(value);
      if (find(to)) throw new SyncFailure({code: failureCodes.changed, stage: 'dropbox.move', status: 409}, '409');
      const prefix = value.path;
      for (const [key, e] of [...entries])
        if (e.path === prefix || e.path.startsWith(prefix + '/')) {
          entries.delete(key);
          e.path = to + e.path.slice(prefix.length);
          entries.set(e.path.toLowerCase(), e);
        }
      return structuredClone(value);
    },
    async list(path) {
      calls.push(['list', path]);
      return [...entries.values()]
        .filter(
          e =>
            e.path.toLowerCase().startsWith(path.toLowerCase() + '/') && !e.path.slice(path.length + 1).includes('/'),
        )
        .map(e => ({...e}));
    },
    async removeEmpty(path) {
      calls.push(['removeEmpty', path]);
      if ((await files.list(path)).length) return false;
      entries.delete(path.toLowerCase());
      return true;
    },
    async deleteFile(path, rev) {
      calls.push(['deleteFile', path]);
      const value = find(path);
      if (value && value.rev !== rev) throw Error('409');
      if (value) entries.delete(value.path.toLowerCase());
    },
  };
  const storage = {
    async placementReceipt(_account, job) {
      if (job.id && data.state.placement?.id === job.id)
        data.state.placement = {...data.state.placement, jobId: job.jobId, reply: structuredClone(job.reply)};
    },
    async transport(_account, job) {
      if (data.state.namespaceJob?.id === job.id)
        data.state.namespaceJob = {
          ...data.state.namespaceJob,
          submitted: job.submitted,
          jobId: job.jobId,
          reply: structuredClone(job.reply),
        };
    },
    async snapshot() {
      return structuredClone(data);
    },
    async status(accountId) {
      return {journal: structuredClone(data.journal), state: accountId ? structuredClone(data.state) : undefined};
    },
    async commit(expected, state, changes = {}) {
      assert.equal(expected, data.journal.generation);
      if (!valid || Object.keys(data.journal.sessions).length) throw Error('paused');
      data.state = structuredClone(state);
      if (changes.recoveryComplete) data.journal.recoveryRequired = false;
      for (const [field, items, key] of [
        ['songs', changes.songs, 'id'],
        ['songbooks', changes.books, 'id'],
        ['personal', changes.personal, 'songId'],
      ])
        for (const item of items ?? []) {
          const i = data[field].findIndex(x => x[key] === item[key]);
          if (i < 0) data[field].push(structuredClone(item));
          else data[field][i] = structuredClone(item);
        }
      data.songbooks = data.songbooks.filter(b => !changes.deleteBooks?.includes(b.id));
      data.songs = data.songs.filter(s => !changes.deleteSongs?.includes(s.id));
      data.personal = data.personal.filter(p => !changes.deleteSongs?.includes(p.songId));
    },
  };
  const run = (manual = true, resolution) =>
    syncEngine(storage, files, 'account', {valid: () => valid, changed() {}}).run(manual, resolution);
  return {
    files,
    storage,
    run,
    entries,
    calls,
    change(fn) {
      fn(data);
      data.journal.generation = ++generation;
    },
    get data() {
      return data;
    },
    set data(value) {
      data = structuredClone(value);
    },
    fail(path) {
      failAfter = path;
      failed = false;
    },
    pause() {
      valid = false;
    },
  };
}
