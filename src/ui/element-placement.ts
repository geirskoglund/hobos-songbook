import {lyricOffsetAt} from './highlight-editor.ts';
import {rowAt, type EditorContext} from './editor-context.ts';
import {shiftChord} from '../domain/personal.ts';
import {insertDirective, setChord, setDirective, sourceBlocks, sourceLines} from '../domain/source-edit.ts';

/** Et klikk i sangteksten med et plasseringsverktøy aktivt: setter inn eller endrer elementet der. */
export function placeElement(root: HTMLElement, ctx: EditorContext, event: MouseEvent) {
  const {session} = ctx,
    tool = ctx.tool();
  const target = event.target as Element;
  const point = {
    x: event.clientX,
    y: event.clientY,
  };
  if (tool === 'note' && target.closest('.personal-note')) {
    ctx.note(target.closest<HTMLElement>('.personal-note')!, point);
    return;
  }
  if (target.closest('[data-remove-element],.highlight-controls,.chorus-handle')) return;
  const row = target.closest<HTMLElement>('[data-source-line]') ?? rowAt(root, event.clientY);
  if (!row || !root.contains(row) || !tool) return;
  const spaceBefore =
    row.classList.contains('song-space') ||
    (row.classList.contains('song-end') &&
      event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
  const sourceIndex = Number(row.closest<HTMLElement>('.reference')?.dataset.referenceLine ?? row.dataset.sourceLine),
    index =
      row.classList.contains('song-space') && ['reference', 'comment', 'dynamic'].includes(tool)
        ? Math.min(sourceIndex + 1, sourceLines(session.song.original).length)
        : sourceIndex;
  if (tool === 'note') {
    ctx.note(target.closest<HTMLElement>('.personal-note') ?? row, point);
    return;
  }
  if (tool === 'highlight' || tool === 'chorus' || tool === 'remove') return;
  if (target.closest('button') && !target.closest('.dynamic-marker')) return;
  if (tool === 'chord') {
    const chord = target.closest<HTMLElement>('.chord[data-chord-start]'),
      existing = chord ? Number(chord.dataset.chordStart) : undefined,
      offset = chord ? Number(chord.dataset.chordOffset) : lyricOffsetAt(row, event.clientX, event.clientY);
    const start = chord?.dataset.original ?? '',
      capo = session.personal.capo ?? 0;
    ctx.value({
      name: 'Akkord',
      icon: 'akkord',
      anchor: chord ?? row,
      start: shiftChord(start, -capo),
      apply: (text, submitted) => {
        if (!submitted) return;
        ctx.original(setChord(session.song, index, offset, shiftChord(text.trim(), capo), existing, spaceBefore));
      },
      point,
    });
  } else if (tool === 'comment') {
    const current = sourceLines(session.song.original)[index],
      existing = sourceIndex === index && ['comment', 'c'].includes(current?.directive?.name ?? '');
    ctx.value({
      name: 'Anvisning',
      icon: 'info',
      anchor: row,
      start: existing ? current.directive!.value : '',
      apply: (text, submitted) => {
        if (!submitted) return;
        if (/[\r\n{}]/.test(text)) throw Error('Bruk én linje uten klammer.');
        ctx.original(
          existing
            ? setDirective(session.song, index, text)
            : insertDirective(session.song, index, `{comment: ${text}}`, spaceBefore),
        );
      },
      point,
    });
  } else if (tool === 'dynamic') {
    const marker = target.closest<HTMLElement>('[data-dynamic-line]');
    let line = marker ? Number(marker.dataset.dynamicLine) : undefined;
    ctx.value({
      name: 'Dynamikk',
      icon: 'dynamikk',
      anchor: marker ?? row,
      start: marker?.dataset.level ?? '3',
      apply: text => {
        const next =
          line === undefined
            ? insertDirective(session.song, index, `{x_dyn: ${text}}`, spaceBefore)
            : setDirective(session.song, line, text);
        if (line === undefined)
          line = sourceLines(next.original)[index]?.directive?.name === 'x_dyn' ? index : index + 1;
        ctx.original(next);
      },
      numeric: {
        min: 1,
        max: 5,
      },
      point,
    });
  } else if (tool === 'reference') {
    const definitions = sourceBlocks(session.song.original, 'chorus');
    if (definitions.some(b => b.start.index < index && index < (b.end?.index ?? Infinity))) {
      ctx.showError('Sett henvisningen utenfor refrengblokken.');
      return;
    }
    ctx.setTool();
    ctx.original(insertDirective(session.song, index, '{chorus}', spaceBefore));
  }
}
