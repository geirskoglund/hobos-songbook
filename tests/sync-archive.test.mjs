import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, song} from './sync-fixture.mjs';
import {syncEngine} from '../src/sync/engine.ts';
import {BatchStatusUnconfirmed, RetrySync, SyncFailure, failureCodes} from '../src/core/failure.ts';

async function run(f, files = f.files, manual = true) {
  for (let i = 0; i < 5; i++)
    try {
      return await syncEngine(f.storage, files, 'account', {valid: () => true, changed() {}}).run(manual);
    } catch (e) {
      if (!(e instanceof RetrySync) || i === 4) throw e;
    }
}
const manifest = f => JSON.parse(f.entries.get('/.app/library.json').text);
async function setup() {
  const f = fixture();
  f.change(d => {
    d.songbooks = [
      {id: 'old', name: 'Archive.A'},
      {id: 'target', name: 'Target'},
    ];
    d.songs = [{...song('one', 'old'), origin: {kind: 'local', filename: 'Song.txt', importedAt: ''}}];
    d.personal = [{songId: 'one', version: 3, chorus: {}, capo: 3}];
  });
  await run(f);
  return f;
}
function remove(f) {
  f.change(d => {
    d.songbooks = d.songbooks.filter(b => b.id !== 'old');
    for (const s of d.songs) if (s.songbookId === 'old') s.songbookId = 'target';
    d.journal.deletedBooks.old = {id: 'old', name: 'Archive.A', deleted: true};
  });
}
function stale(snapshot) {
  const f = fixture();
  delete snapshot.state.mutationOwner;
  delete snapshot.state.mutationPending;
  f.data = snapshot;
  return f;
}

test('archive: a whole historical folder moves once, preserving Originals and unknown remaining files', async () => {
  const f = await setup(),
    before = manifest(f),
    original = f.entries.get('/songbooks/archive.a/originals/song.txt');
  await f.files.folder('/Songbooks/Archive.A/Shared/Unknown');
  const unknown = await f.files.write('/Songbooks/Archive.A/Shared/Unknown/source.bin', 'unknown bytes', null);
  const start = f.calls.length;
  remove(f);
  await run(f);
  const book = manifest(f).books.old;
  assert.equal(book.deleted, true);
  assert.equal(book.folderId, before.books.old.folderId);
  assert.equal(book.path, '/Songbooks/Archive.A');
  assert.match(book.archive.path, /^\/Deleted\/Archive\.A \d{4}-\d{2}-\d{2} \d{4}$/);
  assert.equal(book.archive.done, true);
  assert.equal(f.entries.has('/songbooks/archive.a'), false);
  const archived = [...f.entries.values()].find(e => e.id === original.id),
    other = [...f.entries.values()].find(e => e.id === unknown.id);
  assert.equal(archived.path, book.archive.path + '/Originals/Song.txt');
  assert.equal(archived.text, original.text);
  assert.equal(other.path, book.archive.path + '/Shared/Unknown/source.bin');
  assert.equal(other.text, 'unknown bytes');
  assert.equal(manifest(f).songs.one.fileId, before.songs.one.fileId);
  assert.equal(manifest(f).songs.one.songbookId, 'target');
  assert.equal(f.data.personal[0].capo, 3);
  assert.equal(f.data.state.pending, false);
  assert.equal(f.calls.slice(start).filter(c => c[0] === 'metadata').length, 0);
  assert.equal(
    f.calls.slice(start).some(c => c[0] === 'deleteBatch'),
    false,
  );
});
test('multi-device: stale membership cannot delete a published moved song or newer personal data; unpublished offline imports still obey F57', async () => {
  const a = await setup(),
    old = structuredClone(a.data);
  remove(a);
  await run(a);
  a.change(d => (d.personal[0].capo = 9));
  await run(a);
  const b = stale(old);
  b.change(d => {
    d.songs.push(song('unpublished', 'old'));
    d.personal.push({songId: 'unpublished', version: 3, chorus: {}});
  });
  await run(b, a.files);
  assert.deepEqual(
    b.data.songs.map(s => [s.id, s.songbookId]),
    [['one', 'target']],
  );
  assert.equal(b.data.personal[0].capo, 9);
  assert.equal(manifest(a).songs.one.songbookId, 'target');
  assert.equal(manifest(a).deletedSongs?.one, undefined);
  assert.ok(manifest(a).deletedSongs.unpublished);
  assert.equal(b.data.state.conflicts.length, 0);
  assert.equal(b.data.state.pending, false);
});
test('archive: recreation uses a new identity; an inactive device sees the new book without a name conflict', async () => {
  const a = await setup(),
    old = structuredClone(a.data),
    folder = manifest(a).books.old.folderId;
  remove(a);
  await run(a);
  a.change(d => {
    d.songbooks.push({id: 'replacement', name: 'Archive.A'});
    d.songs.push({
      ...song('two', 'replacement', '{t: New book}\nNew text'),
      origin: {kind: 'local', filename: 'New.cho', importedAt: ''},
    });
    d.personal.push({songId: 'two', version: 3, chorus: {}, capo: 4});
  });
  await run(a);
  assert.notEqual(manifest(a).books.replacement.folderId, folder);
  assert.equal(manifest(a).books.replacement.path, '/Songbooks/Archive.A');
  const b = stale(old);
  await run(b, a.files);
  assert.deepEqual(b.data.songbooks.map(b => b.id).sort(), ['replacement', 'target']);
  assert.equal(b.data.songbooks.find(b => b.id === 'replacement').name, 'Archive.A');
  assert.deepEqual(b.data.songs.map(s => [s.id, s.songbookId]).sort(), [
    ['one', 'target'],
    ['two', 'replacement'],
  ]);
  assert.equal(b.data.state.conflicts.length, 0);
  assert.equal(manifest(a).deletedSongs?.one, undefined);
  assert.equal(b.data.state.pending, false);
});
test('archive: delete, transfer and recreate the same name offline completes within one manual synchronization', async () => {
  const f = await setup(),
    old = manifest(f).books.old.folderId;
  remove(f);
  f.change(d => {
    d.songbooks.push({id: 'replacement', name: 'Archive.A'});
    d.songs.push({...song('two', 'replacement'), origin: {kind: 'local', filename: 'New.cho', importedAt: ''}});
    d.personal.push({songId: 'two', version: 3, chorus: {}});
  });
  await run(f);
  assert.equal(manifest(f).books.old.archive.done, true);
  assert.notEqual(manifest(f).books.replacement.folderId, old);
  assert.equal(manifest(f).songs.one.songbookId, 'target');
  assert.equal(manifest(f).songs.two.songbookId, 'replacement');
  assert.equal(f.data.state.pending, false);
});
test('archive: a lost reply recovers the same target without a second ID move', async () => {
  const f = await setup(),
    move = f.files.moveBatch;
  let lost = false,
    launches = 0;
  f.files.moveBatch = async entries => {
    const reply = await move(entries);
    if (entries.some(e => e.to.startsWith('/Deleted/'))) {
      launches++;
      if (!lost) {
        lost = true;
        throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.request'}, 'lost archive reply');
      }
    }
    return reply;
  };
  remove(f);
  await assert.rejects(run(f));
  const intent = structuredClone(manifest(f).books.old.archive);
  await run(f);
  assert.equal(launches, 1);
  assert.equal(manifest(f).books.old.archive.path, intent.path);
  assert.equal(manifest(f).books.old.archive.at, intent.at);
  assert.equal(manifest(f).books.old.archive.done, true);
  assert.equal(f.data.state.pending, false);
});
test('archive: two generations deleted in the same minute get readable numbering without changing the first archive', async t => {
  t.mock.timers.enable({apis: ['Date'], now: new Date(2026, 11, 20, 16, 30).getTime()});
  const f = await setup();
  remove(f);
  await run(f);
  const first = structuredClone(manifest(f).books.old.archive);
  assert.equal(first.path, '/Deleted/Archive.A 2026-12-20 1630');
  f.change(d => d.songbooks.push({id: 'second', name: 'Archive.A'}));
  await run(f);
  f.change(d => {
    d.songbooks = d.songbooks.filter(b => b.id !== 'second');
    d.journal.deletedBooks.second = {id: 'second', name: 'Archive.A', deleted: true};
  });
  await run(f);
  assert.equal(manifest(f).books.second.archive.path, first.path + ' (2)');
  assert.equal(manifest(f).books.old.archive.path, first.path);
  assert.equal([...f.entries.values()].filter(e => e.folder && /^\/Deleted\/[^/]+$/.test(e.path)).length, 2);
});
test('archive: many retired books share bounded folder moves, never per-file transfers or metadata lookups', async () => {
  const f = fixture();
  f.change(d => {
    d.songbooks = [
      {id: 'target', name: 'Target'},
      ...Array.from({length: 40}, (_, i) => ({id: 'b' + i, name: 'Book ' + i})),
    ];
    d.songs = [];
    d.personal = [];
  });
  await run(f);
  const start = f.calls.length;
  f.change(d => {
    for (const b of d.songbooks.filter(b => b.id !== 'target')) d.journal.deletedBooks[b.id] = {...b, deleted: true};
    d.songbooks = d.songbooks.filter(b => b.id === 'target');
  });
  await run(f);
  const calls = f.calls.slice(start);
  assert.deepEqual(
    calls.filter(c => c[0] === 'moveBatch').map(c => c[1]),
    [40],
  );
  assert.equal(calls.filter(c => c[0] === 'metadata').length, 0);
  assert.equal(Object.values(manifest(f).books).filter(b => b.archive?.done).length, 40);
});
test('archive: an async receipt survives a newer generation and resumes the same server job', async () => {
  const f = await setup(),
    move = f.files.moveBatch;
  let plan,
    launches = 0;
  f.files.moveBatch = async entries => {
    if (entries.some(e => e.archive)) {
      launches++;
      plan = structuredClone(entries);
      f.change(d => (d.personal[0].capo = 7));
      return {asyncJobId: 'archive-job'};
    }
    return move(entries);
  };
  remove(f);
  await assert.rejects(run(f));
  const at = manifest(f).books.old.archive.at;
  assert.equal(f.data.state.namespaceJob.jobId, 'archive-job');
  assert.equal(manifest(f).books.old.archive.done, undefined);
  f.files.checkMoveBatch = async id => {
    assert.equal(id, 'archive-job');
    return move(plan);
  };
  await run(f);
  assert.equal(launches, 1);
  assert.equal(manifest(f).books.old.archive.at, at);
  assert.equal(manifest(f).books.old.archive.done, true);
  assert.equal(f.data.personal[0].capo, 7);
  assert.equal(JSON.parse(f.entries.get('/.app/songs/one.json').text).data.capo, 7);
  assert.equal(f.data.state.pending, false);
});
test('archive: an unknown launch cannot replay or be overtaken before a late server effect', async () => {
  const a = await setup(),
    old = structuredClone(a.data),
    move = a.files.moveBatch;
  let plan,
    launches = 0;
  a.files.moveBatch = async entries => {
    if (entries.some(e => e.archive)) {
      launches++;
      plan = structuredClone(entries);
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.request'}, 'unknown launch');
    }
    return move(entries);
  };
  remove(a);
  await assert.rejects(run(a));
  const b = stale(old);
  assert.equal(a.data.state.namespaceJob.submitted, true);
  await assert.rejects(run(a), e => e.info?.action === 'check-move');
  await assert.rejects(run(b, a.files), e => e.reason === 'remote');
  assert.equal(launches, 1);
  await move(plan);
  await run(a);
  await run(b, a.files);
  assert.equal(launches, 1);
  assert.equal(manifest(a).books.old.archive.done, true);
  assert.equal(b.data.state.pending, false);
});
test('archive: a late collision changes only its failed target and never repeats completed archives', async () => {
  const f = await setup();
  f.change(d => d.songbooks.push({id: 'other', name: 'Other'}));
  await run(f);
  const move = f.files.moveBatch,
    groups = [];
  let first = true;
  f.files.moveBatch = async entries => {
    if (!entries.some(e => e.archive)) return move(entries);
    groups.push(entries.length);
    if (first) {
      first = false;
      await f.files.folder(entries[1].to);
      const result = await move(entries.slice(0, 1));
      return {
        entries: [
          ...result.entries,
          {failure: {code: 'SYNC-006', stage: 'dropbox.move-batch', status: 200}, collision: true},
        ],
      };
    }
    return move(entries);
  };
  remove(f);
  f.change(d => {
    d.songbooks = d.songbooks.filter(b => b.id !== 'other');
    d.journal.deletedBooks.other = {id: 'other', name: 'Other', deleted: true};
  });
  await run(f);
  assert.deepEqual(groups, [2, 1]);
  assert.match(manifest(f).books.other.archive.path, / \(2\)$/);
  assert.equal(manifest(f).books.old.archive.done, true);
  assert.equal(manifest(f).books.other.archive.done, true);
  assert.equal(f.data.state.pending, false);
});
test('archive: moving its parent during an accepted job cannot adopt a replacement parent or replay', async () => {
  const f = await setup(),
    move = f.files.moveBatch;
  let shifted = false,
    launches = 0;
  f.files.moveBatch = async entries => {
    if (entries.some(e => e.archive)) {
      launches++;
      if (!shifted) {
        shifted = true;
        await f.files.move('/Deleted', '/Moved archive');
      }
    }
    return move(entries);
  };
  remove(f);
  await assert.rejects(run(f));
  await assert.rejects(run(f), e => e.info?.action === 'check-folders');
  assert.equal(launches, 1);
  assert.equal(f.entries.has('/deleted'), false);
  assert.equal(manifest(f).books.old.archive.done, undefined);
  await f.files.move('/Moved archive', '/Deleted');
  await run(f);
  assert.equal(launches, 1);
  assert.equal(manifest(f).books.old.archive.done, true);
});
test('archive: an older complete index with unchanged historical leftovers still starts archiving', async () => {
  const f = await setup();
  remove(f);
  await run(f);
  const m = manifest(f),
    book = m.books.old;
  await f.files.move(book.folderId, '/Songbooks/Archive.A');
  delete book.archive;
  const file = await f.files.write('/.app/library.json', JSON.stringify(m), f.entries.get('/.app/library.json').rev),
    update = await f.files.changes();
  f.data.state.manifest = structuredClone(m);
  f.data.state.library = {id: file.id, rev: file.rev, value: structuredClone(m)};
  f.data.state.remote = {
    cursor: update.cursor,
    entries: Object.fromEntries(update.entries.map(e => [e.path.toLowerCase(), e])),
  };
  f.data.state.pending = false;
  delete f.data.state.archivePending;
  await run(f);
  assert.equal(manifest(f).books.old.archive.done, true);
  assert.equal(f.entries.has('/songbooks/archive.a'), false);
});
test('offline dependency: a replacement book can receive songs from a second deleted book before its name is free', async () => {
  const f = await setup();
  remove(f);
  f.change(d => {
    d.songbooks = [{id: 'replacement', name: 'Archive.A'}];
    d.songs[0].songbookId = 'replacement';
    d.journal.deletedBooks.target = {id: 'target', name: 'Target', deleted: true};
  });
  await run(f);
  assert.equal(f.data.state.pending, false);
  assert.equal(manifest(f).songs.one.songbookId, 'replacement');
  assert.equal(manifest(f).books.replacement.path, '/Songbooks/Archive.A');
  assert.equal(manifest(f).books.old.archive.done, true);
  assert.equal(manifest(f).books.target.archive.done, true);
  assert.equal(f.data.personal[0].capo, 3);
});
test('offline dependency: an existing target may take the deleted source book name before network return', async () => {
  const f = await setup();
  remove(f);
  f.change(d => (d.songbooks[0].name = 'Archive.A'));
  await run(f);
  assert.equal(f.data.state.pending, false);
  assert.equal(manifest(f).songs.one.songbookId, 'target');
  assert.equal(manifest(f).books.target.name, 'Archive.A');
  assert.equal(manifest(f).books.target.path, '/Songbooks/Archive.A');
  assert.equal(manifest(f).books.old.archive.done, true);
});
test('first-join recovery never binds a newly created replacement to the explicitly retired old identity', async () => {
  const f = fixture();
  f.change(d => {
    d.songbooks = [
      {id: 'old', name: 'Archive.A'},
      {id: 'target', name: 'Target'},
    ];
    d.songs = [song('one', 'old')];
    d.personal = [{songId: 'one', version: 3, chorus: {}, capo: 3}];
  });
  f.fail('/.app/library.json');
  await assert.rejects(run(f));
  assert.equal(f.data.state.joined, undefined);
  remove(f);
  f.change(d => {
    d.songbooks.push({id: 'replacement', name: 'Archive.A'});
    d.songs.push(song('two', 'replacement'));
    d.personal.push({songId: 'two', version: 3, chorus: {}});
  });
  await run(f);
  assert.equal(f.data.state.bindings?.books.replacement, undefined);
  assert.equal(manifest(f).songs.one.songbookId, 'target');
  assert.equal(manifest(f).songs.two.songbookId, 'replacement');
  assert.notEqual(manifest(f).books.old.folderId, manifest(f).books.replacement.folderId);
  assert.equal(f.data.state.pending, false);
});
test('temporary folder conflict cannot adopt or move a foreign folder as the replacement identity', async () => {
  const f = await setup(),
    create = f.files.createFoldersBatch;
  let foreign,
    collision = false;
  f.files.createFoldersBatch = async entries => {
    if (!collision && entries.some(e => e.temporary)) {
      collision = true;
      const results = [];
      for (const entry of entries)
        if (entry.temporary) {
          foreign = await f.files.folder(entry.path);
          await f.files.folder(entry.path + '/Private');
          await f.files.write(entry.path + '/Private/foreign.cho', '{t: Foreign content}', null);
          results.push({failure: {code: 'SYNC-006', stage: 'dropbox.folders-batch', status: 200}, collision: true});
        } else results.push((await create([entry])).entries[0]);
      return {entries: results};
    }
    return create(entries);
  };
  remove(f);
  f.change(d => d.songbooks.push({id: 'replacement', name: 'Archive.A'}));
  await run(f);
  assert.notEqual(manifest(f).books.replacement.folderId, foreign.id);
  assert.ok([...f.entries.values()].some(e => e.id === foreign.id && e.path === foreign.path));
  assert.ok(Object.values(manifest(f).songs).every(link => link.songbookId !== 'replacement'));
});
test('unknown temporary-folder creation retires its path before retrying; a foreign folder is never adopted', async () => {
  const f = await setup(),
    create = f.files.createFoldersBatch;
  let foreign;
  f.files.createFoldersBatch = async entries => {
    const temporary = entries.find(e => e.temporary);
    if (temporary && !foreign) {
      foreign = await f.files.folder(temporary.path);
      await f.files.folder(temporary.path + '/Private');
      await f.files.write(temporary.path + '/Private/foreign.cho', '{t: Foreign content}', null);
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.request'}, 'unknown create launch');
    }
    return create(entries);
  };
  remove(f);
  f.change(d => d.songbooks.push({id: 'replacement', name: 'Archive.A'}));
  await assert.rejects(run(f));
  await run(f);
  assert.equal(f.data.state.namespaceJob, undefined);
  assert.ok([...f.entries.values()].some(e => e.id === foreign.id && e.path === foreign.path));
  assert.notEqual(manifest(f).books.replacement.folderId, foreign.id);
  assert.ok(Object.values(manifest(f).books).some(b => b.deleted && !b.folderId && b.path === foreign.path));
  assert.ok(Object.values(manifest(f).songs).every(s => s.origin.filename !== 'foreign.cho'));
  assert.equal(f.data.state.pending, false);
});
test('a temporary folder at the expected path is insufficient proof after a status error', async () => {
  const f = await setup(),
    create = f.files.createFoldersBatch;
  let foreign,
    launches = 0;
  f.files.createFoldersBatch = async entries => {
    const temporary = entries.find(entry => entry.temporary);
    if (!temporary) return create(entries);
    launches++;
    foreign = await f.files.folder(temporary.path);
    return {asyncJobId: 'pending-temporary'};
  };
  f.files.checkCreateFoldersBatch = async id => {
    assert.equal(id, 'pending-temporary');
    throw new BatchStatusUnconfirmed(
      {code: failureCodes.changed, stage: 'dropbox.folders-batch', status: 409},
      'status unavailable',
    );
  };
  remove(f);
  f.change(d => d.songbooks.push({id: 'replacement', name: 'Archive.A'}));
  await assert.rejects(run(f), error => error.info?.action === 'check-folders');
  await assert.rejects(run(f), error => error.info?.action === 'check-folders');
  assert.equal(launches, 1);
  assert.equal(f.data.state.namespaceJob.jobId, 'pending-temporary');
  assert.ok(JSON.parse(f.entries.get('/.app/mutation.json').text).owner);
  assert.notEqual(manifest(f).books.replacement?.folderId, foreign.id);
  assert.equal(f.entries.get(foreign.path.toLowerCase()).id, foreign.id);
});
test('retired temporary paths survive a late create effect and never become books on an inactive client', async () => {
  const f = await setup(),
    before = structuredClone(f.data),
    create = f.files.createFoldersBatch;
  let plan;
  f.files.createFoldersBatch = async entries => {
    if (!plan && entries.some(e => e.temporary)) {
      plan = structuredClone(entries);
      throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.request'}, 'delayed temporary create');
    }
    return create(entries);
  };
  remove(f);
  f.change(d => d.songbooks.push({id: 'replacement', name: 'Archive.A'}));
  await assert.rejects(run(f));
  const other = stale(before);
  other.change(d => (d.personal[0].capo = 7));
  await assert.rejects(run(other, f.files), e => e.reason === 'remote');
  await run(f);
  const replacement = structuredClone(manifest(f).books.replacement);
  assert.equal(f.entries.has(plan[0].path.toLowerCase()), false);
  await create(plan);
  await f.files.folder(plan[0].path + '/Private');
  await f.files.write(plan[0].path + '/Private/late.cho', '{t: Late unrelated file}', null);
  await run(other, f.files);
  assert.deepEqual(other.data.songbooks.map(b => b.id).sort(), ['replacement', 'target']);
  assert.equal(manifest(f).books.replacement.folderId, replacement.folderId);
  assert.equal(other.data.songs.length, 1);
  assert.equal(other.data.state.pending, false);
  const start = f.calls.length;
  await run(other, f.files);
  assert.deepEqual(f.calls.slice(start), [['changes']]);
});
for (const changed of [false, true])
  test(`temporary path retirement is durable across ${changed ? 'a newer generation' : 'a lost manifest reply'}`, async () => {
    const f = await setup(),
      create = f.files.createFoldersBatch,
      write = f.files.write;
    let plan,
      interrupted = false;
    f.files.createFoldersBatch = async entries => {
      if (!plan && entries.some(e => e.temporary)) {
        plan = structuredClone(entries);
        throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.request'}, 'lost create');
      }
      return create(entries);
    };
    remove(f);
    f.change(d => d.songbooks.push({id: 'replacement', name: 'Archive.A'}));
    await assert.rejects(run(f));
    f.files.write = async (path, text, rev) => {
      const result = await write(path, text, rev);
      if (
        !interrupted &&
        path === '/.app/library.json' &&
        Object.values(JSON.parse(text).books).some(b => b.deleted && !b.folderId && b.path === plan[0].path)
      ) {
        interrupted = true;
        if (changed) f.change(d => (d.personal[0].capo = 9));
        else
          throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.request'}, 'lost path retirement receipt');
      }
      return result;
    };
    await assert.rejects(run(f));
    assert.equal(interrupted, true);
    assert.equal(f.data.state.namespaceJob.submitted, true);
    assert.ok(Object.values(manifest(f).books).some(b => b.deleted && b.path === plan[0].path));
    await run(f);
    await create(plan);
    await run(f);
    assert.equal(Object.values(manifest(f).books).filter(b => b.deleted && b.path === plan[0].path).length, 1);
    assert.equal(manifest(f).books.replacement.path, '/Songbooks/Archive.A');
    assert.equal(f.data.state.pending, false);
    if (changed) assert.equal(f.data.personal[0].capo, 9);
  });
test('archive timestamp and target survive a failed intent publication before any server effect', async t => {
  t.mock.timers.enable({apis: ['Date'], now: new Date(2026, 11, 20, 16, 30).getTime()});
  const f = await setup(),
    write = f.files.write;
  let failed = false,
    first;
  f.files.write = async (path, text, rev) => {
    if (path === '/.app/library.json') {
      const intent = JSON.parse(text).books.old?.archive;
      if (intent && !intent.done && !failed) {
        failed = true;
        first = structuredClone(intent);
        throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.request'}, 'unsent intent publication');
      }
    }
    return write(path, text, rev);
  };
  remove(f);
  await assert.rejects(run(f));
  assert.equal(manifest(f).books.old.archive, undefined);
  assert.equal(f.data.state.archiveIntents.old.at, first.at);
  t.mock.timers.tick(120000);
  await run(f);
  assert.equal(manifest(f).books.old.archive.at, first.at);
  assert.equal(manifest(f).books.old.archive.path, first.path);
  assert.equal(manifest(f).books.old.archive.done, true);
});
test('a postponed content conflict cannot adopt the provisional folder name as the replacement name', async () => {
  const f = await setup(),
    link = manifest(f).songs.one,
    current = f.entries.get(link.path.toLowerCase());
  await f.files.write(current.path, '{t: Server edit}\nRemote words', current.rev);
  f.change(d => (d.songs[0].original += '\nLocal words'));
  remove(f);
  f.change(d => {
    d.songbooks.push({id: 'replacement', name: 'Archive.A'});
    d.songs.push({...song('two', 'replacement'), origin: {kind: 'local', filename: 'New.cho', importedAt: ''}});
    d.personal.push({songId: 'two', version: 3, chorus: {}});
  });
  await run(f);
  assert.equal(f.data.state.conflicts.length, 1);
  assert.equal(f.data.state.archivePending, true);
  assert.equal(f.data.songbooks.find(b => b.id === 'replacement').name, 'Archive.A');
  const conflict = structuredClone(f.data.state.conflicts[0]);
  for (let i = 0; i < 5; i++)
    try {
      await f.run(true, {conflict, choice: 'dropbox'});
      break;
    } catch (e) {
      if (!(e instanceof RetrySync) || i === 4) throw e;
    }
  assert.equal(f.data.state.pending, false);
  assert.equal(f.data.state.conflicts.length, 0);
  assert.equal(manifest(f).books.replacement.name, 'Archive.A');
  assert.equal(manifest(f).books.replacement.path, '/Songbooks/Archive.A');
  assert.equal(manifest(f).books.old.archive.done, true);
  assert.equal(manifest(f).songs.one.songbookId, 'target');
  assert.equal(manifest(f).songs.two.songbookId, 'replacement');
  assert.equal(f.data.songbooks.find(b => b.id === 'replacement').name, 'Archive.A');
});
