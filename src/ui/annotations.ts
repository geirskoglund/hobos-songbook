import {logicalLines, notePlacements} from '../domain/annotations.ts';
import type {Song, SongPersonal} from '../domain/song.ts';

/** Rendering never decides whether a saved note is still valid. Every note gets a visible placement. */
export function paintAnnotations(root: HTMLElement, song: Song, personal: SongPersonal) {
  root.querySelectorAll('.personal-note,.note-overflow').forEach(node => node.remove());
  const lines = logicalLines(song), rows = [...root.querySelectorAll<HTMLElement>('[data-occurrence]')];
  for (const row of rows) {
    const index = lines.findIndex(line => line.occurrence === row.dataset.occurrence);
    if (index >= 0) row.dataset.noteLine = String(index);
    const annotation = personal.annotations?.[row.dataset.occurrence!];
    for (const lyric of row.querySelectorAll<HTMLElement>('.lyric')) {
      const text = lyric.textContent ?? '', start = Number(lyric.dataset.offset), length = Number(lyric.dataset.length);
      lyric.replaceChildren();let cursor = 0;
      for (const range of [...(annotation?.highlights ?? [])].sort((a, b) => a.start - b.start)) {
        const from = Math.max(cursor, range.start - start, 0), to = Math.min(length, range.end - start);
        if (to <= from) continue;
        const mark = document.createElement('mark');mark.textContent = text.slice(from, to);
        lyric.append(document.createTextNode(text.slice(cursor, from)), mark);cursor = to;
      }
      lyric.append(document.createTextNode(text.slice(cursor)));
    }
  }
  const available = rows.filter(row => !row.closest('.chorus-text[hidden]') && row.dataset.noteLine !== undefined);
  const meaningful = available.some(row => lines[Number(row.dataset.noteLine)]?.text.trim());
  const overflow = document.createElement('div');overflow.className = 'note-overflow';
  let extra = lines.length;
  for (const placement of notePlacements(personal, meaningful ? available.map(row => Number(row.dataset.noteLine)) : [])) {
    let row = placement.line === undefined ? undefined : available.find(row => Number(row.dataset.noteLine) === placement.line);
    if (!row) {row = document.createElement('div');row.className = 'note-overflow-row';row.dataset.noteLine = String(extra++);overflow.append(row);}
    const note = document.createElement('aside');note.className = 'personal-note';note.dataset.noteId = placement.id;note.textContent = placement.note.text;note.setAttribute('aria-label', 'Personlig notat');
    if (document.body.classList.contains('editing-active')) {
      note.tabIndex = 0;note.dataset.tooltip = 'Hold inne for å velge, dra videre for å flytte. Alt+pil opp/ned på tastatur.';
    }
    row.prepend(note);
  }
  if (overflow.childElementCount) root.append(overflow);
}

/** Connect to measured text, independently of viewport wraps and the note's own height. */
export function attachAnnotationGeometry(root:HTMLElement){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('annotation-connectors');svg.setAttribute('aria-hidden','true');root.append(svg);
  let frame=0,disposed=false,drag:{ghost:HTMLElement;target?:HTMLElement}|undefined;
  const draw=()=>{frame=0;if(disposed)return;const origin=root.getBoundingClientRect();let previousBottom=origin.top;
    for(const note of root.querySelectorAll<HTMLElement>('.personal-note')){const row=note.parentElement!,bounds=row.getBoundingClientRect(),top=Math.max(bounds.top,previousBottom);note.style.top=`${top-bounds.top}px`;previousBottom=top+note.offsetHeight+8;}
    const contentBottom=Math.max(origin.top,...[...root.querySelectorAll<HTMLElement>('.song-line,.comment,.unknown,.chorus > h2,.song-end,.note-overflow-row')].filter(row=>!row.closest('[hidden]')).map(row=>row.getBoundingClientRect().bottom));
    root.style.setProperty('--note-extra',`${Math.max(0,previousBottom-contentBottom)}px`);
    svg.setAttribute('width',String(root.clientWidth));svg.setAttribute('height',String(Math.max(root.clientHeight,previousBottom-origin.top)));svg.replaceChildren();
    for(const note of root.querySelectorAll<HTMLElement>('.personal-note')){
      const moving=note.hasAttribute('data-moving')&&drag;
      const row=moving&&moving.target?moving.target:note.parentElement!;if(row.closest('[hidden]'))continue;const bounds=(moving?moving.ghost:note).getBoundingClientRect();
      const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT,{acceptNode(node){return node.textContent?.trim()&&!node.parentElement?.closest('.personal-note,button,.sr-only,.annotation-connectors')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
      let last:Node|undefined,node:Node|null;while((node=walker.nextNode()))last=node;
      const rowBounds=row.getBoundingClientRect();let x=rowBounds.left,y1=rowBounds.top+Math.min(rowBounds.height,parseFloat(getComputedStyle(root).lineHeight)||24)/2;
      if(last&&!moving){const value=last.textContent??'',end=value.trimEnd().length,range=document.createRange();range.setStart(last,Math.max(0,end-1));range.setEnd(last,end);const textBounds=range.getBoundingClientRect();x=textBounds.right;y1=textBounds.top+textBounds.height/2;}
      const endpoint=x<=bounds.left?bounds.left:bounds.right;
      const line=document.createElementNS(ns,'line'),y=bounds.top+bounds.height/2-origin.top;
      line.dataset.noteConnection=note.dataset.noteId;if(moving)line.dataset.dragging='true';
      line.setAttribute('x1',String(x-origin.left));line.setAttribute('x2',String(endpoint-origin.left));line.setAttribute('y1',String(y1-origin.top));line.setAttribute('y2',String(y));svg.append(line);
    }
  };
  const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(draw);};
  const moved=(event:Event)=>{drag=(event as CustomEvent<typeof drag>).detail;schedule();};root.addEventListener('annotation-drag',moved);
  const resize=new ResizeObserver(schedule);resize.observe(root);
  const mutations=new MutationObserver(records=>{if(records.some(r=>!(r.target instanceof Element&&r.target.closest('.annotation-connectors'))))schedule();});mutations.observe(root,{childList:true,subtree:true});
  document.fonts.ready.then(schedule);document.fonts.addEventListener('loadingdone',schedule);window.addEventListener('resize',schedule);schedule();
  return ()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();mutations.disconnect();document.fonts.removeEventListener('loadingdone',schedule);window.removeEventListener('resize',schedule);root.removeEventListener('annotation-drag',moved);svg.remove();};
}
