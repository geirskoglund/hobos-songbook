import {isChord, type Content, type GridBlock, type DynamicLevel} from '../domain/chordpro.ts';
export interface DynamicsContext {level: DynamicLevel; spokenLevel?: DynamicLevel; chord?: (value: string) => string; occurrence?: string}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
function decorate(row: HTMLElement, context: DynamicsContext) {
  row.classList.add('dynamic-row'); row.dataset.dynamicLevel = String(context.level);
  if (context.spokenLevel !== context.level) {
    row.prepend(node('span', `Dynamikk: nivå ${context.level} av 5. `, 'sr-only dynamic-announce'));
    context.spokenLevel = context.level;
  }
  return row;
}
function instruction(level: DynamicLevel, context: DynamicsContext) {context.level = level;}
function chordText(text: string) {
  return text.startsWith('[') && text.endsWith(']') && isChord(text.slice(1, -1)) ? text.slice(1, -1) : text;
}
export function renderGrid(block: GridBlock): HTMLElement {
  const figure = node('figure', undefined, 'chord-grid');
  figure.setAttribute('aria-label', block.options.label || 'Akkordskjema');
  if (block.options.label) figure.append(node('figcaption', block.options.label));
  const columns = Math.min(16, block.options.columns ?? Infinity);
  for (const row of block.rows) {
    if (row.kind === 'dynamic') continue;
    if (row.kind !== 'grid-row') {figure.append(node('p', row.text, row.kind)); continue;}
    const line = node('div', undefined, 'grid-row');
    if (row.left) line.append(node('p', row.left, 'grid-note'));
    const bars = node('div', undefined, 'grid-measures');
    for (const [measureIndex, measure] of row.measures.entries()) {
      if (measureIndex && measureIndex % columns === 0) bars.append(node('span', undefined, 'grid-break'));
      const bar = node('div', undefined, 'grid-measure');
      if (measure.opening) bar.append(node('span', measure.opening, 'grid-barline'));
      const cells = node('div', undefined, 'grid-cells');
      for (const [index, value] of measure.cells.entries()) {
        const cell = node('span', undefined, 'grid-cell'); cell.dataset.beat = String(index + 1);
        const chords = value.split('~').map(chordText);
        if (chords.length > 1 && chords.every(chord => isChord(chord))) {
          cell.setAttribute('aria-label', chords.join(', '));
          chords.forEach(chord => cell.append(node('span', chord, 'grid-chord')));
        } else {
          const text = chordText(value), chord = isChord(text);
          cell.append(node('span', text === '.' ? '\u00a0' : text, chord ? 'grid-chord' : 'grid-symbol'));
          if (text === '.') cell.setAttribute('aria-label', 'Tom akkordcelle');
        }
        cells.append(cell);
      }
      bar.append(cells); if (measure.closing) bar.append(node('span', measure.closing, 'grid-barline')); bars.append(bar);
    }
    line.append(bars);
    if (row.right) line.append(node('p', row.right, 'grid-note'));
    if (!row.measures.length && !row.left && !row.right) line.classList.add('grid-blank');
    figure.append(line);
  }
  return figure;
}
export function renderContent(content: Content[], context: DynamicsContext): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const dynamic = (block: {level: DynamicLevel;sourceLine?: number}) => {
    instruction(block.level, context);
    if(block.sourceLine!==undefined){const anchor=node('span',undefined,'dynamic-position');anchor.dataset.dynamicSource=String(block.sourceLine);anchor.dataset.level=String(block.level);anchor.setAttribute('aria-hidden','true');fragment.append(anchor);}
  };
  const identify = (row: HTMLElement, sourceLine?: number) => {
    if (sourceLine !== undefined) {row.dataset.sourceLine = String(sourceLine); row.dataset.occurrence = `${context.occurrence ?? 'source'}/line:${sourceLine}`;}
    return row;
  };
  for (const block of content) {
    if (block.kind === 'dynamic') {dynamic(block); continue;}
    if (block.kind === 'grid') {
      for (const row of block.rows) if (row.kind === 'dynamic') dynamic(row);
      context.spokenLevel = undefined; continue;
    }
    if (block.kind !== 'line') {fragment.append(decorate(identify(node('p', block.text, block.kind), block.sourceLine), context)); continue;}
    if (block.segments.every(segment => !segment.chord && !segment.text.trim())) {
      const space = node('div', undefined, 'song-space'); identify(space, block.sourceLine);
      fragment.append(space); continue;
    }
    const line = node('div', undefined, 'song-line');
    if (block.sourceLine !== undefined) {line.dataset.sourceLine = String(block.sourceLine); line.dataset.occurrence = `${context.occurrence ?? 'source'}/line:${block.sourceLine}`;}
    let lyricOffset = 0;
    const hasChords = block.segments.some(segment => segment.chord);
    if (hasChords) line.classList.add('has-chords');
    for (const segment of block.segments) {
      const words = segment.text.split(/(\s+)/).filter(Boolean);
      if (!words.length) words.push('');
      words.forEach((word, index) => {
        const piece = node('span', undefined, 'piece');
        if (hasChords) {const chord = node('span', index === 0 ? context.chord?.(segment.chord ?? '') ?? segment.chord ?? '' : '', 'chord'); chord.dataset.original = index === 0 ? segment.chord ?? '' : ''; piece.append(chord);}
        const lyric = node('span', word || '\u00a0', 'lyric'); lyric.dataset.offset = String(lyricOffset); lyric.dataset.length = String(word.length); lyricOffset += word.length;
        piece.append(lyric); line.append(piece);
      });
    }
    if (!line.textContent) line.append(document.createTextNode('\u00a0'));
    fragment.append(decorate(line, context));
  }
  return fragment;
}
