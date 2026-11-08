import {originalDocument, originalChangeError, originalProtection, withOriginal, validTime} from '../domain/original.ts';
import type {Song, SongPersonal} from '../domain/song.ts';
import {originalPreview} from './original-preview.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
};
const button = (text:string, action:()=>void) => {const node=el('button',text);node.type='button';node.addEventListener('click',action);return node;};

/** One modal opening owns a working copy; its parent owns the confirmed draft. */
export function openOriginalEditor(song: Song, personal:()=>SongPersonal, apply:(song:Song)=>void, cancel:()=>void, opener:HTMLElement, savedSource:Song) {
  const model=originalDocument(song), initial={...model.fields}, fields={...initial};
  const locked=Boolean(originalProtection(song,personal()));
  const previous=opener;
  const box=el('dialog');box.className='original-editor';box.setAttribute('aria-label','Rediger sangtekst');
  const heading=el('header'), label=el('label','Tittel'), title=el('input');title.id='original-title';title.value=fields.title;title.autocomplete='off';title.readOnly=locked;label.htmlFor=title.id;
  heading.tabIndex=-1;heading.setAttribute('aria-label','Sangtekst og metadata');heading.autofocus=true;
  const pills=el('div');pills.className='song-metadata';
  const key=button('',()=>metadata('key',key)), time=button('',()=>metadata('time',time));key.className=time.className='song-key';key.id='original-key';time.id='original-time';
  key.disabled=time.disabled=locked;
  pills.append(key,time);heading.append(label,title,pills);
  const toolbar=el('div');toolbar.className='original-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Formater sangtekst');
  const text=el('textarea');text.id='original-text';text.setAttribute('aria-label','Sangtekst');text.spellcheck=true;text.value=fields.text;
  const content=el('div');content.className='original-content';
  let disposePreview=()=>{};
  if (model.bodyProtected || locked) {
    const state=personal(), hasAnnotations=Object.values(state.annotations ?? {}).some(item=>item.note || item.highlights.length);
    const message=locked ? `Tekst, tittel, toneart og takt er foreløpig låst for å bevare ${hasAnnotations ? 'notater og gulmarkeringer' : 'refreng og dine refrengvalg'}. Personlige tilpasninger kan fortsatt redigeres i sangvisningen.` : model.protection;
    const explanation=el('p',message);explanation.id='original-protection';
    if(locked){title.setAttribute('aria-describedby',explanation.id);key.setAttribute('aria-describedby',explanation.id);time.setAttribute('aria-describedby',explanation.id);}
    const preview=originalPreview(song);disposePreview=preview.dispose;
    content.append(explanation,preview.element);
  } else content.append(text);
  const error=el('p');error.className='field-error';error.setAttribute('role','alert');
  const actions=el('footer');actions.className='popup-actions';
  const ok=button('OK',()=>{
    if(ok.disabled)return;
    try {
      const nextFields={...fields,title:title.value,text:text.value};
      model.apply(nextFields); // Validate this opening, including its already chosen key.
      const next=withOriginal(savedSource,originalDocument(savedSource).apply(nextFields));
      const protection=originalChangeError(song,next,personal());if(protection)throw new Error(protection);
      dispose();apply(next);
    } catch(problem) {error.textContent=problem instanceof Error?problem.message:'Endringen kunne ikke bekreftes.';}
  });
  const abort=()=>{dispose();cancel();};actions.append(button('Avbryt',abort),ok);
  box.append(heading,toolbar,content,error,actions);
  const reflect=()=>{fields.title=title.value;ok.disabled=!title.value.trim();key.textContent=fields.key || 'Toneart';key.setAttribute('aria-label',`Toneart: ${fields.key || 'ikke angitt'}`);time.textContent=fields.time || 'Takt (4/4)';time.setAttribute('aria-label',`Takt: ${fields.time || 'ikke angitt, viser 4/4'}`);error.textContent='';};
  title.addEventListener('input',reflect);text.addEventListener('input',()=>{error.textContent='';});
  let popup: {box:HTMLDialogElement;anchor:HTMLElement;dirty:()=>boolean;close:()=>void} | undefined;
  function metadata(field:'key'|'time',anchor:HTMLElement) {
    const name=field==='key'?'Toneart':'Takt', start=fields[field];
    const small=el('dialog');small.className=`edit-popup original-metadata metadata-${field}`;small.setAttribute('aria-label',name);
    const input=el('input');input.value=start;input.id=`original-${field}-input`;input.setAttribute('aria-label',name);input.autocomplete='off';input.spellcheck=false;
    const locked=field==='key'&&Boolean(start);input.readOnly=locked;
    small.append(el('h2',name),input);
    if(locked)small.append(el('p','Tonearten er låst til akkordene kan flyttes samtidig.'));
    const problem=el('p');problem.className='field-error';problem.setAttribute('role','alert');small.append(problem);
    const close=()=>{observer.disconnect();popup=undefined;small.close();small.remove();anchor.focus({preventScroll:true});};
    const controls=el('div');controls.className='popup-actions';controls.append(button('Avbryt',close),button('OK',()=>{
      const value=input.value.trim();
      if(field==='time'&&!validTime(value)){problem.textContent='Skriv takt, for eksempel 4/4, 6/8 eller C.';input.setAttribute('aria-invalid','true');return;}
      if(field==='key'&&value&&!/^[A-GH](?:#|b|♯|♭)?(?:m|maj|min)?$/.test(value)){problem.textContent='Skriv en toneart, for eksempel D, Bb eller Am.';return;}
      fields[field]=value;reflect();close();
    }));small.append(controls);
    let down:{x:number;y:number}|undefined;
    small.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY};});
    small.addEventListener('pointercancel',()=>{down=undefined;});
    small.addEventListener('click',event=>{const rect=small.getBoundingClientRect();if(event.target===small&&down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<8&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))close();down=undefined;});
    const observer=new ResizeObserver(()=>place());
    popup={box:small,anchor,dirty:()=>input.value!==start,close};small.addEventListener('cancel',event=>{event.preventDefault();close();});document.body.append(small);small.showModal();observer.observe(small);place();
    if(locked){small.tabIndex=-1;small.focus({preventScroll:true});}else input.focus({preventScroll:true});
  }
  const place=()=>{
    const viewport=visualViewport;
    box.style.left=`${viewport?.offsetLeft ?? 0}px`;box.style.top=`${viewport?.offsetTop ?? 0}px`;box.style.width=`${viewport?.width ?? innerWidth}px`;box.style.height=`${viewport?.height ?? innerHeight}px`;
    if(popup){
      const width=viewport?.width ?? innerWidth,height=viewport?.height ?? innerHeight,x=viewport?.offsetLeft ?? 0,y=viewport?.offsetTop ?? 0;
      const rect=popup.anchor.getBoundingClientRect(),w=Math.min(200,width-24);
      Object.assign(popup.box.style,{margin:'0',left:`${Math.max(x+12,Math.min(rect.left,x+width-w-12))}px`,right:'auto',bottom:'auto',width:`${w}px`,maxHeight:`${Math.max(80,height-24)}px`});
      popup.box.style.top=`${Math.max(y+12,Math.min(rect.bottom+8,y+height-popup.box.offsetHeight-12))}px`;
    }
  };
  const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();}};
  function dispose() {
    popup?.close();disposePreview();document.removeEventListener('keydown',shortcut,true);window.removeEventListener('resize',place);visualViewport?.removeEventListener('resize',place);visualViewport?.removeEventListener('scroll',place);
    box.close();box.remove();document.body.classList.remove('original-open');if(previous?.isConnected)previous.focus({preventScroll:true});
  }
  box.addEventListener('cancel',event=>{event.preventDefault();abort();});
  document.body.append(box);document.body.classList.add('original-open');box.showModal();reflect();place();heading.focus({preventScroll:true});
  document.addEventListener('keydown',shortcut,true);window.addEventListener('resize',place);visualViewport?.addEventListener('resize',place);visualViewport?.addEventListener('scroll',place);
  return {dispose,dirty:()=>Boolean(popup?.dirty()||title.value!==initial.title||fields.key!==initial.key||fields.time!==initial.time||text.value!==initial.text)};
}
