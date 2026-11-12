import {actionButton,dialogFooter,dialogFrame,textInput} from './controls.ts';
import {openDialog} from './dialog.ts';
import {choicePicker} from './list-controls.ts';
import type {songStorage} from '../storage/songs.ts';
export async function chooseSongbook(storage:ReturnType<typeof songStorage>,opener:HTMLButtonElement,options:{selected?:string;excludeStandard?:boolean;description?:string}={}):Promise<string|undefined> {
  const books=(await storage.library()).songbooks.filter(book=>!options.excludeStandard||book.id!=='standard').sort((a,b)=>a.name.localeCompare(b.name,'nb'));
  return new Promise(resolve=>{
    choicePicker({opener,name:'Sangbok',value:books.find(book=>book.id===options.selected)?.name??'Velg sangbok',selected:options.selected??null,choices:books,description:options.description,choose:id=>resolve(id??undefined),cancel:()=>resolve(undefined),create:{name:'Ny sangbok',run:()=>{
      const box=dialogFrame('Ny sangbok','name-dialog'),heading=document.createElement('h2');heading.textContent='Ny sangbok';
      const field=textInput('new-songbook-name','','Navn'),label=document.createElement('label');label.htmlFor=field.id;label.textContent='Navn';
      const error=document.createElement('p');error.setAttribute('role','alert');let writing=false;
      const cancel=()=>{if(!writing)lifecycle.close();};
      const footer=dialogFooter([{id:'cancel',label:'Avbryt',icon:'avbryt',run:cancel},{id:'save',label:'Lagre',icon:'lagre',primary:true,disabled:true,run:()=>{void save();}}]);
      const saveButton=footer.querySelector<HTMLButtonElement>('[data-action=save]')!;
      field.addEventListener('input',()=>{saveButton.disabled=!field.value.trim();});
      field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void save();}});
      box.append(heading,label,field,error,footer);let saved=false;
      const lifecycle=openDialog(box,{opener,focus:field,cancel,closed:()=>{if(!saved)resolve(undefined);}});
      async function save(){if(writing||!field.value.trim())return;writing=true;saveButton.disabled=true;field.readOnly=true;try{const book=await storage.createSongbook(field.value);saved=true;lifecycle.close();resolve(book.id);}catch(cause){error.textContent=cause instanceof Error?cause.message:'Kunne ikke lagre sangboken.';saveButton.disabled=false;field.readOnly=false;}finally{writing=false;}}
    }}});
  });
}

export function downloadText(name:string,text:string,type='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function showShareLink(url:string,opener:HTMLElement) {
  const box=dialogFrame('Delingslenke','name-dialog'),heading=document.createElement('h2');heading.textContent='Delingslenke';
  const text=document.createElement('p');text.className='hint';text.textContent='Alle med lenken kan lese og laste ned sangene i denne sangboken.';
  const field=textInput('shared-songbook-link',url,'Delingslenke');field.readOnly=true;
  const status=document.createElement('p');status.setAttribute('role','status');
  const footer=dialogFooter([{id:'close',label:'Lukk',run:()=>lifecycle.close()},{id:'copy',label:'Kopier lenke',icon:'dupliser',primary:true,run:()=>{void (navigator.clipboard?.writeText(url)??Promise.reject(Error())).then(()=>{status.textContent='Lenken er kopiert.';}).catch(()=>{status.textContent='Marker lenken og kopier med tastaturet eller appens tekstmeny.';field.focus();field.select();});}}]);
  box.append(heading,text,field,status,footer);const lifecycle=openDialog(box,{opener,focus:footer.querySelector('[data-action=copy]') as HTMLElement});
}
