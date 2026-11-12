import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceLines,sourceChords,setChord,moveChord,setMetadata,insertDirective,setDirective,sourceBlocks,setChorus,removeSourceBlock,transposeSong,patchSong,mergeRawSource} from '../src/domain/source-edit.ts';
import {createEditSession} from '../src/domain/edit-session.ts';
import {withOriginal} from '../src/domain/original.ts';
import {shiftGridText} from '../src/domain/personal.ts';
const song=original=>withOriginal({id:'stable',songbookId:'standard',title:'Fallback',key:null,origin:{kind:'local',filename:'song.cho',importedAt:'now'}},original);
const personal={songId:'stable',chorus:{},version:3};
test('source offsets preserve BOM, aliases, mixed endings and unknown directives around surgical edits',()=>{
 const source='\uFEFF{t: Før}\r\n{key: C}\r{x_future: behold}\n[C]Hei [G/B]deg\r\n';
 const initial=song(source),line=sourceLines(source)[3],token=sourceChords(line)[1];
 assert.equal(setChord(initial,3,4,'Dm',token.start).original,source.replace('[G/B]','[Dm]'));
 assert.equal(setMetadata(initial,'title','Ny').original,source.replace('Før','Ny'));
 assert.equal(setChord(initial,3,2,'Am').original,source.replace('Hei','He[Am]i'));
 assert.equal(setChord(initial,3,4,'',token.start).original,source.replace('[G/B]',''));
 assert.equal(patchSong(initial,[]).original,source);
 assert.equal(setMetadata(song('{title: A}\n{t: B}\nOrd'),'title','C').original,'{title: C}\n{t: C}\nOrd');
});
test('chorus boundaries are whole source lines; resizing/removing keeps words and unrelated source',()=>{
 const initial=song('Før\r\nEn\r\nTo\r\nEtter\r\n');
 const marked=setChorus(initial,1,2);assert.equal(marked.original,'Før\r\n{soc}\r\nEn\r\nTo\r\n{eoc}\r\nEtter\r\n');
 const block=sourceBlocks(marked.original,'chorus')[0];
 assert.equal(removeSourceBlock(marked,block).original,initial.original);
 const resized=setChorus(marked,2,2,block.start.index);assert.equal(resized.original,'Før\r\n{soc}\r\nEn\r\n{eoc}\r\nTo\r\nEtter\r\n');
 assert.equal(setChorus(song('En'),0,0).original,'{soc}\nEn\n{eoc}\n');
});
test('moving a chord preserves lyrics and exact unrelated bytes and creates one atomic history step',()=>{
 const source='\uFEFF{t: Flytt}\r\n[C]abcdef [G/B]ord\rNeste\n{x_future: behold}\r\n',initial=song(source),token=sourceChords(sourceLines(source)[1])[0];
 const same=moveChord(initial,token.start,1,3);assert.equal(same.song.original,source.replace('[C]abcdef','abc[C]def'));assert.equal(sourceChords(sourceLines(same.song.original)[1]).find(c=>c.start===same.start).offset,3);
 const session=createEditSession(initial,personal),next=moveChord(initial,token.start,2,2);session.replaceOriginal(next.song);assert.equal(session.song.original,source.replace('[C]','').replace('Neste','Ne[C]ste'));assert.equal(session.undo(),true);assert.equal(session.song.original,source);assert.equal(session.undo(),false);
 assert.equal(moveChord(initial,token.start,1,0).song.original,source);
 assert.throws(()=>moveChord(initial,token.start,0,0),/sangteksten/);
});
test('toneart transposes all inline and shared grids once; first key assignment does not move chords',()=>{
 const source='{title: T}\n{key: C}\n[C]Ord [G/B]mer\n{sog}\n| C G/B . N.C. |\n{eog}\n{soc}\n[F]Kor\n{eoc}\n{x_future: C}\n';
 const result=transposeSong(song(source),'D');assert.equal(result.interval,2);
 assert.equal(result.song.original,source.replace('{key: C}','{key: D}').replace('[C]','[D]').replace('[G/B]','[A/C#]').replace('| C G/B . N.C. |','| D A/C# . N.C. |').replace('[F]','[G]'));
 assert.equal(transposeSong(song('[C]Ord'),'D').song.original,'{key: D}\n[C]Ord');
});
test('confirmed source and personal changes share grouped undo across saved snapshots and view changes',()=>{
 const initial=song('{title: T}\n{key: C}\n[C]Ord'),session=createEditSession(initial,personal);
 session.beginGroup();session.replaceOriginal(setMetadata(session.song,'title','A'));const first=session.snapshot();session.markSaved(first);session.replaceOriginal(setMetadata(session.song,'title','AB'));session.endGroup();
 session.update(s=>({...s,capo:2}));session.markSaved(session.snapshot());
 assert.equal(session.undo(),true);assert.equal(session.personal.capo,undefined);assert.equal(session.song.title,'AB');
 assert.equal(session.undo(),true);assert.equal(session.song.original,initial.original);assert.equal(session.dirty(),true);
 session.redo();assert.equal(session.song.title,'AB');session.redo();assert.equal(session.personal.capo,2);
 session.undo();session.update(s=>({...s,tuning:'DADGAD'}));assert.equal(session.canRedo(),false);
});
test('transposition undo restores annotations and personal grid atomically, cancelled raw group cannot redo',()=>{
 const initial=song('{title: T}\n{key: C}\n[C]Ord'),session=createEditSession(initial,{...personal,chordGrid:'{sog}\n| C |\n{eog}'});
 const next=transposeSong(initial,'D');session.replaceOriginal(next.song,s=>({...s,chordGrid:shiftGridText(s.chordGrid,next.interval)}));
 assert.match(session.personal.chordGrid,/\| D \|/);session.undo();assert.equal(session.song.original,initial.original);assert.match(session.personal.chordGrid,/\| C \|/);
 session.beginGroup();session.replaceOriginal(withOriginal(session.song,'{title: Forkast}\nOrd'));session.cancelGroup();assert.equal(session.song.original,initial.original);session.redo();assert.equal(session.song.key,'D');
});
test('reference folding follows source insertions and remains a view choice through undo',()=>{
 const initial=song('{title: T}\n{soc}\nOrd\n{eoc}\n{chorus}\n'),session=createEditSession(initial,{...personal,chorus:{'line:4':true}});
 session.replaceOriginal(insertDirective(initial,1,'{comment: Inn}'));assert.deepEqual(session.personal.chorus,{'line:5':true});
 session.updateView({'line:5':false});session.undo();assert.deepEqual(session.personal.chorus,{'line:4':false});
});

test('raw field normalization preserves all unchanged original line endings and no-op bytes',()=>{
 const original='\uFEFF{t: Før}\r\n{key: C}\rOrd\nSlutt\r\n';
 assert.equal(mergeRawSource(original,original.replace(/\r\n|\r/g,'\n')),original);
 assert.equal(mergeRawSource(original,original.replace(/\r\n|\r/g,'\n').replace('Før','Etter')),original.replace('Før','Etter'));
});
test('line insertion can add one compact pause without duplicating existing blank lines or changing endings',()=>{
 const source='\uFEFF{t: Luft}\r\nOrd',initial=song(source);
 assert.equal(insertDirective(initial,2,'{chorus}',true).original,source+'\r\n\r\n{chorus}\r\n');
 const paused=source+'\r\n\r\n';assert.equal(insertDirective(song(paused),3,'{comment: Slutt}',true).original,paused+'{comment: Slutt}\r\n');
 assert.equal(insertDirective(song('Før\n\nEtter'),2,'{chorus}',true).original,'Før\n\n{chorus}\nEtter');
 assert.equal(setChord(initial,2,0,'C',undefined,true).original,source+'\r\n\r\n[C]\r\n');
});
