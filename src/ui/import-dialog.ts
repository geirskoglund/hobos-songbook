import {dialogFooter, dialogFrame, icon, textInput} from './controls.ts';
import {openDialog} from './dialog.ts';
import type {startSongbooks} from './songbooks.ts';
import {
  importFolder,
  importName,
  importTestText,
  notDropboxAddress,
  type ImportTest,
  type SharedImport,
} from '../domain/shared-import.ts';

/**
 * #101 F03: register an import. D02 Navn and Mappe, D10 Sangbok and E03 Avbryt / Test tilkobling.
 * A successful test turns Test tilkobling into Lagre for exactly the tested address.
 */
export function importDialog(options: {
  opener: HTMLElement;
  books: ReturnType<typeof startSongbooks>;
  imports: () => SharedImport[];
  test: (folder: string) => Promise<ImportTest | 'consent'>;
  save: (entry: SharedImport, check: (current: SharedImport[]) => void) => Promise<void>;
  saved: () => void;
}) {
  const id = crypto.randomUUID(),
    title = 'Ny import',
    box = dialogFrame(title, 'name-dialog import-dialog');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const form = document.createElement('form');
  form.noValidate = true;
  const field = (fieldId: string, labelText: string, help?: string) => {
    const label = document.createElement('label');
    label.htmlFor = fieldId;
    label.textContent = labelText;
    const input = textInput(fieldId);
    // The help text is shown inside the empty field.
    if (help) input.placeholder = help;
    const error = document.createElement('p');
    error.id = `${fieldId}-error`;
    error.className = 'hint error-text';
    error.setAttribute('role', 'alert');
    const nodes: HTMLElement[] = [label, input, error];
    input.setAttribute('aria-describedby', error.id);
    const show = (message: string) => {
      error.textContent = message;
      input.setAttribute('aria-invalid', String(Boolean(message)));
    };
    return {input, nodes, show};
  };
  const name = field('import-name', 'Navn'),
    folder = field('import-folder', 'Mappe', 'Nettadresse til delt mappe');
  folder.input.inputMode = 'url';
  folder.input.spellcheck = false;
  const book = options.books.targetControl(null, update);
  book.value.id = 'import-book';
  const bookLabel = document.createElement('label');
  bookLabel.htmlFor = book.value.id;
  bookLabel.textContent = 'Sangbok';
  const result = document.createElement('p');
  result.id = 'import-test-result';
  result.className = 'hint';
  result.setAttribute('role', 'status');
  form.append(...name.nodes, ...folder.nodes, bookLabel, book.element, result);
  let tested: string | null = null,
    working = false;
  const cancel = () => {
    if (!working) lifecycle.close();
  };
  const actions = dialogFooter([
    {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: cancel},
    {
      id: 'primary',
      label: 'Test tilkobling',
      icon: 'ok',
      primary: true,
      run: () => {
        void primary();
      },
    },
  ]);
  const button = actions.querySelector<HTMLButtonElement>('[data-action=primary]')!;
  const isTested = () => tested !== null && tested === folder.input.value.trim();
  function update() {
    const saving = isTested();
    if (button.dataset.mode !== (saving ? 'save' : 'test')) {
      button.dataset.mode = saving ? 'save' : 'test';
      const label = document.createElement('span');
      label.textContent = saving ? 'Lagre' : 'Test tilkobling';
      button.replaceChildren(icon(saving ? 'lagre' : 'ok'), label);
    }
    button.disabled = working || (saving ? !book.selected() : navigator.onLine === false);
  }
  const fields = [
    [name, importName],
    [folder, importFolder],
  ] as const;
  /** Shows each given field's error; only a field that breaks a rule gets one (#105). */
  const check = (parts: readonly (typeof fields)[number][] = fields, current = options.imports()) => {
    let valid = true;
    for (const [part, rule] of parts)
      try {
        rule(part.input.value, current);
        part.show('');
      } catch (cause) {
        valid = false;
        part.show((cause as Error).message);
      }
    return valid;
  };
  name.input.addEventListener('input', () => {
    check([fields[0]]);
  });
  folder.input.addEventListener('input', () => {
    if (!isTested()) result.textContent = '';
    folder.show('');
    update();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void primary();
  });
  const connection = () => update();
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  box.append(heading, form, actions);
  update();
  const lifecycle = openDialog(box, {
    opener: options.opener,
    focus: name.input,
    cancel,
    closed: () => {
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    },
  });
  async function primary() {
    if (working || button.disabled) return;
    if (isTested()) await save();
    else await test();
  }
  function busy(next: boolean) {
    working = next;
    name.input.readOnly = folder.input.readOnly = next;
    book.setDisabled(next);
    actions.querySelectorAll('button').forEach(action => {
      action.disabled = next;
    });
    if (!next) update();
  }
  async function test() {
    let address: string;
    try {
      address = importFolder(folder.input.value, options.imports());
    } catch (cause) {
      folder.show((cause as Error).message);
      result.textContent = '';
      // A non-Dropbox address is rejected without a test (#101 F04).
      if ((cause as Error).message === notDropboxAddress) folder.input.focus({preventScroll: true});
      return;
    }
    folder.show('');
    busy(true);
    result.textContent = 'Tester tilkoblingen…';
    result.classList.remove('error-text');
    try {
      const answer = await options.test(address);
      if (answer === 'consent') {
        lifecycle.close();
        return;
      }
      result.textContent = importTestText[answer];
      result.classList.toggle('error-text', answer !== 'ok');
      tested = answer === 'ok' && folder.input.value.trim() === address ? address : null;
    } finally {
      busy(false);
    }
  }
  async function save() {
    if (!check() || !book.selected()) return;
    busy(true);
    try {
      const entry: SharedImport = {
        id,
        name: importName(name.input.value, options.imports()),
        folder: importFolder(folder.input.value, options.imports()),
        songbookId: book.selected()!,
      };
      await options.save(entry, current => {
        importName(entry.name, current, entry.id);
        importFolder(entry.folder, current, entry.id);
      });
      lifecycle.close();
      options.saved();
    } catch (cause) {
      result.textContent = cause instanceof Error ? cause.message : 'Kunne ikke lagre importen. Prøv igjen.';
      result.classList.add('error-text');
      check();
    } finally {
      if (box.isConnected) busy(false);
    }
  }
}
