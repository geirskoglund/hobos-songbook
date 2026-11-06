import {parseChordPro, type Block, type GridBlock, type ParsedSong} from './chordpro.ts';
import type {SongPersonal} from './song.ts';
function gridsIn(blocks: Block[]): GridBlock[] {
  return blocks.flatMap(block => block.kind === 'grid' ? block.rows.some(row =>
    row.kind === 'grid-row' ? Boolean(row.left.trim() || row.right.trim() || row.measures.some(measure => measure.cells.length)) :
      row.kind !== 'dynamic' && Boolean(row.text.trim())) ? [block] : [] : block.kind === 'chorus' ? gridsIn(block.content) : []);
}
/** One presentation; only the content source differs. Refrain references never duplicate grids. */
export function selectSongGrid(song: ParsedSong, personal: SongPersonal): {source: 'personal' | 'shared'; grids: GridBlock[]} | null {
  const privateText = personal.chordGrid?.trim();
  if (privateText) {
    const text = /\{(?:start_of_grid|sog)\b/i.test(privateText) ? privateText : `{start_of_grid}\n${privateText}\n{end_of_grid}`;
    const grids = gridsIn(parseChordPro(text, '').blocks);
    if (grids.length) return {source: 'personal', grids};
  }
  const grids = gridsIn(song.blocks);
  return grids.length ? {source: 'shared', grids} : null;
}
