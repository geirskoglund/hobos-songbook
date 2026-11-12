import {parseChordPro, type Content} from './chordpro.ts';
import type {Song, SongPersonal} from './song.ts';

export interface LineAnchor {songId: string; occurrence: string; sourceLine: number}
export interface Highlight {start: number; end: number; groupId?: string}
export interface Annotation {anchor: LineAnchor; highlights: Highlight[]}
export interface PersonalNote {line: number; text: string}
export interface LogicalLine {occurrence: string; sourceLine: number; text: string}

/** Explicit content lines, including blank lines and repeated chorus occurrences. Never screen wraps. */
export function logicalLines(song: Pick<Song, 'original' | 'title'>): LogicalLine[] {
  const result: LogicalLine[] = [];
  const add = (content: Content[], occurrence: string) => {
    for (const item of content) if ((item.kind==='line'||item.kind==='comment'||item.kind==='unknown') && item.sourceLine !== undefined) result.push({
      occurrence: `${occurrence}/line:${item.sourceLine}`, sourceLine: item.sourceLine,
      text: item.kind === 'line' ? item.segments.map(segment => segment.text).join('') : item.text,
    });
  };
  for (const block of parseChordPro(song.original, song.title).blocks) {
    if (block.kind === 'chorus') add(block.content, 'source');
    else if (block.kind === 'reference') {if (block.content) add(block.content, block.occurrence);}
    else add([block], 'source');
  }
  return result;
}
export function anchorFor(song: Pick<Song, 'id'>, sourceLine: number, occurrence: string, _text?: string): LineAnchor {
  return {songId: song.id, sourceLine, occurrence};
}
export function noteAt(personal: SongPersonal, line: number): [string, PersonalNote] | undefined {
  return Object.entries(personal.notes ?? {}).find(([, note]) => note.line === line);
}
export function changeNote(current: SongPersonal, id: string, note: PersonalNote | undefined): SongPersonal {
  const notes = {...current.notes};
  if (note?.text.trim()) notes[id] = note; else delete notes[id];
  return {...current, notes: Object.keys(notes).length ? notes : undefined};
}
/** No empty records, source snapshots or note text in highlight anchors. */
export function changeAnnotation(current: SongPersonal, anchor: LineAnchor, patch: {highlights: Highlight[]}): SongPersonal {
  const annotations = {...current.annotations};
  if (patch.highlights.length) annotations[anchor.occurrence] = {anchor: anchorFor({id:anchor.songId}, anchor.sourceLine, anchor.occurrence), highlights: patch.highlights};
  else delete annotations[anchor.occurrence];
  return {...current, annotations: Object.keys(annotations).length ? annotations : undefined};
}
/** Old test annotations are intentionally discarded. All unrelated personal fields survive. */
export function cleanPersonal(current: SongPersonal): SongPersonal {
  const {annotations: oldAnnotations, notes: oldNotes, ...rest} = current;
  let result: SongPersonal = {...rest, version: 3};
  for (const [id, note] of Object.entries(oldNotes ?? {})) {
    if (note && Number.isInteger(note.line) && note.line >= 0 && typeof note.text === 'string') result = changeNote(result, id, {line: note.line, text: note.text});
  }
  for (const [key, annotation] of Object.entries(oldAnnotations ?? {})) {
    if (!annotation?.anchor || annotation.anchor.occurrence !== key || !Array.isArray(annotation.highlights)) continue;
    const anchor = annotation.anchor;
    if ('note' in annotation || 'original' in anchor || 'text' in anchor || 'before' in anchor || 'after' in anchor) continue;
    if (anchor.songId !== current.songId || !Number.isInteger(anchor.sourceLine) || anchor.sourceLine < 0) continue;
    const ranges = annotation.highlights.filter(range => range && Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end > range.start)
      .map(range => ({start: range.start, end: range.end, ...(typeof range.groupId === 'string' ? {groupId: range.groupId} : {})}));
    result = changeAnnotation(result, anchor, {highlights: ranges});
  }
  return result;
}

/** Stable positions stay put; collisions and missing positions are queued below the content. */
export function notePlacements(personal: SongPersonal, available: number[]): {id: string; note: PersonalNote; line?: number}[] {
  const used = new Set<number>(), last = available.at(-1);
  return Object.entries(personal.notes ?? {}).sort(([aId, a], [bId, b]) => a.line - b.line || aId.localeCompare(bId)).map(([id, note]) => {
    const target = available.includes(note.line) ? note.line : note.line > (last ?? -1) ? last : undefined;
    const line = target !== undefined && !used.has(target) ? target : undefined;
    if (line !== undefined) used.add(line);
    return {id, note, line};
  });
}

/** Conservative line alignment. Ambiguous repeated text never acquires somebody else's highlight. */
function align(before: LogicalLine[], after: LogicalLine[]): Map<number, number> {
  const mapped = new Map<number, number>();
  let left = 0, oldEnd = before.length, newEnd = after.length;
  while (left < oldEnd && left < newEnd && before[left].text === after[left].text) {mapped.set(left, left);left++;}
  while (oldEnd > left && newEnd > left && before[oldEnd - 1].text === after[newEnd - 1].text) {mapped.set(--oldEnd, --newEnd);}
  const oldCount = oldEnd - left, newCount = newEnd - left;
  if (oldCount * newCount <= 1_000_000) {
    const table = Array.from({length: oldCount + 1}, () => new Uint32Array(newCount + 1));
    for (let i = oldCount - 1; i >= 0; i--) for (let j = newCount - 1; j >= 0; j--) table[i][j] = before[left + i].text === after[left + j].text ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0, j = 0;
    while (i < oldCount && j < newCount) {
      if (before[left + i].text === after[left + j].text) {mapped.set(left + i++, left + j++);}
      else if (table[i + 1][j] >= table[i][j + 1]) i++; else j++;
    }
  }
  const boundaries = [[left - 1, left - 1], ...[...mapped].filter(([a, b]) => a >= left && a < oldEnd && b < newEnd).sort(([a], [b]) => a - b), [oldEnd, newEnd]];
  for (let n = 1; n < boundaries.length; n++) {
    const [a, b] = boundaries[n - 1], [c, d] = boundaries[n];
    if (c - a === 2 && d - b === 2) mapped.set(a + 1, b + 1);
  }
  const count = (rows: LogicalLine[], text: string) => rows.filter(row => row.text === text).length;
  for (const [from, to] of mapped) if (before[from].text === after[to].text && count(before, before[from].text) !== count(after, before[from].text)) mapped.delete(from);
  return mapped;
}
function shiftRange(range: Highlight, before: string, after: string): Highlight | undefined {
  if (range.end > before.length) return;
  if (before === after) return range;
  let start = 0, tail = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (tail < before.length - start && tail < after.length - start && before.at(-tail - 1) === after.at(-tail - 1)) tail++;
  if (range.end <= start) return range;
  if (range.start >= before.length - tail) {const delta = after.length - before.length;return {...range, start: range.start + delta, end: range.end + delta};}
}
/** Shared by local editing and future external updates; old/new text exists only during this operation. */
export function reconcilePersonal(before: Song, after: Song, personal: SongPersonal): SongPersonal {
  if (before.original === after.original) return personal;
  const oldRows = logicalLines(before), newRows = logicalLines(after), positions = align(oldRows, newRows);
  const sourceRows=(song:Song)=>song.original.replace(/^\uFEFF/,'').split(/\r\n|\r|\n/).map((text,index)=>({text,sourceLine:index,occurrence:`line:${index}`}));
  const oldSource=sourceRows(before),newSource=sourceRows(after),sourceMap=align(oldSource,newSource),chorus:Record<string,boolean>={};
  for(const [key,value] of Object.entries(personal.chorus)){const index=Number(key.replace(/^line:/,'')),next=sourceMap.get(index);if(next!==undefined&&/^\s*\{chorus\s*\}\s*$/i.test(newSource[next]?.text??''))chorus[`line:${next}`]=value;}
  let result: SongPersonal = {...personal, chorus, annotations: undefined};
  for (const annotation of Object.values(personal.annotations ?? {})) {
    const oldIndex = oldRows.findIndex(row => row.occurrence === annotation.anchor.occurrence), newIndex = positions.get(oldIndex);
    if (newIndex === undefined) continue;
    const from = oldRows[oldIndex], to = newRows[newIndex];
    const highlights = annotation.highlights.flatMap(range => {const shifted = shiftRange(range, from.text, to.text);return shifted ? [shifted] : [];});
    result = changeAnnotation(result, anchorFor(after, to.sourceLine, to.occurrence), {highlights});
  }
  return result;
}
