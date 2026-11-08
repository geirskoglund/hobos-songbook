import type {Song, SongPersonal} from '../domain/song.ts';
import {originalChangeError} from '../domain/original.ts';
export const schemaVersion = 1;
export function songStorage(namespace: string) {
  if (!['hobos-songbook-production', 'hobos-songbook-test'].includes(namespace)) throw new Error('Ugyldig lagringsmiljø.');
  async function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let failed = false;
      let request: IDBOpenDBRequest;
      try {request = indexedDB.open(namespace, schemaVersion);}
      catch {reject(new Error('Kunne ikke åpne sanglageret. Nettleseren tillater ikke lokal lagring.')); return;}
      request.onupgradeneeded = () => {
        const db = request.result;
        // Additive, versioned schema: never reset existing data.
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', {keyPath: 'id'});
        if (!db.objectStoreNames.contains('personal')) db.createObjectStore('personal', {keyPath: 'songId'});
      };
      request.onblocked = () => {failed = true; reject(new Error('Sanglageret er blokkert. Lukk andre faner med appen og prøv igjen.'));};
      request.onerror = () => reject(new Error('Kunne ikke åpne sanglageret. Kontroller at nettleseren tillater lokal lagring, og prøv igjen.'));
      request.onsuccess = () => {
        const db = request.result;
        if (failed) {db.close(); return;}
        db.onversionchange = () => db.close(); resolve(db);
      };
    });
  }
  async function transaction<T>(store: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(store, mode);
        const request = operation(tx.objectStore(store));
        tx.oncomplete = () => {db.close(); resolve(request.result);};
        tx.onabort = tx.onerror = () => {db.close(); reject(new Error('Kunne ikke lese eller lagre sangdata. Lagringen kan være full eller utilgjengelig. Prøv igjen; tidligere sanger er beholdt.'));};
      } catch {db.close(); reject(new Error('Sanglageret er utilgjengelig. Prøv igjen uten å slette nettleserdata.'));}
    });
  }
  async function updatePersonal(songId: string, change: (current: SongPersonal) => SongPersonal): Promise<SongPersonal> {
    const db = await open();
    return new Promise((resolve, reject) => {
      let next: SongPersonal;
      try {
        const tx = db.transaction('personal', 'readwrite'), store = tx.objectStore('personal');
        const request = store.get(songId);
        request.onsuccess = () => {
          try {next = change(request.result ?? {songId, chorus: {}}); store.put({...next, songId, version: 2});}
          catch {try {tx.abort();} catch { /* An injected or browser abort may already have ended the transaction. */ }}
        };
        tx.oncomplete = () => {db.close(); resolve(next);};
        tx.onerror = tx.onabort = () => {db.close(); reject(new Error('Kunne ikke lagre personlige endringer. Prøv igjen; tidligere data er beholdt.'));};
      } catch {db.close(); reject(new Error('Personlig lagring er utilgjengelig. Prøv igjen.'));}
    });
  }
  return {
    updatePersonal,
    async saveDraft(song: Song, baseline: Song | null, change?: (current: SongPersonal) => SongPersonal): Promise<void> {
      const db = await open();
      return new Promise((resolve,reject) => {
        let problem = 'Kunne ikke lagre sangen og personlige endringer. Prøv igjen; utkastet er beholdt.';
        const fail = (message:string):never => {problem=message;throw new Error(message);};
        try {
          const tx = db.transaction(['songs','personal'],'readwrite');
          const songStore = tx.objectStore('songs'), personalStore = tx.objectStore('personal');
          const storedSong = songStore.get(song.id), storedPersonal = personalStore.get(song.id);
          let reads = 0;
          const ready = () => {
            if (++reads !== 2) return;
            try {
              const current: Song | undefined = storedSong.result;
              const personal: SongPersonal = storedPersonal.result ?? {songId:song.id,chorus:{}};
              const next = change ? change(personal) : personal;
              if (!baseline) {
                if (current) fail('Sangen er allerede opprettet. Åpne den på nytt før videre redigering.');
                songStore.add(song);
              } else if (baseline.original !== song.original) {
                if (!current || current.original !== baseline.original) fail('Originalen er endret i en annen fane. Utkastet er beholdt; åpne sangen på nytt før videre lagring.');
                const protection = originalChangeError(current!,song,personal) ?? originalChangeError(current!,song,next);
                if (protection) fail(protection);
                songStore.put({...current,original:song.original,title:song.title,key:song.key});
              } else if (change && (!current || current.original !== baseline.original)) {
                fail('Originalen er endret i en annen fane. Personutkastet er beholdt; åpne sangen på nytt.');
              }
              if (change) personalStore.put({...next,songId:song.id,version:2});
            } catch {tx.abort();}
          };
          storedSong.onsuccess = ready; storedPersonal.onsuccess = ready;
          tx.oncomplete = () => {db.close();resolve();};
          tx.onabort = tx.onerror = () => {db.close();reject(new Error(problem));};
        } catch {db.close();reject(new Error(problem));}
      });
    },
    list: () => transaction<Song[]>('songs', 'readonly', store => store.getAll()),
    add: (song: Song) => transaction('songs', 'readwrite', store => store.add(song)),
    personal: (songId: string) => transaction<SongPersonal | undefined>('personal', 'readonly', store => store.get(songId)),
    savePersonal: (state: SongPersonal) => transaction('personal', 'readwrite', store => store.put(state)),
  };
}
