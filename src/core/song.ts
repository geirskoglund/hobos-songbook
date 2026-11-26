/** Song data model shared by every layer. Logic on it lives in domain/. */
export interface LineAnchor {
  songId: string;
  occurrence: string;
  sourceLine: number;
}
export interface Highlight {
  start: number;
  end: number;
  groupId?: string;
}
export interface Annotation {
  anchor: LineAnchor;
  highlights: Highlight[];
}
export interface PersonalNote {
  line: number;
  text: string;
}
interface SongOrigin {
  kind: 'local' | 'external';
  filename: string;
  importedAt: string;
  provider?: string;
  sourceId?: string;
  fileId?: string;
  relativePath?: string;
}
export interface Song {
  id: string;
  songbookId: string;
  original: string;
  title: string;
  key: string | null;
  origin: SongOrigin;
}
export interface SongPersonal {
  songId: string;
  chorus: Record<string, boolean>;
  chordGrid?: string;
  version?: 2 | 3;
  capo?: number | null;
  chordView?: 'sounding' | 'grips';
  tuning?: string;
  notes?: Record<string, PersonalNote>;
  annotations?: Record<string, Annotation>;
}
