import {readingTop} from './layout.ts';
import {anchorFor, changeAnnotation, type Highlight, type LineAnchor} from '../domain/personal.ts';
import type {Song, SongPersonal} from '../domain/song.ts';
export interface TextSpan {line: HTMLElement; start: number; end: number}
interface Selection {parts: TextSpan[]; id?: string}
export const lyricText = (line: HTMLElement) => [...line.querySelectorAll<HTMLElement>('.lyric')].map(node => (node.textContent ?? '').slice(0,Number(node.dataset.length))).join('');
/** Character-precise placement, including inside words split by chord segments. */
export function lyricOffsetAt(line:HTMLElement,x:number,y:number):number{
  let result=0,distance=Infinity;
  for(const lyric of line.querySelectorAll<HTMLElement>('.lyric')){
    const walker=document.createTreeWalker(lyric,NodeFilter.SHOW_TEXT);let node:Node|null,local=0;
    while((node=walker.nextNode())){const text=node.textContent??'',length=text.length;for(let i=0;i<length;){const step=String.fromCodePoint(text.codePointAt(i)!).length;
      const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+step);const rect=range.getBoundingClientRect(),dy=Math.max(rect.top-y,0,y-rect.bottom);
      for(const [edge,at] of [[rect.left,i],[rect.right,i+step]]){const score=dy*100+Math.abs(edge-x);if(score<distance){distance=score;result=Number(lyric.dataset.offset)+Math.min(Number(lyric.dataset.length),local+at);}}i+=step;
    }local+=length;}
  }
  return result;
}
const visible = (node: HTMLElement) => !node.closest('[hidden]') && node.getClientRects().length > 0;
/** Clip the actual selection to each lyric node, including across logical lines. */
export function nativeLyricSpans(root: HTMLElement): TextSpan[] {
  const selection = getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return [];
  const range = selection.getRangeAt(0), parts: TextSpan[] = [];
  for (const line of root.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')) {
    if (!visible(line)) continue;
    let start = Infinity, end = -1;
    for (const lyric of line.querySelectorAll<HTMLElement>('.lyric')) {
      const walker = document.createTreeWalker(lyric,NodeFilter.SHOW_TEXT); let node: Node | null, local = 0;
      while ((node=walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (range.comparePoint(node,length)>=0 && range.comparePoint(node,0)<=0) {
          const from = range.startContainer === node ? range.startOffset : 0, to = range.endContainer === node ? range.endOffset : length;
          if (to>from) {start = Math.min(start,Number(lyric.dataset.offset)+local+from); end = Math.max(end,Number(lyric.dataset.offset)+Math.min(Number(lyric.dataset.length),local+to));}
        }
        local += length;
      }
    }
    if (end>start) parts.push({line,start,end});
  }
  return parts;
}
/** Shared edge scrolling for a held pointer. The caller cancels it on every completion path. */
export function edgeScroll(y: () => number, moved: () => void) {
  let frame = 0;
  const tick = () => {
    const top = readingTop(), at = y();
    const delta = at<top+35 ? -Math.min(12,(top+35-at)/3) : at>innerHeight-45 ? Math.min(12,(at-innerHeight+45)/3) : 0;
    const before = scrollY; if (delta) window.scrollBy(0,delta); if (scrollY!==before) moved();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
}
export function createHighlightEditor(root: HTMLElement, song: Song, personal: () => SongPersonal, update: (fn: (current: SongPersonal) => SongPersonal) => void, applied: () => void,toolFirst=false) {
  let active = false, selected: Selection | undefined, ignoreClick = false, pending: TextSpan[] = [];
  const controls = document.createElement('div'); controls.className = 'highlight-controls'; controls.hidden = true;
  const overlay = document.createElement('div'); overlay.className = 'selection-preview'; overlay.setAttribute('aria-hidden','true');
  const make = (text: string, label: string) => {const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label',label); return b;};
  const startHandle = make('‹','Dra starten på markeringen'), remove = make('×','Fjern markering'), endHandle = make('›','Dra slutten på markeringen');
  for (const [edge,handle] of [['start',startHandle],['end',endHandle]] as const) {handle.className = `highlight-handle handle-${edge}`; handle.dataset.edge = edge; handle.setAttribute('role','slider');}
  controls.append(startHandle,remove,endHandle);remove.hidden=toolFirst; root.append(overlay,controls);
  function rows() {let offset = 0; return [...root.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')].filter(line => visible(line)&&lyricText(line).length>0).map(line => {const text = lyricText(line), at = offset; offset += text.length+1; return {line,text,at};});}
  function inLyric(lyric: HTMLElement, offset: number) {
    const walker=document.createTreeWalker(lyric,NodeFilter.SHOW_TEXT);let node:Node|null,at=offset;
    while((node=walker.nextNode())){const length=node.textContent?.length ?? 0;if(at<=length)return{node,at};at-=length;}
  }
  function position(line: HTMLElement, offset: number) {
    for(const lyric of line.querySelectorAll<HTMLElement>('.lyric')){
      const from=Number(lyric.dataset.offset),length=Number(lyric.dataset.length);
      if(length&&offset>=from&&offset<=from+length)return inLyric(lyric,offset-from);
    }
  }
  function domRange(part: TextSpan) {const a=position(part.line,part.start),b=position(part.line,part.end); if (!a||!b) return; const range=document.createRange(); range.setStart(a.node,a.at); range.setEnd(b.node,b.at); return range;}
  function rects(parts: TextSpan[]) {
    return parts.flatMap(part=>[...part.line.querySelectorAll<HTMLElement>('.lyric')].flatMap(lyric=>{
      const offset=Number(lyric.dataset.offset),from=Math.max(0,part.start-offset),to=Math.min(Number(lyric.dataset.length),part.end-offset);
      if(to<=from)return[];const a=inLyric(lyric,from),b=inLyric(lyric,to);if(!a||!b)return[];
      const range=document.createRange();range.setStart(a.node,a.at);range.setEnd(b.node,b.at);const bounds=lyric.getBoundingClientRect();return[...range.getClientRects()].filter(rect=>rect.width>0).map(rect=>new DOMRect(rect.left,Math.max(rect.top,bounds.top),rect.width,Math.max(0,Math.min(rect.bottom,bounds.bottom)-Math.max(rect.top,bounds.top))));
    }));
  }
  function bounds(selection: Selection) {
    const all = rows(),parts=selection.parts.filter(part=>visible(part.line)),first=parts[0] ?? selection.parts[0],last=parts.at(-1) ?? first;
    return {start:(all.find(row=>row.line===first.line)?.at ?? 0)+first.start,end:(all.find(row=>row.line===last.line)?.at ?? 0)+last.end};
  }
  function wholeWords(parts: TextSpan[]) {return parts.flatMap(part=>{const text=lyricText(part.line);let start=part.start,end=part.end;while(start<end&&/\s/u.test(text[start]))start++;while(end>start&&/\s/u.test(text[end-1]))end--;if(end<=start)return[];while(start>0&&!/\s/u.test(text[start-1]))start--;while(end<text.length&&!/\s/u.test(text[end]))end++;return[{line:part.line,start,end}];});}
  function spans(start: number, end: number) {return wholeWords(rows().flatMap(row => {const from=Math.max(0,start-row.at),to=Math.min(row.text.length,end-row.at); return to>from ? [{line:row.line,start:from,end:to}] : [];}));}
  function atPoint(x: number, y: number): number | undefined {
    const all = rows();
    const doc=document as Document & {caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null;caretRangeFromPoint?:(x:number,y:number)=>Range|null};
    const caret=doc.caretPositionFromPoint?.(x,y),range=doc.caretRangeFromPoint?.(x,y),node=caret?.offsetNode ?? range?.startContainer,offset=caret?.offset ?? range?.startOffset;
    const lyric=(node?.nodeType===Node.ELEMENT_NODE?node as Element:node?.parentElement)?.closest<HTMLElement>('.lyric');
    const row=lyric?all.find(row=>row.line.contains(lyric)):undefined;
    if(node&&offset!==undefined&&lyric&&row){const prefix=document.createRange();prefix.selectNodeContents(lyric);prefix.setEnd(node,offset);return row.at+Number(lyric.dataset.offset)+Math.min(Number(lyric.dataset.length),prefix.toString().length);}
    let best: {lyric: HTMLElement; at:number; score:number} | undefined;
    for (const row of all) for (const lyric of row.line.querySelectorAll<HTMLElement>('.lyric')) {
      if (!Number(lyric.dataset.length)) continue;
      for (const rect of lyric.getClientRects()) {
        const dy=Math.max(rect.top-y,0,y-rect.bottom),dx=Math.max(rect.left-x,0,x-rect.right),score=dy*100+dx;
        if (!best||score<best.score) best={lyric,at:row.at+Number(lyric.dataset.offset),score};
      }
    }
    if (!best) return;
    const walker=document.createTreeWalker(best.lyric,NodeFilter.SHOW_TEXT); let textNode: Node | null, localOffset=0, result=best.at, distance=Infinity;
    while ((textNode=walker.nextNode())) {
      const length=textNode.textContent?.length ?? 0;
      for (let i=0;i<length;i++) {
        const range=document.createRange(); range.setStart(textNode,i);range.setEnd(textNode,i+1);const rect=range.getBoundingClientRect();
        const dy=Math.max(rect.top-y,0,y-rect.bottom);
        for (const [edge,at] of [[rect.left,i],[rect.right,i+1]]) {const score=dy*100+Math.abs(edge-x);if(score<distance){distance=score;result=best.at+localOffset+at;}}
      }
      localOffset+=length;
    }
    return result;
  }
  function preview(parts: TextSpan[]) {
    overlay.replaceChildren(); const origin=root.getBoundingClientRect();
    for (const rect of rects(parts)) {const span=document.createElement('span');span.style.cssText=`left:${rect.left-origin.left}px;top:${rect.top-origin.top}px;width:${rect.width}px;height:${rect.height}px`;overlay.append(span);}
  }
  function unmute(){root.querySelectorAll('[data-highlight-muted]').forEach(mark=>mark.removeAttribute('data-highlight-muted'));}
  function clear() {selected=undefined;pending=[];delete overlay.dataset.pending;controls.hidden=true;overlay.replaceChildren();unmute();}
  function draw() {
    if (!selected || drawGesture) return;
    const boxes=rects(selected.parts),first=boxes[0],last=boxes.at(-1);if(!first||!last){controls.hidden=true;return;}
    const origin=root.getBoundingClientRect(), limits=bounds(selected); controls.hidden=false;
    for(const [edge,handle,rect] of [['start',startHandle,first],['end',endHandle,last]] as const){
      handle.style.left=`${Math.max(0,Math.min(origin.width-28,(edge==='start'?rect.left:rect.right)-origin.left-14))}px`;handle.style.top=`${rect.bottom-origin.top-8}px`;
      handle.setAttribute('aria-valuemin','0');handle.setAttribute('aria-valuemax',String(rows().at(-1)!.at+rows().at(-1)!.text.length));handle.setAttribute('aria-valuenow',String(limits[edge]));
    }
    const firstRowRight=Math.max(...boxes.filter(rect=>Math.abs(rect.top-first.top)<1).map(rect=>rect.right));
    remove.style.left=`${Math.max(0,Math.min(origin.width-28,(first.left+firstRowRight)/2-origin.left-14))}px`;remove.style.top=`${first.top-origin.top-24}px`;
  }
  function reference(part: TextSpan): LineAnchor {return anchorFor(song,Number(part.line.dataset.sourceLine),part.line.dataset.occurrence!,lyricText(part.line));}
  function replace(previous: Selection | undefined, next: TextSpan[], id=previous?.id ?? crypto.randomUUID()) {
    next=wholeWords(next);
    const oldParts=previous?.parts ?? [], added=next.map(part=>({...part,anchor:reference(part)}));
    update(current=>{
      let state=current;
      for(const part of oldParts){const anchor=reference(part),existing=state.annotations?.[anchor.occurrence];if(!existing)continue;
        state=changeAnnotation(state,anchor,{highlights:existing.highlights.filter(range=>previous?.id ? range.groupId!==previous.id : range.start!==part.start||range.end!==part.end)});
      }
      for(const part of added){const ranges=(state.annotations?.[part.anchor.occurrence]?.highlights ?? []).flatMap(range=>range.end<=part.start||range.start>=part.end?[range]:[
        ...(range.start<part.start?[{...range,end:part.start}]:[]),...(range.end>part.end?[{...range,start:part.end}]:[]),
      ]);ranges.push({start:part.start,end:part.end,groupId:id});ranges.sort((a,b)=>a.start-b.start);state=changeAnnotation(state,part.anchor,{highlights:ranges});}
      return state;
    });
    selected=next.length?{parts:next,id}:undefined;overlay.replaceChildren();draw();
  }
  function applyNative() {const parts=pending.length?pending:nativeLyricSpans(root);if(!parts.length)return false;pending=[];delete overlay.dataset.pending;getSelection()?.removeAllRanges();replace(undefined,parts);applied();return true;}
  function selectMark(mark: HTMLElement) {
    const line=mark.closest<HTMLElement>('.song-line')!,lyric=mark.closest<HTMLElement>('.lyric')!,before=document.createRange();before.selectNodeContents(lyric);before.setEndBefore(mark);
    const at=Number(lyric.dataset.offset)+before.toString().length,range=personal().annotations?.[line.dataset.occurrence!]?.highlights.find(range=>at>=range.start&&at<range.end);if(!range)return;
    const parts=range.groupId ? [...root.querySelectorAll<HTMLElement>('.song-line[data-occurrence]')].flatMap(row=>(personal().annotations?.[row.dataset.occurrence!]?.highlights ?? []).filter(r=>r.groupId===range.groupId).map(r=>({line:row,start:r.start,end:r.end}))) : [{line,start:range.start,end:range.end}];
    selected={parts,id:range.groupId};draw();
  }
  function removeSelected(){if(selected)replace(selected,[]);clear();}
  remove.addEventListener('click',event=>{event.stopPropagation();removeSelected();});
  let drawGesture: {pointer:number;armed:boolean;start:number;end:number;x:number;y:number;mark?:HTMLElement|null;stop:()=>void} | undefined;
  let handleGesture: {pointer:number;edge:'start'|'end';original:Selection;x:number;y:number;stop:()=>void} | undefined;
  function moveHandle(at: number) {if(!handleGesture||!selected)return;const b=bounds(selected);b[handleGesture.edge]=at;if(b.end<=b.start)return;const parts=spans(b.start,b.end);if(!parts.length)return;selected={...selected,parts};preview(parts);draw();}
  function down(event: PointerEvent) {
    if(event.pointerType==='touch')root.dataset.input='touch';else root.dataset.input='mouse';
    const handle=(event.target as Element).closest<HTMLElement>('.highlight-handle');
    if(handle&&selected){event.preventDefault();event.stopPropagation();getSelection()?.removeAllRanges();const original=selected;for(const part of original.parts){const range=domRange(part);part.line.querySelectorAll('mark').forEach(mark=>{if(range?.intersectsNode(mark))mark.setAttribute('data-highlight-muted','');});}handleGesture={pointer:event.pointerId,edge:handle.dataset.edge as 'start'|'end',original,x:event.clientX,y:event.clientY,stop:()=>{}};handleGesture.stop=edgeScroll(()=>handleGesture?.y ?? innerHeight/2,()=>{if(handleGesture){const at=atPoint(handleGesture.x,handleGesture.y);if(at!==undefined)moveHandle(at);}});root.setPointerCapture(event.pointerId);return;}
    if(toolFirst&&!active)return;
    if(event.button!==0 || (event.target as Element).closest('button,.personal-note,.highlight-controls') || !active && (event.pointerType==='touch' || !(event.target as Element).closest('.lyric')))return;
    const at=atPoint(event.clientX,event.clientY);if(at===undefined)return;
    event.preventDefault();getSelection()?.removeAllRanges();clear();root.setPointerCapture(event.pointerId);
    overlay.toggleAttribute('data-pending',!active);
    drawGesture={pointer:event.pointerId,armed:active,start:at,end:at,x:event.clientX,y:event.clientY,mark:(event.target as Element).closest<HTMLElement>('mark'),stop:()=>{}};
    drawGesture.stop=edgeScroll(()=>drawGesture?.y ?? innerHeight/2,()=>{if(drawGesture){const at=atPoint(drawGesture.x,drawGesture.y);if(at!==undefined){drawGesture.end=at;preview(spans(Math.min(at,drawGesture.start),Math.max(at,drawGesture.start)));}}});
  }
  function move(event: PointerEvent) {
    if(handleGesture?.pointer===event.pointerId){event.preventDefault();handleGesture.x=event.clientX;handleGesture.y=event.clientY;const at=atPoint(event.clientX,event.clientY);if(at!==undefined)moveHandle(at);return;}
    if(drawGesture?.pointer!==event.pointerId)return;event.preventDefault();drawGesture.x=event.clientX;drawGesture.y=event.clientY;const at=atPoint(event.clientX,event.clientY);if(at===undefined)return;drawGesture.end=at;preview(spans(Math.min(at,drawGesture.start),Math.max(at,drawGesture.start)));
  }
  function finish(event?: PointerEvent, cancel=false) {
    if(drawGesture&&(!event||event.pointerId===drawGesture.pointer)){
      const gesture=drawGesture;drawGesture=undefined;gesture.stop();overlay.replaceChildren();
      if(!cancel&&gesture.end!==gesture.start){
        const parts=spans(Math.min(gesture.start,gesture.end),Math.max(gesture.start,gesture.end));
        if(gesture.armed){delete overlay.dataset.pending;replace(undefined,parts);applied();}
        else{pending=parts;overlay.dataset.pending='';preview(parts);}
        ignoreClick=true;
      }else if(cancel)clear();else if(gesture.mark){selectMark(gesture.mark);if(toolFirst)applied();ignoreClick=true;}
      else if(gesture.armed){const parts=spans(gesture.start,gesture.start+1);if(parts.length){replace(undefined,parts);applied();ignoreClick=true;}}
    }
    if(handleGesture&&(!event||event.pointerId===handleGesture.pointer)){
      const gesture=handleGesture,next=selected;handleGesture=undefined;gesture.stop();overlay.replaceChildren();unmute();
      const changed=next && (next.parts.length!==gesture.original.parts.length || next.parts.some((part,index)=>part.line!==gesture.original.parts[index]?.line||part.start!==gesture.original.parts[index]?.start||part.end!==gesture.original.parts[index]?.end));
      if(!cancel&&next&&changed)replace(gesture.original,next.parts);else{selected=gesture.original;draw();}ignoreClick=true;
    }
    if(event&&root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);
  }
  function click(event: MouseEvent) {if(ignoreClick){ignoreClick=false;event.preventDefault();event.stopImmediatePropagation();return;}if(controls.contains(event.target as Node))return;if(pending.length||nativeLyricSpans(root).length)return;const mark=(event.target as Element).closest<HTMLElement>('mark');if(mark&&(!toolFirst||active)){selectMark(mark);if(toolFirst)applied();return;}if(!(event.target as Element).closest('.personal-note'))clear();}
  function key(event: KeyboardEvent) {
    const handle=(event.target as Element).closest<HTMLElement>('.highlight-handle');
    if(handle&&selected&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();const edge=handle.dataset.edge as 'start'|'end',b=bounds(selected),length=rows().at(-1)!,max=length.at+length.text.length;
      const boundaries=rows().flatMap(row=>[...row.text.matchAll(/\S+/gu)].map(word=>row.at+word.index+(edge==='end'?word[0].length:0))).sort((a,b)=>a-b);
      const at=event.key==='Home'?(edge==='start'?0:b.start+1):event.key==='End'?(edge==='end'?max:b.end-1):event.key==='ArrowRight'?boundaries.find(at=>at>b[edge])??max:[...boundaries].reverse().find(at=>at<b[edge])??0;
      if(at>=0&&at<=max){b[edge]=at;if(b.end>b.start){const parts=spans(b.start,b.end);if(parts.length)replace(selected,parts);}}
    }
    if(event.key==='Escape'){finish(undefined,true);clear();}
  }
  function touchStart(event: TouchEvent){if(active&&!(event.target as Element).closest('button,.personal-note'))event.preventDefault();}
  function context(event: Event) {if(active||root.dataset.input==='touch')event.preventDefault();}
  const resetClick=()=>{ignoreClick=false;};root.addEventListener('pointerdown',resetClick,true);
  root.addEventListener('pointerdown',down);root.addEventListener('pointermove',move);root.addEventListener('pointerup',finish);const cancel= (e:PointerEvent)=>finish(e,true);root.addEventListener('pointercancel',cancel);root.addEventListener('click',click);root.addEventListener('contextmenu',context);root.addEventListener('touchstart',touchStart,{passive:false});document.addEventListener('keydown',key);
  const observer=new ResizeObserver(draw);observer.observe(root);
  return {applyNative,clear,pending:()=>pending,setActive(value:boolean){active=value;if(!value)finish(undefined,true);},
    selection:()=>selected?{occurrence:selected.parts[0].line.dataset.occurrence!,start:selected.parts[0].start,end:selected.parts[0].end}:undefined,
    restore(line:HTMLElement,range:Highlight){const mark=[...line.querySelectorAll<HTMLElement>('mark')].find(mark=>{const lyric=mark.closest<HTMLElement>('.lyric')!,before=document.createRange();before.selectNodeContents(lyric);before.setEndBefore(mark);return Number(lyric.dataset.offset)+before.toString().length===range.start;});if(mark)selectMark(mark);},
    dispose(){finish(undefined,true);observer.disconnect();controls.remove();overlay.remove();root.removeEventListener('pointerdown',resetClick,true);root.removeEventListener('pointerdown',down);root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',finish);root.removeEventListener('pointercancel',cancel);root.removeEventListener('click',click);root.removeEventListener('contextmenu',context);root.removeEventListener('touchstart',touchStart);document.removeEventListener('keydown',key);}
  };
}
