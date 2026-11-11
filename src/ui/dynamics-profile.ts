/** A fixed left edge; only the right edge changes width at explicit level changes. */
export function attachDynamicsProfile(body: HTMLElement, hasDynamics: boolean): () => void {
  body.dataset.hasDynamics = String(hasDynamics);
  if (!hasDynamics) return () => {delete body.dataset.hasDynamics;};
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.id = 'dynamics-profile'; svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.append(path); body.prepend(svg);
  let frame = 0, disposed = false;
  function draw() {
    frame = 0; if (disposed) return;
    const bounds = body.getBoundingClientRect(), height = body.offsetHeight;
    const width = 25;
    const segments: {y: number; width: number}[] = [];
    for (const row of body.querySelectorAll<HTMLElement>('.dynamic-row')) {
      const rect = row.getBoundingClientRect(); if (!rect.height || !rect.width) continue;
      const levelWidth = Number(row.dataset.dynamicLevel) * 5;
      if (segments.at(-1)?.width !== levelWidth) segments.push({y: segments.length ? Math.max(0, rect.top - bounds.top) : 0, width: levelWidth});
    }
    if (!segments.length || !height || !width) {svg.style.display = 'none'; return;}
    svg.style.removeProperty('display'); svg.style.width = `${width}px`; svg.style.height = `${height}px`;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const first = segments[0].width, last = segments.at(-1)!.width;
    let d = `M 0 0 L ${first} 0`;
    const radius = (index: number) => Math.min(7, (segments[index].y-segments[index-1].y)/3, ((segments[index+1]?.y ?? height)-segments[index].y)/3);
    for (let index = 1; index < segments.length; index++) {
      const previous = segments[index-1], current = segments[index], r = radius(index);
      d += ` L ${previous.width} ${current.y-r} C ${previous.width} ${current.y} ${current.width} ${current.y} ${current.width} ${current.y+r}`;
    }
    d += ` L ${last} ${height} L 0 ${height} Z`;
    path.setAttribute('d', d);
  }
  const schedule = () => {if (!frame && !disposed) frame = requestAnimationFrame(draw);};
  const resize = new ResizeObserver(schedule); resize.observe(body);
  body.querySelectorAll('.dynamic-row').forEach(row => resize.observe(row));
  const mutation = new MutationObserver(schedule);
  mutation.observe(body, {subtree: true, attributes: true, attributeFilter: ['hidden']});
  document.addEventListener('app-layout',schedule);
  schedule();
  return () => {disposed = true; document.removeEventListener('app-layout',schedule); cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); svg.remove();delete body.dataset.hasDynamics;};
}
