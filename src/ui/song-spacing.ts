/** Source blank lines create one compact pause; adjacent content gets no added gap. */
export function attachSongSpacing(body: HTMLElement): () => void {
  function normalize() {
    let previous: HTMLElement | null = null, blank = false, pause = false;
    for (const unit of body.querySelectorAll<HTMLElement>('.song-space, .song-line, .comment, .unknown, .dynamic-position, .chorus > h2')) {
      unit.style.removeProperty('--content-gap');
      if (unit.closest('[hidden]')) continue;
      if (unit.classList.contains('song-space')) {blank = true; continue;}
      const gap: string = previous && blank && !pause ? 'calc(var(--reader-line) / 2)' : '0px';
      unit.style.setProperty('--content-gap', gap);
      // A zero-height dynamics anchor can take the pause, but cannot double it.
      if (unit.classList.contains('dynamic-position')) {pause ||= gap !== '0px'; blank = false; continue;}
      previous = unit; blank = false;
      pause = false;
    }
  }
  const mutation = new MutationObserver(normalize);
  mutation.observe(body, {attributes: true, subtree: true, attributeFilter: ['hidden']});
  normalize();
  return () => mutation.disconnect();
}
