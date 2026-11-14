import type {Song, SongPersonal} from '../domain/song.ts';
import {cleanPersonal, reconcilePersonal} from '../domain/annotations.ts';
import {standardSongbook, songbookName, MissingSongbookError, type Songbook} from '../domain/songbook.ts';
import {setlistName, type Setlist} from '../domain/setlist.ts';
export const schemaVersion = 3;
export interface LibrarySnapshot {songs: Song[]; songbooks: Songbook[]; personal: Pick<SongPersonal, 'songId' | 'capo' | 'tuning'>[]}
export function songStorage(namespace: string) {
  if (!['hobos-songbook-production', 'hobos-songbook-test'].includes(namespace)) throw new Error('Ugyldig lagringsmiljø.');
  async function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let failed = false;
      const newerDatabase = () => new Error('Sanglageret er opprettet av en nyere apputgave som denne utgaven ikke støtter. Lagrede data er beholdt. Åpne apputgaven som opprettet lageret.');
      function connect(existingVersion = false) {
        let request: IDBOpenDBRequest;
        try {request = existingVersion ? indexedDB.open(namespace) : indexedDB.open(namespace, schemaVersion);}
        catch {reject(new Error('Kunne ikke åpne sanglageret. Nettleseren tillater ikke lokal lagring.')); return;}
        request.onupgradeneeded = () => {
          // A database removed between attempts must not be replaced with a new v1 store.
          if (existingVersion) {request.transaction!.abort(); return;}
          const db = request.result;
          // Additive, versioned schema: never reset existing data.
          if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', {keyPath: 'id'});
          if (!db.objectStoreNames.contains('personal')) db.createObjectStore('personal', {keyPath: 'songId'});
          if (!db.objectStoreNames.contains('songbooks')) {
            const books = db.createObjectStore('songbooks', {keyPath: 'id'});
            books.add({...standardSongbook});
            const cursor = request.transaction!.objectStore('songs').openCursor();
            cursor.onsuccess = () => {
              const entry = cursor.result;
              if (!entry) return;
              if (!entry.value.songbookId) entry.update({...entry.value, songbookId: standardSongbook.id});
              entry.continue();
            };
          }
          if (!db.objectStoreNames.contains('setlists')) db.createObjectStore('setlists', {keyPath: 'id'});
        };
        request.onblocked = () => {failed = true; reject(new Error('Sanglageret er blokkert. Lukk andre faner med appen og prøv igjen.'));};
        request.onerror = event => {
          if (!failed && !existingVersion && request.error?.name === 'VersionError') {
            event.preventDefault(); connect(true); return;
          }
          reject(new Error('Kunne ikke åpne sanglageret. Kontroller at nettleseren tillater lokal lagring, og prøv igjen.'));
        };
        request.onsuccess = () => {
          const db = request.result;
          if (failed) {db.close(); return;}
          if (existingVersion) {
            // The previously published sync preview added only the sync store in v4.
            // Reuse its known additive layout, without downgrading or touching extra data.
            const stores = [['songs', 'id'], ['personal', 'songId'], ['songbooks', 'id'], ['setlists', 'id'], ['sync', 'id']] as const;
            try {
              if (db.version !== 4 || stores.some(([name]) => !db.objectStoreNames.contains(name))) throw newerDatabase();
              const tx = db.transaction(stores.map(([name]) => name), 'readonly');
              if (stores.some(([name, key]) => {const store = tx.objectStore(name); return store.keyPath !== key || store.autoIncrement;})) throw newerDatabase();
            } catch {db.close(); reject(newerDatabase()); return;}
          }
          db.onversionchange = () => db.close(); resolve(db);
        };
      }
      connect();
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
        tx.onabort = tx.onerror = () => {db.close(); reject(new Error(store === 'setlists' ? 'Kunne ikke lese setlistene. Prøv igjen; lagrede data er beholdt.' : 'Kunne ikke lese eller lagre sangdata. Lagringen kan være full eller utilgjengelig. Prøv igjen; tidligere sanger er beholdt.'));};
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
          try {next = cleanPersonal(change(cleanPersonal(request.result ?? {songId, chorus: {}}))); store.put({...next, songId});}
          catch {try {tx.abort();} catch { /* An injected or browser abort may already have ended the transaction. */ }}
        };
        tx.oncomplete = () => {db.close(); resolve(next);};
        tx.onerror = tx.onabort = () => {db.close(); reject(new Error('Kunne ikke lagre personlige endringer. Prøv igjen; tidligere data er beholdt.'));};
      } catch {db.close(); reject(new Error('Personlig lagring er utilgjengelig. Prøv igjen.'));}
    });
  }
  async function readPersonal(songId: string): Promise<SongPersonal | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result: SongPersonal | undefined;
      const tx = db.transaction('personal', 'readwrite'), store = tx.objectStore('personal'), request = store.get(songId);
      request.onsuccess = () => {
        if (!request.result) return;
        result = cleanPersonal(request.result);
        if (JSON.stringify(result) !== JSON.stringify(request.result)) store.put(result);
      };
      tx.oncomplete = () => {db.close();resolve(result);};
      tx.onerror = tx.onabort = () => {db.close();reject(new Error('Kunne ikke lese personlige data. Prøv igjen.'));};
    });
  }
  async function writeSetlist(id: string, name?: string, create = false): Promise<Setlist | undefined> {
    const normalized = name === undefined ? undefined : setlistName(name);
    const db = await open();
    return new Promise((resolve, reject) => {
      let result: Setlist | undefined;
      let problem = 'Kunne ikke lagre setlisten. Prøv igjen; tidligere data og navneutkastet er beholdt.';
      try {
        const tx = db.transaction('setlists', 'readwrite'), store = tx.objectStore('setlists');
        const request = create ? store.getAll() : store.get(id);
        request.onsuccess = () => {
          try {
            if (create) {
              const existing = request.result as Setlist[];
              // Monotonic creation order also covers two saves in the same millisecond.
              result = {id, name: normalized!, createdAt: existing.reduce((time, item) => Math.max(time, item.createdAt + 1), Date.now()), songIds: []};
              store.add(result);
            } else if (normalized === undefined) store.delete(id);
            else {
              const current = request.result as Setlist | undefined;
              if (!current) {problem = 'Setlisten finnes ikke lenger. Avbryt og åpne oversikten på nytt.'; tx.abort(); return;}
              result = {...current, name: normalized}; store.put(result);
            }
          } catch {tx.abort();}
        };
        tx.oncomplete = () => {db.close(); resolve(result);};
        tx.onabort = tx.onerror = () => {db.close(); reject(new Error(problem));};
      } catch {db.close(); reject(new Error(problem));}
    });
  }
  async function writeSongbook(id: string, name: string, create: boolean): Promise<Songbook> {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result: Songbook;
      let problem = new Error('Kunne ikke lagre sangboken. Prøv igjen; tidligere data og navneutkastet er beholdt.');
      try {
        const tx = db.transaction('songbooks', 'readwrite'), store = tx.objectStore('songbooks'), request = store.getAll();
        request.onsuccess = () => {
          try {
            const books = request.result as Songbook[], current = books.find(book => book.id === id);
            if (!create && !current) {problem = new MissingSongbookError(); tx.abort(); return;}
            const normalized = songbookName(name, books, create ? undefined : id);
            result = {...current, id, name: normalized};
            if (create) store.add(result); else store.put(result);
          } catch (error) {if (error instanceof Error && !(error instanceof DOMException)) problem = error; try {tx.abort();} catch { /* Already aborted by the browser. */ }}
        };
        tx.oncomplete = () => {db.close(); resolve(result);};
        tx.onabort = () => {db.close(); reject(problem);};
      } catch {db.close(); reject(problem);}
    });
  }
  async function deleteSongbook(id: string, targetId: string | null): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      let problem = new Error('Kunne ikke slette sangboken. Ingen sanger er flyttet; prøv igjen.');
      try {
        const tx = db.transaction(['songs', 'songbooks'], 'readwrite'), books = tx.objectStore('songbooks'), songs = tx.objectStore('songs');
        const readBooks = books.getAll(), readSongs = songs.getAll();
        let reads = 0;
        const ready = () => {
          if (++reads !== 2) return;
          try {
            const currentBooks = readBooks.result as Songbook[];
            if (!currentBooks.some(book => book.id === id)) throw new MissingSongbookError();
            if (currentBooks.length <= 1) throw new Error('Den siste sangboken kan ikke slettes. Opprett en annen sangbok først.');
            const affected = (readSongs.result as Song[]).filter(song => song.songbookId === id);
            if (affected.length && (targetId === id || !currentBooks.some(book => book.id === targetId))) throw new Error('Velg en annen sangbok som sangene skal overføres til.');
            for (const song of affected) songs.put({...song, songbookId: targetId!});
            books.delete(id);
          } catch (error) {if (error instanceof Error && !(error instanceof DOMException)) problem = error; try {tx.abort();} catch { /* Already aborted by the browser. */ }}
        };
        readBooks.onsuccess = ready; readSongs.onsuccess = ready;
        tx.oncomplete = () => {db.close(); resolve();};
        tx.onabort = () => {db.close(); reject(problem);};
      } catch {db.close(); reject(problem);}
    });
  }
  return {
    createSongbook: (id: string, name: string) => writeSongbook(id, name, true),
    renameSongbook: (id: string, name: string) => writeSongbook(id, name, false),
    deleteSongbook,
    setlists: () => transaction<Setlist[]>('setlists', 'readonly', store => store.getAll()),
    createSetlist: (id: string, name: string) => writeSetlist(id, name, true),
    renameSetlist: (id: string, name: string) => writeSetlist(id, name),
    deleteSetlist: (id: string) => writeSetlist(id),
    updatePersonal,
    async library(): Promise<LibrarySnapshot> {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['songs', 'songbooks', 'personal'], 'readonly');
        const songs = tx.objectStore('songs').getAll(), books = tx.objectStore('songbooks').getAll();
        const metadata: LibrarySnapshot['personal'] = [];
        const cursor = tx.objectStore('personal').openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          const {songId, capo, tuning} = entry.value as SongPersonal;
          metadata.push({songId, capo, tuning}); entry.continue();
        };
        tx.oncomplete = () => {db.close(); resolve({songs: songs.result, songbooks: books.result, personal: metadata});};
        tx.onabort = tx.onerror = () => {db.close(); reject(new Error('Kunne ikke lese sanglisten og metadata. Prøv igjen; lagrede data er beholdt.'));};
      });
    },
    async saveDraft(song: Song, baseline: Song | null, change?: (current: SongPersonal) => SongPersonal): Promise<void> {
      const db = await open();
      return new Promise((resolve,reject) => {
        let problem = new Error('Kunne ikke lagre sangen og personlige endringer. Prøv igjen; utkastet er beholdt.');
        const fail = (message:string):never => {problem=new Error(message);throw problem;};
        try {
          const tx = db.transaction(['songs','personal','songbooks'],'readwrite');
          const songStore = tx.objectStore('songs'), personalStore = tx.objectStore('personal');
          const storedSong = songStore.get(song.id), storedPersonal = personalStore.get(song.id), book = tx.objectStore('songbooks').get(song.songbookId);
          let reads = 0;
          const ready = () => {
            if (++reads !== 3) return;
            try {
              const current: Song | undefined = storedSong.result;
              const personal = cleanPersonal(storedPersonal.result ?? {songId:song.id,chorus:{}});
              const projected = current ? reconcilePersonal(current, song, personal) : personal;
              const next = cleanPersonal(change ? change(projected) : projected);
              if (!baseline) {
                if (!book.result) {problem = new MissingSongbookError(); throw problem;}
                if (current) fail('Sangen er allerede opprettet. Åpne den på nytt før videre redigering.');
                songStore.add(song);
              } else if (baseline.original !== song.original) {
                if (!current || current.original !== baseline.original) fail('Originalen er endret i en annen fane. Utkastet er beholdt; åpne sangen på nytt før videre lagring.');
                if(!song.title.trim())fail('Skriv en tittel før sangen lagres.');
                songStore.put({...current,original:song.original,title:song.title,key:song.key});
              } else if (change && (!current || current.original !== baseline.original)) {
                fail('Originalen er endret i en annen fane. Personutkastet er beholdt; åpne sangen på nytt.');
              }
              if (change || current?.original !== song.original || JSON.stringify(personal) !== JSON.stringify(storedPersonal.result)) personalStore.put({...next,songId:song.id});
            } catch {tx.abort();}
          };
          storedSong.onsuccess = ready; storedPersonal.onsuccess = ready; book.onsuccess = ready;
          tx.oncomplete = () => {db.close();resolve();};
          tx.onabort = () => {db.close();reject(problem);};
        } catch {db.close();reject(problem);}
      });
    },
    list: () => transaction<Song[]>('songs', 'readonly', store => store.getAll()),
    async add(song: Song): Promise<void> {
      const db = await open();
      return new Promise((resolve, reject) => {
        let problem = new Error('Kunne ikke lagre sangen. Lagringen kan være full eller utilgjengelig. Prøv igjen; tidligere data er beholdt.');
        try {
          const tx = db.transaction(['songs', 'songbooks'], 'readwrite'), book = tx.objectStore('songbooks').get(song.songbookId);
          book.onsuccess = () => {
            if (!book.result) {problem = new MissingSongbookError(); tx.abort(); return;}
            try {tx.objectStore('songs').add(song);} catch {tx.abort();}
          };
          tx.oncomplete = () => {db.close(); resolve();};
          tx.onabort = () => {db.close(); reject(problem);};
        } catch {db.close(); reject(problem);}
      });
    },
    personal: readPersonal,
    savePersonal: (state: SongPersonal) => transaction('personal', 'readwrite', store => store.put(cleanPersonal(state))),
  };
}
