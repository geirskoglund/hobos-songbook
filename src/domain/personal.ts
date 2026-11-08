import {isChord, parseChordPro, type GridBlock} from './chordpro.ts';
import type {Song, SongPersonal} from './song.ts';

export interface LineAnchor {
  songId: string;
  occurrence: string;
  sourceLine: number;
  text: string;
  before: string;
  after: string;
  original: string;
}
/** Half-open offsets in UTF-16 code units, matching DOM Range and textarea selection. */
export interface Highlight {start: number; end: number; groupId?: string}
export interface Annotation {anchor: LineAnchor; note: string; highlights: Highlight[]}
/** Compare editable values, treating absent defaults and empty annotations alike. */
export function personalChanges(before: SongPersonal, after: SongPersonal): ((current: SongPersonal) => SongPersonal) | undefined {
  const fields: Partial<SongPersonal> = {};
  if ((before.capo ?? 0) !== (after.capo ?? 0)) fields.capo = after.capo ?? 0;
  if ((before.tuning ?? '') !== (after.tuning ?? '')) fields.tuning = after.tuning ?? '';
  if ((before.chordGrid ?? '') !== (after.chordGrid ?? '')) fields.chordGrid = after.chordGrid;
  const annotations: {anchor: LineAnchor; patch: Partial<Pick<Annotation, 'note' | 'highlights'>>}[] = [];
  for (const key of new Set([...Object.keys(before.annotations ?? {}), ...Object.keys(after.annotations ?? {})])) {
    const a = before.annotations?.[key], b = after.annotations?.[key], patch: Partial<Pick<Annotation, 'note' | 'highlights'>> = {};
    if ((a?.note ?? '') !== (b?.note ?? '')) patch.note = b?.note ?? '';
    if (JSON.stringify(a?.highlights ?? []) !== JSON.stringify(b?.highlights ?? [])) patch.highlights = b?.highlights ?? [];
    if (Object.keys(patch).length) annotations.push({anchor:(b ?? a)!.anchor, patch});
  }
  if (!Object.keys(fields).length && !annotations.length) return;
  return current => annotations.reduce((state, {anchor, patch}) => changeAnnotation(state, anchor, patch), {...current, ...fields});
}
/** Patch only the edited annotation field, preserving changes made in another tab. */
export function changeAnnotation(current: SongPersonal, anchor: LineAnchor, patch: Partial<Pick<Annotation, 'note' | 'highlights'>>): SongPersonal {
  const existing = current.annotations?.[anchor.occurrence];
  return {...current, annotations: {...current.annotations, [anchor.occurrence]: {
    anchor, note: '', highlights: [], ...existing, ...patch,
  }}};
}
export function anchorFor(song: Song, sourceLine: number, occurrence: string, text: string): LineAnchor {
  const lines = song.original.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  return {songId: song.id, occurrence, sourceLine, text, before: lines[sourceLine - 1] ?? '', after: lines[sourceLine + 1] ?? '', original: song.original};
}
export function validCapo(value: number): boolean {return Number.isInteger(value) && value >= 0 && value <= 12;}
const pitch: Record<string, number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11,H:11};
/** B is international B natural; H is its accepted alias. Never infer legacy German B-flat. */
export function transposeChord(value: string, capo: number): string {
  return validCapo(capo) ? shiftChord(value, -capo) : value;
}
/** Musical transposition; positive values raise the stored pitch. */
export function shiftChord(value: string, semitones: number): string {
  if (!Number.isInteger(semitones) || !isChord(value) || /^N\.?C\.?$/.test(value) || semitones % 12 === 0) return value;
  const flats = /[b♭]/.test(value);
  const names = flats ? ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'] : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return value.replace(/(^|\/)([A-GH])([#b♯♭]?)/g, (_, prefix: string, root: string, accidental: string) => {
    const offset = /[#♯]/.test(accidental) ? 1 : /[b♭]/.test(accidental) ? -1 : 0;
    return prefix + names[((pitch[root] + offset + semitones) % 12 + 12) % 12];
  });
}
/** Transform chord cells only; preserve directives, margins, bars and whitespace verbatim. */
export function shiftGridText(text: string, semitones: number): string {
  return text.split(/(\r\n|\n|\r)/).map(line => {
    if (/^\s*\{/.test(line)) return line;
    const bars = [...line.matchAll(/:\|(?:\d+>?|:)?|\|(?:\||:|\.|\d+>?)?/g)];
    let result = '', at = 0;
    for (let index = 0; index < bars.length - 1; index++) {
      const start = bars[index].index! + bars[index][0].length, end = bars[index + 1].index!;
      result += line.slice(at, start) + line.slice(start, end).replace(/\S+/g, token => token.split('~').map(part => {
        const bracket = part.startsWith('[') && part.endsWith(']');
        const chord = bracket ? part.slice(1, -1) : part;
        return bracket ? `[${shiftChord(chord, semitones)}]` : shiftChord(chord, semitones);
      }).join('~'));
      at = end;
    }
    return result + line.slice(at);
  }).join('');
}
export function gripKey(key: string | null, capo: number): string | null {
  return key && /^[A-GH][#b♯♭]?(?:m|min|maj)?$/.test(key) ? transposeChord(key, capo) : null;
}
export function transposeGrid(grid: GridBlock, capo: number): GridBlock {
  return {...grid, rows: grid.rows.map(row => row.kind !== 'grid-row' ? row : {...row, measures: row.measures.map(measure => ({...measure, cells: measure.cells.map(cell => cell.split('~').map(token => {
    const bracket = token.startsWith('[') && token.endsWith(']');
    const chord = bracket ? token.slice(1, -1) : token;
    return bracket ? `[${transposeChord(chord, capo)}]` : transposeChord(chord, capo);
  }).join('~'))}))})};
}
export function validGrid(text: string): boolean {
  if (!text.trim()) return false;
  const wrapped = /\{(?:start_of_grid|sog)\b/i.test(text) ? text : `{sog}\n${text}\n{eog}`;
  const parsed = parseChordPro(wrapped, '');
  return parsed.blocks.some(block => block.kind === 'grid' && block.rows.some(row => row.kind === 'grid-row' && row.measures.some(measure => measure.cells.length))) &&
    parsed.blocks.every(block => block.kind === 'grid' || block.kind === 'line' && block.segments.every(segment => !segment.text.trim() && !segment.chord));
}
export function sharedGridText(original: string): string {
  return [...original.matchAll(/^\s*\{(?:start_of_grid|sog)(?:\s*[: ]\s*.*?)?\}\s*\r?\n[\s\S]*?^\s*\{(?:end_of_grid|eog)\}\s*$/gmi)].map(match => match[0]).join('\n');
}
