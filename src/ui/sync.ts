import {actionButton,dialogFooter,dialogFrame,icon,textInput} from './controls.ts';
import {openDialog} from './dialog.ts';
import {floatingAction,metadataRow} from './list-controls.ts';
import {chooseSongbook,downloadText,showShareLink} from './songbook-picker.ts';
import {accessOf,validSharedLink,type Source} from '../domain/sync.ts';
import type {songStorage} from '../storage/songs.ts';
import type {Synchronizer,SyncStatus} from '../sync/engine.ts';
export function startSyncView(storage:ReturnType<typeof songStorage>,sync:Synchronizer) {
  const root=document.getElementById('sync')!;
  const status=document.createElement('p');status.id='sync-status';status.setAttribute('role','status');
  const connect=actionButton('Koble til Dropbox',()=>{void act(()=>current.connected?disconnect(connect):sync.connect());},'kilde');connect.id='dropbox-connect';
  const own=actionButton('Synkroniser biblioteket',()=>{void sync.synchronize();},'synkroniser');own.id='sync-library';
  const all=actionButton('Synkroniser alle kilder',()=>{void storage.syncData().then(data=>sync.synchronize(data.state.config.sources.map(source=>source.id)));},'synkroniser');all.id='sync-all-sources';
  const controls=document.createElement('div');controls.className='sync-controls';controls.append(connect,own,all);
  const sharedHeading=document.createElement('h2');sharedHeading.textContent='Mine delinger';
  const shares=document.createElement('ul');shares.className='song-list';shares.id='own-shares';
  const sourceHeading=document.createElement('h2');sourceHeading.textContent='Eksterne sangkilder';
  const hint=document.createElement('p');hint.className='hint';hint.textContent='Kilder oppdateres når du velger synkronisering. Originalene er skrivebeskyttet; egne tilpasninger beholdes.';
  const sources=document.createElement('ul');sources.className='song-list';sources.id='sync-sources';
  const conflicts=actionButton('Last ned bevarte konflikter',()=>{void storage.syncData().then(data=>downloadText('songbook-konflikter.json',JSON.stringify(data.state.conflicts,null,2),'application/json'));},'eksporter');conflicts.hidden=true;
  const add=floatingAction('Ny kilde',()=>edit(add));add.id='add-source';
  root.append(status,controls,sharedHeading,shares,sourceHeading,hint,sources,conflicts,add);
  let current:SyncStatus=sync.getStatus(),dialogDirty=()=>false,writing=false;
  async function act(action:()=>Promise<unknown>,redraw=true) {try{await action();if(redraw)await refresh();}catch(error){status.textContent=error instanceof Error?error.message:'Handlingen mislyktes. Prøv igjen.';}}
  function update(value:SyncStatus){current=value;status.textContent=value.message;status.dataset.error=String(value.error);own.disabled=all.disabled=value.busy||!value.connected;connect.disabled=value.busy;root.querySelectorAll<HTMLButtonElement>('[data-sync-source]').forEach(button=>{button.disabled=value.busy||!value.connected;});connect.replaceChildren(icon('kilde'),document.createTextNode(value.connected?'Koble fra Dropbox':'Koble til Dropbox'));}
  async function disconnect(opener:HTMLElement){return new Promise<void>(resolve=>{
    const box=dialogFrame('Koble fra Dropbox','name-dialog'),heading=document.createElement('h2');heading.textContent='Koble fra Dropbox';const text=document.createElement('p');text.textContent='Sanger og persondata beholdes på denne enheten. Synkronisering stopper til du kobler til igjen.';
    const footer=dialogFooter([{id:'cancel',label:'Avbryt',run:()=>lifecycle.close()},{id:'disconnect',label:'Koble fra',primary:true,run:()=>{void sync.disconnect().then(()=>lifecycle.close()).catch(error=>{text.textContent=error instanceof Error?error.message:'Kunne ikke koble fra. Prøv igjen.';});}}]);box.append(heading,text,footer);const lifecycle=openDialog(box,{opener,closed:resolve});
  });}
  const reflect=update;
  async function refresh(){
    const data=await storage.syncData().catch(error=>{status.textContent=error instanceof Error?error.message:'Kunne ikke lese synkronisering.';return undefined;});if(!data)return;sources.replaceChildren();shares.replaceChildren();conflicts.hidden=!data.state.conflicts.length;
    for(const source of data.state.config.sources){
      const book=data.songbooks.find(book=>book.id===source.songbookId)?.name??'Ukjent sangbok';
      const {row,button,more}=metadataRow(source.name,[book,...(!current.connected?['Frakoblet']:[]),source.lastSync?`Sist synkronisert ${new Date(source.lastSync).toLocaleString('nb-NO')}`:'Ikke synkronisert ennå',...(source.error?[source.error]:[])],()=>edit(button,source),opener=>{void sync.synchronize([source.id]);});
      button.dataset.sourceId=source.id;more!.dataset.syncSource=source.id;more!.replaceChildren(icon('synkroniser'));more!.setAttribute('aria-label',`Synkroniser ${source.name}`);more!.removeAttribute('aria-haspopup');more!.disabled=!current.connected||current.busy;sources.append(row);
    }
    const books=data.songbooks.filter(book=>data.songs.some(song=>song.songbookId===book.id&&accessOf(song)==='shared'&&!song.sync?.deleted));
    for(const book of books){const {row,button}=metadataRow(book.name,['Kopier delingslenke'],()=>{void act(async()=>{const url=await sync.share(book.id);try{if(!navigator.clipboard)throw Error();await navigator.clipboard.writeText(url);status.textContent=`Delingslenken til ${book.name} er kopiert.`;}catch{showShareLink(url,button);}},false);});shares.append(row);}
    reflect(sync.getStatus());
  }
  function edit(opener:HTMLElement,source?:Source){
    const box=dialogFrame(source?'Kildeinnstillinger':'Ny kilde','name-dialog source-dialog'),heading=document.createElement('h2');heading.textContent=source?'Kildeinnstillinger':'Ny kilde';
    const name=textInput('source-name',source?.name??''),url=textInput('source-url',source?.url??'');url.inputMode='url';url.spellcheck=false;
    const fields=document.createElement('div');fields.className='source-fields';
    for(const [field,text] of [[name,'Navn'],[url,'Delt Dropbox-lenke']] as const){const label=document.createElement('label');label.htmlFor=field.id;label.textContent=text;fields.append(label,field);}
    let bookId=source?.songbookId;
    const book=actionButton('Velg sangbok',()=>{void chooseSongbook(storage,book,{selected:bookId}).then(async selected=>{if(!selected)return;bookId=selected;await showBook();validate();}).catch(cause=>{error.textContent=cause instanceof Error?cause.message:'Kunne ikke hente sangbøkene.';});},'filter');book.id='source-songbook';
    const error=document.createElement('p');error.setAttribute('role','alert');
    const cancel=()=>{if(!writing)lifecycle.close();};
    const footer=dialogFooter([{id:'cancel',label:'Avbryt',icon:'avbryt',run:cancel},{id:'save',label:'Lagre',icon:'lagre',primary:true,disabled:true,run:()=>{void save();}}]);
    const saveButton=footer.querySelector<HTMLButtonElement>('[data-action=save]')!;
    const valid=()=>{try{return Boolean(name.value.trim()&&validSharedLink(url.value)&&bookId);}catch{return false;}};
    function validate(){saveButton.disabled=!valid();}
    name.addEventListener('input',validate);url.addEventListener('input',validate);
    async function showBook(){const books=(await storage.library()).songbooks;book.replaceChildren(icon('filter'),document.createTextNode(books.find(book=>book.id===bookId)?.name??'Velg sangbok'));}
    dialogDirty=()=>name.value!==(source?.name??'')||url.value!==(source?.url??'')||bookId!==source?.songbookId;
    box.append(heading,fields,book,error);
    if(source)box.append(actionButton('Fjern kilde',()=>remove(), 'slett'));
    box.append(footer);const lifecycle=openDialog(box,{opener,focus:name,cancel,closed:()=>{dialogDirty=()=>false;}});void showBook().catch(cause=>{error.textContent=cause instanceof Error?cause.message:'Kunne ikke hente sangbøkene.';});validate();
    async function save(){if(writing)return;try{const link=validSharedLink(url.value);if(!name.value.trim()||!bookId)throw Error('Fyll inn navn, lenke og sangbok.');writing=true;saveButton.disabled=true;await sync.saveSource({...source,id:source?.id??crypto.randomUUID(),name:name.value.trim(),url:link,songbookId:bookId});lifecycle.close();await refresh();}catch(cause){error.textContent=cause instanceof Error?cause.message:'Kunne ikke lagre kilden.';}finally{writing=false;validate();}}
    function remove(){
      const confirm=dialogFrame('Fjern kilde','name-dialog'),title=document.createElement('h2');title.textContent='Fjern kilde';const text=document.createElement('p');text.textContent='Oppdateringer fra denne kilden stopper. Nedlastede sanger og dine tilpasninger beholdes som frakoblede kopier.';
      const actions=dialogFooter([{id:'cancel',label:'Avbryt',run:()=>confirmation.close()},{id:'remove',label:'Fjern kilde',icon:'slett',primary:true,run:()=>{void act(async()=>{await sync.removeSource(source!.id);confirmation.close();lifecycle.close();});}}]);confirm.append(title,text,actions);const confirmation=openDialog(confirm,{opener:document.activeElement as HTMLElement});
    }
  }
  return {update:reflect,refresh,dirty:()=>writing||dialogDirty()};
}
