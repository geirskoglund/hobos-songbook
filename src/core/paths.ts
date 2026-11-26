// Faste stier i Dropbox-appmappen og nøkler i den lokale synklagringen.
// Verdiene er dataformat: endres de, finner appen ikke lenger dataene sine.

export const appFolder = '/.app';
export const libraryPath = '/.app/library.json';
export const mutationPath = '/.app/mutation.json';
export const uploadIndexPath = '/.app/upload-index.json';
export const syncErrorsPath = '/.app/sync-errors.json';
export const personalFolder = '/.app/songs';
export const stagingFolder = '/.app/uploads';
export const songbooksFolder = '/Songbooks';
export const deletedFolder = '/Deleted';
export const bookAreas = ['Private', 'Shared', 'Import', 'Originals'] as const;

/** Persondatafilen for en sang. */
export const personalPath = (songId: string) => `${personalFolder}/${songId}.json`;
/** Mellomlagret fil for en første opplasting. */
export const stagingPath = (id: string) => `${stagingFolder}/${id}.cho`;
/** Sangbokmappen for et sangboknavn. */
export const bookPath = (name: string) => `${songbooksFolder}/${name}`;
/** Midlertidig mappe for en sangbok under navneendring. */
export const renameStagingPath = (bookId: string) => `${songbooksFolder}/.rename-${bookId}`;
/** En sangbokmappe rett under Songbooks, uansett store og små bokstaver. */
export const isBookPath = (path: string) => /^\/Songbooks\/[^/]+$/i.test(path);

/** Nøkkelen til den lokale journalen i IndexedDB-lageret `sync`. */
export const journalKey = 'private-local-v1';
/** Nøkkelen til synktilstanden for en Dropbox-konto i IndexedDB-lageret `sync`. */
export const syncStateKey = (accountId: string) => `private-account-v1:${accountId}`;
