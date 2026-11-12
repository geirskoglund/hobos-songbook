import { actionButton } from './controls.ts';
/** Editing markers share the song's margin, including tags inside chorus blocks. */
export function attachDynamicMarkers(root: HTMLElement) {
  const anchors = [...root.querySelectorAll<HTMLElement>('.dynamic-position[data-dynamic-source]')].filter(node => !node.closest('[hidden]'));
  const markers = anchors.map(anchor => {
    const marker = actionButton(anchor.dataset.level ?? '3', undefined);
    marker.className = 'dynamic-marker';
    marker.dataset.dynamicLine = anchor.dataset.dynamicSource;
    marker.dataset.level = anchor.dataset.level;
    marker.setAttribute('aria-label', `Dynamikk ${anchor.dataset.level}`);
    root.append(marker);
    return marker;
  });
  let frame = 0,
    disposed = false;
  const draw = () => {
    frame = 0;
    if (disposed) return;
    const origin = root.getBoundingClientRect();
    let last = -28;
    anchors.forEach((anchor, index) => {
      const top = Math.max(anchor.getBoundingClientRect().top - origin.top, last + 28);
      markers[index].style.top = `${top}px`;
      last = top;
    });
  };
  const schedule = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(draw);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  for (const anchor of anchors) resize.observe(anchor);
  window.addEventListener('resize', schedule);
  document.fonts.addEventListener('loadingdone', schedule);
  document.fonts.ready.then(schedule);
  schedule();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    window.removeEventListener('resize', schedule);
    document.fonts.removeEventListener('loadingdone', schedule);
    markers.forEach(marker => marker.remove());
  };
}
