import { isChord } from './chordpro.ts';
import { withOriginal } from './original.ts';
import { shiftChord, shiftGridText } from './personal.ts';
import type { Song } from './song.ts';
export interface SourceLine {
  index: number;
  start: number;
  end: number;
  text: string;
  ending: string;
  directive?: {
    name: string;
    value: string;
    start: number;
    end: number;
  };
}
export interface SourceEdit {
  start: number;
  end: number;
  text: string;
}
/** Offsets refer to the untouched source, including BOM and original line endings. */
export function sourceLines(source: string): SourceLine[] {
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const lines: SourceLine[] = [];
  for (const m of source.slice(bom).matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (!m[0] && lines.length) continue;
    const start = bom + m.index!,
      text = m[1],
      tag = text.match(/^(\s*\{([a-z_]+)(?:\s*:\s*|\s+)?)(.*?)(\}\s*)$/i);
    lines.push({
      index: lines.length,
      start,
      end: start + m[0].length,
      text,
      ending: m[2],
      directive: tag ? {
        name: tag[2].toLowerCase(),
        value: tag[3],
        start: start + tag[1].length,
        end: start + tag[1].length + tag[3].length
      } : undefined
    });
  }
  return lines;
}
export const lineEnding = (source: string) => source.match(/\r\n|\r|\n/)?.[0] ?? '\n';
/** Textareas normalize endings. Reuse the exact original bytes of unchanged lines. */
export function mergeRawSource(original: string, text: string): string {
  if (original.replace(/\r\n|\r/g, '\n') === text) return original;
  const split = (source: string) => [...source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)].filter(m => m[0]).map(m => ({
    text: m[1],
    ending: m[2]
  }));
  const before = split(original),
    after = split(text),
    mapped = new Map<number, number>();
  let left = 0,
    a = before.length,
    b = after.length;
  while (left < a && left < b && before[left].text === after[left].text) {
    mapped.set(left, left);
    left++;
  }
  while (a > left && b > left && before[a - 1].text === after[b - 1].text) mapped.set(--b, --a);
  if ((a - left) * (b - left) <= 1_000_000) {
    const dp = Array.from({
      length: a - left + 1
    }, () => new Uint32Array(b - left + 1));
    for (let i = a - left - 1; i >= 0; i--) for (let j = b - left - 1; j >= 0; j--) dp[i][j] = before[left + i].text === after[left + j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < a - left && j < b - left) {
      if (before[left + i].text === after[left + j].text) {
        mapped.set(left + j, left + i);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;else j++;
    }
  }
  const ending = lineEnding(original);
  return after.map((row, index) => row.text + (row.ending ? before[mapped.get(index) ?? -1]?.ending || ending : '')).join('');
}
export function patchSong(song: Song, edits: SourceEdit[]): Song {
  let source = song.original,
    last = source.length + 1;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > last) throw Error('Endringen overlapper en annen struktur. Bruk Råtekst for å avklare innholdet.');
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    last = edit.start;
  }
  return withOriginal(song, source);
}
export function setMetadata(song: Song, field: 'title' | 'key' | 'time', value: string): Song {
  const clean = value.trim();
  if (field === 'title' && !clean) throw Error('Skriv en tittel.');
  if (/[\r\n{}]/.test(clean)) throw Error('Verdien kan ikke inneholde linjeskift eller klammer.');
  const matches = sourceLines(song.original).filter(l => l.directive && (l.directive.name === field || field === 'title' && l.directive.name === 't'));
  if (matches.length > 1) throw Error('Flere direktiver for dette feltet. Rett dem i Råtekst først.');
  const row = matches[0];
  if (row) {
    const d = row.directive!;
    return patchSong(song, [clean ? {
      start: d.start,
      end: d.end,
      text: clean
    } : {
      start: row.start,
      end: row.end,
      text: ''
    }]);
  }
  return clean ? patchSong(song, [{
    start: song.original.startsWith('\uFEFF') ? 1 : 0,
    end: song.original.startsWith('\uFEFF') ? 1 : 0,
    text: `{${field}: ${clean}}${lineEnding(song.original)}`
  }]) : song;
}
export function sourceChords(line: SourceLine) {
  let removed = 0;
  return [...line.text.matchAll(/\[([^\]\r\n]*)\]/g)].flatMap(m => {
    if (!isChord(m[1])) return [];
    const result = {
      start: line.start + m.index!,
      end: line.start + m.index! + m[0].length,
      offset: m.index! - removed,
      value: m[1]
    };
    removed += m[0].length;
    return [result];
  });
}
export function setChord(song: Song, lineIndex: number, offset: number, value: string, existing?: number): Song {
  const row = sourceLines(song.original)[lineIndex];
  if (!row) throw Error('Tekstposisjonen finnes ikke lenger.');
  const chord = value.trim();
  if (chord && !isChord(chord)) throw Error('Skriv en gyldig akkord, for eksempel C, F#m7 eller D/F#.');
  const tokens = sourceChords(row),
    token = existing === undefined ? undefined : tokens.find(t => t.start === existing);
  if (existing !== undefined && !token) throw Error('Akkorden er endret. Velg den på nytt.');
  let at = row.start + offset;
  for (const item of tokens) if (item.offset <= offset) at += item.end - item.start;
  return patchSong(song, [{
    start: token?.start ?? Math.min(at, row.start + row.text.length),
    end: token?.end ?? Math.min(at, row.start + row.text.length),
    text: chord ? `[${chord}]` : ''
  }]);
}
export function insertDirective(song: Song, lineIndex: number, text: string): Song {
  const row = sourceLines(song.original)[lineIndex],
    at = row?.start ?? song.original.length,
    nl = lineEnding(song.original);
  return patchSong(song, [{
    start: at,
    end: at,
    text: (at === song.original.length && at && !/[\r\n]$/.test(song.original) ? nl : '') + text + nl
  }]);
}
export function setDirective(song: Song, lineIndex: number, name: string, value: string): Song {
  const row = sourceLines(song.original)[lineIndex];
  if (!row?.directive) throw Error('Elementet finnes ikke lenger. Velg det på nytt.');
  return patchSong(song, [{
    start: row.directive.start,
    end: row.directive.end,
    text: value
  }]);
}
export interface SourceBlock {
  start: SourceLine;
  end?: SourceLine;
}
export function sourceBlocks(source: string, kind: 'chorus' | 'grid'): SourceBlock[] {
  const start = kind === 'chorus' ? ['soc', 'start_of_chorus'] : ['sog', 'start_of_grid'],
    end = kind === 'chorus' ? ['eoc', 'end_of_chorus'] : ['eog', 'end_of_grid'];
  const blocks: SourceBlock[] = [];
  let open: SourceLine | undefined;
  for (const row of sourceLines(source)) {
    if (start.includes(row.directive?.name ?? '')) {
      if (open) blocks.push({
        start: open
      });
      open = row;
    }
    if (end.includes(row.directive?.name ?? '') && open) {
      blocks.push({
        start: open,
        end: row
      });
      open = undefined;
    }
  }
  if (open) blocks.push({
    start: open
  });
  return blocks;
}
export function setChorus(song: Song, from: number, to: number, existing?: number): Song {
  const rows = sourceLines(song.original),
    first = rows[Math.min(from, to)],
    last = rows[Math.max(from, to)],
    blocks = sourceBlocks(song.original, 'chorus');
  if (!first || !last) throw Error('Velg tekstlinjer til refrenget.');
  const old = blocks.find(b => b.start.index === existing);
  if (blocks.some(b => b !== old && first.index <= (b.end?.index ?? rows.length) && last.index >= b.start.index)) throw Error('Refreng kan ikke overlappe. Juster utvalget eller bruk Råtekst.');
  const nl = lineEnding(song.original),
    edits: SourceEdit[] = [];
  if (old) {
    edits.push({
      start: old.start.start,
      end: old.start.end,
      text: ''
    });
    if (old.end) edits.push({
      start: old.end.start,
      end: old.end.end,
      text: ''
    });
  }
  edits.push({
    start: first.start,
    end: first.start,
    text: `{soc}${nl}`
  }, {
    start: last.end,
    end: last.end,
    text: `${last.ending ? '' : nl}{eoc}${nl}`
  });
  return patchSong(song, edits);
}
export function removeSourceBlock(song: Song, block: SourceBlock): Song {
  return patchSong(song, [{
    start: block.start.start,
    end: block.start.end,
    text: ''
  }, ...(block.end ? [{
    start: block.end.start,
    end: block.end.end,
    text: ''
  }] : [])]);
}
export function keyInterval(from: string, to: string): number {
  const pitch = (key: string) => {
    const m = key.match(/^([A-GH])([#b♯♭]?)(?:m|min|maj)?$/);
    if (!m) throw Error('Skriv en toneart, for eksempel D, Bb eller Am.');
    const roots:Record<string,number>={
      C: 0,
      D: 2,
      E: 4,
      F: 5,
      G: 7,
      A: 9,
      B: 11,
      H: 11
    };
    return roots[m[1]] + (/[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0);
  };
  return (pitch(to) - pitch(from) + 12) % 12;
}
export function transposeSong(song: Song, key: string): {
  song: Song;
  interval: number;
} {
  const interval = song.key && key ? keyInterval(song.key, key) : 0;
  if (key) keyInterval(key, key);
  const blocks = sourceBlocks(song.original, 'grid'),
    edits: SourceEdit[] = [];
  if(blocks.some(block=>!block.end))throw Error('Skjemaet mangler en entydig slutt. Rett det i Råtekst før transponering.');
  for (const block of blocks) {
    const start = block.start.end,
      end = block.end?.start ?? song.original.length;
    edits.push({
      start,
      end,
      text: shiftGridText(song.original.slice(start, end), interval)
    });
  }
  for (const row of sourceLines(song.original)) if (!row.directive && !blocks.some(b => row.index > b.start.index && row.index < (b.end?.index ?? Infinity))) for (const chord of sourceChords(row)) edits.push({
    ...chord,
    text: `[${shiftChord(chord.value, interval)}]`
  });
  return {
    song: setMetadata(patchSong(song, edits), 'key', key),
    interval
  };
}
