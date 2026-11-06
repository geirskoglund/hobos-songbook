/** Cap the combined display gap, including source blank lines and semantic block spacing. */
export function attachSongSpacing(body: HTMLElement): () => void {
  function normalize() {
    let previous: HTMLElement | null = null, blank = false;
    for (const unit of body.querySelectorAll<HTMLElement>('.song-space, .song-line, .comment, .unknown, .chorus > h2')) {
      unit.style.removeProperty('--content-gap');
      if (unit.closest('[hidden]')) continue;
      if (unit.classList.contains('song-space')) {blank = true; continue;}
      const semantic = unit.matches('.comment, .unknown, h2') || previous?.matches('.comment, .unknown, h2');
      const gap = previous ? blank ? 'var(--reader-line)' : semantic ? 'calc(var(--reader-line) / 4)' : '0px' : '0px';
      unit.style.setProperty('--content-gap', gap);
      previous = unit; blank = false;
    }
  }
  const mutation = new MutationObserver(normalize);
  mutation.observe(body, {attributes: true, subtree: true, attributeFilter: ['hidden']});
  normalize();
  return () => mutation.disconnect();
}
