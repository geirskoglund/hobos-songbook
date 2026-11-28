import {valueControl} from './value-controls.ts';
import {createHighlightEditor} from './highlight-editor.ts';
import {attachNoteDrag} from './note-drag.ts';
import {nearestNoteTarget} from './note-position.ts';
import {attachHeldElements} from './held-elements.ts';
import {attachDynamicMarkers} from './dynamic-markers.ts';
import {paintAnnotations} from './annotations.ts';
import {createEditorToolbar} from './editor-toolbar.ts';
import {choiceAt, reflectSelection, removeChoice, selectableAt, type ElementChoice} from './editor-selection.ts';
import {gridWithoutEnd, openGridDialog} from './grid-dialog.ts';
import {startChordDrag} from './chord-drag.ts';
import {attachEditorInput} from './editor-input.ts';
import type {EditorContext, Point, ValueRequest} from './editor-context.ts';
import {changeNote, noteAt, logicalLines} from '../domain/annotations.ts';
import type {Highlight, Song, SongPersonal} from '../core/song.ts';
import {shiftGridText} from '../domain/personal.ts';
import {sourceLines, sourceChords, moveChord, setMetadata, transposeSong} from '../domain/source-edit.ts';
import {readOnlyImport, type EditSession} from '../domain/edit-session.ts';
import {importedSong} from '../domain/song.ts';

/**
 * Redigeringsmodus for én sang. Editoren eier verktøyet, valget og den åpne kontrollen; delmodulene
 * (verktøylinje, valg, plassering, refreng, akkorddrag, skjemadialog) får dem gjennom `EditorContext`.
 */
export function createSongEditor(session: EditSession, change: (source?: boolean) => void, raw: () => void) {
  let tool: string | undefined;
  let selected: ElementChoice | undefined;
  let body: HTMLElement | undefined,
    unmount = () => {},
    highlighter: ReturnType<typeof createHighlightEditor> | undefined;
  let restored:
    | {
        occurrence: string;
        range: Highlight;
      }
    | undefined;
  let popup:
    | {
        close: () => void;
        dirty: () => boolean;
        discard?: () => void;
      }
    | undefined;
  const toolbar = createEditorToolbar(run, {file: !importedSong(session.song)});
  function paintTools() {
    toolbar.paint({canUndo: session.canUndo(), canRedo: session.canRedo(), selected: Boolean(selected), tool});
    body?.setAttribute('data-tool', tool ?? '');
    highlighter?.setActive(tool === 'highlight');
    if (body) reflectSelection(body, session, selected);
  }
  const setTool = (value?: string) => {
    toolbar.clearError();
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
    toolbar.clearError();
    // #101 F16: the file content of an imported song is never changed.
    if (importedSong(session.song)) {
      toolbar.showError(readOnlyImport);
      return;
    }
    session.replaceOriginal(next, fn);
    paintTools();
    change(true);
  };
  function closePopup() {
    popup?.close();
  }
  function value(request: ValueRequest) {
    closePopup();
    setTool();
    session.beginGroup();
    popup = valueControl({
      name: request.name,
      icon: request.icon,
      anchor: request.anchor,
      point: request.point,
      value: request.start,
      submitOnly: ['Toneart', 'Akkord', 'Anvisning'].includes(request.name),
      numeric: request.numeric,
      change: request.apply,
      closed: () => {
        popup = undefined;
        session.endGroup();
        paintTools();
      },
    });
  }
  const timeSignature = () =>
    sourceLines(session.song.original).find(l => l.directive?.name === 'time')?.directive?.value ?? '';
  function metadata(name: 'title' | 'key' | 'time', anchor: HTMLElement) {
    const current = () =>
      name === 'title' ? session.song.title : name === 'key' ? (session.song.key ?? '') : timeSignature();
    value({
      name: {title: 'Tittel', key: 'Toneart', time: 'Takt'}[name],
      icon: {title: 'felles', key: 'key', time: 'time'}[name],
      anchor,
      start: current(),
      apply: (text, submitted) => {
        if (text === current()) return;
        if (name === 'key') {
          if (!submitted) return;
          const next = transposeSong(session.song, text.trim());
          original(next.song, state => ({
            ...state,
            chordGrid: state.chordGrid ? shiftGridText(state.chordGrid, next.interval) : undefined,
          }));
        } else original(setMetadata(session.song, name, text));
      },
    });
  }
  function openGrid(anchor: HTMLElement, shared = false) {
    closePopup();
    setTool();
    if (shared && gridWithoutEnd(session)) {
      toolbar.showError('Skjemaet mangler en entydig slutt. Rett det i Råtekst først.');
      return;
    }
    popup = openGridDialog(session, anchor, shared, {update, original, closed: () => (popup = undefined)});
  }
  function note(anchor: HTMLElement, point?: Point) {
    const row = anchor.closest<HTMLElement>('[data-note-line]');
    if (!row) return;
    const id = anchor.closest<HTMLElement>('[data-note-id]')?.dataset.noteId,
      entry = id
        ? ([id, session.personal.notes?.[id]] as const)
        : noteAt(session.personal, Number(row.dataset.noteLine));
    const noteId = entry?.[0] ?? crypto.randomUUID(),
      line = entry?.[1]?.line ?? Number(row.dataset.noteLine);
    value({
      name: 'Notat',
      icon: 'notat',
      anchor,
      start: entry?.[1]?.text ?? '',
      apply: text => {
        update(state =>
          changeNote(state, noteId, {
            line,
            text,
          }),
        );
      },
      point,
    });
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
      value({
        name: 'Capo',
        icon: 'capo',
        anchor: button,
        start: String(session.personal.capo ?? 0),
        apply: text => {
          update(s => ({
            ...s,
            capo: Number(text),
          }));
        },
        numeric: {
          min: 0,
          max: 11,
        },
      });
      return;
    }
    if (name === 'tuning') {
      value({
        name: 'Stemming',
        icon: 'stemming',
        anchor: button,
        start: session.personal.tuning ?? '',
        apply: text => {
          update(s => ({
            ...s,
            tuning: text.trim(),
          }));
        },
      });
      return;
    }
    closePopup();
    setTool(tool === name ? undefined : name);
  }
  const selectable = (target: Element) => selectableAt(body, session, tool, target);
  function selectElement(target: HTMLElement) {
    const choice = choiceAt(session, target);
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
      removeChoice(session, choice, {update, original});
      paintTools();
    } catch (error) {
      toolbar.showError(error instanceof Error ? error.message : 'Kunne ikke fjerne elementet.');
    }
  }
  function moveChordTo(start: number, line: number, offset: number) {
    try {
      const moved = moveChord(session.song, start, line, offset);
      selected = {
        kind: 'chord',
        start: moved.start,
      };
      original(moved.song);
    } catch (error) {
      toolbar.showError(error instanceof Error ? error.message : 'Kunne ikke flytte akkorden.');
    }
  }
  const context: EditorContext = {
    session,
    toolbar: toolbar.element,
    tool: () => tool,
    setTool,
    selected: () => selected,
    select: selectElement,
    selectable,
    removeSelected,
    update,
    original,
    value,
    note,
    moveChord: moveChordTo,
    run,
    save: () => change(),
    showError: toolbar.showError,
  };
  /** Legger til sluttposisjonen og kobler akkordene i visningen til posisjonene deres i originalteksten. */
  function decorate(root: HTMLElement) {
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
    root.append(end);
    for (const row of root.querySelectorAll<HTMLElement>('[data-source-line]')) {
      const source = rows[Number(row.dataset.sourceLine)];
      if (!source) continue;
      const tokens = sourceChords(source);
      let n = 0;
      for (const chord of row.querySelectorAll<HTMLElement>('.chord'))
        if (chord.dataset.original) {
          const token = tokens[n++];
          if (token) {
            chord.dataset.chordStart = String(token.start);
            chord.dataset.chordOffset = String(token.offset);
          }
        }
      row.tabIndex = 0;
    }
    reflectSelection(root, session, selected);
  }
  function mount(root: HTMLElement) {
    unmount();
    body = root;
    highlighter = createHighlightEditor(
      root,
      session.song,
      () => session.personal,
      update,
      () => {
        tool = undefined;
        paintTools();
      },
      true,
    );
    const stopDrag = attachNoteDrag(
      root,
      update,
      y => nearestNoteTarget(root, y),
      node => {
        if (tool === 'note') note(node);
      },
      selectElement,
    );
    decorate(root);
    const stopDynamics = attachDynamicMarkers(root);
    const stopHeld = attachHeldElements(root, {
      resolve: selectable,
      select: selectElement,
      startDrag: (node, x, y, pointerType) =>
        startChordDrag(root, node, x, y, pointerType, (start, target) =>
          moveChordTo(start, target.line, target.offset),
        ),
    });
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (
        toolbar.element.contains(target) ||
        target.closest('[data-element-selected],.highlight-controls,.chorus-handle')
      )
        return;
      if (selected) {
        selected = undefined;
        highlighter?.clear();
        paintTools();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    if (restored) {
      const row = [...root.querySelectorAll<HTMLElement>('[data-occurrence]')].find(
        r => r.dataset.occurrence === restored!.occurrence,
      );
      if (row) highlighter.restore(row, restored.range);
      restored = undefined;
    }
    const stopInput = attachEditorInput(root, context);
    unmount = () => {
      stopInput();
      stopDrag();
      stopHeld();
      stopDynamics();
      document.removeEventListener('pointerdown', outside, true);
      highlighter?.dispose();
      highlighter = undefined;
    };
    paintTools();
    if (selected)
      root.querySelector<HTMLElement>('[data-element-selected]')?.focus({
        preventScroll: true,
      });
  }
  paintTools();
  return {
    element: toolbar.element,
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
      if (range)
        restored = {
          occurrence: line.dataset.occurrence!,
          range,
        };
    },
    dispose() {
      popup?.discard?.();
      popup?.close();
      unmount();
    },
  };
}
