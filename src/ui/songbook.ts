import {createPersonalEditor, paintAnnotations, selectedLyricRange, type PersonalChange} from './personal-editor.ts';
import {gripKey, transposeChord, transposeGrid} from '../domain/personal.ts';
import {attachSongSpacing} from './song-spacing.ts';
import {saveUpdateView, takeUpdateView, restoreUpdateView, focusUpdateView, type UpdateView} from './update-view.ts';
import {selectSongGrid} from '../domain/song-grid.ts';
import {createChartDock} from './chart-dock.ts';
import {attachDynamicsProfile} from './dynamics-profile.ts';
import {renderContent, type DynamicsContext} from './song-content.ts';
import {parseChordPro} from '../domain/chordpro.ts';
import {createSong, type Song, type SongPersonal} from '../domain/song.ts';
import {songStorage} from '../storage/songs.ts';
import {applyPreferences, defaultPreferences, readPreferences, savePreferences} from '../storage/preferences.ts';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export function startSongbook() {
  const query = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const storage = songStorage(__APP_ENV__.namespace);
  const library = query('library'), reader = query('reader'), list = query('song-list');
  const status = query('song-status'), libraryStatus = query('library-status');
  const retry = query<HTMLButtonElement>('retry-storage'), file = query<HTMLInputElement>('song-file');
  let songs: Song[] = [], importing = false, active: Song | null = null;
  let disposeView = () => {};
  let editing: UpdateView['editor'] | undefined;
  let editor: ReturnType<typeof createPersonalEditor> | undefined;
  let currentPersonal: SongPersonal | undefined;
  const writes: {songId: string; change: PersonalChange}[] = [];
  let saving: Promise<boolean> | undefined;
  const chorusWrites = new Set<Promise<unknown>>();
  const saveRetry = element('button', 'Prøv lagring igjen'); saveRetry.type = 'button'; saveRetry.hidden = true;
  status.after(saveRetry);
  async function flush(): Promise<boolean> {
    if (saving) return saving;
    saving = (async () => {
      while (writes.length) {
        const write = writes[0];
        try {await storage.updatePersonal(write.songId, write.change); writes.shift();}
        catch (error) {notify(error instanceof Error ? error.message : 'Kunne ikke lagre. Prøv igjen.', true); saveRetry.hidden = false; return false;}
      }
      saveRetry.hidden = true; notify('Personlige endringer er lagret på denne enheten.'); return true;
    })();
    try {return await saving;} finally {saving = undefined;}
  }
  saveRetry.addEventListener('click', () => {void flush();});
  const editMenu = element('button', 'Rediger'); editMenu.type = 'button'; editMenu.id = 'edit-song'; editMenu.hidden = true;
  async function beginEdit(song: Song, from: 'reader' | 'library') {
    let returnView: UpdateView | undefined;
    if (from === 'reader') {saveUpdateView(__APP_ENV__.namespace, song.id, 'menu-button'); returnView = takeUpdateView(__APP_ENV__.namespace) ?? undefined; if (returnView) returnView.menu.open = false;}
    dialog.close(); editing = {from, returnView}; await openSong(song);
    if (!document.body.classList.contains('editing-active')) editing = undefined;
  }
  async function finishEdit() {
    if (!active || !editor?.isValid() || !await flush()) return;
    const song = active, returnTo = editing; editing = undefined; editor = undefined;
    if (returnTo?.from === 'reader') await openSong(song, returnTo.returnView);
    else back();
  }
  editMenu.addEventListener('click', () => {if (active) void beginEdit(active, 'reader');});
  let pendingUpdateView = takeUpdateView(__APP_ENV__.namespace);
  const originalScrollRestoration = history.scrollRestoration;
  const app = query('app');
  if (pendingUpdateView) {history.scrollRestoration = 'manual'; app.style.visibility = 'hidden';}
  const dialog = query<HTMLDialogElement>('settings-dialog'), menu = query<HTMLButtonElement>('menu-button');
  dialog.querySelector('.menu-heading')!.after(editMenu);
  menu.addEventListener('click', () => dialog.showModal());
  query('menu-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => menu.focus({preventScroll: true}));
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  const notify = (message: string, error = false) => {status.textContent = message; status.dataset.error = String(error);};
  let preferences = {...defaultPreferences};
  try {preferences = readPreferences(__APP_ENV__.namespace);}
  catch {query('settings-status').textContent = 'Visningsvalg kunne ikke hentes. Endringer gjelder nå, men kan ikke loves husket.';}
  applyPreferences(preferences);
  const theme = query<HTMLSelectElement>('theme'), size = query<HTMLInputElement>('font-size');
  const dynamics = query<HTMLInputElement>('show-dynamics'), grids = query<HTMLInputElement>('show-grids');
  dynamics.checked = preferences.showDynamics; grids.checked = preferences.showGrids;
  theme.value = preferences.theme; size.value = String(preferences.fontSize);
  const updatePreferences = () => {
    preferences = {theme: theme.value === 'light' ? 'light' : 'dark', fontSize: Number(size.value), showDynamics: dynamics.checked, showGrids: grids.checked};
    applyPreferences(preferences); query('font-value').textContent = `${preferences.fontSize} px`;
    try {savePreferences(__APP_ENV__.namespace, preferences); query('settings-status').textContent = '';}
    catch {query('settings-status').textContent = 'Visningen er endret, men valget kunne ikke lagres til neste oppstart.';}
  };
  query('font-value').textContent = `${preferences.fontSize} px`;
  dynamics.addEventListener('change', updatePreferences); grids.addEventListener('change', updatePreferences);
  theme.addEventListener('change', updatePreferences); size.addEventListener('input', updatePreferences);
  function drawList() {
    list.replaceChildren();
    songs.sort((a, b) => a.title.localeCompare(b.title, 'nb') || a.origin.importedAt.localeCompare(b.origin.importedAt));
    for (const [index, song] of songs.entries()) {
      const button = element('button', undefined, 'song-choice'); button.type = 'button'; button.dataset.songId = song.id;
      button.append(element('span', song.title, 'song-name'));
      button.append(element('small', `${song.origin.filename} · ${index + 1}${song.key ? ` · ${song.key}` : ''}`));
      button.addEventListener('click', () => {void openSong(song);});
      const row = element('li'); row.append(button);
      const actions = element('details', undefined, 'song-actions'), summary = element('summary', '⋮'); summary.setAttribute('aria-label', `Meny for ${song.title}`);
      const edit = element('button', 'Rediger'); edit.type = 'button'; edit.addEventListener('click', () => {actions.open = false; void beginEdit(song, 'library');});
      actions.append(summary, edit); row.append(actions); list.append(row);
    }
    libraryStatus.textContent = songs.length ? `${songs.length} ${songs.length === 1 ? 'sang lagret' : 'sanger lagret'} på denne enheten.` : 'Ingen sanger ennå. Legg til din første sang fra en fil.';
  }
  async function load() {
    retry.hidden = true;
    const resume = pendingUpdateView; pendingUpdateView = null;
    try {
      songs = await storage.list(); drawList();
      if (resume?.songId) {
        const song = songs.find(song => song.id === resume.songId);
        if (song) await openSong(song, resume);
      } else if (resume) await restoreUpdateView(resume, () => active === null);
    } catch (error) {
      libraryStatus.textContent = error instanceof Error ? error.message : 'Kunne ikke åpne sanglageret.'; retry.hidden = false;
    } finally {
      if (resume) {
        app.style.removeProperty('visibility'); history.scrollRestoration = originalScrollRestoration;
        focusUpdateView(active || !resume.songId ? resume : {...resume, songId: null});
      }
    }
  }
  retry.addEventListener('click', () => {void load();});
  async function openSong(song: Song, resume?: UpdateView) {
    notify('');
    let personal: SongPersonal;
    try {personal = await storage.personal(song.id) ?? {songId: song.id, chorus: {}};}
    catch (error) {notify(error instanceof Error ? error.message : 'Kunne ikke hente personlig tilstand.', true); return;}
    active = song; currentPersonal = personal;
    if (resume?.editor) editing = resume.editor;
    editMenu.hidden = Boolean(editing);
    document.body.classList.toggle('editing-active', Boolean(editing));
    const parsed = parseChordPro(song.original, song.title), article = query('song-content');
    disposeView(); article.replaceChildren();
    const title = element('h1', parsed.title); title.id = 'song-title'; title.tabIndex = -1; article.append(title);
    if (parsed.key) {
      const metadata = element('div', undefined, 'song-metadata');
      const key = element('span', parsed.key, 'song-key');
      key.setAttribute('aria-label', `Toneart: ${parsed.key}`);
      metadata.append(key); article.append(metadata);
    }
    if (personal.capo != null || personal.tuning) {
      const metadata = article.querySelector('.song-metadata') ?? element('div', undefined, 'song-metadata');
      if (personal.capo != null) {const key = gripKey(parsed.key, personal.capo); metadata.append(element('span', `Capo ${personal.capo}${key ? `: ${key}` : ''}`, 'song-key'));}
      if (personal.tuning) metadata.append(element('span', personal.tuning, 'song-key'));
      article.append(metadata);
    }
    if (editing) {
      editor = createPersonalEditor(song, personal, change => {
        currentPersonal = change(currentPersonal!);
        writes.push({songId: song.id, change}); notify('Lagrer personlige endringer…'); void flush();
        paintAnnotations(query('song-body'), song, currentPersonal);
      }, () => {void finishEdit();});
      article.prepend(editor.element);
    }
    const capo = personal.chordView === 'grips' ? personal.capo ?? 0 : 0;
    const chosenGrid = selectSongGrid(parsed, personal);
    const dock = chosenGrid ? createChartDock(chosenGrid.grids.map(grid => transposeGrid(grid, capo)), chosenGrid.source, () => query('back').focus({preventScroll:true}), !resume?.chartReleased) : null;
    if (dock) article.append(dock.element);
    const bodyContent = element('div'); bodyContent.id = 'song-body'; article.append(bodyContent);
    const dynamicsContext: DynamicsContext = {level: 3, chord: value => transposeChord(value, capo)};
    for (const block of parsed.blocks) {
      dynamicsContext.occurrence = block.kind === 'reference' ? block.occurrence : 'source';
      if (block.kind === 'chorus') {
        const section = element('section', undefined, 'chorus');
        const body = element('div', undefined, 'chorus-text'); body.append(renderContent(block.content, dynamicsContext));
        section.append(element('h2', 'Refreng'), body); bodyContent.append(section);
      } else if (block.kind === 'reference') {
        if (!block.content) {bodyContent.append(element('p', 'Refreng — ingen tidligere refrengtekst er definert.', 'comment')); continue;}
        const section = element('section', undefined, 'chorus reference');
        const heading = element('h2'), button = element('button', 'Refreng'); button.type = 'button';
        button.setAttribute('aria-label', 'Refreng');
        const body = element('div', undefined, 'chorus-text'); body.id = `chorus-${block.occurrence.replace(':', '-')}`;
        body.append(renderContent(block.content, dynamicsContext));
        dynamicsContext.spokenLevel = undefined; // The following content stays accessible when this body is collapsed.
        let expanded = personal.chorus[block.occurrence] === true;
        const reflect = () => {button.setAttribute('aria-expanded', String(expanded)); body.hidden = !expanded;};
        button.setAttribute('aria-controls', body.id); reflect();
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const write = storage.updatePersonal(song.id, current => ({...current, chorus: {...current.chorus, [block.occurrence]: !expanded}}));
            chorusWrites.add(write);
            try {personal = await write;} finally {chorusWrites.delete(write);}
            if (currentPersonal) currentPersonal.chorus = personal.chorus;
            expanded = !expanded; reflect();
            if (active?.id === song.id) notify('');
          }
          catch {if (active?.id === song.id) notify('Refrengvalget kunne ikke lagres. Prøv igjen; tidligere valg er beholdt.', true);}
          finally {button.disabled = false;}
        });
        heading.append(button); section.append(heading, body); bodyContent.append(section);
      } else bodyContent.append(renderContent([block], dynamicsContext));
    }
    paintAnnotations(bodyContent, song, currentPersonal!);
    if (editing?.annotation) {
      const selection = editing.annotation;
      const line = [...bodyContent.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')].find(line => line.dataset.occurrence === selection.occurrence);
      if (line) editor!.select(line, currentPersonal!, selection);
    }
    if (editing) {
      for (const line of bodyContent.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')) {
        const select = element('button', 'Notat / markering'); select.type = 'button'; select.className = 'annotate-line';
        select.addEventListener('click', () => {editor!.select(line, currentPersonal!); editor!.element.querySelector('.annotation-editor')!.scrollIntoView({block:'center'});}); line.append(select);
      }
      const selectText = (event: Event) => {
        const line = (event.target as Element).closest<HTMLElement>('.song-line');
        if (line) {const range = selectedLyricRange(line); if (range) editor!.select(line, currentPersonal!, range);}
      };
      bodyContent.addEventListener('pointerup', selectText); bodyContent.addEventListener('keyup', selectText);
    }
    library.hidden = true; reader.hidden = false; query('back').hidden = false; document.body.classList.add('reader-active');
    const disposeSpacing = attachSongSpacing(bodyContent);
    const disposeProfile = attachDynamicsProfile(bodyContent);
    disposeView = () => {disposeSpacing(); disposeProfile(); dock?.dispose();};
    if (resume) await restoreUpdateView(resume, () => active?.id === song.id);
    else {title.focus({preventScroll: true}); window.scrollTo(0, 0);}
  }
  function back() {
    if (editing) {void finishEdit(); return;}
    if (writes.length) {void flush().then(ok => {if (ok) back();}); return;}
    editMenu.hidden = true; document.body.classList.remove('editing-active');
    disposeView(); disposeView = () => {};
    query('song-content').replaceChildren();
    active = null; reader.hidden = true; library.hidden = false; query('back').hidden = true; document.body.classList.remove('reader-active'); notify('');
    query('library-title').focus({preventScroll: true}); window.scrollTo(0, 0);
  }
  query('back').addEventListener('click', back);
  document.querySelector('.wordmark')!.addEventListener('click', event => {event.preventDefault(); back();});
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]; if (!selected || importing) return;
    importing = true; file.disabled = true; notify('Leser og lagrer sangen…');
    try {
      let bytes: ArrayBuffer;
      try {bytes = await selected.arrayBuffer();}
      catch {throw new Error('Filen kunne ikke leses. Velg filen på nytt og prøv igjen.');}
      const song = createSong(selected.name, new Uint8Array(bytes));
      await storage.add(song);
      songs.push(song); drawList();
      await openSong(song);
      if (active?.id === song.id) notify('Sangen er lagret på denne enheten.');
    } catch (error) {notify(error instanceof Error ? error.message : 'Filen kunne ikke leses eller lagres. Prøv igjen.', true);}
    finally {importing = false; file.disabled = false; file.value = '';}
  });
  void load();
  return {beforeUpdateReload: async (focusId: string | null) => {
    if (editor && editing && !editor.isValid()) throw new Error('Rett eller fjern ugyldige utkast før oppdatering.');
    await Promise.all(chorusWrites);
    if (writes.length && !await flush()) throw new Error('Endringene kunne ikke lagres. Prøv lagring igjen før oppdatering.');
    saveUpdateView(__APP_ENV__.namespace, active?.id ?? null, focusId, editing ? {...editing, annotation: editor?.selection()} : undefined);
  }};
}
