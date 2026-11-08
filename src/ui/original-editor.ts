import {originalDocument, originalChangeError, withOriginal, validTime} from '../domain/original.ts';
import type {Song, SongPersonal} from '../domain/song.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
};
const button = (text:string, action:()=>void) => {const node=el('button',text);node.type='button';node.addEventListener('click',action);return node;};

/** One modal opening owns a working copy; its parent owns the confirmed draft. */
export function openOriginalEditor(song: Song, personal:()=>SongPersonal, apply:(song:Song)=>void, cancel:()=>void, opener:HTMLElement, savedSource:Song) {
  const model=originalDocument(song), initial={...model.fields}, fields={...initial};
  const previous=opener;
  const box=el('dialog');box.className='original-editor';box.setAttribute('aria-label','Rediger original');
  const heading=el('header'), label=el('label','Tittel'), title=el('input');title.id='original-title';title.value=fields.title;title.autocomplete='off';label.htmlFor=title.id;
  const pills=el('div');pills.className='song-metadata';
  const key=button('',()=>metadata('key',key)), time=button('',()=>metadata('time',time));key.className=time.className='song-key';key.id='original-key';time.id='original-time';
  pills.append(key,time);heading.append(label,title,pills);
  const toolbar=el('div');toolbar.className='original-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Formater sangtekst');
  const text=el('textarea');text.id='original-text';text.setAttribute('aria-label','Sangtekst');text.spellcheck=true;text.value=fields.text;
  const content=el('div');content.className='original-content';
  if (model.bodyProtected) {
    const explanation=el('p',model.protection);explanation.id='original-protection';
    const preview=el('div');preview.className='original-preview';preview.setAttribute('aria-label','Beskyttet sangtekst');
    const body=document.getElementById('song-body');if(body)preview.append(body.cloneNode(true));
    preview.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));preview.querySelectorAll('button').forEach(node=>node.setAttribute('disabled',''));
    content.append(explanation,preview);
  } else content.append(text);
  const error=el('p');error.className='field-error';error.setAttribute('role','alert');
  const actions=el('footer');actions.className='popup-actions';
  const ok=button('OK',()=>{
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
  const reflect=()=>{fields.title=title.value;ok.disabled=!title.value.trim();key.textContent=fields.key || 'Toneart';key.setAttribute('aria-label',`Toneart: ${fields.key || 'ikke angitt'}`);time.textContent=fields.time || 'Taktart (4/4)';time.setAttribute('aria-label',`Taktart: ${fields.time || 'ikke angitt, viser 4/4'}`);error.textContent='';};
  title.addEventListener('input',reflect);text.addEventListener('input',()=>{error.textContent='';});
  let popup: {box:HTMLDialogElement;dirty:()=>boolean;close:()=>void} | undefined;
  function metadata(field:'key'|'time',anchor:HTMLElement) {
    const name=field==='key'?'Toneart':'Taktart', start=fields[field];
    const small=el('dialog');small.className='edit-popup original-metadata';small.setAttribute('aria-label',name);
    const input=el('input');input.value=start;input.id=`original-${field}-input`;input.setAttribute('aria-label',name);
    const locked=field==='key'&&Boolean(start);input.readOnly=locked;
    small.append(el('h2',name),input);
    if(locked)small.append(el('p','Endring av angitt toneart kommer sammen med transponering.'));
    const problem=el('p');problem.className='field-error';problem.setAttribute('role','alert');small.append(problem);
    const close=()=>{popup=undefined;small.close();small.remove();anchor.focus({preventScroll:true});};
    const controls=el('div');controls.className='popup-actions';controls.append(button('Avbryt',close),button('OK',()=>{
      const value=input.value.trim();
      if(field==='time'&&!validTime(value)){problem.textContent='Skriv en taktart, for eksempel 4/4, 6/8 eller C.';input.setAttribute('aria-invalid','true');return;}
      if(field==='key'&&value&&!/^[A-GH](?:#|b|♯|♭)?(?:m|maj|min)?$/.test(value)){problem.textContent='Skriv en toneart, for eksempel D, Bb eller Am.';return;}
      fields[field]=value;reflect();close();
    }));small.append(controls);
    let down:{x:number;y:number}|undefined;
    small.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY};});
    small.addEventListener('pointercancel',()=>{down=undefined;});
    small.addEventListener('click',event=>{const rect=small.getBoundingClientRect();if(event.target===small&&down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<8&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))close();down=undefined;});
    popup={box:small,dirty:()=>input.value!==start,close};small.addEventListener('cancel',event=>{event.preventDefault();close();});document.body.append(small);small.showModal();place();input.focus({preventScroll:true});
  }
  const place=()=>{
    const viewport=visualViewport;
    box.style.left=`${viewport?.offsetLeft ?? 0}px`;box.style.top=`${viewport?.offsetTop ?? 0}px`;box.style.width=`${viewport?.width ?? innerWidth}px`;box.style.height=`${viewport?.height ?? innerHeight}px`;
    if(popup){const width=viewport?.width ?? innerWidth,height=viewport?.height ?? innerHeight,w=Math.min(360,width-24);Object.assign(popup.box.style,{margin:'0',left:`${(viewport?.offsetLeft ?? 0)+(width-w)/2}px`,top:`${(viewport?.offsetTop ?? 0)+12}px`,right:'auto',bottom:'auto',width:`${w}px`,maxHeight:`${Math.max(80,height-24)}px`});}
  };
  const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();}};
  function dispose() {
    popup?.close();document.removeEventListener('keydown',shortcut,true);window.removeEventListener('resize',place);visualViewport?.removeEventListener('resize',place);visualViewport?.removeEventListener('scroll',place);
    box.close();box.remove();document.body.classList.remove('original-open');if(previous?.isConnected)previous.focus({preventScroll:true});
  }
  box.addEventListener('cancel',event=>{event.preventDefault();abort();});
  document.body.append(box);document.body.classList.add('original-open');box.showModal();reflect();place();title.focus({preventScroll:true});
  document.addEventListener('keydown',shortcut,true);window.addEventListener('resize',place);visualViewport?.addEventListener('resize',place);visualViewport?.addEventListener('scroll',place);
  return {dispose,dirty:()=>Boolean(popup?.dirty()||title.value!==initial.title||fields.key!==initial.key||fields.time!==initial.time||text.value!==initial.text)};
}
