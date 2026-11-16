import type {Song, SongPersonal} from '../domain/song.ts';
import type {Songbook} from '../domain/songbook.ts';
import {emptyJournal, newSyncState, type SyncState, type LocalJournal} from '../sync/model.ts';
export interface SyncSnapshot {songs: Song[]; songbooks: Songbook[]; personal: SongPersonal[]; journal: LocalJournal; state: SyncState}
export const journalId = 'private-local-v1';
/** Called inside every local data-write transaction: the outbox cannot miss a committed write. */
export function trackLocal(tx: IDBTransaction, change?: (journal: LocalJournal) => void) {
  const store = tx.objectStore('sync'), read = store.get(journalId);
  read.onsuccess = () => {
    const journal: LocalJournal = read.result ?? emptyJournal();
    if (journal.version !== 1) {tx.abort(); return;}
    journal.generation++; for (const session of Object.values(journal.sessions)) session.edited = true; change?.(journal); store.put(journal);
  };
  tx.addEventListener('complete', () => {document.dispatchEvent(new Event('library-local-change'));});
}
export function syncStorage(open: () => Promise<IDBDatabase>) {
  async function snapshot(accountId: string): Promise<SyncSnapshot> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['songs', 'songbooks', 'personal', 'sync']);
      const songs = tx.objectStore('songs').getAll(), books = tx.objectStore('songbooks').getAll(), personal = tx.objectStore('personal').getAll();
      const journal = tx.objectStore('sync').get(journalId), state = tx.objectStore('sync').get(`private-account-v1:${accountId}`);
      tx.oncomplete = () => {
        db.close();
        if (state.result && (state.result.version !== 1 || state.result.accountId !== accountId)) {reject(new Error('Ukjent synkformat. Lokale data er beholdt.')); return;}
        resolve({songs: songs.result, songbooks: books.result, personal: personal.result, journal: journal.result ?? emptyJournal(), state: state.result ?? newSyncState(accountId)});
      };
      tx.onabort = tx.onerror = () => {db.close(); reject(new Error('Kunne ikke lese synktilstanden.'));};
    });
  }
  async function commit(generation: number, state: SyncState, changes: {songs?: Song[]; personal?: SongPersonal[]; books?: Songbook[]; deleteBooks?: string[]} = {}, guard: () => boolean = () => true) {
    const db = await open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['songs', 'songbooks', 'personal', 'sync'], 'readwrite'), store = tx.objectStore('sync'), read = store.get(journalId);
      read.onsuccess = () => {
        const journal: LocalJournal = read.result ?? emptyJournal();
        if (journal.generation !== generation || Object.keys(journal.sessions).length || !guard()) {tx.abort(); return;}
        store.put(state);
        for (const song of changes.songs ?? []) tx.objectStore('songs').put(song);
        for (const personal of changes.personal ?? []) tx.objectStore('personal').put(personal);
        for (const book of changes.books ?? []) tx.objectStore('songbooks').put(book);
        for (const id of changes.deleteBooks ?? []) tx.objectStore('songbooks').delete(id);
      };
      tx.oncomplete = () => {db.close(); resolve();};
      tx.onabort = tx.onerror = () => {db.close(); reject(new Error('Synkroniseringen er utsatt. Nyere lokale data eller en aktiv sangøkt er beholdt.'));};
    });
  }
  async function session(owner: string, songId: string | null, edited = false) {
    const db = await open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sync', 'readwrite'), store = tx.objectStore('sync'), read = store.get(journalId);
      read.onsuccess = () => {
        const journal: LocalJournal = read.result ?? emptyJournal();
        // Reopening an interrupted song explicitly recovers its existing local work.
        if (songId) {
          for (const [key, entry] of Object.entries(journal.sessions)) if (key.startsWith('interrupted:') && entry.songId === songId) delete journal.sessions[key];
          journal.sessions[owner] = {songId, edited: edited || journal.sessions[owner]?.edited || false};
        } else delete journal.sessions[owner];
        journal.generation++; store.put(journal);
      };
      tx.oncomplete = () => {db.close(); resolve();};
      tx.onabort = tx.onerror = () => {db.close(); reject(new Error('Kunne ikke lagre sangøktens synkpause. Prøv igjen.'));};
    });
  }
  async function recoverSessions(liveOwners: string[]) {
    const db = await open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sync', 'readwrite'), store = tx.objectStore('sync'), read = store.get(journalId);
      read.onsuccess = () => {
        if (!read.result) return;
        const journal: LocalJournal = read.result;
        for (const [owner, entry] of Object.entries(journal.sessions)) if (!owner.startsWith('interrupted:') && !liveOwners.includes(owner)) {
          delete journal.sessions[owner];
          if (entry.edited) journal.sessions[`interrupted:${entry.songId}`] = entry;
        }
        store.put(journal);
      };
      tx.oncomplete = () => {db.close(); resolve();};
      tx.onabort = tx.onerror = () => {db.close(); reject(new Error('Kunne ikke kontrollere avbrutte sangøkter.'));};
    });
  }
  return {snapshot, commit, session, recoverSessions};
}
