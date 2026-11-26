import {parseChordPro} from '../domain/chordpro.ts';
import {reconcilePersonal} from '../domain/annotations.ts';
import type {Song, SongPersonal} from '../core/song.ts';
import {direction, hash, parsePersonal, personalData, same, songLocation} from './model.ts';
import type {FileValue, PersonalFile, SongLink, UploadIntent} from '../core/sync-model.ts';
import type {Conflict, Manifest} from './state.ts';
import {failureCodes, SyncFailure, RetrySync} from '../core/failure.ts';
import {pathKey} from './remote.ts';
import {checkSize, textBytes} from '../core/limits.ts';
import {originalFilename} from './filenames.ts';
import type {SyncSession} from './session.ts';
import {personalOf} from './local-work.ts';
import {bookPath, personalPath} from '../core/paths.ts';
function fromRemote(link: SongLink, text: string): Song {
  const parsed = parseChordPro(text, link.origin.filename.replace(/\.[^.]+$/, ''));
  return {
    id: link.id,
    songbookId: link.songbookId,
    origin: link.origin,
    original: text,
    title: parsed.title,
    key: parsed.key,
  };
}
function project(personal: SongPersonal, source: Song, target: Song) {
  return personalData(source.original === target.original ? personal : reconcilePersonal(source, target, personal));
}
async function personalFile(
  s: SyncSession,
  link: SongLink,
  content: FileValue,
  fresh: boolean,
): Promise<{file: PersonalFile; value: FileValue | null; original: string}> {
  const value = await s.read(personalPath(link.id));
  if (!value) {
    if (!fresh)
      throw new SyncFailure(
        {code: failureCodes.personal, stage: 'sync.personal'},
        'Personfilen for en kjent sang mangler.',
      );
    return {
      value: null,
      original: content.text,
      file: {
        version: 1,
        songId: link.id,
        original: {rev: content.rev, hash: await hash(content.text)},
        data: {songId: link.id, version: 3, chorus: {}},
      },
    };
  }
  const file = parsePersonal(value.text, link.id);
  let original = content.text;
  if ((await hash(content.text)) !== file.original.hash) {
    const previous = await s.read(`rev:${file.original.rev}`);
    if (!previous || (await hash(previous.text)) !== file.original.hash)
      throw new SyncFailure(
        {code: failureCodes.original, stage: 'sync.original'},
        'Persondataenes originalgrunnlag er utilgjengelig.',
      );
    original = previous.text;
  }
  return {value, file, original};
}
export async function prepareSong(
  s: SyncSession,
  link: SongLink,
  remoteKnown: boolean,
  manual: boolean,
  resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'},
) {
  const local = s.snapshot.songs.find(song => song.id === link.id),
    basis = s.state.bases[link.id];
  // A readable path without a confirmed ID may belong to another importer.
  // Only the durable creation journal can acknowledge a new physical file.
  const content = !link.fileId && local && !remoteKnown ? null : await s.read(link.fileId ?? link.path);
  if (!content && (remoteKnown || !local)) throw new RetrySync();
  const localPersonal = local && personalOf(s.snapshot, local.id);
  const remoteSong = content && fromRemote(link, content.text);
  const fresh = !remoteKnown;
  const person = content ? await personalFile(s, link, content, fresh) : null;
  // A newly discovered file has no sidecar yet; establish its default remote
  // layer so the existing conflict dialog can reference a concrete revision.
  const remotePersonal = person?.value ? personalData(person.file.data) : undefined;
  if (
    resolution &&
    (!content ||
      content.rev !== resolution.conflict.contentRev ||
      person?.value?.rev !== resolution.conflict.personalRev ||
      !same(local, resolution.conflict.local) ||
      !same(localPersonal, resolution.conflict.localPersonal))
  ) {
    // A dialog choice belongs to the displayed snapshots, never to a later revision.
    delete s.state.decisions[`${link.id}:content`];
    delete s.state.decisions[`${link.id}:personal`];
    resolution = undefined;
  }

  let contentChoice = direction(local?.original, content?.text, basis?.original, manual);
  let personChoice = direction(
    localPersonal,
    remotePersonal,
    basis?.personalRev ? basis.personal.data : undefined,
    manual,
  );
  if (resolution) {
    s.state.decisions[`${link.id}:${resolution.conflict.kind}`] = resolution;
    await s.save();
  }
  let contentDecision = s.state.decisions[`${link.id}:content`],
    personDecision = s.state.decisions[`${link.id}:personal`];
  for (const decision of [contentDecision, personDecision])
    if (
      decision &&
      (decision.conflict.contentRev !== content?.rev ||
        decision.conflict.personalRev !== person?.value?.rev ||
        !same(decision.conflict.local, local) ||
        !same(decision.conflict.localPersonal, localPersonal))
    ) {
      delete s.state.decisions[`${link.id}:${decision.conflict.kind}`];
      if (decision.conflict.kind === 'content') contentDecision = undefined!;
      else personDecision = undefined!;
    }
  if (contentDecision) contentChoice = contentDecision.choice === 'local' ? 'upload' : 'download';
  if (personDecision) personChoice = personDecision.choice === 'local' ? 'upload' : 'download';
  s.state.conflicts = s.state.conflicts.filter(c => c.songId !== link.id);
  const conflicts: Conflict[] = [];
  if (local && remoteSong && content && person?.value) {
    for (const kind of ['content', 'personal'] as const)
      if ((kind === 'content' ? contentChoice : personChoice) === 'conflict')
        conflicts.push({
          songId: link.id,
          kind,
          title: local.title,
          local,
          localPersonal: localPersonal!,
          remote: remoteSong,
          remotePersonal: remotePersonal!,
          remotePersonalOriginal: person.original,
          contentRev: content.rev,
          personalRev: person.value.rev,
          personalFile: person.file,
          generation: s.generation,
        });
  }
  if (conflicts.length) {
    s.state.conflicts.push(...conflicts);
    await s.save();
  }
  // A content choice must not silently dispose of a separate personal conflict.
  if (contentChoice === 'conflict' || personChoice === 'conflict') return false;
  const waitingRemote = contentChoice === 'remote' || personChoice === 'remote';
  if (waitingRemote) s.state.awaitingDownload = true;
  const chosenSong = contentChoice === 'download' || !local ? remoteSong! : {...local, songbookId: link.songbookId};
  const chosenPersonal =
    personChoice === 'download' || !local
      ? project(personalData(person!.file.data), {...remoteSong!, original: person!.original}, chosenSong)
      : project(localPersonal!, local, chosenSong);
  if (contentDecision?.choice === 'copy') {
    const copyId = s.state.reservations[`copy:${link.id}`]?.id ?? crypto.randomUUID();
    if (!s.snapshot.songs.some(song => song.id === copyId) && !s.removedIds.has(copyId)) {
      const copy: Song = {...local!, id: copyId, origin: {...local!.origin, kind: 'local'}};
      const copied = structuredClone(localPersonal!);
      copied.songId = copyId;
      for (const annotation of Object.values(copied.annotations ?? {})) annotation.anchor.songId = copyId;
      s.state.reservations[`copy:${link.id}`] = {
        id: copyId,
        songbookId: copy.songbookId,
        origin: copy.origin,
        path: '',
      };
      await s.save({songs: [copy], personal: [copied]});
      s.snapshot.songs.push(copy);
      s.snapshot.personal.push(copied);
    }
  }
  checkSize(textBytes(chosenSong.original));
  const personal: PersonalFile = {
    version: 1,
    songId: link.id,
    original: {rev: content?.rev ?? '', hash: await hash(chosenSong.original)},
    data: chosenPersonal,
  };
  const contentIntent: UploadIntent | undefined =
    contentChoice === 'upload'
      ? {
          key: `content:${link.id}`,
          songId: link.id,
          kind: 'content',
          path: content?.path ?? link.path,
          text: chosenSong.original,
          rev: content?.rev ?? null,
          ...(content ? {fileId: content.id} : {}),
          base: {original: chosenSong.original, personal, link: {...link}},
        }
      : undefined;
  return {
    link,
    local,
    basis,
    content,
    person,
    contentChoice,
    personChoice,
    chosenSong,
    chosenPersonal,
    waitingRemote,
    apply: manual || Boolean(contentDecision || personDecision),
    contentIntent,
  };
}
export type SongPlan = Exclude<Awaited<ReturnType<typeof prepareSong>>, false>;
export async function finishContent(s: SyncSession, plan: SongPlan) {
  const {link, chosenSong, chosenPersonal, basis, contentChoice, personChoice, person, local} = plan;
  const content = plan.content;
  if (!content)
    throw new SyncFailure(
      {code: failureCodes.missingFile, stage: 'sync.file'},
      'Ingen sangfilversjon er tilgjengelig.',
    );
  if (plan.contentIntent?.rev === null) link.path = content.path;
  link.path = content.path;
  link.fileId = content.id;
  s.state.reservations[link.id] = {...link};
  await s.save();
  const referenceRev = contentChoice === 'remote' ? basis!.contentRev : content.rev;
  const nextPerson: PersonalFile = {
    version: 1,
    songId: link.id,
    original: {rev: referenceRev, hash: await hash(chosenSong.original)},
    data: chosenPersonal,
  };
  const savedPerson =
    personChoice === 'remote' ? person!.value! : person?.value && same(nextPerson, person.file) ? person.value : null;
  const intents: UploadIntent[] = [];
  if (!savedPerson)
    intents.push({
      key: `personal:${link.id}`,
      songId: link.id,
      kind: 'personal',
      path: personalPath(link.id),
      text: JSON.stringify(nextPerson),
      rev: person?.value?.rev ?? null,
      ...(person?.value ? {fileId: person.value.id} : {}),
      base: {original: chosenSong.original, personal: nextPerson},
    });
  const sourceName = local && originalFilename(local);
  if (link.originalFile) {
    (s.state.originals ??= {})[link.id] = true;
    await s.uploads.discardOriginal(link.id);
  }
  if (
    local &&
    sourceName &&
    !link.originalFile &&
    !s.state.originals?.[link.id] &&
    !s.uploads.originalPending(link.id)
  ) {
    // Old generated copies are identified from their deterministic metadata
    // name; adopting their ID does not rename or rewrite the user's file.
    const stem =
      local.origin.filename
        .replace(/\.[^.]+$/, '')
        .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')
        .slice(0, 100) || 'Sang';
    const oldLeaf = `${stem}--${await hash(link.id)}.${local.origin.filename.split('.').at(-1)}`;
    const legacy = Object.values(s.state.remote?.entries ?? {}).filter(
      entry =>
        !entry.folder &&
        /\/Originals\//i.test(entry.path) &&
        pathKey(entry.path.split('/').at(-1)!) === pathKey(oldLeaf),
    );
    if (legacy.length === 1 && legacy[0].id) {
      link.originalFile = {fileId: legacy[0].id, path: legacy[0].path};
      s.state.reservations[link.id] = {...link};
      (s.state.originals ??= {})[link.id] = true;
    }
  }
  if (
    local &&
    sourceName &&
    !link.originalFile &&
    !s.state.originals?.[link.id] &&
    !s.uploads.originalPending(link.id)
  ) {
    const prefix = `${s.state.folders[link.songbookId].path}/Originals/`,
      prior = s.state.uploads?.[`original:${link.id}`]?.path;
    const path = prior && pathKey(prior).startsWith(pathKey(prefix)) ? prior : prefix + sourceName;
    intents.push({
      key: `original:${link.id}`,
      songId: link.id,
      kind: 'original',
      path,
      text: local.original,
      rev: null,
      base: {original: chosenSong.original, personal: nextPerson, link: {...link}},
    });
  }
  for (const intent of intents) checkSize(textBytes(intent.text));
  return {...plan, content, referenceRev, nextPerson, savedPerson, intents};
}
export function songDestination(s: SyncSession, link: SongLink, books: Manifest['books']) {
  const parent = s.state.folders[link.songbookId]?.path ?? bookPath(books[link.songbookId].name);
  const current = songLocation(s.index.find(link.fileId ?? link.path)?.path ?? link.path);
  // Only confirmed book transfers change Shared to Private. File edits within
  // the same book stay where Dropbox currently has the song.
  const area = current && pathKey(current.bookPath) === pathKey(parent) ? current.area : 'Private';
  return `${parent}/${area}`;
}
