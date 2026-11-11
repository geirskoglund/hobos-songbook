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
const button = actionButton;
export {iconButton} from './controls.ts';
import {actionButton, textInput, textArea, iconButton, dialogFooter, dialogFrame} from './controls.ts';
import {placeOverlay, overlayWidth, currentPage} from './layout.ts';
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
    const box = dialogFrame(title, `edit-popup popup-${kind}`);
    const heading = el('h2',title); box.append(heading);
    const content = el('div'); box.append(content);
    const draft = build(content);
    const actions=dialogFooter([{id:'cancel',label:'Avbryt',run:()=>close(),icon:'kryss'}, {id:'confirm',label:'OK',primary:true,icon:'ok',run:()=>{if(draft.apply())close();}}]);box.append(actions);
    const place=()=>placeOverlay(box,anchor,{width:overlayWidth(kind==='grid'?'grid':kind==='capo'?'value':'note'),align:kind==='grid'?'center':kind==='note'?'end':'start',height:kind==='grid'?.7:.55});
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
      const input = textArea('annotation-note',note,'Notat',2); content.append(input);
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
      const input = textInput('personal-tuning',tuning,'Stemming'); input.placeholder = 'Standard stemming'; content.append(input);
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
        const input = textArea(index ? `personal-grid-${index}` : 'personal-grid',part.body,parts.length > 1 ? `Skjematekst ${index+1}` : 'Skjematekst');
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
    if (currentPage() === 'reader' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault(); if (!document.querySelector('dialog[open]') && (session.dirty())) save();}
  }
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
    },
    metadata(root: HTMLElement) {
      const capo = button(session.personal.capo ? `Capo ${session.personal.capo}` : 'Uten capo', () => openCapo(capo)); capo.className = 'song-key'; capo.id = 'capo-pill';
      const tuning = button(session.personal.tuning || 'Standard stemming', () => openTuning(tuning)); tuning.className = 'song-key'; tuning.id = 'tuning-pill'; root.append(capo,tuning);
    },
    openGrid,
    dispose() {closePopup(); highlighter?.dispose(); disposeNoteDrag(); document.removeEventListener('keydown',keydown);
      body?.removeEventListener('focusin',focusTarget); body?.removeEventListener('pointerdown',pointerDown); body?.removeEventListener('pointermove',pointerMove); body?.removeEventListener('pointercancel',pointerCancel); body?.removeEventListener('pointerleave',clearCue); body?.removeEventListener('click',click);
    },
  };
}
