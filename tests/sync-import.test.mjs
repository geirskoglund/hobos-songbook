import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DropboxError} from '../src/adapters/dropbox.ts';
import {fixture} from './sync-fixture.mjs';
import {createEditSession} from '../src/domain/edit-session.ts';
import {removeImport} from '../src/sync/imports.ts';

const url = 'https://www.dropbox.com/scl/fo/kilde/Bandet?rlkey=a';
const base = '/Songbooks/Standard/Import/Bandet';

/** Another account's shared folder: link-relative paths, stable file IDs and per-folder cursors. */
function sharedFolder(f) {
  const tree = new Map(),
    cursors = new Map(),
    calls = [];
  let sequence = 0;
  const key = path => path.toLowerCase();
  const hash = text => createHash('sha256').update(text).digest('hex');
  const children = path => {
    const result = new Map();
    for (const file of tree.values()) {
      if (!key(file.path).startsWith(key(path) + '/')) continue;
      const [name, ...rest] = file.path.slice(path.length + 1).split('/');
      result.set(
        key(name),
        rest.length
          ? {kind: 'folder', id: 'dir:' + key(`${path}/${name}`), name}
          : {kind: 'file', id: file.id, name, hash: hash(file.text), size: Buffer.byteLength(file.text)},
      );
    }
    return result;
  };
  const source = {
    calls,
    unavailable: false,
    put(path, text, id) {
      const old = tree.get(key(path));
      tree.set(key(path), {path, text, id: id ?? old?.id ?? `src:${++sequence}`});
    },
    remove(path) {
      for (const k of [...tree.keys()]) if (k === key(path) || k.startsWith(key(path) + '/')) tree.delete(k);
    },
    move(from, to) {
      const file = tree.get(key(from));
      tree.delete(key(from));
      tree.set(key(to), {...file, path: to});
    },
    id: path => tree.get(key(path)).id,
  };
  f.files.listShared = async (link, path, cursor) => {
    calls.push(['list', path, cursor ? 'continue' : 'full']);
    if (link !== url || source.unavailable) throw new DropboxError(409, 'shared_link_not_found/');
    const current = children(path),
      prior = cursor && cursors.get(cursor);
    if (cursor && !prior) throw new DropboxError(409, 'reset/');
    if (path && !current.size && ![...tree.keys()].some(k => k.startsWith(key(path) + '/')))
      throw new DropboxError(409, 'path/not_found/');
    const entries = [];
    if (prior) {
      for (const [name, entry] of prior) if (!current.has(name)) entries.push({kind: 'deleted', name: entry.name});
      for (const [name, entry] of current)
        if (JSON.stringify(prior.get(name)) !== JSON.stringify(entry)) entries.push(entry);
    } else entries.push(...current.values());
    const next = `cursor-${++sequence}`;
    cursors.set(next, current);
    return {entries, cursor: next, reset: false};
  };
  // The saved import list, as the app keeps it between runs.
  let saved;
  f.storage.imports = async () => saved && structuredClone(saved);
  f.storage.saveImports = async (_account, list) => {
    saved = {version: 1, ...structuredClone(list)};
  };
  f.files.readShared = async (link, path) => {
    calls.push(['read', path]);
    const file = tree.get(key(path));
    if (link !== url || !file) throw new DropboxError(409, 'shared_link_not_found/');
    return file.text;
  };
  return source;
}
async function register(f, imports) {
  const current = await f.files.read('/.app/imports.json');
  await f.files.write('/.app/imports.json', JSON.stringify({version: 1, imports}), current?.rev ?? null);
}
const imported = f => f.data.songs.filter(song => song.origin.kind === 'external');
const byTitle = (f, title) => imported(f).find(song => song.title === title);
const read = async (f, path) => (await f.files.read(path))?.text;

test('#106: Synkroniser fetches every .cho file with the source structure and keeps it up to date', async () => {
  const f = fixture();
  await f.run();
  const source = sharedFolder(f);
  source.put('/Alpha.cho', '{t: Alpha}\nA');
  source.put('/Viser/Beta.cho', '{t: Beta}\nB');
  source.put('/Viser/Dypt/Gamma.cho', '{t: Gamma}\nG');
  source.put('/Notat.txt', 'ikke en sang');
  source.put('/Stor.cho', 'x'.repeat(10_000_001));
  await register(f, {bandet: {name: 'Bandet', folder: url, songbookId: 'standard'}});
  await f.run();

  // F10: .cho files only, below the size limit, in the source's folders.
  assert.equal(await read(f, `${base}/Alpha.cho`), '{t: Alpha}\nA');
  assert.equal(await read(f, `${base}/Viser/Beta.cho`), '{t: Beta}\nB');
  assert.equal(await read(f, `${base}/Viser/Dypt/Gamma.cho`), '{t: Gamma}\nG');
  assert.equal(await read(f, `${base}/Notat.txt`), undefined);
  assert.equal(await read(f, `${base}/Stor.cho`), undefined);
  assert.deepEqual(
    imported(f)
      .map(song => song.title)
      .sort(),
    ['Alpha', 'Beta', 'Gamma'],
  );
  assert.ok(imported(f).every(song => song.songbookId === 'standard' && song.origin.sourceId === 'bandet'));
  assert.deepEqual(f.data.state.sharedImports.status.bandet.failed, undefined);
  assert.ok(f.data.state.sharedImports.status.bandet.synced);

  // F11: an unchanged source costs one continued listing per folder and no downloads or copies.
  source.calls.length = 0;
  f.calls.length = 0;
  await f.run();
  assert.deepEqual(source.calls.map(call => call[0] + call[2]).sort(), [
    'listcontinue',
    'listcontinue',
    'listcontinue',
  ]);
  // The library itself is unchanged, so the sync takes no shared lock and writes nothing.
  assert.deepEqual(
    f.calls.filter(([kind]) => ['write', 'read'].includes(kind)),
    [],
  );

  // Only the changed file is downloaded, and the song gets the new text.
  source.put('/Viser/Beta.cho', '{t: Beta}\nB2');
  source.calls.length = 0;
  await f.run();
  assert.deepEqual(
    source.calls.filter(call => call[0] === 'read'),
    [['read', '/Viser/Beta.cho']],
  );
  assert.equal(byTitle(f, 'Beta').original, '{t: Beta}\nB2');
});

test('#106: identity follows renames, moves and re-uploads; removed files stay; personal layer is kept', async () => {
  const f = fixture();
  await f.run();
  const source = sharedFolder(f);
  source.put('/Alpha.cho', '{t: Alpha}\nA');
  source.put('/Beta.cho', '{t: Beta}\nB');
  source.put('/Viser/Gamma.cho', '{t: Gamma}\nG');
  await register(f, {bandet: {name: 'Bandet', folder: url, songbookId: 'standard'}});
  await f.run();
  const ids = Object.fromEntries(imported(f).map(song => [song.title, song.id]));
  // Personal adaptations are allowed and sync like any other song.
  f.change(d => {
    d.personal = d.personal.filter(p => p.songId !== ids.Alpha);
    d.personal.push({songId: ids.Alpha, version: 3, chorus: {}, capo: 3});
  });
  await f.run();
  const personal = async id => JSON.parse(await read(f, `/.app/songs/${id}.json`)).data.capo;
  assert.equal(await personal(ids.Alpha), 3);

  // F13: rename and move keep the song, its copy follows the source.
  source.move('/Alpha.cho', '/Viser/Alfa.cho');
  await f.run();
  assert.equal(await read(f, `${base}/Alpha.cho`), undefined);
  assert.equal(await read(f, `${base}/Viser/Alfa.cho`), '{t: Alpha}\nA');
  assert.equal(byTitle(f, 'Alpha').id, ids.Alpha);
  assert.equal(f.data.personal.find(p => p.songId === ids.Alpha).capo, 3);

  // F12: a file removed from the source stays in the import folder and the library.
  source.remove('/Beta.cho');
  await f.run();
  assert.equal(await read(f, `${base}/Beta.cho`), '{t: Beta}\nB');
  assert.equal(byTitle(f, 'Beta').id, ids.Beta);
  // F13: uploaded again under the same name in the same folder, it is the same song.
  source.put('/Beta.cho', '{t: Beta}\nB igjen', 'src:ny-id');
  await f.run();
  assert.equal(byTitle(f, 'Beta').id, ids.Beta);
  assert.equal(byTitle(f, 'Beta').original, '{t: Beta}\nB igjen');

  // A removed subfolder is noticed by the next Synkroniser; its songs stay.
  source.remove('/Viser');
  await f.run();
  assert.equal(byTitle(f, 'Gamma').id, ids.Gamma);
  assert.equal(byTitle(f, 'Alpha').id, ids.Alpha);
  source.put('/Viser/Gamma.cho', '{t: Gamma}\nG', 'src:gamma-tilbake');
  await f.run();
  assert.equal(byTitle(f, 'Gamma').id, ids.Gamma);
  assert.equal(imported(f).length, 3);
});

test('#106: hand edits in the import folder are overwritten; hand deletions come back or leave', async () => {
  const f = fixture();
  await f.run();
  const source = sharedFolder(f);
  source.put('/Alpha.cho', '{t: Alpha}\nA');
  source.put('/Beta.cho', '{t: Beta}\nB');
  await register(f, {bandet: {name: 'Bandet', folder: url, songbookId: 'standard'}});
  await f.run();
  const alpha = byTitle(f, 'Alpha').id;

  // F14: a manual change is overwritten by the source at the next Synkroniser.
  const copy = await f.files.read(`${base}/Alpha.cho`);
  await f.files.write(`${base}/Alpha.cho`, '{t: Alpha}\nEndret for hånd', copy.rev);
  await f.run();
  assert.equal(await read(f, `${base}/Alpha.cho`), '{t: Alpha}\nA');
  assert.equal(byTitle(f, 'Alpha').original, '{t: Alpha}\nA');

  // F14: a deleted copy whose file is still in the source is fetched again.
  await f.files.deleteFile(`${base}/Alpha.cho`, (await f.files.read(`${base}/Alpha.cho`)).rev);
  await f.run();
  assert.equal(await read(f, `${base}/Alpha.cho`), '{t: Alpha}\nA');
  assert.ok(byTitle(f, 'Alpha'));
  assert.equal(imported(f).length, 2);

  // F14: a deleted copy whose file is gone from the source leaves the library.
  source.remove('/Beta.cho');
  await f.run();
  await f.files.deleteFile(`${base}/Beta.cho`, (await f.files.read(`${base}/Beta.cho`)).rev);
  await f.run();
  assert.equal(byTitle(f, 'Beta'), undefined);
  assert.equal(imported(f).length, 1);
  assert.ok(alpha);
});

test('#106: an unavailable source fails only its own import and is tried again', async () => {
  const f = fixture();
  await f.run();
  const source = sharedFolder(f);
  source.put('/Alpha.cho', '{t: Alpha}\nA');
  await register(f, {
    bandet: {name: 'Bandet', folder: url, songbookId: 'standard'},
    borte: {name: 'Borte', folder: 'https://www.dropbox.com/scl/fo/borte/B?rlkey=b', songbookId: 'standard'},
  });
  const state = await f.run();
  // F15: no failure in the Synkroniser status, the other import and the sync complete.
  assert.equal(state.failure, undefined);
  assert.equal(state.pending, false);
  assert.equal(f.data.state.sharedImports.status.borte.failed, true);
  assert.equal(f.data.state.sharedImports.status.borte.synced, undefined);
  assert.ok(f.data.state.sharedImports.status.bandet.synced);
  assert.ok(byTitle(f, 'Alpha'));

  // A failure after a success keeps the date; the next success clears the failure.
  source.unavailable = true;
  await f.run();
  const failed = f.data.state.sharedImports.status.bandet;
  assert.equal(failed.failed, true);
  assert.ok(failed.synced);
  assert.ok(byTitle(f, 'Alpha'));
  source.unavailable = false;
  await f.run();
  assert.equal(f.data.state.sharedImports.status.bandet.failed, undefined);
});

test('#106: the library links each copy to its import, and its file content cannot be changed', async () => {
  const f = fixture();
  await f.run();
  const source = sharedFolder(f);
  source.put('/Alpha.cho', '{t: Alpha}\nA');
  await register(f, {bandet: {name: 'Bandet', folder: url, songbookId: 'standard'}});
  await f.run();
  const manifest = JSON.parse(await read(f, '/.app/library.json'));
  const link = Object.values(manifest.songs).find(song => song.origin.kind === 'external');
  assert.equal(link.path, `${base}/Alpha.cho`);
  assert.equal(link.origin.sourceId, 'bandet');
  // F16: an edit session refuses to change the original of an imported song.
  const session = createEditSession(byTitle(f, 'Alpha'), {songId: link.id, version: 3, chorus: {}});
  assert.throws(() => session.replaceOriginal({...session.song, original: 'endret'}), /kan ikke redigeres/);
});

for (const lost of ['/.app/import-state.json', '/.app/library.json'])
  test(`#106: Synkroniser interrupted before ${lost} gives no duplicate songs when run again`, async () => {
    const f = fixture();
    await f.run();
    const source = sharedFolder(f);
    source.put('/Alpha.cho', '{t: Alpha}\nA');
    source.put('/Viser/Beta.cho', '{t: Beta}\nB');
    await register(f, {bandet: {name: 'Bandet', folder: url, songbookId: 'standard'}});
    // The copies and the import state are written, then the library write is lost.
    const write = f.files.write;
    f.files.write = async (path, ...rest) => {
      if (path === lost) throw new Error('nettet forsvant');
      return write(path, ...rest);
    };
    await assert.rejects(f.run());
    f.files.write = write;
    await f.run();
    await f.run();
    assert.deepEqual(
      imported(f)
        .map(song => song.title)
        .sort(),
      ['Alpha', 'Beta'],
    );
    const manifest = JSON.parse(await read(f, '/.app/library.json'));
    assert.equal(Object.values(manifest.songs).filter(song => song.origin.kind === 'external').length, 2);
  });

/** Two imports in Standard with one song each, fetched, and a personal adaptation on Alpha. */
async function twoImports() {
  const f = fixture();
  await f.run();
  const source = sharedFolder(f);
  source.put('/Alpha.cho', '{t: Alpha}\nA');
  source.put('/Viser/Beta.cho', '{t: Beta}\nB');
  await register(f, {
    bandet: {name: 'Bandet', folder: url, songbookId: 'standard'},
    borte: {name: 'Borte', folder: 'https://www.dropbox.com/scl/fo/borte/B?rlkey=b', songbookId: 'standard'},
  });
  await f.run();
  // Dropbox lists the folders that hold the copies; this fixture makes only the import folder.
  await f.files.folder(base);
  const alpha = byTitle(f, 'Alpha').id;
  f.change(d => {
    d.personal = d.personal.filter(p => p.songId !== alpha);
    d.personal.push({songId: alpha, version: 3, chorus: {}, capo: 3});
  });
  await f.run();
  assert.ok(await read(f, `/.app/songs/${alpha}.json`));
  return {f, source, alpha};
}
const importList = async f => JSON.parse(await read(f, '/.app/imports.json'));

test('#107: Slett import stops fetching; the songs stay and are still read-only', async () => {
  const {f, source, alpha} = await twoImports();
  await removeImport(f.files, 'bandet', false);
  assert.deepEqual(await importList(f), {
    version: 1,
    imports: {borte: {name: 'Borte', folder: 'https://www.dropbox.com/scl/fo/borte/B?rlkey=b', songbookId: 'standard'}},
  });
  source.put('/Gamma.cho', '{t: Gamma}\nG');
  await f.run();
  assert.deepEqual(
    imported(f)
      .map(song => song.title)
      .sort(),
    ['Alpha', 'Beta'],
  );
  assert.equal(await read(f, `${base}/Alpha.cho`), '{t: Alpha}\nA');
  assert.equal(f.data.personal.find(p => p.songId === alpha).capo, 3);
  // The import's status and mapping leave this device and Dropbox.
  assert.equal(f.data.state.sharedImports.status.bandet, undefined);
  assert.equal(JSON.parse(await read(f, '/.app/import-state.json')).imports.bandet, undefined);
  const session = createEditSession(byTitle(f, 'Alpha'), {songId: alpha, version: 3, chorus: {}});
  assert.throws(() => session.replaceOriginal({...session.song, original: 'endret'}), /kan ikke redigeres/);
});

test('#107: Slett import og innhold removes the folder, the songs and their personal data', async () => {
  const {f, alpha} = await twoImports();
  const beta = byTitle(f, 'Beta').id,
    own = f.data.songs.filter(song => song.origin.kind !== 'external').map(song => song.id);
  await removeImport(f.files, 'bandet', true);
  // Until a Synkroniser has removed the content, the removal stays in the list.
  assert.deepEqual((await importList(f)).removals, {bandet: {name: 'Bandet', songbookId: 'standard'}});
  await f.run();
  assert.equal(await read(f, `${base}/Alpha.cho`), undefined);
  assert.equal(await read(f, `${base}/Viser/Beta.cho`), undefined);
  assert.equal(f.entries.get(base.toLowerCase()), undefined);
  assert.deepEqual(imported(f), []);
  assert.deepEqual(
    f.data.songs.map(song => song.id),
    own,
  );
  assert.equal(
    f.data.personal.find(p => p.songId === alpha),
    undefined,
  );
  assert.equal(await read(f, `/.app/songs/${alpha}.json`), undefined);
  const manifest = JSON.parse(await read(f, '/.app/library.json'));
  assert.ok(manifest.deletedSongs[alpha] && manifest.deletedSongs[beta]);
  assert.equal(manifest.songs[alpha], undefined);
  assert.equal((await importList(f)).removals, undefined);
  assert.equal(f.data.state.sharedImports.removing, undefined);
  // The next Synkroniser has nothing left to remove. (Borte fails on purpose, so it still runs.)
  f.calls.length = 0;
  await f.run();
  assert.deepEqual(
    f.calls.filter(([kind, path]) => kind === 'deleteBatch' || (kind === 'write' && /library|imports.json/.test(path))),
    [],
  );
});

for (const lost of ['/.app/library.json', '/.app/imports.json'])
  test(`#107: Slett import og innhold interrupted before ${lost} is completed by the next Synkroniser`, async () => {
    const {f, alpha} = await twoImports();
    await removeImport(f.files, 'bandet', true);
    const write = f.files.write;
    let failed = false;
    f.files.write = async (path, ...rest) => {
      if (path === lost && !failed && (lost !== '/.app/imports.json' || JSON.parse(rest[0]).removals === undefined)) {
        failed = true;
        throw new Error('nettet forsvant');
      }
      return write(path, ...rest);
    };
    await assert.rejects(f.run());
    f.files.write = write;
    await f.run();
    assert.ok(failed);
    assert.deepEqual(imported(f), []);
    assert.equal(f.entries.get(base.toLowerCase()), undefined);
    assert.equal(await read(f, `${base}/Alpha.cho`), undefined);
    assert.equal(await read(f, `/.app/songs/${alpha}.json`), undefined);
    assert.equal((await importList(f)).removals, undefined);
  });

test('#107: an import deleted on another device is removed here at the next Synkroniser', async () => {
  const {f} = await twoImports();
  // Another device deleted the import with content, removed it and cleared the removal.
  const copies = Object.values(JSON.parse(await read(f, '/.app/library.json')).songs).filter(
    song => song.origin.sourceId === 'bandet',
  );
  await removeImport(f.files, 'bandet', true);
  for (const path of [`${base}/Alpha.cho`, `${base}/Viser/Beta.cho`])
    await f.files.deleteFile(path, (await f.files.read(path)).rev);
  assert.equal(copies.length, 2);
  await f.run();
  assert.deepEqual(imported(f), []);
});
