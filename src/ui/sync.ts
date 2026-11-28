import {actionButton, controlHeading, dialogFooter, dialogFrame, type DialogAction} from './controls.ts';
import {openDialog} from './dialog.ts';
import type {syncController} from '../sync/controller.ts';
import type {Conflict} from '../sync/state.ts';
import {copyText} from './clipboard.ts';
import {contextMenu, floatingAction, listRow} from './list-controls.ts';
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
  // #101 F08: L01 rows with a separate row menu (H04), as in Setlister.
  let checking = 0;
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
          const {row, more} = listRow({
            title: item.name,
            details: [books.bookName(item.songbookId) ?? '', importStatusText(controller.importStatus(item.id))],
            menu: opener =>
              contextMenu(
                opener,
                [
                  {name: 'Slett import', icon: 'slett', run: () => remove(opener, item, false)},
                  {name: 'Slett import og innhold', icon: 'slett', run: () => remove(opener, item, true)},
                ],
                'below',
              ),
          });
          row.dataset.importId = item.id;
          more.id = `import-menu-${item.id}`;
          return row;
        }),
    );
  }
  /**
   * Reads the saved import list; songbook names come from the latest library read. With `fresh`
   * it shows the saved list at once, then the list in Dropbox if it has changed (#106). The list
   * is aria-busy meanwhile.
   */
  async function refreshImports(fresh = false) {
    const current = ++reading;
    if (fresh) {
      checking++;
      imports.setAttribute('aria-busy', 'true');
    }
    try {
      const next = await controller.imports();
      if (current !== reading) return;
      importItems = next;
      drawImports();
      if (!fresh) return;
      await controller.checkImports();
      if (current !== reading) return;
      const checked = await controller.imports();
      if (current !== reading) return;
      importItems = checked;
      drawImports();
    } catch {
      /* The shown list stays; the next Synkroniser or visit reads it again. */
    } finally {
      if (fresh && --checking === 0) imports.removeAttribute('aria-busy');
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
  /** #101 F17: both choices are confirmed in E03; Avbryt has the initial focus and changes nothing. */
  function remove(opener: HTMLElement, item: SharedImport, content: boolean) {
    const title = content ? 'Slett import og innhold' : 'Slett import';
    const box = dialogFrame(title, 'name-dialog sync-dialog');
    const text = document.createElement('p');
    text.textContent = content
      ? `Vil du slette «${item.name}» med innhold? Importmappen og sangene fjernes fra biblioteket på alle enheter, med personlige tilpasninger.`
      : `Vil du slette «${item.name}»? Sangene blir liggende i sangboken og kan fortsatt ikke redigeres.`;
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    let writing = false;
    const cancel = () => {
      if (!writing) lifecycle.close();
    };
    const footer = dialogFooter([
      {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: cancel},
      {
        id: 'delete',
        label: 'Slett',
        icon: 'slett',
        primary: true,
        run: () => {
          void confirm();
        },
      },
    ]);
    box.append(controlHeading(title), text, error, footer);
    const lifecycle = openDialog(box, {opener, focus: footer.querySelector('button')!, cancel});
    async function confirm() {
      if (writing) return;
      writing = true;
      const buttons = footer.querySelectorAll('button');
      buttons.forEach(button => {
        button.disabled = true;
      });
      try {
        await controller.deleteImport(item.id, content);
        const order = [...imports.querySelectorAll<HTMLElement>('.list-row')].map(row => row.dataset.importId),
          index = order.indexOf(item.id);
        importItems = importItems.filter(current => current.id !== item.id);
        drawImports();
        writing = false;
        lifecycle.close();
        (
          imports.querySelectorAll<HTMLButtonElement>('.row-menu')[Math.min(index, importItems.length - 1)] ?? add
        ).focus({
          preventScroll: true,
        });
      } catch {
        writing = false;
        error.textContent = 'Kunne ikke slette importen. Prøv igjen når Dropbox er tilgjengelig.';
        buttons.forEach(button => {
          button.disabled = false;
        });
      }
    }
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
    copy.hidden = true;
    let source: () => string | null = controller.reportText;
    node.append(text, code, tail, copy);
    async function copyReport() {
      const report = source();
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
      /** With `timing`, the button copies the test address's timing log instead of an error report. */
      render(message: string, enabled: boolean, timing = false) {
        const label = timing ? 'Kopier synklogg' : 'Kopier feillogg';
        source = timing ? controller.timingText : controller.reportText;
        copy.setAttribute('aria-label', label);
        copy.dataset.tooltip = label;
        const parts = enabled && !timing ? /^(.*?)(SYNC-\d{3}\))(.*)$/.exec(message) : null;
        text.data = parts ? parts[1] : message;
        code.textContent = parts?.[2] ?? '';
        tail.data = parts?.[3] ?? '';
        copy.hidden = !enabled && !timing;
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
    messages[1].render(
      account ? message : '',
      Boolean(account) && hasReport,
      Boolean(account) && !hasReport && !controller.running() && Boolean(controller.timingText()),
    );
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
