import type {Song, SongPersonal} from '../domain/song.ts';
import {cleanPersonal, reconcilePersonal} from '../domain/annotations.ts';
import {standardSongbook, type Songbook} from '../domain/songbook.ts';
import {setlistName, type Setlist} from '../domain/setlist.ts';
import {accessOf, dirtySong, emptySyncState, type SyncData, type SyncState} from '../domain/sync.ts';
export const schemaVersion = 4;
export interface LibrarySnapshot {songs: Song[]; songbooks: Songbook[]; personal: Pick<SongPersonal, 'songId' | 'capo' | 'tuning'>[]}
export function songStorage(namespace: string) {
  if (!['hobos-songbook-production', 'hobos-songbook-test'].includes(namespace)) throw new Error('Ugyldig lagringsmiljø.');
  const changed = () => {if(typeof window!=='undefined')window.dispatchEvent(new Event(`${namespace}:library-change`));};
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
        if (!db.objectStoreNames.contains('sync')) db.createObjectStore('sync', {keyPath: 'id'});
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
  /** The callback is synchronous: domain data and its outbox commit together. */
  async function syncTransaction<T>(change: (data: SyncData) => T, write = true): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const names = ['songs', 'personal', 'songbooks', 'setlists'] as const;
      const tx = db.transaction([...names, 'sync'], write ? 'readwrite' : 'readonly');
      const data = {} as SyncData; let remaining = 5, result: T, problem: unknown;
      const ready = () => {
        if (--remaining) return;
        try {
          const before = structuredClone(data);
          result = change(data);
          if (write) {
            for (const name of names) {
              const store = tx.objectStore(name), key = name === 'personal' ? 'songId' : 'id';
              const old = new Map(before[name].map(item => [(item as unknown as Record<string, string>)[key], JSON.stringify(item)]));
              for (const item of data[name]) {const id = (item as unknown as Record<string, string>)[key]; if(!old.has(id))store.add(item);else if(old.get(id)!==JSON.stringify(item))store.put(item);old.delete(id);}
              for (const id of old.keys()) store.delete(id);
            }
            if (JSON.stringify(before.state) !== JSON.stringify(data.state)) tx.objectStore('sync').put(data.state);
          }
        } catch (error) {problem = error; tx.abort();}
      };
      for (const name of names) {const r = tx.objectStore(name).getAll(); r.onsuccess = () => {Object.assign(data, {[name]: r.result}); ready();};}
      const r = tx.objectStore('sync').get('state'); r.onsuccess = () => {data.state = r.result ?? emptySyncState(); ready();};
      tx.oncomplete = () => {db.close(); resolve(result);};
      tx.onerror = tx.onabort = () => {db.close(); reject(problem instanceof Error && !(problem instanceof DOMException) ? problem : Error('Sanglageret er utilgjengelig. Kunne ikke lagre endringen og synkkøen. Tidligere data er beholdt.'));};
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
        const tx = db.transaction(['personal', 'sync'], 'readwrite'), store = tx.objectStore('personal');
        const sync = tx.objectStore('sync'), s = sync.get('state');
        const request = store.get(songId);
        request.onsuccess = () => {
          try {next = cleanPersonal(change(cleanPersonal(request.result ?? {songId, chorus: {}}))); store.put({...next, songId}); const state: SyncState = s.result ?? emptySyncState(); state.songs[songId] = dirtySong(songId, state.songs[songId]); sync.put(state);}
          catch {try {tx.abort();} catch { /* An injected or browser abort may already have ended the transaction. */ }}
        };
        tx.oncomplete = () => {db.close(); resolve(next);changed();};
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
        const tx = db.transaction(['setlists','sync'], 'readwrite'), store = tx.objectStore('setlists');
        const sync = tx.objectStore('sync'), s = sync.get('state');
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
            const state: SyncState = s.result ?? emptySyncState(); state.config.dirty = true; state.config.generation++; sync.put(state);
          } catch {tx.abort();}
        };
        tx.oncomplete = () => {db.close(); resolve(result);changed();};
        tx.onabort = tx.onerror = () => {db.close(); reject(new Error(problem));};
      } catch {db.close(); reject(new Error(problem));}
    });
  }
  return {
    syncTransaction,
    syncData: () => syncTransaction(data => data, false),
    async editing(songId: string, editing: boolean) {await syncTransaction(data => {const item = data.state.songs[songId] ?? {id: `song:${songId}`, songId, generation: 0, dirty: false, editing: false}; item.editing = editing; data.state.songs[songId] = item;});},
    async createSongbook(name: string): Promise<Songbook> {const trimmed = name.trim(); if (!trimmed) throw Error('Skriv et navn på sangboken.'); return syncTransaction(data => {if (data.songbooks.some(book => book.name.toLocaleLowerCase('nb') === trimmed.toLocaleLowerCase('nb'))) throw Error('En sangbok med dette navnet finnes allerede.'); const book = {id: crypto.randomUUID(), name: trimmed}; data.songbooks.push(book); data.state.config.dirty = true; data.state.config.generation++; return book;}).then(book=>{changed();return book;});},
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
        let problem = 'Kunne ikke lagre sangen og personlige endringer. Prøv igjen; utkastet er beholdt.';
        const fail = (message:string):never => {problem=message;throw new Error(message);};
        try {
          const tx = db.transaction(['songs','personal','sync'],'readwrite');
          const songStore = tx.objectStore('songs'), personalStore = tx.objectStore('personal');
          const sync = tx.objectStore('sync'), syncRequest = sync.get('state');
          const storedSong = songStore.get(song.id), storedPersonal = personalStore.get(song.id);
          let reads = 0;
          const ready = () => {
            if (++reads !== 3) return;
            try {
              const current: Song | undefined = storedSong.result;
              if (current && accessOf(current)==='import' && song.original !== current.original) fail('Importerte sanger har skrivebeskyttet filinnhold.');
              const personal = cleanPersonal(storedPersonal.result ?? {songId:song.id,chorus:{}});
              const projected = current ? reconcilePersonal(current, song, personal) : personal;
              const next = cleanPersonal(change ? change(projected) : projected);
              if (!baseline) {
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
              const state: SyncState = syncRequest.result ?? emptySyncState(); state.songs[song.id] = dirtySong(song.id, state.songs[song.id], true); sync.put(state);
            } catch {tx.abort();}
          };
          storedSong.onsuccess = ready; storedPersonal.onsuccess = ready; syncRequest.onsuccess = ready;
          tx.oncomplete = () => {db.close();resolve();};
          tx.onabort = tx.onerror = () => {db.close();reject(new Error(problem));};
        } catch {db.close();reject(new Error(problem));}
      });
    },
    list: () => transaction<Song[]>('songs', 'readonly', store => store.getAll()),
    add: (song: Song) => syncTransaction(data => {if (data.songs.some(item => item.id === song.id)) throw Error('Sangen finnes allerede.'); data.songs.push(song); data.state.songs[song.id] = dirtySong(song.id);}).then(()=>changed()),
    personal: readPersonal,
    savePersonal: (state: SongPersonal) => syncTransaction(data => {data.personal = [...data.personal.filter(item => item.songId !== state.songId), cleanPersonal(state)]; data.state.songs[state.songId] = dirtySong(state.songId, data.state.songs[state.songId]);}),
  };
}
