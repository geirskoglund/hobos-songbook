import {actionButton, controlHeading, dialogFooter, dialogFrame, type DialogAction} from './controls.ts';
import {openDialog} from './dialog.ts';
import type {syncController} from '../sync/controller.ts';
import type {Conflict} from '../sync/model.ts';
export function syncPage(controller: ReturnType<typeof syncController>) {
  const root = document.getElementById('sync')!;
  const disconnected = document.createElement('div'); disconnected.className = 'sync-connect';
  const connect = actionButton('Koble til Dropbox', () => {void controller.connect().catch(showError);}); connect.id = 'dropbox-connect';
  // The separately supplied Dropbox brand asset keeps its approved colors.
  const logo = document.createElement('img'); logo.src = new URL('../../assets/dropbox-glyph-blue.svg', import.meta.url).href; logo.alt = ''; logo.width = logo.height = 24; connect.prepend(logo);
  const connectionStatus = document.createElement('p'); connectionStatus.className = 'hint'; connectionStatus.setAttribute('role', 'status');
  disconnected.append(connect, connectionStatus);
  const connected = document.createElement('div');
  const panel = document.createElement('section'); panel.className = 'display-settings';
  const sync = actionButton('Synkroniser', () => {void controller.manual();}, 'synkroniser'); sync.id = 'dropbox-sync';
  const status = document.createElement('p'); status.className = 'hint'; status.id = 'sync-status'; status.setAttribute('role', 'status'); panel.append(sync, status);
  const accountPanel = document.createElement('section'); accountPanel.className = 'app-info';
  const identity = document.createElement('p'); identity.id = 'dropbox-account';
  const disconnect = actionButton('Koble fra', confirmDisconnect); disconnect.id = 'dropbox-disconnect'; disconnect.className = 'secondary'; accountPanel.append(identity, disconnect);
  connected.append(panel, accountPanel); root.append(disconnected, connected);
  function showError(cause: unknown) {connectionStatus.textContent = cause instanceof Error ? cause.message : 'Dropbox-tilkoblingen feilet.';}
  function render() {
    const account = controller.account(); disconnected.hidden = Boolean(account); connected.hidden = !account;
    identity.textContent = account ? `${account.name} · ${account.email}` : '';
    sync.disabled = controller.running(); status.textContent = controller.status();
    if (!account) connectionStatus.textContent = controller.status();
  }
  function confirmDisconnect() {
    const box = dialogFrame('Koble fra Dropbox', 'name-dialog sync-dialog');
    const text = document.createElement('p'); text.textContent = 'Lokale sanger og tilpasninger beholdes. Synkronisering stopper.';
    const footer = dialogFooter([{id: 'cancel', label: 'Avbryt', icon: 'kryss', run: () => lifecycle.close()}, {id: 'disconnect', label: 'Koble fra', primary: true, run: () => {lifecycle.close(); void controller.disconnect().then(() => {if (connect.offsetParent) connect.focus({preventScroll:true});});}}]);
    box.append(controlHeading('Koble fra Dropbox'), text, footer);
    const lifecycle = openDialog(box, {opener: disconnect, focus: footer.querySelector('button')!, outside: true});
  }
  controller.conflictHandler((conflict: Conflict) => new Promise(resolve => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : sync;
    const box = dialogFrame('Synkroniseringskonflikt', 'name-dialog sync-dialog');
    const heading = controlHeading('Synkroniseringskonflikt', 'synkroniser'); heading.tabIndex = -1;
    const text = document.createElement('p'); text.textContent = conflict.kind === 'content' ? `Sangen "${conflict.title}" er endret både i Dropbox og her lokalt. Hvilken versjon skal gjelde?` : `Personlige tilpasninger av "${conflict.title}" er endret både i Dropbox og her lokalt. Hvilken versjon skal gjelde?`;
    const finish = (choice: 'local' | 'dropbox' | 'copy' | null) => {lifecycle.close(); resolve(choice);};
    const actions: DialogAction[] = [{id: 'local', label: 'Lokal versjon', run: () => finish('local')}, {id: 'dropbox', label: 'Dropbox', primary: conflict.kind === 'personal', run: () => finish('dropbox')}];
    if (conflict.kind === 'content') actions.push({id: 'copy', label: 'Opprett ny fil', primary: true, run: () => finish('copy')});
    box.append(heading, text, dialogFooter(actions));
    const lifecycle = openDialog(box, {opener, focus: heading, outside: true, cancel: () => finish(null)});
  }));
  render(); return {render};
}
