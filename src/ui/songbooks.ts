import {songbookName, type Songbook} from '../domain/songbook.ts';
import type {LibrarySnapshot, songStorage} from '../storage/songs.ts';
import {controlHeading, dialogFooter, dialogFrame, textInput} from './controls.ts';
import {openDialog,confirmTransferCopy} from './dialog.ts';
import {choiceControl, contextMenu, countRow, floatingAction} from './list-controls.ts';
import {nameDialog} from './name-dialog.ts';
import {currentPage} from './layout.ts';
import {copyText} from './clipboard.ts';
import {SyncFailure} from '../sync/failure.ts';

export function startSongbooks(storage: ReturnType<typeof songStorage>, options: {
  changed: (snapshot: LibrarySnapshot) => void; openBook: (id: string) => void; account: () => string | undefined;
  shareBook: (id: string) => Promise<string | undefined>;
}) {
  const list = document.getElementById('songbook-list')!, status = document.getElementById('songbooks-status')!;
  const retry = document.getElementById('retry-songbooks') as HTMLButtonElement;
  let snapshot: LibrarySnapshot = {songs: [], songbooks: [], personal: []}, generation = 0;
  let writing: Promise<void> | undefined, nameEditor: ReturnType<typeof nameDialog> | undefined, sharing = false;
  const add = floatingAction('Ny sangbok', () => edit(add)); add.id = 'add-songbook'; add.disabled = true;
  document.getElementById('songbooks')!.append(add);
  const books = (exclude?: string) => snapshot.songbooks.filter(book => book.id !== exclude).sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  const count = (id: string) => snapshot.songs.filter(song => song.songbookId === id).length;
  function draw() {
    list.replaceChildren();
    for (const book of books()) {
      const {row, button, more} = countRow(book.name, count(book.id), () => options.openBook(book.id), opener => contextMenu(opener, [
        {name: 'Endre navn', icon: 'rediger', run: () => edit(opener, book)},
        ...(options.account() ? [{name: 'Kopier delingslenke', icon: 'status-delt', disabled: !navigator.onLine || sharing, run: () => {void copyShare(book.id);}}] : []),
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
  async function copyShare(id: string, authorized = true) {
    if (!authorized) {status.textContent = 'Dropbox ga ikke tilgang til delingslenker. Velg Kopier delingslenke for å prøve igjen.'; return;}
    const account = options.account();
    if (!account || sharing || !navigator.onLine) return;
    sharing = true;
    const stillHere = () => options.account() === account && currentPage() === 'songbooks';
    status.textContent = 'Henter delingslenke fra Dropbox…';
    try {
      const url = await options.shareBook(id);
      if (!stillHere() || !url) return;
      try {
        await copyText(url, document.getElementById('songbooks')!);
        status.textContent = 'Delingslenken er kopiert.';
      } catch {
        if (!stillHere()) return;
        status.textContent = '';
        const box = dialogFrame('Delingslenke', 'name-dialog');
        const heading = controlHeading('Kopier delingslenken', 'status-delt');
        const content = document.createElement('div');
        const hint = document.createElement('p');
        hint.textContent = 'Kopier lenken fra feltet nedenfor.';
        const field = textInput('manual-share-link', url, 'Delingslenke');
        field.readOnly = true;
        field.dataset.copyable = '';
        content.append(hint, field);
        const actions = dialogFooter([{id: 'close', label: 'Lukk', icon: 'kryss', run: () => lifecycle.close()}]);
        box.append(heading, content, actions);
        const lifecycle = openDialog(box, {opener: document.getElementById(`songbook-menu-${id}`) ?? add, focus: field});
        field.select();
      }
    } catch (error) {
      if (stillHere()) status.textContent = error instanceof SyncFailure && /^(dropbox\.sharing-|publication\.shared-folder)/.test(error.info.stage) ? error.message
        : navigator.onLine ? 'Kunne ikke hente delingslenken fra Dropbox. Prøv igjen.' : 'Uten nett. Delingslenken krever forbindelse til Dropbox.';
    } finally {
      if (options.account() !== account) status.textContent = '';
      sharing = false;
    }
  }
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
    const control = choiceControl({name: 'Sangbok', choices: books(exclude), selected,
      choose: id => {selected = id; update();},
      create: () => edit(control.value, undefined, id => {selected = id; update();}),
    });
    const valid = () => books(exclude).some(book => book.id === selected);
    const update = () => {control.update({choices: books(exclude), selected}); change();};
    return {...control, update, valid, selected: () => valid() ? selected : null};
  }
  /** Continue runs directly in the click handler, preserving Safari file-picker activation. */
  function chooseTarget(title: string, opener: HTMLElement, initial: string | null, accepted: (id: string) => void, cancelled?: () => void) {
    const box = dialogFrame(title, 'choice-picker');
    const target = targetControl(initial, () => {proceed.disabled = !target.valid();});
    const cancel = () => {lifecycle.close(); cancelled?.();};
    const actions = dialogFooter([
      {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: cancel},
      {id: 'continue', label: 'Fortsett', icon: 'ok', primary: true, run: () => {const id = target.selected(); if (id) {lifecycle.close(); accepted(id);}}},
    ]);
    const proceed = actions.querySelector<HTMLButtonElement>('[data-action=continue]')!;
    target.update(); box.append(controlHeading(title, 'sangbok'), target.element, actions);
    const lifecycle = openDialog(box, {opener, focus: target.value, cancel});
  }
  function remove(opener: HTMLElement, book: Songbook) {
    const box = dialogFrame('Slett sangbok', 'choice-picker');
    const heading = controlHeading('Slett sangbok', 'sangbok');
    const content = document.createElement('div'), text = document.createElement('p'), error = document.createElement('p');
    content.className = 'choice-picker-body';
    error.setAttribute('role', 'alert');
    let affected = count(book.id), last = snapshot.songbooks.length <= 1;
    const target = targetControl(null, update, book.id);
    const targetArea = target.element;
    const cancel = () => {if (!writing) lifecycle.close();};
    const actions = dialogFooter([
      {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: cancel},
      {id: 'delete', label: 'Slett', icon: 'slett', primary: true, run: () => {void confirm();}},
    ]);
    const deleteButton = actions.querySelector<HTMLButtonElement>('[data-action=delete]')!;
    function update() {
      text.textContent = last ? 'Den siste sangboken kan ikke slettes. Opprett en annen sangbok først.' : affected
        ? `Slett «${book.name}» og overfør ${affected} ${affected === 1 ? 'sang' : 'sanger'} til en annen sangbok.${options.account() ? ' Egne sanger blir private i målboken.' : ''} Sanginnhold, tilpasninger og setlister beholdes.`
        : `Vil du slette den tomme sangboken «${book.name}»?`;
      targetArea.hidden = !affected || last; deleteButton.disabled = last || Boolean(affected && !target.valid());
    }
    target.update(); content.append(text, targetArea, error); box.append(heading, content, actions);
    const lifecycle = openDialog(box, {opener, focus: actions.querySelector('button')!, cancel});
    async function confirm() {
      if (writing || deleteButton.disabled) return;
      actions.querySelectorAll('button').forEach(button => {button.disabled = true;}); target.setDisabled(true);
      writing = (async () => {
        try {
          const accountId=options.account(),plan=await storage.prepareTransfer(book.id,target.selected(),accountId);
          const destination=snapshot.songbooks.find(item=>item.id===target.selected())?.name??'';
          for(const match of plan.matches)if(!await confirmTransferCopy(match.title,match.filename,destination,deleteButton)){lifecycle.close();return;}
          await storage.deleteSongbook(book.id, target.selected(),{plan,accountId});
          const index = books().findIndex(item => item.id === book.id);
          snapshot = {...snapshot, songs: snapshot.songs.map(song => song.songbookId === book.id ? {...song, songbookId: target.selected()!} : song), songbooks: snapshot.songbooks.filter(item => item.id !== book.id)};
          draw(); options.changed(snapshot); lifecycle.close(); await refresh();
          (list.querySelectorAll<HTMLButtonElement>('.count-choice')[Math.min(index, snapshot.songbooks.length - 1)] ?? add).focus({preventScroll: true});
        } catch (cause) {
          await refresh(); affected = count(book.id); last = snapshot.songbooks.length <= 1;
          error.textContent = cause instanceof Error ? cause.message : 'Kunne ikke slette sangboken. Prøv igjen.';
          actions.querySelectorAll('button').forEach(button => {button.disabled = false;}); target.setDisabled(false); target.update();
        }
      })();
      try {await writing;} finally {writing = undefined;}
    }
  }
  return {
    accept, refresh, chooseTarget, copyShare,
    dirty: () => Boolean(writing || nameEditor?.dirty()),
    beforeUpdate: async () => {
      if (writing) await writing;
      await nameEditor?.beforeUpdate('Du har et ulagret sangboknavn. Lagre eller avbryt før oppdatering.');
    },
  };
}
