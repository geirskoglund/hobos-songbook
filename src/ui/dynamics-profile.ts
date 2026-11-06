/** A single continuous, symmetric silhouette. Corner rounding is local to explicit level changes. */
export function attachDynamicsProfile(body: HTMLElement): () => void {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.id = 'dynamics-profile'; svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.append(path); body.prepend(svg);
  let frame = 0, disposed = false;
  function draw() {
    frame = 0; if (disposed) return;
    const bounds = body.getBoundingClientRect(), height = body.offsetHeight;
    const width = Math.min(112, bounds.width * .22), center = width / 2;
    const ratios = [.24, .4, .58, .78, 1];
    const segments: {y: number; half: number}[] = [];
    for (const row of body.querySelectorAll<HTMLElement>('.dynamic-row')) {
      const rect = row.getBoundingClientRect(); if (!rect.height || !rect.width) continue;
      const half = width * ratios[Number(row.dataset.dynamicLevel) - 1] / 2;
      if (segments.at(-1)?.half !== half) segments.push({y: segments.length ? Math.max(0, rect.top - bounds.top) : 0, half});
    }
    if (!segments.length || !height || !width) {svg.style.display = 'none'; return;}
    svg.style.removeProperty('display'); svg.style.width = `${width}px`; svg.style.height = `${height}px`;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const first = segments[0].half, last = segments.at(-1)!.half, cap = Math.min(4, first, last, height / 3);
    let d = `M ${center-first+cap} 0 L ${center+first-cap} 0 Q ${center+first} 0 ${center+first} ${cap}`;
    const radius = (index: number) => Math.min(7, (segments[index].y-segments[index-1].y)/3, ((segments[index+1]?.y ?? height)-segments[index].y)/3);
    for (let index = 1; index < segments.length; index++) {
      const previous = segments[index-1], current = segments[index], r = radius(index);
      d += ` L ${center+previous.half} ${current.y-r} C ${center+previous.half} ${current.y} ${center+current.half} ${current.y} ${center+current.half} ${current.y+r}`;
    }
    d += ` L ${center+last} ${height-cap} Q ${center+last} ${height} ${center+last-cap} ${height} L ${center-last+cap} ${height} Q ${center-last} ${height} ${center-last} ${height-cap}`;
    for (let index = segments.length-1; index > 0; index--) {
      const lower = segments[index], upper = segments[index-1], r = radius(index);
      d += ` L ${center-lower.half} ${lower.y+r} C ${center-lower.half} ${lower.y} ${center-upper.half} ${lower.y} ${center-upper.half} ${lower.y-r}`;
    }
    d += ` L ${center-first} ${cap} Q ${center-first} 0 ${center-first+cap} 0 Z`;
    path.setAttribute('d', d);
  }
  const schedule = () => {if (!frame && !disposed) frame = requestAnimationFrame(draw);};
  const resize = new ResizeObserver(schedule); resize.observe(body);
  body.querySelectorAll('.dynamic-row').forEach(row => resize.observe(row));
  const mutation = new MutationObserver(schedule);
  mutation.observe(body, {subtree: true, attributes: true, attributeFilter: ['hidden']});
  schedule();
  return () => {disposed = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); svg.remove();};
}
