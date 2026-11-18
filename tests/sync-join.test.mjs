import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,song} from './sync-fixture.mjs';
import {emptyJournal,newSyncState} from '../src/sync/model.ts';

const original='{t: Samme tittel}\n[C]Tekst';
const imported=(id,book,filename='sang.cho',text=original)=>({...song(id,book,text),origin:{kind:'local',filename,importedAt:id==='remote-song'?'2026-01-01':'2026-11-16'}});
const personal=(id,capo=2)=>({songId:id,version:3,chorus:{},capo,annotations:{'source/line:1':{anchor:{songId:id,sourceLine:1,occurrence:'source/line:1'},highlights:[{start:0,end:3}]}}});
async function joinedFixture({localCount=1,remoteCount=1,localFilename='sang.cho',localText=original,localCapo=2}={}){
 const f=fixture();f.change(d=>{d.songbooks=[{id:'remote-book',name:'Hobos'},{id:'standard',name:'Standard'}];d.songs=Array.from({length:remoteCount},(_,i)=>imported(i?'remote-'+i:'remote-song','remote-book'));d.personal=d.songs.map(s=>personal(s.id));});await f.run();
 const remote=structuredClone(f.data);
 f.data={songs:Array.from({length:localCount},(_,i)=>imported(i?'local-'+i:'local-song','local-book',localFilename,localText)),songbooks:[{id:'local-book',name:'Hobos'},{id:'sapiens',name:'Hobo Sapiens'},{id:'general',name:'Generell'}],personal:Array.from({length:localCount},(_,i)=>personal(i?'local-'+i:'local-song',localCapo)),journal:emptyJournal(),state:newSyncState('account')};
 return{f,remote};
}
test('first coordination joins independently created books/songs without changing local IDs or annotation anchors',async()=>{
 const{f,remote}=await joinedFixture();await f.run();
 assert.equal(f.data.state.pending,false);assert.equal(f.data.songbooks.find(b=>b.name==='Hobos').id,'local-book');assert.equal(f.data.songbooks.filter(b=>b.name==='Hobos').length,1);assert.deepEqual(f.data.songs.map(s=>[s.id,s.songbookId]),[['local-song','local-book']]);assert.equal(f.data.personal[0].annotations['source/line:1'].anchor.songId,'local-song');
 const cloud=JSON.parse(f.entries.get('/.app/library.json').text);assert.deepEqual(Object.keys(cloud.songs),['remote-song']);assert.equal(cloud.books['local-book'],undefined);assert.ok(f.entries.has('/songbooks/hobo sapiens'));assert.ok(f.entries.has('/songbooks/generell'));assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,1);assert.equal(f.data.state.conflicts.length,0);
 const before=f.calls.length;await f.run();assert.deepEqual(f.calls.slice(before),[['changes']]);
 f.change(d=>d.personal[0].capo=5);await f.run(false);assert.equal(JSON.parse(f.entries.get('/.app/songs/remote-song.json').text).data.capo,5);assert.equal(f.data.songs[0].id,'local-song');
 const second=structuredClone(f.data);f.data=remote;await f.run();assert.equal(f.data.songs[0].id,'remote-song');assert.equal(f.data.personal[0].capo,5);f.data=second;await f.run();assert.equal(f.data.songs[0].id,'local-song');assert.equal(f.data.songs.length,1);
});
test('different content and personal layers use both existing conflict choices; postponement/restart does not make duplicates',async()=>{
 const{f}=await joinedFixture({localText:'{t: Lokal}\nNy tekst',localCapo:7});const before=f.entries.get('/.app/songs/remote-song.json').text;await f.run();assert.equal(f.data.state.conflicts.length,2);assert.equal(f.entries.get('/.app/songs/remote-song.json').text,before);assert.equal(f.data.songs[0].id,'local-song');
 await f.run();assert.equal(f.data.state.conflicts.length,2);assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,1);
 await f.run(true,{conflict:f.data.state.conflicts.find(c=>c.kind==='content'),choice:'local'});assert.equal(f.data.state.conflicts.length,1);
 await f.run(true,{conflict:f.data.state.conflicts[0],choice:'dropbox'});assert.equal(f.data.state.conflicts.length,0);assert.equal(f.data.state.pending,false);assert.equal(f.data.songs[0].original,'{t: Lokal}\nNy tekst');assert.equal(f.data.personal[0].capo,2);assert.equal(f.data.personal[0].songId,'local-song');
});
test('first-coordination copy choice creates exactly one additional song and does not rejoin the chosen copy',async()=>{
 const{f}=await joinedFixture({localText:'{t: Lokal}\nNy tekst'});await f.run();await f.run(true,{conflict:f.data.state.conflicts[0],choice:'copy'});await f.run();await f.run();assert.equal(f.data.state.pending,false);assert.equal(f.data.songs.length,2);assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,2);assert.equal(f.data.songs.find(s=>s.id==='local-song').original,original);assert.equal(f.data.songs.find(s=>s.id!=='local-song').original,'{t: Lokal}\nNy tekst');
});
for(const counts of [[2,1],[1,2],[2,2]])test(`ambiguous filename candidates ${counts} remain separate`,async()=>{
 const{f}=await joinedFixture({localCount:counts[0],remoteCount:counts[1]});await f.run();assert.equal(f.data.state.pending,false);assert.equal(f.data.songs.length,counts[0]+counts[1]);assert.equal(Object.keys(f.data.state.bindings?.songs??{}).length,0);assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,counts[0]+counts[1]);
});
test('same title in a different filename never establishes identity',async()=>{
 const{f}=await joinedFixture({localFilename:'annen.cho'});await f.run();assert.equal(f.data.songs.length,2);assert.equal(Object.keys(f.data.state.bindings?.songs??{}).length,0);
});
test('a later import after completed coordination remains a separate song despite the same filename',async()=>{
 const{f}=await joinedFixture();await f.run();f.change(d=>{d.songs.push(imported('later','local-book'));d.personal.push(personal('later'));});await f.run(false);assert.equal(Object.keys(JSON.parse(f.entries.get('/.app/library.json').text).songs).length,2);assert.equal(f.data.songs.length,2);
});
test('independently renamed Standard books retain both local identity and distinct cloud books',async()=>{
 const f=fixture();await f.run();f.data={songs:[imported('local-song','standard')],songbooks:[{id:'standard',name:'Generell'}],personal:[],journal:emptyJournal(),state:newSyncState('account')};await f.run();assert.equal(f.data.state.pending,false);assert.equal(f.data.songbooks.find(b=>b.name==='Generell').id,'standard');assert.notEqual(f.data.songbooks.find(b=>b.name==='Standard').id,'standard');assert.equal(f.data.songs.find(s=>s.id==='local-song').songbookId,'standard');assert.ok(f.entries.has('/songbooks/generell'));assert.ok(f.entries.has('/songbooks/standard'));await f.run();assert.equal(f.data.songbooks.length,2);
});
test('mapped book rename/deletion follows the common identity without resurrecting old local IDs',async()=>{
 const{f}=await joinedFixture();await f.run();f.change(d=>d.songbooks.find(b=>b.id==='local-book').name='Nytt navn');await f.run(false);assert.ok(f.entries.has('/songbooks/nytt navn'));const cloud=JSON.parse(f.entries.get('/.app/library.json').text);assert.equal(cloud.books['remote-book'].name,'Nytt navn');assert.equal(cloud.books['local-book'],undefined);const path=cloud.songs['remote-song'].path;f.entries.delete(path.toLowerCase());await f.run();assert.equal(f.data.songs.length,0);assert.equal(f.data.personal.length,0);await f.run();assert.equal(f.entries.has(path.toLowerCase()),false);
});
test('a new empty installation does not create another Standard after the original default was renamed',async()=>{
 const f=fixture();f.change(d=>d.songbooks[0].name='Hobos');await f.run();f.data={songs:[],songbooks:[{id:'standard',name:'Standard'}],personal:[],journal:emptyJournal(),state:newSyncState('account')};await f.run();assert.deepEqual(f.data.songbooks,[{id:'standard',name:'Hobos'}]);assert.equal(f.entries.has('/songbooks/standard'),false);
});
test('bindings survive an interrupted first content download and resume the same identities',async()=>{
 const{f}=await joinedFixture();const read=f.files.read;let once=true;f.files.read=async(...args)=>{if(once&&!args[0].startsWith('/.app/')){once=false;throw Error('interrupted content');}return read(...args);};await f.run();assert.equal(f.data.state.pending,true);assert.equal(f.data.songs[0].id,'local-song');assert.equal(f.data.state.bindings.songs['local-song'],'remote-song');f.files.read=read;await f.run();assert.equal(f.data.state.pending,false);assert.equal(f.data.songs.length,1);assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,1);
});
test('a matching file discovered during first coordination uses existing conflicts instead of creating a duplicate',async()=>{
 const{f}=await joinedFixture({localFilename:'bare.cho',localText:'{t: Lokal}\nAnnen tekst'});const manifest=f.entries.get('/.app/library.json'),value=JSON.parse(manifest.text),link=value.songs['remote-song'];delete value.songs['remote-song'];await f.files.move(link.fileId,'/Songbooks/Hobos/Private/bare.cho');await f.files.write(manifest.path,JSON.stringify(value),manifest.rev);f.entries.delete('/.app/songs/remote-song.json');await f.run();assert.equal(f.data.state.conflicts.length,2);assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,1);await f.run(true,{conflict:f.data.state.conflicts.find(c=>c.kind==='content'),choice:'local'});await f.run(true,{conflict:f.data.state.conflicts[0],choice:'local'});assert.equal(f.data.state.pending,false);assert.equal(f.data.songs.length,1);assert.equal(f.data.songs[0].id,'local-song');assert.equal([...f.entries.values()].filter(e=>e.path.endsWith('.cho')).length,1);
});
