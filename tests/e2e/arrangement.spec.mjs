import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importSong, savedSongs} from './song-helpers.mjs';
const base = '/hobos-songbook/test/';
test.beforeEach(async ({request}) => {await request.post('/__test__/reset');});

test('formatted grids keep measures, beats and repetition symbols in source order with safe notes', async ({page}) => {
  const original = '\uFEFF{title: Skjema}\r\n{key: D}\r\nFør\r\n{start_of_grid shape="2x4" label="Intro"}\r\nA || D . A/C# . | G~D / % %% :|2> 2 ganger\r\n| <img src=x onerror=window.injected=true> . | D . . . |.\r\n{end_of_grid}\r\nEtter';
  await page.goto(base); await importSong(page, 'grid.CHO', original);
  await expect(page.locator('figcaption')).toHaveText('Felles akkordskjema — Intro');
  await expect(page.locator('.grid-measure')).toHaveCount(4);
  await expect(page.locator('.grid-cell')).toHaveCount(16);
  await expect(page.locator('.grid-barline')).toContainText(['||','|','',':|2>','|','|','','|.']);
  await expect(page.locator('.grid-cell[aria-label="G, D"] .grid-chord')).toHaveText(['G','D']);
  await expect(page.locator('.grid-symbol')).toContainText(['·','·','/','%','%%','<img','src=x','onerror=window.injected=true>','·','·','·','·']);
  await expect(page.locator('.grid-note')).toHaveText(['A','2 ganger']);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.locator('.chord-grid img')).toHaveCount(0);
  await expect(page.locator('#song-content')).not.toContainText('{start_of_grid');
  expect((await savedSongs(page))[0].original).toBe(original);
  const order = await page.locator('#song-content > .song-line, #song-content > figure').evaluateAll(nodes => nodes.map(node => node.classList.contains('chord-grid') ? 'grid' : node.textContent));
  expect(order[0]).toContain('Før'); expect(order[1]).toBe('grid'); expect(order[2]).toContain('Etter');
});

test('five centered step widths follow tags immediately, inherit normal 3, and remain independent of chorus expansion', async ({page}) => {
  const original = '{t: Dynamikk}\nNormal\n{x_dyn: 1}\nEn\n{x_dyn: 2}\nTo\n{x_dyn: 3}\nTre\n{x_dyn: 4}\nFire\n{x_dyn: 5}\nFem\n{soc}\n{x_dyn: 4}\nRefreng\n{eoc}\n{x_dyn: 1}\nLavt\n{chorus}\nEtter\n{x_dyn: 9}\nFortsatt';
  await page.goto(base); await importSong(page, 'dynamikk.cho', original);
  const line = text => page.locator('.song-line').filter({has: page.locator('.lyric').filter({hasText:new RegExp(`^${text}$`)})});
  for (const [text,level] of [['Normal',3],['En',1],['To',2],['Tre',3],['Fire',4],['Fem',5],['Lavt',1],['Etter',4],['Fortsatt',4]]) await expect(line(text)).toHaveAttribute('data-dynamic-level',String(level));
  const widths = [];
  for (const text of ['En','To','Tre','Fire','Fem']) {
    const geometry = await line(text).evaluate(node => {
      const row = node.getBoundingClientRect(), style = getComputedStyle(node,'::before');
      const width = parseFloat(style.width), x = row.x + parseFloat(style.left) - width / 2;
      return {width, center:x+width/2, rowCenter:row.x+row.width/2, image:style.backgroundImage, transition:style.transitionDuration, height:style.height};
    });
    expect(Math.abs(geometry.center-geometry.rowCenter)).toBeLessThan(1);
    expect(geometry.image).toBe('none'); expect(geometry.transition).toBe('0s');
    widths.push(geometry.width);
  }
  expect(widths.every((width,index) => index===0 || width>widths[index-1])).toBe(true);
  await expect(page.locator('#song-content')).not.toContainText('{x_dyn');
  await expect(page.locator('.comment')).toContainText(['Ugyldig dynamikknivå']);
  await page.getByRole('button',{name:'Refreng',exact:true}).click();
  await expect(line('Etter')).toHaveAttribute('data-dynamic-level','4');
  await page.getByRole('button',{name:'Refreng',exact:true}).click();
  await expect(line('Etter')).toHaveAttribute('data-dynamic-level','4');
  expect((await savedSongs(page))[0].original).toBe(original);
});

test('grid and profile toggles are independent, persist across songs and offline restart, and retain older display choices', async ({page, context}) => {
  await page.addInitScript(() => {
    const key='hobos-songbook-test:display';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({theme:'light',fontSize:28}));
  });
  await page.goto(base); await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');
  await importSong(page, 'prøve.cho', await readFile('examples/akkordskjema-og-dynamikk.cho','utf8'));
  await expect(page.locator('#theme')).toHaveValue('light'); await expect(page.locator('#font-size')).toHaveValue('28');
  await expect(page.locator('#show-dynamics')).toBeChecked(); await expect(page.locator('#show-grids')).toBeChecked();
  const before = await savedSongs(page);
  await page.locator('#show-dynamics').uncheck();
  await expect(page.locator('.chord-grid').first()).toBeVisible();
  expect(await page.locator('.song-line').first().evaluate(node => getComputedStyle(node,'::before').display)).toBe('none');
  await page.locator('#show-grids').uncheck(); await expect(page.locator('.chord-grid').first()).toBeHidden();
  await page.locator('#show-dynamics').check();
  expect(await page.locator('.song-line').first().evaluate(node => getComputedStyle(node,'::before').display)).not.toBe('none');
  await page.getByRole('button',{name:'← Mine sanger'}).click(); await importSong(page,'ren.txt','Ren tekst');
  await expect(page.locator('.song-line')).toHaveAttribute('data-dynamic-level','3');
  await context.setOffline(true); await page.reload();
  await expect(page.locator('#show-grids')).not.toBeChecked(); await expect(page.locator('#show-dynamics')).toBeChecked();
  await page.getByRole('button',{name:/Skjema og dynamikk|Akkordskjema og dynamikk/}).click();
  await expect(page.locator('.chord-grid').first()).toBeHidden();
  const after = await savedSongs(page); expect(after.find(song => song.id===before[0].id)).toEqual(before[0]);
});

test('grids and dynamic profiles fit mobile, tablet and desktop in both themes and font limits', async ({page}) => {
  await page.goto(base); await importSong(page,'prøve.cho',await readFile('examples/akkordskjema-og-dynamikk.cho','utf8'));
  for (const width of [320,768,1440]) {
    await page.setViewportSize({width,height:900});
    for (const theme of ['dark','light']) {
      await page.locator('#theme').selectOption(theme);
      for (const size of ['16','36']) {
        await page.locator('#font-size').fill(size); await page.locator('#font-size').dispatchEvent('input');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.locator('.grid-barline').evaluateAll(nodes => nodes.filter(node => node.textContent.trim()).every(node =>
          node.getBoundingClientRect().height <= parseFloat(getComputedStyle(node).lineHeight)+1))).toBe(true);
        const profile = await page.locator('.dynamic-row:visible').evaluateAll(nodes => {
          const article = document.getElementById('song-content').getBoundingClientRect();
          return nodes.map(node => {
            const row=node.getBoundingClientRect(), style=getComputedStyle(node,'::before');
            return {level:Number(node.dataset.dynamicLevel), width:parseFloat(style.width), center:row.x+parseFloat(style.left), expectedCenter:article.x+article.width/2, expectedWidth:article.width*Number(node.dataset.dynamicLevel)*.18};
          });
        });
        for (const row of profile) {
          expect(Math.abs(row.center-row.expectedCenter)).toBeLessThan(1);
          expect(Math.abs(row.width-row.expectedWidth)).toBeLessThan(1);
        }
        expect(await page.locator('.grid-measure, .grid-cell').evaluateAll(nodes => nodes.every(node => {
          const rect=node.getBoundingClientRect(); return rect.width>0 && rect.x>=0 && rect.right<=innerWidth && node.scrollWidth<=node.clientWidth+1;
        }))).toBe(true);
      }
    }
  }
});
