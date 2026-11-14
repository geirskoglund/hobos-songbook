import {test,expect} from '@playwright/test';
import {openMenu} from './song-helpers.mjs';

const url='/hobos-songbook/test/';
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
async function quiet(node){await expect(node).toBeFocused();await expect(node).toHaveCSS('outline-style','none');}
async function keyboardFocus(node){
  await expect(node).toBeFocused();await expect(node).toHaveCSS('outline-width','1px');await expect(node).toHaveCSS('outline-color','rgb(199, 186, 169)');
  expect(await node.evaluate(n=>{const s=getComputedStyle(n);return parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset);})).toBeLessThanOrEqual(0);
}
test.beforeEach(async({request})=>{await request.post('/__test__/reset');});

test('pointer use and focus return stay quiet, while keyboard navigation has a muted cue',async({page})=>{
  await page.goto(url);await expect(page.locator('#add-song')).toBeEnabled();await openMenu(page);await button(page,'Sangbøker').click();
  const more=page.locator('#songbook-menu-standard'),row=page.locator('#songbook-standard');
  await more.click();const edit=page.getByRole('menuitem',{name:'Endre navn',exact:true});await quiet(edit);await edit.click();
  const field=page.getByLabel('Navn',{exact:true});await quiet(field);await field.fill('Utkast');await quiet(field);
  await button(page.getByRole('dialog'),'Avbryt').click();await quiet(more);
  await more.press('Shift+Tab');await keyboardFocus(row);await page.keyboard.press('Tab');await keyboardFocus(more);
  await page.keyboard.press('Enter');await keyboardFocus(edit);await page.keyboard.press('ArrowDown');await keyboardFocus(page.getByRole('menuitem',{name:'Slett',exact:true}));
  await page.keyboard.press('Escape');await keyboardFocus(more);
  await more.click();await quiet(edit);await page.mouse.click(2,500);await quiet(more);
  await page.locator('#add-songbook').click();await quiet(field);
  await field.press('Tab');await field.focus();await keyboardFocus(field);
  await field.click();await quiet(field);await button(page.getByRole('dialog'),'Avbryt').click();
  await openMenu(page);await button(page,'Sanger').click();await page.locator('#add-song').click();await page.getByRole('menuitem',{name:'Opprett',exact:true}).click();
  const choice=page.getByRole('dialog',{name:'Opprett i sangbok'}),value=choice.locator('.choice-value');await quiet(value);await value.hover();await expect(value).toHaveCSS('border-top-color','rgb(143, 123, 105)');
  await value.press('ArrowDown');await keyboardFocus(choice.getByRole('option',{name:'Standard',exact:true}));await page.keyboard.press('Escape');await keyboardFocus(value);
  await page.keyboard.press('Escape');await keyboardFocus(page.locator('#add-song'));
});

test('tablet touch leaves no active frame after menus, dialogs or an attached keyboard',async({browser})=>{
  const context=await browser.newContext({viewport:{width:800,height:1100},isMobile:true,hasTouch:true}),page=await context.newPage();
  try{
    await page.goto('http://127.0.0.1:4173'+url);await expect(page.locator('#add-song')).toBeEnabled();
    await button(page,'Meny').tap();await button(page,'Sangbøker').tap();const more=page.locator('#songbook-menu-standard');
    await more.tap();await quiet(page.getByRole('menuitem',{name:'Endre navn',exact:true}));await page.touchscreen.tap(2,600);await quiet(more);
    await more.tap();await page.getByRole('menuitem',{name:'Endre navn',exact:true}).tap();const field=page.getByLabel('Navn',{exact:true});await quiet(field);
    await field.pressSequentially('test');await quiet(field);
    await field.press('Tab');await field.focus();await keyboardFocus(field);await field.tap();await quiet(field);
    await button(page.getByRole('dialog'),'Avbryt').tap();await quiet(more);
    await more.tap();await page.getByRole('menuitem',{name:'Slett',exact:true}).tap();const remove=page.getByRole('dialog',{name:'Slett sangbok'});await quiet(button(remove,'Avbryt'));await button(remove,'Avbryt').tap();await quiet(more);
    await button(page,'Meny').tap();await button(page,'Sanger').tap();await page.locator('#add-song').tap();await page.getByRole('menuitem',{name:'Opprett',exact:true}).tap();
    const choice=page.getByRole('dialog',{name:'Opprett i sangbok'}),value=choice.locator('.choice-value');await quiet(value);await value.tap();await quiet(choice.getByRole('option',{name:'Standard',exact:true}));
    await button(choice,'Ny sangbok').tap();await quiet(page.getByLabel('Navn',{exact:true}));await button(page.getByRole('dialog',{name:'Ny sangbok'}),'Avbryt').tap();await quiet(value);
    await button(choice,'Fortsett').tap();const raw=page.getByRole('dialog',{name:'Råtekst'}),text=raw.getByRole('textbox');await quiet(text);await text.pressSequentially('Prøve');await quiet(text);await button(raw,'Avbryt').tap();
  }finally{await context.close();}
});
