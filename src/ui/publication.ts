import type {syncController} from '../sync/controller.ts';
import type {PublicationView} from '../sync/model.ts';
import {actionButton, primaryButton, tabSwitcher} from './controls.ts';
import type {Songbook} from '../domain/songbook.ts';
import {currentPage} from './layout.ts';
import {metadataRow, setRowSelected, songbookFilter} from './list-controls.ts';

type Tab = 'unpublished' | 'published';
const tabs: {id: Tab; label: string; icon: string}[] = [
  {id: 'unpublished', label: 'Upublisert', icon: 'status-privat'},
  {id: 'published', label: 'Publisert', icon: 'status-delt'},
];

export function publicationPage(controller: ReturnType<typeof syncController>, bookFilter: {
  books(): Songbook[];
  selected(): string | null;
  choose(id: string | null, book?: Songbook): void;
  refreshed(books: Songbook[]): void;
}) {
  const root = document.getElementById('publication')!;
  const summary = document.createElement('dl');
  summary.className = 'publication-summary';
  const totals = ['Totalt', 'Publisert', 'Upublisert'].map(label => {
    const group = document.createElement('div'), term = document.createElement('dt'), value = document.createElement('dd');
    term.textContent = label;
    group.append(term, value);
    summary.append(group);
    return value;
  });
  summary.setAttribute('aria-label', 'Egne sanger i biblioteket');
  const status = document.createElement('p');
  status.className = 'hint';
  status.setAttribute('role', 'status');
  const bar = document.createElement('aside');
  bar.className = 'publication-actions';
  bar.setAttribute('aria-label', 'Valgte handlinger');
  const counts = document.createElement('p');
  counts.setAttribute('role', 'status');
  const perform = primaryButton('Utfør', () => {void execute();}, 'synkroniser');
  bar.append(counts, perform);

  const chosen = new Map<string, boolean>();
  let view: PublicationView = {songs: [], books: []};
  let active: Tab = 'unpublished', account: string | undefined, available = false, checking = false, executing = false, ticket = 0;
  let visit = 0, visible = false, resultText = '';
  const books = () => [...new Map([...bookFilter.books(), ...view.books].map(book => [book.id, book])).values()];
  const filter = songbookFilter('publication-songbook-filter', 'publication', books, bookFilter.selected,
    id => bookFilter.choose(id, id ? books().find(book => book.id === id) : undefined));
  filter.button.hidden = true;
  document.getElementById('header-actions')!.append(filter.button);
  const switcher = tabSwitcher('Publiseringsstatus', 'publication', tabs, active, id => {active = id; render();});
  const panels = tabs.map(({id}) => {
    const panel = document.createElement('div');
    panel.id = `publication-panel-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `publication-tab-${id}`);
    const empty = document.createElement('p');
    empty.className = 'empty-library';
    empty.textContent = id === 'published' ? 'Ingen publiserte sanger.' : 'Ingen upubliserte sanger.';
    const list = document.createElement('ul');
    list.className = 'song-list';
    panel.append(empty, list);
    return {id, panel, empty, list};
  });
  function visibleSongs() {
    const selectedBook = bookFilter.selected();
    return view.songs.filter(song => song.published === (active === 'published')
      && (selectedBook === null || song.songbookId === selectedBook));
  }
  const enabled = () => navigator.onLine && available && !checking && !executing;
  const selectAll = actionButton('Velg alle', () => {
    if (!enabled()) return;
    resultText = '';
    for (const song of visibleSongs()) chosen.set(song.id, !song.published);
    render();
  });
  selectAll.className = 'publication-select-all';
  const tabRow = document.createElement('div');
  tabRow.className = 'publication-tab-row';
  tabRow.append(switcher.element, selectAll);
  root.append(summary, status, tabRow, ...panels.map(({panel}) => panel), bar);
  new ResizeObserver(() => root.style.setProperty('--publication-action-height', `${bar.getBoundingClientRect().height}px`)).observe(bar);

  function actionText(published: number, withdrawn: number, pending = false) {
    const files = (count: number) => `${count} ${count === 1 ? 'fil' : 'filer'}`;
    return [published ? `${files(published)} ${pending ? 'publiseres' : 'ble publisert'}` : '',
      withdrawn ? `${files(withdrawn)} ${pending ? 'avpubliseres' : 'ble avpublisert'}` : ''].filter(Boolean).join(' · ');
  }

  function renderActions() {
    const published = [...chosen.values()].filter(Boolean).length;
    const withdrawn = chosen.size - published;
    const text = executing ? actionText(published, withdrawn, true) : resultText || `${published} valgt for publisering · ${withdrawn} for avpublisering`;
    if (text !== counts.textContent) counts.textContent = text;
    perform.toggleAttribute('data-syncing', executing);
    perform.disabled = !enabled() || !chosen.size;
    selectAll.disabled = !enabled() || !visibleSongs().length;
  }
  function render() {
    filter.render();
    const published = view.songs.filter(song => song.published).length;
    [view.songs.length, published, view.songs.length - published].forEach((value, index) => totals[index].textContent = String(value));
    const visible = visibleSongs().sort((a, b) => a.title.localeCompare(b.title, 'nb'));
    for (const {id, panel, empty, list} of panels) {
      panel.hidden = id !== active;
      if (panel.hidden) {list.replaceChildren(); continue;}
      const focus = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.songId : undefined;
      const rows = visible.map(song => {
        const {row, button} = metadataRow(song.title, [song.key, song.time].filter((value): value is string => Boolean(value)), () => {
          if (!enabled()) return;
          resultText = '';
          if (chosen.has(song.id)) chosen.delete(song.id);
          else chosen.set(song.id, !song.published);
          setRowSelected(button, chosen.has(song.id), 'aria-pressed');
          renderActions();
        });
        button.dataset.songId = song.id;
        button.disabled = !enabled();
        setRowSelected(button, chosen.has(song.id), 'aria-pressed');
        return {row, button};
      });
      list.replaceChildren(...rows.map(({row}) => row));
      rows.find(({button}) => focus && button.dataset.songId === focus && !button.disabled)?.button.focus({preventScroll: true});
      empty.hidden = visible.length > 0 || checking;
    }
    status.hidden = !status.textContent;
    renderActions();
  }
  const offline = 'Uten nett. Publisering og avpublisering krever forbindelse til Dropbox.';
  async function open() {
    if (executing || !account) return;
    const now = ++ticket;
    available = false;
    checking = true;
    status.textContent = navigator.onLine ? 'Oppdaterer fra Dropbox…' : offline;
    render();
    try {
      const cached = await controller.cachedPublication();
      if (now !== ticket) return;
      view = cached;
      render();
      if (!navigator.onLine) return;
      const result = await controller.readPublication();
      if (now !== ticket) return;
      view = result.view;
      available = !result.message && navigator.onLine;
      if (available) bookFilter.refreshed(view.books);
      status.textContent = navigator.onLine ? result.message ?? '' : offline;
    } catch {
      if (now === ticket) status.textContent = 'Kunne ikke lese publiseringsoversikten. Åpne Publisering igjen for å prøve på nytt.';
    } finally {
      if (now === ticket) {checking = false; render();}
    }
  }
  async function execute() {
    if (!enabled() || !chosen.size) return;
    const now = ticket, startedOnVisit = visit;
    const choices = Array.from(chosen, ([id, published]) => ({id, published}));
    executing = true;
    resultText = '';
    status.textContent = '';
    render();
    try {
      const result = await controller.publish(choices);
      if (now !== ticket) return;
      view = result.view;
      for (const id of result.completed) chosen.delete(id);
      if (startedOnVisit === visit) {
        const moved = new Set(result.moved);
        const published = choices.filter(choice => choice.published && moved.has(choice.id)).length;
        resultText = actionText(published, moved.size - published);
      }
      const remaining = choices.length - result.completed.length;
      status.textContent = remaining ? `${remaining} gjenstår.${result.message ? ` ${result.message}` : ''}` : result.message ?? '';
      available = !result.unavailable && navigator.onLine;
    } catch {
      if (now === ticket) status.textContent = 'Kunne ikke kontrollere Dropbox-resultatet. De valgte handlingene er beholdt.';
    } finally {
      if (now === ticket) {executing = false; render();}
    }
  }
  document.addEventListener('app-layout', () => {
    const showing = currentPage() === 'publication';
    if (showing === visible) return;
    visible = showing;
    visit++;
    resultText = '';
    if (visible) render();
  });
  window.addEventListener('online', () => {if (currentPage() === 'publication') void open();});
  window.addEventListener('offline', () => {available = false; status.textContent = offline; render();});
  return {open, render, accountChanged(id?: string) {
    if (id === account) return;
    account = id;
    ticket++;
    chosen.clear();
    view = {songs: [], books: []};
    resultText = '';
    available = checking = executing = false;
    status.textContent = '';
    switcher.select('unpublished');
    if (id && currentPage() === 'publication') void open();
  }};
}
