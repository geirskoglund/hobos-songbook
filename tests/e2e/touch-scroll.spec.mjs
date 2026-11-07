import {test, expect, devices} from '@playwright/test';
import {importSong, savedSongs, openMenu, closeMenu} from './song-helpers.mjs';

test('mobile root prevents pull-to-refresh while touch scrolling and reader controls still work', async ({browser, request}) => {
  await request.post('/__test__/reset');
  const context = await browser.newContext({...devices['Pixel 7'], baseURL:'http://127.0.0.1:4173'});
  try {
    const page = await context.newPage(), input = await context.newCDPSession(page);
    async function swipe(from, to) {
      const point = y => [{x:180, y, radiusX:1, radiusY:1, force:1}];
      await input.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:point(from)});
      for (let step=1; step<=12; step++) {
        await input.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:point(from+(to-from)*step/12)});
        // Space physical input samples across frames so Chromium recognizes a scroll gesture.
        await page.waitForTimeout(16);
      }
      await input.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    }
    for (const channel of ['test','app']) {
      await page.goto(`/hobos-songbook/${channel}/`);
      const original='{t: Leseprøve}\n{soc}\nSyng med\n{eoc}\n{chorus}\n'+('En vanlig tekstlinje\n').repeat(120);
      await importSong(page,'leseprøve.cho',original);
      const songs = await savedSongs(page);
      const ref = page.getByRole('button',{name:'Refreng',exact:true});
      await ref.tap(); await expect(ref).toHaveAttribute('aria-expanded','true');
      await page.evaluate(()=>scrollTo(0,0));
      const timeOrigin = await page.evaluate(()=>performance.timeOrigin);
      const root = await page.evaluate(()=>({tag:document.scrollingElement.tagName, overscroll:getComputedStyle(document.scrollingElement).overscrollBehaviorY, horizontal:getComputedStyle(document.scrollingElement).overscrollBehaviorX}));
      expect(root).toEqual({tag:'HTML', overscroll:'none', horizontal:'auto'});
      await swipe(200,600);
      await expect(page.locator('#song-title')).toHaveText('Leseprøve');
      expect(await page.evaluate(()=>performance.timeOrigin)).toBe(timeOrigin);
      expect(await page.evaluate(()=>scrollY)).toBe(0);
      await expect(ref).toHaveAttribute('aria-expanded','true');
      await swipe(600,200);
      await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
      await page.evaluate(()=>scrollTo(0,0));
      await openMenu(page); await closeMenu(page);
      await ref.tap(); await expect(ref).toHaveAttribute('aria-expanded','false');
      expect(await savedSongs(page)).toEqual(songs);
      await page.getByRole('button',{name:'← Mine sanger'}).tap();
      await expect(page.locator('#library')).toBeVisible();
    }
  } finally {await context.close();}
});
