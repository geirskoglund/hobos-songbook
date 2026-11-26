import {lyricPositionAt, lyricText} from './highlight-editor.ts';
import type {ElementDrag} from './held-elements.ts';

export interface ChordTarget {
  line: number;
  offset: number;
}

/** Drar en akkord til en ny tekstposisjon. `drop` får akkordens start og målet når brukeren slipper. */
export function startChordDrag(
  root: HTMLElement,
  node: HTMLElement,
  x: number,
  y: number,
  pointerType: string,
  drop: (start: number, target: ChordTarget) => void,
): ElementDrag | undefined {
  if (!node.matches('.chord[data-chord-start]')) return;
  const start = Number(node.dataset.chordStart),
    ghost = node.cloneNode(true) as HTMLElement;
  ghost.className = 'chord-drag-ghost';
  ghost.dataset.input = pointerType;
  const context = document.createElement('span');
  context.className = 'chord-drag-context';
  if (pointerType !== 'mouse') ghost.append(context);
  ghost.removeAttribute('tabindex');
  ghost.removeAttribute('data-element-selected');
  ghost.setAttribute('aria-hidden', 'true');
  document.body.append(ghost);
  node.dataset.moving = '';
  const caret = document.createElement('span');
  caret.className = 'chord-drop-caret';
  root.append(caret);
  let target: ChordTarget | undefined;
  const move = (x: number, y: number) => {
    const positionGhost = () => {
      ghost.style.left = `${pointerType === 'mouse' ? x + 12 : Math.max(8, Math.min(x - ghost.offsetWidth / 2, innerWidth - ghost.offsetWidth - 8))}px`;
      ghost.style.top = `${Math.max(8, pointerType === 'mouse' ? y - 30 : y - ghost.offsetHeight - 56)}px`;
    };
    positionGhost();
    target = undefined;
    caret.hidden = true;
    const rows = [...root.querySelectorAll<HTMLElement>('.song-line,.song-space,.song-end')].filter(
      row => !row.closest('[hidden]'),
    );
    const row = rows.find(row => {
      const rect = row.getBoundingClientRect();
      return y >= rect.top - 3 && y <= rect.bottom + 3;
    });
    if (!row) {
      ghost.dataset.invalid = 'true';
      context.textContent = 'Velg tekstposisjon';
      positionGhost();
      return;
    }
    const line = Number(row.dataset.sourceLine),
      position = lyricPositionAt(row, x, y),
      offset = position.offset;
    target = {
      line,
      offset,
    };
    ghost.dataset.invalid = 'false';
    const text = lyricText(row);
    context.textContent =
      Array.from(text.slice(0, offset)).slice(-8).join('') + '│' + Array.from(text.slice(offset)).slice(0, 8).join('');
    positionGhost();
    const bounds = root.getBoundingClientRect();
    caret.hidden = false;
    caret.style.left = `${Math.max(0, Math.min(position.x - bounds.left, root.clientWidth - 2))}px`;
    caret.style.top = `${position.top - bounds.top}px`;
    caret.style.height = `${Math.max(20, position.height)}px`;
  };
  move(x, y);
  return {
    move,
    finish(cancel) {
      ghost.remove();
      caret.remove();
      delete node.dataset.moving;
      if (cancel || !target) return;
      drop(start, target);
    },
  };
}
