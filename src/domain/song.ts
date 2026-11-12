import type {Annotation, PersonalNote} from './annotations.ts';
import {parseChordPro} from './chordpro.ts';
import {standardSongbook} from './songbook.ts';
export interface SongOrigin {
  kind: 'local' | 'external';
  filename: string;
  importedAt: string;
  provider?: string;
  sourceId?: string;
  fileId?: string;
  relativePath?: string;
}
export interface Song {id: string; songbookId: string; original: string; title: string; key: string | null; origin: SongOrigin; sync?: {access: 'private' | 'shared' | 'import'; deleted?: boolean; detached?: boolean; folderId?: string; sourceRev?: string; pending?: boolean}}
export interface SongPersonal {songId: string; chorus: Record<string, boolean>; chordGrid?: string; version?: 2 | 3; capo?: number | null; chordView?: 'sounding' | 'grips'; tuning?: string; notes?: Record<string, PersonalNote>; annotations?: Record<string, Annotation>}
export const acceptedExtensions = '.cho,.chordpro,.chopro,.crd,.pro,.chord,.txt';
export function decodeSong(bytes: Uint8Array): string {
  let original: string;
  try {original = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);}
  catch {throw new Error('Filen kan ikke leses som UTF-8. Lagre den som UTF-8 og prøv igjen.');}
  if (!original.replace(/^\uFEFF/, '').trim()) throw new Error('Filen er tom. Velg en fil med sangtekst.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(original)) throw new Error('Filen ser ut til å være binær. Velg en tekstfil i ChordPro- eller TXT-format.');
  return original;
}
export function createSong(filename: string, bytes: Uint8Array): Song {
  if (!acceptedExtensions.split(',').some(extension => filename.toLowerCase().endsWith(extension))) throw new Error('Velg en ChordPro-fil (.cho, .chordpro, .chopro, .crd, .pro, .chord) eller .txt.');
  const original = decodeSong(bytes);
  const parsed = parseChordPro(original, filename.replace(/\.[^.]+$/, '') || filename);
  return {id: crypto.randomUUID(), songbookId: standardSongbook.id, original, title: parsed.title, key: parsed.key,
    origin: {kind: 'local', filename, importedAt: new Date().toISOString()}};
}
