import {openDialog} from './dialog.ts';
import {createHighlightEditor, nativeLyricSpans} from './highlight-editor.ts';
import {attachNoteDrag} from './note-drag.ts';
import {sharedGridText, shiftGridText, validCapo, validGrid, type Highlight} from '../domain/personal.ts';
import {changeNote, noteAt} from '../domain/annotations.ts';
import type {EditSession} from '../domain/edit-session.ts';
import type {Song, SongPersonal} from '../domain/song.ts';

export type PersonalChange = (current: SongPersonal) => SongPersonal;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result;
};
function button(text: string, action: () => void) {
  const result = el('button', text); result.type = 'button'; result.addEventListener('click', action); return result;
}
const icons = {
  save: 'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
  highlight: 'm15 3 6 6-9 9-6-6zM6 12l-3 6 3 3 6-3M3 22h12',
  note: 'M4 3h16v13l-5 5H4zM15 21v-6h5M8 8h8M8 12h5',
  grid: 'M3 5h18v14H3zM3 10h18M9 5v14M15 5v14',
  text: 'M4 3h11l5 5v5M14 3v6h6M4 3v18h6M8 8h3M8 12h5m1 7 6-6 2 2-6 6-3 1z',
};
export function iconButton(name: string, icon: keyof typeof icons, action: () => void) {
  const result = button('', action); result.setAttribute('aria-label', name); result.dataset.tooltip = name;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', icons[icon]); svg.append(path); result.append(svg); return result;
}
export {paintAnnotations} from './annotations.ts';
function fieldError(control: HTMLInputElement | HTMLTextAreaElement, message = '') {
  const id=control.id+'-error'; document.getElementById(id)?.remove();
  control.removeAttribute('aria-invalid');control.removeAttribute('aria-describedby');
  if(!message)return true;
  const error=el('p',message);error.id=id;error.className='field-error';error.setAttribute('role','alert');control.after(error);
  control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',id);control.focus({preventScroll:true});return false;
}
/** Only OK changes the song draft; only Save writes that draft to storage. */
export function createPersonalEditor(song: Song, session: EditSession, change: () => void, save: () => void) {
  let body: HTMLElement;
  let highlighter: ReturnType<typeof createHighlightEditor> | undefined, disposeNoteDrag = () => {};
  let restored: {line: HTMLElement; range: Highlight} | undefined;
  let tool: 'highlight' | 'note' | undefined;
  let popup: {box: HTMLDialogElement; dirty: () => boolean; close: () => void} | undefined;
  const toolbar = el('div'); toolbar.className = 'edit-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Rediger sang');
  const saveButton = iconButton('Lagre', 'save', save); saveButton.id = 'edit-save';
  const setStatus = () => {saveButton.disabled = !session.dirty();};
  function update(fn: PersonalChange) {session.update(fn); change(); setStatus();}
  function clearCue() {body?.querySelector('[data-note-target]')?.removeAttribute('data-note-target');}
  function setTool(next: typeof tool) {tool = next; clearCue();
    body?.querySelectorAll<HTMLElement>('[data-note-line]').forEach(row => {if (tool === 'note') row.tabIndex = 0; else row.removeAttribute('tabindex');}); pen.setAttribute('aria-pressed', String(tool === 'highlight')); noteTool.setAttribute('aria-pressed', String(tool === 'note')); body?.setAttribute('data-tool', tool ?? ''); highlighter?.setActive(tool === 'highlight');}
  const pen = iconButton('Markeringspenn', 'highlight', () => {
    if (highlighter?.applyNative()) setTool(undefined); else {highlighter?.clear(); setTool(tool === 'highlight' ? undefined : 'highlight');}
  }); pen.setAttribute('aria-pressed', 'false');
  const noteTool = iconButton('Notat', 'note', () => {
    const range = highlighter?.pending()[0] ?? (body ? nativeLyricSpans(body)[0] : undefined); if (range) openNote(range.line); else {highlighter?.clear(); setTool(tool === 'note' ? undefined : 'note');}
  }); noteTool.setAttribute('aria-pressed', 'false');
  const gridTool = iconButton('Akkordskjema', 'grid', () => openGrid(gridTool));
  toolbar.append(saveButton, pen, noteTool, gridTool); setStatus();
  // Prevent toolbar focus from destroying the native selection before its action reads it.
  toolbar.addEventListener('pointerdown', event => {if ((event.target as Element).closest('button')) event.preventDefault();});
  function closePopup() {popup?.close();}
  function openPopup(anchor: HTMLElement, title: string, kind: string, build: (content: HTMLElement) => {apply: () => boolean; dirty: () => boolean; focus: HTMLElement}) {
    closePopup(); highlighter?.clear(); setTool(undefined);
    const box = el('dialog'); box.className = `edit-popup popup-${kind}`; box.setAttribute('aria-label', title);
    const heading = el('h2',title); box.append(heading);
    const content = el('div'); box.append(content);
    const draft = build(content);
    const actions = el('div'); actions.className = 'popup-actions';
    const cancel = button('Avbryt', () => close()), ok = button('OK', () => {if (draft.apply()) close();}); actions.append(cancel, ok); box.append(actions);
    const place = () => {
      const viewport = visualViewport, width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0, rect = anchor.getBoundingClientRect();
      const gutter = width < 600 ? 12 : 24;
      box.style.width = `${Math.min(kind === 'grid' ? 1000 : kind === 'capo' ? 220 : 360, width - 2*gutter)}px`;
      box.style.maxHeight = `${Math.max(120,height * (kind === 'grid' ? .7 : .55))}px`;
      const left = kind === 'grid' ? x + (width-box.offsetWidth)/2 : kind === 'note' ? rect.right-box.offsetWidth : rect.left;
      box.style.left = `${Math.max(x+gutter,Math.min(left,x+width-box.offsetWidth-gutter))}px`;
      box.style.top = `${Math.max(y+12,Math.min(rect.bottom+8,y+height-box.offsetHeight-12))}px`;
    };
    const lifecycle = openDialog(box, {opener:anchor, focus:draft.focus, place, outside:true, closed:()=>{popup=undefined;}});
    const close = lifecycle.close;
    popup = {box, dirty:draft.dirty, close};
  }
  function openNote(target: HTMLElement) {
    const row = target.closest<HTMLElement>('[data-note-line]');
    if (!row) return;
    const element = target.closest<HTMLElement>('.personal-note') ?? row.querySelector<HTMLElement>('.personal-note');
    const line = Number(row.dataset.noteLine), existing = element?.dataset.noteId
      ? [element.dataset.noteId, session.personal.notes?.[element.dataset.noteId]] as const : noteAt(session.personal, line);
    const id = existing?.[0] ?? crypto.randomUUID(), note = existing?.[1]?.text ?? '';
    openPopup(row,'Notat','note', content => {
      const input = el('textarea'); input.id = 'annotation-note'; input.rows = 2; input.value = note; input.setAttribute('aria-label','Notat'); content.append(input);
      return {apply:() => {if (input.value !== note) update(current => changeNote(current,id,{line:existing?.[1]?.line ?? line,text:input.value})); return true;},dirty:() => input.value !== note,focus:input};
    });
  }
  function openCapo(anchorNode: HTMLElement) {
    const capo = session.personal.capo ?? 0;
    openPopup(anchorNode,'Capo','capo', content => {
      let value = validCapo(capo) ? capo : 0;
      const control = el('div'); control.className = 'capo-control';
      const number = el('span'); number.id = 'personal-capo'; number.tabIndex = 0;
      number.setAttribute('role','spinbutton'); number.setAttribute('aria-label','Capo'); number.setAttribute('aria-valuemin','0'); number.setAttribute('aria-valuemax','11'); number.setAttribute('aria-live','polite');
      const less = button('<', () => setValue(value-1)), more = button('>', () => setValue(value+1));
      less.setAttribute('aria-label','Reduser capo'); more.setAttribute('aria-label','Øk capo');
      function setValue(next: number) {
        if (!validCapo(next)) return;
        value = next; number.textContent = String(value); number.setAttribute('aria-valuenow',String(value)); less.disabled = value === 0; more.disabled = value === 11;
      }
      control.addEventListener('keydown', event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 11 : ['ArrowRight','ArrowUp'].includes(event.key) ? value+1 : ['ArrowLeft','ArrowDown'].includes(event.key) ? value-1 : undefined;
        if (next !== undefined) {event.preventDefault(); setValue(next);}
      });
      control.append(less,number,more); content.append(control); setValue(value);
      return {apply:() => {if (value !== capo) update(current => ({...current,capo:value})); return true;},dirty:() => value !== capo,focus:number};
    });
  }
  function openTuning(anchorNode: HTMLElement) {
    const tuning = session.personal.tuning ?? '';
    openPopup(anchorNode,'Stemming','tuning', content => {
      const input = el('input'); input.id = 'personal-tuning'; input.value = tuning; input.placeholder = 'Standard stemming'; input.setAttribute('aria-label','Stemming'); content.append(input);
      return {apply:() => {const value = input.value.trim(); if (value !== tuning) update(current => ({...current,tuning:value})); return true;},dirty:() => input.value !== tuning,focus:input};
    });
  }
  function openGrid(anchorNode: HTMLElement) {
    const capo = session.personal.capo ?? 0, source = session.personal.chordGrid || sharedGridText(song.original);
    openPopup(anchorNode,`Akkordskjema${capo ? `, capo ${capo}` : ''}`,'grid', content => {
      const shown = shiftGridText(source,-capo);
      let parts = [...shown.matchAll(/(^\s*\{(?:sog|start_of_grid)[^\r\n]*\}\s*\r?\n)([\s\S]*?)(^\s*\{(?:eog|end_of_grid)\}[^\r\n]*)/gmi)].map(match => ({header:match[1],body:match[2].replace(/\r?\n$/, ''),footer:match[3]}));
      if (!parts.length) parts = [{header:'{sog}\n',body:shown,footer:'{eog}'}];
      const inputs = parts.map((part,index) => {
        const input = el('textarea'); input.rows = 5; input.value = part.body; input.setAttribute('aria-label',parts.length > 1 ? `Skjematekst ${index+1}` : 'Skjematekst'); if (!index) input.id = 'personal-grid';
        input.addEventListener('input', () => fieldError(input)); content.append(input); return input;
      });
      const dirty = () => inputs.some((input,index) => input.value !== parts[index].body);
      return {dirty,focus:inputs[0],apply:() => {
        if (!dirty()) return true;
        const nonempty = parts.map((part,index) => ({...part,body:inputs[index].value})).filter(part => part.body.trim());
        const text = nonempty.map(part => part.header+part.body+'\n'+part.footer).join('\n');
        if (!fieldError(inputs[0],!text || validGrid(text) ? '' : 'Skriv et skjema med taktstreker.')) return false;
        const chordGrid = text ? shiftGridText(text,capo) : undefined; update(current => ({...current,chordGrid})); return true;
      }};
    });
  }
  function noteTarget(y: number) {
    const rows = [...body.querySelectorAll<HTMLElement>('[data-note-line]')].filter(row => row.getClientRects().length && !row.closest('[hidden]'));
    return rows.reduce<HTMLElement | undefined>((best,row) => {
      const distance = (node: HTMLElement) => {const rect = node.getBoundingClientRect(); return y<rect.top ? rect.top-y : y>rect.bottom ? y-rect.bottom : 0;};
      return !best || distance(row)<distance(best) ? row : best;
    },undefined);
  }
  let cancelled = false;
  let gesture: {x:number;y:number;scroll:number;moved:boolean} | undefined;
  function pointerDown(event: PointerEvent) {cancelled = false; if (tool === 'note' && !(event.target as Element).closest('button,.personal-note')) {event.preventDefault();getSelection()?.removeAllRanges();} gesture = {x:event.clientX,y:event.clientY,scroll:scrollY,moved:false};}
  function pointerMove(event: PointerEvent) {
    if (gesture && Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>8) gesture.moved = true;
    if (tool === 'note' && !popup && !body.hasAttribute('data-note-moving')) {clearCue(); noteTarget(event.clientY)?.setAttribute('data-note-target','');}
  }
  function focusTarget(event: FocusEvent) {if (tool === 'note') {clearCue(); (event.target as Element).closest('[data-note-line]')?.setAttribute('data-note-target','');}}
  function pointerCancel() {cancelled = true; gesture = undefined; clearCue();}
  function click(event: MouseEvent) {
    const target = event.target as Element;
    if (cancelled && event.detail) return;
    if (gesture && (gesture.moved || Math.abs(scrollY-gesture.scroll)>2)) {gesture = undefined; return;} gesture = undefined;
    const line = target.closest<HTMLElement>('[data-note-line]');
    if (target.closest('[data-delete-note]')) {const id=target.closest<HTMLElement>('[data-note-id]')?.dataset.noteId;if(id)update(current=>changeNote(current,id,undefined));return;}
    if (target.closest('button,a,input,textarea,.highlight-controls')) return;
    if (tool !== 'note' && (highlighter?.pending().length || nativeLyricSpans(body).length)) return;
    if (target.closest('.personal-note')) {openNote(target as HTMLElement); return;}
    if (tool === 'note') {const row = line ?? noteTarget(event.clientY); if (row) openNote(row); return;}
  }
  function keydown(event: KeyboardEvent) {
    if ((event.key === 'Enter' || event.key === ' ') && ((event.target as Element).matches('.personal-note') || tool === 'note' && (event.target as Element).matches('[data-note-line]'))) {event.preventDefault(); openNote(event.target as HTMLElement);}
    if (event.key === 'Escape' && !popup) {highlighter?.clear(); setTool(undefined);}
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault(); if (!document.querySelector('dialog[open]') && (session.dirty())) save();}
  }
  let observer: ResizeObserver | undefined;
  return {
    element:toolbar,
    dirty:() => Boolean(session.dirty() || popup?.dirty()),
    snapshot:() => session.snapshot().personal,
    pendingChange:session.pendingChange,
    markSaved:setStatus,
    isValid:() => !popup,
    selection:() => highlighter?.selection(),
    select(line: HTMLElement, _state: SongPersonal, range?: Highlight) {if (range) restored = {line,range};},
    mount(lyrics: HTMLElement) {
      body = lyrics; highlighter = createHighlightEditor(body,song,()=>session.personal,update,()=>setTool(undefined)); if (restored) highlighter.restore(restored.line,restored.range);
      disposeNoteDrag = attachNoteDrag(body,update,noteTarget,openNote);  body.addEventListener('focusin',focusTarget); body.addEventListener('pointerdown',pointerDown); body.addEventListener('pointermove',pointerMove); body.addEventListener('pointercancel',pointerCancel); body.addEventListener('pointerleave',clearCue); body.addEventListener('click',click);
      document.addEventListener('keydown',keydown);
      observer = new ResizeObserver(() => {document.documentElement.style.setProperty('--edit-toolbar-height',`${toolbar.offsetHeight}px`);}); observer.observe(toolbar); observer.observe(body);
    },
    metadata(root: HTMLElement) {
      const capo = button(session.personal.capo ? `Capo ${session.personal.capo}` : 'Uten capo', () => openCapo(capo)); capo.className = 'song-key'; capo.id = 'capo-pill';
      const tuning = button(session.personal.tuning || 'Standard stemming', () => openTuning(tuning)); tuning.className = 'song-key'; tuning.id = 'tuning-pill'; root.append(capo,tuning);
    },
    openGrid,
    dispose() {closePopup(); observer?.disconnect(); highlighter?.dispose(); disposeNoteDrag(); document.documentElement.style.removeProperty('--edit-toolbar-height'); document.removeEventListener('keydown',keydown);
      body?.removeEventListener('focusin',focusTarget); body?.removeEventListener('pointerdown',pointerDown); body?.removeEventListener('pointermove',pointerMove); body?.removeEventListener('pointercancel',pointerCancel); body?.removeEventListener('pointerleave',clearCue); body?.removeEventListener('click',click);
    },
  };
}
