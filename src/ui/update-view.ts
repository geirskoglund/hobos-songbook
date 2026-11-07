/** One-shot, per-tab view handoff when the user applies an app update. */
export interface UpdateView {
  version: 1;
  editor?: {from: 'reader' | 'library'; returnView?: UpdateView; annotation?: {occurrence: string; start: number; end: number}};
  songId: string | null;
  scrollY: number;
  chartReleased: boolean;
  anchor?: {index: number; offset: number; itemId?: string};
  menu: {open: boolean; scrollTop: number; infoOpen: boolean};
  focusId: string | null;
}
const stateKey = (namespace: string) => `${namespace}:update-view`;
const rows = (songId: string | null) => [...document.querySelectorAll<HTMLElement>(songId ?
  '#song-body .song-line, #song-body .comment, #song-body .unknown, #song-body .chorus > h2' : '#song-list .song-choice')];
function readingTop() {
  let top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
  const dock = document.getElementById('chart-dock');
  const rect = dock?.getBoundingClientRect();
  if (dock?.dataset.sticky === 'true' && rect?.height && rect.top <= top + 1) top = Math.max(top, rect.bottom);
  return top;
}
export function saveUpdateView(namespace: string, songId: string | null, focusId: string | null, editor?: UpdateView['editor']) {
  try {
    const menu = document.getElementById('settings-dialog') as HTMLDialogElement;
    const view: UpdateView = {
      version: 1, songId, scrollY, chartReleased: Boolean(songId && document.getElementById('chart-dock')?.dataset.sticky === 'false'),
      menu: {open: menu.open, scrollTop: menu.scrollTop, infoOpen: document.querySelector<HTMLDetailsElement>('.app-info')!.open},
      focusId, editor,
    };
    if (scrollY > 0) {
      const content = rows(songId), top = readingTop();
      const index = content.findIndex(row => {
        const rect = row.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > top && rect.top < innerHeight;
      });
      if (index >= 0) view.anchor = {index, offset: content[index].getBoundingClientRect().top - top, itemId: content[index].dataset.songId};
    }
    history.replaceState({...history.state, [stateKey(namespace)]: view}, '');
  } catch { /* Updating must still work when session history is unavailable. */ }
}
export function takeUpdateView(namespace: string): UpdateView | null {
  try {
    const state = {...history.state}, key = stateKey(namespace);
    if (!Object.hasOwn(state, key)) return null;
    const view = state[key];
    delete state[key]; history.replaceState(Object.keys(state).length ? state : null, '');
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    if (view?.version !== 1 || !(view.songId === null || typeof view.songId === 'string') ||
        !finite(view.scrollY) || view.scrollY < 0 || typeof view.chartReleased !== 'boolean' ||
        typeof view.menu?.open !== 'boolean' || !finite(view.menu.scrollTop) || view.menu.scrollTop < 0 ||
        typeof view.menu.infoOpen !== 'boolean' || !(view.focusId === null || typeof view.focusId === 'string')) return null;
    if (view.editor && (!['reader','library'].includes(view.editor.from) || view.editor.returnView?.editor)) return null;
    const annotation = view.editor?.annotation;
    if (annotation && (typeof annotation.occurrence !== 'string' || !Number.isInteger(annotation.start) || !Number.isInteger(annotation.end) || annotation.start < 0 || annotation.end < annotation.start)) return null;
    if (view.anchor && (!Number.isInteger(view.anchor.index) || view.anchor.index < 0 || !finite(view.anchor.offset) ||
        !(view.anchor.itemId === undefined || typeof view.anchor.itemId === 'string'))) return null;
    return view;
  } catch {return null;}
}
export async function restoreUpdateView(view: UpdateView, isCurrent: () => boolean) {
  const menu = document.getElementById('settings-dialog') as HTMLDialogElement;
  document.querySelector<HTMLDetailsElement>('.app-info')!.open = view.menu.infoOpen;
  if (view.menu.open && !menu.open) menu.showModal();
  // Let the reader, chart fitting and dialog reach their new layout before positioning.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (!isCurrent()) return;
  window.scrollTo(0, view.scrollY);
  if (view.anchor) {
    const content = rows(view.songId);
    const row = view.anchor.itemId ? content.find(row => row.dataset.songId === view.anchor!.itemId) : content[view.anchor.index];
    const rect = row?.getBoundingClientRect();
    if (rect?.height) window.scrollTo(0, Math.max(0, scrollY + rect.top - readingTop() - view.anchor.offset));
  }
  menu.scrollTop = view.menu.scrollTop;
}
export function focusUpdateView(view: UpdateView) {
  const previous = view.focusId ? document.getElementById(view.focusId) : null;
  const target = previous?.getClientRects().length ? previous : document.getElementById(view.songId ? 'song-title' : 'library-title');
  target?.focus({preventScroll: true});
}
