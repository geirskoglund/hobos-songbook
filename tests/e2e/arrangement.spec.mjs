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

test('chart pin toggles both ways, keeps its icons and resets on reopening', async ({page}) => {
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
  const pin=page.locator('#chart-close');
  await expect(pin).toBeEnabled();await expect(pin).toBeFocused();
  await expect(pin).toHaveAttribute('aria-label','Fest akkordskjema');await expect(pin).toHaveAttribute('aria-pressed','false');
  await expect(pin.locator('svg > g')).toHaveAttribute('opacity','.20');
  await expect(page.locator('#chart-dock')).toBeVisible();
  await expect(page.locator('#chart-dock')).not.toBeInViewport();
  expect(await page.evaluate(()=>scrollY)).toBe(scrollBefore);
  await page.evaluate(()=>scrollTo(0,0)); await expect(page.locator('#chart-dock')).toBeInViewport();
  await expect(pin).toBeVisible();const pinSize=await pin.boundingBox();expect(pinSize.width).toBeGreaterThanOrEqual(44);expect(pinSize.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('#chart-dock .grid-chord').first()).toHaveText('C');
  await pin.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#chart-dock')).toHaveAttribute('data-sticky','true');await expect(pin).toHaveAttribute('aria-pressed','true');
  await expect(pin).toHaveAttribute('aria-label','Frigjør akkordskjema');await expect(pin.locator('svg > g')).toHaveAttribute('opacity','1');
  await expect(pin).toBeFocused();
  await page.evaluate(()=>scrollTo(0,800));
  await expect.poll(async()=>Math.abs((await page.locator('#chart-dock').boundingBox()).y-(await page.locator('.topbar').boundingBox()).height)).toBeLessThan(1);
  await pin.click();await expect(pin).toHaveAttribute('aria-pressed','false');
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
      const request=indexedDB.open('hobos-songbook-test');
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

test('touch pin changes on release, remains usable when off and survives an editor visit',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true}),page=await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4173'+base);await importSong(page,'pin.cho','{t: Berøringspinne}\n{sog}\n| D . | A . |\n{eog}\nTekst');
    const before=await savedSongs(page),pin=page.locator('#chart-close'),cdp=await context.newCDPSession(page);
    const bounds=await pin.boundingBox(),point={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await expect(pin).toHaveAttribute('aria-pressed','true');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(pin).toHaveAttribute('aria-pressed','false');
    await expect(pin).toBeVisible();await expect(pin).toBeEnabled();await expect(pin.locator('svg > g')).toHaveAttribute('opacity','.20');
    await page.locator('#edit-song').tap();await expect(pin).toBeHidden();await page.getByRole('button',{name:'Visning',exact:true}).tap();
    await expect(pin).toBeVisible();await expect(pin).toHaveAttribute('aria-pressed','false');await pin.tap();await expect(pin).toHaveAttribute('aria-pressed','true');
    const current=await pin.boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:current.x+current.width/2,y:current.y+current.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await expect(pin).toHaveAttribute('aria-pressed','true');await expect(pin.locator('svg > g')).toHaveAttribute('opacity','1');expect(await savedSongs(page)).toEqual(before);
  } finally {await context.close();}
});

test('dynamics have a straight left edge and exact fixed widths in a 30px margin', async ({page},testInfo) => {
  const original='{t: Dynamikk}\n{sog}\n| C . | G . |\n{eog}\nNormal\n{x_dyn: 1}\nEn\n\n{x_dyn: 2}\nTo\n{x_dyn: 3}\nTre\n{x_dyn: 4}\nFire\n{x_dyn: 5}\nFem\n{soc}\n{x_dyn: 4}\nRefreng\n{eoc}\n{x_dyn: 1}\nLavt\n{chorus}\nEtter';
  await page.setViewportSize({width:390,height:844});await page.goto(base); await importSong(page,'dynamikk.cho',original);
  const line=text=>page.locator('.song-line').filter({has:page.locator('.lyric').filter({hasText:new RegExp(`^${text}$`)})});
  for (const [text,level] of [['Normal',3],['En',1],['To',2],['Tre',3],['Fire',4],['Fem',5],['Etter',1]]) await expect(line(text)).toHaveAttribute('data-dynamic-level',String(level));
  await expect(page.locator('#dynamics-profile path')).toHaveCount(1);
  await expect(page.locator('#dynamics-profile path')).toHaveAttribute('d',/C/);
  await expect(page.locator('#dynamics-profile rect')).toHaveCount(0);
  for(const theme of ['dark'])for(const fontSize of [16,36]){
    await setDisplay(page,{theme,fontSize});
    const widths=[];
    for(const text of ['Normal','En','To','Tre','Fire','Fem']){
      const width=await line(text).evaluate(row=>{
        const svg=document.getElementById('dynamics-profile'),path=svg.querySelector('path'),rect=row.getBoundingClientRect(),box=svg.getBoundingClientRect();
        const y=rect.y+rect.height/2-box.y;
        if(!path.isPointInFill(new DOMPoint(.01,y))||path.isPointInFill(new DOMPoint(-.01,y)))throw Error('Left edge is not fixed at zero');
        let left=0,right=30;
        for(let n=0;n<20;n++){const mid=(left+right)/2;if(path.isPointInFill(new DOMPoint(mid,y)))left=mid;else right=mid;}
        return left;
      });widths.push(width);
    }
    for(const [index,expected]of [15,5,10,15,20,25].entries())expect(Math.abs(widths[index]-expected)).toBeLessThan(.01);
    const profile=await page.locator('#dynamics-profile').boundingBox(),body=await page.locator('#song-body').boundingBox(),text=await line('Fem').boundingBox();
    expect(profile.width).toBe(25);expect(profile.x).toBe(body.x);expect(text.x-profile.x).toBe(30);expect(text.x-profile.x-widths.at(-1)).toBeCloseTo(5,2);
    expect(Math.abs(profile.height-body.height)).toBeLessThan(1);expect(profile.y).toBeGreaterThanOrEqual((await page.locator('#chart-dock').boundingBox()).y+(await page.locator('#chart-dock').boundingBox()).height);
    expect((await page.locator('#song-title').boundingBox()).x).toBe(body.x);
    await page.screenshot({path:testInfo.outputPath(`dynamics-${theme}-${fontSize}.png`),fullPage:true});
  }
  const profile=await page.locator('#dynamics-profile').boundingBox();
  const beforeHeight=profile.height;
  await page.getByRole('button',{name:'Refreng',exact:true}).click();
  await expect.poll(async()=> (await page.locator('#dynamics-profile').boundingBox()).height).toBeGreaterThan(beforeHeight);
  await expect(line('Etter')).toHaveAttribute('data-dynamic-level','1');
  await expect(page.getByRole('button',{name:'Refreng',exact:true})).toHaveCSS('border-top-width','0px');
  expect(await page.getByRole('button',{name:'Refreng',exact:true}).evaluate(node=>getComputedStyle(node,'::after').content)).toBe('none');
  expect((await savedSongs(page))[0].original).toBe(original);
});

test('dynamics reserve no margin without valid tags, when switched off, or below 320px',async({page})=>{
  await page.goto(base);await importSong(page,'uten.txt','{t: Uten dynamikk}\nTekst uten tagger\n{x_dyn: 9}\nUgyldig er ikke et nivå');
  await expect(page.locator('#dynamics-profile')).toHaveCount(0);await expect(page.locator('#song-body')).toHaveCSS('padding-left','0px');
  await page.locator('#back').click();await importSong(page,'med.txt','{t: Med dynamikk}\nNormal før første tagg\n{x_dyn: 5}\nSterkt');
  await expect(page.locator('#dynamics-profile')).toBeVisible();await expect(page.locator('#song-body')).toHaveCSS('padding-left','30px');
  for(const width of [319,320,390]){
    await page.setViewportSize({width,height:800});await expect(page.locator('#song-body')).toHaveCSS('padding-left',width<320?'0px':'30px');
    if(width<320)await expect(page.locator('#dynamics-profile')).not.toBeVisible();else await expect(page.locator('#dynamics-profile')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await setDisplay(page,{showDynamics:false});await expect(page.locator('#dynamics-profile')).not.toBeVisible();await expect(page.locator('#song-body')).toHaveCSS('padding-left','0px');
  await setDisplay(page,{showDynamics:true});await expect(page.locator('#dynamics-profile')).toBeVisible();await expect(page.locator('#song-body')).toHaveCSS('padding-left','30px');
});

test('annotation overlay follows a narrower viewport before its deferred geometry draw', async ({page}) => {
  await page.goto(base); await importSong(page, 'bredde.txt', '{t: Bredde}\nKort tekst');
  await expect(page.locator('.annotation-connectors')).toHaveAttribute('height', /\d/);
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 1;
  });
  await page.setViewportSize({width: 319, height: 800});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.annotation-connectors').evaluate(svg => svg.getBoundingClientRect().width <= svg.parentElement.clientWidth)).toBe(true);
});

test('settings stay in an accessible menu and persist offline without occupying the reader', async ({page,context})=>{
  await page.goto(base); await expect(page.locator('#offline-status')).toHaveAttribute('data-ready','true');
  await importSong(page,'prøve.cho',await readFile('examples/akkordskjema-og-dynamikk.cho','utf8'));
  await expect(page.locator('#main-menu')).not.toBeVisible();
  await expect(page.locator('.display-settings')).not.toBeVisible();
  await openMenu(page); await expect(page.getByRole('navigation',{name:'Hovedmeny'})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#main-menu')).not.toBeVisible();
  await setDisplay(page,{theme:'dark',fontSize:28,showGrids:false,showDynamics:false});
  await expect(page.locator('#chart-dock')).not.toBeVisible(); await expect(page.locator('#dynamics-profile')).not.toBeVisible();
  await context.setOffline(true); await page.reload(); await page.getByRole('button',{name:/Akkordskjema og dynamikk/}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark'); await expect(page.locator('#font-size')).toHaveValue('28');
  await expect(page.locator('#show-grids')).not.toBeChecked(); await expect(page.locator('#show-dynamics')).not.toBeChecked();
  await expect(page.locator('#main-menu')).not.toBeVisible();
  await setDisplay(page,{showDynamics:true}); await expect(page.locator('#dynamics-profile')).toBeVisible();
  await expect(page.locator('#chart-dock')).not.toBeVisible();
});

test('compact reader and charts fit all widths and the dark theme at both font limits', async ({page})=>{
  await page.goto(base); await importSong(page,'prøve.cho',await readFile('examples/akkordskjema-og-dynamikk.cho','utf8'));
  for(const width of [320,768,1440]) {
    await page.setViewportSize({width,height:800});
    for(const theme of ['dark']) for(const fontSize of [16,36]) {
      await setDisplay(page,{theme,fontSize});
      const chorusColor=await page.locator('.chorus:not(.reference) > h2').first().evaluate(node=>getComputedStyle(node).color);
      await expect(page.getByRole('button',{name:'Refreng',exact:true})).toHaveCSS('color',chorusColor);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const dock=await page.locator('#chart-dock').boundingBox();expect(dock.height).toBeLessThan(800*.34);
      expect(await page.locator('.grid-measure, .grid-cell').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1))).toBe(true);
      const profile=await page.locator('#dynamics-profile').boundingBox(); expect(profile.width).toBe(25);await expect(page.locator('#song-body')).toHaveCSS('padding-left','30px');
      expect((await page.locator('.topbar').boundingBox()).height).toBe(await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height'))));
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
