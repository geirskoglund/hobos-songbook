import {parseChordPro} from '../domain/chordpro.ts';
import {cleanPersonal, reconcilePersonal} from '../domain/annotations.ts';
import {songbookName} from '../domain/songbook.ts';
import type {Song, SongPersonal} from '../domain/song.ts';
import type {syncStorage, SyncSnapshot} from '../storage/sync.ts';
import {direction, emptyManifest, hash, mergeManifest, parseManifest, parsePersonal, personalData, same, type BookLink, type Conflict, type FileValue, type Manifest, type PersonalFile, type RemoteFiles, type SongLink, type SyncState} from './model.ts';
export class PausedSync extends Error {constructor() {super('Synkronisering er pauset mens en sang er åpen.');}}
const safeName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'Sang';
const privateSong = (song: Song) => song.origin.kind === 'local' || song.origin.provider === 'dropbox' && !(song.origin as any).sourceId;
const personalOf = (snapshot: SyncSnapshot, id: string) => personalData(snapshot.personal.find(p => p.songId === id) ?? {songId: id, version: 3, chorus: {}});
function fromRemote(link: SongLink, text: string): Song {
  const parsed = parseChordPro(text, link.origin.filename.replace(/\.[^.]+$/, ''));
  return {id: link.id, songbookId: link.songbookId, origin: link.origin, original: text, title: parsed.title, key: parsed.key};
}
function project(personal: SongPersonal, source: Song, target: Song) {return personalData(source.original === target.original ? personal : reconcilePersonal(source, target, personal));}
export interface SyncHooks {valid(): boolean; changed(): void}
export function syncEngine(storage: ReturnType<typeof syncStorage>, files: RemoteFiles, accountId: string, hooks: SyncHooks) {
  let snapshot: SyncSnapshot, state: SyncState, generation = 0;
  const valid = () => hooks.valid();
  async function check() {
    if (!valid()) throw new PausedSync();
    const latest = await storage.snapshot(accountId);
    if (Object.keys(latest.journal.sessions).some(id => id.startsWith('interrupted:'))) throw new Error('En avbrutt redigeringsøkt venter. Åpne og forlat sangen før synkronisering.');
    if (Object.keys(latest.journal.sessions).length) throw new PausedSync();
    if (latest.journal.generation !== generation) throw new Error('Nyere lokale endringer venter. Synkroniseringen må fortsette fra nyeste versjon.');
    if (!valid()) throw new PausedSync();
  }
  async function step<T>(operation: () => Promise<T>): Promise<T> {await check(); const result = await operation(); await check(); return result;}
  async function save(changes: Parameters<typeof storage.commit>[2] = {}) {await check(); await storage.commit(generation, state, changes, valid); hooks.changed();}
  async function start() {
    snapshot = await storage.snapshot(accountId); state = snapshot.state; generation = snapshot.journal.generation;
    await check();
  }
  async function read(path: string) {return step(() => files.read(path));}
  async function write(path: string, text: string, rev: string | null) {return step(() => files.write(path, text, rev));}
  async function folder(path: string) {return step(() => files.folder(path));}
  function localManifest(): Manifest {
    const local = emptyManifest();
    for (const book of snapshot.songbooks) local.books[book.id] = {...state.manifest.books[book.id], ...state.folders[book.id], ...book};
    for (const [id, book] of Object.entries(snapshot.journal.deletedBooks)) local.books[id] = {...state.manifest.books[id], ...state.folders[id], ...book};
    for (const song of snapshot.songs.filter(privateSong)) {
      const previous = state.manifest.songs[song.id] ?? state.reservations[song.id];
      local.songs[song.id] = {...previous, id: song.id, songbookId: song.songbookId, origin: song.origin, path: previous?.path ?? ''};
    }
    return local;
  }
  async function ensureBooks(merged: Manifest) {
    await folder('/.app'); await folder('/.app/songs'); await folder('/Songbooks');
    for (const book of Object.values(merged.books).filter(b => !b.deleted)) {
      const target = `/Songbooks/${book.name}`;
      const prior = Object.values(merged.books).find(other => other.id !== book.id && other.path?.toLowerCase() === target.toLowerCase());
      if (prior) {
        const entries = await step(() => files.list('/Songbooks'));
        if (entries.some(entry => entry.path.toLowerCase() === target.toLowerCase())) throw new Error(`Mappen for «${book.name}» tilhører en annen eller slettet sangbok. Velg et annet navn; innholdet er beholdt.`);
      }
      const known = state.folders[book.id] ?? state.manifest.books[book.id] ?? book;
      let binding: {id: string; path: string};
      if (known.folderId && known.path !== target) {
        // Dropbox paths are case-insensitive; a temporary name preserves case-only renames.
        if (known.path?.toLowerCase() === target.toLowerCase()) {
          const intermediate = `/Songbooks/.rename-${book.id}`;
          await step(() => files.move(known.folderId!, intermediate));
        }
        binding = await step(() => files.move(known.folderId!, target));
      } else binding = await folder(target);
      book.folderId = binding.id; book.path = binding.path;
      state.folders[book.id] = {...book}; await save();
      for (const kind of ['Private', 'Shared', 'Import', 'Originals']) await folder(`${target}/${kind}`);
    }
  }
  async function discover(remote: Manifest) {
    // Inspect only book directories and Private/. Contents of other subfolders stay out of sync.
    for (const entry of await step(() => files.list('/Songbooks'))) {
      if (!entry.folder || Object.values(remote.books).some(book => book.folderId === entry.id || book.path?.toLowerCase() === entry.path.toLowerCase())) continue;
      let known = Object.values(state.folders).find(book => book.folderId === entry.id);
      if (!known) {
        const name = entry.path.split('/').at(-1)!;
        songbookName(name, Object.values(remote.books).filter(b => !b.deleted));
        known = {id: crypto.randomUUID(), name, path: entry.path, folderId: entry.id}; state.folders[known.id] = known; await save();
      }
      remote.books[known.id] = {...known};
    }
    for (const book of Object.values(remote.books).filter(book => !book.deleted)) {
      for (const file of await step(() => files.list(`${book.path ?? `/Songbooks/${book.name}`}/Private`))) {
        if (file.folder || !file.path.toLowerCase().endsWith('.cho') || Object.values(remote.songs).some(song => song.fileId === file.id || song.path.toLowerCase() === file.path.toLowerCase())) continue;
        let known = Object.values(state.reservations).find(song => song.fileId === file.id);
        if (!known) {
          known = {id: crypto.randomUUID(), songbookId: book.id, fileId: file.id, path: file.path, origin: {kind: 'local', filename: file.path.split('/').at(-1)!, importedAt: new Date().toISOString()}};
          state.reservations[known.id] = known; await save();
        }
        remote.songs[known.id] = {...known};
      }
    }
  }
  async function personalFile(link: SongLink, content: FileValue, fresh: boolean): Promise<{file: PersonalFile; value: FileValue | null; original: string}> {
    const value = await read(`/.app/songs/${link.id}.json`);
    if (!value) {
      if (!fresh) throw new Error(`Personfilen for «${link.origin.filename}» mangler. Lokale data er beholdt.`);
      return {value: null, original: content.text, file: {version: 1, songId: link.id, original: {rev: content.rev, hash: await hash(content.text)}, data: {songId: link.id, version: 3, chorus: {}}}};
    }
    const file = parsePersonal(value.text, link.id);
    let original = content.text;
    if (await hash(content.text) !== file.original.hash) {
      const previous = await read(`rev:${file.original.rev}`);
      if (!previous || await hash(previous.text) !== file.original.hash) throw new Error('Persondataenes originalgrunnlag er utilgjengelig. Ingen data overskrives.');
      original = previous.text;
    }
    return {value, file, original};
  }
  async function transferSong(link: SongLink, remoteKnown: boolean, manual: boolean, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) {
    const local = snapshot.songs.find(song => song.id === link.id), basis = state.bases[link.id];
    let content = await read(link.fileId ?? link.path);
    if (!content && remoteKnown) throw new Error(`Sangfilen «${link.origin.filename}» mangler. Ingen fil gjenopprettes eller slettes automatisk.`);
    if (!content && !local) throw new Error('Sangfilen mangler i Dropbox.');
    const localPersonal = local && personalOf(snapshot, local.id);
    const remoteSong = content && fromRemote(link, content.text);
    const fresh = !remoteKnown || !state.manifest.songs[link.id] && Boolean(state.reservations[link.id]?.fileId);
    const person = content ? await personalFile(link, content, fresh) : null;
    const remotePersonal = person ? personalData(person.file.data) : undefined;
    if (resolution && (!content || content.rev !== resolution.conflict.contentRev || person?.value?.rev !== resolution.conflict.personalRev || !same(local, resolution.conflict.local) || !same(localPersonal, resolution.conflict.localPersonal))) {
      // A dialog choice belongs to the displayed snapshots, never to a later revision.
      delete state.decisions[`${link.id}:content`]; delete state.decisions[`${link.id}:personal`]; resolution = undefined;
    }

    let contentChoice = direction(local?.original, content?.text, basis?.original, manual);
    let personChoice = direction(localPersonal, remotePersonal, basis?.personal.data, manual);
    if (resolution) {state.decisions[`${link.id}:${resolution.conflict.kind}`] = resolution; await save();}
    let contentDecision = state.decisions[`${link.id}:content`], personDecision = state.decisions[`${link.id}:personal`];
    for (const decision of [contentDecision, personDecision]) if (decision && (decision.conflict.contentRev !== content?.rev || decision.conflict.personalRev !== person?.value?.rev || !same(decision.conflict.local, local) || !same(decision.conflict.localPersonal, localPersonal))) {
      delete state.decisions[`${link.id}:${decision.conflict.kind}`];
      if (decision.conflict.kind === 'content') contentDecision = undefined!; else personDecision = undefined!;
    }
    if (contentDecision) contentChoice = contentDecision.choice === 'local' ? 'upload' : 'download';
    if (personDecision) personChoice = personDecision.choice === 'local' ? 'upload' : 'download';
    state.conflicts = state.conflicts.filter(c => c.songId !== link.id);
    const conflicts: Conflict[] = [];
    if (local && remoteSong && content && person?.value) {
      for (const kind of ['content', 'personal'] as const) if ((kind === 'content' ? contentChoice : personChoice) === 'conflict') conflicts.push({songId: link.id, kind, title: local.title, local, localPersonal: localPersonal!, remote: remoteSong, remotePersonal: remotePersonal!, remotePersonalOriginal: person.original, contentRev: content.rev, personalRev: person.value.rev, personalFile: person.file, generation});
    }
    if (conflicts.length) {state.conflicts.push(...conflicts); await save();}
    // A content choice must not silently dispose of a separate personal conflict.
    if (contentChoice === 'conflict' || personChoice === 'conflict') return false;
    const waitingRemote = contentChoice === 'remote' || personChoice === 'remote';
    if (waitingRemote) state.awaitingDownload = true;
    const chosenSong = contentChoice === 'download' || !local ? remoteSong! : {...local, songbookId: link.songbookId};
    let chosenPersonal = personChoice === 'download' || !local ? project(remotePersonal!, {...remoteSong!, original: person!.original}, chosenSong) : project(localPersonal!, local, chosenSong);
    if (contentDecision?.choice === 'copy') {
      const copyId = state.reservations[`copy:${link.id}`]?.id ?? crypto.randomUUID();
      const copy: Song = {...local!, id: copyId, origin: {...local!.origin, kind: 'local'}};
      const copied = structuredClone(localPersonal!); copied.songId = copyId;
      for (const annotation of Object.values(copied.annotations ?? {})) annotation.anchor.songId = copyId;
      state.reservations[`copy:${link.id}`] = {id: copyId, songbookId: copy.songbookId, origin: copy.origin, path: ''};
      await save({songs: [copy], personal: [copied]}); snapshot.songs.push(copy); snapshot.personal.push(copied);
    }
    if (contentChoice === 'upload') {
      content = await write(link.path, chosenSong.original, content?.rev ?? null);
    }
    if (!content) throw new Error('Ingen trygg sangfilversjon er tilgjengelig.');
    const target = `${state.folders[link.songbookId]?.path ?? `/Songbooks/${snapshot.songbooks.find(b => b.id === link.songbookId)?.name}`}/Private/${link.path.split('/').at(-1)}`;
    if (content.path !== target) {
      const moved = await step(() => files.move(content!.id, target)); content = {...content, ...moved};
    }
    link.path = content.path; link.fileId = content.id; state.reservations[link.id] = {...link}; await save();
    const referenceRev = contentChoice === 'remote' ? basis!.contentRev : content.rev;
    const nextPerson: PersonalFile = {version: 1, songId: link.id, original: {rev: referenceRev, hash: await hash(chosenSong.original)}, data: chosenPersonal};
    const savedPerson = personChoice === 'remote' ? person!.value! : person?.value && same(nextPerson, person.file) ? person.value : await write(`/.app/songs/${link.id}.json`, JSON.stringify(nextPerson), person?.value?.rev ?? null);
    state.bases[link.id] = {original: contentChoice === 'remote' ? basis!.original : chosenSong.original, personal: personChoice === 'remote' ? basis!.personal : nextPerson, contentRev: referenceRev, personalRev: personChoice === 'remote' ? basis!.personalRev : savedPerson.rev};
    delete state.decisions[`${link.id}:content`]; delete state.decisions[`${link.id}:personal`];
    if (manual) await save({books: Object.values(state.folders).filter(b => !b.deleted).map(({id, name}) => ({id, name})), songs: [{...chosenSong, songbookId: link.songbookId}], personal: [chosenPersonal]}); else await save();
    // Original import text is preserved once; an existing Originals file is never replaced.
    if (local && !/\.cho$/i.test(local.origin.filename)) {
      const path = `${state.folders[link.songbookId].path}/Originals/${safeName(local.origin.filename)}--${await hash(local.id)}.${local.origin.filename.split('.').at(-1)}`;
      const previous = await read(path);
      if (!previous) await write(path, local.original, null);
    }
    return !waitingRemote;
  }
  async function run(manual: boolean, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) {
    await start(); state.error = undefined; state.pending = true; state.awaitingDownload = false;
    try {
      const manifestFile = await read('/.app/library.json');
      const remote = manifestFile ? parseManifest(manifestFile.text) : emptyManifest();
      let local = localManifest();
      // The automatically seeded Standard book is not a conflicting user edit on a new device.
      if (!snapshot.songs.length && snapshot.songbooks.length === 1 && snapshot.songbooks[0].id === 'standard' && snapshot.songbooks[0].name === 'Standard' && !snapshot.journal.generation && Object.keys(remote.books).length) local.books = {};
      let merged = mergeManifest(state.manifest, local, remote);
      await ensureBooks(merged);
      if (manual) {await discover(merged); merged = mergeManifest(state.manifest, local, merged);}
      // Reserve all new file paths before contacting Dropbox, including ambiguous-response retries.
      for (const song of snapshot.songs.filter(privateSong)) {
        const entry = merged.songs[song.id]; if (!entry) continue;
        if (!entry.path) {
          const reserved = state.reservations[song.id];
          entry.path = reserved?.path || `${merged.books[song.songbookId].path}/Private/${safeName(song.origin.filename)}--${await hash(song.id)}.cho`;
          state.reservations[song.id] = {...entry}; await save();
        }
      }
      let complete = true;
      const readySongs: Manifest['songs'] = {...remote.songs};
      for (const entry of Object.values(merged.songs)) {
        // Automatic upload may retain independent remote metadata, but never imports its data.
        if (!manual && !snapshot.songs.some(song => song.id === entry.id)) continue;
        try {
          if (await transferSong(entry, Boolean(remote.songs[entry.id]), manual, resolution?.conflict.songId === entry.id ? resolution : undefined)) readySongs[entry.id] = entry;
          else complete = false;
        } catch (error) {if (error instanceof PausedSync) throw error; complete = false; state.error = error instanceof Error ? error.message : 'Dropbox-operasjonen feilet.'; await save();}
      }
      merged.songs = readySongs;
      for (const [id, book] of Object.entries(merged.books)) if (book.deleted && Object.values(readySongs).some(song => song.songbookId === id)) {
        if (!remote.books[id]) throw new Error('Flytting av sangene er ikke fullført. Sangbokmappen beholdes.');
        merged.books[id] = remote.books[id]; complete = false;
      }
      const finalText = JSON.stringify(merged);
      // Conditional whole-manifest write preserves independent remote changes or stops for retry.
      if (!manifestFile || !same(parseManifest(manifestFile.text), merged)) await write('/.app/library.json', finalText, manifestFile?.rev ?? null);
      // Only acknowledge the local identities actually represented in this manifest.
      for (const [id, book] of Object.entries(local.books)) if (merged.books[id] && book.name === merged.books[id].name && Boolean(book.deleted) === Boolean(merged.books[id].deleted)) state.manifest.books[id] = merged.books[id];
      for (const song of snapshot.songs) if (readySongs[song.id]?.songbookId === song.songbookId && same(readySongs[song.id].origin, song.origin)) state.manifest.songs[song.id] = readySongs[song.id];
      if (manual) {
        const books = Object.values(merged.books).filter(b => !b.deleted && !local.books[b.id]?.deleted).map(({id, name}) => ({...snapshot.songbooks.find(b => b.id === id), id, name}));
        const deleted = snapshot.songbooks.filter(b => merged.books[b.id]?.deleted || !local.books[b.id] && !merged.books[b.id]).map(b => b.id);
        state.manifest = structuredClone(merged); await save({books, deleteBooks: deleted});
      }
      for (const book of Object.values(merged.books).filter(b => b.deleted && b.path)) {
        // Every deletion uses a fresh, fully paginated listing. Nonempty remnants are expected.
        for (const kind of ['Private', 'Shared', 'Import', 'Originals']) await step(() => files.removeEmpty(`${book.path}/${kind}`));
        await step(() => files.removeEmpty(book.path!));
      }
      complete &&= !state.conflicts.length && !snapshot.songs.some(song => privateSong(song) && !readySongs[song.id]);
      state.pending = !complete;
      if (complete) state.localGeneration = generation;
      if (manual && complete) state.lastManual = new Date().toISOString();
      await save(); return state;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Synkronisering feilet.'; state.pending = true;
      // A stale run must not acknowledge work or overwrite state belonging to a newer session.
      try {await save();} catch { /* The next safe run starts from durable progress. */ }
      throw error;
    }
  }
  return {run};
}
