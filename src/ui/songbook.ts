import {icon} from './controls.ts';
import {byId} from './dom.ts';
import {navigation} from './navigation.ts';
import {currentPage, showPage, type Page} from './layout.ts';
import {
  captureView,
  saveUpdateView,
  takeUpdateView,
  restoreUpdateView,
  focusUpdateView,
  type UpdateView,
} from './update-view.ts';
import {songStorage} from '../storage/songs.ts';
import {startSetlists} from './setlists.ts';
import {syncController} from '../sync/controller.ts';
import {syncPage} from './sync.ts';
import {startSongbooks} from './songbooks.ts';
import {publicationPage} from './publication.ts';
import {startSongLibrary} from './song-library.ts';
import {startSongImport} from './song-import.ts';
import {startSongPage} from './song-page.ts';
import {startDisplaySettings} from './display-settings.ts';

/**
 * Starter appen: setter sammen sidene og synkroniseringen, eier navigasjonen mellom sidene
 * og gjenoppretter visningen etter en oppdatering.
 */
export function startSongbook() {
  const storage = songStorage(__APP_ENV__.namespace);
  const setlists = startSetlists(storage);
  const library = startSongLibrary(storage, {
    cachedPublication: () => cloud.cachedPublication(),
    accepted: snapshot => bookManager.accept(snapshot),
    filterChanged: () => publication.render(),
    open: song => void songPage.open(song),
    importing: () => importer.importing(),
    add: action => void importer.choose(action),
    reload: () => void load(),
  });
  const bookManager = startSongbooks(storage, {
    changed: library.accept,
    account: () => cloud.account()?.id,
    shareBook: id => cloud.shareBook(id),
    openBook: id => {
      library.select(id);
      void navigate('library');
    },
  });
  let pendingUpdateView = takeUpdateView(__APP_ENV__.namespace);
  const restoredSongId = pendingUpdateView?.songId ?? null;
  const originalScrollRestoration = history.scrollRestoration;
  const app = byId('app');
  if (pendingUpdateView) {
    history.scrollRestoration = 'manual';
    app.style.visibility = 'hidden';
  }
  /** Visningen som Tilbake fra Innstillinger går til. */
  let settingsReturn: UpdateView | undefined;
  const nav = navigation(page => {
    void navigate(page);
  });
  const cloud = syncController(storage, {
    busy: () => songPage.busy() || importer.importing(),
    downloaded: library.refresh,
    notify: updateDropbox,
    connected: () => {
      void navigate('sync');
    },
    accessLost: () => {
      if (currentPage() === 'publication' || currentPage() === 'songbooks') void navigate('sync');
    },
    sharing: async consent => {
      await navigate('songbooks');
      await bookManager.copyShare(consent.bookId, consent.authorized);
    },
  });
  document.addEventListener('library-local-change', cloud.localChanged);
  window.addEventListener('online', cloud.online);
  window.addEventListener('offline', cloud.offline);
  window.addEventListener('storage', event => cloud.storageChanged(event.key));
  const songPage = startSongPage(storage, library, bookManager, cloud, nav, {
    settingsRestored: view => (settingsReturn = view),
  });
  const importer = startSongImport(storage, library, bookManager, {
    blocked: songPage.blocked,
    create: id => void songPage.create(id),
    imported: () => navigate('library'),
    resume: () => cloud.resume(),
  });
  byId('header-actions').append(library.filterButton, songPage.editButton);
  byId('back').replaceChildren(icon('tilbake'));
  const cloudPage = syncPage(cloud);
  const publication = publicationPage(cloud, {
    books: library.books,
    selected: library.selected,
    choose: library.select,
    refreshed: library.publicationRefreshed,
  });
  const headerSync = byId('header-sync'),
    headerSyncStatus = byId('header-sync-status');
  headerSync.append(icon('synkroniser'));
  const environment = headerSync.parentElement!.querySelector('.environment')!;
  let filterAccount = cloud.account()?.id;
  function updateDropbox() {
    const id = cloud.account()?.id;
    if (id !== filterAccount) {
      filterAccount = id;
      library.forgetRemoteFilter();
    }
    nav.publicationAvailable(Boolean(id));
    publication.accountChanged(id);
    cloudPage.render();
    const syncing = cloud.syncing();
    headerSync.parentElement!.toggleAttribute('data-syncing', syncing);
    environment.setAttribute('aria-hidden', String(syncing));
    const syncText = syncing ? 'Synkroniserer…' : '';
    if (syncText !== headerSyncStatus.textContent) headerSyncStatus.textContent = syncText;
    if (!id && currentPage() === 'publication') void navigate('library');
  }
  async function navigate(page: Page) {
    if (songPage.blocked()) return;
    if (page === 'publication' && !cloud.account()) return;
    if (page === 'settings') {
      if (currentPage() !== 'settings')
        settingsReturn = captureView(
          songPage.activeId(),
          document.activeElement?.id ?? null,
          songPage.editing(),
          undefined,
          setlists.context(),
        );
      showPage(page, Boolean(settingsReturn));
      songPage.editButton.hidden = true;
      byId('settings-heading').focus({preventScroll: true});
      window.scrollTo(0, 0);
      return;
    }
    if (page === currentPage()) {
      nav.close(false);
      if (page === 'publication') void publication.open();
      return;
    }
    const left = await songPage.close(
      async () => {
        setlists.reset();
        showPage(page);
        if (page === 'library') void library.refresh();
        if (page === 'setlists') void setlists.refresh();
        if (page === 'songbooks') await bookManager.refresh();
        byId(page === 'library' ? 'library-title' : `${page}-title`).focus({preventScroll: true});
        window.scrollTo(0, 0);
      },
      () => (settingsReturn = undefined),
    );
    if (left && page === 'publication') void publication.open();
  }
  startDisplaySettings();
  window.addEventListener('beforeunload', event => {
    if (songPage.dirty() || setlists.dirty() || bookManager.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  async function load() {
    library.hideRetry();
    const resume = pendingUpdateView;
    pendingUpdateView = null;
    try {
      if (!(await library.refresh())) return;
      if (resume?.songId) {
        const song = library.find(resume.songId);
        if (song) await songPage.open(song, resume);
      } else if (resume) {
        if (!cloud.account()) {
          if (resume.page === 'publication') resume.page = 'library';
          if (resume.settingsReturn?.page === 'publication') resume.settingsReturn = undefined;
        }
        settingsReturn = resume.settingsReturn;
        if (resume.page === 'songbooks' || resume.settingsReturn?.page === 'songbooks') {
          if (!(await bookManager.refresh(true))) {
            showPage('songbooks');
            return;
          }
        }
        if (
          ['setlists', 'setlist'].includes(resume.page ?? '') ||
          resume.setlistId ||
          resume.settingsReturn?.page === 'setlists'
        ) {
          if (!(await setlists.restore(resume))) {
            showPage('setlists');
            return;
          }
        }
        await restoreUpdateView(resume, () => songPage.activeId() === null);
      }
    } catch (error) {
      library.failed(error instanceof Error ? error.message : 'Kunne ikke åpne sanglageret.');
    } finally {
      if (resume) {
        app.style.removeProperty('visibility');
        history.scrollRestoration = originalScrollRestoration;
        focusUpdateView(songPage.activeId() || !resume.songId ? resume : {...resume, songId: null});
      }
    }
  }
  async function back() {
    if (currentPage() === 'settings' && settingsReturn) {
      const view = settingsReturn;
      settingsReturn = undefined;
      if (view.page === 'publication' && !cloud.account()) view.page = 'library';
      await restoreUpdateView(view, () => true);
      songPage.editButton.hidden = !songPage.activeId();
      focusUpdateView(view);
      if (view.page === 'publication') void publication.open();
      return;
    }
    if (currentPage() === 'setlist') {
      void setlists.back();
      return;
    }
    if (songPage.switching()) return;
    await songPage.close(async () => {
      showPage('library');
      await library.refresh();
      byId('library-title').focus({preventScroll: true});
      window.scrollTo(0, 0);
    });
  }
  // Lytteren har ingen som venter; en feil i back() havner i konsollen som før.
  byId('back').addEventListener('click', () => void back());
  showPage('library');
  nav.publicationAvailable(Boolean(cloud.account()));
  void load().then(() => cloud.start(songPage.activeId() === restoredSongId ? restoredSongId : null));
  return {
    beforeUpdateReload: async (focusId: string | null) => {
      await setlists.beforeUpdate();
      await bookManager.beforeUpdate();
      if (importer.importing()) throw new Error('Vent til importen er fullført før oppdatering.');
      const song = await songPage.beforeUpdate();
      saveUpdateView(__APP_ENV__.namespace, song.songId, focusId, song.editor, settingsReturn, setlists.context());
    },
  };
}
