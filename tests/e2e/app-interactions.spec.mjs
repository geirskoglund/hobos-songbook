import {test,expect} from '@playwright/test';
import {importSong,savedSongs,savedPersonal,tool,fillValue,rawEditor,openSettings,closeSettings} from './song-helpers.mjs';
const url='/hobos-songbook/test/';
test.beforeEach(async({page,request})=>{await request.post('/__test__/reset');await page.goto(url);});
test('context menus are app-owned in every surface including raw text and small controls',async({page})=>{
 const blocked=async selector=>{expect(await page.locator(selector).evaluate(n=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});return !n.dispatchEvent(e);})).toBe(true);};
 await blocked('#library-title');await openSettings(page);await blocked('#settings-heading');await closeSettings(page);await importSong(page,'policy.txt','{t: Policy}\nOrd');await blocked('#song-title');await tool(page,'Stemming',true);await blocked('#value-input');await expect(page.getByRole('menu',{name:'Tekstvalg'})).toBeVisible();await page.keyboard.press('Escape');await page.keyboard.press('Escape');await rawEditor(page);await blocked('#original-text');await expect(page.getByRole('menuitem',{name:'Merk alt'})).toBeVisible();
});
test('tool-first highlight makes one multiline group, keeps clean text offsets and removes only the marking',async({page})=>{
 await importSong(page,'mark.cho','{t: Markering}\n[C]En vanlig linje\nEn annen linje');await tool(page,'Gulmarkering',true);
 const first=page.locator('.song-line').first().locator('.lyric').first(),last=page.locator('.song-line').nth(1).locator('.lyric').last(),a=await first.boundingBox(),b=await last.boundingBox();await page.mouse.move(a.x+1,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-1,b.y+b.height/2,{steps:12});await page.mouse.up();await expect(page.getByRole('button',{name:'Gulmarkering',exact:true})).toHaveAttribute('aria-pressed','false');
 await expect.poll(async()=>Object.values((await savedPersonal(page))[0]?.annotations??{}).flatMap(a=>a.highlights).length).toBeGreaterThan(0);const ranges=Object.values((await savedPersonal(page))[0].annotations).flatMap(a=>a.highlights);expect(new Set(ranges.map(r=>r.groupId)).size).toBe(1);expect(await page.evaluate(()=>getSelection().toString())).toBe('');await expect(page.getByRole('button',{name:'Fjern markering',exact:true})).toBeHidden();
 await tool(page,'Fjern');await page.getByRole('button',{name:'Fjern gulmarkering',exact:true}).click();await expect.poll(async()=>(await savedPersonal(page))[0].annotations).toBeUndefined();expect((await savedSongs(page))[0].original).toBe('{t: Markering}\n[C]En vanlig linje\nEn annen linje');
});
test('invalid values use app errors, preserve last saved content and can be dismissed without native validation',async({page})=>{
 await importSong(page,'valid.cho','{t: Gyldig}\n{time: 4/4}\nOrd');await tool(page,'Takt');await page.getByRole('textbox',{name:'Takt',exact:true}).fill('Banan');await page.getByRole('textbox',{name:'Takt',exact:true}).press('Enter');await expect(page.locator('.value-control .field-error')).toContainText('takt');expect((await savedSongs(page))[0].original).toContain('{time: 4/4}');await page.keyboard.press('Escape');await expect(page.locator('.value-control')).toHaveCount(0);
});
test('paste never requests a new clipboard grant from the app text menu',async({page})=>{
 await importSong(page,'clip.txt','{t: Clipboard}\nOrd');await rawEditor(page);await page.evaluate(()=>{navigator.permissions.query=async()=>({state:'prompt'});navigator.clipboard.readText=async()=>{window.clipboardRead=true;return 'ikke les';};});await page.locator('#original-text').dispatchEvent('contextmenu',{bubbles:true,cancelable:true});await page.getByRole('menuitem',{name:'Lim inn',exact:true}).click();await expect(page.locator('.text-action-error')).toContainText('tastaturets lim inn');expect(await page.evaluate(()=>window.clipboardRead??false)).toBe(false);
});
