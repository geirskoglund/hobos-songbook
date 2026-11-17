import type {Song} from '../domain/song.ts';

const safe=(name:string)=>name.replace(/[\\/<>:"|?*\u0000-\u001f]/g,'_');
export const songFilename=(song:Song)=>`${safe(song.origin.filename?song.origin.filename.replace(/\.[^.]+$/,''):song.title)||'Sang'}.cho`;
export const originalFilename=(song:Song)=>song.origin.filename&&/\.(txt|chordpro|chopro|crd|pro|chord)$/i.test(song.origin.filename)?safe(song.origin.filename):null;
export function numberedPath(path:string,number:number){
 if(number===1)return path;
 const dot=path.lastIndexOf('.'),slash=path.lastIndexOf('/');
 return dot>slash?`${path.slice(0,dot)} (${number})${path.slice(dot)}`:`${path} (${number})`;
}
