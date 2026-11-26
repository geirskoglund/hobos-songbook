import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedFiles} from '../src/sync/remote.ts';
import {newSyncState} from '../src/core/sync-model.ts';

test('Dropbox recursive FileMetadata may arrive without its parents; required book identity is fetched once', async () => {
  const state = newSyncState('account'),
    lookups = [];
  const raw = {
    async changes() {
      return {
        entries: [{id: 'id:file', path: '/Songbooks/New/Private/song.cho', rev: 'rev1', folder: false}],
        cursor: 'cursor1',
        reset: true,
      };
    },
    async locateFolder(path) {
      lookups.push(path);
      return {id: 'id:book', path};
    },
  };
  const index = indexedFiles(raw, state);
  await index.refresh();
  assert.deepEqual(await index.files.list('/Songbooks'), [{id: 'id:book', path: '/Songbooks/New', folder: true}]);
  assert.deepEqual(lookups, ['/Songbooks/New']);
  await index.files.list('/Songbooks');
  assert.equal(lookups.length, 1);
});
test('Dropbox FileMetadata replacing a folder removes its descendants from the metadata cache', async () => {
  const state = newSyncState('account');
  state.remote = {
    cursor: 'old',
    entries: {
      '/songbooks/a': {id: 'id:folder', path: '/Songbooks/A', folder: true},
      '/songbooks/a/child': {id: 'id:child', path: '/Songbooks/A/child', folder: false, rev: 'old'},
    },
  };
  const index = indexedFiles(
    {
      async changes() {
        return {
          entries: [{id: 'id:new-file', path: '/Songbooks/A', rev: 'new', folder: false}],
          cursor: 'new',
          reset: false,
        };
      },
    },
    state,
  );
  await index.refresh();
  assert.equal(index.find('id:child'), undefined);
  assert.equal(index.find('/Songbooks/A').id, 'id:new-file');
});
test('phase snapshots reconcile own create/move/delete receipts, stay detached, and survive reset/failure', async () => {
  const state = newSyncState('account');
  let entries = [{id: 'id:file', path: '/a.cho', folder: false, rev: 'one'}],
    cursor = 0,
    reset = true,
    fail = false;
  const raw = {
    async changes() {
      if (fail) throw Error('incomplete later page');
      return {entries: structuredClone(entries), cursor: String(++cursor), reset};
    },
    async locateFolder() {
      return null;
    },
    async moveBatch() {
      return {entries: [{value: {id: 'id:file', path: '/b.cho', rev: 'one'}}]};
    },
    async deleteBatch() {
      return {entries: [{value: {id: 'id:file', path: '/b.cho'}}]};
    },
    async createFoldersBatch() {
      return {entries: [{value: {id: 'id:folder', path: '/created', folder: true}}]};
    },
  };
  const index = indexedFiles(raw, state),
    first = await index.files.metadataSnapshot();
  reset = false;
  await index.files.moveBatch([{key: 'file', from: 'id:file', to: '/b.cho', fileId: 'id:file'}]);
  entries = [
    {path: '/a.cho', deleted: true},
    {id: 'id:file', path: '/b.cho', folder: false, rev: 'one'},
  ];
  const moved = await index.files.metadataSnapshot();
  assert.equal(index.find('id:file').path, '/b.cho');
  assert.equal(first[0].path, '/a.cho');
  await index.files.createFoldersBatch([{key: 'created', path: '/created'}]);
  entries = [{id: 'id:folder', path: '/created', folder: true}];
  await index.files.metadataSnapshot();
  assert.equal(index.find('id:file').path, '/b.cho');
  assert.equal(index.find('id:folder').path, '/created');
  await index.files.deleteBatch([{key: 'file', path: 'id:file', fileId: 'id:file', rev: 'one', category: 'personal'}]);
  entries = [{path: '/b.cho', deleted: true}];
  await index.files.metadataSnapshot();
  assert.equal(index.find('id:file'), undefined);
  assert.equal(moved.find(e => e.id === 'id:file').path, '/b.cho');
  const before = structuredClone(state.remote);
  fail = true;
  await assert.rejects(index.files.metadataSnapshot());
  assert.deepEqual(state.remote, before);
  fail = false;
  reset = true;
  entries = [{id: 'id:folder', path: '/renamed', folder: true}];
  await index.files.metadataSnapshot();
  assert.equal(state.remote.epoch, 2);
  assert.equal(index.find('/created'), undefined);
  assert.equal(index.find('id:folder').path, '/renamed');
});
