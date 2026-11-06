import {parseChordPro, type Content} from '../domain/chordpro.ts';
import {createSong, type Song, type SongPersonal} from '../domain/song.ts';
import {songStorage} from '../storage/songs.ts';
import {applyPreferences, defaultPreferences, readPreferences, savePreferences} from '../storage/preferences.ts';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function renderContent(content: Content[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of content) {
    if (block.kind !== 'line') {fragment.append(element('p', block.text, block.kind)); continue;}
    const line = element('div', undefined, 'song-line');
    const hasChords = block.segments.some(segment => segment.chord);
    if (hasChords) line.classList.add('has-chords');
    for (const segment of block.segments) {
      const words = segment.text.split(/(\s+)/).filter(Boolean);
      if (!words.length) words.push('');
      words.forEach((word, index) => {
        const piece = element('span', undefined, 'piece');
        if (hasChords) piece.append(element('span', index === 0 ? segment.chord ?? '' : '', 'chord'));
        piece.append(element('span', word || '\u00a0', 'lyric')); line.append(piece);
      });
    }
    if (!line.textContent) line.append(document.createTextNode('\u00a0'));
    fragment.append(line);
  }
  return fragment;
}
export function startSongbook() {
  const query = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const storage = songStorage(__APP_ENV__.namespace);
  const library = query('library'), reader = query('reader'), list = query('song-list');
  const status = query('song-status'), libraryStatus = query('library-status');
  const retry = query<HTMLButtonElement>('retry-storage'), file = query<HTMLInputElement>('song-file');
  let songs: Song[] = [], importing = false, active: Song | null = null;
  let preferences = {...defaultPreferences};
  try {preferences = readPreferences(__APP_ENV__.namespace);}
  catch {query('settings-status').textContent = 'Visningsvalg kunne ikke hentes. Endringer gjelder nå, men kan ikke loves husket.';}
  applyPreferences(preferences);
  const theme = query<HTMLSelectElement>('theme'), size = query<HTMLInputElement>('font-size');
  theme.value = preferences.theme; size.value = String(preferences.fontSize);
  const updatePreferences = () => {
    preferences = {theme: theme.value === 'light' ? 'light' : 'dark', fontSize: Number(size.value)};
    applyPreferences(preferences); query('font-value').textContent = `${preferences.fontSize} px`;
    try {savePreferences(__APP_ENV__.namespace, preferences); query('settings-status').textContent = '';}
    catch {query('settings-status').textContent = 'Visningen er endret, men valget kunne ikke lagres til neste oppstart.';}
  };
  query('font-value').textContent = `${preferences.fontSize} px`;
  theme.addEventListener('change', updatePreferences); size.addEventListener('input', updatePreferences);
  function drawList() {
    list.replaceChildren();
    songs.sort((a, b) => a.title.localeCompare(b.title, 'nb') || a.origin.importedAt.localeCompare(b.origin.importedAt));
    for (const [index, song] of songs.entries()) {
      const button = element('button', undefined, 'song-choice'); button.type = 'button'; button.dataset.songId = song.id;
      button.append(element('span', song.title, 'song-name'));
      button.append(element('small', `${song.origin.filename} · ${index + 1}${song.key ? ` · ${song.key}` : ''}`));
      button.addEventListener('click', () => {void openSong(song);});
      const row = element('li'); row.append(button); list.append(row);
    }
    libraryStatus.textContent = songs.length ? `${songs.length} ${songs.length === 1 ? 'sang lagret' : 'sanger lagret'} på denne enheten.` : 'Ingen sanger ennå. Legg til din første sang fra en fil.';
  }
  async function load() {
    retry.hidden = true;
    try {songs = await storage.list(); drawList();}
    catch (error) {libraryStatus.textContent = error instanceof Error ? error.message : 'Kunne ikke åpne sanglageret.'; retry.hidden = false;}
  }
  retry.addEventListener('click', () => {void load();});
  async function openSong(song: Song) {
    status.textContent = '';
    let personal: SongPersonal;
    try {personal = await storage.personal(song.id) ?? {songId: song.id, chorus: {}};}
    catch (error) {status.textContent = error instanceof Error ? error.message : 'Kunne ikke hente personlig tilstand.'; return;}
    active = song;
    const parsed = parseChordPro(song.original, song.title), article = query('song-content');
    article.replaceChildren();
    const title = element('h1', parsed.title); title.id = 'song-title'; title.tabIndex = -1; article.append(title);
    if (parsed.key) article.append(element('p', `Klingende toneart: ${parsed.key}`, 'song-key'));
    for (const block of parsed.blocks) {
      if (block.kind === 'chorus') {
        const section = element('section', undefined, 'chorus'); section.append(element('h2', 'Refreng'), renderContent(block.content)); article.append(section);
      } else if (block.kind === 'reference') {
        if (!block.content) {article.append(element('p', 'Refreng — ingen tidligere refrengtekst er definert.', 'comment')); continue;}
        const section = element('section', undefined, 'chorus reference');
        const heading = element('h2'), button = element('button', 'Refreng'); button.type = 'button';
        button.setAttribute('aria-label', 'Refreng');
        const body = element('div'); body.id = `chorus-${block.occurrence.replace(':', '-')}`;
        body.append(renderContent(block.content));
        let expanded = personal.chorus[block.occurrence] === true;
        const reflect = () => {button.setAttribute('aria-expanded', String(expanded)); body.hidden = !expanded;};
        button.setAttribute('aria-controls', body.id); reflect();
        button.addEventListener('click', async () => {
          button.disabled = true;
          const next = {...personal, chorus: {...personal.chorus, [block.occurrence]: !expanded}};
          try {await storage.savePersonal(next); personal = next; expanded = !expanded; reflect(); if (active?.id === song.id) status.textContent = '';}
          catch {if (active?.id === song.id) status.textContent = 'Refrengvalget kunne ikke lagres. Prøv igjen; tidligere valg er beholdt.';}
          finally {button.disabled = false;}
        });
        heading.append(button); section.append(heading, body); article.append(section);
      } else article.append(renderContent([block]));
    }
    library.hidden = true; reader.hidden = false;
    title.focus({preventScroll: true}); window.scrollTo(0, 0);
  }
  function back() {
    active = null; reader.hidden = true; library.hidden = false; status.textContent = '';
    query('library-title').focus({preventScroll: true}); window.scrollTo(0, 0);
  }
  query('back').addEventListener('click', back);
  document.querySelector('.wordmark')!.addEventListener('click', event => {event.preventDefault(); back();});
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]; if (!selected || importing) return;
    importing = true; file.disabled = true; status.textContent = 'Leser og lagrer sangen…';
    try {
      let bytes: ArrayBuffer;
      try {bytes = await selected.arrayBuffer();}
      catch {throw new Error('Filen kunne ikke leses. Velg filen på nytt og prøv igjen.');}
      const song = createSong(selected.name, new Uint8Array(bytes));
      await storage.add(song);
      songs.push(song); drawList();
      await openSong(song);
      if (active?.id === song.id) status.textContent = 'Sangen er lagret på denne enheten.';
    } catch (error) {status.textContent = error instanceof Error ? error.message : 'Filen kunne ikke leses eller lagres. Prøv igjen.';}
    finally {importing = false; file.disabled = false; file.value = '';}
  });
  void load();
}
