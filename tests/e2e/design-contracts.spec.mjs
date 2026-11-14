import {test,expect} from '@playwright/test';
import {openMenu,goSongs,beginCreate} from './song-helpers.mjs';

// Expectations come from DESIGN's source-linked table and the original SVGs.
// Never derive them from runtime CSS tokens or update them to match a regression.
const url='/hobos-songbook/test/';
const dialog=(page,name)=>page.getByRole('dialog',{name,exact:true});
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const go=async(page,name)=>{await openMenu(page);await button(page,name).click();};
const height=async node=>(await node.boundingBox()).height;
async function footer(box){
  const actions=box.locator('.dialog-footer');
  await expect(actions).toHaveCSS('background-color','rgb(50, 46, 42)');
  for(const action of await actions.locator('button').all()){
    expect(await height(action)).toBeGreaterThanOrEqual(80);
    await expect(action).toHaveCSS('font-size','18px');
  }
  await expect(actions.locator('.primary')).toHaveCSS('background-color','rgb(226, 192, 151)');
  await expect(actions.locator('.primary')).toHaveCSS('color','rgb(39, 36, 33)');
}
async function field(box){
  const input=box.getByLabel('Navn',{exact:true});
  expect(await height(input)).toBeCloseTo(59,0);
  await expect(input).toHaveCSS('font-size','18px');
  await expect(input).toHaveCSS('border-radius','8px');
  await expect(input).toHaveCSS('background-color','rgb(50, 46, 42)');
  await box.locator('label').click();await expect(input).toBeFocused();
  await input.press('Tab');await input.focus();
  const focus=await input.evaluate(n=>{const s=getComputedStyle(n);return {width:parseFloat(s.outlineWidth),outside:parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset)};});
  expect(focus.width).toBeGreaterThan(0);expect(focus.outside).toBeLessThanOrEqual(0);
  await expect(box).toHaveCSS('border-radius','24px');await footer(box);
}
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

for(const width of [320,768,1440])test(`shared design contracts at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto(url);await expect(page.locator('#add-song')).toBeEnabled();
  await page.evaluate(()=>new Promise(resolve=>{
    const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songbooks','setlists'],'readwrite');
      for(const store of ['songbooks','setlists'])for(const [id,name] of [['a','A'],['b','B'],['long','Å'.repeat(200)]])tx.objectStore(store).put({id,name,createdAt:1,songIds:[]});
      tx.oncomplete=()=>{db.close();resolve();};};
  }));await page.reload();await expect(page.locator('#add-song')).toBeEnabled();
  for(const [name,id,add,edit] of [['Setlister','setlist','#add-setlist','Endre info'],['Sangbøker','songbook','#add-songbook','Endre navn']]){
    await go(page,name);const rows=page.locator(`#${id}-list .count-row`),first=rows.first();
    expect(await height(first)).toBeCloseTo(115,0);
    await expect(first.locator('.song-name')).toHaveCSS('font-size','22px');
    await expect(first.locator('.row-metadata')).toHaveCSS('font-size','15px');
    const a=await rows.nth(0).boundingBox(),b=await rows.nth(1).boundingBox();expect(b.y-a.y).toBeCloseTo(115,0);
    const long=page.locator(`#${id}-long`);expect(await height(long)).toBeGreaterThan(114);
    await expect(long).toHaveJSProperty('scrollWidth',await long.evaluate(n=>n.clientWidth));
    await page.locator(add).click();const create=dialog(page,id==='setlist'?'Ny setliste':'Ny sangbok');await field(create);await button(create,'Avbryt').click();
    await first.locator('.row-menu').click();const menu=page.locator('.context-menu');
    await expect(menu).toHaveCSS('background-color','rgb(64, 56, 49)');await expect(menu).toHaveCSS('border-radius','16px');
    expect((await menu.boundingBox()).width).toBeCloseTo(265,0);expect(await height(menu)).toBeCloseTo(139,0);
    await expect(menu.getByRole('menuitem').first()).toHaveCSS('font-size','17px');
    await menu.getByRole('menuitem',{name:edit,exact:true}).click();await field(page.locator('dialog[open]'));await button(page.locator('dialog[open]'),'Avbryt').click();
  }
  await goSongs(page);await page.locator('#songbook-filter').click();const filter=dialog(page,'Sangbok');
  await expect(filter.locator('.choice-value')).toHaveCSS('font-size','23px');expect(await height(filter.locator('.choice-value'))).toBeCloseTo(68,0);
  await page.getByRole('option',{name:'Standard',exact:true}).click();
  await page.locator('#add-song').click();await page.getByRole('menuitem',{name:'Opprett',exact:true}).click();const step=dialog(page,'Opprett i sangbok');
  await expect(step).toHaveCSS('border-radius','24px');await footer(step);
  const value=step.locator('.choice-value');expect(await height(value)).toBeCloseTo(68,0);await expect(value).toHaveCSS('font-size','23px');await value.click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(step.getByRole('heading')).toHaveCount(1);
  const inset=await step.locator('.choice-create').evaluate(n=>{const p=n.parentElement.getBoundingClientRect(),r=n.getBoundingClientRect(),s=getComputedStyle(n,'::before');return [r.left-p.left+parseFloat(s.left),p.right-r.right+parseFloat(s.right)];});
  expect(inset[0]).toBeCloseTo(22,0);expect(inset[1]).toBeCloseTo(22,0);
  await button(step,'Ny sangbok').click();await field(dialog(page,'Ny sangbok'));await button(dialog(page,'Ny sangbok'),'Avbryt').click();
  if(width===320){
    await page.setViewportSize({width,height:420});await value.click();
    await button(step,'Ny sangbok').scrollIntoViewIfNeeded();await expect(button(step,'Ny sangbok')).toBeInViewport();await expect(button(step,'Avbryt')).toBeInViewport();
    await page.setViewportSize({width,height:900});
  }
  if(await value.getAttribute('aria-expanded')==='false')await value.click();
  await step.getByRole('option',{name:'Å'.repeat(200),exact:true}).click();
  expect(await height(value)).toBeGreaterThan(68);expect(await value.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);await footer(step);
  await button(step,'Avbryt').click();await beginCreate(page);const raw=dialog(page,'Råtekst');await footer(raw);await expect(raw).toHaveCSS('border-radius','0px');await button(raw,'Avbryt').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('E02/E03/E04 share the real footer geometry and secondary separator rules',async({page})=>{
  await page.goto(url);await expect(page.locator('#add-song')).toBeEnabled();
  for(const width of [320,768])for(const count of [1,2,3]){
    await page.setViewportSize({width,height:700});
    await page.evaluate(async count=>{
      const {dialogFrame,dialogFooter}=await import('/__test__/controls.js');
      const box=dialogFrame('Footerkontrakt','name-dialog'),heading=document.createElement('h2');heading.textContent='Kontroll';
      const actions=Array.from({length:count},(_,i)=>({id:String(i),label:i===count-1?'Lagre':i===0?'Avbryt':'Tilbake',icon:i===count-1?'lagre':i===0?'avbryt':undefined,primary:i===count-1,run:()=>{box.close();box.remove();}}));
      box.append(heading,dialogFooter(actions));document.body.append(box);box.showModal();
    },count);
    const box=dialog(page,'Footerkontrakt');await footer(box);await expect(box).toHaveCSS('border-radius','24px');
    const actions=await box.locator('.dialog-footer button').all();for(const action of actions)expect(await height(action)).toBeCloseTo(80,0);
    const separators=await box.locator('.dialog-footer button').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n,'::before');return {content:s.content,top:s.top,bottom:s.bottom};}));
    expect(separators.filter(s=>s.content!=='none')).toEqual(count===3?[{content:'""',top:'12px',bottom:'12px'}]:[]);
    await button(box,'Lagre').click();
  }
});
