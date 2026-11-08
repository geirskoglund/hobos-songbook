import {test,expect} from '@playwright/test';
import {importSong,openMenu,savedSongs} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const edit=async page=>{await openMenu(page);await page.getByRole('button',{name:'Rediger',exact:true}).click();await expect(page.locator('.edit-toolbar')).toBeVisible();};
const save=async page=>{await page.locator('#edit-save').click();await expect(page.locator('#edit-save')).toBeDisabled();};
const state=page=>page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,t=db.transaction('personal'),get=t.objectStore('personal').getAll();t.oncomplete=()=>{db.close();resolve(get.result);};};}));
const line=(page,index)=>page.locator(`[data-occurrence="source/line:${index}"]`);
async function note(page,index,text){await page.getByRole('button',{name:'Notat',exact:true}).click();await line(page,index).click();await page.locator('#annotation-note').fill(text);await page.getByRole('button',{name:'OK',exact:true}).click();}
async function selectAcross(page,startLine,start,endLine,end){
 await page.evaluate(({startLine,start,endLine,end})=>{
  function point(index,at){const line=document.querySelector(`[data-occurrence="source/line:${index}"]`);for(const lyric of line.querySelectorAll('.lyric')){const from=Number(lyric.dataset.offset),len=Number(lyric.dataset.length);if(!len||at<from||at>from+len)continue;const walker=document.createTreeWalker(lyric,NodeFilter.SHOW_TEXT);let node,local=at-from;while(node=walker.nextNode()){if(local<=node.length)return[node,local];local-=node.length;}}throw Error('missing offset');}
  const range=document.createRange();range.setStart(...point(startLine,start));range.setEnd(...point(endLine,end));getSelection().removeAllRanges();getSelection().addRange(range);
 },{startLine,start,endLine,end});
}
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('toolbar spans the viewport and never moves during initial or later scrolling',async({page})=>{
 await page.goto(url);await importSong(page,'lang.txt',('Sangtekst\n').repeat(100));await edit(page);
 for(const width of [320,768,1440]){
  await page.setViewportSize({width,height:800});await page.evaluate(()=>scrollTo(0,0));const header=await page.locator('.topbar').boundingBox();
  for(const y of [0,1,3,10,80,450,0]){await page.evaluate(y=>scrollTo(0,y),y);const rect=await page.locator('.edit-toolbar').boundingBox();expect(rect.x).toBe(0);expect(rect.width).toBe(width);expect(rect.y).toBe(header.y+header.height);}
  const title=await page.locator('#song-title').boundingBox(),tools=await page.locator('.edit-toolbar').boundingBox();expect(title.y).toBeGreaterThanOrEqual(tools.y+tools.height);
 }
});

test('a multiline highlight stays one editable group across chords, wrapping, save and reopening',async({page})=>{
 const original='[D]Første linje\n[G]Andre linje\n[A]Tredje linje\nSiste linje';await page.goto(url);await importSong(page,'flere.txt',original);await edit(page);
 await selectAcross(page,0,2,2,6);await page.getByRole('button',{name:'Markeringspenn'}).click();
 expect((await line(page,0).locator('mark').allTextContents()).join('')).toBe('rste linje');expect((await line(page,1).locator('mark').allTextContents()).join('')).toBe('Andre linje');expect((await line(page,2).locator('mark').allTextContents()).join('')).toBe('Tredje');await save(page);
 const annotations=(await state(page))[0].annotations,ids=[0,1,2].map(index=>annotations[`source/line:${index}`].highlights[0].groupId);expect(new Set(ids).size).toBe(1);expect(ids[0]).toBeTruthy();
 await page.locator('#back').click();await expect(page.locator('.edit-toolbar')).toHaveCount(0);await edit(page);await page.setViewportSize({width:320,height:800});await line(page,1).locator('mark').first().click();
 await page.getByRole('slider',{name:'Dra slutten på markeringen'}).focus();for(let i=0;i<8;i++)await page.keyboard.press('ArrowLeft');await save(page);
 expect((await state(page))[0].annotations['source/line:2'].highlights).toEqual([]);expect((await state(page))[0].annotations['source/line:1'].highlights[0].end).toBe(9);
 await line(page,0).locator('mark').first().click();await page.getByRole('button',{name:'Fjern markering'}).click();await expect(page.locator('mark')).toHaveCount(0);await save(page);expect((await savedSongs(page))[0].original).toBe(original);
});

test('touch pen selects multiple lines with its own preview and no native selection',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true}),page=await context.newPage();
 try{
  await page.goto('http://127.0.0.1:4173'+url);await importSong(page,'touch.txt','Første linje\nAndre linje\nTredje linje\n'+('Mer sang\n').repeat(20));await edit(page);await page.getByRole('button',{name:'Markeringspenn'}).tap();
  const a=await line(page,0).locator('.lyric').first().boundingBox(),b=await line(page,2).locator('.lyric').last().boundingBox(),cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+2,y:a.y+a.height/2}]});await page.waitForTimeout(600);
  for(const ratio of [.2,.4,.6,.8,1])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+2+(b.x+b.width-2-a.x-2)*ratio,y:a.y+a.height/2+(b.y+b.height/2-a.y-a.height/2)*ratio}]});
  await expect(page.locator('.selection-preview span').first()).toBeVisible();expect(await page.evaluate(()=>{const lyrics=[...document.querySelectorAll('.lyric')].flatMap(n=>[...n.getClientRects()]);return [...document.querySelectorAll('.selection-preview span')].every(n=>{const p=n.getBoundingClientRect();return lyrics.some(l=>p.top>=l.top-1&&p.bottom<=l.bottom+1);});})).toBe(true);expect(await page.evaluate(()=>getSelection().toString())).toBe('');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(line(page,0).locator('mark').first()).toBeVisible();await expect(line(page,1).locator('mark').first()).toBeVisible();await expect(line(page,2).locator('mark').first()).toBeVisible();
  await page.locator('#edit-save').tap();await expect(page.locator('#edit-save')).toBeDisabled();
  await page.getByRole('button',{name:'Fjern markering'}).tap();await expect(page.locator('mark')).toHaveCount(0);await expect(page.locator('.edit-popup')).toHaveCount(0);expect(await page.locator('#song-body').evaluate(node=>!node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})))).toBe(true);
 }finally{await context.close();}
});

test('long hold moves a note to a new anchor; Escape and an occupied target preserve both notes',async({page})=>{
 await page.goto(url);await importSong(page,'flytt.txt','En\nTo\nTre\nFire\nFem\n'+('Les videre\n').repeat(25));await edit(page);await note(page,0,'Flytt meg');await note(page,3,'Behold meg');await save(page);
 let rect=await line(page,0).locator('.personal-note').boundingBox(),target=await line(page,2).boundingBox();await page.mouse.move(rect.x+6,rect.y+6);await page.mouse.down();await page.waitForTimeout(500);await expect(page.locator('.note-drag-ghost')).toBeVisible();await page.mouse.move(rect.x+6,target.y+target.height/2,{steps:10});await page.mouse.up();
 await expect(line(page,2).locator('.personal-note')).toContainText('Flytt meg');await expect(line(page,0).locator('.personal-note')).toHaveCount(0);await expect(page.locator('.edit-popup')).toHaveCount(0);expect((await state(page))[0].annotations['source/line:0'].note).toBe('Flytt meg');await save(page);
 const stored=(await state(page))[0];expect(stored.annotations['source/line:2'].anchor.sourceLine).toBe(2);expect(stored.annotations['source/line:2'].anchor.text).toBe('Tre');expect(stored.annotations['source/line:0'].note).toBe('');
 rect=await line(page,2).locator('.personal-note').boundingBox();target=await line(page,3).boundingBox();await page.mouse.move(rect.x+6,rect.y+6);await page.mouse.down();await page.waitForTimeout(500);await page.mouse.move(rect.x+6,target.y+target.height/2);await page.mouse.up();await expect(line(page,2).locator('.personal-note')).toContainText('Flytt meg');await expect(line(page,3).locator('.personal-note')).toContainText('Behold meg');await expect(page.locator('#edit-save')).toBeDisabled();
 await page.mouse.move(rect.x+6,rect.y+6);await page.mouse.down();await page.waitForTimeout(500);target=await line(page,4).boundingBox();await page.mouse.move(rect.x+6,target.y+target.height/2);await page.keyboard.press('Escape');await page.mouse.up();await expect(line(page,2).locator('.personal-note')).toContainText('Flytt meg');await expect(page.locator('.note-drag-ghost')).toHaveCount(0);
 await line(page,2).locator('.personal-note').focus();await page.keyboard.press('Alt+ArrowUp');await expect(line(page,1).locator('.personal-note')).toContainText('Flytt meg');await save(page);
});

test('touch hold moves notes while movement before the hold remains a scroll gesture',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true}),page=await context.newPage();
 try{
  await page.goto('http://127.0.0.1:4173'+url);await importSong(page,'touch-note.txt','En\nTo\nTre\n'+('Videre\n').repeat(70));await edit(page);await note(page,0,'Herfra');await save(page);
  let a=await line(page,0).locator('.personal-note').boundingBox(),b=await line(page,2).boundingBox();const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+8,y:a.y+6}]});await page.waitForTimeout(500);await expect(page.locator('.note-drag-ghost')).toBeVisible();await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+8,y:b.y+b.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(line(page,2).locator('.personal-note')).toContainText('Herfra');await save(page);await line(page,2).locator('.personal-note').tap();await expect(page.locator('#annotation-note')).toHaveValue('Herfra');await page.getByRole('button',{name:'Avbryt',exact:true}).tap();
  a=await line(page,2).locator('.personal-note').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+8,y:a.y+6}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+8,y:a.y-70}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(30);await expect(page.locator('.edit-popup,.note-drag-ghost')).toHaveCount(0);
 }finally{await context.close();}
});

test('chart uses content width and explicit empty cells; no inferred beats, repeated bar columns or four-dot limit',async({page})=>{
 await page.setViewportSize({width:1000,height:900});await page.goto(url);const original='{sog: shape="4x4"}\nVers |: Am | F | C | G :|\nRef | Am F | C G | F G | Am ||\n{eog}\nTekst';await importSong(page,'banner.cho',original);
 const first=page.locator('.grid-row').first(),bars=first.locator('.grid-measure');await expect(bars).toHaveCount(4);await expect(first.locator('.grid-cell')).toHaveCount(4);
 const widths=await bars.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));expect(Math.max(...widths)).toBeLessThan(80);expect(widths[1]).toBeLessThan(widths[0]);await expect(bars.nth(1).locator('.grid-barline')).toHaveCount(1);
 await edit(page);await page.getByRole('button',{name:'Akkordskjema',exact:true}).click();await page.locator('#personal-grid').fill('| . . Am F | Am . . . . . G |');await page.getByRole('button',{name:'OK',exact:true}).click();
 await expect(page.locator('.grid-cell[aria-label="Tom akkordcelle"]')).toHaveCount(7);await expect(page.locator('#chart-dock')).not.toContainText('·');
 const cells=await page.locator('.grid-measure').first().locator('.grid-cell').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width})));expect(cells[2].x-cells[0].x).toBeGreaterThan(50);expect(cells[2].x-cells[0].x).toBeLessThan(100);
 await save(page);expect((await state(page))[0].chordGrid).toContain('. . . . .');expect((await savedSongs(page))[0].original).toBe(original);
});

test('pen scrolls at the edge and cancelling a subsequent selection keeps the saved group',async({page})=>{
 await page.setViewportSize({width:390,height:800});await page.goto(url);await importSong(page,'kant.txt',('[D]En linje med akkord\n').repeat(90));await edit(page);await page.getByRole('button',{name:'Markeringspenn'}).click();const a=await line(page,0).locator('.lyric').first().boundingBox();
 await page.mouse.move(a.x+1,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+30,790,{steps:12});await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(150);await page.mouse.up();await save(page);
 const stored=await state(page);const marked=Object.values(stored[0].annotations).filter(a=>a.highlights.length);expect(marked.length).toBeGreaterThan(10);expect(new Set(marked.flatMap(a=>a.highlights.map(h=>h.groupId))).size).toBe(1);
 await page.evaluate(()=>scrollTo(0,0));const start=await line(page,0).locator('.lyric').last().boundingBox(),end=await line(page,2).locator('.lyric').last().boundingBox();await page.mouse.move(start.x+1,start.y+start.height/2);await page.mouse.down();await page.mouse.move(end.x+end.width-1,end.y+end.height/2,{steps:6});await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('#edit-save')).toBeDisabled();expect(await state(page)).toEqual(stored);await expect(page.locator('.selection-preview span')).toHaveCount(0);
});
