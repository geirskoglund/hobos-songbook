import { changeNote } from '../domain/annotations.ts';
import type { SongPersonal } from '../domain/song.ts';
import { edgeScroll } from './highlight-editor.ts';
import { noteAnchor, noteTargets, canPlaceNote } from './note-position.ts';

/** Hold a note to move its anchor. Touch movement before the hold remains scrolling. */
export function attachNoteDrag(root: HTMLElement, update: (fn: (current: SongPersonal) => SongPersonal) => void, targetAt: (y: number) => HTMLElement | undefined, activate: (line: HTMLElement) => void, select: (note: HTMLElement) => void) {
  type Hold = {
    pointer: number;
    note: HTMLElement;
    line: HTMLElement;
    x: number;
    y: number;
    startX: number;
    startY: number;
    lastY: number;
    offset: number;
    touch: boolean;
    cancelled: boolean;
    armed: boolean;
    target?: HTMLElement;
    ghost?: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
    stop?: () => void;
  };
  let hold: Hold | undefined,
    suppressClick = false;
  const announce = document.createElement('span');
  announce.className = 'sr-only';
  announce.setAttribute('role', 'status');
  root.append(announce);
  function clearTarget() {
    root.querySelector('[data-note-target]')?.removeAttribute('data-note-target');
  }
  function locate() {
    if (!hold?.ghost) return;
    const row = targetAt(hold.y - hold.startY + hold.offset),
      occupied = row && !canPlaceNote(root, hold.note, row);
    clearTarget();
    hold.target = occupied ? undefined : row;
    hold.ghost.dataset.invalid = String(Boolean(occupied));
    hold.ghost.style.top = `${(row ? noteAnchor(row).y : hold.y) - hold.ghost.offsetHeight / 2}px`;
    root.dispatchEvent(new CustomEvent('annotation-drag', {
      detail: {
        ghost: hold.ghost,
        target: row
      }
    }));
  }
  function begin() {
    if (!hold || hold.cancelled || !hold.note.isConnected) return;
    hold.armed = true;
    select(hold.note);
    root.setPointerCapture(hold.pointer);
    getSelection()?.removeAllRanges();
  }
  function startMove() {
    if (!hold) return;
    const rect = hold.note.getBoundingClientRect(),
      ghost = hold.note.cloneNode(true) as HTMLElement;
    ghost.querySelectorAll('button').forEach(node => node.remove());
    ghost.removeAttribute('tabindex');
    ghost.removeAttribute('data-note-id');
    ghost.className = 'note-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px`;
    document.body.append(ghost);
    hold.ghost = ghost;
    hold.note.dataset.moving = '';
    root.dataset.noteMoving = '';
    getSelection()?.removeAllRanges();
    root.setPointerCapture(hold.pointer);
    hold.stop = edgeScroll(() => hold?.y ?? innerHeight / 2, locate);
    locate();
    announce.textContent = 'Flytt notatet og slipp ved ønsket linje. Escape avbryter.';
  }
  function transfer(from: HTMLElement, to: HTMLElement) {
    const note = from.querySelector<HTMLElement>('.personal-note');
    if (from === to || !note || !canPlaceNote(root, note, to) || !Number.isSafeInteger(Number(to.dataset.noteLine))) return;
    const id = from.querySelector<HTMLElement>('[data-note-id]')?.dataset.noteId;
    if (!id) return;
    update(current => {
      const note = current.notes?.[id];
      return note ? changeNote(current, id, {
        ...note,
        line: Number(to.dataset.noteLine)
      }) : current;
    });
    announce.textContent = 'Notatet er flyttet.';
  }
  function down(event: PointerEvent) {
    suppressClick = false;
    const note = (event.target as Element).closest<HTMLElement>('.personal-note');
    if (!note || (event.target as Element).closest('button') || event.button !== 0) return;
    finish(undefined, true);
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
    const bounds = note.getBoundingClientRect();
    hold = {
      pointer: event.pointerId,
      note,
      line: note.closest<HTMLElement>('[data-note-line]')!,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      offset: bounds.top + bounds.height / 2,
      touch: event.pointerType === 'touch',
      cancelled: false,
      armed: false,
      timer: setTimeout(begin, 450)
    };
  }
  function move(event: PointerEvent) {
    if (!hold || hold.pointer !== event.pointerId) return;
    hold.x = event.clientX;
    hold.y = event.clientY;
    if (hold.armed && !hold.ghost && Math.hypot(hold.x - hold.startX, hold.y - hold.startY) > 4) startMove();
    if (hold.ghost) {
      event.preventDefault();
      locate();
      return;
    }
    if (Math.hypot(hold.x - hold.startX, hold.y - hold.startY) > 8) {
      clearTimeout(hold.timer);
      hold.cancelled = true;
      suppressClick = true;
    }
    if (hold.cancelled && hold.touch) {
      event.preventDefault();
      window.scrollBy(0, hold.lastY - hold.y);
    }
    hold.lastY = hold.y;
  }
  function finish(event?: PointerEvent, cancel = false) {
    if (!hold || event && event.pointerId !== hold.pointer) return;
    const current = hold;
    hold = undefined;
    clearTimeout(current.timer);
    current.stop?.();
    clearTarget();
    delete root.dataset.noteMoving;
    delete current.note.dataset.moving;
    current.ghost?.remove();
    if (current.armed) suppressClick = true;
    if (current.ghost) {
      root.dispatchEvent(new CustomEvent('annotation-drag'));
      suppressClick = true;
      if (!cancel && current.target) transfer(current.line, current.target);else announce.textContent = 'Flytting avbrutt.';
    }
    if (root.hasPointerCapture(current.pointer)) root.releasePointerCapture(current.pointer);
    if (!cancel && !current.armed && !current.ghost && !current.cancelled && current.touch && current.note.isConnected) {
      suppressClick = true;
      activate(current.note);
    }
  }
  const touchStart = (e: TouchEvent) => {
    if ((e.target as Element).closest('.personal-note') && !(e.target as Element).closest('button')) e.preventDefault();
  };
  const context = (e: Event) => {
    if (hold?.ghost || (e.target as Element).closest('.personal-note')) e.preventDefault();
  };
  const up = (e: PointerEvent) => finish(e),
    cancel = (e: PointerEvent) => finish(e, true);
  const click = (e: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      finish(undefined, true);
      return;
    }
    const note = (event.target as Element).closest<HTMLElement>('.personal-note');
    if (!note || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const from = note.closest<HTMLElement>('[data-note-line]')!,
      rows = noteTargets(root),
      direction = event.key === 'ArrowUp' ? -1 : 1;
    for (let index = rows.indexOf(from) + direction; index >= 0 && index < rows.length; index += direction) {
      const to = rows[index];
      if (!canPlaceNote(root, note, to)) continue;
      transfer(from, to);
      to.querySelector<HTMLElement>('.personal-note')?.focus({
        preventScroll: true
      });
      break;
    }
  }
  root.addEventListener('touchstart', touchStart, {
    passive: false
  });
  root.addEventListener('contextmenu', context);
  root.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, {
    passive: false
  });
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  root.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
  return () => {
    finish(undefined, true);
    announce.remove();
    root.removeEventListener('touchstart', touchStart);
    root.removeEventListener('contextmenu', context);
    root.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    root.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
  };
}
