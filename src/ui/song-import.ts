import {confirmImportCopy} from './dialog.ts';
import {byId} from './dom.ts';
import type {SongLibrary} from './song-library.ts';
import type {startSongbooks} from './songbooks.ts';
import {classifyImport} from '../domain/import.ts';
import {createSong} from '../domain/song.ts';
import {MissingSongbookError} from '../domain/songbook.ts';
import type {songStorage} from '../storage/songs.ts';

/** Legg til sang: valg av sangbok, og import av en ChordPro-fil. Eier importtilstanden. */
export function startSongImport(
  storage: ReturnType<typeof songStorage>,
  library: SongLibrary,
  books: ReturnType<typeof startSongbooks>,
  options: {
    /** Sangsiden er i ferd med å opprette en sang eller gå ut. */
    blocked: () => boolean;
    create: (songbookId: string) => void;
    imported: () => Promise<void>;
    resume: () => void;
  },
) {
  const file = byId<HTMLInputElement>('song-file');
  let importing = false,
    importBook: string | null = null;
  async function choose(action: 'create' | 'import') {
    if (options.blocked() || importing) return;
    if (!(await library.refresh())) return;
    books.chooseTarget(
      action === 'create' ? 'Opprett i sangbok' : 'Importer i sangbok',
      library.addButton,
      library.suggested(),
      id => {
        if (action === 'create') options.create(id);
        else {
          importBook = id;
          file.click();
        }
      },
    );
  }
  function setImporting(value: boolean) {
    importing = value;
    file.disabled = value;
    library.lockImport(value);
  }
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected || importing || !importBook) return;
    setImporting(true);
    library.message('Leser og lagrer sangen…');
    try {
      let bytes: ArrayBuffer;
      try {
        bytes = await selected.arrayBuffer();
      } catch {
        throw new Error('Filen kunne ikke leses. Velg filen på nytt og prøv igjen.');
      }
      const song = createSong(selected.name, new Uint8Array(bytes), importBook);
      const existing = await storage.list();
      if (
        classifyImport({filename: selected.name}, existing) === 'possible-copy' &&
        !(await confirmImportCopy(selected.name, library.addButton))
      ) {
        library.draw();
        return;
      }
      for (;;) {
        try {
          await storage.add(song);
          break;
        } catch (cause) {
          if (!(cause instanceof MissingSongbookError)) throw cause;
          if (!(await library.refresh())) throw cause;
          const id = await new Promise<string | null>(resolve =>
            books.chooseTarget('Velg sangbok', library.addButton, library.suggested(), resolve, () => resolve(null)),
          );
          if (!id) {
            library.message('Importen er avbrutt. Ingen sang er lagret.');
            return;
          }
          song.songbookId = id;
        }
      }
      library.useBook(song.songbookId);
      library.added(song);
      await options.imported();
    } catch (error) {
      library.message(
        error instanceof Error ? error.message : 'Filen kunne ikke leses eller lagres. Prøv igjen.',
        true,
      );
    } finally {
      setImporting(false);
      file.value = '';
      options.resume();
    }
  });
  return {
    choose,
    importing: () => importing,
  };
}
