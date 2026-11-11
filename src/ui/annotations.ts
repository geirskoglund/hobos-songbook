import {actionButton} from './controls.ts';
import {logicalLines, notePlacements} from '../domain/annotations.ts';
import type {Song, SongPersonal} from '../domain/song.ts';

/** Rendering never decides whether a saved note is still valid. Every note gets a visible placement. */
export function paintAnnotations(root: HTMLElement, song: Song, personal: SongPersonal) {
  root.querySelectorAll('.personal-note,.note-overflow').forEach(node => node.remove());
  const lines = logicalLines(song), rows = [...root.querySelectorAll<HTMLElement>('[data-occurrence]')];
  for (const row of rows) {
    const index = lines.findIndex(line => line.occurrence === row.dataset.occurrence);
    if (index >= 0) row.dataset.noteLine = String(index);
    const annotation = personal.annotations?.[row.dataset.occurrence!];
    for (const lyric of row.querySelectorAll<HTMLElement>('.lyric')) {
      const text = lyric.textContent ?? '', start = Number(lyric.dataset.offset), length = Number(lyric.dataset.length);
      lyric.replaceChildren();let cursor = 0;
      for (const range of [...(annotation?.highlights ?? [])].sort((a, b) => a.start - b.start)) {
        const from = Math.max(cursor, range.start - start, 0), to = Math.min(length, range.end - start);
        if (to <= from) continue;
        const mark = document.createElement('mark');mark.textContent = text.slice(from, to);
        lyric.append(document.createTextNode(text.slice(cursor, from)), mark);cursor = to;
      }
      lyric.append(document.createTextNode(text.slice(cursor)));
    }
  }
  const available = rows.filter(row => !row.closest('.chorus-text[hidden]') && row.dataset.noteLine !== undefined);
  const meaningful = available.some(row => lines[Number(row.dataset.noteLine)]?.text.trim());
  const overflow = document.createElement('div');overflow.className = 'note-overflow';
  let extra = lines.length;
  for (const placement of notePlacements(personal, meaningful ? available.map(row => Number(row.dataset.noteLine)) : [])) {
    let row = placement.line === undefined ? undefined : available.find(row => Number(row.dataset.noteLine) === placement.line);
    if (!row) {row = document.createElement('div');row.className = 'note-overflow-row';row.dataset.noteLine = String(extra++);overflow.append(row);}
    const note = document.createElement('aside');note.className = 'personal-note';note.dataset.noteId = placement.id;note.textContent = placement.note.text;note.setAttribute('aria-label', 'Personlig notat');
    if (document.body.classList.contains('editing-active')) {
      note.tabIndex = 0;note.dataset.tooltip = 'Hold inne og dra for å flytte. Alt+pil opp/ned på tastatur.';
      const remove = actionButton('',undefined,'slett');remove.dataset.deleteNote = '';remove.setAttribute('aria-label', 'Slett notat');note.append(remove);
    }
    row.prepend(note);
  }
  if (overflow.childElementCount) root.append(overflow);
}
