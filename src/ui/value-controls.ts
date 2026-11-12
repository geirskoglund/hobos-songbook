import { actionButton, icon, textInput, textArea } from './controls.ts';
import { dialogFrame, openDialog } from './dialog.ts';
import { placeOverlay } from './layout.ts';
export function valueControl(options: {
  name: string;
  icon: string;
  anchor: HTMLElement;
  value: string;
  submitOnly?: boolean;
  multiline?: boolean;
  numeric?: {
    min: number;
    max: number;
  };
  change: (value: string, submitted: boolean) => void;
  closed: () => void;
}) {
  const box = dialogFrame(options.name, 'value-control'),
    symbol = icon(options.icon),
    error = document.createElement('p');
  error.className = 'field-error';
  error.setAttribute('role', 'alert');
  let invalid = false,
    timer = 0,
    closing = false,
    lastCommitted = options.value;
  let pending = () => false;
  const commit = (value: string, submitted = false) => {
    try {
      options.change(value, submitted);
      if (!options.submitOnly || submitted) lastCommitted = value;
      invalid = false;
      error.textContent = '';
      return true;
    } catch (e) {
      invalid = true;
      error.textContent = e instanceof Error ? e.message : 'Kontroller verdien.';
      return false;
    }
  };
  let focus: HTMLElement,
    finish = () => true;
  if (options.numeric) {
    const {
      min,
      max
    } = options.numeric;
    let value = Number(options.value);
    const row = document.createElement('div');
    row.className = 'numeric-value';
    const number = document.createElement('span');
    number.tabIndex = 0;
    number.setAttribute('role', 'spinbutton');
    number.setAttribute('aria-label', options.name);
    number.setAttribute('aria-valuemin', String(min));
    number.setAttribute('aria-valuemax', String(max));
    const set = (n: number) => {
      if (n < min || n > max) return;
      value = n;
      number.textContent = String(value);
      number.setAttribute('aria-valuenow', String(value));
      less.disabled = value === min;
      more.disabled = value === max;
      commit(String(value));
    };
    const less = actionButton('−', () => set(value - 1)),
      more = actionButton('+', () => set(value + 1));
    less.setAttribute('aria-label', `Reduser ${options.name.toLowerCase()}`);
    more.setAttribute('aria-label', `Øk ${options.name.toLowerCase()}`);
    row.addEventListener('keydown', event => {
      const n = event.key === 'Home' ? min : event.key === 'End' ? max : ['ArrowUp', 'ArrowRight'].includes(event.key) ? value + 1 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? value - 1 : undefined;
      if (n !== undefined) {
        event.preventDefault();
        set(n);
      }
    });
    row.append(less, number, more);
    box.append(symbol, row, error);
    number.textContent = String(value);
    number.setAttribute('aria-valuenow', String(value));
    less.disabled = value === min;
    more.disabled = value === max;
    focus = number;
    commit(String(value));
  } else {
    const input = options.multiline ? textArea('value-input', options.value, options.name, 2) : textInput('value-input', options.value, options.name);
    input.autocomplete = 'off';
    input.spellcheck = false;
    pending = () => input.value !== lastCommitted;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => commit(input.value), 180);
    });
    finish = () => {
      clearTimeout(timer);
      return commit(input.value, true);
    };
    input.addEventListener('keydown', rawEvent => {
      const event = rawEvent as KeyboardEvent;
      if (event.key === 'Enter' && (!options.multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (finish()) lifecycle.close();
      }
    });
    box.append(symbol, input, error);
    focus = input;
  }
  const rect = options.anchor.getBoundingClientRect();
  const close = () => {
    if (closing) return;
    if (finish()) lifecycle.close();
  };
  box.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
    if (event.key === 'Escape' && invalid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      lifecycle.close();
    }
  });
  const lifecycle = openDialog(box, {
    opener: options.anchor,
    focus,
    place: () => placeOverlay(box, undefined, {
      width: options.numeric ? 230 : 320,
      point: {
        x: rect.left,
        y: rect.bottom + 8
      }
    }),
    outside: true,
    cancel: close,
    closed: () => {
      closing = true;
      clearTimeout(timer);
      options.closed();
    }
  });
  return {
    close,
    discard: () => lifecycle.close(),
    dirty: () => invalid || pending()
  };
}
