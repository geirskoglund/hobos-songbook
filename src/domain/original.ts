import {parseChordPro} from './chordpro.ts';
import type {Song} from './song.ts';
export function withOriginal(song: Song, original: string): Song {
  const parsed = parseChordPro(original,song.title);
  return {...song,original,title:parsed.title,key:parsed.key};
}
export function newSong(songbookId: string): Song {
  return {id:crypto.randomUUID(),songbookId,original:'{t: }\n',title:'',key:null,origin:{kind:'local',filename:'',importedAt:new Date().toISOString()}};
}
