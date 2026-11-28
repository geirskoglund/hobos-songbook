import test from 'node:test';
import assert from 'node:assert/strict';
import {importFolder, importName, notDropboxAddress} from '../src/domain/shared-import.ts';
import {dropboxAdapter, dropboxConfig, DropboxError, requiredScopes, sharingScopes} from '../src/adapters/dropbox.ts';
import {addImport, readImports} from '../src/sync/imports.ts';

const existing = [
  {id: 'a', name: 'Bandet', folder: 'https://www.dropbox.com/scl/fo/abc/Bandet?rlkey=x', songbookId: 'standard'},
];

test('#105: import names follow songbook name rules and are unique among imports', () => {
  assert.equal(importName('  Blåbær & venner ', existing), 'Blåbær & venner');
  assert.throws(() => importName('', existing), /Skriv inn et navn på importen/);
  assert.throws(() => importName('a/b', existing), /kan ikke inneholde/);
  assert.throws(() => importName('Slutt.', existing), /punktum/);
  assert.throws(() => importName('BANDET', existing), /allerede en import med dette navnet/);
  assert.equal(importName('Bandet', existing, 'a'), 'Bandet');
});

test('#105 F04: only Dropbox web addresses are accepted, and each folder only once', () => {
  assert.equal(
    importFolder(' https://www.dropbox.com/scl/fo/new/Mappe?rlkey=y ', existing),
    'https://www.dropbox.com/scl/fo/new/Mappe?rlkey=y',
  );
  for (const address of [
    'dropbox.com/scl/fo/x',
    'http://www.dropbox.com/scl/fo/x',
    'https://example.com/scl/fo/x',
    'https://dropbox.com.example.com/x',
    'https://user:pw@www.dropbox.com/x',
  ])
    assert.throws(() => importFolder(address, existing), {message: notDropboxAddress}, address);
  // Same host in any case, path and rlkey; other query parameters do not name another folder.
  assert.throws(
    () => importFolder('https://WWW.DROPBOX.COM/scl/fo/abc/Bandet?dl=0&rlkey=x&e=1#top', existing),
    /En annen import bruker allerede denne mappen/,
  );
  // Path and rlkey are case-sensitive at Dropbox.
  for (const address of [
    'https://www.dropbox.com/scl/fo/ABC/Bandet?rlkey=x',
    'https://www.dropbox.com/scl/fo/abc/Bandet?rlkey=X',
  ])
    assert.equal(importFolder(address, existing), address);
  assert.equal(importFolder(existing[0].folder, existing, 'a'), existing[0].folder);
});

const namespace = 'import-test';
const reply = (value, status = 200) =>
  new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
function withAdapter(handler) {
  const saved = new Map([
    [
      `${namespace}:dropbox-auth-v1`,
      JSON.stringify({
        version: 1,
        accountId: 'me',
        name: 'Test',
        email: 'test@example.invalid',
        accessToken: 'access',
        refreshToken: 'refresh',
        expires: Date.now() + 900000,
        scopes: [...requiredScopes, ...sharingScopes],
      }),
    ],
  ]);
  const storage = map => ({
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  });
  const globals = {
    localStorage: storage(saved),
    sessionStorage: storage(new Map()),
    navigator: {locks: {request: async (_name, run) => run()}},
    location: new URL(dropboxConfig('test').redirect),
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  const calls = [];
  const adapter = dropboxAdapter({namespace, channel: 'test'}, async (url, request) => {
    const route = new URL(url).pathname.replace('/2/', ''),
      args = JSON.parse(request.body);
    calls.push({route, args});
    return handler(route, args);
  });
  return {
    adapter,
    calls,
    cleanup() {
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}
const url = 'https://www.dropbox.com/scl/fo/abc/Kilde?rlkey=x';
const folderLink = (extra = {}) => ({
  '.tag': 'folder',
  id: 'id:root',
  name: 'Kilde',
  url,
  link_permissions: {effective_audience: {'.tag': 'public'}, link_access_level: {'.tag': 'viewer'}},
  ...extra,
});
async function answer(handler, own = new Set()) {
  const f = withAdapter(handler);
  try {
    return {result: await f.adapter.testSharedFolder(url, own), calls: f.calls};
  } finally {
    f.cleanup();
  }
}

test('#105 F05: a readable shared folder is listed folder by folder through the link', async () => {
  const {result, calls} = await answer((route, args) => {
    if (route === 'sharing/get_shared_link_metadata') return reply(folderLink());
    if (route === 'files/get_metadata') return reply({error_summary: 'path/not_found/'}, 409);
    if (route === 'files/list_folder' && args.path === '')
      return reply({
        entries: [
          {'.tag': 'folder', id: 'id:sub', name: 'Under'},
          {'.tag': 'file', id: 'id:f', name: 'a.cho'},
        ],
        has_more: true,
        cursor: 'c1',
      });
    if (route === 'files/list_folder/continue') return reply({entries: [], has_more: false, cursor: 'c2'});
    if (route === 'files/list_folder' && args.path === '/Under')
      return reply({entries: [], has_more: false, cursor: 'c3'});
    throw new Error(`Unexpected ${route}`);
  });
  assert.equal(result, 'ok');
  assert.deepEqual(
    calls.map(call => call.route),
    [
      'sharing/get_shared_link_metadata',
      'files/get_metadata',
      'files/list_folder',
      'files/list_folder/continue',
      'files/list_folder',
    ],
  );
  assert.deepEqual(calls[2].args, {path: '', shared_link: {url}});
});

test('#105 F05: files, passwords, restricted access and missing links give their own answers', async () => {
  const metadataOnly = value => () => (typeof value === 'number' ? reply({}, value) : value);
  const cases = [
    [reply(folderLink({'.tag': 'file'})), 'not-shared'],
    [reply(folderLink({link_permissions: {require_password: true}})), 'not-shared'],
    [reply(folderLink({link_permissions: {effective_audience: {'.tag': 'team'}}})), 'not-shared'],
    [reply(folderLink({link_permissions: {allow_download: false}})), 'not-shared'],
    [reply({error_summary: 'shared_link_access_denied/'}, 409), 'not-shared'],
    [reply({error_summary: 'shared_link_not_found/'}, 409), 'not-found'],
    [reply(folderLink({expires: '2000-01-01T00:00:00Z'})), 'not-found'],
  ];
  for (const [response, expected] of cases)
    assert.equal((await answer(metadataOnly(response))).result, expected, expected);
});

test('#105 F05: a link above one of the own songbook folders is recognized by folder ID', async () => {
  const {result} = await answer(
    (route, args) => {
      if (route === 'sharing/get_shared_link_metadata') return reply(folderLink());
      if (route === 'files/get_metadata') return reply({error_summary: 'path/not_found/'}, 409);
      if (args.path === '')
        return reply({entries: [{'.tag': 'folder', id: 'id:mybook', name: 'Standard'}], has_more: false});
      throw new Error('No deeper listing is needed');
    },
    new Set(['id:mybook']),
  );
  assert.equal(result, 'own-songbook');
});

test('#105 F05: a subfolder that cannot be listed is skipped; the link itself still decides', async () => {
  const listing = rootStatus => (route, args) => {
    if (route === 'sharing/get_shared_link_metadata') return reply(folderLink());
    if (route === 'files/get_metadata') return reply({error_summary: 'path/not_found/'}, 409);
    if (args.path === '')
      return rootStatus
        ? reply({error_summary: 'path/not_found/'}, rootStatus)
        : reply({
            entries: [
              {'.tag': 'folder', id: 'id:gone', name: 'Borte'},
              {'.tag': 'folder', id: 'id:sub', name: 'Under'},
            ],
            has_more: false,
          });
    if (args.path === '/Borte') return reply({error_summary: 'path/not_found/'}, 409);
    if (args.path === '/Under') return reply({entries: [], has_more: false});
    throw new Error(`Unexpected ${route}`);
  };
  const skipped = await answer(listing());
  assert.equal(skipped.result, 'ok');
  assert.deepEqual(
    skipped.calls.filter(call => call.route === 'files/list_folder').map(call => call.args.path),
    ['', '/Borte', '/Under'],
  );
  assert.equal((await answer(listing(409))).result, 'not-shared');
});

test('#105 F05: Dropbox errors that are not about the link make the address untested', async () => {
  assert.equal((await answer(() => reply({error_summary: 'internal/'}, 503))).result, 'unavailable');
  assert.equal(
    (
      await answer(() => {
        throw new TypeError('offline');
      })
    ).result,
    'unavailable',
  );
});

function memoryFiles() {
  const store = {file: null, writes: 0, race: null};
  return {
    store,
    files: {
      async read() {
        return store.file && {...store.file};
      },
      async write(path, text, rev) {
        if (store.race) {
          const race = store.race;
          store.race = null;
          race();
        }
        if ((store.file?.rev ?? null) !== rev) throw new DropboxError(409, 'path/conflict/file/');
        store.writes++;
        store.file = {text, rev: `r${store.writes}`, id: 'id:imports', path};
        return {...store.file};
      },
    },
  };
}

test('#105 F06: imports are added to the freshest list and repeat the field rules against it', async () => {
  const {store, files} = memoryFiles();
  const first = {id: 'one', name: 'Én', folder: 'https://www.dropbox.com/scl/fo/1', songbookId: 'b1'};
  await addImport(files, first, () => {});
  assert.deepEqual((await readImports(files)).imports, [first]);
  // Another device writes between our read and write: ours is retried on top of theirs.
  const theirs = {id: 'two', name: 'To', folder: 'https://www.dropbox.com/scl/fo/2', songbookId: 'b2'};
  store.race = () => {
    const text = JSON.stringify({
      version: 1,
      imports: {
        one: {name: 'Én', folder: first.folder, songbookId: 'b1'},
        two: {name: 'To', folder: theirs.folder, songbookId: 'b2'},
      },
    });
    store.file = {text, rev: 'other', id: 'id:imports', path: '/.app/imports.json'};
  };
  const mine = {id: 'three', name: 'Tre', folder: 'https://www.dropbox.com/scl/fo/3', songbookId: 'b1'};
  const seen = [];
  const saved = await addImport(files, mine, current => seen.push(current.map(item => item.id)));
  assert.deepEqual(seen, [['one'], ['one', 'two']]);
  assert.deepEqual(
    saved.imports.map(item => item.id),
    ['one', 'two', 'three'],
  );
  await assert.rejects(
    addImport(files, {...mine, id: 'four'}, current => importName('tre', current, 'four')),
    /allerede en import/,
  );
});

test('#105 F05: an own link is a songbook only when its folder is inside the app folder', async () => {
  const own = (inside, route) => {
    if (route === 'sharing/get_shared_link_metadata') return reply(folderLink({path_lower: '/musikk/bandet'}));
    if (route === 'files/get_metadata')
      return inside
        ? reply({'.tag': 'folder', id: 'id:root', path_display: '/Songbooks/Standard/Shared'})
        : reply({error_summary: 'path/not_found/'}, 409);
    return reply({entries: [], has_more: false});
  };
  const inside = await answer(route => own(true, route));
  assert.equal(inside.result, 'own-songbook');
  assert.deepEqual(inside.calls[1], {route: 'files/get_metadata', args: {path: 'id:root'}});
  assert.equal((await answer(route => own(false, route))).result, 'ok');
});
