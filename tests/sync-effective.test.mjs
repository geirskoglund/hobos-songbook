import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture, song} from './sync-fixture.mjs';
import {SyncFailure, failureCodes} from '../src/sync/failure.ts';

test('F60: 100 unchanged songs need one metadata operation; one personal edit transfers only its sidecar', async () => {
  const f = fixture();
  f.change(d => {
    d.songs = Array.from({length: 100}, (_, i) => ({
      ...song('s' + i),
      origin: {...song().origin, filename: 's' + i + '.cho'},
    }));
    d.personal = d.songs.map(s => ({songId: s.id, version: 3, chorus: {}}));
  });
  await f.run();
  let snapshots = 0;
  const snapshot = f.storage.snapshot;
  f.storage.snapshot = async (...args) => {
    snapshots++;
    return snapshot(...args);
  };
  let start = f.calls.length;
  await f.run();
  assert.deepEqual(f.calls.slice(start), [['changes']]);
  assert.equal(snapshots, 1);
  start = f.calls.length;
  await f.run(false);
  assert.equal(f.calls.length, start);
  f.change(d => (d.personal[37].capo = 4));
  snapshots = 0;
  start = f.calls.length;
  await f.run(false);
  assert.deepEqual(
    f.calls.slice(start).filter(c => !['/.app/mutation.json', '/.app/library.json'].includes(c[1])),
    [['changes'], ['write', '/.app/songs/s37.json']],
  );
  assert.equal(f.calls.slice(start).filter(c => c[0] === 'write' && c[1] === '/.app/mutation.json').length, 2);
  assert.equal(snapshots, 1);
});
test('F56: confirmed file deletion wins over dirty work and an older device without resurrecting content', async () => {
  const f = fixture();
  await f.run();
  const previous = structuredClone(f.data),
    link = f.data.state.manifest.songs.one;
  f.entries.delete(link.path.toLowerCase());
  f.change(d => {
    d.songs[0].original = '{t: Unsent}\nLocal';
    d.personal[0].capo = 7;
  });
  let start = f.calls.length;
  await f.run(false);
  assert.equal(f.entries.has(link.path.toLowerCase()), false);
  assert.equal(f.data.songs.length, 1);
  assert.ok(f.data.state.manifest.deletedSongs.one);
  assert.equal(
    f.calls.slice(start).some(c => c[0] === 'write' && c[1] === link.path),
    false,
  );
  await f.run();
  assert.equal(f.data.songs.length, 0);
  assert.equal(f.data.personal.length, 0);
  assert.equal(f.data.state.bases.one, undefined);
  assert.equal(f.data.songbooks.length, 1);
  assert.equal(f.entries.has('/.app/songs/one.json'), false);
  f.data = previous;
  f.change(d => (d.personal[0].capo = 8));
  await f.run(false);
  assert.equal(f.entries.has(link.path.toLowerCase()), false);
  await f.run();
  assert.equal(f.data.songs.length, 0);
  assert.equal(f.data.personal.length, 0);
});
for (const mode of ['deleted', 'outside'])
  test(`F57: ${mode} book removes local book/content, preserves unrelated data and does not act on the outside folder`, async () => {
    const f = fixture();
    f.change(d => {
      d.songbooks.push({id: 'other', name: 'Other'});
      d.songs.push(song('two', 'other'));
      d.personal.push({songId: 'two', version: 3, chorus: {}});
    });
    await f.run();
    const book = f.data.state.manifest.books.standard;
    if (mode === 'outside') await f.files.move(book.folderId, '/Moved outside');
    else
      for (const [key, value] of [...f.entries])
        if (value.path === '/Songbooks/Standard' || value.path.startsWith('/Songbooks/Standard/'))
          f.entries.delete(key);
    f.change(d => {
      d.songs.find(s => s.id === 'one').original = '{t: Unsent}\nText';
    });
    await f.run();
    assert.deepEqual(
      f.data.songbooks.map(b => b.id),
      ['other'],
    );
    assert.deepEqual(
      f.data.songs.map(s => s.id),
      ['two'],
    );
    assert.deepEqual(
      f.data.personal.map(p => p.songId),
      ['two'],
    );
    assert.ok(f.data.state.manifest.books.standard.deleted);
    assert.ok(f.data.state.manifest.deletedSongs.one);
    assert.equal(f.data.state.bases.one, undefined);
    if (mode === 'outside') assert.ok(f.entries.has('/moved outside'));
    const count = f.entries.size;
    await f.run();
    assert.equal(f.entries.size, count);
    assert.equal(f.data.state.conflicts.length, 0);
  });
test('F58: missing manifest or failed metadata enumeration does not erase local data', async () => {
  const f = fixture();
  await f.run();
  const before = structuredClone({songs: f.data.songs, personal: f.data.personal, books: f.data.songbooks});
  const changes = f.files.changes;
  f.files.changes = async () => {
    throw new SyncFailure({code: failureCodes.permission, stage: 'dropbox.list', status: 403}, 'No access');
  };
  await assert.rejects(f.run());
  assert.deepEqual({songs: f.data.songs, personal: f.data.personal, books: f.data.songbooks}, before);
  f.files.changes = changes;
  f.entries.delete('/.app/library.json');
  await assert.rejects(f.run(), /bibliotekmetadata/);
  assert.deepEqual({songs: f.data.songs, personal: f.data.personal, books: f.data.songbooks}, before);
});
test('F60: resetting the cursor rebuilds metadata without content downloads or false deletion', async () => {
  const f = fixture();
  await f.run();
  const changes = f.files.changes;
  f.files.changes = () => changes(undefined);
  const before = f.calls.length;
  await f.run();
  assert.deepEqual(f.calls.slice(before), [['changes']]);
  assert.equal(f.data.songs.length, 1);
  assert.equal(f.data.state.manifest.deletedSongs, undefined);
});
test('F58: valid file metadata without parent metadata cannot falsely delete a known book', async () => {
  const f = fixture();
  await f.run();
  const changes = f.files.changes;
  f.files.changes = async () => {
    const result = await changes(undefined);
    return {...result, entries: result.entries.filter(e => !e.folder)};
  };
  await f.run();
  assert.equal(f.data.songbooks.length, 1);
  assert.equal(f.data.songs.length, 1);
  assert.equal(f.data.state.manifest.deletedSongs, undefined);
});
test('F23: a lost first upload response resumes the same identity and writes non-default personal data', async () => {
  const f = fixture();
  f.change(d => (d.personal[0].capo = 5));
  const write = f.files.write;
  let failed = false;
  f.files.write = async (...args) => {
    const result = await write(...args);
    if (!failed && args[0].endsWith('.cho')) {
      failed = true;
      throw Error('lost response');
    }
    return result;
  };
  await f.run(false);
  await f.run(false);
  assert.equal(f.data.state.pending, false);
  assert.equal(f.data.state.conflicts.length, 0);
  assert.equal([...f.entries.values()].filter(e => e.path.endsWith('.cho')).length, 1);
  assert.equal(JSON.parse(f.entries.get('/.app/songs/one.json').text).data.capo, 5);
});
test('rate limiting stops queued transfers, retains local work and can resume without duplicate files', async () => {
  const f = fixture();
  f.change(d => {
    d.songs = Array.from({length: 20}, (_, i) => ({
      ...song('rate-' + i),
      origin: {...song().origin, filename: 'rate-' + i + '.cho'},
    }));
    d.personal = [];
  });
  const write = f.files.write;
  let attempts = 0;
  f.files.write = async (...args) => {
    attempts++;
    throw new SyncFailure({code: failureCodes.throttled, stage: 'dropbox.request', status: 429}, 'Rate limited');
  };
  await assert.rejects(f.run(false), e => e.info?.code === failureCodes.throttled);
  assert.ok(attempts <= 4);
  assert.equal(f.data.songs.length, 20);
  f.files.write = write;
  await f.run(false);
  assert.equal(f.data.state.pending, false);
  assert.equal([...f.entries.values()].filter(e => e.path.endsWith('.cho')).length, 20);
});
test('moving a known private file to Shared updates its link and keeps person data private', async () => {
  const f = fixture();
  await f.run();
  const link = f.data.state.manifest.songs.one,
    target = '/Songbooks/Standard/Shared/song.cho';
  await f.files.move(link.fileId, target);
  f.change(d => (d.personal[0].capo = 9));
  const start = f.calls.length;
  await f.run();
  assert.equal(f.data.songs.length, 1);
  assert.equal(f.data.personal[0].capo, 9);
  assert.equal(f.data.state.manifest.deletedSongs, undefined);
  assert.equal(f.data.state.manifest.songs.one.path, target);
  assert.equal(f.data.state.manifest.songs.one.fileId, link.fileId);
  assert.ok(f.entries.has(target.toLowerCase()));
  assert.equal(f.entries.has(link.path.toLowerCase()), false);
  assert.equal(
    f.calls.slice(start).some(c => c[0] === 'move' || (c[0] === 'write' && c[1].endsWith('.cho'))),
    false,
  );
});
test('moving a private file to Originals removes the local song and preserves the physical Originals file', async () => {
  const f = fixture();
  await f.run();
  const link = f.data.state.manifest.songs.one,
    target = '/Songbooks/Standard/Originals/song.cho';
  await f.files.move(link.fileId, target);
  f.change(d => (d.personal[0].capo = 9));
  await f.run();
  assert.equal(f.data.songs.length, 0);
  assert.equal(f.data.personal.length, 0);
  assert.ok(f.data.state.manifest.deletedSongs.one);
  assert.ok(f.entries.has(target.toLowerCase()));
  assert.equal(f.entries.has(link.path.toLowerCase()), false);
});
test('F21/F31: choosing an automatic conflict version updates only that song and never records a manual sync', async () => {
  const f = fixture();
  f.change(d => {
    d.songs.push({...song('two'), title: 'Other', original: '{t: Other}\nText'});
    d.personal.push({songId: 'two', version: 3, chorus: {}});
  });
  await f.run(false);
  const a = f.data.state.manifest.songs.one,
    b = f.data.state.manifest.songs.two;
  for (const [link, text] of [
    [a, '{t: Remote A}\nText'],
    [b, '{t: Remote B}\nText'],
  ]) {
    const old = await f.files.read(link.path);
    await f.files.write(link.path, text, old.rev);
  }
  f.change(d => (d.songs[0].original = '{t: Local A}\nText'));
  await f.run(false);
  const conflict = f.data.state.conflicts.find(c => c.songId === 'one');
  assert.ok(conflict);
  await f.run(false, {conflict, choice: 'dropbox'});
  assert.equal(f.data.songs.find(s => s.id === 'one').title, 'Remote A');
  assert.equal(f.data.songs.find(s => s.id === 'two').title, 'Other');
  assert.equal(f.data.state.lastManual, undefined);
});
