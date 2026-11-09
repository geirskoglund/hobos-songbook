import type {Song} from './song.ts';
export interface ImportCandidate {filename: string}
/** Keep import identity policy independent of UI/storage; source identity can extend this input later. */
export function classifyImport(candidate: ImportCandidate, existing: Song[]): 'new' | 'possible-copy' {
  return existing.some(song => song.origin.filename === candidate.filename) ? 'possible-copy' : 'new';
}
