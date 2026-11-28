import {folderName} from './songbook.ts';

/** A registered import: songs from a shared Dropbox folder (Mappe) are fetched into a songbook. */
export interface SharedImport {
  id: string;
  name: string;
  /** The shared folder's address, as the user entered it after trimming. */
  folder: string;
  songbookId: string;
}

/** Same characters and uniqueness as songbook names, unique among imports. */
export function importName(value: string, imports: readonly SharedImport[], ownId?: string): string {
  return folderName(value, imports, ownId, {
    empty: 'Skriv inn et navn på importen.',
    duplicate: 'Det finnes allerede en import med dette navnet.',
  });
}

export const notDropboxAddress = 'Adressen er ikke en Dropbox-adresse';

const folderKey = (value: string) => {
  const url = new URL(value);
  url.hash = '';
  return url.href.toLowerCase();
};

/** A Dropbox web address that no other import uses; checked before any Dropbox call. */
export function importFolder(value: string, imports: readonly SharedImport[], ownId?: string): string {
  const folder = value.trim();
  if (!folder) throw new Error('Skriv inn nettadressen til den delte mappen.');
  let url: URL;
  try {
    url = new URL(folder);
  } catch {
    throw new Error(notDropboxAddress);
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (host !== 'dropbox.com' && !host.endsWith('.dropbox.com'))
  )
    throw new Error(notDropboxAddress);
  const key = folderKey(folder);
  if (imports.some(item => item.id !== ownId && folderKey(item.folder) === key))
    throw new Error('En annen import bruker allerede denne mappen.');
  return folder;
}

/** The connection test's answers (#101 F05). Only `ok` makes the address tested. */
export type ImportTest = 'ok' | 'not-shared' | 'own-songbook' | 'not-found' | 'unavailable';
export const importTestText: Record<ImportTest, string> = {
  ok: 'Tilkobling ok',
  'not-shared': 'Tilkobling feilet: Mappen er ikke delt',
  'own-songbook': 'Tilkobling feilet: Peker til egen sangbok',
  'not-found': 'Tilkobling feilet: Finner ikke mappen',
  unavailable: 'Tilkobling feilet: Dropbox utilgjengelig',
};
