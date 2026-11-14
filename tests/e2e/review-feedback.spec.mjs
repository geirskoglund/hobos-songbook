import {test,expect} from '@playwright/test';
import {importSong,savedSongs,savedPersonal,tool,fillValue,editSong,setCapo} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
test.beforeEach(async({page,request})=>{await request.post('/__test__/reset');await page.goto(url);});

test('duplicate title aliases update together; free time saves and invalid input can close outside',async({page})=>{
 const source='\uFEFF{t: Før}\r\n{title: Sist}\r\n{time: 4/4}\r\nOrd';
 await importSong(page,'alias.cho',source);await tool(page,'Tittel');await fillValue(page,'Tittel','Begge');
 await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source.replace('Før','Begge').replace('Sist','Begge'));
 await tool(page,'Takt');await fillValue(page,'Takt','4/4 Trainbeat');await expect(page.locator('.song-metadata')).toContainText('4/4 Trainbeat');
 await tool(page,'Tittel');await page.getByRole('textbox',{name:'Tittel',exact:true}).fill('');await expect(page.locator('.value-control .field-error')).toContainText('tittel');
 await page.mouse.click(2,page.viewportSize().height-2);await expect(page.locator('.value-control')).toHaveCount(0);expect((await savedSongs(page))[0].title).toBe('Begge');
 await tool(page,'Tittel');await page.getByRole('textbox',{name:'Tittel',exact:true}).fill('');await page.keyboard.press('Escape');await expect(page.locator('.value-control')).toHaveCount(0);expect((await savedSongs(page))[0].title).toBe('Begge');
});

test('new raw source starts inside title; brackets preserve focus, caret and local history',async({page})=>{
 await page.locator('#add-song').click();await page.getByRole('menuitem',{name:'Opprett',exact:true}).click();await page.getByRole('dialog',{name:'Opprett i sangbok',exact:true}).getByRole('button',{name:'Fortsett',exact:true}).click();const field=page.locator('#original-text');
 await expect(field).toHaveValue('{t: }\n');await expect(field).toBeFocused();expect(await field.evaluate(f=>f.selectionStart)).toBe(4);
 await field.fill('{t: Ny}\nOrd');await field.evaluate(f=>{f.setSelectionRange(f.value.length,f.value.length);window.blurs=0;f.addEventListener('blur',()=>window.blurs++);});
 await page.getByRole('button',{name:'Sett inn []',exact:true}).click();await expect(field).toHaveValue('{t: Ny}\nOrd[]');await expect(field).toBeFocused();expect(await page.evaluate(()=>window.blurs)).toBe(0);expect(await field.evaluate(f=>f.selectionStart)).toBe('{t: Ny}\nOrd['.length);
 await field.press('ControlOrMeta+z');await expect(field).toHaveValue('{t: Ny}\nOrd');expect(await savedSongs(page)).toEqual([]);
 await page.getByRole('button',{name:'Lagre',exact:true}).click();await expect(page.locator('.edit-toolbar')).toBeVisible();await expect(page.locator('#song-title')).toHaveText('Ny');
});

test('toolbar value controls open just below toolbar and tuning does not rebuild the song',async({page})=>{
 await importSong(page,'tuning.cho','{t: Stemming}\nOrd');await tool(page,'Stemming',true);
 const toolbar=await page.locator('.edit-toolbar').boundingBox(),control=await page.locator('.value-control').boundingBox(),button=await page.getByRole('button',{name:'Stemming',exact:true}).boundingBox();
 expect(control.y-toolbar.y-toolbar.height).toBeGreaterThanOrEqual(10);expect(control.y-toolbar.y-toolbar.height).toBeLessThanOrEqual(16);expect(Math.abs(control.x-button.x)).toBeLessThan(2);
 await page.evaluate(()=>window.songNode=document.getElementById('song-body'));await page.getByRole('textbox',{name:'Stemming',exact:true}).pressSequentially('Drop D',{delay:230});
 await expect.poll(async()=>(await savedPersonal(page))[0].tuning).toBe('Drop D');expect(await page.evaluate(()=>window.songNode===document.getElementById('song-body')&&window.songNode.isConnected)).toBe(true);
 await page.keyboard.press('Escape');await tool(page,'Capo',true);const capo=await page.locator('.value-control').boundingBox();expect(capo.y-toolbar.y-toolbar.height).toBeGreaterThanOrEqual(10);await page.keyboard.press('Escape');
 await tool(page,'Notater',true);await page.locator('.song-line').click();expect(await page.getByRole('textbox',{name:'Notat',exact:true}).evaluate(n=>n.tagName)).toBe('INPUT');
});

test('note tool and F05 leave lyrics in place; the connector follows a held move',async({page})=>{
 await importSong(page,'layout.cho','{t: Layout}\n{soc}\nUnder the banner of Heaven\nIt is hard to see the sky\nWhen you have tasted all Seven\nEmbrace your lullaby\n{eoc}\n\nEtter');await editSong(page);
 const positions=()=>page.locator('.song-line').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));const before=await positions();await tool(page,'Notater',true);expect(await positions()).toEqual(before);
 const row=page.locator('.song-line').nth(2),at=await row.boundingBox();await row.click({position:{x:10,y:at.height/2}});const popup=await page.locator('.value-control').boundingBox();expect(Math.abs(popup.y-(at.y+at.height/2))).toBeLessThan(2);await fillValue(page,'Notat','Her er et notat');expect(await positions()).toEqual(before);
 const note=page.locator('.personal-note'),a=await note.boundingBox(),target=await page.locator('.song-line').first().boundingBox();expect(a.height).toBeGreaterThanOrEqual(70);expect(await note.evaluate(n=>getComputedStyle(n).borderRadius)).toBe('10px');
 await page.mouse.move(a.x+15,a.y+a.height/2);await page.mouse.down();await page.waitForTimeout(500);await page.mouse.move(target.x+10,target.y+target.height/2,{steps:6});await expect(page.locator('.annotation-connectors line[data-dragging=true]')).toHaveCount(1);
 const line=page.locator('.annotation-connectors line[data-dragging=true]');expect(await line.evaluate(n=>Number(n.getAttribute('y1')))).toBeLessThan(before[2]-before[0]);
 expect(await positions()).toEqual(before);await page.keyboard.press('Escape');await page.mouse.up();expect(Object.values((await savedPersonal(page))[0].notes)[0].line).toBe(2);
});

test('end target appends a chorus reference and instruction after the last source line',async({page})=>{
 const source='{t: Slutten}\n{soc}\nKor\n{eoc}\nSiste linje';await importSong(page,'end.cho',source);await tool(page,'Gjenta refreng');await page.locator('.song-end').click({position:{x:10,y:8}});await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source+'\n{chorus}\n');
 await tool(page,'Anvisninger');await page.locator('.song-end').click({position:{x:10,y:8}});await fillValue(page,'Anvisning','Slutt');await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source+'\n{chorus}\n{comment: Slutt}\n');
});

test('partial pointer spans and single word taps make whole word highlights',async({page})=>{
 await importSong(page,'ord.cho','{t: Ord}\nEn vakker morgen');await tool(page,'Gulmarkering',true);const words=page.locator('.lyric'),a=await words.filter({hasText:'vakker'}).boundingBox(),b=await words.filter({hasText:'morgen'}).boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:6});await page.mouse.up();
 await expect.poll(async()=>Object.values((await savedPersonal(page))[0].annotations)[0].highlights.map(r=>[r.start,r.end])).toEqual([[3,16]]);expect((await page.locator('mark').allTextContents()).join('')).toBe('vakker morgen');
 await tool(page,'Gulmarkering',true);await words.filter({hasText:'En'}).first().click();await expect.poll(async()=>Object.values((await savedPersonal(page))[0].annotations)[0].highlights.some(r=>r.start===0&&r.end===2)).toBe(true);
});

async function hold(page,node){await node.scrollIntoViewIfNeeded();const r=await node.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.waitForTimeout(500);await page.mouse.up();await expect(page.getByRole('button',{name:'Fjern',exact:true})).toBeEnabled();}

test('hold selects one chord; drag moves the sounding token once and retains selection and grouped history',async({page})=>{
 const source='\uFEFF{t: Flytt akkord}\r\n{key: D}\r\n[D]abcdef [A/C#]mer\r\nEn annen linje';await importSong(page,'drag.cho',source);await setCapo(page,2);
 const chord=page.locator('.chord[data-chord-start]').first();await hold(page,chord);await expect(chord).toHaveAttribute('data-element-selected','');await expect(page.locator('.chord-drag-ghost')).toHaveCount(0);expect((await savedSongs(page))[0].original).toBe(source);await expect(page.locator('[data-remove-element]')).toHaveCount(0);
 await page.locator('#song-title').click();await expect(page.getByRole('button',{name:'Fjern',exact:true})).toBeDisabled();
 const a=await chord.boundingBox(),target=await page.locator('.lyric').filter({hasText:'abcdef'}).evaluate(n=>{const range=document.createRange();range.setStart(n.firstChild,2);range.setEnd(n.firstChild,3);const r=range.getBoundingClientRect();return{x:r.right-1,y:r.top+r.height/2};});
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.waitForTimeout(500);await page.mouse.move(target.x,target.y,{steps:8});await expect(page.locator('.chord-drag-ghost')).toBeVisible();expect((await savedSongs(page))[0].original).toBe(source);await page.mouse.up();
 await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source.replace('[D]abcdef','abc[D]def'));await expect(page.locator('.chord[data-element-selected]')).toHaveText('C');
 await page.getByRole('button',{name:'Angre',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source);expect((await savedPersonal(page))[0].capo).toBe(2);
 await page.getByRole('button',{name:'Gjør om',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).toContain('abc[D]def');
 await hold(page,page.locator('.chord[data-chord-start]').first());await page.getByRole('button',{name:'Fjern',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source.replace('[D]',''));
});

test('held notes, highlights, instructions, dynamics and chorus structures remove only the selected item',async({page})=>{
 const source='{t: Velg}\n{comment: Intro}\n{x_dyn: 2}\nEn linje\n{soc}\n[C]Kor\n{eoc}\n{chorus}\nEtter';await importSong(page,'select.cho',source);await tool(page,'Notater',true);await page.locator('.song-line').first().click();await fillValue(page,'Notat','Notat');
 await hold(page,page.locator('.personal-note'));await expect(page.locator('.note-drag-ghost')).toHaveCount(0);await page.getByRole('button',{name:'Fjern',exact:true}).click();await expect.poll(async()=>Object.keys((await savedPersonal(page))[0].notes??{})).toHaveLength(0);expect((await savedSongs(page))[0].original).toBe(source);
 await hold(page,page.locator('.comment').first());await page.getByRole('button',{name:'Fjern',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).not.toContain('{comment:');
 await hold(page,page.locator('.dynamic-marker').first());await page.getByRole('button',{name:'Fjern',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).not.toContain('x_dyn');
 await tool(page,'Gulmarkering',true);await page.locator('.lyric').filter({hasText:'En'}).first().click();await hold(page,page.locator('mark').first());await page.getByRole('button',{name:'Fjern',exact:true}).click();await expect.poll(async()=>(await savedPersonal(page))[0].annotations).toBeUndefined();
 await hold(page,page.locator('.reference > h2'));await page.getByRole('button',{name:'Fjern',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).not.toContain('{chorus}');
 await tool(page,'Refreng');await hold(page,page.locator('.chorus > h2'));await page.getByRole('button',{name:'Fjern',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).toBe('{t: Velg}\nEn linje\n[C]Kor\nEtter');await expect(page.getByRole('button',{name:'Fjern',exact:true})).toBeDisabled();
});

test('chorus dynamics stay in their source block and margin; edit folds references without losing saved expansion',async({page})=>{
 const source='{t: Dynamikk}\n{x_dyn: 1}\n{soc}\n[C]Kor en\n{x_dyn: 4}\nKor to\n{eoc}\n{x_dyn: 2}\n{chorus}\nEtter';await importSong(page,'chorus.cho',source);await page.getByRole('button',{name:'Refreng',exact:true}).click();for(const row of await page.locator('.reference .song-line').all())await expect(row).toHaveAttribute('data-dynamic-level','2');
 const before=(await savedPersonal(page))[0].chorus;await editSong(page);await expect(page.locator('.reference > h2 button')).toHaveCount(0);await expect(page.locator('.reference .chorus-text')).toBeHidden();expect((await savedPersonal(page))[0].chorus).toEqual(before);expect((await savedSongs(page))[0].original).toBe(source);
 await expect(page.locator('.dynamic-marker')).toHaveCount(3);const margin=await page.locator('#song-body').boundingBox();for(const marker of await page.locator('.dynamic-marker').all())expect(Math.abs((await marker.boundingBox()).x-margin.x)).toBeLessThan(1);
 await tool(page,'Dynamikk');await page.locator('.chorus:not(.reference) .song-line').first().click();await page.getByRole('spinbutton',{name:'Dynamikk',exact:true}).press('End');await page.keyboard.press('Escape');await expect.poll(async()=>(await savedSongs(page))[0].original).toContain('{soc}\n{x_dyn: 5}\n[C]Kor en');
 await tool(page,'Dynamikk');await page.locator('.dynamic-marker[data-level="4"]').click();await page.getByRole('spinbutton',{name:'Dynamikk',exact:true}).press('Home');await page.keyboard.press('Escape');await expect.poll(async()=>(await savedSongs(page))[0].original).toContain('{x_dyn: 1}\nKor to');
 await page.getByRole('button',{name:'Visning',exact:true}).click();await expect(page.getByRole('button',{name:'Refreng',exact:true})).toHaveAttribute('aria-expanded','true');for(const row of await page.locator('.reference .song-line').all())await expect(row).toHaveAttribute('data-dynamic-level','2');await expect(page.locator('#song-body > .song-line').last()).toHaveAttribute('data-dynamic-level','2');
});

test('touch chord hold supports selection, cancelled drag and committed movement without a popup',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage();
 try{
  const source='{t: Touch}\n[C]abcdef\nNeste linje';await page.goto('http://127.0.0.1:4173'+url);await importSong(page,'touch.cho',source);await tool(page,'Akkorder');const chord=page.locator('.chord[data-chord-start]').first();await chord.tap();await expect(page.getByRole('textbox',{name:'Akkord',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  const cdp=await context.newCDPSession(page),a=await chord.boundingBox(),target=await page.locator('.lyric').filter({hasText:'abcdef'}).evaluate(n=>{const range=document.createRange();range.setStart(n.firstChild,2);range.setEnd(n.firstChild,3);const r=range.getBoundingClientRect();return{x:r.right-1,y:r.top+r.height/2};});
  const begin=async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});await page.waitForTimeout(500);await expect(chord).toHaveAttribute('data-element-selected','');await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[target]});await expect(page.locator('.chord-drag-ghost')).toBeVisible();};
  await begin();await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await expect(page.locator('.chord-drag-ghost')).toHaveCount(0);expect((await savedSongs(page))[0].original).toBe(source);
  await begin();await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source.replace('[C]abcdef','abc[C]def'));await expect(page.locator('.chord[data-element-selected]')).toHaveText('C');await expect(page.locator('.value-control')).toHaveCount(0);
 }finally{await context.close();}
});

test('opening and closing a legacy multiline note in a single line control preserves its stored text',async({page})=>{
 await importSong(page,'legacy-note.cho','{t: Behold notat}\nOrd');await tool(page,'Notater',true);await page.locator('.song-line').click();await fillValue(page,'Notat','Før');const state=(await savedPersonal(page))[0],id=Object.keys(state.notes)[0];state.notes[id].text='En\nTo';
 await page.evaluate(state=>new Promise(resolve=>{const request=indexedDB.open('hobos-songbook-test');request.onsuccess=()=>{const db=request.result,tx=db.transaction('personal','readwrite');tx.objectStore('personal').put(state);tx.oncomplete=()=>{db.close();resolve();};};}),state);
 await page.reload();await page.locator('.song-choice').click();await tool(page,'Notater',true);await page.locator('.personal-note').click();expect(await page.getByRole('textbox',{name:'Notat',exact:true}).evaluate(n=>n.tagName)).toBe('INPUT');await page.keyboard.press('Escape');expect((await savedPersonal(page))[0].notes[id].text).toBe('En\nTo');
});
