import {test} from 'node:test';
import assert from 'node:assert/strict';
import {originalDocument, originalChangeError, withOriginal, newSong} from '../src/domain/original.ts';
const song = original => ({id:'stable',original,title:'Filnavn',key:null,origin:{kind:'local',filename:'Filnavn.txt',importedAt:'dato'}});
test('no-op preserves exact source, fallback, BOM, aliases and every line ending',()=>{
  for (const source of ['Ord','\uFEFFOrd\r\n\r\n','{t: Tittel}\r{key: D}\rTekst\r','\uFEFF {title: Tittel} \r\n{time: 6/8}\nTekst\rSiste','{title: Først}\n{t: Sist}\nOrd','{key: D}\n[D]Ord\n{x_future: behold}']) {
    const model=originalDocument(song(source));assert.equal(model.apply(model.fields),source);
  }
});
test('surgical edits preserve untouched spelling, whitespace and mixed endings',()=>{
  const source='\uFEFF {t: Gammel} \r\n{key: Db}\r{time: 6/8}\nFørst\r\nSist\r';
  const model=originalDocument(song(source));
  assert.equal(model.apply({...model.fields,title:'Ny',time:'3/4',text:'Først\nEndret\n'}),'\uFEFF {t: Ny} \r\n{key: Db}\r{time: 3/4}\nFørst\r\nEndret\r');
  assert.equal(model.apply({...model.fields,time:''}),'\uFEFF {t: Gammel} \r\n{key: Db}\rFørst\r\nSist\r');
});
test('new and fallback songs only gain deliberately edited metadata',()=>{
  const fresh=newSong(), other=newSong();assert.notEqual(fresh.id,other.id);assert.equal(fresh.original,'');
  const model=originalDocument(fresh);assert.equal(model.fields.title,'');
  const source=model.apply({...model.fields,title:'Ny sang'});assert.equal(source,'{title: Ny sang}\n');
  const plain=originalDocument(song('Ord\r\n'));assert.equal(plain.apply({...plain.fields,text:'Nye ord\n'}),'Nye ord\r\n');
  assert.equal(plain.apply({...plain.fields,key:'D'}),'{key: D}\r\nOrd\r\n');
  assert.throws(()=>model.apply({...model.fields,title:'   '}),/tittel/);
});
test('structures remain protected and first key never transposes chords',()=>{
  for(const source of ['[D]Ord','{comment: Rolig}\nOrd','{soc}\nOrd\n{eoc}\n{chorus}','{sog}\n| D |\n{eog}','{x_dyn: 2}\nOrd','{unknown: behold}\nOrd','Ord\n{title: Midt i}']) {
    const model=originalDocument(song(source));assert.equal(model.bodyProtected,true);assert.throws(()=>model.apply({...model.fields,text:'Erstatt'}),/låst/);assert.equal(model.apply(model.fields),source);
  }
  const model=originalDocument(song('[Db]Ord'));assert.equal(model.apply({...model.fields,key:'Db'}),'{key: Db}\n[Db]Ord');
  const keyed=originalDocument(song('{key: Db}\n[Db]Ord'));assert.throws(()=>keyed.apply({...keyed.fields,key:'D'}),/transponering/);
  const plain=originalDocument(song('Ord'));for(const text of ['{soc}','[D]Akkord'])assert.throws(()=>plain.apply({...plain.fields,text}),/koder/);
});
test('ambiguous metadata, annotation anchors and chorus occurrence identity are not silently rewritten',()=>{
  const model=originalDocument(song('{title: A}\n{t: B}\nOrd'));assert.throws(()=>model.apply({...model.fields,title:'C'}),/flere direktiver/);
  const before=song('Ord'),after=withOriginal(before,'{title: Ny}\nOrd'),personal={songId:'stable',chorus:{}};
  assert.equal(originalChangeError(before,after,personal),undefined);
  assert.equal(originalChangeError(before,after,{...personal,notes:{one:{line:0,text:'Husk'}}}),undefined);
  assert.match(originalChangeError(before,after,{...personal,chorus:{'line:2':true}}),/refreng/);
  assert.equal(originalChangeError(before,before,{...personal,annotations:{line:{note:'Husk',highlights:[]}}}),undefined);
});
