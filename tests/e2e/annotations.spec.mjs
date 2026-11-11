import {test,expect} from '@playwright/test';
import {importSong,savedSongs,openMenu} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const original=page=>page.getByRole('dialog',{name:'Rediger sangtekst',exact:true});
const edit=async page=>{await page.getByRole('button',{name:'Rediger',exact:true}).click();};
const save=async page=>{await page.locator('#edit-save').click();await expect(page.locator('#edit-save')).toBeDisabled();};
const state=page=>page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('personal'),get=tx.objectStore('personal').getAll();tx.oncomplete=()=>{db.close();resolve(get.result);};};}));
async function note(page,index,text){
 await page.getByRole('button',{name:'Notat',exact:true}).click();const row=page.locator(`.song-line[data-note-line="${index}"]`),box=await row.boundingBox();await row.click({position:{x:box.width-4,y:box.height/2}});
 await page.locator('#annotation-note').fill(text);await page.getByRole('dialog',{name:'Notat',exact:true}).getByRole('button',{name:'OK',exact:true}).click();
}
async function highlight(page,index,start,end){
 await page.locator(`.song-line[data-note-line="${index}"]`).evaluate((line,{start,end})=>{
  const lyrics=[...line.querySelectorAll('.lyric')],range=document.createRange();
  for(const [name,offset] of [['Start',start],['End',end]])for(const lyric of lyrics){const at=Number(lyric.dataset.offset),length=Number(lyric.dataset.length);if(offset>=at&&offset<=at+length){range[`set${name}`](lyric.firstChild,offset-at);break;}}
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
 },{start,end});await page.getByRole('button',{name:'Markeringspenn',exact:true}).click();
}
test.beforeEach(async({request,page})=>{await request.post('/__test__/reset');await page.goto(url);});

test('notes survive shorter and empty originals, repeated dialog edits, save and reopening without source copies',async({page})=>{
 await importSong(page,'notater.txt','{t: Posisjoner}\nEn\nTo\nTre');await edit(page);
 for(let n=0;n<3;n++)await note(page,n,`Notat ${n}`);await save(page);
 for(let n=0;n<5;n++){await page.locator('[data-note-line="1"] .personal-note').click();await page.locator('#annotation-note').fill(`Endring ${n}`);await page.getByRole('dialog',{name:'Notat',exact:true}).getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('[data-note-line="1"] .personal-note')).toContainText(`Endring ${n}`);}
 await page.locator('#edit-original').click();await expect(page.locator('#original-title')).toBeEditable();await expect(page.locator('#original-key')).toBeEnabled();await expect(page.locator('#original-time')).toBeEnabled();await page.locator('#original-text').fill('Bare en linje');await original(page).getByRole('button',{name:'OK',exact:true}).click();
 await expect(page.locator('.personal-note')).toHaveCount(3);await expect(page.locator('.note-overflow .personal-note')).toHaveCount(2);await save(page);
 await page.locator('#edit-original').click();await page.locator('#original-text').fill('');await original(page).getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('.note-overflow .personal-note')).toHaveCount(3);await page.screenshot({path:'test-results/annotations-empty.png'});await save(page);
 const data=(await state(page))[0];expect(data.version).toBe(3);expect(data.annotations).toBeUndefined();expect(Object.values(data.notes).map(note=>note.line).sort()).toEqual([0,1,2]);expect(Object.values(data.notes).every(note=>Object.keys(note).sort().join(',')==='line,text')).toBe(true);
 await page.reload();await page.locator('.song-choice').filter({hasText:'Posisjoner'}).click();await expect(page.locator('.personal-note')).toHaveCount(3);await expect(page.locator('.personal-note').filter({hasText:'Endring 4'})).toBeVisible();
 await edit(page);await page.locator('.personal-note').filter({hasText:'Endring 4'}).click();await page.locator('#annotation-note').fill('Etter gjenåpning');await page.getByRole('dialog',{name:'Notat',exact:true}).getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('.personal-note').filter({hasText:'Etter gjenåpning'})).toBeVisible();await save(page);
});

test('original editing shifts safe highlights, removes unsafe ones and preserves notes with a stable song identity',async({page})=>{
 await importSong(page,'koordinater.txt','{t: Koordinater}\nEn vanlig linje\nSyng høyt');const before=(await savedSongs(page))[0];await edit(page);await note(page,1,'Ved linje to');await highlight(page,0,3,9);await highlight(page,1,5,9);await save(page);
 await page.locator('#edit-original').click();await page.locator('#original-title').fill('Endret tittel');await page.locator('#original-text').fill('En helt vanlig linje\nSyng høyt');await original(page).getByRole('button',{name:'OK',exact:true}).click();expect((await page.locator('mark').allTextContents()).join('')).toBe('vanlighøyt');await expect(page.locator('[data-note-line="1"] .personal-note')).toContainText('Ved linje to');await save(page);
 await page.locator('#edit-original').click();await page.locator('#original-text').fill('En helt annen linje\nSyng høyt');await original(page).getByRole('button',{name:'OK',exact:true}).click();expect((await page.locator('mark').allTextContents()).join('')).toBe('høyt');await save(page);
 expect((await savedSongs(page))[0].id).toBe(before.id);const data=(await state(page))[0];expect(JSON.stringify(data)).not.toContain('En vanlig linje');expect(Object.values(data.annotations).every(item=>Object.keys(item.anchor).sort().join(',')==='occurrence,songId,sourceLine')).toBe(true);
 await page.reload();await page.locator('.song-choice').filter({hasText:'Endret tittel'}).click();expect((await page.locator('mark').allTextContents()).join('')).toBe('høyt');await expect(page.locator('.personal-note')).toContainText('Ved linje to');
});

test('legacy test annotations are removed before use while songs and other personal settings survive',async({page})=>{
 await importSong(page,'gammel.txt','{t: Gammel}\nEn gammel linje');const song=(await savedSongs(page))[0];
 await page.evaluate(song=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('personal','readwrite');tx.objectStore('personal').put({songId:song.id,version:2,chorus:{},capo:2,tuning:'Drop D',chordGrid:'| D |',annotations:{'source/line:1':{anchor:{songId:song.id,sourceLine:1,occurrence:'source/line:1',original:song.original,text:'En gammel linje',before:'',after:''},note:'Gammelt notat',highlights:[{start:0,end:2}]}}});tx.oncomplete=()=>{db.close();resolve();};};}),song);
 await page.reload();await page.locator('.song-choice').filter({hasText:'Gammel'}).click();await expect(page.locator('.personal-note,mark')).toHaveCount(0);const data=(await state(page))[0];expect(data.version).toBe(3);expect(data.annotations).toBeUndefined();expect(data.capo).toBe(2);expect(data.tuning).toBe('Drop D');expect(data.chordGrid).toBe('| D |');expect((await savedSongs(page))[0]).toEqual(song);
 await edit(page);await note(page,0,'Nytt notat');await save(page);await page.reload();await page.locator('.song-choice').filter({hasText:'Gammel'}).click();await expect(page.locator('.personal-note')).toContainText('Nytt notat');
});

test('deleting the last note and highlight removes their records instead of leaving empty anchors',async({page})=>{
 await importSong(page,'slett.txt','En linje');await edit(page);await note(page,0,'Slett meg');await highlight(page,0,0,2);await save(page);
 await page.getByRole('button',{name:'Slett notat',exact:true}).click();await page.locator('mark').click();await page.getByRole('button',{name:'Fjern markering',exact:true}).click();await save(page);
 const data=(await state(page))[0];expect(data.notes).toBeUndefined();expect(data.annotations).toBeUndefined();await page.reload();await page.locator('.song-choice').filter({hasText:'slett'}).click();await expect(page.locator('.personal-note,mark')).toHaveCount(0);
});

test('repeated filenames prompt for a copy without comparing content and never overwrite existing songs',async({page})=>{
 await importSong(page,'samme.cho','{t: Første}\nTekst');const before=(await savedSongs(page))[0];await page.locator('#back').click();
 const choose=content=>page.locator('#song-file').setInputFiles({name:'samme.cho',mimeType:'',buffer:Buffer.from(content)});
 await choose('{t: Annen}\nHelt annet innhold');const dialog=page.getByRole('dialog',{name:'Importer kopi',exact:true});await expect(dialog).toHaveText('Fil samme.cho er allerede importert. Vil du importere en kopi?AvbrytImporter');await dialog.getByRole('button',{name:'Avbryt',exact:true}).click();expect(await savedSongs(page)).toEqual([before]);
 await choose('{t: Annen}\nHelt annet innhold');await dialog.getByRole('button',{name:'Importer',exact:true}).click();await expect(page.locator('#song-title')).toHaveText('Annen');const songs=await savedSongs(page);expect(songs).toHaveLength(2);expect(songs.find(song=>song.id===before.id)).toEqual(before);expect(songs.find(song=>song.id!==before.id).original).toBe('{t: Annen}\nHelt annet innhold');
});
