import {test} from 'node:test';
import assert from 'node:assert/strict';
import {songbookName, suggestedSongbook} from '../src/domain/songbook.ts';
import {createSong} from '../src/domain/song.ts';
import {newSong} from '../src/domain/original.ts';

test('songbook names preserve Norwegian and allowed punctuation, normalize and reject unsafe or duplicate names', () => {
  const books = [{id:'band',name:'Blåbær & venner'}];
  assert.equal(songbookName('  Ærlig (2026) + #1!  ', books), 'Ærlig (2026) + #1!');
  assert.equal(songbookName('BLA\u030ABÆR & VENNER', books, 'band'), 'BLÅBÆR & VENNER');
  assert.throws(() => songbookName(' blÅbær & VENNER ', books), /allerede/);
  for (const value of ['', ' ', 'Siste.', ...'/\\<>:"|?*'.split('').map(c => `Navn${c}her`),
    ...['CON','PRN','AUX','NUL',...Array.from({length:9}, (_, i) => `COM${i+1}`),...Array.from({length:9}, (_, i) => `LPT${i+1}`)].flatMap(name => [name,name.toLowerCase()+'.txt'])]) {
    assert.throws(() => songbookName(value, books), undefined, value);
  }
  for (const value of ['CONsert','COM10','LPT0','Nulle','a'.repeat(400)]) assert.equal(songbookName(value, books),value);
});
test('target suggestion is session scoped, validates IDs, and never offers Alle as a book', () => {
  const books = [{id:'a',name:'A'}, {id:'b',name:'B'}];
  assert.equal(suggestedSongbook(books,null,null),null);
  assert.equal(suggestedSongbook(books,null,'b'),'b');
  assert.equal(suggestedSongbook(books,'a','b'),'a');
  assert.equal(suggestedSongbook(books,'deleted','b'),'b');
  assert.equal(suggestedSongbook(books,'deleted','deleted'),null);
  assert.equal(suggestedSongbook([books[1]],'a',null),'b');
  assert.equal(suggestedSongbook([],null,null),null);
});
test('new and imported songs use the explicitly chosen identity even when Standard no longer exists', () => {
  assert.equal(newSong('renamed-book').songbookId,'renamed-book');
  const song = createSong('kilde.txt',new TextEncoder().encode('\uFEFF{t: Sang}\r\nOrd\r\n'),'chosen');
  assert.equal(song.songbookId,'chosen'); assert.equal(song.original,'\uFEFF{t: Sang}\r\nOrd\r\n');
});
