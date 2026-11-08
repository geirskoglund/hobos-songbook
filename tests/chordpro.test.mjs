import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseChordPro, parseLine, isChord} from '../src/domain/chordpro.ts';
import {createSong, decodeSong} from '../src/domain/song.ts';

test('imports keep exact original and unique identity independently of metadata', () => {
  const original = '\uFEFF{t: Blå sang}\r\n{key: D}\r\n\r\n[x] æøå [D/F#]ord\n{x_dyn: 3}\n';
  const a = createSong('A.CHO', new TextEncoder().encode(original));
  const b = createSong('A.CHO', new TextEncoder().encode(original));
  assert.notEqual(a.id, b.id); assert.equal(a.original, original);
  assert.equal(a.title, 'Blå sang'); assert.equal(a.key, 'D');
  assert.equal(a.origin.filename, 'A.CHO'); assert.equal(a.origin.kind, 'local');
  assert.ok(!Number.isNaN(Date.parse(a.origin.importedAt)));
  assert.equal(createSong('Vanlig.TXT', new TextEncoder().encode('Ren tekst')).title, 'Vanlig');
});
test('strict decoding rejects empty, binary, corrupt and unsupported files', () => {
  for (const bytes of [[], [0], [0xff, 0xfe], [0xc3, 0x28], [32, 10]]) assert.throws(() => decodeSong(new Uint8Array(bytes)));
  assert.throws(() => createSong('test.pdf', new TextEncoder().encode('tekst')));
  assert.equal(decodeSong(new TextEncoder().encode('æøå\r\n')), 'æøå\r\n');
});
test('chord tokens preserve musical spelling and legacy markers remain text', () => {
  for (const chord of ['C', 'Am', 'D/F#', 'Bbmaj7', 'C7(b9)', 'F#sus4', 'Gø7', 'N.C.', 'H7', 'Cadd9', 'D7sus4']) assert.equal(isChord(chord), true, chord);
  for (const text of ['Solo', 'Fele', 'Ref', 'Chorus', '<img>']) assert.equal(isChord(text), false, text);
  assert.deepEqual(parseLine('ord[C]mid[Am][G]t [Solo]'), [{chord: undefined, text: 'ord'}, {chord: 'C', text: 'mid'}, {chord: 'Am', text: ''}, {chord: 'G', text: 't [Solo]'}]);
});
test('parser keeps content order, deterministic independent references and nearest previous chorus', () => {
  const original = '{title: T}\n{key: C}\n{chorus}\n{comment: Rolig}\n{soc}\n[C]Hei\n{eoc}\n{chorus}\n{chorus}\n{soc}\nNy\n{eoc}\n{chorus}\n{x_future: ja}\n{eoc}\nEtter\n{soc}\nUferdig';
  const a = parseChordPro(original, 'fallback'), b = parseChordPro(original, 'fallback');
  assert.deepEqual(a, b); assert.equal(a.title, 'T'); assert.equal(a.key, 'C');
  const refs = a.blocks.filter(block => block.kind === 'reference');
  assert.equal(refs[0].content, null); assert.equal(refs[1].occurrence, 'line:7');
  assert.notEqual(refs[1].occurrence, refs[2].occurrence);
  assert.deepEqual(refs[1].content[0].segments, [{chord: 'C', text: 'Hei'}]);
  assert.equal(refs[3].content[0].segments[0].text, 'Ny');
  assert.ok(a.blocks.some(block => block.kind === 'unknown' && block.text.includes('x_future')));
  assert.equal(a.blocks.at(-1).content[0].segments[0].text, 'Uferdig');
  assert.equal(a.blocks.at(-2).segments[0].text, 'Etter');
});

test('grid bars retain beat cells, repeats, margins and multi-chord cells without rewriting source', async () => {
  const {parseGridRow, gridOptions} = await import('../src/domain/grid.ts');
  const row = parseGridRow('Intro || D . A/C# . | G~D / % %% :|2> 2 ganger');
  assert.equal(row.left, 'Intro'); assert.equal(row.right, '2 ganger');
  assert.deepEqual(row.measures, [
    {opening:'||', closing:'|', cells:['D','.','A/C#','.']},
    {opening:'', closing:':|2>', cells:['G~D','/','%','%%']},
  ]);
  assert.equal(parseGridRow('Bare en merknad').left, 'Bare en merknad');
  assert.equal(parseGridRow('| C . |.').measures[0].closing, '|.');
  assert.deepEqual(gridOptions('shape="1+4x4+1" label="Intro"'), {columns:4, beats:4, label:'Intro'});
  assert.deepEqual(gridOptions('2x4 Mellomspill'), {columns:2, beats:4, label:'Mellomspill'});
  assert.deepEqual(gridOptions('', {columns:2, beats:3, label:'Tidligere'}), {columns:2, beats:3, label:null});
  const original = '\uFEFF{t: Skjema}\r\n{start_of_grid shape="2x4" label="Intro"}\r\n| D . . . | A . . . |\r\n{end_of_grid}\r\nTekst';
  const song = createSong('skjema.cho', new TextEncoder().encode(original));
  assert.equal(song.original, original);
  const parsed = parseChordPro(song.original, song.title);
  assert.equal(parsed.blocks[0].kind, 'grid'); assert.equal(parsed.blocks[0].options.columns, 2);
  assert.equal(parsed.blocks[1].segments[0].text, 'Tekst');
});

test('dynamics are ordered instructions, including inside grids and repeated choruses; invalid values leave state alone', () => {
  const parsed = parseChordPro('{x_dyn: 1}\nLavt\n{x_dyn: 2}\n{soc}\n{x_dyn: 4}\nRefreng\n{eoc}\n{chorus}\n{start_of_grid}\n| C . |\n{x_dyn: 5}\n| G . |\n{end_of_grid}\n{x_dyn: 0}\n{x_dyn: 6}\n{x_dyn: feil}\nEtter', 'T');
  assert.deepEqual(parsed.blocks.slice(0,3).map(block => block.kind), ['dynamic','line','dynamic']);
  const chorus = parsed.blocks.find(block => block.kind === 'chorus');
  const ref = parsed.blocks.find(block => block.kind === 'reference');
  assert.deepEqual(chorus.content[0], {kind:'dynamic',level:4}); assert.deepEqual(ref.content, chorus.content);
  const grid = parsed.blocks.find(block => block.kind === 'grid');
  assert.deepEqual(grid.rows.map(row => row.kind), ['grid-row','dynamic','grid-row']);
  assert.deepEqual(grid.rows[1], {kind:'dynamic',level:5});
  assert.equal(parsed.blocks.filter(block => block.kind === 'comment' && block.text.includes('Ugyldig dynamikknivå')).length, 3);
  assert.equal(parsed.blocks.at(-1).segments[0].text, 'Etter');
});

test('missing and nested grid markers preserve subsequent lyrics and chorus boundaries', () => {
  const parsed = parseChordPro('{end_of_grid}\nFør\n{start_of_grid}\n| C . |\n{x_custom: behold}\n{start_of_grid}\n| G . |\n{soc}\nRefreng\n{eoc}\nEtter\n{sog}\n| D . |', 'T');
  assert.deepEqual(parsed.blocks.map(block => block.kind), ['line','grid','grid','chorus','line','grid']);
  assert.equal(parsed.blocks[1].rows[1].text, '{x_custom: behold}');
  assert.equal(parsed.blocks[3].content[0].segments[0].text, 'Refreng');
  assert.equal(parsed.blocks[4].segments[0].text, 'Etter');
  assert.equal(parsed.blocks.at(-1).rows[0].measures[0].cells[0], 'D');
});

test('one chart prefers personal content, falls back to shared grids, and never duplicates chorus references', async () => {
  const {selectSongGrid} = await import('../src/domain/song-grid.ts');
  const shared=parseChordPro('{soc}\n{start_of_grid}\n| C . |\n{end_of_grid}\n{eoc}\n{chorus}\n{start_of_grid}\n| G . |\n{end_of_grid}','T');
  const personal={songId:'stable-id',chorus:{}};
  assert.equal(selectSongGrid(shared,personal).grids.length,2);
  const selected=selectSongGrid(shared,{...personal,chordGrid:'| Dm . |'});
  assert.equal(selected.source,'personal'); assert.equal(selected.grids.length,1);
  assert.deepEqual(selected.grids[0].rows[0].measures[0].cells,['Dm','.']);
  assert.equal(selectSongGrid(shared,{...personal,chordGrid:'   '}).source,'shared');
  assert.equal(selectSongGrid(parseChordPro('Bare tekst','T'),personal),null);
  assert.equal(selectSongGrid(parseChordPro('{start_of_grid}\n\n{end_of_grid}','T'),personal),null);
  assert.equal(selectSongGrid(shared,{...personal,chordGrid:'{start_of_grid}\n{end_of_grid}'}).source,'shared');
});

test('time is derived from source, defaults to 4/4, and later changes remain at their position', () => {
  assert.equal(parseChordPro('Tekst','T').time,'4/4');
  const original='\uFEFF{time: 3 / 4}\r\nVals\r\n{time: 6/8}\r\nVidere';
  const song=createSong('takt.cho',new TextEncoder().encode(original)), parsed=parseChordPro(song.original,'T');
  assert.equal(song.original,original);assert.equal(parsed.time,'3/4');
  assert.deepEqual(parsed.blocks.map(block=>block.text ?? block.segments?.[0].text),['Vals','6/8','Videre']);
  assert.equal(parseChordPro('{time: 3+2/8}','T').time,'3+2/8');
  assert.equal(parseChordPro('{time: C|}','T').time,'C|');
  const invalid=parseChordPro('{time: feil}\nOrd','T');assert.equal(invalid.time,'4/4');assert.equal(invalid.blocks[0].kind,'unknown');
});
