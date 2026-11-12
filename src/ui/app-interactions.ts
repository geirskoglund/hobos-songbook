import {placeOverlay} from './layout.ts';
type TextControl = HTMLInputElement | HTMLTextAreaElement;
const textControl = (target: EventTarget | null): TextControl | undefined => {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || target.disabled || target.readOnly) return;
  return target instanceof HTMLTextAreaElement || ['text','number','search','email','tel','url'].includes(target.type) ? target : undefined;
};
/** App-wide policy: page-owned text tools, no browser context/selection callouts. */
export function startAppInteractions() {
  let menu: HTMLElement | undefined, menuControl: TextControl | undefined, tooltip: HTMLElement | undefined, pointerType = '', disposeMenu=()=>{}, suppressTouchEnd=false;
  let hold: {control:TextControl;pointer:number;x:number;y:number;lastX:number;lastY:number;scrollX:number;scrollY:number;moved:boolean;opened:boolean;timer:ReturnType<typeof setTimeout>} | undefined;
  function closeMenu(restore=false) {const control=menuControl;disposeMenu();disposeMenu=()=>{};menu?.remove();menu=undefined;menuControl=undefined;if(restore&&control?.isConnected)control.focus({preventScroll:true});}
  function hideTooltip() {tooltip?.remove();tooltip=undefined;}
  const parent = (control:HTMLElement) => control.closest('dialog') ?? document.body;
  function select(control:TextControl, start:number, end=start) {control.focus({preventScroll:true});try {control.setSelectionRange(start,end);} catch { /* Number controls expose no text-range API. */ }}
  function replace(control:TextControl,text:string,start=control.selectionStart ?? 0,end=control.selectionEnd ?? control.value.length) {
    if(control instanceof HTMLInputElement && control.selectionStart===null) control.value=text;
    else {select(control,start,end);if(document.execCommand('insertText',false,text))return;control.setRangeText(text,start,end,'end');}
    control.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:text}));
  }
  /** A temporary mirror locates the app-owned long-press menu caret. */
  function caret(control:TextControl,x:number,y:number) {
    const box=control.getBoundingClientRect(),computed=getComputedStyle(control),mirror=document.createElement('div');
    for(const key of ['font','line-height','letter-spacing','padding','border','text-align','text-indent','tab-size','word-spacing','overflow-wrap']) mirror.style.setProperty(key,computed.getPropertyValue(key));
    Object.assign(mirror.style,{position:'fixed',left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`,boxSizing:'border-box',whiteSpace:control instanceof HTMLTextAreaElement?computed.whiteSpace:'pre',overflow:'hidden',opacity:'0',zIndex:'2147483647'});
    mirror.textContent=control.value+'\u200b';parent(control).append(mirror);mirror.scrollTop=control.scrollTop;mirror.scrollLeft=control.scrollLeft;
    const doc=document as Document & {caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null;caretRangeFromPoint?:(x:number,y:number)=>Range|null};
    const position=doc.caretPositionFromPoint?.(x,y),range=doc.caretRangeFromPoint?.(x,y),node=position?.offsetNode ?? range?.startContainer,offset=position?.offset ?? range?.startOffset;
    let result=control.selectionStart ?? control.value.length;
    if(node&&offset!==undefined&&mirror.contains(node)){const prefix=document.createRange();prefix.selectNodeContents(mirror);prefix.setEnd(node,offset);result=Math.min(control.value.length,prefix.toString().length);}
    mirror.remove();return result;
  }
  function tools(control:TextControl,x:number,y:number) {
    closeMenu();hideTooltip();
    const box=document.createElement('div');box.className='app-text-actions';box.setAttribute('role','menu');box.setAttribute('aria-label','Tekstvalg');
    const error=document.createElement('span');error.className='sr-only';error.setAttribute('role','status');box.append(error);
    const selected=()=>control.value.slice(control.selectionStart ?? 0,control.selectionEnd ?? control.value.length);
    async function copy() {
      const text=selected();if(!text)return;
      await navigator.clipboard.writeText(text);
    }
    for(const [label,action,keep] of [
      ['Merk alt',()=>select(control,0,control.value.length),true],
      ['Klipp ut',async()=>{const start=control.selectionStart ?? 0,end=control.selectionEnd ?? control.value.length;await copy();replace(control,'',start,end);},false],
      ['Kopier',copy,false],
      ['Lim inn',async()=>{
        // Never summon a browser permission dialog from the app's text menu.
        const permission=await navigator.permissions?.query({name:'clipboard-read' as PermissionName}).catch(()=>undefined);
        if(permission?.state!=='granted'){error.className='text-action-error';error.textContent='Bruk tastaturets lim inn.';control.focus({preventScroll:true});return;}
        const text=await navigator.clipboard.readText();replace(control,text);
      },false],
    ] as const){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('role','menuitem');
      button.addEventListener('pointerdown',event=>event.preventDefault());
      button.addEventListener('click',()=>{Promise.resolve().then(action).then(()=>{if(!keep&&!error.textContent){closeMenu();control.focus({preventScroll:true});}}).catch(()=>{error.className='text-action-error';error.textContent='Utklippstavlen er utilgjengelig. Bruk tastaturets kopier/lim inn.';});});box.append(button);
    }
    parent(control).append(box);menu=box;menuControl=control;
    const initial=control.getBoundingClientRect(),dx=x-initial.left,dy=y-initial.top;
    const place=()=>{
      const rect=control.getBoundingClientRect();placeOverlay(box,undefined,{point:{x:rect.left+dx,y:rect.top+dy+10}});
    };
    const observer=new ResizeObserver(place);observer.observe(box);visualViewport?.addEventListener('resize',place);window.addEventListener('resize',place);
    disposeMenu=()=>{observer.disconnect();visualViewport?.removeEventListener('resize',place);window.removeEventListener('resize',place);};place();
    if(pointerType!=='touch')box.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
  }
  function stopHold() {if(hold)clearTimeout(hold.timer);hold=undefined;}
  function down(event:PointerEvent) {
    pointerType=event.pointerType;hideTooltip();
    if(!(event.target as Element).closest('input,textarea,.edit-toolbar,.app-text-actions,.highlight-controls,.popup-actions,[data-preserve-field-focus]'))getSelection()?.removeAllRanges();if(menu?.contains(event.target as Node))return;closeMenu();stopHold();
    const control=textControl(event.target);if(event.pointerType!=='touch'||!control)return;
    hold={control,pointer:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,scrollX:scrollX,scrollY:scrollY,moved:false,opened:false,timer:setTimeout(()=>{
      if(!hold||hold.moved||!control.isConnected)return;hold.opened=true;select(control,caret(control,hold.x,hold.y));tools(control,hold.x,hold.y);
    },450)};
  }
  function move(event:PointerEvent) {
    if(!hold||event.pointerId!==hold.pointer)return;
    if(Math.hypot(event.clientX-hold.x,event.clientY-hold.y)>8){hold.moved=true;clearTimeout(hold.timer);if(hold.opened)closeMenu();}
    // Native field scrolling and short-tap focus must remain available to the IME.
    hold.lastX=event.clientX;hold.lastY=event.clientY;
  }
  function up(event:PointerEvent) {
    if(!hold||event.pointerId!==hold.pointer)return;const current=hold;stopHold();
    suppressTouchEnd=current.moved||current.opened;
  }
  function touchEnd(event:TouchEvent) {if(suppressTouchEnd&&textControl(event.target))event.preventDefault();suppressTouchEnd=false;}
  function context(event:MouseEvent) {event.preventDefault();hideTooltip();const control=textControl(event.target);if(control)tools(control,event.clientX,event.clientY);else closeMenu();}
  function tooltipFor(target:HTMLElement) {
    hideTooltip();const text=target.dataset.tooltip;if(!text)return;
    const box=document.createElement('div');box.className='app-tooltip';box.setAttribute('role','tooltip');box.textContent=text;parent(target).append(box);tooltip=box;
    placeOverlay(box,target);
  }
  document.addEventListener('pointerdown',down,true);document.addEventListener('pointermove',move,{capture:true,passive:false});document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',()=>{stopHold();suppressTouchEnd=false;closeMenu();},true);
  document.addEventListener('touchend',touchEnd,{capture:true,passive:false});document.addEventListener('contextmenu',context,true);
  document.addEventListener('selectstart',event=>{if(!textControl(event.target)||pointerType==='touch'&&hold?.opened)event.preventDefault();},true);
  document.addEventListener('dragstart',event=>event.preventDefault(),true);
  document.addEventListener('invalid',event=>event.preventDefault(),true);
  document.addEventListener('keydown',event=>{
    pointerType='keyboard';
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'&&!textControl(event.target))event.preventDefault();
    if(event.key==='Escape'){if(menu){event.preventDefault();event.stopImmediatePropagation();}stopHold();closeMenu(true);hideTooltip();}
    if(menu?.contains(document.activeElement)&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length;buttons[next].focus();}
    if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){
      event.preventDefault();const control=textControl(event.target);if(control){const rect=control.getBoundingClientRect();tools(control,rect.left,rect.bottom);}else closeMenu();
    }
    if(menu && event.key==='Tab')closeMenu();
  },true);
  document.addEventListener('pointerover',event=>{if(event.pointerType!=='mouse')return;const target=(event.target as Element).closest<HTMLElement>('[data-tooltip]');if(target&&!target.contains(event.relatedTarget as Node))tooltipFor(target);});
  document.addEventListener('pointerout',event=>{if((event.target as Element).closest('[data-tooltip]'))hideTooltip();});
  document.addEventListener('focusin',event=>{if(pointerType==='touch')return;const target=(event.target as Element).closest<HTMLElement>('[data-tooltip]');if(target)tooltipFor(target);});
  document.addEventListener('focusout',hideTooltip);window.addEventListener('scroll',()=>{closeMenu();hideTooltip();},{passive:true});
}
