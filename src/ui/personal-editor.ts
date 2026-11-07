import {anchorFor, changeAnnotation, sharedGridText, shiftGridText, validCapo, validGrid, type Annotation, type Highlight} from '../domain/personal.ts';
import type {Song, SongPersonal} from '../domain/song.ts';

export type PersonalChange = (current: SongPersonal) => SongPersonal;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result;
};
function button(text: string, action: () => void) {
  const result = el('button', text); result.type = 'button'; result.addEventListener('click', action); return result;
}
function field(label: string, control: HTMLElement) {
  const wrap = el('label', label); wrap.append(control); return wrap;
}
export function paintAnnotations(root: HTMLElement, song: Song, personal: SongPersonal) {
  for (const line of root.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')) {
    line.querySelector('.personal-note')?.remove();
    const annotation = personal.annotations?.[line.dataset.occurrence!];
    for (const lyric of line.querySelectorAll<HTMLElement>('.lyric')) {
      const text = lyric.textContent ?? '', start = Number(lyric.dataset.offset), length = Number(lyric.dataset.length);
      lyric.replaceChildren();
      let cursor = 0;
      for (const range of [...(annotation?.anchor.original === song.original ? annotation.highlights : [])].sort((a,b) => a.start - b.start)) {
        const from = Math.max(cursor, range.start - start, 0), to = Math.min(length, range.end - start);
        if (to <= from) continue;
        lyric.append(document.createTextNode(text.slice(cursor, from)), el('mark', text.slice(from, to))); cursor = to;
      }
      lyric.append(document.createTextNode(text.slice(cursor)));
    }
    if (annotation?.note && annotation.anchor.original === song.original) {
      const note = el('aside', annotation.note); note.className = 'personal-note'; note.setAttribute('aria-label', 'Personlig notat'); if (document.body.classList.contains('editing-active')) {const remove = button('×', () => {}); remove.dataset.deleteNote = ''; remove.setAttribute('aria-label','Slett notat'); note.append(remove);} line.prepend(note);
    }
  }
}
/** Maps native selection across lyric nodes; chord labels and accessibility text never count. */
export function selectedLyricRange(line: HTMLElement): {start: number; end: number} | undefined {
  const selection = getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!line.contains(range.startContainer) || !line.contains(range.endContainer)) return;
  const offset = (node: Node, at: number) => {
    const parent = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const lyric = parent?.closest<HTMLElement>('.lyric'); if (!lyric) return null;
    const local = document.createRange(); local.selectNodeContents(lyric); local.setEnd(node, at);
    return Number(lyric.dataset.offset) + Math.min(Number(lyric.dataset.length), local.toString().length);
  };
  const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
  return start !== null && end !== null && end > start ? {start, end} : undefined;
}


/** The toolbar edits the rendered song; changes remain a draft until the user saves. */
export function createPersonalEditor(song: Song, initial: SongPersonal, change: (update: PersonalChange) => void, save: () => void) {
  let personal = structuredClone(initial), body: HTMLElement;
  let selected: {line: HTMLElement; start: number; end: number} | undefined;
  let tool: 'highlight' | 'note' | undefined;
  let popup: HTMLElement | undefined, commitPopup: (() => boolean) | undefined;
  let popupPosition: (() => void) | undefined;
  let popupObserver: ResizeObserver | undefined;
  let localDirty = false, saved = true;
  const toolbar = el('div'); toolbar.className = 'edit-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Rediger sang');
  const mode = el('span', 'Redigering'); mode.className = 'edit-mode';
  const status = el('span', 'Lagret'); status.className = 'edit-status'; status.setAttribute('role', 'status');
  const saveButton = button('Lagre', save); saveButton.id = 'edit-save';
  const setStatus = () => {status.textContent = saved && !localDirty ? 'Lagret' : 'Ulagret';};
  function update(fn: PersonalChange) {personal = fn(personal); saved = false; change(fn); setStatus();}
  function setTool(next: typeof tool) {tool = next; pen.setAttribute('aria-pressed', String(tool === 'highlight')); noteTool.setAttribute('aria-pressed', String(tool === 'note')); body?.setAttribute('data-tool', tool ?? '');}
  const pen = button('Marker', () => {
    if (selected && selected.end > selected.start) {highlight(); setTool(undefined);} else setTool(tool === 'highlight' ? undefined : 'highlight');
  }); pen.setAttribute('aria-label', 'Markeringspenn'); pen.setAttribute('aria-pressed', 'false');
  const noteTool = button('Notat', () => {if (selected) openNote(selected.line); else setTool(tool === 'note' ? undefined : 'note');}); noteTool.setAttribute('aria-pressed', 'false');
  const gridTool = button('Skjema', () => openGrid(gridTool));
  toolbar.append(mode, pen, noteTool, gridTool, status, saveButton);
  const context = el('div'); context.className = 'selection-tools'; context.hidden = true; context.setAttribute('role', 'group'); context.setAttribute('aria-label', 'Valgt tekst');
  const keepSelection = (node: HTMLElement) => node.addEventListener('pointerdown', event => {if ((event.target as Element).closest('button')) event.preventDefault();});
  keepSelection(toolbar); keepSelection(context);
  const startHandle = el('input'); startHandle.type = 'range'; startHandle.min = '0'; startHandle.setAttribute('aria-label', 'Start på markering');
  const endHandle = el('input'); endHandle.type = 'range'; endHandle.min = '0'; endHandle.setAttribute('aria-label', 'Slutt på markering');
  const handles = el('div'); handles.className = 'highlight-handles'; handles.hidden = true; handles.append(field('Fra', startHandle), field('Til', endHandle));
  let activeHighlight: Highlight | undefined;
  function closeContext() {context.hidden = true; handles.hidden = true; activeHighlight = undefined; selected = undefined; body?.querySelectorAll('.highlight-handle').forEach(node => node.remove());}
  function closePopup(apply = true): boolean {
    if (apply && commitPopup && !commitPopup()) return false;
    if (popupPosition) {window.removeEventListener('scroll',popupPosition);window.removeEventListener('resize',popupPosition);visualViewport?.removeEventListener('resize',popupPosition);}
    popupObserver?.disconnect(); popupObserver = undefined; popupPosition = undefined;
    commitPopup = undefined; popup?.remove(); popup = undefined; localDirty = false; setStatus(); return true;
  }
  function openPopup(anchor: HTMLElement, title: string) {
    if (!closePopup()) return;
    closeContext();
    const box = el('section'); box.className = 'edit-popup'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
    const heading = el('div'); heading.className = 'popup-heading'; heading.append(el('strong', title), button('×', () => closePopup()));
    heading.lastElementChild!.setAttribute('aria-label', 'Lukk verktøy'); box.append(heading);
    anchor.after(box); popup = box;
    const place = () => {
      const viewport = visualViewport, width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0, rect = anchor.getBoundingClientRect();
      const top = Math.max(y + 8, document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0);
      box.style.position = 'fixed'; box.style.width = `${Math.min(440,width - 24)}px`;
      box.style.maxHeight = `${Math.max(100,Math.min(380,height * .55))}px`;
      box.style.left = `${Math.max(x + 12,Math.min(rect.left,x + width - box.offsetWidth - 12))}px`;
      box.style.top = `${Math.max(top,Math.min(rect.bottom + 6,y + height - box.offsetHeight - 12))}px`;
    };
    popupPosition = place; popupObserver = new ResizeObserver(place); popupObserver.observe(box);
    window.addEventListener('scroll',place,{passive:true});window.addEventListener('resize',place);visualViewport?.addEventListener('resize',place);
    place(); box.addEventListener('pointerdown',event => event.stopPropagation()); return box;
  }

  function lyricText(line: HTMLElement) {return [...line.querySelectorAll<HTMLElement>('.lyric')].map(node => (node.textContent ?? '').slice(0, Number(node.dataset.length))).join('');}
  function anchor(line: HTMLElement) {return anchorFor(song, Number(line.dataset.sourceLine), line.dataset.occurrence!, lyricText(line));}
  function annotation(line: HTMLElement): Annotation {return personal.annotations?.[line.dataset.occurrence!] ?? {anchor: anchor(line), note:'', highlights:[]};}
  function annotate(line: HTMLElement, patch: Partial<Pick<Annotation, 'note' | 'highlights'>>) {
    const reference = anchor(line); update(current => changeAnnotation(current, reference, patch)); paintAnnotations(body, song, personal);
  }
  function showContext(line: HTMLElement, start: number, end: number, existing?: Highlight) {
    if (popup?.contains(document.activeElement)) return;
    selected = {line, start, end}; activeHighlight = existing;
    context.hidden = false; handles.hidden = !existing; if (context.parentElement !== line) line.append(context);
    const length = lyricText(line).length;
    for (const input of [startHandle, endHandle]) input.max = String(length);
    startHandle.value = String(start); endHandle.value = String(end);
    drawHandles();
  }
  function drawHandles() {
    body.querySelectorAll('.highlight-handle').forEach(node => node.remove());
    if (!selected || !activeHighlight) return;
    const range = activeHighlight;
    const marks = [...selected.line.querySelectorAll<HTMLElement>('.lyric mark')].filter(mark => {
      const lyric = mark.closest<HTMLElement>('.lyric')!;
      const before = document.createRange(); before.selectNodeContents(lyric); before.setEndBefore(mark);
      const at = Number(lyric.dataset.offset) + before.toString().length;
      return at >= range.start && at < range.end;
    });
    for (const [edge, mark] of [['start',marks[0]],['end',marks.at(-1)]] as const) {
      if (!mark) continue;
      const handle = el('span'); handle.className = `highlight-handle handle-${edge}`; handle.dataset.edge = edge;
      handle.setAttribute('role','slider'); handle.tabIndex = 0;
      handle.setAttribute('aria-label',edge === 'start' ? 'Dra starten på markeringen' : 'Dra slutten på markeringen');
      handle.setAttribute('aria-valuemin','0'); handle.setAttribute('aria-valuemax',String(lyricText(selected.line).length));
      handle.setAttribute('aria-valuenow',String(range[edge])); mark.append(handle);
    }
  }
  let draggedEdge: 'start' | 'end' | undefined;
  function beginDrag(event: PointerEvent) {
    const handle = (event.target as Element).closest<HTMLElement>('.highlight-handle');
    if (!handle) return;
    event.preventDefault(); event.stopPropagation(); draggedEdge = handle.dataset.edge as 'start' | 'end';
  }
  function moveHandle(event: PointerEvent) {
    if (!draggedEdge || !selected || !activeHighlight) return;
    event.preventDefault();
    const doc = document as Document & {caretPositionFromPoint?: (x:number,y:number) => {offsetNode:Node;offset:number} | null; caretRangeFromPoint?: (x:number,y:number) => Range | null};
    const position = doc.caretPositionFromPoint?.(event.clientX,event.clientY), range = doc.caretRangeFromPoint?.(event.clientX,event.clientY);
    const node = position?.offsetNode ?? range?.startContainer, offset = position?.offset ?? range?.startOffset;
    if (!node || offset === undefined) return;
    const lyric = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>('.lyric');
    if (!lyric || !selected.line.contains(lyric)) return;
    const prefix = document.createRange(); prefix.selectNodeContents(lyric); prefix.setEnd(node,offset);
    const at = Number(lyric.dataset.offset) + Math.min(Number(lyric.dataset.length),prefix.toString().length);
    const input = draggedEdge === 'start' ? startHandle : endHandle; input.value = String(at); resizeHighlight();
  }
  function endDrag() {draggedEdge = undefined;}
  function highlight() {
    if (!selected || selected.end <= selected.start) return;
    const {line, start, end} = selected;
    const ranges = [...annotation(line).highlights, {start, end}].sort((a,b) => a.start - b.start);
    const merged: Highlight[] = [];
    for (const range of ranges) {const last = merged.at(-1); if (last && last.end >= range.start) last.end = Math.max(last.end, range.end); else merged.push({...range});}
    annotate(line, {highlights: merged}); closeContext(); getSelection()?.removeAllRanges();
  }
  function removeHighlight() {
    if (!selected) return;
    const {line, start, end} = selected;
    const highlights = annotation(line).highlights.flatMap(range => range.end <= start || range.start >= end ? [range] : [
      ...(range.start < start ? [{start:range.start, end:start}] : []), ...(range.end > end ? [{start:end, end:range.end}] : []),
    ]);
    annotate(line, {highlights}); closeContext();
  }
  function resizeHighlight() {
    if (!selected || !activeHighlight) return;
    const start = Number(startHandle.value), end = Number(endHandle.value); if (start >= end) return;
    const previous = activeHighlight, next = {start, end};
    annotate(selected.line, {highlights: annotation(selected.line).highlights.map(range => range.start === previous.start && range.end === previous.end ? next : range)});
    activeHighlight = next; selected.start = start; selected.end = end; drawHandles();
  }
  startHandle.addEventListener('input', resizeHighlight); endHandle.addEventListener('input', resizeHighlight);
  context.append(button('Gulmarker', highlight), button('Notat', () => {if (selected) openNote(selected.line);}),
    button('Hele linjen', () => {if (selected) {selected.start = 0; selected.end = lyricText(selected.line).length; highlight();}}),
    button('Fjern markering', removeHighlight), button('×', closeContext), handles);
  context.querySelector('button:last-of-type')!.setAttribute('aria-label', 'Lukk tekstverktøy');
  function openNote(line: HTMLElement) {
    closeContext(); setTool(undefined);
    const box = openPopup(line, 'Personlig notat'); if (!box) return;
    const input = el('textarea'); input.id = 'annotation-note'; input.rows = 2; input.value = annotation(line).note; input.setAttribute('aria-label', 'Notat');
    input.addEventListener('input', () => {annotate(line, {note: input.value});});
    box.append(input, button('Slett notat', () => {annotate(line, {note:''}); closePopup(false);})); input.focus({preventScroll:true});
  }
  function openCapo(anchorNode: HTMLElement) {
    const box = openPopup(anchorNode, 'Capo og akkordvisning'); if (!box) return;
    const input = el('input'); input.type = 'number'; input.id = 'personal-capo'; input.min = '0'; input.max = '12'; input.step = '1'; input.value = String(personal.capo ?? 0);
    input.addEventListener('input', () => {
      const value = input.valueAsNumber; input.setCustomValidity(validCapo(value) ? '' : 'Bruk et heltall fra 0 til 12.');
      localDirty = !input.checkValidity(); if (!localDirty) update(current => ({...current, capo:value})); setStatus();
    });
    box.append(field('Capo', input));
    const group = el('fieldset'); group.append(el('legend', 'Vis akkorder for'));
    for (const [value, text] of [['grips','Min capo'], ['sounding','Ingen capo']]) {
      const radio = el('input'); radio.type = 'radio'; radio.name = 'chord-view'; radio.value = value; radio.checked = (personal.chordView ?? 'grips') === value;
      radio.addEventListener('change', () => update(current => ({...current, chordView: value as 'grips' | 'sounding'})));
      group.append(field(text, radio));
    }
    box.append(group); input.focus({preventScroll:true});
    commitPopup = () => input.reportValidity();
  }
  function openTuning(anchorNode: HTMLElement) {
    const box = openPopup(anchorNode, 'Stemming'); if (!box) return;
    const input = el('input'); input.id = 'personal-tuning'; input.value = personal.tuning ?? ''; input.placeholder = 'Standard'; input.setAttribute('aria-label', 'Stemming');
    input.addEventListener('input', () => {const value = input.value; update(current => ({...current, tuning:value}));}); box.append(input); input.focus({preventScroll:true});
  }
  function openGrid(anchorNode: HTMLElement) {
    const box = openPopup(anchorNode, 'Personlig akkordskjema'); if (!box) return;
    let inputCapo = personal.capo ?? 0, raw = false;
    let source = personal.chordGrid ?? (sharedGridText(song.original) || '{sog}\n| . . . . |\n{eog}');
    const capoGroup = el('fieldset'); capoGroup.append(el('legend', 'Dette skjemaet er skrevet for'));
    const radios: HTMLInputElement[] = [];
    for (const value of [...new Set([0, personal.capo ?? 0])]) {
      const radio = el('input'); radio.type = 'radio'; radio.name = 'grid-capo'; radio.value = String(value); radio.checked = value === inputCapo; radios.push(radio);
      capoGroup.append(field(value ? `Capo ${value}` : 'Ingen capo', radio));
    }
    box.append(capoGroup);
    const rawButton = button('Vis råtekst', () => {
      const next = readSource(); if (!next) return; source = next; raw = !raw; draw();
    }); rawButton.setAttribute('aria-pressed','false'); box.append(rawButton);
    const fields = el('div'); box.append(fields);
    let inputs: HTMLTextAreaElement[] = [], parts: {header:string; body:string; footer:string}[] = [];
    function draw() {
      fields.replaceChildren(); inputs = []; parts = [];
      const shown = shiftGridText(source, -inputCapo);
      if (raw) parts = [{header:'', body:shown, footer:''}];
      else {
        parts = [...shown.matchAll(/(^\s*\{(?:sog|start_of_grid)[^\r\n]*\}\s*\r?\n)([\s\S]*?)(^\s*\{(?:eog|end_of_grid)\}[^\r\n]*)/gmi)].map(match => ({header:match[1],body:match[2].replace(/\r?\n$/, ''),footer:match[3]}));
        if (!parts.length) parts = [{header:'{sog}\n',body:shown,footer:'{eog}'}];
      }
      parts.forEach((part,index) => {
        const input = el('textarea'); input.rows = 4; input.value = part.body; input.setAttribute('aria-label', parts.length > 1 ? `Skjematekst ${index+1}` : 'Skjematekst');
        if (!index) input.id = 'personal-grid';
        input.addEventListener('input', () => {localDirty = true; input.setCustomValidity(''); setStatus();}); inputs.push(input); fields.append(input);
      });
      rawButton.textContent = raw ? 'Skjul råtekst' : 'Vis råtekst'; rawButton.setAttribute('aria-pressed',String(raw));
    }
    function readSource(): string | undefined {
      const text = parts.map((part,index) => raw ? inputs[index].value : part.header + inputs[index].value + '\n' + part.footer).join('\n');
      const valid = validGrid(text); inputs[0].setCustomValidity(valid ? '' : 'Skriv et skjema med taktstreker, eller fjern det personlige skjemaet.');
      if (!inputs[0].reportValidity()) return;
      return shiftGridText(text, inputCapo);
    }
    for (const radio of radios) radio.addEventListener('change', () => {const next = readSource(); if (!next) {radios.forEach(r => r.checked = Number(r.value) === inputCapo); return;} source = next; inputCapo = Number(radio.value); draw();});
    draw();
    commitPopup = () => {const next = readSource(); if (!next) return false; if (localDirty) update(current => ({...current,chordGrid:next})); return true;};
    box.append(button('Bruk skjema', () => {localDirty = true; closePopup();}), button('Fjern personlig skjema', () => {update(current => ({...current,chordGrid:undefined})); closePopup(false);}));
    inputs[0]?.focus({preventScroll:true});
  }
  function captureSelection() {
    if (!body) return;
    if (draggedEdge) return;
    const selection = getSelection(); if (!selection?.anchorNode) return;
    const parent = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode as Element : selection.anchorNode.parentElement;
    const line = parent?.closest<HTMLElement>('.song-line'); if (!line || !body.contains(line)) return;
    const range = selectedLyricRange(line); if (!range) return;
    showContext(line, range.start, range.end);
  }
  function click(event: Event) {
    const target = event.target as Element;
    const remove = target.closest('[data-delete-note]');
    if (remove) {const line = remove.closest<HTMLElement>('.song-line'); if (line) annotate(line,{note:''}); return;}
    if (target.closest('.highlight-handle,.selection-tools,.edit-popup,button,a,input,textarea')) return;
    const line = target.closest<HTMLElement>('.song-line');
    if (!line) return;
    if (tool === 'note' || target.closest('.personal-note')) {openNote(line); return;}
    if (target.closest('mark')) {
      const lyric = target.closest<HTMLElement>('.lyric')!;
      const mark = target.closest('mark')!;
      const before = document.createRange(); before.selectNodeContents(lyric); before.setEndBefore(mark);
      const at = Number(lyric.dataset.offset) + before.toString().length;
      const range = annotation(line).highlights.find(range => at >= range.start && at < range.end);
      if (range) showContext(line, range.start, range.end, range);
    }
  }
  function pointerUp(event: PointerEvent) {if (draggedEdge || (event.target as Element).closest('.selection-tools,.edit-popup,.highlight-handle,button,input,textarea')) return; captureSelection(); if (tool === 'highlight' && selected && getSelection()?.isCollapsed === false) highlight();}
  function outside(event: Event) {
    const target = event.target as Node;
    if (popup && !popup.contains(target) && !toolbar.contains(target) && !(target as Element).closest?.('.song-key,#chart-dock,.grid-placeholder')) closePopup();
    if (!context.contains(target) && !toolbar.contains(target) && !(target as Element).closest?.('.song-line')) {closeContext(); selected = undefined;}
  }
  function keydown(event: KeyboardEvent) {
    const handle = (event.target as Element).closest<HTMLElement>('.highlight-handle');
    if (handle && selected && activeHighlight && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault(); const edge = handle.dataset.edge as 'start' | 'end';
      const current = activeHighlight[edge], length = lyricText(selected.line).length;
      const value = event.key === 'Home' ? 0 : event.key === 'End' ? length : current + (event.key === 'ArrowRight' ? 1 : -1);
      (edge === 'start' ? startHandle : endHandle).value = String(Math.max(0,Math.min(length,value)));
      resizeHighlight(); selected.line.querySelector<HTMLElement>(`.handle-${edge}`)?.focus({preventScroll:true});
      return;
    }
    if (event.key === 'Escape') {if (popup || !context.hidden || tool) {event.preventDefault(); closePopup(); closeContext(); setTool(undefined);}}
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault(); save();}
  }
  let observer: ResizeObserver | undefined;
  return {
    element: toolbar,
    dirty: () => !saved || localDirty,
    markSaved() {saved = true; localDirty = false; setStatus();},
    isValid: () => closePopup(),
    selection: () => selected ? {occurrence:selected.line.dataset.occurrence!,start:selected.start,end:selected.end} : undefined,
    select(line: HTMLElement, _state: SongPersonal, range?: {start:number;end:number}) {if (range) showContext(line,range.start,range.end);},
    mount(lyrics: HTMLElement) {
      body = lyrics;
      body.addEventListener('pointerdown',beginDrag); document.addEventListener('pointermove',moveHandle,{passive:false}); document.addEventListener('pointerup',endDrag);
      body.addEventListener('pointerup',pointerUp); body.addEventListener('keyup',captureSelection); body.addEventListener('click',click);
      document.addEventListener('selectionchange',captureSelection); document.addEventListener('pointerdown',outside); document.addEventListener('keydown',keydown);
      observer = new ResizeObserver(() => document.documentElement.style.setProperty('--edit-toolbar-height',`${toolbar.offsetHeight}px`)); observer.observe(toolbar);
    },
    metadata(root: HTMLElement) {
      const capo = button(`Capo ${personal.capo ?? 0}`, () => openCapo(capo)); capo.className = 'song-key'; capo.id = 'capo-pill';
      const tuning = button(personal.tuning || 'Stemming', () => openTuning(tuning)); tuning.className = 'song-key'; tuning.id = 'tuning-pill'; root.append(capo,tuning);
    },
    openGrid,
    dispose() {closePopup(false); context.remove(); observer?.disconnect(); document.documentElement.style.removeProperty('--edit-toolbar-height');
      document.removeEventListener('selectionchange',captureSelection); document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',keydown);
      body?.removeEventListener('pointerdown',beginDrag); document.removeEventListener('pointermove',moveHandle); document.removeEventListener('pointerup',endDrag);
      body?.removeEventListener('pointerup',pointerUp); body?.removeEventListener('keyup',captureSelection); body?.removeEventListener('click',click);
    },
  };
}
