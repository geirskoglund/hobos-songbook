import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, song} from './sync-fixture.mjs';
import {syncEngine} from '../src/sync/engine.ts';
import {DeferredSync, RetrySync, failureCodes} from '../src/core/failure.ts';

async function retry(storage, files, manual = true, resolution) {
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      return await syncEngine(storage, files, 'account', {valid: () => true, changed() {}}).run(manual, resolution);
    } catch (error) {
      if (!(error instanceof RetrySync) || attempt === 2) throw error;
    }
}

test('review: concurrent discovery publishes one identity for one Dropbox file, including after CAS retry', async () => {
  const left = fixture();
  left.change(d => {
    d.songs = [];
    d.personal = [];
  });
  await left.run();
  const right = fixture();
  right.data = left.data;
  await left.files.write('/Songbooks/Standard/Private/discovered.cho', '{t: Discovered}\nText', null);
  delete right.data.state.mutationOwner;
  delete right.data.state.mutationPending;
  const results = await Promise.allSettled([retry(left.storage, left.files), retry(right.storage, left.files)]);
  for (const result of results) if (result.status === 'rejected') assert.ok(result.reason instanceof DeferredSync);
  await retry(left.storage, left.files);
  await retry(right.storage, left.files);
  const manifest = JSON.parse(left.entries.get('/.app/library.json').text);
  assert.equal(Object.values(manifest.songs).length, 1, 'one manifest identity for the physical file');
  for (const device of [left, right]) {
    assert.equal(device.data.songs.length, 1, 'one local song on either device');
    assert.equal(device.data.state.pending, false);
    const before = device.data.songs[0].id;
    await retry(device.storage, left.files);
    assert.equal(device.data.songs[0].id, before, 'retry preserves local identity');
    assert.equal(device.data.songs.length, 1);
  }
  assert.equal([...left.entries.values()].filter(e => e.path.endsWith('.cho')).length, 1);
});

test('review F57: confirmed book deletion removes never-uploaded songs and their personal data', async () => {
  const f = fixture();
  await f.run();
  f.change(d => {
    d.songs.push(song('unsent', 'standard', '{t: Offline}\nPrivate'));
    d.personal.push({songId: 'unsent', version: 3, chorus: {}, capo: 8});
  });
  const book = f.data.state.manifest.books.standard;
  for (const [key, value] of [...f.entries])
    if (value.path === book.path || value.path.startsWith(book.path + '/')) f.entries.delete(key);
  await f.run();
  assert.equal(f.data.songbooks.length, 0);
  assert.equal(f.data.songs.length, 0, 'also delete a song absent from the old manifest');
  assert.equal(f.data.personal.length, 0);
  await f.run();
  assert.equal(f.data.songs.length, 0);
  assert.equal(f.data.state.pending, false);
});

test('review F26: an automatic conflict choice cannot import an unrelated new remote book', async () => {
  const f = fixture();
  await f.run();
  delete f.data.state.lastManual;
  const folder = await f.files.folder('/Songbooks/Other device');
  const file = await f.files.read('/.app/library.json'),
    manifest = JSON.parse(file.text);
  manifest.books.unrelated = {id: 'unrelated', name: 'Other device', folderId: folder.id, path: folder.path};
  await f.files.write(file.path, JSON.stringify(manifest), file.rev);
  const link = manifest.songs.one,
    content = await f.files.read(link.path);
  await f.files.write(link.path, '{t: Remote}\nRemote words', content.rev);
  f.change(d => {
    d.songs[0].original = '{t: Local}\nLocal words';
  });
  await f.run(false);
  assert.deepEqual(
    f.data.songbooks.map(b => b.id),
    ['standard'],
  );
  const conflict = f.data.state.conflicts.find(c => c.songId === 'one' && c.kind === 'content');
  assert.ok(conflict);
  await f.run(false, {conflict, choice: 'dropbox'});
  assert.equal(f.data.songs[0].title, 'Remote');
  assert.deepEqual(
    f.data.songbooks.map(b => b.id),
    ['standard'],
    'choice authorizes only its song',
  );
  assert.equal(f.data.state.lastManual, undefined);
  await f.run();
  assert.ok(
    f.data.songbooks.some(b => b.id === 'unrelated'),
    'explicit manual sync imports the book',
  );
});

test('review bulk: many changed songs use grouped session commits instead of one namespace commit per file', async () => {
  const f = fixture();
  f.change(d => {
    d.songs = Array.from({length: 20}, (_, i) => ({
      ...song('many-' + i),
      origin: {kind: 'local', filename: 'many-' + i + '.cho', importedAt: '2026-01-01'},
    }));
    d.personal = [];
  });
  const batches = [],
    sessions = new Map();
  let sequence = 0;
  f.files.beginUpload = async text => {
    const id = 'session-' + ++sequence;
    sessions.set(id, text);
    return {id, created: Date.now()};
  };
  f.files.commitBatch = async jobs => {
    batches.push(jobs.length);
    const result = [];
    for (const job of jobs) {
      assert.equal(sessions.get(job.session.id), job.text);
      result.push({value: await f.files.write(job.path, job.text, job.rev)});
    }
    return result;
  };
  await f.run();
  assert.deepEqual(batches, [20, 20], 'one grouped content commit, then one grouped personal commit');
});

test('independent review: retry of a copy choice preserves newer copy edits and later copy choices get a new identity', async () => {
  const f = fixture();
  await f.run();
  const link = f.data.state.manifest.songs.one;
  let remote = await f.files.read(link.path);
  await f.files.write(link.path, '{t: Remote}\nRemote words', remote.rev);
  f.change(d => {
    d.songs[0].original = '{t: Local}\nLocal words';
  });
  await f.run(false);
  f.fail('/.app/songs/one.json');
  await f.run(false, {conflict: f.data.state.conflicts[0], choice: 'copy'});
  const copy = f.data.songs.find(s => s.id !== 'one');
  assert.ok(copy);
  assert.ok(f.data.state.decisions['one:content']);
  const newer = '{t: New edit on copy}\nMust survive';
  f.change(d => {
    d.songs.find(s => s.id === copy.id).original = newer;
    d.personal.find(p => p.songId === copy.id).capo = 9;
  });
  await f.run(false);
  await f.run(false);
  assert.equal(f.data.songs.find(s => s.id === copy.id).original, newer);
  assert.equal(f.data.personal.find(p => p.songId === copy.id).capo, 9);
  let manifest = JSON.parse(f.entries.get('/.app/library.json').text);
  assert.equal(f.entries.get(manifest.songs[copy.id].path.toLowerCase()).text, newer);
  remote = await f.files.read(link.path);
  await f.files.write(link.path, '{t: Another remote}\nRemote', remote.rev);
  f.change(d => {
    d.songs.find(s => s.id === 'one').original = '{t: Another local}\nLocal';
  });
  await f.run(false);
  await f.run(false, {conflict: f.data.state.conflicts.find(c => c.songId === 'one'), choice: 'copy'});
  await f.run(false);
  assert.equal(f.data.songs.length, 3);
  assert.equal(f.data.songs.find(s => s.id === copy.id).original, newer);
  manifest = JSON.parse(f.entries.get('/.app/library.json').text);
  assert.equal(Object.keys(manifest.songs).length, 3);
});

for (const phase of ['first join', 'known binding', 'linked in Shared'])
  test(`independent review: missing published personal data is never replaced by defaults during ${phase}`, async () => {
    const cloud = fixture();
    await cloud.run();
    const local = fixture();
    local.change(d => {
      d.songs[0].id = 'local';
      d.personal[0].songId = 'local';
    });
    const run = () => syncEngine(local.storage, cloud.files, 'account', {valid: () => true, changed() {}}).run(true);
    if (phase !== 'first join') await run();
    const link = cloud.data.state.manifest.songs.one;
    if (phase === 'linked in Shared') await cloud.files.move(link.fileId, '/Songbooks/Standard/Shared/held.cho');
    cloud.entries.delete('/.app/songs/one.json');
    await run();
    assert.equal(cloud.entries.has('/.app/songs/one.json'), false, 'no empty replacement sidecar');
    assert.equal(local.data.personal.find(p => p.songId === 'local').capo, 2, 'preserve complete local personal data');
    assert.equal(local.data.state.failure.code, failureCodes.personal);
    assert.equal(local.data.state.pending, true);
  });
