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
