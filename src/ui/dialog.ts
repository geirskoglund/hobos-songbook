export interface DialogOptions {
  opener?: HTMLElement;
  focus?: HTMLElement;
  place?: () => void;
  outside?: boolean;
  cancel?: () => void;
  closed?: () => void;
}
/** Each dialog owns its focus, activation and lifecycle; no document-wide button interception. */
export function openDialog(box: HTMLDialogElement, options: DialogOptions = {}) {
  let closed = false, down: {x: number; y: number; scroll: number} | undefined;
  const place = () => {if (!closed) options.place?.();};
  const observer = new ResizeObserver(place);
  function close() {
    if (closed) return;closed = true;observer.disconnect();
    window.removeEventListener('resize', place);window.removeEventListener('scroll', place);
    visualViewport?.removeEventListener('resize', place);visualViewport?.removeEventListener('scroll', place);
    box.close();box.remove();options.closed?.();
    if (options.opener?.isConnected) options.opener.focus({preventScroll: true});
  }
  const cancel = () => {if (options.cancel) options.cancel();else close();};
  box.addEventListener('cancel', event => {event.preventDefault();event.stopPropagation();cancel();});
  box.addEventListener('pointerdown', event => {
    const action = (event.target as Element).closest('.popup-actions button');
    // Keep the active field and keyboard until a completed click has read the draft.
    if (action) event.preventDefault();
    down = {x: event.clientX, y: event.clientY, scroll: scrollY};
  }, true);
  box.addEventListener('touchstart', event => {
    if ((event.target as Element).closest('.popup-actions button:disabled')) event.preventDefault();
  }, {capture: true, passive: false});
  box.addEventListener('pointercancel', () => {down = undefined;});
  box.addEventListener('click', event => {
    const started = down;down = undefined;
    if (!options.outside || event.target !== box || !started || Math.hypot(event.clientX - started.x, event.clientY - started.y) >= 8 || Math.abs(scrollY - started.scroll) >= 2) return;
    const rect = box.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) cancel();
  });
  document.body.append(box);box.showModal();place();observer.observe(box);
  window.addEventListener('resize', place);window.addEventListener('scroll', place, {passive: true});
  visualViewport?.addEventListener('resize', place);visualViewport?.addEventListener('scroll', place);
  options.focus?.focus({preventScroll: true});
  return {close, cancel};
}

export function confirmImportCopy(filename: string, opener: HTMLElement): Promise<boolean> {
  return new Promise(resolve => {
    const box = document.createElement('dialog');box.className = 'edit-popup import-copy';box.setAttribute('aria-label', 'Importer kopi');
    const text = document.createElement('p');text.textContent = `Fil ${filename} er allerede importert. Vil du importere en kopi?`;
    const actions = document.createElement('div');actions.className = 'popup-actions';
    const abort = document.createElement('button'), confirm = document.createElement('button');
    abort.type = confirm.type = 'button';abort.textContent = 'Avbryt';confirm.textContent = 'Importer';
    const finish = (accepted: boolean) => {dialog.close();resolve(accepted);};
    abort.addEventListener('click', () => finish(false));confirm.addEventListener('click', () => finish(true));
    actions.append(abort, confirm);box.append(text, actions);
    const dialog = openDialog(box, {opener, focus: abort, outside: true, cancel: () => finish(false)});
  });
}
