import {parseGridRow, gridOptions, type GridRow, type GridOptions} from './grid.ts';
export interface Segment {chord?: string; text: string}
export type DynamicLevel = 1 | 2 | 3 | 4 | 5;
export interface DynamicDirective {kind: 'dynamic'; level: DynamicLevel}
export type GridContent = GridRow | DynamicDirective | {kind: 'comment' | 'unknown'; text: string};
export interface GridBlock {kind: 'grid'; options: GridOptions; rows: GridContent[]}
export type Content = {kind: 'line'; segments: Segment[]; sourceLine?: number} | {kind: 'comment' | 'unknown'; text: string} | DynamicDirective | GridBlock;
export type Block = Content | {kind: 'chorus'; content: Content[]} | {kind: 'reference'; occurrence: string; content: Content[] | null};
export interface ParsedSong {title: string; key: string | null; blocks: Block[]}

// Deliberately conservative: bracketed prose/legacy markers remain readable text.
export function isChord(value: string): boolean {
  return /^(?:[A-GH](?:#|b|♯|♭)?(?:(?:maj|min|dim|aug|sus|add|omit|no|m|M|Δ|ø|°|\+|-)|\d|[#b♯♭(),])*?(?:\/[A-GH](?:#|b|♯|♭)?)?|N\.?C\.?)$/.test(value);
}
export function parseLine(line: string): Segment[] {
  const result: Segment[] = [];
  let text = '', chord: string | undefined;
  for (const token of line.split(/(\[[^\]\r\n]*\])/)) {
    if (token.startsWith('[') && token.endsWith(']') && isChord(token.slice(1, -1))) {
      if (text || chord) result.push({chord, text});
      text = ''; chord = token.slice(1, -1);
    } else text += token;
  }
  if (text || chord || !result.length) result.push({chord, text});
  return result;
}
export function parseChordPro(original: string, fallbackTitle: string): ParsedSong {
  const song: ParsedSong = {title: fallbackTitle, key: null, blocks: []};
  let chorus: Content[] | null = null, previous: Content[] | null = null;
  let grid: GridBlock | null = null, previousGrid: GridOptions | undefined;
  const emit = (block: Content) => {if (chorus) chorus.push(block); else song.blocks.push(block);};
  const finishGrid = () => {if (grid) {emit(grid); grid = null;}};
  const emitInstruction = (block: DynamicDirective | {kind: 'comment' | 'unknown'; text: string}) => {if (grid) grid.rows.push(block); else emit(block);};
  const finish = () => {if (chorus) {song.blocks.push({kind: 'chorus', content: chorus}); previous = chorus; chorus = null;}};
  // Only this derived working copy normalizes line endings/BOM.
  original.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).forEach((line, index) => {
    const directive = line.trim().match(/^\{([a-z_]+)(?:(?:\s*:\s*|\s+)(.*?))?\s*\}$/i);
    if (!directive) {if (grid) grid.rows.push(parseGridRow(line)); else emit({kind: 'line', segments: parseLine(line), sourceLine: index}); return;}
    const name = directive[1].toLowerCase(), value = directive[2] ?? '';
    switch (name) {
      case 'title': case 't': if (value.trim()) song.title = value.trim(); break;
      case 'key': song.key = value.trim() || null; break;
      case 'comment': case 'c': emitInstruction({kind: 'comment', text: value}); break;
      case 'x_dyn':
        if (/^[1-5]$/.test(value.trim())) emitInstruction({kind: 'dynamic', level: Number(value.trim()) as DynamicLevel});
        else emitInstruction({kind: 'comment', text: `Ugyldig dynamikknivå «${value}». Bruk 1–5; forrige nivå beholdes.`});
        break;
      case 'start_of_grid': case 'sog':
        finishGrid(); previousGrid = gridOptions(value, previousGrid);
        grid = {kind: 'grid', options: previousGrid, rows: []}; break;
      case 'end_of_grid': case 'eog': finishGrid(); break;
      case 'soc': case 'start_of_chorus': finishGrid(); finish(); chorus = []; break;
      case 'eoc': case 'end_of_chorus': finishGrid(); finish(); break;
      case 'chorus':
        finishGrid(); finish(); song.blocks.push({kind: 'reference', occurrence: `line:${index}`, content: previous}); break;
      default: emitInstruction({kind: 'unknown', text: line});
    }
  });
  finishGrid(); finish(); return song;
}
