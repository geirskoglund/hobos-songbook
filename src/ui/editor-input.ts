import {currentPage} from './layout.ts';
import {edgeScroll, lyricText} from './highlight-editor.ts';
import {rowAt, type EditorContext} from './editor-context.ts';
import {placeElement} from './element-placement.ts';
import {clearChorusRange, finishChorusGesture, markChorusRange, type ChorusGesture} from './chorus-editing.ts';
import {setChorus} from '../domain/source-edit.ts';

/** Peker-, klikk- og tastaturbetjening av sangteksten i redigeringsmodus. Returnerer en funksjon som kobler fra. */
export function attachEditorInput(root: HTMLElement, ctx: EditorContext) {
  let down:
      | (ChorusGesture & {
          x: number;
          y: number;
          scroll: number;
          stop: () => void;
        })
      | undefined,
    cancelled = false;
  const pointerDown = (event: PointerEvent) => {
    cancelled = false;
    const target = event.target as Element;
    if (ctx.tool() === 'chorus') {
      const row = rowAt(root, event.clientY);
      if (!row) return;
      const handle = target.closest<HTMLElement>('.chorus-handle'),
        section = target.closest<HTMLElement>('.chorus');
      event.preventDefault();
      root.setPointerCapture(event.pointerId);
      down = {
        x: event.clientX,
        y: event.clientY,
        scroll: scrollY,
        row: Number(row.dataset.sourceLine),
        existing: section?.dataset.chorusStart ? Number(section.dataset.chorusStart) : undefined,
        handle: handle?.dataset.edge as 'start' | 'end' | undefined,
        stop: () => {},
      };
      down.stop = edgeScroll(
        () => down?.y ?? innerHeight / 2,
        () => {},
      );
    } else
      down = {
        x: event.clientX,
        y: event.clientY,
        scroll: scrollY,
        row: 0,
        stop: () => {},
      };
  };
  const pointerMove = (event: PointerEvent) => {
    if (!down) return;
    if (ctx.tool() === 'chorus') {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) down.moved = true;
      down.y = event.clientY;
      markChorusRange(root, down.row, rowAt(root, event.clientY));
    } else if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) cancelled = true;
  };
  const finish = (event: PointerEvent, abort = false) => {
    const gesture = down;
    down = undefined;
    gesture?.stop();
    clearChorusRange(root);
    if (abort) {
      cancelled = true;
      return;
    }
    if (ctx.tool() === 'chorus' && gesture) {
      const end = rowAt(root, event.clientY);
      if (!end) return;
      finishChorusGesture(root, ctx, gesture, end);
    }
  };
  const click = (event: MouseEvent) => {
    if (cancelled) {
      cancelled = false;
      return;
    }
    try {
      placeElement(root, ctx, event);
    } catch (e) {
      ctx.showError(e instanceof Error ? e.message : 'Kunne ikke endre elementet.');
    }
  };
  let chorusKeyboardStart: number | undefined;
  const key = (event: KeyboardEvent) => {
    if (currentPage() !== 'reader' || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      ctx.save();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      ctx.run(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo', ctx.toolbar);
    }
    if (event.key === 'Escape') ctx.setTool();
    const target = event.target as Element,
      node = ctx.selectable(target);
    if (!ctx.tool() && node && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      ctx.select(node);
      return;
    }
    if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) && node?.matches('.chord[data-chord-start]')) {
      event.preventDefault();
      const row = node.closest<HTMLElement>('[data-source-line]')!,
        offset = Math.max(
          0,
          Math.min(lyricText(row).length, Number(node.dataset.chordOffset) + (event.key === 'ArrowRight' ? 1 : -1)),
        );
      ctx.moveChord(Number(node.dataset.chordStart), Number(row.dataset.sourceLine), offset);
      return;
    }
    if (ctx.selected() && ['Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault();
      ctx.removeSelected();
      return;
    }
    if (['Enter', ' '].includes(event.key) && (event.target as Element).matches('[data-source-line],.personal-note')) {
      event.preventDefault();
      const target = event.target as HTMLElement;
      if (ctx.tool() === 'chorus') {
        const index = Number(target.dataset.sourceLine);
        if (chorusKeyboardStart === undefined) {
          chorusKeyboardStart = index;
          ctx.showError('Velg siste refrenglinje med Tab og Enter.');
        } else {
          try {
            const first = chorusKeyboardStart;
            chorusKeyboardStart = undefined;
            ctx.setTool();
            ctx.original(setChorus(ctx.session.song, first, index));
          } catch (e) {
            ctx.showError(String(e));
          }
        }
      } else {
        const r = target.getBoundingClientRect();
        target.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            clientX: r.left + 1,
            clientY: event.shiftKey && target.classList.contains('song-end') ? r.bottom - 1 : r.top + 1,
          }),
        );
      }
    }
  };
  const cancel = (e: PointerEvent) => finish(e, true);
  root.addEventListener('pointerdown', pointerDown);
  root.addEventListener('pointermove', pointerMove);
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('click', click);
  document.addEventListener('keydown', key);
  return () => {
    down?.stop();
    root.removeEventListener('pointerdown', pointerDown);
    root.removeEventListener('pointermove', pointerMove);
    root.removeEventListener('pointerup', finish);
    root.removeEventListener('pointercancel', cancel);
    root.removeEventListener('click', click);
    document.removeEventListener('keydown', key);
  };
}
