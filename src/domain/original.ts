import {parseChordPro} from './chordpro.ts';
import type {Song} from './song.ts';
import {standardSongbook} from './songbook.ts';
export const validTime=(value:string)=>!value||/^(?:[1-9]\d*(?:\s*\+\s*[1-9]\d*)*\s*\/\s*[1-9]\d*|C\|?)$/.test(value);
export function withOriginal(song: Song, original: string): Song {
  const parsed = parseChordPro(original,song.title);
  return {...song,original,title:parsed.title,key:parsed.key};
}
export function newSong(): Song {
  return {id:crypto.randomUUID(),songbookId:standardSongbook.id,original:'',title:'',key:null,origin:{kind:'local',filename:'',importedAt:new Date().toISOString()}};
}
