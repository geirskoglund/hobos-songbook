import {expect} from '@playwright/test';
export const original = '\uFEFF{title: Samme tittel}\r\n{key: D}\r\n{comment: Rolig <b>tekst</b>}\r\n[D]Hei på [A/C#]deg\r\n[Solo] beholdes\r\n{soc}\r\n[G]Syng med\r\n{eoc}\r\n{chorus}\r\n{chorus}\r\n{x_future: behold}\r\n<img src=x onerror="window.injected=true">\r\n';
export async function importSong(page, name = 'sang.CHO', content = original) {
  await beginImport(page);
  await page.locator('#song-file').setInputFiles({name, mimeType: '', buffer: Buffer.from(content)});
  await expect.poll(async()=>await page.locator('.import-copy').isVisible()||await page.locator('#song-status').textContent()==='Sangen er lagret på denne enheten.').toBe(true);
  if(await page.locator('.import-copy').isVisible())await page.getByRole('button',{name:'Importer',exact:true}).click();
  await expect(page.locator('#song-title')).toBeVisible();
  await expect(page.locator('#song-status')).toContainText('Sangen er lagret');
}
export async function savedSongs(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const namespace = `hobos-songbook-${location.pathname.includes('/app/') ? 'production' : 'test'}`;
    const request = indexedDB.open(namespace);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, get = db.transaction('songs').objectStore('songs').getAll();
      get.onsuccess = () => {db.close(); resolve(get.result);};
    };
  }));
}

export async function openMenu(page) {
  if (!await page.locator('#main-menu').isVisible()) await page.getByRole('button',{name:'Meny',exact:true}).click();
}
export async function closeMenu(page) {
  if (await page.locator('#main-menu').isVisible()) await page.getByRole('button',{name:'Meny',exact:true}).click();
}
export async function setCapo(page,value){
 await tool(page,'Capo',true);
 const title=await page.locator('#song-title').textContent(),songs=(await savedSongs(page)).filter(song=>song.title===title);
 expect(songs).toHaveLength(1);
 const songId=songs[0].id;
 const current=Number(await page.getByRole('spinbutton',{name:'Capo',exact:true}).textContent());
 for(let n=0;n<Math.abs(value-current);n++)await page.getByRole('button',{name:value>current?'Øk capo':'Reduser capo',exact:true}).click();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'Capo',exact:true})).not.toBeVisible();
 await expect.poll(async()=>(await savedPersonal(page)).find(personal=>personal.songId===songId)?.capo??0).toBe(value);
}
export async function setDisplay(page, {theme, fontSize, showGrids, showDynamics}) {
  await openSettings(page);
  if (fontSize !== undefined) {await page.locator('#font-size').fill(String(fontSize)); await page.locator('#font-size').dispatchEvent('input');}
  if (showGrids !== undefined) await page.locator('#show-grids').setChecked(showGrids);
  if (showDynamics !== undefined) await page.locator('#show-dynamics').setChecked(showDynamics);
  await closeSettings(page);
}

export async function openSettings(page){
 if(!await page.locator('#settings').isVisible()){await openMenu(page);await page.getByRole('button',{name:'Innstillinger',exact:true}).click();}
}
export async function closeSettings(page){if(await page.locator('#settings').isVisible())await page.locator('#back').click();}
export async function goSongs(page){await openMenu(page);await page.getByRole('button',{name:'Sanger',exact:true}).click();}

export async function editSong(page){await expect(page.locator('#reader')).toBeVisible();await expect(page.locator('#song-title')).toBeVisible();if(!await page.locator('.edit-toolbar').count())await page.getByRole('button',{name:'Rediger',exact:true}).click();await expect(page.locator('.edit-toolbar')).toBeVisible();}
export async function selectElement(page,element){await editSong(page);await page.keyboard.press('Escape');await element.focus();await element.press('Enter');await expect(page.locator('[data-element-selected]').first()).toBeVisible();await expect(page.getByRole('button',{name:'Fjern',exact:true})).toBeEnabled();}
export async function tool(page,name,personal=false){await editSong(page);await page.getByRole('tab',{name:personal?'Egentilpasning':'Filinnhold',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();}
export async function rawEditor(page){await tool(page,'Råtekst');await expect(page.getByRole('dialog',{name:'Råtekst',exact:true})).toBeVisible();return page.locator('#original-text');}
export async function fillValue(page,name,value){const field=page.getByRole('textbox',{name,exact:true});await field.fill(value);await field.press(name==='Notat'?'ControlOrMeta+Enter':'Enter');await expect(page.getByRole('dialog',{name,exact:true})).not.toBeVisible();}
export async function savedPersonal(page){return page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open(`hobos-songbook-${location.pathname.includes('/app/')?'production':'test'}`);r.onsuccess=()=>{const db=r.result,tx=db.transaction('personal'),q=tx.objectStore('personal').getAll();tx.oncomplete=()=>{db.close();resolve(q.result);};};}));}

export async function beginImport(page, book) {
  await goSongs(page);
  await page.locator('#add-song').click();
  await page.getByRole('menuitem', {name:'Importer', exact:true}).click();
  const step = page.getByRole('dialog', {name:'Importer i sangbok', exact:true});
  await expect(step).toBeVisible();
  if (book || await step.getByRole('button', {name:'Fortsett', exact:true}).isDisabled()) {
    await step.getByRole('button', {name:/^Sangbok:/}).click();
    await page.getByRole('option', {name:book ?? 'Standard', exact:true}).click();
  }
  await step.getByRole('button', {name:'Fortsett', exact:true}).click();
}
export async function beginCreate(page) {
  await page.locator('#add-song').click();
  await page.getByRole('menuitem', {name:'Opprett', exact:true}).click();
  await page.getByRole('dialog', {name:'Opprett i sangbok', exact:true}).getByRole('button', {name:'Fortsett', exact:true}).click();
}
