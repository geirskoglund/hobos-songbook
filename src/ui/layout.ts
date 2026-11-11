/** Shared viewport and app geometry. Consumers never copy header/toolbar heights. */
export const pages = ['library', 'reader', 'settings', 'setlists', 'sync', 'files'] as const;
export type Page = typeof pages[number];
export const pageNames: Record<Page, string> = {library:'Sanger', reader:'', settings:'Innstillinger', setlists:'Setlister', sync:'Synkronisering', files:'Filer'};
let layoutFrame=0;
export function requestLayout(){if(!layoutFrame)layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;document.dispatchEvent(new Event('app-layout'));});}
export function currentPage(): Page {return (document.documentElement.dataset.page as Page) || 'library';}
export function showPage(page: Page, canGoBack = page === 'reader') {
  document.documentElement.dataset.page = page;
  document.getElementById('back')!.hidden = !canGoBack;
  document.getElementById('back')!.setAttribute('aria-label',page==='settings'?'Tilbake':'← Mine sanger');
  for (const id of pages) document.getElementById(id)!.hidden = id !== page;
  document.getElementById('page-title')!.textContent = pageNames[page];
  document.body.classList.toggle('reader-active', page === 'reader');
  requestLayout();
  document.querySelectorAll<HTMLElement>('[data-page-action]').forEach(node => {node.hidden = node.dataset.pageAction !== page;});
  document.querySelectorAll<HTMLElement>('[data-destination]').forEach(node => {
    const selected = node.dataset.destination === (page === 'reader' ? 'library' : page);
    if (selected) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  });
}
export function overlayWidth(kind:'grid'|'value'|'note'){return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(kind==='grid'?'--content-width':kind==='value'?'--popup-value-width':'--popup-note-width'));}
export function viewport() {
  const v = visualViewport;
  return {x:v?.offsetLeft ?? 0, y:v?.offsetTop ?? 0, width:v?.width ?? innerWidth, height:v?.height ?? innerHeight};
}
export function placeOverlay(box: HTMLElement, anchor?: HTMLElement, options: {width?:number; align?:'start'|'end'|'center'; height?:number; fullscreen?:boolean; point?:{x:number;y:number}} = {}) {
  const v=viewport(), styles=getComputedStyle(document.documentElement);
  const unit=(name:string,fallback=0)=>parseFloat(styles.getPropertyValue(name))||fallback;
  const gap=unit('--space-3',12),leftGap=Math.max(gap,unit('--safe-left')),rightGap=Math.max(gap,unit('--safe-right')),topGap=Math.max(gap,unit('--safe-top')),bottomGap=Math.max(gap,unit('--safe-bottom'));
  if(options.fullscreen){Object.assign(box.style,{left:`${v.x}px`,top:`${v.y}px`,width:`${v.width}px`,height:`${v.height}px`});return;}
  box.style.maxWidth=`${v.width-leftGap-rightGap}px`;box.style.maxHeight=`${Math.max(80,v.height-topGap-bottomGap)}px`;
  if(options.width)box.style.width=`${Math.min(options.width,v.width-leftGap-rightGap)}px`;
  if(options.height)box.style.maxHeight=`${Math.max(80,Math.min(v.height-topGap-bottomGap,v.height*options.height))}px`;
  const rect=anchor?.getBoundingClientRect();
  const left=options.point?.x ?? (options.align==='center'||!rect?v.x+(v.width-box.offsetWidth)/2:options.align==='end'?rect.right-box.offsetWidth:rect.left);
  box.style.left=`${Math.max(v.x+leftGap,Math.min(left,v.x+v.width-box.offsetWidth-rightGap))}px`;
  box.style.top=`${Math.max(v.y+topGap,Math.min(options.point?.y ?? (rect?rect.bottom+8:v.y+(v.height-box.offsetHeight)/2),v.y+v.height-box.offsetHeight-bottomGap))}px`;
}
export function readingTop() {
  let top=document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
  for(const selector of ['.edit-toolbar','#chart-dock[data-sticky="true"]']) {
    const rect=document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
    if(rect?.height && rect.top<=top+1)top=Math.max(top,rect.bottom);
  }
  return top;
}
export function startLayout() {
  const root=document.documentElement, header=document.querySelector<HTMLElement>('.topbar')!;
  let toolbar:HTMLElement|null=null;
  const measure=()=>{
    root.style.setProperty('--header-height',`${header.getBoundingClientRect().height}px`);
    root.style.setProperty('--toolbar-height',`${toolbar?.getBoundingClientRect().height ?? 0}px`);
  };
  const sizes=new ResizeObserver(measure);sizes.observe(header);
  const sync=()=>{
    const next=document.querySelector<HTMLElement>('.edit-toolbar');
    if(next!==toolbar){if(toolbar)sizes.unobserve(toolbar);toolbar=next;if(toolbar)sizes.observe(toolbar);}
    measure();
  };
  new MutationObserver(sync).observe(document.getElementById('app')!,{childList:true,subtree:true});
  window.addEventListener('resize',measure);document.fonts.addEventListener('loadingdone',requestLayout);sync();
}
