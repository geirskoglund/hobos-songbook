import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importSong, savedSongs, openMenu, closeMenu, setDisplay} from './song-helpers.mjs';
const base='/hobos-songbook/test/';
test.beforeEach(async ({request}) => {await request.post('/__test__/reset');});

test('one compact chart keeps musical content without generic heading or inline duplicates', async ({page}) => {
  const original='\uFEFF{title: Skjema}\r\nFør\r\n{start_of_grid shape="2x4" label="Intro"}\r\nA || D . A/C# . | G~D / % %% :|2> 2 ganger\r\n| <img src=x onerror=window.injected=true> . | D . . . |.\r\n{end_of_grid}\r\nEtter';
  await page.goto(base); await importSong(page,'grid.cho',original);
  await expect(page.locator('#chart-dock')).toHaveCount(1);
  await expect(page.locator('#chart-dock figcaption')).toHaveText('Intro');
  await expect(page.locator('#chart-dock')).not.toContainText('Felles akkordskjema');
  await expect(page.locator('#song-body .chord-grid')).toHaveCount(0);
  await expect(page.locator('.grid-measure')).toHaveCount(4);
  await expect(page.locator('.grid-cell')).toHaveCount(16);
  await expect(page.locator('.grid-cell[aria-label="G, D"] .grid-chord')).toHaveText(['G','D']);
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();
  await expect(page.locator('.chord-grid img')).toHaveCount(0);
  await expect(page.locator('.grid-note')).toHaveText(['A','2 ganger']);
  expect((await savedSongs(page))[0].original).toBe(original);
  await expect(page.locator('#song-body')).toContainText('Før'); await expect(page.locator('#song-body')).toContainText('Etter');
});

test('chart sticks, releases into its original position, and sticks again on reopening', async ({page}) => {
  await page.setViewportSize({width:320,height:568}); await page.goto(base);
  const original='{t: Lang sang}\n{start_of_grid}\n'+('| C . . . | G . . . |\n').repeat(16)+'{end_of_grid}\n'+('Lang sangtekst\n').repeat(90);
  await importSong(page,'lang.cho',original); const before=await savedSongs(page);
  await expect.poll(async () => (await page.locator('#chart-dock').boundingBox()).height).toBeLessThan(568*.34);
  await page.evaluate(()=>scrollTo(0,800));
  const header=await page.locator('.topbar').boundingBox(), chart=await page.locator('#chart-dock').boundingBox();
  expect(Math.abs(chart.y-header.y-header.height)).toBeLessThan(1);
  expect(await page.locator('#chart-dock').evaluate(node=>node.scrollHeight<=node.clientHeight+1)).toBe(true);
  await page.setViewportSize({width:320,height:420});
  await expect.poll(async () => (await page.locator('#chart-dock').boundingBox()).height).toBeLessThan(420*.34);
  const scrollBefore=await page.evaluate(()=>scrollY);
  await page.getByRole('button',{name:'Frigjør akkordskjema'}).click();
  await expect(page.locator('#chart-dock')).toHaveAttribute('data-sticky','false');
  await expect(page.locator('#chart-dock')).toBeVisible();
  await expect(page.locator('#chart-dock')).not.toBeInViewport();
  expect(await page.evaluate(()=>scrollY)).toBe(scrollBefore);
  await page.evaluate(()=>scrollTo(0,0)); await expect(page.locator('#chart-dock')).toBeInViewport();
  await expect(page.locator('#chart-dock .grid-chord').first()).toHaveText('C');
  await page.evaluate(()=>scrollTo(0,800)); await expect(page.locator('#chart-dock')).not.toBeInViewport();
  await page.getByRole('button',{name:'← Mine sanger'}).click(); await page.getByRole('button',{name:/Lang sang/}).click();
  await expect(page.locator('#chart-dock')).toBeVisible(); await expect(page.locator('#chart-dock')).toHaveAttribute('data-sticky','true');
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  expect(await savedSongs(page)).toEqual(before);
});

test('personal chart replaces all shared charts using the same presentation; no chart produces no panel', async ({page}) => {
  await page.goto(base); await importSong(page,'felles.cho',await readFile('examples/akkordskjema-og-dynamikk.cho','utf8'));
  const before=await savedSongs(page); const song=before[0];
  await page.evaluate(async songId => {
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('hobos-songbook-test',1);
      request.onsuccess=()=>{const db=request.result, tx=db.transaction('personal','readwrite');
        tx.objectStore('personal').put({songId,chorus:{},chordGrid:'| F#m . | E . |'});
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
      };
    });
  },song.id);
  await page.getByRole('button',{name:'← Mine sanger'}).click(); await page.locator(`[data-song-id="${song.id}"]`).click();
  await expect(page.locator('#chart-dock')).toHaveAttribute('data-source','personal');
  await expect(page.locator('#chart-dock .grid-chord')).toHaveText(['F#m','E']);
  await expect(page.locator('#chart-dock .chord-grid')).toHaveCount(1);
  expect(await savedSongs(page)).toEqual(before);
  await page.getByRole('button',{name:'Refreng',exact:true}).click();
  await page.reload(); await page.locator(`[data-song-id="${song.id}"]`).click();
  await expect(page.locator('#chart-dock .grid-chord')).toHaveText(['F#m','E']);
  await page.getByRole('button',{name:'← Mine sanger'}).click(); await importSong(page,'ren.txt','Ren tekst');
  await expect(page.locator('#chart-dock')).toHaveCount(0);
});

test('dynamics form one narrow continuous symmetric path with soft joins and five widths', async ({page}) => {
  const original='{t: Dynamikk}\nNormal\n{x_dyn: 1}\nEn\n\n{x_dyn: 2}\nTo\n{x_dyn: 3}\nTre\n{x_dyn: 4}\nFire\n{x_dyn: 5}\nFem\n{soc}\n{x_dyn: 4}\nRefreng\n{eoc}\n{x_dyn: 1}\nLavt\n{chorus}\nEtter';
  await page.goto(base); await importSong(page,'dynamikk.cho',original);
  const line=text=>page.locator('.song-line').filter({has:page.locator('.lyric').filter({hasText:new RegExp(`^${text}$`)})});
  for (const [text,level] of [['Normal',3],['En',1],['To',2],['Tre',3],['Fire',4],['Fem',5],['Etter',4]]) await expect(line(text)).toHaveAttribute('data-dynamic-level',String(level));
  await expect(page.locator('#dynamics-profile path')).toHaveCount(1);
  await expect(page.locator('#dynamics-profile path')).toHaveAttribute('d',/C/);
  await expect(page.locator('#dynamics-profile rect')).toHaveCount(0);
  const widths=[];
  for (const text of ['En','To','Tre','Fire','Fem']) {
    const width=await line(text).evaluate(row=>{
      const svg=document.getElementById('dynamics-profile'), path=svg.querySelector('path');
      const rect=row.getBoundingClientRect(), box=svg.getBoundingClientRect();
      const y=rect.y+rect.height/2-box.y, center=svg.viewBox.baseVal.width/2;
      let left=0,right=center;
      for(let i=0;i<16;i++) {const mid=(left+right)/2;if(path.isPointInFill(new DOMPoint(center+mid,y)))left=mid;else right=mid;}
      if (!path.isPointInFill(new DOMPoint(center-left/2,y)) || !path.isPointInFill(new DOMPoint(center+left/2,y))) throw Error('Asymmetric profile');
      return left*2;
    }); widths.push(width);
  }
  expect(widths.every((width,index)=>index===0||width>widths[index-1])).toBe(true);
  const profile=await page.locator('#dynamics-profile').boundingBox(), body=await page.locator('#song-body').boundingBox();
  expect(profile.width).toBeLessThanOrEqual(112); expect(profile.width).toBeLessThanOrEqual(body.width*.23);
  expect(Math.abs(profile.x+profile.width/2-body.x-body.width/2)).toBeLessThan(1);
  expect(Math.abs(profile.height-body.height)).toBeLessThan(1);
  const beforeHeight=profile.height;
  await page.getByRole('button',{name:'Refreng',exact:true}).click();
  await expect.poll(async()=> (await page.locator('#dynamics-profile').boundingBox()).height).toBeGreaterThan(beforeHeight);
  await expect(line('Etter')).toHaveAttribute('data-dynamic-level','4');
  await expect(page.getByRole('button',{name:'Refreng',exact:true})).toHaveCSS('border-top-width','0px');
  expect(await page.getByRole('button',{name:'Refreng',exact:true}).evaluate(node=>getComputedStyle(node,'::after').content)).toBe('none');
  expect((await savedSongs(page))[0].original).toBe(original);
});

test('settings stay in an accessible menu and persist offline without occupying the reader', async ({page,context})=>{
  await page.goto(base); await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');
  await importSong(page,'prøve.cho',await readFile('examples/akkordskjema-og-dynamikk.cho','utf8'));
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(page.locator('.display-settings')).not.toBeVisible();
  await openMenu(page); await expect(page.getByRole('dialog',{name:'Innstillinger'})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await setDisplay(page,{theme:'light',fontSize:28,showGrids:false,showDynamics:false});
  await expect(page.locator('#chart-dock')).not.toBeVisible(); await expect(page.locator('#dynamics-profile')).not.toBeVisible();
  await context.setOffline(true); await page.reload(); await page.getByRole('button',{name:/Akkordskjema og dynamikk/}).click();
  await expect(page.locator('#theme')).toHaveValue('light'); await expect(page.locator('#font-size')).toHaveValue('28');
  await expect(page.locator('#show-grids')).not.toBeChecked(); await expect(page.locator('#show-dynamics')).not.toBeChecked();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await setDisplay(page,{showDynamics:true}); await expect(page.locator('#dynamics-profile')).toBeVisible();
  await expect(page.locator('#chart-dock')).not.toBeVisible();
});

test('compact reader and charts fit all widths and both themes at both font limits', async ({page})=>{
  await page.goto(base); await importSong(page,'prøve.cho',await readFile('examples/akkordskjema-og-dynamikk.cho','utf8'));
  for(const width of [320,768,1440]) {
    await page.setViewportSize({width,height:800});
    for(const theme of ['dark','light']) for(const fontSize of [16,36]) {
      await setDisplay(page,{theme,fontSize});
      const chorusColor=await page.locator('.chorus:not(.reference) > h2').first().evaluate(node=>getComputedStyle(node).color);
      await expect(page.getByRole('button',{name:'Refreng',exact:true})).toHaveCSS('color',chorusColor);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const dock=await page.locator('#chart-dock').boundingBox();expect(dock.height).toBeLessThan(800*.34);
      expect(await page.locator('.grid-measure, .grid-cell').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1))).toBe(true);
      const profile=await page.locator('#dynamics-profile').boundingBox(); expect(profile.width).toBeLessThanOrEqual(112);
      expect((await page.locator('.topbar').boundingBox()).height).toBeLessThanOrEqual(56);
      await expect(page.locator('.display-settings')).not.toBeVisible();
    }
  }
});


test('reader uses tight lines and compact source pauses without added gaps around comments or choruses', async ({page})=>{
  const original='\uFEFF{t: Plassbruk}\r\n\r\n\r\n{comment: Testfil – felles skjema og kommentarer}\r\n'+
    '\r\n'.repeat(9)+'{start_of_grid}\r\n| Em . | C . |\r\n{end_of_grid}\r\n'+
    '\r\n'.repeat(8)+'{comment: Intro – gitar alene}\r\n'+
    '\r\n'.repeat(6)+'{x_dyn: 1}\r\n\r\n{comment: Vers 1 – dempet}\r\n'+
    '\r\n'.repeat(5)+'[Em]Kort [C]linje\r\n'+
    '\r\n'.repeat(8)+'{comment: Før fullt refreng}\r\n{soc}\r\n[G]Refreng\r\n{eoc}\r\n'+
    '\r\n'.repeat(6)+'{comment: Før henvisning}\r\n{chorus}\r\n{comment: Etter henvisning}\r\nEtter\r\n\r\n';
  await page.goto(base); await importSong(page,'luft.cho',original);
  for (const width of [320,768,1440]) {
    await page.setViewportSize({width,height:800});
    for (const fontSize of [16,36]) {
      await setDisplay(page,{fontSize});
      for (const expanded of [false,true]) {
        const ref=page.getByRole('button',{name:'Refreng',exact:true});
        if ((await ref.getAttribute('aria-expanded'))!==String(expanded)) await ref.click();
        const gaps=await page.locator('#song-body').evaluate(body=>{
          const units=[...body.querySelectorAll('.song-line, .comment, .unknown, .chorus > h2')].filter(node=>!node.closest('[hidden]'));
          const line=parseFloat(getComputedStyle(body).lineHeight);
          return units.slice(1).map((node,index)=>{
            const previous=units[index].cloneNode(true); previous.querySelectorAll('.sr-only').forEach(node=>node.remove());
            return {gap:node.getBoundingClientRect().top-units[index].getBoundingClientRect().bottom,line,previous:previous.textContent};
          });
        });
        expect(gaps.every(({gap,line})=>gap>=-.5 && gap<=line+.5)).toBe(true);
        expect(gaps.some(({gap,line})=>Math.abs(gap-line/2)<.5)).toBe(true);
        expect(gaps.every(({gap,line})=>gap<=line/2+.5)).toBe(true);
        for (const label of ['Før fullt refreng','Før henvisning','Etter henvisning']) {
          const adjacent=gaps.find(({previous})=>previous===label);
          expect(adjacent).toBeDefined();
          expect(Math.abs(adjacent.gap)).toBeLessThan(.5);
        }
      }
      const textLine=page.locator('.song-line').filter({hasText:'Etter'});
      expect((await textLine.boundingBox()).height).toBeLessThanOrEqual(fontSize*1.2+.5);
      const heading=await page.locator('.reference h2').boundingBox();
      expect(heading.height).toBeLessThanOrEqual(Math.max(24,fontSize*.8*1.2)+.5);
      const chordRow=page.locator('.song-line.has-chords').first();
      expect((await chordRow.boundingBox()).height).toBeLessThanOrEqual(fontSize*2.1);
    }
  }
  expect((await savedSongs(page))[0].original).toBe(original);
});
