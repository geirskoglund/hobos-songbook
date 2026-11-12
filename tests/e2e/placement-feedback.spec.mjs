import {test,expect} from '@playwright/test';
import {importSong,savedSongs,savedPersonal,tool,fillValue,editSong} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
test.beforeEach(async({page,request})=>{await request.post('/__test__/reset');await page.goto(url);});
async function addNote(page,row,text){await tool(page,'Notater',true);const r=await row.boundingBox();await row.click({position:{x:8,y:r.height-5}});await fillValue(page,'Notat',text);await expect(page.locator('.personal-note').filter({hasText:text})).toBeVisible();}
async function textPoint(row){return row.locator('.lyric').last().evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.left+3,y:r.top+r.height/2};});}
async function beginMove(page,note){const r=await note.boundingBox();await page.mouse.move(r.x+15,r.y+r.height/2);await page.mouse.down();await page.waitForTimeout(500);}

test('note connectors use lyric height, stay horizontal and keep the preview position after dropping near chorus headings',async({page})=>{
 const source='{t: Forankring}\n[C]Første linje\n{comment: Mellom}\n{soc}\n[G]Refrengets tekst\nAndre refrenglinje\n{eoc}\n{chorus}\nSiste tekstlinje';await importSong(page,'anchors.cho',source);await addNote(page,page.locator('.song-line').first(),'Husk');const id=Object.keys((await savedPersonal(page))[0].notes)[0];
 const note=page.locator('.personal-note'),line=page.locator('.annotation-connectors line');await expect.poll(async()=>line.evaluate(n=>Number(n.getAttribute('y1'))-Number(n.getAttribute('y2')))).toBe(0);expect(await line.evaluate(n=>Number(getComputedStyle(n).opacity))).toBeLessThan(.5);
 const target=page.locator('.chorus:not(.reference) .song-line').first(),point=await textPoint(target);await beginMove(page,note);await page.mouse.move(point.x,point.y,{steps:8});const ghost=page.locator('.note-drag-ghost');await expect(ghost).toBeVisible();const preview=await ghost.boundingBox();expect(Math.abs(preview.y+preview.height/2-point.y)).toBeLessThan(1);
 const moving=page.locator('.annotation-connectors line[data-dragging=true]');await expect.poll(async()=>moving.evaluate(n=>Number(n.getAttribute('y1'))-Number(n.getAttribute('y2')))).toBe(0);await page.mouse.up();await expect.poll(async()=>(await savedPersonal(page))[0].notes[id].line).toBe(2);await expect(page.locator('.note-overflow')).toHaveCount(0);await expect.poll(async()=>{const r=await note.boundingBox();return Math.abs(r.y+r.height/2-point.y);}).toBeLessThan(1);
 await beginMove(page,note);const heading=await page.locator('.reference > h2').boundingBox();await page.mouse.move(heading.x+5,heading.y+heading.height/2,{steps:8});await page.mouse.up();const saved=(await savedPersonal(page))[0].notes[id];expect(Number.isSafeInteger(saved.line)).toBe(true);await expect(page.locator('.note-overflow')).toHaveCount(0);expect((await savedSongs(page))[0].original).toBe(source);
 await page.reload();await page.locator('.song-choice').click();await expect(page.locator('.personal-note')).toHaveText('Husk');expect((await savedPersonal(page))[0].notes[id]).toEqual(saved);
});

test('dropping into an occupied note area keeps the original note and saved position',async({page})=>{
 const source='{t: To notater}\n'+Array.from({length:12},(_,i)=>`Linje ${i}`).join('\n');await importSong(page,'occupied.cho',source);await addNote(page,page.locator('.song-line').nth(0),'Første');await addNote(page,page.locator('.song-line').nth(8),'Andre');const before=(await savedPersonal(page))[0];
 const note=page.locator('.personal-note').filter({hasText:'Første'}),target=await textPoint(page.locator('.song-line').nth(7));await beginMove(page,note);await page.mouse.move(target.x,target.y,{steps:8});await expect(page.locator('.note-drag-ghost')).toHaveAttribute('data-invalid','true');await page.mouse.up();expect((await savedPersonal(page))[0].notes).toEqual(before.notes);await expect(page.locator('.note-overflow')).toHaveCount(0);
});

test('an already crowded note cannot show a valid drop at an anchor still occupied by its neighbor',async({page})=>{
 await importSong(page,'crowded.cho','{t: Tett}\n'+Array.from({length:12},(_,i)=>`Linje ${i}`).join('\n'));await addNote(page,page.locator('.song-line').nth(0),'Første');await addNote(page,page.locator('.song-line').nth(1),'Andre');const before=(await savedPersonal(page))[0];
 const note=page.locator('.personal-note').filter({hasText:'Andre'}),target=await textPoint(page.locator('.song-line').nth(1));await beginMove(page,note);await page.mouse.move(target.x,target.y,{steps:8});await expect(page.locator('.note-drag-ghost')).toHaveAttribute('data-invalid','true');await page.mouse.up();expect((await savedPersonal(page))[0].notes).toEqual(before.notes);await expect(note).toHaveText('Andre');
});

test('end placement offers immediate insertion or one compact pause and accepts a standalone chorus label',async({page})=>{
 const source='\uFEFF{t: Luft}\r\n{comment: Outro}\r\n';await importSong(page,'air.cho',source);await tool(page,'Gjenta refreng');await page.locator('.song-end').click({position:{x:10,y:66}});await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source+'\r\n{chorus}\r\n');await expect(page.locator('.reference > h2')).toHaveText('Refreng');await expect(page.locator('#song-body')).not.toContainText('ingen tidligere');
 const previous=await page.locator('.comment').boundingBox();await expect.poll(async()=>{const r=await page.locator('.reference > h2').boundingBox();return r.y-previous.y-previous.height;}).toBeGreaterThan(8);
 await tool(page,'Gjenta refreng');await page.locator('.song-end').click({position:{x:10,y:8}});await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source+'\r\n{chorus}\r\n{chorus}\r\n');
 await tool(page,'Anvisninger');await page.locator('.song-end').focus();await page.keyboard.press('Shift+Enter');await fillValue(page,'Anvisning','Slutt');const withComment=source+'\r\n{chorus}\r\n{chorus}\r\n\r\n{comment: Slutt}\r\n';await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(withComment);
 await tool(page,'Dynamikk');await page.locator('.song-end').click({position:{x:10,y:66}});await page.getByRole('spinbutton',{name:'Dynamikk',exact:true}).press('End');await page.keyboard.press('Escape');await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(withComment+'\r\n{x_dyn: 5}\r\n');expect(await page.locator('.dynamic-position').evaluate(n=>parseFloat(getComputedStyle(n).marginTop))).toBeCloseTo(13.2,1);
});

test('touch chord preview is enlarged above the finger and shows the exact lyric insertion boundary',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage();
 try{const source='{t: Akkord}\n[C]abcdef\nNeste';await page.goto('http://127.0.0.1:4173'+url);await importSong(page,'zoom.cho',source);await editSong(page);const chord=page.locator('.chord[data-chord-start]').first(),a=await chord.boundingBox(),point=await page.locator('.lyric').filter({hasText:'abcdef'}).evaluate(n=>{const range=document.createRange();range.setStart(n.firstChild,2);range.setEnd(n.firstChild,3);const r=range.getBoundingClientRect();return{x:r.right-1,y:r.top+r.height/2,edge:r.right};}),cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});await page.waitForTimeout(500);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y}]});const ghost=page.locator('.chord-drag-ghost');await expect(ghost).toBeVisible();await expect(ghost.locator('.chord-drag-context')).toHaveText('abc│def');const r=await ghost.boundingBox();expect(r.width).toBeGreaterThanOrEqual(90);expect(r.y+r.height).toBeLessThan(point.y-30);expect(Math.abs((await page.locator('.chord-drop-caret').boundingBox()).x-point.edge)).toBeLessThan(1);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source.replace('[C]abcdef','abc[C]def'));await page.getByRole('button',{name:'Angre',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source);
 }finally{await context.close();}
});

test('inserting on a blank line before an instruction keeps the existing instruction intact',async({page})=>{
 const source='{t: Behold anvisning}\nFør\n\n{comment: Behold denne}\nEtter';await importSong(page,'behold.cho',source);await tool(page,'Anvisninger');await page.locator('.song-space').first().focus();await page.keyboard.press('Enter');await expect(page.getByRole('textbox',{name:'Anvisning',exact:true})).toHaveValue('');await fillValue(page,'Anvisning','Ny anvisning');await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source.replace('{comment: Behold denne}','{comment: Ny anvisning}\n{comment: Behold denne}'));
});
