/** Notes attach to lyric glyphs, never to the chord row or synthetic editor targets. */
export function noteAnchor(row: HTMLElement) {
  const bounds = row.getBoundingClientRect(),
    walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent?.trim() && !node.parentElement?.closest('.personal-note,.chord,button,.sr-only,.annotation-connectors') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
  let last: Node | undefined, node: Node | null;
  while (node = walker.nextNode()) last = node;
  if (last) {
    const text = (last.textContent ?? '').trimEnd(),
      length = Array.from(text).at(-1)?.length ?? 1,
      range = document.createRange();
    range.setStart(last, Math.max(0, text.length - length));
    range.setEnd(last, text.length);
    const rect = range.getBoundingClientRect();
    if (rect.height) return {
      x: rect.right,
      y: rect.top + rect.height / 2,
      left: bounds.left
    };
  }
  const lyric = row.querySelector<HTMLElement>('.lyric')?.getBoundingClientRect();
  if (lyric?.height) return {
    x: lyric.left,
    y: lyric.top + lyric.height / 2,
    left: bounds.left
  };
  const lineHeight = parseFloat(getComputedStyle(row).lineHeight) || 24;
  return {
    x: bounds.left,
    y: bounds.top + (row.classList.contains('song-space') ? lineHeight / 4 : bounds.height / 2),
    left: bounds.left
  };
}
export function noteTargets(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('[data-note-line]')].filter(row => !row.matches('.song-end') && !row.closest('[hidden]') && row.getClientRects().length && Number.isSafeInteger(Number(row.dataset.noteLine)) && Number(row.dataset.noteLine) >= 0);
}
export function nearestNoteTarget(root: HTMLElement, y: number) {
  return noteTargets(root).reduce<HTMLElement | undefined>((best, row) => !best || Math.abs(noteAnchor(row).y - y) < Math.abs(noteAnchor(best).y - y) ? row : best, undefined);
}
export function canPlaceNote(root: HTMLElement, note: HTMLElement, row: HTMLElement) {
  if (note.parentElement === row) return true;
  if (row.querySelector('.personal-note')) return false;
  const center = noteAnchor(row).y,
    height = note.getBoundingClientRect().height,
    top = center - height / 2,
    bottom = center + height / 2;
  return ![...root.querySelectorAll<HTMLElement>('.personal-note')].some(other => other !== note && !other.closest('[hidden]') && (() => {
    const bounds = other.getBoundingClientRect();
    return top < bounds.bottom + 8 && bottom > bounds.top - 8;
  })());
}
