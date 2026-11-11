import {confirmImportCopy, openDialog, dialogFrame, dialogFooter} from './dialog.ts';
import {actionButton, icon, rangeControl, switchControl} from './controls.ts';
import {navigation} from './navigation.ts';
import {currentPage, showPage, type Page} from './layout.ts';
import {createEditSession, type EditSession} from '../domain/edit-session.ts';
import {classifyImport} from '../domain/import.ts';
import {openOriginalEditor} from './original-editor.ts';
import {newSong} from '../domain/original.ts';
import {createPersonalEditor, paintAnnotations, iconButton} from './personal-editor.ts';
import {gripKey, transposeChord, transposeGrid} from '../domain/personal.ts';
import {attachSongSpacing} from './song-spacing.ts';
import {captureView, saveUpdateView, takeUpdateView, restoreUpdateView, focusUpdateView, type UpdateView} from './update-view.ts';
import {selectSongGrid} from '../domain/song-grid.ts';
import {createChartDock} from './chart-dock.ts';
import {attachDynamicsProfile} from './dynamics-profile.ts';
import {renderContent, type DynamicsContext} from './song-content.ts';
import {parseChordPro} from '../domain/chordpro.ts';
import {createSong, type Song, type SongPersonal} from '../domain/song.ts';
import {songStorage} from '../storage/songs.ts';
import {applyPreferences, defaultPreferences, readPreferences, savePreferences} from '../storage/preferences.ts';
import {readSongbookFilter, saveSongbookFilter} from '../storage/songbook-filter.ts';
import type {Songbook} from '../domain/songbook.ts';
import {choicePicker, contextMenu, floatingAction, metadataRow} from './list-controls.ts';

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
  let songbooks: Songbook[] = [], listPersonal = new Map<string, Pick<SongPersonal, 'songId' | 'capo' | 'tuning'>>();
  let selectedBook: string | null = null, libraryReady = false, readGeneration = 0;
  const filterStatus = query('filter-status');
  try {selectedBook = readSongbookFilter(__APP_ENV__.namespace);}
  catch {filterStatus.textContent = 'Sangbokvalget kunne ikke hentes. Viser alle sanger.';}
  let disposeView = () => {};
  let editing: UpdateView['editor'] | undefined;
  let editor: ReturnType<typeof createPersonalEditor> | undefined;
  let readerPersonal: SongPersonal | undefined;
  let session: EditSession | undefined;
  const personalState = () => session?.personal ?? readerPersonal!;
  let saving: Promise<boolean> | undefined;
  let originalModal: ReturnType<typeof openOriginalEditor> | undefined;
  const originalDirty = () => Boolean(session?.originalDirty());
  const dirty = () => Boolean(originalDirty() || editor?.dirty() || originalModal?.dirty());
  function showOriginal(first = false) {
    if (!active || !editor || originalModal) return;
    originalModal = openOriginalEditor(active, () => editor!.snapshot(), next => {
      originalModal = undefined;
      const y = scrollY;session!.replaceOriginal(next);
      void openSong(next, undefined, true).then(() => {window.scrollTo(0,y);query('edit-original').focus({preventScroll:true});});
    }, () => {
      originalModal = undefined;
      if (first) {editing = undefined;back();}
    }, query('edit-original'), session?.baselineSong ?? {...active,original:'',title:'',key:null});
  }
  const chorusWrites = new Set<Promise<unknown>>();
  const saveRetry = element('button', 'Prøv lagring igjen'); saveRetry.type = 'button'; saveRetry.hidden = true;
  status.after(saveRetry);
  async function flush(): Promise<boolean> {
    if (!editor?.isValid() || originalModal || !active) return false;
    if (saving) return saving;
    saving = (async () => {
      const submitting = session!, snapshot = submitting.snapshot(), update = submitting.pendingChange(), songSnapshot = snapshot.song, base = submitting.baselineSong;
      try {
        if (update || originalDirty()) await storage.saveDraft(songSnapshot, base, update);
        submitting.markSaved(snapshot);
        const index = songs.findIndex(song => song.id === songSnapshot.id);
        if (index < 0) songs.push(songSnapshot); else songs[index] = songSnapshot;
        listPersonal.set(songSnapshot.id, snapshot.personal);
        drawList();
        saveRetry.hidden = true;
        editor?.markSaved();
        notify('Endringene er lagret på denne enheten.'); return true;
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Kunne ikke lagre. Prøv igjen.', true);
        saveRetry.hidden = false; return false;
      }
    })();
    try {return await saving;} finally {saving = undefined;}
  }
  saveRetry.addEventListener('click', () => {void flush();});
  const editMenu = actionButton('Rediger',()=>{if(active)void beginEdit(active,'reader');},'rediger'); editMenu.id='edit-song'; editMenu.hidden=true;
  async function beginEdit(song: Song, from: 'reader' | 'library') {
    const returnView=captureView(from==='reader'?song.id:null,from==='reader'?'edit-song':null);returnView.menu.open=false;
    nav.close(false);editing={from,returnView};await openSong(song,from==='reader'?returnView:undefined);
    if (!document.body.classList.contains('editing-active')) editing = undefined;
  }
  let leaving = false;
  async function confirmLeave(): Promise<'save' | 'discard' | 'cancel'> {
    return new Promise(resolve => {
      const prompt=dialogFrame('Ulagrede endringer','leave-editor');
      prompt.append(element('h2','Ulagrede endringer'),element('p','Vil du lagre før du går ut?'));
      const finish=(value:'save'|'discard'|'cancel')=>{lifecycle.close();resolve(value);};
      const actions=dialogFooter([{id:'cancel',label:'Fortsett redigering',icon:'kryss',run:()=>finish('cancel')},{id:'discard',label:'Forkast endringer',run:()=>finish('discard')},{id:'save',label:'Lagre og gå ut',icon:'lagre',primary:true,run:()=>finish('save')}]);prompt.append(actions);
      const lifecycle=openDialog(prompt,{opener:document.activeElement as HTMLElement,focus:actions.querySelector('[data-action=cancel]') as HTMLElement,cancel:()=>finish('cancel')});
    });
  }
  async function settleDraft(): Promise<boolean> {
    if (saving) await saving;
    if (!dirty()) return true;
    const choice = await confirmLeave();
    return choice === 'discard' || choice === 'save' && await flush();
  }
  async function finishEdit() {
    if (!active || leaving || saving) return;
    leaving = true;
    try {
      if (!await settleDraft()) return;
      const song = session?.baselineSong ?? active, returnTo = editing; editing = undefined;
      editor?.dispose(); editor = undefined; saveRetry.hidden = true;
      if (returnTo?.from === 'reader') await openSong(song, returnTo.returnView);
      else {back();if(returnTo?.returnView)await restoreUpdateView(returnTo.returnView,()=>active===null);}
    } finally {leaving = false;}
  }
  let pendingUpdateView = takeUpdateView(__APP_ENV__.namespace);
  const originalScrollRestoration = history.scrollRestoration;
  const app = query('app');
  if (pendingUpdateView) {history.scrollRestoration = 'manual'; app.style.visibility = 'hidden';}
  let settingsReturn:UpdateView|undefined;
  const nav=navigation(page=>{void navigate(page);});
  const filter = actionButton('Alle', () => {
    const name = songbooks.find(book => book.id === selectedBook)?.name ?? 'Alle';
    choicePicker({opener: filter, name: 'Sangbok', value: name, selected: selectedBook,
      choices: [{id: null, name: 'Alle'}, ...[...songbooks].sort((a, b) => a.name.localeCompare(b.name, 'nb'))],
      choose: id => {
        selectedBook = id;
        try {saveSongbookFilter(__APP_ENV__.namespace, id); filterStatus.textContent = '';}
        catch {filterStatus.textContent = 'Filteret er endret, men sangbokvalget kunne ikke lagres til neste oppstart.';}
        drawList();
      }});
  }, 'filter');
  filter.id = 'songbook-filter'; filter.dataset.pageAction = 'library'; filter.disabled = true;
  filter.setAttribute('aria-haspopup', 'dialog'); filter.setAttribute('aria-expanded', 'false');
  const add = floatingAction('Legg til sang', () => {
    contextMenu(add, [
      {name: 'Opprett', icon: 'ny', run: () => {void beginNewSong();}},
      {name: 'Importer', icon: 'importer', run: () => file.click()},
    ]);
  });
  add.id = 'add-song'; add.disabled = true; add.setAttribute('aria-haspopup', 'menu'); add.setAttribute('aria-expanded', 'false');
  library.append(add);
  query('header-actions').append(filter,editMenu);
  query('back').replaceChildren(icon('tilbake'));
  let creating=false;
  async function beginNewSong(){
    if(creating||leaving)return;creating=true;nav.close(false);
    try{if(editing&&!await settleDraft())return;const song=newSong();session=createEditSession(song,{songId:song.id,chorus:{},version:3},null);editing={from:'library'};await openSong(song,undefined,true);showOriginal(true);}finally{creating=false;}
  }
  async function navigate(page:Page){
    if(leaving||creating)return;
    if(page==='settings'){
      if(currentPage()!=='settings')settingsReturn=captureView(active?.id??null,document.activeElement?.id??null,editing);
      showPage(page,Boolean(settingsReturn));editMenu.hidden=true;query('settings-heading').focus({preventScroll:true});window.scrollTo(0,0);return;
    }
    if(page===currentPage()){nav.close(false);return;}
    leaving=true;
    try{
      if(editing&&!await settleDraft())return;
      editing=undefined;settingsReturn=undefined;resetSong();showPage(page);editMenu.hidden=true;
      if(page==='library')void refreshLibrary();
      query(page==='library'?'library-title':`${page}-title`).focus({preventScroll:true});window.scrollTo(0,0);
    }finally{leaving=false;}
  }
  const notify = (message: string, error = false) => {status.textContent = message; status.dataset.error = String(error);};
  let preferences = {...defaultPreferences};
  try {preferences = readPreferences(__APP_ENV__.namespace);}
  catch {query('settings-status').textContent = 'Visningsvalg kunne ikke hentes. Endringer gjelder nå, men kan ikke loves husket.';}
  applyPreferences(preferences);
  const sizeControl=rangeControl({id:'font-size',outputId:'font-value',label:'Skriftstørrelse',unit:'px',min:16,max:36,step:1,value:preferences.fontSize,change:()=>updatePreferences()});
  const gridsControl=switchControl('show-grids','Vis akkordskjema',()=>updatePreferences());
  const dynamicsControl=switchControl('show-dynamics','Vis dynamikkprofil',()=>updatePreferences());
  const size=sizeControl.input,grids=gridsControl.input,dynamics=dynamicsControl.input;
  grids.checked=preferences.showGrids;dynamics.checked=preferences.showDynamics;
  query('display-controls').insertBefore(sizeControl.element,query('settings-status'));
  query('display-controls').insertBefore(gridsControl.element,query('settings-status'));
  query('display-controls').insertBefore(dynamicsControl.element,query('settings-status'));
  const updatePreferences=()=>{
    preferences={theme:'dark',fontSize:Number(size.value),showDynamics:dynamics.checked,showGrids:grids.checked};applyPreferences(preferences);
    try{savePreferences(__APP_ENV__.namespace,preferences);query('settings-status').textContent='';}
    catch{query('settings-status').textContent='Visningen er endret, men valget kunne ikke lagres til neste oppstart.';}
  };
  window.addEventListener('beforeunload', event => {if (dirty()) {event.preventDefault(); event.returnValue = '';}});
  function drawList() {
    list.replaceChildren();
    const bookName = songbooks.find(book => book.id === selectedBook)?.name ?? 'Alle';
    filter.querySelector('span')!.textContent = bookName; filter.setAttribute('aria-label', `Sangbok: ${bookName}`);
    songs.sort((a, b) => a.title.localeCompare(b.title, 'nb') || a.origin.importedAt.localeCompare(b.origin.importedAt));
    const visible = songs.filter(song => selectedBook === null || song.songbookId === selectedBook);
    for (const song of visible) {
      const parsed = parseChordPro(song.original, song.title), personal = listPersonal.get(song.id);
      const metadata = [...(parsed.key ? [parsed.key] : []), parsed.time];
      if (personal?.capo) {const key = gripKey(parsed.key, personal.capo); metadata.push(`Capo ${personal.capo}${key ? `: ${key}` : ''}`);}
      if (personal?.tuning) metadata.push(`Stemming: ${personal.tuning}`);
      const {row, button} = metadataRow(song.title, metadata, () => {void openSong(song);});
      button.dataset.songId = song.id; list.append(row);
    }
    libraryStatus.textContent = visible.length ? '' : songs.length ? `Ingen sanger i ${bookName}. Velg en annen sangbok, eller bruk Legg til sang for å opprette eller importere til Standard.` : 'Ingen sanger ennå. Bruk Legg til sang for å opprette eller importere din første sang.';
    libraryStatus.classList.toggle('empty-library', !visible.length);
  }
  async function refreshLibrary(): Promise<boolean> {
    const generation = ++readGeneration;
    retry.hidden = true;
    try {
      const snapshot = await storage.library();
      if (generation !== readGeneration) return false;
      songs = snapshot.songs; songbooks = snapshot.songbooks;
      listPersonal = new Map(snapshot.personal.map(state => [state.songId, state]));
      if (selectedBook && !songbooks.some(book => book.id === selectedBook)) selectedBook = null;
      libraryReady = true; filter.disabled = false; add.disabled = importing;
      drawList(); return true;
    } catch (error) {
      if (generation !== readGeneration) return false;
      libraryReady = false; filter.disabled = add.disabled = true; list.replaceChildren();
      libraryStatus.classList.remove('empty-library');
      libraryStatus.textContent = error instanceof Error ? error.message : 'Kunne ikke åpne sanglageret.'; retry.hidden = false;
      return false;
    }
  }
  async function load() {
    retry.hidden = true;
    const resume = pendingUpdateView; pendingUpdateView = null;
    try {
      if (!await refreshLibrary()) return;
      if (resume?.songId) {
        const song = songs.find(song => song.id === resume.songId);
        if (song) await openSong(song, resume);
      } else if (resume){settingsReturn=resume.settingsReturn;await restoreUpdateView(resume, () => active === null);}
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
  async function openSong(song: Song, resume?: UpdateView, draft = false) {
    notify('');
    if (resume?.editor) editing = resume.editor;
    if(resume?.settingsReturn)settingsReturn=resume.settingsReturn;
    let personal: SongPersonal;
    try {personal = draft && session ? session.personal : await storage.personal(song.id) ?? {songId: song.id, chorus: {},version:3};}
    catch (error) {notify(error instanceof Error ? error.message : 'Kunne ikke hente personlig tilstand.', true); return;}
    if (editing) {if (!draft || !session) session=createEditSession(song,personal);}
    else {session=undefined;readerPersonal=personal;}
    active = song;
    editMenu.hidden = Boolean(editing);
    document.body.classList.toggle('editing-active', Boolean(editing));
    if (resume) reader.style.visibility = 'hidden';
    const parsed = parseChordPro(song.original, song.title), article = query('song-content');
    disposeView(); editor?.dispose(); editor = undefined; article.replaceChildren();
    const title = element('h1', parsed.title); title.id = 'song-title'; title.tabIndex = -1; article.append(title);
    const metadata = element('div', undefined, 'song-metadata');
    if (parsed.key) {
      const key = element('span', parsed.key, 'song-key');
      key.setAttribute('aria-label', `Toneart: ${parsed.key}`);
      metadata.append(key);
    }
    const time = element('span', parsed.time, 'song-key'); time.setAttribute('aria-label', `Takt: ${parsed.time}`); metadata.append(time); article.append(metadata);
    const showMetadata = () => {
      const state = personalState();
      if (editing) {
        const capoPill = metadata.querySelector('#capo-pill');
        const key = gripKey(parsed.key, state.capo ?? 0);
        if (capoPill) capoPill.textContent = state.capo ? `Capo ${state.capo}${key ? `: ${key}` : ''}` : 'Uten capo';
        const tuningPill = metadata.querySelector('#tuning-pill'); if (tuningPill) tuningPill.textContent = state.tuning || 'Standard stemming';
      } else {
        if (state.capo) {const key = gripKey(parsed.key, state.capo); metadata.append(element('span', `Capo ${state.capo}${key ? `: ${key}` : ''}`, 'song-key'));}
        if (state.tuning) metadata.append(element('span', state.tuning, 'song-key'));
      }
      if (metadata.childElementCount && metadata.parentElement !== article) title.after(metadata);
    };
    let disposeDock = () => {};
    let chartReleased = Boolean(resume?.chartReleased);
    const chartArea = element('div'); chartArea.className = 'chart-area'; article.append(chartArea);
    const showChart = () => {
      disposeDock(); chartArea.replaceChildren();
      const state = personalState(), capo = state.capo ?? 0;
      const chosen = selectSongGrid(parsed, state);
      if (chosen) {
        const dock = createChartDock(chosen.grids.map(grid => transposeGrid(grid, capo)), chosen.source, {
          sticky: !editing && !chartReleased, interactive: !editing, change: sticky => {chartReleased = !sticky;},
        });
        if (editing) {
          const edit = actionButton('',undefined,'rediger'); edit.setAttribute('aria-label','Rediger akkordskjema'); edit.dataset.tooltip = 'Rediger akkordskjema'; edit.type = 'button'; edit.className = 'edit-chart';
          edit.addEventListener('click', event => {event.stopPropagation(); editor?.openGrid(dock.element);}); dock.element.append(edit);
        }
        chartArea.append(dock.element); disposeDock = dock.dispose;
      } else if (editing) {
        const add = element('button', 'Legg til akkordskjema', 'grid-placeholder'); add.type = 'button'; add.addEventListener('click', () => editor?.openGrid(add)); chartArea.append(add);
      }
    };
    if (editing) {
      let displayed = session!.personal;
      editor = createPersonalEditor(song, session!, () => {
        const previous = displayed;displayed = session!.personal;
        notify('');
        paintAnnotations(query('song-body'), song, displayed);
        showMetadata();
        if (previous.capo !== displayed.capo || previous.chordGrid !== displayed.chordGrid) {
          showChart();
          const capo = displayed.capo ?? 0;
          query('song-body').querySelectorAll<HTMLElement>('.chord[data-original]').forEach(node => node.textContent = transposeChord(node.dataset.original!,capo));
        }
      }, () => {void flush();});
      const originalButton=iconButton('Rediger sangtekst','text',()=>showOriginal());originalButton.id='edit-original';
      editor.element.append(originalButton);
      article.prepend(editor.element); editor.metadata(metadata);
    }
    showMetadata(); showChart();
    const capo = personal.capo ?? 0;
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
            if (session) session.update(current=>({...current,chorus:personal.chorus}));else readerPersonal=personal;
            expanded = !expanded; reflect();paintAnnotations(bodyContent,song,personalState());
            if (active?.id === song.id) notify('');
          }
          catch {if (active?.id === song.id) notify('Refrengvalget kunne ikke lagres. Prøv igjen; tidligere valg er beholdt.', true);}
          finally {button.disabled = false;}
        });
        heading.append(button); section.append(heading, body); bodyContent.append(section);
      } else bodyContent.append(renderContent([block], dynamicsContext));
    }
    paintAnnotations(bodyContent, song, personalState());
    if (editing?.annotation) {
      const selection = editing.annotation;
      const line = [...bodyContent.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')].find(line => line.dataset.occurrence === selection.occurrence);
      if (line) editor!.select(line, personalState(), selection);
    }
    if (editing) editor!.mount(bodyContent);
    showPage('reader');
    const disposeSpacing = attachSongSpacing(bodyContent);
    const disposeProfile = attachDynamicsProfile(bodyContent, parsed.hasDynamics);
    disposeView = () => {disposeSpacing(); disposeProfile(); disposeDock();};
    if (resume) await restoreUpdateView(resume, () => active?.id === song.id);
    else {title.focus({preventScroll: true}); window.scrollTo(0, 0);}
    reader.style.removeProperty('visibility');
  }
  function resetSong(){
    editMenu.hidden=true;document.body.classList.remove('editing-active');disposeView();disposeView=()=>{};editor?.dispose();editor=undefined;query('song-content').replaceChildren();session=undefined;readerPersonal=undefined;active=null;notify('');saveRetry.hidden=true;
  }
  function back(){
    if(currentPage()==='settings'&&settingsReturn){const view=settingsReturn;settingsReturn=undefined;void restoreUpdateView(view,()=>true).then(()=>{editMenu.hidden=Boolean(editing)||!active;focusUpdateView(view);});return;}
    if(editing){void finishEdit();return;}
    resetSong();showPage('library');void refreshLibrary();query('library-title').focus({preventScroll:true});window.scrollTo(0,0);
  }
  query('back').addEventListener('click',back);
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]; if (!selected || importing) return;
    importing = true; file.disabled = add.disabled = true; notify('Leser og lagrer sangen…');
    try {
      let bytes: ArrayBuffer;
      try {bytes = await selected.arrayBuffer();}
      catch {throw new Error('Filen kunne ikke leses. Velg filen på nytt og prøv igjen.');}
      const song = createSong(selected.name, new Uint8Array(bytes));
      const existing = await storage.list();
      if (classifyImport({filename:selected.name},existing)==='possible-copy' && !await confirmImportCopy(selected.name,add)) {notify('');return;}
      await storage.add(song);
      songs.push(song); drawList();
      await openSong(song);
      if (active?.id === song.id) notify('Sangen er lagret på denne enheten.');
    } catch (error) {notify(error instanceof Error ? error.message : 'Filen kunne ikke leses eller lagres. Prøv igjen.', true);}
    finally {importing = false; file.disabled = false; add.disabled = !libraryReady; file.value = '';}
  });
  showPage('library');
  void load();
  return {beforeUpdateReload: async (focusId: string | null) => {
    if (saving) await saving;
    if (dirty()) throw new Error('Du har ulagrede endringer. Bruk Lagre eller avslutt redigeringen før oppdatering.');
    await Promise.all(chorusWrites);
    saveUpdateView(__APP_ENV__.namespace, active?.id ?? null, focusId, editing ? {...editing, annotation: editor?.selection()} : undefined, settingsReturn);
  }};
}
