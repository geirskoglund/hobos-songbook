import {test, expect} from './fixtures.mjs';
import {openMenu, goSongs, beginCreate, importAndOpenSong} from './song-helpers.mjs';

// Expectations come from DESIGN's source-linked table and the original SVGs.
// Never derive them from runtime CSS tokens or update them to match a regression.
const url = '/hobos-songbook/test/';
const dialog = (page, name) => page.getByRole('dialog', {name, exact: true});
const button = (scope, name) => scope.getByRole('button', {name, exact: true});
const go = async (page, name) => {
  await openMenu(page);
  await button(page, name).click();
};
const height = async node => (await node.boundingBox()).height;
// L01 measured from the row: title and metadata offsets, type and the separator.
const rowGeometry = row =>
  row.evaluate(n => {
    const r = n.getBoundingClientRect(),
      title = n.querySelector('.row-title'),
      meta = n.querySelector('.row-metadata'),
      t = title.getBoundingClientRect(),
      m = meta.getBoundingClientRect(),
      ts = getComputedStyle(title),
      rs = getComputedStyle(n);
    return {
      height: r.height,
      top: t.top - r.top,
      left: t.left - r.left,
      gap: m.top - t.bottom,
      bottom: r.bottom - m.bottom,
      size: parseFloat(ts.fontSize),
      weight: ts.fontWeight,
      lineHeight: parseFloat(ts.lineHeight) / parseFloat(ts.fontSize),
      meta: getComputedStyle(meta).fontSize,
      border: `${rs.borderBottomWidth} ${rs.borderBottomColor}`,
    };
  });
// DESIGN L01: 21–24 px (3vw) title at weight 500, 15 px metadata, 20 px air, 10 px between, 1 px separator.
function l01(geometry, width) {
  expect(geometry.size).toBeCloseTo(Math.min(24, Math.max(21, width * 0.03)), 1);
  expect(geometry.weight).toBe('500');
  expect(geometry.lineHeight).toBeCloseTo(1.3, 2);
  expect(geometry.meta).toBe('15px');
  expect(geometry.top).toBeCloseTo(20, 0);
  expect(geometry.gap).toBeCloseTo(10, 0);
  expect(geometry.bottom).toBeCloseTo(21, 0);
  expect(geometry.left).toBe(0);
  expect(geometry.border).toMatch(/^1px /);
}
// Product feedback keeps the existing weak dimming for contextual controls.
const weakBackdrop = async box =>
  expect(await box.evaluate(n => getComputedStyle(n, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0.133)');
async function footer(box) {
  const actions = box.locator('.dialog-footer');
  await expect(actions).toHaveCSS('background-color', 'rgb(50, 46, 42)');
  for (const action of await actions.locator('button').all()) {
    expect(await height(action)).toBeGreaterThanOrEqual(80);
    await expect(action).toHaveCSS('font-size', '18px');
  }
  await expect(actions.locator('.primary')).toHaveCSS('background-color', 'rgb(226, 192, 151)');
  await expect(actions.locator('.primary')).toHaveCSS('color', 'rgb(39, 36, 33)');
}
async function field(box) {
  const input = box.getByLabel('Navn', {exact: true});
  expect(await height(input)).toBeCloseTo(59, 0);
  await expect(input).toHaveCSS('font-size', '18px');
  await expect(input).toHaveCSS('border-radius', '8px');
  await expect(input).toHaveCSS('background-color', 'rgb(50, 46, 42)');
  await box.locator('label').click();
  await expect(input).toBeFocused();
  await input.press('Tab');
  await input.focus();
  const focus = await input.evaluate(n => {
    const s = getComputedStyle(n);
    return {width: parseFloat(s.outlineWidth), outside: parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset)};
  });
  expect(focus.width).toBeGreaterThan(0);
  expect(focus.outside).toBeLessThanOrEqual(0);
  await expect(box).toHaveCSS('border-radius', '24px');
  await footer(box);
}
test.beforeEach(async ({request}) => {
  await request.post('/__test__/reset');
});

for (const width of [320, 768, 1440])
  test(`shared design contracts at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.goto(url);
    await expect(page.locator('#add-song')).toBeEnabled();
    await page.evaluate(
      () =>
        new Promise(resolve => {
          const r = indexedDB.open('hobos-songbook-test');
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction(['songbooks', 'setlists'], 'readwrite');
            for (const store of ['songbooks', 'setlists'])
              for (const [id, name] of [
                ['a', 'A'],
                ['b', 'B'],
                ['long', 'Å'.repeat(200)],
              ])
                tx.objectStore(store).put({id, name, createdAt: 1, songIds: []});
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        }),
    );
    await page.reload();
    await expect(page.locator('#add-song')).toBeEnabled();
    for (const [name, id, add, edit] of [
      ['Setlister', 'setlist', '#add-setlist', 'Endre info'],
      ['Sangbøker', 'songbook', '#add-songbook', 'Endre navn'],
    ]) {
      await go(page, name);
      const rows = page.locator(`#${id}-list .list-row`),
        first = rows.first();
      l01(await rowGeometry(first), width);
      const a = await rows.nth(0).boundingBox(),
        b = await rows.nth(1).boundingBox();
      expect(b.y - a.y).toBeCloseTo(a.height, 0);
      const long = page.locator(`#${id}-long`);
      expect(await height(long)).toBeGreaterThan(a.height);
      await expect(long).toHaveJSProperty('scrollWidth', await long.evaluate(n => n.clientWidth));
      await page.locator(add).click();
      const create = dialog(page, id === 'setlist' ? 'Ny setliste' : 'Ny sangbok');
      await field(create);
      await button(create, 'Avbryt').click();
      await first.locator('.row-menu').click();
      const menu = page.locator('.context-menu');
      await expect(menu).toHaveCSS('background-color', 'rgb(64, 56, 49)');
      await expect(menu).toHaveCSS('border-radius', '16px');
      await weakBackdrop(menu);
      expect((await menu.boundingBox()).width).toBeCloseTo(265, 0);
      expect(await height(menu)).toBeCloseTo(139, 0);
      await expect(menu.getByRole('menuitem').first()).toHaveCSS('font-size', '17px');
      for (const action of await menu.getByRole('menuitem').all()) {
        const columns = await action.evaluate(n => {
          const r = n.getBoundingClientRect(),
            i = n.querySelector('.icon').getBoundingClientRect();
          return [i.left - r.left, n.querySelector('span').getBoundingClientRect().left - i.right];
        });
        expect(columns[0]).toBeCloseTo(23, 0);
        expect(columns[1]).toBeCloseTo(17, 0);
      }
      await menu.getByRole('menuitem', {name: edit, exact: true}).click();
      await field(page.locator('dialog[open]'));
      await button(page.locator('dialog[open]'), 'Avbryt').click();
    }
    await goSongs(page);
    await page.locator('#songbook-filter').click();
    const filter = dialog(page, 'Sangbok');
    await weakBackdrop(filter);
    await expect(filter.locator('.choice-value')).toHaveCSS('font-size', '23px');
    expect(await height(filter.locator('.choice-value'))).toBeCloseTo(68, 0);
    await page.getByRole('option', {name: 'Standard', exact: true}).click();
    await page.locator('#add-song').click();
    await weakBackdrop(page.locator('.context-menu'));
    await page.getByRole('menuitem', {name: 'Opprett', exact: true}).click();
    const step = dialog(page, 'Opprett i sangbok');
    await weakBackdrop(step);
    await expect(step).toHaveCSS('border-radius', '24px');
    await footer(step);
    const value = step.locator('.choice-value');
    expect(await height(value)).toBeCloseTo(68, 0);
    await expect(value).toHaveCSS('font-size', '23px');
    await value.click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(step.getByRole('heading')).toHaveCount(1);
    const inset = await step.locator('.choice-create').evaluate(n => {
      const p = n.parentElement.getBoundingClientRect(),
        r = n.getBoundingClientRect(),
        s = getComputedStyle(n, '::before');
      return [r.left - p.left + parseFloat(s.left), p.right - r.right + parseFloat(s.right)];
    });
    expect(inset[0]).toBeCloseTo(22, 0);
    expect(inset[1]).toBeCloseTo(22, 0);
    await button(step, 'Ny sangbok').click();
    await field(dialog(page, 'Ny sangbok'));
    await button(dialog(page, 'Ny sangbok'), 'Avbryt').click();
    if (width === 320) {
      await page.setViewportSize({width, height: 420});
      await value.click();
      await button(step, 'Ny sangbok').scrollIntoViewIfNeeded();
      await expect(button(step, 'Ny sangbok')).toBeInViewport();
      await expect(button(step, 'Avbryt')).toBeInViewport();
      await page.setViewportSize({width, height: 900});
    }
    if ((await value.getAttribute('aria-expanded')) === 'false') await value.click();
    await step.getByRole('option', {name: 'Å'.repeat(200), exact: true}).click();
    expect(await height(value)).toBeGreaterThan(68);
    expect(await value.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    await footer(step);
    await button(step, 'Avbryt').click();
    await beginCreate(page);
    const raw = dialog(page, 'Råtekst');
    await footer(raw);
    await expect(raw).toHaveCSS('border-radius', '0px');
    await button(raw, 'Avbryt').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

test('E02/E03/E04 share the real footer geometry and secondary separator rules', async ({page}) => {
  await page.goto(url);
  await expect(page.locator('#add-song')).toBeEnabled();
  for (const width of [320, 768])
    for (const count of [1, 2, 3]) {
      await page.setViewportSize({width, height: 700});
      await page.evaluate(async count => {
        const {dialogFrame, dialogFooter} = await import('/__test__/controls.js');
        const box = dialogFrame('Footerkontrakt', 'name-dialog'),
          heading = document.createElement('h2');
        heading.textContent = 'Kontroll';
        const actions = Array.from({length: count}, (_, i) => ({
          id: String(i),
          label: i === count - 1 ? 'Lagre' : i === 0 ? 'Avbryt' : 'Tilbake',
          icon: i === count - 1 ? 'lagre' : i === 0 ? 'avbryt' : undefined,
          primary: i === count - 1,
          run: () => {
            box.close();
            box.remove();
          },
        }));
        box.append(heading, dialogFooter(actions));
        document.body.append(box);
        box.showModal();
      }, count);
      const box = dialog(page, 'Footerkontrakt');
      await footer(box);
      await expect(box).toHaveCSS('border-radius', '24px');
      const actions = await box.locator('.dialog-footer button').all();
      for (const action of actions) expect(await height(action)).toBeCloseTo(80, 0);
      const separators = await box.locator('.dialog-footer button').evaluateAll(nodes =>
        nodes.map(n => {
          const s = getComputedStyle(n, '::before');
          return {content: s.content, top: s.top, bottom: s.bottom};
        }),
      );
      expect(separators.filter(s => s.content !== 'none')).toEqual(
        count === 3 ? [{content: '""', top: '12px', bottom: '12px'}] : [],
      );
      await button(box, 'Lagre').click();
    }
});

test('L01 is one row with optional menu and status icons, measured as the song list', async ({page}) => {
  await page.goto(url);
  await expect(page.locator('#add-song')).toBeEnabled();
  await importAndOpenSong(page, 'rad.cho', '{title: Sangrad}\n{key: D}\n[D]Hei\n');
  await goSongs(page);
  const statuses = ['status-privat', 'status-delt', 'status-importert', 'status-slettet', 'status-slettet-hos-kilden'];
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    const songRow = page.locator('#song-list .list-row').first();
    await expect(songRow).toBeVisible();
    const song = await rowGeometry(songRow);
    l01(song, width);
    await page.evaluate(async statuses => {
      const {listRow} = await import('/__test__/controls.js');
      document.getElementById('row-fixture')?.remove();
      const list = document.createElement('ul');
      list.id = 'row-fixture';
      list.className = 'song-list';
      const long = 'Veldiglangtittelutenmellomrom'.repeat(8);
      const rows = [
        {title: 'Uten noe', details: ['D']},
        {title: 'Med meny', details: ['D'], menu: () => {}},
        {title: 'Med status', details: ['D'], statuses: statuses.slice(0, 2)},
        {title: 'Med begge', details: ['D'], menu: () => {}, statuses: statuses.slice(0, 2)},
        {title: long, details: [long, 'D'], menu: () => {}, statuses},
        {title: 'Uten handling', details: ['D'], statuses: ['status-importert']},
      ].map((options, i) => {
        const {row} = listRow({...options, ...(i < 5 ? {choose: () => {}} : {})});
        row.id = `row-${i}`;
        return row;
      });
      list.append(...rows);
      document.querySelector('#library').append(list);
    }, statuses);
    const rows = [0, 1, 2, 3, 4, 5].map(i => page.locator(`#row-${i}`));
    const plain = await rowGeometry(rows[0]);
    expect(plain).toEqual(song);
    for (const row of rows.slice(1, 4)) expect(await rowGeometry(row)).toEqual(plain);
    expect(await rowGeometry(rows[5])).toEqual(plain);
    const placement = await page.evaluate(() =>
      [1, 2, 3, 4, 5].map(i => {
        const row = document.getElementById(`row-${i}`),
          box = row.getBoundingClientRect(),
          menu = row.querySelector('.row-menu')?.getBoundingClientRect(),
          group = row.querySelector('.row-statuses'),
          icons = [...(group?.querySelectorAll('.icon') ?? [])].map(icon => icon.getBoundingClientRect()),
          title = row.querySelector('.row-title').getBoundingClientRect(),
          text = row.querySelector('.row-text');
        return {
          right: box.right,
          menuLeft: menu?.left,
          menuRight: menu?.right,
          menuHeight: menu?.height,
          rowHeight: box.height - 1,
          groupRight: group?.getBoundingClientRect().right,
          groupLeft: group?.getBoundingClientRect().left,
          label: group?.getAttribute('aria-label'),
          rowLabel: row.firstElementChild.getAttribute('aria-label'),
          icons: icons.map(icon => ({x: icon.x, y: icon.y, w: icon.width})),
          titleRight: title.right,
          textOverflow: text.scrollWidth > text.clientWidth,
        };
      }),
    );
    const [menuOnly, statusOnly, both, long, inert] = placement;
    // H04 stays at the far right and spans the row without growing it.
    expect(menuOnly.menuRight).toBeCloseTo(menuOnly.right, 0);
    expect(menuOnly.menuHeight).toBeCloseTo(menuOnly.rowHeight, 0);
    expect(menuOnly.menuHeight).toBeGreaterThanOrEqual(44);
    // Status icons stand in the menu's place without one, and directly before it with one.
    expect(statusOnly.groupRight).toBeCloseTo(statusOnly.right, 0);
    expect(inert.groupRight).toBeCloseTo(inert.right, 0);
    expect(both.groupRight).toBeCloseTo(both.menuLeft, 0);
    expect(long.label).toBe('Privat, Delt, Importert, Slettet, Slettet hos kilden');
    for (const [row, count] of [
      [statusOnly, 2],
      [both, 2],
      [long, 5],
    ]) {
      expect(row.icons).toHaveLength(count);
      for (const [i, icon] of row.icons.entries()) {
        expect(icon.w).toBe(24);
        expect(icon.y).toBeCloseTo(row.icons[0].y, 0);
        if (i) expect(icon.x).toBeGreaterThan(row.icons[i - 1].x + 24);
      }
      expect(row.titleRight).toBeLessThanOrEqual(row.groupLeft);
    }
    expect(both.label).toBe('Privat, Delt');
    expect(both.rowLabel).toBe('Med begge, D, Privat, Delt');
    expect(inert.rowLabel).toBeNull();
    // Long text wraps inside the row, before the icons and the menu.
    expect(long.textOverflow).toBe(false);
    expect(long.rowHeight).toBeGreaterThan(plain.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // The row without an action is neither a button nor focusable.
    await expect(rows[5].locator('.row-choice')).not.toHaveAttribute('tabindex');
    expect(await rows[5].locator('button').count()).toBe(0);
    // Hover lights the whole row, menu included, 12px past the text on both sides.
    const field = row =>
      row.evaluate(n => {
        const s = getComputedStyle(n);
        return {background: s.backgroundColor, shadow: s.boxShadow};
      });
    const idle = await field(rows[1]);
    expect(idle.background).toBe('rgba(0, 0, 0, 0)');
    for (const target of [rows[1].locator('.row-choice'), rows[1].locator('.row-menu')]) {
      await target.hover();
      const lit = await field(rows[1]);
      expect(lit.background).not.toBe(idle.background);
      expect(lit.shadow).toBe(`${lit.background} -12px 0px 0px 0px, ${lit.background} 12px 0px 0px 0px`);
    }
    await rows[5].hover();
    expect(await field(rows[5])).toEqual(idle);
    await page.mouse.move(0, 0);
  }
  await page.evaluate(() => document.getElementById('row-fixture').remove());
});
