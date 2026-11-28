import {byId} from './dom.ts';
import {contextMenu, floatingAction, listRow, songbookFilter} from './list-controls.ts';
import {parseChordPro} from '../domain/chordpro.ts';
import {gripKey} from '../domain/personal.ts';
import {suggestedSongbook, type Songbook} from '../domain/songbook.ts';
import type {Song, SongPersonal} from '../core/song.ts';
import {readSongbookFilter, saveSongbookFilter} from '../storage/songbook-filter.ts';
import type {LibrarySnapshot, songStorage} from '../storage/songs.ts';

export type SongLibrary = ReturnType<typeof startSongLibrary>;

/**
 * Sanglisten med sangbokfilteret (D10) og Legg til sang. Eier sangene, sangbøkene og filtervalget
 * slik de sist ble lest fra lageret, og sangboken brukeren sist lagret i.
 */
export function startSongLibrary(
  storage: ReturnType<typeof songStorage>,
  options: {
    cachedPublication: () => Promise<{books: Songbook[]} | undefined>;
    accepted: (snapshot: LibrarySnapshot) => void;
    filterChanged: () => void;
    open: (song: Song) => void;
    importing: () => boolean;
    add: (action: 'create' | 'import') => void;
    reload: () => void;
  },
) {
  const list = byId('song-list'),
    status = byId('library-status'),
    filterStatus = byId('filter-status');
  const retry = byId<HTMLButtonElement>('retry-storage');
  let songs: Song[] = [],
    songbooks: Songbook[] = [],
    listPersonal = new Map<string, Pick<SongPersonal, 'songId' | 'capo' | 'tuning'>>();
  let selectedBook: string | null = null,
    ready = false,
    readGeneration = 0;
  /** En publisert sangbok som er valgt i filteret uten å ligge lokalt. */
  let remoteFilterBook: Songbook | undefined;
  let lastUsedBook: string | null = null;
  const filterBooks = () => (remoteFilterBook ? [...songbooks, remoteFilterBook] : songbooks);
  try {
    selectedBook = readSongbookFilter(__APP_ENV__.namespace);
  } catch {
    filterStatus.textContent = 'Sangbokvalget kunne ikke hentes. Viser alle sanger.';
  }
  const libraryFilter = songbookFilter('songbook-filter', 'library', filterBooks, () => selectedBook, selectFilter);
  const filter = libraryFilter.button;
  filter.disabled = true;
  const add = floatingAction('Legg til sang', () => {
    contextMenu(add, [
      {name: 'Opprett', icon: 'ny', run: () => options.add('create')},
      {name: 'Importer', icon: 'importer', run: () => options.add('import')},
    ]);
  });
  add.id = 'add-song';
  add.disabled = true;
  add.setAttribute('aria-haspopup', 'menu');
  add.setAttribute('aria-expanded', 'false');
  byId('library').append(add);
  retry.addEventListener('click', () => options.reload());

  function selectFilter(id: string | null, book?: Songbook) {
    selectedBook = id;
    const known = book ?? remoteFilterBook;
    remoteFilterBook = known?.id === id && !songbooks.some(local => local.id === id) ? known : undefined;
    try {
      saveSongbookFilter(__APP_ENV__.namespace, id);
      filterStatus.textContent = '';
    } catch {
      filterStatus.textContent = 'Filteret er endret, men sangbokvalget kunne ikke lagres til neste oppstart.';
    }
    draw();
    options.filterChanged();
  }
  function accept(snapshot: LibrarySnapshot) {
    songs = snapshot.songs;
    songbooks = snapshot.songbooks;
    listPersonal = new Map(snapshot.personal.map(state => [state.songId, state]));
    if (songbooks.some(book => book.id === selectedBook)) remoteFilterBook = undefined;
    else if (selectedBook && !remoteFilterBook) selectFilter(null);
    options.accepted(snapshot);
    draw();
  }
  function draw() {
    list.replaceChildren();
    status.dataset.error = 'false';
    const bookName = filterBooks().find(book => book.id === selectedBook)?.name ?? 'Alle';
    libraryFilter.render();
    songs.sort(
      (a, b) => a.title.localeCompare(b.title, 'nb') || a.origin.importedAt.localeCompare(b.origin.importedAt),
    );
    const visible = songs.filter(song => selectedBook === null || song.songbookId === selectedBook);
    for (const song of visible) {
      const parsed = parseChordPro(song.original, song.title),
        personal = listPersonal.get(song.id);
      const metadata = [...(parsed.key ? [parsed.key] : []), parsed.time];
      if (personal?.capo) {
        const key = gripKey(parsed.key, personal.capo);
        metadata.push(`Capo ${personal.capo}${key ? `: ${key}` : ''}`);
      }
      if (personal?.tuning) metadata.push(`Stemming: ${personal.tuning}`);
      const {row, main} = listRow({title: song.title, details: metadata, choose: () => options.open(song)});
      main.dataset.songId = song.id;
      main.disabled = options.importing();
      list.append(row);
    }
    status.textContent = visible.length
      ? ''
      : songs.length
        ? `Ingen sanger i ${bookName}. Velg en annen sangbok, eller bruk Legg til sang for å opprette eller importere en sang.`
        : 'Ingen sanger ennå. Bruk Legg til sang for å opprette eller importere din første sang.';
    status.classList.toggle('empty-library', !visible.length);
  }
  /** Leser biblioteket på nytt. Et eldre svar som kommer etter et nyere, forkastes. */
  async function refresh(): Promise<boolean> {
    const generation = ++readGeneration;
    retry.hidden = true;
    try {
      const snapshot = await storage.library();
      if (generation !== readGeneration) return false;
      const bookId = selectedBook;
      if (
        bookId &&
        !remoteFilterBook &&
        !songbooks.some(book => book.id === bookId) &&
        !snapshot.songbooks.some(book => book.id === bookId)
      ) {
        const cached = await options.cachedPublication().catch(() => undefined);
        if (generation !== readGeneration) return false;
        if (bookId === selectedBook) remoteFilterBook = cached?.books.find(book => book.id === bookId);
      }
      accept(snapshot);
      ready = true;
      filter.disabled = false;
      add.disabled = options.importing();
      draw();
      return true;
    } catch (error) {
      if (generation !== readGeneration) return false;
      ready = false;
      filter.disabled = add.disabled = true;
      list.replaceChildren();
      status.classList.remove('empty-library');
      status.textContent = error instanceof Error ? error.message : 'Kunne ikke åpne sanglageret.';
      retry.hidden = false;
      return false;
    }
  }
  return {
    filterButton: filter,
    addButton: add,
    books: filterBooks,
    selected: () => selectedBook,
    select: selectFilter,
    accept,
    draw,
    refresh,
    find: (id: string) => songs.find(song => song.id === id),
    suggested: () => suggestedSongbook(songbooks, lastUsedBook, selectedBook),
    /** Husker sangboken brukeren sist lagret i, og viser den i filteret. */
    useBook(id: string) {
      lastUsedBook = id;
      selectFilter(id);
    },
    saved(song: Song, personal: SongPersonal) {
      const index = songs.findIndex(known => known.id === song.id);
      if (index < 0) songs.push(song);
      else songs[index] = song;
      listPersonal.set(song.id, personal);
      draw();
    },
    added(song: Song) {
      songs.push(song);
      draw();
    },
    /** Publiseringssiden har lest sangbøkene på nytt. */
    publicationRefreshed(books: Songbook[]) {
      if (!remoteFilterBook) return;
      const selected = books.find(book => book.id === selectedBook);
      if (selected) remoteFilterBook = selected;
      else selectFilter(null);
    },
    /** Dropbox-kontoen er byttet, så en publisert sangbok i filteret gjelder ikke lenger. */
    forgetRemoteFilter() {
      if (remoteFilterBook) selectFilter(null);
    },
    lockImport(importing: boolean) {
      add.disabled = importing || !ready;
      for (const row of list.querySelectorAll<HTMLButtonElement>('[data-song-id]')) row.disabled = importing;
    },
    message(text: string, error = false) {
      status.classList.remove('empty-library');
      status.textContent = text;
      status.dataset.error = String(error);
    },
    failed(text: string) {
      status.textContent = text;
      retry.hidden = false;
    },
    hideRetry() {
      retry.hidden = true;
    },
  };
}
