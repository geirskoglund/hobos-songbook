import {currentPage, showPage, readingTop, pages, type Page} from './layout.ts';
/** View capture is independent of the one-shot, per-tab update handoff. */
export interface UpdateView {
  version: 1;
  page?: Page;
  settingsReturn?: UpdateView;
  setlistId?: string;
  setlistsReturn?: UpdateView;
  editor?: {from:'reader'|'library';returnView?:UpdateView;annotation?:{occurrence:string;start:number;end:number}};
  songId:string|null; scrollY:number; chartReleased:boolean;
  anchor?:{index:number;offset:number;itemId?:string};
  menu:{open:boolean;scrollTop:number;infoOpen:boolean};focusId:string|null;
}
const stateKey=(namespace:string)=>`${namespace}:update-view`;
const rows=(songId:string|null,page?:Page)=>[...document.querySelectorAll<HTMLElement>(page==='setlists'?'#setlist-list .count-choice':page==='songbooks'?'#songbook-list .count-choice':songId?'#song-body .song-line, #song-body .comment, #song-body .unknown, #song-body .chorus > h2':'#song-list .song-choice')];
export type SetlistView = Pick<UpdateView, 'setlistId' | 'setlistsReturn'>;
export function captureView(songId:string|null,focusId:string|null,editor?:UpdateView['editor'],settingsReturn?:UpdateView,setlist?:SetlistView):UpdateView {
  const panel=document.getElementById('main-menu')!;
  const view:UpdateView={version:1,page:currentPage(),songId,scrollY,chartReleased:Boolean(songId&&document.getElementById('chart-dock')?.dataset.sticky==='false'),menu:{open:!panel.hidden,scrollTop:panel.scrollTop,infoOpen:true},focusId,editor,settingsReturn,...setlist};
  if(scrollY>0&&['library','reader','setlists','songbooks'].includes(currentPage())) {
    const content=rows(songId,currentPage()),top=readingTop(),index=content.findIndex(row=>{const r=row.getBoundingClientRect();return r.height>0&&r.bottom>top&&r.top<innerHeight;});
    if(index>=0)view.anchor={index,offset:content[index].getBoundingClientRect().top-top,itemId:content[index].dataset.songId ?? content[index].dataset.setlistId ?? content[index].dataset.songbookId};
  }
  return view;
}
export function saveUpdateView(namespace:string,songId:string|null,focusId:string|null,editor?:UpdateView['editor'],settingsReturn?:UpdateView,setlist?:SetlistView) {
  try{history.replaceState({...history.state,[stateKey(namespace)]:captureView(songId,focusId,editor,settingsReturn,setlist)},'');}catch{/* Unavailable history must not block an update. */}
}
function valid(view:UpdateView,depth=0):boolean {
  const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
  if(!view||depth>3||view.version!==1||!(view.songId===null||typeof view.songId==='string')||!finite(view.scrollY)||view.scrollY<0||typeof view.chartReleased!=='boolean'||typeof view.menu?.open!=='boolean'||!finite(view.menu.scrollTop)||view.menu.scrollTop<0||typeof view.menu.infoOpen!=='boolean'||!(view.focusId===null||typeof view.focusId==='string'))return false;
  if(view.page!==undefined&&!pages.includes(view.page))return false;
  if(view.setlistId!==undefined&&typeof view.setlistId!=='string')return false;
  if(view.editor&&(!['reader','library'].includes(view.editor.from)||view.editor.returnView?.editor))return false;
  const a=view.editor?.annotation;if(a&&(typeof a.occurrence!=='string'||!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||a.end<a.start))return false;
  if(view.anchor&&(!Number.isInteger(view.anchor.index)||view.anchor.index<0||!finite(view.anchor.offset)||!(view.anchor.itemId===undefined||typeof view.anchor.itemId==='string')))return false;
  return (!view.settingsReturn||valid(view.settingsReturn,depth+1))&&(!view.editor?.returnView||valid(view.editor.returnView,depth+1))&&(!view.setlistsReturn||valid(view.setlistsReturn,depth+1));
}
export function takeUpdateView(namespace:string):UpdateView|null {
  try{
    const state={...history.state},key=stateKey(namespace);if(!Object.hasOwn(state,key))return null;
    const view=state[key] as UpdateView;delete state[key];history.replaceState(Object.keys(state).length?state:null,'');if(!valid(view))return null;
    // Today's master stored its settings modal above an underlying song/list.
    if(view.page===undefined){
      view.page=view.songId?'reader':'library';
      if(view.menu.open){view.settingsReturn={...view,menu:{...view.menu,open:false}};view.page='settings';view.scrollY=view.menu.scrollTop;delete view.anchor;view.menu={...view.menu,open:false};}
    }
    return view;
  }catch{return null;}
}
export async function restoreUpdateView(view:UpdateView,isCurrent:()=>boolean) {
  showPage(view.page??(view.songId?'reader':'library'),Boolean(view.songId||view.setlistId||view.settingsReturn));
  await document.fonts.ready;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  if(!isCurrent())return;
  window.scrollTo(0,view.scrollY);
  if(view.anchor){const content=rows(view.songId,view.page),chosen=view.anchor.itemId?content.find(r=>(r.dataset.songId??r.dataset.setlistId??r.dataset.songbookId)===view.anchor!.itemId):content[view.anchor.index],row=chosen?.closest('[hidden]')?chosen.closest('.reference')?.querySelector('h2'):chosen,rect=row?.getBoundingClientRect();if(rect?.height)window.scrollTo(0,Math.max(0,scrollY+rect.top-readingTop()-view.anchor.offset));}
  const menu=document.getElementById('main-menu')!;
  if(view.menu.open&&menu.hidden)document.getElementById('menu-button')!.click();
  menu.scrollTop=view.menu.scrollTop;
}
export function focusUpdateView(view:UpdateView) {
  const old=view.focusId?document.getElementById(view.focusId):null;
  const page=view.page??(view.songId?'reader':'library'),id=page==='reader'?'song-title':page==='library'?'library-title':page==='settings'?'settings-heading':`${page}-title`;
  const target=old?.getClientRects().length?old:document.getElementById(id);target?.focus({preventScroll:true});
}
