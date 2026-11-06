import {isChord, type Content, type GridBlock, type DynamicLevel} from '../domain/chordpro.ts';
export interface DynamicsContext {level: DynamicLevel; spokenLevel?: DynamicLevel}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
function decorate(row: HTMLElement, context: DynamicsContext) {
  row.classList.add('dynamic-row'); row.dataset.dynamicLevel = String(context.level);
  row.style.setProperty('--dynamic-width', `${context.level * 18}%`);
  row.style.setProperty('--dynamic-viewport-width', `${context.level * 18}cqw`);
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
function renderGrid(block: GridBlock, context: DynamicsContext): HTMLElement {
  const figure = node('figure', undefined, 'chord-grid');
  figure.append(node('figcaption', block.options.label ? `Felles akkordskjema — ${block.options.label}` : 'Felles akkordskjema'));
  const rows = block.rows.filter(row => row.kind === 'grid-row');
  const measures = rows.flatMap(row => row.measures);
  const columns = Math.min(8, block.options.columns ?? Math.max(1, ...rows.map(row => row.measures.length)));
  const beats = Math.min(32, block.options.beats ?? Math.max(1, ...measures.map(measure => measure.cells.length)));
  const cellWidth = Math.min(12, Math.max(2, ...measures.flatMap(measure => measure.cells.map(cell =>
    Math.max(...cell.split('~').map(part => chordText(part).length)) + .5))));
  const barWidth = Math.min(6, Math.max(1, ...measures.flatMap(measure => [measure.opening.length, measure.closing.length]))) * .85 + .25;
  figure.style.setProperty('--grid-bar-width', `${barWidth}ch`);
  figure.style.setProperty('--measure-min', `${cellWidth * beats + barWidth * 2}ch`);
  figure.style.setProperty('--measure-track', `calc(${100 / columns}% - ${(columns - 1) * 8 / columns}px)`);
  figure.style.setProperty('--cell-min', `${cellWidth}ch`);
  figure.style.setProperty('--beat-track', `${100 / beats}%`);
  for (const row of block.rows) {
    if (row.kind === 'dynamic') {instruction(row.level, context); continue;}
    if (row.kind !== 'grid-row') {figure.append(decorate(node('p', row.text, row.kind), context)); continue;}
    const line = node('div', undefined, 'grid-row');
    if (row.left) line.append(node('p', row.left, 'grid-note'));
    const bars = node('div', undefined, 'grid-measures');
    for (const measure of row.measures) {
      const bar = node('div', undefined, 'grid-measure');
      bar.append(node('span', measure.opening, 'grid-barline'));
      const cells = node('div', undefined, 'grid-cells');
      for (const [index, value] of measure.cells.entries()) {
        const cell = node('span', undefined, 'grid-cell'); cell.dataset.beat = String(index + 1);
        const chords = value.split('~').map(chordText);
        if (chords.length > 1 && chords.every(chord => isChord(chord))) {
          cell.setAttribute('aria-label', chords.join(', '));
          chords.forEach(chord => cell.append(node('span', chord, 'grid-chord')));
        } else {
          const text = chordText(value), chord = isChord(text);
          cell.append(node('span', text === '.' ? '·' : text, chord ? 'grid-chord' : 'grid-symbol'));
          if (text === '.') cell.setAttribute('aria-label', 'Tom akkordcelle');
        }
        cells.append(cell);
      }
      bar.append(cells, node('span', measure.closing, 'grid-barline')); bars.append(bar);
    }
    line.append(bars);
    if (row.right) line.append(node('p', row.right, 'grid-note'));
    if (!row.measures.length && !row.left && !row.right) line.classList.add('grid-blank');
    figure.append(decorate(line, context));
  }
  return figure;
}
export function renderContent(content: Content[], context: DynamicsContext): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of content) {
    if (block.kind === 'dynamic') {instruction(block.level, context); continue;}
    if (block.kind === 'grid') {fragment.append(renderGrid(block, context)); continue;}
    if (block.kind !== 'line') {fragment.append(decorate(node('p', block.text, block.kind), context)); continue;}
    const line = node('div', undefined, 'song-line');
    const hasChords = block.segments.some(segment => segment.chord);
    if (hasChords) line.classList.add('has-chords');
    for (const segment of block.segments) {
      const words = segment.text.split(/(\s+)/).filter(Boolean);
      if (!words.length) words.push('');
      words.forEach((word, index) => {
        const piece = node('span', undefined, 'piece');
        if (hasChords) piece.append(node('span', index === 0 ? segment.chord ?? '' : '', 'chord'));
        piece.append(node('span', word || '\u00a0', 'lyric')); line.append(piece);
      });
    }
    if (!line.textContent) line.append(document.createTextNode('\u00a0'));
    fragment.append(decorate(line, context));
  }
  return fragment;
}
