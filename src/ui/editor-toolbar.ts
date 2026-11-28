import {actionButton, tabSwitcher} from './controls.ts';

type Entry = [name: string, label: string, icon: string];
const common: Entry[] = [
  ['undo', 'Angre', 'angre'],
  ['redo', 'Gjør om', 'gjenta'],
  ['remove', 'Fjern', 'viskelaer'],
];
const fileTools: Entry[] = [
  ['title', 'Tittel', 'felles'],
  ['key', 'Toneart', 'key'],
  ['time', 'Takt', 'time'],
  ['shared-grid', 'Akkordskjema', 'akkordskjema'],
  ['chord', 'Akkorder', 'akkord'],
  ['chorus', 'Refreng', 'refreng'],
  ['reference', 'Gjenta refreng', 'gjenta-refreng'],
  ['comment', 'Anvisninger', 'info'],
  ['dynamic', 'Dynamikk', 'dynamikk'],
  ['raw', 'Råtekst', 'ratekst'],
];
const personalTools: Entry[] = [
  ['capo', 'Capo', 'capo'],
  ['tuning', 'Stemming', 'stemming'],
  ['grid', 'Akkordskjema', 'akkordskjema'],
  ['note', 'Notater', 'notat'],
  ['highlight', 'Gulmarkering', 'gulmarkering'],
];
/** Verktøy som er på til brukeren slår dem av, i motsetning til knapper som handler med en gang. */
const toggles = ['chord', 'chorus', 'reference', 'comment', 'dynamic', 'note', 'highlight'];

export interface ToolbarState {
  canUndo: boolean;
  canRedo: boolean;
  selected: boolean;
  tool: string | undefined;
}

/**
 * Redigeringsverktøylinjen med fanene Filinnhold og Egentilpasning. Fanevalget eies her.
 * Uten `file` (importert sang) vises bare Egentilpasning.
 */
export function createEditorToolbar(run: (name: string, button: HTMLElement) => void, {file = true} = {}) {
  let tab = file ? 'file' : 'personal';
  const toolbar = document.createElement('div');
  toolbar.className = 'edit-toolbar';
  const tabs = tabSwitcher(
    'Redigeringsområde',
    'edit',
    [
      {id: 'file', label: 'Filinnhold'},
      {id: 'personal', label: 'Egentilpasning'},
    ],
    tab,
    id => {
      tab = id;
      reflectTab();
    },
  );
  const panels = document.createElement('div');
  panels.className = 'editor-tool-panels';
  const filePanel = document.createElement('div'),
    personalPanel = document.createElement('div');
  filePanel.className = personalPanel.className = 'editor-tool-panel';
  filePanel.dataset.tab = 'file';
  personalPanel.dataset.tab = 'personal';
  filePanel.id = 'edit-panel-file';
  personalPanel.id = 'edit-panel-personal';
  filePanel.setAttribute('role', 'toolbar');
  personalPanel.setAttribute('role', 'toolbar');
  filePanel.setAttribute('aria-label', 'Filinnhold');
  personalPanel.setAttribute('aria-label', 'Egentilpasning');
  panels.append(...(file ? [filePanel] : []), personalPanel);
  toolbar.append(...(file ? [tabs.element] : []), panels);
  const buttons = new Map<string, HTMLButtonElement[]>();
  for (const [panel, entries] of [
    [filePanel, fileTools],
    [personalPanel, personalTools],
  ] as const) {
    for (const [i, [name, label, iconName]] of [...common, ...entries].entries()) {
      if (i === common.length) {
        const divider = document.createElement('span');
        divider.className = 'tool-divider';
        divider.setAttribute('aria-hidden', 'true');
        panel.append(divider);
      }
      const b = actionButton(label, () => run(name, b), iconName);
      b.dataset.editorTool = name;
      b.setAttribute('aria-label', label);
      panel.append(b);
      buttons.set(name, [...(buttons.get(name) ?? []), b]);
    }
  }
  panels.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const items = [
        ...(tab === 'file' ? filePanel : personalPanel).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      ],
      index = items.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    items[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    ]?.focus();
  });
  function reflectTab() {
    toolbar.dataset.tab = tab;
    filePanel.setAttribute('aria-hidden', String(tab !== 'file'));
    personalPanel.setAttribute('aria-hidden', String(tab !== 'personal'));
  }
  reflectTab();
  return {
    element: toolbar,
    paint(state: ToolbarState) {
      for (const [name, items] of buttons)
        for (const b of items) {
          if (name === 'undo') b.disabled = !state.canUndo;
          else if (name === 'redo') b.disabled = !state.canRedo;
          else if (name === 'remove') b.disabled = !state.selected;
          else if (toggles.includes(name)) b.setAttribute('aria-pressed', String(state.tool === name));
        }
    },
    showError(text: string) {
      let p = toolbar.querySelector<HTMLElement>('.editor-error');
      if (!p) {
        p = document.createElement('p');
        p.className = 'editor-error';
        p.setAttribute('role', 'alert');
        toolbar.append(p);
      }
      p.textContent = text;
    },
    clearError() {
      toolbar.querySelector('.editor-error')?.remove();
    },
  };
}
