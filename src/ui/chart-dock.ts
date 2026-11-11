import {actionButton, icon} from './controls.ts';
import type {GridBlock} from '../domain/chordpro.ts';
import {renderGrid} from './song-content.ts';
export function createChartDock(grids: GridBlock[], source: string, options: {sticky?: boolean; interactive?: boolean; change?: (sticky: boolean) => void} = {}) {
  let sticky = options.sticky ?? true;
  const dock = document.createElement('section'); dock.id = 'chart-dock'; dock.dataset.source = source;
  dock.setAttribute('aria-label', 'Akkordskjema');
  const toggle = actionButton('', undefined); toggle.id = 'chart-close';
  toggle.hidden = options.interactive === false;
  const reflect = () => {
    dock.dataset.sticky = String(sticky);
    const action = sticky ? 'Frigjør akkordskjema' : 'Fest akkordskjema';
    toggle.setAttribute('aria-label', action); toggle.setAttribute('aria-pressed', String(sticky));
    toggle.dataset.tooltip = action;
    toggle.replaceChildren(icon(sticky ? 'pin-on' : 'pin-off'));
  };
  toggle.addEventListener('click', () => {sticky = !sticky; reflect(); options.change?.(sticky);});
  reflect();
  const fit = document.createElement('div'); fit.className = 'chart-fit';
  const natural = document.createElement('div'); natural.className = 'chart-natural';
  grids.forEach(grid => natural.append(renderGrid(grid)));
  fit.append(natural); dock.append(toggle, fit);
  let frame = 0;
  const fitChart = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const height = natural.offsetHeight;
      const available = Math.max(50, innerHeight * .3 - 12);
      const scale = height ? Math.min(1, available / height) : 1;
      natural.style.transform = `scale(${scale})`;
      fit.style.height = `${height * scale}px`;
      dock.dataset.compact = String(scale < 1);
    });
  };
  const resize = new ResizeObserver(fitChart);
  window.addEventListener('resize', fitChart);document.addEventListener('app-layout',fitChart);
  resize.observe(natural); resize.observe(document.documentElement);
  return {element: dock, dispose: () => {cancelAnimationFrame(frame);document.removeEventListener('app-layout',fitChart); resize.disconnect(); window.removeEventListener('resize', fitChart);}};
}
