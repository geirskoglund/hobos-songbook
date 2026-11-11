import {test,expect} from '@playwright/test';
import {importSong,openMenu,openSettings,closeSettings} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const edit=async page=>{await page.getByRole('button',{name:'Rediger',exact:true}).click();await expect(page.locator('.edit-toolbar')).toBeVisible();};
const contextBlocked=async locator=>expect(await locator.evaluate(node=>!node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})))).toBe(true);
const hold=async(page,context,locator)=>{const r=await locator.boundingBox(),cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+15,y:r.y+15}]});await page.waitForTimeout(550);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('context menus are blocked throughout library, settings, performance and editing; app controls work',async({page})=>{
 await page.goto(url);for(const selector of ['#library-title','#page-title','#song-file','#menu-button'])await contextBlocked(page.locator(selector));
 await openSettings(page);for(const selector of ['#settings-heading','#font-size','#show-grids','.build'])await contextBlocked(page.locator(selector));await closeSettings(page);
 await importSong(page,'test.cho','{t: Sang}\n{sog}\n| C . |\n{eog}\n[C]Første linje\nAndre linje');
 for(const selector of ['#song-title','#chart-dock','.lyric'])await contextBlocked(page.locator(selector).first());
 await edit(page);await contextBlocked(page.locator('#capo-pill'));await page.locator('#capo-pill').click();await contextBlocked(page.locator('#personal-capo'));await expect(page.getByRole('menu',{name:'Tekstvalg'})).toHaveCount(0);await expect(page.locator('.popup-capo input')).toHaveCount(0);await page.getByRole('button',{name:'Avbryt',exact:true}).click();
 await page.getByRole('button',{name:'Akkordskjema',exact:true}).click();await contextBlocked(page.locator('#personal-grid'));await expect(page.getByRole('menu',{name:'Tekstvalg'})).toBeVisible();await page.keyboard.press('Escape');await page.keyboard.press('Escape');await expect(page.locator('.edit-popup')).toHaveCount(0);
 await page.getByRole('button',{name:'Notat',exact:true}).click();await page.locator('.song-line').first().click();await contextBlocked(page.locator('#annotation-note'));await page.keyboard.press('Escape');await page.locator('#annotation-note').fill('Lesbart');await page.getByRole('button',{name:'OK',exact:true}).click();await contextBlocked(page.locator('.personal-note'));
 await expect(page.locator('#app [title]')).toHaveCount(0);await page.getByRole('button',{name:'Markeringspenn'}).hover();await expect(page.getByRole('tooltip')).toContainText('Markeringspenn');
});

test('desktop selection is owned by the app and a completed highlight automatically puts the pen away',async({page})=>{
 await page.goto(url);await importSong(page,'tekst.txt','Første linje\nAndre linje\nTredje linje');await edit(page);
 const row=page.locator('.song-line'),a=await row.nth(0).locator('.lyric').first().boundingBox(),b=await row.nth(1).locator('.lyric').last().boundingBox();
 await page.mouse.move(a.x+1,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-1,b.y+b.height/2,{steps:10});await page.mouse.up();
 await expect(page.locator('.selection-preview[data-pending] span').first()).toBeVisible();expect(await page.evaluate(()=>getSelection().toString())).toBe('');await expect(page.locator('mark')).toHaveCount(0);
 const pen=page.getByRole('button',{name:'Markeringspenn'});await pen.click();await expect(row.nth(1).locator('mark').first()).toBeVisible();await expect(pen).toHaveAttribute('aria-pressed','false');
 await page.getByRole('button',{name:'Lagre',exact:true}).click();await expect(page.locator('#edit-save')).toBeDisabled();
 const c=await row.nth(2).locator('.lyric').first().boundingBox(),d=await row.nth(2).locator('.lyric').last().boundingBox();await page.mouse.move(c.x+1,c.y+c.height/2);await page.mouse.down();await page.mouse.move(d.x+d.width-1,d.y+d.height/2,{steps:6});await page.mouse.up();await expect(row.nth(2).locator('mark')).toHaveCount(0);await expect(page.locator('#edit-save')).toBeDisabled();
 await pen.click();await expect(row.nth(2).locator('mark').first()).toBeVisible();await expect(pen).toHaveAttribute('aria-pressed','false');
});

test('touch long press uses app text actions, supports select-all, copy and paste, and keeps editing transactional',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true}),page=await context.newPage();
 try{
  await page.goto('http://127.0.0.1:4173'+url);await importSong(page,'felt.cho','{sog}\n| C F |\n{eog}\nEn linje');await edit(page);await page.getByRole('button',{name:'Akkordskjema',exact:true}).tap();const field=page.locator('#personal-grid');
  await page.evaluate(()=>{window.copied='';const query=navigator.permissions.query.bind(navigator.permissions);navigator.permissions.query=async descriptor=>descriptor.name==='clipboard-read'?{state:'granted'}:query(descriptor);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;},readText:async()=> '| Am . G |'}});});
  await hold(page,context,field);const tools=page.getByRole('menu',{name:'Tekstvalg'});await expect(tools).toBeVisible();await tools.getByRole('menuitem',{name:'Merk alt'}).tap();expect(await field.evaluate(n=>[n.selectionStart,n.selectionEnd])).toEqual([0,7]);
  await tools.getByRole('menuitem',{name:'Kopier',exact:true}).tap();expect(await page.evaluate(()=>window.copied)).toBe('| C F |');await expect(page.locator('#personal-grid')).toBeVisible();
  await hold(page,context,field);await tools.getByRole('menuitem',{name:'Merk alt'}).tap();await tools.getByRole('menuitem',{name:'Lim inn',exact:true}).tap();await expect(field).toHaveValue('| Am . G |');await field.press('Control+z');await expect(field).toHaveValue('| C F |');await page.getByRole('button',{name:'Avbryt',exact:true}).tap();await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','shared');await expect(page.locator('#edit-save')).toBeDisabled();
  await page.getByRole('button',{name:'Akkordskjema',exact:true}).tap();await hold(page,context,field);await tools.getByRole('menuitem',{name:'Merk alt'}).tap();await page.keyboard.press('Backspace');await expect(field).toHaveValue('');await page.getByRole('button',{name:'OK',exact:true}).tap();
 }finally{await context.close();}
});

test('note relocation has no full-row outline, including when the note tool is armed',async({page})=>{
 await page.goto(url);await importSong(page,'notat.txt','En\nTo\nTre');await edit(page);await page.getByRole('button',{name:'Notat',exact:true}).click();await page.locator('.song-line').first().click();await page.locator('#annotation-note').fill('Flytt meg');await page.getByRole('button',{name:'OK',exact:true}).click();await page.getByRole('button',{name:'Notat',exact:true}).click();
 const n=await page.locator('.personal-note').boundingBox(),target=await page.locator('.song-line').nth(2).boundingBox();await page.mouse.move(n.x+4,n.y+4);await page.mouse.down();await page.waitForTimeout(500);await page.mouse.move(n.x+4,target.y+target.height/2,{steps:8});await expect(page.locator('.note-drag-ghost')).toBeVisible();
 expect(await page.locator('.song-line').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).outlineStyle==='none'))).toBe(true);await page.mouse.up();await expect(page.locator('.song-line').nth(2).locator('.personal-note')).toContainText('Flytt meg');
});

test('validation errors are app content, without native validation popups',async({page})=>{
 await page.goto(url);await importSong(page,'feil.txt','Tekst');await edit(page);await page.getByRole('button',{name:'Akkordskjema',exact:true}).click();await page.locator('#personal-grid').fill('Ingen taktstreker');await page.getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('.field-error')).toHaveText('Skriv et skjema med taktstreker.');await expect(page.locator('#personal-grid')).toHaveAttribute('aria-invalid','true');
 expect(await page.locator('#personal-grid').evaluate(n=>!n.dispatchEvent(new Event('invalid',{cancelable:true})))).toBe(true);await page.locator('#personal-grid').fill('| C |');await expect(page.locator('.field-error')).toHaveCount(0);await page.getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('#chart-dock')).toContainText('C');
});

test('touch reading has no native selection; a completed mark returns touch to normal scrolling',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true}),page=await context.newPage();
 try{
  await page.goto('http://127.0.0.1:4173'+url);await importSong(page,'lesing.txt',('En lang sanglinje\n').repeat(60));const cdp=await context.newCDPSession(page);let a=await page.locator('.song-line').first().locator('.lyric').first().boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+3,y:a.y+a.height/2}]});await page.waitForTimeout(550);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});expect(await page.evaluate(()=>getSelection().toString())).toBe('');await expect(page.locator('.app-text-actions')).toHaveCount(0);
  await edit(page);const pen=page.getByRole('button',{name:'Markeringspenn'});await pen.tap();a=await page.locator('.song-line').first().locator('.lyric').first().boundingBox();const b=await page.locator('.song-line').nth(1).locator('.lyric').last().boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+2,y:a.y+a.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width-2,y:b.y+b.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(pen).toHaveAttribute('aria-pressed','false');await page.locator('#edit-save').tap();await expect(page.locator('#edit-save')).toBeDisabled();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y:600}]});for(const y of [550,490,430,360])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:300,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(80);await expect(page.locator('#edit-save')).toBeDisabled();expect(await page.evaluate(()=>getSelection().toString())).toBe('');
 }finally{await context.close();}
});

test('paste never requests new clipboard permission; the app points to keyboard paste instead',async({page})=>{
 await page.goto(url);await importSong(page,'utklipp.txt','Tekst');await edit(page);await page.getByRole('button',{name:'Akkordskjema',exact:true}).click();
 await page.evaluate(()=>{window.clipboardReads=0;navigator.permissions.query=async()=>({state:'prompt'});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{window.clipboardReads++;return 'hemmelig';}}});});
 await contextBlocked(page.locator('#personal-grid'));await page.getByRole('menu',{name:'Tekstvalg'}).getByRole('menuitem',{name:'Lim inn'}).click();await expect(page.locator('.text-action-error')).toHaveText('Bruk tastaturets lim inn.');expect(await page.evaluate(()=>window.clipboardReads)).toBe(0);await expect(page.locator('#personal-grid')).toBeFocused();
});
