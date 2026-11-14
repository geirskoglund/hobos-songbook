import {dialogFooter, dialogFrame, textInput} from './controls.ts';
import {openDialog} from './dialog.ts';

/** D02 + E03, shared by every named-list entry point. */
export function nameDialog(options: {
  title: string; id: string; initial?: string; opener: HTMLElement;
  validate: (value: string) => string;
  save: (name: string) => Promise<void>;
  saved?: () => void;
}) {
  const initial = options.initial ?? '', box = dialogFrame(options.title, 'name-dialog');
  const heading = document.createElement('h2'); heading.textContent = options.title;
  const form = document.createElement('form'); form.noValidate = true;
  const label = document.createElement('label'); label.htmlFor = options.id; label.textContent = 'Navn';
  const field = textInput(options.id, initial); field.setAttribute('aria-describedby', `${options.id}-error`);
  const error = document.createElement('p'); error.id = `${options.id}-error`; error.setAttribute('role', 'alert'); error.className = 'hint';
  let writing: Promise<void> | undefined;
  const valid = (show = false) => {
    try {options.validate(field.value); if (show) {error.textContent = ''; field.setAttribute('aria-invalid', 'false');} return true;}
    catch (cause) {if (show) {error.textContent = (cause as Error).message; field.setAttribute('aria-invalid', 'true');} return false;}
  };
  const cancel = () => {if (!writing) lifecycle.close();};
  const actions = dialogFooter([
    {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: cancel},
    {id: 'save', label: 'Lagre', icon: 'lagre', primary: true, disabled: !valid(), run: () => {void save();}},
  ]);
  const saveButton = actions.querySelector<HTMLButtonElement>('[data-action=save]')!;
  field.addEventListener('input', () => {saveButton.disabled = !valid(true);});
  form.addEventListener('submit', event => {event.preventDefault(); void save();});
  form.append(label, field, error); box.append(heading, form, actions);
  const lifecycle = openDialog(box, {opener: options.opener, focus: field, cancel});
  async function save() {
    if (writing || !valid(true)) return;
    field.readOnly = true; actions.querySelectorAll('button').forEach(button => {button.disabled = true;}); error.textContent = '';
    writing = (async () => {
      try {await options.save(options.validate(field.value)); lifecycle.close(); options.saved?.();}
      catch (cause) {
        error.textContent = cause instanceof Error ? cause.message : 'Kunne ikke lagre. Prøv igjen.';
        field.readOnly = false; field.setAttribute('aria-invalid', 'true'); field.focus({preventScroll: true});
        actions.querySelectorAll('button').forEach(button => {button.disabled = false;}); saveButton.disabled = !valid();
      }
    })();
    try {await writing;} finally {writing = undefined;}
  }
  return {
    dirty: () => box.isConnected && (Boolean(writing) || field.value !== initial),
    beforeUpdate: async (message: string) => {if (writing) await writing; if (box.isConnected && field.value !== initial) throw new Error(message);},
  };
}
