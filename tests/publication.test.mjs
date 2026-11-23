import test from 'node:test';
import assert from 'node:assert/strict';
import {syncEngine} from '../src/sync/engine.ts';
import {BatchStatusUnconfirmed, SyncFailure, failureCodes} from '../src/sync/failure.ts';
import {fixture, song} from './sync-fixture.mjs';

const engine = f => syncEngine(f.storage, f.files, 'account', {valid: () => true, changed() {}});
const change = (id, published = true) => ({id, published});
const physical = (f, id) => [...f.entries.values()].find(file => file.id === id);
const moves = (f, start) =>
  f.calls
    .slice(start)
    .filter(([kind]) => kind === 'moveBatch')
    .map(([, size]) => size);
const setBook = (d, id, name) => d.songbooks.push({id, name});
const withSource = (id, book, original = `{t: ${id}}\n[G]Hei`) => ({
  ...song(id, book, original),
  title: id,
  origin: {kind: 'local', filename: `${id}.cho`, importedAt: '2026-01-01'},
});

test('AK39-02: combined publication and withdrawal use bounded bulk across books without changing bytes, identities or private data', async () => {
  const f = fixture();
  f.change(d => {
    setBook(d, 'band', 'Band');
    for (let i = 0; i < 102; i++) d.songs.push(withSource(`file-${i}`, i % 2 ? 'band' : 'standard'));
    d.songs.push({
      ...withSource('external', 'band'),
      origin: {
        kind: 'external',
        provider: 'dropbox',
        sourceId: 'someone-else',
        filename: 'external.cho',
        importedAt: '2026-01-01',
      },
    });
  });
  await f.run();
  const library = f.data.state.manifest,
    lastManual = f.data.state.lastManual;
  await f.files.move(library.songs.one.fileId, '/Songbooks/Standard/Shared/en.cho');
  const person = f.entries.get('/.app/songs/one.json').text;
  const view = await engine(f).refreshPublication();
  assert.equal(view.songs.length, 103);
  assert.deepEqual(
    view.songs.filter(s => s.published).map(s => s.id),
    ['one'],
  );
  const start = f.calls.length;
  const requested = [change('one', false), ...view.songs.filter(s => !s.published).map(s => change(s.id))];
  const result = await engine(f).executePublication(requested);
  assert.equal(result.completed.length, requested.length, result.message);
  assert.deepEqual(moves(f, start), [100, 3]);
  assert.equal(f.calls.slice(start).filter(([kind]) => kind === 'metadata').length, 0);
  assert.equal(f.data.state.lastManual, lastManual);
  for (const {id, published} of requested) {
    const before = library.songs[id],
      after = f.data.state.manifest.songs[id];
    assert.equal(after.fileId, before.fileId);
    assert.equal(after.songbookId, before.songbookId);
    assert.match(physical(f, before.fileId).path, published ? /\/Shared\// : /\/Private\//);
    assert.equal(physical(f, before.fileId).text, f.data.songs.find(s => s.id === id).original);
  }
  assert.equal(f.entries.get('/.app/songs/one.json').text, person);
});

test('AK39-03: opening refreshes changed titles without acknowledging content and already fulfilled requests never move a file', async () => {
  const f = fixture();
  await f.run();
  const known = f.data.state.manifest.songs.one;
  const lastManual = f.data.state.lastManual;
  await f.files.move(known.fileId, '/Songbooks/Standard/Shared/en.cho');
  const actual = physical(f, known.fileId);
  await f.files.write(actual.path, '{t: Endret på en annen enhet}\nOriginal', actual.rev);
  const first = f.calls.length;
  const view = await engine(f).refreshPublication();
  assert.equal(view.songs[0].published, true);
  assert.equal(view.songs[0].title, 'Endret på en annen enhet');
  assert.equal(f.data.state.lastManual, lastManual);
  assert.equal(f.data.songs[0].title, 'En sang');
  const checked = await engine(f).executePublication([change('one')]);
  assert.deepEqual(checked.completed, ['one']);
  assert.deepEqual(checked.moved, []);
  assert.deepEqual(moves(f, first), []);
  await f.run();
  assert.equal(f.data.songs[0].title, 'Endret på en annen enhet');
  assert.equal(f.data.personal[0].capo, 2);
});

test('AK39-03: an initial upload uses Private, true name collisions number safely, conflicting content keeps its selection', async () => {
  const f = fixture();
  await f.run();
  const prior = f.data.state.manifest.songs.one;
  const priorVersion = physical(f, prior.fileId);
  await f.files.write(priorVersion.path, '{t: Fjern endring}\n[G]Sky', priorVersion.rev);
  const occupied = await f.files.write('/Songbooks/Standard/Shared/fresh.cho', '{t: Annen sang}', null);
  f.change(d => {
    d.songs[0].original = '{t: Lokal endring}\n[D]Lokal';
    d.songs.push(withSource('fresh', 'standard'));
  });
  const start = f.calls.length;
  const result = await engine(f).executePublication([change('one'), change('fresh')]);
  assert.deepEqual(result.completed, ['fresh'], result.message);
  assert.match(result.message, /avklar sangversjonen/);
  assert.equal(physical(f, prior.fileId).text, '{t: Fjern endring}\n[G]Sky');
  assert.match(physical(f, prior.fileId).path, /\/Private\//);
  assert.equal(physical(f, occupied.id).path, '/Songbooks/Standard/Shared/fresh.cho');
  const created = f.data.state.manifest.songs.fresh;
  assert.equal(physical(f, created.fileId).path, '/Songbooks/Standard/Shared/fresh (2).cho');
  assert.ok(
    f.calls.slice(start).some(([kind, , path]) => kind === 'move' && path === '/Songbooks/Standard/Private/fresh.cho'),
  );
});

test('AK39-03: partial batches and async status preserve only unconfirmed work, which requires a fresh request', async () => {
  const f = fixture();
  f.change(d => d.songs.push(withSource('two', 'standard')));
  await f.run();
  const batch = f.files.moveBatch;
  let pending,
    sent = 0;
  f.files.moveBatch = async entries => {
    sent++;
    if (sent > 1) return batch(entries);
    pending = entries;
    return {asyncJobId: 'publication-async'};
  };
  let checked = 0;
  f.files.checkMoveBatch = async id => {
    assert.equal(id, 'publication-async');
    checked++;
    const success = await batch([pending[0]]);
    return {
      entries: [...success.entries, {failure: {code: failureCodes.request, stage: 'dropbox.move-batch', status: 200}}],
    };
  };
  const first = await engine(f).executePublication([change('one'), change('two')]);
  assert.deepEqual(first.completed, ['one']);
  assert.equal(first.view.songs.find(s => s.id === 'one').published, true);
  assert.equal(checked, 1);
  await f.run(false);
  assert.equal(sent, 1, 'ordinary upload must never re-submit a publication selection');
  const second = await engine(f).executePublication([change('two')]);
  assert.deepEqual(second.completed, ['two'], second.message);
  assert.equal(sent, 2);
});

test('AK39-03: a lost batch reply retains the shared fence and per-file proof until the same job can be observed', async () => {
  const f = fixture();
  f.change(d => d.songs.push(withSource('two', 'standard')));
  await f.run();
  const batch = f.files.moveBatch;
  let pending,
    sent = 0;
  f.files.moveBatch = async entries => {
    sent++;
    pending = entries;
    await batch([entries[0]]);
    throw new SyncFailure({code: failureCodes.network, stage: 'dropbox.move-batch'}, 'lost response');
  };
  const first = await engine(f).executePublication([change('one'), change('two')]);
  assert.equal(first.unavailable, false);
  assert.deepEqual(first.completed, ['one']);
  assert.deepEqual(first.moved, ['one']);
  assert.match(f.data.state.manifest.songs.one.path, /\/Shared\//);
  assert.ok(f.data.state.namespaceJob.submitted);
  assert.ok(JSON.parse(f.entries.get('/.app/mutation.json').text).owner);
  const view = await engine(f).refreshPublication();
  assert.deepEqual(
    view.songs.filter(s => s.published).map(s => s.id),
    ['one'],
  );
  const waiting = await engine(f).executePublication([change('one'), change('two')]);
  assert.deepEqual(waiting.completed, ['one']);
  assert.equal(sent, 1);
  assert.ok(f.data.state.namespaceJob);
  await batch([pending[1]]);
  const last = await engine(f).executePublication([change('two')]);
  assert.deepEqual(last.completed, ['two']);
  assert.equal(sent, 1);
  assert.equal(f.data.state.namespaceJob, undefined);
  assert.equal(JSON.parse(f.entries.get('/.app/mutation.json').text).owner, null);
});

test('AK39-03: a batch internal error acknowledges only the move verified at its exact destination', async () => {
  const f = fixture();
  f.change(d => d.songs.push(withSource('two', 'standard')));
  await f.run();
  const expected = f.data.state.manifest.songs,
    move = f.files.moveBatch;
  const error = {failure: {code: failureCodes.request, stage: 'dropbox.move-batch', status: 200}, verifyEffect: true};
  f.files.moveBatch = async entries => {
    await move(entries.filter(entry => entry.fileId === expected.one.fileId));
    await f.files.move(expected.two.fileId, '/Songbooks/Standard/Shared/Other.cho');
    return {entries: entries.map(() => error)};
  };
  const start = f.calls.length;
  const result = await engine(f).executePublication([change('one'), change('two')]);
  assert.deepEqual(result.moved, ['one']);
  assert.equal(f.data.state.manifest.songs.one.path, '/Songbooks/Standard/Shared/en.cho');
  assert.equal(f.data.state.manifest.songs.two.path, expected.two.path);
  assert.equal(f.calls.slice(start).filter(([kind]) => kind === 'metadata').length, 0);
  assert.deepEqual(moves(f, start), [1]);
  assert.equal(JSON.parse(f.entries.get('/.app/mutation.json').text).owner, null);
});

test('AK39-03: a partial status error retains the job ID until all moved files are verified', async () => {
  const f = fixture();
  f.change(d => d.songs.push(withSource('two', 'standard')));
  await f.run();
  const move = f.files.moveBatch;
  let planned,
    launches = 0,
    checks = 0;
  f.files.moveBatch = async entries => {
    launches++;
    planned = entries;
    await move([entries[0]]);
    return {asyncJobId: 'accepted-job'};
  };
  f.files.checkMoveBatch = async id => {
    assert.equal(id, 'accepted-job');
    checks++;
    throw new BatchStatusUnconfirmed(
      {code: failureCodes.changed, stage: 'dropbox.move-batch', status: 409},
      'status unavailable',
    );
  };
  const lock = () => JSON.parse(f.entries.get('/.app/mutation.json').text).owner;
  const start = f.calls.length;
  const first = await engine(f).executePublication([change('one'), change('two')]);
  assert.deepEqual(first.moved, ['one']);
  assert.equal(f.data.state.namespaceJob.jobId, 'accepted-job');
  assert.ok(lock());
  const stillPending = await engine(f).executePublication([change('two')]);
  assert.deepEqual(stillPending.moved, []);
  assert.equal(f.data.state.namespaceJob.jobId, 'accepted-job');
  assert.ok(lock());
  await move([planned[1]]);
  const recovered = await engine(f).executePublication([change('two')]);
  assert.deepEqual(recovered.moved, ['two']);
  assert.equal(f.data.state.namespaceJob, undefined);
  assert.equal(lock(), null);
  assert.equal(launches, 1);
  assert.equal(checks, 3);
  assert.equal(f.calls.slice(start).filter(([kind]) => kind === 'metadata').length, 0);
});

test('AK39-03: a file now in Originals is shown as unpublished and cannot be moved by Utfør', async () => {
  const f = fixture();
  await f.run();
  const known = f.data.state.manifest.songs.one;
  await engine(f).executePublication([change('one')]);
  const originalPath = '/Songbooks/Standard/Originals/en.cho';
  await f.files.move(known.fileId, originalPath);
  const view = await engine(f).refreshPublication();
  assert.equal(view.songs.find(song => song.id === 'one').published, false);
  const start = f.calls.length;
  const result = await engine(f).executePublication([change('one')]);
  assert.deepEqual(result.completed, []);
  assert.deepEqual(moves(f, start), []);
  assert.equal(physical(f, known.fileId).path, originalPath);
});

test('AK39-04: publication refresh sees a relisted song in its new book and leaves local membership for ordinary sync', async () => {
  const f = fixture();
  f.change(d => setBook(d, 'target', 'Target'));
  await f.run();
  await engine(f).executePublication([change('one')]);
  const older = structuredClone(f.data),
    inactive = fixture();
  delete older.state.mutationOwner;
  delete older.state.mutationPending;
  inactive.data = older;
  const secondary = () => syncEngine(inactive.storage, f.files, 'account', {valid: () => true, changed() {}});
  f.change(d => {
    d.songbooks = d.songbooks.filter(book => book.id !== 'standard');
    d.songs[0].songbookId = 'target';
    d.journal.deletedBooks.standard = {id: 'standard', name: 'Standard', deleted: true};
  });
  const waiting = await engine(f).refreshPublication();
  assert.equal(waiting.songs.find(song => song.id === 'one').songbookId, 'target');
  assert.equal(waiting.songs.find(song => song.id === 'one').published, false);
  assert.deepEqual((await engine(f).executePublication([change('one')])).completed, []);
  await f.run();
  assert.deepEqual((await engine(f).executePublication([change('one')])).moved, ['one']);
  const view = await secondary().refreshPublication();
  assert.equal(view.songs.find(song => song.id === 'one').songbookId, 'target');
  assert.equal(view.songs.find(song => song.id === 'one').published, true);
  assert.equal(inactive.data.songs[0].songbookId, 'standard');
  await secondary().run(true);
  assert.equal(inactive.data.songs[0].songbookId, 'target');
  assert.deepEqual(
    inactive.data.songbooks.map(book => book.id),
    ['target'],
  );
  const start = f.calls.length;
  await secondary().run(true);
  assert.deepEqual(f.calls.slice(start), [['changes']]);
});

test('AK39-04: published content remains editable and an inactive device downloads the same song and its private sidecar', async () => {
  const f = fixture();
  await f.run();
  const olderDevice = structuredClone(f.data);
  const id = f.data.state.manifest.songs.one.fileId;
  await engine(f).executePublication([change('one')]);
  f.change(d => {
    d.songs[0].original = '{t: Oppdatert}\nNy tekst';
    d.personal[0].capo = 7;
  });
  await f.run(false);
  assert.equal(physical(f, id).text, '{t: Oppdatert}\nNy tekst');
  assert.match(physical(f, id).path, /\/Shared\//);
  f.data = olderDevice;
  await f.run();
  assert.equal(f.data.songs[0].id, 'one');
  assert.equal(f.data.songs[0].original, '{t: Oppdatert}\nNy tekst');
  assert.equal(f.data.personal[0].capo, 7);
  assert.equal(f.data.state.manifest.songs.one.fileId, id);
});

test('AK39-04: manual sync applies a Dropbox book name case change after publication refreshed its cursor', async () => {
  const f = fixture();
  await f.run();
  const bookId = f.data.state.manifest.books.standard.folderId;
  await f.files.move(bookId, '/Songbooks/Midlertidig');
  await f.files.move(bookId, '/Songbooks/STANDARD');
  await engine(f).refreshPublication();
  assert.equal(f.data.songbooks[0].name, 'Standard');
  await f.run();
  assert.equal(f.data.songbooks[0].name, 'STANDARD');
  assert.equal(f.data.state.manifest.books.standard.path, '/Songbooks/STANDARD');
  assert.match(f.data.state.manifest.songs.one.path, /^\/Songbooks\/STANDARD\/Private\//);
  const start = f.calls.length;
  await f.run();
  assert.deepEqual(f.calls.slice(start), [['changes']]);
});

test('AK39-05: link lookup and creation hold the same account fence as book archival', async () => {
  const f = fixture();
  f.change(d => {
    d.songs[0].songbookId = 'target';
    setBook(d, 'target', 'Target');
  });
  await f.run();
  const older = structuredClone(f.data),
    deleting = fixture();
  delete older.state.mutationOwner;
  delete older.state.mutationPending;
  deleting.data = older;
  deleting.change(d => {
    d.songbooks = d.songbooks.filter(book => book.id !== 'standard');
    d.journal.deletedBooks.standard = {id: 'standard', name: 'Standard', deleted: true};
  });
  const archive = () => syncEngine(deleting.storage, f.files, 'account', {valid: () => true, changed() {}}).run(true);
  const url = 'https://www.dropbox.com/scl/fo/example/Shared';
  assert.equal(
    await engine(f).withSharedFolder('standard', async (folder, verifyTarget) => {
      assert.equal(folder.path, '/Songbooks/Standard/Shared');
      assert.ok(JSON.parse(f.entries.get('/.app/mutation.json').text).owner);
      await assert.rejects(archive(), error => error.reason === 'remote');
      await verifyTarget();
      return url;
    }),
    url,
  );
  assert.equal(JSON.parse(f.entries.get('/.app/mutation.json').text).owner, null);
  await archive();
  await assert.rejects(
    engine(f).withSharedFolder('standard', async () => assert.fail('archived folder must never be shared')),
    error => error.info.code === failureCodes.missingFolder,
  );
  assert.equal(JSON.parse(f.entries.get('/.app/mutation.json').text).owner, null);
});

test('AK39-05: check the actual Shared path before handing a URL back to the caller', async () => {
  const f = fixture();
  await f.run();
  await assert.rejects(
    engine(f).withSharedFolder('standard', async folder => {
      await f.files.move(folder.id, '/Deleted/Standard/Shared');
      return 'https://www.dropbox.com/scl/fo/example/Shared';
    }),
    error => error.info.stage === 'publication.shared-folder' && error.info.code === failureCodes.changed,
  );
  assert.equal(JSON.parse(f.entries.get('/.app/mutation.json').text).owner, null);
});
