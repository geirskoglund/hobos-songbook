import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './sync-fixture.mjs';
import {syncEngine} from '../src/sync/engine.ts';
import {DeferredSync} from '../src/core/failure.ts';

// #116: the lock taken with one write and a library read only when it changed.
const lockPath = '/.app/mutation.json',
  libraryPath = '/.app/library.json';
const owner = f => JSON.parse(f.entries.get(lockPath).text).owner;
const since = (f, start) => f.calls.slice(start).filter(call => call[0] !== 'metadata');
async function ready() {
  const f = fixture();
  await f.run();
  await f.run();
  return f;
}
/** A second device on the same Dropbox, starting from a copy of this device's state. */
function peer(f) {
  const other = fixture();
  other.data = f.data;
  delete other.data.state.mutationOwner;
  delete other.data.state.mutationPending;
  delete other.data.state.mutationRelease;
  return {
    data: () => other.data,
    run: () => syncEngine(other.storage, f.files, 'account', {valid: () => true, changed() {}}).run(true),
  };
}

test('#116: a change in Dropbox after our own release takes the lock with one write and lists once', async () => {
  const f = await ready();
  await f.files.write('/Songbooks/Standard/Private/Ny.cho', '{t: Ny}\n[C]Hei', null);
  const start = f.calls.length;
  await f.run();
  const ny = f.data.songs.find(song => song.title === 'Ny');
  // No read of the lock or the library, and no second listing after the lock.
  assert.deepEqual(since(f, start), [
    ['changes'],
    ['write', lockPath],
    ['read', f.data.state.manifest.songs[ny.id].fileId],
    ['write', '/.app/songs/' + ny.id + '.json'],
    ['write', libraryPath],
    ['write', '/.app/upload-index.json'],
    ['write', lockPath],
  ]);
  assert.equal(owner(f), null);
  assert.ok(f.data.songs.some(song => song.title === 'Ny'));
});

test('#116: a lock taken by another device between the listing and our write is refused as before', async () => {
  const f = await ready();
  await f.files.write('/Songbooks/Standard/Private/Ny.cho', '{t: Ny}\n[C]Hei', null);
  const changes = f.files.changes,
    other = '00000000-0000-4000-8000-000000000000';
  f.files.changes = async cursor => {
    const reply = await changes(cursor);
    const lock = f.entries.get(lockPath);
    await f.files.write(lockPath, JSON.stringify({version: 1, owner: other, libraryRev: null}), lock.rev);
    f.files.changes = changes;
    return reply;
  };
  const start = f.calls.length;
  await assert.rejects(f.run(), DeferredSync);
  assert.equal(owner(f), other);
  assert.ok(!since(f, start).some(([kind, path]) => kind === 'write' && path !== lockPath));
  assert.ok(since(f, start).some(([kind, path]) => kind === 'read' && path === lockPath));
});

test('#116: a library changed by another device is always read again and lists after the lock', async () => {
  const f = await ready();
  const second = peer(f);
  await f.files.write('/Songbooks/Standard/Private/Annen.cho', '{t: Annen}\n[C]Hei', null);
  await second.run();
  assert.ok(second.data().songs.some(song => song.title === 'Annen'));
  const start = f.calls.length;
  await f.run();
  const calls = since(f, start);
  // The listing shows the other device's lock: it is read as before, and no refused write is tried.
  assert.deepEqual(calls.slice(0, 4), [['changes'], ['read', lockPath], ['write', lockPath], ['changes']]);
  assert.ok(calls.some(([kind, path]) => kind === 'read' && path === libraryPath));
  assert.ok(f.data.songs.some(song => song.title === 'Annen'));
});

test('#116: an unchanged Dropbox still costs one listing', async () => {
  const f = await ready();
  const start = f.calls.length;
  await f.run();
  assert.deepEqual(since(f, start), [['changes']]);
});
