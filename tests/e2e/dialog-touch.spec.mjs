import {test,expect} from '@playwright/test';
import {importSong,openMenu,savedSongs,setDisplay} from './song-helpers.mjs';
const url='http://127.0.0.1:4173/hobos-songbook/test/';
const modal=page=>page.getByRole('dialog',{name:'Rediger sangtekst',exact:true});
const fresh=async page=>{await openMenu(page);await page.getByRole('button',{name:'Ny sang',exact:true}).tap();await expect(modal(page)).toBeVisible();};
const tap=async(page,locator)=>{const r=await locator.boundingBox();await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);};

test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('short touches preserve native text activation in new songs and note fields',async({browser})=>{
 const context=await browser.newContext({viewport:{width:768,height:1024},hasTouch:true,isMobile:true}),page=await context.newPage();
 try{
  await page.goto(url);
  await page.evaluate(()=>{window.textTouches=[];for(const type of ['touchstart','touchend'])document.addEventListener(type,e=>{if(e.target.matches('input,textarea'))window.textTouches.push({id:e.target.id,type,blocked:e.defaultPrevented});});});
  await fresh(page);await page.locator('#original-title').tap();await expect(page.locator('#original-title')).toBeFocused();await page.keyboard.insertText('Ny sang');
  await page.locator('#original-text').tap();await page.keyboard.insertText('En tekstlinje');
  expect(await page.evaluate(()=>window.textTouches)).toEqual(expect.arrayContaining([{id:'original-title',type:'touchstart',blocked:false},{id:'original-title',type:'touchend',blocked:false},{id:'original-text',type:'touchstart',blocked:false}]));
  await modal(page).getByRole('button',{name:'OK',exact:true}).tap();await page.getByRole('button',{name:'Notat',exact:true}).tap();await page.locator('.song-line').first().tap();
  await page.locator('#annotation-note').tap();await expect(page.locator('#annotation-note')).toBeFocused();await page.keyboard.insertText('Notat i ny sang');await page.getByRole('dialog',{name:'Notat',exact:true}).getByRole('button',{name:'OK',exact:true}).tap();await expect(page.locator('.personal-note')).toContainText('Notat i ny sang');
  await page.locator('#back').tap();await page.getByRole('button',{name:'Forkast endringer',exact:true}).tap();
  await importSong(page,'struktur.cho','{t: Eksisterende}\n{soc}\n[D]Samme tekst\n{eoc}\n{chorus}');await openMenu(page);await page.getByRole('button',{name:'Rediger',exact:true}).tap();await page.getByRole('button',{name:'Notat',exact:true}).tap();await page.locator('.song-line').first().tap();
  await page.locator('#annotation-note').tap();await page.keyboard.insertText('Notat i eksisterende sang');await page.getByRole('dialog',{name:'Notat',exact:true}).getByRole('button',{name:'OK',exact:true}).tap();await expect(page.locator('.personal-note')).toContainText('Notat i eksisterende sang');
  const noteEvents=await page.evaluate(()=>window.textTouches.filter(e=>e.id==='annotation-note'));expect(noteEvents.length).toBeGreaterThan(0);expect(noteEvents.every(e=>!e.blocked)).toBe(true);
 }finally{await context.close();}
});

for(const value of ['', 'Banan'])test(`dialog actions retain their touch target while the keyboard can resize: ${value || 'empty title'}`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage();
 try{
  await page.goto(url);
  await page.evaluate(()=>{
   window.keyboardHeight=844;window.keyboardDismissals=0;
   Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>window.keyboardHeight});
   const resize=height=>{window.keyboardHeight=height;visualViewport.dispatchEvent(new Event('resize'));};
   document.addEventListener('focusin',event=>{if(event.target.matches('input,textarea'))resize(420);});
   document.addEventListener('focusout',event=>{if(event.target.matches('input,textarea')){window.keyboardDismissals++;resize(844);}});
   // Model the keyboard dismissal that may occur when a touch takes focus off an input.
   document.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'&&event.target.closest('.popup-actions')&&!event.defaultPrevented)document.activeElement.blur();});
  });
  await fresh(page);const title=page.locator('#original-title');await title.tap();if(value)await page.keyboard.insertText(value);
  const ok=modal(page).getByRole('button',{name:'OK',exact:true}),cancel=modal(page).getByRole('button',{name:'Avbryt',exact:true});
  const initial=await ok.boundingBox();
  if(!value){await expect(ok).toBeDisabled();await tap(page,ok);await expect(title).toBeFocused();expect(await ok.boundingBox()).toEqual(initial);expect(await page.evaluate(()=>window.keyboardDismissals)).toBe(0);}
  await tap(page,cancel);await expect(modal(page)).toHaveCount(0);await expect(page.locator('#library')).toBeVisible();expect(await savedSongs(page)).toEqual([]);
  await fresh(page);await title.tap();await page.keyboard.insertText('Gyldig tittel');await tap(page,modal(page).getByRole('button',{name:'OK',exact:true}));await expect(modal(page)).toHaveCount(0);await expect(page.locator('#song-title')).toHaveText('Gyldig tittel');
 }finally{await context.close();}
});

test('title and lyrics share the chosen size and metadata popups center their short field',async({browser},testInfo)=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage();
 try{
 await page.goto(url);await fresh(page);await page.locator('#original-title').fill('Banan');await page.locator('#original-text').fill('Det er\nDet beste\nJeg vet');await modal(page).getByRole('button',{name:'OK',exact:true}).click();
 for(const fontSize of [16,22,36]){
  await setDisplay(page,{fontSize});await page.locator('#edit-original').click();
  for(const selector of ['#original-title','#original-text'])await expect(page.locator(selector)).toHaveCSS('font-size',`${fontSize}px`);
  for(const [id,name] of [['key','Toneart'],['time','Takt']]){
   await page.locator(`#original-${id}`).click();const popup=page.getByRole('dialog',{name,exact:true}),field=popup.getByRole('textbox',{name,exact:true});
   const bounds=await popup.boundingBox(),input=await field.boundingBox();expect(bounds.width).toBeLessThanOrEqual(200);expect(Math.abs(input.x+input.width/2-bounds.x-bounds.width/2)).toBeLessThan(1);
   await expect(field).toHaveCSS('text-align','center');await expect(popup.locator('h2')).toHaveCSS('text-align','center');
   await page.screenshot({path:testInfo.outputPath(`${id}-${fontSize}.png`)});await popup.getByRole('button',{name:'Avbryt',exact:true}).click();
  }
  await page.screenshot({path:testInfo.outputPath(`editor-${fontSize}.png`)});await modal(page).getByRole('button',{name:'Avbryt',exact:true}).click();
 }
 }finally{await context.close();}
});
