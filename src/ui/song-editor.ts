import { actionButton, icon, textArea } from './controls.ts';
import { dialogFrame, dialogFooter, openDialog } from './dialog.ts';
import { valueControl } from './value-controls.ts';
import { overlayWidth, placeOverlay, currentPage } from './layout.ts';
import { createHighlightEditor, lyricText, edgeScroll } from './highlight-editor.ts';
import { attachNoteDrag } from './note-drag.ts';
import { paintAnnotations } from './annotations.ts';
import { changeNote, noteAt, changeAnnotation, type Highlight } from '../domain/annotations.ts';
import { shiftChord, shiftGridText, sharedGridText, validGrid } from '../domain/personal.ts';
import { sourceLines, sourceChords, sourceBlocks, setChord, setMetadata, setDirective, insertDirective, patchSong, setChorus, removeSourceBlock, transposeSong, lineEnding, mergeRawSource, type SourceBlock } from '../domain/source-edit.ts';
import { validTime } from '../domain/original.ts';
import type { Song, SongPersonal } from '../domain/song.ts';
import type { EditSession } from '../domain/edit-session.ts';
export function createSongEditor(session: EditSession, change: (source?: boolean) => void, raw: () => void) {
  let body: HTMLElement | undefined,
    unmount = () => {},
    highlighter: ReturnType<typeof createHighlightEditor> | undefined;
  let restored: {
    occurrence: string;
    range: Highlight;
  } | undefined;
  let tool: string | undefined,
    tab = 'file',
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
      if (name === 'undo') b.disabled = !session.canUndo();else if (name === 'redo') b.disabled = !session.canRedo();else if (['remove', 'chord', 'chorus', 'reference', 'comment', 'dynamic', 'note', 'highlight'].includes(name)) b.setAttribute('aria-pressed', String(tool === name));
    }
    body?.setAttribute('data-tool', tool ?? '');
    highlighter?.setActive(tool === 'highlight');
    drawRemove();
  }
  const setTool = (value?: string) => {
    toolbar.querySelector('.editor-error')?.remove();
    tool = value;
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
  }) {
    closePopup();
    setTool();
    session.beginGroup();
    popup = valueControl({
      name,
      icon: iconName,
      anchor,
      value: start,
      submitOnly: ['Toneart', 'Akkord', 'Anvisning'].includes(name),
      multiline: name === 'Notat',
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
      if (name === 'time' && !validTime(text)) throw Error('Skriv takt, for eksempel 4/4 eller 3/4.');
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
    closePopup();
    setTool();
    if(shared&&sourceBlocks(session.song.original,'grid').some(block=>!block.end)){showError('Skjemaet mangler en entydig slutt. Rett det i Råtekst først.');return;}
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
  function note(anchor: HTMLElement) {
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
    });
  }
  function run(name: string, button: HTMLElement) {
    if (name === 'undo' || name === 'redo') {
      if (name === 'undo' ? session.undo() : session.redo()) {
        change(true);
        paintTools();
      }
      return;
    }
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
  function chordAt(row: HTMLElement, target: Element, x: number, y: number) {
    const lyric = target.closest<HTMLElement>('.lyric');
    if (!lyric) return 0;
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => {
        offsetNode: Node;
        offset: number;
      } | null;
    };
    const point = doc.caretPositionFromPoint?.(x, y),
      range = doc.caretRangeFromPoint?.(x, y),
      node = point?.offsetNode ?? range?.startContainer,
      offset = point?.offset ?? range?.startOffset;
    if (node && offset !== undefined && lyric.contains(node)) {
      const prefix = document.createRange();
      prefix.selectNodeContents(lyric);
      prefix.setEnd(node, offset);
      return Number(lyric.dataset.offset) + Math.min(Number(lyric.dataset.length), prefix.toString().length);
    }
    return Number(lyric.dataset.offset);
  }
  function handleClick(event: MouseEvent) {
    const target = event.target as Element;
    if (tool === 'note' && target.closest('.personal-note')) {
      note(target.closest<HTMLElement>('.personal-note')!);
      return;
    }
    if (target.closest('[data-remove-element],.highlight-controls,.chorus-handle')) return;
    const row = target.closest<HTMLElement>('[data-source-line]') ?? rowAt(event.clientY);
    if (!row || !body?.contains(row) || !tool) return;
    const index = Number(row.dataset.sourceLine);
    if (tool === 'note') {
      note(target.closest<HTMLElement>('.personal-note') ?? row);
      return;
    }
    if (tool === 'highlight' || tool === 'chorus' || tool === 'remove') return;
    if (target.closest('button') && !target.closest('.dynamic-marker')) return;
    if (tool === 'chord') {
      const chord = target.closest<HTMLElement>('.chord[data-chord-start]'),
        existing = chord ? Number(chord.dataset.chordStart) : undefined,
        offset = chord ? Number(chord.dataset.chordOffset) : chordAt(row, target, event.clientX, event.clientY);
      const start = chord?.dataset.original ?? '',
        capo = session.personal.capo ?? 0;
      value('Akkord', 'akkord', chord ?? row, shiftChord(start, -capo), (text, submitted) => {
        if (!submitted) return;
        original(setChord(session.song, index, offset, shiftChord(text.trim(), capo), existing));
      });
    } else if (tool === 'comment') {
      const current = sourceLines(session.song.original)[index],
        existing = ['comment', 'c'].includes(current?.directive?.name ?? '');
      value('Anvisning', 'info', row, existing ? current.directive!.value : '', (text, submitted) => {
        if (!submitted) return;
        if (/[\r\n{}]/.test(text)) throw Error('Bruk én linje uten klammer.');
        original(existing ? setDirective(session.song, index, 'comment', text) : insertDirective(session.song, index, `{comment: ${text}}`));
      });
    } else if (tool === 'dynamic') {
      const marker = target.closest<HTMLElement>('[data-dynamic-line]');
      let line = marker ? Number(marker.dataset.dynamicLine) : undefined;
      value('Dynamikk', 'dynamikk', marker ?? row, marker?.dataset.level ?? '3', text => {
        original(line === undefined ? insertDirective(session.song, index, `{x_dyn: ${text}}`) : setDirective(session.song, line, 'x_dyn', text));
        if (line === undefined) line = index;
      }, {
        min: 1,
        max: 5
      });
    } else if (tool === 'reference') {
      const definitions=sourceBlocks(session.song.original,'chorus');
      if(!definitions.some(b=>b.end&&b.end.index<index)||definitions.some(b=>b.start.index<index&&index<(b.end?.index??Infinity))) {
        showError('Definer et refreng før du setter inn en henvisning.');
        return;
      }
      setTool();
      original(insertDirective(session.song, index, '{chorus}'));
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
  function removeButton(anchor: HTMLElement, label: string, action: () => void) {
    const b = actionButton('', () => {
      try {
        action();
      } catch (e) {
        showError(e instanceof Error ? e.message : 'Kunne ikke fjerne elementet.');
      }
    }, 'kryss');
    b.className = 'element-remove';
    b.dataset.removeElement = '';
    b.setAttribute('aria-label', label);
    anchor.append(b);
  }
  function drawRemove() {
    if (!body) return;
    body.querySelectorAll('[data-remove-element]').forEach(n => n.remove());
    if (tool !== 'remove') return;
    for (const chord of body.querySelectorAll<HTMLElement>('.chord[data-chord-start]')) removeButton(chord, 'Fjern akkord', () => original(setChord(session.song, Number(chord.closest<HTMLElement>('[data-source-line]')!.dataset.sourceLine), Number(chord.dataset.chordOffset), '', Number(chord.dataset.chordStart))));
    for (const marker of body.querySelectorAll<HTMLElement>('.dynamic-marker')) removeButton(marker, 'Fjern dynamikk', () => {
      const row = sourceLines(session.song.original)[Number(marker.dataset.dynamicLine)];
      original(patchSong(session.song, [{
        start: row.start,
        end: row.end,
        text: ''
      }]));
    });
    for (const row of body.querySelectorAll<HTMLElement>('[data-source-line]')) {
      const source = sourceLines(session.song.original)[Number(row.dataset.sourceLine)];
      if (['comment', 'c'].includes(source?.directive?.name ?? '')) removeButton(row, 'Fjern anvisning', () => original(patchSong(session.song, [{
        start: source.start,
        end: source.end,
        text: ''
      }])));
    }
    for (const section of body.querySelectorAll<HTMLElement>('.chorus')) {
      if (section.dataset.referenceLine) {
        const row = sourceLines(session.song.original)[Number(section.dataset.referenceLine)];
        removeButton(section.querySelector<HTMLElement>('h2')!, 'Fjern refrenghenvisning', () => original(patchSong(session.song, [{
          start: row.start,
          end: row.end,
          text: ''
        }])));
      } else if (section.dataset.chorusStart) {
        const block = sourceBlocks(session.song.original, 'chorus').find(b => b.start.index === Number(section.dataset.chorusStart));
        if (block) removeButton(section.querySelector<HTMLElement>('h2')!, 'Fjern refrengformatering', () => original(removeSourceBlock(session.song, block)));
      }
    }
    for (const note of body.querySelectorAll<HTMLElement>('.personal-note')) removeButton(note, 'Fjern notat', () => update(state => changeNote(state, note.dataset.noteId!, undefined)));
    const seen = new Set<string>();
    for (const mark of body.querySelectorAll<HTMLElement>('mark')) {
      const row = mark.closest<HTMLElement>('[data-occurrence]')!,
        lyric = mark.closest<HTMLElement>('.lyric')!,
        range = document.createRange();
      range.selectNodeContents(lyric);
      range.setEndBefore(mark);
      const at = Number(lyric.dataset.offset) + range.toString().length;
      const highlight = session.personal.annotations?.[row.dataset.occurrence!]?.highlights.find(h => at >= h.start && at < h.end);
      if (!highlight) continue;
      const id = highlight.groupId ?? `${row.dataset.occurrence}:${highlight.start}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const control = document.createElement('span');
      control.className = 'highlight-remove-anchor';
      row.append(control);
      removeButton(control, 'Fjern gulmarkering', () => update(state => {
        let next = state;
        for (const annotation of Object.values(state.annotations ?? {})) {
          const highlights = annotation.highlights.filter(h => highlight.groupId ? h.groupId !== highlight.groupId : annotation.anchor.occurrence !== row.dataset.occurrence || h.start !== highlight.start || h.end !== highlight.end);
          next = changeAnnotation(next, annotation.anchor, {
            highlights
          });
        }
        return next;
      }));
    }
  }
  function decorate() {
    if (!body) return;
    const rows = sourceLines(session.song.original);
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
    for (const row of rows.filter(r => r.directive?.name === 'x_dyn' && /^[1-5]$/.test(r.directive.value.trim()))) {
      const next = rows.slice(row.index + 1).find(r => body!.querySelector(`[data-source-line="${r.index}"]`));
      const anchors = next ? [...body.querySelectorAll<HTMLElement>(`[data-source-line="${next.index}"]`)] : [];
      if (!anchors.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'dynamic-empty';
        body.append(placeholder);
        anchors.push(placeholder);
      }
      for (const anchor of anchors) {
        const marker = actionButton(row.directive!.value, undefined);
        marker.className = 'dynamic-marker';
        marker.style.top = `${anchor.querySelectorAll('.dynamic-marker').length * 28}px`;
        marker.dataset.dynamicLine = String(row.index);
        marker.dataset.level = row.directive!.value;
        marker.setAttribute('aria-label', `Dynamikk ${row.directive!.value}`);
        anchor.prepend(marker);
      }
    }
    drawRemove();
  }
  function mount(root: HTMLElement) {
    unmount();
    body = root;
    highlighter = createHighlightEditor(root, session.song, () => session.personal, update, () => {
      tool = undefined;
      paintTools();
    }, true);
    const stopDrag = attachNoteDrag(root, update, rowAt, node => {
      if (tool === 'note') note(node);
    });
    decorate();
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
            clientY: r.top + 1
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
