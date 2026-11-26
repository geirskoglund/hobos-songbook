import {dialogFrame, dialogFooter, openDialog} from './dialog.ts';
import {element} from './dom.ts';

/** Spør hva som skal skje med ulagrede endringer når brukeren går ut av en sang. */
export function confirmLeave(): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise(resolve => {
    const prompt = dialogFrame('Ulagrede endringer', 'leave-editor');
    prompt.append(element('h2', 'Ulagrede endringer'), element('p', 'Vil du lagre før du går ut?'));
    const finish = (value: 'save' | 'discard' | 'cancel') => {
      lifecycle.close();
      resolve(value);
    };
    const actions = dialogFooter([
      {id: 'cancel', label: 'Fortsett redigering', icon: 'kryss', run: () => finish('cancel')},
      {id: 'discard', label: 'Forkast endringer', run: () => finish('discard')},
      {id: 'save', label: 'Lagre og gå ut', icon: 'lagre', primary: true, run: () => finish('save')},
    ]);
    prompt.append(actions);
    const lifecycle = openDialog(prompt, {
      opener: document.activeElement as HTMLElement,
      focus: actions.querySelector('[data-action=cancel]') as HTMLElement,
      cancel: () => finish('cancel'),
    });
  });
}
