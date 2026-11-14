import {test,expect} from '@playwright/test';
import {selectElement,importSong,savedSongs,savedPersonal,editSong,tool,rawEditor,fillValue,setCapo,goSongs,openSettings,closeSettings} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const source='\uFEFF{title: Arbeid}\r\n{key: C}\r\n{time: 4/4}\r\n{sog}\r\n| C G/B . |\r\n{eog}\r\n{x_dyn: 2}\r\n[C]Hei på [G]deg\r\nNeste linje\r\n{soc}\r\n[F]Syng med\r\n{eoc}\r\n{chorus}\r\n{x_future: behold}\r\n';
const saveRaw=async page=>{await page.getByRole('dialog',{name:'Råtekst',exact:true}).getByRole('button',{name:'Lagre',exact:true}).click();await expect(page.getByRole('dialog',{name:'Råtekst',exact:true})).not.toBeVisible();};
test.beforeEach(async({page,request})=>{await request.post('/__test__/reset');await page.goto(url);});

test('modes share saved grouped history; title/capo survive view, tab and settings transitions',async({page})=>{
 await importSong(page,'arbeid.cho',source);await tool(page,'Tittel');const title=page.getByRole('textbox',{name:'Tittel',exact:true});await title.fill('Ett');await expect.poll(async()=>(await savedSongs(page))[0].title).toBe('Ett');await title.fill('To');await title.press('Enter');await expect.poll(async()=>(await savedSongs(page))[0].title).toBe('To');
 await setCapo(page,2);await page.getByRole('button',{name:'Visning',exact:true}).click();await expect(page.locator('.edit-toolbar')).toHaveCount(0);await expect(page.locator('.song-metadata')).toContainText('Capo 2');
 await editSong(page);await openSettings(page);await closeSettings(page);await page.getByRole('button',{name:'Angre',exact:true}).click();await expect.poll(async()=>(await savedPersonal(page))[0]?.capo??0).toBe(0);
 await page.getByRole('button',{name:'Angre',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source);
 await page.getByRole('button',{name:'Gjør om',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].title).toBe('To');
 await page.locator('#back').click();await page.locator('.song-choice').click();await editSong(page);await expect(page.getByRole('button',{name:'Angre',exact:true})).toBeDisabled();
});

test('raw tag insertion preserves pointer focus, selection, local undo and persistent data until Save',async({page})=>{
 await importSong(page,'arbeid.cho',source);const before=await savedSongs(page),field=await rawEditor(page);const shown=source.replace(/\r\n/g,'\n');await field.focus();await field.evaluate(f=>{f.setSelectionRange(5,5);window.blurCount=0;f.addEventListener('blur',()=>window.blurCount++);});
 await page.getByRole('button',{name:'Sett inn {soc}',exact:true}).click();await expect(field).toBeFocused();expect(await page.evaluate(()=>window.blurCount)).toBe(0);await expect(field).toHaveValue(shown.slice(0,5)+'{soc}'+shown.slice(5));expect(await savedSongs(page)).toEqual(before);
 await field.press('ControlOrMeta+z');await expect(field).toHaveValue(shown);await field.press('ControlOrMeta+Shift+z');await expect(field).toHaveValue(shown.slice(0,5)+'{soc}'+shown.slice(5));
 await page.getByRole('button',{name:'Avbryt',exact:true}).click();expect(await savedSongs(page)).toEqual(before);
 const reopened=await rawEditor(page);await reopened.fill(source.replace('Arbeid','Ny råtekst'));await saveRaw(page);await expect(page.locator('#song-title')).toHaveText('Ny råtekst');await page.getByRole('button',{name:'Angre',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).toBe(source);
});

test('new song creates once on raw Save and returns to editing; Cancel leaves no orphan',async({page})=>{
 const fresh=async()=>{await page.getByRole('button',{name:'Legg til sang',exact:true}).click();await page.getByRole('menuitem',{name:'Opprett',exact:true}).click();await page.getByRole('dialog',{name:'Opprett sang',exact:true}).getByRole('button',{name:'Fortsett',exact:true}).click();};
 await fresh();await expect(page.locator('.edit-toolbar')).toBeVisible();expect(await savedSongs(page)).toHaveLength(0);await page.getByRole('button',{name:'Avbryt',exact:true}).click();expect(await savedSongs(page)).toHaveLength(0);
 await fresh();await page.locator('#original-text').fill('{title: Ny}\nOrd æøå 😀');await saveRaw(page);await expect(page.getByRole('button',{name:'Visning',exact:true})).toBeVisible();expect(await savedSongs(page)).toHaveLength(1);const id=(await savedSongs(page))[0].id;
 await tool(page,'Tittel');await fillValue(page,'Tittel','Endret');await expect.poll(async()=>(await savedSongs(page))[0].title).toBe('Endret');expect((await savedSongs(page))[0].id).toBe(id);
});

test('shared/personal grids and chord entry use visible capo grips; toneart changes both grids atomically',async({page})=>{
 await importSong(page,'arbeid.cho',source);await setCapo(page,2);await tool(page,'Akkordskjema',true);await page.getByRole('textbox',{name:'Skjematekst',exact:true}).fill('| C F |');await page.getByRole('button',{name:'OK',exact:true}).click();await expect.poll(async()=>(await savedPersonal(page))[0]?.chordGrid).toContain('| D G |');
 await tool(page,'Akkordskjema');await page.getByRole('textbox',{name:'Skjematekst',exact:true}).fill('| F C |');await page.getByRole('button',{name:'OK',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].original).toContain('| G D |');await expect(page.locator('#chart-dock')).toContainText('C');
 await tool(page,'Toneart');await fillValue(page,'Toneart','D');await expect.poll(async()=>(await savedSongs(page))[0].key).toBe('D');await expect.poll(async()=>(await savedPersonal(page))[0].chordGrid).toContain('| E A |');expect((await savedPersonal(page))[0].capo).toBe(2);
 await page.getByRole('button',{name:'Angre',exact:true}).click();await expect.poll(async()=>(await savedSongs(page))[0].key).toBe('C');await expect.poll(async()=>(await savedPersonal(page))[0].chordGrid).toContain('| D G |');
 await tool(page,'Akkorder');await page.locator('.chord[data-chord-start]').first().click();await fillValue(page,'Akkord','F');await expect.poll(async()=>(await savedSongs(page))[0].original).toContain('[G]Hei');await expect(page.locator('.chord[data-original=G]').first()).toHaveText('F');
 await tool(page,'Akkorder');await page.locator('.chord[data-chord-start]').first().click();await fillValue(page,'Akkord','  ');await expect.poll(async()=>(await savedSongs(page))[0].original).toContain('\r\nHei på');
});

test('notes autosave, retain logical identity, draw F05 in both modes and remove the selected element across tabs',async({page})=>{
 await importSong(page,'arbeid.cho',source);await tool(page,'Notater',true);await page.locator('.song-line').first().click();await fillValue(page,'Notat','Husk to stemmer');await expect.poll(async()=>Object.values((await savedPersonal(page))[0].notes??{}).map(n=>n.text)).toEqual(['Husk to stemmer']);
 await expect(page.locator('.annotation-connectors line')).toHaveCount(1);await page.getByRole('button',{name:'Visning',exact:true}).click();await expect(page.locator('.annotation-connectors line')).toHaveCount(1);await expect(page.locator('.personal-note button')).toHaveCount(0);
 await selectElement(page,page.locator('.personal-note'));await page.getByRole('tab',{name:'Egentilpasning',exact:true}).click();await expect(page.getByRole('button',{name:'Fjern',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Fjern',exact:true}).click();await expect.poll(async()=>Object.keys((await savedPersonal(page))[0].notes??{})).toHaveLength(0);await expect(page.getByRole('button',{name:'Fjern',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Capo',exact:true}).click();await expect(page.locator('[data-remove-element]')).toHaveCount(0);await page.keyboard.press('Escape');
});

for(const width of [320,768,1440])test(`stable wrapped toolbar, raw viewport and scroll at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:850});await importSong(page,'long.cho',source+'\n'+Array.from({length:120},(_,i)=>`Linje ${i}`).join('\n'));await editSong(page);const toolbar=page.locator('.edit-toolbar'),before=await toolbar.boundingBox();await page.getByRole('tab',{name:'Egentilpasning',exact:true}).click();expect((await toolbar.boundingBox()).height).toBe(before.height);await page.evaluate(()=>scrollTo(0,900));expect((await toolbar.boundingBox()).y).toBe(before.y);
 const field=await rawEditor(page);await page.setViewportSize({width,height:420});await expect(page.getByRole('button',{name:'Lagre',exact:true})).toBeInViewport();expect(await field.evaluate(f=>f.clientHeight)).toBeGreaterThanOrEqual(60);expect(await page.getByRole('dialog',{name:'Råtekst',exact:true}).evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
});
