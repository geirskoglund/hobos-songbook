import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shiftChord, shiftGridText, transposeChord, gripKey, transposeGrid, validCapo, validGrid, anchorFor, sharedGridText, changeAnnotation} from '../src/domain/personal.ts';
import {parseChordPro} from '../src/domain/chordpro.ts';

test('capo transforms roots and slash bass without rewriting suffixes or unknown tokens', () => {
  for (const [chord, capo, expected] of [['D',2,'C'],['D/F#',2,'C/E'],['Bm7',2,'Am7'],['G',7,'C'],['Dm',2,'Cm'],['Bbmaj7/D',2,'Abmaj7/C'],['H',2,'A'],['B',2,'A'],['C♯m7/G♯',2,'Bm7/F#'],['N.C.',2,'N.C.'],['Solo',2,'Solo'],['D',0,'D']]) assert.equal(transposeChord(chord,capo),expected);
  for (const capo of [-1,13,1.5,NaN]) {assert.equal(validCapo(capo),false); assert.equal(transposeChord('D',capo),'D');}
  assert.equal(gripKey(null,2),null); assert.equal(gripKey('ukjent',2),null); assert.equal(gripKey('D',2),'C'); assert.equal(gripKey('G',7),'C');
});
test('same grid transformation preserves bars, repeats, form, labels and original', () => {
  const original='{sog: shape="2x4" label="Intro"}\n|: D~D/F# . | Bm7 % :|\n{eog}';
  const grid=parseChordPro(original,'').blocks[0], before=structuredClone(grid), transformed=transposeGrid(grid,2);
  assert.deepEqual(grid,before); assert.equal(transformed.options.label,'Intro');
  assert.deepEqual(transformed.rows[0].measures.map(m=>m.cells),[['C~C/E','.'],['Am7','%']]);
  assert.equal(transformed.rows[0].measures[1].closing,':|');
  assert.equal(sharedGridText(original),original);
  assert.equal(validGrid(original),true); assert.equal(validGrid('| D . |'),true);
  for (const invalid of ['', '   ', 'ikke et skjema', '{sog}\n{eog}', '{sog}\n| D |\n{eog}\nEkstra sangtekst']) assert.equal(validGrid(invalid),false);
});
test('anchors distinguish duplicate lines and chorus references and preserve source for later reanchoring', () => {
  const song={id:'song-one',original:'\uFEFF{soc}\r\n[D]Ærlig øvelse å synge\r\n{eoc}\r\n{chorus}\r\n{chorus}',title:'T'};
  const parsed=parseChordPro(song.original,'T'), first=parsed.blocks[0].content[0];
  assert.equal(first.sourceLine,1);
  const anchors=['source/line:1','line:3/line:1','line:4/line:1'].map(id=>anchorFor(song,1,id,'Ærlig øvelse å synge'));
  assert.equal(new Set(anchors.map(a=>a.occurrence)).size,3);
  for(const anchor of anchors) {assert.equal(anchor.original,song.original); assert.equal(anchor.before,'{soc}'); assert.equal(anchor.after,'{eoc}'); assert.equal(anchor.songId,song.id);}
});

test('independent annotation edits from stale tabs preserve the other field and all unrelated personal state', () => {
  const song={id:'stable-id', original:'Samme tekst', title:'T'};
  const anchor=anchorFor(song,0,'source/line:0','Samme tekst');
  const initial={songId:song.id, chorus:{'line:3':true}, capo:2, tuning:'Drop D', chordGrid:'| D |'};
  const noteSaved=changeAnnotation(initial,anchor,{note:'Ny instruks fra første fane'});
  const highlighted=changeAnnotation(noteSaved,anchor,{highlights:[{start:0,end:5}]});
  assert.equal(highlighted.annotations[anchor.occurrence].note,'Ny instruks fra første fane');
  const noteEdited=changeAnnotation(highlighted,anchor,{note:'Nyere instruks'});
  assert.deepEqual(noteEdited.annotations[anchor.occurrence].highlights,[{start:0,end:5}]);
  assert.deepEqual(noteEdited.chorus,initial.chorus); assert.equal(noteEdited.capo,2); assert.equal(noteEdited.chordGrid,initial.chordGrid);
  assert.equal(noteSaved.annotations[anchor.occurrence].highlights.length,0);
});


test('grid input capo and display are reversible and preserve directives, labels and margins', () => {
  const typed = '{sog: shape="2x4" label="C D"}\nIntro C |: C . C/E . | Am7~G % :| C outro\n{eog}';
  const stored = shiftGridText(typed, 2);
  assert.equal(stored, '{sog: shape="2x4" label="C D"}\nIntro C |: D . D/F# . | Bm7~A % :| C outro\n{eog}');
  assert.equal(shiftGridText(stored, -2),typed);
  assert.equal(shiftChord('C',7),'G');
  assert.equal(shiftChord('G',-7),'C');
  assert.equal(shiftChord('N.C.',7),'N.C.');
});

test('draft differences ignore reverted defaults and preserve unedited fields from newer storage', async () => {
  const {personalChanges} = await import('../src/domain/personal.ts');
  const initial={songId:'id',chorus:{}};
  const song={id:'id',original:'Ord'}, anchor=anchorFor(song,0,'source/line:0','Ord');
  assert.equal(personalChanges(initial,{...initial,capo:0,tuning:'',annotations:{[anchor.occurrence]:{anchor,note:'',highlights:[]}}}),undefined);
  const after=changeAnnotation({...initial,capo:2},anchor,{highlights:[{start:0,end:2}]});
  const update=personalChanges(initial,after);
  const latest=changeAnnotation({...initial,chorus:{'line:8':true},tuning:'Drop D'},anchor,{note:'Fra en annen fane'});
  const saved=update(latest);
  assert.equal(saved.capo,2);assert.equal(saved.tuning,'Drop D');assert.equal(saved.annotations[anchor.occurrence].note,'Fra en annen fane');
  assert.deepEqual(saved.chorus,{'line:8':true});assert.deepEqual(saved.annotations[anchor.occurrence].highlights,[{start:0,end:2}]);
});
