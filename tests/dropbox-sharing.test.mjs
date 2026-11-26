import test from 'node:test';
import assert from 'node:assert/strict';
import {dropboxAdapter, dropboxConfig, requiredScopes, sharingScopes} from '../src/adapters/dropbox.ts';
import {failureCodes, SyncFailure} from '../src/sync/failure.ts';

const namespace = 'sharing-test';
const authKey = `${namespace}:dropbox-auth-v1`;
const folder = {id: 'id:shared-folder', path: '/Songbooks/Standard/Shared'};
const result = (value, status = 200) =>
  new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const link = (overrides = {}) => ({
  '.tag': 'folder',
  id: folder.id,
  path_lower: folder.path.toLowerCase(),
  url: 'https://www.dropbox.com/scl/fo/shared/Shared?rlkey=example',
  link_permissions: {effective_audience: {'.tag': 'public'}, link_access_level: {'.tag': 'viewer'}},
  ...overrides,
});

function setup() {
  const saved = new Map(),
    session = new Map();
  const storage = map => ({
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  });
  const redirect = dropboxConfig('test').redirect;
  const parseLocation = url =>
    Object.assign(new URL(url), {
      assign: url => {
        globalThis.authorize = new URL(url);
      },
    });
  const original = {
    accountId: 'same',
    name: 'Test',
    email: 'test@example.invalid',
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expires: Date.now() + 900000,
    version: 1,
  };
  saved.set(authKey, JSON.stringify(original));
  const globals = {
    localStorage: storage(saved),
    sessionStorage: storage(session),
    navigator: {locks: {request: async (_name, run) => run()}},
    location: parseLocation(redirect),
    history: {replaceState() {}},
    authorize: undefined,
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  return {
    saved,
    original,
    callback(code = 'code') {
      globalThis.location = parseLocation(
        `${redirect}?code=${code}&state=${globalThis.authorize.searchParams.get('state')}`,
      );
    },
    cleanup() {
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('AK39-05: use direct folder IDs, ignore other folders and recheck a concurrent viewer link creation', async () => {
  const f = setup();
  try {
    let lookedUp = 0;
    const calls = [];
    const adapter = dropboxAdapter({namespace, channel: 'test'}, async (url, request) => {
      const path = new URL(url).pathname,
        args = JSON.parse(request.body);
      calls.push(path);
      assert.equal(args.path, folder.id);
      if (path.endsWith('/list_shared_links')) {
        assert.equal(args.direct_only, true);
        return result({has_more: false, links: ++lookedUp === 1 ? [link({id: 'id:parent-folder'})] : [link()]});
      }
      assert.deepEqual(args.settings, {audience: {'.tag': 'public'}, access: {'.tag': 'viewer'}});
      return result({error_summary: 'shared_link_already_exists/extra_context'}, 409);
    });
    assert.equal(await adapter.sharedLink(folder), link().url);
    assert.deepEqual(calls, [
      '/2/sharing/list_shared_links',
      '/2/sharing/create_shared_link_with_settings',
      '/2/sharing/list_shared_links',
    ]);
  } finally {
    f.cleanup();
  }
});

test('AK39-05: effective restricted audience, edit links and scope errors never masquerade as usable viewer links', async () => {
  const f = setup();
  try {
    f.saved.set(authKey, JSON.stringify({...f.original, scopes: [...requiredScopes, ...sharingScopes]}));
    let mode = 'policy';
    const adapter = dropboxAdapter({namespace, channel: 'test'}, async url => {
      if (mode === 'scope') return result({error: {'.tag': 'missing_scope', required_scope: 'sharing.read'}}, 401);
      if (mode === 'network') throw new TypeError('unreachable');
      if (url.endsWith('/list_shared_links'))
        return result({
          has_more: false,
          links: [
            link({link_permissions: {effective_audience: {'.tag': 'public'}, link_access_level: {'.tag': 'editor'}}}),
          ],
        });
      return result(
        link({link_permissions: {effective_audience: {'.tag': 'team'}, link_access_level: {'.tag': 'viewer'}}}),
      );
    });
    await assert.rejects(adapter.sharedLink(folder), error => error.info.stage === 'dropbox.sharing-policy');
    assert.equal(adapter.sharingAllowed(), true);
    mode = 'network';
    await assert.rejects(adapter.sharedLink(folder), error => error.info.code === failureCodes.network);
    mode = 'scope';
    await assert.rejects(adapter.sharedLink(folder), error => error.info.stage === 'dropbox.sharing-scope');
    assert.equal(adapter.account().id, 'same');
    assert.equal(adapter.sharingAllowed(), false);
    assert.deepEqual(JSON.parse(f.saved.get(authKey)).scopes, requiredScopes);
  } finally {
    f.cleanup();
  }
});

test('AK39-05: a link with the same folder ID and an archived path fails closed on lookup or creation', async () => {
  const f = setup();
  try {
    const archived = link({path_lower: '/deleted/standard/shared'}),
      calls = [];
    let exists = true;
    const adapter = dropboxAdapter({namespace, channel: 'test'}, async url => {
      const route = new URL(url).pathname;
      calls.push(route);
      if (route.endsWith('/list_shared_links')) return result({has_more: false, links: exists ? [archived] : []});
      return result(archived);
    });
    const wrongTarget = error =>
      error.info.stage === 'dropbox.sharing-target' && error.info.code === failureCodes.changed;
    await assert.rejects(adapter.sharedLink(folder), wrongTarget);
    assert.deepEqual(calls, ['/2/sharing/list_shared_links']);
    calls.length = 0;
    exists = false;
    const moved = new SyncFailure(
      {code: failureCodes.changed, stage: 'publication.shared-folder'},
      'Folder moved since lookup',
    );
    await assert.rejects(
      adapter.sharedLink(folder, async () => {
        throw moved;
      }),
      error => error === moved,
    );
    assert.deepEqual(calls, ['/2/sharing/list_shared_links']);
    calls.length = 0;
    await assert.rejects(
      adapter.sharedLink(folder, async () => {
        calls.push('verify');
      }),
      wrongTarget,
    );
    assert.deepEqual(calls, ['/2/sharing/list_shared_links', 'verify', '/2/sharing/create_shared_link_with_settings']);
  } finally {
    f.cleanup();
  }
});

test('AK39-05: reuse or create a legacy public folder link and distinguish unverifiable modern permissions', async () => {
  const f = setup();
  try {
    const older = link({
      url: 'https://www.dropbox.com/sh/folder?dl=0',
      link_permissions: {resolved_visibility: {'.tag': 'public'}, require_password: false},
    });
    let mode = 'reuse',
      creates = 0;
    const adapter = dropboxAdapter({namespace, channel: 'test'}, async url => {
      if (url.endsWith('/list_shared_links')) return result({has_more: false, links: mode === 'reuse' ? [older] : []});
      creates++;
      if (mode === 'create') return result(older);
      if (mode === 'denied') return result({error_summary: 'settings_error/'}, 409);
      return result(link({link_permissions: {effective_audience: {'.tag': 'public'}}}));
    });
    assert.equal(await adapter.sharedLink(folder), older.url);
    assert.equal(creates, 0);
    mode = 'create';
    assert.equal(await adapter.sharedLink(folder), older.url);
    assert.equal(creates, 1);
    mode = 'unverified';
    await assert.rejects(adapter.sharedLink(folder), error => error.info.stage === 'dropbox.sharing-verification');
    mode = 'denied';
    await assert.rejects(adapter.sharedLink(folder), error => error.info.stage === 'dropbox.sharing-policy');
  } finally {
    f.cleanup();
  }
});

test('AK39-05: additional scopes require explicit PKCE consent and keep the existing connection on a different account', async () => {
  const f = setup();
  try {
    let accountId = 'other';
    const adapter = dropboxAdapter({namespace, channel: 'test'}, async url =>
      url.endsWith('/oauth2/token')
        ? result({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600,
            account_id: accountId,
            scope: [...requiredScopes, ...sharingScopes].join(' '),
          })
        : result({account_id: accountId, name: {display_name: 'Test'}, email: 'test@example.invalid'}),
    );
    assert.equal(adapter.sharingAllowed(), false);
    await adapter.connect('standard');
    assert.deepEqual(globalThis.authorize.searchParams.get('scope').split(' '), [...requiredScopes, ...sharingScopes]);
    assert.equal(globalThis.authorize.searchParams.get('code_challenge_method'), 'S256');
    f.callback();
    assert.deepEqual(await adapter.callback(), {bookId: 'standard', authorized: false});
    assert.deepEqual(JSON.parse(f.saved.get(authKey)), f.original);
    accountId = 'same';
    globalThis.location = new URL(dropboxConfig('test').redirect);
    globalThis.location.assign = url => {
      globalThis.authorize = new URL(url);
    };
    await adapter.connect('standard');
    f.callback();
    assert.deepEqual(await adapter.callback(), {bookId: 'standard', authorized: true});
    assert.equal(adapter.sharingAllowed(), true);
  } finally {
    f.cleanup();
  }
});
