import type {GridBlock} from '../domain/chordpro.ts';
import {renderGrid} from './song-content.ts';
export function createChartDock(grids: GridBlock[], source: string, onRelease: () => void, sticky = true) {
  const dock = document.createElement('section'); dock.id = 'chart-dock'; dock.dataset.source = source; dock.dataset.sticky = String(sticky);
  dock.setAttribute('aria-label', 'Akkordskjema');
  const close = document.createElement('button'); close.type = 'button'; close.id = 'chart-close';
  close.textContent = '×'; close.setAttribute('aria-label', 'Frigjør akkordskjema');
  close.hidden = !sticky;
  close.addEventListener('click', () => {dock.dataset.sticky = 'false'; close.hidden = true; onRelease();});
  const fit = document.createElement('div'); fit.className = 'chart-fit';
  const natural = document.createElement('div'); natural.className = 'chart-natural';
  grids.forEach(grid => natural.append(renderGrid(grid)));
  fit.append(natural); dock.append(close, fit);
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
