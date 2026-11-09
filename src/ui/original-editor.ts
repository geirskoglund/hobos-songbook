import {originalChangeError, originalDocument, originalProtection, validTime, withOriginal} from '../domain/original.ts';
import type {Song, SongPersonal} from '../domain/song.ts';
import {originalPreview} from './original-preview.ts';
import {openDialog} from './dialog.ts';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const button = (text:string, action:()=>void) => {const node=el('button',text);node.type='button';node.addEventListener('click',action);return node;};

/** One modal opening owns a temporary draft; the session owns confirmed changes. */
export function openOriginalEditor(song: Song, personal:()=>SongPersonal, apply:(song:Song)=>void, cancel:()=>void, opener:HTMLElement, savedSource:Song) {
  const model=originalDocument(song), initial={...model.fields}, fields={...initial};
  const protection=originalProtection(song,personal()), locked=Boolean(protection);
  const box=el('dialog');box.className='original-editor';box.setAttribute('aria-label','Rediger sangtekst');
  const heading=el('header'), label=el('label','Tittel'), title=el('input');title.id='original-title';title.value=fields.title;title.autocomplete='off';title.readOnly=locked;label.htmlFor=title.id;
  heading.tabIndex=-1;heading.setAttribute('aria-label','Sangtekst og metadata');heading.autofocus=true;
  const pills=el('div');pills.className='song-metadata';
  const key=button('',()=>metadata('key',key)), time=button('',()=>metadata('time',time));key.className=time.className='song-key';key.id='original-key';time.id='original-time';
  key.disabled=time.disabled=locked;pills.append(key,time);heading.append(label,title,pills);
  const toolbar=el('div');toolbar.className='original-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Formater sangtekst');
  const text=el('textarea');text.id='original-text';text.setAttribute('aria-label','Sangtekst');text.spellcheck=true;text.value=fields.text;
  const content=el('div');content.className='original-content';let disposePreview=()=>{};
  if(model.bodyProtected||locked){
    const explanation=el('p',protection??model.protection);explanation.id='original-protection';
    if(locked)for(const control of [title,key,time])control.setAttribute('aria-describedby',explanation.id);
    const preview=originalPreview(song);disposePreview=preview.dispose;content.append(explanation,preview.element);
  }else content.append(text);
  const error=el('p');error.className='field-error';error.setAttribute('role','alert');
  const actions=el('footer');actions.className='popup-actions';
  const ok=button('OK',()=>{
    if(ok.disabled)return;
    try{
      const nextFields={...fields,title:title.value,text:text.value};model.apply(nextFields);
      const next=withOriginal(savedSource,originalDocument(savedSource).apply(nextFields));
      const problem=originalChangeError(song,next,personal());if(problem)throw new Error(problem);
      lifecycle.close();apply(next);
    }catch(problem){error.textContent=problem instanceof Error?problem.message:'Endringen kunne ikke bekreftes.';}
  });
  const abort=()=>{lifecycle.close();cancel();};actions.append(button('Avbryt',abort),ok);box.append(heading,toolbar,content,error,actions);
  const reflect=()=>{fields.title=title.value;ok.disabled=!title.value.trim();key.textContent=fields.key||'Toneart';key.setAttribute('aria-label',`Toneart: ${fields.key||'ikke angitt'}`);time.textContent=fields.time||'Takt (4/4)';time.setAttribute('aria-label',`Takt: ${fields.time||'ikke angitt, viser 4/4'}`);error.textContent='';};
  title.addEventListener('input',reflect);text.addEventListener('input',()=>{error.textContent='';});
  let popup:{dirty:()=>boolean;close:()=>void}|undefined;
  function metadata(field:'key'|'time',anchor:HTMLElement){
    const name=field==='key'?'Toneart':'Takt', start=fields[field], small=el('dialog');small.className=`edit-popup original-metadata metadata-${field}`;small.setAttribute('aria-label',name);
    const row=el('div');row.className='metadata-field';const caption=el('label',name), input=el('input');input.id=`original-${field}-input`;caption.htmlFor=input.id;
    input.value=start;input.autocomplete='off';input.spellcheck=false;
    const readOnly=field==='key'&&Boolean(start);input.readOnly=readOnly;row.append(caption,input);small.append(row);
    if(readOnly)small.append(el('p','Tonearten er låst til akkordene kan flyttes samtidig.'));
    const problem=el('p');problem.className='field-error';problem.setAttribute('role','alert');small.append(problem);
    const controls=el('div');controls.className='popup-actions';
    const close=()=>child.close();controls.append(button('Avbryt',close),button('OK',()=>{
      const value=input.value.trim();
      if(field==='time'&&!validTime(value)){problem.textContent='Skriv takt, for eksempel 4/4, 6/8 eller C.';input.setAttribute('aria-invalid','true');return;}
      if(field==='key'&&value&&!/^[A-GH](?:#|b|♯|♭)?(?:m|maj|min)?$/.test(value)){problem.textContent='Skriv en toneart, for eksempel D, Bb eller Am.';input.setAttribute('aria-invalid','true');return;}
      fields[field]=value;reflect();close();
    }));small.append(controls);small.tabIndex=-1;
    const place=()=>{
      const viewport=visualViewport,x=viewport?.offsetLeft??0,y=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight,rect=anchor.getBoundingClientRect();
      small.style.maxWidth=`${width-24}px`;small.style.maxHeight=`${Math.max(80,height-24)}px`;
      small.style.left=`${Math.max(x+12,Math.min(rect.left,x+width-small.offsetWidth-12))}px`;small.style.top=`${Math.max(y+12,Math.min(rect.bottom+8,y+height-small.offsetHeight-12))}px`;
    };
    const child=openDialog(small,{opener:anchor,focus:readOnly?small:input,place,outside:true,closed:()=>{popup=undefined;}});
    popup={dirty:()=>input.value!==start,close};
  }
  const place=()=>{const viewport=visualViewport;box.style.left=`${viewport?.offsetLeft??0}px`;box.style.top=`${viewport?.offsetTop??0}px`;box.style.width=`${viewport?.width??innerWidth}px`;box.style.height=`${viewport?.height??innerHeight}px`;};
  const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();}};
  const lifecycle=openDialog(box,{opener,focus:heading,place,cancel:abort,closed:()=>{popup?.close();disposePreview();document.removeEventListener('keydown',shortcut,true);document.body.classList.remove('original-open');}});
  document.body.classList.add('original-open');reflect();document.addEventListener('keydown',shortcut,true);
  return {dispose:lifecycle.close,dirty:()=>Boolean(popup?.dirty()||title.value!==initial.title||fields.key!==initial.key||fields.time!==initial.time||text.value!==initial.text)};
}
