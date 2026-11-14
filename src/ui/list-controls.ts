import {actionButton, controlHeading, dialogFrame, icon} from './controls.ts';
import {openDialog} from './dialog.ts';
import {placeOverlay} from './layout.ts';

/** L01: presentation belongs here; the caller owns metadata and navigation. */
export function metadataRow(title: string, metadata: string[], choose: () => void) {
  const row = document.createElement('li');
  const button = actionButton('', choose); button.className = 'song-choice metadata-row';
  button.setAttribute('aria-label', [title, ...metadata].join(', '));
  const name = document.createElement('span'); name.className = 'song-name'; name.textContent = title;
  const details = document.createElement('span'); details.className = 'row-metadata';
  for (const text of metadata) {const part = document.createElement('span'); part.textContent = text; details.append(part);}
  button.append(name, details); row.append(button); return {row, button};
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

function arrowNavigation(container: HTMLElement, items: HTMLButtonElement[] | (() => HTMLButtonElement[])) {
  container.addEventListener('keydown', event => {
    const buttons = typeof items === 'function' ? items() : items;
    if (!buttons.length) return;
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

/** H04: shared placement, focus and dismissal; actions supply only their meaning. */
export function contextMenu(opener: HTMLButtonElement, actions: {name: string; icon: string; run: () => void}[], side: 'above' | 'below' = 'above') {
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
  const more = actionButton('', () => menu(more), 'meny'); more.className = 'row-menu';
  more.setAttribute('aria-label', `Handlinger for ${name}`); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
  row.append(button, more); return {row, button, more};
}

type Choice = {id: string | null; name: string};

/** D09/D10 share one value, one list and the optional creation action within their own popup. */
export function choiceControl(options: {name: string; choices: Choice[]; selected: string | null; choose: (id: string | null) => void; create?: () => void; expanded?: boolean; valueAction?: () => void}) {
  let choices = options.choices, selected = options.selected, expanded = Boolean(options.expanded), disabled = false;
  let buttons: HTMLButtonElement[] = [];
  const element = document.createElement('div'); element.className = 'choice-control';
  const value = choiceValue('', () => {if (options.valueAction) options.valueAction(); else setExpanded(!expanded, true);});
  value.setAttribute('aria-haspopup', 'listbox');
  const panel = document.createElement('div'); panel.className = 'choice-options'; panel.id = `choice-options-${crypto.randomUUID()}`;
  value.setAttribute('aria-controls', panel.id);
  const list = document.createElement('div'); list.className = 'choice-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', options.name);
  arrowNavigation(list, () => buttons); panel.append(list);
  const create = options.create ? actionButton('Ny sangbok', () => {setExpanded(false); options.create!();}, 'ny') : undefined;
  if (create) {create.className = 'choice-create'; panel.append(create);}
  element.append(value, panel);
  const focusedChoice = () => buttons.find(button => button.getAttribute('aria-selected') === 'true') ?? buttons[0];
  function setExpanded(next: boolean, focus = false) {
    expanded = next; panel.hidden = !next; value.setAttribute('aria-expanded', String(next));
    if (focus) (next ? focusedChoice() ?? create ?? value : value).focus({preventScroll: true});
  }
  function draw() {
    const name = choices.find(choice => choice.id === selected)?.name ?? 'Velg sangbok';
    value.querySelector('span')!.textContent = name; value.setAttribute('aria-label', `${options.name}: ${name}`);
    buttons = choices.map(choice => {
      const button = selectableRow(choice.name, choice.id === selected, () => {
        setExpanded(false); options.choose(choice.id);
        if (value.isConnected) value.focus({preventScroll: true});
      });
      button.disabled = disabled; return button;
    });
    list.replaceChildren(...buttons);
    const focused = focusedChoice(); if (focused) focused.tabIndex = 0;
    setExpanded(expanded);
  }
  element.addEventListener('keydown', event => {
    if (options.valueAction || disabled) return;
    if (event.key === 'Escape' && expanded) {event.preventDefault(); event.stopPropagation(); setExpanded(false, true);}
    else if (event.target === value && ['ArrowDown', 'ArrowUp'].includes(event.key)) {event.preventDefault(); setExpanded(true, true);}
  });
  draw();
  return {element, value, setExpanded,
    focus: () => (expanded ? focusedChoice() ?? value : value).focus({preventScroll: true}),
    update: (next: {choices: Choice[]; selected: string | null}) => {choices = next.choices; selected = next.selected; draw();},
    setDisabled: (next: boolean) => {disabled = next; value.disabled = next; buttons.forEach(button => {button.disabled = next;}); if (create) create.disabled = next;},
  };
}

/** D09: standalone immediate filter choice, without creation or confirmation footer. */
export function choicePicker(options: {opener: HTMLButtonElement; name: string; value: string; choices: Choice[]; selected: string | null; choose: (id: string | null) => void}) {
  const box = dialogFrame(options.name, 'choice-picker');
  if (options.opener.id) {box.id = `${options.opener.id}-picker`; options.opener.setAttribute('aria-controls', box.id);}
  const control = choiceControl({...options, expanded: true, valueAction: () => lifecycle.close(), choose: id => {lifecycle.close(); options.choose(id);}});
  control.value.setAttribute('aria-label', `Lukk ${options.name.toLocaleLowerCase('nb')}: ${options.value}`);
  box.append(controlHeading(options.name, 'sangbok'), control.element);
  options.opener.setAttribute('aria-expanded', 'true');
  const lifecycle = openDialog(box, {opener: options.opener, outside: true,
    place: () => placeOverlay(box, options.opener, {align: 'center', width: 572}),
    closed: () => options.opener.setAttribute('aria-expanded', 'false')});
  control.focus();
  return lifecycle;
}

/** The collapsed value uses the same geometry in the picker and in a choice step. */
export function choiceValue(name: string, choose: () => void) {
  const button = actionButton(name || 'Velg sangbok', choose); button.className = 'choice-value';
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 24 24'); chevron.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'm5 9 7 7 7-7'); chevron.append(path); button.append(chevron);
  return button;
}
