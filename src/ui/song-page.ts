import {actionButton, icon} from './controls.ts';
import {byId, element} from './dom.ts';
import {showPage} from './layout.ts';
import {confirmLeave} from './leave-dialog.ts';
import {openRawEditor} from './original-editor.ts';
import {createSongEditor} from './song-editor.ts';
import {renderSongView} from './song-view.ts';
import {createDraftSaver} from './draft-saver.ts';
import {attachAnnotationGeometry} from './annotations.ts';
import {attachSongSpacing} from './song-spacing.ts';
import {attachDynamicsProfile} from './dynamics-profile.ts';
import {captureView, restoreUpdateView, type UpdateView} from './update-view.ts';
import type {SongLibrary} from './song-library.ts';
import type {startSongbooks} from './songbooks.ts';
import type {navigation} from './navigation.ts';
import {parseChordPro} from '../domain/chordpro.ts';
import {createEditSession, type EditSession} from '../domain/edit-session.ts';
import {newSong} from '../domain/original.ts';
import type {Song, SongPersonal} from '../core/song.ts';
import type {songStorage} from '../storage/songs.ts';
import type {syncController} from '../sync/controller.ts';

/**
 * Sangsiden: den åpne sangen, visningen av den og redigeringsløpet (Rediger/Visning, Råtekst,
 * lagring av utkast og spørsmålet om ulagrede endringer). Eier all tilstand om den åpne sangen.
 */
export function startSongPage(
  storage: ReturnType<typeof songStorage>,
  library: SongLibrary,
  books: ReturnType<typeof startSongbooks>,
  cloud: ReturnType<typeof syncController>,
  nav: ReturnType<typeof navigation>,
  options: {
    /** Visningen som Tilbake fra Innstillinger skal gå til, hentet fra en gjenopprettet visning. */
    settingsRestored: (view: UpdateView) => void;
  },
) {
  const reader = byId('reader'),
    status = byId('song-status'),
    article = byId('song-content');
  let active: Song | null = null;
  let session: EditSession | undefined;
  /** Personlig tilstand for en sang som vises uten redigeringsøkt. */
  let readerPersonal: SongPersonal | undefined;
  let editing: UpdateView['editor'] | undefined;
  let editor: ReturnType<typeof createSongEditor> | undefined;
  let originalModal: ReturnType<typeof openRawEditor> | undefined;
  let disposeView = () => {};
  let renderFrame = 0,
    visualPersonal = '',
    chartReleasedState = false;
  const chorusWrites = new Set<Promise<unknown>>();
  let openingSong = false,
    sessionEdited = false,
    creating = false,
    leaving = false,
    switchingMode = false;
  const personalState = () => session?.personal ?? readerPersonal!;
  const dirty = () => Boolean(session?.dirty() || editor?.dirty() || originalModal?.dirty());
  const notify = (message: string, error = false) => {
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const saver = createDraftSaver(storage, library, books, {
    session: () => (active ? session : undefined),
    rawOpen: () => Boolean(originalModal?.isOpen()),
    saved: () => editor?.markSaved(),
    notify,
  });
  const flush = saver.flush;
  const editMenu = actionButton(
    'Rediger',
    () => {
      if (!active || switchingMode) return;
      switchingMode = true;
      editMenu.disabled = true;
      void (editing ? finishEdit() : beginEdit(active, 'reader')).finally(() => {
        switchingMode = false;
        editMenu.disabled = false;
      });
    },
    'rediger',
  );
  editMenu.id = 'edit-song';
  editMenu.hidden = true;

  function redraw() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      if (!active || !session) return;
      const view = captureView(active.id, null);
      view.chartReleased = chartReleasedState;
      void openSong(session.song, view, true);
    });
  }
  /** Editoren har endret økten. `source` betyr at originalteksten er endret. */
  function changed(source = false) {
    sessionEdited = true;
    if (active)
      void cloud
        .begin(active.id, true)
        .catch(error => notify(error instanceof Error ? error.message : 'Synkpausen kunne ikke lagres.', true));
    const state = session!.personal,
      key = JSON.stringify([state.capo, state.chordGrid]);
    const tuning = reader.querySelector('.song-tuning');
    if (tuning) tuning.textContent = state.tuning || 'Standard stemming';
    if (source || visualPersonal !== key) {
      visualPersonal = key;
      redraw();
    } else editor?.refresh();
    void flush();
  }
  function showOriginal(first = false) {
    if (!active || !editor || originalModal?.isOpen()) return;
    editor.unmount();
    originalModal = openRawEditor(
      session!,
      async () => {
        const ok = await flush(true);
        if (ok) {
          const view = captureView(active!.id, null);
          view.chartReleased = chartReleasedState;
          await openSong(session!.song, view, true);
        }
        return ok;
      },
      () => {
        originalModal = undefined;
        if (first) {
          editing = undefined;
          void resetSong().then(() => {
            showPage('library');
            void library.refresh();
          });
        } else if (active && session) redraw();
      },
      editor.element.querySelector<HTMLElement>('[data-editor-tool=raw]')!,
    );
  }
  async function beginEdit(song: Song, from: 'reader' | 'library') {
    const returnView = captureView(from === 'reader' ? song.id : null, from === 'reader' ? 'edit-song' : null);
    returnView.menu.open = false;
    nav.close(false);
    editing = {from, returnView};
    await openSong(song, from === 'reader' ? returnView : undefined, true);
    if (!document.body.classList.contains('editing-active')) editing = undefined;
  }
  async function settleDraft(): Promise<boolean> {
    const saving = saver.pending();
    if (saving) await saving;
    if (session?.dirty() && !originalModal?.isOpen() && !editor?.dirty()) await flush();
    if (!dirty()) return true;
    const choice = await confirmLeave();
    return choice === 'discard' || (choice === 'save' && (await flush()));
  }
  async function finishEdit() {
    if (!active || leaving) return;
    leaving = true;
    try {
      if (session?.dirty() && !(await flush())) return;
      const view = captureView(active.id, 'edit-song');
      view.chartReleased = chartReleasedState;
      delete view.editor;
      editing = undefined;
      await openSong(session!.song, view, true);
    } finally {
      leaving = false;
    }
  }
  async function beginNewSong(songbookId: string) {
    if (creating || leaving) return;
    creating = true;
    nav.close(false);
    try {
      if (session && !(await settleDraft())) return;
      const song = newSong(songbookId);
      session = createEditSession(song, {songId: song.id, chorus: {}, version: 3}, null);
      editing = {from: 'library'};
      await openSong(song, undefined, true);
      showOriginal(true);
    } finally {
      creating = false;
    }
  }
  async function saveChorus(song: Song, occurrence: string, expanded: boolean) {
    const write = storage.updatePersonal(song.id, current => ({
      ...current,
      chorus: {...current.chorus, [occurrence]: expanded},
    }));
    chorusWrites.add(write);
    let personal: SongPersonal;
    try {
      personal = await write;
    } finally {
      chorusWrites.delete(write);
    }
    if (session) session.updateView(personal.chorus);
    else readerPersonal = personal;
  }
  async function openSong(song: Song, resume?: UpdateView, draft = false) {
    openingSong = true;
    try {
      if (active?.id !== song.id) await cloud.begin(song.id, sessionEdited || Boolean(editing));
    } catch (error) {
      openingSong = false;
      notify(error instanceof Error ? error.message : 'Kunne ikke pause synkronisering.', true);
      return;
    }
    openingSong = false;
    notify('');
    if (resume?.editor) editing = resume.editor;
    if (resume?.settingsReturn) options.settingsRestored(resume.settingsReturn);
    let personal: SongPersonal;
    try {
      personal =
        draft && session
          ? session.personal
          : ((await storage.personal(song.id)) ?? {songId: song.id, chorus: {}, version: 3});
    } catch (error) {
      await cloud.end(false);
      notify(error instanceof Error ? error.message : 'Kunne ikke hente personlig tilstand.', true);
      return;
    }
    if (!session || session.song.id !== song.id) {
      editor?.dispose();
      editor = undefined;
      session = createEditSession(song, personal);
      chartReleasedState = Boolean(resume?.chartReleased);
    }
    const shown = session.song;
    personal = session.personal;
    active = shown;
    visualPersonal = JSON.stringify([personal.capo, personal.chordGrid]);
    editMenu.hidden = false;
    editMenu.replaceChildren(icon(editing ? 'visning' : 'rediger'), element('span', editing ? 'Visning' : 'Rediger'));
    editMenu.setAttribute('aria-label', editing ? 'Visning' : 'Rediger');
    document.body.classList.toggle('editing-active', Boolean(editing));
    if (resume) reader.style.visibility = 'hidden';
    const parsed = parseChordPro(shown.original, shown.title);
    disposeView();
    editor?.unmount();
    editor?.element.remove();
    if (!editor) editor = createSongEditor(session, changed, () => showOriginal());
    const view = renderSongView(article, {
      song: shown,
      parsed,
      personal,
      current: personalState,
      toolbar: editing ? editor.element : undefined,
      chartReleased: chartReleasedState,
      chartChanged: released => (chartReleasedState = released),
      saveChorus: (occurrence, expanded) => saveChorus(shown, occurrence, expanded),
      chorusSaved: () => {
        if (active?.id === shown.id) notify('');
      },
      chorusFailed: () => {
        if (active?.id === shown.id)
          notify('Refrengvalget kunne ikke lagres. Prøv igjen; tidligere valg er beholdt.', true);
      },
    });
    const body = view.body;
    if (editing?.annotation) {
      const selection = editing.annotation;
      const line = [...body.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')].find(
        line => line.dataset.occurrence === selection.occurrence,
      );
      if (line) editor.select(line, personalState(), selection);
    }
    if (editing) editor.mount(body);
    showPage('reader');
    const disposeSpacing = attachSongSpacing(body);
    const disposeProfile = attachDynamicsProfile(body, parsed.hasDynamics);
    if (editing) body.dataset.editing = 'true';
    const disposeAnnotations = attachAnnotationGeometry(body);
    disposeView = () => {
      disposeSpacing();
      disposeProfile();
      view.disposeChart();
      disposeAnnotations();
    };
    if (resume) await restoreUpdateView(resume, () => active?.id === shown.id);
    else {
      view.title.focus({preventScroll: true});
      window.scrollTo(0, 0);
    }
    reader.style.removeProperty('visibility');
  }
  async function resetSong() {
    await Promise.all(chorusWrites);
    const edited = sessionEdited;
    sessionEdited = false;
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    editMenu.hidden = true;
    document.body.classList.remove('editing-active');
    disposeView();
    disposeView = () => {};
    editor?.dispose();
    editor = undefined;
    article.replaceChildren();
    session = undefined;
    readerPersonal = undefined;
    active = null;
    notify('');
    saver.hideRetry();
    await cloud.end(edited);
  }
  return {
    editButton: editMenu,
    activeId: () => active?.id ?? null,
    editing: () => editing,
    /** Sangsiden har en sang åpen eller er midt i et skifte; synkroniseringen venter da. */
    busy: () => Boolean(active || creating || leaving || openingSong),
    /** En ny sang opprettes, eller sangen er i ferd med å lukkes. */
    blocked: () => creating || leaving,
    /** Sangen lukkes, eller den skifter mellom Visning og Rediger. */
    switching: () => leaving || switchingMode,
    dirty,
    open: (song: Song, resume?: UpdateView) => openSong(song, resume),
    create: beginNewSong,
    /**
     * Lukker sangen etter å ha avklart ulagrede endringer, og kjører `then` mens sangsiden fortsatt
     * regnes som opptatt. `cleared` kjøres straks brukeren har godtatt å gå ut. Gir false hvis brukeren ble.
     */
    async close(then: () => Promise<void> | void, cleared = () => {}): Promise<boolean> {
      leaving = true;
      try {
        if (session && !(await settleDraft())) return false;
        editing = undefined;
        cleared();
        await resetSong();
        await then();
        return true;
      } finally {
        leaving = false;
        cloud.resume();
      }
    },
    /** Avslutter lagring og refrengvalg før appen lastes på nytt, og gir visningen som skal gjenopprettes. */
    async beforeUpdate() {
      const saving = saver.pending();
      if (saving) await saving;
      if (session?.dirty() && !originalModal?.isOpen()) await flush();
      if (dirty())
        throw new Error('Fullfør Råtekst eller den åpne kontrollen, og kontroller lokal lagring før oppdatering.');
      await Promise.all(chorusWrites);
      return {
        songId: active?.id ?? null,
        editor: editing ? {...editing, annotation: editor?.selection()} : undefined,
      };
    },
  };
}
