import {songbookName, type Songbook} from '../domain/songbook.ts';
import type {LibrarySnapshot, songStorage} from '../storage/songs.ts';
import {controlHeading, dialogFooter, dialogFrame} from './controls.ts';
import {openDialog} from './dialog.ts';
import {choicePicker, choiceValue, contextMenu, countRow, floatingAction} from './list-controls.ts';
import {nameDialog} from './name-dialog.ts';
import {currentPage} from './layout.ts';

export function startSongbooks(storage: ReturnType<typeof songStorage>, options: {
  changed: (snapshot: LibrarySnapshot) => void; openBook: (id: string) => void;
}) {
  const list = document.getElementById('songbook-list')!, status = document.getElementById('songbooks-status')!;
  const retry = document.getElementById('retry-songbooks') as HTMLButtonElement;
  let snapshot: LibrarySnapshot = {songs: [], songbooks: [], personal: []}, generation = 0;
  let writing: Promise<void> | undefined, nameEditor: ReturnType<typeof nameDialog> | undefined;
  const add = floatingAction('Ny sangbok', () => edit(add)); add.id = 'add-songbook'; add.disabled = true;
  document.getElementById('songbooks')!.append(add);
  const books = (exclude?: string) => snapshot.songbooks.filter(book => book.id !== exclude).sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  const count = (id: string) => snapshot.songs.filter(song => song.songbookId === id).length;
  function draw() {
    list.replaceChildren();
    for (const book of books()) {
      const {row, button, more} = countRow(book.name, count(book.id), () => options.openBook(book.id), opener => contextMenu(opener, [
        {name: 'Endre navn', icon: 'rediger', run: () => edit(opener, book)},
        {name: 'Slett', icon: 'slett', run: () => remove(opener, book)},
      ], 'below'));
      button.id = `songbook-${book.id}`; button.dataset.songbookId = book.id; more.id = `songbook-menu-${book.id}`;
      list.append(row);
    }
    add.disabled = false;
  }
  function accept(next: LibrarySnapshot) {snapshot = next; if (currentPage() === 'songbooks') draw();}
  async function refresh(render = currentPage() === 'songbooks') {
    const reading = ++generation; retry.hidden = true; add.disabled = true;
    try {
      const next = await storage.library();
      if (reading !== generation) return false;
      accept(next); if (render && currentPage() !== 'songbooks') draw();
      options.changed(next); status.textContent = ''; return true;
    } catch (cause) {
      if (reading !== generation) return false;
      status.textContent = cause instanceof Error ? cause.message : 'Kunne ikke lese sangbøkene. Prøv igjen.';
      retry.hidden = false; return false;
    }
  }
  retry.addEventListener('click', () => {void refresh();});
  function edit(opener: HTMLElement, book?: Songbook, selected?: (id: string) => void) {
    const id = book?.id ?? crypto.randomUUID();
    nameEditor = nameDialog({title: book ? 'Endre navn på sangbok' : 'Ny sangbok', id: 'songbook-name', initial: book?.name, opener,
      validate: value => songbookName(value, snapshot.songbooks, book?.id),
      save: async name => {
        const saved = await (book ? storage.renameSongbook(id, name) : storage.createSongbook(id, name));
        snapshot = {...snapshot, songbooks: [...snapshot.songbooks.filter(item => item.id !== id), saved]};
        accept(snapshot); options.changed(snapshot);
        // A committed write remains committed even if the follow-up read fails.
        await refresh();
      },
      saved: () => {
        if (selected) selected(id);
        else (document.getElementById(`songbook-menu-${id}`) ?? add).focus({preventScroll: true});
      },
    });
  }
  function targetControl(initial: string | null, change: () => void, exclude?: string) {
    let selected = initial;
    const value = choiceValue('', () => {
      choicePicker({opener: value, name: 'Sangbok', value: name(), choices: books(exclude), selected,
        choose: id => {selected = id; update();}, create: () => edit(value, undefined, id => {selected = id; update();})});
    });
    value.setAttribute('aria-haspopup', 'dialog'); value.setAttribute('aria-expanded', 'false');
    const name = () => books(exclude).find(book => book.id === selected)?.name ?? 'Velg sangbok';
    const valid = () => books(exclude).some(book => book.id === selected);
    const update = () => {value.querySelector('span')!.textContent = name(); value.setAttribute('aria-label', `Sangbok: ${name()}`); change();};
    return {element: value, update, valid, selected: () => valid() ? selected : null};
  }
  /** Continue runs directly in the click handler, preserving Safari file-picker activation. */
  function chooseTarget(title: string, opener: HTMLElement, initial: string | null, accepted: (id: string) => void, cancelled?: () => void) {
    const box = dialogFrame(title, 'name-dialog');
    const heading = document.createElement('h2'); heading.textContent = title;
    const content = document.createElement('div'); content.className = 'target-choice';
    const target = targetControl(initial, () => {proceed.disabled = !target.valid();});
    const cancel = () => {lifecycle.close(); cancelled?.();};
    const actions = dialogFooter([
      {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: cancel},
      {id: 'continue', label: 'Fortsett', icon: 'ok', primary: true, run: () => {const id = target.selected(); if (id) {lifecycle.close(); accepted(id);}}},
    ]);
    const proceed = actions.querySelector<HTMLButtonElement>('[data-action=continue]')!;
    target.update(); content.append(controlHeading('Sangbok', 'sangbok'), target.element); box.append(heading, content, actions);
    const lifecycle = openDialog(box, {opener, focus: target.element, cancel});
  }
  function remove(opener: HTMLElement, book: Songbook) {
    const box = dialogFrame('Slett sangbok', 'name-dialog');
    const heading = document.createElement('h2'); heading.textContent = 'Slett sangbok';
    const content = document.createElement('div'), text = document.createElement('p'), error = document.createElement('p');
    error.setAttribute('role', 'alert');
    let affected = count(book.id), last = snapshot.songbooks.length <= 1;
    const target = targetControl(null, update, book.id);
    const targetArea = document.createElement('div'); targetArea.className = 'target-choice'; targetArea.append(controlHeading('Sangbok', 'sangbok'), target.element);
    const cancel = () => {if (!writing) lifecycle.close();};
    const actions = dialogFooter([
      {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: cancel},
      {id: 'delete', label: 'Slett', icon: 'slett', primary: true, run: () => {void confirm();}},
    ]);
    const deleteButton = actions.querySelector<HTMLButtonElement>('[data-action=delete]')!;
    function update() {
      text.textContent = last ? 'Den siste sangboken kan ikke slettes. Opprett en annen sangbok først.' : affected
        ? `Slett «${book.name}» og overfør ${affected} ${affected === 1 ? 'sang' : 'sanger'} til en annen sangbok. Sanginnhold, tilpasninger og setlister beholdes.`
        : `Vil du slette den tomme sangboken «${book.name}»?`;
      targetArea.hidden = !affected || last; deleteButton.disabled = last || Boolean(affected && !target.valid());
    }
    target.update(); content.append(text, targetArea, error); box.append(heading, content, actions);
    const lifecycle = openDialog(box, {opener, focus: actions.querySelector('button')!, cancel});
    async function confirm() {
      if (writing || deleteButton.disabled) return;
      actions.querySelectorAll('button').forEach(button => {button.disabled = true;}); target.element.disabled = true;
      writing = (async () => {
        try {
          await storage.deleteSongbook(book.id, target.selected());
          const index = books().findIndex(item => item.id === book.id);
          snapshot = {...snapshot, songs: snapshot.songs.map(song => song.songbookId === book.id ? {...song, songbookId: target.selected()!} : song), songbooks: snapshot.songbooks.filter(item => item.id !== book.id)};
          draw(); options.changed(snapshot); lifecycle.close(); await refresh();
          (list.querySelectorAll<HTMLButtonElement>('.count-choice')[Math.min(index, snapshot.songbooks.length - 1)] ?? add).focus({preventScroll: true});
        } catch (cause) {
          await refresh(); affected = count(book.id); last = snapshot.songbooks.length <= 1;
          error.textContent = cause instanceof Error ? cause.message : 'Kunne ikke slette sangboken. Prøv igjen.';
          actions.querySelectorAll('button').forEach(button => {button.disabled = false;}); target.element.disabled = false; target.update();
        }
      })();
      try {await writing;} finally {writing = undefined;}
    }
  }
  return {
    accept, refresh, chooseTarget,
    dirty: () => Boolean(writing || nameEditor?.dirty()),
    beforeUpdate: async () => {
      if (writing) await writing;
      await nameEditor?.beforeUpdate('Du har et ulagret sangboknavn. Lagre eller avbryt før oppdatering.');
    },
  };
}
