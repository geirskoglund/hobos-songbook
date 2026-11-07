import {parseChordPro} from '../domain/chordpro.ts';
import {anchorFor, changeAnnotation, sharedGridText, validCapo, validGrid, type Annotation} from '../domain/personal.ts';
import type {Song, SongPersonal} from '../domain/song.ts';
import {renderGrid} from './song-content.ts';

export type PersonalChange = (current: SongPersonal) => SongPersonal;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result;
};
function button(text: string, action: () => void) {
  const result = el('button', text); result.type = 'button'; result.addEventListener('click', action); return result;
}
function field(label: string, control: HTMLElement) {
  const wrap = el('label', label); wrap.append(control); return wrap;
}
export function paintAnnotations(root: HTMLElement, song: Song, personal: SongPersonal) {
  for (const line of root.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')) {
    line.querySelector('.personal-note')?.remove();
    const annotation = personal.annotations?.[line.dataset.occurrence!];
    for (const lyric of line.querySelectorAll<HTMLElement>('.lyric')) {
      const text = lyric.textContent ?? '', start = Number(lyric.dataset.offset), length = Number(lyric.dataset.length);
      lyric.replaceChildren();
      let cursor = 0;
      for (const range of [...(annotation?.anchor.original === song.original ? annotation.highlights : [])].sort((a,b) => a.start - b.start)) {
        const from = Math.max(cursor, range.start - start, 0), to = Math.min(length, range.end - start);
        if (to <= from) continue;
        lyric.append(document.createTextNode(text.slice(cursor, from)), el('mark', text.slice(from, to))); cursor = to;
      }
      lyric.append(document.createTextNode(text.slice(cursor)));
    }
    if (annotation?.note && annotation.anchor.original === song.original) {
      const note = el('aside', annotation.note); note.className = 'personal-note'; note.setAttribute('aria-label', 'Personlig notat'); line.append(note);
    }
  }
}
export function createPersonalEditor(song: Song, personal: SongPersonal, change: (update: PersonalChange) => void, finish: () => void) {
  const panel = el('section'); panel.className = 'personal-editor'; panel.setAttribute('aria-label', 'Rediger personlige tilpasninger');
  panel.append(el('h2', 'Rediger · personlige tilpasninger'), el('p', 'Originalfilen beholdes uendret. Endringer lagres fortløpende.'));
  const done = button('Ferdig', finish); done.id = 'edit-done'; panel.append(done);
  const capo = el('input'); capo.id = 'personal-capo'; capo.type = 'number'; capo.min = '0'; capo.max = '12'; capo.step = '1'; capo.value = personal.capo == null ? '' : String(personal.capo);
  capo.addEventListener('input', () => {
    const value = capo.value === '' ? null : Number(capo.value);
    capo.setCustomValidity(value === null || validCapo(value) ? '' : 'Bruk et heltall fra 0 til 12.');
    if (capo.checkValidity()) change(current => ({...current, capo: value}));
  });
  panel.append(field('Capo (0–12, tomt felt fjerner capo)', capo));
  const view = el('select'); view.id = 'personal-chord-view';
  for (const [value, text] of [['sounding','Klingende akkorder'], ['grips','Capo-grep']]) {const option = el('option', text); option.value = value; view.append(option);}
  view.value = personal.chordView ?? 'sounding'; view.addEventListener('change', () => {const value = view.value as 'sounding' | 'grips'; change(current => ({...current, chordView: value}));});
  panel.append(field('Akkordvisning', view));
  const tuning = el('input'); tuning.id = 'personal-tuning'; tuning.value = personal.tuning ?? '';
  tuning.addEventListener('input', () => {const value = tuning.value; change(current => ({...current, tuning: value}));});
  panel.append(field('Alternativ stemming (kun tekst)', tuning));
  const grid = el('textarea'); grid.id = 'personal-grid'; grid.rows = 5; grid.value = personal.chordGrid ?? '';
  const preview = el('div'); preview.className = 'grid-preview';
  const gridMessage = el('p'); gridMessage.setAttribute('role', 'status');
  const validateGrid = () => {
    const valid = validGrid(grid.value); grid.setCustomValidity(valid ? '' : 'Skriv et gyldig skjema med taktstreker og akkordceller, eller fjern skjemaet.');
    preview.replaceChildren();
    if (!valid) {gridMessage.textContent = 'Utkastet er ikke lagret. Sist gyldige skjema beholdes. Bruk «Fjern personlig skjema» for å fjerne det.'; return;}
    gridMessage.textContent = '';
    const text = grid.value, wrapped = /\{(?:start_of_grid|sog)\b/i.test(text) ? text : `{sog}\n${text}\n{eog}`;
    for (const block of parseChordPro(wrapped, '').blocks) if (block.kind === 'grid') preview.append(renderGrid(block));
    change(current => ({...current, chordGrid: text}));
  };
  grid.addEventListener('input', validateGrid);
  panel.append(el('h3', 'Personlig akkordskjema'), el('p', 'Skriv klingende akkorder, også når du spiller med capo. Eksempel: | D . D/F# . | Bm7 . A . |. ChordPro-grid med form og etikett støttes.'), field('Skjematekst', grid));
  const copy = button('Kopier felles skjema', () => {grid.value = sharedGridText(song.original); validateGrid();}); copy.disabled = !sharedGridText(song.original);
  panel.append(copy, button('Opprett tomt skjema', () => {grid.value = '| . . . . |'; validateGrid();}), button('Fjern personlig skjema', () => {
    grid.value = ''; grid.setCustomValidity(''); gridMessage.textContent = ''; preview.replaceChildren(); change(current => ({...current, chordGrid: undefined}));
  }), gridMessage, preview);
  const annotationPanel = el('section'); annotationPanel.className = 'annotation-editor'; annotationPanel.hidden = true;
  const heading = el('h3', 'Notat og gulmarkering');
  const selectionText = el('textarea'); selectionText.readOnly = true; selectionText.rows = 3; selectionText.id = 'annotation-text';
  const note = el('textarea'); note.rows = 2; note.id = 'annotation-note';
  let selected: Annotation | null = null;
  const commit = (field: 'note' | 'highlights') => {
    if (!selected) return;
    const snapshot = structuredClone(selected);
    const patch = field === 'note' ? {note: snapshot.note} : {highlights: snapshot.highlights};
    change(current => changeAnnotation(current, snapshot.anchor, patch));
  };
  note.addEventListener('input', () => {if (selected) {selected.note = note.value; commit('note');}});
  annotationPanel.append(heading, field('Marker ord eller tekst i denne linjen', selectionText), field('Personlig notat (tomt felt sletter notatet)', note),
    button('Gulmarker valgt tekst', () => {
      if (!selected) return;
      const start = selectionText.selectionStart, end = selectionText.selectionEnd;
      if (start !== end) {selected.highlights.push({start, end}); commit('highlights');}
    }), button('Gulmarker hele linjen', () => {if (selected) {selected.highlights = [{start:0, end:selected.anchor.text.length}]; commit('highlights');}}),
    button('Fjern markering i valgt tekst', () => {
      if (!selected) return;
      const start = selectionText.selectionStart, end = selectionText.selectionEnd;
      if (start === end) return;
      selected.highlights = selected.highlights.flatMap(range => range.end <= start || range.start >= end ? [range] : [
        ...(range.start < start ? [{start:range.start, end:start}] : []),
        ...(range.end > end ? [{start:end, end:range.end}] : []),
      ]); commit('highlights');
    }), button('Fjern gulmarkeringer', () => {if (selected) {selected.highlights = []; commit('highlights');}}));
  panel.append(annotationPanel);
  return {element: panel, selection: () => selected ? {
    occurrence: selected.anchor.occurrence, start: selectionText.selectionStart, end: selectionText.selectionEnd,
  } : undefined, isValid: () => panel.checkVisibility() && [...panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].every(control => control.reportValidity()),
    select(line: HTMLElement, state: SongPersonal, range?: {start: number; end: number}) {
      const occurrence = line.dataset.occurrence!, text = [...line.querySelectorAll<HTMLElement>('.lyric')].map(lyric => (lyric.textContent ?? '').slice(0, Number(lyric.dataset.length))).join('');
      selected = structuredClone(state.annotations?.[occurrence] ?? {anchor: anchorFor(song, Number(line.dataset.sourceLine), occurrence, text), note:'', highlights:[]});
      annotationPanel.hidden = false; selectionText.value = text; note.value = selected.note;
      if (range) selectionText.setSelectionRange(range.start, range.end);
    }};
}
/** Maps native selection across lyric nodes; chord labels and accessibility text never count. */
export function selectedLyricRange(line: HTMLElement): {start: number; end: number} | undefined {
  const selection = getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!line.contains(range.startContainer) || !line.contains(range.endContainer)) return;
  const offset = (node: Node, at: number) => {
    const parent = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const lyric = parent?.closest<HTMLElement>('.lyric'); if (!lyric) return null;
    const local = document.createRange(); local.selectNodeContents(lyric); local.setEnd(node, at);
    return Number(lyric.dataset.offset) + Math.min(Number(lyric.dataset.length), local.toString().length);
  };
  const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
  return start !== null && end !== null && end > start ? {start, end} : undefined;
}
