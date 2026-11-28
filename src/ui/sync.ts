import {actionButton, controlHeading, dialogFooter, dialogFrame, type DialogAction} from './controls.ts';
import {openDialog} from './dialog.ts';
import type {syncController} from '../sync/controller.ts';
import type {Conflict} from '../sync/state.ts';
import {copyText} from './clipboard.ts';
import {floatingAction, listRow} from './list-controls.ts';
import {importDialog} from './import-dialog.ts';
import type {startSongbooks} from './songbooks.ts';
import {importStatusText, type SharedImport} from '../domain/shared-import.ts';
export function syncPage(controller: ReturnType<typeof syncController>, books: ReturnType<typeof startSongbooks>) {
  const root = document.getElementById('sync')!;
  const disconnected = document.createElement('div');
  disconnected.className = 'sync-connect';
  const connect = actionButton('Koble til Dropbox', () => {
    void controller.connect();
  });
  connect.id = 'dropbox-connect';
  // The separately supplied Dropbox brand asset keeps its approved colors.
  const logo = document.createElement('img');
  logo.src = new URL('../../assets/dropbox-glyph-blue.svg', import.meta.url).href;
  logo.alt = '';
  logo.width = logo.height = 24;
  connect.prepend(logo);
  const connectionStatus = document.createElement('p');
  connectionStatus.className = 'hint';
  connectionStatus.setAttribute('role', 'status');
  disconnected.append(connect, connectionStatus);
  const connected = document.createElement('div');
  connected.className = 'sync-connected';
  const panel = document.createElement('section');
  panel.className = 'display-settings';
  const sync = actionButton(
    'Synkroniser',
    () => {
      void controller.manual();
    },
    'synkroniser',
  );
  sync.id = 'dropbox-sync';
  const status = document.createElement('p');
  status.className = 'hint';
  status.id = 'sync-status';
  status.setAttribute('role', 'status');
  panel.append(sync, status);
  const accountPanel = document.createElement('section');
  accountPanel.className = 'app-info';
  const identity = document.createElement('p');
  identity.id = 'dropbox-account';
  const disconnect = actionButton('Koble fra', confirmDisconnect);
  disconnect.id = 'dropbox-disconnect';
  disconnect.className = 'secondary';
  accountPanel.append(identity, disconnect);
  // L01 rows without an action; the row menu (H04) arrives with deleting an import.
  const imports = document.createElement('ul');
  imports.id = 'import-list';
  imports.className = 'song-list import-list';
  imports.setAttribute('aria-label', 'Importer');
  const add = floatingAction('Ny import', () => {
    void register();
  });
  add.id = 'add-import';
  connected.append(panel, imports, accountPanel, add);
  let importItems: SharedImport[] = [],
    reading = 0,
    wasRunning = false;
  function drawImports() {
    imports.replaceChildren(
      ...[...importItems]
        .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
        .map(item => {
          const {row} = listRow({
            title: item.name,
            details: [books.bookName(item.songbookId) ?? '', importStatusText(controller.importStatus(item.id))],
          });
          row.dataset.importId = item.id;
          return row;
        }),
    );
  }
  /** Reads the saved import list; songbook names come from the latest library read. */
  async function refreshImports() {
    const current = ++reading;
    try {
      const next = await controller.imports();
      if (current !== reading) return;
      importItems = next;
      drawImports();
    } catch {
      /* The shown list stays; the next Synkroniser or visit reads it again. */
    }
  }
  async function register() {
    await Promise.all([books.refresh(false), refreshImports()]);
    importDialog({
      opener: add,
      books,
      imports: () => importItems,
      test: folder => controller.testImport(folder),
      save: (entry, check) => controller.saveImport(entry, check),
      saved: () => {
        void refreshImports().then(() => add.focus({preventScroll: true}));
      },
    });
  }
  root.append(disconnected, connected);
  const messages = [connectionStatus, status].map(node => {
    const text = document.createTextNode(''),
      code = document.createElement('span'),
      tail = document.createTextNode('');
    code.className = 'sync-error-code';
    const copy = actionButton(
      '',
      () => {
        void copyReport();
      },
      'kopier',
    );
    copy.className = 'sync-error-copy';
    copy.setAttribute('aria-label', 'Kopier feillogg');
    copy.dataset.tooltip = 'Kopier feillogg';
    copy.hidden = true;
    node.append(text, code, tail, copy);
    async function copyReport() {
      const report = controller.reportText();
      if (!report) return;
      copy.disabled = true;
      try {
        await copyText(report, node);
      } catch {
        /* Copying has no additional status message. */
      } finally {
        copy.disabled = false;
      }
    }
    return {
      render(message: string, enabled: boolean) {
        const parts = enabled ? /^(.*?)(SYNC-\d{3}\))(.*)$/.exec(message) : null;
        text.data = parts ? parts[1] : message;
        code.textContent = parts?.[2] ?? '';
        tail.data = parts?.[3] ?? '';
        copy.hidden = !enabled;
        node.hidden = !message;
      },
    };
  });
  function render() {
    const account = controller.account();
    disconnected.hidden = Boolean(account);
    connected.hidden = !account;
    identity.textContent = account ? `${account.name} · ${account.email}` : '';
    sync.toggleAttribute('data-syncing', controller.running());
    // A finished Synkroniser may have read imports registered on another device.
    if (wasRunning && !controller.running()) void refreshImports();
    wasRunning = controller.running();
    sync.disabled = controller.syncing() || navigator.onLine === false;
    const message = controller.status(),
      hasReport = Boolean(controller.reportText());
    messages[0].render(account ? '' : message, !account && hasReport);
    messages[1].render(account ? message : '', Boolean(account) && hasReport);
  }
  function confirmDisconnect() {
    const box = dialogFrame('Koble fra Dropbox', 'name-dialog sync-dialog');
    const text = document.createElement('p');
    text.textContent = 'Lokale sanger og tilpasninger beholdes. Synkronisering stopper.';
    const footer = dialogFooter([
      {id: 'cancel', label: 'Avbryt', icon: 'kryss', run: () => lifecycle.close()},
      {
        id: 'disconnect',
        label: 'Koble fra',
        primary: true,
        run: () => {
          lifecycle.close();
          void controller.disconnect().then(() => {
            if (connect.offsetParent) connect.focus({preventScroll: true});
          });
        },
      },
    ]);
    box.append(controlHeading('Koble fra Dropbox'), text, footer);
    const lifecycle = openDialog(box, {opener: disconnect, focus: footer.querySelector('button')!, outside: true});
  }
  controller.conflictHandler(
    (conflict: Conflict) =>
      new Promise(resolve => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : sync;
        const box = dialogFrame('Synkroniseringskonflikt', 'name-dialog sync-dialog');
        const heading = controlHeading('Synkroniseringskonflikt', 'synkroniser');
        heading.tabIndex = -1;
        const text = document.createElement('p');
        text.textContent =
          conflict.kind === 'content'
            ? `Sangen "${conflict.title}" er endret både i Dropbox og her lokalt. Hvilken versjon skal gjelde?`
            : `Personlige tilpasninger av "${conflict.title}" er endret både i Dropbox og her lokalt. Hvilken versjon skal gjelde?`;
        const finish = (choice: 'local' | 'dropbox' | 'copy' | null) => {
          lifecycle.close();
          resolve(choice);
        };
        const actions: DialogAction[] = [
          {id: 'local', label: 'Lokal versjon', run: () => finish('local')},
          {id: 'dropbox', label: 'Dropbox', primary: conflict.kind === 'personal', run: () => finish('dropbox')},
        ];
        if (conflict.kind === 'content')
          actions.push({id: 'copy', label: 'Opprett ny fil', primary: true, run: () => finish('copy')});
        box.append(heading, text, dialogFooter(actions));
        const lifecycle = openDialog(box, {opener, focus: heading, outside: true, cancel: () => finish(null)});
      }),
  );
  render();
  void refreshImports();
  return {render, refreshImports, drawImports};
}
