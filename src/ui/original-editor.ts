import { actionButton, textArea } from './controls.ts';
import { dialogFrame, dialogFooter, openDialog } from './dialog.ts';
import { placeOverlay } from './layout.ts';
import { withOriginal } from '../domain/original.ts';
import type { EditSession } from '../domain/edit-session.ts';
import { textHistory } from './text-edit.ts';
import { mergeRawSource } from '../domain/source-edit.ts';
export function openRawEditor(session: EditSession, save: () => Promise<boolean>, abort: () => void, opener: HTMLElement) {
  const initial = session.song.original,
    box = dialogFrame('Råtekst', 'original-editor raw-editor');
  const heading = document.createElement('h2');
  heading.textContent = 'Råtekst';
  heading.tabIndex = -1;
  const toolbar = document.createElement('div');
  toolbar.className = 'raw-tag-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Sett inn ChordPro-tagg');
  const field = textArea('original-text', initial, 'ChordPro-råtekst');
  field.spellcheck = false;
  field.autocomplete = 'off';
  field.wrap = 'soft';
  const displayInitial = field.value,
    history = textHistory(field),
    error = document.createElement('p');
  error.className = 'field-error';
  error.setAttribute('role', 'alert');
  let at = 0,
    scroll = 0,
    busy = false,
    submitted = false,
    closed = false;
  const remember = () => {
    at = field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd;
    scroll = field.scrollTop;
  };
  for (const event of ['select', 'keyup', 'pointerup', 'input', 'focus', 'scroll', 'text-history-change']) field.addEventListener(event, remember);
  let gesture: {
    x: number;
    y: number;
    scroll: number;
    cancelled: boolean;
  } | undefined;
  toolbar.addEventListener('pointerdown', event => {
    if (document.activeElement === field) remember();
    gesture = {
      x: event.clientX,
      y: event.clientY,
      scroll: toolbar.scrollTop,
      cancelled: false
    };
  });
  toolbar.addEventListener('pointermove', event => {
    if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.cancelled = true;
  });
  toolbar.addEventListener('pointercancel', () => {
    if (gesture) gesture.cancelled = true;
  });
  for (const tag of ['{title: }', '{key: }', '{time: }', '{soc}', '{eoc}', '{chorus}', '{comment: }', '{x_dyn: }', '{sog}', '{eog}']) {
    const button = actionButton(tag, () => {
      if (busy) return;
      if (gesture && (gesture.cancelled || gesture.scroll !== toolbar.scrollTop)) {
        gesture = undefined;
        return;
      }
      gesture = undefined;
      const position = at;
      field.focus({
        preventScroll: true
      });
      history.insert(tag, position, tag.includes(':') ? tag.length - 1 : tag.length);
      field.scrollTop = scroll;
      remember();
      error.textContent = '';
    });
    button.dataset.preserveFieldFocus = '';
    button.setAttribute('aria-label', `Sett inn ${tag}`);
    toolbar.append(button);
  }
  const cancel = () => {
    if (busy) return;
    if (submitted) session.cancelGroup();
    lifecycle.close();
    abort();
  };
  const actions = dialogFooter([{
    id: 'cancel',
    label: 'Avbryt',
    icon: 'avbryt',
    run: cancel
  }, {
    id: 'save',
    label: 'Lagre',
    icon: 'lagre',
    primary: true,
    run: () => {
      void commit();
    }
  }]);
  async function commit() {
    if (busy) return;
    const next = withOriginal(session.song, mergeRawSource(initial, field.value));
    if (!next.title.trim()) {
      error.textContent = 'Skriv en tittel med {title: …}.';
      return;
    }
    busy = true;
    box.setAttribute('aria-busy', 'true');
    actions.querySelectorAll('button').forEach(b => b.disabled = true);
    toolbar.querySelectorAll('button').forEach(b => b.disabled = true);
    field.readOnly = true;
    try {
      if (!submitted) {
        session.beginGroup();
        submitted = true;
      }
      session.replaceOriginal(next);
      if (!(await save())) {
        error.textContent = 'Kunne ikke lagre. Teksten er beholdt; prøv igjen.';
        return;
      }
      session.endGroup();
      submitted = false;
      lifecycle.close();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : 'Kunne ikke lagre. Teksten er beholdt.';
    } finally {
      busy = false;
      box.removeAttribute('aria-busy');
      actions.querySelectorAll('button').forEach(b => b.disabled = false);
      toolbar.querySelectorAll('button').forEach(b => b.disabled = false);
      field.readOnly = false;
    }
  }
  box.append(heading, toolbar, field, error, actions);
  box.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      void commit();
    }
  });
  document.body.classList.add('original-open');
  const lifecycle = openDialog(box, {
    opener,
    focus: heading,
    place: () => placeOverlay(box, undefined, {
      fullscreen: true
    }),
    cancel,
    closed: () => {
      closed = true;
      history.dispose();
      document.body.classList.remove('original-open');
    }
  });
  return {
    dispose: cancel,
    dirty: () => !closed && (field.value !== displayInitial || submitted),
    isOpen: () => !closed
  };
}
