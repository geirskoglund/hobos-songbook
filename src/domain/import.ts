import type {Song} from './song.ts';
interface ImportCandidate {
  filename: string;
}
export const sameImportFilename = (a: string, b: string) => Boolean(a) && a === b;
/** Keep import identity policy independent of UI/storage; source identity can extend this input later. */
export function classifyImport(candidate: ImportCandidate, existing: Song[]): 'new' | 'possible-copy' {
  return existing.some(song => sameImportFilename(song.origin.filename, candidate.filename)) ? 'possible-copy' : 'new';
}
