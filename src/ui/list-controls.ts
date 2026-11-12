import {actionButton, dialogFrame, icon} from './controls.ts';
import {openDialog} from './dialog.ts';
import {placeOverlay} from './layout.ts';

/** L01: presentation belongs here; the caller owns metadata and navigation. */
export function metadataRow(title: string, metadata: string[], choose: () => void, menu?: (opener: HTMLButtonElement) => void) {
  const row = document.createElement('li');
  if(menu)row.className='count-row song-row';
  const button = actionButton('', choose); button.className = 'metadata-row';
  button.setAttribute('aria-label', [title, ...metadata].join(', '));
  const name = document.createElement('span'); name.className = 'song-name'; name.textContent = title;
  const details = document.createElement('span'); details.className = 'row-metadata';
  for (const text of metadata) {const part = document.createElement('span'); part.textContent = text; details.append(part);}
  button.append(name, details); row.append(button); const more=menu?rowMenu(title,menu):undefined;if(more)row.append(more);return {row, button, more};
}

export function rowMenu(name: string, menu: (opener: HTMLButtonElement)=>void) {
  const more = actionButton('', () => menu(more), 'meny'); more.className = 'row-menu';
  more.setAttribute('aria-label', `Handlinger for ${name}`); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');return more;
}

/** L05: one selected state and checkmark implementation for every choice row. */
export function selectableRow(name: string, selected: boolean, choose: () => void) {
  const button = actionButton(name, choose); button.className = 'selectable-row';
  button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(selected));
  button.tabIndex = selected ? 0 : -1;
  if (selected) {
    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.setAttribute('viewBox', '0 0 24 24'); check.setAttribute('aria-hidden', 'true'); check.classList.add('choice-check');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'm4 13 5 5 11-13'); check.append(path); button.append(check);
  }
  return button;
}

function arrowNavigation(container: HTMLElement, buttons: HTMLButtonElement[]) {
  container.addEventListener('keydown', event => {
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons.forEach((button, index) => {button.tabIndex = index === next ? 0 : -1;});
    buttons[next].focus();
  });
}

/** H01, with the actual icon from the shared register. */
export function floatingAction(name: string, choose: () => void) {
  const button = actionButton('', choose, 'ny'); button.className = 'floating-action';
  button.setAttribute('aria-label', name); return button;
}

export interface MenuAction {name: string; icon: string; run: () => void}
/** H04: shared placement, focus and dismissal; actions supply only their meaning. */
export function contextMenu(opener: HTMLButtonElement, actions: MenuAction[], side: 'above' | 'below' = 'above') {
  const name = opener.getAttribute('aria-label') || opener.textContent || 'Handlinger';
  const box = dialogFrame(name, 'context-menu');
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', name);
  if (opener.id) {box.id = `${opener.id}-dialog`; menu.id = `${opener.id}-menu`; opener.setAttribute('aria-controls', menu.id);}
  const buttons = actions.map(action => {
    const button = actionButton(action.name, () => {lifecycle.close(); action.run();}, action.icon);
    button.setAttribute('role', 'menuitem'); menu.append(button); return button;
  });
  box.append(menu); arrowNavigation(menu, buttons);
  opener.setAttribute('aria-expanded', 'true');
  const lifecycle = openDialog(box, {opener, focus: buttons[0], outside: true,
    place: () => placeOverlay(box, opener, {align: 'end', side}),
    closed: () => opener.setAttribute('aria-expanded', 'false')});
  return lifecycle;
}

/** L02: shared title/count row, with an independent menu target. */
export function countRow(name: string, count: number, choose: () => void, menu: (opener: HTMLButtonElement) => void) {
  const row = document.createElement('li'); row.className = 'count-row';
  const button = actionButton('', choose); button.className = 'count-choice';
  const title = document.createElement('span'); title.className = 'song-name'; title.textContent = name;
  const detail = document.createElement('span'); detail.className = 'row-metadata'; detail.textContent = `${count} ${count === 1 ? 'sang' : 'sanger'}`;
  button.setAttribute('aria-label', `${name}, ${detail.textContent}`); button.append(title, detail);
  const more = rowMenu(name,menu);
  row.append(button, more); return {row, button, more};
}

/** D09 composes L05. No creation action or confirmation footer. */
export function choicePicker(options: {opener: HTMLButtonElement; name: string; value: string; choices: {id: string | null; name: string}[]; selected: string | null; choose: (id: string | null) => void; create?: {name:string; run:()=>void}; cancel?: ()=>void; description?: string}) {
  let chosen=false;
  const box = dialogFrame(options.name, 'choice-picker');
  if (options.opener.id) {box.id = `${options.opener.id}-picker`; options.opener.setAttribute('aria-controls', box.id);}
  const heading = document.createElement('h2'); heading.textContent = options.name;
  const value = actionButton(options.value, () => lifecycle.close()); value.className = 'choice-value';
  value.setAttribute('aria-label', `Lukk ${options.name.toLocaleLowerCase('nb')}: ${options.value}`);
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 24 24'); chevron.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'm5 9 7 7 7-7'); chevron.append(path); value.append(chevron);
  const list = document.createElement('div'); list.className = 'choice-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', options.name);
  const buttons = options.choices.map(choice => {
    const button = selectableRow(choice.name, choice.id === options.selected, () => {chosen=true;lifecycle.close(); options.choose(choice.id);});
    list.append(button); return button;
  });
  arrowNavigation(list, buttons); box.append(heading, value, list);
  if(options.description){const text=document.createElement('p');text.className='hint';text.textContent=options.description;heading.after(text);}
  if(options.create)box.append(actionButton(options.create.name,()=>{chosen=true;lifecycle.close();options.create!.run();},'ny'));
  options.opener.setAttribute('aria-expanded', 'true');
  const lifecycle = openDialog(box, {opener: options.opener, focus: buttons.find(button => button.getAttribute('aria-selected') === 'true'), outside: true,
    place: () => placeOverlay(box, options.opener, {align: 'center', width: 572}),
    closed: () => {options.opener.setAttribute('aria-expanded', 'false');if(!chosen)options.cancel?.();}});
  return lifecycle;
}
