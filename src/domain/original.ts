import {parseChordPro, parseLine} from './chordpro.ts';
import type {Song, SongPersonal} from './song.ts';

export const validTime = (value: string) => !value || /^(?:[1-9]\d*(?:\s*\+\s*[1-9]\d*)*\s*\/\s*[1-9]\d*|C\|?)$/.test(value);
export interface OriginalFields {title: string; key: string; time: string; text: string}
const protectedText = 'Sangteksten er foreløpig låst fordi den inneholder akkorder eller andre markører.';
/** Source spans, never the derived parser/DOM, are the editing authority. */
export function originalDocument(song: Song) {
  const source = song.original, bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const lines = [...source.slice(bom.length).matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)].filter(match => match[0]);
  const ending = source.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const metadata: {field: 'title' | 'key' | 'time'; start: number; end: number; lineStart:number; lineEnd:number; value: string}[] = [];
  let bodyStart = bom.length, prefix = true, unsafeBody = false;
  for (const line of lines) {
    const match = line[1].match(/^(\s*\{(?:title|t|key|time)(?:\s*:\s*|\s+))(.*?)(\s*\}\s*)$/i);
    if (match) {
      const name = match[1].match(/\{(\w+)/)![1].toLowerCase();
      const field = name === 't' ? 'title' : name as 'title' | 'key' | 'time';
      const start = bom.length + line.index! + match[1].length;
      metadata.push({field,start,end:start+match[2].length,lineStart:bom.length+line.index!,lineEnd:bom.length+line.index!+line[0].length,value:match[2]});
      if (!prefix) unsafeBody = true;
    } else prefix = false;
    if (prefix) bodyStart += line[0].length;
    if (!match && (/[{}]/.test(line[1]) || parseLine(line[1]).some(segment => segment.chord))) unsafeBody = true;
  }
  const parsed = parseChordPro(source,song.title);
  const fields: OriginalFields = {title:parsed.title,key:parsed.key ?? '',time:metadata.find(item => item.field === 'time')?.value.trim() ?? '',text:source.slice(bodyStart).replace(/\r\n|\r/g,'\n')};
  const ambiguous = (field: string) => metadata.filter(item => item.field === field).length > 1;
  function apply(next: OriginalFields): string {
    if (!next.title.trim()) throw new Error('Skriv en tittel.');
    if (next.time !== fields.time && !validTime(next.time)) throw new Error('Skriv takt, for eksempel 4/4, 6/8 eller C.');
    if (fields.key && next.key !== fields.key) throw new Error('Endring av angitt toneart kommer sammen med transponering.');
    const edits: {start:number;end:number;value:string}[] = [];
    let added = '';
    for (const field of ['title','key','time'] as const) {
      if (next[field] === fields[field]) continue;
      if (/[\r\n{}]/.test(next[field])) throw new Error('Metadata kan ikke inneholde linjeskift eller klammeparenteser.');
      if (ambiguous(field)) throw new Error('Sangen har flere direktiver for dette feltet. Feltet er beskyttet for å bevare originalen.');
      const item = metadata.find(item => item.field === field);
      if (item) edits.push(next[field].trim() ? {...item,value:next[field].trim()} : {start:item.lineStart,end:item.lineEnd,value:''});
      else if (next[field].trim()) added += `{${field}: ${next[field].trim()}}${ending}`;
    }
    if (next.text !== fields.text) {
      if (unsafeBody) throw new Error(protectedText);
      if (/[{}]/.test(next.text) || next.text.split('\n').some(line => parseLine(line).some(segment => segment.chord))) throw new Error('Musikalske koder kan ikke limes inn i tekstflaten ennå. Bruk vanlig sangtekst.');
      // Preserve every untouched source code unit, including mixed line endings.
      let from=0, tail=0;
      while (from<fields.text.length && from<next.text.length && fields.text[from]===next.text[from]) from++;
      while (tail<fields.text.length-from && tail<next.text.length-from && fields.text.at(-tail-1)===next.text.at(-tail-1)) tail++;
      const offsets=[bodyStart];let offset=bodyStart;
      for (const token of source.slice(bodyStart).matchAll(/\r\n|[^]/g)) {offset+=token[0].length;offsets.push(offset);}
      edits.push({start:offsets[from],end:offsets[fields.text.length-tail],value:next.text.slice(from,next.text.length-tail).replace(/\n/g,ending)});
    }
    let result = source;
    for (const edit of edits.sort((a,b) => b.start-a.start)) result = result.slice(0,edit.start)+edit.value+result.slice(edit.end);
    return result.slice(0,bom.length)+added+result.slice(bom.length);
  }
  return {fields,bodyProtected:unsafeBody,protection:protectedText,apply};
}
export function originalProtection(song: Song, personal: SongPersonal): string | undefined {
  if (Object.keys(personal.chorus).length || /\{(?:soc|eoc|start_of_chorus|end_of_chorus|chorus)\b/i.test(song.original)) return 'Originalen er beskyttet for å bevare refreng og individuelle refrengvalg. Personlige endringer kan fortsatt lagres.';
}
export function originalChangeError(before: Song, after: Song, personal: SongPersonal): string | undefined {
  if (before.original === after.original) return;
  return originalProtection(before,personal);
}
export function withOriginal(song: Song, original: string): Song {
  const parsed = parseChordPro(original,song.title);
  return {...song,original,title:parsed.title,key:parsed.key};
}
export function newSong(): Song {
  return {id:crypto.randomUUID(),original:'',title:'',key:null,origin:{kind:'local',filename:'',importedAt:new Date().toISOString()}};
}
