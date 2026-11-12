import {test} from 'node:test';
import assert from 'node:assert/strict';
import {anchorFor, changeAnnotation, changeNote, cleanPersonal, logicalLines, notePlacements, reconcilePersonal} from '../src/domain/annotations.ts';
import {personalChanges} from '../src/domain/personal.ts';
import {createEditSession} from '../src/domain/edit-session.ts';
const song = original => ({id:'one',title:'T',key:null,original,origin:{kind:'local',filename:'test.cho',importedAt:'now'}});
const empty = () => ({songId:'one',chorus:{},version:3});
const mark = (source, index, start, end, state=empty()) => {
  const line=logicalLines(source)[index];return changeAnnotation(state,anchorFor(source,line.sourceLine,line.occurrence),{highlights:[{start,end,groupId:'group'}]});
};
const marks = state => Object.values(state.annotations??{}).flatMap(item=>item.highlights.map(range=>({...range,line:item.anchor.sourceLine})));

test('notes remain positional through text changes, deletion and empty content; missing positions queue without loss',()=>{
  const before=song('{t: T}\nFørste\nAndre\nTredje'), after=song('{t: Ny}\nNy tekst');
  let personal=empty();for(const [id,line] of [['a',0],['b',1],['c',2],['d',2]])personal=changeNote(personal,id,{line,text:id});
  const updated=reconcilePersonal(before,after,personal);assert.deepEqual(updated.notes,personal.notes);
  assert.deepEqual(notePlacements(updated,[0]).map(({id,line})=>({id,line})),[{id:'a',line:0},{id:'b',line:undefined},{id:'c',line:undefined},{id:'d',line:undefined}]);
  assert.deepEqual(notePlacements(reconcilePersonal(after,song(''),updated),[]).map(p=>p.id),['a','b','c','d']);
  assert.equal(JSON.stringify(updated).includes('Første'),false);
});

test('explicit lines are independent of metadata, chords and screen wrapping and distinguish refrain occurrences',()=>{
  const source=song('{t: T}\n{key: D}\n{soc}\n[D]Hei der\n{eoc}\n{chorus}\n{chorus}');
  const lines=logicalLines(source);assert.equal(lines.length,3);assert.equal(new Set(lines.map(line=>line.occurrence)).size,3);
  assert.deepEqual(lines.map(line=>line.text),['Hei der','Hei der','Hei der']);
});

test('highlight coordinates follow safe line/character edits and metadata updates without source snapshots',()=>{
  const before=song('{t: T}\nEn vanlig linje\nSyng høyt\nSiste');
  let state=mark(before,0,3,9);state=mark(before,1,5,9,state);
  const after=song('{title: Ny}\n{time: 6/8}\nEn helt vanlig linje\nSyng høyt\nSiste');
  const updated=reconcilePersonal(before,after,state);
  assert.deepEqual(marks(updated),[{start:8,end:14,groupId:'group',line:2},{start:5,end:9,groupId:'group',line:3}]);
  assert.equal(JSON.stringify(updated).includes('vanlig'),false);
  const inserted=song('{t: T}\nEkstra\nEn vanlig linje\nSyng høyt\nSiste');
  assert.deepEqual(marks(reconcilePersonal(before,inserted,state)).map(m=>m.line),[2,3]);
});

test('changed highlighted words, removed lines and ambiguous repeated lines never highlight unrelated text',()=>{
  const before=song('Ord som skal synges\nBehold');
  const state=mark(before,0,4,7);
  assert.deepEqual(marks(reconcilePersonal(before,song('Ord helt andre ord\nBehold'),state)),[]);
  assert.deepEqual(marks(reconcilePersonal(before,song('Behold'),state)),[]);
  const repeated=song('Lik\nLik\nSlutt');
  assert.deepEqual(marks(reconcilePersonal(repeated,song('Lik\nSlutt'),mark(repeated,1,0,3))),[]);
});

test('old annotations are discarded, unrelated fields survive, and new records cannot carry snapshots or empty annotations',()=>{
  const legacy={songId:'one',version:2,chorus:{r:true},capo:2,tuning:'Drop D',chordGrid:'| D |',annotations:{old:{anchor:{original:'OLD SOURCE'},note:'old',highlights:[{start:0,end:3}]}}};
  const cleaned=cleanPersonal(legacy);assert.deepEqual(cleaned,{songId:'one',version:3,chorus:{r:true},capo:2,tuning:'Drop D',chordGrid:'| D |'});
  const source=song('Tekst'), anchor=anchorFor(source,0,'source/line:0');
  let state=mark(source,0,0,3);state=changeAnnotation(state,anchor,{highlights:[]});assert.equal(state.annotations,undefined);
  state=changeNote(state,'new',{line:0,text:'Notat'});state=changeNote(state,'new',undefined);assert.equal(state.notes,undefined);
  const contaminated={...mark(source,0,0,3),notes:{blank:{line:0,text:''}}};contaminated.annotations['source/line:0'].anchor.original='UNWANTED';
  assert.equal(JSON.stringify(cleanPersonal(contaminated)).includes('UNWANTED'),false);assert.equal(cleanPersonal(contaminated).notes,undefined);
});

test('one session owns confirmed changes and retains further edits when an earlier snapshot finishes saving',()=>{
  const source=song('En linje'), session=createEditSession(source,empty());
  let calls=0;session.update(current=>{calls++;return changeNote(current,'n',{line:0,text:'Første'});});assert.equal(calls,1);
  const submitted=session.snapshot();session.update(current=>changeNote(current,'n',{line:0,text:'Videre'}));session.markSaved(submitted);
  assert.equal(session.personal.notes.n.text,'Videre');assert.equal(session.dirty(),true);
  session.update(current=>changeNote(current,'n',{line:0,text:'Første'}));assert.equal(session.dirty(),false);
});

test('projected baseline preserves other tabs while saving original edits and a newly added note',()=>{
  const before=song('{t: T}\nOrd'), after=song('{t: Ny}\n{time: 3/4}\nOrd');
  const initial=mark(before,0,0,3), session=createEditSession(before,initial);
  session.replaceOriginal(after);session.update(current=>changeNote(current,'mine',{line:0,text:'Mitt'}));
  const latest=changeNote({...initial,tuning:'Annen fane'},'theirs',{line:0,text:'Deres'});
  const saved=session.pendingChange()(reconcilePersonal(before,after,latest));
  assert.equal(saved.notes.mine.text,'Mitt');assert.equal(saved.notes.theirs.text,'Deres');assert.equal(saved.tuning,'Annen fane');
  assert.deepEqual(marks(saved).map(m=>m.line),[2]);
  assert.equal(personalChanges(reconcilePersonal(before,after,initial),session.personal)(saved).notes.theirs.text,'Deres');
});

test('an old tab cannot erase new positional notes merely by writing the older personal version again',()=>{
  const current=changeNote(empty(),'new-note',{line:3,text:'Behold ny modell'});
  const fromOldTab={...current,version:2,annotations:{'source/line:0':{anchor:{songId:'one',sourceLine:0,occurrence:'source/line:0',original:'gammel kilde'},note:'gammelt',highlights:[]}}};
  const cleaned=cleanPersonal(fromOldTab);assert.equal(cleaned.notes['new-note'].text,'Behold ny modell');assert.equal(cleaned.annotations,undefined);assert.equal(cleaned.version,3);
});
test('invalid new note targets are rejected; existing note text with a damaged position is retained safely',()=>{
 const current=changeNote(empty(),'keep',{line:0,text:'Behold'});
 for(const line of [NaN,undefined,-1,Infinity,1.5])assert.throws(()=>changeNote(current,'keep',{line,text:'Flytt'}),/tekstlinje/);
 assert.equal(current.notes.keep.text,'Behold');
 const cleaned=cleanPersonal({...current,notes:{keep:{line:NaN,text:'Behold'}}});assert.equal(cleaned.notes.keep.text,'Behold');assert.equal(Number.isSafeInteger(cleaned.notes.keep.line),true);
});
