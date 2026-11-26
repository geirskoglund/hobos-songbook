import {emptyJournal, type LocalJournal} from '../core/sync-model.ts';
import {journalKey} from '../core/paths.ts';
/** Called inside every local data-write transaction: the outbox cannot miss a committed write. */
export function trackLocal(tx: IDBTransaction, change?: (journal: LocalJournal) => void) {
  const store = tx.objectStore('sync'),
    read = store.get(journalKey);
  read.onsuccess = () => {
    const journal: LocalJournal = read.result ?? emptyJournal();
    if (journal.version !== 1) {
      tx.abort();
      return;
    }
    journal.generation++;
    for (const session of Object.values(journal.sessions)) session.edited = true;
    change?.(journal);
    store.put(journal);
  };
  tx.addEventListener('complete', () => {
    document.dispatchEvent(new Event('library-local-change'));
  });
}
