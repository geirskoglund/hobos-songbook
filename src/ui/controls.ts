const sources = import.meta.glob('../../assets/ui-icons/*.svg', {query:'?raw', import:'default', eager:true}) as Record<string,string>;
export function icon(name:string) {
  const source=Object.entries(sources).find(([path])=>path.endsWith(`/${name}.svg`))?.[1];
  if(!source)throw new Error(`Ukjent ikon: ${name}`);
  const parsed=new DOMParser().parseFromString(source.replaceAll(/#[0-9a-fA-F]{6}/g,'currentColor'),'image/svg+xml');
  const svg=document.importNode(parsed.documentElement,true) as unknown as SVGElement;
  svg.querySelectorAll('title').forEach(node=>node.remove());svg.removeAttribute('role');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('icon');return svg;
}
export function actionButton(name:string, action:()=>void, iconName?:string) {
  const node=document.createElement('button');node.type='button';
  if(iconName)node.append(icon(iconName));
  const label=document.createElement('span');label.textContent=name;node.append(label);node.addEventListener('click',action);return node;
}
export function textInput(id:string,value='',label?:string) {
  const field=document.createElement('input');field.type='text';field.id=id;field.value=value;field.autocomplete='off';field.className='text-control';if(label)field.setAttribute('aria-label',label);return field;
}
export function textArea(id:string,value:string,label:string,rows=5) {
  const field=document.createElement('textarea');field.id=id;field.value=value;field.rows=rows;field.className='text-control';field.setAttribute('aria-label',label);return field;
}
const editorIcons={save:'lagre',highlight:'gulmarkering',note:'notat',grid:'akkordskjema',text:'felles'};
export function iconButton(name:string, nameOrAlias:keyof typeof editorIcons, action:()=>void) {
  const node=actionButton('',action,editorIcons[nameOrAlias]);node.setAttribute('aria-label',name);node.dataset.tooltip=name;return node;
}
export interface DialogAction {id:string; label:string; run:()=>void; primary?:boolean; icon?:string; disabled?:boolean}
export function dialogFooter(actions:DialogAction[]) {
  if(actions.length<1||actions.length>3)throw new Error('En dialogfooter må ha 1–3 handlinger.');
  const footer=document.createElement('footer');footer.className='popup-actions dialog-footer';footer.dataset.count=String(actions.length);
  for(const action of actions){const button=actionButton(action.label,action.run,action.icon);button.dataset.action=action.id;button.classList.add(action.primary?'primary':'secondary');button.disabled=Boolean(action.disabled);footer.append(button);}
  return footer;
}
export function dialogFrame(name:string, variant='') {
  const box=document.createElement('dialog');box.className=`dialog-frame ${variant}`;box.setAttribute('aria-label',name);return box;
}
