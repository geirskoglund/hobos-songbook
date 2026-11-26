import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, song} from './sync-fixture.mjs';
import {BatchStatusUnconfirmed, SyncFailure, failureCodes, RetrySync} from '../src/core/failure.ts';
import {hash} from '../src/sync/model.ts';
import {emptyJournal} from '../src/core/sync-model.ts';
import {newSyncState} from '../src/sync/state.ts';
import {syncEngine} from '../src/sync/engine.ts';

async function retry(f) {
  for (let n = 0; n < 5; n++)
    try {
      return await f.run();
    } catch (error) {
      if (!(error instanceof RetrySync) || n === 4) throw error;
    }
}
const manifest = f => JSON.parse(f.entries.get('/.app/library.json').text);
const songs = f => [...f.entries.values()].filter(e => /\/Private\/[^/]+\.cho$/i.test(e.path));
test('names: imported source names and extensions are preserved without identity suffixes', async () => {
  const f = fixture();
  f.change(d => {
    d.songs[0].origin.filename = 'Original source.song.txt';
    d.songs[0].title = 'A different title';
  });
  await retry(f);
  assert.equal(manifest(f).songs.one.path, '/Songbooks/Standard/Private/Original source.song.cho');
  assert.ok(f.entries.has('/songbooks/standard/originals/original source.song.txt'));
  assert.equal([...f.entries.values()].filter(e => e.path.includes('/Originals/')).length, 1);
});
test('names: app-created songs use their title including dots and get no Originals copy', async () => {
  const f = fixture();
  f.change(d => {
    d.songs[0].origin.filename = '';
    d.songs[0].title = 'Song v2.0';
  });
  await retry(f);
  assert.equal(manifest(f).songs.one.path, '/Songbooks/Standard/Private/Song v2.0.cho');
  assert.equal([...f.entries.values()].filter(e => e.path.includes('/Originals/')).length, 0);
});
test('names: genuine case-insensitive collisions get (2), while unrelated files and local identities survive', async () => {
  const f = fixture();
  f.change(d => {
    d.songs[0].origin.filename = 'same.cho';
  });
  await retry(f);
  f.change(d => {
    d.songs.push({...song('second'), origin: {...d.songs[0].origin, filename: 'SAME.cho'}});
    d.personal.push({songId: 'second', version: 3, chorus: {}, capo: 8});
  });
  await retry(f);
  assert.equal(manifest(f).songs.one.path, '/Songbooks/Standard/Private/same.cho');
  assert.equal(manifest(f).songs.second.path, '/Songbooks/Standard/Private/SAME (2).cho');
  assert.equal(f.data.songs.length, 2);
  assert.notEqual(manifest(f).songs.one.fileId, manifest(f).songs.second.fileId);
});
test('names: existing legacy paths are retained through edits and repeated sync', async () => {
  const f = fixture();
  await retry(f);
  const m = manifest(f),
    link = m.songs.one;
  const legacy = '/Songbooks/Standard/Private/old--' + 'a'.repeat(64) + '.cho';
  await f.files.move(link.fileId, legacy);
  link.path = legacy;
  await f.files.write('/.app/library.json', JSON.stringify(m), f.entries.get('/.app/library.json').rev);
  await retry(f);
  f.change(d => {
    d.songs[0].original += '\nEdited';
    d.songs[0].title = 'Renamed title';
  });
  await retry(f);
  assert.equal(manifest(f).songs.one.path, legacy);
  assert.equal(songs(f).length, 1);
});
test('names: a lost creation commit cannot claim an identical foreign file at the readable destination', async () => {
  const f = fixture();
  f.change(d => {
    d.songs = [];
    d.personal = [];
  });
  await f.run();
  f.change(d => {
    d.songs = [{...song(), origin: {...song().origin, filename: 'Same.cho'}}];
    d.personal = [{songId: 'one', version: 3, chorus: {}, capo: 2}];
  });
  const commit = f.files.commitBatch;
  let lost = false;
  f.files.commitBatch = async jobs => {
    const result = await commit(jobs);
    if (!lost && jobs.some(j => j.kind === 'content')) {
      lost = true;
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.batch'}, 'lost reply');
    }
    return result;
  };
  await assert.rejects(f.run());
  const foreign = await f.files.write('/Songbooks/Standard/Private/Same.cho', f.data.songs[0].original, null);
  await retry(f);
  assert.equal(manifest(f).songs.one.path, '/Songbooks/Standard/Private/Same (2).cho');
  assert.notEqual(manifest(f).songs.one.fileId, foreign.id);
  assert.equal(songs(f).length, 2);
  assert.equal([...f.entries.values()].filter(e => e.path.startsWith('/.app/uploads/') && !e.folder).length, 0);
});
test('names: a destination collision during the move preserves staged data and retries with a readable number', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let race = true,
    foreign;
  f.files.moveBatch = async entries => {
    if (race) {
      race = false;
      foreign = await f.files.write(entries[0].to, '{t: Foreign}\nDo not overwrite', null);
    }
    return move(entries);
  };
  await retry(f);
  assert.equal(manifest(f).songs.one.path, '/Songbooks/Standard/Private/en (2).cho');
  assert.equal(f.entries.get(foreign.path.toLowerCase()).text, foreign.text);
  assert.notEqual(manifest(f).songs.one.fileId, foreign.id);
});

test('names: async placement stores its job ID, stops without a timer and resumes the same server job', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let plan,
    launches = 0,
    checks = 0,
    complete = false;
  f.change(d => {
    d.songs[0].origin.filename = 'one.cho';
  });
  f.files.moveBatch = async entries => {
    plan = structuredClone(entries);
    launches++;
    return {asyncJobId: 'move-job'};
  };
  f.files.checkMoveBatch = async id => {
    assert.equal(id, 'move-job');
    checks++;
    return complete ? move(plan) : {inProgress: true};
  };
  await assert.rejects(f.run(), error => error.reason === 'connection');
  assert.equal(f.data.state.placement.jobId, 'move-job');
  assert.equal(f.data.state.lastManual, undefined);
  assert.equal(launches, 1);
  assert.ok(checks >= 1 && checks <= 6);
  const stopped = checks;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(checks, stopped, 'no checks after the allowed run has returned');
  complete = true;
  await retry(f);
  assert.equal(launches, 1);
  assert.equal(songs(f).length, 1);
  assert.equal(f.data.state.pending, false);
  assert.equal(f.data.state.placement, undefined);
});

test('names: an async status error resolves an already placed staging file by ID', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let staged,
    launches = 0;
  f.files.moveBatch = async entries => {
    if (entries.some(entry => entry.to.includes('/Private/'))) {
      launches++;
      staged = structuredClone(entries);
      return {asyncJobId: 'accepted-placement'};
    }
    return move(entries);
  };
  f.files.checkMoveBatch = async id => {
    assert.equal(id, 'accepted-placement');
    throw new BatchStatusUnconfirmed(
      {code: failureCodes.changed, stage: 'dropbox.move-batch', status: 409},
      'status unavailable',
    );
  };
  await assert.rejects(f.run(), BatchStatusUnconfirmed);
  assert.equal(f.data.state.placement.jobId, 'accepted-placement');
  assert.ok(JSON.parse(f.entries.get('/.app/mutation.json').text).owner);
  await move(staged);
  const start = f.calls.length;
  await retry(f);
  assert.equal(launches, 1);
  assert.equal(manifest(f).songs.one.fileId, staged[0].fileId);
  assert.equal(manifest(f).songs.one.path, staged[0].to);
  assert.equal(f.data.state.placement, undefined);
  assert.equal(JSON.parse(f.entries.get('/.app/mutation.json').text).owner, null);
  assert.equal(f.calls.slice(start).filter(([kind]) => kind === 'metadata').length, 0);
});

test('names: lost move launch, destination collision and a late old server job cannot move the final file again', async () => {
  const f = fixture();
  f.change(d => {
    d.songs = [];
    d.personal = [];
  });
  await f.run();
  f.change(d => {
    d.songs = [{...song(), origin: {...song().origin, filename: 'Same.cho'}}];
    d.personal = [{songId: 'one', version: 3, chorus: {}}];
  });
  const move = f.files.moveBatch;
  let delayed,
    first = true;
  f.files.moveBatch = async entries => {
    if (first) {
      first = false;
      delayed = structuredClone(entries);
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.move-batch'}, 'lost async launch reply');
    }
    return move(entries);
  };
  await assert.rejects(f.run());
  const intended = f.data.songs[0].original;
  const foreign = await f.files.write('/Songbooks/Standard/Private/Same.cho', intended, null);
  await retry(f);
  const link = manifest(f).songs.one;
  assert.equal(link.path, '/Songbooks/Standard/Private/Same (2).cho');
  assert.notEqual(link.fileId, foreign.id);
  f.change(d => {
    d.songs.find(s => s.id === 'one').original += '\nNewer local generation';
  });
  await retry(f);
  const late = await move(delayed);
  assert.ok(late.entries.every(result => result.missing));
  assert.equal(manifest(f).songs.one.fileId, link.fileId);
  assert.equal(manifest(f).songs.one.path, link.path);
  assert.ok(f.entries.get(link.path.toLowerCase()).text.endsWith('Newer local generation'));
  assert.equal(songs(f).length, 2);
  assert.ok(delayed.every(entry => entry.from.startsWith('/.app/uploads/')));
});

test('names: a completed move whose reply was lost resumes by its owned file ID without another copy', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let lost = true,
    owned;
  f.files.moveBatch = async entries => {
    const result = await move(entries);
    if (lost) {
      lost = false;
      owned = entries[0].fileId;
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.move-batch'}, 'lost completion');
    }
    return result;
  };
  await assert.rejects(f.run());
  await retry(f);
  assert.equal(manifest(f).songs.one.fileId, owned);
  assert.equal(songs(f).length, 1);
  assert.equal(f.data.state.pending, false);
});

test('names: mixed placement results retain successes and retry only write-lock failures', async () => {
  const f = fixture();
  f.change(d => {
    d.songs = [
      {...song('one'), origin: {...song().origin, filename: 'one.cho'}},
      {...song('two'), origin: {...song().origin, filename: 'two.cho'}},
    ];
    d.personal = [];
  });
  const move = f.files.moveBatch,
    sizes = [];
  let limit = true;
  f.files.moveBatch = async entries => {
    sizes.push(entries.length);
    if (limit) {
      limit = false;
      const done = await move(entries.slice(0, 1));
      return {
        entries: [
          ...done.entries,
          {
            failure: {
              code: failureCodes.throttled,
              stage: 'dropbox.move-batch',
              status: 200,
              limitReason: 'too_many_write_operations',
              retryAfterMs: 0,
            },
          },
        ],
      };
    }
    return move(entries);
  };
  await retry(f);
  assert.deepEqual(sizes, [2, 1]);
  assert.equal(songs(f).length, 2);
  assert.equal(f.data.state.pending, false);
});

test('names: a new device reuses the generated Originals identity instead of copying the same source again', async () => {
  const f = fixture();
  await retry(f);
  const first = manifest(f).songs.one.originalFile;
  assert.ok(first?.fileId);
  f.data = {songs: [], songbooks: [], personal: [], journal: emptyJournal(), state: newSyncState('account')};
  await retry(f);
  await retry(f);
  assert.deepEqual(manifest(f).songs.one.originalFile, first);
  assert.equal([...f.entries.values()].filter(e => e.path.includes('/Originals/')).length, 1);
});

test('names: a legacy generated Originals copy is linked without renaming it or creating another', async () => {
  const f = fixture();
  await retry(f);
  const m = manifest(f),
    old = m.songs.one.originalFile;
  const legacy = '/Songbooks/Standard/Originals/en--' + (await hash('one')) + '.txt';
  await f.files.move(old.fileId, legacy);
  delete m.songs.one.originalFile;
  await f.files.write('/.app/library.json', JSON.stringify(m), f.entries.get('/.app/library.json').rev);
  f.data = {
    songs: [{...song('local'), origin: {...song().origin, importedAt: 'new device'}}],
    songbooks: [{id: 'standard', name: 'Standard'}],
    personal: [{songId: 'local', version: 3, chorus: {}, capo: 2}],
    journal: emptyJournal(),
    state: newSyncState('account'),
  };
  await retry(f);
  assert.deepEqual(manifest(f).songs.one.originalFile, {fileId: old.fileId, path: legacy});
  assert.equal([...f.entries.values()].filter(e => e.path.includes('/Originals/')).length, 1);
});

test('names: the same owned staging ID accepts a newer submitted revision after a lost update reply', async () => {
  const f = fixture();
  f.change(d => {
    d.songs[0].origin.filename = 'Song.cho';
  });
  const write = f.files.write;
  let block = true;
  f.files.write = async (...args) => {
    if (block && args[0] === '/.app/upload-index.json')
      throw new SyncFailure({code: failureCodes.network, stage: 'sync.upload-index'}, 'index unavailable');
    return write(...args);
  };
  await assert.rejects(f.run());
  const before = f.data.state.uploads['content:one'].creation.file.id;
  block = false;
  f.change(d => {
    d.songs[0].original += '\nNewer local edit';
  });
  const commit = f.files.commitBatch;
  let lost = true;
  f.files.commitBatch = async jobs => {
    const result = await commit(jobs);
    if (lost && jobs.some(j => j.creation && j.rev)) {
      lost = false;
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.batch'}, 'lost update reply');
    }
    return result;
  };
  await assert.rejects(f.run());
  await retry(f);
  assert.equal(f.data.state.pending, false);
  assert.equal(manifest(f).songs.one.fileId, before);
  assert.ok(songs(f)[0].text.endsWith('Newer local edit'));
});

test('names: pending txt provenance survives an interrupted manifest and two independently used devices', async () => {
  const a = fixture(),
    b = fixture();
  for (const [f, id, book] of [
    [a, 'song-a', 'book-a'],
    [b, 'song-b', 'book-b'],
  ])
    f.change(d => {
      d.songbooks = [{id: book, name: 'Hobos'}];
      d.songs = [{...song(id, book), origin: {kind: 'local', filename: 'Same song.txt', importedAt: id}}];
      d.personal = [{songId: id, version: 3, chorus: {}, capo: 2}];
    });
  const write = a.files.write;
  let block = true;
  a.files.write = async (...args) => {
    if (block && args[0] === '/.app/library.json')
      throw new SyncFailure({code: failureCodes.network, stage: 'sync.manifest'}, 'manifest unavailable');
    return write(...args);
  };
  await assert.rejects(a.run());
  const runB = () => syncEngine(b.storage, a.files, 'account', {valid: () => true, changed() {}}).run(true);
  block = false;
  await runB();
  assert.equal(b.data.songs.length, 1);
  assert.equal(b.data.state.pending, true);
  assert.equal(b.data.state.lastManual, undefined);
  await retry(a);
  await runB();
  assert.equal(b.data.state.pending, false);
  assert.equal(b.data.songs[0].id, 'song-b');
  assert.equal(b.data.state.bindings.songs['song-b'], 'song-a');
  assert.equal(Object.keys(manifest(a).songs).length, 1);
  assert.equal(manifest(a).songs['song-a'].origin.filename, 'Same song.txt');
  assert.equal(songs(a).length, 1);
  assert.equal([...a.entries.values()].filter(e => e.path.includes('/Originals/')).length, 1);
  assert.deepEqual(JSON.parse(a.entries.get('/.app/upload-index.json').text).entries, {});
});

test('names: empty import filenames never match unrelated app-created songs during first coordination', async () => {
  const a = fixture(),
    b = fixture();
  for (const [f, id, title] of [
    [a, 'a', 'North wind'],
    [b, 'b', 'Southern road'],
  ])
    f.change(d => {
      d.songs = [
        {
          ...song(id, 'standard', `{t: ${title}}\nWords ${id}`),
          title,
          origin: {kind: 'local', filename: '', importedAt: id},
        },
      ];
      d.personal = [{songId: id, version: 3, chorus: {}}];
    });
  await retry(a);
  await syncEngine(b.storage, a.files, 'account', {valid: () => true, changed() {}}).run(true);
  assert.equal(b.data.state.conflicts.length, 0);
  assert.equal(b.data.songs.length, 2);
  assert.equal(songs(a).length, 2);
  assert.equal(Object.keys(manifest(a).songs).length, 2);
});

test('names: a delayed move targets the same folder ID through an external book rename', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let first = true,
    plan;
  f.files.moveBatch = async entries => {
    if (first) {
      first = false;
      plan = structuredClone(entries);
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.move-batch'}, 'launch reply lost');
    }
    return move(entries);
  };
  await assert.rejects(f.run());
  const folder = f.data.state.folders.standard;
  await f.files.move(folder.folderId, '/Songbooks/Renamed');
  await retry(f);
  assert.ok(plan.every(entry => entry.toReference.startsWith('id:')));
  assert.equal(manifest(f).books.standard.name, 'Renamed');
  assert.equal(manifest(f).songs.one.path, '/Songbooks/Renamed/Private/en.cho');
  assert.equal(f.entries.has('/songbooks/standard'), false);
  assert.equal(songs(f).length, 1);
});

test('names: omitted move display paths are resolved by owned ID after a folder rename', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let first = true;
  f.files.moveBatch = async entries => {
    if (first) {
      first = false;
      await f.files.move(f.data.state.folders.standard.folderId, '/Songbooks/Renamed');
    }
    const reply = await move(entries);
    for (const result of reply.entries) if ('value' in result) result.value.path = '';
    return reply;
  };
  await retry(f);
  assert.equal(manifest(f).songs.one.path, '/Songbooks/Renamed/Private/en.cho');
  assert.equal(f.entries.has('/songbooks/standard'), false);
  assert.equal(songs(f).length, 1);
});

test('names: an expired async job replays only its immutable staging plan', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let original,
    launches = 0;
  f.files.moveBatch = async entries => {
    launches++;
    if (launches === 1) {
      original = structuredClone(entries);
      return {asyncJobId: 'expired'};
    }
    if (entries[0].key === original[0].key) assert.deepEqual(entries, original);
    return move(entries);
  };
  f.files.checkMoveBatch = async id => {
    assert.equal(id, 'expired');
    return {jobExpired: true};
  };
  await assert.rejects(f.run(), error => error.reason === 'connection');
  await retry(f);
  assert.equal(songs(f).length, 1);
  assert.equal(f.data.state.pending, false);
});

test('names: pending Originals placement cannot be falsely acknowledged after the personal layer succeeds', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let block = true;
  f.files.moveBatch = async entries => {
    if (block && entries.some(entry => entry.to.includes('/Originals/')))
      return {
        entries: entries.map(() => ({failure: {code: failureCodes.request, stage: 'dropbox.move-batch', status: 200}})),
      };
    return move(entries);
  };
  await f.run();
  assert.ok(f.entries.get('/.app/songs/one.json'));
  assert.equal(f.data.state.pending, true);
  assert.equal(f.data.state.lastManual, undefined);
  assert.ok(f.data.state.uploads['original:one'].creation.file);
  block = false;
  await retry(f);
  await retry(f);
  assert.equal(f.data.state.pending, false);
  assert.ok(manifest(f).songs.one.originalFile?.fileId);
  assert.equal([...f.entries.values()].filter(e => e.path.includes('/Originals/')).length, 1);
  assert.equal([...f.entries.values()].filter(e => e.path.startsWith('/.app/uploads/') && !e.folder).length, 0);
});

test('names: account/session cancellation interrupts async status checks and retains the same job for resume', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let plan,
    allowed = true,
    complete = false,
    checks = 0;
  f.files.moveBatch = async entries => {
    plan = structuredClone(entries);
    return {asyncJobId: 'owned-job'};
  };
  f.files.checkMoveBatch = async () => {
    checks++;
    if (!complete) {
      allowed = false;
      return {inProgress: true};
    }
    return move(plan);
  };
  const run = () => syncEngine(f.storage, f.files, 'account', {valid: () => allowed, changed() {}}).run(true);
  await assert.rejects(run(), error => error.reason === 'session');
  assert.equal(f.data.state.placement.jobId, 'owned-job');
  const stopped = checks;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(checks, stopped);
  allowed = true;
  complete = true;
  await run();
  assert.equal(f.data.state.pending, false);
  assert.equal(songs(f).length, 1);
});

test('names: the shared fence and provenance preserve identities across an unpublished manifest', async () => {
  const a = fixture(),
    b = fixture();
  for (const [f, id, book] of [
    [a, 'song-a', 'book-a'],
    [b, 'song-b', 'book-b'],
  ])
    f.change(d => {
      d.songbooks = [{id: book, name: 'Hobos'}];
      d.songs = [{...song(id, book), origin: {kind: 'local', filename: 'Same song.txt', importedAt: id}}];
      d.personal = [{songId: id, version: 3, chorus: {}, capo: 2}];
    });
  const write = a.files.write;
  let block = true;
  a.files.write = async (...args) => {
    if (block && args[0] === '/.app/library.json')
      throw new SyncFailure({code: failureCodes.network, stage: 'sync.manifest'}, 'manifest unavailable');
    return write(...args);
  };
  await assert.rejects(a.run());
  block = false;
  await a.run();
  const runB = () => syncEngine(b.storage, a.files, 'account', {valid: () => true, changed() {}}).run(true);
  for (let n = 0; n < 4; n++)
    try {
      await runB();
      break;
    } catch (error) {
      if (!(error instanceof RetrySync) || n === 3) throw error;
    }
  assert.equal(b.data.state.pending, false);
  assert.equal(b.data.songs.length, 1);
  assert.equal(b.data.songs[0].id, 'song-b');
  assert.equal(Object.keys(manifest(a).songs).length, 1);
  assert.equal(songs(a).length, 1);
  // A later, valid manifest revision need not rewrite an older cleanup anchor.
  const m = manifest(a);
  m.books.other = {
    id: 'other',
    name: 'Other',
    path: '/Songbooks/Other',
    folderId: (await a.files.folder('/Songbooks/Other')).id,
  };
  await a.files.write('/.app/library.json', JSON.stringify(m), a.entries.get('/.app/library.json').rev);
  await runB();
  assert.equal(b.data.state.pending, false);
  assert.equal(b.data.songs.length, 1);
  assert.ok(b.data.songbooks.some(book => book.name === 'Other'));
});

test('names: book transfer resolves a real basename collision and retains the same two physical identities', async () => {
  const f = fixture();
  f.change(d => {
    d.songbooks = [
      {id: 'a', name: 'A'},
      {id: 'b', name: 'B'},
    ];
    d.songs = [
      {...song('one', 'a', '{t: First}\nFirst song'), origin: {kind: 'local', filename: 'same.txt', importedAt: 'a'}},
      {...song('two', 'b', '{t: Second}\nSecond song'), origin: {kind: 'local', filename: 'same.txt', importedAt: 'b'}},
    ];
    d.personal = [
      {songId: 'one', version: 3, chorus: {}, capo: 2},
      {songId: 'two', version: 3, chorus: {}, capo: 7},
    ];
  });
  await retry(f);
  const before = manifest(f);
  f.change(d => {
    d.songbooks = d.songbooks.filter(b => b.id !== 'a');
    d.songs.find(s => s.id === 'one').songbookId = 'b';
    d.journal.deletedBooks.a = {id: 'a', name: 'A', deleted: true};
  });
  const move = f.files.move;
  let lost = true;
  f.files.move = async (from, to) => {
    const result = await move(from, to);
    if (lost && from === before.songs.one.fileId) {
      lost = false;
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.move'}, 'lost transfer receipt');
    }
    return result;
  };
  await assert.rejects(f.run());
  await retry(f);
  await retry(f);
  const after = manifest(f);
  assert.equal(f.data.state.pending, false);
  assert.equal(after.songs.one.path, '/Songbooks/B/Private/same (2).cho');
  assert.equal(after.songs.two.path, '/Songbooks/B/Private/same.cho');
  for (const id of ['one', 'two']) {
    assert.equal(after.songs[id].fileId, before.songs[id].fileId);
    assert.equal(after.songs[id].songbookId, 'b');
  }
  assert.equal(songs(f).length, 2);
  assert.deepEqual(
    f.data.personal.map(p => p.capo),
    [2, 7],
  );
});

test('names: an externally moved confirmed Originals copy remains acknowledged after a lost reply', async () => {
  const f = fixture(),
    move = f.files.moveBatch;
  let lost = true,
    owned;
  f.files.moveBatch = async entries => {
    const reply = await move(entries);
    if (lost && entries.some(entry => entry.key.startsWith('original:'))) {
      lost = false;
      owned = reply.entries[0].value.id;
      await f.files.folder('/Archive');
      await f.files.move(owned, '/Archive/en.txt');
      throw new SyncFailure(
        {code: failureCodes.network, stage: 'dropbox.move-batch'},
        'lost original placement receipt',
      );
    }
    return reply;
  };
  await assert.rejects(f.run());
  await retry(f);
  await retry(f);
  assert.equal(f.data.state.pending, false);
  assert.deepEqual(manifest(f).songs.one.originalFile, {fileId: owned, path: '/Archive/en.txt'});
  assert.equal(f.entries.get('/archive/en.txt').text, f.data.songs[0].original);
  assert.equal([...f.entries.values()].filter(e => e.path.includes('/Originals/')).length, 0);
});
