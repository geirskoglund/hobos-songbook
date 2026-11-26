import test from 'node:test';
import assert from 'node:assert/strict';
import * as paths from '../src/core/paths.ts';

// Stiene og nøklene er dataformat i Dropbox og IndexedDB. Testen låser verdiene.
test('paths: fixed Dropbox paths keep their stored values', () => {
  assert.equal(paths.appFolder, '/.app');
  assert.equal(paths.libraryPath, '/.app/library.json');
  assert.equal(paths.mutationPath, '/.app/mutation.json');
  assert.equal(paths.uploadIndexPath, '/.app/upload-index.json');
  assert.equal(paths.syncErrorsPath, '/.app/sync-errors.json');
  assert.equal(paths.personalFolder, '/.app/songs');
  assert.equal(paths.stagingFolder, '/.app/uploads');
  assert.equal(paths.songbooksFolder, '/Songbooks');
  assert.equal(paths.deletedFolder, '/Deleted');
  assert.deepEqual(paths.bookAreas, ['Private', 'Shared', 'Import', 'Originals']);
});
test('paths: derived paths keep their stored shape', () => {
  assert.equal(paths.personalPath('song-1'), '/.app/songs/song-1.json');
  assert.equal(paths.stagingPath('op-1'), '/.app/uploads/op-1.cho');
  assert.equal(paths.bookPath('Standard'), '/Songbooks/Standard');
  assert.equal(paths.renameStagingPath('book-1'), '/Songbooks/.rename-book-1');
});
test('paths: a book path is a direct child of Songbooks in any letter case', () => {
  assert.ok(paths.isBookPath('/Songbooks/Standard'));
  assert.ok(paths.isBookPath('/songbooks/Standard'));
  assert.ok(!paths.isBookPath('/Songbooks'));
  assert.ok(!paths.isBookPath('/Songbooks/Standard/Private'));
  assert.ok(!paths.isBookPath('/Other/Standard'));
});
test('paths: local storage keys keep their stored values', () => {
  assert.equal(paths.journalKey, 'private-local-v1');
  assert.equal(paths.syncStateKey('acc'), 'private-account-v1:acc');
});
