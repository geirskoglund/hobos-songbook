import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withOriginal,newSong,validTime} from '../src/domain/original.ts';
import {setMetadata,patchSong} from '../src/domain/source-edit.ts';
const song=original=>withOriginal({...newSong(),title:'Filnavn'},original);
test('unchanged raw source preserves exact BOM, aliases, unknown directives and all line endings',()=>{
 for(const source of ['Ord','\uFEFFOrd\r\n\r\n','{t: Tittel}\r{key: D}\rTekst\r','\uFEFF {title: Tittel} \r\n{time: 6/8}\nTekst\rSiste','{title: Først}\n{t: Sist}\nOrd','{key: D}\n[D]Ord\n{x_future: behold}'])assert.equal(patchSong(song(source),[]).original,source);
});
test('metadata surgery leaves untouched whitespace and mixed source endings intact',()=>{
 const source='\uFEFF {t: Gammel} \r\n{key: Db}\r{time: 6/8}\nFørst\r\nSist\r';
 assert.equal(setMetadata(setMetadata(song(source),'title','Ny'),'time','3/4').original,source.replace('Gammel','Ny').replace('6/8','3/4'));
 assert.equal(setMetadata(song(source),'time','').original,source.replace('{time: 6/8}\n',''));
});
test('new songs have distinct stable provisional IDs and only deliberately supplied metadata',()=>{
 const a=newSong(),b=newSong();assert.notEqual(a.id,b.id);assert.equal(a.original,'');assert.equal(a.songbookId,'standard');
 assert.equal(setMetadata(a,'title','Ny sang').original,'{title: Ny sang}\n');assert.equal(setMetadata(song('Ord\r\n'),'key','D').original,'{key: D}\r\nOrd\r\n');
 assert.throws(()=>setMetadata(a,'title','   '),/tittel/);
});
test('raw edits accept structures while validation distinguishes supported time signatures',()=>{
 const before=song('{soc}\nOrd\n{eoc}\n{chorus}');assert.equal(withOriginal(before,'{soc}\nNye ord\n{eoc}').id,before.id);
 for(const value of ['','4/4','3/4','6/8','3+2/8','C','C|'])assert.equal(validTime(value),true);
 for(const value of ['0/4','4/0','banan'])assert.equal(validTime(value),false);
});
