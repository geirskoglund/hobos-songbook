import {actionButton, textInput, textArea} from './controls.ts';
import {originalChangeError, originalDocument, originalProtection, validTime, withOriginal} from '../domain/original.ts';
import type {Song, SongPersonal} from '../domain/song.ts';
import {originalPreview} from './original-preview.ts';
import {openDialog, dialogFrame, dialogFooter} from './dialog.ts';
import {placeOverlay} from './layout.ts';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const button = actionButton;

/** One modal opening owns a temporary draft; the session owns confirmed changes. */
export function openOriginalEditor(song: Song, personal:()=>SongPersonal, apply:(song:Song)=>void, cancel:()=>void, opener:HTMLElement, savedSource:Song) {
  const model=originalDocument(song), initial={...model.fields}, fields={...initial};
  const protection=originalProtection(song,personal()), locked=Boolean(protection);
  const box=dialogFrame('Rediger sangtekst','original-editor');
  const heading=el('header'), label=el('label','Tittel'), title=textInput('original-title',fields.title);title.readOnly=locked;label.htmlFor=title.id;
  heading.tabIndex=-1;heading.setAttribute('aria-label','Sangtekst og metadata');heading.autofocus=true;
  const pills=el('div');pills.className='song-metadata';
  const key=button('',()=>metadata('key',key)), time=button('',()=>metadata('time',time));key.className=time.className='song-key';key.id='original-key';time.id='original-time';
  key.disabled=time.disabled=locked;pills.append(key,time);heading.append(label,title,pills);
  const toolbar=el('div');toolbar.className='original-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Formater sangtekst');
  const text=textArea('original-text',fields.text,'Sangtekst');text.spellcheck=true;
  const content=el('div');content.className='original-content';let disposePreview=()=>{};
  if(model.bodyProtected||locked){
    const explanation=el('p',protection??model.protection);explanation.id='original-protection';
    if(locked)for(const control of [title,key,time])control.setAttribute('aria-describedby',explanation.id);
    const preview=originalPreview(song);disposePreview=preview.dispose;content.append(explanation,preview.element);
  }else content.append(text);
  const error=el('p');error.className='field-error';error.setAttribute('role','alert');
  const confirm=()=>{
    if(ok.disabled)return;
    try{
      const nextFields={...fields,title:title.value,text:text.value};model.apply(nextFields);
      const next=withOriginal(savedSource,originalDocument(savedSource).apply(nextFields));
      const problem=originalChangeError(song,next,personal());if(problem)throw new Error(problem);
      lifecycle.close();apply(next);
    }catch(problem){error.textContent=problem instanceof Error?problem.message:'Endringen kunne ikke bekreftes.';}
  };
  const abort=()=>{lifecycle.close();cancel();};
  const actions=dialogFooter([{id:'cancel',label:'Avbryt',icon:'kryss',run:abort},{id:'confirm',label:'OK',primary:true,icon:'ok',run:confirm}]);
  const ok=actions.querySelector<HTMLButtonElement>('[data-action=confirm]')!;box.append(heading,toolbar,content,error,actions);
  const reflect=()=>{fields.title=title.value;ok.disabled=!title.value.trim();key.textContent=fields.key||'Toneart';key.setAttribute('aria-label',`Toneart: ${fields.key||'ikke angitt'}`);time.textContent=fields.time||'Takt (4/4)';time.setAttribute('aria-label',`Takt: ${fields.time||'ikke angitt, viser 4/4'}`);error.textContent='';};
  title.addEventListener('input',reflect);text.addEventListener('input',()=>{error.textContent='';});
  let popup:{dirty:()=>boolean;close:()=>void}|undefined;
  function metadata(field:'key'|'time',anchor:HTMLElement){
    const name=field==='key'?'Toneart':'Takt', start=fields[field], small=dialogFrame(name,`edit-popup original-metadata metadata-${field}`);
    const row=el('div');row.className='metadata-field';const caption=el('label',name), input=textInput(`original-${field}-input`);caption.htmlFor=input.id;
    input.value=start;input.autocomplete='off';input.spellcheck=false;
    const readOnly=field==='key'&&Boolean(start);input.readOnly=readOnly;row.append(caption,input);small.append(row);
    if(readOnly)small.append(el('p','Tonearten er låst til akkordene kan flyttes samtidig.'));
    const problem=el('p');problem.className='field-error';problem.setAttribute('role','alert');small.append(problem);
    const close=()=>child.close();const controls=dialogFooter([{id:'cancel',label:'Avbryt',icon:'kryss',run:close},{id:'confirm',label:'OK',primary:true,icon:'ok',run:()=>{
      const value=input.value.trim();
      if(field==='time'&&!validTime(value)){problem.textContent='Skriv takt, for eksempel 4/4, 6/8 eller C.';input.setAttribute('aria-invalid','true');return;}
      if(field==='key'&&value&&!/^[A-GH](?:#|b|♯|♭)?(?:m|maj|min)?$/.test(value)){problem.textContent='Skriv en toneart, for eksempel D, Bb eller Am.';input.setAttribute('aria-invalid','true');return;}
      fields[field]=value;reflect();close();
    }}]);small.append(controls);small.tabIndex=-1;
    const place=()=>placeOverlay(small,anchor);
    const child=openDialog(small,{opener:anchor,focus:readOnly?small:input,place,outside:true,closed:()=>{popup=undefined;}});
    popup={dirty:()=>input.value!==start,close};
  }
  const place=()=>placeOverlay(box,undefined,{fullscreen:true});
  const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();}};
  const lifecycle=openDialog(box,{opener,focus:heading,place,cancel:abort,closed:()=>{popup?.close();disposePreview();document.removeEventListener('keydown',shortcut,true);document.body.classList.remove('original-open');}});
  document.body.classList.add('original-open');reflect();document.addEventListener('keydown',shortcut,true);
  return {dispose:lifecycle.close,dirty:()=>Boolean(popup?.dirty()||title.value!==initial.title||fields.key!==initial.key||fields.time!==initial.time||text.value!==initial.text)};
}
