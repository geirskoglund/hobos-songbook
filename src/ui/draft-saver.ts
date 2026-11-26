import {byId, element} from './dom.ts';
import type {SongLibrary} from './song-library.ts';
import type {startSongbooks} from './songbooks.ts';
import type {EditSession} from '../domain/edit-session.ts';
import {MissingSongbookError} from '../domain/songbook.ts';
import type {songStorage} from '../storage/songs.ts';

/**
 * Lagrer redigeringsøktens utkast lokalt, med Prøv lagring igjen ved feil. Bare én lagring
 * kjører om gangen; et nytt kall mens en lagring pågår, venter på den.
 */
export function createDraftSaver(
  storage: ReturnType<typeof songStorage>,
  library: SongLibrary,
  books: ReturnType<typeof startSongbooks>,
  options: {
    /** Økten til den åpne sangen, om noen. */
    session: () => EditSession | undefined;
    rawOpen: () => boolean;
    saved: () => void;
    notify: (message: string, error?: boolean) => void;
  },
) {
  const status = byId('song-status');
  let saving: Promise<boolean> | undefined;
  const retry = element('button', 'Prøv lagring igjen');
  retry.type = 'button';
  retry.hidden = true;
  const errorBar = element('div', undefined, 'song-error');
  status.before(errorBar);
  errorBar.append(status, retry);
  retry.addEventListener('click', () => {
    void flush();
  });
  async function flush(rawCommit = false): Promise<boolean> {
    const submitting = options.session();
    if (!submitting || (options.rawOpen() && !rawCommit)) return false;
    if (saving) return saving;
    saving = (async () => {
      try {
        while (submitting.dirty()) {
          const snapshot = submitting.snapshot(),
            update = submitting.pendingChange();
          try {
            await storage.saveDraft(snapshot.song, submitting.baselineSong, update);
          } catch (cause) {
            if (!(cause instanceof MissingSongbookError) || submitting.baselineSong) throw cause;
            if (!(await library.refresh())) throw cause;
            const id = await new Promise<string | null>(resolve =>
              books.chooseTarget(
                'Velg sangbok',
                options.rawOpen() ? byId('original-text') : retry,
                library.suggested(),
                resolve,
                () => resolve(null),
              ),
            );
            if (!id) throw cause;
            submitting.assignNewSongbook(id);
            continue;
          }
          if (!submitting.baselineSong) library.useBook(snapshot.song.songbookId);
          submitting.markSaved(snapshot);
          library.saved(snapshot.song, snapshot.personal);
        }
        retry.hidden = true;
        options.saved();
        options.notify('');
        return true;
      } catch (error) {
        options.notify(error instanceof Error ? error.message : 'Kunne ikke lagre. Prøv igjen.', true);
        retry.hidden = false;
        return false;
      }
    })();
    try {
      return await saving;
    } finally {
      saving = undefined;
    }
  }
  return {
    flush,
    /** Lagringen som pågår, om noen. */
    pending: () => saving,
    hideRetry() {
      retry.hidden = true;
    },
  };
}
