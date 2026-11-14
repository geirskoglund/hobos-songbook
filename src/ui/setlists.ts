import type {songStorage} from '../storage/songs.ts';
import {setlistName, type Setlist} from '../domain/setlist.ts';
import {nameDialog} from './name-dialog.ts';
import {dialogFooter, dialogFrame} from './controls.ts';
import {openDialog} from './dialog.ts';
import {contextMenu, countRow, floatingAction} from './list-controls.ts';
import {currentPage, showPage} from './layout.ts';
import {captureView, focusUpdateView, restoreUpdateView, type SetlistView, type UpdateView} from './update-view.ts';

export function startSetlists(storage: ReturnType<typeof songStorage>) {
  const query = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const list = query('setlist-list'), status = query('setlists-status'), retry = query<HTMLButtonElement>('retry-setlists');
  let items: Setlist[] = [], selected: string | undefined, returnView: UpdateView | undefined;
  let generation = 0, writing: Promise<void> | undefined, nameEditor: ReturnType<typeof nameDialog> | undefined;
  const add = floatingAction('Ny setliste', () => edit(add)); add.id = 'add-setlist'; add.disabled = true;
  query('setlists').append(add);

  function openSetlist(id: string, newlyCreated = false) {
    returnView = captureView(null, `setlist-${id}`);
    if (newlyCreated) {returnView.scrollY = 0; delete returnView.anchor;}
    selected = id;
    showPage('setlist'); query('setlist-title').focus({preventScroll: true}); window.scrollTo(0, 0);
  }
  function draw() {
    list.replaceChildren();
    items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    for (const item of items) {
      const {row, button, more} = countRow(item.name, item.songIds.length, () => openSetlist(item.id), opener => contextMenu(opener, [
        {name: 'Endre info', icon: 'rediger', run: () => edit(opener, item)},
        {name: 'Slett', icon: 'slett', run: () => remove(opener, item)},
      ], 'below'));
      button.id = `setlist-${item.id}`; button.dataset.setlistId = item.id; more.id = `setlist-menu-${item.id}`;
      list.append(row);
    }
    status.textContent = items.length ? '' : 'Ingen setlister ennå. Bruk plussknappen for å opprette en setliste.';
    status.classList.toggle('empty-library', !items.length);
  }
  async function refresh() {
    const reading = ++generation; retry.hidden = true; add.disabled = true;
    try {
      const next = await storage.setlists();
      if (reading !== generation) return false;
      items = next; draw(); add.disabled = false; return true;
    } catch (error) {
      if (reading !== generation) return false;
      status.classList.remove('empty-library');
      status.textContent = error instanceof Error ? error.message : 'Kunne ikke lese setlistene. Prøv igjen.';
      retry.hidden = false; return false;
    }
  }
  retry.addEventListener('click', () => {void refresh();});

  function edit(opener: HTMLElement, item?: Setlist) {
    const id = item?.id ?? crypto.randomUUID();
    nameEditor = nameDialog({title: item ? 'Rediger setliste' : 'Ny setliste', id: 'setlist-name', initial: item?.name, opener,
      validate: setlistName,
      save: async name => {
        const saved = await (item ? storage.renameSetlist(id, name) : storage.createSetlist(id, name));
        items = [...items.filter(current => current.id !== id), saved!]; draw();
      },
      saved: () => {if (item) query(`setlist-menu-${id}`).focus({preventScroll: true}); else openSetlist(id, true);},
    });
  }
  function remove(opener: HTMLElement, item: Setlist) {
    const box = dialogFrame('Slett setliste', 'name-dialog');
    const heading = document.createElement('h2'); heading.textContent = 'Slett setliste';
    const text = document.createElement('p'); text.textContent = `Vil du slette «${item.name}»? Sangene beholdes.`;
    const error = document.createElement('p'); error.setAttribute('role', 'alert');
    const cancel = () => {if (!writing) lifecycle.close();};
    const actions = dialogFooter([
      {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: cancel},
      {id: 'delete', label: 'Slett', icon: 'slett', primary: true, run: () => {void confirm();}},
    ]);
    box.append(heading, text, error, actions);
    const lifecycle = openDialog(box, {opener, focus: actions.querySelector('button')!, cancel});
    async function confirm() {
      if (writing) return;
      actions.querySelectorAll('button').forEach(button => {button.disabled = true;});
      writing = (async () => {
        try {
          await storage.deleteSetlist(item.id);
          const index = items.findIndex(current => current.id === item.id);
          items = items.filter(current => current.id !== item.id); draw(); lifecycle.close();
          (list.querySelectorAll<HTMLButtonElement>('.count-choice')[Math.min(index, items.length - 1)] ?? add).focus({preventScroll: true});
        } catch (cause) {
          error.textContent = cause instanceof Error ? cause.message : 'Kunne ikke slette setlisten. Prøv igjen.';
          actions.querySelectorAll('button').forEach(button => {button.disabled = false;});
        }
      })();
      try {await writing;} finally {writing = undefined;}
    }
  }
  return {
    refresh,
    dirty: () => Boolean(nameEditor?.dirty() || writing),
    context: (): SetlistView => ({setlistId: selected, setlistsReturn: returnView}),
    reset: () => {selected = undefined; returnView = undefined;},
    restore: async (view: UpdateView) => {
      if (!await refresh()) return false;
      selected = view.setlistId; returnView = view.setlistsReturn;
      if (selected && !items.some(item => item.id === selected)) {
        selected = undefined; returnView = undefined;
        view.setlistId = undefined; view.setlistsReturn = undefined;
        if (view.page === 'setlist') view.page = 'setlists';
        if (view.settingsReturn?.page === 'setlist') view.settingsReturn = {...view.settingsReturn, page: 'setlists', setlistId: undefined, setlistsReturn: undefined};
      }
      return true;
    },
    back: async () => {
      const view = returnView; selected = undefined; returnView = undefined;
      if (view) {await restoreUpdateView(view, () => currentPage() === 'setlists'); focusUpdateView(view);}
      else {showPage('setlists'); query('setlists-title').focus({preventScroll: true});}
    },
    beforeUpdate: async () => {
      if (writing) await writing;
      await nameEditor?.beforeUpdate('Du har et ulagret setlistenavn. Lagre eller avbryt før oppdatering.');
    },
  };
}
