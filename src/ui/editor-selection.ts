import {changeAnnotation, changeNote} from '../domain/annotations.ts';
import type {EditSession} from '../domain/edit-session.ts';
import {
  patchSong,
  removeSourceBlock,
  setChord,
  sourceBlocks,
  sourceChords,
  sourceLines,
} from '../domain/source-edit.ts';
import type {Highlight, Song, SongPersonal} from '../core/song.ts';
import {importedSong} from '../domain/song.ts';

/** Et valgt element i redigeringsvisningen, beskrevet slik at valget overlever en ny tegning. */
export type ElementChoice =
  | {
      kind: 'note';
      id: string;
    }
  | {
      kind: 'chord';
      start: number;
    }
  | {
      kind: 'comment' | 'dynamic' | 'chorus' | 'reference';
      line: number;
    }
  | {
      kind: 'highlight';
      occurrence: string;
      range: Highlight;
    };

const isComment = (session: EditSession, line: number) =>
  ['comment', 'c'].includes(sourceLines(session.song.original)[line]?.directive?.name ?? '');

/** The element the target belongs to. In an imported song only personal elements can be chosen. */
export function choiceAt(session: EditSession, target: Element): ElementChoice | undefined {
  const choice = elementAt(session, target);
  return choice && importedSong(session.song) && choice.kind !== 'note' && choice.kind !== 'highlight'
    ? undefined
    : choice;
}
function elementAt(session: EditSession, target: Element): ElementChoice | undefined {
  const note = target.closest<HTMLElement>('.personal-note');
  if (note?.dataset.noteId)
    return {
      kind: 'note',
      id: note.dataset.noteId,
    };
  const chord = target.closest<HTMLElement>('.chord[data-chord-start]');
  if (chord)
    return {
      kind: 'chord',
      start: Number(chord.dataset.chordStart),
    };
  const dynamic = target.closest<HTMLElement>('.dynamic-marker');
  if (dynamic)
    return {
      kind: 'dynamic',
      line: Number(dynamic.dataset.dynamicLine),
    };
  const mark = target.closest<HTMLElement>('mark');
  if (mark) {
    const row = mark.closest<HTMLElement>('[data-occurrence]'),
      lyric = mark.closest<HTMLElement>('.lyric');
    if (!row || !lyric) return;
    const before = document.createRange();
    before.selectNodeContents(lyric);
    before.setEndBefore(mark);
    const at = Number(lyric.dataset.offset) + before.toString().length;
    const range = session.personal.annotations?.[row.dataset.occurrence!]?.highlights.find(
      range => at >= range.start && at < range.end,
    );
    if (range)
      return {
        kind: 'highlight',
        occurrence: row.dataset.occurrence!,
        range,
      };
  }
  const comment = target.closest<HTMLElement>('.comment[data-source-line]');
  if (comment && isComment(session, Number(comment.dataset.sourceLine)))
    return {
      kind: 'comment',
      line: Number(comment.dataset.sourceLine),
    };
  const heading = target.closest<HTMLElement>('.chorus > h2'),
    section = heading?.parentElement;
  if (section?.dataset.referenceLine !== undefined)
    return {
      kind: 'reference',
      line: Number(section.dataset.referenceLine),
    };
  if (section?.dataset.chorusStart !== undefined)
    return {
      kind: 'chorus',
      line: Number(section.dataset.chorusStart),
    };
}

/** Elementet under `target` som kan velges med det aktive verktøyet, om noe. */
export function selectableAt(
  body: HTMLElement | undefined,
  session: EditSession,
  tool: string | undefined,
  target: Element,
): HTMLElement | undefined {
  if (target.closest('.highlight-controls,.chorus-handle')) return;
  const node = target.closest<HTMLElement>(
    '.personal-note,.chord[data-chord-start],.dynamic-marker,mark,.comment[data-source-line],.chorus > h2',
  );
  if ((tool === 'highlight' || tool === 'chorus') && node?.matches('.chord')) return;
  return node && body?.contains(node) && choiceAt(session, node) ? node : undefined;
}

/** Gjør valgbare elementer nåbare med tastatur og markerer det valgte elementet. */
export function reflectSelection(body: HTMLElement, session: EditSession, selected: ElementChoice | undefined) {
  body.querySelectorAll('[data-element-selected]').forEach(node => node.removeAttribute('data-element-selected'));
  for (const node of body.querySelectorAll<HTMLElement>(
    '.personal-note,.chord[data-chord-start],mark,.comment[data-source-line],.chorus > h2',
  ))
    if (choiceAt(session, node)) {
      node.tabIndex = 0;
      node.setAttribute('aria-description', 'Hold inne eller trykk Enter for å velge. Fjern sletter valgt element.');
    }
  if (!selected) return;
  const choice = selected;
  let nodes: HTMLElement[];
  if (choice.kind === 'note')
    nodes = [...body.querySelectorAll<HTMLElement>('.personal-note')].filter(node => node.dataset.noteId === choice.id);
  else if (choice.kind === 'chord')
    nodes = [...body.querySelectorAll<HTMLElement>('.chord[data-chord-start]')].filter(
      node => Number(node.dataset.chordStart) === choice.start,
    );
  else if (choice.kind === 'highlight')
    nodes = [...body.querySelectorAll<HTMLElement>('mark')].filter(node => {
      const own = choiceAt(session, node);
      return (
        own?.kind === 'highlight' &&
        (choice.range.groupId
          ? own.range.groupId === choice.range.groupId
          : own.occurrence === choice.occurrence &&
            own.range.start === choice.range.start &&
            own.range.end === choice.range.end)
      );
    });
  else if (choice.kind === 'dynamic')
    nodes = [...body.querySelectorAll<HTMLElement>('.dynamic-marker')].filter(
      node => Number(node.dataset.dynamicLine) === choice.line,
    );
  else if (choice.kind === 'comment')
    nodes = [...body.querySelectorAll<HTMLElement>('.comment[data-source-line]')].filter(
      node => Number(node.dataset.sourceLine) === choice.line,
    );
  else
    nodes = [
      ...body.querySelectorAll<HTMLElement>(choice.kind === 'chorus' ? '[data-chorus-start]' : '[data-reference-line]'),
    ].filter(
      node => Number(choice.kind === 'chorus' ? node.dataset.chorusStart : node.dataset.referenceLine) === choice.line,
    );
  for (const node of nodes) node.dataset.elementSelected = '';
}

/** Fjerner det valgte elementet fra personlig lag eller originaltekst. */
export function removeChoice(
  session: EditSession,
  choice: ElementChoice,
  write: {
    update: (fn: (state: SongPersonal) => SongPersonal) => void;
    original: (next: Song) => void;
  },
) {
  if (choice.kind === 'note') write.update(state => changeNote(state, choice.id, undefined));
  else if (choice.kind === 'highlight')
    write.update(state => {
      let next = state;
      for (const annotation of Object.values(state.annotations ?? {})) {
        const highlights = annotation.highlights.filter(range =>
          choice.range.groupId
            ? range.groupId !== choice.range.groupId
            : annotation.anchor.occurrence !== choice.occurrence ||
              range.start !== choice.range.start ||
              range.end !== choice.range.end,
        );
        next = changeAnnotation(next, annotation.anchor, {
          highlights,
        });
      }
      return next;
    });
  else if (choice.kind === 'chord') {
    const row = sourceLines(session.song.original).find(row =>
        sourceChords(row).some(token => token.start === choice.start),
      ),
      token = row && sourceChords(row).find(token => token.start === choice.start);
    if (row && token) write.original(setChord(session.song, row.index, token.offset, '', choice.start));
  } else if (choice.kind === 'chorus') {
    const block = sourceBlocks(session.song.original, 'chorus').find(block => block.start.index === choice.line);
    if (block) write.original(removeSourceBlock(session.song, block));
  } else {
    const row = sourceLines(session.song.original)[choice.line];
    if (row)
      write.original(
        patchSong(session.song, [
          {
            start: row.start,
            end: row.end,
            text: '',
          },
        ]),
      );
  }
}
