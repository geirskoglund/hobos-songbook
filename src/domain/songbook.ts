/** App grouping is independent of a song's file/provider identity. */
export interface Songbook {id: string; name: string}
export const standardSongbook: Readonly<Songbook> = {id: 'standard', name: 'Standard'};

/** One rule for every entry point, repeated inside the serialized write transaction. */
export function songbookName(value: string, books: readonly Songbook[], ownId?: string): string {
  const name = value.trim().normalize('NFC');
  if (!name) throw new Error('Skriv inn et navn på sangboken.');
  if (/[\\/<>:"|?*]/u.test(name)) throw new Error('Navnet kan ikke inneholde /, \\, <, >, :, ", |, ? eller *.');
  if (name.endsWith('.')) throw new Error('Navnet kan ikke avsluttes med punktum.');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) throw new Error('Dette navnet er reservert av systemet. Velg et annet navn.');
  const key = name.toLocaleLowerCase('nb');
  if (books.some(book => book.id !== ownId && book.name.normalize('NFC').toLocaleLowerCase('nb') === key)) throw new Error('Det finnes allerede en sangbok med dette navnet.');
  return name;
}

export function suggestedSongbook(books: readonly Songbook[], lastUsed: string | null, filter: string | null): string | null {
  if (books.length === 1) return books[0].id;
  return [lastUsed, filter].find(id => books.some(book => book.id === id)) ?? null;
}

export class MissingSongbookError extends Error {
  constructor() {super('Sangboken finnes ikke lenger. Velg en sangbok før du prøver å lagre igjen.');}
}
