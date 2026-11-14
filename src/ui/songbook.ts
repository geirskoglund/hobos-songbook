import {confirmImportCopy, openDialog, dialogFrame, dialogFooter} from './dialog.ts';
import {actionButton, icon, rangeControl, switchControl} from './controls.ts';
import {navigation} from './navigation.ts';
import {currentPage, showPage, type Page} from './layout.ts';
import {createEditSession, type EditSession} from '../domain/edit-session.ts';
import {classifyImport} from '../domain/import.ts';
import {openRawEditor} from './original-editor.ts';
import {newSong} from '../domain/original.ts';
import {createSongEditor} from './song-editor.ts';
import {paintAnnotations,attachAnnotationGeometry} from './annotations.ts';
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
import {MissingSongbookError, suggestedSongbook, type Songbook} from '../domain/songbook.ts';
import type {LibrarySnapshot} from '../storage/songs.ts';
import {choicePicker, contextMenu, floatingAction, metadataRow} from './list-controls.ts';
import {startSetlists} from './setlists.ts';
import {startSongbooks} from './songbooks.ts';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export function startSongbook() {
  const query = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const storage = songStorage(__APP_ENV__.namespace);
  const setlists = startSetlists(storage);
  const library = query('library'), reader = query('reader'), list = query('song-list');
  const status = query('song-status'), libraryStatus = query('library-status');
  const retry = query<HTMLButtonElement>('retry-storage'), file = query<HTMLInputElement>('song-file');
  let songs: Song[] = [], importing = false, active: Song | null = null;
  let songbooks: Songbook[] = [], listPersonal = new Map<string, Pick<SongPersonal, 'songId' | 'capo' | 'tuning'>>();
  let selectedBook: string | null = null, libraryReady = false, readGeneration = 0;
  let lastUsedBook: string | null = null, importBook: string | null = null;
  const filterStatus = query('filter-status');
  try {selectedBook = readSongbookFilter(__APP_ENV__.namespace);}
  catch {filterStatus.textContent = 'Sangbokvalget kunne ikke hentes. Viser alle sanger.';}
  const bookManager = startSongbooks(storage, {changed: acceptLibrary, openBook: id => {
    selectFilter(id); void navigate('library');
  }});
  let disposeView = () => {};
  let editing: UpdateView['editor'] | undefined;
  let editor: ReturnType<typeof createSongEditor> | undefined;
  let readerPersonal: SongPersonal | undefined;
  let session: EditSession | undefined;
  const personalState = () => session?.personal ?? readerPersonal!;
  let saving: Promise<boolean> | undefined;
  let originalModal: ReturnType<typeof openRawEditor> | undefined;
  const dirty = () => Boolean(session?.dirty() || editor?.dirty() || originalModal?.dirty());
  let renderFrame=0,visualPersonal='';
  let chartReleasedState=false;
  function redraw(){
    if(renderFrame)return;
    renderFrame=requestAnimationFrame(()=>{renderFrame=0;if(!active||!session)return;const view=captureView(active.id,null);view.chartReleased=chartReleasedState;void openSong(session.song,view,true);});
  }
  function changed(source=false){
    const state=session!.personal,key=JSON.stringify([state.capo,state.chordGrid]);
    const tuning=reader.querySelector('.song-tuning');if(tuning)tuning.textContent=state.tuning||'Standard stemming';
    if(source||visualPersonal!==key){visualPersonal=key;redraw();}else editor?.refresh();
    void flush();
  }
  function showOriginal(first=false){
    if(!active||!editor||originalModal?.isOpen())return;
    editor.unmount();
    originalModal=openRawEditor(session!,async()=>{
      const ok=await flush(true);if(ok){const view=captureView(active!.id,null);view.chartReleased=chartReleasedState;await openSong(session!.song,view,true);}return ok;
    },()=>{originalModal=undefined;if(first){editing=undefined;resetSong();showPage('library');void refreshLibrary();}else if(active&&session)redraw();},editor.element.querySelector<HTMLElement>('[data-editor-tool=raw]')!);
  }
  const chorusWrites = new Set<Promise<unknown>>();
  const saveRetry = element('button', 'Prøv lagring igjen'); saveRetry.type = 'button'; saveRetry.hidden = true;
  const errorBar=element('div',undefined,'song-error');status.before(errorBar);errorBar.append(status,saveRetry);
  async function flush(rawCommit=false):Promise<boolean>{
    if(!session||!active||originalModal?.isOpen()&&!rawCommit)return false;
    if(saving)return saving;
    const submitting=session;
    saving=(async()=>{
      try{
        while(submitting.dirty()){
          const snapshot=submitting.snapshot(),update=submitting.pendingChange();
          try {await storage.saveDraft(snapshot.song,submitting.baselineSong,update);}
          catch (cause) {
            if (!(cause instanceof MissingSongbookError) || submitting.baselineSong) throw cause;
            if (!await refreshLibrary()) throw cause;
            const id = await new Promise<string | null>(resolve => bookManager.chooseTarget('Velg sangbok', originalModal?.isOpen() ? query('original-text') : saveRetry,
              suggestedSongbook(songbooks, lastUsedBook, selectedBook), resolve, () => resolve(null)));
            if (!id) throw cause;
            submitting.assignNewSongbook(id); continue;
          }
          if (!submitting.baselineSong) lastUsedBook = snapshot.song.songbookId;
          submitting.markSaved(snapshot);
          const index=songs.findIndex(song=>song.id===snapshot.song.id);
          if(index<0)songs.push(snapshot.song);else songs[index]=snapshot.song;
          listPersonal.set(snapshot.song.id,snapshot.personal);drawList();
        }
        saveRetry.hidden=true;editor?.markSaved();notify('');return true;
      }catch(error){notify(error instanceof Error?error.message:'Kunne ikke lagre. Prøv igjen.',true);saveRetry.hidden=false;return false;}
    })();
    try{return await saving;}finally{saving=undefined;}
  }
  saveRetry.addEventListener('click', () => {void flush();});
  let switchingMode=false;
  const editMenu=actionButton('Rediger',()=>{if(!active||switchingMode)return;switchingMode=true;editMenu.disabled=true;void(editing?finishEdit():beginEdit(active,'reader')).finally(()=>{switchingMode=false;editMenu.disabled=false;});},'rediger'); editMenu.id='edit-song'; editMenu.hidden=true;
  async function beginEdit(song: Song, from: 'reader' | 'library') {
    const returnView=captureView(from==='reader'?song.id:null,from==='reader'?'edit-song':null);returnView.menu.open=false;
    nav.close(false);editing={from,returnView};await openSong(song,from==='reader'?returnView:undefined,true);
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
    if(saving)await saving;
    if(session?.dirty()&&!originalModal?.isOpen()&&!editor?.dirty())await flush();
    if(!dirty())return true;
    const choice = await confirmLeave();
    return choice === 'discard' || choice === 'save' && await flush();
  }
  async function finishEdit(){
    if(!active||leaving)return;leaving=true;
    try{
      if(session?.dirty()&&!await flush())return;
      const view=captureView(active.id,'edit-song');view.chartReleased=chartReleasedState;delete view.editor;editing=undefined;
      await openSong(session!.song,view,true);
    }finally{leaving=false;}
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
      choose: selectFilter});
  }, 'sangbok');
  filter.id = 'songbook-filter'; filter.dataset.pageAction = 'library'; filter.disabled = true;
  filter.setAttribute('aria-haspopup', 'dialog'); filter.setAttribute('aria-expanded', 'false');
  const add = floatingAction('Legg til sang', () => {
    contextMenu(add, [
      {name: 'Opprett', icon: 'ny', run: () => {void beginSongChoice('Opprett sang');}},
      {name: 'Importer', icon: 'importer', run: () => {void beginSongChoice('Importer sang');}},
    ]);
  });
  add.id = 'add-song'; add.disabled = true; add.setAttribute('aria-haspopup', 'menu'); add.setAttribute('aria-expanded', 'false');
  library.append(add);
  query('header-actions').append(filter,editMenu);
  query('back').replaceChildren(icon('tilbake'));
  let creating=false;
  async function beginSongChoice(title: 'Opprett sang' | 'Importer sang') {
    if (creating || leaving || importing) return;
    if (!await refreshLibrary()) return;
    bookManager.chooseTarget(title, add, suggestedSongbook(songbooks, lastUsedBook, selectedBook), id => {
      if (title === 'Opprett sang') void beginNewSong(id);
      else {importBook = id; file.click();}
    });
  }
  async function beginNewSong(songbookId: string){
    if(creating||leaving)return;creating=true;nav.close(false);
    try{if(session&&!await settleDraft())return;const song=newSong(songbookId);session=createEditSession(song,{songId:song.id,chorus:{},version:3},null);editing={from:'library'};await openSong(song,undefined,true);showOriginal(true);}finally{creating=false;}
  }
  async function navigate(page:Page){
    if(leaving||creating)return;
    if(page==='settings'){
      if(currentPage()!=='settings')settingsReturn=captureView(active?.id??null,document.activeElement?.id??null,editing,undefined,setlists.context());
      showPage(page,Boolean(settingsReturn));editMenu.hidden=true;query('settings-heading').focus({preventScroll:true});window.scrollTo(0,0);return;
    }
    if(page===currentPage()){nav.close(false);return;}
    leaving=true;
    try{
      if(session&&!await settleDraft())return;
      editing=undefined;settingsReturn=undefined;resetSong();setlists.reset();showPage(page);editMenu.hidden=true;
      if(page==='library')void refreshLibrary();
      if(page==='setlists')void setlists.refresh();
      if(page==='songbooks')void bookManager.refresh();
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
  window.addEventListener('beforeunload', event => {if (dirty() || setlists.dirty() || bookManager.dirty()) {event.preventDefault(); event.returnValue = '';}});
  function selectFilter(id: string | null) {
    selectedBook = id;
    try {saveSongbookFilter(__APP_ENV__.namespace, id); filterStatus.textContent = '';}
    catch {filterStatus.textContent = 'Filteret er endret, men sangbokvalget kunne ikke lagres til neste oppstart.';}
    drawList();
  }
  function acceptLibrary(snapshot: LibrarySnapshot) {
    songs = snapshot.songs; songbooks = snapshot.songbooks;
    listPersonal = new Map(snapshot.personal.map(state => [state.songId, state]));
    if (selectedBook && !songbooks.some(book => book.id === selectedBook)) selectFilter(null);
    bookManager.accept(snapshot); drawList();
  }
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
    libraryStatus.textContent = visible.length ? '' : songs.length ? `Ingen sanger i ${bookName}. Velg en annen sangbok, eller bruk Legg til sang for å opprette eller importere en sang.` : 'Ingen sanger ennå. Bruk Legg til sang for å opprette eller importere din første sang.';
    libraryStatus.classList.toggle('empty-library', !visible.length);
  }
  async function refreshLibrary(): Promise<boolean> {
    const generation = ++readGeneration;
    retry.hidden = true;
    try {
      const snapshot = await storage.library();
      if (generation !== readGeneration) return false;
      acceptLibrary(snapshot);
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
      } else if (resume){
        settingsReturn=resume.settingsReturn;
        if (resume.page === 'songbooks' || resume.settingsReturn?.page === 'songbooks') {
          if (!await bookManager.refresh(true)) {showPage('songbooks'); return;}
        }
        if (['setlists','setlist'].includes(resume.page ?? '') || resume.setlistId || resume.settingsReturn?.page === 'setlists') {
          if (!await setlists.restore(resume)) {showPage('setlists'); return;}
        }
        await restoreUpdateView(resume, () => active === null);
      }
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
    if(!session||session.song.id!==song.id){editor?.dispose();editor=undefined;session=createEditSession(song,personal);chartReleasedState=Boolean(resume?.chartReleased);}
    song=session.song;personal=session.personal;active=song;
    visualPersonal=JSON.stringify([personal.capo,personal.chordGrid]);
    editMenu.hidden=false;editMenu.replaceChildren(icon(editing?'visning':'rediger'),element('span',editing?'Visning':'Rediger'));
    editMenu.setAttribute('aria-label',editing?'Visning':'Rediger');
    document.body.classList.toggle('editing-active', Boolean(editing));
    if (resume) reader.style.visibility = 'hidden';
    const parsed = parseChordPro(song.original, song.title), article = query('song-content');
    disposeView();editor?.unmount();editor?.element.remove();article.replaceChildren();
    const title = element('h1', parsed.title); title.id = 'song-title'; title.tabIndex = -1; article.append(title);
    const metadata = element('div', undefined, 'song-metadata');
    if (parsed.key) {
      const key = element('span', parsed.key, 'song-key');
      key.setAttribute('aria-label', `Toneart: ${parsed.key}`);
      metadata.append(key);
    }
    const time = element('span', parsed.time, 'song-key'); time.setAttribute('aria-label', `Takt: ${parsed.time}`); metadata.append(time); article.append(metadata);
    const showMetadata=()=>{
      const state=personalState();
      if(state.capo||editing){const key=gripKey(parsed.key,state.capo??0);metadata.append(element('span',state.capo?`Capo ${state.capo}${key?`: ${key}`:''}`:'Uten capo','song-key'));}
      if(state.tuning||editing)metadata.append(element('span',state.tuning||'Standard stemming','song-key song-tuning'));
    };
    let disposeDock = () => {};
    let chartReleased=chartReleasedState;
    const chartArea = element('div'); chartArea.className = 'chart-area'; article.append(chartArea);
    const showChart = () => {
      disposeDock(); chartArea.replaceChildren();
      const state = personalState(), capo = state.capo ?? 0;
      const chosen = selectSongGrid(parsed, state);
      if (chosen) {
        const dock = createChartDock(chosen.grids.map(grid => transposeGrid(grid, capo)), chosen.source, {
          sticky: !editing && !chartReleased, interactive: !editing, change: sticky => {chartReleasedState=chartReleased = !sticky;},
        });
        chartArea.append(dock.element); disposeDock = dock.dispose;
      }
    };
    if(!editor)editor=createSongEditor(session,changed,()=>showOriginal());
    if(editing)article.prepend(editor.element);
    showMetadata(); showChart();
    const capo = personal.capo ?? 0;
    const bodyContent = element('div'); bodyContent.id = 'song-body'; article.append(bodyContent);
    const dynamicsContext: DynamicsContext = {level: 3, chord: value => transposeChord(value, capo)};
    for (const block of parsed.blocks) {
      dynamicsContext.occurrence = block.kind === 'reference' ? block.occurrence : 'source';
      if (block.kind === 'chorus') {
        const section = element('section', undefined, 'chorus');section.dataset.chorusStart=String(block.sourceLine);
        const body = element('div', undefined, 'chorus-text'); body.append(renderContent(block.content, dynamicsContext));
        const heading=element('h2','Refreng');heading.dataset.sourceLine=String(block.sourceLine);section.append(heading, body); bodyContent.append(section);
      } else if (block.kind === 'reference') {
        if(!block.content){const missing=element('section',undefined,'chorus reference'),heading=element('h2','Refreng');missing.dataset.referenceLine=heading.dataset.sourceLine=block.occurrence.replace('line:','');missing.append(heading);bodyContent.append(missing);continue;}
        const section = element('section', undefined, 'chorus reference');section.dataset.referenceLine=block.occurrence.replace('line:','');
        const heading = element('h2'), button = element('button', 'Refreng'); button.type = 'button';heading.dataset.sourceLine=block.occurrence.replace('line:','');
        button.setAttribute('aria-label', 'Refreng');
        const body = element('div', undefined, 'chorus-text'); body.id = `chorus-${block.occurrence.replace(':', '-')}`;
        body.append(renderContent(block.content, dynamicsContext));
        dynamicsContext.spokenLevel = undefined; // The following content stays accessible when this body is collapsed.
        let expanded = !editing && personal.chorus[block.occurrence] === true;
        const reflect = () => {button.setAttribute('aria-expanded', String(expanded)); body.hidden = !expanded;};
        button.setAttribute('aria-controls', body.id); reflect();
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const write = storage.updatePersonal(song.id, current => ({...current, chorus: {...current.chorus, [block.occurrence]: !expanded}}));
            chorusWrites.add(write);
            try {personal = await write;} finally {chorusWrites.delete(write);}
            if(session)session.updateView(personal.chorus);else readerPersonal=personal;
            expanded = !expanded; reflect();paintAnnotations(bodyContent,song,personalState());
            if (active?.id === song.id) notify('');
          }
          catch {if (active?.id === song.id) notify('Refrengvalget kunne ikke lagres. Prøv igjen; tidligere valg er beholdt.', true);}
          finally {button.disabled = false;}
        });
        if(editing)heading.textContent='Refreng';else heading.append(button); section.append(heading, body); bodyContent.append(section);
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
    const disposeProfile=attachDynamicsProfile(bodyContent,parsed.hasDynamics);
    if(editing)bodyContent.dataset.editing='true';
    const disposeAnnotations=attachAnnotationGeometry(bodyContent);
    disposeView = () => {disposeSpacing(); disposeProfile(); disposeDock();disposeAnnotations();};
    if (resume) await restoreUpdateView(resume, () => active?.id === song.id);
    else {title.focus({preventScroll: true}); window.scrollTo(0, 0);}
    reader.style.removeProperty('visibility');
  }
  function resetSong(){
    cancelAnimationFrame(renderFrame);renderFrame=0;editMenu.hidden=true;document.body.classList.remove('editing-active');disposeView();disposeView=()=>{};editor?.dispose();editor=undefined;query('song-content').replaceChildren();session=undefined;readerPersonal=undefined;active=null;notify('');saveRetry.hidden=true;
  }
  function back(){
    if(currentPage()==='settings'&&settingsReturn){const view=settingsReturn;settingsReturn=undefined;void restoreUpdateView(view,()=>true).then(()=>{editMenu.hidden=!active;focusUpdateView(view);});return;}
    if(currentPage()==='setlist'){void setlists.back();return;}
    if(leaving||switchingMode)return;
    if(session&&(saving||session.dirty()||editor?.dirty())){leaving=true;void settleDraft().then(ok=>{if(ok){editing=undefined;resetSong();showPage('library');void refreshLibrary();}}).finally(()=>{leaving=false;});return;}
    editing=undefined;resetSong();showPage('library');void refreshLibrary();query('library-title').focus({preventScroll:true});window.scrollTo(0,0);
  }
  query('back').addEventListener('click',back);
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]; if (!selected || importing || !importBook) return;
    importing = true; file.disabled = add.disabled = true; notify('Leser og lagrer sangen…');
    try {
      let bytes: ArrayBuffer;
      try {bytes = await selected.arrayBuffer();}
      catch {throw new Error('Filen kunne ikke leses. Velg filen på nytt og prøv igjen.');}
      const song = createSong(selected.name, new Uint8Array(bytes), importBook);
      const existing = await storage.list();
      if (classifyImport({filename:selected.name},existing)==='possible-copy' && !await confirmImportCopy(selected.name,add)) {notify('');return;}
      for (;;) {
        try {await storage.add(song); break;}
        catch (cause) {
          if (!(cause instanceof MissingSongbookError)) throw cause;
          if (!await refreshLibrary()) throw cause;
          const id = await new Promise<string | null>(resolve => bookManager.chooseTarget('Velg sangbok', add,
            suggestedSongbook(songbooks, lastUsedBook, selectedBook), resolve, () => resolve(null)));
          if (!id) {notify('Importen er avbrutt. Ingen sang er lagret.'); return;}
          song.songbookId = id;
        }
      }
      lastUsedBook = song.songbookId;
      songs.push(song); drawList();
      await openSong(song);
      if (active?.id === song.id) notify('Sangen er lagret på denne enheten.');
    } catch (error) {notify(error instanceof Error ? error.message : 'Filen kunne ikke leses eller lagres. Prøv igjen.', true);}
    finally {importing = false; file.disabled = false; add.disabled = !libraryReady; file.value = '';}
  });
  showPage('library');
  void load();
  return {beforeUpdateReload: async (focusId: string | null) => {
    await setlists.beforeUpdate();
    await bookManager.beforeUpdate();
    if (importing) throw new Error('Vent til importen er fullført før oppdatering.');
    if(saving)await saving;
    if(session?.dirty()&&!originalModal?.isOpen())await flush();
    if(dirty())throw new Error('Fullfør Råtekst eller den åpne kontrollen, og kontroller lokal lagring før oppdatering.');
    await Promise.all(chorusWrites);
    saveUpdateView(__APP_ENV__.namespace, active?.id ?? null, focusId, editing ? {...editing, annotation: editor?.selection()} : undefined, settingsReturn, setlists.context());
  }};
}
