import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeEntry,
  displayPath,
  field,
  fileValue,
  moveReply,
  namespaceReply,
  tag,
  tokenReply,
} from '../src/adapters/dropbox-reply.ts';
import {BatchJobFailed, failureCodes, SyncFailure} from '../src/core/failure.ts';

const invalid = (stage, message) => error =>
  error instanceof SyncFailure &&
  error.info.code === failureCodes.response &&
  error.info.stage === stage &&
  (!message || error.message === message);

test('dropbox reply: field and tag read unknown values without throwing', () => {
  assert.equal(field({a: {b: 1}}, 'a', 'b'), 1);
  for (const value of [null, undefined, 'text', 7, true]) {
    assert.equal(field(value, 'a', 'b'), undefined);
    assert.equal(tag(value), undefined);
  }
  assert.equal(tag({'.tag': 'file'}), 'file');
  assert.equal(tag({'.tag': 5}), undefined);
  assert.equal(tag({error: {'.tag': 'path'}}, 'error'), 'path');
});

test('dropbox reply: token reply is read with unknown fields tolerated', () => {
  assert.deepEqual(
    tokenReply({
      access_token: 'a',
      expires_in: 14400,
      refresh_token: 'r',
      account_id: 'dbid:1',
      scope: 'files.content.read  account_info.read',
      token_type: 'bearer',
      uid: 'ignored',
    }),
    {
      accessToken: 'a',
      expiresIn: 14400,
      refreshToken: 'r',
      accountId: 'dbid:1',
      scopes: ['files.content.read', 'account_info.read'],
    },
  );
  assert.deepEqual(tokenReply({access_token: 'a', expires_in: 0}), {
    accessToken: 'a',
    expiresIn: 0,
    refreshToken: undefined,
    accountId: undefined,
    scopes: [],
  });
  for (const value of [
    null,
    {},
    {access_token: 'a'},
    {expires_in: 1},
    {access_token: '', expires_in: 1},
    {access_token: 'a', expires_in: -1},
    {access_token: 'a', expires_in: '1'},
  ])
    assert.throws(() => tokenReply(value), invalid('dropbox.token', 'Ugyldig tokenrespons.'));
});

test('dropbox reply: display path falls back to path_lower and name', () => {
  assert.equal(displayPath({path_display: '/A/B.cho', path_lower: '/a/b.cho'}), '/A/B.cho');
  assert.equal(displayPath({path_lower: '/a/b.cho', name: 'B.cho'}), '/a/B.cho');
  assert.equal(displayPath({path_lower: '/a/b.cho'}), '/a/b.cho');
  assert.equal(displayPath({}, '/fallback'), '/fallback');
  assert.equal(displayPath(null), undefined);
});

test('dropbox reply: file metadata needs id, rev and a path', () => {
  const meta = {'.tag': 'file', id: 'id:1', rev: 'r1', path_display: '/Songs/A.cho', size: 3, content_hash: 'x'};
  assert.deepEqual(fileValue(meta, 'abc', 'id:1'), {text: 'abc', id: 'id:1', rev: 'r1', path: '/Songs/A.cho'});
  // A literal path request identifies the path when path_display is missing.
  assert.equal(fileValue({id: 'id:1', rev: 'r1'}, '', '/Songs/A.cho').path, '/Songs/A.cho');
  for (const value of [null, 'text', {...meta, id: undefined}, {...meta, rev: ''}, {id: 'id:1', rev: 'r1'}])
    assert.throws(() => fileValue(value, '', 'id:1'), invalid('dropbox.file-metadata'));
});

test('dropbox reply: change entries cover files, folders and deletions', () => {
  assert.deepEqual(changeEntry({'.tag': 'file', id: 'id:1', rev: 'r', size: 4, path_display: '/A.cho', extra: 1}), {
    id: 'id:1',
    path: '/A.cho',
    folder: false,
    rev: 'r',
    size: 4,
  });
  assert.deepEqual(changeEntry({'.tag': 'folder', id: 'id:2', path_display: '/Songbooks'}), {
    id: 'id:2',
    path: '/Songbooks',
    folder: true,
  });
  assert.deepEqual(changeEntry({'.tag': 'deleted', path_lower: '/old.cho', name: 'Old.cho'}), {
    path: '/Old.cho',
    deleted: true,
  });
  const message = 'Ugyldig oppføring i endringsoversikten.';
  for (const value of [
    null,
    {'.tag': 'file', id: 'id:1', path_display: '/A.cho'},
    {'.tag': 'file', rev: 'r', path_display: '/A.cho'},
    {'.tag': 'folder', id: 'id:2'},
    {'.tag': 'folder', id: 'id:2', path_display: 'relative'},
    {'.tag': 'symlink', id: 'id:3', path_display: '/link'},
    {id: 'id:3', path_display: '/untagged'},
  ])
    assert.throws(() => changeEntry(value), invalid('dropbox.list', message));
  assert.throws(
    () => changeEntry({'.tag': 'file', id: 'id:1', rev: 'r', size: -1, path_display: '/A.cho'}),
    invalid('dropbox.list', 'Ugyldig filstørrelse.'),
  );
});

test('dropbox reply: move replies accept known variants and reject unknown tags', () => {
  assert.deepEqual(moveReply({'.tag': 'async_job_id', async_job_id: 'job'}, true), {asyncJobId: 'job'});
  assert.deepEqual(moveReply({'.tag': 'in_progress'}, false), {inProgress: true});
  const reply = moveReply(
    {
      '.tag': 'complete',
      entries: [
        {'.tag': 'success', success: {'.tag': 'file', id: 'id:1', rev: 'r', path_display: '/B.cho', size: 1}},
        {'.tag': 'success', success: {'.tag': 'folder', id: 'id:2', path_lower: '/f', name: 'F'}},
        {
          '.tag': 'failure',
          failure: {'.tag': 'relocation_error', relocation_error: {'.tag': 'to', to: {'.tag': 'conflict'}}},
        },
        {'.tag': 'failure', failure: {'.tag': 'a_new_reason'}},
      ],
    },
    true,
  );
  assert.deepEqual(reply.entries[0], {value: {id: 'id:1', path: '/B.cho', rev: 'r'}});
  assert.deepEqual(reply.entries[1], {value: {id: 'id:2', path: '/F', folder: true}});
  assert.equal(reply.entries[2].collision, true);
  assert.equal(reply.entries[2].failure.code, failureCodes.changed);
  // An unknown failure reason is still a failure for that entry.
  assert.deepEqual(reply.entries[3], {failure: {code: failureCodes.request, stage: 'dropbox.move-batch', status: 200}});

  for (const value of [
    null,
    {'.tag': 'other'},
    {'.tag': 'in_progress'},
    {'.tag': 'complete'},
    {'.tag': 'async_job_id'},
  ])
    assert.throws(() => moveReply(value, true), invalid('dropbox.move-batch', 'Ugyldig flytterespons.'));
  assert.throws(
    () => moveReply({'.tag': 'complete', entries: [{'.tag': 'other'}]}, false),
    invalid('dropbox.move-batch', 'Ugyldig flyttefeil.'),
  );
  assert.throws(
    () => moveReply({'.tag': 'complete', entries: [{'.tag': 'success', success: {'.tag': 'file', id: 'id:1'}}]}, false),
    invalid('dropbox.move-batch', 'Ugyldig flyttekvittering.'),
  );
  assert.throws(
    () =>
      moveReply({'.tag': 'complete', entries: [{'.tag': 'success', success: {'.tag': 'other', id: 'id:1'}}]}, false),
    invalid('dropbox.move-batch', 'Ugyldig flyttekvittering.'),
  );
});

test('dropbox reply: namespace replies accept known variants and reject unknown tags', () => {
  assert.deepEqual(namespaceReply({'.tag': 'async_job_id', async_job_id: 'job'}, 'delete'), {asyncJobId: 'job'});
  assert.deepEqual(namespaceReply({'.tag': 'in_progress'}, 'folders'), {inProgress: true});
  assert.deepEqual(
    namespaceReply(
      {
        '.tag': 'complete',
        entries: [
          {'.tag': 'success', metadata: {id: 'id:1', path_display: '/A', property_groups: []}},
          {'.tag': 'failure', failure: {'.tag': 'path', path: {'.tag': 'conflict', conflict: {'.tag': 'folder'}}}},
        ],
      },
      'folders',
    ),
    {
      entries: [
        {value: {id: 'id:1', path: '/A', folder: true}},
        {failure: {code: failureCodes.changed, stage: 'dropbox.folders-batch', status: 200}, collision: true},
      ],
    },
  );
  assert.deepEqual(
    namespaceReply(
      {
        '.tag': 'complete',
        entries: [
          {'.tag': 'success', metadata: {'.tag': 'file', id: 'id:1', rev: 'r', path_display: '/A.cho'}},
          {'.tag': 'failure', failure: {'.tag': 'path_lookup', path_lookup: {'.tag': 'not_found'}}},
        ],
      },
      'delete',
    ),
    {
      entries: [
        {value: {id: 'id:1', path: '/A.cho', rev: 'r'}},
        {failure: {code: failureCodes.missingFile, stage: 'dropbox.delete-batch', status: 200}, missing: true},
      ],
    },
  );
  assert.throws(
    () => namespaceReply({'.tag': 'failed', failed: {'.tag': 'too_many_write_operations'}}, 'delete'),
    error => error instanceof BatchJobFailed && error.info.code === failureCodes.throttled,
  );
  for (const value of [null, {}, {'.tag': 'other'}, {'.tag': 'complete'}])
    assert.throws(() => namespaceReply(value, 'delete'), invalid('dropbox.delete-batch', 'Ugyldig batchrespons.'));
  assert.throws(
    () => namespaceReply({'.tag': 'complete', entries: [{'.tag': 'other'}]}, 'delete'),
    invalid('dropbox.delete-batch', 'Ugyldig batchfeil.'),
  );
  // A deleted entry must say whether it was a file or a folder.
  assert.throws(
    () => namespaceReply({'.tag': 'complete', entries: [{'.tag': 'success', metadata: {id: 'id:1'}}]}, 'delete'),
    invalid('dropbox.delete-batch', 'Ugyldig batchkvittering.'),
  );
  assert.throws(
    () =>
      namespaceReply(
        {'.tag': 'complete', entries: [{'.tag': 'success', metadata: {'.tag': 'file', id: 'id:1'}}]},
        'folders',
      ),
    invalid('dropbox.folders-batch', 'Ugyldig batchkvittering.'),
  );
});
