export const maxFileBytes=10_000_000;
export const maxBatchAppendBytes=150*1024*1024;
export const textBytes=(text:string)=>new TextEncoder().encode(text).byteLength;
/** A skipped file still exists. Never turn this into a missing/deleted file. */
export class SkippedFile extends Error {constructor(){super('Filen overskrider størrelsesgrensen.');this.name='SkippedFile';}}
export function checkSize(size:number){if(size>maxFileBytes)throw new SkippedFile();}
