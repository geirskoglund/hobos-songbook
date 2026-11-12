import {test,expect} from '@playwright/test';
import {importSong,editSong,setCapo,tool,fillValue,openMenu,closeMenu,savedSongs,openSettings,closeSettings} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
const source='{t: Pillene skal stå samlet}\n{key: D}\n{time: 6/8}\n[D]En sangtekst\n';
test.beforeEach(async({page,request})=>{await request.post('/__test__/reset');await page.goto(url);});
async function groupedPills(page,labels){
 await expect(page.locator('.song-metadata .song-key')).toHaveText(labels);
 await expect(page.locator('#song-content button[aria-haspopup=menu]')).toHaveCount(0);
 const geometry=await page.locator('.song-metadata').evaluate(root=>({left:root.getBoundingClientRect().left,pills:[...root.querySelectorAll('.song-key')].map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top};})}));
 expect(Math.abs(geometry.pills[0].left-geometry.left)).toBeLessThan(1);
 for(let i=1;i<geometry.pills.length;i++){
  const previous=geometry.pills[i-1],current=geometry.pills[i];
  expect(Math.abs(current.left-(Math.abs(current.top-previous.top)<1?previous.right+6:geometry.left))).toBeLessThan(1);
 }
}
test('view and editor keep the existing pill layout and use only the header menu for song actions',async({page})=>{
 await importSong(page,'piller.cho',source);await setCapo(page,2);await tool(page,'Stemming',true);await fillValue(page,'Stemming','Drop D');await page.getByRole('button',{name:'Visning',exact:true}).click();await expect(page.locator('.edit-toolbar')).toHaveCount(0);
 for(const width of [320,768,1280]){await page.setViewportSize({width,height:900});await groupedPills(page,['D','6/8','Capo 2: C','Drop D']);}
 await expect(page.locator('.song-metadata .song-access')).toHaveCount(0);await openMenu(page);
 await expect(page.getByRole('group',{name:'Sanghandlinger'}).getByRole('button')).toHaveText(['Last ned']);await expect(page.getByRole('button',{name:/^(Publiser|Avpubliser|Bytt sangbok|Behold privat)$/})).toHaveCount(0);const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Last ned',exact:true}).click();await downloaded;await expect(page.locator('#menu-button')).toBeFocused();
 await editSong(page);await expect(page.locator('.song-metadata .song-access')).toHaveText('Privat');
 for(const width of [320,768,1280]){await page.setViewportSize({width,height:900});await groupedPills(page,['D','6/8','Capo 2: C','Drop D']);}
 await openMenu(page);await expect(page.getByRole('group',{name:'Sanghandlinger'}).getByRole('button')).toHaveText(['Publiser','Bytt sangbok']);await expect(page.getByRole('button',{name:'Last ned',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Publiser',exact:true}).click();await expect(page.getByRole('dialog',{name:'Sangbok',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.edit-toolbar')).toBeVisible();await expect(page.locator('#menu-button')).toBeFocused();
 await openSettings(page);await openMenu(page);await expect(page.getByRole('group',{name:'Sanghandlinger'})).toHaveCount(0);await closeMenu(page);await closeSettings(page);await expect(page.locator('.edit-toolbar')).toBeVisible();
});
for(const access of ['shared','import'])test(`${access} songs cannot publish in view and expose only allowed editor actions`,async({page})=>{
 await importSong(page,'status.cho',source);const song=(await savedSongs(page))[0];await page.evaluate(song=>new Promise(resolve=>{const r=indexedDB.open('hobos-songbook-test');r.onsuccess=()=>{const db=r.result,tx=db.transaction('songs','readwrite');tx.objectStore('songs').put(song);tx.oncomplete=()=>{db.close();resolve();};};}),{...song,sync:{access}});await page.reload();await page.locator('.song-choice').click();await openMenu(page);
 await expect(page.getByRole('group',{name:'Sanghandlinger'}).getByRole('button')).toHaveText(['Last ned']);await expect(page.getByRole('button',{name:/^(Publiser|Avpubliser|Bytt sangbok)$/})).toHaveCount(0);await closeMenu(page);await editSong(page);await openMenu(page);
 if(access==='shared')await expect(page.getByRole('group',{name:'Sanghandlinger'}).getByRole('button')).toHaveText(['Avpubliser','Bytt sangbok']);
 else{await expect(page.getByRole('group',{name:'Sanghandlinger'})).toHaveCount(0);await closeMenu(page);await expect(page.getByRole('tab')).toHaveText(['Egentilpasning']);}
});
