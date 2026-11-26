import {actionButton} from './controls.ts';
import type {EditorContext} from './editor-context.ts';
import {setChorus, sourceBlocks, sourceLines} from '../domain/source-edit.ts';

/** En pågående dragning med refrengverktøyet: ny blokk, eller flytting av en kant på en eksisterende. */
export interface ChorusGesture {
  row: number;
  existing?: number;
  handle?: 'start' | 'end';
  moved?: boolean;
}

export function clearChorusRange(root: HTMLElement) {
  root.querySelectorAll('[data-chorus-selected]').forEach(r => r.removeAttribute('data-chorus-selected'));
}

/** Markerer linjene fra `from` til linjen `end` mens brukeren drar. */
export function markChorusRange(root: HTMLElement, from: number, end: HTMLElement | undefined) {
  clearChorusRange(root);
  if (end)
    for (const r of root.querySelectorAll<HTMLElement>('[data-source-line]')) {
      const i = Number(r.dataset.sourceLine);
      if (i >= Math.min(from, Number(end.dataset.sourceLine)) && i <= Math.max(from, Number(end.dataset.sourceLine)))
        r.setAttribute('data-chorus-selected', '');
    }
}

const lastLine = (ctx: EditorContext) => sourceLines(ctx.session.song.original).length;

/** Fullfører en dragning som slutter på linjen `end`. Et rent trykk på et refreng viser kanthåndtakene. */
export function finishChorusGesture(root: HTMLElement, ctx: EditorContext, gesture: ChorusGesture, end: HTMLElement) {
  const {session} = ctx;
  try {
    if (gesture.existing !== undefined && !gesture.handle && !gesture.moved) {
      showChorusHandles(root, ctx, gesture.existing);
      return;
    }
    let from = gesture.row,
      to = Number(end.dataset.sourceLine);
    if (gesture.handle && gesture.existing !== undefined) {
      const b = sourceBlocks(session.song.original, 'chorus').find(b => b.start.index === gesture.existing)!;
      from = gesture.handle === 'start' ? to : b.start.index + 1;
      to = gesture.handle === 'end' ? to : (b.end?.index ?? lastLine(ctx)) - 1;
    }
    ctx.setTool();
    ctx.original(setChorus(session.song, from, to, gesture.existing));
  } catch (e) {
    ctx.showError(e instanceof Error ? e.message : 'Kunne ikke endre refrenget.');
  }
}

/** Håndtak for å flytte starten og slutten av refrenget som starter på kildelinjen `index`. */
function showChorusHandles(root: HTMLElement, ctx: EditorContext, index: number) {
  const {session} = ctx;
  root.querySelectorAll('.chorus-handle').forEach(n => n.remove());
  const section = root.querySelector<HTMLElement>(`[data-chorus-start="${index}"]`);
  if (!section) return;
  for (const edge of ['start', 'end']) {
    const h = actionButton(edge === 'start' ? '‹' : '›', undefined);
    h.className = `chorus-handle chorus-handle-${edge}`;
    h.dataset.edge = edge;
    h.setAttribute('aria-label', `Flytt ${edge === 'start' ? 'starten' : 'slutten'} av refrenget`);
    h.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const block = sourceBlocks(session.song.original, 'chorus').find(b => b.start.index === index)!;
      const first = block.start.index + 1,
        last = (block.end?.index ?? lastLine(ctx)) - 1,
        delta = event.key === 'ArrowUp' ? -1 : 1;
      try {
        ctx.original(
          setChorus(
            session.song,
            edge === 'start' ? first + delta : first,
            edge === 'end' ? last + delta : last,
            index,
          ),
        );
      } catch (e) {
        ctx.showError(String(e));
      }
    });
    section.append(h);
  }
}
