import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, song} from './sync-fixture.mjs';
import {emptyJournal} from '../src/core/sync-model.ts';
import {newSyncState} from '../src/sync/state.ts';
import {syncEngine} from '../src/sync/engine.ts';
import {SyncFailure, failureCodes, RetrySync} from '../src/core/failure.ts';

const versionA = '{t: Banner of Heaven}\n{k: Am}\n{time: 4/4}\n[C]Version A';
const versionB = '{t: Banner of Heaven}\n{k: C}\n{time: 3/4}\n[G]Version B';
const originals = [versionA, versionB, '{t: Bronco Billy}\n[C]Third song'];
const filenames = ['banner of heaven.txt', 'Banner_of_Heaven_ChordPro_test.cho', 'Bronco Billy.txt'];
const make = (prefix, book) =>
  originals.map((text, i) => ({
    ...song(prefix + i, book, text),
    title: i < 2 ? 'Banner of Heaven' : 'Bronco Billy',
    origin: {kind: 'local', filename: filenames[i], importedAt: prefix},
  }));
const personals = (songs, capo) => songs.map(s => ({songId: s.id, version: 3, chorus: {}, capo}));
async function setup() {
  const f = fixture();
  f.change(d => {
    d.songbooks = [{id: 'cloud-book', name: 'Hobos'}];
    d.songs = make('cloud-', 'cloud-book');
    d.personal = personals(d.songs, 5);
  });
  await f.run();
  const local = make('local-', 'local-book');
  // Content A is already identical to Dropbox. The other content and all
  // personal layers conflict; all choices must keep the Dropbox versions.
  local[1].original += '\nLocal edit';
  local[2].original += '\nLocal edit';
  f.data = {
    songs: local,
    songbooks: [{id: 'local-book', name: 'Hobos'}],
    personal: personals(local, 2),
    state: newSyncState('account'),
    journal: emptyJournal(),
  };
  return f;
}
for (const automaticFirst of [false, true])
  test(`feedback: two legitimate Banner versions survive all-Dropbox choices without an extra copy (auto first ${automaticFirst})`, async () => {
    const f = await setup();
    if (automaticFirst) await f.run(false);
    await f.run();
    let choices = 0;
    while (f.data.state.conflicts.length) {
      assert.ok(++choices < 10);
      await f.run(true, {conflict: f.data.state.conflicts[0], choice: 'dropbox'});
    }
    for (let i = 0; i < 2; i++) await f.run();
    assert.equal(f.data.state.pending, false);
    assert.deepEqual(f.data.songs.map(s => s.id).sort(), ['local-0', 'local-1', 'local-2']);
    assert.deepEqual(f.data.songs.map(s => s.original).sort(), [...originals].sort());
    assert.ok(f.data.personal.every(p => p.capo === 5));
    assert.equal(Object.keys(JSON.parse(f.entries.get('/.app/library.json').text).songs).length, 3);
    assert.equal([...f.entries.values()].filter(e => /\/Private\/.*\.cho$/i.test(e.path)).length, 3);
  });

for (const phase of ['upload', 'placement'])
  for (const initiallyEmpty of [true, false])
    test(`feedback: interrupted ${phase} rejoins unpublished files (initially empty ${initiallyEmpty})`, async () => {
      const cloud = fixture(),
        local = fixture();
      function seed(device, prefix, indices) {
        device.change(d => {
          d.songbooks = [{id: prefix + 'book', name: 'Hobos'}];
          d.songs = make(prefix, prefix + 'book').filter((_, i) => indices.includes(i));
          d.personal = personals(d.songs, prefix === 'cloud-' ? 5 : 2);
        });
      }
      if (!initiallyEmpty) {
        seed(cloud, 'cloud-', [1]);
        await cloud.run();
      }
      seed(local, 'local-', [0, 1, 2]);
      local.change(d => {
        d.songs[1].original += '\nLocal edit';
      });
      let block = true;
      const write = cloud.files.write;
      cloud.files.write = async (...args) => {
        if (phase === 'upload' && block && args[0].endsWith('.cho'))
          throw new SyncFailure({code: failureCodes.network, stage: 'sync.file'}, 'offline before upload');
        return write(...args);
      };
      const move = cloud.files.moveBatch;
      cloud.files.moveBatch = async entries => {
        if (phase === 'placement' && block)
          throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.move-batch'}, 'lost launch');
        return move(entries);
      };
      const run = resolution =>
        syncEngine(local.storage, cloud.files, 'account', {valid: () => true, changed() {}}).run(true, resolution);
      await assert.rejects(run());
      assert.ok(Object.values(local.data.state.reservations).some(link => !link.fileId));
      if (phase === 'placement') {
        const placement = local.data.state.placement;
        assert.equal(placement.jobId, undefined);
        assert.ok(placement.entries.every(entry => entry.from.startsWith('/.app/uploads/')));
      }
      assert.equal(JSON.parse(cloud.entries.get('/.app/mutation.json').text).owner, null);
      block = false;
      seed(cloud, 'cloud-', [0, 1, 2]);
      await cloud.run();
      await run();
      let choices = 0;
      while (local.data.state.conflicts.length) {
        assert.ok(++choices < 10);
        await run({conflict: local.data.state.conflicts[0], choice: 'dropbox'});
      }
      await run();
      assert.equal(local.data.songs.length, 3, 'keep two distinct Banner versions and one Bronco');
      assert.deepEqual(local.data.songs.map(s => s.id).sort(), ['local-0', 'local-1', 'local-2']);
      const firstOwner = phase === 'placement' && initiallyEmpty;
      const expected = originals.map((text, i) => (firstOwner && i === 1 ? text + '\nLocal edit' : text));
      assert.deepEqual(local.data.songs.map(s => s.original).sort(), expected.sort());
      assert.equal(local.data.state.pending, false);
      assert.ok(local.data.personal.every(p => p.capo === (firstOwner ? 2 : 5)));
      assert.equal(Object.keys(JSON.parse(cloud.entries.get('/.app/library.json').text).songs).length, 3);
      assert.equal([...cloud.entries.values()].filter(e => e.path.startsWith('/.app/uploads/') && !e.folder).length, 0);
    });

test('feedback: recovery follows the known Dropbox ID when its old path is reused by identical foreign content', async () => {
  const f = fixture();
  await f.run();
  const link = structuredClone(f.data.state.manifest.songs.one);
  const intended = '{t: Intended update}\nMust keep its physical identity';
  f.change(d => {
    d.songs[0].original = intended;
  });
  const write = f.files.write;
  let block = true;
  f.files.write = async (...args) => {
    if (block && args[0] === link.path)
      throw new SyncFailure({code: failureCodes.network, stage: 'sync.file'}, 'lost before commit');
    return write(...args);
  };
  await assert.rejects(f.run(false));
  block = false;
  const target = '/Songbooks/Standard/Private/moved.cho';
  await f.files.move(link.fileId, target);
  const foreign = await f.files.write(link.path, intended, null);
  await f.run();
  await f.run();
  assert.equal(
    f.data.state.manifest.songs.one.fileId,
    link.fileId,
    'never replace a known physical identity with text-equivalent bytes',
  );
  assert.equal(f.entries.get(target.toLowerCase()).text, intended);
  assert.notEqual(foreign.id, link.fileId);
  assert.equal(f.data.state.pending, false);
  assert.equal(Object.values(f.data.state.manifest.songs).filter(s => s.fileId === link.fileId).length, 1);
});

test('feedback: a late abandoned finish remains tracked and is removed on a later permitted sync', async () => {
  const a = fixture(),
    b = fixture();
  for (const [f, id, book] of [
    [a, 'a', 'book-a'],
    [b, 'b', 'book-b'],
  ])
    f.change(d => {
      d.songbooks = [{id: book, name: 'Hobos'}];
      d.songs = [{...song(id, book), origin: {kind: 'local', filename: 'Same.cho', importedAt: id}}];
      d.personal = [{songId: id, version: 3, chorus: {}}];
    });
  const commit = a.files.commitBatch;
  let late,
    block = true;
  a.files.commitBatch = async jobs => {
    if (block && jobs.some(j => j.songId === 'a' && j.kind === 'content')) {
      late = structuredClone(jobs);
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.batch'}, 'delayed server finish');
    }
    return commit(jobs);
  };
  await assert.rejects(a.run());
  block = false;
  await syncEngine(b.storage, a.files, 'account', {valid: () => true, changed() {}}).run(true);
  await a.run();
  assert.equal(a.data.songs.length, 1);
  assert.deepEqual(a.data.state.uploads, {});
  await commit(late);
  await a.run();
  assert.equal([...a.entries.values()].filter(e => e.path.startsWith('/.app/uploads/') && !e.folder).length, 0);
});

test('feedback: book deletion with transfer resumes from the confirmed song-link basis before first manifest', async () => {
  const f = fixture(),
    commit = f.files.commitBatch;
  let block = true;
  f.files.commitBatch = async jobs => {
    if (block && jobs.some(j => j.kind === 'personal'))
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.batch'}, 'personal stage interrupted');
    return commit(jobs);
  };
  await assert.rejects(f.run());
  f.change(d => {
    d.songbooks = [{id: 'other', name: 'Other'}];
    d.songs[0].songbookId = 'other';
    d.journal.deletedBooks.standard = {id: 'standard', name: 'Standard', deleted: true};
  });
  block = false;
  for (let n = 0; n < 4; n++)
    try {
      await f.run();
      break;
    } catch (error) {
      if (!(error instanceof RetrySync) || n === 3) throw error;
    }
  await f.run();
  assert.equal(f.data.state.pending, false);
  assert.equal(f.data.state.manifest.songs.one.songbookId, 'other');
});
