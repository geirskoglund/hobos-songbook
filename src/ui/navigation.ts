import {icon} from './controls.ts';
import {currentPage, mainDestination, type Page} from './layout.ts';
export function navigation(choose:(page:Page)=>void) {
  const button=document.getElementById('menu-button') as HTMLButtonElement, panel=document.getElementById('main-menu')!, backdrop=document.getElementById('menu-backdrop')!;
  const content=document.querySelector('main')!, left=document.querySelector<HTMLElement>('.nav-left')!, actions=document.getElementById('header-actions')!;
  const destinations:[Page,string,string][]=[['library','Sanger','songlist'],['setlists','Setlister','setliste'],['sync','Synkronisering','synkroniser'],['songbooks','Sangbøker','sangbok'],['files','Filer','fil-sang'],['settings','Innstillinger','innstillinger']];
  for(const [page,name,glyph] of destinations){const item=document.createElement('button');item.type='button';item.dataset.destination=page;item.append(icon(glyph),document.createTextNode(name));item.addEventListener('click',()=>{close(false);choose(page);});panel.append(item);}
  function close(focus=true){panel.hidden=backdrop.hidden=true;content.inert=left.inert=actions.inert=false;button.setAttribute('aria-expanded','false');document.body.classList.remove('menu-open');if(focus)button.focus({preventScroll:true});}
  function open(){panel.hidden=backdrop.hidden=false;content.inert=left.inert=actions.inert=true;button.setAttribute('aria-expanded','true');document.body.classList.add('menu-open');const active=mainDestination(currentPage());(panel.querySelector(`[data-destination="${active}"]`) as HTMLElement).focus({preventScroll:true});}
  button.addEventListener('click',()=>panel.hidden?open():close());
  let down:{x:number;y:number}|undefined;
  backdrop.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY};});backdrop.addEventListener('pointercancel',()=>{down=undefined;});
  backdrop.addEventListener('click',event=>{if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<8)close();down=undefined;});
  document.addEventListener('keydown',event=>{
    if(panel.hidden||document.querySelector('dialog[open]'))return;
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab') {const notice=document.querySelector<HTMLElement>('#update-notice:not([hidden])');const nodes=[button,...panel.querySelectorAll<HTMLButtonElement>('button'),...(notice?.querySelectorAll<HTMLButtonElement>('button') ?? [])],index=nodes.indexOf(document.activeElement as HTMLButtonElement);event.preventDefault();nodes[(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}
  });
  return {open,close};
}
