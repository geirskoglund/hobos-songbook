import { actionButton, icon, textArea } from './controls.ts';
import { dialogFrame, dialogFooter, openDialog } from './dialog.ts';
import { valueControl } from './value-controls.ts';
import { overlayWidth, placeOverlay, currentPage } from './layout.ts';
import { createHighlightEditor, lyricText, lyricOffsetAt, lyricPositionAt, edgeScroll } from './highlight-editor.ts';
import { attachNoteDrag } from './note-drag.ts';
import { nearestNoteTarget } from './note-position.ts';
import { attachHeldElements, type ElementDrag } from './held-elements.ts';
import { attachDynamicMarkers } from './dynamic-markers.ts';
import { paintAnnotations } from './annotations.ts';
import { changeNote, noteAt, logicalLines, changeAnnotation, type Highlight } from '../domain/annotations.ts';
import { shiftChord, shiftGridText, sharedGridText, validGrid } from '../domain/personal.ts';
import { sourceLines, sourceChords, sourceBlocks, setChord, moveChord, setMetadata, setDirective, insertDirective, patchSong, setChorus, removeSourceBlock, transposeSong, lineEnding, mergeRawSource, type SourceBlock } from '../domain/source-edit.ts';
import type { Song, SongPersonal } from '../domain/song.ts';
import type { EditSession } from '../domain/edit-session.ts';
import {canEditSource} from '../domain/sync.ts';
export function createSongEditor(session: EditSession, change: (source?: boolean) => void, raw: () => void) {
  const writable = canEditSource(session.song);
  type ElementChoice = {
    kind: 'note';
    id: string;
  } | {
    kind: 'chord';
    start: number;
  } | {
    kind: 'comment' | 'dynamic' | 'chorus' | 'reference';
    line: number;
  } | {
    kind: 'highlight';
    occurrence: string;
    range: Highlight;
  };
  let selected: ElementChoice | undefined;
  let body: HTMLElement | undefined,
    unmount = () => {},
    highlighter: ReturnType<typeof createHighlightEditor> | undefined;
  let restored: {
    occurrence: string;
    range: Highlight;
  } | undefined;
  let tool: string | undefined,
    tab = writable ? 'file' : 'personal',
    popup: {
      close: () => void;
      dirty: () => boolean;
      discard?: () => void;
    } | undefined;
  const toolbar = document.createElement('div');
  toolbar.className = 'edit-toolbar';
  const tabs = document.createElement('div');
  tabs.className = 'editor-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Redigeringsområde');
  const panels = document.createElement('div');
  panels.className = 'editor-tool-panels';
  const filePanel = document.createElement('div'),
    personalPanel = document.createElement('div');
  filePanel.className = personalPanel.className = 'editor-tool-panel';
  filePanel.dataset.tab = 'file';
  personalPanel.dataset.tab = 'personal';
  filePanel.setAttribute('role', 'toolbar');
  personalPanel.setAttribute('role', 'toolbar');
  filePanel.setAttribute('aria-label', 'Filinnhold');
  personalPanel.setAttribute('aria-label', 'Egentilpasning');
  panels.append(filePanel, personalPanel);
  toolbar.append(tabs, panels);
  const buttons = new Map<string, HTMLButtonElement[]>();
  function paintTools() {
    for (const [name, items] of buttons) for (const b of items) {
      if (name === 'undo') b.disabled = !session.canUndo();else if (name === 'redo') b.disabled = !session.canRedo();else if (name === 'remove') b.disabled = !selected;else if (['chord', 'chorus', 'reference', 'comment', 'dynamic', 'note', 'highlight'].includes(name)) b.setAttribute('aria-pressed', String(tool === name));
    }
    body?.setAttribute('data-tool', tool ?? '');
    highlighter?.setActive(tool === 'highlight');
    reflectSelection();
  }
  const setTool = (value?: string) => {
    toolbar.querySelector('.editor-error')?.remove();
    tool = value;
    selected = undefined;
    highlighter?.clear();
    paintTools();
  };
  const update = (fn: (state: SongPersonal) => SongPersonal) => {
    session.update(fn);
    if (body) paintAnnotations(body, session.song, session.personal);
    paintTools();
    change();
  };
  const original = (next: Song, fn?: (state: SongPersonal) => SongPersonal) => {
    if (!writable) return;
    toolbar.querySelector('.editor-error')?.remove();
    session.replaceOriginal(next, fn);
    paintTools();
    change(true);
  };
  function closePopup() {
    popup?.close();
  }
  function value(name: string, iconName: string, anchor: HTMLElement, start: string, apply: (value: string, submitted: boolean) => void, numeric?: {
    min: number;
    max: number;
  }, point?: {
    x: number;
    y: number;
  }) {
    closePopup();
    setTool();
    session.beginGroup();
    popup = valueControl({
      name,
      icon: iconName,
      anchor,
      point,
      value: start,
      submitOnly: ['Toneart', 'Akkord', 'Anvisning'].includes(name),
      numeric,
      change: apply,
      closed: () => {
        popup = undefined;
        session.endGroup();
        paintTools();
      }
    });
  }
  function metadata(name: 'title' | 'key' | 'time', anchor: HTMLElement) {
    const start = name === 'title' ? session.song.title : name === 'key' ? session.song.key ?? '' : sourceLines(session.song.original).find(l => l.directive?.name === 'time')?.directive?.value ?? '';
    value({
      title: 'Tittel',
      key: 'Toneart',
      time: 'Takt'
    }[name], {
      title: 'felles',
      key: 'key',
      time: 'time'
    }[name], anchor, start, (text, submitted) => {
      if (text === (name === 'title' ? session.song.title : name === 'key' ? session.song.key ?? '' : sourceLines(session.song.original).find(l => l.directive?.name === 'time')?.directive?.value ?? '')) return;
      if (name === 'key') {
        if (!submitted) return;
        const next = transposeSong(session.song, text.trim());
        original(next.song, state => ({
          ...state,
          chordGrid: state.chordGrid ? shiftGridText(state.chordGrid, next.interval) : undefined
        }));
      } else original(setMetadata(session.song, name, text));
    });
  }
  function openGrid(anchor: HTMLElement, shared = false) {
    if (shared && !writable) return;
    closePopup();
    setTool();
    if (shared && sourceBlocks(session.song.original, 'grid').some(block => !block.end)) {
      showError('Skjemaet mangler en entydig slutt. Rett det i Råtekst først.');
      return;
    }
    const capo = session.personal.capo ?? 0,
      source = shared ? sharedGridText(session.song.original) : session.personal.chordGrid || sharedGridText(session.song.original),
      shown = shiftGridText(source, -capo);
    const parts = [...shown.matchAll(/(^[ \t]*\{(?:sog|start_of_grid)[^\r\n]*\}[ \t]*(?:\r\n|\r|\n))([\s\S]*?)(^[ \t]*\{(?:eog|end_of_grid)\}[^\r\n]*)/gmi)].map(m => ({
      header: m[1],
      body: m[2].replace(/\r?\n$/, ''),
      footer: m[3]
    }));
    if (!parts.length) parts.push({
      header: `{sog}${lineEnding(session.song.original)}`,
      body: shown,
      footer: '{eog}'
    });
    const box = dialogFrame(`${shared ? 'Felles akkordskjema' : 'Personlig akkordskjema'}${capo ? `, capo ${capo}` : ''}`, 'edit-popup popup-grid');
    const heading = document.createElement('h2');
    heading.textContent = box.getAttribute('aria-label');
    box.append(heading);
    const inputs = parts.map((part, i) => {
      const input = textArea(`grid-${i}`, part.body, parts.length > 1 ? `Skjematekst ${i + 1}` : 'Skjematekst');
      box.append(input);
      return input;
    });
    const error = document.createElement('p');
    error.className = 'field-error';
    error.setAttribute('role', 'alert');
    box.append(error);
    const dirty = () => inputs.some((input, i) => input.value !== parts[i].body.replace(/\r\n|\r/g, '\n'));
    const close = () => lifecycle.close();
    const actions = dialogFooter([{
      id: 'cancel',
      label: 'Avbryt',
      icon: 'avbryt',
      run: close
    }, {
      id: 'confirm',
      label: 'OK',
      icon: 'ok',
      primary: true,
      run: () => {
        if (!dirty()) {
          close();
          return;
        }
        const ending = lineEnding(session.song.original),
          text = parts.map((p, i) => inputs[i].value.trim() ? p.header + mergeRawSource(p.body, inputs[i].value) + ending + p.footer : '').filter(Boolean).join(ending);
        if (text && inputs.some((input, i) => input.value.trim() && !validGrid(parts[i].header + input.value + ending + parts[i].footer))) {
          error.textContent = 'Skriv et skjema med taktstreker.';
          return;
        }
        const stored = shiftGridText(text, capo);
        if (shared) {
          const blocks = sourceBlocks(session.song.original, 'grid');
          if (blocks.length) original(patchSong(session.song, blocks.flatMap((b, i) => inputs[i]?.value === parts[i].body.replace(/\r\n|\r/g, '\n') ? [] : [{
            start: b.start.start,
            end: b.end?.end ?? session.song.original.length,
            text: inputs[i]?.value.trim() ? shiftGridText(parts[i].header + mergeRawSource(parts[i].body, inputs[i].value) + ending + parts[i].footer, capo) + (b.end?.ending ?? '') : ''
          }])));else if (stored) original(patchSong(session.song, [{
            start: session.song.original.startsWith('\uFEFF') ? 1 : 0,
            end: session.song.original.startsWith('\uFEFF') ? 1 : 0,
            text: stored + ending
          }]));
        } else update(state => ({
          ...state,
          chordGrid: stored || undefined
        }));
        close();
      }
    }]);
    box.append(actions);
    const lifecycle = openDialog(box, {
      opener: anchor,
      focus: inputs[0],
      place: () => placeOverlay(box, undefined, {
        width: overlayWidth('grid'),
        align: 'center',
        height: .8
      }),
      outside: true,
      closed: () => popup = undefined
    });
    popup = {
      close,
      dirty
    };
  }
  function note(anchor: HTMLElement, point?: {
    x: number;
    y: number;
  }) {
    const row = anchor.closest<HTMLElement>('[data-note-line]');
    if (!row) return;
    const id = anchor.closest<HTMLElement>('[data-note-id]')?.dataset.noteId,
      entry = id ? [id, session.personal.notes?.[id]] as const : noteAt(session.personal, Number(row.dataset.noteLine));
    const noteId = entry?.[0] ?? crypto.randomUUID(),
      line = entry?.[1]?.line ?? Number(row.dataset.noteLine);
    value('Notat', 'notat', anchor, entry?.[1]?.text ?? '', text => {
      update(state => changeNote(state, noteId, {
        line,
        text
      }));
    }, undefined, point);
  }
  function run(name: string, button: HTMLElement) {
    if (name === 'remove') {
      removeSelected();
      return;
    }
    if (name === 'undo' || name === 'redo') {
      selected = undefined;
      if (name === 'undo' ? session.undo() : session.redo()) {
        change(true);
        paintTools();
      }
      return;
    }
    if (!writable && ['title','key','time','raw','shared-grid','chord','chorus','reference','comment','dynamic'].includes(name)) return;
    if (['title', 'key', 'time'].includes(name)) {
      metadata(name as 'title', button);
      return;
    }
    if (name === 'raw') {
      closePopup();
      setTool();
      raw();
      return;
    }
    if (name === 'shared-grid' || name === 'grid') {
      openGrid(button, name === 'shared-grid');
      return;
    }
    if (name === 'capo') {
      value('Capo', 'capo', button, String(session.personal.capo ?? 0), text => {
        update(s => ({
          ...s,
          capo: Number(text)
        }));
      }, {
        min: 0,
        max: 11
      });
      return;
    }
    if (name === 'tuning') {
      value('Stemming', 'stemming', button, session.personal.tuning ?? '', text => {
        update(s => ({
          ...s,
          tuning: text.trim()
        }));
      });
      return;
    }
    closePopup();
    setTool(tool === name ? undefined : name);
  }
  type Entry = [string, string, string];
  const common: Entry[] = [['undo', 'Angre', 'angre'], ['redo', 'Gjør om', 'gjenta'], ['remove', 'Fjern', 'viskelaer']];
  const file: Entry[] = [['title', 'Tittel', 'felles'], ['key', 'Toneart', 'key'], ['time', 'Takt', 'time'], ['shared-grid', 'Akkordskjema', 'akkordskjema'], ['chord', 'Akkorder', 'akkord'], ['chorus', 'Refreng', 'refreng'], ['reference', 'Gjenta refreng', 'gjenta-refreng'], ['comment', 'Anvisninger', 'info'], ['dynamic', 'Dynamikk', 'dynamikk'], ['raw', 'Råtekst', 'ratekst']];
  const personal: Entry[] = [['capo', 'Capo', 'capo'], ['tuning', 'Stemming', 'stemming'], ['grid', 'Akkordskjema', 'akkordskjema'], ['note', 'Notater', 'notat'], ['highlight', 'Gulmarkering', 'gulmarkering']];
  for (const [panel, entries] of [[filePanel, file], [personalPanel, personal]] as const) {
    if (panel === filePanel && !writable) continue;
    for (const [i, [name, label, iconName]] of [...common, ...entries].entries()) {
      if (i === 3) {
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
  for (const [id, name] of [['file', 'Filinnhold'], ['personal', 'Egentilpasning']]) {
    if (id === 'file' && !writable) continue;
    const b = actionButton(name, () => {
      tab = id;
      reflectTab();
    });
    b.setAttribute('role', 'tab');
    b.id = `edit-tab-${id}`;
    b.setAttribute('aria-controls', `edit-panel-${id}`);
    tabs.append(b);
    (id === 'file' ? filePanel : personalPanel).id = `edit-panel-${id}`;
  }
  panels.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const items = [...(tab === 'file' ? filePanel : personalPanel).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],
      index = items.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus();
  });
  function reflectTab() {
    toolbar.dataset.tab = tab;
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      const selected = b.id === `edit-tab-${tab}`;
      b.setAttribute('aria-selected', String(selected));
      b.tabIndex = selected ? 0 : -1;
    }
    filePanel.setAttribute('aria-hidden', String(tab !== 'file'));
    personalPanel.setAttribute('aria-hidden', String(tab !== 'personal'));
  }
  tabs.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!writable) return;
      tab = event.key === 'Home' ? 'file' : event.key === 'End' ? 'personal' : tab === 'file' ? 'personal' : 'file';
      reflectTab();
      tabs.querySelector<HTMLElement>('[aria-selected=true]')?.focus();
    }
  });
  function rowAt(y: number) {
    return [...(body?.querySelectorAll<HTMLElement>('[data-source-line],[data-note-line]') ?? [])].filter(r => !r.closest('[hidden]') && r.getClientRects().length).reduce<HTMLElement | undefined>((best, r) => {
      const distance = (n: HTMLElement) => {
        const q = n.getBoundingClientRect();
        return Math.max(q.top - y, 0, y - q.bottom);
      };
      return !best || distance(r) < distance(best) ? r : best;
    }, undefined);
  }
  function handleClick(event: MouseEvent) {
    const target = event.target as Element;
    const point = {
      x: event.clientX,
      y: event.clientY
    };
    if (tool === 'note' && target.closest('.personal-note')) {
      note(target.closest<HTMLElement>('.personal-note')!, point);
      return;
    }
    if (target.closest('[data-remove-element],.highlight-controls,.chorus-handle')) return;
    const row = target.closest<HTMLElement>('[data-source-line]') ?? rowAt(event.clientY);
    if (!row || !body?.contains(row) || !tool) return;
    const spaceBefore = row.classList.contains('song-space') || row.classList.contains('song-end') && event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    const sourceIndex = Number(row.closest<HTMLElement>('.reference')?.dataset.referenceLine ?? row.dataset.sourceLine),
      index = row.classList.contains('song-space') && ['reference', 'comment', 'dynamic'].includes(tool ?? '') ? Math.min(sourceIndex + 1, sourceLines(session.song.original).length) : sourceIndex;
    if (tool === 'note') {
      note(target.closest<HTMLElement>('.personal-note') ?? row, point);
      return;
    }
    if (tool === 'highlight' || tool === 'chorus' || tool === 'remove') return;
    if (target.closest('button') && !target.closest('.dynamic-marker')) return;
    if (tool === 'chord') {
      const chord = target.closest<HTMLElement>('.chord[data-chord-start]'),
        existing = chord ? Number(chord.dataset.chordStart) : undefined,
        offset = chord ? Number(chord.dataset.chordOffset) : lyricOffsetAt(row, event.clientX, event.clientY);
      const start = chord?.dataset.original ?? '',
        capo = session.personal.capo ?? 0;
      value('Akkord', 'akkord', chord ?? row, shiftChord(start, -capo), (text, submitted) => {
        if (!submitted) return;
        original(setChord(session.song, index, offset, shiftChord(text.trim(), capo), existing, spaceBefore));
      }, undefined, point);
    } else if (tool === 'comment') {
      const current = sourceLines(session.song.original)[index],
        existing = sourceIndex === index && ['comment', 'c'].includes(current?.directive?.name ?? '');
      value('Anvisning', 'info', row, existing ? current.directive!.value : '', (text, submitted) => {
        if (!submitted) return;
        if (/[\r\n{}]/.test(text)) throw Error('Bruk én linje uten klammer.');
        original(existing ? setDirective(session.song, index, 'comment', text) : insertDirective(session.song, index, `{comment: ${text}}`, spaceBefore));
      }, undefined, point);
    } else if (tool === 'dynamic') {
      const marker = target.closest<HTMLElement>('[data-dynamic-line]');
      let line = marker ? Number(marker.dataset.dynamicLine) : undefined;
      value('Dynamikk', 'dynamikk', marker ?? row, marker?.dataset.level ?? '3', text => {
        const next = line === undefined ? insertDirective(session.song, index, `{x_dyn: ${text}}`, spaceBefore) : setDirective(session.song, line, 'x_dyn', text);
        if (line === undefined) line = sourceLines(next.original)[index]?.directive?.name === 'x_dyn' ? index : index + 1;
        original(next);
      }, {
        min: 1,
        max: 5
      }, point);
    } else if (tool === 'reference') {
      const definitions = sourceBlocks(session.song.original, 'chorus');
      if (definitions.some(b => b.start.index < index && index < (b.end?.index ?? Infinity))) {
        showError('Sett henvisningen utenfor refrengblokken.');
        return;
      }
      setTool();
      original(insertDirective(session.song, index, '{chorus}', spaceBefore));
    }
  }
  function showError(text: string) {
    let p = toolbar.querySelector<HTMLElement>('.editor-error');
    if (!p) {
      p = document.createElement('p');
      p.className = 'editor-error';
      p.setAttribute('role', 'alert');
      toolbar.append(p);
    }
    p.textContent = text;
  }
  function choiceAt(target: Element): ElementChoice | undefined {
    if (!writable && !target.closest('.personal-note,mark')) return;
    const note = target.closest<HTMLElement>('.personal-note');
    if (note?.dataset.noteId) return {
      kind: 'note',
      id: note.dataset.noteId
    };
    const chord = target.closest<HTMLElement>('.chord[data-chord-start]');
    if (chord) return {
      kind: 'chord',
      start: Number(chord.dataset.chordStart)
    };
    const dynamic = target.closest<HTMLElement>('.dynamic-marker');
    if (dynamic) return {
      kind: 'dynamic',
      line: Number(dynamic.dataset.dynamicLine)
    };
    const mark = target.closest<HTMLElement>('mark');
    if (mark) {
      const row = mark.closest<HTMLElement>('[data-occurrence]'),
        lyric = mark.closest<HTMLElement>('.lyric');
      if (!row || !lyric) return;
      const before = document.createRange();
      before.selectNodeContents(lyric);
      before.setEndBefore(mark);
      const at = Number(lyric.dataset.offset) + before.toString().length;
      const range = session.personal.annotations?.[row.dataset.occurrence!]?.highlights.find(range => at >= range.start && at < range.end);
      if (range) return {
        kind: 'highlight',
        occurrence: row.dataset.occurrence!,
        range
      };
    }
    const comment = target.closest<HTMLElement>('.comment[data-source-line]');
    if (comment && ['comment', 'c'].includes(sourceLines(session.song.original)[Number(comment.dataset.sourceLine)]?.directive?.name ?? '')) return {
      kind: 'comment',
      line: Number(comment.dataset.sourceLine)
    };
    const heading = target.closest<HTMLElement>('.chorus > h2'),
      section = heading?.parentElement;
    if (section?.dataset.referenceLine !== undefined) return {
      kind: 'reference',
      line: Number(section.dataset.referenceLine)
    };
    if (section?.dataset.chorusStart !== undefined) return {
      kind: 'chorus',
      line: Number(section.dataset.chorusStart)
    };
  }
  function selectable(target: Element): HTMLElement | undefined {
    if (target.closest('.highlight-controls,.chorus-handle')) return;
    const node = target.closest<HTMLElement>('.personal-note,.chord[data-chord-start],.dynamic-marker,mark,.comment[data-source-line],.chorus > h2');
    if ((tool === 'highlight' || tool === 'chorus') && node?.matches('.chord')) return;
    return node && body?.contains(node) && choiceAt(node) ? node : undefined;
  }
  function reflectSelection() {
    if (!body) return;
    body.querySelectorAll('[data-element-selected]').forEach(node => node.removeAttribute('data-element-selected'));
    for (const node of body.querySelectorAll<HTMLElement>('.personal-note,.chord[data-chord-start],mark,.comment[data-source-line],.chorus > h2')) if (choiceAt(node)) {
      node.tabIndex = 0;
      node.setAttribute('aria-description', 'Hold inne eller trykk Enter for å velge. Fjern sletter valgt element.');
    }
    if (!selected) return;
    const choice = selected;
    let nodes: HTMLElement[] = [];
    if (choice.kind === 'note') nodes = [...body.querySelectorAll<HTMLElement>('.personal-note')].filter(node => node.dataset.noteId === choice.id);else if (choice.kind === 'chord') nodes = [...body.querySelectorAll<HTMLElement>('.chord[data-chord-start]')].filter(node => Number(node.dataset.chordStart) === choice.start);else if (choice.kind === 'highlight') nodes = [...body.querySelectorAll<HTMLElement>('mark')].filter(node => {
      const own = choiceAt(node);
      return own?.kind === 'highlight' && (choice.range.groupId ? own.range.groupId === choice.range.groupId : own.occurrence === choice.occurrence && own.range.start === choice.range.start && own.range.end === choice.range.end);
    });else if (choice.kind === 'dynamic') nodes = [...body.querySelectorAll<HTMLElement>('.dynamic-marker')].filter(node => Number(node.dataset.dynamicLine) === choice.line);else if (choice.kind === 'comment') nodes = [...body.querySelectorAll<HTMLElement>('.comment[data-source-line]')].filter(node => Number(node.dataset.sourceLine) === choice.line);else nodes = [...body.querySelectorAll<HTMLElement>(choice.kind === 'chorus' ? '[data-chorus-start]' : '[data-reference-line]')].filter(node => Number(choice.kind === 'chorus' ? node.dataset.chorusStart : node.dataset.referenceLine) === choice.line);
    for (const node of nodes) node.dataset.elementSelected = '';
  }
  function selectElement(target: HTMLElement) {
    const choice = choiceAt(target);
    if (!choice) return;
    setTool();
    selected = choice;
    if (choice.kind === 'highlight') {
      const row = target.closest<HTMLElement>('[data-occurrence]');
      if (row) highlighter?.restore(row, choice.range);
    }
    paintTools();
  }
  function removeSelected() {
    const choice = selected;
    if (!choice) return;
    selected = undefined;
    highlighter?.clear();
    try {
      if (choice.kind === 'note') update(state => changeNote(state, choice.id, undefined));else if (choice.kind === 'highlight') update(state => {
        let next = state;
        for (const annotation of Object.values(state.annotations ?? {})) {
          const highlights = annotation.highlights.filter(range => choice.range.groupId ? range.groupId !== choice.range.groupId : annotation.anchor.occurrence !== choice.occurrence || range.start !== choice.range.start || range.end !== choice.range.end);
          next = changeAnnotation(next, annotation.anchor, {
            highlights
          });
        }
        return next;
      });else if (choice.kind === 'chord') {
        const row = sourceLines(session.song.original).find(row => sourceChords(row).some(token => token.start === choice.start)),
          token = row && sourceChords(row).find(token => token.start === choice.start);
        if (row && token) original(setChord(session.song, row.index, token.offset, '', choice.start));
      } else if (choice.kind === 'chorus') {
        const block = sourceBlocks(session.song.original, 'chorus').find(block => block.start.index === choice.line);
        if (block) original(removeSourceBlock(session.song, block));
      } else {
        const row = sourceLines(session.song.original)[choice.line];
        if (row) original(patchSong(session.song, [{
          start: row.start,
          end: row.end,
          text: ''
        }]));
      }
      paintTools();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Kunne ikke fjerne elementet.');
    }
  }
  function startChordDrag(node: HTMLElement, x: number, y: number, pointerType = 'mouse'): ElementDrag | undefined {
    if (!writable || !node.matches('.chord[data-chord-start]') || !body) return;
    const root = body,
      start = Number(node.dataset.chordStart),
      ghost = node.cloneNode(true) as HTMLElement;
    ghost.className = 'chord-drag-ghost';
    ghost.dataset.input = pointerType;
    const context = document.createElement('span');
    context.className = 'chord-drag-context';
    if (pointerType !== 'mouse') ghost.append(context);
    ghost.removeAttribute('tabindex');
    ghost.removeAttribute('data-element-selected');
    ghost.setAttribute('aria-hidden', 'true');
    document.body.append(ghost);
    node.dataset.moving = '';
    const caret = document.createElement('span');
    caret.className = 'chord-drop-caret';
    root.append(caret);
    let target: {
      line: number;
      offset: number;
    } | undefined;
    const move = (x: number, y: number) => {
      const positionGhost = () => {
        ghost.style.left = `${pointerType === 'mouse' ? x + 12 : Math.max(8, Math.min(x - ghost.offsetWidth / 2, innerWidth - ghost.offsetWidth - 8))}px`;
        ghost.style.top = `${Math.max(8, pointerType === 'mouse' ? y - 30 : y - ghost.offsetHeight - 56)}px`;
      };
      positionGhost();
      target = undefined;
      caret.hidden = true;
      const rows = [...root.querySelectorAll<HTMLElement>('.song-line,.song-space,.song-end')].filter(row => !row.closest('[hidden]'));
      const row = rows.find(row => {
        const rect = row.getBoundingClientRect();
        return y >= rect.top - 3 && y <= rect.bottom + 3;
      });
      if (!row) {
        ghost.dataset.invalid = 'true';
        context.textContent = 'Velg tekstposisjon';
        positionGhost();
        return;
      }
      const line = Number(row.dataset.sourceLine),
        position = lyricPositionAt(row, x, y),
        offset = position.offset;
      target = {
        line,
        offset
      };
      ghost.dataset.invalid = 'false';
      const text = lyricText(row);
      context.textContent = Array.from(text.slice(0, offset)).slice(-8).join('') + '│' + Array.from(text.slice(offset)).slice(0, 8).join('');
      positionGhost();
      const bounds = root.getBoundingClientRect();
      caret.hidden = false;
      caret.style.left = `${Math.max(0, Math.min(position.x - bounds.left, root.clientWidth - 2))}px`;
      caret.style.top = `${position.top - bounds.top}px`;
      caret.style.height = `${Math.max(20, position.height)}px`;
    };
    move(x, y);
    return {
      move,
      finish(cancel) {
        ghost.remove();
        caret.remove();
        delete node.dataset.moving;
        if (cancel || !target) return;
        try {
          const moved = moveChord(session.song, start, target.line, target.offset);
          selected = {
            kind: 'chord',
            start: moved.start
          };
          original(moved.song);
        } catch (error) {
          showError(error instanceof Error ? error.message : 'Kunne ikke flytte akkorden.');
        }
      }
    };
  }
  function decorate() {
    if (!body) return;
    const rows = sourceLines(session.song.original);
    const end = document.createElement('div');
    end.className = 'song-end';
    end.dataset.sourceLine = String(rows.length);
    end.dataset.noteLine = String(logicalLines(session.song).length);
    end.tabIndex = 0;
    end.setAttribute('aria-label', 'Plassering etter sangteksten');
    end.setAttribute('aria-description', 'Enter setter inn rett etter. Shift+Enter setter inn med luft.');
    for (const label of ['Rett etter', 'Med luft']) {
      const hint = document.createElement('span');
      hint.className = 'song-end-option';
      hint.textContent = label;
      end.append(hint);
    }
    body.append(end);
    for (const row of body.querySelectorAll<HTMLElement>('[data-source-line]')) {
      const source = rows[Number(row.dataset.sourceLine)];
      if (!source) continue;
      const tokens = sourceChords(source);
      let n = 0;
      for (const chord of row.querySelectorAll<HTMLElement>('.chord')) if (chord.dataset.original) {
        const token = tokens[n++];
        if (token) {
          chord.dataset.chordStart = String(token.start);
          chord.dataset.chordOffset = String(token.offset);
        }
      }
      row.tabIndex = 0;
    }
    reflectSelection();
  }
  function mount(root: HTMLElement) {
    unmount();
    body = root;
    highlighter = createHighlightEditor(root, session.song, () => session.personal, update, () => {
      tool = undefined;
      paintTools();
    }, true);
    const stopDrag = attachNoteDrag(root, update, y => nearestNoteTarget(root, y), node => {
      if (tool === 'note') note(node);
    }, selectElement);
    decorate();
    const stopDynamics = attachDynamicMarkers(root);
    const stopHeld = attachHeldElements(root, {
      resolve: selectable,
      select: selectElement,
      startDrag: startChordDrag
    });
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (toolbar.contains(target) || target.closest('[data-element-selected],.highlight-controls,.chorus-handle')) return;
      if (selected) {
        selected = undefined;
        highlighter?.clear();
        paintTools();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    if (restored) {
      const row = [...root.querySelectorAll<HTMLElement>('[data-occurrence]')].find(r => r.dataset.occurrence === restored!.occurrence);
      if (row) highlighter.restore(row, restored.range);
      restored = undefined;
    }
    let down: {
        x: number;
        y: number;
        scroll: number;
        row: number;
        existing?: number;
        handle?: 'start' | 'end';
        moved?: boolean;
        stop: () => void;
      } | undefined,
      cancelled = false;
    const pointerDown = (event: PointerEvent) => {
      cancelled = false;
      const target = event.target as Element;
      if (tool === 'chorus') {
        const row = rowAt(event.clientY);
        if (!row) return;
        const handle = target.closest<HTMLElement>('.chorus-handle'),
          section = target.closest<HTMLElement>('.chorus');
        event.preventDefault();
        root.setPointerCapture(event.pointerId);
        down = {
          x: event.clientX,
          y: event.clientY,
          scroll: scrollY,
          row: Number(row.dataset.sourceLine),
          existing: section?.dataset.chorusStart ? Number(section.dataset.chorusStart) : undefined,
          handle: handle?.dataset.edge as 'start' | 'end' | undefined,
          stop: () => {}
        };
        down.stop = edgeScroll(() => down?.y ?? innerHeight / 2, () => {});
      } else down = {
        x: event.clientX,
        y: event.clientY,
        scroll: scrollY,
        row: 0,
        stop: () => {}
      };
    };
    const pointerMove = (event: PointerEvent) => {
      if (!down) return;
      if (tool === 'chorus') {
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) down.moved = true;
        down.y = event.clientY;
        const end = rowAt(event.clientY);
        root.querySelectorAll('[data-chorus-selected]').forEach(r => r.removeAttribute('data-chorus-selected'));
        if (end) for (const r of root.querySelectorAll<HTMLElement>('[data-source-line]')) {
          const i = Number(r.dataset.sourceLine);
          if (i >= Math.min(down.row, Number(end.dataset.sourceLine)) && i <= Math.max(down.row, Number(end.dataset.sourceLine))) r.setAttribute('data-chorus-selected', '');
        }
      } else if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) cancelled = true;
    };
    const finish = (event: PointerEvent, abort = false) => {
      const gesture = down;
      down = undefined;
      gesture?.stop();
      root.querySelectorAll('[data-chorus-selected]').forEach(r => r.removeAttribute('data-chorus-selected'));
      if (abort) {
        cancelled = true;
        return;
      }
      if (tool === 'chorus' && gesture) {
        const end = rowAt(event.clientY);
        if (!end) return;
        try {
          if (gesture.existing !== undefined && !gesture.handle && !gesture.moved) {
            showChorusHandles(gesture.existing);
            return;
          }
          let from = gesture.row,
            to = Number(end.dataset.sourceLine);
          if (gesture.handle && gesture.existing !== undefined) {
            const b = sourceBlocks(session.song.original, 'chorus').find(b => b.start.index === gesture.existing)!;
            from = gesture.handle === 'start' ? to : b.start.index + 1;
            to = gesture.handle === 'end' ? to : (b.end?.index ?? rowsLast()) - 1;
          }
          setTool();
          original(setChorus(session.song, from, to, gesture.existing));
        } catch (e) {
          showError(e instanceof Error ? e.message : 'Kunne ikke endre refrenget.');
        }
      }
    };
    const click = (event: MouseEvent) => {
      if (cancelled) {
        cancelled = false;
        return;
      }
      try {
        handleClick(event);
      } catch (e) {
        showError(e instanceof Error ? e.message : 'Kunne ikke endre elementet.');
      }
    };
    let chorusKeyboardStart: number | undefined;
    const key = (event: KeyboardEvent) => {
      if (currentPage() !== 'reader' || document.querySelector('dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        change();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        run(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo', toolbar);
      }
      if (event.key === 'Escape') setTool();
      const target = event.target as Element,
        node = selectable(target);
      if (!tool && node && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        selectElement(node);
        return;
      }
      if (writable && event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) && node?.matches('.chord[data-chord-start]')) {
        event.preventDefault();
        const row = node.closest<HTMLElement>('[data-source-line]')!,
          offset = Math.max(0, Math.min(lyricText(row).length, Number(node.dataset.chordOffset) + (event.key === 'ArrowRight' ? 1 : -1)));
        try {
          const next = moveChord(session.song, Number(node.dataset.chordStart), Number(row.dataset.sourceLine), offset);
          selected = {
            kind: 'chord',
            start: next.start
          };
          original(next.song);
        } catch (error) {
          showError(error instanceof Error ? error.message : 'Kunne ikke flytte akkorden.');
        }
        return;
      }
      if (selected && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (['Enter', ' '].includes(event.key) && (event.target as Element).matches('[data-source-line],.personal-note')) {
        event.preventDefault();
        const target = event.target as HTMLElement;
        if (tool === 'chorus') {
          const index = Number(target.dataset.sourceLine);
          if (chorusKeyboardStart === undefined) {
            chorusKeyboardStart = index;
            showError('Velg siste refrenglinje med Tab og Enter.');
          } else {
            try {
              const first = chorusKeyboardStart;
              chorusKeyboardStart = undefined;
              setTool();
              original(setChorus(session.song, first, index));
            } catch (e) {
              showError(String(e));
            }
          }
        } else {
          const r = target.getBoundingClientRect();
          target.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            clientX: r.left + 1,
            clientY: event.shiftKey && target.classList.contains('song-end') ? r.bottom - 1 : r.top + 1
          }));
        }
      }
    };
    const cancel = (e: PointerEvent) => finish(e, true);
    root.addEventListener('pointerdown', pointerDown);
    root.addEventListener('pointermove', pointerMove);
    root.addEventListener('pointerup', finish);
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('click', click);
    document.addEventListener('keydown', key);
    unmount = () => {
      down?.stop();
      stopDrag();
      stopHeld();
      stopDynamics();
      document.removeEventListener('pointerdown', outside, true);
      highlighter?.dispose();
      highlighter = undefined;
      root.removeEventListener('pointerdown', pointerDown);
      root.removeEventListener('pointermove', pointerMove);
      root.removeEventListener('pointerup', finish);
      root.removeEventListener('pointercancel', cancel);
      root.removeEventListener('click', click);
      document.removeEventListener('keydown', key);
    };
    paintTools();
    if (selected) root.querySelector<HTMLElement>('[data-element-selected]')?.focus({
      preventScroll: true
    });
  }
  const rowsLast = () => sourceLines(session.song.original).length;
  function showChorusHandles(index: number) {
    if (!body) return;
    body.querySelectorAll('.chorus-handle').forEach(n => n.remove());
    const section = body.querySelector<HTMLElement>(`[data-chorus-start="${index}"]`);
    if (!section) return;
    for (const edge of ['start', 'end']) {
      const h = actionButton(edge === 'start' ? '‹' : '›', undefined);
      h.className = `chorus-handle chorus-handle-${edge}`;
      h.dataset.edge = edge;
      h.setAttribute('aria-label', `Flytt ${edge === 'start' ? 'starten' : 'slutten'} av refrenget`);
      h.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const block = sourceBlocks(session.song.original, 'chorus').find(b => b.start.index === index)!;
        const first = block.start.index + 1,
          last = (block.end?.index ?? rowsLast()) - 1,
          delta = event.key === 'ArrowUp' ? -1 : 1;
        try {
          original(setChorus(session.song, edge === 'start' ? first + delta : first, edge === 'end' ? last + delta : last, index));
        } catch (e) {
          showError(String(e));
        }
      });
      section.append(h);
    }
  }
  reflectTab();
  paintTools();
  return {
    element: toolbar,
    mount,
    unmount: () => {
      unmount();
      unmount = () => {};
      body = undefined;
    },
    refresh: () => {
      if (body) paintAnnotations(body, session.song, session.personal);
      paintTools();
    },
    dirty: () => Boolean(popup?.dirty()),
    markSaved: paintTools,
    openGrid,
    selection: () => highlighter?.selection(),
    select: (line: HTMLElement, _state: SongPersonal, range?: Highlight) => {
      if (range) restored = {
        occurrence: line.dataset.occurrence!,
        range
      };
    },
    dispose() {
      popup?.discard?.();
      popup?.close();
      unmount();
    }
  };
}
