import type {Song} from '../core/song.ts';
import {sameImportFilename} from './import.ts';

interface TransferMatch {
  songId: string;
  title: string;
  filename: string;
  matches: string[];
}
export interface TransferPlan {
  sourceId: string;
  targetId: string | null;
  signature: string;
  matches: TransferMatch[];
}
export function transferPlan(
  songs: Song[],
  sourceId: string,
  targetId: string | null,
  names: Record<string, string> = {},
): TransferPlan {
  const filename = (song: Song) =>
    song.origin.filename || names[song.id] || `${song.title.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_') || 'Sang'}.cho`;
  const source = songs.filter(song => song.songbookId === sourceId),
    target = songs.filter(song => song.songbookId === targetId);
  const rows = (items: Song[]) => items.map(song => [song.id, filename(song)]).sort(([a], [b]) => a.localeCompare(b));
  const matches = source.flatMap(song => {
    const name = filename(song),
      found = target.filter(other => sameImportFilename(name, filename(other)));
    return found.length
      ? [{songId: song.id, title: song.title, filename: name, matches: found.map(song => song.id).sort()}]
      : [];
  });
  return {sourceId, targetId, signature: JSON.stringify([sourceId, targetId, rows(source), rows(target)]), matches};
}
